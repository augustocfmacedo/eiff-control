// MC-LIVE-2A — a projecao do quadro operacional: agrupar, filtrar, contar e ordenar SEM criar regra de status.
// Nomes ficticios. Nenhuma rede, nenhum React, nenhuma escrita.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuadroOperacional from '../../screens/MissionControlQuadro';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLUNAS_QUADRO, ESCOPOS_QUADRO, FILTRO_VAZIO, ROTULO_FACTORY_VIA_GITHUB, STATUS_DESTAQUE, aplicarFiltroQuadro,
  SEM_EVIDENCIA_DE_CI, ciDoItem, compararItensQuadro, haQuantoTempo, montarQuadro, rotuloProcedenciaDoItem, textoBuscavel,
  workstreamsDisponiveis,
} from './quadroOperacional';
import {
  MC_FONTES, MC_STATUS, ORDEM_MC_STATUS, PROCEDENCIAS, ROTULO_PROCEDENCIA,
  type McStatus, type MissionControlWorkItem,
} from './workItem';

const AGORA = '2026-09-22T14:00:00.000Z';

const item = (p: Partial<MissionControlWorkItem> & { sourceId: string }): MissionControlWorkItem => ({
  id: `${p.source ?? 'FACTORY'}:${p.sourceId}`,
  source: 'FACTORY',
  procedencia: 'GITHUB_PROJECTION',
  title: `Tarefa ${p.sourceId}`,
  status: 'EXECUTANDO',
  statusOrigem: 'CODING',
  frescor: { observadoEm: AGORA, stale: false, fonteIndisponivel: false },
  ...p,
});

const CODIGO = readFileSync('src/core/central/quadroOperacional.ts', 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const FONTE = semComentarios(CODIGO);

describe('MC-LIVE-2A · colunas', () => {
  it('as colunas sao exatamente os MC_STATUS, sem inventar nem esconder nenhum', () => {
    expect([...COLUNAS_QUADRO].sort()).toEqual([...MC_STATUS].sort());
  });

  it('a ordem das colunas e a de ORDEM_MC_STATUS, nao uma ordem nova', () => {
    expect(COLUNAS_QUADRO).toEqual([...MC_STATUS].sort((a, b) => ORDEM_MC_STATUS[a] - ORDEM_MC_STATUS[b]));
    expect(COLUNAS_QUADRO[0]).toBe('PROXIMO');
    expect(COLUNAS_QUADRO[COLUNAS_QUADRO.length - 1]).toBe('CONCLUIDO');
  });

  it('as sete perguntas operacionais tem coluna', () => {
    for (const s of ['ARQUITETURA', 'PRONTO', 'EXECUTANDO', 'AGUARDANDO_HUMANO', 'EM_VALIDACAO', 'BLOQUEADO', 'CONCLUIDO'] as McStatus[]) {
      expect(COLUNAS_QUADRO).toContain(s);
    }
  });

  it('a barra superior destaca execucao, decisao humana, bloqueio, validacao e conclusao', () => {
    expect(STATUS_DESTAQUE).toEqual(['EXECUTANDO', 'AGUARDANDO_HUMANO', 'BLOQUEADO', 'EM_VALIDACAO', 'CONCLUIDO']);
  });

  it('todo item cai em exatamente uma coluna, e nenhum some', () => {
    const itens = MC_STATUS.map((s, n) => item({ sourceId: `T-${n}`, status: s }));
    const q = montarQuadro(itens);
    expect(q.colunas.reduce((n, c) => n + c.total, 0)).toBe(itens.length);
    expect(q.visiveis).toBe(itens.length);
    for (const c of q.colunas) expect(c.total).toBe(1);
  });
});

describe('MC-LIVE-2A · nao cria regra de status', () => {
  it('o quadro usa o status normalizado como veio, sem reclassificar', () => {
    const q = montarQuadro([item({ sourceId: 'A', status: 'BLOQUEADO', statusOrigem: 'BLOCKED_BY_DESIGN' })]);
    expect(q.colunas.find((c) => c.status === 'BLOQUEADO')!.itens[0].statusOrigem).toBe('BLOCKED_BY_DESIGN');
    expect(q.colunas.find((c) => c.status === 'EXECUTANDO')!.total).toBe(0);
  });

  it('o modulo nao deriva status de statusOrigem nem de label: nenhuma segunda normalizacao', () => {
    for (const proibido of ['statusOrigem ===', 'CODING', 'factory:state', 'normalizarJob', 'derivarStatus']) {
      expect(FONTE).not.toContain(proibido);
    }
  });

  it('o quadro nao escreve: nada de fetch, store, supabase ou React', () => {
    for (const proibido of ['fetch(', 'supabase', 'store', 'react', 'useState', 'POST', 'actions.']) {
      expect(FONTE).not.toContain(proibido);
    }
    const imports = [...CODIGO.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./workItem']);
  });

  it('o quadro nao ordena por prioridade comercial', () => {
    for (const proibido of ['priorityScore', 'priorityClass', 'CommercialQueue', 'fitScore', 'score']) {
      expect(FONTE).not.toContain(proibido);
    }
  });
});

describe('MC-LIVE-2A · filtros', () => {
  const itens = [
    item({ sourceId: 'DF-0418', source: 'FACTORY', title: 'Implementar adapter GitHub' }),
    item({ sourceId: 'G-1', source: 'GATE', title: 'Gate de prontidão', status: 'CONCLUIDO' }),
    item({ sourceId: 'A-1', source: 'ARCHITECTURE', title: 'Desenho do mapa', status: 'ARQUITETURA' }),
    item({ sourceId: 'pr-18', source: 'GITHUB', title: 'PR #18', status: 'EM_VALIDACAO' }),
  ];

  it('escopo TODOS nao esconde nada', () => {
    expect(aplicarFiltroQuadro(itens, { escopo: 'TODOS' })).toHaveLength(4);
    expect(ESCOPOS_QUADRO).toEqual(['TODOS', 'ARQUITETURA', 'FACTORY']);
  });

  it('escopo ARQUITETURA traz a curadoria do repositorio (ARCHITECTURE + GATE)', () => {
    const r = aplicarFiltroQuadro(itens, { escopo: 'ARQUITETURA' });
    expect(r.map((i) => i.source).sort()).toEqual(['ARCHITECTURE', 'GATE']);
  });

  it('escopo FACTORY traz execucao (FACTORY + GITHUB)', () => {
    const r = aplicarFiltroQuadro(itens, { escopo: 'FACTORY' });
    expect(r.map((i) => i.source).sort()).toEqual(['FACTORY', 'GITHUB']);
  });

  it('filtro por status devolve so aquele status', () => {
    expect(aplicarFiltroQuadro(itens, { escopo: 'TODOS', status: 'EM_VALIDACAO' }).map((i) => i.sourceId)).toEqual(['pr-18']);
  });

  it('busca casa taskId, correlationId e titulo, sem caixa e sem acento', () => {
    const comCorrel = [...itens, item({ sourceId: 'x-9', correlationId: 'DF-0500', title: 'Validação do canário' })];
    expect(aplicarFiltroQuadro(comCorrel, { escopo: 'TODOS', busca: 'df-0418' }).map((i) => i.sourceId)).toEqual(['DF-0418']);
    expect(aplicarFiltroQuadro(comCorrel, { escopo: 'TODOS', busca: 'DF-0500' }).map((i) => i.sourceId)).toEqual(['x-9']);
    expect(aplicarFiltroQuadro(comCorrel, { escopo: 'TODOS', busca: 'canario' }).map((i) => i.sourceId)).toEqual(['x-9']);
    expect(aplicarFiltroQuadro(comCorrel, { escopo: 'TODOS', busca: '  ADAPTER  ' }).map((i) => i.sourceId)).toEqual(['DF-0418']);
  });

  it('a busca nao casa por status normalizado (isso e filtro proprio)', () => {
    expect(textoBuscavel(itens[0])).not.toContain('executando');
    expect(aplicarFiltroQuadro(itens, { escopo: 'TODOS', busca: 'executando' })).toHaveLength(0);
  });

  it('filtros se combinam', () => {
    const r = aplicarFiltroQuadro(itens, { escopo: 'FACTORY', status: 'EXECUTANDO', busca: 'adapter' });
    expect(r.map((i) => i.sourceId)).toEqual(['DF-0418']);
  });

  it('workstream so aparece quando a fonte informa de verdade', () => {
    expect(workstreamsDisponiveis(itens)).toEqual([]);
    const comWs = [...itens, item({ sourceId: 'W-1', workstreamId: 'wave-03' }), item({ sourceId: 'W-2', workstreamId: 'wave-03' })];
    expect(workstreamsDisponiveis(comWs)).toEqual(['wave-03']);
    expect(aplicarFiltroQuadro(comWs, { escopo: 'TODOS', workstreamId: 'wave-03' })).toHaveLength(2);
  });

  it('o filtro muda o que aparece, nunca o status do item', () => {
    const q = montarQuadro(itens, { escopo: 'FACTORY' });
    expect(q.visiveis).toBe(2);
    expect(q.totalSemFiltro).toBe(4);
    expect(q.contagens.CONCLUIDO).toBe(0); // o gate concluido foi ESCONDIDO, nao reclassificado
    expect(montarQuadro(itens).contagens.CONCLUIDO).toBe(1);
  });
});

describe('MC-LIVE-2A · ordem dentro da coluna', () => {
  it('quem mexeu por ultimo vem primeiro', () => {
    const a = item({ sourceId: 'a', updatedAt: '2026-09-22T10:00:00.000Z' });
    const b = item({ sourceId: 'b', updatedAt: '2026-09-22T13:00:00.000Z' });
    expect([a, b].sort(compararItensQuadro).map((i) => i.sourceId)).toEqual(['b', 'a']);
  });

  it('item sem data de alteracao vai para o fim, e nao vira "agora" nem "antigo"', () => {
    const comData = item({ sourceId: 'a', updatedAt: '2020-01-01T00:00:00.000Z' });
    const semData = item({ sourceId: 'b' });
    expect([semData, comData].sort(compararItensQuadro).map((i) => i.sourceId)).toEqual(['a', 'b']);
    expect(semData.updatedAt).toBeUndefined();
  });

  it('empate desempata pelo id: a ordem e deterministica entre dois polls iguais', () => {
    const x = item({ sourceId: 'z', updatedAt: AGORA });
    const y = item({ sourceId: 'a', updatedAt: AGORA });
    expect([x, y].sort(compararItensQuadro).map((i) => i.sourceId)).toEqual(['a', 'z']);
    expect([y, x].sort(compararItensQuadro).map((i) => i.sourceId)).toEqual(['a', 'z']);
  });

  it('dois itens sem data tambem tem ordem estavel', () => {
    const x = item({ sourceId: 'z' });
    const y = item({ sourceId: 'a' });
    expect([x, y].sort(compararItensQuadro).map((i) => i.sourceId)).toEqual(['a', 'z']);
  });
});

describe('MC-LIVE-2A · frescor e contagens', () => {
  it('conta itens de fonte vencida e de fonte indisponivel separadamente', () => {
    const q = montarQuadro([
      item({ sourceId: 'a' }),
      item({ sourceId: 'b', frescor: { observadoEm: AGORA, stale: true, fonteIndisponivel: false } }),
      item({ sourceId: 'c', frescor: { observadoEm: AGORA, stale: true, fonteIndisponivel: true } }),
    ]);
    expect(q.stale).toBe(2);
    expect(q.fonteIndisponivel).toBe(1);
  });

  it('quadro vazio nao quebra e devolve todas as colunas zeradas', () => {
    const q = montarQuadro([], FILTRO_VAZIO);
    expect(q.colunas).toHaveLength(MC_STATUS.length);
    expect(q.visiveis).toBe(0);
    expect(q.totalSemFiltro).toBe(0);
    for (const s of MC_STATUS) expect(q.contagens[s]).toBe(0);
  });

  it('a contagem por status bate com o tamanho das colunas', () => {
    const itens: MissionControlWorkItem[] = [
      item({ sourceId: '1', status: 'EXECUTANDO' }), item({ sourceId: '2', status: 'EXECUTANDO' }),
      item({ sourceId: '3', status: 'BLOQUEADO' }),
    ];
    const q = montarQuadro(itens);
    for (const c of q.colunas) expect(c.total).toBe(q.contagens[c.status]);
    expect(q.contagens.EXECUTANDO).toBe(2);
  });
});

describe('MC-LIVE-2A · tempo relativo', () => {
  it('formata segundos, minutos, horas e dias', () => {
    expect(haQuantoTempo('2026-09-22T13:59:30.000Z', AGORA)).toBe('30 s');
    expect(haQuantoTempo('2026-09-22T13:58:00.000Z', AGORA)).toBe('2 min');
    expect(haQuantoTempo('2026-09-22T11:00:00.000Z', AGORA)).toBe('3 h');
    expect(haQuantoTempo('2026-09-17T14:00:00.000Z', AGORA)).toBe('5 d');
  });

  it('sem data devolve undefined: a tela mostra travessao, nunca "agora"', () => {
    expect(haQuantoTempo(undefined, AGORA)).toBeUndefined();
    expect(haQuantoTempo('nao-e-data', AGORA)).toBeUndefined();
  });

  it('data no futuro vira "agora" em vez de tempo negativo', () => {
    expect(haQuantoTempo('2026-09-22T14:05:00.000Z', AGORA)).toBe('agora');
  });
});

describe('MC-LIVE-2A · o quadro e projecao, nao autoridade', () => {
  it('montarQuadro nao muta a lista recebida nem os itens', () => {
    const itens = [item({ sourceId: 'b', updatedAt: '2026-09-22T10:00:00.000Z' }), item({ sourceId: 'a', updatedAt: AGORA })];
    const antes = JSON.stringify(itens);
    montarQuadro(itens, { escopo: 'FACTORY', busca: 'tarefa' });
    expect(JSON.stringify(itens)).toBe(antes);
    expect(itens[0].sourceId).toBe('b'); // a ordem original continua intacta
  });

  it('nao existe funcao de mover item entre colunas', () => {
    for (const proibido of ['mover', 'moveItem', 'setStatus', 'atualizarStatus', 'dragEnd', 'onDrop']) {
      expect(FONTE).not.toContain(proibido);
    }
  });

  it('o item carrega o estado cru para a tela mostrar ao lado do normalizado', () => {
    const q = montarQuadro([item({ sourceId: 'DF-0418', status: 'EXECUTANDO', statusOrigem: 'CODING' })]);
    const cartao = q.colunas.find((c) => c.status === 'EXECUTANDO')!.itens[0];
    expect(cartao.status).toBe('EXECUTANDO');
    expect(cartao.statusOrigem).toBe('CODING');
    expect(cartao.procedencia).toBe('GITHUB_PROJECTION');
  });
});

// -----------------------------------------------------------------------------------------------------
// MC-LIVE-2B — correcoes do smoke real: procedencia falsa e CI falso.
// -----------------------------------------------------------------------------------------------------

const TELA = readFileSync('src/screens/MissionControlQuadro.tsx', 'utf8');

describe('MC-LIVE-2B · procedencia depende de source E de procedencia', () => {
  it('item da fabrica observado pelo GitHub e o UNICO que anuncia projecao da Factory', () => {
    expect(rotuloProcedenciaDoItem({ source: 'FACTORY', procedencia: 'GITHUB_PROJECTION' }))
      .toBe('GitHub projection of Factory');
    expect(ROTULO_FACTORY_VIA_GITHUB).toBe('GitHub projection of Factory');
  });

  it('item do proprio GitHub usa o rotulo canonico, nunca o da Factory', () => {
    const r = rotuloProcedenciaDoItem({ source: 'GITHUB', procedencia: 'GITHUB_PROJECTION' });
    expect(r).toBe(ROTULO_PROCEDENCIA.GITHUB_PROJECTION);
    expect(r).toBe('projeção do GitHub');
    expect(r).not.toBe(ROTULO_FACTORY_VIA_GITHUB);
  });

  it('curadoria do repositorio (arquitetura e gate) usa o rotulo canonico', () => {
    expect(rotuloProcedenciaDoItem({ source: 'ARCHITECTURE', procedencia: 'REPOSITORIO' }))
      .toBe(ROTULO_PROCEDENCIA.REPOSITORIO);
    expect(rotuloProcedenciaDoItem({ source: 'GATE', procedencia: 'REPOSITORIO' }))
      .toBe(ROTULO_PROCEDENCIA.REPOSITORIO);
  });

  it('a fabrica lida pela API dela mesma e estado operacional, nao projecao', () => {
    expect(rotuloProcedenciaDoItem({ source: 'FACTORY', procedencia: 'FACTORY_API' }))
      .toBe('estado operacional da Factory');
  });

  it('nenhuma outra combinacao de fonte e procedencia recebe o literal da Factory', () => {
    const autorizada = { source: 'FACTORY', procedencia: 'GITHUB_PROJECTION' };
    for (const source of MC_FONTES) {
      for (const procedencia of PROCEDENCIAS) {
        const r = rotuloProcedenciaDoItem({ source, procedencia });
        const eAutorizada = source === autorizada.source && procedencia === autorizada.procedencia;
        expect(r === ROTULO_FACTORY_VIA_GITHUB).toBe(eAutorizada);
        if (!eAutorizada) expect(r).toBe(ROTULO_PROCEDENCIA[procedencia]);
      }
    }
  });

  it('a tela nao decide procedencia sozinha: usa a funcao e nao repete o literal na logica do cartao', () => {
    expect(TELA).toContain('rotuloProcedenciaDoItem(i)');
    expect(TELA).not.toContain("'GitHub projection of Factory'");
    expect(TELA).not.toContain("=== 'GITHUB_PROJECTION'");
  });

  it('o rotulo canonico continua com uma unica autoridade: ROTULO_PROCEDENCIA', () => {
    for (const p of PROCEDENCIAS) {
      if (p === 'GITHUB_PROJECTION') continue;
      expect(rotuloProcedenciaDoItem({ source: 'GITHUB', procedencia: p })).toBe(ROTULO_PROCEDENCIA[p]);
    }
    expect(FONTE).not.toContain('projeção do GitHub');
    expect(FONTE).not.toContain('curadoria do');
  });
});

describe('MC-LIVE-2B · CI nao e inferido do estado cru da fonte', () => {
  it('PR em rascunho nao vira CI: pr:draft e estado do pull request', () => {
    const pr = item({ source: 'GITHUB', sourceId: '5', status: 'EM_VALIDACAO', statusOrigem: 'pr:draft' });
    expect(ciDoItem(pr)).toBeUndefined();
    expect(ciDoItem(pr)).not.toBe(pr.statusOrigem);
    expect(pr.statusOrigem).toBe('pr:draft'); // o estado cru segue intacto no item
  });

  it('PR aberto tambem nao vira CI', () => {
    const pr = item({ source: 'GITHUB', sourceId: '7', status: 'EM_VALIDACAO', statusOrigem: 'pr:open' });
    expect(ciDoItem(pr)).toBeUndefined();
  });

  it('estado cru com nome de CI nao vira CI so pelo nome', () => {
    const rodando = item({ sourceId: 'DF-0501', status: 'EM_VALIDACAO', statusOrigem: 'CI_RUNNING' });
    expect(ciDoItem(rodando)).toBeUndefined();
  });

  it('sem evidencia propria de CI a resposta e ausencia, para a tela mostrar travessao', () => {
    for (const s of MC_STATUS) expect(ciDoItem(item({ sourceId: `X-${s}`, status: s }))).toBeUndefined();
  });

  it('o campo CI continua no cartao, mostrando travessao — some do dado, nao da tela', () => {
    expect(TELA).toContain('rotulo="CI"');
    expect(TELA).toContain('valor={ciDoItem(i)}');
    expect(TELA).not.toContain("i.status === 'EM_VALIDACAO' ? i.statusOrigem");
    expect(TELA).toMatch(/rotulo="CI"[^/]*\/>/); // um unico elo de CI, sem valor derivado
  });

  it('o estado cru continua visivel ao lado do normalizado, e os elos tecnicos seguem intactos', () => {
    const pr = item({
      source: 'GITHUB', sourceId: '5', status: 'EM_VALIDACAO', statusOrigem: 'pr:draft',
      links: { branch: 'feature/x', pullRequest: 'https://github.com/o/r/pull/5', commit: 'abc1234' },
    });
    const cartao = montarQuadro([pr]).colunas.find((c) => c.status === 'EM_VALIDACAO')!.itens[0];
    expect(cartao.statusOrigem).toBe('pr:draft');
    expect(cartao.links).toEqual(pr.links);
    expect(TELA).toContain('{i.statusOrigem}');          // o cru continua impresso no cartao
    expect(TELA).toContain('rotulo="PR"');
    expect(TELA).toContain('rotulo="Branch"');
    expect(TELA).toContain('curto(i.links?.pullRequest)'); // PR continua virando #5
  });
});

// ---------------------------------------------------------------------------------------------
// MC-LIVE-2B (lacuna do smoke): o travessão do CI não pode ser mudo
// ---------------------------------------------------------------------------------------------
describe('MC-LIVE-2B · ausência de CI é explicada, não só desenhada', () => {
  const estadoCom = (i: MissionControlWorkItem) => ({
    dados: {
      observadoEm: AGORA,
      build: { sha: null, origem: null },
      fontes: { github: { fonte: 'GITHUB' as const, disponivel: true, stale: false, observadoEm: AGORA, chamadas: 7, maxChamadasPorCiclo: 7 } },
      repositorios: [],
      workItems: [i],
      contagens: Object.fromEntries(MC_STATUS.map((s) => [s, 0])) as Record<McStatus, number>,
      factory: { procedencia: 'GITHUB_PROJECTION' as const, aviso: 'projeção', repositorio: 'x/y', contagens: Object.fromEntries(MC_STATUS.map((s) => [s, 0])) as Record<McStatus, number> },
      limiteStaleSegundos: 180,
    },
    recebidoEm: AGORA, carregando: false, erro: null, falhasSeguidas: 0, recarregar: () => {},
  });

  const htmlDoCartao = (i: MissionControlWorkItem) =>
    renderToStaticMarkup(React.createElement(QuadroOperacional, { estado: estadoCom(i) as never }));

  it('a frase da ausência mora no core, não no JSX', () => {
    expect(SEM_EVIDENCIA_DE_CI).toBe('Sem evidência de CI correlacionada a este item.');
    expect(TELA).toContain('semValor={SEM_EVIDENCIA_DE_CI}');
    expect(TELA).not.toContain("'Sem evidência de CI"); // a frase não é escrita inline na tela
  });

  it('o cartão renderiza CI com travessão E a explicação acessível', () => {
    const html = htmlDoCartao(item({ source: 'GITHUB', sourceId: '5', status: 'EM_VALIDACAO', statusOrigem: 'pr:draft' }));
    expect(html).toContain('Sem evidência de CI correlacionada a este item.');
    // o elo do CI é exatamente: rótulo, travessão com title e aria-label — nunca um valor inventado
    expect(html).toMatch(/CI<\/span><span class="muted" title="Sem evidência de CI correlacionada a este item\." aria-label="CI: Sem evidência de CI correlacionada a este item\.">—<\/span>/);
  });

  it('pr:draft continua visível como estado CRU, mas nunca dentro do elo do CI', () => {
    const html = htmlDoCartao(item({ source: 'GITHUB', sourceId: '5', status: 'EM_VALIDACAO', statusOrigem: 'pr:draft' }));
    expect(html).toContain('pr:draft');                                   // o fato bruto não some
    const eloCi = html.slice(html.indexOf('>CI<'));
    expect(eloCi.slice(0, 220)).not.toContain('pr:draft');                // mas não é CI
  });

  it('os outros elos não mudaram: ausência sem explicação continua um travessão mudo', () => {
    const html = htmlDoCartao(item({ source: 'FACTORY', sourceId: 'DF-0900', status: 'EXECUTANDO', statusOrigem: 'CODING' }));
    // Branch sem valor: travessão simples, sem title — a prop nova é opcional e só o CI a usa
    expect(html).toContain('Branch</span><span class="muted">—</span>');
    expect(html).toContain('Sem evidência de CI correlacionada a este item.');
  });
});

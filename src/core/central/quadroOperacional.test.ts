// MC-LIVE-2A — a projecao do quadro operacional: agrupar, filtrar, contar e ordenar SEM criar regra de status.
// Nomes ficticios. Nenhuma rede, nenhum React, nenhuma escrita.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLUNAS_QUADRO, ESCOPOS_QUADRO, FILTRO_VAZIO, STATUS_DESTAQUE, aplicarFiltroQuadro, compararItensQuadro,
  haQuantoTempo, montarQuadro, textoBuscavel, workstreamsDisponiveis,
} from './quadroOperacional';
import { MC_STATUS, ORDEM_MC_STATUS, type McStatus, type MissionControlWorkItem } from './workItem';

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

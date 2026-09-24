// Central de Construção (MC-CONSTRUCTION-1) — o panorama só vale se for derivado.
//
// Doze provas pedidas pela entrega: módulo não some sem dado vivo; tarefa sem módulo continua visível;
// contagens batem com os elementos reais; nenhum percentual digitado; nenhum segundo vocabulário de status;
// domínio puro sem rede nem escrita; o Mapa Vivo usa o modelo existente; os filtros do quadro seguem
// funcionando; LIVE e SNAPSHOT separados; erro de fonte não vira zero; nada inventado por heurística; a
// tela continua read-only.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOMINIOS_CONSTRUCAO, ESTADOS_CONSTRUCAO, EXCLUSOES_SUPERFICIE, MENSAGEM_DRIFT_SUPERFICIE, MODULOS_CONSTRUCAO, ROTULO_ESTADO_CONSTRUCAO, SEM_MODULO, STATUS_ATIVOS,
  TONE_ESTADO_CONSTRUCAO, atencaoConstrucao, construindoAgora, estadoDoModulo, fracaoTexto, gatesDesconhecidosNosModulos,
  classificarSuperficie, gatesDoModulo, moduloDaTarefa, moduloPorId, panoramaConstrucao, pctConstrucao, projetarComponente, projetarModulo,
  superficiesSemClassificacao, componentesPlanejados, mensagemDriftComponente,
  type ComponenteConstrucao, type ComponentePlanejado,
} from './construcao';
import { GATES, WORKSTREAMS, gatePorId, type Evidencia } from './missionControl';
import { ARESTAS, ATORES_DO_NO, FONTE_DO_NO, NOS, camadasDoMapa, itensDoNo, layoutDoMapa, noRecebeItensVivos } from './mapaVivo';
import { COLUNAS_QUADRO, montarQuadro } from './quadroOperacional';
import { MC_STATUS, ROTULO_MC_STATUS, type MissionControlWorkItem } from './workItem';

const AGORA = '2026-09-23T12:00:00Z';
const item = (p: Partial<MissionControlWorkItem> & { id: string }): MissionControlWorkItem => ({
  source: 'GITHUB', procedencia: 'GITHUB_PROJECTION', sourceId: p.id, title: 'x', status: 'EM_VALIDACAO', statusOrigem: 'pr:open',
  frescor: { observadoEm: AGORA, stale: false, fonteIndisponivel: false },
  ...p,
});

const existe = (c: string) => fs.existsSync(c);
const conteudo = (c: string) => fs.readFileSync(c, 'utf8');
const TELAS = ['src/screens/MissionControl.tsx', 'src/screens/MissionControlVisao.tsx', 'src/screens/MissionControlMapa.tsx', 'src/screens/MissionControlGovernanca.tsx', 'src/screens/MissionControlQuadro.tsx'];
const DOMINIO_PURO = 'src/core/central/construcao.ts';

// ------------------------------------------------------------------------- 1. módulo não some sem dado vivo

describe('1 · nenhum módulo desaparece por falta de dado vivo', () => {
  it('sem leitura (null) e com leitura vazia, o catálogo inteiro continua projetado', () => {
    expect(panoramaConstrucao(null).modulos.map((x) => x.modulo.id)).toEqual(MODULOS_CONSTRUCAO.map((x) => x.id));
    expect(panoramaConstrucao([]).modulos.map((x) => x.modulo.id)).toEqual(MODULOS_CONSTRUCAO.map((x) => x.id));
    expect(panoramaConstrucao(null).total).toBe(MODULOS_CONSTRUCAO.length);
  });

  it('o estado do módulo não depende de tarefa viva para existir', () => {
    for (const mo of MODULOS_CONSTRUCAO) expect(ESTADOS_CONSTRUCAO).toContain(projetarModulo(mo, []).estado);
  });
});

// ------------------------------------------------------------------------- 2. tarefa sem módulo continua visível

describe('2 · task sem módulo não some', () => {
  it('sem workstream nem gate a tarefa fica sem módulo, mas continua em "construindo agora" e na contagem', () => {
    const t = item({ id: 'GITHUB:a/b#1', status: 'EXECUTANDO', title: 'Mission Control: mapa vivo' });
    expect(moduloDaTarefa(t)).toBeUndefined();
    expect(construindoAgora([t]).map((x) => x.id)).toEqual([t.id]);
    const p = panoramaConstrucao([t]);
    expect(p.tarefas?.semModulo).toBe(1);
    expect(p.tarefas?.comModulo).toBe(0);
    expect(SEM_MODULO).toBe('Módulo não informado');
  });

  it('a relação segura existe: workstream do contrato e gate do item', () => {
    const porFrente = item({ id: 'GATE:x', source: 'GATE', procedencia: 'REPOSITORIO', workstreamId: 'CANAL' });
    expect(moduloDaTarefa(porFrente)?.id).toBe('CENTRAL_WHATSAPP');
    const porGate = item({ id: 'GATE:y', source: 'GATE', procedencia: 'REPOSITORIO', gateIds: ['MAPA_VIVO'] });
    expect(moduloDaTarefa(porGate)?.id).toBe('MISSION_CONTROL');
    expect(projetarModulo(moduloPorId('MISSION_CONTROL')!, [porGate]).tarefas.map((x) => x.id)).toEqual(['GATE:y']);
  });
});

// ------------------------------------------------------------------------- 3. contagens derivadas

describe('3 · contagens batem com os elementos reais', () => {
  const itens = [
    item({ id: 'a', status: 'EXECUTANDO', source: 'FACTORY' }), item({ id: 'b', status: 'BLOQUEADO', bloqueio: { motivo: 'x', porDesenho: false } }),
    item({ id: 'c', status: 'CONCLUIDO' }), item({ id: 'd', status: 'AGUARDANDO_HUMANO' }), item({ id: 'e', status: 'EM_VALIDACAO', frescor: { observadoEm: AGORA, stale: true, fonteIndisponivel: false } }),
  ];
  const p = panoramaConstrucao(itens);

  it('estados dos módulos somam o total e cada módulo é contado uma vez', () => {
    expect(Object.values(p.porEstado).reduce((a, b) => a + b, 0)).toBe(p.total);
    for (const e of ESTADOS_CONSTRUCAO) expect(p.porEstado[e]).toBe(p.modulos.filter((x) => x.estado === e).length);
  });

  it('tarefas: total, ativas, por status, stale e sem módulo são contagens dos itens', () => {
    expect(p.tarefas?.total).toBe(5);
    expect(p.tarefas?.ativas).toBe(itens.filter((i) => STATUS_ATIVOS.includes(i.status)).length);
    expect(Object.values(p.tarefas!.porStatus).reduce((a, b) => a + b, 0)).toBe(5);
    expect(p.tarefas?.stale).toBe(1);
    expect(p.tarefas?.semModulo).toBe(5);
    expect(construindoAgora(itens).map((i) => i.id)).toEqual(['a', 'e', 'd', 'b']);
  });

  it('componentes concluídos/total do módulo são contagem dos componentes projetados', () => {
    for (const mo of p.modulos) {
      expect(mo.total).toBe(mo.modulo.componentes.length);
      expect(mo.concluidos).toBe(mo.componentes.filter((c) => c.estado === 'CONCLUIDO').length);
      expect(mo.fracao).toBe(mo.total === 0 ? 0 : mo.concluidos / mo.total);
    }
  });

  it('a fábrica observada conta os itens de fonte FACTORY como observados, não como pertença', () => {
    const f = p.modulos.find((x) => x.modulo.id === 'FACTORY')!;
    expect(f.observados.map((x) => x.id)).toEqual(['a']);
    expect(f.tarefas).toEqual([]);
  });
});

// ------------------------------------------------------------------------- 4. nenhum percentual manual

describe('4 · nenhum percentual digitado', () => {
  it('o domínio e as telas não contêm porcentagem literal', () => {
    for (const f of [DOMINIO_PURO, ...TELAS]) {
      if (!existe(f)) continue;
      expect(conteudo(f), f).not.toMatch(/\b\d{1,3}\s?%/);
    }
  });

  it('a porcentagem, quando existe, é arredondamento da fração concluídos/total', () => {
    expect(fracaoTexto(5, 8)).toBe('5/8');
    expect(pctConstrucao(5 / 8)).toBe('63%');
    expect(pctConstrucao(0)).toBe('0%');
  });
});

// ------------------------------------------------------------------------- 5. um vocabulário só

describe('5 · nenhum segundo vocabulário de MC_STATUS', () => {
  it('STATUS_ATIVOS é subconjunto de MC_STATUS e os rótulos vêm de ROTULO_MC_STATUS', () => {
    for (const s of STATUS_ATIVOS) expect(MC_STATUS).toContain(s);
    for (const f of TELAS) {
      if (!existe(f)) continue;
      const src = conteudo(f);
      // nenhuma tela define um mapa próprio de rótulo por status normalizado
      expect(src, f).not.toMatch(/Record<McStatus,\s*string>/);
    }
    expect(Object.keys(ROTULO_MC_STATUS).sort()).toEqual([...MC_STATUS].sort());
  });

  it('o vocabulário de construção é fechado e rotulado por inteiro', () => {
    expect(Object.keys(ROTULO_ESTADO_CONSTRUCAO).sort()).toEqual([...ESTADOS_CONSTRUCAO].sort());
    expect(Object.keys(TONE_ESTADO_CONSTRUCAO).sort()).toEqual([...ESTADOS_CONSTRUCAO].sort());
    for (const mo of panoramaConstrucao(null).modulos) {
      expect(ESTADOS_CONSTRUCAO).toContain(mo.estado);
      for (const c of mo.componentes) expect(ESTADOS_CONSTRUCAO).toContain(c.estado);
    }
  });
});

// ------------------------------------------------------------------------- 6. domínio puro

describe('6 · nenhuma nova escrita ou rede no domínio puro', () => {
  const src = conteudo(DOMINIO_PURO);
  it('construcao.ts não conhece rede, banco, store nem React', () => {
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/from '@supabase/);
    expect(src).not.toMatch(/from 'react'/);
    expect(src).not.toMatch(/from '\.\.\/\.\.\/data\//);
    expect(src).not.toMatch(/localStorage|XMLHttpRequest|WebSocket/);
  });
  it('não há função de escrita exportada', () => {
    expect(src).not.toMatch(/export (function|const) (salvar|gravar|atualizar|mover|transicionar|enviar|aplicar|criar)/);
  });
});

// ------------------------------------------------------------------------- 7. mapa vivo usa o modelo

describe('7 · Mapa Vivo usa o modelo existente', () => {
  it('o layout posiciona exatamente os nós de NOS, sem grafo paralelo', () => {
    const l = layoutDoMapa();
    expect(l.nos.map((n) => n.id).sort()).toEqual(NOS.map((n) => n.id).sort());
    expect(l.largura).toBeGreaterThan(0);
    expect(l.altura).toBeGreaterThan(0);
    // determinístico
    expect(layoutDoMapa()).toEqual(l);
  });

  it('nenhum par de nós ocupa a mesma célula', () => {
    const l = layoutDoMapa();
    const celulas = new Set(l.nos.map((n) => `${n.dominio}|${n.coluna}|${n.linha}`));
    expect(celulas.size).toBe(l.nos.length);
    for (const n of l.nos) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0); expect(n.x + l.largNo).toBeLessThanOrEqual(l.largura); }
  });

  it('camada respeita a ordem das arestas de fluxo e dependência', () => {
    const c = camadasDoMapa();
    for (const a of ARESTAS.filter((x) => x.tipo === 'fluxo' || x.tipo === 'dependencia')) {
      expect(c.get(a.para)!, `${a.de} → ${a.para}`).toBeGreaterThan(c.get(a.de)!);
    }
  });

  it('a tela do mapa importa o modelo e não declara nós nem arestas próprias', () => {
    const f = 'src/screens/MissionControlMapa.tsx';
    if (!existe(f)) return;
    const src = conteudo(f);
    expect(src).toMatch(/from '\.\.\/core\/central\/mapaVivo'/);
    expect(src).toMatch(/\bNOS\b/);
    expect(src).toMatch(/\bARESTAS\b/);
    expect(src).not.toMatch(/const (NOS|ARESTAS|nos|arestas)\s*[:=]\s*\[/);
  });

  it('itens vivos por nó usam só responsável e fonte do item normalizado', () => {
    for (const id of [...Object.keys(ATORES_DO_NO), ...Object.keys(FONTE_DO_NO)]) expect(NOS.some((n) => n.id === id), id).toBe(true);
    const job = item({ id: 'FACTORY:DF-0001', source: 'FACTORY', status: 'EXECUTANDO', responsavel: { tipo: 'WORKER', rotulo: 'Worker' } });
    const pr = item({ id: 'GITHUB:a/b#2' });
    const demanda = item({ id: 'ARCHITECTURE:a/b#3', source: 'ARCHITECTURE', status: 'ARQUITETURA' });
    expect(itensDoNo('WORKER', [job, pr, demanda]).map((x) => x.id)).toEqual([job.id]);
    expect(itensDoNo('PR', [job, pr, demanda]).map((x) => x.id)).toEqual([pr.id]);
    expect(itensDoNo('DEMANDA', [job, pr, demanda]).map((x) => x.id)).toEqual([demanda.id]);
    expect(itensDoNo('META', [job, pr, demanda])).toEqual([]);
    expect(noRecebeItensVivos('META')).toBe(false);
    expect(noRecebeItensVivos('WORKER')).toBe(true);
  });
});

// ------------------------------------------------------------------------- 8. filtros do quadro

describe('8 · os filtros do quadro continuam funcionando', () => {
  it('montarQuadro filtra por status, escopo e busca com as mesmas 8 colunas', () => {
    const itens = [item({ id: 'a', status: 'EXECUTANDO', source: 'FACTORY', title: 'alfa' }), item({ id: 'b', status: 'CONCLUIDO', title: 'beta' })];
    expect(COLUNAS_QUADRO.length).toBe(8);
    expect(montarQuadro(itens, { escopo: 'TODOS', status: 'EXECUTANDO' }).visiveis).toBe(1);
    expect(montarQuadro(itens, { escopo: 'FACTORY' }).visiveis).toBe(2);
    expect(montarQuadro(itens, { escopo: 'ARQUITETURA' }).visiveis).toBe(0);
    expect(montarQuadro(itens, { escopo: 'TODOS', busca: 'beta' }).visiveis).toBe(1);
  });

  it('a tela principal continua entregando o MESMO estado remoto ao quadro (nenhum segundo polling)', () => {
    const src = conteudo('src/screens/MissionControl.tsx');
    expect(src).toContain('useStatusRemoto(');
    expect(src.match(/useStatusRemoto\(/g)?.length).toBe(1);
    expect(src).toContain('<QuadroOperacional estado={estado}');
    for (const f of TELAS.filter((x) => x !== 'src/screens/MissionControl.tsx')) {
      if (!existe(f)) continue;
      expect(conteudo(f), f).not.toMatch(/useStatusRemoto\(|setInterval|setTimeout\(|\bfetch\s*\(/);
    }
  });
});

// ------------------------------------------------------------------------- 9. LIVE × SNAPSHOT

describe('9 · LIVE e SNAPSHOT continuam separados', () => {
  it('módulo sem tarefa viva declara só a procedência do repositório; com tarefa, acrescenta a da fonte', () => {
    const semVivo = projetarModulo(moduloPorId('TESOURARIA')!, []);
    expect(semVivo.procedencias).toEqual(['REPOSITORIO']);
    const comVivo = projetarModulo(moduloPorId('MISSION_CONTROL')!, [item({ id: 'GATE:y', source: 'GATE', procedencia: 'REPOSITORIO', gateIds: ['MAPA_VIVO'] }), item({ id: 'x', gateIds: ['MC_REALTIME'] })]);
    expect(comVivo.procedencias).toEqual(['REPOSITORIO', 'GITHUB_PROJECTION']);
  });
});

// ------------------------------------------------------------------------- 10. erro de fonte

describe('10 · erro de fonte não vira zero', () => {
  it('sem leitura, as tarefas são null (não 0) e a atenção declara a ausência', () => {
    const p = panoramaConstrucao(null);
    expect(p.tarefas).toBeNull();
    const a = atencaoConstrucao(p, { leituraValida: false, indisponiveis: ['eiff-control'] });
    expect(a.map((x) => x.tipo)).toContain('SEM_LEITURA');
    expect(a.map((x) => x.tipo)).toContain('FONTE_INDISPONIVEL');
  });

  it('com leitura vazia de verdade, as tarefas são 0 e a atenção não inventa indisponibilidade', () => {
    const p = panoramaConstrucao([]);
    expect(p.tarefas?.total).toBe(0);
    expect(atencaoConstrucao(p, { leituraValida: true, indisponiveis: [] }).map((x) => x.tipo)).not.toContain('SEM_LEITURA');
  });
});

// ------------------------------------------------------------------------- 11. nada inventado

describe('11 · nenhum módulo ou task inventado por heurística', () => {
  it('todo módulo tem ao menos um componente com evidência ou gate — e nenhum cai em SEM_EVIDENCIA', () => {
    for (const mo of MODULOS_CONSTRUCAO) {
      expect(mo.componentes.some((c) => (c.gates?.length ?? 0) > 0 || (c.evidencias?.length ?? 0) > 0), mo.id).toBe(true);
      expect(projetarModulo(mo).estado, mo.id).not.toBe('SEM_EVIDENCIA');
    }
    expect(estadoDoModulo([projetarComponente({ id: 'x', titulo: 'só plano' })])).toBe('SEM_EVIDENCIA');
  });

  it('toda evidência aponta para arquivo que existe e todo símbolo está dentro do arquivo', () => {
    const faltando: string[] = [];
    for (const mo of MODULOS_CONSTRUCAO) {
      for (const c of mo.componentes) {
        for (const e of c.evidencias ?? []) {
          if (e.tipo === 'commit') continue;
          if (!existe(e.referencia)) { faltando.push(`${mo.id}/${c.id} -> ${e.referencia}`); continue; }
          if (e.simbolo && !conteudo(e.referencia).includes(e.simbolo)) faltando.push(`${mo.id}/${c.id}: "${e.simbolo}" não está em ${e.referencia}`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it('gates, frentes e dependências citados existem; dependências não formam ciclo; ids e domínios são únicos e fechados', () => {
    expect(gatesDesconhecidosNosModulos()).toEqual([]);
    const ids = MODULOS_CONSTRUCAO.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const mo of MODULOS_CONSTRUCAO) {
      expect(DOMINIOS_CONSTRUCAO).toContain(mo.dominio);
      for (const d of mo.dependeDe ?? []) expect(ids, `${mo.id} depende de ${d}`).toContain(d);
      for (const w of mo.workstreams ?? []) expect(WORKSTREAMS.map((x) => x.id), `${mo.id} frente ${w}`).toContain(w);
      const cids = mo.componentes.map((c) => c.id);
      expect(new Set(cids).size, mo.id).toBe(cids.length);
    }
    const visitando = new Set<string>(); const feito = new Set<string>();
    const visitar = (id: string): void => {
      if (feito.has(id)) return;
      expect(visitando.has(id), `ciclo em ${id}`).toBe(false);
      visitando.add(id);
      for (const d of moduloPorId(id)!.dependeDe ?? []) visitar(d);
      visitando.delete(id); feito.add(id);
    };
    for (const id of ids) visitar(id);
  });

  it('uma frente pertence a no máximo um módulo e cada gate de módulo vem do catálogo', () => {
    const frentes = MODULOS_CONSTRUCAO.flatMap((x) => x.workstreams ?? []);
    expect(new Set(frentes).size).toBe(frentes.length);
    for (const mo of MODULOS_CONSTRUCAO) for (const g of gatesDoModulo(mo)) expect(gatePorId(g), g).toBeDefined();
    expect(GATES.length).toBeGreaterThan(0);
  });

  it('o estado do componente vem do gate: fechado → concluído, bloqueado real → bloqueado, por desenho → não bloqueia o módulo', () => {
    const fechado = GATES.find((g) => g.situacao === 'fechado')!;
    const real = GATES.find((g) => g.situacao === 'bloqueado' && !g.porDesenho)!;
    const desenho = GATES.find((g) => g.situacao === 'bloqueado' && g.porDesenho)!;
    expect(projetarComponente({ id: 'a', titulo: 'a', gates: [fechado.id] }).estado).toBe('CONCLUIDO');
    expect(projetarComponente({ id: 'b', titulo: 'b', gates: [real.id] }).estado).toBe('BLOQUEADO');
    const d = projetarComponente({ id: 'c', titulo: 'c', gates: [desenho.id] });
    expect(d.estado).toBe('BLOQUEADO');
    expect(d.porDesenho).toBe(true);
    expect(estadoDoModulo([projetarComponente({ id: 'a', titulo: 'a', gates: [fechado.id] }), d])).not.toBe('BLOQUEADO');
    expect(projetarComponente({ id: 'e', titulo: 'e', evidencias: [{ tipo: 'modulo', referencia: 'src/core/engine.ts' }] }).estado).toBe('CONCLUIDO');
    expect(projetarComponente({ id: 'f', titulo: 'f' }).estado).toBe('PLANEJADO');
  });

  it('título parecido com o nome do módulo nunca vira pertença', () => {
    for (const mo of MODULOS_CONSTRUCAO) {
      expect(moduloDaTarefa(item({ id: `t:${mo.id}`, title: mo.titulo, links: { repository: 'augustocfmacedo/eiff-control' } }))).toBeUndefined();
    }
  });
});

// ------------------------------------------------------------------------- 12. read-only

describe('12 · o Mission Control continua read-only', () => {
  it('nenhuma tela do Mission Control escreve, arrasta ou fala com rede/Supabase/store', () => {
    for (const f of TELAS) {
      if (!existe(f)) continue;
      const src = conteudo(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/from '@supabase|\.\.\/data\/supabase'|from '\.\.\/data\/store'|useStore\(|actions\./);
      expect(src, f).not.toMatch(/draggable|onDrag|onDrop|api\.github\.com|Bearer /);
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
  });
});

// =====================================================================================================
// MC-CONSTRUCTION-1B — reconciliação com a main (Inbox) e guarda de cobertura do catálogo.
// O Inbox entrou na main DURANTE a MC-CONSTRUCTION-1 e não apareceu na Central: drift silencioso. A guarda
// abaixo lê o inventário REAL de superfícies (rotas da paleta e do App) em TEMPO DE TESTE e obriga decisão
// humana — nunca inferência em runtime.
// =====================================================================================================

/** Inventário de superfícies: rotas de ROTAS_NAV (Paleta.tsx) e os `case` do switch de telas do App. */
function inventarioDeSuperficies(): string[] {
  const paleta = conteudo('src/ui/Paleta.tsx');
  const app = conteudo('src/App.tsx');
  const daPaleta = [...paleta.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
  const doApp = [...app.matchAll(/^ {4}case '([a-z0-9-]+)'/gm)].map((m) => `/${m[1]}`);
  const raiz = /^ {4}case undefined:/m.test(app) ? ['/'] : [];
  return [...new Set([...daPaleta, ...doApp, ...raiz])].sort();
}

describe('13 · guarda de cobertura do catálogo (drift)', () => {
  const inventario = inventarioDeSuperficies();

  it('o inventário real tem as superfícies conhecidas, inclusive a do Inbox', () => {
    expect(inventario.length).toBeGreaterThan(20);
    expect(inventario).toContain('/atendimento');
    expect(inventario).toContain('/mission-control');
    expect(inventario).toContain('/');
  });

  it('toda superfície do EIFF está coberta por um módulo ou excluída explicitamente — senão a suíte falha com mensagem humana', () => {
    const drift = superficiesSemClassificacao(inventario);
    expect(drift, `${MENSAGEM_DRIFT_SUPERFICIE}: ${drift.join(', ')}`).toEqual([]);
  });

  it('uma superfície nova sem decisão quebra a guarda (prova de que ela funciona)', () => {
    const drift = superficiesSemClassificacao([...inventario, '/nova-superficie']);
    expect(drift).toEqual(['/nova-superficie']);
    expect(classificarSuperficie('/nova-superficie').tipo).toBe('SEM_CLASSIFICACAO');
    expect(MENSAGEM_DRIFT_SUPERFICIE).toBe('Nova superfície do EIFF sem classificação na Central de Construção');
  });

  it('nenhum módulo cobre rota que não existe; uma rota pertence a no máximo um módulo; a rota principal está entre as cobertas', () => {
    const vistas = new Map<string, string>();
    for (const mo of MODULOS_CONSTRUCAO) {
      for (const r of mo.rotas ?? []) {
        expect(inventario, `${mo.id} cobre rota inexistente ${r}`).toContain(r);
        expect(vistas.has(r), `rota ${r} coberta por ${vistas.get(r)} e ${mo.id}`).toBe(false);
        vistas.set(r, mo.id);
      }
      // a rota principal é "onde abrir": coberta pelo próprio módulo ou por outro (módulo que vive dentro de tela alheia)
      if (mo.rota) expect(classificarSuperficie(mo.rota).tipo, `${mo.id}: rota principal ${mo.rota} sem módulo`).toBe('MODULO');
    }
  });

  it('toda exclusão tem motivo, existe no inventário e não é coberta por módulo', () => {
    for (const [rota, motivo] of Object.entries(EXCLUSOES_SUPERFICIE)) {
      expect(motivo.length).toBeGreaterThan(10);
      expect(inventario, `exclusão de rota inexistente: ${rota}`).toContain(rota);
      expect(classificarSuperficie(rota).tipo).toBe('EXCLUIDA');
    }
  });

  it('a guarda vive só no teste: o domínio não lê App, Paleta nem rota em runtime', () => {
    const src = conteudo(DOMINIO_PURO);
    expect(src).not.toMatch(/from '\.\.\/\.\.\/App'|from '\.\.\/\.\.\/ui\/Paleta'|window\.location|location\.hash|readFileSync/);
    for (const f of TELAS) {
      if (!existe(f)) continue;
      expect(conteudo(f), f).not.toMatch(/superficiesSemClassificacao|classificarSuperficie|inventarioDeSuperficies/);
    }
  });
});

describe('14 · EIFF Inbox observado pela Central', () => {
  const inbox = moduloPorId('INBOX')!;
  const p = projetarModulo(inbox, []);

  it('o Inbox está no catálogo, no domínio da Central, cobrindo /atendimento', () => {
    expect(inbox).toBeDefined();
    expect(inbox.dominio).toBe('CENTRAL');
    expect(inbox.rotas).toEqual(['/atendimento']);
    expect(classificarSuperficie('/atendimento')).toEqual({ tipo: 'MODULO', moduloId: 'INBOX' });
  });

  it('o estado do Inbox é derivado: componentes com evidência concluídos, pendências declaradas como plano, módulo em construção', () => {
    expect(p.estado).toBe('EM_CONSTRUCAO');
    const comEvidencia = p.componentes.filter((c) => c.origem === 'EVIDENCIA');
    const plano = p.componentes.filter((c) => c.origem === 'PLANO');
    // main 7a0e723 (PR #14): Octopus, editor de regras e IA no servidor viraram evidência; produção e operação seguem plano
    expect(comEvidencia.map((c) => c.id)).toEqual(['DOMINIO', 'TELAS', 'PERSISTENCIA', 'INGESTAO', 'FRONTEIRAS', 'PROVAS', 'OCTOPUS_PIPELINE', 'OCTOPUS_PROVAS', 'OCTOPUS_INTEGRADO', 'IA_SERVIDOR', 'EDITOR_REGRAS']);
    expect(plano.map((c) => c.id)).toEqual(['MIGRATION_APLICADA', 'OCTOPUS_PRODUCAO', 'OCTOPUS_OPERACAO', 'ESCALACAO_SLA']);
    for (const c of plano) expect(c.estado).toBe('PLANEJADO');
    expect(p.concluidos).toBe(comEvidencia.length);
    expect(p.proximoPasso).toBe('Migration 0056 aplicada em produção');
  });

  it('nenhum componente do Inbox foi inventado: toda evidência é arquivo real do Inbox ou da Central, com símbolo presente', () => {
    for (const c of inbox.componentes) {
      for (const e of c.evidencias ?? []) {
        expect(existe(e.referencia), e.referencia).toBe(true);
        expect(e.referencia).toMatch(/inbox|Inbox|channel-meta-webhook|^src\/data\/store\.ts$/);
        if (e.simbolo) expect(conteudo(e.referencia)).toContain(e.simbolo);
      }
    }
  });

  it('as dependências do Inbox são as provadas em código (Central e plataforma) e o grafo continua sem ciclo', () => {
    expect(p.dependeDe).toEqual(['CENTRAL_WHATSAPP', 'PLATAFORMA']);
    expect(projetarModulo(moduloPorId('CENTRAL_WHATSAPP')!).dependentes).toContain('INBOX');
  });

  it('tarefa com "Inbox" no título continua sem módulo — nada é inferido', () => {
    const t = item({ id: 'GITHUB:a/b#9', status: 'EXECUTANDO', title: 'EIFF Inbox: Octopus Router', links: { repository: 'augustocfmacedo/eiff-control', branch: 'feature/eiff-inbox-octopus-router' } });
    expect(moduloDaTarefa(t)).toBeUndefined();
    expect(panoramaConstrucao([t]).tarefas?.semModulo).toBe(1);
    expect(projetarModulo(inbox, [t]).tarefas).toEqual([]);
  });

  it('as contagens da home são recalculadas com o Inbox dentro', () => {
    const pan = panoramaConstrucao(null);
    expect(pan.total).toBe(MODULOS_CONSTRUCAO.length);
    expect(pan.modulos.map((x) => x.modulo.id)).toContain('INBOX');
    expect(Object.values(pan.porEstado).reduce((a, b) => a + b, 0)).toBe(pan.total);
    expect(pan.porEstado.EM_CONSTRUCAO).toBe(pan.modulos.filter((x) => x.estado === 'EM_CONSTRUCAO').length);
    expect(pan.modulos.filter((x) => x.modulo.dominio === 'CENTRAL').map((x) => x.modulo.id)).toEqual(['CENTRAL_WHATSAPP', 'INBOX']);
  });
});

describe('15 · Inbox no Mapa Vivo: só o que está provado', () => {
  it('o nó INBOX existe na faixa da Central, sem gate e sem fonte viva', () => {
    const no = NOS.find((n) => n.id === 'INBOX')!;
    expect(no).toBeDefined();
    expect(no.dominio).toBe('CENTRAL');
    expect(no.gates).toEqual([]);
    expect(no.fonte).toBeUndefined();
    expect(noRecebeItensVivos('INBOX')).toBe(false);
    expect(itensDoNo('INBOX', [item({ id: 'x', title: 'Inbox' })])).toEqual([]);
    expect(layoutDoMapa().nos.some((n) => n.id === 'INBOX')).toBe(true);
  });

  it('exatamente duas arestas chegam ao Inbox (webhook → fluxo; Control → dependência) e nenhuma sai — zero aresta inventada', () => {
    const chegam = ARESTAS.filter((a) => a.para === 'INBOX').map((a) => `${a.de}:${a.tipo}`).sort();
    expect(chegam).toEqual(['CONTROL:dependencia', 'WEBHOOK:fluxo']);
    expect(ARESTAS.filter((a) => a.de === 'INBOX')).toEqual([]);
    const c = camadasDoMapa();
    expect(c.get('INBOX')!).toBeGreaterThan(c.get('CONTROL')!);
  });
});

// =====================================================================================================
// MC-CONSTRUCTION-1C — guarda de FRESCOR dos componentes (drift de componente).
// O PR #14 (7a0e723) implementou o Octopus Router sem abrir rota nova: a guarda de superfície não tinha como ver, e o
// catálogo ficou dizendo "planejado" sobre código que já estava na main. Aqui: todo componente planejado declara
// sinais explícitos (arquivo + símbolo) ou o motivo de não ter sinal; o TESTE confere os sinais e falha com mensagem
// humana. O domínio nunca abre arquivo e nunca reclassifica sozinho.
// =====================================================================================================

/** Um sinal "existe" quando o arquivo existe e, se houver símbolo, o símbolo está dentro dele. Só em teste. */
const sinalPresente = (e: Evidencia): boolean => existe(e.referencia) && (!e.simbolo || conteudo(e.referencia).includes(e.simbolo));
const sinaisPresentes = (c: ComponenteConstrucao): Evidencia[] => (c.sinaisDeImplementacao ?? []).filter(sinalPresente);
/** Drift de componente sobre uma lista de componentes planejados: devolve as mensagens humanas. */
const driftDeComponentes = (planejados: readonly ComponentePlanejado[]): string[] =>
  planejados.filter((p) => sinaisPresentes(p.componente).length > 0).map((p) => mensagemDriftComponente(p.componente.id));
/** Evidência positiva que deixou de existir (arquivo sumiu ou símbolo sumiu). Só em teste. */
const evidenciasAusentes = (c: ComponenteConstrucao): Evidencia[] => (c.evidencias ?? []).filter((e) => e.tipo !== 'commit' && !sinalPresente(e));

/**
 * Regressão do caso real: como os três componentes do Inbox estavam no catálogo do 1B (planejados), agora com os
 * sinais que o contrato do Octopus (eiff-inbox §13) já nomeava. Na main 7a0e723 esses sinais existem.
 */
const PLANOS_DO_1B: ComponentePlanejado[] = [
  { moduloId: 'INBOX', componente: { id: 'OCTOPUS_ROUTER', titulo: 'Octopus Router (contrato, não implementado)', sinaisDeImplementacao: [{ tipo: 'modulo', referencia: 'src/core/inbox/roteador.ts', simbolo: 'decidirRoteamento' }, { tipo: 'migration', referencia: 'supabase/migrations/0057_inbox_octopus_router.sql' }, { tipo: 'teste', referencia: 'src/core/inbox/roteador.test.ts' }] } },
  { moduloId: 'INBOX', componente: { id: 'EDITOR_REGRAS', titulo: 'Editor de regras de nível e roteamento', sinaisDeImplementacao: [{ tipo: 'modulo', referencia: 'src/screens/InboxConfig.tsx', simbolo: 'RegraRoteamento' }] } },
  { moduloId: 'INBOX', componente: { id: 'INTELIGENCIA_REAL', titulo: 'IntelligenceProvider real (função Netlify)', sinaisDeImplementacao: [{ tipo: 'modulo', referencia: 'src/core/inbox/inteligenciaLlm.ts', simbolo: 'provedorAnthropic' }] } },
];

describe('16 · guarda de frescor dos componentes (drift de componente)', () => {
  it('1 · o Octopus Router não permanece PLANEJADO: na main atual ele é implementado, provado e integrado; produção e operação seguem plano', () => {
    const p = projetarModulo(moduloPorId('INBOX')!, []);
    const estado = (id: string) => p.componentes.find((c) => c.id === id)!.estado;
    expect(estado('OCTOPUS_PIPELINE')).toBe('CONCLUIDO');
    expect(estado('OCTOPUS_PROVAS')).toBe('CONCLUIDO');
    expect(estado('OCTOPUS_INTEGRADO')).toBe('CONCLUIDO');
    expect(estado('OCTOPUS_PRODUCAO')).toBe('PLANEJADO');
    expect(estado('OCTOPUS_OPERACAO')).toBe('PLANEJADO');
    expect(p.componentes.some((c) => /contrato, não implementado/.test(c.titulo))).toBe(false);
  });

  it('2 · sinais explícitos de componente planejado provocam drift, com a mensagem humana — o caso real do PR #14', () => {
    const drift = driftDeComponentes(PLANOS_DO_1B);
    expect(drift).toEqual([
      'Componente da Central possivelmente desatualizado: OCTOPUS_ROUTER possui evidência de implementação, mas continua classificado como PLANEJADO.',
      'Componente da Central possivelmente desatualizado: EDITOR_REGRAS possui evidência de implementação, mas continua classificado como PLANEJADO.',
      'Componente da Central possivelmente desatualizado: INTELIGENCIA_REAL possui evidência de implementação, mas continua classificado como PLANEJADO.',
    ]);
  });

  it('o catálogo atual não tem drift de componente: nenhum sinal monitorado apareceu sob um PLANEJADO', () => {
    const drift = driftDeComponentes(componentesPlanejados());
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('todo componente planejado escolhe: sinais explícitos OU motivo declarado — nunca os dois, nunca nenhum', () => {
    const planejados = componentesPlanejados();
    expect(planejados.length).toBeGreaterThan(0);
    for (const { moduloId, componente: c } of planejados) {
      const temSinal = (c.sinaisDeImplementacao?.length ?? 0) > 0;
      const temMotivo = (c.semSinalPorque?.trim().length ?? 0) > 10;
      expect(temSinal !== temMotivo, `${moduloId}/${c.id}: declare sinaisDeImplementacao ou semSinalPorque (exatamente um)`).toBe(true);
    }
    // sinais só existem em componente planejado; componente com gate ou evidência não os declara
    for (const mo of MODULOS_CONSTRUCAO) for (const c of mo.componentes) {
      if ((c.gates?.length ?? 0) > 0 || (c.evidencias?.length ?? 0) > 0) {
        expect(c.sinaisDeImplementacao, `${mo.id}/${c.id}: sinal em componente que não é plano`).toBeUndefined();
        expect(c.semSinalPorque, `${mo.id}/${c.id}: motivo em componente que não é plano`).toBeUndefined();
      }
    }
  });

  it('3 · ausência dos sinais não cria implementação: sinal inexistente não acusa drift e o componente segue PLANEJADO', () => {
    const futuro: ComponentePlanejado = { moduloId: 'INBOX', componente: { id: 'FUTURO', titulo: 'Algo ainda não feito', sinaisDeImplementacao: [{ tipo: 'modulo', referencia: 'src/core/inbox/naoExisteAinda.ts', simbolo: 'nada' }, { tipo: 'modulo', referencia: 'src/core/inbox/roteador.ts', simbolo: 'simboloQueNaoExiste_1C' }] } };
    expect(driftDeComponentes([futuro])).toEqual([]);
    expect(projetarComponente(futuro.componente).estado).toBe('PLANEJADO');
  });

  it('4 · nenhuma classificação automática: sinal PRESENTE não muda o estado — só o teste acusa, a decisão é humana', () => {
    const [octopus] = PLANOS_DO_1B;
    expect(sinaisPresentes(octopus.componente).length).toBeGreaterThan(0);
    expect(projetarComponente(octopus.componente).estado).toBe('PLANEJADO');
    const src = conteudo(DOMINIO_PURO);
    expect(src).not.toMatch(/sinaisDeImplementacao\s*\.\s*(filter|some|find|map)|existsSync|readFileSync/);
  });

  it('5 · evidência de componente concluído precisa continuar existindo: ausência é detectada e o catálogo inteiro está íntegro', () => {
    const quebrado: ComponenteConstrucao = { id: 'X', titulo: 'x', evidencias: [{ tipo: 'modulo', referencia: 'src/core/inbox/roteador.ts', simbolo: 'simboloRemovido_1C' }, { tipo: 'modulo', referencia: 'src/nao/existe.ts' }] };
    expect(evidenciasAusentes(quebrado).map((e) => e.referencia)).toEqual(['src/core/inbox/roteador.ts', 'src/nao/existe.ts']);
    const ausentes = MODULOS_CONSTRUCAO.flatMap((mo) => mo.componentes.flatMap((c) => evidenciasAusentes(c).map((e) => `${mo.id}/${c.id} -> ${e.referencia}${e.simbolo ? `#${e.simbolo}` : ''}`)));
    expect(ausentes).toEqual([]);
  });

  it('6 · o Inbox continua módulo mesmo sem dado LIVE, com X/Y recalculado do catálogo', () => {
    const inbox = panoramaConstrucao(null).modulos.find((x) => x.modulo.id === 'INBOX')!;
    expect(inbox).toBeDefined();
    expect(inbox.estado).toBe('EM_CONSTRUCAO');
    expect(inbox.total).toBe(moduloPorId('INBOX')!.componentes.length);
    expect(inbox.concluidos).toBe(inbox.componentes.filter((c) => c.estado === 'CONCLUIDO').length);
    expect(`${inbox.concluidos}/${inbox.total}`).toBe('11/15');
    expect(inbox.proximoPasso).toBe('Migration 0056 aplicada em produção');
    expect(inbox.bloqueios).toEqual([]);
  });

  it('7 · tarefa com "Inbox" ou "Octopus" no título continua sem módulo', () => {
    for (const titulo of ['EIFF Inbox 3: Octopus Router', 'Octopus Router — pipeline determinístico', 'Inbox']) {
      const t = item({ id: `GITHUB:x/y#${titulo.length}`, status: 'EM_VALIDACAO', title: titulo });
      expect(moduloDaTarefa(t), titulo).toBeUndefined();
    }
  });

  it('8 · as contagens são recalculadas depois da atualização do Inbox', () => {
    const pan = panoramaConstrucao([]);
    expect(pan.total).toBe(MODULOS_CONSTRUCAO.length);
    expect(Object.values(pan.porEstado).reduce((a, b) => a + b, 0)).toBe(pan.total);
    for (const e of ESTADOS_CONSTRUCAO) expect(pan.porEstado[e]).toBe(pan.modulos.filter((x) => x.estado === e).length);
    const inbox = pan.modulos.find((x) => x.modulo.id === 'INBOX')!;
    expect(inbox.fracao).toBe(inbox.concluidos / inbox.total);
  });
});

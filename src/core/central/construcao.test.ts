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
  DOMINIOS_CONSTRUCAO, ESTADOS_CONSTRUCAO, MODULOS_CONSTRUCAO, ROTULO_ESTADO_CONSTRUCAO, SEM_MODULO, STATUS_ATIVOS,
  TONE_ESTADO_CONSTRUCAO, atencaoConstrucao, construindoAgora, estadoDoModulo, fracaoTexto, gatesDesconhecidosNosModulos,
  gatesDoModulo, moduloDaTarefa, moduloPorId, panoramaConstrucao, pctConstrucao, projetarComponente, projetarModulo,
} from './construcao';
import { GATES, WORKSTREAMS, gatePorId } from './missionControl';
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

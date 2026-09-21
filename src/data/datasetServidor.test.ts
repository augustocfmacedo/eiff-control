// EIFF Central — Wave 03 F2-DATA: provas do Dataset server-side (SELECT-only, allowlist, organizacao, paridade).
// Nenhuma rede: o cliente e um ESPIAO que registra toda cadeia (from, select, eq, in, order, limit, range, ...) e devolve
// linhas de fixture. A FIXTURE do navegador (mapeamentoDataset.test.ts) e importada DINAMICAMENTE dentro do beforeAll:
// a importacao estatica traria os `describe` daquele arquivo para esta suite (e um snapshot novo, que falha em CI).
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ALLOWLIST_DATASET, ErroCentralServidor, FORA_DO_DATASET_SERVIDOR } from '../core/central/servidorContratos';
import { catalogoDe, interpretarPedido, responderDF, type PedidoInterpretado } from '../core/cfo';
import { radarVazio } from '../core/radar/types';
import type { Dataset } from '../core/types';
import { actions, getState, pode } from './store';
import { montarDataset, type LinhasDataset, type Row } from './mapeamentoDataset';
import { BLOCO_IN, FATIAS_VAZIAS, PAGINA, PLANO_LEITURA, classificarFalha, criarCarregadorDataset, emBlocos, erroSupabase, linhasDataset } from './datasetServidor';

// ---------------------------------------------------------------------------
// Cliente-espiao
// ---------------------------------------------------------------------------
interface Metodo { nome: string; args: unknown[] }
interface Consulta { tabela: string; metodos: Metodo[] }
const SELECT_ONLY = new Set(['from', 'select', 'eq', 'in', 'order', 'limit', 'range']);
const MUTADORES = ['insert', 'upsert', 'update', 'delete', 'rpc'];

/** Honra `eq`/`in` sobre a fixture (linha sem a coluna passa: a fixture do navegador omite organization_id em algumas). */
function clienteEspiao(fixture: Record<string, Row[]>, falha?: (tabela: string) => { error: unknown; status: number } | Error | undefined) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const consulta: Consulta = { tabela, metodos: [{ nome: 'from', args: [tabela] }] };
    consultas.push(consulta);
    let linhas = fixture[tabela] ?? [];
    let de = 0; let ate = Infinity;
    const q: Record<string, unknown> = {};
    const registrar = (nome: string, ...args: unknown[]) => { consulta.metodos.push({ nome, args }); return q; };
    q.select = (...a: unknown[]) => registrar('select', ...a);
    q.eq = (col: string, v: unknown) => { linhas = linhas.filter((r) => r[col] === undefined || r[col] === v); return registrar('eq', col, v); };
    q.in = (col: string, vals: unknown[]) => { linhas = linhas.filter((r) => r[col] === undefined || vals.includes(r[col])); return registrar('in', col, vals); };
    q.order = (...a: unknown[]) => registrar('order', ...a);
    q.limit = (n: number) => { ate = de + n; return registrar('limit', n); };
    q.range = (a: number, b: number) => { de = a; ate = b + 1; return registrar('range', a, b); };
    for (const m of MUTADORES) q[m] = (...a: unknown[]) => registrar(m, ...a);
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const f = falha?.(tabela);
      if (f instanceof Error) return Promise.reject(f).then(res, rej);
      if (f) return Promise.resolve({ data: null, ...f }).then(res, rej);
      return Promise.resolve({ data: linhas.slice(de, ate), error: null, status: 200 }).then(res, rej);
    };
    return q;
  };
  const rpc = (...a: unknown[]) => { consultas.push({ tabela: '<rpc>', metodos: [{ nome: 'rpc', args: a }] }); return Promise.resolve({ data: null, error: null }); };
  return { cliente: { from, rpc } as unknown as SupabaseClient, consultas };
}
const nomesUsados = (consultas: Consulta[]) => new Set(consultas.flatMap((c) => c.metodos.map((m) => m.nome)));

// ---------------------------------------------------------------------------
// Fixture do navegador, carregada sem trazer a suite dela
// ---------------------------------------------------------------------------
let FIXTURE: Record<string, Row[]> = {};
beforeAll(async () => {
  const m = await import('./mapeamentoDataset.test');
  FIXTURE = m.FIXTURE as Record<string, Row[]>;
});
const ORG = '00000000-0000-4000-8000-00000000000a';

describe('datasetServidor: SELECT-only sobre a allowlist', () => {
  it('(a) so from/select/eq/in/order/limit/range — nunca insert, upsert, update, delete ou rpc', async () => {
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    await criarCarregadorDataset(cliente)(ORG);
    const usados = nomesUsados(consultas);
    for (const n of usados) expect(SELECT_ONLY.has(n), `metodo fora do SELECT-only: ${n}`).toBe(true);
    for (const m of MUTADORES) expect(usados.has(m)).toBe(false);
    expect(consultas.some((c) => c.tabela === '<rpc>')).toBe(false);
    // e cada consulta comeca por select('*')
    for (const c of consultas) expect(c.metodos[1], c.tabela).toEqual({ nome: 'select', args: ['*'] });
  });

  it('(b) toda tabela raiz leva eq(colunaOrganizacao ?? organization_id, organizationId) como PRIMEIRO filtro', async () => {
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    await criarCarregadorDataset(cliente)(ORG);
    const raizes = ALLOWLIST_DATASET.filter((e) => e.raiz);
    expect(raizes.length).toBeGreaterThan(0);
    for (const e of raizes) {
      const minhas = consultas.filter((c) => c.tabela === e.tabela);
      expect(minhas.length, `raiz ${e.tabela} nao foi consultada`).toBeGreaterThan(0);
      for (const c of minhas) expect(c.metodos[2], e.tabela).toEqual({ nome: 'eq', args: [e.colunaOrganizacao ?? 'organization_id', ORG] });
    }
    expect(consultas.find((c) => c.tabela === 'organization')!.metodos[2]).toEqual({ nome: 'eq', args: ['id', ORG] });
  });

  it('(c) toda filha e consultada SOMENTE por in(pai.coluna, ids) com os ids das linhas devolvidas do pai', async () => {
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    await criarCarregadorDataset(cliente)(ORG);
    const filhas = ALLOWLIST_DATASET.filter((e) => !e.raiz);
    expect(filhas.length).toBeGreaterThan(0);
    for (const e of filhas) {
      const idsPai = new Set((FIXTURE[e.pai!.tabela] ?? []).map((r) => r.id));
      const minhas = consultas.filter((c) => c.tabela === e.tabela);
      if (idsPai.size === 0) { expect(minhas, `${e.tabela}: pai vazio nao consulta a filha`).toHaveLength(0); continue; }
      expect(minhas.length, `filha ${e.tabela} nao foi consultada`).toBeGreaterThan(0);
      const idsUsados = new Set<string>();
      for (const c of minhas) {
        const primeiro = c.metodos[2];
        expect(primeiro.nome, `${e.tabela}: o primeiro filtro tem de ser in(${e.pai!.coluna})`).toBe('in');
        expect(primeiro.args[0]).toBe(e.pai!.coluna);
        for (const id of primeiro.args[1] as string[]) { expect(idsPai.has(id), `${e.tabela}: id ${id} nao veio do pai`).toBe(true); idsUsados.add(id); }
        // nenhuma filha e filtrada por organizacao (ela nao tem a coluna): so pelo pai
        expect(c.metodos.some((m) => m.nome === 'eq' && m.args[0] === 'organization_id')).toBe(false);
      }
      expect(idsUsados).toEqual(idsPai);
    }
  });

  it('(d) nenhuma tabela fora da allowlist e consultada; as fatias correspondentes chegam vazias', async () => {
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    const ds = await criarCarregadorDataset(cliente)(ORG);
    const permitidas = new Set(ALLOWLIST_DATASET.map((e) => e.tabela));
    for (const c of consultas) expect(permitidas.has(c.tabela), `tabela fora da allowlist: ${c.tabela}`).toBe(true);
    for (const t of FORA_DO_DATASET_SERVIDOR) expect(consultas.some((c) => c.tabela === t), t).toBe(false);
    // a fixture TEM linhas nessas tabelas; o servidor nao as le
    expect(ds.auditoria).toEqual([]); expect(ds.comentarios).toEqual([]); expect(ds.tarefas).toEqual([]); expect(ds.colaboradores).toEqual([]);
    expect(ds.apontamentos).toEqual([]); expect(ds.apontamentosEstacao).toEqual([]); expect(ds.romaneios).toEqual([]); expect(ds.itensEstoque).toEqual([]);
    expect(ds.movimentosEstoque).toEqual([]); expect(ds.insumos).toEqual([]); expect(ds.composicoes).toEqual([]); expect(ds.orcamentos).toEqual([]);
    expect(ds.treinamentos).toEqual([]); expect(ds.fotos).toEqual([]); expect(ds.funcoes).toEqual([]); expect(ds.alocacoes).toEqual([]);
    expect(ds.radar).toEqual(radarVazio());
    // e as tabelas da allowlist chegaram
    expect(ds.pedidos).toHaveLength(1); expect(ds.conjuntos).toHaveLength(1); expect(ds.avancos).toHaveLength(1); expect(ds.medicoes).toHaveLength(1);
  });

  it('o plano de leitura cobre exatamente a allowlist e o resto de LinhasDataset fica vazio', () => {
    expect(Object.keys(PLANO_LEITURA).sort()).toEqual(ALLOWLIST_DATASET.map((e) => e.tabela).sort());
    const l = linhasDataset(new Map());
    const chavesPlano = new Set(Object.values(PLANO_LEITURA).map((p) => p.chave));
    for (const k of Object.keys(l) as (keyof LinhasDataset)[]) {
      expect(l[k]).toEqual([]);
      expect(chavesPlano.has(k) || FATIAS_VAZIAS.includes(k), `fatia ${k} sem origem`).toBe(true);
    }
    // filtros/ordens do navegador replicados nas tabelas mais sensiveis
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    return criarCarregadorDataset(cliente)(ORG).then(() => {
      const metodos = (t: string) => consultas.find((c) => c.tabela === t)!.metodos.map((m) => `${m.nome}(${m.args.map((a) => JSON.stringify(a)).join(',')})`);
      expect(metodos('parameter_set')).toEqual(['from("parameter_set")', 'select("*")', `eq("organization_id","${ORG}")`, 'eq("active",true)', 'limit(1)']);
      expect(metodos('settlement').slice(3)).toEqual(['eq("reversed",false)', 'order("settled_on")', 'order("id")', `range(0,${PAGINA - 1})`]);
      expect(metodos('bank_transaction').slice(3)).toEqual(['order("transaction_date",{"ascending":false})', 'order("id")', `range(0,${PAGINA - 1})`]);
      expect(metodos('measurement').slice(3)).toEqual(['order("month_no")', 'order("number")', 'order("id")', `range(0,${PAGINA - 1})`]);
      expect(metodos('chart_account').slice(3)).toEqual(['order("category")', 'order("id")', `range(0,${PAGINA - 1})`]);
    });
  });

  it('pagina de PAGINA em PAGINA com range e parte os ids do pai em blocos de BLOCO_IN', async () => {
    const perfis = Array.from({ length: 450 }, (_, i) => ({ id: `p-${i}`, organization_id: ORG, name: `P${i}`, email: `p${i}@x`, role: 'Financeiro', active: true }));
    const lancs = Array.from({ length: 2500 }, (_, i) => ({ ...FIXTURE.financial_entry[0], id: `l-${i}`, code: `L-${String(i).padStart(5, '0')}` }));
    const { cliente, consultas } = clienteEspiao({ ...FIXTURE, profile: perfis, financial_entry: lancs, settlement: [] });
    const ds = await criarCarregadorDataset(cliente)(ORG);
    expect(ds.lancamentos).toHaveLength(2500);
    expect(ds.usuarios).toHaveLength(450);
    const paginas = consultas.filter((c) => c.tabela === 'financial_entry').map((c) => c.metodos.find((m) => m.nome === 'range')!.args);
    expect(paginas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    const blocos = consultas.filter((c) => c.tabela === 'user_scope').map((c) => (c.metodos[2].args[1] as string[]).length);
    expect(blocos).toEqual([BLOCO_IN, BLOCO_IN, 50]);
    expect(emBlocos([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(emBlocos([])).toEqual([]);
  });

  it('(e) organizationId vazio ou invalido: erro deterministico organizacao_ausente SEM nenhuma consulta', async () => {
    for (const org of ['', '   ', 'abc', 'org-eiff', '00000000-0000-4000-8000-00000000000'] ) {
      const { cliente, consultas } = clienteEspiao(FIXTURE);
      await expect(criarCarregadorDataset(cliente)(org), JSON.stringify(org)).rejects.toMatchObject({ codigo: 'organizacao_ausente', classe: 'deterministico' });
      expect(consultas, JSON.stringify(org)).toHaveLength(0);
    }
    // undefined/null em chamada dinamica tambem fecham
    const { cliente, consultas } = clienteEspiao(FIXTURE);
    await expect(criarCarregadorDataset(cliente)(undefined as never)).rejects.toBeInstanceOf(ErroCentralServidor);
    expect(consultas).toHaveLength(0);
  });

  it('organizacao que nao existe no banco: organizacao_desconhecida (deterministico), nunca um Dataset de outra organizacao', async () => {
    const { cliente } = clienteEspiao(FIXTURE);
    const outra = '11111111-1111-4111-8111-111111111111';
    await expect(criarCarregadorDataset(cliente)(outra)).rejects.toMatchObject({ codigo: 'organizacao_desconhecida', classe: 'deterministico' });
    const semEmpresa = clienteEspiao({ ...FIXTURE, company: [] });
    await expect(criarCarregadorDataset(semEmpresa.cliente)(ORG)).rejects.toMatchObject({ codigo: 'organizacao_desconhecida' });
  });

  it('falha do PostgREST vira ErroCentralServidor classificado, sem dados na mensagem', async () => {
    const rede = clienteEspiao(FIXTURE, (t) => (t === 'financial_entry' ? { error: { message: 'TypeError: fetch failed', code: '' }, status: 0 } : undefined));
    await expect(criarCarregadorDataset(rede.cliente)(ORG)).rejects.toMatchObject({ codigo: 'ler_financial_entry', classe: 'transitorio' });
    const excecao = clienteEspiao(FIXTURE, (t) => (t === 'project' ? new TypeError('fetch failed') : undefined));
    await expect(criarCarregadorDataset(excecao.cliente)(ORG)).rejects.toMatchObject({ codigo: 'ler_project', classe: 'transitorio' });
    const permissao = clienteEspiao(FIXTURE, (t) => (t === 'debt' ? { error: { message: 'permission denied for table debt', code: '42501', details: `org ${ORG}` }, status: 403 } : undefined));
    const e = (await criarCarregadorDataset(permissao.cliente)(ORG).catch((x) => x as ErroCentralServidor)) as ErroCentralServidor;
    expect(e).toMatchObject({ codigo: 'ler_debt', classe: 'deterministico' });
    expect(e.message).not.toContain(ORG);
    expect(e.message).not.toContain('permission denied');
  });

  it('classificarFalha: rede/timeout/5xx/ininteligivel transitorio; 23505/23503/23514/P0001/4xx deterministico', () => {
    expect(classificarFalha({ code: '', status: 0 })).toBe('transitorio');
    expect(classificarFalha({ status: 503 })).toBe('transitorio');
    expect(classificarFalha({ code: 'PGRST001', status: 503 })).toBe('transitorio');
    expect(classificarFalha({ code: '57014' })).toBe('transitorio'); // statement timeout
    expect(classificarFalha({ code: '08006' })).toBe('transitorio'); // conexao caiu
    expect(classificarFalha({ code: '40001' })).toBe('transitorio'); // serializacao
    expect(classificarFalha(new TypeError('fetch failed'))).toBe('transitorio');
    expect(classificarFalha(undefined)).toBe('transitorio');
    expect(classificarFalha({})).toBe('transitorio');
    for (const code of ['23505', '23503', '23514', 'P0001', '42P01', '22P02']) expect(classificarFalha({ code, status: 409 }), code).toBe('deterministico');
    expect(classificarFalha({ code: 'PGRST102', status: 400 })).toBe('deterministico');
    expect(classificarFalha({ status: 404 })).toBe('deterministico');
    const e = erroSupabase('x', { code: '23505', status: 409, message: 'duplicate key (phone)=(5562988887777)' });
    expect(e).toBeInstanceOf(ErroCentralServidor);
    expect(e.message).toBe('x (deterministico; code=23505 status=409)');
    expect(erroSupabase('y', e)).toBe(e);
  });
});

// ---------------------------------------------------------------------------
// (g) paridade com o navegador: as mesmas linhas da fixture montam as mesmas fatias financeiras
// ---------------------------------------------------------------------------
describe('datasetServidor: paridade com o snapshot do navegador', () => {
  it('as fatias financeiras do Dataset do servidor sao identicas as do montarDataset com a fixture inteira', async () => {
    const { cliente } = clienteEspiao(FIXTURE);
    const servidor = await criarCarregadorDataset(cliente)(ORG);
    // o navegador: todas as tabelas da fixture (mapeamentoDataset.test.ts prova que isto == carregarRemoto original)
    const linhas = linhasDataset(new Map(Object.entries(FIXTURE)));
    const chavePorTabela: Record<string, keyof LinhasDataset> = { comment: 'coms', task: 'tasks', audit_log: 'audit', worker: 'workers', timesheet: 'timesheets', timesheet_line: 'tsLines', timesheet_output: 'tsOutputs', timesheet_incident: 'tsIncidents', station_log: 'estacaoRows', shipment: 'romaneioRows', stock_item: 'stockItems', stock_movement: 'stockMovs', training_progress: 'trainingRows', field_photo: 'fotoRows', job_function: 'funcRows', worker_allocation: 'alocRows', catalog_input: 'insumosRows', catalog_composition: 'compRows', catalog_composition_item: 'compItens', estimate: 'estRows', estimate_item: 'estItens' };
    for (const [t, k] of Object.entries(chavePorTabela)) linhas[k] = FIXTURE[t] ?? [];
    const navegador = montarDataset(linhas).ds;
    const j = (v: unknown) => JSON.parse(JSON.stringify(v));
    for (const fatia of ['lancamentos', 'contas', 'params', 'obras', 'liquidacoes', 'transacoes', 'aprovacoes', 'usuarios', 'planoContas', 'dividas', 'fechamentos', 'servicos', 'demandas', 'ordens', 'medicoes', 'pedidos', 'conjuntos', 'avancos'] as const) {
      expect(j(servidor[fatia]), fatia).toEqual(j(navegador[fatia]));
    }
    expect(servidor.lancamentos).toHaveLength(2);
    expect(servidor.usuarios.find((u) => u.papel === 'Gestor de obra')!.obras).toEqual(['OB-01']);
  });
});

// ---------------------------------------------------------------------------
// (f) paridade do CFO: o parecer nao muda quando as fatias fora da allowlist ficam vazias
// ---------------------------------------------------------------------------
describe('datasetServidor: paridade do Diretor Financeiro com o Dataset reduzido a allowlist', () => {
  const reduzir = (ds: Dataset): Dataset => ({
    ...ds,
    auditoria: [], comentarios: [], tarefas: [], colaboradores: [], apontamentos: [], apontamentosEstacao: [], romaneios: [],
    itensEstoque: [], movimentosEstoque: [], insumos: [], composicoes: [], orcamentos: [], treinamentos: [], fotos: [], funcoes: [], alocacoes: [],
    radar: radarVazio(),
  });
  const PEDIDOS = [
    'preciso pagar um frete de R$ 500 amanhã para a Transportadora X, obra Smart Fit',
    'como está o caixa hoje?',
    'o que vence esta semana?',
    'como estão meus pedidos pendentes de alinhamento?',
    'ajuda',
    'quero comprar aço, uns R$ 12.000 dia 30',
  ];
  it('responderDF devolve textos identicos para os dois lados com o Dataset completo e com o reduzido', () => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    const completo = getState().ds;
    const reduzido = reduzir(completo);
    const catalogo = catalogoDe(completo);
    expect(catalogoDe(reduzido)).toEqual(catalogo);
    const intencoes = new Set<string>();
    for (const id of ['u-admin', 'u-obra']) {
      actions.trocarUsuario(id);
      const usuario = getState().usuario;
      const veCaixa = pode(usuario, 'ver_bancos');
      for (const texto of PEDIDOS) {
        const pedido: PedidoInterpretado = interpretarPedido(texto, catalogo);
        intencoes.add(pedido.intencao);
        const a = responderDF(completo, usuario, pedido, veCaixa);
        const b = responderDF(reduzido, usuario, pedido, veCaixa);
        expect(b.texto, `${id}: ${texto}`).toBe(a.texto);
        expect(JSON.parse(JSON.stringify(b)), `${id}: ${texto}`).toEqual(JSON.parse(JSON.stringify(a)));
      }
    }
    for (const i of ['pagamento', 'consulta_caixa', 'vencimentos', 'previsoes', 'ajuda']) expect([...intencoes], i).toContain(i);
    expect(pode(getState().ds.usuarios.find((u) => u.id === 'u-obra')!, 'ver_bancos')).toBe(false);
    expect(pode(getState().ds.usuarios.find((u) => u.id === 'u-admin')!, 'ver_bancos')).toBe(true);
  });
});

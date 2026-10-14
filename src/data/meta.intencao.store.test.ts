// CD-D3/E5 (E5-REL-01) — idempotência por intenção pelo caminho REAL do store: identificador estável, diário local
// gravado antes do envio, resposta perdida, app fechado logo depois da RPC e reabertura.
//
// O banco é simulado com a regra da 0074 (testada de verdade em scripts/pg-smoke-meta-intencao.mjs e em PostgreSQL
// 17.6): intenção repetida devolve o resultado original; conteúdo diferente recusa; intenção nova exige a versão base
// igual à vigente; mesmo valor não cria versão. O envio usa a MESMA montagem de chamada do app (`chamadaDaMeta`).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../core/types';
import type { VersaoMetaComercial } from '../core/radar';

type Intencao = { mes: string; valor: number | null; motivo: string; base: number; resultado: { versao: number; alterado: boolean } };
const sim = vi.hoisted(() => ({
  versoes: new Map<string, { versao: number; valor: number | null; motivo: string }[]>(),
  intencoes: new Map<string, Intencao>(),
  chamadas: [] as string[],
  roteiro: [] as ('ok' | 'resposta_perdida' | 'falha_depois')[],
  pendente: null as null | { usuarioId: string; base: Dataset; ds: Dataset; em: string },
  diario: null as null | { usuarioId: string; intencoes: { id: string; intencao?: string }[] },
  diarioNoEnvio: [] as number[],
  remoto: null as null | Dataset,
}));

/** O banco da 0074 (RPC por intenção sobre a regra da 0068). */
function bancoRpc(nome: string, a: Record<string, unknown>): Record<string, unknown> {
  const mes = String(a.p_mes).slice(0, 7);
  const lista = sim.versoes.get(mes) ?? [];
  const vigente = () => lista.at(-1);
  const aplicar = () => {
    const v = vigente(); const valor = a.p_valor as number | null;
    if (v && v.valor === valor) return { alterado: false, versao: v.versao };
    lista.push({ versao: lista.length + 1, valor, motivo: String(a.p_motivo) }); sim.versoes.set(mes, lista);
    return { alterado: true, versao: lista.length };
  };
  if (nome === 'radar_definir_meta_comercial') { sim.chamadas.push(`legado ${mes}=${a.p_valor}`); return aplicar(); }
  const id = String(a.p_intencao);
  const ja = sim.intencoes.get(id);
  if (ja) {
    if (ja.mes !== mes || ja.valor !== a.p_valor || ja.motivo !== a.p_motivo || ja.base !== a.p_versao_base) throw new Error('meta comercial: esta intenção já foi usada com outro conteúdo; nada foi alterado');
    sim.chamadas.push(`repetida ${mes}=${a.p_valor}`);
    return { ...ja.resultado, repetida: true };
  }
  if ((vigente()?.versao ?? 0) !== a.p_versao_base) throw new Error(`meta comercial: a meta mudou em outra sessão (versão atual ${vigente()?.versao ?? 0}, a decisão partiu da versão ${a.p_versao_base})`);
  const resultado = aplicar();
  sim.intencoes.set(id, { mes, valor: a.p_valor as number | null, motivo: String(a.p_motivo), base: Number(a.p_versao_base), resultado });
  sim.chamadas.push(`nova ${mes}=${a.p_valor}`);
  return { ...resultado, repetida: false };
}
/** Outra sessão define a meta direto no banco (intenção própria, com a base certa). */
function outraSessao(mes: string, valor: number | null) {
  bancoRpc('radar_definir_meta_comercial_intencao', { p_intencao: `outra-${Math.random()}`, p_mes: `${mes}-01`, p_valor: valor, p_motivo: 'outra sessão', p_versao_base: (sim.versoes.get(mes) ?? []).length });
  sim.chamadas.pop(); // `chamadas` registra só o que ESTE app enviou
}

vi.mock('./supabase', async (original) => {
  const real = await original<typeof import('./supabase')>();
  const { chamadaDaMeta } = await import('./radar.supabase');
  return {
    ...real,
    remotoAtivo: true,
    remotoPronto: () => true,
    sessaoAtual: async () => ({ userId: 'u-admin', email: 'admin@eiff.test' }),
    aoMudarSessao: () => () => undefined,
    precisaTrocarSenha: async () => false,
    carregarRemoto: async () => ({ ds: JSON.parse(JSON.stringify(sim.remoto)), usuario: sim.remoto!.usuarios.find((u) => u.id === 'u-admin')! }),
    aplicarIntencaoMeta: async (m: VersaoMetaComercial) => { const [rpc, args] = chamadaDaMeta(m); return bancoRpc(rpc, args); },
    persistirRemoto: async (antes: Dataset, depois: Dataset, _ator: string, opcoes: { aoGravarMeta?: (m: VersaoMetaComercial) => void } = {}) => {
      sim.diarioNoEnvio.push(sim.diario?.intencoes.length ?? 0);
      const ja = new Set((antes.radar.metasComerciais ?? []).map((m) => m.id));
      const novas = (depois.radar.metasComerciais ?? []).filter((m) => !ja.has(m.id));
      const passo = sim.roteiro.shift() ?? 'ok';
      for (const m of novas) {
        const [rpc, args] = chamadaDaMeta(m);
        bancoRpc(rpc, args); // a RPC faz COMMIT
        if (passo === 'resposta_perdida') throw new TypeError('Failed to fetch'); // ... e a resposta se perde
        opcoes.aoGravarMeta?.(m);
      }
      if (passo === 'falha_depois') throw new Error('inserir inbox_thread: violates row-level security policy');
    },
  };
});
vi.mock('./offline', () => ({
  apagarPendente: async () => { sim.pendente = null; },
  guardarCache: async () => undefined,
  lerCache: async () => null,
  guardarPendente: async (p: typeof sim.pendente) => { sim.pendente = JSON.parse(JSON.stringify(p)); },
  lerPendente: async () => (sim.pendente ? JSON.parse(JSON.stringify(sim.pendente)) : undefined),
  guardarIntencoesMeta: async (d: typeof sim.diario) => { sim.diario = JSON.parse(JSON.stringify(d)); },
  lerIntencoesMeta: async () => (sim.diario ? JSON.parse(JSON.stringify(sim.diario)) : null),
  apagarIntencoesMeta: async () => { sim.diario = null; },
}));

const { actions, getState, inicializar } = await import('./store');
const { mesComercialDe, mesSeguinte } = await import('../core/radar');
const seed = (await import('./seed.json')).default as unknown as Dataset;
const mes = mesSeguinte(mesComercialDe(new Date().toISOString())!);
const noBanco = () => (sim.versoes.get(mes) ?? []).map((v) => [v.versao, v.valor]);
/** o remoto que o app recarrega reflete o banco simulado (versões do mês, como linhas persistidas) */
function remotoDoBanco(): Dataset {
  const base = JSON.parse(JSON.stringify(seed)) as Dataset;
  const metas = (sim.versoes.get(mes) ?? []).map((v) => ({ id: `uuid-${v.versao}`, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor: v.valor === null ? null : v.valor.toFixed(2), versao: v.versao, motivo: v.motivo, definidaPor: 'u-admin', definidaEm: new Date().toISOString() }));
  return { ...base, radar: { ...base.radar, metasComerciais: metas as VersaoMetaComercial[], desfechos: [] } };
}
async function abrirApp() { sim.remoto = remotoDoBanco(); await actions.recarregar(); await actions.aguardarSincronizacao(); }

beforeEach(async () => {
  sim.versoes.clear(); sim.intencoes.clear(); sim.chamadas.length = 0; sim.roteiro.length = 0; sim.pendente = null; sim.diario = null; sim.diarioNoEnvio.length = 0;
  sim.remoto = remotoDoBanco();
  await inicializar();
  await abrirApp();
  sim.chamadas.length = 0; sim.diarioNoEnvio.length = 0;
});

describe('E5-REL-01 · identificador estável da intenção', () => {
  it('a ação canônica gera um identificador por decisão e a versão base em que ela se apoiou', async () => {
    const a = actions.definirMetaComercialRadar(mes, 100000, 'primeira') as VersaoMetaComercial & { intencao?: string; versaoBase?: number };
    await actions.aguardarSincronizacao();
    expect(a.intencao).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.versaoBase).toBe(0);
  });

  it('o diário local recebe a intenção ANTES do envio e é limpo quando o banco aceita', async () => {
    actions.definirMetaComercialRadar(mes, 100000, 'primeira');
    await actions.aguardarSincronizacao();
    expect(sim.diarioNoEnvio).toEqual([1]);
    expect(sim.diario).toBeNull();
    expect(sim.chamadas).toEqual([`nova ${mes}=100000`]);
  });
});

describe('E5-REL-01 · RPC fez COMMIT e a resposta se perdeu', () => {
  it('outra sessão muda a meta antes do reenvio: o reenvio devolve o resultado original e NÃO restaura o valor antigo', async () => {
    sim.roteiro.push('resposta_perdida');
    actions.definirMetaComercialRadar(mes, 250000, 'meta aprovada');
    expect((await actions.aguardarSincronizacao()).status).toBe('pendente');
    expect(noBanco()).toEqual([[1, 250000]]); // a RPC fez COMMIT
    outraSessao(mes, 300000);
    sim.roteiro.push('ok');
    actions.tentarNovamente();
    expect((await actions.aguardarSincronizacao()).status).toBe('ok');
    expect(sim.chamadas).toEqual([`nova ${mes}=250000`, `repetida ${mes}=250000`]);
    expect(noBanco()).toEqual([[1, 250000], [2, 300000]]); // a versão mais recente (300.000) segue valendo
  });

  it('reabertura com a pendência offline: o reenvio da intenção não duplica', async () => {
    sim.roteiro.push('resposta_perdida');
    actions.definirMetaComercialRadar(mes, 180000, 'meta do mês');
    await actions.aguardarSincronizacao();
    sim.roteiro.push('ok');
    await abrirApp();
    expect(noBanco()).toEqual([[1, 180000]]);
    expect(sim.chamadas.filter((c) => c.startsWith('nova'))).toEqual([`nova ${mes}=180000`]);
  });
});

describe('E5-REL-01 · app encerrado logo depois da RPC', () => {
  it('reabertura recupera a intenção do diário e não duplica a alteração', async () => {
    sim.roteiro.push('resposta_perdida');
    actions.definirMetaComercialRadar(mes, 210000, 'meta aprovada');
    await actions.aguardarSincronizacao();
    sim.pendente = null; // o app fechou antes de gravar a pendência: só o diário (gravado ANTES do envio) sobrou
    expect(sim.diario?.intencoes).toHaveLength(1);
    await abrirApp();
    expect(sim.chamadas).toEqual([`nova ${mes}=210000`, `repetida ${mes}=210000`]);
    expect(noBanco()).toEqual([[1, 210000]]);
    expect(sim.diario).toBeNull();
    expect(getState().ds.radar.metasComerciais!.filter((m) => m.mes === mes).map((m) => m.versao)).toEqual([1]);
  });

  it('app fechou ANTES da RPC: a reabertura aplica a intenção uma vez', async () => {
    // a intenção entra no diário e a rede cai antes de chegar ao banco
    sim.roteiro.push('ok');
    const antes = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
    actions.definirMetaComercialRadar(mes, 90000, 'meta offline');
    await actions.aguardarSincronizacao();
    // reconstrói o cenário: o banco ainda não viu a intenção
    sim.versoes.clear(); sim.intencoes.clear(); sim.chamadas.length = 0;
    const m = getState().ds.radar.metasComerciais!.find((x) => x.mes === mes)!;
    sim.diario = { usuarioId: 'u-admin', intencoes: [m as never] }; sim.pendente = null; void antes;
    await abrirApp();
    expect(sim.chamadas).toEqual([`nova ${mes}=90000`]);
    expect(noBanco()).toEqual([[1, 90000]]);
  });

  it('intenção do diário baseada em versão velha (outra sessão decidiu antes): recusada, aviso, nada criado', async () => {
    sim.roteiro.push('ok');
    actions.definirMetaComercialRadar(mes, 90000, 'decisão antiga');
    await actions.aguardarSincronizacao();
    const m = getState().ds.radar.metasComerciais!.find((x) => x.mes === mes)!;
    sim.versoes.clear(); sim.intencoes.clear(); sim.chamadas.length = 0;
    outraSessao(mes, 400000); // a outra sessão decidiu primeiro (v1)
    sim.diario = { usuarioId: 'u-admin', intencoes: [m as never] }; sim.pendente = null;
    await abrirApp();
    expect(noBanco()).toEqual([[1, 400000]]);
    expect(getState().sync).toMatchObject({ status: 'erro' });
    expect(getState().sync.msg).toMatch(/não reaplicada: .*mudou em outra sessão/);
    expect(sim.diario).toBeNull();
  });
});

describe('E5-REL-01 · nova decisão e retomada', () => {
  it('nova decisão explícita depois da confirmada gera versão legítima (base = a vigente)', async () => {
    actions.definirMetaComercialRadar(mes, 100000, 'primeira');
    await actions.aguardarSincronizacao();
    await abrirApp();
    const b = actions.definirMetaComercialRadar(mes, 140000, 'revisão') as VersaoMetaComercial & { versaoBase?: number };
    expect(b.versaoBase).toBe(1);
    await actions.aguardarSincronizacao();
    expect(noBanco()).toEqual([[1, 100000], [2, 140000]]);
  });

  it('falha posterior + Tentar de novo: a meta aceita não é reenviada (nem como repetida)', async () => {
    sim.roteiro.push('falha_depois', 'ok');
    actions.definirMetaComercialRadar(mes, 260000, 'meta aprovada');
    expect((await actions.aguardarSincronizacao()).status).toBe('erro');
    actions.tentarNovamente();
    await actions.aguardarSincronizacao();
    expect(sim.chamadas).toEqual([`nova ${mes}=260000`]);
    expect(sim.diario).toBeNull();
  });
});

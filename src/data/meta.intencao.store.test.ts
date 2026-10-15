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
  diarioFalha: false, diarioRecusa: false,
  /** como a próxima reaplicação do diário falha: erro com SQLSTATE, 'rede' ou nada */
  falhaAplicar: [] as ({ message: string; code?: string } | 'rede')[],
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
    if (ja.mes !== mes || ja.valor !== a.p_valor || ja.motivo !== a.p_motivo || ja.base !== a.p_versao_base) throw Object.assign(new Error('meta comercial: esta intenção já foi usada com outro conteúdo; nada foi alterado'), { code: '23505' });
    sim.chamadas.push(`repetida ${mes}=${a.p_valor}`);
    return { ...ja.resultado, repetida: true };
  }
  if ((vigente()?.versao ?? 0) !== a.p_versao_base) throw Object.assign(new Error(`meta comercial: a meta mudou em outra sessão (versão atual ${vigente()?.versao ?? 0}, a decisão partiu da versão ${a.p_versao_base})`), { code: '40001' });
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
    aplicarIntencaoMeta: async (m: VersaoMetaComercial) => {
      const f = sim.falhaAplicar.shift();
      if (f === 'rede') throw new TypeError('Failed to fetch');
      if (f) throw Object.assign(new Error('rpc radar_definir_meta_comercial_intencao: ' + f.message), f.code ? { code: f.code } : {});
      const [rpc, args] = chamadaDaMeta(m);
      try { return bancoRpc(rpc, args); } catch (e) { throw Object.assign(new Error('rpc ' + rpc + ': ' + (e as Error).message), { code: (e as { code?: string }).code }); }
    },
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
  guardarIntencoesMeta: async (d: typeof sim.diario) => { if (sim.diarioFalha) throw new Error('IndexedDB indisponível'); if (sim.diarioRecusa) return false; sim.diario = JSON.parse(JSON.stringify(d)); return true; },
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
  sim.versoes.clear(); sim.intencoes.clear(); sim.chamadas.length = 0; sim.roteiro.length = 0; sim.pendente = null; sim.diario = null; sim.diarioNoEnvio.length = 0; sim.diarioFalha = false; sim.diarioRecusa = false; sim.falhaAplicar.length = 0;
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

// =====================================================================================================================
// Ajustes finais (E5-REL-01): os três cenários
// =====================================================================================================================
const { chamadaDaMeta } = await import('./radar.supabase');
const { comIntencao, recusaDefinitivaMeta } = await import('./metaConfirmada');
const local = (p: Partial<VersaoMetaComercial & { intencao?: string; versaoBase?: number }> = {}) =>
  ({ id: 'META-0007', mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor: 250000, versao: 1, motivo: 'meta antiga', definidaPor: 'u-admin', definidaEm: '2026-10-01T12:00:00.000Z', ...p }) as VersaoMetaComercial & { intencao?: string; versaoBase?: number };

describe('ajuste 1 · diário local confirmado antes da RPC', () => {
  it('IndexedDB não confirmou a gravação: nada vai ao banco, erro sinalizado, e "Tentar de novo" recupera', async () => {
    sim.diarioRecusa = true;
    actions.definirMetaComercialRadar(mes, 150000, 'meta do mês');
    const s1 = await actions.aguardarSincronizacao();
    expect([s1.status, s1.msg]).toEqual(['erro', 'Não deu para guardar a intenção da meta neste aparelho; nada foi enviado. Tente de novo.']);
    expect(sim.diarioNoEnvio).toEqual([]); // persistirRemoto nem foi chamado
    expect(sim.chamadas).toEqual([]);
    expect(noBanco()).toEqual([]);
    sim.diarioRecusa = false;
    actions.tentarNovamente();
    expect((await actions.aguardarSincronizacao()).status).toBe('ok');
    expect(sim.chamadas).toEqual([`nova ${mes}=150000`]);
  });

  it('exceção do IndexedDB: nada enviado; a fila não fica rejeitada e as rodadas seguintes rodam', async () => {
    sim.diarioFalha = true;
    actions.definirMetaComercialRadar(mes, 150000, 'meta do mês');
    expect((await actions.aguardarSincronizacao()).status).toBe('erro');
    expect(sim.chamadas).toEqual([]);
    sim.diarioFalha = false;
    actions.tentarNovamente();
    expect((await actions.aguardarSincronizacao()).status).toBe('ok');
    actions.definirMetaComercialRadar(mes, 170000, 'revisão');
    expect((await actions.aguardarSincronizacao()).status).toBe('ok');
    expect(sim.chamadas).toEqual([`nova ${mes}=150000`, `nova ${mes}=170000`]);
  });
});

describe('ajuste 2 · recuperação só remove o confirmado ou a recusa definitiva', () => {
  const diarioCom = (...ms: ReturnType<typeof local>[]) => { sim.diario = { usuarioId: 'u-admin', intencoes: ms as never }; sim.pendente = null; };
  const i1 = () => local({ id: 'META-A', intencao: '33333333-0000-4000-8000-000000000001', versaoBase: 0, valor: 100000, motivo: 'primeira' });
  const i2 = () => local({ id: 'META-B', mes: mesSeguinte(mes), intencao: '33333333-0000-4000-8000-000000000002', versaoBase: 0, valor: 200000, motivo: 'segunda' });
  const casos: [string, { message: string; code?: string }][] = [
    ['sessão expirada (JWT)', { message: 'JWT expired', code: 'PGRST301' }],
    ['sessão não autenticada', { message: 'meta comercial: sessão não autenticada', code: '42501' }],
    ['perfil inativo (pode voltar)', { message: 'meta comercial: usuário sem perfil ativo', code: '42501' }],
    ['erro do servidor sem código (indeterminado)', { message: 'upstream connect error' }],
  ];
  for (const [nome, falha] of casos) {
    it(`${nome}: as intenções FICAM no diário, na ordem, e o aviso diz que não foram confirmadas`, async () => {
      diarioCom(i1(), i2());
      sim.falhaAplicar.push(falha);
      await abrirApp();
      expect(sim.diario?.intencoes.map((m) => m.id)).toEqual(['META-A', 'META-B']);
      expect(getState().sync.msg).toMatch(/ainda não confirmada \(fica guardada para nova tentativa\)/);
      expect(noBanco()).toEqual([]);
      // na próxima abertura, já sem a falha, as duas são aplicadas e saem do diário
      await abrirApp();
      expect(sim.diario).toBeNull();
      expect(sim.chamadas.filter((c) => c.startsWith('nova'))).toEqual([`nova ${mes}=100000`, `nova ${mesSeguinte(mes)}=200000`]);
    });
  }

  it('sem rede: as intenções ficam (o app abre com o cache)', async () => {
    diarioCom(i1());
    sim.falhaAplicar.push('rede');
    await abrirApp().catch(() => undefined);
    expect(sim.diario?.intencoes.map((m) => m.id)).toEqual(['META-A']);
  });

  it('recusa DEFINITIVA (versão desatualizada): sai do diário com aviso; a seguinte continua', async () => {
    diarioCom(i1(), i2());
    sim.falhaAplicar.push({ message: 'meta comercial: a meta mudou em outra sessão (versão atual 3, a decisão partiu da versão 0); revise antes de salvar', code: '40001' });
    await abrirApp();
    expect(sim.diario).toBeNull();
    expect(getState().sync.msg).toMatch(/meta de .* não reaplicada: .*mudou em outra sessão/);
    expect(sim.chamadas).toEqual([`nova ${mesSeguinte(mes)}=200000`]);
  });

  it('classificação: só regra, conteúdo, versão e permissão do papel são definitivas', () => {
    const e = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});
    expect([
      recusaDefinitivaMeta(e('rpc x: meta comercial: só o mês corrente ou meses futuros', '23514')),
      recusaDefinitivaMeta(e('rpc x: meta comercial: esta intenção já foi usada com outro conteúdo; nada foi alterado', '23505')),
      recusaDefinitivaMeta(e('rpc x: meta comercial: a meta mudou em outra sessão (…)', '40001')),
      recusaDefinitivaMeta(e('rpc x: meta comercial: sem permissão para definir metas', '42501')),
    ]).toEqual([true, true, true, true]);
    expect([
      recusaDefinitivaMeta(e('rpc x: meta comercial: sessão não autenticada', '42501')),
      recusaDefinitivaMeta(e('rpc x: meta comercial: usuário sem perfil ativo', '42501')),
      recusaDefinitivaMeta(e('rpc x: JWT expired', 'PGRST301')),
      recusaDefinitivaMeta(e('rpc x: deadlock detected', '40P01')),
      recusaDefinitivaMeta(e('Failed to fetch')),
      recusaDefinitivaMeta(e('rpc x: meta comercial: qualquer coisa')), // sem código: indeterminado
      recusaDefinitivaMeta(undefined),
    ]).toEqual([false, false, false, false, false, false, false]);
  });
});

describe('ajuste 3 · a RPC antiga da 0068 nunca é usada', () => {
  it('intenção nova incompleta é recusada antes de sair (nunca cai na RPC antiga)', () => {
    for (const m of [local({ intencao: '33333333-0000-4000-8000-000000000009' }), local({ versaoBase: 0 }), local({ intencao: 'nao-e-uuid', versaoBase: 0 }), local({ intencao: '33333333-0000-4000-8000-000000000009', versaoBase: -1 })])
      expect(() => chamadaDaMeta(m)).toThrow(/intenção incompleta/);
  });

  it('intenção incompleta numa pendência: nada é enviado, a pendência fica e o erro aparece', async () => {
    const ds = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
    const base = JSON.parse(JSON.stringify(ds)) as Dataset;
    ds.radar.metasComerciais = [...(ds.radar.metasComerciais ?? []), local({ id: 'META-X', intencao: '33333333-0000-4000-8000-00000000000a' })];
    sim.pendente = { usuarioId: 'u-admin', base, ds, em: new Date().toISOString() };
    await abrirApp();
    expect(sim.chamadas).toEqual([]);
    expect(getState().sync.status).toBe('erro');
    expect(getState().sync.msg).toMatch(/intenção incompleta/);
    expect(sim.pendente).not.toBeNull(); // nada descartado: o usuário decide (Descartar pendências)
  });

  it('registro LEGADO (sem intenção): vira intenção determinística com base = versão − 1, sempre a mesma no reenvio', () => {
    const [rpc1, a1] = chamadaDaMeta(local());
    const [rpc2, a2] = chamadaDaMeta(local());
    expect([rpc1, rpc2]).toEqual(['radar_definir_meta_comercial_intencao', 'radar_definir_meta_comercial_intencao']);
    expect(a1).toEqual(a2);
    expect(a1).toMatchObject({ p_versao_base: 0, p_valor: 250000, p_motivo: 'meta antiga' });
    expect(chamadaDaMeta(local({ motivo: 'outro' }))[1].p_intencao).not.toBe(a1.p_intencao);
    expect(comIntencao(local({ versao: 3 })).versaoBase).toBe(2);
  });

  it('legado pendente com o banco já em outra versão: recusado pela pré-condição — o valor antigo NÃO volta', async () => {
    outraSessao(mes, 400000);
    const ds = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
    const base = JSON.parse(JSON.stringify(ds)) as Dataset;
    ds.radar.metasComerciais = [...(ds.radar.metasComerciais ?? []), local({ id: 'META-LEG', versao: 1 })];
    sim.pendente = { usuarioId: 'u-admin', base, ds, em: new Date().toISOString() };
    await abrirApp().catch(() => undefined);
    expect(noBanco()).toEqual([[1, 400000]]);
    expect(sim.chamadas).toEqual([]);
  });

  it('legado pendente com o banco intacto: aplicado uma vez; reaplicar devolve o mesmo resultado (idempotente)', async () => {
    const ds = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
    const base = JSON.parse(JSON.stringify(ds)) as Dataset;
    ds.radar.metasComerciais = [...(ds.radar.metasComerciais ?? []), local({ id: 'META-LEG', versao: 1 })];
    sim.pendente = { usuarioId: 'u-admin', base, ds, em: new Date().toISOString() };
    await abrirApp();
    expect(noBanco()).toEqual([[1, 250000]]);
    const [rpc, args] = chamadaDaMeta(local({ id: 'META-LEG', versao: 1 }));
    expect(bancoRpc(rpc, args)).toMatchObject({ repetida: true, versao: 1 });
    expect(noBanco()).toEqual([[1, 250000]]);
  });
});

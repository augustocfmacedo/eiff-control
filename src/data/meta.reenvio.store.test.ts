// CD-D3/E5 — bloqueador de release, pelo caminho REAL do store no modo remoto: fila `sincronizar`, "Tentar de novo"
// (`actions.tentarNovamente`) e pendência offline (`carregarComPendentes` via `actions.recarregar`).
//
// O provider remoto é simulado só na fronteira (`persistirRemoto` / `carregarRemoto` / IndexedDB): a simulação envia as
// metas novas como `persistirMetas` faz (id fora da base = nova) e avisa `aoGravarMeta` para cada uma aceita, e então pode
// falhar DEPOIS (operação posterior da rodada). Prova: a meta aceita nunca é reenviada; as outras alterações sim.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../core/types';
import type { VersaoMetaComercial } from '../core/radar';

const sim = vi.hoisted(() => ({
  diarioFalha: false, diarioRecusa: false,
  chamadas: [] as { metasEnviadas: string[]; empresasNaBase: number; empresasNoEnvio: number }[],
  /** o que fazer na próxima chamada: 'ok' | 'falha_depois' (regra/conflito) | 'rede_depois' (sem rede) */
  roteiro: [] as ('ok' | 'falha_depois' | 'rede_depois')[],
  pendente: null as null | { usuarioId: string; base: Dataset; ds: Dataset; em: string },
  remoto: null as null | Dataset,
  diario: null as null | { usuarioId: string; intencoes: { id: string; intencao: string }[] },
}));

vi.mock('./supabase', async (original) => {
  const real = await original<typeof import('./supabase')>();
  return {
    ...real,
    remotoAtivo: true,
    remotoPronto: () => true,
    sessaoAtual: async () => ({ userId: 'u-admin', email: 'admin@eiff.test' }),
    aoMudarSessao: () => () => undefined,
    precisaTrocarSenha: async () => false,
    carregarRemoto: async () => ({ ds: JSON.parse(JSON.stringify(sim.remoto)), usuario: sim.remoto!.usuarios.find((u) => u.id === 'u-admin')! }),
    persistirRemoto: async (antes: Dataset, depois: Dataset, _ator: string, opcoes: { aoGravarMeta?: (m: VersaoMetaComercial) => void } = {}) => {
      const ja = new Set((antes.radar.metasComerciais ?? []).map((m) => m.id));
      const novas = (depois.radar.metasComerciais ?? []).filter((m) => !ja.has(m.id));
      sim.chamadas.push({ metasEnviadas: novas.map((m) => `${m.mes}=${m.valor}`), empresasNaBase: antes.radar.empresas.length, empresasNoEnvio: depois.radar.empresas.length - antes.radar.empresas.length });
      for (const m of novas) opcoes.aoGravarMeta?.(m); // a RPC aceitou cada uma
      const passo = sim.roteiro.shift() ?? 'ok';
      if (passo === 'falha_depois') throw new Error('inserir inbox_thread: violates row-level security policy'); // operação posterior
      if (passo === 'rede_depois') throw new TypeError('Failed to fetch');
    },
  };
});
vi.mock('./offline', () => ({
  apagarPendente: async () => { sim.pendente = null; },
  guardarCache: async () => undefined,
  lerCache: async () => null,
  guardarPendente: async (p: typeof sim.pendente) => { sim.pendente = JSON.parse(JSON.stringify(p)); },
  guardarIntencoesMeta: async (d: unknown) => { if (sim.diarioFalha) throw new Error('IndexedDB indisponível'); if (sim.diarioRecusa) return false; sim.diario = JSON.parse(JSON.stringify(d)); return true; },
  lerIntencoesMeta: async () => (sim.diario ? JSON.parse(JSON.stringify(sim.diario)) : null),
  apagarIntencoesMeta: async () => { sim.diario = null; },
  lerPendente: async () => (sim.pendente ? JSON.parse(JSON.stringify(sim.pendente)) : undefined),
}));

const { actions, getState, inicializar } = await import('./store');
const { mesComercialDe, mesSeguinte } = await import('../core/radar');
const seed = (await import('./seed.json')).default as unknown as Dataset;

const mes = mesSeguinte(mesComercialDe(new Date().toISOString())!);
const enviadas = () => sim.chamadas.flatMap((c) => c.metasEnviadas);
const novaEmpresa = (nome: string) => actions.salvarEmpresaRadar({ ...actions.novaEmpresaRadar(), razaoSocial: nome, uf: 'GO' });

beforeEach(async () => {
  sim.chamadas.length = 0; sim.roteiro.length = 0; sim.pendente = null; sim.diario = null; sim.diarioFalha = false; sim.diarioRecusa = false;
  sim.remoto = { ...JSON.parse(JSON.stringify(seed)), radar: { ...JSON.parse(JSON.stringify(seed)).radar, metasComerciais: [], desfechos: [] } };
  await inicializar();
  await actions.recarregar();
  actions.trocarUsuario?.('u-admin');
  await actions.aguardarSincronizacao();
  sim.chamadas.length = 0;
});

describe('E5 · "Tentar de novo" depois de falha posterior à meta', () => {
  it('a meta aceita não volta; a alteração de outro módulo que falhou volta', async () => {
    expect(getState().modo).toBe('remoto');
    // 1) outra tela muda uma empresa e a rodada falha (nada da meta ainda)
    sim.roteiro.push('falha_depois');
    novaEmpresa('Conta Pendente Fictícia');
    expect((await actions.aguardarSincronizacao()).status).toBe('erro');
    // 2) a meta é definida: a RPC aceita e algo POSTERIOR da rodada falha de novo
    sim.roteiro.push('falha_depois');
    actions.definirMetaComercialRadar(mes, 250000, 'meta aprovada');
    expect((await actions.aguardarSincronizacao()).status).toBe('erro');
    expect(enviadas()).toEqual([`${mes}=250000`]);
    // 3) "Tentar de novo": a empresa volta a ser enviada; a meta NÃO
    sim.roteiro.push('ok');
    actions.tentarNovamente();
    expect((await actions.aguardarSincronizacao()).status).toBe('ok');
    const ultima = sim.chamadas.at(-1)!;
    expect(ultima.metasEnviadas).toEqual([]);
    expect(ultima.empresasNoEnvio).toBe(1);
    expect(enviadas()).toEqual([`${mes}=250000`]); // uma única vez em todas as rodadas
  });

  it('várias retomadas seguidas com falha: a meta continua sendo enviada uma única vez', async () => {
    sim.roteiro.push('falha_depois', 'falha_depois', 'falha_depois', 'ok');
    actions.definirMetaComercialRadar(mes, 120000, 'meta do mês');
    await actions.aguardarSincronizacao();
    for (let i = 0; i < 3; i++) { actions.tentarNovamente(); await actions.aguardarSincronizacao(); }
    expect(getState().sync.status).toBe('ok');
    expect(enviadas()).toEqual([`${mes}=120000`]);
  });

  it('meta nova depois da falha: só a nova é enviada na retomada', async () => {
    sim.roteiro.push('falha_depois', 'ok');
    actions.definirMetaComercialRadar(mes, 100000, 'primeira');
    await actions.aguardarSincronizacao();
    actions.definirMetaComercialRadar(mes, 130000, 'revisão');
    await actions.aguardarSincronizacao();
    expect(enviadas()).toEqual([`${mes}=100000`, `${mes}=130000`]);
  });
});

describe('E5 · pendência offline (sem rede depois da meta) e reabertura do app', () => {
  it('a pendência guardada já tem a meta aceita na base; ao reabrir, não reenvia', async () => {
    sim.roteiro.push('rede_depois');
    actions.definirMetaComercialRadar(mes, 250000, 'meta aprovada');
    expect((await actions.aguardarSincronizacao()).status).toBe('pendente');
    expect(sim.pendente!.base.radar.metasComerciais!.map((m) => `${m.mes}=${m.valor}`)).toEqual([`${mes}=250000`]);
    // reabrir (recarregar): carregarComPendentes aplica a pendência
    sim.roteiro.push('ok');
    await actions.recarregar();
    expect(enviadas()).toEqual([`${mes}=250000`]);
    expect(sim.pendente).toBeNull();
  });

  it('aplicando a pendência: a meta é aceita e algo posterior falha — a pendência é regravada com a meta na base', async () => {
    // pendência criada sem rede ANTES de enviar qualquer coisa (a meta ainda não foi ao banco)
    sim.roteiro.push('rede_depois');
    const antesDaMeta = JSON.parse(JSON.stringify(getState().ds)) as Dataset;
    actions.definirMetaComercialRadar(mes, 90000, 'meta offline');
    await actions.aguardarSincronizacao();
    sim.pendente = { ...sim.pendente!, base: antesDaMeta }; // como se a rede tivesse caído antes da RPC
    sim.chamadas.length = 0;
    // reabertura: a RPC aceita a meta e uma operação posterior falha (regra) → pendência regravada com a meta na base
    sim.roteiro.push('falha_depois');
    await actions.recarregar();
    expect(enviadas()).toEqual([`${mes}=90000`]);
    expect(sim.pendente!.base.radar.metasComerciais!.map((m) => `${m.mes}=${m.valor}`)).toEqual([`${mes}=90000`]);
    // "Tentar de novo": a meta não volta
    sim.roteiro.push('ok');
    actions.tentarNovamente();
    await actions.aguardarSincronizacao();
    expect(enviadas()).toEqual([`${mes}=90000`]);
  });
});

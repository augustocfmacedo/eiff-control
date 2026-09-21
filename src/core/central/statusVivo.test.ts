// LIVE x SNAPSHOT (invariante 10 da Wave 03) e o polling controlado — tudo puro, sem DOM e sem rede.
import { describe, expect, it } from 'vitest';
import type { RespostaDevelopmentStatus, StatusDesenvolvimento } from './githubAdapter';
import {
  BACKOFF_MAX_MS, FRESCURA_MAX_MS, INTERVALO_MINIMO_MS, INTERVALO_POLLING_MS, MOTIVOS_SNAPSHOT, ROTULO_MOTIVO,
  criarPolling, idadeMs, idadeTexto, modoDoStatus, proximoIntervalo, resumoQualityGate, type LeituraStatus, type TimerInjetado,
} from './statusVivo';

const AGORA = '2026-09-11T12:00:00.000Z';
const STATUS: StatusDesenvolvimento = {
  repositorio: 'augustocfmacedo/eiff-control',
  main: { sha: 'abcdef1234567890', sha7: 'abcdef1', data: '2026-09-11T10:00:00Z', mensagem: 'Wave 03' },
  qualityGate: { nome: 'EIFF Quality Gate', status: 'completed', conclusao: 'success', url: 'https://github.com/x/runs/1', quando: '2026-09-11T11:00:00Z', sha7: 'abcdef1', numero: 42 },
  branches: [{ nome: 'central/alpha-e2e', sha7: '1111111', data: '2026-09-10T08:00:00Z' }],
  branchesTotal: 1,
  consultadoEm: AGORA,
  avisos: [],
};
const live = (geradoEm = AGORA, status: StatusDesenvolvimento = STATUS): LeituraStatus => ({ ok: true, http: 200, corpo: { modo: 'LIVE', geradoEm, status } as RespostaDevelopmentStatus });
const snap = (motivo: 'nao_configurado' | 'nao_autorizado' | 'indisponivel' | 'rede' | 'timeout', detalhe?: string): LeituraStatus => ({ ok: true, http: 200, corpo: { modo: 'SNAPSHOT', geradoEm: AGORA, motivo, detalhe } });
const menos = (ms: number) => new Date(Date.parse(AGORA) - ms).toISOString();

describe('modoDoStatus — LIVE exige fonte ok, autorizada e fresca', () => {
  it('LIVE so no caminho completo: 200, modo LIVE, status presente e geradoEm fresco', () => {
    const r = modoDoStatus(live(), AGORA);
    expect(r.modo).toBe('LIVE');
    if (r.modo !== 'LIVE') return;
    expect(r.status.main.sha7).toBe('abcdef1');
    expect(r.idadeMs).toBe(0);
    const quase = modoDoStatus(live(menos(FRESCURA_MAX_MS - 1)), AGORA);
    expect(quase.modo).toBe('LIVE');
  });
  it('queda 1 — sem fonte: nenhuma leitura, endpoint ausente (404/405), sem rede, modo local', () => {
    expect(modoDoStatus(undefined, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    expect(modoDoStatus(null, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    expect(modoDoStatus({ ok: false, erro: 'sem_endpoint' }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    expect(modoDoStatus({ ok: false, erro: 'rede' }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    expect(modoDoStatus({ ok: false, erro: 'http', http: 404 }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    expect(modoDoStatus({ ok: false, erro: 'http', http: 405 }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte' });
    // servidor sem GITHUB_READ_TOKEN e o mesmo motivo legivel: nao ha fonte configurada
    expect(modoDoStatus(snap('nao_configurado'), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'sem_fonte', detalhe: 'nao_configurado' });
  });
  it('queda 2 — nao autorizado: 401/403 do endpoint (perfil sem ver_mission_control) ou a fonte recusando o token', () => {
    expect(modoDoStatus({ ok: false, erro: 'http', http: 401 }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'nao_autorizado' });
    expect(modoDoStatus({ ok: false, erro: 'http', http: 403 }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'nao_autorizado' });
    expect(modoDoStatus(snap('nao_autorizado', 'http 401'), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'nao_autorizado', detalhe: 'http 401' });
  });
  it('queda 3 — obsoleto: geradoEm com FRESCURA_MAX_MS ou mais, ausente ou invalido', () => {
    expect(modoDoStatus(live(menos(FRESCURA_MAX_MS)), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'obsoleto', detalhe: 'gerado há 10 min' });
    expect(modoDoStatus(live(menos(3 * 60 * 60_000)), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'obsoleto' });
    expect(modoDoStatus(live(''), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'obsoleto' });
    expect(modoDoStatus(live('nao-e-data'), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'obsoleto' });
    // frescura configuravel
    expect(modoDoStatus(live(menos(2_000)), AGORA, 1_000)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'obsoleto' });
  });
  it('queda 4 — indisponivel: fonte com falha nomeada, 5xx do endpoint, corpo vazio, modo desconhecido ou status incompleto', () => {
    for (const m of ['indisponivel', 'rede', 'timeout'] as const) expect(modoDoStatus(snap(m), AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
    expect(modoDoStatus({ ok: false, erro: 'http', http: 500 }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
    expect(modoDoStatus({ ok: false, erro: 'http' }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
    expect(modoDoStatus({ ok: true, http: 200, corpo: null }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
    expect(modoDoStatus({ ok: true, http: 200, corpo: { modo: 'AO_VIVO' } as unknown as RespostaDevelopmentStatus }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
    expect(modoDoStatus({ ok: true, http: 200, corpo: { modo: 'LIVE', geradoEm: AGORA } as unknown as RespostaDevelopmentStatus }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel', detalhe: 'status incompleto' });
    expect(modoDoStatus({ ok: true, http: 200, corpo: { modo: 'LIVE', geradoEm: AGORA, status: { main: {} } } as unknown as RespostaDevelopmentStatus }, AGORA)).toMatchObject({ modo: 'SNAPSHOT', motivo: 'indisponivel' });
  });
  it('um corpo LIVE nunca vira LIVE por si: a data manda', () => {
    // a mesma resposta e LIVE agora e SNAPSHOT dez minutos depois — a tela nao pode guardar um "ao vivo" antigo
    const l = live();
    expect(modoDoStatus(l, AGORA).modo).toBe('LIVE');
    expect(modoDoStatus(l, new Date(Date.parse(AGORA) + FRESCURA_MAX_MS).toISOString()).modo).toBe('SNAPSHOT');
  });
  it('catalogo de motivos fechado e com rotulo legivel para cada um', () => {
    expect([...MOTIVOS_SNAPSHOT]).toEqual(['sem_fonte', 'nao_autorizado', 'obsoleto', 'indisponivel']);
    for (const m of MOTIVOS_SNAPSHOT) expect(ROTULO_MOTIVO[m].length).toBeGreaterThan(3);
  });
});

describe('idade e resumo', () => {
  it('idadeMs: futuro conta zero, invalido e NaN', () => {
    expect(idadeMs(menos(90_000), AGORA)).toBe(90_000);
    expect(idadeMs(new Date(Date.parse(AGORA) + 60_000).toISOString(), AGORA)).toBe(0);
    expect(Number.isNaN(idadeMs('x', AGORA))).toBe(true);
    expect(Number.isNaN(idadeMs(undefined, AGORA))).toBe(true);
  });
  it('idadeTexto em portugues', () => {
    expect(idadeTexto(0)).toBe('agora');
    expect(idadeTexto(59_999)).toBe('agora');
    expect(idadeTexto(60_000)).toBe('há 1 min');
    expect(idadeTexto(9 * 60_000 + 500)).toBe('há 9 min');
    expect(idadeTexto(3 * 60 * 60_000)).toBe('há 3 h');
    expect(idadeTexto(3 * 24 * 60 * 60_000)).toBe('há 3 d');
    expect(idadeTexto(NaN)).toBe('—');
  });
  it('resumoQualityGate: passou / falhou / executando / sem_execucao', () => {
    expect(resumoQualityGate(STATUS)).toBe('passou');
    expect(resumoQualityGate({ ...STATUS, qualityGate: { ...STATUS.qualityGate!, conclusao: 'failure' } })).toBe('falhou');
    expect(resumoQualityGate({ ...STATUS, qualityGate: { ...STATUS.qualityGate!, conclusao: 'cancelled' } })).toBe('falhou');
    expect(resumoQualityGate({ ...STATUS, qualityGate: { ...STATUS.qualityGate!, status: 'in_progress', conclusao: null } })).toBe('executando');
    expect(resumoQualityGate({ ...STATUS, qualityGate: undefined })).toBe('sem_execucao');
  });
});

// ------------------------------------------------------------------------------------------ polling
class TimerFalso implements TimerInjetado {
  agendados: { id: number; fn: () => void; ms: number; cancelado: boolean }[] = [];
  private seq = 0;
  agendar(fn: () => void, ms: number) { const id = ++this.seq; this.agendados.push({ id, fn, ms, cancelado: false }); return id; }
  cancelar(h: unknown) { const a = this.agendados.find((x) => x.id === h); if (a) a.cancelado = true; }
  pendentes() { return this.agendados.filter((a) => !a.cancelado && !(a as { rodou?: boolean }).rodou); }
  async disparar() { const p = this.pendentes(); expect(p.length, 'exatamente um tick pendente').toBe(1); (p[0] as { rodou?: boolean }).rodou = true; p[0].fn(); await Promise.resolve(); await Promise.resolve(); }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('polling controlado', () => {
  it('proximoIntervalo: fixo sem falhas, dobra ate o teto, nunca abaixo do minimo', () => {
    expect(proximoIntervalo(0)).toBe(INTERVALO_POLLING_MS);
    expect(proximoIntervalo(1)).toBe(2 * INTERVALO_POLLING_MS);
    expect(proximoIntervalo(2)).toBe(4 * INTERVALO_POLLING_MS);
    expect(proximoIntervalo(10)).toBe(BACKOFF_MAX_MS);
    expect(proximoIntervalo(0, 10)).toBe(INTERVALO_MINIMO_MS);
    expect(proximoIntervalo(0, 0)).toBe(INTERVALO_MINIMO_MS);
    expect(INTERVALO_POLLING_MS).toBe(60_000);
    expect(FRESCURA_MAX_MS).toBe(10 * 60_000);
  });
  it('iniciar le na hora e agenda o proximo tick no intervalo fixo; parar cancela', async () => {
    const t = new TimerFalso();
    let n = 0;
    const p = criarPolling({ executar: async () => { n += 1; return true; }, oculta: () => false, timer: t });
    p.iniciar();
    await tick();
    expect(n).toBe(1);
    expect(t.pendentes()).toHaveLength(1);
    expect(t.pendentes()[0].ms).toBe(INTERVALO_POLLING_MS);
    await t.disparar();
    expect(n).toBe(2);
    expect(t.pendentes()).toHaveLength(1);
    p.parar();
    expect(t.pendentes()).toHaveLength(0);
    expect(p.ativo()).toBe(false);
    p.iniciar(); p.iniciar(); // idempotente
    await tick();
    expect(n).toBe(3);
    expect(t.pendentes()).toHaveLength(1);
  });
  it('aba oculta: nada e agendado; ao ficar visivel le na hora e retoma', async () => {
    const t = new TimerFalso();
    let oculta = true;
    let n = 0;
    const p = criarPolling({ executar: async () => { n += 1; return true; }, oculta: () => oculta, timer: t });
    p.iniciar();
    await tick();
    expect(n).toBe(0); // oculta desde o inicio: nem a primeira leitura
    expect(t.pendentes()).toHaveLength(0);
    oculta = false;
    p.visibilidadeMudou();
    await tick();
    expect(n).toBe(1);
    expect(t.pendentes()).toHaveLength(1);
    oculta = true;
    p.visibilidadeMudou();
    expect(t.pendentes()).toHaveLength(0); // tick pendente cancelado
    oculta = false;
    p.visibilidadeMudou();
    await tick();
    expect(n).toBe(2);
    expect(t.pendentes()).toHaveLength(1);
    p.parar();
  });
  it('ficou oculta entre o agendamento e o tick: o tick nao le e nada e reagendado (sem loop)', async () => {
    const t = new TimerFalso();
    let oculta = false;
    let n = 0;
    const p = criarPolling({ executar: async () => { n += 1; return true; }, oculta: () => oculta, timer: t });
    p.iniciar();
    await tick();
    oculta = true;
    await t.disparar();
    expect(n).toBe(1);
    expect(t.pendentes()).toHaveLength(0);
    p.parar();
  });
  it('falhas seguidas: backoff dobrando ate o teto; sucesso zera', async () => {
    const t = new TimerFalso();
    let ok = false;
    const p = criarPolling({ executar: async () => ok, oculta: () => false, timer: t });
    p.iniciar();
    await tick();
    expect(p.falhasSeguidas()).toBe(1);
    expect(t.pendentes()[0].ms).toBe(2 * INTERVALO_POLLING_MS);
    await t.disparar();
    expect(t.pendentes()[0].ms).toBe(4 * INTERVALO_POLLING_MS);
    await t.disparar(); await t.disparar(); await t.disparar(); await t.disparar();
    expect(t.pendentes()[0].ms).toBe(BACKOFF_MAX_MS);
    ok = true;
    await t.disparar();
    expect(p.falhasSeguidas()).toBe(0);
    expect(t.pendentes()[0].ms).toBe(INTERVALO_POLLING_MS);
    p.parar();
  });
  it('executar que lanca conta como falha, nunca derruba o polling', async () => {
    const t = new TimerFalso();
    const p = criarPolling({ executar: async () => { throw new Error('boom'); }, oculta: () => false, timer: t });
    p.iniciar();
    await tick();
    expect(p.falhasSeguidas()).toBe(1);
    expect(t.pendentes()).toHaveLength(1);
    p.parar();
  });
  it('nunca sobrepoe leituras: um tick durante uma leitura em curso nao dispara outra', async () => {
    const t = new TimerFalso();
    let libera: (() => void) | undefined;
    let n = 0;
    const p = criarPolling({ executar: () => new Promise<boolean>((res) => { n += 1; libera = () => res(true); }), oculta: () => false, timer: t });
    p.iniciar();
    await tick();
    expect(n).toBe(1);
    p.visibilidadeMudou(); // visivel, sem tick pendente, mas em curso: nao dispara
    await tick();
    expect(n).toBe(1);
    libera!();
    await tick();
    expect(t.pendentes()).toHaveLength(1);
    p.parar();
  });
  it('sem timer injetado usa setTimeout e nunca um intervalo abaixo do minimo', () => {
    const p = criarPolling({ executar: async () => true, oculta: () => true });
    p.iniciar();
    p.parar();
    expect(p.ativo()).toBe(false);
    expect(proximoIntervalo(0, 1)).toBeGreaterThanOrEqual(INTERVALO_MINIMO_MS);
  });
});

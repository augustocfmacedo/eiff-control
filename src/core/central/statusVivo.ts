// A regra de LIVE x SNAPSHOT do Mission Control (Wave 03, F4) — modulo PURO, sem DOM, sem rede.
//
// Invariante 10 da Wave 03: fechar o gate MISSION_CONTROL_LIVE nao torna a interface LIVE. LIVE exige fonte
// acessivel (o endpoint respondeu), autorizada (o servidor conferiu ver_mission_control pelo perfil e a fonte
// aceitou o token) e FRESCA (`geradoEm` com menos de FRESCURA_MAX_MS). Qualquer outra coisa e SNAPSHOT, com o
// motivo escrito — nunca um "ao vivo" inventado.
//
// O polling do cliente tambem vive aqui, com timer injetavel: intervalo fixo, para com a aba oculta, backoff
// simples depois de falha e nunca um loop apertado.
import type { EstadoFonte, RespostaDevelopmentStatus, StatusDesenvolvimento } from './githubAdapter';

// -------------------------------------------------------------------------------------- constantes

/** idade maxima de `geradoEm` para a tela poder dizer "ao vivo" */
export const FRESCURA_MAX_MS = 10 * 60_000;
/** intervalo fixo do polling com a aba visivel */
export const INTERVALO_POLLING_MS = 60_000;
/** menor intervalo que o polling aceita, seja qual for a configuracao: nunca um loop apertado */
export const INTERVALO_MINIMO_MS = 5_000;
/** teto do backoff depois de falhas seguidas */
export const BACKOFF_MAX_MS = 10 * 60_000;

export const MOTIVOS_SNAPSHOT = ['sem_fonte', 'nao_autorizado', 'obsoleto', 'indisponivel'] as const;
export type MotivoSnapshot = (typeof MOTIVOS_SNAPSHOT)[number];

export const ROTULO_MOTIVO: Record<MotivoSnapshot, string> = {
  sem_fonte: 'sem fonte configurada',
  nao_autorizado: 'fonte não autorizada',
  obsoleto: 'última leitura obsoleta',
  indisponivel: 'fonte indisponível',
};

// ------------------------------------------------------------------------------------------- tipos

/** O que o cliente obteve do endpoint, ja sem HTTP: ou um corpo, ou uma falha nomeada. */
export type LeituraStatus =
  | { ok: true; corpo: RespostaDevelopmentStatus | null | undefined; http: number }
  | { ok: false; http?: number; erro: 'sem_endpoint' | 'rede' | 'http' };

export type ModoPainel =
  | { modo: 'LIVE'; status: StatusDesenvolvimento; geradoEm: string; idadeMs: number }
  | { modo: 'SNAPSHOT'; motivo: MotivoSnapshot; detalhe?: string };

// ----------------------------------------------------------------------------------- regra LIVE x SNAPSHOT

const MOTIVO_DA_FONTE: Record<EstadoFonte, MotivoSnapshot> = {
  nao_configurado: 'sem_fonte',
  nao_autorizado: 'nao_autorizado',
  indisponivel: 'indisponivel',
  rede: 'indisponivel',
  timeout: 'indisponivel',
};

const snapshot = (motivo: MotivoSnapshot, detalhe?: string): ModoPainel => ({ modo: 'SNAPSHOT', motivo, detalhe });

/** Idade de um instante ISO em ms; relogio adiantado (futuro) conta como zero, ISO invalido devolve NaN. */
export function idadeMs(iso: string | undefined, agoraIso: string): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  const agora = Date.parse(agoraIso);
  if (!Number.isFinite(t) || !Number.isFinite(agora)) return NaN;
  return Math.max(0, agora - t);
}

/**
 * Decide o modo do painel. LIVE somente se: o endpoint respondeu 200 com `modo: 'LIVE'` (o servidor so chega ai
 * depois de conferir a permissao pelo perfil e de a fonte aceitar o token), veio `status`, e `geradoEm` tem menos de
 * FRESCURA_MAX_MS. Tudo mais e SNAPSHOT com motivo do catalogo.
 */
export function modoDoStatus(leitura: LeituraStatus | null | undefined, agoraIso: string, frescuraMaxMs = FRESCURA_MAX_MS): ModoPainel {
  if (!leitura) return snapshot('sem_fonte', 'nenhuma leitura');
  if (!leitura.ok) {
    if (leitura.erro === 'sem_endpoint' || leitura.erro === 'rede') return snapshot('sem_fonte', leitura.erro === 'rede' ? 'sem rede' : 'endpoint ausente');
    if (leitura.http === 401 || leitura.http === 403) return snapshot('nao_autorizado', `http ${leitura.http}`);
    if (leitura.http === 404 || leitura.http === 405) return snapshot('sem_fonte', `http ${leitura.http}`);
    return snapshot('indisponivel', leitura.http ? `http ${leitura.http}` : 'falha do endpoint');
  }
  const c = leitura.corpo;
  if (!c || typeof c !== 'object') return snapshot('indisponivel', 'resposta vazia');
  if (c.modo !== 'LIVE') {
    const motivo = c.modo === 'SNAPSHOT' && c.motivo in MOTIVO_DA_FONTE ? MOTIVO_DA_FONTE[c.motivo] : 'indisponivel';
    return snapshot(motivo, c.modo === 'SNAPSHOT' ? (c.detalhe ?? c.motivo) : 'modo desconhecido');
  }
  if (!c.status || typeof c.status !== 'object' || !c.status.main?.sha7) return snapshot('indisponivel', 'status incompleto');
  const idade = idadeMs(c.geradoEm, agoraIso);
  if (!Number.isFinite(idade)) return snapshot('obsoleto', 'sem data de geração');
  if (idade >= frescuraMaxMs) return snapshot('obsoleto', `gerado há ${Math.round(idade / 60_000)} min`);
  return { modo: 'LIVE', status: c.status, geradoEm: c.geradoEm, idadeMs: idade };
}

/** "agora", "há 3 min", "há 2 h" — para o cabecalho e o bloco GitHub. */
export function idadeTexto(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

/** Resumo do Quality Gate para o cabecalho: passou / falhou / em execucao / sem execucao. */
export type ResumoQualityGate = 'passou' | 'falhou' | 'executando' | 'sem_execucao';
export function resumoQualityGate(status: StatusDesenvolvimento): ResumoQualityGate {
  const q = status.qualityGate;
  if (!q) return 'sem_execucao';
  if (q.status !== 'completed') return 'executando';
  return q.conclusao === 'success' ? 'passou' : 'falhou';
}

// ---------------------------------------------------------------------------------------- polling

/** Proximo intervalo: fixo enquanto as leituras dao certo, dobrando ate o teto depois de falhas seguidas. */
export function proximoIntervalo(falhasSeguidas: number, baseMs = INTERVALO_POLLING_MS): number {
  const base = Math.max(INTERVALO_MINIMO_MS, baseMs);
  const expoente = Math.min(Math.max(0, Math.floor(falhasSeguidas)), 4);
  return Math.min(BACKOFF_MAX_MS, base * 2 ** expoente);
}

export interface TimerInjetado {
  agendar(fn: () => void, ms: number): unknown;
  cancelar(handle: unknown): void;
}

export interface OpcoesPolling {
  /** faz uma leitura; devolve true quando a fonte respondeu com sucesso (LIVE ou SNAPSHOT explicado) */
  executar: () => Promise<boolean>;
  /** true quando a aba esta oculta (document.hidden); injetado para o modulo nao depender do DOM */
  oculta: () => boolean;
  timer?: TimerInjetado;
  intervaloMs?: number;
}

export interface Polling {
  iniciar(): void;
  parar(): void;
  /** chamar quando a visibilidade da aba muda: oculta cancela o proximo tick, visivel retoma na hora */
  visibilidadeMudou(): void;
  ativo(): boolean;
  falhasSeguidas(): number;
}

const TIMER_PADRAO: TimerInjetado = { agendar: (fn, ms) => setTimeout(fn, ms), cancelar: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * Polling controlado: uma leitura de cada vez (nunca sobrepoe), intervalo fixo com backoff apos falha, e
 * NENHUM tick enquanto a aba esta oculta — ao voltar, le na hora e retoma o ritmo.
 */
export function criarPolling(op: OpcoesPolling): Polling {
  const timer = op.timer ?? TIMER_PADRAO;
  let ligado = false;
  let emCurso = false;
  let pendente: unknown = undefined;
  let falhas = 0;

  const cancelar = () => { if (pendente !== undefined) { timer.cancelar(pendente); pendente = undefined; } };
  const agendar = () => {
    cancelar();
    if (!ligado || op.oculta()) return; // aba oculta: nada agendado ate voltar
    pendente = timer.agendar(() => { pendente = undefined; void rodar(); }, proximoIntervalo(falhas, op.intervaloMs));
  };
  const rodar = async () => {
    if (!ligado || emCurso) return;
    if (op.oculta()) return; // chegou oculta: espera visibilidadeMudou
    emCurso = true;
    let ok: boolean;
    try { ok = await op.executar(); } catch { ok = false; }
    emCurso = false;
    falhas = ok ? 0 : falhas + 1;
    agendar();
  };

  return {
    iniciar() { if (ligado) return; ligado = true; void rodar(); },
    parar() { ligado = false; cancelar(); },
    visibilidadeMudou() {
      if (!ligado) return;
      if (op.oculta()) { cancelar(); return; }
      if (pendente === undefined && !emCurso) void rodar();
    },
    ativo: () => ligado,
    falhasSeguidas: () => falhas,
  };
}

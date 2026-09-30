// MC-LIVE-3B — prontidão para consumir a API read-only da EIFF Dev Factory (W5), SEM conectá-la.
//
//     FactoryStatusResponse (corpo cru da W5)
//            ↓  validarStatusFactory      — contrato espelhado; fora dele = INVALID_PAYLOAD / CONTRACT_DRIFT
//            ↓  projetarStatusFactory     — TaskSummary → MissionControlWorkItem (+ worker só da própria task)
//            ↓  eventosDaFactory          — só fato com data: WORKER_STARTED
//            ↓  consolidarWorkItems       — mesmo taskId = um cartão; Factory manda no estado, GitHub nos artefatos
//
// O QUE ESTE MÓDULO NÃO FAZ (e um teste prende): fetch, env, token, URL, escrita, React, Supabase, SDK do GitHub.
// A leitura real é uma PORTA (`FactoryReadPort`) que ninguém implementa nesta rodada: a W5 da fábrica ainda não
// existe (sem `packages/api`, sem `docs/API_READONLY.md`, sem endpoint no ar — auditado em 30/09/2026 na main
// 5a309fa). Enquanto isso, `/api/development-status` não recebe porta nenhuma e se comporta exatamente como antes.
//
// Autoridade do contrato: `packages/contracts/src/api.ts` do eiff-dev-factory. Aqui há só os NOMES dos campos
// (`ESPELHO_CAMPOS_API`) e a leitura que o Mission Control faz deles; o teste de drift compara os nomes com o arquivo
// da fábrica e reprova qualquer divergência — contrato muda, CI falha, adapter é revisto.
import type { EloCadeia } from './correlacao';
import {
  ESPELHO_FACTORY_STATES, ESPELHO_JOB_STATES, ESPELHO_LANES, ESPELHO_WORKER_ROLES, ROTULO_MC_ATOR, TASK_ID_CANONICO,
  avaliarFrescor, consolidarEventos, idEvento, normalizarJobFactory,
  type ContextoNormalizacao, type EstadoFabrica, type JobFactory, type MissionControlEvent, type MissionControlWorkItem,
  type WorkerFactory,
} from './workItem';

// ---------------------------------------------------------------------------- espelho dos campos da API

/**
 * ESPELHO dos campos de nível superior de cada schema de `packages/contracts/src/api.ts` (todos `z.strictObject`).
 * Só nomes: o tipo e a regra de cada campo estão em `validarStatusFactory`. O drift compara estes nomes com o arquivo
 * da fábrica — a lista inteira, sem ordem.
 */
export const ESPELHO_CAMPOS_API = {
  FactoryStateSchema: ['state', 'reason', 'since', 'by', 'enabled', 'stage'],
  WorkerStatusSchema: ['workerId', 'taskId', 'attempt', 'role', 'phase', 'turn', 'maxTurns', 'lastHeartbeatAt', 'leaseExpiresAt', 'startedAt', 'durationSec', 'costUsd', 'model', 'lastTool'],
  TaskSummarySchema: ['taskId', 'title', 'repository', 'state', 'risk', 'role', 'attempt', 'priority', 'issueUrl', 'prUrl', 'headSha', 'updatedAt', 'costUsd'],
  ThroughputSchema: ['window', 'done', 'prsOpened', 'integrated', 'blocked', 'costUsd'],
  CostSchema: ['anthropicTodayUsd', 'openaiTodayUsd', 'factoryTodayUsd', 'factoryMonthUsd', 'caps', 'breakersTripped'],
  FactoryStatusResponseSchema: ['version', 'generatedAt', 'factory', 'workers', 'queue', 'blockers', 'humanGates', 'throughput', 'cost', 'lastActivityAt', 'ci'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** O objeto `ci` declarado dentro de FactoryStatusResponseSchema: contadores GLOBAIS da fábrica. */
export const ESPELHO_CAMPOS_CI_AGREGADO = ['running', 'failed24h'] as const;

/** Fases do WorkerStatus (`phase`), espelho do enum do schema. */
export const ESPELHO_FASES_WORKER = ['starting', 'coding', 'testing', 'reporting'] as const;

/** Resposta de `/api/factory/status`, só leitura. Throughput e custo global são carregados mas não viram cartão. */
export interface StatusFactory {
  version: string;
  generatedAt: string;
  factory: { state: EstadoFabrica; reason: string | null; since: string; by: string | null; enabled: boolean; stage: number };
  workers: WorkerFactory[];
  queue: JobFactory[];
  blockers: JobFactory[];
  /** tasks aguardando decisão HUMANA — não são gates do catálogo do Mission Control */
  humanGates: JobFactory[];
  throughput: readonly unknown[];
  cost: Readonly<Record<string, unknown>>;
  lastActivityAt: string | null;
  /** contadores GLOBAIS de CI da fábrica: nunca são o CI de uma task, de um PR ou de um módulo */
  ci: { running: number; failed24h: number };
}

// ------------------------------------------------------------------------------- matriz de capacidades

export const NIVEIS_CAPACIDADE = ['PROVADO_PELO_CONTRATO', 'PARCIAL', 'AUSENTE_DO_CONTRATO'] as const;
export type NivelCapacidade = (typeof NIVEIS_CAPACIDADE)[number];

export interface CapacidadeDoElo {
  nivel: NivelCapacidade;
  /** campos do contrato que sustentam o elo — vazio quando ausente */
  campos: readonly string[];
  nota: string;
}

/**
 * O que o CONTRATO ATUAL da API da fábrica prova sobre cada elo da cadeia (`ELOS_CADEIA`). Declarado a partir da
 * leitura de `api.ts` e preso por teste: todo campo citado existe no espelho, e nada acima de AUSENTE sem campo.
 * Nenhuma capacidade é inferida do roadmap.
 */
export const CAPACIDADES_CONTRATO_FACTORY: Readonly<Record<EloCadeia, CapacidadeDoElo>> = {
  ISSUE: { nivel: 'PROVADO_PELO_CONTRATO', campos: ['TaskSummary.issueUrl'], nota: 'URL da issue do job, obrigatória em toda task.' },
  TASK_ID: { nivel: 'PROVADO_PELO_CONTRATO', campos: ['TaskSummary.taskId', 'WorkerStatus.taskId'], nota: 'Identidade canônica no formato AA-0000, validada pelo schema.' },
  WORKER: { nivel: 'PARCIAL', campos: ['WorkerStatus.workerId', 'WorkerStatus.taskId', 'WorkerStatus.attempt', 'WorkerStatus.startedAt'], nota: 'Só o worker EM EXECUÇÃO no momento da leitura; tentativas anteriores não vêm.' },
  BRANCH: { nivel: 'AUSENTE_DO_CONTRATO', campos: [], nota: 'Não há campo de branch; montá-la de taskId + tentativa seria dedução.' },
  COMMIT: { nivel: 'PARCIAL', campos: ['TaskSummary.headSha'], nota: 'Só a ponta atual (nulo antes do PR); nenhuma lista de commits.' },
  PR: { nivel: 'PARCIAL', campos: ['TaskSummary.prUrl'], nota: 'Só o link (nulo antes do PR); sem estado nem data de abertura. O link nunca vira identidade.' },
  CI: { nivel: 'AUSENTE_DO_CONTRATO', campos: [], nota: 'Só ci.running e ci.failed24h, contadores GLOBAIS: não são o CI de nenhuma task.' },
  MERGE: { nivel: 'AUSENTE_DO_CONTRATO', campos: [], nota: 'O estado INTEGRATED é o estado atual, não um fato datado de merge.' },
  GATE: { nivel: 'AUSENTE_DO_CONTRATO', campos: [], nota: 'humanGates são tasks aguardando decisão humana, não gates do catálogo.' },
};

/** Os campos que a ordem da MC-LIVE-3B mandou auditar, com o uso PERMITIDO e o PROIBIDO de cada um. */
export const CAMPOS_AUDITADOS: readonly { campo: string; uso: string; proibido: string }[] = [
  { campo: 'TaskSummary.issueUrl', uso: 'link da issue no cartão', proibido: 'correlacionar por texto da URL' },
  { campo: 'TaskSummary.taskId', uso: 'identidade de consolidação com o GitHub', proibido: '—' },
  { campo: 'WorkerStatus.taskId', uso: 'ligar o worker à PRÓPRIA task (com a mesma tentativa)', proibido: 'ligar por título, repositório, papel, horário ou nome parecido' },
  { campo: 'WorkerStatus.workerId', uso: 'worker confirmado na cadeia', proibido: 'virar ator humano' },
  { campo: 'WorkerStatus.startedAt', uso: 'data do WORKER_STARTED', proibido: 'data de qualquer outro evento' },
  { campo: 'TaskSummary.headSha', uso: 'commit quando o GitHub não observou o PR', proibido: 'deduzir branch' },
  { campo: 'TaskSummary.prUrl', uso: 'link do PR quando o GitHub não observou o PR', proibido: 'criar identidade ou colar cartões pela URL' },
  { campo: 'TaskSummary.state', uso: 'estado operacional atual do job (autoridade)', proibido: 'fabricar evento histórico (INTEGRATED ≠ MERGED)' },
  { campo: 'FactoryStatusResponse.humanGates', uso: 'tasks aguardando decisão humana', proibido: 'gerar gateId ou GATE_CLOSED' },
  { campo: 'FactoryStatusResponse.ci.running', uso: 'nenhum no cartão (contador global)', proibido: 'CI de task, de PR ou de módulo' },
  { campo: 'FactoryStatusResponse.ci.failed24h', uso: 'nenhum no cartão (contador global)', proibido: 'CI de task, de PR ou de módulo' },
];

// ---------------------------------------------------------------------------------------- validação

/** Catálogo FECHADO de falha da fonte Factory. Nunca stack trace, nunca o corpo recebido. */
export const CODIGOS_FALHA_FACTORY = ['NOT_CONFIGURED', 'SOURCE_UNAVAILABLE', 'INVALID_PAYLOAD', 'CONTRACT_DRIFT'] as const;
export type CodigoFalhaFactory = (typeof CODIGOS_FALHA_FACTORY)[number];

export type ValidacaoFactory =
  | { ok: true; status: StatusFactory }
  | { ok: false; codigo: 'INVALID_PAYLOAD' | 'CONTRACT_DRIFT'; motivos: string[] };

type Obj = Record<string, unknown>;
const ehObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const ehIso = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x));
const ehInt = (x: unknown, min: number, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const ehNum = (x: unknown, min: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= min;
const ehTexto = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !/[\r\n]/.test(x);
const ehUrl = (x: unknown): x is string => {
  if (typeof x !== 'string') return false;
  try { const u = new URL(x); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};
const REPOSITORIO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const em = <T extends string>(lista: readonly T[], x: unknown): x is T => typeof x === 'string' && (lista as readonly string[]).includes(x);

/**
 * Chaves do objeto contra o espelho. Chave a MAIS = CONTRACT_DRIFT (o contrato mudou e o adapter não foi revisto);
 * chave a MENOS = INVALID_PAYLOAD. Os dois só dizem o CAMINHO, nunca o valor recebido.
 */
function conferirChaves(o: Obj, campos: readonly string[], caminho: string, drift: string[], invalido: string[]): void {
  for (const k of Object.keys(o)) if (!campos.includes(k)) drift.push(`${caminho}.${k}`);
  for (const k of campos) if (!(k in o)) invalido.push(`${caminho}.${k}`);
}

function conferirTask(x: unknown, caminho: string, drift: string[], invalido: string[]): void {
  if (!ehObj(x)) { invalido.push(caminho); return; }
  conferirChaves(x, ESPELHO_CAMPOS_API.TaskSummarySchema, caminho, drift, invalido);
  const erro = (campo: string, ok: boolean) => { if (!ok) invalido.push(`${caminho}.${campo}`); };
  erro('taskId', typeof x.taskId === 'string' && TASK_ID_CANONICO.test(x.taskId));
  erro('title', ehTexto(x.title, 80));
  erro('repository', typeof x.repository === 'string' && REPOSITORIO.test(x.repository));
  erro('state', em(ESPELHO_JOB_STATES, x.state));
  erro('risk', em(ESPELHO_LANES, x.risk));
  erro('role', em(ESPELHO_WORKER_ROLES, x.role));
  erro('attempt', ehInt(x.attempt, 0));
  erro('priority', ehInt(x.priority, 0, 100));
  erro('issueUrl', ehUrl(x.issueUrl));
  erro('prUrl', x.prUrl === null || ehUrl(x.prUrl));
  erro('headSha', x.headSha === null || (typeof x.headSha === 'string' && SHA40.test(x.headSha)));
  erro('updatedAt', ehIso(x.updatedAt));
  erro('costUsd', ehNum(x.costUsd, 0));
}

function conferirWorker(x: unknown, caminho: string, drift: string[], invalido: string[]): void {
  if (!ehObj(x)) { invalido.push(caminho); return; }
  conferirChaves(x, ESPELHO_CAMPOS_API.WorkerStatusSchema, caminho, drift, invalido);
  const erro = (campo: string, ok: boolean) => { if (!ok) invalido.push(`${caminho}.${campo}`); };
  erro('workerId', ehTexto(x.workerId, 64) && (x.workerId as string).length > 0);
  erro('taskId', typeof x.taskId === 'string' && TASK_ID_CANONICO.test(x.taskId));
  erro('attempt', ehInt(x.attempt, 1));
  erro('role', em(ESPELHO_WORKER_ROLES, x.role));
  erro('phase', em(ESPELHO_FASES_WORKER, x.phase));
  erro('turn', ehInt(x.turn, 0));
  erro('maxTurns', ehInt(x.maxTurns, 1));
  erro('lastHeartbeatAt', ehIso(x.lastHeartbeatAt));
  erro('leaseExpiresAt', ehIso(x.leaseExpiresAt));
  erro('startedAt', ehIso(x.startedAt));
  erro('durationSec', ehInt(x.durationSec, 0));
  erro('costUsd', ehNum(x.costUsd, 0));
  erro('model', ehTexto(x.model, 80));
  erro('lastTool', ehTexto(x.lastTool, 200));
}

/**
 * Validação FAIL-CLOSED do corpo de `/api/factory/status`. Um único campo fora do contrato recusa a resposta inteira:
 * cartão meio certo é pior que fonte indisponível. Drift (campo novo) tem código próprio para o operador saber que o
 * problema é o contrato, não a rede. Os motivos trazem só caminhos (`queue[2].taskId`), nunca valores.
 */
export function validarStatusFactory(x: unknown): ValidacaoFactory {
  const drift: string[] = [];
  const invalido: string[] = [];
  if (!ehObj(x)) return { ok: false, codigo: 'INVALID_PAYLOAD', motivos: ['(raiz)'] };
  conferirChaves(x, ESPELHO_CAMPOS_API.FactoryStatusResponseSchema, 'status', drift, invalido);
  if (!ehTexto(x.version, 40)) invalido.push('status.version');
  if (!ehIso(x.generatedAt)) invalido.push('status.generatedAt');
  if (!(x.lastActivityAt === null || ehIso(x.lastActivityAt))) invalido.push('status.lastActivityAt');

  if (!ehObj(x.factory)) invalido.push('status.factory');
  else {
    conferirChaves(x.factory, ESPELHO_CAMPOS_API.FactoryStateSchema, 'status.factory', drift, invalido);
    if (!em(ESPELHO_FACTORY_STATES, x.factory.state)) invalido.push('status.factory.state');
    if (typeof x.factory.enabled !== 'boolean') invalido.push('status.factory.enabled');
    if (!ehIso(x.factory.since)) invalido.push('status.factory.since');
    if (!ehInt(x.factory.stage, 0, 4)) invalido.push('status.factory.stage');
  }

  if (!ehObj(x.ci)) invalido.push('status.ci');
  else {
    conferirChaves(x.ci, ESPELHO_CAMPOS_CI_AGREGADO, 'status.ci', drift, invalido);
    if (!ehInt(x.ci.running, 0)) invalido.push('status.ci.running');
    if (!ehInt(x.ci.failed24h, 0)) invalido.push('status.ci.failed24h');
  }

  if (!Array.isArray(x.workers)) invalido.push('status.workers');
  else x.workers.forEach((w, i) => conferirWorker(w, `status.workers[${i}]`, drift, invalido));
  for (const lista of ['queue', 'blockers', 'humanGates'] as const) {
    const v = x[lista];
    if (!Array.isArray(v)) invalido.push(`status.${lista}`);
    else v.forEach((t, i) => conferirTask(t, `status.${lista}[${i}]`, drift, invalido));
  }
  if (!Array.isArray(x.throughput)) invalido.push('status.throughput');
  if (!ehObj(x.cost)) invalido.push('status.cost');

  if (drift.length) return { ok: false, codigo: 'CONTRACT_DRIFT', motivos: drift.slice(0, 20) };
  if (invalido.length) return { ok: false, codigo: 'INVALID_PAYLOAD', motivos: invalido.slice(0, 20) };
  return { ok: true, status: x as unknown as StatusFactory };
}

// ---------------------------------------------------------------------------------------- projeção

/**
 * A task única por taskId entre `queue`, `blockers` e `humanGates` (a mesma task pode estar em mais de uma lista).
 * Escolha determinística: a de `updatedAt` mais recente, depois o estado em ordem alfabética — nunca a posição.
 */
function tarefasUnicas(s: StatusFactory): JobFactory[] {
  const porTask = new Map<string, JobFactory>();
  for (const t of [...s.queue, ...s.blockers, ...s.humanGates]) {
    const atual = porTask.get(t.taskId);
    if (!atual) { porTask.set(t.taskId, t); continue; }
    const d = Date.parse(t.updatedAt) - Date.parse(atual.updatedAt);
    if (d > 0 || (d === 0 && t.state < atual.state)) porTask.set(t.taskId, t);
  }
  return [...porTask.values()];
}

/**
 * O worker de uma task: exatamente um `WorkerStatus` com o MESMO taskId e a MESMA tentativa. Zero ou mais de um =
 * nenhum (ambiguidade não vira escolha). Título, repositório, papel e horário nunca entram.
 */
export function workerDaTask(task: Pick<JobFactory, 'taskId' | 'attempt'>, workers: readonly WorkerFactory[]): WorkerFactory | undefined {
  const cand = workers.filter((w) => w.taskId === task.taskId && w.attempt === task.attempt);
  return cand.length === 1 ? cand[0] : undefined;
}

export interface ProjecaoFactory {
  itens: MissionControlWorkItem[];
  eventos: MissionControlEvent[];
  /** workers cuja task não está em nenhuma lista: contados, não viram cartão (o evento deles ainda existe) */
  workersSemTarefa: number;
}

/**
 * TaskSummary → cartão. O estado é o da fábrica (autoridade do job); humanGates NÃO viram gateIds; o `ci` agregado
 * não entra em cartão nenhum; nada de título/URL como identidade.
 */
export function projetarStatusFactory(s: StatusFactory, ctx: ContextoNormalizacao): ProjecaoFactory {
  const tarefas = tarefasUnicas(s);
  const ids = new Set(tarefas.map((t) => t.taskId));
  return {
    itens: tarefas.map((t) => normalizarJobFactory(t, ctx, workerDaTask(t, s.workers))),
    eventos: eventosDaFactory(s),
    workersSemTarefa: s.workers.filter((w) => !ids.has(w.taskId)).length,
  };
}

/** Tipos que a API da fábrica PODE produzir hoje. Os demais exigem fato datado que o contrato não tem. */
export const EVENTOS_DA_API_FACTORY = ['WORKER_STARTED'] as const;

/**
 * Eventos confirmados pela API: WORKER_STARTED quando o WorkerStatus traz juntos taskId canônico, workerId e
 * startedAt. `updatedAt`, `state` (INTEGRATED/DONE), `humanGates` e `ci` agregado NÃO geram evento — seria fabricar
 * historicidade a partir de estado corrente ou de contador.
 */
export function eventosDaFactory(s: StatusFactory): MissionControlEvent[] {
  const eventos: MissionControlEvent[] = [];
  for (const w of s.workers) {
    if (!TASK_ID_CANONICO.test(w.taskId) || !w.workerId || !ehIso(w.startedAt)) continue;
    const sourceId = `${w.taskId}/a${w.attempt}/${w.workerId}`;
    eventos.push({
      id: idEvento('FACTORY', sourceId, 'WORKER_STARTED', w.startedAt),
      correlationId: w.taskId,
      tipo: 'WORKER_STARTED',
      tipoOrigem: 'worker.startedAt',
      ocorridoEm: w.startedAt,
      source: 'FACTORY',
      sourceId,
      ator: { tipo: 'WORKER', id: w.workerId, rotulo: ROTULO_MC_ATOR.WORKER },
      metadata: { tentativa: w.attempt, papel: w.role },
    });
  }
  return consolidarEventos(eventos);
}

// --------------------------------------------------------------------------------- porta e degradação

/**
 * A futura leitura real de `GET /api/factory/status` (W5). NINGUÉM a implementa nesta rodada: não há transporte, URL,
 * autenticação nem segredo. Quem for implementar devolve o CORPO CRU; validação, projeção e degradação são deste
 * módulo e de `statusServidor.ts`.
 */
export interface FactoryReadPort {
  lerStatus(sinal?: AbortSignal): Promise<unknown>;
}

export const SITUACOES_FONTE_FACTORY = ['NOT_CONFIGURED', 'UNAVAILABLE', 'STALE', 'LIVE'] as const;
export type SituacaoFonteFactory = (typeof SITUACOES_FONTE_FACTORY)[number];

/** A resposta da fábrica envelhece rápido: workers mudam de turno em segundos. */
export const LIMITE_STALE_FACTORY_S = 120;

export type LeituraFactory =
  | { ok: true; observadoEm: string; status: StatusFactory }
  | { ok: false; observadoEm: string; codigo: CodigoFalhaFactory; motivos?: string[] };

export interface EstadoFonteFactory {
  fonte: 'FACTORY';
  situacao: SituacaoFonteFactory;
  /** quando lemos com sucesso; null sem leitura boa */
  observadoEm: string | null;
  /** quando a fábrica gerou a resposta (`generatedAt`); é ele que decide STALE */
  geradoEm: string | null;
  erroCodigo?: CodigoFalhaFactory;
  /** tasks e workers lidos; null quando não há leitura — ausência não é zero */
  tarefas: number | null;
  workers: number | null;
  /** estado da fábrica (RUNNING, PAUSED…); null sem leitura */
  estadoFabrica: EstadoFabrica | null;
}

/**
 * Situação da fonte Factory. Sem porta = NOT_CONFIGURED (hoje, sempre). Falha ou payload recusado = UNAVAILABLE com
 * o código. Resposta com `generatedAt` além do limite = STALE. LIVE só com leitura boa e fresca — o que, nesta
 * rodada, não acontece em produção porque nenhuma porta é injetada.
 */
export function avaliarFonteFactory(leitura: LeituraFactory | null, agora: string, limiteSegundos = LIMITE_STALE_FACTORY_S): EstadoFonteFactory {
  const vazio = { fonte: 'FACTORY' as const, observadoEm: null, geradoEm: null, tarefas: null, workers: null, estadoFabrica: null };
  if (!leitura) return { ...vazio, situacao: 'NOT_CONFIGURED', erroCodigo: 'NOT_CONFIGURED' };
  if (!leitura.ok) return { ...vazio, situacao: 'UNAVAILABLE', erroCodigo: leitura.codigo };
  const s = leitura.status;
  const idade = avaliarFrescor({ observadoEm: s.generatedAt, agora, limiteStaleSegundos: limiteSegundos });
  return {
    fonte: 'FACTORY',
    situacao: idade.stale ? 'STALE' : 'LIVE',
    observadoEm: leitura.observadoEm,
    geradoEm: s.generatedAt,
    tarefas: tarefasUnicas(s).length,
    workers: s.workers.length,
    estadoFabrica: s.factory.state,
  };
}

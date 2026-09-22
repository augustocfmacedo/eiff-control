// Mission Control Live — contrato canonico do item de trabalho e do evento.
//
// Este modulo e a FRONTEIRA DE NORMALIZACAO do Mission Control:
//
//     FONTE REAL  ->  ADAPTER  ->  NORMALIZACAO (aqui)  ->  MissionControlWorkItem  ->  UI
//
// A UI nunca interpreta estado cru de Factory, GitHub ou Maquina Comercial. Em compensacao, o estado cru
// NUNCA e escondido: todo item carrega `statusOrigem`, e a tela mostra "Em validacao · CI_RUNNING".
//
// Regras que este modulo existe para garantir (cada uma tem teste em workItem.test.ts):
//   1. O Mission Control NAO e autoridade de estado. Ele observa, normaliza e projeta. Nao ha setter aqui.
//   2. `id` e determinstico (`${source}:${sourceId}`) e `correlationId` e SEMPRE derivado de identidade
//      canonica existente — para a fabrica, o `taskId`. Nada aleatorio, nada gerado.
//   3. A mesma entidade nunca vira dois cartoes: `consolidarWorkItems` funde o que tem a mesma correlacao.
//   4. Fonte fora do ar nao vira dado falso: `preservarUltimoConhecido` mantem o ultimo estado observado e
//      marca `fonteIndisponivel`; `avaliarFrescor` marca `stale`. Nunca se inventa estado.
//   5. Bloqueio POR DESENHO (seguranca intencional) nunca aparece como falha.
//
// PUREZA: zero fetch, zero store, zero React, zero Supabase, zero SDK do GitHub. Um teste varre este
// arquivo atras desses imports.
//
// ESPELHO DO CONTRATO DA FABRICA: a autoridade dos estados da fabrica e, e continua sendo,
// `packages/contracts/src/estados.ts` e `packages/contracts/src/api.ts` no repositorio eiff-dev-factory.
// Como os dois repositorios sao separados, aqui existe um ESPELHO declarado — e um teste de contract drift
// que abre o arquivo da fabrica (quando o repositorio esta ao lado) e reprova qualquer divergencia. Nao
// existe "segunda enumeracao quase igual": existe um espelho com detector de divergencia.
import type { Evidencia, Gate } from './missionControl';

// ---------------------------------------------------------------------- espelho do contrato da fabrica

/** Onde vive a AUTORIDADE dos catalogos espelhados abaixo (repositorio eiff-dev-factory). */
export const CONTRATO_FACTORY = {
  repositorio: 'augustocfmacedo/eiff-dev-factory',
  estados: 'packages/contracts/src/estados.ts',
  api: 'packages/contracts/src/api.ts',
  /** variavel de ambiente que aponta para o clone local, usada so pelo teste de drift */
  envRepoLocal: 'EIFF_FACTORY_REPO',
  /** caminho tentado por padrao quando os dois repositorios sao irmaos no disco */
  repoLocalPadrao: '../eiff-dev-factory',
} as const;

/** ESPELHO de JOB_STATES. Autoridade: CONTRATO_FACTORY.estados. Divergencia reprova no teste de drift. */
export const ESPELHO_JOB_STATES = [
  'BACKLOG', 'SPEC_READY', 'ARCH_APPROVED', 'READY', 'CLAIMED', 'CODING', 'TESTING', 'PR_OPEN',
  'CI_RUNNING', 'ARCH_REVIEW', 'QA_REVIEW', 'INTEGRATED', 'BLOCKED', 'AWAITING_HUMAN', 'DONE',
] as const;
export type EstadoJobFactory = (typeof ESPELHO_JOB_STATES)[number];

/** ESPELHO de LANES. */
export const ESPELHO_LANES = ['GREEN', 'AMBER', 'RED'] as const;
export type LaneFactory = (typeof ESPELHO_LANES)[number];

/** ESPELHO de WORKER_ROLES. */
export const ESPELHO_WORKER_ROLES = ['worker', 'integrator', 'fixer', 'verifier'] as const;
export type PapelWorkerFactory = (typeof ESPELHO_WORKER_ROLES)[number];

/** ESPELHO de FACTORY_STATES (estado da fabrica, nao do job). */
export const ESPELHO_FACTORY_STATES = ['RUNNING', 'PAUSED', 'DEGRADED', 'EMERGENCY_STOP'] as const;
export type EstadoFabrica = (typeof ESPELHO_FACTORY_STATES)[number];

/** ESPELHO de COMMENT_KINDS — os eventos que a fabrica escreve na issue. */
export const ESPELHO_COMMENT_KINDS = [
  'SPEC_WRITTEN', 'ARCH_APPROVE_SPEC', 'ARCH_RETURN_SPEC', 'ADMITTED', 'CLAIMED', 'LEASE_EXPIRED',
  'WORKER_REPORT', 'CI_RESULT', 'ARCH_REVIEW', 'ARCH_DECISION_DISCARDED', 'HUMAN_DECISION', 'INTEGRATED',
  'BLOCKED', 'REPLANNED', 'DONE', 'MODEL_ESCALATION', 'RECONCILED',
] as const;
export type ComentarioFactory = (typeof ESPELHO_COMMENT_KINDS)[number];

/** ESPELHO de ACTORS. */
export const ESPELHO_ACTORS = ['architect', 'dispatcher', 'supervisor', 'integrator', 'human'] as const;

// -------------------------------------------------------------------------------------- catalogos

/**
 * Situacao normalizada de um item de trabalho. Cada uma traduz estados que JA existem em alguma fonte —
 * nenhuma foi inventada para preencher coluna (ver STATUS_POR_ESTADO_FACTORY e STATUS_POR_CATEGORIA_CM).
 */
export const MC_STATUS = [
  'PROXIMO',
  'ARQUITETURA',
  'PRONTO',
  'EXECUTANDO',
  'AGUARDANDO_HUMANO',
  'BLOQUEADO',
  'EM_VALIDACAO',
  'CONCLUIDO',
] as const;
export type McStatus = (typeof MC_STATUS)[number];

/** Ordem de leitura do quadro de execucao. Nao e prioridade: e a ordem das colunas. */
export const ORDEM_MC_STATUS: Readonly<Record<McStatus, number>> = {
  PROXIMO: 1, ARQUITETURA: 2, PRONTO: 3, EXECUTANDO: 4,
  AGUARDANDO_HUMANO: 5, BLOQUEADO: 6, EM_VALIDACAO: 7, CONCLUIDO: 8,
};

export const ROTULO_MC_STATUS: Readonly<Record<McStatus, string>> = {
  PROXIMO: 'Próximos',
  ARQUITETURA: 'Arquitetura',
  PRONTO: 'Pronto para execução',
  EXECUTANDO: 'Em execução',
  AGUARDANDO_HUMANO: 'Aguardando humano',
  BLOQUEADO: 'Bloqueado',
  EM_VALIDACAO: 'Em validação',
  CONCLUIDO: 'Concluído',
};

/** De onde o item veio. GATE e o proprio Mission Control (curadoria com evidencia no repositorio). */
export const MC_FONTES = ['FACTORY', 'ARCHITECTURE', 'GITHUB', 'COMMERCIAL', 'GATE'] as const;
export type McFonte = (typeof MC_FONTES)[number];

/**
 * De ONDE o dado veio, que e outra pergunta: um job da fabrica lido pelas issues do GitHub e projecao,
 * nao estado operacional da fabrica. A UI precisa dizer isso com todas as letras (MC-LIVE-1, regra do
 * proprietario: "GitHub projection of Factory", nunca "Factory live operational state").
 */
export const PROCEDENCIAS = ['REPOSITORIO', 'GITHUB_PROJECTION', 'FACTORY_API', 'DATASET'] as const;
export type Procedencia = (typeof PROCEDENCIAS)[number];

export const ROTULO_PROCEDENCIA: Readonly<Record<Procedencia, string>> = {
  REPOSITORIO: 'curadoria do repositório',
  GITHUB_PROJECTION: 'projeção do GitHub',
  FACTORY_API: 'estado operacional da Factory',
  DATASET: 'dados do Control',
};

/**
 * Quem agiu. Agente NUNCA vira humano: se a acao foi do dispatcher, o ator e DISPATCHER.
 * Espelha ACTORS da fabrica e acrescenta os atores que existem so do lado do Control.
 */
export const MC_ATORES = [
  'HUMAN', 'ARCHITECT', 'DISPATCHER', 'SUPERVISOR', 'WORKER', 'INTEGRATOR',
  'GITHUB', 'COMMERCIAL_MACHINE', 'SYSTEM',
] as const;
export type McAtor = (typeof MC_ATORES)[number];

export const ROTULO_MC_ATOR: Readonly<Record<McAtor, string>> = {
  HUMAN: 'Humano',
  ARCHITECT: 'Architect',
  DISPATCHER: 'Dispatcher',
  SUPERVISOR: 'Supervisor',
  WORKER: 'Worker',
  INTEGRATOR: 'Integrator',
  GITHUB: 'GitHub',
  COMMERCIAL_MACHINE: 'Máquina Comercial',
  SYSTEM: 'Sistema',
};

/**
 * Sinal visual semantico. A UI escolhe token de cor a partir daqui, mas NUNCA depende so de cor:
 * ROTULO_MC_SINAL da o texto que acompanha (acessibilidade).
 * `desenho` existe para nao confundir seguranca intencional com falha — a mesma distincao que o
 * Mission Control ja faz hoje entre bloqueio real e bloqueio por desenho.
 */
export const MC_SINAIS = ['concluido', 'andamento', 'proximo', 'humano', 'bloqueado', 'desenho'] as const;
export type McSinal = (typeof MC_SINAIS)[number];

export const ROTULO_MC_SINAL: Readonly<Record<McSinal, string>> = {
  concluido: 'Concluído',
  andamento: 'Em andamento',
  proximo: 'Ainda não iniciado',
  humano: 'Aguardando decisão humana',
  bloqueado: 'Bloqueado',
  desenho: 'Fechado de propósito',
};

/** Token de cor do sistema visual. `destaque` e o "aguardando humano": nao e erro, mas pede atencao. */
export const COR_MC_SINAL: Readonly<Record<McSinal, 'verde' | 'amarelo' | 'cinza' | 'vermelho' | 'destaque' | 'info'>> = {
  concluido: 'verde',
  andamento: 'amarelo',
  proximo: 'cinza',
  humano: 'destaque',
  bloqueado: 'vermelho',
  desenho: 'info',
};

// ------------------------------------------------------------------------------- tipos do contrato

/** Idade do dado. Existe no tipo de proposito: nao ha item sem dizer quando foi observado. */
export interface Frescor {
  /** quando a fonte foi lida com sucesso pela ultima vez */
  observadoEm: string;
  /** passou do limite aceitavel para a fonte */
  stale: boolean;
  /** a fonte nao respondeu nesta leitura; o conteudo e o ultimo conhecido */
  fonteIndisponivel: boolean;
}

export interface BloqueioWorkItem {
  motivo: string;
  /** bloqueado DE PROPOSITO (seguranca intencional), nao por falta de trabalho */
  porDesenho: boolean;
  desde?: string;
}

export interface ResponsavelWorkItem {
  tipo: McAtor;
  /** id na fonte (login do GitHub, workerId, id do usuario do Control). Nunca inventado. */
  id?: string;
  rotulo: string;
}

export interface LinksWorkItem {
  repository?: string;
  branch?: string;
  commit?: string;
  pullRequest?: string;
  issue?: string;
}

/** Projecao. NAO e tabela, NAO e autoridade: e o que a tela recebe depois da normalizacao. */
export interface MissionControlWorkItem {
  /** determinstico: `${source}:${sourceId}` */
  id: string;
  /** derivado de identidade canonica da fonte (taskId na fabrica, id do gate no Mission Control) */
  correlationId?: string;
  source: McFonte;
  /** por qual caminho este dado chegou — projecao do GitHub nao e estado operacional da fabrica */
  procedencia: Procedencia;
  sourceId: string;
  title: string;
  status: McStatus;
  /** o estado CRU da fonte, sempre preservado e sempre exibido ao lado do normalizado */
  statusOrigem: string;
  workstreamId?: string;
  waveId?: string;
  gateIds?: string[];
  parentId?: string;
  dependsOn?: string[];
  responsavel?: ResponsavelWorkItem;
  startedAt?: string;
  /**
   * Quando o ESTADO mudou NA FONTE. Opcional de proposito (revisao da MC-LIVE-1): fonte que nao informa
   * data de alteracao fica sem `updatedAt` — nunca recebe `new Date()`, que seria fabricar historicidade.
   * O momento em que NOS observamos e outra coisa e mora em `frescor.observadoEm`.
   */
  updatedAt?: string;
  completedAt?: string;
  bloqueio?: BloqueioWorkItem;
  evidencias?: Evidencia[];
  links?: LinksWorkItem;
  /** obrigatorio: um item sem frescor seria uma afirmacao sem data */
  frescor: Frescor;
  /** numeros operacionais da fonte, quando existirem (turno do worker, tentativa, custo) */
  medidas?: Readonly<Record<string, number>>;
}

export const MC_TIPOS_EVENTO = [
  'WORK_ITEM_CREATED',
  'ARCHITECTURE_STARTED',
  'ARCHITECTURE_COMPLETED',
  'TASK_CREATED',
  'TASK_DISPATCHED',
  'WORKER_STARTED',
  'TASK_PROGRESS',
  'AWAITING_HUMAN',
  'BLOCKED',
  'TEST_STARTED',
  'TEST_PASSED',
  'TEST_FAILED',
  'COMMIT_CREATED',
  'PR_OPENED',
  'CI_STARTED',
  'CI_PASSED',
  'CI_FAILED',
  'MERGED',
  'GATE_CLOSED',
  'WORK_ITEM_COMPLETED',
] as const;
export type McTipoEvento = (typeof MC_TIPOS_EVENTO)[number];

export interface MissionControlEvent {
  /** determinstico: mesma ocorrencia lida duas vezes produz o MESMO id (idempotencia) */
  id: string;
  correlationId?: string;
  tipo: McTipoEvento;
  /**
   * O FATO BRUTO da fonte, antes da abstracao — o `statusOrigem` do evento (ex.: `WORKER_REPORT`,
   * `check_run:completed`). Obrigatorio: o Mission Control nunca deixa o tipo normalizado apagar o que a
   * fonte realmente disse.
   */
  tipoOrigem: string;
  ocorridoEm: string;
  source: McFonte;
  sourceId: string;
  ator: ResponsavelWorkItem;
  /** estados CRUS da fonte, nao normalizados: a timeline conta a verdade da fonte */
  de?: string;
  para?: string;
  motivo?: string;
  evidencia?: Evidencia;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

// ---------------------------------------------------------------- normalizacao: fabrica -> work item

/**
 * Traducao dos 15 estados do job (TASK_STATE_MACHINE.md) para as situacoes do quadro.
 * Mapa TOTAL: um teste confere que todo estado do espelho esta aqui.
 *
 * BACKLOG/SPEC_READY/ARCH_APPROVED sao ARQUITETURA porque a demanda ja existe e esta sob tratamento
 * arquitetural — e o que permite acompanhar a demanda desde o BACKLOG sem criar segunda fonte de verdade.
 */
export const STATUS_POR_ESTADO_FACTORY: Readonly<Record<EstadoJobFactory, McStatus>> = {
  BACKLOG: 'ARQUITETURA',
  SPEC_READY: 'ARQUITETURA',
  ARCH_APPROVED: 'ARQUITETURA',
  READY: 'PRONTO',
  CLAIMED: 'EXECUTANDO',
  CODING: 'EXECUTANDO',
  TESTING: 'EXECUTANDO',
  PR_OPEN: 'EM_VALIDACAO',
  CI_RUNNING: 'EM_VALIDACAO',
  ARCH_REVIEW: 'EM_VALIDACAO',
  INTEGRATED: 'EM_VALIDACAO',
  QA_REVIEW: 'AGUARDANDO_HUMANO',
  AWAITING_HUMAN: 'AGUARDANDO_HUMANO',
  BLOCKED: 'BLOQUEADO',
  DONE: 'CONCLUIDO',
};

/**
 * Quem esta com a bola em cada estado. Derivado da coluna "Quem sai dele" de TASK_STATE_MACHINE.md.
 * ARCH_APPROVED depende da lane: RED vai para Augusto, o resto para o dispatcher.
 */
export const ATOR_POR_ESTADO_FACTORY: Readonly<Record<EstadoJobFactory, McAtor>> = {
  BACKLOG: 'ARCHITECT',
  SPEC_READY: 'ARCHITECT',
  ARCH_APPROVED: 'DISPATCHER',
  READY: 'DISPATCHER',
  CLAIMED: 'SUPERVISOR',
  CODING: 'WORKER',
  TESTING: 'WORKER',
  PR_OPEN: 'GITHUB',
  CI_RUNNING: 'GITHUB',
  ARCH_REVIEW: 'ARCHITECT',
  QA_REVIEW: 'HUMAN',
  INTEGRATED: 'INTEGRATOR',
  BLOCKED: 'ARCHITECT',
  AWAITING_HUMAN: 'HUMAN',
  DONE: 'SYSTEM',
};

/** Espelho de TaskSummarySchema (packages/contracts/src/api.ts). So leitura. */
export interface JobFactory {
  taskId: string;
  title: string;
  repository: string;
  state: EstadoJobFactory;
  risk: LaneFactory;
  role: PapelWorkerFactory;
  attempt: number;
  priority: number;
  issueUrl: string;
  prUrl: string | null;
  headSha: string | null;
  updatedAt: string;
  costUsd: number;
}

/** Espelho de WorkerStatusSchema. Enriquece o cartao do job que esta rodando. */
export interface WorkerFactory {
  workerId: string;
  taskId: string;
  attempt: number;
  role: PapelWorkerFactory;
  phase: 'starting' | 'coding' | 'testing' | 'reporting';
  turn: number;
  maxTurns: number;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  startedAt: string;
  durationSec: number;
  costUsd: number;
  model: string;
  lastTool: string;
}

export interface ContextoNormalizacao {
  /** quando a fonte foi lida com sucesso */
  observadoEm: string;
  /** relogio da avaliacao de frescor */
  agora: string;
  /** acima disso o dado e stale; por fonte, porque worker envelhece em segundos e gate em dias */
  limiteStaleSegundos: number;
  /** a fonte nao respondeu nesta leitura */
  fonteIndisponivel?: boolean;
}

const seg = (a: string, b: string): number => Math.abs(Date.parse(b) - Date.parse(a)) / 1000;

/** Frescor de uma leitura. Data invalida nunca vira "fresco": na duvida, stale. */
export function avaliarFrescor(ctx: ContextoNormalizacao): Frescor {
  const dt = seg(ctx.observadoEm, ctx.agora);
  const invalido = Number.isNaN(dt);
  return {
    observadoEm: ctx.observadoEm,
    stale: invalido || dt > ctx.limiteStaleSegundos || ctx.fonteIndisponivel === true,
    fonteIndisponivel: ctx.fonteIndisponivel === true,
  };
}

/** id determinstico do item. Nunca aleatorio, nunca dependente da ordem de leitura. */
export function idWorkItem(source: McFonte, sourceId: string): string {
  const s = sourceId.trim();
  if (!s) throw new Error('sourceId vazio: work item sem identidade na fonte');
  return `${source}:${s}`;
}

/** id determinstico do evento: a mesma ocorrencia lida duas vezes e o mesmo evento. */
export function idEvento(source: McFonte, sourceId: string, tipo: McTipoEvento, ocorridoEm: string): string {
  return [source, sourceId.trim(), tipo, ocorridoEm].join('|');
}

const responsavel = (tipo: McAtor, id?: string): ResponsavelWorkItem => ({ tipo, id, rotulo: ROTULO_MC_ATOR[tipo] });

/**
 * Job da fabrica -> item do quadro. A correlacao e o proprio `taskId`: identidade canonica que ja existe,
 * nunca um id novo. Tudo que o GitHub sabe sobre a mesma task (branch, commit, PR, CI) entra DEPOIS por
 * `consolidarWorkItems`, no mesmo cartao.
 */
export function normalizarJobFactory(job: JobFactory, ctx: ContextoNormalizacao, worker?: WorkerFactory): MissionControlWorkItem {
  const ator = job.state === 'ARCH_APPROVED' && job.risk === 'RED' ? 'HUMAN' : ATOR_POR_ESTADO_FACTORY[job.state];
  const medidas: Record<string, number> = { tentativa: job.attempt, prioridade: job.priority, custoUsd: job.costUsd };
  if (worker) {
    medidas.turno = worker.turn;
    medidas.maxTurnos = worker.maxTurns;
    medidas.duracaoSeg = worker.durationSec;
  }
  return {
    id: idWorkItem('FACTORY', job.taskId),
    correlationId: job.taskId,
    source: 'FACTORY',
    procedencia: 'FACTORY_API',
    sourceId: job.taskId,
    title: job.title,
    status: STATUS_POR_ESTADO_FACTORY[job.state],
    statusOrigem: job.state,
    responsavel: responsavel(ator, worker?.workerId),
    startedAt: worker?.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.state === 'DONE' ? job.updatedAt : undefined,
    bloqueio: job.state === 'BLOCKED'
      ? { motivo: `Job bloqueado na fábrica após ${job.attempt} tentativa(s).`, porDesenho: false, desde: job.updatedAt }
      : undefined,
    links: {
      repository: job.repository,
      issue: job.issueUrl,
      pullRequest: job.prUrl ?? undefined,
      commit: job.headSha ?? undefined,
    },
    frescor: avaliarFrescor(ctx),
    medidas,
  };
}

// ------------------------------------------------------------------- normalizacao: gate -> work item

/**
 * Gate do Mission Control -> item do quadro. O gate continua sendo a autoridade de prontidao; isto aqui e
 * so a leitura dele no mesmo quadro dos demais. Bloqueio por desenho VIAJA: nunca vira falha.
 */
export function normalizarGate(g: Gate, ctx: ContextoNormalizacao, workstreamId?: string): MissionControlWorkItem {
  const status: McStatus = g.situacao === 'fechado' ? 'CONCLUIDO' : g.situacao === 'bloqueado' ? 'BLOQUEADO' : 'PROXIMO';
  return {
    id: idWorkItem('GATE', g.id),
    correlationId: g.id,
    source: 'GATE',
    procedencia: 'REPOSITORIO',
    sourceId: g.id,
    title: g.titulo,
    status,
    statusOrigem: g.situacao,
    workstreamId,
    gateIds: [g.id],
    dependsOn: g.dependeDe,
    // o gate nao tem data de alteracao na fonte (o repositorio muda por commit): nada e inventado aqui
    bloqueio: g.situacao === 'bloqueado'
      ? { motivo: g.bloqueio ?? '', porDesenho: g.porDesenho === true }
      : undefined,
    evidencias: g.evidencias,
    frescor: avaliarFrescor(ctx),
  };
}

// ------------------------------------------------------- normalizacao: Maquina Comercial -> work item

/**
 * Traducao das categorias da Commercial Queue. MISSION CONTROL SO CONTA E EXIBE: prioridade, ordem,
 * decisao, canal e acao continuam inteiramente na Maquina Comercial (src/core/radar/commercialMachine.ts).
 * Por isso a entrada aqui e uma forma minima, e `normalizarComerciais` preserva a ordem recebida.
 */
export const STATUS_POR_CATEGORIA_CM: Readonly<Record<string, McStatus>> = {
  AGIR_AGORA: 'PRONTO',
  AVANCAR_OPORTUNIDADE: 'PRONTO',
  FOLLOW_UP: 'PRONTO',
  PROSPECTAR: 'PRONTO',
  REVISAR: 'AGUARDANDO_HUMANO',
  ENRIQUECER: 'AGUARDANDO_HUMANO',
  NURTURE: 'PROXIMO',
  AGENDADO: 'PROXIMO',
};

export interface EntradaComercial {
  /** identidade canonica do item da fila (itemIdCM), nunca gerada aqui */
  itemId: string;
  empresaId: string;
  titulo: string;
  categoria: string;
  atualizadoEm: string;
  responsavelId?: string;
  /** trava bloqueante ja decidida pela Maquina Comercial */
  trava?: { codigo: string; texto: string };
}

export function normalizarItemComercial(e: EntradaComercial, ctx: ContextoNormalizacao): MissionControlWorkItem {
  const status = e.trava ? 'BLOQUEADO' : (STATUS_POR_CATEGORIA_CM[e.categoria] ?? 'PROXIMO');
  return {
    id: idWorkItem('COMMERCIAL', e.itemId),
    correlationId: e.itemId,
    source: 'COMMERCIAL',
    procedencia: 'DATASET',
    sourceId: e.itemId,
    title: e.titulo,
    status,
    statusOrigem: e.categoria,
    responsavel: responsavel('COMMERCIAL_MACHINE', e.responsavelId),
    updatedAt: e.atualizadoEm,
    bloqueio: e.trava ? { motivo: e.trava.texto, porDesenho: false } : undefined,
    frescor: avaliarFrescor(ctx),
  };
}

/** Preserva a ordem recebida: a fila e da Maquina Comercial, e o Mission Control nao reordena nada. */
export const normalizarComerciais = (itens: readonly EntradaComercial[], ctx: ContextoNormalizacao): MissionControlWorkItem[] =>
  itens.map((e) => normalizarItemComercial(e, ctx));

// ------------------------------------------------------ normalizacao: GitHub (projecao) -> work item

/**
 * Formas MINIMAS de entrada, declaradas aqui de proposito: a fronteira de normalizacao nao importa o
 * adapter (evita ciclo e mantem este modulo puro). `githubAdapter.ts` produz objetos compativeis.
 *
 * REGRA DA MC-LIVE-1: isto e PROJECAO DO GITHUB da fabrica, nao o estado operacional dela. Por isso
 * `procedencia: 'GITHUB_PROJECTION'` e por isso nada de heartbeat, turno, lease, custo ou ultima
 * ferramenta — esses dados NAO existem nesta fonte e inventa-los seria mentir sobre a operacao.
 */
export interface EntradaIssueFactory {
  repositorio: string;
  numero: number;
  titulo: string;
  /** vindo da label `factory:state:*`; null quando a issue nao declara estado de job */
  estadoFactory: EstadoJobFactory | null;
  /** vindo da label `factory:risk:*`; usado so para saber se a decisao e do humano (lane RED) */
  lane?: LaneFactory | null;
  taskId: string | null;
  estadoGitHub: 'open' | 'closed';
  criadoEm: string;
  atualizadoEm: string;
  fechadaEm?: string;
  url: string;
}

export interface EntradaPullRequest {
  repositorio: string;
  numero: number;
  titulo: string;
  branch: string;
  headSha: string;
  rascunho: boolean;
  taskId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  url: string;
}

/** Identidade canonica de uma issue/PR quando nao ha taskId: o proprio endereco no GitHub. */
export const refGitHub = (repositorio: string, numero: number): string => `${repositorio}#${numero}`;

export function normalizarIssueFactory(e: EntradaIssueFactory, ctx: ContextoNormalizacao): MissionControlWorkItem {
  const ref = refGitHub(e.repositorio, e.numero);
  // sem label de estado a issue e uma DEMANDA registrada, nao um job em execucao
  const status: McStatus = e.estadoFactory
    ? STATUS_POR_ESTADO_FACTORY[e.estadoFactory]
    : e.estadoGitHub === 'closed' ? 'CONCLUIDO' : 'ARQUITETURA';
  const ator = e.estadoFactory
    ? (e.estadoFactory === 'ARCH_APPROVED' && e.lane === 'RED' ? 'HUMAN' : ATOR_POR_ESTADO_FACTORY[e.estadoFactory])
    : undefined;
  return {
    id: idWorkItem(e.estadoFactory ? 'FACTORY' : 'ARCHITECTURE', ref),
    correlationId: e.taskId ?? ref,
    source: e.estadoFactory ? 'FACTORY' : 'ARCHITECTURE',
    procedencia: 'GITHUB_PROJECTION',
    sourceId: ref,
    title: e.titulo,
    status,
    // o fato bruto: o estado do job quando a label existe, senao o estado da propria issue
    statusOrigem: e.estadoFactory ?? `issue:${e.estadoGitHub}`,
    responsavel: ator ? responsavel(ator) : undefined,
    updatedAt: e.atualizadoEm,
    completedAt: e.fechadaEm,
    bloqueio: e.estadoFactory === 'BLOCKED'
      ? { motivo: 'Job bloqueado na fábrica (label factory:state:BLOCKED).', porDesenho: false, desde: e.atualizadoEm }
      : undefined,
    links: { repository: e.repositorio, issue: e.url },
    frescor: avaliarFrescor(ctx),
  };
}

/**
 * PR aberto = codigo em conferencia. O CI por PR NAO e lido aqui: uma chamada por cartao e exatamente o
 * que o desenho proibe. O CI que aparece no painel e o do `main` de cada repositorio.
 */
export function normalizarPullRequest(e: EntradaPullRequest, ctx: ContextoNormalizacao): MissionControlWorkItem {
  const ref = refGitHub(e.repositorio, e.numero);
  return {
    id: idWorkItem('GITHUB', ref),
    correlationId: e.taskId ?? ref,
    source: 'GITHUB',
    procedencia: 'GITHUB_PROJECTION',
    sourceId: ref,
    title: e.titulo,
    status: 'EM_VALIDACAO',
    statusOrigem: e.rascunho ? 'pr:draft' : 'pr:open',
    responsavel: responsavel('GITHUB'),
    updatedAt: e.atualizadoEm,
    links: { repository: e.repositorio, pullRequest: e.url, branch: e.branch, commit: e.headSha },
    frescor: avaliarFrescor(ctx),
  };
}

// --------------------------------------------------------------------------------- consolidacao

/** Precedencia de fonte quando dois itens falam da MESMA correlacao. Quem tem estado operacional manda. */
const PRECEDENCIA: Readonly<Record<McFonte, number>> = { FACTORY: 4, ARCHITECTURE: 3, GITHUB: 2, COMMERCIAL: 2, GATE: 1 };

const juntarLinks = (a?: LinksWorkItem, b?: LinksWorkItem): LinksWorkItem | undefined => {
  if (!a && !b) return undefined;
  return { ...(b ?? {}), ...Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v !== undefined)) };
};

/**
 * A mesma entidade nunca vira dois cartoes.
 *   - id repetido: fica o mais recente.
 *   - correlacao repetida em fontes diferentes: fica o item da fonte de maior precedencia, ENRIQUECIDO
 *     com os links e as evidencias da outra (o GitHub complementa a Factory, nao compete com ela).
 * A ordem de saida e a ordem de entrada do item que sobreviveu — a funcao nao ordena nada.
 */
/** Data de comparacao: sem `updatedAt` na fonte, o item e o mais ANTIGO possivel — nunca "agora". */
const quando = (i: MissionControlWorkItem): number => (i.updatedAt ? Date.parse(i.updatedAt) : -Infinity);

export function consolidarWorkItems(itens: readonly MissionControlWorkItem[]): MissionControlWorkItem[] {
  const porId = new Map<string, MissionControlWorkItem>();
  const ordem: string[] = [];
  for (const it of itens) {
    const anterior = porId.get(it.id);
    if (!anterior) { porId.set(it.id, it); ordem.push(it.id); continue; }
    porId.set(it.id, quando(it) >= quando(anterior) ? { ...it, links: juntarLinks(it.links, anterior.links) } : anterior);
  }

  const porCorrelacao = new Map<string, string>();
  const saida: string[] = [];
  const resultado = new Map<string, MissionControlWorkItem>();
  for (const id of ordem) {
    const it = porId.get(id)!;
    const c = it.correlationId;
    if (!c) { resultado.set(id, it); saida.push(id); continue; }
    const donoId = porCorrelacao.get(c);
    if (donoId === undefined) { porCorrelacao.set(c, id); resultado.set(id, it); saida.push(id); continue; }
    const dono = resultado.get(donoId)!;
    const vence = PRECEDENCIA[it.source] > PRECEDENCIA[dono.source] ? it : dono;
    const perde = vence === it ? dono : it;
    const fundido: MissionControlWorkItem = {
      ...vence,
      links: juntarLinks(vence.links, perde.links),
      evidencias: [...(vence.evidencias ?? []), ...(perde.evidencias ?? [])].length ? [...(vence.evidencias ?? []), ...(perde.evidencias ?? [])] : undefined,
      gateIds: [...new Set([...(vence.gateIds ?? []), ...(perde.gateIds ?? [])])].length ? [...new Set([...(vence.gateIds ?? []), ...(perde.gateIds ?? [])])] : undefined,
    };
    resultado.set(donoId, fundido);
    porCorrelacao.set(c, donoId);
  }
  return saida.map((id) => resultado.get(id)!);
}

// ------------------------------------------------------------------------------------ degradacao

/**
 * Fonte fora do ar NUNCA vira dado falso. Sem leitura nova, o item anterior e preservado e marcado como
 * indisponivel/stale. Sem item anterior, nao ha item: a tela mostra a ausencia, nao um estado inventado.
 */
export function preservarUltimoConhecido(
  anterior: MissionControlWorkItem | undefined,
  novo: MissionControlWorkItem | undefined,
): MissionControlWorkItem | undefined {
  if (novo) return novo;
  if (!anterior) return undefined;
  return { ...anterior, frescor: { observadoEm: anterior.frescor.observadoEm, stale: true, fonteIndisponivel: true } };
}

// ---------------------------------------------------------------------------------------- eventos

/**
 * Comentario estruturado da fabrica -> evento normalizado.
 *
 * REVISAO DA MC-LIVE-1 (regra do proprietario): o Mission Control NAO INFERE resultado. `WORKER_REPORT`
 * sozinho nao prova teste verde: so vira TEST_PASSED/TEST_FAILED quando a fonte entrega um campo
 * estruturado e canonico com o resultado (`ok`). Sem esse campo, o evento fica em TASK_PROGRESS e o fato
 * bruto sobrevive em `tipoOrigem`. Vale para qualquer evento: nenhum texto livre vira estado operacional.
 */
export function tipoEventoDoComentario(kind: ComentarioFactory, ok?: boolean): McTipoEvento {
  switch (kind) {
    case 'SPEC_WRITTEN': return 'ARCHITECTURE_STARTED';
    case 'ARCH_APPROVE_SPEC': return 'ARCHITECTURE_COMPLETED';
    case 'ADMITTED': return 'TASK_DISPATCHED';
    case 'CLAIMED': return 'WORKER_STARTED';
    case 'WORKER_REPORT': return ok === undefined ? 'TASK_PROGRESS' : ok ? 'TEST_PASSED' : 'TEST_FAILED';
    case 'CI_RESULT': return ok === undefined ? 'TASK_PROGRESS' : ok ? 'CI_PASSED' : 'CI_FAILED';
    case 'HUMAN_DECISION': return 'AWAITING_HUMAN';
    case 'INTEGRATED': return 'MERGED';
    case 'BLOCKED': return 'BLOCKED';
    case 'DONE': return 'WORK_ITEM_COMPLETED';
    default: return 'TASK_PROGRESS';
  }
}

/** O par completo: tipo normalizado + fato bruto preservado. E esta a porta que os adapters usam. */
export const eventoDoComentario = (kind: ComentarioFactory, ok?: boolean): { tipo: McTipoEvento; tipoOrigem: string } =>
  ({ tipo: tipoEventoDoComentario(kind, ok), tipoOrigem: kind });

/** Ordem consistente e estavel: por data, e no empate pelo id determinstico. */
export function ordenarEventos(eventos: readonly MissionControlEvent[]): MissionControlEvent[] {
  return [...eventos].sort((a, b) => {
    const d = Date.parse(a.ocorridoEm) - Date.parse(b.ocorridoEm);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/** Deduplica por id: a mesma ocorrencia lida em duas coletas nao vira dois eventos. */
export function consolidarEventos(eventos: readonly MissionControlEvent[]): MissionControlEvent[] {
  const m = new Map<string, MissionControlEvent>();
  for (const e of eventos) if (!m.has(e.id)) m.set(e.id, e);
  return ordenarEventos([...m.values()]);
}

// ------------------------------------------------------------------------------------ apresentacao

/** Sinal do item. Bloqueio por desenho tem sinal proprio: seguranca intencional nao e falha. */
export function sinalDoItem(item: MissionControlWorkItem): McSinal {
  if (item.bloqueio?.porDesenho) return 'desenho';
  switch (item.status) {
    case 'CONCLUIDO': return 'concluido';
    case 'BLOQUEADO': return 'bloqueado';
    case 'AGUARDANDO_HUMANO': return 'humano';
    case 'EXECUTANDO':
    case 'EM_VALIDACAO':
    case 'ARQUITETURA': return 'andamento';
    default: return 'proximo';
  }
}

/** O texto que a tela mostra: normalizado E cru, sempre juntos. Ex.: "Em validação · CI_RUNNING". */
export const descricaoStatus = (item: MissionControlWorkItem): string =>
  `${ROTULO_MC_STATUS[item.status]} · ${item.statusOrigem}`;

/** Agrupamento por coluna do quadro, na ordem declarada. Nao reordena dentro da coluna. */
export function porStatus(itens: readonly MissionControlWorkItem[]): { status: McStatus; itens: MissionControlWorkItem[] }[] {
  return [...MC_STATUS]
    .sort((a, b) => ORDEM_MC_STATUS[a] - ORDEM_MC_STATUS[b])
    .map((status) => ({ status, itens: itens.filter((i) => i.status === status) }));
}

/** Contagens do cabecalho. Derivadas: nenhum numero do Mission Control e digitado. */
export function contarPorStatus(itens: readonly MissionControlWorkItem[]): Readonly<Record<McStatus, number>> {
  const base = Object.fromEntries(MC_STATUS.map((s) => [s, 0])) as Record<McStatus, number>;
  for (const i of itens) base[i.status] += 1;
  return base;
}

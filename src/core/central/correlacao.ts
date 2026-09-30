// MC-LIVE-3 — correlacao de work items e eventos confirmados.
//
// Este modulo responde duas perguntas sobre um item do quadro, e so com o que a fonte PROVA:
//
//   1. CADEIA   issue → taskId → worker → branch → commit → PR → CI → merge → gate
//               Cada elo e CONFIRMADO (com valor e de onde veio) ou tem a ausencia NOMEADA:
//                 NAO_INFORMADO   a fonte le este elo, mas nao ha identidade que ligue o item a ele;
//                 NAO_DISPONIVEL  a fonte, do jeito que e lida hoje, nao traz este elo (nunca vai aparecer);
//                 NAO_OBSERVADO   a fonte traz este elo e a tarefa tem identidade, mas ele ainda nao apareceu.
//               Nenhum elo e deduzido de outro: branch nao e derivada de taskId + tentativa, CI do `main` nao e
//               CI da tarefa, e estado INTEGRATED na label nao e registro de merge.
//
//   2. EVENTOS  so fato COM data real da fonte:
//                 issue.created_at  → TASK_CREATED (com bloco canonico) ou WORK_ITEM_CREATED (sem);
//                 pull_request.created_at → PR_OPENED;
//                 issue.closed_at + label factory:state:DONE → WORK_ITEM_COMPLETED.
//               `updated_at` NUNCA vira evento (mudou alguma coisa, nao se sabe o que). WORKER_STARTED,
//               TEST_PASSED, CI_STARTED, CI_PASSED, MERGED e GATE_CLOSED exigem evento especifico da fonte ligado
//               a mesma tarefa — a projecao do GitHub nao le comentarios nem CI por PR, entao nao os produz.
//               Evento sem identidade segura sai SEM correlationId e so se liga ao proprio objeto de origem.
//
// Identidades permitidas (e so elas): `taskId` do bloco `factory-task:v1`, branch canonica `factory/<taskId>-a<n>`,
// identificador declarado pela fonte e gate explicito. Titulo, nome de modulo, prefixo, arquivo e texto livre NAO.
//
// PUREZA: zero fetch, zero store, zero React, zero Supabase. Nada aqui escreve em lugar nenhum.
import type { IssueObservada, LeituraGitHub, PullRequestObservado } from './githubAdapter';
import {
  ROTULO_MC_ATOR, TASK_ID_CANONICO, consolidarEventos, idEvento, refGitHub, taskIdDaBranchCanonica,
  type McTipoEvento, type MissionControlEvent, type MissionControlWorkItem, type OrigemCorrelacao, type Procedencia,
} from './workItem';

// ------------------------------------------------------------------------------------------ cadeia

export const ELOS_CADEIA = ['ISSUE', 'TASK_ID', 'WORKER', 'BRANCH', 'COMMIT', 'PR', 'CI', 'MERGE', 'GATE'] as const;
export type EloCadeia = (typeof ELOS_CADEIA)[number];

export const ROTULO_ELO: Readonly<Record<EloCadeia, string>> = {
  ISSUE: 'Issue', TASK_ID: 'taskId', WORKER: 'Worker', BRANCH: 'Branch', COMMIT: 'Commit',
  PR: 'Pull request', CI: 'CI da tarefa', MERGE: 'Merge', GATE: 'Gate',
};

export const ESTADOS_ELO = ['CONFIRMADO', 'NAO_INFORMADO', 'NAO_DISPONIVEL', 'NAO_OBSERVADO'] as const;
export type EstadoElo = (typeof ESTADOS_ELO)[number];

/** O texto da ausencia. Travessao mudo nao existe na cadeia: toda ausencia diz qual e. */
export const ROTULO_ESTADO_ELO: Readonly<Record<EstadoElo, string>> = {
  CONFIRMADO: 'confirmado',
  NAO_INFORMADO: 'não informado',
  NAO_DISPONIVEL: 'não disponível nesta fonte',
  NAO_OBSERVADO: 'ainda não observado',
};

export interface EloDaCadeia {
  elo: EloCadeia;
  estado: EstadoElo;
  /** so quando CONFIRMADO */
  valor?: string;
  href?: string;
  /** de onde veio o valor, ou por que ele falta — frase curta, sem dado da fonte alem do que ja esta no item */
  nota?: string;
}

/**
 * O que cada PROCEDENCIA le hoje. `true` = a fonte traz este elo quando ele existe; `false` = nao traz.
 * E uma tabela declarada, nao uma deducao: mudou a leitura da fonte, muda aqui (e o teste acompanha).
 *
 *   GITHUB_PROJECTION  issues `factory:task` abertas + PRs abertos + CI do `main`. Sem comentarios estruturados
 *                      (worker), sem CI por PR (seria uma chamada por cartao), sem PRs fechados (merge), e o bloco
 *                      da issue nao declara gate.
 *   FACTORY_API        `TaskSummary`: issueUrl, prUrl, headSha; o worker vem do `WorkerStatus`. Nao traz branch,
 *                      CI por tarefa, merge nem gate.
 *   REPOSITORIO        gate do catalogo: so o proprio gate.
 *   DATASET            fila comercial: nenhum elo de construcao.
 */
export const ELOS_LIDOS_POR_PROCEDENCIA: Readonly<Record<Procedencia, Readonly<Record<EloCadeia, boolean>>>> = {
  GITHUB_PROJECTION: { ISSUE: true, TASK_ID: true, WORKER: false, BRANCH: true, COMMIT: true, PR: true, CI: false, MERGE: false, GATE: false },
  FACTORY_API: { ISSUE: true, TASK_ID: true, WORKER: true, BRANCH: false, COMMIT: true, PR: true, CI: false, MERGE: false, GATE: false },
  REPOSITORIO: { ISSUE: false, TASK_ID: false, WORKER: false, BRANCH: false, COMMIT: false, PR: false, CI: false, MERGE: false, GATE: true },
  DATASET: { ISSUE: false, TASK_ID: false, WORKER: false, BRANCH: false, COMMIT: false, PR: false, CI: false, MERGE: false, GATE: false },
};

/** Por que um elo nunca aparece nesta fonte. Texto ao lado da regra, nunca no JSX. */
const MOTIVO_NAO_DISPONIVEL: Readonly<Record<Procedencia, Partial<Record<EloCadeia, string>>>> = {
  GITHUB_PROJECTION: {
    WORKER: 'A projeção do GitHub não lê o worker; ele só existe no estado operacional da Factory.',
    CI: 'O CI lido é o do main de cada repositório — não é o CI desta tarefa.',
    MERGE: 'Só pull requests abertos são lidos; o merge não aparece nesta fonte.',
    GATE: 'Nem a issue nem o pull request declaram a qual gate a tarefa pertence.',
  },
  FACTORY_API: {
    BRANCH: 'O contrato da API da Factory não traz a branch.',
    CI: 'O contrato da API da Factory não traz CI por tarefa.',
    MERGE: 'O contrato da API da Factory não traz o merge.',
    GATE: 'O contrato da API da Factory não declara gate.',
  },
  REPOSITORIO: {},
  DATASET: {},
};
const FORA_DA_CONSTRUCAO = 'Este item não é uma tarefa de construção: a fonte não tem este elo.';

const ROTULO_ORIGEM: Readonly<Record<OrigemCorrelacao, string>> = {
  BLOCO_DA_ISSUE: 'bloco factory-task:v1 da issue',
  BRANCH_CANONICA: 'branch canônica factory/<taskId>-a<n>',
  FACTORY_API: 'contrato da API da Factory',
  GATE: 'catálogo de gates',
  FONTE_DECLARADA: 'identificador declarado pela fonte',
};

/** Qual identidade liga o item. Derivado de `correlacaoPor` — nunca do texto do item. */
export const CHAVES_CORRELACAO = ['TASK_ID', 'GATE_ID', 'ITEM_DA_FONTE', 'SEM_CORRELACAO'] as const;
export type ChaveCorrelacao = (typeof CHAVES_CORRELACAO)[number];

export const ROTULO_CHAVE_CORRELACAO: Readonly<Record<ChaveCorrelacao, string>> = {
  TASK_ID: 'Correlacionado pelo taskId',
  GATE_ID: 'Correlacionado pelo id do gate',
  ITEM_DA_FONTE: 'Identificador declarado pela fonte',
  SEM_CORRELACAO: 'Sem identidade segura: o item vale só por ele mesmo',
};

const ORIGENS_DE_TASK: readonly OrigemCorrelacao[] = ['BLOCO_DA_ISSUE', 'BRANCH_CANONICA', 'FACTORY_API'];

/**
 * A chave do item. TASK_ID exige as DUAS coisas: uma origem permitida E o `correlationId` no formato canonico
 * ancorado — um `correlationId` qualquer, sem origem declarada, nunca vira tarefa correlacionada.
 */
export function chaveDeCorrelacao(item: Pick<MissionControlWorkItem, 'correlationId' | 'correlacaoPor'>): ChaveCorrelacao {
  const por = item.correlacaoPor ?? [];
  if (por.some((o) => ORIGENS_DE_TASK.includes(o)) && !!item.correlationId && TASK_ID_CANONICO.test(item.correlationId)) return 'TASK_ID';
  if (por.includes('GATE') && item.correlationId) return 'GATE_ID';
  if (por.includes('FONTE_DECLARADA') && item.correlationId) return 'ITEM_DA_FONTE';
  return 'SEM_CORRELACAO';
}

/** O taskId do item, SO quando a correlacao e segura. */
export const taskIdSeguro = (item: Pick<MissionControlWorkItem, 'correlationId' | 'correlacaoPor'>): string | undefined =>
  chaveDeCorrelacao(item) === 'TASK_ID' ? item.correlationId : undefined;

/** Valor de cada elo, lido SO de campos do item. Nada e composto nem deduzido. */
function valorDoElo(item: MissionControlWorkItem, elo: EloCadeia): { valor?: string; href?: string; nota?: string } {
  const l = item.links ?? {};
  switch (elo) {
    case 'ISSUE': return l.issue ? { valor: l.issue, href: l.issue } : {};
    case 'TASK_ID': {
      const t = taskIdSeguro(item);
      return t ? { valor: t, nota: `Pelo ${(item.correlacaoPor ?? []).filter((o) => ORIGENS_DE_TASK.includes(o)).map((o) => ROTULO_ORIGEM[o]).join(' e ')}.` } : {};
    }
    // MC-LIVE-3B: o worker so e confirmado pelo WorkerStatus da Factory ligado a PROPRIA task e tentativa
    // (`normalizarJobFactory` recusa qualquer outro); nunca por responsavel, titulo, papel ou horario
    case 'WORKER': return item.worker
      ? { valor: item.worker.workerId, nota: `Pelo WorkerStatus da Factory: tentativa ${item.worker.tentativa}, fase ${item.worker.fase}.` } : {};
    case 'BRANCH': return l.branch ? { valor: l.branch } : {};
    case 'COMMIT': return l.commit ? { valor: l.commit.slice(0, 7), nota: 'Commit na ponta do pull request.' } : {};
    case 'PR': return l.pullRequest ? { valor: l.pullRequest, href: l.pullRequest } : {};
    case 'CI': return {}; // o contrato do item nao carrega CI correlacionado; CI do main nao e da tarefa
    case 'MERGE': return {};
    case 'GATE': return item.gateIds?.length ? { valor: item.gateIds.join(', ') } : {};
  }
}

/**
 * A cadeia de um item. Ordem fixa (`ELOS_CADEIA`). Um elo ausente so e "ainda nao observado" quando a fonte le
 * aquele elo E o item tem identidade de tarefa para liga-lo; sem identidade, e "nao informado".
 */
export function cadeiaDoItem(item: MissionControlWorkItem): EloDaCadeia[] {
  const le = ELOS_LIDOS_POR_PROCEDENCIA[item.procedencia];
  const temTask = chaveDeCorrelacao(item) === 'TASK_ID';
  return ELOS_CADEIA.map((elo): EloDaCadeia => {
    const v = valorDoElo(item, elo);
    if (v.valor) return { elo, estado: 'CONFIRMADO', valor: v.valor, href: v.href, nota: v.nota };
    if (!le[elo]) return { elo, estado: 'NAO_DISPONIVEL', nota: MOTIVO_NAO_DISPONIVEL[item.procedencia][elo] ?? FORA_DA_CONSTRUCAO };
    if (elo === 'TASK_ID') return { elo, estado: 'NAO_INFORMADO', nota: 'Sem bloco factory-task:v1 válido nem branch canônica: título e texto livre não correlacionam.' };
    return temTask
      ? { elo, estado: 'NAO_OBSERVADO' }
      : { elo, estado: 'NAO_INFORMADO', nota: 'Sem taskId seguro, não há como ligar este elo ao item.' };
  });
}

// ----------------------------------------------------------------------------------------- eventos

/** Rotulo humano de cada tipo de evento. Mapa total sobre `MC_TIPOS_EVENTO` (teste confere). */
export const ROTULO_TIPO_EVENTO: Readonly<Record<McTipoEvento, string>> = {
  WORK_ITEM_CREATED: 'Demanda registrada',
  ARCHITECTURE_STARTED: 'Arquitetura iniciada',
  ARCHITECTURE_COMPLETED: 'Arquitetura aprovada',
  TASK_CREATED: 'Tarefa criada',
  TASK_DISPATCHED: 'Tarefa admitida',
  WORKER_STARTED: 'Worker iniciou',
  TASK_PROGRESS: 'Progresso registrado',
  AWAITING_HUMAN: 'Aguardando decisão humana',
  BLOCKED: 'Bloqueada',
  TEST_STARTED: 'Testes iniciados',
  TEST_PASSED: 'Testes passaram',
  TEST_FAILED: 'Testes falharam',
  COMMIT_CREATED: 'Commit criado',
  PR_OPENED: 'Pull request aberto',
  CI_STARTED: 'CI iniciado',
  CI_PASSED: 'CI passou',
  CI_FAILED: 'CI falhou',
  MERGED: 'Merge',
  GATE_CLOSED: 'Gate fechado',
  WORK_ITEM_COMPLETED: 'Concluída',
};

/**
 * Tipos que a projecao do GitHub PODE emitir. Os demais exigem evento especifico da fonte ligado a mesma tarefa
 * (comentario estruturado da fabrica, check run do PR, PR mesclado) — que esta fonte nao le.
 */
export const EVENTOS_DA_PROJECAO_GITHUB: readonly McTipoEvento[] = ['WORK_ITEM_CREATED', 'TASK_CREATED', 'PR_OPENED', 'WORK_ITEM_COMPLETED'];

const ATOR_GITHUB = { tipo: 'GITHUB' as const, rotulo: ROTULO_MC_ATOR.GITHUB };
const dataValida = (iso: string | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

function evento(tipo: McTipoEvento, tipoOrigem: string, ocorridoEm: string, sourceId: string, correlationId: string | undefined, metadata: Record<string, string | number | boolean>): MissionControlEvent {
  return {
    id: idEvento('GITHUB', sourceId, tipo, ocorridoEm),
    // sem identidade segura o campo NEM EXISTE: `undefined` explicito e o mesmo que ausente, e o teste confere
    ...(correlationId ? { correlationId } : {}),
    tipo, tipoOrigem, ocorridoEm, source: 'GITHUB', sourceId, ator: ATOR_GITHUB, metadata,
  };
}

/**
 * Eventos de UMA issue de job, so com datas da fonte. `atualizadoEm` e ignorado de proposito.
 * Com bloco canonico: TASK_CREATED correlacionado pelo taskId. Sem bloco: WORK_ITEM_CREATED sem correlationId.
 * Conclusao so com label DONE + issue fechada + `closed_at` (a fabrica fecha a issue por transicao, JOB_CONTRACT.md).
 */
export function eventosDaIssue(repositorio: string, i: IssueObservada): MissionControlEvent[] {
  const ref = refGitHub(repositorio, i.numero);
  const taskId = i.taskId && TASK_ID_CANONICO.test(i.taskId) ? i.taskId : undefined;
  const meta = { repositorio, numero: i.numero };
  const saida: MissionControlEvent[] = [];
  if (dataValida(i.criadoEm)) {
    saida.push(taskId
      ? evento('TASK_CREATED', 'issue.created_at', i.criadoEm, ref, taskId, meta)
      : evento('WORK_ITEM_CREATED', 'issue.created_at', i.criadoEm, ref, undefined, meta));
  }
  if (i.estadoFactory === 'DONE' && i.estadoGitHub === 'closed' && dataValida(i.fechadaEm)) {
    saida.push(evento('WORK_ITEM_COMPLETED', 'issue.closed_at+factory:state:DONE', i.fechadaEm, ref, taskId, meta));
  }
  return saida;
}

/** PR_OPENED na data de criacao do PR. Correlacao SO pela branch canonica; o titulo nao e lido para isso. */
export function eventosDoPullRequest(repositorio: string, p: PullRequestObservado): MissionControlEvent[] {
  if (!dataValida(p.criadoEm)) return [];
  const taskId = taskIdDaBranchCanonica(p.branch) ?? undefined;
  return [evento('PR_OPENED', 'pull_request.created_at', p.criadoEm, refGitHub(repositorio, p.numero), taskId,
    { repositorio, numero: p.numero, rascunho: p.rascunho })];
}

/**
 * Eventos da leitura inteira do GitHub, deduplicados e ordenados (`consolidarEventos`). Repositorio indisponivel
 * nao produz evento (ausencia nao e fato). O CI do `main` NUNCA vira evento: ele nao e de tarefa nenhuma.
 */
export function projetarEventos(leitura: LeituraGitHub): MissionControlEvent[] {
  const todos: MissionControlEvent[] = [];
  for (const r of leitura.repositorios) {
    if (!r.disponivel) continue;
    for (const i of r.issues) todos.push(...eventosDaIssue(r.repository, i));
    for (const p of r.pullRequests) todos.push(...eventosDoPullRequest(r.repository, p));
  }
  return consolidarEventos(todos);
}

/**
 * Eventos que pertencem a um item: pelo taskId, quando os dois tem correlacao de tarefa; senao, so o evento sem
 * correlacao que nasceu do MESMO objeto (`sourceId`). Um evento correlacionado nunca se liga a item sem taskId, e
 * um evento sem correlacao nunca se liga a outro objeto.
 */
export function eventosDoItem(item: MissionControlWorkItem, eventos: readonly MissionControlEvent[]): MissionControlEvent[] {
  const taskId = taskIdSeguro(item);
  return consolidarEventos(eventos.filter((e) => (e.correlationId
    ? !!taskId && e.correlationId === taskId
    : e.sourceId === item.sourceId)));
}

// ------------------------------------------------------------------------------------ diagnostico

/**
 * Dados operacionais PERMITIDOS da Factory para o detalhe da tarefa. So existe quando o item vem da API da fabrica
 * (`procedencia = FACTORY_API`); a projecao do GitHub nunca preenche — heartbeat, turno e custo nao existem la.
 */
export interface OperacionalFactory {
  estado: string;
  tentativa?: number;
  custoUsd?: number;
  turno?: number;
  maxTurnos?: number;
}

export function operacionalDoItem(item: MissionControlWorkItem): OperacionalFactory | undefined {
  if (item.procedencia !== 'FACTORY_API') return undefined;
  const m = item.medidas ?? {};
  return { estado: item.statusOrigem, tentativa: m.tentativa, custoUsd: m.custoUsd, turno: m.turno, maxTurnos: m.maxTurnos };
}

export interface DiagnosticoCorrelacao {
  itemId: string;
  chave: ChaveCorrelacao;
  /** so quando a chave e segura */
  correlationId?: string;
  /** origens da identidade, na ordem do catalogo */
  por: OrigemCorrelacao[];
  cadeia: EloDaCadeia[];
  confirmados: number;
  /** eventos confirmados do item, em ordem cronologica */
  eventos: MissionControlEvent[];
  /** so com a API da Factory; hoje, sem transporte real, sempre ausente */
  operacional?: OperacionalFactory;
}

/**
 * Diagnostico de correlacao de um item: qual identidade o liga, por onde ela veio, a cadeia com cada ausencia
 * nomeada e os eventos confirmados. Funcao pura; a tela so desenha o que sai daqui.
 */
export function diagnosticarCorrelacao(item: MissionControlWorkItem, eventos: readonly MissionControlEvent[] = []): DiagnosticoCorrelacao {
  const chave = chaveDeCorrelacao(item);
  const cadeia = cadeiaDoItem(item);
  const doItem = eventosDoItem(item, eventos);
  return {
    itemId: item.id,
    chave,
    correlationId: chave === 'SEM_CORRELACAO' ? undefined : item.correlationId,
    por: item.correlacaoPor ?? [],
    cadeia,
    confirmados: cadeia.filter((e) => e.estado === 'CONFIRMADO').length,
    eventos: doItem,
    operacional: operacionalDoItem(item),
  };
}

/** Data e hora de um evento no fuso da EIFF. Data invalida vira travessao, nunca "agora". */
export function dataHoraEvento(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(t));
}

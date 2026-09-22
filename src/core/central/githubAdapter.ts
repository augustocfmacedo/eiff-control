// Adapter do GitHub — SOMENTE LEITURA, com `fetch` injetado.
//
// Este modulo e a unica peca do EIFF Control que conhece o formato da API do GitHub. Tudo que sai daqui ja
// esta no contrato da casa; o payload cru do GitHub NUNCA atravessa esta fronteira (nem para a funcao, nem
// para o navegador). Mesma ideia de `metaServidor.ts` com a Graph API da Meta.
//
// Invariantes (cada uma tem teste em githubAdapter.test.ts):
//   1. `fetch` e injetado: a suite roda sem token e sem rede.
//   2. So os repositorios da ALLOWLIST sao consultados. Nao existe caminho que aceite repositorio vindo do
//      cliente — o endpoint nem oferece parametro.
//   3. Sem token: `NOT_CONFIGURED`. Nunca "lista vazia" como se fosse verdade.
//   4. Falha vira CODIGO FECHADO (`CodigoFalhaFonte`), nunca stack trace e nunca payload do GitHub.
//   5. Nada de header, URL autenticada, token ou objeto integral na saida.
//   6. Uma fonte ruim nao derruba as outras: cada repositorio tem seu proprio resultado.
//
// PUREZA: zero React, zero store, zero Supabase. A unica I/O e o `fetch` recebido por parametro.
import { ESPELHO_JOB_STATES, type EstadoJobFactory } from './workItem';

// ------------------------------------------------------------------------------------- allowlist

/** Papel do repositorio para o Mission Control. `fabrica` e o unico com issues de job. */
export type PapelRepositorio = 'produto' | 'fabrica';

export interface RepositorioObservavel {
  repository: string;
  papel: PapelRepositorio;
  ramoPrincipal: string;
  /** so a fabrica publica jobs como issue com label `factory:state:*` */
  observarIssues: boolean;
}

/**
 * ALLOWLIST server-side. E a unica lista de repositorios que o Mission Control consulta; o endpoint nao
 * aceita `?repo=` e nao ha como transformar a funcao num proxy do GitHub.
 */
export const REPOSITORIOS_OBSERVADOS: readonly RepositorioObservavel[] = [
  { repository: 'augustocfmacedo/eiff-control', papel: 'produto', ramoPrincipal: 'main', observarIssues: false },
  { repository: 'augustocfmacedo/eiff-dev-factory', papel: 'fabrica', ramoPrincipal: 'main', observarIssues: true },
];

export const ehRepositorioObservado = (r: string): boolean => REPOSITORIOS_OBSERVADOS.some((x) => x.repository === r);

// --------------------------------------------------------------------------------- falhas (fechado)

/** Catalogo FECHADO de falha de fonte. A UI nunca ve outra coisa; stack trace nunca sai daqui. */
export const CODIGOS_FALHA_FONTE = [
  'NOT_CONFIGURED',
  'AUTH_FAILURE',
  'PERMISSION_FAILURE',
  'RATE_LIMIT',
  'NETWORK_FAILURE',
  'INVALID_PAYLOAD',
  'NOT_FOUND',
  'SOURCE_UNAVAILABLE',
] as const;
export type CodigoFalhaFonte = (typeof CODIGOS_FALHA_FONTE)[number];

export const TEXTO_FALHA_FONTE: Readonly<Record<CodigoFalhaFonte, string>> = {
  NOT_CONFIGURED: 'Token de leitura do GitHub não configurado no servidor.',
  AUTH_FAILURE: 'O GitHub recusou a credencial de leitura.',
  PERMISSION_FAILURE: 'A credencial não tem permissão de leitura neste repositório.',
  RATE_LIMIT: 'Limite de chamadas do GitHub atingido.',
  NETWORK_FAILURE: 'Não foi possível falar com o GitHub.',
  INVALID_PAYLOAD: 'O GitHub respondeu num formato que não reconhecemos.',
  NOT_FOUND: 'Recurso não encontrado no GitHub.',
  SOURCE_UNAVAILABLE: 'GitHub indisponível.',
};

export class ErroGitHub extends Error {
  constructor(readonly codigo: CodigoFalhaFonte) { super(codigo); this.name = 'ErroGitHub'; }
}

/** Classificacao pelo status e pelo cabecalho de limite. 403 com limite zerado e RATE_LIMIT, nao permissao. */
export function classificarRespostaGitHub(status: number, limiteRestante: string | null): CodigoFalhaFonte {
  if (status === 401) return 'AUTH_FAILURE';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 403) return limiteRestante === '0' ? 'RATE_LIMIT' : 'PERMISSION_FAILURE';
  if (status === 404) return 'NOT_FOUND';
  return 'SOURCE_UNAVAILABLE';
}

// ----------------------------------------------------------------------------------- contrato de saida

export interface CommitPrincipal {
  sha: string;
  shaCurto: string;
  /** data do commit NA FONTE; ausente quando o GitHub nao informa (nunca preenchida com "agora") */
  commitadoEm?: string;
  titulo?: string;
}

export const SITUACOES_CI = ['VERDE', 'VERMELHO', 'RODANDO', 'SEM_CI', 'INDEFINIDO'] as const;
export type SituacaoCi = (typeof SITUACOES_CI)[number];

export const ROTULO_CI: Readonly<Record<SituacaoCi, string>> = {
  VERDE: 'CI verde', VERMELHO: 'CI vermelho', RODANDO: 'CI rodando', SEM_CI: 'sem CI', INDEFINIDO: 'CI indefinido',
};

export interface CiPrincipal {
  situacao: SituacaoCi;
  /** o estado CRU do GitHub, sempre preservado: `completed:success`, `in_progress`, … */
  statusOrigem: string;
  nome?: string;
  concluidoEm?: string;
  url?: string;
}

export interface PullRequestObservado {
  numero: number;
  titulo: string;
  branch: string;
  headSha: string;
  rascunho: boolean;
  criadoEm: string;
  atualizadoEm: string;
  url: string;
  /** derivado da branch/titulo quando existe; nunca inventado */
  taskId: string | null;
}

export interface IssueObservada {
  numero: number;
  titulo: string;
  /** estado do job lido da label `factory:state:*`; null quando a issue nao declara nenhum */
  estadoFactory: EstadoJobFactory | null;
  taskId: string | null;
  /** so labels `factory:*` — nenhuma label livre de terceiro entra */
  labelsFactory: string[];
  estadoGitHub: 'open' | 'closed';
  criadoEm: string;
  atualizadoEm: string;
  fechadaEm?: string;
  url: string;
}

export interface RepositorioStatus {
  repository: string;
  papel: PapelRepositorio;
  ramoPrincipal: string;
  /** quando ESTA leitura aconteceu */
  observadoEm: string;
  disponivel: boolean;
  erroCodigo?: CodigoFalhaFonte;
  main: CommitPrincipal | null;
  ci: CiPrincipal | null;
  pullRequests: PullRequestObservado[];
  issues: IssueObservada[];
  /** quantas chamadas HTTP este repositorio custou nesta leitura (diagnostico de rate limit) */
  chamadas: number;
}

export interface LimiteGitHub {
  restante: number;
  total: number;
  /** ISO; quando a janela reinicia */
  reiniciaEm?: string;
}

export interface LeituraGitHub {
  observadoEm: string;
  repositorios: RepositorioStatus[];
  limite?: LimiteGitHub;
  chamadas: number;
}

// ------------------------------------------------------------------------------------- utilitarios

/** Mesmo formato canonico do contrato da fabrica (`packages/contracts/src/texto.ts`: TASK_ID). */
export const TASK_ID_FACTORY = /\b([A-Z]{2,4}-\d{4})\b/;

/** taskId a partir de titulo de issue (`[EC-0142] …`) ou branch (`factory/EC-0142-a1`). Sem palpite. */
export function extrairTaskId(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = TASK_ID_FACTORY.exec(texto);
  return m ? m[1] : null;
}

const PREFIXO_ESTADO = 'factory:state:';
const ESTADOS = new Set<string>(ESPELHO_JOB_STATES);

/** Estado do job pela label. Label desconhecida NAO vira estado: devolve null. */
export function estadoDaLabel(labels: readonly string[]): EstadoJobFactory | null {
  for (const l of labels) {
    if (!l.startsWith(PREFIXO_ESTADO)) continue;
    const e = l.slice(PREFIXO_ESTADO.length);
    if (ESTADOS.has(e)) return e as EstadoJobFactory;
  }
  return null;
}

/** Check runs -> situacao do CI. Sem check run, `SEM_CI` (nao e verde nem vermelho). */
export function situacaoDoCi(runs: readonly { status?: string; conclusion?: string | null }[]): { situacao: SituacaoCi; statusOrigem: string } {
  if (!runs.length) return { situacao: 'SEM_CI', statusOrigem: 'sem_check_run' };
  if (runs.some((r) => r.status !== 'completed')) {
    const r = runs.find((x) => x.status !== 'completed')!;
    return { situacao: 'RODANDO', statusOrigem: r.status ?? 'indefinido' };
  }
  const conclusoes = runs.map((r) => r.conclusion ?? 'indefinido');
  if (conclusoes.some((c) => c === 'failure' || c === 'timed_out' || c === 'startup_failure')) {
    return { situacao: 'VERMELHO', statusOrigem: `completed:${conclusoes.find((c) => c === 'failure' || c === 'timed_out' || c === 'startup_failure')}` };
  }
  if (conclusoes.every((c) => c === 'success' || c === 'skipped' || c === 'neutral')) {
    return { situacao: 'VERDE', statusOrigem: `completed:${conclusoes.includes('success') ? 'success' : conclusoes[0]}` };
  }
  return { situacao: 'INDEFINIDO', statusOrigem: `completed:${conclusoes[0]}` };
}

// ------------------------------------------------------------------------------------- porta HTTP

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null);
const arr = (x: unknown): Json[] | null => (Array.isArray(x) ? (x.filter((i) => obj(i)) as Json[]) : null);
const txt = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/** Entrada de cache condicional. OPORTUNISTA: some quando a instancia recicla, e isso e aceitavel. */
export interface EntradaCache { etag: string; corpo: unknown }
export interface CacheCondicional {
  ler(chave: string): EntradaCache | undefined;
  gravar(chave: string, entrada: EntradaCache): void;
}
/** Cache que nao guarda nada — o padrao nos testes e sempre que o ambiente nao ofereca memoria confiavel. */
export const semCache: CacheCondicional = { ler: () => undefined, gravar: () => {} };

export interface DepsGitHub {
  fetch: typeof fetch;
  /** token de LEITURA; ausente = NOT_CONFIGURED. Nunca sai deste modulo. */
  token: string;
  agora: () => string;
  cache?: CacheCondicional;
  baseUrl?: string;
  timeoutMs?: number;
}

const BASE_PADRAO = 'https://api.github.com';
const TIMEOUT_PADRAO = 10_000;

interface Resultado<T> { dados: T; limite?: LimiteGitHub }

/**
 * Uma chamada GET ao GitHub. Devolve o corpo ja interpretado e o limite lido dos cabecalhos —
 * nenhum outro header atravessa. 304 usa o corpo guardado; sem corpo guardado, nao se envia If-None-Match.
 */
async function obter<T>(caminho: string, d: DepsGitHub, contador: { n: number }): Promise<Resultado<T>> {
  if (!d.token.trim()) throw new ErroGitHub('NOT_CONFIGURED');
  const cache = d.cache ?? semCache;
  const url = `${d.baseUrl ?? BASE_PADRAO}${caminho}`;
  const guardado = cache.ler(caminho);
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${d.token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'eiff-control-mission-control',
  };
  if (guardado) headers['if-none-match'] = guardado.etag;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), d.timeoutMs ?? TIMEOUT_PADRAO);
  let r: Response;
  contador.n += 1;
  try {
    r = await d.fetch(url, { headers, signal: ctrl.signal });
  } catch {
    throw new ErroGitHub('NETWORK_FAILURE'); // timeout, DNS, TLS: tudo e falha de rede, sem detalhe vazado
  } finally {
    clearTimeout(t);
  }

  const restante = r.headers?.get?.('x-ratelimit-remaining') ?? null;
  const limiteTotal = r.headers?.get?.('x-ratelimit-limit') ?? null;
  const reset = r.headers?.get?.('x-ratelimit-reset') ?? null;
  const limite: LimiteGitHub | undefined = restante !== null && limiteTotal !== null
    ? { restante: Number(restante), total: Number(limiteTotal), reiniciaEm: reset ? new Date(Number(reset) * 1000).toISOString() : undefined }
    : undefined;

  if (r.status === 304 && guardado) return { dados: guardado.corpo as T, limite };
  if (!r.ok) throw new ErroGitHub(classificarRespostaGitHub(r.status, restante));

  let corpo: unknown;
  try { corpo = await r.json(); } catch { throw new ErroGitHub('INVALID_PAYLOAD'); }
  const etag = r.headers?.get?.('etag');
  if (etag) cache.gravar(caminho, { etag, corpo });
  return { dados: corpo as T, limite };
}

// ------------------------------------------------------------------------------------- leitura

const LIMITE_PR = 20;
const LIMITE_ISSUES = 50;

function lerCommit(corpo: unknown): CommitPrincipal | null {
  const c = obj(corpo);
  const sha = txt(c?.sha);
  if (!sha) return null;
  const commit = obj(c?.commit);
  const autor = obj(commit?.committer) ?? obj(commit?.author);
  const mensagem = txt(commit?.message);
  return {
    sha,
    shaCurto: sha.slice(0, 7),
    commitadoEm: txt(autor?.date),
    titulo: mensagem?.split('\n')[0]?.slice(0, 120),
  };
}

function lerPulls(corpo: unknown): PullRequestObservado[] {
  const lista = arr(corpo) ?? [];
  const saida: PullRequestObservado[] = [];
  for (const p of lista.slice(0, LIMITE_PR)) {
    const numero = num(p.number);
    const head = obj(p.head);
    const branch = txt(head?.ref);
    const headSha = txt(head?.sha);
    const criadoEm = txt(p.created_at);
    const atualizadoEm = txt(p.updated_at);
    const url = txt(p.html_url);
    if (numero === undefined || !branch || !headSha || !criadoEm || !atualizadoEm || !url) continue;
    saida.push({
      numero,
      titulo: (txt(p.title) ?? '').slice(0, 140),
      branch, headSha,
      rascunho: p.draft === true,
      criadoEm, atualizadoEm, url,
      taskId: extrairTaskId(txt(p.title)) ?? extrairTaskId(branch),
    });
  }
  return saida;
}

function lerIssues(corpo: unknown): IssueObservada[] {
  const lista = arr(corpo) ?? [];
  const saida: IssueObservada[] = [];
  for (const i of lista.slice(0, LIMITE_ISSUES)) {
    if (obj(i.pull_request)) continue; // a API de issues devolve PRs junto; PR nao e job
    const numero = num(i.number);
    const criadoEm = txt(i.created_at);
    const atualizadoEm = txt(i.updated_at);
    const url = txt(i.html_url);
    if (numero === undefined || !criadoEm || !atualizadoEm || !url) continue;
    const labels = (arr(i.labels) ?? []).map((l) => txt(l.name)).filter((x): x is string => !!x);
    const labelsFactory = labels.filter((l) => l.startsWith('factory:'));
    const titulo = (txt(i.title) ?? '').slice(0, 140);
    saida.push({
      numero, titulo,
      estadoFactory: estadoDaLabel(labelsFactory),
      taskId: extrairTaskId(titulo),
      labelsFactory,
      estadoGitHub: txt(i.state) === 'closed' ? 'closed' : 'open',
      criadoEm, atualizadoEm,
      fechadaEm: txt(i.closed_at),
      url,
    });
  }
  return saida;
}

/**
 * Le UM repositorio da allowlist. No maximo 3 chamadas (4 com issues) e nenhuma por cartao.
 * Falha vira `disponivel: false` com codigo — nunca lista vazia disfarcada de verdade.
 */
export async function lerRepositorio(r: RepositorioObservavel, d: DepsGitHub): Promise<{ status: RepositorioStatus; limite?: LimiteGitHub }> {
  const contador = { n: 0 };
  const observadoEm = d.agora();
  const base: RepositorioStatus = {
    repository: r.repository, papel: r.papel, ramoPrincipal: r.ramoPrincipal, observadoEm,
    disponivel: false, main: null, ci: null, pullRequests: [], issues: [], chamadas: 0,
  };
  let limite: LimiteGitHub | undefined;
  try {
    const commit = await obter<unknown>(`/repos/${r.repository}/commits/${r.ramoPrincipal}`, d, contador);
    limite = commit.limite ?? limite;
    const main = lerCommit(commit.dados);

    const checks = main
      ? await obter<unknown>(`/repos/${r.repository}/commits/${main.sha}/check-runs?per_page=30`, d, contador)
      : null;
    limite = checks?.limite ?? limite;
    const runs = (arr(obj(checks?.dados)?.check_runs) ?? []).map((x) => ({ status: txt(x.status), conclusion: txt(x.conclusion) ?? null, name: txt(x.name), completed_at: txt(x.completed_at), html_url: txt(x.html_url) }));
    const sit = situacaoDoCi(runs);
    const primeiro = runs[0];

    const pulls = await obter<unknown>(`/repos/${r.repository}/pulls?state=open&per_page=${LIMITE_PR}&sort=updated&direction=desc`, d, contador);
    limite = pulls.limite ?? limite;

    const issues = r.observarIssues
      ? await obter<unknown>(`/repos/${r.repository}/issues?state=open&labels=factory:task&per_page=${LIMITE_ISSUES}&sort=updated&direction=desc`, d, contador)
      : null;
    limite = issues?.limite ?? limite;

    return {
      status: {
        ...base,
        disponivel: true,
        main,
        ci: main ? { situacao: sit.situacao, statusOrigem: sit.statusOrigem, nome: primeiro?.name, concluidoEm: primeiro?.completed_at, url: primeiro?.html_url } : null,
        pullRequests: lerPulls(pulls.dados),
        issues: issues ? lerIssues(issues.dados) : [],
        chamadas: contador.n,
      },
      limite,
    };
  } catch (e) {
    const codigo = e instanceof ErroGitHub ? e.codigo : 'SOURCE_UNAVAILABLE';
    return { status: { ...base, erroCodigo: codigo, chamadas: contador.n }, limite };
  }
}

/** Le a allowlist inteira. Um repositorio indisponivel NAO derruba o outro (resposta parcial). */
export async function lerGitHub(d: DepsGitHub, repos: readonly RepositorioObservavel[] = REPOSITORIOS_OBSERVADOS): Promise<LeituraGitHub> {
  const observadoEm = d.agora();
  const resultados = await Promise.all(repos.map((r) => lerRepositorio(r, d)));
  const limite = resultados.map((x) => x.limite).filter((x): x is LimiteGitHub => !!x).sort((a, b) => a.restante - b.restante)[0];
  return {
    observadoEm,
    repositorios: resultados.map((x) => x.status),
    limite,
    chamadas: resultados.reduce((n, x) => n + x.status.chamadas, 0),
  };
}

/** Teto de chamadas por ciclo, para o orcamento de rate limit ser um numero e nao uma esperanca. */
export const MAX_CHAMADAS_POR_CICLO = REPOSITORIOS_OBSERVADOS.reduce((n, r) => n + (r.observarIssues ? 4 : 3), 0);

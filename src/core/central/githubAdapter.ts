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

/**
 * Papel do repositorio para o Mission Control. `papel` diz o que o repositorio E (o produto, ou a fabrica
 * que o constroi) — NAO diz onde os jobs moram. Ver `observarIssues`.
 */
export type PapelRepositorio = 'produto' | 'fabrica';

export interface RepositorioObservavel {
  repository: string;
  papel: PapelRepositorio;
  ramoPrincipal: string;
  /**
   * Ler as issues `factory:task` deste repositorio.
   *
   * O contrato canonico da fabrica (`JOB_CONTRACT.md`, primeira linha) diz: "Um job e uma issue no
   * repositorio-ALVO (nao no repositorio da fabrica)" — e o proprio YAML do job carrega
   * `repository: augustocfmacedo/eiff-control`. Logo um job real do produto nasce como issue AQUI, no
   * eiff-control, e nao no eiff-dev-factory. Enquanto isto era `false` para o produto, um job com
   * `factory:task` + `factory:state:CODING` no eiff-control ficava INVISIVEL ao painel.
   *
   * Por isso todo repositorio-alvo da allowlist e observado. Isto NAO amplia a allowlist nem aceita
   * repositorio do cliente: continua sendo esta lista fixa, server-side.
   */
  observarIssues: boolean;
}

/**
 * ALLOWLIST server-side. E a unica lista de repositorios que o Mission Control consulta; o endpoint nao
 * aceita `?repo=` e nao ha como transformar a funcao num proxy do GitHub.
 */
export const REPOSITORIOS_OBSERVADOS: readonly RepositorioObservavel[] = [
  { repository: 'augustocfmacedo/eiff-control', papel: 'produto', ramoPrincipal: 'main', observarIssues: true },
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
  'CHECKS_PERMISSION_UNAVAILABLE',
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
  CHECKS_PERMISSION_UNAVAILABLE: 'A credencial não tem a permissão Checks: o CI deste repositório não pode ser lido. O resto do repositório continua sendo lido.',
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
  /**
   * Identidade canonica: o `taskId` do bloco `factory-task:v1` no corpo (`lerIdentidadeCanonica`). null quando
   * nao ha bloco valido — e ai a issue segue referenciada por `repositorio#numero`, sem correlacao inventada.
   * O corpo em si nunca esta aqui.
   */
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
  /**
   * Falha SO do CI. O repositorio segue `disponivel`: perder o check run nao e perder o repositorio.
   * Granularidade exigida na MC-LIVE-1 — uma capacidade indisponivel nao derruba as outras.
   */
  erroCi?: CodigoFalhaFonte;
  pullRequests: PullRequestObservado[];
  erroPullRequests?: CodigoFalhaFonte;
  issues: IssueObservada[];
  erroIssues?: CodigoFalhaFonte;
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

/** Mesmo formato canonico do contrato da fabrica (`packages/contracts/src/texto.ts`: TASK_ID), SOLTO num texto. */
export const TASK_ID_FACTORY = /\b([A-Z]{2,4}-\d{4})\b/;

/** ESPELHO de `TASK_ID` (`packages/contracts/src/texto.ts`), ANCORADO: valida um valor inteiro, nao procura num texto. */
export const TASK_ID_CANONICO = /^[A-Z]{2,4}-\d{4}$/;

/**
 * taskId a partir de texto livre (titulo de PR feito por humano, por exemplo). E busca solta: serve de
 * ULTIMO recurso onde nao existe identidade canonica — nunca para issue de job, cuja identidade e o bloco.
 */
export function extrairTaskId(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = TASK_ID_FACTORY.exec(texto);
  return m ? m[1] : null;
}

/** ESPELHO de `lerBranchDoJob` (`packages/github/src/refs.ts`): `factory/<taskId>-a<attempt>`, attempt ≥ 1. */
const BRANCH_DO_JOB = /^factory\/([A-Z]{2,4}-\d{4})-a(\d{1,4})$/;

/** Identidade canonica de um PR da fabrica: a branch e GERADA do taskId (`branchDoJob`), entao e a autoridade. */
export function taskIdDaBranchDoJob(branch: string | null | undefined): string | null {
  if (!branch) return null;
  const m = BRANCH_DO_JOB.exec(branch);
  return m && Number(m[2]) >= 1 ? m[1] : null;
}

// ------------------------------------------------------- identidade canonica da issue (JOB_CONTRACT.md)

/**
 * Marcadores do bloco canonico do job no corpo da issue. Formato suportado, exatamente o do JOB_CONTRACT.md:
 *
 *   <!-- factory-task:v1 -->
 *   ```yaml
 *   taskId: EC-0142                # comentario inline permitido
 *   repository: augustocfmacedo/eiff-control
 *   ...
 *   ```
 *   <!-- /factory-task -->
 *
 * A cerca ```yaml e o marcador de fim sao opcionais na leitura (o de inicio nao). Nao existe leitor executavel
 * deste bloco na fabrica (`parseJobContract` valida um OBJETO ja extraido; `lerRelatorioDoPr` le o bloco do
 * PR, que e JSON). Por isso a extracao vive aqui, minima e explicita: so `taskId` e `repository`, ambos
 * escalares de nivel superior — sem parser YAML e sem dependencia nova.
 */
export const MARCADOR_TASK_INICIO = '<!-- factory-task:v1 -->';
export const MARCADOR_TASK_FIM = '<!-- /factory-task -->';
/** GitHub limita o corpo a 65 536 caracteres; nada acima disso e lido. */
const CORPO_ISSUE_MAXIMO = 65_536;

/** Catalogo FECHADO de por que uma issue nao tem identidade canonica. Nunca vira palpite. */
export const RECUSAS_IDENTIDADE = [
  'SEM_BLOCO',            // corpo sem `<!-- factory-task:v1 -->`
  'BLOCOS_AMBIGUOS',      // mais de um bloco: nenhum e escolhido
  'CHAVE_DUPLICADA',      // `taskId:` ou `repository:` repetidos dentro do bloco
  'SEM_TASK_ID',          // bloco sem `taskId:`
  'TASK_ID_INVALIDO',     // `taskId:` fora de `^[A-Z]{2,4}-\d{4}$`
  'SEM_REPOSITORIO',      // bloco sem `repository:`
  'REPOSITORIO_DIVERGENTE', // `repository:` diferente do repositorio onde a issue esta
] as const;
export type RecusaIdentidade = (typeof RECUSAS_IDENTIDADE)[number];

export type IdentidadeCanonica =
  | { taskId: string; recusa?: undefined }
  | { taskId: null; recusa: RecusaIdentidade };

/** Valor escalar YAML: tira o comentario (`#` no inicio ou apos espaco) e aspas simples/duplas envolventes. */
function valorEscalarYaml(bruto: string): string {
  const semComentario = bruto.replace(/(^|\s)#.*$/, '').trim();
  const aspas = /^(["'])(.*)\1$/.exec(semComentario);
  return (aspas ? aspas[2] : semComentario).trim();
}

/**
 * Identidade canonica da issue de job: o campo `taskId` DENTRO do bloco delimitado, e so ele.
 *
 * Regras (todas testadas): exatamente um bloco; `taskId` e `repository` uma vez cada; `taskId` no formato
 * canonico; `repository` igual ao repositorio onde a issue esta. Qualquer desvio devolve `taskId: null` com a
 * recusa nomeada — e o chamador preserva a referencia `repositorio#numero`, sem inventar correlacao.
 * Um identificador solto no titulo ou na prosa NUNCA e consultado aqui.
 *
 * Roda SO no servidor: o corpo e lido em transito e nao entra em `IssueObservada` nem na resposta.
 */
export function lerIdentidadeCanonica(corpo: string | null | undefined, repositorioDaIssue: string): IdentidadeCanonica {
  if (!corpo) return { taskId: null, recusa: 'SEM_BLOCO' };
  const texto = corpo.length > CORPO_ISSUE_MAXIMO ? corpo.slice(0, CORPO_ISSUE_MAXIMO) : corpo;
  const inicio = texto.indexOf(MARCADOR_TASK_INICIO);
  if (inicio < 0) return { taskId: null, recusa: 'SEM_BLOCO' };
  if (texto.indexOf(MARCADOR_TASK_INICIO, inicio + MARCADOR_TASK_INICIO.length) >= 0) return { taskId: null, recusa: 'BLOCOS_AMBIGUOS' };

  const depois = texto.slice(inicio + MARCADOR_TASK_INICIO.length);
  const fim = depois.indexOf(MARCADOR_TASK_FIM);
  let segmento = fim >= 0 ? depois.slice(0, fim) : depois;
  const cerca = /```(?:yaml|yml)?[ \t]*\r?\n([\s\S]*?)```/.exec(segmento);
  if (cerca) segmento = cerca[1];

  const valores: Partial<Record<'taskId' | 'repository', string>> = {};
  for (const linha of segmento.split(/\r?\n/)) {
    const m = /^(taskId|repository):[ \t]*(.*)$/.exec(linha); // nivel superior: linha sem indentacao
    if (!m) continue;
    const chave = m[1] as 'taskId' | 'repository';
    if (chave in valores) return { taskId: null, recusa: 'CHAVE_DUPLICADA' };
    valores[chave] = valorEscalarYaml(m[2]);
  }
  if (valores.taskId === undefined || valores.taskId === '') return { taskId: null, recusa: 'SEM_TASK_ID' };
  if (!TASK_ID_CANONICO.test(valores.taskId)) return { taskId: null, recusa: 'TASK_ID_INVALIDO' };
  if (!valores.repository) return { taskId: null, recusa: 'SEM_REPOSITORIO' };
  if (valores.repository !== repositorioDaIssue) return { taskId: null, recusa: 'REPOSITORIO_DIVERGENTE' };
  return { taskId: valores.taskId };
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
      // a branch e GERADA do taskId pela fabrica: e a identidade canonica do PR. Titulo so como ultimo
      // recurso (PR humano fora do padrao); um id diferente no titulo nunca vence a branch canonica.
      taskId: taskIdDaBranchDoJob(branch) ?? extrairTaskId(txt(p.title)),
    });
  }
  return saida;
}

/**
 * `repositorio` e o repositorio de onde a lista veio: a identidade canonica exige que o `repository:` do bloco
 * seja este. O corpo (`i.body`) e lido AQUI, em transito, e descartado — nunca entra em `IssueObservada`.
 */
function lerIssues(corpo: unknown, repositorio: string): IssueObservada[] {
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
      // identidade canonica: o `taskId` do bloco no corpo. O titulo (`[factory] …`) nao a carrega por contrato.
      taskId: lerIdentidadeCanonica(txt(i.body), repositorio).taskId,
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
  const codigoDe = (e: unknown): CodigoFalhaFonte => (e instanceof ErroGitHub ? e.codigo : 'SOURCE_UNAVAILABLE');

  // 1) FUNDACAO: sem o commit de `main` nao ha o que observar — e so aqui que o repositorio cai inteiro.
  let main: CommitPrincipal | null;
  try {
    const commit = await obter<unknown>(`/repos/${r.repository}/commits/${r.ramoPrincipal}`, d, contador);
    limite = commit.limite ?? limite;
    main = lerCommit(commit.dados);
  } catch (e) {
    return { status: { ...base, erroCodigo: codigoDe(e), chamadas: contador.n }, limite };
  }

  // 2) CAPACIDADES INDEPENDENTES. Cada uma falha sozinha, com o proprio codigo, e o repositorio segue
  //    disponivel. Perder o CI nao e perder o repositorio: `Checks` e uma permissao a parte do PAT e pode
  //    simplesmente nao ter sido concedida — isso nao pode apagar main, PRs e issues.
  let ci: CiPrincipal | null = null;
  let erroCi: CodigoFalhaFonte | undefined;
  if (main) {
    try {
      const checks = await obter<unknown>(`/repos/${r.repository}/commits/${main.sha}/check-runs?per_page=30`, d, contador);
      limite = checks.limite ?? limite;
      const runs = (arr(obj(checks.dados)?.check_runs) ?? []).map((x) => ({ status: txt(x.status), conclusion: txt(x.conclusion) ?? null, name: txt(x.name), completed_at: txt(x.completed_at), html_url: txt(x.html_url) }));
      const sit = situacaoDoCi(runs);
      const primeiro = runs[0];
      ci = { situacao: sit.situacao, statusOrigem: sit.statusOrigem, nome: primeiro?.name, concluidoEm: primeiro?.completed_at, url: primeiro?.html_url };
    } catch (e) {
      const c = codigoDe(e);
      // 403/404 no endpoint de check runs = a credencial nao tem `Checks`; e um caso proprio, nao
      // "repositorio sem permissao" e muito menos "CI verde por omissao".
      erroCi = c === 'PERMISSION_FAILURE' || c === 'NOT_FOUND' ? 'CHECKS_PERMISSION_UNAVAILABLE' : c;
    }
  }

  let pullRequests: PullRequestObservado[] = [];
  let erroPullRequests: CodigoFalhaFonte | undefined;
  try {
    const pulls = await obter<unknown>(`/repos/${r.repository}/pulls?state=open&per_page=${LIMITE_PR}&sort=updated&direction=desc`, d, contador);
    limite = pulls.limite ?? limite;
    pullRequests = lerPulls(pulls.dados);
  } catch (e) {
    erroPullRequests = codigoDe(e); // lista vazia COM codigo: ausencia de leitura, nunca "nenhum PR"
  }

  let issues: IssueObservada[] = [];
  let erroIssues: CodigoFalhaFonte | undefined;
  if (r.observarIssues) {
    try {
      const lidas = await obter<unknown>(`/repos/${r.repository}/issues?state=open&labels=factory:task&per_page=${LIMITE_ISSUES}&sort=updated&direction=desc`, d, contador);
      limite = lidas.limite ?? limite;
      issues = lerIssues(lidas.dados, r.repository);
    } catch (e) {
      erroIssues = codigoDe(e);
    }
  }

  return {
    status: { ...base, disponivel: true, main, ci, erroCi, pullRequests, erroPullRequests, issues, erroIssues, chamadas: contador.n },
    limite,
  };
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

/**
 * Teto de chamadas por ciclo, para o orcamento de rate limit ser um numero e nao uma esperanca.
 *
 * Por repositorio: `commits/{ramo}` + `check-runs` do sha + `pulls` = 3, mais `issues?labels=factory:task`
 * quando `observarIssues` = 4. Com os dois repositorios observando issues: 4 + 4 = **8 por ciclo**.
 * Era 7 enquanto o produto nao lia issues (3 + 4).
 *
 * O numero e DERIVADO da allowlist — nunca uma constante digitada — entao acrescentar repositorio ou
 * ligar issues recalcula sozinho, e o teste que compara o teto com as chamadas reais acompanha.
 * O custo por ciclo nao depende da quantidade de cartoes: nao existe chamada por item.
 */
export const MAX_CHAMADAS_POR_CICLO = REPOSITORIOS_OBSERVADOS.reduce((n, r) => n + (r.observarIssues ? 4 : 3), 0);

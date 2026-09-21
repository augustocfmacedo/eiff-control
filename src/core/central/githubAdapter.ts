// Adapter SOMENTE LEITURA do GitHub para o Mission Control ao vivo (Wave 03, frente F4).
//
// Regras deste modulo (violar reprova a entrega — o teste githubAdapter.test.ts prende cada uma):
// - so faz GET na API REST publica do GitHub; nenhum caminho escreve nada;
// - o token (`GITHUB_READ_TOKEN`, fine-grained e read-only, so no ambiente do Netlify — decisao D3) e injetado
//   pelas deps e vai apenas no cabecalho Authorization: nunca aparece no resultado, em log ou em mensagem de erro;
// - devolve um objeto DERIVADO (`StatusDesenvolvimento`) com so o que a tela precisa; o payload bruto do GitHub
//   nunca sai daqui;
// - falha e ESTADO NOMEADO (`nao_configurado`, `nao_autorizado`, `indisponivel`, `rede`, `timeout`), nunca
//   excecao para o handler; qualquer falha vira SNAPSHOT na tela (invariante 10 da Wave 03).
//
// A porta HTTP (`http`, o fetch global no servidor) e injetada: a suite roda sem nenhuma chamada real de rede.

// -------------------------------------------------------------------------------------- constantes

export const REPOSITORIO_GITHUB = { dono: 'augustocfmacedo', nome: 'eiff-control', ramoPrincipal: 'main' } as const;
/** nome do arquivo e nome exibido do workflow de CI (docs/ci-release-gate.md) */
export const WORKFLOW_QUALITY_GATE = { arquivo: 'quality-gate.yml', nome: 'EIFF Quality Gate' } as const;
export const GITHUB_API_PADRAO = 'https://api.github.com';
/** timeout por chamada a API do GitHub */
export const TIMEOUT_GITHUB_MS = 8_000;
/** quantas branches de trabalho ganham detalhe (data do ultimo commit); cada uma custa um GET */
export const MAX_BRANCHES_DETALHE = 12;
/** branches de trabalho que interessam ao painel: frentes da Central e branches de integracao */
export const PADROES_BRANCH: readonly RegExp[] = [/^central\//, /^integracao-/];
/** nome exato da variavel de ambiente (so no painel do Netlify; nunca com o prefixo que o Vite expoe ao navegador) */
export const VARIAVEL_TOKEN_GITHUB = 'GITHUB_READ_TOKEN';
/** papeis com `ver_mission_control` — espelha a MATRIZ do store (teste confere com `pode`) */
export const PAPEIS_MISSION_CONTROL = ['Administrador', 'Diretoria'] as const;

export const ESTADOS_FONTE = ['nao_configurado', 'nao_autorizado', 'indisponivel', 'rede', 'timeout'] as const;
export type EstadoFonte = (typeof ESTADOS_FONTE)[number];

// ------------------------------------------------------------------------------------ tipos derivados

export interface CommitResumo {
  sha: string;
  sha7: string;
  /** ISO do committer */
  data?: string;
  /** primeira linha da mensagem, cortada */
  mensagem?: string;
}

export const STATUS_EXECUCAO = ['queued', 'in_progress', 'completed', 'desconhecido'] as const;
export type StatusExecucao = (typeof STATUS_EXECUCAO)[number];
export const CONCLUSOES_EXECUCAO = ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'desconhecido'] as const;
export type ConclusaoExecucao = (typeof CONCLUSOES_EXECUCAO)[number];

export interface ExecucaoQualityGate {
  nome: string;
  status: StatusExecucao;
  /** null enquanto a execucao nao terminou */
  conclusao: ConclusaoExecucao | null;
  url?: string;
  /** ISO da ultima atualizacao da execucao */
  quando?: string;
  sha7?: string;
  numero?: number;
}

export interface BranchResumo {
  nome: string;
  sha7: string;
  /** ISO do ultimo commit; ausente quando o detalhe nao pode ser lido */
  data?: string;
}

export interface StatusDesenvolvimento {
  /** dono/nome */
  repositorio: string;
  main: CommitResumo;
  /** ausente quando a execucao nao pode ser lida (ver `avisos`) ou nunca rodou */
  qualityGate?: ExecucaoQualityGate;
  branches: BranchResumo[];
  /** quantas branches de trabalho existem (pode ser mais que as detalhadas) */
  branchesTotal: number;
  /** ISO de quando a consulta foi feita */
  consultadoEm: string;
  /** leituras secundarias que falharam, no formato `<parte>: <estado>` — nunca contem token nem payload */
  avisos: string[];
}

export type ResultadoGithub =
  | { ok: true; status: StatusDesenvolvimento }
  | { ok: false; estado: EstadoFonte; detalhe?: string };

export interface DepsGithub {
  /** porta HTTP injetada (no servidor, o fetch global); o modulo nao conhece rede por conta propria */
  http: typeof fetch;
  /** token read-only; ausente ou vazio = `nao_configurado` */
  token?: string;
  agora?: () => string;
  timeoutMs?: number;
  baseUrl?: string;
}

// ------------------------------------------------------------------------------------ leitura (GET)

type Json = Record<string, unknown>;
type Leitura = { ok: true; dados: unknown } | { ok: false; estado: EstadoFonte; detalhe: string };

const o = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const sha7De = (sha: string | undefined) => (sha ? sha.slice(0, 7) : '');
const primeiraLinha = (m: string | undefined) => (m ? m.split('\n')[0].trim().slice(0, 120) : undefined);
export const ehBranchDeTrabalho = (nome: string): boolean => PADROES_BRANCH.some((p) => p.test(nome));

/** Classifica o status HTTP do GitHub num estado nomeado. 404 tambem cobre token sem acesso ao repositorio. */
export function estadoDoHttp(status: number): EstadoFonte {
  if (status === 401 || status === 403) return 'nao_autorizado';
  return 'indisponivel';
}

/** Um GET com timeout. Nunca lanca: falha e estado nomeado com detalhe curto (sem token, sem corpo). */
async function lerJson(deps: DepsGithub, caminho: string): Promise<Leitura> {
  const base = (deps.baseUrl ?? GITHUB_API_PADRAO).replace(/\/$/, '');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const ms = deps.timeoutMs ?? TIMEOUT_GITHUB_MS;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : undefined;
  try {
    const r = await deps.http(`${base}${caminho}`, {
      method: 'GET',
      signal: ctrl?.signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${deps.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'eiff-control-mission-control',
      },
    });
    if (!r.ok) return { ok: false, estado: estadoDoHttp(r.status), detalhe: `http ${r.status}` };
    try {
      return { ok: true, dados: await r.json() };
    } catch {
      return { ok: false, estado: 'indisponivel', detalhe: 'resposta ininteligivel' };
    }
  } catch (e) {
    const nome = (e as { name?: string })?.name ?? '';
    if (nome === 'AbortError' || nome === 'TimeoutError') return { ok: false, estado: 'timeout', detalhe: `timeout ${ms} ms` };
    return { ok: false, estado: 'rede', detalhe: 'falha de rede' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------- normalizadores (derivado)

/** GET /repos/{o}/{r}/branches/{nome} -> resumo do commit da ponta */
export function normalizarBranchDetalhe(dados: unknown): (BranchResumo & { mensagem?: string }) | undefined {
  const d = o(dados);
  const c = o(d.commit);
  const sha = s(c.sha);
  const nome = s(d.name);
  if (!sha || !nome) return undefined;
  const meta = o(c.commit);
  const data = s(o(meta.committer).date) ?? s(o(meta.author).date);
  return { nome, sha7: sha7De(sha), data, mensagem: primeiraLinha(s(meta.message)) };
}

/** GET /repos/{o}/{r}/branches -> so nome e sha das branches de trabalho, em ordem alfabetica */
export function normalizarListaBranches(dados: unknown): BranchResumo[] {
  const lista = Array.isArray(dados) ? dados : [];
  return lista
    .map((b) => { const x = o(b); const nome = s(x.name); const sha = s(o(x.commit).sha); return nome && sha ? { nome, sha7: sha7De(sha) } : undefined; })
    .filter((b): b is BranchResumo => !!b && ehBranchDeTrabalho(b.nome))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/** GET /repos/{o}/{r}/actions/workflows/{arquivo}/runs?branch=main&per_page=1 -> a ultima execucao */
export function normalizarExecucao(dados: unknown): ExecucaoQualityGate | undefined {
  const runs = o(dados).workflow_runs;
  const r = o(Array.isArray(runs) ? runs[0] : undefined);
  if (!Object.keys(r).length) return undefined;
  const st = s(r.status);
  const status: StatusExecucao = (STATUS_EXECUCAO as readonly string[]).includes(st ?? '') ? (st as StatusExecucao) : 'desconhecido';
  const cRaw = r.conclusion;
  const conclusao: ConclusaoExecucao | null = cRaw == null ? null : (CONCLUSOES_EXECUCAO as readonly string[]).includes(String(cRaw)) ? (cRaw as ConclusaoExecucao) : 'desconhecido';
  return {
    nome: s(r.name) ?? WORKFLOW_QUALITY_GATE.nome,
    status,
    conclusao,
    url: s(r.html_url),
    quando: s(r.updated_at) ?? s(r.run_started_at) ?? s(r.created_at),
    sha7: sha7De(s(r.head_sha)),
    numero: n(r.run_number),
  };
}

// ------------------------------------------------------------------------------------------ leitura

/**
 * Le o estado do desenvolvimento no GitHub: HEAD de main, ultima execucao do Quality Gate em main e as branches de
 * trabalho. Main e obrigatoria (sem ela nao ha status); Quality Gate e branches sao secundarias — se falharem, entram
 * em `avisos` e o resto segue. Nunca lanca.
 */
export async function lerStatusDesenvolvimento(deps: DepsGithub): Promise<ResultadoGithub> {
  const token = (deps.token ?? '').trim();
  if (!token) return { ok: false, estado: 'nao_configurado', detalhe: `${VARIAVEL_TOKEN_GITHUB} ausente` };
  const d: DepsGithub = { ...deps, token };
  const repo = `/repos/${REPOSITORIO_GITHUB.dono}/${REPOSITORIO_GITHUB.nome}`;
  const avisos: string[] = [];

  const main = await lerJson(d, `${repo}/branches/${REPOSITORIO_GITHUB.ramoPrincipal}`);
  if (!main.ok) return { ok: false, estado: main.estado, detalhe: main.detalhe };
  const ponta = normalizarBranchDetalhe(main.dados);
  if (!ponta) return { ok: false, estado: 'indisponivel', detalhe: 'resposta sem commit de main' };
  const shaMain = s(o(o(main.dados).commit).sha) ?? '';

  const [exec, lista] = await Promise.all([
    lerJson(d, `${repo}/actions/workflows/${WORKFLOW_QUALITY_GATE.arquivo}/runs?branch=${REPOSITORIO_GITHUB.ramoPrincipal}&per_page=1`),
    lerJson(d, `${repo}/branches?per_page=100`),
  ]);

  let qualityGate: ExecucaoQualityGate | undefined;
  if (exec.ok) qualityGate = normalizarExecucao(exec.dados);
  else avisos.push(`quality_gate: ${exec.estado}`);

  let branches: BranchResumo[] = [];
  let branchesTotal = 0;
  if (lista.ok) {
    const todas = normalizarListaBranches(lista.dados);
    branchesTotal = todas.length;
    const detalhar = todas.slice(0, MAX_BRANCHES_DETALHE);
    const detalhes = await Promise.all(detalhar.map((b) => lerJson(d, `${repo}/branches/${encodeURIComponent(b.nome)}`)));
    let falhas = 0;
    branches = detalhar.map((b, i) => {
      const det = detalhes[i];
      const r = det.ok ? normalizarBranchDetalhe(det.dados) : undefined;
      if (!r) falhas += 1;
      return { nome: b.nome, sha7: r?.sha7 ?? b.sha7, data: r?.data };
    });
    if (falhas) avisos.push(`branches_detalhe: ${falhas} sem data`);
  } else {
    avisos.push(`branches: ${lista.estado}`);
  }

  return {
    ok: true,
    status: {
      repositorio: `${REPOSITORIO_GITHUB.dono}/${REPOSITORIO_GITHUB.nome}`,
      main: { sha: shaMain, sha7: ponta.sha7, data: ponta.data, mensagem: ponta.mensagem },
      qualityGate,
      branches,
      branchesTotal,
      consultadoEm: (d.agora ?? (() => new Date().toISOString()))(),
      avisos,
    },
  };
}

// --------------------------------------------------------------------------- handler puro do endpoint

/** Contrato publico de /api/development-status. Nunca leva token, payload bruto nem dados de perfil. */
export type RespostaDevelopmentStatus =
  | { modo: 'LIVE'; geradoEm: string; status: StatusDesenvolvimento }
  | { modo: 'SNAPSHOT'; geradoEm: string; motivo: EstadoFonte; detalhe?: string };

export interface EntradaDevelopmentStatus {
  metodo: string;
  /** cabecalho Authorization cru (Bearer <jwt do Supabase>) */
  authorization?: string | null;
  /** chave anon enviada pelo navegador quando o servidor nao a tem no ambiente (e publica) */
  anonDoCliente?: string | null;
}

export interface DepsDevelopmentStatus {
  /** porta HTTP injetada (no servidor, o fetch global); o modulo nao conhece rede por conta propria */
  http: typeof fetch;
  supabaseUrl: string;
  anon?: string;
  /** GITHUB_READ_TOKEN; ausente = SNAPSHOT nao_configurado com 200 */
  tokenGithub?: string;
  agora?: () => string;
  timeoutMs?: number;
  githubBaseUrl?: string;
  /** telemetria minima: nunca recebe token, jwt nem payload */
  log?: (t: Record<string, unknown>) => void;
}

export interface SaidaHandler { status: number; corpo: unknown }

const HTTP_ERRO_PERFIL = { nao_autenticado: 401, sem_perfil: 403, sem_permissao: 403 } as const;

/** JWT -> usuario -> perfil REAL do banco -> papel em PAPEIS_MISSION_CONTROL. O papel nunca vem do cliente. */
async function autorizar(entrada: EntradaDevelopmentStatus, deps: DepsDevelopmentStatus): Promise<{ ok: true; papel: string } | { ok: false; erro: keyof typeof HTTP_ERRO_PERFIL }> {
  const jwt = (entrada.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const anon = (deps.anon ?? '').trim() || (entrada.anonDoCliente ?? '').trim();
  if (!jwt || !anon) return { ok: false, erro: 'nao_autenticado' };
  const cab = { apikey: anon, authorization: `Bearer ${jwt}` };
  try {
    const user = await deps.http(`${deps.supabaseUrl}/auth/v1/user`, { headers: cab });
    if (!user.ok) return { ok: false, erro: 'nao_autenticado' };
    const u = (await user.json().catch(() => ({}))) as { id?: string };
    if (!u.id) return { ok: false, erro: 'nao_autenticado' };
    const perfilR = await deps.http(`${deps.supabaseUrl}/rest/v1/profile?id=eq.${encodeURIComponent(u.id)}&select=role,organization_id`, { headers: cab });
    const perfil = ((await perfilR.json().catch(() => [])) as { role?: string; organization_id?: string }[])[0];
    if (!perfilR.ok || !perfil?.role || !perfil.organization_id) return { ok: false, erro: 'sem_perfil' };
    if (!(PAPEIS_MISSION_CONTROL as readonly string[]).includes(perfil.role)) return { ok: false, erro: 'sem_permissao' };
    return { ok: true, papel: perfil.role };
  } catch {
    return { ok: false, erro: 'nao_autenticado' };
  }
}

/**
 * Handler puro de /api/development-status: GET -> JWT -> perfil -> ver_mission_control -> adapter do GitHub.
 * Sem token do GitHub responde 200 com SNAPSHOT `nao_configurado` (nao e erro do usuario). Qualquer falha da
 * fonte tambem e 200 + SNAPSHOT com motivo nomeado: o cliente nunca precisa adivinhar.
 */
export async function tratarDevelopmentStatus(entrada: EntradaDevelopmentStatus, deps: DepsDevelopmentStatus): Promise<SaidaHandler> {
  const inicio = Date.now();
  const agora = deps.agora ?? (() => new Date().toISOString());
  const log = (t: Record<string, unknown>) => { try { deps.log?.({ evento: 'development_status', latency_ms: Date.now() - inicio, ...t }); } catch { /* ignore */ } };
  if (entrada.metodo !== 'GET') { log({ http_status: 405 }); return { status: 405, corpo: { erro: 'metodo' } }; }

  const auth = await autorizar(entrada, deps);
  if (!auth.ok) { const st = HTTP_ERRO_PERFIL[auth.erro]; log({ http_status: st, erro: auth.erro }); return { status: st, corpo: { erro: auth.erro } }; }

  const geradoEm = agora();
  const token = (deps.tokenGithub ?? '').trim();
  if (!token) {
    log({ http_status: 200, modo: 'SNAPSHOT', motivo: 'nao_configurado' });
    return { status: 200, corpo: { modo: 'SNAPSHOT', geradoEm, motivo: 'nao_configurado' } satisfies RespostaDevelopmentStatus };
  }

  const r = await lerStatusDesenvolvimento({ http: deps.http, token, agora, timeoutMs: deps.timeoutMs, baseUrl: deps.githubBaseUrl });
  if (!r.ok) {
    log({ http_status: 200, modo: 'SNAPSHOT', motivo: r.estado });
    return { status: 200, corpo: { modo: 'SNAPSHOT', geradoEm, motivo: r.estado, detalhe: r.detalhe } satisfies RespostaDevelopmentStatus };
  }
  log({ http_status: 200, modo: 'LIVE', quality_gate: r.status.qualityGate?.conclusao ?? null, branches: r.status.branches.length, avisos: r.status.avisos.length });
  return { status: 200, corpo: { modo: 'LIVE', geradoEm, status: r.status } satisfies RespostaDevelopmentStatus };
}

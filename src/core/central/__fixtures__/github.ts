// Fixture SINTETICA da API do GitHub. Nada aqui e real: nenhum token, nenhum dado de conta, nenhuma
// chamada de rede. Serve para a suite provar a normalizacao, os codigos de falha e a resposta parcial
// sem depender de credencial — requisito da MC-LIVE-1 (o desenvolvimento nao pode exigir o PAT).
export const SHA_MAIN_CONTROL = 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee';
export const SHA_MAIN_FACTORY = '1111111122222222333333334444444455555555';

export const commitMain = (sha: string, data = '2026-09-22T09:00:00Z', titulo = 'Commit de exemplo') => ({
  sha,
  commit: { message: `${titulo}\n\ncorpo ignorado`, committer: { date: data } },
});

export const checkRuns = (runs: { status: string; conclusion: string | null; name?: string }[]) => ({
  total_count: runs.length,
  check_runs: runs.map((r, i) => ({
    id: 100 + i,
    name: r.name ?? 'EIFF Quality Gate',
    status: r.status,
    conclusion: r.conclusion,
    completed_at: r.status === 'completed' ? '2026-09-22T09:05:00Z' : null,
    html_url: 'https://github.com/exemplo/run',
  })),
});

export const CHECKS_VERDE = checkRuns([{ status: 'completed', conclusion: 'success' }]);
export const CHECKS_RODANDO = checkRuns([{ status: 'in_progress', conclusion: null }]);
export const CHECKS_VERMELHO = checkRuns([{ status: 'completed', conclusion: 'failure' }]);

export const PULLS_CONTROL = [
  {
    number: 22,
    title: '[EC-0142] Exportar CSV da tabela de alocações',
    draft: false,
    created_at: '2026-09-21T10:00:00Z',
    updated_at: '2026-09-22T08:30:00Z',
    html_url: 'https://github.com/augustocfmacedo/eiff-control/pull/22',
    head: { ref: 'factory/EC-0142-a1', sha: 'abc1234abc1234abc1234abc1234abc1234abcd' },
  },
  {
    number: 23,
    title: 'Ajuste sem taskId',
    draft: true,
    created_at: '2026-09-22T07:00:00Z',
    updated_at: '2026-09-22T07:10:00Z',
    html_url: 'https://github.com/augustocfmacedo/eiff-control/pull/23',
    head: { ref: 'ajuste/manual', sha: 'def5678def5678def5678def5678def5678defa' },
  },
];

export const ISSUES_FACTORY = [
  {
    number: 41,
    title: '[EC-0142] Exportar CSV da tabela de alocações',
    state: 'open',
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-22T08:31:00Z',
    closed_at: null,
    html_url: 'https://github.com/augustocfmacedo/eiff-dev-factory/issues/41',
    labels: [{ name: 'factory:task' }, { name: 'factory:state:CI_RUNNING' }, { name: 'factory:risk:GREEN' }, { name: 'area:ux' }],
  },
  {
    number: 42,
    title: '[DF-0418] Endurecer a política de Bash do worker',
    state: 'open',
    created_at: '2026-09-21T09:00:00Z',
    updated_at: '2026-09-22T08:00:00Z',
    closed_at: null,
    html_url: 'https://github.com/augustocfmacedo/eiff-dev-factory/issues/42',
    labels: [{ name: 'factory:task' }, { name: 'factory:state:CODING' }, { name: 'factory:risk:AMBER' }],
  },
  {
    number: 43,
    title: '[DF-0419] Revisar perímetro do broker',
    state: 'open',
    created_at: '2026-09-21T11:00:00Z',
    updated_at: '2026-09-22T08:20:00Z',
    closed_at: null,
    html_url: 'https://github.com/augustocfmacedo/eiff-dev-factory/issues/43',
    labels: [{ name: 'factory:task' }, { name: 'factory:state:AWAITING_HUMAN' }, { name: 'factory:risk:RED' }],
  },
  {
    // PR devolvido pela API de issues: NAO e job, tem de ser descartado
    number: 44,
    title: '[EC-0142] Exportar CSV da tabela de alocações',
    state: 'open',
    created_at: '2026-09-21T10:00:00Z',
    updated_at: '2026-09-22T08:30:00Z',
    closed_at: null,
    html_url: 'https://github.com/augustocfmacedo/eiff-dev-factory/pull/44',
    labels: [{ name: 'factory:task' }],
    pull_request: { url: 'https://api.github.com/repos/x/y/pulls/44' },
  },
];

export interface RespostaFalsa { status: number; corpo?: unknown; headers?: Record<string, string> }

/** Rotas -> resposta. Qualquer caminho nao mapeado devolve 404, que e o comportamento honesto. */
export type Rotas = Record<string, RespostaFalsa | ((n: number) => RespostaFalsa)>;

export interface FetchFalso {
  (url: string | URL | Request, init?: RequestInit): Promise<Response>;
  chamadas: { url: string; ifNoneMatch?: string }[];
}

/** `fetch` sintetico. Registra cada chamada para os testes contarem N+1 e conferirem condicional. */
export function criarFetchGitHub(rotas: Rotas, aoChamar?: (url: string) => void): FetchFalso {
  const chamadas: { url: string; ifNoneMatch?: string }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const cab = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({ url: u, ifNoneMatch: cab['if-none-match'] });
    aoChamar?.(u);
    const caminho = u.replace(/^https?:\/\/[^/]+/, '');
    const bruta = Object.entries(rotas).find(([k]) => caminho.startsWith(k))?.[1];
    const r = typeof bruta === 'function' ? bruta(chamadas.length) : bruta;
    if (!r) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const headers = { 'content-type': 'application/json', ...(r.headers ?? {}) };
    if (r.status === 304) return new Response(null, { status: 304, headers });
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status, headers });
  }) as FetchFalso;
  f.chamadas = chamadas;
  return f;
}

const CONTROL = '/repos/augustocfmacedo/eiff-control';
const FACTORY = '/repos/augustocfmacedo/eiff-dev-factory';

/** O caso saudavel completo: os dois repositorios respondendo. */
export const ROTAS_SAUDAVEIS: Rotas = {
  [`${CONTROL}/commits/main`]: { status: 200, corpo: commitMain(SHA_MAIN_CONTROL, '2026-09-22T09:00:00Z', 'MC-LIVE-1'), headers: { etag: 'W/"c1"', 'x-ratelimit-remaining': '4990', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1790000000' } },
  [`${CONTROL}/commits/${SHA_MAIN_CONTROL}/check-runs`]: { status: 200, corpo: CHECKS_VERDE },
  [`${CONTROL}/pulls`]: { status: 200, corpo: PULLS_CONTROL },
  [`${FACTORY}/commits/main`]: { status: 200, corpo: commitMain(SHA_MAIN_FACTORY, '2026-09-22T08:00:00Z', 'W1') },
  [`${FACTORY}/commits/${SHA_MAIN_FACTORY}/check-runs`]: { status: 200, corpo: CHECKS_RODANDO },
  [`${FACTORY}/pulls`]: { status: 200, corpo: [] },
  [`${FACTORY}/issues`]: { status: 200, corpo: ISSUES_FACTORY },
};

export const CAMINHOS = { CONTROL, FACTORY };

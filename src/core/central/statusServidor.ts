// Handler de `/api/development-status` — agregador do estado da construcao, SOMENTE LEITURA.
//
// A funcao Netlify e uma casca: aqui esta a regra, com `fetch` injetado, para a suite rodar sem rede,
// sem token e sem Supabase. Mesmo desenho de `comunicacaoServidor.ts` e `canaisServidor.ts`.
//
// Fluxo obrigatorio, nesta ordem:
//
//     request -> JWT -> perfil REAL no banco -> pode(ver_mission_control) -> GitHub -> sanitizacao -> response
//
// O papel NUNCA vem do navegador: vem da tabela `profile`. A permissao e a da MATRIZ UNICA do Control
// (`pode` em src/data/store.ts) — o Mission Control nao cria segunda ACL.
//
// O que NUNCA sai daqui: token, header do GitHub, URL autenticada, payload cru, stack trace. A resposta e
// montada campo a campo a partir do contrato, nunca serializando objeto de terceiro.
import { pode } from '../permissoes';
import type { Papel, Usuario } from '../types';
import {
  MAX_CHAMADAS_POR_CICLO, REPOSITORIOS_OBSERVADOS, lerGitHub,
  type CacheCondicional, type CodigoFalhaFonte, type LeituraGitHub, type LimiteGitHub, type RepositorioStatus,
} from './githubAdapter';
import { LIMITE_STALE_GITHUB_S, type BuildPublicado } from './statusVivo';
import {
  contarPorStatus, consolidarWorkItems, normalizarIssueFactory, normalizarPullRequest,
  type ContextoNormalizacao, type McStatus, type MissionControlWorkItem,
} from './workItem';

// -------------------------------------------------------------------------------- contrato da resposta

export interface EstadoFonteResposta {
  fonte: 'GITHUB';
  disponivel: boolean;
  stale: boolean;
  /** ultima leitura bem-sucedida desta fonte; null quando nenhuma deu certo */
  observadoEm: string | null;
  erroCodigo?: CodigoFalhaFonte;
  limite?: LimiteGitHub;
  /** quantas chamadas HTTP esta leitura custou — diagnostico de rate limit sem expor cabecalho */
  chamadas: number;
  maxChamadasPorCiclo: number;
}

export interface DevelopmentStatusResposta {
  /** momento desta leitura no servidor */
  observadoEm: string;
  /** o que esta publicado; `sha: null` quando o ambiente nao informa (lacuna declarada) */
  build: BuildPublicado;
  fontes: { github: EstadoFonteResposta };
  repositorios: RepositorioStatus[];
  workItems: MissionControlWorkItem[];
  contagens: Readonly<Record<McStatus, number>>;
  /** a fabrica AQUI e projecao do GitHub — e a resposta diz isso, nao a tela */
  factory: {
    procedencia: 'GITHUB_PROJECTION';
    aviso: string;
    repositorio: string;
    contagens: Readonly<Record<McStatus, number>>;
  };
  limiteStaleSegundos: number;
}

export const AVISO_FACTORY_PROJECAO =
  'Projeção do GitHub das issues da fábrica (labels factory:state:*). Não é o estado operacional da Factory: '
  + 'heartbeat, turno, lease, custo e última ferramenta não existem nesta fonte e não são exibidos.';

export type Resposta = { status: number; corpo: unknown };

export interface RequisicaoStatus {
  method: string;
  authorization: string | null;
}

export interface DepsStatus {
  fetch: typeof fetch;
  supabaseUrl: string;
  anon: string;
  agora: () => string;
  /** token de leitura do GitHub; vazio = fonte NOT_CONFIGURED (nunca quebra, nunca inventa) */
  githubToken: string;
  githubBaseUrl?: string;
  githubTimeoutMs?: number;
  cache?: CacheCondicional;
  build: BuildPublicado;
}

const resp = (status: number, corpo: unknown): Resposta => ({ status, corpo });

// ------------------------------------------------------------------------------------ autenticacao

interface Sessao { uid: string; usuario: Usuario }

/**
 * JWT -> usuario do Supabase -> perfil REAL no banco -> permissao da MATRIZ.
 * Sem token: 401. Com token e sem perfil ou sem a permissao: 403. Nada disso depende do cliente.
 */
export async function autenticarStatus(req: RequisicaoStatus, d: DepsStatus): Promise<Resposta | Sessao> {
  const token = (req.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return resp(401, { erro: 'nao_autenticado' });
  const cab = { apikey: d.anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  let user: Response;
  try { user = await d.fetch(`${d.supabaseUrl}/auth/v1/user`, { headers: cab }); }
  catch { return resp(503, { erro: 'autenticacao_indisponivel' }); }
  if (!user.ok) return resp(401, { erro: 'nao_autenticado' });
  const u = (await user.json().catch(() => null)) as { id?: string; email?: string } | null;
  if (!u?.id) return resp(401, { erro: 'nao_autenticado' });

  let r: Response;
  try { r = await d.fetch(`${d.supabaseUrl}/rest/v1/profile?id=eq.${u.id}&select=name,role,active`, { headers: cab }); }
  catch { return resp(503, { erro: 'autenticacao_indisponivel' }); }
  if (!r.ok) return resp(403, { erro: 'sem_perfil' });
  const linhas = (await r.json().catch(() => null)) as { name?: string; role?: string; active?: boolean }[] | null;
  const perfil = Array.isArray(linhas) ? linhas[0] : undefined;
  if (!perfil?.role) return resp(403, { erro: 'sem_perfil' });

  const usuario: Usuario = {
    id: u.id,
    nome: perfil.name ?? '',
    email: u.email ?? '',
    papel: perfil.role as Papel, // papel fora do catalogo simplesmente nao passa na MATRIZ abaixo
    obras: '*', // inerte: `ver_mission_control` nao tem escopo por obra e nenhum codigo de obra e passado
    ativo: perfil.active !== false,
  };
  if (!pode(usuario, 'ver_mission_control')) return resp(403, { erro: 'sem_permissao' });
  return { uid: u.id, usuario };
}

// -------------------------------------------------------------------------------------- projecao

/** Issues e PRs observados viram itens do quadro e se juntam pela correlacao (taskId quando existe). */
export function projetarWorkItems(leitura: LeituraGitHub, ctx: ContextoNormalizacao): MissionControlWorkItem[] {
  const itens: MissionControlWorkItem[] = [];
  for (const r of leitura.repositorios) {
    if (!r.disponivel) continue; // repositorio indisponivel nao vira "nenhum item": vira fonte indisponivel
    for (const i of r.issues) {
      itens.push(normalizarIssueFactory({
        repositorio: r.repository, numero: i.numero, titulo: i.titulo, estadoFactory: i.estadoFactory,
        taskId: i.taskId, estadoGitHub: i.estadoGitHub, criadoEm: i.criadoEm, atualizadoEm: i.atualizadoEm,
        fechadaEm: i.fechadaEm, url: i.url,
        lane: laneDasLabels(i.labelsFactory),
      }, ctx));
    }
    for (const p of r.pullRequests) {
      itens.push(normalizarPullRequest({
        repositorio: r.repository, numero: p.numero, titulo: p.titulo, branch: p.branch, headSha: p.headSha,
        rascunho: p.rascunho, taskId: p.taskId, criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm, url: p.url,
      }, ctx));
    }
  }
  return consolidarWorkItems(itens);
}

const PREFIXO_RISCO = 'factory:risk:';
const LANES = new Set(['GREEN', 'AMBER', 'RED']);
/** Lane pela label. Label ausente ou desconhecida = null; nunca se assume GREEN. */
export function laneDasLabels(labels: readonly string[]): 'GREEN' | 'AMBER' | 'RED' | null {
  for (const l of labels) {
    if (!l.startsWith(PREFIXO_RISCO)) continue;
    const v = l.slice(PREFIXO_RISCO.length);
    if (LANES.has(v)) return v as 'GREEN' | 'AMBER' | 'RED';
  }
  return null;
}

// ---------------------------------------------------------------------------------------- handler

const REPO_FABRICA = REPOSITORIOS_OBSERVADOS.find((r) => r.papel === 'fabrica')!.repository;

/**
 * GET autenticado e autorizado. Uma fonte ruim nao derruba a resposta: o corpo distingue repositorio
 * disponivel de repositorio indisponivel, com codigo fechado de falha.
 */
export async function tratarDevelopmentStatus(req: RequisicaoStatus, d: DepsStatus): Promise<Resposta> {
  if (req.method !== 'GET') return resp(405, { erro: 'metodo' });
  const sessao = await autenticarStatus(req, d);
  if ('status' in sessao) return sessao;

  const agora = d.agora();
  const leitura: LeituraGitHub = await lerGitHub({
    fetch: d.fetch, token: d.githubToken, agora: d.agora, cache: d.cache,
    baseUrl: d.githubBaseUrl, timeoutMs: d.githubTimeoutMs,
  });

  const algumDisponivel = leitura.repositorios.some((r) => r.disponivel);
  const primeiroErro = leitura.repositorios.find((r) => r.erroCodigo)?.erroCodigo;
  const ctx: ContextoNormalizacao = {
    observadoEm: leitura.observadoEm, agora, limiteStaleSegundos: LIMITE_STALE_GITHUB_S,
    fonteIndisponivel: !algumDisponivel,
  };
  const workItems = projetarWorkItems(leitura, ctx);
  const daFabrica = workItems.filter((i) => i.links?.repository === REPO_FABRICA);

  return resp(200, {
    observadoEm: agora,
    build: d.build,
    fontes: {
      github: {
        fonte: 'GITHUB',
        disponivel: algumDisponivel,
        stale: !algumDisponivel,
        observadoEm: algumDisponivel ? leitura.observadoEm : null,
        erroCodigo: algumDisponivel ? undefined : primeiroErro ?? 'SOURCE_UNAVAILABLE',
        limite: leitura.limite,
        chamadas: leitura.chamadas,
        maxChamadasPorCiclo: MAX_CHAMADAS_POR_CICLO,
      },
    },
    repositorios: leitura.repositorios,
    workItems,
    contagens: contarPorStatus(workItems),
    factory: {
      procedencia: 'GITHUB_PROJECTION',
      aviso: AVISO_FACTORY_PROJECAO,
      repositorio: REPO_FABRICA,
      contagens: contarPorStatus(daFabrica),
    },
    limiteStaleSegundos: LIMITE_STALE_GITHUB_S,
  } satisfies DevelopmentStatusResposta);
}

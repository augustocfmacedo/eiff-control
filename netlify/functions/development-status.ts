// /api/development-status — o estado VIVO da construção para o Mission Control. SOMENTE LEITURA.
//
// Esta função é uma casca: JWT → perfil real no banco → `ver_mission_control` → GitHub → sanitização
// acontece em `src/core/central/statusServidor.ts`, que é testável com `fetch` injetado.
//
// Segredos: `GITHUB_READ_TOKEN` existe SÓ aqui (painel do Netlify). Nunca `VITE_`, nunca no navegador,
// nunca no bundle, nunca no banco, nunca em log, nunca na resposta. Sem ele, a fonte volta como
// NOT_CONFIGURED — o painel não quebra e nenhum dado é inventado.
//
// Repositórios: a allowlist é server-side (`REPOSITORIOS_OBSERVADOS`). Esta função NÃO aceita parâmetro de
// repositório: não existe caminho para transformá-la em proxy do GitHub.
//
// Build SHA: NÃO é lido de process.env.COMMIT_REF — essa variável existe no build do Netlify e não no
// runtime da Function (provado no Deploy Preview 5). Ele vem de src/core/central/buildSha.ts, gerado
// durante `npm run build`, e é o commit DESTE artefato — coisa diferente de github.main.sha.
//
// Cache: `cacheEtag` é memória do processo — OPORTUNISTA, nunca requisito de consistência. Uma instância
// nova simplesmente refaz as chamadas completas.
import { tratarDevelopmentStatus } from '../../src/core/central/statusServidor';
import { ORIGEM_DO_BUILD, SHA_DO_BUILD } from '../../src/core/central/buildSha';
import type { CacheCondicional, EntradaCache } from '../../src/core/central/githubAdapter';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

// memória do processo: some quando a instância recicla, e tudo bem (ver cabeçalho)
const memoria = new Map<string, EntradaCache>();
const cacheEtag: CacheCondicional = {
  ler: (k) => memoria.get(k),
  gravar: (k, v) => { if (memoria.size > 64) memoria.clear(); memoria.set(k, v); },
};

export default async (req: Request): Promise<Response> => {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);


  try {
    const r = await tratarDevelopmentStatus(
      { method: req.method, authorization: req.headers.get('authorization') },
      {
        fetch, supabaseUrl, anon,
        agora: () => new Date().toISOString(),
        githubToken: (process.env.GITHUB_READ_TOKEN ?? '').trim(),
        githubTimeoutMs: Number(process.env.GITHUB_TIMEOUT_MS ?? '') || undefined,
        cache: cacheEtag,
        // SHA capturado no BUILD (scripts/gerar-build-sha.mjs), onde COMMIT_REF existe de verdade.
        // Lê-lo de process.env aqui devolveria sempre vazio: o runtime da Function não recebe COMMIT_REF.
        build: { sha: SHA_DO_BUILD, origem: ORIGEM_DO_BUILD },
      },
    );
    return json(r.corpo, r.status);
  } catch (e) {
    // nunca o token, nunca o corpo do GitHub, nunca stack trace: só a classe do erro
    console.error('[development-status]', e instanceof Error ? e.name : 'falha interna');
    return json({ erro: 'falha_interna' }, 500);
  }
};

export const config = { path: '/api/development-status' };

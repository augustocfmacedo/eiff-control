// /api/development-status — estado do desenvolvimento ao vivo para o Mission Control (Wave 03, F4).
// GET com JWT do Supabase -> papel SO do perfil no banco (ver_mission_control: Administrador e Diretoria) ->
// adapter READ-ONLY do GitHub. Sem GITHUB_READ_TOKEN responde 200 { modo: 'SNAPSHOT', motivo: 'nao_configurado' }.
// O token e fine-grained, somente leitura, so neste ambiente (decisao D3): nunca no navegador, nunca em log,
// nunca na resposta. Toda a logica vive em src/core/central/githubAdapter.ts (handler puro e testavel);
// aqui so entram o ambiente e a serializacao.
import { VARIAVEL_TOKEN_GITHUB, tratarDevelopmentStatus } from '../../src/core/central/githubAdapter';

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req: Request): Promise<Response> => {
  const saida = await tratarDevelopmentStatus(
    { metodo: req.method, authorization: req.headers.get('authorization'), anonDoCliente: req.headers.get('x-supabase-anon') },
    {
      http: fetch,
      supabaseUrl: (process.env.SUPABASE_URL ?? '').trim() || SUPABASE_URL_PADRAO,
      anon: process.env.SUPABASE_ANON_KEY,
      tokenGithub: process.env[VARIAVEL_TOKEN_GITHUB],
      agora: () => new Date().toISOString(),
      // telemetria minima: so numeros, estados e motivos — o handler nunca passa token, jwt ou payload
      log: (t) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } },
    },
  );
  return json(saida.corpo, saida.status);
};

export const config = { path: '/api/development-status' };

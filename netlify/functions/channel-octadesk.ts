// /api/channel/octadesk: diagnostico READ-ONLY do canal WhatsApp Oficial (Channel Provider 01).
// Valida o JWT do Supabase, le o papel SO do perfil no banco (permissao Radar) e consulta a Octadesk apenas com GET:
// /auth/check, /chat/numbers, /chat/templates-message e /chat (busca da conversa do contato).
// NENHUM POST de mensagem: sendApproved do provider recusa por desenho. Contrato da API em docs/octadesk.md.
// Segredos so no painel do Netlify: OCTADESK_API_KEY, OCTADESK_BASE_URL, OCTADESK_AGENT_EMAIL (nunca VITE_, nunca em log).
import { VARIAVEIS_OCTADESK, tratarCanal, type ConfigOctadesk, type DepsCanal } from '../../src/core/radar/canaisServidor';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!url || !anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);

  const env = { OCTADESK_API_KEY: (process.env.OCTADESK_API_KEY ?? '').trim(), OCTADESK_BASE_URL: (process.env.OCTADESK_BASE_URL ?? '').trim(), OCTADESK_AGENT_EMAIL: (process.env.OCTADESK_AGENT_EMAIL ?? '').trim() };
  const faltando = VARIAVEIS_OCTADESK.filter((v) => !env[v]);
  // agent email e opcional na API, mas a conta da EIFF opera por agente: sem ele, tratamos como configuracao incompleta
  const octadesk: ConfigOctadesk | undefined = faltando.length ? undefined : { baseUrl: env.OCTADESK_BASE_URL, apiKey: env.OCTADESK_API_KEY, agentEmail: env.OCTADESK_AGENT_EMAIL };

  let body: unknown;
  try { body = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }

  const deps: DepsCanal = {
    fetch, supabaseUrl: url, anon, octadesk, faltando: [...faltando],
    agora: () => new Date().toISOString(),
    // telemetria: so provider, operacao, status http, latencia e ids; nunca telefone, e-mail, texto ou chave
    log: (t) => { try { console.log(JSON.stringify({ evento: 'channel', ...t })); } catch { /* ignore */ } },
  };
  const r = await tratarCanal({ method: 'POST', authorization: req.headers.get('authorization'), body }, deps);
  return json(r.corpo, r.status);
};

export const config = { path: '/api/channel/octadesk' };

// /api/channel/octadesk: diagnostico do canal WhatsApp Oficial e ENVIO CANARIO (Send Canary 01).
// Valida o JWT do Supabase, le o papel SO do perfil no banco (permissao Radar) e consulta a Octadesk apenas com GET:
// /auth/check, /chat/numbers, /chat/templates-message e /chat (busca da conversa do contato).
// O POST so acontece com OCTADESK_SEND_MODE=canary E destino na allowlist OCTADESK_CANARY_NUMBERS; o padrao e disabled.
// A allowlist nunca vai para o navegador. Contrato da API em docs/octadesk.md.
// Segredos so no painel do Netlify: OCTADESK_API_KEY, OCTADESK_BASE_URL, OCTADESK_AGENT_EMAIL, OCTADESK_SEND_MODE,
// OCTADESK_CANARY_NUMBERS, OCTADESK_TEMPLATE_MAPPINGS e SUPABASE_SERVICE_ROLE_KEY (nunca VITE_, nunca em log).
import { lerModoEnvio, lerNumerosCanary } from '../../src/core/radar/canais';
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

  // mapeamentos de template: JSON server-side; sem mapeamento, template com variaveis nao envia
  let mapeamentosTemplate: DepsCanal['mapeamentosTemplate'];
  try { const m = JSON.parse(process.env.OCTADESK_TEMPLATE_MAPPINGS ?? '[]') as DepsCanal['mapeamentosTemplate']; if (Array.isArray(m)) mapeamentosTemplate = m; } catch { /* configuração inválida = sem mapeamento */ }

  const deps: DepsCanal = {
    fetch, supabaseUrl: url, anon, octadesk, faltando: [...faltando],
    modoEnvio: lerModoEnvio(process.env.OCTADESK_SEND_MODE),
    canaryNumeros: lerNumerosCanary(process.env.OCTADESK_CANARY_NUMBERS), // nunca devolvida ao navegador
    serviceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim() || undefined, // só para as RPCs radar_delivery_*
    mapeamentosTemplate,
    agora: () => new Date().toISOString(),
    // telemetria: so provider, operacao, status http, latencia e ids; nunca telefone, e-mail, texto ou chave
    log: (t) => { try { console.log(JSON.stringify({ evento: 'channel', ...t })); } catch { /* ignore */ } },
  };
  const r = await tratarCanal({ method: 'POST', authorization: req.headers.get('authorization'), body }, deps);
  return json(r.corpo, r.status);
};

export const config = { path: '/api/channel/octadesk' };

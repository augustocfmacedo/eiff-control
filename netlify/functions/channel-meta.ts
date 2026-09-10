// /api/channel/meta — diagnostico READ-ONLY da EIFF Central (Meta WhatsApp Cloud API).
// JWT do Supabase -> papel SO do perfil no banco (permissao Radar) -> leitura na Graph API: numero e templates.
// NENHUM envio: o provider Meta e fail-closed e recusa sendApproved nesta fase.
// Segredos so no painel do Netlify: META_WHATSAPP_* (nunca VITE_, nunca no navegador, nunca em log).
import { PAPEIS_RADAR } from '../../src/core/radar/comunicacaoLlm';
import { lerModoEnvio, lerNumerosCanary } from '../../src/core/radar/canais';
import { metaCloudProvider, seguroMeta, VARIAVEIS_META, type ConfigMeta, type DepsMeta } from '../../src/core/central/metaServidor';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !anon) return json({ erro: 'nao_autenticado' }, 401);
  const cab = { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const user = await fetch(`${url}/auth/v1/user`, { headers: cab });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);
  const u = (await user.json()) as { id?: string };
  const perfilR = await fetch(`${url}/rest/v1/profile?id=eq.${u.id}&select=role,organization_id`, { headers: cab });
  const perfil = ((await perfilR.json().catch(() => [])) as { role?: string; organization_id?: string }[])[0];
  if (!perfil?.role || !perfil.organization_id) return json({ erro: 'sem_perfil' }, 403);
  if (!(PAPEIS_RADAR as readonly string[]).includes(perfil.role)) return json({ erro: 'sem_permissao' }, 403);

  const env = Object.fromEntries(VARIAVEIS_META.map((v) => [v, (process.env[v] ?? '').trim()])) as Record<(typeof VARIAVEIS_META)[number], string>;
  const faltando = VARIAVEIS_META.filter((v) => !env[v]);
  const meta: ConfigMeta | undefined = env.META_WHATSAPP_ACCESS_TOKEN && env.META_WHATSAPP_PHONE_NUMBER_ID && env.META_WHATSAPP_WABA_ID
    ? { accessToken: env.META_WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID, wabaId: env.META_WHATSAPP_WABA_ID, versao: process.env.META_GRAPH_VERSION }
    : undefined;
  const deps: DepsMeta = {
    fetch, meta, faltando: [...faltando],
    modoEnvio: lerModoEnvio(process.env.META_WHATSAPP_SEND_MODE), // padrão disabled
    canaryNumeros: lerNumerosCanary(process.env.META_WHATSAPP_CANARY_NUMBERS), // nunca devolvida ao navegador
    numeros: { interno: (process.env.EIFF_CENTRAL_PHONE_NUMBER_ID ?? '').trim() || undefined, externo: (process.env.EIFF_COMMERCIAL_PHONE_NUMBER_ID ?? '').trim() || undefined },
    agora: () => new Date().toISOString(),
    log: (t) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } },
  };

  const provider = metaCloudProvider(meta, deps);
  const saude = await provider.healthCheck();
  const base = {
    provider: 'META_CLOUD', nome: provider.nome, capacidades: provider.capabilities(), saude,
    variaveisFaltando: faltando, modoEnvio: deps.modoEnvio, envioBloqueado: true,
    // só diz SE os contextos estão configurados; ids e allowlist não vão para o navegador
    contextos: { interno: !!deps.numeros?.interno, externo: !!deps.numeros?.externo },
  };
  if (saude.estado !== 'CONNECTED') return json({ ...base, numero: undefined, templates: [] });
  const ler = async <T>(f: () => Promise<T>, vazio: T): Promise<T> => { try { return await f(); } catch (e) { (base as Record<string, unknown>).aviso = seguroMeta((e as Error).message); return vazio; } };
  const [numero, templates] = await Promise.all([ler(() => provider.numeroInfo(), undefined), ler(() => provider.listTemplates(), [])]);
  return json({ ...base, numero: numero ? { id: numero.id, nome: numero.nome, qualidade: numero.qualidade, verificacao: numero.verificacao } : undefined, templates });
};

export const config = { path: '/api/channel/meta' };

// /api/channel/meta/webhook — porta de entrada da EIFF Central (Meta WhatsApp Cloud API).
// GET: verificacao do webhook (hub.mode/hub.verify_token/hub.challenge).
// POST: recebe eventos. A assinatura X-Hub-Signature-256 e validada sobre o CORPO BRUTO com o App Secret ANTES de
// qualquer leitura do conteudo; payload nao validado nunca e processado nem guardado. O bruto nao e persistido.
// Nesta fase (EIFF Central 01) os eventos sao normalizados e contados; nenhuma acao de negocio acontece, nenhuma
// mensagem e enviada. Segredos so no painel do Netlify: META_WHATSAPP_* (nunca VITE_, nunca em log).
import { tratarWebhookMeta, VARIAVEIS_META, type ConfigMeta, type DepsMeta } from '../../src/core/central/metaServidor';

export default async (req: Request): Promise<Response> => {
  const env = Object.fromEntries(VARIAVEIS_META.map((v) => [v, (process.env[v] ?? '').trim()])) as Record<(typeof VARIAVEIS_META)[number], string>;
  const faltando = VARIAVEIS_META.filter((v) => !env[v]);
  const meta: ConfigMeta | undefined = env.META_WHATSAPP_ACCESS_TOKEN && env.META_WHATSAPP_PHONE_NUMBER_ID
    ? { accessToken: env.META_WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID, wabaId: env.META_WHATSAPP_WABA_ID, verifyToken: env.META_WHATSAPP_VERIFY_TOKEN || undefined, appSecret: env.META_WHATSAPP_APP_SECRET || undefined, versao: process.env.META_GRAPH_VERSION }
    : undefined;

  const deps: DepsMeta = {
    fetch, meta, faltando: [...faltando],
    // contexto vem do numero que recebeu, nunca do texto
    numeros: { interno: (process.env.EIFF_CENTRAL_PHONE_NUMBER_ID ?? '').trim() || undefined, externo: (process.env.EIFF_COMMERCIAL_PHONE_NUMBER_ID ?? '').trim() || undefined },
    agora: () => new Date().toISOString(),
    log: (t) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } },
  };

  const url = new URL(req.url);
  const corpoBruto = req.method === 'POST' ? await req.text() : '';
  const r = await tratarWebhookMeta({ metodo: req.method, query: url.searchParams, corpoBruto, assinatura: req.headers.get('x-hub-signature-256') }, deps);
  // os eventos normalizados ainda nao viram acao: a Central so passa a agir depois de identidade e orquestrador
  return new Response(r.corpo, { status: r.status, headers: { 'content-type': `${r.tipo}; charset=utf-8`, 'cache-control': 'no-store' } });
};

export const config = { path: '/api/channel/meta/webhook' };

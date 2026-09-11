// /api/channel/meta/webhook — porta de entrada da EIFF Central (Meta WhatsApp Cloud API).
// GET: verificacao do webhook (hub.mode/hub.verify_token/hub.challenge).
// POST: recebe eventos. A assinatura X-Hub-Signature-256 e validada sobre o CORPO BRUTO com o App Secret ANTES de
// qualquer leitura do conteudo; payload nao validado nunca e processado nem guardado. O bruto nao e persistido.
// Segredos so no painel do Netlify: META_WHATSAPP_* (nunca VITE_, nunca em log).
//
// Wave 03 (F2): com CENTRAL_ALPHA_MODE=on e o contexto completo (organizacao, numero INTERNAL, allowlist), os eventos
// validados seguem para `processarWebhookCentral` (src/core/central/webhookCentral.ts), que orquestra as PORTAS da
// F2-DATA: persistencia da Central (escritor unico) e Dataset SELECT-only. Esta funcao NAO orquestra nada: so le o
// ambiente, cria o cliente service_role (que nunca sai daqui) e injeta as fabricas fixas do contrato. Com o modo
// desligado (padrao) ou contexto incompleto, a resposta e exatamente a de antes: contar e descartar.
// Nenhum POST na Graph API, nenhuma RPC, nenhuma leitura ou escrita direta de tabela acontece aqui.
import { createClient } from '@supabase/supabase-js';
import { LIMITE_CORPO_WEBHOOK, tratarWebhookMeta, VARIAVEIS_META, type ConfigMeta, type DepsMeta } from '../../src/core/central/metaServidor';
import { resolverContextoCentral } from '../../src/core/central/contextoServidor';
import { processarWebhookCentral } from '../../src/core/central/webhookCentral';
import { criarPersistenciaCentral } from '../../src/core/central/persistenciaCentral';
import { criarCarregadorDataset } from '../../src/data/datasetServidor';
import type { VariaveisCentralServidor } from '../../src/core/central/servidorContratos';

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const json = (corpo: unknown, status: number) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req: Request): Promise<Response> => {
  const env = Object.fromEntries(VARIAVEIS_META.map((v) => [v, (process.env[v] ?? '').trim()])) as Record<(typeof VARIAVEIS_META)[number], string>;
  const faltando = VARIAVEIS_META.filter((v) => !env[v]);
  const meta: ConfigMeta | undefined = env.META_WHATSAPP_ACCESS_TOKEN && env.META_WHATSAPP_PHONE_NUMBER_ID
    ? { accessToken: env.META_WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID, wabaId: env.META_WHATSAPP_WABA_ID, verifyToken: env.META_WHATSAPP_VERIFY_TOKEN || undefined, appSecret: env.META_WHATSAPP_APP_SECRET || undefined, versao: process.env.META_GRAPH_VERSION }
    : undefined;

  const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } };
  const agora = () => new Date().toISOString();
  const deps: DepsMeta = {
    fetch, meta, faltando: [...faltando],
    // contexto vem do numero que recebeu, nunca do texto
    numeros: { interno: (process.env.EIFF_CENTRAL_PHONE_NUMBER_ID ?? '').trim() || undefined, externo: (process.env.EIFF_COMMERCIAL_PHONE_NUMBER_ID ?? '').trim() || undefined },
    agora,
    log,
  };

  const url = new URL(req.url);
  // Teto ANTES de ler o corpo: com Content-Length declarado acima do limite, recusa sem materializar o body nem
  // gastar HMAC. O header e do cliente, entao NAO e protecao completa — a conferencia sobre o corpo real continua
  // dentro de tratarWebhookMeta. Limite de TAXA e dívida de borda (RATE_LIMIT_EDGE), fora do alcance da função.
  const declarado = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_WEBHOOK) {
    return json({ erro: 'corpo_grande' }, 413);
  }
  const corpoBruto = req.method === 'POST' ? await req.text() : '';
  const r = await tratarWebhookMeta({ metodo: req.method, query: url.searchParams, corpoBruto, assinatura: req.headers.get('x-hub-signature-256') }, deps);
  const respostaAnterior = () => new Response(r.corpo, { status: r.status, headers: { 'content-type': `${r.tipo}; charset=utf-8`, 'cache-control': 'no-store' } });
  // so POST validado (assinatura + formato) com eventos normalizados chega ao Alpha; GET, 401, 413, 400 e 405 saem como antes
  if (req.method !== 'POST' || r.status !== 200 || !r.eventos) return respostaAnterior();

  // UNICO ponto em que o ambiente da Central e lido: vira DADOS para o core (contextoServidor.ts e puro)
  const variaveis: VariaveisCentralServidor = {
    CENTRAL_ALPHA_MODE: process.env.CENTRAL_ALPHA_MODE,
    EIFF_CENTRAL_PHONE_NUMBER_ID: process.env.EIFF_CENTRAL_PHONE_NUMBER_ID,
    EIFF_COMMERCIAL_PHONE_NUMBER_ID: process.env.EIFF_COMMERCIAL_PHONE_NUMBER_ID,
    EIFF_CENTRAL_ORGANIZATION_ID: process.env.EIFF_CENTRAL_ORGANIZATION_ID,
    CENTRAL_ALPHA_NUMBERS: process.env.CENTRAL_ALPHA_NUMBERS,
    COMMIT_REF: process.env.COMMIT_REF,
  };
  const contexto = resolverContextoCentral(variaveis);
  // modo desligado (padrao): resposta identica a de antes, sem log extra
  if (contexto.modo === 'off') return respostaAnterior();
  if (!contexto.pronto) {
    log({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'alpha', outcome: 'contexto_fechado', motivo: contexto.motivo, eventos: r.eventos.length });
    return respostaAnterior();
  }
  // service_role so aqui, nunca no core, nunca em log, nunca em fallback para anon: sem a chave o Alpha fica fechado
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!serviceRole) {
    log({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'alpha', outcome: 'contexto_fechado', motivo: 'service_role_ausente', eventos: r.eventos.length });
    return respostaAnterior();
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const cliente = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  // o corpo ja foi validado e parseado por tratarWebhookMeta (status 200); o payload segue so para o core ler o texto em transito
  const saida = await processarWebhookCentral({
    payload: JSON.parse(corpoBruto),
    eventos: r.eventos,
    contexto,
    portas: criarPersistenciaCentral(cliente),
    carregarDataset: criarCarregadorDataset(cliente),
    agoraIso: agora(),
  });
  // resumo: so contagens e codigos — nunca texto, telefone ou payload
  log({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'alpha', outcome: saida.status === 200 ? 'ok' : 'retry', ...saida.resumo });
  return json({ ok: saida.status === 200, eventos: saida.resumo.eventos, processados: saida.resumo.processados }, saida.status);
};

export const config = { path: '/api/channel/meta/webhook' };

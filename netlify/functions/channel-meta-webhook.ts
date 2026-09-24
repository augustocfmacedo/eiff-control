// /api/channel/meta/webhook — porta de entrada da EIFF Central (Meta WhatsApp Cloud API).
// GET: verificacao do webhook (hub.mode/hub.verify_token/hub.challenge).
// POST: recebe eventos. A assinatura X-Hub-Signature-256 e validada sobre o CORPO BRUTO com o App Secret ANTES de
// qualquer leitura do conteudo; payload nao validado nunca e processado nem guardado. O bruto nao e persistido.
//
// EIFF Inbox (fase 2): depois da validacao e da normalizacao da Central, os `ChannelInboundEvent` mais o CONTEUDO das
// mensagens recebidas (`extrairConteudosMeta`, que a Central nao transporta no evento) sao entregues a fronteira de
// ingestao do Inbox (`ingerirEventosCentral`). Quem escreve e o Inbox, pela sua porta server-side
// (src/core/inbox/ingestaoPorta.ts → RPC inbox_ingest, idempotente); esta funcao continua sem cliente de banco e sem
// chave. Sem a porta configurada, o comportamento anterior (contar e responder 200) continua. Falha de ingestao devolve
// 500: a Meta reenvia e a RPC idempotente completa so o que faltou. Nenhuma mensagem e enviada.
// Segredos so no painel do Netlify: META_WHATSAPP_* (nunca VITE_, nunca em log).
import { LIMITE_CORPO_WEBHOOK, tratarWebhookMeta, VARIAVEIS_META, type ConfigMeta, type DepsMeta } from '../../src/core/central/metaServidor';
import { extrairConteudosMeta } from '../../src/core/central/metaEventos';
import { ingerirEventosCentral } from '../../src/core/inbox/ingestaoServidor';
import { configPortaIngest, portaIngestRpc } from '../../src/core/inbox/ingestaoPorta';
import { portaAplicarRoteamentoRpc, portaContextoRest, rotearNoServidor } from '../../src/core/inbox/roteamentoPorta';
import { configInteligencia, provedorAnthropic } from '../../src/core/inbox/inteligenciaLlm';

const json = (corpo: unknown, status: number) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } };

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
  const respostaCentral = () => new Response(r.corpo, { status: r.status, headers: { 'content-type': `${r.tipo}; charset=utf-8`, 'cache-control': 'no-store' } });
  if (r.status !== 200 || req.method !== 'POST' || !r.eventos?.length) return respostaCentral();

  // EIFF Inbox: entrega dos eventos ja validados e normalizados a fronteira de ingestao
  const porta = configPortaIngest(process.env);
  if ('motivo' in porta) { log({ evento: 'inbox_ingest', outcome: 'nao_configurado', motivo: porta.motivo, eventos: r.eventos.length }); return respostaCentral(); }
  // o conteudo so existe aqui, a partir do payload ja validado; a Central nao o transporta no evento
  let conteudos: ReturnType<typeof extrairConteudosMeta>;
  try { conteudos = extrairConteudosMeta(JSON.parse(corpoBruto)); } catch { conteudos = []; }
  // Octopus Router no servidor: contexto e aplicacao pela chave de servico; IA so com ANTHROPIC_API_KEY (senao, deterministico)
  const ia = configInteligencia(process.env);
  const cfgRot = { url: porta.url, chave: porta.chave, organizacaoId: porta.organizacaoId };
  const rotear = (threadId: string, messageId: string) => rotearNoServidor(threadId, messageId, {
    contexto: portaContextoRest(cfgRot, fetch), aplicar: portaAplicarRoteamentoRpc(cfgRot, fetch), log,
    inteligencia: 'chave' in ia ? (ctx) => provedorAnthropic(ia, { fetch }, { equipes: ctx.equipes, regras: ctx.regras, obras: ctx.obras }) : undefined,
  });
  if (!('chave' in ia)) log({ evento: 'inbox_inteligencia', outcome: 'nao_configurada', motivo: ia.motivo });
  const relatorio = await ingerirEventosCentral(porta.organizacaoId, r.eventos, conteudos, { ingerir: portaIngestRpc(porta, fetch), log, agora: deps.agora , rotear });
  log({ evento: 'inbox_ingest', outcome: relatorio.falhas.length ? 'parcial' : 'ok', recebidos: relatorio.recebidos, ingeridos: relatorio.ingeridos, duplicados: relatorio.duplicados, ignorados: relatorio.ignorados.length, falhas: relatorio.falhas.length, semInteligencia: relatorio.semInteligencia, roteados: relatorio.roteados, atribuidos: relatorio.atribuidos });
  if (relatorio.falhas.length) return json({ ok: false, erro: 'inbox_ingest_falhou', eventos: r.eventos.length, falhas: relatorio.falhas.length }, 500);
  return json({ ok: true, eventos: r.eventos.length, inbox: { ingeridos: relatorio.ingeridos, duplicados: relatorio.duplicados } }, 200);
};

export const config = { path: '/api/channel/meta/webhook' };

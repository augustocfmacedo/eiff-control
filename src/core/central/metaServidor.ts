// Provider Meta WhatsApp Cloud API, SOMENTE server-side (fetch injetado, testavel; mesmo padrao de canaisServidor).
// EIFF Central 01 e READ-ONLY: healthCheck, numero, templates. sendApproved e fail-closed e ainda nao envia.
// Segredos so no painel do Netlify (META_WHATSAPP_*), nunca VITE_, nunca no navegador, nunca em log.
// Contratos da Graph API conferidos na documentacao oficial: ver docs/eiff-central.md.
import { ErroCanal, NOME_PROVIDER, autorizarDestino, mascararTelefone, normalizarTelefone, recusarEnvio, type CommunicationChannelProvider, type ModoEnvio, type PedidoEnvio, type RemetenteCanal, type ResultadoEnvio, type SaudeProvider, type TemplateCanal } from '../radar/canais';
import { comparacaoConstante, normalizarEventosMeta, verificarDesafioMeta, type NumerosCentral, type OpcoesNormalizacao } from './metaEventos';
import { validarCoerenciaCanalMeta, type PedidoEnvioMeta } from './metaEnvio';

type Row = Record<string, unknown>;
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
/** Nada de token, telefone ou e-mail em mensagem que sobe para resposta ou log. */
/**
 * Higieniza qualquer texto que suba para resposta ou log. Telefone entra formatado ("+55 62 98888-7777"),
 * entao a mascara conta digitos ignorando espacos, pontos, tracos e parenteses — nao so digitos contiguos.
 */
export const seguroMeta = (s: string) => s
  .replace(/EAA[A-Za-z0-9_-]+/g, 'EAA***')
  .replace(/[A-Za-z0-9_-]{24,}/g, '***')
  .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => ((m.match(/\d/g) ?? []).length >= 8 ? '***' : m))
  .slice(0, 200);

export const VARIAVEIS_META = ['META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_WABA_ID', 'META_WHATSAPP_VERIFY_TOKEN', 'META_WHATSAPP_APP_SECRET'] as const;
export const VERSAO_GRAPH_PADRAO = 'v21.0';
export interface ConfigMeta { baseUrl?: string; versao?: string; accessToken: string; phoneNumberId: string; wabaId: string; verifyToken?: string; appSecret?: string }
export interface DepsMeta {
  fetch: typeof fetch;
  meta?: ConfigMeta; // ausente = NOT_CONFIGURED
  faltando?: string[];
  modoEnvio?: ModoEnvio; // META_WHATSAPP_SEND_MODE; padrao disabled
  canaryNumeros?: string[];
  numeros?: NumerosCentral; // EIFF_CENTRAL_PHONE_NUMBER_ID / EIFF_COMMERCIAL_PHONE_NUMBER_ID
  agora?: () => string;
  timeoutMs?: number;
  log?: (t: Record<string, unknown>) => void; // provider, operation, http_status, latency_ms, outcome — nunca token/telefone/texto
}

// ---------------------------------------------------------------------------
// Normalizadores (puros)
// ---------------------------------------------------------------------------
/** GET /{phone-number-id}: id, display_phone_number, verified_name, quality_rating, code_verification_status. */
export function normalizarNumeroMeta(bruto: unknown): RemetenteCanal & { qualidade?: string; verificacao?: string } {
  const x = (bruto ?? {}) as Row;
  return { id: txt(x.id) ?? '', nome: txt(x.verified_name), numero: normalizarTelefone(txt(x.display_phone_number)) ?? txt(x.display_phone_number), qualidade: txt(x.quality_rating), verificacao: txt(x.code_verification_status) };
}
const STATUS_META: Record<string, TemplateCanal['status']> = { APPROVED: 'approved', PENDING: 'pending', IN_REVIEW: 'pending', REJECTED: 'rejected', PAUSED: 'rejected', DISABLED: 'rejected' };
/** GET /{waba-id}/message_templates: id, name, status, category, language, components. */
export function normalizarTemplatesMeta(bruto: unknown): TemplateCanal[] {
  const lista = arr((bruto as Row)?.data ?? bruto);
  return lista.filter((x) => txt(x.id)).map((x) => {
    const componentes = arr(x.components);
    // variaveis do corpo: {{1}}, {{2}}... e nomes em example.body_text quando houver
    const corpo = componentes.map((c) => txt(c.text) ?? '').join(' ');
    const variaveis = [...new Set([...corpo.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1]))];
    const s = (txt(x.status) ?? '').toUpperCase();
    return {
      id: String(x.id), nome: txt(x.name) ?? String(x.id), status: STATUS_META[s] ?? 'desconhecido',
      categoria: txt(x.category), idioma: txt(x.language), ativo: s === 'APPROVED', variaveis,
    };
  });
}

// ---------------------------------------------------------------------------
// Assinatura do webhook (X-Hub-Signature-256)
// ---------------------------------------------------------------------------
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
/** Comparacao de tempo constante: reexportada do modulo puro, para existir UMA implementacao so. */
export { comparacaoConstante };
/**
 * Valida X-Hub-Signature-256 = "sha256=<hmac hex>" sobre o CORPO BRUTO, com o App Secret.
 * Sem cabecalho, sem segredo ou com formato estranho: recusa. Payload nao validado nunca e processado.
 */
export async function verificarAssinaturaMeta(corpoBruto: string, cabecalho: string | null | undefined, appSecret: string | undefined, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<boolean> {
  if (!appSecret || !cabecalho) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(cabecalho.trim());
  if (!m) return false;
  const enc = new TextEncoder();
  const chave = await subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinado = await subtle.sign('HMAC', chave, enc.encode(corpoBruto));
  return comparacaoConstante(hex(assinado), m[1].toLowerCase());
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
const TIMEOUT_PADRAO_MS = 12_000;
export function metaCloudProvider(cfg: ConfigMeta | undefined, d: DepsMeta): CommunicationChannelProvider & { numeroInfo(): Promise<RemetenteCanal & { qualidade?: string; verificacao?: string }> } {
  const faltando = cfg ? [] : (d.faltando ?? [...VARIAVEIS_META]);
  const base = `${(cfg?.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${cfg?.versao ?? VERSAO_GRAPH_PADRAO}`;
  const exigir = (): ConfigMeta => { if (!cfg) throw new ErroCanal('nao_configurado', `Meta Cloud não configurada: falta ${faltando.join(', ') || 'configuração'}.`); return cfg; };
  const get = async (caminho: string, operacao: string): Promise<unknown> => {
    const c = exigir();
    const inicio = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), d.timeoutMs ?? TIMEOUT_PADRAO_MS);
    try {
      const r = await d.fetch(`${base}${caminho}`, { method: 'GET', signal: ctrl.signal, headers: { accept: 'application/json', authorization: `Bearer ${c.accessToken}` } });
      const texto = await r.text();
      d.log?.({ evento: 'central_call', provider: 'META_CLOUD', operation: operacao, http_status: r.status, latency_ms: Date.now() - inicio, ok: r.ok });
      if (!r.ok) throw new ErroCanal('provider_http', `Meta ${operacao}: HTTP ${r.status}${texto ? ` — ${seguroMeta(texto)}` : ''}`, r.status);
      try { return texto ? JSON.parse(texto) : {}; } catch { throw new ErroCanal('resposta_invalida', `Meta ${operacao}: resposta não é JSON.`); }
    } catch (e) {
      if (e instanceof ErroCanal) throw e;
      const abortou = (e as Error).name === 'AbortError';
      d.log?.({ evento: 'central_call', provider: 'META_CLOUD', operation: operacao, latency_ms: Date.now() - inicio, ok: false, outcome: abortou ? 'timeout' : 'rede' });
      throw new ErroCanal(abortou ? 'timeout' : 'rede', `Meta ${operacao}: ${abortou ? 'tempo esgotado' : 'falha de rede'}.`);
    } finally { clearTimeout(t); }
  };
  const numeroInfo = async () => normalizarNumeroMeta(await get(`/${encodeURIComponent(exigir().phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`, 'phone_number'));
  const vazio = async () => [];
  return {
    codigo: 'META_CLOUD', nome: NOME_PROVIDER.META_CLOUD,
    // sem INBOUND_WEBHOOK aqui: o webhook existe, mas quem o expoe e a funcao Netlify, nao o provider
    capabilities: () => ['NEW_CONVERSATION_TEMPLATE', 'OPEN_CONVERSATION_FREEFORM', 'READ_TEMPLATES'],
    healthCheck: async (): Promise<SaudeProvider> => {
      if (!cfg) return { estado: 'NOT_CONFIGURED', variaveisFaltando: faltando, detalhe: `Falta configurar ${faltando.join(', ')} no Netlify.`, verificadoEm: d.agora?.() };
      try {
        const n = await numeroInfo();
        return n.id ? { estado: 'CONNECTED', detalhe: `número ${mascararTelefone(n.numero)}${n.qualidade ? ` · qualidade ${n.qualidade}` : ''}`, verificadoEm: d.agora?.() }
          : { estado: 'ERROR', detalhe: 'Graph API respondeu sem id do número.', verificadoEm: d.agora?.() };
      } catch (e) { return { estado: 'ERROR', detalhe: seguroMeta((e as Error).message), verificadoEm: d.agora?.() }; }
    },
    listSenders: async () => [await numeroInfo()],
    listTemplates: async () => normalizarTemplatesMeta(await get(`/${encodeURIComponent(exigir().wabaId)}/message_templates?limit=100`, 'templates')),
    // a Cloud API nao tem "conversa" consultavel como o Octadesk: o estado da janela vem do webhook (fase futura)
    findConversation: async () => undefined, getConversation: async () => undefined, getMessages: vazio,
    /**
     * Fronteira do efeito externo: fail-closed, em SEGUNDA camada (a primeira e o handler, antes de criar a
     * entrega). Repete as tres guardas com o que o pedido carrega — modo de envio, allowlist do canario e
     * entregabilidade (canal coerente, janela comprovada no modo livre) — e ainda assim RECUSA: nesta onda a
     * Central nao envia. A montagem da requisicao e o rito completo do canario vivem em metaEnvio.ts
     * (executarEnvioMeta), ja implementados e testados; o POST entra na onda de liberacao do envio.
     * Nenhum POST na Graph API existe neste arquivo.
     */
    sendApproved: async (p: PedidoEnvio): Promise<ResultadoEnvio> => {
      const pm = p as PedidoEnvioMeta;
      const autorizacao = autorizarDestino(pm.telefone, d.modoEnvio ?? 'disabled', d.canaryNumeros ?? []);
      if (!autorizacao.permitido) throw new ErroCanal(autorizacao.codigo ?? 'destino_nao_autorizado', autorizacao.motivo, 403);
      const coerencia = validarCoerenciaCanalMeta({ canalComunicacao: pm.canal, canalEntrega: pm.canal });
      if (!coerencia.ok) throw new ErroCanal('canal_incoerente', coerencia.motivo, 409);
      if (pm.entregabilidade && !pm.entregabilidade.apto) throw new ErroCanal('nao_entregavel', pm.entregabilidade.motivo, 409);
      if (pm.modo === 'FREEFORM' && !pm.janela?.janelaComprovada) throw new ErroCanal('janela_nao_comprovada', 'mensagem livre exige janela de 24 h comprovada por mensagem do contato (webhook MESSAGE_RECEIVED)', 409);
      return recusarEnvio(); // EIFF Central: envio entra em fase propria, depois da prova de webhook e identidade
    },
    reconcileDelivery: async () => ({ resultado: 'NOT_FOUND', candidatos: 0, motivo: 'Meta Cloud: reconciliação entra com o envio, na fase seguinte.' }),
    numeroInfo,
  };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
export interface EntradaWebhook { metodo: string; query: URLSearchParams; corpoBruto: string; assinatura?: string | null }
/**
 * Teto do corpo do webhook. A notificacao da Meta e pequena (metadados, sem midia); um corpo acima disto e
 * erro ou abuso, e nao pode custar um HMAC. Conferido ANTES de qualquer leitura ou verificacao.
 */
export const LIMITE_CORPO_WEBHOOK = 512 * 1024;
export interface SaidaWebhook { status: number; corpo: string; tipo: 'text/plain' | 'application/json'; eventos?: ReturnType<typeof normalizarEventosMeta> }
/**
 * Trata o webhook da Meta: GET verifica o desafio; POST valida a assinatura ANTES de olhar o conteudo e devolve
 * os eventos ja normalizados. Payload nao validado nunca e processado nem persistido; o bruto nao e guardado.
 * Responde 200 mesmo com payload sem evento util: a Meta reenvia o que nao for confirmado.
 */
export async function tratarWebhookMeta(e: EntradaWebhook, d: DepsMeta & { subtle?: SubtleCrypto }): Promise<SaidaWebhook> {
  const cfg = d.meta;
  if (e.metodo === 'GET') {
    const v = verificarDesafioMeta(e.query, cfg?.verifyToken);
    d.log?.({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'verify', outcome: v.ok ? 'ok' : 'recusado' });
    return v.ok ? { status: 200, corpo: v.challenge!, tipo: 'text/plain' } : { status: 403, corpo: JSON.stringify({ erro: 'verificacao_recusada', mensagem: v.motivo }), tipo: 'application/json' };
  }
  if (e.metodo !== 'POST') return { status: 405, corpo: JSON.stringify({ erro: 'metodo' }), tipo: 'application/json' };
  // teto antes do HMAC: corpo grande nao compra tempo de CPU
  if (e.corpoBruto.length > LIMITE_CORPO_WEBHOOK) {
    d.log?.({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'receive', outcome: 'corpo_grande', bytes: e.corpoBruto.length });
    return { status: 413, corpo: JSON.stringify({ erro: 'corpo_grande' }), tipo: 'application/json' };
  }
  const valida = await verificarAssinaturaMeta(e.corpoBruto, e.assinatura, cfg?.appSecret, d.subtle);
  if (!valida) {
    d.log?.({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'receive', outcome: 'assinatura_invalida' });
    return { status: 401, corpo: JSON.stringify({ erro: 'assinatura_invalida' }), tipo: 'application/json' };
  }
  let payload: unknown;
  try { payload = JSON.parse(e.corpoBruto); } catch { return { status: 400, corpo: JSON.stringify({ erro: 'corpo_invalido' }), tipo: 'application/json' }; }
  const opts: OpcoesNormalizacao = { numeros: d.numeros, agoraIso: d.agora?.() };
  const eventos = normalizarEventosMeta(payload, opts);
  // log so com contagem e tipos: nunca telefone, texto ou payload
  d.log?.({ evento: 'central_webhook', provider: 'META_CLOUD', operation: 'receive', outcome: 'ok', eventos: eventos.length, tipos: [...new Set(eventos.map((x) => x.eventType))], contextos: [...new Set(eventos.map((x) => x.contexto ?? 'DESCONHECIDO'))] });
  return { status: 200, corpo: JSON.stringify({ ok: true, eventos: eventos.length }), tipo: 'application/json', eventos };
}

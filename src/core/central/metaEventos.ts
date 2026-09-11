// Traducao Meta WhatsApp Cloud API -> modelo interno. PURO: sem rede, sem SDK, sem segredo.
// O core nunca conhece o formato Graph API fora deste arquivo: quem consome recebe ChannelInboundEvent.
// Contrato conferido na documentacao oficial (ver docs/eiff-central.md).
import { normalizarTelefone, type ChannelInboundEvent, type CommunicationContext, type TipoEventoInbound } from '../radar/canais';

/**
 * Comparacao de tempo constante para segredo curto (token do webhook). Tamanho diferente recusa de imediato:
 * o comprimento do token configurado nao e segredo, mas o conteudo e. Vive neste modulo puro de proposito:
 * o provider depende daqui, e nunca o contrario (a fronteira e prendida por teste).
 */
export function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Numeros configurados por contexto. O contexto vem do numero que RECEBEU, nunca do texto da mensagem. */
export interface NumerosCentral { interno?: string; externo?: string }
/**
 * Contexto pelo phone_number_id. Numero desconhecido nao vira INTERNAL por conveniencia: fica indefinido,
 * e quem consome trata como nao confiavel.
 */
export function contextoDoNumero(phoneNumberId: string | undefined, numeros: NumerosCentral): CommunicationContext | undefined {
  if (!phoneNumberId) return undefined;
  if (numeros.interno && phoneNumberId === numeros.interno) return 'INTERNAL';
  if (numeros.externo && phoneNumberId === numeros.externo) return 'EXTERNAL';
  return undefined;
}

/** status do webhook da Meta -> evento interno. "failed" chega com `errors`; status novo/desconhecido nao vira nada. */
const EVENTO_POR_STATUS: Record<string, TipoEventoInbound> = { sent: 'MESSAGE_SENT', delivered: 'MESSAGE_DELIVERED', read: 'MESSAGE_READ', failed: 'MESSAGE_FAILED' };

/** Como `iso`, mas sem inventar data: campo ausente ou invalido fica indefinido. */
const isoOpcional = (unix: unknown): string | undefined => {
  const n = Number(unix);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
};
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
type Row = Record<string, unknown>;
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

export interface OpcoesNormalizacao { numeros?: NumerosCentral; agoraIso?: string }
/**
 * Evento da Central: o contrato generico `ChannelInboundEvent` mais o que so a Meta informa e que a fase de envio
 * precisa — o titulo/detalhe do erro (`errors[]`, ao lado do codigo) e a janela de atendimento que a propria Meta
 * devolve no status (`conversation.expiration_timestamp` e `conversation.origin.type`). Nada disso e PII.
 */
export interface EventoCentralMeta extends ChannelInboundEvent {
  erroTitulo?: string;
  erroDetalhe?: string;
  /** Fim da janela de 24 h informado pela Meta (quando vem no status). A prova continua sendo a mensagem do contato. */
  janelaExpiraEm?: string;
  origemConversa?: string;
}
const erroDe = (linha: Row | undefined): { erroCodigo?: string; erroTitulo?: string; erroDetalhe?: string } => {
  if (!linha) return {};
  const dados = (linha.error_data ?? {}) as Row;
  return {
    erroCodigo: txt(linha.code) ?? (linha.code !== undefined && linha.code !== null ? String(linha.code) : undefined),
    erroTitulo: txt(linha.title),
    erroDetalhe: txt(dados.details) ?? txt(linha.message),
  };
};
/**
 * Normaliza a notificacao do webhook. Estrutura oficial:
 * { object: 'whatsapp_business_account', entry: [{ id, changes: [{ field: 'messages', value: { metadata, messages[], statuses[] } }] }] }
 * Payload de outro `object`, ou change de outro `field`, e ignorado em silencio (nao e erro: a Meta manda varios).
 */
export function normalizarEventosMeta(payload: unknown, opts: OpcoesNormalizacao = {}): EventoCentralMeta[] {
  const p = (payload ?? {}) as Row;
  if (txt(p.object) !== 'whatsapp_business_account') return [];
  const eventos: EventoCentralMeta[] = [];
  for (const entrada of arr(p.entry)) {
    for (const mudanca of arr(entrada.changes)) {
      if (txt(mudanca.field) !== 'messages') continue;
      const valor = (mudanca.value ?? {}) as Row;
      const metadata = (valor.metadata ?? {}) as Row;
      const phoneNumberId = txt(metadata.phone_number_id);
      const contexto = contextoDoNumero(phoneNumberId, opts.numeros ?? {});
      // mensagens recebidas do contato
      for (const m of arr(valor.messages)) {
        const id = txt(m.id);
        if (!id) continue;
        eventos.push({
          provider: 'META_CLOUD', phoneNumberId, contexto,
          // telefone que nao normaliza nao vira chave de conversa: id vazio, e quem consome trata como nao confiavel
          externalConversationId: normalizarTelefone(txt(m.from)) ?? '',
          externalMessageId: id, direction: 'inbound', eventType: 'MESSAGE_RECEIVED',
          // sem timestamp valido, usa a hora da recepcao — nunca 1970, que passaria por filtro de idade
          occurredAt: isoOpcional(m.timestamp) ?? opts.agoraIso ?? new Date().toISOString(),
          contactPhone: normalizarTelefone(txt(m.from)), messageType: txt(m.type) ?? 'desconhecido',
          // mensagem recebida tambem pode vir com erro (tipo nao suportado, midia expirada)
          ...erroDe(arr(m.errors)[0]),
        });
      }
      // status das mensagens que NOS enviamos
      for (const s of arr(valor.statuses)) {
        const id = txt(s.id);
        const status = (txt(s.status) ?? '').toLowerCase();
        const tipo = EVENTO_POR_STATUS[status];
        if (!id || !tipo) continue;
        const conversa = (s.conversation ?? {}) as Row;
        eventos.push({
          provider: 'META_CLOUD', phoneNumberId, contexto,
          externalConversationId: txt(conversa.id) ?? normalizarTelefone(txt(s.recipient_id)) ?? '',
          externalMessageId: id, direction: 'outbound', eventType: tipo,
          occurredAt: isoOpcional(s.timestamp) ?? opts.agoraIso ?? new Date().toISOString(), externalStatus: status,
          contactPhone: normalizarTelefone(txt(s.recipient_id)),
          ...erroDe(arr(s.errors)[0]),
          janelaExpiraEm: isoOpcional(conversa.expiration_timestamp),
          origemConversa: txt((conversa.origin as Row | undefined)?.type),
        });
      }
    }
  }
  return eventos;
}

/**
 * Verificacao do webhook (GET): a Meta manda hub.mode=subscribe, hub.verify_token e hub.challenge.
 * So devolve o challenge quando o token bate exatamente com o configurado no servidor.
 */
export function verificarDesafioMeta(params: URLSearchParams, verifyToken: string | undefined): { ok: boolean; challenge?: string; motivo: string } {
  if (!verifyToken) return { ok: false, motivo: 'META_WHATSAPP_VERIFY_TOKEN não configurado' };
  const modo = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (modo !== 'subscribe') return { ok: false, motivo: 'hub.mode diferente de subscribe' };
  if (!token || !comparacaoConstante(token, verifyToken)) return { ok: false, motivo: 'hub.verify_token não confere' };
  if (!challenge) return { ok: false, motivo: 'hub.challenge ausente' };
  return { ok: true, challenge, motivo: 'verificação aceita' };
}

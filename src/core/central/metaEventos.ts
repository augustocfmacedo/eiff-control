// Traducao Meta WhatsApp Cloud API -> modelo interno. PURO: sem rede, sem SDK, sem segredo.
// O core nunca conhece o formato Graph API fora deste arquivo: quem consome recebe ChannelInboundEvent.
// Contrato conferido na documentacao oficial (ver docs/eiff-central.md).
import { normalizarTelefone, type ChannelInboundEvent, type CommunicationContext, type TipoEventoInbound } from '../radar/canais';

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

const iso = (unix: unknown): string => {
  const n = Number(unix);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date(0).toISOString();
};
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
type Row = Record<string, unknown>;
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

export interface OpcoesNormalizacao { numeros?: NumerosCentral; agoraIso?: string }
/**
 * Normaliza a notificacao do webhook. Estrutura oficial:
 * { object: 'whatsapp_business_account', entry: [{ id, changes: [{ field: 'messages', value: { metadata, messages[], statuses[] } }] }] }
 * Payload de outro `object`, ou change de outro `field`, e ignorado em silencio (nao e erro: a Meta manda varios).
 */
export function normalizarEventosMeta(payload: unknown, opts: OpcoesNormalizacao = {}): ChannelInboundEvent[] {
  const p = (payload ?? {}) as Row;
  if (txt(p.object) !== 'whatsapp_business_account') return [];
  const eventos: ChannelInboundEvent[] = [];
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
          externalConversationId: normalizarTelefone(txt(m.from)) ?? txt(m.from) ?? '',
          externalMessageId: id, direction: 'inbound', eventType: 'MESSAGE_RECEIVED',
          occurredAt: iso(m.timestamp), contactPhone: normalizarTelefone(txt(m.from)), messageType: txt(m.type) ?? 'desconhecido',
        });
      }
      // status das mensagens que NOS enviamos
      for (const s of arr(valor.statuses)) {
        const id = txt(s.id);
        const status = (txt(s.status) ?? '').toLowerCase();
        const tipo = EVENTO_POR_STATUS[status];
        if (!id || !tipo) continue;
        const conversa = (s.conversation ?? {}) as Row;
        const erro = arr(s.errors)[0];
        eventos.push({
          provider: 'META_CLOUD', phoneNumberId, contexto,
          externalConversationId: txt(conversa.id) ?? normalizarTelefone(txt(s.recipient_id)) ?? '',
          externalMessageId: id, direction: 'outbound', eventType: tipo,
          occurredAt: iso(s.timestamp), externalStatus: status,
          contactPhone: normalizarTelefone(txt(s.recipient_id)),
          erroCodigo: erro ? (txt(erro.code) ?? (erro.code !== undefined && erro.code !== null ? String(erro.code) : undefined)) : undefined,
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
  if (!token || token !== verifyToken) return { ok: false, motivo: 'hub.verify_token não confere' };
  if (!challenge) return { ok: false, motivo: 'hub.challenge ausente' };
  return { ok: true, challenge, motivo: 'verificação aceita' };
}

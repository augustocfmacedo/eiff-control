// EIFF Inbox: porta SERVER-SIDE da ingestao — a chamada real a RPC inbox_ingest (migration 0056) com a chave de servico.
//
// Vive no modulo do Inbox (nao da Central) de proposito: a Central continua sendo leitura e so entrega o contrato
// normalizado; quem ESCREVE e o Inbox, por esta porta, sempre no servidor. Regras:
// - a chave de servico vem do ambiente da funcao Netlify (SUPABASE_SERVICE_ROLE_KEY), nunca de VITE_, nunca do
//   navegador, e nao sai daqui (nem em log, nem em erro: a mensagem de erro so carrega o status HTTP);
// - `fetch` e injetado para o teste provar a chamada sem rede;
// - o texto da mensagem vai no corpo da RPC e em lugar nenhum mais.
import { recusaDoIngest, type PedidoIngest, type ResultadoIngest } from './ingestaoServidor';

export interface AmbienteIngest { SUPABASE_URL?: string; VITE_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; EIFF_INBOX_ORGANIZATION_ID?: string }
export const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';

export interface ConfigPortaIngest { url: string; organizacaoId: string }
/** Le a configuracao do ambiente. Sem chave de servico ou sem organizacao, a ingestao e pulada (o webhook segue respondendo). */
export function configPortaIngest(env: AmbienteIngest): (ConfigPortaIngest & { chave: string }) | { motivo: string } {
  const chave = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const organizacaoId = (env.EIFF_INBOX_ORGANIZATION_ID ?? '').trim();
  if (!chave) return { motivo: 'sem SUPABASE_SERVICE_ROLE_KEY' };
  if (!organizacaoId) return { motivo: 'sem EIFF_INBOX_ORGANIZATION_ID' };
  return { url: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO).replace(/\/$/, ''), organizacaoId, chave };
}

/**
 * Argumentos da RPC inbox_ingest. Exportado de proposito: a porta de producao e a prova em PostgreSQL
 * (scripts/pg-smoke-*.mts) chamam a MESMA montagem, entao a prova confere os argumentos que a producao manda —
 * e um nome de parametro trocado nao passa por um dos dois caminhos em silencio.
 */
export const argsIngest = (p: PedidoIngest): Record<string, unknown> => ({
  p_organization_id: p.organizationId, p_provider: p.provider, p_channel: p.canal, p_context: p.contexto, p_identifier: p.identificador, p_display_name: p.nomeInformado ?? null,
  p_external_message_id: p.externalMessageId, p_external_conversation_id: p.externalConversationId ?? null, p_body: p.texto, p_content_type: p.tipo, p_occurred_at: p.em,
  p_reply_to_external_id: p.replyToExternalId ?? null, p_central_conversation_id: p.conversaCentralId ?? null, p_central_message_id: p.mensagemCentralId ?? null,
  p_attachments: p.anexos ?? [], p_meta: p.meta ?? {},
});

/** Le o resultado da RPC no formato do Inbox. Compartilhado com a prova em PostgreSQL. */
export const resultadoIngest = (d: Record<string, unknown>): ResultadoIngest => ({
  ok: d.ok === true, duplicada: d.duplicada === true, threadId: typeof d.thread_id === 'string' ? d.thread_id : undefined, messageId: typeof d.message_id === 'string' ? d.message_id : undefined,
  contactId: typeof d.contact_id === 'string' ? d.contact_id : undefined, novaThread: d.nova_thread === true, novoContato: d.novo_contato === true, reaberta: d.reaberta === true,
  // o texto devolvido pela RPC nunca segue adiante: so um codigo do catalogo fechado, ou o marcador fixo
  erro: typeof d.erro === 'string' ? recusaDoIngest(d.erro) : undefined,
});

/** Porta da RPC inbox_ingest. Idempotente por (provider, external_message_id): a garantia esta no banco. */
export function portaIngestRpc(cfg: { url: string; chave: string }, fetchFn: typeof fetch): (p: PedidoIngest) => Promise<ResultadoIngest> {
  return async (p) => {
    const r = await fetchFn(`${cfg.url}/rest/v1/rpc/inbox_ingest`, {
      method: 'POST',
      headers: { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, 'content-type': 'application/json' },
      body: JSON.stringify(argsIngest(p)),
    });
    // o erro carrega SO o status: nunca o corpo da resposta (poderia ecoar dados) nem a chave
    if (!r.ok) throw new Error(`rpc inbox_ingest http ${r.status}`);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return resultadoIngest(d);
  };
}

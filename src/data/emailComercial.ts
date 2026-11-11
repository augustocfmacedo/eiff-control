// Cliente de /api/email-comercial (navegador). Manda só intenção: conversa, assunto, corpo e a chave da intenção.
// Destinatário, remetente, papel e organização são decididos no servidor. O `destinatario` do envio NÃO escolhe o
// destino: é o endereço que o servidor mostrou e a pessoa conferiu; se não for o do banco, o servidor recusa.
// Nunca importa o módulo de portas do servidor: um teste de fronteira prende isso.
import type { PedidoDeReconciliacao } from '../core/inbox/emailTela';
import { tokenSessao } from './supabase';

export type PedidoEmailComercial =
  | { acao: 'preparar'; threadId: string }
  | { acao: 'enviar'; threadId: string; assunto: string; corpo: string; intencao: string; destinatario: string }
  | PedidoDeReconciliacao;

/** Chave pública (anônima) do Supabase do app, posta por src/data/ambiente.ts. Não é segredo. */
const chaveAnonima = (): string => (globalThis as { __EIFF_SUPABASE__?: { chave?: string } }).__EIFF_SUPABASE__?.chave ?? '';

export interface RespostaEmailComercial { status: number; corpo: unknown }

/** Nunca lança: falha de rede ou de sessão vira uma resposta que a tela trata como «não enviado» ou «indisponível». */
export async function chamarEmailComercial(pedido: PedidoEmailComercial, fetchFn: typeof fetch = fetch): Promise<RespostaEmailComercial> {
  try {
    const token = await tokenSessao();
    if (!token) return { status: 401, corpo: { erro: 'nao_autenticado' } };
    const r = await fetchFn('/api/email-comercial', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': chaveAnonima(), authorization: `Bearer ${token}` }, body: JSON.stringify(pedido) });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  } catch {
    // sem resposta do NOSSO servidor: não se sabe se o pedido chegou. A tela não oferece reenvio cego — ver EnvioEmail.
    return { status: 0, corpo: { erro: 'sem_resposta' } };
  }
}

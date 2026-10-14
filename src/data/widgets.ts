// Widgets do iPad no app: lista os aparelhos do usuário, cria e revoga tokens. Tudo pelas RPCs da 0069 com a sessão do
// próprio usuário (o banco decide quem pode e audita na mesma transação); o cliente nunca lê o hash do token e o token em
// claro só existe na resposta de widget_token_criar, mostrado uma vez na tela. Nada disso passa pelo Dataset.
import { supabase } from './supabase';

export interface AparelhoWidget {
  id: string; nome: string; final: string;
  criadoEm: string; expiraEm: string; usadoEm: string | null;
  revogadoEm: string | null; motivoRevogacao: string | null;
}
export interface TokenNovo { id: string; token: string; final: string; expiraEm: string; nome: string }

/** Banco ainda sem a 0069 (ou modo local): a tela mostra "indisponível", nunca uma lista vazia como se não houvesse nada. */
export class WidgetsIndisponiveis extends Error {}
const indisponivel = (msg: string) => /widget_token|does not exist|schema cache|PGRST20[25]/i.test(msg);
const limpar = (msg: string) => msg.replace(/^widget:\s*/i, '');

export async function listarAparelhos(): Promise<AparelhoWidget[]> {
  if (!supabase) throw new WidgetsIndisponiveis('Widgets só funcionam conectado ao banco.');
  const { data, error } = await supabase.from('widget_token').select('id,name,token_hint,created_at,expires_at,last_used_at,revoked_at,revoke_reason').order('created_at', { ascending: false });
  if (error) throw indisponivel(`${error.code ?? ''} ${error.message}`) ? new WidgetsIndisponiveis('Widgets ainda não estão disponíveis neste banco.') : new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string, nome: r.name as string, final: r.token_hint as string,
    criadoEm: r.created_at as string, expiraEm: r.expires_at as string, usadoEm: (r.last_used_at as string | null) ?? null,
    revogadoEm: (r.revoked_at as string | null) ?? null, motivoRevogacao: (r.revoke_reason as string | null) ?? null,
  }));
}

export async function criarAparelho(nome: string, dias: number): Promise<TokenNovo> {
  if (!supabase) throw new WidgetsIndisponiveis('Widgets só funcionam conectado ao banco.');
  const { data, error } = await supabase.rpc('widget_token_criar', { p_nome: nome, p_dias: dias });
  if (error) throw new Error(limpar(error.message));
  const r = data as { id: string; token: string; final: string; expira_em: string; nome: string };
  return { id: r.id, token: r.token, final: r.final, expiraEm: r.expira_em, nome: r.nome };
}

export async function revogarAparelho(id: string, motivo: string): Promise<void> {
  if (!supabase) throw new WidgetsIndisponiveis('Widgets só funcionam conectado ao banco.');
  const { error } = await supabase.rpc('widget_token_revogar', { p_id: id, p_motivo: motivo });
  if (error) throw new Error(limpar(error.message));
}

/** Situação do aparelho para a lista (a validade é conferida de novo no servidor a cada uso). */
export function situacaoAparelho(a: AparelhoWidget, agora = new Date()): 'ativo' | 'revogado' | 'vencido' {
  if (a.revogadoEm) return 'revogado';
  return Date.parse(a.expiraEm) <= agora.getTime() ? 'vencido' : 'ativo';
}

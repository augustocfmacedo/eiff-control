// Widgets do iPad: handler PURO de /api/widget-caixa (rede e banco injetados; testado sem Supabase). O widget manda só o
// token do aparelho (Authorization: Bearer eiffw_…). Ordem: formato → widget_token_validar (RPC server-only da 0069, com a
// chave de serviço) → perfil ainda vê o caixa (MATRIZ: ver_bancos) → carga do dataset → resumoWidgetCaixa. Só GET, nada é
// gravado (fora o "último uso" que a própria RPC marca) e o token nunca aparece em resposta ou log.
import type { Dataset, Usuario } from './types';
import { pode } from './permissoes';
import { resumoWidgetCaixa, type ResumoWidgetCaixa } from './widgetCaixa';
import { resumoWidgetPedidos, type ResumoWidgetPedidos } from './widgetPedidos';
import { resumoWidgetPagamentos, type ResumoWidgetPagamentos } from './widgetPagamentos';

export const FORMATO_TOKEN_WIDGET = /^eiffw_[0-9a-f]{64}$/;
/** visões do widget: o caixa (padrão), os pagamentos do dia e os pedidos da equipe ao Diretor Financeiro (exige também aprovar, como a Central) */
export type VisaoWidget = 'caixa' | 'pedidos' | 'pagamentos';
export const VISOES_WIDGET: readonly VisaoWidget[] = ['caixa', 'pedidos', 'pagamentos'];
export type ErroWidget = 'visao_invalida' | 'metodo' | 'token_ausente' | 'token_invalido' | 'token_revogado' | 'token_expirado' | 'perfil_inativo' | 'sem_permissao' | 'nao_configurado' | 'indisponivel';
export type ValidacaoTokenWidget = { ok: true; perfilId: string; tokenId: string; nome: string } | { ok: false; erro: string };
export interface PortasWidget {
  validar(token: string): Promise<ValidacaoTokenWidget>;
  carregar(perfilId: string): Promise<{ ds: Dataset; usuario: Usuario }>;
  agora(): Date;
  /** diagnóstico: etapa e primeira linha do erro (o servidor sanitiza antes de registrar; nunca vai ao cliente) */
  registrar?(etapa: 'validar' | 'carregar' | 'resumo', erro: unknown): void;
}

/** Primeira linha do erro, sem token, sem cabeçalho de autorização, no máximo 200 caracteres — para o log do servidor. */
export function erroParaLog(erro: unknown): string {
  const texto = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
  return texto.split('\n')[0].replace(/eiffw_[0-9a-f]+/gi, 'eiffw_***').replace(/bearer\s+\S+/gi, 'Bearer ***').slice(0, 200);
}
export interface RespostaWidget { status: number; corpo: ResumoWidgetCaixa | ResumoWidgetPedidos | ResumoWidgetPagamentos | { erro: ErroWidget; mensagem: string } }

export const MENSAGENS_WIDGET: Record<ErroWidget, string> = {
  visao_invalida: 'Visão desconhecida: use caixa, pagamentos ou pedidos no parâmetro do widget.',
  metodo: 'Use GET.',
  token_ausente: 'Widget sem token. Gere um em EIFF Control › Caixa › Widgets do iPad.',
  token_invalido: 'Token não reconhecido. Gere um novo em Caixa › Widgets do iPad.',
  token_revogado: 'Este aparelho foi revogado. Gere um novo token em Caixa › Widgets do iPad.',
  token_expirado: 'O token deste aparelho venceu. Gere um novo em Caixa › Widgets do iPad.',
  perfil_inativo: 'Seu acesso ao EIFF Control está desativado.',
  sem_permissao: 'Seu papel não vê o caixa.',
  nao_configurado: 'Widget ainda não configurado no servidor.',
  indisponivel: 'Não foi possível montar o resumo agora. Tente de novo em instantes.',
};
const ERROS_DA_RPC: Partial<Record<string, ErroWidget>> = { token_invalido: 'token_invalido', token_revogado: 'token_revogado', token_expirado: 'token_expirado', perfil_inativo: 'perfil_inativo', sem_permissao: 'sem_permissao' };
const STATUS: Record<ErroWidget, number> = { visao_invalida: 400, metodo: 405, token_ausente: 401, token_invalido: 401, token_revogado: 401, token_expirado: 401, perfil_inativo: 403, sem_permissao: 403, nao_configurado: 501, indisponivel: 503 };
const falha = (erro: ErroWidget): RespostaWidget => ({ status: STATUS[erro], corpo: { erro, mensagem: MENSAGENS_WIDGET[erro] } });

/** Data de hoje no fuso da empresa (o servidor roda em UTC). */
export const hojeEmSaoPaulo = (agora: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);

export async function tratarWidgetCaixa(req: { metodo: string; autorizacao: string | null; visao?: string | null }, portas: PortasWidget): Promise<RespostaWidget> {
  if (req.metodo !== 'GET') return falha('metodo');
  const visao = (req.visao ?? 'caixa') || 'caixa';
  if (!(VISOES_WIDGET as readonly string[]).includes(visao)) return falha('visao_invalida');
  const token = (req.autorizacao ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return falha('token_ausente');
  if (!FORMATO_TOKEN_WIDGET.test(token)) return falha('token_invalido');
  let v: ValidacaoTokenWidget;
  try { v = await portas.validar(token); } catch (e) { portas.registrar?.('validar', e); return falha('indisponivel'); }
  if (!v.ok) {
    const erro = ERROS_DA_RPC[v.erro];
    if (!erro) portas.registrar?.('validar', new Error(`resposta inesperada da validação: ${v.erro}`));
    return falha(erro ?? 'indisponivel'); // somente_servidor ou outro inesperado: configuração errada, nunca detalhe ao cliente
  }
  let carga: { ds: Dataset; usuario: Usuario };
  try { carga = await portas.carregar(v.perfilId); } catch (e) { portas.registrar?.('carregar', e); return falha('indisponivel'); }
  try {
    const { ds, usuario } = carga;
    // segunda barreira, no app: a MATRIZ é a fonte do "quem vê o caixa" (a RPC espelha com o papel Administrador)
    if (!usuario.ativo || !pode(usuario, 'ver_bancos')) return falha('sem_permissao');
    if (visao === 'pedidos' && !pode(usuario, 'aprovar')) return falha('sem_permissao');
    const agora = portas.agora();
    const dsHoje: Dataset = { ...ds, params: { ...ds.params, dataBase: ds.params.dataBaseAutomatica === false ? ds.params.dataBase : hojeEmSaoPaulo(agora) } };
    return { status: 200, corpo: visao === 'pedidos' ? resumoWidgetPedidos(dsHoje, agora) : visao === 'pagamentos' ? resumoWidgetPagamentos(dsHoje, agora) : resumoWidgetCaixa(dsHoje, agora) };
  } catch (e) {
    portas.registrar?.('resumo', e);
    return falha('indisponivel');
  }
}

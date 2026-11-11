/**
 * E-mail comercial — as REGRAS do envio (docs/email-comercial.md §5, §6 e §10).
 *
 * Puro: modo de envio, lista do canário, tetos, máquina de estados da entrega, catálogo fechado de erros e a
 * leitura das respostas do Google. Nenhuma chamada de rede aqui; quem chama o Google é a porta (etapa E3).
 *
 * Três ideias que organizam o arquivo:
 *   1. DESLIGADO é o padrão. Variável ausente, vazia ou desconhecida é `disabled`.
 *   2. Falha ao obter o TOKEN é sempre «nada saiu». Falha no ENVIO sem resposta clara é «não sabemos» (UNKNOWN),
 *      e UNKNOWN nunca é reenviado sozinho.
 *   3. O texto que o Google devolve nunca é repassado nem gravado: vira um código deste catálogo.
 */
import { emailValido } from './emailMensagem'

/* ---------------------------------------------------------------
   1 · Modo, canário e tetos
--------------------------------------------------------------- */

export const MODOS_EMAIL = ['disabled', 'canary', 'ativo'] as const
export type ModoEmail = (typeof MODOS_EMAIL)[number]

/** Qualquer coisa que não seja exatamente `canary` ou `ativo` é `disabled`. */
export function lerModoEmail(v: string | undefined): ModoEmail {
  const s = (v ?? '').trim().toLowerCase()
  return s === 'canary' || s === 'ativo' ? s : 'disabled'
}

/** Destinatários do canário: separados por vírgula, ponto e vírgula ou espaço; só endereços válidos, em minúsculas. */
export function lerListaCanario(v: string | undefined): string[] {
  return [...new Set((v ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => emailValido(x)))]
}

export const LIMITE_USUARIO_PADRAO = 30
export const LIMITE_ORGANIZACAO_PADRAO = 100
/** Teto diário: inteiro positivo; qualquer outra coisa cai no padrão (nunca em «sem limite»). */
export function lerLimite(v: string | undefined, padrao: number): number {
  const n = Number((v ?? '').trim())
  return Number.isInteger(n) && n > 0 && n <= 2000 ? n : padrao
}

export type RecusaDeDestino = 'envio_desligado' | 'destino_nao_autorizado'
/**
 * O destino pode receber neste modo? Conferido no handler E, de novo, na porta que chama o Google: nenhum caminho
 * do servidor chega ao envio sem passar por aqui.
 */
export function autorizarDestino(modo: ModoEmail, canario: readonly string[], destino: string): { ok: true } | { ok: false; erro: RecusaDeDestino } {
  if (modo === 'disabled') return { ok: false, erro: 'envio_desligado' }
  if (modo === 'canary' && !canario.includes(destino.trim().toLowerCase())) return { ok: false, erro: 'destino_nao_autorizado' }
  return { ok: true }
}

/* ---------------------------------------------------------------
   2 · A entrega: estados e transições (espelhadas no banco)
--------------------------------------------------------------- */

export const ESTADOS_ENTREGA_EMAIL = ['READY', 'REQUESTED', 'ACCEPTED', 'FAILED', 'UNKNOWN'] as const
export type EstadoEntregaEmail = (typeof ESTADOS_ENTREGA_EMAIL)[number]

/** ACCEPTED e FAILED são terminais: nunca regridem. UNKNOWN só sai por reconciliação. */
export const TRANSICOES_ENTREGA_EMAIL: Record<EstadoEntregaEmail, readonly EstadoEntregaEmail[]> = {
  READY: ['REQUESTED', 'FAILED'],
  REQUESTED: ['ACCEPTED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['ACCEPTED', 'FAILED'],
  ACCEPTED: [],
  FAILED: [],
}
export const transicaoDeEntregaPermitida = (de: EstadoEntregaEmail, para: EstadoEntregaEmail): boolean => TRANSICOES_ENTREGA_EMAIL[de].includes(para)
/** Entrega sem desfecho: bloqueia novo envio na mesma conversa. */
export const entregaPendente = (e: EstadoEntregaEmail): boolean => e === 'READY' || e === 'REQUESTED' || e === 'UNKNOWN'
/** Só o aceite confirmado cumpre o SLA de primeira resposta. */
export const cumpreSla = (e: EstadoEntregaEmail): boolean => e === 'ACCEPTED'

/* ---------------------------------------------------------------
   3 · Catálogo fechado de erros
--------------------------------------------------------------- */

export const ERROS_EMAIL = {
  pedido_invalido: { http: 400, mensagem: 'Pedido inválido.' },
  nao_autenticado: { http: 401, mensagem: 'Sessão expirada. Entre de novo.' },
  sem_permissao: { http: 403, mensagem: 'Seu perfil não pode enviar e-mail em nome da EIFF.' },
  envio_desligado: { http: 403, mensagem: 'O envio de e-mail está desligado.' },
  destino_nao_autorizado: { http: 403, mensagem: 'Em modo de teste, este destinatário não está na lista autorizada.' },
  conversa_nao_encontrada: { http: 404, mensagem: 'Conversa não encontrada.' },
  entrega_nao_encontrada: { http: 404, mensagem: 'Envio não encontrado.' },
  conversa_fechada: { http: 409, mensagem: 'Conversa fechada: reabra antes de enviar.' },
  conversa_interna: { http: 409, mensagem: 'E-mail comercial só vale para conversas externas.' },
  intencao_reutilizada: { http: 409, mensagem: 'Este envio já foi pedido com outro conteúdo. Revise e confirme de novo.' },
  entrega_pendente: { http: 409, mensagem: 'Há um envio sem desfecho nesta conversa. Resolva-o antes de enviar outro.' },
  reconciliacao_indevida: { http: 409, mensagem: 'Este envio não está aguardando conferência.' },
  sem_email_valido: { http: 422, mensagem: 'O contato não tem e-mail válido.' },
  limite_usuario: { http: 429, mensagem: 'Você atingiu o limite diário de envios.' },
  limite_organizacao: { http: 429, mensagem: 'A EIFF atingiu o limite diário de envios.' },
  provedor_recusou: { http: 502, mensagem: 'O Google recusou a mensagem. Nada foi enviado.' },
  limite_do_provedor: { http: 502, mensagem: 'O Google limitou o envio desta caixa. Nada foi enviado.' },
  credencial_indisponivel: { http: 503, mensagem: 'A credencial de envio não está disponível. Nada foi enviado.' },
  provedor_indisponivel: { http: 503, mensagem: 'O Google não respondeu antes do envio. Nada foi enviado; tente de novo.' },
  livro_indisponivel: { http: 503, mensagem: 'Não foi possível registrar o envio. Nada foi enviado.' },
  remetente_nao_configurado: { http: 503, mensagem: 'O remetente não está configurado. Nada foi enviado.' },
} as const
export type CodigoErroEmail = keyof typeof ERROS_EMAIL

/** Motivos gravados no livro quando a entrega termina em FAILED ou UNKNOWN. */
export const MOTIVOS_ENTREGA = [
  'credencial_revogada', 'credencial_invalida', 'provedor_indisponivel', 'mensagem_recusada', 'acesso_recusado', 'limite_do_provedor',
  'resultado_desconhecido', 'registro_falhou', 'mensagem_invalida', 'declarado_nao_enviado', 'declarado_encontrado',
] as const
export type MotivoEntrega = (typeof MOTIVOS_ENTREGA)[number]

/* ---------------------------------------------------------------
   4 · Leitura das respostas do Google
--------------------------------------------------------------- */

/** O que a porta devolve: uma resposta HTTP já lida, ou a razão de não haver resposta. Nunca lança. */
export type RespostaGoogle =
  | { tipo: 'http'; status: number; corpo: unknown }
  | { tipo: 'rede' }
  | { tipo: 'tempo' }

const campo = (corpo: unknown, nome: string): string | undefined => {
  if (!corpo || typeof corpo !== 'object') return undefined
  const v = (corpo as Record<string, unknown>)[nome]
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

export type LeituraDoToken = { ok: true; accessToken: string } | { ok: false; motivo: Extract<MotivoEntrega, 'credencial_revogada' | 'credencial_invalida' | 'provedor_indisponivel'> }

/** Troca do token de atualização pelo de acesso. Qualquer falha aqui é «nada saiu». */
export function lerRespostaDoToken(r: RespostaGoogle): LeituraDoToken {
  if (r.tipo !== 'http') return { ok: false, motivo: 'provedor_indisponivel' }
  if (r.status >= 200 && r.status < 300) {
    const t = campo(r.corpo, 'access_token')
    return t ? { ok: true, accessToken: t } : { ok: false, motivo: 'provedor_indisponivel' }
  }
  if (r.status >= 500 || r.status === 429) return { ok: false, motivo: 'provedor_indisponivel' }
  return { ok: false, motivo: campo(r.corpo, 'error') === 'invalid_grant' ? 'credencial_revogada' : 'credencial_invalida' }
}

export type LeituraDoEnvio =
  | { desfecho: 'ACCEPTED'; providerMessageId: string; providerThreadId?: string }
  | { desfecho: 'FAILED'; motivo: Extract<MotivoEntrega, 'mensagem_recusada' | 'acesso_recusado' | 'limite_do_provedor' | 'credencial_invalida'> }
  | { desfecho: 'UNKNOWN'; motivo: 'resultado_desconhecido' }

/**
 * `users.messages.send`. Só é ACCEPTED com 2xx E `id`. Só é FAILED com recusa explícita e definitiva (4xx).
 * Todo o resto — tempo esgotado, rede, 5xx, 2xx sem id — é UNKNOWN: o Google pode ter aceitado.
 */
export function lerRespostaDoEnvio(r: RespostaGoogle): LeituraDoEnvio {
  if (r.tipo !== 'http') return { desfecho: 'UNKNOWN', motivo: 'resultado_desconhecido' }
  if (r.status >= 200 && r.status < 300) {
    const id = campo(r.corpo, 'id')
    if (!id) return { desfecho: 'UNKNOWN', motivo: 'resultado_desconhecido' }
    const threadId = campo(r.corpo, 'threadId')
    return { desfecho: 'ACCEPTED', providerMessageId: id, ...(threadId ? { providerThreadId: threadId } : {}) }
  }
  if (r.status === 401) return { desfecho: 'FAILED', motivo: 'credencial_invalida' }
  if (r.status === 429) return { desfecho: 'FAILED', motivo: 'limite_do_provedor' }
  if (r.status === 403) return { desfecho: 'FAILED', motivo: /limit|quota|rate/i.test(JSON.stringify(r.corpo ?? '')) ? 'limite_do_provedor' : 'acesso_recusado' }
  if (r.status >= 400 && r.status < 500) return { desfecho: 'FAILED', motivo: 'mensagem_recusada' }
  return { desfecho: 'UNKNOWN', motivo: 'resultado_desconhecido' }
}

/** Do motivo gravado no livro ao erro que a tela recebe. */
export const erroDoMotivo: Record<Exclude<MotivoEntrega, 'resultado_desconhecido' | 'registro_falhou' | 'declarado_nao_enviado' | 'declarado_encontrado'>, CodigoErroEmail> = {
  credencial_revogada: 'credencial_indisponivel',
  credencial_invalida: 'credencial_indisponivel',
  provedor_indisponivel: 'provedor_indisponivel',
  mensagem_recusada: 'provedor_recusou',
  acesso_recusado: 'provedor_recusou',
  limite_do_provedor: 'limite_do_provedor',
  mensagem_invalida: 'pedido_invalido',
}

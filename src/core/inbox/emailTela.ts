/**
 * E-mail comercial — o que a TELA mostra (etapa E4). Puro: a tela só projeta.
 *
 * Três leituras, todas a partir do que já está gravado ou do que o servidor respondeu:
 *   1. a mensagem de e-mail na conversa (`situacaoDoEmail`): rascunho preparado, enviada, falhou ou sem confirmação —
 *      a diferença entre rascunho, tentativa e mensagem EFETIVAMENTE enviada nunca se perde;
 *   2. a entrega sem desfecho da conversa (`entregaSemDesfecho`), que bloqueia novo envio e pede conferência humana;
 *   3. a resposta de `/api/email-comercial` (`lerRespostaDoEnvio`), traduzida para um aviso em linguagem de gente.
 *
 * Nada aqui decide se um e-mail pode ser enviado: quem decide é o servidor.
 */
import { CONFIRMACAO_NAO_ENVIADO, ERROS_EMAIL, type CodigoErroEmail } from './emailEnvio'
import type { InboxMessage } from './tipos'

export const PROVIDER_EMAIL = 'GOOGLE_WORKSPACE'

export type SituacaoDoEmail = 'preparado' | 'enviando' | 'enviado' | 'falhou' | 'sem_confirmacao'
export const NOME_SITUACAO_EMAIL: Record<SituacaoDoEmail, string> = {
  preparado: 'E-mail preparado (não enviado)',
  enviando: 'E-mail em envio',
  enviado: 'E-mail enviado',
  falhou: 'E-mail NÃO enviado',
  sem_confirmacao: 'E-mail sem confirmação de envio',
}

/** A mensagem é do e-mail comercial? (provider do envio, nunca o texto) */
export const ehMensagemDeEmail = (m: Pick<InboxMessage, 'provider' | 'direcao'>): boolean => m.provider === PROVIDER_EMAIL && m.direcao === 'outbound'

/**
 * Em que pé está o e-mail desta mensagem. `enviado` só quando a entrega da mensagem é `enviada` (o banco só grava isso
 * no aceite confirmado); `sem_confirmacao` é o resultado desconhecido — não é enviado e não é falha.
 */
export function situacaoDoEmail(m: Pick<InboxMessage, 'provider' | 'direcao' | 'entrega' | 'meta'>): SituacaoDoEmail | undefined {
  if (!ehMensagemDeEmail(m)) return undefined
  if (m.entrega === 'enviada' || m.entrega === 'entregue' || m.entrega === 'lida') return 'enviado'
  if (m.entrega === 'falhou') return 'falhou'
  const estado = m.meta?.['entregaEstado']
  if (estado === 'UNKNOWN') return 'sem_confirmacao'
  if (estado === 'REQUESTED') return 'enviando'
  return 'preparado'
}

export interface EntregaSemDesfecho { entregaId: string; mensagemId: string; situacao: Extract<SituacaoDoEmail, 'preparado' | 'enviando' | 'sem_confirmacao'>; em: string }

/** A entrega que ainda não terminou nesta conversa (no máximo uma: o banco garante). */
export function entregaSemDesfecho(mensagens: readonly InboxMessage[], threadId: string): EntregaSemDesfecho | undefined {
  for (const m of mensagens) {
    if (m.threadId !== threadId) continue
    const s = situacaoDoEmail(m)
    const entregaId = m.meta?.['entregaId']
    if ((s === 'preparado' || s === 'enviando' || s === 'sem_confirmacao') && typeof entregaId === 'string') return { entregaId, mensagemId: m.id, situacao: s, em: m.em }
  }
  return undefined
}

/* ---------------------------------------------------------------
   A resposta do servidor
--------------------------------------------------------------- */

export interface DisponibilidadeDoEnvio { disponivel: boolean; modo?: string; remetente?: string; destinatario?: string; motivo?: string; mensagem?: string }

/** Lê a resposta de `preparar`. Qualquer coisa fora do esperado é «indisponível»: a tela nunca presume que pode enviar. */
export function lerDisponibilidade(status: number, corpo: unknown): DisponibilidadeDoEnvio {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const texto = (k: string) => (typeof c[k] === 'string' && c[k] !== '' ? (c[k] as string) : undefined)
  if (status !== 200) return { disponivel: false, motivo: texto('erro') ?? 'indisponivel', mensagem: texto('mensagem') ?? 'O envio de e-mail não está disponível agora.' }
  return {
    disponivel: c['disponivel'] === true && texto('remetente') !== undefined && texto('destinatario') !== undefined,
    ...(texto('modo') ? { modo: texto('modo') } : {}), ...(texto('remetente') ? { remetente: texto('remetente') } : {}), ...(texto('destinatario') ? { destinatario: texto('destinatario') } : {}),
    ...(texto('motivo') ? { motivo: texto('motivo') } : {}), ...(texto('mensagem') ? { mensagem: texto('mensagem') } : {}),
  }
}

export type DesfechoNaTela = 'enviado' | 'nao_enviado' | 'desconhecido' | 'em_andamento'
export interface AvisoDoEnvio { desfecho: DesfechoNaTela; titulo: string; texto: string; entregaId?: string; cumpriuPrimeiraResposta?: boolean; recarregar: boolean }

const hora = (iso: unknown): string => {
  const d = typeof iso === 'string' ? new Date(iso) : undefined
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Traduz a resposta de `enviar` ou `reconciliar`. O texto vem do catálogo fechado: nada que o servidor (ou o Google)
 * escreveu fora do catálogo é mostrado.
 */
export function lerRespostaDoEnvio(status: number, corpo: unknown): AvisoDoEnvio {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const entregaId = typeof c['entregaId'] === 'string' ? c['entregaId'] : undefined
  const comId = entregaId ? { entregaId } : {}
  const estado = c['estado']
  if (status === 200 && estado === 'ACCEPTED') {
    const reconciliada = c['reconciliada'] === true
    const cumpriu = c['cumpriuPrimeiraResposta'] === true
    const quando = hora(c['enviadaEm'])
    return {
      desfecho: 'enviado', ...comId, cumpriuPrimeiraResposta: cumpriu, recarregar: true,
      titulo: `E-mail enviado${quando ? ` às ${quando}` : ''}`,
      texto: `${reconciliada ? 'Envio conferido por você na pasta Enviados.' : 'O Google confirmou o aceite.'}${cumpriu ? ' Conta como a primeira resposta desta conversa.' : ''}`,
    }
  }
  if (status === 200 && estado === 'UNKNOWN') {
    return { desfecho: 'desconhecido', ...comId, recarregar: true, titulo: 'Não sabemos se este e-mail saiu', texto: 'Não envie de novo. Confira a pasta Enviados da caixa remetente e diga abaixo o que encontrou.' }
  }
  if (status === 200 && estado === 'EM_ANDAMENTO') {
    return { desfecho: 'em_andamento', ...comId, recarregar: true, titulo: 'Este envio já foi pedido', texto: 'Aguarde um instante e atualize. Não envie de novo.' }
  }
  if (status === 200 && estado === 'FAILED' && c['reconciliada'] === true) {
    return { desfecho: 'nao_enviado', ...comId, recarregar: true, titulo: 'Registrado como não enviado', texto: 'Você pode revisar o texto e enviar de novo.' }
  }
  const codigo = c['erro']
  const conhecido = typeof codigo === 'string' && codigo in ERROS_EMAIL ? (codigo as CodigoErroEmail) : undefined
  // conteúdo inválido: o servidor devolve a recusa específica (texto do nosso catálogo de validação)
  const texto = conhecido === 'pedido_invalido' && typeof c['mensagem'] === 'string' ? c['mensagem'] : conhecido ? ERROS_EMAIL[conhecido].mensagem : 'Não foi possível concluir o envio. Nada foi enviado.'
  return { desfecho: 'nao_enviado', ...comId, recarregar: estado === 'FAILED', titulo: 'E-mail não enviado', texto }
}

/** Chave do conteúdo, para a tela saber se ainda é o MESMO pedido (mesma intenção) ou outro (intenção nova). */
export const chaveDoConteudo = (threadId: string, assunto: string, corpo: string): string => JSON.stringify([threadId, assunto.trim(), corpo.replace(/\r\n?/g, '\n').trim()])

/**
 * O pedido de reconciliação que a tela pode mandar. «Não foi enviado» libera novo envio na conversa — se a declaração
 * estiver errada, o cliente recebe o e-mail em dobro —, então só existe pedido depois de a pessoa marcar que conferiu
 * a pasta Enviados. Sem isso, não há pedido (e o servidor também recusaria: a confirmação é exigida lá).
 */
export type PedidoDeReconciliacao =
  | { acao: 'reconciliar'; entregaId: string; desfecho: 'encontrado' }
  | { acao: 'reconciliar'; entregaId: string; desfecho: 'nao_enviado'; confirmacao: typeof CONFIRMACAO_NAO_ENVIADO }
export function pedidoDeReconciliacao(entregaId: string, desfecho: 'encontrado' | 'nao_enviado', conferiuEnviados: boolean): PedidoDeReconciliacao | undefined {
  if (desfecho === 'encontrado') return { acao: 'reconciliar', entregaId, desfecho }
  return conferiuEnviados ? { acao: 'reconciliar', entregaId, desfecho, confirmacao: CONFIRMACAO_NAO_ENVIADO } : undefined
}

/** O servidor recusou porque o endereço da conversa não é (mais) o que a pessoa conferiu: a tela busca o atual. */
export function pedeNovaConferenciaDoDestino(corpo: unknown): boolean {
  const erro = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>)['erro'] : undefined
  return erro === 'destinatario_mudou' || erro === 'destinatario_ambiguo'
}

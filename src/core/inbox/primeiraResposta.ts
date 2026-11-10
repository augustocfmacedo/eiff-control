/**
 * Primeira resposta: o que cumpre o SLA, e o que só parece cumprir.
 *
 * ── A REGRA ──────────────────────────────────────────────────────────────
 *
 * O SLA de primeira resposta só é cumprido por CONTATO EFETIVAMENTE REALIZADO
 * com o interessado. Hoje isso tem duas origens possíveis:
 *
 *   1. uma pessoa DECLARA o contato («falei com ela por telefone às 10:40») —
 *      `registrarContatoRealizado`, explícito e auditável;
 *   2. um canal ENVIA de fato a resposta (entrega enviada/entregue/lida). Não
 *      existe canal de saída ligado nesta fase, mas a regra já vale para ele.
 *
 * NÃO cumprem: rascunho (entrega `registrada`: nada saiu), nota interna,
 * assumir ou reatribuir, tentativa sem sucesso, resolver ou fechar sem
 * resposta, e qualquer coisa do Radar.
 *
 * ── ONDE FICA GRAVADO (sem migration) ────────────────────────────────────
 *
 * Tudo cabe na mensagem do Inbox, com o sentido que cada coluna já tinha:
 *
 *   quem declarou          autor (sender_kind `usuario`, sender_id, sender_name)
 *   quando foi o contato   `em` (occurred_at) — o instante DECLARADO
 *   quando foi registrado  `registradaEm` (received_at) — relógio do BANCO, não do navegador
 *   resumo                 texto (body), imutável por trigger
 *   conversa               thread_id
 *   meio e natureza        `meta.contato` e `meta.contatoMeio`
 *
 * e o primeiro contato fica na conversa, em `sla.primeiraRespostaEm`
 * (sla_first_response_at). O histórico da conversa ganha um evento
 * `MESSAGE_REGISTERED` e o `audit_log` uma entrada sem conteúdo.
 *
 * Limites declarados: o catálogo de meios é conferido aqui e no store, não
 * por CHECK no banco; e o autor é gravado pela aplicação (como em toda
 * mensagem e evento do Inbox), não imposto pelo banco como `auth.uid()`.
 */
import { ehAberta } from './estados'
import type { InboxMessage, InboxThread, MetaMensagem } from './tipos'

/** Meios pelos quais uma pessoa da EIFF fala com o interessado fora de um canal ligado. */
export const MEIOS_CONTATO = ['telefone', 'email', 'whatsapp_externo', 'presencial'] as const
export type MeioContato = (typeof MEIOS_CONTATO)[number]
export const NOME_MEIO: Record<MeioContato, string> = {
  telefone: 'telefone', email: 'e-mail', whatsapp_externo: 'WhatsApp externo', presencial: 'presencial',
}

/** `realizado` cumpre o SLA; `tentativa` (ligou e ninguém atendeu, e-mail voltou) não cumpre. */
export const RESULTADOS_CONTATO = ['realizado', 'tentativa'] as const
export type ResultadoContato = (typeof RESULTADOS_CONTATO)[number]

export const RESUMO_MINIMO = 10
/** Folga para o relógio do navegador estar adiantado em relação ao do servidor. */
export const TOLERANCIA_RELOGIO_MS = 2 * 60_000

export interface PedidoDeContato {
  resultado: ResultadoContato
  meio: MeioContato
  /** Instante DECLARADO do contato (ISO). */
  em: string
  resumo: string
}

/** Recusas, em texto que a tela mostra como está. Lista vazia = pode registrar. */
export function validarContato(p: PedidoDeContato, t: Pick<InboxThread, 'status' | 'abertaEm'>, agoraIso: string): string[] {
  const erros: string[] = []
  if (!(RESULTADOS_CONTATO as readonly string[]).includes(p.resultado)) erros.push('Diga se o contato foi realizado ou se foi só uma tentativa.')
  if (!(MEIOS_CONTATO as readonly string[]).includes(p.meio)) erros.push('Escolha o meio do contato: telefone, e-mail, WhatsApp externo ou presencial.')
  if (p.resumo.trim().length < RESUMO_MINIMO) erros.push(`Resuma o contato em pelo menos ${RESUMO_MINIMO} caracteres.`)
  const em = Date.parse(p.em)
  if (Number.isNaN(em)) erros.push('Informe a data e a hora do contato.')
  else {
    if (em > Date.parse(agoraIso) + TOLERANCIA_RELOGIO_MS) erros.push('O contato não pode ser registrado no futuro.')
    if (em < Date.parse(t.abertaEm)) erros.push('O contato não pode ser anterior à abertura da conversa.')
  }
  if (t.status === 'FECHADA') erros.push('Conversa fechada: reabra antes de registrar o contato.')
  return erros
}

/** Metadados da mensagem que registra o contato. Chaves planas: `MetaMensagem` não aninha. */
export const metaDoContato = (p: Pick<PedidoDeContato, 'resultado' | 'meio'>): MetaMensagem => ({ contato: p.resultado, contatoMeio: p.meio })

export function contatoDaMensagem(m: Pick<InboxMessage, 'meta'>): { resultado: ResultadoContato; meio?: MeioContato } | undefined {
  const r = m.meta?.['contato']
  if (r !== 'realizado' && r !== 'tentativa') return undefined
  const meio = m.meta?.['contatoMeio']
  return { resultado: r, ...((MEIOS_CONTATO as readonly unknown[]).includes(meio) ? { meio: meio as MeioContato } : {}) }
}

/**
 * A mensagem é uma resposta EFETIVA ao interessado?
 * Rascunho (`registrada`) e falha nunca são; nota interna e mensagem recebida também não.
 */
export function ehRespostaEfetiva(m: Pick<InboxMessage, 'direcao' | 'entrega' | 'meta'>): boolean {
  if (m.direcao !== 'outbound') return false
  if (contatoDaMensagem(m)?.resultado === 'realizado') return true
  return m.entrega === 'enviada' || m.entrega === 'entregue' || m.entrega === 'lida'
}

/**
 * Mesmo contato declarado duas vezes (duplo clique, reenvio da fila offline)?
 * Mesmo autor, meio, instante declarado e resumo, na mesma conversa.
 */
export function contatoDuplicado(mensagens: readonly InboxMessage[], threadId: string, autorId: string | undefined, p: PedidoDeContato): InboxMessage | undefined {
  return mensagens.find((m) => m.threadId === threadId && m.autor.id === autorId && m.texto === p.resumo.trim()
    && Date.parse(m.em) === Date.parse(p.em) && contatoDaMensagem(m)?.resultado === p.resultado && contatoDaMensagem(m)?.meio === p.meio)
}

/* ---------------------------------------------------------------
   A situação da primeira resposta, para a tela e para os indicadores
--------------------------------------------------------------- */

export type SituacaoPrimeiraResposta =
  | 'sem_sla'
  | 'aguardando'
  | 'respondida_no_prazo'
  | 'respondida_fora_do_prazo'
  | 'encerrada_sem_resposta'

export const NOME_SITUACAO_RESPOSTA: Record<SituacaoPrimeiraResposta, string> = {
  sem_sla: 'sem SLA',
  aguardando: 'aguardando primeira resposta',
  respondida_no_prazo: 'respondida dentro do prazo',
  respondida_fora_do_prazo: 'respondida fora do prazo',
  encerrada_sem_resposta: 'encerrada sem resposta',
}

/**
 * - há primeira resposta: dentro ou fora do prazo, comparando o instante do
 *   contato com o vencimento — responder atrasado é «fora do prazo», não «cumprido»;
 * - não há e a conversa foi resolvida ou fechada: «encerrada sem resposta», que
 *   NÃO é atendimento realizado;
 * - não há e a conversa segue aberta: aguardando (no prazo, vencendo ou vencida é
 *   outra leitura, a de `estadoSla`).
 */
export function situacaoPrimeiraResposta(t: Pick<InboxThread, 'sla' | 'status'>): SituacaoPrimeiraResposta {
  if (!t.sla) return 'sem_sla'
  if (t.sla.primeiraRespostaEm) {
    return Date.parse(t.sla.primeiraRespostaEm) <= Date.parse(t.sla.primeiraRespostaAte) ? 'respondida_no_prazo' : 'respondida_fora_do_prazo'
  }
  return ehAberta(t.status) ? 'aguardando' : 'encerrada_sem_resposta'
}

/**
 * De onde veio o registro da primeira resposta de uma conversa.
 *
 * `anterior_a_regra` é o registro feito quando o RASCUNHO ainda marcava a
 * conversa como respondida: existe o instante, mas nenhuma mensagem que prove
 * contato. Esses registros NÃO são reclassificados nem apagados — ficam como
 * estão, e a tela diz que não são verificáveis.
 */
export type OrigemPrimeiraResposta = 'contato_declarado' | 'envio_por_canal' | 'anterior_a_regra'

export function origemPrimeiraResposta(t: Pick<InboxThread, 'id' | 'sla'>, mensagens: readonly InboxMessage[]): OrigemPrimeiraResposta | undefined {
  if (!t.sla?.primeiraRespostaEm) return undefined
  const efetivas = mensagens.filter((m) => m.threadId === t.id && ehRespostaEfetiva(m))
  if (efetivas.some((m) => contatoDaMensagem(m)?.resultado === 'realizado')) return 'contato_declarado'
  if (efetivas.length > 0) return 'envio_por_canal'
  return 'anterior_a_regra'
}

/** A mensagem que registrou o PRIMEIRO contato efetivo da conversa (a mais antiga pelo instante do contato). */
export function primeiroContatoEfetivo(t: Pick<InboxThread, 'id'>, mensagens: readonly InboxMessage[]): InboxMessage | undefined {
  return mensagens.filter((m) => m.threadId === t.id && ehRespostaEfetiva(m)).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))[0]
}

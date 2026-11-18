/**
 * E-mail comercial — a MENSAGEM (docs/email-comercial.md §7).
 *
 * Tudo aqui é puro: validação do que a pessoa escreveu e montagem da mensagem
 * RFC 5322 que a Gmail API recebe em `raw`. Nada fala com rede, banco ou ambiente.
 *
 * Regras que não mudam:
 *   - o servidor monta a mensagem; o navegador só fornece assunto e corpo;
 *   - um destinatário, texto puro, sem CC/CCO/anexo, sem rastreamento;
 *   - quebra de linha em cabeçalho é RECUSA (injeção de cabeçalho), nunca limpeza silenciosa;
 *   - o `Message-ID` é nosso e deriva do id da entrega: é a chave de reconciliação.
 */
import { sha256Hex } from '../radar/hash'

export const LIMITE_ASSUNTO = 150
/** O corpo vai para `inbox_message.body` (até 20.000) junto com a linha do assunto e a assinatura. */
export const LIMITE_CORPO = 18_000
export const DOMINIO_MENSAGEM = 'eiff.com.br'
export const NOME_EXIBIDO_PADRAO = 'EIFF'

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
const temControle = (s: string) => [...s].some((c) => { const n = c.charCodeAt(0); return n < 32 || n === 127 })
const temControleForaQuebra = (s: string) => [...s].some((c) => { const n = c.charCodeAt(0); return (n < 32 && n !== 10 && n !== 13 && n !== 9) || n === 127 })

/** Endereço utilizável como destinatário ou remetente: um só, sem nome, sem espaço, sem caractere de controle. */
export const emailValido = (s: string | undefined): s is string => typeof s === 'string' && s.length <= 254 && !temControle(s) && EMAIL.test(s)

/** `m•••@empresa.com.br`: o que a tela de confirmação e o log podem mostrar. */
export function mascararEmail(e: string): string {
  const [local, dominio] = e.split('@')
  return dominio ? `${local.slice(0, 1)}•••@${dominio}` : '•••'
}

export interface ConteudoEmail { assunto: string; corpo: string }

/** Recusas do que a pessoa escreveu, em texto que a tela mostra. Lista vazia = pode seguir. */
export function validarConteudo(c: ConteudoEmail): string[] {
  const erros: string[] = []
  const assunto = typeof c.assunto === 'string' ? c.assunto : ''
  const corpo = typeof c.corpo === 'string' ? c.corpo : ''
  if (assunto.trim() === '') erros.push('Escreva o assunto do e-mail.')
  else if (temControle(assunto)) erros.push('O assunto não pode ter quebra de linha nem caractere de controle.')
  else if (assunto.trim().length > LIMITE_ASSUNTO) erros.push(`O assunto passa de ${LIMITE_ASSUNTO} caracteres.`)
  if (corpo.trim() === '') erros.push('Escreva a mensagem do e-mail.')
  else if (temControleForaQuebra(corpo)) erros.push('A mensagem tem caractere de controle que não pode ser enviado.')
  else if (corpo.trim().length > LIMITE_CORPO) erros.push(`A mensagem passa de ${LIMITE_CORPO.toLocaleString('pt-BR')} caracteres.`)
  return erros
}

/** Assinatura decidida pela Direção: nome do atendente + EIFF. Nome com quebra de linha é descartado. */
export function assinatura(nomeAtendente: string | undefined): string {
  const nome = (nomeAtendente ?? '').trim()
  return nome !== '' && !temControle(nome) ? `${nome}\nEIFF` : 'EIFF'
}

/** O corpo que efetivamente sai: o texto da pessoa, uma linha em branco e a assinatura. Quebras normalizadas para LF. */
export function corpoComAssinatura(corpo: string, nomeAtendente: string | undefined): string {
  return `${corpo.replace(/\r\n?/g, '\n').trim()}\n\n${assinatura(nomeAtendente)}`
}

/** O que fica na conversa do Inbox: exatamente o que foi (ou será) enviado, com o assunto na primeira linha. */
export const textoNaConversa = (assunto: string, corpoFinal: string): string => `Assunto: ${assunto.trim()}\n\n${corpoFinal}`

/** `<id-da-entrega@eiff.com.br>` — gerado por nós, estável, sem dado pessoal. */
export const messageIdDaEntrega = (entregaId: string): string => `<${entregaId}@${DOMINIO_MENSAGEM}>`

/**
 * Impressão do pedido: mesma intenção com outro destinatário, assunto ou corpo é recusada (`intencao_reutilizada`).
 * Vai para o livro no lugar do conteúdo — o livro não guarda endereço nem texto.
 */
export const impressaoDoPedido = (p: { para: string; assunto: string; corpo: string }): string =>
  sha256Hex(JSON.stringify([p.para.trim().toLowerCase(), p.assunto.trim(), p.corpo.replace(/\r\n?/g, '\n').trim()]))

/* ---------------------------------------------------------------
   Codificação (sem Buffer nem btoa: roda igual no Node e no navegador)
--------------------------------------------------------------- */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function utf8(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

export function base64(bytes: readonly number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1]; const c = bytes[i + 2]
    out += ALFABETO[a >> 2] + ALFABETO[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : ALFABETO[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : ALFABETO[c & 63]
  }
  return out
}

/** base64url sem preenchimento: o formato do campo `raw` da Gmail API. */
export const base64url = (bytes: readonly number[]): string => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const soAscii = (s: string) => [...s].every((c) => { const n = c.charCodeAt(0); return n >= 32 && n < 127 })

/**
 * Valor de cabeçalho com texto livre (assunto, nome exibido). ASCII simples vai como está; o resto vira
 * «encoded-word» RFC 2047 em base64, partido em pedaços que cabem em 75 caracteres sem cortar um caractere UTF-8.
 */
export function cabecalhoCodificado(valor: string): string {
  if (soAscii(valor)) return valor
  const pedacos: string[] = []
  let atual: number[] = []
  for (const ch of valor) {
    const b = utf8(ch)
    if (atual.length + b.length > 45) { pedacos.push(`=?UTF-8?B?${base64(atual)}?=`); atual = [] }
    atual.push(...b)
  }
  if (atual.length > 0) pedacos.push(`=?UTF-8?B?${base64(atual)}?=`)
  return pedacos.join('\r\n ')
}

export interface PedidoDeMensagem {
  remetente: { nome: string; email: string }
  para: string
  assunto: string
  /** Corpo FINAL, já com a assinatura. */
  corpo: string
  messageId: string
  /** Instante do envio (ISO). */
  em: string
  /** `Message-ID` da mensagem anterior do fio, quando é continuação. */
  emRespostaA?: string
}

export class MensagemInvalida extends Error {
  constructor(readonly motivo: 'remetente_invalido' | 'destinatario_invalido' | 'assunto_invalido' | 'corpo_invalido' | 'message_id_invalido' | 'data_invalida') {
    super(`mensagem inválida: ${motivo}`)
    this.name = 'MensagemInvalida'
  }
}

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dois = (n: number) => String(n).padStart(2, '0')
/** Data RFC 5322 em UTC (`+0000`): não depende do fuso de quem executa. */
export function dataRfc5322(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new MensagemInvalida('data_invalida')
  return `${DIAS[d.getUTCDay()]}, ${dois(d.getUTCDate())} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())} +0000`
}

const MESSAGE_ID = /^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$/

/**
 * Monta a mensagem RFC 5322. Confere TUDO de novo: é a última linha antes do efeito externo, e não confia em quem chamou.
 * Lança `MensagemInvalida` — nunca devolve mensagem «consertada».
 */
export function montarMensagem(p: PedidoDeMensagem): string {
  if (!emailValido(p.remetente.email) || temControle(p.remetente.nome)) throw new MensagemInvalida('remetente_invalido')
  if (!emailValido(p.para)) throw new MensagemInvalida('destinatario_invalido')
  if (p.assunto.trim() === '' || temControle(p.assunto) || p.assunto.trim().length > LIMITE_ASSUNTO) throw new MensagemInvalida('assunto_invalido')
  if (p.corpo.trim() === '' || temControleForaQuebra(p.corpo)) throw new MensagemInvalida('corpo_invalido')
  if (!MESSAGE_ID.test(p.messageId) || (p.emRespostaA !== undefined && !MESSAGE_ID.test(p.emRespostaA))) throw new MensagemInvalida('message_id_invalido')

  const nome = p.remetente.nome.trim()
  const de = nome === '' ? p.remetente.email : `${soAscii(nome) ? `"${nome.replace(/["\\]/g, '')}"` : cabecalhoCodificado(nome)} <${p.remetente.email}>`
  const corpo64 = base64(utf8(p.corpo.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'))).replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '')
  const cabecalhos = [
    `From: ${de}`,
    `To: ${p.para}`,
    `Reply-To: ${p.remetente.email}`,
    `Subject: ${cabecalhoCodificado(p.assunto.trim())}`,
    `Date: ${dataRfc5322(p.em)}`,
    `Message-ID: ${p.messageId}`,
    ...(p.emRespostaA !== undefined ? [`In-Reply-To: ${p.emRespostaA}`, `References: ${p.emRespostaA}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  return `${cabecalhos.join('\r\n')}\r\n\r\n${corpo64}\r\n`
}

/** O valor do campo `raw` de `users.messages.send`. */
export const rawParaGmail = (mensagem: string): string => base64url(utf8(mensagem))

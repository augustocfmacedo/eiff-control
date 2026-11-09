/**
 * O formulário do site como mensagem do Inbox.
 *
 * ── POR QUE O INBOX, E NÃO SÓ O RADAR ────────────────────────────────────
 *
 * O Lead Engine recusa criar conta sem identidade forte — CNPJ válido ou
 * business_id —, e isso está certo: é o que impede o CRM de encher de raiz
 * inventada. Mas uma pessoa que preencheu o formulário e pediu retorno não
 * pode ficar esperando a decisão de promoção para existir em algum lugar.
 *
 * O Inbox resolve exatamente isso. Ele é a camada de ATENDIMENTO: trabalha
 * por THREAD e por contato de canal, não por empresa. Uma submissão válida
 * vira conversa visível na hora, com SLA e responsável, mesmo que não exista
 * nenhuma empresa cadastrada — e `receberMensagem` já cria o contato como
 * «desconhecido» quando não reconhece a identidade.
 *
 * Então a ordem é esta, e ela não tem dependência circular:
 *
 *   submissão → evidência no Lead Engine (PENDING)  ─┐
 *                                                    ├→ atendimento humano
 *   submissão → thread no Inbox (visível na hora)   ─┘
 *
 * A promoção para o Radar continua humana e continua exigindo identidade
 * forte. O que muda é que ninguém fica invisível enquanto ela não acontece.
 *
 * ── A RASTREABILIDADE ────────────────────────────────────────────────────
 *
 * A mensagem carrega, em `meta`, o id do registro de origem e a impressão do
 * payload. É por esses dois campos que se liga atendimento a evidência, e
 * evidência a oportunidade — sem copiar o conteúdo do lead para um segundo
 * lugar que depois diverge.
 *
 * `meta` tem CHECK no banco contra segredo e cabeçalho (migration 0056): o
 * que vai aqui é identificador e impressão, nunca token, nunca o payload.
 */
import type { MensagemRecebida } from './fronteiras'
import type { CanalInbox, IdentidadeCanal } from './tipos'
import type { CodigoProvider } from '../radar/canais'

/** Canal do formulário. `PORTAL` já existia no catálogo do Inbox. */
export const CANAL_FORMULARIO: CanalInbox = 'PORTAL'

/**
 * Nenhum provider de canal medeia um formulário do site: a submissão chega
 * pelo próprio site. `MANUAL` é o código que o catálogo já tem para isso, e
 * tem o efeito certo — nada é enviado de volta por provider nenhum.
 */
export const PROVIDER_FORMULARIO: CodigoProvider = 'MANUAL'

/** O que liga a mensagem à evidência. Só identificador e impressão. */
export interface RastroDaSubmissao {
  /** Id do `radar_source_record` criado para esta submissão. */
  registroFonteId: string
  /** Impressão canônica do payload — a mesma do Lead Engine. */
  payloadFingerprint: string
  /** Nome do formulário, para triagem. */
  formulario: string
}

/** Os campos que a mensagem mostra. Sem inventar texto que ninguém escreveu. */
export interface ResumoDaSubmissao {
  nome?: string
  email?: string
  telefone?: string
  empresa?: string
  cidade?: string
  /** O resumo da configuração que a própria página montou. */
  resumo?: string
  /** O que a pessoa escreveu com as próprias palavras. */
  mensagem?: string
  /** Demais linhas já formatadas (medidas, prazo, escopo, campanha). */
  linhas?: readonly string[]
}

/**
 * O texto da conversa. Quem abre o Inbox precisa entender o pedido sem ir a
 * outro sistema — e precisa ver o que a PESSOA escreveu, destacado do que o
 * formulário montou.
 */
export function textoDaMensagem(r: ResumoDaSubmissao): string {
  const linhas: string[] = []
  if (r.mensagem !== undefined) linhas.push(r.mensagem, '')
  if (r.resumo !== undefined) linhas.push(`Configuração: ${r.resumo}`)
  for (const l of r.linhas ?? []) linhas.push(l)
  const contato = [r.nome, r.empresa, r.cidade].filter((x) => x !== undefined).join(' · ')
  if (contato !== '') linhas.push(`Contato: ${contato}`)
  const canais = [r.email, r.telefone].filter((x) => x !== undefined).join(' · ')
  if (canais !== '') linhas.push(canais)
  return linhas.join('\n').trim()
}

/**
 * A identidade do canal. O e-mail é o identificador estável de quem escreve
 * pelo site: duas submissões do mesmo e-mail caem na mesma conversa, que é o
 * comportamento certo para quem manda duas vezes.
 *
 * Sem e-mail não há identidade — e sem identidade a submissão não vira
 * mensagem. É recusa explícita, não silêncio.
 */
export function identidadeDaSubmissao(r: ResumoDaSubmissao): IdentidadeCanal | undefined {
  const email = r.email?.trim().toLowerCase()
  if (email === undefined || email === '') return undefined
  return {
    canal: CANAL_FORMULARIO,
    identificador: email,
    ...(r.nome !== undefined ? { nomeInformado: r.nome } : {}),
    // Preencher formulário não prova identidade: ninguém confirmou nada.
    verificada: false,
  }
}

export interface PedidoDeMensagem {
  resumo: ResumoDaSubmissao
  rastro: RastroDaSubmissao
  /** Id externo da submissão: a chave de deduplicação do Inbox. */
  externalMessageId: string
  /** Instante da submissão, não o do processamento. */
  em: string
}

/**
 * Traduz a submissão em mensagem do Inbox — ou diz por que não dá.
 *
 * Mesma forma de `deEventoCentral`: devolve `{ erro }` em vez de lançar, para
 * que a borda decida o que fazer com uma submissão que não vira conversa.
 */
export function deSubmissaoDoSite(p: PedidoDeMensagem): MensagemRecebida | { erro: string } {
  const identidade = identidadeDaSubmissao(p.resumo)
  if (identidade === undefined) return { erro: 'submissão sem e-mail: não há identidade de canal' }
  if (p.externalMessageId.trim() === '') return { erro: 'submissão sem id externo: sem chave de deduplicação' }
  const texto = textoDaMensagem(p.resumo)
  if (texto === '') return { erro: 'submissão sem conteúdo legível' }
  return {
    canal: CANAL_FORMULARIO,
    provider: PROVIDER_FORMULARIO,
    // Quem preenche o formulário do site é cliente ou prospecto, nunca colaborador.
    contexto: 'EXTERNAL',
    identidade,
    externalMessageId: p.externalMessageId,
    texto,
    tipo: 'texto',
    em: p.em,
    meta: {
      formulario: p.rastro.formulario,
      registroFonteId: p.rastro.registroFonteId,
      payloadFingerprint: p.rastro.payloadFingerprint,
    },
  }
}

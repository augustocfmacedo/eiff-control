/**
 * O TRANSPORTE: o que o Netlify entrega → o corpo que a borda aceita.
 *
 * ── O QUE FOI VERIFICADO (09/11/2026) ────────────────────────────────────
 *
 * A pergunta era se a notificação nativa do Netlify Forms consegue mandar o
 * cabeçalho `x-eiff-form-secret` que a borda exige. **Não consegue.** A
 * notificação de webhook é documentada como «POST a uma URL arbitrária» e o
 * ÚNICO cabeçalho que ela acrescenta é `X-Webhook-Signature`, quando se
 * informa um «JWS secret token»; não há campo para cabeçalho próprio.
 *
 * Então o caminho escolhido é o A: uma função server-side do PRÓPRIO site
 * (evento `formSubmitted`, nome legado `submission-created`) que recebe a
 * submissão já verificada e a reencaminha autenticada. O segredo fica no
 * ambiente da função — nunca no HTML, nunca no JavaScript do navegador.
 *
 * E um fato que manda no desenho: a documentação do evento diz que o valor
 * devolvido pela função «não é usado pela plataforma». Não há reenvio. Falha
 * na função = submissão guardada no painel do Netlify e NADA no CRM. Por isso
 * o reconciliador (API oficial de submissões) não é conforto: é a única
 * garantia de que uma submissão válida não desaparece.
 *
 * ── POR QUE ESTE MÓDULO EXISTE SEPARADO ──────────────────────────────────
 *
 * Os dois caminhos — a função do site e o reconciliador — entregam o MESMO
 * objeto de submissão do Netlify. Traduzir isso para o contrato da borda é
 * uma função pura, e ela mora aqui para os dois usarem a mesma: o que entra
 * pelo webhook e o que entra pela reconciliação têm de produzir a MESMA
 * identidade e a MESMA impressão, senão a idempotência não vale nada.
 */
import type { CorpoDaSubmissao } from './formularioServidor'

/** A submissão como o Netlify a entrega (evento e API devolvem a mesma forma). */
export interface SubmissaoNetlify {
  id?: unknown
  form_name?: unknown
  created_at?: unknown
  state?: unknown
  data?: unknown
  human_fields?: unknown
}

/**
 * Campos que nunca entram na evidência.
 *
 * `form-name` é controle do Netlify. O honeypot é armadilha, não dado. E
 * `ip`/`user_agent`/`referrer` são dado pessoal que o Netlify acrescenta por
 * conta própria: guardá-los no Radar seria coletar o que ninguém pediu para
 * a decisão comercial. Ficam no painel do Netlify, onde já estão.
 */
export const CAMPOS_DESCARTADOS: readonly string[] = Object.freeze([
  'form-name', 'bot-field', 'ip', 'user_agent', 'referrer',
])

export const HONEYPOT_PADRAO = 'empresa-site'

export interface OpcoesTransporte {
  /** Nome do campo-armadilha do formulário. O site usa `empresa-site`. */
  honeypot?: string
  /** Formulários aceitos. Vazio = aceita qualquer um (o contrato da borda ainda filtra). */
  formulariosAceitos?: readonly string[]
}

export type MotivoIgnorado =
  | 'sem_payload'
  | 'sem_id'
  | 'sem_formulario'
  | 'formulario_nao_aceito'
  | 'sem_data'
  | 'sem_campos'
  | 'marcada_como_spam'
  | 'honeypot_preenchido'

export type Traducao = { ok: true; corpo: CorpoDaSubmissao } | { ok: false; motivo: MotivoIgnorado }

/** Valor de campo do Netlify → texto. Caixa de seleção múltipla vem como lista. */
function texto(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const partes = v.map((x) => texto(x)).filter((x): x is string => x !== undefined && x !== '')
    return partes.length > 0 ? partes.join(', ') : undefined
  }
  return undefined
}

/** Desembrulha `{ payload: … }` (o evento do Netlify embrulha; a API não). */
export function desembrulhar(bruto: unknown): SubmissaoNetlify | undefined {
  if (bruto === null || typeof bruto !== 'object') return undefined
  const o = bruto as Record<string, unknown>
  const dentro = o['payload']
  if (dentro !== null && typeof dentro === 'object') return dentro as SubmissaoNetlify
  return o as SubmissaoNetlify
}

/**
 * Traduz a submissão do Netlify no corpo que a borda aceita — ou diz por que
 * não traduziu. Nunca lança: uma submissão estranha vira motivo registrado,
 * não exceção no meio do webhook.
 */
export function corpoDaSubmissaoNetlify(bruto: unknown, opcoes: OpcoesTransporte = {}): Traducao {
  const s = desembrulhar(bruto)
  if (s === undefined) return { ok: false, motivo: 'sem_payload' }

  const id = texto(s.id)?.trim()
  if (id === undefined || id === '') return { ok: false, motivo: 'sem_id' }

  const formulario = texto(s.form_name)?.trim()
  if (formulario === undefined || formulario === '') return { ok: false, motivo: 'sem_formulario' }
  const aceitos = opcoes.formulariosAceitos
  if (aceitos !== undefined && aceitos.length > 0 && !aceitos.includes(formulario)) {
    return { ok: false, motivo: 'formulario_nao_aceito' }
  }

  const criadoEm = texto(s.created_at)?.trim()
  if (criadoEm === undefined || Number.isNaN(Date.parse(criadoEm))) return { ok: false, motivo: 'sem_data' }

  // O evento só dispara para submissão verificada, mas a API devolve spam quando se pede.
  if (texto(s.state) === 'spam') return { ok: false, motivo: 'marcada_como_spam' }

  const bruta = (s.data !== null && typeof s.data === 'object' ? s.data : s.human_fields) as Record<string, unknown> | undefined
  if (bruta === null || bruta === undefined || typeof bruta !== 'object') return { ok: false, motivo: 'sem_campos' }

  const honeypot = opcoes.honeypot ?? HONEYPOT_PADRAO
  const armadilha = texto(bruta[honeypot])?.trim()
  if (armadilha !== undefined && armadilha !== '') return { ok: false, motivo: 'honeypot_preenchido' }

  const campos: Record<string, string> = {}
  for (const [k, v] of Object.entries(bruta)) {
    if (k === honeypot || CAMPOS_DESCARTADOS.includes(k)) continue
    const t = texto(v)
    if (t === undefined) continue
    const limpo = t.trim()
    if (limpo === '') continue
    campos[k] = limpo
  }
  if (Object.keys(campos).length === 0) return { ok: false, motivo: 'sem_campos' }

  // `recebidoEm` é o instante DA SUBMISSÃO, nunca o do processamento: é o que
  // faz a reconciliação de amanhã produzir a mesma impressão de hoje.
  return { ok: true, corpo: { id, formulario, recebidoEm: new Date(criadoEm).toISOString(), campos } }
}

/* ---------------------------------------------------------------
   O que o transporte é, dito por extenso
--------------------------------------------------------------- */

export const CAMINHO_ESCOLHIDO =
  'A: função server-side do próprio site (evento formSubmitted / submission-created) reencaminha a submissão '
  + 'autenticada para /api/formulario-site. A notificação nativa do Netlify NÃO aceita cabeçalho próprio, '
  + 'então não há como ela mandar o segredo que a borda exige.'

export const PORQUE_O_RECONCILIADOR_E_OBRIGATORIO =
  'a documentação do evento diz que o retorno da função não é usado pela plataforma: não há reenvio automático. '
  + 'Falha na função deixa a submissão guardada no Netlify e ausente no CRM — e só o reconciliador, lendo a API '
  + 'oficial de submissões, a traz de volta sem duplicar nada.'

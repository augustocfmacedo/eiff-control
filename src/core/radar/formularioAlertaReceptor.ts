/**
 * Receptor de REFERÊNCIA dos alertas da reconciliação (D3 do GO-3). Não é publicado por este repositório: é o
 * contrato executável do lado que recebe, para ser hospedado FORA do eiff-control (o caminho do alerta não pode
 * depender do mesmo Netlify que ele vigia) e provado aqui com um servidor HTTP local.
 *
 * Ordem do que ele faz com cada POST, e o status que devolve:
 *
 *   1. assinatura: `x-eiff-assinatura: v1=<hex>` = HMAC-SHA256(segredo, `<x-eiff-timestamp>.<corpo>`), comparada em tempo
 *      constante                                                                                  → 401 se não confere
 *   2. horário: `x-eiff-timestamp` a no máximo `TOLERANCIA_SEGUNDOS` do relógio do receptor        → 401 (repetição antiga)
 *   3. corpo: JSON da versão `v1` com tipo, severidade, chave e título                             → 400
 *   4. barreira de dado pessoal (defesa em profundidade; o emissor já confere)                      → 422
 *   5. deduplicação pela `x-eiff-entrega` (= chave do alerta): já visto                             → 200 «duplicado»
 *   6. encaminha ao DESTINO (chat da equipe, e-mail); só então marca como visto                     → 200 «entregue»
 *      destino fora do ar                                                                          → 503 (o emissor reenvia)
 *
 * 2xx é a única resposta que o emissor grava como entrega. Por isso o duplicado responde 200 (o emissor para de
 * reenviar) e a falha do destino responde 503 (o emissor tenta de novo na passada seguinte).
 */
import { problemasDeDadoPessoal, TIPOS_ALERTA } from './formularioMonitor'
import { assinarWebhook, type MensagemDeAlerta } from './formularioAlertaCanais'

/** Atraso máximo aceito entre o emissor e o receptor. */
export const TOLERANCIA_SEGUNDOS = 300

export type DesfechoRecepcao =
  | 'entregue' | 'duplicado' | 'assinatura_invalida' | 'horario_invalido' | 'corpo_invalido' | 'dado_pessoal' | 'destino_indisponivel'

export interface AlertaRecebido extends MensagemDeAlerta {
  chave: string
  origem: string
  versao: 'v1'
}

/** Para onde o receptor manda o alerta verificado (chat, e-mail). Lança se não conseguiu. */
export interface DestinoAlerta {
  nome: string
  encaminhar(a: AlertaRecebido): Promise<void>
}

/** Onde o receptor lembra o que já entregou. Em produção, um armazenamento durável (KV, planilha, tabela). */
export interface MemoriaDeEntregas {
  jaEntregue(chave: string): Promise<boolean>
  marcar(chave: string): Promise<void>
}

export const memoriaEmProcesso = (): MemoriaDeEntregas & { chaves: Set<string> } => {
  const chaves = new Set<string>()
  return { chaves, async jaEntregue(c) { return chaves.has(c) }, async marcar(c) { chaves.add(c) } }
}

export interface ConfigReceptor {
  segredo: string
  destino: DestinoAlerta
  memoria: MemoriaDeEntregas
  agoraSegundos?: () => number
}

/** Comparação em tempo constante (não vaza, pelo tempo, quantos caracteres batem). */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const SEVERIDADES = ['critico', 'aviso', 'info']

export async function receberAlerta(
  cabecalhos: Headers, corpo: string, cfg: ConfigReceptor,
): Promise<{ status: number; desfecho: DesfechoRecepcao; tipo?: string; chave?: string }> {
  const timestamp = cabecalhos.get('x-eiff-timestamp') ?? ''
  const assinatura = cabecalhos.get('x-eiff-assinatura') ?? ''
  const entrega = cabecalhos.get('x-eiff-entrega') ?? ''

  const esperada = `v1=${await assinarWebhook(cfg.segredo, timestamp, corpo)}`
  if (!/^\d{9,12}$/.test(timestamp) || !iguaisEmTempoConstante(assinatura, esperada)) return { status: 401, desfecho: 'assinatura_invalida' }
  const agora = (cfg.agoraSegundos ?? (() => Math.floor(Date.now() / 1000)))()
  if (Math.abs(agora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) return { status: 401, desfecho: 'horario_invalido' }

  let a: AlertaRecebido
  try { a = JSON.parse(corpo) as AlertaRecebido } catch { return { status: 400, desfecho: 'corpo_invalido' } }
  if (a?.versao !== 'v1' || !(TIPOS_ALERTA as readonly string[]).includes(a.tipo) || !SEVERIDADES.includes(a.severidade)
    || typeof a.chave !== 'string' || a.chave === '' || a.chave !== entrega || typeof a.titulo !== 'string') {
    return { status: 400, desfecho: 'corpo_invalido' }
  }
  if (problemasDeDadoPessoal(a).length > 0) return { status: 422, desfecho: 'dado_pessoal', tipo: a.tipo }

  if (await cfg.memoria.jaEntregue(a.chave)) return { status: 200, desfecho: 'duplicado', tipo: a.tipo, chave: a.chave }
  try {
    await cfg.destino.encaminhar(a)
  } catch {
    return { status: 503, desfecho: 'destino_indisponivel', tipo: a.tipo, chave: a.chave }
  }
  await cfg.memoria.marcar(a.chave)
  return { status: 200, desfecho: 'entregue', tipo: a.tipo, chave: a.chave }
}

/** O receptor como função `Request → Response`: o formato de Netlify Functions, workers e do `fetch` do Node. */
export const receptorHttp = (cfg: ConfigReceptor) => async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const r = await receberAlerta(req.headers, await req.text(), cfg)
  // A resposta não ecoa o corpo nem o motivo detalhado de assinatura: só o desfecho.
  return new Response(JSON.stringify({ desfecho: r.desfecho }), { status: r.status, headers: { 'content-type': 'application/json' } })
}

/**
 * Formato do Google Chat (webhook de entrada de um espaço): `{ text }`. O alerta já vem sem dado pessoal; a linha de
 * título leva a severidade, o texto e a ação. A chave vai no fim para conferência.
 */
export const mensagemParaChat = (a: AlertaRecebido): { text: string } => ({
  text: [`*${a.titulo}*`, a.texto, `Ação: ${a.acao}`, `chave: ${a.chave}`].join('\n'),
})

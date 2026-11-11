/**
 * Erro seguro: o que pode sair de uma exceção para um log, um relatório ou um
 * corpo de resposta — e a validação de credencial antes de montar cabeçalho.
 *
 * POR QUE EXISTE (GO-3, etapa 1; achado de 10/11/2026). O Node inclui o VALOR do
 * cabeçalho na mensagem de alguns erros de `fetch`:
 *
 *     TypeError: Headers.append: "Bearer <token>…" is an invalid header value.
 *
 * Quem registra `(e as Error).message` grava a credencial no log. O caminho do
 * formulário do site manda três credenciais em cabeçalho (o segredo do endpoint,
 * a chave de serviço do banco e o token de leitura do Netlify) e registrava a
 * mensagem bruta em seis pontos. Além disso, um valor com caractere de controle
 * falha com «fetch failed» e o motivo real fica em `error.cause`, que ninguém lia.
 *
 * A REGRA. Deste módulo para fora só saem:
 *
 *   - um CÓDIGO de um catálogo fechado;
 *   - o status HTTP, quando houver (só os três dígitos);
 *   - o código técnico da causa, quando ele está no catálogo fechado (`ECONNREFUSED`);
 *   - a operação, quando a mensagem é INTEIRA uma das que o próprio sistema monta
 *     com constantes (`postgrest GET inbox_thread http 503`).
 *
 * A mensagem da exceção é LIDA para classificar e NUNCA é devolvida. Não há
 * caminho neste arquivo que copie texto livre de uma exceção para a saída.
 *
 * Módulo puro: sem rede, sem ambiente, sem relógio.
 */

export const CODIGOS_DE_ERRO = [
  'CREDENCIAL_AUSENTE',
  'CREDENCIAL_INVALIDA',
  'ERRO_REDE',
  'ERRO_HTTP',
  'FALHA_LEITURA',
  'FALHA_GRAVACAO',
  'SEM_CODIGO',
] as const
export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[number]

export interface ErroSeguro {
  codigo: CodigoDeErro
  /** Status HTTP, quando a falha foi uma resposta do outro lado. */
  http?: number
  /** Código técnico da causa (`ECONNREFUSED`, `UND_ERR_INVALID_ARG`). Nunca texto livre. */
  causa?: string
  /** Operação interna, quando a mensagem é uma das montadas pelo sistema com constantes. */
  operacao?: string
}

/* ---------------------------------------------------------------
   1 · Validação de credencial, antes de qualquer cabeçalho
---------------------------------------------------------------- */

/**
 * O que o HTTP aceita num valor de cabeçalho no Node (undici): tab, 0x20–0x7E e
 * 0x80–0xFF. Caractere de controle (`^V` de um Ctrl+V, Esc, quebra de linha
 * interna, DEL) e qualquer coisa fora do Latin-1 fazem o `fetch` falhar — e, em
 * parte dos casos, com o valor na mensagem.
 */
const VALOR_DE_CABECALHO = /^[\t\x20-\x7e\x80-\xff]+$/

export type CredencialValidada =
  | { ok: true; valor: string }
  | { ok: false; codigo: 'CREDENCIAL_AUSENTE' | 'CREDENCIAL_INVALIDA' }

/**
 * Confere uma credencial que vai virar cabeçalho. NÃO corrige nada: espaço e
 * quebra de linha nas PONTAS são ignorados (é o que o sistema sempre fez ao ler
 * o ambiente, e é como um valor colado costuma chegar); qualquer outra coisa
 * fora do aceito é recusada, nunca removida em silêncio.
 */
export function validarCredencial(bruto: string | undefined | null): CredencialValidada {
  const valor = (bruto ?? '').trim()
  if (valor === '') return { ok: false, codigo: 'CREDENCIAL_AUSENTE' }
  if (!VALOR_DE_CABECALHO.test(valor)) return { ok: false, codigo: 'CREDENCIAL_INVALIDA' }
  return { ok: true, valor }
}

/** Credencial recusada antes de qualquer requisição. A mensagem leva o NOME da variável, nunca o valor. */
export class ErroDeCredencial extends Error {
  constructor(readonly codigo: 'CREDENCIAL_AUSENTE' | 'CREDENCIAL_INVALIDA', readonly variavel: string) {
    super(`${codigo}: ${variavel}`)
    this.name = 'ErroDeCredencial'
  }
}

/** Valida ou lança `ErroDeCredencial`. `variavel` é o NOME (ex.: `NETLIFY_AUTH_TOKEN`). */
export function exigirCredencial(bruto: string | undefined | null, variavel: string): string {
  const v = validarCredencial(bruto)
  if (!v.ok) throw new ErroDeCredencial(v.codigo, variavel)
  return v.valor
}

/* ---------------------------------------------------------------
   2 · Classificação de exceção
---------------------------------------------------------------- */

/**
 * Códigos técnicos de causa que podem sair. Catálogo FECHADO: um `code` que não está aqui vira
 * `CAUSA_NAO_CATALOGADA`, porque «ter forma de código» não prova que o texto não é um segredo.
 */
export const CAUSAS_CONHECIDAS: ReadonlySet<string> = new Set([
  // sistema operacional / DNS
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO',
  // cliente HTTP do Node (undici)
  'UND_ERR_INVALID_ARG', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED',
  'UND_ERR_CLOSED', 'UND_ERR_DESTROYED', 'UND_ERR_INFO', 'UND_ERR_RESPONSE_STATUS_CODE', 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  // TLS / URL
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_INVALID_URL',
  // deste módulo
  'TEMPO_ESGOTADO', 'CAUSA_NAO_CATALOGADA',
])
const FORMA_DE_CODIGO = { test: (c: string): boolean => CAUSAS_CONHECIDAS.has(c) }

/**
 * Mensagens que o PRÓPRIO sistema monta, só com constantes e o status. O casamento
 * é da mensagem INTEIRA e com alfabeto fechado: se houver qualquer outra coisa no
 * texto, não casa e nada dele é aproveitado.
 */
const OPERACAO_INTERNA = /^((?:postgrest (?:GET|POST|PATCH|DELETE) [a-z0-9_/]{1,80})|(?:rpc [a-z0-9_]{1,60})) http (\d{3})$/

/** Erros de cabeçalho inválido que o Node lança ANTES de abrir conexão. Só para classificar. */
const CABECALHO_INVALIDO = /invalid header value|invalid header name|is an invalid header|ByteString/i

/** O `code` da causa (ou do próprio erro), se estiver no catálogo; se existir e não estiver, o marcador fixo. */
const causaDe = (e: unknown): string | undefined => {
  const c = (e as { cause?: { code?: unknown } } | null | undefined)?.cause?.code
  const proprio = (e as { code?: unknown } | null | undefined)?.code
  for (const v of [c, proprio]) if (typeof v === 'string' && CAUSAS_CONHECIDAS.has(v)) return v
  return typeof c === 'string' || typeof proprio === 'string' ? 'CAUSA_NAO_CATALOGADA' : undefined
}

/**
 * Transforma qualquer coisa lançada em `ErroSeguro`. Nunca lança e nunca devolve
 * texto vindo da exceção.
 */
export function classificarErro(e: unknown): ErroSeguro {
  try {
    if (e instanceof ErroDeCredencial) return { codigo: e.codigo }
    const seguro = (e as { erroSeguro?: unknown } | null | undefined)?.erroSeguro
    if (ehErroSeguro(seguro)) return seguro

    const mensagem = typeof (e as { message?: unknown } | null | undefined)?.message === 'string'
      ? (e as { message: string }).message
      : ''
    const nome = typeof (e as { name?: unknown } | null | undefined)?.name === 'string' ? (e as { name: string }).name : ''
    const causa = causaDe(e)

    const interna = OPERACAO_INTERNA.exec(mensagem)
    if (interna !== null) return { codigo: 'ERRO_HTTP', http: Number(interna[2]), operacao: interna[1]! }

    // Outra mensagem com «http NNN»: aproveita SÓ os três dígitos (o resto do texto não sai).
    const status = /\bhttp ([1-5]\d{2})\b/.exec(mensagem)
    if (status !== null && !CABECALHO_INVALIDO.test(mensagem)) return { codigo: 'ERRO_HTTP', http: Number(status[1]) }

    // Cabeçalho recusado pelo Node: a credencial é inválida, e a mensagem pode conter o valor.
    if (causa === 'UND_ERR_INVALID_ARG' || CABECALHO_INVALIDO.test(mensagem)) {
      return { codigo: 'CREDENCIAL_INVALIDA', ...(causa !== undefined ? { causa } : {}) }
    }
    if (nome === 'AbortError' || nome === 'TimeoutError') return { codigo: 'ERRO_REDE', causa: causa ?? 'TEMPO_ESGOTADO' }
    // «fetch failed» é a mensagem fixa do Node para falha de transporte; a causa diz qual.
    if (mensagem === 'fetch failed' || causa !== undefined) return { codigo: 'ERRO_REDE', ...(causa !== undefined ? { causa } : {}) }
    return { codigo: 'SEM_CODIGO' }
  } catch {
    return { codigo: 'SEM_CODIGO' }
  }
}

function ehErroSeguro(v: unknown): v is ErroSeguro {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (CODIGOS_DE_ERRO as readonly unknown[]).includes(o['codigo'])
    && (o['http'] === undefined || (typeof o['http'] === 'number' && Number.isInteger(o['http']) && o['http'] >= 100 && o['http'] <= 599))
    && (o['causa'] === undefined || (typeof o['causa'] === 'string' && FORMA_DE_CODIGO.test(o['causa'])))
    && (o['operacao'] === undefined || (typeof o['operacao'] === 'string' && /^[a-zA-Z0-9_/ ]{1,100}$/.test(o['operacao'])))
}

/** Erro de resposta HTTP, quando o chamador tem o status em mãos. */
export const erroHttp = (status: number, operacao?: string): ErroSeguro =>
  ({ codigo: 'ERRO_HTTP', http: status, ...(operacao !== undefined ? { operacao } : {}) })

/**
 * Uma linha curta para log e relatório, montada SÓ com os campos do `ErroSeguro`:
 * `ERRO_HTTP 503 (postgrest POST radar_source_record)`, `ERRO_REDE ECONNREFUSED`,
 * `CREDENCIAL_INVALIDA`, `SEM_CODIGO`.
 */
export function textoDoErro(s: ErroSeguro): string {
  const partes: string[] = [s.codigo]
  if (s.http !== undefined) partes.push(String(s.http))
  if (s.causa !== undefined) partes.push(s.causa)
  return s.operacao !== undefined ? `${partes.join(' ')} (${s.operacao})` : partes.join(' ')
}

/** Atalho: classifica e descreve. É o que substitui `(e as Error).message` num log. */
export const descricaoSegura = (e: unknown): string => textoDoErro(classificarErro(e))

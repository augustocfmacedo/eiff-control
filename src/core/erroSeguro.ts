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

/**
 * Recursos do banco que o caminho do formulário e do Inbox acessa pelo servidor. Catálogo FECHADO, como o das
 * causas: «ter forma de nome de tabela» não prova que o texto não é um segredo (`rpc segredo_ficticio_123456`
 * teria a forma certa). Recurso novo entra aqui; fora daqui a operação simplesmente não é impressa.
 */
export const TABELAS_CONHECIDAS: ReadonlySet<string> = new Set([
  'radar_source', 'radar_source_record',
  'inbox_thread', 'inbox_message', 'inbox_contact', 'inbox_contact_identity',
  'inbox_sector', 'inbox_team', 'inbox_member', 'inbox_config', 'inbox_assignment', 'inbox_thread_event',
])
export const RPCS_CONHECIDAS: ReadonlySet<string> = new Set(['inbox_ingest', 'inbox_apply_routing', 'inbox_assign_thread'])
const VERBOS_DE_TABELA: ReadonlySet<string> = new Set(['postgrest GET', 'postgrest POST', 'postgrest PATCH', 'postgrest DELETE', 'rest'])

/**
 * Uma operação só é reconhecida quando é EXATAMENTE `<verbo conhecido> <recurso conhecido>`: `postgrest POST
 * radar_source_record`, `rest inbox_thread`, `rpc inbox_ingest`. Qualquer outro texto devolve `undefined` — e a
 * operação é OMITIDA, nunca reproduzida. Vale para a mensagem de uma exceção e para um objeto que alegue ser
 * `ErroSeguro`: nenhum dos dois é fonte confiável.
 */
export function operacaoConhecida(texto: unknown): string | undefined {
  if (typeof texto !== 'string' || texto.length > 80) return undefined
  const corte = texto.lastIndexOf(' ')
  if (corte <= 0) return undefined
  const verbo = texto.slice(0, corte)
  const recurso = texto.slice(corte + 1)
  if (verbo === 'rpc') return RPCS_CONHECIDAS.has(recurso) ? `rpc ${recurso}` : undefined
  return VERBOS_DE_TABELA.has(verbo) && TABELAS_CONHECIDAS.has(recurso) ? `${verbo} ${recurso}` : undefined
}

/**
 * Mensagens que o PRÓPRIO sistema monta: `<operação> http <status>`. A parte antes de ` http NNN` só é
 * aproveitada se for uma operação do catálogo; senão sobra só o status.
 */
const MENSAGEM_COM_STATUS = /^(.{1,80}) http ([1-5]\d{2})$/

/**
 * Código devolvido por uma RPC (ou por qualquer fonte externa) só sai se estiver no catálogo informado. O que
 * não está vira o marcador fixo: o texto recebido nunca é reproduzido.
 */
export const CODIGO_NAO_CATALOGADO = 'CODIGO_NAO_CATALOGADO'
export function codigoDeCatalogo(valor: unknown, catalogo: ReadonlySet<string>): string {
  return typeof valor === 'string' && catalogo.has(valor) ? valor : CODIGO_NAO_CATALOGADO
}

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
    // Um objeto que ALEGA trazer um erro seguro não é fonte confiável: é reconstruído campo a campo.
    const alegado = erroSeguroSaneado((e as { erroSeguro?: unknown } | null | undefined)?.erroSeguro)
    if (alegado !== undefined) return alegado

    const mensagem = typeof (e as { message?: unknown } | null | undefined)?.message === 'string'
      ? (e as { message: string }).message
      : ''
    const nome = typeof (e as { name?: unknown } | null | undefined)?.name === 'string' ? (e as { name: string }).name : ''
    const causa = causaDe(e)

    const interna = MENSAGEM_COM_STATUS.exec(mensagem)
    const operacao = interna !== null ? operacaoConhecida(interna[1]) : undefined
    if (interna !== null && operacao !== undefined) return { codigo: 'ERRO_HTTP', http: Number(interna[2]), operacao }

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

/**
 * Reconstrói um `ErroSeguro` a partir de um objeto NÃO confiável. Nunca devolve o objeto recebido: monta um
 * novo, só com o que passa em catálogo fechado. Código fora do catálogo invalida tudo (`undefined`); status
 * fora de 100–599, causa fora do catálogo e operação desconhecida são OMITIDOS, nunca copiados.
 */
function erroSeguroSaneado(v: unknown): ErroSeguro | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const codigo = (CODIGOS_DE_ERRO as readonly unknown[]).includes(o['codigo']) ? (o['codigo'] as CodigoDeErro) : undefined
  if (codigo === undefined) return undefined
  const http = typeof o['http'] === 'number' && Number.isInteger(o['http']) && o['http'] >= 100 && o['http'] <= 599 ? o['http'] : undefined
  const causa = typeof o['causa'] === 'string' && CAUSAS_CONHECIDAS.has(o['causa']) ? o['causa'] : undefined
  const operacao = operacaoConhecida(o['operacao'])
  return { codigo, ...(http !== undefined ? { http } : {}), ...(causa !== undefined ? { causa } : {}), ...(operacao !== undefined ? { operacao } : {}) }
}

/** Erro de resposta HTTP, quando o chamador tem o status em mãos. A operação só entra se for do catálogo. */
export const erroHttp = (status: number, operacao?: string): ErroSeguro => {
  const conhecida = operacaoConhecida(operacao)
  return { codigo: 'ERRO_HTTP', http: status, ...(conhecida !== undefined ? { operacao: conhecida } : {}) }
}

/**
 * Uma linha curta para log e relatório, montada SÓ com os campos do `ErroSeguro`:
 * `ERRO_HTTP 503 (postgrest POST radar_source_record)`, `ERRO_REDE ECONNREFUSED`,
 * `CREDENCIAL_INVALIDA`, `SEM_CODIGO`.
 */
export function textoDoErro(s: ErroSeguro): string {
  // Última barreira: o tipo `ErroSeguro` não impede alguém de montar o objeto à mão com texto livre. Cada campo
  // é conferido de novo AQUI, no ponto em que vira texto; o que não é de catálogo não é impresso.
  const partes: string[] = [(CODIGOS_DE_ERRO as readonly string[]).includes(s.codigo) ? s.codigo : 'SEM_CODIGO']
  if (typeof s.http === 'number' && Number.isInteger(s.http) && s.http >= 100 && s.http <= 599) partes.push(String(s.http))
  if (typeof s.causa === 'string' && CAUSAS_CONHECIDAS.has(s.causa)) partes.push(s.causa)
  const operacao = operacaoConhecida(s.operacao)
  return operacao !== undefined ? `${partes.join(' ')} (${operacao})` : partes.join(' ')
}

/**
 * Um texto É uma descrição segura quando é exatamente o que `textoDoErro` produziria: código do catálogo, status
 * opcional, causa do catálogo opcional e operação conhecida opcional. Serve para um módulo aceitar de volta, de uma
 * fonte que não controla, só aquilo que este módulo poderia ter escrito.
 */
export function ehDescricaoSegura(texto: unknown): boolean {
  if (typeof texto !== 'string' || texto.length > 160) return false
  const m = /^([A-Z_]{1,30})(?: ([1-5]\d{2}))?(?: ([A-Z][A-Z0-9_]{1,50}))?(?: \(([^()]{1,80})\))?$/.exec(texto)
  if (m === null) return false
  return (CODIGOS_DE_ERRO as readonly string[]).includes(m[1]!)
    && (m[3] === undefined || CAUSAS_CONHECIDAS.has(m[3]))
    && (m[4] === undefined || operacaoConhecida(m[4]) === m[4])
}

/** Atalho: classifica e descreve. É o que substitui `(e as Error).message` num log. */
export const descricaoSegura = (e: unknown): string => textoDoErro(classificarErro(e))

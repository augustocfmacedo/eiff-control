/**
 * Erro seguro: o que este módulo deixa sair de uma exceção, e a recusa de credencial antes do cabeçalho.
 *
 * Todo valor «secreto» aqui é fictício e reconhecível, para que a busca por ele na saída prove algo.
 */
import { describe, expect, it } from 'vitest'
import {
  CAUSAS_CONHECIDAS, CODIGOS_DE_ERRO, ErroDeCredencial, classificarErro, descricaoSegura, erroHttp, exigirCredencial, textoDoErro, validarCredencial,
} from './erroSeguro'

const TOKEN = 'tok_FICTICIO_9f3a7c21e5_NAO_PODE_VAZAR'
const semSegredo = (v: unknown) => expect(JSON.stringify(v) + String(v)).not.toContain(TOKEN)

describe('validarCredencial · antes de qualquer cabeçalho', () => {
  it('ausente: undefined, null, vazio e só espaços', () => {
    for (const v of [undefined, null, '', '   ', '\n\t ']) expect(validarCredencial(v)).toEqual({ ok: false, codigo: 'CREDENCIAL_AUSENTE' })
  })

  it('aceita o que o HTTP aceita e devolve o valor sem alterar o miolo', () => {
    for (const v of ['abc-123_XYZ.~', 'com espaço interno', 'tab\tinterno', 'latin1-é-ç']) expect(validarCredencial(v)).toEqual({ ok: true, valor: v })
  })

  it('espaço e quebra de linha nas PONTAS são ignorados (valor colado), e só isso', () => {
    expect(validarCredencial('  abc123\r\n')).toEqual({ ok: true, valor: 'abc123' })
  })

  it('recusa caractere de controle em qualquer posição do miolo, sem removê-lo', () => {
    for (const c of ['\u0016', '\u001b', '\u0000', '\u007f', '\r\n', '\n', '\u0001']) {
      expect(validarCredencial(`abc${c}def`), JSON.stringify(c)).toEqual({ ok: false, codigo: 'CREDENCIAL_INVALIDA' })
    }
  })

  it('recusa caractere fora do Latin-1 (travessão, aspas curvas, BOM, emoji)', () => {
    for (const c of ['—', '“', '\ufeff', '😀', 'Ω']) expect(validarCredencial(`abc${c}def`), c).toEqual({ ok: false, codigo: 'CREDENCIAL_INVALIDA' })
  })

  it('a regra é a do Node: todo valor aceito monta cabeçalho, todo valor recusado falharia no fetch', () => {
    for (const v of ['abc-123', 'com espaço', 'tab\tx', 'é']) expect(() => new Headers({ 'x-teste': v })).not.toThrow()
    // os que o `Headers` recusa já na montagem; os demais controles só falham no envio (UND_ERR_INVALID_ARG)
    for (const v of ['a\nb', 'a\u0000b', 'a—b']) {
      expect(validarCredencial(v).ok).toBe(false)
      expect(() => new Headers({ 'x-teste': v })).toThrow()
    }
  })

  it('exigirCredencial lança com o NOME da variável e nunca com o valor', () => {
    let erro: unknown
    try { exigirCredencial(`${TOKEN}\u0016`, 'NETLIFY_AUTH_TOKEN') } catch (e) { erro = e }
    expect(erro).toBeInstanceOf(ErroDeCredencial)
    expect((erro as Error).message).toBe('CREDENCIAL_INVALIDA: NETLIFY_AUTH_TOKEN')
    semSegredo((erro as Error).message)
    expect(exigirCredencial(` ${TOKEN} `, 'X')).toBe(TOKEN)
    expect(() => exigirCredencial('', 'X')).toThrow('CREDENCIAL_AUSENTE: X')
  })
})

describe('classificarErro · nada da mensagem sai', () => {
  it('token dentro de `message` (o erro real do Node para cabeçalho inválido)', () => {
    const e = new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`)
    const c = classificarErro(e)
    expect(c).toEqual({ codigo: 'CREDENCIAL_INVALIDA' })
    semSegredo(c); semSegredo(descricaoSegura(e))
  })

  it('token dentro de `cause.message`, com o código de cabeçalho inválido', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error(`invalid authorization header Bearer ${TOKEN}`), { code: 'UND_ERR_INVALID_ARG' }) })
    expect(classificarErro(e)).toEqual({ codigo: 'CREDENCIAL_INVALIDA', causa: 'UND_ERR_INVALID_ARG' })
    semSegredo(classificarErro(e)); semSegredo(descricaoSegura(e))
  })

  it('token no próprio `cause.code`: código fora do catálogo vira o marcador fixo', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: TOKEN }) })
    expect(classificarErro(e)).toEqual({ codigo: 'ERRO_REDE', causa: 'CAUSA_NAO_CATALOGADA' })
    const maiusculo = new TypeError('fetch failed', { cause: { code: 'TOKEN_FICTICIO_EM_FORMA_DE_CODIGO' } })
    expect(classificarErro(maiusculo).causa).toBe('CAUSA_NAO_CATALOGADA')
    semSegredo(classificarErro(e))
  })

  it('token em mensagem qualquer, sem pista de classe: SEM_CODIGO', () => {
    const e = new Error(`algo deu errado com ${TOKEN}`)
    expect(classificarErro(e)).toEqual({ codigo: 'SEM_CODIGO' })
    expect(descricaoSegura(e)).toBe('SEM_CODIGO')
  })

  it('caractere fora do Latin-1 no cabeçalho (ByteString) é credencial inválida', () => {
    const e = new TypeError('Cannot convert argument to a ByteString because the character at index 7 has a value of 8212 which is greater than 255.')
    expect(classificarErro(e)).toEqual({ codigo: 'CREDENCIAL_INVALIDA' })
  })

  it('falha de rede: preserva o código técnico da causa', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED']) {
      const e = new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} 10.0.0.1:443 ${TOKEN}`), { code }) })
      expect(classificarErro(e)).toEqual({ codigo: 'ERRO_REDE', causa: code })
      expect(descricaoSegura(e)).toBe(`ERRO_REDE ${code}`)
      semSegredo(descricaoSegura(e))
    }
    expect(classificarErro(new TypeError('fetch failed'))).toEqual({ codigo: 'ERRO_REDE' })
    expect(classificarErro(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toEqual({ codigo: 'ERRO_REDE', causa: 'TEMPO_ESGOTADO' })
  })

  it('erro HTTP montado pelo próprio sistema: preserva status e operação, e só se a mensagem INTEIRA casar', () => {
    expect(classificarErro(new Error('postgrest POST radar_source_record http 503'))).toEqual({ codigo: 'ERRO_HTTP', http: 503, operacao: 'postgrest POST radar_source_record' })
    expect(classificarErro(new Error('rpc inbox_ingest http 401'))).toEqual({ codigo: 'ERRO_HTTP', http: 401, operacao: 'rpc inbox_ingest' })
    expect(descricaoSegura(new Error('postgrest GET inbox_thread http 500'))).toBe('ERRO_HTTP 500 (postgrest GET inbox_thread)')
    // mensagem com algo a mais: aproveita só os três dígitos, nunca o resto
    const e = new Error(`postgrest GET inbox_thread http 403 apikey=${TOKEN}`)
    expect(classificarErro(e)).toEqual({ codigo: 'ERRO_HTTP', http: 403 })
    semSegredo(descricaoSegura(e))
    expect(classificarErro(new Error('postgrest http 503'))).toEqual({ codigo: 'ERRO_HTTP', http: 503 })
  })

  it('aceita o que não é Error sem lançar: texto, número, null, objeto hostil', () => {
    for (const v of [TOKEN, 42, null, undefined, {}, { message: 7 }, { get message() { throw new Error(TOKEN) } }]) {
      const c = classificarErro(v)
      expect(CODIGOS_DE_ERRO).toContain(c.codigo)
      semSegredo(c)
    }
  })

  it('ErroDeCredencial e erro já classificado passam com o próprio código', () => {
    expect(classificarErro(new ErroDeCredencial('CREDENCIAL_AUSENTE', 'X'))).toEqual({ codigo: 'CREDENCIAL_AUSENTE' })
    expect(classificarErro({ erroSeguro: erroHttp(429, 'rpc x') })).toEqual({ codigo: 'ERRO_HTTP', http: 429, operacao: 'rpc x' })
    // um `erroSeguro` forjado com texto livre não é aceito como tal
    expect(classificarErro({ erroSeguro: { codigo: 'ERRO_HTTP', causa: TOKEN } })).toEqual({ codigo: 'SEM_CODIGO' })
    expect(classificarErro({ erroSeguro: { codigo: TOKEN } })).toEqual({ codigo: 'SEM_CODIGO' })
  })
})

describe('textoDoErro · montado só com os campos seguros', () => {
  it('formatos', () => {
    expect(textoDoErro({ codigo: 'SEM_CODIGO' })).toBe('SEM_CODIGO')
    expect(textoDoErro({ codigo: 'ERRO_HTTP', http: 401 })).toBe('ERRO_HTTP 401')
    expect(textoDoErro({ codigo: 'ERRO_REDE', causa: 'ECONNRESET' })).toBe('ERRO_REDE ECONNRESET')
    expect(textoDoErro({ codigo: 'ERRO_HTTP', http: 500, operacao: 'rpc inbox_ingest' })).toBe('ERRO_HTTP 500 (rpc inbox_ingest)')
  })

  it('o catálogo de causas é fechado e contém as que o diagnóstico de 10/11/2026 precisou', () => {
    for (const c of ['UND_ERR_INVALID_ARG', 'ECONNREFUSED', 'CAUSA_NAO_CATALOGADA', 'TEMPO_ESGOTADO']) expect(CAUSAS_CONHECIDAS.has(c)).toBe(true)
    for (const c of CAUSAS_CONHECIDAS) expect(c).toMatch(/^[A-Z][A-Z0-9_]+$/)
  })
})

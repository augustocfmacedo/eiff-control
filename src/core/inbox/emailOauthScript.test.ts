// E-mail comercial, etapa E5: o script local de consentimento OAuth. Aqui se testam as partes puras e as guardas do
// script. O consentimento em si NUNCA é executado na suíte (nem pelo assistente): não há rede nem navegador aqui.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — helper .mjs do script (sem tipos)
import { AUTORIZACAO_URL, ESCOPO, TOKEN_URL, conferirTroca, corpoDaTroca, lerRetorno, novoDesafio, pareceClientId, redirectUri, resumoDoSegredo, urlDeConsentimento } from '../../../scripts/lib/emailOauth.mjs'

const raiz = path.resolve(__dirname, '../../..')
const SCRIPT = path.join(raiz, 'scripts/email-oauth-consentimento.mjs')
const fonte = fs.readFileSync(SCRIPT, 'utf8')

describe('pedido de consentimento', () => {
  it('pede UM escopo, o de envio, com acesso offline, consentimento forçado e PKCE', () => {
    const u = new URL(urlDeConsentimento({ clientId: '123-abc.apps.googleusercontent.com', porta: 53123, desafio: 'DESAFIO', state: 'STATE' }))
    expect(`${u.origin}${u.pathname}`).toBe(AUTORIZACAO_URL)
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '123-abc.apps.googleusercontent.com', redirect_uri: 'http://127.0.0.1:53123', response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
      code_challenge: 'DESAFIO', code_challenge_method: 'S256', state: 'STATE', login_hint: 'contato@eiff.com.br',
    })
    expect(ESCOPO).toBe('https://www.googleapis.com/auth/gmail.send')
    expect(u.searchParams.get('scope')).not.toMatch(/readonly|modify|compose|mail\.google\.com|settings/)
  })
  it('o retorno é sempre o loopback desta máquina, nunca um endereço público', () => {
    expect(redirectUri(8123)).toBe('http://127.0.0.1:8123')
    expect(fonte).toContain('servidor.listen(0, HOST_LOOPBACK')
    expect(fonte).not.toMatch(/0\.0\.0\.0|localhost:\d|https?:\/\/(?!127\.0\.0\.1)[a-z0-9.-]+\/callback/i)
  })
  it('desafio PKCE: verificador e state aleatórios, desafio = SHA-256 do verificador', () => {
    const a = novoDesafio(); const b = novoDesafio()
    expect(a.verificador).not.toBe(b.verificador)
    expect(a.state).not.toBe(b.state)
    expect(a.verificador).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(a.desafio).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const fixo = novoDesafio((n: number) => Buffer.alloc(n, 1))
    expect(fixo).toEqual(novoDesafio((n: number) => Buffer.alloc(n, 1)))
  })
})

describe('retorno do Google no loopback', () => {
  it('só aceita código com o state deste pedido', () => {
    expect(lerRetorno('/?state=S&code=C', 'S')).toEqual({ ok: true, codigo: 'C' })
    expect(lerRetorno('/?state=OUTRO&code=C', 'S')).toMatchObject({ ok: false })
    expect(lerRetorno('/?code=C', 'S')).toMatchObject({ ok: false })
    expect(lerRetorno('/?state=S', 'S')).toMatchObject({ ok: false, motivo: 'retorno sem código de autorização' })
    expect(lerRetorno('/?error=access_denied&state=S', 'S')).toMatchObject({ ok: false, motivo: 'consentimento negado na tela do Google' })
  })
  it('pedido a outro caminho (favicon, sonda) é ignorado sem consumir o consentimento', () => {
    expect(lerRetorno('/favicon.ico', 'S')).toMatchObject({ ok: false, ignorar: true })
  })
})

describe('troca do código pelo token', () => {
  it('manda o verificador PKCE e o mesmo redirect do pedido', () => {
    const c = new URLSearchParams(corpoDaTroca({ clientId: 'id', clientSecret: 'seg', codigo: 'C', verificador: 'V', porta: 8123 }))
    expect(Object.fromEntries(c)).toEqual({ grant_type: 'authorization_code', client_id: 'id', client_secret: 'seg', code: 'C', code_verifier: 'V', redirect_uri: 'http://127.0.0.1:8123' })
  })
  it('só serve com token de atualização E escopo exatamente igual ao de envio', () => {
    expect(conferirTroca(200, { refresh_token: 'RT', scope: ESCOPO, access_token: 'AT' })).toEqual({ ok: true, refreshToken: 'RT' })
    expect(conferirTroca(200, { scope: ESCOPO, access_token: 'AT' })).toMatchObject({ ok: false, revogar: true })
    expect(conferirTroca(200, { refresh_token: 'RT', scope: `${ESCOPO} https://www.googleapis.com/auth/gmail.readonly` })).toMatchObject({ ok: false, revogar: true })
    expect(conferirTroca(200, { refresh_token: 'RT', scope: 'https://mail.google.com/' })).toMatchObject({ ok: false, revogar: true })
    expect(conferirTroca(200, { refresh_token: 'RT' })).toMatchObject({ ok: false })
    expect(conferirTroca(400, { error: 'invalid_grant' })).toEqual({ ok: false, motivo: 'o Google recusou a troca do código (invalid_grant)' })
    expect(conferirTroca(500, null)).toMatchObject({ ok: false })
  })
  it('recusa nunca repete o token nem a descrição livre do Google', () => {
    const r = conferirTroca(200, { refresh_token: 'TOKEN-SECRETO', scope: 'outro', error_description: 'texto livre' })
    expect(JSON.stringify(r)).not.toMatch(/TOKEN-SECRETO|texto livre/)
  })
  it('do segredo só se mostra tamanho e os 4 últimos caracteres; o ID de cliente tem forma conferida', () => {
    expect(resumoDoSegredo('1//0abcdefghijklmnopqrstuvwxyzWXYZ')).toBe('34 caracteres, termina em …WXYZ')
    expect(pareceClientId('1234567890-abc123def.apps.googleusercontent.com')).toBe(true)
    for (const x of ['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do', '', 'contato@eiff.com.br']) expect(pareceClientId(x)).toBe(false)
  })
})

describe('guardas do script', () => {
  it('fora de terminal interativo ele RECUSA e sai sem abrir servidor nem falar com o Google', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { input: '', encoding: 'utf8', timeout: 20_000 })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('só roda em terminal interativo')
    expect(r.stdout).not.toContain('accounts.google.com')
  })
  it('não grava em disco, não lê variável de ambiente e só fala com o endpoint de token do Google', () => {
    expect(fonte).not.toMatch(/from 'node:fs'|writeFile|appendFile|createWriteStream/)
    expect(fonte).not.toMatch(/process\.env/)
    const hosts = [...`${fonte}\n${fs.readFileSync(path.join(raiz, 'scripts/lib/emailOauth.mjs'), 'utf8')}`.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1])
    expect([...new Set(hosts)].sort()).toEqual(['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'])
    expect(TOKEN_URL).toBe('https://oauth2.googleapis.com/token')
  })
  it('por padrão o token vai para a área de transferência; só é impresso com --mostrar', () => {
    const imprime = fonte.split('\n').filter((l) => l.includes('console.log(troca.refreshToken)'))
    expect(imprime).toHaveLength(1)
    expect(fonte.indexOf('if (mostrar) {')).toBeLessThan(fonte.indexOf('console.log(troca.refreshToken)'))
    expect(fonte).toContain('resumoDoSegredo(troca.refreshToken)')
    expect(fonte).not.toMatch(/console\.log\([^)]*clientSecret/)
  })
  it('o script não envia e-mail', () => {
    expect(fonte).not.toMatch(/messages\/send|gmail\/v1/)
  })
})

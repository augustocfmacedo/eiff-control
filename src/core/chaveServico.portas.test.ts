// Ressalvas A e B da revisão do PR #95 (S1/R1, 24/11/2026), obrigatórias antes da R4.
// A: um JWT legado de outro papel (a `anon` colada no lugar da de serviço) nunca é aceito como chave de serviço.
// B: as quatro portas que não tinham teste de cabeçalho (vibe, widget-caixa, diretor-financeiro e a RPC de entrega do
//    canaisServidor) mandam, com a chave LEGADA, EXATAMENTE `apikey` + `Authorization: Bearer <a mesma>` (valor conferido,
//    não só a presença) e, com a NOVA, só `apikey`; o JWT do usuário continua indo com a chave anônima.
// Nenhuma credencial real e nenhuma rede: todas as chaves são fictícias e o fetch só registra o que seria enviado.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chaveServicoValida, ErroChaveServico, tipoChaveServico } from './chaveServico'
import { rpcEntrega } from './radar/canaisServidor'
import widgetCaixa from '../../netlify/functions/widget-caixa'
import diretorFinanceiro from '../../netlify/functions/diretor-financeiro'
import vibe from '../../netlify/functions/vibe'

/** JWT fictício (assinatura falsa) com o payload pedido. */
const jwt = (payload: unknown) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.ZmljdGljaWE`
const LEGADA = jwt({ iss: 'supabase', ref: 'ficticio', role: 'service_role' })
const ANON_LEGADA = jwt({ iss: 'supabase', ref: 'ficticio', role: 'anon' })
const SECRETA = 'sb_secret_FICTICIA0123456789abcdefABCDEF'
const URL_BANCO = 'https://banco.exemplo.invalido'
const TOKEN_USUARIO = 'jwt-do-usuario'

describe('ressalva A: JWT legado de outro papel não é chave de serviço', () => {
  it('a anon legada é recusada com motivo próprio e sem o valor na mensagem', () => {
    expect(chaveServicoValida(ANON_LEGADA)).toBe(false)
    try { tipoChaveServico(ANON_LEGADA); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(ErroChaveServico)
      expect((e as ErroChaveServico).motivo).toBe('papel_nao_servico')
      expect((e as Error).message).not.toContain(ANON_LEGADA)
    }
  })
  it('authenticated, papel ausente e payload ilegível também são recusados', () => {
    expect(() => tipoChaveServico(jwt({ role: 'authenticated' }))).toThrow(ErroChaveServico)
    expect(() => tipoChaveServico(jwt({ iss: 'supabase' }))).toThrow(ErroChaveServico)
    expect(() => tipoChaveServico(jwt(['service_role']))).toThrow(ErroChaveServico)
    // payload "nao-e-json" e payload "null": formato desconhecido, nunca legada
    for (const ilegivel of ['eyJhbGciOiJIUzI1NiJ9.bmFvLWUtanNvbg.x', 'eyJhbGciOiJIUzI1NiJ9.bnVsbA.x']) {
      try { tipoChaveServico(ilegivel); expect.unreachable() } catch (e) { expect((e as ErroChaveServico).motivo).toBe('formato_desconhecido') }
    }
    // valor que não é JWT nem sb_ segue o caminho antigo (chaves fictícias dos testes; a Supabase recusa com 401)
    expect(tipoChaveServico('CHAVE-DE-SERVICO')).toBe('legada')
  })
  it('a service_role legada continua aceita, com espaços em volta inclusive', () => {
    expect(tipoChaveServico(LEGADA)).toBe('legada')
    expect(tipoChaveServico(`  ${LEGADA}\n`)).toBe('legada')
  })
  it('as portas recusam a anon antes de qualquer chamada', async () => {
    const { f, pedidos } = gravador()
    expect(await rpcEntrega('radar_delivery_create', {}, { fetch: f, supabaseUrl: URL_BANCO, anon: 'ANON', serviceKey: ANON_LEGADA })).toBeUndefined()
    vi.stubGlobal('fetch', f)
    vi.stubEnv('SUPABASE_URL', URL_BANCO)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ANON_LEGADA)
    const r = await widgetCaixa(new Request('https://x/api/widget-caixa', { headers: { authorization: `Bearer eiffw_${'a'.repeat(64)}` } }))
    expect(r.status).toBe(501)
    expect(pedidos).toHaveLength(0)
  })
})

interface Pedido { url: string; metodo: string; cab: Record<string, string> }
/** fetch que só registra (nenhuma rede); `resposta` decide o corpo pela URL. */
function gravador(resposta: (url: string) => unknown = () => ({})) {
  const pedidos: Pedido[] = []
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    const h = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined))
    const cab: Record<string, string> = {}
    h.forEach((v, k) => { cab[k] = v })
    pedidos.push({ url, metodo: init?.method ?? (entrada instanceof Request ? entrada.method : 'GET'), cab })
    return new Response(JSON.stringify(resposta(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, pedidos }
}

/** Cabeçalhos de autenticação (só apikey e authorization) de um pedido. */
const auth = (p: Pedido) => Object.fromEntries(Object.entries(p.cab).filter(([k]) => k === 'apikey' || k === 'authorization'))
/** O que a chave de serviço tem de produzir no banco: legada = os dois iguais; nova = só apikey. */
const esperado = (chave: string) => (chave === LEGADA ? { apikey: LEGADA, authorization: `Bearer ${LEGADA}` } : { apikey: SECRETA })

const porChave = [['legada', LEGADA], ['nova', SECRETA]] as const

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('ressalva B: cabeçalhos exatos das portas sem teste', () => {
  it.each(porChave)('RPC de entrega do canaisServidor (%s)', async (_n, chave) => {
    const { f, pedidos } = gravador(() => ({ id: 'd1' }))
    await rpcEntrega('radar_delivery_create', { p_user_id: 'u' }, { fetch: f, supabaseUrl: URL_BANCO, anon: 'ANON', serviceKey: chave })
    await rpcEntrega('radar_delivery_transition', { p_user_id: 'u' }, { fetch: f, supabaseUrl: URL_BANCO, anon: 'ANON', serviceKey: chave })
    expect(pedidos.map((p) => p.url)).toEqual([`${URL_BANCO}/rest/v1/rpc/radar_delivery_create`, `${URL_BANCO}/rest/v1/rpc/radar_delivery_transition`])
    for (const p of pedidos) { expect(auth(p)).toEqual(esperado(chave)); expect(p.cab['content-type']).toBe('application/json') }
  })

  it.each(porChave)('widget-caixa: RPC widget_token_validar e leitura pelo supabase-js (%s)', async (_n, chave) => {
    const { f, pedidos } = gravador((url) => url.includes('widget_token_validar') ? { ok: true, perfil_id: 'p1', token_id: 't1', nome: 'iPad' } : [])
    vi.stubGlobal('fetch', f)
    vi.stubEnv('SUPABASE_URL', URL_BANCO)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', chave)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await widgetCaixa(new Request('https://x/api/widget-caixa', { headers: { authorization: `Bearer eiffw_${'a'.repeat(64)}` } }))
    expect(pedidos[0].url).toBe(`${URL_BANCO}/rest/v1/rpc/widget_token_validar`)
    const banco = pedidos.filter((p) => p.url.startsWith(`${URL_BANCO}/rest/v1/`))
    expect(banco.length).toBeGreaterThan(1) // a RPC e ao menos uma leitura do carregamento
    for (const p of banco) expect(auth(p)).toEqual(esperado(chave))
    // o token do aparelho nunca vai ao banco no cabeçalho
    for (const p of pedidos) expect(JSON.stringify(p.cab)).not.toContain('eiffw_')
  })

  it.each(porChave)('diretor-financeiro (veredito): sessão com a anônima, carga com a de serviço (%s)', async (_n, chave) => {
    const { f, pedidos } = gravador((url) => url.includes('/auth/v1/user') ? { id: 'u1' } : url.includes('df_contexto') ? {} : [])
    vi.stubGlobal('fetch', f)
    vi.stubEnv('SUPABASE_URL', URL_BANCO)
    vi.stubEnv('SUPABASE_ANON_KEY', 'ANON')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', chave)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await diretorFinanceiro(new Request('https://x/api/diretor-financeiro', { method: 'POST', headers: { authorization: `Bearer ${TOKEN_USUARIO}`, 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'veredicto', pedido: { valor: 500, vencimento: '2026-12-01' } }) }))
    const usuario = pedidos.filter((p) => p.cab['authorization'] === `Bearer ${TOKEN_USUARIO}`)
    expect(usuario.map((p) => new URL(p.url).pathname)).toEqual(['/auth/v1/user', '/rest/v1/rpc/df_contexto'])
    for (const p of usuario) expect(p.cab['apikey']).toBe('ANON')
    const servico = pedidos.filter((p) => p.cab['apikey'] === chave)
    expect(servico.length).toBeGreaterThan(0)
    for (const p of servico) expect(auth(p)).toEqual(esperado(chave))
    expect(pedidos.length).toBe(usuario.length + servico.length) // nenhum pedido com outra combinação
  })

  it.each(porChave)('vibe (cancelar): leitura com o JWT do usuário, RPC mutável com a de serviço (%s)', async (_n, chave) => {
    const { f, pedidos } = gravador((url) => url.includes('/auth/v1/user') ? { id: 'u1' } : url.includes('/rest/v1/profile') ? [{ role: 'Administrador', organization_id: 'o' }] : { ok: true })
    vi.stubGlobal('fetch', f)
    vi.stubEnv('SUPABASE_URL', URL_BANCO)
    vi.stubEnv('SUPABASE_ANON_KEY', 'ANON')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', chave)
    vi.stubEnv('VIBE_API_KEY', '')
    await vibe(new Request('https://x/api/vibe', { method: 'POST', headers: { authorization: `Bearer ${TOKEN_USUARIO}`, 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'cancelar', operationId: 'op1' }) }))
    expect(pedidos.map((p) => new URL(p.url).pathname)).toEqual(['/auth/v1/user', '/rest/v1/profile', '/rest/v1/rpc/update_vibe_operation'])
    for (const p of pedidos.slice(0, 2)) expect(auth(p)).toEqual({ apikey: 'ANON', authorization: `Bearer ${TOKEN_USUARIO}` })
    expect(auth(pedidos[2])).toEqual(esperado(chave))
  })
})

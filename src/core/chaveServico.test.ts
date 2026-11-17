// S1/R1 — a mesma regra de cabeçalhos para a chave LEGADA (JWT) e a NOVA (sb_secret_…), com falha fechada para chave
// publicável ou formato desconhecido. Nenhuma credencial real: todas as chaves aqui são fictícias.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cabecalhosAuthAdmin, cabecalhosServico, chaveServicoValida, ErroChaveServico, fetchServico, tipoChaveServico } from './chaveServico'
import { clienteServidor } from '../data/clienteServidor'
import { portaLivro } from './inbox/emailPorta'
import { configPortaIngest, portaIngestRpc } from './inbox/ingestaoPorta'
import { portaAplicarRoteamentoRpc } from './inbox/roteamentoPorta'
import { montarPortasIntegracao, portasFormularioRest } from './radar/formularioPorta'
import { tratarUsuarios } from './usuariosServidor'

const LEGADA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.ZmljdGljaWFfbmFvX2VfdW1hX2NoYXZl'
const SECRETA = 'sb_secret_FICTICIA0123456789abcdefABCDEF'
const PUBLICAVEL = 'sb_publishable_FICTICIA0123456789abcdef'
const URL_BANCO = 'https://banco.exemplo.invalido'

interface Pedido { url: string; metodo: string; cab: Record<string, string> }
/** fetch que só registra o que seria enviado (nenhuma rede) e devolve uma resposta mínima. */
function gravador(resposta: (url: string) => unknown = () => ({ ok: true })) {
  const pedidos: Pedido[] = []
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    const h = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined))
    const cab: Record<string, string> = {}
    h.forEach((v, k) => { cab[k] = v })
    pedidos.push({ url, metodo: init?.method ?? 'GET', cab })
    return new Response(JSON.stringify(resposta(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, pedidos }
}

describe('tipo da chave de serviço', () => {
  it('legada (JWT) e qualquer valor que não comece por sb_ seguem o caminho antigo', () => {
    expect(tipoChaveServico(LEGADA)).toBe('legada')
    expect(tipoChaveServico('CHAVE-DE-SERVICO')).toBe('legada')
    expect(tipoChaveServico(`  ${LEGADA}  `)).toBe('legada')
  })
  it('sb_secret_ é a chave nova', () => { expect(tipoChaveServico(SECRETA)).toBe('secreta') })
  it('falha fechada: vazia, publicável, sb_temp e sb_ desconhecido', () => {
    for (const [v, motivo] of [['', 'ausente'], ['   ', 'ausente'], [undefined, 'ausente'], [PUBLICAVEL, 'publicavel'], ['sb_temp_abc12345678', 'formato_desconhecido'], ['sb_outro_abc12345678', 'formato_desconhecido'], ['sb_secret_', 'formato_desconhecido']] as const) {
      expect(() => tipoChaveServico(v)).toThrow(ErroChaveServico)
      try { tipoChaveServico(v) } catch (e) { expect((e as ErroChaveServico).motivo).toBe(motivo) }
      expect(chaveServicoValida(v)).toBe(false)
    }
  })
  it('a mensagem de erro nunca contém o valor da chave', () => {
    try { tipoChaveServico(PUBLICAVEL) } catch (e) { expect(String((e as Error).message)).not.toContain('FICTICIA') }
  })
})

describe('cabeçalhos', () => {
  it('legada: apikey + Authorization, exatamente como antes', () => {
    expect(cabecalhosServico(LEGADA, { 'content-type': 'application/json' })).toEqual({ apikey: LEGADA, authorization: `Bearer ${LEGADA}`, 'content-type': 'application/json' })
    expect(cabecalhosAuthAdmin(LEGADA)).toEqual({ apikey: LEGADA, authorization: `Bearer ${LEGADA}` })
  })
  it('nova: banco só com apikey; Auth admin com Authorization IDÊNTICO ao apikey', () => {
    expect(cabecalhosServico(SECRETA, { accept: 'application/json' })).toEqual({ apikey: SECRETA, accept: 'application/json' })
    const a = cabecalhosAuthAdmin(SECRETA)
    expect(a.authorization).toBe(`Bearer ${a.apikey}`)
  })
  it('publicável nunca vira cabeçalho', () => {
    expect(() => cabecalhosServico(PUBLICAVEL)).toThrow(ErroChaveServico)
    expect(() => cabecalhosAuthAdmin(PUBLICAVEL)).toThrow(ErroChaveServico)
  })
})

describe('fetchServico (supabase-js do servidor)', () => {
  it('legada: devolve o próprio fetch, sem mexer em nada', () => {
    const { f } = gravador()
    expect(fetchServico(LEGADA, f)).toBe(f)
  })
  it('nova: tira o Authorization igual à chave das chamadas ao banco; mantém no Auth e mantém JWT de usuário', async () => {
    const { f, pedidos } = gravador()
    const g = fetchServico(SECRETA, f)
    await g(`${URL_BANCO}/rest/v1/x`, { headers: { apikey: SECRETA, authorization: `Bearer ${SECRETA}` } })
    await g(`${URL_BANCO}/auth/v1/admin/users`, { headers: { apikey: SECRETA, authorization: `Bearer ${SECRETA}` } })
    await g(`${URL_BANCO}/rest/v1/y`, { headers: { apikey: SECRETA, authorization: 'Bearer jwt-do-usuario' } })
    expect(pedidos[0].cab['authorization']).toBeUndefined()
    expect(pedidos[0].cab['apikey']).toBe(SECRETA)
    expect(pedidos[1].cab['authorization']).toBe(`Bearer ${SECRETA}`)
    expect(pedidos[2].cab['authorization']).toBe('Bearer jwt-do-usuario')
  })
  it('clienteServidor real (supabase-js 2.114): nova sem Authorization no banco; legada com; publicável recusada', async () => {
    const nova = gravador(() => [])
    await clienteServidor(URL_BANCO, SECRETA, nova.f).from('profile').select('id').limit(1)
    expect(nova.pedidos).toHaveLength(1)
    expect(nova.pedidos[0].cab['apikey']).toBe(SECRETA)
    expect(nova.pedidos[0].cab['authorization']).toBeUndefined()
    const legada = gravador(() => [])
    await clienteServidor(URL_BANCO, LEGADA, legada.f).from('profile').select('id').limit(1)
    expect(legada.pedidos[0].cab['authorization']).toBe(`Bearer ${LEGADA}`)
    expect(() => clienteServidor(URL_BANCO, PUBLICAVEL)).toThrow(ErroChaveServico)
  })
})

describe('portas privilegiadas com as duas chaves', () => {
  const porChave = [['legada', LEGADA, true], ['nova', SECRETA, false]] as const
  it.each(porChave)('livro do e-mail (%s)', async (_n, chave, comBearer) => {
    const { f, pedidos } = gravador(() => ({ ok: false, erro: 'x' }))
    await portaLivro({ url: URL_BANCO, chave }, f).transicionar('e', 'FAILED', { atorId: 'a', motivo: 'mensagem_invalida' })
    expect(pedidos[0].cab['apikey']).toBe(chave)
    expect('authorization' in pedidos[0].cab).toBe(comBearer)
  })
  it.each(porChave)('ingestão do Inbox (%s)', async (_n, chave, comBearer) => {
    const { f, pedidos } = gravador(() => ({ ok: true }))
    await portaIngestRpc({ url: URL_BANCO, chave }, f)({} as never).catch(() => undefined)
    expect(pedidos[0].cab['apikey']).toBe(chave)
    expect('authorization' in pedidos[0].cab).toBe(comBearer)
  })
  it.each(porChave)('roteamento do Inbox (%s)', async (_n, chave, comBearer) => {
    const { f, pedidos } = gravador(() => ({ ok: true }))
    await portaAplicarRoteamentoRpc({ url: URL_BANCO, chave, organizacaoId: 'o' }, f)({ threadId: 't', routing: {}, priority: 'NORMAL', serviceLevel: 'C', apply: false } as never).catch(() => undefined)
    expect(pedidos[0].cab['apikey']).toBe(chave)
    expect('authorization' in pedidos[0].cab).toBe(comBearer)
  })
  it.each(porChave)('formulário do site (%s)', async (_n, chave, comBearer) => {
    const { f, pedidos } = gravador(() => [])
    const portas = portasFormularioRest({ url: URL_BANCO, chave, organizacaoId: 'o', fonteId: 'f' }, f)
    await portas.fonte('f').catch(() => undefined)
    expect(pedidos.length).toBeGreaterThan(0)
    for (const p of pedidos) { expect(p.cab['apikey']).toBe(chave); expect('authorization' in p.cab).toBe(comBearer) }
  })
  it.each(porChave)('usuários: banco com ou sem Bearer conforme a chave; Auth admin sempre com Authorization igual ao apikey (%s)', async (_n, chave, comBearer) => {
    const { f, pedidos } = gravador((url) => url.includes('/auth/v1/user') ? { id: 'u1' }
      : url.includes('/rest/v1/profile') ? [{ id: 'u1', role: 'Administrador', active: true, organization_id: 'o', name: 'A', email: 'a@x' }]
        : url.includes('/auth/v1/admin/users') ? { users: [] } : [])
    await tratarUsuarios({ token: 'jwt-do-usuario', corpo: { acao: 'listar' } }, f, { url: URL_BANCO, anon: 'ANON', service: chave, site: 'https://x' })
    const servico = pedidos.filter((p) => p.cab['apikey'] === chave)
    expect(servico.length).toBeGreaterThan(0)
    for (const p of servico) {
      if (p.url.includes('/auth/v1/')) expect(p.cab['authorization']).toBe(`Bearer ${chave}`)
      else expect('authorization' in p.cab).toBe(comBearer)
    }
    // o JWT do usuário continua indo com a chave ANÔNIMA, nunca com a de serviço
    const usuario = pedidos.filter((p) => p.cab['authorization'] === 'Bearer jwt-do-usuario')
    expect(usuario.length).toBeGreaterThan(0)
    for (const p of usuario) expect(p.cab['apikey']).toBe('ANON')
  })
})

describe('falha fechada com chave publicável no lugar da de serviço', () => {
  it('ingestão: configuração recusada', () => {
    expect(configPortaIngest({ SUPABASE_SERVICE_ROLE_KEY: PUBLICAVEL, EIFF_INBOX_ORGANIZATION_ID: 'o' })).toEqual({ motivo: 'SUPABASE_SERVICE_ROLE_KEY nao e chave de servico' })
  })
  it('formulário: integração não monta portas e o motivo não carrega o valor', () => {
    const { f, pedidos } = gravador()
    const r = montarPortasIntegracao({ SUPABASE_SERVICE_ROLE_KEY: PUBLICAVEL, EIFF_INBOX_ORGANIZATION_ID: 'o', EIFF_FORM_SOURCE_ID: 'f', EIFF_INBOX_ENABLED: 'true' } as never, { fetch: f })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('FICTICIA')
    expect(pedidos).toHaveLength(0)
  })
  it('usuários: 501 sem nenhuma chamada', async () => {
    const { f, pedidos } = gravador()
    const r = await tratarUsuarios({ token: 'jwt', corpo: { acao: 'listar' } }, f, { url: URL_BANCO, anon: 'ANON', service: PUBLICAVEL, site: 'https://x' })
    expect(r.status).toBe(501)
    expect(pedidos).toHaveLength(0)
  })
  it('livro do e-mail: a porta não chama nada e o handler vê livro_indisponivel', async () => {
    const { f, pedidos } = gravador()
    const r = await portaLivro({ url: URL_BANCO, chave: PUBLICAVEL }, f).criar({ organizacaoId: 'o', threadId: 't', contatoId: 'c', solicitanteId: 's', solicitanteNome: 'n', intencao: 'i', impressao: 'p', texto: 'x', limiteUsuario: 1, limiteOrganizacao: 1 })
    expect(r).toEqual({ ok: false, erro: 'livro_indisponivel' })
    expect(pedidos).toHaveLength(0)
  })
})

describe('guarda: nenhuma chamada nova monta à mão a chave de serviço nos dois cabeçalhos', () => {
  it('apikey e Authorization com a MESMA variável só existem em chaveServico.ts', () => {
    const raiz = path.resolve(__dirname, '../..')
    const arquivos: string[] = []
    const varrer = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) varrer(p); else if (/\.(ts|mts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) arquivos.push(p) } }
    varrer(path.join(raiz, 'src')); varrer(path.join(raiz, 'netlify'))
    const mesmo = /apikey:\s*([\w.]+)\s*,\s*authorization:\s*`Bearer \$\{([\w.]+)\}`/g
    const achados: string[] = []
    for (const a of arquivos) {
      if (a.endsWith('chaveServico.ts')) continue
      for (const m of fs.readFileSync(a, 'utf8').matchAll(mesmo)) if (m[1] === m[2]) achados.push(`${path.relative(raiz, a)}: ${m[0]}`)
    }
    expect(achados).toEqual([])
  })
})

describe('guarda: credencial real fora dos testes, do CI e do repositório', () => {
  const raiz = path.resolve(__dirname, '../..')
  const script = path.join(raiz, 'scripts/s1/validar-chave-secreta.mjs')

  it('nenhum arquivo versionado tem chave sb_ que não seja marcada como fictícia ou de controle', () => {
    const achados: string[] = []
    const varrer = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', 'dados', 'scratch', '.netlify', '.claude'].includes(e.name)) continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) varrer(p)
        else if (/\.(ts|mts|tsx|mjs|cjs|js|json|yml|yaml|toml|md|sql|env|txt)$/.test(e.name) || e.name.startsWith('.env')) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/g)) {
            if (!/FICTICIA|CONTROLE/.test(m[0])) achados.push(`${path.relative(raiz, p)}: ${m[0].slice(0, 18)}…`)
          }
        }
      }
    }
    varrer(raiz)
    expect(achados).toEqual([])
  })

  it('o CI nunca roda o script da R3 nem recebe chave sb_secret', () => {
    const dir = path.join(raiz, '.github/workflows')
    for (const f of fs.readdirSync(dir)) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8')
      expect(t).not.toMatch(/scripts\/s1\/|validar-chave-secreta|EIFF_SB_SECRET|sb_secret/)
    }
    const pkg = fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/validar-chave-secreta|scripts\/s1\//)
  })

  const ler = (f: string) => fs.readFileSync(path.join(raiz, 'scripts/s1', f), 'utf8')
  const semSaidaDaChave = (t: string) => {
    for (const linha of t.split('\n').filter((l) => /console\.(log|error)|stdout\.write/.test(l))) expect(linha).not.toMatch(/\$\{chave|\(chave\)|, chave\)/)
  }

  it('entrada da chave: só teclado de terminal interativo, sem variável de ambiente nem argumento', () => {
    const lib = ler('entradaOculta.mjs')
    expect(lib).toMatch(/process\.stdin\.isTTY/)
    expect(lib).toMatch(/setRawMode\(true\)/)
    for (const f of ['entradaOculta.mjs', 'validar-chave-secreta.mjs', 'ensaio-auth-escrita.mjs']) expect(ler(f)).not.toMatch(/process\.env/)
    for (const f of ['validar-chave-secreta.mjs', 'ensaio-auth-escrita.mjs']) {
      expect(ler(f)).toMatch(/import \{ lerOculto \} from '\.\/entradaOculta\.mjs'/)
      expect(ler(f)).not.toMatch(/argv[^\n]*(chave|secret)/i)
      semSaidaDaChave(ler(f))
    }
  })

  it('R3A em produção: só HEAD e GET, por uma única função de requisição', () => {
    const t = ler('validar-chave-secreta.mjs')
    expect(t.match(/\bfetch\(/g)).toHaveLength(1) // só dentro de ler()
    expect(t).toMatch(/if \(metodo !== 'GET' && metodo !== 'HEAD'\) throw/)
    expect(t).not.toMatch(/'(POST|PUT|PATCH|DELETE)'/)
    expect(t).not.toMatch(/body:/)
    expect(t).not.toMatch(/admin\/users',|\/invite|\/recover|delivery_transition|delivery_create|reserve_vibe|update_vibe|inbox_ingest|apply_routing/)
  })

  it('R3B (escrita no Auth) só roda no projeto descartável autorizado, ainda NÃO autorizado nesta versão', () => {
    const t = ler('ensaio-auth-escrita.mjs')
    // nenhum projeto autorizado: preencher exige commit revisado depois da aprovação da Direção
    expect(t).toMatch(/^const REF_AUTORIZADO = '';/m)
    expect(t).toMatch(/if \(!REF_AUTORIZADO\) recusar/)
    expect(t).toMatch(/if \(ref !== REF_AUTORIZADO\) recusar/)
    // todos os projetos operacionais da conta ficam fora, mesmo que a constante seja preenchida errado
    for (const r of ['dduobppgomqyagjviwpx', 'htromxizctbknkwqxuvc', 'cbulkfgkqkuwcckgfwqc', 'wxtozqtxrathmftxacen']) expect(t).toMatch(new RegExp(`OPERACIONAIS = \\[[^\\]]*'${r}'`))
    expect(t).toMatch(/OPERACIONAIS\.includes\(REF_AUTORIZADO\) \|\| OPERACIONAIS\.includes\(ref\)\) recusar/)
    expect(t).toMatch(/FRASE = 'ENSAIO_AUTH_DESCARTAVEL'/)
    expect(t).not.toMatch(/--url/)
    // ordem: portões → chave → requisições; projeto vazio antes da primeira escrita; limpeza conferida no PASS
    const i = (s: string) => t.indexOf(s)
    expect(i('if (!REF_AUTORIZADO) recusar')).toBeLessThan(i('lerOculto('))
    expect(i('lerOculto(')).toBeLessThan(i('await fetch('))
    expect(i("'0_projeto_vazio'")).toBeLessThan(i("'1_criar'"))
    expect(t).toMatch(/if \(pronto\) \{\s*const c = await etapa\('1_criar'/)
    expect(t).toMatch(/const ok = pronto && falhas === 0 && conferida/)
  })
})

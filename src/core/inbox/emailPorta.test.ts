// E-mail comercial, etapa E3: as portas reais com `fetch` simulado, e as guardas de fronteira. Nenhuma rede.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lerRespostaDoEnvio, lerRespostaDoToken } from './emailEnvio'
import { resolverDestinatario } from './emailServidor'
import { ESCOPO_GMAIL, GMAIL_SEND_URL, GOOGLE_TOKEN_URL, VARIAVEIS_GOOGLE, ambienteEmail, argsAceitar, argsCriar, argsTransicionar, entregaDoJson, modoEfetivo, portaGoogle, portaLivro, portaSessao, recusaDoLivro } from './emailPorta'

const SEGREDOS = { clientId: 'id-de-teste', clientSecret: 'SEGREDO-DO-CLIENTE', refreshToken: 'TOKEN-DE-ATUALIZACAO' }
const UID = 'aaaaaaaa-0000-4000-8000-000000000001'
const T1 = '11111111-1111-4111-8111-111111111111'
type Chamada = { url: string; init?: RequestInit }
const fetchDe = (responder: (url: string, init?: RequestInit) => Response | Promise<Response> | never) => {
  const chamadas: Chamada[] = []
  const f = (async (url: string, init?: RequestInit) => { chamadas.push({ url: String(url), init }); return responder(String(url), init) }) as unknown as typeof fetch
  return { f, chamadas }
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

describe('ambiente: desligado por padrão, com quatro chaves', () => {
  const TUDO = { EIFF_INBOX_OUTBOUND_ENABLED: 'true', EIFF_EMAIL_SEND_MODE: 'ativo', EIFF_EMAIL_SENDER: 'Contato@EIFF.com.br', GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REFRESH_TOKEN: 'c' }
  it('ambiente vazio: disabled, sem credencial, sem remetente, tetos da Direção', () => {
    expect(ambienteEmail({})).toEqual({ modo: 'disabled', canario: [], limiteUsuario: 30, limiteOrganizacao: 100, credenciais: false })
  })
  it('a chave geral de saída do Inbox desligada vence qualquer modo', () => {
    for (const saida of [undefined, '', 'false', '0', 'off']) expect(modoEfetivo({ EIFF_EMAIL_SEND_MODE: 'ativo', EIFF_INBOX_OUTBOUND_ENABLED: saida })).toBe('disabled')
    expect(modoEfetivo({ EIFF_EMAIL_SEND_MODE: 'canary', EIFF_INBOX_OUTBOUND_ENABLED: 'true' })).toBe('canary')
    expect(modoEfetivo({ EIFF_INBOX_OUTBOUND_ENABLED: 'true' })).toBe('disabled')
    expect(modoEfetivo({ EIFF_EMAIL_SEND_MODE: 'qualquer', EIFF_INBOX_OUTBOUND_ENABLED: 'true' })).toBe('disabled')
  })
  it('credenciais: só a presença das três; faltando uma, ausentes', () => {
    expect(ambienteEmail(TUDO)).toMatchObject({ modo: 'ativo', credenciais: true, remetente: 'contato@eiff.com.br' })
    for (const v of VARIAVEIS_GOOGLE) expect(ambienteEmail({ ...TUDO, [v]: '  ' }).credenciais).toBe(false)
  })
  it('o ambiente lido nunca carrega o valor de um segredo', () => {
    const a = JSON.stringify(ambienteEmail({ ...TUDO, GOOGLE_OAUTH_CLIENT_SECRET: 'SEGREDO-X', GOOGLE_OAUTH_REFRESH_TOKEN: 'TOKEN-Y', GOOGLE_OAUTH_CLIENT_ID: 'ID-Z' }))
    for (const s of ['SEGREDO-X', 'TOKEN-Y', 'ID-Z']) expect(a).not.toContain(s)
  })
  it('o escopo é só o de envio', () => {
    expect(ESCOPO_GMAIL).toBe('https://www.googleapis.com/auth/gmail.send')
  })
})

describe('porta do Google', () => {
  it('token: POST no endpoint do Google com grant de refresh; a resposta volta para o classificador', async () => {
    const { f, chamadas } = fetchDe(() => json({ access_token: 'tok', expires_in: 3599 }))
    const r = await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, f).token()
    expect(lerRespostaDoToken(r)).toEqual({ ok: true, accessToken: 'tok' })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].url).toBe(GOOGLE_TOKEN_URL)
    expect(chamadas[0].init?.method).toBe('POST')
    const corpo = new URLSearchParams(String(chamadas[0].init?.body))
    expect(Object.fromEntries(corpo)).toEqual({ grant_type: 'refresh_token', client_id: 'id-de-teste', client_secret: 'SEGREDO-DO-CLIENTE', refresh_token: 'TOKEN-DE-ATUALIZACAO' })
  })
  it('envio: POST em users/me/messages/send com Bearer e raw; threadId só quando há fio', async () => {
    const { f, chamadas } = fetchDe(() => json({ id: 'gm-1', threadId: 'gt-1' }))
    const g = portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, f)
    expect(lerRespostaDoEnvio(await g.enviar({ accessToken: 'tok', raw: 'UkFX', destino: 'a@b.com' }))).toMatchObject({ desfecho: 'ACCEPTED', providerMessageId: 'gm-1' })
    await g.enviar({ accessToken: 'tok', raw: 'UkFX', destino: 'a@b.com', providerThreadId: 'gt-1' })
    expect(chamadas.map((c) => c.url)).toEqual([GMAIL_SEND_URL, GMAIL_SEND_URL])
    expect((chamadas[0].init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual({ raw: 'UkFX' })
    expect(JSON.parse(String(chamadas[1].init?.body))).toEqual({ raw: 'UkFX', threadId: 'gt-1' })
    // o envio nunca leva o segredo do cliente nem o token de atualização
    expect(JSON.stringify(chamadas)).not.toMatch(/SEGREDO-DO-CLIENTE|TOKEN-DE-ATUALIZACAO/)
  })
  it('fail-closed na fronteira: disabled e destino fora do canário NÃO chegam ao fetch', async () => {
    const { f, chamadas } = fetchDe(() => json({ id: 'gm-1' }))
    const off = await portaGoogle({ ...SEGREDOS, modo: 'disabled', canario: ['a@b.com'] }, f).enviar({ accessToken: 'tok', raw: 'x', destino: 'a@b.com' })
    const fora = await portaGoogle({ ...SEGREDOS, modo: 'canary', canario: ['interno@eiff.com.br'] }, f).enviar({ accessToken: 'tok', raw: 'x', destino: 'a@b.com' })
    expect(chamadas).toHaveLength(0)
    expect(lerRespostaDoEnvio(off).desfecho).toBe('FAILED')
    expect(lerRespostaDoEnvio(fora).desfecho).toBe('FAILED')
    await portaGoogle({ ...SEGREDOS, modo: 'canary', canario: ['a@b.com'] }, f).enviar({ accessToken: 'tok', raw: 'x', destino: 'A@B.com' })
    expect(chamadas).toHaveLength(1)
  })
  it('rede e tempo esgotado viram resultado, nunca exceção; corpo não-JSON não quebra', async () => {
    expect(await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, fetchDe(() => { throw new TypeError('fetch failed') }).f).enviar({ accessToken: 't', raw: 'x', destino: 'a@b.com' })).toEqual({ tipo: 'rede' })
    const lento = (async (_u: string, init?: RequestInit) => new Promise((_ok, falha) => { init?.signal?.addEventListener('abort', () => falha(Object.assign(new Error('aborted'), { name: 'AbortError' }))) })) as unknown as typeof fetch
    expect(await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [], timeoutEnvioMs: 20, timeoutTokenMs: 20 }, lento).enviar({ accessToken: 't', raw: 'x', destino: 'a@b.com' })).toEqual({ tipo: 'tempo' })
    expect(await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [], timeoutTokenMs: 20 }, lento).token()).toEqual({ tipo: 'tempo' })
    const html = await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, fetchDe(() => new Response('<html>502</html>', { status: 502 })).f).enviar({ accessToken: 't', raw: 'x', destino: 'a@b.com' })
    expect(html).toEqual({ tipo: 'http', status: 502, corpo: null })
    expect(lerRespostaDoEnvio(html).desfecho).toBe('UNKNOWN')
  })
  it('uma chamada de porta = no máximo uma requisição: não há nova tentativa', async () => {
    const { f, chamadas } = fetchDe(() => json({}, 503))
    await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, f).enviar({ accessToken: 't', raw: 'x', destino: 'a@b.com' })
    await portaGoogle({ ...SEGREDOS, modo: 'ativo', canario: [] }, f).token()
    expect(chamadas).toHaveLength(2)
  })
})

describe('porta do livro', () => {
  const cfg = { url: 'https://banco.exemplo', chave: 'CHAVE-DE-SERVICO' }
  const pedido = { organizacaoId: 'o', threadId: 't', contatoId: 'c', solicitanteId: 'u', solicitanteNome: 'Ana', intencao: 'i', impressao: 'f', texto: 'corpo', limiteUsuario: 30, limiteOrganizacao: 100 }
  it('os argumentos têm exatamente os nomes dos parâmetros das RPCs da 0075', () => {
    expect(Object.keys(argsCriar(pedido))).toEqual(['p_organization_id', 'p_thread_id', 'p_contact_id', 'p_requested_by', 'p_requester_name', 'p_idempotency_key', 'p_fingerprint', 'p_body', 'p_limit_user', 'p_limit_org'])
    expect(argsTransicionar('d', 'FAILED', { atorId: 'u', motivo: 'mensagem_recusada' })).toEqual({ p_delivery_id: 'd', p_to: 'FAILED', p_actor: 'u', p_reason: 'mensagem_recusada', p_provider_message_id: null, p_provider_thread_id: null })
    expect(argsAceitar('d', { atorId: 'u', aceitaEm: 'x', providerMessageId: 'gm' })).toEqual({ p_delivery_id: 'd', p_actor: 'u', p_accepted_at: 'x', p_provider_message_id: 'gm', p_provider_thread_id: null, p_reconciled: false })
  })
  it('chama a RPC certa com a chave de serviço e lê a entrega e o fio', async () => {
    const { f, chamadas } = fetchDe(() => json({ ok: true, nova: true, entrega: { id: 'e1', status: 'READY', message_id: 'm1' }, fio: { rfc_message_id: '<a@eiff.com.br>', provider_thread_id: 'gt' } }))
    const r = await portaLivro(cfg, f).criar(pedido)
    expect(r).toEqual({ ok: true, nova: true, entrega: { id: 'e1', estado: 'READY', mensagemId: 'm1', fio: { rfcMessageId: '<a@eiff.com.br>', providerThreadId: 'gt' } } })
    expect(chamadas[0].url).toBe('https://banco.exemplo/rest/v1/rpc/inbox_email_delivery_create')
    expect((chamadas[0].init?.headers as Record<string, string>).authorization).toBe('Bearer CHAVE-DE-SERVICO')
  })
  it('recusa do banco só segue adiante se for do catálogo; o resto é livro indisponível', async () => {
    expect(recusaDoLivro('entrega_pendente')).toBe('entrega_pendente')
    for (const x of ['sem_permissao', 'somente_servidor', 'texto livre do banco com dado', undefined, 42]) expect(recusaDoLivro(x)).toBe('livro_indisponivel')
    expect(await portaLivro(cfg, fetchDe(() => json({ ok: false, erro: 'limite_usuario' })).f).criar(pedido)).toEqual({ ok: false, erro: 'limite_usuario' })
    expect(await portaLivro(cfg, fetchDe(() => json({ message: 'permission denied' }, 403)).f).criar(pedido)).toEqual({ ok: false, erro: 'livro_indisponivel' })
    expect(await portaLivro(cfg, fetchDe(() => { throw new Error('rede') }).f).criar(pedido)).toEqual({ ok: false, erro: 'livro_indisponivel' })
    expect(await portaLivro(cfg, fetchDe(() => json({ ok: true, nova: true, entrega: { id: 'e', status: 'INVENTADO' } })).f).criar(pedido)).toEqual({ ok: false, erro: 'livro_indisponivel' })
  })
  it('transição e aceite: falha de banco vira `false`, nunca exceção', async () => {
    const fora = portaLivro(cfg, fetchDe(() => json({}, 500)).f)
    expect(await fora.transicionar('d', 'REQUESTED', { atorId: 'u' })).toBe(false)
    expect(await fora.aceitar('d', { atorId: 'u', aceitaEm: 'x' })).toEqual({ ok: false })
    const ok = portaLivro(cfg, fetchDe(() => json({ ok: true, message_id: 'm1', cumpriu_primeira_resposta: true, entrega: { id: 'd', status: 'ACCEPTED' } })).f)
    expect(await ok.aceitar('d', { atorId: 'u', aceitaEm: 'x', providerMessageId: 'gm' })).toEqual({ ok: true, mensagemId: 'm1', cumpriuPrimeiraResposta: true })
    expect(entregaDoJson({ entrega: { id: 'd', status: 'FAILED', reason: 'motivo fora do catálogo' } })).toEqual({ id: 'd', estado: 'FAILED' })
  })
})

describe('porta da sessão: leituras com o JWT do usuário', () => {
  const cfg = { url: 'https://banco.exemplo', anon: 'ANON' }
  it('usuário: papel, organização e ativo vêm do PERFIL do banco; sem perfil não há sessão', async () => {
    const { f, chamadas } = fetchDe((url) => (url.includes('/auth/v1/user') ? json({ id: UID }) : json([{ name: 'Ana', role: 'Diretoria', organization_id: 'org', active: true }])))
    expect(await portaSessao(cfg, f).usuario('Bearer jwt')).toEqual({ id: UID, nome: 'Ana', papel: 'Diretoria', organizacaoId: 'org', ativo: true })
    expect(chamadas[1].url).toBe(`https://banco.exemplo/rest/v1/profile?id=eq.${UID}&select=name,role,organization_id,active`)
    expect((chamadas[1].init?.headers as Record<string, string>).authorization).toBe('Bearer jwt')
    expect(await portaSessao(cfg, fetchDe((url) => (url.includes('/auth/v1/user') ? json({ id: UID }) : json([]))).f).usuario('Bearer jwt')).toBeNull()
    expect(await portaSessao(cfg, fetchDe(() => json({ msg: 'invalid JWT' }, 401)).f).usuario('Bearer ruim')).toBeNull()
    expect(await portaSessao(cfg, fetchDe(() => json({ id: "x' or 1=1" })).f).usuario('Bearer jwt')).toBeNull()
  })
  it('conversa: canal e identidades vêm do banco, na ordem em que vieram (sem preferência); invisível é null', async () => {
    const { f } = fetchDe((url) => (url.includes('inbox_thread') ? json([{ id: T1, organization_id: 'org', status: 'ATRIBUIDA', context: 'EXTERNAL', channel: 'PORTAL', contact_id: UID }]) : json([{ channel: 'PORTAL', identifier: 'site@x.com' }, { channel: 'EMAIL', identifier: 'direto@x.com' }])))
    expect(await portaSessao(cfg, f).conversa('Bearer jwt', T1)).toEqual({ id: T1, organizacaoId: 'org', contatoId: UID, status: 'ATRIBUIDA', contexto: 'EXTERNAL', canal: 'PORTAL', identidades: [{ canal: 'PORTAL', identificador: 'site@x.com' }, { canal: 'EMAIL', identificador: 'direto@x.com' }] })
    expect(resolverDestinatario((await portaSessao(cfg, f).conversa('Bearer jwt', T1))!)).toEqual({ ok: true, destino: 'site@x.com' })
    expect(await portaSessao(cfg, fetchDe(() => json([])).f).conversa('Bearer jwt', T1)).toBeNull()
    const semChamada = fetchDe(() => json([]))
    expect(await portaSessao(cfg, semChamada.f).conversa('Bearer jwt', 'id=eq.1&select=*')).toBeNull()
    expect(semChamada.chamadas).toHaveLength(0)
  })
  it('entrega: só com estado do catálogo', async () => {
    const linha = { id: T1, thread_id: T1, organization_id: 'org', status: 'UNKNOWN', requested_at: '2026-11-11T18:00:00+00:00', message_id: UID }
    expect(await portaSessao(cfg, fetchDe(() => json([linha])).f).entrega('Bearer jwt', T1)).toMatchObject({ estado: 'UNKNOWN', criadaEm: '2026-11-11T18:00:00+00:00' })
    expect(await portaSessao(cfg, fetchDe(() => json([{ ...linha, status: 'ENVIADO' }])).f).entrega('Bearer jwt', T1)).toBeNull()
  })
})

describe('fronteiras do repositório', () => {
  const raiz = path.resolve(__dirname, '../../..')
  const arquivos = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  const fontes = arquivos(path.join(raiz, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))
  const rel = (f: string) => path.relative(raiz, f).replace(/\\/g, '/')

  it('só a função Netlify importa as portas; nenhuma tela, store ou adapter do navegador', () => {
    const importam = fontes.filter((f) => !/\.test\.tsx?$/.test(f) && /from ['"][^'"]*emailPorta['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(importam).toEqual([])
    expect(fs.readFileSync(path.join(raiz, 'netlify/functions/email-comercial.ts'), 'utf8')).toMatch(/from '..\/..\/src\/core\/inbox\/emailPorta'/)
  })
  it('as URLs do Google e os nomes das RPCs do livro só existem no módulo de portas', () => {
    const cita = (re: RegExp) => fontes.filter((f) => !/\.test\.tsx?$/.test(f) && re.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(cita(/googleapis\.com/)).toEqual(['src/core/inbox/emailPorta.ts'])
    expect(cita(/inbox_email_delivery_(create|transition|accept)/)).toEqual(['src/core/inbox/emailPorta.ts'])
  })
  it('nenhuma variável do e-mail tem prefixo VITE_, e o núcleo do envio não lê import.meta.env', () => {
    const todos = [...fontes, path.join(raiz, 'netlify/functions/email-comercial.ts')].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    expect(todos).not.toMatch(/VITE_(GOOGLE|EIFF_EMAIL|GMAIL)/)
    for (const f of ['emailPorta.ts', 'emailServidor.ts', 'emailEnvio.ts', 'emailMensagem.ts']) expect(fs.readFileSync(path.join(raiz, 'src/core/inbox', f), 'utf8')).not.toContain('import.meta')
  })
  it('nenhum teste do e-mail usa o fetch real', () => {
    for (const f of fontes.filter((x) => /inbox[\\/]email.*\.test\.ts$/.test(x))) {
      const semComentario = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
      expect(semComentario).not.toMatch(/globalThis\.fetch|[^.\w]fetch\(['"`]https?:/)
    }
  })
  it('a função começa desligada e declara o caminho /api/email-comercial', () => {
    const fn = fs.readFileSync(path.join(raiz, 'netlify/functions/email-comercial.ts'), 'utf8')
    expect(fn).toContain("config = { path: '/api/email-comercial' }")
    expect(fn).toContain("if (req.method !== 'POST')")
    expect(fn).not.toMatch(/console\.log\([^)]*(authorization|refresh|secret|chave)/i)
  })
})

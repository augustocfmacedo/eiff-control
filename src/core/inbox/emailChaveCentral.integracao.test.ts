// Chave central (0076) × CÓDIGO JÁ PUBLICADO. O handler e as portas usados aqui são os do deploy publicado: os arquivos
// do caminho de envio (emailServidor, emailPorta, emailEnvio, emailMensagem e netlify/functions/email-comercial) não
// mudam neste PR e são idênticos de 9e5de09 a e55b3d6 — todo deploy de produção que tem a função de e-mail roda este
// código. A prova é ponta a ponta: handler + portas de produção + PostgreSQL (PGlite) com 0075 + 0076, Google SIMULADO.
// O que se exige em cada cenário de bloqueio: o Google NÃO é chamado (nem o token, nem o envio).
import { beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { ADM_A, DIR_A, ORG_A, SEMENTE, bancoDoEmail } from '../../../scripts/lib/emailBanco.mjs'
import { GMAIL_SEND_URL, GOOGLE_TOKEN_URL, ambienteEmail, portaGoogle, portaLivro, portaSessao } from './emailPorta'
import { tratarEmailComercial, type DepsEmail } from './emailServidor'

type Row = Record<string, unknown>
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<unknown> }
let db: Banco
const URL_BANCO = 'https://banco.exemplo.invalido'
const iso = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))
const um = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows.map(iso)[0] as Row

const google = { token: 0, enviar: 0, falhar: false }
/** Gancho executado logo DEPOIS de uma RPC responder (antes de o handler seguir): simula o desligamento no meio do caminho. */
const depoisDaRpc: { nome?: string; fazer?: () => Promise<void> } = {}
/** Banco fora do ar para estas RPCs (a chamada falha como falha de rede). */
let bancoFora = new Set<string>()

const fetchFalso = (async (entrada: string, init?: RequestInit): Promise<Response> => {
  const url = String(entrada)
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
  if (url === GOOGLE_TOKEN_URL) { google.token += 1; return json({ access_token: 'tok-de-teste' }) }
  if (url === GMAIL_SEND_URL) { google.enviar += 1; if (google.falhar) throw new TypeError('fetch failed'); return json({ id: 'gm-1', threadId: 'gt-1' }) }
  if (!url.startsWith(URL_BANCO)) throw new Error(`chamada fora do roteiro: ${url.split('?')[0]}`)
  const cab = (init?.headers ?? {}) as Record<string, string>
  const caminho = url.slice(URL_BANCO.length)
  const uid = /^Bearer uid:(.+)$/.exec(cab['authorization'] ?? '')?.[1]
  if (caminho === '/auth/v1/user') return uid ? json({ id: uid }) : json({ msg: 'invalid' }, 401)
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(caminho)
  if (rpc) {
    if (bancoFora.has(rpc[1])) throw new TypeError('fetch failed')
    if (cab['authorization'] !== 'Bearer CHAVE-DE-SERVICO') return json({ message: 'permission denied' }, 403)
    const args = JSON.parse(String(init?.body)) as Row; const ks = Object.keys(args)
    let corpo: unknown
    try { corpo = (await db.query(`select ${rpc[1]}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, ks.map((k) => args[k]))).rows[0]['r'] } catch { return json({ message: 'erro' }, 400) }
    if (depoisDaRpc.nome === rpc[1] && depoisDaRpc.fazer) { const f = depoisDaRpc.fazer; depoisDaRpc.fazer = undefined; await f() }
    return json(corpo)
  }
  const m = /^\/rest\/v1\/(\w+)\?(.*)$/.exec(caminho)
  if (!m || !uid) return json([], 401)
  const q = new URLSearchParams(m[2]); const where: string[] = []; const params: unknown[] = []
  for (const [k, v] of q) {
    if (k === 'select') continue
    if (v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k} = $${params.length}`) }
    else if (v.startsWith('in.(')) { const itens = v.slice(4, -1).split(','); where.push(`${k} in (${itens.map((x) => { params.push(x); return `$${params.length}` }).join(', ')})`) }
  }
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`)
  try { return json((await db.query(`select ${q.get('select')} from ${m[1]} where ${where.join(' and ')}`, params)).rows.map(iso)) }
  finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}) as unknown as typeof fetch

// O ambiente mais permissivo possível: modo ATIVO, credenciais presentes. Só a chave central decide.
const VARS = { EIFF_INBOX_OUTBOUND_ENABLED: 'true', EIFF_EMAIL_SEND_MODE: 'ativo', EIFF_EMAIL_SENDER: 'contato@eiff.com.br', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'segredo', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh' }
function deps(): DepsEmail {
  const ambiente = ambienteEmail(VARS)
  return {
    ambiente, agora: () => new Date().toISOString(),
    sessao: portaSessao({ url: URL_BANCO, anon: 'ANON' }, fetchFalso),
    livro: portaLivro({ url: URL_BANCO, chave: 'CHAVE-DE-SERVICO' }, fetchFalso),
    google: portaGoogle({ clientId: 'id', clientSecret: 'segredo', refreshToken: 'refresh', modo: ambiente.modo, canario: ambiente.canario }, fetchFalso),
  }
}
let n = 0
async function conversa(): Promise<{ id: string; email: string }> {
  n += 1
  const email = `lead${n}@exemplo.invalido`
  const r = (await db.query(`select inbox_ingest($1, 'MANUAL', 'PORTAL', 'EXTERNAL', $2, 'Lead Fictício', $3, null, 'Solicito contato sobre um galpão.', 'texto', now() - interval '10 minutes') j`, [ORG_A, email, `site.exemplo.${n}`])).rows[0]['j'] as Row
  return { id: String(r['thread_id']), email }
}
const intencao = () => `eeeeeeee-0000-4000-8000-${String(++n).padStart(12, '0')}`
const enviar = (t: { id: string; email: string }, i: string = intencao()) =>
  tratarEmailComercial({ authorization: `Bearer uid:${ADM_A}`, body: { acao: 'enviar', threadId: t.id, assunto: 'Sua solicitação de galpão', corpo: 'Olá.\n\nPodemos conversar amanhã?', intencao: i, destinatario: t.email } }, deps())
/** Liga/desliga como o usuário (RPC da 0076 com o JWT): Administrador liga, Diretoria/Administrador desligam. */
async function chave(ligar: boolean, uid: string = ligar ? ADM_A : DIR_A) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`)
  try { return (await db.query('select inbox_email_switch_set($1, $2) j', [ligar, ligar ? 'teste: ligar' : 'teste: desligar'])).rows[0]['j'] as Row }
  finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}
const desligarSistema = () => db.query("select inbox_email_switch_desligar_sistema($1, 'teste: emergência') j", [ORG_A])
const entregaDa = (t: { id: string }) => um('select status, reason from inbox_email_delivery where thread_id = $1 order by requested_at desc limit 1', [t.id])
const zerar = () => { google.token = 0; google.enviar = 0; google.falhar = false; bancoFora = new Set() }

beforeAll(async () => {
  db = (await bancoDoEmail({ com0076: true })) as Banco
  await db.exec(SEMENTE) // organização criada depois da 0076: SEM linha da chave
}, 120_000)

describe('chave central (0076) bloqueia o código publicado, com o modo ATIVO nas variáveis', () => {
  it('sem linha da chave (estado de qualquer organização nova): nada nasce e o Google não é chamado', async () => {
    zerar()
    const t = await conversa()
    const r = await enviar(t)
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.corpo['erro']).toBe('livro_indisponivel') // o código publicado não conhece `envio_bloqueado`: cai no genérico, fechado
    expect(google).toMatchObject({ token: 0, enviar: 0 })
    expect(await entregaDa(t)).toBeUndefined()
  })

  it('chave ligada: o mesmo código envia normalmente (o bloqueio não é efeito colateral)', async () => {
    zerar()
    expect((await chave(true))['ok']).toBe(true)
    const t = await conversa()
    const r = await enviar(t)
    expect(r.corpo).toMatchObject({ estado: 'ACCEPTED' })
    expect(google).toMatchObject({ token: 1, enviar: 1 })
  })

  it('chave desligada pela Diretoria: criação recusada, Google não chamado', async () => {
    zerar()
    expect((await chave(false))['ok']).toBe(true)
    const t = await conversa()
    const r = await enviar(t)
    expect(r.corpo['erro']).toBe('livro_indisponivel')
    expect(google).toMatchObject({ token: 0, enviar: 0 })
    expect(await entregaDa(t)).toBeUndefined()
  })

  it('desligada ENTRE a criação e a autorização: a entrega vira FAILED envio_bloqueado e o Google não é chamado', async () => {
    zerar()
    await chave(true)
    const t = await conversa()
    depoisDaRpc.nome = 'inbox_email_delivery_create'
    depoisDaRpc.fazer = async () => { await desligarSistema() }
    const r = await enviar(t)
    expect(r.corpo['erro']).toBe('livro_indisponivel')
    expect(google).toMatchObject({ token: 0, enviar: 0 })
    expect(await entregaDa(t)).toEqual({ status: 'FAILED', reason: 'envio_bloqueado' })
    // repetir a MESMA intenção depois do bloqueio devolve a entrega existente e continua sem Google
    const i = intencao()
    await chave(true); depoisDaRpc.nome = 'inbox_email_delivery_create'; depoisDaRpc.fazer = async () => { await desligarSistema() }
    const t2 = await conversa()
    await enviar(t2, i)
    zerar()
    const repetida = await enviar(t2, i)
    expect(repetida.corpo).toMatchObject({ estado: 'FAILED', repetida: true })
    expect(google).toMatchObject({ token: 0, enviar: 0 })
  })

  it('desligada DEPOIS da autorização (REQUESTED): a chamada ao Google que já começou NÃO é cancelada — o desfecho é registrado', async () => {
    zerar()
    await chave(true)
    const t = await conversa()
    depoisDaRpc.nome = 'inbox_email_delivery_transition'
    depoisDaRpc.fazer = async () => { await desligarSistema() }
    const r = await enviar(t)
    // limite declarado: a autorização já tinha sido concedida; o envio sai e o aceite é gravado mesmo com a chave desligada
    expect(google).toMatchObject({ token: 1, enviar: 1 })
    expect(r.corpo).toMatchObject({ estado: 'ACCEPTED' })
    const ev = await um("select pending_requested from inbox_email_switch_event where organization_id = $1 order by occurred_at desc, version desc limit 1", [ORG_A])
    expect(Number(ev['pending_requested'])).toBe(1)
  })

  it('banco fora do ar na criação ou na autorização: nada é enviado', async () => {
    zerar()
    await chave(true)
    bancoFora = new Set(['inbox_email_delivery_create'])
    const a = await enviar(await conversa())
    expect(a.corpo['erro']).toBe('livro_indisponivel')
    bancoFora = new Set(['inbox_email_delivery_transition'])
    const t = await conversa()
    const b = await enviar(t)
    expect(b.corpo['erro']).toBe('livro_indisponivel')
    expect(google).toMatchObject({ token: 0, enviar: 0 })
    expect(await entregaDa(t)).toEqual({ status: 'READY', reason: null }) // fica READY: a reconciliação existente resolve
  })

  it('reconciliação de um UNKNOWN funciona com a chave desligada e não envia nada', async () => {
    zerar()
    await chave(true)
    const t = await conversa()
    google.falhar = true
    const r = await enviar(t)
    expect(r.corpo['estado']).toBe('UNKNOWN')
    google.falhar = false
    await desligarSistema()
    zerar()
    const rec = await tratarEmailComercial({ authorization: `Bearer uid:${ADM_A}`, body: { acao: 'reconciliar', entregaId: r.corpo['entregaId'], desfecho: 'encontrado' } }, deps())
    expect(rec.corpo).toMatchObject({ estado: 'ACCEPTED', reconciliada: true })
    expect(google).toMatchObject({ token: 0, enviar: 0 })
  })
})

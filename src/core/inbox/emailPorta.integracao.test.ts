// E-mail comercial — PONTA A PONTA sem rede e sem banco real: o handler de produção (emailServidor) com as PORTAS de
// produção (emailPorta: sessão e livro) falando com um PostgreSQL de verdade (PGlite) que tem a migration 0075, e o
// Google SIMULADO. É a prova de que as três etapas se encaixam: o que o handler pede, o que a porta manda e o que o
// banco aceita — e de que o SLA só muda quando o «Google» confirma o aceite. O que vale é o que se LÊ do banco.
import { beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — helper .mjs dos smokes (sem tipos)
import { ADM_A, ADM_B, ENG_A, FIN_A, ORG_A, SEMENTE, SETOR_OBRAS, bancoDoEmail } from '../../../scripts/lib/emailBanco.mjs'
import { GMAIL_SEND_URL, GOOGLE_TOKEN_URL, ambienteEmail, portaGoogle, portaLivro, portaSessao } from './emailPorta'
import { tratarEmailComercial, type DepsEmail } from './emailServidor'

type Row = Record<string, unknown>
interface Banco { query: (sql: string, p?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<unknown> }
let db: Banco
const URL_BANCO = 'https://banco.exemplo.invalido'
const iso = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))
const um = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows.map(iso)[0] as Row

const google = { token: 0, enviar: 0, proximoEnvio: () => new Response(JSON.stringify({ id: 'gm-1', threadId: 'gt-1' }), { status: 200 }) as Response | never, ultimoCorpo: '' }

/** `fetch` que faz o papel do PostgREST (sobre o PGlite) e do Google (roteirizado). Nenhuma rede. */
const fetchFalso = (async (entrada: string, init?: RequestInit): Promise<Response> => {
  const url = String(entrada)
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
  if (url === GOOGLE_TOKEN_URL) { google.token += 1; return json({ access_token: 'tok-de-teste' }) }
  if (url === GMAIL_SEND_URL) { google.enviar += 1; google.ultimoCorpo = String(init?.body); return google.proximoEnvio() }
  if (!url.startsWith(URL_BANCO)) throw new Error(`chamada fora do roteiro: ${url.split('?')[0]}`)
  const cab = (init?.headers ?? {}) as Record<string, string>
  const caminho = url.slice(URL_BANCO.length)
  const uid = /^Bearer uid:(.+)$/.exec(cab['authorization'] ?? '')?.[1]
  if (caminho === '/auth/v1/user') return uid ? json({ id: uid }) : json({ msg: 'invalid' }, 401)
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(caminho)
  if (rpc) {
    // as RPCs são chamadas com a chave de serviço: sem papel de usuário, auth.uid() nulo
    if (cab['authorization'] !== 'Bearer CHAVE-DE-SERVICO') return json({ message: 'permission denied' }, 403)
    const args = JSON.parse(String(init?.body)) as Row; const ks = Object.keys(args)
    try { return json((await db.query(`select ${rpc[1]}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, ks.map((k) => args[k]))).rows[0]['r']) } catch { return json({ message: 'erro' }, 400) }
  }
  // leitura de tabela COMO O USUÁRIO: a RLS de produção decide o que volta
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

const VARS = { EIFF_INBOX_OUTBOUND_ENABLED: 'true', EIFF_EMAIL_SEND_MODE: 'ativo', EIFF_EMAIL_SENDER: 'contato@eiff.com.br', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'segredo', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh' }
function deps(vars: Record<string, string> = VARS): DepsEmail {
  const ambiente = ambienteEmail(vars)
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
const enviar = (t: { id: string }, p: { por?: string; intencao?: string; vars?: Record<string, string>; corpo?: string } = {}) =>
  tratarEmailComercial({ authorization: `Bearer uid:${p.por ?? ADM_A}`, body: { acao: 'enviar', threadId: t.id, assunto: 'Sua solicitação de galpão', corpo: p.corpo ?? 'Olá.\n\nPodemos conversar amanhã?', intencao: p.intencao ?? intencao() } }, deps(p.vars))
const estado = (t: { id: string }) => um(`select t.status, t.sla_first_response_at, (select count(*)::int from inbox_email_delivery d where d.thread_id = t.id) entregas,
  (select string_agg(m.delivery_state, ',' order by m.occurred_at) from inbox_message m where m.thread_id = t.id and m.provider = 'GOOGLE_WORKSPACE') mensagens from inbox_thread t where t.id = $1`, [t.id])

beforeAll(async () => {
  db = (await bancoDoEmail()) as Banco
  await db.exec(SEMENTE)
}, 120_000)

describe('envio ponta a ponta (handler + portas de produção + PostgreSQL com a 0075; Google simulado)', () => {
  it('aceite confirmado: entrega ACCEPTED, mensagem enviada, SLA preenchido — e o e-mail foi para o endereço do BANCO', async () => {
    const t = await conversa()
    google.enviar = 0; google.token = 0
    const r = await enviar(t)
    expect(r).toMatchObject({ status: 200, corpo: { estado: 'ACCEPTED', cumpriuPrimeiraResposta: true } })
    expect(google).toMatchObject({ token: 1, enviar: 1 })
    const raw = (JSON.parse(google.ultimoCorpo) as { raw: string }).raw
    const mensagem = Buffer.from(raw, 'base64url').toString('utf8')
    expect(mensagem).toContain(`To: ${t.email}`)
    expect(mensagem).toContain('From: "EIFF" <contato@eiff.com.br>')
    expect(mensagem).toContain(`Message-ID: <${String(r.corpo['entregaId'])}@eiff.com.br>`)
    const e = await estado(t)
    expect(e).toMatchObject({ status: 'EM_ATENDIMENTO', entregas: 1, mensagens: 'enviada' })
    expect(e['sla_first_response_at']).not.toBeNull()
    const m = await um('select body, sender_name, sender_id from inbox_message where id = $1', [r.corpo['mensagemId']])
    expect(m).toEqual({ body: 'Assunto: Sua solicitação de galpão\n\nOlá.\n\nPodemos conversar amanhã?\n\nAugusto Macedo\nEIFF', sender_name: 'Augusto Macedo', sender_id: ADM_A })
  })

  it('duplo clique: a segunda chamada devolve a mesma entrega e o Google é chamado uma vez', async () => {
    const t = await conversa(); const i = intencao()
    google.enviar = 0
    const a = await enviar(t, { intencao: i }); const b = await enviar(t, { intencao: i })
    expect(google.enviar).toBe(1)
    expect(b.corpo).toMatchObject({ estado: 'ACCEPTED', entregaId: a.corpo['entregaId'], repetida: true })
    expect((await estado(t))['entregas']).toBe(1)
  })

  it('resultado desconhecido: SLA intacto, novo envio bloqueado, e a reconciliação resolve sem reenviar', async () => {
    const t = await conversa()
    google.enviar = 0
    google.proximoEnvio = () => { throw new TypeError('fetch failed') }
    const r = await enviar(t)
    google.proximoEnvio = () => new Response(JSON.stringify({ id: 'gm-2', threadId: 'gt-2' }), { status: 200 })
    expect(r.corpo['estado']).toBe('UNKNOWN')
    expect(await estado(t)).toMatchObject({ sla_first_response_at: null, mensagens: 'registrada', entregas: 1 })
    expect(await enviar(t)).toMatchObject({ status: 409, corpo: { erro: 'entrega_pendente' } })
    expect(google.enviar).toBe(1)
    const rec = await tratarEmailComercial({ authorization: `Bearer uid:${ADM_A}`, body: { acao: 'reconciliar', entregaId: r.corpo['entregaId'], desfecho: 'encontrado' } }, deps())
    expect(rec.corpo).toMatchObject({ estado: 'ACCEPTED', reconciliada: true, cumpriuPrimeiraResposta: true })
    expect(google.enviar).toBe(1)
    const e = await estado(t)
    expect(e['mensagens']).toBe('enviada')
    expect(e['sla_first_response_at']).not.toBeNull()
  })

  it('recusa do Google: entrega FAILED, mensagem `falhou`, SLA intacto, e outra intenção pode ser enviada', async () => {
    const t = await conversa()
    google.proximoEnvio = () => new Response(JSON.stringify({ error: { message: 'Invalid To header' } }), { status: 400 })
    const r = await enviar(t)
    google.proximoEnvio = () => new Response(JSON.stringify({ id: 'gm-3', threadId: 'gt-3' }), { status: 200 })
    expect(r).toMatchObject({ status: 502, corpo: { erro: 'provedor_recusou', estado: 'FAILED' } })
    expect(JSON.stringify(r.corpo)).not.toContain('Invalid To header')
    expect(await estado(t)).toMatchObject({ sla_first_response_at: null, mensagens: 'falhou' })
    expect((await enviar(t)).corpo['estado']).toBe('ACCEPTED')
    expect((await estado(t))['mensagens']).toBe('falhou,enviada')
  })

  it('desligado (qualquer chave faltando): 403 ou 503, nada no banco, nada no Google', async () => {
    const t = await conversa()
    google.enviar = 0; google.token = 0
    for (const vars of [{ ...VARS, EIFF_EMAIL_SEND_MODE: '' }, { ...VARS, EIFF_INBOX_OUTBOUND_ENABLED: 'false' }, { ...VARS, EIFF_EMAIL_SEND_MODE: 'canary' }, { ...VARS, GOOGLE_OAUTH_REFRESH_TOKEN: '' }, { ...VARS, EIFF_EMAIL_SENDER: '' }]) {
      const r = await enviar(t, { vars })
      expect([403, 503]).toContain(r.status)
    }
    expect(google).toMatchObject({ token: 0, enviar: 0 })
    expect(await estado(t)).toMatchObject({ entregas: 0, mensagens: null, sla_first_response_at: null })
  })

  it('quem não tem `enviar_email`, quem não enxerga a conversa e outra organização: nada é criado', async () => {
    const t = await conversa()
    await db.query('update inbox_thread set sector_id = $2 where id = $1', [t.id, SETOR_OBRAS])
    google.enviar = 0
    expect(await enviar(t, { por: FIN_A })).toMatchObject({ status: 403, corpo: { erro: 'sem_permissao' } })   // Financeiro: tem inbox, não tem envio
    expect(await enviar(t, { por: ENG_A })).toMatchObject({ status: 403, corpo: { erro: 'sem_permissao' } })   // enxerga a conversa, mas não envia
    expect(await enviar(t, { por: ADM_B })).toMatchObject({ status: 404, corpo: { erro: 'conversa_nao_encontrada' } }) // Administrador de OUTRA organização
    expect(google.enviar).toBe(0)
    expect((await estado(t))['entregas']).toBe(0)
  })

  it('teto diário do usuário vale no banco: o envio seguinte é 429 sem chamar o Google', async () => {
    const usados = Number((await um("select count(*)::int n from inbox_email_delivery where requested_by = $1 and status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN')", [ADM_A]))['n'])
    const t = await conversa()
    google.enviar = 0
    expect(await enviar(t, { vars: { ...VARS, EIFF_EMAIL_DAILY_LIMIT_USER: String(usados) } })).toMatchObject({ status: 429, corpo: { erro: 'limite_usuario' } })
    expect(google.enviar).toBe(0)
  })

  it('preparar lê a conversa pelo banco e mascara o destinatário; saúde só pede o token', async () => {
    const t = await conversa()
    google.enviar = 0; google.token = 0
    const p = await tratarEmailComercial({ authorization: `Bearer uid:${ADM_A}`, body: { acao: 'preparar', threadId: t.id } }, deps())
    expect(p.corpo).toEqual({ modo: 'ativo', remetente: 'contato@eiff.com.br', disponivel: true, destinatario: 'l•••@exemplo.invalido' })
    const s = await tratarEmailComercial({ authorization: `Bearer uid:${ADM_A}`, body: { acao: 'saude' } }, deps())
    expect(s.corpo).toMatchObject({ credenciais: 'presentes', token: 'ok' })
    expect(google).toMatchObject({ token: 1, enviar: 0 })
  })
})

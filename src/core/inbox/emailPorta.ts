/**
 * E-mail comercial — as PORTAS reais do handler (etapa E3). SÓ SERVIDOR.
 *
 * Este é o único arquivo que conhece as URLs do Google e as RPCs do livro de entregas (migration 0075). É importado
 * apenas pela função Netlify `/api/email-comercial`; nenhum arquivo de tela pode importá-lo (teste de fronteira).
 *
 * Regras:
 *   - `fetch` é injetado: a suíte prova cada chamada sem rede;
 *   - segredos (segredo do cliente, token de atualização, chave de serviço) vêm do ambiente da função, nunca de
 *     `VITE_`, e não saem daqui — nem em log, nem em erro, nem em resultado;
 *   - nenhuma porta lança: falha vira resultado (`null`, `{ ok: false }`, `{ tipo: 'rede' | 'tempo' }`);
 *   - o corpo de erro do Google ou do banco não é repassado: só status e códigos de catálogo;
 *   - a porta do Google confere DE NOVO modo e destino antes de montar a requisição de envio (fail-closed).
 */
import {
  LIMITE_ORGANIZACAO_PADRAO, LIMITE_USUARIO_PADRAO, MOTIVOS_ENTREGA, ESTADOS_ENTREGA_EMAIL, autorizarDestino, lerLimite, lerListaCanario, lerModoEmail,
  type EstadoEntregaEmail, type ModoEmail, type MotivoEntrega, type RespostaGoogle,
} from './emailEnvio'
import type { AmbienteEmail, ConversaLida, EntregaCriada, EntregaLida, PortaGoogle, PortaLivro, PortaSessao, RecusaDoLivro, UsuarioDaSessao } from './emailServidor'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
/** Escopo único do consentimento: só enviar. */
export const ESCOPO_GMAIL = 'https://www.googleapis.com/auth/gmail.send'
export const TIMEOUT_TOKEN_MS = 8_000
export const TIMEOUT_ENVIO_MS = 15_000

/* ---------------------------------------------------------------
   Ambiente
--------------------------------------------------------------- */

export interface VariaveisEmail {
  EIFF_EMAIL_SEND_MODE?: string; EIFF_EMAIL_CANARY_RECIPIENTS?: string; EIFF_EMAIL_SENDER?: string; EIFF_EMAIL_SENDER_NAME?: string
  EIFF_EMAIL_DAILY_LIMIT_USER?: string; EIFF_EMAIL_DAILY_LIMIT_ORG?: string; EIFF_INBOX_OUTBOUND_ENABLED?: string
  GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string; GOOGLE_OAUTH_REFRESH_TOKEN?: string
}
export const VARIAVEIS_GOOGLE = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'] as const
const VERDADEIRO = new Set(['true', '1', 'on', 'yes', 'sim'])

/**
 * O modo EFETIVO. Além de `EIFF_EMAIL_SEND_MODE`, o envio exige a chave geral de saída do Inbox
 * (`EIFF_INBOX_OUTBOUND_ENABLED`): com ela desligada ou ausente, o modo é `disabled`, qualquer que seja o resto.
 */
export function modoEfetivo(env: VariaveisEmail): ModoEmail {
  const saida = VERDADEIRO.has((env.EIFF_INBOX_OUTBOUND_ENABLED ?? '').trim().toLowerCase())
  return saida ? lerModoEmail(env.EIFF_EMAIL_SEND_MODE) : 'disabled'
}

/** O que o handler precisa saber do ambiente. Das credenciais, só a PRESENÇA. */
export function ambienteEmail(env: VariaveisEmail): AmbienteEmail {
  const remetente = (env.EIFF_EMAIL_SENDER ?? '').trim().toLowerCase()
  const nome = (env.EIFF_EMAIL_SENDER_NAME ?? '').trim()
  return {
    modo: modoEfetivo(env),
    canario: lerListaCanario(env.EIFF_EMAIL_CANARY_RECIPIENTS),
    ...(remetente !== '' ? { remetente } : {}),
    ...(nome !== '' ? { nomeExibido: nome } : {}),
    limiteUsuario: lerLimite(env.EIFF_EMAIL_DAILY_LIMIT_USER, LIMITE_USUARIO_PADRAO),
    limiteOrganizacao: lerLimite(env.EIFF_EMAIL_DAILY_LIMIT_ORG, LIMITE_ORGANIZACAO_PADRAO),
    credenciais: VARIAVEIS_GOOGLE.every((v) => (env[v] ?? '').trim() !== ''),
  }
}

/* ---------------------------------------------------------------
   Sessão: leituras com o JWT do usuário (a RLS decide)
--------------------------------------------------------------- */

type Linha = Record<string, unknown>
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function portaSessao(cfg: { url: string; anon: string }, fetchFn: typeof fetch): PortaSessao {
  const cab = (authorization: string) => ({ apikey: cfg.anon, authorization, 'content-type': 'application/json' })
  const get = async (authorization: string, caminho: string): Promise<Linha[] | null> => {
    try {
      const r = await fetchFn(`${cfg.url}/rest/v1/${caminho}`, { headers: cab(authorization) })
      if (!r.ok) return null
      const j: unknown = await r.json().catch(() => null)
      return Array.isArray(j) ? (j as Linha[]) : null
    } catch { return null }
  }
  return {
    async usuario(authorization): Promise<UsuarioDaSessao | null> {
      try {
        const r = await fetchFn(`${cfg.url}/auth/v1/user`, { headers: cab(authorization) })
        if (!r.ok) return null
        const u = (await r.json().catch(() => null)) as { id?: unknown } | null
        const id = texto(u?.id)
        if (!id || !UUID.test(id)) return null
        const p = ((await get(authorization, `profile?id=eq.${id}&select=name,role,organization_id,active`)) ?? [])[0]
        const papel = texto(p?.['role']); const organizacaoId = texto(p?.['organization_id'])
        if (!papel || !organizacaoId) return null
        const nome = texto(p?.['name'])
        return { id, papel, organizacaoId, ativo: p?.['active'] === true, ...(nome ? { nome } : {}) }
      } catch { return null }
    },
    async conversa(authorization, threadId): Promise<ConversaLida | null> {
      if (!UUID.test(threadId)) return null
      const t = ((await get(authorization, `inbox_thread?id=eq.${threadId}&select=id,organization_id,status,context,channel,contact_id`)) ?? [])[0]
      const id = texto(t?.['id']); const organizacaoId = texto(t?.['organization_id']); const contatoId = texto(t?.['contact_id'])
      if (!id || !organizacaoId || !contatoId) return null
      const ids = (await get(authorization, `inbox_contact_identity?contact_id=eq.${contatoId}&channel=in.(EMAIL,PORTAL)&select=channel,identifier`)) ?? []
      // SEM ordem de preferência aqui: a porta só entrega o que o banco tem; quem decide o endereço é
      // `resolverDestinatario` (o canal da conversa vence; mais de um endereço possível é recusa)
      const identidades = ids.flatMap((i) => { const canal = texto(i['channel']); const identificador = texto(i['identifier']); return canal && identificador ? [{ canal, identificador }] : [] })
      return { id, organizacaoId, contatoId, status: texto(t?.['status']) ?? '', contexto: texto(t?.['context']) ?? '', canal: texto(t?.['channel']) ?? '', identidades }
    },
    async entrega(authorization, entregaId): Promise<EntregaLida | null> {
      if (!UUID.test(entregaId)) return null
      const d = ((await get(authorization, `inbox_email_delivery?id=eq.${entregaId}&select=id,thread_id,organization_id,status,requested_at,message_id`)) ?? [])[0]
      const id = texto(d?.['id']); const threadId = texto(d?.['thread_id']); const organizacaoId = texto(d?.['organization_id']); const criadaEm = texto(d?.['requested_at'])
      const estado = estadoDe(d?.['status'])
      if (!id || !threadId || !organizacaoId || !criadaEm || !estado) return null
      const mensagemId = texto(d?.['message_id'])
      return { id, threadId, organizacaoId, estado, criadaEm, ...(mensagemId ? { mensagemId } : {}) }
    },
  }
}

/* ---------------------------------------------------------------
   Livro: RPCs da 0075, com a chave de serviço
--------------------------------------------------------------- */

const estadoDe = (v: unknown): EstadoEntregaEmail | undefined => ((ESTADOS_ENTREGA_EMAIL as readonly unknown[]).includes(v) ? (v as EstadoEntregaEmail) : undefined)
const motivoDe = (v: unknown): MotivoEntrega | undefined => ((MOTIVOS_ENTREGA as readonly unknown[]).includes(v) ? (v as MotivoEntrega) : undefined)
const RECUSAS: readonly RecusaDoLivro[] = ['limite_usuario', 'limite_organizacao', 'entrega_pendente', 'intencao_reutilizada', 'conversa_fechada', 'livro_indisponivel']
/** O código devolvido pela RPC só segue adiante se for do catálogo; qualquer outro vira `livro_indisponivel`. */
export const recusaDoLivro = (v: unknown): RecusaDoLivro => ((RECUSAS as readonly unknown[]).includes(v) ? (v as RecusaDoLivro) : 'livro_indisponivel')

/** Argumentos de cada RPC. Exportados: a prova em PostgreSQL chama a MESMA montagem que a produção. */
export const argsCriar = (p: Parameters<PortaLivro['criar']>[0]): Record<string, unknown> => ({
  p_organization_id: p.organizacaoId, p_thread_id: p.threadId, p_contact_id: p.contatoId, p_requested_by: p.solicitanteId, p_requester_name: p.solicitanteNome,
  p_idempotency_key: p.intencao, p_fingerprint: p.impressao, p_body: p.texto, p_limit_user: p.limiteUsuario, p_limit_org: p.limiteOrganizacao,
})
export const argsTransicionar = (entregaId: string, para: string, d: Parameters<PortaLivro['transicionar']>[2]): Record<string, unknown> => ({
  p_delivery_id: entregaId, p_to: para, p_actor: d.atorId, p_reason: d.motivo ?? null, p_provider_message_id: d.providerMessageId ?? null, p_provider_thread_id: d.providerThreadId ?? null,
})
export const argsAceitar = (entregaId: string, d: Parameters<PortaLivro['aceitar']>[1]): Record<string, unknown> => ({
  p_delivery_id: entregaId, p_actor: d.atorId, p_accepted_at: d.aceitaEm, p_provider_message_id: d.providerMessageId ?? null, p_provider_thread_id: d.providerThreadId ?? null, p_reconciled: d.reconciliada ?? false,
})

/** Lê a entrega devolvida pelas RPCs. Sem `id` ou sem estado do catálogo, não é entrega. */
export function entregaDoJson(r: Linha): EntregaCriada | undefined {
  const e = r['entrega'] as Linha | undefined
  const id = texto(e?.['id']); const estado = estadoDe(e?.['status'])
  if (!e || !id || !estado) return undefined
  const fio = r['fio'] as Linha | undefined
  const rfc = texto(fio?.['rfc_message_id']); const fioThread = texto(fio?.['provider_thread_id'])
  const mensagemId = texto(e['message_id']); const aceitaEm = texto(e['accepted_at']); const motivo = motivoDe(e['reason'])
  return {
    id, estado,
    ...(mensagemId ? { mensagemId } : {}), ...(aceitaEm ? { aceitaEm } : {}), ...(motivo ? { motivo } : {}),
    ...(typeof e['sla_fulfilled'] === 'boolean' ? { cumpriuPrimeiraResposta: e['sla_fulfilled'] } : {}),
    ...(rfc ? { fio: { rfcMessageId: rfc, ...(fioThread ? { providerThreadId: fioThread } : {}) } } : {}),
  }
}

export function portaLivro(cfg: { url: string; chave: string }, fetchFn: typeof fetch): PortaLivro {
  const rpc = async (nome: string, args: Record<string, unknown>): Promise<Linha | null> => {
    try {
      const r = await fetchFn(`${cfg.url}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, 'content-type': 'application/json' }, body: JSON.stringify(args) })
      if (!r.ok) return null
      const j: unknown = await r.json().catch(() => null)
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Linha) : null
    } catch { return null }
  }
  return {
    async criar(p) {
      const r = await rpc('inbox_email_delivery_create', argsCriar(p))
      if (!r) return { ok: false, erro: 'livro_indisponivel' }
      if (r['ok'] !== true) return { ok: false, erro: recusaDoLivro(r['erro']) }
      const entrega = entregaDoJson(r)
      return entrega ? { ok: true, entrega, nova: r['nova'] === true } : { ok: false, erro: 'livro_indisponivel' }
    },
    async transicionar(entregaId, para, dados) {
      const r = await rpc('inbox_email_delivery_transition', argsTransicionar(entregaId, para, dados))
      return r?.['ok'] === true
    },
    async aceitar(entregaId, dados) {
      const r = await rpc('inbox_email_delivery_accept', argsAceitar(entregaId, dados))
      const mensagemId = texto(r?.['message_id'])
      if (!r || r['ok'] !== true || !mensagemId) {
        // aceite repetido (a RPC devolve a entrega já ACCEPTED): é sucesso, com o que está gravado
        const e = r && r['ok'] === true ? entregaDoJson(r) : undefined
        return e?.estado === 'ACCEPTED' && e.mensagemId ? { ok: true, mensagemId: e.mensagemId, cumpriuPrimeiraResposta: e.cumpriuPrimeiraResposta ?? false } : { ok: false }
      }
      return { ok: true, mensagemId, cumpriuPrimeiraResposta: r['cumpriu_primeira_resposta'] === true }
    },
  }
}

/* ---------------------------------------------------------------
   Google: token de acesso e envio
--------------------------------------------------------------- */

export interface ConfigGoogle { clientId: string; clientSecret: string; refreshToken: string; modo: ModoEmail; canario: readonly string[]; timeoutTokenMs?: number; timeoutEnvioMs?: number }

async function chamar(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<RespostaGoogle> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetchFn(url, { ...init, signal: ctl.signal })
    // o corpo é lido para o classificador (campo `error`, `id`); nunca é registrado nem repassado
    const corpo: unknown = await r.json().catch(() => null)
    return { tipo: 'http', status: r.status, corpo }
  } catch (e) {
    return { tipo: ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'tempo' : 'rede' }
  } finally { clearTimeout(t) }
}

export function portaGoogle(cfg: ConfigGoogle, fetchFn: typeof fetch): PortaGoogle {
  return {
    token() {
      const corpo = new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken })
      return chamar(fetchFn, GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo.toString() }, cfg.timeoutTokenMs ?? TIMEOUT_TOKEN_MS)
    },
    async enviar(p) {
      // segunda conferência, na fronteira do efeito externo: nenhum caminho do servidor envia em `disabled`
      // nem para fora da lista do canário, mesmo que chame esta porta sem passar pelo handler
      if (!autorizarDestino(cfg.modo, cfg.canario, p.destino).ok) return { tipo: 'http', status: 403, corpo: { error: 'bloqueado_antes_do_envio' } }
      return chamar(fetchFn, GMAIL_SEND_URL, {
        method: 'POST', headers: { authorization: `Bearer ${p.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: p.raw, ...(p.providerThreadId ? { threadId: p.providerThreadId } : {}) }),
      }, cfg.timeoutEnvioMs ?? TIMEOUT_ENVIO_MS)
    },
  }
}

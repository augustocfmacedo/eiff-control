/**
 * E-mail comercial — o HANDLER de `/api/email-comercial` (docs/email-comercial.md §5 e §6).
 *
 * Puro: tudo o que toca o mundo entra por PORTAS injetadas (sessão do usuário, livro de entregas, Google, relógio).
 * A suíte roda sem rede e conta quantas vezes cada porta foi chamada. As portas reais são da etapa E3.
 *
 * A ordem é a segurança:
 *
 *   1 pedido de forma fechada            qualquer chave a mais é 400 (destinatário e remetente NUNCA vêm do navegador)
 *   2 modo de envio                      `disabled` recusa antes de autenticar em qualquer lugar
 *   3 quem pede                          perfil ATIVO do banco, papel na ação `enviar_email`
 *   4 Server Truth                       conversa e contato lidos com o JWT do usuário (a RLS decide quem enxerga)
 *   5 conteúdo e destino                 validação; lista do canário
 *   6 LIVRO PRIMEIRO                     a entrega nasce (READY) e vai a REQUESTED antes de qualquer chamada ao Google;
 *                                        se a entrega já existia para a intenção, devolve o original e NÃO envia
 *   7 token de acesso                    falha = nada saiu (FAILED)
 *   8 envio, UMA vez, sem nova tentativa
 *   9 desfecho                           ACCEPTED (aceite + mensagem + SLA numa transação) · FAILED · UNKNOWN
 *
 * UNKNOWN nunca é reenviado: só a reconciliação humana o resolve.
 */
import { MATRIZ } from '../permissoes'
import type { Papel } from '../types'
import {
  CONFIRMACAO_NAO_ENVIADO,
  ERROS_EMAIL, autorizarDestino, erroDoMotivo, lerRespostaDoEnvio, lerRespostaDoToken,
  type CodigoErroEmail, type EstadoEntregaEmail, type ModoEmail, type MotivoEntrega, type RespostaGoogle,
} from './emailEnvio'
import {
  MensagemInvalida, NOME_EXIBIDO_PADRAO, corpoComAssinatura, emailValido, impressaoDoPedido, messageIdDaEntrega, montarMensagem,
  rawParaGmail, textoNaConversa, validarConteudo,
} from './emailMensagem'

/* ---------------------------------------------------------------
   Portas
--------------------------------------------------------------- */

export interface AmbienteEmail {
  modo: ModoEmail
  canario: readonly string[]
  /** Endereço remetente (`EIFF_EMAIL_SENDER`). Ausente = integração não configurada. */
  remetente?: string
  nomeExibido?: string
  limiteUsuario: number
  limiteOrganizacao: number
  /** As três variáveis do Google estão presentes? (presença, nunca valor) */
  credenciais: boolean
}

export interface UsuarioDaSessao { id: string; nome?: string; papel: string; organizacaoId: string; ativo: boolean }
export interface IdentidadeDoContato { canal: string; identificador: string }
export interface ConversaLida {
  id: string; organizacaoId: string; status: string; contexto: string; contatoId: string
  /** Canal pelo qual a conversa chegou (PORTAL = formulário do site). */
  canal: string
  /** Identidades do contato no banco, SEM ordem de preferência: quem escolhe é `resolverDestinatario`. */
  identidades: readonly IdentidadeDoContato[]
}
export interface EntregaLida { id: string; threadId: string; organizacaoId: string; estado: EstadoEntregaEmail; criadaEm: string; mensagemId?: string }

/** Leituras feitas COM O JWT DO USUÁRIO: quem não enxerga recebe `null`, e a resposta é a mesma de «não existe». */
export interface PortaSessao {
  usuario(authorization: string): Promise<UsuarioDaSessao | null>
  conversa(authorization: string, threadId: string): Promise<ConversaLida | null>
  entrega(authorization: string, entregaId: string): Promise<EntregaLida | null>
}

export interface EntregaCriada {
  id: string; estado: EstadoEntregaEmail; mensagemId?: string
  /** Fio já existente desta conversa (último envio aceito), para a resposta continuar nele. */
  fio?: { rfcMessageId: string; providerThreadId?: string }
  aceitaEm?: string; cumpriuPrimeiraResposta?: boolean; motivo?: MotivoEntrega
}
export type RecusaDoLivro = Extract<CodigoErroEmail, 'limite_usuario' | 'limite_organizacao' | 'entrega_pendente' | 'intencao_reutilizada' | 'conversa_fechada' | 'livro_indisponivel'>

/** Escritas feitas pelo SERVIDOR (RPCs exclusivas do `service_role`). Nenhuma lança: falha vira resultado. */
export interface PortaLivro {
  /** Cria a entrega READY e o rascunho na conversa, conferindo idempotência, entrega pendente e tetos numa transação. */
  criar(p: {
    organizacaoId: string; threadId: string; contatoId: string; solicitanteId: string; solicitanteNome: string
    intencao: string; impressao: string; texto: string; limiteUsuario: number; limiteOrganizacao: number
  }): Promise<{ ok: true; entrega: EntregaCriada; nova: boolean } | { ok: false; erro: RecusaDoLivro }>
  transicionar(entregaId: string, para: 'REQUESTED' | 'FAILED' | 'UNKNOWN', dados: { atorId: string; motivo?: MotivoEntrega; providerMessageId?: string; providerThreadId?: string }): Promise<boolean>
  /** Aceite: entrega ACCEPTED + mensagem `enviada` + SLA de primeira resposta, numa transação. */
  aceitar(entregaId: string, dados: { atorId: string; aceitaEm: string; providerMessageId?: string; providerThreadId?: string; reconciliada?: boolean }): Promise<{ ok: true; mensagemId: string; cumpriuPrimeiraResposta: boolean } | { ok: false }>
}

export interface PortaGoogle {
  token(): Promise<RespostaGoogle>
  /** `users.messages.send`. A porta confere de novo modo e destino antes de montar a requisição. */
  enviar(p: { accessToken: string; raw: string; destino: string; providerThreadId?: string }): Promise<RespostaGoogle>
}

export interface DepsEmail {
  ambiente: AmbienteEmail
  sessao: PortaSessao
  livro: PortaLivro
  google: PortaGoogle
  agora: () => string
  /** Só operação, estado, código e ids internos. Nunca destinatário, assunto, corpo ou token. */
  log?: (t: Record<string, unknown>) => void
}

export interface PedidoHttp { authorization?: string | null; body: unknown }
export interface RespostaHttp { status: number; corpo: Record<string, unknown> }

/* ---------------------------------------------------------------
   Forma do pedido
--------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ACOES_EMAIL = ['preparar', 'enviar', 'reconciliar', 'saude'] as const
export type AcaoEmail = (typeof ACOES_EMAIL)[number]
const CHAVES: Record<AcaoEmail, readonly string[]> = {
  preparar: ['acao', 'threadId'],
  enviar: ['acao', 'threadId', 'assunto', 'corpo', 'intencao', 'destinatario'],
  reconciliar: ['acao', 'entregaId', 'desfecho'],
  saude: ['acao'],
}
/** Idade mínima para reconciliar uma entrega que ficou em READY/REQUESTED: a função já não pode estar rodando. */
export const ESPERA_RECONCILIACAO_MS = 120_000

export type PedidoEmail =
  | { acao: 'preparar'; threadId: string }
  | { acao: 'enviar'; threadId: string; assunto: string; corpo: string; intencao: string; destinatario: string }
  | { acao: 'reconciliar'; entregaId: string; desfecho: 'encontrado' | 'nao_enviado' }
  | { acao: 'saude' }

export { CONFIRMACAO_NAO_ENVIADO }

/**
 * Chaves fechadas por ação. Qualquer chave a mais — `para`, `de`, `cc`, `remetente`… — é recusa.
 * `destinatario` no envio NÃO escolhe o destino: é o endereço que a pessoa VIU na confirmação, e o servidor só segue se
 * for o mesmo que ele próprio resolve no banco. `confirmacao` só existe (e é exigida) em «não foi enviado».
 */
export function lerPedido(body: unknown): PedidoEmail | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const b = body as Record<string, unknown>
  const acao = b['acao']
  if (typeof acao !== 'string' || !(ACOES_EMAIL as readonly string[]).includes(acao)) return undefined
  const declaraNaoEnviado = acao === 'reconciliar' && b['desfecho'] === 'nao_enviado'
  const permitidas = declaraNaoEnviado ? [...CHAVES.reconciliar, 'confirmacao'] : CHAVES[acao as AcaoEmail]
  if (Object.keys(b).some((k) => !permitidas.includes(k)) || permitidas.some((k) => !(k in b))) return undefined
  const uuid = (k: string) => (typeof b[k] === 'string' && UUID.test(b[k] as string) ? (b[k] as string) : undefined)
  if (acao === 'saude') return { acao }
  if (acao === 'preparar') { const threadId = uuid('threadId'); return threadId ? { acao, threadId } : undefined }
  if (acao === 'reconciliar') {
    const entregaId = uuid('entregaId'); const d = b['desfecho']
    if (!entregaId || (d !== 'encontrado' && d !== 'nao_enviado')) return undefined
    // declarar «não enviado» libera novo envio: sem a confirmação explícita, o pedido nem é lido
    if (d === 'nao_enviado' && b['confirmacao'] !== CONFIRMACAO_NAO_ENVIADO) return undefined
    return { acao, entregaId, desfecho: d }
  }
  const threadId = uuid('threadId'); const intencao = uuid('intencao')
  if (!threadId || !intencao || typeof b['assunto'] !== 'string' || typeof b['corpo'] !== 'string' || typeof b['destinatario'] !== 'string') return undefined
  return { acao: 'enviar', threadId, intencao, assunto: b['assunto'], corpo: b['corpo'], destinatario: b['destinatario'] }
}

/* ---------------------------------------------------------------
   Handler
--------------------------------------------------------------- */

const erro = (codigo: CodigoErroEmail, extra: Record<string, unknown> = {}): RespostaHttp =>
  ({ status: ERROS_EMAIL[codigo].http, corpo: { erro: codigo, mensagem: ERROS_EMAIL[codigo].mensagem, ...extra } })
const ok = (corpo: Record<string, unknown>): RespostaHttp => ({ status: 200, corpo })

export const podeEnviarEmail = (u: Pick<UsuarioDaSessao, 'papel' | 'ativo'>): boolean => u.ativo && (MATRIZ.enviar_email as readonly string[]).includes(u.papel as Papel)

async function autorizar(req: PedidoHttp, d: DepsEmail): Promise<{ authorization: string; usuario: UsuarioDaSessao } | RespostaHttp> {
  const authorization = (req.authorization ?? '').trim()
  if (!/^Bearer\s+\S+/i.test(authorization)) return erro('nao_autenticado')
  const usuario = await d.sessao.usuario(authorization)
  if (!usuario) return erro('nao_autenticado')
  if (!podeEnviarEmail(usuario)) return erro('sem_permissao')
  return { authorization, usuario }
}
const ehResposta = (x: unknown): x is RespostaHttp => !!x && typeof x === 'object' && 'status' in x && 'corpo' in x

const CANAIS_COM_EMAIL = ['EMAIL', 'PORTAL'] as const

/**
 * Para QUAL endereço esta conversa responde. Regra única, sem preferência entre identidades:
 *   1. o endereço do CANAL DA CONVERSA vence: conversa do formulário do site (PORTAL) responde ao e-mail informado no
 *      formulário, mesmo que o contato tenha outra identidade de e-mail; conversa de e-mail responde ao e-mail dela;
 *   2. sem endereço válido no canal da conversa (ou conversa de outro canal), só serve se o contato tiver UM endereço;
 *   3. mais de um endereço possível e nenhum critério seguro = `destinatario_ambiguo`: não se escolhe, não se envia.
 */
export function resolverDestinatario(c: Pick<ConversaLida, 'canal' | 'identidades'>): { ok: true; destino: string } | { ok: false; erro: 'sem_email_valido' | 'destinatario_ambiguo' } {
  const enderecos = (canais: readonly string[]) => [...new Set(c.identidades.filter((i) => canais.includes(i.canal)).map((i) => i.identificador.trim().toLowerCase()).filter((e) => emailValido(e)))]
  const um = (lista: string[]) => (lista.length === 1 ? ({ ok: true, destino: lista[0]! } as const) : ({ ok: false, erro: 'destinatario_ambiguo' } as const))
  if ((CANAIS_COM_EMAIL as readonly string[]).includes(c.canal)) {
    const doCanal = enderecos([c.canal])
    if (doCanal.length > 0) return um(doCanal)
  }
  const todos = enderecos(CANAIS_COM_EMAIL)
  return todos.length === 0 ? { ok: false, erro: 'sem_email_valido' } : um(todos)
}

/** Conversa utilizável para envio, com o destinatário vindo do banco. */
async function lerDestino(authorization: string, threadId: string, usuario: UsuarioDaSessao, d: DepsEmail): Promise<{ conversa: ConversaLida; destino: string } | RespostaHttp> {
  const conversa = await d.sessao.conversa(authorization, threadId)
  // outra organização responde igual a «não existe»: não se confirma a existência do que a pessoa não pode ver
  if (!conversa || conversa.organizacaoId !== usuario.organizacaoId) return erro('conversa_nao_encontrada')
  if (conversa.contexto !== 'EXTERNAL') return erro('conversa_interna')
  if (conversa.status === 'FECHADA') return erro('conversa_fechada')
  const r = resolverDestinatario(conversa)
  if (!r.ok) return erro(r.erro)
  return { conversa, destino: r.destino }
}

function resultadoDaEntrega(e: EntregaCriada, repetida: boolean): RespostaHttp {
  if (e.estado === 'ACCEPTED') return ok({ estado: 'ACCEPTED', entregaId: e.id, mensagemId: e.mensagemId ?? null, enviadaEm: e.aceitaEm ?? null, cumpriuPrimeiraResposta: e.cumpriuPrimeiraResposta ?? false, repetida })
  if (e.estado === 'FAILED') {
    const m = e.motivo
    const codigo: CodigoErroEmail = m && m in erroDoMotivo ? erroDoMotivo[m as keyof typeof erroDoMotivo] : 'provedor_recusou'
    return erro(codigo, { estado: 'FAILED', entregaId: e.id, repetida })
  }
  // READY, REQUESTED ou UNKNOWN: há (ou pode haver) um envio em curso. Nunca se envia de novo a partir daqui.
  return ok({ estado: e.estado === 'UNKNOWN' ? 'UNKNOWN' : 'EM_ANDAMENTO', entregaId: e.id, repetida })
}

export async function tratarEmailComercial(req: PedidoHttp, d: DepsEmail): Promise<RespostaHttp> {
  const pedido = lerPedido(req.body)
  if (!pedido) return erro('pedido_invalido')
  const { ambiente } = d
  const log = (t: Record<string, unknown>) => d.log?.({ evento: 'email_comercial', acao: pedido.acao, modo: ambiente.modo, ...t })

  // 2) desligado recusa o ENVIO antes de qualquer leitura. `preparar` e `saude` continuam respondendo, para a tela
  //    e para quem configura saberem por quê.
  if (pedido.acao === 'enviar' && ambiente.modo === 'disabled') { log({ outcome: 'envio_desligado' }); return erro('envio_desligado') }

  const sessao = await autorizar(req, d)
  if (ehResposta(sessao)) { log({ outcome: sessao.corpo['erro'] }); return sessao }
  const { authorization, usuario } = sessao
  const configurado = ambiente.credenciais && emailValido(ambiente.remetente)

  if (pedido.acao === 'saude') {
    if (!configurado) return ok({ modo: ambiente.modo, credenciais: ambiente.credenciais ? 'presentes' : 'ausentes', remetente: emailValido(ambiente.remetente) ? 'configurado' : 'ausente', token: 'nao_testado' })
    const t = lerRespostaDoToken(await d.google.token())
    log({ outcome: t.ok ? 'token_ok' : t.motivo })
    return ok({ modo: ambiente.modo, credenciais: 'presentes', remetente: 'configurado', token: t.ok ? 'ok' : t.motivo })
  }

  if (pedido.acao === 'preparar') {
    const lido = await lerDestino(authorization, pedido.threadId, usuario, d)
    const base = { modo: ambiente.modo, remetente: emailValido(ambiente.remetente) ? ambiente.remetente : null }
    if (ehResposta(lido)) return ok({ ...base, disponivel: false, motivo: lido.corpo['erro'], mensagem: lido.corpo['mensagem'] })
    // Endereço COMPLETO: quem chega aqui tem a permissão de envio e leu a conversa com o próprio JWT (RLS), e precisa
    // conferir para quem o e-mail vai antes de confirmar. Continua fora de qualquer log.
    const destinatario = lido.destino
    if (ambiente.modo === 'disabled') return ok({ ...base, disponivel: false, motivo: 'envio_desligado', mensagem: ERROS_EMAIL.envio_desligado.mensagem, destinatario })
    if (!configurado) return ok({ ...base, disponivel: false, motivo: 'credencial_indisponivel', mensagem: ERROS_EMAIL.credencial_indisponivel.mensagem, destinatario })
    const destinoOk = autorizarDestino(ambiente.modo, ambiente.canario, lido.destino)
    if (!destinoOk.ok) return ok({ ...base, disponivel: false, motivo: destinoOk.erro, mensagem: ERROS_EMAIL[destinoOk.erro].mensagem, destinatario })
    return ok({ ...base, disponivel: true, destinatario })
  }

  if (pedido.acao === 'reconciliar') {
    const e = await d.sessao.entrega(authorization, pedido.entregaId)
    if (!e || e.organizacaoId !== usuario.organizacaoId) return erro('entrega_nao_encontrada')
    const idadeMs = Date.parse(d.agora()) - Date.parse(e.criadaEm)
    const parada = (e.estado === 'READY' || e.estado === 'REQUESTED') && idadeMs >= ESPERA_RECONCILIACAO_MS
    if (e.estado !== 'UNKNOWN' && !parada) return erro('reconciliacao_indevida', { estado: e.estado })
    // READY nunca chegou ao Google: não pode ser declarada como «encontrada em Enviados»
    if (pedido.desfecho === 'encontrado' && e.estado === 'READY') return erro('reconciliacao_indevida', { estado: e.estado })
    if (pedido.desfecho === 'nao_enviado') {
      const feito = await d.livro.transicionar(e.id, 'FAILED', { atorId: usuario.id, motivo: 'declarado_nao_enviado' })
      log({ outcome: feito ? 'declarado_nao_enviado' : 'livro_indisponivel', entregaId: e.id })
      return feito ? ok({ estado: 'FAILED', entregaId: e.id, reconciliada: true }) : erro('livro_indisponivel')
    }
    // o instante que vale é o do pedido original: foi quando a mensagem saiu
    const a = await d.livro.aceitar(e.id, { atorId: usuario.id, aceitaEm: e.criadaEm, reconciliada: true })
    log({ outcome: a.ok ? 'declarado_encontrado' : 'livro_indisponivel', entregaId: e.id })
    return a.ok ? ok({ estado: 'ACCEPTED', entregaId: e.id, mensagemId: a.mensagemId, enviadaEm: e.criadaEm, cumpriuPrimeiraResposta: a.cumpriuPrimeiraResposta, reconciliada: true }) : erro('livro_indisponivel')
  }

  // ── enviar ──────────────────────────────────────────────────────────────
  if (!emailValido(ambiente.remetente)) return erro('remetente_nao_configurado')
  if (!ambiente.credenciais) return erro('credencial_indisponivel')
  const lido = await lerDestino(authorization, pedido.threadId, usuario, d)
  if (ehResposta(lido)) { log({ outcome: lido.corpo['erro'] }); return lido }
  const { conversa, destino } = lido
  // o endereço que a pessoa confirmou na tela tem de ser o que o banco diz AGORA; divergiu, nada sai
  if (pedido.destinatario.trim().toLowerCase() !== destino) { log({ outcome: 'destinatario_mudou' }); return erro('destinatario_mudou') }
  const problemas = validarConteudo(pedido)
  if (problemas.length > 0) return erro('pedido_invalido', { mensagem: problemas[0] })
  const destinoOk = autorizarDestino(ambiente.modo, ambiente.canario, destino)
  if (!destinoOk.ok) { log({ outcome: destinoOk.erro }); return erro(destinoOk.erro) }

  const assunto = pedido.assunto.trim()
  const corpoFinal = corpoComAssinatura(pedido.corpo, usuario.nome)
  // 6) LIVRO PRIMEIRO
  const criada = await d.livro.criar({
    organizacaoId: usuario.organizacaoId, threadId: conversa.id, contatoId: conversa.contatoId, solicitanteId: usuario.id, solicitanteNome: (usuario.nome ?? '').trim() || 'Usuário',
    intencao: pedido.intencao, impressao: impressaoDoPedido({ para: destino, assunto, corpo: pedido.corpo }), texto: textoNaConversa(assunto, corpoFinal),
    limiteUsuario: ambiente.limiteUsuario, limiteOrganizacao: ambiente.limiteOrganizacao,
  })
  if (!criada.ok) { log({ outcome: criada.erro }); return erro(criada.erro) }
  const entrega = criada.entrega
  // a intenção já tinha entrega (duplo clique, reenvio): devolve o que existe e NÃO chama o Google
  if (!criada.nova) { log({ outcome: 'repetida', estado: entrega.estado, entregaId: entrega.id }); return resultadoDaEntrega(entrega, true) }
  if (entrega.estado !== 'READY') return resultadoDaEntrega(entrega, true)

  let raw: string
  try {
    raw = rawParaGmail(montarMensagem({
      remetente: { nome: ambiente.nomeExibido?.trim() || NOME_EXIBIDO_PADRAO, email: ambiente.remetente }, para: destino, assunto, corpo: corpoFinal,
      messageId: messageIdDaEntrega(entrega.id), em: d.agora(), ...(entrega.fio ? { emRespostaA: entrega.fio.rfcMessageId } : {}),
    }))
  } catch (e) {
    if (!(e instanceof MensagemInvalida)) throw e
    await d.livro.transicionar(entrega.id, 'FAILED', { atorId: usuario.id, motivo: 'mensagem_invalida' })
    log({ outcome: 'mensagem_invalida', entregaId: entrega.id })
    return erro('pedido_invalido', { estado: 'FAILED', entregaId: entrega.id })
  }

  if (!(await d.livro.transicionar(entrega.id, 'REQUESTED', { atorId: usuario.id }))) { log({ outcome: 'livro_indisponivel', entregaId: entrega.id }); return erro('livro_indisponivel', { entregaId: entrega.id }) }

  // 7) token: qualquer falha aqui é «nada saiu»
  const token = lerRespostaDoToken(await d.google.token())
  if (!token.ok) {
    await d.livro.transicionar(entrega.id, 'FAILED', { atorId: usuario.id, motivo: token.motivo })
    log({ outcome: token.motivo, entregaId: entrega.id })
    return erro(erroDoMotivo[token.motivo], { estado: 'FAILED', entregaId: entrega.id })
  }

  // 8) envio, UMA vez
  const envio = lerRespostaDoEnvio(await d.google.enviar({ accessToken: token.accessToken, raw, destino, ...(entrega.fio?.providerThreadId ? { providerThreadId: entrega.fio.providerThreadId } : {}) }))

  if (envio.desfecho === 'FAILED') {
    await d.livro.transicionar(entrega.id, 'FAILED', { atorId: usuario.id, motivo: envio.motivo })
    log({ outcome: envio.motivo, entregaId: entrega.id })
    return erro(erroDoMotivo[envio.motivo], { estado: 'FAILED', entregaId: entrega.id })
  }
  if (envio.desfecho === 'UNKNOWN') {
    await d.livro.transicionar(entrega.id, 'UNKNOWN', { atorId: usuario.id, motivo: 'resultado_desconhecido' })
    log({ outcome: 'resultado_desconhecido', entregaId: entrega.id })
    return ok({ estado: 'UNKNOWN', entregaId: entrega.id })
  }
  // 9) aceite confirmado: entrega + mensagem + SLA numa transação
  const aceitaEm = d.agora()
  const aceite = await d.livro.aceitar(entrega.id, { atorId: usuario.id, aceitaEm, providerMessageId: envio.providerMessageId, ...(envio.providerThreadId ? { providerThreadId: envio.providerThreadId } : {}) })
  if (!aceite.ok) {
    // o e-mail SAIU e o registro falhou: fica como desconhecido, com o id do Google anotado, para a reconciliação
    // concluir. Não se reenvia.
    await d.livro.transicionar(entrega.id, 'UNKNOWN', { atorId: usuario.id, motivo: 'registro_falhou', providerMessageId: envio.providerMessageId, ...(envio.providerThreadId ? { providerThreadId: envio.providerThreadId } : {}) })
    log({ outcome: 'registro_falhou', entregaId: entrega.id })
    return ok({ estado: 'UNKNOWN', entregaId: entrega.id })
  }
  log({ outcome: 'aceito', entregaId: entrega.id, primeiraResposta: aceite.cumpriuPrimeiraResposta })
  return ok({ estado: 'ACCEPTED', entregaId: entrega.id, mensagemId: aceite.mensagemId, enviadaEm: aceitaEm, cumpriuPrimeiraResposta: aceite.cumpriuPrimeiraResposta })
}

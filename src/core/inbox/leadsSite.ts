/**
 * Leads do site: a LEITURA comercial das conversas que entraram pelo formulário.
 *
 * ── O QUE ISTO É ─────────────────────────────────────────────────────────
 *
 * Uma projeção. A conversa continua sendo do EIFF Inbox (`InboxThread`,
 * `InboxMessage`, `ContatoInbox`) e toda mudança continua passando por
 * `actions.inbox*`. Aqui não existe cadastro de lead, não existe segunda
 * conversa e não existe regra nova: lead do site é a conversa de canal
 * `PORTAL` e contexto `EXTERNAL` — exatamente o que a regra `ROT-SITE` casa.
 *
 * O SLA também não é calculado aqui: `estadoSla` e `situacaoPrimeiraResposta`
 * são as leituras do Inbox, e o prazo é o que está gravado na conversa
 * (30 minutos úteis, decididos na gravação da submissão).
 *
 * ── DE ONDE VÊM OS DADOS DO PROJETO ──────────────────────────────────────
 *
 * Do texto da própria mensagem do formulário, que `textoDaMensagem` escreve
 * em linhas rotuladas («Configuração:», «Medidas:», «Prazo informado:»…).
 * `lerSolicitacao` é a leitura inversa dessas linhas. Não há cópia do payload:
 * a evidência completa continua no Lead Engine (`meta.registroFonteId`).
 * O teste `leadsSite.test.ts` prende a ida e a volta — se o formato da
 * mensagem mudar, a leitura quebra no teste, não em silêncio na tela.
 */
import { ehAberta } from './estados'
import { situacaoDoEmail } from './emailTela'
import { CANAL_FORMULARIO } from './formularioSite'
import { contatoDaMensagem, ehRespostaEfetiva, situacaoPrimeiraResposta, type MeioContato, type SituacaoPrimeiraResposta } from './primeiraResposta'
import { estadoSla, ordenarParaTrabalho, threadVisivel, visibilidadeDe, type EstadoSla } from './roteamento'
import type { ContatoInbox, InboxDataset, InboxMessage, InboxThread, ThreadEvent, TipoEventoThread } from './tipos'
import { normalizarTelefone } from '../radar/canais'
import { PRAZO_PRIMEIRA_RESPOSTA_MIN, ROTULO_LEITURA_DA_PAGINA } from '../radar/formularioGravacao'
import type { Usuario } from '../types'

/** O prazo de primeira resposta do lead do site, em minutos ÚTEIS (fonte: a gravação da submissão). */
export const PRAZO_LEAD_DO_SITE_MIN = PRAZO_PRIMEIRA_RESPOSTA_MIN

/** A conversa é um lead do site? Canal e contexto, nunca o texto. */
export const ehLeadDoSite = (t: Pick<InboxThread, 'canal' | 'contexto'>): boolean => t.canal === CANAL_FORMULARIO && t.contexto === 'EXTERNAL'

/* ---------------------------------------------------------------
   1 · A solicitação, lida de volta do texto da mensagem
--------------------------------------------------------------- */

export interface SolicitacaoDoSite {
  /** O que a pessoa escreveu com as próprias palavras. */
  mensagem?: string
  configuracao?: string
  especificacao?: string
  medidas?: string
  prazo?: string
  escopo?: string
  campanha?: string
  /** Texto automático que a página mostrou ao visitante. NÃO é orientação de engenharia. */
  leituraDaPagina: string[]
  /** Nome do formulário, lido da linha de origem. */
  formulario?: string
  /** Partes da linha «Contato:» (nome, empresa, cidade — as que vieram). */
  contato: string[]
  /** Partes da última linha (e-mail, telefone — os que vieram), como a pessoa digitou. */
  canais: string[]
}

const ROTULOS: readonly [keyof Pick<SolicitacaoDoSite, 'configuracao' | 'especificacao' | 'medidas' | 'prazo' | 'escopo' | 'campanha'>, string][] = [
  ['configuracao', 'Configuração:'], ['especificacao', 'Especificação:'], ['medidas', 'Medidas:'],
  ['prazo', 'Prazo informado:'], ['escopo', 'Escopo:'], ['campanha', 'Campanha:'],
]
const ORIGEM = /^Origem: formulário "?([^"\s]+)"? do site/
const partes = (s: string) => s.split(' · ').map((x) => x.trim()).filter((x) => x !== '')

/**
 * Lê a mensagem do formulário de volta em campos. Tudo o que vem ANTES da
 * primeira linha rotulada é a mensagem livre da pessoa; a última linha, sem
 * rótulo, são os canais. Linha que não reconhece não é descartada: vai
 * para a mensagem livre (antes dos rótulos) ou fica de fora (depois), e o
 * texto integral continua na conversa.
 */
export function lerSolicitacao(texto: string): SolicitacaoDoSite {
  const s: SolicitacaoDoSite = { leituraDaPagina: [], contato: [], canais: [] }
  const livre: string[] = []
  let rotulou = false
  let ultimaSolta: string | undefined
  for (const bruta of texto.split('\n')) {
    const l = bruta.trim()
    const campo = ROTULOS.find(([, r]) => l.startsWith(r))
    if (campo) { s[campo[0]] = l.slice(campo[1].length).trim(); rotulou = true; continue }
    if (l.startsWith(`${ROTULO_LEITURA_DA_PAGINA}:`)) { s.leituraDaPagina.push(l.slice(ROTULO_LEITURA_DA_PAGINA.length + 1).trim()); rotulou = true; continue }
    const o = ORIGEM.exec(l)
    if (o) { s.formulario = o[1]; rotulou = true; continue }
    if (l.startsWith('Contato:')) { s.contato = partes(l.slice('Contato:'.length)); rotulou = true; continue }
    if (!rotulou) livre.push(bruta)
    else if (l !== '') ultimaSolta = l
  }
  // `textoDaMensagem` fecha com a linha dos canais (e-mail · telefone), que não tem rótulo e pode vir sem «Contato:» antes.
  const fim = texto.trimEnd().split('\n').pop()?.trim()
  if (ultimaSolta !== undefined && ultimaSolta === fim) s.canais = partes(ultimaSolta)
  const mensagem = livre.join('\n').trim()
  if (mensagem !== '') s.mensagem = mensagem
  return s
}

/* ---------------------------------------------------------------
   2 · O lead: a conversa, o contato e a solicitação, juntos
--------------------------------------------------------------- */

export interface LeadDoSite {
  thread: InboxThread
  contato?: ContatoInbox
  nome: string
  empresa?: string
  cidade?: string
  email?: string
  /** Telefone como a pessoa digitou (ou o normalizado, quando só ele existe). */
  telefone?: string
  /** Telefone em E.164 sem «+», quando é um número válido: base de `tel:` e do WhatsApp. */
  telefoneE164?: string
  /** `simular-galpao`, `iniciar-projeto`… — do `meta.formulario` da mensagem; senão, da linha de origem. */
  formulario?: string
  /** Instante da submissão mais recente. */
  recebidoEm: string
  /** Quantas vezes essa pessoa enviou o formulário nesta conversa. */
  solicitacoes: number
  /** A solicitação mais recente. */
  solicitacao: SolicitacaoDoSite
  sla: EstadoSla
  situacao: SituacaoPrimeiraResposta
  prazoAte?: string
  primeiraRespostaEm?: string
  tentativas: number
  contatosRealizados: number
  rascunhos: number
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const NOME_NAO_IDENTIFICADO = 'Contato não identificado'
const SEPARADOR = ' · '

/**
 * Nome, empresa e cidade do lead — SEM adivinhar.
 *
 * A linha «Contato:» da mensagem é `nome · empresa · cidade`, mas só com as partes que a pessoa preencheu e sem
 * rótulo em cada uma. Com duas partes, «Ana · Goiânia» e «Ana · Lima Indústria» são indistinguíveis; com uma, pode
 * ser qualquer das três. Chamar cidade de empresa (ou o contrário) é pior do que não mostrar: o vendedor liga
 * citando a empresa errada. Então a linha só é lida quando a posição de cada parte é CERTA:
 *
 *   fontes rotuladas (sempre valem)
 *     nome      o do contato do Inbox; senão, o `nomeInformado` da identidade do formulário
 *     empresa   a do contato do Inbox (`empresaNome`)
 *
 *   a linha «Contato:» (só neste caso)
 *     exatamente 3 partes, e a 1ª é o nome conhecido (ou não há nome conhecido)
 *                                       → nome, empresa, cidade, pela ordem em que a linha é escrita
 *
 *   qualquer outro caso                 → nada é lido da linha: a empresa é a do contato (se houver) e a cidade
 *                                         fica «não informada» (undefined)
 *
 * Também é ambíguo quando o nome ou a empresa conhecidos contêm o próprio separador (a linha teria partes a mais).
 * Consequência aceita: lead que não informou empresa aparece com a cidade «não informada», mesmo tendo digitado a
 * cidade. O texto integral da solicitação continua no histórico: nada se perde, só não é rotulado por dedução.
 * O conserto definitivo é a gravação escrever cada campo com rótulo próprio (mudança na integração, fora desta tela).
 */
export function identificarContato(partesDaLinha: readonly string[], contato: Pick<ContatoInbox, 'nome' | 'empresaNome' | 'identidades'> | undefined): { nome: string; empresa?: string; cidade?: string } {
  const conhecido = (s: string | undefined) => (s !== undefined && s.trim() !== '' && s.trim() !== NOME_NAO_IDENTIFICADO ? s.trim() : undefined)
  const nomeDoContato = conhecido(contato?.nome)
  const nomeInformado = conhecido(contato?.identidades.find((i) => i.canal === CANAL_FORMULARIO)?.nomeInformado)
  const empresaDoContato = conhecido(contato?.empresaNome)
  const p = partesDaLinha.map((x) => x.trim()).filter((x) => x !== '')

  const semDeducao = { nome: nomeDoContato ?? nomeInformado ?? NOME_NAO_IDENTIFICADO, ...(empresaDoContato !== undefined ? { empresa: empresaDoContato } : {}) }
  if ([nomeDoContato, nomeInformado, empresaDoContato].some((x) => x?.includes(SEPARADOR.trim()))) return semDeducao
  // Uma ou duas partes: não há como saber qual é qual. Mais de três: algum campo trazia o separador.
  if (p.length !== 3) return semDeducao
  // Três partes só existem quando os três campos vieram. Se há um nome conhecido e a 1ª parte não é ele, a linha não
  // está no formato esperado (campo com separador e outro ausente, ou submissão com outro nome): não se rotula.
  const haNomeConhecido = nomeDoContato !== undefined || nomeInformado !== undefined
  if (haNomeConhecido && p[0] !== nomeDoContato && p[0] !== nomeInformado) return semDeducao
  return { nome: nomeDoContato ?? nomeInformado ?? p[0], empresa: empresaDoContato ?? p[1], cidade: p[2] }
}

/** Monta o lead a partir da conversa. `mensagens` pode ser a lista inteira do Inbox. */
export function leadDoSite(t: InboxThread, contato: ContatoInbox | undefined, mensagens: readonly InboxMessage[], agoraIso: string): LeadDoSite {
  const daConversa = mensagens.filter((m) => m.threadId === t.id)
  const recebidas = daConversa.filter((m) => m.direcao === 'inbound').sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  const doFormulario = recebidas.filter((m) => typeof m.meta?.['formulario'] === 'string')
  const submissoes = doFormulario.length > 0 ? doFormulario : recebidas
  const ultima = submissoes[submissoes.length - 1]
  const solicitacao = lerSolicitacao(ultima?.texto ?? '')
  const metaFormulario = ultima?.meta?.['formulario']

  const identidadePortal = contato?.identidades.find((i) => i.canal === CANAL_FORMULARIO)?.identificador
  const email = [identidadePortal, ...solicitacao.canais].find((x) => x !== undefined && EMAIL.test(x))
  const digitado = solicitacao.canais.find((x) => !EMAIL.test(x))
  const telefoneE164 = normalizarTelefone(digitado) ?? contato?.identidades.find((i) => i.canal === 'WHATSAPP')?.identificador
  const { nome, empresa, cidade } = identificarContato(solicitacao.contato, contato)

  const proprias = daConversa.filter((m) => m.direcao !== 'inbound')
  return {
    thread: t, contato, nome,
    ...(empresa !== undefined ? { empresa } : {}),
    ...(cidade !== undefined ? { cidade } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(digitado !== undefined || telefoneE164 !== undefined ? { telefone: digitado ?? `+${telefoneE164}` } : {}),
    ...(telefoneE164 !== undefined ? { telefoneE164 } : {}),
    ...(typeof metaFormulario === 'string' ? { formulario: metaFormulario } : solicitacao.formulario !== undefined ? { formulario: solicitacao.formulario } : {}),
    recebidoEm: ultima?.em ?? t.abertaEm,
    solicitacoes: Math.max(1, submissoes.length),
    solicitacao,
    sla: estadoSla(t, agoraIso),
    situacao: situacaoPrimeiraResposta(t),
    ...(t.sla ? { prazoAte: t.sla.primeiraRespostaAte } : {}),
    ...(t.sla?.primeiraRespostaEm ? { primeiraRespostaEm: t.sla.primeiraRespostaEm } : {}),
    tentativas: proprias.filter((m) => contatoDaMensagem(m)?.resultado === 'tentativa').length,
    contatosRealizados: proprias.filter((m) => contatoDaMensagem(m)?.resultado === 'realizado').length,
    rascunhos: proprias.filter((m) => m.direcao === 'outbound' && !ehRespostaEfetiva(m)).length,
  }
}

/**
 * Os leads do site que o usuário pode ver, na ORDEM DE TRABALHO do Inbox
 * (prazo vencido primeiro, depois prioridade, depois o mais antigo), com quem
 * ainda aguarda o primeiro contato à frente de quem já foi atendido.
 * A visibilidade é a mesma do Inbox: nenhum recorte novo.
 */
export function leadsDoSite(ds: InboxDataset, usuario: Pick<Usuario, 'id' | 'papel'>, agoraIso: string): LeadDoSite[] {
  const v = visibilidadeDe(usuario, ds.membros)
  const visiveis = ds.threads.filter((t) => ehLeadDoSite(t) && threadVisivel(t, usuario.id, v))
  const leads = ordenarParaTrabalho(visiveis, agoraIso).map((t) => leadDoSite(t, ds.contatos.find((c) => c.id === t.contatoId), ds.mensagens, agoraIso))
  // Quem ainda espera o primeiro contato vem antes de quem já foi atendido; dentro de cada grupo vale a ordem do Inbox.
  return [...leads.filter((l) => l.situacao === 'aguardando'), ...leads.filter((l) => l.situacao !== 'aguardando')]
}

/* ---------------------------------------------------------------
   3 · Filtros operacionais e indicadores
--------------------------------------------------------------- */

export const FILTROS_LEAD = ['abertos', 'aguardando', 'atrasados', 'respondidos', 'meus', 'sem_responsavel', 'encerrados', 'todos'] as const
export type FiltroLead = (typeof FILTROS_LEAD)[number]
export const NOME_FILTRO_LEAD: Record<FiltroLead, string> = {
  abertos: 'Em aberto', aguardando: 'Aguardando 1ª resposta', atrasados: 'Prazo vencido', respondidos: 'Já respondidos',
  meus: 'Meus', sem_responsavel: 'Sem responsável', encerrados: 'Encerrados', todos: 'Todos',
}

const PREDICADO: Record<FiltroLead, (l: LeadDoSite, usuarioId: string) => boolean> = {
  abertos: (l) => ehAberta(l.thread.status),
  aguardando: (l) => l.situacao === 'aguardando',
  atrasados: (l) => l.sla === 'vencido',
  respondidos: (l) => ehAberta(l.thread.status) && l.primeiraRespostaEm !== undefined,
  meus: (l, u) => ehAberta(l.thread.status) && l.thread.responsavelId === u,
  sem_responsavel: (l) => ehAberta(l.thread.status) && !l.thread.responsavelId,
  encerrados: (l) => !ehAberta(l.thread.status),
  todos: () => true,
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface CriterioLeads { filtro: FiltroLead; usuarioId: string; formulario?: string; busca?: string }

/** Filtra sem reordenar: a ordem de trabalho é a que chegou. */
export function filtrarLeads(leads: readonly LeadDoSite[], c: CriterioLeads): LeadDoSite[] {
  const q = semAcento(c.busca?.trim() ?? '')
  const digitos = q.replace(/\D/g, '')
  return leads.filter((l) => {
    if (!PREDICADO[c.filtro](l, c.usuarioId)) return false
    if (c.formulario && l.formulario !== c.formulario) return false
    if (q === '') return true
    const alvo = semAcento([l.nome, l.empresa, l.cidade, l.email, l.telefone, l.solicitacao.configuracao, l.solicitacao.especificacao, l.solicitacao.mensagem].filter(Boolean).join(' '))
    return alvo.includes(q) || (digitos.length >= 4 && (l.telefoneE164 ?? '').includes(digitos))
  })
}

/** Quantos leads cada filtro mostra (para o número ao lado do filtro). */
export function contarPorFiltro(leads: readonly LeadDoSite[], usuarioId: string): Record<FiltroLead, number> {
  const r = {} as Record<FiltroLead, number>
  for (const f of FILTROS_LEAD) r[f] = leads.filter((l) => PREDICADO[f](l, usuarioId)).length
  return r
}

/** Os formulários presentes na lista, em ordem alfabética. */
export const formulariosPresentes = (leads: readonly LeadDoSite[]): string[] =>
  [...new Set(leads.map((l) => l.formulario).filter((x): x is string => x !== undefined))].sort()

export interface ResumoLeads {
  abertos: number
  aguardando: number
  /** Aguardando com o prazo já vencido. */
  atrasados: number
  /** Aguardando com menos de um quarto do prazo restante. */
  vencendo: number
  respondidosNoPrazo: number
  respondidosForaDoPrazo: number
  encerradosSemResposta: number
  semResponsavel: number
}

export function resumoLeads(leads: readonly LeadDoSite[]): ResumoLeads {
  const n = (p: (l: LeadDoSite) => boolean) => leads.filter(p).length
  return {
    abertos: n((l) => ehAberta(l.thread.status)),
    aguardando: n((l) => l.situacao === 'aguardando'),
    atrasados: n((l) => l.sla === 'vencido'),
    vencendo: n((l) => l.sla === 'vencendo'),
    respondidosNoPrazo: n((l) => l.situacao === 'respondida_no_prazo'),
    respondidosForaDoPrazo: n((l) => l.situacao === 'respondida_fora_do_prazo'),
    encerradosSemResposta: n((l) => l.situacao === 'encerrada_sem_resposta'),
    semResponsavel: n((l) => ehAberta(l.thread.status) && !l.thread.responsavelId),
  }
}

/* ---------------------------------------------------------------
   4 · Próxima ação — o que o vendedor faz agora
--------------------------------------------------------------- */

export type CodigoProximaAcao = 'nenhuma' | 'assumir' | 'primeiro_contato_vencido' | 'primeiro_contato' | 'aguardar_cliente' | 'dar_sequencia'
export interface ProximaAcao { codigo: CodigoProximaAcao; texto: string; urgente: boolean }

export function proximaAcao(l: LeadDoSite): ProximaAcao {
  const t = l.thread
  if (!ehAberta(t.status)) return { codigo: 'nenhuma', texto: l.situacao === 'encerrada_sem_resposta' ? 'Nenhuma: conversa encerrada sem contato realizado.' : 'Nenhuma: conversa encerrada.', urgente: false }
  if (l.situacao === 'aguardando') {
    const tentou = l.tentativas > 0 ? ` Já houve ${l.tentativas} tentativa${l.tentativas > 1 ? 's' : ''} sem sucesso.` : ''
    if (!t.responsavelId) return { codigo: 'assumir', texto: `Assumir a conversa e fazer o primeiro contato.${tentou}`, urgente: l.sla === 'vencido' || l.sla === 'vencendo' }
    if (l.sla === 'vencido') return { codigo: 'primeiro_contato_vencido', texto: `Fazer o primeiro contato agora: o prazo de primeira resposta venceu.${tentou}`, urgente: true }
    return { codigo: 'primeiro_contato', texto: `Fazer o primeiro contato dentro do prazo e registrar o contato realizado.${tentou}`, urgente: l.sla === 'vencendo' }
  }
  if (t.status === 'AGUARDANDO_CONTATO') return { codigo: 'aguardar_cliente', texto: 'Aguardar o retorno do cliente. Se demorar, registrar nova tentativa de contato.', urgente: false }
  return { codigo: 'dar_sequencia', texto: 'Dar sequência: qualificar o pedido e combinar o próximo passo com o cliente.', urgente: false }
}

/* ---------------------------------------------------------------
   5 · Histórico: mensagens, tentativas, contatos e movimentos
--------------------------------------------------------------- */

export type TipoItemHistorico = 'solicitacao' | 'mensagem_recebida' | 'contato_realizado' | 'tentativa' | 'rascunho' | 'resposta_enviada' | 'email_nao_enviado' | 'email_sem_confirmacao' | 'nota' | 'movimento'
export const NOME_ITEM_HISTORICO: Record<TipoItemHistorico, string> = {
  solicitacao: 'Solicitação pelo site', mensagem_recebida: 'Mensagem recebida', contato_realizado: 'Contato realizado', tentativa: 'Tentativa sem sucesso',
  rascunho: 'Rascunho (não enviado)', resposta_enviada: 'Resposta enviada', email_nao_enviado: 'E-mail NÃO enviado', email_sem_confirmacao: 'E-mail sem confirmação de envio',
  nota: 'Nota interna', movimento: 'Movimento',
}

export interface ItemHistorico {
  id: string
  tipo: TipoItemHistorico
  /** Instante do fato (para contato declarado, o instante DECLARADO). */
  em: string
  /** Quando foi registrado, se diferente do instante do fato. */
  registradoEm?: string
  autor: string
  meio?: MeioContato
  texto: string
  /** Só contato realizado e resposta enviada por canal cumprem o SLA de primeira resposta. */
  cumpreSla: boolean
}

/** Eventos que contam a história para o vendedor. Os de mensagem ficam de fora: a própria mensagem já está na lista. */
const MOVIMENTOS: readonly TipoEventoThread[] = ['ROUTED', 'ASSIGNED', 'REASSIGNED', 'RELEASED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'THREAD_REOPENED', 'RESOLVED', 'CLOSED', 'SLA_ESCALATED']

function tipoDaMensagem(m: InboxMessage): TipoItemHistorico {
  const c = contatoDaMensagem(m)
  if (c) return c.resultado === 'realizado' ? 'contato_realizado' : 'tentativa'
  if (m.direcao === 'inbound') return typeof m.meta?.['formulario'] === 'string' ? 'solicitacao' : 'mensagem_recebida'
  if (m.direcao === 'interna') return 'nota'
  // e-mail comercial: falha e resultado desconhecido têm nome próprio — não são rascunho comum nem resposta
  const email = situacaoDoEmail(m)
  if (email === 'falhou') return 'email_nao_enviado'
  if (email === 'sem_confirmacao' || email === 'enviando') return 'email_sem_confirmacao'
  return ehRespostaEfetiva(m) ? 'resposta_enviada' : 'rascunho'
}

/** A história da conversa, do mais recente para o mais antigo. */
export function historicoDoLead(threadId: string, mensagens: readonly InboxMessage[], eventos: readonly ThreadEvent[]): ItemHistorico[] {
  const itens: ItemHistorico[] = []
  for (const m of mensagens) {
    if (m.threadId !== threadId) continue
    const meio = contatoDaMensagem(m)?.meio
    itens.push({
      id: m.id, tipo: tipoDaMensagem(m), em: m.em, autor: m.autor.nome, texto: m.texto, cumpreSla: ehRespostaEfetiva(m),
      ...(m.registradaEm && m.registradaEm !== m.em && contatoDaMensagem(m) ? { registradoEm: m.registradaEm } : {}),
      ...(meio ? { meio } : {}),
    })
  }
  for (const e of eventos) {
    if (e.threadId !== threadId || !MOVIMENTOS.includes(e.tipo)) continue
    itens.push({ id: e.id, tipo: 'movimento', em: e.em, autor: e.ator.nome, texto: e.detalhe, cumpreSla: false })
  }
  return itens.sort((a, b) => Date.parse(b.em) - Date.parse(a.em) || b.id.localeCompare(a.id))
}

/* ---------------------------------------------------------------
   6 · Meios de contato e o rascunho de e-mail
--------------------------------------------------------------- */

export interface LinksDeContato { telefone?: string; whatsapp?: string; email?: string }

/**
 * Atalhos para o vendedor falar com o lead PELO PRÓPRIO aparelho ou programa
 * de e-mail. Abrir o atalho não registra nada e não cumpre prazo: depois de
 * falar, o contato é declarado em `actions.inboxRegistrarContato`.
 */
export function linksDeContato(l: Pick<LeadDoSite, 'telefoneE164' | 'email'>, email?: { assunto: string; corpo: string }): LinksDeContato {
  const r: LinksDeContato = {}
  if (l.telefoneE164) { r.telefone = `tel:+${l.telefoneE164}`; r.whatsapp = `https://wa.me/${l.telefoneE164}` }
  if (l.email) {
    const q = email ? `?subject=${encodeURIComponent(email.assunto)}&body=${encodeURIComponent(email.corpo)}` : ''
    r.email = `mailto:${l.email}${q}`
  }
  return r
}

export interface RascunhoDeEmail { para: string; assunto: string; corpo: string }

/** Ponto de partida do e-mail: saudação, referência ao pedido e assinatura. O vendedor escreve o resto. */
// SEM assinatura: quem assina («nome do atendente + EIFF») é `corpoComAssinatura`, igual no envio pelo servidor, no
// rascunho e no atalho do programa de e-mail. Assinar aqui também duplicaria.
export function sugestaoDeEmail(l: LeadDoSite): Omit<RascunhoDeEmail, 'para'> {
  const primeiroNome = l.nome === NOME_NAO_IDENTIFICADO ? '' : l.nome.trim().split(/\s+/)[0]
  const pedido = l.solicitacao.configuracao ? `Recebemos sua solicitação pelo site (${l.solicitacao.configuracao}).` : 'Recebemos sua solicitação pelo site.'
  return {
    assunto: 'EIFF · sua solicitação de galpão',
    corpo: `${primeiroNome ? `Olá, ${primeiroNome}.` : 'Olá.'}\n\n${pedido}\n\n`,
  }
}

export const MARCA_RASCUNHO_EMAIL = 'E-mail (rascunho, NÃO enviado)'

/** Recusas do rascunho de e-mail, em texto que a tela mostra. Lista vazia = pode registrar. */
export function validarRascunhoDeEmail(r: RascunhoDeEmail): string[] {
  const erros: string[] = []
  if (!EMAIL.test(r.para.trim())) erros.push('O lead não tem e-mail válido para o rascunho.')
  if (r.assunto.trim() === '') erros.push('Escreva o assunto do e-mail.')
  if (r.corpo.trim() === '') erros.push('Escreva o corpo do e-mail.')
  return erros
}

/**
 * O texto que vai para `actions.inboxResponder`. Hoje a resposta fica como
 * rascunho `registrada` — nada sai — e o cabeçalho diz isso na própria conversa.
 */
export function textoDoRascunhoDeEmail(r: RascunhoDeEmail): string {
  return `${MARCA_RASCUNHO_EMAIL}\nPara: ${r.para.trim()}\nAssunto: ${r.assunto.trim()}\n\n${r.corpo.trim()}`
}

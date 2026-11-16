/**
 * Central de Gestão Comercial EIFF (E11.0) — a LEITURA consolidada do comercial.
 *
 * ── O QUE ISTO É ─────────────────────────────────────────────────────────
 *
 * Uma projeção pura sobre o que já existe. Nada aqui grava, decide prioridade
 * ou cria entidade. Cada número aponta para a autoridade que o produz:
 *
 *   conversa, SLA de 1ª resposta, lead do site   → EIFF Inbox (`leadsDoSite`, `estadoSla`)
 *   candidato e revisão de entrada               → Lead Engine (`radar_source_record`)
 *   empresa, oportunidade, atividade, tarefa     → Radar
 *   o que fazer primeiro e oportunidade parada   → Commercial Machine (CM1-A, `construirCommercialQueue`)
 *   custo, preço e margem do orçamento           → módulo de Orçamentos (`calcOrcamento`)
 *
 * A ordem das listas é a da autoridade (ordem de trabalho do Inbox, prazo da
 * tarefa, posição da fila CM1-A). Não existe ranking próprio da Central.
 *
 * ── O QUE NÃO EXISTE (e por isso não é inventado) ────────────────────────
 *
 *   PROPOSTA COMERCIAL   não há entidade com revisões, condições e validade.
 *                        A Central mostra os SINAIS dela no Radar (estágios
 *                        PRICING / PROPOSAL_SENT / NEGOTIATION, atividade e
 *                        tarefa do tipo PROPOSAL) e diz que é sinal.
 *   PEDIDO DE PROJETO    não há entidade. Sinais: lead do site com configuração
 *                        do simulador, oportunidade em PROJECT_RECEIVED /
 *                        ENGINEERING e atividade com resultado REQUESTED_BUDGET /
 *                        REQUESTED_TECHNICAL_ANALYSIS. Documentos: indisponível.
 *   ORÇAMENTO × NEGÓCIO  `Orcamento.cliente` é texto livre; não há vínculo com a
 *                        empresa ou a oportunidade do Radar. Nunca se casa por nome.
 *   REAGENDAMENTO        tarefa e próxima ação não guardam histórico de prazo.
 *
 * Ausência de fonte é `indisponivel` (com motivo), nunca zero.
 * O desenho e as lacunas estão em docs/central-gestao-comercial.md.
 */
import { calcOrcamento, type Catalogo } from '../orcamentos'
import type { Orcamento, Usuario } from '../types'
import { ehAberta } from '../inbox/estados'
import { estadoSla, threadVisivel, visibilidadeDe, type EstadoSla } from '../inbox/roteamento'
import { situacaoPrimeiraResposta, type SituacaoPrimeiraResposta } from '../inbox/primeiraResposta'
import type { InboxDataset, InboxMessage, InboxThread } from '../inbox/tipos'
import { ehLeadDoSite, historicoDoLead, leadsDoSite, lerSolicitacao, proximaAcao, type LeadDoSite, type SolicitacaoDoSite } from '../inbox/leadsSite'
import { construirCommercialQueue, NOME_CATEGORIA_CM, TEXTO_RAZAO_CM, type CategoriaCommercialQueue, type CommercialQueue } from '../radar/commercialMachine'
import { estagioAtivo, type Atividade, type Empresa, type Estagio, type Oportunidade, type RadarDataset } from '../radar/types'

/* ---------------------------------------------------------------
   0 · Vocabulário
--------------------------------------------------------------- */

export const AREAS_CENTRAL = ['visao', 'leads', 'retornos', 'propostas', 'projetos', 'pipeline'] as const
export type AreaCentral = (typeof AREAS_CENTRAL)[number]
export const NOME_AREA: Record<AreaCentral, string> = {
  visao: 'Painel geral', leads: 'Leads e atendimentos', retornos: 'Agenda e retornos',
  propostas: 'Orçamentos e propostas', projetos: 'Solicitações de projetos', pipeline: 'Pipeline comercial',
}
export const ehArea = (x: string | null | undefined): x is AreaCentral => !!x && (AREAS_CENTRAL as readonly string[]).includes(x)

/** Janelas de leitura (apresentação, não SLA nem regra de negócio). */
export const JANELAS_CENTRAL = { recebidosDias: 30, proximosDias: 7, desfechosDias: 90, previsaoMeses: 3 } as const

/**
 * Ensaios internos do formulário. Fonte: docs/formulario-site-go2-go3.md §1.3.1 («qualquer métrica futura de leads
 * do site ou de cumprimento do prazo precisa excluir os ensaios PELOS IDS desta tabela»). As conversas continuam no
 * histórico (encerradas); aqui só saem dos indicadores e das listas de trabalho. Ensaio novo entra na tabela do doc
 * E aqui no mesmo dia. A etiqueta `ensaio` também é reconhecida, para quando houver ação para preenchê-la.
 */
export const CONVERSAS_DE_ENSAIO: readonly string[] = [
  '5ec4fc0c-64c5-4dfa-844d-8675d33faa41', // ensaio do GO-1, submissão 6af379040c7080bc34020601 (10/11), fechada em 16/11
  '9118f1e4-065d-4848-b0cf-ebc7018eefd1', // ensaio E10.9, submissão 6af761a6cbe0316d6d3211b9 (13/11), fechada em 13/11
]
/**
 * Submissões de ensaio — os MESMOS identificadores da lista de exclusão da reconciliação (`EIFF_FORM_EXCLUIDOS`,
 * §1.3.1). A mensagem do formulário guarda o id da submissão em `externalMessageId` (a chave de idempotência da
 * gravação), então a conversa é reconhecida como ensaio mesmo sem saber o id da conversa (o E10.4, que nunca entrou,
 * seria reconhecido se um dia entrasse).
 */
export const SUBMISSOES_DE_ENSAIO: readonly string[] = ['6af379040c7080bc34020601', '6af72bc662ddce941fc27637', '6af761a6cbe0316d6d3211b9']
export const ETIQUETA_ENSAIO = 'ensaio'
const doFormulario = (m: InboxMessage) => m.direcao === 'inbound' && typeof m.meta?.['formulario'] === 'string'
/** Submissão de ensaio? (pela mensagem do formulário) */
export const ehSubmissaoDeEnsaio = (m: Pick<InboxMessage, 'externalMessageId'>) => !!m.externalMessageId && SUBMISSOES_DE_ENSAIO.includes(m.externalMessageId)
/**
 * Conversa de ensaio: id listado, etiqueta `ensaio`, ou TODAS as submissões do formulário nela são de ensaio
 * (uma submissão real na mesma conversa faz dela uma conversa real).
 */
export function ehEnsaio(t: Pick<InboxThread, 'id' | 'labels'>, mensagens: readonly InboxMessage[] = []): boolean {
  if (CONVERSAS_DE_ENSAIO.includes(t.id) || t.labels.includes(ETIQUETA_ENSAIO)) return true
  const subs = mensagens.filter((m) => m.threadId === t.id && doFormulario(m))
  return subs.length > 0 && subs.every(ehSubmissaoDeEnsaio)
}

export const NOME_ESTAGIO: Record<Estagio, string> = {
  DETECTED: 'Detectada', RESEARCHING: 'Pesquisa', QUALIFIED: 'Qualificada', DECISION_MAKER_FOUND: 'Decisor encontrado', CONTACT_STARTED: 'Contato iniciado',
  ENGAGED: 'Engajada', NEED_CONFIRMED: 'Necessidade confirmada', PROJECT_RECEIVED: 'Projeto recebido', ENGINEERING: 'Engenharia', PRICING: 'Precificação',
  PROPOSAL_SENT: 'Proposta enviada', NEGOTIATION: 'Negociação', WON: 'Ganha', LOST: 'Perdida', NURTURE: 'Nutrição',
}
/** Estágios que sinalizam proposta em andamento (não há entidade de proposta). */
export const ESTAGIOS_PROPOSTA: readonly Estagio[] = ['PRICING', 'PROPOSAL_SENT', 'NEGOTIATION']
/** Estágios que sinalizam pedido de projeto recebido/em engenharia (não há entidade de pedido de projeto). */
export const ESTAGIOS_PROJETO: readonly Estagio[] = ['PROJECT_RECEIVED', 'ENGINEERING']

/** Indicador: número, ou indisponível com o motivo. Nunca zero no lugar de "não sei". */
export type Indicador = { valor: number; motivo?: undefined } | { valor: null; motivo: string }
const ind = (valor: number): Indicador => ({ valor })
const indisponivel = (motivo: string): Indicador => ({ valor: null, motivo })

export interface FontesCentral {
  /** Ausente = o Inbox não foi carregado (não é "zero leads"). */
  inbox?: InboxDataset
  radar: RadarDataset
  orcamentos: readonly Orcamento[]
  catalogo: Catalogo
  usuarios: readonly Pick<Usuario, 'id' | 'nome' | 'ativo'>[]
}

export interface ContextoCentral {
  usuario: Pick<Usuario, 'id' | 'papel'>
  /** Instante (ISO) para o SLA do Inbox. */
  agoraIso: string
  /** Data-base (YYYY-MM-DD) usada pelo Radar e pela fila CM1-A. */
  hoje: string
  /** O usuário tem a permissão `inbox` (sem ela, leads e atendimentos são indisponíveis). */
  veInbox: boolean
}

/* ---------------------------------------------------------------
   Utilitários de data (YYYY-MM-DD)
--------------------------------------------------------------- */

const dia = (s: string) => s.slice(0, 10)
const somarDias = (d: string, n: number) => new Date(Date.parse(`${dia(d)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${dia(ate)}T00:00:00Z`) - Date.parse(`${dia(de)}T00:00:00Z`)) / 86_400_000)
const nomeDe = (fontes: FontesCentral, id?: string) => (id ? fontes.usuarios.find((u) => u.id === id)?.nome ?? `usuário ${id}` : undefined)
export const nomeEmpresa = (e: Pick<Empresa, 'nomeFantasia' | 'razaoSocial'>) => e.nomeFantasia ?? e.razaoSocial

/* ---------------------------------------------------------------
   Dossiê: a chave canônica
--------------------------------------------------------------- */

/**
 * O dossiê é sempre de UMA entidade canônica: a empresa do Radar, ou — quando
 * a conversa ainda não foi associada a nenhuma empresa — a conversa do Inbox.
 * Um lead cujo contato já tem `empresaRadarId` cai no dossiê da empresa: nunca
 * existem dois dossiês para o mesmo cliente.
 */
export type ChaveDossie = `empresa:${string}` | `contato:${string}`
export const chaveEmpresa = (id: string): ChaveDossie => `empresa:${id}`
/** Contato do Inbox ainda sem empresa no Radar: todas as conversas dele (site, WhatsApp, e-mail) num dossiê só. */
export const chaveContato = (id: string): ChaveDossie => `contato:${id}`
export function lerChaveDossie(s: string | null | undefined): { tipo: 'empresa' | 'contato'; id: string } | undefined {
  const m = /^(empresa|contato):(.+)$/.exec(s ?? '')
  return m ? { tipo: m[1] as 'empresa' | 'contato', id: m[2] } : undefined
}

/**
 * Empresa do Radar associada à conversa, por um de dois vínculos REAIS e rastreáveis (nunca por nome):
 *   1. `ContatoInbox.empresaRadarId` (coluna `radar_company_id` do contato);
 *   2. a promoção humana do candidato no Lead Engine: a mensagem do formulário guarda `meta.registroFonteId`
 *      (o `radar_source_record` gravado junto com a conversa) e a decisão RESOLVED (Associar/Criar empresa, aba
 *      Candidatos) grava `entidadeId` = empresa. Candidato rejeitado ou pendente não associa nada.
 */
export function empresaDaConversa(t: Pick<InboxThread, 'id' | 'contatoId'>, inbox: Pick<InboxDataset, 'contatos' | 'mensagens'>, radar: RadarDataset): Empresa | undefined {
  const ativa = (id?: string) => (id ? radar.empresas.find((e) => e.id === id && e.ativo) : undefined)
  const pelaFicha = ativa(inbox.contatos.find((c) => c.id === t.contatoId)?.empresaRadarId)
  if (pelaFicha) return pelaFicha
  const registros = inbox.mensagens.filter((m) => m.threadId === t.id && typeof m.meta?.['registroFonteId'] === 'string').map((m) => String(m.meta!['registroFonteId']))
  for (const id of registros.reverse()) {
    const rf = radar.registrosFonte.find((x) => x.id === id)
    if (rf?.statusIntake === 'RESOLVED') { const e = ativa(rf.entidadeId); if (e) return e }
  }
  return undefined
}
export const chaveDaConversa = (t: InboxThread, inbox: InboxDataset, radar: RadarDataset): ChaveDossie => {
  const e = empresaDaConversa(t, inbox, radar)
  return e ? chaveEmpresa(e.id) : chaveContato(t.contatoId)
}

/* ---------------------------------------------------------------
   B · Leads e atendimentos (autoridade: EIFF Inbox)
--------------------------------------------------------------- */

export type OrigemAtendimento = 'site' | 'conversa'
export interface LinhaAtendimento {
  threadId: string
  origem: OrigemAtendimento
  /** Formulário (`simular-galpao`, `iniciar-projeto`) ou canal da conversa. */
  canalOuFormulario: string
  nome: string
  empresa?: string
  cidade?: string
  /** Configuração do galpão vinda do simulador (texto como a página escreveu). */
  configuracao?: string
  medidas?: string
  especificacao?: string
  prazoInformado?: string
  assunto: string
  status: InboxThread['status']
  aberta: boolean
  ensaio: boolean
  responsavelId?: string
  responsavelNome?: string
  sla: EstadoSla
  situacao: SituacaoPrimeiraResposta
  prazoAte?: string
  primeiraRespostaEm?: string
  recebidoEm: string
  proximaAcao: string
  urgente: boolean
  tentativas: number
  contatosRealizados: number
  /** Qualificação: o que o Inbox já classificou (intenção) ou "não qualificado". */
  qualificacao?: string
  dossie: ChaveDossie
  /** Para onde o vendedor vai agir (tela da autoridade). */
  link: string
}

const linhaDoLead = (l: LeadDoSite, fontes: FontesCentral, inbox: InboxDataset): LinhaAtendimento => {
  const pa = proximaAcao(l)
  return {
    threadId: l.thread.id, origem: 'site', canalOuFormulario: l.formulario ?? 'formulário do site', nome: l.nome,
    ...(l.empresa ? { empresa: l.empresa } : {}), ...(l.cidade ? { cidade: l.cidade } : {}),
    ...(l.solicitacao.configuracao ? { configuracao: l.solicitacao.configuracao } : {}),
    ...(l.solicitacao.medidas ? { medidas: l.solicitacao.medidas } : {}),
    ...(l.solicitacao.especificacao ? { especificacao: l.solicitacao.especificacao } : {}),
    ...(l.solicitacao.prazo ? { prazoInformado: l.solicitacao.prazo } : {}),
    assunto: l.thread.assunto, status: l.thread.status, aberta: ehAberta(l.thread.status), ensaio: ehEnsaio(l.thread, inbox.mensagens),
    ...(l.thread.responsavelId ? { responsavelId: l.thread.responsavelId, responsavelNome: nomeDe(fontes, l.thread.responsavelId) } : {}),
    sla: l.sla, situacao: l.situacao, ...(l.prazoAte ? { prazoAte: l.prazoAte } : {}), ...(l.primeiraRespostaEm ? { primeiraRespostaEm: l.primeiraRespostaEm } : {}),
    recebidoEm: l.recebidoEm, proximaAcao: pa.texto, urgente: pa.urgente, tentativas: l.tentativas, contatosRealizados: l.contatosRealizados,
    ...(l.thread.classificacao?.intencao ? { qualificacao: l.thread.classificacao.intencao } : {}),
    dossie: chaveDaConversa(l.thread, inbox, fontes.radar), link: `/atendimento/leads?t=${encodeURIComponent(l.thread.id)}`,
  }
}

function linhaDaConversa(t: InboxThread, fontes: FontesCentral, inbox: InboxDataset, agoraIso: string): LinhaAtendimento {
  const c = inbox.contatos.find((x) => x.id === t.contatoId)
  const sla = estadoSla(t, agoraIso)
  const situacao = situacaoPrimeiraResposta(t)
  const aberta = ehAberta(t.status)
  const texto = !aberta ? 'Nenhuma: conversa encerrada.'
    : situacao === 'aguardando' ? (t.responsavelId ? 'Responder ao contato dentro do prazo.' : 'Assumir a conversa e responder ao contato.')
    : t.status === 'AGUARDANDO_CONTATO' ? 'Aguardar o retorno do contato.' : 'Dar sequência ao atendimento.'
  return {
    threadId: t.id, origem: 'conversa', canalOuFormulario: t.canal, nome: c?.nome ?? 'Contato não identificado',
    ...(c?.empresaNome ? { empresa: c.empresaNome } : {}),
    assunto: t.assunto, status: t.status, aberta, ensaio: ehEnsaio(t, inbox.mensagens),
    ...(t.responsavelId ? { responsavelId: t.responsavelId, responsavelNome: nomeDe(fontes, t.responsavelId) } : {}),
    sla, situacao, ...(t.sla ? { prazoAte: t.sla.primeiraRespostaAte } : {}), ...(t.sla?.primeiraRespostaEm ? { primeiraRespostaEm: t.sla.primeiraRespostaEm } : {}),
    recebidoEm: t.abertaEm, proximaAcao: texto, urgente: aberta && situacao === 'aguardando' && (sla === 'vencido' || sla === 'vencendo'),
    tentativas: 0, contatosRealizados: 0, ...(t.classificacao?.intencao ? { qualificacao: t.classificacao.intencao } : {}),
    dossie: chaveDaConversa(t, inbox, fontes.radar), link: `/atendimento?t=${encodeURIComponent(t.id)}`,
  }
}

/**
 * Leads do site (ordem de trabalho do Inbox) seguidos das demais conversas EXTERNAS do setor Comercial.
 * A visibilidade é a do Inbox (setor, responsável, transversal): nenhum recorte novo.
 */
export function atendimentosComerciais(fontes: FontesCentral, ctx: ContextoCentral): LinhaAtendimento[] | undefined {
  const inbox = fontes.inbox
  if (!inbox || !ctx.veInbox) return undefined
  const site = leadsDoSite(inbox, ctx.usuario, ctx.agoraIso).map((l) => linhaDoLead(l, fontes, inbox))
  const v = visibilidadeDe(ctx.usuario, inbox.membros)
  const outras = inbox.threads
    .filter((t) => !ehLeadDoSite(t) && t.contexto === 'EXTERNAL' && t.setorCodigo === 'COMERCIAL' && threadVisivel(t, ctx.usuario.id, v))
    .sort((a, b) => Date.parse(b.ultimaMensagemEm) - Date.parse(a.ultimaMensagemEm))
    .map((t) => linhaDaConversa(t, fontes, inbox, ctx.agoraIso))
  return [...site, ...outras]
}

export const FILTROS_ATENDIMENTO = ['abertos', 'aguardando', 'atrasados', 'meus', 'sem_responsavel', 'site', 'encerrados', 'ensaios', 'todos'] as const
export type FiltroAtendimento = (typeof FILTROS_ATENDIMENTO)[number]
export const NOME_FILTRO_ATENDIMENTO: Record<FiltroAtendimento, string> = {
  abertos: 'Em aberto', aguardando: 'Aguardando 1ª resposta', atrasados: 'Prazo vencido', meus: 'Meus', sem_responsavel: 'Sem responsável',
  site: 'Só do site', encerrados: 'Encerrados', ensaios: 'Ensaios internos', todos: 'Todos',
}
const PRED_ATEND: Record<FiltroAtendimento, (l: LinhaAtendimento, u: string) => boolean> = {
  abertos: (l) => l.aberta && !l.ensaio,
  aguardando: (l) => l.situacao === 'aguardando' && !l.ensaio,
  atrasados: (l) => l.sla === 'vencido' && !l.ensaio,
  meus: (l, u) => l.aberta && l.responsavelId === u,
  sem_responsavel: (l) => l.aberta && !l.responsavelId && !l.ensaio,
  site: (l) => l.origem === 'site' && !l.ensaio,
  encerrados: (l) => !l.aberta && !l.ensaio,
  ensaios: (l) => l.ensaio,
  todos: () => true,
}
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function filtrarAtendimentos(linhas: readonly LinhaAtendimento[], filtro: FiltroAtendimento, usuarioId: string, busca = ''): LinhaAtendimento[] {
  const q = semAcento(busca.trim())
  return linhas.filter((l) => PRED_ATEND[filtro](l, usuarioId) && (q === '' || semAcento([l.nome, l.empresa, l.cidade, l.assunto, l.configuracao, l.medidas, l.responsavelNome].filter(Boolean).join(' ')).includes(q)))
}
export const contarAtendimentos = (linhas: readonly LinhaAtendimento[], usuarioId: string): Record<FiltroAtendimento, number> =>
  Object.fromEntries(FILTROS_ATENDIMENTO.map((f) => [f, linhas.filter((l) => PRED_ATEND[f](l, usuarioId)).length])) as Record<FiltroAtendimento, number>

/* ---------------------------------------------------------------
   C · Retornos e acompanhamentos (autoridades: Radar, Inbox, CM1-A)
--------------------------------------------------------------- */

export type SituacaoPrazo = 'vencido' | 'hoje' | 'proximo' | 'futuro'
export const NOME_SITUACAO_PRAZO: Record<SituacaoPrazo, string> = { vencido: 'Vencido', hoje: 'Hoje', proximo: 'Próximos 7 dias', futuro: 'Mais adiante' }
export function situacaoDoPrazo(venceEm: string, hoje: string): SituacaoPrazo {
  const d = diasEntre(hoje, venceEm)
  return d < 0 ? 'vencido' : d === 0 ? 'hoje' : d <= JANELAS_CENTRAL.proximosDias ? 'proximo' : 'futuro'
}

export type TipoRetorno = 'tarefa' | 'proxima_acao' | 'primeiro_contato'
export const NOME_TIPO_RETORNO: Record<TipoRetorno, string> = { tarefa: 'Tarefa do Radar', proxima_acao: 'Próxima ação da oportunidade', primeiro_contato: '1ª resposta do lead' }
export interface Retorno {
  id: string
  tipo: TipoRetorno
  descricao: string
  cliente: string
  responsavelId?: string
  responsavelNome?: string
  venceEm: string
  situacao: SituacaoPrazo
  diasAtraso: number
  dossie: ChaveDossie
  link: string
}

/**
 * Tudo o que tem prazo de retorno, cada item uma vez e no registro que o guarda:
 * tarefa aberta do Radar, próxima ação da oportunidade ativa e primeiro contato
 * do lead ainda aguardando. Ordem: prazo (o mais antigo primeiro), depois id.
 */
export function retornos(fontes: FontesCentral, ctx: ContextoCentral, atendimentos?: readonly LinhaAtendimento[]): Retorno[] {
  const r = fontes.radar
  const empresa = (id: string) => r.empresas.find((e) => e.id === id)
  const itens: Retorno[] = []
  for (const t of r.tarefas) {
    if (t.status !== 'Aberta') continue
    const e = empresa(t.empresaId)
    itens.push({
      id: `tarefa:${t.id}`, tipo: 'tarefa', descricao: t.descricao || t.tipo, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada',
      responsavelId: t.responsavelId, responsavelNome: nomeDe(fontes, t.responsavelId), venceEm: dia(t.venceEm), situacao: situacaoDoPrazo(t.venceEm, ctx.hoje),
      diasAtraso: Math.max(0, diasEntre(t.venceEm, ctx.hoje)), dossie: chaveEmpresa(t.empresaId), link: `/radar/empresas/${t.empresaId}`,
    })
  }
  for (const o of r.oportunidades) {
    if (!estagioAtivo(o.estagio) || !o.proximaAcaoEm) continue
    const e = empresa(o.empresaId)
    itens.push({
      id: `oportunidade:${o.id}`, tipo: 'proxima_acao', descricao: o.proximaAcao || `Próxima ação de «${o.titulo}»`, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada',
      responsavelId: o.responsavelId, responsavelNome: nomeDe(fontes, o.responsavelId), venceEm: dia(o.proximaAcaoEm), situacao: situacaoDoPrazo(o.proximaAcaoEm, ctx.hoje),
      diasAtraso: Math.max(0, diasEntre(o.proximaAcaoEm, ctx.hoje)), dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}`,
    })
  }
  for (const l of atendimentos ?? []) {
    if (!l.aberta || l.ensaio || l.situacao !== 'aguardando' || !l.prazoAte) continue
    const hojeLocal = dia(ctx.agoraIso)
    itens.push({
      id: `conversa:${l.threadId}`, tipo: 'primeiro_contato', descricao: l.proximaAcao, cliente: l.empresa ? `${l.nome} · ${l.empresa}` : l.nome, ...(l.empresa ? { empresaCliente: l.empresa } : {}),
      ...(l.responsavelId ? { responsavelId: l.responsavelId, responsavelNome: l.responsavelNome } : {}),
      venceEm: dia(l.prazoAte), situacao: l.sla === 'vencido' ? 'vencido' : situacaoDoPrazo(l.prazoAte, hojeLocal),
      diasAtraso: Math.max(0, diasEntre(l.prazoAte, hojeLocal)), dossie: l.dossie, link: l.link,
    })
  }
  return itens.sort((a, b) => (a.venceEm < b.venceEm ? -1 : a.venceEm > b.venceEm ? 1 : a.id.localeCompare(b.id)))
}

export interface OportunidadeSemAcao { oportunidadeId: string; titulo: string; cliente: string; estagio: Estagio; responsavelNome?: string; dossie: ChaveDossie; link: string }
/** Oportunidade ativa sem próxima ação e sem tarefa aberta: a regra do Radar (`semProximaAcao`), lida aqui. */
export function oportunidadesSemProximaAcao(fontes: FontesCentral): OportunidadeSemAcao[] {
  const r = fontes.radar
  return r.oportunidades
    .filter((o) => estagioAtivo(o.estagio) && !o.proximaAcaoEm && !r.tarefas.some((t) => t.oportunidadeId === o.id && t.status === 'Aberta'))
    .map((o) => { const e = r.empresas.find((x) => x.id === o.empresaId); return { oportunidadeId: o.id, titulo: o.titulo, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', estagio: o.estagio, responsavelNome: nomeDe(fontes, o.responsavelId), dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}` } })
}

export interface OportunidadeParada { oportunidadeId: string; titulo: string; cliente: string; estagio: Estagio; dias: number; critica: boolean; categoria: string; dossie: ChaveDossie; link: string }
/**
 * Oportunidades paradas SEGUNDO A FILA CM1-A (razões OPORTUNIDADE_PARADA e _CRITICA, com o SLA de estágio da
 * hipótese versionada da Commercial Machine). A Central não tem limiar próprio.
 */
export function oportunidadesParadas(fontes: FontesCentral, fila: CommercialQueue): OportunidadeParada[] {
  const r = fontes.radar
  const out: OportunidadeParada[] = []
  for (const item of fila.itens) {
    for (const razao of [item.porQueAgora, ...item.secundarias]) {
      if ((razao.codigo !== 'OPORTUNIDADE_PARADA' && razao.codigo !== 'OPORTUNIDADE_PARADA_CRITICA') || razao.referencia?.tipo !== 'oportunidade') continue
      const o = r.oportunidades.find((x) => x.id === razao.referencia!.id)
      if (!o || out.some((x) => x.oportunidadeId === o.id)) continue
      const e = r.empresas.find((x) => x.id === o.empresaId)
      out.push({ oportunidadeId: o.id, titulo: o.titulo, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', estagio: o.estagio, dias: razao.dias ?? 0, critica: razao.codigo === 'OPORTUNIDADE_PARADA_CRITICA', categoria: NOME_CATEGORIA_CM[item.categoria as CategoriaCommercialQueue], dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}` })
    }
  }
  return out
}

export interface AcompanhamentoRealizado { id: string; em: string; cliente: string; tipo: Atividade['tipo']; canal: Atividade['canal']; resultado?: string; notas: string; autor?: string; dossie: ChaveDossie }
/** Últimos acompanhamentos registrados no Radar (atividades), do mais recente ao mais antigo. */
export function acompanhamentosRecentes(fontes: FontesCentral, limite = 30): AcompanhamentoRealizado[] {
  const r = fontes.radar
  return [...r.atividades].sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : a.ocorreuEm > b.ocorreuEm ? -1 : a.id.localeCompare(b.id))).slice(0, limite).map((a) => {
    const e = r.empresas.find((x) => x.id === a.empresaId)
    return { id: a.id, em: a.ocorreuEm, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', tipo: a.tipo, canal: a.canal, ...(a.resultado ? { resultado: a.resultado } : {}), notas: a.notas, autor: nomeDe(fontes, a.usuarioId), dossie: chaveEmpresa(a.empresaId) }
  })
}

/* ---------------------------------------------------------------
   D · Orçamentos e propostas
--------------------------------------------------------------- */

export interface LinhaOrcamento {
  id: string; codigo: string; titulo: string
  /** Texto livre do orçamento: NÃO é vínculo com a empresa do Radar. */
  cliente: string
  status: Orcamento['status']; data: string; validade?: string; validadeVencida: boolean
  custoTotal: number; precoTotal: number; pctMargem: number; incompletos: number
  link: string
}
/** Orçamentos técnicos do módulo de Orçamentos (custo × preço calculados por `calcOrcamento`). Mais recentes primeiro. */
export function orcamentosTecnicos(fontes: FontesCentral, ctx: Pick<ContextoCentral, 'hoje'>): LinhaOrcamento[] {
  return [...fontes.orcamentos].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.id.localeCompare(b.id))).map((o) => {
    const c = calcOrcamento(o, fontes.catalogo)
    return {
      id: o.id, codigo: o.codigo, titulo: o.titulo, cliente: o.cliente, status: o.status, data: o.data, ...(o.validade ? { validade: o.validade } : {}),
      validadeVencida: !!o.validade && (o.status === 'Rascunho' || o.status === 'Enviado') && o.validade < ctx.hoje,
      custoTotal: c.custoTotal, precoTotal: c.precoTotal, pctMargem: c.pctMargem, incompletos: c.incompletos, link: `/orcamentos/${o.id}`,
    }
  })
}

export interface SinalProposta {
  oportunidadeId: string; titulo: string; cliente: string; estagio: Estagio
  valorEstimado?: number; probabilidade: number; previsaoFechamento?: string
  /** Desde quando está no estágio atual (histórico de estágios), se registrado. */
  noEstagioDesde?: string; diasNoEstagio?: number
  /** Última atividade do tipo PROPOSAL (o envio/revisão registrado no Radar). */
  ultimaPropostaEm?: string; propostasRegistradas: number
  responsavelNome?: string; proximaAcao?: string; proximaAcaoEm?: string
  dossie: ChaveDossie; link: string
}
const entrouNoEstagio = (r: RadarDataset, o: Oportunidade) => r.historicoEstagios.filter((h) => h.oportunidadeId === o.id && h.para === o.estagio).map((h) => h.em).sort().pop()

/** Próxima ação da oportunidade: a dela; sem ela, a tarefa aberta mais próxima (a regra do Radar aceita as duas). */
function proximaDaOportunidade(r: RadarDataset, o: Oportunidade): { proximaAcao?: string; proximaAcaoEm?: string } {
  if (o.proximaAcao || o.proximaAcaoEm) return { ...(o.proximaAcao ? { proximaAcao: o.proximaAcao } : {}), ...(o.proximaAcaoEm ? { proximaAcaoEm: o.proximaAcaoEm } : {}) }
  const t = r.tarefas.filter((x) => x.oportunidadeId === o.id && x.status === 'Aberta').sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1))[0]
  return t ? { proximaAcao: `Tarefa: ${t.descricao || t.tipo}`, proximaAcaoEm: dia(t.venceEm) } : {}
}

/** Propostas em andamento como SINAL do Radar (estágios de proposta + atividades PROPOSAL). */
export function propostasEmAndamento(fontes: FontesCentral, ctx: Pick<ContextoCentral, 'hoje'>): SinalProposta[] {
  const r = fontes.radar
  return r.oportunidades.filter((o) => ESTAGIOS_PROPOSTA.includes(o.estagio)).map((o) => {
    const e = r.empresas.find((x) => x.id === o.empresaId)
    const desde = entrouNoEstagio(r, o)
    const propostas = r.atividades.filter((a) => a.oportunidadeId === o.id && a.tipo === 'PROPOSAL').map((a) => a.ocorreuEm).sort()
    return {
      oportunidadeId: o.id, titulo: o.titulo, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', estagio: o.estagio,
      ...(o.valorEstimado !== undefined ? { valorEstimado: o.valorEstimado } : {}), probabilidade: o.probabilidade,
      ...(o.previsaoFechamento ? { previsaoFechamento: o.previsaoFechamento } : {}),
      ...(desde ? { noEstagioDesde: desde, diasNoEstagio: Math.max(0, diasEntre(desde, ctx.hoje)) } : {}),
      ...(propostas.length ? { ultimaPropostaEm: propostas[propostas.length - 1] } : {}), propostasRegistradas: propostas.length,
      responsavelNome: nomeDe(fontes, o.responsavelId), ...proximaDaOportunidade(r, o),
      dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}`,
    }
  }).sort((a, b) => ESTAGIOS_PROPOSTA.indexOf(b.estagio) - ESTAGIOS_PROPOSTA.indexOf(a.estagio) || a.oportunidadeId.localeCompare(b.oportunidadeId))
}

export interface Desfecho {
  oportunidadeId: string; titulo: string; cliente: string; resultado: 'WON' | 'LOST'; fechadoEm?: string
  /** Valor fechado CONFIRMADO (só ganha). Estimado nunca vira valor de venda. */
  valorFechado?: number; motivo?: string; responsavelNome?: string; dossie: ChaveDossie; link: string
}
/** Oportunidades ganhas e perdidas, mais recentes primeiro. `janelaDias` recorta pela data de fechamento. */
export function desfechos(fontes: FontesCentral, ctx: Pick<ContextoCentral, 'hoje'>, janelaDias?: number): Desfecho[] {
  const r = fontes.radar
  const limite = janelaDias !== undefined ? somarDias(ctx.hoje, -janelaDias) : undefined
  return r.oportunidades.filter((o) => (o.estagio === 'WON' || o.estagio === 'LOST') && (!limite || (o.fechadoEm !== undefined && dia(o.fechadoEm) >= limite)))
    .sort((a, b) => ((a.fechadoEm ?? '') < (b.fechadoEm ?? '') ? 1 : (a.fechadoEm ?? '') > (b.fechadoEm ?? '') ? -1 : a.id.localeCompare(b.id)))
    .map((o) => { const e = r.empresas.find((x) => x.id === o.empresaId); return {
      oportunidadeId: o.id, titulo: o.titulo, cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', resultado: o.estagio as 'WON' | 'LOST',
      ...(o.fechadoEm ? { fechadoEm: o.fechadoEm } : {}), ...(o.estagio === 'WON' && o.valorFechado !== undefined ? { valorFechado: o.valorFechado } : {}),
      ...(o.motivoFechamento || o.motivoEstagio ? { motivo: o.motivoFechamento || o.motivoEstagio } : {}), responsavelNome: nomeDe(fontes, o.responsavelId),
      dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}`,
    } })
}

/* ---------------------------------------------------------------
   E · Solicitações de projeto (sinais; não há entidade)
--------------------------------------------------------------- */

export type FonteSolicitacao = 'simulador_site' | 'oportunidade' | 'atividade'
export const NOME_FONTE_SOLICITACAO: Record<FonteSolicitacao, string> = { simulador_site: 'Simulador do site', oportunidade: 'Oportunidade (estágio)', atividade: 'Resultado de atividade' }
export interface SolicitacaoProjeto {
  id: string; fonte: FonteSolicitacao; tipo: string; cliente: string
  /** Só a EMPRESA do cliente (nunca o nome da pessoa): é o que a visão técnica da Engenharia mostra. */
  empresaCliente?: string
  dadosTecnicos: string[]; escopo?: string; solicitadaEm: string
  responsavelNome?: string; prazo?: string; situacao: string
  /** Documentos: não existe anexo comercial; sempre indisponível nesta versão. */
  documentos: 'indisponivel'
  dossie: ChaveDossie; link: string
}

/**
 * Pedidos de projeto deduzidos de três sinais, sem duplicar: a atividade de uma
 * oportunidade que já está em PROJECT_RECEIVED/ENGINEERING vira evidência dela,
 * não uma segunda linha. Mais recentes primeiro.
 */
export function solicitacoesDeProjeto(fontes: FontesCentral, atendimentos?: readonly LinhaAtendimento[]): SolicitacaoProjeto[] {
  const r = fontes.radar
  const out: SolicitacaoProjeto[] = []
  for (const l of atendimentos ?? []) {
    if (l.origem !== 'site' || l.ensaio || (!l.configuracao && !l.medidas)) continue
    out.push({
      id: `conversa:${l.threadId}`, fonte: 'simulador_site', tipo: 'Galpão (configuração do simulador)', cliente: l.empresa ? `${l.nome} · ${l.empresa}` : l.nome,
      dadosTecnicos: [l.configuracao, l.medidas, l.especificacao].filter((x): x is string => !!x), ...(l.prazoInformado ? { escopo: `Prazo informado: ${l.prazoInformado}` } : {}),
      solicitadaEm: l.recebidoEm, ...(l.responsavelNome ? { responsavelNome: l.responsavelNome } : {}), ...(l.prazoAte && l.situacao === 'aguardando' ? { prazo: l.prazoAte } : {}),
      situacao: l.aberta ? (l.situacao === 'aguardando' ? 'Aguardando 1ª resposta' : 'Em atendimento') : 'Conversa encerrada', documentos: 'indisponivel', dossie: l.dossie, link: l.link,
    })
  }
  const emProjeto = r.oportunidades.filter((o) => ESTAGIOS_PROJETO.includes(o.estagio))
  for (const o of emProjeto) {
    const e = r.empresas.find((x) => x.id === o.empresaId)
    const p = o.projetoId ? r.projetos.find((x) => x.id === o.projetoId) : undefined
    const tarefa = r.tarefas.filter((t) => t.oportunidadeId === o.id && t.status === 'Aberta').sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1))[0]
    const desde = entrouNoEstagio(r, o) ?? o.atualizadoEm
    out.push({
      id: `oportunidade:${o.id}`, fonte: 'oportunidade', tipo: p?.tipo ?? 'não informado', cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', ...(e ? { empresaCliente: nomeEmpresa(e) } : {}),
      dadosTecnicos: p ? [p.nome, p.areaM2 ? `${p.areaM2.toLocaleString('pt-BR')} m²` : '', [p.cidade, p.uf].filter(Boolean).join('/')].filter((x) => x !== '') : [],
      ...(o.observacoes ? { escopo: o.observacoes } : {}), solicitadaEm: desde, responsavelNome: nomeDe(fontes, o.responsavelId),
      ...(tarefa ? { prazo: tarefa.venceEm } : o.proximaAcaoEm ? { prazo: o.proximaAcaoEm } : {}), situacao: NOME_ESTAGIO[o.estagio], documentos: 'indisponivel',
      dossie: chaveEmpresa(o.empresaId), link: `/radar/empresas/${o.empresaId}`,
    })
  }
  for (const a of r.atividades) {
    if (a.resultado !== 'REQUESTED_BUDGET' && a.resultado !== 'REQUESTED_TECHNICAL_ANALYSIS') continue
    if (a.oportunidadeId && emProjeto.some((o) => o.id === a.oportunidadeId)) continue
    const e = r.empresas.find((x) => x.id === a.empresaId)
    const o = a.oportunidadeId ? r.oportunidades.find((x) => x.id === a.oportunidadeId) : undefined
    out.push({
      id: `atividade:${a.id}`, fonte: 'atividade', tipo: a.resultado === 'REQUESTED_BUDGET' ? 'Pediu orçamento' : 'Pediu análise técnica', cliente: e ? nomeEmpresa(e) : 'empresa não encontrada', ...(e ? { empresaCliente: nomeEmpresa(e) } : {}),
      dadosTecnicos: [], ...(a.notas ? { escopo: a.notas } : {}), solicitadaEm: a.ocorreuEm, responsavelNome: nomeDe(fontes, o?.responsavelId ?? a.usuarioId),
      ...(o?.proximaAcaoEm ? { prazo: o.proximaAcaoEm } : {}), situacao: o ? NOME_ESTAGIO[o.estagio] : 'Sem oportunidade aberta', documentos: 'indisponivel',
      dossie: chaveEmpresa(a.empresaId), link: `/radar/empresas/${a.empresaId}`,
    })
  }
  return out.sort((a, b) => (a.solicitadaEm < b.solicitadaEm ? 1 : a.solicitadaEm > b.solicitadaEm ? -1 : a.id.localeCompare(b.id)))
}

/* ---------------------------------------------------------------
   F · Pipeline (autoridade: Radar; probabilidade = a registrada)
--------------------------------------------------------------- */

export interface EtapaPipeline { estagio: Estagio; nome: string; quantidade: number; comValor: number; valor: number; ponderado: number }
export interface MesPrevisto { mes: string; quantidade: number; valor: number; ponderado: number }
export interface Pipeline {
  etapas: EtapaPipeline[]
  ativas: number; semValor: number; valorTotal: number; ponderadoTotal: number
  /** Ativas com previsão de fechamento nos próximos meses e valor estimado. */
  previsao: MesPrevisto[]
  /** Ativas sem previsão de fechamento ou sem valor: não entram na previsão. */
  foraDaPrevisao: number
  /** Previsão já vencida (data no passado e negócio ainda aberto). */
  previsaoVencida: number
}
export function pipeline(fontes: FontesCentral, ctx: Pick<ContextoCentral, 'hoje'>): Pipeline {
  const ativas = fontes.radar.oportunidades.filter((o) => estagioAtivo(o.estagio))
  const ordem = ['DETECTED', 'RESEARCHING', 'QUALIFIED', 'DECISION_MAKER_FOUND', 'CONTACT_STARTED', 'ENGAGED', 'NEED_CONFIRMED', 'PROJECT_RECEIVED', 'ENGINEERING', 'PRICING', 'PROPOSAL_SENT', 'NEGOTIATION'] as const
  const etapas = ordem.map((estagio) => {
    const os = ativas.filter((o) => o.estagio === estagio)
    const comValor = os.filter((o) => o.valorEstimado !== undefined)
    return { estagio, nome: NOME_ESTAGIO[estagio], quantidade: os.length, comValor: comValor.length, valor: comValor.reduce((s, o) => s + (o.valorEstimado ?? 0), 0), ponderado: comValor.reduce((s, o) => s + (o.valorEstimado ?? 0) * o.probabilidade, 0) }
  })
  const mesAtual = ctx.hoje.slice(0, 7)
  const meses: string[] = []
  for (let i = 0; i < JANELAS_CENTRAL.previsaoMeses; i++) { const d = new Date(Date.UTC(Number(mesAtual.slice(0, 4)), Number(mesAtual.slice(5, 7)) - 1 + i, 1)); meses.push(d.toISOString().slice(0, 7)) }
  const previsao = meses.map((mes) => {
    const os = ativas.filter((o) => o.valorEstimado !== undefined && o.previsaoFechamento?.slice(0, 7) === mes && dia(o.previsaoFechamento) >= ctx.hoje)
    return { mes, quantidade: os.length, valor: os.reduce((s, o) => s + (o.valorEstimado ?? 0), 0), ponderado: os.reduce((s, o) => s + (o.valorEstimado ?? 0) * o.probabilidade, 0) }
  })
  return {
    etapas, ativas: ativas.length, semValor: ativas.filter((o) => o.valorEstimado === undefined).length,
    valorTotal: etapas.reduce((s, e) => s + e.valor, 0), ponderadoTotal: etapas.reduce((s, e) => s + e.ponderado, 0), previsao,
    foraDaPrevisao: ativas.filter((o) => o.valorEstimado === undefined || !o.previsaoFechamento).length,
    previsaoVencida: ativas.filter((o) => o.previsaoFechamento && dia(o.previsaoFechamento) < ctx.hoje).length,
  }
}

/* ---------------------------------------------------------------
   A · Visão geral: o retrato (tudo derivado das seções acima)
--------------------------------------------------------------- */

export interface VisaoGeral {
  leadsRecebidos: Indicador; leadsDoSiteRecebidos: Indicador; aguardandoPrimeiraResposta: Indicador; primeiraRespostaVencida: Indicador
  atendimentosPendentes: Indicador; semResponsavel: Indicador
  retornosVencidos: Indicador; retornosProximos: Indicador; semProximaAcao: Indicador; paradas: Indicador
  propostasEmAndamento: Indicador; orcamentosAguardando: Indicador
  valorPipeline: Indicador; valorPonderado: Indicador; oportunidadesAtivas: Indicador; oportunidadesSemValor: Indicador
  pedidosDeProjeto: Indicador; analisesEngenharia: Indicador
  propostasAguardandoResposta: Indicador; valorPropostasAguardando: Indicador; negociacoesAvancando: Indicador; negociacoesParadas: Indicador
  ganhos: Indicador; perdidos: Indicador; valorGanho: Indicador; ganhosSemValor: Indicador
}

export interface RetratoCentral {
  geradoEm: string
  hoje: string
  atendimentos?: LinhaAtendimento[]
  retornos: Retorno[]
  semProximaAcao: OportunidadeSemAcao[]
  paradas: OportunidadeParada[]
  acompanhamentos: AcompanhamentoRealizado[]
  orcamentos: LinhaOrcamento[]
  propostas: SinalProposta[]
  desfechos: Desfecho[]
  solicitacoes: SolicitacaoProjeto[]
  pipeline: Pipeline
  visao: VisaoGeral
  /** Versão da hipótese da fila CM1-A usada nas paradas. */
  versaoFila: string
  /** A fila CM1-A inteira (autoridade da próxima ação recomendada por conta). */
  fila: CommercialQueue
  /** Cada dossiê na fase mais avançada da jornada (um cliente conta uma vez). */
  jornada: ResumoJornada
}

const MOTIVO_SEM_INBOX = 'EIFF Inbox não carregado ou sem a permissão inbox'

/** Monta o retrato inteiro de uma vez (uma chamada por tela). */
export function retratoCentral(fontes: FontesCentral, ctx: ContextoCentral): RetratoCentral {
  const atend = atendimentosComerciais(fontes, ctx)
  const fila = construirCommercialQueue(fontes.radar, ctx.hoje, { usuariosValidos: fontes.usuarios.filter((u) => u.ativo).map((u) => u.id) })
  const ret = retornos(fontes, ctx, atend)
  const sem = oportunidadesSemProximaAcao(fontes)
  const paradas = oportunidadesParadas(fontes, fila)
  const orcs = orcamentosTecnicos(fontes, ctx)
  const props = propostasEmAndamento(fontes, ctx)
  const todosDesfechos = desfechos(fontes, ctx)
  const janela = desfechos(fontes, ctx, JANELAS_CENTRAL.desfechosDias)
  const sols = solicitacoesDeProjeto(fontes, atend)
  const pipe = pipeline(fontes, ctx)

  const desde = new Date(Date.parse(ctx.agoraIso) - JANELAS_CENTRAL.recebidosDias * 86_400_000).toISOString()
  const reais = atend?.filter((l) => !l.ensaio)
  const deAtend = (f: (ls: LinhaAtendimento[]) => number): Indicador => (reais ? ind(f(reais)) : indisponivel(MOTIVO_SEM_INBOX))
  const ganhas = janela.filter((d) => d.resultado === 'WON')

  const visao: VisaoGeral = {
    leadsRecebidos: deAtend((ls) => ls.filter((l) => l.recebidoEm >= desde).length),
    leadsDoSiteRecebidos: deAtend((ls) => ls.filter((l) => l.origem === 'site' && l.recebidoEm >= desde).length),
    aguardandoPrimeiraResposta: deAtend((ls) => ls.filter((l) => l.aberta && l.situacao === 'aguardando').length),
    primeiraRespostaVencida: deAtend((ls) => ls.filter((l) => l.aberta && l.sla === 'vencido').length),
    atendimentosPendentes: deAtend((ls) => ls.filter((l) => l.aberta).length),
    semResponsavel: deAtend((ls) => ls.filter((l) => l.aberta && !l.responsavelId).length),
    retornosVencidos: ind(ret.filter((r) => r.situacao === 'vencido').length),
    retornosProximos: ind(ret.filter((r) => r.situacao === 'hoje' || r.situacao === 'proximo').length),
    semProximaAcao: ind(sem.length),
    paradas: ind(paradas.length),
    propostasEmAndamento: ind(props.length),
    orcamentosAguardando: ind(orcs.filter((o) => o.status === 'Enviado').length),
    valorPipeline: pipe.ativas === 0 ? ind(0) : pipe.semValor === pipe.ativas ? indisponivel('nenhuma oportunidade ativa tem valor estimado') : ind(pipe.valorTotal),
    valorPonderado: pipe.ativas === 0 ? ind(0) : pipe.semValor === pipe.ativas ? indisponivel('nenhuma oportunidade ativa tem valor estimado') : ind(pipe.ponderadoTotal),
    oportunidadesAtivas: ind(pipe.ativas),
    oportunidadesSemValor: ind(pipe.semValor),
    pedidosDeProjeto: ind(sols.filter((s) => s.situacao !== 'Conversa encerrada').length),
    analisesEngenharia: ind(fontes.radar.oportunidades.filter((o) => o.estagio === 'ENGINEERING').length + sols.filter((s) => s.fonte === 'atividade' && s.tipo === 'Pediu análise técnica').length),
    propostasAguardandoResposta: ind(props.filter((p) => p.estagio === 'PROPOSAL_SENT').length),
    valorPropostasAguardando: ind(props.filter((p) => p.estagio === 'PROPOSAL_SENT').reduce((s, p) => s + (p.valorEstimado ?? 0), 0)),
    negociacoesAvancando: ind(props.filter((p) => (p.estagio === 'PROPOSAL_SENT' || p.estagio === 'NEGOTIATION') && !paradas.some((x) => x.oportunidadeId === p.oportunidadeId)).length),
    negociacoesParadas: ind(props.filter((p) => (p.estagio === 'PROPOSAL_SENT' || p.estagio === 'NEGOTIATION') && paradas.some((x) => x.oportunidadeId === p.oportunidadeId)).length),
    ganhos: ind(ganhas.length),
    perdidos: ind(janela.filter((d) => d.resultado === 'LOST').length),
    valorGanho: ind(ganhas.reduce((s, d) => s + (d.valorFechado ?? 0), 0)),
    ganhosSemValor: ind(ganhas.filter((d) => d.valorFechado === undefined).length),
  }
  return {
    geradoEm: ctx.agoraIso, hoje: ctx.hoje, ...(atend ? { atendimentos: atend } : {}), retornos: ret, semProximaAcao: sem, paradas,
    acompanhamentos: acompanhamentosRecentes(fontes), orcamentos: orcs, propostas: props, desfechos: todosDesfechos, solicitacoes: sols, pipeline: pipe, visao,
    versaoFila: fila.versaoRegras,
    fila,
    jornada: resumoJornada(fontes, atend),
  }
}

/* ---------------------------------------------------------------
   Dossiê comercial único
--------------------------------------------------------------- */

export type TipoEventoDossie = 'atividade' | 'estagio' | 'conversa' | 'decisao_entrada' | 'tarefa_concluida'
export interface EventoDossie { id: string; em: string; tipo: TipoEventoDossie; titulo: string; detalhe?: string; autor?: string }

export interface ContatoDossie { id: string; nome: string; cargo?: string; fonte: 'Radar' | 'Inbox'; canais: string[] }

export interface Dossie {
  chave: ChaveDossie
  titulo: string
  subtitulo: string
  empresa?: Empresa
  /** Situação comercial atual: fase da jornada (ver faseDoDossie). */
  fase?: FaseJornada
  donoContaNome?: string
  contatos: ContatoDossie[]
  /** Origens: conversas, fonte da empresa e registros do Lead Engine associados. */
  origens: { tipo: string; descricao: string; em?: string; link?: string }[]
  /** Cada submissão do formulário, separada (duas solicitações do mesmo cliente nunca se fundem). Ensaios fora. */
  solicitacoesDoSite: { threadId: string; externoId?: string; em: string; formulario: string; solicitacao: SolicitacaoDoSite }[]
  /** O que a fila da Commercial Machine (CM1-A) recomenda para a conta: autoridade da próxima ação. */
  filaCM?: { posicao: number; categoria: string; razao: string; venceEm?: string; contato?: string }
  /** Configuração do galpão do lead do site mais recente. */
  configuracao?: { configuracao?: string; medidas?: string; especificacao?: string; prazo?: string; escopo?: string; em: string; formulario: string }
  responsaveis: { papel: string; nome: string }[]
  proximaAtividade?: { descricao: string; venceEm?: string; situacao?: SituacaoPrazo; fonte: string }
  oportunidades: { id: string; titulo: string; estagio: Estagio; valorEstimado?: number; valorFechado?: number; probabilidade: number; previsaoFechamento?: string; responsavelNome?: string }[]
  atendimentos: LinhaAtendimento[]
  solicitacoes: SolicitacaoProjeto[]
  /** Orçamentos: não há vínculo canônico entre orçamento e empresa/oportunidade (lacuna documentada). */
  orcamentos: 'sem_vinculo'
  historico: EventoDossie[]
  decisoes: EventoDossie[]
  links: { rotulo: string; to: string }[]
}

/** O dossiê de uma empresa do Radar ou de uma conversa ainda sem empresa. `undefined` = chave inexistente/invisível. */
export function dossie(chave: string, fontes: FontesCentral, ctx: ContextoCentral, retrato: RetratoCentral): Dossie | undefined {
  const k = lerChaveDossie(chave)
  if (!k) return undefined
  const r = fontes.radar
  const inbox = ctx.veInbox ? fontes.inbox : undefined
  const atend = (retrato.atendimentos ?? []).filter((l) => l.dossie === chave)
  if (k.tipo === 'contato' && atend.length === 0) return undefined
  const empresa = k.tipo === 'empresa' ? r.empresas.find((e) => e.id === k.id) : undefined
  if (k.tipo === 'empresa' && !empresa) return undefined

  const threads = atend.map((l) => inbox?.threads.find((t) => t.id === l.threadId)).filter((t): t is InboxThread => !!t)
  const contatos: ContatoDossie[] = []
  if (empresa) for (const c of r.contatos.filter((x) => x.empresaId === empresa.id && x.ativo)) contatos.push({ id: c.id, nome: c.nome, ...(c.cargo ? { cargo: c.cargo } : {}), fonte: 'Radar', canais: [c.email, c.telefone, c.whatsapp].filter((x): x is string => !!x) })
  for (const t of threads) {
    const c = inbox?.contatos.find((x) => x.id === t.contatoId)
    if (!c || contatos.some((x) => x.id === c.id) || (c.contatoRadarId && contatos.some((x) => x.id === c.contatoRadarId))) continue
    contatos.push({ id: c.id, nome: c.nome, fonte: 'Inbox', canais: c.identidades.map((i) => i.identificador) })
  }

  const origens: Dossie['origens'] = []
  for (const l of atend) origens.push({ tipo: l.origem === 'site' ? `Formulário do site (${l.canalOuFormulario})` : `Conversa ${l.canalOuFormulario}`, descricao: l.assunto, em: l.recebidoEm, link: l.link })
  if (empresa) {
    const fonte = empresa.fonteId ? r.fontes.find((f) => f.id === empresa.fonteId) : undefined
    if (fonte) origens.push({ tipo: 'Fonte da conta no Radar', descricao: fonte.nome, em: empresa.criadoEm })
    for (const rf of r.registrosFonte.filter((x) => x.entidadeId === empresa.id)) origens.push({ tipo: 'Registro de entrada (Lead Engine)', descricao: `${r.fontes.find((f) => f.id === rf.fonteId)?.nome ?? rf.fonteId}${rf.statusIntake ? ` · ${rf.statusIntake}` : ''}`, em: rf.recebidoEm })
  }

  let configuracao: Dossie['configuracao']
  const siteMaisRecente = atend.filter((l) => l.origem === 'site').sort((a, b) => (a.recebidoEm < b.recebidoEm ? 1 : -1))[0]
  if (siteMaisRecente && (siteMaisRecente.configuracao || siteMaisRecente.medidas || siteMaisRecente.especificacao)) {
    const t = inbox?.threads.find((x) => x.id === siteMaisRecente.threadId)
    const msgs = (inbox?.mensagens ?? []).filter((m) => m.threadId === siteMaisRecente.threadId && m.direcao === 'inbound')
    const escopo = t ? msgs.map((m) => /^Escopo:\s*(.*)$/m.exec(m.texto)?.[1]).filter(Boolean).pop() : undefined
    configuracao = {
      ...(siteMaisRecente.configuracao ? { configuracao: siteMaisRecente.configuracao } : {}), ...(siteMaisRecente.medidas ? { medidas: siteMaisRecente.medidas } : {}),
      ...(siteMaisRecente.especificacao ? { especificacao: siteMaisRecente.especificacao } : {}), ...(siteMaisRecente.prazoInformado ? { prazo: siteMaisRecente.prazoInformado } : {}),
      ...(escopo ? { escopo } : {}), em: siteMaisRecente.recebidoEm, formulario: siteMaisRecente.canalOuFormulario,
    }
  }

  const ops = empresa ? r.oportunidades.filter((o) => o.empresaId === empresa.id) : []
  const responsaveis: Dossie['responsaveis'] = []
  if (empresa?.commercialOwnerId) responsaveis.push({ papel: 'Dono da conta', nome: nomeDe(fontes, empresa.commercialOwnerId)! })
  for (const o of ops.filter((x) => estagioAtivo(x.estagio))) responsaveis.push({ papel: `Oportunidade «${o.titulo}»`, nome: nomeDe(fontes, o.responsavelId) ?? 'sem responsável' })
  for (const l of atend.filter((x) => x.aberta)) responsaveis.push({ papel: `Conversa (${l.canalOuFormulario})`, nome: l.responsavelNome ?? 'sem responsável' })

  const ret = retrato.retornos.filter((x) => x.dossie === chave)
  const prox = ret[0]
  const proximaAtividade: Dossie['proximaAtividade'] = prox ? { descricao: prox.descricao, venceEm: prox.venceEm, situacao: prox.situacao, fonte: NOME_TIPO_RETORNO[prox.tipo] }
    : atend.find((l) => l.aberta) ? { descricao: atend.find((l) => l.aberta)!.proximaAcao, fonte: 'EIFF Inbox' } : undefined

  const historico: EventoDossie[] = []
  const decisoes: EventoDossie[] = []
  if (empresa) {
    for (const a of r.atividades.filter((x) => x.empresaId === empresa.id)) historico.push({ id: `a:${a.id}`, em: a.ocorreuEm, tipo: 'atividade', titulo: `${a.tipo} · ${a.canal}${a.resultado ? ` · ${a.resultado}` : ''}`, ...(a.notas ? { detalhe: a.notas } : {}), autor: nomeDe(fontes, a.usuarioId) })
    for (const t of r.tarefas.filter((x) => x.empresaId === empresa.id && x.status === 'Concluída' && x.concluidaEm)) historico.push({ id: `t:${t.id}`, em: t.concluidaEm!, tipo: 'tarefa_concluida', titulo: `Tarefa concluída · ${t.tipo}`, detalhe: t.descricao, autor: nomeDe(fontes, t.responsavelId) })
    for (const h of r.historicoEstagios.filter((x) => ops.some((o) => o.id === x.oportunidadeId))) {
      const o = ops.find((x) => x.id === h.oportunidadeId)!
      const ev: EventoDossie = { id: `h:${h.id}`, em: h.em, tipo: 'estagio', titulo: `«${o.titulo}»: ${h.de ? `${NOME_ESTAGIO[h.de]} → ` : ''}${NOME_ESTAGIO[h.para]}`, ...(h.motivo ? { detalhe: h.motivo } : {}), autor: nomeDe(fontes, h.usuarioId) }
      historico.push(ev); decisoes.push(ev)
    }
    for (const rf of r.registrosFonte.filter((x) => x.entidadeId === empresa.id && x.decididoEm)) decisoes.push({ id: `rf:${rf.id}`, em: rf.decididoEm!, tipo: 'decisao_entrada', titulo: `Entrada ${rf.statusIntake ?? ''} (Lead Engine)`.trim(), ...(rf.motivoDecisao ? { detalhe: rf.motivoDecisao } : {}), autor: nomeDe(fontes, rf.decididoPor) })
  }
  if (inbox) for (const t of threads) for (const it of historicoDoLead(t.id, inbox.mensagens, inbox.eventos)) historico.push({ id: `c:${it.id}`, em: it.em, tipo: 'conversa', titulo: `Conversa · ${it.tipo.replace(/_/g, ' ')}`, detalhe: it.texto.length > 280 ? `${it.texto.slice(0, 280)}…` : it.texto, autor: it.autor })
  const desc = (a: EventoDossie, b: EventoDossie) => (a.em < b.em ? 1 : a.em > b.em ? -1 : a.id.localeCompare(b.id))

  const titulo = empresa ? nomeEmpresa(empresa) : (atend[0].empresa ? `${atend[0].nome} · ${atend[0].empresa}` : atend[0].nome)
  const subtitulo = empresa ? [empresa.cnpj ? `CNPJ ${empresa.cnpj}` : undefined, [empresa.cidade, empresa.uf].filter(Boolean).join('/') || undefined, empresa.setor, `classe ${empresa.priorityClass}`].filter(Boolean).join(' · ')
    : 'Contato do Inbox ainda não associado a uma empresa do Radar'
  const links: Dossie['links'] = []
  if (empresa) links.push({ rotulo: 'Abrir a empresa no Radar', to: `/radar/empresas/${empresa.id}` })
  for (const l of atend) links.push({ rotulo: l.origem === 'site' ? 'Abrir o lead em Leads do site' : 'Abrir a conversa no EIFF Inbox', to: l.link })

  return {
    chave: chave as ChaveDossie, titulo, subtitulo, ...(empresa ? { empresa } : {}),
    ...((): { fase?: FaseJornada } => { const f = faseDoDossie(ops, atend); return f ? { fase: f } : {} })(),
    ...(empresa?.commercialOwnerId ? { donoContaNome: nomeDe(fontes, empresa.commercialOwnerId) } : {}),
    contatos, origens: origens.sort((a, b) => ((a.em ?? '') < (b.em ?? '') ? 1 : -1)), ...(configuracao ? { configuracao } : {}), responsaveis,
    ...(proximaAtividade ? { proximaAtividade } : {}),
    oportunidades: ops.map((o) => ({ id: o.id, titulo: o.titulo, estagio: o.estagio, ...(o.valorEstimado !== undefined ? { valorEstimado: o.valorEstimado } : {}), ...(o.estagio === 'WON' && o.valorFechado !== undefined ? { valorFechado: o.valorFechado } : {}), probabilidade: o.probabilidade, ...(o.previsaoFechamento ? { previsaoFechamento: o.previsaoFechamento } : {}), responsavelNome: nomeDe(fontes, o.responsavelId) })),
    atendimentos: atend, solicitacoes: retrato.solicitacoes.filter((s) => s.dossie === chave), orcamentos: 'sem_vinculo',
    solicitacoesDoSite: (inbox?.mensagens ?? []).filter((m) => threads.some((t) => t.id === m.threadId) && doFormulario(m) && !ehSubmissaoDeEnsaio(m))
      .sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : a.id.localeCompare(b.id)))
      .map((m) => ({ threadId: m.threadId, ...(m.externalMessageId ? { externoId: m.externalMessageId } : {}), em: m.em, formulario: String(m.meta?.['formulario']), solicitacao: lerSolicitacao(m.texto) })),
    ...((): { filaCM?: Dossie['filaCM'] } => {
      const item = empresa ? retrato.fila.itens.find((i) => i.empresaId === empresa.id) : undefined
      if (!item) return {}
      const c = item.contato ? r.contatos.find((x) => x.id === item.contato!.id)?.nome : undefined
      return { filaCM: { posicao: item.posicao, categoria: NOME_CATEGORIA_CM[item.categoria], razao: TEXTO_RAZAO_CM[item.porQueAgora.codigo], ...(item.porQueAgora.venceEm ? { venceEm: item.porQueAgora.venceEm } : {}), ...(c ? { contato: c } : {}) } }
    })(),
    historico: historico.sort(desc), decisoes: decisoes.sort(desc), links,
  }
}

/** Índice para a busca de dossiês: um item por chave canônica (empresas com movimento comercial + conversas sem empresa). */
export function indiceDossies(fontes: FontesCentral, retrato: RetratoCentral): { chave: ChaveDossie; titulo: string; sub: string }[] {
  const r = fontes.radar
  const chaves = new Set<ChaveDossie>()
  for (const l of retrato.atendimentos ?? []) chaves.add(l.dossie)
  for (const o of r.oportunidades) chaves.add(chaveEmpresa(o.empresaId))
  for (const t of r.tarefas) if (t.status === 'Aberta') chaves.add(chaveEmpresa(t.empresaId))
  return [...chaves].map((chave) => {
    const k = lerChaveDossie(chave)!
    if (k.tipo === 'empresa') { const e = r.empresas.find((x) => x.id === k.id); return { chave, titulo: e ? nomeEmpresa(e) : k.id, sub: e ? [e.cidade, e.uf].filter(Boolean).join('/') : '' } }
    const l = retrato.atendimentos!.find((x) => x.dossie === chave)!
    return { chave, titulo: l.nome, sub: l.empresa ?? 'sem empresa no Radar' }
  }).sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
}

/* ---------------------------------------------------------------
   Jornada comercial (E11.1): Lead recebido → … → Contratação
--------------------------------------------------------------- */

/**
 * As sete fases da jornada pedidas pela Direção, mais os desfechos fora da jornada ativa. É uma LEITURA dos estados
 * que já existem (estado da conversa no Inbox e estágio da oportunidade no Radar) — não é estado novo, não muda a
 * ordem de trabalho e não cria prioridade. A equivalência está em `FASE_DO_ESTAGIO` e no doc
 * (docs/central-gestao-comercial.md), para homologação.
 */
export const FASES_JORNADA = ['lead', 'atendimento', 'qualificacao', 'estudo', 'proposta', 'negociacao', 'contratacao'] as const
export type FaseJornada = (typeof FASES_JORNADA)[number] | 'perdido' | 'nutricao' | 'encerrado'
export const NOME_FASE: Record<FaseJornada, string> = {
  lead: 'Lead recebido', atendimento: 'Atendimento', qualificacao: 'Qualificação', estudo: 'Estudo e orçamento', proposta: 'Proposta',
  negociacao: 'Negociação', contratacao: 'Contratação', perdido: 'Perdido', nutricao: 'Nutrição', encerrado: 'Encerrado sem negócio',
}
/** Estágio do Radar → fase da jornada (equivalência de apresentação). */
export const FASE_DO_ESTAGIO: Record<Estagio, FaseJornada> = {
  DETECTED: 'lead', RESEARCHING: 'lead', DECISION_MAKER_FOUND: 'atendimento', CONTACT_STARTED: 'atendimento', ENGAGED: 'atendimento',
  QUALIFIED: 'qualificacao', NEED_CONFIRMED: 'qualificacao', PROJECT_RECEIVED: 'estudo', ENGINEERING: 'estudo', PRICING: 'estudo',
  PROPOSAL_SENT: 'proposta', NEGOTIATION: 'negociacao', WON: 'contratacao', LOST: 'perdido', NURTURE: 'nutricao',
}
const ORDEM_FASE: Record<FaseJornada, number> = { encerrado: -3, perdido: -2, nutricao: -1, lead: 0, atendimento: 1, qualificacao: 2, estudo: 3, proposta: 4, negociacao: 5, contratacao: 6 }

/** Fase de uma conversa sem oportunidade: aguardando o 1º contato = lead; aberta = atendimento; fechada = encerrado. */
export const faseDaConversa = (l: Pick<LinhaAtendimento, 'aberta' | 'situacao'>): FaseJornada => (!l.aberta ? 'encerrado' : l.situacao === 'aguardando' ? 'lead' : 'atendimento')

/**
 * Situação comercial atual de um dossiê: a fase da oportunidade ATIVA mais avançada; sem ativa, uma conversa aberta
 * (atendimento novo) vale antes do último desfecho; depois, a última ganha/perdida/nutrição; por fim, a conversa.
 */
export function faseDoDossie(oportunidades: readonly Pick<Oportunidade, 'estagio' | 'fechadoEm' | 'atualizadoEm'>[], conversas: readonly Pick<LinhaAtendimento, 'aberta' | 'situacao' | 'ensaio'>[]): FaseJornada | undefined {
  const ativas = oportunidades.filter((o) => estagioAtivo(o.estagio))
  if (ativas.length) return ativas.map((o) => FASE_DO_ESTAGIO[o.estagio]).sort((a, b) => ORDEM_FASE[b] - ORDEM_FASE[a])[0]
  const fechadas = oportunidades.filter((o) => o.estagio === 'WON' || o.estagio === 'LOST' || o.estagio === 'NURTURE').sort((a, b) => ((a.fechadoEm ?? a.atualizadoEm) < (b.fechadoEm ?? b.atualizadoEm) ? 1 : -1))
  const daConversa = conversas.filter((c) => !c.ensaio).map(faseDaConversa).sort((a, b) => ORDEM_FASE[b] - ORDEM_FASE[a])[0]
  if (daConversa && daConversa !== 'encerrado') return daConversa
  if (fechadas.length) return FASE_DO_ESTAGIO[fechadas[0].estagio]
  return daConversa
}

export interface ResumoJornada { porFase: Record<FaseJornada, number>; dossies: { chave: ChaveDossie; fase: FaseJornada }[] }
/** Quantos clientes (dossiês canônicos) estão em cada fase. Ensaios ficam de fora. */
export function resumoJornada(fontes: FontesCentral, atendimentos?: readonly LinhaAtendimento[]): ResumoJornada {
  const r = fontes.radar
  const chaves = new Set<ChaveDossie>()
  for (const l of atendimentos ?? []) if (!l.ensaio) chaves.add(l.dossie)
  for (const o of r.oportunidades) chaves.add(chaveEmpresa(o.empresaId))
  const porFase = Object.fromEntries(Object.keys(ORDEM_FASE).map((f) => [f, 0])) as Record<FaseJornada, number>
  const dossies: ResumoJornada['dossies'] = []
  for (const chave of [...chaves].sort()) {
    const k = lerChaveDossie(chave)!
    const ops = k.tipo === 'empresa' ? r.oportunidades.filter((o) => o.empresaId === k.id) : []
    const fase = faseDoDossie(ops, (atendimentos ?? []).filter((l) => l.dossie === chave))
    if (!fase) continue
    porFase[fase]++
    dossies.push({ chave, fase })
  }
  return { porFase, dossies }
}

/* ---------------------------------------------------------------
   Ciclos de vida: três conceitos distintos (E11.1, P4)
--------------------------------------------------------------- */

export type SituacaoImplementacao = 'implementado' | 'sinal' | 'a_desenvolver'
export interface CicloDeVida {
  id: 'orcamento_tecnico' | 'proposta_comercial' | 'solicitacao_projeto'
  nome: string
  oQueE: string
  dono: string
  estados: { nome: string; situacao: SituacaoImplementacao }[]
  hoje: string
  falta: string
}
/**
 * Orçamento técnico, proposta comercial e solicitação de projeto NÃO são a mesma coisa. Só o orçamento técnico tem
 * entidade e ciclo implementados; os outros dois são lidos de sinais do Radar até ganharem contrato próprio.
 */
export const CICLOS_DE_VIDA: readonly CicloDeVida[] = [
  {
    id: 'orcamento_tecnico', nome: 'Orçamento técnico', oQueE: 'Custo da obra por composições e insumos, BDI, preço de venda e margem.', dono: 'Engenharia de custos (módulo Orçamentos)',
    estados: [{ nome: 'Rascunho', situacao: 'implementado' }, { nome: 'Enviado', situacao: 'implementado' }, { nome: 'Aprovado', situacao: 'implementado' }, { nome: 'Contratado', situacao: 'implementado' }, { nome: 'Perdido / Cancelado', situacao: 'implementado' }],
    hoje: 'Entidade Orcamento com status, validade, itens, custo e preço calculados (calcOrcamento).',
    falta: 'Vínculo por id com a empresa e a oportunidade do Radar (hoje o cliente é texto livre).',
  },
  {
    id: 'proposta_comercial', nome: 'Proposta comercial', oQueE: 'O documento enviado ao cliente: preço, condições, prazo, validade e revisões.', dono: 'Comercial',
    estados: [{ nome: 'Em preparação', situacao: 'sinal' }, { nome: 'Emitida (R0, R1…)', situacao: 'a_desenvolver' }, { nome: 'Enviada / aguardando resposta', situacao: 'sinal' }, { nome: 'Em negociação', situacao: 'sinal' }, { nome: 'Aceita / recusada / expirada', situacao: 'a_desenvolver' }],
    hoje: 'Sinais do Radar: estágios Precificação, Proposta enviada e Negociação; revisões = atividades «Proposta»; ganho/perda com motivo.',
    falta: 'Entidade de proposta com número, revisão, valor, condições, validade, aceite/recusa e PDF, ligada à oportunidade e ao orçamento técnico.',
  },
  {
    id: 'solicitacao_projeto', nome: 'Solicitação de projeto', oQueE: 'O pedido de estudo/projeto à engenharia: dados técnicos, escopo, responsável técnico, prazo e entregáveis.', dono: 'Engenharia',
    estados: [{ nome: 'Solicitada', situacao: 'sinal' }, { nome: 'Em triagem', situacao: 'a_desenvolver' }, { nome: 'Em engenharia', situacao: 'sinal' }, { nome: 'Entregue', situacao: 'a_desenvolver' }, { nome: 'Convertida em orçamento / cancelada', situacao: 'a_desenvolver' }],
    hoje: 'Sinais: configuração do simulador no lead do site, oportunidade em Projeto recebido/Engenharia, atividade «pediu orçamento / análise técnica».',
    falta: 'Entidade de solicitação com responsável técnico, prazo, situação e documentos (planta, sondagem, memorial).',
  },
]

/** O que já opera (na tela da autoridade) e o que precisa de desenvolvimento — exibido na própria Central. */
export const OPERACOES_CENTRAL: readonly { acao: string; situacao: 'opera' | 'a_desenvolver'; onde: string; rota?: string }[] = [
  { acao: 'Assumir lead, registrar tentativa ou contato realizado', situacao: 'opera', onde: 'Leads do site / EIFF Inbox', rota: '/atendimento/leads' },
  { acao: 'Transferir conversa, mudar status, nota interna', situacao: 'opera', onde: 'EIFF Inbox', rota: '/atendimento' },
  { acao: 'Criar ou associar empresa a partir de candidato', situacao: 'opera', onde: 'Radar · Command Center › Candidatos', rota: '/radar' },
  { acao: 'Abrir oportunidade, mudar estágio, próxima ação, tarefa, atividade', situacao: 'opera', onde: 'Radar · empresa', rota: '/radar/empresas' },
  { acao: 'Fila do dia e cadência', situacao: 'opera', onde: 'Radar · Hoje', rota: '/radar/hoje' },
  { acao: 'Elaborar orçamento técnico (custo, BDI, preço)', situacao: 'opera', onde: 'Orçamentos e composições', rota: '/orcamentos' },
  { acao: 'Registrar proposta com revisões, condições e validade', situacao: 'a_desenvolver', onde: 'entidade de proposta (E11.3)' },
  { acao: 'Registrar e acompanhar solicitação de projeto à engenharia', situacao: 'a_desenvolver', onde: 'entidade de solicitação (E11.2)' },
  { acao: 'Vincular orçamento técnico ao negócio', situacao: 'a_desenvolver', onde: 'vínculo por id (E11.3)' },
  { acao: 'Anexar planta, sondagem, memorial', situacao: 'a_desenvolver', onde: 'documentos comerciais (E11.4)' },
  { acao: 'Histórico de reagendamentos', situacao: 'a_desenvolver', onde: 'histórico de prazo (E11.5)' },
]

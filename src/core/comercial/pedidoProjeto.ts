// Gestão de Solicitações de Projeto (E11.2A): o encaminhamento formal Comercial → Engenharia → Comercial.
//
// Motor PURO (sem banco, sem React). A persistência ainda não é homologada: o app usa um repositório EM MEMÓRIA, só no
// modo local de demonstração (src/data/pedidosProjeto.ts), e a proposta de armazenamento fica em
// docs/propostas/pedido-projeto.proposta.sql, provada em PostgreSQL descartável. O banco repete estas regras na RPC.
//
// Princípios:
//   - a solicitação é TÉCNICA por construção: nenhum campo de valor, probabilidade, negociação ou contato do cliente;
//     empresa, oportunidade, submissão, evidência do Lead Engine, conversa e orçamento entram só como REFERÊNCIA por id
//     oficial (nunca por nome parecido) e são conferidos na criação;
//   - todo dado técnico diz se foi DECLARADO pelo cliente ou VALIDADO pela Engenharia (quem e quando);
//   - toda mudança é uma ação nomeada, com evento no histórico (append-only); motivo obrigatório em devolução,
//     reabertura e cancelamento; estados ENCERRADO e CANCELADO não admitem alteração;
//   - repetir a mesma ação (mesma intenção) não duplica nada; uma oportunidade pode ter várias solicitações, mas só uma
//     ABERTA por tipo — a seguinte do mesmo tipo é uma nova versão;
//   - o estágio da oportunidade no Radar NUNCA é mudado aqui (`estagioSugerido` só aponta a divergência).
import { pode } from '../permissoes'
import type { InboxDataset } from '../inbox/tipos'
import { ESTAGIOS, estagioAtivo, type Estagio, type RadarDataset } from '../radar/types'
import type { Usuario } from '../types'
import { SUBMISSOES_DE_ENSAIO } from './central'

/* ------------------------------------------------------------------ catálogos */

export const SITUACOES_PEDIDO = ['SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO', 'ENTREGUE', 'ENCERRADO', 'CANCELADO'] as const
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number]
export const SITUACOES_FINAIS: readonly SituacaoPedido[] = ['ENCERRADO', 'CANCELADO']
export const NOME_SITUACAO_PEDIDO: Record<SituacaoPedido, string> = {
  SOLICITADO: 'Solicitado', TRIAGEM_TECNICA: 'Triagem técnica', DADOS_PENDENTES: 'Dados pendentes', EM_DESENVOLVIMENTO: 'Em desenvolvimento',
  ENTREGUE: 'Entregue', ENCERRADO: 'Encerrado', CANCELADO: 'Cancelado',
}
/** Com quem está a bola em cada situação. */
export const COM_QUEM: Record<SituacaoPedido, 'Comercial' | 'Engenharia' | '—'> = {
  SOLICITADO: 'Engenharia', TRIAGEM_TECNICA: 'Engenharia', DADOS_PENDENTES: 'Comercial', EM_DESENVOLVIMENTO: 'Engenharia', ENTREGUE: 'Comercial', ENCERRADO: '—', CANCELADO: '—',
}

export const TIPOS_SOLICITACAO = ['Estudo preliminar', 'Anteprojeto estrutural', 'Projeto executivo', 'Análise técnica', 'Apoio ao orçamento técnico'] as const
export type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number]
export const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const
export type Prioridade = (typeof PRIORIDADES)[number]
export const ORIGENS_LEAD = ['SIMULADOR', 'INBOX', 'LEAD_ENGINE', 'RADAR', 'REUNIAO', 'INDICACAO', 'OUTRO'] as const
export type OrigemLead = (typeof ORIGENS_LEAD)[number]
export const NOME_ORIGEM_LEAD: Record<OrigemLead, string> = {
  SIMULADOR: 'Simulador do site', INBOX: 'Conversa do EIFF Inbox', LEAD_ENGINE: 'Lead Engine (candidato promovido)', RADAR: 'Prospecção no Radar',
  REUNIAO: 'Reunião', INDICACAO: 'Indicação', OUTRO: 'Outra',
}
export const EQUIPES_TECNICAS = ['Engenharia estrutural', 'Projetos e detalhamento', 'Orçamento técnico'] as const

/** Campos técnicos, num catálogo só: o formulário, o detalhe, a validação e o banco usam a mesma lista. */
export const CAMPOS_TECNICOS = [
  { chave: 'cidade', rotulo: 'Cidade da obra', tipo: 'texto', obrigatorio: true },
  { chave: 'uf', rotulo: 'UF', tipo: 'texto', obrigatorio: true },
  { chave: 'endereco', rotulo: 'Endereço ou referência', tipo: 'texto' },
  { chave: 'uso', rotulo: 'Uso da edificação', tipo: 'opcao', opcoes: ['Armazenagem', 'Indústria', 'Logística / CD', 'Comércio', 'Agro', 'Esportivo', 'Outro'] },
  { chave: 'areaM2', rotulo: 'Área estimada', tipo: 'numero', unidade: 'm²' },
  { chave: 'comprimentoM', rotulo: 'Comprimento', tipo: 'numero', unidade: 'm' },
  { chave: 'larguraM', rotulo: 'Largura (vão)', tipo: 'numero', unidade: 'm' },
  { chave: 'alturaM', rotulo: 'Altura (pé-direito)', tipo: 'numero', unidade: 'm' },
  { chave: 'tipologia', rotulo: 'Tipologia estrutural', tipo: 'opcao', opcoes: ['Pórtico de alma cheia', 'Treliçado', 'Misto', 'A definir pela Engenharia'] },
  { chave: 'cobertura', rotulo: 'Cobertura', tipo: 'texto' },
  { chave: 'fechamentos', rotulo: 'Fechamentos', tipo: 'texto' },
  { chave: 'projetoArquitetonico', rotulo: 'Projeto arquitetônico', tipo: 'opcao', opcoes: ['Sim', 'Não', 'Em elaboração'] },
  { chave: 'fundacaoTerreno', rotulo: 'Fundação e terreno', tipo: 'texto' },
  { chave: 'observacoes', rotulo: 'Observações técnicas', tipo: 'texto_longo' },
] as const
export type ChaveTecnica = (typeof CAMPOS_TECNICOS)[number]['chave']
/** Um dado técnico: o que foi informado e se a Engenharia já o validou. */
export interface DadoTecnico { dado: string | number; situacao: 'declarado' | 'validado'; validadoPor?: string; validadoEm?: string }
export type DadosTecnicos = Partial<Record<ChaveTecnica, DadoTecnico>>

export const TIPOS_DOCUMENTO = ['arquitetura', 'implantacao', 'topografia', 'sondagem', 'memorial', 'complementar'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]
export const NOME_DOCUMENTO: Record<TipoDocumento, string> = {
  arquitetura: 'Arquitetura', implantacao: 'Implantação', topografia: 'Levantamento topográfico', sondagem: 'Sondagem', memorial: 'Memorial', complementar: 'Documentos complementares',
}
export const SITUACOES_DOCUMENTO = ['nao_necessario', 'pendente', 'recebido', 'validado'] as const
export type SituacaoDocumento = (typeof SITUACOES_DOCUMENTO)[number]
export const NOME_SITUACAO_DOCUMENTO: Record<SituacaoDocumento, string> = { nao_necessario: 'Não necessário', pendente: 'Pendente', recebido: 'Recebido (não validado)', validado: 'Validado pela Engenharia' }
export interface DocumentoPedido { situacao: SituacaoDocumento; referencia?: string; atualizadoPor?: string; atualizadoEm?: string }

/** Referências oficiais (ids), nunca nomes. */
export interface VinculosPedido { submissaoId?: string; registroFonteId?: string; inboxThreadId?: string; orcamentoId?: string }

export interface Pendencia { id: string; descricao: string; aberta: boolean; criadaEm: string; criadaPor: string; resolvidaEm?: string; resolvidaPor?: string; resposta?: string }
export interface EntregaTecnica { em: string; por: string; resumo: string; resultados: string; referencias: string[] }
export type ResultadoEncerramento = 'SEGUE_PARA_ORCAMENTO' | 'ORCAMENTO_VINCULADO' | 'NAO_SEGUIU'
export const NOME_RESULTADO: Record<ResultadoEncerramento, string> = { SEGUE_PARA_ORCAMENTO: 'Segue para o orçamento', ORCAMENTO_VINCULADO: 'Orçamento técnico vinculado', NAO_SEGUIU: 'Cliente não seguiu' }

export interface PedidoProjeto {
  id: string
  organizacaoId: string
  codigo: string
  /** Versão desta solicitação para a mesma oportunidade e o mesmo tipo (1, 2, 3…). */
  versaoTipo: number
  empresaId: string
  oportunidadeId: string
  vinculos: VinculosPedido
  origemLead: OrigemLead
  tipo: TipoSolicitacao
  prioridade: Prioridade
  prazoSolicitado?: string
  responsavelComercialId: string
  dados: DadosTecnicos
  documentos: Record<TipoDocumento, DocumentoPedido>
  equipeTecnica?: string
  responsavelTecnicoId?: string
  prazoEntrega?: string
  situacao: SituacaoPedido
  pendencias: Pendencia[]
  entrega?: EntregaTecnica
  resultado?: { tipo: ResultadoEncerramento; orcamentoId?: string }
  /** Último motivo registrado (devolução, reabertura, cancelamento, não seguiu). */
  motivo?: string
  /** Concorrência otimista. */
  versao: number
  criadoEm: string
  criadoPor: string
  atualizadoEm: string
}

export const ACOES_PEDIDO = [
  'iniciar_triagem', 'registrar_triagem', 'pedir_dados', 'responder_pendencias', 'assumir_desenvolvimento', 'registrar_andamento',
  'entregar', 'reabrir', 'encerrar', 'cancelar', 'atribuir', 'atualizar_documento', 'editar_dados',
] as const
export type AcaoPedido = (typeof ACOES_PEDIDO)[number] | 'criar'
export type LadoPedido = 'comercial' | 'engenharia'

export interface EventoPedido {
  id: string; organizacaoId: string; pedidoId: string; acao: AcaoPedido; de?: SituacaoPedido; para: SituacaoPedido
  por: string; papel: string; em: string; motivo?: string; detalhe?: string; intencao: string
}

interface RegraAcao { de: readonly SituacaoPedido[]; para?: SituacaoPedido; lado: LadoPedido; exigeMotivo: boolean; rotulo: string; descricao: string }
const ABERTAS: readonly SituacaoPedido[] = ['SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO', 'ENTREGUE']

/** Tabela única de ações. `para` ausente = ação de andamento (não muda a situação, mas gera evento). */
export const REGRAS_ACAO: Record<(typeof ACOES_PEDIDO)[number], RegraAcao> = {
  iniciar_triagem: { de: ['SOLICITADO'], para: 'TRIAGEM_TECNICA', lado: 'engenharia', exigeMotivo: false, rotulo: 'Iniciar triagem', descricao: 'A Engenharia assume a avaliação das informações' },
  registrar_triagem: { de: ['TRIAGEM_TECNICA'], lado: 'engenharia', exigeMotivo: false, rotulo: 'Registrar triagem', descricao: 'Valida dados técnicos e anota a avaliação' },
  pedir_dados: { de: ['TRIAGEM_TECNICA', 'EM_DESENVOLVIMENTO'], para: 'DADOS_PENDENTES', lado: 'engenharia', exigeMotivo: true, rotulo: 'Devolver: dados pendentes', descricao: 'Devolve ao Comercial com motivo e o que falta' },
  responder_pendencias: { de: ['DADOS_PENDENTES'], para: 'TRIAGEM_TECNICA', lado: 'comercial', exigeMotivo: false, rotulo: 'Responder pendências', descricao: 'O Comercial responde e devolve à triagem' },
  assumir_desenvolvimento: { de: ['TRIAGEM_TECNICA'], para: 'EM_DESENVOLVIMENTO', lado: 'engenharia', exigeMotivo: false, rotulo: 'Assumir desenvolvimento', descricao: 'O responsável técnico assume, com prazo de entrega' },
  registrar_andamento: { de: ['EM_DESENVOLVIMENTO'], lado: 'engenharia', exigeMotivo: false, rotulo: 'Registrar andamento', descricao: 'Anota o andamento sem mudar a situação' },
  entregar: { de: ['EM_DESENVOLVIMENTO'], para: 'ENTREGUE', lado: 'engenharia', exigeMotivo: false, rotulo: 'Entregar ao Comercial', descricao: 'Registra a conclusão e os resultados' },
  reabrir: { de: ['ENTREGUE'], para: 'EM_DESENVOLVIMENTO', lado: 'comercial', exigeMotivo: true, rotulo: 'Reabrir', descricao: 'O Comercial recusa a entrega, com motivo' },
  encerrar: { de: ['ENTREGUE'], para: 'ENCERRADO', lado: 'comercial', exigeMotivo: false, rotulo: 'Confirmar recebimento e encerrar', descricao: 'O Comercial confirma e segue o atendimento' },
  cancelar: { de: ['SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO'], para: 'CANCELADO', lado: 'comercial', exigeMotivo: true, rotulo: 'Cancelar', descricao: 'Cancela com motivo (a Engenharia só recusa na triagem)' },
  atribuir: { de: ['SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO'], lado: 'engenharia', exigeMotivo: false, rotulo: 'Atribuir responsável técnico', descricao: 'Define equipe e responsável técnico' },
  atualizar_documento: { de: ABERTAS, lado: 'comercial', exigeMotivo: false, rotulo: 'Atualizar documento', descricao: 'Comercial marca recebido; Engenharia valida ou dispensa' },
  editar_dados: { de: ['SOLICITADO', 'DADOS_PENDENTES'], lado: 'comercial', exigeMotivo: false, rotulo: 'Editar dados', descricao: 'O Comercial corrige o que foi declarado' },
}

/** Correspondência SUGERIDA com o estágio da oportunidade (nunca aplicada aqui). */
export const ESTAGIO_SUGERIDO: Partial<Record<SituacaoPedido, Estagio>> = { SOLICITADO: 'PROJECT_RECEIVED', TRIAGEM_TECNICA: 'PROJECT_RECEIVED', DADOS_PENDENTES: 'ENGINEERING', EM_DESENVOLVIMENTO: 'ENGINEERING', ENTREGUE: 'PRICING' }

export type CodigoErroPedido = 'SEM_PERMISSAO' | 'TRANSICAO_INVALIDA' | 'MOTIVO_OBRIGATORIO' | 'DADOS_INCOMPLETOS' | 'VERSAO_DESATUALIZADA' | 'ENSAIO' | 'VINCULO_INVALIDO' | 'DUPLICADA' | 'ESTADO_FINAL'
export class ErroPedido extends Error {
  constructor(public codigo: CodigoErroPedido, mensagem: string) { super(mensagem); this.name = 'ErroPedido' }
}

const temMotivo = (m?: string) => !!m && m.trim().length >= 5
const rotulo = (k: string) => CAMPOS_TECNICOS.find((c) => c.chave === k)?.rotulo.toLowerCase() ?? k
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/* ------------------------------------------------------------------ quem pode */

/** A gestão comercial age pelos dois lados; a Engenharia só pelo dela. */
export function ladosDe(u: Usuario): LadoPedido[] {
  if (!u.ativo) return []
  if (pode(u, 'comercial_gestao')) return ['comercial', 'engenharia']
  if (pode(u, 'comercial_projetos')) return ['engenharia']
  return []
}
export const pedidoVisivel = (u: Usuario, p: Pick<PedidoProjeto, 'organizacaoId'>, organizacaoId: string): boolean => p.organizacaoId === organizacaoId && ladosDe(u).length > 0
export const podeCriar = (u: Usuario) => ladosDe(u).includes('comercial')

/** Ações disponíveis agora para este usuário (o que a tela mostra habilitado). */
export function acoesDisponiveis(u: Usuario, p: Pick<PedidoProjeto, 'situacao' | 'responsavelTecnicoId'>): (typeof ACOES_PEDIDO)[number][] {
  return ACOES_PEDIDO.filter((a) => motivoBloqueio(u, p, a) === undefined)
}

/** Por que a ação não pode ser feita agora (undefined = pode). Mesma regra de `aplicarAcao`, sem os dados da ação. */
export function motivoBloqueio(u: Usuario, p: Pick<PedidoProjeto, 'situacao' | 'responsavelTecnicoId'>, acao: (typeof ACOES_PEDIDO)[number]): string | undefined {
  const regra = REGRAS_ACAO[acao]
  if (SITUACOES_FINAIS.includes(p.situacao)) return `${NOME_SITUACAO_PEDIDO[p.situacao]}: não admite alteração.`
  if (!regra.de.includes(p.situacao)) return `Não disponível em ${NOME_SITUACAO_PEDIDO[p.situacao]}.`
  const lados = ladosDe(u)
  const recusa = acao === 'cancelar' && !lados.includes('comercial') && lados.includes('engenharia') && (p.situacao === 'SOLICITADO' || p.situacao === 'TRIAGEM_TECNICA')
  const documentoPelaEngenharia = acao === 'atualizar_documento' && lados.includes('engenharia')
  if (!lados.includes(regra.lado) && !recusa && !documentoPelaEngenharia) return `Ação do ${regra.lado === 'comercial' ? 'Comercial' : 'lado da Engenharia'}.`
  const soResponsavel = ['registrar_triagem', 'pedir_dados', 'assumir_desenvolvimento', 'registrar_andamento', 'entregar'].includes(acao)
  if (soResponsavel && !lados.includes('comercial') && p.responsavelTecnicoId && p.responsavelTecnicoId !== u.id) return 'Só o responsável técnico age nesta etapa.'
  return undefined
}

/* ------------------------------------------------------------------ criação */

export interface EntradaPedido {
  empresaId: string
  oportunidadeId: string
  vinculos?: VinculosPedido
  origemLead: OrigemLead
  tipo: TipoSolicitacao
  prioridade: Prioridade
  prazoSolicitado?: string
  responsavelComercialId: string
  /** Dados como o cliente declarou: nascem sempre `declarado`. */
  dados: Partial<Record<ChaveTecnica, string | number>>
  documentos: Partial<Record<TipoDocumento, SituacaoDocumento>>
  equipeTecnica?: string
}

/** Fontes oficiais para conferir os vínculos (só ids). */
export interface FontesVinculo { radar: RadarDataset; inbox?: InboxDataset; orcamentos?: readonly { id: string }[] }

/**
 * Confere cada id contra a sua autoridade. Nunca procura por nome: id que não existe, ou que aponta para outra
 * empresa, é recusado.
 */
export function errosDeVinculo(e: Pick<EntradaPedido, 'empresaId' | 'oportunidadeId' | 'vinculos'>, f: FontesVinculo): string[] {
  const out: string[] = []
  const emp = f.radar.empresas.find((x) => x.id === e.empresaId)
  const op = f.radar.oportunidades.find((x) => x.id === e.oportunidadeId)
  if (!emp) out.push('empresa não encontrada no Radar')
  if (!op) out.push('oportunidade não encontrada no Radar')
  else if (op.empresaId !== e.empresaId) out.push('a oportunidade não é desta empresa')
  else if (!estagioAtivo(op.estagio)) out.push('a oportunidade não está ativa (ganha, perdida ou em nutrição)')
  const v = e.vinculos ?? {}
  if (v.submissaoId) {
    if (SUBMISSOES_DE_ENSAIO.includes(v.submissaoId)) out.push('submissão de ensaio não vira solicitação')
    else if (!f.inbox?.mensagens.some((m) => m.externalMessageId === v.submissaoId)) out.push('submissão do simulador não encontrada no Inbox')
  }
  if (v.registroFonteId) {
    const reg = f.radar.registrosFonte.find((x) => x.id === v.registroFonteId)
    if (!reg) out.push('evidência do Lead Engine não encontrada')
    else if (reg.statusIntake !== 'RESOLVED' || reg.entidadeId !== e.empresaId) out.push('a evidência do Lead Engine não foi promovida para esta empresa')
  }
  if (v.inboxThreadId && !f.inbox?.threads.some((t) => t.id === v.inboxThreadId)) out.push('conversa do Inbox não encontrada')
  if (v.orcamentoId && !f.orcamentos?.some((o) => o.id === v.orcamentoId)) out.push('orçamento não encontrado')
  return out
}

export function errosDeEntrada(e: EntradaPedido): string[] {
  const out: string[] = []
  if (!e.responsavelComercialId) out.push('responsável comercial')
  if (!(TIPOS_SOLICITACAO as readonly string[]).includes(e.tipo)) out.push('tipo de solicitação')
  if (!(PRIORIDADES as readonly string[]).includes(e.prioridade)) out.push('prioridade')
  if (!(ORIGENS_LEAD as readonly string[]).includes(e.origemLead)) out.push('origem do lead')
  for (const c of CAMPOS_TECNICOS) if ('obrigatorio' in c && c.obrigatorio && !String(e.dados[c.chave] ?? '').trim()) out.push(c.rotulo.toLowerCase())
  const tecnicos = CAMPOS_TECNICOS.filter((c) => !('obrigatorio' in c && c.obrigatorio)).some((c) => String(e.dados[c.chave] ?? '').trim() !== '')
  if (!tecnicos) out.push('ao menos um dado técnico além do local')
  for (const c of CAMPOS_TECNICOS) if (c.tipo === 'numero' && e.dados[c.chave] !== undefined && e.dados[c.chave] !== '' && !(Number(e.dados[c.chave]) > 0)) out.push(`${c.rotulo.toLowerCase()} deve ser maior que zero`)
  if (e.vinculos?.orcamentoId) out.push('orçamento só se vincula no encerramento')
  return out
}

/** Situação de cada documento, com «não necessário» como padrão. */
export const documentosDe = (d: Partial<Record<TipoDocumento, SituacaoDocumento>>): Record<TipoDocumento, DocumentoPedido> =>
  Object.fromEntries(TIPOS_DOCUMENTO.map((t) => [t, { situacao: d[t] ?? 'nao_necessario' }])) as Record<TipoDocumento, DocumentoPedido>

/**
 * Cria a solicitação (nasce SOLICITADO = encaminhada à Engenharia). `existentes` são as solicitações da organização:
 * recusa uma segunda ABERTA do mesmo tipo para a mesma oportunidade; depois da anterior encerrada ou cancelada, a nova
 * é a versão seguinte.
 */
export function criarPedido(e: EntradaPedido, u: Usuario, ctx: { id: string; organizacaoId: string; agora: string; intencao: string; existentes: readonly PedidoProjeto[]; fontes: FontesVinculo; novoId: (p: string) => string }): { pedido: PedidoProjeto; evento: EventoPedido } {
  if (!podeCriar(u)) throw new ErroPedido('SEM_PERMISSAO', 'Só o Comercial (gestão comercial) abre solicitações de projeto.')
  const vinc = errosDeVinculo(e, ctx.fontes)
  if (vinc.some((x) => x.includes('ensaio'))) throw new ErroPedido('ENSAIO', 'Submissão de ensaio não vira solicitação de projeto.')
  if (vinc.length) throw new ErroPedido('VINCULO_INVALIDO', `Vínculo inválido: ${vinc.join('; ')}.`)
  const falta = errosDeEntrada(e)
  if (falta.length) throw new ErroPedido('DADOS_INCOMPLETOS', `Falta ou está inválido: ${falta.join(', ')}.`)
  const mesmos = ctx.existentes.filter((p) => p.organizacaoId === ctx.organizacaoId && p.oportunidadeId === e.oportunidadeId && p.tipo === e.tipo)
  const aberta = mesmos.find((p) => !SITUACOES_FINAIS.includes(p.situacao))
  if (aberta) throw new ErroPedido('DUPLICADA', `Já existe a solicitação ${aberta.codigo} (${e.tipo}) aberta para esta oportunidade.`)
  const n = ctx.existentes.filter((p) => p.organizacaoId === ctx.organizacaoId).length + 1
  const dados: DadosTecnicos = Object.fromEntries(Object.entries(e.dados)
    .filter(([, v]) => v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => [k, { dado: typeof v === 'number' ? v : String(v).trim(), situacao: 'declarado' } satisfies DadoTecnico])) as DadosTecnicos
  const pedido: PedidoProjeto = {
    id: ctx.id, organizacaoId: ctx.organizacaoId, codigo: `SP-${String(n).padStart(4, '0')}`, versaoTipo: mesmos.length + 1,
    empresaId: e.empresaId, oportunidadeId: e.oportunidadeId, vinculos: { ...(e.vinculos ?? {}) }, origemLead: e.origemLead, tipo: e.tipo,
    prioridade: e.prioridade, ...(e.prazoSolicitado ? { prazoSolicitado: e.prazoSolicitado } : {}), responsavelComercialId: e.responsavelComercialId,
    dados, documentos: documentosDe(e.documentos), ...(e.equipeTecnica ? { equipeTecnica: e.equipeTecnica } : {}), situacao: 'SOLICITADO', pendencias: [],
    versao: 1, criadoEm: ctx.agora, criadoPor: u.id, atualizadoEm: ctx.agora,
  }
  const evento: EventoPedido = { id: ctx.novoId('EVSP'), organizacaoId: ctx.organizacaoId, pedidoId: pedido.id, acao: 'criar', para: 'SOLICITADO', por: u.id, papel: u.papel, em: ctx.agora, intencao: ctx.intencao, detalhe: `${e.tipo} · versão ${pedido.versaoTipo}` }
  return { pedido, evento }
}

/* ------------------------------------------------------------------ ações */

export interface DadosAcao {
  versao: number
  motivo?: string
  nota?: string
  responsavelTecnicoId?: string
  equipeTecnica?: string
  prazoEntrega?: string
  pendencias?: string[]
  resposta?: string
  /** Campos que a Engenharia valida na triagem. */
  validar?: ChaveTecnica[]
  entrega?: { resumo: string; resultados: string; referencias?: string[] }
  resultado?: { tipo: ResultadoEncerramento; orcamentoId?: string }
  documento?: { tipo: TipoDocumento; situacao: SituacaoDocumento; referencia?: string }
  dados?: Partial<Record<ChaveTecnica, string | number>>
}

/**
 * Aplica uma ação: confere estado final, permissão, transição, motivo, versão e os dados exigidos; devolve o pedido
 * novo e o evento. Nada é gravado; `agora` vem de fora (teste determinístico).
 */
export function aplicarAcao(p: PedidoProjeto, acao: (typeof ACOES_PEDIDO)[number], u: Usuario, d: DadosAcao, ctx: { agora: string; intencao: string; novoId: (prefixo: string) => string; organizacaoId: string; orcamentos?: readonly { id: string }[] }): { pedido: PedidoProjeto; evento: EventoPedido } {
  if (!pedidoVisivel(u, p, ctx.organizacaoId)) throw new ErroPedido('SEM_PERMISSAO', 'Solicitação não visível para este perfil.')
  if (SITUACOES_FINAIS.includes(p.situacao)) throw new ErroPedido('ESTADO_FINAL', `${NOME_SITUACAO_PEDIDO[p.situacao]}: não admite alteração.`)
  const bloqueio = motivoBloqueio(u, p, acao)
  if (bloqueio) throw new ErroPedido(bloqueio.startsWith('Não disponível') ? 'TRANSICAO_INVALIDA' : 'SEM_PERMISSAO', bloqueio)
  if (d.versao !== p.versao) throw new ErroPedido('VERSAO_DESATUALIZADA', 'A solicitação mudou desde que você abriu. Atualize a tela.')
  const regra = REGRAS_ACAO[acao]
  if (regra.exigeMotivo && !temMotivo(d.motivo)) throw new ErroPedido('MOTIVO_OBRIGATORIO', 'Informe o motivo (ao menos 5 caracteres).')
  const { agora } = ctx
  let n: PedidoProjeto = { ...p, situacao: regra.para ?? p.situacao, versao: p.versao + 1, atualizadoEm: agora }
  let detalhe: string | undefined
  switch (acao) {
    case 'iniciar_triagem':
      n = { ...n, responsavelTecnicoId: d.responsavelTecnicoId ?? p.responsavelTecnicoId ?? u.id, ...(d.equipeTecnica ? { equipeTecnica: d.equipeTecnica } : {}) }
      break
    case 'registrar_triagem': {
      const validar = (d.validar ?? []).filter((k) => p.dados[k])
      if (!validar.length && !d.nota?.trim()) throw new ErroPedido('DADOS_INCOMPLETOS', 'Valide ao menos um dado ou escreva a avaliação.')
      n = { ...n, dados: { ...p.dados, ...Object.fromEntries(validar.map((k) => [k, { ...p.dados[k]!, situacao: 'validado', validadoPor: u.id, validadoEm: agora }])) } }
      detalhe = [validar.length ? `validou: ${validar.map(rotulo).join(', ')}` : '', d.nota?.trim() ?? ''].filter(Boolean).join(' · ')
      break
    }
    case 'pedir_dados': {
      const itens = (d.pendencias ?? []).map((x) => x.trim()).filter(Boolean)
      if (!itens.length) throw new ErroPedido('DADOS_INCOMPLETOS', 'Liste as informações necessárias.')
      n = { ...n, pendencias: [...p.pendencias, ...itens.map((descricao) => ({ id: ctx.novoId('PEND'), descricao, aberta: true, criadaEm: agora, criadaPor: u.id }))] }
      detalhe = itens.join('; ')
      break
    }
    case 'responder_pendencias': {
      const resposta = d.resposta?.trim() ?? ''
      if (resposta.length < 5) throw new ErroPedido('DADOS_INCOMPLETOS', 'Responda o que foi providenciado.')
      n = { ...n, pendencias: p.pendencias.map((x) => (x.aberta ? { ...x, aberta: false, resolvidaEm: agora, resolvidaPor: u.id, resposta } : x)) }
      detalhe = resposta
      break
    }
    case 'assumir_desenvolvimento': {
      const prazo = d.prazoEntrega ?? p.prazoEntrega
      if (!prazo) throw new ErroPedido('DADOS_INCOMPLETOS', 'Informe o prazo de entrega.')
      if (p.pendencias.some((x) => x.aberta)) throw new ErroPedido('DADOS_INCOMPLETOS', 'Há pendências abertas: devolva ao Comercial antes.')
      n = { ...n, prazoEntrega: prazo, responsavelTecnicoId: p.responsavelTecnicoId ?? u.id }
      detalhe = `prazo de entrega ${dataBr(prazo)}`
      break
    }
    case 'registrar_andamento':
      if (!d.nota?.trim()) throw new ErroPedido('DADOS_INCOMPLETOS', 'Descreva o andamento.')
      detalhe = d.nota.trim()
      break
    case 'entregar': {
      const resumo = d.entrega?.resumo?.trim() ?? ''
      const resultados = d.entrega?.resultados?.trim() ?? ''
      if (resumo.length < 10 || resultados.length < 5) throw new ErroPedido('DADOS_INCOMPLETOS', 'Descreva a entrega e os resultados técnicos.')
      const pendentes = TIPOS_DOCUMENTO.filter((t) => p.documentos[t].situacao === 'pendente')
      if (pendentes.length) throw new ErroPedido('DADOS_INCOMPLETOS', `Documentos ainda pendentes: ${pendentes.map((t) => NOME_DOCUMENTO[t]).join(', ')} (receber, validar ou marcar como não necessário).`)
      n = { ...n, entrega: { em: agora, por: u.id, resumo, resultados, referencias: d.entrega?.referencias ?? [] } }
      detalhe = resumo
      break
    }
    case 'reabrir':
      n = { ...n, entrega: undefined }
      break
    case 'encerrar': {
      const r = d.resultado
      if (!r) throw new ErroPedido('DADOS_INCOMPLETOS', 'Informe como o atendimento segue.')
      if (r.tipo === 'ORCAMENTO_VINCULADO') {
        if (!r.orcamentoId) throw new ErroPedido('DADOS_INCOMPLETOS', 'Escolha o orçamento técnico.')
        if (!ctx.orcamentos?.some((o) => o.id === r.orcamentoId)) throw new ErroPedido('VINCULO_INVALIDO', 'Orçamento não encontrado.')
        n = { ...n, vinculos: { ...p.vinculos, orcamentoId: r.orcamentoId } }
      }
      if (r.tipo === 'NAO_SEGUIU' && !temMotivo(d.motivo)) throw new ErroPedido('MOTIVO_OBRIGATORIO', 'Informe por que o cliente não seguiu.')
      n = { ...n, resultado: r }
      detalhe = NOME_RESULTADO[r.tipo]
      break
    }
    case 'atribuir':
      if (!d.responsavelTecnicoId && !d.equipeTecnica) throw new ErroPedido('DADOS_INCOMPLETOS', 'Escolha a equipe ou o responsável técnico.')
      n = { ...n, ...(d.responsavelTecnicoId ? { responsavelTecnicoId: d.responsavelTecnicoId } : {}), ...(d.equipeTecnica ? { equipeTecnica: d.equipeTecnica } : {}) }
      detalhe = [d.equipeTecnica, d.responsavelTecnicoId].filter(Boolean).join(' · ')
      break
    case 'atualizar_documento': {
      const doc = d.documento
      if (!doc) throw new ErroPedido('DADOS_INCOMPLETOS', 'Escolha o documento.')
      const lados = ladosDe(u)
      // validar e dispensar são decisões técnicas; o Comercial marca pendente/recebido
      if ((doc.situacao === 'validado' || doc.situacao === 'nao_necessario') && !lados.includes('engenharia')) throw new ErroPedido('SEM_PERMISSAO', 'Validar ou dispensar documento é da Engenharia.')
      if ((doc.situacao === 'pendente' || doc.situacao === 'recebido') && !lados.includes('comercial')) throw new ErroPedido('SEM_PERMISSAO', 'Quem pede e recebe o documento do cliente é o Comercial.')
      n = { ...n, documentos: { ...p.documentos, [doc.tipo]: { situacao: doc.situacao, ...(doc.referencia ? { referencia: doc.referencia } : {}), atualizadoPor: u.id, atualizadoEm: agora } } }
      detalhe = `${NOME_DOCUMENTO[doc.tipo]}: ${NOME_SITUACAO_DOCUMENTO[doc.situacao]}`
      break
    }
    case 'editar_dados': {
      const novos = d.dados ?? {}
      const muda = Object.entries(novos).filter(([k, v]) => String(p.dados[k as ChaveTecnica]?.dado ?? '') !== String(v ?? ''))
      if (!muda.length) throw new ErroPedido('DADOS_INCOMPLETOS', 'Nada mudou.')
      const dados = { ...p.dados }
      for (const [k, v] of muda) {
        if (v === undefined || String(v).trim() === '') delete dados[k as ChaveTecnica]
        else dados[k as ChaveTecnica] = { dado: typeof v === 'number' ? v : String(v).trim(), situacao: 'declarado' } // dado alterado volta a ser declarado
      }
      const falta = errosDeEntrada({ empresaId: p.empresaId, oportunidadeId: p.oportunidadeId, origemLead: p.origemLead, tipo: p.tipo, prioridade: p.prioridade, responsavelComercialId: p.responsavelComercialId, documentos: {}, dados: Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, v!.dado])) })
      if (falta.length) throw new ErroPedido('DADOS_INCOMPLETOS', `Falta ou está inválido: ${falta.join(', ')}.`)
      n = { ...n, dados }
      detalhe = `alterou: ${muda.map(([k]) => rotulo(k)).join(', ')}`
      break
    }
  }
  if (temMotivo(d.motivo)) n = { ...n, motivo: d.motivo!.trim() }
  const evento: EventoPedido = {
    id: ctx.novoId('EVSP'), organizacaoId: p.organizacaoId, pedidoId: p.id, acao, de: p.situacao, para: n.situacao, por: u.id, papel: u.papel, em: agora, intencao: ctx.intencao,
    ...(temMotivo(d.motivo) ? { motivo: d.motivo!.trim() } : {}), ...(detalhe ? { detalhe } : {}),
  }
  return { pedido: n, evento }
}

/* ------------------------------------------------------------------ leitura */

export type SituacaoPrazo = 'concluido' | 'sem_prazo' | 'no_prazo' | 'vence_logo' | 'atrasado'
export const NOME_SITUACAO_PRAZO: Record<SituacaoPrazo, string> = { concluido: 'Concluído', sem_prazo: 'Sem prazo', no_prazo: 'No prazo', vence_logo: 'Vence em até 2 dias', atrasado: 'Atrasado' }
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86_400_000)
/** Prazo que vale: o de entrega (Engenharia) ou, antes dele, o solicitado (Comercial). */
export const prazoVigente = (p: Pick<PedidoProjeto, 'prazoEntrega' | 'prazoSolicitado'>) => p.prazoEntrega ?? p.prazoSolicitado
export function situacaoPrazo(p: Pick<PedidoProjeto, 'situacao' | 'prazoEntrega' | 'prazoSolicitado'>, hoje: string): SituacaoPrazo {
  if (p.situacao === 'ENTREGUE' || SITUACOES_FINAIS.includes(p.situacao)) return 'concluido'
  const prazo = prazoVigente(p)
  if (!prazo) return 'sem_prazo'
  const d = dias(hoje, prazo)
  return d < 0 ? 'atrasado' : d <= 2 ? 'vence_logo' : 'no_prazo'
}

export interface ResumoPedidos { abertas: number; comEngenharia: number; comComercial: number; atrasadas: number; venceLogo: number; pendenciasAbertas: number; encerradas: number; canceladas: number; porSituacao: Record<SituacaoPedido, number> }
export function resumoPedidos(lista: readonly PedidoProjeto[], hoje: string): ResumoPedidos {
  const porSituacao = Object.fromEntries(SITUACOES_PEDIDO.map((s) => [s, lista.filter((p) => p.situacao === s).length])) as Record<SituacaoPedido, number>
  const abertas = lista.filter((p) => !SITUACOES_FINAIS.includes(p.situacao))
  return {
    abertas: abertas.length, comEngenharia: abertas.filter((p) => COM_QUEM[p.situacao] === 'Engenharia').length, comComercial: abertas.filter((p) => COM_QUEM[p.situacao] === 'Comercial').length,
    atrasadas: abertas.filter((p) => situacaoPrazo(p, hoje) === 'atrasado').length, venceLogo: abertas.filter((p) => situacaoPrazo(p, hoje) === 'vence_logo').length,
    pendenciasAbertas: abertas.reduce((s, p) => s + p.pendencias.filter((x) => x.aberta).length, 0), encerradas: porSituacao.ENCERRADO, canceladas: porSituacao.CANCELADO, porSituacao,
  }
}

/** Divergência entre a solicitação e o estágio da oportunidade (a tela mostra; nunca corrige sozinha). */
export function divergenciaDeEstagio(p: Pick<PedidoProjeto, 'situacao'>, estagioAtual: Estagio | undefined): Estagio | undefined {
  const sugerido = ESTAGIO_SUGERIDO[p.situacao]
  if (!sugerido || !estagioAtual || !estagioAtivo(estagioAtual)) return undefined
  // só sugere AVANÇAR: oportunidade já adiante (proposta, negociação) nunca recebe sugestão de voltar
  return ESTAGIOS.indexOf(estagioAtual) < ESTAGIOS.indexOf(sugerido) ? sugerido : undefined
}

/**
 * O que a Engenharia recebe: a solicitação SEM ids da oportunidade, da conversa, da submissão e da evidência (não
 * servem ao trabalho técnico e abririam caminho para o comercial), com o nome da empresa resolvido. A solicitação em
 * si já não tem campo comercial.
 */
export type PedidoTecnico = Omit<PedidoProjeto, 'oportunidadeId' | 'vinculos'> & { empresaNome: string }
export function visaoTecnica(p: PedidoProjeto, empresaNome: string): PedidoTecnico {
  const { oportunidadeId: _op, vinculos: _v, ...resto } = p
  void _op; void _v
  return { ...resto, empresaNome }
}

/** Campos que uma solicitação NUNCA pode ter (prova de que o payload da Engenharia não carrega o comercial). */
export const CAMPOS_PROIBIDOS_PEDIDO = ['valor', 'valorEstimado', 'valorFechado', 'probabilidade', 'negociacao', 'contato', 'contatoNome', 'telefone', 'email', 'whatsapp', 'mensagem', 'observacoesComerciais'] as const

/* ------------------------------------------------------------------ simulador */

/** Dados declarados a partir da submissão do simulador: só o técnico (configuração, medidas, especificação, prazo). */
export function dadosDoSimulador(s: { configuracao?: string; medidas?: string; especificacao?: string; prazo?: string }): Partial<Record<ChaveTecnica, string>> {
  const obs = [s.configuracao && `Configuração declarada: ${s.configuracao}`, s.medidas && `Medidas declaradas: ${s.medidas}`, s.especificacao && `Especificação declarada: ${s.especificacao}`, s.prazo && `Prazo informado: ${s.prazo}`].filter(Boolean)
  return obs.length ? { observacoes: obs.join('\n') } : {}
}

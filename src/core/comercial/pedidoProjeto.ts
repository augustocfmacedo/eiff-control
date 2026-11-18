// E11.2 — Solicitação (pedido) de projeto: o encaminhamento formal Comercial → Engenharia → Comercial.
//
// CONTRATO em código puro, ainda SEM banco, sem store e sem tela (E11.1F, docs/central-gestao-comercial.md §11). Serve
// de especificação executável para a migration proposta (docs/propostas/pedido-projeto.proposta.sql) e para a futura
// action do store: o banco repete estas regras (RPC pp_transicionar), o app as usa para a UX. Nada aqui grava.
//
// Princípios:
//   - o pedido é TÉCNICO por construção: não tem valor, probabilidade, negociação, nem contato do cliente (nome,
//     telefone, e-mail). Empresa e oportunidade entram só como REFERÊNCIA (id oficial), nunca como cópia;
//   - a Engenharia vê só o que foi ENCAMINHADO a ela (situação diferente de RASCUNHO), sem precisar do Inbox Comercial;
//   - toda mudança é uma ação nomeada que gera um evento (histórico append-only); motivo obrigatório onde há recusa,
//     devolução ou cancelamento;
//   - o estágio da oportunidade NÃO é mudado aqui (o Radar é a autoridade); `estagioSugerido` só aponta a divergência.
import { pode } from '../permissoes'
import type { SolicitacaoDoSite } from '../inbox/leadsSite'
import type { Estagio } from '../radar/types'
import type { Usuario } from '../types'
import { SUBMISSOES_DE_ENSAIO } from './central'

export const SITUACOES_PEDIDO = ['RASCUNHO', 'SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO', 'ENTREGUE', 'ENCERRADO', 'CANCELADO'] as const
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number]
export const SITUACOES_FINAIS: readonly SituacaoPedido[] = ['ENCERRADO', 'CANCELADO']
export const NOME_SITUACAO_PEDIDO: Record<SituacaoPedido, string> = {
  RASCUNHO: 'Rascunho (comercial)', SOLICITADO: 'Solicitado', TRIAGEM_TECNICA: 'Triagem técnica', DADOS_PENDENTES: 'Dados pendentes',
  EM_DESENVOLVIMENTO: 'Em desenvolvimento', ENTREGUE: 'Entregue', ENCERRADO: 'Encerrado', CANCELADO: 'Cancelado',
}

export const ORIGENS_PEDIDO = ['SIMULADOR', 'INBOX', 'RADAR', 'REUNIAO', 'OUTRO'] as const
export type OrigemPedido = (typeof ORIGENS_PEDIDO)[number]
/** Referência à origem SEMPRE por id oficial (nunca por nome). */
export interface ReferenciaOrigem { tipo: 'submissao' | 'conversa' | 'candidato' | 'atividade'; id: string }

export const TIPOS_PROJETO = ['Galpão', 'Mezanino', 'Cobertura', 'Ampliação', 'Retrofit', 'Outro'] as const
export type TipoProjeto = (typeof TIPOS_PROJETO)[number]

export const TIPOS_DOCUMENTO = ['planta', 'topografia', 'sondagem', 'memorial', 'layout', 'outro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]
export interface DocumentoPedido { tipo: TipoDocumento; situacao: 'pendente' | 'recebido' | 'dispensado'; anexoId?: string; observacao?: string }

export interface Terreno { cidade?: string; uf?: string; endereco?: string; areaM2?: number; topografia?: string; acesso?: string; sondagemDisponivel?: boolean }
export interface Construcao { tipologia?: string; vaoM?: number; comprimentoM?: number; peDireitoM?: number; areaM2?: number; cobertura?: string; fechamento?: string; ponteRolante?: boolean; mezanino?: boolean }

/** O que o cliente DECLAROU — preliminar, não verificado, imutável depois do envio. */
export interface DadoDeclarado { rotulo: string; texto: string; fonte: OrigemPedido; registradoEm: string }

export interface Pendencia { id: string; descricao: string; aberta: boolean; criadaEm: string; criadaPor: string; resolvidaEm?: string; resolvidaPor?: string }

export type ResultadoEncerramento = 'ORCAMENTO_GERADO' | 'NAO_SEGUIU'
export interface EntregaTecnica { em: string; por: string; resumo: string; anexoIds: string[] }

export interface PedidoProjeto {
  id: string
  codigo: string
  empresaId: string
  oportunidadeId: string
  projetoId?: string
  origem: OrigemPedido
  origemRef?: ReferenciaOrigem
  inboxThreadId?: string
  tipoProjeto: TipoProjeto
  terreno: Terreno
  construcao: Construcao
  dadosDeclarados: DadoDeclarado[]
  observacaoTecnica?: string
  documentos: DocumentoPedido[]
  pendencias: Pendencia[]
  responsavelComercialId: string
  responsavelTecnicoId?: string
  prazo?: string
  situacao: SituacaoPedido
  /** Último motivo (devolução, recusa, reabertura, cancelamento, não seguiu). */
  motivo?: string
  entrega?: EntregaTecnica
  resultado?: { tipo: ResultadoEncerramento; orcamentoId?: string }
  versao: number
  criadoEm: string
  criadoPor: string
  atualizadoEm: string
}

export interface EventoPedido { id: string; pedidoId: string; acao: AcaoPedido; de: SituacaoPedido; para: SituacaoPedido; por: string; papel: string; em: string; motivo?: string }

export const ACOES_PEDIDO = ['enviar', 'iniciar_triagem', 'aceitar', 'pedir_dados', 'responder_pendencias', 'entregar', 'reabrir', 'encerrar', 'cancelar'] as const
export type AcaoPedido = (typeof ACOES_PEDIDO)[number]
export type LadoPedido = 'comercial' | 'engenharia'

interface RegraTransicao { de: readonly SituacaoPedido[]; para: SituacaoPedido; lado: LadoPedido; exigeMotivo: boolean; descricao: string }

/** Tabela única de transições (o banco repete esta tabela na RPC). */
export const TRANSICOES_PEDIDO: Record<AcaoPedido, RegraTransicao> = {
  enviar: { de: ['RASCUNHO'], para: 'SOLICITADO', lado: 'comercial', exigeMotivo: false, descricao: 'Comercial encaminha à Engenharia' },
  iniciar_triagem: { de: ['SOLICITADO'], para: 'TRIAGEM_TECNICA', lado: 'engenharia', exigeMotivo: false, descricao: 'Engenharia assume a triagem e define o responsável técnico' },
  aceitar: { de: ['TRIAGEM_TECNICA'], para: 'EM_DESENVOLVIMENTO', lado: 'engenharia', exigeMotivo: false, descricao: 'Engenharia aceita, com prazo' },
  pedir_dados: { de: ['TRIAGEM_TECNICA', 'EM_DESENVOLVIMENTO'], para: 'DADOS_PENDENTES', lado: 'engenharia', exigeMotivo: true, descricao: 'Devolução ao Comercial: faltam dados ou documentos' },
  responder_pendencias: { de: ['DADOS_PENDENTES'], para: 'TRIAGEM_TECNICA', lado: 'comercial', exigeMotivo: false, descricao: 'Comercial resolveu as pendências e devolve à triagem' },
  entregar: { de: ['EM_DESENVOLVIMENTO'], para: 'ENTREGUE', lado: 'engenharia', exigeMotivo: false, descricao: 'Entrega técnica ao Comercial' },
  reabrir: { de: ['ENTREGUE'], para: 'EM_DESENVOLVIMENTO', lado: 'comercial', exigeMotivo: true, descricao: 'Comercial recusa a entrega e reabre' },
  encerrar: { de: ['ENTREGUE'], para: 'ENCERRADO', lado: 'comercial', exigeMotivo: false, descricao: 'Comercial consome a entrega (orçamento) ou decide não seguir' },
  cancelar: { de: ['RASCUNHO', 'SOLICITADO', 'TRIAGEM_TECNICA', 'DADOS_PENDENTES', 'EM_DESENVOLVIMENTO'], para: 'CANCELADO', lado: 'comercial', exigeMotivo: true, descricao: 'Cancelamento (o Comercial cancela; a Engenharia só recusa na triagem)' },
}

/** Correspondência SUGERIDA com o estágio da oportunidade (nunca aplicada aqui). */
export const ESTAGIO_SUGERIDO: Partial<Record<SituacaoPedido, Estagio>> = { SOLICITADO: 'PROJECT_RECEIVED', TRIAGEM_TECNICA: 'PROJECT_RECEIVED', EM_DESENVOLVIMENTO: 'ENGINEERING', DADOS_PENDENTES: 'ENGINEERING', ENTREGUE: 'PRICING' }

export class ErroPedido extends Error {
  constructor(public codigo: 'SEM_PERMISSAO' | 'TRANSICAO_INVALIDA' | 'MOTIVO_OBRIGATORIO' | 'DADOS_INCOMPLETOS' | 'VERSAO_DESATUALIZADA' | 'ENSAIO' | 'SEM_EMPRESA', mensagem: string) { super(mensagem) }
}

const temMotivo = (m?: string) => !!m && m.trim().length >= 5

/** Comercial = quem tem a gestão comercial (Direção; o papel Comercial quando existir). Engenharia = papel Engenharia, ou a Direção. */
export function ladoDe(u: Usuario): LadoPedido[] {
  if (!u.ativo) return []
  const lados: LadoPedido[] = []
  if (pode(u, 'comercial_gestao')) lados.push('comercial', 'engenharia')
  else if (pode(u, 'comercial_projetos')) lados.push('engenharia')
  return lados
}

/** A Engenharia vê só o que foi encaminhado a ela; a gestão comercial vê tudo; os demais, nada. */
export function pedidoVisivel(u: Usuario, p: Pick<PedidoProjeto, 'situacao'>): boolean {
  if (!u.ativo) return false
  if (pode(u, 'comercial_gestao')) return true
  return pode(u, 'comercial_projetos') && p.situacao !== 'RASCUNHO'
}

/** O que falta para encaminhar. Lista vazia = pode enviar. */
export function pendenciasDeEnvio(p: PedidoProjeto): string[] {
  const f: string[] = []
  if (!p.empresaId) f.push('empresa do Radar (promovida por pessoa)')
  if (!p.oportunidadeId) f.push('oportunidade')
  if (!p.responsavelComercialId) f.push('responsável comercial')
  if (!p.terreno.cidade || !p.terreno.uf) f.push('cidade e UF da obra')
  const temConstrucao = Object.values(p.construcao).some((v) => v !== undefined && v !== '')
  if (!temConstrucao && p.dadosDeclarados.length === 0) f.push('ao menos um dado técnico (construção ou dado declarado)')
  return f
}

export interface DadosAcao {
  motivo?: string
  responsavelTecnicoId?: string
  prazo?: string
  pendencias?: string[]
  entrega?: { resumo: string; anexoIds?: string[] }
  resultado?: { tipo: ResultadoEncerramento; orcamentoId?: string }
  /** Versão que o usuário viu (concorrência otimista). */
  versao: number
}

/**
 * Aplica uma ação: confere permissão, transição, motivo, dados exigidos e versão; devolve o pedido novo e o evento.
 * Nada é gravado. Datas vêm de `agora` (nunca do relógio) para o teste ser determinístico.
 */
export function aplicarAcao(p: PedidoProjeto, acao: AcaoPedido, u: Usuario, d: DadosAcao, agora: string, novoId: (prefixo: string) => string): { pedido: PedidoProjeto; evento: EventoPedido } {
  const regra = TRANSICOES_PEDIDO[acao]
  if (!pedidoVisivel(u, p)) throw new ErroPedido('SEM_PERMISSAO', 'Pedido não visível para este perfil.')
  const lados = ladoDe(u)
  const recusaNaTriagem = acao === 'cancelar' && !lados.includes('comercial') && lados.includes('engenharia') && (p.situacao === 'SOLICITADO' || p.situacao === 'TRIAGEM_TECNICA')
  if (!lados.includes(regra.lado) && !recusaNaTriagem) throw new ErroPedido('SEM_PERMISSAO', `«${regra.descricao}» é ação do lado ${regra.lado}.`)
  if (d.versao !== p.versao) throw new ErroPedido('VERSAO_DESATUALIZADA', 'O pedido mudou desde que você abriu. Recarregue.')
  if (!regra.de.includes(p.situacao)) throw new ErroPedido('TRANSICAO_INVALIDA', `Não dá para ${acao} um pedido em ${NOME_SITUACAO_PEDIDO[p.situacao]}.`)
  if (regra.exigeMotivo && !temMotivo(d.motivo)) throw new ErroPedido('MOTIVO_OBRIGATORIO', 'Informe o motivo (ao menos 5 caracteres).')

  // depois da triagem, só o responsável técnico (ou a Direção) age pela Engenharia
  const soDirecaoOuResponsavel = ['aceitar', 'pedir_dados', 'entregar'].includes(acao) && !lados.includes('comercial') && p.responsavelTecnicoId && p.responsavelTecnicoId !== u.id
  if (soDirecaoOuResponsavel) throw new ErroPedido('SEM_PERMISSAO', 'Só o responsável técnico do pedido age nesta etapa.')

  let n: PedidoProjeto = { ...p, situacao: regra.para, versao: p.versao + 1, atualizadoEm: agora }
  switch (acao) {
    case 'enviar': {
      const falta = pendenciasDeEnvio(p)
      if (falta.length) throw new ErroPedido('DADOS_INCOMPLETOS', `Falta: ${falta.join(', ')}.`)
      break
    }
    case 'iniciar_triagem':
      n = { ...n, responsavelTecnicoId: d.responsavelTecnicoId ?? u.id }
      break
    case 'aceitar':
      if (!d.prazo) throw new ErroPedido('DADOS_INCOMPLETOS', 'Informe o prazo da entrega.')
      if (p.pendencias.some((x) => x.aberta)) throw new ErroPedido('DADOS_INCOMPLETOS', 'Há pendências abertas: peça os dados antes de aceitar.')
      n = { ...n, prazo: d.prazo }
      break
    case 'pedir_dados': {
      const itens = (d.pendencias ?? []).map((x) => x.trim()).filter(Boolean)
      if (!itens.length) throw new ErroPedido('DADOS_INCOMPLETOS', 'Liste o que falta.')
      n = { ...n, pendencias: [...p.pendencias, ...itens.map((descricao) => ({ id: novoId('PEND'), descricao, aberta: true, criadaEm: agora, criadaPor: u.id }))] }
      break
    }
    case 'responder_pendencias':
      n = { ...n, pendencias: p.pendencias.map((x) => (x.aberta ? { ...x, aberta: false, resolvidaEm: agora, resolvidaPor: u.id } : x)) }
      break
    case 'entregar': {
      const resumo = d.entrega?.resumo?.trim() ?? ''
      if (resumo.length < 10) throw new ErroPedido('DADOS_INCOMPLETOS', 'Descreva a entrega técnica (ao menos 10 caracteres).')
      const docsPendentes = p.documentos.filter((x) => x.situacao === 'pendente')
      if (docsPendentes.length) throw new ErroPedido('DADOS_INCOMPLETOS', `Documentos ainda pendentes: ${docsPendentes.map((x) => x.tipo).join(', ')} (receber ou dispensar).`)
      n = { ...n, entrega: { em: agora, por: u.id, resumo, anexoIds: d.entrega?.anexoIds ?? [] } }
      break
    }
    case 'encerrar':
      if (!d.resultado) throw new ErroPedido('DADOS_INCOMPLETOS', 'Informe o resultado: orçamento gerado ou não seguiu.')
      if (d.resultado.tipo === 'ORCAMENTO_GERADO' && !d.resultado.orcamentoId) throw new ErroPedido('DADOS_INCOMPLETOS', 'Vincule o orçamento gerado.')
      if (d.resultado.tipo === 'NAO_SEGUIU' && !temMotivo(d.motivo)) throw new ErroPedido('MOTIVO_OBRIGATORIO', 'Informe por que não seguiu.')
      n = { ...n, resultado: d.resultado }
      break
  }
  if (d.motivo && temMotivo(d.motivo)) n = { ...n, motivo: d.motivo.trim() }
  const evento: EventoPedido = { id: novoId('EVPP'), pedidoId: p.id, acao, de: p.situacao, para: regra.para, por: u.id, papel: u.papel, em: agora, ...(d.motivo && temMotivo(d.motivo) ? { motivo: d.motivo.trim() } : {}) }
  return { pedido: n, evento }
}

/** Divergência entre o pedido e o estágio da oportunidade (para a Central mostrar; nunca corrige sozinha). */
export function divergenciaDeEstagio(p: Pick<PedidoProjeto, 'situacao'>, estagioAtual: Estagio | undefined): Estagio | undefined {
  const sugerido = ESTAGIO_SUGERIDO[p.situacao]
  return sugerido && estagioAtual && sugerido !== estagioAtual ? sugerido : undefined
}

/**
 * Rascunho a partir de uma submissão do simulador. Exige a EMPRESA vinda da promoção humana do candidato (nunca por
 * nome) e recusa ensaio. Copia só o técnico declarado: configuração, medidas, especificação e prazo. Mensagem livre,
 * contato e a leitura automática da página ficam de fora (o comercial copia o que for técnico em `observacaoTecnica`).
 */
export function rascunhoDoSimulador(sub: { externoId: string; threadId: string; em: string; solicitacao: SolicitacaoDoSite }, ctx: { id: string; codigo: string; empresaId?: string; oportunidadeId: string; responsavelComercialId: string; agora: string; criadoPor: string }): PedidoProjeto {
  if (SUBMISSOES_DE_ENSAIO.includes(sub.externoId)) throw new ErroPedido('ENSAIO', 'Submissão de ensaio não vira pedido de projeto.')
  if (!ctx.empresaId) throw new ErroPedido('SEM_EMPRESA', 'Promova o candidato a empresa no Radar antes (Lead Engine › Candidatos).')
  const s = sub.solicitacao
  const declarados: DadoDeclarado[] = ([['Configuração', s.configuracao], ['Medidas', s.medidas], ['Especificação', s.especificacao], ['Prazo informado', s.prazo]] as const)
    .filter(([, v]) => !!v && v.trim() !== '')
    .map(([rotulo, texto]) => ({ rotulo, texto: texto!.trim(), fonte: 'SIMULADOR' as const, registradoEm: sub.em }))
  return {
    id: ctx.id, codigo: ctx.codigo, empresaId: ctx.empresaId, oportunidadeId: ctx.oportunidadeId, origem: 'SIMULADOR',
    origemRef: { tipo: 'submissao', id: sub.externoId }, inboxThreadId: sub.threadId, tipoProjeto: 'Galpão', terreno: {}, construcao: {},
    dadosDeclarados: declarados, documentos: [], pendencias: [], responsavelComercialId: ctx.responsavelComercialId,
    situacao: 'RASCUNHO', versao: 1, criadoEm: ctx.agora, criadoPor: ctx.criadoPor, atualizadoEm: ctx.agora,
  }
}

/** Campos que um pedido NUNCA pode ter (prova de que o payload da Engenharia não carrega o comercial). */
export const CAMPOS_PROIBIDOS_PEDIDO = ['valor', 'valorEstimado', 'probabilidade', 'negociacao', 'contato', 'contatoNome', 'telefone', 'email', 'whatsapp', 'mensagem', 'observacoesComerciais'] as const

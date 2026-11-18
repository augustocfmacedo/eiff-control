// Acesso à Central de Gestão Comercial (E11.1E, docs/central-gestao-comercial.md §8).
//
// Uma regra só, pura, usada pela rota, pela tela e pelos testes: QUEM vê O QUÊ. Não substitui a proteção do banco
// (RLS) — esconder na tela não protege dado que já chegou ao navegador; por isso o carregamento também deixa de trazer
// o Radar para quem não tem a permissão (src/data/supabase.ts) e a migration proposta fecha a leitura no banco.
//
// A visão técnica da Engenharia é uma PROJEÇÃO que só carrega campos técnicos: valor, probabilidade, negociação,
// observações comerciais, nome da pessoa, telefone, e-mail e links para o dossiê ou para a conversa nunca entram nela.
import { pode } from '../permissoes'
import type { Usuario } from '../types'
import type { AreaCentral, FonteSolicitacao, SolicitacaoProjeto } from './central'

export type NivelCentral = 'integral' | 'tecnico' | 'sem_acesso'

export interface EscopoCentral {
  nivel: NivelCentral
  /** Áreas que o perfil pode abrir, na ordem do menu. */
  areas: readonly AreaCentral[]
  /** Dossiê comercial (contatos, conversas, negociação, valores). */
  dossie: boolean
  /** Valores, probabilidade e previsão de fechamento. */
  valores: boolean
  /** Nome, telefone e e-mail de pessoas do cliente. */
  contatos: boolean
  /** Botão de demonstração (dados fictícios) — só na visão integral. */
  demonstracao: boolean
  /** Por que o perfil está neste nível (mostrado na tela). */
  motivo: string
}

const TODAS: readonly AreaCentral[] = ['visao', 'leads', 'retornos', 'propostas', 'projetos', 'pipeline']

export function escopoCentral(u: Usuario): EscopoCentral {
  if (pode(u, 'comercial_gestao')) {
    return { nivel: 'integral', areas: TODAS, dossie: true, valores: true, contatos: true, demonstracao: true, motivo: `O perfil ${u.papel} tem a permissão comercial_gestao.` }
  }
  if (pode(u, 'comercial_projetos')) {
    return { nivel: 'tecnico', areas: ['projetos'], dossie: false, valores: false, contatos: false, demonstracao: false, motivo: `O perfil ${u.papel} vê só os pedidos de projeto, sem valores, negociação nem contatos do cliente. Conversas do site entram aqui quando o EIFF Inbox já as mostra a você (setor ou atribuição).` }
  }
  return { nivel: 'sem_acesso', areas: [], dossie: false, valores: false, contatos: false, demonstracao: false, motivo: `O perfil ${u.papel} não tem acesso à Central de Gestão Comercial.` }
}

/** Área pedida pela URL, rebaixada à primeira permitida (acesso direto por URL nunca abre área fora do escopo). */
export function areaNoEscopo(e: EscopoCentral, pedida: string | null | undefined): AreaCentral | undefined {
  if (e.areas.length === 0) return undefined
  return (e.areas as readonly string[]).includes(pedida ?? '') ? (pedida as AreaCentral) : e.areas[0]
}

/** Dossiê pela URL só no escopo que o permite. */
export const dossieNoEscopo = (e: EscopoCentral, chave: string | null | undefined): string | undefined => (e.dossie && chave ? chave : undefined)

/** Pedido de projeto como a Engenharia o vê: só o necessário para o trabalho técnico. */
export interface SolicitacaoTecnica {
  id: string
  origem: FonteSolicitacao
  tipo: string
  /** Empresa do cliente, ou "Cliente sem empresa informada" (nunca o nome da pessoa). */
  cliente: string
  dadosTecnicos: string[]
  solicitadaEm: string
  prazo?: string
  situacao: string
  /** Quem do comercial conduz (pessoa da EIFF), para a Engenharia saber com quem falar. */
  responsavelComercial?: string
  documentos: 'indisponivel'
}

export const CLIENTE_SEM_EMPRESA = 'Cliente sem empresa informada'

/**
 * Projeção técnica. Deixa de fora, por construção: `cliente` com o nome da pessoa, `escopo` (observações da
 * oportunidade e notas da atividade são texto comercial livre), `dossie` e `link`. O prazo informado pelo visitante
 * no simulador é dado técnico e volta como dado técnico.
 */
export function solicitacaoTecnica(s: SolicitacaoProjeto): SolicitacaoTecnica {
  const prazoInformado = s.fonte === 'simulador_site' && s.escopo ? [s.escopo] : []
  return {
    id: s.id, origem: s.fonte, tipo: s.tipo, cliente: s.empresaCliente ?? CLIENTE_SEM_EMPRESA,
    dadosTecnicos: [...s.dadosTecnicos, ...prazoInformado], solicitadaEm: s.solicitadaEm,
    ...(s.prazo ? { prazo: s.prazo } : {}), situacao: s.situacao,
    ...(s.responsavelNome ? { responsavelComercial: s.responsavelNome } : {}), documentos: s.documentos,
  }
}

export const solicitacoesTecnicas = (lista: readonly SolicitacaoProjeto[]): SolicitacaoTecnica[] => lista.map(solicitacaoTecnica)

/**
 * Matriz proposta (documento §8.1). `vigente` = o que este código aplica hoje; `proposto` = o papel Comercial, que
 * depende da migration de enum e de acesso (§8.6). Exportada para a tela de homologação e para o teste que impede a
 * matriz de divergir do código.
 */
export const MATRIZ_CENTRAL: readonly { papel: string; nivel: NivelCentral; vigente: boolean; observacao: string }[] = [
  { papel: 'Administrador', nivel: 'integral', vigente: true, observacao: 'Visão integral; gestão conforme as permissões oficiais.' },
  { papel: 'Diretoria', nivel: 'integral', vigente: true, observacao: 'Visão integral; gestão conforme as permissões oficiais.' },
  { papel: 'Comercial', nivel: 'integral', vigente: false, observacao: 'PROPOSTO: leads, retornos, oportunidades, orçamentos e pipeline. Exige enum + acesso no banco.' },
  { papel: 'Engenharia', nivel: 'tecnico', vigente: true, observacao: 'Só pedidos de projeto, sem valores, negociação nem contatos.' },
  { papel: 'Financeiro', nivel: 'sem_acesso', vigente: true, observacao: 'Sem a Central; informação financeira terá superfície própria.' },
  { papel: 'Contabilidade', nivel: 'sem_acesso', vigente: true, observacao: 'Sem a Central.' },
  { papel: 'Gestor de obra', nivel: 'sem_acesso', vigente: true, observacao: 'Sem a Central (decisão a confirmar pela Direção).' },
  { papel: 'Compras', nivel: 'sem_acesso', vigente: true, observacao: 'Sem a Central (decisão a confirmar pela Direção).' },
  { papel: 'Auditoria', nivel: 'sem_acesso', vigente: true, observacao: 'Sem a Central.' },
  { papel: 'Solicitante', nivel: 'sem_acesso', vigente: true, observacao: 'Shell reduzido do Diretor Financeiro; nada do comercial.' },
]

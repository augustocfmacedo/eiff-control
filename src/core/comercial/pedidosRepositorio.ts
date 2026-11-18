// Repositório de Solicitações de Projeto (E11.2A). Contrato único para dois adaptadores: EM MEMÓRIA (hoje, só
// demonstração local, nada sobrevive ao recarregar) e, depois da migration homologada, o Supabase pelas RPCs
// pp_criar / pp_transicionar (docs/propostas/pedido-projeto.proposta.sql). A tela fala só com esta interface.
//
// Garantias que o adaptador em memória cumpre e o banco repete:
//   - idempotência: a mesma INTENÇÃO (id gerado uma vez por clique/envio) nunca cria duas solicitações nem aplica a
//     mesma ação duas vezes — devolve o resultado original;
//   - isolamento por organização: nada de uma organização aparece ou é alterado a partir de outra;
//   - histórico append-only: eventos só são acrescentados.
import type { Usuario } from '../types'
import {
  ErroPedido, aplicarAcao, criarPedido, pedidoVisivel, type ACOES_PEDIDO, type DadosAcao, type EntradaPedido, type EventoPedido, type FontesVinculo, type PedidoProjeto, type PedidoTecnico,
} from './pedidoProjeto'

export type AdaptadorPedidos = 'memoria' | 'supabase'

export interface RepositorioPedidos {
  readonly adaptador: AdaptadorPedidos
  listar(u: Usuario, organizacaoId: string): PedidoProjeto[]
  obter(u: Usuario, organizacaoId: string, id: string): PedidoProjeto | undefined
  eventos(u: Usuario, organizacaoId: string, id: string): EventoPedido[]
  criar(e: EntradaPedido, u: Usuario, ctx: { organizacaoId: string; intencao: string; fontes: FontesVinculo }): { pedido: PedidoProjeto; repetida: boolean }
  agir(id: string, acao: (typeof ACOES_PEDIDO)[number], u: Usuario, d: DadosAcao, ctx: { organizacaoId: string; intencao: string; orcamentos?: readonly { id: string }[] }): { pedido: PedidoProjeto; repetida: boolean }
  assinar(fn: () => void): () => void
}

export function repositorioEmMemoria(opts: { agora?: () => string; novoId?: (prefixo: string) => string } = {}): RepositorioPedidos & { limpar(): void; versaoDados(): number } {
  let pedidos: PedidoProjeto[] = []
  let eventos: EventoPedido[] = []
  const intencoes = new Map<string, string>() // intenção → id do pedido (criação e ações)
  const ouvintes = new Set<() => void>()
  let seq = 0
  let versaoDados = 0
  const agora = opts.agora ?? (() => new Date().toISOString())
  const novoId = opts.novoId ?? ((p: string) => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`)
  const avisar = () => { versaoDados++; ouvintes.forEach((f) => f()) }
  const chave = (org: string, intencao: string) => `${org}:${intencao}`

  return {
    adaptador: 'memoria',
    listar: (u, org) => pedidos.filter((p) => pedidoVisivel(u, p, org)),
    obter: (u, org, id) => pedidos.find((p) => p.id === id && pedidoVisivel(u, p, org)),
    eventos: (u, org, id) => (pedidos.some((p) => p.id === id && pedidoVisivel(u, p, org)) ? eventos.filter((e) => e.pedidoId === id) : []),
    criar(e, u, ctx) {
      if (!ctx.intencao) throw new ErroPedido('DADOS_INCOMPLETOS', 'Intenção ausente.')
      const ja = intencoes.get(chave(ctx.organizacaoId, ctx.intencao))
      if (ja) {
        const p = pedidos.find((x) => x.id === ja)
        if (p) return { pedido: p, repetida: true }
      }
      const r = criarPedido(e, u, { id: novoId('SP'), organizacaoId: ctx.organizacaoId, agora: agora(), intencao: ctx.intencao, existentes: pedidos, fontes: ctx.fontes, novoId })
      pedidos = [...pedidos, r.pedido]
      eventos = [...eventos, r.evento]
      intencoes.set(chave(ctx.organizacaoId, ctx.intencao), r.pedido.id)
      avisar()
      return { pedido: r.pedido, repetida: false }
    },
    agir(id, acao, u, d, ctx) {
      if (!ctx.intencao) throw new ErroPedido('DADOS_INCOMPLETOS', 'Intenção ausente.')
      const atual = pedidos.find((p) => p.id === id && p.organizacaoId === ctx.organizacaoId)
      if (!atual) throw new ErroPedido('SEM_PERMISSAO', 'Solicitação não encontrada nesta organização.')
      if (intencoes.get(chave(ctx.organizacaoId, ctx.intencao)) === id && eventos.some((ev) => ev.pedidoId === id && ev.intencao === ctx.intencao)) return { pedido: atual, repetida: true }
      const r = aplicarAcao(atual, acao, u, d, { agora: agora(), intencao: ctx.intencao, novoId, organizacaoId: ctx.organizacaoId, orcamentos: ctx.orcamentos })
      pedidos = pedidos.map((p) => (p.id === id ? r.pedido : p))
      eventos = [...eventos, r.evento]
      intencoes.set(chave(ctx.organizacaoId, ctx.intencao), id)
      avisar()
      return { pedido: r.pedido, repetida: false }
    },
    assinar(fn) { ouvintes.add(fn); return () => { ouvintes.delete(fn) } },
    limpar() { pedidos = []; eventos = []; intencoes.clear(); avisar() },
    versaoDados: () => versaoDados,
  }
}

/** Uma intenção nova por clique/envio (repetir o mesmo clique reaproveita a mesma). */
export const novaIntencao = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `int-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/* ------------------------------------------------------------------ contrato assíncrono (E11.2C) */

/**
 * O que um leitor recebe: a visão técnica sempre; oportunidade e vínculos só para a gestão comercial. No banco, quem
 * decide é a função (pp_json): para a Engenharia esses campos NÃO vêm no payload.
 */
export type PedidoLido = PedidoTecnico & Partial<Pick<PedidoProjeto, 'oportunidadeId' | 'vinculos'>>
export interface ArquivoPedido {
  id: string; tipo: string; versao: number; caminho: string; nome: string; mime: string; tamanho: number
  enviadoPor: string; enviadoEm: string; removidoEm?: string; removidoPor?: string; motivoRemocao?: string
}
export interface ArquivoParaEnviar { nome: string; mime: string; extensao: string; conteudo: Blob | Uint8Array; tamanho: number }

/**
 * Contrato do repositório PERSISTENTE: assíncrono e SEM o usuário nos parâmetros — a identidade vem do JWT da sessão e a
 * autorização é do banco. O adaptador Supabase (src/data/pedidosProjeto.supabase.ts) implementa este contrato; o
 * repositório em memória continua servindo a demonstração local até a tela migrar para ele (plano de ativação, §14).
 */
export interface RepositorioPedidosAsync {
  readonly adaptador: AdaptadorPedidos
  listar(): Promise<PedidoLido[]>
  obter(id: string): Promise<PedidoLido | undefined>
  eventos(id: string): Promise<EventoPedido[]>
  criar(e: EntradaPedido, intencao: string): Promise<PedidoLido>
  agir(id: string, acao: (typeof ACOES_PEDIDO)[number], d: DadosAcao, intencao: string): Promise<PedidoLido>
  arquivos(id: string): Promise<ArquivoPedido[]>
  anexar(id: string, tipo: string, arquivo: ArquivoParaEnviar, intencao: string): Promise<{ id: string; versao: number; caminho: string }>
  removerArquivo(arquivoId: string, motivo: string, intencao: string): Promise<void>
}

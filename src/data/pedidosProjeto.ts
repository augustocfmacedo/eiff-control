// Solicitações de projeto no app (E11.2A): UMA instância do repositório EM MEMÓRIA, só para a demonstração local.
//
// Não há persistência homologada: no modo remoto a tela não grava nada (ações desabilitadas com o motivo) e este
// módulo recusa escrever. Recarregar a página apaga tudo — é o comportamento esperado de uma demonstração, e a tela
// diz isso. A troca para o Supabase acontece só com a migration aprovada (docs/propostas/pedido-projeto.proposta.sql).
import { useSyncExternalStore } from 'react'
import { demonstracaoCentral } from '../core/comercial/demonstracao'
import { ErroPedido, type FontesVinculo } from '../core/comercial/pedidoProjeto'
import { repositorioEmMemoria, type RepositorioPedidos } from '../core/comercial/pedidosRepositorio'
import type { Dataset } from '../core/types'

/** Organização da demonstração local (no modo local não existe organização do banco). */
export const ORGANIZACAO_LOCAL = 'org-local-demonstracao'

const memoria = repositorioEmMemoria()

/** O repositório só existe fora do modo remoto; no remoto, ler devolve vazio e escrever é recusado. */
export function repositorioPedidos(modo: string): RepositorioPedidos {
  if (modo !== 'remoto') return memoria
  return {
    adaptador: 'supabase',
    listar: () => [], obter: () => undefined, eventos: () => [],
    criar: () => { throw new ErroPedido('SEM_PERMISSAO', PERSISTENCIA_PENDENTE) },
    agir: () => { throw new ErroPedido('SEM_PERMISSAO', PERSISTENCIA_PENDENTE) },
    assinar: () => () => undefined,
  }
}

export const PERSISTENCIA_PENDENTE = 'As solicitações de projeto ainda não têm persistência homologada no banco: nesta versão funcionam só na demonstração local, em memória.'

/** Re-renderiza a tela quando a memória muda. */
export function usePedidosVersao(): number {
  return useSyncExternalStore(memoria.assinar, memoria.versaoDados, memoria.versaoDados)
}

/** Limpa a memória (botão da demonstração e testes). */
export const limparDemonstracaoPedidos = () => memoria.limpar()

/**
 * Fontes oficiais para os vínculos: o Radar do próprio dataset quando ele tem oportunidades; senão (modo local com o
 * seed vazio) o Radar FICTÍCIO da demonstração da Central, marcado como tal.
 */
export function fontesDosPedidos(ds: Dataset): { fontes: FontesVinculo; demonstracao: boolean } {
  const real = ds.radar && ds.radar.oportunidades.length > 0
  if (real) return { fontes: { radar: ds.radar, inbox: ds.inbox, orcamentos: ds.orcamentos }, demonstracao: false }
  const d = demonstracaoCentral(ds.params.dataBase, ds.inbox)
  return { fontes: { radar: d.radar, inbox: d.inbox ?? ds.inbox, orcamentos: [...ds.orcamentos, ...d.orcamentos] }, demonstracao: true }
}

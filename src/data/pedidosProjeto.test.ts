// E11.2A — no modo remoto não há persistência homologada: o adaptador nunca grava nem finge que gravou; a demonstração
// local usa o Radar fictício só quando o dataset não tem oportunidades; a rota da lista exige comercial_projetos.
import { describe, expect, it } from 'vitest'
import { ErroPedido } from '../core/comercial/pedidoProjeto'
import { ROTAS_NAV } from '../ui/Paleta'
import { PERSISTENCIA_PENDENTE, fontesDosPedidos, repositorioPedidos } from './pedidosProjeto'
import { getState } from './store'

const DIR = { id: 'u-augusto', nome: 'Augusto', email: 'a@exemplo', papel: 'Diretoria' as const, ativo: true, obras: '*' as const }

describe('Solicitações de projeto no app', () => {
  it('modo remoto: lista vazia e qualquer escrita recusada com o motivo (nada aparenta persistência)', () => {
    const r = repositorioPedidos('remoto')
    expect(r.adaptador).toBe('supabase')
    expect(r.listar(DIR, 'org')).toEqual([])
    const tentar = (f: () => unknown) => { try { f(); return 'gravou' } catch (e) { return e instanceof ErroPedido ? e.message : 'outro' } }
    expect(tentar(() => r.criar({} as never, DIR, { organizacaoId: 'org', intencao: 'i', fontes: {} as never }))).toBe(PERSISTENCIA_PENDENTE)
    expect(tentar(() => r.agir('x', 'cancelar', DIR, { versao: 1 }, { organizacaoId: 'org', intencao: 'i' }))).toBe(PERSISTENCIA_PENDENTE)
  })
  it('modo local: memória; com o seed sem oportunidades, as fontes são as fictícias da demonstração, marcadas', () => {
    expect(repositorioPedidos('local').adaptador).toBe('memoria')
    const { fontes, demonstracao } = fontesDosPedidos(getState().ds)
    expect(demonstracao).toBe(true)
    expect(fontes.radar.oportunidades.every((o) => o.id.startsWith('demo-'))).toBe(true)
  })
  it('menu e paleta: a lista de solicitações exige comercial_projetos', () => {
    expect(ROTAS_NAV.find((r) => r.to === '/comercial/projetos')?.permissao).toBe('comercial_projetos')
  })
})

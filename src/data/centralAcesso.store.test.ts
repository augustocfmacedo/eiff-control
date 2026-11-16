// E11.1E — minimização do Radar no navegador e portas fora da Central (menu, paleta).
// Quem não tem a permissão `radar` recebe o slice VAZIO e sem os padrões (que a sincronização tentaria gravar).
import { describe, expect, it } from 'vitest'
import { radarVazio } from '../core/radar/types'
import type { Dataset, Papel, Usuario } from '../core/types'
import { PAPEIS } from '../core/usuarios'
import { ROTAS_NAV } from '../ui/Paleta'
import { MATRIZ, getState, prepararDatasetRemoto } from './store'

const u = (papel: Papel): Usuario => ({ id: `u-${papel}`, nome: papel, email: `${papel}@exemplo`, papel, ativo: true, obras: '*' } as Usuario)
const remoto = (): Dataset => ({ ...getState().ds, radar: radarVazio() })

describe('Radar carregado só para quem tem a permissão', () => {
  it('sem `radar`: o slice fica vazio e sem padrões (nada a sincronizar)', () => {
    for (const papel of PAPEIS.filter((p) => !MATRIZ.radar.includes(p) && p !== 'Solicitante')) {
      const ds = prepararDatasetRemoto(remoto(), u(papel), true)
      expect(JSON.stringify(ds.radar), papel).toBe(JSON.stringify(radarVazio()))
    }
  })

  it('com `radar`: recebe os padrões como antes (sem regressão)', () => {
    for (const papel of MATRIZ.radar) {
      const ds = prepararDatasetRemoto(remoto(), u(papel), true)
      expect(ds.radar.fontes.length, papel).toBeGreaterThan(0)
      expect(ds.radar.estrategias.length, papel).toBeGreaterThan(0)
    }
  })

  it('o Solicitante continua com o dataset como veio', () => {
    const d = remoto()
    expect(prepararDatasetRemoto(d, u('Solicitante'), true)).toBe(d)
  })
})

describe('Portas fora da Central', () => {
  it('menu e paleta: Radar exige `radar`; a Central exige `comercial_projetos`', () => {
    for (const r of ROTAS_NAV.filter((x) => x.to === '/radar' || x.to.startsWith('/radar/'))) expect(r.permissao, r.to).toBe('radar')
    expect(ROTAS_NAV.find((x) => x.to === '/comercial/gestao')?.permissao).toBe('comercial_projetos')
  })
})

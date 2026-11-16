/**
 * A tela de Auditoria não pode ser tomada pelas linhas operacionais do monitor da reconciliação (E10.17, prova A10:
 * 467 das 500 linhas). O filtro tem de ir NO BANCO, antes do limite — filtrar depois de trazer as 500 não devolve
 * as linhas de negócio que ficaram de fora.
 *
 * Aqui o cliente é o supabase-js de verdade; só o `fetch` é falso, para capturar a URL que iria ao PostgREST.
 * A execução dessa mesma URL contra a `audit_log` real está em `scripts/pg-smoke-monitor.mts` (prova A11).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENTIDADE } from '../core/radar/formularioMonitorPorta'
import { SemRealtime } from './clienteServidor'
import { LIMITE_AUDITORIA, consultaAuditoria } from './supabase'

async function urlDaConsulta(): Promise<URL> {
  let capturada = ''
  const cliente = createClient('https://projeto.supabase.invalido', 'chave-anon-de-teste', {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node 20 (CI e funções) não tem WebSocket nativo: sem isto o createClient recusa nascer (ver clienteServidor.ts)
    realtime: { transport: SemRealtime as unknown as never },
    global: {
      fetch: (async (url: string) => {
        capturada = String(url)
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch,
    },
  })
  await consultaAuditoria(cliente.from('audit_log').select('*'))
  return new URL(capturada)
}

describe('consulta da tela de Auditoria', () => {
  it('exclui o monitor no banco, junto com a ordem e o limite, numa única consulta', async () => {
    const u = await urlDaConsulta()
    expect(u.pathname).toBe('/rest/v1/audit_log')
    expect(u.searchParams.get('entity_type')).toBe(`neq.${ENTIDADE}`)
    expect(u.searchParams.get('order')).toBe('occurred_at.desc')
    expect(u.searchParams.get('limit')).toBe(String(LIMITE_AUDITORIA))
    expect(LIMITE_AUDITORIA).toBe(500)
  })

  it('só o monitor sai: nenhum outro filtro, nenhuma outra entidade', async () => {
    const u = await urlDaConsulta()
    const filtros = [...u.searchParams.keys()].filter((k) => !['select', 'order', 'limit'].includes(k))
    expect(filtros).toEqual(['entity_type'])
    expect(ENTIDADE).toBe('formulario_reconciliacao')
  })

  it('a carga do app usa esta consulta, e não outra montada à mão', () => {
    const fonte = readFileSync('src/data/supabase.ts', 'utf8')
    expect(fonte).toContain("sel('audit_log', '*', consultaAuditoria)")
    expect(fonte.match(/sel\('audit_log'/g)).toHaveLength(1)
  })
})

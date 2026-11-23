import { describe, expect, it } from 'vitest'
import { avaliarCredenciaisDoContexto, CREDENCIAIS_PRIVILEGIADAS, mensagemGuarda } from './guardaCredenciais'

const SEGREDO = 'valor-que-nunca-pode-aparecer-123'

describe('guarda de credenciais por contexto', () => {
  it('production passa mesmo com todas as credenciais', () => {
    const env = Object.fromEntries(CREDENCIAIS_PRIVILEGIADAS.map((k) => [k, SEGREDO]))
    expect(avaliarCredenciaisDoContexto({ ...env, CONTEXT: 'production' })).toEqual({ ok: true, contexto: 'production', motivo: 'production' })
  })

  it.each(['deploy-preview', 'branch-deploy', 'dev'])('%s sem credenciais passa', (CONTEXT) => {
    expect(avaliarCredenciaisDoContexto({ CONTEXT, VITE_SUPABASE_URL: 'x', VITE_SUPABASE_ANON_KEY: 'x' }).ok).toBe(true)
  })

  it('preview com a chave de serviço é recusado e cita só o nome', () => {
    const v = avaliarCredenciaisDoContexto({ CONTEXT: 'deploy-preview', SUPABASE_SERVICE_ROLE_KEY: SEGREDO, ANTHROPIC_API_KEY: SEGREDO })
    expect(v).toEqual({ ok: false, contexto: 'deploy-preview', presentes: ['SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] })
    expect(mensagemGuarda(v)).toContain('BUILD RECUSADO')
    expect(mensagemGuarda(v)).not.toContain(SEGREDO)
  })

  it('valor só com espaços conta como vazio', () => {
    expect(avaliarCredenciaisDoContexto({ CONTEXT: 'deploy-preview', VIBE_API_KEY: '   ' }).ok).toBe(true)
  })

  it('contexto ausente é tratado como não produtivo (falha fechada)', () => {
    expect(avaliarCredenciaisDoContexto({ ANTHROPIC_API_KEY: SEGREDO })).toEqual({ ok: false, contexto: 'desconhecido', presentes: ['ANTHROPIC_API_KEY'] })
  })
})

describe('script do build espelha a regra', () => {
  it('a lista do script é a mesma do core', async () => {
    const { readFileSync } = await import('node:fs')
    const texto = readFileSync(new URL('../../scripts/guarda-credenciais-contexto.mjs', import.meta.url), 'utf8')
    const bloco = texto.slice(texto.indexOf('CREDENCIAIS_PRIVILEGIADAS = ['), texto.indexOf(']', texto.indexOf('CREDENCIAIS_PRIVILEGIADAS = [')))
    expect([...bloco.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1])).toEqual([...CREDENCIAIS_PRIVILEGIADAS])
  })
})

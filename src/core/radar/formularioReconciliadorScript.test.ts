/**
 * O reconciliador MANUAL (`scripts/formulario-reconciliar.mts`) executado de verdade, como processo.
 *
 * Em 10/11/2026 dois reenvios falharam com «fetch failed» sem sair da máquina, e o script não dizia por quê;
 * pior, em um tipo de erro de cabeçalho ele imprimiria o valor do segredo. Aqui o script roda como a Direção o
 * roda — outro processo, credencial só no ambiente — e a prova é a saída inteira (stdout + stderr):
 *
 *   - credencial ausente ou inválida é recusada ANTES de qualquer requisição, com código e nome da variável;
 *   - falha de transporte imprime só o código técnico;
 *   - a credencial fictícia nunca aparece.
 *
 * Nenhuma rede externa: o único destino é uma porta fechada em 127.0.0.1.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SEGREDO = 'seg_FICTICIO_scriptManual_5d81c0_NAO_PODE_VAZAR'
const TOKEN = 'nfp_FICTICIO_scriptManual_e27b94_NAO_PODE_VAZAR'
const RAIZ = path.resolve('.')
let pasta = ''
let arquivo = ''

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'eiff-reconciliar-'))
  arquivo = path.join(pasta, 'submissoes.json')
  writeFileSync(arquivo, JSON.stringify([{
    id: 'sub-ficticia-1', form_name: 'simular-galpao', state: 'verified', created_at: '2026-11-11T10:00:00.000Z',
    data: { nome: 'Lead Fictício', email: 'lead-ficticio@exemplo.invalido', cidade: 'Goiânia, GO', uso: 'industrial', area: '900', observacao: 'Teste.' },
  }]))
})
afterAll(() => { if (pasta !== '') rmSync(pasta, { recursive: true, force: true }) })

function rodar(args: string[], env: Record<string, string | undefined>) {
  const limpo: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...process.env, EIFF_FORM_SECRET: undefined, NETLIFY_AUTH_TOKEN: undefined, ...env })) if (v !== undefined) limpo[k] = v
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'node_modules', 'vite-node', 'vite-node.mjs'), path.join(RAIZ, 'scripts', 'formulario-reconciliar.mts'), '--', ...args], {
    cwd: RAIZ, env: limpo, encoding: 'utf8', timeout: 90_000,
  })
  return { codigo: r.status, saida: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}
const semSegredos = (saida: string) => {
  expect(saida).not.toContain(SEGREDO)
  expect(saida).not.toContain(TOKEN)
  expect(saida).not.toMatch(/Bearer /)
}
const EXECUTAR = ['--marco', '2026-11-10T00:00:00Z', '--executar', '--confirmar', 'FORMULARIO_SITE_V1']
/** Porta 9 (discard) em 127.0.0.1: fechada. Nada sai da máquina. */
const ENDPOINT_FECHADO = ['--endpoint', 'http://127.0.0.1:9/api/formulario-site']

describe('reconciliador manual · credencial conferida antes de qualquer envio', () => {
  it('segredo ausente: BLOQUEADO (saída 2), com o código e o nome da variável', () => {
    const r = rodar(['--arquivo', arquivo, ...EXECUTAR, ...ENDPOINT_FECHADO], {})
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('BLOQUEADO: CREDENCIAL_AUSENTE: EIFF_FORM_SECRET')
    semSegredos(r.saida)
  }, 120_000)

  it('segredo com caractere de controle (o ^V de um Ctrl+V): BLOQUEADO, sem «fetch failed» e sem o valor', () => {
    const r = rodar(['--arquivo', arquivo, ...EXECUTAR, ...ENDPOINT_FECHADO], { EIFF_FORM_SECRET: `${SEGREDO}\u0016` })
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('BLOQUEADO: CREDENCIAL_INVALIDA: EIFF_FORM_SECRET')
    expect(r.saida).not.toContain('fetch failed')
    expect(r.saida).not.toContain('→') // nenhuma linha de envio: nada foi tentado
    semSegredos(r.saida)
  }, 120_000)

  it('token de leitura com caractere inválido: BLOQUEADO antes de chamar a API do Netlify', () => {
    const r = rodar(['--site', 'site-ficticio', '--marco', '2026-11-10T00:00:00Z'], { NETLIFY_AUTH_TOKEN: `${TOKEN}\u001b` })
    expect(r.codigo).toBe(2)
    expect(r.saida).toContain('BLOQUEADO: CREDENCIAL_INVALIDA: NETLIFY_AUTH_TOKEN')
    semSegredos(r.saida)
  }, 120_000)
})

describe('reconciliador manual · falha de transporte', () => {
  it('endpoint inalcançável: imprime o código técnico da causa, sai com 1 e não imprime o segredo', () => {
    const r = rodar(['--arquivo', arquivo, ...EXECUTAR, ...ENDPOINT_FECHADO], { EIFF_FORM_SECRET: SEGREDO })
    expect(r.codigo).toBe(1)
    expect(r.saida).toMatch(/sub-ficticia-1 → falha de transporte: ERRO_REDE( [A-Z_]+)?/)
    expect(r.saida).toMatch(/"motivo": "ERRO_REDE/)
    expect(r.saida).not.toContain('fetch failed')
    semSegredos(r.saida)
  }, 120_000)

  it('simulação continua sem exigir segredo e sem enviar nada', () => {
    const r = rodar(['--arquivo', arquivo, '--marco', '2026-11-10T00:00:00Z'], {})
    expect(r.codigo).toBe(0)
    expect(r.saida).toContain('modo SIMULAÇÃO')
    expect(r.saida).toContain('lidas: 1 · a reenviar: 1 · retidas: 0')
    semSegredos(r.saida)
  }, 120_000)
})

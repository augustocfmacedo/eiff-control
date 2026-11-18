import { describe, expect, it } from 'vitest'
import { deploysNaoProdutivos, metaDaApi, podeConcluir, siteApto, valoresNaoProdutivos, vagaLivre, type MetaVariavel } from './formularioP1'

const v = (key: string, contexts: string[], extra: Partial<MetaVariavel> = {}): MetaVariavel => ({
  key, isSecret: true, scopes: ['functions'], valores: contexts.map((c, i) => ({ id: `${key}-${i}`, context: c })), ...extra,
})

describe('P1 · vaga livre do segredo no CRM', () => {
  it('hoje (só a vaga a): a nova vai para a b', () => {
    expect(vagaLivre([v('EIFF_FORM_SECRET', ['production', 'deploy-preview'])])).toEqual({ ok: true, valor: { emUso: 'EIFF_FORM_SECRET', livre: 'EIFF_FORM_SECRET_B' } })
  })
  it('depois de uma troca (só a b): a próxima volta para a a', () => {
    expect(vagaLivre([v('EIFF_FORM_SECRET_B', ['production'])])).toMatchObject({ ok: true, valor: { livre: 'EIFF_FORM_SECRET' } })
  })
  it('as duas ocupadas: troca anterior não concluída, para', () => {
    expect(vagaLivre([v('EIFF_FORM_SECRET', ['production']), v('EIFF_FORM_SECRET_B', ['production'])]).ok).toBe(false)
  })
  it('nenhuma com valor de produção: para (valor só em preview não conta)', () => {
    expect(vagaLivre([v('EIFF_FORM_SECRET', ['deploy-preview'])]).ok).toBe(false)
    expect(vagaLivre([]).ok).toBe(false)
  })
})

describe('P1 · segredo do site', () => {
  it('os valores fora de produção são os que saem', () => {
    expect(valoresNaoProdutivos(v('EIFF_FORM_SECRET', ['dev', 'branch-deploy', 'deploy-preview', 'production', 'dev-server'])))
      .toEqual(['EIFF_FORM_SECRET-0', 'EIFF_FORM_SECRET-1', 'EIFF_FORM_SECRET-2', 'EIFF_FORM_SECRET-4'])
    expect(valoresNaoProdutivos(undefined)).toEqual([])
  })
  it('só recebe valor novo se for segredo de functions', () => {
    expect(siteApto(v('EIFF_FORM_SECRET', ['production'])).ok).toBe(true)
    expect(siteApto(v('EIFF_FORM_SECRET', ['production'], { isSecret: false })).ok).toBe(false)
    expect(siteApto(v('EIFF_FORM_SECRET', ['production'], { scopes: ['builds', 'functions'] })).ok).toBe(false)
    expect(siteApto(undefined).ok).toBe(false)
  })
  it('a leitura da API descarta qualquer valor que venha junto (segredo em dev volta legível)', () => {
    const m = metaDaApi({ key: 'EIFF_FORM_SECRET', is_secret: true, scopes: ['functions'], values: [{ id: 'x', context: 'dev', value: 'NAO-PODE-APARECER' }] })
    expect(JSON.stringify(m)).not.toContain('NAO-PODE-APARECER')
    expect(m?.valores).toEqual([{ id: 'x', context: 'dev' }])
  })
})

describe('P1 · deploys que ainda servem formulário fora da produção', () => {
  const deploys = [
    { id: 'pub', context: 'production', state: 'ready' },
    { id: 'prod-antigo', context: 'production', state: 'ready' },
    { id: 'pr-9', context: 'deploy-preview', state: 'ready' },
    { id: 'pr-10', context: 'deploy-preview', state: 'ready' },
    { id: 'br', context: 'branch-deploy', state: 'ready' },
    { id: 'pr-falhou', context: 'deploy-preview', state: 'error' },
  ]
  it('previews e branch deploys prontos saem; produção e falhos ficam', () => {
    expect(deploysNaoProdutivos(deploys, 'pub')).toEqual(['pr-9', 'pr-10', 'br'])
  })
  it('o que se pediu para manter fica', () => {
    expect(deploysNaoProdutivos(deploys, 'pub', ['pr-10'])).toEqual(['pr-9', 'br'])
  })
})

describe('P1 · concluir a troca', () => {
  const ambas = [v('EIFF_FORM_SECRET', ['production']), v('EIFF_FORM_SECRET_B', ['production'])]
  it('só com as duas vagas ocupadas e a prova do lead real', () => {
    expect(podeConcluir(ambas, 'EIFF_FORM_SECRET', true)).toEqual({ ok: true, valor: 'EIFF_FORM_SECRET' })
    expect(podeConcluir(ambas, 'EIFF_FORM_SECRET', false).ok).toBe(false)
  })
  it('apagar a antiga sem a nova recusaria todo lead: não deixa', () => {
    expect(podeConcluir([v('EIFF_FORM_SECRET', ['production'])], 'EIFF_FORM_SECRET', true).ok).toBe(false)
  })
})

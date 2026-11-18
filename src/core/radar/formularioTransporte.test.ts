/**
 * O transporte: o que o Netlify entrega → o corpo que a borda aceita.
 *
 * O teste que carrega o peso é o último: a submissão que chega pelo webhook e
 * a MESMA submissão relida pela API de reconciliação têm de produzir a mesma
 * identidade e a mesma impressão. Se não produzirem, a idempotência não vale
 * nada e o reenvio duplica o lead.
 */
import { describe, expect, it } from 'vitest'
import {
  CAMPOS_DESCARTADOS, HONEYPOT_PADRAO, corpoDaSubmissaoNetlify, desembrulhar,
} from './formularioTransporte'
import { pedidoDeIntake } from './formularioSite'
import { validarIntake } from './leadEngineIntake'
import { validarCorpo } from './formularioServidor'

const CAMPOS = {
  nome: 'Ana Lima (FICTÍCIO)',
  email: 'ana@exemplo.com.br',
  telefone: '62 90000-0000',
  empresa: 'Lima Indústria',
  cidade: 'Goiânia, GO',
  uso: 'industrial',
  area: '900',
  observacao: 'Preciso de um galpão para a fábrica.',
}

/** Como o evento da plataforma entrega: embrulhado em `payload`. */
const DO_EVENTO = {
  payload: {
    id: 'nf-777', form_name: 'simular-galpao', created_at: '2026-11-09T14:00:00.000Z',
    data: { ...CAMPOS, 'form-name': 'simular-galpao', [HONEYPOT_PADRAO]: '', ip: '200.1.2.3', user_agent: 'Mozilla', referrer: 'https://google.com' },
  },
}

/** Como a API de submissões entrega: o objeto direto. */
const DA_API = { ...DO_EVENTO.payload }

describe('transporte · as duas formas de entrega', () => {
  it('desembrulha o evento e aceita o objeto direto', () => {
    expect(desembrulhar(DO_EVENTO)?.id).toBe('nf-777')
    expect(desembrulhar(DA_API)?.id).toBe('nf-777')
    expect(desembrulhar(undefined)).toBeUndefined()
    expect(desembrulhar('texto')).toBeUndefined()
  })
})

describe('transporte · o que entra e o que fica fora', () => {
  it('traduz o essencial e normaliza o instante', () => {
    const t = corpoDaSubmissaoNetlify(DO_EVENTO)
    expect(t.ok).toBe(true)
    if (!t.ok) return
    expect(t.corpo.id).toBe('nf-777')
    expect(t.corpo.formulario).toBe('simular-galpao')
    expect(t.corpo.recebidoEm).toBe('2026-11-09T14:00:00.000Z')
    expect(t.corpo.campos['nome']).toBe('Ana Lima (FICTÍCIO)')
    expect(t.corpo.campos['area']).toBe('900')
  })

  it('descarta controle do Netlify, honeypot e dado pessoal que ninguém pediu', () => {
    const t = corpoDaSubmissaoNetlify(DO_EVENTO)
    if (!t.ok) throw new Error('setup')
    for (const campo of [...CAMPOS_DESCARTADOS, HONEYPOT_PADRAO]) {
      expect(Object.keys(t.corpo.campos)).not.toContain(campo)
    }
    /* o IP e o navegador ficam no painel do Netlify, não no Radar */
    expect(JSON.stringify(t.corpo.campos)).not.toContain('200.1.2.3')
    expect(JSON.stringify(t.corpo.campos)).not.toContain('Mozilla')
  })

  it('junta lista (caixa de seleção múltipla) e ignora vazio', () => {
    const t = corpoDaSubmissaoNetlify({ ...DA_API, data: { ...CAMPOS, escopo: ['fabricação', 'montagem'], prazo: '   ', projeto: null } })
    if (!t.ok) throw new Error('setup')
    expect(t.corpo.campos['escopo']).toBe('fabricação, montagem')
    expect(Object.keys(t.corpo.campos)).not.toContain('prazo')
    expect(Object.keys(t.corpo.campos)).not.toContain('projeto')
  })

  it('cai para human_fields quando não há data', () => {
    const t = corpoDaSubmissaoNetlify({ ...DA_API, data: undefined, human_fields: CAMPOS })
    expect(t.ok).toBe(true)
  })
})

describe('transporte · o que é ignorado, com motivo', () => {
  const casos: [string, unknown, string][] = [
    ['sem payload', 42, 'sem_payload'],
    ['sem id', { ...DA_API, id: '' }, 'sem_id'],
    ['sem formulário', { ...DA_API, form_name: '  ' }, 'sem_formulario'],
    ['data impossível', { ...DA_API, created_at: 'ontem' }, 'sem_data'],
    ['sem campos', { ...DA_API, data: {} }, 'sem_campos'],
    ['marcada como spam', { ...DA_API, state: 'spam' }, 'marcada_como_spam'],
    ['honeypot preenchido', { ...DA_API, data: { ...CAMPOS, [HONEYPOT_PADRAO]: 'bot' } }, 'honeypot_preenchido'],
  ]
  for (const [nome, bruto, motivo] of casos) {
    it(nome, () => {
      const t = corpoDaSubmissaoNetlify(bruto)
      expect(t.ok).toBe(false)
      if (!t.ok) expect(t.motivo).toBe(motivo)
    })
  }

  it('formulário de outra coisa só é recusado quando há lista', () => {
    expect(corpoDaSubmissaoNetlify({ ...DA_API, form_name: 'newsletter' }).ok).toBe(true)
    const t = corpoDaSubmissaoNetlify({ ...DA_API, form_name: 'newsletter' }, { formulariosAceitos: ['simular-galpao'] })
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.motivo).toBe('formulario_nao_aceito')
  })

  it('nunca lança: entrada estranha vira motivo', () => {
    for (const x of [null, undefined, 0, '', [], { payload: null }]) {
      expect(() => corpoDaSubmissaoNetlify(x)).not.toThrow()
    }
  })
})

describe('transporte · o corpo traduzido passa no contrato da borda', () => {
  it('sem ajuste nenhum', () => {
    const t = corpoDaSubmissaoNetlify(DO_EVENTO)
    if (!t.ok) throw new Error('setup')
    expect(validarCorpo(t.corpo).ok).toBe(true)
  })
})

describe('transporte · webhook e reconciliação produzem a MESMA chave', () => {
  const impressaoDe = (bruto: unknown) => {
    const t = corpoDaSubmissaoNetlify(bruto)
    if (!t.ok) throw new Error('setup')
    const v = validarIntake(pedidoDeIntake(t.corpo, 'FNT-SITE'))
    if (!v.ok) throw new Error('setup')
    return { externo: v.identidade.externoId, impressao: v.payloadFingerprint }
  }

  it('o evento embrulhado e o objeto da API dão identidade e impressão iguais', () => {
    expect(impressaoDe(DO_EVENTO)).toEqual(impressaoDe(DA_API))
  })

  it('e o instante em outro fuso, com o mesmo momento, também', () => {
    const outroFuso = { ...DA_API, created_at: '2026-11-09T11:00:00.000-03:00' }
    expect(impressaoDe(outroFuso)).toEqual(impressaoDe(DA_API))
  })

  it('conteúdo diferente muda a impressão, não a identidade', () => {
    const outra = impressaoDe({ ...DA_API, data: { ...CAMPOS, area: '1200' } })
    const base = impressaoDe(DA_API)
    expect(outra.externo).toBe(base.externo)
    expect(outra.impressao).not.toBe(base.impressao)
  })
})

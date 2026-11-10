/**
 * Entrada do formulário do site no Radar.
 *
 * O que estes testes provam, além do óbvio: que a integração USA a máquina do
 * Lead Engine em vez de imitá-la. As funções de identidade, classificação e
 * registro chamadas aqui são as mesmas que o CNO usa — se alguém trocar por
 * uma cópia, o teste continua passando mas a chamada some, e por isso há um
 * teste que varre o módulo atrás de reimplementação.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ESTAGIO_INICIAL, FORMULARIOS, PROIBICOES, SCHEMA_FORMULARIO_SITE,
  adapterFormularioSite, canonicoDaSubmissao, cidadeEUf, empresaNormalizada,
  envelopeDaSubmissao, externoIdDaSubmissao, numeroDe, observacoesDoLead,
  oportunidadeDoFormulario, pedidoDeIntake, sinalNormalizado, tipoDoSinal,
  type SubmissaoFormulario,
} from './formularioSite'
import {
  classificarIntake, discoveryRecords, payloadFingerprint, registroDeIntake, validarIntake,
} from './leadEngineIntake'
import { semProximaAcao } from './pipeline'
import { PROBABILIDADE_ESTAGIO } from './padroes'
import type { RegistroFonte, TarefaRadar } from './types'

const SUB: SubmissaoFormulario = {
  id: 'nf-0001',
  formulario: 'simular-galpao',
  recebidoEm: '2026-11-09T13:40:00.000Z',
  campos: {
    uso: 'logistico',
    vao: '25',
    comprimento: '60',
    peDireito: '8',
    cidade: 'Aparecida de Goiânia, GO',
    observacao: 'Doca para dois caminhões.',
    nome: 'Maria Souza',
    empresa: 'Souza Logística',
    email: 'maria@souzalog.com.br',
    telefone: '62 90000-0000',
    area: '1.500 m²',
    resumo: 'Logística · 25 × 60 m · pé-direito 8 m',
    especificacao: 'Cobertura: telha sanduíche · Piso: industrial',
    origem: 'google/cpc/galpao-goiania',
    prazo: '3 a 6 meses',
    escopo: 'Estrutura e fechamento',
  },
}

describe('formulário · o envelope separa evidência de projeção', () => {
  it('a evidência é a submissão como veio, sem edição', () => {
    const e = envelopeDaSubmissao(SUB)
    expect(e.schema).toBe(SCHEMA_FORMULARIO_SITE)
    expect(e.evidence).toEqual(SUB)
    /* o campo `area` chegou como texto com unidade e assim fica na evidência */
    expect(e.evidence.campos['area']).toBe('1.500 m²')
  })

  it('e a projeção lê o dado sem inventar', () => {
    const c = canonicoDaSubmissao(SUB)
    expect(c.formulario).toBe('simular-galpao')
    expect(c.areaM2).toBe(1500)
    expect(c.vaoM).toBe(25)
    expect(c.cidade).toBe('Aparecida de Goiânia')
    expect(c.uf).toBe('GO')
    expect(c.email).toBe('maria@souzalog.com.br')
    expect(c.origem).toBe('google/cpc/galpao-goiania')
  })

  it('campo ausente fica ausente — nunca string vazia nem zero', () => {
    const c = canonicoDaSubmissao({ ...SUB, campos: { nome: 'João', email: 'j@x.com' } })
    expect(c.areaM2).toBeUndefined()
    expect(c.cidade).toBeUndefined()
    expect(c.uf).toBeUndefined()
    expect(c.mensagem).toBeUndefined()
  })

  it('o outro formulário também é lido, com os nomes dele', () => {
    const c = canonicoDaSubmissao({
      id: 'nf-9', formulario: 'iniciar-projeto', recebidoEm: SUB.recebidoEm,
      campos: { nome: 'Frederico', email: 'f@x.com', area: '140', cidade: 'Leopoldo de Bulhões, GO', mensagem: 'preparada para painéis solares' },
    })
    expect(c.formulario).toBe('iniciar-projeto')
    expect(c.areaM2).toBe(140)
    expect(c.mensagem).toBe('preparada para painéis solares')
    expect(FORMULARIOS).toContain(c.formulario)
  })

  it('formulário desconhecido é marcado, não adivinhado', () => {
    expect(canonicoDaSubmissao({ ...SUB, formulario: 'outro' }).formulario).toBe('desconhecido')
  })

  it('cidade e UF: só separa quando a UF está lá', () => {
    expect(cidadeEUf('Goiânia, GO')).toEqual({ cidade: 'Goiânia', uf: 'GO' })
    expect(cidadeEUf('Goiânia')).toEqual({ cidade: 'Goiânia' })
    expect(cidadeEUf('  ')).toEqual({})
  })

  it('número em pt-BR, e indefinido em vez de NaN', () => {
    expect(numeroDe('1.500 m²')).toBe(1500)
    expect(numeroDe('8,5')).toBe(8.5)
    expect(numeroDe('')).toBeUndefined()
    expect(numeroDe('abc')).toBeUndefined()
  })
})

describe('formulário · identidade e idempotência são as do Lead Engine', () => {
  it('a identidade externa é o id do Netlify quando existe', () => {
    expect(externoIdDaSubmissao(SUB)).toBe('nf-0001')
  })

  it('sem id, é determinística — reenviar dá a MESMA chave', () => {
    const s = { ...SUB, id: undefined }
    expect(externoIdDaSubmissao(s)).toBe(externoIdDaSubmissao({ ...s }))
    expect(externoIdDaSubmissao(s)).toContain('simular-galpao|')
    expect(externoIdDaSubmissao(s)).toContain('maria@souzalog.com.br')
  })

  it('e é indefinida quando não há do que derivar', () => {
    expect(externoIdDaSubmissao({ formulario: 'x', recebidoEm: '', campos: {} })).toBeUndefined()
  })

  it('o pedido passa na validação do Lead Engine', () => {
    const v = validarIntake(pedidoDeIntake(SUB, 'FNT-SITE'))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.identidade).toEqual({ fonteId: 'FNT-SITE', externoId: 'nf-0001' })
      expect(v.payloadFingerprint).toBe(payloadFingerprint(envelopeDaSubmissao(SUB)))
    }
  })

  it('a MESMA submissão reprocessada é IDEMPOTENT_NOOP', () => {
    const p = pedidoDeIntake(SUB, 'FNT-SITE')
    const v = validarIntake(p)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const ja: RegistroFonte = registroDeIntake(v, p, 'RF-1')
    const c = classificarIntake(v, discoveryRecords([ja]))
    expect(c.resultado).toBe('IDEMPOTENT_NOOP')
  })

  it('submissão diferente do mesmo id vira NOVA_OBSERVACAO, não sobrescreve', () => {
    const p1 = pedidoDeIntake(SUB, 'FNT-SITE')
    const v1 = validarIntake(p1)
    if (!v1.ok) throw new Error('setup')
    const ja = registroDeIntake(v1, p1, 'RF-1')

    const p2 = pedidoDeIntake(
      { ...SUB, campos: { ...SUB.campos, peDireito: '10' } },
      'FNT-SITE',
    )
    const v2 = validarIntake(p2)
    expect(v2.ok).toBe(true)
    if (!v2.ok) return
    expect(classificarIntake(v2, discoveryRecords([ja])).resultado).toBe('NOVA_OBSERVACAO')
  })

  it('o instante do registro é o da SUBMISSÃO, não o do processamento', () => {
    expect(pedidoDeIntake(SUB, 'FNT-SITE').recebidoEm).toBe(SUB.recebidoEm)
  })
})

describe('formulário · o adapter', () => {
  it('normaliza empresa, contato, projeto e sinal', () => {
    const r = adapterFormularioSite.normalizar(envelopeDaSubmissao(SUB))
    expect(r).toBeDefined()
    expect(r!.fonte).toBe('WEBSITE')
    expect(r!.empresa!.razaoSocial).toBe('Souza Logística')
    expect(r!.empresa!.dominio).toBe('souzalog.com.br')
    expect(r!.empresa!.cidade).toBe('Aparecida de Goiânia')
    expect(r!.contatos![0]!.nome).toBe('Maria Souza')
    expect(r!.contatos![0]!.email).toBe('maria@souzalog.com.br')
    expect(r!.projeto!.areaM2).toBe(1500)
    expect(r!.sinais![0]!.tipo).toBe('PROJECT_IDENTIFIED')
    /* a linhagem leva o envelope INTEIRO, não o eco da normalização */
    expect(r!.payload).toEqual(envelopeDaSubmissao(SUB))
  })

  it('recusa payload de outro esquema — nunca adivinha', () => {
    expect(adapterFormularioSite.normalizar({ nome: 'x' })).toBeUndefined()
    expect(adapterFormularioSite.normalizar(undefined)).toBeUndefined()
    expect(adapterFormularioSite.normalizar({ schema: 'OUTRO', canonical: {} })).toBeUndefined()
  })

  it('sem razão social nem nome não há conta, e o adapter recusa', () => {
    const env = envelopeDaSubmissao({ ...SUB, campos: { email: 'x@y.com' } })
    expect(adapterFormularioSite.normalizar(env)).toBeUndefined()
    expect(empresaNormalizada(env.canonical)).toBeUndefined()
  })

  it('sem empresa, a conta é a pessoa — a raiz nunca fica vazia', () => {
    const env = envelopeDaSubmissao({ ...SUB, campos: { ...SUB.campos, empresa: '' } })
    expect(empresaNormalizada(env.canonical)!.razaoSocial).toBe('Maria Souza')
  })

  it('sem geometria o sinal não é PROJECT_IDENTIFIED', () => {
    const c = canonicoDaSubmissao({ ...SUB, campos: { nome: 'A', email: 'a@b.com', mensagem: 'quero um galpão' } })
    expect(tipoDoSinal(c)).toBe('MANUAL')
    expect(sinalNormalizado(c).eventoEm).toBe(SUB.recebidoEm)
    expect(sinalNormalizado(c).confianca).toBeGreaterThan(0.9)
  })
})

describe('formulário · a oportunidade nasce com próxima ação', () => {
  const o = oportunidadeDoFormulario({
    id: 'OPP-1',
    empresaId: 'EMP-1',
    projetoId: 'PRJ-1',
    responsavelId: 'u-1',
    canonical: canonicoDaSubmissao(SUB),
    agora: '2026-11-09T13:45:00.000Z',
    proximaAcaoEm: '2026-11-10',
  })

  it('no estágio declarado, com a probabilidade da tabela do Radar', () => {
    expect(o.estagio).toBe(ESTAGIO_INICIAL)
    expect(o.probabilidade).toBe(PROBABILIDADE_ESTAGIO[ESTAGIO_INICIAL])
  })

  it('e satisfaz a regra do Radar: oportunidade ativa COM próxima ação', () => {
    expect(o.proximaAcao).toBeTruthy()
    expect(o.proximaAcaoEm).toBe('2026-11-10')
    const semTarefas: TarefaRadar[] = []
    expect(semProximaAcao(o, semTarefas)).toBe(false)
  })

  it('o título diz o que a pessoa pediu, sem adjetivo nosso', () => {
    expect(o.titulo).toContain('1500 m²')
    expect(o.titulo).toContain('Aparecida de Goiânia/GO')
    expect(o.titulo).not.toMatch(/ótim|excelente|quente/i)
  })

  it('as observações levam tudo o que foi informado, inclusive a campanha', () => {
    const t = observacoesDoLead(canonicoDaSubmissao(SUB))
    expect(t).toContain('formulário simular-galpao')
    expect(t).toContain('vão 25 m')
    expect(t).toContain('Doca para dois caminhões.')
    expect(t).toContain('google/cpc/galpao-goiania')
  })

  it('e nenhum número de dimensionamento entra: só o que a pessoa digitou', () => {
    const t = observacoesDoLead(canonicoDaSubmissao(SUB))
    expect(t).not.toMatch(/\bkg\b|tonelada|kN|perfil W|R\$/)
  })
})

describe('formulário · a integração não imita o que já existe', () => {
  it('usa as funções do Lead Engine, não cópias', () => {
    const codigo = readFileSync('src/core/radar/formularioSite.ts', 'utf8')
    const imports = codigo.split('\n').filter((l) => /^import /.test(l)).join(' ')
    expect(imports).toMatch(/leadEngineIntake/)
    /* e não reimplementa hash, dedup nem máquina de estados. A busca é por
       CÓDIGO, não pela palavra: citar PENDING num comentário é explicar o
       comportamento, e explicar é o oposto de duplicar. */
    expect(codigo).not.toMatch(/createHash|sha256/)
    expect(codigo).not.toMatch(/statusIntake\s*[:=]/)
    expect(codigo).not.toMatch(/STATUS_INTAKE\s*=|function transicionar/)
    expect(codigo).not.toMatch(/function .*[Dd]edup/)
  })

  it('e declara o que nunca faz', () => {
    expect(PROIBICOES.length).toBe(6)
    const t = PROIBICOES.join(' | ')
    expect(t).toMatch(/não envia mensagem/)
    expect(t).toMatch(/não promove sozinha/)
    expect(t).toMatch(/não cria mecanismo de follow-up/)
    expect(t).toMatch(/não chama o motor estrutural/)
  })
})

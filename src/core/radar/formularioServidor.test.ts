/**
 * A borda autenticada do formulário do site.
 *
 * O teste que carrega o peso é o da RECUPERAÇÃO: o estado «evidência
 * gravada, conversa não» é o que acontece quando o processo morre entre as
 * duas gravações, e o reenvio do Netlify tem de completar — não duplicar,
 * não ignorar.
 */
import { describe, expect, it } from 'vitest'
import {
  CABECALHO_SEGREDO, LIMITE_CAMPOS, LIMITE_TAMANHO_CAMPO, ORDEM_DAS_GRAVACOES,
  PORQUE_ESSA_ORDEM, PROIBICOES_DA_BORDA, autorizar, planejarGravacao, segredoConfere,
  validarCorpo, type EstadoAtual,
} from './formularioServidor'
import { pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import { registroDeIntake, validarIntake } from './leadEngineIntake'
import type { RegistroFonte } from './types'

const SEGREDO = 'segredo-de-teste-0123456789'
const FONTE = 'FNT-SITE'

const CORPO = {
  id: 'nf-777',
  formulario: 'simular-galpao',
  recebidoEm: '2026-11-09T14:00:00.000Z',
  campos: {
    nome: 'Ana Lima', email: 'ana@exemplo.com.br', telefone: '62 90000-0000',
    cidade: 'Goiânia, GO', uso: 'industrial', area: '900 m²',
    observacao: 'Preciso de um galpão para a fábrica.',
  },
}

const submissaoDe = (c: unknown): SubmissaoFormulario => {
  const v = validarCorpo(c)
  if (!v.ok) throw new Error(`setup: ${v.motivo}`)
  return v.submissao
}

const registroExistente = (s: SubmissaoFormulario): RegistroFonte => {
  const p = pedidoDeIntake(s, FONTE)
  const v = validarIntake(p)
  if (!v.ok) throw new Error('setup')
  return registroDeIntake(v, p, 'RF-1')
}

describe('borda · autenticação fail-closed', () => {
  it('sem segredo no ambiente, recusa — nunca aceita por falta de configuração', () => {
    const r = autorizar({ [CABECALHO_SEGREDO]: SEGREDO }, undefined)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('sem_segredo_configurado')
    expect(autorizar({ [CABECALHO_SEGREDO]: SEGREDO }, '   ').ok).toBe(false)
  })

  it('segredo errado, ausente ou de outro tamanho é recusado', () => {
    expect(autorizar({}, SEGREDO).ok).toBe(false)
    expect(autorizar({ [CABECALHO_SEGREDO]: 'outro' }, SEGREDO).ok).toBe(false)
    expect(autorizar({ [CABECALHO_SEGREDO]: `${SEGREDO}x` }, SEGREDO).ok).toBe(false)
    expect(autorizar({ [CABECALHO_SEGREDO]: SEGREDO.slice(0, -1) }, SEGREDO).ok).toBe(false)
  })

  it('o certo passa, inclusive com o cabeçalho em maiúsculas', () => {
    expect(autorizar({ [CABECALHO_SEGREDO]: SEGREDO }, SEGREDO).ok).toBe(true)
    expect(autorizar({ [CABECALHO_SEGREDO.toUpperCase()]: SEGREDO }, SEGREDO).ok).toBe(true)
  })

  it('a comparação não é por === e recusa tipo errado', () => {
    expect(segredoConfere(SEGREDO, SEGREDO)).toBe(true)
    expect(segredoConfere(undefined, SEGREDO)).toBe(false)
    expect(segredoConfere(SEGREDO, '')).toBe(false)
    /* tamanhos diferentes saem antes de comparar conteúdo */
    expect(segredoConfere('a', 'ab')).toBe(false)
  })
})

describe('borda · o contrato do corpo', () => {
  it('aceita o corpo bom', () => {
    const v = validarCorpo(CORPO)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.submissao.id).toBe('nf-777')
  })

  it('recusa corpo sem formulário, sem data válida ou sem campos', () => {
    expect(validarCorpo(undefined).ok).toBe(false)
    expect(validarCorpo({ ...CORPO, formulario: '  ' }).ok).toBe(false)
    expect(validarCorpo({ ...CORPO, recebidoEm: 'ontem' }).ok).toBe(false)
    expect(validarCorpo({ ...CORPO, campos: undefined }).ok).toBe(false)
  })

  it('recusa campo que não é texto, campo grande demais e campos demais', () => {
    expect(validarCorpo({ ...CORPO, campos: { ...CORPO.campos, x: 7 } }).ok).toBe(false)
    const grande = validarCorpo({ ...CORPO, campos: { ...CORPO.campos, observacao: 'x'.repeat(LIMITE_TAMANHO_CAMPO + 1) } })
    expect(grande.ok).toBe(false)
    if (!grande.ok) expect(grande.motivo).toBe('campo_grande_demais')
    const muitos: Record<string, string> = {}
    for (let i = 0; i <= LIMITE_CAMPOS; i += 1) muitos[`c${i}`] = 'v'
    const demais = validarCorpo({ ...CORPO, campos: muitos })
    expect(demais.ok).toBe(false)
    if (!demais.ok) expect(demais.motivo).toBe('campos_demais')
  })

  it('recusa submissão sem e-mail — e diz que é por isso', () => {
    const r = validarCorpo({ ...CORPO, campos: { nome: 'Ana' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('sem_email')
  })

  it('e recusa quando não há como derivar identidade externa', () => {
    const r = validarCorpo({ formulario: 'x', recebidoEm: '', campos: { email: 'a@b.com' } })
    expect(r.ok).toBe(false)
  })
})

describe('borda · o plano, e a recuperação que ele representa', () => {
  const s = submissaoDe(CORPO)
  const vazio: EstadoAtual = { registros: [], conversaExiste: false }

  it('submissão nova: evidência e conversa, nessa ordem', () => {
    const p = planejarGravacao(s, FONTE, vazio)
    expect(p.resultado).toBe('REGISTRADO')
    expect([...p.passos]).toEqual(['GRAVAR_EVIDENCIA', 'GRAVAR_CONVERSA'])
    expect([...p.passos]).toEqual([...ORDEM_DAS_GRAVACOES])
  })

  it('RECUPERAÇÃO: evidência gravada e conversa não — o reenvio completa', () => {
    const estado: EstadoAtual = { registros: [registroExistente(s)], conversaExiste: false }
    const p = planejarGravacao(s, FONTE, estado)
    expect(p.resultado).toBe('COMPLETADO')
    /* não regrava a evidência: só o que faltou */
    expect([...p.passos]).toEqual(['GRAVAR_CONVERSA'])
    expect(p.porque).toMatch(/completa o que faltou/)
  })

  it('as duas já existem: reenvio sem efeito', () => {
    const estado: EstadoAtual = { registros: [registroExistente(s)], conversaExiste: true }
    const p = planejarGravacao(s, FONTE, estado)
    expect(p.resultado).toBe('IDEMPOTENTE')
    expect([...p.passos]).toEqual(['NADA'])
  })

  it('mesma identidade com conteúdo diferente nasce AO LADO, sem sobrescrever', () => {
    const outra = submissaoDe({ ...CORPO, campos: { ...CORPO.campos, area: '1.200 m²' } })
    const estado: EstadoAtual = { registros: [registroExistente(s)], conversaExiste: true }
    const p = planejarGravacao(outra, FONTE, estado)
    expect(p.resultado).toBe('NOVA_OBSERVACAO')
    expect([...p.passos]).toEqual(['GRAVAR_EVIDENCIA'])
    expect(p.porque).toMatch(/sem sobrescrever/)
  })

  it('a impressão e a identidade do plano são as do Lead Engine', () => {
    const p = planejarGravacao(s, FONTE, vazio)
    const v = validarIntake(pedidoDeIntake(s, FONTE))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(p.payloadFingerprint).toBe(v.payloadFingerprint)
      expect(p.externoId).toBe(v.identidade.externoId)
    }
  })

  it('e a razão da ordem está escrita, não subentendida', () => {
    expect(PORQUE_ESSA_ORDEM).toMatch(/não há transação/)
    expect(PORQUE_ESSA_ORDEM).toMatch(/o reenvio completa/)
  })
})

describe('borda · o que ela nunca faz', () => {
  it('seis proibições, e a do CNPJ está entre elas', () => {
    expect(PROIBICOES_DA_BORDA.length).toBe(6)
    const t = PROIBICOES_DA_BORDA.join(' | ')
    expect(t).toMatch(/não promove/)
    expect(t).toMatch(/não envia nada/)
    expect(t).toMatch(/não exige CNPJ/)
    expect(t).toMatch(/não chama o motor estrutural/)
    expect(t).toMatch(/fail-closed/)
    expect(t).toMatch(/não registra o payload em log/)
  })
})

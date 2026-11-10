/**
 * A reconciliação.
 *
 * O teste que mais importa aqui é o da RETENÇÃO: há submissões reais
 * guardadas no Netlify de antes de a integração existir, e nenhuma
 * reconciliação de rotina pode processá-las por efeito colateral.
 *
 * O segundo é o da CHAVE: o que a reconciliação calcula tem de ser
 * exatamente o que a borda calcularia pelo webhook, senão o reenvio duplica.
 */
import { describe, expect, it } from 'vitest'
import {
  MOTIVOS_RETENCAO, PORQUE_RETER_ANTERIORES, planoDaReconciliacao, relatorioDaReconciliacao,
} from './formularioReconciliacao'
import { corpoDaSubmissaoNetlify } from './formularioTransporte'
import { pedidoDeIntake } from './formularioSite'
import { validarIntake } from './leadEngineIntake'

const MARCO = '2026-11-10T00:00:00.000Z'

const submissao = (id: string, criadoEm: string, extra: Record<string, unknown> = {}) => ({
  id, form_name: 'simular-galpao', created_at: criadoEm,
  data: { nome: 'Ana (FICTÍCIO)', email: 'ana@exemplo.com.br', area: '900', ...extra },
})

const ANTIGA_1 = submissao('nf-outubro-1', '2026-10-13T10:00:00.000Z')
const ANTIGA_2 = submissao('nf-outubro-2', '2026-10-20T10:00:00.000Z')
const NOVA_1 = submissao('nf-nova-1', '2026-11-11T10:00:00.000Z')
const NOVA_2 = submissao('nf-nova-2', '2026-11-12T10:00:00.000Z')

describe('reconciliação · o que fica retido', () => {
  it('tudo o que é anterior ao marco — por padrão, sem exceção', () => {
    const p = planoDaReconciliacao([ANTIGA_1, ANTIGA_2, NOVA_1], { marco: MARCO })
    expect(p.enviar.map((x) => x.id)).toEqual(['nf-nova-1'])
    expect(p.retidas.filter((r) => r.motivo === 'anterior_ao_marco').map((r) => r.id)).toEqual(['nf-outubro-1', 'nf-outubro-2'])
  })

  it('e só sai da retenção com o gesto explícito', () => {
    const p = planoDaReconciliacao([ANTIGA_1, NOVA_1], { marco: MARCO, incluirAnteriores: true })
    expect(p.enviar.map((x) => x.id)).toEqual(['nf-outubro-1', 'nf-nova-1'])
  })

  it('id excluído nunca sai, nem com incluirAnteriores', () => {
    const p = planoDaReconciliacao([ANTIGA_1, NOVA_1], { marco: MARCO, incluirAnteriores: true, excluidos: ['nf-outubro-1'] })
    expect(p.enviar.map((x) => x.id)).toEqual(['nf-nova-1'])
    expect(p.retidas[0]).toMatchObject({ id: 'nf-outubro-1', motivo: 'id_excluido' })
  })

  it('spam, honeypot e formulário de outra coisa ficam de fora com motivo', () => {
    const p = planoDaReconciliacao([
      { ...NOVA_1, state: 'spam' },
      { ...NOVA_2, data: { ...NOVA_2.data, 'empresa-site': 'bot' } },
      { ...submissao('nf-x', '2026-11-11T10:00:00.000Z'), form_name: 'newsletter' },
    ], { marco: MARCO, formulariosAceitos: ['simular-galpao'] })
    expect(p.enviar.length).toBe(0)
    expect(p.retidas.map((r) => r.detalhe)).toEqual(['marcada_como_spam', 'honeypot_preenchido', 'formulario_nao_aceito'])
    for (const r of p.retidas) expect(r.motivo).toBe('nao_traduzida')
  })

  it('a razão da retenção está escrita, não subentendida', () => {
    expect(PORQUE_RETER_ANTERIORES).toMatch(/autorização própria/)
    expect(MOTIVOS_RETENCAO).toContain('anterior_ao_marco')
  })
})

describe('reconciliação · a chave é a mesma do webhook', () => {
  it('identidade e impressão idênticas às que a borda calcularia', () => {
    const p = planoDaReconciliacao([NOVA_1], { marco: MARCO })
    const t = corpoDaSubmissaoNetlify(NOVA_1)
    if (!t.ok) throw new Error('setup')
    const v = validarIntake(pedidoDeIntake(t.corpo, 'FONTE'))
    if (!v.ok) throw new Error('setup')
    expect(p.enviar[0]!.externoId).toBe(v.identidade.externoId)
    expect(p.enviar[0]!.payloadFingerprint).toBe(v.payloadFingerprint)
  })

  it('reconciliar duas vezes dá o mesmo plano', () => {
    const a = planoDaReconciliacao([NOVA_1, NOVA_2], { marco: MARCO })
    const b = planoDaReconciliacao([NOVA_1, NOVA_2], { marco: MARCO })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('reconciliação · ordem e contagem', () => {
  it('reenvia na ordem de chegada: não reordena a fila comercial', () => {
    const p = planoDaReconciliacao([NOVA_2, NOVA_1], { marco: MARCO })
    expect(p.enviar.map((x) => x.id)).toEqual(['nf-nova-1', 'nf-nova-2'])
  })

  it('conta o que leu, mesmo o que reteve', () => {
    const p = planoDaReconciliacao([ANTIGA_1, NOVA_1, 42], { marco: MARCO })
    expect(p.lidas).toBe(3)
    expect(p.enviar.length + p.retidas.length).toBe(3)
  })

  it('marco inválido é erro de uso, não silêncio', () => {
    expect(() => planoDaReconciliacao([], { marco: 'ontem' })).toThrow(/marco inválido/)
  })
})

describe('reconciliação · o relatório', () => {
  it('separa cada desfecho da borda', () => {
    const r = relatorioDaReconciliacao([
      { id: 'a', status: 200, resultado: 'REGISTRADO' },
      { id: 'b', status: 200, resultado: 'COMPLETADO' },
      { id: 'c', status: 200, resultado: 'IDEMPOTENTE' },
      { id: 'd', status: 200, resultado: 'NOVA_OBSERVACAO' },
      { id: 'e', status: 200, resultado: 'IGNORADA' },
    ])
    expect(r).toMatchObject({ enviadas: 5, registradas: 1, completadas: 1, idempotentes: 1, novasObservacoes: 1, ignoradas: 1 })
    expect(r.falhas).toEqual([])
  })

  it('status fora de 2xx e resposta ininteligível são FALHA: ficam para a próxima rodada', () => {
    const r = relatorioDaReconciliacao([
      { id: 'a', status: 502, motivo: 'gravacao_falhou' },
      { id: 'b', status: 0, motivo: 'socket caiu' },
      { id: 'c', status: 200 },
      { id: 'd', status: 200, resultado: 'ALGO_NOVO' },
    ])
    expect(r.falhas.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.registradas).toBe(0)
  })
})

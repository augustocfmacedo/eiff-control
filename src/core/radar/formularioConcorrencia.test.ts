/**
 * Classificação depois de uma falha de gravação na rodada: conflito de unicidade só ABRE a verificação; quem decide é
 * o estado lido do banco, conferido por identidade e impressão. A prova em banco real está em
 * `scripts/pg-smoke-monitor.mts` (provas B8 a B11).
 */
import { describe, expect, it } from 'vitest'
import { descricaoSegura } from '../erroSeguro'
import { classificarAposFalha, ehConflitoNaEvidencia, type EstadoAposFalha } from './formularioConcorrencia'
import { ErroDeGravacao, prazoDoLead } from './formularioGravacao'
import { planoDaReconciliacao } from './formularioReconciliacao'
import type { RegistroFonte } from './types'

const item = planoDaReconciliacao([{
  id: 'nf-conflito-1', form_name: 'simular-galpao', state: 'verified', created_at: '2026-11-20T12:05:00.000Z',
  data: { nome: 'Ana (FICTÍCIO)', email: 'ana@exemplo.invalido', telefone: '62 90000-0000', empresa: 'X (FICTÍCIO)', cidade: 'Goiânia, GO', uso: 'industrial', area: '900', observacao: 'Galpão.' },
}], { marco: '2026-11-10T00:00:00Z', formulariosAceitos: ['simular-galpao'] }).enviar[0]!

/** O erro EXATAMENTE como a rodada o recebe em produção: a porta REST lança, `gravarSubmissao` embrulha. */
const conflito = new ErroDeGravacao('evidencia', descricaoSegura(new Error('postgrest POST radar_source_record http 409')))
const evidencia = (impressao = item.payloadFingerprint, externoId = item.externoId): RegistroFonte => ({
  id: 'RF-1', fonteId: 'FNT', tipo: 'empresa', externoId, payload: {}, recebidoEm: item.criadoEm, payloadFingerprint: impressao, statusIntake: 'PENDING',
})
const prazoCerto = { threadId: 'THR-1', aberta: true, abertaEm: item.criadoEm, venceEm: prazoDoLead(item.submissao) }
const completo: EstadoAposFalha = { registros: [evidencia()], conversaExiste: true, prazo: prazoCerto }

describe('o que é conflito de unicidade', () => {
  it('reconhece o 409 da evidência no formato que chega à rodada', () => {
    expect(conflito.detalhe).toMatch(/^ERRO_HTTP 409/)
    expect(ehConflitoNaEvidencia(conflito)).toBe(true)
  })
  it('não confunde com outra etapa, outro status ou outro tipo de erro', () => {
    expect(ehConflitoNaEvidencia(new ErroDeGravacao('conversa', conflito.detalhe))).toBe(false)
    expect(ehConflitoNaEvidencia(new ErroDeGravacao('evidencia', descricaoSegura(new Error('postgrest POST radar_source_record http 503'))))).toBe(false)
    expect(ehConflitoNaEvidencia(new ErroDeGravacao('evidencia', 'ERRO_HTTP 4090'))).toBe(false)
    expect(ehConflitoNaEvidencia(new Error('postgrest POST radar_source_record http 409'))).toBe(false)
  })
})

describe('as quatro situações', () => {
  it('concluída por outra rodada: mesma impressão, conversa e prazo confirmados', () => {
    expect(classificarAposFalha(item, conflito, completo).desfecho).toBe('CONCLUIDA_POR_OUTRA_RODADA')
  })
  it('parcial: evidência existe e a conversa ainda não', () => {
    expect(classificarAposFalha(item, conflito, { ...completo, conversaExiste: false }).desfecho).toBe('PARCIAL')
  })
  it('parcial: conversa existe com as 24 h corridas, prazo ainda não ajustado', () => {
    const vinte4h = { ...prazoCerto, venceEm: new Date(Date.parse(item.criadoEm) + 24 * 3_600_000).toISOString() }
    expect(classificarAposFalha(item, conflito, { ...completo, prazo: vinte4h }).desfecho).toBe('PARCIAL')
    expect(classificarAposFalha(item, conflito, { registros: completo.registros, conversaExiste: true }).desfecho).toBe('PARCIAL')
  })
  it('inconsistência: conflito sem evidência desta submissão, ou só com outra impressão', () => {
    expect(classificarAposFalha(item, conflito, { ...completo, registros: [] }).desfecho).toBe('INCONSISTENCIA_IDENTIDADE')
    expect(classificarAposFalha(item, conflito, { ...completo, registros: [evidencia('outra-impressao')] }).desfecho).toBe('INCONSISTENCIA_IDENTIDADE')
    expect(classificarAposFalha(item, conflito, { ...completo, registros: [evidencia(undefined, 'outro-id')] }).desfecho).toBe('INCONSISTENCIA_IDENTIDADE')
    expect(classificarAposFalha(item, conflito, { ...completo, registros: [evidencia(), { ...evidencia(), id: 'RF-2' }] }).desfecho).toBe('INCONSISTENCIA_IDENTIDADE')
  })
  it('erro de persistência: qualquer falha que não é conflito na evidência, mesmo com o banco completo', () => {
    const rede = new ErroDeGravacao('evidencia', descricaoSegura(new Error('postgrest POST radar_source_record http 503')))
    expect(classificarAposFalha(item, rede, completo).desfecho).toBe('ERRO_PERSISTENCIA')
    expect(classificarAposFalha(item, new ErroDeGravacao('conversa', 'ERRO_HTTP 503'), completo).desfecho).toBe('ERRO_PERSISTENCIA')
    expect(classificarAposFalha(item, new Error('qualquer'), completo).desfecho).toBe('ERRO_PERSISTENCIA')
  })
  it('o motivo nunca leva dado da submissão', () => {
    for (const e of [completo, { ...completo, conversaExiste: false }, { ...completo, registros: [] }]) {
      expect(classificarAposFalha(item, conflito, e).motivo).not.toMatch(/@|\d{4}|nf-conflito/)
    }
  })
})

/**
 * Duas rodadas da reconciliação sobre a MESMA submissão (o agendador e um «Run now», por exemplo): o banco garante a
 * unicidade (índice `radar_source_record_observacao_uidx` e a idempotência do `inbox_ingest`), mas a rodada que perde
 * a corrida recebe o conflito na gravação da evidência e hoje conta uma FALHA — o monitor então emite um falso
 * `FALHA_GRAVACAO` (E10.17, prova B7).
 *
 * Este módulo decide, DEPOIS da falha, o que de fato aconteceu. Não trata erro de chave única como sucesso por si:
 * o conflito só ABRE a verificação; quem decide é o estado lido do banco, conferido por identidade e impressão.
 *
 *   CONCLUIDA_POR_OUTRA_RODADA  conflito + evidência desta fonte com a MESMA impressão + conversa da MESMA submissão
 *                               + prazo já correto: outra rodada fez tudo
 *   PARCIAL                     conflito + evidência da mesma impressão, mas conversa ou prazo ainda não estão lá
 *                               (a outra rodada pode estar no meio): a próxima rodada completa
 *   INCONSISTENCIA_IDENTIDADE   conflito, mas não há evidência desta submissão com esta impressão — o conflito não
 *                               se explica pela outra rodada; investigar
 *   ERRO_PERSISTENCIA           qualquer outra falha (rede, 5xx, permissão, conversa, prazo): falha real, como hoje
 *
 * Ligado à rodada agendada na E10.19 (`formularioAgendado.ts`, no tratamento de falha): só
 * `CONCLUIDA_POR_OUTRA_RODADA` deixa de contar como falha; `PARCIAL`, `INCONSISTENCIA_IDENTIDADE` e
 * `ERRO_PERSISTENCIA` continuam falha. `gravarSubmissao` (o motor de gravação, também usado pelo webhook) não muda.
 */
import { PROVIDER_FORMULARIO } from '../inbox/formularioSite'
import { decidirPrazo, ErroDeGravacao, prazoDoLead, type EstadoDoPrazo, type PortasGravacao } from './formularioGravacao'
import type { SubmissaoFormulario } from './formularioSite'
import type { RegistroFonte } from './types'

export type DesfechoAposFalha = 'CONCLUIDA_POR_OUTRA_RODADA' | 'PARCIAL' | 'INCONSISTENCIA_IDENTIDADE' | 'ERRO_PERSISTENCIA'

export interface ItemEmConflito {
  externoId: string
  payloadFingerprint: string
  submissao: SubmissaoFormulario
}

/** O que foi lido do banco DEPOIS da falha, já filtrado por organização e fonte (as portas de produção filtram). */
export interface EstadoAposFalha {
  registros: readonly RegistroFonte[]
  conversaExiste: boolean
  prazo?: EstadoDoPrazo
}

export interface ClassificacaoAposFalha {
  desfecho: DesfechoAposFalha
  /** Frase de catálogo, sem dado da submissão. */
  motivo: string
}

/**
 * Conflito de unicidade na evidência, como a porta REST de produção o relata: `ErroDeGravacao` na etapa `evidencia`
 * cujo detalhe é a descrição segura `ERRO_HTTP 409` (o PostgREST traduz o 23505 do PostgreSQL em 409; a porta lança
 * «postgrest POST radar_source_record http 409» e `descricaoSegura` preserva só o código e o status).
 */
export function ehConflitoNaEvidencia(e: unknown): boolean {
  return e instanceof ErroDeGravacao && e.etapa === 'evidencia' && /^ERRO_HTTP 409(?: |$)/.test(e.detalhe)
}

export function classificarAposFalha(item: ItemEmConflito, erro: unknown, estado: EstadoAposFalha): ClassificacaoAposFalha {
  if (!ehConflitoNaEvidencia(erro)) {
    return { desfecho: 'ERRO_PERSISTENCIA', motivo: 'falha que não é conflito de unicidade na evidência' }
  }
  const desta = estado.registros.filter((r) => r.externoId === item.externoId)
  const mesmaImpressao = desta.filter((r) => r.payloadFingerprint === item.payloadFingerprint)
  if (mesmaImpressao.length === 0) {
    return {
      desfecho: 'INCONSISTENCIA_IDENTIDADE',
      motivo: desta.length === 0
        ? 'conflito sem evidência desta submissão na fonte'
        : 'conflito sem evidência com esta impressão (só outras versões)',
    }
  }
  if (mesmaImpressao.length > 1) {
    // O índice único proíbe; se aparecer, o banco não é o que a regra supõe.
    return { desfecho: 'INCONSISTENCIA_IDENTIDADE', motivo: 'mais de uma evidência com a mesma impressão' }
  }
  if (!estado.conversaExiste) return { desfecho: 'PARCIAL', motivo: 'evidência existe; conversa ainda não' }
  if (estado.prazo === undefined) return { desfecho: 'PARCIAL', motivo: 'conversa sem leitura de prazo' }
  const prazo = estado.prazo
  const prazoCerto = ((): boolean => {
    try { return decidirPrazo(prazo, prazoDoLead(item.submissao)).acao === 'manter' } catch { return false }
  })()
  if (!prazoCerto) return { desfecho: 'PARCIAL', motivo: 'evidência e conversa existem; prazo ainda não ajustado' }
  return { desfecho: 'CONCLUIDA_POR_OUTRA_RODADA', motivo: 'evidência da mesma impressão, conversa e prazo confirmados no banco' }
}

/** Lê do banco, pelas portas de produção (filtradas por organização e fonte), o estado desta submissão. */
export async function lerEstadoAposFalha(portas: PortasGravacao, fonteId: string, externoId: string): Promise<EstadoAposFalha> {
  const [registros, conversaExiste, prazo] = await Promise.all([
    portas.registrosDaSubmissao(fonteId, externoId),
    portas.conversaExiste(PROVIDER_FORMULARIO, externoId),
    portas.prazoDaConversa(PROVIDER_FORMULARIO, externoId),
  ])
  return { registros, conversaExiste, ...(prazo === undefined ? {} : { prazo }) }
}

/** Espera antes da única releitura de um `PARCIAL` causado por conflito: a outra rodada pode estar terminando. */
export const ESPERA_RELEITURA_MS = 1_500

/**
 * O caminho completo da rodada depois de uma falha: classifica; se deu `PARCIAL`, espera UMA vez e relê (a rodada
 * vencedora costuma terminar a conversa e o prazo em menos de um segundo). Ler o banco nunca vira sucesso por
 * exceção: falha na leitura é `ERRO_PERSISTENCIA`.
 */
export async function verificarAposFalha(
  item: ItemEmConflito, erro: unknown, portas: PortasGravacao, fonteId: string,
  opcoes: { esperar: (ms: number) => Promise<void>; podeEsperar: () => boolean },
): Promise<ClassificacaoAposFalha & { releu: boolean }> {
  if (!ehConflitoNaEvidencia(erro)) return { ...classificarAposFalha(item, erro, { registros: [], conversaExiste: false }), releu: false }
  try {
    const primeira = classificarAposFalha(item, erro, await lerEstadoAposFalha(portas, fonteId, item.externoId))
    if (primeira.desfecho !== 'PARCIAL' || !opcoes.podeEsperar()) return { ...primeira, releu: false }
    await opcoes.esperar(ESPERA_RELEITURA_MS)
    return { ...classificarAposFalha(item, erro, await lerEstadoAposFalha(portas, fonteId, item.externoId)), releu: true }
  } catch {
    return { desfecho: 'ERRO_PERSISTENCIA', motivo: 'não foi possível ler o estado depois do conflito', releu: false }
  }
}

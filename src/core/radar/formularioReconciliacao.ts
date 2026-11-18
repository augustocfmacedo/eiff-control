/**
 * RECONCILIAÇÃO: trazer de volta a submissão que não chegou.
 *
 * ── POR QUE ISTO NÃO É OPCIONAL ──────────────────────────────────────────
 *
 * O evento `formSubmitted` do Netlify é documentado assim: o valor devolvido
 * pela função «não é usado pela plataforma». Não há confirmação e não há
 * reenvio. Então a sequência «submissão válida → função falha → nada no CRM»
 * é possível, e nada no caminho do webhook a conserta.
 *
 * O que conserta é o fato de a submissão continuar guardada no Netlify. A API
 * oficial de submissões verificadas é a fonte de recuperação, e reenviar por
 * ela é seguro porque o caminho de escrita é O MESMO do webhook: mesma borda,
 * mesma identidade, mesma impressão, mesma idempotência. Reconciliar não é um
 * segundo mecanismo de entrada — é o primeiro, chamado por outra mão.
 *
 * ── O QUE ESTE MÓDULO DECIDE (E NÃO FAZ) ─────────────────────────────────
 *
 * Decide QUAIS submissões podem ser reenviadas, e retém o resto com motivo.
 * Não lê rede, não grava e não conhece token: o script faz isso.
 *
 * A retenção existe por uma razão concreta: há submissões REAIS guardadas no
 * painel do Netlify, de antes da integração existir. Processá-las é decisão
 * comercial com autorização própria — e não pode acontecer por efeito
 * colateral de uma reconciliação de rotina. Por isso o padrão é RETER tudo o
 * que é anterior ao marco e exigir dois gestos para liberar.
 */
import { corpoDaSubmissaoNetlify, type MotivoIgnorado } from './formularioTransporte'
import { pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import { validarIntake } from './leadEngineIntake'

export const MOTIVOS_RETENCAO = [
  /** Submissão de antes do marco de ativação: lead real, decisão própria. */
  'anterior_ao_marco',
  /** Id listado explicitamente para não processar. */
  'id_excluido',
  /** Não traduz em submissão (spam, honeypot, outro formulário). */
  'nao_traduzida',
  /** Traduz, mas o Lead Engine recusaria (sem identidade externa estável). */
  'intake_invalido',
] as const
export type MotivoRetencao = (typeof MOTIVOS_RETENCAO)[number]

export interface ItemReconciliacao {
  /** Id da submissão no Netlify. */
  id: string
  formulario: string
  criadoEm: string
  submissao: SubmissaoFormulario
  /** Identidade e impressão que a borda calcularia — iguais às do webhook. */
  externoId: string
  payloadFingerprint: string
}

export interface ItemRetido {
  id?: string
  criadoEm?: string
  motivo: MotivoRetencao
  detalhe?: MotivoIgnorado | string
}

export interface OpcoesReconciliacao {
  /** Instante a partir do qual a reconciliação pode reenviar. Obrigatório. */
  marco: string
  /** Ids a nunca processar. */
  excluidos?: readonly string[]
  /** Liberar o que é anterior ao marco. Exige autorização comercial própria. */
  incluirAnteriores?: boolean
  formulariosAceitos?: readonly string[]
}

export interface PlanoReconciliacao {
  enviar: readonly ItemReconciliacao[]
  retidas: readonly ItemRetido[]
  /** Quantas submissões a fonte entregou. */
  lidas: number
}

/**
 * Decide o que reenviar. Puro e determinístico: a mesma lista com o mesmo
 * marco produz o mesmo plano, e as impressões são as que a borda calcularia.
 */
export function planoDaReconciliacao(brutas: readonly unknown[], opcoes: OpcoesReconciliacao): PlanoReconciliacao {
  const marco = Date.parse(opcoes.marco)
  if (Number.isNaN(marco)) throw new Error('marco inválido: informe um instante ISO')
  const excluidos = new Set(opcoes.excluidos ?? [])
  const enviar: ItemReconciliacao[] = []
  const retidas: ItemRetido[] = []

  for (const bruta of brutas) {
    const t = corpoDaSubmissaoNetlify(bruta, { ...(opcoes.formulariosAceitos !== undefined ? { formulariosAceitos: opcoes.formulariosAceitos } : {}) })
    if (!t.ok) {
      retidas.push({ motivo: 'nao_traduzida', detalhe: t.motivo })
      continue
    }
    const s: SubmissaoFormulario = t.corpo
    const id = s.id ?? ''
    if (excluidos.has(id)) {
      retidas.push({ id, criadoEm: s.recebidoEm, motivo: 'id_excluido' })
      continue
    }
    if (Date.parse(s.recebidoEm) < marco && opcoes.incluirAnteriores !== true) {
      retidas.push({ id, criadoEm: s.recebidoEm, motivo: 'anterior_ao_marco' })
      continue
    }
    // A fonte não é confiável por ser oficial: se o Lead Engine recusaria, a
    // reconciliação não manda — senão a borda devolveria 400 em série.
    const v = validarIntake(pedidoDeIntake(s, 'FONTE'))
    if (!v.ok) {
      retidas.push({ id, criadoEm: s.recebidoEm, motivo: 'intake_invalido', detalhe: v.motivos.join(', ') })
      continue
    }
    enviar.push({
      id, formulario: s.formulario, criadoEm: s.recebidoEm, submissao: s,
      externoId: v.identidade.externoId, payloadFingerprint: v.payloadFingerprint,
    })
  }
  // Ordem de chegada: reconciliar não reordena a fila comercial.
  enviar.sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : 0))
  return { enviar, retidas, lidas: brutas.length }
}

/** Resultado por submissão reenviada, como a borda respondeu. */
export interface RespostaDaBorda {
  id: string
  status: number
  resultado?: string
  motivo?: string
}

export interface RelatorioReconciliacao {
  enviadas: number
  registradas: number
  completadas: number
  idempotentes: number
  novasObservacoes: number
  ignoradas: number
  falhas: readonly RespostaDaBorda[]
}

const POR_RESULTADO: Record<string, keyof RelatorioReconciliacao> = {
  REGISTRADO: 'registradas', COMPLETADO: 'completadas', IDEMPOTENTE: 'idempotentes',
  NOVA_OBSERVACAO: 'novasObservacoes', IGNORADA: 'ignoradas',
}

/** Soma as respostas. Qualquer status fora de 2xx é FALHA: a submissão fica para a próxima rodada. */
export function relatorioDaReconciliacao(respostas: readonly RespostaDaBorda[]): RelatorioReconciliacao {
  const r: RelatorioReconciliacao = { enviadas: respostas.length, registradas: 0, completadas: 0, idempotentes: 0, novasObservacoes: 0, ignoradas: 0, falhas: [] }
  const falhas: RespostaDaBorda[] = []
  for (const x of respostas) {
    const chave = x.resultado === undefined ? undefined : POR_RESULTADO[x.resultado]
    if (x.status < 200 || x.status >= 300 || chave === undefined) { falhas.push(x); continue }
    ;(r[chave] as number) += 1
  }
  return { ...r, falhas }
}

export const PORQUE_RETER_ANTERIORES =
  'há submissões reais guardadas no painel do Netlify de antes de a integração existir. Processá-las é decisão '
  + 'comercial com autorização própria, nunca efeito colateral de uma reconciliação de rotina.'

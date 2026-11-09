/**
 * A borda autenticada que recebe a submissão do formulário do site.
 *
 * ── O PROBLEMA QUE ESTE ARQUIVO RESOLVE ──────────────────────────────────
 *
 * Uma submissão precisa virar DUAS coisas: evidência no Lead Engine
 * (`radar_source_record`, PENDING) e conversa no Inbox (visível na hora,
 * mesmo sem empresa). São dois subsistemas, com tabelas e regras próprias —
 * e **não há transação que cubra os dois**.
 *
 * Então existe um instante em que a primeira gravação aconteceu e a segunda
 * não. Se o reenvio do Netlify for tratado como submissão nova, esse instante
 * vira registro duplicado; se for ignorado, vira lead perdido. A saída não é
 * tentar uma transação distribuída: é tornar as duas gravações
 * **idempotentes pela mesma chave** e deixar o reenvio COMPLETAR o que
 * faltou.
 *
 *   ordem fixa:  evidência primeiro, conversa depois
 *   chave única: a identidade externa da submissão
 *
 * A evidência vem primeiro de propósito. Se o processo morrer entre as duas,
 * o que sobrou é o registro bruto — e dele se reconstrói a conversa. O
 * contrário não vale: de uma thread não se reconstrói a evidência canônica.
 *
 * ── O QUE A BORDA NÃO FAZ ────────────────────────────────────────────────
 *
 * Não promove, não cria empresa, não cria oportunidade, não envia nada e não
 * chama o motor estrutural. Ela recebe, autentica, registra e torna visível.
 * A decisão continua humana.
 */
import { classificarIntake, discoveryRecords, validarIntake, type PedidoIntake } from './leadEngineIntake'
import { canonicoDaSubmissao, envelopeDaSubmissao, externoIdDaSubmissao, pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import type { RegistroFonte } from './types'

/* ---------------------------------------------------------------
   1 · Autenticação
--------------------------------------------------------------- */

export const CABECALHO_SEGREDO = 'x-eiff-form-secret'

/**
 * Comparação em tempo constante. Com `===` o tempo de resposta vaza o
 * tamanho do prefixo correto, e um segredo compartilhado é exatamente o tipo
 * de coisa que se descobre assim.
 */
export function segredoConfere(recebido: string | undefined, esperado: string | undefined): boolean {
  if (typeof recebido !== 'string' || typeof esperado !== 'string') return false
  if (esperado.length === 0) return false
  if (recebido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < esperado.length; i += 1) dif |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return dif === 0
}

export type MotivoRecusa =
  | 'sem_segredo_configurado'
  | 'segredo_invalido'
  | 'corpo_invalido'
  | 'formulario_desconhecido'
  | 'sem_identidade_externa'
  | 'sem_email'
  | 'campo_grande_demais'
  | 'campos_demais'

export interface Recusa { ok: false; motivo: MotivoRecusa; detalhe?: string }

/** Limites do corpo. Não é hipótese: é borda pública recebendo texto livre. */
export const LIMITE_CAMPOS = 60
export const LIMITE_TAMANHO_CAMPO = 5000

/**
 * Autoriza. Fail-closed: sem segredo configurado no ambiente, a borda recusa
 * — nunca aceita «porque ainda não configuraram».
 */
export function autorizar(
  cabecalhos: Readonly<Record<string, string | undefined>>,
  segredoDoAmbiente: string | undefined,
): { ok: true } | Recusa {
  if (segredoDoAmbiente === undefined || segredoDoAmbiente.trim() === '') {
    return { ok: false, motivo: 'sem_segredo_configurado' }
  }
  const recebido = cabecalhos[CABECALHO_SEGREDO] ?? cabecalhos[CABECALHO_SEGREDO.toUpperCase()]
  if (!segredoConfere(recebido, segredoDoAmbiente)) return { ok: false, motivo: 'segredo_invalido' }
  return { ok: true }
}

/* ---------------------------------------------------------------
   2 · O contrato do corpo
--------------------------------------------------------------- */

export interface CorpoDaSubmissao {
  /** Id da submissão no Netlify. */
  id?: string
  formulario: string
  recebidoEm: string
  campos: Readonly<Record<string, string>>
}

/**
 * Valida o corpo. O que entra é texto de formulário público: o contrato é
 * fechado no que importa (formulário conhecido, identidade derivável,
 * e-mail presente) e limitado no resto.
 */
export function validarCorpo(bruto: unknown): { ok: true; submissao: SubmissaoFormulario } | Recusa {
  const c = bruto as Partial<CorpoDaSubmissao> | undefined
  if (c === undefined || typeof c !== 'object') return { ok: false, motivo: 'corpo_invalido' }
  if (typeof c.formulario !== 'string' || c.formulario.trim() === '') {
    return { ok: false, motivo: 'corpo_invalido', detalhe: 'formulario' }
  }
  if (typeof c.recebidoEm !== 'string' || Number.isNaN(Date.parse(c.recebidoEm))) {
    return { ok: false, motivo: 'corpo_invalido', detalhe: 'recebidoEm' }
  }
  const campos = c.campos
  if (campos === undefined || typeof campos !== 'object') {
    return { ok: false, motivo: 'corpo_invalido', detalhe: 'campos' }
  }
  const chaves = Object.keys(campos)
  if (chaves.length > LIMITE_CAMPOS) return { ok: false, motivo: 'campos_demais' }
  for (const k of chaves) {
    const v = (campos as Record<string, unknown>)[k]
    if (typeof v !== 'string') return { ok: false, motivo: 'corpo_invalido', detalhe: k }
    if (v.length > LIMITE_TAMANHO_CAMPO) return { ok: false, motivo: 'campo_grande_demais', detalhe: k }
  }
  const submissao: SubmissaoFormulario = {
    ...(typeof c.id === 'string' && c.id.trim() !== '' ? { id: c.id.trim() } : {}),
    formulario: c.formulario.trim(),
    recebidoEm: c.recebidoEm,
    campos: campos as Readonly<Record<string, string>>,
  }
  if (externoIdDaSubmissao(submissao) === undefined) {
    return { ok: false, motivo: 'sem_identidade_externa' }
  }
  // Sem e-mail não há identidade de canal, e a submissão não vira conversa.
  // É recusa explícita: melhor o formulário saber do que o lead sumir.
  if (canonicoDaSubmissao(submissao).email === undefined) return { ok: false, motivo: 'sem_email' }
  return { ok: true, submissao }
}

/* ---------------------------------------------------------------
   3 · O plano de gravação
--------------------------------------------------------------- */

export type PassoGravacao = 'GRAVAR_EVIDENCIA' | 'GRAVAR_CONVERSA' | 'NADA'

export const RESULTADOS_BORDA = [
  /** Primeira vez: as duas gravações. */
  'REGISTRADO',
  /** A evidência existia e a conversa não: o reenvio COMPLETOU. */
  'COMPLETADO',
  /** As duas já existiam: reenvio sem efeito. */
  'IDEMPOTENTE',
  /** Mesma identidade, conteúdo diferente: observação nova ao lado. */
  'NOVA_OBSERVACAO',
] as const
export type ResultadoBorda = (typeof RESULTADOS_BORDA)[number]

export interface EstadoAtual {
  /** Registros de origem já existentes para esta fonte. */
  registros: readonly RegistroFonte[]
  /** A conversa desta submissão já existe no Inbox? */
  conversaExiste: boolean
}

export interface PlanoDeGravacao {
  resultado: ResultadoBorda
  passos: readonly PassoGravacao[]
  pedidoIntake: PedidoIntake
  payloadFingerprint: string
  externoId: string
  /** Por que o plano é este. Vai para o log, e explica o reenvio. */
  porque: string
}

/**
 * Decide o que gravar, sem gravar nada. É aqui que a recuperação vive: o
 * estado «evidência sim, conversa não» é tratado como caso normal, porque é
 * o que acontece quando o processo morre no meio — e o reenvio do Netlify é
 * justamente o que o conserta.
 */
export function planejarGravacao(
  s: SubmissaoFormulario,
  fonteId: string,
  estado: EstadoAtual,
): PlanoDeGravacao {
  const pedido = pedidoDeIntake(s, fonteId)
  const valido = validarIntake(pedido)
  if (!valido.ok) throw new Error(`intake inválido: ${valido.motivos.join(', ')}`)
  const classificacao = classificarIntake(valido, discoveryRecords([...estado.registros]))
  const base = {
    pedidoIntake: pedido,
    payloadFingerprint: valido.payloadFingerprint,
    externoId: valido.identidade.externoId,
  }

  if (classificacao.resultado === 'IDEMPOTENT_NOOP') {
    return estado.conversaExiste
      ? { ...base, resultado: 'IDEMPOTENTE', passos: ['NADA'], porque: 'evidência e conversa já existem: reenvio sem efeito' }
      : { ...base, resultado: 'COMPLETADO', passos: ['GRAVAR_CONVERSA'], porque: 'a evidência existia e a conversa não: o reenvio completa o que faltou' }
  }

  if (classificacao.resultado === 'NOVA_OBSERVACAO') {
    // A conversa pode NÃO existir aqui: é o caso de a primeira passagem ter
    // gravado a evidência, morrido antes da conversa, e a submissão voltar
    // com conteúdo diferente (reconciliação). Observação nova ao lado E a
    // conversa que faltou — nunca «já existe» por suposição.
    return estado.conversaExiste
      ? { ...base, resultado: 'NOVA_OBSERVACAO', passos: ['GRAVAR_EVIDENCIA'], porque: 'mesma submissão com conteúdo diferente: nasce ao lado, sem sobrescrever — e a conversa já existe' }
      : { ...base, resultado: 'NOVA_OBSERVACAO', passos: ['GRAVAR_EVIDENCIA', 'GRAVAR_CONVERSA'], porque: 'mesma submissão com conteúdo diferente e sem conversa: nasce ao lado e abre o atendimento que faltou' }
  }

  return { ...base, resultado: 'REGISTRADO', passos: ['GRAVAR_EVIDENCIA', 'GRAVAR_CONVERSA'], porque: 'submissão nova: evidência primeiro, conversa depois' }
}

/**
 * A ordem não é preferência. Evidência antes de conversa porque, morrendo no
 * meio, do registro bruto se reconstrói a conversa — e de uma thread não se
 * reconstrói a evidência canônica.
 */
export const ORDEM_DAS_GRAVACOES: readonly PassoGravacao[] = Object.freeze([
  'GRAVAR_EVIDENCIA', 'GRAVAR_CONVERSA',
])

export const PORQUE_ESSA_ORDEM =
  'não há transação cobrindo Lead Engine e Inbox. Com a evidência gravada primeiro, a falha '
  + 'entre as duas deixa o dado bruto salvo e o reenvio completa; na ordem inversa, a falha '
  + 'deixaria uma conversa sem lastro e a submissão original perdida.'

/* ---------------------------------------------------------------
   4 · O que a borda nunca faz
--------------------------------------------------------------- */

export const PROIBICOES_DA_BORDA: readonly string[] = Object.freeze([
  'não promove: nenhuma empresa, nenhum contato do Radar e nenhuma oportunidade nascem aqui',
  'não envia nada: nem confirmação, nem notificação, nem mensagem ao cliente',
  'não exige CNPJ: a submissão entra sem ele e fica visível no Inbox do mesmo jeito',
  'não chama o motor estrutural',
  'não aceita sem segredo configurado: fail-closed, sempre',
  'não registra o payload em log: o que sai em log é identificador, impressão e resultado',
])

/** O envelope, reexportado para a borda não montar outro. */
export { envelopeDaSubmissao }

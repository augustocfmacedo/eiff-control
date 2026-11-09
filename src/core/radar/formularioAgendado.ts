/**
 * A RECONCILIAÇÃO AGENDADA: a rede de segurança rodando sozinha, de hora em hora.
 *
 * ── POR QUE ELA EXISTE ───────────────────────────────────────────────────
 *
 * O evento de submissão do Netlify não tem reenvio: a documentação diz que o
 * valor devolvido pela função «não é usado pela plataforma». Falha na função
 * do site = submissão guardada no painel e NADA no CRM, sem erro visível para
 * ninguém. Enquanto a recuperação depender de alguém rodar um script, a
 * garantia é uma intenção. Agendada, é um mecanismo.
 *
 * ── O QUE ESTE MÓDULO É, E O QUE A FUNÇÃO NETLIFY É ──────────────────────
 *
 * Aqui mora a decisão inteira, com `fetch`, ambiente e relógio injetados: é
 * isto que o teste exercita. A função `netlify/functions/formulario-reconciliar.mts`
 * é um invólucro que passa o ambiente real e declara o horário.
 *
 * ── AS SEIS EXIGÊNCIAS, E ONDE CADA UMA ESTÁ ─────────────────────────────
 *
 * 1. MARCO EXPLÍCITO. `EIFF_FORM_MARCO`. Sem ele a rodada não começa — não há
 *    marco padrão, porque um padrão errado processaria lead real.
 * 2. LEADS HISTÓRICOS FORA. `planoDaReconciliacao` retém tudo o que é anterior
 *    ao marco, e esta rodada NUNCA passa `incluirAnteriores`. Não há opção.
 * 3. IDEMPOTÊNCIA PELO ID DA SUBMISSÃO. Não é invenção daqui: a gravação usa a
 *    mesma identidade externa e o mesmo plano do webhook, então reenviar
 *    devolve IDEMPOTENTE (ou COMPLETADO, quando faltava a conversa).
 * 4. LOTE DENTRO DO LIMITE. A função agendada do Netlify tem 30 s. A rodada
 *    para quando chega ao teto de submissões (`LOTE`) ou quando o tempo
 *    restante acaba (`RESERVA_MS`), e devolve `restam` em vez de ser morta no
 *    meio.
 * 5. CONTAGENS, FALHAS E ÚLTIMA EXECUÇÃO. Uma linha por rodada,
 *    `RECONCILIACAO_AGENDADA`, com números, motivos e instantes — nunca
 *    conteúdo de lead, nunca segredo.
 * 6. RETOMADA SEGURA. Não há estado a guardar: o que ficou de fora volta na
 *    próxima hora e, por 3, entrar duas vezes não duplica nada. Rodada morta
 *    no meio não deixa nada pela metade — a submissão com evidência e sem
 *    conversa é o caso COMPLETADO, previsto e provado.
 */
import { gravarSubmissao, type PortasGravacao } from './formularioGravacao'
import { planoDaReconciliacao, type ItemReconciliacao, type MotivoRetencao } from './formularioReconciliacao'
import { montarPortasIntegracao, type AmbienteFormulario } from './formularioPorta'
import { FORMULARIOS } from './formularioSite'
import { PROVIDER_FORMULARIO } from '../inbox/formularioSite'
import type { ResultadoBorda } from './formularioServidor'
import type { AmbienteAtivacao } from '../inbox/ativacao'

/** Máximo de submissões por rodada. Cada uma custa ~5 idas ao banco. */
export const LOTE = 20
/** Tempo total da função agendada no Netlify. */
export const LIMITE_MS = 30_000
/** O que se guarda para fechar a rodada e registrar o resumo. */
export const RESERVA_MS = 8_000
/** Páginas de submissões por formulário, no máximo. Trava de segurança, não paginação real. */
export const PAGINAS_MAX = 10

export const API_NETLIFY = 'https://api.netlify.com/api/v1'

/** O interruptor. Qualquer valor diferente deixa a rodada desligada. */
export const LIGADA = 'ativa'

export interface AmbienteAgendado extends AmbienteFormulario, AmbienteAtivacao {
  /** `ativa` liga a rodada. Ausente ou qualquer outro valor = desligada. */
  FORMULARIO_RECONCILIACAO?: string
  /** Instante ISO da ativação. Antes dele nada é reenviado. */
  EIFF_FORM_MARCO?: string
  /** `site_id` do eiff-site no Netlify. */
  EIFF_FORM_NETLIFY_SITE?: string
  /** Token pessoal do Netlify, usado SÓ para ler submissões verificadas. */
  NETLIFY_AUTH_TOKEN?: string
  /** Ids de submissão a nunca processar, separados por vírgula. */
  EIFF_FORM_EXCLUIDOS?: string
}

export interface DepsAgendado {
  fetch: typeof fetch
  agora(): number
  /** Instante ISO para o registro. */
  agoraIso(): string
  log?(t: Record<string, unknown>): void
  /** Portas já montadas (o teste injeta; a produção deixa montar pelo ambiente). */
  portas?: { portas: PortasGravacao; fonteId: string; organizacaoId: string }
}

export type DesfechoRodada = 'desligada' | 'nao_configurada' | 'erro_de_leitura' | 'concluida'

export interface ResumoRodada {
  desfecho: DesfechoRodada
  motivo?: string
  /** Instante em que a rodada terminou: a «última execução». */
  em: string
  marco?: string
  lidas: number
  /** Submissões que o plano liberou para reenvio. */
  elegiveis: number
  /** Elegíveis que JÁ estavam inteiramente dentro (evidência da mesma versão + conversa). */
  jaDentro: number
  processadas: number
  /** Elegíveis que ficaram para a próxima rodada (teto do lote ou tempo). */
  restam: number
  retidas: number
  motivosRetencao: Record<string, number>
  /** Por desfecho da gravação. */
  resultados: Record<string, number>
  /** Quantas entraram de fato (REGISTRADO + COMPLETADO + NOVA_OBSERVACAO). */
  recuperadas: number
  falhas: number
  duracaoMs: number
}

const vazio = (): Record<string, number> => ({})

/**
 * Lê as submissões verificadas dos formulários do catálogo, da mais ANTIGA
 * para a mais nova.
 *
 * A ordem importa para o lote: se a rodada só dá conta de parte, a parte que
 * entra é a que está esperando há mais tempo.
 */
export async function lerSubmissoes(
  env: AmbienteAgendado,
  deps: DepsAgendado,
): Promise<{ ok: true; brutas: unknown[] } | { ok: false; motivo: string }> {
  const token = (env.NETLIFY_AUTH_TOKEN ?? '').trim()
  const site = (env.EIFF_FORM_NETLIFY_SITE ?? '').trim()
  if (token === '') return { ok: false, motivo: 'sem NETLIFY_AUTH_TOKEN' }
  if (site === '') return { ok: false, motivo: 'sem EIFF_FORM_NETLIFY_SITE' }
  const cab = { authorization: `Bearer ${token}`, 'user-agent': 'eiff-control-reconciliador' }

  const rFormularios = await deps.fetch(`${API_NETLIFY}/sites/${encodeURIComponent(site)}/forms`, { headers: cab })
  if (!rFormularios.ok) return { ok: false, motivo: `lista de formulários: http ${rFormularios.status}` }
  const formularios = (await rFormularios.json()) as Record<string, unknown>[]
  const alvos = (Array.isArray(formularios) ? formularios : [])
    .filter((f) => (FORMULARIOS as readonly string[]).includes(String(f['name'] ?? '')))
  if (alvos.length === 0) return { ok: false, motivo: 'nenhum formulário do catálogo neste site' }

  const brutas: unknown[] = []
  for (const f of alvos) {
    for (let pagina = 1; pagina <= PAGINAS_MAX; pagina += 1) {
      const url = `${API_NETLIFY}/forms/${encodeURIComponent(String(f['id']))}/submissions?page=${pagina}&per_page=100`
      const r = await deps.fetch(url, { headers: cab })
      if (!r.ok) return { ok: false, motivo: `submissões: http ${r.status}` }
      const lote = (await r.json()) as unknown[]
      if (!Array.isArray(lote)) return { ok: false, motivo: 'submissões: resposta inesperada' }
      brutas.push(...lote)
      if (lote.length < 100) break
    }
  }
  return { ok: true, brutas }
}

const instante = (i: ItemReconciliacao): number => Date.parse(i.criadoEm)

/** Id externo + impressão: a chave de «esta versão desta submissão já está gravada». */
const chaveDaVersao = (externoId: string, impressao?: string): string => `${externoId}@${impressao ?? ''}`

/** A rodada inteira. Nunca lança: qualquer falha vira desfecho com motivo. */
export async function rodadaDeReconciliacao(env: AmbienteAgendado, deps: DepsAgendado): Promise<ResumoRodada> {
  const inicio = deps.agora()
  const fechar = (r: Omit<ResumoRodada, 'em' | 'duracaoMs'>): ResumoRodada => {
    const resumo: ResumoRodada = { ...r, em: deps.agoraIso(), duracaoMs: deps.agora() - inicio }
    // Só números, motivos e instantes. Nunca id de lead, nunca e-mail, nunca segredo.
    deps.log?.({ evento: 'RECONCILIACAO_AGENDADA', ...resumo })
    return resumo
  }
  const nada = {
    lidas: 0, elegiveis: 0, jaDentro: 0, processadas: 0, restam: 0, retidas: 0,
    motivosRetencao: vazio(), resultados: vazio(), recuperadas: 0, falhas: 0,
  }

  // 1 · o interruptor, antes de qualquer leitura
  if ((env.FORMULARIO_RECONCILIACAO ?? '').trim().toLowerCase() !== LIGADA) {
    return fechar({ desfecho: 'desligada', motivo: `FORMULARIO_RECONCILIACAO != ${LIGADA}`, ...nada })
  }

  // 2 · o marco. Sem marco não há rodada: um padrão errado processaria lead real.
  const marco = (env.EIFF_FORM_MARCO ?? '').trim()
  if (marco === '' || Number.isNaN(Date.parse(marco))) {
    return fechar({ desfecho: 'nao_configurada', motivo: 'sem EIFF_FORM_MARCO (instante ISO)', ...nada })
  }

  // 3 · a ligação com o banco: a MESMA montagem do webhook
  const ligacao = deps.portas !== undefined
    ? { ok: true as const, cfg: { fonteId: deps.portas.fonteId, organizacaoId: deps.portas.organizacaoId }, portas: deps.portas.portas }
    : montarPortasIntegracao(env, { fetch: deps.fetch, log: deps.log })
  if (!ligacao.ok) return fechar({ desfecho: 'nao_configurada', motivo: ligacao.motivo, marco, ...nada })

  // 4 · as submissões verificadas
  let brutas: unknown[]
  try {
    const lidas = await lerSubmissoes(env, deps)
    if (!lidas.ok) return fechar({ desfecho: 'erro_de_leitura', motivo: lidas.motivo, marco, ...nada })
    brutas = lidas.brutas
  } catch (e) {
    return fechar({ desfecho: 'erro_de_leitura', motivo: (e as Error).message ?? 'erro', marco, ...nada })
  }

  // 5 · o plano. `incluirAnteriores` NUNCA é passado: os leads históricos ficam fora, sem opção.
  const excluidos = (env.EIFF_FORM_EXCLUIDOS ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '')
  const plano = planoDaReconciliacao(brutas, { marco, excluidos, formulariosAceitos: FORMULARIOS })
  const motivosRetencao: Record<string, number> = vazio()
  for (const r of plano.retidas) {
    const m: MotivoRetencao = r.motivo
    motivosRetencao[m] = (motivosRetencao[m] ?? 0) + 1
  }

  // 6 · a fila: mais antigas primeiro, e SEM o que já está inteiramente dentro.
  //
  //     Esta subtração não é economia: é o que faz a fila ANDAR. Com o teto do
  //     lote e a ordem por antiguidade, uma rodada que reprocessasse o que já
  //     entrou gastaria as 20 vagas sempre nas mesmas submissões mais antigas,
  //     e as que faltam nunca chegariam — por mais rodadas que houvesse.
  //
  //     Os dois critérios são os do plano, e ficam aqui, não na porta: evidência
  //     com a MESMA impressão (versão nova da submissão não está «dentro») e
  //     conversa existente.
  const ordenada = [...plano.enviar].sort((a, b) => instante(a) - instante(b))
  let fila = ordenada
  let jaDentro = 0
  if (ligacao.portas.estadoEmLote !== undefined && ordenada.length > 0) {
    try {
      const estado = await ligacao.portas.estadoEmLote(
        ligacao.cfg.fonteId, PROVIDER_FORMULARIO, ordenada.map((i) => i.externoId),
      )
      const comEvidencia = new Set(estado.evidencias.map((e) => chaveDaVersao(e.externoId, e.impressao)))
      const comConversa = new Set(estado.conversas)
      fila = ordenada.filter((i) => !(comEvidencia.has(chaveDaVersao(i.externoId, i.payloadFingerprint)) && comConversa.has(i.externoId)))
      jaDentro = ordenada.length - fila.length
    } catch (e) {
      // Sem o estado em lote a rodada continua: cada submissão ainda é idempotente
      // uma a uma. O que se perde é a fila andar quando há mais que o teto.
      deps.log?.({ evento: 'RECONCILIACAO_ESTADO', outcome: 'indisponivel', motivo: (e as Error).message ?? 'erro' })
    }
  }
  const resultados: Record<string, number> = vazio()
  let processadas = 0
  let falhas = 0
  let recuperadas = 0
  const entraram: readonly ResultadoBorda[] = ['REGISTRADO', 'COMPLETADO', 'NOVA_OBSERVACAO']

  for (const item of fila) {
    if (processadas >= LOTE) break
    if (deps.agora() - inicio > LIMITE_MS - RESERVA_MS) break
    try {
      const r = await gravarSubmissao(item.submissao, ligacao.cfg.fonteId, ligacao.cfg.organizacaoId, ligacao.portas)
      resultados[r.resultado] = (resultados[r.resultado] ?? 0) + 1
      if (entraram.includes(r.resultado)) recuperadas += 1
    } catch (e) {
      falhas += 1
      // Motivo sem conteúdo: a mensagem de erro da gravação carrega etapa e status, não dado de lead.
      deps.log?.({ evento: 'RECONCILIACAO_FALHA', motivo: (e as Error).message ?? 'erro' })
    }
    processadas += 1
  }

  return fechar({
    desfecho: 'concluida',
    marco,
    lidas: plano.lidas,
    elegiveis: plano.enviar.length,
    jaDentro,
    processadas,
    restam: fila.length - processadas,
    retidas: plano.retidas.length,
    motivosRetencao,
    resultados,
    recuperadas,
    falhas,
  })
}

/**
 * O corpo da resposta da função agendada. Existe para o `Run now` do painel e
 * para `netlify functions:invoke` mostrarem o resumo — e só contagens.
 */
export const corpoDaResposta = (r: ResumoRodada): Record<string, unknown> => ({ ...r })

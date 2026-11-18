/**
 * Monitor da reconciliação do formulário do site (GO-3, etapa de alertas).
 *
 * A rodada agendada (`formularioAgendado.ts`) devolve um resumo e responde HTTP 200 mesmo quando uma gravação
 * falhou. Ninguém é avisado. Este módulo lê a SEQUÊNCIA de resumos e decide o que merece alerta:
 *
 *   - FALHA_LEITURA        a rodada não conseguiu ler o Netlify (na 1ª vez se for credencial; senão na 2ª seguida)
 *   - CONFIGURACAO         a rodada ligada não tem o que precisa para rodar (marco, banco, site)
 *   - FALHA_GRAVACAO       rodada CONCLUÍDA com `falhas > 0` — o caso em que a função responde 200
 *   - FALHAS_CONSECUTIVAS  três ou mais rodadas seguidas sem concluir limpas
 *   - RECUPERACAO          a rodada gravou algo que o evento do site não entregou (a função do site falhou)
 *   - RODADA_AUSENTE       nenhuma rodada no intervalo esperado (só um observador SEPARADO consegue ver)
 *   - DESLIGADA            informativo: a reconciliação foi desligada de propósito (avisa uma vez; ausência não conta)
 *
 * Tudo aqui é puro e determinístico: recebe a lista de rodadas, o instante e a configuração, e devolve alertas.
 * Gravar, ler e avisar são portas (`formularioMonitorPorta.ts`, `formularioObservador.ts`).
 *
 * Nenhum dado pessoal entra num alerta: o conteúdo é montado só com tipos e códigos de CATÁLOGO FECHADO, números e
 * instantes. O motivo bruto da rodada nunca é copiado; é traduzido para um código (`codigoDoMotivo`), e o que não
 * casa com o catálogo vira `OUTRO`. `problemasDeDadoPessoal` confere o alerta pronto como segunda barreira.
 */
import type { DesfechoRodada, ResumoRodada } from './formularioAgendado'

export const TIPOS_ALERTA = [
  'FALHA_LEITURA', 'CONFIGURACAO', 'FALHA_GRAVACAO', 'FALHAS_CONSECUTIVAS', 'RECUPERACAO', 'RODADA_AUSENTE', 'DESLIGADA',
] as const
export type TipoAlerta = (typeof TIPOS_ALERTA)[number]

/** `info` só para o estado intencional (reconciliação desligada): avisa uma vez, não é falha. */
export type Severidade = 'critico' | 'aviso' | 'info'

/**
 * Códigos que um alerta pode carregar. Catálogo fechado: nada de texto livre vindo de fora.
 * O motivo da rodada é texto montado pelo próprio código (`formularioAgendado.ts`), mas pode citar status, etapa e
 * um detalhe de erro; aqui ele vira só um destes códigos.
 */
export const CODIGOS = [
  'CREDENCIAL_AUSENTE', 'CREDENCIAL_INVALIDA', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
  'RESPOSTA_INESPERADA', 'SEM_FORMULARIO', 'SEM_SITE', 'SEM_MARCO', 'SEM_BANCO', 'FALHA_LEITURA', 'OUTRO',
] as const
export type CodigoAlerta = (typeof CODIGOS)[number]

export const DESFECHOS_VALIDOS: readonly DesfechoRodada[] = Object.freeze(['desligada', 'nao_configurada', 'erro_de_leitura', 'concluida'])

/** O que fica guardado de cada rodada. Só números, desfecho, código e instante: nunca o resumo bruto. */
export interface RodadaRegistrada {
  em: string
  desfecho: DesfechoRodada
  codigo?: CodigoAlerta
  lidas: number
  elegiveis: number
  jaDentro: number
  processadas: number
  restam: number
  retidas: number
  recuperadas: number
  falhas: number
}

export interface Alerta {
  tipo: TipoAlerta
  severidade: Severidade
  /**
   * Identidade do alerta para a deduplicação: o mesmo problema contínuo produz a MESMA chave em toda avaliação.
   * Formada só por tipo, código, severidade e o instante em que o problema começou.
   */
  chave: string
  /** Instante da avaliação. */
  em: string
  /** Desde quando o problema existe (primeira rodada da sequência, ou a última rodada vista). */
  desde: string
  codigo?: CodigoAlerta
  contagens: Record<string, number>
  /** Frase de catálogo, sem nenhum dado vindo da submissão. */
  resumo: string
}

export interface ConfigMonitor {
  /** Intervalo esperado entre rodadas, em minutos (60 hoje; 10 se a frequência mudar). */
  intervaloMin: number
  /** Quantas janelas sem rodada até alertar «rodada ausente». */
  janelasAusencia: number
  /** Folga somada à janela, para o atraso normal do agendador. */
  toleranciaMin: number
  /** Rodadas seguidas com problema até FALHAS_CONSECUTIVAS. */
  limiteConsecutivas: number
  /** Leituras com erro seguidas até FALHA_LEITURA (credencial alerta na primeira). */
  limiteLeitura: number
  /** O mesmo alerta (mesma chave) só é reemitido depois deste tempo. */
  reemitirAposMin: number
}

/** Intervalo da rodada agendada, em minutos: o `schedule` de `formulario-reconciliar.mts`. Um teste prende os dois. */
export const INTERVALO_PADRAO_MIN = 10

export const CONFIG_PADRAO: ConfigMonitor = Object.freeze({
  intervaloMin: INTERVALO_PADRAO_MIN,
  janelasAusencia: 2,
  toleranciaMin: 5,
  limiteConsecutivas: 3,
  limiteLeitura: 2,
  reemitirAposMin: 360,
})

/** Configuração a partir do intervalo da rodada. Com 10 min: ausência depois de 25 min; com 60: depois de 2 h 5 min. */
export const configParaIntervalo = (intervaloMin: number): ConfigMonitor => {
  if (!Number.isFinite(intervaloMin) || intervaloMin < 1) throw new Error('intervalo da rodada inválido')
  return { ...CONFIG_PADRAO, intervaloMin }
}

/** Motivo da rodada → código de catálogo. O texto nunca é copiado. */
export function codigoDoMotivo(desfecho: DesfechoRodada, motivo: string | undefined): CodigoAlerta | undefined {
  if (desfecho === 'concluida' || desfecho === 'desligada') return undefined
  const m = (motivo ?? '').toUpperCase()
  if (m.includes('CREDENCIAL_AUSENTE')) return 'CREDENCIAL_AUSENTE'
  if (m.includes('CREDENCIAL_INVALIDA')) return 'CREDENCIAL_INVALIDA'
  const http = /HTTP (\d{3})/.exec(m)
  if (http !== null) {
    const s = Number(http[1])
    if (s === 401) return 'HTTP_401'
    if (s === 403) return 'HTTP_403'
    if (s === 404) return 'HTTP_404'
    if (s === 429) return 'HTTP_429'
    if (s >= 500) return 'HTTP_5XX'
    return 'OUTRO'
  }
  if (m.includes('RESPOSTA INESPERADA')) return 'RESPOSTA_INESPERADA'
  if (m.includes('NENHUM FORMULÁRIO') || m.includes('NENHUM FORMULARIO')) return 'SEM_FORMULARIO'
  if (m.includes('EIFF_FORM_NETLIFY_SITE')) return 'SEM_SITE'
  if (m.includes('EIFF_FORM_MARCO')) return 'SEM_MARCO'
  if (m.includes('SUPABASE') || m.includes('EIFF_INBOX_ORGANIZATION_ID') || m.includes('EIFF_FORM_SOURCE_ID')) return 'SEM_BANCO'
  if (desfecho === 'erro_de_leitura') return 'FALHA_LEITURA'
  return 'OUTRO'
}

const CODIGOS_DE_CREDENCIAL: readonly CodigoAlerta[] = ['CREDENCIAL_AUSENTE', 'CREDENCIAL_INVALIDA', 'HTTP_401', 'HTTP_403']

const inteiro = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** Resumo da rodada → registro guardável. Lista de campos FECHADA: o que não está aqui não é guardado. */
export function registroDaRodada(r: ResumoRodada): RodadaRegistrada {
  const codigo = codigoDoMotivo(r.desfecho, r.motivo)
  return {
    em: r.em,
    desfecho: r.desfecho,
    ...(codigo === undefined ? {} : { codigo }),
    lidas: inteiro(r.lidas),
    elegiveis: inteiro(r.elegiveis),
    jaDentro: inteiro(r.jaDentro),
    processadas: inteiro(r.processadas),
    restam: inteiro(r.restam),
    retidas: inteiro(r.retidas),
    recuperadas: inteiro(r.recuperadas),
    falhas: inteiro(r.falhas),
  }
}

/** Rodada que não terminou limpa: não concluiu, ou concluiu com falha de gravação. */
const comProblema = (r: RodadaRegistrada): boolean =>
  r.desfecho === 'erro_de_leitura' || r.desfecho === 'nao_configurada' || (r.desfecho === 'concluida' && r.falhas > 0)

/** A sequência final de rodadas que satisfazem `teste`, da mais antiga para a mais nova. */
function sequenciaFinal(rodadas: readonly RodadaRegistrada[], teste: (r: RodadaRegistrada) => boolean): RodadaRegistrada[] {
  const fim: RodadaRegistrada[] = []
  for (let i = rodadas.length - 1; i >= 0; i -= 1) {
    const r = rodadas[i]!
    if (!teste(r)) break
    fim.unshift(r)
  }
  return fim
}

const RESUMOS: Record<TipoAlerta, string> = {
  FALHA_LEITURA: 'A reconciliação não conseguiu ler as submissões do Netlify.',
  CONFIGURACAO: 'A reconciliação está ligada, mas falta configuração para rodar.',
  FALHA_GRAVACAO: 'Rodada concluída com falha de gravação: há submissão que não entrou no CRM.',
  FALHAS_CONSECUTIVAS: 'Várias rodadas seguidas sem concluir sem falha.',
  RECUPERACAO: 'A reconciliação gravou submissão que o evento do site não entregou: a função do site falhou.',
  RODADA_AUSENTE: 'Nenhuma rodada da reconciliação no intervalo esperado.',
  DESLIGADA: 'A reconciliação está desligada de propósito: submissões perdidas pelo evento do site não são recuperadas.',
}

const alerta = (
  tipo: TipoAlerta, severidade: Severidade, em: string, desde: string,
  contagens: Record<string, number>, codigo?: CodigoAlerta,
): Alerta => ({
  tipo, severidade, em, desde, contagens, resumo: RESUMOS[tipo],
  chave: [tipo, codigo ?? '-', severidade, desde].join('|'),
  ...(codigo === undefined ? {} : { codigo }),
})

/**
 * Avalia a sequência de rodadas (qualquer ordem; é ordenada por instante) no instante `agora`.
 *
 * Reconciliação DESLIGADA de propósito não é falha: se a rodada mais recente é `desligada`, o único alerta é o
 * informativo DESLIGADA (uma vez por período desligado); nem ausência nem falha. A ausência só conta enquanto a
 * última rodada vista estava ligada.
 */
export function avaliarRodadas(entrada: readonly RodadaRegistrada[], agora: string, cfg: ConfigMonitor = CONFIG_PADRAO): Alerta[] {
  const agoraMs = Date.parse(agora)
  if (Number.isNaN(agoraMs)) throw new Error('instante da avaliação inválido')
  const rodadas = [...entrada].filter((r) => !Number.isNaN(Date.parse(r.em))).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  const ultima = rodadas[rodadas.length - 1]
  const alertas: Alerta[] = []
  if (ultima === undefined) return alertas
  if (ultima.desfecho === 'desligada') {
    // Estado intencional: um aviso informativo (chave = início do período desligado), nunca ausência nem falha.
    alertas.push(alerta('DESLIGADA', 'info', agora, sequenciaFinal(rodadas, (r) => r.desfecho === 'desligada')[0]!.em, {}))
    return alertas
  }

  // Ausência: tempo desde a última rodada maior que N janelas + folga.
  const limiteMs = (cfg.intervaloMin * cfg.janelasAusencia + cfg.toleranciaMin) * 60_000
  const semRodadaMs = agoraMs - Date.parse(ultima.em)
  if (semRodadaMs > limiteMs) {
    alertas.push(alerta('RODADA_AUSENTE', 'critico', agora, ultima.em, { minutosSemRodada: Math.floor(semRodadaMs / 60_000), intervaloMin: cfg.intervaloMin }))
  }

  if (ultima.desfecho === 'nao_configurada') {
    alertas.push(alerta('CONFIGURACAO', 'critico', agora, sequenciaFinal(rodadas, (r) => r.desfecho === 'nao_configurada')[0]!.em, {}, ultima.codigo ?? 'OUTRO'))
  }

  if (ultima.desfecho === 'erro_de_leitura') {
    const seq = sequenciaFinal(rodadas, (r) => r.desfecho === 'erro_de_leitura')
    const codigo = ultima.codigo ?? 'FALHA_LEITURA'
    if (CODIGOS_DE_CREDENCIAL.includes(codigo) || seq.length >= cfg.limiteLeitura) {
      alertas.push(alerta('FALHA_LEITURA', 'critico', agora, seq[0]!.em, { seguidas: seq.length }, codigo))
    }
  }

  if (ultima.desfecho === 'concluida' && ultima.falhas > 0) {
    const seq = sequenciaFinal(rodadas, (r) => r.desfecho === 'concluida' && r.falhas > 0)
    // Uma rodada com falha é aviso (a próxima tenta de novo). Duas seguidas: a submissão não está entrando.
    const sev: Severidade = seq.length >= 2 ? 'critico' : 'aviso'
    alertas.push(alerta('FALHA_GRAVACAO', sev, agora, seq[0]!.em, { falhas: ultima.falhas, processadas: ultima.processadas, seguidas: seq.length }))
  }

  const problemas = sequenciaFinal(rodadas, comProblema)
  if (problemas.length >= cfg.limiteConsecutivas) {
    alertas.push(alerta('FALHAS_CONSECUTIVAS', 'critico', agora, problemas[0]!.em, { seguidas: problemas.length }, ultima.codigo))
  }

  // Recuperação: cada rodada que recuperou é um fato próprio (a chave usa o instante DELA). Olha todas as rodadas da
  // janela de reemissão, não só a última: duas rodadas que terminam juntas (agendador + «Run now») não escondem a
  // recuperação da primeira. A deduplicação garante uma entrega por rodada; fora da janela, nada é reavaliado.
  for (const r of rodadas) {
    if (r.desfecho !== 'concluida' || r.recuperadas <= 0) continue
    if (agoraMs - Date.parse(r.em) > cfg.reemitirAposMin * 60_000) continue
    alertas.push(alerta('RECUPERACAO', 'aviso', agora, r.em, { recuperadas: r.recuperadas, processadas: r.processadas }))
  }
  return alertas
}

/** Um alerta já emitido: o que a deduplicação precisa saber. */
export interface AlertaEmitido {
  chave: string
  em: string
}

/**
 * Remove o que já foi avisado. Mesma chave dentro de `reemitirAposMin` = suprimido. Um problema que continua
 * gera a mesma chave em cada avaliação (a chave usa o INÍCIO da sequência), então avisa uma vez e lembra depois
 * do prazo de reemissão; um problema que mudou de severidade ou de código gera chave nova e avisa de novo.
 */
export function deduplicar(
  alertas: readonly Alerta[], emitidos: readonly AlertaEmitido[], agora: string, cfg: ConfigMonitor = CONFIG_PADRAO,
): { novos: Alerta[]; suprimidos: Alerta[] } {
  const agoraMs = Date.parse(agora)
  const ultimoPorChave = new Map<string, number>()
  for (const e of emitidos) {
    const t = Date.parse(e.em)
    if (Number.isNaN(t)) continue
    if (t > (ultimoPorChave.get(e.chave) ?? -Infinity)) ultimoPorChave.set(e.chave, t)
  }
  const novos: Alerta[] = []
  const suprimidos: Alerta[] = []
  const nesta = new Set<string>()
  for (const a of alertas) {
    const ultimo = ultimoPorChave.get(a.chave)
    const recente = ultimo !== undefined && agoraMs - ultimo < cfg.reemitirAposMin * 60_000
    if (recente || nesta.has(a.chave)) suprimidos.push(a)
    else { novos.push(a); nesta.add(a.chave) }
  }
  return { novos, suprimidos }
}

/**
 * Segunda barreira contra dado pessoal ou segredo: confere o alerta pronto (ou qualquer objeto destinado a log)
 * e devolve os problemas encontrados. Vazio = pode sair.
 */
export function problemasDeDadoPessoal(obj: unknown): string[] {
  const texto = JSON.stringify(obj) ?? ''
  const p: string[] = []
  if (/@/.test(texto)) p.push('arroba (e-mail)')
  if (/\d[\d .()-]{7,}\d/.test(texto.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ''))) p.push('sequência longa de dígitos (telefone ou documento)')
  if (/\b[0-9a-f]{24}\b/i.test(texto)) p.push('id de submissão do Netlify')
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(texto)) p.push('uuid de registro')
  if (/bearer|authorization|apikey|token|senha|password|secret/i.test(texto)) p.push('palavra de credencial')
  return p
}

// ── frequência ────────────────────────────────────────────────────────────────

export interface EntradaFrequencia {
  intervaloMin: number
  /** Submissões que a leitura percorre a cada rodada (todas as dos formulários do catálogo). */
  submissoesLidas: number
  /** Elegíveis (posteriores ao marco e não excluídas): entram na consulta de «já dentro». */
  elegiveis: number
  formularios: number
  /** Teto do lote por rodada. */
  lote: number
}

export interface OrcamentoFrequencia {
  rodadasPorDia: number
  invocacoesPorMes: number
  chamadasNetlifyPorRodada: number
  chamadasNetlifyPorDia: number
  /** Consultas ao banco por rodada na verificação de «já dentro» (três por bloco de 50). */
  consultasBancoPorRodada: number
  /** Quantas submissões novas a reconciliação consegue gravar por hora, no máximo. */
  vazaoMaximaPorHora: number
  /** Pior atraso de recuperação para uma submissão perdida pelo evento, em minutos (uma janela inteira). */
  atrasoMaximoMin: number
}

/** Quanto custa uma frequência. Puro: a decisão (D2) fica com a Direção. */
export function orcamentoDaFrequencia(e: EntradaFrequencia): OrcamentoFrequencia {
  if (e.intervaloMin < 1) throw new Error('intervalo inválido')
  const rodadasPorDia = Math.floor((24 * 60) / e.intervaloMin)
  const paginasPorFormulario = Math.max(1, Math.ceil(e.submissoesLidas / Math.max(1, e.formularios) / 100))
  const chamadasNetlifyPorRodada = 1 + e.formularios * paginasPorFormulario
  return {
    rodadasPorDia,
    invocacoesPorMes: rodadasPorDia * 30,
    chamadasNetlifyPorRodada,
    chamadasNetlifyPorDia: chamadasNetlifyPorRodada * rodadasPorDia,
    consultasBancoPorRodada: e.elegiveis === 0 ? 0 : Math.ceil(e.elegiveis / 50) * 3,
    vazaoMaximaPorHora: Math.floor(60 / e.intervaloMin) * e.lote,
    atrasoMaximoMin: e.intervaloMin,
  }
}

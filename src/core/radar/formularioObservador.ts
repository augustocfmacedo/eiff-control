/**
 * O observador da reconciliação: roda SEPARADO da rodada (outra função agendada), lê o histórico de rodadas
 * gravado na auditoria, avalia (`avaliarRodadas`), descarta o que já foi entregue (`deduplicar`), e entrega o
 * resto pelo canal (`formularioAlertaCanais.ts`).
 *
 * Por que separado: «rodada não executada» não pode ser detectada pela própria rodada.
 *
 * Entrega, passo a passo, para cada alerta novo:
 *   1. grava a REIVINDICAÇÃO (o banco dá um id crescente);
 *   2. relê as reivindicações da mesma chave na janela `JANELA_REIVINDICACAO_MIN`;
 *   3. só segue quem tem o MENOR id — dois observadores ao mesmo tempo nunca avisam os dois;
 *   4. avisa pelo canal; com sucesso, grava a ENTREGA. Sem entrega gravada, a passada seguinte (depois da janela)
 *      tenta de novo: execução interrompida ou canal fora do ar não perdem o alerta.
 *
 * DESLIGADO POR PADRÃO: só age com `FORMULARIO_MONITOR = ativo`.
 */
import { descricaoSegura } from '../erroSeguro'
import type { ResumoRodada } from './formularioAgendado'
import { canalSomenteRegistro, type CanalDeAlerta } from './formularioAlertaCanais'
import {
  INTERVALO_PADRAO_MIN, avaliarRodadas, configParaIntervalo, deduplicar, problemasDeDadoPessoal, registroDaRodada,
} from './formularioMonitor'
import { menorId, portaMonitorRest, type PortaMonitor } from './formularioMonitorPorta'
import { SUPABASE_URL_PADRAO } from './formularioPorta'

export { canalSomenteRegistro }
export type { CanalDeAlerta }

export const LIGADO = 'ativo'
/** Reivindicação mais velha que isto não segura mais o alerta: o observador que a fez morreu antes de entregar. */
export const JANELA_REIVINDICACAO_MIN = 5
/** Enquanto desligada, a rodada é registrada no máximo uma vez a cada 24 h (só para o monitor saber o estado). */
export const REGISTRO_DESLIGADA_MIN = 24 * 60

export interface AmbienteMonitor {
  /** `ativo` liga o monitor (registro das rodadas e observador). Ausente ou outro valor = desligado. */
  FORMULARIO_MONITOR?: string
  /** Intervalo esperado entre rodadas, em minutos. Padrão: `INTERVALO_PADRAO_MIN` (o `schedule` da rodada). */
  FORMULARIO_INTERVALO_MIN?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  EIFF_INBOX_ORGANIZATION_ID?: string
}

const ligado = (env: AmbienteMonitor): boolean => (env.FORMULARIO_MONITOR ?? '').trim().toLowerCase() === LIGADO

/** Intervalo configurado; inválido cai no padrão, nunca em zero. */
export function intervaloDe(env: AmbienteMonitor): number {
  const n = Number((env.FORMULARIO_INTERVALO_MIN ?? '').trim())
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : INTERVALO_PADRAO_MIN
}

/** A porta pelo ambiente. Sem chave ou organização, devolve o motivo (nome da variável, nunca o valor). */
export function portaDoAmbiente(env: AmbienteMonitor, fetchFn: typeof fetch): PortaMonitor | { motivo: string } {
  const chave = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const organizacaoId = (env.EIFF_INBOX_ORGANIZATION_ID ?? '').trim()
  if (chave === '') return { motivo: 'sem SUPABASE_SERVICE_ROLE_KEY' }
  if (organizacaoId === '') return { motivo: 'sem EIFF_INBOX_ORGANIZATION_ID' }
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO).replace(/\/$/, '')
  return portaMonitorRest({ url, chave, organizacaoId }, fetchFn)
}

export type DesfechoRegistro = 'gravada' | 'monitor_desligado' | 'desligada_ja_registrada' | 'sem_configuracao' | 'falhou'

/**
 * Chamado pela função da rodada DEPOIS de terminar. Nunca lança e nunca muda a resposta da rodada: se a gravação
 * falhar, a rodada continua valendo e o observador verá a ausência (falha segura: alerta a mais, nunca a menos).
 * Rodada `desligada` é gravada só na transição e depois uma vez por dia.
 */
export async function registrarRodada(
  env: AmbienteMonitor, resumo: ResumoRodada,
  deps: { fetch: typeof fetch; porta?: PortaMonitor; log?: (t: Record<string, unknown>) => void },
): Promise<DesfechoRegistro> {
  if (!ligado(env)) return 'monitor_desligado'
  const porta = deps.porta ?? portaDoAmbiente(env, deps.fetch)
  if ('motivo' in porta) { deps.log?.({ evento: 'RECONCILIACAO_MONITOR', outcome: 'sem_configuracao', motivo: porta.motivo }); return 'sem_configuracao' }
  try {
    if (resumo.desfecho === 'desligada') {
      const ultima = await porta.ultimaRodada()
      if (ultima?.desfecho === 'desligada' && Date.parse(resumo.em) - Date.parse(ultima.em) < REGISTRO_DESLIGADA_MIN * 60_000) {
        return 'desligada_ja_registrada'
      }
    }
    await porta.gravarRodada(registroDaRodada(resumo))
    return 'gravada'
  } catch (e) {
    deps.log?.({ evento: 'RECONCILIACAO_MONITOR', outcome: 'falhou', etapa: 'gravar_rodada', motivo: descricaoSegura(e) })
    return 'falhou'
  }
}

export interface ResumoObservacao {
  desfecho: 'desligado' | 'sem_configuracao' | 'erro' | 'concluida'
  motivo?: string
  em: string
  intervaloMin: number
  rodadasLidas: number
  avaliados: number
  /** Entregues pelo canal nesta passada. */
  novos: number
  /** Já entregues antes (dentro do prazo de reemissão). */
  suprimidos: number
  /** Outro observador reivindicou primeiro. */
  cedidos: number
  /** O canal falhou: fica para a próxima passada. */
  pendentes: number
  /** Recusados pela barreira de dado pessoal. Deve ser sempre zero. */
  bloqueados: number
  tipos: string[]
}

/** Janela de leitura do histórico: o bastante para ver a ausência e as sequências. */
const janelaDeLeituraMin = (intervaloMin: number): number => Math.max(26 * 60, intervaloMin * 12)

export async function observar(
  env: AmbienteMonitor,
  deps: { fetch: typeof fetch; agoraIso: () => string; canal: CanalDeAlerta; porta?: PortaMonitor; log?: (t: Record<string, unknown>) => void },
): Promise<ResumoObservacao> {
  const em = deps.agoraIso()
  const intervaloMin = intervaloDe(env)
  const vazio = { em, intervaloMin, rodadasLidas: 0, avaliados: 0, novos: 0, suprimidos: 0, cedidos: 0, pendentes: 0, bloqueados: 0, tipos: [] as string[] }
  const fechar = (r: ResumoObservacao): ResumoObservacao => { deps.log?.({ evento: 'RECONCILIACAO_OBSERVADOR', ...r }); return r }

  if (!ligado(env)) return fechar({ desfecho: 'desligado', motivo: `FORMULARIO_MONITOR != ${LIGADO}`, ...vazio })
  const porta = deps.porta ?? portaDoAmbiente(env, deps.fetch)
  if ('motivo' in porta) return fechar({ desfecho: 'sem_configuracao', motivo: porta.motivo, ...vazio })

  const cfg = configParaIntervalo(intervaloMin)
  const agoraMs = Date.parse(em)
  const antes = (min: number) => new Date(agoraMs - min * 60_000).toISOString()
  try {
    const rodadas = await porta.rodadasDesde(antes(janelaDeLeituraMin(intervaloMin)))
    const entregues = await porta.entreguesDesde(antes(cfg.reemitirAposMin))
    const avaliados = avaliarRodadas(rodadas, em, cfg)
    const { novos, suprimidos } = deduplicar(avaliados, entregues, em, cfg)
    let bloqueados = 0
    let cedidos = 0
    let pendentes = 0
    const entreguesAgora: string[] = []
    for (const a of novos) {
      const problemas = problemasDeDadoPessoal(a)
      if (problemas.length > 0) {
        bloqueados += 1
        deps.log?.({ evento: 'RECONCILIACAO_ALERTA_BLOQUEADO', tipo: a.tipo, problemas })
        continue
      }
      const meu = await porta.reivindicarAlerta(a)
      const concorrentes = await porta.reivindicacoesDesde(a.chave, antes(JANELA_REIVINDICACAO_MIN))
      if (menorId([...concorrentes, { id: meu, em }]) !== meu) { cedidos += 1; continue }
      try {
        await deps.canal.avisar(a)
      } catch (e) {
        pendentes += 1
        deps.log?.({ evento: 'RECONCILIACAO_ALERTA_FALHA', tipo: a.tipo, canal: deps.canal.nome, motivo: descricaoSegura(e) })
        continue
      }
      await porta.confirmarEntrega(a.chave, meu, deps.canal.nome)
      entreguesAgora.push(a.tipo)
    }
    return fechar({
      desfecho: 'concluida', em, intervaloMin, rodadasLidas: rodadas.length, avaliados: avaliados.length,
      novos: entreguesAgora.length, suprimidos: suprimidos.length, cedidos, pendentes, bloqueados, tipos: entreguesAgora,
    })
  } catch (e) {
    return fechar({ desfecho: 'erro', motivo: descricaoSegura(e), ...vazio })
  }
}

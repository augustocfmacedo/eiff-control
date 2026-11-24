/**
 * Contrato SOMENTE LEITURA do estado operacional da reconciliação, para a Central de Gestão Comercial (Frente B)
 * consumir no futuro. Nada aqui grava, nada aqui é chamado pela Central hoje: é a forma combinada do dado.
 *
 * Fonte: as linhas que o monitor grava na `audit_log` (rodadas e entregas de alerta). Conteúdo: só números,
 * estados, códigos de catálogo e instantes — nenhum dado pessoal, nenhum id de submissão, nenhum id de lead.
 * Para ver QUAIS leads foram recuperados, a Central lê o Inbox e o Lead Engine, que são as autoridades; este
 * contrato só diz se a rede de segurança está funcionando.
 *
 * Versão no próprio objeto (`versao`): mudança incompatível sobe a versão.
 */
import {
  CONFIG_PADRAO, avaliarRodadas, type AlertaEmitido, type ConfigMonitor, type RodadaRegistrada,
} from './formularioMonitor'
import { rodadaDaLinha } from './formularioMonitorPorta'

export const VERSAO_CONTRATO = 'formulario-reconciliacao/v1'

/**
 * - `sem_registro`  o monitor ainda não viu rodada nenhuma (monitor desligado ou recém-ligado)
 * - `desligada`     reconciliação desligada de propósito
 * - `ok`            última rodada concluída sem falha, dentro do intervalo
 * - `com_falha`     última rodada com falha (leitura, configuração ou gravação)
 * - `ausente`       nenhuma rodada no intervalo esperado
 */
export type SituacaoReconciliacao = 'sem_registro' | 'desligada' | 'ok' | 'com_falha' | 'ausente'

export interface EstadoOperacionalReconciliacao {
  versao: typeof VERSAO_CONTRATO
  geradoEm: string
  situacao: SituacaoReconciliacao
  /** Intervalo esperado entre rodadas, em minutos. */
  intervaloMin: number
  /** Instante da última rodada registrada (qualquer desfecho). */
  ultimaExecucao?: string
  /** Desfecho da última rodada registrada. */
  ultimoDesfecho?: RodadaRegistrada['desfecho']
  /** Código de catálogo da última falha de leitura ou configuração, se a última rodada falhou assim. */
  codigoUltimaFalha?: string
  /** Submissões que a ÚLTIMA rodada concluída leu. */
  examinadas?: number
  /** Janela das somas abaixo, em horas. */
  janelaHoras: number
  /** Submissões gravadas pela reconciliação na janela (o evento do site não tinha entregado). */
  recuperadas: number
  /** Falhas de gravação na janela. */
  falhasGravacao: number
  /** Rodadas sem concluir (leitura ou configuração) na janela. */
  rodadasComFalha: number
  /** Instante do último alerta ENTREGUE pelo canal, se houver. */
  ultimoAlertaEm?: string
}

export function estadoOperacional(
  rodadas: readonly RodadaRegistrada[], entregues: readonly AlertaEmitido[], agora: string,
  cfg: ConfigMonitor = CONFIG_PADRAO, janelaHoras = 24,
): EstadoOperacionalReconciliacao {
  const agoraMs = Date.parse(agora)
  const ordenadas = [...rodadas].filter((r) => !Number.isNaN(Date.parse(r.em))).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  const naJanela = ordenadas.filter((r) => agoraMs - Date.parse(r.em) <= janelaHoras * 3_600_000)
  const ultima = ordenadas[ordenadas.length - 1]
  const ultimaConcluida = [...ordenadas].reverse().find((r) => r.desfecho === 'concluida')
  const alertas = avaliarRodadas(ordenadas, agora, cfg)
  const situacao: SituacaoReconciliacao =
    ultima === undefined ? 'sem_registro'
      : ultima.desfecho === 'desligada' ? 'desligada'
        : alertas.some((a) => a.tipo === 'RODADA_AUSENTE') ? 'ausente'
          : ultima.desfecho !== 'concluida' || ultima.falhas > 0 ? 'com_falha'
            : 'ok'
  const ultimoAlerta = [...entregues].map((e) => e.em).filter((e) => !Number.isNaN(Date.parse(e))).sort().pop()
  return {
    versao: VERSAO_CONTRATO,
    geradoEm: agora,
    situacao,
    intervaloMin: cfg.intervaloMin,
    ...(ultima === undefined ? {} : { ultimaExecucao: ultima.em, ultimoDesfecho: ultima.desfecho }),
    ...(ultima?.codigo === undefined ? {} : { codigoUltimaFalha: ultima.codigo }),
    ...(ultimaConcluida === undefined ? {} : { examinadas: ultimaConcluida.lidas }),
    janelaHoras,
    recuperadas: naJanela.reduce((s, r) => s + r.recuperadas, 0),
    falhasGravacao: naJanela.reduce((s, r) => s + r.falhas, 0),
    rodadasComFalha: naJanela.filter((r) => r.desfecho === 'erro_de_leitura' || r.desfecho === 'nao_configurada').length,
    ...(ultimoAlerta === undefined ? {} : { ultimoAlertaEm: ultimoAlerta }),
  }
}

/** Saúde para exibição: rótulo curto, tom (para a cor do selo) e a frase de orientação. Sem número, sem dado pessoal. */
export interface SaudeExibivel {
  situacao: SituacaoReconciliacao
  rotulo: string
  tom: 'ok' | 'atencao' | 'critico' | 'neutro'
  orientacao: string
}

const SAUDE: Record<SituacaoReconciliacao, Omit<SaudeExibivel, 'situacao'>> = {
  ok: { rotulo: 'Integração do site em dia', tom: 'ok', orientacao: 'A reconciliação está rodando e a última rodada não teve falha.' },
  com_falha: { rotulo: 'Integração do site com falha', tom: 'critico', orientacao: 'A última rodada teve falha: há alerta para a equipe responsável.' },
  ausente: { rotulo: 'Reconciliação parada', tom: 'critico', orientacao: 'Nenhuma rodada no intervalo esperado: conferir o Netlify Forms à mão.' },
  desligada: { rotulo: 'Reconciliação desligada', tom: 'atencao', orientacao: 'Leads que o site não entregar não são recuperados sozinhos: conferência diária manual.' },
  sem_registro: { rotulo: 'Monitor sem dados', tom: 'neutro', orientacao: 'O monitor ainda não registrou nenhuma rodada.' },
}

export const saudeExibivel = (e: EstadoOperacionalReconciliacao): SaudeExibivel => ({ situacao: e.situacao, ...SAUDE[e.situacao] })

/**
 * O contrato a partir das linhas cruas da `audit_log` (`entity_type = formulario_reconciliacao`): é o que um leitor
 * futuro da Central recebe do banco. Aceita só `action = rodada` e `alerta_entregue`; linha malformada é descartada.
 *
 * Quem pode ler: a política `audit_select` (Administrador, Diretoria, Financeiro, Contabilidade, Auditoria). Para
 * mostrar a saúde a quem não lê a auditoria, o caminho é uma RPC `security definer` que devolva SÓ este objeto —
 * proposta, não implementada (exige migration e autorização).
 */
export function estadoOperacionalDasLinhas(
  linhas: readonly Record<string, unknown>[], agora: string, cfg: ConfigMonitor = CONFIG_PADRAO, janelaHoras = 24,
): EstadoOperacionalReconciliacao {
  const rodadas = linhas.filter((l) => l['action'] === 'rodada').map(rodadaDaLinha).filter((r): r is RodadaRegistrada => r !== undefined)
  const entregues = linhas.filter((l) => l['action'] === 'alerta_entregue')
    .map((l) => ({ chave: String(l['entity_id'] ?? ''), em: String(l['occurred_at'] ?? '') }))
    .filter((e) => e.chave !== '' && !Number.isNaN(Date.parse(e.em)))
  return estadoOperacional(rodadas, entregues, agora, cfg, janelaHoras)
}

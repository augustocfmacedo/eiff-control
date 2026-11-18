/**
 * Canais de alerta da reconciliação. O monitor não sabe por onde o alerta sai: recebe um `CanalDeAlerta`.
 *
 *   registro   uma linha `RECONCILIACAO_ALERTA` no log da função. PADRÃO, e o único em uso hoje.
 *   webhook    POST JSON assinado (HMAC-SHA256) para uma URL (`FORMULARIO_ALERTA_WEBHOOK_URL`): serve a um receptor
 *              de chat, a uma automação ou a um provedor de e-mail transacional, sem acoplar o monitor a nenhum deles.
 *              Nenhuma URL real está configurada; o canal só é provado com `fetch` simulado.
 *   com registro  registro (trilha) + um canal de entrega: quem decide a entrega é o canal de entrega.
 *   composto   vários canais de entrega; vale se ao menos um aceitar, e falha se todos falharem.
 *
 * Deliberadamente NÃO usa nada da frente de e-mail comercial (`email-comercial`, `GOOGLE_OAUTH_*`): o alerta de
 * operação não pode depender da credencial nem do modo de envio de outra frente.
 *
 * Toda mensagem é montada por `mensagemDoAlerta`, só com o catálogo do monitor: tipo, severidade, contagens e
 * instantes. A barreira `problemasDeDadoPessoal` é conferida de novo aqui, antes de qualquer saída.
 */
import { descricaoSegura } from '../erroSeguro'
import { problemasDeDadoPessoal, type Alerta, type TipoAlerta } from './formularioMonitor'

export interface CanalDeAlerta {
  nome: string
  avisar(a: Alerta): Promise<void>
}

export interface MensagemDeAlerta {
  tipo: TipoAlerta
  severidade: Alerta['severidade']
  titulo: string
  texto: string
  /** O que a pessoa deve fazer. */
  acao: string
  desde: string
  em: string
  contagens: Record<string, number>
  codigo?: string
}

/** Título e ação por tipo: as seis situações que a Direção pediu distinguir, mais a configuração. */
const CATALOGO: Record<TipoAlerta, { titulo: string; acao: string }> = {
  FALHA_LEITURA: {
    titulo: 'Reconciliação: falha de leitura no Netlify',
    acao: 'Conferir a credencial de leitura (validade, revogação) e o status do Netlify. Submissões novas não estão sendo conferidas.',
  },
  CONFIGURACAO: {
    titulo: 'Reconciliação: ligada sem configuração completa',
    acao: 'Conferir as variáveis da reconciliação no painel do CRM (marco, site, banco). Nada é processado enquanto isso.',
  },
  FALHA_GRAVACAO: {
    titulo: 'Reconciliação: submissão não gravada no CRM',
    acao: 'Abrir o log da rodada (RECONCILIACAO_FALHA) e o Netlify Forms. Conferir pela seção 1.4 se o lead chegou por outro caminho.',
  },
  FALHAS_CONSECUTIVAS: {
    titulo: 'Reconciliação: várias rodadas seguidas com problema',
    acao: 'Investigar antes da próxima janela; considerar desligar a reconciliação e conferir o Netlify Forms à mão.',
  },
  RECUPERACAO: {
    titulo: 'Reconciliação: lead recuperado (o site não entregou)',
    acao: 'Atender o lead recuperado no Inbox (o prazo conta da submissão original) e investigar a função do site.',
  },
  RODADA_AUSENTE: {
    titulo: 'Reconciliação: nenhuma rodada no intervalo esperado',
    acao: 'Conferir no painel do Netlify se a função agendada está publicada e rodando. Enquanto isso, conferir o Netlify Forms à mão.',
  },
  DESLIGADA: {
    titulo: 'Reconciliação desligada',
    acao: 'Estado intencional. Enquanto durar, conferir diariamente o Netlify Forms contra o Inbox.',
  },
}

const PREFIXO: Record<Alerta['severidade'], string> = { critico: '[CRÍTICO]', aviso: '[AVISO]', info: '[INFORMATIVO]' }

export function mensagemDoAlerta(a: Alerta): MensagemDeAlerta {
  const c = CATALOGO[a.tipo]
  const numeros = Object.entries(a.contagens).map(([k, v]) => `${k}: ${v}`).join(' · ')
  return {
    tipo: a.tipo, severidade: a.severidade, desde: a.desde, em: a.em, contagens: a.contagens,
    ...(a.codigo === undefined ? {} : { codigo: a.codigo }),
    titulo: `${PREFIXO[a.severidade]} ${c.titulo}`,
    texto: [a.resumo, numeros === '' ? undefined : numeros, a.codigo === undefined ? undefined : `código: ${a.codigo}`, `desde ${a.desde}`]
      .filter((x) => x !== undefined).join(' — '),
    acao: c.acao,
  }
}

/** Monta a mensagem e confere a barreira. Lança se a barreira recusar: nada sai. */
export function mensagemSegura(a: Alerta): MensagemDeAlerta {
  const m = mensagemDoAlerta(a)
  const p = problemasDeDadoPessoal(m)
  if (p.length > 0) throw new Error(`alerta recusado pela barreira de dado pessoal: ${p.join(', ')}`)
  return m
}

/** Registra no log da função. Não sai nada para fora. */
export const canalSomenteRegistro = (log: (t: Record<string, unknown>) => void): CanalDeAlerta => ({
  nome: 'registro',
  async avisar(a) { log({ evento: 'RECONCILIACAO_ALERTA', ...mensagemSegura(a), chave: a.chave }) },
})

export const TEMPO_LIMITE_WEBHOOK_MS = 5_000

/** Tamanho mínimo do segredo de assinatura do webhook (caracteres). Segredo curto = webhook não é ativado. */
export const SEGREDO_MINIMO = 32

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** HMAC-SHA256 de `<timestamp>.<corpo>`, em hex. Web Crypto: o mesmo no Node das funções e nos testes. */
export async function assinarWebhook(segredo: string, timestamp: string, corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${timestamp}.${corpo}`)))
}

export interface OpcoesWebhook {
  /** Segredo compartilhado com o receptor (≥ `SEGREDO_MINIMO`). Obrigatório: sem ele o canal não é criado. */
  segredo: string
  nome?: string
  /** Relógio em segundos (o teste injeta). */
  agoraSegundos?: () => number
}

/**
 * POST JSON assinado. Cabeçalhos:
 *   x-eiff-timestamp   segundos desde a época, usados na assinatura (o receptor recusa se estiver longe do relógio dele)
 *   x-eiff-assinatura  `v1=` + HMAC-SHA256(segredo, `<timestamp>.<corpo>`) em hex
 *   x-eiff-entrega     a chave do alerta: o receptor deduplica por ela (a entrega é «ao menos uma vez»)
 * Resposta 2xx = entregue. Qualquer outra (4xx, 5xx, tempo esgotado, rede) lança: o observador não grava a entrega e
 * a passada seguinte tenta de novo. O erro nunca leva a URL nem o segredo.
 */
export function canalWebhook(url: string, fetchFn: typeof fetch, opcoes: OpcoesWebhook): CanalDeAlerta {
  if (!/^https:\/\//.test(url)) throw new Error('webhook de alerta exige https')
  if (opcoes.segredo.length < SEGREDO_MINIMO) throw new Error(`webhook de alerta exige segredo de assinatura com ${SEGREDO_MINIMO}+ caracteres`)
  const agora = opcoes.agoraSegundos ?? (() => Math.floor(Date.now() / 1000))
  return {
    nome: opcoes.nome ?? 'webhook',
    async avisar(a) {
      const corpo = JSON.stringify({ ...mensagemSegura(a), chave: a.chave, origem: 'eiff-control/formulario-reconciliacao', versao: 'v1' })
      const timestamp = String(agora())
      const assinatura = await assinarWebhook(opcoes.segredo, timestamp, corpo)
      let r: Response
      try {
        r = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-eiff-timestamp': timestamp, 'x-eiff-assinatura': `v1=${assinatura}`, 'x-eiff-entrega': a.chave },
          body: corpo,
          signal: AbortSignal.timeout(TEMPO_LIMITE_WEBHOOK_MS),
        })
      } catch (e) {
        throw new Error(`webhook de alerta: ${descricaoSegura(e)}`, { cause: e })
      }
      if (!r.ok) throw new Error(`webhook de alerta: http ${r.status}`)
    },
  }
}

/**
 * Registro + um canal de ENTREGA: o registro deixa a trilha no log, mas quem decide se foi entregue é o canal. (Um
 * composto «basta um aceitar» com o registro dentro nunca falharia, e a falha do webhook passaria por entrega.)
 */
export function canalComRegistro(entrega: CanalDeAlerta, log: (t: Record<string, unknown>) => void): CanalDeAlerta {
  const registro = canalSomenteRegistro(log)
  return {
    nome: `registro+${entrega.nome}`,
    async avisar(a) {
      await registro.avisar(a)
      await entrega.avisar(a)
    },
  }
}

/** Entrega em vários canais de ENTREGA. Vale se ao menos um aceitar; se todos falharem, lança com o resumo. */
export function canalComposto(canais: readonly CanalDeAlerta[]): CanalDeAlerta {
  return {
    nome: canais.map((c) => c.nome).join('+'),
    async avisar(a) {
      const falhas: string[] = []
      for (const c of canais) {
        try { await c.avisar(a) } catch (e) { falhas.push(`${c.nome}: ${(e as Error).message}`) }
      }
      if (falhas.length === canais.length) throw new Error(falhas.join(' | '))
    },
  }
}

export interface AmbienteCanal {
  /** `registro` (padrão) ou `webhook`. Qualquer outro valor = registro. */
  FORMULARIO_ALERTA_CANAL?: string
  FORMULARIO_ALERTA_WEBHOOK_URL?: string
  /** Segredo da assinatura HMAC (≥ 32 caracteres). Só no painel, nunca no repositório. */
  FORMULARIO_ALERTA_WEBHOOK_SEGREDO?: string
}

/**
 * O canal pelo ambiente. Padrão: só o registro. Com webhook: registro (trilha) + webhook (entrega). Webhook pedido
 * sem URL https ou sem segredo forte não derruba o monitor: fica só o registro, e o motivo é logado (sem o valor).
 */
export function canalDoAmbiente(env: AmbienteCanal, fetchFn: typeof fetch, log: (t: Record<string, unknown>) => void): CanalDeAlerta {
  if ((env.FORMULARIO_ALERTA_CANAL ?? '').trim().toLowerCase() !== 'webhook') return canalSomenteRegistro(log)
  try {
    const webhook = canalWebhook((env.FORMULARIO_ALERTA_WEBHOOK_URL ?? '').trim(), fetchFn, { segredo: (env.FORMULARIO_ALERTA_WEBHOOK_SEGREDO ?? '').trim() })
    return canalComRegistro(webhook, log)
  } catch (e) {
    log({ evento: 'RECONCILIACAO_MONITOR', outcome: 'canal_invalido', motivo: (e as Error).message })
    return canalSomenteRegistro(log)
  }
}

/** Canal de teste: guarda o que recebeu; pode falhar sob comando. */
export function canalSimulado(nome = 'simulado'): CanalDeAlerta & { recebidos: MensagemDeAlerta[]; falhar: boolean } {
  const c = {
    nome, recebidos: [] as MensagemDeAlerta[], falhar: false,
    async avisar(a: Alerta) {
      if (c.falhar) throw new Error('canal simulado indisponível')
      c.recebidos.push(mensagemSegura(a))
    },
  }
  return c
}

/**
 * Onde o monitor guarda e lê rodadas e alertas: a `audit_log` que já existe (0001_core.sql), sem migration.
 *
 * Linhas, todas com `entity_type = formulario_reconciliacao` e `source = formulario-monitor`:
 *
 *   action = rodada            uma por rodada ligada (e uma por dia enquanto desligada). `after_data` = `RodadaRegistrada`
 *   action = alerta            REIVINDICAÇÃO: um observador vai avisar este alerta. `entity_id` = chave do alerta
 *   action = alerta_entregue   o canal confirmou a entrega. `entity_id` = chave; `after_data` = { reivindicacao, canal }
 *
 * Por que reivindicação + entrega, e não uma linha só: a `audit_log` não tem índice único, então dois observadores
 * ao mesmo tempo gravariam o mesmo alerta duas vezes. A regra é: grava a reivindicação, relê as reivindicações
 * recentes da mesma chave, e só avisa quem tem o MENOR id (`bigserial`, atribuído pelo banco). E a entrega é linha
 * própria: execução interrompida entre a reivindicação e o aviso não perde o alerta — sem entrega confirmada, a
 * próxima passada (depois da janela da reivindicação) avisa de novo. Garantia: ao menos uma vez; duplicata só se
 * a confirmação da entrega falhar DEPOIS de o canal aceitar.
 *
 * A chave de serviço ignora RLS; por isso o filtro de organização vai explícito em toda consulta, como em
 * `formularioPorta.ts`. Escrita só por INSERT: nada é alterado nem apagado.
 */
import { DESFECHOS_VALIDOS, type Alerta, type AlertaEmitido, type RodadaRegistrada } from './formularioMonitor'

export const ENTIDADE = 'formulario_reconciliacao'
export const ORIGEM = 'formulario-monitor'

export interface ConfigPortaMonitor {
  url: string
  chave: string
  organizacaoId: string
}

export interface Reivindicacao {
  id: string
  em: string
}

export interface PortaMonitor {
  gravarRodada(r: RodadaRegistrada): Promise<void>
  /** A rodada mais recente registrada (para o registro diário do estado desligado). */
  ultimaRodada(): Promise<RodadaRegistrada | undefined>
  rodadasDesde(iso: string): Promise<RodadaRegistrada[]>
  /** Grava a reivindicação e devolve o id que o banco deu a ela. */
  reivindicarAlerta(a: Alerta): Promise<string>
  reivindicacoesDesde(chave: string, iso: string): Promise<Reivindicacao[]>
  confirmarEntrega(chave: string, reivindicacaoId: string, canal: string): Promise<void>
  /** Alertas com entrega confirmada: o estado da deduplicação. */
  entreguesDesde(iso: string): Promise<AlertaEmitido[]>
}

const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** Linha da auditoria → rodada. Linha malformada é descartada, nunca inventada. */
export function rodadaDaLinha(linha: Record<string, unknown>): RodadaRegistrada | undefined {
  const d = linha['after_data']
  if (d === null || typeof d !== 'object') return undefined
  const x = d as Record<string, unknown>
  const desfecho = String(x['desfecho'] ?? '')
  const em = String(x['em'] ?? '')
  if (!(DESFECHOS_VALIDOS as readonly string[]).includes(desfecho) || Number.isNaN(Date.parse(em))) return undefined
  return {
    em,
    desfecho: desfecho as RodadaRegistrada['desfecho'],
    ...(typeof x['codigo'] === 'string' ? { codigo: x['codigo'] as RodadaRegistrada['codigo'] } : {}),
    lidas: numero(x['lidas']), elegiveis: numero(x['elegiveis']), jaDentro: numero(x['jaDentro']),
    processadas: numero(x['processadas']), restam: numero(x['restam']), retidas: numero(x['retidas']),
    recuperadas: numero(x['recuperadas']), falhas: numero(x['falhas']),
  }
}

/** Menor id primeiro: a ordem da eleição. Ids são `bigserial`, comparados como número. */
export const menorId = (rs: readonly Reivindicacao[]): string | undefined =>
  [...rs].sort((a, b) => Number(a.id) - Number(b.id))[0]?.id

export function portaMonitorRest(cfg: ConfigPortaMonitor, fetchFn: typeof fetch): PortaMonitor {
  const base = { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, 'content-type': 'application/json' }
  const org = `organization_id=eq.${encodeURIComponent(cfg.organizacaoId)}`
  const filtro = `${org}&entity_type=eq.${ENTIDADE}`
  const q = encodeURIComponent

  async function pedir(caminho: string, init?: RequestInit): Promise<Record<string, unknown>[]> {
    const r = await fetchFn(`${cfg.url}/rest/v1/${caminho}`, { ...init, headers: { ...base, ...(init?.headers ?? {}) } })
    // O erro leva método, tabela e status: nunca a URL com filtros, nunca o cabeçalho.
    if (!r.ok) throw new Error(`postgrest ${init?.method ?? 'GET'} audit_log http ${r.status}`)
    if (r.status === 204) return []
    const d = await r.json().catch(() => [])
    return Array.isArray(d) ? (d as Record<string, unknown>[]) : [d as Record<string, unknown>]
  }

  const inserir = (action: string, entityId: string, dados: unknown, devolver = false) =>
    pedir('audit_log', {
      method: 'POST',
      headers: { prefer: devolver ? 'return=representation' : 'return=minimal' },
      body: JSON.stringify({ organization_id: cfg.organizacaoId, action, entity_type: ENTIDADE, entity_id: entityId, after_data: dados, source: ORIGEM }),
    })

  return {
    async gravarRodada(r) { await inserir('rodada', r.em, r) },
    async ultimaRodada() {
      const linhas = await pedir(`audit_log?${filtro}&action=eq.rodada&order=id.desc&select=after_data&limit=1`)
      return linhas[0] === undefined ? undefined : rodadaDaLinha(linhas[0])
    },
    async rodadasDesde(iso) {
      const linhas = await pedir(`audit_log?${filtro}&action=eq.rodada&occurred_at=gte.${q(iso)}&order=occurred_at.asc&select=after_data&limit=2000`)
      return linhas.map(rodadaDaLinha).filter((r): r is RodadaRegistrada => r !== undefined)
    },
    async reivindicarAlerta(a) {
      const linhas = await inserir('alerta', a.chave, a, true)
      const id = linhas[0]?.['id']
      if (id === undefined || id === null) throw new Error('postgrest POST audit_log sem id devolvido')
      return String(id)
    },
    async reivindicacoesDesde(chave, iso) {
      const linhas = await pedir(`audit_log?${filtro}&action=eq.alerta&entity_id=eq.${q(chave)}&occurred_at=gte.${q(iso)}&select=id,occurred_at&limit=100`)
      return linhas.map((l) => ({ id: String(l['id']), em: String(l['occurred_at'] ?? '') }))
    },
    async confirmarEntrega(chave, reivindicacaoId, canal) {
      await inserir('alerta_entregue', chave, { reivindicacao: reivindicacaoId, canal })
    },
    async entreguesDesde(iso) {
      const linhas = await pedir(`audit_log?${filtro}&action=eq.alerta_entregue&occurred_at=gte.${q(iso)}&select=entity_id,occurred_at&limit=1000`)
      return linhas.map((l) => ({ chave: String(l['entity_id'] ?? ''), em: String(l['occurred_at'] ?? '') })).filter((e) => e.chave !== '')
    },
  }
}

/** Porta em memória: testes e simulação local. Ids crescentes como o `bigserial`. */
export function portaMonitorMemoria(): PortaMonitor & {
  rodadas: RodadaRegistrada[]
  reivindicacoes: (Alerta & { id: string; gravadoEm: string })[]
  entregas: { chave: string; reivindicacao: string; canal: string; em: string }[]
  agora: () => string
  definirAgora(iso: string): void
} {
  const rodadas: RodadaRegistrada[] = []
  const reivindicacoes: (Alerta & { id: string; gravadoEm: string })[] = []
  const entregas: { chave: string; reivindicacao: string; canal: string; em: string }[] = []
  let agora = '1970-01-01T00:00:00.000Z'
  let seq = 0
  const desde = (iso: string, em: string) => Date.parse(em) >= Date.parse(iso)
  return {
    rodadas, reivindicacoes, entregas,
    agora: () => agora,
    definirAgora(iso) { agora = iso },
    async gravarRodada(r) { rodadas.push(r) },
    async ultimaRodada() { return rodadas[rodadas.length - 1] },
    async rodadasDesde(iso) { return rodadas.filter((r) => desde(iso, r.em)) },
    async reivindicarAlerta(a) { seq += 1; const id = String(seq); reivindicacoes.push({ ...a, id, gravadoEm: agora }); return id },
    async reivindicacoesDesde(chave, iso) { return reivindicacoes.filter((r) => r.chave === chave && desde(iso, r.gravadoEm)).map((r) => ({ id: r.id, em: r.gravadoEm })) },
    async confirmarEntrega(chave, reivindicacao, canal) { entregas.push({ chave, reivindicacao, canal, em: agora }) },
    async entreguesDesde(iso) { return entregas.filter((e) => desde(iso, e.em)).map((e) => ({ chave: e.chave, em: e.em })) },
  }
}

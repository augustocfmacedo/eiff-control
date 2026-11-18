/**
 * P1 — isolamento de produção e preview: as DECISÕES do plano, puras e testadas.
 *
 * Quem executa é `scripts/p1-isolamento.mts` (Netlify API pela CLI já autenticada, simulação por padrão).
 * Aqui só se decide, a partir de METADADOS — nunca de valor de segredo:
 *   - qual vaga do segredo está livre no CRM para receber o valor novo;
 *   - quais valores do segredo do SITE estão em contexto não produtivo e devem sair;
 *   - quais deploys do site ainda servem formulário fora da produção e devem ser apagados;
 *   - se a troca pode ser concluída (vaga antiga apagada).
 */

export const SITE_EIFF = 'fdb653b1-0ffc-4f64-92f9-2624328d2e45'
export const SITE_CRM = 'b4fb98ed-1fb9-4a21-b4c8-6e0268ad6507'
export const CHAVE_SITE = 'EIFF_FORM_SECRET'
export const VAGAS_CRM = ['EIFF_FORM_SECRET', 'EIFF_FORM_SECRET_B'] as const
export type VagaCrm = (typeof VAGAS_CRM)[number]

/** O que a API devolve de uma variável, reduzido ao que se pode olhar. O valor nunca entra aqui. */
export interface MetaVariavel {
  key: string
  isSecret: boolean
  scopes: readonly string[]
  valores: readonly { id: string; context: string }[]
}

export type Decisao<T> = { ok: true; valor: T } | { ok: false; motivo: string }

/** Vaga livre no CRM. As duas ocupadas = troca anterior não concluída: para. Nenhuma = algo está errado: para. */
export function vagaLivre(crm: readonly MetaVariavel[]): Decisao<{ livre: VagaCrm; emUso: VagaCrm }> {
  const ocupadas = VAGAS_CRM.filter((k) => crm.some((v) => v.key === k && v.valores.some((x) => x.context === 'production')))
  if (ocupadas.length === 2) return { ok: false, motivo: 'as duas vagas estão ocupadas: conclua a troca anterior antes de começar outra' }
  if (ocupadas.length === 0) return { ok: false, motivo: 'nenhuma vaga com valor de produção: o CRM recusaria todo lead; não começar troca sobre isso' }
  const emUso = ocupadas[0]!
  const livre: VagaCrm = emUso === 'EIFF_FORM_SECRET' ? 'EIFF_FORM_SECRET_B' : 'EIFF_FORM_SECRET'
  // A vaga livre não pode existir nem com valor fora de produção: a criação falharia no meio da troca.
  if (crm.some((v) => v.key === livre)) return { ok: false, motivo: `${livre} já existe (com valor fora de produção): apagar antes de começar a troca` }
  return { ok: true, valor: { emUso, livre } }
}

/** Valores do segredo do site fora de `production`: são eles que deixam preview e branch deploy com o segredo. */
export function valoresNaoProdutivos(v: MetaVariavel | undefined): string[] {
  return (v?.valores ?? []).filter((x) => x.context !== 'production').map((x) => x.id)
}

/** O segredo do site pode receber o valor novo? Precisa ser segredo, só de functions. */
export function siteApto(v: MetaVariavel | undefined): Decisao<true> {
  if (v === undefined) return { ok: false, motivo: `${CHAVE_SITE} não existe no site` }
  if (!v.isSecret) return { ok: false, motivo: `${CHAVE_SITE} do site não está marcado como segredo` }
  if (v.scopes.length !== 1 || v.scopes[0] !== 'functions') return { ok: false, motivo: `${CHAVE_SITE} do site deveria ter só o escopo functions` }
  return { ok: true, valor: true }
}

export interface MetaDeploy {
  id: string
  context: string
  state: string
  commit?: string
}

/**
 * Deploys a apagar. Todo deploy pronto que NÃO é de produção (preview, branch) serve formulário com os nomes
 * de produção até 90 dias, e uma submissão nele vai para o CRM. O publicado e os pontos de retorno ficam.
 * Deploy de produção antigo não entra aqui: ele é o mesmo site da produção (decisão à parte, no plano).
 */
export function deploysNaoProdutivos(deploys: readonly MetaDeploy[], publicado: string, manter: readonly string[] = []): string[] {
  return deploys
    .filter((d) => d.state === 'ready' && d.context !== 'production' && d.id !== publicado && !manter.includes(d.id))
    .map((d) => d.id)
}

/** A troca pode ser concluída (apagar a vaga antiga)? Só com as duas ocupadas e a confirmação de que o site já manda a nova. */
export function podeConcluir(crm: readonly MetaVariavel[], antiga: VagaCrm, leadNovoConfirmado: boolean): Decisao<VagaCrm> {
  const comProducao = (k: string) => crm.some((v) => v.key === k && v.valores.some((x) => x.context === 'production'))
  const nova = antiga === 'EIFF_FORM_SECRET' ? 'EIFF_FORM_SECRET_B' : 'EIFF_FORM_SECRET'
  if (!comProducao(antiga)) return { ok: false, motivo: `${antiga} já não tem valor: nada a concluir` }
  if (!comProducao(nova)) return { ok: false, motivo: `${nova} sem valor de produção: apagar ${antiga} recusaria todo lead` }
  if (!leadNovoConfirmado) return { ok: false, motivo: 'falta a prova de que o site já entrega com a vaga nova (um lead real registrado depois da publicação do site)' }
  return { ok: true, valor: antiga }
}

/** Reduz a resposta da API a metadados, descartando qualquer `value` que venha (o contexto `dev` de segredo volta legível). */
export function metaDaApi(bruto: unknown): (MetaVariavel & { atualizadaEm?: string }) | undefined {
  if (bruto === null || typeof bruto !== 'object') return undefined
  const o = bruto as { key?: unknown; is_secret?: unknown; scopes?: unknown; values?: unknown }
  if (typeof o.key !== 'string') return undefined
  const valores = Array.isArray(o.values)
    ? o.values.flatMap((x) => {
      const v = x as { id?: unknown; context?: unknown }
      return typeof v.id === 'string' && typeof v.context === 'string' ? [{ id: v.id, context: v.context }] : []
    })
    : []
  const atualizadaEm = typeof (o as { updated_at?: unknown }).updated_at === 'string' ? (o as { updated_at: string }).updated_at : undefined
  return {
    ...(atualizadaEm !== undefined ? { atualizadaEm } : {}),
    key: o.key,
    isSecret: o.is_secret === true,
    scopes: Array.isArray(o.scopes) ? o.scopes.filter((s): s is string => typeof s === 'string') : [],
    valores,
  }
}

/** Metadado de vaga com a data da última gravação (a API devolve `updated_at`). */
export interface MetaVaga extends MetaVariavel { atualizadaEm?: string }

/**
 * Qual vaga é a antiga e qual é a nova, a partir do ESTADO (nunca de parâmetro com padrão).
 * A nova é a gravada por último. Sem as duas com valor de produção, ou com datas iguais ou ausentes, recusa:
 * apagar a vaga errada recusaria todo lead.
 */
export function vagasDaTroca(crm: readonly MetaVaga[]): Decisao<{ antiga: VagaCrm; nova: VagaCrm }> {
  const com = VAGAS_CRM.map((k) => crm.find((v) => v.key === k && v.valores.some((x) => x.context === 'production')))
  const [a, b] = com
  if (a === undefined || b === undefined) return { ok: false, motivo: 'não há troca em andamento: as duas vagas precisam ter valor de produção' }
  const ta = Date.parse(a.atualizadaEm ?? ''), tb = Date.parse(b.atualizadaEm ?? '')
  if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return { ok: false, motivo: 'não dá para saber qual vaga é a nova (datas ausentes ou iguais): decidir à mão' }
  return ta < tb ? { ok: true, valor: { antiga: 'EIFF_FORM_SECRET', nova: 'EIFF_FORM_SECRET_B' } } : { ok: true, valor: { antiga: 'EIFF_FORM_SECRET_B', nova: 'EIFF_FORM_SECRET' } }
}

/** A letra que o log da borda registra para cada vaga (`chave` em formularioBorda). */
export const LETRA_DA_VAGA: Readonly<Record<VagaCrm, 'a' | 'b'>> = Object.freeze({ EIFF_FORM_SECRET: 'a', EIFF_FORM_SECRET_B: 'b' })

/**
 * Mensagem de falha de uma chamada da CLI SEM nada da chamada: o `Error` do execFileSync traz o argv inteiro
 * (onde está o valor novo) e o stderr do processo. Só a fase, o método e o código de saída saem.
 */
export function falhaSemSegredo(fase: string, metodo: string, e: unknown): string {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null
  return `falha em ${fase}: ${metodo}${status === null ? '' : ` (código ${status})`} — detalhe omitido de propósito (pode conter o valor)`
}

/** Campos de `build_settings` que um PATCH só de `skip_prs` pode mudar: ele e o carimbo da própria mudança. */
export const CAMPOS_BUILD_ALTERAVEIS = ['skip_prs', 'updated_at'] as const
/** Todo campo de `build_settings`, além de `skip_prs`, que mudou entre antes e depois. */
export function mudancasInesperadas(antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort()
  return chaves.filter((k) => !(CAMPOS_BUILD_ALTERAVEIS as readonly string[]).includes(k) && JSON.stringify(antes[k] ?? null) !== JSON.stringify(depois[k] ?? null))
}

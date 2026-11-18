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
  return { ok: true, valor: { emUso, livre: emUso === 'EIFF_FORM_SECRET' ? 'EIFF_FORM_SECRET_B' : 'EIFF_FORM_SECRET' } }
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
export function metaDaApi(bruto: unknown): MetaVariavel | undefined {
  if (bruto === null || typeof bruto !== 'object') return undefined
  const o = bruto as { key?: unknown; is_secret?: unknown; scopes?: unknown; values?: unknown }
  if (typeof o.key !== 'string') return undefined
  const valores = Array.isArray(o.values)
    ? o.values.flatMap((x) => {
      const v = x as { id?: unknown; context?: unknown }
      return typeof v.id === 'string' && typeof v.context === 'string' ? [{ id: v.id, context: v.context }] : []
    })
    : []
  return {
    key: o.key,
    isSecret: o.is_secret === true,
    scopes: Array.isArray(o.scopes) ? o.scopes.filter((s): s is string => typeof s === 'string') : [],
    valores,
  }
}

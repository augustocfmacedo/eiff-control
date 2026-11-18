/**
 * P1 — isolamento de produção e preview: o EXECUTOR do plano (docs/formulario-p1-isolamento.md).
 *
 *   npx vite-node scripts/p1-isolamento.mts -- inventario
 *   npx vite-node scripts/p1-isolamento.mts -- troca-preparar   [--executar --confirmar P1_TROCA_PREPARAR]
 *   npx vite-node scripts/p1-isolamento.mts -- troca-desfazer   [--executar --confirmar P1_TROCA_DESFAZER]
 *   npx vite-node scripts/p1-isolamento.mts -- troca-concluir --lead-confirmado [--executar --confirmar P1_TROCA_CONCLUIR]
 *   npx vite-node scripts/p1-isolamento.mts -- limpar-previews  [--executar --confirmar P1_LIMPAR_PREVIEWS]
 *   npx vite-node scripts/p1-isolamento.mts -- desligar-previews [--executar --confirmar P1_DESLIGAR_PREVIEWS]
 *
 * Sem `--executar` + a frase exata, NADA muda: o script lê metadados e mostra o que faria.
 * Cada fase que muda produção é VERMELHA e só roda com autorização específica da Direção.
 *
 * Segredo: o valor novo nasce aqui (32 bytes aleatórios), vai para as duas variáveis numa mesma execução e
 * nunca é impresso, gravado em arquivo nem devolvido. Limite conhecido: ele passa como argumento ao processo
 * da CLI do Netlify (visível na lista de processos desta máquina enquanto a chamada dura, segundos); a
 * alternativa seria ler o token da CLI, que é proibido. Ninguém precisa conhecer o valor: o Netlify não o
 * devolve, e a troca seguinte gera outro.
 */
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  CHAVE_SITE, SITE_CRM, SITE_EIFF, deploysNaoProdutivos, metaDaApi, podeConcluir, siteApto, vagaLivre,
  valoresNaoProdutivos, type MetaDeploy, type MetaVariavel, type VagaCrm,
} from '../src/core/radar/formularioP1'

const CONTA = 'augustocfmacedo'
const FRASES: Record<string, string> = {
  'troca-preparar': 'P1_TROCA_PREPARAR', 'troca-desfazer': 'P1_TROCA_DESFAZER', 'troca-concluir': 'P1_TROCA_CONCLUIR',
  'limpar-previews': 'P1_LIMPAR_PREVIEWS', 'desligar-previews': 'P1_DESLIGAR_PREVIEWS',
}
/** Pontos de retorno do site que nunca são apagados por este script. */
const MANTER: readonly string[] = []

const args = process.argv.slice(2).filter((a) => a !== '--')
const fase = args[0] ?? 'inventario'
const executar = args.includes('--executar')
const confirmacao = args[args.indexOf('--confirmar') + 1]
if (fase !== 'inventario' && !(fase in FRASES)) { console.error(`fase desconhecida: ${fase}`); process.exit(2) }
if (executar && confirmacao !== FRASES[fase]) { console.error(`BLOQUEADO: --executar exige --confirmar ${FRASES[fase] ?? '(fase só de leitura)'}`); process.exit(2) }
const modo = executar ? 'EXECUÇÃO' : 'SIMULAÇÃO'

const CLI = resolve(import.meta.dirname ?? '.', '..', 'node_modules', 'netlify-cli', 'bin', 'run.js')
/** Chama a API do Netlify pela CLI já autenticada. O retorno é JSON; quem chama só lê metadados. */
function api(metodo: string, dados: Record<string, unknown>): unknown {
  const saida = execFileSync(process.execPath, [CLI, 'api', metodo, '--data', JSON.stringify(dados)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return saida.trim() === '' ? null : JSON.parse(saida)
}
const variaveis = (site: string): MetaVariavel[] => {
  const r = api('getEnvVars', { account_id: CONTA, site_id: site })
  return (Array.isArray(r) ? r : []).map(metaDaApi).filter((x): x is MetaVariavel => x !== undefined)
}
const resumo = (m: MetaVariavel | undefined) => m === undefined ? '(não existe)' : `${m.isSecret ? 'segredo' : 'COMUM'} · ${m.scopes.join(',')} · ${m.valores.map((x) => x.context).join(',')}`

function deploysDoSite(): { publicado: string; deploys: MetaDeploy[] } {
  const site = api('getSite', { site_id: SITE_EIFF }) as { published_deploy?: { id?: string } }
  const deploys: MetaDeploy[] = []
  for (let pagina = 1; pagina <= 10; pagina += 1) {
    const lote = api('listSiteDeploys', { site_id: SITE_EIFF, per_page: 100, page: pagina }) as { id: string; context: string; state: string; commit_ref?: string }[]
    if (!Array.isArray(lote) || lote.length === 0) break
    deploys.push(...lote.map((d) => ({ id: d.id, context: d.context, state: d.state, commit: d.commit_ref?.slice(0, 7) })))
    if (lote.length < 100) break
  }
  return { publicado: site.published_deploy?.id ?? '', deploys }
}

function inventario(): void {
  const crm = variaveis(SITE_CRM), site = variaveis(SITE_EIFF)
  console.log(`CRM  EIFF_FORM_SECRET   : ${resumo(crm.find((v) => v.key === 'EIFF_FORM_SECRET'))}`)
  console.log(`CRM  EIFF_FORM_SECRET_B : ${resumo(crm.find((v) => v.key === 'EIFF_FORM_SECRET_B'))}`)
  console.log(`site ${CHAVE_SITE}   : ${resumo(site.find((v) => v.key === CHAVE_SITE))}`)
  const vaga = vagaLivre(crm)
  console.log(vaga.ok ? `troca: valor novo iria para ${vaga.valor.livre} (em uso: ${vaga.valor.emUso})` : `troca: BLOQUEADA — ${vaga.motivo}`)
  const { publicado, deploys } = deploysDoSite()
  const apagar = deploysNaoProdutivos(deploys, publicado, MANTER)
  console.log(`site publicado: ${publicado} · deploys: ${deploys.length} · não produtivos prontos (a apagar): ${apagar.length}`)
  for (const id of apagar) { const d = deploys.find((x) => x.id === id)!; console.log(`  ${id} ${d.context} ${d.commit ?? ''}`) }
  const s = api('getSite', { site_id: SITE_EIFF }) as { build_settings?: { skip_prs?: unknown; allowed_branches?: unknown } }
  console.log(`site previews: skip_prs=${JSON.stringify(s.build_settings?.skip_prs ?? null)} allowed_branches=${JSON.stringify(s.build_settings?.allowed_branches ?? null)}`)
}

function trocaPreparar(): void {
  const crm = variaveis(SITE_CRM), site = variaveis(SITE_EIFF)
  const vaga = vagaLivre(crm)
  if (!vaga.ok) { console.error(`BLOQUEADO: ${vaga.motivo}`); process.exit(1) }
  const meta = site.find((v) => v.key === CHAVE_SITE)
  const apto = siteApto(meta)
  if (!apto.ok) { console.error(`BLOQUEADO: ${apto.motivo}`); process.exit(1) }
  const sair = valoresNaoProdutivos(meta)
  console.log(`${modo}: 1) CRM cria ${vaga.valor.livre} (segredo, functions, só production) com o valor novo`)
  console.log(`${modo}: 2) site troca ${CHAVE_SITE} de production pelo valor novo`)
  console.log(`${modo}: 3) site apaga ${sair.length} valor(es) fora de production`)
  console.log(`${modo}: depois: publicar o CRM (aceita as duas vagas) e SÓ ENTÃO o site (passa a mandar a nova)`)
  if (!executar) return
  const novo = randomBytes(32).toString('base64url')
  api('createEnvVars', { account_id: CONTA, site_id: SITE_CRM, body: [{ key: vaga.valor.livre, is_secret: true, scopes: ['functions'], values: [{ context: 'production', value: novo }] }] })
  console.log(`ok 1: ${vaga.valor.livre} criado no CRM`)
  api('setEnvVarValue', { account_id: CONTA, site_id: SITE_EIFF, key: CHAVE_SITE, body: { context: 'production', value: novo } })
  console.log(`ok 2: ${CHAVE_SITE} de production trocado no site`)
  for (const id of sair) api('deleteEnvVarValue', { account_id: CONTA, site_id: SITE_EIFF, key: CHAVE_SITE, id })
  console.log(`ok 3: ${sair.length} valor(es) não produtivos apagados no site`)
  const depois = site.length > 0 ? variaveis(SITE_EIFF).find((v) => v.key === CHAVE_SITE) : undefined
  console.log(`conferência site: ${resumo(depois)}`)
}

/** Desfaz o passo 1 quando o 2 falhou: apaga a vaga nova do CRM, que nenhum site manda. */
function trocaDesfazer(): void {
  const crm = variaveis(SITE_CRM)
  const ambas = ['EIFF_FORM_SECRET', 'EIFF_FORM_SECRET_B'].every((k) => crm.some((v) => v.key === k))
  if (!ambas) { console.log('nada a desfazer: só uma vaga existe'); return }
  const nova: VagaCrm = args.includes('--vaga-a') ? 'EIFF_FORM_SECRET' : 'EIFF_FORM_SECRET_B'
  console.log(`${modo}: apagar ${nova} do CRM (use --vaga-a se a vaga nova for a a). Só se o site AINDA não foi publicado com o valor novo.`)
  if (executar) { api('deleteEnvVar', { account_id: CONTA, site_id: SITE_CRM, key: nova }); console.log(`ok: ${nova} apagado`) }
}

function trocaConcluir(): void {
  const crm = variaveis(SITE_CRM)
  const antiga: VagaCrm = args.includes('--antiga-b') ? 'EIFF_FORM_SECRET_B' : 'EIFF_FORM_SECRET'
  const d = podeConcluir(crm, antiga, args.includes('--lead-confirmado'))
  if (!d.ok) { console.error(`BLOQUEADO: ${d.motivo}`); process.exit(1) }
  console.log(`${modo}: apagar ${antiga} do CRM; depois publicar o CRM. A partir daí todo deploy antigo do site é recusado (401).`)
  if (executar) { api('deleteEnvVar', { account_id: CONTA, site_id: SITE_CRM, key: antiga }); console.log(`ok: ${antiga} apagado`) }
}

function limparPreviews(): void {
  const { publicado, deploys } = deploysDoSite()
  const apagar = deploysNaoProdutivos(deploys, publicado, MANTER)
  console.log(`${modo}: apagar ${apagar.length} deploy(s) não produtivo(s) do site (o permalink passa a 404; o publicado não entra)`)
  for (const id of apagar) {
    if (executar) { api('deleteSiteDeploy', { site_id: SITE_EIFF, deploy_id: id }); console.log(`ok: ${id} apagado`) } else console.log(`  ${id}`)
  }
}

function desligarPreviews(): void {
  console.log(`${modo}: site build_settings.skip_prs = true (sem deploy preview novo); branch deploys seguem só main`)
  if (executar) {
    api('updateSite', { site_id: SITE_EIFF, body: { build_settings: { skip_prs: true } } })
    const s = api('getSite', { site_id: SITE_EIFF }) as { build_settings?: { skip_prs?: unknown } }
    console.log(`conferência: skip_prs=${JSON.stringify(s.build_settings?.skip_prs ?? null)}`)
  }
}

console.log(`P1 · ${fase} · ${modo}`)
const fases: Record<string, () => void> = {
  inventario, 'troca-preparar': trocaPreparar, 'troca-desfazer': trocaDesfazer, 'troca-concluir': trocaConcluir,
  'limpar-previews': limparPreviews, 'desligar-previews': desligarPreviews,
}
fases[fase]!()

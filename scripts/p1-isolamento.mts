/**
 * P1 — isolamento de produção e preview: o EXECUTOR do plano (docs/formulario-p1-isolamento.md).
 *
 *   npx vite-node scripts/p1-isolamento.mts -- inventario
 *   npx vite-node scripts/p1-isolamento.mts -- troca-preparar   [--executar --confirmar P1_TROCA_PREPARAR]
 *   npx vite-node scripts/p1-isolamento.mts -- troca-desfazer --site-sem-valor-novo-publicado [--executar --confirmar P1_TROCA_DESFAZER]
 *   npx vite-node scripts/p1-isolamento.mts -- troca-concluir --chave-observada <a|b> [--executar --confirmar P1_TROCA_CONCLUIR]
 *   npx vite-node scripts/p1-isolamento.mts -- limpar-previews  [--executar --confirmar P1_LIMPAR_PREVIEWS]
 *   npx vite-node scripts/p1-isolamento.mts -- desligar-previews [--executar --confirmar P1_DESLIGAR_PREVIEWS]
 *
 * Sem `--executar` + a frase exata, NADA muda: o script lê metadados e mostra o que faria.
 * Cada fase que muda produção é VERMELHA e só roda com autorização específica da Direção.
 *
 * Erros: nenhuma falha de chamada imprime detalhe. O `Error` do execFileSync traz o argv (com o valor novo) e o
 * stderr; `api()` os descarta e mostra só fase, método e código de saída (`falhaSemSegredo`).
 *
 * Segredo: o valor novo nasce aqui (32 bytes aleatórios), vai para as duas variáveis numa mesma execução e
 * nunca é impresso, gravado em arquivo nem devolvido. As duas chamadas que levam o valor (`apiComSegredo`)
 * rodam a CLI do Netlify DENTRO deste processo: o valor nunca vira argumento de processo do sistema (antes ia
 * para o argv de um processo filho, visível na lista de processos). O token continua sendo lido só pela CLI.
 * Com `CI=true` a CLI não envia relatório de erro (o relatório sobe a mensagem do erro num processo filho) nem
 * abre perguntas. A saída da CLI nessas chamadas é capturada e descartada; só sai «ok» ou «falha».
 * Ninguém precisa conhecer o valor: o Netlify não o devolve, e a troca seguinte gera outro.
 */
// CI=true antes de a CLI ser carregada (ela só entra por import dinâmico em apiComSegredo; os imports estáticos
// abaixo não carregam o ci-info): sem relatório de erro e sem perguntas, sem depender de quem chama.
process.env['CI'] = 'true'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CHAVE_SITE, LETRA_DA_VAGA, SITE_CRM, SITE_EIFF, deploysNaoProdutivos, falhaSemSegredo, metaDaApi, mudancasInesperadas,
  podeConcluir, siteApto, vagaLivre, vagasDaTroca, valoresNaoProdutivos, type MetaDeploy, type MetaVaga,
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
if (fase !== 'inventario' && fase !== 'autoteste-em-processo' && !(fase in FRASES)) { console.error(`fase desconhecida: ${fase}`); process.exit(2) }
if (executar && confirmacao !== FRASES[fase]) { console.error(`BLOQUEADO: --executar exige --confirmar ${FRASES[fase] ?? '(fase só de leitura)'}`); process.exit(2) }
const modo = executar ? 'EXECUÇÃO' : 'SIMULAÇÃO'

const CLI = resolve(import.meta.dirname ?? '.', '..', 'node_modules', 'netlify-cli', 'bin', 'run.js')
/** Chama a API do Netlify pela CLI já autenticada. O retorno é JSON; quem chama só lê metadados. */
function api(metodo: string, dados: Record<string, unknown>): unknown {
  let saida: string
  try {
    saida = execFileSync(process.execPath, [CLI, 'api', metodo, '--data', JSON.stringify(dados)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    // NUNCA repassar o erro: message e cmd trazem o argv (com o valor), stderr pode ecoar o corpo.
    console.error(falhaSemSegredo(fase, metodo, e))
    process.exit(1)
  }
  if (saida.trim() === '') return null
  try { return JSON.parse(saida) } catch {
    console.error(`falha em ${fase}: ${metodo} — resposta não é JSON (conteúdo omitido)`)
    process.exit(1)
  }
}
/**
 * Chamada que LEVA o segredo: a CLI roda neste processo, com a saída capturada e descartada.
 * Devolve só se deu certo. Nada da chamada (dados, resposta, erro) é impresso.
 */
async function apiComSegredo(metodo: string, dados: Record<string, unknown>): Promise<boolean> {
  process.env['CI'] = 'true' // sem relatório de erro da CLI e sem perguntas interativas
  const base = pathToFileURL(resolve(import.meta.dirname ?? '.', '..', 'node_modules', 'netlify-cli', 'dist')).href
  const { createMainCommand } = await import(`${base}/commands/main.js`) as { createMainCommand: () => unknown }
  const { runProgram } = await import(`${base}/utils/run-program.js`) as { runProgram: (p: unknown, argv: string[]) => Promise<void> }
  const escreverOut = process.stdout.write.bind(process.stdout)
  const escreverErr = process.stderr.write.bind(process.stderr)
  const sair = process.exit.bind(process)
  let saiuCom: number | undefined
  process.stdout.write = (() => true) as typeof process.stdout.write
  process.stderr.write = (() => true) as typeof process.stderr.write
  process.exit = ((c?: number) => { saiuCom = c ?? 0; throw new Error('saida-da-cli') }) as typeof process.exit
  let ok = false
  try {
    await runProgram(createMainCommand(), ['node', 'netlify', 'api', metodo, '--data', JSON.stringify(dados)])
    ok = saiuCom === undefined || saiuCom === 0
  } catch {
    ok = false
  } finally {
    process.stdout.write = escreverOut
    process.stderr.write = escreverErr
    process.exit = sair
  }
  if (!ok) console.error(`falha em ${fase}: ${metodo} — detalhe omitido de propósito (pode conter o valor)`)
  return ok
}

const variaveis = (site: string): MetaVaga[] => {
  const r = api('getEnvVars', { account_id: CONTA, site_id: site })
  return (Array.isArray(r) ? r : []).map(metaDaApi).filter((x): x is MetaVaga => x !== undefined)
}
const resumo = (m: MetaVaga | undefined) => m === undefined ? '(não existe)' : `${m.isSecret ? 'segredo' : 'COMUM'} · ${m.scopes.join(',')} · ${m.valores.map((x) => x.context).join(',')}`

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

async function trocaPreparar(): Promise<void> {
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
  let novo: string | undefined = randomBytes(32).toString('base64url')
  if (!await apiComSegredo('createEnvVars', { account_id: CONTA, site_id: SITE_CRM, body: [{ key: vaga.valor.livre, is_secret: true, scopes: ['functions'], values: [{ context: 'production', value: novo }] }] })) {
    novo = undefined
    console.error('PARADO no passo 1: nada mudou no site. Conferir com inventario se a vaga nova foi criada mesmo assim (resposta perdida); se foi, troca-desfazer.')
    process.exit(1)
  }
  console.log(`ok 1: ${vaga.valor.livre} criado no CRM`)
  const ok2 = await apiComSegredo('setEnvVarValue', { account_id: CONTA, site_id: SITE_EIFF, key: CHAVE_SITE, body: { context: 'production', value: novo } })
  novo = undefined
  if (!ok2) {
    // NÃO desfazer sozinho: o site pode ter recebido o valor (resposta perdida). Com as duas vagas no CRM, qualquer
    // dos dois valores que o próximo build do site levar é aceito — o caminho de entrega fica preservado.
    console.error('PARADO no passo 2: CRM já tem a vaga nova; o site pode ou não ter o valor novo. NÃO desfazer: as duas vagas valem. Conferir com inventario (updated_at do segredo do site) antes de qualquer compensação.')
    process.exit(1)
  }
  console.log(`ok 2: ${CHAVE_SITE} de production trocado no site`)
  for (const id of sair) api('deleteEnvVarValue', { account_id: CONTA, site_id: SITE_EIFF, key: CHAVE_SITE, id })
  console.log(`ok 3: ${sair.length} valor(es) não produtivos apagados no site`)
  console.log(`conferência site: ${resumo(variaveis(SITE_EIFF).find((v) => v.key === CHAVE_SITE))}`)
  console.log('ATENÇÃO: o site NÃO pode ser publicado antes de o CRM ser republicado (passo 3), senão o valor novo dá 401.')
}

/** Desfaz o passo 1 quando o 2 falhou: apaga a vaga NOVA do CRM (derivada do estado), que nenhum site manda. */
function trocaDesfazer(): void {
  const v = vagasDaTroca(variaveis(SITE_CRM))
  if (!v.ok) { console.error(`BLOQUEADO: ${v.motivo}`); process.exit(1) }
  if (!args.includes('--site-sem-valor-novo-publicado')) {
    console.error('BLOQUEADO: confirme com --site-sem-valor-novo-publicado que nenhum deploy do site com o valor novo foi publicado (senão desfazer recusa todo lead)')
    process.exit(1)
  }
  // A data da última gravação pode enganar (alguém mexeu na vaga antiga depois): exige também a letra da vaga
  // a apagar, e ela tem de ser a única que só tem valor de production (a nova nasce assim).
  const informada = args[args.indexOf('--vaga') + 1]
  const crm = variaveis(SITE_CRM)
  const soProducao = (k: string) => { const m = crm.find((x) => x.key === k); return m !== undefined && m.valores.length === 1 && m.valores[0]!.context === 'production' }
  if (!args.includes('--vaga') || informada !== LETRA_DA_VAGA[v.valor.nova] || !soProducao(v.valor.nova)) {
    console.error(`BLOQUEADO: a vaga nova derivada é ${v.valor.nova} (${LETRA_DA_VAGA[v.valor.nova]}); confirme com --vaga ${LETRA_DA_VAGA[v.valor.nova]} — e ela precisa ter valor só em production`)
    process.exit(1)
  }
  console.log(`${modo}: apagar ${v.valor.nova} (a vaga nova) do CRM; fica só ${v.valor.antiga}`)
  if (executar) { api('deleteEnvVar', { account_id: CONTA, site_id: SITE_CRM, key: v.valor.nova }); console.log(`ok: ${v.valor.nova} apagado`) }
}

/**
 * Conclui: apaga a vaga ANTIGA (derivada do estado). Exige a letra que o log da borda registrou para o lead real
 * depois da publicação do site, e ela tem de ser a da vaga nova (`"etapa":"autenticado","chave":"b"`, por exemplo).
 */
function trocaConcluir(): void {
  const crm = variaveis(SITE_CRM)
  const v = vagasDaTroca(crm)
  if (!v.ok) { console.error(`BLOQUEADO: ${v.motivo}`); process.exit(1) }
  const observada = args[args.indexOf('--chave-observada') + 1]
  const esperada = LETRA_DA_VAGA[v.valor.nova]
  const d = podeConcluir(crm, v.valor.antiga, args.includes('--chave-observada') && observada === esperada)
  if (!d.ok) { console.error(`BLOQUEADO: ${d.motivo} — informe --chave-observada ${esperada} (a vaga nova), lida no log de um lead real`); process.exit(1) }
  // Depois deste passo o reconciliador manual (que usa o segredo local) não autentica mais: só conclui com outro
  // caminho de recuperação LIGADO — a conferência C ou a reconciliação agendada (que grava sem o segredo).
  const recuperacao = args[args.indexOf('--recuperacao-ativa') + 1]
  if (!args.includes('--recuperacao-ativa') || !['conferencia-c', 'agendada'].includes(recuperacao ?? '')) {
    console.error('BLOQUEADO: informe --recuperacao-ativa conferencia-c|agendada (o caminho de recuperação que está ligado em produção); sem ele, um lead que falhar no evento não tem mais como entrar')
    process.exit(1)
  }
  console.log(`${modo}: apagar ${v.valor.antiga} (antiga) do CRM; fica ${v.valor.nova}. Depois publicar o CRM: todo deploy antigo do site passa a 401.`)
  if (executar) { api('deleteEnvVar', { account_id: CONTA, site_id: SITE_CRM, key: v.valor.antiga }); console.log(`ok: ${v.valor.antiga} apagado`) }
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
  const antes = ((api('getSite', { site_id: SITE_EIFF }) as { build_settings?: Record<string, unknown> }).build_settings) ?? {}
  if (executar) {
    api('updateSite', { site_id: SITE_EIFF, body: { build_settings: { skip_prs: true } } })
    const depois = ((api('getSite', { site_id: SITE_EIFF }) as { build_settings?: Record<string, unknown> }).build_settings) ?? {}
    const mudou = mudancasInesperadas(antes, depois)
    console.log(`conferência: skip_prs=${JSON.stringify(depois['skip_prs'] ?? null)}`)
    if (mudou.length > 0) { console.error(`ALERTA: o PATCH mudou também ${mudou.join(', ')} — restaurar à mão a partir do 'antes' registrado`); console.error(JSON.stringify(Object.fromEntries(mudou.map((k) => [k, antes[k]])))); process.exit(1) }
  }
}

console.log(`P1 · ${fase} · ${modo}`)
/**
 * Só leitura: prova o caminho em processo com um MARCADOR (não um segredo). Uma leitura que dá certo (getSite) e uma
 * que falha de propósito (variável inexistente cujo nome é o marcador). O marcador não pode aparecer na saída.
 */
async function autotesteEmProcesso(): Promise<void> {
  const marcador = process.env['P1_MARCADOR'] ?? 'MARCADOR'
  const leitura = await apiComSegredo('getSite', { site_id: SITE_EIFF })
  const falha = await apiComSegredo('getEnvVar', { account_id: CONTA, site_id: SITE_EIFF, key: `P1_AUTOTESTE_${marcador}` })
  console.log(`autoteste: leitura=${leitura ? 'ok' : 'falhou'} chamada-que-deve-falhar=${falha ? 'NAO FALHOU' : 'falhou como esperado'}`)
}

const fases: Record<string, () => void | Promise<void>> = {
  'autoteste-em-processo': autotesteEmProcesso,
  inventario, 'troca-preparar': trocaPreparar, 'troca-desfazer': trocaDesfazer, 'troca-concluir': trocaConcluir,
  'limpar-previews': limparPreviews, 'desligar-previews': desligarPreviews,
}
await fases[fase]!()

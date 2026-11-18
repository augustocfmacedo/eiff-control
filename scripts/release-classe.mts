// Classe mínima de release (docs/politica-releases.md). Somente leitura do git; não faz fetch.
//
// ONDE VALE: a classificação que libera o rito autônomo é a do check "EIFF Release Class" na CI
// (.github/workflows/release-classe.yml, `pull_request_target`): ali o código do classificador vem da BASE e o
// PR não consegue reescrevê-lo. Rodado na máquina do agente é só uma prévia, e o script recusa rodar se o próprio
// código (ou o que o carrega) diferir de refs/remotes/origin/main.
//
//   pr <candidato>                      base = refs/remotes/origin/main
//   pr <sha-base> <sha-candidato>       (CI) dois SHAs de 40 hex
//   publicacao <sha-publicado> <sha-candidato>
//       sha-publicado = commit_ref do deploy no ar, lido do Netlify; sha-candidato = commit_ref do deploy a publicar.
//       Compara árvores; recusa se o publicado não for ancestral do candidato.
//
// <candidato> aceita só SHA de 40 hex ou refs/remotes/origin/<branch>: nome curto é recusado (uma tag chamada
// `origin/main` venceria a branch remota na resolução do git).
//
// Saída: 0 = VERDE ou AMARELO; 2 = VERMELHO OU QUALQUER ERRO. Só a saída 0 libera.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { classeDoConjunto, docsCitadosEm, importsRelativos, lerRawZ, testeComImportOpaco } from '../src/core/release/classe'

const BLOQUEIA = 2
const SHA = /^[0-9a-f]{40}$/
const REMOTA = /^refs\/remotes\/origin\/[A-Za-z0-9][\w./-]*$/
const PROPRIO = ['src/core/release', 'scripts/release-classe.mts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']

// ambiente do git limpo: nenhuma GIT_* herdada e sem replace. A configuração global continua (no Windows ela guarda o
// safe.directory dos worktrees); as opções que mudariam a leitura do diff são fixadas por -c. Na CI, a verificação
// que vale, a configuração é a do runner, limpa.
const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_')))
Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' })
const FIXAS = ['core.quotepath=off', 'diff.relative=false', 'diff.external=', 'diff.noprefix=false', 'core.fsmonitor=false', 'grep.patternType=basic']
const git0 = (args: string[], cwd?: string) => execFileSync('git', [...FIXAS.flatMap((c) => ['-c', c]), ...args], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const bloquear = (o: Record<string, unknown>) => { console.log(JSON.stringify({ ...o, classe: 'VERMELHO' }, null, 2)); process.exit(BLOQUEIA) }

try {
  const raiz = git0(['rev-parse', '--show-toplevel']).trim()
  const git = (args: string[]) => git0(args, raiz)
  // ref nomeada só pela forma EXATA (show-ref --verify não cai em tags de nome parecido); SHA confirmado como commit
  const resolver = (ref: string) => {
    const sha = SHA.test(ref) ? ref : git(['show-ref', '--verify', '--hash', ref]).trim()
    return git(['rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`]).trim()
  }
  // o script que roda tem de ser o deste repositório, não uma cópia em outro caminho
  const proprio = path.resolve(fileURLToPath(import.meta.url)).toLowerCase()
  if (proprio !== path.resolve(raiz, 'scripts', 'release-classe.mts').toLowerCase()) {
    console.error('release-classe: o script em execução não é o scripts/release-classe.mts deste repositório')
    process.exit(BLOQUEIA)
  }
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const [modo, a1, a2] = args
  let base: string; let cand: string
  if (modo === 'pr' && args.length === 2 && (SHA.test(a1) || REMOTA.test(a1))) { base = 'refs/remotes/origin/main'; cand = a1 }
  else if ((modo === 'pr' || modo === 'publicacao') && args.length === 3 && SHA.test(a1) && SHA.test(a2)) { base = a1; cand = a2 }
  else {
    console.error('uso: release-classe.mts -- pr <sha|refs/remotes/origin/branch> | pr <sha-base> <sha-cand> | publicacao <sha-publicado> <sha-cand>')
    process.exit(BLOQUEIA)
  }
  const shaBase = resolver(base)
  const shaCand = resolver(cand)
  const contexto = { modo, base, shaBase, candidato: cand, shaCand }
  // o classificador que roda tem de ser o da main (na CI o checkout já é a base; na máquina do agente, confere)
  const shaMain = resolver('refs/remotes/origin/main')
  try { git(['diff', '--quiet', shaMain, '--', ...PROPRIO]) } catch {
    bloquear({ ...contexto, motivo: 'o classificador local difere de refs/remotes/origin/main: rode a partir da main (ou confie só no check da CI)' })
  }
  if (shaBase === shaCand) bloquear({ ...contexto, motivo: 'base e candidato são o mesmo commit: nada a classificar' })
  if (modo === 'publicacao') {
    try { git(['merge-base', '--is-ancestor', shaBase, shaCand]) } catch {
      bloquear({ ...contexto, motivo: 'o publicado não é ancestral do candidato: publicar desfaria o que só existe no ar' })
    }
  }
  const intervalo = modo === 'pr' ? [`${shaBase}...${shaCand}`] : [shaBase, shaCand]
  const mudancas = lerRawZ(git(['diff', '--raw', '-z', '--no-renames', '--no-relative', '--ignore-submodules=none', '--abbrev=40', ...intervalo]))
  if (mudancas.length === 0) bloquear({ ...contexto, motivo: 'diff vazio' })
  const arvore = git(['ls-tree', '-r', '-z', '--name-only', shaCand]).split('\0').filter((x) => x !== '')
  // documentos citados pelas instruções da BASE (não as do candidato, que o PR poderia apagar)
  const instrucoes = ['CLAUDE.md', 'AGENTS.md'].map((f) => { try { return git(['show', `${shaBase}:${f}`]) } catch { return '' } }).join('\n')
  // imports de cada teste alterado: UNIÃO da versão da base com a do candidato (esvaziar o teste não apaga a ligação
  // com o que ele guardava); forma de import opaca em qualquer das duas versões torna o teste VERMELHO
  const arvoreSet = new Set([...arvore, ...git(['ls-tree', '-r', '-z', '--name-only', shaBase]).split('\0').filter((x) => x !== '')])
  const importsDosTestes: Record<string, string[]> = {}
  const testesSuspeitos: string[] = []
  const ler = (sha: string, f: string) => { try { return git(['show', `${sha}:${f}`]) } catch { return '' } }
  for (const m of mudancas) {
    if (!/\.test\.tsx?$/i.test(m.arquivo)) continue
    const versoes = [ler(shaBase, m.arquivo), m.status === 'D' ? '' : ler(shaCand, m.arquivo)]
    if (versoes.some(testeComImportOpaco)) testesSuspeitos.push(m.arquivo)
    const dir = m.arquivo.split('/').slice(0, -1)
    importsDosTestes[m.arquivo] = versoes.flatMap(importsRelativos).flatMap((spec) => {
      const partes = [...dir]
      for (const seg of spec.split('/')) { if (seg === '..') partes.pop(); else if (seg !== '.') partes.push(seg) }
      const alvo = partes.join('/').replace(/\.js$/, '')
      return ['', '.ts', '.tsx', '/index.ts'].map((e) => alvo + e).filter((c) => arvoreSet.has(c)).slice(0, 1)
    })
  }
  const r = classeDoConjunto(mudancas, { arvore, docsCitados: docsCitadosEm(instrucoes), importsDosTestes, testesSuspeitos })
  console.log(JSON.stringify({ ...contexto, classe: r.classe, colisoes: r.colisoes, arquivos: r.arquivos }, null, 2))
  process.exit(r.classe === 'VERMELHO' ? BLOQUEIA : 0)
} catch (e) {
  console.error(`release-classe: falhou fechado: ${String((e as Error)?.message ?? e).split('\n')[0]}`)
  process.exit(BLOQUEIA)
}

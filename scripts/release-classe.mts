// Classe mínima de release (docs/politica-releases.md). Somente leitura do git local; não faz fetch (rode
// `git fetch origin` antes). Roda sempre a partir da raiz do repositório e imprime os SHAs resolvidos.
//
//   npx vite-node scripts/release-classe.mts -- pr <branch>
//       PR: o que a branch acrescenta desde o ponto em que saiu de origin/main (três pontos). A base é sempre
//       origin/main; o merge depois tem de usar `gh pr merge --match-head-commit <shaCand>` com o SHA impresso aqui.
//   npx vite-node scripts/release-classe.mts -- publicacao <commit_ref do deploy publicado> <candidato>
//       Publicação: diferença de ÁRVORE entre o que está no ar e o candidato. O commit publicado tem de ser o
//       `commit_ref` lido do Netlify (getSite). Recusa se o publicado não for ancestral do candidato.
//
// Saída: 0 = VERDE ou AMARELO; 2 = VERMELHO OU QUALQUER ERRO (ref inválida, diff vazio, histórico divergente,
// caminho colidindo em maiúsculas, saída do git inesperada). Só a saída 0 libera o rito autônomo.
import { execFileSync } from 'node:child_process'
import { classeDoConjunto, lerRawZ } from '../src/core/release/classe'

const BLOQUEIA = 2
const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (args: string[]) => execFileSync('git', ['-c', 'core.quotepath=off', '-c', 'diff.relative=false', ...args], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const bloquear = (o: Record<string, unknown>) => { console.log(JSON.stringify({ ...o, classe: 'VERMELHO' }, null, 2)); process.exit(BLOQUEIA) }

try {
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const modo = args[0]
  const ref = /^[A-Za-z0-9][\w./-]*$/
  const [base, cand] = modo === 'pr' ? ['origin/main', args[1]] : [args[1], args[2]]
  if ((modo !== 'pr' && modo !== 'publicacao') || !base || !cand || ![base, cand].every((r) => ref.test(r)) || args.length !== (modo === 'pr' ? 2 : 3)) {
    console.error('uso: release-classe.mts -- pr <branch> | publicacao <publicado> <candidato>')
    process.exit(BLOQUEIA)
  }
  const shaBase = git(['rev-parse', '--verify', `${base}^{commit}`]).trim()
  const shaCand = git(['rev-parse', '--verify', `${cand}^{commit}`]).trim()
  const contexto = { modo, base, shaBase, candidato: cand, shaCand }
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
  const r = classeDoConjunto(mudancas, arvore)
  console.log(JSON.stringify({ ...contexto, classe: r.classe, colisoes: r.colisoes, arquivos: r.arquivos }, null, 2))
  process.exit(r.classe === 'VERMELHO' ? BLOQUEIA : 0)
} catch (e) {
  console.error(`release-classe: falhou fechado: ${String((e as Error)?.message ?? e).split('\n')[0]}`)
  process.exit(BLOQUEIA)
}

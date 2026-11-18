// Classe mínima de release (docs/politica-releases.md). Somente leitura do git local; não faz fetch (rode
// `git fetch origin` antes) e imprime os SHAs resolvidos, para a evidência no PR ser auditável.
//
//   npx vite-node scripts/release-classe.mts -- pr <base> <branch>
//       PR: o que a branch acrescenta desde o ponto em que saiu da base (três pontos, merge-base..branch).
//   npx vite-node scripts/release-classe.mts -- publicacao <commit-publicado> <candidato>
//       Publicação: a diferença de ÁRVORE entre o que está no ar e o candidato (dois pontos). Recusa quando o
//       publicado não é ancestral do candidato: publicar desfaria algo que só existe no ar.
//
// Saída: 0 = VERDE ou AMARELO; 2 = VERMELHO OU QUALQUER ERRO (ref inválida, git ausente, histórico divergente).
// Só a saída 0 libera o rito autônomo.
import { execFileSync } from 'node:child_process'
import { classeDoConjunto, lerNameStatusZ } from '../src/core/release/classe'

const BLOQUEIA = 2
const git = (args: string[]) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

try {
  const [modo, base, cand] = process.argv.slice(2).filter((a) => a !== '--')
  if ((modo !== 'pr' && modo !== 'publicacao') || !base || !cand || ![base, cand].every((r) => /^[A-Za-z0-9][\w./-]*$/.test(r))) {
    console.error('uso: release-classe.mts -- pr <base> <branch> | publicacao <publicado> <candidato>')
    process.exit(BLOQUEIA)
  }
  const shaBase = git(['rev-parse', '--verify', `${base}^{commit}`]).trim()
  const shaCand = git(['rev-parse', '--verify', `${cand}^{commit}`]).trim()
  if (modo === 'publicacao') {
    try { git(['merge-base', '--is-ancestor', shaBase, shaCand]) } catch {
      console.log(JSON.stringify({ modo, base, shaBase, candidato: cand, shaCand, classe: 'VERMELHO', motivo: 'o publicado não é ancestral do candidato: publicar desfaria o que só existe no ar' }, null, 2))
      process.exit(BLOQUEIA)
    }
  }
  const intervalo = modo === 'pr' ? [`${shaBase}...${shaCand}`] : [shaBase, shaCand]
  const mudancas = lerNameStatusZ(git(['diff', '--name-status', '--no-renames', '-z', ...intervalo]))
  const r = classeDoConjunto(mudancas)
  console.log(JSON.stringify({ modo, base, shaBase, candidato: cand, shaCand, classe: r.classe, arquivos: r.arquivos }, null, 2))
  process.exit(r.classe === 'VERMELHO' ? BLOQUEIA : 0)
} catch (e) {
  console.error(`release-classe: falhou fechado: ${String((e as Error)?.message ?? e).split('\n')[0]}`)
  process.exit(BLOQUEIA)
}

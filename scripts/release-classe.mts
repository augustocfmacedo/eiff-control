// Classe mínima de um intervalo de commits (docs/politica-releases.md). Somente leitura do git local.
//   npx vite-node scripts/release-classe.mts -- <base> <candidato>
// A classe de uma publicação é a do intervalo entre o commit publicado e o candidato. Sai com 2 se VERMELHO.
import { execFileSync } from 'node:child_process'
import { classeDoConjunto } from '../src/core/release/classe'

const args = process.argv.slice(2).filter((a) => a !== '--')
const [base, cand] = args
if (!base || !cand || ![base, cand].every((r) => /^[\w./-]+$/.test(r))) {
  console.error('uso: release-classe.mts -- <base> <candidato>')
  process.exit(64)
}
const arquivos = execFileSync('git', ['diff', '--name-only', `${base}...${cand}`], { encoding: 'utf8' }).split('\n')
const r = classeDoConjunto(arquivos)
console.log(JSON.stringify({ base, candidato: cand, classe: r.classe, arquivos: r.arquivos }, null, 2))
process.exit(r.classe === 'VERMELHO' ? 2 : 0)

// Grava o SHA do artefato publicado num modulo TypeScript, DURANTE O BUILD.
//
// Por que isto existe: o Deploy Preview 5 provou que `COMMIT_REF` existe no ambiente de BUILD do Netlify e
// NAO existe no runtime da Function. Ler `process.env.COMMIT_REF` dentro da funcao devolvia sempre vazio, e
// o painel nao conseguia dizer se a tela publicada estava atras do `main`. A captura passa a acontecer onde
// a informacao realmente existe: no build. O modulo gerado entra no bundle da Function porque o Netlify
// empacota as funcoes DEPOIS de rodar o comando de build.
//
// Regras: nenhum SHA escrito a mao, nenhuma chamada ao GitHub, e ausencia de informacao vira `null`
// (a tela mostra "desconhecido") em vez de um valor plausivel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARQUIVO = 'src/core/central/buildSha.ts';
const SHA = /^[0-9a-f]{7,40}$/i;

/**
 * A UNICA fonte do SHA: `COMMIT_REF`, que o Netlify injeta no ambiente de BUILD. Sem ele — desenvolvimento
 * local, CI do GitHub — devolve null, e a tela DIZ que nao sabe. Nunca um palpite, nunca o git de quem
 * rodou o comando: o que interessa e o commit que o artefato PUBLICADO carrega. Assim o arquivo gerado
 * tambem fica estavel no repositorio (sempre null), e nenhum build local suja a arvore.
 */
export function shaDeAmbiente(env = {}) {
  const doNetlify = String(env.COMMIT_REF ?? '').trim();
  return SHA.test(doNetlify) ? { sha: doNetlify, origem: 'COMMIT_REF' } : { sha: null, origem: null };
}

/** O modulo gerado. Determinstico: a mesma entrada produz exatamente o mesmo arquivo. */
export function conteudoDoModulo({ sha, origem }) {
  return `// GERADO por scripts/gerar-build-sha.mjs durante \`npm run build\`. Nao editar a mao.
//
// \`SHA_DO_BUILD\` e o commit DESTE artefato publicado. Nao confundir com \`github.main.sha\`, que e o
// commit atual do \`main\` observado no GitHub: sao coisas diferentes e a comparacao entre elas e o que
// diz se a tela esta ao vivo ou atras do main. \`null\` significa "o ambiente nao informou" — nunca um
// palpite (ver docs/mission-control-live.md, secao do build SHA).
export const SHA_DO_BUILD: string | null = ${sha ? `'${sha}'` : 'null'};
export const ORIGEM_DO_BUILD: 'COMMIT_REF' | null = ${origem ? `'${origem}'` : 'null'};
`;
}

const ehPrincipal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (ehPrincipal) {
  const raiz = process.cwd();
  const alvo = path.join(raiz, ARQUIVO);
  const info = shaDeAmbiente(process.env);
  const novo = conteudoDoModulo(info);
  const atual = fs.existsSync(alvo) ? fs.readFileSync(alvo, 'utf8') : '';
  if (atual !== novo) fs.writeFileSync(alvo, novo);
  console.log(`[build-sha] ${info.sha ? `${info.sha.slice(0, 7)} (${info.origem})` : 'desconhecido'} -> ${ARQUIVO}`);
}

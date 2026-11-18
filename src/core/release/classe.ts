/**
 * Classe mínima de release por arquivo (docs/politica-releases.md, seção 2).
 *
 * Regra de NEGAÇÃO POR PADRÃO: todo caminho é VERMELHO, salvo os que estão explicitamente numa lista VERDE ou
 * AMARELA. Uma lista de caminhos perigosos sempre esquece algum (revisão independente de 18/11/2026: chave de serviço
 * em `src/data`, interruptores em `src/core`, runbooks sem "produção" no nome, o próprio classificador...); uma lista
 * de caminhos seguros erra para o lado certo. Caminho novo que ninguém classificou nasce VERMELHO.
 *
 * É um PISO, não um veredito: nunca rebaixa a classe declarada pelo orquestrador, só a sobe. A revisão independente
 * confere o resto (efeito financeiro, dependência de migration não aplicada, guarda de teste enfraquecida), que
 * nenhum padrão de caminho enxerga.
 */
export type Classe = 'VERDE' | 'AMARELO' | 'VERMELHO'
/** Status do git (`--name-status`): A adicionado, M modificado, D apagado, T tipo mudou. Renomeação vem desligada. */
export type StatusGit = 'A' | 'M' | 'D' | 'T'

const ORDEM: Record<Classe, number> = { VERDE: 0, AMARELO: 1, VERMELHO: 2 }

export const maiorClasse = (a: Classe, b: Classe): Classe => (ORDEM[a] >= ORDEM[b] ? a : b)

/**
 * Exceções VERMELHAS dentro das listas permitidas: caminhos que pareceriam seguros pelo padrão, mas decidem
 * autorização, segredo, envio externo, dinheiro ou a própria política.
 */
export const VERMELHOS_NOMINAIS: ReadonlyArray<{ padrao: RegExp; motivo: string }> = [
  { padrao: /^CLAUDE\.md$/, motivo: 'regras de autorização dos agentes' },
  { padrao: /^docs\/politica-releases\.md$/, motivo: 'a própria política de releases' },
  { padrao: /^docs\/seguranca\//, motivo: 'runbook e evidência de segurança' },
  { padrao: /^src\/core\/release\//, motivo: 'o próprio classificador' },
  { padrao: /^src\/core\/(engine|permissoes|chaveServico|erroSeguro)\.ts$/, motivo: 'alçadas, permissões, chave de serviço ou redação de segredos' },
  { padrao: /^src\/core\/inbox\/(ativacao|emailEnvio)\.ts$/, motivo: 'interruptor ou envio externo' },
  { padrao: /^src\/core\/central\/metaEnvio\.ts$/, motivo: 'envio externo (WhatsApp)' },
  { padrao: /^src\/core\/radar\/(canais|formularioAgendado|formularioGravacao|formularioBorda|formularioReconciliacao|formularioTransporte|vibe|vibeServidor)\.ts$/, motivo: 'envio, reconciliação, gravação com chave de serviço ou créditos pagos' },
  { padrao: /^src\/core\/.*(Servidor|Porta|Llm)\.ts$/, motivo: 'servidor, porta com chave de serviço ou modelo de IA' },
  { padrao: /^src\/ui\/Paleta\.tsx$/, motivo: 'rotas do menu com a permissão de cada uma' },
]

/** VERDE: não chega ao bundle, às funções nem ao banco. */
const VERDES: RegExp[] = [
  /^docs\/.*\.md$/,
  /^[^/]+\.md$/, // README e planos na raiz (CLAUDE.md é exceção nominal)
]

/** AMARELO: código do app que muda o que a tela mostra, sem servidor, banco, credencial nem build. */
const AMARELOS: RegExp[] = [
  /^src\/screens\/.*\.(tsx?|css)$/,
  /^src\/ui\/.*\.(tsx?|css)$/,
  /^src\/styles\.css$/,
  /^src\/core\/.*\.ts$/, // regra pura; as exceções perigosas estão em VERMELHOS_NOMINAIS
  /^src\/.*\.test\.ts$/, // teste novo ou alterado: a revisão confere que nenhuma guarda foi enfraquecida
  /^src\/.*\/__fixtures__\//,
  /^docs\/propostas\/.*\.sql$/, // proposta fora de supabase/migrations: não roda em produção
]

export interface ClasseArquivo { arquivo: string; status: StatusGit; classe: Classe; motivo: string }

export function classeDoArquivo(arquivo: string, status: StatusGit = 'M'): ClasseArquivo {
  const p = arquivo.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  const nominal = VERMELHOS_NOMINAIS.find((r) => r.padrao.test(p))
  if (nominal) return { arquivo: p, status, classe: 'VERMELHO', motivo: nominal.motivo }
  if (status === 'D' && /\.test\.ts$/.test(p)) return { arquivo: p, status, classe: 'VERMELHO', motivo: 'teste apagado (pode ser uma guarda)' }
  if (VERDES.some((r) => r.test(p))) {
    return status === 'D'
      ? { arquivo: p, status, classe: 'AMARELO', motivo: 'documento apagado' }
      : { arquivo: p, status, classe: 'VERDE', motivo: 'documentação' }
  }
  if (AMARELOS.some((r) => r.test(p))) return { arquivo: p, status, classe: 'AMARELO', motivo: 'código do app: muda comportamento visível' }
  return { arquivo: p, status, classe: 'VERMELHO', motivo: 'fora das listas VERDE e AMARELA (negação por padrão)' }
}

export interface ClasseDoConjunto { classe: Classe; arquivos: ClasseArquivo[] }

/** Classe de um diff inteiro: a maior entre os arquivos. Diff vazio é VERDE (nada a publicar). */
export function classeDoConjunto(mudancas: Array<{ arquivo: string; status?: StatusGit }>): ClasseDoConjunto {
  const lidos = mudancas.filter((m) => m.arquivo.trim() !== '').map((m) => classeDoArquivo(m.arquivo, m.status ?? 'M'))
  return { classe: lidos.reduce<Classe>((c, a) => maiorClasse(c, a.classe), 'VERDE'), arquivos: lidos }
}

/**
 * Lê a saída de `git diff --name-status --no-renames -z`: pares status\0caminho\0. Status desconhecido (C, R, U, X)
 * vira 'T' e o caminho cai nas regras normais; o script nunca pede renomeação, então R não deveria aparecer.
 */
export function lerNameStatusZ(saida: string): Array<{ arquivo: string; status: StatusGit }> {
  const partes = saida.split('\0').filter((x) => x !== '')
  const r: Array<{ arquivo: string; status: StatusGit }> = []
  for (let i = 0; i + 1 < partes.length; i += 2) {
    const s = partes[i].trim().charAt(0)
    r.push({ arquivo: partes[i + 1], status: s === 'A' || s === 'M' || s === 'D' ? s : 'T' })
  }
  return r
}

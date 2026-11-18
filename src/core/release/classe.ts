/**
 * Classe mínima de release por arquivo (docs/politica-releases.md, seção 2).
 *
 * NEGAÇÃO POR PADRÃO, com listas permitidas CURTAS. Duas revisões independentes (18/11/2026) mostraram que qualquer
 * lista de caminhos perigosos esquece algum, e que `src/core` não é "regra pura": metade dele é alcançada pelas funções
 * Netlify e roda com chave de serviço. Então:
 * - VERDE: só documentação de leitura em `docs/*.md` (um nível) e `.md` da raiz, menos as exceções nominais;
 * - AMARELO: só telas e componentes (`src/screens`, `src/ui`), a regra pura da Central Comercial e testes/fixtures
 *   DESSES arquivos; o teste herda a classe do arquivo que testa;
 * - VERMELHO: todo o resto, inclusive todo `src/core` e `src/data`, e qualquer caminho fora do formato canônico.
 * Toda comparação é feita em minúsculas (no Windows `CLAUDE.md` e `claude.md` são o mesmo arquivo).
 *
 * É um PISO, não um veredito: nunca rebaixa a classe declarada pelo orquestrador, só a sobe. A revisão independente
 * continua sendo a única barreira para efeito financeiro ou vazamento dentro de uma tela AMARELA.
 */
export type Classe = 'VERDE' | 'AMARELO' | 'VERMELHO'
/** Status do git com renomeação desligada: A adicionado, M modificado, D apagado, T tipo mudou. */
export type StatusGit = 'A' | 'M' | 'D' | 'T'

const ORDEM: Record<Classe, number> = { VERDE: 0, AMARELO: 1, VERMELHO: 2 }
export const maiorClasse = (a: Classe, b: Classe): Classe => (ORDEM[a] >= ORDEM[b] ? a : b)

/** Exceções VERMELHAS dentro das listas permitidas (comparadas em minúsculas). */
export const VERMELHOS_NOMINAIS: ReadonlyArray<{ padrao: RegExp; motivo: string }> = [
  { padrao: /(^|\/)(claude|agents|gemini)(\.local)?\.md$/, motivo: 'instruções dos agentes' },
  { padrao: /^docs\/politica-releases\.md$/, motivo: 'a própria política de releases' },
  { padrao: /^docs\/(formulario-site-(go2-go3|ativacao|checkpoint)|publicacao-automatica|implantacao-supabase|fin-reset[^/]*|ci-release-gate|central-db-release|eiff-inbox|widgets-ipad|email-comercial[^/]*)\.md$/, motivo: 'documento operacional (estado ligado/desligado ou runbook)' },
  { padrao: /^src\/ui\/paleta(\.test)?\.tsx?$/, motivo: 'rotas do menu com a permissão de cada uma' },
  { padrao: /^src\/screens\/(usuarios|widgetsipad)[^/]*\.tsx?$/, motivo: 'tela que mostra senha inicial ou token (e seus testes)' },
]

const VERDES: RegExp[] = [/^docs\/[^/]+\.md$/, /^docs\/propostas\/[^/]+\.md$/, /^[^/]+\.md$/]

/** Pastas e arquivos AMARELOS. A regra pura da Central Comercial entra porque nenhuma função Netlify a importa (teste). */
const AMARELOS: RegExp[] = [
  /^src\/screens\/(.+\/)?[^/]+\.(tsx|ts|css)$/,
  /^src\/ui\/(.+\/)?[^/]+\.(tsx|ts|css)$/,
  /^src\/styles\.css$/,
  /^src\/core\/comercial\/[^/]+\.tsx?$/,
  /^docs\/propostas\/[^/]+\.sql$/,
]

const FIXTURE = /^src\/(core\/comercial|screens|ui)\/(.+\/)?__fixtures__\/[^/]+\.json$/

/** Caminho fora do formato canônico nunca é classificado como permitido. */
export function caminhoCanonico(p: string): boolean {
  return p !== '' && p === p.trim() && !p.includes('\\') && ![...p].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) && !p.startsWith('/') &&
    !p.split('/').some((s) => s === '' || s === '.' || s === '..') && p === p.normalize('NFC')
}

export interface ClasseArquivo { arquivo: string; status: StatusGit; classe: Classe; motivo: string }

const resultado = (arquivo: string, status: StatusGit, classe: Classe, motivo: string): ClasseArquivo => ({ arquivo, status, classe, motivo })

export function classeDoArquivo(arquivo: string, status: StatusGit = 'M'): ClasseArquivo {
  if (!caminhoCanonico(arquivo)) return resultado(arquivo, status, 'VERMELHO', 'caminho fora do formato canônico')
  if (status === 'T') return resultado(arquivo, status, 'VERMELHO', 'mudança de tipo (link simbólico ou submódulo)')
  const p = arquivo.toLowerCase()
  const nominal = VERMELHOS_NOMINAIS.find((r) => r.padrao.test(p))
  if (nominal) return resultado(arquivo, status, 'VERMELHO', nominal.motivo)
  if (/\.d\.ts$/.test(p)) return resultado(arquivo, status, 'VERMELHO', 'declaração de tipos (pode afrouxar guarda)')
  const teste = p.match(/^(.*)\.test\.tsx?$/)
  if (teste) {
    if (status === 'D') return resultado(arquivo, status, 'VERMELHO', 'teste apagado (pode ser uma guarda)')
    const tronco = arquivo.slice(0, teste[1].length)
    const alvos = [classeDoArquivo(`${tronco}.ts`, 'M'), classeDoArquivo(`${tronco}.tsx`, 'M')]
    return alvos.some((a) => a.classe === 'VERMELHO')
      ? resultado(arquivo, status, 'VERMELHO', 'teste de arquivo VERMELHO (guarda)')
      : resultado(arquivo, status, 'AMARELO', 'teste de arquivo AMARELO')
  }
  if (FIXTURE.test(p)) return resultado(arquivo, status, status === 'D' ? 'VERMELHO' : 'AMARELO', status === 'D' ? 'fixture apagada' : 'fixture de tela ou da Central')
  if (VERDES.some((r) => r.test(p))) {
    return status === 'D' ? resultado(arquivo, status, 'AMARELO', 'documento apagado') : resultado(arquivo, status, 'VERDE', 'documentação')
  }
  if (AMARELOS.some((r) => r.test(p))) return resultado(arquivo, status, 'AMARELO', 'tela, componente ou regra pura da Central')
  return resultado(arquivo, status, 'VERMELHO', 'fora das listas VERDE e AMARELA (negação por padrão)')
}

export interface ClasseDoConjunto { classe: Classe; arquivos: ClasseArquivo[]; colisoes: string[] }

export interface ContextoConjunto {
  /** Todos os caminhos da árvore candidata (para colisão de caixa). */
  arvore?: string[]
  /** Documentos citados pelas instruções dos agentes (CLAUDE.md da BASE): seguem-se como regra, então são VERMELHOS. */
  docsCitados?: string[]
  /** Para cada teste alterado, os módulos locais que ele importa: o teste vale a maior classe entre eles. */
  importsDosTestes?: Record<string, string[]>
  /** Testes cuja versão da base OU do candidato usa forma de import que foge da análise: VERMELHOS. */
  testesSuspeitos?: string[]
}

/**
 * Forma de import que a análise estática não segue: `vi.importActual/importMock/mock/doMock`, `import()` não literal,
 * `require(`, especificador absoluto (`/src/...`) ou de alias (`@/`, `~/`, `src/`). Teste assim vale VERMELHO.
 */
export function testeComImportOpaco(texto: string): boolean {
  if (/\bvi\s*\.\s*(importActual|importMock|mock|doMock)\s*\(/.test(texto)) return true
  if (/\bimport\s*\(\s*[^'"\s)]/.test(texto) || /\brequire\s*\(/.test(texto)) return true
  for (const m of texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const e = m[1]
    if (e.startsWith('/') || e.startsWith('@/') || e.startsWith('~/') || e.startsWith('src/')) return true
  }
  return false
}

/** Especificadores relativos (`./`, `../`) de um texto de teste. */
export function importsRelativos(texto: string): string[] {
  return [...texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
}

/** Caminhos `docs/....md` citados num texto de instruções. */
export function docsCitadosEm(texto: string): string[] {
  return [...new Set([...texto.matchAll(/docs\/[\w./-]+\.md/g)].map((m) => m[0].toLowerCase()))]
}

/**
 * Classe de um diff inteiro: a maior entre os arquivos. `arvore` (todos os caminhos do candidato) permite recusar
 * colisão de maiúsculas/minúsculas: no Windows dois caminhos que só diferem na caixa viram o mesmo arquivo.
 */
export function classeDoConjunto(mudancas: Array<{ arquivo: string; status?: StatusGit }>, ctx: ContextoConjunto = {}): ClasseDoConjunto {
  const arvore = ctx.arvore ?? []
  const citados = new Set((ctx.docsCitados ?? []).map((d) => d.toLowerCase()))
  const lidos = mudancas.map((m) => {
    const c = classeDoArquivo(m.arquivo, m.status ?? 'M')
    if (c.classe !== 'VERMELHO' && citados.has(m.arquivo.toLowerCase())) return { ...c, classe: 'VERMELHO' as Classe, motivo: 'documento citado pelas instruções dos agentes' }
    if (c.classe !== 'VERMELHO' && ctx.testesSuspeitos?.includes(m.arquivo)) return { ...c, classe: 'VERMELHO' as Classe, motivo: 'teste com import que a análise não segue (mock, dinâmico, absoluto ou alias)' }
    const imp = ctx.importsDosTestes?.[m.arquivo]
    if (c.classe !== 'VERMELHO' && imp) {
      const pior = imp.map((i) => classeDoArquivo(i, 'M')).find((x) => x.classe === 'VERMELHO')
      if (pior) return { ...c, classe: 'VERMELHO' as Classe, motivo: `teste que importa arquivo VERMELHO (${pior.arquivo})` }
    }
    return c
  })
  const porChave = new Map<string, Set<string>>()
  for (const c of arvore) { const k = c.toLowerCase().normalize('NFC'); porChave.set(k, (porChave.get(k) ?? new Set()).add(c)) }
  const colisoes = lidos.filter((a) => (porChave.get(a.arquivo.toLowerCase().normalize('NFC'))?.size ?? 0) > 1).map((a) => a.arquivo)
  const classe = colisoes.length > 0 ? 'VERMELHO' : lidos.reduce<Classe>((c, a) => maiorClasse(c, a.classe), 'VERDE')
  return { classe, arquivos: lidos, colisoes }
}

/**
 * Lê `git diff --raw -z --no-renames`: `:modoA modoB shaA shaB S\0caminho\0`. Falha fechada (lança) com qualquer
 * coisa fora desse formato. Link simbólico (120000) ou submódulo (160000) em qualquer lado vira status 'T'.
 */
export function lerRawZ(saida: string): Array<{ arquivo: string; status: StatusGit }> {
  const partes = saida.split('\0')
  if (partes[partes.length - 1] === '') partes.pop()
  if (partes.length % 2 !== 0) throw new Error('saída do git fora do formato esperado')
  const r: Array<{ arquivo: string; status: StatusGit }> = []
  for (let i = 0; i < partes.length; i += 2) {
    const m = partes[i].match(/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([AMDT])$/)
    if (!m) throw new Error(`linha do git inesperada: ${partes[i].slice(0, 40)}`)
    const especial = [m[1], m[2]].some((modo) => modo === '120000' || modo === '160000')
    r.push({ arquivo: partes[i + 1], status: especial ? 'T' : (m[3] as StatusGit) })
  }
  return r
}

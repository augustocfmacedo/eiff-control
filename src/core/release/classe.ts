/**
 * Classe mínima de release por arquivo (docs/politica-releases.md, seção 2).
 *
 * É um PISO, não um veredito: o resultado nunca rebaixa a classe declarada pelo orquestrador, só a sobe. A revisão
 * independente confere o resto (efeito financeiro, interruptor ligado, dado em produção), que nenhum padrão de
 * caminho enxerga. A classe de uma publicação é a do intervalo inteiro `publicado..candidato`.
 */
export type Classe = 'VERDE' | 'AMARELO' | 'VERMELHO'

const ORDEM: Record<Classe, number> = { VERDE: 0, AMARELO: 1, VERMELHO: 2 }

export const maiorClasse = (a: Classe, b: Classe): Classe => (ORDEM[a] >= ORDEM[b] ? a : b)

/** Caminhos que sempre exigem autorização específica da Direção. */
export const REGRAS_VERMELHAS: ReadonlyArray<{ padrao: RegExp; motivo: string }> = [
  { padrao: /^supabase\//, motivo: 'banco: migration, reversão ou configuração do Supabase' },
  { padrao: /^netlify\//, motivo: 'função Netlify (servidor, agendamento, chave de serviço)' },
  { padrao: /^netlify\.toml$/, motivo: 'configuração de build, cabeçalhos e funções do Netlify' },
  { padrao: /^\.github\//, motivo: 'CI, Quality Gate ou automação do repositório' },
  { padrao: /^package(-lock)?\.json$/, motivo: 'dependências (cadeia de suprimentos)' },
  { padrao: /^public\/sw\.js$/, motivo: 'service worker (cache e rede de todos os usuários)' },
  { padrao: /^src\/core\/permissoes\.ts$/, motivo: 'matriz de permissões' },
  { padrao: /^src\/core\/chaveServico\.ts$/, motivo: 'cabeçalhos da chave de serviço' },
  { padrao: /^src\/data\/ambiente\.ts$/, motivo: 'configuração de ambiente do app' },
  { padrao: /^src\/data\/(supabase|[^/]+\.supabase)\.ts$/, motivo: 'leitura e gravação no banco' },
  { padrao: /^src\/data\/(offline|rede)\.ts$/, motivo: 'fila offline e reenvio de gravações' },
  { padrao: /^src\/core\/.*Servidor\.ts$/, motivo: 'lógica de servidor (roda com credenciais)' },
  { padrao: /^src\/core\/.*Porta\.ts$/, motivo: 'porta de gravação com chave de serviço' },
  { padrao: /^scripts\/.*produc/i, motivo: 'script que age sobre produção' },
  { padrao: /^docs\/seguranca\/.*\.sql$/, motivo: 'consulta usada em operação de produção' },
]

const ehVerde = (p: string) =>
  (/^docs\/.*\.md$/.test(p)) ||
  (/\.md$/.test(p) && !p.includes('/')) ||
  /\.test\.tsx?$/.test(p) ||
  /\/__fixtures__\//.test(p) ||
  /^docs\/propostas\//.test(p) // proposta fora de supabase/migrations não é aplicada por nada

export interface ClasseArquivo { arquivo: string; classe: Classe; motivo: string }

export function classeDoArquivo(arquivo: string): ClasseArquivo {
  const p = arquivo.replace(/\\/g, '/').replace(/^\.\//, '')
  const vermelha = REGRAS_VERMELHAS.find((r) => r.padrao.test(p))
  if (vermelha) return { arquivo: p, classe: 'VERMELHO', motivo: vermelha.motivo }
  if (ehVerde(p)) return { arquivo: p, classe: 'VERDE', motivo: 'documentação, teste ou proposta não aplicada' }
  return { arquivo: p, classe: 'AMARELO', motivo: 'código do app: muda comportamento visível' }
}

export interface ClasseDoConjunto { classe: Classe; arquivos: ClasseArquivo[] }

/** Classe de um diff inteiro: a maior entre os arquivos. Diff vazio é VERDE (nada a publicar). */
export function classeDoConjunto(arquivos: string[]): ClasseDoConjunto {
  const lidos = arquivos.filter((a) => a.trim() !== '').map(classeDoArquivo)
  return { classe: lidos.reduce<Classe>((c, a) => maiorClasse(c, a.classe), 'VERDE'), arquivos: lidos }
}

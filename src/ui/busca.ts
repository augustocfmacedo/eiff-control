// Busca da paleta de comandos e ordenacao da Tabela: funcoes puras, sem React.

export const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/** Pontua um texto contra a consulta: todos os termos precisam aparecer; termos no inicio de palavra valem mais; -1 = nao casa. */
export function pontuar(texto: string, consulta: string): number {
  const t = normalizar(texto); const termos = normalizar(consulta).split(' ').filter(Boolean);
  if (!termos.length) return 0;
  let pontos = 0;
  for (const termo of termos) {
    const i = t.indexOf(termo);
    if (i < 0) return -1;
    const inicioPalavra = i === 0 || t[i - 1] === ' ' || t[i - 1] === '-' || t[i - 1] === '/';
    pontos += (inicioPalavra ? 30 : 10) + Math.max(0, 20 - i) + (t.length === termo.length ? 25 : 0);
  }
  return pontos;
}

export interface Buscavel { chaveBusca: string }
/** Filtra e ordena por pontuacao (estavel: empate mantem a ordem original). */
export function buscar<T extends Buscavel>(itens: T[], consulta: string, limite = 8): T[] {
  if (!normalizar(consulta)) return itens.slice(0, limite);
  return itens.map((item, i) => ({ item, i, p: pontuar(item.chaveBusca, consulta) })).filter((x) => x.p >= 0).sort((a, b) => b.p - a.p || a.i - b.i).slice(0, limite).map((x) => x.item);
}

/** Ordena linhas por uma chave (string ou numero), estavel, com undefined sempre no fim. */
export function ordenarLinhas<T>(linhas: T[], chave: ((l: T) => string | number | undefined) | undefined, desc = false): T[] {
  if (!chave) return linhas;
  const cmp = (a: string | number | undefined, b: string | number | undefined) => {
    if (a === undefined || a === '') return b === undefined || b === '' ? 0 : 1;
    if (b === undefined || b === '') return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  };
  return linhas.map((l, i) => ({ l, i, k: chave(l) })).sort((x, y) => { const c = cmp(x.k, y.k); return (c === 0 ? x.i - y.i : desc && x.k !== undefined && y.k !== undefined ? -c : c); }).map((x) => x.l);
}

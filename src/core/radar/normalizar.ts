// Normalizacao e deduplicacao de empresas: CNPJ, dominio, razao social e localizacao; matching aproximado.
import type { Empresa } from './types';

export const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Só dígitos; retorna undefined se não tiver 14 dígitos válidos. */
export function normalizarCnpj(v?: string | null): string | undefined {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return undefined;
  return cnpjValido(d) ? d : undefined;
}

export function cnpjValido(d: string): boolean {
  const calc = (base: string, pesos: number[]) => { const s = base.split('').reduce((a, c, i) => a + Number(c) * pesos[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return calc(d.slice(0, 12), p1) === Number(d[12]) && calc(d.slice(0, 13), p2) === Number(d[13]);
}

export const formatarCnpj = (d?: string) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d ?? '');

/** Dominio a partir de site/e-mail/url: minusculo, sem protocolo, www e caminho. Ignora provedores genericos de e-mail. */
const GENERICOS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'icloud.com', 'live.com', 'globo.com', 'ig.com.br']);
export function normalizarDominio(v?: string | null): string | undefined {
  let s = (v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s.includes('@')) s = s.split('@')[1];
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) || GENERICOS.has(s)) return undefined;
  return s;
}

const SUFIXOS = /\b(ltda|limitada|s\.?a\.?|sa|me|epp|eireli|mei|cia|companhia|comercio|comercial|industria|industrial|servicos|engenharia|construcoes|construtora|incorporadora|participacoes|holding|do brasil|brasil)\b/g;
/** Razao social comparavel: sem acento, minuscula, sem pontuacao nem sufixos societarios/genericos. */
export function normalizarNome(v?: string | null): string {
  return semAcento((v ?? '').toLowerCase()).replace(/[^a-z0-9 ]+/g, ' ').replace(SUFIXOS, ' ').replace(/\b(e|de|da|do|dos|das|em)\b/g, ' ').replace(/\b[a-z]\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export const normalizarUf = (v?: string | null) => { const s = semAcento((v ?? '').trim().toUpperCase()); return /^[A-Z]{2}$/.test(s) ? s : undefined; };
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
export const normalizarCidade = (v?: string | null) => {
  const s = (v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  return s.split(' ').map((p, i) => { const w = p.toLowerCase(); return i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
};

/** Similaridade de Jaccard sobre tokens + bigramas (0-1). */
export function similaridade(a: string, b: string): number {
  const na = normalizarNome(a); const nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigramas = (s: string) => { const out = new Set<string>(); const t = s.replace(/ /g, '_'); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const A = bigramas(na); const B = bigramas(nb);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  // contencao de tokens: "beta logistica" dentro de "beta logistica transportes" e quase certamente a mesma empresa
  const ta = new Set(na.split(' ')); const tb = new Set(nb.split(' '));
  const comuns = [...ta].filter((t) => tb.has(t));
  const contencao = comuns.length && comuns.join('').length >= 5 ? (comuns.length / Math.min(ta.size, tb.size)) * 0.9 : 0;
  return Math.max(jaccard, contencao);
}

export type NivelMatch = 'certo' | 'provavel' | 'possivel';
export interface MatchEmpresa { empresa: Empresa; nivel: NivelMatch; confianca: number; motivo: string }

/**
 * Identifica uma empresa existente para os dados recebidos, na ordem: CNPJ, dominio, razao social normalizada + localizacao,
 * matching aproximado. 'certo' e 'provavel' podem atualizar a existente; 'possivel' vira possible_duplicate.
 */
export function encontrarEmpresa(dados: { cnpj?: string; dominio?: string; razaoSocial?: string; nomeFantasia?: string; cidade?: string; uf?: string }, empresas: Empresa[], limiar = 0.82): MatchEmpresa | undefined {
  const ativas = empresas.filter((e) => e.ativo && !e.mescladaEm);
  const cnpj = normalizarCnpj(dados.cnpj);
  if (cnpj) { const e = ativas.find((x) => x.cnpj === cnpj); if (e) return { empresa: e, nivel: 'certo', confianca: 1, motivo: 'CNPJ igual' }; }
  const dom = normalizarDominio(dados.dominio);
  if (dom) { const e = ativas.find((x) => x.dominio === dom); if (e) return { empresa: e, nivel: 'certo', confianca: 0.97, motivo: `domínio ${dom}` }; }
  const nome = normalizarNome(dados.razaoSocial || dados.nomeFantasia);
  if (!nome) return undefined;
  const uf = normalizarUf(dados.uf); const cidade = semAcento(normalizarCidade(dados.cidade)?.toLowerCase() ?? '');
  const mesmoNome = ativas.filter((x) => normalizarNome(x.razaoSocial) === nome || (x.nomeFantasia && normalizarNome(x.nomeFantasia) === nome));
  const local = mesmoNome.find((x) => (!uf || x.uf === uf) && (!cidade || semAcento((x.cidade ?? '').toLowerCase()) === cidade));
  if (local) return { empresa: local, nivel: 'provavel', confianca: 0.9, motivo: `razão social igual${uf ? ` em ${local.cidade ?? ''}/${uf}` : ''}` };
  if (mesmoNome.length) return { empresa: mesmoNome[0], nivel: 'possivel', confianca: 0.7, motivo: 'razão social igual em outra localização' };
  let melhor: MatchEmpresa | undefined;
  for (const x of ativas) {
    const s = Math.max(similaridade(nome, x.razaoSocial), x.nomeFantasia ? similaridade(nome, x.nomeFantasia) : 0);
    if (s >= limiar && (!melhor || s > melhor.confianca)) melhor = { empresa: x, nivel: 'possivel', confianca: Math.round(s * 100) / 100, motivo: `nome parecido (${Math.round(s * 100)}%)${uf && x.uf === uf ? ', mesma UF' : ''}` };
  }
  return melhor;
}

// Helpers puros do sistema de movimento (sem React, sem GSAP): decomposicao de numeros formatados em pt-BR para animar
// so os digitos preservando prefixo (R$), separadores e sufixo (%, kg), e a preferencia de movimento reduzido.

export interface NumeroDecomposto { prefixo: string; valor: number; decimais: number; sufixo: string; milhar: boolean }
const RE_NUMERO = /(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/;
/** Textos que nao sao quantidades (datas, horas, identificadores): nunca animar. */
export const ehTextoNaoNumerico = (texto: string) => /\d[/:-]\d/.test(texto) || /\b(?:19|20)\d{2}\b/.test(texto) && !/[R$%]/.test(texto) && !/\./.test(texto);

/** "R$ 1.234,56" -> { prefixo: "R$ ", valor: 1234.56, decimais: 2, sufixo: "", milhar: true }; null quando nao ha numero. */
export function decomporNumero(texto: string): NumeroDecomposto | null {
  const m = RE_NUMERO.exec(texto);
  if (!m) return null;
  const inteiro = m[2].replace(/\./g, ''); const dec = m[3] ?? '';
  const valor = Number(`${inteiro}${dec ? `.${dec}` : ''}`) * (m[1] === '-' ? -1 : 1);
  if (!Number.isFinite(valor)) return null;
  return { prefixo: texto.slice(0, m.index), valor, decimais: dec.length, sufixo: texto.slice(m.index + m[0].length), milhar: m[2].includes('.') };
}

/** Recompoe o texto com outro valor, mantendo prefixo/sufixo, casas decimais e agrupamento de milhar do original. */
export function recomporNumero(d: NumeroDecomposto, valor: number): string {
  const abs = Math.abs(valor);
  const s = abs.toLocaleString('pt-BR', { minimumFractionDigits: d.decimais, maximumFractionDigits: d.decimais, useGrouping: d.milhar || abs >= 1000 && d.milhar });
  return `${d.prefixo}${valor < 0 ? '-' : ''}${s}${d.sufixo}`;
}

/** Interpolacao do valor entre dois textos numericos com a mesma forma (usada pelo contador animado). */
export function textoIntermediario(de: string, para: string, t: number): string {
  const a = decomporNumero(de); const b = decomporNumero(para);
  if (!b) return para;
  const v0 = a ? a.valor : 0;
  return recomporNumero(b, v0 + (b.valor - v0) * Math.max(0, Math.min(1, t)));
}

export const reduzMovimento = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

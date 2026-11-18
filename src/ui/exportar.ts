// Exportacao CSV (pt-BR): separador ";", BOM para o Excel abrir com acentos, numeros com virgula, aspas escapadas.
//
// INJECAO DE FORMULA: Excel, LibreOffice e Google Planilhas tratam como FORMULA a celula de texto que comeca com
// "=", "+", "-" ou "@" (e com TAB ou CR, que eles descartam antes de olhar). O CSV exporta texto que veio de fora —
// nome, empresa e mensagem digitados num formulario publico —, entao um "=HYPERLINK(...)" no nome do lead viraria
// formula no computador de quem abre a planilha. Toda celula de TEXTO que comeca assim (ignorando espacos e caracteres
// de controle a esquerda) recebe um apostrofo na frente: a planilha mostra o texto como texto. Numero de verdade
// (typeof number) e texto que e so um numero com sinal ("-12,5") nao sao tocados: nao executam nada e seguem numeros.
const GATILHOS = '=+-@';
const SO_NUMERO = /^[+-]?\d[\d.,]*%?$/;
/** Primeiro caractere que a planilha vai olhar: pula espacos e caracteres de controle (codigo <= 32) a esquerda. */
function primeiroVisivel(s: string): string {
  let i = 0;
  while (i < s.length && (s.charCodeAt(i) <= 32 || /\s/.test(s[i]))) i += 1;
  return s[i] ?? '';
}

/** O texto, neutralizado se uma planilha pudesse interpreta-lo como formula. */
export const neutralizarFormula = (s: string): string => {
  const c = primeiroVisivel(s);
  return c !== '' && GATILHOS.includes(c) && !SO_NUMERO.test(s.trim()) ? `'${s}` : s;
};

export const celulaCsv = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false }) : neutralizarFormula(String(v));
  return /[";\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function montarCsv(cabecalho: string[], linhas: unknown[][]): string {
  return [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n');
}
export function baixarCsv(nome: string, cabecalho: string[], linhas: unknown[][]) {
  const blob = new Blob(['﻿', montarCsv(cabecalho, linhas)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `${nome.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

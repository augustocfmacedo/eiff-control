// Exportacao CSV (pt-BR): separador ";", BOM para o Excel abrir com acentos, numeros com virgula, aspas escapadas.
export const celulaCsv = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false }) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

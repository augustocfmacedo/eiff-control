import { describe, expect, it } from 'vitest';
import { decomporNumero, ehTextoNaoNumerico, recomporNumero, textoIntermediario } from './numero';

describe('numeros animados (pt-BR)', () => {
  it('decompõe e recompõe moeda, percentual, quantidade e negativo preservando prefixo, separadores e sufixo', () => {
    const casos: [string, number][] = [['R$ 1.234.567,89', 1234567.89], ['-R$ 1.234,56', 1234.56], ['12,5%', 12.5], ['1.500 kg', 1500], ['26', 26], ['2026', 2026], ['0,00', 0]];
    for (const [texto, valor] of casos) { const d = decomporNumero(texto)!; expect(d.valor, texto).toBe(valor); expect(recomporNumero(d, d.valor), texto).toBe(texto); }
    expect(recomporNumero(decomporNumero('R$ 1.234,56')!, 0)).toBe('R$ 0,00');
    expect(recomporNumero(decomporNumero('12 de 26')!, 3)).toBe('3 de 26');
    expect(recomporNumero(decomporNumero('2026')!, 1500)).toBe('1500'); // sem ponto no original, sem agrupamento
    expect(decomporNumero('—')).toBeNull(); expect(decomporNumero('OK')).toBeNull();
  });
  it('interpola entre textos e nunca anima datas, horas ou anos soltos', () => {
    expect(textoIntermediario('R$ 0,00', 'R$ 1.000,00', 0.5)).toBe('R$ 500,00');
    expect(textoIntermediario('10%', '20%', 0.2)).toBe('12%');
    expect(textoIntermediario('x', 'R$ 40,00', 0.5)).toBe('R$ 20,00');
    expect(textoIntermediario('R$ 40,00', 'sem número', 0.5)).toBe('sem número');
    expect(ehTextoNaoNumerico('09/09/2026')).toBe(true); expect(ehTextoNaoNumerico('14:30')).toBe(true); expect(ehTextoNaoNumerico('2026')).toBe(true);
    expect(ehTextoNaoNumerico('R$ 2.026,00')).toBe(false); expect(ehTextoNaoNumerico('12,5%')).toBe(false); expect(ehTextoNaoNumerico('26')).toBe(false);
  });
});

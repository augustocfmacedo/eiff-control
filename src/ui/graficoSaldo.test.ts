import { describe, expect, it } from 'vitest';
import { marcasEixo } from './GraficoSaldo';

describe('escala do gráfico de saldo', () => {
  it('marcas redondas cobrindo o intervalo, incluindo valores negativos', () => {
    const m = marcasEixo(0, 280000, 5);
    expect(m[0]).toBe(0); expect(m[m.length - 1]).toBeGreaterThanOrEqual(280000);
    expect(m.length).toBeGreaterThanOrEqual(4); expect(m.length).toBeLessThanOrEqual(8);
    const passo = m[1] - m[0];
    expect([50000, 100000]).toContain(passo);
    const neg = marcasEixo(-55000, 470000, 5);
    expect(neg[0]).toBeLessThanOrEqual(-55000); expect(neg).toContain(0); expect(neg[neg.length - 1]).toBeGreaterThanOrEqual(470000);
    expect(marcasEixo(10, 10)).toEqual(expect.arrayContaining([10]));
  });
});

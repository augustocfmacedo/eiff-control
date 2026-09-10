import { describe, expect, it } from 'vitest';
import { AJUSTES_ZERO, aplicarCenario, cenarioAtivo, somarDias } from './cenarioCaixa';
import { actions, getState } from '../data/store';

describe('cenários interativos de caixa (nada gravado)', () => {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  const tipoDe = new Map(ds.planoContas.map((p) => [p.categoria, p.tipo]));
  const previstos = ds.lancamentos.filter((l) => l.status !== 'Realizado' && l.status !== 'Cancelado');
  it('somarDias e cenário zero: dataset idêntico (mesmas referências dos lançamentos)', () => {
    expect(somarDias('2026-09-09', 30)).toBe('2026-10-09'); expect(somarDias('2026-12-31', 1)).toBe('2027-01-01'); expect(somarDias('', 5)).toBe('');
    const z = aplicarCenario(ds, AJUSTES_ZERO); expect(z.lancamentos).toHaveLength(ds.lancamentos.length); expect(z.lancamentos.every((l, i) => l === ds.lancamentos[i])).toBe(true); expect(cenarioAtivo(AJUSTES_ZERO)).toBe(false);
  });
  it('atraso de recebimentos move só entradas previstas; adiamento move só saídas previstas; realizados não mudam; original intacto', () => {
    const antes = JSON.stringify(ds.lancamentos);
    const c = aplicarCenario(ds, { ...AJUSTES_ZERO, atrasoRecebimentosDias: 15, adiamentoPagamentosDias: 7 });
    for (const [i, l] of ds.lancamentos.entries()) {
      const m = c.lancamentos[i]; const tipo = tipoDe.get(l.categoria); const ehPrevisto = previstos.includes(l);
      if (ehPrevisto && tipo === 'Entrada') expect(m.vencimento).toBe(somarDias(l.vencimento, 15));
      else if (ehPrevisto && tipo === 'Saída') expect(m.vencimento).toBe(somarDias(l.vencimento, 7));
      else expect(m).toBe(l);
    }
    expect(JSON.stringify(ds.lancamentos)).toBe(antes);
  });
  it('corte de despesas reduz só saídas previstas sem obra; novo contrato acrescenta parcelas de entrada programadas a partir da data-base', () => {
    const c = aplicarCenario(ds, { ...AJUSTES_ZERO, corteDespesasPct: 0.2 });
    for (const [i, l] of ds.lancamentos.entries()) { const m = c.lancamentos[i]; if (previstos.includes(l) && tipoDe.get(l.categoria) === 'Saída' && !l.codigoObra) expect(m.valorBruto).toBeCloseTo(l.valorBruto * 0.8, 2); else expect(m.valorBruto).toBe(l.valorBruto); }
    const n = aplicarCenario(ds, { ...AJUSTES_ZERO, novoContratoValor: 300000, novoContratoInicioSemanas: 2, novoContratoParcelas: 3 });
    const novos = n.lancamentos.filter((l) => l.id.startsWith('CEN-NOVO-'));
    expect(novos).toHaveLength(3); expect(novos.reduce((a, l) => a + l.valorBruto, 0)).toBeCloseTo(300000, 2);
    expect(novos[0].vencimento).toBe(somarDias(ds.params.dataBase, 14)); expect(novos[2].vencimento).toBe(somarDias(ds.params.dataBase, 14 + 60));
    expect(novos.every((l) => l.status === 'Programado' && tipoDe.get(l.categoria) === 'Entrada' && !l.codigoObra)).toBe(true);
    expect(cenarioAtivo({ ...AJUSTES_ZERO, novoContratoValor: 1 })).toBe(true);
  });
});

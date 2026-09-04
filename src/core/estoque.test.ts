import { describe, expect, it } from 'vitest';
import { consumoAco, efeitoMovimento, posicaoEstoque, rastrearConjunto, rastrearCorrida } from './estoque';
import type { ItemEstoque, MovimentoEstoque } from './types';

const item: ItemEstoque = { id: 'EST-1', codigo: 'W200X26.6', descricao: 'Perfil W 200x26,6', familia: 'Perfil laminado', estoqueMinimo: 1000, ativo: true, observacoes: '' };
const mov = (p: Partial<MovimentoEstoque>): MovimentoEstoque => ({ id: p.id ?? `MOV-${Math.random()}`, data: '2026-09-01', tipo: 'Entrada', itemId: 'EST-1', local: 'Fábrica', conjuntos: [], quantidade: 0, custoUnitario: 0, observacao: '', responsavel: 'u', criadoEm: '2026-09-01T00:00:00Z', ...p });

describe('estoque de aco', () => {
  const movs = [
    mov({ id: 'M1', data: '2026-09-01', quantidade: 6000, custoUnitario: 8, corrida: 'A1', certificado: 'C-1', fornecedor: 'Gerdau' }),
    mov({ id: 'M2', data: '2026-09-02', quantidade: 4000, custoUnitario: 10, corrida: 'B2', fornecedor: 'ArcelorMittal' }),
    mov({ id: 'M3', data: '2026-09-03', tipo: 'Consumo', quantidade: 3000, custoUnitario: 8, corrida: 'A1', codigoObra: 'OB-1', servicoId: 'S1', conjuntos: [{ conjuntoId: 'C1', quantidade: 2 }] }),
    mov({ id: 'M4', data: '2026-09-04', tipo: 'Sobra', quantidade: 200, custoUnitario: 8, corrida: 'A1', codigoObra: 'OB-1', servicoId: 'S1' }),
    mov({ id: 'M5', data: '2026-09-05', tipo: 'Consumo', quantidade: 1000, custoUnitario: 10, corrida: 'B2', codigoObra: 'OB-1', servicoId: 'S2', local: 'Fábrica' }),
    mov({ id: 'M6', data: '2026-09-06', tipo: 'Estorno', quantidade: 1000, custoUnitario: 10, corrida: 'B2', codigoObra: 'OB-1', servicoId: 'S2', origemId: 'M5', origemTipo: 'Consumo' }),
  ];
  const ds = { itensEstoque: [item], movimentosEstoque: movs, servicos: [], conjuntos: [{ id: 'C1', marca: 'P-01' }] } as never;

  it('efeito, saldo por lote e custo medio movel', () => {
    expect(efeitoMovimento(mov({ tipo: 'Consumo', quantidade: 5 }))).toBe(-5);
    expect(efeitoMovimento(mov({ tipo: 'Estorno', quantidade: -5 }))).toBe(-5);
    const p = posicaoEstoque(ds);
    const i = p.itens[0];
    expect(i.entradas).toBe(10000);
    expect(i.consumos).toBe(3000); // 3000 + 1000 - 1000 estornado
    expect(i.sobras).toBe(200);
    expect(i.saldo).toBe(7200);
    expect(i.saldoFabrica).toBe(7200);
    expect(i.abaixoMinimo).toBe(false);
    const a1 = i.lotes.find((l) => l.corrida === 'A1')!;
    expect(a1.saldo).toBe(3200);
    expect(a1.certificado).toBe('C-1');
    expect(a1.custoMedio).toBeCloseTo(8, 6);
    // custo medio do item: 6000@8 + 4000@10 = 8,8; consumos nao alteram; sobra a 8 e estorno a 10 reponderam
    expect(i.custoMedio).toBeGreaterThan(8.5);
    expect(i.custoMedio).toBeLessThan(9);
    expect(p.valor).toBeCloseTo(i.saldo * i.custoMedio, 6);
    expect(p.lotes).toBe(2);
    expect(posicaoEstoque(ds, '2026-09-02').saldoKg).toBe(10000);
  });

  it('consumo por obra e servico com custo real; estorno reverte', () => {
    const c = consumoAco(ds, { codigoObra: 'OB-1' });
    expect(c.total.consumidoKg).toBe(3000);
    expect(c.total.sobraKg).toBe(200);
    expect(c.total.liquidoKg).toBe(2800);
    expect(c.total.custo).toBeCloseTo(3000 * 8 - 200 * 8, 6);
    expect(c.total.custoPorKg).toBeCloseTo(8, 6);
    const s2 = c.porServico.find((x) => x.chave === 'S2')!;
    expect(s2.liquidoKg).toBe(0);
    expect(s2.custo).toBeCloseTo(0, 6);
    expect(consumoAco(ds, { codigoObra: 'OB-9' }).total.movimentos).toBe(0);
  });

  it('rastreabilidade corrida -> conjuntos e conjunto -> corridas', () => {
    const r = rastrearCorrida(ds, 'a1')!;
    expect(r.kgEntrado).toBe(6000);
    expect(r.kgConsumido).toBe(3000);
    expect(r.kgSaldo).toBe(3200);
    expect(r.obras).toEqual(['OB-1']);
    expect(r.consumos[0].marcas).toEqual([{ marca: 'P-01', quantidade: 2 }]);
    expect(rastrearCorrida(ds, 'ZZ')).toBeUndefined();
    const cj = rastrearConjunto(ds, 'C1');
    expect(cj).toHaveLength(1);
    expect(cj[0]).toMatchObject({ corrida: 'A1', certificado: 'C-1', fornecedor: 'Gerdau', kg: 3000, quantidade: 2 });
  });
});

// Jornada: cadastrar perfil -> entrada com corrida -> consumo no corte por obra/conjunto -> sobra -> estorno -> custo por servico na Obra 360.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { posicaoEstoque } from '../core/estoque';
import { obra360 } from '../core/engine';

describe('estoque de aco', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  let p01 = '';

  it('cadastra item e recusa duplicado', () => {
    const i = actions.salvarItemEstoque({ ...actions.novoItemEstoque(), codigo: 'w200x26.6', descricao: 'Perfil W 200x26,6', familia: 'Perfil laminado', estoqueMinimo: 500 });
    expect(i.codigo).toBe('W200X26.6');
    expect(() => actions.salvarItemEstoque({ ...actions.novoItemEstoque(), codigo: 'W200X26.6', descricao: 'dup' })).toThrow(/Já existe/);
    actions.salvarItemEstoque({ ...actions.novoItemEstoque(), codigo: 'ELETRODO-7018', descricao: 'Eletrodo E7018', familia: 'Consumível' });
    const srv = getState().ds.servicos[0];
    actions.importarConjuntos([{ marca: 'P-01', descricao: 'Pilar', tipo: 'Pilar', quantidade: 4, pesoUnitario: 500 }], 'OB-SF-CL-01', srv.id);
    p01 = getState().ds.conjuntos.find((c) => c.marca === 'P-01')!.id;
  });

  it('entrada de aco exige corrida; consumivel nao', () => {
    const w = getState().ds.itensEstoque.find((i) => i.codigo === 'W200X26.6')!;
    const e = getState().ds.itensEstoque.find((i) => i.codigo === 'ELETRODO-7018')!;
    expect(() => actions.registrarMovimento({ ...actions.novoMovimentoEstoque(), itemId: w.id, quantidade: 1000, custoUnitario: 8 })).toThrow(/corrida/);
    actions.registrarMovimento({ ...actions.novoMovimentoEstoque(), data: '2026-09-01', itemId: w.id, quantidade: 6000, custoUnitario: 8, corrida: ' a1 ', certificado: 'CQ-1', fornecedor: 'Gerdau', notaFiscal: '123' });
    actions.registrarMovimento({ ...actions.novoMovimentoEstoque(), data: '2026-09-02', itemId: w.id, quantidade: 4000, custoUnitario: 10, corrida: 'B2', fornecedor: 'Arcelor' });
    actions.registrarMovimento({ ...actions.novoMovimentoEstoque(), data: '2026-09-02', itemId: e.id, quantidade: 50, custoUnitario: 30 });
    const pos = posicaoEstoque(getState().ds);
    expect(pos.saldoKg).toBe(10050);
    const iw = pos.itens.find((i) => i.id === w.id)!;
    expect(iw.lotes.map((l) => l.corrida).sort()).toEqual(['A1', 'B2']);
    expect(iw.custoMedio).toBeCloseTo(8.8, 6);
  });

  it('consumo por lote nao excede o saldo, recebe o custo do lote e liga aos conjuntos', () => {
    const w = getState().ds.itensEstoque.find((i) => i.codigo === 'W200X26.6')!;
    const srv = getState().ds.servicos[0];
    expect(() => actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Consumo' }), itemId: w.id, quantidade: 100 })).toThrow(/obra/);
    expect(() => actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Consumo' }), itemId: w.id, codigoObra: 'OB-SF-CL-01', corrida: 'A1', quantidade: 7000 })).toThrow(/insuficiente/);
    expect(() => actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Consumo' }), itemId: w.id, codigoObra: 'OB-SF-CL-01', corrida: 'A1', local: 'Obra', quantidade: 10 })).toThrow(/insuficiente/);
    const c = actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Consumo' }), data: '2026-09-03', itemId: w.id, codigoObra: 'OB-SF-CL-01', servicoId: srv.id, corrida: 'A1', quantidade: 3000, conjuntos: [{ conjuntoId: p01, quantidade: 2 }] });
    expect(c.custoUnitario).toBeCloseTo(8, 6); // custo do lote A1, nao a media do item
    const s = actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Sobra' }), data: '2026-09-04', itemId: w.id, codigoObra: 'OB-SF-CL-01', servicoId: srv.id, corrida: 'A1', quantidade: 200 });
    expect(s.custoUnitario).toBeCloseTo(8, 6);
    const o = obra360(getState().ds, getState().ds.obras[0]);
    expect(o.aco.liquidoKg).toBe(2800);
    expect(o.aco.custo).toBeCloseTo(2800 * 8, 6);
    expect(o.aco.custoPorKg).toBeCloseTo(8, 6);
    expect(() => actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Ajuste' }), itemId: w.id, quantidade: -50 })).toThrow(RegraDeNegocioError);
    actions.registrarMovimento({ ...actions.novoMovimentoEstoque({ tipo: 'Ajuste' }), itemId: w.id, quantidade: -50, observacao: 'inventário' });
    expect(posicaoEstoque(getState().ds).itens.find((i) => i.id === w.id)!.saldo).toBe(7150);
  });

  it('estorno cria o inverso e nao apaga; entrada consumida nao estorna', () => {
    const ds = getState().ds;
    const consumo = ds.movimentosEstoque.find((m) => m.tipo === 'Consumo')!;
    const entradaA1 = ds.movimentosEstoque.find((m) => m.tipo === 'Entrada' && m.corrida === 'A1')!;
    expect(() => actions.estornarMovimento(entradaA1.id, 'erro')).toThrow(/consumido/);
    expect(() => actions.estornarMovimento(consumo.id, '')).toThrow(/Motivo/);
    const e = actions.estornarMovimento(consumo.id, 'plano de corte errado');
    expect(e.tipo).toBe('Estorno');
    expect(e.quantidade).toBe(3000);
    expect(e.origemTipo).toBe('Consumo');
    expect(() => actions.estornarMovimento(consumo.id, 'de novo')).toThrow(/já estornado/);
    expect(getState().ds.movimentosEstoque.length).toBe(ds.movimentosEstoque.length + 1);
    const o = obra360(getState().ds, getState().ds.obras[0]);
    expect(o.aco.consumidoKg).toBe(0);
    expect(o.aco.sobraKg).toBe(200);
    const pos = posicaoEstoque(getState().ds);
    expect(pos.itens.find((i) => i.codigo === 'W200X26.6')!.lotes.find((l) => l.corrida === 'A1')!.saldo).toBe(6200);
  });
});

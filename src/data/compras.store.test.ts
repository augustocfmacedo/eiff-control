// Jornada de suprimentos: pedido -> emissao (lancamento comprometido com servico e faturamento direto) -> recebimento
// (preco do insumo atualizado) -> cancelamento (lancamento cancelado junto); comparativo orcado x comprado.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { comparativoOrcadoComprado, resumoCompras } from '../core/compras';
import { calcLancamento, obra360 } from '../core/engine';

describe('pedidos de compra', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  let pedidoId = '';
  let insumoId = '';

  it('rascunho exige obra, fornecedor e itens validos', () => {
    const p = actions.novoPedido('OB-SF-CL-01');
    expect(() => actions.salvarPedido({ ...p, fornecedor: '' })).toThrow(RegraDeNegocioError);
    expect(() => actions.salvarPedido({ ...p, fornecedor: 'Gerdau', codigoObra: 'OB-X' })).toThrow(/obra/);
    expect(() => actions.salvarPedido({ ...p, fornecedor: 'Gerdau', itens: [{ id: 'a', descricao: '', unidade: 'kg', quantidade: 1, precoUnitario: 1, quantidadeRecebida: 0 }] })).toThrow(/descrição/);
  });

  it('emitir gera lancamento programado com servico, faturamento direto e vencimento = data + prazo', () => {
    const insumo = actions.salvarInsumo({ ...actions.novoInsumo(), codigo: 'ACO-W', descricao: 'Perfil W', unidade: 'kg', preco: 8.5 });
    insumoId = insumo.id;
    const servico = getState().ds.servicos[0];
    const p = actions.salvarPedido({ ...actions.novoPedido('OB-SF-CL-01'), fornecedor: 'Gerdau', servicoId: servico.id, data: '2026-09-05', prazoPagamentoDias: 30, faturamentoDireto: true, itens: [
      { id: 'a', insumoId: insumo.id, descricao: 'Perfil W 200x15', unidade: 'kg', quantidade: 1000, precoUnitario: 9, quantidadeRecebida: 0 },
      { id: 'b', descricao: 'Frete', unidade: 'vb', quantidade: 1, precoUnitario: 500, quantidadeRecebida: 0 },
    ] });
    pedidoId = p.id;
    expect(p.status).toBe('Rascunho');
    const r = actions.emitirPedido(p.id);
    expect(r.pedido.status).toBe('Emitido');
    expect(r.lancamento.valorBruto).toBe(9500);
    expect(r.lancamento.vencimento).toBe('2026-10-05');
    expect(r.lancamento.servicoId).toBe(servico.id);
    expect(r.lancamento.faturamentoDireto).toBe(true);
    expect(r.lancamento.origem).toBe('pedido');
    const ds = getState().ds;
    const c = calcLancamento(r.lancamento, ds);
    expect(c.valorCaixaProjetado).toBe(0); // direto: fora do caixa
    const o = obra360(ds, ds.obras[0]);
    expect(o.custoComprometidoDireto).toBeCloseTo(9500, 2);
    expect(resumoCompras(ds, 'OB-SF-CL-01').emitido).toBeCloseTo(9500, 2);
    expect(() => actions.emitirPedido(p.id)).toThrow(/rascunhos/);
    expect(() => actions.salvarPedido({ ...r.pedido, itens: r.pedido.itens.slice(1) })).toThrow(/emitido/);
  });

  it('recebimento parcial e total atualiza status e o preco do insumo no catalogo', () => {
    const r1 = actions.receberPedido(pedidoId, { data: '2026-09-10', quantidades: { a: 400 }, atualizarPrecos: true });
    expect(r1.pedido.status).toBe('Recebido parcial');
    expect(r1.precosAtualizados).toBe(1);
    const insumo = getState().ds.insumos.find((i) => i.id === insumoId)!;
    expect(insumo.preco).toBe(9);
    expect(insumo.precoFonte).toContain('Gerdau');
    const r2 = actions.receberPedido(pedidoId, { data: '2026-09-20', quantidades: { a: 600, b: 1 }, atualizarPrecos: false });
    expect(r2.pedido.status).toBe('Recebido');
    expect(() => actions.cancelarPedido(pedidoId, 'x')).toThrow(/recebido/i);
  });

  it('cancelar pedido emitido cancela o lancamento; comparativo orcado x comprado usa a explosao do orcamento', () => {
    const comp = actions.salvarComposicao({ ...actions.novaComposicao(), codigo: 'EIFF-T', descricao: 'Estrutura por kg', unidade: 'kg', itens: [{ tipo: 'Insumo', refId: insumoId, coeficiente: 1.05 }] });
    const orc = actions.salvarOrcamento({ ...actions.novoOrcamento(), titulo: 'Executivo', itens: [{ id: 'i', ordem: 1, etapa: 'Fabricação', codigo: '1', descricao: 'Estrutura', unidade: 'kg', quantidade: 10000, composicaoId: comp.id }] });
    // contrata em outra obra? nao: marca como contratado na propria obra via contratarOrcamento
    const ct = actions.contratarOrcamento(orc.id, { codigoObra: 'OB-SF-CL-01', ajustarAoContrato: false });
    expect(ct.orcamento.status).toBe('Contratado');
    const p2 = actions.salvarPedido({ ...actions.novoPedido('OB-SF-CL-01'), fornecedor: 'ArcelorMittal', itens: [{ id: 'c', insumoId, descricao: 'Perfil', unidade: 'kg', quantidade: 2000, precoUnitario: 9.9, quantidadeRecebida: 0 }] });
    const e = actions.emitirPedido(p2.id);
    const cmp = comparativoOrcadoComprado(getState().ds, 'OB-SF-CL-01');
    const linha = cmp.linhas.find((l) => l.insumoId === insumoId)!;
    expect(linha.orcadoQtd).toBeCloseTo(10500, 4);
    expect(linha.compradoQtd).toBeCloseTo(3000, 4); // 1000 do primeiro pedido + 2000
    expect(linha.precoMedio).toBeCloseTo((9000 + 19800) / 3000, 6);
    expect(cmp.compradoForaOrcamento).toBe(500); // frete sem insumo
    actions.cancelarPedido(p2.id, 'Cotação melhor');
    const ds = getState().ds;
    expect(ds.pedidos.find((x) => x.id === p2.id)!.status).toBe('Cancelado');
    expect(ds.lancamentos.find((l) => l.id === e.lancamento.id)!.status).toBe('Cancelado');
    expect(comparativoOrcadoComprado(ds, 'OB-SF-CL-01').linhas.find((l) => l.insumoId === insumoId)!.compradoQtd).toBeCloseTo(1000, 4);
  });
});

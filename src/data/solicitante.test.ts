import { describe, expect, it } from 'vitest';
import { datasetSolicitante, lancamentoDoPedido, type ContextoSolicitante, type PedidoSolicitante } from './solicitante';
import { meusPedidosDF, statusPedidoDF } from '../core/cfo';
import { MATRIZ, pode, type Acao } from '../core/permissoes';
import { actions, getState } from './store';

const ctx: ContextoSolicitante = {
  perfil: { id: 'p-1', nome: 'Equipe Um', email: 'um@eiff', papel: 'Solicitante' }, organizacao: 'org',
  categorias: [{ categoria: 'Outros pagamentos', grupoFluxo: 'Outras Saídas' }, { categoria: 'Outros custos diretos', grupoFluxo: 'Custos Diretos de Obras' }],
  obras: [{ codigo: 'OB-1', nome: 'Obra Um' }],
};
const pedido = (x: Partial<PedidoSolicitante>): PedidoSolicitante => ({ codigo: 'PED-0001', descricao: 'Frete', contraparte: 'Transportadora', categoria: 'Outros pagamentos', codigoObra: null, valor: 500, vencimento: '2026-10-20', status: 'Rascunho', motivoCancelamento: null, excluido: false, reagendado: false, criadoEm: '2026-10-13T10:00:00Z', atualizadoEm: '2026-10-13T10:00:00Z', ...x });

describe('perfil Solicitante: dados mínimos e só pedir pagamento', () => {
  it('o dataset do Solicitante tem só o catálogo do pedido e os pedidos dele — nenhum saldo, conta, extrato ou cadastro', () => {
    const { ds, usuario } = datasetSolicitante(ctx, [pedido({}), pedido({ codigo: 'PED-0002', status: 'Cancelado', motivoCancelamento: 'sem caixa' })], '2026-10-13');
    expect(usuario).toMatchObject({ id: 'p-1', papel: 'Solicitante', obras: [] });
    expect(ds.usuarios).toEqual([usuario]);
    expect(ds.planoContas.map((p) => p.categoria)).toEqual(['Outros pagamentos', 'Outros custos diretos']);
    expect(ds.obras.map((o) => [o.codigo, o.nome])).toEqual([['OB-1', 'Obra Um']]);
    expect(ds.lancamentos.map((l) => l.id)).toEqual(['PED-0001', 'PED-0002']);
    for (const k of ['contas', 'transacoes', 'liquidacoes', 'aprovacoes', 'medicoes', 'colaboradores', 'pedidos', 'dividas', 'auditoria'] as const) expect((ds as unknown as Record<string, unknown[]>)[k] ?? [], k).toEqual([]);
    expect(ds.radar?.empresas ?? []).toEqual([]);
    expect(ds.params).toMatchObject({ dataBase: '2026-10-13', dataBaseAutomatica: false, reservaMinima: 0 });
    // nada da semente vaza pelo molde da obra
    expect(Object.values(ds.obras[0]).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
  });
  it('o pedido do banco vira lançamento do Diretor Financeiro com o andamento certo', () => {
    const u = { id: 'p-1', nome: 'Equipe Um', email: '', papel: 'Solicitante' as const, obras: [] as string[], ativo: true };
    const ds = datasetSolicitante(ctx, [pedido({}), pedido({ codigo: 'PED-0002', reagendado: true }), pedido({ codigo: 'PED-0003', status: 'Cancelado' }), pedido({ codigo: 'PED-0004', status: 'Realizado' }), pedido({ codigo: 'PED-0005', excluido: true })], '2026-10-13').ds;
    const meus = meusPedidosDF(ds, u).map((l) => [l.id, statusPedidoDF(l)]);
    expect(meus).toEqual(expect.arrayContaining([['PED-0001', 'aguardando'], ['PED-0002', 'reagendado'], ['PED-0003', 'recusado'], ['PED-0004', 'pago']]));
    expect(meus.some(([id]) => id === 'PED-0005')).toBe(false); // excluido some
    expect(lancamentoDoPedido(pedido({ codigoObra: 'OB-1' }), 'X')).toMatchObject({ codigoObra: 'OB-1', centroCusto: 'Obra', origem: 'diretor-financeiro', criadoPor: 'X' });
  });
  it('a única ação do Solicitante na matriz é pedir pagamento', () => {
    const u = { id: 's', nome: 'S', email: '', papel: 'Solicitante' as const, obras: '*' as const, ativo: true };
    const permitidas = (Object.keys(MATRIZ) as Acao[]).filter((a) => pode(u, a));
    expect(permitidas).toEqual(['pedir_pagamento']);
  });
  it('modo demo: o Solicitante registra o pedido (PED-nnnn, Rascunho) e nada além disso', () => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); actions.trocarUsuario('u-solicitante');
    const antes = getState().ds.lancamentos.length;
    const l = actions.registrarPrevisaoDF({ valor: 800, vencimento: '2026-10-17', categoria: 'Outros pagamentos', contraparte: 'Oficina', descricao: 'Manutenção da Saveiro', parecer: undefined as never });
    expect(l).toMatchObject({ id: 'PED-0001', status: 'Rascunho', origem: 'diretor-financeiro', valorBruto: 800, criadoPor: 'Equipe (solicitante)' });
    expect(getState().ds.lancamentos).toHaveLength(antes + 1);
    expect(actions.registrarPrevisaoDF({ valor: 800, vencimento: '2026-10-17', categoria: 'Outros pagamentos', contraparte: 'Oficina', descricao: 'Manutenção da Saveiro', parecer: undefined as never }).id).toBe('PED-0001'); // repetido
    expect(() => actions.salvarLancamento(actions.novoLancamento({ categoria: 'Outros pagamentos', contraparte: 'x', descricao: 'x', valorBruto: 1 }))).toThrow();
    expect(() => actions.decidirPrevisaoDF('PED-0001', 'programar')).toThrow();
    actions.trocarUsuario('u-admin');
  });
});

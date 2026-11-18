// Diretor Financeiro: alteração de valor de um pedido feito pela equipe (0071). O título só muda quando a Diretoria aceita;
// a equipe vê a situação de cada pedido e da alteração.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from './engine';
import { alteracaoPendente, alteracoesParaDecidir, analisarAlteracao, bloqueioAlteracao, centralDF, meusPedidosDF, statusPedidoDF, ultimaAlteracao, validarAlteracao, type PrevisaoDF } from './cfo';
import { RegraDeNegocioError, actions, getState } from '../data/store';
import { alteracoesDosPedidos, datasetSolicitante, type PedidoSolicitante } from '../data/solicitante';

const lanc = (id: string) => getState().ds.lancamentos.find((x) => x.id === id)!;
function pedido(descricao: string, valor = 500, dias = 2): PrevisaoDF {
  const ds = getState().ds;
  return { valor, vencimento: addDays(ds.params.dataBase, dias), categoria: 'Outros custos diretos', codigoObra: ds.obras[0].codigo, contraparte: 'Oficina do Zé', descricao, parecer: undefined as never };
}
const pedir = (descricao: string, valor = 500, dias = 2) => { actions.trocarUsuario('u-obra'); return actions.registrarPrevisaoDF(pedido(descricao, valor, dias)); };

describe('alteração de valor de um pedido ao Diretor Financeiro', () => {
  beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('a equipe pede a alteração com motivo; o título NÃO muda até a Diretoria decidir', async () => {
    const l = pedir('Manutenção da Saveiro');
    const a = await actions.pedirAlteracaoValorDF(l.id, 650, 'orçamento final veio com peça a mais');
    expect(a).toMatchObject({ lancamentoId: l.id, valorAnterior: 500, valorNovo: 650, status: 'PENDENTE', solicitadoPor: 'Gestor Smart Fit' });
    expect(lanc(l.id).valorBruto).toBe(500);
    expect(alteracaoPendente(getState().ds, l.id)?.id).toBe(a.id);
    // uma por vez
    await expect(actions.pedirAlteracaoValorDF(l.id, 700, 'mais uma')).rejects.toThrow(/em análise/);
    expect(getState().ds.auditoria.some((x) => x.acao === 'pedir_alteracao_valor' && x.entidadeId === l.id)).toBe(true);
  });

  it('regras: só o próprio pedido, valor diferente e positivo, motivo; pago, recusado e com pagamento não alteram', async () => {
    const l = pedir('Combustível');
    expect(validarAlteracao(l, 500, 'motivo ok')).toContain('O novo valor é igual ao atual.');
    expect(validarAlteracao(l, 0, 'motivo ok')).toContain('Novo valor deve ser positivo.');
    expect(validarAlteracao(l, 600, ' ')).toContain('Explique o motivo da alteração.');
    actions.trocarUsuario('u-eng');
    await expect(actions.pedirAlteracaoValorDF(l.id, 600, 'não é meu')).rejects.toThrow(/seus pedidos/);
    actions.trocarUsuario('u-admin');
    actions.decidirPrevisaoDF(l.id, 'recusar', { motivo: 'sem nota' });
    expect(bloqueioAlteracao(getState().ds, lanc(l.id))).toMatch(/não foi aprovado/);
    actions.trocarUsuario('u-obra');
    await expect(actions.pedirAlteracaoValorDF(l.id, 600, 'quero mudar')).rejects.toThrow(RegraDeNegocioError);
    const pago = { ...lanc(l.id), status: 'Realizado' as const };
    expect(bloqueioAlteracao(getState().ds, pago)).toMatch(/já foi pago/);
  });

  it('Diretoria aceita: novo valor no título, rastro nas observações, alteração ACEITA e o solicitante vê', async () => {
    const l = pedir('Frete de chapas', 800);
    const a = await actions.pedirAlteracaoValorDF(l.id, 950, 'frete com escolta');
    actions.trocarUsuario('u-admin');
    const c = centralDF(getState().ds);
    expect(c.alteracoes.map((x) => x.alteracao.id)).toEqual([a.id]);
    expect(c.briefing).toMatch(/1 pedido\(s\) de alteração de valor/);
    actions.decidirAlteracaoValorDF(a.id, 'aceitar');
    const depois = lanc(l.id);
    expect(depois.valorBruto).toBe(950);
    expect(depois.status).toBe('Rascunho'); // ainda aguardava a decisão do pedido: segue na fila, agora com o novo valor
    expect(depois.observacoes).toMatch(/Valor alterado de R\$ 800,00 para R\$ 950,00 a pedido de Gestor Smart Fit \(frete com escolta\)/);
    expect(ultimaAlteracao(getState().ds, l.id)).toMatchObject({ status: 'ACEITA', decididoPor: 'Administrador' });
    expect(alteracoesParaDecidir(getState().ds)).toHaveLength(0);
    expect(() => actions.decidirAlteracaoValorDF(a.id, 'recusar', 'tarde demais')).toThrow(/já decidida/);
  });

  it('pedido já programado: aceitar repassa pelas alçadas com o novo valor', async () => {
    const l = pedir('Locação de guindaste', 1000);
    actions.trocarUsuario('u-admin');
    actions.decidirPrevisaoDF(l.id, 'programar');
    expect(['Programado', 'Pendente']).toContain(lanc(l.id).status);
    actions.trocarUsuario('u-obra');
    const a = await actions.pedirAlteracaoValorDF(l.id, 900_000, 'guindaste maior');
    actions.trocarUsuario('u-admin');
    const analise = analisarAlteracao(getState().ds, a, lanc(l.id));
    expect(analise.diferenca).toBe(899_000);
    expect(analise.tom).not.toBe('ok'); // a diferença aperta o caixa
    actions.decidirAlteracaoValorDF(a.id, 'aceitar');
    const depois = lanc(l.id);
    expect(depois.valorBruto).toBe(900_000);
    expect(depois.status).toBe('Pendente'); // valor alto: volta para a alçada
    expect(getState().ds.aprovacoes.filter((x) => x.entidadeId === l.id && x.status === 'Pendente')).toHaveLength(1);
  });

  it('redução de valor de pedido programado: análise diz que o caixa melhora', async () => {
    const l = pedir('Material elétrico', 2000);
    actions.trocarUsuario('u-admin');
    actions.decidirPrevisaoDF(l.id, 'programar');
    actions.trocarUsuario('u-obra');
    const a = await actions.pedirAlteracaoValorDF(l.id, 1500, 'desconto do fornecedor');
    const analise = analisarAlteracao(getState().ds, a, lanc(l.id));
    expect(analise).toMatchObject({ tom: 'ok', diferenca: -500 });
    expect(analise.titulo).toMatch(/Reduz o pagamento em R\$ 500,00/);
  });

  it('Diretoria recusa com motivo (obrigatório); o valor fica; quem pediu não decide (salvo Administrador); quem pediu cancela', async () => {
    const l = pedir('Diárias da equipe', 1200);
    const a = await actions.pedirAlteracaoValorDF(l.id, 1500, 'mais dois dias');
    expect(() => actions.decidirAlteracaoValorDF(a.id, 'aceitar')).toThrow(); // Gestor não decide
    actions.trocarUsuario('u-fin');
    expect(() => actions.decidirAlteracaoValorDF(a.id, 'recusar', '')).toThrow(/motivo/);
    actions.decidirAlteracaoValorDF(a.id, 'recusar', 'refaça o pedido com a nota');
    expect(lanc(l.id).valorBruto).toBe(1200);
    expect(ultimaAlteracao(getState().ds, l.id)).toMatchObject({ status: 'RECUSADA', motivoDecisao: 'refaça o pedido com a nota', decididoPor: 'Financeiro EIFF' });
    // depois da recusa pode pedir outra; e pode cancelar a própria
    actions.trocarUsuario('u-obra');
    const b = await actions.pedirAlteracaoValorDF(l.id, 1300, 'mais um dia só');
    await actions.cancelarAlteracaoValorDF(b.id);
    expect(ultimaAlteracao(getState().ds, l.id)?.status).toBe('CANCELADA');
    expect(bloqueioAlteracao(getState().ds, lanc(l.id))).toBeNull();
    // Financeiro que pediu o próprio pedido não decide a alteração dele
    actions.trocarUsuario('u-fin');
    const proprio = actions.registrarPrevisaoDF(pedido('Pedido do financeiro', 300));
    const c = await actions.pedirAlteracaoValorDF(proprio.id, 350, 'ajuste');
    expect(() => actions.decidirAlteracaoValorDF(c.id, 'aceitar')).toThrow(/Segregação/);
  });

  it('Meus pedidos: a lista traz todos os pedidos da pessoa com a situação', () => {
    const l1 = pedir('Pedido um', 100);
    const l2 = pedir('Pedido dois', 200);
    actions.trocarUsuario('u-admin');
    actions.decidirPrevisaoDF(l2.id, 'recusar', { motivo: 'duplicado' });
    actions.trocarUsuario('u-obra');
    const meus = meusPedidosDF(getState().ds, getState().usuario);
    expect(meus.map((x) => [x.id, statusPedidoDF(x)])).toEqual(expect.arrayContaining([[l1.id, 'aguardando'], [l2.id, 'recusado']]));
  });

  it('Solicitante: a alteração vem junto com o pedido pela porta df_meus_pedidos', () => {
    const p: PedidoSolicitante = {
      codigo: 'PED-0001', descricao: 'Manutenção', contraparte: null, categoria: 'Outros custos diretos', codigoObra: null, valor: 800, vencimento: '2026-10-20', status: 'Rascunho',
      motivoCancelamento: null, excluido: false, reagendado: false, criadoEm: '2026-10-14T10:00:00Z', atualizadoEm: '2026-10-14T10:00:00Z',
      alteracao: { id: 'a1', codigo: 'PED-0001', solicitadoPor: 'Equipe Um', solicitadoEm: '2026-10-14T11:00:00Z', valorAnterior: 800, valorNovo: 900, motivo: 'peça', status: 'RECUSADA', decididoPor: 'Admin', decididoEm: '2026-10-14T12:00:00Z', motivoDecisao: 'refaça' },
    };
    expect(alteracoesDosPedidos([p, { ...p, codigo: 'PED-0002', alteracao: null }], 'Equipe Um')).toEqual([expect.objectContaining({ lancamentoId: 'PED-0001', status: 'RECUSADA', motivoDecisao: 'refaça', valorNovo: 900 })]);
    const { ds } = datasetSolicitante({ perfil: { id: 'x', nome: 'Equipe Um', email: 'e@t', papel: 'Solicitante' }, organizacao: 'o', categorias: [{ categoria: 'Outros custos diretos', grupoFluxo: 'g' }], obras: [] }, [p], '2026-10-14');
    expect(ultimaAlteracao(ds, 'PED-0001')?.status).toBe('RECUSADA');
  });
});

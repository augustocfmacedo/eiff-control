import { describe, expect, it } from 'vitest';
import { DEPARTAMENTOS, categoriaDoCaixa, departamentoDe, livroCaixa, validarLinhaCaixa } from './caixa';
import { calcLancamentos } from './engine';
import type { Dataset, Lancamento } from './types';
import { actions, getState } from '../data/store';

const HOJE = '2026-10-13';

/** Dataset do seed sem lancamentos, liquidacoes nem extrato: uma conta ativa abrindo no marco. */
function base(abertura = 67410.42): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  const conta = { ...ds.contas[0], ativa: true, saldoInicial: abertura, saldoInicialData: HOJE, reservaVinculada: 0 };
  return { ...ds, lancamentos: [], liquidacoes: [], transacoes: [], aprovacoes: [], contas: [conta], params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false, corteExtrato: HOJE, reservaMinima: 0 } };
}
let n = 0;
function lanc(ds: Dataset, p: Partial<Lancamento> & { categoria: string; valorBruto: number; vencimento: string }): Lancamento {
  n += 1;
  return { id: `T-${String(n).padStart(3, '0')}`, registro: 'Real', subcategoria: '', centroCusto: 'Administrativo', codigoObra: '', contraparte: 'X', documento: '', descricao: `linha ${n}`, competencia: p.vencimento, status: 'Programado', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: ds.contas[0].instituicao, retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [], origem: 'teste', criadoEm: '', criadoPor: '', atualizadoEm: '', atualizadoPor: '', versao: 1, ...p };
}
function pago(ds: Dataset, l: Lancamento, data: string): Dataset {
  const r = { ...l, status: 'Realizado' as const, realizacao: data, valorRealizado: l.valorBruto };
  return { ...ds, lancamentos: [...ds.lancamentos, r], liquidacoes: [...ds.liquidacoes, { id: `LIQ-${l.id}`, lancamentoId: l.id, data, valor: l.valorBruto, conta: l.contaFinanceira, criadoPor: '', criadoEm: '' }] };
}

describe('categoria e departamento do caixa', () => {
  const ds = base();
  it('usa a categoria do departamento e cai na genérica quando a dela exige obra e não há obra', () => {
    expect(categoriaDoCaixa(ds, 'Pró-labore', 'Saída')).toEqual({ categoria: 'Pró-labore', ajustada: false });
    expect(categoriaDoCaixa(ds, 'Empréstimo', 'Entrada')).toEqual({ categoria: 'Empréstimos recebidos', ajustada: false });
    expect(categoriaDoCaixa(ds, 'Obra', 'Saída')).toEqual({ categoria: 'Outros pagamentos', ajustada: true });
    expect(categoriaDoCaixa(ds, 'Obra', 'Saída', ds.obras[0].codigo)).toEqual({ categoria: 'Outros custos diretos', ajustada: false });
    expect(categoriaDoCaixa(ds, 'Obra', 'Entrada')).toEqual({ categoria: 'Outros recebimentos', ajustada: true });
    expect(categoriaDoCaixa(ds, 'inexistente', 'Saída').categoria).toBe('Outros pagamentos');
  });
  it('toda categoria dos departamentos existe no plano do seed com o tipo certo', () => {
    const plano = new Map(ds.planoContas.map((p) => [p.categoria, p.tipo]));
    for (const d of DEPARTAMENTOS) { expect(plano.get(d.saida), d.saida).toBe('Saída'); expect(plano.get(d.entrada), d.entrada).toBe('Entrada'); }
  });
  it('departamento vem do centro de custo, senão da obra, senão da categoria', () => {
    expect(departamentoDe({ centroCusto: 'fabrica', categoria: 'Outros pagamentos' })).toBe('Fábrica');
    expect(departamentoDe({ centroCusto: 'Corporativo', categoria: 'Aço e perfis', codigoObra: 'OB-1' })).toBe('Obra');
    expect(departamentoDe({ centroCusto: 'Corporativo', categoria: 'Pró-labore' })).toBe('Pró-labore');
    expect(departamentoDe({ centroCusto: 'Corporativo', categoria: 'Seguros' })).toBe('Corporativo');
  });
  it('validação da linha digitada', () => {
    expect(validarLinhaCaixa({ data: HOJE, descricao: 'x', departamento: 'Obra', tipo: 'Saída', valor: 10, pago: false })).toEqual([]);
    expect(validarLinhaCaixa({ data: '', descricao: ' ', departamento: '?', tipo: 'Saída', valor: 0, pago: false })).toHaveLength(4);
  });
});

describe('livro caixa no formato da planilha', () => {
  it('reproduz a PLANILHA CAIXA-2026: 41.988,93 após os pagos, 23.768,93 no menor dia (15/10) e 259.915,86 em 30/10', () => {
    let ds = base();
    const pagos = [12000, 727, 700, 240, 1205, 180, 300, 1200, 8059.49, 810];
    for (const v of pagos) ds = pago(ds, lanc(ds, { categoria: 'Outros pagamentos', valorBruto: v, vencimento: HOJE }), HOJE);
    const prev: [string, 'S' | 'E', number][] = [[HOJE, 'S', 5000], ['2026-10-15', 'S', 7000], ['2026-10-15', 'S', 1970], ['2026-10-15', 'S', 4250], ['2026-10-16', 'E', 19000], ['2026-10-16', 'E', 77531.45],
      ['2026-10-17', 'S', 357.53], ['2026-10-20', 'S', 2530], ['2026-10-20', 'S', 1000], ['2026-10-21', 'S', 10496.99], ['2026-10-25', 'S', 5000], ['2026-10-28', 'E', 140000], ['2026-10-30', 'E', 19000]];
    for (const [data, t, v] of prev) ds = { ...ds, lancamentos: [...ds.lancamentos, lanc(ds, { categoria: t === 'E' ? 'Outros recebimentos' : 'Outros pagamentos', valorBruto: v, vencimento: data })] };
    const lv = livroCaixa(ds, '2026-10-31', calcLancamentos(ds));
    expect(lv.marco).toBe(HOJE);
    expect(lv.saldoHoje).toBe(41988.93);
    expect(lv.dias[0]).toMatchObject({ data: HOJE, saldo: 36988.93 }); // a planilha (coluna K) ja tira o Compass previsto do dia
    expect(lv.menor).toEqual({ data: '2026-10-15', saldo: 23768.93 });
    expect(lv.dias.find((x) => x.data === '2026-10-16')?.saldo).toBe(120300.38);
    expect(lv.dias.find((x) => x.data === '2026-10-30')?.saldo).toBe(259915.86);
    expect(lv.saldoFinal).toBe(259915.86);
    // saldo corrido da lista: pagos primeiro no dia; ultima linha = saldo final
    expect(lv.linhas.filter((x) => x.situacao === 'Pago').map((x) => x.saldo).pop()).toBe(41988.93);
    expect(lv.linhas[lv.linhas.length - 1].saldo).toBe(259915.86);
  });

  it('vencidos: pagamento conta hoje, recebimento fica fora do saldo; rascunho e aprovação ficam fora; antes do marco não aparece', () => {
    let ds = base(1000);
    ds = { ...ds, lancamentos: [
      lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 100, vencimento: '2026-10-01' }),
      lanc(ds, { categoria: 'Outros recebimentos', valorBruto: 500, vencimento: '2026-10-02' }),
      lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 300, vencimento: '2026-10-20', status: 'Rascunho' }),
      lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 400, vencimento: '2026-10-20', status: 'Pendente' }),
      lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 50, vencimento: '2026-10-20', faturamentoDireto: true, codigoObra: 'X' }),
    ] };
    ds = pago(ds, lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 70, vencimento: '2026-10-05' }), '2026-10-05'); // pago antes do marco
    const lv = livroCaixa(ds, '2026-10-31', calcLancamentos(ds));
    const por = (v: number) => lv.linhas.find((x) => x.entra === v || x.sai === v)!;
    expect(por(100)).toMatchObject({ situacao: 'Vencido', contaNoSaldo: true, dataSaldo: HOJE, saldo: 900 });
    expect(por(500)).toMatchObject({ situacao: 'Vencido', contaNoSaldo: false });
    expect(por(500).saldo).toBeUndefined();
    expect(por(300)).toMatchObject({ situacao: 'Rascunho', contaNoSaldo: false });
    expect(por(400)).toMatchObject({ situacao: 'Em aprovação', contaNoSaldo: false });
    expect(lv.linhas.some((x) => x.sai === 50 || x.sai === 70)).toBe(false);
    expect(lv.saldoHoje).toBe(1000);
    expect(lv.dias[0].saldo).toBe(900);
    expect(lv.saldoFinal).toBe(900);
    expect(lv.vencidosPagar).toBe(100);
    expect(lv.vencidosReceber).toBe(500);
  });
});

describe('ações do caixa no store', () => {
  const prepara = () => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    actions.salvarParametros({ ...getState().ds.params, reservaMinima: 0 }); // como em produção: sem reserva, saída pequena não pede aprovação
    const ds = getState().ds;
    return { hoje: ds.params.dataBase, obra: ds.obras[0].codigo };
  };
  it('saída que aprofunda o caixa projetado vai para aprovação e não é marcada como paga (alçadas normais)', () => {
    const { hoje } = prepara();
    const r = actions.lancarCaixa({ data: hoje, descricao: 'Grande', departamento: 'Administrativo', tipo: 'Saída', valor: 500000, pago: true });
    expect(r).toMatchObject({ aprovacaoAberta: true, pago: false });
    expect(r.lancamento.status).toBe('Pendente');
  });
  it('lançar pago liquida na data; desfazer volta a previsto; marcar pago de novo liquida o que falta', () => {
    const { hoje } = prepara();
    const r = actions.lancarCaixa({ data: hoje, descricao: 'Reembolso teste', departamento: 'Fábrica', tipo: 'Entrada', valor: 727, pago: true });
    expect(r.pago).toBe(true);
    let l = getState().ds.lancamentos.find((x) => x.id === r.lancamento.id)!;
    expect(l).toMatchObject({ status: 'Realizado', realizacao: hoje, centroCusto: 'Fábrica', categoria: 'Outros recebimentos', origem: 'caixa', contraparte: 'Reembolso teste' });
    expect(() => actions.estornarLiquidacoes(l.id, ' ')).toThrow(/Motivo/);
    actions.estornarLiquidacoes(l.id, 'marquei por engano');
    l = getState().ds.lancamentos.find((x) => x.id === l.id)!;
    expect(l.status).toBe('Programado');
    expect(getState().ds.liquidacoes.some((q) => q.lancamentoId === l.id)).toBe(false);
    actions.pagarCaixa(l.id);
    expect(getState().ds.lancamentos.find((x) => x.id === l.id)!.status).toBe('Realizado');
    expect(() => actions.pagarCaixa(l.id)).toThrow(/Nada a pagar/);
  });
  it('pagamento no futuro é recusado; obra classifica como custo direto; edição troca a categoria com o departamento', () => {
    const { hoje, obra } = prepara();
    const futuro = new Date(`${hoje}T00:00:00Z`); futuro.setUTCDate(futuro.getUTCDate() + 3);
    const amanha = futuro.toISOString().slice(0, 10);
    expect(() => actions.lancarCaixa({ data: amanha, descricao: 'x', departamento: 'Obra', tipo: 'Saída', valor: 10, pago: true })).toThrow(/futura/);
    const r = actions.lancarCaixa({ data: amanha, descricao: 'Medição', departamento: 'Obra', tipo: 'Entrada', valor: 1200, pago: false, codigoObra: obra });
    expect(r.categoriaAjustada).toBe(false);
    expect(r.lancamento).toMatchObject({ categoria: 'Medições de obras', codigoObra: obra, status: 'Programado' });
    expect(() => actions.pagarCaixa(r.lancamento.id, amanha)).toThrow(/futuro/);
    actions.editarLinhaCaixa(r.lancamento.id, { data: amanha, descricao: 'Juros', departamento: 'Empréstimo', valor: 1300 });
    expect(getState().ds.lancamentos.find((x) => x.id === r.lancamento.id)).toMatchObject({ categoria: 'Empréstimos recebidos', centroCusto: 'Empréstimo', codigoObra: '', valorBruto: 1300, descricao: 'Juros' });
  });
  it('não estorna pagamento conciliado com o extrato', () => {
    const { hoje } = prepara();
    const r = actions.lancarCaixa({ data: hoje, descricao: 'Conciliado', departamento: 'Administrativo', tipo: 'Entrada', valor: 50, pago: true });
    const ds = getState().ds;
    actions.importarTransacoes(ds.contas.find((c) => c.ativa)!.instituicao, [{ data: hoje, historico: 'TESTE', documento: '', debito: 0, credito: 50, idExterno: 'FIT-CAIXA-1' }]);
    const t = getState().ds.transacoes.find((x) => x.idExterno === 'FIT-CAIXA-1')!;
    actions.conciliar(t.id, [r.lancamento.id]);
    expect(() => actions.estornarLiquidacoes(r.lancamento.id, 'teste')).toThrow(/conciliado/);
  });
});

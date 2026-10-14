// Widgets do iPad: o resumo é LEITURA dos mesmos números da Caixa (livroCaixa) e da saúde do caixa — nunca outra conta.
import { describe, expect, it } from 'vitest';
import { livroCaixa } from './caixa';
import { addDays, calcLancamentos } from './engine';
import { saudeCaixa } from './saudeCaixa';
import { DIAS_CURVA_WIDGET, MAX_PROXIMOS_WIDGET, resumoWidgetCaixa } from './widgetCaixa';
import { MAX_ITENS_PAGAMENTOS_WIDGET, resumoWidgetPagamentos } from './widgetPagamentos';
import type { Dataset, Lancamento } from './types';
import { actions, getState } from '../data/store';

const HOJE = '2026-10-13';
const AGORA = new Date('2026-10-13T11:40:00Z');

function base(abertura = 67410.42): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  const conta = { ...ds.contas[0], ativa: true, saldoInicial: abertura, saldoInicialData: HOJE, reservaVinculada: 0 };
  return { ...ds, lancamentos: [], liquidacoes: [], transacoes: [], aprovacoes: [], contas: [conta], params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false, corteExtrato: HOJE, reservaMinima: 20000 } };
}
let n = 0;
function lanc(ds: Dataset, p: Partial<Lancamento> & { categoria: string; valorBruto: number; vencimento: string }): Lancamento {
  n += 1;
  return { id: `W-${String(n).padStart(3, '0')}`, registro: 'Real', subcategoria: '', centroCusto: 'Administrativo', codigoObra: '', contraparte: 'Fornecedor', documento: '', descricao: `linha ${n}`, competencia: p.vencimento, status: 'Programado', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: ds.contas[0].instituicao, retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [], origem: 'teste', criadoEm: '', criadoPor: '', atualizadoEm: '', atualizadoPor: '', versao: 1, ...p };
}
function pago(ds: Dataset, l: Lancamento, data: string): Dataset {
  const r = { ...l, status: 'Realizado' as const, realizacao: data, valorRealizado: l.valorBruto };
  return { ...ds, lancamentos: [...ds.lancamentos, r], liquidacoes: [...ds.liquidacoes, { id: `LIQ-${l.id}`, lancamentoId: l.id, data, valor: l.valorBruto, conta: l.contaFinanceira, criadoPor: '', criadoEm: '' }] };
}
/** o cenário da PLANILHA CAIXA-2026 (o mesmo de caixa.test.ts) */
function planilha(): Dataset {
  let ds = base();
  for (const v of [12000, 727, 700, 240, 1205, 180, 300, 1200, 8059.49, 810]) ds = pago(ds, lanc(ds, { categoria: 'Outros pagamentos', valorBruto: v, vencimento: HOJE }), HOJE);
  const prev: [string, 'S' | 'E', number][] = [[HOJE, 'S', 5000], ['2026-10-15', 'S', 7000], ['2026-10-15', 'S', 1970], ['2026-10-15', 'S', 4250], ['2026-10-16', 'E', 19000], ['2026-10-16', 'E', 77531.45],
    ['2026-10-17', 'S', 357.53], ['2026-10-20', 'S', 2530], ['2026-10-20', 'S', 1000], ['2026-10-21', 'S', 10496.99], ['2026-10-25', 'S', 5000], ['2026-10-28', 'E', 140000], ['2026-10-30', 'E', 19000]];
  for (const [data, t, v] of prev) ds = { ...ds, lancamentos: [...ds.lancamentos, lanc(ds, { categoria: t === 'E' ? 'Outros recebimentos' : 'Outros pagamentos', valorBruto: v, vencimento: data })] };
  return ds;
}

describe('resumo do widget = os números da Caixa', () => {
  const ds = planilha();
  const r = resumoWidgetCaixa(ds, AGORA);
  const lv = livroCaixa(ds, addDays(HOJE, DIAS_CURVA_WIDGET), calcLancamentos(ds), { verBancos: true });

  it('caixa hoje, mínimo, menor saldo e saldo final batem com o livro caixa (planilha de 13/10)', () => {
    expect(r.hoje).toBe(HOJE);
    expect(r.geradoEm).toBe('2026-10-13T11:40:00.000Z');
    expect(r.caixaHoje).toBe(41988.93);
    expect(r.minimo).toBe(20000);
    expect(r.abaixoDoMinimo).toBe(false);
    expect(r.menor).toEqual({ data: '2026-10-15', saldo: 23768.93 });
    expect(r.fim).toEqual({ data: '2026-11-12', saldo: lv.saldoFinal });
    expect(r.fim.saldo).toBe(259915.86);
    expect(r.em7Dias).toBe(lv.previsto7);
  });

  it('curva: saldo no fim de cada dia, de hoje até hoje + 30 (31 pontos), igual ao livro', () => {
    expect(r.curva).toHaveLength(DIAS_CURVA_WIDGET + 1);
    expect(r.curva).toEqual(lv.dias.map((d) => d.saldo));
    expect(r.curva[0]).toBe(36988.93);
    expect(r.curva[3]).toBe(120300.38); // 16/10
  });

  it('semana: o que ainda entra e sai de hoje até hoje + 6 (os pagos de hoje já estão no caixa)', () => {
    expect(r.semana).toEqual({ entradas: 96531.45, saidas: 18577.53 });
  });

  it('próximos: só o que está em aberto até hoje + 6, por data, no máximo 8', () => {
    expect(r.proximos.length).toBeLessThanOrEqual(MAX_PROXIMOS_WIDGET);
    expect(r.proximos.every((p) => p.data <= '2026-10-19' && !p.vencido)).toBe(true);
    expect(r.proximos.map((p) => p.data)).toEqual([...r.proximos.map((p) => p.data)].sort());
    expect(r.proximos[0]).toMatchObject({ data: HOJE, tipo: 'Saída', valor: 5000 });
    expect(r.proximos.filter((p) => p.tipo === 'Entrada').map((p) => p.valor)).toEqual([77531.45, 19000]); // mesmo dia: o maior antes
  });

  it('saúde: o semáforo e os alertas são os da tela (só os que não estão verdes, vermelho antes)', () => {
    const s = saudeCaixa(ds);
    expect(r.saude.geral).toBe(s.geral);
    expect([r.saude.vermelhos, r.saude.amarelos]).toEqual([s.vermelhos, s.amarelos]);
    expect(r.saude.alertas.every((a) => a.sinal !== 'verde')).toBe(true);
    expect(r.saude.alertas.length).toBeLessThanOrEqual(3);
  });

  it('só o que o widget usa: nenhuma conta bancária, linha completa ou dado de cadastro sai daqui', () => {
    expect(Object.keys(r).sort()).toEqual(['abaixoDoMinimo', 'caixaHoje', 'curva', 'em7Dias', 'extrato', 'fim', 'geradoEm', 'hoje', 'menor', 'minimo', 'proximos', 'saude', 'semana', 'vencidos', 'versao']);
    for (const p of r.proximos) expect(Object.keys(p).sort()).toEqual(['data', 'descricao', 'foraDoSaldo', 'tipo', 'valor', 'vencido']);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(ds.contas[0].instituicao);
    expect(texto).not.toMatch(/agencia|conta_?numero|cnpj|lancamentoId/i);
  });
});

describe('vencidos, rascunhos e textos longos', () => {
  let ds = base(100000);
  ds = { ...ds, params: { ...ds.params, corteExtrato: '2026-09-01' }, lancamentos: [
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 1200, vencimento: '2026-10-01', descricao: 'Aluguel do galpão de pré-montagem do canteiro e do depósito' }),
    lanc(ds, { categoria: 'Outros recebimentos', valorBruto: 5000, vencimento: '2026-10-02', descricao: 'Medição atrasada' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 300, vencimento: '2026-10-14', status: 'Rascunho', descricao: 'pedido da equipe' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 400, vencimento: '2026-10-14', status: 'Pendente', descricao: 'em aprovação' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 50, vencimento: '2026-10-14', descricao: '' }),
  ] };
  const r = resumoWidgetCaixa(ds, AGORA);

  it('vencidos vêm primeiro; recebimento vencido aparece marcado como fora do saldo', () => {
    expect(r.proximos.slice(0, 2).map((p) => [p.tipo, p.vencido, p.foraDoSaldo])).toEqual([['Saída', true, false], ['Entrada', true, true]]);
    expect(r.vencidos).toEqual({ pagar: 1200, receber: 5000 });
  });
  it('rascunho e em aprovação não aparecem (estão fora do caixa)', () => {
    expect(r.proximos.map((p) => p.descricao)).not.toContain('pedido da equipe');
    expect(r.proximos.map((p) => p.descricao)).not.toContain('em aprovação');
  });
  it('descrição longa é cortada em 40 caracteres; sem descrição usa a contraparte', () => {
    expect(r.proximos[0].descricao.length).toBeLessThanOrEqual(40);
    expect(r.proximos[0].descricao.endsWith('…')).toBe(true);
    expect(r.proximos.some((p) => p.descricao === 'Fornecedor')).toBe(true);
  });
  it('sem extrato importado: o alerta do Diretor Financeiro vai junto', () => {
    expect(r.extrato.ate).toBeNull();
    expect(r.extrato.dias).toBeNull();
    expect(r.extrato.alerta).toMatch(/Nenhum extrato importado/);
  });
});

describe('widget de pagamentos do dia = as saídas de hoje na Caixa', () => {
  // planilha de 13/10 + um atrasado, um em aprovação, um rascunho, um faturado ao cliente, uma entrada e um de amanhã
  let ds = planilha();
  const obra = ds.obras[0]?.codigo ?? '';
  const extra = [
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 1500, vencimento: '2026-10-10', descricao: 'Conta atrasada' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 800, vencimento: HOJE, status: 'Pendente', descricao: 'Em aprovação' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 300, vencimento: HOJE, status: 'Rascunho', descricao: 'Pedido ao Diretor' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 9000, vencimento: HOJE, faturamentoDireto: true, codigoObra: obra, descricao: 'Nota direta' }),
    lanc(ds, { categoria: 'Outros recebimentos', valorBruto: 4000, vencimento: HOJE, descricao: 'Recebimento de hoje' }),
    lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 999, vencimento: '2026-10-14', descricao: 'Amanhã' }),
  ];
  ds = { ...ds, lancamentos: [...ds.lancamentos, ...extra] };
  const r = resumoWidgetPagamentos(ds, AGORA);

  it('soma por situação: 10 pagos (25.421,49), 5.000 a pagar, 1.500 atrasado, 800 em aprovação', () => {
    expect(r.visao).toBe('pagamentos');
    expect(r.hoje).toBe(HOJE);
    expect(r.quantidade).toEqual({ atrasado: 1, a_pagar: 1, aprovacao: 1, pago: 10 });
    expect(r.valor).toEqual({ atrasado: 1500, a_pagar: 5000, aprovacao: 800, pago: 25421.49 });
    expect(r.falta).toBe(6500);
    expect(r.total).toBe(31921.49); // aprovação fica fora: ainda não sai do caixa
    expect(r.progresso).toBeCloseTo(25421.49 / 31921.49, 3);
  });

  it('caixa de hoje é o da Caixa; depois de pagar o que falta', () => {
    expect(r.caixaHoje).toBe(41988.93);
    expect(r.caixaAposPagar).toBe(35488.93);
    expect(r.minimo).toBe(20000);
    expect(r.abaixoDoMinimo).toBe(false);
  });

  it('lista: o que exige ação primeiro (atrasado, a pagar, aprovação, pagos pelo maior valor); nunca rascunho, entrada, faturado ao cliente ou outro dia', () => {
    expect(r.itens.slice(0, 3).map((p) => [p.status, p.valor])).toEqual([['atrasado', 1500], ['a_pagar', 5000], ['aprovacao', 800]]);
    expect(r.itens[0].diasAtraso).toBe(3);
    expect(r.itens[3]).toMatchObject({ status: 'pago', valor: 12000 });
    const nomes = r.itens.map((p) => p.descricao);
    for (const fora of ['Pedido ao Diretor', 'Nota direta', 'Recebimento de hoje', 'Amanhã']) expect(nomes).not.toContain(fora);
    expect(r.itens.length).toBeLessThanOrEqual(MAX_ITENS_PAGAMENTOS_WIDGET);
  });

  it('dia sem pagamentos: total zero e progresso cheio', () => {
    const vazio = resumoWidgetPagamentos(base(), AGORA);
    expect([vazio.total, vazio.falta, vazio.itens.length, vazio.progresso]).toEqual([0, 0, 0, 1]);
  });
});

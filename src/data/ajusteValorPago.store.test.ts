// Ajuste do valor pago/recebido de um título já liquidado (actions.ajustarValorPago): o título continua Realizado, a última
// liquidação absorve a diferença, e a diferença do previsto vira valor corrigido, juros ou desconto.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcLancamentos } from '../core/engine';
import { RegraDeNegocioError, actions, getState } from './store';

let n = 0;
/** título Programado injetado direto no dataset (sem passar por alçada: o cenário de demonstração já está abaixo da reserva) */
function programado(valor: number, categoria = 'Outros pagamentos', descricao?: string): string {
  const ds = getState().ds;
  n += 1;
  const base = actions.novoLancamento({ categoria, centroCusto: 'Administrativo', contraparte: `Fornecedor ${n}`, descricao: descricao ?? `conta ${n}`, valorBruto: valor, vencimento: ds.params.dataBase, competencia: ds.params.dataBase });
  const l = { ...base, id: `AJ-${String(n).padStart(3, '0')}`, status: 'Programado' as const, contaFinanceira: ds.contas.find((c) => c.ativa)!.instituicao };
  actions.importarJson(JSON.stringify({ ...ds, lancamentos: [...ds.lancamentos, l] }));
  return l.id;
}
function pago(valor: number, categoria = 'Outros pagamentos') {
  const id = programado(valor, categoria);
  const ds = getState().ds;
  actions.liquidar(id, { data: ds.params.dataBase, valor, conta: ds.contas.find((c) => c.ativa)!.instituicao, documento: 'teste' });
  return id;
}
const lanc = (id: string) => calcLancamentos(getState().ds).find((x) => x.id === id)!;
const liqs = (id: string) => getState().ds.liquidacoes.filter((q) => q.lancamentoId === id);

describe('ajustar valor pago de conta liquidada', () => {
  beforeEach(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('corrigir o valor do título: título e liquidação passam a valer o pago real; continua Realizado; auditoria com motivo', () => {
    const id = pago(1000);
    actions.ajustarValorPago(id, { valorPago: 987.5, tratamento: 'valor', motivo: 'fornecedor cobrou menos' });
    const l = lanc(id);
    expect([l.status, l.valorBruto, l.valorRealizadoTotal, l.saldoAberto]).toEqual(['Realizado', 987.5, 987.5, 0]);
    expect(liqs(id).map((q) => q.valor)).toEqual([987.5]);
    expect(l.observacoes).toMatch(/Valor pago ajustado de R\$ 1\.000,00 para R\$ 987,50.*fornecedor cobrou menos \(valor do título corrigido\)/);
    expect(getState().ds.auditoria.some((a) => a.acao === 'ajustar_valor_pago' && a.entidadeId === id && a.motivo === 'fornecedor cobrou menos')).toBe(true);
  });

  it('juros quando pagou mais; desconto quando pagou menos; o valor bruto não muda', () => {
    const a = pago(500);
    actions.ajustarValorPago(a, { valorPago: 512.3, tratamento: 'juros', motivo: 'atraso de 2 dias' });
    expect([lanc(a).valorBruto, lanc(a).multaJuros, lanc(a).valorRealizadoTotal, lanc(a).status]).toEqual([500, 12.3, 512.3, 'Realizado']);
    const b = pago(500);
    actions.ajustarValorPago(b, { valorPago: 480, tratamento: 'desconto', motivo: 'desconto à vista' });
    expect([lanc(b).valorBruto, lanc(b).desconto, lanc(b).valorRealizadoTotal, lanc(b).status]).toEqual([500, 20, 480, 'Realizado']);
    expect(() => actions.ajustarValorPago(b, { valorPago: 470, tratamento: 'juros', motivo: 'errado' })).toThrow(/Juros\/multa só/);
  });

  it('muda a data do pagamento junto; data futura é recusada; nada a mudar é recusado', () => {
    const id = pago(300);
    const hoje = getState().ds.params.dataBase;
    const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    actions.ajustarValorPago(id, { valorPago: 300, tratamento: 'valor', motivo: 'pago ontem', data: ontem });
    expect([lanc(id).realizacao, liqs(id)[0].data]).toEqual([ontem, ontem]);
    expect(() => actions.ajustarValorPago(id, { valorPago: 300, tratamento: 'valor', motivo: 'de novo', data: ontem })).toThrow(/já são esses/);
    expect(() => actions.ajustarValorPago(id, { valorPago: 300, tratamento: 'valor', motivo: 'futuro', data: '2099-01-01' })).toThrow(/futura/);
  });

  it('pagamentos parciais: a última liquidação absorve a diferença; se zerasse, pede estorno', () => {
    const id = programado(1000, 'Outros pagamentos', 'em duas vezes');
    const ds = getState().ds;
    const conta = ds.contas.find((c) => c.ativa)!.instituicao;
    actions.liquidar(id, { data: ds.params.dataBase, valor: 600, conta, documento: 'p1' });
    actions.liquidar(id, { data: ds.params.dataBase, valor: 400, conta, documento: 'p2' });
    actions.ajustarValorPago(id, { valorPago: 1010, tratamento: 'juros', motivo: 'juros na segunda' });
    expect(liqs(id).map((q) => q.valor).sort((a, b) => a - b)).toEqual([410, 600]);
    expect(lanc(id).status).toBe('Realizado');
    expect(() => actions.ajustarValorPago(id, { valorPago: 500, tratamento: 'valor', motivo: 'bem menos' })).toThrow(/estorne/);
  });

  it('recusas: motivo, não pago, conciliado com o extrato, perfil sem liquidar; recebimento também ajusta', () => {
    const id = pago(200);
    expect(() => actions.ajustarValorPago(id, { valorPago: 210, tratamento: 'valor', motivo: '' })).toThrow(/motivo/);
    const aberto = programado(50);
    expect(() => actions.ajustarValorPago(aberto, { valorPago: 60, tratamento: 'valor', motivo: 'não pago' })).toThrow(/já pago/);
    const ds = getState().ds;
    const tx = { ...(ds.transacoes[0] ?? {}), id: 'TX-AJ', conta: ds.contas[0].instituicao, data: ds.params.dataBase, valor: -200, historico: 'pagamento', lancamentoIds: [id] };
    actions.importarJson(JSON.stringify({ ...ds, transacoes: [...ds.transacoes, tx] }));
    expect(() => actions.ajustarValorPago(id, { valorPago: 210, tratamento: 'valor', motivo: 'conciliado' })).toThrow(/conciliado com o extrato/);
    actions.trocarUsuario('u-obra');
    expect(() => actions.ajustarValorPago(id, { valorPago: 210, tratamento: 'valor', motivo: 'sem permissão' })).toThrow(RegraDeNegocioError);
    actions.trocarUsuario('u-admin');
    const rec = pago(1500, 'Outros recebimentos');
    actions.ajustarValorPago(rec, { valorPago: 1492.4, tratamento: 'desconto', motivo: 'tarifa de boleto' });
    expect([lanc(rec).tipo, lanc(rec).desconto, lanc(rec).valorRealizadoTotal, lanc(rec).status]).toEqual(['Entrada', 7.6, 1492.4, 'Realizado']);
  });
});

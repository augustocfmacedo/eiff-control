// FIN-RESET-01: limpar o extrato e importar de novo os MESMOS OFX sem resíduo e sem FITID duplicado.
// O lado do banco (índice parcial, função fin_reset_extrato, desfazer) é provado em scripts/pg-smoke-fin-reset.mjs.
import { beforeEach, describe, expect, it } from 'vitest';
import { planejarResetExtrato } from '../core/resetExtrato';
import { posicaoBancaria } from '../core/engine';
import { RegraDeNegocioError, actions, getState } from './store';
import { linhaTransacaoNova } from './supabase';

const ds = () => getState().ds;
const CONTA = 'Banco Reset';
const OUTRA = 'Banco Vizinho';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const saldo = (conta: string) => posicaoBancaria(ds()).find((p) => p.conta.instituicao === conta)?.saldoBancario ?? 0;
const ativas = (conta: string, fitid: string) => ds().transacoes.filter((t) => t.conta === conta && t.idExterno === fitid && !t.descartadaEm);
const linha = (fitid: string, valor: number, data = '2026-09-20') => ({
  data, historico: `Movimento ${fitid}`, documento: '', debito: valor < 0 ? -valor : 0, credito: valor > 0 ? valor : 0, idExterno: fitid,
});
const OFX = [linha('FIT-1', -100), linha('FIT-2', -40), linha('FIT-3', 250)];
const ativa = (fitid: string) => ativas(CONTA, fitid)[0];

describe('FIN-RESET-01: classificação, limpeza e reimportação do mesmo OFX', () => {
  beforeEach(() => {
    actions.trocarUsuario('u-admin');
    actions.restaurarPlanilha();
    for (const [id, instituicao] of [['CTA-RST', CONTA], ['CTA-VIZ', OUTRA]] as const) {
      actions.salvarConta({ id, registro: 'Real', instituicao, conta: '0001-0', tipo: 'Conta corrente', saldoInicial: 0, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true });
    }
  });

  it('a transação importada nasce com uuid (mesmo id no navegador e no banco) e o FITID fica em idExterno', () => {
    actions.importarTransacoes(CONTA, OFX);
    const t = ativa('FIT-1');
    expect(t.id).toMatch(UUID);
    expect(t.idExterno).toBe('FIT-1');
    const row = linhaTransacaoNova(t, 'org', 'conta-uuid');
    expect(row).toMatchObject({ id: t.id, external_id: 'FIT-1', bank_account_id: 'conta-uuid', debit: 100, credit: 0 });
  });

  it('título pré-existente conciliado: só perde a conciliação; valor, status e natureza ficam', () => {
    actions.importarTransacoes(CONTA, OFX);
    const titulo = ds().lancamentos.find((l) => l.status === 'Programado' && !l.excluidoEm && l.origem !== 'ofx' && l.origem !== 'extrato')!;
    actions.conciliar(ativa('FIT-1').id, [titulo.id], 'pagamento do título');
    const plano = planejarResetExtrato(ds(), CONTA);
    expect(plano.preexistentes.map((l) => l.id)).toEqual([titulo.id]);
    expect(plano.derivados).toEqual([]);
    expect(plano.excecoes).toEqual([]);

    actions.limparExtrato(CONTA, 'recomeçar a conciliação');
    const depois = ds().lancamentos.find((l) => l.id === titulo.id)!;
    expect(depois).toMatchObject({ status: titulo.status, valorBruto: titulo.valorBruto, origem: titulo.origem, conciliado: false });
    expect(depois.excluidoEm).toBeUndefined();
  });

  it('lançamento gerado do extrato referencia a LINHA (uuid), nunca o FITID', () => {
    actions.importarTransacoes(CONTA, OFX);
    const t = ativa('FIT-2');
    const l = actions.lancarTransacao(t.id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    expect(l.idExterno).toBe(t.id);
    expect(l.idExterno).not.toBe('FIT-2');
    expect(l.origem).toBe('ofx');
  });

  it('limparExtrato recusa quando há lançamento gerado do extrato: limpar só a linha o deixaria no caixa e na DRE', () => {
    actions.importarTransacoes(CONTA, OFX);
    const l = actions.lancarTransacao(ativa('FIT-2').id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    const plano = planejarResetExtrato(ds(), CONTA);
    expect(plano.derivados.map((x) => x.id)).toEqual([l.id]);
    expect(plano.liquidacoesDerivadas.map((q) => q.lancamentoId)).toEqual([l.id]);
    const antes = JSON.stringify(ds().transacoes);
    expect(() => actions.limparExtrato(CONTA, 'recomeçar')).toThrow(RegraDeNegocioError);
    expect(() => actions.limparExtrato(CONTA, 'recomeçar')).toThrow(/reset controlado/);
    expect(JSON.stringify(ds().transacoes)).toBe(antes); // nada mudou
    expect(ds().lancamentos.find((x) => x.id === l.id)!.status).toBe('Realizado');
  });

  it('limpa e reimporta EXATAMENTE o mesmo OFX: linhas novas, uma ativa por FITID, histórico preservado, saldo igual', () => {
    actions.importarTransacoes(CONTA, OFX);
    const saldoOriginal = saldo(CONTA);
    const antigas = OFX.map((o) => ativa(o.idExterno).id);
    actions.limparExtrato(CONTA, 'FIN-RESET-01 (teste)');
    expect(saldo(CONTA)).toBeCloseTo(0, 2);

    const r = actions.importarTransacoes(CONTA, OFX);
    expect(r).toMatchObject({ importadas: 3, duplicadas: 0 });
    for (const o of OFX) {
      expect(ativas(CONTA, o.idExterno)).toHaveLength(1); // nunca dois ativos com o mesmo FITID
      expect(antigas).not.toContain(ativa(o.idExterno).id); // é linha nova, a descartada não é reaproveitada
    }
    expect(ds().transacoes.filter((t) => t.conta === CONTA)).toHaveLength(6); // 3 descartadas (histórico) + 3 ativas
    expect(saldo(CONTA)).toBeCloseTo(saldoOriginal, 2);
    // importar o mesmo OFX uma terceira vez não duplica
    expect(actions.importarTransacoes(CONTA, OFX)).toMatchObject({ importadas: 0, duplicadas: 3 });
  });

  it('restaurar a linha antiga com uma ativa do mesmo FITID é recusado (o banco também recusa pelo índice parcial)', () => {
    actions.importarTransacoes(CONTA, OFX);
    const velha = ativa('FIT-1').id;
    actions.limparExtrato(CONTA, 'reset');
    actions.importarTransacoes(CONTA, OFX);
    expect(() => actions.restaurarTransacao(velha)).toThrow(/duplicata/);
  });

  it('depois do reset, relançar a mesma linha do banco não colide com o lançamento antigo (unique origem + external_id)', () => {
    actions.importarTransacoes(CONTA, OFX);
    const t1 = ativa('FIT-2');
    const l1 = actions.lancarTransacao(t1.id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    // o que o fin_reset_extrato faz no banco: linha descartada, conciliação desfeita, título cancelado e excluído, liquidação estornada
    const base = ds();
    actions.importarJson(JSON.stringify({
      ...base,
      transacoes: base.transacoes.map((t) => (t.conta === CONTA ? { ...t, descartadaEm: '2026-10-01T12:00:00Z', lancamentoIds: [] } : t)),
      lancamentos: base.lancamentos.map((l) => (l.id === l1.id ? { ...l, status: 'Cancelado', excluidoEm: '2026-10-01T12:00:00Z', valorRealizado: undefined, realizacao: undefined, conciliado: false } : l)),
      liquidacoes: base.liquidacoes.filter((q) => q.lancamentoId !== l1.id),
    }));
    expect(planejarResetExtrato(ds()).derivados).toEqual([]);

    actions.importarTransacoes(CONTA, OFX);
    const t2 = ativa('FIT-2');
    const l2 = actions.lancarTransacao(t2.id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    expect(l2.origem).toBe(l1.origem);
    expect(l2.idExterno).not.toBe(l1.idExterno); // (organização, origem, external_id) distintos
    expect(ds().lancamentos.filter((l) => l.idExterno === l2.idExterno)).toHaveLength(1);
  });

  it('reset de todas as contas: gerado do extrato sem transação ativa correspondente é exceção, não se adivinha a origem', () => {
    actions.importarTransacoes(CONTA, OFX);
    const l = actions.lancarTransacao(ativa('FIT-2').id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    const base = ds();
    actions.importarJson(JSON.stringify({ ...base, transacoes: base.transacoes.map((t) => (t.conta === CONTA ? { ...t, descartadaEm: '2026-10-01T12:00:00Z', lancamentoIds: [] } : t)) }));
    const plano = planejarResetExtrato(ds());
    expect(plano.derivados.map((x) => x.id)).not.toContain(l.id);
    expect(plano.excecoes).toContainEqual({ lancamentoId: l.id, motivo: 'gerado do extrato sem transação ativa correspondente' });
  });

  it('gerado do extrato ligado a medição é exceção; Realizado sem liquidação é anomalia registrada', () => {
    actions.importarTransacoes(CONTA, OFX);
    const a = actions.lancarTransacao(ativa('FIT-2').id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa' });
    const b = actions.lancarTransacao(ativa('FIT-1').id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa 2' });
    const base = ds();
    actions.importarJson(JSON.stringify({
      ...base,
      medicoes: [...base.medicoes, { id: 'MED-TESTE', codigoObra: 'OB-SF-CL-01', numero: 'E99', lancamentoId: a.id }],
      liquidacoes: base.liquidacoes.filter((q) => q.lancamentoId !== b.id),
    }));
    const plano = planejarResetExtrato(ds(), CONTA);
    expect(plano.excecoes).toContainEqual({ lancamentoId: a.id, motivo: 'gerado do extrato ligado a medição' });
    expect(plano.derivados.map((x) => x.id)).toEqual([b.id]);
    expect(plano.anomalias).toContainEqual({ lancamentoId: b.id, motivo: 'Realizado sem liquidação registrada' });
  });

  it('a outra conta não é tocada pelo reset de uma conta', () => {
    actions.importarTransacoes(CONTA, OFX);
    actions.importarTransacoes(OUTRA, [linha('FIT-1', -100)]); // mesmo FITID em outra conta: linha distinta
    const vizinha = ativas(OUTRA, 'FIT-1')[0];
    expect(planejarResetExtrato(ds(), CONTA).transacoes.map((t) => t.id)).not.toContain(vizinha.id);
    actions.limparExtrato(CONTA, 'reset');
    expect(ativas(OUTRA, 'FIT-1')).toHaveLength(1);
    expect(saldo(OUTRA)).toBeCloseTo(-100, 2);
  });
});

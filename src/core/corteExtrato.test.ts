// Corte do extrato (params.corteExtrato): movimentos anteriores ficam fora da posicao bancaria, da conciliacao e da importacao.
import { beforeAll, describe, expect, it } from 'vitest';
import { calcTransacoes, incluirTransacao, posicaoBancaria } from './engine';
import { actions, getState } from '../data/store';
import type { TransacaoBancaria } from './types';

describe('corte do extrato', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  const t = (id: string, data: string, conta: string, credito: number): TransacaoBancaria => ({ id, registro: 'Real', data, conta, historico: 'teste', documento: '', credito, debito: 0, lancamentoIds: [], origem: 'ofx', idExterno: id });
  it('posição bancária e conciliação ignoram o que vem antes do corte; sem corte tudo conta', () => {
    const ds0 = getState().ds;
    const conta = ds0.contas.find((c) => c.ativa)!;
    const ds = { ...ds0, contas: ds0.contas.map((c) => (c.id === conta.id ? { ...c, saldoInicialData: '2026-08-01' } : c)), transacoes: [t('A', '2026-08-20', conta.instituicao, 100), t('B', '2026-09-01', conta.instituicao, 200), t('C', '2026-09-05', conta.instituicao, 300)] };
    const semCorte = posicaoBancaria({ ...ds, params: { ...ds.params, corteExtrato: undefined } }).find((p) => p.conta.id === conta.id)!;
    expect(semCorte.creditosBanco).toBe(600);
    const comCorte = posicaoBancaria({ ...ds, params: { ...ds.params, corteExtrato: '2026-09-01' } }).find((p) => p.conta.id === conta.id)!;
    expect(comCorte.creditosBanco).toBe(500); expect(comCorte.saldoBancario).toBeCloseTo(conta.saldoInicial + 500, 2);
    expect(calcTransacoes({ ...ds, params: { ...ds.params, corteExtrato: '2026-09-01' } }).map((x) => x.id)).toEqual(['B', 'C']);
    expect(incluirTransacao({ registro: 'Real', data: '2026-08-31' }, { ...ds.params, corteExtrato: '2026-09-01' })).toBe(false);
    expect(incluirTransacao({ registro: 'Real', data: '2026-09-01' }, { ...ds.params, corteExtrato: '2026-09-01' })).toBe(true);
  });
  it('importação descarta as linhas anteriores ao corte e informa quantas foram', () => {
    actions.salvarParametros({ ...getState().ds.params, corteExtrato: '2026-09-01' });
    const conta = getState().ds.contas.find((c) => c.ativa)!.instituicao;
    const antes = getState().ds.transacoes.length;
    const r = actions.importarTransacoes(conta, [
      { data: '2026-08-30', historico: 'velha', documento: '', debito: 10, credito: 0, idExterno: 'FIT-1' },
      { data: '2026-09-01', historico: 'no corte', documento: '', debito: 0, credito: 20, idExterno: 'FIT-2' },
      { data: '2026-09-03', historico: 'nova', documento: '', debito: 0, credito: 30, idExterno: 'FIT-3' },
    ]);
    expect(r).toEqual({ importadas: 2, duplicadas: 0, antesDoCorte: 1 });
    expect(getState().ds.transacoes.length).toBe(antes + 2);
    expect(getState().ds.transacoes.some((x) => x.idExterno === 'FIT-1')).toBe(false);
    expect(() => actions.salvarParametros({ ...getState().ds.params, corteExtrato: '01/09/2026' })).toThrow(/Corte do extrato/);
  });
});

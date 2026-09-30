// Extrato importado na conta errada: revincular, descartar duplicata e o efeito no caixa por conta.
import { beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { posicaoBancaria } from '../core/engine';

const ds = () => getState().ds;
const saldo = (conta: string) => posicaoBancaria(ds()).find((p) => p.conta.instituicao === conta)?.saldoBancario ?? 0;
const acharPorFitid = (fitid: string) => ds().transacoes.find((t) => t.idExterno === fitid)!;

const ERRADA = 'Banco A (errada)';
const CERTA = 'Banco B (certa)';

/** importa uma linha de extrato pela via real (dedup por FITID, como o OFX) */
const importar = (conta: string, fitid: string, valor: number, data = '2026-09-20') =>
  actions.importarTransacoes(conta, [{
    data, historico: `Movimento ${fitid}`, documento: '',
    debito: valor < 0 ? -valor : 0, credito: valor > 0 ? valor : 0, idExterno: fitid,
  }]);

describe('revincular extrato à conta certa', () => {
  beforeEach(() => {
    actions.trocarUsuario('u-admin');
    actions.restaurarPlanilha();
    for (const [id, instituicao] of [['CTA-ERR', ERRADA], ['CTA-OK', CERTA]] as const) {
      actions.salvarConta({ id, registro: 'Real', instituicao, conta: '0001-0', tipo: 'Conta corrente', saldoInicial: 0, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true });
    }
  });

  it('move a transação, guarda de onde veio e corrige o saldo das duas contas', () => {
    importar(ERRADA, 'FIT-1', 1000);
    expect(saldo(ERRADA)).toBeCloseTo(1000, 2);
    expect(saldo(CERTA)).toBeCloseTo(0, 2);

    const r = actions.moverTransacoes([acharPorFitid('FIT-1').id], CERTA, 'extrato importado na conta errada');
    expect(r.movidas).toBe(1);
    const t = acharPorFitid('FIT-1');
    expect(t.conta).toBe(CERTA);
    expect(t.contaOrigem).toBe(ERRADA);
    expect(t.movidaEm).toBeTruthy();
    expect(saldo(ERRADA)).toBeCloseTo(0, 2);
    expect(saldo(CERTA)).toBeCloseTo(1000, 2);
    expect(ds().auditoria.some((a) => a.acao === 'mover_transacoes')).toBe(true);
  });

  it('descarta a duplicata em vez de mover e tira o valor do caixa da conta errada', () => {
    importar(CERTA, 'FIT-DUP', -17); // a linha certa já estava no lugar certo
    importar(ERRADA, 'FIT-DUP', -17); // e veio de novo no extrato importado errado
    expect(saldo(ERRADA)).toBeCloseTo(-17, 2);

    const errada = ds().transacoes.find((t) => t.idExterno === 'FIT-DUP' && t.conta === ERRADA)!;
    const r = actions.moverTransacoes([errada.id], CERTA, 'duplicata do mesmo extrato');
    expect(r).toMatchObject({ movidas: 0, descartadas: 1 });
    const d = ds().transacoes.find((t) => t.id === errada.id)!;
    expect(d.descartadaEm).toBeTruthy();
    expect(d.conta).toBe(ERRADA); // a linha é descartada onde entrou; nada é apagado
    expect(saldo(ERRADA)).toBeCloseTo(0, 2);
    expect(saldo(CERTA)).toBeCloseTo(-17, 2); // segue só a original
  });

  it('transfere a conciliação da duplicata para a gêmea livre', () => {
    importar(CERTA, 'FIT-C', -50);
    importar(ERRADA, 'FIT-C', -50);
    const errada = ds().transacoes.find((t) => t.idExterno === 'FIT-C' && t.conta === ERRADA)!;
    const gemea = ds().transacoes.find((t) => t.idExterno === 'FIT-C' && t.conta === CERTA)!;
    const lanc = ds().lancamentos.find((l) => l.status !== 'Cancelado' && !l.excluidoEm)!;
    actions.conciliar(errada.id, [lanc.id], 'conciliação feita sobre a linha errada');

    const r = actions.moverTransacoes([errada.id], CERTA, 'duplicata conciliada');
    expect(r.conciliacoesTransferidas).toBe(1);
    expect(ds().transacoes.find((t) => t.id === errada.id)!.lancamentoIds).toEqual([]);
    expect(ds().transacoes.find((t) => t.id === gemea.id)!.lancamentoIds).toEqual([lanc.id]);
  });

  it('o lançamento conciliado acompanha a conta do dinheiro', () => {
    importar(ERRADA, 'FIT-L', -80);
    const t = acharPorFitid('FIT-L');
    const lanc = ds().lancamentos.find((l) => l.status !== 'Cancelado' && !l.excluidoEm)!;
    actions.alterarContaLancamento(lanc.id, ERRADA, 'preparo do teste');
    actions.conciliar(t.id, [lanc.id], 'divergência do teste');

    const r = actions.moverTransacoes([t.id], CERTA, 'extrato na conta errada');
    expect(r.lancamentosRealocados).toBe(1);
    expect(ds().lancamentos.find((l) => l.id === lanc.id)!.contaFinanceira).toBe(CERTA);
    expect(ds().liquidacoes.filter((q) => q.lancamentoId === lanc.id).every((q) => q.conta === CERTA)).toBe(true);
  });

  it('recusa sem motivo, para conta inválida e quando não há o que fazer', () => {
    importar(CERTA, 'FIT-R', -10);
    const id = acharPorFitid('FIT-R').id;
    expect(() => actions.moverTransacoes([id], CERTA, '')).toThrow(/por que/i);
    expect(() => actions.moverTransacoes([id], 'Banco Inexistente', 'x')).toThrow(/não encontrada/i);
    expect(() => actions.moverTransacoes([id], CERTA, 'já está lá')).toThrow(RegraDeNegocioError);
  });

  it('descartar exige motivo e conciliação desfeita; restaurar devolve ao caixa', () => {
    importar(ERRADA, 'FIT-X1', -12);
    importar(ERRADA, 'FIT-X2', -15);
    const x1 = acharPorFitid('FIT-X1').id;
    const x2 = acharPorFitid('FIT-X2').id;
    const lanc = ds().lancamentos.find((l) => l.status !== 'Cancelado' && !l.excluidoEm)!;
    actions.conciliar(x2, [lanc.id], 'divergência do teste');

    expect(() => actions.descartarTransacao(x1, '')).toThrow(RegraDeNegocioError);
    expect(() => actions.descartarTransacao(x2, 'teste')).toThrow(/concilia/i);
    const antes = saldo(ERRADA);
    actions.descartarTransacao(x1, 'linha importada em duplicidade');
    expect(saldo(ERRADA)).toBeCloseTo(antes + 12, 2);
    actions.restaurarTransacao(x1);
    expect(saldo(ERRADA)).toBeCloseTo(antes, 2);
    expect(() => actions.restaurarTransacao(x1)).toThrow(/não está descartada/i);
  });
});

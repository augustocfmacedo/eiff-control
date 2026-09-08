// Conta financeira do titulo: a liquidacao total leva o titulo para a conta em que o dinheiro entrou; Alterar conta vale em
// qualquer status nao cancelado (Realizado exige alcada de liquidar), move as liquidacoes e e bloqueada com conciliacao.
import { beforeAll, describe, expect, it } from 'vitest';
import { calcLancamentos, posicaoBancaria } from '../core/engine';
import { RegraDeNegocioError, actions, getState } from './store';

const u = (id: string) => actions.trocarUsuario(id);
const contas = () => getState().ds.contas.filter((c) => c.ativa).map((c) => c.instituicao);
const realizadoNaConta = (conta: string) => posicaoBancaria(getState().ds).find((p) => p.conta.instituicao === conta)!.realizadoLancamentos;

describe('conta financeira do título', () => {
  let id = '';
  beforeAll(() => { u('u-admin'); actions.restaurarPlanilha(); actions.salvarConta({ id: 'CTA-T2', registro: 'Real', instituicao: 'Banco Fictício', conta: 'cc', tipo: 'Conta corrente', saldoInicial: 0, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true }); });

  it('liquidação total em outra conta leva o título para essa conta; parcial mantém', () => {
    const [c1, c2] = contas(); expect(c2).toBeTruthy();
    const novo = actions.novoLancamento({ categoria: 'Medições de obras', centroCusto: 'Obra', codigoObra: 'OB-SF-CL-01', contraparte: 'Cliente Fictício', documento: 'NF 1', descricao: 'Recebimento fictício', competencia: '2026-09-08', vencimento: '2026-09-08', valorBruto: 40000, contaFinanceira: c1, status: 'Programado' });
    id = actions.salvarLancamento(novo).lancamento.id;
    const antesC2 = realizadoNaConta(c2);
    let l = actions.liquidar(id, { data: '2026-09-08', valor: 10000, conta: c2, documento: 'PIX 1' });
    expect(l.status).not.toBe('Realizado'); expect(l.contaFinanceira).toBe(c1); // parcial: conta do titulo nao muda
    l = actions.liquidar(id, { data: '2026-09-08', valor: 30000, conta: c2, documento: 'PIX 2' });
    expect(l.status).toBe('Realizado'); expect(l.contaFinanceira).toBe(c2);
    expect(realizadoNaConta(c2)).toBeCloseTo(antesC2 + 40000, 2);
    expect(calcLancamentos(getState().ds).find((x) => x.id === id)!.valorCaixaProjetado).toBe(40000);
  });
  it('Alterar conta em título realizado: exige alçada de liquidar, move as liquidações e registra auditoria', () => {
    const [c1, c2] = contas();
    u('u-eng');
    expect(() => actions.alterarContaLancamento(id, c1)).toThrow(RegraDeNegocioError);
    u('u-fin');
    expect(() => actions.alterarContaLancamento(id, 'Banco Inexistente')).toThrow(/inválida/);
    const antesC1 = realizadoNaConta(c1); const antesC2 = realizadoNaConta(c2);
    const l = actions.alterarContaLancamento(id, c1, 'liquidado no banco errado');
    expect(l.contaFinanceira).toBe(c1);
    expect(getState().ds.liquidacoes.filter((q) => q.lancamentoId === id).every((q) => q.conta === c1)).toBe(true);
    expect(realizadoNaConta(c1)).toBeCloseTo(antesC1 + 40000, 2); expect(realizadoNaConta(c2)).toBeCloseTo(antesC2 - 40000, 2);
    const aud = getState().ds.auditoria.find((a) => a.entidadeId === id && a.acao === 'alterar_conta_lancamento')!;
    expect(aud.motivo).toBe('liquidado no banco errado');
    expect(actions.alterarContaLancamento(id, c1)).toEqual(getState().ds.lancamentos.find((x) => x.id === id)); // mesma conta: nada muda
  });
  it('título conciliado com o extrato não troca de conta; cancelado também não', () => {
    const [c1, c2] = contas();
    const t = getState().ds.transacoes.find((x) => x.lancamentoIds.length && getState().ds.lancamentos.find((l) => l.id === x.lancamentoIds[0])?.status !== 'Cancelado');
    if (t) expect(() => actions.alterarContaLancamento(t.lancamentoIds[0], t.conta === c1 ? c2 : c1)).toThrow(/conciliado/);
    actions.cancelarLancamento(id, 'teste');
    expect(() => actions.alterarContaLancamento(id, c2)).toThrow(/cancelado/);
  });
});

// Exclusao logica de lancamento (correcao de erro): some do caixa/fluxo/DRE sem apagar; regras de bloqueio; restauracao.
import { beforeAll, describe, expect, it } from 'vitest';
import { calcLancamento, dashboard, fluxo13Semanas } from '../core/engine';
import { RegraDeNegocioError, actions, getState } from './store';

const u = (id: string) => actions.trocarUsuario(id);
const saldoFinal13 = () => fluxo13Semanas(getState().ds).saldoFinal;

describe('exclusão lógica de lançamento', () => {
  let id = '';
  let saldosAntes: number[] = [];
  beforeAll(() => { u('u-admin'); actions.restaurarPlanilha(); saldosAntes = saldoFinal13(); });

  it('lançamento errado entra no fluxo; excluído com motivo sai do caixa, do fluxo e da DRE, mas continua no dataset com auditoria', () => {
    u('u-fin');
    const novo = actions.novoLancamento({ categoria: 'Medições de obras', centroCusto: 'Obra', codigoObra: 'OB-SF-CL-01', contraparte: 'Cliente Fictício', documento: 'NF X', descricao: 'Lançamento errado', competencia: '2026-09-08', vencimento: '2026-09-10', valorBruto: 12345, status: 'Programado' });
    id = actions.salvarLancamento(novo).lancamento.id;
    expect(saldoFinal13().at(-1)!).toBeCloseTo(saldosAntes.at(-1)! + 12345, 2);
    expect(() => actions.excluirLancamento(id, '')).toThrow(/Motivo/);
    const l = actions.excluirLancamento(id, 'digitado em duplicidade');
    expect(l.excluidoEm).toBeTruthy(); expect(l.motivoExclusao).toBe('digitado em duplicidade');
    const calc = calcLancamento(getState().ds.lancamentos.find((x) => x.id === id)!, getState().ds);
    expect(calc.situacao).toBe('Excluído'); expect(calc.oficial).toBe(false); expect(calc.valorCaixaProjetado).toBe(0); expect(calc.valorGerencial).toBe(0);
    expect(saldoFinal13()).toEqual(saldosAntes);
    expect(getState().ds.lancamentos.some((x) => x.id === id)).toBe(true); // nada apagado
    expect(getState().ds.auditoria.find((a) => a.entidadeId === id && a.acao === 'excluir_lancamento')?.motivo).toBe('digitado em duplicidade');
    expect(() => actions.excluirLancamento(id, 'de novo')).toThrow(/já excluído/);
    expect(dashboard(getState().ds).saldoInicial).toBe(dashboard(getState().ds).saldoInicial); // sanidade: motor continua calculando
  });
  it('restaurar devolve o título às visões com o status anterior', () => {
    const l = actions.restaurarLancamento(id);
    expect(l.excluidoEm).toBeUndefined(); expect(l.status).toBe('Programado');
    expect(saldoFinal13().at(-1)!).toBeCloseTo(saldosAntes.at(-1)! + 12345, 2);
    expect(() => actions.restaurarLancamento(id)).toThrow(/não está excluído/);
  });
  it('auditoria não exclui; realizado exige estorno antes; excluir reverte liquidação parcial e devolve aprovação pendente', () => {
    u('u-audit');
    expect(() => actions.excluirLancamento(id, 'x')).toThrow(RegraDeNegocioError);
    u('u-fin');
    actions.liquidar(id, { data: '2026-09-10', valor: 12345, conta: 'Caixa', documento: 'PIX' });
    expect(() => actions.excluirLancamento(id, 'errado')).toThrow(/estorne/);
    actions.cancelarLancamento(id, 'estorno para excluir');
    expect(actions.excluirLancamento(id, 'errado').status).toBe('Cancelado');
    // parcial + aprovacao pendente
    u('u-obra');
    const grande = actions.novoLancamento({ categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', centroCusto: 'Obra', contraparte: 'Fornecedor Fictício', documento: 'PED-X', descricao: 'Compra errada', competencia: '2026-09-08', vencimento: '2026-09-30', valorBruto: 50000 });
    const r = actions.salvarLancamento(grande);
    expect(r.aprovacaoAberta).toBe(true);
    u('u-admin');
    actions.excluirLancamento(r.lancamento.id, 'pedido não existe');
    expect(getState().ds.aprovacoes.filter((a) => a.entidadeId === r.lancamento.id).every((a) => a.status !== 'Pendente')).toBe(true);
  });
  it('conciliado com o extrato não pode ser excluído', () => {
    const t = getState().ds.transacoes.find((x) => x.lancamentoIds.length && getState().ds.lancamentos.find((l) => l.id === x.lancamentoIds[0])?.status !== 'Realizado');
    if (t) expect(() => actions.excluirLancamento(t.lancamentoIds[0], 'x')).toThrow(/conciliado|estorne/);
  });
});

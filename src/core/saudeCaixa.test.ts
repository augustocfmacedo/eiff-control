import { describe, expect, it } from 'vitest';
import { LIMITES_SAUDE, saudeCaixa } from './saudeCaixa';
import type { Dataset, Lancamento } from './types';
import { actions, getState } from '../data/store';

const HOJE = '2026-10-13';
function base(reservaMinima = 20000): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  const conta = { ...ds.contas[0], ativa: true, saldoInicial: 67410.42, saldoInicialData: HOJE, reservaVinculada: 0 };
  return { ...ds, lancamentos: [], liquidacoes: [], transacoes: [], aprovacoes: [], contas: [conta], params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false, corteExtrato: HOJE, reservaMinima } };
}
let n = 0;
const lanc = (ds: Dataset, p: Partial<Lancamento> & { categoria: string; valorBruto: number; vencimento: string }): Lancamento => {
  n += 1;
  return { id: `S-${n}`, registro: 'Real', subcategoria: '', centroCusto: 'Administrativo', codigoObra: '', contraparte: `C${n}`, documento: '', descricao: `linha ${n}`, competencia: p.vencimento, status: 'Programado', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: ds.contas[0].instituicao, retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [], origem: 'teste', criadoEm: '', criadoPor: '', atualizadoEm: '', atualizadoPor: '', versao: 1, ...p };
};

/** A PLANILHA CAIXA-2026 de 13/10/2026: 10 pagos hoje, previstos de saída (com 4 juros de empréstimo) e de entrada. */
function planilha(reserva = 20000): Dataset {
  let ds = base(reserva);
  for (const v of [12000, 727, 700, 240, 1205, 180, 300, 1200, 8059.49, 810]) {
    const l = lanc(ds, { categoria: 'Outros pagamentos', valorBruto: v, vencimento: HOJE });
    ds = { ...ds, lancamentos: [...ds.lancamentos, { ...l, status: 'Realizado', realizacao: HOJE, valorRealizado: v }], liquidacoes: [...ds.liquidacoes, { id: `Q-${l.id}`, lancamentoId: l.id, data: HOJE, valor: v, conta: l.contaFinanceira, criadoPor: '', criadoEm: '' }] };
  }
  const prev: [string, string, number, string?][] = [
    [HOJE, 'Outros pagamentos', 5000], ['2026-10-15', 'Outros pagamentos', 7000], ['2026-10-15', 'Juros e tarifas bancárias', 1970], ['2026-10-15', 'Juros e tarifas bancárias', 4250],
    ['2026-10-16', 'Outros recebimentos', 19000, 'EEE Confresa'], ['2026-10-16', 'Outros recebimentos', 77531.45, 'Cliente Jataí'], ['2026-10-17', 'Outros pagamentos', 357.53],
    ['2026-10-20', 'Juros e tarifas bancárias', 2530], ['2026-10-20', 'Outros pagamentos', 1000], ['2026-10-21', 'Outros pagamentos', 10496.99], ['2026-10-25', 'Juros e tarifas bancárias', 5000],
    ['2026-10-28', 'Outros recebimentos', 140000, 'Invest Market'], ['2026-10-30', 'Outros recebimentos', 19000, 'EEE Confresa'],
  ];
  for (const [vencimento, categoria, valorBruto, contraparte] of prev) ds = { ...ds, lancamentos: [...ds.lancamentos, lanc(ds, { categoria, valorBruto, vencimento, ...(contraparte ? { contraparte } : {}) })] };
  return ds;
}

describe('saúde do caixa (Fase 1 do CFO)', () => {
  it('planilha de 13/10 com caixa mínimo de 20 mil: cada semáforo no lugar certo', () => {
    const s = saudeCaixa(planilha());
    const por = Object.fromEntries(s.indicadores.map((i) => [i.id, i]));
    expect(por.folga).toMatchObject({ sinal: 'verde', valor: 'R$ 21.988,93' }); // 41.988,93 >= 2 x 20 mil
    expect(por.menor).toMatchObject({ sinal: 'amarelo', valor: 'R$ 23.768,93' }); // acima do mínimo, abaixo de 1,5 x
    expect(por.menor.explicacao).toMatch(/15\/10/);
    expect(por.folego).toMatchObject({ sinal: 'verde', valor: '33 dias' }); // 41.988,93 / (37.604,52 / 30)
    expect(por.cobertura.sinal).toBe('verde');
    expect(por.concentracao).toMatchObject({ sinal: 'amarelo', valor: '55%' }); // Invest Market 140 mil de 255,5 mil
    expect(por.concentracao.explicacao).toMatch(/Invest Market/);
    expect(por.juros).toMatchObject({ sinal: 'vermelho', valor: '37%' }); // 13.750 de juros em 37.604,52 de saídas
    expect(por.pagar_vencido.sinal).toBe('verde');
    expect(por.receber_vencido.sinal).toBe('verde');
    expect(por.extrato).toMatchObject({ sinal: 'vermelho', valor: 'sem extrato' });
    expect(s).toMatchObject({ geral: 'vermelho', vermelhos: 2, amarelos: 2, janela: LIMITES_SAUDE.janelaDias });
  });
  it('limites do caixa mínimo: abaixo do mínimo é vermelho; sem mínimo definido, positivo é verde', () => {
    const apertado = saudeCaixa(planilha(30000)).indicadores.find((i) => i.id === 'menor')!;
    expect(apertado.sinal).toBe('vermelho'); // 23.768,93 < 30 mil
    const semMinimo = saudeCaixa(planilha(0)).indicadores;
    expect(semMinimo.find((i) => i.id === 'folga')!.sinal).toBe('verde');
    expect(semMinimo.find((i) => i.id === 'menor')!.sinal).toBe('verde');
  });
  it('vencidos e extrato: pagamento vencido é vermelho; recebimento até 15 dias é amarelo; extrato de hoje é verde', () => {
    let ds = planilha();
    ds = { ...ds, lancamentos: [...ds.lancamentos, lanc(ds, { categoria: 'Outros pagamentos', valorBruto: 100, vencimento: '2026-10-10' }), lanc(ds, { categoria: 'Outros recebimentos', valorBruto: 500, vencimento: '2026-10-05' })],
      transacoes: [{ id: 'T1', registro: 'Real', data: HOJE, conta: ds.contas[0].instituicao, historico: 'x', documento: '', debito: 0, credito: 0.01, lancamentoIds: [], origem: 'teste' }] };
    const por = Object.fromEntries(saudeCaixa(ds).indicadores.map((i) => [i.id, i]));
    expect(por.pagar_vencido).toMatchObject({ sinal: 'vermelho', valor: 'R$ 100,00' });
    expect(por.receber_vencido.sinal).toBe('amarelo'); // 8 dias de atraso
    expect(por.extrato).toMatchObject({ sinal: 'verde', valor: 'até 13/10' });
  });
});

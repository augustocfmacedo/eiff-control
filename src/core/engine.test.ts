// Valida o motor contra os valores calculados pela planilha Fluxo_de_Caixa_EIFF.xlsx
// (data-base 01/09/2026, cenario Base, reserva minima 0).
import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Dataset, Lancamento } from './types';
import {
  calcLancamentos,
  dashboard,
  dreGerencial,
  etapasExigidas,
  executarChecks,
  fluxo13Semanas,
  fluxo24Meses,
  impactoLancamento,
  obra360,
  posicaoBancaria,
  saldoInicial,
  segundaDaSemana,
  statusModelo,
  sugerirConciliacao,
  calcTransacoes,
} from './engine';

const ds = seed as unknown as Dataset;
const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('datas', () => {
  it('semana caixa = segunda-feira (LANCAMENTOS!AD)', () => {
    expect(segundaDaSemana('2026-09-10')).toBe('2026-09-07');
    expect(segundaDaSemana('2026-08-10')).toBe('2026-08-10');
    expect(segundaDaSemana('2027-01-10')).toBe('2027-01-04');
  });
});

describe('lancamentos', () => {
  const lancs = calcLancamentos(ds);
  it('REC-SF-CL-001 reproduz colunas X, Z, AB, AI', () => {
    const l = lancs.find((x) => x.id === 'REC-SF-CL-001')!;
    expect(l.tipo).toBe('Entrada');
    expect(l.grupoFluxo).toBe('Receitas Operacionais');
    expect(l.valorLiquidoPrevisto).toBeCloseTo(150076.25, 2);
    expect(l.dataCaixa).toBe('2026-09-10');
    expect(l.valorCaixaProjetado).toBeCloseTo(150076.25, 2);
    expect(l.situacao).toBe('A vencer');
    expect(l.mesCompetencia).toBe(202609);
  });
  it('REC-SF-CL-002 esta atrasado', () => {
    const l = lancs.find((x) => x.id === 'REC-SF-CL-002')!;
    expect(l.situacao).toBe('Atrasado');
    expect(l.diasAtraso).toBe(22);
  });
  it('folha gera saida negativa no caixa', () => {
    const l = lancs.find((x) => x.id === 'PAG-FOLHA-2026-09')!;
    expect(l.tipo).toBe('Saída');
    expect(l.valorCaixaProjetado).toBeCloseTo(-63220.04, 2);
    expect(l.valorGerencial).toBeCloseTo(-63220.04, 2);
  });
});

describe('fluxo 13 semanas (FLUXO 13S)', () => {
  const f = fluxo13Semanas(ds);
  it('saldo inicial = CONFIG!B13', () => {
    expect(saldoInicial(ds)).toBeCloseTo(11544.48, 2);
    expect(f.saldoInicial).toBeCloseTo(11544.48, 2);
  });
  it('S1 e S2 batem com a planilha', () => {
    expect(f.periodos[0].ini).toBe('2026-09-01');
    expect(f.periodos[0].fim).toBe('2026-09-07');
    expect(f.saldoFinal[0]).toBeCloseTo(-51675.56, 2);
    expect(f.totalEntradas[1]).toBeCloseTo(488745.24, 2);
    expect(f.saldoFinal[1]).toBeCloseTo(437069.68, 2);
  });
  it('totais de 13 semanas (DASHBOARD)', () => {
    expect(soma(f.totalEntradas)).toBeCloseTo(1340174.27, 2);
    expect(soma(f.totalSaidas)).toBeCloseTo(189660.12, 2);
    expect(f.saldoFinal[12]).toBeCloseTo(1162058.63, 2);
    expect(f.menorSaldo).toBeCloseTo(-51675.56, 2);
    expect(f.necessidadeMaxima).toBeCloseTo(51675.56, 2);
  });
  it('cenario conservador reduz entradas e aumenta saidas', () => {
    const c = fluxo13Semanas(ds, 'Conservador');
    expect(soma(c.totalEntradas)).toBeCloseTo(1340174.27 * 0.85, 2);
    expect(soma(c.totalSaidas)).toBeCloseTo(189660.12 * 1.05, 2);
  });
});

describe('fluxo 24 meses (FLUXO 24M)', () => {
  const f = fluxo24Meses(ds);
  it('set/26 e out/26', () => {
    expect(f.periodos[0].ini).toBe('2026-09-01');
    expect(f.periodos[0].fim).toBe('2026-09-30');
    expect(f.totalEntradas[0]).toBeCloseTo(488745.24, 2);
    expect(f.totalSaidas[0]).toBeCloseTo(63220.04, 2);
    expect(f.saldoFinal[0]).toBeCloseTo(437069.68, 2);
    expect(f.totalEntradas[1]).toBeCloseTo(430933.51, 2);
    expect(f.saldoFinal[1]).toBeCloseTo(804783.15, 2);
  });
  it('linhas por grupo de fluxo', () => {
    const pessoal = f.grupos[2].linhas.find((l) => l.nome === 'Despesas com Pessoal')!;
    expect(pessoal.valores[0]).toBeCloseTo(63220.04, 2);
  });
});

describe('DRE gerencial', () => {
  const d = dreGerencial(ds);
  const linha = (n: string) => d.linhas.find((l) => l.nome === n)!.valores;
  it('set/26 e out/26 por competencia', () => {
    expect(linha('RECEITA BRUTA')[0]).toBeCloseTo(488745.24, 2);
    expect(linha('EBITDA GERENCIAL')[0]).toBeCloseTo(425525.2, 2);
    expect(linha('RECEITA BRUTA')[1]).toBeCloseTo(430933.51, 2);
    expect(linha('EBITDA GERENCIAL')[1]).toBeCloseTo(367713.47, 2);
    expect(linha('MARGEM EBITDA')[0]).toBeCloseTo(0.8706, 3);
  });
});

describe('obra 360 (OBRAS)', () => {
  // paridade com a planilha: sem servicos cadastrados, a obra usa os campos manuais (custo orcado e ETC)
  const o = obra360({ ...ds, servicos: [] }, ds.obras[0]);
  it('reproduz colunas M, T, U, V, W, Y, Z, AB', () => {
    expect(o.receitaTotal).toBe(1291500);
    expect(o.saldoAMedir).toBe(1133525);
    expect(o.contasAReceber).toBe(157975);
    expect(o.custoComprometido).toBe(0);
    expect(o.custoPago).toBe(0);
    expect(o.eac).toBe(0);
    expect(o.margemProjetada).toBe(1291500);
    expect(o.caixaGerado).toBe(0);
  });
  it('EAC = pago + comprometido em aberto + ETC nao comprometido', () => {
    const obra = { ...ds.obras[0], estimativaConcluir: 900000, custoOrcado: 1000000 };
    const extra: Lancamento = {
      ...ds.lancamentos[0], id: 'PAG-TESTE', categoria: 'Aço e perfis', codigoObra: obra.codigo, valorBruto: 200000, retencoes: 0, desconto: 0, multaJuros: 0, status: 'Aprovado',
    };
    const ds2: Dataset = { ...ds, obras: [obra], lancamentos: [...ds.lancamentos, extra], servicos: [] }; // sem servicos: ETC manual da obra
    const o2 = obra360(ds2, obra);
    expect(o2.custoComprometido).toBe(200000);
    expect(o2.comprometidoAberto).toBe(200000);
    expect(o2.etcNaoComprometido).toBe(700000);
    expect(o2.eac).toBe(900000);
    expect(o2.margemProjetada).toBe(391500);
    expect(o2.orcamentoDisponivel).toBe(800000);
  });
});

describe('painel executivo (DASHBOARD)', () => {
  const d = dashboard(ds);
  it('KPIs e alertas', () => {
    expect(d.saldoInicial).toBeCloseTo(11544.48, 2);
    expect(d.saldoFinal13s).toBeCloseTo(1162058.63, 2);
    expect(d.menorSaldo13s).toBeCloseTo(-51675.56, 2);
    expect(d.entradas13s).toBeCloseTo(1340174.27, 2);
    expect(d.saidas13s).toBeCloseTo(189660.12, 2);
    expect(d.backlog).toBe(1291500);
    expect(d.obrasAtivas).toBe(1);
    expect(d.receitaContratada).toBe(1291500);
    expect(d.recebiveisVencidos).toBe(193975);
    expect(d.pagamentosVencidos).toBe(0);
    expect(d.realizadosSemConciliacao).toBe(0);
    expect(d.obrasMargemNegativa).toBe(0);
    // com servicos derivados da planilha (saldo 1.133.525 com margem alvo 25%), EAC = 850.143,75
    expect(d.custoTotalProjetado).toBeCloseTo(1133525 * 0.75, 0);
    expect(d.margemCarteira).toBeCloseTo((1291500 - 1133525 * 0.75) / 1291500, 4);
  });
  it('aging a receber classifica o atrasado em 8-30 dias', () => {
    expect(d.agingReceber[2].valor).toBe(193975);
    expect(d.agingReceber[0].quantidade).toBe(16);
  });
});

describe('checks (CHECKS)', () => {
  const c = executarChecks(ds);
  it('modelo passa e alerta reserva', () => {
    expect(statusModelo(c)).toBe('PASS');
    expect(c.find((x) => x.id === 'CHK-09')!.status).toBe('OK');
    expect(c.find((x) => x.id === 'CHK-10')!.status).toBe('OK');
    expect(c.find((x) => x.id === 'ALT-02')!.status).toBe('ATENÇÃO');
  });
  it('detecta ID duplicado e categoria invalida', () => {
    const ds2: Dataset = { ...ds, lancamentos: [...ds.lancamentos, { ...ds.lancamentos[0] }, { ...ds.lancamentos[1], id: 'X-1', categoria: 'Inexistente' }] };
    const c2 = executarChecks(ds2);
    expect(c2.find((x) => x.id === 'CHK-12')!.status).toBe('FALHA');
    expect(c2.find((x) => x.id === 'CHK-03')!.status).toBe('FALHA');
    expect(statusModelo(c2)).toBe('FAIL');
  });
});

describe('aprovacoes e impacto', () => {
  it('etapas por alcada', () => {
    expect(etapasExigidas(ds.params, 5000, true, false)).toEqual(['Gestor de obra']);
    expect(etapasExigidas(ds.params, 50000, true, false)).toEqual(['Gestor de obra', 'Financeiro']);
    expect(etapasExigidas(ds.params, 500000, true, false)).toEqual(['Gestor de obra', 'Financeiro', 'Diretoria']);
    expect(etapasExigidas(ds.params, 100, false, false)).toEqual(['Financeiro']);
    expect(etapasExigidas(ds.params, 100, true, true)).toEqual(['Gestor de obra', 'Financeiro', 'Diretoria']);
  });
  it('impacto no caixa de 13 semanas', () => {
    const novo: Lancamento = { ...ds.lancamentos[17], id: 'PAG-NOVO', valorBruto: 100000, vencimento: '2026-09-03', competencia: '2026-09-03', status: 'Pendente' };
    const imp = impactoLancamento(ds, novo);
    expect(imp.saldoMinimo13sAntes).toBeCloseTo(-51675.56, 2);
    expect(imp.saldoMinimo13sDepois).toBeCloseTo(-151675.56, 2);
    expect(imp.abaixoDaReserva).toBe(true);
  });
});

describe('roll-forward do saldo inicial com data-base a frente da abertura', () => {
  it('saldo inicial do fluxo = abertura + realizados entre a abertura e o dia anterior a data-base', () => {
    const pago: Lancamento = { ...ds.lancamentos[17], id: 'PAG-T1', status: 'Realizado', realizacao: '2026-09-02', vencimento: '2026-09-02', valorBruto: 1000, retencoes: 0, desconto: 0, multaJuros: 0, valorRealizado: 1000, contaFinanceira: 'Caixa' };
    const hoje: Lancamento = { ...pago, id: 'PAG-T2', realizacao: '2026-09-03', vencimento: '2026-09-03', valorBruto: 50, valorRealizado: 50 };
    const ds2: Dataset = { ...ds, params: { ...ds.params, dataBase: '2026-09-03' }, contas: [{ ...ds.contas[0], saldoInicial: 44012.24, saldoInicialData: '2026-09-01' }], lancamentos: [...ds.lancamentos, pago, hoje] };
    expect(saldoInicial(ds2)).toBeCloseTo(44012.24 - 1000, 2); // o de hoje entra na semana 1, nao no saldo inicial
    const f = fluxo13Semanas(ds2);
    expect(f.saldoInicial).toBeCloseTo(43012.24, 2);
    expect(f.periodos[0].ini).toBe('2026-09-03');
    expect(f.totalSaidas[0]).toBeCloseTo(50 + 63220.04, 2); // pago hoje + folha de 07/09 na mesma semana
    // posicao bancaria continua ancorada na data de abertura, nao na data-base
    const [p] = posicaoBancaria({ ...ds2, transacoes: [{ id: 'X', registro: 'Real', data: '2026-09-01', conta: 'Caixa', historico: 'x', documento: '', debito: 700, credito: 0, lancamentoIds: [], origem: 'ofx' }] });
    expect(p.debitosBanco).toBe(700);
    expect(p.realizadoLancamentos).toBeCloseTo(-1050, 2);
  });
});

describe('posicao bancaria', () => {
  it('saldo bancario = abertura + extrato; saldo por lancamentos = abertura + realizados; diferenca = nao lancado', () => {
    const t = (id: string, data: string, debito: number, credito: number, lancamentoIds: string[] = []) => ({ id, registro: 'Real' as const, data, conta: 'Caixa', historico: id, documento: '', debito, credito, lancamentoIds, origem: 'ofx' });
    const ds2: Dataset = {
      ...ds,
      contas: [{ ...ds.contas[0], saldoInicial: 44012.24 }],
      transacoes: [t('A', '2026-09-01', 2500, 0), t('B', '2026-09-02', 140.38, 0), t('C', '2026-09-03', 0, 200), t('D', '2026-08-30', 999, 0)],
    };
    const [p] = posicaoBancaria(ds2);
    expect(p.saldoInicial).toBe(44012.24);
    expect(p.debitosBanco).toBeCloseTo(2640.38, 2); // D esta antes da data-base e fica fora
    expect(p.creditosBanco).toBe(200);
    expect(p.saldoBancario).toBeCloseTo(44012.24 - 2640.38 + 200, 2);
    expect(p.realizadoLancamentos).toBe(0);
    expect(p.saldoLancamentos).toBe(44012.24);
    expect(p.naoLancado).toBeCloseTo(-2440.38, 2);
    expect(p.transacoesPendentes).toBe(3);
  });
});

describe('conciliacao', () => {
  it('sugere e concilia por valor e data', () => {
    const t = { id: 'EXT-1', registro: 'Real' as const, data: '2026-09-10', conta: 'Caixa', historico: 'PIX INVEST MARKET NF 47', documento: 'NF 47', debito: 0, credito: 150076.25, lancamentoIds: [], origem: 'teste' };
    const sug = sugerirConciliacao(ds, t);
    expect(sug[0].lancamento.id).toBe('REC-SF-CL-001');
    expect(sug[0].score).toBeGreaterThanOrEqual(90);
    const ds2: Dataset = { ...ds, transacoes: [{ ...t, lancamentoIds: ['REC-SF-CL-001'] }] };
    const tc = calcTransacoes(ds2)[0];
    expect(tc.status).toBe('Conciliado');
    expect(tc.diferenca).toBeCloseTo(0, 2);
  });
});

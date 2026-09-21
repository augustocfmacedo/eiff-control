import { describe, expect, it } from 'vitest';
import planilha from './__fixtures__/faturamento-smartfit.json';
import { acompanhamentoFaturamento, parcelasDoLancamento } from './faturamento';
import type { Lancamento, Medicao, PlanoConta, RateioFaturamento, Servico } from './types';

// A fixture e a leitura da planilha que a EIFF usava para controlar o contrato
// (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx), extraida por
// scripts/faturamento-planilha.mjs. O motor tem de reproduzir a mesma conta, centavo a centavo.

const OBRA = 'OB-SF-CL-01';

const servicos: Servico[] = planilha.resumo.map((r) => ({
  id: r.servico, codigoObra: OBRA, codigo: r.servico, nome: r.etapa, etapa: 'Outros', unidade: 'vb',
  quantidadeOrcada: 1, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: r.previstoConstrutora,
  faturamentoDireto: r.previstoDireto, status: 'Não iniciado', observacoes: '', ativo: true,
}));

const medicoes: Medicao[] = planilha.cronograma.map((e) => ({
  id: `M-${e.evento}`, codigoObra: OBRA, servicoId: e.servico, numero: e.evento, mes: e.mes, etapa: e.etapa,
  evento: e.titulo, escopo: e.escopo, criterio: '', documentos: '', tipoMedicao: 'Evento físico', responsavelAprovacao: '',
  valorBruto: e.bruto, faturamentoDireto: e.direto, faturamentoConstrutora: e.construtora, retencao: e.retencao,
  pctEvolucaoPlanejada: 0, status: 'Pendente', observacoes: '',
}));

const vazio = {
  registro: 'Real' as const, subcategoria: '', centroCusto: '', confiabilidade: 'Confirmado' as const, probabilidade: 1,
  contaFinanceira: 'CX-01', retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [],
  origem: 'planilha', criadoEm: '2026-09-16', criadoPor: 'teste', atualizadoEm: '2026-09-16', atualizadoPor: 'teste', versao: 1,
};

// faturamento direto: uma linha da planilha = um titulo de saida com faturamento direto
const diretos: Lancamento[] = planilha.notas.filter((n) => n.frente === 'Direto').map((n, i) => ({
  ...vazio, id: `D-${i}`, categoria: 'Outros custos diretos', codigoObra: OBRA, servicoId: n.servico,
  faturamentoDireto: true, enviadoClienteEm: n.enviadoCliente ? n.data : undefined, contraparte: n.fornecedor,
  documento: n.nf, descricao: n.descricao, competencia: n.data ?? '2026-09-16', vencimento: n.data ?? '2026-09-16',
  tipo: 'Saída' as const, status: n.situacao === 'Estimativa' ? ('Rascunho' as const) : ('Programado' as const), valorBruto: n.valor,
}));

// faturamento da construtora: uma NF cobre varias etapas -> um titulo de entrada com rateio por servico
const notasConstrutora = [...new Set(planilha.notas.filter((n) => n.frente === 'Construtora').map((n) => n.nf))];
const construtora: Lancamento[] = notasConstrutora.map((nf) => {
  const linhas = planilha.notas.filter((n) => n.frente === 'Construtora' && n.nf === nf);
  return {
    ...vazio, id: `C-${nf}`, categoria: 'Receita de contrato', codigoObra: OBRA, contraparte: linhas[0].fornecedor,
    documento: nf, descricao: linhas[0].descricao, competencia: linhas[0].data ?? '2026-09-01', vencimento: linhas[0].data ?? '2026-09-01',
    tipo: 'Entrada' as const, status: 'Programado' as const, valorBruto: linhas.reduce((a, l) => a + l.valor, 0),
  };
});
const rateios: RateioFaturamento[] = planilha.notas.filter((n) => n.frente === 'Construtora').map((n, i) => ({
  id: `R-${i}`, lancamentoId: `C-${n.nf}`, codigoObra: OBRA, servicoId: n.servico, descricao: n.descricao,
  valor: n.valor, criadoEm: '2026-09-16', criadoPor: 'teste',
}));

const planoContas: PlanoConta[] = [
  { categoria: 'Outros custos diretos', tipo: 'Saída', grupoFluxo: 'Custos', grupoDre: 'Custos', classe: 'Direto', orientacao: '', ativa: true },
  { categoria: 'Receita de contrato', tipo: 'Entrada', grupoFluxo: 'Receitas', grupoDre: 'Receita', classe: 'Receita', orientacao: '', ativa: true },
];

const base = { codigoObra: OBRA, servicos, medicoes, lancamentos: [...diretos, ...construtora], rateios, planoContas };

describe('acompanhamento de faturamento contra a planilha', () => {
  const r = acompanhamentoFaturamento(base);

  it('reproduz o contrato por etapa (bruto, retenção e as duas frentes previstas)', () => {
    for (const esperado of planilha.resumo) {
      const linha = r.etapas.find((e) => e.servicoId === esperado.servico)!;
      expect(linha, esperado.etapa).toBeTruthy();
      expect(linha.contratadoBruto, esperado.etapa).toBeCloseTo(esperado.bruto, 2);
      expect(linha.contratadoLiquido, esperado.etapa).toBeCloseTo(esperado.liquido, 2);
      expect(linha.previstoDireto, esperado.etapa).toBeCloseTo(esperado.previstoDireto, 2);
      expect(linha.previstoConstrutora, esperado.etapa).toBeCloseTo(esperado.previstoConstrutora, 2);
    }
    expect(r.totais.contratadoBruto).toBeCloseTo(planilha.totais.contratoBruto, 2);
    expect(r.totais.previstoDireto).toBeCloseTo(planilha.totais.contratoDireto, 2);
    expect(r.totais.previstoConstrutora).toBeCloseTo(planilha.totais.contratoConstrutora, 2);
    expect(r.totais.retencao).toBeCloseTo(planilha.totais.retencao, 2);
  });

  it('reproduz o faturado por etapa nas duas frentes', () => {
    for (const esperado of planilha.resumo) {
      const linha = r.etapas.find((e) => e.servicoId === esperado.servico)!;
      // a planilha soma estimativa junto com o faturado direto; o motor separa as duas
      expect(linha.faturadoDireto + linha.estimativaDireto, esperado.etapa).toBeCloseTo(esperado.faturadoDireto, 2);
      expect(linha.faturadoConstrutora, esperado.etapa).toBeCloseTo(esperado.faturadoConstrutora, 2);
    }
  });

  it('reproduz os totais faturados e o saldo do contrato', () => {
    expect(r.totais.faturadoDireto).toBeCloseTo(planilha.totais.faturadoDireto, 2);
    expect(r.totais.estimativaDireto).toBeCloseTo(planilha.totais.estimativas, 2);
    expect(r.totais.faturadoConstrutora).toBeCloseTo(planilha.totais.faturadoConstrutora, 2);
    expect(r.totais.faturadoTotal).toBeCloseTo(planilha.totais.faturadoTotal, 2);
    expect(r.totais.saldo).toBeCloseTo(4100000 - planilha.totais.faturadoTotal, 2);
    // o saldo da planilha e sobre o liquido e ja conta as estimativas: 4.100.000 - 410.000 - 483.285,52
    const saldoPlanilha = r.totais.contratadoLiquido - (r.totais.faturadoTotal + r.totais.estimativaDireto);
    expect(saldoPlanilha).toBeCloseTo(3206714.48, 2);
  });

  it('agrupa por nota: a NF da construtora cobre várias etapas e a NF 38 do direto, duas', () => {
    const nf47 = r.notas.find((n) => n.documento === '47')!;
    expect(nf47.frente).toBe('Construtora');
    expect(nf47.itens).toHaveLength(4);
    expect(nf47.valor).toBeCloseTo(157975, 2);
    const nf38 = r.notas.find((n) => n.documento === '38')!;
    expect(nf38.frente).toBe('Direto');
    expect(nf38.itens.map((i) => i.etapa).sort()).toEqual(['Fundação e Arrimo', 'Movimentação de Terra']);
    expect(nf38.valor).toBeCloseTo(30000, 2);
  });

  it('marca o que ainda não foi repassado ao cliente', () => {
    // ferragem 16.500 + concreto 65.220 + EPI 2.136,04 estão faturados e não enviados
    expect(r.totais.diretoNaoEnviado).toBeCloseTo(16500 + 65220 + 2136.04, 2);
    const naoEnviadas = r.notas.filter((n) => n.frente === 'Direto' && n.situacao === 'Faturado' && !n.enviadoClienteEm);
    expect(naoEnviadas).toHaveLength(3);
  });
});

describe('regras do acompanhamento', () => {
  const lanc = (p: Partial<Lancamento>): Lancamento => ({ ...diretos[0], id: 'X-1', ...p });

  it('rascunho é estimativa, cancelado e excluído ficam de fora', () => {
    const r = acompanhamentoFaturamento({
      ...base,
      lancamentos: [
        lanc({ id: 'X-1', status: 'Rascunho', valorBruto: 1000, servicoId: 'SFCL-06', documento: 'X1' }),
        lanc({ id: 'X-2', status: 'Cancelado', valorBruto: 2000, servicoId: 'SFCL-06', documento: 'X2' }),
        lanc({ id: 'X-3', status: 'Programado', valorBruto: 3000, servicoId: 'SFCL-06', documento: 'X3', excluidoEm: '2026-09-10' }),
        lanc({ id: 'X-4', status: 'Programado', valorBruto: 4000, servicoId: 'SFCL-06', documento: 'X4' }),
      ],
    });
    const linha = r.etapas.find((e) => e.servicoId === 'SFCL-06')!;
    expect(linha.estimativaDireto).toBe(1000);
    expect(linha.faturadoDireto).toBe(4000);
  });

  it('receita prevista sem rateio e sem medição não é faturamento', () => {
    const prevista: Lancamento = { ...construtora[0], id: 'P-1', documento: 'REC-SF-CL-003', valorBruto: 172000, servicoId: undefined };
    const r = acompanhamentoFaturamento({ ...base, lancamentos: [prevista], rateios: [] });
    expect(r.totais.faturadoConstrutora).toBe(0);
    expect(r.notas).toHaveLength(0);
  });

  it('sem rateio, a entrada vinculada a medições rateia na proporção da parte da construtora', () => {
    const meds: Medicao[] = [
      { ...medicoes[0], id: 'M-A', servicoId: 'SFCL-01', faturamentoConstrutora: 15750, lancamentoId: 'E-1', status: 'Faturado' },
      { ...medicoes[1], id: 'M-B', servicoId: 'SFCL-02', faturamentoConstrutora: 47250, lancamentoId: 'E-1', status: 'Faturado' },
    ];
    const entrada: Lancamento = { ...construtora[0], id: 'E-1', documento: 'NF 99', valorBruto: 63000 };
    const r = acompanhamentoFaturamento({ ...base, medicoes: meds, lancamentos: [entrada], rateios: [] });
    expect(r.etapas.find((e) => e.servicoId === 'SFCL-01')!.faturadoConstrutora).toBeCloseTo(15750, 2);
    expect(r.etapas.find((e) => e.servicoId === 'SFCL-02')!.faturadoConstrutora).toBeCloseTo(47250, 2);
  });

  it('parcelas: o rateio manda; sem rateio vale o serviço do título', () => {
    const l = lanc({ id: 'Y-1', servicoId: 'SFCL-06', valorBruto: 1000 });
    expect(parcelasDoLancamento(l, [])).toEqual([{ servicoId: 'SFCL-06', descricao: l.descricao, valor: 1000 }]);
    const r: RateioFaturamento[] = [
      { id: 'r1', lancamentoId: 'Y-1', codigoObra: OBRA, servicoId: 'SFCL-06', descricao: 'parte A', valor: 600, criadoEm: '', criadoPor: '' },
      { id: 'r2', lancamentoId: 'Y-1', codigoObra: OBRA, servicoId: 'SFCL-07', descricao: 'parte B', valor: 400, criadoEm: '', criadoPor: '' },
    ];
    expect(parcelasDoLancamento(l, r).map((p) => p.valor)).toEqual([600, 400]);
  });
});

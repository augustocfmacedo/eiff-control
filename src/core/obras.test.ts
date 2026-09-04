import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Dataset, Demanda, Lancamento, Medicao, OrdemProducao, Servico } from './types';
import { calcLancamentos, obra360 } from './engine';
import { calcDemanda, calcMedicao, calcOrdem, calcServico, chavePeriodo, etapasPadrao, resumoMedicoes, resumoProducao, resumoServicos } from './obras';

const ds = seed as unknown as Dataset;
const DB = ds.params.dataBase; // 2026-09-01

describe('servicos derivados da planilha', () => {
  it('cria um servico por receita prevista e vincula os lancamentos', () => {
    expect(ds.servicos.length).toBe(6);
    const est = ds.servicos.find((s) => s.nome.toLowerCase().includes('estrutura met'))!;
    expect(est.etapa).toBe('Fabricação');
    // precos redistribuidos: saldo do contrato (1.291.500 - 157.975 = 1.133.525) na proporcao das receitas previstas (1.803.231,52)
    expect(est.precoVenda).toBeCloseTo(((61818.99 + 71091.84 + 103546.81 + 16828.5) / 1803231.52) * 1133525, 1);
    expect(est.inicioPrevisto).toBe('2026-09-01');
    expect(est.fimPrevisto).toBe('2026-12-10');
    expect(ds.lancamentos.filter((l) => l.servicoId === est.id)).toHaveLength(4);
    // soma dos precos de venda = soma das receitas previstas da planilha (1.803.231,52), que excede o
    // saldo do contrato (1.291.500 - 157.975 = 1.133.525): inconsistencia real da planilha, sinalizada na tela
    const totalVenda = ds.servicos.reduce((a, s) => a + s.precoVenda, 0);
    expect(totalVenda).toBeCloseTo(1133525, 1);
  });
});

describe('calculo do servico', () => {
  const base: Servico = { id: 'S1', codigoObra: 'OB-SF-CL-01', codigo: 'X-01', nome: 'Teste', etapa: 'Fabricação', unidade: 't', quantidadeOrcada: 100, quantidadeExecutada: 40, custoOrcado: 500000, precoVenda: 800000, inicioPrevisto: '2026-08-01', fimPrevisto: '2026-10-30', status: 'Em andamento', observacoes: '', ativo: true };
  const lanc = (p: Partial<Lancamento>): Lancamento => ({ ...ds.lancamentos[17], id: `T-${Math.random()}`, categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', servicoId: 'S1', valorBruto: 100000, retencoes: 0, desconto: 0, multaJuros: 0, status: 'Aprovado', ...p });
  it('ETC derivado = orcado - comprometido; EAC = pago + aberto + ETC', () => {
    const ds2: Dataset = { ...ds, servicos: [base], lancamentos: [...ds.lancamentos, lanc({}), lanc({ status: 'Realizado', realizacao: '2026-08-20', valorRealizado: 100000, vencimento: '2026-08-20' })] };
    const s = calcServico(base, calcLancamentos(ds2), DB);
    expect(s.custoComprometido).toBe(200000);
    expect(s.custoPago).toBe(100000);
    expect(s.comprometidoAberto).toBe(100000);
    expect(s.etc).toBe(300000);
    expect(s.etcDerivado).toBe(true);
    expect(s.eac).toBe(500000);
    expect(s.margemProjetada).toBe(300000);
    expect(s.pctExecucao).toBeCloseTo(0.4, 4);
    expect(s.situacaoPrazo).toBe('No prazo'); // decorrido 31/90 = 34% vs fisico 40%
  });
  it('ETC informado substitui o derivado e estouro de orcamento aparece no desvio', () => {
    const ds2: Dataset = { ...ds, servicos: [{ ...base, estimativaConcluir: 450000 }], lancamentos: [...ds.lancamentos, lanc({})] };
    const s = calcServico({ ...base, estimativaConcluir: 450000 }, calcLancamentos(ds2), DB);
    expect(s.eac).toBe(100000 + 350000); // aberto 100k + (450k - 100k) nao comprometido
    expect(s.desvioOrcamento).toBe(-50000);
  });
  it('prazo: atrasado e em risco', () => {
    expect(calcServico({ ...base, fimPrevisto: '2026-08-30' }, [], DB).situacaoPrazo).toBe('Atrasado');
    expect(calcServico({ ...base, quantidadeExecutada: 5 }, [], DB).situacaoPrazo).toBe('Em risco'); // 5% fisico vs 34% calendario
    expect(calcServico({ ...base, status: 'Concluído' }, [], DB).situacaoPrazo).toBe('Concluído');
  });
  it('resumo pondera o fisico pelo custo orcado', () => {
    const r = resumoServicos([{ ...base, id: 'A' }, { ...base, id: 'B', custoOrcado: 1500000, quantidadeExecutada: 0, status: 'Não iniciado' }], [], DB);
    expect(r.execucaoFisica).toBeCloseTo((500000 * 0.4) / 2000000, 4);
    expect(r.custoOrcado).toBe(2000000);
  });
});

describe('obra 360 com servicos', () => {
  it('usa orcamento, ETC e fisico dos servicos; custos sem servico entram no EAC', () => {
    const servs: Servico[] = [
      { id: 'A', codigoObra: 'OB-SF-CL-01', codigo: 'A', nome: 'A', etapa: 'Fabricação', unidade: 't', quantidadeOrcada: 10, quantidadeExecutada: 5, custoOrcado: 600000, precoVenda: 1291500, status: 'Em andamento', observacoes: '', ativo: true },
    ];
    const semServico: Lancamento = { ...ds.lancamentos[17], id: 'T-X', categoria: 'Transporte e mobilização', codigoObra: 'OB-SF-CL-01', servicoId: undefined, valorBruto: 20000, retencoes: 0, desconto: 0, multaJuros: 0, status: 'Aprovado' };
    const ds2: Dataset = { ...ds, servicos: servs, lancamentos: [...ds.lancamentos, semServico] };
    const o = obra360(ds2, ds2.obras[0]);
    expect(o.temServicos).toBe(true);
    expect(o.custoOrcado).toBe(600000);
    expect(o.execucaoFisica).toBe(0.5);
    expect(o.eac).toBe(600000 + 20000);
    expect(o.custoComprometido).toBe(20000);
    expect(o.etc).toBe(620000); // tudo que falta: 20k comprometido em aberto + 600k nao comprometido
    expect(o.margemProjetada).toBe(1291500 - 620000);
  });
});

describe('medicoes do cronograma e custo previsto por margem alvo', () => {
  const srv: Servico = { id: 'S-EM', codigoObra: 'OB-SF-CL-01', codigo: 'SFCL-06', nome: 'Estrutura metálica', etapa: 'Fabricação', unidade: 'vb', quantidadeOrcada: 1, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 162000, faturamentoDireto: 620000, status: 'Não iniciado', observacoes: '', ativo: true };
  const med = (numero: string, mes: number, bruto: number, direto: number, constr: number, status: Medicao['status'] = 'Pendente', dataPrevista?: string): Medicao => ({ id: `M-${numero}`, codigoObra: 'OB-SF-CL-01', servicoId: 'S-EM', numero, mes, etapa: 'Estrutura Metálica', evento: numero, escopo: '', criterio: '', documentos: '', tipoMedicao: 'Fabricação', responsavelAprovacao: '', dataPrevista, valorBruto: bruto, faturamentoDireto: direto, faturamentoConstrutora: constr, retencao: bruto * 0.1, pctEvolucaoPlanejada: 0, status, observacoes: '' });
  const medicoes = [med('E10', 4, 175000, 175000, 0, 'Pendente', '2026-08-31'), med('E11', 4, 185000, 145000, 40000, 'Faturado', '2026-09-30'), med('E12', 5, 230000, 200000, 30000), med('E13', 5, 210000, 100000, 110000)];
  it('liquido da construtora desconta a retencao proporcional; faturado soma os eventos medidos', () => {
    const c = calcMedicao(medicoes[1], DB);
    expect(c.retencaoConstrutora).toBeCloseTo(4000, 2);
    expect(c.valorLiquidoConstrutora).toBeCloseTo(36000, 2);
    expect(c.medida).toBe(true);
    expect(calcMedicao(medicoes[0], DB).atrasada).toBe(true);
    const r = resumoMedicoes(medicoes, DB);
    expect(r.valorBruto).toBe(800000);
    expect(r.faturamentoDireto).toBe(620000);
    expect(r.liquidoConstrutora).toBeCloseTo(162000, 2);
    expect(r.faturado).toBeCloseTo(36000, 2);
    expect(r.pctFaturado).toBeCloseTo(36000 / 162000, 4);
    expect(r.retencaoAcumulada).toBeCloseTo(4000, 2);
    expect(r.atrasadas).toBe(1);
    expect(r.porMes.map((x) => x.mes)).toEqual([4, 5]);
  });
  it('custo previsto = receita x (1 - margem alvo); desvio compara comprometido com o custo proporcional ao faturado', () => {
    const custo: Lancamento = { ...ds.lancamentos[17], id: 'PAG-EM', categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', servicoId: 'S-EM', valorBruto: 40000, retencoes: 0, desconto: 0, multaJuros: 0, status: 'Aprovado' };
    const ds2: Dataset = { ...ds, servicos: [srv], medicoes, lancamentos: [...ds.lancamentos, custo] };
    const s = calcServico(srv, calcLancamentos(ds2), DB, medicoes, 0.25);
    expect(s.custoPrevistoDerivado).toBe(true);
    expect(s.custoPrevisto).toBeCloseTo(162000 * 0.75, 2);
    expect(s.faturado).toBeCloseTo(36000, 2);
    expect(s.pctFaturado).toBeCloseTo(36000 / 162000, 4);
    expect(s.custoPrevistoProporcional).toBeCloseTo(121500 * (36000 / 162000), 2);
    expect(s.desvioVsFaturado).toBeCloseTo(40000 - 27000, 2); // gastou 40k contra 27k previstos para o faturado
    expect(s.etc).toBeCloseTo(121500 - 40000, 2);
    expect(s.eac).toBeCloseTo(121500, 2);
    expect(s.margemProjetada).toBeCloseTo(40500, 2);
    expect(s.pctExecucao).toBeCloseTo(s.pctFaturado, 6); // sem quantidades, o fisico segue o faturado
    // margem alvo do servico prevalece sobre a da obra; custo orcado informado prevalece sobre a margem
    expect(calcServico({ ...srv, margemAlvo: 0.4 }, [], DB, medicoes, 0.25).custoPrevisto).toBeCloseTo(97200, 2);
    expect(calcServico({ ...srv, custoOrcado: 100000 }, [], DB, medicoes, 0.25).custoPrevisto).toBe(100000);
    const o = obra360({ ...ds2, obras: [{ ...ds2.obras[0], margemAlvo: 0.25 }] }, { ...ds2.obras[0], margemAlvo: 0.25 });
    expect(o.custoPrevisto).toBeCloseTo(121500, 2);
    expect(o.medicoes.faturado).toBeCloseTo(36000, 2);
  });
});

describe('demandas', () => {
  const dm: Demanda = { id: 'D1', codigoObra: 'OB-SF-CL-01', titulo: 'Diário', descricao: '', periodicidade: 'Diária', responsavel: 'u', conclusoes: [], ativo: true, criadoEm: '2026-08-25T10:00:00Z', criadoPor: 'x' };
  it('chaves de periodo', () => {
    expect(chavePeriodo('Diária', '2026-09-03')).toBe('2026-09-03');
    expect(chavePeriodo('Semanal', '2026-09-03')).toBe('2026-08-31');
    expect(chavePeriodo('Mensal', '2026-09-03')).toBe('2026-09-01');
  });
  it('status por periodo e aderencia', () => {
    expect(calcDemanda(dm, DB).status).toBe('Pendente');
    const c = calcDemanda({ ...dm, conclusoes: ['2026-08-31', '2026-09-01'] }, DB);
    expect(c.status).toBe('Concluída');
    expect(c.periodosDesdeCriacao).toBe(8);
    expect(c.aderencia).toBeCloseTo(2 / 8, 4);
    const sem = calcDemanda({ ...dm, periodicidade: 'Semanal', conclusoes: ['2026-08-31'] }, '2026-09-04');
    expect(sem.status).toBe('Concluída');
    expect(calcDemanda({ ...dm, periodicidade: 'Semanal', conclusoes: ['2026-08-28'] }, '2026-09-04').status).toBe('Pendente');
    expect(calcDemanda({ ...dm, periodicidade: 'Única', prazo: '2026-08-30' }, DB).status).toBe('Atrasada');
    expect(calcDemanda({ ...dm, periodicidade: 'Única', prazo: '2026-08-30', conclusoes: ['2026-08-29'] }, DB).status).toBe('Concluída');
  });
});

describe('ordens de producao', () => {
  const o: OrdemProducao = { id: 'OF-1', codigoObra: 'OB-SF-CL-01', tipo: 'Fabricação', codigo: 'OF-001', descricao: 'Lote 1', quantidade: 12, unidade: 't', prioridade: 'Alta', dataNecessidade: '2026-08-30', etapas: etapasPadrao('Fabricação'), observacoes: '', criadoEm: DB, criadoPor: 'x' };
  it('etapa atual, progresso e atraso', () => {
    let c = calcOrdem(o, DB);
    expect(c.status).toBe('Não iniciada');
    expect(c.etapaAtual).toBe('Corte');
    expect(c.atrasada).toBe(true);
    const etapas = o.etapas.map((e, i) => (i < 2 ? { ...e, status: 'Concluída' as const } : e));
    c = calcOrdem({ ...o, etapas }, DB);
    expect(c.status).toBe('Em andamento');
    expect(c.etapaAtual).toBe('Montagem e ponteamento');
    expect(c.pctConcluido).toBeCloseTo(2 / 6, 4);
    c = calcOrdem({ ...o, etapas: o.etapas.map((e) => ({ ...e, status: 'Concluída' as const })) }, DB);
    expect(c.status).toBe('Concluída');
    expect(c.atrasada).toBe(false);
  });
  it('resumo por etapa (kanban)', () => {
    const r = resumoProducao([o, { ...o, id: 'OF-2', codigo: 'OF-002', etapas: o.etapas.map((e) => ({ ...e, status: 'Concluída' as const })) }], 'Fabricação', DB, 'OB-SF-CL-01');
    expect(r.porEtapa[0].ordens.map((x) => x.id)).toEqual(['OF-1']);
    expect(r.porEtapa[r.porEtapa.length - 1].ordens.map((x) => x.id)).toEqual(['OF-2']);
    expect(r.quantidadeConcluida).toBe(12);
    expect(r.atrasadas).toBe(1);
  });
});

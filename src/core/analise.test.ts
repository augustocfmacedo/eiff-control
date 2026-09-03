import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Dataset, Lancamento, Medicao, Servico } from './types';
import { calcLancamentos, obra360 } from './engine';
import { analisarObra } from './analise';

const base = seed as unknown as Dataset;
const DB = base.params.dataBase; // 2026-09-01

const srv: Servico = { id: 'S1', codigoObra: 'OB-SF-CL-01', codigo: 'SFCL-06', nome: 'Estrutura metálica', etapa: 'Fabricação', unidade: 'vb', quantidadeOrcada: 1, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 100000, status: 'Em andamento', observacoes: '', ativo: true };
const med = (numero: string, mes: number, constr: number, status: Medicao['status'], dataPrevista: string, dataMedicao?: string): Medicao => ({ id: `M-${numero}`, codigoObra: 'OB-SF-CL-01', servicoId: 'S1', numero, mes, etapa: 'x', evento: numero, escopo: '', criterio: '', documentos: '', tipoMedicao: '', responsavelAprovacao: '', dataPrevista, valorBruto: constr, faturamentoDireto: 0, faturamentoConstrutora: constr, retencao: constr * 0.1, pctEvolucaoPlanejada: 0, status, dataMedicao, observacoes: '' });

function cenario(custos: number[], medidos: boolean): Dataset {
  const medicoes = [med('E1', 1, 50000, medidos ? 'Faturado' : 'Pendente', '2026-07-31', '2026-07-31'), med('E2', 2, 50000, medidos ? 'Faturado' : 'Pendente', '2026-08-31', '2026-08-31'), med('E3', 3, 11111.11, 'Pendente', '2026-10-31')];
  const lancs: Lancamento[] = custos.map((v, i) => ({ ...base.lancamentos[17], id: `PAG-C${i}`, categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', servicoId: 'S1', competencia: '2026-08-10', vencimento: '2026-09-10', valorBruto: v, retencoes: 0, desconto: 0, multaJuros: 0, status: 'Aprovado' }));
  return { ...base, servicos: [srv], medicoes, obras: [{ ...base.obras[0], margemAlvo: 0.25 }], lancamentos: [...base.lancamentos, ...lancs] };
}

describe('analise da obra', () => {
  it('obra saudavel: faturamento no ritmo, custo abaixo do previsto, margem acima da meta', () => {
    const ds = cenario([50000], true); // faturado 90k liquido de 100k; previsto ate hoje 90k; custo 50k vs previsto proporcional 67.5k
    const o = obra360(ds, ds.obras[0], calcLancamentos(ds));
    const a = analisarObra(ds, o);
    expect(a.idp).toBeCloseTo(1, 4);
    expect(a.idc).toBeCloseTo(67500 / 50000, 4);
    expect(a.pctFaturado).toBeCloseTo(0.9, 4);
    expect(a.eventosAtrasados).toBe(0);
    // unico negativo vem do recebivel vencido da planilha (REC-SF-CL-002), tema Caixa
    expect(a.pontos.filter((p) => p.sinal === 'negativo').map((p) => p.tema)).toEqual(['Caixa']);
    expect(a.score).toBeGreaterThanOrEqual(80);
    expect(a.semaforo).toBe('verde');
    expect(a.curva.length).toBeGreaterThanOrEqual(4);
    const set = a.curva.find((p) => p.mes === '2026-08-01')!;
    expect(set.previsto).toBeCloseTo(90000, 2);
    expect(set.faturado).toBeCloseTo(90000, 2);
    expect(set.custo).toBe(50000);
    expect(a.curva.find((p) => p.mes === '2026-10-01')!.faturado).toBeUndefined(); // futuro nao tem realizado
  });
  it('obra em problema: nada faturado, eventos vencidos, custo acima do previsto, margem abaixo da meta', () => {
    const ds = cenario([80000, 30000], false);
    const o = obra360(ds, ds.obras[0], calcLancamentos(ds));
    const a = analisarObra(ds, o);
    expect(a.idp).toBe(0);
    expect(a.eventosAtrasados).toBe(2);
    expect(a.idc).toBe(0); // 110k comprometidos sem nada faturado: custo previsto proporcional = 0
    expect(a.pontos.some((p) => p.sinal === 'negativo' && p.tema === 'Custo')).toBe(true);
    expect(a.margemProjetada).toBeLessThan(a.margemAlvo);
    const temas = a.pontos.filter((p) => p.sinal === 'negativo').map((p) => p.tema);
    expect(temas).toContain('Prazo');
    expect(temas).toContain('Faturamento');
    expect(temas).toContain('Margem');
    expect(a.score).toBeLessThan(60);
    expect(a.semaforo).toBe('vermelho');
  });
  it('recebiveis vencidos e a faturar em 30 dias', () => {
    const ds = cenario([], true);
    const o = obra360(ds, ds.obras[0]);
    const a = analisarObra(ds, o);
    expect(a.recebiveisVencidos).toBe(193975); // REC-SF-CL-002 da planilha
    expect(a.pontos.some((p) => p.sinal === 'negativo' && p.tema === 'Caixa')).toBe(true);
    expect(a.proximosMarcos[0].numero).toBe('E3');
    expect(a.aFaturar30d).toBe(0); // E3 previsto para 31/10, fora dos 30 dias
    expect(a.atividade.length).toBeGreaterThanOrEqual(0);
  });
});

export { DB };

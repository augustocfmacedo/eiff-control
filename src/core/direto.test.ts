import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Dataset, Lancamento, Orcamento } from './types';
import { aging, calcLancamento, calcLancamentos, obra360 } from './engine';
import { calcServico } from './obras';

const ds = seed as unknown as Dataset;
const obra = ds.obras.find((o) => o.codigo === 'OB-SF-CL-01')!;
const compra = (p: Partial<Lancamento>): Lancamento => ({ ...ds.lancamentos[17], id: 'DIR-1', registro: 'Real', categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', centroCusto: 'Obra', status: 'Aprovado', valorBruto: 100000, retencoes: 0, desconto: 0, multaJuros: 0, vencimento: '2026-09-20', servicoId: ds.servicos[0].id, ...p });

describe('faturamento direto ao cliente', () => {
  const direta = compra({ faturamentoDireto: true });
  const ds2: Dataset = { ...ds, lancamentos: [...ds.lancamentos, direta] };
  it('nao entra no caixa nem no DRE da EIFF, mas e reconhecido como direto', () => {
    const c = calcLancamento(direta, ds2);
    expect(c.direto).toBe(true);
    expect(c.oficial).toBe(true);
    expect(c.valorCaixaProjetado).toBe(0);
    expect(c.valorGerencial).toBe(0);
    expect(c.valorLiquidoPrevisto).toBe(100000);
    expect(calcLancamento(compra({}), ds2).valorCaixaProjetado).toBeLessThan(0);
  });
  it('nao e conta a pagar (aging) e entra no comprometido e no saldo direto da obra', () => {
    const lancs = calcLancamentos(ds2);
    const ag = aging(lancs, 'Saída').reduce((a, f) => a + f.valor, 0);
    const agSem = aging(calcLancamentos(ds), 'Saída').reduce((a, f) => a + f.valor, 0);
    expect(ag).toBeCloseTo(agSem, 2);
    const antes = obra360(ds, obra);
    const depois = obra360(ds2, obra);
    expect(depois.custoComprometido - antes.custoComprometido).toBeCloseTo(100000, 2);
    expect(depois.custoComprometidoDireto).toBeCloseTo(100000, 2);
    expect(depois.faturamentoDiretoUtilizado).toBeCloseTo(100000, 2);
    expect(depois.orcamentoDisponivel).toBeCloseTo(antes.orcamentoDisponivel - 100000, 2);
    expect(depois.caixaGerado).toBeCloseTo(antes.caixaGerado, 2); // caixa da EIFF nao muda
    const s = depois.servicos.find((x) => x.id === ds.servicos[0].id)!;
    expect(s.comprometidoDireto).toBeCloseTo(100000, 2);
  });
});

describe('custo previsto do servico vindo do orcamento executivo', () => {
  const srv = ds.servicos[0];
  const orc: Orcamento = { id: 'ORC-X', codigo: 'ORC-X', titulo: 'Executivo', cliente: '', codigoObra: obra.codigo, data: '2026-09-01', status: 'Contratado', bdi: 0, referenciaPrecos: '', observacoes: '', criadoEm: '', criadoPor: '', atualizadoEm: '',
    itens: [{ id: 'a', ordem: 1, etapa: 'Fabricação', codigo: '1', descricao: 'Aço', unidade: 'kg', quantidade: 1000, custoUnitarioManual: 12, servicoId: srv.id }, { id: 'b', ordem: 2, etapa: 'Fabricação', codigo: '2', descricao: 'Solda', unidade: 'kg', quantidade: 1000, custoUnitarioManual: 3, servicoId: srv.id }] };
  it('orcamento contratado vinculado ao servico substitui a margem alvo; custo orcado proprio prevalece', () => {
    const ds2: Dataset = { ...ds, orcamentos: [orc] };
    const o = obra360(ds2, obra);
    const s = o.servicos.find((x) => x.id === srv.id)!;
    expect(s.origemCustoPrevisto).toBe('Orçamento executivo');
    expect(s.custoPrevisto).toBeCloseTo(15000, 2);
    expect(o.custoOrcamentoExecutivo).toBeCloseTo(15000, 2);
    expect(obra360(ds, obra).servicos.find((x) => x.id === srv.id)!.origemCustoPrevisto).toBe('Margem alvo');
    const proprio = calcServico({ ...srv, custoOrcado: 20000 }, calcLancamentos(ds2), ds.params.dataBase, [], 0.25, 15000);
    expect(proprio.origemCustoPrevisto).toBe('Orçado');
    expect(proprio.custoPrevisto).toBe(20000);
    // rascunho nao conta
    expect(obra360({ ...ds, orcamentos: [{ ...orc, status: 'Rascunho' }] }, obra).custoOrcamentoExecutivo).toBe(0);
  });
});

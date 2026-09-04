import { describe, expect, it } from 'vitest';
import type { Composicao, Insumo, Orcamento } from './types';
import { Calculadora, calcOrcamento, classificarAbc, criaCiclo, etapaObraDe, servicosDeOrcamento } from './orcamentos';

const ins = (id: string, preco: number, tipo: Insumo['tipo'] = 'Material', unidade = 'kg'): Insumo => ({ id, codigo: id, descricao: `Insumo ${id}`, unidade, tipo, origem: 'SINAPI', preco, ativo: true, observacoes: '' });
const comp = (id: string, itens: Composicao['itens'], unidade = 'kg'): Composicao => ({ id, codigo: id, descricao: `Composição ${id}`, unidade, grupo: 'ESTRUTURAS METÁLICAS', origem: 'SINAPI', itens, ativo: true, observacoes: '' });

// aco 8,50/kg; solda 40/kg; montador 30/h; guindaste 200/h
const insumos = [ins('ACO', 8.5), ins('SOLDA', 40), ins('MONT', 30, 'Mão de obra', 'h'), ins('GUIND', 200, 'Equipamento', 'h')];
const composicoes = [
  comp('FAB', [{ tipo: 'Insumo', refId: 'ACO', coeficiente: 1.05 }, { tipo: 'Insumo', refId: 'SOLDA', coeficiente: 0.02 }, { tipo: 'Insumo', refId: 'MONT', coeficiente: 0.08 }]), // 8,925 + 0,8 + 2,4 = 12,125/kg
  comp('MONTAGEM', [{ tipo: 'Insumo', refId: 'MONT', coeficiente: 0.05 }, { tipo: 'Insumo', refId: 'GUIND', coeficiente: 0.004 }]), // 1,5 + 0,8 = 2,3/kg
  comp('ESTRUTURA', [{ tipo: 'Composição', refId: 'FAB', coeficiente: 1 }, { tipo: 'Composição', refId: 'MONTAGEM', coeficiente: 1 }]), // 14,425/kg
];
const cat = { insumos, composicoes };

describe('custo da composicao', () => {
  it('soma coeficiente x preco, inclusive composicoes auxiliares, e explode os insumos', () => {
    const c = new Calculadora(cat);
    expect(c.custo('FAB').custoUnitario).toBeCloseTo(12.125, 6);
    const e = c.custo('ESTRUTURA');
    expect(e.custoUnitario).toBeCloseTo(14.425, 6);
    expect(e.porTipo.Material).toBeCloseTo(9.725, 6);
    expect(e.porTipo['Mão de obra']).toBeCloseTo(3.9, 6);
    expect(e.porTipo.Equipamento).toBeCloseTo(0.8, 6);
    expect(e.insumos.get('MONT')).toBeCloseTo(0.13, 6);
    expect(e.faltantes).toEqual([]);
  });
  it('sinaliza insumo faltante e ciclo sem travar', () => {
    const c = new Calculadora({ insumos, composicoes: [...composicoes, comp('X', [{ tipo: 'Insumo', refId: 'NAO-EXISTE', coeficiente: 1 }, { tipo: 'Composição', refId: 'Y', coeficiente: 1 }]), comp('Y', [{ tipo: 'Composição', refId: 'X', coeficiente: 1 }])] });
    const r = c.custo('X');
    expect(r.faltantes).toContain('NAO-EXISTE');
    expect(r.ciclo).toBe(true);
    expect(criaCiclo('FAB', [{ tipo: 'Composição', refId: 'ESTRUTURA', coeficiente: 1 }], cat)).toBe(true);
    expect(criaCiclo('FAB', [{ tipo: 'Composição', refId: 'MONTAGEM', coeficiente: 1 }], cat)).toBe(false);
  });
});

describe('orcamento com BDI e curva ABC', () => {
  const orc: Orcamento = {
    id: 'ORC-0001', codigo: 'ORC-0001', titulo: 'Galpão', cliente: 'Cliente', data: '2026-09-01', status: 'Rascunho', bdi: 0.25, referenciaPrecos: 'teste', observacoes: '', criadoEm: '', criadoPor: '', atualizadoEm: '',
    itens: [
      { id: 'i1', ordem: 1, etapa: 'Fabricação', codigo: '1.1', descricao: 'Fabricação de estrutura', unidade: 'kg', quantidade: 10000, composicaoId: 'FAB' },
      { id: 'i2', ordem: 2, etapa: 'Montagem', codigo: '2.1', descricao: 'Montagem', unidade: 'kg', quantidade: 10000, composicaoId: 'MONTAGEM' },
      { id: 'i3', ordem: 3, etapa: 'Projeto', codigo: '3.1', descricao: 'Projeto executivo', unidade: 'vb', quantidade: 1, custoUnitarioManual: 5000 },
      { id: 'i4', ordem: 4, etapa: 'Outros', codigo: '4.1', descricao: 'Sem preço ainda', unidade: 'vb', quantidade: 1 },
    ],
  };
  const c = calcOrcamento(orc, cat);
  it('custo direto, preco com BDI e totais por etapa/tipo', () => {
    expect(c.custoTotal).toBeCloseTo(121250 + 23000 + 5000, 2);
    expect(c.precoTotal).toBeCloseTo(149250 * 1.25, 2);
    expect(c.valorBdi).toBeCloseTo(149250 * 0.25, 2);
    expect(c.itens[0].precoUnitario).toBeCloseTo(12.125 * 1.25, 6);
    expect(c.porTipo.Material).toBeCloseTo(97250, 2);
    expect(c.porTipo['Mão de obra']).toBeCloseTo(24000 + 15000, 2);
    expect(c.porEtapa.find((e) => e.etapa === 'Fabricação')!.custo).toBeCloseTo(121250, 2);
    expect(c.semCusto).toBe(1);
    expect(c.itens[3].origemCusto).toBe('Sem custo');
  });
  it('curva ABC de insumos agrega o consumo de todos os itens', () => {
    const aco = c.curvaInsumos.find((i) => i.id === 'ACO')!;
    expect(aco.quantidade).toBeCloseTo(10500, 6);
    expect(aco.valor).toBeCloseTo(89250, 2);
    expect(aco.classe).toBe('A');
    const mont = c.curvaInsumos.find((i) => i.id === 'MONT')!;
    expect(mont.quantidade).toBeCloseTo(1300, 6); // 800 h fabricacao + 500 h montagem
    expect(c.curvaInsumos[0].id).toBe('ACO');
    expect(c.curvaInsumos.reduce((a, i) => a + i.valor, 0)).toBeCloseTo(144250, 2); // sem o item manual
  });
  it('classes A/B/C pelos cortes de 80% e 95% acumulados', () => {
    const r = classificarAbc([{ id: 'a', valor: 70 }, { id: 'b', valor: 15 }, { id: 'c', valor: 10 }, { id: 'd', valor: 5 }]);
    expect(r.map((x) => x.classe)).toEqual(['A', 'B', 'B', 'C']);
    expect(r[3].acumulado).toBeCloseTo(1, 9);
  });
  it('converte em servicos da obra com custo orcado e preco de venda', () => {
    const s = servicosDeOrcamento(c, 'OB-X', 'X', []);
    expect(s).toHaveLength(4);
    expect(s[0].codigo).toBe('X-1.1');
    expect(s[0].etapa).toBe('Fabricação');
    expect(s[0].custoOrcado).toBeCloseTo(121250, 2);
    expect(s[0].precoVenda).toBeCloseTo(121250 * 1.25, 2);
    expect(s[1].etapa).toBe('Montagem');
    expect(s[2].etapa).toBe('Projeto');
    // fechando no valor do contrato: precos redistribuidos proporcionalmente, custo mantido
    const s2 = servicosDeOrcamento(c, 'OB-X', 'X', [], 200000);
    expect(s2.reduce((a, x) => a + x.precoVenda, 0)).toBeCloseTo(200000, 0);
    expect(s2[0].custoOrcado).toBeCloseTo(121250, 2);
  });
  it('preco de venda informado substitui o BDI e gera margem por item e por servico', () => {
    const c2 = calcOrcamento({ ...orc, itens: [{ ...orc.itens[0], precoUnitarioVenda: 20, servicoId: 'S1' }, { ...orc.itens[1], servicoId: 'S1' }, orc.itens[2]] }, cat);
    expect(c2.itens[0].precoInformado).toBe(true);
    expect(c2.itens[0].precoTotal).toBeCloseTo(200000, 2);
    expect(c2.itens[0].margem).toBeCloseTo(200000 - 121250, 2);
    expect(c2.itens[1].precoTotal).toBeCloseTo(23000 * 1.25, 2); // sem preco informado: BDI
    expect(c2.porServico).toEqual([{ servicoId: 'S1', custo: expect.closeTo(144250, 2), preco: expect.closeTo(200000 + 28750, 2), itens: 2 }]);
    expect(c2.pctMargem).toBeCloseTo((c2.precoTotal - c2.custoTotal) / c2.precoTotal, 6);
  });
  it('mapeia etapas textuais para as etapas da obra', () => {
    expect(etapaObraDe('Pintura eletrostática')).toBe('Pintura');
    expect(etapaObraDe('Cobertura em telha')).toBe('Cobertura e fechamento');
    expect(etapaObraDe('Chumbadores e grout')).toBe('Civil');
    expect(etapaObraDe('Mobilização')).toBe('Outros');
  });
});

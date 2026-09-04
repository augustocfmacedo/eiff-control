import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Conjunto, Dataset } from './types';
import { avancoPorPeso, calcConjunto, parseListaMateriais, resumoPeso, tipoConjuntoDe } from './materiais';
import { obra360 } from './engine';

const ds = seed as unknown as Dataset;
const cj = (p: Partial<Conjunto>): Conjunto => ({ id: 'x', codigoObra: 'OB-SF-CL-01', marca: 'X', descricao: '', tipo: 'Viga', quantidade: 10, pesoUnitario: 100, fabricadoQtd: 0, expedidoQtd: 0, montadoQtd: 0, observacoes: '', atualizadoEm: '', ...p });

describe('lista de materiais em kg', () => {
  it('calcula pesos, percentuais e situacao do conjunto', () => {
    const c = calcConjunto(cj({ fabricadoQtd: 6, expedidoQtd: 4, montadoQtd: 2, liberadoEm: '2026-09-01' }));
    expect(c.pesoTotal).toBe(1000);
    expect(c.pesoFabricado).toBe(600);
    expect(c.pesoMontado).toBe(200);
    expect(c.pctMontado).toBeCloseTo(0.2, 6);
    expect(c.situacao).toBe('Em fabricação');
    expect(calcConjunto(cj({ montadoQtd: 10, expedidoQtd: 10, fabricadoQtd: 10 })).situacao).toBe('Montado');
    expect(calcConjunto(cj({})).situacao).toBe('Não liberado');
    expect(calcConjunto(cj({ fabricadoQtd: 15 })).pesoFabricado).toBe(1000); // nao passa do total
  });
  it('resumo por tipo e por servico; estoque em fabrica e em canteiro', () => {
    const r = resumoPeso([cj({ id: 'a', tipo: 'Pilar', servicoId: 'S1', fabricadoQtd: 10, expedidoQtd: 6, montadoQtd: 3, liberadoEm: '2026-09-01' }), cj({ id: 'b', tipo: 'Viga', servicoId: 'S1', quantidade: 20, pesoUnitario: 50, fabricadoQtd: 5 }), cj({ id: 'c', tipo: 'Terça', servicoId: 'S2', quantidade: 100, pesoUnitario: 10 })]);
    expect(r.pesoTotal).toBe(3000);
    expect(r.pesoLiberado).toBe(1000);
    expect(r.pesoFabricado).toBe(1250);
    expect(r.emFabrica).toBe(650); // 1250 fabricado - 600 expedido
    expect(r.emCanteiro).toBe(300); // 600 expedido - 300 montado
    expect(r.porServico.find((s) => s.servicoId === 'S1')!.pesoMontado).toBe(300);
    expect(r.porTipo[0].tipo).toBe('Pilar');
    expect(avancoPorPeso(r.conjuntos, 'OB-SF-CL-01').get('S2')!.pesoTotal).toBe(1000);
  });
  it('avanco fisico do servico passa a ser o peso montado quando ha lista', () => {
    const srv = ds.servicos[0];
    const ds2: Dataset = { ...ds, conjuntos: [cj({ id: 'a', servicoId: srv.id, quantidade: 10, pesoUnitario: 1000, fabricadoQtd: 10, expedidoQtd: 10, montadoQtd: 4 })] };
    const o = obra360(ds2, ds.obras[0]);
    const s = o.servicos.find((x) => x.id === srv.id)!;
    expect(s.origemExecucao).toBe('Peso montado');
    expect(s.pctExecucao).toBeCloseTo(0.4, 6);
    expect(s.pesoTotal).toBe(10000);
    expect(o.peso.pctMontado).toBeCloseTo(0.4, 6);
    expect(obra360(ds, ds.obras[0]).servicos.find((x) => x.id === srv.id)!.origemExecucao).toBe('Faturamento');
  });
  it('importa lista com cabecalho em portugues ou ingles e classifica o tipo', () => {
    const r = parseListaMateriais([{ arquivo: 'lista.xlsx', aba: 'LM', linhas: [
      ['LISTA DE MATERIAIS - GALPAO'], [],
      ['Marca', 'Descrição', 'Perfil', 'Qtd', 'Peso unit. (kg)', 'Peso total (kg)', 'Rev'],
      ['P-01', 'Pilar eixo A', 'W 310x38,7', 8, 612.5, 4900, 'B'],
      ['V-12', 'Viga de cobertura', 'W 200x15', 24, '95,2', null, ''],
      ['T-01', 'Terça', 'U 150x50x3', 120, null, 3600, ''],
      ['TOTAL', '', '', '', '', 13500, ''],
    ] }, { arquivo: 'lista.xlsx', aba: 'Assembly list', linhas: [['Assembly mark', 'Name', 'Qty', 'Weight'], ['B-7', 'BRACING', 4, 40.25]] }]);
    expect(r.avisos).toEqual([]);
    expect(r.conjuntos.map((c) => c.marca)).toEqual(['P-01', 'V-12', 'T-01', 'B-7']);
    expect(r.conjuntos[0]).toMatchObject({ tipo: 'Pilar', quantidade: 8, pesoUnitario: 612.5, revisao: 'B', perfil: 'W 310x38,7' });
    expect(r.conjuntos[1].pesoUnitario).toBe(95.2);
    expect(r.conjuntos[2].pesoUnitario).toBe(30); // 3600 / 120
    expect(r.conjuntos[2].tipo).toBe('Terça');
    expect(r.conjuntos[3].tipo).toBe('Contraventamento');
    expect(tipoConjuntoDe('Escada marinheiro')).toBe('Escada');
  });
});

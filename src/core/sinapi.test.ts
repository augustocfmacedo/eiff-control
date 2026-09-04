import { describe, expect, it } from 'vitest';
import { detectarUfs, numero, parseSinapi, selecionarComDependencias, tipoInsumoDe, type Planilha } from './sinapi';

// formato unificado (2025+): uma aba de insumos com precos por UF e uma aba analitica sem precos
const unificado: Planilha[] = [
  { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'ISD', linhas: [
    ['SINAPI - INSUMOS SEM DESONERAÇÃO'], [],
    ['Classificação', 'Código', 'Descrição do Insumo', 'Unidade', 'GO', 'SP'],
    ['MATERIAL', 4813, 'PERFIL "I" DE ACO LAMINADO', 'KG', '8,50', '8,90'],
    ['MATERIAL', 10001, 'ELETRODO REVESTIDO AWS E7018', 'KG', 40, 41],
    ['MÃO DE OBRA', 88264, 'MONTADOR DE ESTRUTURA METALICA COM ENCARGOS COMPLEMENTARES', 'H', 30.1, 32],
    ['MATERIAL', 20000, 'CHAPA SEM COLETA EM GO', 'KG', null, 12],
    ['', 'x', 'linha invalida', '', 1, 1],
  ] },
  { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'ICD', linhas: [
    ['Classificação', 'Código', 'Descrição do Insumo', 'Unidade', 'GO', 'SP'],
    ['MATERIAL', 4813, 'PERFIL "I" DE ACO LAMINADO', 'KG', 7, 7],
  ] },
  { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'Analítico', linhas: [
    ['Grupo', 'Código da Composição', 'Descrição da Composição', 'Unidade', 'Tipo Item', 'Código Item', 'Descrição Item', 'Unidade Item', 'Coeficiente'],
    ['ESTRUTURAS METÁLICAS', 100001, 'FABRICACAO DE ESTRUTURA METALICA', 'KG', 'INSUMO', 4813, 'PERFIL "I" DE ACO LAMINADO', 'KG', '1,05'],
    ['ESTRUTURAS METÁLICAS', 100001, 'FABRICACAO DE ESTRUTURA METALICA', 'KG', 'INSUMO', 10001, 'ELETRODO', 'KG', 0.02],
    ['ESTRUTURAS METÁLICAS', 100001, 'FABRICACAO DE ESTRUTURA METALICA', 'KG', 'COMPOSICAO', 100002, 'MONTAGEM', 'KG', 1],
    ['ESTRUTURAS METÁLICAS', 100002, 'MONTAGEM DE ESTRUTURA METALICA', 'KG', 'INSUMO', 88264, 'MONTADOR', 'H', '0,08'],
    ['PINTURA', 100003, 'PINTURA DE FUNDO', 'M2', 'INSUMO', 99999, 'TINTA (nao esta na aba de insumos)', 'L', 0.2],
  ] },
  { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'Analítico 2', linhas: [
    ['Grupo', 'Código da Composição', 'Tipo Item', 'Código do Item', 'Descrição', 'Unidade', 'Coeficiente', 'Situação'],
    ['SOLDAS', 100004, null, null, 'SOLDA ESPECIAL', 'M', null, 'SEM CUSTO'],
    ['SOLDAS', 100004, 'INSUMO', 77777, 'CONSUMIVEL SEM PRECO', 'KG', 0.5, 'SEM PREÇO'],
  ] },
];

describe('parser SINAPI (formato unificado)', () => {
  it('detecta UFs e le insumos com o preco da UF escolhida, ignorando a aba desonerada', () => {
    expect(detectarUfs(unificado)).toEqual(['GO', 'SP']);
    const cat = parseSinapi(unificado, { uf: 'GO' });
    expect(cat.referencia).toBe('SINAPI GO 07/2026 não desonerado');
    expect(cat.competencia).toBe('2026-07');
    const perfil = cat.insumos.find((i) => i.codigo === '4813')!;
    expect(perfil.preco).toBe(8.5);
    expect(perfil.tipo).toBe('Material');
    expect(perfil.unidade).toBe('KG');
    expect(cat.insumos.find((i) => i.codigo === '88264')!.tipo).toBe('Mão de obra');
    expect(cat.insumos.some((i) => i.codigo === 'x')).toBe(false);
    // insumo que so aparece no analitico entra sem preco (coluna propria ou coluna compartilhada do formato unificado)
    expect(cat.insumos.find((i) => i.codigo === '99999')!.preco).toBe(0);
    const cons = cat.insumos.find((i) => i.codigo === '77777')!;
    expect(cons.descricao).toBe('CONSUMIVEL SEM PRECO');
    expect(cons.unidade).toBe('KG');
    expect(cat.composicoes.find((c) => c.codigo === '100004')!.descricao).toBe('SOLDA ESPECIAL');
    // sem coleta em GO: preco atribuido de SP
    const chapa = cat.insumos.find((i) => i.codigo === '20000')!;
    expect(chapa.preco).toBe(12);
    expect(chapa.precoAtribuido).toBe('SP');
    expect(cat.avisos.some((x) => x.includes('atribuído'))).toBe(true);
  });
  it('monta as composicoes com itens e composicoes auxiliares', () => {
    const cat = parseSinapi(unificado, { uf: 'SP' });
    expect(cat.insumos.find((i) => i.codigo === '4813')!.preco).toBe(8.9);
    const fab = cat.composicoes.find((c) => c.codigo === '100001')!;
    expect(fab.grupo).toBe('ESTRUTURAS METÁLICAS');
    expect(fab.itens).toEqual([
      { tipo: 'Insumo', codigo: '4813', coeficiente: 1.05 },
      { tipo: 'Insumo', codigo: '10001', coeficiente: 0.02 },
      { tipo: 'Composição', codigo: '100002', coeficiente: 1 },
    ]);
    const sel = selecionarComDependencias(cat, ['100001']);
    expect(sel.composicoes.map((c) => c.codigo).sort()).toEqual(['100001', '100002']);
    expect(sel.insumos.map((i) => i.codigo).sort()).toEqual(['10001', '4813', '88264']);
  });
  it('preco desonerado quando solicitado', () => {
    const cat = parseSinapi(unificado, { uf: 'GO', desonerado: true });
    expect(cat.insumos.find((i) => i.codigo === '4813')!.preco).toBe(7);
    expect(cat.referencia).toContain('desonerado');
  });
});

describe('parser SINAPI (formato unificado): abas auxiliares', () => {
  it('ignora ISE/CSE (sem encargos) e codigos 0 de formulas de hiperlink', () => {
    const extra: Planilha[] = [
      ...unificado,
      { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'ISE', linhas: [['Classificação', 'Código', 'Descrição do Insumo', 'Unidade', 'GO'], ['MATERIAL', 4813, 'PERFIL', 'KG', 1]] },
      { arquivo: 'SINAPI_Referência_2026_07.xlsx', aba: 'CSD', linhas: [['Grupo', 'Código da Composição', 'Descrição', 'Unidade', 'GO'], ['ESTRUTURAS', 0, 'QUALQUER', 'KG', 9], ['ESTRUTURAS', 100001, 'FABRICACAO DE ESTRUTURA METALICA', 'KG', 9]] },
    ];
    const cat = parseSinapi(extra, { uf: 'GO' });
    expect(cat.insumos.find((i) => i.codigo === '4813')!.preco).toBe(8.5);
    expect(cat.composicoes.some((c) => c.codigo === '0')).toBe(false);
    expect(cat.composicoes.find((c) => c.codigo === '100001')!.grupo).toBe('ESTRUTURAS METÁLICAS');
  });
});

describe('parser SINAPI (formato antigo por UF)', () => {
  const antigo: Planilha[] = [
    { arquivo: 'SINAPI_Preco_Ref_Insumos_GO_202412_NaoDesonerado.xlsx', aba: 'Plan1', linhas: [
      ['SINAPI'], ['Data referência: 12/2024'],
      ['CODIGO', 'DESCRICAO DO INSUMO', 'UNIDADE DE MEDIDA', 'ORIGEM DE PRECO', 'PRECO MEDIANO R$'],
      ['4813', 'PERFIL I', 'KG', 'CR', '7,95'],
    ] },
    { arquivo: 'SINAPI_Custo_Ref_Composicoes_Analitico_GO_202412_NaoDesonerado.xlsx', aba: 'Plan1', linhas: [
      ['CODIGO DA COMPOSICAO', 'DESCRICAO DA COMPOSICAO', 'UNIDADE', 'CUSTO TOTAL', 'TIPO ITEM', 'CODIGO ITEM', 'DESCRIÇÃO ITEM', 'UNIDADE ITEM', 'ORIGEM DE PREÇO', 'PREÇO UNITÁRIO', 'COEFICIENTE', 'CUSTO TOTAL'],
      ['100001', 'FABRICACAO', 'KG', '9,50', '', '', '', '', '', '', '', ''],
      ['100001', 'FABRICACAO', 'KG', '9,50', 'INSUMO', '4813', 'PERFIL I', 'KG', 'CR', '7,95', '1,05', '8,35'],
      ['100001', 'FABRICACAO', 'KG', '9,50', 'INSUMO', '88264', 'MONTADOR COM ENCARGOS COMPLEMENTARES', 'H', 'CR', '28,75', '0,04', '1,15'],
    ] },
    { arquivo: 'SINAPI_Preco_Ref_Insumos_GO_202412_Desonerado.xlsx', aba: 'Plan1', linhas: [
      ['CODIGO', 'DESCRICAO DO INSUMO', 'UNIDADE DE MEDIDA', 'ORIGEM DE PRECO', 'PRECO MEDIANO R$'],
      ['4813', 'PERFIL I', 'KG', 'CR', '6,00'],
    ] },
  ];
  it('le preco mediano, UF e competencia do nome do arquivo e o insumo de mao de obra do analitico', () => {
    const cat = parseSinapi(antigo);
    expect(cat.uf).toBe('GO');
    expect(cat.referencia).toBe('SINAPI GO 12/2024 não desonerado');
    expect(cat.insumos.find((i) => i.codigo === '4813')!.preco).toBe(7.95);
    const mont = cat.insumos.find((i) => i.codigo === '88264')!;
    expect(mont.preco).toBe(28.75);
    expect(mont.tipo).toBe('Mão de obra');
    expect(cat.composicoes[0].itens).toHaveLength(2);
    expect(cat.avisos).toEqual([]);
  });
});

describe('utilitarios', () => {
  it('numero aceita virgula decimal e milhar', () => {
    expect(numero('1.234,56')).toBe(1234.56);
    expect(numero('0,0123')).toBe(0.0123);
    expect(numero(12.5)).toBe(12.5);
    expect(numero('')).toBe(0);
  });
  it('tipo do insumo pela descricao', () => {
    expect(tipoInsumoDe('', 'SERVENTE COM ENCARGOS COMPLEMENTARES')).toBe('Mão de obra');
    expect(tipoInsumoDe('', 'GUINDASTE SOBRE CAMINHAO - CHP DIURNO')).toBe('Equipamento');
    expect(tipoInsumoDe('', 'CHAPA DE ACO GROSSA')).toBe('Material');
    expect(tipoInsumoDe('SERVIÇOS', 'qualquer')).toBe('Serviço');
  });
});

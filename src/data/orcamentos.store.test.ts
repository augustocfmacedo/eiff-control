// Jornada: catalogo SINAPI importado -> composicao propria -> orcamento com BDI -> contratacao gera servicos da obra.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { calcOrcamento } from '../core/orcamentos';
import type { CatalogoImportado } from '../core/sinapi';

const catalogo: CatalogoImportado = {
  referencia: 'SINAPI GO 07/2026 não desonerado', uf: 'GO', competencia: '2026-07', desonerado: false, avisos: [],
  insumos: [
    { codigo: '4813', descricao: 'PERFIL I DE ACO', unidade: 'KG', tipo: 'Material', preco: 8.5 },
    { codigo: '88264', descricao: 'MONTADOR COM ENCARGOS', unidade: 'H', tipo: 'Mão de obra', preco: 30 },
  ],
  composicoes: [
    { codigo: '100001', descricao: 'FABRICACAO DE ESTRUTURA', unidade: 'KG', grupo: 'ESTRUTURAS METALICAS', itens: [{ tipo: 'Insumo', codigo: '4813', coeficiente: 1.05 }, { tipo: 'Composição', codigo: '100002', coeficiente: 1 }] },
    { codigo: '100002', descricao: 'MONTAGEM DE ESTRUTURA', unidade: 'KG', grupo: 'ESTRUTURAS METALICAS', itens: [{ tipo: 'Insumo', codigo: '88264', coeficiente: 0.1 }] },
  ],
};

describe('orcamento: catalogo, composicao propria e contratacao', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('importa o recorte do SINAPI e resolve as composicoes auxiliares', () => {
    const r = actions.importarCatalogo(catalogo, 'SINAPI', catalogo.referencia, '2026-07-01');
    expect(r).toMatchObject({ insumosNovos: 2, composicoesNovas: 2, itensIgnorados: 0 });
    const ds = getState().ds;
    expect(ds.insumos.find((i) => i.codigo === '4813')!.precoFonte).toBe(catalogo.referencia);
    const fab = ds.composicoes.find((c) => c.codigo === '100001')!;
    expect(fab.itens[1].refId).toBe(ds.composicoes.find((c) => c.codigo === '100002')!.id);
    // reimportar atualiza preco sem duplicar
    const r2 = actions.importarCatalogo({ ...catalogo, insumos: [{ ...catalogo.insumos[0], preco: 9 }] }, 'SINAPI', 'SINAPI GO 08/2026', '2026-08-01');
    expect(r2).toMatchObject({ insumosNovos: 0, insumosAtualizados: 1, composicoesAtualizadas: 2 });
    expect(getState().ds.insumos.filter((i) => i.codigo === '4813')).toHaveLength(1);
    expect(getState().ds.insumos.find((i) => i.codigo === '4813')!.preco).toBe(9);
  });

  it('composicao propria derivada do SINAPI com produtividade da EIFF; ciclo e recusado', () => {
    const base = getState().ds.composicoes.find((c) => c.codigo === '100002')!;
    const propria = actions.novaComposicao(base);
    expect(propria.origem).toBe('Própria');
    expect(propria.codigo).toBe('EIFF-0001');
    propria.itens[0].coeficiente = 0.06; // montagem mais produtiva
    actions.salvarComposicao(propria);
    expect(() => actions.salvarComposicao({ ...propria, itens: [{ tipo: 'Composição', refId: propria.id, coeficiente: 1 }] })).toThrow(RegraDeNegocioError);
    const fab = getState().ds.composicoes.find((c) => c.codigo === '100001')!;
    expect(() => actions.salvarComposicao({ ...getState().ds.composicoes.find((c) => c.codigo === '100002')!, itens: [{ tipo: 'Composição', refId: fab.id, coeficiente: 1 }] })).toThrow(/ciclo/);
  });

  it('orcamento com BDI, salvo e contratado gera servicos e custo orcado da obra', () => {
    const ds = getState().ds;
    const fab = ds.composicoes.find((c) => c.codigo === '100001')!;
    const propria = ds.composicoes.find((c) => c.codigo === 'EIFF-0001')!;
    const o = actions.novoOrcamento();
    o.titulo = 'Galpão teste';
    o.bdi = 0.3;
    o.itens = [
      { id: 'a', ordem: 1, etapa: 'Fabricação', codigo: '1', descricao: 'Fabricação', unidade: 'kg', quantidade: 1000, composicaoId: fab.id },
      { id: 'b', ordem: 2, etapa: 'Montagem', codigo: '2', descricao: 'Montagem', unidade: 'kg', quantidade: 1000, composicaoId: propria.id },
      { id: 'c', ordem: 3, etapa: 'Projeto', codigo: '3', descricao: 'Projeto', unidade: 'vb', quantidade: 1, custoUnitarioManual: 2000 },
    ];
    actions.salvarOrcamento(o);
    const calc = calcOrcamento(getState().ds.orcamentos.find((x) => x.id === o.id)!, getState().ds);
    // fab: 1,05 x 9 + 1 x (0,1 x 30) = 12,45/kg ; propria: 0,06 x 30 = 1,8/kg
    expect(calc.custoTotal).toBeCloseTo(12450 + 1800 + 2000, 2);
    expect(calc.precoTotal).toBeCloseTo(16250 * 1.3, 2);
    expect(calc.curvaInsumos[0].codigo).toBe('4813');
    expect(calc.curvaInsumos[0].classe).toBe('A');

    expect(() => actions.contratarOrcamento(o.id, { codigoObra: 'OB-NAO-EXISTE', ajustarAoContrato: false })).toThrow(RegraDeNegocioError);
    const antes = getState().ds.servicos.length;
    const r = actions.contratarOrcamento(o.id, { codigoObra: 'OB-SF-CL-01', ajustarAoContrato: false });
    expect(r.servicos).toHaveLength(3);
    expect(r.orcamento.status).toBe('Contratado');
    expect(r.orcamento.itens[0].servicoId).toBe(r.servicos[0].id);
    const ds2 = getState().ds;
    expect(ds2.servicos.length).toBe(antes + 3);
    const s = ds2.servicos.find((x) => x.id === r.servicos[0].id)!;
    expect(s.custoOrcado).toBeCloseTo(12450, 2);
    expect(s.precoVenda).toBeCloseTo(12450 * 1.3, 2);
    expect(s.etapa).toBe('Fabricação');
    expect(ds2.obras.find((x) => x.codigo === 'OB-SF-CL-01')!.custoOrcado).toBeCloseTo(16250, 2);
    // itens congelados apos contratar; nova contratacao recusada
    expect(() => actions.salvarOrcamento({ ...r.orcamento, itens: r.orcamento.itens.slice(1) })).toThrow(/congelados/);
    expect(() => actions.contratarOrcamento(o.id, { codigoObra: 'OB-SF-CL-01', ajustarAoContrato: false })).toThrow(/já contratado/);
    expect(ds2.auditoria[0].acao).toBe('contratar_orcamento');
  });
});

// Jornada: importar lista de materiais -> liberar -> apontar fabricacao/expedicao/montagem -> avanco fisico por peso.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { obra360 } from '../core/engine';

describe('lista de materiais', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  const lista = [
    { marca: 'P-01', descricao: 'Pilar', tipo: 'Pilar' as const, quantidade: 8, pesoUnitario: 600 },
    { marca: 'V-01', descricao: 'Viga', tipo: 'Viga' as const, quantidade: 20, pesoUnitario: 200 },
  ];

  it('importa e reimporta sem duplicar; conjunto invalido e recusado', () => {
    const srv = getState().ds.servicos[0];
    const r = actions.importarConjuntos(lista, 'OB-SF-CL-01', srv.id);
    expect(r).toMatchObject({ novos: 2, atualizados: 0, pesoTotal: 8800 });
    const r2 = actions.importarConjuntos([{ ...lista[0], quantidade: 10 }], 'OB-SF-CL-01');
    expect(r2).toMatchObject({ novos: 0, atualizados: 1 });
    const cs = getState().ds.conjuntos;
    expect(cs).toHaveLength(2);
    expect(cs.find((c) => c.marca === 'P-01')!.quantidade).toBe(10);
    expect(cs.find((c) => c.marca === 'P-01')!.servicoId).toBe(srv.id); // servico mantido na reimportacao sem servico
    expect(() => actions.salvarConjunto({ ...actions.novoConjunto('OB-SF-CL-01'), marca: 'P-01', pesoUnitario: 1 })).toThrow(/já existe/);
    expect(() => actions.salvarConjunto({ ...actions.novoConjunto('OB-SF-CL-01'), marca: 'Z', pesoUnitario: 0 })).toThrow(RegraDeNegocioError);
  });

  it('apontamentos acumulam, respeitam o total e encadeiam fabricado >= expedido >= montado', () => {
    const p = getState().ds.conjuntos.find((c) => c.marca === 'P-01')!;
    actions.apontarConjuntos([{ id: p.id, etapa: 'liberado' }], '2026-09-05');
    expect(getState().ds.conjuntos.find((c) => c.id === p.id)!.liberadoEm).toBe('2026-09-05');
    const r = actions.apontarConjuntos([{ id: p.id, etapa: 'fabricado', quantidade: 6 }], '2026-09-10', 'lote 1');
    expect(r.pesoApontado).toBe(3600);
    actions.apontarConjuntos([{ id: p.id, etapa: 'fabricado', quantidade: 6 }], '2026-09-12');
    let c = getState().ds.conjuntos.find((x) => x.id === p.id)!;
    expect(c.fabricadoQtd).toBe(10); // limitado ao total
    actions.apontarConjuntos([{ id: p.id, etapa: 'montado', quantidade: 4 }], '2026-09-20');
    c = getState().ds.conjuntos.find((x) => x.id === p.id)!;
    expect(c.montadoQtd).toBe(4);
    expect(c.expedidoQtd).toBe(4); // montado puxa o expedido
    expect(c.observacoes).toContain('lote 1');
    const o = obra360(getState().ds, getState().ds.obras[0]);
    expect(o.peso.pesoMontado).toBe(2400);
    const srv = o.servicos.find((s) => s.id === getState().ds.servicos[0].id)!;
    expect(srv.origemExecucao).toBe('Fabricação e montagem (kg)');
    expect(srv.pctExecucao).toBeCloseTo(0.6 * (6000 / 10000) + 0.4 * (2400 / 10000), 6); // 10 x 600 + 20 x 200
    expect(() => actions.excluirConjunto(p.id)).toThrow(/fabricação/);
    const v = getState().ds.conjuntos.find((x) => x.marca === 'V-01')!;
    actions.excluirConjunto(v.id);
    expect(getState().ds.conjuntos).toHaveLength(1);
  });
});

// Jornada: lista de materiais -> apontamento por estacao (kg/horas) -> conclusao de marcos nos conjuntos e nas ordens ->
// produtividade kg/HH -> romaneio de expedicao.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { META_KG_HH, resumoProdutividade } from '../core/producao';
import { etapasPadrao } from '../core/obras';
import { obra360 } from '../core/engine';

describe('producao por estacao', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  let colabA = ''; let colabB = ''; let p01 = ''; let v01 = '';

  it('prepara equipe, lista de materiais e ordem', () => {
    actions.salvarColaborador({ id: 'COL-A', nome: 'João Soldador', funcao: 'Soldador', vinculo: 'CLT', equipe: 'Fábrica - Solda', local: 'Fábrica', custoHora: 40, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    actions.salvarColaborador({ id: 'COL-B', nome: 'Pedro Ajudante', funcao: 'Ajudante', vinculo: 'CLT', equipe: 'Fábrica - Solda', local: 'Fábrica', custoHora: 20, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    colabA = 'COL-A'; colabB = 'COL-B';
    const srv = getState().ds.servicos[0];
    actions.importarConjuntos([{ marca: 'P-01', descricao: 'Pilar', tipo: 'Pilar', quantidade: 10, pesoUnitario: 500 }, { marca: 'V-01', descricao: 'Viga', tipo: 'Viga', quantidade: 20, pesoUnitario: 100 }], 'OB-SF-CL-01', srv.id);
    const cs = getState().ds.conjuntos;
    p01 = cs.find((c) => c.marca === 'P-01')!.id; v01 = cs.find((c) => c.marca === 'V-01')!.id;
    actions.salvarOrdem({ id: 'OF-1', codigoObra: 'OB-SF-CL-01', servicoId: srv.id, tipo: 'Fabricação', codigo: 'OF-1', descricao: 'Lote 1', quantidade: 7000, unidade: 'kg', prioridade: 'Normal', etapas: etapasPadrao('Fabricação'), observacoes: '', criadoEm: '', criadoPor: '' });
  });

  it('apontamento de estacao intermediaria nao conclui marco; pintura conclui fabricado; ordem acumula na etapa', () => {
    const corte = actions.apontarEstacao({ ...actions.novoApontamentoEstacao({ codigoObra: 'OB-SF-CL-01', linha: 'Fabricação', estacao: 'Corte', ordemId: 'OF-1' }), data: '2026-09-08', pesoKg: 3000, pecas: 12, colaboradores: [{ colaboradorId: colabA, horas: 8 }, { colaboradorId: colabB, horas: 8 }] });
    expect(corte.pesoKg).toBe(3000);
    expect(getState().ds.conjuntos.find((c) => c.id === p01)!.fabricadoQtd).toBe(0);
    let of = getState().ds.ordens.find((o) => o.id === 'OF-1')!;
    expect(of.etapas[0].quantidadeConcluida).toBe(3000);
    expect(of.etapas[0].status).toBe('Em andamento');
    // pintura com conjuntos: peso derivado dos conjuntos (4 x 500 + 10 x 100 = 3000 kg) e marco fabricado
    const pint = actions.apontarEstacao({ ...actions.novoApontamentoEstacao({ codigoObra: 'OB-SF-CL-01', linha: 'Fabricação', estacao: 'Pintura', ordemId: 'OF-1' }), data: '2026-09-10', conjuntos: [{ conjuntoId: p01, quantidade: 4 }, { conjuntoId: v01, quantidade: 10 }], colaboradores: [{ colaboradorId: colabB, horas: 6 }] });
    expect(pint.pesoKg).toBe(3000);
    expect(pint.pecas).toBe(14);
    const cs = getState().ds.conjuntos;
    expect(cs.find((c) => c.id === p01)!.fabricadoQtd).toBe(4);
    expect(cs.find((c) => c.id === v01)!.fabricadoQtd).toBe(10);
    of = getState().ds.ordens.find((o) => o.id === 'OF-1')!;
    expect(of.etapas.find((e) => e.nome === 'Pintura')!.quantidadeConcluida).toBe(3000);
    const o = obra360(getState().ds, getState().ds.obras[0]);
    expect(o.peso.pesoFabricado).toBe(3000);
    expect(() => actions.apontarEstacao({ ...actions.novoApontamentoEstacao({ codigoObra: 'OB-SF-CL-01', linha: 'Montagem', estacao: 'Corte' }), pesoKg: 1 })).toThrow(/Estação/);
    expect(() => actions.apontarEstacao({ ...actions.novoApontamentoEstacao({ codigoObra: 'OB-SF-CL-01' }), colaboradores: [{ colaboradorId: colabA, horas: 30 }], pesoKg: 1 })).toThrow(RegraDeNegocioError);
  });

  it('produtividade por estacao e colaborador, com custo de mao de obra e meta', () => {
    const r = resumoProdutividade(getState().ds, { codigoObra: 'OB-SF-CL-01' });
    expect(r.kgFabricados).toBe(3000);
    expect(r.horasFabrica).toBe(22);
    expect(r.kgPorHHFabrica).toBeCloseTo(6000 / 22, 6);
    expect(r.metaFabrica).toBeCloseTo(META_KG_HH.Fabricação, 6);
    expect(r.custoMaoDeObra).toBe(8 * 40 + 8 * 20 + 6 * 20);
    const corte = r.porEstacao.find((e) => e.chave === 'Fabricação:Corte')!;
    expect(corte.kgPorHH).toBeCloseTo(3000 / 16, 6);
    const pedro = r.porColaborador.find((c) => c.chave === colabB)!;
    expect(pedro.horas).toBe(14);
    expect(pedro.kg).toBeCloseTo(1500 + 3000, 6); // metade do corte (8 de 16 h) + toda a pintura
    expect(r.porDia).toHaveLength(2);
  });

  it('romaneio expede conjuntos, respeita o total e o cancelamento devolve', () => {
    const rom = actions.emitirRomaneio({ ...actions.novoRomaneio('OB-SF-CL-01'), transportadora: 'Carreta 1', placa: 'ABC1D23', itens: [{ conjuntoId: p01, quantidade: 3 }] });
    expect(rom.status).toBe('Emitido');
    let p = getState().ds.conjuntos.find((c) => c.id === p01)!;
    expect(p.expedidoQtd).toBe(3);
    expect(() => actions.emitirRomaneio({ ...actions.novoRomaneio('OB-SF-CL-01'), transportadora: 'x', itens: [{ conjuntoId: p01, quantidade: 8 }] })).toThrow(/ultrapassa/);
    actions.atualizarRomaneio(rom.id, { status: 'Entregue', entregueEm: '2026-09-12' });
    expect(getState().ds.romaneios[0].entregueEm).toBe('2026-09-12');
    actions.atualizarRomaneio(rom.id, { status: 'Cancelado', motivo: 'carga devolvida' });
    p = getState().ds.conjuntos.find((c) => c.id === p01)!;
    expect(p.expedidoQtd).toBe(0);
    // excluir o apontamento de pintura desfaz o fabricado
    const pint = getState().ds.apontamentosEstacao.find((a) => a.estacao === 'Pintura')!;
    actions.excluirApontamentoEstacao(pint.id, 'erro de lançamento');
    expect(getState().ds.conjuntos.find((c) => c.id === p01)!.fabricadoQtd).toBe(0);
  });
});

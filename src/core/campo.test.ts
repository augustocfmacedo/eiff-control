// Modo campo: equipe do local pela alocacao vigente, diario pre-preenchido, resumo do dia.
import { beforeAll, describe, expect, it } from 'vitest';
import { equipeDoLocal, linhasPadrao, resumoDiaCampo } from './equipe';
import { actions, getState } from '../data/store';

describe('modo campo: equipe do local e resumo do dia', () => {
  let obra = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    obra = getState().ds.obras.find((o) => o.status === 'Em execução')?.codigo ?? getState().ds.obras[0].codigo;
    actions.salvarColaborador({ id: 'COL-FAB', nome: 'Soldadora Fictícia', funcao: 'Soldador', vinculo: 'CLT', equipe: 'Fábrica A', local: 'Fábrica', custoHora: 30, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    actions.salvarColaborador({ id: 'COL-MON', nome: 'Montador Fictício', funcao: 'Montador', vinculo: 'CLT', equipe: 'Montagem A', local: 'Obra', codigoObraPadrao: obra, custoHora: 28, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    // a soldadora vai para o canteiro por uma semana
    actions.salvarAlocacao({ id: '', colaboradorId: 'COL-FAB', local: 'Obra', codigoObra: obra, de: '2026-10-05', ate: '2026-10-09', percentual: 1, observacoes: 'apoio na montagem' });
  });
  it('equipeDoLocal segue a alocação vigente e volta ao cadastro fora do período', () => {
    const ds = getState().ds;
    expect(equipeDoLocal(ds, '2026-10-06', 'Fábrica').map((c) => c.id)).not.toContain('COL-FAB');
    expect(equipeDoLocal(ds, '2026-10-06', 'Obra', obra).map((c) => c.id)).toEqual(expect.arrayContaining(['COL-FAB', 'COL-MON']));
    expect(equipeDoLocal(ds, '2026-10-12', 'Fábrica').map((c) => c.id)).toContain('COL-FAB');
    expect(equipeDoLocal(ds, '2026-10-12', 'Obra', obra).map((c) => c.id)).not.toContain('COL-FAB');
  });
  it('novoApontamento abre com a equipe alocada, todos presentes na jornada padrão', () => {
    const a = actions.novoApontamento('2026-10-06', 'Obra', obra);
    const ids = a.linhas.map((l) => l.colaboradorId);
    expect(ids).toContain('COL-FAB'); expect(ids).toContain('COL-MON');
    expect(a.linhas.every((l) => l.presenca === 'Presente' && l.horas === 8.8 && l.horasExtras === 0)).toBe(true);
    expect(linhasPadrao([])).toEqual([]);
  });
  it('resumoDiaCampo soma diários fechados, presentes, horas e kg por linha', () => {
    const a = actions.novoApontamento('2026-10-06', 'Obra', obra);
    const linhas = a.linhas.map((l) => (l.colaboradorId === 'COL-MON' ? { ...l, presenca: 'Falta' as const, horas: 0, horasExtras: 0 } : { ...l, horasExtras: 1 }));
    actions.salvarApontamento({ ...a, linhas }, true);
    const est = actions.novoApontamentoEstacao({ data: '2026-10-06', codigoObra: obra, linha: 'Montagem', estacao: 'Içamento', pesoKg: 1200, pecas: 6, colaboradores: [{ colaboradorId: 'COL-FAB', horas: 8 }] });
    actions.apontarEstacao(est);
    const r = resumoDiaCampo(getState().ds, '2026-10-06');
    expect(r.fechados).toBe(1);
    expect(r.presentes).toBe(linhas.filter((l) => l.presenca === 'Presente').length);
    expect(r.horas).toBeCloseTo(linhas.filter((l) => l.presenca === 'Presente').reduce((s, l) => s + l.horas + l.horasExtras, 0), 5);
    expect(r.kgCanteiro).toBe(1200); expect(r.kgFabrica).toBe(0); expect(r.horasEstacao).toBe(8); expect(r.apontamentosEstacao).toBe(1);
  });
});

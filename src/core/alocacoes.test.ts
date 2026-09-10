// Funcoes e alocacoes de colaboradores: catalogo, alocacao vigente por data, conflito de percentual, diario do dia por alocacao.
import { beforeAll, describe, expect, it } from 'vitest';
import { alocacoesVigentes, conflitosAlocacao, localDoColaborador, locaisDoDia } from './equipe';
import { RegraDeNegocioError, actions, getState } from '../data/store';

describe('funções e alocações de colaboradores', () => {
  let colabId = ''; let obraA = ''; let obraB = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    const ds = getState().ds; obraA = ds.obras[0].codigo; obraB = ds.obras[1]?.codigo ?? ds.obras[0].codigo;
    actions.salvarColaborador({ id: 'COL-TESTE', nome: 'Montador Fictício', funcao: 'Montador', vinculo: 'CLT', equipe: 'Montagem A', local: 'Obra', codigoObraPadrao: obraA, custoHora: 0, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    colabId = 'COL-TESTE';
  });
  it('função: nome único, categoria e custo/hora padrão; inativar não apaga', () => {
    const f = actions.salvarFuncao({ id: '', nome: 'Soldador MIG', categoria: 'Fábrica', custoHoraPadrao: 38.5, descricao: '', ativa: true });
    expect(f.id).toMatch(/^FUN-/); expect(getState().ds.funcoes.some((x) => x.nome === 'Soldador MIG')).toBe(true);
    expect(() => actions.salvarFuncao({ id: '', nome: ' soldador mig ', categoria: 'Fábrica', descricao: '', ativa: true })).toThrow(/já existe/);
    expect(() => actions.salvarFuncao({ id: '', nome: '', categoria: 'Fábrica', descricao: '', ativa: true })).toThrow(RegraDeNegocioError);
    actions.excluirFuncao(f.id);
    expect(getState().ds.funcoes.find((x) => x.id === f.id)?.ativa).toBe(false);
  });
  it('alocação: obra obrigatória quando local é Obra, datas coerentes, percentual entre 0 e 1, soma no período não passa de 100%', () => {
    const a = actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Obra', codigoObra: obraA, de: '2026-09-01', ate: '2026-09-30', percentual: 0.6, observacoes: '' });
    expect(a.id).toMatch(/^ALO-/);
    expect(() => actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Obra', de: '2026-09-01', percentual: 1, observacoes: '' })).toThrow(/obra/i);
    expect(() => actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Fábrica', de: '2026-09-10', ate: '2026-09-05', percentual: 1, observacoes: '' })).toThrow(/data/i);
    expect(() => actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Fábrica', de: '2026-09-10', percentual: 0, observacoes: '' })).toThrow(/percentual/i);
    expect(() => actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Fábrica', de: '2026-09-15', ate: '2026-09-20', percentual: 0.5, observacoes: '' })).toThrow(/110%/);
    const b = actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Fábrica', de: '2026-09-15', ate: '2026-09-20', percentual: 0.4, observacoes: '' });
    expect(conflitosAlocacao(getState().ds.alocacoes, { ...b, percentual: 0.5 }).length).toBeGreaterThan(0);
    expect(() => actions.salvarAlocacao({ id: '', colaboradorId: 'NAO-EXISTE', local: 'Fábrica', de: '2026-09-01', percentual: 1, observacoes: '' })).toThrow(/colaborador/i);
  });
  it('a alocação vigente define onde o colaborador aparece no diário do dia; sem alocação vale o cadastro; alocação aberta (sem fim) vale para frente', () => {
    const ds = getState().ds;
    expect(alocacoesVigentes(ds, '2026-09-16').filter((a) => a.colaboradorId === colabId)).toHaveLength(2);
    expect(localDoColaborador(ds, ds.colaboradores.find((c) => c.id === colabId)!, '2026-09-16')).toMatchObject({ local: 'Obra', codigoObra: obraA });
    const diaFab = locaisDoDia(ds, '2026-09-16').find((l) => l.local === 'Fábrica')!; expect(diaFab.colaboradores.some((c) => c.id === colabId)).toBe(true);
    const diaObraA = locaisDoDia(ds, '2026-09-16').find((l) => l.codigoObra === obraA)!; expect(diaObraA.colaboradores.some((c) => c.id === colabId)).toBe(true);
    expect(localDoColaborador(ds, ds.colaboradores.find((c) => c.id === colabId)!, '2026-12-01')).toMatchObject({ local: 'Obra', codigoObra: obraA, origem: 'cadastro' });
    if (obraB !== obraA) {
      actions.salvarAlocacao({ id: '', colaboradorId: colabId, local: 'Obra', codigoObra: obraB, de: '2026-11-01', percentual: 1, observacoes: '' });
      expect(localDoColaborador(getState().ds, getState().ds.colaboradores.find((c) => c.id === colabId)!, '2027-03-01')).toMatchObject({ codigoObra: obraB, origem: 'alocacao' });
      const diaObraA2 = locaisDoDia(getState().ds, '2027-03-01').find((l) => l.codigoObra === obraA); expect(diaObraA2?.colaboradores.some((c) => c.id === colabId) ?? false).toBe(false);
    }
  });
});

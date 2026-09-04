import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { progressoDe } from '../core/capacitacao';

describe('capacitacao: progresso', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('conclui uma licao so com a verificacao correta, sem duplicar; desfazer remove', () => {
    expect(() => actions.concluirLicao('base-navegacao', 0.5)).toThrow(RegraDeNegocioError);
    const t = actions.concluirLicao('base-navegacao');
    expect(t.licaoId).toBe('base-navegacao');
    expect(actions.concluirLicao('base-navegacao').id).toBe(t.id);
    expect(getState().ds.treinamentos).toHaveLength(1);
    const u = getState().usuario;
    expect(progressoDe(u, getState().ds.treinamentos).concluidas).toBe(1);
    actions.desfazerLicao('base-navegacao');
    expect(getState().ds.treinamentos).toHaveLength(0);
  });
});

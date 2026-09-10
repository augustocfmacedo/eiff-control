import { describe, expect, it } from 'vitest';
import { sugestoesPara } from './sugestoes';
import { actions, getState } from '../data/store';

describe('assistente contextual: sugestões por tela (motor, nada novo calculado)', () => {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds; const u = getState().usuario;
  it('cada sugestão tem id, tom, texto e, quando há, uma ação com rota; rotas sem regra devolvem lista vazia', () => {
    for (const rota of ['/', '/lancamentos', '/pagar', '/receber', `/obras/${ds.obras[0].codigo}`, '/radar', '/radar/hoje', '/conciliacao', '/producao', '/aprovacoes']) {
      for (const s of sugestoesPara(rota, ds, u)) { expect(s.id).toBeTruthy(); expect(['info', 'warn', 'bad']).toContain(s.tom); expect(s.texto.length).toBeGreaterThan(10); if (s.acao) expect(s.acao.to.startsWith('/')).toBe(true); }
    }
    expect(sugestoesPara('/cadastros', ds, u)).toEqual([]); expect(sugestoesPara('/capacitacao', ds, u)).toEqual([]);
  });
  it('a data-base muda o que está vencido: com "hoje" muito no futuro aparecem mais pendências do que com "hoje" no passado', () => {
    const cedo = sugestoesPara('/conciliacao', { ...ds, transacoes: ds.transacoes.map((t) => ({ ...t, lancamentoIds: [] })) }, u, '2020-01-01');
    const tarde = sugestoesPara('/conciliacao', { ...ds, transacoes: ds.transacoes.map((t) => ({ ...t, lancamentoIds: [] })) }, u, '2030-01-01');
    expect(cedo.some((s) => s.id === 'conc-velhas')).toBe(false);
    expect(tarde.some((s) => s.id === 'conc-velhas')).toBe(ds.transacoes.length > 0);
  });
});

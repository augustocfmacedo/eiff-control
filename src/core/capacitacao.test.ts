import { describe, expect, it } from 'vitest';
import { LICOES, PAPEIS, PROCESSOS, ROTAS_APP, ROTINAS, TRILHAS, licao, progressoDe, trilhaDe } from './capacitacao';
import type { Usuario } from './types';

describe('conteudo de capacitacao', () => {
  it('licoes com id unico, rota existente e verificacao valida', () => {
    const ids = LICOES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LICOES) {
      expect(ROTAS_APP, `rota de ${l.id}`).toContain(l.rota);
      expect(l.passos.length, `passos de ${l.id}`).toBeGreaterThan(0);
      expect(l.verificacao.length, `verificacao de ${l.id}`).toBeGreaterThan(0);
      for (const v of l.verificacao) { expect(v.opcoes.length).toBeGreaterThanOrEqual(2); expect(v.correta).toBeLessThan(v.opcoes.length); }
      expect(l.minutos).toBeGreaterThan(0);
    }
  });

  it('toda trilha referencia licoes existentes, comeca pela base e todo papel tem trilha e rotina', () => {
    for (const p of PAPEIS) {
      const t = TRILHAS[p];
      expect(t.length, p).toBeGreaterThan(3);
      expect(new Set(t).size).toBe(t.length);
      for (const id of t) expect(licao(id), `${p}: ${id}`).toBeDefined();
      expect(t.slice(0, 3)).toEqual(['base-navegacao', 'base-caixa-entrada', 'base-obra360']);
      const r = ROTINAS[p];
      for (const item of [...r.diaria, ...r.semanal, ...r.mensal]) { expect(ROTAS_APP).toContain(item.rota); if (item.licaoId) expect(licao(item.licaoId)).toBeDefined(); }
    }
    expect(TRILHAS.Administrador.length).toBe(LICOES.length);
  });

  it('processos apontam para licoes existentes', () => {
    for (const p of PROCESSOS) for (const e of p.etapas) if (e.licaoId) expect(licao(e.licaoId), `${p.id}: ${e.titulo}`).toBeDefined();
  });

  it('progresso por usuario', () => {
    const u: Usuario = { id: 'u1', nome: 'Ana', email: 'a@e', papel: 'Compras', obras: '*', ativo: true };
    const vazio = progressoDe(u, []);
    expect(vazio.total).toBe(trilhaDe('Compras').length);
    expect(vazio.pct).toBe(0);
    expect(vazio.proxima?.id).toBe('base-navegacao');
    const p = progressoDe(u, [{ id: 't1', usuarioId: 'u1', licaoId: 'base-navegacao', concluidoEm: '2026-09-04T10:00:00Z' }, { id: 't2', usuarioId: 'u2', licaoId: 'comp-pedido', concluidoEm: '2026-09-04T10:00:00Z' }]);
    expect(p.concluidas).toBe(1);
    expect(p.proxima?.id).toBe('base-caixa-entrada');
    expect(p.minutosRestantes).toBe(vazio.minutosRestantes - 8);
    expect(p.porArea.find((a) => a.area === 'Base')!.concluidas).toBe(1);
  });
});

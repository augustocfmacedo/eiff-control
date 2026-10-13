import { describe, expect, it } from 'vitest';
import { gerarSenha } from './Usuarios';

describe('senha inicial gerada', () => {
  it('12 caracteres, com letra e número, sem caracteres ambíguos; nunca repete', () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = gerarSenha();
      expect(s).toHaveLength(12);
      expect(s).toMatch(/[A-Za-z]/); expect(s).toMatch(/\d/);
      expect(s).not.toMatch(/[0O1lI]/);
      vistas.add(s);
    }
    expect(vistas.size).toBe(200);
  });
});

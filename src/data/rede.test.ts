import { describe, expect, it } from 'vitest';
import { ehErroDeRede } from './rede';

describe('classificação de falhas de sincronização', () => {
  it('sem conexão ou falha de rede fica pendente; regra de negócio e conflito de versão não', () => {
    expect(ehErroDeRede(new Error('TypeError: Failed to fetch'), true)).toBe(true);
    expect(ehErroDeRede(new Error('NetworkError when attempting to fetch resource.'), true)).toBe(true);
    expect(ehErroDeRede(new Error('qualquer coisa'), false)).toBe(true); // navigator.onLine === false
    expect(ehErroDeRede(new Error('Lançamento PAG-1 foi alterado por outro usuário. Recarregue.'), true)).toBe(false);
    expect(ehErroDeRede(new Error('new row violates row-level security policy'), true)).toBe(false);
    expect(ehErroDeRede(undefined, true)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { filtroPagador, pagadorPadrao } from './Lancamentos';

describe('Contas a pagar: EIFF × faturado ao cliente', () => {
  const eiff: { id: string; faturamentoDireto?: boolean } = { id: 'PAG-1' }; const direto = { id: 'PAG-FD-1', faturamentoDireto: true };
  it('padrão: Contas a pagar mostra só o que é da EIFF; Lançamentos e Contas a receber mostram tudo', () => {
    expect(pagadorPadrao('pagar')).toBe('eiff');
    expect(pagadorPadrao('todos')).toBe('todos');
    expect(pagadorPadrao('receber')).toBe('todos');
  });
  it('filtra pelo faturamento direto', () => {
    expect([eiff, direto].filter(filtroPagador('eiff'))).toEqual([eiff]);
    expect([eiff, direto].filter(filtroPagador('cliente'))).toEqual([direto]);
    expect([eiff, direto].filter(filtroPagador('todos'))).toEqual([eiff, direto]);
  });
});

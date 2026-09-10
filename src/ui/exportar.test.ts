import { describe, expect, it } from 'vitest';
import { celulaCsv, montarCsv } from './exportar';

describe('exportação CSV pt-BR', () => {
  it('separa por ponto e vírgula, usa vírgula decimal, escapa aspas e quebras e trata vazios', () => {
    expect(celulaCsv(1234.5)).toBe('1234,5'); expect(celulaCsv('a;b')).toBe('"a;b"'); expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""'); expect(celulaCsv(undefined)).toBe(''); expect(celulaCsv(null)).toBe('');
    expect(montarCsv(['ID', 'Valor'], [['A-1', 10], ['B-2', 0.25]])).toBe('ID;Valor\r\nA-1;10\r\nB-2;0,25');
  });
});

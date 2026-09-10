import { describe, expect, it } from 'vitest';
import { buscar, normalizar, ordenarLinhas, pontuar } from './busca';

describe('busca da paleta e ordenação da tabela', () => {
  it('normaliza acentos e espaços; pontua início de palavra acima de meio de palavra; exige todos os termos', () => {
    expect(normalizar('  Orçamentos   e Composições ')).toBe('orcamentos e composicoes');
    expect(pontuar('Contas a pagar', 'pagar')).toBeGreaterThan(pontuar('Compras e pedidos', 'pra'));
    expect(pontuar('Smart Fit César Lattes', 'smart lattes')).toBeGreaterThan(0);
    expect(pontuar('Smart Fit César Lattes', 'smart xyz')).toBe(-1);
    expect(pontuar('qualquer', '')).toBe(0);
  });
  it('buscar filtra, ordena por pontuação com empate estável e limita', () => {
    const itens = [{ chaveBusca: 'Fluxo 24 meses' }, { chaveBusca: 'Fluxo 13 semanas' }, { chaveBusca: 'DRE gerencial' }, { chaveBusca: 'Refluxo' }];
    expect(buscar(itens, 'fluxo').map((i) => i.chaveBusca)).toEqual(['Fluxo 24 meses', 'Fluxo 13 semanas', 'Refluxo']);
    expect(buscar(itens, 'fluxo 13').map((i) => i.chaveBusca)).toEqual(['Fluxo 13 semanas']);
    expect(buscar(itens, '', 2)).toHaveLength(2);
  });
  it('ordenarLinhas: números, texto pt-BR com numérico, undefined no fim nas duas direções, estável', () => {
    const linhas = [{ n: 'OB-10', v: 5 }, { n: 'OB-2', v: undefined }, { n: 'ob-1', v: 5 }, { n: 'Árvore', v: 1 }];
    expect(ordenarLinhas(linhas, (l) => l.n).map((l) => l.n)).toEqual(['Árvore', 'ob-1', 'OB-2', 'OB-10']);
    expect(ordenarLinhas(linhas, (l) => l.v).map((l) => l.n)).toEqual(['Árvore', 'OB-10', 'ob-1', 'OB-2']);
    expect(ordenarLinhas(linhas, (l) => l.v, true).map((l) => l.n)).toEqual(['OB-10', 'ob-1', 'Árvore', 'OB-2']);
    expect(ordenarLinhas(linhas, undefined)).toBe(linhas);
  });
});

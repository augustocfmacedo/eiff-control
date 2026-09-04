import { describe, expect, it } from 'vitest';
import { LICOES } from './capacitacao';
import { SETORES, gerarHtmlCompleto, gerarHtmlSetor, licoesDoSetor, processosDoSetor } from './ebook';
import { buscarLocal, montarConhecimento, montarContexto, sugestoesPara } from './assistente';

describe('e-book por setor', () => {
  it('todo setor tem licoes, processos e conteudo proprio; toda licao esta em algum setor', () => {
    const cobertas = new Set<string>();
    for (const s of SETORES) {
      expect(licoesDoSetor(s).length, s.id).toBeGreaterThan(1);
      expect(processosDoSetor(s).length, s.id).toBeGreaterThan(0);
      expect(s.introducao.length).toBeGreaterThan(1);
      expect(s.conceitos.length).toBeGreaterThan(2);
      for (const l of licoesDoSetor(s)) cobertas.add(l.id);
    }
    for (const l of LICOES) expect(cobertas.has(l.id), l.id).toBe(true);
    expect(new Set(SETORES.map((s) => s.id)).size).toBe(SETORES.length);
  });

  it('gera html autocontido com capa, sumario, licoes e faq', () => {
    const s = SETORES.find((x) => x.id === 'financeiro')!;
    const html = gerarHtmlSetor(s, { data: '2026-09-04', empresa: 'EIFF' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Financeiro e tesouraria');
    expect(html).toContain('04/09/2026');
    for (const l of licoesDoSetor(s)) expect(html).toContain(l.titulo);
    expect(html).toContain('Perguntas frequentes');
    expect(html).not.toContain('<script');
    const completo = gerarHtmlCompleto({ data: '2026-09-04' });
    for (const x of SETORES) expect(completo).toContain(x.titulo);
    expect(completo.length).toBeGreaterThan(html.length);
  });
});

describe('assistente', () => {
  it('conhecimento inclui regras, licoes e processos; contexto inclui papel', () => {
    const k = montarConhecimento();
    for (const l of LICOES) expect(k).toContain(`[id ${l.id}]`);
    expect(k).toContain('FITID');
    expect(k).toContain('Fluxo 13 semanas');
    expect(k.length).toBeGreaterThan(20000);
    expect(montarContexto({ papel: 'Compras', nome: 'Ana', tela: '/compras' })).toContain('Papel: Compras');
  });

  it('busca local encontra a licao certa', () => {
    expect(buscarLocal('como lançar uma despesa da obra').licoes[0].id).toBe('fin-lancamento');
    expect(buscarLocal('importar extrato do banco').licoes[0].id).toBe('fin-ofx');
    expect(buscarLocal('dar entrada no aço com a corrida').licoes[0].id).toBe('est-entrada');
    expect(buscarLocal('apontar horas na estação de solda', 'Gestor de obra').licoes[0].id).toBe('fab-apontar-estacao');
    expect(buscarLocal('xyzzy').licoes).toHaveLength(0);
    expect(buscarLocal('romaneio').texto).toContain('[/producao]');
    expect(sugestoesPara('Financeiro').length).toBeGreaterThan(3);
  });
});

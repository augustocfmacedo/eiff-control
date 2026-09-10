// Assistente do dia (modo campo): clima com temperatura, faltas por excecao, horas por estacao sem contar duas vezes, pendencias.
import { beforeAll, describe, expect, it } from 'vitest';
import { alternarAusencia, climaDe, climaTexto, estadoDoFluxo, horasPorEstacao, iniciarRascunho, marcacoesVazias, pendenciasDoFluxo } from './campoFluxo';
import { actions, getState } from '../data/store';

describe('fluxo guiado do dia', () => {
  let obra = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    obra = getState().ds.obras.find((o) => o.status === 'Em execução')?.codigo ?? getState().ds.obras[0].codigo;
    actions.salvarColaborador({ id: 'COL-A', nome: 'A Fictício', funcao: 'Soldador', vinculo: 'CLT', equipe: 'Fábrica', local: 'Fábrica', custoHora: 30, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    actions.salvarColaborador({ id: 'COL-C', nome: 'C Fictício', funcao: 'Montador', vinculo: 'CLT', equipe: 'Montagem', local: 'Obra', codigoObraPadrao: obra, custoHora: 25, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
    actions.salvarColaborador({ id: 'COL-B', nome: 'B Fictício', funcao: 'Ajudante', vinculo: 'CLT', equipe: 'Fábrica', local: 'Fábrica', custoHora: 20, jornadaDiaria: 8.8, ativo: true, observacoes: '' });
  });
  it('clima e temperatura viajam juntos no texto e voltam separados', () => {
    expect(climaTexto('Nublado', 31)).toBe('Nublado · 31 °C');
    expect(climaTexto(undefined, 28)).toBe('28 °C');
    expect(climaTexto('Bom')).toBe('Bom');
    expect(climaDe('Nublado · 31 °C')).toEqual({ clima: 'Nublado', temperatura: 31 });
    expect(climaDe('28 °C')).toEqual({ clima: undefined, temperatura: 28 });
    expect(climaDe('Chuva forte')).toEqual({ clima: 'Chuva forte' });
  });
  it('o rascunho nasce com todos presentes; marcar falta zera horas e voltar a presente devolve a jornada', () => {
    const r = iniciarRascunho(getState().ds, '2026-10-06', 'fabrica', undefined, () => actions.novoApontamento('2026-10-06', 'Fábrica'));
    expect(r.apontamento.linhas.map((l) => l.colaboradorId)).toEqual(expect.arrayContaining(['COL-A', 'COL-B']));
    expect(r.apontamento.linhas.every((l) => l.presenca === 'Presente')).toBe(true);
    const comFalta = alternarAusencia(r.apontamento.linhas, 'COL-B', 'Atestado', 8.8);
    expect(comFalta.find((l) => l.colaboradorId === 'COL-B')).toMatchObject({ presenca: 'Atestado', horas: 0, horasExtras: 0 });
    expect(alternarAusencia(comFalta, 'COL-B', 'Presente', 8.8).find((l) => l.colaboradorId === 'COL-B')).toMatchObject({ presenca: 'Presente', horas: 8.8 });
  });
  it('horas por estação dividem as horas do diário entre as estações marcadas; estação sem produção é ignorada', () => {
    const linhas = [{ colaboradorId: 'COL-A', presenca: 'Presente' as const, horas: 8, horasExtras: 2 }, { colaboradorId: 'COL-B', presenca: 'Falta' as const, horas: 0, horasExtras: 0 }];
    const m = marcacoesVazias('Fabricação');
    m[0] = { ...m[0], pesoKg: 500, quem: ['COL-A', 'COL-B'] }; // Corte
    m[3] = { ...m[3], pesoKg: 300, quem: ['COL-A'] }; // Solda
    m[4] = { ...m[4], quem: ['COL-A'] }; // Pintura sem kg: ignorada
    const h = horasPorEstacao(linhas, m, () => 8.8);
    expect(h.get('Corte')).toEqual([{ colaboradorId: 'COL-A', horas: 5 }]); // B faltou: 0 h, sai
    expect(h.get('Solda')).toEqual([{ colaboradorId: 'COL-A', horas: 5 }]);
    expect(h.has('Pintura')).toBe(false);
  });
  it('pendências: canteiro exige clima; hora extra e ocorrência precisam de confirmação; estação com kg precisa de gente', () => {
    const r = iniciarRascunho(getState().ds, '2026-10-06', 'canteiro', obra, () => actions.novoApontamento('2026-10-06', 'Obra', obra));
    const p = pendenciasDoFluxo(r, 'canteiro');
    expect(p.some((x) => /clima/i.test(x))).toBe(true);
    expect(p.some((x) => /hora extra/i.test(x))).toBe(true);
    expect(p.some((x) => /ocorrência/i.test(x))).toBe(true);
    r.apontamento = { ...r.apontamento, clima: 'Bom' }; r.semExtras = true; r.semOcorrencias = true;
    r.marcacoes[0] = { ...r.marcacoes[0], pesoKg: 100 };
    expect(pendenciasDoFluxo(r, 'canteiro')).toEqual(['Marque quem trabalhou nas estações com produção.']);
    r.marcacoes[0].quem = ['COL-C'];
    expect(pendenciasDoFluxo(r, 'canteiro')).toEqual([]);
  });
  it('estado do fluxo reflete diário e estações do dia', () => {
    const a = actions.novoApontamento('2026-10-07', 'Fábrica');
    actions.salvarApontamento({ ...a, linhas: a.linhas.map((l) => (l.colaboradorId === 'COL-B' ? { ...l, presenca: 'Falta', horas: 0 } : { ...l, horasExtras: 1.5 })) }, true);
    actions.apontarEstacao(actions.novoApontamentoEstacao({ data: '2026-10-07', codigoObra: obra, linha: 'Fabricação', estacao: 'Corte', pesoKg: 400, colaboradores: [{ colaboradorId: 'COL-A', horas: 8 }] }));
    const e = estadoDoFluxo(getState().ds, '2026-10-07', 'fabrica');
    expect(e.situacao).toBe('fechado'); expect(e.faltas).toBe(1); expect(e.extras).toBeGreaterThan(0); expect(e.kgEstacoes).toBe(400); expect(e.estacoesHoje).toBe(1);
    expect(estadoDoFluxo(getState().ds, '2026-10-08', 'fabrica').situacao).toBe('nao_iniciado');
  });
});

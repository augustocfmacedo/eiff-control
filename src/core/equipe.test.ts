import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import type { Apontamento, Colaborador, Dataset, Tarefa } from './types';
import { calcTarefas, custoLinha, locaisDoDia, resumoEquipe } from './equipe';

const base = seed as unknown as Dataset;
const DB = base.params.dataBase; // 2026-09-01

const colabs: Colaborador[] = [
  { id: 'C1', nome: 'João', funcao: 'Montador', vinculo: 'CLT', equipe: 'Montagem A', local: 'Obra', codigoObraPadrao: 'OB-SF-CL-01', custoHora: 40, jornadaDiaria: 8.8, ativo: true, observacoes: '' },
  { id: 'C2', nome: 'Pedro', funcao: 'Ajudante', vinculo: 'CLT', equipe: 'Montagem A', local: 'Obra', custoHora: 25, jornadaDiaria: 8.8, ativo: true, observacoes: '' },
  { id: 'C3', nome: 'Carlos', funcao: 'Soldador', vinculo: 'CLT', equipe: 'Fábrica - Solda', local: 'Fábrica', custoHora: 45, jornadaDiaria: 8.8, ativo: true, observacoes: '' },
];
const srv = base.servicos.find((s) => s.nome.toLowerCase().includes('estrutura met'))!;
const aps: Apontamento[] = [
  { id: 'A1', data: '2026-08-31', local: 'Obra', codigoObra: 'OB-SF-CL-01', linhas: [{ colaboradorId: 'C1', presenca: 'Presente', horas: 8.8, horasExtras: 2, servicoId: srv.id }, { colaboradorId: 'C2', presenca: 'Falta', horas: 0, horasExtras: 0 }], producao: [{ servicoId: srv.id, descricao: 'eixo A', quantidade: 4, unidade: 't' }], ocorrencias: [{ tipo: 'Chuva', descricao: 'manhã', horasPerdidas: 3 }], fotos: [], observacoes: '', status: 'Fechado', responsavel: 'x', criadoEm: DB },
  { id: 'A2', data: '2026-09-01', local: 'Obra', codigoObra: 'OB-SF-CL-01', linhas: [{ colaboradorId: 'C1', presenca: 'Presente', horas: 8.8, horasExtras: 0, servicoId: srv.id }, { colaboradorId: 'C2', presenca: 'Presente', horas: 8.8, horasExtras: 0, servicoId: srv.id }], producao: [{ servicoId: srv.id, descricao: 'eixo B', quantidade: 6, unidade: 't' }], ocorrencias: [], fotos: [], observacoes: '', status: 'Rascunho', responsavel: 'x', criadoEm: DB },
  { id: 'A3', data: '2026-09-01', local: 'Fábrica', linhas: [{ colaboradorId: 'C3', presenca: 'Presente', horas: 8.8, horasExtras: 1 }], producao: [{ descricao: 'vigas', quantidade: 3, unidade: 't' }], ocorrencias: [], fotos: [], observacoes: '', status: 'Fechado', responsavel: 'x', criadoEm: DB },
];
const ds: Dataset = { ...base, colaboradores: colabs, apontamentos: aps };

describe('resumo de equipe', () => {
  it('custo da linha: normal + extra 1,5x', () => {
    expect(custoLinha({ colaboradorId: 'C1', presenca: 'Presente', horas: 8, horasExtras: 2 }, colabs[0])).toBe(8 * 40 + 2 * 40 * 1.5);
  });
  it('consolida efetivo, horas, custo, absenteísmo e produtividade', () => {
    const r = resumoEquipe(ds, { ini: '2026-08-31', fim: '2026-09-01' });
    expect(r.diasApontados).toBe(2);
    expect(r.presentes).toBe(4);
    expect(r.faltas).toBe(1);
    expect(r.absenteismo).toBeCloseTo(0.2, 4);
    expect(r.efetivoMedio).toBe(2);
    expect(r.horas).toBeCloseTo(8.8 * 4, 4);
    expect(r.horasExtras).toBe(3);
    expect(r.custoMO).toBeCloseTo(8.8 * 40 + 2 * 60 + 8.8 * 40 + 8.8 * 25 + 8.8 * 45 + 1 * 67.5, 2);
    expect(r.horasPerdidas).toBe(3);
    expect(r.ocorrencias[0]).toEqual({ tipo: 'Chuva', quantidade: 1, horas: 3 });
    expect(r.producao[0]).toEqual({ unidade: 't', quantidade: 13 });
    expect(r.hhPorTonelada).toBeCloseTo((8.8 * 4 + 3) / 13, 4);
  });
  it('filtra por obra e aloca custo por serviço', () => {
    const r = resumoEquipe(ds, { ini: '2026-08-31', fim: '2026-09-01' }, { codigoObra: 'OB-SF-CL-01' });
    expect(r.porLocal).toHaveLength(1);
    expect(r.porServico).toHaveLength(1);
    const s = r.porServico[0];
    expect(s.horas).toBeCloseTo(8.8 * 3, 4);
    expect(s.custoMO).toBeCloseTo(8.8 * 40 + 2 * 60 + 8.8 * 40 + 8.8 * 25, 2);
    expect(s.producao).toEqual([{ unidade: 't', quantidade: 10 }]);
    expect(s.hhPorUnidade).toBeCloseTo((8.8 * 3 + 2) / 10, 4);
    expect(r.porColaborador[0].colaborador.id).toBe('C1');
    expect(r.porColaborador.find((x) => x.colaborador.id === 'C2')!.absenteismo).toBe(0.5);
  });
  it('locais do dia: fabrica e obras ativas com status do diario', () => {
    const l = locaisDoDia(ds, '2026-09-01');
    expect(l.map((x) => x.rotulo)).toEqual(['Fábrica', 'OB-SF-CL-01 · Smart Fit - Avenida César Lattes']);
    expect(l[0].apontamento?.id).toBe('A3');
    expect(l[1].colaboradores.map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(locaisDoDia(ds, '2026-09-02')[1].apontamento).toBeUndefined();
  });
});

describe('tarefas de campo', () => {
  it('marca atraso e dias para o prazo', () => {
    const t: Tarefa = { id: 'T1', titulo: 'x', responsavel: 'u', prazo: '2026-08-30', status: 'Aberta', origem: 'campo', criadoEm: DB };
    const c = calcTarefas({ ...ds, tarefas: [t, { ...t, id: 'T2', prazo: '2026-09-03' }, { ...t, id: 'T3', status: 'Concluída' }] }, DB);
    expect(c[0].atrasada).toBe(true);
    expect(c[0].diasParaPrazo).toBe(-2);
    expect(c[1].atrasada).toBe(false);
    expect(c[2].atrasada).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { construirCommercialQueue } from './commercialMachine';
import { radarVazio, type Empresa, type RadarDataset } from './types';

const HOJE = '2026-09-15T12:00:00.000Z';

function empresa(id: string, priorityClass: Empresa['priorityClass'] = 'B', priorityScore = 50): Empresa {
  return {
    id, razaoSocial: id, pais: 'BR', observacoes: '', ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z', atualizadoEm: '2026-09-01T00:00:00.000Z',
    fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50,
    priorityScore, priorityClass,
  };
}

function ds(...empresas: Empresa[]): RadarDataset {
  return { ...radarVazio(), empresas };
}

describe('Commercial Machine CM0', () => {
  it('coloca tarefa vencida em AGIR_AGORA e preserva a proxima acao', () => {
    const base = ds(empresa('a', 'A', 80));
    base.tarefas.push({ id: 't1', empresaId: 'a', responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Alta', venceEm: '2026-09-14T12:00:00.000Z', status: 'Aberta', descricao: 'Ligar para o decisor', criadoEm: '2026-09-10T00:00:00.000Z' });
    const fila = construirCommercialQueue(base, HOJE);
    expect(fila.itens[0]).toMatchObject({ empresaId: 'a', categoria: 'AGIR_AGORA', proximaAcao: 'Ligar para o decisor' });
    expect(fila.itens[0].razoes[0].codigo).toBe('TAREFA_VENCIDA');
  });

  it('REVISAR tem precedencia sobre sinal quente quando existe artefato pendente de revisao', () => {
    const base = ds(empresa('a', 'A+', 92));
    base.sinais.push({ id: 's1', empresaId: 'a', fonteId: 'f1', fonteTipo: 'NEWS', tipo: 'INVESTMENT', titulo: 'Expansao', descricao: 'Expansao confirmada', eventoEm: '2026-09-14T00:00:00.000Z', detectadoEm: '2026-09-14T00:00:00.000Z', confianca: 1, scoreBase: 90, scoreEfetivo: 90, verificado: true, criadoEm: '2026-09-14T00:00:00.000Z' });
    base.comunicacoes.push({ id: 'c1', empresaId: 'a', contatoId: 'x', canal: 'EMAIL', objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', estado: 'READY_FOR_REVIEW', spec: {}, resultado: { versaoPrincipal: 'x', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, contextHash: 'h', versoes: { playbook: '1', contentSpec: '1', prompt: '1', provedor: 'det' }, validacao: { ok: true, problemas: [] }, criadoEm: HOJE, atualizadoEm: HOJE, criadoPor: 'u1', historico: [] });
    const item = construirCommercialQueue(base, HOJE).itens[0];
    expect(item.categoria).toBe('REVISAR');
    expect(item.razoes.map(r => r.codigo)).toEqual(expect.arrayContaining(['RASCUNHO_PARA_REVISAO', 'SINAL_QUENTE']));
  });

  it('manda conta A sem contato anterior para PROSPECTAR quando existe decisor e canal valido', () => {
    const base = ds(empresa('a', 'A', 78));
    base.contatos.push({ id: 'p1', empresaId: 'a', nome: 'Pessoa', email: 'pessoa@empresa.com', decisor: true, decisionFitScore: 85, qualidade: 90, observacoes: '', ativo: true, criadoEm: HOJE, atualizadoEm: HOJE });
    const item = construirCommercialQueue(base, HOJE).itens[0];
    expect(item.categoria).toBe('PROSPECTAR');
    expect(item.contatoId).toBe('p1');
    expect(item.razoes.map(r => r.codigo)).toContain('CONTA_PRIORITARIA_SEM_CONTATO');
  });

  it('manda conta sem decisor ou canal para ENRIQUECER', () => {
    const item = construirCommercialQueue(ds(empresa('a', 'B', 45)), HOJE).itens[0];
    expect(item.categoria).toBe('ENRIQUECER');
    expect(item.razoes.map(r => r.codigo)).toEqual(expect.arrayContaining(['SEM_DECISOR', 'SEM_CANAL_VALIDO']));
  });

  it('manda oportunidade ativa sem proxima acao para AVANCAR_OPORTUNIDADE', () => {
    const base = ds(empresa('a', 'B', 55));
    base.contatos.push({ id: 'p1', empresaId: 'a', nome: 'Pessoa', telefone: '5562999999999', decisor: true, qualidade: 80, observacoes: '', ativo: true, criadoEm: HOJE, atualizadoEm: HOJE });
    base.oportunidades.push({ id: 'o1', empresaId: 'a', titulo: 'Galpao', estagio: 'QUALIFIED', probabilidade: 0.3, responsavelId: 'u1', observacoes: '', criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '2026-09-14T00:00:00.000Z' });
    const item = construirCommercialQueue(base, HOJE).itens[0];
    expect(item.categoria).toBe('AVANCAR_OPORTUNIDADE');
    expect(item.oportunidadeId).toBe('o1');
  });

  it('ordena de forma deterministica pela prioridade operacional e depois pelo score da empresa', () => {
    const base = ds(empresa('b', 'A', 90), empresa('a', 'A', 70));
    for (const id of ['a', 'b']) base.tarefas.push({ id: `t-${id}`, empresaId: id, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Alta', venceEm: '2026-09-14T00:00:00.000Z', status: 'Aberta', descricao: 'Follow-up', criadoEm: '2026-09-10T00:00:00.000Z' });
    expect(construirCommercialQueue(base, HOJE).itens.map(i => i.empresaId)).toEqual(['b', 'a']);
  });

  it('recusa data de referencia invalida', () => {
    expect(() => construirCommercialQueue(ds(empresa('a')), 'nao-e-data')).toThrow('commercial_queue_data_invalida');
  });
});

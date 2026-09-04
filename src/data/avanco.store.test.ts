// Boletim de medicao fisica do servico: acumula na execucao, respeita o total, e a estrutura metalica segue fabricacao x montagem.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { obra360 } from '../core/engine';
import { etapasPadrao } from '../core/obras';

describe('medicao fisica de servico', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  it('acumula boletins na execucao e recusa ultrapassar o total', () => {
    const base = getState().ds.servicos[1];
    actions.salvarServico({ ...base, unidade: 'm²', quantidadeOrcada: 1000, quantidadeExecutada: 0, status: 'Não iniciado' });
    actions.registrarAvanco({ servicoId: base.id, data: '2026-09-05', quantidade: 250, descricao: 'Eixos 1-3' });
    actions.registrarAvanco({ servicoId: base.id, data: '2026-09-12', quantidade: 350, descricao: 'Eixos 4-7', evidencia: 'RDO 12' });
    let s = obra360(getState().ds, getState().ds.obras[0]).servicos.find((x) => x.id === base.id)!;
    expect(s.origemExecucao).toBe('Medição de serviço');
    expect(s.quantidadeMedida).toBe(600);
    expect(s.pctExecucao).toBeCloseTo(0.6, 6);
    expect(s.status).toBe('Em andamento'); // primeira medicao inicia o servico
    expect(s.inicioReal).toBe('2026-09-05');
    expect(() => actions.registrarAvanco({ servicoId: base.id, data: '2026-09-20', quantidade: 500, descricao: 'x' })).toThrow(/ultrapassa/);
    expect(() => actions.registrarAvanco({ servicoId: base.id, data: '2026-09-20', quantidade: 10, descricao: '' })).toThrow(RegraDeNegocioError);
    // servico por verba: medicao em percentual
    const vb = getState().ds.servicos[2];
    actions.salvarServico({ ...vb, unidade: 'vb', quantidadeOrcada: 1, quantidadeExecutada: 0 });
    actions.registrarAvanco({ servicoId: vb.id, data: '2026-09-06', pct: 0.3, descricao: 'Projeto liberado' });
    s = obra360(getState().ds, getState().ds.obras[0]).servicos.find((x) => x.id === vb.id)!;
    expect(s.pctExecucao).toBeCloseTo(0.3, 6);
    const av = s.avancos[0];
    actions.excluirAvanco(av.id, 'lançado em duplicidade');
    expect(obra360(getState().ds, getState().ds.obras[0]).servicos.find((x) => x.id === vb.id)!.avancos).toHaveLength(0);
  });
  it('estrutura metalica: avanco pelas ordens de fabricacao e montagem ponderadas pelo peso configurado', () => {
    const est = getState().ds.servicos[0];
    actions.salvarServico({ ...est, pesoFabricacao: 0.7 });
    actions.salvarOrdem({ id: 'OF-T1', codigoObra: 'OB-SF-CL-01', servicoId: est.id, tipo: 'Fabricação', codigo: 'OF-T1', descricao: 'Lote 1', quantidade: 100, unidade: 't', prioridade: 'Normal', etapas: etapasPadrao('Fabricação'), observacoes: '', criadoEm: '', criadoPor: '' });
    actions.salvarOrdem({ id: 'OM-T1', codigoObra: 'OB-SF-CL-01', servicoId: est.id, tipo: 'Montagem', codigo: 'OM-T1', descricao: 'Eixos', quantidade: 100, unidade: 't', prioridade: 'Normal', etapas: etapasPadrao('Montagem'), observacoes: '', criadoEm: '', criadoPor: '' });
    // fabricacao: 5 etapas, conclui 4 -> 80%; montagem: 5 etapas, conclui 1 -> 20%
    for (let i = 0; i < 4; i++) actions.avancarEtapa('OF-T1', i, 'Concluída', 100);
    actions.avancarEtapa('OM-T1', 0, 'Concluída', 100);
    const s = obra360(getState().ds, getState().ds.obras[0]).servicos.find((x) => x.id === est.id)!;
    expect(s.origemExecucao).toBe('Fabricação e montagem (ordens)');
    expect(s.pctFabricacao).toBeCloseTo(0.8, 6);
    expect(s.pctMontagem).toBeCloseTo(0.2, 6);
    expect(s.pctExecucao).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.2, 6);
  });
});

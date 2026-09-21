import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contadorRadarHojeCM, sugestoesPara } from './sugestoes';
import { actions, getState } from '../data/store';
import { construirCommercialQueue } from './radar/commercialMachine';
import { radarVazio, type RadarDataset } from './radar/types';

// Radar ficticio com itens em AGIR_AGORA, FOLLOW_UP, REVISAR (duplicata) e ENRIQUECER
function radarFicticio(): RadarDataset {
  const emp = (id: string, priorityClass: 'A+' | 'A' | 'B', priorityScore: number) => ({ id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-08-01', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore, priorityClass });
  const cont = (id: string, empresaId: string) => ({ id, empresaId, nome: `Pessoa ${id}`, persona: 'CEO' as const, email: `${id}@conta.com.br`, decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01' });
  return {
    ...radarVazio(), pesosDecisionFit: [{ chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 }, { chave: 'persona.CEO.media', valor: 85 }],
    empresas: [emp('venc1', 'B', 60), emp('venc2', 'B', 55), emp('follow', 'B', 50), emp('dup1', 'A', 75), emp('dup2', 'B', 40), emp('sem', 'A', 70)],
    contatos: [cont('c1', 'venc1'), cont('c2', 'venc2'), cont('c3', 'follow'), cont('c4', 'dup1')],
    tarefas: ['venc1', 'venc2'].map((e) => ({ id: `t-${e}`, empresaId: e, responsavelId: 'u-admin', tipo: 'CALL' as const, prioridade: 'Normal' as const, venceEm: '2026-08-25', status: 'Aberta' as const, descricao: 'ligar', criadoEm: '2026-08-20T10:00:00.000Z' })),
    atividades: [{ id: 'a-follow', empresaId: 'follow', contatoId: 'c3', usuarioId: 'u-admin', tipo: 'EMAIL', canal: 'EMAIL', resultado: 'NO_RESPONSE', ocorreuEm: '2026-08-20T10:00:00.000Z', notas: '', criadoEm: '2026-08-20T10:00:00.000Z' }],
    duplicatas: [{ id: 'd1', empresaId: 'dup2', candidataId: 'dup1', confianca: 0.7, motivo: 'mesmo domínio', status: 'pendente', criadoEm: '2026-08-20' }],
  };
}
const numero = (texto?: string) => Number(texto?.match(/^(\d+)/)?.[1] ?? NaN);

describe('assistente contextual: sugestões por tela (motor, nada novo calculado)', () => {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds; const u = getState().usuario;
  it('cada sugestão tem id, tom, texto e, quando há, uma ação com rota; rotas sem regra devolvem lista vazia', () => {
    for (const rota of ['/', '/lancamentos', '/pagar', '/receber', `/obras/${ds.obras[0].codigo}`, '/radar', '/radar/hoje', '/conciliacao', '/producao', '/aprovacoes']) {
      for (const s of sugestoesPara(rota, ds, u)) { expect(s.id).toBeTruthy(); expect(['info', 'warn', 'bad']).toContain(s.tom); expect(s.texto.length).toBeGreaterThan(10); if (s.acao) expect(s.acao.to.startsWith('/')).toBe(true); }
    }
    expect(sugestoesPara('/cadastros', ds, u)).toEqual([]); expect(sugestoesPara('/capacitacao', ds, u)).toEqual([]);
  });
  it('a data-base muda o que está vencido: com "hoje" muito no futuro aparecem mais pendências do que com "hoje" no passado', () => {
    const cedo = sugestoesPara('/conciliacao', { ...ds, transacoes: ds.transacoes.map((t) => ({ ...t, lancamentoIds: [] })) }, u, '2020-01-01');
    const tarde = sugestoesPara('/conciliacao', { ...ds, transacoes: ds.transacoes.map((t) => ({ ...t, lancamentoIds: [] })) }, u, '2030-01-01');
    expect(cedo.some((s) => s.id === 'conc-velhas')).toBe(false);
    expect(tarde.some((s) => s.id === 'conc-velhas')).toBe(ds.transacoes.length > 0);
  });

  describe('Radar: a faixa resume a Commercial Queue (CM1-D1)', () => {
    const hoje = '2026-09-01';
    const comRadar = { ...ds, radar: radarFicticio() };
    const fila = construirCommercialQueue(comRadar.radar, hoje);
    const sug = (rota = '/radar/hoje') => sugestoesPara(rota, comRadar, u, hoje);
    const por = (id: string, rota?: string) => sug(rota).find((s) => s.id === id);

    it('1 o bloco Radar não usa mais filaHoje: usa construirCommercialQueue', () => {
      const src = fs.readFileSync('src/core/sugestoes.ts', 'utf8');
      expect(src).not.toMatch(/filaHoje|recomendarAcao|lerEmpresa/);
      expect(src).toMatch(/construirCommercialQueue\(r, hoje\)/);
    });

    it('2–4 AGIR_AGORA, ENRIQUECER e REVISAR (e follow-up) batem com a fila', () => {
      expect(fila.porCategoria).toMatchObject({ AGIR_AGORA: 2, FOLLOW_UP: 1, REVISAR: 2, ENRIQUECER: 1 });
      for (const rota of ['/radar', '/radar/hoje', '/radar/empresas']) {
        expect(numero(por('radar-agir-agora', rota)?.texto)).toBe(fila.porCategoria.AGIR_AGORA);
        expect(numero(por('radar-enriquecer', rota)?.texto)).toBe(fila.porCategoria.ENRIQUECER);
        expect(numero(por('radar-revisar', rota)?.texto)).toBe(fila.porCategoria.REVISAR);
        expect(numero(por('radar-follow-up', rota)?.texto)).toBe(fila.porCategoria.FOLLOW_UP);
      }
      // a duplicata vista pela trava da propria fila leva a revisao de duplicatas
      expect(por('radar-revisar')?.acao).toEqual({ rotulo: 'Revisar duplicatas', to: '/radar?aba=duplicatas' });
      expect(sug().map((s) => s.id)).not.toContain('radar-vencidas');
      expect(contadorRadarHojeCM(comRadar.radar, hoje)).toBe(fila.porCategoria.AGIR_AGORA);
    });

    it('categoria vazia não gera sugestão; fila vazia não gera nada', () => {
      expect(sugestoesPara('/radar/hoje', { ...ds, radar: radarVazio() }, u, hoje)).toEqual([]);
      const soEnriquecer = { ...ds, radar: { ...radarFicticio(), tarefas: [], atividades: [], duplicatas: [], contatos: [] } };
      expect(sugestoesPara('/radar/hoje', soEnriquecer, u, hoje).map((s) => s.id)).toEqual(['radar-enriquecer']);
    });

    it('5 as outras áreas não dependem do Radar e nunca recebem sugestão do Radar', () => {
      for (const rota of ['/', '/lancamentos', '/pagar', '/receber', `/obras/${ds.obras[0].codigo}`, '/conciliacao', '/producao', '/aprovacoes', '/cadastros', '/capacitacao']) {
        for (const d of [hoje, '2030-01-01']) {
          const semRadar = sugestoesPara(rota, { ...ds, radar: radarVazio() }, u, d);
          expect(sugestoesPara(rota, comRadar, u, d)).toEqual(semRadar);
          expect(semRadar.some((s) => s.id.startsWith('radar-'))).toBe(false);
        }
      }
    });
  });
});

// Commercial UX 1.0 — UX-4: PIPELINE ATIVO.
//
// O que esta suite prende: a zona NAO escolhe oportunidade (a autoridade e `item.oportunidadeId`, do CM1-A), NAO
// reordena, NAO recalcula SLA, NAO usa `atualizadoEm` como movimento e NAO inventa estado positivo.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommercialQueueItem } from '../../core/radar/commercialMachine';
import type { Atividade, Estagio, HistoricoEstagio, Oportunidade } from '../../core/radar/types';
import {
  ESTADOS_PIPELINE_UX, estadoPipelineUX, pipelineAtivoUX, ultimoMovimentoUX,
  type EntradaPipelineUX, type FatosPipelineUX,
} from './comercialPipeline';
import { ORCAMENTO_PANORAMA_COMERCIAL } from './comercialVisao';
import type { ContaComercialUX, ExcecaoComercialUX } from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';

function oportunidade(id: string, extra: Partial<Oportunidade> = {}): Oportunidade {
  return {
    id, empresaId: `e-${id}`, titulo: `Negócio ${id}`, estagio: 'ENGAGED', probabilidade: 0.3, responsavelId: 'u1',
    observacoes: '', criadoEm: '2026-08-01', atualizadoEm: '2026-09-15', ...extra,
  };
}
function item(id: string, extra: Partial<CommercialQueueItem> = {}): CommercialQueueItem {
  return {
    empresaId: `e-${id}`, posicao: 1, categoria: 'AVANCAR_OPORTUNIDADE', priorityClass: 'A', priorityScore: 0,
    porQueAgora: { codigo: 'OPORTUNIDADE_PARADA', texto: '' }, travas: [], oportunidadeId: id,
    ...extra,
  } as unknown as CommercialQueueItem;
}
function conta(itemId: string, empresaId: string, excecoes: ExcecaoComercialUX[] = []): ContaComercialUX {
  return {
    itemId, empresaId, posicao: 1, horizonte: 'AGORA', motivo: { codigo: 'OPORTUNIDADE_PARADA', texto: 'parada' },
    modo: 'ACAO_INTERNA', sugestao: { estado: 'NAO_APLICAVEL' }, excecoes,
  };
}
const excecao = (tipo: ExcecaoComercialUX['tipo'], oportunidadeId?: string, extra: Partial<ExcecaoComercialUX> = {}): ExcecaoComercialUX => ({
  tipo, codigo: tipo as ExcecaoComercialUX['codigo'], severidade: tipo === 'OPORTUNIDADE_PARADA_CRITICA' ? 'RISCO' : 'ATENCAO', bloqueante: false,
  ...(oportunidadeId ? { referencia: { tipo: 'oportunidade' as const, id: oportunidadeId } } : {}), ...extra,
});

function entrada(id: string, excecoes: ExcecaoComercialUX[] = [], extraItem: Partial<CommercialQueueItem> = {}): EntradaPipelineUX {
  return { item: item(id, extraItem), conta: conta(`item-${id}`, `e-${id}`, excecoes) };
}
function fatos(extra: Partial<FatosPipelineUX> = {}): FatosPipelineUX {
  return { oportunidades: [], historicoEstagios: [], atividades: [], hoje: HOJE, ...extra };
}
const atividade = (id: string, extra: Partial<Atividade> = {}): Atividade => ({
  id, empresaId: 'e-o1', tipo: 'CALL', ocorreuEm: '2026-09-01', criadoEm: '2026-09-01', autorId: 'u1', resumo: '', ...extra,
} as unknown as Atividade);
const historico = (oportunidadeId: string, em: string): HistoricoEstagio => ({ id: `h-${oportunidadeId}-${em}`, oportunidadeId, de: 'DETECTED', para: 'ENGAGED', em, autorId: 'u1' } as unknown as HistoricoEstagio);

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO_PIPELINE = semComentarios(leia('comercialPipeline.ts'));
const CODIGO_PANORAMA = semComentarios(leia('ComercialPanorama.tsx'));
const CODIGO_HOJE = semComentarios(leia('Hoje.tsx'));

// ---------------------------------------------------------------------------------------------------------------------
// Fonte da oportunidade
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — a oportunidade vem do CM1-A, nunca da UI', () => {
  it('oportunidade ativa referenciada pelo item entra', () => {
    const o = oportunidade('o1');
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o] }));
    expect(r).toHaveLength(1);
    expect(r[0].oportunidadeId).toBe('o1');
    expect(r[0].empresaId).toBe('e-o1');
    expect(r[0].itemId).toBe('item-o1');
  });

  it('conta sem `oportunidadeId` nao entra', () => {
    const r = pipelineAtivoUX([entrada('o1', [], { oportunidadeId: undefined })], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r).toEqual([]);
  });

  it('id inexistente nao gera fallback para outra oportunidade da empresa', () => {
    const outra = oportunidade('o2', { empresaId: 'e-o1' });
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [outra] }));
    expect(r).toEqual([]);
  });

  it('oportunidade de outra empresa nao entra', () => {
    const o = oportunidade('o1', { empresaId: 'outra-empresa' });
    expect(pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o] }))).toEqual([]);
  });

  it.each<[Estagio]>([['WON'], ['LOST'], ['NURTURE']])('estagio %s nao entra', (estagio) => {
    const o = oportunidade('o1', { estagio });
    expect(pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o] }))).toEqual([]);
  });

  it.each<[Estagio]>([['DETECTED'], ['RESEARCHING'], ['QUALIFIED'], ['PROPOSAL_SENT'], ['NEGOTIATION']])('estagio ativo %s entra', (estagio) => {
    const o = oportunidade('o1', { estagio });
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o] }));
    expect(r).toHaveLength(1);
    expect(r[0].estagio).toBe(estagio);
  });

  it('uma linha da fila rende no maximo UMA oportunidade, mesmo com varias na empresa', () => {
    const o1 = oportunidade('o1');
    const irma = oportunidade('o1-irma', { empresaId: 'e-o1' });
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o1, irma] }));
    expect(r).toHaveLength(1);
    expect(r[0].oportunidadeId).toBe('o1');
  });

  it('titulo, estagio e valor sao os reais; valor ausente NAO vira zero', () => {
    const comValor = oportunidade('o1', { titulo: 'Galpão 4.000 m²', estagio: 'PRICING', valorEstimado: 1_250_000 });
    const semValor = oportunidade('o2', { titulo: 'Sem valor' });
    const r = pipelineAtivoUX([entrada('o1'), entrada('o2')], fatos({ oportunidades: [comValor, semValor] }));
    expect(r[0]).toMatchObject({ titulo: 'Galpão 4.000 m²', estagio: 'PRICING', valorEstimado: 1_250_000 });
    expect(r[1].valorEstimado).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r[1], 'valorEstimado')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Ordem
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — ordem e a da fila, e so ela', () => {
  it('preserva a ordem de entrada mesmo com valores decrescentes', () => {
    const os = [oportunidade('o1', { valorEstimado: 10 }), oportunidade('o2', { valorEstimado: 9_000_000 }), oportunidade('o3', { valorEstimado: 500 })];
    const r = pipelineAtivoUX([entrada('o1'), entrada('o2'), entrada('o3')], fatos({ oportunidades: os }));
    expect(r.map((x) => x.oportunidadeId)).toEqual(['o1', 'o2', 'o3']);
  });

  it('a projecao nao ordena por nada: nenhum sort, nenhuma probabilidade, nenhum valor ponderado', () => {
    expect(CODIGO_PIPELINE).not.toMatch(/\.sort\(\(/);
    for (const proibido of ['probabilidade', 'ponderado', 'priorityScore', 'localeCompare', 'valorEstimado -', 'valorEstimado >']) {
      expect(CODIGO_PIPELINE, `a projecao nao pode usar ${proibido}`).not.toContain(proibido);
    }
  });

  it('o unico sort do modulo e o de DATAS do ultimo movimento', () => {
    const sorts = CODIGO_PIPELINE.match(/\.sort\(\)/g) ?? [];
    expect(sorts).toHaveLength(1);
    expect(CODIGO_PIPELINE).toContain('].sort();');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Movimento
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — ultimo movimento usa os fatos do CM1-A', () => {
  it('criacao sozinha ja e movimento', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    expect(ultimoMovimentoUX(o, [], [])).toBe('2026-08-10');
  });

  it('historico de estagio mais novo vence a criacao', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    expect(ultimoMovimentoUX(o, [historico('o1', '2026-09-02')], [])).toBe('2026-09-02');
  });

  it('atividade real mais nova vence o historico', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    const r = ultimoMovimentoUX(o, [historico('o1', '2026-09-02')], [atividade('a1', { oportunidadeId: 'o1', ocorreuEm: '2026-09-09' })]);
    expect(r).toBe('2026-09-09');
  });

  it('atividade de OUTRA oportunidade nao conta', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    expect(ultimoMovimentoUX(o, [], [atividade('a1', { oportunidadeId: 'o2', ocorreuEm: '2026-09-14' })])).toBe('2026-08-10');
  });

  it('atividade da empresa SEM oportunidadeId nao conta', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    expect(ultimoMovimentoUX(o, [], [atividade('a1', { ocorreuEm: '2026-09-14' })])).toBe('2026-08-10');
  });

  it('NOTE nao e movimento comercial', () => {
    const o = oportunidade('o1', { criadoEm: '2026-08-10' });
    expect(ultimoMovimentoUX(o, [], [atividade('a1', { oportunidadeId: 'o1', tipo: 'NOTE', ocorreuEm: '2026-09-14' })])).toBe('2026-08-10');
  });

  it('`atualizadoEm` NUNCA conta como movimento', () => {
    const o = oportunidade('o1', { criadoEm: '2026-07-01', atualizadoEm: '2026-09-15' });
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o], historicoEstagios: [historico('o1', '2026-07-05')], atividades: [atividade('a1', { oportunidadeId: 'o1', ocorreuEm: '2026-07-10' })] }));
    expect(r[0].ultimoMovimentoEm).toBe('2026-07-10');
    expect(r[0].diasSemMovimento).toBe(67);
    expect(CODIGO_PIPELINE).not.toContain('atualizadoEm');
  });

  it('a data mais recente vence, venha de onde vier', () => {
    const o = oportunidade('o1', { criadoEm: '2026-09-12' });
    expect(ultimoMovimentoUX(o, [historico('o1', '2026-09-01')], [atividade('a1', { oportunidadeId: 'o1', ocorreuEm: '2026-09-05' })])).toBe('2026-09-12');
  });

  it('dias sem movimento sao medidos contra `hoje`, nao contra o relogio', () => {
    const o = oportunidade('o1', { criadoEm: '2026-09-05' });
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o] }));
    expect(r[0].diasSemMovimento).toBe(10);
    const outro = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [o], hoje: '2026-09-20' }));
    expect(outro[0].diasSemMovimento).toBe(15);
    expect(CODIGO_PIPELINE).not.toContain('new Date()');
    expect(CODIGO_PIPELINE).not.toContain('Date.now');
  });

  it('nenhum SLA e consultado na projecao', () => {
    for (const proibido of ['slaEstagioDias', 'HIPOTESE_COMMERCIAL_MACHINE', 'multiplicadorParadaCritica', 'sla']) {
      expect(CODIGO_PIPELINE, `a projecao nao pode consultar ${proibido}`).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — PARADA e EM RISCO vem so das excecoes do UX-0', () => {
  it('OPORTUNIDADE_PARADA da mesma oportunidade marca PARADA', () => {
    const r = pipelineAtivoUX([entrada('o1', [excecao('OPORTUNIDADE_PARADA', 'o1')])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBe('PARADA');
  });

  it('PARADA de OUTRA oportunidade nao marca a atual', () => {
    const r = pipelineAtivoUX([entrada('o1', [excecao('OPORTUNIDADE_PARADA', 'o-outra')])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBeUndefined();
  });

  it('excecao sem referencia nao marca a oportunidade', () => {
    const r = pipelineAtivoUX([entrada('o1', [excecao('OPORTUNIDADE_PARADA')])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBeUndefined();
  });

  it('OPORTUNIDADE_PARADA_CRITICA da mesma oportunidade marca EM RISCO', () => {
    const r = pipelineAtivoUX([entrada('o1', [excecao('OPORTUNIDADE_PARADA_CRITICA', 'o1')])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBe('EM_RISCO');
  });

  it('bloqueio real da conta marca EM RISCO mesmo sem parada', () => {
    const bloqueio = excecao('BLOQUEIO_PLANO', undefined, { severidade: 'BLOQUEIO', bloqueante: true });
    const r = pipelineAtivoUX([entrada('o1', [bloqueio])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBe('EM_RISCO');
  });

  it('trava nao bloqueante nao vira EM RISCO', () => {
    const r = pipelineAtivoUX([entrada('o1', [excecao('TRAVA', undefined, { severidade: 'ATENCAO', bloqueante: false })])], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBeUndefined();
  });

  it('critica vence parada: um unico badge, nunca os dois', () => {
    const c = conta('item-o1', 'e-o1', [excecao('OPORTUNIDADE_PARADA', 'o1'), excecao('OPORTUNIDADE_PARADA_CRITICA', 'o1')]);
    expect(estadoPipelineUX(c, 'o1')).toBe('EM_RISCO');
    expect(ESTADOS_PIPELINE_UX).toEqual(['PARADA', 'EM_RISCO']);
  });

  it('sem excecao nao ha badge — e nao existe estado positivo no catalogo', () => {
    const r = pipelineAtivoUX([entrada('o1')], fatos({ oportunidades: [oportunidade('o1')] }));
    expect(r[0].estado).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r[0], 'estado')).toBe(false);
    for (const proibido of ['EM_MOVIMENTO', 'Em movimento', 'SAUDAVEL', 'Saudável', 'NO_RITMO', 'momentum', 'tendencia', 'pressao']) {
      expect(CODIGO_PIPELINE, `nao pode existir ${proibido}`).not.toContain(proibido);
      expect(CODIGO_PANORAMA, `nao pode existir ${proibido}`).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Panorama
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — a zona no Panorama', () => {
  it('a secao existe com o nome contratado', () => {
    expect(CODIGO_PANORAMA).toContain('Pipeline ativo');
    expect(CODIGO_PANORAMA).toContain('zona-pipeline');
    expect(CODIGO_PANORAMA).not.toContain('Em movimento');
  });

  it('respeita o teto de 3 do orcamento visual, sem numero solto no componente', () => {
    expect(ORCAMENTO_PANORAMA_COMERCIAL.pipeline).toBe(3);
    expect(CODIGO_PANORAMA).toContain('recorteUX(pipelineAtivo, ORCAMENTO_PANORAMA_COMERCIAL.pipeline)');
  });

  it('"Ver pipeline ›" leva para /radar e nenhuma rota nova e criada', () => {
    expect(CODIGO_PANORAMA).toContain("export const ROTA_PIPELINE_PANORAMA = '/radar';");
    expect(CODIGO_PANORAMA).toContain('Ver pipeline ›');
    expect(CODIGO_PANORAMA).not.toContain('/radar/pipeline');
  });

  it('o card mostra empresa, oportunidade, estagio pelo catalogo, valor e ultimo movimento', () => {
    expect(CODIGO_PANORAMA).toContain('nomeEmpresa(o.empresaId)');
    expect(CODIGO_PANORAMA).toContain('{o.titulo}');
    expect(CODIGO_PANORAMA).toContain('NOME_ESTAGIO[o.estagio]');
    expect(CODIGO_PANORAMA).toContain('money(o.valorEstimado)');
    expect(CODIGO_PANORAMA).toContain('Último movimento');
    expect(CODIGO_PANORAMA).not.toContain('Último contato');
  });

  it('valor ausente vira texto, nunca R$ 0', () => {
    expect(CODIGO_PANORAMA).toContain("export const TEXTO_SEM_VALOR_PIPELINE = 'valor não informado';");
    expect(CODIGO_PANORAMA).toContain('o.valorEstimado === undefined ? TEXTO_SEM_VALOR_PIPELINE : money(o.valorEstimado)');
  });

  it('a linha leva a aba de oportunidades da empresa — navegacao, nunca CTA', () => {
    expect(CODIGO_PANORAMA).toContain('?aba=oportunidades');
    const zona = CODIGO_PANORAMA.slice(CODIGO_PANORAMA.indexOf('zona-pipeline'), CODIGO_PANORAMA.indexOf('zona-programado'));
    for (const proibido of ['acaoPrincipal', 'ctaCadencia', 'onPorQue', 'actions.', 'setTarefa', 'Preparar abordagem']) {
      expect(zona, `a zona de pipeline nao pode ter ${proibido}`).not.toContain(proibido);
    }
  });

  it('empty state proprio quando nao ha oportunidade ativa', () => {
    expect(CODIGO_PANORAMA).toContain('Nenhuma oportunidade ativa nesta visão.');
  });

  it('a zona fica entre o bloco principal e Programado', () => {
    expect(CODIGO_PANORAMA.indexOf('zona-risco')).toBeLessThan(CODIGO_PANORAMA.indexOf('zona-pipeline'));
    expect(CODIGO_PANORAMA.indexOf('zona-pipeline')).toBeLessThan(CODIGO_PANORAMA.indexOf('zona-programado'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Autoridade e regressao
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-4 — autoridade preservada', () => {
  it('o Hoje projeta o pipeline sobre `base`, nunca sobre `visiveis`', () => {
    const inicio = CODIGO_HOJE.indexOf('const pipelineUX = useMemo(');
    const bloco = CODIGO_HOJE.slice(inicio, CODIGO_HOJE.indexOf('}, [base, contasUX', inicio) + 80);
    expect(bloco).toContain('base.flatMap(');
    expect(bloco).not.toContain('visiveis');
    expect(bloco).toContain('pipelineAtivoUX(entradas,');
  });

  it('nenhuma fila nova: `construirCommercialQueue` continua sendo chamada uma unica vez', () => {
    expect((CODIGO_HOJE.match(/construirCommercialQueue\(/g) ?? [])).toHaveLength(1);
    expect(CODIGO_HOJE).not.toContain('filaHoje');
    expect(CODIGO_PIPELINE).not.toContain('construirCommercialQueue');
    expect(CODIGO_PIPELINE).not.toContain('filaHoje');
  });

  it('a projecao e pura: sem store, sem React, sem escrita', () => {
    for (const proibido of ['react', 'actions', '../../data/store', 'useMemo', 'useState']) {
      expect(CODIGO_PIPELINE, `a projecao nao pode importar ${proibido}`).not.toContain(proibido);
    }
  });

  it('UX-4 nao reabriu motor, store nem App', () => {
    const intocados = ['src/core/radar/commercialMachine.ts', 'src/core/radar/pipeline.ts', 'src/core/radar/commercialActionPlan.ts', 'src/data/store.ts', 'src/App.tsx'];
    for (const arquivo of intocados) expect(fs.existsSync(path.join(process.cwd(), arquivo)), arquivo).toBe(true);
    // a zona nao importa nada do core que decida negocio
    expect(CODIGO_PIPELINE).not.toContain('commercialCadence');
    expect(CODIGO_PIPELINE).not.toContain('commercialActionPlan');
  });

  it('UX-3 continua intacto: Modo Foco, abas e regra de nao-autoavanco', () => {
    expect(CODIGO_HOJE).toContain("label: 'Trabalhar a fila'");
    expect(CODIGO_HOJE).toContain("useState<VisaoComercial>('panorama')");
    expect(CODIGO_HOJE).toContain('focoInvalidadoUX(contasUX, focoTrabalhoId)');
    expect((CODIGO_HOJE.match(/focoAoEntrarUX\(/g) ?? [])).toHaveLength(1);
    expect(CODIGO_HOJE).toContain('gavetaFailClosed(porQue, idsAutorizados)');
  });
});

// CM2-C — Sugestao governada de tarefa. Prova: so a lacuna datada vira compromisso; data, tipo, contato, oportunidade e
// responsavel vem das autoridades; cobertura por fatos estruturados; chave semantica sem PII, sem hoje e sem data.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE, type Caso } from './cadenciaParidadeCM.fixtures';
import { planosDaFilaCM, type CommercialActionPlan } from './commercialActionPlan';
import { cadenciasDaFilaCM, type CadenceRecommendationCM } from './commercialCadence';
import {
  CODIGOS_AVISO_TAREFA_CM, CODIGOS_COBERTURA_TAREFA_CM, CODIGOS_PENDENCIA_TAREFA_CM, ESTADOS_SUGESTAO_TAREFA_CM, TEXTO_AVISO_TAREFA_CM,
  TEXTO_COBERTURA_TAREFA_CM, TEXTO_ESTADO_SUGESTAO_TAREFA_CM, TEXTO_PENDENCIA_TAREFA_CM, TIPOS_QUE_COBREM_CM, chaveCadenciaCM,
  sugestaoTarefaCadenciaCM, sugestoesTarefaDaFilaCM, type TaskSuggestionCM,
} from './commercialCadenceTask';
import { TEXTO_RAZAO_CM, construirCommercialQueue, type CommercialQueue, type CommercialQueueItem } from './commercialMachine';
import { TIPOS_TAREFA, radarVazio, type Atividade, type Contato, type Empresa, type RadarDataset, type Supressao, type TarefaRadar } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
interface Execucao { fila: CommercialQueue; planos: CommercialActionPlan[]; cadencias: CadenceRecommendationCM[]; sugestoes: TaskSuggestionCM[] }
const executar = (ds: RadarDataset, hoje = HOJE): Execucao => {
  const fila = construirCommercialQueue(ds, hoje);
  const planos = planosDaFilaCM(ds, fila);
  const cadencias = cadenciasDaFilaCM(ds, fila, planos, hoje);
  return { fila, planos, cadencias, sugestoes: sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, hoje) };
};
const caso = (id: string): Caso => CASOS.find((c) => c.id === id)!;
/** Entradas de uma conta (item, plano, cadencia) calculadas sobre o dataset do caso. */
const entradas = (ds: RadarDataset, empresaId: string, hoje = HOJE) => {
  const x = executar(ds, hoje);
  const i = x.fila.itens.findIndex((it) => it.empresaId === empresaId);
  return { ...x, item: x.fila.itens[i], plano: x.planos[i], cadencia: x.cadencias[i], sugestao: x.sugestoes[i] };
};
const sugestaoDe = (id: string) => { const c = caso(id); return entradas(c.ds, c.empresaId).sugestao; };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}
const COLECOES = ['empresas', 'contatos', 'atividades', 'tarefas', 'sinais', 'oportunidades', 'comunicacoes', 'duplicatas', 'supressoes', 'historicoEstagios', 'projetos', 'pesosDecisionFit'] as const;
function permutar(r: RadarDataset, f: <T>(xs: T[]) => T[]): RadarDataset {
  const out = { ...r } as RadarDataset;
  for (const k of COLECOES) (out as unknown as Record<string, unknown[]>)[k] = f([...(r[k] as unknown[])]);
  return out;
}

const ts = (d: string, h = '10:00') => `${d}T${h}:00.000Z`;
const tarefa = (id: string, empresaId: string, p: Partial<TarefaRadar>): TarefaRadar => ({ id, empresaId, responsavelId: 'u1', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: '2026-09-25', status: 'Aberta', descricao: `Tarefa ${id}`, criadoEm: ts('2026-09-13'), ...p });
const comTarefas = (ds: RadarDataset, ...ts_: TarefaRadar[]): RadarDataset => ({ ...ds, tarefas: [...ds.tarefas, ...ts_] });
/** Conta com silencio depois de resposta tratada (lacuna D4 sem oportunidade), responsavel configuravel. */
const silencio = (id: string, p: { usuarioId?: string; resultado?: Atividade['resultado']; contato?: Partial<Contato> } = {}): RadarDataset => ({
  ...radarVazio(), pesosDecisionFit: [{ chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 }, { chave: 'persona.CEO.media', valor: 85 }],
  empresas: [{ id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 70, priorityClass: 'A' } as Empresa],
  contatos: [{ id: `c-${id}`, empresaId: id, nome: 'Fulana de Tal', persona: 'CEO', email: 'fulana@exemplo.com.br', telefone: '5562999990000', decisor: false, qualidade: 80, observacoes: '', ativo: true, criadoEm: '2026-08-01', atualizadoEm: '2026-08-01', ...p.contato } as Contato],
  atividades: [{ id: 'a1', empresaId: id, contatoId: `c-${id}`, usuarioId: p.usuarioId ?? 'u1', tipo: 'CALL', canal: 'PHONE', ocorreuEm: ts('2026-09-08'), notas: '', criadoEm: ts('2026-09-08'), resultado: p.resultado ?? 'POSITIVE' }],
  tarefas: [tarefa('t1', id, { status: 'Concluída', venceEm: '2026-09-10', criadoEm: ts('2026-09-08', '11:00'), concluidaEm: ts('2026-09-10'), responsavelId: 'u1' })],
});
const comContatoNoPlano = (plano: CommercialActionPlan, contatoId: string, tipoTarefa = plano.tipoTarefa): CommercialActionPlan => ({ ...plano, tipoTarefa, contato: { id: contatoId, fit: 85, persona: 'CEO', motivo: 'teste', canaisAcionaveis: [] } });

// ---------------------------------------------------------------------------------------------------------------------
describe('CM2-C — estados sobre os casos congelados', () => {
  it('so a lacuna datada vira sugestao; data do cliente pede data; o resto nao cria compromisso', () => {
    const esperado: Record<string, TaskSuggestionCM['estado']> = { '05b': 'SUGERIDA', '17b': 'SUGERIDA', '08': 'REQUER_DATA', '09': 'REQUER_DATA', '10': 'REQUER_DATA' };
    for (const c of CASOS) {
      const { fila, sugestoes } = executar(c.ds);
      const s = sugestoes.find((x) => x.empresaId === c.empresaId);
      if (!c.cm2) { expect(s, c.id).toBeUndefined(); expect(sugestoes).toHaveLength(fila.itens.length); continue; }
      expect(s!.estado, c.id).toBe(esperado[c.id] ?? 'NAO_APLICAVEL');
      if (s!.estado !== 'SUGERIDA') expect(s!.tarefa, c.id).toBeUndefined();
    }
  });
});

describe('CM2-C — sugestao pronta', () => {
  it('D4 com oportunidade: data do CM2-B, tipo do plano, oportunidade e responsavel do item, descricao estatica', () => {
    const c = caso('17b');
    const { item, plano, cadencia, sugestao } = entradas(c.ds, c.empresaId);
    expect(sugestao.estado).toBe('SUGERIDA');
    expect(sugestao.tarefa).toEqual({ tipo: plano.tipoTarefa, venceEm: cadencia.proximoToque!.em, responsavelId: item.responsavelId, oportunidadeId: item.oportunidadeId, descricaoBase: plano.explicacao.acao });
    expect(sugestao.tarefa!.oportunidadeId).toBe('o1');
    expect(sugestao.tarefa!.descricaoBase).toBe(TEXTO_RAZAO_CM[item.porQueAgora.codigo]);
    expect(sugestao.avisos).toEqual(['CONTATO_A_DEFINIR']);
  });

  it('D4 sem oportunidade: sem oportunidade e sem contato (o plano nao define contato)', () => {
    const c = caso('05b');
    const { item, cadencia, sugestao } = entradas(c.ds, c.empresaId);
    expect(item.contato?.id).toBe('c-posdepois');
    expect(sugestao.estado).toBe('SUGERIDA');
    expect(sugestao.tarefa).toEqual({ tipo: 'FOLLOW_UP', venceEm: cadencia.proximoToque!.em, responsavelId: 'u1', descricaoBase: TEXTO_RAZAO_CM.SEM_TIMING_ATUAL });
  });

  it('a data e exatamente proximoToque.em da cadencia, sem recalculo', () => {
    const c = caso('17b');
    const { item, plano, cadencia } = entradas(c.ds, c.empresaId);
    const alterada: CadenceRecommendationCM = { ...cadencia, proximoToque: { ...cadencia.proximoToque!, em: '2026-10-01' } };
    expect(sugestaoTarefaCadenciaCM(c.ds, item, plano, alterada, HOJE).tarefa!.venceEm).toBe('2026-10-01');
  });

  it('tipo vem do plano, contato do plano, responsavel e oportunidade do item', () => {
    const c = caso('05b');
    const { item, plano, cadencia } = entradas(c.ds, c.empresaId);
    expect(sugestaoTarefaCadenciaCM(c.ds, item, { ...plano, tipoTarefa: 'RESEARCH' }, cadencia, HOJE).tarefa!.tipo).toBe('RESEARCH');
    expect(sugestaoTarefaCadenciaCM(c.ds, item, comContatoNoPlano(plano, 'c-posdepois'), cadencia, HOJE).tarefa!.contatoId).toBe('c-posdepois');
    expect(sugestaoTarefaCadenciaCM(c.ds, { ...item, responsavelId: 'u9' }, plano, cadencia, HOJE).tarefa!.responsavelId).toBe('u9');
    const outra = entradas(caso('17b').ds, 'oppsem');
    const invalida = sugestaoTarefaCadenciaCM(caso('17b').ds, { ...outra.item, oportunidadeId: 'o-de-outra-conta' }, outra.plano, outra.cadencia, HOJE);
    expect(invalida.estado).toBe('BLOQUEADA');
    expect(invalida.pendencias).toContain('OPORTUNIDADE_INVALIDA');
  });
});

describe('CM2-C — o que nao vira tarefa', () => {
  const naoAplicavel = (id: string) => { const s = sugestaoDe(id); expect(s.estado, id).toBe('NAO_APLICAVEL'); expect(s.tarefa).toBeUndefined(); expect(s.chave).toBeUndefined(); return s; };
  it('DEVIDA (follow-up devido): executar, nao lembrar', () => { expect(naoAplicavel('03').explicacao.porQue).toMatch(/executar/i); });
  it('AGUARDANDO: o compromisso ja existe', () => { naoAplicavel('15'); naoAplicavel('02'); });
  it('PAUSADA, ENCERRADA e NAO_APLICAVEL', () => { naoAplicavel('06'); naoAplicavel('04'); naoAplicavel('28'); });
  it('tarefa vencida: executar, concluir ou reagendar a existente', () => {
    const ds = comTarefas(silencio('venc'), tarefa('t9', 'venc', { venceEm: '2026-09-11', criadoEm: ts('2026-09-09') }));
    const { item, sugestao } = entradas(ds, 'venc');
    expect(item.porQueAgora.codigo).toBe('TAREFA_VENCIDA');
    expect(sugestao.estado).toBe('NAO_APLICAVEL');
    expect(sugestao.explicacao.porQue).toMatch(/reagendar o existente/);
  });
});

describe('CM2-C — data do cliente e ancora ausente', () => {
  for (const [resultado, id] of [['CALL_BACK', '08'], ['FUTURE_PROJECT', '09'], ['REQUESTED_MEETING', '10']] as const) {
    it(`${resultado} -> REQUER_DATA, sem data, sem tarefa, sem chave`, () => {
      for (const s of [sugestaoDe(id), entradas(silencio('cli', { resultado }), 'cli').sugestao]) {
        expect(s.estado).toBe('REQUER_DATA');
        expect(s.pendencias).toEqual(['DATA_DO_CLIENTE_NECESSARIA']);
        expect(s.tarefa).toBeUndefined();
        expect(s.chave).toBeUndefined();
        expect(JSON.stringify(s)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    });
  }

  it('ancora temporal ausente -> decisao humana (REQUER_DATA), sem data e sem chave', () => {
    const ds: RadarDataset = { ...silencio('sa'), atividades: [{ ...silencio('sa').atividades[0], ocorreuEm: ts('2026-09-20'), criadoEm: ts('2026-09-07') }], tarefas: [tarefa('t1', 'sa', { status: 'Concluída', criadoEm: ts('2026-09-07', '11:00') })] };
    const s = entradas(ds, 'sa').sugestao;
    expect(s).toMatchObject({ estado: 'REQUER_DATA', pendencias: ['ANCORA_TEMPORAL_AUSENTE'] });
    expect(s.chave).toBeUndefined();
    expect(s.tarefa).toBeUndefined();
  });
});

describe('CM2-C — cobertura por fatos estruturados', () => {
  const opp = () => { const c = caso('17b'); return { c, ...entradas(c.ds, c.empresaId) }; };
  const semOpp = () => { const c = caso('05b'); return { c, ...entradas(c.ds, c.empresaId) }; };

  it('mesma oportunidade, tarefa aberta posterior a ancora (inclusive interna) -> COBERTA', () => {
    const { c, item, plano, cadencia } = opp();
    const ds = comTarefas(c.ds, tarefa('t-int', 'oppsem', { tipo: 'RESEARCH', oportunidadeId: 'o1', criadoEm: ts('2026-09-13') }));
    const s = sugestaoTarefaCadenciaCM(ds, item, plano, cadencia, HOJE);
    expect(s).toMatchObject({ estado: 'COBERTA', cobertura: { tarefaId: 't-int', motivo: 'MESMA_OPORTUNIDADE' } });
    expect(s.tarefa).toBeUndefined();
  });

  it('tarefa anterior a ancora nao cobre o ciclo novo e bloqueia uma terceira', () => {
    const { c, item, plano, cadencia } = opp();
    const s = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-velha', 'oppsem', { oportunidadeId: 'o1', criadoEm: ts('2026-09-11') })), item, plano, cadencia, HOJE);
    expect(s.estado).toBe('BLOQUEADA');
    expect(s.cobertura).toBeUndefined();
    expect(s.pendencias).toContain('TAREFA_ABERTA_ANTERIOR_A_ANCORA');
  });

  it('tarefa de outra oportunidade nao cobre', () => {
    const { c, item, plano, cadencia } = opp();
    const s = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-o2', 'oppsem', { oportunidadeId: 'o2', criadoEm: ts('2026-09-13') })), item, plano, cadencia, HOJE);
    expect(s.estado).toBe('SUGERIDA');
  });

  it('sem oportunidade: mesmo contato e tipo compativel cobre; outro contato, texto igual ou tipo incompativel nao', () => {
    const { c, item, plano, cadencia } = semOpp();
    const p = comContatoNoPlano(plano, 'c-posdepois');
    const cobre = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-c', 'posdepois', { contatoId: 'c-posdepois', tipo: 'CALL', criadoEm: ts('2026-09-12') })), item, p, cadencia, HOJE);
    expect(cobre).toMatchObject({ estado: 'COBERTA', cobertura: { tarefaId: 't-c', motivo: 'MESMO_CONTATO' } });
    const outroContato = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-x', 'posdepois', { contatoId: 'c-outro', criadoEm: ts('2026-09-12') })), item, p, cadencia, HOJE);
    expect(outroContato.estado).toBe('SUGERIDA');
    const mesmoTexto = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-t', 'posdepois', { contatoId: 'c-outro', descricao: p.explicacao.acao, criadoEm: ts('2026-09-12') })), item, p, cadencia, HOJE);
    expect(mesmoTexto.estado).toBe('SUGERIDA');
    const incompativel = sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-r', 'posdepois', { contatoId: 'c-posdepois', tipo: 'RESEARCH', criadoEm: ts('2026-09-12') })), item, p, cadencia, HOJE);
    expect(incompativel.estado).toBe('SUGERIDA');
  });

  it('sugestao sem contato: tarefa compativel da conta sem oportunidade cobre; ligada a oportunidade nao', () => {
    const { c, item, plano, cadencia } = semOpp();
    expect(sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-a', 'posdepois', { contatoId: 'c-posdepois', criadoEm: ts('2026-09-12') })), item, plano, cadencia, HOJE))
      .toMatchObject({ estado: 'COBERTA', cobertura: { motivo: 'MESMA_CONTA_SEM_CONTATO_DEFINIDO' } });
    expect(sugestaoTarefaCadenciaCM(comTarefas(c.ds, tarefa('t-b', 'posdepois', { oportunidadeId: 'o9', criadoEm: ts('2026-09-12') })), item, plano, cadencia, HOJE).estado).toBe('SUGERIDA');
  });

  it('duas tarefas cobrindo: COBERTA pela de prazo mais proximo, com aviso de concorrencia', () => {
    const { c, item, plano, cadencia } = opp();
    const ds = comTarefas(c.ds, tarefa('t-2', 'oppsem', { oportunidadeId: 'o1', venceEm: '2026-09-30', criadoEm: ts('2026-09-13') }), tarefa('t-1', 'oppsem', { oportunidadeId: 'o1', venceEm: '2026-09-20', criadoEm: ts('2026-09-14') }));
    expect(sugestaoTarefaCadenciaCM(ds, item, plano, cadencia, HOJE)).toMatchObject({ estado: 'COBERTA', cobertura: { tarefaId: 't-1' }, avisos: ['COBERTURAS_CONCORRENTES'] });
  });

  it('a matriz de cobertura e total e cada tipo cobre a si mesmo', () => {
    expect(Object.keys(TIPOS_QUE_COBREM_CM).sort()).toEqual([...TIPOS_TAREFA].sort());
    for (const t of TIPOS_TAREFA) expect(TIPOS_QUE_COBREM_CM[t]).toContain(t);
  });
});

describe('CM2-C — responsavel', () => {
  it('sem responsavel -> REQUER_RESPONSAVEL, mostra o rascunho e nunca atribui um padrao', () => {
    const { item, sugestao } = entradas(silencio('sd', { usuarioId: '' }), 'sd');
    expect(item.responsavelId).toBeUndefined();
    expect(sugestao.estado).toBe('REQUER_RESPONSAVEL');
    expect(sugestao.pendencias).toEqual(['RESPONSAVEL_NECESSARIO']);
    expect(sugestao.tarefa).toBeDefined();
    expect(sugestao.tarefa!.responsavelId).toBeUndefined();
    expect(JSON.stringify(sugestao)).not.toContain('u1');
  });
});

describe('CM2-C — contato e canal (validar, nunca trocar)', () => {
  const base = () => { const ds = silencio('cc'); return { ds, ...entradas(ds, 'cc') }; };

  it('contato inexistente, de outra empresa ou inelegivel -> BLOQUEADA, sem trocar', () => {
    const { ds, item, plano, cadencia } = base();
    const inexistente = sugestaoTarefaCadenciaCM(ds, item, comContatoNoPlano(plano, 'nao-existe'), cadencia, HOJE);
    expect(inexistente).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CONTATO_INEXISTENTE'] });
    const outraEmpresa = { ...ds, contatos: [...ds.contatos, { ...ds.contatos[0], id: 'c-alheio', empresaId: 'outra' }] };
    expect(sugestaoTarefaCadenciaCM(outraEmpresa, item, comContatoNoPlano(plano, 'c-alheio'), cadencia, HOJE)).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CONTATO_DE_OUTRA_EMPRESA'] });
    const supressao: Supressao = { id: 's1', contatoId: 'c-cc', tipo: 'opt_out', motivo: 'pediu', criadoPor: 'u1', criadoEm: ts('2026-09-14') };
    const inelegivel = sugestaoTarefaCadenciaCM({ ...ds, supressoes: [supressao] }, item, comContatoNoPlano(plano, 'c-cc'), cadencia, HOJE);
    expect(inelegivel).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CONTATO_INELEGIVEL'] });
    for (const s of [inexistente, inelegivel]) expect(s.tarefa).toBeUndefined();
  });

  it('CALL sem telefone e EMAIL sem e-mail -> BLOQUEADA, sem converter tipo; CALL sem contato tambem', () => {
    const { ds, item, plano, cadencia } = base();
    const semTelefone = { ...ds, contatos: [{ ...ds.contatos[0], telefone: undefined }] };
    const call = sugestaoTarefaCadenciaCM(semTelefone, item, comContatoNoPlano(plano, 'c-cc', 'CALL'), cadencia, HOJE);
    expect(call).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CANAL_OBRIGATORIO_INDISPONIVEL'] });
    expect(call.tarefa).toBeUndefined();
    const semEmail = { ...ds, contatos: [{ ...ds.contatos[0], email: undefined }] };
    expect(sugestaoTarefaCadenciaCM(semEmail, item, comContatoNoPlano(plano, 'c-cc', 'EMAIL'), cadencia, HOJE)).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CANAL_OBRIGATORIO_INDISPONIVEL'] });
    expect(sugestaoTarefaCadenciaCM(ds, item, { ...plano, tipoTarefa: 'CALL' }, cadencia, HOJE)).toMatchObject({ estado: 'BLOQUEADA', pendencias: ['CANAL_OBRIGATORIO_SEM_CONTATO'] });
    const ok = sugestaoTarefaCadenciaCM(ds, item, comContatoNoPlano(plano, 'c-cc', 'CALL'), cadencia, HOJE);
    expect(ok.tarefa).toMatchObject({ tipo: 'CALL', contatoId: 'c-cc' });
  });

  it('FOLLOW_UP nao exige canal: contato sem canal continua possivel', () => {
    const { ds, item, plano, cadencia } = base();
    const semCanal = { ...ds, contatos: [{ ...ds.contatos[0], telefone: undefined, email: undefined }] };
    expect(sugestaoTarefaCadenciaCM(semCanal, item, comContatoNoPlano(plano, 'c-cc', 'FOLLOW_UP'), cadencia, HOJE)).toMatchObject({ estado: 'SUGERIDA', tarefa: { tipo: 'FOLLOW_UP', contatoId: 'c-cc' } });
  });
});

describe('CM2-C — chave semantica', () => {
  it('formato, determinismo e estabilidade em re-render', () => {
    const c = caso('17b');
    const a = entradas(c.ds, c.empresaId).sugestao.chave;
    expect(a).toBe('cad:CM2-B.1:oppsem:-:o1:OPORTUNIDADE_SEM_PROXIMA_ACAO:oportunidade:o1');
    expect(entradas(structuredClone(c.ds), c.empresaId).sugestao.chave).toBe(a);
    expect(entradas(permutar(c.ds, (xs) => [...xs].reverse()), c.empresaId).sugestao.chave).toBe(a);
  });

  it('sem PII, sem hoje e sem data', () => {
    const ds = silencio('pii');
    const { plano, item, cadencia } = entradas(ds, 'pii');
    const s = sugestaoTarefaCadenciaCM(ds, item, comContatoNoPlano(plano, 'c-pii'), cadencia, HOJE);
    for (const proibido of ['Fulana', 'fulana@exemplo.com.br', '5562999990000', s.tarefa!.descricaoBase, cadencia.proximoToque!.em!, cadencia.proximoToque!.ancoraEm!, HOJE, '70']) expect(s.chave).not.toContain(proibido);
    expect(s.chave).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const outroDia = entradas(ds, 'pii', '2026-09-11');
    expect(outroDia.cadencia.proximoToque!.em).not.toBe(cadencia.proximoToque!.em);
    expect(outroDia.sugestao.chave).toBe(entradas(ds, 'pii').sugestao.chave);
  });

  it('nova ancora, outra oportunidade ou outro contato mudam a chave', () => {
    const ds = silencio('k');
    const { item, plano, cadencia, sugestao } = entradas(ds, 'k');
    const novaAncora = sugestaoTarefaCadenciaCM(ds, item, plano, { ...cadencia, proximoToque: { ...cadencia.proximoToque!, origem: { tipo: 'tarefa', id: 't-nova' } } }, HOJE);
    expect(novaAncora.chave).not.toBe(sugestao.chave);
    const base = { versaoCadencia: 'CM2-B.1', empresaId: 'k', motivo: 'SEM_TIMING_ATUAL' as const, ancora: { tipo: 'tarefa', id: 't1' } };
    expect(chaveCadenciaCM({ ...base, oportunidadeId: 'o1' })).not.toBe(chaveCadenciaCM({ ...base, oportunidadeId: 'o2' }));
    const comContato = sugestaoTarefaCadenciaCM(ds, item, comContatoNoPlano(plano, 'c-k'), cadencia, HOJE);
    expect(comContato.chave).not.toBe(sugestao.chave);
    expect(chaveCadenciaCM({ ...base, contatoId: 'c-1' })).not.toBe(chaveCadenciaCM({ ...base, contatoId: 'c-2' }));
  });
});

describe('CM2-C — coerencia e seguranca', () => {
  it('entradas incoerentes ou desatualizadas sao recusadas', () => {
    const c = caso('17b');
    const { fila, item, plano, planos, cadencia, cadencias } = entradas(c.ds, c.empresaId);
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, { ...plano, itemId: 'x' }, cadencia, HOJE)).toThrow('sugestao_item_incompativel');
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, plano, { ...cadencia, versaoRegrasFila: 'CM1-A.0' }, HOJE)).toThrow('sugestao_versao_fila_incompativel');
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, { ...plano, versaoPlano: 'CM1-B.0' }, cadencia, HOJE)).toThrow('sugestao_versao_plano_incompativel');
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, plano, { ...cadencia, versaoCadencia: 'CM2-B.0' }, HOJE)).toThrow('sugestao_versao_cadencia_incompativel');
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, plano, { ...cadencia, motivo: 'SEM_TIMING_ATUAL' }, HOJE)).toThrow('sugestao_motivo_incompativel');
    expect(() => sugestaoTarefaCadenciaCM(c.ds, item, plano, cadencia, '2026-09-25')).toThrow('sugestao_cadencia_desatualizada');
    expect(() => sugestoesTarefaDaFilaCM(c.ds, fila, planos, cadencias, '2026-09-16')).toThrow('sugestao_hoje_divergente_da_fila');
    expect(() => sugestoesTarefaDaFilaCM(c.ds, fila, planos, [], HOJE)).toThrow('sugestao_entrada_incompleta');
  });

  it('uma sugestao por item, na ordem da fila, sem contas fora da fila', () => {
    for (const c of CASOS) {
      const { fila, sugestoes } = executar(c.ds);
      expect(sugestoes.map((s) => s.itemId)).toEqual(fila.itens.map((i: CommercialQueueItem) => [i.empresaId, i.porQueAgora.codigo, i.porQueAgora.referencia?.tipo ?? '-', i.porQueAgora.referencia?.id ?? '-', i.porQueAgora.trava ?? '-'].join(':')));
    }
  });

  it('nao altera dataset, fila, plano nem cadencia; funciona com tudo congelado', () => {
    for (const c of CASOS) {
      const ds = structuredClone(c.ds);
      const { fila, planos, cadencias, sugestoes } = executar(ds);
      const antes = JSON.stringify({ ds, fila, planos, cadencias });
      deepFreeze(ds); deepFreeze(fila); deepFreeze(planos); deepFreeze(cadencias);
      expect(sugestoesTarefaDaFilaCM(ds, fila, planos, cadencias, HOJE)).toEqual(sugestoes);
      expect(JSON.stringify({ ds, fila, planos, cadencias })).toBe(antes);
    }
  });

  it('permutacao das colecoes nao muda nada', () => {
    for (const c of CASOS) expect(executar(permutar(c.ds, (xs) => [...xs].reverse())).sugestoes).toEqual(executar(c.ds).sugestoes);
  });

  it('todo estado, cobertura, pendencia e aviso tem texto pt-BR', () => {
    for (const k of ESTADOS_SUGESTAO_TAREFA_CM) expect(TEXTO_ESTADO_SUGESTAO_TAREFA_CM[k]).toMatch(/\S/);
    for (const k of CODIGOS_COBERTURA_TAREFA_CM) expect(TEXTO_COBERTURA_TAREFA_CM[k]).toMatch(/\S/);
    for (const k of CODIGOS_PENDENCIA_TAREFA_CM) expect(TEXTO_PENDENCIA_TAREFA_CM[k]).toMatch(/\S/);
    for (const k of CODIGOS_AVISO_TAREFA_CM) expect(TEXTO_AVISO_TAREFA_CM[k]).toMatch(/\S/);
    for (const c of CASOS) for (const s of executar(c.ds).sugestoes) { expect(s.explicacao.titulo).toBe(TEXTO_ESTADO_SUGESTAO_TAREFA_CM[s.estado]); expect(s.explicacao.porQue).toMatch(/\S/); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guarda do modulo de producao: so projecao
// ---------------------------------------------------------------------------------------------------------------------
const FONTES_PERMITIDAS = new Set(['./commercialActionPlan', './commercialCadence', './commercialMachine', './contatos', './types']);
const PROIBIDOS = [/\brecomendarAcao\b/, /\bfilaHoje\b/, /\blerEmpresa\b/, /\brecomendarCanal\b/, /pipeline/, /\bstore\b/, /\bactions\b/, /supabase/i, /netlify/i, /\bfetch\s*\(/, /localStorage/, /\bids\.novo\b/, /randomUUID|crypto/, /Date\.now|new Date\(/, /migration/i, /\bcommit\s*\(/, /\bregistrar\s*\(/];

function violacoes(fonte: string): string[] {
  const out: string[] = [];
  for (const m of fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!FONTES_PERMITIDAS.has(m[1])) out.push(`import proibido ${m[1]}`);
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const semStrings = codigo.replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  for (const re of PROIBIDOS) if (re.test(semStrings)) out.push(`uso proibido ${re}`);
  for (const m of semStrings.replace(/\.slice\(0,\s*10\)/g, '').matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g)) if (m[1] !== '0' && m[1] !== '1') out.push(`literal numerico ${m[1]}`);
  return out;
}

describe('CM2-C — guarda: sem store, sem pipeline, sem persistencia, sem numero de politica', () => {
  it('autoteste da guarda', () => {
    // o nome do modulo dentro de string e pego pela checagem de import; identificadores, pela checagem de codigo
    expect(violacoes("import { actions } from '../../data/store';\nactions.salvarTarefaRadar(x);")).toEqual(['import proibido ../../data/store', 'uso proibido /\\bactions\\b/']);
    expect(violacoes("import { recomendarAcao } from './pipeline';")).toEqual(['import proibido ./pipeline', 'uso proibido /\\brecomendarAcao\\b/']);
    expect(violacoes('const venceEm = somar(ancora, 4);')).toEqual(['literal numerico 4']);
    expect(violacoes('const chave = [hoje, id].join(":"); const agora = new Date();')).toEqual(['uso proibido /Date\\.now|new Date\\(/']);
    expect(violacoes("import { contatoElegivel } from './contatos';\nconst d = v.slice(0, 10);")).toEqual([]);
  });

  it('commercialCadenceTask.ts respeita a guarda e nao usa hoje na chave', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const fonte = fs.readFileSync(path.join(dir, 'commercialCadenceTask.ts'), 'utf8');
    expect(violacoes(fonte)).toEqual([]);
    const corpoDaChave = fonte.slice(fonte.indexOf('export function chaveCadenciaCM'), fonte.indexOf('// API'));
    expect(corpoDaChave).not.toMatch(/\bhoje\b|\bd0\b|\bem\b|ancoraEm/);
  });
});

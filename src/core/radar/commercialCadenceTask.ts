// EIFF Commercial Machine — CM2-C: sugestao governada de tarefa, cobertura e identidade semantica.
//
// Responde "existe um compromisso que vale sugerir ao vendedor?" e "ele ja esta coberto por tarefa existente?". Nao cria,
// nao persiste e nao prepara tarefa real (sem id, sem store); nao altera a Commercial Queue, o plano nem a cadencia.
//
// Regra central: o que esta DEVIDO se executa agora, nao vira lembrete. Tarefa nova so nasce da lacuna do CM2-B:
// estado SUGERIR_PROXIMO_PASSO com proximo toque RECOMENDADO e datado. Composicao sem reinterpretar autoridades:
// data = cadencia (CM2-B); tipo e contato = plano (CM1-B); oportunidade e responsavel = item (CM1-A).
import { HIPOTESE_PLANO_CM, VERSAO_REGRAS_PLANO_CM, itemIdCM, type CommercialActionPlan } from './commercialActionPlan';
import { VERSAO_REGRAS_CADENCIA_CM, type CadenceRecommendationCM } from './commercialCadence';
import { VERSAO_REGRAS_CM, canaisAcionaveisCM, canonicalizarDatasetCM, normalizarHojeCM, type CodigoRazaoCM, type CommercialQueue, type CommercialQueueItem } from './commercialMachine';
import { contatoElegivel } from './contatos';
import { type RadarDataset, type TarefaRadar, type TipoTarefa } from './types';

export const ESTADOS_SUGESTAO_TAREFA_CM = ['SUGERIDA', 'COBERTA', 'REQUER_DATA', 'REQUER_RESPONSAVEL', 'BLOQUEADA', 'NAO_APLICAVEL'] as const;
export type EstadoSugestaoTarefaCM = (typeof ESTADOS_SUGESTAO_TAREFA_CM)[number];

/** Por que uma tarefa aberta cobre o ciclo (so fatos estruturados; nunca texto). */
export const CODIGOS_COBERTURA_TAREFA_CM = ['MESMA_OPORTUNIDADE', 'MESMO_CONTATO', 'MESMA_CONTA_SEM_CONTATO_DEFINIDO'] as const;
export type CodigoCoberturaTarefaCM = (typeof CODIGOS_COBERTURA_TAREFA_CM)[number];

export const CODIGOS_PENDENCIA_TAREFA_CM = [
  'DATA_DO_CLIENTE_NECESSARIA', 'ANCORA_TEMPORAL_AUSENTE', 'TAREFA_ABERTA_ANTERIOR_A_ANCORA', 'OPORTUNIDADE_INVALIDA',
  'CONTATO_INEXISTENTE', 'CONTATO_DE_OUTRA_EMPRESA', 'CONTATO_INELEGIVEL', 'CANAL_OBRIGATORIO_SEM_CONTATO', 'CANAL_OBRIGATORIO_INDISPONIVEL',
  'RESPONSAVEL_NECESSARIO',
] as const;
export type CodigoPendenciaTarefaCM = (typeof CODIGOS_PENDENCIA_TAREFA_CM)[number];

export const CODIGOS_AVISO_TAREFA_CM = ['COBERTURAS_CONCORRENTES', 'CONTATO_A_DEFINIR'] as const;
export type CodigoAvisoTarefaCM = (typeof CODIGOS_AVISO_TAREFA_CM)[number];

export interface TaskSuggestionCM {
  itemId: string;
  empresaId: string;
  versaoCadencia: string;
  versaoRegrasFila: string;
  versaoPlano: string;
  estado: EstadoSugestaoTarefaCM;
  /** Identidade semantica do ciclo (sem PII, sem hoje, sem data). Existe quando ha proximo toque RECOMENDADO. */
  chave?: string;
  /** Rascunho da tarefa: so em SUGERIDA e REQUER_RESPONSAVEL. Nunca e uma tarefa real. */
  tarefa?: { tipo: TipoTarefa; venceEm: string; responsavelId?: string; contatoId?: string; oportunidadeId?: string; descricaoBase: string };
  cobertura?: { tarefaId: string; motivo: CodigoCoberturaTarefaCM };
  pendencias: CodigoPendenciaTarefaCM[];
  avisos: CodigoAvisoTarefaCM[];
  explicacao: { titulo: string; porQue: string };
}

// ---------------------------------------------------------------------------------------------------------------------
// Textos pt-BR
// ---------------------------------------------------------------------------------------------------------------------
export const TEXTO_ESTADO_SUGESTAO_TAREFA_CM: Readonly<Record<EstadoSugestaoTarefaCM, string>> = {
  SUGERIDA: 'Próximo compromisso pronto para agendar',
  COBERTA: 'Já existe tarefa aberta para este ciclo',
  REQUER_DATA: 'Falta a data para agendar',
  REQUER_RESPONSAVEL: 'Falta definir o responsável',
  BLOQUEADA: 'Não dá para sugerir o compromisso',
  NAO_APLICAVEL: 'Nada para agendar agora',
};
export const TEXTO_COBERTURA_TAREFA_CM: Readonly<Record<CodigoCoberturaTarefaCM, string>> = {
  MESMA_OPORTUNIDADE: 'Tarefa aberta da mesma oportunidade, criada depois do último movimento',
  MESMO_CONTATO: 'Tarefa aberta do mesmo contato, compatível e criada depois da âncora',
  MESMA_CONTA_SEM_CONTATO_DEFINIDO: 'Tarefa aberta compatível da conta, criada depois da âncora (a sugestão não define contato)',
};
export const TEXTO_PENDENCIA_TAREFA_CM: Readonly<Record<CodigoPendenciaTarefaCM, string>> = {
  DATA_DO_CLIENTE_NECESSARIA: 'A data depende do cliente: registre a data combinada',
  ANCORA_TEMPORAL_AUSENTE: 'Não há fato com data confiável: um humano precisa decidir quando voltar',
  TAREFA_ABERTA_ANTERIOR_A_ANCORA: 'Existe tarefa aberta anterior ao último movimento: revisar antes de agendar outra',
  OPORTUNIDADE_INVALIDA: 'A oportunidade do item não existe ou é de outra empresa',
  CONTATO_INEXISTENTE: 'O contato do plano não existe',
  CONTATO_DE_OUTRA_EMPRESA: 'O contato do plano pertence a outra empresa',
  CONTATO_INELEGIVEL: 'O contato do plano não pode ser abordado',
  CANAL_OBRIGATORIO_SEM_CONTATO: 'O tipo de tarefa exige um canal, mas não há contato definido',
  CANAL_OBRIGATORIO_INDISPONIVEL: 'O contato não tem o canal que o tipo de tarefa exige',
  RESPONSAVEL_NECESSARIO: 'Não há responsável definido para a tarefa',
};
export const TEXTO_AVISO_TAREFA_CM: Readonly<Record<CodigoAvisoTarefaCM, string>> = {
  COBERTURAS_CONCORRENTES: 'Mais de uma tarefa aberta cobre este ciclo',
  CONTATO_A_DEFINIR: 'O plano não define contato para este passo: escolher na hora de agendar, se houver',
};
const TEXTO_NAO_APLICAVEL_TAREFA = {
  compromissoExistente: 'O compromisso já é uma tarefa ou ação da oportunidade: executar, concluir ou reagendar o existente',
  devida: 'A ação é devida agora: executar, não criar lembrete; o resultado recalcula a cadência',
  aguardando: 'Já existe data definida: nada novo a agendar',
  semProximoPasso: 'A cadência não pede novo compromisso neste momento',
};

// ---------------------------------------------------------------------------------------------------------------------
// Regras estruturais
// ---------------------------------------------------------------------------------------------------------------------
/** Razoes cujo compromisso ja e uma tarefa/acao existente. */
const RAZOES_DE_COMPROMISSO: ReadonlySet<CodigoRazaoCM> = new Set<CodigoRazaoCM>(['TAREFA_VENCIDA', 'OPORTUNIDADE_ACAO_VENCIDA', 'PROXIMA_ACAO_HOJE', 'PROXIMA_ACAO_AGENDADA']);

/**
 * Sem oportunidade: tipos de tarefa aberta que cobrem o tipo sugerido. Pequena e explicita; sem NLP.
 * Com oportunidade, qualquer tarefa aberta ligada a ela cobre (e o que o CM1-A e o store ja tratam como proxima acao).
 */
export const TIPOS_QUE_COBREM_CM: Readonly<Record<TipoTarefa, readonly TipoTarefa[]>> = {
  FOLLOW_UP: ['FOLLOW_UP', 'CALL', 'EMAIL', 'MEETING', 'VISIT', 'PROPOSAL'],
  CALL: ['CALL', 'FOLLOW_UP', 'MEETING', 'VISIT'],
  EMAIL: ['EMAIL', 'FOLLOW_UP', 'MEETING', 'VISIT'],
  MEETING: ['MEETING', 'VISIT'],
  VISIT: ['VISIT', 'MEETING'],
  PROPOSAL: ['PROPOSAL'],
  RESEARCH: ['RESEARCH'],
  OTHER: ['OTHER'],
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dia = (v: string) => v.slice(0, 10);

/** Identidade semantica do ciclo: so ids e codigos. */
export function chaveCadenciaCM(c: { versaoCadencia: string; empresaId: string; contatoId?: string; oportunidadeId?: string; motivo: CodigoRazaoCM; ancora: { tipo: string; id: string } }): string {
  return ['cad', c.versaoCadencia, c.empresaId, c.contatoId ?? '-', c.oportunidadeId ?? '-', c.motivo, c.ancora.tipo, c.ancora.id].join(':');
}

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------
export function sugestaoTarefaCadenciaCM(ds: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, cadencia: CadenceRecommendationCM, hoje: string): TaskSuggestionCM {
  return projetar(canonicalizarDatasetCM(ds), item, plano, cadencia, normalizarHojeCM(hoje));
}

export function sugestoesTarefaDaFilaCM(ds: RadarDataset, fila: CommercialQueue, planos: readonly CommercialActionPlan[], cadencias: readonly CadenceRecommendationCM[], hoje: string): TaskSuggestionCM[] {
  const d0 = normalizarHojeCM(hoje);
  if (fila.geradaEm !== d0) throw new Error('sugestao_hoje_divergente_da_fila');
  if (planos.length !== fila.itens.length || cadencias.length !== fila.itens.length) throw new Error('sugestao_entrada_incompleta');
  const r = canonicalizarDatasetCM(ds);
  const planoPor = new Map(planos.map((p) => [p.itemId, p]));
  const cadenciaPor = new Map(cadencias.map((c) => [c.itemId, c]));
  return fila.itens.map((item) => {
    const id = itemIdCM(item);
    const plano = planoPor.get(id); const cadencia = cadenciaPor.get(id);
    if (!plano || !cadencia) throw new Error('sugestao_entrada_incompleta');
    return projetar(r, item, plano, cadencia, d0);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------------------------------
function validarCoerencia(r: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, cadencia: CadenceRecommendationCM, d0: string) {
  const id = itemIdCM(item);
  if (plano.itemId !== id || cadencia.itemId !== id) throw new Error('sugestao_item_incompativel');
  if (plano.empresaId !== item.empresaId || cadencia.empresaId !== item.empresaId) throw new Error('sugestao_empresa_incompativel');
  if (plano.versaoRegrasFila !== VERSAO_REGRAS_CM || cadencia.versaoRegrasFila !== VERSAO_REGRAS_CM) throw new Error('sugestao_versao_fila_incompativel');
  if (plano.versaoPlano !== VERSAO_REGRAS_PLANO_CM || cadencia.versaoPlano !== VERSAO_REGRAS_PLANO_CM) throw new Error('sugestao_versao_plano_incompativel');
  if (cadencia.versaoCadencia !== VERSAO_REGRAS_CADENCIA_CM) throw new Error('sugestao_versao_cadencia_incompativel');
  if (cadencia.motivo !== item.porQueAgora.codigo || plano.acaoCodigo !== item.porQueAgora.codigo) throw new Error('sugestao_motivo_incompativel');
  if (!r.empresas.some((e) => e.id === item.empresaId)) throw new Error('sugestao_empresa_inexistente');
  const t = cadencia.proximoToque;
  if (t?.natureza === 'RECOMENDADA') {
    if (!t.em || !t.ancoraEm) throw new Error('sugestao_cadencia_incompleta');
    if (t.em < d0) throw new Error('sugestao_cadencia_desatualizada');
  }
}

function projetar(r: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, cadencia: CadenceRecommendationCM, d0: string): TaskSuggestionCM {
  validarCoerencia(r, item, plano, cadencia, d0);
  const base = {
    itemId: cadencia.itemId, empresaId: item.empresaId,
    versaoCadencia: cadencia.versaoCadencia, versaoRegrasFila: cadencia.versaoRegrasFila, versaoPlano: cadencia.versaoPlano,
  };
  const resultado = (estado: EstadoSugestaoTarefaCM, porQue: string, extra: Partial<TaskSuggestionCM> = {}): TaskSuggestionCM =>
    ({ ...base, estado, pendencias: [], avisos: [], ...extra, explicacao: { titulo: TEXTO_ESTADO_SUGESTAO_TAREFA_CM[estado], porQue } });

  // (2) data humana necessaria
  if (cadencia.avisos.includes('DATA_DO_CLIENTE_NECESSARIA')) return resultado('REQUER_DATA', TEXTO_PENDENCIA_TAREFA_CM.DATA_DO_CLIENTE_NECESSARIA, { pendencias: ['DATA_DO_CLIENTE_NECESSARIA'] });
  if (cadencia.avisos.includes('ANCORA_TEMPORAL_AUSENTE')) return resultado('REQUER_DATA', TEXTO_PENDENCIA_TAREFA_CM.ANCORA_TEMPORAL_AUSENTE, { pendencias: ['ANCORA_TEMPORAL_AUSENTE'] });

  // (3) so a lacuna datada vira compromisso; o resto se executa, espera ou pausa
  const toque = cadencia.proximoToque;
  if (cadencia.estado !== 'SUGERIR_PROXIMO_PASSO' || toque?.natureza !== 'RECOMENDADA' || !toque.em || !toque.ancoraEm) {
    const porQue = RAZOES_DE_COMPROMISSO.has(item.porQueAgora.codigo) ? TEXTO_NAO_APLICAVEL_TAREFA.compromissoExistente
      : cadencia.estado === 'DEVIDA' ? TEXTO_NAO_APLICAVEL_TAREFA.devida
      : cadencia.estado === 'AGUARDANDO' ? TEXTO_NAO_APLICAVEL_TAREFA.aguardando
      : TEXTO_NAO_APLICAVEL_TAREFA.semProximoPasso;
    return resultado('NAO_APLICAVEL', porQue);
  }

  // composicao: cada campo da sua autoridade
  const contatoId = plano.contato?.id;
  const oportunidadeId = item.oportunidadeId;
  const tipo = plano.tipoTarefa;
  const chave = chaveCadenciaCM({ versaoCadencia: cadencia.versaoCadencia, empresaId: item.empresaId, contatoId, oportunidadeId, motivo: cadencia.motivo, ancora: toque.origem });
  const ancoraEm = toque.ancoraEm;

  // (4) cobertura por tarefa aberta (fatos estruturados)
  const abertas = r.tarefas.filter((t) => t.empresaId === item.empresaId && t.status === 'Aberta');
  const mesmaIdentidade = (t: TarefaRadar): CodigoCoberturaTarefaCM | undefined => {
    if (oportunidadeId) return t.oportunidadeId === oportunidadeId ? 'MESMA_OPORTUNIDADE' : undefined;
    if (t.oportunidadeId || !TIPOS_QUE_COBREM_CM[tipo].includes(t.tipo)) return undefined;
    if (contatoId) return t.contatoId === contatoId ? 'MESMO_CONTATO' : undefined;
    return 'MESMA_CONTA_SEM_CONTATO_DEFINIDO';
  };
  const candidatas = abertas.map((t) => ({ t, motivo: mesmaIdentidade(t) })).filter((x): x is { t: TarefaRadar; motivo: CodigoCoberturaTarefaCM } => !!x.motivo);
  const cobrem = candidatas.filter((x) => dia(x.t.criadoEm) >= ancoraEm).sort((a, b) => cmp(dia(a.t.venceEm), dia(b.t.venceEm)) || cmp(a.t.criadoEm, b.t.criadoEm) || cmp(a.t.id, b.t.id));
  if (cobrem.length) {
    return resultado('COBERTA', TEXTO_COBERTURA_TAREFA_CM[cobrem[0].motivo], { chave, cobertura: { tarefaId: cobrem[0].t.id, motivo: cobrem[0].motivo }, avisos: cobrem.length > 1 ? ['COBERTURAS_CONCORRENTES'] : [] });
  }

  // (5) dados e elegibilidade
  const pendencias: CodigoPendenciaTarefaCM[] = [];
  if (candidatas.length) pendencias.push('TAREFA_ABERTA_ANTERIOR_A_ANCORA');
  if (oportunidadeId && !r.oportunidades.some((o) => o.id === oportunidadeId && o.empresaId === item.empresaId)) pendencias.push('OPORTUNIDADE_INVALIDA');
  const contato = contatoId ? r.contatos.find((c) => c.id === contatoId) : undefined;
  if (contatoId && !contato) pendencias.push('CONTATO_INEXISTENTE');
  else if (contato && contato.empresaId !== item.empresaId) pendencias.push('CONTATO_DE_OUTRA_EMPRESA');
  else if (contato && !contatoElegivel(contato, r.supressoes)) pendencias.push('CONTATO_INELEGIVEL');
  const canal = HIPOTESE_PLANO_CM.canalDaTarefa[tipo];
  if (canal && !contatoId) pendencias.push('CANAL_OBRIGATORIO_SEM_CONTATO');
  else if (canal && contato && contato.empresaId === item.empresaId && !canaisAcionaveisCM(contato, r.supressoes).includes(canal)) pendencias.push('CANAL_OBRIGATORIO_INDISPONIVEL');

  // (6) responsavel: so o do item, nunca um padrao
  const responsavelId = item.responsavelId?.trim() ? item.responsavelId : undefined;
  if (!responsavelId) pendencias.push('RESPONSAVEL_NECESSARIO');

  if (pendencias.some((p) => p !== 'RESPONSAVEL_NECESSARIO')) return resultado('BLOQUEADA', TEXTO_PENDENCIA_TAREFA_CM[pendencias[0]], { chave, pendencias });

  const tarefa: NonNullable<TaskSuggestionCM['tarefa']> = { tipo, venceEm: toque.em, descricaoBase: plano.explicacao.acao };
  if (responsavelId) tarefa.responsavelId = responsavelId;
  if (contatoId) tarefa.contatoId = contatoId;
  if (oportunidadeId) tarefa.oportunidadeId = oportunidadeId;
  const avisos: CodigoAvisoTarefaCM[] = contatoId ? [] : ['CONTATO_A_DEFINIR'];
  if (!responsavelId) return resultado('REQUER_RESPONSAVEL', TEXTO_PENDENCIA_TAREFA_CM.RESPONSAVEL_NECESSARIO, { chave, tarefa, pendencias, avisos });
  return resultado('SUGERIDA', `Agendar o próximo passo para não deixar a conta em silêncio: ${plano.explicacao.acao}`, { chave, tarefa, avisos });
}

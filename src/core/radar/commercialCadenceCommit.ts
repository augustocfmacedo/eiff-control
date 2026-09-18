// EIFF Commercial Machine — CM2-E: porta governada de criacao da tarefa de cadencia (revalidacao pura).
//
// A tela manda de volta a EXPECTATIVA do ciclo que o humano viu. Ela identifica e permite comparar; nunca autoriza.
// Toda decisao e recalculada aqui sobre o dataset ATUAL, nesta ordem (a ordem e o contrato):
//   FASE 1  validar a expectativa (falha fechada)
//   FASE 2  ja existe tarefa aberta cobrindo o ciclo HISTORICO esperado? -> JA_COBERTA (antes de olhar a fila atual)
//   FASE 3  recalcular fila -> planos -> cadencias -> sugestoes
//   FASE 4  reencontrar o mesmo ciclo e comparar o contexto que o humano viu -> divergiu: CONTEXTO_MUDOU
//   FASE 5  validar e aplicar as edicoes humanas (data, descricao, responsavel, contato)
//   FASE 6  segunda cobertura conservadora, com a identidade efetiva
//   FASE 7  autorizar (campos + origem; sem id, sem data do sistema, sem escrita)
// A FASE 2 vem antes da FASE 3 de proposito: depois que a primeira tarefa e criada, o CM1-A move a conta para AGENDADO e
// a lacuna some da fila. Perguntar "o ciclo ainda existe?" primeiro confundiria a CONSEQUENCIA da cobertura com mudanca
// de contexto, e o duplo clique viraria CONTEXTO_MUDOU em vez de JA_COBERTA.
//
// D-E1 — unicidade transacional cross-client: NAO resolvida. Nao ha indice unico nem RPC transacional para a chave de
// cadencia. Este modulo protege duplo clique e estado local velho (o store e sincrono e revalida contra o dataset ja
// commitado), mas duas sessoes/dispositivos offline ainda podem criar a mesma tarefa e sincronizar depois.
import { HIPOTESE_PLANO_CM, VERSAO_REGRAS_PLANO_CM, planosDaFilaCM } from './commercialActionPlan';
import { VERSAO_REGRAS_CADENCIA_CM, cadenciasDaFilaCM, type CadenceRecommendationCM } from './commercialCadence';
import { TIPOS_QUE_COBREM_CM, chaveCadenciaCM, sugestoesTarefaDaFilaCM, type CodigoPendenciaTarefaCM, type TaskSuggestionCM } from './commercialCadenceTask';
import { CODIGOS_RAZAO_CM, VERSAO_REGRAS_CM, canaisAcionaveisCM, canonicalizarDatasetCM, construirCommercialQueue, normalizarHojeCM, type CodigoRazaoCM, type TipoReferenciaCM } from './commercialMachine';
import { contatoElegivel } from './contatos';
import { TIPOS_TAREFA, type RadarDataset, type TarefaRadar, type TipoTarefa } from './types';

/** O ciclo que o humano viu na tela, devolvido no momento de criar. Identifica e compara; nunca autoriza. */
export interface ExpectativaCriacaoCadenciaCM {
  chave: string;
  itemId: string;
  empresaId: string;
  motivo: CodigoRazaoCM;
  versaoCadencia: string;
  versaoRegrasFila: string;
  versaoPlano: string;
  /** Fato que ancora o ciclo, com o dia: e ele que define o corte da cobertura historica. */
  ancora: { tipo: TipoReferenciaCM; id: string; em: string };
  tipoTarefa: TipoTarefa;
  /** Contato ORIGINAL do CM2-C (pode nao existir: o plano nem sempre define contato). */
  contatoId?: string;
  oportunidadeId?: string;
  /** Data que o CM2-B recomendava na leitura. Serve para auditoria e comparacao de contexto, nunca para impor. */
  dataRecomendada: string;
}

/** O que o humano pode mudar no formulario. Tipo e oportunidade nao aparecem aqui: sao imutaveis por desenho. */
export interface EdicoesHumanasCadenciaCM {
  venceEm?: string;
  descricao?: string;
  responsavelId?: string;
  contatoId?: string;
}

export const CODIGOS_RECUSA_COMMIT_CM = [
  'EXPECTATIVA_INCOERENTE', 'VERSAO_DIVERGENTE', 'JA_COBERTA', 'CONTEXTO_MUDOU', 'REQUER_DATA', 'BLOQUEADA',
  'RESPONSAVEL_NECESSARIO', 'DATA_INVALIDA', 'DATA_NO_PASSADO', 'DESCRICAO_VAZIA', 'CONTATO_INVALIDO', 'CANAL_INDISPONIVEL',
] as const;
export type CodigoRecusaCommitCM = (typeof CODIGOS_RECUSA_COMMIT_CM)[number];

export interface OrigemCriacaoCadenciaCM {
  chave: string;
  itemId: string;
  motivo: CodigoRazaoCM;
  ancora: ExpectativaCriacaoCadenciaCM['ancora'];
  versaoCadencia: string;
  versaoRegrasFila: string;
  versaoPlano: string;
  dataRecomendada: string;
  dataEditada: boolean;
  descricaoEditada: boolean;
  contatoEditado: boolean;
}

/** Campos da tarefa autorizada. Sem id, sem status e sem criadoEm: quem persiste e o store, depois deste veredicto. */
export interface TarefaAutorizadaCadenciaCM {
  empresaId: string;
  tipo: TipoTarefa;
  venceEm: string;
  descricao: string;
  responsavelId: string;
  contatoId?: string;
  oportunidadeId?: string;
}

export type VeredictoCommitCadenciaCM =
  | { ok: true; chave: string; tarefa: TarefaAutorizadaCadenciaCM; origem: OrigemCriacaoCadenciaCM }
  | { ok: false; codigo: CodigoRecusaCommitCM; tarefaId?: string; pendencias?: readonly CodigoPendenciaTarefaCM[]; detalhe?: string };

export const TEXTO_RECUSA_COMMIT_CM: Readonly<Record<CodigoRecusaCommitCM, string>> = {
  EXPECTATIVA_INCOERENTE: 'O pedido não corresponde a um ciclo válido da Máquina Comercial. Abra a fila de novo.',
  VERSAO_DIVERGENTE: 'As regras da Máquina Comercial mudaram desde que a tela foi carregada. Recarregue antes de agendar.',
  JA_COBERTA: 'Já existe tarefa aberta para este ciclo: concluir ou reagendar a existente.',
  CONTEXTO_MUDOU: 'O contexto comercial mudou desde a leitura. Veja a fila atualizada antes de agendar.',
  REQUER_DATA: 'Falta a data combinada com o cliente: registre a data antes de agendar.',
  BLOQUEADA: 'O próximo compromisso não pode ser preparado: resolva as pendências antes.',
  RESPONSAVEL_NECESSARIO: 'Informe quem será responsável pela tarefa.',
  DATA_INVALIDA: 'Data inválida.',
  DATA_NO_PASSADO: 'A data da tarefa não pode ser anterior a hoje.',
  DESCRICAO_VAZIA: 'Descreva a tarefa.',
  CONTATO_INVALIDO: 'O contato escolhido não existe, não é da empresa ou não pode ser abordado.',
  CANAL_INDISPONIVEL: 'O contato escolhido não tem o canal que este tipo de tarefa exige.',
};

export interface OpcoesCommitCadenciaCM { usuariosValidos?: readonly string[] }

// ---------------------------------------------------------------------------------------------------------------------
// Utilitarios puros
// ---------------------------------------------------------------------------------------------------------------------
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dia = (v: string) => v.slice(0, 10);
const diaValido = (d: string | undefined): d is string => {
  const ms = d ? Date.parse(`${d}T00:00:00Z`) : Number.NaN;
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === d;
};
const recusa = (codigo: CodigoRecusaCommitCM, extra: Omit<Extract<VeredictoCommitCadenciaCM, { ok: false }>, 'ok' | 'codigo'> = {}): VeredictoCommitCadenciaCM => ({ ok: false, codigo, ...extra });

/** Identidade do ciclo para cobertura: o que o humano viu (FASE 2) ou o que ficou depois das escolhas (FASE 6). */
interface IdentidadeCicloCM { empresaId: string; tipoTarefa: TipoTarefa; contatoId?: string; oportunidadeId?: string; desdeDia: string }

/**
 * Cobertura por fatos estruturados, nas MESMAS regras do CM2-C (a matriz de tipos e importada de la, nunca copiada):
 * - com oportunidade: qualquer tarefa aberta ligada a ela (inclusive interna);
 * - sem oportunidade e com contato: mesmo contato, tarefa sem oportunidade e tipo compativel;
 * - sem oportunidade e sem contato: qualquer tarefa compativel da conta sem oportunidade, com QUALQUER contato — inclusive
 *   um escolhido no formulario. E o que faz o duplo clique do caso D-C1 cair em JA_COBERTA.
 * Sempre com `criadoEm` no dia da ancora ou depois.
 */
export function tarefaQueCobreCicloCM(ds: RadarDataset, identidade: IdentidadeCicloCM): TarefaRadar | undefined {
  const casa = (t: TarefaRadar) => {
    if (t.empresaId !== identidade.empresaId || t.status !== 'Aberta') return false;
    if (dia(t.criadoEm) < identidade.desdeDia) return false;
    if (identidade.oportunidadeId) return t.oportunidadeId === identidade.oportunidadeId;
    if (t.oportunidadeId || !TIPOS_QUE_COBREM_CM[identidade.tipoTarefa].includes(t.tipo)) return false;
    return identidade.contatoId ? t.contatoId === identidade.contatoId : true;
  };
  return ds.tarefas.filter(casa).sort((a, b) => cmp(dia(a.venceEm), dia(b.venceEm)) || cmp(a.criadoEm, b.criadoEm) || cmp(a.id, b.id))[0];
}

/** Monta a expectativa a partir do que a tela mostrou. Só existe com sugestão que carrega rascunho (SUGERIDA/REQUER_RESPONSAVEL). */
export function expectativaDaSugestaoCM(cadencia: CadenceRecommendationCM, sugestao: TaskSuggestionCM): ExpectativaCriacaoCadenciaCM | undefined {
  const toque = cadencia.proximoToque;
  if (!sugestao.chave || !sugestao.tarefa || !toque || toque.natureza !== 'RECOMENDADA' || !toque.em || !toque.ancoraEm) return undefined;
  return {
    chave: sugestao.chave, itemId: sugestao.itemId, empresaId: sugestao.empresaId, motivo: cadencia.motivo,
    versaoCadencia: cadencia.versaoCadencia, versaoRegrasFila: cadencia.versaoRegrasFila, versaoPlano: cadencia.versaoPlano,
    ancora: { tipo: toque.origem.tipo, id: toque.origem.id, em: toque.ancoraEm },
    tipoTarefa: sugestao.tarefa.tipo, contatoId: sugestao.tarefa.contatoId, oportunidadeId: sugestao.tarefa.oportunidadeId,
    dataRecomendada: sugestao.tarefa.venceEm,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Revalidacao
// ---------------------------------------------------------------------------------------------------------------------
export function revalidarCriacaoTarefaCadenciaCM(
  ds: RadarDataset,
  hoje: string,
  expectativa: ExpectativaCriacaoCadenciaCM,
  edicoes: EdicoesHumanasCadenciaCM = {},
  opcoes: OpcoesCommitCadenciaCM = {},
): VeredictoCommitCadenciaCM {
  const d0 = normalizarHojeCM(hoje);
  const r = canonicalizarDatasetCM(ds);

  // --- FASE 1: a expectativa tem de ser coerente consigo mesma e com as regras vigentes; qualquer divergencia falha fechada
  if (expectativa.versaoCadencia !== VERSAO_REGRAS_CADENCIA_CM || expectativa.versaoRegrasFila !== VERSAO_REGRAS_CM || expectativa.versaoPlano !== VERSAO_REGRAS_PLANO_CM) return recusa('VERSAO_DIVERGENTE');
  const incoerente = (detalhe: string) => recusa('EXPECTATIVA_INCOERENTE', { detalhe });
  if (!expectativa.itemId.trim() || !expectativa.empresaId.trim() || !expectativa.ancora.id.trim()) return incoerente('identificadores ausentes');
  if (!(CODIGOS_RAZAO_CM as readonly string[]).includes(expectativa.motivo)) return incoerente('motivo fora do catálogo');
  if (!(TIPOS_TAREFA as readonly string[]).includes(expectativa.tipoTarefa)) return incoerente('tipo de tarefa fora do catálogo');
  if (!diaValido(expectativa.ancora.em) || !diaValido(expectativa.dataRecomendada)) return incoerente('datas da expectativa inválidas');
  if (expectativa.ancora.em > d0) return incoerente('âncora no futuro');
  if (!r.empresas.some((e) => e.id === expectativa.empresaId)) return incoerente('empresa inexistente');
  const chaveDaExpectativa = chaveCadenciaCM({
    versaoCadencia: expectativa.versaoCadencia, empresaId: expectativa.empresaId, contatoId: expectativa.contatoId,
    oportunidadeId: expectativa.oportunidadeId, motivo: expectativa.motivo, ancora: { tipo: expectativa.ancora.tipo, id: expectativa.ancora.id },
  });
  if (chaveDaExpectativa !== expectativa.chave) return incoerente('chave não corresponde aos campos');

  // --- FASE 2: cobertura do ciclo HISTORICO, antes de olhar a fila atual
  const identidadeHistorica: IdentidadeCicloCM = {
    empresaId: expectativa.empresaId, tipoTarefa: expectativa.tipoTarefa, contatoId: expectativa.contatoId,
    oportunidadeId: expectativa.oportunidadeId, desdeDia: expectativa.ancora.em,
  };
  const coberturaHistorica = tarefaQueCobreCicloCM(r, identidadeHistorica);
  if (coberturaHistorica) return recusa('JA_COBERTA', { tarefaId: coberturaHistorica.id });

  // --- FASE 3: estado atual, recalculado do zero
  const fila = construirCommercialQueue(r, d0);
  const planos = planosDaFilaCM(r, fila);
  const cadencias = cadenciasDaFilaCM(r, fila, planos, d0);
  const sugestoes = sugestoesTarefaDaFilaCM(r, fila, planos, cadencias, d0);

  // --- FASE 4: o mesmo ciclo ainda existe e o contexto e o mesmo que o humano viu?
  const atual = sugestoes.find((s) => s.chave === expectativa.chave);
  if (!atual) return recusa('CONTEXTO_MUDOU', { detalhe: 'o ciclo não está mais na fila' });
  if (atual.estado === 'COBERTA') return recusa('JA_COBERTA', { tarefaId: atual.cobertura?.tarefaId });
  if (atual.estado === 'REQUER_DATA') return recusa('REQUER_DATA', { pendencias: atual.pendencias });
  if (atual.estado === 'BLOQUEADA') return recusa('BLOQUEADA', { pendencias: atual.pendencias });
  if (atual.estado === 'NAO_APLICAVEL' || !atual.tarefa) return recusa('CONTEXTO_MUDOU', { detalhe: 'a cadência não pede mais um compromisso' });
  const divergiu = atual.itemId !== expectativa.itemId
    || atual.empresaId !== expectativa.empresaId
    || atual.tarefa.tipo !== expectativa.tipoTarefa
    || atual.tarefa.oportunidadeId !== expectativa.oportunidadeId
    || atual.tarefa.contatoId !== expectativa.contatoId
    || atual.tarefa.venceEm !== expectativa.dataRecomendada;
  if (divergiu) return recusa('CONTEXTO_MUDOU', { detalhe: 'a recomendação mudou desde a leitura' });

  // --- FASE 5: edicoes humanas (tipo e oportunidade vem da sugestao atual e nao sao editaveis)
  const venceEm = edicoes.venceEm ?? atual.tarefa.venceEm;
  if (!diaValido(venceEm)) return recusa('DATA_INVALIDA');
  if (venceEm < d0) return recusa('DATA_NO_PASSADO');
  const descricao = (edicoes.descricao ?? atual.tarefa.descricaoBase).trim();
  if (!descricao) return recusa('DESCRICAO_VAZIA');
  const responsavelId = (edicoes.responsavelId ?? atual.tarefa.responsavelId ?? '').trim();
  if (!responsavelId) return recusa('RESPONSAVEL_NECESSARIO');
  if (opcoes.usuariosValidos && !opcoes.usuariosValidos.includes(responsavelId)) return recusa('RESPONSAVEL_NECESSARIO', { detalhe: 'responsável inexistente' });
  const contatoId = edicoes.contatoId ?? atual.tarefa.contatoId;
  if (contatoId) {
    const contato = r.contatos.find((c) => c.id === contatoId);
    if (!contato || contato.empresaId !== expectativa.empresaId || !contatoElegivel(contato, r.supressoes)) return recusa('CONTATO_INVALIDO');
    const canal = HIPOTESE_PLANO_CM.canalDaTarefa[atual.tarefa.tipo];
    if (canal && !canaisAcionaveisCM(contato, r.supressoes).includes(canal)) return recusa('CANAL_INDISPONIVEL');
  } else if (HIPOTESE_PLANO_CM.canalDaTarefa[atual.tarefa.tipo]) {
    return recusa('CONTATO_INVALIDO', { detalhe: 'o tipo de tarefa exige um canal e não há contato' });
  }

  // --- FASE 6: segunda cobertura, conservadora, com a identidade efetiva (o contato pode ter sido escolhido agora)
  const coberturaEfetiva = tarefaQueCobreCicloCM(r, { ...identidadeHistorica, contatoId });
  if (coberturaEfetiva) return recusa('JA_COBERTA', { tarefaId: coberturaEfetiva.id });

  // --- FASE 7: autorizado
  return {
    ok: true,
    chave: expectativa.chave,
    tarefa: { empresaId: expectativa.empresaId, tipo: atual.tarefa.tipo, venceEm, descricao, responsavelId, contatoId, oportunidadeId: atual.tarefa.oportunidadeId },
    origem: {
      chave: expectativa.chave, itemId: expectativa.itemId, motivo: expectativa.motivo, ancora: expectativa.ancora,
      versaoCadencia: expectativa.versaoCadencia, versaoRegrasFila: expectativa.versaoRegrasFila, versaoPlano: expectativa.versaoPlano,
      dataRecomendada: expectativa.dataRecomendada,
      dataEditada: venceEm !== atual.tarefa.venceEm,
      descricaoEditada: descricao !== atual.tarefa.descricaoBase,
      contatoEditado: contatoId !== atual.tarefa.contatoId,
    },
  };
}

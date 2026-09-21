// CM2-D2 — decisoes de apresentacao do agendamento governado (puro, sem React e sem store).
//
// A tela nao decide nada de dominio: aqui so mora o que a UI precisa saber para MOSTRAR — se ha CTA e com que rotulo,
// quais campos nascem preenchidos e quais sao editaveis, e o que fazer com cada codigo de recusa que a fronteira
// (CM2-E) devolve. A expectativa vem de `expectativaDaSugestaoCM`; nada de chave, ancora ou versao remontada na tela.
import { expectativaDaSugestaoCM, type CodigoRecusaCommitCM, type EdicoesHumanasCadenciaCM, type ExpectativaCriacaoCadenciaCM } from '../../core/radar/commercialCadenceCommit';
import type { CadenceRecommendationCM } from '../../core/radar/commercialCadence';
import type { TaskSuggestionCM } from '../../core/radar/commercialCadenceTask';

/** Rotulo do CTA por estado da sugestao. Sem entrada = sem botao. */
export const ROTULO_CTA_CADENCIA: Partial<Record<TaskSuggestionCM['estado'], string>> = {
  SUGERIDA: 'Agendar próxima ação',
  REQUER_RESPONSAVEL: 'Definir responsável e agendar',
};

/** Ha CTA de agendamento? So com rascunho de tarefa e estado que admite criacao. */
export function ctaCadenciaCM(sugestao: TaskSuggestionCM, podeAgir: boolean): string | undefined {
  if (!podeAgir || !sugestao.tarefa) return undefined;
  return ROTULO_CTA_CADENCIA[sugestao.estado];
}

/** Campos do formulario governado: o que nasce preenchido e o que o humano pode mudar. */
export interface CamposAgendamentoCM {
  venceEm: string;
  descricao: string;
  responsavelId: string;
  contatoId: string;
  /** Contato so e escolhido quando a sugestao nao define nenhum (o plano nao definiu contato para este passo). */
  contatoEditavel: boolean;
}

export type AberturaAgendamentoCM =
  | { ok: true; expectativa: ExpectativaCriacaoCadenciaCM; empresaId: string; tarefa: NonNullable<TaskSuggestionCM['tarefa']>; campos: CamposAgendamentoCM }
  | { ok: false; motivo: 'SEM_EXPECTATIVA' };

/**
 * Snapshot do que o humano viu no instante do clique. Falha fechada: sem expectativa (sugestao sem chave, sem rascunho
 * ou sem toque recomendado) o formulario nao abre.
 */
export function abrirAgendamentoCM(cadencia: CadenceRecommendationCM, sugestao: TaskSuggestionCM): AberturaAgendamentoCM {
  const expectativa = expectativaDaSugestaoCM(cadencia, sugestao);
  if (!expectativa || !sugestao.tarefa) return { ok: false, motivo: 'SEM_EXPECTATIVA' };
  const t = sugestao.tarefa;
  return {
    ok: true,
    expectativa,
    empresaId: sugestao.empresaId,
    tarefa: t,
    campos: { venceEm: t.venceEm, descricao: t.descricaoBase, responsavelId: t.responsavelId ?? '', contatoId: t.contatoId ?? '', contatoEditavel: !t.contatoId },
  };
}

/** Edicoes enviadas a fronteira. Tipo e oportunidade nao existem aqui: sao imutaveis por contrato. */
export function edicoesDoFormularioCM(campos: CamposAgendamentoCM): EdicoesHumanasCadenciaCM {
  return {
    venceEm: campos.venceEm,
    descricao: campos.descricao,
    responsavelId: campos.responsavelId || undefined,
    contatoId: campos.contatoId || undefined,
  };
}

/** O que a tela faz com cada recusa: corrigir no formulario, mostrar conflito, ou mandar revisar a fila. */
export type ReacaoRecusaCadenciaCM = 'CAMPO' | 'JA_COBERTA' | 'CONTEXTO' | 'VERSAO' | 'PENDENCIA';
const REACAO: Readonly<Record<CodigoRecusaCommitCM, ReacaoRecusaCadenciaCM>> = {
  JA_COBERTA: 'JA_COBERTA',
  CONTEXTO_MUDOU: 'CONTEXTO',
  EXPECTATIVA_INCOERENTE: 'CONTEXTO',
  VERSAO_DIVERGENTE: 'VERSAO',
  REQUER_DATA: 'PENDENCIA',
  BLOQUEADA: 'PENDENCIA',
  RESPONSAVEL_NECESSARIO: 'CAMPO',
  DATA_INVALIDA: 'CAMPO',
  DATA_NO_PASSADO: 'CAMPO',
  DESCRICAO_VAZIA: 'CAMPO',
  CONTATO_INVALIDO: 'CAMPO',
  CANAL_INDISPONIVEL: 'CAMPO',
};
/** Decide pelo CODIGO, nunca pelo texto da mensagem. */
export const reacaoDaRecusaCadenciaCM = (codigo: CodigoRecusaCommitCM): ReacaoRecusaCadenciaCM => REACAO[codigo] ?? 'CONTEXTO';
/** O formulario continua aberto para correcao? */
export const mantemFormularioAbertoCM = (codigo: CodigoRecusaCommitCM) => reacaoDaRecusaCadenciaCM(codigo) === 'CAMPO';

export const TITULO_CONFLITO_CADENCIA_CM: Readonly<Record<Exclude<ReacaoRecusaCadenciaCM, 'CAMPO'>, string>> = {
  JA_COBERTA: 'Esta ação já foi agendada.',
  CONTEXTO: 'A situação desta conta mudou.',
  VERSAO: 'As regras da Máquina Comercial mudaram.',
  PENDENCIA: 'O próximo compromisso não pode ser agendado ainda.',
};
export const TEXTO_CONFLITO_CADENCIA_CM: Readonly<Record<Exclude<ReacaoRecusaCadenciaCM, 'CAMPO'>, string>> = {
  JA_COBERTA: 'Já existe uma tarefa aberta cobrindo este ciclo.',
  CONTEXTO: 'A Máquina Comercial recalculou esta conta desde que o formulário foi aberto. Revise a ação atual antes de agendar.',
  VERSAO: 'As regras da Máquina Comercial foram atualizadas. Reabra a recomendação antes de agendar.',
  PENDENCIA: 'A fronteira recusou o agendamento por pendências desta conta. Resolva-as antes de agendar.',
};
export const MENSAGEM_SEM_EXPECTATIVA_CM = 'Esta recomendação não está mais disponível. Veja a fila atualizada antes de agendar.';
export const MENSAGEM_AGENDADA_CM = 'Próxima ação agendada.';

/** Campo do formulario que cada recusa corrigivel aponta (so destaque visual; a autoridade continua na fronteira). */
export type CampoAgendamentoCM = 'venceEm' | 'responsavelId' | 'contatoId' | 'descricao';
const CAMPO: Partial<Record<CodigoRecusaCommitCM, CampoAgendamentoCM>> = {
  DATA_INVALIDA: 'venceEm', DATA_NO_PASSADO: 'venceEm', RESPONSAVEL_NECESSARIO: 'responsavelId',
  CONTATO_INVALIDO: 'contatoId', CANAL_INDISPONIVEL: 'contatoId', DESCRICAO_VAZIA: 'descricao',
};
export const campoDaRecusaCadenciaCM = (codigo: CodigoRecusaCommitCM): CampoAgendamentoCM | undefined => CAMPO[codigo];

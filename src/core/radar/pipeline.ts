// Regras do pipeline e leitura operacional do Radar: caches da empresa, regra "oportunidade ativa sem proxima acao",
// acao recomendada, fila do dia, indicadores do command center e pipeline financeiro.
import { NOME_ESTAGIO } from './padroes';
import { sinalAcionavel } from './sinalLeitura';
import { brutoEmpresaDe } from './fitCalibracao';
import { calcularScore, diasEntre, motivoPrioridade, type ContextoEmpresa } from './score';
import { contatoElegivel, sugerirContatoPrincipal, temCanal, type SugestaoContato } from './contatos';
import type { Atividade, Contato, Empresa, ExplicacaoScore, Oportunidade, RadarDataset, Sinal, TarefaRadar } from './types';
import { estagioAtivo } from './types';

export const contextoEmpresa = (r: RadarDataset, empresaId: string): ContextoEmpresa | undefined => {
  const empresa = r.empresas.find((e) => e.id === empresaId);
  if (!empresa) return undefined;
  const bruto = r.registrosFonte.filter((x) => x.tipo === 'empresa' && x.entidadeId === empresaId).at(-1)?.payload;
  return { empresa, contatos: r.contatos.filter((c) => c.empresaId === empresaId), sinais: r.sinais.filter((s) => s.empresaId === empresaId), atividades: r.atividades.filter((a) => a.empresaId === empresaId), projetos: r.projetos.filter((p) => p.empresaId === empresaId), bruto: brutoEmpresaDe(bruto) };
};

/** Recalcula os campos de cache da empresa (ultimo sinal/contato, proxima acao) sem tocar no score. */
export function atualizarCaches(e: Empresa, r: RadarDataset): Empresa {
  const sinais = r.sinais.filter((s) => s.empresaId === e.id).map((s) => s.eventoEm).sort();
  // nota interna (NOTE) nao e contato com a empresa: nao conta como ultimo contato
  const ats = r.atividades.filter((a) => a.empresaId === e.id && a.tipo !== 'NOTE').map((a) => a.ocorreuEm).sort();
  const proximas = [
    ...r.tarefas.filter((t) => t.empresaId === e.id && t.status === 'Aberta').map((t) => t.venceEm),
    ...r.oportunidades.filter((o) => o.empresaId === e.id && estagioAtivo(o.estagio) && o.proximaAcaoEm).map((o) => o.proximaAcaoEm!),
  ].sort();
  return { ...e, ultimoSinalEm: sinais.pop(), ultimoContatoEm: ats.pop(), proximaAcaoEm: proximas[0] };
}

/** Score + caches: usado apos qualquer mudanca que afete a empresa. */
export function recalcularEmpresa(e: Empresa, r: RadarDataset, hoje: string): { empresa: Empresa; explicacao: ExplicacaoScore } {
  const ctx = contextoEmpresa({ ...r, empresas: [e] }, e.id)!;
  const explicacao = calcularScore(ctx, r.regrasScore, r.configScore, hoje);
  const d = (dim: string) => explicacao.dimensoes.find((k) => k.dimensao === dim)?.score ?? 0;
  const empresa = atualizarCaches({ ...e, fitScore: d('FIT'), timingScore: d('TIMING'), intentScore: d('INTENT'), relationshipScore: d('RELATIONSHIP'), dataQualityScore: d('DATA_QUALITY'), priorityScore: explicacao.total, priorityClass: explicacao.classe }, r);
  return { empresa, explicacao };
}

// ---------------------------------------------------------------------------
// Regra critica: oportunidade ativa sem proxima acao
// ---------------------------------------------------------------------------
export const semProximaAcao = (o: Oportunidade, tarefas: TarefaRadar[]) => estagioAtivo(o.estagio) && !o.proximaAcaoEm && !tarefas.some((t) => t.oportunidadeId === o.id && t.status === 'Aberta');
export const oportunidadesSemProximaAcao = (r: RadarDataset) => r.oportunidades.filter((o) => semProximaAcao(o, r.tarefas));

// ---------------------------------------------------------------------------
// Supressao: contatos que nao entram em filas automaticas
// ---------------------------------------------------------------------------
export const contatoSuprimido = (c: Contato, r: RadarDataset) => r.supressoes.some((s) => (s.contatoId === c.id || (s.empresaId === c.empresaId && !s.contatoId)) && (s.tipo === 'do_not_contact' || s.tipo === 'opt_out'));
export const empresaSuprimida = (empresaId: string, r: RadarDataset) => r.supressoes.some((s) => s.empresaId === empresaId && !s.contatoId && (s.tipo === 'do_not_contact' || s.tipo === 'opt_out'));
/** Decisor a exibir: o contato recomendado (principal ou maior decision fit), nunca suprimido/invalido/saiu da empresa. */
export const decisorDe = (empresaId: string, r: RadarDataset): Contato | undefined => contatoRecomendado(empresaId, r)?.contato;
export const contatosElegiveis = (empresaId: string, r: RadarDataset): Contato[] => r.contatos.filter((c) => c.empresaId === empresaId && contatoElegivel(c, r.supressoes));
export const sinalPrincipal = (empresaId: string, r: RadarDataset, hoje: string): Sinal | undefined => r.sinais.filter((s) => s.empresaId === empresaId).map((s) => ({ s, v: s.scoreEfetivo * Math.max(0.1, 1 - diasEntre(s.eventoEm, hoje) / 365) })).sort((a, b) => b.v - a.v)[0]?.s;
export const ultimaAtividade = (empresaId: string, r: RadarDataset): Atividade | undefined => r.atividades.filter((a) => a.empresaId === empresaId).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1))[0];

// ---------------------------------------------------------------------------
// Acao recomendada (heuristica explicavel; a IA entra depois por cima disto)
// ---------------------------------------------------------------------------
export type EstadoAcao = 'DO_NOT_CONTACT' | 'OVERDUE_TASK' | 'PLANNED_ACTION' | 'RESPOND' | 'SEARCH_DECISION_MAKER' | 'ENRICH_CONTACT' | 'RESEARCH_SIGNALS' | 'CONTACT_NOW' | 'FOLLOW_UP' | 'OPEN_OPPORTUNITY' | 'WAIT';
export const NOME_ESTADO_ACAO: Record<EstadoAcao, string> = { DO_NOT_CONTACT: 'Não contatar', OVERDUE_TASK: 'Tarefa vencida', PLANNED_ACTION: 'Ação planejada', RESPOND: 'Responder ao cliente', SEARCH_DECISION_MAKER: 'Buscar decisor', ENRICH_CONTACT: 'Enriquecer contato', RESEARCH_SIGNALS: 'Pesquisar sinais', CONTACT_NOW: 'Contatar agora', FOLLOW_UP: 'Follow-up', OPEN_OPPORTUNITY: 'Abrir oportunidade', WAIT: 'Aguardar' };
export interface Recomendacao { estado: EstadoAcao; acao: string; tipoTarefa: TarefaRadar['tipo']; motivo: string; contato?: SugestaoContato }

/** Contato recomendado da empresa: principal definido pelo usuario ou maior decision fit entre os elegiveis. */
export const contatoRecomendado = (empresaId: string, r: RadarDataset): SugestaoContato | undefined => { const e = r.empresas.find((x) => x.id === empresaId); return e ? sugerirContatoPrincipal(e, r.contatos, r, undefined) : undefined; };
const FIT_ADEQUADO = (r: RadarDataset) => r.pesosDecisionFit.find((p) => p.chave === 'fit.adequado')?.valor ?? 40;
/** Corte de decisor ideal (fit.ideal, configuravel em radar_decision_fit_weight; 70 por padrao). */
export const fitIdealDe = (r: Pick<RadarDataset, 'pesosDecisionFit'>) => r.pesosDecisionFit.find((p) => p.chave === 'fit.ideal')?.valor ?? 70;

export function recomendarAcao(e: Empresa, r: RadarDataset, hoje: string): Recomendacao {
  if (empresaSuprimida(e.id, r)) return { estado: 'DO_NOT_CONTACT', acao: 'Não contatar', tipoTarefa: 'OTHER', motivo: 'empresa marcada como não contatar' };
  const opp = r.oportunidades.filter((o) => o.empresaId === e.id && estagioAtivo(o.estagio)).sort((a, b) => b.probabilidade - a.probabilidade)[0];
  const ult = ultimaAtividade(e.id, r);
  const sug = contatoRecomendado(e.id, r);
  const dec = sug?.contato;
  const adequado = !!sug && sug.fit.score >= FIT_ADEQUADO(r);
  const comCanal = !!dec && temCanal(dec);
  const temSinal = r.sinais.some((s) => s.empresaId === e.id);
  const tarefaVencida = r.tarefas.find((t) => t.empresaId === e.id && t.status === 'Aberta' && t.venceEm < hoje);
  if (tarefaVencida) return { estado: 'OVERDUE_TASK', acao: tarefaVencida.descricao || 'Concluir tarefa vencida', tipoTarefa: tarefaVencida.tipo, motivo: `tarefa vencida em ${tarefaVencida.venceEm.slice(0, 10).split('-').reverse().join('/')}`, contato: sug };
  if (opp && opp.proximaAcao) return { estado: 'PLANNED_ACTION', acao: opp.proximaAcao, tipoTarefa: 'FOLLOW_UP', motivo: `próxima ação da oportunidade em ${NOME_ESTAGIO[opp.estagio]}`, contato: sug };
  const responder = (acao: string, tipoTarefa: TarefaRadar['tipo'], motivo: string): Recomendacao => ({ estado: 'RESPOND', acao, tipoTarefa, motivo, contato: sug });
  if (ult?.resultado === 'REQUESTED_BUDGET') return responder('Preparar e enviar o orçamento', 'PROPOSAL', 'pediu orçamento');
  if (ult?.resultado === 'REQUESTED_TECHNICAL_ANALYSIS') return responder('Agendar análise técnica com a engenharia', 'MEETING', 'pediu análise técnica');
  if (ult?.resultado === 'REQUESTED_MEETING' || ult?.resultado === 'REQUESTED_PRESENTATION') return responder('Agendar a reunião ou apresentação', 'MEETING', ult.resultado === 'REQUESTED_MEETING' ? 'pediu reunião' : 'pediu apresentação');
  if (ult?.resultado === 'CALL_BACK') return responder('Retornar a ligação', 'CALL', 'pediu retorno');
  if (ult?.resultado === 'REFERRED_TO_OTHER_PERSON') return responder('Cadastrar e contatar a pessoa indicada', 'RESEARCH', 'indicou outra pessoa');
  if (ult?.resultado === 'FUTURE_PROJECT') return responder('Agendar follow-up e pedir o cronograma do projeto', 'FOLLOW_UP', 'projeto futuro');
  if (ult?.resultado === 'ACTIVE_PROJECT') return responder('Pedir o projeto e oferecer análise técnica', 'PROPOSAL', 'projeto em andamento');
  // sinal comercialmente acionavel (grupo A/B, relevancia direta/indireta, confianca >= 40%): so contata com decisor ideal (fit.ideal)
  const forte = sinalPrincipal(e.id, r, hoje);
  if (forte && sinalAcionavel(forte)) {
    const ideal = fitIdealDe(r);
    const titulo = forte.titulo;
    if (sug && sug.fit.score >= ideal) {
      if (!comCanal) return { estado: 'ENRICH_CONTACT', acao: `Conseguir e-mail profissional ou telefone de ${dec!.nome} para falar sobre: ${titulo}`, tipoTarefa: 'RESEARCH', motivo: `sinal acionável e decision fit ${sug.fit.score} ≥ ${ideal}, mas sem canal válido`, contato: sug };
      return { estado: 'CONTACT_NOW', acao: `Contatar ${dec!.nome.split(' ')[0]}${dec!.whatsapp ? ' por WhatsApp' : dec!.celular || dec!.telefone ? ' por telefone' : ' por e-mail'} sobre: ${titulo}`, tipoTarefa: 'CALL', motivo: `sinal acionável e decision fit ${sug.fit.score} ≥ ${ideal}`, contato: sug };
    }
    return { estado: 'SEARCH_DECISION_MAKER', acao: sug ? `Buscar decisor melhor que ${dec!.nome.split(' ')[0]} (fit ${sug.fit.score} < ${ideal}) para: ${titulo}` : `Buscar o decisor para: ${titulo}`, tipoTarefa: 'RESEARCH', motivo: sug ? `sinal acionável, mas decision fit ${sug.fit.score} < ${ideal}` : 'sinal acionável e nenhum contato elegível', contato: sug };
  }
  // estados de prontidao: decisor adequado? canal? sinal?
  if (!adequado) return { estado: 'SEARCH_DECISION_MAKER', acao: sug ? `Buscar um decisor melhor que ${dec!.nome.split(' ')[0]} (fit ${sug.fit.score})` : 'Pesquisar o decisor (LinkedIn, site, indicação)', tipoTarefa: 'RESEARCH', motivo: sug ? 'contato disponível tem baixo decision fit' : 'sem contato elegível', contato: sug };
  if (!comCanal) return { estado: 'ENRICH_CONTACT', acao: `Conseguir e-mail profissional ou telefone de ${dec!.nome}`, tipoTarefa: 'RESEARCH', motivo: 'decisor identificado sem canal válido', contato: sug };
  if (!temSinal) return { estado: 'RESEARCH_SIGNALS', acao: 'Pesquisar sinais: obras (CNO), notícias, vagas, expansão', tipoTarefa: 'RESEARCH', motivo: 'decisor e canal prontos, mas sem sinal de momento', contato: sug };
  if (!ult) return { estado: 'CONTACT_NOW', acao: `Contatar ${dec!.nome.split(' ')[0]}${dec!.whatsapp ? ' por WhatsApp' : dec!.celular || dec!.telefone ? ' por telefone' : ' por e-mail'}`, tipoTarefa: 'CALL', motivo: `sinal relevante e decisor adequado (fit ${sug!.fit.score})`, contato: sug };
  if (ult?.resultado === 'GATEKEEPER' || ult?.resultado === 'NO_RESPONSE') return { estado: 'CONTACT_NOW', acao: 'Tentar outro canal ou horário', tipoTarefa: 'CALL', motivo: ult.resultado === 'GATEKEEPER' ? 'barrado na recepção' : 'sem resposta', contato: sug };
  const dias = diasEntre(ult.ocorreuEm, hoje);
  if (dias >= 14) return { estado: 'FOLLOW_UP', acao: 'Follow-up: retomar a conversa', tipoTarefa: 'FOLLOW_UP', motivo: `${dias} dias sem contato`, contato: sug };
  if (e.timingScore >= 40 && !opp) return { estado: 'OPEN_OPPORTUNITY', acao: 'Abrir oportunidade e confirmar a necessidade', tipoTarefa: 'FOLLOW_UP', motivo: 'sinal de momento sem oportunidade aberta', contato: sug };
  return { estado: 'WAIT', acao: 'Manter o cadastro e aguardar a próxima ação', tipoTarefa: 'FOLLOW_UP', motivo: 'contato recente', contato: sug };
}

// ---------------------------------------------------------------------------
// Leitura de empresas (a fila do dia legada e o resumo legado foram removidos na D-6: a fila é a Commercial Queue)
// ---------------------------------------------------------------------------
export interface ItemFila {
  empresa: Empresa;
  motivo: string;
  sinal?: Sinal;
  decisor?: Contato;
  ultimaAtividade?: Atividade;
  proximaAcaoEm?: string;
  proximaAcao?: string;
  recomendacao: Recomendacao;
  oportunidade?: Oportunidade;
  vencida: boolean;
  semProximaAcao: boolean;
  ordem: number;
}

export function lerEmpresa(e: Empresa, r: RadarDataset, hoje: string): ItemFila {
  const opp = r.oportunidades.filter((o) => o.empresaId === e.id && estagioAtivo(o.estagio)).sort((a, b) => b.probabilidade - a.probabilidade)[0];
  const tarefa = r.tarefas.filter((t) => t.empresaId === e.id && t.status === 'Aberta').sort((a, b) => (a.venceEm < b.venceEm ? -1 : 1))[0];
  const proximaAcaoEm = e.proximaAcaoEm ?? tarefa?.venceEm ?? opp?.proximaAcaoEm;
  const proximaAcao = tarefa?.descricao ?? opp?.proximaAcao;
  const ctx = contextoEmpresa(r, e.id)!;
  const x = calcularScore(ctx, r.regrasScore, r.configScore, hoje);
  const vencida = !!proximaAcaoEm && proximaAcaoEm.slice(0, 10) < hoje.slice(0, 10);
  const sem = !!opp && semProximaAcao(opp, r.tarefas);
  const ordem = e.priorityScore + (vencida ? 100 : 0) + (sem ? 50 : 0) + (proximaAcaoEm && proximaAcaoEm.slice(0, 10) === hoje.slice(0, 10) ? 30 : 0);
  return { empresa: e, motivo: motivoPrioridade(x), sinal: sinalPrincipal(e.id, r, hoje), decisor: decisorDe(e.id, r), ultimaAtividade: ultimaAtividade(e.id, r), proximaAcaoEm, proximaAcao, recomendacao: recomendarAcao(e, r, hoje), oportunidade: opp, vencida, semProximaAcao: sem, ordem };
}

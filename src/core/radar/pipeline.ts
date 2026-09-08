// Regras do pipeline e leitura operacional do Radar: caches da empresa, regra "oportunidade ativa sem proxima acao",
// acao recomendada, fila do dia, indicadores do command center e pipeline financeiro.
import { NOME_ESTAGIO, NOME_SINAL, PROBABILIDADE_ESTAGIO } from './padroes';
import { calcularScore, diasEntre, motivoPrioridade, type ContextoEmpresa } from './score';
import type { Atividade, Contato, Empresa, ExplicacaoScore, Oportunidade, RadarDataset, Sinal, TarefaRadar } from './types';
import { estagioAtivo } from './types';

export const contextoEmpresa = (r: RadarDataset, empresaId: string): ContextoEmpresa | undefined => {
  const empresa = r.empresas.find((e) => e.id === empresaId);
  if (!empresa) return undefined;
  return { empresa, contatos: r.contatos.filter((c) => c.empresaId === empresaId), sinais: r.sinais.filter((s) => s.empresaId === empresaId), atividades: r.atividades.filter((a) => a.empresaId === empresaId), projetos: r.projetos.filter((p) => p.empresaId === empresaId) };
};

/** Recalcula os campos de cache da empresa (ultimo sinal/contato, proxima acao) sem tocar no score. */
export function atualizarCaches(e: Empresa, r: RadarDataset): Empresa {
  const sinais = r.sinais.filter((s) => s.empresaId === e.id).map((s) => s.eventoEm).sort();
  const ats = r.atividades.filter((a) => a.empresaId === e.id).map((a) => a.ocorreuEm).sort();
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
export const decisorDe = (empresaId: string, r: RadarDataset): Contato | undefined => r.contatos.filter((c) => c.empresaId === empresaId && c.ativo && !contatoSuprimido(c, r)).sort((a, b) => Number(b.decisor) - Number(a.decisor) || (b.qualidade - a.qualidade))[0];
export const sinalPrincipal = (empresaId: string, r: RadarDataset, hoje: string): Sinal | undefined => r.sinais.filter((s) => s.empresaId === empresaId).map((s) => ({ s, v: s.scoreEfetivo * Math.max(0.1, 1 - diasEntre(s.eventoEm, hoje) / 365) })).sort((a, b) => b.v - a.v)[0]?.s;
export const ultimaAtividade = (empresaId: string, r: RadarDataset): Atividade | undefined => r.atividades.filter((a) => a.empresaId === empresaId).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1))[0];

// ---------------------------------------------------------------------------
// Acao recomendada (heuristica explicavel; a IA entra depois por cima disto)
// ---------------------------------------------------------------------------
export interface Recomendacao { acao: string; tipoTarefa: TarefaRadar['tipo']; motivo: string }

export function recomendarAcao(e: Empresa, r: RadarDataset, hoje: string): Recomendacao {
  if (empresaSuprimida(e.id, r)) return { acao: 'Não contatar', tipoTarefa: 'OTHER', motivo: 'empresa marcada como não contatar' };
  const opp = r.oportunidades.filter((o) => o.empresaId === e.id && estagioAtivo(o.estagio)).sort((a, b) => b.probabilidade - a.probabilidade)[0];
  const ult = ultimaAtividade(e.id, r);
  const dec = decisorDe(e.id, r);
  const contatos = r.contatos.filter((c) => c.empresaId === e.id && c.ativo);
  const tarefaVencida = r.tarefas.find((t) => t.empresaId === e.id && t.status === 'Aberta' && t.venceEm < hoje);
  if (tarefaVencida) return { acao: tarefaVencida.descricao || 'Concluir tarefa vencida', tipoTarefa: tarefaVencida.tipo, motivo: `tarefa vencida em ${tarefaVencida.venceEm.slice(0, 10).split('-').reverse().join('/')}` };
  if (opp && opp.proximaAcao) return { acao: opp.proximaAcao, tipoTarefa: 'FOLLOW_UP', motivo: `próxima ação da oportunidade em ${NOME_ESTAGIO[opp.estagio]}` };
  if (ult?.resultado === 'REQUESTED_BUDGET') return { acao: 'Preparar e enviar o orçamento', tipoTarefa: 'PROPOSAL', motivo: 'pediu orçamento' };
  if (ult?.resultado === 'REQUESTED_TECHNICAL_ANALYSIS') return { acao: 'Agendar análise técnica com a engenharia', tipoTarefa: 'MEETING', motivo: 'pediu análise técnica' };
  if (ult?.resultado === 'REQUESTED_MEETING' || ult?.resultado === 'REQUESTED_PRESENTATION') return { acao: 'Agendar a reunião ou apresentação', tipoTarefa: 'MEETING', motivo: ult.resultado === 'REQUESTED_MEETING' ? 'pediu reunião' : 'pediu apresentação' };
  if (ult?.resultado === 'CALL_BACK') return { acao: 'Retornar a ligação', tipoTarefa: 'CALL', motivo: 'pediu retorno' };
  if (ult?.resultado === 'REFERRED_TO_OTHER_PERSON') return { acao: 'Cadastrar e contatar a pessoa indicada', tipoTarefa: 'RESEARCH', motivo: 'indicou outra pessoa' };
  if (ult?.resultado === 'GATEKEEPER' || ult?.resultado === 'NO_RESPONSE') return { acao: 'Tentar outro canal ou horário', tipoTarefa: 'CALL', motivo: ult.resultado === 'GATEKEEPER' ? 'barrado na recepção' : 'sem resposta' };
  if (ult?.resultado === 'FUTURE_PROJECT') return { acao: 'Agendar follow-up e pedir o cronograma do projeto', tipoTarefa: 'FOLLOW_UP', motivo: 'projeto futuro' };
  if (ult?.resultado === 'ACTIVE_PROJECT') return { acao: 'Pedir o projeto e oferecer análise técnica', tipoTarefa: 'PROPOSAL', motivo: 'projeto em andamento' };
  if (!contatos.length) return { acao: 'Pesquisar o decisor (LinkedIn, site, indicação)', tipoTarefa: 'RESEARCH', motivo: 'sem contatos cadastrados' };
  if (!dec?.decisor) return { acao: 'Identificar o decisor de engenharia ou expansão', tipoTarefa: 'RESEARCH', motivo: 'nenhum contato marcado como decisor' };
  if (!ult) return { acao: `Primeiro contato com ${dec.nome.split(' ')[0]}${dec.whatsapp ? ' por WhatsApp' : dec.telefone || dec.celular ? ' por telefone' : dec.email ? ' por e-mail' : ''}`, tipoTarefa: 'CALL', motivo: 'decisor identificado e nunca contatado' };
  const dias = diasEntre(ult.ocorreuEm, hoje);
  if (dias >= 14) return { acao: 'Follow-up: retomar a conversa', tipoTarefa: 'FOLLOW_UP', motivo: `${dias} dias sem contato` };
  if (e.timingScore >= 40 && !opp) return { acao: 'Abrir oportunidade e confirmar a necessidade', tipoTarefa: 'FOLLOW_UP', motivo: 'sinal de momento sem oportunidade aberta' };
  return { acao: 'Manter o cadastro e aguardar a próxima ação', tipoTarefa: 'FOLLOW_UP', motivo: 'contato recente' };
}

// ---------------------------------------------------------------------------
// Fila do dia e leitura de empresas
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

/** Fila ordenada: vencidas primeiro, depois prioridade. Ignora empresas inativas, mescladas e suprimidas. */
export function filaHoje(r: RadarDataset, hoje: string, responsavelId?: string): ItemFila[] {
  return r.empresas.filter((e) => e.ativo && !e.mescladaEm && !empresaSuprimida(e.id, r))
    .filter((e) => !responsavelId || r.tarefas.some((t) => t.empresaId === e.id && t.status === 'Aberta' && t.responsavelId === responsavelId) || r.oportunidades.some((o) => o.empresaId === e.id && estagioAtivo(o.estagio) && o.responsavelId === responsavelId) || !r.oportunidades.some((o) => o.empresaId === e.id && estagioAtivo(o.estagio)))
    .map((e) => lerEmpresa(e, r, hoje)).sort((a, b) => b.ordem - a.ordem);
}

// ---------------------------------------------------------------------------
// Command center
// ---------------------------------------------------------------------------
export interface ResumoRadar {
  aMais: number; a: number; b: number; c: number; d: number;
  novosSinais7d: number; sinais30d: number;
  followUpsVencidos: number; tarefasHoje: number;
  oportunidadesSemAcao: number; oportunidadesAtivas: number;
  atividades7d: number; atividades30d: number; respostas30d: number; respostasPositivas30d: number; reunioes30d: number;
  projetosRecebidos30d: number; propostas30d: number; ganhas90d: number; perdidas90d: number;
  pipeline: number; pipelinePonderado: number; porEstagio: { estagio: Oportunidade['estagio']; nome: string; quantidade: number; valor: number }[];
  duplicatasPendentes: number; importacoes: number;
  topSinais: { tipo: string; nome: string; quantidade: number }[];
}

export function resumoRadar(r: RadarDataset, hoje: string): ResumoRadar {
  const d0 = hoje.slice(0, 10);
  const dias = (iso: string) => diasEntre(iso, hoje);
  const ativas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  const cls = (c: string) => ativas.filter((e) => e.priorityClass === c).length;
  const opps = r.oportunidades.filter((o) => estagioAtivo(o.estagio));
  const tiposResp = new Map(r.tiposResposta.map((t) => [t.codigo, t]));
  const ats30 = r.atividades.filter((a) => dias(a.ocorreuEm) <= 30);
  const alcancou = (estagio: string, diasMax: number) => new Set(r.historicoEstagios.filter((h) => h.para === estagio && dias(h.em) <= diasMax).map((h) => h.oportunidadeId)).size;
  const porEstagio = (Object.keys(NOME_ESTAGIO) as Oportunidade['estagio'][]).map((estagio) => { const os = r.oportunidades.filter((o) => o.estagio === estagio); return { estagio, nome: NOME_ESTAGIO[estagio], quantidade: os.length, valor: os.reduce((s, o) => s + (o.valorEstimado ?? 0), 0) }; }).filter((x) => x.quantidade);
  const sin30 = r.sinais.filter((s) => dias(s.detectadoEm) <= 30);
  const cont = new Map<string, number>(); for (const s of sin30) cont.set(s.tipo, (cont.get(s.tipo) ?? 0) + 1);
  return {
    aMais: cls('A+'), a: cls('A'), b: cls('B'), c: cls('C'), d: cls('D'),
    novosSinais7d: r.sinais.filter((s) => dias(s.detectadoEm) <= 7).length, sinais30d: sin30.length,
    followUpsVencidos: r.tarefas.filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) < d0).length, tarefasHoje: r.tarefas.filter((t) => t.status === 'Aberta' && t.venceEm.slice(0, 10) === d0).length,
    oportunidadesSemAcao: oportunidadesSemProximaAcao(r).length, oportunidadesAtivas: opps.length,
    atividades7d: r.atividades.filter((a) => dias(a.ocorreuEm) <= 7).length, atividades30d: ats30.length,
    respostas30d: ats30.filter((a) => a.resultado && a.resultado !== 'NO_RESPONSE').length, respostasPositivas30d: ats30.filter((a) => a.resultado && tiposResp.get(a.resultado)?.sentimento === 'positivo').length,
    reunioes30d: ats30.filter((a) => a.tipo === 'MEETING' || a.tipo === 'VISIT' || a.tipo === 'PRESENTATION').length,
    projetosRecebidos30d: alcancou('PROJECT_RECEIVED', 30), propostas30d: alcancou('PROPOSAL_SENT', 30), ganhas90d: alcancou('WON', 90), perdidas90d: alcancou('LOST', 90),
    pipeline: opps.reduce((s, o) => s + (o.valorEstimado ?? 0), 0), pipelinePonderado: opps.reduce((s, o) => s + (o.valorEstimado ?? 0) * (o.probabilidade ?? PROBABILIDADE_ESTAGIO[o.estagio]), 0), porEstagio,
    duplicatasPendentes: r.duplicatas.filter((x) => x.status === 'pendente').length, importacoes: r.importacoes.length,
    topSinais: [...cont.entries()].map(([tipo, quantidade]) => ({ tipo, nome: NOME_SINAL[tipo as keyof typeof NOME_SINAL] ?? tipo, quantidade })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 5),
  };
}

// Regras do pipeline e leitura operacional do Radar: caches da empresa, regra "oportunidade ativa sem proxima acao",
// acao recomendada, fila do dia, indicadores do command center e pipeline financeiro.
import { NOME_ESTAGIO, NOME_SINAL, PROBABILIDADE_ESTAGIO } from './padroes';
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
  duplicatasPendentes: number; importacoes: number; revisoesPendentes: number;
  topSinais: { tipo: string; nome: string; quantidade: number }[];
  // cobertura de contatos
  empresas: number; comContato: number; comDecisor: number; comCanal: number; precisamPesquisa: number; precisamEnriquecimento: number; semDecisor: number;
  coberturaContato: number; coberturaDecisor: number; contatavel: number;
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
  const fitMin = FIT_ADEQUADO(r);
  let comContato = 0; let comDecisor = 0; let comCanal = 0; let precisamPesquisa = 0; let precisamEnriquecimento = 0;
  for (const e of ativas) {
    const el = contatosElegiveis(e.id, r);
    if (el.length) comContato++;
    const sug = contatoRecomendado(e.id, r);
    const adequado = !!sug && sug.fit.score >= fitMin;
    if (adequado) comDecisor++;
    if (el.some(temCanal)) comCanal++;
    if (!adequado || !r.sinais.some((s) => s.empresaId === e.id)) precisamPesquisa++;
    if (adequado && !temCanal(sug!.contato)) precisamEnriquecimento++;
  }
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
    duplicatasPendentes: r.duplicatas.filter((x) => x.status === 'pendente').length, importacoes: r.importacoes.length, revisoesPendentes: r.importacaoLinhas.filter((l) => l.status === 'revisao').length,
    empresas: ativas.length, comContato, comDecisor, comCanal, precisamPesquisa, precisamEnriquecimento, semDecisor: ativas.length - comDecisor,
    coberturaContato: ativas.length ? comContato / ativas.length : 0, coberturaDecisor: ativas.length ? comDecisor / ativas.length : 0, contatavel: ativas.length ? comCanal / ativas.length : 0,
    topSinais: [...cont.entries()].map(([tipo, quantidade]) => ({ tipo, nome: NOME_SINAL[tipo as keyof typeof NOME_SINAL] ?? tipo, quantidade })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 5),
  };
}

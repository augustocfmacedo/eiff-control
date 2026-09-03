// Analise executiva da obra: indices de desempenho, saude (0-100) com pontos positivos e negativos,
// curva S (previsto x faturado x custo) e atividade recente. Tudo derivado do estado atual, portanto
// recalculado a cada alteracao.

import type { Dataset } from './types';
import { addDays, addMonths, calcLancamentos, startOfMonth, type LancamentoCalc, type Obra360 } from './engine';
import { calcTarefas, resumoEquipe } from './equipe';

export type Sinal = 'positivo' | 'negativo' | 'atencao';

export interface Ponto {
  sinal: Sinal;
  tema: 'Prazo' | 'Custo' | 'Faturamento' | 'Caixa' | 'Margem' | 'Equipe' | 'Produção' | 'Rotina';
  texto: string;
  peso: number; // impacto no score (negativos subtraem)
}

export interface PontoCurva {
  mes: string; // yyyy-mm-01
  rotulo: string;
  previsto: number; // receita liquida prevista acumulada
  faturado?: number; // acumulado ate o mes (undefined apos a data-base)
  custoPrevisto: number; // custo previsto acumulado (proporcional ao previsto)
  custo?: number; // comprometido acumulado por competencia (undefined apos a data-base)
}

export interface AnaliseObra {
  codigo: string;
  nome: string;
  score: number;
  semaforo: 'verde' | 'amarelo' | 'vermelho';
  pontos: Ponto[];
  // indices
  idp?: number; // desempenho de prazo (faturado / previsto acumulado ate a data-base)
  idc?: number; // desempenho de custo (custo previsto proporcional / comprometido)
  pctFaturado: number;
  pctPlanejadoAteHoje: number; // parte da receita que ja deveria ter sido faturada
  pctFisico: number;
  pctFinanceiro: number; // pago / EAC
  margemAlvo: number;
  margemProjetada: number;
  desvioMargemPp: number; // pontos percentuais
  recebiveisVencidos: number;
  aReceber30d: number;
  aFaturar30d: number;
  pagar30d: number;
  caixaObra: number;
  retencaoAcumulada: number;
  eventosAtrasados: number;
  servicosAtrasados: number;
  servicosEmRisco: number;
  demandasAtrasadas: number;
  demandasPendentes: number;
  aderenciaChecklist: number;
  ordensAtrasadas: number;
  tarefasAtrasadas: number;
  equipe: { hh: number; custoMO: number; absenteismo: number; horasPerdidas: number; efetivoMedio: number; dias: number };
  curva: PontoCurva[];
  proximosMarcos: { numero: string; evento: string; data?: string; liquido: number; dias?: number }[];
  atividade: { ts: string; usuario: string; texto: string }[];
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rot = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const pp = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const brl = (v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;

export function analisarObra(ds: Dataset, o: Obra360, lancs: LancamentoCalc[] = calcLancamentos(ds)): AnaliseObra {
  const db = ds.params.dataBase;
  const m = o.medicoes;
  const meds = m.medicoes;
  const previstoAteHoje = meds.filter((x) => x.dataPrevista && x.dataPrevista <= db).reduce((a, x) => a + x.faturamentoConstrutora - x.retencaoConstrutora, 0);
  const pctPlanejadoAteHoje = m.liquidoConstrutora ? previstoAteHoje / m.liquidoConstrutora : 0;
  const idp = previstoAteHoje > 0 ? m.faturado / previstoAteHoje : undefined;
  const custoProp = o.servicos.reduce((a, s) => a + s.custoPrevistoProporcional, 0);
  const idc = o.custoComprometido > 0 ? custoProp / o.custoComprometido : undefined;
  const pctFaturado = m.liquidoConstrutora ? m.faturado / m.liquidoConstrutora : 0;
  const pctFinanceiro = o.eac ? o.custoPago / o.eac : 0;
  const margemProjetada = o.pctMargemProjetada;
  const desvioMargemPp = (margemProjetada - o.margemAlvo) * 100;
  const daObra = lancs.filter((l) => l.codigoObra === o.obra.codigo && l.oficial);
  const recebiveisVencidos = daObra.filter((l) => l.tipo === 'Entrada' && l.situacao === 'Atrasado').reduce((a, l) => a + l.saldoAberto, 0);
  const em30 = addDays(db, 30);
  const aReceber30d = daObra.filter((l) => l.tipo === 'Entrada' && l.status !== 'Cancelado' && l.status !== 'Realizado' && l.vencimento >= db && l.vencimento <= em30).reduce((a, l) => a + l.saldoAberto, 0);
  const pagar30d = daObra.filter((l) => l.tipo === 'Saída' && l.status !== 'Cancelado' && l.status !== 'Realizado' && l.vencimento >= db && l.vencimento <= em30).reduce((a, l) => a + l.saldoAberto, 0);
  const aFaturar30d = meds.filter((x) => x.status === 'Pendente' && x.dataPrevista && x.dataPrevista <= em30).reduce((a, x) => a + x.valorLiquidoConstrutora, 0);
  const tarefas = calcTarefas(ds, db).filter((t) => t.codigoObra === o.obra.codigo);
  const eq = resumoEquipe(ds, { ini: addDays(db, -29), fim: db }, { codigoObra: o.obra.codigo });
  const aderencia = o.demandas.length ? o.demandas.filter((d) => d.periodicidade !== 'Única').reduce((a, d) => a + d.aderencia, 0) / Math.max(1, o.demandas.filter((d) => d.periodicidade !== 'Única').length) : 0;

  // pontos positivos e negativos
  const pontos: Ponto[] = [];
  const add = (sinal: Sinal, tema: Ponto['tema'], texto: string, peso: number) => pontos.push({ sinal, tema, texto, peso });
  if (idp !== undefined) {
    if (idp >= 0.95) add('positivo', 'Prazo', `Faturamento no ritmo do cronograma (IDP ${idp.toFixed(2)}): ${brl(m.faturado)} faturados contra ${brl(previstoAteHoje)} previstos até hoje`, 0);
    else if (idp >= 0.8) add('atencao', 'Prazo', `Faturamento levemente atrás do cronograma (IDP ${idp.toFixed(2)}): faltam ${brl(previstoAteHoje - m.faturado)} para o previsto até hoje`, 8);
    else add('negativo', 'Prazo', `Faturamento atrás do cronograma (IDP ${idp.toFixed(2)}): ${brl(previstoAteHoje - m.faturado)} previstos até hoje ainda não foram medidos`, 15);
  }
  if (m.atrasadas > 0) add('negativo', 'Faturamento', `${m.atrasadas} evento(s) de medição com data prevista vencida`, Math.min(15, m.atrasadas * 4));
  else if (meds.length) add('positivo', 'Faturamento', 'Nenhum evento de medição vencido', 0);
  if (idc !== undefined) {
    if (idc >= 1) add('positivo', 'Custo', `Custo abaixo do previsto para o faturado (IDC ${idc.toFixed(2)}): comprometido ${brl(o.custoComprometido)} contra ${brl(custoProp)} previstos`, 0);
    else if (idc >= 0.9) add('atencao', 'Custo', `Custo levemente acima do previsto para o faturado (IDC ${idc.toFixed(2)})`, 8);
    else add('negativo', 'Custo', `Custo acima do previsto para o faturado (IDC ${idc.toFixed(2)}): comprometido ${brl(o.custoComprometido)} contra ${brl(custoProp)} previstos`, 15);
  } else if (o.custoComprometido === 0 && m.faturado > 0) add('atencao', 'Custo', `Nenhum custo lançado contra os serviços, com ${brl(m.faturado)} já faturados: o custo real está fora do sistema`, 10);
  if (desvioMargemPp >= 0) add('positivo', 'Margem', `Margem projetada ${pp(margemProjetada)} igual ou acima da meta de ${pp(o.margemAlvo)}`, 0);
  else if (desvioMargemPp >= -5) add('atencao', 'Margem', `Margem projetada ${pp(margemProjetada)}, ${Math.abs(desvioMargemPp).toFixed(1)} pontos abaixo da meta de ${pp(o.margemAlvo)}`, 8);
  else add('negativo', 'Margem', `Margem projetada ${pp(margemProjetada)}, ${Math.abs(desvioMargemPp).toFixed(1)} pontos abaixo da meta de ${pp(o.margemAlvo)}`, 15);
  if (recebiveisVencidos > 0) add('negativo', 'Caixa', `${brl(recebiveisVencidos)} de recebíveis vencidos da obra`, 10);
  else add('positivo', 'Caixa', 'Sem recebíveis vencidos', 0);
  if (o.caixaGerado < 0) add('atencao', 'Caixa', `Caixa da obra negativo em ${brl(-o.caixaGerado)}: pagou mais do que recebeu até agora`, 5);
  else if (o.recebido > 0) add('positivo', 'Caixa', `Caixa da obra positivo em ${brl(o.caixaGerado)}`, 0);
  if (aFaturar30d > 0) add('positivo', 'Faturamento', `${brl(aFaturar30d)} a faturar nos próximos 30 dias, se os marcos forem cumpridos`, 0);
  if (o.servicosAtrasados > 0) add('negativo', 'Prazo', `${o.servicosAtrasados} serviço(s) com prazo vencido`, Math.min(15, o.servicosAtrasados * 5));
  if (o.servicosEmRisco > 0) add('atencao', 'Prazo', `${o.servicosEmRisco} serviço(s) em risco de prazo (avanço físico atrás do calendário)`, Math.min(8, o.servicosEmRisco * 3));
  if (o.servicosAtrasados === 0 && o.servicosEmRisco === 0 && o.servicos.length) add('positivo', 'Prazo', 'Serviços dentro do prazo', 0);
  if (o.demandasAtrasadas > 0) add('negativo', 'Rotina', `${o.demandasAtrasadas} demanda(s) com prazo vencido`, 5);
  if (o.demandas.length) {
    if (aderencia >= 0.8) add('positivo', 'Rotina', `Check-list com ${pp(aderencia)} de aderência`, 0);
    else add('atencao', 'Rotina', `Check-list com ${pp(aderencia)} de aderência; ${o.demandasPendentes} demanda(s) pendente(s) no período`, 5);
  }
  const ordAtras = o.fabricacao.atrasadas + o.montagem.atrasadas;
  if (ordAtras > 0) add('negativo', 'Produção', `${ordAtras} ordem(ns) de fabricação/montagem atrasada(s)`, Math.min(10, ordAtras * 5));
  else if (o.fabricacao.ordens.length + o.montagem.ordens.length) add('positivo', 'Produção', `Produção em dia: ${o.fabricacao.emAndamento + o.montagem.emAndamento} ordem(ns) em andamento, nenhuma atrasada`, 0);
  const tAtras = tarefas.filter((t) => t.atrasada).length;
  if (tAtras > 0) add('negativo', 'Rotina', `${tAtras} tarefa(s) atrasada(s)`, Math.min(8, tAtras * 3));
  if (eq.diasApontados > 0) {
    if (eq.absenteismo > 0.05) add('atencao', 'Equipe', `Absenteísmo de ${pp(eq.absenteismo)} nos últimos 30 dias`, 5);
    else add('positivo', 'Equipe', `Absenteísmo de ${pp(eq.absenteismo)} nos últimos 30 dias, ${eq.diasApontados} dia(s) apontado(s)`, 0);
    const pctPerdidas = eq.horas + eq.horasExtras ? eq.horasPerdidas / (eq.horas + eq.horasExtras) : 0;
    if (pctPerdidas > 0.1) add('negativo', 'Equipe', `${pp(pctPerdidas)} das horas perdidas por ocorrências nos últimos 30 dias`, 8);
    if (eq.pctHorasExtras > 0.15) add('atencao', 'Equipe', `Horas extras em ${pp(eq.pctHorasExtras)} das horas normais`, 4);
  } else if (o.ativa) add('atencao', 'Equipe', 'Sem diário de obra nos últimos 30 dias', 4);

  const score = Math.max(0, Math.min(100, 100 - pontos.filter((p) => p.sinal !== 'positivo').reduce((a, p) => a + p.peso, 0)));
  const ordemSinal: Record<Sinal, number> = { negativo: 0, atencao: 1, positivo: 2 };
  pontos.sort((a, b) => ordemSinal[a.sinal] - ordemSinal[b.sinal] || b.peso - a.peso);

  // curva S mensal: do primeiro mes previsto/inicio ate o ultimo previsto/fim contratual
  const mesesPrev = meds.map((x) => x.dataPrevista).filter(Boolean) as string[];
  const ini = startOfMonth([o.obra.inicio, ...mesesPrev].filter(Boolean).sort()[0] ?? db);
  const fim = startOfMonth([o.obra.fimContratual, ...mesesPrev].filter(Boolean).sort().pop() ?? db);
  const curva: PontoCurva[] = [];
  let acPrev = 0; let acFat = 0; let acCusto = 0;
  const custosObra = daObra.filter((l) => l.tipo === 'Saída' && l.status !== 'Cancelado');
  const mesHoje = startOfMonth(db);
  for (let mes = ini; mes <= fim && curva.length < 36; mes = addMonths(mes, 1)) {
    const fimMes = addMonths(mes, 1);
    acPrev += meds.filter((x) => x.dataPrevista && x.dataPrevista >= mes && x.dataPrevista < fimMes).reduce((a, x) => a + x.faturamentoConstrutora - x.retencaoConstrutora, 0);
    acFat += meds.filter((x) => x.medida && (x.dataMedicao ?? x.dataPrevista ?? '') >= mes && (x.dataMedicao ?? x.dataPrevista ?? '') < fimMes).reduce((a, x) => a + x.valorLiquidoConstrutora, 0);
    acCusto += custosObra.filter((l) => l.competencia >= mes && l.competencia < fimMes).reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
    const pctPrev = m.liquidoConstrutora ? acPrev / m.liquidoConstrutora : 0;
    curva.push({ mes, rotulo: rot(mes), previsto: acPrev, faturado: mes <= mesHoje ? acFat : undefined, custoPrevisto: o.custoPrevisto * pctPrev, custo: mes <= mesHoje ? acCusto : undefined });
  }

  const atividade = ds.auditoria
    .filter((a) => (a.entidade === 'obra' && a.entidadeId === o.obra.codigo) || (a.entidade === 'lancamento' && daObra.some((l) => l.id === a.entidadeId)) || (a.entidade === 'medicao' && meds.some((x) => x.id === a.entidadeId)) || (a.entidade === 'servico' && o.servicos.some((s) => s.id === a.entidadeId)) || (a.entidade === 'apontamento' && ds.apontamentos.some((ap) => ap.id === a.entidadeId && ap.codigoObra === o.obra.codigo)))
    .slice(0, 12)
    .map((a) => ({ ts: a.ts, usuario: a.usuario, texto: `${a.acao.replace(/_/g, ' ')} · ${a.entidade} ${a.entidadeId}${a.motivo ? ` — ${a.motivo}` : ''}` }));

  return {
    codigo: o.obra.codigo, nome: o.obra.nome, score, semaforo: score >= 80 ? 'verde' : score >= 60 ? 'amarelo' : 'vermelho', pontos,
    idp, idc, pctFaturado, pctPlanejadoAteHoje, pctFisico: o.execucaoFisica, pctFinanceiro, margemAlvo: o.margemAlvo, margemProjetada, desvioMargemPp,
    recebiveisVencidos, aReceber30d, aFaturar30d, pagar30d, caixaObra: o.caixaGerado, retencaoAcumulada: m.retencaoAcumulada,
    eventosAtrasados: m.atrasadas, servicosAtrasados: o.servicosAtrasados, servicosEmRisco: o.servicosEmRisco, demandasAtrasadas: o.demandasAtrasadas, demandasPendentes: o.demandasPendentes, aderenciaChecklist: aderencia,
    ordensAtrasadas: ordAtras, tarefasAtrasadas: tAtras,
    equipe: { hh: eq.horas + eq.horasExtras, custoMO: eq.custoMO, absenteismo: eq.absenteismo, horasPerdidas: eq.horasPerdidas, efetivoMedio: eq.efetivoMedio, dias: eq.diasApontados },
    curva,
    proximosMarcos: m.proximas.slice(0, 5).map((x) => ({ numero: x.numero, evento: x.evento, data: x.dataPrevista, liquido: x.valorLiquidoConstrutora, dias: x.diasParaPrevista })),
    atividade,
  };
}

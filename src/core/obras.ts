// Operacao de obras: servicos (orcamento x prazo x custo), demandas em check-list e producao
// (linha de fabricacao / linha de montagem). Tudo calculado sobre a base unica de lancamentos,
// para que orcamento, compra, medicao e caixa compartilhem os mesmos codigos (Blueprint, secao 2).

import type { Demanda, EtapaOrdem, OrdemProducao, Periodicidade, Servico, TipoOrdem } from './types';
import type { LancamentoCalc } from './engine';

// ---------------------------------------------------------------------------
// Datas (copia local para evitar dependencia circular com engine.ts)
// ---------------------------------------------------------------------------
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);
const segunda = (s: string) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));

// ---------------------------------------------------------------------------
// Linhas de producao: etapas padrao
// ---------------------------------------------------------------------------
export const ETAPAS_FABRICACAO = ['Detalhamento', 'Corte', 'Solda / conformação', 'Pintura', 'Expedição'];
export const ETAPAS_MONTAGEM = ['Recebimento em obra', 'Pré-montagem', 'Içamento', 'Fixação / torqueamento', 'Liberação'];

export function etapasPadrao(tipo: TipoOrdem): EtapaOrdem[] {
  return (tipo === 'Fabricação' ? ETAPAS_FABRICACAO : ETAPAS_MONTAGEM).map((nome) => ({ nome, status: 'Pendente', quantidadeConcluida: 0 }));
}

// ---------------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------------
export type SituacaoPrazo = 'Concluído' | 'Atrasado' | 'Em risco' | 'No prazo' | 'Não iniciado' | 'Suspenso' | 'Sem prazo';

export interface ServicoCalc extends Servico {
  custoComprometido: number;
  custoPago: number;
  comprometidoAberto: number;
  etc: number;
  etcDerivado: boolean;
  eac: number;
  margemProjetada: number;
  pctMargem: number;
  desvioOrcamento: number; // eac - custoOrcado
  receitaPrevista: number;
  receitaRealizada: number;
  pctExecucao: number; // quantidade executada / orcada
  pctFinanceiro: number; // pago / eac
  diasParaFim?: number;
  duracaoPrevista?: number;
  situacaoPrazo: SituacaoPrazo;
  lancamentos: LancamentoCalc[];
}

export function calcServico(s: Servico, lancs: LancamentoCalc[], dataBase: string): ServicoCalc {
  const meus = lancs.filter((l) => l.servicoId === s.id && l.oficial);
  const custos = meus.filter((l) => l.tipo === 'Saída' && l.status !== 'Cancelado');
  const custoComprometido = custos.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const custoPago = custos.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const comprometidoAberto = Math.max(0, custoComprometido - custoPago);
  const etcDerivado = s.estimativaConcluir === undefined || s.estimativaConcluir === null;
  const etcInformado = etcDerivado ? Math.max(0, s.custoOrcado - custoComprometido) : s.estimativaConcluir!;
  const etcNaoComprometido = etcDerivado ? etcInformado : Math.max(0, etcInformado - comprometidoAberto);
  const eac = s.status === 'Concluído' ? custoComprometido : custoPago + comprometidoAberto + etcNaoComprometido;
  const entradas = meus.filter((l) => l.tipo === 'Entrada' && l.status !== 'Cancelado');
  const receitaPrevista = entradas.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const receitaRealizada = entradas.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const pctExecucao = s.status === 'Concluído' ? 1 : s.quantidadeOrcada > 0 ? Math.min(1, s.quantidadeExecutada / s.quantidadeOrcada) : 0;
  const diasParaFim = s.fimPrevisto ? diffDays(s.fimPrevisto, dataBase) : undefined;
  const duracaoPrevista = s.inicioPrevisto && s.fimPrevisto ? diffDays(s.fimPrevisto, s.inicioPrevisto) : undefined;
  let situacaoPrazo: SituacaoPrazo;
  if (s.status === 'Concluído') situacaoPrazo = 'Concluído';
  else if (s.status === 'Suspenso') situacaoPrazo = 'Suspenso';
  else if (!s.fimPrevisto) situacaoPrazo = s.status === 'Não iniciado' ? 'Não iniciado' : 'Sem prazo';
  else if (diasParaFim! < 0) situacaoPrazo = 'Atrasado';
  else if (duracaoPrevista && s.inicioPrevisto) {
    // em risco quando o avanco fisico esta atras do avanco do calendario em mais de 15 pontos
    const decorrido = Math.min(1, Math.max(0, diffDays(dataBase, s.inicioPrevisto) / Math.max(1, duracaoPrevista)));
    situacaoPrazo = decorrido - pctExecucao > 0.15 ? 'Em risco' : s.status === 'Não iniciado' && decorrido > 0 ? 'Em risco' : s.status === 'Não iniciado' ? 'Não iniciado' : 'No prazo';
  } else situacaoPrazo = s.status === 'Não iniciado' ? 'Não iniciado' : 'No prazo';
  return {
    ...s,
    custoComprometido, custoPago, comprometidoAberto, etc: etcInformado, etcDerivado, eac,
    margemProjetada: s.precoVenda - eac, pctMargem: s.precoVenda ? (s.precoVenda - eac) / s.precoVenda : 0,
    desvioOrcamento: eac - s.custoOrcado, receitaPrevista, receitaRealizada, pctExecucao, pctFinanceiro: eac ? custoPago / eac : 0,
    diasParaFim, duracaoPrevista, situacaoPrazo, lancamentos: meus,
  };
}

export interface ResumoServicos {
  servicos: ServicoCalc[];
  custoOrcado: number;
  precoVenda: number;
  custoComprometido: number;
  custoPago: number;
  etc: number;
  eac: number;
  execucaoFisica: number; // ponderada pelo custo orcado (ou preco de venda)
  atrasados: number;
  emRisco: number;
  concluidos: number;
}

export function resumoServicos(servicos: Servico[], lancs: LancamentoCalc[], dataBase: string): ResumoServicos {
  const calc = servicos.filter((s) => s.ativo).map((s) => calcServico(s, lancs, dataBase));
  const soma = (f: (s: ServicoCalc) => number) => calc.reduce((a, s) => a + f(s), 0);
  const pesoTotal = soma((s) => s.custoOrcado || s.precoVenda);
  return {
    servicos: calc,
    custoOrcado: soma((s) => s.custoOrcado),
    precoVenda: soma((s) => s.precoVenda),
    custoComprometido: soma((s) => s.custoComprometido),
    custoPago: soma((s) => s.custoPago),
    etc: soma((s) => s.etc),
    eac: soma((s) => s.eac),
    execucaoFisica: pesoTotal ? soma((s) => (s.custoOrcado || s.precoVenda) * s.pctExecucao) / pesoTotal : calc.length ? soma((s) => s.pctExecucao) / calc.length : 0,
    atrasados: calc.filter((s) => s.situacaoPrazo === 'Atrasado').length,
    emRisco: calc.filter((s) => s.situacaoPrazo === 'Em risco').length,
    concluidos: calc.filter((s) => s.status === 'Concluído').length,
  };
}

// ---------------------------------------------------------------------------
// Demandas (check-list diario, semanal, mensal)
// ---------------------------------------------------------------------------
/** Chave do periodo corrente de uma periodicidade, para marcar conclusao por periodo. */
export function chavePeriodo(p: Periodicidade, data: string): string {
  if (p === 'Diária') return data;
  if (p === 'Semanal') return segunda(data);
  if (p === 'Mensal') return `${data.slice(0, 7)}-01`;
  return 'unica';
}

export function inicioFimPeriodo(p: Periodicidade, data: string): { ini: string; fim: string } {
  if (p === 'Diária') return { ini: data, fim: data };
  if (p === 'Semanal') { const ini = segunda(data); return { ini, fim: addDays(ini, 6) }; }
  if (p === 'Mensal') { const ini = `${data.slice(0, 7)}-01`; const d = toDate(ini); return { ini, fim: fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) }; }
  return { ini: data, fim: data };
}

export type StatusDemanda = 'Concluída' | 'Pendente' | 'Atrasada';

export interface DemandaCalc extends Demanda {
  status: StatusDemanda;
  concluidaNoPeriodo: boolean;
  periodosDesdeCriacao: number;
  aderencia: number; // conclusoes / periodos decorridos (0-1)
  ultimaConclusao?: string;
  prazoPeriodo: string; // fim do periodo corrente ou prazo da demanda unica
}

export function calcDemanda(d: Demanda, dataBase: string): DemandaCalc {
  const { ini, fim } = inicioFimPeriodo(d.periodicidade, dataBase);
  const concluidaNoPeriodo = d.periodicidade === 'Única' ? d.conclusoes.length > 0 : d.conclusoes.some((c) => c >= ini && c <= fim);
  const criado = d.criadoEm.slice(0, 10);
  const diasDesde = Math.max(0, diffDays(dataBase, criado));
  const periodosDesdeCriacao = d.periodicidade === 'Diária' ? diasDesde + 1 : d.periodicidade === 'Semanal' ? Math.floor(diasDesde / 7) + 1 : d.periodicidade === 'Mensal' ? Math.floor(diasDesde / 30) + 1 : 1;
  const conclusoesValidas = d.conclusoes.filter((c) => c <= dataBase).length;
  let status: StatusDemanda;
  if (concluidaNoPeriodo) status = 'Concluída';
  else if (d.periodicidade === 'Única') status = d.prazo && d.prazo < dataBase ? 'Atrasada' : 'Pendente';
  else status = 'Pendente';
  return {
    ...d, status, concluidaNoPeriodo, periodosDesdeCriacao,
    aderencia: Math.min(1, conclusoesValidas / Math.max(1, periodosDesdeCriacao)),
    ultimaConclusao: [...d.conclusoes].sort().pop(),
    prazoPeriodo: d.periodicidade === 'Única' ? d.prazo ?? '' : fim,
  };
}

// ---------------------------------------------------------------------------
// Ordens de fabricacao e montagem
// ---------------------------------------------------------------------------
export type StatusOrdem = 'Não iniciada' | 'Em andamento' | 'Concluída' | 'Cancelada';

export interface OrdemCalc extends OrdemProducao {
  status: StatusOrdem;
  etapaAtual?: string;
  etapaAtualIdx: number;
  pctConcluido: number; // etapas concluidas / total
  atrasada: boolean;
  diasParaNecessidade?: number;
}

export function calcOrdem(o: OrdemProducao, dataBase: string): OrdemCalc {
  const n = o.etapas.length || 1;
  const concluidas = o.etapas.filter((e) => e.status === 'Concluída').length;
  const idx = o.etapas.findIndex((e) => e.status !== 'Concluída');
  const status: StatusOrdem = o.cancelada ? 'Cancelada' : concluidas === o.etapas.length ? 'Concluída' : concluidas > 0 || o.etapas.some((e) => e.status === 'Em andamento') ? 'Em andamento' : 'Não iniciada';
  const diasParaNecessidade = o.dataNecessidade ? diffDays(o.dataNecessidade, dataBase) : undefined;
  return {
    ...o, status, etapaAtual: idx >= 0 ? o.etapas[idx].nome : undefined, etapaAtualIdx: idx, pctConcluido: concluidas / n,
    atrasada: status !== 'Concluída' && status !== 'Cancelada' && diasParaNecessidade !== undefined && diasParaNecessidade < 0, diasParaNecessidade,
  };
}

export interface ResumoProducao {
  ordens: OrdemCalc[];
  porEtapa: { nome: string; quantidade: number; ordens: OrdemCalc[] }[];
  emAndamento: number;
  atrasadas: number;
  concluidas: number;
  quantidadeTotal: number;
  quantidadeConcluida: number;
}

export function resumoProducao(ordens: OrdemProducao[], tipo: TipoOrdem, dataBase: string, codigoObra?: string): ResumoProducao {
  const calc = ordens.filter((o) => o.tipo === tipo && !o.cancelada && (!codigoObra || o.codigoObra === codigoObra)).map((o) => calcOrdem(o, dataBase));
  const nomes = tipo === 'Fabricação' ? ETAPAS_FABRICACAO : ETAPAS_MONTAGEM;
  const porEtapa = [...nomes.map((nome) => ({ nome, quantidade: 0, ordens: [] as OrdemCalc[] })), { nome: 'Concluída', quantidade: 0, ordens: [] as OrdemCalc[] }];
  for (const o of calc) {
    const col = o.status === 'Concluída' ? porEtapa[porEtapa.length - 1] : porEtapa.find((c) => c.nome === o.etapaAtual) ?? porEtapa[0];
    col.ordens.push(o);
    col.quantidade += o.quantidade;
  }
  return {
    ordens: calc, porEtapa,
    emAndamento: calc.filter((o) => o.status === 'Em andamento').length,
    atrasadas: calc.filter((o) => o.atrasada).length,
    concluidas: calc.filter((o) => o.status === 'Concluída').length,
    quantidadeTotal: calc.reduce((a, o) => a + o.quantidade, 0),
    quantidadeConcluida: calc.filter((o) => o.status === 'Concluída').reduce((a, o) => a + o.quantidade, 0),
  };
}

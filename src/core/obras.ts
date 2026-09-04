// Operacao de obras: servicos (orcamento x prazo x custo), demandas em check-list e producao
// (linha de fabricacao / linha de montagem). Tudo calculado sobre a base unica de lancamentos,
// para que orcamento, compra, medicao e caixa compartilhem os mesmos codigos (Blueprint, secao 2).

import type { AvancoServico, Demanda, EtapaOrdem, Medicao, OrdemProducao, Periodicidade, Servico, TipoOrdem } from './types';
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
export const ETAPAS_FABRICACAO = ['Corte', 'Furação', 'Montagem e ponteamento', 'Solda', 'Pintura', 'Expedição'];
export const ETAPAS_MONTAGEM = ['Recebimento em obra', 'Pré-montagem', 'Içamento', 'Fixação / torqueamento', 'Liberação'];
/** Nomes de etapas de ordens antigas -> estacoes atuais (compatibilidade). */
export const ETAPA_LEGADA: Record<string, string> = { Detalhamento: 'Corte', 'Solda / conformação': 'Solda' };

export function etapasPadrao(tipo: TipoOrdem): EtapaOrdem[] {
  return (tipo === 'Fabricação' ? ETAPAS_FABRICACAO : ETAPAS_MONTAGEM).map((nome) => ({ nome, status: 'Pendente', quantidadeConcluida: 0 }));
}

// ---------------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------------
export type SituacaoPrazo = 'Concluído' | 'Atrasado' | 'Em risco' | 'No prazo' | 'Não iniciado' | 'Suspenso' | 'Sem prazo';

export const MARGEM_ALVO_PADRAO = 0.25;
export const PESO_FABRICACAO_PADRAO = 0.6; // fabricacao pesa 60% do avanco fisico de um servico de estrutura; montagem 40%

export interface ProducaoServico { fab?: number; mont?: number } // % concluido das ordens de fabricacao/montagem do servico

/** % concluido das ordens por servico, ponderado pela quantidade da ordem. */
export function producaoPorServico(ordens: OrdemProducao[], dataBase: string, codigoObra?: string): Map<string, ProducaoServico> {
  const m = new Map<string, ProducaoServico>();
  const acc = new Map<string, { fabQ: number; fabP: number; montQ: number; montP: number }>();
  for (const o of ordens) {
    if (!o.servicoId || o.cancelada || (codigoObra && o.codigoObra !== codigoObra)) continue;
    const c = calcOrdem(o, dataBase);
    const a = acc.get(o.servicoId) ?? { fabQ: 0, fabP: 0, montQ: 0, montP: 0 };
    const q = o.quantidade || 1;
    if (o.tipo === 'Fabricação') { a.fabQ += q; a.fabP += q * c.pctConcluido; } else { a.montQ += q; a.montP += q * c.pctConcluido; }
    acc.set(o.servicoId, a);
  }
  for (const [id, a] of acc) m.set(id, { fab: a.fabQ ? a.fabP / a.fabQ : undefined, mont: a.montQ ? a.montP / a.montQ : undefined });
  return m;
}

export interface ServicoCalc extends Servico {
  custoComprometido: number;
  custoPago: number;
  comprometidoAberto: number;
  custoPrevisto: number; // custo orcado informado, custo do orcamento executivo ou precoVenda x (1 - margem alvo)
  custoPrevistoDerivado: boolean;
  origemCustoPrevisto: 'Orçado' | 'Orçamento executivo' | 'Margem alvo';
  custoOrcamento: number; // custo direto dos itens do orcamento executivo vinculados ao servico
  comprometidoDireto: number; // compras com faturamento direto ao cliente (dentro do comprometido)
  pagoDireto: number;
  diretoPrevisto: number; // faturamento direto previsto para o servico (contrato)
  diretoSaldo: number;
  margemAlvoEfetiva: number;
  etc: number;
  etcDerivado: boolean;
  eac: number;
  margemProjetada: number;
  pctMargem: number;
  desvioOrcamento: number; // eac - custoPrevisto
  receitaPrevista: number;
  receitaRealizada: number;
  // medicoes do cronograma
  medicoes: MedicaoCalc[];
  faturado: number; // parte construtora liquida dos eventos medidos/faturados/recebidos
  aFaturar: number;
  pctFaturado: number; // faturado / precoVenda
  custoPrevistoProporcional: number; // custo previsto x % faturado
  desvioVsFaturado: number; // comprometido - custo previsto proporcional (>0 gastando acima do ritmo de faturamento)
  pctExecucao: number; // fabricacao x montagem ponderadas (kg ou ordens), medicoes de servico, quantidade executada ou % faturado
  origemExecucao: 'Fabricação e montagem (kg)' | 'Fabricação e montagem (ordens)' | 'Medição de serviço' | 'Quantidade' | 'Faturamento' | 'Concluído';
  pctFabricacao?: number; // avanco da fabricacao (kg fabricados ou ordens)
  pctMontagem?: number;
  pesoFabricacaoEfetivo: number; // peso da fabricacao no avanco (0-1)
  avancos: AvancoServico[]; // medicoes fisicas do servico, por data
  quantidadeMedida: number; // soma das medicoes
  pctMedido: number; // quantidadeMedida / quantidadeOrcada
  pesoTotal: number; // kg da lista de materiais vinculada ao servico
  pesoFabricado: number;
  pesoMontado: number;
  pctFinanceiro: number; // pago / eac
  diasParaFim?: number;
  duracaoPrevista?: number;
  situacaoPrazo: SituacaoPrazo;
  lancamentos: LancamentoCalc[];
}

export function calcServico(s: Servico, lancs: LancamentoCalc[], dataBase: string, medicoes: Medicao[] = [], margemAlvoObra = MARGEM_ALVO_PADRAO, custoOrcamento = 0, peso?: { pesoTotal: number; pesoFabricado: number; pesoMontado: number }, avancos: AvancoServico[] = [], producao?: ProducaoServico): ServicoCalc {
  const meus = lancs.filter((l) => l.servicoId === s.id && l.oficial);
  const custos = meus.filter((l) => l.tipo === 'Saída' && l.status !== 'Cancelado');
  const custoComprometido = custos.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const custoPago = custos.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const comprometidoAberto = Math.max(0, custoComprometido - custoPago);
  const margemAlvoEfetiva = s.margemAlvo ?? margemAlvoObra;
  const origemCustoPrevisto: ServicoCalc['origemCustoPrevisto'] = s.custoOrcado > 0 ? 'Orçado' : custoOrcamento > 0 ? 'Orçamento executivo' : 'Margem alvo';
  const custoPrevistoDerivado = origemCustoPrevisto === 'Margem alvo';
  const custoPrevisto = origemCustoPrevisto === 'Orçado' ? s.custoOrcado : origemCustoPrevisto === 'Orçamento executivo' ? custoOrcamento : s.precoVenda * (1 - margemAlvoEfetiva);
  const diretos = custos.filter((l) => l.direto);
  const comprometidoDireto = diretos.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const pagoDireto = diretos.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const diretoPrevisto = s.faturamentoDireto ?? 0;
  const etcDerivado = s.estimativaConcluir === undefined || s.estimativaConcluir === null;
  const etcInformado = etcDerivado ? Math.max(0, custoPrevisto - custoComprometido) : s.estimativaConcluir!;
  const etcNaoComprometido = etcDerivado ? etcInformado : Math.max(0, etcInformado - comprometidoAberto);
  const eac = s.status === 'Concluído' ? custoComprometido : custoPago + comprometidoAberto + etcNaoComprometido;
  const entradas = meus.filter((l) => l.tipo === 'Entrada' && l.status !== 'Cancelado');
  const receitaPrevista = entradas.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const receitaRealizada = entradas.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const meds = medicoes.filter((m) => m.servicoId === s.id && m.status !== 'Cancelado').map((m) => calcMedicao(m, dataBase));
  const faturado = meds.filter((m) => m.medida).reduce((a, m) => a + m.valorLiquidoConstrutora, 0);
  const totalMed = meds.reduce((a, m) => a + m.valorLiquidoConstrutora, 0);
  const pctFaturado = s.precoVenda > 0 ? Math.min(1, faturado / s.precoVenda) : totalMed > 0 ? faturado / totalMed : 0;
  // fisico, nesta ordem: fabricacao x montagem ponderadas pela lista de materiais (kg); pelas ordens de producao;
  // medicoes fisicas do servico; quantidade executada informada; senao acompanha o faturado do cronograma
  const temPeso = !!peso && peso.pesoTotal > 0;
  const temOrdens = !!producao && (producao.fab !== undefined || producao.mont !== undefined);
  const pesoFabricacaoEfetivo = Math.min(1, Math.max(0, s.pesoFabricacao ?? PESO_FABRICACAO_PADRAO));
  const pctFabricacao = temPeso ? Math.min(1, peso!.pesoFabricado / peso!.pesoTotal) : temOrdens ? producao!.fab : undefined;
  const pctMontagem = temPeso ? Math.min(1, peso!.pesoMontado / peso!.pesoTotal) : temOrdens ? producao!.mont : undefined;
  const boletins = [...avancos].sort((a, b) => (a.data < b.data ? -1 : 1));
  const quantidadeMedida = boletins.reduce((a, m) => a + m.quantidade, 0);
  const pctMedido = s.quantidadeOrcada > 0 ? Math.min(1, quantidadeMedida / s.quantidadeOrcada) : boletins.length ? Math.min(1, quantidadeMedida) : 0;
  const origemExecucao: ServicoCalc['origemExecucao'] = s.status === 'Concluído' ? 'Concluído' : temPeso ? 'Fabricação e montagem (kg)' : temOrdens ? 'Fabricação e montagem (ordens)' : boletins.length ? 'Medição de serviço' : s.quantidadeOrcada > 0 && s.quantidadeExecutada > 0 ? 'Quantidade' : 'Faturamento';
  const pctExecucao = origemExecucao === 'Concluído' ? 1
    : origemExecucao === 'Fabricação e montagem (kg)' || origemExecucao === 'Fabricação e montagem (ordens)' ? Math.min(1, pesoFabricacaoEfetivo * (pctFabricacao ?? 0) + (1 - pesoFabricacaoEfetivo) * (pctMontagem ?? 0))
    : origemExecucao === 'Medição de serviço' ? pctMedido
    : origemExecucao === 'Quantidade' ? Math.min(1, s.quantidadeExecutada / s.quantidadeOrcada) : pctFaturado;
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
  const custoPrevistoProporcional = custoPrevisto * pctFaturado;
  return {
    ...s,
    custoComprometido, custoPago, comprometidoAberto, custoPrevisto, custoPrevistoDerivado, origemCustoPrevisto, custoOrcamento, comprometidoDireto, pagoDireto, diretoPrevisto, diretoSaldo: diretoPrevisto - comprometidoDireto, margemAlvoEfetiva, etc: etcInformado, etcDerivado, eac,
    margemProjetada: s.precoVenda - eac, pctMargem: s.precoVenda ? (s.precoVenda - eac) / s.precoVenda : 0,
    desvioOrcamento: eac - custoPrevisto, receitaPrevista, receitaRealizada,
    medicoes: meds, faturado, aFaturar: Math.max(0, (s.precoVenda || totalMed) - faturado), pctFaturado, custoPrevistoProporcional,
    desvioVsFaturado: custoComprometido - custoPrevistoProporcional,
    pctExecucao, origemExecucao, pctFabricacao, pctMontagem, pesoFabricacaoEfetivo, avancos: boletins, quantidadeMedida, pctMedido, pesoTotal: peso?.pesoTotal ?? 0, pesoFabricado: peso?.pesoFabricado ?? 0, pesoMontado: peso?.pesoMontado ?? 0, pctFinanceiro: eac ? custoPago / eac : 0,
    diasParaFim, duracaoPrevista, situacaoPrazo, lancamentos: meus,
  };
}

// ---------------------------------------------------------------------------
// Medicoes / cronograma fisico-financeiro
// ---------------------------------------------------------------------------
export interface MedicaoCalc extends Medicao {
  retencaoConstrutora: number; // retencao proporcional a parte da construtora
  valorLiquidoConstrutora: number; // faturamentoConstrutora - retencao da construtora (recebivel da EIFF)
  medida: boolean; // Medido, Faturado ou Recebido
  atrasada: boolean; // prevista antes da data-base e ainda pendente
  diasParaPrevista?: number;
}

export function calcMedicao(m: Medicao, dataBase: string): MedicaoCalc {
  const pctRet = m.valorBruto > 0 ? m.retencao / m.valorBruto : 0;
  const retencaoConstrutora = m.faturamentoConstrutora * pctRet;
  const medida = m.status === 'Medido' || m.status === 'Faturado' || m.status === 'Recebido';
  return {
    ...m,
    retencaoConstrutora,
    valorLiquidoConstrutora: (m.valorMedido ?? m.faturamentoConstrutora) - (m.valorMedido !== undefined ? m.valorMedido * pctRet : retencaoConstrutora),
    medida,
    atrasada: m.status === 'Pendente' && !!m.dataPrevista && m.dataPrevista < dataBase,
    diasParaPrevista: m.dataPrevista ? diffDays(m.dataPrevista, dataBase) : undefined,
  };
}

export interface ResumoMedicoes {
  medicoes: MedicaoCalc[];
  valorBruto: number;
  faturamentoDireto: number;
  faturamentoConstrutora: number;
  retencaoConstrutora: number;
  liquidoConstrutora: number;
  faturado: number; // liquido construtora dos eventos medidos+
  aFaturar: number;
  pctFaturado: number;
  retencaoAcumulada: number; // retencao sobre o que ja foi medido (a receber no fim)
  pendentes: number;
  atrasadas: number;
  proximas: MedicaoCalc[]; // pendentes ordenadas por data prevista
  porMes: { mes: number; dataPrevista?: string; bruto: number; construtora: number; liquido: number; faturado: number }[];
}

export function resumoMedicoes(medicoes: Medicao[], dataBase: string, codigoObra?: string): ResumoMedicoes {
  const calc = medicoes.filter((m) => (!codigoObra || m.codigoObra === codigoObra) && m.status !== 'Cancelado').map((m) => calcMedicao(m, dataBase));
  const soma = (f: (m: MedicaoCalc) => number, filtro: (m: MedicaoCalc) => boolean = () => true) => calc.filter(filtro).reduce((a, m) => a + f(m), 0);
  const liquidoConstrutora = soma((m) => m.faturamentoConstrutora - m.retencaoConstrutora);
  const faturado = soma((m) => m.valorLiquidoConstrutora, (m) => m.medida);
  const meses = [...new Set(calc.map((m) => m.mes))].sort((a, b) => a - b);
  return {
    medicoes: calc,
    valorBruto: soma((m) => m.valorBruto),
    faturamentoDireto: soma((m) => m.faturamentoDireto),
    faturamentoConstrutora: soma((m) => m.faturamentoConstrutora),
    retencaoConstrutora: soma((m) => m.retencaoConstrutora),
    liquidoConstrutora,
    faturado,
    aFaturar: Math.max(0, liquidoConstrutora - faturado),
    pctFaturado: liquidoConstrutora ? faturado / liquidoConstrutora : 0,
    retencaoAcumulada: soma((m) => (m.valorMedido !== undefined ? m.valorMedido * (m.valorBruto ? m.retencao / m.valorBruto : 0) : m.retencaoConstrutora), (m) => m.medida),
    pendentes: calc.filter((m) => m.status === 'Pendente').length,
    atrasadas: calc.filter((m) => m.atrasada).length,
    proximas: calc.filter((m) => m.status === 'Pendente').sort((a, b) => ((a.dataPrevista ?? '9') < (b.dataPrevista ?? '9') ? -1 : 1)),
    porMes: meses.map((mes) => {
      const ms = calc.filter((m) => m.mes === mes);
      return { mes, dataPrevista: ms[0].dataPrevista, bruto: ms.reduce((a, m) => a + m.valorBruto, 0), construtora: ms.reduce((a, m) => a + m.faturamentoConstrutora, 0), liquido: ms.reduce((a, m) => a + m.faturamentoConstrutora - m.retencaoConstrutora, 0), faturado: ms.filter((m) => m.medida).reduce((a, m) => a + m.valorLiquidoConstrutora, 0) };
    }),
  };
}

export interface ResumoServicos {
  servicos: ServicoCalc[];
  custoOrcado: number;
  custoPrevisto: number;
  precoVenda: number;
  faturado: number;
  custoPrevistoProporcional: number;
  custoComprometido: number;
  custoPago: number;
  comprometidoDireto: number;
  custoOrcamento: number;
  etc: number;
  eac: number;
  execucaoFisica: number; // ponderada pelo custo orcado (ou preco de venda)
  atrasados: number;
  emRisco: number;
  concluidos: number;
}

export function resumoServicos(servicos: Servico[], lancs: LancamentoCalc[], dataBase: string, medicoes: Medicao[] = [], margemAlvo = MARGEM_ALVO_PADRAO, custoOrcamentoPorServico?: Map<string, number>, pesoPorServico?: Map<string, { pesoTotal: number; pesoFabricado: number; pesoMontado: number }>, avancos: AvancoServico[] = [], producaoPorSrv?: Map<string, ProducaoServico>): ResumoServicos {
  const calc = servicos.filter((s) => s.ativo).map((s) => calcServico(s, lancs, dataBase, medicoes, margemAlvo, custoOrcamentoPorServico?.get(s.id) ?? 0, pesoPorServico?.get(s.id), avancos.filter((a) => a.servicoId === s.id), producaoPorSrv?.get(s.id)));
  const soma = (f: (s: ServicoCalc) => number) => calc.reduce((a, s) => a + f(s), 0);
  const pesoTotal = soma((s) => s.custoOrcado || s.precoVenda);
  return {
    servicos: calc,
    custoOrcado: soma((s) => s.custoOrcado),
    custoPrevisto: soma((s) => s.custoPrevisto),
    precoVenda: soma((s) => s.precoVenda),
    faturado: soma((s) => s.faturado),
    custoPrevistoProporcional: soma((s) => s.custoPrevistoProporcional),
    custoComprometido: soma((s) => s.custoComprometido),
    custoPago: soma((s) => s.custoPago),
    comprometidoDireto: soma((s) => s.comprometidoDireto),
    custoOrcamento: soma((s) => s.custoOrcamento),
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
    const col = o.status === 'Concluída' ? porEtapa[porEtapa.length - 1] : porEtapa.find((c) => c.nome === (o.etapaAtual ? ETAPA_LEGADA[o.etapaAtual] ?? o.etapaAtual : '')) ?? porEtapa[0];
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

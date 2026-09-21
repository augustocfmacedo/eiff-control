// Acompanhamento de faturamento do contrato: o que foi contratado por etapa (cronograma de medicoes)
// contra o que ja foi faturado nas duas frentes - faturamento direto (o cliente paga o fornecedor)
// e faturamento da construtora (a EIFF fatura o cliente). Substitui a planilha
// ACOMPANHAMENTO_FATURAMENTO_*.xlsx: mesma leitura, sobre a base unica de lancamentos e medicoes.
//
// Regras (unica definicao):
// - Contratado por etapa vem das medicoes do cronograma (bruto, direto, construtora, retencao);
//   servico sem medicao cai no proprio cadastro (precoVenda + faturamentoDireto).
// - Faturado direto = lancamentos de saida da obra com faturamentoDireto; Rascunho conta como
//   estimativa (a nota ainda nao existe), o resto conta como faturado.
// - Faturado construtora = entradas da obra reconhecidas como faturamento: as que tem rateio por
//   servico ou as vinculadas a medicoes (measurement.lancamentoId). Receita apenas prevista,
//   sem rateio e sem medicao, nao e faturamento e fica de fora.
// - Cancelados e excluidos nunca entram.

import type { Lancamento, Medicao, PlanoConta, RateioFaturamento, Servico, TipoLancamento } from './types';

export type FrenteFaturamento = 'Direto' | 'Construtora';
export type SituacaoFaturamento = 'Faturado' | 'Estimativa';

/** Uma parcela de um titulo atribuida a uma etapa/servico do contrato. */
export interface ItemFaturamento {
  lancamentoId: string;
  servicoId?: string;
  etapa: string; // nome da etapa/servico (ou "Sem etapa")
  descricao: string;
  valor: number;
}

/** Nota (documento) de faturamento: agrupa as parcelas de um mesmo documento e frente. */
export interface NotaFaturamento {
  chave: string;
  frente: FrenteFaturamento;
  documento: string;
  data: string; // competencia (emissao)
  contraparte: string;
  situacao: SituacaoFaturamento;
  enviadoClienteEm?: string; // so faz sentido no faturamento direto
  valor: number;
  itens: ItemFaturamento[];
}

/** Linha do consolidado por etapa do contrato. */
export interface EtapaFaturamento {
  servicoId?: string;
  codigo: string;
  etapa: string;
  contratadoBruto: number;
  retencao: number;
  contratadoLiquido: number;
  previstoDireto: number;
  previstoConstrutora: number;
  faturadoDireto: number;
  faturadoConstrutora: number;
  faturadoTotal: number;
  estimativaDireto: number; // notas diretas ainda em rascunho (previsao de compra)
  saldoDireto: number;
  saldoConstrutora: number;
  saldo: number;
  pctFaturado: number; // 0-1 sobre o contratado bruto
  pctExecutado: number; // avanco fisico do servico (motor), 0-1
  diretoNaoEnviado: number; // faturado direto ainda nao repassado ao cliente
}

export interface AcompanhamentoFaturamento {
  etapas: EtapaFaturamento[];
  notas: NotaFaturamento[];
  totais: Omit<EtapaFaturamento, 'servicoId' | 'codigo' | 'etapa' | 'pctExecutado'> & { pctExecutado: number };
}

const SEM_ETAPA = 'Sem etapa';

const ativo = (l: Lancamento) => !l.excluidoEm && l.status !== 'Cancelado';

/** Parcelas de um titulo por servico: o rateio manda; sem rateio, o servico do proprio titulo. */
export function parcelasDoLancamento(l: Lancamento, rateios: RateioFaturamento[]): { servicoId?: string; descricao: string; valor: number }[] {
  const meus = rateios.filter((r) => r.lancamentoId === l.id);
  if (meus.length) return meus.map((r) => ({ servicoId: r.servicoId, descricao: r.descricao || l.descricao, valor: r.valor }));
  return [{ servicoId: l.servicoId, descricao: l.descricao, valor: l.valorBruto }];
}

/**
 * Entrada reconhecida como faturamento da construtora: tem rateio ou esta vinculada a medicoes.
 * Sem rateio, o valor do titulo e distribuido entre as medicoes vinculadas na proporcao da
 * parte da construtora de cada evento (determinístico; o rateio explicito sempre prevalece).
 */
function parcelasDaEntrada(l: Lancamento, rateios: RateioFaturamento[], medicoes: Medicao[]): { servicoId?: string; descricao: string; valor: number }[] | undefined {
  if (rateios.some((r) => r.lancamentoId === l.id)) return parcelasDoLancamento(l, rateios);
  const vinculadas = medicoes.filter((m) => m.lancamentoId === l.id && m.status !== 'Cancelado');
  if (!vinculadas.length) return undefined;
  const base = vinculadas.reduce((a, m) => a + (m.valorMedido ?? m.faturamentoConstrutora), 0);
  if (base <= 0) return vinculadas.map((m) => ({ servicoId: m.servicoId, descricao: `${m.numero} ${m.evento}`, valor: l.valorBruto / vinculadas.length }));
  return vinculadas.map((m) => ({
    servicoId: m.servicoId,
    descricao: `${m.numero} ${m.evento}`,
    valor: (l.valorBruto * (m.valorMedido ?? m.faturamentoConstrutora)) / base,
  }));
}

export interface ParamsFaturamento {
  codigoObra: string;
  servicos: Servico[];
  medicoes: Medicao[];
  lancamentos: Lancamento[];
  rateios: RateioFaturamento[];
  /** plano de contas: da o tipo (Entrada/Saida) de cada categoria, como no engine */
  planoContas: PlanoConta[];
  /** avanco fisico por servico (0-1), do motor (calcServico.pctExecucao) */
  execucaoPorServico?: Map<string, number>;
}

export function acompanhamentoFaturamento(p: ParamsFaturamento): AcompanhamentoFaturamento {
  const servicos = p.servicos.filter((s) => s.codigoObra === p.codigoObra && s.ativo);
  const medicoes = p.medicoes.filter((m) => m.codigoObra === p.codigoObra && m.status !== 'Cancelado');
  const lancs = p.lancamentos.filter((l) => l.codigoObra === p.codigoObra && ativo(l));
  const rateios = p.rateios.filter((r) => r.codigoObra === p.codigoObra);
  const tipoDe = new Map<string, TipoLancamento>(p.planoContas.map((c) => [c.categoria, c.tipo]));
  const tipo = (l: Lancamento) => tipoDe.get(l.categoria);

  const chave = (servicoId?: string) => servicoId ?? SEM_ETAPA;
  const linhas = new Map<string, EtapaFaturamento>();
  const nome = new Map(servicos.map((s) => [s.id, s.nome] as const));
  const codigo = new Map(servicos.map((s) => [s.id, s.codigo] as const));

  const linha = (servicoId?: string): EtapaFaturamento => {
    const k = chave(servicoId);
    let l = linhas.get(k);
    if (!l) {
      l = {
        servicoId, codigo: (servicoId && codigo.get(servicoId)) || '', etapa: (servicoId && nome.get(servicoId)) || SEM_ETAPA,
        contratadoBruto: 0, retencao: 0, contratadoLiquido: 0, previstoDireto: 0, previstoConstrutora: 0,
        faturadoDireto: 0, faturadoConstrutora: 0, faturadoTotal: 0, estimativaDireto: 0,
        saldoDireto: 0, saldoConstrutora: 0, saldo: 0, pctFaturado: 0, pctExecutado: 0, diretoNaoEnviado: 0,
      };
      linhas.set(k, l);
    }
    return l;
  };

  // contratado: cronograma de medicoes; servico sem medicao usa o proprio cadastro
  for (const s of servicos) if (!medicoes.some((m) => m.servicoId === s.id)) {
    const l = linha(s.id);
    l.previstoConstrutora += s.precoVenda;
    l.previstoDireto += s.faturamentoDireto ?? 0;
    l.contratadoBruto += s.precoVenda + (s.faturamentoDireto ?? 0);
  }
  for (const m of medicoes) {
    const l = linha(m.servicoId);
    l.contratadoBruto += m.valorBruto;
    l.retencao += m.retencao;
    l.previstoDireto += m.faturamentoDireto;
    l.previstoConstrutora += m.faturamentoConstrutora;
    if (!m.servicoId && l.etapa === SEM_ETAPA && m.etapa) l.etapa = m.etapa;
  }

  // faturado
  const notas: NotaFaturamento[] = [];
  const porNota = new Map<string, NotaFaturamento>();
  const registrar = (l: Lancamento, frente: FrenteFaturamento, situacao: SituacaoFaturamento, partes: { servicoId?: string; descricao: string; valor: number }[]) => {
    const doc = l.documento || l.id;
    const k = `${frente}|${doc}|${l.contraparte}`;
    let nota = porNota.get(k);
    if (!nota) {
      nota = { chave: k, frente, documento: l.documento || '—', data: l.competencia, contraparte: l.contraparte, situacao, enviadoClienteEm: l.enviadoClienteEm, valor: 0, itens: [] };
      porNota.set(k, nota);
      notas.push(nota);
    }
    if (situacao === 'Faturado') nota.situacao = 'Faturado';
    if (l.enviadoClienteEm && !nota.enviadoClienteEm) nota.enviadoClienteEm = l.enviadoClienteEm;
    if (l.competencia < nota.data) nota.data = l.competencia;
    for (const parte of partes) {
      const alvo = linha(parte.servicoId);
      nota.valor += parte.valor;
      nota.itens.push({ lancamentoId: l.id, servicoId: parte.servicoId, etapa: alvo.etapa, descricao: parte.descricao, valor: parte.valor });
      if (frente === 'Direto') {
        if (situacao === 'Estimativa') alvo.estimativaDireto += parte.valor;
        else {
          alvo.faturadoDireto += parte.valor;
          if (!l.enviadoClienteEm) alvo.diretoNaoEnviado += parte.valor;
        }
      } else if (situacao === 'Faturado') alvo.faturadoConstrutora += parte.valor;
    }
  };

  for (const l of lancs) {
    if (tipo(l) === 'Saída' && l.faturamentoDireto) {
      registrar(l, 'Direto', l.status === 'Rascunho' ? 'Estimativa' : 'Faturado', parcelasDoLancamento(l, rateios));
      continue;
    }
    if (tipo(l) === 'Entrada' && !l.faturamentoDireto) {
      const partes = parcelasDaEntrada(l, rateios, medicoes);
      if (partes) registrar(l, 'Construtora', l.status === 'Rascunho' ? 'Estimativa' : 'Faturado', partes);
    }
  }

  const etapas = [...linhas.values()];
  for (const l of etapas) {
    l.contratadoLiquido = l.contratadoBruto - l.retencao;
    l.faturadoTotal = l.faturadoDireto + l.faturadoConstrutora;
    l.saldoDireto = l.previstoDireto - l.faturadoDireto;
    l.saldoConstrutora = l.previstoConstrutora - l.faturadoConstrutora;
    l.saldo = l.contratadoBruto - l.faturadoTotal;
    l.pctFaturado = l.contratadoBruto > 0 ? l.faturadoTotal / l.contratadoBruto : 0;
    l.pctExecutado = (l.servicoId && p.execucaoPorServico?.get(l.servicoId)) || 0;
  }
  etapas.sort((a, b) => (a.codigo || 'zz').localeCompare(b.codigo || 'zz', 'pt-BR'));
  notas.sort((a, b) => (a.data === b.data ? a.documento.localeCompare(b.documento, 'pt-BR') : a.data < b.data ? -1 : 1));

  const soma = (f: (l: EtapaFaturamento) => number) => etapas.reduce((a, l) => a + f(l), 0);
  const contratadoBruto = soma((l) => l.contratadoBruto);
  const faturadoTotal = soma((l) => l.faturadoTotal);
  const totais = {
    contratadoBruto,
    retencao: soma((l) => l.retencao),
    contratadoLiquido: soma((l) => l.contratadoLiquido),
    previstoDireto: soma((l) => l.previstoDireto),
    previstoConstrutora: soma((l) => l.previstoConstrutora),
    faturadoDireto: soma((l) => l.faturadoDireto),
    faturadoConstrutora: soma((l) => l.faturadoConstrutora),
    faturadoTotal,
    estimativaDireto: soma((l) => l.estimativaDireto),
    saldoDireto: soma((l) => l.saldoDireto),
    saldoConstrutora: soma((l) => l.saldoConstrutora),
    saldo: contratadoBruto - faturadoTotal,
    pctFaturado: contratadoBruto > 0 ? faturadoTotal / contratadoBruto : 0,
    pctExecutado: contratadoBruto > 0 ? soma((l) => l.pctExecutado * l.contratadoBruto) / contratadoBruto : 0,
    diretoNaoEnviado: soma((l) => l.diretoNaoEnviado),
  };

  return { etapas, notas, totais };
}

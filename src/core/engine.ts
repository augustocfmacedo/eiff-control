// Motor de calculo do EIFF Control.
// Porta, regra a regra, as formulas da planilha Fluxo_de_Caixa_EIFF.xlsx (LANCAMENTOS, FLUXO 13S,
// FLUXO 24M, DRE GERENCIAL, OBRAS, DASHBOARD, CHECKS, CONCILIACAO) e as definicoes de indicadores
// do Blueprint Funcional v1 (secoes 5 e 11). Nenhum numero fica escondido: fatores, reserva e alcadas
// vem de Params.

import type {
  Aprovacao,
  Cenario,
  Dataset,
  Lancamento,
  Obra,
  Papel,
  Params,
  PlanoConta,
  Registro,
  TransacaoBancaria,
} from './types';
import { MARGEM_ALVO_PADRAO, calcDemanda, resumoMedicoes, resumoProducao, resumoServicos, type DemandaCalc, type ResumoMedicoes, type ResumoProducao, type ServicoCalc, producaoPorServico } from './obras';
import { custoOrcamentoPorServico } from './orcamentos';
import { avancoPorPeso, resumoPeso, type ResumoPeso } from './materiais';
import { consumoAco, type ConsumoAco } from './estoque';

// ---------------------------------------------------------------------------
// Datas (sempre em UTC para evitar deslocamento de fuso)
// ---------------------------------------------------------------------------
export const toDate = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const fmtIso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtIso(d);
};
export const addMonths = (s: string, n: number): string => {
  const d = toDate(s);
  return fmtIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
export const startOfMonth = (s: string): string => `${s.slice(0, 7)}-01`;
export const endOfMonth = (s: string): string => {
  const d = toDate(s);
  return fmtIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
export const diffDays = (a: string, b: string): number =>
  Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);
/** Chave AAAAMM usada pela DRE (LANCAMENTOS!AJ). */
export const mesChave = (s: string): number => Number(s.slice(0, 4)) * 100 + Number(s.slice(5, 7));
/** Segunda-feira da semana (LANCAMENTOS!AD): data - WEEKDAY(data,2) + 1. */
export const segundaDaSemana = (s: string): string => {
  const d = toDate(s);
  const wd = (d.getUTCDay() + 6) % 7; // 0 = segunda
  return addDays(s, -wd);
};
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/** Data de hoje no fuso local (yyyy-mm-dd). */
export const hojeLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Data-base efetiva: hoje quando automatica, senao a data fixa dos parametros. */
export const dataBaseEfetiva = (p: { dataBase: string; dataBaseAutomatica?: boolean }): string => (p.dataBaseAutomatica ? hojeLocal() : p.dataBase);

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const rotuloMes = (s: string): string => `${MESES[Number(s.slice(5, 7)) - 1]}/${s.slice(2, 4)}`;
export const rotuloDia = (s: string): string => `${s.slice(8, 10)}/${MESES[Number(s.slice(5, 7)) - 1]}`;
export const fmtBr = (s?: string): string => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');

// ---------------------------------------------------------------------------
// Inclusao no modelo (coluna "Incluir Modelo")
// ---------------------------------------------------------------------------
export const incluirRegistro = (registro: Registro, params: Params): boolean =>
  registro === 'Real' || (registro === 'Exemplo' && params.incluirDemo);

// ---------------------------------------------------------------------------
// Lancamento calculado (colunas D, E, F, X, Y, Z, AA, AB, AC, AD, AG, AH, AI, AJ)
// ---------------------------------------------------------------------------
export type Situacao =
  | 'Ignorado'
  | 'Rascunho'
  | 'Pendente de aprovação'
  | 'Cancelado'
  | 'Realizado'
  | 'Parcialmente liquidado'
  | 'Sem vencimento'
  | 'Atrasado'
  | 'Próximos 7 dias'
  | 'A vencer';

export interface LancamentoCalc extends Lancamento {
  tipo: string; // Entrada | Saída | NÃO CADASTRADO
  grupoFluxo: string;
  grupoDre: string;
  classe: string;
  valorLiquidoPrevisto: number;
  valorRealizadoTotal: number;
  saldoAberto: number;
  dataCaixa?: string;
  fatorCenario: number;
  valorCaixaProjetado: number;
  valorGerencial: number;
  mesCaixa?: string;
  semanaCaixa?: string;
  mesCompetencia: number;
  incluir: boolean; // registro Real ou Exemplo com demo ativo
  oficial: boolean; // incluir e fora de Rascunho/Pendente
  situacao: Situacao;
  diasAtraso: number;
  vinculoBancario: boolean; // existe transacao do extrato vinculada (fonte da verdade da conciliacao)
  direto: boolean; // faturamento direto ao cliente: fora do caixa e do DRE da EIFF, dentro do orcamento da obra
}

export function mapaPlano(ds: Dataset): Map<string, PlanoConta> {
  return new Map(ds.planoContas.map((p) => [p.categoria, p]));
}

export function calcLancamento(
  l: Lancamento,
  ds: Dataset,
  cenario: Cenario = ds.params.cenario,
  plano: Map<string, PlanoConta> = mapaPlano(ds),
): LancamentoCalc {
  const p = plano.get(l.categoria);
  const tipo = l.categoria ? (p ? p.tipo : 'NÃO CADASTRADO') : '';
  const liqs = ds.liquidacoes.filter((q) => q.lancamentoId === l.id);
  const valorRealizadoTotal = liqs.length ? liqs.reduce((a, q) => a + q.valor, 0) : l.valorRealizado ?? 0;
  const valorLiquidoPrevisto = tipo ? l.valorBruto - l.retencoes - l.desconto + l.multaJuros : 0;
  const dataCaixa = l.status === 'Realizado' ? l.realizacao ?? l.vencimento : l.vencimento;
  const f = ds.params.fatores[cenario];
  const fatorCenario = tipo === 'Entrada' ? f.entradas : f.saidas;
  const incluir = incluirRegistro(l.registro, ds.params);
  const oficial = incluir && l.status !== 'Rascunho' && l.status !== 'Pendente';
  const sinal = tipo === 'Entrada' ? 1 : -1;
  const direto = !!l.faturamentoDireto;

  let valorCaixaProjetado = 0;
  let valorGerencial = 0;
  if (oficial && !direto && l.status !== 'Cancelado' && dataCaixa && tipo && tipo !== 'NÃO CADASTRADO') {
    if (l.status === 'Realizado') {
      valorCaixaProjetado = sinal * valorRealizadoTotal;
      valorGerencial = sinal * valorRealizadoTotal;
    } else {
      const prob = l.probabilidade ?? 1;
      valorCaixaProjetado =
        tipo === 'Entrada' ? valorLiquidoPrevisto * prob * fatorCenario : -valorLiquidoPrevisto * fatorCenario;
      valorGerencial = sinal * valorLiquidoPrevisto;
    }
  }

  const db = ds.params.dataBase;
  let situacao: Situacao;
  if (!incluir) situacao = 'Ignorado';
  else if (l.status === 'Rascunho') situacao = 'Rascunho';
  else if (l.status === 'Pendente') situacao = 'Pendente de aprovação';
  else if (l.status === 'Cancelado') situacao = 'Cancelado';
  else if (l.status === 'Realizado') situacao = 'Realizado';
  else if (valorRealizadoTotal > 0 && valorRealizadoTotal < valorLiquidoPrevisto) situacao = 'Parcialmente liquidado';
  else if (!l.vencimento) situacao = 'Sem vencimento';
  else if (l.vencimento < db) situacao = 'Atrasado';
  else if (l.vencimento <= addDays(db, 7)) situacao = 'Próximos 7 dias';
  else situacao = 'A vencer';

  const diasAtraso = situacao === 'Atrasado' ? diffDays(db, l.vencimento) : 0;
  const saldoAberto =
    l.status === 'Cancelado' || l.status === 'Realizado' ? 0 : Math.max(0, valorLiquidoPrevisto - valorRealizadoTotal);

  return {
    ...l,
    tipo,
    grupoFluxo: p?.grupoFluxo ?? '',
    grupoDre: p?.grupoDre ?? '',
    classe: p?.classe ?? '',
    valorLiquidoPrevisto,
    valorRealizadoTotal,
    saldoAberto,
    dataCaixa,
    fatorCenario,
    valorCaixaProjetado,
    valorGerencial,
    mesCaixa: dataCaixa ? startOfMonth(dataCaixa) : undefined,
    semanaCaixa: dataCaixa ? segundaDaSemana(dataCaixa) : undefined,
    mesCompetencia: l.competencia ? mesChave(l.competencia) : 0,
    incluir,
    oficial,
    situacao,
    diasAtraso,
    vinculoBancario: ds.transacoes.some((t) => t.lancamentoIds.includes(l.id)),
    direto,
  };
}

export function calcLancamentos(ds: Dataset, cenario: Cenario = ds.params.cenario): LancamentoCalc[] {
  const plano = mapaPlano(ds);
  return ds.lancamentos.map((l) => calcLancamento(l, ds, cenario, plano));
}

// ---------------------------------------------------------------------------
// Saldo inicial consolidado (CONFIG!B13)
// ---------------------------------------------------------------------------
/** Data a partir da qual os movimentos da conta sao somados sobre o saldo de abertura. */
export const dataAbertura = (c: { saldoInicialData?: string }, ds: Dataset): string => c.saldoInicialData ?? ds.params.dataBase;

/**
 * Saldo inicial do fluxo na data-base: abertura de cada conta rolada pelos lancamentos realizados
 * entre a data de abertura e o dia anterior a data-base (roll-forward). Com data-base = data de abertura,
 * e o proprio saldo de abertura (CONFIG!B13).
 */
export function saldoInicial(ds: Dataset, lancs?: LancamentoCalc[]): number {
  const contas = ds.contas.filter((c) => c.ativa && incluirRegistro(c.registro, ds.params));
  const db = ds.params.dataBase;
  const precisaRolar = contas.some((c) => dataAbertura(c, ds) < db);
  const calc = precisaRolar ? lancs ?? calcLancamentos(ds) : [];
  return contas.reduce((a, c) => {
    const ini = dataAbertura(c, ds);
    const rolado = calc
      .filter((l) => l.oficial && l.status === 'Realizado' && l.contaFinanceira === c.instituicao && (l.dataCaixa ?? '') >= ini && (l.dataCaixa ?? '') < db)
      .reduce((s, l) => s + l.valorCaixaProjetado, 0);
    return a + c.saldoInicial + rolado;
  }, 0);
}

export function reservaVinculadaTotal(ds: Dataset): number {
  return ds.contas
    .filter((c) => c.ativa && incluirRegistro(c.registro, ds.params))
    .reduce((a, c) => a + c.reservaVinculada, 0);
}

// ---------------------------------------------------------------------------
// Posicao bancaria: saldo de abertura + movimentos do extrato (conciliados ou nao)
// ---------------------------------------------------------------------------
export interface PosicaoConta {
  conta: Dataset['contas'][number];
  saldoInicial: number;
  creditosBanco: number;
  debitosBanco: number;
  saldoBancario: number; // abertura + creditos - debitos do extrato desde a data-base
  realizadoLancamentos: number; // entradas - saidas realizadas nos lancamentos desde a data-base
  saldoLancamentos: number; // abertura + realizado por lancamentos
  naoLancado: number; // movimentos do extrato sem lancamento vinculado (explica a diferenca)
  transacoesPendentes: number;
  ultimaTransacao?: string;
}

export function posicaoBancaria(ds: Dataset, lancs: LancamentoCalc[] = calcLancamentos(ds)): PosicaoConta[] {
  return ds.contas
    .filter((c) => c.ativa && incluirRegistro(c.registro, ds.params))
    .map((c) => {
      const ini = dataAbertura(c, ds); // movimentos contam a partir da data do saldo de abertura, nao da data-base
      const trans = ds.transacoes.filter((t) => t.conta === c.instituicao && incluirRegistro(t.registro, ds.params) && t.data >= ini);
      const creditosBanco = trans.reduce((a, t) => a + t.credito, 0);
      const debitosBanco = trans.reduce((a, t) => a + t.debito, 0);
      const pend = trans.filter((t) => !t.lancamentoIds.length);
      const realizadoLancamentos = lancs
        .filter((l) => l.oficial && l.status === 'Realizado' && l.contaFinanceira === c.instituicao && (l.dataCaixa ?? '') >= ini)
        .reduce((a, l) => a + l.valorCaixaProjetado, 0);
      return {
        conta: c,
        saldoInicial: c.saldoInicial,
        creditosBanco,
        debitosBanco,
        saldoBancario: c.saldoInicial + creditosBanco - debitosBanco,
        realizadoLancamentos,
        saldoLancamentos: c.saldoInicial + realizadoLancamentos,
        naoLancado: pend.reduce((a, t) => a + t.credito - t.debito, 0),
        transacoesPendentes: pend.length,
        ultimaTransacao: trans.map((t) => t.data).sort().pop(),
      };
    });
}

// ---------------------------------------------------------------------------
// Fluxo de caixa por periodos (FLUXO 13S e FLUXO 24M)
// ---------------------------------------------------------------------------
export interface Periodo {
  ini: string;
  fim: string;
  rotulo: string;
}

export interface LinhaFluxo {
  nome: string;
  valores: number[];
  total: number;
}

export interface GrupoFluxo {
  nome: string;
  linhas: LinhaFluxo[];
  totais: number[];
  tipo: 'Entrada' | 'Saída';
}

export interface FluxoCaixa {
  periodos: Periodo[];
  saldoInicial: number;
  grupos: GrupoFluxo[];
  totalEntradas: number[];
  totalSaidas: number[];
  fluxoLiquido: number[];
  saldoFinal: number[];
  reservaMinima: number;
  excesso: number[];
  menorSaldo: number;
  necessidadeMaxima: number;
  cenario: Cenario;
}

export const SECOES_13S: { nome: string; grupos: string[]; tipo: 'Entrada' | 'Saída' }[] = [
  { nome: 'ENTRADAS', grupos: ['Receitas Operacionais', 'Outras Entradas', 'Financiamento e Capital'], tipo: 'Entrada' },
  { nome: 'CUSTOS DIRETOS DE OBRAS', grupos: ['Custos Diretos de Obras'], tipo: 'Saída' },
  {
    nome: 'DESPESAS OPERACIONAIS',
    grupos: ['Despesas com Pessoal', 'Despesas Administrativas', 'Despesas Comerciais', 'Despesas Operacionais'],
    tipo: 'Saída',
  },
  {
    nome: 'TRIBUTOS, DÍVIDA E INVESTIMENTOS',
    grupos: ['Tributos', 'Serviço da Dívida', 'Investimentos', 'Outras Saídas'],
    tipo: 'Saída',
  },
];

export function periodosSemanais(dataBase: string, semanas = 13): Periodo[] {
  return Array.from({ length: semanas }, (_, i) => {
    const ini = addDays(dataBase, i * 7);
    return { ini, fim: addDays(ini, 6), rotulo: `S${i + 1} | ${rotuloDia(ini)}` };
  });
}

export function periodosMensais(dataBase: string, meses = 24): Periodo[] {
  const base = startOfMonth(dataBase);
  return Array.from({ length: meses }, (_, i) => {
    const ini = addMonths(base, i);
    return { ini, fim: endOfMonth(ini), rotulo: rotuloMes(ini) };
  });
}

function montarFluxo(
  ds: Dataset,
  periodos: Periodo[],
  cenario: Cenario,
  chaveLinha: (l: LancamentoCalc) => string,
  linhasPorSecao: (secao: (typeof SECOES_13S)[number]) => string[],
  filtro?: (l: LancamentoCalc) => boolean,
): FluxoCaixa {
  const lancs = calcLancamentos(ds, cenario).filter((l) => l.oficial && l.dataCaixa && (!filtro || filtro(l)));
  const n = periodos.length;
  const grupos: GrupoFluxo[] = SECOES_13S.map((secao) => {
    const linhas: LinhaFluxo[] = linhasPorSecao(secao).map((nome) => {
      const valores = periodos.map((p) => {
        const soma = lancs
          .filter((l) => chaveLinha(l) === nome && l.dataCaixa! >= p.ini && l.dataCaixa! <= p.fim)
          .reduce((a, l) => a + l.valorCaixaProjetado, 0);
        return secao.tipo === 'Entrada' ? soma : -soma;
      });
      return { nome, valores, total: valores.reduce((a, b) => a + b, 0) };
    });
    const totais = Array.from({ length: n }, (_, i) => linhas.reduce((a, li) => a + li.valores[i], 0));
    return { nome: secao.nome, linhas, totais, tipo: secao.tipo };
  });
  const totalEntradas = Array.from({ length: n }, (_, i) =>
    grupos.filter((g) => g.tipo === 'Entrada').reduce((a, g) => a + g.totais[i], 0),
  );
  const totalSaidas = Array.from({ length: n }, (_, i) =>
    grupos.filter((g) => g.tipo === 'Saída').reduce((a, g) => a + g.totais[i], 0),
  );
  const fluxoLiquido = totalEntradas.map((e, i) => e - totalSaidas[i]);
  const si = saldoInicial(ds);
  const saldoFinal: number[] = [];
  fluxoLiquido.forEach((f, i) => saldoFinal.push((i === 0 ? si : saldoFinal[i - 1]) + f));
  const reservaMinima = ds.params.reservaMinima;
  const excesso = saldoFinal.map((s) => s - reservaMinima);
  const menorSaldo = Math.min(...saldoFinal);
  return {
    periodos,
    saldoInicial: si,
    grupos,
    totalEntradas,
    totalSaidas,
    fluxoLiquido,
    saldoFinal,
    reservaMinima,
    excesso,
    menorSaldo,
    necessidadeMaxima: Math.max(0, reservaMinima - menorSaldo),
    cenario,
  };
}

/** FLUXO 13S: linhas por categoria, semanas de 7 dias a partir da data-base. */
export function fluxo13Semanas(ds: Dataset, cenario: Cenario = ds.params.cenario, semanas = 13, filtro?: (l: LancamentoCalc) => boolean): FluxoCaixa {
  const porGrupo = (g: string) => ds.planoContas.filter((p) => p.grupoFluxo === g).map((p) => p.categoria);
  return montarFluxo(
    ds,
    periodosSemanais(ds.params.dataBase, semanas),
    cenario,
    (l) => l.categoria,
    (secao) => secao.grupos.flatMap(porGrupo),
    filtro,
  );
}

/** FLUXO 24M: linhas por grupo de fluxo, meses civis a partir do mes da data-base. */
export function fluxo24Meses(ds: Dataset, cenario: Cenario = ds.params.cenario, meses = 24, filtro?: (l: LancamentoCalc) => boolean): FluxoCaixa {
  return montarFluxo(
    ds,
    periodosMensais(ds.params.dataBase, meses),
    cenario,
    (l) => l.grupoFluxo,
    (secao) => secao.grupos,
    filtro,
  );
}

// ---------------------------------------------------------------------------
// DRE gerencial por competencia (DRE GERENCIAL)
// ---------------------------------------------------------------------------
export interface LinhaDre {
  nome: string;
  valores: number[];
  destaque?: 'total' | 'margem' | 'sub';
}

export interface Dre {
  periodos: Periodo[];
  linhas: LinhaDre[];
}

export function dreGerencial(ds: Dataset, meses = 24, filtro?: (l: LancamentoCalc) => boolean): Dre {
  const periodos = periodosMensais(ds.params.dataBase, meses);
  const lancs = calcLancamentos(ds).filter((l) => l.oficial && (!filtro || filtro(l)));
  const soma = (grupo: string, sinal: 1 | -1) =>
    periodos.map((p) => {
      const chave = mesChave(p.ini);
      return sinal * lancs.filter((l) => l.grupoDre === grupo && l.mesCompetencia === chave).reduce((a, l) => a + l.valorGerencial, 0);
    });
  const zip = (...arr: number[][]) => periodos.map((_, i) => arr.reduce((a, v) => a + v[i], 0));
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const ratio = (a: number[], b: number[]) => a.map((v, i) => (b[i] ? v / b[i] : 0));

  const receitaBruta = soma('Receita Operacional', 1);
  const deducoes = soma('Deduções da Receita', -1);
  const receitaLiquida = sub(receitaBruta, deducoes);
  const custos = soma('Custos Diretos', -1);
  const lucroBruto = sub(receitaLiquida, custos);
  const pessoal = soma('Despesas com Pessoal', -1);
  const adm = soma('Despesas Administrativas', -1);
  const com = soma('Despesas Comerciais', -1);
  const ope = soma('Despesas Operacionais', -1);
  const outrasDesp = soma('Outras Despesas', -1);
  const opex = zip(pessoal, adm, com, ope, outrasDesp);
  const ebitda = sub(lucroBruto, opex);
  const finan = soma('Resultado Financeiro', -1);
  const outrasRec = zip(soma('Outras Receitas', 1), soma('Outras Receitas Operacionais', 1));
  const tributos = soma('Tributos', -1);
  const resultado = periodos.map((_, i) => ebitda[i] - finan[i] + outrasRec[i] - tributos[i]);

  return {
    periodos,
    linhas: [
      { nome: 'RECEITA BRUTA', valores: receitaBruta, destaque: 'total' },
      { nome: '(-) Deduções da Receita', valores: deducoes },
      { nome: 'RECEITA LÍQUIDA', valores: receitaLiquida, destaque: 'total' },
      { nome: '(-) Custos Diretos', valores: custos },
      { nome: 'LUCRO BRUTO', valores: lucroBruto, destaque: 'total' },
      { nome: 'MARGEM BRUTA', valores: ratio(lucroBruto, receitaLiquida), destaque: 'margem' },
      { nome: '(-) Despesas com Pessoal', valores: pessoal },
      { nome: '(-) Despesas Administrativas', valores: adm },
      { nome: '(-) Despesas Comerciais', valores: com },
      { nome: '(-) Despesas Operacionais', valores: ope },
      { nome: '(-) Outras Despesas', valores: outrasDesp },
      { nome: 'TOTAL OPEX', valores: opex, destaque: 'sub' },
      { nome: 'EBITDA GERENCIAL', valores: ebitda, destaque: 'total' },
      { nome: 'MARGEM EBITDA', valores: ratio(ebitda, receitaLiquida), destaque: 'margem' },
      { nome: '(-) Resultado Financeiro', valores: finan },
      { nome: '(+) Outras Receitas', valores: outrasRec },
      { nome: '(-) Tributos Gerais', valores: tributos },
      { nome: 'RESULTADO OPERACIONAL GERENCIAL', valores: resultado, destaque: 'total' },
      { nome: 'MARGEM OPERACIONAL', valores: ratio(resultado, receitaLiquida), destaque: 'margem' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Obra 360 (OBRAS + Blueprint secao 5)
// ---------------------------------------------------------------------------
export interface Obra360 {
  obra: Obra;
  receitaTotal: number;
  margemBrutaOrcada: number;
  pctMargemOrcada: number;
  medidoFaturado: number;
  recebido: number;
  saldoAMedir: number;
  contasAReceber: number;
  backlog: number;
  custoOrcado: number;
  custoComprometido: number; // pedidos/titulos aprovados nao cancelados (custos diretos)
  custoPago: number;
  comprometidoAberto: number;
  etc: number; // estimativa a concluir informada (tudo que falta, contratado ou nao)
  etcNaoComprometido: number;
  eac: number; // pago + comprometido em aberto + ETC nao comprometido
  margemProjetada: number;
  pctMargemProjetada: number;
  caixaGerado: number;
  diasParaPrazo?: number;
  orcamentoDisponivel: number; // custo orcado (orcamento executivo quando ha) - comprometido
  custoOrcamentoExecutivo: number; // custo direto dos orcamentos contratados vinculados aos servicos
  custoComprometidoDireto: number; // compras com faturamento direto ao cliente (dentro do comprometido)
  custoPagoDireto: number;
  custoPagoEIFF: number; // pago pela EIFF (sem faturamento direto)
  faturamentoDiretoContratado: number; // parcela do contrato faturada direto pelo cliente (medicoes ou servicos)
  faturamentoDiretoUtilizado: number; // compras com faturamento direto ja lancadas
  faturamentoDiretoSaldo: number;
  incluir: boolean;
  ativa: boolean;
  entradas: LancamentoCalc[];
  saidas: LancamentoCalc[];
  // operacao (servicos, demandas, medicoes e producao)
  temServicos: boolean;
  execucaoFisica: number;
  custoPrevisto: number; // orcado informado ou derivado da margem alvo (soma dos servicos)
  margemAlvo: number;
  medicoes: ResumoMedicoes;
  servicos: ServicoCalc[];
  servicosAtrasados: number;
  servicosEmRisco: number;
  demandas: DemandaCalc[];
  demandasPendentes: number;
  demandasAtrasadas: number;
  fabricacao: ResumoProducao;
  montagem: ResumoProducao;
  peso: ResumoPeso; // lista de materiais em kg
  aco: ConsumoAco; // aco consumido do estoque (kg liquido de sobras e custo real)
}

export function obra360(ds: Dataset, obra: Obra, lancs: LancamentoCalc[] = calcLancamentos(ds)): Obra360 {
  const db = ds.params.dataBase;
  const da = lancs.filter((l) => l.codigoObra === obra.codigo && l.oficial);
  const entradas = da.filter((l) => l.tipo === 'Entrada');
  const saidas = da.filter((l) => l.tipo === 'Saída');
  const custosDiretos = saidas.filter((l) => l.grupoFluxo === 'Custos Diretos de Obras' && l.status !== 'Cancelado');
  const receitaTotal = obra.valorContrato + obra.aditivos;
  const recebido = entradas.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const custoComprometido = custosDiretos.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const custoPago = custosDiretos.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
  const comprometidoAberto = Math.max(0, custoComprometido - custoPago);
  const diretos = custosDiretos.filter((l) => l.direto);
  const custoComprometidoDireto = diretos.reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  const custoPagoDireto = diretos.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);

  // servicos: quando existem, sao a fonte detalhada de orcamento, ETC e avanco fisico; o orcamento executivo
  // contratado (itens vinculados aos servicos) e a fonte do custo previsto quando o servico nao tem custo orcado proprio
  const margemAlvo = obra.margemAlvo ?? MARGEM_ALVO_PADRAO;
  const medicoesObra = (ds.medicoes ?? []).filter((m) => m.codigoObra === obra.codigo);
  const custoExec = custoOrcamentoPorServico(ds, obra.codigo);
  const custoOrcamentoExecutivo = [...custoExec.values()].reduce((a, v) => a + v, 0);
  const conjuntosObra = (ds.conjuntos ?? []).filter((c) => c.codigoObra === obra.codigo);
  const rs = resumoServicos((ds.servicos ?? []).filter((s) => s.codigoObra === obra.codigo), da, db, medicoesObra, margemAlvo, custoExec, avancoPorPeso(conjuntosObra), (ds.avancos ?? []).filter((a) => a.codigoObra === obra.codigo), producaoPorServico(ds.ordens ?? [], db, obra.codigo));
  const temServicos = rs.servicos.length > 0;
  const custoOrcado = temServicos ? rs.custoPrevisto : obra.custoOrcado || custoOrcamentoExecutivo;
  const faturamentoDiretoContratado = medicoesObra.some((m) => m.status !== 'Cancelado' && m.faturamentoDireto > 0)
    ? medicoesObra.filter((m) => m.status !== 'Cancelado').reduce((a, m) => a + m.faturamentoDireto, 0)
    : rs.servicos.reduce((a, s) => a + (s.faturamentoDireto ?? 0), 0);
  let eac: number;
  let etc: number;
  let etcNaoComprometido: number;
  if (temServicos) {
    // custos diretos sem servico vinculado entram pelo pago + aberto
    const semServico = custosDiretos.filter((l) => !l.servicoId);
    const pagoSem = semServico.filter((l) => l.status === 'Realizado').reduce((a, l) => a + l.valorRealizadoTotal, 0);
    const abertoSem = Math.max(0, semServico.reduce((a, l) => a + l.valorLiquidoPrevisto, 0) - pagoSem);
    eac = rs.eac + pagoSem + abertoSem;
    etcNaoComprometido = Math.max(0, eac - custoPago - comprometidoAberto);
    etc = etcNaoComprometido + comprometidoAberto;
  } else {
    etc = obra.estimativaConcluir;
    etcNaoComprometido = Math.max(0, etc - comprometidoAberto);
    eac = custoPago + comprometidoAberto + etcNaoComprometido;
  }
  const margemProjetada = receitaTotal - eac;
  const ativa = obra.status !== 'Concluída' && obra.status !== 'Cancelada';
  const demandas = (ds.demandas ?? []).filter((d) => d.codigoObra === obra.codigo && d.ativo).map((d) => calcDemanda(d, db));
  return {
    obra,
    receitaTotal,
    margemBrutaOrcada: receitaTotal - custoOrcado,
    pctMargemOrcada: receitaTotal ? (receitaTotal - custoOrcado) / receitaTotal : 0,
    medidoFaturado: obra.medidoFaturado,
    recebido,
    saldoAMedir: Math.max(0, receitaTotal - obra.medidoFaturado),
    contasAReceber: Math.max(0, obra.medidoFaturado - recebido),
    backlog: Math.max(0, receitaTotal - obra.medidoFaturado),
    custoOrcado,
    custoComprometido,
    custoPago,
    comprometidoAberto,
    etc,
    etcNaoComprometido,
    eac,
    margemProjetada,
    pctMargemProjetada: receitaTotal ? margemProjetada / receitaTotal : 0,
    caixaGerado: recebido - (custoPago - custoPagoDireto),
    diasParaPrazo: obra.fimContratual && ativa ? diffDays(obra.fimContratual, db) : undefined,
    orcamentoDisponivel: custoOrcado - custoComprometido,
    custoOrcamentoExecutivo,
    custoComprometidoDireto,
    custoPagoDireto,
    custoPagoEIFF: custoPago - custoPagoDireto,
    faturamentoDiretoContratado,
    faturamentoDiretoUtilizado: custoComprometidoDireto,
    faturamentoDiretoSaldo: faturamentoDiretoContratado - custoComprometidoDireto,
    incluir: incluirRegistro(obra.registro, ds.params),
    ativa,
    entradas,
    saidas,
    temServicos,
    execucaoFisica: temServicos ? rs.execucaoFisica : obra.execucaoFisica,
    custoPrevisto: temServicos ? rs.custoPrevisto : obra.custoOrcado,
    margemAlvo,
    medicoes: resumoMedicoes(medicoesObra, db),
    servicos: rs.servicos,
    servicosAtrasados: rs.atrasados,
    servicosEmRisco: rs.emRisco,
    demandas,
    demandasPendentes: demandas.filter((d) => d.status === 'Pendente').length,
    demandasAtrasadas: demandas.filter((d) => d.status === 'Atrasada').length,
    fabricacao: resumoProducao(ds.ordens ?? [], 'Fabricação', db, obra.codigo),
    montagem: resumoProducao(ds.ordens ?? [], 'Montagem', db, obra.codigo),
    peso: resumoPeso(conjuntosObra),
    aco: consumoAco(ds, { codigoObra: obra.codigo }).total,
  };
}

export function carteiraObras(ds: Dataset): Obra360[] {
  const lancs = calcLancamentos(ds);
  return ds.obras.map((o) => obra360(ds, o, lancs)).filter((o) => o.incluir);
}

// ---------------------------------------------------------------------------
// Aging (Blueprint secao 11)
// ---------------------------------------------------------------------------
export interface FaixaAging {
  faixa: string;
  valor: number;
  quantidade: number;
}

export const FAIXAS_AGING = ['A vencer', '1-7 dias', '8-30 dias', '31-60 dias', '61-90 dias', '> 90 dias'];

export function aging(lancs: LancamentoCalc[], tipo: 'Entrada' | 'Saída'): FaixaAging[] {
  const faixas = FAIXAS_AGING.map((f) => ({ faixa: f, valor: 0, quantidade: 0 }));
  for (const l of lancs) {
    if (l.tipo !== tipo || !l.oficial || l.direto || l.status === 'Cancelado' || l.status === 'Realizado' || !l.vencimento) continue;
    const d = l.diasAtraso;
    const idx = d <= 0 ? 0 : d <= 7 ? 1 : d <= 30 ? 2 : d <= 60 ? 3 : d <= 90 ? 4 : 5;
    faixas[idx].valor += l.saldoAberto;
    faixas[idx].quantidade += 1;
  }
  return faixas;
}

// ---------------------------------------------------------------------------
// Conciliacao bancaria (CONCILIACAO + BAN-003/BAN-004)
// ---------------------------------------------------------------------------
export interface TransacaoCalc extends TransacaoBancaria {
  movimento: number;
  valorLancamentos: number;
  diferenca: number;
  status: 'Pendente' | 'Conciliado' | 'Divergente';
}

export function calcTransacoes(ds: Dataset, lancs: LancamentoCalc[] = calcLancamentos(ds)): TransacaoCalc[] {
  const tol = ds.params.alcadas.toleranciaConciliacao;
  const porId = new Map(lancs.map((l) => [l.id, l]));
  return ds.transacoes
    .filter((t) => incluirRegistro(t.registro, ds.params))
    .map((t) => {
      const movimento = t.credito - t.debito;
      const valorLancamentos = t.lancamentoIds.reduce((a, id) => a + (porId.get(id)?.valorCaixaProjetado ?? 0), 0);
      const diferenca = t.lancamentoIds.length ? movimento - valorLancamentos : 0;
      const status = !t.lancamentoIds.length ? 'Pendente' : Math.abs(diferenca) <= tol ? 'Conciliado' : 'Divergente';
      return { ...t, movimento, valorLancamentos, diferenca, status };
    });
}

export interface SugestaoConciliacao {
  lancamento: LancamentoCalc;
  score: number;
  criterios: string[];
}

/** Sugere lancamentos para uma transacao por valor, data, documento e contraparte (BAN-003). */
export function sugerirConciliacao(ds: Dataset, t: TransacaoBancaria, lancs: LancamentoCalc[] = calcLancamentos(ds)): SugestaoConciliacao[] {
  const movimento = t.credito - t.debito;
  const tipo = movimento >= 0 ? 'Entrada' : 'Saída';
  const tol = Math.max(ds.params.alcadas.toleranciaConciliacao, 0.01);
  const hist = (t.historico + ' ' + t.documento).toLowerCase();
  const out: SugestaoConciliacao[] = [];
  for (const l of lancs) {
    if (!l.oficial || l.tipo !== tipo || l.status === 'Cancelado' || l.conciliado) continue;
    const valorRef = l.status === 'Realizado' ? l.valorRealizadoTotal : l.valorLiquidoPrevisto;
    const criterios: string[] = [];
    let score = 0;
    const dv = Math.abs(Math.abs(movimento) - valorRef);
    if (dv <= tol) { score += 50; criterios.push('valor exato'); }
    else if (valorRef && dv / valorRef <= 0.02) { score += 30; criterios.push('valor aproximado'); }
    else continue;
    const dl = l.dataCaixa ? Math.abs(diffDays(t.data, l.dataCaixa)) : 99;
    if (dl === 0) { score += 25; criterios.push('mesma data'); }
    else if (dl <= 3) { score += 15; criterios.push('data ±3 dias'); }
    else if (dl <= 10) { score += 5; criterios.push('data ±10 dias'); }
    if (l.documento && hist.includes(l.documento.toLowerCase())) { score += 15; criterios.push('documento'); }
    const cp = l.contraparte.toLowerCase().split(' ')[0];
    if (cp && cp.length > 3 && hist.includes(cp)) { score += 10; criterios.push('contraparte'); }
    out.push({ lancamento: l, score, criterios });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Aprovacoes (Blueprint secao 8)
// ---------------------------------------------------------------------------
/** Etapas exigidas conforme valor, vinculo com obra e excecoes. */
export function etapasExigidas(params: Params, valor: number, temObra: boolean, excecao: boolean): Papel[] {
  const a = params.alcadas;
  const etapas: Papel[] = [];
  if (temObra) etapas.push('Gestor de obra');
  if (excecao || valor > a.limiteGestorObra || !temObra) etapas.push('Financeiro');
  if (excecao || valor > a.limiteFinanceiro || valor > a.limiteDiretoria) etapas.push('Diretoria');
  return etapas;
}

export function slaVencido(a: Aprovacao, agoraIso: string): boolean {
  return a.status === 'Pendente' && a.prazoSla < agoraIso;
}

// ---------------------------------------------------------------------------
// Checks e alertas (CHECKS)
// ---------------------------------------------------------------------------
export interface Check {
  id: string;
  nome: string;
  atual: number | string;
  esperado: number | string;
  tolerancia: number;
  status: 'OK' | 'FALHA' | 'ATENÇÃO';
  tipo: 'bloqueante' | 'alerta';
  onde: string;
  nota: string;
  ids?: string[];
}

export function executarChecks(ds: Dataset): Check[] {
  const lancs = calcLancamentos(ds);
  const ativos = lancs.filter((l) => l.incluir);
  const f13 = fluxo13Semanas(ds);
  const f24 = fluxo24Meses(ds);
  const trans = calcTransacoes(ds, lancs);
  const dup = new Map<string, number>();
  ds.lancamentos.forEach((l) => dup.set(l.id, (dup.get(l.id) ?? 0) + 1));
  const duplicados = [...dup.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const numCheck = (id: string, nome: string, ids: string[], onde: string, nota: string, tol = 0): Check => ({
    id, nome, atual: ids.length, esperado: 0, tolerancia: tol, status: ids.length <= tol ? 'OK' : 'FALHA', tipo: 'bloqueante', onde, nota, ids,
  });
  const roll13 = f13.saldoFinal[f13.saldoFinal.length - 1] - (f13.saldoInicial + f13.fluxoLiquido.reduce((a, b) => a + b, 0));
  const roll24 = f24.saldoFinal[f24.saldoFinal.length - 1] - (f24.saldoInicial + f24.fluxoLiquido.reduce((a, b) => a + b, 0));
  const agora = new Date().toISOString();
  const slaVenc = ds.aprovacoes.filter((a) => slaVencido(a, agora)).map((a) => a.id);
  const checks: Check[] = [
    {
      id: 'CHK-01', nome: 'Cenário selecionado é válido', atual: ds.params.cenario, esperado: 'Conservador | Base | Otimista', tolerancia: 0,
      status: ds.params.fatores[ds.params.cenario] ? 'OK' : 'FALHA', tipo: 'bloqueante', onde: 'Parâmetros', nota: 'Uma opção da tabela de cenários',
    },
    numCheck('CHK-02', 'Lançamentos ativos sem categoria', ativos.filter((l) => !l.categoria).map((l) => l.id), 'Lançamentos', 'Preencher categoria'),
    numCheck('CHK-03', 'Categorias não cadastradas', ativos.filter((l) => l.tipo === 'NÃO CADASTRADO').map((l) => l.id), 'Plano de contas / Lançamentos', 'Cadastrar ou corrigir'),
    numCheck('CHK-04', 'Lançamentos não cancelados sem vencimento', ativos.filter((l) => l.status !== 'Cancelado' && !l.vencimento).map((l) => l.id), 'Lançamentos', 'Informar vencimento'),
    numCheck('CHK-05', 'Realizados sem data de realização', ativos.filter((l) => l.status === 'Realizado' && !l.realizacao).map((l) => l.id), 'Lançamentos', 'Informar data'),
    numCheck('CHK-06', 'Realizados sem valor realizado', ativos.filter((l) => l.status === 'Realizado' && !l.valorRealizadoTotal).map((l) => l.id), 'Lançamentos', 'Informar valor ou liquidação'),
    numCheck('CHK-07', 'Valores brutos negativos', ativos.filter((l) => l.valorBruto < 0).map((l) => l.id), 'Lançamentos', 'Usar valores positivos; o sinal é automático'),
    numCheck('CHK-08', 'Probabilidades fora de 0%–100%', ativos.filter((l) => l.probabilidade < 0 || l.probabilidade > 1).map((l) => l.id), 'Lançamentos', 'Corrigir probabilidade'),
    { id: 'CHK-09', nome: 'Roll-forward do caixa de 13 semanas', atual: round2(roll13), esperado: 0, tolerancia: 0.01, status: Math.abs(roll13) <= 0.01 ? 'OK' : 'FALHA', tipo: 'bloqueante', onde: 'Fluxo 13S', nota: 'Saldo final = saldo inicial + soma dos fluxos' },
    { id: 'CHK-10', nome: 'Roll-forward do caixa de 24 meses', atual: round2(roll24), esperado: 0, tolerancia: 0.01, status: Math.abs(roll24) <= 0.01 ? 'OK' : 'FALHA', tipo: 'bloqueante', onde: 'Fluxo 24M', nota: 'Saldo final = saldo inicial + soma dos fluxos' },
    numCheck('CHK-11', 'Conciliações divergentes sem justificativa', trans.filter((t) => t.status === 'Divergente' && !t.justificativa).map((t) => t.id), 'Conciliação', 'Tratar divergências com responsável e justificativa'),
    numCheck('CHK-12', 'IDs de lançamentos duplicados', duplicados, 'Lançamentos', 'Manter um ID único'),
    numCheck('CHK-13', 'Custos/receitas diretas de obra sem Código Obra', ativos.filter((l) => (l.grupoFluxo === 'Custos Diretos de Obras' || l.grupoDre === 'Receita Operacional') && !l.codigoObra && l.status !== 'Cancelado').map((l) => l.id), 'Lançamentos', 'Vincular à obra'),
    numCheck('CHK-14', 'Obras referenciadas sem cadastro', ativos.filter((l) => l.codigoObra && !ds.obras.some((o) => o.codigo === l.codigoObra)).map((l) => l.id), 'Obras', 'Cadastrar obra'),
    // Alertas gerenciais (nao afetam o status do modelo)
    { id: 'ALT-01', nome: 'Dados demonstrativos ativos', atual: ds.params.incluirDemo ? 'Sim' : 'Não', esperado: 'Não', tolerancia: 0, status: ds.params.incluirDemo ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Parâmetros', nota: 'Desative ao iniciar a carga real' },
    { id: 'ALT-02', nome: 'Caixa mínimo abaixo da reserva (13 semanas)', atual: round2(f13.menorSaldo), esperado: ds.params.reservaMinima, tolerancia: 0, status: f13.menorSaldo >= ds.params.reservaMinima ? 'OK' : 'ATENÇÃO', tipo: 'alerta', onde: 'Fluxo 13S', nota: 'Avaliar cobrança, postergação, capital de giro ou redução de desembolsos' },
    { id: 'ALT-03', nome: 'Realizados sem conciliação bancária', atual: ativos.filter((l) => l.status === 'Realizado' && !l.vinculoBancario).length, esperado: 0, tolerancia: 0, status: ativos.some((l) => l.status === 'Realizado' && !l.vinculoBancario) ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Conciliação', nota: 'Conciliar com extrato', ids: ativos.filter((l) => l.status === 'Realizado' && !l.vinculoBancario).map((l) => l.id) },
    { id: 'ALT-04', nome: 'Aprovações com SLA vencido', atual: slaVenc.length, esperado: 0, tolerancia: 0, status: slaVenc.length ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Aprovações', nota: 'Lembrar, delegar ou escalar conforme política', ids: slaVenc },
    { id: 'ALT-05', nome: 'Obras com margem projetada negativa', atual: carteiraObras(ds).filter((o) => o.ativa && o.margemProjetada < 0).length, esperado: 0, tolerancia: 0, status: carteiraObras(ds).some((o) => o.ativa && o.margemProjetada < 0) ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Obras', nota: 'Reorçar e travar novos compromissos' },
    { id: 'ALT-06', nome: 'Estimativa a concluir não informada em obra ativa', atual: carteiraObras(ds).filter((o) => o.ativa && !o.etc && !o.custoComprometido).length, esperado: 0, tolerancia: 0, status: carteiraObras(ds).some((o) => o.ativa && !o.etc && !o.custoComprometido) ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Obras', nota: 'Sem ETC a margem projetada fica superestimada' },
  ];
  const carteira = carteiraObras(ds).filter((o) => o.ativa);
  const servAtras = carteira.reduce((a, o) => a + o.servicosAtrasados, 0);
  const demAtras = carteira.reduce((a, o) => a + o.demandasAtrasadas, 0);
  const ordAtras = carteira.reduce((a, o) => a + o.fabricacao.atrasadas + o.montagem.atrasadas, 0);
  checks.push(
    { id: 'ALT-07', nome: 'Serviços de obra com prazo vencido', atual: servAtras, esperado: 0, tolerancia: 0, status: servAtras ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Central de obras', nota: 'Replanejar prazo ou registrar conclusão' },
    { id: 'ALT-08', nome: 'Demandas únicas com prazo vencido', atual: demAtras, esperado: 0, tolerancia: 0, status: demAtras ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Central de obras', nota: 'Concluir ou reprogramar com o responsável' },
    { id: 'ALT-09', nome: 'Ordens de fabricação/montagem atrasadas', atual: ordAtras, esperado: 0, tolerancia: 0, status: ordAtras ? 'ATENÇÃO' : 'OK', tipo: 'alerta', onde: 'Central de obras', nota: 'Priorizar na linha ou renegociar data de necessidade' },
  );
  return checks;
}

export const statusModelo = (checks: Check[]): 'PASS' | 'FAIL' =>
  checks.some((c) => c.tipo === 'bloqueante' && c.status === 'FALHA') ? 'FAIL' : 'PASS';

// ---------------------------------------------------------------------------
// Painel executivo (DASHBOARD)
// ---------------------------------------------------------------------------
export interface Dashboard {
  saldoInicial: number;
  saldoDisponivel: number;
  saldoFinal13s: number;
  menorSaldo13s: number;
  necessidadeMaxima: number;
  entradas13s: number;
  saidas13s: number;
  backlog: number;
  saldoDevedor: number;
  servicoDividaMensal: number;
  obrasAtivas: number;
  receitaContratada: number;
  custoTotalProjetado: number;
  margemCarteira: number;
  recebiveisVencidos: number;
  pagamentosVencidos: number;
  realizadosSemConciliacao: number;
  obrasMargemNegativa: number;
  aprovacoesPendentes: number;
  aprovacoesSlaVencido: number;
  proximos7DiasEntradas: number;
  proximos7DiasSaidas: number;
  fluxo13: FluxoCaixa;
  agingReceber: FaixaAging[];
  agingPagar: FaixaAging[];
  checks: Check[];
  statusModelo: 'PASS' | 'FAIL';
}

export function dashboard(ds: Dataset): Dashboard {
  const lancs = calcLancamentos(ds);
  const f13 = fluxo13Semanas(ds);
  const carteira = carteiraObras(ds);
  const ativas = carteira.filter((o) => o.ativa);
  const receitaContratada = carteira.reduce((a, o) => a + o.receitaTotal, 0);
  const recebido = carteira.reduce((a, o) => a + o.recebido, 0);
  const dividas = ds.dividas.filter((d) => incluirRegistro(d.registro, ds.params) && d.status === 'Ativa');
  const agora = new Date().toISOString();
  const checks = executarChecks(ds);
  const somaSit = (tipo: string, sit: Situacao) =>
    lancs.filter((l) => l.tipo === tipo && l.situacao === sit && l.oficial && !l.direto).reduce((a, l) => a + l.valorLiquidoPrevisto, 0);
  return {
    saldoInicial: f13.saldoInicial,
    saldoDisponivel: f13.saldoInicial - reservaVinculadaTotal(ds),
    saldoFinal13s: f13.saldoFinal[f13.saldoFinal.length - 1],
    menorSaldo13s: f13.menorSaldo,
    necessidadeMaxima: f13.necessidadeMaxima,
    entradas13s: f13.totalEntradas.reduce((a, b) => a + b, 0),
    saidas13s: f13.totalSaidas.reduce((a, b) => a + b, 0),
    backlog: receitaContratada - recebido,
    saldoDevedor: dividas.reduce((a, d) => a + d.saldoDevedor, 0),
    servicoDividaMensal: dividas.reduce((a, d) => a + d.parcelaMensal, 0),
    obrasAtivas: ativas.length,
    receitaContratada,
    custoTotalProjetado: carteira.reduce((a, o) => a + o.eac, 0),
    margemCarteira: receitaContratada ? carteira.reduce((a, o) => a + o.margemProjetada, 0) / receitaContratada : 0,
    recebiveisVencidos: somaSit('Entrada', 'Atrasado'),
    pagamentosVencidos: somaSit('Saída', 'Atrasado'),
    realizadosSemConciliacao: lancs.filter((l) => l.oficial && l.status === 'Realizado' && !l.vinculoBancario).length,
    obrasMargemNegativa: ativas.filter((o) => o.margemProjetada < 0).length,
    aprovacoesPendentes: ds.aprovacoes.filter((a) => a.status === 'Pendente').length,
    aprovacoesSlaVencido: ds.aprovacoes.filter((a) => slaVencido(a, agora)).length,
    proximos7DiasEntradas: somaSit('Entrada', 'Próximos 7 dias'),
    proximos7DiasSaidas: somaSit('Saída', 'Próximos 7 dias'),
    fluxo13: f13,
    agingReceber: aging(lancs, 'Entrada'),
    agingPagar: aging(lancs, 'Saída'),
    checks,
    statusModelo: statusModelo(checks),
  };
}

// ---------------------------------------------------------------------------
// Simulacao de impacto (aprovacao com evidencia)
// ---------------------------------------------------------------------------
export function impactoLancamento(ds: Dataset, novo: Lancamento) {
  const antes = fluxo13Semanas(ds);
  const simulado: Dataset = { ...ds, lancamentos: [...ds.lancamentos.filter((l) => l.id !== novo.id), { ...novo, status: novo.status === 'Pendente' || novo.status === 'Rascunho' ? 'Aprovado' : novo.status }] };
  const depois = fluxo13Semanas(simulado);
  const obra = novo.codigoObra ? ds.obras.find((o) => o.codigo === novo.codigoObra) : undefined;
  const o360Antes = obra ? obra360(ds, obra) : undefined;
  const o360Depois = obra ? obra360(simulado, obra) : undefined;
  return {
    saldoMinimo13sAntes: antes.menorSaldo,
    saldoMinimo13sDepois: depois.menorSaldo,
    // excecao quando o compromisso leva (ou aprofunda) o menor saldo abaixo da reserva minima
    abaixoDaReserva: depois.menorSaldo < ds.params.reservaMinima && depois.menorSaldo < antes.menorSaldo - 0.005,
    orcamentoDisponivel: o360Depois?.orcamentoDisponivel,
    comprometidoObra: o360Depois?.custoComprometido,
    eacObra: o360Depois?.eac,
    margemProjetadaObra: o360Depois?.margemProjetada,
    foraDoOrcamento: !!(o360Depois && o360Antes && obra && o360Antes.custoOrcado > 0 && o360Depois.custoComprometido > o360Antes.custoOrcado * (1 + ds.params.alcadas.desvioOrcamentoPermitido)),
  };
}

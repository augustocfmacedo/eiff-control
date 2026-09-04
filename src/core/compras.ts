// Suprimentos: pedidos de compra ligados a obra, ao servico e ao catalogo de insumos. O pedido emitido vira um
// lancamento previsto (comprometido) na base unica; o recebimento atualiza o preco do insumo no catalogo;
// o comparativo orcado x comprado confronta a explosao de insumos do orcamento executivo com o que foi pedido.

import type { Dataset, Insumo, Lancamento, PedidoCompra, ItemPedido } from './types';
import { calcOrcamento } from './orcamentos';

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);

export interface ItemPedidoCalc extends ItemPedido {
  total: number;
  totalRecebido: number;
  saldoReceber: number;
  insumo?: Insumo;
  precoCatalogo?: number;
  desvioPreco?: number; // precoUnitario / precoCatalogo - 1
}

export interface PedidoCalc extends PedidoCompra {
  itens: ItemPedidoCalc[];
  total: number;
  totalRecebido: number;
  pctRecebido: number;
  atrasado: boolean; // previsao de entrega vencida sem recebimento total
  diasParaEntrega?: number;
  lancamento?: Lancamento;
  ativo: boolean; // emitido ou recebido (nao rascunho/cancelado): conta no comprometido
}

export function calcPedido(p: PedidoCompra, ds: Pick<Dataset, 'insumos' | 'lancamentos'>, dataBase: string): PedidoCalc {
  const insumos = new Map(ds.insumos.map((i) => [i.id, i]));
  const itens: ItemPedidoCalc[] = p.itens.map((it) => {
    const insumo = it.insumoId ? insumos.get(it.insumoId) : undefined;
    const precoCatalogo = insumo && insumo.preco > 0 ? insumo.preco : undefined;
    return {
      ...it, total: it.quantidade * it.precoUnitario, totalRecebido: Math.min(it.quantidadeRecebida, it.quantidade) * it.precoUnitario,
      saldoReceber: Math.max(0, it.quantidade - it.quantidadeRecebida), insumo, precoCatalogo,
      desvioPreco: precoCatalogo ? it.precoUnitario / precoCatalogo - 1 : undefined,
    };
  });
  const total = itens.reduce((a, i) => a + i.total, 0);
  const totalRecebido = itens.reduce((a, i) => a + i.totalRecebido, 0);
  const ativo = p.status !== 'Rascunho' && p.status !== 'Cancelado';
  const diasParaEntrega = p.previsaoEntrega ? diffDays(p.previsaoEntrega, dataBase) : undefined;
  return {
    ...p, itens, total, totalRecebido, pctRecebido: total ? totalRecebido / total : 0,
    atrasado: ativo && p.status !== 'Recebido' && diasParaEntrega !== undefined && diasParaEntrega < 0, diasParaEntrega,
    lancamento: p.lancamentoId ? ds.lancamentos.find((l) => l.id === p.lancamentoId) : undefined, ativo,
  };
}

export interface ResumoCompras {
  pedidos: PedidoCalc[];
  emitido: number; // valor dos pedidos ativos
  recebido: number;
  aReceber: number;
  direto: number; // pedidos ativos com faturamento direto ao cliente
  rascunhos: number;
  atrasados: number;
  aguardandoAprovacao: number; // pedidos cujo lancamento esta Pendente
}

export function resumoCompras(ds: Dataset, codigoObra?: string): ResumoCompras {
  const pedidos = (ds.pedidos ?? []).filter((p) => !codigoObra || p.codigoObra === codigoObra).map((p) => calcPedido(p, ds, ds.params.dataBase));
  const ativos = pedidos.filter((p) => p.ativo);
  const emitido = ativos.reduce((a, p) => a + p.total, 0);
  const recebido = ativos.reduce((a, p) => a + p.totalRecebido, 0);
  return {
    pedidos, emitido, recebido, aReceber: emitido - recebido,
    direto: ativos.filter((p) => p.faturamentoDireto).reduce((a, p) => a + p.total, 0),
    rascunhos: pedidos.filter((p) => p.status === 'Rascunho').length,
    atrasados: pedidos.filter((p) => p.atrasado).length,
    aguardandoAprovacao: ativos.filter((p) => p.lancamento?.status === 'Pendente').length,
  };
}

// ---------------------------------------------------------------------------
// Orcado x comprado por insumo (curva ABC do orcamento executivo x pedidos)
// ---------------------------------------------------------------------------
export interface LinhaComparativo {
  insumoId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  tipo?: Insumo['tipo'];
  orcadoQtd: number;
  orcadoPreco: number;
  orcadoValor: number;
  compradoQtd: number;
  compradoValor: number;
  precoMedio: number;
  pctComprado: number; // compradoQtd / orcadoQtd
  desvioPreco: number; // precoMedio / orcadoPreco - 1
  desvioValor: number; // compradoValor - orcadoValor x pctComprado (gasto acima do ritmo orcado)
  classe?: 'A' | 'B' | 'C';
}

export interface Comparativo {
  linhas: LinhaComparativo[];
  orcadoValor: number;
  compradoValor: number;
  compradoForaOrcamento: number; // pedidos de insumos que nao estao no orcamento (ou sem insumo)
  pctComprado: number;
}

export function comparativoOrcadoComprado(ds: Dataset, codigoObra: string): Comparativo {
  const orcado = new Map<string, LinhaComparativo>();
  for (const o of (ds.orcamentos ?? []).filter((x) => x.status === 'Contratado' && x.codigoObra === codigoObra)) {
    for (const c of calcOrcamento(o, ds).curvaInsumos) {
      const l = orcado.get(c.id) ?? { insumoId: c.id, codigo: c.codigo, descricao: c.descricao, unidade: c.unidade, tipo: c.tipo, orcadoQtd: 0, orcadoPreco: c.precoUnitario, orcadoValor: 0, compradoQtd: 0, compradoValor: 0, precoMedio: 0, pctComprado: 0, desvioPreco: 0, desvioValor: 0, classe: c.classe };
      l.orcadoQtd += c.quantidade; l.orcadoValor += c.valor;
      orcado.set(c.id, l);
    }
  }
  let compradoForaOrcamento = 0;
  const insumos = new Map(ds.insumos.map((i) => [i.id, i]));
  for (const p of (ds.pedidos ?? []).filter((x) => x.codigoObra === codigoObra && x.status !== 'Rascunho' && x.status !== 'Cancelado')) {
    for (const it of p.itens) {
      const valor = it.quantidade * it.precoUnitario;
      const l = it.insumoId ? orcado.get(it.insumoId) : undefined;
      if (!l) {
        const i = it.insumoId ? insumos.get(it.insumoId) : undefined;
        if (i) {
          // insumo do catalogo que nao estava no orcamento: entra como linha sem orcado
          orcado.set(i.id, { insumoId: i.id, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, tipo: i.tipo, orcadoQtd: 0, orcadoPreco: i.preco, orcadoValor: 0, compradoQtd: it.quantidade, compradoValor: valor, precoMedio: it.precoUnitario, pctComprado: 0, desvioPreco: 0, desvioValor: valor });
        } else compradoForaOrcamento += valor; // item livre, sem insumo do catalogo
        continue;
      }
      l.compradoQtd += it.quantidade; l.compradoValor += valor;
    }
  }
  const linhas = [...orcado.values()].map((l) => {
    const precoMedio = l.compradoQtd ? l.compradoValor / l.compradoQtd : 0;
    const pctComprado = l.orcadoQtd ? l.compradoQtd / l.orcadoQtd : 0;
    return { ...l, precoMedio, pctComprado, desvioPreco: precoMedio && l.orcadoPreco ? precoMedio / l.orcadoPreco - 1 : 0, desvioValor: l.compradoValor - l.orcadoValor * Math.min(1, pctComprado) };
  }).sort((a, b) => b.orcadoValor - a.orcadoValor || b.compradoValor - a.compradoValor);
  const orcadoValor = linhas.reduce((a, l) => a + l.orcadoValor, 0);
  const compradoValor = linhas.reduce((a, l) => a + l.compradoValor, 0) + compradoForaOrcamento;
  return { linhas, orcadoValor, compradoValor, compradoForaOrcamento, pctComprado: orcadoValor ? compradoValor / orcadoValor : 0 };
}

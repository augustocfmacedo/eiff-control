// Pagamentos no modo celular (pedido do Augusto em 14/10/2026): lista enxuta das contas a pagar para o Administrador filtrar,
// selecionar e pagar (liquidar), editar e anexar documentos pelo celular. LEITURA do motor (calcLancamentos): saídas da EIFF,
// sem faturamento direto, cancelados nem excluídos. As ações continuam sendo as do store (liquidar, salvarLancamento,
// anexarDocumento): aqui só a lista, os filtros e os totais.
import type { Dataset } from './types';
import { addDays, calcLancamentos, round2, type LancamentoCalc } from './engine';
import { anexosDe } from './anexos';

export type FiltroPagamentosCampo = 'atrasados' | 'hoje' | 'semana' | 'abertos' | 'aprovacao' | 'pagos' | 'sem_comprovante';
export const FILTROS_PAGAMENTOS_CAMPO: { id: FiltroPagamentosCampo; rotulo: string }[] = [
  { id: 'atrasados', rotulo: 'Atrasados' },
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'semana', rotulo: '7 dias' },
  { id: 'abertos', rotulo: 'Todos a pagar' },
  { id: 'aprovacao', rotulo: 'Aguardando decisão' },
  { id: 'pagos', rotulo: 'Pagos' },
  { id: 'sem_comprovante', rotulo: 'Sem comprovante' },
];
/** dias para trás que a lista de pagos mostra */
export const DIAS_PAGOS_CAMPO = 30;

export interface PagamentoCampo {
  l: LancamentoCalc;
  valor: number; // o que falta pagar (em aberto) ou o pago (realizado)
  vencimento: string;
  atrasado: boolean;
  diasAtraso: number;
  pagavel: boolean; // dá para liquidar agora (aprovado/programado, com saldo)
  motivoNaoPagavel?: string;
  comprovante: boolean;
  documentos: number;
}

const ehPagamento = (l: LancamentoCalc) => l.tipo === 'Saída' && l.incluir && !l.direto && !l.excluidoEm && l.status !== 'Cancelado';
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function item(ds: Dataset, l: LancamentoCalc, hoje: string): PagamentoCampo {
  const docs = anexosDe(ds, l.id);
  const aberto = l.status !== 'Realizado';
  const vencimento = l.vencimento || hoje;
  const motivoNaoPagavel = !aberto ? 'já pago' : l.status === 'Rascunho' ? 'rascunho: decida na Central do Diretor' : l.status === 'Pendente' ? 'aguardando aprovação' : !(l.saldoAberto > 0) ? 'nada a pagar' : undefined;
  return {
    l, valor: round2(aberto ? l.saldoAberto || l.valorLiquidoPrevisto : l.valorRealizadoTotal), vencimento,
    atrasado: aberto && vencimento < hoje, diasAtraso: aberto ? Math.max(0, l.diasAtraso) : 0,
    pagavel: !motivoNaoPagavel, motivoNaoPagavel, comprovante: docs.some((a) => a.tipo === 'COMPROVANTE'), documentos: docs.length,
  };
}

/** Lista filtrada e ordenada: em aberto pelo vencimento (o mais antigo antes), pagos do mais recente para o mais antigo. */
export function pagamentosCampo(ds: Dataset, filtro: FiltroPagamentosCampo, busca = '', hoje = ds.params.dataBase): PagamentoCampo[] {
  const fimSemana = addDays(hoje, 6);
  const limitePagos = addDays(hoje, -DIAS_PAGOS_CAMPO);
  const todos = calcLancamentos(ds).filter(ehPagamento).map((l) => item(ds, l, hoje));
  const q = normalizar(busca.trim());
  const casa = (p: PagamentoCampo) => !q || normalizar(`${p.l.id} ${p.l.descricao} ${p.l.contraparte} ${p.l.codigoObra} ${p.l.categoria}`).includes(q);
  const aberto = (p: PagamentoCampo) => p.l.status !== 'Realizado';
  const decidido = (p: PagamentoCampo) => p.l.status !== 'Rascunho' && p.l.status !== 'Pendente';
  const filtrar: Record<FiltroPagamentosCampo, (p: PagamentoCampo) => boolean> = {
    atrasados: (p) => aberto(p) && decidido(p) && p.atrasado,
    hoje: (p) => aberto(p) && decidido(p) && p.vencimento <= hoje,
    semana: (p) => aberto(p) && decidido(p) && p.vencimento <= fimSemana,
    abertos: (p) => aberto(p) && decidido(p),
    aprovacao: (p) => p.l.status === 'Rascunho' || p.l.status === 'Pendente',
    pagos: (p) => !aberto(p) && (p.l.realizacao ?? p.vencimento) >= limitePagos,
    sem_comprovante: (p) => !aberto(p) && !p.comprovante && (p.l.realizacao ?? p.vencimento) >= limitePagos,
  };
  const lista = todos.filter((p) => filtrar[filtro](p) && casa(p));
  const pagos = filtro === 'pagos' || filtro === 'sem_comprovante';
  return lista.sort((a, b) => (pagos ? (b.l.realizacao ?? '').localeCompare(a.l.realizacao ?? '') : a.vencimento.localeCompare(b.vencimento)) || b.valor - a.valor || a.l.id.localeCompare(b.l.id));
}

/** Contagem por filtro (para os chips) e os totais do topo. */
export function resumoPagamentosCampo(ds: Dataset, hoje = ds.params.dataBase) {
  const contagem = Object.fromEntries(FILTROS_PAGAMENTOS_CAMPO.map((f) => [f.id, pagamentosCampo(ds, f.id, '', hoje).length])) as Record<FiltroPagamentosCampo, number>;
  const soma = (f: FiltroPagamentosCampo) => round2(pagamentosCampo(ds, f, '', hoje).reduce((a, p) => a + p.valor, 0));
  const pagosHoje = pagamentosCampo(ds, 'pagos', '', hoje).filter((p) => p.l.realizacao === hoje);
  return {
    contagem,
    atrasados: soma('atrasados'),
    ateHoje: soma('hoje'),
    semana: soma('semana'),
    pagosHoje: { quantidade: pagosHoje.length, valor: round2(pagosHoje.reduce((a, p) => a + p.valor, 0)) },
  };
}

/** Selecionados que dá para pagar agora e o total; os demais com o motivo. */
export function selecaoPagavel(itens: PagamentoCampo[], ids: Set<string>) {
  const sel = itens.filter((p) => ids.has(p.l.id));
  const pagaveis = sel.filter((p) => p.pagavel);
  return { pagaveis, bloqueados: sel.filter((p) => !p.pagavel), total: round2(pagaveis.reduce((a, p) => a + p.valor, 0)) };
}

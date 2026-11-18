// Widgets do iPad — visão "pagamentos": os pagamentos do dia com a situação de cada um e o somatório (pedido do Augusto em
// 14/10/2026). É LEITURA do livroCaixa (a mesma lista da tela Caixa): pago hoje, a pagar hoje, atrasado (vencido e não pago,
// que conta no caixa de hoje) e em aprovação com vencimento até hoje. Rascunho (pedido ao Diretor ainda não decidido) e
// faturamento direto ao cliente não entram, como na Caixa. Nada é recalculado nem gravado aqui. Mesma porta e mesmo token
// do widget do caixa (/api/widget-caixa?visao=pagamentos), que exige ver o caixa.
import type { Dataset } from './types';
import { calcLancamentos, round2 } from './engine';
import { livroCaixa, type LinhaCaixa } from './caixa';

export const VERSAO_PAGAMENTOS_WIDGET = 1;
export const MAX_ITENS_PAGAMENTOS_WIDGET = 14;

export type StatusPagamentoWidget = 'atrasado' | 'a_pagar' | 'aprovacao' | 'pago';
export interface PagamentoWidget {
  id: string; descricao: string; para: string; departamento: string;
  valor: number; vencimento: string; status: StatusPagamentoWidget;
  diasAtraso: number; // só no atrasado
}
export interface ResumoWidgetPagamentos {
  versao: typeof VERSAO_PAGAMENTOS_WIDGET;
  visao: 'pagamentos';
  geradoEm: string;
  hoje: string;
  itens: PagamentoWidget[]; // atrasados, a pagar, em aprovação e pagos (a lista pode ter sido cortada)
  quantidade: Record<StatusPagamentoWidget, number>;
  valor: Record<StatusPagamentoWidget, number>;
  /** o que sai do caixa hoje: pago + a pagar + atrasado (em aprovação fica fora, como na Caixa) */
  total: number;
  /** a pagar + atrasado */
  falta: number;
  /** de 0 a 1: pago ÷ total (1 quando não há nada no dia) */
  progresso: number;
  caixaHoje: number; // o "Saldo hoje" da Caixa (os pagos de hoje já saíram)
  caixaAposPagar: number; // caixa de hoje menos o que falta pagar hoje
  minimo: number;
  abaixoDoMinimo: boolean; // depois de pagar o que falta
}

const curto = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const ORDEM: Record<StatusPagamentoWidget, number> = { atrasado: 0, a_pagar: 1, aprovacao: 2, pago: 3 };

/** Situação da linha da Caixa no widget de pagamentos do dia; null = não é pagamento de hoje. */
export function statusDoDia(x: LinhaCaixa, hoje: string): StatusPagamentoWidget | null {
  if (x.tipo !== 'Saída') return null;
  if (x.situacao === 'Pago') return x.data === hoje ? 'pago' : null;
  if (x.situacao === 'Vencido') return 'atrasado';
  if (x.situacao === 'Previsto') return x.data === hoje ? 'a_pagar' : null;
  if (x.situacao === 'Em aprovação') return x.data <= hoje ? 'aprovacao' : null;
  return null; // Rascunho e a linha de ajuste do extrato
}

/** Monta a visão de pagamentos do dia a partir do dataset JÁ com a data-base de hoje (o servidor ajusta para São Paulo). */
export function resumoWidgetPagamentos(ds: Dataset, geradoEm: Date): ResumoWidgetPagamentos {
  const hoje = ds.params.dataBase;
  const lv = livroCaixa(ds, hoje, calcLancamentos(ds), { verBancos: true });
  const todos: PagamentoWidget[] = [];
  for (const x of lv.linhas) {
    const status = statusDoDia(x, hoje);
    if (!status) continue;
    todos.push({
      id: x.chave, descricao: curto(x.descricao || x.contraparte || '(sem descrição)'), para: curto(x.contraparte || '', 30), departamento: x.departamento,
      valor: round2(x.sai), vencimento: x.data, status, diasAtraso: status === 'atrasado' ? Math.max(0, diasEntre(x.data, hoje)) : 0,
    });
  }
  // o que ainda exige ação primeiro (atrasado, a pagar, aprovação); dentro de cada grupo, o maior valor antes
  todos.sort((a, b) => ORDEM[a.status] - ORDEM[b.status] || b.valor - a.valor || a.id.localeCompare(b.id));
  const quantidade: Record<StatusPagamentoWidget, number> = { atrasado: 0, a_pagar: 0, aprovacao: 0, pago: 0 };
  const soma: Record<StatusPagamentoWidget, number> = { atrasado: 0, a_pagar: 0, aprovacao: 0, pago: 0 };
  for (const p of todos) { quantidade[p.status] += 1; soma[p.status] += p.valor; }
  const valor = { atrasado: round2(soma.atrasado), a_pagar: round2(soma.a_pagar), aprovacao: round2(soma.aprovacao), pago: round2(soma.pago) };
  const falta = round2(valor.atrasado + valor.a_pagar);
  const total = round2(falta + valor.pago);
  const caixaAposPagar = round2(lv.saldoHoje - falta);
  return {
    versao: VERSAO_PAGAMENTOS_WIDGET,
    visao: 'pagamentos',
    geradoEm: geradoEm.toISOString(),
    hoje,
    itens: todos.slice(0, MAX_ITENS_PAGAMENTOS_WIDGET),
    quantidade, valor, total, falta,
    progresso: total > 0 ? Math.min(1, Math.round((valor.pago / total) * 1000) / 1000) : 1,
    caixaHoje: lv.saldoHoje,
    caixaAposPagar,
    minimo: lv.reserva,
    abaixoDoMinimo: caixaAposPagar < lv.reserva,
  };
}

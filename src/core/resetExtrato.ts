// Reset do extrato bancário (FIN-RESET): o que acontece com cada transação, conciliação, liquidação e lançamento quando
// o extrato é limpo para ser reimportado do zero. Função pura; a mesma regra roda no banco em fin_reset_extrato (0061).
//
// Dois tipos de lançamento nunca se confundem:
//   * título pré-existente (contas a pagar/receber cadastrado por gente, pedido, medição, planilha…) que só foi conciliado
//     com a transação: perde a conciliação e volta para a fila; valor, status, liquidações e natureza ficam como estão;
//   * lançamento GERADO do extrato ("Lançar a partir da transação": origem ofx/extrato, nasce Realizado, liquidado e
//     conciliado): existe por causa da linha do banco. Se a linha sai, ele não pode continuar no caixa nem na DRE —
//     a liquidação é estornada e o título é cancelado e excluído logicamente (nada é apagado).
// Lançamento gerado do extrato ligado a pedido, medição, rateio de faturamento, aprovação pendente ou período fechado
// é exceção: o reset não decide por ninguém, para e mostra.
import type { Dataset, Lancamento, Liquidacao, TransacaoBancaria } from './types';

export const ORIGENS_DO_EXTRATO = ['ofx', 'extrato'] as const;

export const geradoDoExtrato = (l: Pick<Lancamento, 'origem'>): boolean => (ORIGENS_DO_EXTRATO as readonly string[]).includes(l.origem);

export interface ExcecaoReset {
  lancamentoId: string;
  motivo: string;
}

export interface PlanoResetExtrato {
  conta: string | undefined;
  /** transações ativas que serão descartadas */
  transacoes: TransacaoBancaria[];
  /** vínculos transação → lançamento que serão desfeitos */
  conciliacoes: number;
  /** gerados do extrato: liquidação estornada, título cancelado e excluído */
  derivados: Lancamento[];
  liquidacoesDerivadas: Liquidacao[];
  /** títulos pré-existentes que só perdem a conciliação */
  preexistentes: Lancamento[];
  /** o que o reset não toca sem decisão humana */
  excecoes: ExcecaoReset[];
  /** derivados com integridade estranha (ex.: Realizado sem liquidação): entram no reset, mas ficam registrados */
  anomalias: ExcecaoReset[];
}

const ativo = (l: Lancamento) => l.status !== 'Cancelado' && !l.excluidoEm;

/**
 * Classifica o que o reset do extrato faria (de uma conta ou de todas).
 * Um lançamento gerado do extrato pertence ao reset quando está conciliado a uma das transações alvo ou quando o seu
 * identificador externo é o de uma delas (uuid da linha, ou o FITID dos lançamentos antigos). No reset de todas as
 * contas, gerado do extrato ativo sem transação alvo correspondente é exceção: não se sabe de qual linha ele veio.
 */
export function planejarResetExtrato(ds: Dataset, conta?: string): PlanoResetExtrato {
  const transacoes = ds.transacoes.filter((t) => !t.descartadaEm && (!conta || t.conta === conta));
  const ligados = new Set<string>();
  let conciliacoes = 0;
  for (const t of transacoes) for (const id of t.lancamentoIds) { ligados.add(id); conciliacoes++; }
  const chaves = new Set<string>();
  for (const t of transacoes) { chaves.add(`${t.conta}|${t.id}`); if (t.idExterno) chaves.add(`${t.conta}|${t.idExterno}`); }
  const doAlvo = (l: Lancamento) => ligados.has(l.id) || (!!l.idExterno && chaves.has(`${l.contaFinanceira}|${l.idExterno}`));

  const derivados: Lancamento[] = [];
  const preexistentes: Lancamento[] = [];
  const excecoes: ExcecaoReset[] = [];
  const anomalias: ExcecaoReset[] = [];
  for (const l of ds.lancamentos) {
    if (geradoDoExtrato(l) && ativo(l)) {
      if (!doAlvo(l)) {
        if (!conta) excecoes.push({ lancamentoId: l.id, motivo: 'gerado do extrato sem transação ativa correspondente' });
        continue;
      }
      const vinculo = ds.pedidos.some((p) => p.lancamentoId === l.id) ? 'pedido de compra'
        : ds.medicoes.some((m) => m.lancamentoId === l.id) ? 'medição'
          : ds.rateios.some((r) => r.lancamentoId === l.id) ? 'rateio de faturamento'
            : ds.aprovacoes.some((a) => a.entidadeId === l.id && a.status === 'Pendente') ? 'aprovação pendente'
              : ds.fechamentos.some((f) => f.periodo === l.competencia.slice(0, 7) && !f.reaberto) ? 'período fechado'
                : null;
      if (vinculo) { excecoes.push({ lancamentoId: l.id, motivo: `gerado do extrato ligado a ${vinculo}` }); continue; }
      const liquidado = ds.liquidacoes.some((q) => q.lancamentoId === l.id);
      if (l.status === 'Realizado' && !liquidado) anomalias.push({ lancamentoId: l.id, motivo: 'Realizado sem liquidação registrada' });
      derivados.push(l);
    } else if (ligados.has(l.id) && !geradoDoExtrato(l)) {
      preexistentes.push(l);
    }
  }
  const ids = new Set(derivados.map((l) => l.id));
  return {
    conta,
    transacoes,
    conciliacoes,
    derivados,
    liquidacoesDerivadas: ds.liquidacoes.filter((q) => ids.has(q.lancamentoId)),
    preexistentes,
    excecoes,
    anomalias,
  };
}

// Extratos importados: histórico dos lotes de importação e revinculação de transações à conta certa.
//
// O movimento bancário é fato e nunca é apagado. O que se corrige é a CONTA em que a linha entrou:
// - mover: a transação passa para a conta certa e guarda de onde veio;
// - descartar: quando a MESMA linha (mesmo identificador do banco) já existe na conta de destino,
//   a cópia da conta errada é descartada logicamente e sai do caixa e da conciliação.
// Conciliação segue a transação: ao descartar uma duplicata conciliada, os vínculos passam para a
// gêmea da conta certa se ela ainda não tiver nenhum; senão a transferência é recusada e o usuário decide.

import type { ContaFinanceira, TransacaoBancaria } from './types';

/** Um lote de importação: o que entrou de uma vez numa conta (mesmo minuto). */
export interface LoteImportacao {
  chave: string;
  conta: string;
  importadoEm?: string;
  quantidade: number;
  de: string;
  ate: string;
  creditos: number;
  debitos: number;
  movimento: number;
  comIdentificador: number;
  conciliadas: number;
  descartadas: number;
  movidas: number;
  origem: string; // ofx | importacao | manual
  /** conta sugerida quando as linhas deste lote parecem ser de outra conta (mesmo identificador lá) */
  contaProvavel?: string;
}

const minuto = (iso?: string) => (iso ? iso.slice(0, 16) : '');

/**
 * Agrupa as transações em lotes de importação (conta + momento). Sem `importadoEm` — dado antigo —
 * o lote é o da própria conta e origem, para o histórico nunca esconder movimento.
 */
export function lotesDeImportacao(transacoes: TransacaoBancaria[], contas: ContaFinanceira[] = []): LoteImportacao[] {
  const porConta = new Map<string, Map<string, TransacaoBancaria[]>>();
  for (const t of transacoes) {
    const chave = `${t.conta}|${minuto(t.importadoEm) || t.origem}`;
    const m = porConta.get(t.conta) ?? new Map<string, TransacaoBancaria[]>();
    m.set(chave, [...(m.get(chave) ?? []), t]);
    porConta.set(t.conta, m);
  }
  const identificadoresPorConta = new Map<string, Set<string>>();
  for (const t of transacoes) if (t.idExterno && !t.descartadaEm) {
    const s = identificadoresPorConta.get(t.conta) ?? new Set<string>();
    s.add(t.idExterno);
    identificadoresPorConta.set(t.conta, s);
  }

  const lotes: LoteImportacao[] = [];
  for (const [conta, grupos] of porConta) for (const [chave, itens] of grupos) {
    const datas = itens.map((t) => t.data).sort();
    const creditos = itens.reduce((a, t) => a + t.credito, 0);
    const debitos = itens.reduce((a, t) => a + t.debito, 0);
    // se os identificadores deste lote também existem em outra conta, o extrato provavelmente é de lá
    const ativos = itens.filter((t) => !t.descartadaEm);
    const outras = new Map<string, number>();
    for (const t of ativos) if (t.idExterno) for (const [c, ids] of identificadoresPorConta) {
      if (c !== conta && ids.has(t.idExterno)) outras.set(c, (outras.get(c) ?? 0) + 1);
    }
    const provavel = ativos.length ? [...outras.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
    lotes.push({
      chave, conta, importadoEm: itens.find((t) => t.importadoEm)?.importadoEm,
      quantidade: itens.length, de: datas[0], ate: datas[datas.length - 1],
      creditos: Math.round(creditos * 100) / 100, debitos: Math.round(debitos * 100) / 100,
      movimento: Math.round((creditos - debitos) * 100) / 100,
      comIdentificador: itens.filter((t) => t.idExterno).length,
      conciliadas: itens.filter((t) => t.lancamentoIds.length > 0).length,
      descartadas: itens.filter((t) => t.descartadaEm).length,
      movidas: itens.filter((t) => t.contaOrigem).length,
      origem: itens[0].origem,
      contaProvavel: provavel && provavel[1] >= Math.ceil(ativos.length / 2) ? provavel[0] : undefined,
    });
  }
  const ordem = new Map(contas.map((c, i) => [c.instituicao, i] as const));
  return lotes.sort((a, b) => (b.importadoEm ?? '').localeCompare(a.importadoEm ?? '') || (ordem.get(a.conta) ?? 0) - (ordem.get(b.conta) ?? 0));
}

export type AcaoMovimentacao = 'mover' | 'descartar_duplicata' | 'ja_na_conta' | 'descartada';

export interface ItemMovimentacao {
  transacao: TransacaoBancaria;
  acao: AcaoMovimentacao;
  gemeaId?: string; // transação equivalente na conta de destino (mesma identidade do banco)
  transfereConciliacao?: boolean; // a gêmea assume os vínculos desta
  motivo: string;
}

export interface PlanoMovimentacao {
  contaDestino: string;
  itens: ItemMovimentacao[];
  mover: number;
  descartar: number;
  semEfeito: number;
  movimentoQueSai: number; // efeito no caixa da conta de origem
  movimentoQueEntra: number; // efeito no caixa da conta de destino (descartadas não entram)
  conciliacoesTransferidas: number;
  conciliacoesPerdidas: number;
}

/** Decide, para cada transação escolhida, o que acontece ao levá-la para a conta de destino. */
export function planejarMovimentacao(transacoes: TransacaoBancaria[], ids: string[], contaDestino: string): PlanoMovimentacao {
  const escolhidas = ids.map((id) => transacoes.find((t) => t.id === id)).filter((t): t is TransacaoBancaria => !!t);
  const noDestino = transacoes.filter((t) => t.conta === contaDestino && !t.descartadaEm);
  const itens: ItemMovimentacao[] = escolhidas.map((t) => {
    if (t.descartadaEm) return { transacao: t, acao: 'descartada', motivo: 'já descartada' };
    if (t.conta === contaDestino) return { transacao: t, acao: 'ja_na_conta', motivo: 'já está nesta conta' };
    const gemea = t.idExterno ? noDestino.find((x) => x.idExterno === t.idExterno) : undefined;
    if (gemea) {
      const transfere = t.lancamentoIds.length > 0 && gemea.lancamentoIds.length === 0;
      return {
        transacao: t, acao: 'descartar_duplicata', gemeaId: gemea.id, transfereConciliacao: transfere,
        motivo: t.lancamentoIds.length === 0 ? 'já existe na conta de destino' : transfere ? 'já existe na conta de destino; a conciliação passa para ela' : 'já existe na conta de destino, e a de lá já está conciliada',
      };
    }
    return { transacao: t, acao: 'mover', motivo: 'vai para a conta de destino' };
  });
  const soma = (f: (i: ItemMovimentacao) => boolean) => itens.filter(f).reduce((a, i) => a + i.transacao.credito - i.transacao.debito, 0);
  const efetivas = (i: ItemMovimentacao) => i.acao === 'mover' || i.acao === 'descartar_duplicata';
  return {
    contaDestino, itens,
    mover: itens.filter((i) => i.acao === 'mover').length,
    descartar: itens.filter((i) => i.acao === 'descartar_duplicata').length,
    semEfeito: itens.filter((i) => i.acao === 'ja_na_conta' || i.acao === 'descartada').length,
    movimentoQueSai: Math.round(soma(efetivas) * 100) / 100,
    movimentoQueEntra: Math.round(soma((i) => i.acao === 'mover') * 100) / 100,
    conciliacoesTransferidas: itens.filter((i) => i.transfereConciliacao).length,
    conciliacoesPerdidas: itens.filter((i) => i.acao === 'descartar_duplicata' && i.transacao.lancamentoIds.length > 0 && !i.transfereConciliacao).length,
  };
}

/**
 * Antes de importar: os identificadores do arquivo já existem em outra conta?
 * É o sinal de que o extrato é de outro banco e a conta escolhida está errada.
 */
export function contaDosIdentificadores(fitids: string[], transacoes: TransacaoBancaria[], contaEscolhida: string): { conta: string; encontrados: number } | undefined {
  if (!fitids.length) return undefined;
  const alvo = new Set(fitids.filter(Boolean));
  const contagem = new Map<string, number>();
  for (const t of transacoes) if (t.idExterno && !t.descartadaEm && t.conta !== contaEscolhida && alvo.has(t.idExterno)) {
    contagem.set(t.conta, (contagem.get(t.conta) ?? 0) + 1);
  }
  const melhor = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
  return melhor ? { conta: melhor[0], encontrados: melhor[1] } : undefined;
}

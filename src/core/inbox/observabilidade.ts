// EIFF Inbox — OBSERVABILIDADE DO SHADOW MODE. PURO, derivado do que já existe (routing da thread, atribuições e eventos):
// nenhuma tabela nova, nenhum raciocínio, nenhum telefone.
//
// "Últimas decisões do Octopus": por thread, o destino sugerido pelo router (setor/equipe/pessoa, confiança, banda,
// origem, automação, SLA) e o que o humano fez depois — CONFIRMOU (atribuição humana igual à sugestão), SOBRESCREVEU
// (routing.override: sugestão original → decisão humana, quem e quando; o ground truth futuro) ou ainda não decidiu.
// "Métricas": distribuição das bandas, confirmação × override, intenções fora do catálogo, threads sem setor — a
// baseline que decide, depois, se a IA entra. Sem meta arbitrária.
import { CATALOGO_INTENCOES } from './roteador';
import type { Atribuicao, DecisaoOctopus, InboxDataset, InboxThread } from './tipos';

export type DecisaoHumana = 'CONFIRMOU' | 'SOBRESCREVEU' | 'ASSUMIU' | 'PENDENTE' | 'AUTOMATICA';
export interface DecisaoObservada {
  threadId: string;
  assunto: string;
  em: string;
  origem: DecisaoOctopus['origem'];
  intencao: string;
  sugerido: { setorCodigo?: string; equipeId?: string; responsavelId?: string };
  confianca: number;
  banda: DecisaoOctopus['banda'];
  aplicacao: DecisaoOctopus['aplicacao'];
  automacao: DecisaoOctopus['automacao']['modo'];
  slaAte: string;
  /** Onde a thread está agora. */
  atual: { setorCodigo?: string; equipeId?: string; responsavelId?: string; status: InboxThread['status'] };
  humano: DecisaoHumana;
  override?: DecisaoOctopus['override'];
  reavaliacao?: NonNullable<DecisaoOctopus['reavaliacao']>['veredicto'];
}

const ultimaHumana = (atribuicoes: Atribuicao[], threadId: string): Atribuicao | undefined =>
  atribuicoes.filter((a) => a.threadId === threadId && a.origem !== 'roteamento' && a.origem !== 'sistema').sort((a, b) => b.atribuidaEm.localeCompare(a.atribuidaEm))[0];

/** Classifica o que o humano fez com a sugestão do router. */
export function decisaoHumanaDe(t: InboxThread, atribuicoes: Atribuicao[]): DecisaoHumana {
  const r = t.roteamento;
  if (!r) return 'PENDENTE';
  if (r.override) return 'SOBRESCREVEU';
  const h = ultimaHumana(atribuicoes, t.id);
  if (!h) return r.aplicacao === 'TRIAGEM' || !t.setorCodigo ? 'PENDENTE' : 'AUTOMATICA';
  if (h.setorCodigo === r.setorCodigo && (r.aplicacao !== 'ATRIBUIR_PESSOA' || h.usuarioId === r.responsavelId)) return h.usuarioId && h.usuarioId !== r.responsavelId ? 'ASSUMIU' : 'CONFIRMOU';
  return 'SOBRESCREVEU';
}

/** As últimas decisões do Octopus, mais recentes primeiro. */
export function ultimasDecisoes(inbox: InboxDataset, limite = 20): DecisaoObservada[] {
  return inbox.threads
    .filter((t): t is InboxThread & { roteamento: DecisaoOctopus } => !!t.roteamento)
    .sort((a, b) => b.roteamento.em.localeCompare(a.roteamento.em))
    .slice(0, limite)
    .map((t) => {
      const r = t.roteamento;
      return {
        threadId: t.id, assunto: t.assunto, em: r.em, origem: r.origem, intencao: r.intencao,
        sugerido: { setorCodigo: r.setorCodigo, equipeId: r.equipeId, responsavelId: r.responsavelId },
        confianca: r.confianca, banda: r.banda, aplicacao: r.aplicacao, automacao: r.automacao.modo, slaAte: r.slaAte,
        atual: { setorCodigo: t.setorCodigo, equipeId: t.equipeId, responsavelId: t.responsavelId, status: t.status },
        humano: decisaoHumanaDe(t, inbox.atribuicoes), override: r.override, reavaliacao: r.reavaliacao?.veredicto,
      };
    });
}

export interface MetricasShadow {
  decisoes: number;
  bandas: { HIGH: number; MEDIUM: number; LOW: number };
  pctBandas: { HIGH: number; MEDIUM: number; LOW: number };
  humano: Record<DecisaoHumana, number>;
  /** % das decisões com decisão humana registrada que foram confirmadas / sobrescritas. */
  pctConfirmadas: number;
  pctOverride: number;
  /** Por setor sugerido: quantas, confirmadas, sobrescritas. */
  porSetor: { setorCodigo: string; decisoes: number; confirmadas: number; sobrescritas: number }[];
  intencoesForaDoCatalogo: { intencao: string; n: number }[];
  threadsSemSetor: number;
  origens: Record<DecisaoOctopus['origem'], number>;
  falhasIa: number;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Baseline do shadow mode a partir das decisões observadas (sem meta: é medida, não julgamento). */
export function metricasShadow(inbox: InboxDataset): MetricasShadow {
  const ds = ultimasDecisoes(inbox, Number.MAX_SAFE_INTEGER);
  const bandas = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const humano: Record<DecisaoHumana, number> = { CONFIRMOU: 0, SOBRESCREVEU: 0, ASSUMIU: 0, PENDENTE: 0, AUTOMATICA: 0 };
  const origens: Record<DecisaoOctopus['origem'], number> = { DETERMINISTICO: 0, IA: 0, HIBRIDO: 0, HUMANO: 0 };
  const setor = new Map<string, { decisoes: number; confirmadas: number; sobrescritas: number }>();
  const conhecidas = new Set(CATALOGO_INTENCOES.map((c) => c.intencao));
  const fora = new Map<string, number>();
  for (const d of ds) {
    bandas[d.banda]++; humano[d.humano]++; origens[d.origem]++;
    const s = d.sugerido.setorCodigo ?? '—';
    const e = setor.get(s) ?? { decisoes: 0, confirmadas: 0, sobrescritas: 0 };
    e.decisoes++; if (d.humano === 'CONFIRMOU' || d.humano === 'ASSUMIU') e.confirmadas++; if (d.humano === 'SOBRESCREVEU') e.sobrescritas++;
    setor.set(s, e);
    if (!conhecidas.has(d.intencao)) fora.set(d.intencao, (fora.get(d.intencao) ?? 0) + 1);
  }
  const decididas = humano.CONFIRMOU + humano.ASSUMIU + humano.SOBRESCREVEU;
  const falhasIa = inbox.eventos.filter((e) => e.tipo === 'AI_ANALYZED' && /indispon|falh/i.test(e.detalhe)).length;
  return {
    decisoes: ds.length, bandas, pctBandas: { HIGH: pct(bandas.HIGH, ds.length), MEDIUM: pct(bandas.MEDIUM, ds.length), LOW: pct(bandas.LOW, ds.length) },
    humano, pctConfirmadas: pct(humano.CONFIRMOU + humano.ASSUMIU, decididas), pctOverride: pct(humano.SOBRESCREVEU, decididas),
    porSetor: [...setor.entries()].map(([setorCodigo, v]) => ({ setorCodigo, ...v })).sort((a, b) => b.decisoes - a.decisoes),
    intencoesForaDoCatalogo: [...fora.entries()].map(([intencao, n]) => ({ intencao, n })).sort((a, b) => b.n - a.n),
    threadsSemSetor: inbox.threads.filter((t) => !t.setorCodigo && t.status === 'NOVA').length, origens, falhasIa,
  };
}

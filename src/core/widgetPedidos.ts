// Widgets do iPad — visão "pedidos": o que a equipe pediu ao Diretor Financeiro e ainda espera decisão, com a orientação do
// Diretor para cada um, mais o que foi decidido nos últimos dias. É LEITURA de centralDF (a mesma da Central e da Caixa):
// nada é recalculado nem gravado aqui. Mesma porta e mesmo token do widget do caixa (/api/widget-caixa?visao=pedidos);
// o servidor exige também a permissão de aprovar, como a Central.
import type { Dataset } from './types';
import { centralDF, type StatusPedidoDF } from './cfo';
import { round2 } from './engine';

export const VERSAO_PEDIDOS_WIDGET = 1;
export const MAX_PENDENTES_WIDGET = 8;
export const MAX_DECIDIDOS_WIDGET = 5;
/** decididos mostrados: últimos 3 dias */
export const DIAS_DECIDIDOS_WIDGET = 3;

export type AcaoPedidoWidget = 'programar' | 'reagendar' | 'avaliar' | 'recusar';
export interface PedidoPendenteWidget {
  id: string; descricao: string; para: string; solicitante: string;
  valor: number; vencimento: string; pedidoEm: string; diasEsperando: number; novo: boolean;
  acao: AcaoPedidoWidget; orientacao: string; dataSugerida: string | null;
}
export interface PedidoDecididoWidget { id: string; descricao: string; solicitante: string; valor: number; status: StatusPedidoDF; decididoEm: string }
export interface ResumoWidgetPedidos {
  versao: typeof VERSAO_PEDIDOS_WIDGET;
  visao: 'pedidos';
  geradoEm: string;
  hoje: string;
  pendentes: PedidoPendenteWidget[]; // por vencimento (o mais urgente antes)
  totalPendentes: number; // quantidade (a lista pode ter sido cortada)
  valorPendente: number;
  contagem: Record<AcaoPedidoWidget, number>;
  decididos: PedidoDecididoWidget[];
}

const curto = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** orientação em poucas palavras, para caber no widget */
export function orientacaoCurta(acao: AcaoPedidoWidget, vencimento: string, dataSugerida?: string): string {
  if (acao === 'programar') return `programar ${br(vencimento)}`;
  if (acao === 'reagendar') return dataSugerida ? `reagendar p/ ${br(dataSugerida)}` : 'reagendar';
  if (acao === 'avaliar') return 'seu aval (reserva)';
  return 'não recomendado';
}

/** Monta a visão de pedidos a partir do dataset JÁ com a data-base de hoje (o servidor ajusta para São Paulo). */
export function resumoWidgetPedidos(ds: Dataset, geradoEm: Date): ResumoWidgetPedidos {
  const hoje = ds.params.dataBase;
  const c = centralDF(ds, DIAS_DECIDIDOS_WIDGET);
  const pendentes = c.alinhamento.previsoes.map(({ lancamento: l, solicitante, diasEsperando }): PedidoPendenteWidget => {
    const o = c.orientacoes.get(l.id)!;
    return {
      id: l.id, descricao: curto(l.descricao || l.contraparte || '(sem descrição)'), para: curto(l.contraparte || '', 30), solicitante: curto(solicitante || '—', 30),
      valor: round2(l.valorLiquidoPrevisto), vencimento: l.vencimento, pedidoEm: l.criadoEm, diasEsperando, novo: diasEsperando === 0,
      acao: o.acaoSugerida, orientacao: orientacaoCurta(o.acaoSugerida, l.vencimento, o.dataSugerida), dataSugerida: o.dataSugerida ?? null,
    };
  });
  return {
    versao: VERSAO_PEDIDOS_WIDGET,
    visao: 'pedidos',
    geradoEm: geradoEm.toISOString(),
    hoje,
    pendentes: pendentes.slice(0, MAX_PENDENTES_WIDGET),
    totalPendentes: pendentes.length,
    valorPendente: round2(c.alinhamento.totalPrevisoes),
    contagem: c.contagem,
    decididos: c.decididas.slice(0, MAX_DECIDIDOS_WIDGET).map((d) => ({
      id: d.lancamento.id, descricao: curto(d.lancamento.descricao || d.lancamento.contraparte || '(sem descrição)'), solicitante: curto(d.lancamento.criadoPor || '—', 30),
      valor: round2(d.lancamento.valorBruto), status: d.status, decididoEm: d.decididoEm,
    })),
  };
}

// LE3-D.1 — leitura comercial da fila de revisao do Lead Engine: filtros, contadores, "novo hoje", handoff
// para busca de decisores e metricas do piloto.
//
// Puro. Tudo aqui e de REVISAO, nao de Commercial Queue: nenhum score, nenhuma classe, nenhuma ordenacao
// comercial. A ordem da fila continua a de `filaDeRevisao` (chegada). Filtrar e contar nao decide nada.
//
// Dois conceitos que nunca se confundem:
//   DISCOVERED_TODAY  = `recebidoEm` do Lead Engine (quando a EIFF descobriu);
//   OFFICIAL_CNO_DATE = `contextoCno.dataEventoCno` (data oficial do evento na fonte).
// "Novo hoje" fala do primeiro. Nunca chamar `recebidoEm` de "data de inclusao no CNO".
import type { ItemRevisaoLeadEngine } from './leadEngineReview';
import type { RadarDataset, RegistroFonte } from './types';
import { contextoCnoDoPayload } from './cnoDadosAbertos';
import { areaM2 } from './cnoDiscoveryPolicy';
import { faixaArea } from './cnoPerfil';

// ------------------------------------------------------------------------------------------ datas locais
/** AAAA-MM-DD de um instante ISO na data LOCAL da operacao (fuso fixo, nao o da maquina). */
export function dataLocalDe(iso: string, fusoMinutos = -180): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  return new Date(t + fusoMinutos * 60_000).toISOString().slice(0, 10);
}

/** "Novo hoje" = descoberto pela EIFF hoje. Compara a data LOCAL do `recebidoEm` com `hoje` (AAAA-MM-DD). */
export const descobertoHoje = (item: Pick<ItemRevisaoLeadEngine, 'recebidoEm'>, hoje: string, fusoMinutos = -180): boolean =>
  dataLocalDe(item.recebidoEm, fusoMinutos) === hoje;

const diasEntreLocais = (isoRecebido: string, hoje: string, fusoMinutos: number): number => {
  const p = (s: string) => { const [a, m, d] = s.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((p(hoje) - p(dataLocalDe(isoRecebido, fusoMinutos))) / 86_400_000);
};

// ------------------------------------------------------------------------------------------------ filtros
export const JANELAS_DESCOBERTA = ['hoje', '7d', '30d', '90d', 'todos'] as const;
export type JanelaDescoberta = (typeof JANELAS_DESCOBERTA)[number];
const DIAS_DA_JANELA: Record<Exclude<JanelaDescoberta, 'todos'>, number> = { hoje: 0, '7d': 7, '30d': 30, '90d': 90 };

export interface FiltroRevisao {
  /** janela de DESCOBERTA (recebidoEm), nao a data oficial do CNO */
  janela?: JanelaDescoberta;
  municipio?: string;
  tipoSinal?: 'CNO_NEW' | 'CNO_EXPANSION';
  areaMinimaM2?: number;
  status?: 'PENDING' | 'REVIEW';
}

export const FILTRO_VAZIO: FiltroRevisao = { janela: 'todos' };

/** Aplica o filtro sem reordenar: a ordem de chegada da fila e preservada. */
export function filtrarRevisao(itens: ItemRevisaoLeadEngine[], f: FiltroRevisao, hoje: string, fusoMinutos = -180): ItemRevisaoLeadEngine[] {
  return itens.filter((i) => {
    if (f.janela && f.janela !== 'todos') {
      const dias = diasEntreLocais(i.recebidoEm, hoje, fusoMinutos);
      if (dias < 0 || dias > DIAS_DA_JANELA[f.janela]) return false;
    }
    if (f.status && i.status !== f.status) return false;
    const c = i.contextoCno;
    if (f.municipio && (c?.municipio ?? '').toUpperCase() !== f.municipio.toUpperCase()) return false;
    if (f.tipoSinal && c?.tipoSinal !== f.tipoSinal) return false;
    if (f.areaMinimaM2 !== undefined && (c?.areaM2 === undefined || c.areaM2 < f.areaMinimaM2)) return false;
    return true;
  });
}

export interface ContadoresRevisao {
  total: number;
  hoje: number;
  '7d': number;
  '30d': number;
  '90d': number;
  pending: number;
  review: number;
  cnoNew: number;
  cnoExpansion: number;
  municipios: [string, number][];
}

export function contadoresRevisao(itens: ItemRevisaoLeadEngine[], hoje: string, fusoMinutos = -180): ContadoresRevisao {
  const porJanela = (j: JanelaDescoberta) => filtrarRevisao(itens, { janela: j }, hoje, fusoMinutos).length;
  const mun = new Map<string, number>();
  for (const i of itens) { const k = i.contextoCno?.municipio; if (k) mun.set(k, (mun.get(k) ?? 0) + 1); }
  return {
    total: itens.length,
    hoje: porJanela('hoje'), '7d': porJanela('7d'), '30d': porJanela('30d'), '90d': porJanela('90d'),
    pending: itens.filter((i) => i.status === 'PENDING').length,
    review: itens.filter((i) => i.status === 'REVIEW').length,
    cnoNew: itens.filter((i) => i.contextoCno?.tipoSinal === 'CNO_NEW').length,
    cnoExpansion: itens.filter((i) => i.contextoCno?.tipoSinal === 'CNO_EXPANSION').length,
    municipios: [...mun.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
  };
}

// ------------------------------------------------------------------------------------------------ handoff
/**
 * "Buscar decisores" a partir de um candidato NUNCA consome credito: o fluxo de busca de decisor do Radar e
 * por CONTA (empresa do Radar), e este candidato ainda nao e uma. Se o match aponta uma empresa existente, o
 * handoff e abrir a pagina dela (contatos) — zero consumo; senao, e preciso Associar ou Criar primeiro.
 */
export type HandoffDecisores =
  | { tipo: 'EMPRESA_EXISTENTE'; empresaId: string; rota: string }
  | { tipo: 'PROMOVER_PRIMEIRO'; motivo: string };

export function handoffDecisores(item: Pick<ItemRevisaoLeadEngine, 'match'>): HandoffDecisores {
  if (item.match) return { tipo: 'EMPRESA_EXISTENTE', empresaId: item.match.empresaId, rota: `/radar/empresas/${item.match.empresaId}?aba=contatos` };
  return { tipo: 'PROMOVER_PRIMEIRO', motivo: 'Este candidato ainda não é uma conta do Radar. Associe a uma empresa existente ou crie a empresa; a busca de decisores acontece na página da empresa, sem consumo automático.' };
}

// ------------------------------------------------------------------------------------------ metricas piloto
export interface MetricasPiloto {
  descobertos: number;
  novosHoje: number;
  promovidos: number;
  associados: number;
  empresasCriadas: number;
  emRevisao: number;
  pendentes: number;
  rejeitados: number;
  motivosRejeicao: [string, number][];
  porSinal: [string, number][];
  porFaixaArea: [string, number][];
  porMunicipio: [string, number][];
  porDestinacao: [string, number][];
  porQualificacao: [string, number][];
}

const contar = (xs: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

/**
 * Metricas de CONVERSAO do piloto, lidas dos RegistroFonte gerenciados pelo Lead Engine (intake_status
 * preenchido) da fonte CNO. Mede a politica; nao cria segunda prioridade. "Associado" x "empresa criada" vem da
 * auditoria de decisao quando existir no registro; aqui usamos a unica informacao que o proprio registro carrega
 * com seguranca: RESOLVED com entidade = promovido.
 */
export function metricasPiloto(r: Pick<RadarDataset, 'registrosFonte' | 'fontes' | 'empresas'>, hoje: string, fusoMinutos = -180): MetricasPiloto {
  const fontesCno = new Set(r.fontes.filter((f) => f.tipo === 'CNO').map((f) => f.id));
  const regs: RegistroFonte[] = r.registrosFonte.filter((x) => x.statusIntake && fontesCno.has(x.fonteId));
  const ctx = regs.map((x) => ({ x, c: contextoCnoDoPayload(x.payload) }));
  const resolvidos = regs.filter((x) => x.statusIntake === 'RESOLVED');
  // empresa criada pelo candidato: a empresa do Radar cujo externoId e o CNPJ do candidato e nasceu depois dele
  const criadas = resolvidos.filter((x) => {
    const c = contextoCnoDoPayload(x.payload);
    return !!c?.cnpjResponsavel && r.empresas.some((e) => e.cnpj === c.cnpjResponsavel && e.criadoEm >= x.recebidoEm);
  }).length;
  return {
    descobertos: regs.length,
    novosHoje: regs.filter((x) => descobertoHoje({ recebidoEm: x.recebidoEm }, hoje, fusoMinutos)).length,
    promovidos: resolvidos.length,
    associados: resolvidos.length - criadas,
    empresasCriadas: criadas,
    emRevisao: regs.filter((x) => x.statusIntake === 'REVIEW').length,
    pendentes: regs.filter((x) => x.statusIntake === 'PENDING').length,
    rejeitados: regs.filter((x) => x.statusIntake === 'REJECTED').length,
    motivosRejeicao: contar(regs.filter((x) => x.statusIntake === 'REJECTED').map((x) => x.motivoDecisao ?? '—')),
    porSinal: contar(ctx.map(({ c }) => c?.tipoSinal ?? '—')),
    porFaixaArea: contar(ctx.map(({ c }) => faixaArea(c ? areaM2({ areaTotal: c.areaM2, unidadeMedida: c.unidadeMedida }) : undefined))),
    porMunicipio: contar(ctx.map(({ c }) => c?.municipio ?? '—')),
    porDestinacao: contar(ctx.flatMap(({ c }) => (c?.destinacoes.length ? c.destinacoes : ['—']))),
    porQualificacao: contar(ctx.map(({ c }) => c?.qualificacaoResponsavelNome ?? c?.qualificacaoResponsavel ?? '—')),
  };
}

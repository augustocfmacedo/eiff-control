// Leitura comercial e classificacao operacional dos sinais (modulo de base, sem dependencia do pipeline):
// relevancia estrutural, acoes do analista, grupos A/B/C, familias de decaimento/recencia e "sinal acionavel".
// Usado pelo Signal Pilot, pela calibracao e pelo proprio CRM (proxima acao).
import { NOME_SINAL } from './padroes';
import type { Sinal, TipoSinal } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Leitura comercial (persistida em raw_payload.leitura: recuperavel, visivel, migravel para campos formais depois)
// ---------------------------------------------------------------------------------------------------------------------
export type RelevanciaEstrutural = 'DIRECT' | 'INDIRECT' | 'CONTEXTUAL' | 'NONE';
export const RELEVANCIAS: RelevanciaEstrutural[] = ['DIRECT', 'INDIRECT', 'CONTEXTUAL', 'NONE'];
export const NOME_RELEVANCIA: Record<RelevanciaEstrutural, string> = { DIRECT: 'Direta (demanda por estrutura/galpão/fábrica/CD)', INDIRECT: 'Indireta (crescimento/investimento a confirmar)', CONTEXTUAL: 'Contextual (sem ligação clara com estrutura)', NONE: 'Sem relevância estrutural' };
export type AcaoSinal = 'CONTACT_NOW' | 'FIND_BETTER_DECISION_MAKER' | 'RESEARCH_PROJECT' | 'RESEARCH_SIGNALS' | 'WATCH' | 'NURTURE' | 'IGNORE';
export const ACOES_SINAL: AcaoSinal[] = ['CONTACT_NOW', 'FIND_BETTER_DECISION_MAKER', 'RESEARCH_PROJECT', 'WATCH', 'RESEARCH_SIGNALS', 'NURTURE', 'IGNORE'];
export const NOME_ACAO_SINAL: Record<AcaoSinal, string> = { CONTACT_NOW: 'Contatar agora', FIND_BETTER_DECISION_MAKER: 'Buscar decisor melhor', RESEARCH_PROJECT: 'Pesquisar o projeto', RESEARCH_SIGNALS: 'Pesquisar sinais', WATCH: 'Acompanhar', NURTURE: 'Nutrir relacionamento', IGNORE: 'Ignorar' };
/** Ordem de prioridade das acoes (relatorio). */
export const ORDEM_ACAO_SINAL: Record<AcaoSinal, number> = { CONTACT_NOW: 0, FIND_BETTER_DECISION_MAKER: 1, RESEARCH_PROJECT: 2, WATCH: 3, RESEARCH_SIGNALS: 4, NURTURE: 5, IGNORE: 6 };

export interface LeituraSinal {
  relevanciaEstrutural?: RelevanciaEstrutural; // STRUCTURAL_RELEVANCE informada pelo analista (senao derivada do tipo)
  oQueAconteceu?: string; // WHAT_HAPPENED (fato objetivo)
  porQueImporta?: string; // WHY_IT_MATTERS_TO_EIFF (nunca gerado automaticamente)
  acaoRecomendada?: AcaoSinal; // RECOMMENDED_SIGNAL_ACTION do analista
  localEvento?: string; // WHERE: cidade/UF do evento quando a fonte a informa (vira claim SIGNAL_LOCATION); a sede da empresa nunca substitui
}
export interface PayloadSinalComLeitura { bruto?: unknown; leitura: LeituraSinal }

/** Monta o raw_payload guardando o bruto da fonte e a leitura comercial lado a lado (nada e descartado). */
export function payloadComLeitura(bruto: unknown, leitura: LeituraSinal | undefined): unknown {
  const l = leitura && Object.values(leitura).some((v) => v !== undefined && v !== '') ? Object.fromEntries(Object.entries(leitura).filter(([, v]) => v !== undefined && v !== '')) : undefined;
  if (!l) return bruto;
  return { bruto, leitura: l } as PayloadSinalComLeitura;
}
/** Recupera a leitura comercial de um sinal (payload.leitura) sem inventar nada. */
export function leituraDe(s: Pick<Sinal, 'payload'>): LeituraSinal {
  const p = s.payload as { leitura?: LeituraSinal } | null | undefined;
  return p && typeof p === 'object' && p.leitura && typeof p.leitura === 'object' ? p.leitura : {};
}
/** Bruto da fonte, com ou sem leitura anexada. */
export const brutoDe = (s: Pick<Sinal, 'payload'>): unknown => { const p = s.payload as { bruto?: unknown; leitura?: unknown } | null | undefined; return p && typeof p === 'object' && 'leitura' in p ? p.bruto : s.payload; };

/** Relevancia estrutural derivada do tipo quando o analista nao informou (MANUAL exige analise). */
export const RELEVANCIA_PADRAO_POR_TIPO: Partial<Record<TipoSinal, RelevanciaEstrutural>> = {
  CNO_NEW: 'DIRECT', CNO_EXPANSION: 'DIRECT', WAREHOUSE: 'DIRECT', NEW_FACTORY: 'DIRECT', NEW_DC: 'DIRECT', LAND_PURCHASE: 'DIRECT', EXPANSION: 'DIRECT', PROJECT_IDENTIFIED: 'DIRECT', PUBLIC_TENDER: 'DIRECT',
  NEW_OFFICE: 'INDIRECT', INVESTMENT: 'INDIRECT', HIRING_ENGINEERING: 'INDIRECT', HIRING_OPERATIONS: 'INDIRECT', PUBLIC_PLAN: 'INDIRECT', PARTNER_REFERRAL: 'INDIRECT',
  FUNDING: 'CONTEXTUAL', WEBSITE_CHANGE: 'CONTEXTUAL', NEWS: 'CONTEXTUAL',
};
export const relevanciaDe = (s: Pick<Sinal, 'tipo' | 'payload'>): RelevanciaEstrutural | undefined => leituraDe(s).relevanciaEstrutural ?? RELEVANCIA_PADRAO_POR_TIPO[s.tipo];

// ---------------------------------------------------------------------------------------------------------------------
// Classificacao operacional dos tipos (exibicao, ordenacao, analise; NAO altera scores)
// ---------------------------------------------------------------------------------------------------------------------
export type GrupoSinal = 'A' | 'B' | 'C';
export const NOME_GRUPO_SINAL: Record<GrupoSinal, string> = { A: 'Muito forte', B: 'Forte', C: 'Contextual' };
export const GRUPO_POR_TIPO: Record<TipoSinal, GrupoSinal> = {
  NEW_FACTORY: 'A', NEW_DC: 'A', WAREHOUSE: 'A', CNO_NEW: 'A', CNO_EXPANSION: 'A', LAND_PURCHASE: 'A', EXPANSION: 'A',
  NEW_OFFICE: 'B', HIRING_ENGINEERING: 'B', HIRING_OPERATIONS: 'B', PROJECT_IDENTIFIED: 'B', PUBLIC_TENDER: 'B', INVESTMENT: 'B',
  FUNDING: 'C', NEWS: 'C', WEBSITE_CHANGE: 'C', PUBLIC_PLAN: 'C', PARTNER_REFERRAL: 'C', MANUAL: 'C',
};

// ---------------------------------------------------------------------------------------------------------------------
// Familias de ciclo (decaimento do score e recencia operacional) — Production Calibration 01, hipotese operacional aprovada
// ---------------------------------------------------------------------------------------------------------------------
export type FamiliaDecay = 'LONG_CYCLE' | 'MEDIUM_CYCLE' | 'SHORT_CYCLE';
export const FAMILIA_POR_TIPO: Partial<Record<TipoSinal, FamiliaDecay>> = {
  NEW_FACTORY: 'LONG_CYCLE', NEW_DC: 'LONG_CYCLE', WAREHOUSE: 'LONG_CYCLE', CNO_NEW: 'LONG_CYCLE', CNO_EXPANSION: 'LONG_CYCLE', LAND_PURCHASE: 'LONG_CYCLE', EXPANSION: 'LONG_CYCLE', PROJECT_IDENTIFIED: 'LONG_CYCLE',
  INVESTMENT: 'MEDIUM_CYCLE', PUBLIC_PLAN: 'MEDIUM_CYCLE', PUBLIC_TENDER: 'MEDIUM_CYCLE', PARTNER_REFERRAL: 'MEDIUM_CYCLE',
  HIRING_ENGINEERING: 'SHORT_CYCLE', HIRING_OPERATIONS: 'SHORT_CYCLE', NEWS: 'SHORT_CYCLE', WEBSITE_CHANGE: 'SHORT_CYCLE',
};
/** Janelas por familia (dias): ciclo de obra industrial e longo; vaga/noticia envelhece rapido. NEW_OFFICE, FUNDING e MANUAL nao tem familia. */
export const JANELAS_FAMILIA: Record<FamiliaDecay, number> = { LONG_CYCLE: 540, MEDIUM_CYCLE: 270, SHORT_CYCLE: 120 };
/** Recencia operacional para tipos sem familia (NEW_OFFICE, FUNDING, MANUAL): valor anterior da hipotese. */
export const HIPOTESE_RECENCIA_FALLBACK_DIAS = 120;
export const janelaPorTipo = (tipo: TipoSinal, janelas: Record<FamiliaDecay, number> = JANELAS_FAMILIA): number | undefined => { const f = FAMILIA_POR_TIPO[tipo]; return f ? janelas[f] : undefined; };

/** Confianca minima para um sinal contar como acionavel (abaixo disso nunca eleva prioridade comercial). */
export const CONFIANCA_MINIMA_ACIONAVEL = 0.4;
/** Sinal comercialmente acionavel: grupo A ou B, relevancia DIRECT/INDIRECT e confianca >= 40%. */
export const sinalAcionavel = (s: Pick<Sinal, 'tipo' | 'payload' | 'confianca'>): boolean => {
  const rel = relevanciaDe(s); const grupo = GRUPO_POR_TIPO[s.tipo];
  return (rel === 'DIRECT' || rel === 'INDIRECT') && (grupo === 'A' || grupo === 'B') && s.confianca >= CONFIANCA_MINIMA_ACIONAVEL;
};
export const nomeTipoSinal = (t: TipoSinal) => NOME_SINAL[t] ?? t;

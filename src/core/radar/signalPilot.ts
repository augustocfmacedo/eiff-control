// Signal Pilot 01: camada OPERACIONAL sobre a estrutura de sinais existente. Nada aqui altera regras, pesos ou a matriz
// oficial de decision fit. Serve para registrar a leitura comercial de um sinal (relevancia estrutural, o que aconteceu,
// por que importa, acao), classificar, explicar e recomendar. Nenhum texto e inventado: sem dado, mostra "—".
import { NOME_SINAL } from './padroes';
import { normalizarNome } from './normalizar';
import { diasEntre } from './score';
import { coberturaEmpresa, type NivelCobertura } from './cobertura';
import { contatoRecomendado, recomendarAcao, sinalPrincipal, type EstadoAcao } from './pipeline';
import type { RadarDataset, Sinal, TipoSinal } from './types';

/** Empresas do Signal Pilot 01 (nomes como estao no lote piloto; casamento por nome normalizado ou por inicio do nome). */
export const EMPRESAS_SIGNAL_PILOT = ['AgriConnection', 'BR agro', 'Cereal Ouro', 'Comid Agro', 'Oceana Minerals', 'Pivot Máquinas Agrícolas', 'Semear Performance Agronômica', 'Grupo Sinova', 'Agro Amazônia', 'Fiagril'];

// ---------------------------------------------------------------------------------------------------------------------
// Leitura comercial do sinal (persistida em raw_payload.leitura: recuperavel, visivel, migravel para campos formais depois)
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
// Confianca (0-1 no modelo; leitura operacional em faixas)
// ---------------------------------------------------------------------------------------------------------------------
export type FaixaConfianca = 'primaria' | 'confiavel' | 'indireta' | 'nao_usar';
export const NOME_FAIXA_CONFIANCA: Record<FaixaConfianca, string> = { primaria: 'fonte primária/oficial', confiavel: 'fonte confiável secundária', indireta: 'fonte indireta, validar', nao_usar: 'não usar para elevar prioridade' };
export const faixaConfianca = (c: number): FaixaConfianca => (c >= 0.9 ? 'primaria' : c >= 0.7 ? 'confiavel' : c >= 0.4 ? 'indireta' : 'nao_usar');

// ---------------------------------------------------------------------------------------------------------------------
// Matriz de decisao operacional — HIPOTESE OPERACIONAL DO SIGNAL PILOT 01 (nao e a regra oficial do CRM)
// ---------------------------------------------------------------------------------------------------------------------
export const HIPOTESE_SIGNAL_PILOT = {
  confiancaMinima: 0.7, // >= 70%: sinal conta para HOT
  confiancaDescartar: 0.4, // < 40%: nunca eleva prioridade comercial
  fitIdeal: 70, // decision fit para CONTACT_NOW
  timingAlto: 40, timingMedio: 15, intentMedio: 15, // scores 0-100 das dimensoes
  recenteDias: 120, // sinal mais antigo que isso nao compete com um equivalente recente
} as const;
export type ContaSignalPilot = 'HOT' | 'WARM' | 'NO_EVIDENCE';
export interface EntradaMatriz { priorityScore: number; timing: number; intent: number; decisionFit?: number; cobertura: NivelCobertura; sinal?: { grupo: GrupoSinal; relevancia?: RelevanciaEstrutural; confianca: number; diasDesde: number } }
export interface SaidaMatriz { conta: ContaSignalPilot; acao: AcaoSinal; motivo: string }

export function recomendacaoSignalPilot(x: EntradaMatriz): SaidaMatriz {
  const H = HIPOTESE_SIGNAL_PILOT;
  const s = x.sinal;
  const temContato = x.cobertura !== 'NO_CONTACT';
  if (!s) return { conta: 'NO_EVIDENCE', acao: temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: temContato ? 'sem sinal registrado; contato disponível para quando surgir' : 'sem sinal e sem contato' };
  if (s.confianca < H.confiancaDescartar) return { conta: 'NO_EVIDENCE', acao: 'WATCH', motivo: `confiança ${Math.round(s.confianca * 100)}% < ${H.confiancaDescartar * 100}%: não eleva prioridade comercial` };
  const recente = s.diasDesde <= H.recenteDias;
  const forte = s.grupo === 'A' || s.grupo === 'B';
  const hot = forte && s.relevancia === 'DIRECT' && s.confianca >= H.confiancaMinima && x.timing >= H.timingAlto && recente;
  if (hot) {
    if ((x.decisionFit ?? 0) >= H.fitIdeal) return { conta: 'HOT', acao: 'CONTACT_NOW', motivo: `sinal ${s.grupo === 'A' ? 'muito forte' : 'forte'} e direto, confiança ${Math.round(s.confianca * 100)}%, timing ${Math.round(x.timing)}, decision fit ${x.decisionFit}` };
    return { conta: 'HOT', acao: 'FIND_BETTER_DECISION_MAKER', motivo: `sinal ${s.grupo === 'A' ? 'muito forte' : 'forte'} e direto, mas ${temContato ? `decision fit ${x.decisionFit} < ${H.fitIdeal}` : 'sem contato'}` };
  }
  const warm = s.relevancia !== 'NONE' && (x.timing >= H.timingMedio || x.intent >= H.intentMedio) && recente;
  if (warm) {
    if (s.relevancia === 'DIRECT' || s.relevancia === 'INDIRECT') return { conta: 'WARM', acao: 'RESEARCH_PROJECT', motivo: `sinal ${s.relevancia === 'DIRECT' ? 'direto' : 'indireto'} com timing ${Math.round(x.timing)} e intent ${Math.round(x.intent)}: confirmar se há projeto físico` };
    return { conta: 'WARM', acao: 'WATCH', motivo: 'sinal contextual com movimento recente: acompanhar' };
  }
  if (!recente) return { conta: 'NO_EVIDENCE', acao: temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: `sinal mais forte tem ${s.diasDesde} dias (> ${H.recenteDias}): buscar sinal recente` };
  return { conta: 'NO_EVIDENCE', acao: s.relevancia === 'NONE' ? 'IGNORE' : temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: s.relevancia === 'NONE' ? 'sinal sem relevância estrutural' : 'sinal fraco ou sem relevância clara' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Visao por empresa
// ---------------------------------------------------------------------------------------------------------------------
export interface LinhaSignalPilot {
  nome: string; empresaId?: string; empresa?: string; encontrada: boolean;
  priorityScore?: number; classe?: string; fitScore?: number; decisionFit?: number; contato?: string; cargo?: string; cobertura?: NivelCobertura;
  signalCount: number; strongestSignal?: string; strongestType?: TipoSinal; strongestTypeNome?: string; grupo?: GrupoSinal; relevancia?: RelevanciaEstrutural; signalDate?: string; confidence?: number; faixaConfianca?: FaixaConfianca; verified?: boolean; fonte?: string; diasDesde?: number;
  leitura?: LeituraSinal; sinalId?: string;
  timingScore?: number; intentScore?: number;
  recommendedAction: AcaoSinal | '—'; origemAcao?: 'analista' | 'matriz'; matriz?: SaidaMatriz; estadoCrm?: EstadoAcao; acaoCrm?: string;
  whyNow: string;
}

const dataBr = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** WHY NOW: uma linha curta apenas com o que existe nos dados. */
export function whyNow(l: Pick<LinhaSignalPilot, 'encontrada' | 'strongestType' | 'signalDate' | 'diasDesde' | 'decisionFit' | 'grupo' | 'relevancia' | 'confidence' | 'cobertura'>): string {
  if (!l.encontrada) return '—';
  if (!l.strongestType) return 'Sem sinal recente';
  const H = HIPOTESE_SIGNAL_PILOT;
  const partes = [`${NOME_SINAL[l.strongestType] ?? l.strongestType} em ${dataBr(l.signalDate)}`];
  if (l.diasDesde != null && l.diasDesde > H.recenteDias) partes.push(`há ${l.diasDesde} dias, fora da janela recente`);
  if (l.confidence != null && l.confidence < H.confiancaDescartar) partes.push(`confiança ${Math.round(l.confidence * 100)}%: validar antes de agir`);
  if (l.cobertura === 'NO_CONTACT') partes.push('sem contato na empresa');
  else if (l.decisionFit != null && l.decisionFit < H.fitIdeal && (l.grupo === 'A' || l.grupo === 'B') && l.relevancia === 'DIRECT') partes.push(`contato atual tem fit ${l.decisionFit}: buscar decisor melhor`);
  return partes.join('; ');
}

export function visaoSignalPilot(r: RadarDataset, hoje: string, nomes: string[] = EMPRESAS_SIGNAL_PILOT): LinhaSignalPilot[] {
  const ativas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  return nomes.map((nome) => {
    const alvo = normalizarNome(nome) ?? nome.toLowerCase();
    const e = ativas.find((x) => normalizarNome(x.razaoSocial) === alvo || (x.nomeFantasia && normalizarNome(x.nomeFantasia) === alvo)) ?? ativas.find((x) => (normalizarNome(x.razaoSocial) ?? '').startsWith(alvo));
    if (!e) return { nome, encontrada: false, signalCount: 0, recommendedAction: '—', whyNow: '—' };
    const sinais = r.sinais.filter((s) => s.empresaId === e.id);
    const forte = sinalPrincipal(e.id, r, hoje);
    const sug = contatoRecomendado(e.id, r);
    const cob = coberturaEmpresa(e, r);
    const rec = recomendarAcao(e, r, hoje);
    const leitura = forte ? leituraDe(forte) : undefined;
    const base: LinhaSignalPilot = {
      nome, empresaId: e.id, empresa: e.nomeFantasia ?? e.razaoSocial, encontrada: true,
      priorityScore: e.priorityScore, classe: e.priorityClass, fitScore: e.fitScore, decisionFit: sug?.fit.score, contato: sug?.contato.nome, cargo: sug?.contato.cargo, cobertura: cob.nivel,
      signalCount: sinais.length, strongestSignal: forte?.titulo, strongestType: forte?.tipo, strongestTypeNome: forte ? NOME_SINAL[forte.tipo] ?? forte.tipo : undefined, grupo: forte ? GRUPO_POR_TIPO[forte.tipo] : undefined, relevancia: forte ? relevanciaDe(forte) : undefined,
      signalDate: forte?.eventoEm.slice(0, 10), confidence: forte?.confianca, faixaConfianca: forte ? faixaConfianca(forte.confianca) : undefined, verified: forte?.verificado, fonte: forte ? r.fontes.find((f) => f.id === forte.fonteId)?.nome ?? forte.fonteTipo : undefined, diasDesde: forte ? diasEntre(forte.eventoEm, hoje) : undefined,
      leitura, sinalId: forte?.id, timingScore: e.timingScore, intentScore: e.intentScore,
      recommendedAction: '—', estadoCrm: rec.estado, acaoCrm: rec.acao, whyNow: '—',
    };
    const matriz = recomendacaoSignalPilot({ priorityScore: e.priorityScore, timing: e.timingScore, intent: e.intentScore, decisionFit: sug?.fit.score, cobertura: cob.nivel, sinal: forte ? { grupo: GRUPO_POR_TIPO[forte.tipo], relevancia: relevanciaDe(forte), confianca: forte.confianca, diasDesde: diasEntre(forte.eventoEm, hoje) } : undefined });
    const analista = leitura?.acaoRecomendada;
    return { ...base, matriz, recommendedAction: analista ?? matriz.acao, origemAcao: analista ? 'analista' : 'matriz', whyNow: whyNow(base) };
  });
}

/** SIGNAL INTELLIGENCE REPORT 01: mesmas linhas, ordenadas por acao, prioridade, timing e confianca. */
export function relatorioSignalIntelligence(r: RadarDataset, hoje: string, nomes: string[] = EMPRESAS_SIGNAL_PILOT): LinhaSignalPilot[] {
  const ordem = (a: AcaoSinal | '—') => (a === '—' ? 99 : ORDEM_ACAO_SINAL[a]);
  return visaoSignalPilot(r, hoje, nomes).sort((a, b) => ordem(a.recommendedAction) - ordem(b.recommendedAction) || (b.priorityScore ?? -1) - (a.priorityScore ?? -1) || (b.timingScore ?? -1) - (a.timingScore ?? -1) || (b.confidence ?? -1) - (a.confidence ?? -1) || a.nome.localeCompare(b.nome));
}

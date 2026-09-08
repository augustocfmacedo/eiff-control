// Signal Pilot 01: camada OPERACIONAL sobre a estrutura de sinais existente. Nada aqui altera regras, pesos ou a matriz
// oficial de decision fit. Serve para registrar a leitura comercial de um sinal (relevancia estrutural, o que aconteceu,
// por que importa, acao), classificar, explicar e recomendar. Nenhum texto e inventado: sem dado, mostra "—".
import { NOME_SINAL } from './padroes';
import { normalizarNome } from './normalizar';
import { diasEntre } from './score';
import { coberturaEmpresa, type NivelCobertura } from './cobertura';
import { contatoRecomendado, recomendarAcao, sinalPrincipal, type EstadoAcao } from './pipeline';
import type { RadarDataset, TipoSinal } from './types';
import { GRUPO_POR_TIPO, HIPOTESE_RECENCIA_FALLBACK_DIAS, ORDEM_ACAO_SINAL, janelaPorTipo, leituraDe, relevanciaDe, type AcaoSinal, type GrupoSinal, type LeituraSinal, type RelevanciaEstrutural } from './sinalLeitura';
export * from './sinalLeitura';

/** Empresas do Signal Pilot 01 (nomes como estao no lote piloto; casamento por nome normalizado ou por inicio do nome). */
export const EMPRESAS_SIGNAL_PILOT = ['AgriConnection', 'BR agro', 'Cereal Ouro', 'Comid Agro', 'Oceana Minerals', 'Pivot Máquinas Agrícolas', 'Semear Performance Agronômica', 'Grupo Sinova', 'Agro Amazônia', 'Fiagril'];

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
  recenteDias: HIPOTESE_RECENCIA_FALLBACK_DIAS, // fallback: tipos sem familia; os demais usam a janela da familia (540/270/120)
} as const;
export type ContaSignalPilot = 'HOT' | 'WARM' | 'NO_EVIDENCE';
export interface EntradaMatriz { priorityScore: number; timing: number; intent: number; decisionFit?: number; cobertura: NivelCobertura; sinal?: { grupo: GrupoSinal; relevancia?: RelevanciaEstrutural; confianca: number; diasDesde: number; janelaRecente?: number } }
export interface SaidaMatriz { conta: ContaSignalPilot; acao: AcaoSinal; motivo: string }

export function recomendacaoSignalPilot(x: EntradaMatriz): SaidaMatriz {
  const H = HIPOTESE_SIGNAL_PILOT;
  const s = x.sinal;
  const temContato = x.cobertura !== 'NO_CONTACT';
  if (!s) return { conta: 'NO_EVIDENCE', acao: temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: temContato ? 'sem sinal registrado; contato disponível para quando surgir' : 'sem sinal e sem contato' };
  if (s.confianca < H.confiancaDescartar) return { conta: 'NO_EVIDENCE', acao: 'WATCH', motivo: `confiança ${Math.round(s.confianca * 100)}% < ${H.confiancaDescartar * 100}%: não eleva prioridade comercial` };
  const janela = s.janelaRecente ?? H.recenteDias; // janela por familia quando informada (simulacao), senao a hipotese unica
  const recente = s.diasDesde <= janela;
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
  if (!recente) return { conta: 'NO_EVIDENCE', acao: temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: `sinal mais forte tem ${s.diasDesde} dias (> ${janela}): buscar sinal recente` };
  return { conta: 'NO_EVIDENCE', acao: s.relevancia === 'NONE' ? 'IGNORE' : temContato ? 'RESEARCH_SIGNALS' : 'NURTURE', motivo: s.relevancia === 'NONE' ? 'sinal sem relevância estrutural' : 'sinal fraco ou sem relevância clara' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Conflito entre MATRIX_RECOMMENDATION, ANALYST_RECOMMENDATION e CRM_NEXT_BEST_ACTION (derivado; nenhuma sobrescreve a outra)
// ---------------------------------------------------------------------------------------------------------------------
/** Estado do CRM traduzido para a acao comparavel da matriz. */
export const acaoComparavel = (estado: EstadoAcao): AcaoSinal | undefined => ({ CONTACT_NOW: 'CONTACT_NOW', SEARCH_DECISION_MAKER: 'FIND_BETTER_DECISION_MAKER', RESEARCH_SIGNALS: 'RESEARCH_SIGNALS', ENRICH_CONTACT: 'FIND_BETTER_DECISION_MAKER', WAIT: 'WATCH', FOLLOW_UP: 'WATCH' } as Partial<Record<EstadoAcao, AcaoSinal>>)[estado];
export function conflitoAcoes(x: { matriz: AcaoSinal; analista?: AcaoSinal; crm: EstadoAcao }): { status: 'ALIGNED' | 'ACTION_CONFLICT'; detalhe: string } {
  const crm = acaoComparavel(x.crm) ?? x.crm;
  const distintas = new Set<string>([x.matriz, ...(x.analista ? [x.analista] : []), crm]);
  return distintas.size === 1 ? { status: 'ALIGNED', detalhe: x.matriz } : { status: 'ACTION_CONFLICT', detalhe: `matriz ${x.matriz} · analista ${x.analista ?? '—'} · CRM ${x.crm}` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Visao por empresa
// ---------------------------------------------------------------------------------------------------------------------
export interface LinhaSignalPilot {
  nome: string; empresaId?: string; empresa?: string; encontrada: boolean;
  priorityScore?: number; classe?: string; fitScore?: number; decisionFit?: number; contato?: string; cargo?: string; cobertura?: NivelCobertura;
  signalCount: number; strongestSignal?: string; strongestType?: TipoSinal; strongestTypeNome?: string; grupo?: GrupoSinal; relevancia?: RelevanciaEstrutural; signalDate?: string; confidence?: number; faixaConfianca?: FaixaConfianca; verified?: boolean; fonte?: string; diasDesde?: number;
  leitura?: LeituraSinal; sinalId?: string; janelaRecente?: number;
  timingScore?: number; intentScore?: number;
  recommendedAction: AcaoSinal | '—'; origemAcao?: 'analista' | 'matriz'; matriz?: SaidaMatriz; estadoCrm?: EstadoAcao; acaoCrm?: string; conflito?: 'ALIGNED' | 'ACTION_CONFLICT';
  whyNow: string;
}

const dataBr = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** WHY NOW: uma linha curta apenas com o que existe nos dados. */
export function whyNow(l: Pick<LinhaSignalPilot, 'encontrada' | 'strongestType' | 'signalDate' | 'diasDesde' | 'decisionFit' | 'grupo' | 'relevancia' | 'confidence' | 'cobertura' | 'janelaRecente'>): string {
  if (!l.encontrada) return '—';
  if (!l.strongestType) return 'Sem sinal recente';
  const H = HIPOTESE_SIGNAL_PILOT;
  const partes = [`${NOME_SINAL[l.strongestType] ?? l.strongestType} em ${dataBr(l.signalDate)}`];
  const janela = l.janelaRecente ?? (l.strongestType ? janelaPorTipo(l.strongestType) : undefined) ?? H.recenteDias;
  if (l.diasDesde != null && l.diasDesde > janela) partes.push(`há ${l.diasDesde} dias, fora da janela de ${janela} dias`);
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
      leitura, sinalId: forte?.id, janelaRecente: forte ? janelaPorTipo(forte.tipo) ?? HIPOTESE_SIGNAL_PILOT.recenteDias : undefined, timingScore: e.timingScore, intentScore: e.intentScore,
      recommendedAction: '—', estadoCrm: rec.estado, acaoCrm: rec.acao, whyNow: '—',
    };
    const matriz = recomendacaoSignalPilot({ priorityScore: e.priorityScore, timing: e.timingScore, intent: e.intentScore, decisionFit: sug?.fit.score, cobertura: cob.nivel, sinal: forte ? { grupo: GRUPO_POR_TIPO[forte.tipo], relevancia: relevanciaDe(forte), confianca: forte.confianca, diasDesde: diasEntre(forte.eventoEm, hoje), janelaRecente: janelaPorTipo(forte.tipo) ?? HIPOTESE_SIGNAL_PILOT.recenteDias } : undefined });
    const analista = leitura?.acaoRecomendada;
    return { ...base, matriz, recommendedAction: analista ?? matriz.acao, origemAcao: analista ? 'analista' : 'matriz', whyNow: whyNow(base), conflito: conflitoAcoes({ matriz: matriz.acao, analista, crm: rec.estado }).status };
  });
}

/** SIGNAL INTELLIGENCE REPORT 01: mesmas linhas, ordenadas por acao, prioridade, timing e confianca. */
export function relatorioSignalIntelligence(r: RadarDataset, hoje: string, nomes: string[] = EMPRESAS_SIGNAL_PILOT): LinhaSignalPilot[] {
  const ordem = (a: AcaoSinal | '—') => (a === '—' ? 99 : ORDEM_ACAO_SINAL[a]);
  return visaoSignalPilot(r, hoje, nomes).sort((a, b) => ordem(a.recommendedAction) - ordem(b.recommendedAction) || (b.priorityScore ?? -1) - (a.priorityScore ?? -1) || (b.timingScore ?? -1) - (a.timingScore ?? -1) || (b.confidence ?? -1) - (a.confidence ?? -1) || a.nome.localeCompare(b.nome));
}

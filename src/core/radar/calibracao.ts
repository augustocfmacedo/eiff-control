// CALIBRATION PILOT 01: simulacoes puras sobre o motor atual (nada aqui altera regras, fontes, sinais ou o CRM).
// - credibilidade da fonte (SOURCE_CREDIBILITY) e separada da relevancia estrutural (STRUCTURAL_RELEVANCE);
// - decaimento por familia de sinal e proxima acao do CRM condicionada ao decision fit sao HIPOTESES DE CALIBRACAO;
// - conflito entre matriz operacional, analista e CRM e derivado, sem entidade nova.
import { coberturaEmpresa } from './cobertura';
import { contextoEmpresa, contatoRecomendado, recomendarAcao, sinalPrincipal, type EstadoAcao, type Recomendacao } from './pipeline';
import { calcularScore, configDe, diasEntre } from './score';
import { DIMENSOES } from './types';
import { conflitoAcoes, recomendacaoSignalPilot } from './signalPilot';
import { GRUPO_POR_TIPO, JANELAS_FAMILIA, janelaPorTipo, leituraDe, relevanciaDe, type AcaoSinal, type FamiliaDecay, type RelevanciaEstrutural } from './sinalLeitura';
import type { ClassePrioridade, Empresa, RadarDataset, RegraScore, Sinal } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// 1) Credibilidade da fonte: confidence gravada = confianca informada x confiabilidade da fonte (no registro)
// ---------------------------------------------------------------------------------------------------------------------
/** Confianca informada pelo analista, recuperada da confianca gravada e da confiabilidade da fonte na epoca. */
export const confiancaInformadaDe = (s: Pick<Sinal, 'confianca'>, confiabilidadeFonte: number) => (confiabilidadeFonte > 0 ? Math.min(1, Math.round((s.confianca / confiabilidadeFonte) * 1000) / 1000) : s.confianca);
export const confiancaEfetiva = (informada: number, confiabilidadeFonte: number) => Math.max(0, Math.min(1, Math.round(informada * confiabilidadeFonte * 1000) / 1000));

// ---------------------------------------------------------------------------------------------------------------------
// 3) Decaimento por familia: FAMILIA_POR_TIPO / JANELAS_FAMILIA (producao) vivem em sinalLeitura; aqui so aliases de simulacao
// ---------------------------------------------------------------------------------------------------------------------
export const JANELAS_FAMILIA_HIPOTESE: Record<FamiliaDecay, number> = JANELAS_FAMILIA;
/** Alternativa menos agressiva (comparacao). */
export const JANELAS_FAMILIA_MODERADA: Record<FamiliaDecay, number> = { LONG_CYCLE: 365, MEDIUM_CYCLE: 180, SHORT_CYCLE: 90 };

// ---------------------------------------------------------------------------------------------------------------------
// Simulacao de um cenario (fonte x decaimento) para uma empresa
// ---------------------------------------------------------------------------------------------------------------------
export interface Cenario { nome: string; confiabilidadeFonte?: number; janelaDias?: number; janelaPorTipo?: Record<FamiliaDecay, number>; fit?: (e: Empresa) => number; recenciaPorFamilia?: Record<FamiliaDecay, number> }
export interface ResultadoCenario {
  cenario: string; confiancaInformada: number; confiancaEfetiva: number; effectiveScore: number; fatorDecay: number; janelaAplicada?: number;
  fit: number; timing: number; intent: number; relationship: number; dataQuality: number; priorityScore: number; priorityClass: ClassePrioridade; decisionFit?: number;
  matriz: AcaoSinal; conta: string; crmAtual: EstadoAcao; crmSimulado: EstadoAcao; analista?: AcaoSinal; conflito: 'ALIGNED' | 'ACTION_CONFLICT';
  relevancia?: RelevanciaEstrutural;
}

/** Regras com decaimento substituido (por tipo ou geral) so para sinais; regras de resposta/atividade/projeto ficam como estao. */
export function regrasComJanela(regras: RegraScore[], c: Cenario): RegraScore[] {
  return regras.map((r) => {
    if (r.condicao.tipo !== 'sinal') return r;
    const dias = c.janelaPorTipo ? janelaPorTipo(r.condicao.tipoSinal, c.janelaPorTipo) ?? r.decaimentoDias : c.janelaDias ?? r.decaimentoDias;
    return dias === r.decaimentoDias ? r : { ...r, decaimento: !!dias, decaimentoDias: dias };
  });
}

/** Sinais da empresa com a confianca recalculada para outra credibilidade de fonte (a confianca informada e preservada). */
export function sinaisComFonte(sinais: Sinal[], fontes: RadarDataset['fontes'], confiabilidade?: number): Sinal[] {
  if (confiabilidade === undefined) return sinais;
  return sinais.map((s) => { const f = fontes.find((x) => x.id === s.fonteId); const informada = confiancaInformadaDe(s, f?.confiabilidade ?? 1); const conf = confiancaEfetiva(informada, confiabilidade); return { ...s, confianca: conf, scoreEfetivo: Math.round(s.scoreBase * conf * 10) / 10 }; });
}

export { acaoComparavel, conflitoAcoes } from './signalPilot';

/** 4) Proxima acao do CRM: a logica de sinal acionavel + fit.ideal passou a ser a regra oficial (recomendarAcao). Mantido como alias para os relatorios. */
export function proximaAcaoSimulada(e: Empresa, r: RadarDataset, hoje: string): Recomendacao { return recomendarAcao(e, r, hoje); }


/** Simula um cenario para uma empresa: recalcula score com fonte/decaimento alternativos e deriva matriz, CRM atual, CRM simulado e conflito. */
export function simularCenario(r: RadarDataset, empresaId: string, hoje: string, c: Cenario): ResultadoCenario | undefined {
  const e = r.empresas.find((x) => x.id === empresaId);
  if (!e) return undefined;
  const sinais = sinaisComFonte(r.sinais.filter((s) => s.empresaId === e.id), r.fontes, c.confiabilidadeFonte);
  const regras = regrasComJanela(r.regrasScore, c);
  const rSim: RadarDataset = { ...r, regrasScore: regras, sinais: [...r.sinais.filter((s) => s.empresaId !== e.id), ...sinais] };
  const ctx = contextoEmpresa(rSim, e.id)!;
  const x = calcularScore(ctx, regras, r.configScore, hoje);
  const d = (k: string) => x.dimensoes.find((z) => z.dimensao === k)?.score ?? 0;
  // FIT calibrado (simulacao): substitui a dimensao FIT e recompoe o total com os pesos configurados
  const fitSim = c.fit ? c.fit(e) : d('FIT');
  const { pesos, classes } = configDe(r.configScore);
  const somaPesos = DIMENSOES.reduce((s, k) => s + pesos[k], 0) || 1;
  const totalSim = c.fit ? Math.round(((fitSim * pesos.FIT + d('TIMING') * pesos.TIMING + d('INTENT') * pesos.INTENT + d('RELATIONSHIP') * pesos.RELATIONSHIP + d('DATA_QUALITY') * pesos.DATA_QUALITY) / somaPesos) * 10) / 10 : x.total;
  const classeSim = c.fit ? (classes.find((k) => totalSim >= k.minimo)?.classe ?? 'D') : x.classe;
  const eSim: Empresa = { ...e, fitScore: fitSim, timingScore: d('TIMING'), intentScore: d('INTENT'), relationshipScore: d('RELATIONSHIP'), dataQualityScore: d('DATA_QUALITY'), priorityScore: totalSim, priorityClass: classeSim };
  const rFinal: RadarDataset = { ...rSim, empresas: rSim.empresas.map((z) => (z.id === e.id ? eSim : z)) };
  const forte = sinalPrincipal(eSim.id, rFinal, hoje);
  const fonteForte = forte ? r.fontes.find((f) => f.id === forte.fonteId) : undefined;
  const regraForte = forte ? regras.find((g) => g.ativo && g.condicao.tipo === 'sinal' && g.condicao.tipoSinal === forte.tipo) : undefined;
  const dias = forte ? diasEntre(forte.eventoEm, hoje) : 0;
  const janela = regraForte?.decaimento ? regraForte.decaimentoDias : undefined;
  const fatorDecay = forte ? (janela ? Math.max(0, 1 - dias / janela) : 1) : 0;
  const sug = contatoRecomendado(eSim.id, rFinal);
  const cob = coberturaEmpresa(eSim, rFinal);
  const matriz = recomendacaoSignalPilot({ priorityScore: eSim.priorityScore, timing: eSim.timingScore, intent: eSim.intentScore, decisionFit: sug?.fit.score, cobertura: cob.nivel, sinal: forte ? { grupo: GRUPO_POR_TIPO[forte.tipo], relevancia: relevanciaDe(forte), confianca: forte.confianca, diasDesde: dias, janelaRecente: janelaPorTipo(forte.tipo, c.recenciaPorFamilia ?? JANELAS_FAMILIA) } : undefined }); // recencia por familia como em producao; c.recenciaPorFamilia troca as janelas na simulacao
  const crmAtual = recomendarAcao(eSim, rFinal, hoje).estado;
  const crmSimulado = proximaAcaoSimulada(eSim, rFinal, hoje).estado;
  const analista = forte ? leituraDe(forte).acaoRecomendada : undefined;
  const informadaOriginal = forte ? confiancaInformadaDe(r.sinais.find((s) => s.id === forte.id) ?? forte, fonteForte?.confiabilidade ?? 1) : 0;
  return {
    cenario: c.nome, confiancaInformada: informadaOriginal, confiancaEfetiva: forte?.confianca ?? 0, effectiveScore: forte?.scoreEfetivo ?? 0, fatorDecay: Math.round(fatorDecay * 1000) / 1000, janelaAplicada: janela,
    fit: eSim.fitScore, timing: eSim.timingScore, intent: eSim.intentScore, relationship: eSim.relationshipScore, dataQuality: eSim.dataQualityScore, priorityScore: eSim.priorityScore, priorityClass: eSim.priorityClass, decisionFit: sug?.fit.score,
    matriz: matriz.acao, conta: matriz.conta, crmAtual, crmSimulado, analista, conflito: conflitoAcoes({ matriz: matriz.acao, analista, crm: crmAtual }).status, relevancia: forte ? relevanciaDe(forte) : undefined,
  };
}

/** Cenarios padrao do Calibration Pilot 01. */
export const CENARIOS_FONTE: Cenario[] = [0.6, 0.75, 0.85, 0.95, 1].map((v) => ({ nome: `fonte ${v.toFixed(2)}`, confiabilidadeFonte: v }));
export const CENARIOS_JANELA: Cenario[] = [120, 180, 270, 365, 540].map((d) => ({ nome: `janela ${d} d`, janelaDias: d }));
export const CENARIOS_COMBINADOS: Cenario[] = [
  { nome: 'atual' },
  { nome: 'fonte 0,60 · janela 120', confiabilidadeFonte: 0.6, janelaDias: 120 },
  { nome: 'fonte 0,85 · janela 270', confiabilidadeFonte: 0.85, janelaDias: 270 },
  { nome: 'fonte 0,95 · janela 365', confiabilidadeFonte: 0.95, janelaDias: 365 },
  { nome: 'fonte 0,95 · janela por família (hipótese)', confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_HIPOTESE },
];

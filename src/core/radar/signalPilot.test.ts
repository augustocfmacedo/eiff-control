// Signal Pilot 01 — camada operacional com dados FICTICIOS, so em memoria.
import { describe, expect, it } from 'vitest';
import { GRUPO_POR_TIPO, HIPOTESE_SIGNAL_PILOT, faixaConfianca, leituraDe, brutoDe, payloadComLeitura, recomendacaoSignalPilot, relatorioSignalIntelligence, relevanciaDe, visaoSignalPilot, whyNow } from './signalPilot';
import { criarIds, importarCsv, recalcularEmpresas } from './importacao';
import { registrarSinalNormalizado } from './ingestao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, PESOS_DECISION_FIT_PADRAO, REGRAS_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { radarVazio, type RadarDataset, type TipoSinal } from './types';
import type { LeituraSinal } from './signalPilot';

const HOJE = '2026-09-08';
const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');
const H = HIPOTESE_SIGNAL_PILOT;

/** Radar ficticio com 3 empresas do piloto: uma com decisor ideal (fit 75), uma com fit 55 e uma sem contato. */
function radarPiloto(): RadarDataset {
  let r: RadarDataset = { ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
  const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T10:00:00.000Z`, usuarioId: 'U' });
  const e = importarCsv(r, ['business_name,business_domain,business_region,business_number_of_employees_range,business_id', `Cereal Ouro,cerealouro.com.br,goiás,201-500,${B(1)}`, `Grupo Sinova,gruposinova.com.br,goiás,1001-5000,${B(2)}`, `Fiagril Ltda.,fiagril.com.br,mato grosso,501-1000,${B(3)}`].join('\n'), { tipo: 'empresas', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  r = recalcularEmpresas(e.radar, e.afetadas, ids);
  const c = importarCsv(r, ['prospect_id,prospect_full_name,prospect_job_title,prospect_job_seniority_level,contact_professional_email,contact_professional_email_status,business_id,business_name', `${P(1)},Ana Fictícia,Chief executive officer,cxo,ana@cerealouro.com.br,valid,${B(1)},Cereal Ouro`, `${P(2)},Ezio Fictício,Chief executive officer,cxo,ezio@gruposinova.com.br,valid,${B(2)},Grupo Sinova`].join('\n'), { tipo: 'contatos', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  return recalcularEmpresas(c.radar, c.afetadas, ids);
}
/** Registra um sinal ficticio com leitura e recalcula (mesmo caminho do store). */
function comSinal(r: RadarDataset, empresaNome: string, tipo: TipoSinal, x: { confianca?: number; eventoEm?: string; leitura?: LeituraSinal; bruto?: unknown; verificado?: boolean; fonte?: string } = {}): RadarDataset {
  const e = r.empresas.find((z) => z.razaoSocial === empresaNome)!;
  const fonte = r.fontes.find((f) => f.codigo === (x.fonte ?? 'NEWS'))!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T11:00:00.000Z`, usuarioId: 'U' });
  const res = registrarSinalNormalizado(r, e.id, { tipo, titulo: `${tipo} fictício`, descricao: 'descrição fictícia', eventoEm: x.eventoEm ?? '2026-09-02', confianca: x.confianca ?? 1, url: 'https://exemplo.invalid/x' }, { id: fonte.id, tipo: fonte.tipo, confiabilidade: 1 }, ids, { payload: payloadComLeitura(x.bruto ?? { trecho: 'bruto fictício' }, x.leitura), verificado: x.verificado ?? true });
  return recalcularEmpresas(res.radar, [e.id], ids);
}
const linha = (r: RadarDataset, nome: string) => visaoSignalPilot(r, HOJE, [nome])[0];

describe('Signal Pilot 01: leitura comercial, classificacao e matriz operacional (dados ficticios)', () => {
  it('sem sinal: 0, —, "Sem sinal recente" e RESEARCH_SIGNALS (com contato) ou NURTURE (sem contato)', () => {
    const r = radarPiloto();
    expect(linha(r, 'Cereal Ouro')).toMatchObject({ signalCount: 0, strongestSignal: undefined, relevancia: undefined, confidence: undefined, verified: undefined, whyNow: 'Sem sinal recente', recommendedAction: 'RESEARCH_SIGNALS', origemAcao: 'matriz', cobertura: 'IDEAL_DECISION_MAKER' });
    expect(linha(r, 'Fiagril')).toMatchObject({ signalCount: 0, recommendedAction: 'NURTURE', cobertura: 'NO_CONTACT', whyNow: 'Sem sinal recente' });
    expect(visaoSignalPilot(r, HOJE, ['Inexistente'])[0]).toMatchObject({ encontrada: false, recommendedAction: '—', whyNow: '—' });
  });
  it('1) sinal DIRECT + alta confianca + decision fit alto → CONTACT_NOW; why now com a data real', () => {
    const r = comSinal(radarPiloto(), 'Cereal Ouro', 'NEW_FACTORY', { confianca: 0.95 });
    const l = linha(r, 'Cereal Ouro');
    expect(l).toMatchObject({ signalCount: 1, strongestType: 'NEW_FACTORY', grupo: 'A', relevancia: 'DIRECT', signalDate: '2026-09-02', verified: true, recommendedAction: 'CONTACT_NOW', decisionFit: 75 });
    expect(l.confidence).toBeCloseTo(0.95, 3); expect(l.faixaConfianca).toBe('primaria'); expect(l.timingScore).toBeGreaterThanOrEqual(H.timingAlto);
    expect(l.matriz).toMatchObject({ conta: 'HOT', acao: 'CONTACT_NOW' });
    expect(l.whyNow).toBe('Nova fábrica em 02/09/2026');
  });
  it('2) sinal DIRECT + alta confianca + decision fit baixo → FIND_BETTER_DECISION_MAKER', () => {
    const r = comSinal(radarPiloto(), 'Grupo Sinova', 'NEW_FACTORY', { confianca: 0.9 });
    const l = linha(r, 'Grupo Sinova');
    expect(l.decisionFit).toBe(55);
    expect(l).toMatchObject({ recommendedAction: 'FIND_BETTER_DECISION_MAKER', cobertura: 'USABLE_CONTACT' });
    expect(l.matriz?.conta).toBe('HOT');
    expect(l.whyNow).toBe('Nova fábrica em 02/09/2026; contato atual tem fit 55: buscar decisor melhor');
    // sem contato nenhum tambem cai em buscar decisor
    const r2 = comSinal(radarPiloto(), 'Fiagril Ltda.', 'NEW_FACTORY', { confianca: 0.9 });
    expect(linha(r2, 'Fiagril')).toMatchObject({ recommendedAction: 'FIND_BETTER_DECISION_MAKER', cobertura: 'NO_CONTACT' });
    expect(linha(r2, 'Fiagril').whyNow).toContain('sem contato na empresa');
  });
  it('3) sinal INDIRECT + timing medio → RESEARCH_PROJECT (ou WATCH quando contextual)', () => {
    const r = comSinal(radarPiloto(), 'Cereal Ouro', 'INVESTMENT', { confianca: 0.8 });
    const l = linha(r, 'Cereal Ouro');
    expect(l.relevancia).toBe('INDIRECT'); expect(l.grupo).toBe('B');
    expect(['RESEARCH_PROJECT', 'WATCH']).toContain(l.recommendedAction); expect(l.matriz?.conta).toBe('WARM');
    const saida = recomendacaoSignalPilot({ priorityScore: 30, timing: 20, intent: 20, decisionFit: 75, cobertura: 'IDEAL_DECISION_MAKER', sinal: { grupo: 'C', relevancia: 'CONTEXTUAL', confianca: 0.8, diasDesde: 5 } });
    expect(saida).toMatchObject({ conta: 'WARM', acao: 'WATCH' });
  });
  it('4) confianca < 40% nunca vira acao comercial forte, e fica sinalizada', () => {
    const r = comSinal(radarPiloto(), 'Cereal Ouro', 'NEW_FACTORY', { confianca: 0.3 });
    const l = linha(r, 'Cereal Ouro');
    expect(l.faixaConfianca).toBe('nao_usar'); expect(l.recommendedAction).toBe('WATCH'); expect(l.matriz?.conta).toBe('NO_EVIDENCE');
    expect(l.whyNow).toContain('confiança 30%: validar antes de agir');
    expect(faixaConfianca(0.9)).toBe('primaria'); expect(faixaConfianca(0.7)).toBe('confiavel'); expect(faixaConfianca(0.5)).toBe('indireta'); expect(faixaConfianca(0.39)).toBe('nao_usar');
  });
  it('5) sem sinal → RESEARCH_SIGNALS ou NURTURE (coberto acima); 6) verified=false visivel como nao verificado', () => {
    const r = comSinal(radarPiloto(), 'Cereal Ouro', 'WAREHOUSE', { verificado: false });
    expect(linha(r, 'Cereal Ouro').verified).toBe(false);
    expect(recomendacaoSignalPilot({ priorityScore: 5, timing: 0, intent: 0, decisionFit: 75, cobertura: 'IDEAL_DECISION_MAKER' })).toMatchObject({ conta: 'NO_EVIDENCE', acao: 'RESEARCH_SIGNALS' });
    expect(recomendacaoSignalPilot({ priorityScore: 5, timing: 0, intent: 0, cobertura: 'NO_CONTACT' })).toMatchObject({ conta: 'NO_EVIDENCE', acao: 'NURTURE' });
  });
  it('7) sinal antigo nao compete com um recente equivalente', () => {
    const antigo = comSinal(radarPiloto(), 'Cereal Ouro', 'NEW_FACTORY', { confianca: 0.9, eventoEm: '2025-06-01' });
    const recente = comSinal(radarPiloto(), 'Grupo Sinova', 'NEW_FACTORY', { confianca: 0.9, eventoEm: '2026-09-02' });
    const la = linha(antigo, 'Cereal Ouro'); const lr = linha(recente, 'Grupo Sinova');
    expect(la.diasDesde!).toBeGreaterThan(H.recenteDias); expect(la.matriz?.conta).toBe('NO_EVIDENCE'); expect(la.recommendedAction).toBe('RESEARCH_SIGNALS');
    expect(la.whyNow).toContain('fora da janela recente');
    expect(lr.matriz?.conta).toBe('HOT');
    expect(lr.timingScore!).toBeGreaterThan(la.timingScore!); expect(lr.priorityScore!).toBeGreaterThan(la.priorityScore!);
  });
  it('8) raw_payload preservado ao lado da leitura; leitura recuperavel; relevancia do analista vence a derivada', () => {
    const leitura: LeituraSinal = { relevanciaEstrutural: 'CONTEXTUAL', oQueAconteceu: 'Fato fictício', porQueImporta: 'Motivo fictício', acaoRecomendada: 'WATCH' };
    const r = comSinal(radarPiloto(), 'Cereal Ouro', 'NEW_FACTORY', { bruto: { trecho: 'texto bruto', origem: 'teste' }, leitura });
    const s = r.sinais[0];
    expect(brutoDe(s)).toEqual({ trecho: 'texto bruto', origem: 'teste' });
    expect(leituraDe(s)).toEqual(leitura);
    expect(relevanciaDe(s)).toBe('CONTEXTUAL'); expect(relevanciaDe({ tipo: 'NEW_FACTORY', payload: undefined })).toBe('DIRECT'); expect(relevanciaDe({ tipo: 'MANUAL', payload: undefined })).toBeUndefined();
    const l = linha(r, 'Cereal Ouro');
    expect(l).toMatchObject({ relevancia: 'CONTEXTUAL', recommendedAction: 'WATCH', origemAcao: 'analista' });
    expect(l.leitura).toEqual(leitura);
    // sem leitura, o payload fica exatamente como o bruto
    expect(payloadComLeitura({ a: 1 }, undefined)).toEqual({ a: 1 }); expect(payloadComLeitura({ a: 1 }, {})).toEqual({ a: 1 }); expect(payloadComLeitura(undefined, { oQueAconteceu: 'x' })).toEqual({ bruto: undefined, leitura: { oQueAconteceu: 'x' } });
  });
  it('9) WHY NOW nunca inventa: so tipo, data, janela, confianca e fit existentes', () => {
    expect(whyNow({ encontrada: true })).toBe('Sem sinal recente');
    expect(whyNow({ encontrada: false })).toBe('—');
    expect(whyNow({ encontrada: true, strongestType: 'INVESTMENT', signalDate: '2026-09-04', diasDesde: 4, decisionFit: 75, grupo: 'B', relevancia: 'INDIRECT', confidence: 0.9, cobertura: 'IDEAL_DECISION_MAKER' })).toBe('Investimento em 04/09/2026');
    const r = radarPiloto();
    for (const l of visaoSignalPilot(r, HOJE)) expect(l.whyNow).not.toMatch(/crescimento|promissora|boa oportunidade/i);
  });
  it('10) Signal Intelligence Report ordena por acao, priority, timing e confianca', () => {
    let r = radarPiloto();
    r = comSinal(r, 'Cereal Ouro', 'NEW_FACTORY', { confianca: 0.95 }); // CONTACT_NOW
    r = comSinal(r, 'Grupo Sinova', 'NEW_FACTORY', { confianca: 0.9 }); // FIND_BETTER_DECISION_MAKER
    const rel = relatorioSignalIntelligence(r, HOJE, ['Fiagril', 'Grupo Sinova', 'Cereal Ouro']);
    expect(rel.map((l) => [l.nome, l.recommendedAction])).toEqual([['Cereal Ouro', 'CONTACT_NOW'], ['Grupo Sinova', 'FIND_BETTER_DECISION_MAKER'], ['Fiagril', 'NURTURE']]);
    expect(GRUPO_POR_TIPO.NEW_FACTORY).toBe('A'); expect(GRUPO_POR_TIPO.PROJECT_IDENTIFIED).toBe('B'); expect(GRUPO_POR_TIPO.NEWS).toBe('C');
  });
});

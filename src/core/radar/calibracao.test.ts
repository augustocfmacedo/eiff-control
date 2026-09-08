// CALIBRATION PILOT 01 — simulacoes com dados FICTICIOS, so em memoria.
import { describe, expect, it } from 'vitest';
import { CENARIOS_COMBINADOS, JANELAS_FAMILIA_HIPOTESE, confiancaEfetiva, confiancaInformadaDe, conflitoAcoes, proximaAcaoSimulada, regrasComJanela, simularCenario, sinaisComFonte } from './calibracao';
import { FAMILIA_POR_TIPO, janelaPorTipo } from './sinalLeitura';
import { criarIds, importarCsv, recalcularEmpresas } from './importacao';
import { registrarSinalNormalizado } from './ingestao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, PESOS_DECISION_FIT_PADRAO, REGRAS_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { payloadComLeitura, relevanciaDe, type LeituraSinal } from './signalPilot';
import { radarVazio, type RadarDataset, type TipoSinal } from './types';

const HOJE = '2026-09-08';
const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');

function radar(): RadarDataset {
  let r: RadarDataset = { ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
  const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T10:00:00.000Z`, usuarioId: 'U' });
  const e = importarCsv(r, ['business_name,business_domain,business_region,business_number_of_employees_range,business_id', `Alfa Fictícia,alfa.invalid,goiás,1001-5000,${B(1)}`, `Beta Fictícia,beta.invalid,goiás,51-200,${B(2)}`, `Gama Fictícia,gama.invalid,goiás,51-200,${B(3)}`].join('\n'), { tipo: 'empresas', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  r = recalcularEmpresas(e.radar, e.afetadas, ids);
  const c = importarCsv(r, ['prospect_id,prospect_full_name,prospect_job_title,prospect_job_seniority_level,contact_professional_email,contact_professional_email_status,business_id,business_name', `${P(1)},Ceo Grande,Chief executive officer,cxo,a@alfa.invalid,valid,${B(1)},Alfa Fictícia`, `${P(2)},Ceo Media,Chief executive officer,cxo,b@beta.invalid,valid,${B(2)},Beta Fictícia`].join('\n'), { tipo: 'contatos', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  return recalcularEmpresas(c.radar, c.afetadas, ids);
}
function comSinal(r: RadarDataset, empresa: string, tipo: TipoSinal, eventoEm: string, x: { fonte?: string; confianca?: number; leitura?: LeituraSinal } = {}): RadarDataset {
  const e = r.empresas.find((z) => z.razaoSocial === empresa)!;
  const f = r.fontes.find((z) => z.codigo === (x.fonte ?? 'WEBSITE'))!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T11:00:00.000Z`, usuarioId: 'U' });
  const res = registrarSinalNormalizado(r, e.id, { tipo, titulo: `${tipo} fictício`, eventoEm, confianca: x.confianca ?? 0.95 }, { id: f.id, tipo: f.tipo, confiabilidade: f.confiabilidade }, ids, { payload: payloadComLeitura({ bruto: 1 }, x.leitura), verificado: true });
  return recalcularEmpresas(res.radar, [e.id], ids);
}
const emp = (r: RadarDataset, nome: string) => r.empresas.find((z) => z.razaoSocial === nome)!;

describe('Calibration Pilot 01 (simulacao pura, dados ficticios)', () => {
  it('credibilidade da fonte: confianca gravada = informada x fonte; informada e recuperavel; fonte oficial nao altera a relevancia estrutural', () => {
    expect(confiancaEfetiva(0.95, 0.6)).toBe(0.57); expect(confiancaInformadaDe({ confianca: 0.57 }, 0.6)).toBe(0.95);
    const r = comSinal(radar(), 'Alfa Fictícia', 'NEW_FACTORY', '2026-01-01', { leitura: { relevanciaEstrutural: 'DIRECT', acaoRecomendada: 'FIND_BETTER_DECISION_MAKER' } });
    const s = r.sinais[0];
    expect(s.confianca).toBe(0.57);
    for (const conf of [0.6, 0.85, 1]) { const s2 = sinaisComFonte([s], r.fontes, conf)[0]; expect(s2.confianca).toBe(confiancaEfetiva(0.95, conf)); expect(relevanciaDe(s2)).toBe('DIRECT'); expect(s2.scoreBase).toBe(s.scoreBase); }
    const c1 = simularCenario(r, emp(r, 'Alfa Fictícia').id, HOJE, { nome: 'a', confiabilidadeFonte: 0.6 })!; const c2 = simularCenario(r, emp(r, 'Alfa Fictícia').id, HOJE, { nome: 'b', confiabilidadeFonte: 1 })!;
    expect(c2.confiancaEfetiva).toBeGreaterThan(c1.confiancaEfetiva); expect(c2.timing).toBeGreaterThan(c1.timing); expect(c2.relevancia).toBe(c1.relevancia);
  });
  it('decaimento: regras padrao por familia (nova fabrica 540, expansao 540, noticia 120); cenarios trocam so as regras de sinal', () => {
    const nf = REGRAS_PADRAO.find((g) => g.tipoSinal === 'NEW_FACTORY')!; const ex = REGRAS_PADRAO.find((g) => g.tipoSinal === 'EXPANSION')!; const nw = REGRAS_PADRAO.find((g) => g.tipoSinal === 'NEWS')!;
    expect([nf.decaimentoDias, ex.decaimentoDias, nw.decaimentoDias]).toEqual([540, 540, 120]);
    const geral = regrasComJanela(REGRAS_PADRAO, { nome: 'x', janelaDias: 365 });
    expect(geral.find((g) => g.tipoSinal === 'NEW_FACTORY')!.decaimentoDias).toBe(365);
    expect(geral.find((g) => g.condicao.tipo === 'resposta')!.decaimentoDias).toBe(REGRAS_PADRAO.find((g) => g.condicao.tipo === 'resposta')!.decaimentoDias);
    const fam = regrasComJanela(REGRAS_PADRAO, { nome: 'f', janelaPorTipo: JANELAS_FAMILIA_HIPOTESE });
    expect(fam.find((g) => g.tipoSinal === 'NEW_FACTORY')!.decaimentoDias).toBe(540); expect(fam.find((g) => g.tipoSinal === 'NEWS')!.decaimentoDias).toBe(120);
    expect(janelaPorTipo('MANUAL')).toBeUndefined(); expect(FAMILIA_POR_TIPO.PROJECT_IDENTIFIED).toBe('LONG_CYCLE');
  });
  it('decay longo mantem o sinal estrutural relevante por mais tempo; noticia antiga perde forca mais rapido', () => {
    const r = comSinal(radar(), 'Alfa Fictícia', 'NEW_FACTORY', '2026-01-01');
    const id = emp(r, 'Alfa Fictícia').id;
    const j120 = simularCenario(r, id, HOJE, { nome: '120', janelaDias: 120 })!; const j270 = simularCenario(r, id, HOJE, { nome: '270', janelaDias: 270 })!; const j540 = simularCenario(r, id, HOJE, { nome: '540', janelaPorTipo: JANELAS_FAMILIA_HIPOTESE })!;
    expect(j120.timing).toBe(0); expect(j270.timing).toBeGreaterThan(0); expect(j540.timing).toBeGreaterThan(j270.timing); expect(j540.janelaAplicada).toBe(540);
    // noticia com a mesma idade, na hipotese por familia (120 d) ja vale zero; a fabrica (540 d) ainda vale
    const rn = comSinal(radar(), 'Beta Fictícia', 'NEWS', '2026-01-01', { fonte: 'NEWS' });
    const n540 = simularCenario(rn, emp(rn, 'Beta Fictícia').id, HOJE, { nome: 'fam', janelaPorTipo: JANELAS_FAMILIA_HIPOTESE })!;
    expect(n540.fatorDecay).toBe(0); expect(j540.fatorDecay).toBeGreaterThan(0.5);
  });
  it('CRM oficial: sinal acionavel + fit abaixo de fit.ideal -> SEARCH_DECISION_MAKER, acima -> CONTACT_NOW, sem contato -> SEARCH_DECISION_MAKER; sem sinal acionavel preserva a regra antiga', () => {
    const r = comSinal(comSinal(comSinal(radar(), 'Alfa Fictícia', 'NEW_FACTORY', '2026-08-20'), 'Beta Fictícia', 'NEW_FACTORY', '2026-08-20'), 'Gama Fictícia', 'NEW_FACTORY', '2026-08-20');
    const alfa = emp(r, 'Alfa Fictícia'); const beta = emp(r, 'Beta Fictícia'); const gama = emp(r, 'Gama Fictícia');
    // CEO em empresa grande: fit 55 (< fit.ideal 70); CEO em empresa media: 75
    expect(proximaAcaoSimulada(alfa, r, HOJE)).toMatchObject({ estado: 'SEARCH_DECISION_MAKER' });
    expect(proximaAcaoSimulada(beta, r, HOJE)).toMatchObject({ estado: 'CONTACT_NOW' });
    expect(proximaAcaoSimulada(gama, r, HOJE)).toMatchObject({ estado: 'SEARCH_DECISION_MAKER' });
    const cAlfa = simularCenario(r, alfa.id, HOJE, { nome: 'atual' })!;
    expect(cAlfa.crmAtual).toBe('SEARCH_DECISION_MAKER'); expect(cAlfa.crmSimulado).toBe('SEARCH_DECISION_MAKER');
    // o corte vem da configuracao: baixando fit.ideal para 50, Alfa passa a CONTACT_NOW
    const r2 = { ...r, pesosDecisionFit: r.pesosDecisionFit.map((p) => (p.chave === 'fit.ideal' ? { ...p, valor: 50 } : p)) };
    expect(proximaAcaoSimulada(alfa, r2, HOJE).estado).toBe('CONTACT_NOW');
    // sinal nao acionavel (contextual) cai na regra oficial
    const rc = comSinal(radar(), 'Alfa Fictícia', 'NEWS', '2026-08-20', { fonte: 'NEWS' });
    expect(proximaAcaoSimulada(emp(rc, 'Alfa Fictícia'), rc, HOJE).estado).toBe('CONTACT_NOW');
  });
  it('conflito matriz / analista / CRM e derivado e detectavel', () => {
    expect(conflitoAcoes({ matriz: 'RESEARCH_SIGNALS', analista: 'FIND_BETTER_DECISION_MAKER', crm: 'CONTACT_NOW' })).toMatchObject({ status: 'ACTION_CONFLICT' });
    expect(conflitoAcoes({ matriz: 'FIND_BETTER_DECISION_MAKER', analista: 'FIND_BETTER_DECISION_MAKER', crm: 'SEARCH_DECISION_MAKER' })).toMatchObject({ status: 'ALIGNED' });
    expect(conflitoAcoes({ matriz: 'CONTACT_NOW', crm: 'CONTACT_NOW' })).toMatchObject({ status: 'ALIGNED' });
    const r = comSinal(radar(), 'Alfa Fictícia', 'NEW_FACTORY', '2026-01-01', { leitura: { relevanciaEstrutural: 'DIRECT', acaoRecomendada: 'FIND_BETTER_DECISION_MAKER' } });
    const c = simularCenario(r, emp(r, 'Alfa Fictícia').id, HOJE, { nome: 'atual' })!;
    expect(c).toMatchObject({ analista: 'FIND_BETTER_DECISION_MAKER', crmAtual: 'SEARCH_DECISION_MAKER' }); // CRM alinhado ao analista; a matriz (WARM/RESEARCH_PROJECT) ainda diverge
    expect(c.conflito).toBe('ACTION_CONFLICT'); expect(c.matriz).toBe('RESEARCH_PROJECT');
    expect(CENARIOS_COMBINADOS.map((x) => x.nome)[0]).toBe('atual');
  });
});

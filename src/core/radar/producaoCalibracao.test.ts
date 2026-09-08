// PRODUCTION CALIBRATION 01 — regras agora oficiais (FIT balanceado com gate, decay por familia, recencia por familia,
// CRM com fit.ideal) e invariantes de escrita. Dados FICTICIOS, so em memoria.
import { describe, expect, it } from 'vitest';
import { confiancaEfetiva } from './calibracao';
import { CENARIOS_FIT, GATE_CONFIANCA, SEM_GATE, classificarSetor, faixaSemColchetes, fatorComponenteFit, fitCalibrado } from './fitCalibracao';
import { criarIds, importarCsv, recalcularEmpresas } from './importacao';
import { registrarSinalNormalizado } from './ingestao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, PESOS_DECISION_FIT_PADRAO, REGRAS_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { fitIdealDe, recomendarAcao } from './pipeline';
import { FAMILIA_POR_TIPO, JANELAS_FAMILIA, janelaPorTipo, sinalAcionavel } from './sinalLeitura';
import { visaoSignalPilot } from './signalPilot';
import { radarVazio, type Empresa, type RadarDataset, type Sinal } from './types';

const HOJE = '2026-09-08';
const B = (n: number) => n.toString(16).padStart(32, '0');
const P = (n: number) => n.toString(16).padStart(40, '0');
const emp = (p: Partial<Empresa>): Empresa => ({ id: 'E', razaoSocial: 'X', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '', atualizadoEm: '', fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p });
function radar(): RadarDataset {
  let r: RadarDataset = { ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
  const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T10:00:00.000Z`, usuarioId: 'U' });
  const e = importarCsv(r, ['business_name,business_domain,business_region,business_number_of_employees_range,business_yearly_revenue_range,business_id', `Grande Alimentos Fictícia,ga.invalid,goiás,[1001-5000],[200M-500M],${B(1)}`, `Média Alimentos Fictícia,ma.invalid,goiás,[51-200],[10M-25M],${B(2)}`, `Sem Contato Fictícia,sc.invalid,goiás,[201-500],[25M-75M],${B(3)}`].join('\n'), { tipo: 'empresas', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  r = recalcularEmpresas(e.radar, e.afetadas, ids);
  const c = importarCsv(r, ['prospect_id,prospect_full_name,prospect_job_title,prospect_job_seniority_level,contact_professional_email,contact_professional_email_status,business_id,business_name', `${P(1)},Ceo Grande,Chief executive officer,cxo,a@ga.invalid,valid,${B(1)},Grande Alimentos Fictícia`, `${P(2)},Ceo Media,Chief executive officer,cxo,b@ma.invalid,valid,${B(2)},Média Alimentos Fictícia`].join('\n'), { tipo: 'contatos', fonte, usuarioId: 'U', agora: ids.agora }, ids);
  return recalcularEmpresas(c.radar, c.afetadas, ids);
}
function comSinal(r: RadarDataset, nome: string, tipo: Sinal['tipo'], eventoEm: string, fonteCodigo = 'WEBSITE', confianca = 0.95): RadarDataset {
  const e = r.empresas.find((z) => z.razaoSocial === nome)!; const f = r.fontes.find((z) => z.codigo === fonteCodigo)!;
  const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T11:00:00.000Z`, usuarioId: 'U' });
  const res = registrarSinalNormalizado(r, e.id, { tipo, titulo: `${tipo} fictício`, eventoEm, confianca, url: 'https://exemplo.invalid' }, { id: f.id, tipo: f.tipo, confiabilidade: f.confiabilidade }, ids, { verificado: true, payload: { bruto: { a: 1 }, leitura: { relevanciaEstrutural: 'DIRECT' } } });
  return recalcularEmpresas(res.radar, [e.id], ids);
}

describe('Production Calibration 01', () => {
  it('confianca de classificacao e deterministica: HIGH (nome), MEDIUM (termo razoavel), LOW (so NAICS); conflito marca revisao', () => {
    const alta = classificarSetor({ nome: 'Cristal Alimentos', naicsDescricao: 'Food Manufacturing' });
    const media = classificarSetor({ nome: 'Empresa Q', descricao: 'lider regional em insumos para a lavoura de soja', naicsDescricao: 'Crop Production' });
    const baixa = classificarSetor({ nome: 'Empresa Z', descricao: 'PAGINA INATIVA', naicsDescricao: 'Crop Production' });
    expect(alta).toMatchObject({ confianca: 'HIGH', revisao: false }); expect(media).toMatchObject({ categoria: 'DISTRIBUICAO_INSUMOS_AGRO', confianca: 'MEDIUM', revisao: false }); expect(baixa).toMatchObject({ categoria: 'PRODUCAO_AGRICOLA', confianca: 'LOW', revisao: true });
    expect(classificarSetor({ nome: 'Empresa Q', descricao: 'lider regional em insumos para a lavoura de soja', naicsDescricao: 'Crop Production' })).toEqual(media);
    const conflito = classificarSetor({ nome: 'Lontano Transportes', descricao: 'somos um frigorifico', naicsDescricao: 'Food Manufacturing' });
    expect(conflito).toMatchObject({ categoria: 'LOGISTICA_DISTRIBUICAO', confianca: 'MEDIUM', revisao: true }); expect(conflito.conflito).toContain('ALIMENTOS_BEBIDAS');
    expect(classificarSetor({ nome: 'Sem Nada' })).toMatchObject({ categoria: 'OUTROS', confianca: 'LOW', revisao: true });
    // original nunca sobrescrito
    expect(alta.original).toEqual({ setor: undefined, naics: 'Food Manufacturing', sic: undefined });
  });
  it('gate: LOW nao recebe pontos de setor; MEDIUM recebe exatamente 70%; brackets lidos sem alterar o valor bruto', () => {
    const bal = CENARIOS_FIT.BALANCEADO;
    const low = emp({ razaoSocial: 'Empresa Z', uf: 'GO', setor: 'Crop Production', faixaFuncionarios: '[201-500]', faixaReceita: '[25M-75M]' });
    const fl = fatorComponenteFit(low, 'setor', { descricao: 'PAGINA INATIVA' });
    expect(fl.fator).toBe(0); expect(fl.motivo).toContain('LOW'); expect(fl.motivo).toContain('requer revisão');
    const medio = emp({ razaoSocial: 'Empresa Q', uf: 'GO', faixaFuncionarios: '[201-500]', faixaReceita: '[25M-75M]' });
    const fm = fatorComponenteFit(medio, 'setor', { descricao: 'lider regional em insumos para a lavoura de soja' });
    expect(fm.fator).toBeCloseTo(bal.afinidade.DISTRIBUICAO_INSUMOS_AGRO * 0.7, 3);
    expect(fitCalibrado(medio, bal, { descricao: 'lider regional em insumos para a lavoura de soja' }).score).toBeLessThan(fitCalibrado(medio, bal, { descricao: 'lider regional em insumos para a lavoura de soja' }, SEM_GATE).score);
    expect(GATE_CONFIANCA).toEqual({ HIGH: 1, MEDIUM: 0.7, LOW: 0 });
    expect(fatorComponenteFit(low, 'funcionarios').motivo).toBe('faixa 201-500'); expect(low.faixaFuncionarios).toBe('[201-500]'); expect(faixaSemColchetes('[75M-200M]')).toBe('75M-200M');
    expect(fatorComponenteFit(emp({ razaoSocial: 'Sem dados' }), 'receita')).toMatchObject({ fator: 0, motivo: 'faixa de receita ausente' });
  });
  it('fonte oficial 0,95: confianca efetiva 0,9025 e effective_score recalculado; raw_payload, verified e URL preservados na atualizacao em memoria', () => {
    const r = comSinal(radar(), 'Grande Alimentos Fictícia', 'NEW_FACTORY', '2026-01-01');
    const s = r.sinais[0]; expect(s.confianca).toBe(0.57);
    const oficial = { ...r.fontes.find((f) => f.codigo === 'WEBSITE')!, id: 'FONTE-OFICIAL', codigo: 'OFFICIAL_COMPANY_SOURCE', nome: 'Comunicado oficial da empresa', confiabilidade: 0.95 };
    const conf = confiancaEfetiva(0.95, oficial.confiabilidade); expect(conf).toBe(0.903); // 0,9025 arredondado a 3 casas: e o que o modelo e a coluna numeric(4,3) guardam
    const atualizado: Sinal = { ...s, fonteId: oficial.id, confianca: conf, scoreEfetivo: Math.round(s.scoreBase * conf * 10) / 10 };
    expect(atualizado.scoreEfetivo).toBe(49.7); expect(atualizado.payload).toEqual(s.payload); expect(atualizado.verificado).toBe(true); expect(atualizado.url).toBe(s.url); expect(atualizado.scoreBase).toBe(55);
    const r2 = { ...r, fontes: [...r.fontes, oficial], sinais: [atualizado] };
    const ids = criarIds(r2, { hoje: HOJE, agora: `${HOJE}T12:00:00.000Z`, usuarioId: 'U' });
    const r3 = recalcularEmpresas(r2, [s.empresaId], ids);
    expect(r3.empresas[0].timingScore).toBeGreaterThan(r.empresas[0].timingScore);
  });
  it('decay e recencia por familia nas regras padrao; tipos sem familia mantem o valor anterior', () => {
    const dias = (t: string) => REGRAS_PADRAO.find((g) => g.condicao.tipo === 'sinal' && g.condicao.tipoSinal === t)!.decaimentoDias;
    for (const t of ['NEW_FACTORY', 'NEW_DC', 'WAREHOUSE', 'CNO_NEW', 'CNO_EXPANSION', 'LAND_PURCHASE', 'EXPANSION', 'PROJECT_IDENTIFIED']) expect(dias(t)).toBe(540);
    for (const t of ['INVESTMENT', 'PUBLIC_PLAN', 'PUBLIC_TENDER', 'PARTNER_REFERRAL']) expect(dias(t)).toBe(270);
    for (const t of ['HIRING_ENGINEERING', 'HIRING_OPERATIONS', 'NEWS', 'WEBSITE_CHANGE']) expect(dias(t)).toBe(120);
    expect(dias('NEW_OFFICE')).toBe(180); expect(dias('FUNDING')).toBe(180); expect(FAMILIA_POR_TIPO.NEW_OFFICE).toBeUndefined();
    expect(JANELAS_FAMILIA).toEqual({ LONG_CYCLE: 540, MEDIUM_CYCLE: 270, SHORT_CYCLE: 120 }); expect(janelaPorTipo('NEWS')).toBe(120); expect(janelaPorTipo('MANUAL')).toBeUndefined();
    const r = comSinal(radar(), 'Grande Alimentos Fictícia', 'NEW_FACTORY', '2026-01-01');
    const l = visaoSignalPilot(r, HOJE, ['Grande Alimentos Fictícia'])[0];
    expect(l.janelaRecente).toBe(540); expect(l.diasDesde).toBe(250); expect(l.whyNow).not.toContain('fora da janela'); expect(l.matriz?.conta).not.toBe('NO_EVIDENCE');
  });
  it('CRM: sinal acionavel + fit < fit.ideal -> SEARCH_DECISION_MAKER; fit >= fit.ideal -> CONTACT_NOW; sem contato -> SEARCH_DECISION_MAKER; sem sinal acionavel preserva a regra antiga', () => {
    let r = radar();
    r = comSinal(r, 'Grande Alimentos Fictícia', 'NEW_FACTORY', '2026-08-20'); r = comSinal(r, 'Média Alimentos Fictícia', 'NEW_FACTORY', '2026-08-20'); r = comSinal(r, 'Sem Contato Fictícia', 'NEW_FACTORY', '2026-08-20');
    const g = r.empresas.find((e) => e.razaoSocial === 'Grande Alimentos Fictícia')!; const m = r.empresas.find((e) => e.razaoSocial === 'Média Alimentos Fictícia')!; const s = r.empresas.find((e) => e.razaoSocial === 'Sem Contato Fictícia')!;
    expect(fitIdealDe(r)).toBe(70);
    expect(sinalAcionavel(r.sinais[0])).toBe(true);
    expect(recomendarAcao(g, r, HOJE)).toMatchObject({ estado: 'SEARCH_DECISION_MAKER' }); // CEO em empresa grande: fit 55
    expect(recomendarAcao(m, r, HOJE)).toMatchObject({ estado: 'CONTACT_NOW' }); // CEO em empresa media: fit 75
    expect(recomendarAcao(s, r, HOJE)).toMatchObject({ estado: 'SEARCH_DECISION_MAKER' });
    const r2 = { ...r, pesosDecisionFit: r.pesosDecisionFit.map((p) => (p.chave === 'fit.ideal' ? { ...p, valor: 50 } : p)) };
    expect(recomendarAcao(g, r2, HOJE).estado).toBe('CONTACT_NOW'); // corte vem da configuracao
    // sinal contextual (NEWS) nao e acionavel: regra antiga (fit.adequado 40 + qualquer sinal) continua
    const rn = comSinal(radar(), 'Grande Alimentos Fictícia', 'NEWS', '2026-08-20', 'NEWS');
    expect(sinalAcionavel(rn.sinais[0])).toBe(false);
    expect(recomendarAcao(rn.empresas.find((e) => e.razaoSocial === 'Grande Alimentos Fictícia')!, rn, HOJE).estado).toBe('CONTACT_NOW');
    // confianca abaixo de 40% nao e acionavel
    const rb = comSinal(radar(), 'Média Alimentos Fictícia', 'NEW_FACTORY', '2026-08-20', 'WEBSITE', 0.5); // 0,5 x 0,6 = 0,30
    expect(sinalAcionavel(rb.sinais[0])).toBe(false);
  });
  it('recalculo cria snapshot novo sem apagar os anteriores e nunca cria oportunidade', () => {
    const r0 = radar();
    const antes = r0.snapshotsScore.length;
    const r1 = comSinal(r0, 'Grande Alimentos Fictícia', 'NEW_FACTORY', '2026-08-20');
    expect(r1.snapshotsScore.length).toBe(antes + 1);
    for (const s of r0.snapshotsScore) expect(r1.snapshotsScore.find((x) => x.id === s.id)).toEqual(s);
    expect(r1.oportunidades).toHaveLength(0); expect(r1.tarefas).toHaveLength(0);
  });
});

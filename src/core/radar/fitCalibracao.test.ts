// CALIBRATION PILOT 02 — FIT calibrado, normalizacao de setor e recencia por familia (dados FICTICIOS, em memoria).
import { describe, expect, it } from 'vitest';
import { CENARIOS_FIT, classificarSetor, distribuicao, faixaSemColchetes, fitCalibrado, funcionariosDe, receitaMilhoesDe } from './fitCalibracao';
import { JANELAS_FAMILIA_HIPOTESE, simularCenario } from './calibracao';
import { criarIds, importarCsv, recalcularEmpresas } from './importacao';
import { registrarSinalNormalizado } from './ingestao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, PESOS_DECISION_FIT_PADRAO, REGRAS_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { recomendacaoSignalPilot, relevanciaDe } from './signalPilot';
import { radarVazio, type Empresa, type RadarDataset } from './types';

const HOJE = '2026-09-08';
const B = (n: number) => n.toString(16).padStart(32, '0');
const emp = (p: Partial<Empresa>): Empresa => ({ id: 'E', razaoSocial: 'X', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '', atualizadoEm: '', fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p });

describe('Calibration Pilot 02: FIT com dados reais (simulacao)', () => {
  it('faixas do Vibe com colchetes sao lidas sem sobrescrever o valor', () => {
    expect(faixaSemColchetes('[501-1000]')).toBe('501-1000'); expect(funcionariosDe('[501-1000]')).toBe(1000); expect(funcionariosDe('[10001+]')).toBe(10001); expect(funcionariosDe(undefined)).toBeUndefined();
    expect(receitaMilhoesDe('[75M-200M]')).toBe(200); expect(receitaMilhoesDe('[1B-10B]')).toBe(10000); expect(receitaMilhoesDe('')).toBeUndefined();
  });
  it('normalizacao de setor e deterministica, explica o motivo e preserva o original', () => {
    const c = classificarSetor({ nome: 'Agro Amazônia', setor: 'Crop Production', naics: '111', naicsDescricao: 'Crop Production', sic: '0191', sicDescricao: 'General farms, primarily crop', descricao: 'um dos principais distribuidores insumos agropecuarios do pais' });
    expect(c).toMatchObject({ categoria: 'DISTRIBUICAO_INSUMOS_AGRO', evidencia: 'descricao' });
    expect(c.original).toEqual({ setor: 'Crop Production', naics: '111 Crop Production', sic: '0191 General farms, primarily crop' });
    expect(c.motivo).toContain('distribuidores');
    expect(classificarSetor({ nome: 'Fiagril Ltda.', descricao: 'Focada no fornecimento de fertilizantes, defensivos e servicos para o setor agricola' }).categoria).toBe('DISTRIBUICAO_INSUMOS_AGRO');
    expect(classificarSetor({ nome: 'Oceana Minerals', descricao: 'a Oceana fabrica produtos de algas marinhas para a Nutricao Animal e Nutricao Vegetal' }).categoria).toBe('ALIMENTOS_BEBIDAS');
    expect(classificarSetor({ nome: 'Agro Amazônia', descricao: 'mais de 40 anos de historia desde a fundacao; um dos principais distribuidores insumos agropecuarios' }).categoria).toBe('DISTRIBUICAO_INSUMOS_AGRO');
    expect(classificarSetor({ nome: 'Grupo Fertimig', descricao: 'promover a fertilizacao da producao de alimentos' }).categoria).toBe('QUIMICA_FERTILIZANTES');
    expect(classificarSetor({ nome: 'Pivot Máquinas Agrícolas', descricao: 'concessionaria autorizada de maquinas agricolas' }).categoria).toBe('MAQUINAS_EQUIPAMENTOS');
    expect(classificarSetor({ nome: 'Cooperativa COMIGO' }).categoria).toBe('COOPERATIVA');
    expect(classificarSetor({ nome: 'Abrapa - Associação Brasileira dos Produtores de Algodão' }).categoria).toBe('ASSOCIACAO_ENTIDADE');
    expect(classificarSetor({ nome: 'Semear Performance Agronômica', descricao: 'Somos uma consultoria' }).categoria).toBe('SERVICOS_CONSULTORIA');
    expect(classificarSetor({ nome: 'Empresa Z', naicsDescricao: 'Food Manufacturing', sicDescricao: 'Bottled and canned soft drinks' })).toMatchObject({ categoria: 'ALIMENTOS_BEBIDAS', evidencia: 'naics' });
    expect(classificarSetor({ nome: 'Empresa Y', naicsDescricao: 'Crop Production' })).toMatchObject({ categoria: 'PRODUCAO_AGRICOLA', evidencia: 'naics' });
    expect(classificarSetor({ nome: 'Empresa W' }).categoria).toBe('OUTROS');
    const a = classificarSetor({ nome: 'Grupo Sinova', descricao: 'Solucoes para produzir, seguranca para prosperar' }); const b = classificarSetor({ nome: 'Grupo Sinova', descricao: 'Solucoes para produzir, seguranca para prosperar' });
    expect(a).toEqual(b);
  });
  it('FIT calibrado: dados ausentes rendem 0, sem sinais/timing; soma dos pesos = 100 nos 3 cenarios', () => {
    for (const c of Object.values(CENARIOS_FIT)) expect(Object.values(c.pesos).reduce((s, x) => s + x, 0)).toBe(100);
    const cheia = emp({ razaoSocial: 'Cristal Alimentos', uf: 'GO', setor: 'Food Manufacturing', faixaFuncionarios: '[1001-5000]', faixaReceita: '[200M-500M]' });
    const vazia = emp({ razaoSocial: 'Sem Dados' });
    for (const c of Object.values(CENARIOS_FIT)) {
      const f = fitCalibrado(cheia, c, { naicsDescricao: 'Food Manufacturing' });
      expect(f.score).toBeGreaterThan(80); expect(f.categoria).toBe('ALIMENTOS_BEBIDAS'); expect(f.ausentes).toEqual([]);
      const v = fitCalibrado(vazia, c);
      expect(v.score).toBeLessThanOrEqual(c.pesos.setor * c.afinidade.OUTROS); expect(v.ausentes).toEqual(['uf', 'faixaFuncionarios', 'faixaReceita']);
      expect(v.fatores.filter((x) => x.componente !== 'setor').every((x) => x.pontos === 0)).toBe(true);
    }
    // o FIT so olha firmographics: mudar timing/sinais da empresa nao altera nada
    const comTiming = { ...cheia, timingScore: 90 };
    expect(fitCalibrado(comTiming, CENARIOS_FIT.BALANCEADO, { naicsDescricao: 'Food Manufacturing' }).score).toBe(fitCalibrado(cheia, CENARIOS_FIT.BALANCEADO, { naicsDescricao: 'Food Manufacturing' }).score);
    // conservador <= balanceado <= agressivo para uma revenda de insumos media
    const rev = emp({ razaoSocial: 'Revenda', uf: 'MT', faixaFuncionarios: '[201-500]', faixaReceita: '[25M-75M]' });
    const s = (n: 'CONSERVADOR' | 'BALANCEADO' | 'AGRESSIVO') => fitCalibrado(rev, CENARIOS_FIT[n], { descricao: 'revenda de insumos agricolas' }).score;
    expect(s('CONSERVADOR')).toBeLessThanOrEqual(s('BALANCEADO')); expect(s('BALANCEADO')).toBeLessThanOrEqual(s('AGRESSIVO'));
  });
  it('ranking reproduzivel e independente da ordem; distribuicao', () => {
    const lista = [emp({ id: 'a', razaoSocial: 'A', uf: 'GO', faixaFuncionarios: '[51-200]', faixaReceita: '[10M-25M]' }), emp({ id: 'b', razaoSocial: 'B Alimentos', uf: 'GO', faixaFuncionarios: '[1001-5000]', faixaReceita: '[200M-500M]' }), emp({ id: 'c', razaoSocial: 'C Transportes', uf: 'MS', faixaFuncionarios: '[501-1000]', faixaReceita: '[75M-200M]' })];
    const rank = (xs: Empresa[]) => xs.map((e) => ({ id: e.id, s: fitCalibrado(e, CENARIOS_FIT.BALANCEADO).score })).sort((x, y) => y.s - x.s || x.id.localeCompare(y.id)).map((x) => x.id);
    expect(rank(lista)).toEqual(rank([...lista].reverse())); expect(rank(lista)).toEqual(rank([lista[1], lista[2], lista[0]]));
    expect(rank(lista)[0]).toBe('b');
    expect(distribuicao([25, 25, 60, 90])).toMatchObject({ n: 4, min: 25, max: 90, media: 50, faixas: { '20-39': 2, '60-79': 1, '80-100': 1, '0-19': 0, '40-59': 0 } });
  });
  it('cenario com FIT calibrado recompoe priority/classe; recencia por familia elimina o conflito artificial; fit.ideal segue configuravel', () => {
    let r: RadarDataset = { ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
    const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
    const ids = criarIds(r, { hoje: HOJE, agora: `${HOJE}T10:00:00.000Z`, usuarioId: 'U' });
    const e = importarCsv(r, ['business_name,business_domain,business_region,business_number_of_employees_range,business_yearly_revenue_range,business_id', `Alfa Alimentos Fictícia,alfa.invalid,goiás,[1001-5000],[200M-500M],${B(1)}`].join('\n'), { tipo: 'empresas', fonte, usuarioId: 'U', agora: ids.agora }, ids);
    r = recalcularEmpresas(e.radar, e.afetadas, ids);
    const site = r.fontes.find((f) => f.codigo === 'WEBSITE')!;
    const res = registrarSinalNormalizado(r, r.empresas[0].id, { tipo: 'NEW_FACTORY', titulo: 'Fábrica fictícia', eventoEm: '2026-01-01', confianca: 0.95 }, { id: site.id, tipo: site.tipo, confiabilidade: site.confiabilidade }, ids, { verificado: true });
    r = recalcularEmpresas(res.radar, [r.empresas[0].id], ids);
    const id = r.empresas[0].id;
    const fit = (x: Empresa) => fitCalibrado(x, CENARIOS_FIT.BALANCEADO, { naicsDescricao: 'Food Manufacturing' }).score;
    const atual = simularCenario(r, id, HOJE, { nome: 'atual' })!;
    const cal = simularCenario(r, id, HOJE, { nome: 'fit', fit })!;
    expect(cal.fit).toBe(atual.fit); expect(cal.priorityScore).toBe(atual.priorityScore); expect(cal.timing).toBe(atual.timing); expect(cal.intent).toBe(atual.intent); // o motor em producao ja usa o FIT balanceado: simulacao e regra coincidem
    expect(atual.fit).toBeGreaterThan(80);
    // recencia unica (120 d): sinal de 250 dias e "antigo" para a matriz mesmo com score vivo; por familia (540 d) deixa de ser
    const semFam = simularCenario(r, id, HOJE, { nome: 'a', confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_HIPOTESE, recenciaPorFamilia: { LONG_CYCLE: 120, MEDIUM_CYCLE: 120, SHORT_CYCLE: 120 } })!; // janela unica antiga (120 d)
    const comFam = simularCenario(r, id, HOJE, { nome: 'b', confiabilidadeFonte: 0.95, janelaPorTipo: JANELAS_FAMILIA_HIPOTESE, recenciaPorFamilia: JANELAS_FAMILIA_HIPOTESE })!;
    expect(semFam.timing).toBeGreaterThan(0); expect(['RESEARCH_SIGNALS', 'NURTURE']).toContain(semFam.matriz); expect(['RESEARCH_SIGNALS', 'NURTURE']).not.toContain(comFam.matriz); // sem contato: NURTURE; com recencia por familia o sinal volta a contar
    expect(recomendacaoSignalPilot({ priorityScore: 10, timing: 20, intent: 0, decisionFit: 75, cobertura: 'IDEAL_DECISION_MAKER', sinal: { grupo: 'A', relevancia: 'DIRECT', confianca: 0.9, diasDesde: 250, janelaRecente: 540 } }).conta).toBe('WARM');
    // fonte oficial nao altera a relevancia estrutural
    expect(relevanciaDe(res.sinal)).toBe('DIRECT'); expect(simularCenario(r, id, HOJE, { nome: 'f', confiabilidadeFonte: 0.95 })!.relevancia).toBe('DIRECT');
  });
});

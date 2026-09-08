// DECISION MAKER CALIBRATION 01: normalizacao do preview real (senioridade pelo titulo, departamento canonico,
// lideranca industrial no cargo). Pesos, fit.ideal e criterios inalterados. Dados FICTICIOS.
import { describe, expect, it } from 'vitest';
import { buscarDecisor } from './buscaDecisor';
import { calcularDecisionFit, departamentoCanonico, inferirPersona, inferirSenioridade } from './contatos';
import { criarIds, importarCsv, recalcularEmpresas } from './importacao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, PESOS_DECISION_FIT_PADRAO, REGRAS_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { radarVazio, type Contato, type Empresa, type RadarDataset } from './types';
import { prospectParaContato, senioridadeProspectVibe } from './vibe';

const P = (n: number) => n.toString(16).padStart(40, '0');
const grande: Empresa = { id: 'E1', razaoSocial: 'Grande Fictícia', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '', atualizadoEm: '', fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', businessId: 'a'.repeat(32), faixaFuncionarios: '[1001-5000]' };
const pesos = PESOS_DECISION_FIT_PADRAO; const regras = REGRAS_PERSONA_PADRAO;
const fit = (c: Pick<Contato, 'persona' | 'cargo' | 'departamento' | 'senioridade'>) => calcularDecisionFit(c, grande, pesos, regras, undefined);

describe('Decision Maker Calibration 01', () => {
  it('senioridade: job_level valido prevalece; sem job_level, inferida pelo titulo com a regra do Radar; nunca inventada', () => {
    expect(senioridadeProspectVibe({ job_level_main: null as unknown as undefined, job_title: 'Gerente industrial' })).toBe('Gerente');
    expect(senioridadeProspectVibe({ job_title: 'Gerente industrial / supply chain of fertilizer' })).toBe('Gerente');
    expect(senioridadeProspectVibe({ job_title: 'Diretor de engenharia' })).toBe('Diretor');
    expect(senioridadeProspectVibe({ job_level_main: 'manager', job_title: 'Supervisor de produção' })).toBe('Gerente'); // job_level valido continua
    expect(senioridadeProspectVibe({ job_title: 'Supervisor de produção' })).toBe('Coordenador'); // sem job_level: supervisor nao vira gerente
    expect(senioridadeProspectVibe({ job_title: 'Consultor' })).toBeUndefined(); // 'Outro' -> nao inventa
    expect(prospectParaContato({ prospect_id: P(1), job_title: 'Gerente industrial' }, '').senioridade).toBe('Gerente');
    expect(inferirSenioridade('Supervisor de produção')).toBe('Coordenador');
  });
  it('departamento canonico: Operations/Engineering/Procurement recebem o bonus equivalente; raw preservado; sem equivalente nao ha bonus', () => {
    expect(departamentoCanonico('Operations')).toBe('operacoes'); expect(departamentoCanonico('engineering')).toBe('engenharia'); expect(departamentoCanonico('Procurement')).toBe('compras');
    expect(departamentoCanonico('manufacturing')).toBe('producao'); expect(departamentoCanonico('logistics')).toBe('logistica'); expect(departamentoCanonico('real estate')).toBe('real_estate'); expect(departamentoCanonico('supply chain')).toBe('supply_chain'); expect(departamentoCanonico('facilities')).toBe('facilities');
    expect(departamentoCanonico('Trades')).toBeUndefined(); expect(departamentoCanonico(undefined)).toBeUndefined();
    const bonus = (k: string) => pesos.find((p) => p.chave === `departamento.${k}`)!.valor;
    const base = fit({ persona: 'OPERATIONS', cargo: 'Gerente de operações', senioridade: 'Gerente' }).score;
    expect(fit({ persona: 'OPERATIONS', cargo: 'Gerente de operações', senioridade: 'Gerente', departamento: 'Operations' }).score).toBe(base + bonus('operacoes'));
    expect(fit({ persona: 'OPERATIONS', cargo: 'Gerente de operações', senioridade: 'Gerente', departamento: 'operações' }).score).toBe(base + bonus('operacoes'));
    expect(fit({ persona: 'ENGINEERING', cargo: 'Gerente de engenharia', senioridade: 'Gerente', departamento: 'Engineering' }).score).toBe(fit({ persona: 'ENGINEERING', cargo: 'Gerente de engenharia', senioridade: 'Gerente' }).score + bonus('engenharia'));
    expect(fit({ persona: 'PROCUREMENT', cargo: 'Comprador', senioridade: 'Gerente', departamento: 'Procurement' }).score).toBe(fit({ persona: 'PROCUREMENT', cargo: 'Comprador', senioridade: 'Gerente' }).score + bonus('compras'));
    expect(fit({ persona: 'ENGINEERING', cargo: 'Supervisor de manutenção', senioridade: 'Gerente', departamento: 'Trades' }).razoes.some((r) => r.startsWith('área'))).toBe(false);
    const c = prospectParaContato({ prospect_id: P(2), job_title: 'Gerente industrial', job_department_main: 'Operations', job_level_main: 'manager' }, '');
    expect(c.departamento).toBe('Operations'); // dado original preservado
  });
  it('funcao industrial no cargo: "Gerente industrial" e funcao MANUFACTURING com senioridade Gerente, nunca Diretor industrial; funcao e nivel separados', () => {
    expect(inferirPersona('Gerente industrial', undefined, regras)).toBe('MANUFACTURING');
    expect(inferirPersona('Gerente industrial / supply chain of fertilizer', undefined, regras)).toBe('MANUFACTURING'); // funcao principal antes do termo secundario
    expect(inferirPersona('Gerente industrial', 'Operations', regras)).toBe('MANUFACTURING');
    expect(inferirPersona('Diretor industrial', undefined, regras)).toBe('INDUSTRIAL_DIRECTOR');
    expect(inferirPersona('Supervisor de produção', 'Operations', regras)).toBe('MANUFACTURING');
    const ger = fit({ cargo: 'Gerente industrial', senioridade: 'Gerente' }); const dir = fit({ cargo: 'Diretor industrial', senioridade: 'Diretor' });
    expect(ger).toMatchObject({ persona: 'MANUFACTURING', senioridade: 'Gerente', score: 55 });
    expect(dir).toMatchObject({ persona: 'INDUSTRIAL_DIRECTOR', senioridade: 'Diretor', score: 84 });
    // supervisor com job_level manager: senioridade Gerente (nivel valido), funcao producao; nao chega ao ideal
    const sup = fit({ cargo: 'Supervisor de produção', departamento: 'Operations', senioridade: 'Gerente' });
    expect(sup).toMatchObject({ persona: 'MANUFACTURING', senioridade: 'Gerente', score: 61 }); expect(sup.score).toBeLessThan(70);
  });
  it('casos reais simulados: CEO atual mantem 55; nenhum candidato vira decisor ideal so pela correcao', () => {
    const ceo: Contato = { id: 'C1', empresaId: 'E1', nome: 'Ceo Atual', cargo: 'Presidente / chief executive officer', senioridade: 'C-level', persona: 'CEO', email: 'c@x.invalid', statusEmail: 'valido', ativo: true, criadoEm: '', atualizadoEm: '', qualidade: 75, decisor: false, decisionFitScore: 55 } as Contato;
    const r = { contatos: [ceo], supressoes: [], pesosDecisionFit: pesos, regrasPersona: regras, projetos: [] };
    const res = buscarDecisor(grande, [
      { prospect_id: P(1), business_id: 'a'.repeat(32), full_name: 'Marcelo G', job_title: 'Gerente industrial / supply chain of fertilizer' },
      { prospect_id: P(2), business_id: 'a'.repeat(32), full_name: 'Líneker S', job_title: 'Gerente industrial', job_department_main: 'Operations', job_level_main: 'manager' },
      { prospect_id: P(3), business_id: 'a'.repeat(32), full_name: 'Andre F', job_title: 'Warehouse supervisor', job_department_main: 'Operations', job_level_main: 'manager' },
    ], r, '2026-09-08');
    expect(res.atual?.fit).toBe(55);
    expect(res.candidatos.map((c) => [c.nome, c.persona, c.senioridade, c.fit])).toEqual([['Líneker S', 'MANUFACTURING', 'Gerente', 61], ['Andre F', 'LOGISTICS', 'Gerente', 56], ['Marcelo G', 'MANUFACTURING', 'Gerente', 55]]);
    expect(res.candidatos.every((c) => c.fit < 70 && !c.melhorQueAtual)).toBe(true);
    expect(res.recomendacao).toBe('KEEP_CURRENT');
  });
  it('score da empresa e oportunidades nao mudam com a normalizacao do decision fit', () => {
    let r: RadarDataset = { ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO };
    const fonte = r.fontes.find((f) => f.codigo === 'VIBE')!;
    const ids = criarIds(r, { hoje: '2026-09-08', agora: '2026-09-08T10:00:00.000Z', usuarioId: 'U' });
    const e = importarCsv(r, ['business_name,business_domain,business_region,business_number_of_employees_range,business_id', `Grande Fictícia,gf.invalid,goiás,[1001-5000],${'a'.repeat(32)}`].join('\n'), { tipo: 'empresas', fonte, usuarioId: 'U', agora: ids.agora }, ids);
    r = recalcularEmpresas(e.radar, e.afetadas, ids);
    const antes = r.empresas[0];
    const c = importarCsv(r, ['prospect_id,prospect_full_name,prospect_job_title,prospect_job_department,prospect_job_seniority_level,business_id,business_name', `${P(7)},Gerente Ind,Gerente industrial,Operations,manager,${'a'.repeat(32)},Grande Fictícia`].join('\n'), { tipo: 'contatos', fonte, usuarioId: 'U', agora: ids.agora }, ids);
    r = recalcularEmpresas(c.radar, c.afetadas, ids);
    const depois = r.empresas[0];
    expect(r.contatos[0].decisionFitScore).toBeLessThan(70); expect(r.contatos[0].decisor).toBe(false);
    expect([depois.fitScore, depois.timingScore, depois.intentScore, depois.priorityClass]).toEqual([antes.fitScore, antes.timingScore, antes.intentScore, antes.priorityClass]);
    expect(r.oportunidades).toHaveLength(0);
  });
});

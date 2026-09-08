// Busca de decisor por conta: dados FICTICIOS, sem chamadas externas.
import { describe, expect, it } from 'vitest';
import { ADEQUACAO_FUNCIONAL, DELTA_MATERIAL_DECISION_FIT, buscarDecisor, candidatoMelhor } from './buscaDecisor';
import { PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import type { Contato, Empresa } from './types';

const BID = 'a'.repeat(32);
const P = (n: number) => n.toString(16).padStart(40, '0');
const empresa: Empresa = { id: 'E1', razaoSocial: 'Grande Fictícia', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '', atualizadoEm: '', fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', businessId: BID, faixaFuncionarios: '[1001-5000]', faixaReceita: '[200M-500M]', dominio: 'gf.invalid' };
const ceo: Contato = { id: 'C1', empresaId: 'E1', nome: 'Ceo Atual', cargo: 'Chief executive officer', senioridade: 'C-level', persona: 'CEO', email: 'ceo@gf.invalid', statusEmail: 'valido', fonteExternaId: P(9), ativo: true, criadoEm: '', atualizadoEm: '', qualidade: 75, decisor: false, decisionFitScore: 0 } as Contato;
const r = { contatos: [ceo], supressoes: [], pesosDecisionFit: PESOS_DECISION_FIT_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, projetos: [] };
const HOJE = '2026-09-08';

describe('busca de decisor por conta', () => {
  it('ordena por decision fit, adequacao funcional e qualidade (nao por senioridade); ignora prospects de outra empresa', () => {
    const res = buscarDecisor(empresa, [
      { prospect_id: P(1), business_id: BID, full_name: 'Ana Compras', job_title: 'Diretora de compras', job_department_main: 'procurement', job_level_main: 'director' },
      { prospect_id: P(2), business_id: BID, full_name: 'Bruno Industrial', job_title: 'Diretor industrial', job_department_main: 'manufacturing', job_level_main: 'director', linkedin: 'https://linkedin.invalid/b' },
      { prospect_id: P(3), business_id: BID, full_name: 'Carla Presidente', job_title: 'Presidente', job_level_main: 'cxo' },
      { prospect_id: P(4), business_id: BID, full_name: 'Davi Engenharia', job_title: 'Gerente de engenharia', job_department_main: 'engineering', job_level_main: 'manager' },
      { prospect_id: P(5), business_id: 'b'.repeat(32), full_name: 'Outra Empresa', job_title: 'Diretor industrial', job_level_main: 'director' },
      { prospect_id: 'invalido', business_id: BID, full_name: 'Sem Id' },
    ], r, HOJE);
    expect(res.ignorados).toBe(2);
    expect(res.candidatos.map((c) => c.nome)).toEqual(['Bruno Industrial', 'Davi Engenharia', 'Carla Presidente', 'Ana Compras']);
    expect(res.candidatos[0]).toMatchObject({ persona: 'INDUSTRIAL_DIRECTOR', fit: 84, adequacao: 1, funcaoDireta: true, melhorQueAtual: true, recomendacao: 'ENRICH', jaNoRadar: false, contatoDisponivel: false });
    expect(res.candidatos[2]).toMatchObject({ persona: 'PRESIDENT', fit: 55, melhorQueAtual: false }); // presidente nao vence por senioridade
    expect(res.atual).toMatchObject({ fit: 55, persona: 'CEO' });
    // departamento da Explorium vem em ingles ('manufacturing'): nao recebe o bonus de area (chaves em portugues), como nos contatos ja importados
    expect(res).toMatchObject({ delta: 29, fitIdeal: 70, recomendacao: 'ENRICH', custoEnriquecerMelhor: 2 });
    expect(res.candidatos[0].qualidadeDados).toBeGreaterThan(res.candidatos[3].qualidadeDados); // linkedin conta na qualidade
  });
  it('criterio de sucesso: fit >= ideal, ou materialmente superior com funcao direta; compras/CEO nao vencem por delta', () => {
    expect(candidatoMelhor({ fit: 70, persona: 'PROCUREMENT' }, 55, 70).melhor).toBe(true);
    expect(candidatoMelhor({ fit: 66, persona: 'ENGINEERING' }, 55, 70)).toMatchObject({ melhor: true });
    expect(candidatoMelhor({ fit: 66, persona: 'PROCUREMENT' }, 55, 70).melhor).toBe(false);
    expect(candidatoMelhor({ fit: 62, persona: 'ENGINEERING' }, 55, 70).melhor).toBe(false); // +7 < delta material
    expect(candidatoMelhor({ fit: 55, persona: 'CEO' }, 55, 70).melhor).toBe(false);
    expect(candidatoMelhor({ fit: 75, persona: 'CEO' }, 75, 70)).toMatchObject({ melhor: false });
    expect(DELTA_MATERIAL_DECISION_FIT).toBe(10); expect(ADEQUACAO_FUNCIONAL.INDUSTRIAL_DIRECTOR).toBe(1); expect(ADEQUACAO_FUNCIONAL.COO).toBe(10); expect(ADEQUACAO_FUNCIONAL.PROCUREMENT!).toBeGreaterThan(ADEQUACAO_FUNCIONAL.LOGISTICS!);
  });
  it('sem candidato -> RESEARCH_MORE; poucos e nenhum melhor -> RESEARCH_MORE; muitos e nenhum melhor -> KEEP_CURRENT; ja no Radar nao pede enrich', () => {
    expect(buscarDecisor(empresa, [], r, HOJE)).toMatchObject({ recomendacao: 'RESEARCH_MORE', custoEnriquecerMelhor: 0, melhor: undefined });
    const compras = (n: number) => ({ prospect_id: P(10 + n), business_id: BID, full_name: `Comprador ${n}`, job_title: 'Comprador', job_department_main: 'procurement', job_level_main: 'manager' });
    expect(buscarDecisor(empresa, [compras(1)], r, HOJE).recomendacao).toBe('RESEARCH_MORE');
    expect(buscarDecisor(empresa, [compras(1), compras(2), compras(3)], r, HOJE).recomendacao).toBe('KEEP_CURRENT');
    const ja = buscarDecisor(empresa, [{ prospect_id: P(9), business_id: BID, full_name: 'Ceo Atual', job_title: 'Diretor industrial', job_department_main: 'manufacturing', job_level_main: 'director' }], r, HOJE);
    expect(ja.candidatos[0].jaNoRadar).toBe(true); expect(ja.recomendacao).toBe('KEEP_CURRENT'); expect(ja.custoEnriquecerMelhor).toBe(0);
    const top = buscarDecisor(empresa, Array.from({ length: 15 }, (_, i) => compras(i)), r, HOJE, 10);
    expect(top.candidatos).toHaveLength(10);
  });
  it('sem contato atual: qualquer candidato com fit >= ideal e melhor; sem nome no preview nao quebra', () => {
    const res = buscarDecisor(empresa, [{ prospect_id: P(1), business_id: BID, job_title: 'Diretor de engenharia', job_department_main: 'engineering', job_level_main: 'director' }], { ...r, contatos: [] }, HOJE);
    expect(res.atual).toBeUndefined(); expect(res.candidatos[0].nome).toBe('(nome só após importação)'); expect(res.candidatos[0].melhorQueAtual).toBe(true); expect(res.recomendacao).toBe('ENRICH');
  });
});

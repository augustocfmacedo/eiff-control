import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_MAX_VIBE, PRIORIDADE_DECISORES, budgetGuardVibe, classificarPool, escolherDecisores, estimarCreditos, normalizarEnriquecimentoVibe, payloadEnriquecimentoVibe, prospectParaContato, senioridadeVibe, statusEmailVibe, tamanhoPaginaVibe } from './vibe';
import { PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import type { Empresa } from './types';

describe('vibe', () => {
  it('ordem de prioridade e escolha de 1 decisor por empresa', () => {
    expect(PRIORIDADE_DECISORES.map((p) => p.nome)).toEqual(['engenharia', 'direção industrial', 'expansão', 'operações', 'facilities', 'COO', 'proprietário', 'presidente', 'CEO', 'supply chain', 'logística', 'compras e suprimentos']);
    const B1 = 'a'.repeat(32); const B2 = 'b'.repeat(32); const B3 = 'c'.repeat(32);
    const porTier = [
      [{ prospect_id: '1'.repeat(40), business_id: B1, job_title: 'Eng' }, { prospect_id: '2'.repeat(40), business_id: B1, job_title: 'Eng 2' }, { prospect_id: '9'.repeat(40), business_id: 'z'.repeat(32) }],
      [{ prospect_id: '3'.repeat(40), business_id: B2, job_title: 'Diretor industrial' }],
      [],
      [{ prospect_id: '4'.repeat(40), business_id: B3 }, { prospect_id: '5'.repeat(40), business_id: B1 }],
    ];
    const esc = escolherDecisores(porTier, [B1, B2, B3], 2);
    expect(esc.map((p) => p.prospect_id[0])).toEqual(['1', '3']);
    expect(esc[0].prioridade).toBe('engenharia'); expect(esc[1].prioridade).toBe('direção industrial');
    expect(escolherDecisores(porTier, [B1, B2, B3], 10)).toHaveLength(3);
  });
  it('DISCOVERY_POOL: classifica pelo decision fit e escolhe 1 por empresa; sem candidato vai para o fallback', () => {
    const B1 = 'a'.repeat(32); const B2 = 'b'.repeat(32); const B3 = 'c'.repeat(32);
    const emp = (id: string, bid: string, porte: string): Empresa => ({ id, razaoSocial: id, pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '', atualizadoEm: '', fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', businessId: bid, faixaFuncionarios: porte });
    const empresas = new Map([[B1, emp('E1', B1, '1001-5000')], [B2, emp('E2', B2, '11-50')], [B3, emp('E3', B3, '51-200')]]);
    const r = { pesosDecisionFit: PESOS_DECISION_FIT_PADRAO, regrasPersona: REGRAS_PERSONA_PADRAO, projetos: [] };
    const cands = [
      { prospect_id: '1'.repeat(40), business_id: B1, job_title: 'Comprador', job_department_main: 'procurement', job_level_main: 'manager' },
      { prospect_id: '2'.repeat(40), business_id: B1, job_title: 'Diretor Industrial', job_department_main: 'manufacturing', job_level_main: 'director' },
      { prospect_id: '3'.repeat(40), business_id: B2, job_title: 'Sócio proprietário', job_level_main: 'owner' },
      { prospect_id: '9'.repeat(40), business_id: 'z'.repeat(32), job_title: 'x' },
    ];
    const { escolhidos, semCandidato } = classificarPool(cands, empresas, r, 10);
    expect(escolhidos.map((p) => p.prospect_id[0])).toEqual(expect.arrayContaining(['2', '3']));
    expect(escolhidos).toHaveLength(2);
    expect(escolhidos.find((p) => p.business_id === B1)!.prospect_id[0]).toBe('2'); // diretor industrial vence comprador na grande
    expect(escolhidos.every((p) => p.prioridade === 'DISCOVERY_POOL' && p.fit > 0 && p.razoes.length)).toBe(true);
    expect(semCandidato).toEqual([B3]);
    expect(classificarPool(cands, empresas, r, 1)).toMatchObject({ escolhidos: [{ business_id: expect.any(String) }] });
  });
  it('estimativa e conversao de prospect em contato', () => {
    const e = estimarCreditos({ empresasSemId: 10, decisores: 56, cobertura: 300, email: true });
    expect(e).toMatchObject({ match: 10, busca: 112, email: 112, telefone: 0, perfil: 0, subtotal: 234, reserva: 20, total: 254, natureza: 'estimativa' });
    expect(e.maximoProjetado).toBe(10 + 300 + 112); // paginacao ate 5 paginas limitada pela cobertura
    expect(estimarCreditos({ empresasSemId: 0, decisores: 56, cobertura: 40, email: true, telefone: true, perfil: true }).subtotal).toBe(40 + 112 + 168 + 56);
    expect(estimarCreditos({ empresasSemId: 0, decisores: 10, cobertura: 50 }).perfil).toBe(0); // perfil so quando chamado
    expect(tamanhoPaginaVibe(112)).toBe(100); expect(PAGE_SIZE_MAX_VIBE).toBe(100);
    expect(budgetGuardVibe({ custoMaximo: 100, disponiveis: 110 })).toMatchObject({ ok: false, limite: 90 });
    expect(budgetGuardVibe({ custoMaximo: 150, disponiveis: 1000 }).ok).toBe(true);
    expect(payloadEnriquecimentoVibe(['A'.repeat(40)])).toEqual({ prospect_id: 'a'.repeat(40), parameters: { contact_types: ['email'] } });
    expect(payloadEnriquecimentoVibe(['a'.repeat(40), 'b'.repeat(40)]).prospect_id).toHaveLength(2);
    expect(() => payloadEnriquecimentoVibe(Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(40, '0')))).toThrow(/50/);
    expect(normalizarEnriquecimentoVibe({ data: [{ entity_id: 'c'.repeat(40), data: { professional_email: 'x@y.com', professional_email_status: 'valid' } }, { data: { prospect_id: 'D'.repeat(40) } }, { nada: 1 }] }).map((x) => [x.prospect_id[0], x.professional_email])).toEqual([['c', 'x@y.com'], ['d', null]]);
    const c = prospectParaContato({ prospect_id: 'x'.repeat(40), first_name: 'Ana', last_name: 'Souza', job_title: 'Diretora de Engenharia', job_level_main: 'director', job_department_main: 'engineering', linkedin_url_array: ['li/ana'], professional_email: 'ana@acme.com.br', professional_email_status: 'valid', prioridade: 'engenharia' }, '2026-09-08');
    expect(c).toMatchObject({ nome: 'Ana Souza', senioridade: 'Diretor', linkedin: 'li/ana', statusEmail: 'valido', externoId: 'x'.repeat(40), verificadoEm: '2026-09-08' });
    expect(senioridadeVibe('cxo')).toBe('C-level'); expect(senioridadeVibe('manager')).toBe('Gerente'); expect(statusEmailVibe('catch_all')).toBe('catch_all'); expect(statusEmailVibe('invalid')).toBe('invalido');
  });
});

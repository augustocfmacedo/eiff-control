import { describe, expect, it } from 'vitest';
import { PRIORIDADE_DECISORES, escolherDecisores, estimarCreditos, prospectParaContato, senioridadeVibe, statusEmailVibe } from './vibe';

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
  it('estimativa e conversao de prospect em contato', () => {
    expect(estimarCreditos({ empresasSemId: 10, decisores: 56, cobertura: 300, email: true })).toEqual({ match: 10, busca: 112, email: 112, telefone: 0, perfil: 0, total: 234 });
    expect(estimarCreditos({ empresasSemId: 0, decisores: 56, cobertura: 40, email: true, telefone: true, perfil: true }).total).toBe(40 + 112 + 168 + 56);
    const c = prospectParaContato({ prospect_id: 'x'.repeat(40), first_name: 'Ana', last_name: 'Souza', job_title: 'Diretora de Engenharia', job_level_main: 'director', job_department_main: 'engineering', linkedin_url_array: ['li/ana'], professional_email: 'ana@acme.com.br', professional_email_status: 'valid', prioridade: 'engenharia' }, '2026-09-08');
    expect(c).toMatchObject({ nome: 'Ana Souza', senioridade: 'Diretor', linkedin: 'li/ana', statusEmail: 'valido', externoId: 'x'.repeat(40), verificadoEm: '2026-09-08' });
    expect(senioridadeVibe('cxo')).toBe('C-level'); expect(senioridadeVibe('manager')).toBe('Gerente'); expect(statusEmailVibe('catch_all')).toBe('catch_all'); expect(statusEmailVibe('invalid')).toBe('invalido');
  });
});

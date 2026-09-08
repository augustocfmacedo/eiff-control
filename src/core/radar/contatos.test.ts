import { describe, expect, it } from 'vitest';
import { calcularDecisionFit, calcularQualidadeContato, contatoElegivel, enriquecerContato, inferirPersona, inferirSenioridade, porteDe, sugerirContatoPrincipal, temCanal } from './contatos';
import { associarEmpresaContato } from './ingestao';
import { PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO } from './padroes';
import { contatoRecomendado, recomendarAcao } from './pipeline';
import { radarVazio, type Contato, type Empresa, type RadarDataset } from './types';

const AGORA = '2026-09-08T12:00:00.000Z';
const HOJE = '2026-09-08';
const empresa = (p: Partial<Empresa>): Empresa => ({ id: 'E1', razaoSocial: 'Empresa Teste', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: AGORA, atualizadoEm: AGORA, fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p });
const contato = (p: Partial<Contato>): Contato => ({ id: 'C', empresaId: 'E1', nome: 'Fulano', decisor: false, qualidade: 0, observacoes: '', ativo: true, situacao: 'ATIVO', criadoEm: AGORA, atualizadoEm: AGORA, ...p });
const base = (): RadarDataset => ({ ...radarVazio(), regrasPersona: REGRAS_PERSONA_PADRAO, pesosDecisionFit: PESOS_DECISION_FIT_PADRAO });

describe('persona e senioridade', () => {
  it('mapeia cargo/departamento pela tabela configuravel', () => {
    const p = (cargo: string, dep?: string) => inferirPersona(cargo, dep, REGRAS_PERSONA_PADRAO);
    expect(p('Diretor Industrial')).toBe('INDUSTRIAL_DIRECTOR');
    expect(p('Diretora de Engenharia')).toBe('ENGINEERING_DIRECTOR');
    expect(p('Sócio-Diretor')).toBe('OWNER');
    expect(p('CEO')).toBe('CEO');
    expect(p('Gerente de Expansão')).toBe('EXPANSION_DIRECTOR');
    expect(p('Comprador Sênior', 'Suprimentos')).toBe('PROCUREMENT');
    expect(p('Analista', 'Logística')).toBe('LOGISTICS');
    expect(p('Engenheiro de Manutenção')).toBe('ENGINEERING');
    expect(p('Gerente de Facilities')).toBe('FACILITIES');
    expect(p('Assistente administrativo')).toBe('OTHER');
    // regra desativada deixa de casar
    expect(inferirPersona('CEO', undefined, REGRAS_PERSONA_PADRAO.map((g) => (g.persona === 'CEO' ? { ...g, ativo: false } : g)))).toBe('OTHER');
    expect(inferirSenioridade('Diretor Industrial')).toBe('Diretor');
    expect(inferirSenioridade('Gerente de Produção')).toBe('Gerente');
    expect(inferirSenioridade('CEO')).toBe('C-level');
    expect(inferirSenioridade('Engenheiro civil', 'Coordenador')).toBe('Coordenador');
  });
});

describe('decision fit', () => {
  it('porte da empresa e efeito no fit: dono manda na pequena, diretor industrial na grande', () => {
    expect(porteDe({ faixaFuncionarios: '11-50' })).toBe('pequena');
    expect(porteDe({ faixaFuncionarios: '201-500' })).toBe('media');
    expect(porteDe({ faixaFuncionarios: '1001-5000' })).toBe('grande');
    expect(porteDe({ capitalSocial: 50000000 })).toBe('grande');
    const dono = { cargo: 'Sócio proprietário' };
    const industrial = { cargo: 'Diretor Industrial', departamento: 'Industrial' };
    const compras = { cargo: 'Comprador', departamento: 'Compras' };
    const fit = (c: typeof dono, e: Partial<Empresa>, tipo?: string) => calcularDecisionFit(c, empresa(e), PESOS_DECISION_FIT_PADRAO, REGRAS_PERSONA_PADRAO, tipo);
    expect(fit(dono, { faixaFuncionarios: '11-50' }).score).toBeGreaterThan(fit(industrial, { faixaFuncionarios: '11-50' }).score);
    expect(fit(industrial, { faixaFuncionarios: '1001-5000' }).score).toBeGreaterThan(fit(dono, { faixaFuncionarios: '1001-5000' }).score);
    expect(fit(compras, { faixaFuncionarios: '1001-5000' }).score).toBeLessThan(fit(industrial, { faixaFuncionarios: '1001-5000' }).score);
    const comProjeto = fit(industrial, { faixaFuncionarios: '1001-5000' }, 'Fábrica');
    expect(comProjeto.score).toBe(Math.min(100, 66 + 18 + 8 + 15));
    expect(comProjeto.razoes).toEqual(expect.arrayContaining(['Diretor industrial em empresa de grande porte', 'diretoria', 'área Industrial', 'oportunidade de fábrica']));
    // pesos vem da tabela: zerando a persona o score cai
    const semPeso = calcularDecisionFit(industrial, empresa({ faixaFuncionarios: '1001-5000' }), PESOS_DECISION_FIT_PADRAO.filter((p) => !p.chave.startsWith('persona.INDUSTRIAL')), REGRAS_PERSONA_PADRAO);
    expect(semPeso.score).toBe(10 + 18 + 8); // cai para a base de OTHER (10) + senioridade + departamento
  });
});

describe('qualidade do contato', () => {
  it('pontua nome completo, cargo, empresa confirmada, e-mail profissional e status, telefone, linkedin e verificacao', () => {
    const emp = { cnpj: '11222333000181', dominio: 'acme.com.br' };
    expect(calcularQualidadeContato(contato({ nome: 'Ana' }), undefined, HOJE)).toBe(0);
    const bom = contato({ nome: 'Ana Souza', cargo: 'Diretora', departamento: 'Eng', senioridade: 'Diretor', email: 'ana@acme.com.br', statusEmail: 'valido', celular: '62', statusTelefone: 'valido', linkedin: 'x', verificadoEm: '2026-08-01' });
    expect(calcularQualidadeContato(bom, emp, HOJE)).toBe(100);
    expect(calcularQualidadeContato(contato({ nome: 'Ana Souza', email: 'ana@gmail.com' }), emp, HOJE)).toBe(28); // e-mail generico vale menos
    expect(calcularQualidadeContato(contato({ nome: 'Ana Souza', email: 'ana@acme.com.br', statusEmail: 'devolvido' }), emp, HOJE)).toBe(20);
    expect(temCanal(contato({ email: 'a@b.com', statusEmail: 'invalido' }))).toBe(false);
    expect(temCanal(contato({ celular: '62', statusTelefone: 'desconhecido' }))).toBe(true);
  });
});

describe('contato principal e supressao', () => {
  it('sugere o maior decision fit entre elegiveis, respeita o principal manual e ignora invalido/saiu/do_not_contact', () => {
    const e = empresa({ faixaFuncionarios: '1001-5000' });
    let r: RadarDataset = { ...base(), empresas: [e], projetos: [{ id: 'P1', empresaId: 'E1', nome: 'Expansão da fábrica', tipo: 'Expansão', observacoes: '', criadoEm: AGORA, atualizadoEm: AGORA }] };
    const cs = [
      contato({ id: 'c1', nome: 'Roberto Silva', cargo: 'Diretor Industrial', email: 'r@x.com', statusEmail: 'valido' }),
      contato({ id: 'c2', nome: 'Paula Lima', cargo: 'Diretora de Expansão', email: 'p@x.com' }),
      contato({ id: 'c3', nome: 'Carlos', cargo: 'Comprador', departamento: 'Compras', celular: '62' }),
      contato({ id: 'c4', nome: 'Ex Diretor', cargo: 'Diretor de Expansão', situacao: 'SAIU_DA_EMPRESA' }),
      contato({ id: 'c5', nome: 'CEO Bloqueado', cargo: 'CEO' }),
    ].map((c) => enriquecerContato(c, e, r, HOJE));
    r = { ...r, contatos: cs, supressoes: [{ id: 's1', contatoId: 'c5', tipo: 'do_not_contact', motivo: 'pediu', criadoPor: 'u', criadoEm: AGORA }] };
    const sug = sugerirContatoPrincipal(e, r.contatos, r)!;
    expect(sug.contato.id).toBe('c2'); // expansao + projeto de expansao
    expect(sug.fit.razoes).toContain('oportunidade de expansão');
    expect(contatoElegivel(cs.find((c) => c.id === 'c4')!, r.supressoes)).toBe(false);
    expect(contatoElegivel(cs.find((c) => c.id === 'c5')!, r.supressoes)).toBe(false);
    // principal manual vence a sugestao
    const r2 = { ...r, contatos: r.contatos.map((c) => (c.id === 'c1' ? { ...c, isPrimario: true } : c)) };
    expect(contatoRecomendado('E1', r2)!.contato.id).toBe('c1');
    expect(contatoRecomendado('E1', r2)!.motivo).toContain('principal');
    // recomendacao: com decisor adequado e canal, mas sem sinal -> pesquisar sinais; com sinal -> contatar agora
    expect(recomendarAcao(e, r2, HOJE).estado).toBe('RESEARCH_SIGNALS');
    const r3: RadarDataset = { ...r2, sinais: [{ id: 'S', empresaId: 'E1', fonteId: 'F', fonteTipo: 'MANUAL', tipo: 'EXPANSION', titulo: 'x', descricao: '', eventoEm: HOJE, detectadoEm: AGORA, confianca: 1, scoreBase: 35, scoreEfetivo: 35, verificado: true, criadoEm: AGORA }] };
    const rec = recomendarAcao(e, r3, HOJE);
    expect(rec.estado).toBe('CONTACT_NOW'); expect(rec.contato?.contato.id).toBe('c1');
    // sem canal -> enriquecer; sem contato adequado -> buscar decisor
    const semCanal = { ...r3, contatos: r3.contatos.map((c) => (c.id === 'c1' ? { ...c, email: undefined, statusEmail: undefined } : c)) };
    expect(recomendarAcao(e, semCanal, HOJE).estado).toBe('ENRICH_CONTACT');
    const soCompras = { ...r3, contatos: r3.contatos.filter((c) => c.id === 'c3') };
    expect(recomendarAcao(e, soCompras, HOJE).estado).toBe('SEARCH_DECISION_MAKER');
    expect(recomendarAcao(e, { ...r3, contatos: [] }, HOJE).estado).toBe('SEARCH_DECISION_MAKER');
  });
});

describe('associacao de empresa na importacao de contatos', () => {
  const es = [
    empresa({ id: 'A', razaoSocial: 'Acme Indústria LTDA', dominio: 'acme.com.br', fonteExternaId: 'VIBE-1', uf: 'GO' }),
    empresa({ id: 'B', razaoSocial: 'Acme Indústria LTDA', dominio: 'acme-mg.com.br', fonteExternaId: 'VIBE-2', uf: 'MG' }),
    empresa({ id: 'C', razaoSocial: 'Beta Logística', dominio: 'beta.com' }),
  ];
  it('id externo > dominio > nome; ambiguidade vai para revisao e nao cria empresa', () => {
    expect(associarEmpresaContato({ empresaExternoId: 'VIBE-2', empresaNome: 'Acme' }, es)).toMatchObject({ nivel: 'certo', empresa: { id: 'B' } });
    expect(associarEmpresaContato({ empresaDominio: 'www.beta.com', empresaNome: 'outro' }, es)).toMatchObject({ nivel: 'certo', empresa: { id: 'C' } });
    expect(associarEmpresaContato({ empresaNome: 'Beta Logistica' }, es)).toMatchObject({ nivel: 'provavel', empresa: { id: 'C' } });
    const amb = associarEmpresaContato({ empresaNome: 'ACME INDUSTRIA' }, es);
    expect(amb.nivel).toBe('ambiguo'); expect(amb.empresa).toBeUndefined(); expect(amb.candidatos.map((c) => c.empresaId).sort()).toEqual(['A', 'B']);
    expect(associarEmpresaContato({ empresaNome: 'ACME INDUSTRIA', uf: 'MG' }, es)).toMatchObject({ nivel: 'provavel', empresa: { id: 'B' } });
    expect(associarEmpresaContato({ empresaNome: 'Beta Logistica Transportes' }, es).nivel).toBe('ambiguo');
    expect(associarEmpresaContato({ empresaNome: 'Zeta' }, es).nivel).toBe('nenhum');
  });
});

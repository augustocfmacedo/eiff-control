// Communication Hardening 01: linguagem por fonte, WHY NOW factual, fact gate (claims), claims tecnicos, fonte
// confidencial, saudacao, idempotencia (context_hash) e estados. Dados FICTICIOS.
import { describe, expect, it } from 'vitest';
import { CLAIMS_TECNICOS, CONTENT_SPEC_VERSION, PLAYBOOK_VERSION, buildCommunicationContext, claimsTecnicos, contextHashDe, montarContentSpec, referenciaAoSinal, type EntradaContexto } from './comunicacao';
import { PROMPT_VERSION, gerarComunicacaoSincrona, saudacao, validarGeracao, type ResultadoGeracao } from './comunicacaoGeracao';
import { FONTES_PADRAO } from './padroes';
import type { Atividade, Contato, Empresa, Fonte, Persona, Sinal } from './types';

const fontes: Fonte[] = [...FONTES_PADRAO, { id: 'FONTE-OFICIAL', codigo: 'OFFICIAL_COMPANY_SOURCE', nome: 'Comunicado oficial da empresa', tipo: 'WEBSITE', descricao: '', confiabilidade: 0.95, ativo: true, criadoEm: '' }];
const F = (codigo: string) => fontes.find((f) => f.codigo === codigo)!;
const empresa = (id: string, nome: string): Empresa => ({ id, razaoSocial: nome, pais: 'Brasil', cidade: 'Cidade Fictícia', uf: 'GO', faixaFuncionarios: '[1001-5000]', fonteId: F('VIBE').id, observacoes: '', ativo: true, criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '', fitScore: 80, intentScore: 0, timingScore: 20, relationshipScore: 0, dataQualityScore: 60, priorityScore: 30, priorityClass: 'C' });
const contato = (id: string, empresaId: string, nome: string, cargo: string, persona: Persona, fit: number, extra: Partial<Contato> = {}): Contato => ({ id, empresaId, nome, cargo, persona, decisionFitScore: fit, senioridade: 'C-level', email: `${id}@exemplo.invalid`, statusEmail: 'valido', celular: '+55 62 90000-0000', fonteId: F('VIBE').id, ativo: true, criadoEm: '2026-09-02T00:00:00.000Z', atualizadoEm: '', qualidade: 70, decisor: fit >= 70, ...extra } as Contato);
const sinal = (id: string, empresaId: string, tipo: Sinal['tipo'], titulo: string, fonteCodigo: string, oQue?: string): Sinal => ({ id, empresaId, fonteId: F(fonteCodigo).id, fonteTipo: F(fonteCodigo).tipo, tipo, titulo, descricao: '', eventoEm: '2026-06-01', detectadoEm: '2026-09-01', confianca: 0.9, url: 'https://exemplo.invalid/x', payload: oQue ? { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: oQue, porQueImporta: 'interpretação interna' } } : undefined, scoreBase: 55, scoreEfetivo: 50, verificado: true, criadoEm: '' });
const REM = { nome: 'Vendedor Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' };
const E1 = empresa('E1', 'Beneficiadora Fictícia S.A.');
const CEO = contato('C1', 'E1', 'Presidente Fictício', 'Presidente', 'CEO', 55);
const ENG = contato('C2', 'E1', 'Diretora Fictícia', 'Diretora de engenharia', 'ENGINEERING_DIRECTOR', 92, { senioridade: 'Diretor' });
const COMP = contato('C3', 'E1', 'Comprador Fictício', 'Gerente de compras', 'PROCUREMENT', 44, { senioridade: 'Gerente' });
const base = (x: Partial<EntradaContexto>): EntradaContexto => ({ empresa: E1, contato: CEO, atividades: [], contatos: [CEO, ENG, COMP], fontes, fitIdeal: 70, proximaAcaoAtual: 'SEARCH_DECISION_MAKER', hoje: '2026-09-09', ...x });
const gerar = (x: Partial<EntradaContexto>, canal: 'WHATSAPP' | 'EMAIL' | 'PHONE' = 'WHATSAPP', hora?: number) => { const ctx = buildCommunicationContext(base(x)); const spec = montarContentSpec(ctx, canal, REM, { horaLocal: hora }); return { ctx, spec, g: gerarComunicacaoSincrona(spec) }; };

describe('Communication Hardening 01', () => {
  it('linguagem por fonte: CNO e PNCP não viram notícia; NEWS pode; fonte oficial usa comunicado; PARTNER/MANUAL/CSV/VIBE são neutros; sem códigos internos', () => {
    expect(referenciaAoSinal('NEWS', 'NEW_FACTORY', 'a nova fábrica')).toBe('a notícia sobre a nova fábrica');
    expect(referenciaAoSinal('OFFICIAL_COMPANY_SOURCE', 'NEW_FACTORY', 'a nova fábrica')).toBe('o comunicado da empresa sobre a nova fábrica');
    expect(referenciaAoSinal('WEBSITE', 'EXPANSION', 'a ampliação')).toBe('a publicação da empresa sobre a ampliação');
    expect(referenciaAoSinal('CNO', 'CNO_NEW', 'a obra')).toBe('o registro de obra de a obra'.replace('de a ', 'de a ')); // registro de obra
    expect(referenciaAoSinal('CNO', 'CNO_NEW', 'galpão')).not.toMatch(/not[ií]cia/);
    expect(referenciaAoSinal('PNCP', 'PUBLIC_TENDER', 'galpão')).toBe('a contratação pública de galpão');
    expect(referenciaAoSinal('PNCP', 'PUBLIC_PLAN', 'galpão')).toContain('plano de contratação');
    expect(referenciaAoSinal('PNCP', 'NEWS', 'galpão')).not.toMatch(/not[ií]cia/);
    expect(referenciaAoSinal('LINKEDIN', 'NEWS', 'x')).toBe('a publicação sobre x');
    for (const f of ['PARTNER', 'MANUAL', 'CSV', 'VIBE', 'CNPJ_RFB', undefined]) { const r = referenciaAoSinal(f, 'NEW_FACTORY', 'a nova fábrica'); expect(r).toBe('o movimento relacionado a a nova fábrica'.replace('a a ', 'a a ')); expect(r).not.toMatch(/not[ií]cia|parceiro|manual|csv|vibe|receita/i); }
    for (const f of ['CNO', 'PNCP', 'NEWS', 'PARTNER']) expect(referenciaAoSinal(f, 'NEWS', 'x')).not.toContain(f);
    // no texto gerado: sinal CNO so com titulo
    const { g } = gerar({ sinal: sinal('S1', 'E1', 'CNO_NEW', 'galpão industrial de 5 mil m²', 'CNO') });
    expect(g.versaoPrincipal).toContain('Acompanhei o registro de obra de galpão industrial de 5 mil m² (01/06/2026).'); expect(g.versaoPrincipal).not.toMatch(/not[ií]cia/);
    const off = gerar({ sinal: sinal('S2', 'E1', 'NEW_FACTORY', 'nova unidade', 'OFFICIAL_COMPANY_SOURCE') }).g.versaoPrincipal; expect(off).toContain('o comunicado da empresa sobre nova unidade');
    const news = gerar({ sinal: sinal('S3', 'E1', 'NEWS', 'expansão anunciada', 'NEWS') }).g.versaoPrincipal; expect(news).toContain('a notícia sobre expansão anunciada');
    const man = gerar({ sinal: sinal('S4', 'E1', 'NEW_FACTORY', 'nova unidade', 'MANUAL') }).g.versaoPrincipal; expect(man).toContain('o movimento relacionado a nova unidade'); expect(man).not.toMatch(/not[ií]cia/);
  });
  it('WHY NOW separa FACT, INTERPRETATION e INTERNAL_REASONING; só FACT vai ao prospect; PARTNER não é divulgável', () => {
    const { ctx, spec, g } = gerar({ sinal: sinal('S5', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade de 20 mil m²') });
    expect(ctx.whyNowDetalhe.fato).toContain('20 mil m²'); expect(ctx.whyNowDetalhe.interpretacao).toBe('interpretação interna'); expect(ctx.whyNowDetalhe.raciocinioInterno).toContain('verificado');
    expect(spec.allowedClaims.every((c) => c.tipo === 'FACT' || c.tipo === 'TECHNICAL_CLAIM')).toBe(true);
    expect(spec.deniedClaims.find((c) => c.chave === 'sinal.porQueImporta')?.tipo).toBe('INTERPRETATION');
    expect(g.versaoPrincipal).not.toContain('interpretação interna');
    const parceiro = gerar({ sinal: sinal('S6', 'E1', 'PARTNER_REFERRAL', 'projeto de galpão', 'PARTNER', 'Um parceiro relatou projeto de galpão de 3 mil m²') });
    expect(parceiro.ctx.fatosPermitidos.some((f) => f.origem === 'sinal')).toBe(false); // fonte confidencial: nada do sinal e apresentavel
    expect(parceiro.ctx.whyNow).toBeUndefined(); expect(parceiro.g.versaoPrincipal).not.toContain('3 mil m²'); expect(parceiro.g.versaoPrincipal).not.toMatch(/parceiro|me contou|recebi/i);
    expect(parceiro.spec.deniedClaims.some((c) => c.divulgacao === 'INTERNAL_ONLY' && c.origem === 'sinal')).toBe(true);
  });
  it('fact gate: número, data e local fora dos claims permitidos são rejeitados; claim técnico não aprovado é rejeitado; claims usados pertencem a allowedClaims', () => {
    const { spec, g } = gerar({ sinal: sinal('S7', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade de 20 mil m²') });
    expect(validarGeracao(spec, g).ok).toBe(true);
    expect(spec.allowedClaims.every((c) => c.id && c.fonte !== undefined || c.origem === 'tecnico')).toBe(true);
    const com = (texto: string): ResultadoGeracao => ({ ...g, versaoPrincipal: texto });
    expect(validarGeracao(spec, com(g.versaoPrincipal.replace('20 mil m²', '20 mil m² e R$ 300 milhões'))).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/número sem fato permitido/)]));
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Inauguração em 12/05/2025.')).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/data sem fato permitido/)]));
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Vi a obra em Porto Alegre.')).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/entidade sem fato permitido: porto alegre/)]));
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Entrego peso estimado e prazo.')).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/claim técnico não aprovado: PESO_E_PRAZO/)]));
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Sei que a estrutura está em contratação.')).problemas).toContain('presume projeto aberto ou contratação');
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Como você é o responsável pela obra.')).problemas).toContain('presume responsabilidade do contato');
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Garantimos economia de 20% no aço.')).problemas).toEqual(expect.arrayContaining(['promete preço, prazo, economia ou engenharia sem autorização']));
    expect(validarGeracao(spec, { ...g, claimsUsados: ['sin:OUTRO:titulo'] }).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/claim fora de allowedClaims/)]));
    expect(validarGeracao(spec, com(g.versaoPrincipal.replace('indicar quem responde por essa frente?', 'marcar uma reunião?'))).problemas).toEqual(expect.arrayContaining(['CTA não corresponde ao objetivo']));
    expect(validarGeracao(spec, com(g.versaoPrincipal + ' Segue nosso catálogo.')).problemas).toEqual(expect.arrayContaining([expect.stringMatching(/elemento proibido presente: catálogo/)]));
    expect(claimsTecnicos().filter((c) => c.aprovado).map((c) => c.id)).not.toContain('tec:PESO_E_PRAZO'); expect(CLAIMS_TECNICOS.ECONOMIA.aprovado).toBe(false);
  });
  it('claims técnicos: REQUEST_PROJECT e OFFER_PRELIMINARY_STUDY só prometem o aprovado', () => {
    const ats: Atividade[] = [{ id: 'A1', empresaId: 'E1', contatoId: 'C2', usuarioId: 'U', tipo: 'CALL', canal: 'PHONE', ocorreuEm: '2026-09-05T10:00:00.000Z', resultado: 'ACTIVE_PROJECT', notas: '', criadoEm: '' }];
    const r1 = gerar({ contato: ENG, sinal: sinal('S8', 'E1', 'NEW_DC', 'novo CD', 'WEBSITE'), atividades: ats });
    expect(r1.ctx.objetivo).toBe('REQUEST_PROJECT'); expect(r1.g.versaoPrincipal).toContain('avaliar preliminarmente a solução estrutural e definir o próximo passo técnico'); expect(r1.g.versaoPrincipal).not.toMatch(/peso estimado|prazo/); expect(validarGeracao(r1.spec, r1.g).ok).toBe(true);
    const ats2: Atividade[] = [{ ...ats[0], id: 'A2', resultado: 'TECHNICAL_OBJECTION' }];
    const r2 = gerar({ contato: ENG, sinal: sinal('S8', 'E1', 'NEW_DC', 'novo CD', 'WEBSITE'), atividades: ats2 });
    expect(r2.ctx.objetivo).toBe('OFFER_PRELIMINARY_STUDY'); expect(r2.g.versaoPrincipal).toContain('área, uso, geometria, cargas relevantes e principais premissas'); expect(r2.g.versaoPrincipal).not.toMatch(/cargas básicas|estimativa de peso/); expect(validarGeracao(r2.spec, r2.g).ok).toBe(true);
    expect(r1.g.claimsUsados).toContain('tec:AVALIACAO_PRELIMINAR'); expect(r2.g.claimsUsados).toEqual(expect.arrayContaining(['tec:ANTEPROJETO', 'tec:INSUMOS_ESTUDO']));
  });
  it('saudação: sem hora é neutra; com hora varia; "bom dia" não é fixo', () => {
    expect(saudacao('Ana')).toBe('Olá, Ana.'); expect(saudacao('Ana', 9)).toBe('Ana, bom dia.'); expect(saudacao('Ana', 15)).toBe('Ana, boa tarde.'); expect(saudacao('Ana', 20)).toBe('Ana, boa noite.');
    const s = sinal('S9', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE');
    expect(gerar({ sinal: s }).g.versaoPrincipal.startsWith('Olá, Presidente.')).toBe(true);
    expect(gerar({ sinal: s }, 'WHATSAPP', 16).g.versaoPrincipal.startsWith('Presidente, boa tarde.')).toBe(true);
    expect(gerar({ sinal: s }, 'PHONE', 21).g.roteiroLigacao).toContain('boa noite');
  });
  it('semântica preservada: GET_REFERRAL, TECHNICAL_DISCOVERY e PROCUREMENT continuam distintos; idempotência por context_hash; versões registradas', () => {
    const s = sinal('S10', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade');
    const a = gerar({ sinal: s }); const b = gerar({ contato: ENG, sinal: s }); const c = gerar({ contato: COMP, sinal: s }, 'EMAIL');
    expect([a.ctx.playbook, b.ctx.playbook, c.ctx.playbook]).toEqual(['ACCESS_VIA_EXECUTIVE', 'TECHNICAL_DISCOVERY', 'PROCUREMENT_ROUTING']);
    expect(a.g.versaoPrincipal).toContain('indicar quem responde'); expect(b.g.versaoPrincipal).toContain('estágio'); expect(c.g.versaoPrincipal).toContain('cadastro'); expect(c.g.versaoPrincipal).not.toContain('estruturas metálicas');
    expect(new Set([a.spec.contextHash, b.spec.contextHash, c.spec.contextHash]).size).toBe(3);
    expect(gerar({ sinal: s }).spec.contextHash).toBe(a.spec.contextHash); // mesmo contexto, mesmo hash
    expect(gerar({ sinal: s }, 'EMAIL').spec.contextHash).not.toBe(a.spec.contextHash); // canal muda o hash
    expect(contextHashDe({ empresaId: 'E1', contatoId: 'C1', objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', canal: 'WHATSAPP', claims: [], versoes: { playbook: '1', contentSpec: '1' } })).toMatch(/^[0-9a-f]{16}$/);
    expect(a.spec.versoes).toEqual({ playbook: PLAYBOOK_VERSION, contentSpec: CONTENT_SPEC_VERSION }); expect(a.g.metadados.promptVersao).toBe(PROMPT_VERSION); expect(a.g.metadados.contextHash).toBe(a.spec.contextHash);
    expect(JSON.stringify(a.spec)).not.toContain('bruto'); // nunca raw_payload
  });
});

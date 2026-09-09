// Communication Persistence 01: codigos internos nunca ao prospect, indicacao ALLOWED/INTERNAL_ONLY, SHA-256 canonico,
// snapshot persistivel sem PII/raw, invariantes SENT/REPLIED. Dados FICTICIOS.
import { describe, expect, it } from 'vitest';
import { OBJETIVOS_COMUNICACAO, PLAYBOOKS_CODIGOS, REFERENCIA_PUBLICA_SINAL, buildCommunicationContext, contentSpecPersistivel, contextHashDe, montarContentSpec, referenciaPublicaDoSinal, validarTransicaoComunicacao, type EntradaContexto } from './comunicacao';
import { gerarComunicacaoSincrona, validarGeracao } from './comunicacaoGeracao';
import { hashCanonico, jsonCanonico, sha256Hex } from './hash';
import { FONTES_PADRAO } from './padroes';
import { TIPOS_SINAL, type Atividade, type Contato, type Empresa, type Fonte, type Persona, type Sinal } from './types';

const fontes: Fonte[] = FONTES_PADRAO;
const F = (codigo: string) => fontes.find((f) => f.codigo === codigo)!;
const empresa = (id: string, nome: string): Empresa => ({ id, razaoSocial: nome, pais: 'Brasil', cidade: 'Cidade Fictícia', uf: 'GO', faixaFuncionarios: '[1001-5000]', fonteId: F('VIBE').id, observacoes: '', ativo: true, criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '', fitScore: 80, intentScore: 0, timingScore: 20, relationshipScore: 0, dataQualityScore: 60, priorityScore: 30, priorityClass: 'C' });
const contato = (id: string, empresaId: string, nome: string, cargo: string, persona: Persona, fit: number, extra: Partial<Contato> = {}): Contato => ({ id, empresaId, nome, cargo, persona, decisionFitScore: fit, senioridade: 'C-level', email: `${id}@exemplo.invalid`, statusEmail: 'valido', celular: '+55 62 90000-0000', linkedin: 'https://linkedin.invalid/x', fonteId: F('VIBE').id, ativo: true, criadoEm: '2026-09-02T00:00:00.000Z', atualizadoEm: '', qualidade: 70, decisor: fit >= 70, ...extra } as Contato);
const sinal = (id: string, empresaId: string, tipo: Sinal['tipo'], titulo: string, fonteCodigo: string, oQue?: string): Sinal => ({ id, empresaId, fonteId: F(fonteCodigo).id, fonteTipo: F(fonteCodigo).tipo, tipo, titulo, descricao: '', eventoEm: '2026-06-01', detectadoEm: '2026-09-01', confianca: 0.9, url: 'https://exemplo.invalid/x', payload: { bruto: { raw_payload: { telefone: '62999990000' } }, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: oQue, porQueImporta: 'interpretação' } }, scoreBase: 55, scoreEfetivo: 50, verificado: true, criadoEm: '' });
const REM = { nome: 'Vendedor Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' };
const E1 = empresa('E1', 'Beneficiadora Fictícia S.A.');
const CEO = contato('C1', 'E1', 'Presidente Fictício', 'Presidente', 'CEO', 55);
const ENG = contato('C2', 'E1', 'Diretora Fictícia', 'Diretora de engenharia', 'ENGINEERING_DIRECTOR', 92, { senioridade: 'Diretor', criadoEm: '2026-09-05T00:00:00.000Z' });
const base = (x: Partial<EntradaContexto>): EntradaContexto => ({ empresa: E1, contato: CEO, atividades: [], contatos: [CEO, ENG], fontes, fitIdeal: 70, proximaAcaoAtual: 'SEARCH_DECISION_MAKER', hoje: '2026-09-09', ...x });
const gerar = (x: Partial<EntradaContexto>, canal: 'WHATSAPP' | 'EMAIL' | 'PHONE' = 'WHATSAPP') => { const ctx = buildCommunicationContext(base(x)); const spec = montarContentSpec(ctx, canal, REM); return { ctx, spec, g: gerarComunicacaoSincrona(spec) }; };
const textoCompleto = (g: ReturnType<typeof gerarComunicacaoSincrona>) => [g.versaoPrincipal, ...g.versoesAlternativas, g.assunto ?? '', g.roteiroLigacao ?? '', ...g.objecoes.flatMap((o) => [o.gatilho, o.resposta])].join('\n');
const CODIGOS_INTERNOS = [...TIPOS_SINAL, ...OBJETIVOS_COMUNICACAO, ...PLAYBOOKS_CODIGOS, 'INTERNAL_ONLY', 'ALLOWED', 'DIRECT', 'INDIRECT'];

describe('Communication Persistence 01', () => {
  it('nenhum código interno (tipo de sinal, objetivo, playbook, relevância) aparece em nada que vai ao prospect, com ou sem título', () => {
    for (const tipo of ['NEW_FACTORY', 'CNO_NEW', 'PUBLIC_TENDER', 'NEW_DC', 'WAREHOUSE', 'CNO_EXPANSION', 'EXPANSION', 'PUBLIC_PLAN'] as const) {
      for (const canal of ['WHATSAPP', 'EMAIL', 'PHONE'] as const) {
        for (const contato of [CEO, ENG]) {
          const comTitulo = gerar({ contato, sinal: sinal('S', 'E1', tipo, 'ampliação do parque fabril', tipo.startsWith('CNO') ? 'CNO' : tipo.startsWith('PUBLIC') ? 'PNCP' : 'WEBSITE') }, canal);
          const semTitulo = gerar({ contato, sinal: sinal('S', 'E1', tipo, '', tipo.startsWith('CNO') ? 'CNO' : 'WEBSITE') }, canal);
          for (const g of [comTitulo.g, semTitulo.g]) { const t = textoCompleto(g); for (const c of CODIGOS_INTERNOS) expect(t.includes(c), `${tipo}/${canal}: ${c} exposto`).toBe(false); }
          expect(validarGeracao(comTitulo.spec, comTitulo.g).ok).toBe(true);
        }
      }
    }
    expect(referenciaPublicaDoSinal('NEW_FACTORY')).toBe('nova unidade industrial'); expect(referenciaPublicaDoSinal('CNO_NEW')).toBe('nova obra registrada'); expect(referenciaPublicaDoSinal('PUBLIC_TENDER')).toBe('contratação pública');
    expect(referenciaPublicaDoSinal('NEW_DC', 'novo CD em Cidade Fictícia')).toBe('novo CD em Cidade Fictícia'); // factual especifico quando existe
    for (const t of TIPOS_SINAL) expect(REFERENCIA_PUBLICA_SINAL[t]).toMatch(/^[a-zçãõáéíóú ]+$/);
    const email = gerar({ contato: ENG, sinal: sinal('S', 'E1', 'NEW_DC', '', 'WEBSITE') }, 'EMAIL').g; expect(email.assunto).toContain('Novo centro de distribuição'); expect(email.assunto).not.toContain('NEW_DC');
  });
  it('indicação: ALLOWED cita quem indicou; INTERNAL_ONLY abre de forma neutra e o gate bloqueia a citação', () => {
    const ats: Atividade[] = [{ id: 'A1', empresaId: 'E1', contatoId: 'C1', usuarioId: 'U', tipo: 'CALL', canal: 'WHATSAPP', ocorreuEm: '2026-09-04T10:00:00.000Z', resultado: 'REFERRED_TO_OTHER_PERSON', notas: '', criadoEm: '' }];
    const s = sinal('S1', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade');
    const neutro = gerar({ contato: ENG, sinal: s, atividades: ats });
    expect(neutro.ctx.playbook).toBe('REFERRAL_INTRODUCTION'); expect(neutro.spec.sourceDisclosure).toBe('INTERNAL_ONLY'); expect(neutro.spec.contextoIndicacao).not.toContain('Presidente');
    expect(neutro.g.versaoPrincipal).toContain('Cheguei ao seu contato ao buscar quem acompanha essa frente'); expect(neutro.g.versaoPrincipal).not.toMatch(/como respons[áa]vel/); expect(neutro.g.versaoPrincipal).not.toContain('Presidente Fictício'); expect(validarGeracao(neutro.spec, neutro.g).ok).toBe(true);
    expect(validarGeracao(neutro.spec, { ...neutro.g, versaoPrincipal: neutro.g.versaoPrincipal + ' O Presidente Fictício me indicou você.' }).problemas).toEqual(expect.arrayContaining(['revela fonte confidencial sem autorização']));
    const cita = gerar({ contato: ENG, sinal: s, atividades: ats, citarIndicacao: true });
    expect(cita.spec.sourceDisclosure).toBe('ALLOWED'); expect(cita.g.versaoPrincipal).toContain('Presidente Fictício me indicou'); expect(validarGeracao(cita.spec, cita.g).ok).toBe(true);
    expect(cita.spec.contextHash).not.toBe(neutro.spec.contextHash); // sourceDisclosure muda o hash
  });
  it('hash: SHA-256 canônico, estável para o mesmo contexto, diferente ao mudar canal, claim ou divulgação', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(jsonCanonico({ b: 1, a: [{ z: 1, y: 2 }], c: undefined })).toBe('{"a":[{"y":2,"z":1}],"b":1}');
    expect(hashCanonico({ a: 1, b: 2 })).toBe(hashCanonico({ b: 2, a: 1 }));
    const s = sinal('S1', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade');
    const a = gerar({ sinal: s }); const b = gerar({ sinal: s });
    expect(a.spec.contextHash).toMatch(/^[0-9a-f]{64}$/); expect(a.spec.contextHash).toBe(b.spec.contextHash);
    expect(gerar({ sinal: s }, 'EMAIL').spec.contextHash).not.toBe(a.spec.contextHash);
    expect(gerar({ sinal: sinal('S1', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade de 20 mil m²') }).spec.contextHash).not.toBe(a.spec.contextHash); // claim mudou
    expect(gerar({ sinal: { ...s, id: 'S2' } }).spec.contextHash).not.toBe(a.spec.contextHash); // sinal mudou
    expect(gerar({ contato: ENG, sinal: s }).spec.contextHash).not.toBe(a.spec.contextHash); // contato/playbook mudou
    const claims = [{ id: 'b', texto: '2' }, { id: 'a', texto: '1' }];
    expect(contextHashDe({ empresaId: 'E', contatoId: 'C', objetivo: 'O', playbook: 'P', canal: 'EMAIL', claims, versoes: { playbook: '1', contentSpec: '1' } })).toBe(contextHashDe({ empresaId: 'E', contatoId: 'C', objetivo: 'O', playbook: 'P', canal: 'EMAIL', claims: [...claims].reverse(), versoes: { playbook: '1', contentSpec: '1' } }));
    expect(contextHashDe({ empresaId: 'E', contatoId: 'C', objetivo: 'O', playbook: 'P', canal: 'EMAIL', claims, versoes: { playbook: '2', contentSpec: '1' } })).not.toBe(contextHashDe({ empresaId: 'E', contatoId: 'C', objetivo: 'O', playbook: 'P', canal: 'EMAIL', claims, versoes: { playbook: '1', contentSpec: '1' } }));
  });
  it('snapshot persistível: sem raw_payload, telefone, e-mail, LinkedIn ou perfil; com claims permitidos, objetivo, playbook, canal, CTA e versões', () => {
    const { spec } = gerar({ sinal: sinal('S1', 'E1', 'NEW_FACTORY', 'nova unidade', 'WEBSITE', 'A Beneficiadora Fictícia inaugurou nova unidade') });
    const p = contentSpecPersistivel(spec); const j = JSON.stringify(p);
    for (const proibido of ['bruto', 'raw_payload', '62 90000', 'C1@exemplo.invalid', 'linkedin.invalid', 'celular', 'telefone', '"email"', '"nome":"Presidente Fictício"']) expect(j.includes(proibido), proibido).toBe(false);
    expect(p).toMatchObject({ objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', canal: 'WHATSAPP', sourceDisclosure: 'INTERNAL_ONLY', versoes: spec.versoes, contextHash: spec.contextHash }); // sem indicação real não há fonte a divulgar (Server Truth 01)
    expect((p.allowedClaims as { id: string; verificado: boolean }[]).every((c) => c.verificado)).toBe(true);
    expect((p.deniedClaims as { motivo: string }[]).some((c) => c.motivo === 'INTERPRETATION')).toBe(true);
    expect(p.cta).toBe(spec.cta);
    // round-trip: o snapshot carregado do banco volta identico (senao o update reescreveria a evidencia e o trigger de imutabilidade recusaria)
    expect(contentSpecPersistivel(JSON.parse(JSON.stringify(p)) as never)).toEqual(p);
  });
  it('invariantes: SENT exige atividade de envio, REPLIED exige envio e resposta, READY_FOR_REVIEW não vai direto a SENT', () => {
    expect(validarTransicaoComunicacao('READY_FOR_REVIEW', 'SENT', { atividadeEnvioId: 'A1' }).ok).toBe(false);
    expect(validarTransicaoComunicacao('APPROVED', 'SENT', {}).ok).toBe(false);
    expect(validarTransicaoComunicacao('APPROVED', 'SENT', { atividadeEnvioId: 'A1' }).ok).toBe(true);
    expect(validarTransicaoComunicacao('SENT', 'REPLIED', { atividadeEnvioId: 'A1' }).ok).toBe(false);
    expect(validarTransicaoComunicacao('SENT', 'REPLIED', { atividadeEnvioId: 'A1', atividadeRespostaId: 'A2' }).ok).toBe(true);
    expect(validarTransicaoComunicacao('DRAFT', 'SENT', { atividadeEnvioId: 'A1' }).ok).toBe(false);
  });
});

// Communication Intelligence 01: contexto, objetivos, playbooks, canal, spec, geracao e estados. Dados FICTICIOS; o fixture
// "conta piloto" reproduz a estrutura do Access Pilot (executivo sem decisor ideal + sinal de fabrica) sem nomes reais.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESTADO_MAXIMO_AUTOMATICO, OBJETIVOS, PLAYBOOKS, TRANSICOES_COMUNICACAO, TRANSICOES_RESULTADO, buildCommunicationContext, fatosDoSinal, historicoDe, montarContentSpec, recomendarCanal, selecionarPlaybook, transicaoComunicacaoValida, type EntradaContexto } from './comunicacao';
import { generateCommunication, gerarComunicacaoSincrona, validarGeracao } from './comunicacaoGeracao';
import { FONTES_PADRAO } from './padroes';
import type { Atividade, Contato, Empresa, Persona, Sinal } from './types';

const fontes = FONTES_PADRAO;
const vibe = fontes.find((f) => f.codigo === 'VIBE')!; const site = fontes.find((f) => f.codigo === 'WEBSITE')!; const manual = fontes.find((f) => f.codigo === 'MANUAL')!;
const empresa = (id: string, nome: string, cidade: string): Empresa => ({ id, razaoSocial: nome, pais: 'Brasil', cidade, uf: 'GO', setor: 'Indústria', faixaFuncionarios: '[1001-5000]', fonteId: vibe.id, observacoes: '', ativo: true, criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '', fitScore: 80, intentScore: 0, timingScore: 20, relationshipScore: 0, dataQualityScore: 60, priorityScore: 30, priorityClass: 'C' });
const contato = (id: string, empresaId: string, nome: string, cargo: string, persona: Persona, fit: number, extra: Partial<Contato> = {}): Contato => ({ id, empresaId, nome, cargo, persona, decisionFitScore: fit, senioridade: 'C-level', email: `${id}@exemplo.invalid`, statusEmail: 'valido', celular: '+55 62 90000-0000', fonteId: vibe.id, ativo: true, criadoEm: '2026-09-02T00:00:00.000Z', atualizadoEm: '', qualidade: 70, decisor: fit >= 70, ...extra } as Contato);
const sinal = (id: string, empresaId: string, tipo: Sinal['tipo'], titulo: string, oQue: string, verificado = true, fonteId = site.id): Sinal => ({ id, empresaId, fonteId, fonteTipo: 'WEBSITE', tipo, titulo, descricao: '', eventoEm: '2026-06-01', detectadoEm: '2026-09-01', confianca: 0.9, url: 'https://exemplo.invalid/noticia', payload: { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: oQue, porQueImporta: 'leitura interna do analista' } }, scoreBase: 55, scoreEfetivo: 50, verificado, criadoEm: '' });
const atividade = (id: string, empresaId: string, contatoId: string, tipo: Atividade['tipo'], canal: Atividade['canal'], ocorreuEm: string, resultado?: Atividade['resultado']): Atividade => ({ id, empresaId, contatoId, usuarioId: 'U', tipo, canal, ocorreuEm, resultado, notas: '', criadoEm: ocorreuEm });
const REMETENTE = { nome: 'Vendedor Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' };
const base = (x: Partial<EntradaContexto> & Pick<EntradaContexto, 'empresa'>): EntradaContexto => ({ contato: undefined, atividades: [], contatos: [], fontes, fitIdeal: 70, proximaAcaoAtual: 'SEARCH_DECISION_MAKER', hoje: '2026-09-08', ...x });

// fixture 1: executivo sem decisor ideal + sinal de fabrica verificado (estrutura do piloto de acesso, nomes ficticios)
const E1 = empresa('E1', 'Beneficiadora Fictícia S.A.', 'Cidade Fictícia');
const CEO = contato('C1', 'E1', 'Presidente Fictício', 'Presidente / chief executive officer', 'CEO', 55);
const S1 = sinal('S1', 'E1', 'NEW_FACTORY', 'Nova unidade de beneficiamento', 'A Beneficiadora Fictícia colocou em operação uma nova unidade de beneficiamento em Cidade Fictícia, com investimento de R$ 100 milhões e 20 mil m² construídos');
// fixture 2: diretor de engenharia + centro de distribuicao
const E2 = empresa('E2', 'Distribuidora Fictícia Ltda', 'Outra Cidade');
const ENG = contato('C2', 'E2', 'Diretora Fictícia', 'Diretora de engenharia', 'ENGINEERING_DIRECTOR', 92, { senioridade: 'Diretor' });
const S2 = sinal('S2', 'E2', 'NEW_DC', 'Novo centro de distribuição', 'A Distribuidora Fictícia anunciou um novo centro de distribuição de 15 mil m²');
// fixture 3: compras
const COMP = contato('C3', 'E2', 'Comprador Fictício', 'Gerente de compras', 'PROCUREMENT', 44, { senioridade: 'Gerente' });

describe('Communication Intelligence 01', () => {
  it('só fato verificado vira fato permitido; fonte, confiança, data e URL preservadas; leitura "por que importa" nunca é fato', () => {
    const naoVer = sinal('S9', 'E1', 'NEWS', 'Notícia não verificada', 'Boato de expansão', false, manual.id);
    const ctx = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: naoVer }));
    expect(ctx.fatosPermitidos.some((f) => f.origem === 'sinal')).toBe(false);
    expect(ctx.fatosNaoVerificados.map((f) => f.chave)).toEqual(expect.arrayContaining(['sinal.titulo', 'sinal.oQueAconteceu', 'sinal.porQueImporta']));
    expect(ctx.whyNow).toBeUndefined(); expect(ctx.whyNowDetalhe.raciocinioInterno).toContain('NÃO verificado');
    const f = fatosDoSinal(S1, fontes).find((x) => x.chave === 'sinal.oQueAconteceu')!;
    expect(f).toMatchObject({ verificado: true, confianca: 0.9, eventoEm: '2026-06-01', url: 'https://exemplo.invalid/noticia', fonte: 'WEBSITE' });
    expect(fatosDoSinal(S1, fontes).find((x) => x.chave === 'sinal.porQueImporta')!.verificado).toBe(false);
    const ctx2 = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1 }));
    expect(ctx2.alegacoesPermitidas).toContain(S1.titulo); expect(ctx2.alegacoesProibidas.some((a) => a.includes('responsável pela obra'))).toBe(true);
  });
  it('fixture executivo: CEO sem decisor ideal -> GET_REFERRAL / ACCESS_VIA_EXECUTIVE, canal WhatsApp ou telefone, CTA de indicação; texto sem nomes hardcoded', async () => {
    const ctx = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1 }));
    expect(ctx).toMatchObject({ comunicar: true, objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', estagio: 'RESEARCHING', tom: 'executivo_direto' });
    expect(['WHATSAPP', 'PHONE']).toContain(ctx.canal.primario);
    expect(ctx.cta).toContain('indicar quem responde');
    expect(ctx.whyNow).toContain('R$ 100 milhões');
    const spec = montarContentSpec(ctx, 'WHATSAPP', REMETENTE);
    expect(spec).toMatchObject({ objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', canal: 'WHATSAPP', tom: 'executivo_direto', maxPalavras: 90 });
    expect(spec.allowedClaims.map((f) => f.chave)).toContain('sinal.oQueAconteceu'); expect(spec.deniedClaims.map((f) => f.chave)).toContain('sinal.porQueImporta');
    expect(spec.elementosProibidos).toContain('preço'); expect(spec.alegacoesProibidas.some((a) => a.includes('licitação'))).toBe(true);
    const g = await generateCommunication(spec);
    expect(g.versaoPrincipal).toContain('Olá, Presidente.'); expect(g.versaoPrincipal).toContain('R$ 100 milhões'); expect(g.versaoPrincipal).toContain('indicar quem responde'); expect(g.versaoPrincipal).toContain('estruturas metálicas');
    expect(g.versaoPrincipal).not.toMatch(/reunião|portfólio|orçamento|proposta/i);
    expect(g.versoesAlternativas).toHaveLength(1); expect(g.objecoes.length).toBeGreaterThanOrEqual(5); expect(g.claimsUsados).toContain('sin:S1:oQueAconteceu');
    expect(validarGeracao(spec, g).ok).toBe(true);
    const email = gerarComunicacaoSincrona(montarContentSpec(ctx, 'EMAIL', REMETENTE)); expect(email.assunto).toContain('quem responde por engenharia');
    const tel = gerarComunicacaoSincrona(montarContentSpec(ctx, 'PHONE', REMETENTE)); expect(tel.roteiroLigacao).toContain('indicar quem responde');
  });
  it('fixture engenharia: diretora de engenharia + novo CD -> UNDERSTAND_PROJECT_STAGE / TECHNICAL_DISCOVERY, nunca GET_REFERRAL', () => {
    const ctx = buildCommunicationContext(base({ empresa: E2, contato: ENG, sinal: S2 }));
    expect(ctx).toMatchObject({ objetivo: 'UNDERSTAND_PROJECT_STAGE', playbook: 'TECHNICAL_DISCOVERY', estagio: 'DECISION_MAKER_FOUND' });
    expect(ctx.objetivo).not.toBe('GET_REFERRAL'); expect(ctx.cta).toContain('estágio');
    expect(ctx.canal.primario).toBe('PHONE');
    const g = gerarComunicacaoSincrona(montarContentSpec(ctx, 'WHATSAPP', REMETENTE));
    expect(g.versaoPrincipal).toContain('15 mil m²'); expect(g.versaoPrincipal).toContain('estágio'); expect(g.versaoPrincipal).not.toContain('indicar quem responde');
  });
  it('fixture compras: PROCUREMENT -> PROCUREMENT_ROUTING, e-mail primeiro, sem substituir a engenharia', () => {
    const ctx = buildCommunicationContext(base({ empresa: E2, contato: COMP, sinal: S2 }));
    expect(ctx).toMatchObject({ objetivo: 'PROCUREMENT_ROUTING', playbook: 'PROCUREMENT_ROUTING', tom: 'formal_processual' });
    expect(ctx.canal.primario).toBe('EMAIL');
    expect(ctx.cta).toContain('interlocutor técnico');
    const g = gerarComunicacaoSincrona(montarContentSpec(ctx, 'EMAIL', REMETENTE));
    expect(g.versaoPrincipal).toContain('cadastro'); expect(g.versaoPrincipal).not.toContain('estruturas metálicas'); // sem venda para compras
  });
  it('indicação -> REFERRAL_INTRODUCTION citando quem indicou; NO_RESPONSE -> FOLLOW_UP com troca de canal; NO_PROJECT -> sem comunicação', () => {
    const indicado = contato('C4', 'E1', 'Engenheiro Indicado', 'Gerente de engenharia', 'ENGINEERING', 66, { senioridade: 'Gerente', criadoEm: '2026-09-05T00:00:00.000Z' });
    const ats = [atividade('A1', 'E1', 'C1', 'CALL', 'WHATSAPP', '2026-09-04T10:00:00.000Z', 'REFERRED_TO_OTHER_PERSON')];
    const ctx = buildCommunicationContext(base({ empresa: E1, contato: indicado, sinal: S1, atividades: ats, contatos: [CEO, indicado] }));
    expect(ctx.indicacao?.porNome).toBe('Presidente Fictício');
    expect(ctx).toMatchObject({ objetivo: 'START_DISCOVERY', playbook: 'REFERRAL_INTRODUCTION' }); expect(ctx.canal.secundario).toBe('REFERRAL');
    const g = gerarComunicacaoSincrona(montarContentSpec(ctx, 'WHATSAPP', REMETENTE)); expect(g.versaoPrincipal).not.toContain('me indicou'); // sem autorizacao, a fonte da indicacao nao e revelada
    const ctxCit = buildCommunicationContext(base({ empresa: E1, contato: indicado, sinal: S1, atividades: ats, contatos: [CEO, indicado], citarIndicacao: true }));
    expect(gerarComunicacaoSincrona(montarContentSpec(ctxCit, 'WHATSAPP', REMETENTE)).versaoPrincipal).toContain('Presidente Fictício me indicou');
    const semResp = [atividade('A2', 'E1', 'C1', 'MESSAGE', 'WHATSAPP', '2026-09-06T10:00:00.000Z', 'NO_RESPONSE')];
    const c2 = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1, atividades: semResp }));
    expect(c2).toMatchObject({ objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', estagio: 'CONTACT_STARTED' }); expect(c2.canal.primario).not.toBe('WHATSAPP'); expect(c2.canal.motivo).toContain('alternar canal');
    const g2 = gerarComunicacaoSincrona(montarContentSpec(c2, c2.canal.primario!, REMETENTE)); expect(g2.metadados.palavras).toBeLessThanOrEqual(45 * 1.2);
    const semProj = [atividade('A3', 'E1', 'C1', 'CALL', 'PHONE', '2026-09-07T10:00:00.000Z', 'NO_PROJECT')];
    const c3 = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1, atividades: semProj }));
    expect(c3.comunicar).toBe(false); expect(c3.objetivo).toBeUndefined(); expect(() => montarContentSpec(c3, 'EMAIL', REMETENTE)).toThrow(/Sem comunicação/);
    expect(TRANSICOES_RESULTADO.NO_PROJECT.comunicar).toBe(false); expect(TRANSICOES_RESULTADO.REQUESTED_PRESENTATION.objetivo).toBe('SEND_REQUESTED_CONTENT'); expect(TRANSICOES_RESULTADO.REQUESTED_MEETING.objetivo).toBe('SCHEDULE_MEETING'); expect(TRANSICOES_RESULTADO.ACTIVE_PROJECT.playbook).toBe('PROJECT_CAPTURE');
  });
  it('sinal diferente muda o contexto; empresa/contato diferentes geram contextos diferentes; NOTE não conta como tentativa', () => {
    const a = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1 }));
    const b = buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: sinal('S3', 'E1', 'HIRING_ENGINEERING', 'Vaga de engenheiro', 'A Beneficiadora Fictícia abriu vaga de engenheiro civil') }));
    expect(a.whyNow).not.toBe(b.whyNow); expect(a.sinal?.tipo).not.toBe(b.sinal?.tipo);
    const c = buildCommunicationContext(base({ empresa: E2, contato: ENG, sinal: S2 }));
    expect(c.empresa.nome).not.toBe(a.empresa.nome); expect(c.objetivo).not.toBe(a.objetivo);
    const nota = [atividade('N1', 'E1', 'C1', 'NOTE', 'OTHER', '2026-09-08T10:00:00.000Z')];
    expect(historicoDe(nota, 'E1', 'C1').tentativas).toBe(0);
    expect(buildCommunicationContext(base({ empresa: E1, contato: CEO, sinal: S1, atividades: nota })).objetivo).toBe('GET_REFERRAL');
  });
  it('catálogos: objetivos com sucesso/CTA/estágios/personas; playbooks com regras, sem texto fechado; política de canal sem canal válido pede enriquecimento', () => {
    for (const o of Object.values(OBJETIVOS)) { expect(o.condicaoSucesso.length).toBeGreaterThan(10); expect(o.cta.length).toBeGreaterThan(10); expect(o.personas.length).toBeGreaterThan(0); }
    for (const p of Object.values(PLAYBOOKS)) { expect(p.fazer.length).toBeGreaterThan(0); expect(p.naoFazer.length).toBeGreaterThan(0); expect(OBJETIVOS[p.objetivo]).toBeTruthy(); }
    expect(PLAYBOOKS.ACCESS_VIA_EXECUTIVE.naoFazer.join(' ')).toMatch(/vender/);
    const semCanal = contato('C5', 'E1', 'Sem Canal', 'Diretor industrial', 'INDUSTRIAL_DIRECTOR', 84, { email: undefined, celular: undefined, statusEmail: undefined });
    expect(recomendarCanal({ contato: semCanal, persona: 'INDUSTRIAL_DIRECTOR', historico: historicoDe([], 'E1', 'C5'), estagio: 'DECISION_MAKER_FOUND' }).primario).toBeUndefined();
    expect(selecionarPlaybook({ persona: 'CEO', decisionFit: 55, fitIdeal: 70, historico: historicoDe([], 'E1'), estagio: 'RESEARCHING', temContato: false }).comunicar).toBe(false);
  });
  it('estados: geração termina em READY_FOR_REVIEW; SENT só depois de APPROVED e nunca automaticamente', () => {
    expect(ESTADO_MAXIMO_AUTOMATICO).toBe('READY_FOR_REVIEW');
    expect(transicaoComunicacaoValida('DRAFT', 'SENT')).toBe(false); expect(transicaoComunicacaoValida('READY_FOR_REVIEW', 'SENT')).toBe(false); expect(transicaoComunicacaoValida('APPROVED', 'SENT')).toBe(true);
    expect(TRANSICOES_COMUNICACAO.REPLIED).toEqual([]); expect(TRANSICOES_COMUNICACAO.CANCELLED).toEqual([]);
  });
  it('nenhum nome do piloto real está no código do motor', () => {
    const dir = path.resolve(__dirname);
    for (const arq of ['comunicacao.ts', 'comunicacaoGeracao.ts']) { const s = fs.readFileSync(path.join(dir, arq), 'utf8').toLowerCase(); for (const termo of ['agro amaz', 'roberto', 'motta', 'patos de minas', 'fiagril', 'mazzardo']) expect(s.includes(termo), `${arq} contém ${termo}`).toBe(false); }
  });
});

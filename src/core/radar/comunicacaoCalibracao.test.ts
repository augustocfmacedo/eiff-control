// Communication Live Calibration 01: primeiro feedback humano de producao. A primeira geracao real (CEO com decision fit
// abaixo do ideal, GET_REFERRAL via ACCESS_VIA_EXECUTIVE, sinal EXPANSION de fonte oficial) abriu com "Cheguei ao seu contato
// como responsável por essa frente" e fechou pedindo indicacao de quem responde pela frente: contradicao e falso PASS.
// Dados FICTICIOS equivalentes; nenhum nome real; nenhuma chamada externa.
import { describe, expect, it } from 'vitest';
import { CONTENT_SPEC_VERSION, buildCommunicationContext, escopoDoClaim, montarContentSpec, referenciaAoSinal, type ContentSpec, type EntradaContexto } from './comunicacao';
import { aberturaNeutra, gerarComunicacaoSincrona, localEventoNaoSuportado, locaisNaFrase, presumeResponsabilidade, validarGeracao, type ResultadoGeracao } from './comunicacaoGeracao';
import { PROMPT_JUIZ_V3, REGRAS_RELACIONAIS, orquestrarGeracaoLlm, specParaLlm, type PortasLlm } from './comunicacaoLlm';
import { FONTES_PADRAO } from './padroes';
import type { Atividade, Contato, Empresa, Fonte, Persona, Sinal } from './types';

const OFICIAL: Fonte = { id: 'F-OFICIAL', codigo: 'OFFICIAL_COMPANY_SOURCE', nome: 'Comunicado oficial da empresa', tipo: 'WEBSITE', descricao: 'comunicados da própria empresa', confiabilidade: 0.95, ativo: true, criadoEm: '2026-09-01T00:00:00.000Z' };
const fontes: Fonte[] = [...FONTES_PADRAO, OFICIAL];
const F = (c: string) => fontes.find((f) => f.codigo === c)!;
const U = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const E1: Empresa = { id: U(1), razaoSocial: 'Agroindústria Fictícia Ltda.', pais: 'Brasil', cidade: 'Cidade Fictícia', uf: 'MT', faixaFuncionarios: '[1001-5000]', fonteId: F('VIBE').id, observacoes: '', ativo: true, criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '', fitScore: 80, intentScore: 0, timingScore: 20, relationshipScore: 0, dataQualityScore: 60, priorityScore: 30, priorityClass: 'C' };
const contato = (id: string, nome: string, cargo: string, persona: Persona, fit: number, extra: Partial<Contato> = {}): Contato => ({ id, empresaId: E1.id, nome, cargo, persona, decisionFitScore: fit, senioridade: 'C-level', email: `${nome.split(' ')[0].toLowerCase()}@exemplo.invalid`, statusEmail: 'valido', celular: '+55 65 90000-0000', fonteId: F('VIBE').id, ativo: true, criadoEm: '2026-09-02T00:00:00.000Z', atualizadoEm: '', qualidade: 70, decisor: fit >= 70, ...extra } as Contato);
const CEO = contato(U(11), 'Executivo Fictício', 'Chief executive officer', 'CEO', 55);
const IND = contato(U(14), 'Engenheiro Indicado', 'Gerente de engenharia', 'ENGINEERING', 66, { senioridade: 'Gerente', criadoEm: '2026-09-05T00:00:00.000Z' });
// sinal EXPANSION de fonte oficial: titulo em forma verbal (como o real) e claim completo do que aconteceu
const S: Sinal = { id: U(21), empresaId: E1.id, fonteId: OFICIAL.id, fonteTipo: 'WEBSITE', tipo: 'EXPANSION', titulo: 'Agroindústria Fictícia avalia replicar nova infraestrutura de armazenagem em outras unidades', descricao: '', eventoEm: '2026-01-29', detectadoEm: '2026-09-01', confianca: 0.9, url: 'https://exemplo.invalid/comunicado', payload: { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: 'A Agroindústria Fictícia inaugurou nova infraestrutura especializada de armazenagem de sementes e declarou que avalia replicar a solução em outras unidades.', porQueImporta: 'interpretação interna' } }, scoreBase: 55, scoreEfetivo: 50, verificado: true, criadoEm: '' };
const indicacao: Atividade = { id: U(31), empresaId: E1.id, contatoId: CEO.id, usuarioId: 'U', tipo: 'CALL', canal: 'WHATSAPP', ocorreuEm: '2026-09-04T10:00:00.000Z', resultado: 'REFERRED_TO_OTHER_PERSON', notas: '', criadoEm: '2026-09-04T10:00:00.000Z' };
const REM = { nome: 'Vendedor Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' };
const base = (x: Partial<EntradaContexto> = {}): EntradaContexto => ({ empresa: E1, contato: CEO, persona: 'CEO', decisionFit: 55, sinal: S, atividades: [], contatos: [CEO, IND], fontes, fitIdeal: 70, proximaAcaoAtual: 'SEARCH_DECISION_MAKER', hoje: '2026-09-09', ...x });
const specDe = (x: Partial<EntradaContexto> = {}, canal: ContentSpec['canal'] = 'EMAIL') => montarContentSpec(buildCommunicationContext(base(x)), canal, REM, { horaLocal: 10 });
const resultado = (texto: string, spec: ContentSpec, assunto = 'quem responde por engenharia e implantação na Agroindústria Fictícia Ltda.?'): ResultadoGeracao => ({ versaoPrincipal: texto, versoesAlternativas: [], objecoes: [], assunto, claimsUsados: spec.allowedClaims.filter((c) => c.tipo === 'TECHNICAL_CLAIM').map((c) => c.id), metadados: { provedor: 'deterministico', modelo: 'x', promptVersao: 'x', regenerado: false } as ResultadoGeracao['metadados'] });
const CABECA = 'Executivo, bom dia. Aqui é Vendedor Fictício, da EIFF Engenharia, de Goiânia.';
// fixtures sobre o texto determinístico (why now, frase da EIFF e CTA presentes): só a frase em teste é injetada antes do pedido
const DET = gerarComunicacaoSincrona(specDe()).versaoPrincipal;
const injetar = (frase: string) => { if (!DET.includes('\n\nNão quero tomar')) throw new Error('fixture determinística mudou'); return DET.replace('\n\nNão quero tomar', `\n\n${frase}\n\nNão quero tomar`); };
const REPROVADO = injetar('Cheguei ao seu contato como responsável por essa frente.'); // caso real (ficticio) de producao
const APROVADO = injetar('Estou tentando chegar à pessoa que conduz essa frente internamente.');

describe('Communication Live Calibration 01: responsabilidade do destinatário em GET_REFERRAL', () => {
  it('fixture equivalente ao caso real: CEO abaixo do ideal → GET_REFERRAL via ACCESS_VIA_EXECUTIVE, sinal EXPANSION de fonte oficial, INTERNAL_ONLY', () => {
    const spec = specDe();
    expect(spec).toMatchObject({ objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', canal: 'EMAIL', sourceDisclosure: 'INTERNAL_ONLY' });
    expect(spec.audiencia.persona).toBe('CEO'); expect(spec.versoes.contentSpec).toBe(CONTENT_SPEC_VERSION); expect(CONTENT_SPEC_VERSION).toBe('3');
    expect(spec.allowedClaims.some((c) => c.chave === 'sinal.oQueAconteceu')).toBe(true);
  });
  it('"Cheguei ao seu contato como responsável por essa frente" + pedido de indicação DEVE FALHAR no fact gate', () => {
    const spec = specDe();
    const v = validarGeracao(spec, resultado(REPROVADO, spec));
    expect(v.ok).toBe(false); expect(v.problemas).toContain('presume responsabilidade do contato'); expect(v.problemas.filter((p) => p === 'presume responsabilidade do contato')).toHaveLength(1);
    for (const frase of ['Você é responsável por essa frente.', 'Chegou até você como responsável por essa frente.', 'Seu nome como responsável por essa frente.', 'Você conduz essa frente.', 'Você lidera essa frente.', 'Vejo você como a pessoa que conduz essa frente.']) {
      expect(validarGeracao(spec, resultado(injetar(frase), spec)).problemas, frase).toContain('presume responsabilidade do contato');
    }
  });
  it('"Estou tentando chegar à pessoa que conduz essa frente internamente" + CTA DEVE PASSAR; a pergunta "quem responde por essa frente?" nunca é bloqueada', () => {
    const spec = specDe();
    const v = validarGeracao(spec, resultado(APROVADO, spec)); expect(v.problemas).toEqual([]); expect(v.ok).toBe(true);
    // a formulacao exata do feedback humano: nada de responsabilidade presumida (a equivalencia do CTA e outra verificacao)
    const humano = validarGeracao(spec, resultado(`${CABECA}\n\nEstou tentando chegar à pessoa que conduz essa frente internamente. Você consegue me indicar quem responde por isso?`, spec));
    expect(humano.problemas).not.toContain('presume responsabilidade do contato');
    for (const ok of ['Você saberia me dizer quem lidera essa frente?', 'Você consegue me apontar quem conduz a engenharia e a implantação?', 'Quem responde por essa frente aí?']) expect(presumeResponsabilidade(spec, ok.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')), ok).toBe(false);
  });
  it('regra contextual: com indicação real e autorizada, REFERRAL_INTRODUCTION pode dizer "Fulano me indicou você como responsável"; sem autorização, não', () => {
    const comIndicacao = specDe({ contato: IND, persona: 'ENGINEERING', decisionFit: 66, atividades: [indicacao], citarIndicacao: true }, 'WHATSAPP');
    expect(comIndicacao).toMatchObject({ objetivo: 'START_DISCOVERY', playbook: 'REFERRAL_INTRODUCTION', sourceDisclosure: 'ALLOWED' }); expect(comIndicacao.contextoIndicacao).toMatch(/^indicado por /);
    const texto = `Engenheiro, bom dia. Aqui é Vendedor Fictício, da EIFF Engenharia, de Goiânia.\n\nExecutivo Fictício me indicou você como responsável por essa frente.\n\n${comIndicacao.cta}`;
    expect(validarGeracao(comIndicacao, resultado(texto, comIndicacao, undefined)).problemas).not.toContain('presume responsabilidade do contato');
    const semAutorizacao = specDe({ contato: IND, persona: 'ENGINEERING', decisionFit: 66, atividades: [indicacao], citarIndicacao: false }, 'WHATSAPP');
    expect(semAutorizacao.sourceDisclosure).toBe('INTERNAL_ONLY');
    const p = validarGeracao(semAutorizacao, resultado(texto, semAutorizacao, undefined)).problemas;
    expect(p).toContain('presume responsabilidade do contato'); expect(p).toContain('revela fonte confidencial sem autorização');
  });
  it('abertura neutra nunca afirma responsabilidade; o provedor determinístico passa no próprio fact gate em GET_REFERRAL e em START_DISCOVERY sem indicação', () => {
    expect(aberturaNeutra('GET_REFERRAL')).toBe('Estou tentando chegar à pessoa que conduz essa frente internamente');
    for (const ob of ['GET_REFERRAL', 'START_DISCOVERY'] as const) expect(aberturaNeutra(ob)).not.toMatch(/respons[áa]vel|lidera|dono|você conduz/i);
    const spec = specDe(); const g = gerarComunicacaoSincrona(spec);
    expect(validarGeracao(spec, g).problemas).toEqual([]); expect(g.versaoPrincipal).not.toMatch(/como respons[áa]vel/);
    const sd = specDe({ contato: IND, persona: 'ENGINEERING', decisionFit: 66, atividades: [indicacao], citarIndicacao: false }, 'WHATSAPP'); const g2 = gerarComunicacaoSincrona(sd);
    expect(g2.versaoPrincipal).toContain(aberturaNeutra('START_DISCOVERY')); expect(validarGeracao(sd, g2).problemas).toEqual([]);
  });
  it('o que o modelo recebe: abertura neutra por objetivo, restrição explícita de GET_REFERRAL e instrução de citar o sinal em frase natural (sem título colado após "sobre")', () => {
    const spec = specDe(); const s = specParaLlm(spec) as Record<string, unknown>;
    expect(s.aberturaNeutraSeInternalOnly).toBe(aberturaNeutra('GET_REFERRAL'));
    expect(s.restricoesObjetivo).toHaveLength(1); expect(String(s.restricoesObjetivo)).toMatch(/pede indicação/);
    expect(spec.referenciaSinal).toBe('o comunicado da empresa'); // com claim completo, a referencia nomeia so a fonte
    expect(String(s.comoCitarSinal)).toMatch(/sobre.*reformulação natural/); expect(String(s.comoCitarSinal)).toContain('sin:'); expect(String(s.comoCitarSinal)).not.toContain('avalia replicar');
    expect(String(s.whyNow)).toContain('inaugurou nova infraestrutura');
    // sem o claim completo, a referencia continua levando o titulo publico
    expect(referenciaAoSinal('OFFICIAL_COMPANY_SOURCE', 'EXPANSION', 'nova unidade')).toBe('o comunicado da empresa sobre nova unidade');
    expect(referenciaAoSinal('OFFICIAL_COMPANY_SOURCE', 'EXPANSION', '')).toBe('o comunicado da empresa'); expect(referenciaAoSinal('CNO', 'CONSTRUCTION_PERMIT', '')).toBe('o registro de obra');
    const outro = specParaLlm(specDe({ contato: IND, persona: 'ENGINEERING', decisionFit: 66, atividades: [indicacao], citarIndicacao: true }, 'WHATSAPP')) as Record<string, unknown>;
    expect(outro.restricoesObjetivo).toEqual([]);
  });
  it('juiz V2: GET_REFERRAL com destinatário apresentado como responsável pela frente pedida é FAIL; a pergunta pela indicação não é problema', () => {
    expect(PROMPT_JUIZ_V3).toContain('GET_REFERRAL'); expect(PROMPT_JUIZ_V3).toMatch(/responsável, líder, dono ou condutor da mesma frente/); expect(PROMPT_JUIZ_V3).toMatch(/"quem responde por essa frente\?" é o CTA correto/);
  });
  it('regressão orquestrada (mock, sem rede): o caso real de produção é barrado pelo fact gate, a regeneração corrige e o juiz aprova', async () => {
    const spec = specDe(); const saidas = [REPROVADO, APROVADO]; const mensagens: string[] = [];
    const portas: PortasLlm = {
      gerar: async (m) => { mensagens.push(m); const texto = saidas.shift()!; return { json: { primary: texto, alternatives: [], subject: 'quem responde por engenharia e implantação na Agroindústria Fictícia Ltda.?', claims_used: spec.allowedClaims.filter((c) => c.tipo === 'TECHNICAL_CLAIM').map((c) => c.id) }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }; },
      julgar: async (m) => ({ json: /como respons[áa]vel por essa frente/.test(m) ? { verdict: 'FAIL', reasons: ['destinatário apresentado como responsável pela frente pedida'] } : { verdict: 'PASS', reasons: [] }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }),
    };
    const r = await orquestrarGeracaoLlm(spec, portas);
    expect(mensagens).toHaveLength(2); expect(mensagens[1]).toContain('presume responsabilidade do contato');
    expect(r.validacao.regenerado).toBe(true); expect(r.resultado.versaoPrincipal).toBe(APROVADO);
  });
});

// Live Calibration 02 — Relational Fact Binding: a segunda geracao real escreveu "nova infraestrutura ... em <sede da empresa>".
// O sinal nao associa a infraestrutura a cidade nenhuma; a cidade veio da localizacao da conta. Dois fatos validos, relacao nao suportada.
describe('Communication Live Calibration 02: ligação local × evento (Relational Fact Binding)', () => {
  const SEDE = 'Cidade Fictícia/MT'; // E1.cidade/uf: local da CONTA, nunca do evento
  const S_B: Sinal = { ...S, id: U(22), titulo: 'Agroindústria Fictícia inaugura nova infraestrutura em Cidade B/TO', payload: { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: 'A Agroindústria Fictícia inaugurou nova infraestrutura de armazenagem em Cidade B/TO e avalia replicar o modelo.', localEvento: 'Cidade B/TO' } } };
  it('escopo derivado dos claims: empresa → ACCOUNT_FACT, contato → CONTACT_FACT, sinal → SIGNAL_FACT, sinal.local → SIGNAL_LOCATION, técnico → TECHNICAL_CLAIM', () => {
    const spec = specDe(); const escopos = new Map(spec.allowedClaims.map((c) => [c.chave, escopoDoClaim(c)]));
    expect(escopos.get('empresa.local')).toBe('ACCOUNT_FACT'); expect(escopos.get('sinal.oQueAconteceu')).toBe('SIGNAL_FACT'); expect(escopos.get('tecnico.DESCRICAO_EIFF')).toBe('TECHNICAL_CLAIM');
    expect(spec.allowedClaims.some((c) => c.chave === 'sinal.local')).toBe(false); // sem local do evento no sinal real
    const specB = specDe({ sinal: S_B }); const loc = specB.allowedClaims.find((c) => c.chave === 'sinal.local')!;
    expect(loc.texto).toBe('Cidade B/TO'); expect(escopoDoClaim(loc)).toBe('SIGNAL_LOCATION'); expect(escopoDoClaim({ origem: 'contato', chave: 'contato.cargo' })).toBe('CONTACT_FACT');
  });
  it('caso real equivalente: "nova infraestrutura em <sede>" DEVE FALHAR no fact gate com "local do evento não suportado pelo sinal"', () => {
    const spec = specDe();
    const v = validarGeracao(spec, resultado(injetar(`Vi a nova infraestrutura de armazenagem da Agroindústria Fictícia em ${SEDE}.`), spec));
    expect(v.ok).toBe(false); expect(v.problemas).toContain('local do evento não suportado pelo sinal: cidade ficticia/mt');
    for (const frase of [`A nova unidade em ${SEDE} mostra a direção da empresa.`, 'A expansão em Cidade Fictícia chama atenção.', `Acompanhei o comunicado sobre a infraestrutura de ${SEDE}.`]) {
      expect(validarGeracao(spec, resultado(injetar(frase), spec)).problemas.some((p) => p.startsWith('local do evento não suportado pelo sinal')), frase).toBe(true);
    }
  });
  it('"empresa sediada em <sede>" pode passar; "nova infraestrutura" sem local PASSA; frase natural do comunicado PASSA', () => {
    const spec = specDe();
    expect(localEventoNaoSuportado(spec, `A Agroindústria Fictícia, sediada em ${SEDE}, inaugurou nova infraestrutura.`)).toEqual([]);
    expect(localEventoNaoSuportado(spec, `Empresa sediada em ${SEDE}.`)).toEqual([]);
    expect(validarGeracao(spec, resultado(injetar('Vi que a nova infraestrutura é um passo relevante.'), spec)).problemas).toEqual([]);
    expect(validarGeracao(spec, resultado(injetar('Acompanhei o comunicado sobre a nova infraestrutura e a avaliação de replicar a solução.'), spec)).problemas).toEqual([]);
    expect(validarGeracao(spec, resultado(APROVADO, spec)).problemas).toEqual([]);
  });
  it('local explícito no claim do sinal (SIGNAL_FACT ou SIGNAL_LOCATION) autoriza "nova infraestrutura em Cidade B/TO"; a sede continua não autorizada', () => {
    const specB = specDe({ sinal: S_B }); const detB = gerarComunicacaoSincrona(specB).versaoPrincipal;
    const inj = (f: string) => detB.replace('\n\nNão quero tomar', `\n\n${f}\n\nNão quero tomar`);
    expect(validarGeracao(specB, resultado(inj('Vi a nova infraestrutura em Cidade B/TO.'), specB)).problemas).toEqual([]);
    expect(validarGeracao(specB, resultado(inj(`Vi a nova infraestrutura em ${SEDE}.`), specB)).problemas).toContain('local do evento não suportado pelo sinal: cidade ficticia/mt');
    // so o claim SIGNAL_LOCATION, sem a cidade no texto do fato
    const soLocal: Sinal = { ...S, id: U(23), payload: { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: 'A Agroindústria Fictícia inaugurou nova infraestrutura especializada de armazenagem de sementes e declarou que avalia replicar a solução em outras unidades.', localEvento: 'Cidade C/GO' } } };
    const specC = specDe({ sinal: soLocal });
    expect(localEventoNaoSuportado(specC, 'A nova infraestrutura em Cidade C/GO é recente.')).toEqual([]);
    expect(localEventoNaoSuportado(specC, `A nova infraestrutura em ${SEDE} é recente.`)).toHaveLength(1);
    expect(locaisNaFrase(`obra em Porto Fictício/TO e sede em ${SEDE}`, SEDE).sort()).toEqual(['cidade ficticia', 'cidade ficticia/mt', 'porto ficticio', 'porto ficticio/to']);
  });
  it('o modelo não recebe audiencia.local cru: no primeiro contato o local da conta nem vai; nos demais vai rotulado; regras relacionais sempre', () => {
    const spec = specDe(); const s = specParaLlm(spec) as { audiencia: Record<string, unknown>; localEmpresa?: unknown; regrasRelacionais: string[] };
    expect(s.audiencia.local).toBeUndefined(); expect(s.localEmpresa).toBeUndefined(); expect(JSON.stringify(s)).not.toContain(SEDE);
    expect(s.regrasRelacionais).toEqual(REGRAS_RELACIONAIS); expect(REGRAS_RELACIONAIS.join(' ')).toMatch(/sede\/conta.*não é a localização/);
    const depois = specParaLlm({ ...spec, objetivo: 'FOLLOW_UP' }) as { localEmpresa?: { valor: string; usoPermitido: string } };
    expect(depois.localEmpresa).toEqual({ valor: SEDE, usoPermitido: expect.stringMatching(/somente localização corporativa.*não atribuir ao sinal/) });
    expect(PROMPT_JUIZ_V3).toMatch(/combina fatos verdadeiros isoladamente/); expect(PROMPT_JUIZ_V3).toMatch(/localização da empresa \(sede\/conta\) não é localização do projeto/);
  });
  it('regressão orquestrada (mock): "infraestrutura em <sede>" é barrada pelo fact gate, a regeneração sem o local passa e o juiz aprova', async () => {
    const spec = specDe(); const saidas = [injetar(`Vi a nova infraestrutura de armazenagem em ${SEDE}.`), APROVADO]; const mensagens: string[] = [];
    const portas: PortasLlm = {
      gerar: async (m) => { mensagens.push(m); return { json: { primary: saidas.shift()!, alternatives: [], subject: 'quem responde por engenharia e implantação na Agroindústria Fictícia Ltda.?', claims_used: spec.allowedClaims.filter((c) => c.tipo === 'TECHNICAL_CLAIM').map((c) => c.id) }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }; },
      julgar: async (m) => ({ json: /infraestrutura[^.]*em cidade fict/i.test(m.normalize('NFD').replace(/\p{M}/gu, '')) ? { verdict: 'FAIL', reasons: ['local da conta atribuído ao evento'] } : { verdict: 'PASS', reasons: [] }, modelo: 'mock', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }),
    };
    const r = await orquestrarGeracaoLlm(spec, portas);
    expect(mensagens).toHaveLength(2); expect(mensagens[1]).toContain('local do evento não suportado pelo sinal'); expect(r.validacao.regenerado).toBe(true);
  });
});

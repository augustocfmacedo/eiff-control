// Store: ciclo completo human-in-the-loop com invariantes: geracao -> READY_FOR_REVIEW; edicao revalidada na aprovacao;
// SENT so com atividade de contato; REPLIED so com atividade com resultado; eventos no historico; idempotencia por hash.
import { beforeAll, describe, expect, it } from 'vitest';
import { contentSpecPersistivel, hashTextoEfetivo, validarGeracao, type ContentSpec, type VeredictoEdicao } from '../core/radar';
import { PLAYBOOK_VERSION } from '../core/radar/comunicacao';
import { RegraDeNegocioError, actions, getState } from './store';

const radar = () => getState().ds.radar;

describe('comunicação no store (human-in-the-loop)', () => {
  let empresaId = ''; let contatoId = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    actions.importarCsvRadar(['Razão Social;CNPJ;Cidade;UF;Setor;Funcionários', 'Indústria Fictícia LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;1500'].join('\n'), { tipo: 'empresas' });
    empresaId = radar().empresas.find((e) => e.cnpj === '11222333000181')!.id;
    actions.importarCsvRadar(['nome,cargo,email,telefone,empresa', 'Executivo Fictício,Chief executive officer,ceo@if.invalid,62999990000,Indústria Fictícia LTDA'].join('\n'), { tipo: 'contatos' });
    contatoId = radar().contatos.find((c) => c.empresaId === empresaId)!.id;
  });
  it('geração termina em READY_FOR_REVIEW; mesmo contexto devolve o mesmo rascunho; SENT direto é bloqueado', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' });
    expect(c.estado).toBe('READY_FOR_REVIEW'); expect(c.objetivo).toBe('GET_REFERRAL'); expect(c.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.versoes).toMatchObject({ playbook: PLAYBOOK_VERSION, contentSpec: '3', prompt: 'deterministico-2', provedor: 'deterministico' }); expect(c.validacao.ok).toBe(true);
    expect(actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' }).id).toBe(c.id); // idempotente
    expect(radar().comunicacoes).toHaveLength(1); expect(radar().oportunidades).toHaveLength(0);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: 'x' })).toThrow(RegraDeNegocioError);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'REJECTED')).toThrow(/Motivo/);
  });
  it('edição humana inválida bloqueia a aprovação; edição válida aprova; SENT exige atividade real; REPLIED exige resultado; eventos registrados', () => {
    const c = radar().comunicacoes[0];
    const ruim = actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal + '\n\nGarantimos economia de 20% e entrego peso estimado e prazo.');
    expect(ruim.editadoPor).toBe('u-admin'); expect(ruim.editadoEm).toBeTruthy(); expect(ruim.resultado.versaoPrincipal).toBe(c.resultado.versaoPrincipal); // original preservado
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'APPROVED')).toThrow(/fact gate/);
    actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal + '\n\nPS: obrigado pela atenção.');
    const ap = actions.transicionarComunicacaoRadar(c.id, 'APPROVED');
    expect(ap.estado).toBe('APPROVED'); expect(ap.aprovadoPor).toBe('u-admin'); expect(ap.aprovadoEm).toBeTruthy();
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT')).toThrow(/exige a atividade/);
    // nota interna nao vale como envio
    const nota = actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'NOTE', canal: 'OTHER', notas: 'nota' }));
    const notaId = radar().atividades.find((a) => a.empresaId === empresaId && a.tipo === 'NOTE')!.id; void nota;
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: notaId })).toThrow(/Nota interna/);
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'MESSAGE', canal: 'WHATSAPP', notas: 'enviado manualmente' }));
    const envio = radar().atividades.find((a) => a.empresaId === empresaId && a.tipo === 'MESSAGE')!;
    const sent = actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: envio.id });
    expect(sent.estado).toBe('SENT'); expect(sent.atividadeEnvioId).toBe(envio.id); expect(sent.enviadaEm).toBe(envio.ocorreuEm);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'REPLIED', { atividadeId: envio.id })).toThrow(/resultado/);
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'MESSAGE', canal: 'WHATSAPP', resultado: 'REFERRED_TO_OTHER_PERSON', notas: 'respondeu' }));
    const resposta = radar().atividades.find((a) => a.empresaId === empresaId && a.resultado === 'REFERRED_TO_OTHER_PERSON')!;
    const rep = actions.transicionarComunicacaoRadar(c.id, 'REPLIED', { atividadeId: resposta.id });
    expect(rep.estado).toBe('REPLIED'); expect(rep.atividadeRespostaId).toBe(resposta.id);
    expect(rep.historico.map((h) => h.para)).toEqual(['READY_FOR_REVIEW', 'APPROVED', 'SENT', 'REPLIED']);
    expect(getState().ds.auditoria.filter((a) => a.entidadeId === c.id).length).toBeGreaterThanOrEqual(5);
    // novo contexto (indicacao recebida) gera novo rascunho, sem sobrescrever o historico
    const c2 = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' });
    expect(c2.id).not.toBe(c.id); expect(radar().comunicacoes).toHaveLength(2); expect(radar().comunicacoes.find((x) => x.id === c.id)!.estado).toBe('REPLIED');
    expect(radar().oportunidades).toHaveLength(0);
  });
  it('rejeitar com motivo e voltar à revisão por edição', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'EMAIL' });
    expect(c.resultado.assunto).toBeTruthy();
    const rj = actions.transicionarComunicacaoRadar(c.id, 'REJECTED', { motivo: 'tom errado' });
    expect(rj.estado).toBe('REJECTED'); expect(rj.motivoRejeicao).toBe('tom errado'); expect(rj.rejeitadoPor).toBe('u-admin');
    expect(actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal, c.resultado.assunto).estado).toBe('READY_FOR_REVIEW');
    expect(() => actions.gerarComunicacaoRadar('inexistente')).toThrow(/não encontrada/);
  });
});

// Approval Path Fix 01: comunicacao carregada do banco tem content_spec MINIMIZADO (deniedClaims sem texto, technicalClaims
// como ids). Aprovar sem edicao preserva o snapshot e nunca revalida esse snapshot; com edicao exige veredito do servidor.
describe('Approval Path Fix 01: aprovação de comunicação carregada do banco', () => {
  const ID = '0000c0de-0000-4000-8000-00000000c0de';
  let empresaId = ''; let contatoId = '';
  const linhaDoBanco = (extra: Record<string, unknown> = {}) => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' }); // spec completo em memoria (modo local) -> snapshot minimizado como o banco guarda
    return { id: ID, company_id: empresaId, contact_id: contatoId, signal_id: null, strategy_id: null, channel: c.canal, objective: c.objetivo, playbook: c.playbook, state: 'READY_FOR_REVIEW', context_hash: 'c'.repeat(64),
      content_spec: contentSpecPersistivel(c.spec as ContentSpec), generated_content: c.resultado, edited_content: null, validation: { ok: true, problemas: [], juiz: 'PASS', regenerado: false },
      provider: 'ANTHROPIC', model: 'claude-sonnet-5', prompt_version: 'COMMUNICATION_LLM_PROMPT_V1', playbook_version: c.versoes.playbook, content_spec_version: c.versoes.contentSpec, created_by: 'u-admin', created_at: '2026-09-09T12:00:00.000Z', updated_at: '2026-09-09T12:00:00.000Z', ...extra };
  };
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    actions.importarCsvRadar(['Razão Social;CNPJ;Cidade;UF;Setor;Funcionários', 'Indústria Fictícia LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;1500'].join('\n'), { tipo: 'empresas' });
    empresaId = radar().empresas.find((e) => e.cnpj === '11222333000181')!.id;
    actions.importarCsvRadar(['nome,cargo,email,telefone,empresa', 'Executivo Fictício,Chief executive officer,ceo@if.invalid,62999990000,Indústria Fictícia LTDA'].join('\n'), { tipo: 'contatos' });
    contatoId = radar().contatos.find((c) => c.empresaId === empresaId)!.id;
  });
  it('G) validarGeracao com snapshot minimizado (deniedClaims sem texto, technicalClaims como ids) devolve FAIL explícito, nunca TypeError', () => {
    const row = linhaDoBanco();
    const minimizado = row.content_spec as unknown as ContentSpec;
    expect((minimizado.deniedClaims as unknown as { texto?: string }[]).every((d) => d.texto === undefined)).toBe(true); expect(typeof minimizado.technicalClaims[0]).toBe('string');
    const v = validarGeracao(minimizado, row.generated_content as never);
    expect(v.ok).toBe(false); expect(v.problemas).toHaveLength(1); expect(v.problemas[0]).toMatch(/^content spec incompleto para validação: .*deniedClaims sem texto/); expect(v.problemas[0]).toMatch(/technicalClaims sem texto/);
    expect(() => validarGeracao({} as ContentSpec, row.generated_content as never)).not.toThrow(); expect(validarGeracao(null as unknown as ContentSpec, undefined as never).ok).toBe(false);
  });
  it('A) carregada do banco, sem edição, validation.ok → APPROVED sem crash, snapshot preservado; H) exatamente uma transição no histórico', () => {
    const c = actions.incorporarComunicacaoRadar(linhaDoBanco());
    expect(c.id).toBe(ID); expect(c.estado).toBe('READY_FOR_REVIEW');
    const antes = JSON.stringify(c.spec);
    expect(() => actions.transicionarComunicacaoRadar(ID, 'APPROVED')).not.toThrow();
    const a = radar().comunicacoes.find((x) => x.id === ID)!;
    expect(a.estado).toBe('APPROVED'); expect(a.aprovadoPor).toBe('u-admin'); expect(a.aprovadoEm).toBeTruthy(); expect(a.ultimoMotivo).toBe('APPROVED');
    expect(JSON.stringify(a.spec)).toBe(antes); expect(a.resultado).toEqual(c.resultado); expect(a.contextHash).toBe('c'.repeat(64)); expect(a.versoes).toEqual(c.versoes); expect(a.validacao).toEqual(c.validacao);
    expect(a.historico).toHaveLength(1); expect(a.historico[0]).toMatchObject({ de: 'READY_FOR_REVIEW', para: 'APPROVED' });
  });
  it('B) mesma comunicação com validation.ok=false → aprovação bloqueada com mensagem humana', () => {
    const id2 = '0000c0de-0000-4000-8000-00000000c0d2';
    actions.incorporarComunicacaoRadar(linhaDoBanco({ id: id2, context_hash: 'd'.repeat(64), validation: { ok: false, problemas: ['reprovado pelo validador semântico'] } }));
    expect(() => actions.transicionarComunicacaoRadar(id2, 'APPROVED')).toThrow(/validação original não passou \(reprovado pelo validador semântico\)/);
    expect(radar().comunicacoes.find((x) => x.id === id2)!.estado).toBe('READY_FOR_REVIEW');
  });
  it('C) com edição humana o spec minimizado nunca é usado: sem veredito do servidor bloqueia; veredito de outro texto/contexto bloqueia; D) veredito FAIL mantém READY_FOR_REVIEW; E) veredito ok → APPROVED', () => {
    const id3 = '0000c0de-0000-4000-8000-00000000c0d3';
    const c = actions.incorporarComunicacaoRadar(linhaDoBanco({ id: id3, context_hash: 'e'.repeat(64) }));
    const texto = c.resultado.versaoPrincipal + '\n\nObrigado pela atenção.';
    actions.editarComunicacaoRadar(id3, texto);
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED')).toThrow(/precisa ser revalidado no servidor/); // nunca valida o snapshot minimizado
    const veredito = (x: Partial<VeredictoEdicao>): VeredictoEdicao => ({ ok: true, problemas: [], communicationId: id3, contextHash: 'e'.repeat(64), textoHash: hashTextoEfetivo(texto, c.resultado.assunto), validadoEm: '2026-09-09T12:00:00.000Z', juiz: 'PASS', ...x });
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED', { validacaoServidor: veredito({ textoHash: hashTextoEfetivo('outro texto') }) })).toThrow(/não corresponde a este texto/);
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED', { validacaoServidor: veredito({ contextHash: 'f'.repeat(64) }) })).toThrow(/não corresponde/);
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED', { validacaoServidor: veredito({ communicationId: ID }) })).toThrow(/não corresponde/);
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED', { validacaoServidor: veredito({ ok: false, problemas: ['número sem fato permitido: 500'], juiz: 'SKIPPED' }) })).toThrow(/não passou pela validação: número sem fato permitido: 500/);
    expect(radar().comunicacoes.find((x) => x.id === id3)!.estado).toBe('READY_FOR_REVIEW');
    expect(() => actions.transicionarComunicacaoRadar(id3, 'APPROVED', { validacaoServidor: veredito({}) })).not.toThrow();
    const a = radar().comunicacoes.find((x) => x.id === id3)!;
    expect(a.estado).toBe('APPROVED'); expect(a.textoEditado).toBe(texto); expect(a.resultado.versaoPrincipal).toBe(c.resultado.versaoPrincipal); expect(a.historico.filter((h) => h.para === 'APPROVED')).toHaveLength(1);
  });
});

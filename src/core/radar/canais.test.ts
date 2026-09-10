// Channel Provider 01: abstracao de canal, entregabilidade, idempotencia e a garantia de que nada envia nesta fase.
import { describe, expect, it } from 'vitest';
import { ENVIO_BLOQUEADO, JANELA_LIVRE_HORAS, MAPEAMENTOS_TEMPLATE, TRANSICOES_ENTREGA, WEBHOOK_INBOUND_DISPONIVEL, avaliarEntregabilidade, avaliarJanelaLivre, chaveIdempotencia, comProvaDeJanela, direcaoMensagem, impressaoComparavel, impressaoEnvio, mascararTelefone, normalizarTelefone, permiteReenvioAutomatico, podeTransicionarEntrega, providerManual, reconciliarPorMensagens, transicionarEntrega, whatsappDoContato, type EstadoEntrega, type EstadoProvider, type MensagemCanal, type TemplateCanal } from './canais';
import type { Canal } from './types';

const HOJE = '2026-09-10T12:00:00.000Z';
const aprovado = (canal: Canal = 'WHATSAPP') => ({ estado: 'APPROVED', canal });
const contato = (extra: Record<string, unknown> = {}) => ({ whatsapp: '(62) 99999-1234', celular: undefined, telefone: undefined, statusTelefone: 'valido' as const, situacao: 'ATIVO' as const, ...extra });
const template = (extra: Partial<TemplateCanal> = {}): TemplateCanal => ({ id: 't1', nome: 'primeiro_contato', status: 'approved', categoria: 'MARKETING', idioma: 'pt_BR', ativo: true, variaveis: ['nome'], ...extra });
const msg = (id: string, em: string, direcao: MensagemCanal['direcao'], interna = false): MensagemCanal => ({ id, conversaId: 'chat1', em, direcao, interna });
const estado = (extra: Partial<EstadoProvider> = {}): EstadoProvider => ({ provider: 'OCTADESK', saude: { estado: 'CONNECTED' }, remetentes: [{ id: 'n1', nome: 'Comercial', numero: '556230000000' }], templates: [template()], agora: HOJE, ...extra });

describe('telefone', () => {
  it('normaliza para E.164 sem "+" e recusa lixo', () => {
    expect(normalizarTelefone('(62) 99999-1234')).toBe('5562999991234');
    expect(normalizarTelefone('+55 62 3000-0000')).toBe('556230000000');
    expect(normalizarTelefone('0055 62 99999 1234')).toBe('5562999991234');
    expect(normalizarTelefone('99999-1234')).toBeUndefined(); // sem DDD
    expect(normalizarTelefone('')).toBeUndefined();
    expect(normalizarTelefone(undefined)).toBeUndefined();
  });
  it('escolhe whatsapp, depois celular, depois telefone; ignora telefone marcado inválido', () => {
    expect(whatsappDoContato(contato())).toBe('5562999991234');
    expect(whatsappDoContato(contato({ whatsapp: undefined, celular: '62988887777' }))).toBe('5562988887777');
    expect(whatsappDoContato(contato({ whatsapp: undefined, celular: undefined, telefone: '6232221111' }))).toBe('556232221111');
    expect(whatsappDoContato(contato({ statusTelefone: 'invalido' }))).toBeUndefined();
  });
  it('máscara nunca expõe o número inteiro', () => {
    const m = mascararTelefone('5562999991234');
    expect(m).toContain('5562'); expect(m).toContain('34'); expect(m).not.toContain('99999');
  });
});

describe('entregabilidade', () => {
  it('comunicação não aprovada nunca é entregável', () => {
    for (const e of ['DRAFT', 'READY_FOR_REVIEW', 'REJECTED', 'CANCELLED']) {
      expect(avaliarEntregabilidade({ estado: e, canal: 'WHATSAPP' }, contato(), estado()).resultado).toBe('NEEDS_REVIEW');
    }
  });
  it('contato suprimido, inválido ou fora da empresa não é entregável', () => {
    expect(avaliarEntregabilidade(aprovado(), contato({ suprimido: true }), estado()).resultado).toBe('NEEDS_REVIEW');
    expect(avaliarEntregabilidade(aprovado(), contato({ situacao: 'INVALIDO' }), estado()).resultado).toBe('NEEDS_REVIEW');
    expect(avaliarEntregabilidade(aprovado(), contato({ situacao: 'SAIU_DA_EMPRESA' }), estado()).resultado).toBe('NEEDS_REVIEW');
  });
  it('contato sem WhatsApp válido → MISSING_PHONE (caso Henrique/Fiagril)', () => {
    const r = avaliarEntregabilidade(aprovado(), contato({ whatsapp: undefined }), estado());
    expect(r.resultado).toBe('MISSING_PHONE'); expect(r.apto).toBe(false); expect(r.motivo).toMatch(/sem WhatsApp/i);
  });
  it('provider não configurado ou com erro → PROVIDER_NOT_CONFIGURED', () => {
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ saude: { estado: 'NOT_CONFIGURED' } })).resultado).toBe('PROVIDER_NOT_CONFIGURED');
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ saude: { estado: 'ERROR', detalhe: 'HTTP 401' } })).motivo).toMatch(/erro/i);
  });
  it('canal fora do WhatsApp não é suportado pelo Octadesk', () => {
    expect(avaliarEntregabilidade(aprovado('EMAIL'), contato(), estado()).resultado).toBe('UNSUPPORTED_CHANNEL');
    expect(avaliarEntregabilidade(aprovado('LINKEDIN'), contato(), estado()).resultado).toBe('UNSUPPORTED_CHANNEL');
  });
  it('sem número oficial → NO_SENDER', () => {
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ remetentes: [] })).resultado).toBe('NO_SENDER');
  });
  it('nova conversa com template aprovado → SENDABLE_TEMPLATE; sem template aprovado → NO_APPROVED_TEMPLATE', () => {
    const ok = avaliarEntregabilidade(aprovado(), contato(), estado());
    expect(ok.resultado).toBe('SENDABLE_TEMPLATE'); expect(ok.modo).toBe('TEMPLATE'); expect(ok.templateId).toBe('t1'); expect(ok.remetenteId).toBe('n1');
    for (const t of [template({ status: 'pending' }), template({ status: 'rejected' }), template({ ativo: false })]) {
      expect(avaliarEntregabilidade(aprovado(), contato(), estado({ templates: [t] })).resultado).toBe('NO_APPROVED_TEMPLATE');
    }
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ templates: [] })).resultado).toBe('NO_APPROVED_TEMPLATE');
  });
  it('conversa aberta dentro da janela de 24 h → SENDABLE_FREEFORM; fora da janela ou fechada volta a exigir template', () => {
    const dentro = comProvaDeJanela({ id: 'chat1', canal: 'whatsapp', status: 'talking', aberta: true, ultimaMensagemEm: '2026-09-10T06:00:00.000Z' }, avaliarJanelaLivre([msg('m1', '2026-09-10T06:00:00.000Z', 'entrada')], HOJE));
    const livre = avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: dentro }));
    expect(livre.resultado).toBe('SENDABLE_FREEFORM'); expect(livre.modo).toBe('FREEFORM'); expect(livre.janelaLivreAte).toBe('2026-09-11T06:00:00.000Z');
    const fora = comProvaDeJanela(dentro, avaliarJanelaLivre([msg('m1', '2026-09-09T06:00:00.000Z', 'entrada')], HOJE)); // mais de 24 h
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: fora })).resultado).toBe('SENDABLE_TEMPLATE');
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: { ...dentro, aberta: false, status: 'closed' } })).resultado).toBe('SENDABLE_TEMPLATE');
    expect(JANELA_LIVRE_HORAS).toBe(24);
  });
  it('provider manual dispensa configuração, mas ainda exige um número no canal WhatsApp', () => {
    const manual = (c = contato()) => avaliarEntregabilidade(aprovado(), c, { provider: 'MANUAL', saude: { estado: 'CONNECTED' }, remetentes: [], templates: [] });
    expect(manual().resultado).toBe('SENDABLE_FREEFORM'); expect(manual().modo).toBe('MANUAL');
    expect(manual(contato({ whatsapp: undefined })).resultado).toBe('MISSING_PHONE');
  });
});

describe('idempotência e bloqueio de envio', () => {
  it('mesma comunicação, provider, canal, modo e template geram a mesma chave; qualquer diferença muda a chave', () => {
    const base = { comunicacaoId: 'com-1', provider: 'OCTADESK' as const, canal: 'WHATSAPP' as Canal, modo: 'TEMPLATE' as const, remetenteId: 'n1', templateId: 't1' };
    const k = chaveIdempotencia(base);
    expect(chaveIdempotencia(base)).toBe(k); // duplo clique
    expect(chaveIdempotencia({ ...base, modo: 'FREEFORM' })).not.toBe(k);
    expect(chaveIdempotencia({ ...base, templateId: 't2' })).not.toBe(k);
    expect(chaveIdempotencia({ ...base, provider: 'MANUAL' })).not.toBe(k);
    expect(chaveIdempotencia({ ...base, versao: 'v2' })).not.toBe(k);
    expect(k).toContain('com-1');
  });
  it('nenhum provider envia nesta fase: sendApproved recusa', async () => {
    const p = providerManual();
    await expect(p.sendApproved({ comunicacaoId: 'c', contatoId: 'x', canal: 'WHATSAPP', modo: 'MANUAL', idempotencyKey: 'k' })).rejects.toMatchObject({ codigo: ENVIO_BLOQUEADO });
    expect(p.capabilities()).not.toContain('NEW_CONVERSATION_TEMPLATE');
  });
  it('webhook de entrada não está disponível e nenhum mapeamento de template é assumido', () => {
    expect(WEBHOOK_INBOUND_DISPONIVEL).toBe(false);
    expect(MAPEAMENTOS_TEMPLATE).toEqual([]);
  });
});


describe('janela de atendimento: só com prova de mensagem do contato', () => {
  it('direção vem de sentBy.type, nunca do status ("received" = entregue ao destinatário)', () => {
    expect(direcaoMensagem('contact')).toBe('entrada');
    expect(direcaoMensagem('Contato')).toBe('entrada');
    expect(direcaoMensagem('agent')).toBe('saida');
    expect(direcaoMensagem('bot')).toBe('saida');
    expect(direcaoMensagem(undefined)).toBe('desconhecida');
    expect(direcaoMensagem('received')).toBe('desconhecida');
  });
  it('mensagem NOSSA recente não abre a janela livre', () => {
    const p = avaliarJanelaLivre([msg('m1', '2026-09-10T11:00:00.000Z', 'saida')], HOJE);
    expect(p.janelaComprovada).toBe(false); expect(p.ultimaMensagemInboundEm).toBeUndefined(); expect(p.motivo).toMatch(/nenhuma mensagem do contato/i);
  });
  it('mensagem do contato dentro de 24 h abre a janela e devolve até quando', () => {
    const p = avaliarJanelaLivre([msg('m1', '2026-09-10T06:00:00.000Z', 'entrada'), msg('m2', '2026-09-10T11:00:00.000Z', 'saida')], HOJE);
    expect(p.janelaComprovada).toBe(true); expect(p.ultimaMensagemInboundEm).toBe('2026-09-10T06:00:00.000Z'); expect(p.janelaLivreAte).toBe('2026-09-11T06:00:00.000Z');
  });
  it('mensagem do contato com mais de 24 h não abre a janela', () => {
    const p = avaliarJanelaLivre([msg('m1', '2026-09-09T06:00:00.000Z', 'entrada')], HOJE);
    expect(p.janelaComprovada).toBe(false); expect(p.motivo).toMatch(/passou de 24 h/);
  });
  it('sem histórico, com direção indeterminada ou só mensagem interna, nunca comprova', () => {
    expect(avaliarJanelaLivre([], HOJE).janelaComprovada).toBe(false);
    expect(avaliarJanelaLivre([], HOJE).motivo).toMatch(/sem histórico/i);
    expect(avaliarJanelaLivre([msg('m1', '2026-09-10T11:00:00.000Z', 'desconhecida')], HOJE).janelaComprovada).toBe(false);
    expect(avaliarJanelaLivre([msg('m1', '2026-09-10T11:00:00.000Z', 'entrada', true)], HOJE).janelaComprovada).toBe(false);
    expect(avaliarJanelaLivre([msg('m1', 'data-invalida', 'entrada')], HOJE).janelaComprovada).toBe(false);
  });
  it('entregabilidade: conversa aberta sem janela comprovada volta para TEMPLATE', () => {
    const semProva = { id: 'chat1', canal: 'whatsapp', status: 'talking', aberta: true, ultimaMensagemEm: '2026-09-10T11:00:00.000Z' };
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: semProva })).resultado).toBe('SENDABLE_TEMPLATE');
    const provada = comProvaDeJanela(semProva, avaliarJanelaLivre([msg('m1', '2026-09-10T09:00:00.000Z', 'entrada')], HOJE));
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: provada })).resultado).toBe('SENDABLE_FREEFORM');
    // sem template aprovado, a mesma conversa sem prova cai para NO_APPROVED_TEMPLATE, nunca para freeform
    expect(avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: semProva, templates: [] })).resultado).toBe('NO_APPROVED_TEMPLATE');
  });
});

describe('máquina de estados da entrega', () => {
  it('permite só as transições declaradas', () => {
    expect(TRANSICOES_ENTREGA.READY).toEqual(['REQUESTED']);
    expect(TRANSICOES_ENTREGA.REQUESTED).toEqual(['ACCEPTED', 'FAILED', 'UNKNOWN']);
    expect(TRANSICOES_ENTREGA.ACCEPTED).toEqual(['DELIVERED', 'FAILED', 'UNKNOWN']);
    for (const t of ['DELIVERED', 'FAILED', 'UNKNOWN'] as EstadoEntrega[]) expect(TRANSICOES_ENTREGA[t]).toEqual([]);
  });
  it('recusa regressão e salto arbitrário', () => {
    expect(podeTransicionarEntrega('READY', 'REQUESTED')).toBe(true);
    for (const [de, para] of [['READY', 'ACCEPTED'], ['READY', 'DELIVERED'], ['ACCEPTED', 'REQUESTED'], ['DELIVERED', 'FAILED'], ['FAILED', 'REQUESTED'], ['UNKNOWN', 'ACCEPTED'], ['UNKNOWN', 'REQUESTED']] as [EstadoEntrega, EstadoEntrega][]) {
      expect(podeTransicionarEntrega(de, para), `${de} -> ${para}`).toBe(false);
      expect(() => transicionarEntrega(de, para, { em: HOJE })).toThrow(/não é permitida/);
    }
  });
  it('a transição válida produz o evento que será gravado', () => {
    const e = transicionarEntrega('REQUESTED', 'ACCEPTED', { em: HOJE, atorId: 'p1', statusProvider: 'sended', motivoSeguro: 'ok' });
    expect(e).toMatchObject({ deStatus: 'REQUESTED', paraStatus: 'ACCEPTED', ocorreuEm: HOJE, atorId: 'p1', statusProvider: 'sended' });
  });
});

describe('resultado ambíguo e reconciliação', () => {
  const saida = (id: string, em: string, impressao?: string) => ({ ...msg(id, em, 'saida'), impressao });
  const pedido = { solicitadoEm: '2026-09-10T12:00:00.000Z', conversaId: 'chat1' };
  it('sem mensagem de saída na janela → NOT_FOUND', () => {
    expect(reconciliarPorMensagens([], pedido).resultado).toBe('NOT_FOUND');
    expect(reconciliarPorMensagens([saida('m1', '2026-09-09T12:00:00.000Z', 'h')], { ...pedido, impressaoEsperada: 'h' }).resultado).toBe('NOT_FOUND');
    expect(reconciliarPorMensagens([msg('m1', '2026-09-10T12:01:00.000Z', 'entrada')], pedido).resultado).toBe('NOT_FOUND');
  });
  it('uma mensagem com a nossa impressão → FOUND', () => {
    const h = impressaoComparavel({ conversaId: 'chat1', texto: 'Bom dia, tudo bem?' });
    const r = reconciliarPorMensagens([saida('m1', '2026-09-10T12:01:00.000Z', h)], { ...pedido, impressaoEsperada: h });
    expect(r.resultado).toBe('FOUND'); expect(r.mensagemId).toBe('m1'); expect(r.conversaId).toBe('chat1');
  });
  it('sem impressão para comparar, impressão diferente ou duplicidade → AMBIGUOUS', () => {
    expect(reconciliarPorMensagens([saida('m1', '2026-09-10T12:01:00.000Z', 'h')], pedido).resultado).toBe('AMBIGUOUS');
    expect(reconciliarPorMensagens([saida('m1', '2026-09-10T12:01:00.000Z', 'outra')], { ...pedido, impressaoEsperada: 'h' }).resultado).toBe('AMBIGUOUS');
    const dupe = reconciliarPorMensagens([saida('m1', '2026-09-10T12:01:00.000Z', 'h'), saida('m2', '2026-09-10T12:02:00.000Z', 'h')], { ...pedido, impressaoEsperada: 'h' });
    expect(dupe.resultado).toBe('AMBIGUOUS'); expect(dupe.motivo).toMatch(/duplicidade/i);
  });
  it('UNKNOWN e AMBIGUOUS nunca autorizam reenvio automático', () => {
    expect(permiteReenvioAutomatico('UNKNOWN').permite).toBe(false);
    expect(permiteReenvioAutomatico('UNKNOWN', { resultado: 'NOT_FOUND', candidatos: 0, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'AMBIGUOUS', candidatos: 2, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'FOUND', candidatos: 1, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('ACCEPTED').permite).toBe(false);
    expect(permiteReenvioAutomatico('REQUESTED').permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED').permite).toBe(false); // falha sem reconciliação também não
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'NOT_FOUND', candidatos: 0, motivo: '' }).permite).toBe(true);
  });
  it('fingerprint é hash: nunca telefone nem texto em claro, e muda com qualquer campo', () => {
    const base = { comunicacaoId: 'c1', provider: 'OCTADESK' as const, canal: 'WHATSAPP' as Canal, modo: 'TEMPLATE' as const, remetenteId: 'n1', templateId: 't1', telefone: '5562999991234', texto: 'Bom dia' };
    const f = impressaoEnvio(base);
    expect(f).toMatch(/^[a-f0-9]{64}$/);
    expect(f).not.toContain('5562'); expect(f).not.toContain('Bom');
    expect(impressaoEnvio(base)).toBe(f);
    expect(impressaoEnvio({ ...base, texto: 'Boa tarde' })).not.toBe(f);
    expect(impressaoEnvio({ ...base, telefone: '5562999991235' })).not.toBe(f);
    expect(impressaoComparavel({ conversaId: 'chat1', texto: ' Bom dia ' })).toBe(impressaoComparavel({ conversaId: 'chat1', texto: 'Bom dia' }));
  });
});

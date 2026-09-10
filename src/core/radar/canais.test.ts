// Channel Provider 01: abstracao de canal, entregabilidade, idempotencia e a garantia de que nada envia nesta fase.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENVIO_BLOQUEADO, JANELA_LIVRE_HORAS, MAPEAMENTOS_TEMPLATE, TRANSICOES_ENTREGA, WEBHOOK_INBOUND_DISPONIVEL, avaliarEntregabilidade, avaliarJanelaLivre, chaveIdempotencia, classificarFalhaEnvio, comProvaDeJanela, direcaoMensagem, impressaoComando, impressaoMensagem, mascararTelefone, normalizarTelefone, permiteReenvioAutomatico, podeTransicionarEntrega, providerManual, reconciliarEntrega, transicionarEntrega, whatsappDoContato, type ComandoReconciliacao, type ConversaCandidata, type EstadoEntrega, type EstadoProvider, type MensagemCanal, type TemplateCanal } from './canais';
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
    await expect(p.sendApproved({ comunicacaoId: 'c', contatoId: 'x', canal: 'WHATSAPP', modo: 'MANUAL', idempotencyKey: 'k', telefone: '5562999991234' })).rejects.toMatchObject({ codigo: ENVIO_BLOQUEADO });
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

describe('reconciliação por conversa candidata', () => {
  const TEXTO = 'Bom dia, tudo bem? Queria entender a frente de expansão.';
  const solicitadoEm = '2026-09-10T12:00:00.000Z';
  const cmd = (extra: Partial<ComandoReconciliacao> = {}): ComandoReconciliacao => ({ comunicacaoId: 'com-1', modo: 'FREEFORM', solicitadoEm, textoAprovado: TEXTO, ...extra });
  /** Mensagem de saída numa conversa, com a impressão que o provider produziria para aquele corpo naquela conversa. */
  const saida = (conversaId: string, id: string, em: string, texto?: string, direcao: MensagemCanal['direcao'] = 'saida') =>
    ({ id, conversaId, em, direcao, interna: false, impressao: texto ? impressaoMensagem({ conversaId, texto }) : undefined });
  const conversa = (conversaId: string, mensagens: (MensagemCanal & { impressao?: string })[]): ConversaCandidata => ({ conversaId, mensagens });

  it('A) conversa conhecida com uma mensagem igual → FOUND', () => {
    const r = reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO)])], cmd({ conversaProviderId: 'chatA' }));
    expect(r.resultado).toBe('FOUND'); expect(r.conversaId).toBe('chatA'); expect(r.mensagemId).toBe('m1');
  });
  it('B) conversa desconhecida, uma única conversa do contato com a mensagem → FOUND', () => {
    const r = reconciliarEntrega([conversa('chatNovo', [saida('chatNovo', 'm9', '2026-09-10T12:00:30.000Z', TEXTO)])], cmd());
    expect(r.resultado).toBe('FOUND'); expect(r.conversaId).toBe('chatNovo');
  });
  it('C) várias conversas do contato, só uma contém a mensagem → FOUND na conversa certa', () => {
    const r = reconciliarEntrega([
      conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', 'outro assunto qualquer')]),
      conversa('chatB', [saida('chatB', 'm2', '2026-09-10T12:01:00.000Z', TEXTO)]),
      conversa('chatC', []),
    ], cmd());
    expect(r.resultado).toBe('FOUND'); expect(r.conversaId).toBe('chatB'); expect(r.mensagemId).toBe('m2');
  });
  it('a impressão é recalculada por conversa: o mesmo texto em outra conversa tem outro hash', () => {
    expect(impressaoMensagem({ conversaId: 'chatA', texto: TEXTO })).not.toBe(impressaoMensagem({ conversaId: 'chatB', texto: TEXTO }));
    // e o hash do comando (auditável) nunca é igual ao hash de casamento de mensagem
    expect(impressaoComando({ comunicacaoId: 'com-1', provider: 'OCTADESK', canal: 'WHATSAPP', modo: 'FREEFORM', texto: TEXTO })).not.toBe(impressaoMensagem({ conversaId: 'chatA', texto: TEXTO }));
  });
  it('D) duas conversas com a mesma mensagem → AMBIGUOUS', () => {
    const r = reconciliarEntrega([
      conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO)]),
      conversa('chatB', [saida('chatB', 'm2', '2026-09-10T12:02:00.000Z', TEXTO)]),
    ], cmd());
    expect(r.resultado).toBe('AMBIGUOUS'); expect(r.motivo).toMatch(/duplicidade/i);
  });
  it('E) nenhuma conversa contém a mensagem → NOT_FOUND', () => {
    expect(reconciliarEntrega([conversa('chatA', []), conversa('chatB', [])], cmd()).resultado).toBe('NOT_FOUND');
    expect(reconciliarEntrega([], cmd()).resultado).toBe('NOT_FOUND');
    // fora da janela do pedido também não conta
    expect(reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-09T12:00:00.000Z', TEXTO)])], cmd()).resultado).toBe('NOT_FOUND');
  });
  it('F) mensagem sem corpo, com direção desconhecida ou interna nunca prova FOUND', () => {
    const semCorpo = reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z')])], cmd());
    expect(semCorpo.resultado).toBe('AMBIGUOUS'); expect(semCorpo.candidatos).toBe(1);
    const direcaoIndefinida = reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO, 'desconhecida')])], cmd());
    expect(direcaoIndefinida.resultado).toBe('AMBIGUOUS');
    const entrada = reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO, 'entrada')])], cmd());
    expect(entrada.resultado).toBe('NOT_FOUND'); // mensagem do contato não é candidata a envio nosso
  });
  it('modo TEMPLATE não prova FOUND: o corpo no provider é o template renderizado', () => {
    const r = reconciliarEntrega([conversa('chatA', [saida('chatA', 'm1', '2026-09-10T12:01:00.000Z', 'Olá Fulano, tudo bem?')])], cmd({ modo: 'TEMPLATE', textoAprovado: undefined }));
    expect(r.resultado).toBe('AMBIGUOUS'); expect(r.motivo).toMatch(/template renderizado/i);
    expect(reconciliarEntrega([conversa('chatA', [])], cmd({ modo: 'TEMPLATE', textoAprovado: undefined })).resultado).toBe('NOT_FOUND');
  });
  it('UNKNOWN e AMBIGUOUS nunca autorizam reenvio automático', () => {
    expect(permiteReenvioAutomatico('UNKNOWN').permite).toBe(false);
    expect(permiteReenvioAutomatico('UNKNOWN', { resultado: 'NOT_FOUND', candidatos: 0, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'AMBIGUOUS', candidatos: 2, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'FOUND', candidatos: 1, motivo: '' }).permite).toBe(false);
    expect(permiteReenvioAutomatico('ACCEPTED').permite).toBe(false);
    expect(permiteReenvioAutomatico('REQUESTED').permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED').permite).toBe(false);
    expect(permiteReenvioAutomatico('FAILED', { resultado: 'NOT_FOUND', candidatos: 0, motivo: '' }).permite).toBe(true);
  });
  it('fingerprint do comando é hash e não vaza telefone nem texto', () => {
    const base = { comunicacaoId: 'c1', provider: 'OCTADESK' as const, canal: 'WHATSAPP' as Canal, modo: 'TEMPLATE' as const, remetenteId: 'n1', templateId: 't1', telefone: '5562999991234', texto: 'Bom dia' };
    const f = impressaoComando(base);
    expect(f).toMatch(/^[a-f0-9]{64}$/);
    expect(f).not.toContain('5562'); expect(f).not.toContain('Bom');
    expect(impressaoComando(base)).toBe(f);
    expect(impressaoComando({ ...base, texto: 'Boa tarde' })).not.toBe(f);
    expect(impressaoComando({ ...base, telefone: '5562999991235' })).not.toBe(f);
    expect(impressaoMensagem({ conversaId: 'chat1', texto: ' Bom dia ' })).toBe(impressaoMensagem({ conversaId: 'chat1', texto: 'Bom dia' }));
  });
});

describe('classificação de falha do provider (regra do Send Pilot)', () => {
  it('rejeição explícita e definitiva → FAILED', () => {
    const r = classificarFalhaEnvio({ httpStatus: 400, erroCodigo: 'INVALID_TEMPLATE' });
    expect(r.status).toBe('FAILED'); expect(r.motivo).toMatch(/rejeição explícita/i);
  });
  it('timeout, rede, 5xx e resposta ininteligível → UNKNOWN, nunca FAILED', () => {
    expect(classificarFalhaEnvio({ timeout: true }).status).toBe('UNKNOWN');
    expect(classificarFalhaEnvio({ rede: true }).status).toBe('UNKNOWN');
    for (const s of [500, 502, 503, 504]) expect(classificarFalhaEnvio({ httpStatus: s }).status).toBe('UNKNOWN');
    expect(classificarFalhaEnvio({ httpStatus: 200, corpoInterpretavel: false }).status).toBe('UNKNOWN');
    expect(classificarFalhaEnvio({}).status).toBe('UNKNOWN');
  });
  it('4xx sem código de erro identificado não vira FAILED', () => {
    expect(classificarFalhaEnvio({ httpStatus: 429 }).status).toBe('UNKNOWN');
  });
  it('timeout tem precedência sobre o status HTTP', () => {
    expect(classificarFalhaEnvio({ timeout: true, httpStatus: 400, erroCodigo: 'X' }).status).toBe('UNKNOWN');
  });
});

describe('autoridade do ledger: o navegador não escreve entrega', () => {
  const arquivos = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  it('nenhum código de tela ou store escreve em radar_communication_delivery nem chama as RPCs server-only', () => {
    const fontes = arquivos('src').filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('canaisServidor') && !f.endsWith('.test.ts'));
    for (const f of fontes) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/radar_delivery_create|radar_delivery_transition/);
      if (/radar_communication_delivery/.test(t)) expect(t, f).not.toMatch(/insert|update|upsert/i);
    }
  });
  it('a migration 0047 revoga insert/update de authenticated e deixa as RPCs só para service_role', () => {
    const sql = fs.readFileSync('supabase/migrations/0047_radar_delivery_authority.sql', 'utf8');
    expect(sql).toMatch(/revoke insert, update, delete, truncate on radar_communication_delivery from authenticated/);
    expect(sql).toMatch(/grant select on radar_communication_delivery to authenticated/);
    for (const fn of ['radar_delivery_create', 'radar_delivery_transition']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function ${fn}[^;]*from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function ${fn}[^;]*to service_role`));
    }
  });
});

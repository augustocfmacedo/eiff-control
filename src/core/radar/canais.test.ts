// Channel Provider 01: abstracao de canal, entregabilidade, idempotencia e a garantia de que nada envia nesta fase.
import { describe, expect, it } from 'vitest';
import { ENVIO_BLOQUEADO, JANELA_LIVRE_HORAS, MAPEAMENTOS_TEMPLATE, WEBHOOK_INBOUND_DISPONIVEL, avaliarEntregabilidade, chaveIdempotencia, mascararTelefone, normalizarTelefone, providerManual, whatsappDoContato, type EstadoProvider, type TemplateCanal } from './canais';
import type { Canal } from './types';

const HOJE = '2026-09-10T12:00:00.000Z';
const aprovado = (canal: Canal = 'WHATSAPP') => ({ estado: 'APPROVED', canal });
const contato = (extra: Record<string, unknown> = {}) => ({ whatsapp: '(62) 99999-1234', celular: undefined, telefone: undefined, statusTelefone: 'valido' as const, situacao: 'ATIVO' as const, ...extra });
const template = (extra: Partial<TemplateCanal> = {}): TemplateCanal => ({ id: 't1', nome: 'primeiro_contato', status: 'approved', categoria: 'MARKETING', idioma: 'pt_BR', ativo: true, variaveis: ['nome'], ...extra });
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
    const dentro = { id: 'chat1', canal: 'whatsapp', status: 'talking', aberta: true, ultimaMensagemEm: '2026-09-10T06:00:00.000Z' };
    const livre = avaliarEntregabilidade(aprovado(), contato(), estado({ conversa: dentro }));
    expect(livre.resultado).toBe('SENDABLE_FREEFORM'); expect(livre.modo).toBe('FREEFORM'); expect(livre.janelaLivreAte).toBe('2026-09-11T06:00:00.000Z');
    const fora = { ...dentro, ultimaMensagemEm: '2026-09-09T06:00:00.000Z' }; // mais de 24 h
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

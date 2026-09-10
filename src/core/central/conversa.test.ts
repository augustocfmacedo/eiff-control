// Conversa da Central: idempotencia do webhook (a Meta reenvia ate receber 200), reuso de conversa por
// (organizacao, contexto, telefone), evento fora de ordem, contexto desconhecido e takeover humano.
import { describe, expect, it } from 'vitest';
import { aplicarEventos, assumirAtendimento, chaveEvento, encerrarConversa, estadoVazio, podeAgenteResponder, resumoConversa, type EstadoCentral } from './conversa';
import type { ChannelInboundEvent } from '../radar/canais';

const ORG = 'org-1';
const AGORA = '2026-09-10T12:00:00.000Z';
const TELEFONE = '5562999991234';
const opcoes = { organizationId: ORG, agoraIso: AGORA };

const recebida = (id: string, quando = '2026-09-10T11:59:00.000Z', extra: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent => ({
  provider: 'META_CLOUD', phoneNumberId: 'pn-interno', contexto: 'INTERNAL', externalConversationId: TELEFONE,
  externalMessageId: id, direction: 'inbound', eventType: 'MESSAGE_RECEIVED', occurredAt: quando,
  contactPhone: TELEFONE, messageType: 'text', ...extra,
});
const status = (id: string, tipo: ChannelInboundEvent['eventType'], quando: string, extra: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent => ({
  provider: 'META_CLOUD', phoneNumberId: 'pn-interno', contexto: 'INTERNAL', externalConversationId: 'conv-meta-1',
  externalMessageId: id, direction: 'outbound', eventType: tipo, occurredAt: quando, contactPhone: TELEFONE, ...extra,
});

describe('idempotência do webhook', () => {
  it('a mesma notificação reenviada não vira segunda mensagem, segundo evento nem segunda ação', () => {
    const primeira = aplicarEventos(estadoVazio(), [recebida('wamid.1')], opcoes);
    expect(primeira.mensagensNovas).toHaveLength(1);
    expect(primeira.conversasNovas).toHaveLength(1);
    expect(primeira.paraAgente).toHaveLength(1);

    const segunda = aplicarEventos(primeira.estado, [recebida('wamid.1')], opcoes);
    expect(segunda.mensagensNovas).toEqual([]);
    expect(segunda.eventosNovos).toEqual([]);
    expect(segunda.conversasNovas).toEqual([]);
    expect(segunda.paraAgente).toEqual([]);
    expect(segunda.duplicados).toHaveLength(1);
    expect(segunda.duplicados[0].motivo).toMatch(/reenvia/);
    expect(segunda.estado.mensagens).toHaveLength(1);
    expect(segunda.estado.conversas).toHaveLength(1);
  });
  it('a repetição dentro do MESMO lote também é deduplicada', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1'), recebida('wamid.1'), recebida('wamid.2')], opcoes);
    expect(r.mensagensNovas.map((m) => m.externalMessageId)).toEqual(['wamid.1', 'wamid.2']);
    expect(r.duplicados).toHaveLength(1);
    expect(r.paraAgente).toHaveLength(2);
  });
  it('a chave do evento separa os status da MESMA mensagem, mas repete a si mesma', () => {
    const e = status('wamid.9', 'MESSAGE_SENT', AGORA);
    expect(chaveEvento(ORG, e)).toBe(`${ORG}|META_CLOUD|wamid.9|MESSAGE_SENT`);
    expect(chaveEvento(ORG, { ...e, eventType: 'MESSAGE_DELIVERED' })).not.toBe(chaveEvento(ORG, e));
    // sem externalMessageId a chave cai para conversa + tipo + instante
    expect(chaveEvento(ORG, { ...e, externalMessageId: undefined, eventType: 'CONVERSATION_STATUS' })).toContain('conversa:');
  });
  it('a aplicação não muda o estado recebido', () => {
    const estado = estadoVazio();
    aplicarEventos(estado, [recebida('wamid.1')], opcoes);
    expect(estado).toEqual({ conversas: [], mensagens: [], eventos: [] });
  });
});

describe('conversa por (organização, contexto, telefone)', () => {
  it('mensagens do mesmo número no mesmo contexto caem na mesma conversa', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1'), recebida('wamid.2', '2026-09-10T11:59:30.000Z')], opcoes);
    expect(r.estado.conversas).toHaveLength(1);
    expect(r.estado.conversas[0].ultimaMensagemInboundEm).toBe('2026-09-10T11:59:30.000Z');
  });
  it('o mesmo número no outro contexto é OUTRA conversa', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1'), recebida('wamid.2', AGORA, { contexto: 'EXTERNAL', phoneNumberId: 'pn-externo' })], opcoes);
    expect(r.estado.conversas).toHaveLength(2);
    expect(r.estado.conversas.map((c) => c.contexto).sort()).toEqual(['EXTERNAL', 'INTERNAL']);
  });
  it('contexto desconhecido não vira conversa INTERNAL por conveniência', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1', AGORA, { contexto: undefined, phoneNumberId: 'numero-estranho' })], opcoes);
    expect(r.estado.conversas).toEqual([]);
    expect(r.estado.mensagens).toEqual([]);
    expect(r.ignorados[0].motivo).toMatch(/contexto indefinido/);
  });
  it('evento sem telefone normalizável é ignorado', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1', AGORA, { contactPhone: '123' })], opcoes);
    expect(r.ignorados[0].motivo).toBe('evento sem telefone normalizado');
    expect(r.estado.conversas).toEqual([]);
  });
  it('conversa encerrada é reaberta pela mensagem seguinte, sem duplicar a linha', () => {
    const primeira = aplicarEventos(estadoVazio(), [recebida('wamid.1')], opcoes);
    const fechada: EstadoCentral = { ...primeira.estado, conversas: primeira.estado.conversas.map((c) => encerrarConversa(c, AGORA)) };
    const r = aplicarEventos(fechada, [recebida('wamid.2', '2026-09-10T13:00:00.000Z')], opcoes);
    expect(r.estado.conversas).toHaveLength(1);
    expect(r.estado.conversas[0].situacao).toBe('ABERTA');
    expect(r.eventosNovos.some((e) => e.tipo === 'CONVERSA_REABERTA')).toBe(true);
  });
});

describe('evento fora de ordem', () => {
  it('delivered antes de sent: o status não anda para trás e os dois eventos ficam registrados', () => {
    const r = aplicarEventos(estadoVazio(), [
      status('wamid.9', 'MESSAGE_DELIVERED', '2026-09-10T12:00:02.000Z'),
      status('wamid.9', 'MESSAGE_SENT', '2026-09-10T12:00:01.000Z'),
    ], opcoes);
    expect(r.estado.mensagens).toHaveLength(1);
    expect(r.estado.mensagens[0].status).toBe('ENTREGUE');
    expect(r.eventosNovos.filter((e) => e.mensagemId).map((e) => e.tipo)).toEqual(['MESSAGE_DELIVERED', 'MESSAGE_SENT']);
    expect(r.foraDeOrdem).toHaveLength(1);
    expect(r.foraDeOrdem[0].motivo).toMatch(/não anda para trás/);
  });
  it('a sequência normal avança sent → delivered → read', () => {
    const r = aplicarEventos(estadoVazio(), [
      status('wamid.9', 'MESSAGE_SENT', '2026-09-10T12:00:01.000Z'),
      status('wamid.9', 'MESSAGE_DELIVERED', '2026-09-10T12:00:02.000Z'),
      status('wamid.9', 'MESSAGE_READ', '2026-09-10T12:00:03.000Z'),
    ], opcoes);
    expect(r.estado.mensagens[0].status).toBe('LIDA');
    expect(r.foraDeOrdem).toEqual([]);
  });
  it('falha depois do envio vira FALHOU e guarda o código do erro', () => {
    const r = aplicarEventos(estadoVazio(), [
      status('wamid.9', 'MESSAGE_SENT', '2026-09-10T12:00:01.000Z'),
      status('wamid.9', 'MESSAGE_FAILED', '2026-09-10T12:00:02.000Z', { erroCodigo: '131047' }),
    ], opcoes);
    expect(r.estado.mensagens[0]).toMatchObject({ status: 'FALHOU', erroCodigo: '131047' });
  });
});

describe('takeover humano', () => {
  it('com humano responsável, nenhum agente responde — mas a mensagem continua registrada', () => {
    const primeira = aplicarEventos(estadoVazio(), [recebida('wamid.1')], opcoes);
    const comHumano: EstadoCentral = { ...primeira.estado, conversas: primeira.estado.conversas.map((c) => assumirAtendimento(c, 'u-maria')) };
    expect(podeAgenteResponder(comHumano.conversas[0])).toBe(false);
    const r = aplicarEventos(comHumano, [recebida('wamid.2', '2026-09-10T12:05:00.000Z')], opcoes);
    expect(r.mensagensNovas).toHaveLength(1);
    expect(r.paraAgente).toEqual([]);
    expect(r.ignorados[0].motivo).toMatch(/atendimento humano/);
  });
  it('conversa aberta e sem humano libera o agente; devolver o atendimento libera de novo', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1')], opcoes);
    expect(podeAgenteResponder(r.estado.conversas[0])).toBe(true);
    expect(podeAgenteResponder(encerrarConversa(r.estado.conversas[0], AGORA))).toBe(false);
  });
});

describe('telefone mascarado em qualquer saída', () => {
  it('nenhum detalhe de evento, resumo de conversa ou id traz o número inteiro', () => {
    const r = aplicarEventos(estadoVazio(), [recebida('wamid.1'), status('wamid.9', 'MESSAGE_FAILED', AGORA, { erroCodigo: '131047' })], opcoes);
    for (const e of r.estado.eventos) expect(e.detalhe, e.detalhe).not.toContain(TELEFONE);
    for (const c of r.estado.conversas) {
      expect(resumoConversa(c)).not.toContain(TELEFONE);
      expect(c.id).not.toContain(TELEFONE);
    }
    expect(r.estado.eventos[0].detalhe).toContain('5562*******34');
  });
});

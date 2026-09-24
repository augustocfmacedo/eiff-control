// EIFF Inbox — ingestao server-side dos eventos da Central: adapter, idempotencia pela porta, fallback sem IA e log seguro.
// Portas falsas; nenhuma rede, nenhum banco, nenhuma IA real.
import { describe, expect, it } from 'vitest';
import type { ChannelInboundEvent } from '../radar/canais';
import { extrairConteudosMeta } from '../central/metaEventos';
import { ingerirEventosCentral, pedidoDe, type PedidoIngest, type PortasIngestao, type ResultadoIngest } from './ingestaoServidor';
import { deEventoCentral, type IntelligenceProvider } from './fronteiras';
import { seedInbox } from './seed';
import { configPortaIngest, portaIngestRpc } from './ingestaoPorta';

const ORG = '11111111-1111-1111-1111-111111111111';
const TEL = '5562988887777';
const evento = (p: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent => ({ provider: 'META_CLOUD', phoneNumberId: 'pn-1', contexto: 'EXTERNAL', externalConversationId: TEL, externalMessageId: 'wamid.1', direction: 'inbound', eventType: 'MESSAGE_RECEIVED', occurredAt: '2026-09-23T12:00:00.000Z', contactPhone: TEL, messageType: 'text', ...p });
const conteudo = (id = 'wamid.1', texto = 'Bom dia, a NF 583 já está liberada?') => ({ externalMessageId: id, texto, nomeInformado: 'Paulo Aços' });

function portas(extra: Partial<PortasIngestao> = {}) {
  const pedidos: PedidoIngest[] = []; const logs: Record<string, unknown>[] = []; const vistos = new Set<string>();
  const p: PortasIngestao = {
    async ingerir(x) { pedidos.push(x); const chave = `${x.provider}|${x.externalMessageId}`; const dup = vistos.has(chave); vistos.add(chave); return { ok: true, duplicada: dup, threadId: 'thr-1', messageId: `msg-${pedidos.length}`, novaThread: !dup && pedidos.length === 1, novoContato: pedidos.length === 1 } as ResultadoIngest; },
    log: (t) => logs.push(t), agora: () => '2026-09-23T12:00:05.000Z', ...extra,
  };
  return { p, pedidos, logs };
}

describe('porta server-side da RPC', () => {
  it('sem chave de serviço ou sem organização a ingestão é pulada; com elas, chama SÓ a RPC inbox_ingest', async () => {
    expect(configPortaIngest({})).toMatchObject({ motivo: expect.stringMatching(/SERVICE_ROLE/) });
    expect(configPortaIngest({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toMatchObject({ motivo: expect.stringMatching(/ORGANIZATION/) });
    const cfg = configPortaIngest({ SUPABASE_SERVICE_ROLE_KEY: 'chave-secreta', EIFF_INBOX_ORGANIZATION_ID: ORG, SUPABASE_URL: 'https://x.supabase.co/' });
    if ('motivo' in cfg) throw new Error(cfg.motivo);
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const fetchFake = (async (url: string, init?: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ ok: true, duplicada: false, thread_id: 't', message_id: 'm', nova_thread: true }), { status: 200 }); }) as unknown as typeof fetch;
    const m = deEventoCentral(evento(), conteudo()); if ('erro' in m) throw new Error(m.erro);
    const r = await portaIngestRpc(cfg, fetchFake)(pedidoDe(ORG, m));
    expect(r).toMatchObject({ ok: true, threadId: 't', messageId: 'm', novaThread: true });
    expect(chamadas).toHaveLength(1); expect(chamadas[0].url).toBe('https://x.supabase.co/rest/v1/rpc/inbox_ingest'); expect(chamadas[0].init?.method).toBe('POST');
    const corpo = JSON.parse(String(chamadas[0].init?.body));
    expect(corpo).toMatchObject({ p_organization_id: ORG, p_identifier: TEL, p_external_message_id: 'wamid.1', p_body: 'Bom dia, a NF 583 já está liberada?' });
    // a chave so vai no cabecalho; erro HTTP nao ecoa corpo nem chave
    expect(String(chamadas[0].init?.body)).not.toContain('chave-secreta');
    const fetch500 = (async () => new Response('{"message":"segredo-no-corpo"}', { status: 500 })) as unknown as typeof fetch;
    await expect(portaIngestRpc(cfg, fetch500)(pedidoDe(ORG, m))).rejects.toThrow(/http 500$/);
  });
});

describe('adapter Central → Inbox', () => {
  it('evento MESSAGE_RECEIVED com contexto vira pedido completo; texto vem do conteúdo, não do evento', () => {
    const m = deEventoCentral(evento(), conteudo());
    expect('erro' in m).toBe(false);
    if ('erro' in m) return;
    const ped = pedidoDe(ORG, m);
    expect(ped).toMatchObject({ organizationId: ORG, provider: 'META_CLOUD', canal: 'WHATSAPP', contexto: 'EXTERNAL', identificador: TEL, nomeInformado: 'Paulo Aços', externalMessageId: 'wamid.1', texto: 'Bom dia, a NF 583 já está liberada?', tipo: 'texto' });
    expect(ped.meta).toMatchObject({ tipoOriginal: 'text', phoneNumberId: 'pn-1' });
    expect(deEventoCentral(evento({ messageType: 'image' }), { texto: '[image]' })).toMatchObject({ tipo: 'imagem' });
  });
  it('a Central continua sem transportar texto: extrairConteudosMeta lê o corpo do payload e casa pelo id', () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'pn-1' }, contacts: [{ wa_id: TEL, profile: { name: 'Paulo Aços' } }], messages: [{ id: 'wamid.1', from: TEL, type: 'text', text: { body: 'oi' } }, { id: 'wamid.2', from: TEL, type: 'image', image: { caption: 'etiqueta' }, context: { id: 'wamid.1' } }, { id: 'wamid.3', from: TEL, type: 'audio', audio: {} }] } }] }] };
    expect(extrairConteudosMeta(payload)).toEqual([
      { externalMessageId: 'wamid.1', texto: 'oi', replyToExternalId: undefined, nomeInformado: 'Paulo Aços' },
      { externalMessageId: 'wamid.2', texto: 'etiqueta', replyToExternalId: 'wamid.1', nomeInformado: 'Paulo Aços' },
      { externalMessageId: 'wamid.3', texto: '[audio]', replyToExternalId: undefined, nomeInformado: 'Paulo Aços' },
    ]);
    expect(extrairConteudosMeta({ object: 'outra' })).toEqual([]);
  });
});

describe('ingestão de um webhook', () => {
  it('cria mensagem e thread pela porta; status de entrega e número desconhecido são ignorados, não inventados', async () => {
    const { p, pedidos } = portas();
    const r = await ingerirEventosCentral(ORG, [evento(), evento({ eventType: 'MESSAGE_DELIVERED', direction: 'outbound', externalMessageId: 'wamid.out' }), evento({ contexto: undefined, externalMessageId: 'wamid.x' })], [conteudo()], p);
    expect(r).toMatchObject({ recebidos: 3, ingeridos: 1, duplicados: 0, falhas: [], threads: ['thr-1'], semInteligencia: 1 });
    expect(r.ignorados.map((i) => i.motivo)).toEqual([expect.stringMatching(/não é mensagem recebida/), expect.stringMatching(/contexto indefinido/)]);
    expect(pedidos).toHaveLength(1);
  });
  it('o mesmo evento duas vezes (reenvio da Meta) conta como duplicado: uma mensagem, uma thread', async () => {
    const { p, pedidos } = portas();
    await ingerirEventosCentral(ORG, [evento()], [conteudo()], p);
    const r = await ingerirEventosCentral(ORG, [evento()], [conteudo()], p);
    expect(r.duplicados).toBe(1); expect(r.ingeridos).toBe(0); expect(pedidos).toHaveLength(2);
    expect(pedidos[0]).toEqual(pedidos[1]); // a porta (RPC) e idempotente pelo mesmo pedido
  });
  it('mensagem seguinte do mesmo contato vai para a porta com a mesma identidade (a RPC reutiliza a thread)', async () => {
    const { p, pedidos } = portas();
    await ingerirEventosCentral(ORG, [evento(), evento({ externalMessageId: 'wamid.2' })], [conteudo(), conteudo('wamid.2', 'segue anexo')], p);
    expect(pedidos.map((x) => x.identificador)).toEqual([TEL, TEL]); expect(pedidos[1].texto).toBe('segue anexo');
  });
  it('falha da porta vira `falhas` (o webhook responde 500 e a Meta reenvia); os outros eventos seguem', async () => {
    let n = 0;
    const { p } = portas({ async ingerir() { if (++n === 1) throw new Error('banco indisponível'); return { ok: true, threadId: 't', messageId: 'm' }; } });
    const r = await ingerirEventosCentral(ORG, [evento(), evento({ externalMessageId: 'wamid.2' })], [conteudo(), conteudo('wamid.2')], p);
    expect(r.falhas).toEqual([{ externalMessageId: 'wamid.1', erro: 'banco indisponível' }]); expect(r.ingeridos).toBe(1);
  });
  it('FALLBACK: inteligência quebrada não perde a mensagem — persistida, thread fica sem classificação', async () => {
    const ds = seedInbox('2026-09-23T12:00:00.000Z');
    const quebrada: IntelligenceProvider = { codigo: 'LLM', async analisar() { throw new Error('modelo fora do ar'); } };
    let aplicou = 0;
    const { p, pedidos, logs } = portas({ inteligencia: quebrada, async carregarParaAnalise() { return { thread: ds.threads[6], mensagem: ds.mensagens[0], historico: [], setores: [] }; }, async aplicarClassificacao() { aplicou++; } });
    const r = await ingerirEventosCentral(ORG, [evento()], [conteudo()], p);
    expect(r.ingeridos).toBe(1); expect(r.semInteligencia).toBe(1); expect(r.classificados).toBe(0); expect(aplicou).toBe(0); expect(pedidos).toHaveLength(1);
    expect(logs.some((l) => l.evento === 'inbox_inteligencia' && l.outcome === 'indisponivel')).toBe(true);
  });
  it('inteligência disponível classifica e aplica; sem provedor configurado nada é chamado', async () => {
    const ds = seedInbox('2026-09-23T12:00:00.000Z');
    const boa: IntelligenceProvider = { codigo: 'LLM', async analisar() { return { ok: true, resultado: { intencao: 'consultar_pagamento', assunto: 'NF', entidades: [], prioridade: 'Normal', confianca: 0.9, sinais: ['nf'], provedor: 'LLM', versao: 'v1' } }; } };
    const aplicadas: string[] = [];
    const { p } = portas({ inteligencia: boa, async carregarParaAnalise() { return { thread: ds.threads[6], mensagem: ds.mensagens[0], historico: ds.mensagens.slice(0, 30), setores: [] }; }, async aplicarClassificacao(id, c) { aplicadas.push(`${id}:${c.intencao}`); } });
    const r = await ingerirEventosCentral(ORG, [evento()], [conteudo()], p);
    expect(r.classificados).toBe(1); expect(aplicadas).toEqual(['thr-1:consultar_pagamento']);
    const semIa = portas();
    expect((await ingerirEventosCentral(ORG, [evento()], [conteudo()], semIa.p)).semInteligencia).toBe(1);
  });
  it('o log nunca leva telefone inteiro nem texto da mensagem', async () => {
    const { p, logs } = portas();
    await ingerirEventosCentral(ORG, [evento(), evento({ contexto: undefined, externalMessageId: 'wamid.x' })], [conteudo()], p);
    const s = JSON.stringify(logs);
    expect(s).not.toContain(TEL); expect(s).not.toContain('NF 583'); expect(s).toMatch(/5562\*+77/);
  });
});

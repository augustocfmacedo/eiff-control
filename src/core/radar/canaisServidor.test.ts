// Channel Provider 01 no servidor: autenticacao, read-only e a garantia de que nenhum caminho chama POST de mensagem.
// Nenhuma chamada real ao Octadesk: tudo por fetch mockado.
import { describe, expect, it } from 'vitest';
import { impressaoMensagem } from './canais';
import { PROPRIEDADE_TELEFONE, normalizarConversas, normalizarMensagens, normalizarNumeros, normalizarTemplates, tratarCanal, validarPedidoCanal, type DepsCanal } from './canaisServidor';

const URL_SB = 'https://sb.test';
const OCTA = 'https://api.octadesk.test';
const COM = '11111111-1111-1111-1111-111111111111';
const CONTATO = '22222222-2222-2222-2222-222222222222';
const EMPRESA = '33333333-3333-3333-3333-333333333333';
const ORG = '44444444-4444-4444-4444-444444444444';
const ENTREGA = '66666666-6666-6666-6666-666666666666';
const TEXTO = 'Bom dia, queria entender a frente de expansão.';

interface Cenario { perfil?: { role?: string; organization_id?: string } | null; autenticado?: boolean; comunicacao?: Record<string, unknown> | null; contato?: Record<string, unknown> | null; numeros?: unknown; templates?: unknown; chats?: unknown; mensagens?: unknown; mensagensPorChat?: Record<string, unknown[]>; entrega?: Record<string, unknown> | null; comunicacaoFull?: Record<string, unknown>; authCheck?: unknown; erroOcta?: number }
function ambiente(c: Cenario = {}) {
  const chamadas: { url: string; metodo: string }[] = [];
  const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({ url: String(url), metodo });
    const u = String(url);
    if (u.startsWith(`${URL_SB}/auth/v1/user`)) return c.autenticado === false ? j({}, 401) : j({ id: 'u-1' });
    if (u.includes('/rest/v1/profile')) return j(c.perfil === null ? [] : [c.perfil ?? { name: 'Augusto', role: 'Administrador', organization_id: ORG }]);
    if (u.includes('/rest/v1/radar_communication_delivery')) return j(c.entrega === undefined ? [{ id: ENTREGA, organization_id: ORG, communication_id: COM, contact_id: CONTATO, provider: 'OCTADESK', channel: 'WHATSAPP', mode: 'FREEFORM', status: 'UNKNOWN', requested_at: '2026-09-10T12:00:00.000Z', created_at: '2026-09-10T12:00:00.000Z', provider_conversation_id: null }] : c.entrega === null ? [] : [c.entrega]);
    if (u.includes('/rest/v1/radar_communication?') && u.includes('generated_content')) return j([c.comunicacaoFull ?? { id: COM, organization_id: ORG, state: 'APPROVED', generated_content: { versaoPrincipal: TEXTO }, edited_content: null }]);
    if (u.includes('/rest/v1/radar_communication')) return j(c.comunicacao === undefined ? [{ id: COM, company_id: EMPRESA, contact_id: CONTATO, channel: 'WHATSAPP', state: 'APPROVED', organization_id: ORG }] : c.comunicacao === null ? [] : [c.comunicacao]);
    if (u.includes('/rest/v1/radar_contact')) return j(c.contato === undefined ? [{ id: CONTATO, company_id: EMPRESA, phone: null, mobile_phone: null, whatsapp: '62999991234', phone_status: 'valido', status: 'ATIVO', organization_id: ORG }] : c.contato === null ? [] : [c.contato]);
    if (c.erroOcta && u.startsWith(OCTA)) return j({ message: 'nope' }, c.erroOcta);
    if (u.startsWith(`${OCTA}/auth/check`)) return j(c.authCheck ?? true);
    if (u.startsWith(`${OCTA}/chat/numbers`)) return j(c.numeros ?? [{ id: 'n1', name: 'Comercial', number: '556230000000' }]);
    if (u.startsWith(`${OCTA}/chat/templates-message`)) return j(c.templates ?? [{ id: 't1', name: 'primeiro_contato', status: 'approved', category: 'MARKETING', enable: true, components: [{ type: 'body', message: 'oi {{1}}', variables: [{ key: 'nome' }] }] }]);
    if (/\/chat\/([^/]+)\/messages/.test(u)) {
      const chat = /\/chat\/([^/?]+)\/messages/.exec(u)?.[1] ?? '';
      if (c.mensagensPorChat) return j(c.mensagensPorChat[chat] ?? []);
      return j(c.mensagens ?? []);
    }
    if (u.startsWith(`${OCTA}/chat`)) return j(c.chats ?? []);
    return j({}, 404);
  }) as unknown as typeof fetch;
  const deps: DepsCanal = { fetch: fetchMock, supabaseUrl: URL_SB, anon: 'anon', octadesk: { baseUrl: OCTA, apiKey: 'segredo-nunca-vaza', agentEmail: 'a@b.c' }, agora: () => '2026-09-10T12:00:00.000Z' };
  return { deps, chamadas };
}
const req = (body: unknown, authorization: string | null = 'Bearer jwt') => ({ method: 'POST', authorization, body });

describe('normalizadores da API Octadesk', () => {
  it('números: só entradas com id, campos opcionais preservados', () => {
    expect(normalizarNumeros([{ id: 'n1', name: 'Comercial', number: '5562' }, { name: 'sem id' }])).toEqual([{ id: 'n1', nome: 'Comercial', numero: '5562' }]);
    expect(normalizarNumeros({ data: [{ id: 'n2' }] })).toEqual([{ id: 'n2', nome: undefined, numero: undefined }]);
    expect(normalizarNumeros(null)).toEqual([]);
  });
  it('templates: identifica approved/pending/rejected, enable e variáveis; status estranho vira desconhecido', () => {
    const t = normalizarTemplates([
      { id: 't1', name: 'a', status: 'APPROVED', category: 'MARKETING', enable: true, components: [{ variables: [{ key: 'nome' }, { key: 'nome' }] }] },
      { id: 't2', name: 'b', status: 'pending', enable: true },
      { id: 't3', name: 'c', status: 'rejected', enable: false },
      { id: 't4', name: 'd', status: 'zzz' },
    ]);
    expect(t.map((x) => x.status)).toEqual(['approved', 'pending', 'rejected', 'desconhecido']);
    expect(t[0].variaveis).toEqual(['nome']); expect(t[2].ativo).toBe(false); expect(t[3].ativo).toBe(true);
  });
  it('conversas: waiting/talking/started são abertas; closed/missed não', () => {
    const c = normalizarConversas([{ id: 'c1', status: 'talking', channel: 'whatsapp', lastMessageDate: 'x' }, { id: 'c2', status: 'closed' }, { id: 'c3', status: 'waiting' }, { id: 'c4', status: 'missed' }]);
    expect(c.map((x) => x.aberta)).toEqual([true, false, true, false]);
  });
  it('mensagens: direção vem de sentBy.type, o corpo nunca sai e a impressão é hash', () => {
    const m = normalizarMensagens([
      { id: 'm1', chatId: 'c1', time: 't', status: 'received', type: 'public', body: 'texto secreto', sentBy: { type: 'contact' } },
      { id: 'm2', chatId: 'c1', time: 't', status: 'sended', type: 'internal', sentBy: { type: 'agent' } },
      { id: 'm3', chatId: 'c1', time: 't', status: 'received', type: 'public' },
    ]);
    expect(m.map((x) => x.direcao)).toEqual(['entrada', 'saida', 'desconhecida']); // "received" sozinho não é entrada
    expect(m[1].interna).toBe(true);
    expect(m[0].impressao).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(m)).not.toContain('texto secreto');
  });
});

describe('contrato do pedido', () => {
  it('recusa ação inválida, campo não permitido e id fora de UUID', () => {
    expect(validarPedidoCanal({ acao: 'enviar' })).toMatchObject({ erro: 'acao_invalida' });
    expect(validarPedidoCanal({ acao: 'status', telefone: '62999' })).toMatchObject({ erro: 'campos_nao_permitidos', campos: ['telefone'] });
    expect(validarPedidoCanal({ acao: 'verificar', comunicacaoId: 'abc' })).toMatchObject({ erro: 'comunicacaoId_invalido' });
    expect(validarPedidoCanal({ acao: 'verificar', comunicacaoId: COM })).toMatchObject({ acao: 'verificar', comunicacaoId: COM });
  });
});

describe('/api/channel/octadesk', () => {
  it('sem JWT → 401; sem perfil → 403; papel fora do Radar → 403', async () => {
    expect((await tratarCanal(req({ acao: 'status' }, null), ambiente().deps)).status).toBe(401);
    expect((await tratarCanal(req({ acao: 'status' }), ambiente({ autenticado: false }).deps)).status).toBe(401);
    expect((await tratarCanal(req({ acao: 'status' }), ambiente({ perfil: null }).deps)).status).toBe(403);
    expect((await tratarCanal(req({ acao: 'status' }), ambiente({ perfil: { role: 'Auditoria', organization_id: ORG } }).deps)).status).toBe(403);
  });
  it('método diferente de POST é recusado', async () => {
    expect((await tratarCanal({ method: 'GET', authorization: 'Bearer jwt', body: {} }, ambiente().deps)).status).toBe(405);
  });
  it('sem configuração → NOT_CONFIGURED, com a lista de variáveis faltando e sem tocar no provider', async () => {
    const { deps, chamadas } = ambiente();
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), { ...deps, octadesk: undefined, faltando: ['OCTADESK_API_KEY'] });
    expect(r.status).toBe(200);
    expect((r.corpo.saude as { estado: string }).estado).toBe('NOT_CONFIGURED');
    expect(r.corpo.variaveisFaltando).toEqual(['OCTADESK_API_KEY']);
    expect(chamadas.some((c) => c.url.startsWith(OCTA))).toBe(false);
  });
  it('status: conectado, capacidades sem webhook de entrada e envio marcado como bloqueado', async () => {
    const r = await tratarCanal(req({ acao: 'status' }), ambiente().deps);
    expect((r.corpo.saude as { estado: string }).estado).toBe('CONNECTED');
    expect(r.corpo.capacidades).not.toContain('INBOUND_WEBHOOK');
    expect(r.corpo.webhookInbound).toBe(false); expect(r.corpo.envioBloqueado).toBe(true);
  });
  it('chave recusada pela Octadesk vira ERROR, não exceção', async () => {
    const r = await tratarCanal(req({ acao: 'status' }), ambiente({ authCheck: false }).deps);
    expect((r.corpo.saude as { estado: string }).estado).toBe('ERROR');
    const r2 = await tratarCanal(req({ acao: 'status' }), ambiente({ erroOcta: 401 }).deps);
    expect((r2.corpo.saude as { estado: string }).estado).toBe('ERROR');
  });
  it('numbers e templates: parse correto e só GET no provider', async () => {
    const { deps, chamadas } = ambiente();
    const n = await tratarCanal(req({ acao: 'numbers' }), deps);
    expect(n.corpo.remetentes).toEqual([{ id: 'n1', nome: 'Comercial', numero: '556230000000' }]);
    const t = await tratarCanal(req({ acao: 'templates' }), deps);
    expect((t.corpo.templates as { status: string }[])[0].status).toBe('approved');
    expect(chamadas.filter((c) => c.url.startsWith(OCTA)).every((c) => c.metodo === 'GET')).toBe(true);
  });
  it('verificar: nova conversa com template aprovado → SENDABLE_TEMPLATE, telefone só mascarado na resposta', async () => {
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente().deps);
    const e = r.corpo.entregabilidade as { resultado: string; modo: string; telefone?: string };
    expect(e.resultado).toBe('SENDABLE_TEMPLATE'); expect(e.modo).toBe('TEMPLATE'); expect(e.telefone).toBeUndefined();
    expect(String(r.corpo.telefoneMascarado)).not.toContain('99999');
    expect(JSON.stringify(r.corpo)).not.toContain('segredo-nunca-vaza');
  });
  it('verificar: conversa aberta COM mensagem do contato nas últimas 24 h → SENDABLE_FREEFORM', async () => {
    const chats = [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-10T09:00:00.000Z' }];
    const mensagens = [{ id: 'm1', chatId: 'chat-1', time: '2026-09-10T09:00:00.000Z', type: 'public', status: 'received', body: 'oi', sentBy: { id: 'x', type: 'contact' } }];
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ chats, mensagens }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('SENDABLE_FREEFORM');
    const conversa = r.corpo.conversa as { id: string; janelaComprovada: boolean; ultimaMensagemInboundEm: string };
    expect(conversa.id).toBe('chat-1'); expect(conversa.janelaComprovada).toBe(true); expect(conversa.ultimaMensagemInboundEm).toBe('2026-09-10T09:00:00.000Z');
  });
  it('verificar: conversa aberta cuja última mensagem é NOSSA não libera mensagem livre', async () => {
    const chats = [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-10T11:00:00.000Z' }];
    // status "received" = entregue ao destinatario (mensagem nossa): nao pode ser lido como mensagem do contato
    const mensagens = [{ id: 'm1', chatId: 'chat-1', time: '2026-09-10T11:00:00.000Z', type: 'public', status: 'received', body: 'oi', sentBy: { id: 'a', type: 'agent' } }];
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ chats, mensagens }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('SENDABLE_TEMPLATE');
    expect((r.corpo.conversa as { janelaComprovada: boolean }).janelaComprovada).toBe(false);
  });
  it('verificar: conversa aberta sem histórico não libera mensagem livre', async () => {
    const chats = [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-10T11:00:00.000Z' }];
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ chats, mensagens: [] }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('SENDABLE_TEMPLATE');
  });
  it('verificar: mensagem do contato com mais de 24 h exige template', async () => {
    const chats = [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-09T09:00:00.000Z' }];
    const mensagens = [{ id: 'm1', chatId: 'chat-1', time: '2026-09-09T09:00:00.000Z', type: 'public', body: 'oi', sentBy: { type: 'contact' } }];
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ chats, mensagens }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('SENDABLE_TEMPLATE');
  });
  it('a busca da conversa usa a propriedade oficial contact.phoneContacts.number', async () => {
    const { deps, chamadas } = ambiente({ chats: [] });
    await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), deps);
    const lookup = chamadas.find((x) => x.url.includes('/chat?'));
    expect(PROPRIEDADE_TELEFONE).toBe('contact.phoneContacts.number');
    expect(lookup?.url).toContain(encodeURIComponent('contact.phoneContacts.number'));
    expect(lookup?.url).not.toContain('phoneContact&');
    expect(lookup?.url).toContain('5562999991234');
  });
  it('verificar: contato sem WhatsApp → MISSING_PHONE; template pendente → NO_APPROVED_TEMPLATE', async () => {
    const semFone = { id: CONTATO, company_id: EMPRESA, phone: null, mobile_phone: null, whatsapp: null, phone_status: 'desconhecido', status: 'ATIVO', organization_id: ORG };
    const r1 = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ contato: semFone }).deps);
    expect((r1.corpo.entregabilidade as { resultado: string }).resultado).toBe('MISSING_PHONE');
    const pendente = [{ id: 't1', name: 'x', status: 'pending', enable: true }];
    const r2 = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ templates: pendente }).deps);
    expect((r2.corpo.entregabilidade as { resultado: string }).resultado).toBe('NO_APPROVED_TEMPLATE');
  });
  it('comunicação ainda em revisão → NEEDS_REVIEW; de outra organização → 403; inexistente → 404', async () => {
    const revisao = { id: COM, company_id: EMPRESA, contact_id: CONTATO, channel: 'WHATSAPP', state: 'READY_FOR_REVIEW', organization_id: ORG };
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ comunicacao: revisao }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('NEEDS_REVIEW');
    const outra = { ...revisao, organization_id: '55555555-5555-5555-5555-555555555555' };
    expect((await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ comunicacao: outra }).deps)).status).toBe(403);
    expect((await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ comunicacao: null }).deps)).status).toBe(404);
  });
  it('nenhum caminho do handler faz POST no provider', async () => {
    for (const acao of ['status', 'numbers', 'templates', 'verificar', 'conversa'] as const) {
      const { deps, chamadas } = ambiente({ chats: [{ id: 'chat-1', status: 'talking', lastMessageDate: '2026-09-10T09:00:00.000Z' }] });
      await tratarCanal(req({ acao, comunicacaoId: COM }), deps);
      expect(chamadas.filter((c) => c.url.startsWith(OCTA)).every((c) => c.metodo === 'GET')).toBe(true);
      expect(chamadas.some((c) => /send-template|\/messages$/.test(c.url))).toBe(false);
    }
  });
});

describe('reconciliação server truth (/api/channel/octadesk acao=reconciliar)', () => {
  const saidaOcta = (chat: string, id: string, time: string, body?: string, tipo = 'agent') => ({ id, chatId: chat, time, type: 'public', status: 'sended', body, sentBy: { type: tipo } });
  it('o contrato aceita só deliveryId: sem ele é 400, e impressão pronta do navegador é recusada', () => {
    expect(validarPedidoCanal({ acao: 'reconciliar' })).toMatchObject({ erro: 'deliveryId_obrigatorio' });
    expect(validarPedidoCanal({ acao: 'reconciliar', deliveryId: ENTREGA, impressaoEsperada: 'x' })).toMatchObject({ erro: 'campos_nao_permitidos', campos: ['impressaoEsperada'] });
    expect(validarPedidoCanal({ acao: 'reconciliar', deliveryId: ENTREGA })).toMatchObject({ acao: 'reconciliar', deliveryId: ENTREGA });
  });
  it('entrega inexistente → 404; de outra organização → 403', async () => {
    expect((await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), ambiente({ entrega: null }).deps)).status).toBe(404);
    const outra = { id: ENTREGA, organization_id: '99999999-9999-9999-9999-999999999999', communication_id: COM, contact_id: CONTATO, provider: 'OCTADESK', channel: 'WHATSAPP', mode: 'FREEFORM', status: 'UNKNOWN', created_at: '2026-09-10T12:00:00.000Z' };
    expect((await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), ambiente({ entrega: outra }).deps)).status).toBe(403);
  });
  it('nova conversa com id desconhecido: duas conversas do contato, só uma com a mensagem → FOUND na certa', async () => {
    const chats = [{ id: 'chatA', status: 'closed', channel: 'whatsapp' }, { id: 'chatB', status: 'talking', channel: 'whatsapp' }];
    const mensagensPorChat = {
      chatA: [saidaOcta('chatA', 'm1', '2026-09-10T12:01:00.000Z', 'outro assunto')],
      chatB: [saidaOcta('chatB', 'm2', '2026-09-10T12:01:30.000Z', TEXTO)],
    };
    const r = await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), ambiente({ chats, mensagensPorChat }).deps);
    expect(r.status).toBe(200);
    const rec = r.corpo.reconciliacao as { resultado: string; conversaId: string; mensagemId: string };
    expect(rec.resultado).toBe('FOUND'); expect(rec.conversaId).toBe('chatB'); expect(rec.mensagemId).toBe('m2');
    // a impressão bate porque foi recalculada com o id daquela conversa
    expect(impressaoMensagem({ conversaId: 'chatB', texto: TEXTO })).not.toBe(impressaoMensagem({ conversaId: 'chatA', texto: TEXTO }));
  });
  it('duas conversas com a mesma mensagem → AMBIGUOUS e reenvio automático negado', async () => {
    const chats = [{ id: 'chatA', status: 'closed' }, { id: 'chatB', status: 'talking' }];
    const mensagensPorChat = { chatA: [saidaOcta('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO)], chatB: [saidaOcta('chatB', 'm2', '2026-09-10T12:02:00.000Z', TEXTO)] };
    const r = await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), ambiente({ chats, mensagensPorChat }).deps);
    expect((r.corpo.reconciliacao as { resultado: string }).resultado).toBe('AMBIGUOUS');
    expect((r.corpo.reenvioAutomatico as { permite: boolean }).permite).toBe(false);
  });
  it('nenhuma conversa com a mensagem → NOT_FOUND, e mesmo assim UNKNOWN não reenvia sozinho', async () => {
    const chats = [{ id: 'chatA', status: 'talking' }];
    const r = await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), ambiente({ chats, mensagensPorChat: { chatA: [] } }).deps);
    expect((r.corpo.reconciliacao as { resultado: string }).resultado).toBe('NOT_FOUND');
    expect((r.corpo.reenvioAutomatico as { permite: boolean; motivo: string }).permite).toBe(false);
  });
  it('a reconciliação não faz POST no provider e não devolve texto nem telefone', async () => {
    const chats = [{ id: 'chatA', status: 'talking' }];
    const { deps, chamadas } = ambiente({ chats, mensagensPorChat: { chatA: [saidaOcta('chatA', 'm1', '2026-09-10T12:01:00.000Z', TEXTO)] } });
    const r = await tratarCanal(req({ acao: 'reconciliar', deliveryId: ENTREGA }), deps);
    expect(chamadas.filter((c) => c.url.startsWith(OCTA)).every((c) => c.metodo === 'GET')).toBe(true);
    const corpo = JSON.stringify(r.corpo);
    expect(corpo).not.toContain(TEXTO);
    expect(corpo).not.toContain('5562999991234');
    expect(corpo).not.toContain('segredo-nunca-vaza');
  });
});

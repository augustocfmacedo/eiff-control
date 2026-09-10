// Channel Provider 01 no servidor: autenticacao, read-only e a garantia de que nenhum caminho chama POST de mensagem.
// Nenhuma chamada real ao Octadesk: tudo por fetch mockado.
import { describe, expect, it } from 'vitest';
import { normalizarConversas, normalizarMensagens, normalizarNumeros, normalizarTemplates, tratarCanal, validarPedidoCanal, type DepsCanal } from './canaisServidor';

const URL_SB = 'https://sb.test';
const OCTA = 'https://api.octadesk.test';
const COM = '11111111-1111-1111-1111-111111111111';
const CONTATO = '22222222-2222-2222-2222-222222222222';
const EMPRESA = '33333333-3333-3333-3333-333333333333';
const ORG = '44444444-4444-4444-4444-444444444444';

interface Cenario { perfil?: { role?: string; organization_id?: string } | null; autenticado?: boolean; comunicacao?: Record<string, unknown> | null; contato?: Record<string, unknown> | null; numeros?: unknown; templates?: unknown; chats?: unknown; authCheck?: unknown; erroOcta?: number }
function ambiente(c: Cenario = {}) {
  const chamadas: { url: string; metodo: string }[] = [];
  const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({ url: String(url), metodo });
    const u = String(url);
    if (u.startsWith(`${URL_SB}/auth/v1/user`)) return c.autenticado === false ? j({}, 401) : j({ id: 'u-1' });
    if (u.includes('/rest/v1/profile')) return j(c.perfil === null ? [] : [c.perfil ?? { name: 'Augusto', role: 'Administrador', organization_id: ORG }]);
    if (u.includes('/rest/v1/radar_communication')) return j(c.comunicacao === undefined ? [{ id: COM, company_id: EMPRESA, contact_id: CONTATO, channel: 'WHATSAPP', state: 'APPROVED', organization_id: ORG }] : c.comunicacao === null ? [] : [c.comunicacao]);
    if (u.includes('/rest/v1/radar_contact')) return j(c.contato === undefined ? [{ id: CONTATO, company_id: EMPRESA, phone: null, mobile_phone: null, whatsapp: '62999991234', phone_status: 'valido', status: 'ATIVO', organization_id: ORG }] : c.contato === null ? [] : [c.contato]);
    if (c.erroOcta && u.startsWith(OCTA)) return j({ message: 'nope' }, c.erroOcta);
    if (u.startsWith(`${OCTA}/auth/check`)) return j(c.authCheck ?? true);
    if (u.startsWith(`${OCTA}/chat/numbers`)) return j(c.numeros ?? [{ id: 'n1', name: 'Comercial', number: '556230000000' }]);
    if (u.startsWith(`${OCTA}/chat/templates-message`)) return j(c.templates ?? [{ id: 't1', name: 'primeiro_contato', status: 'approved', category: 'MARKETING', enable: true, components: [{ type: 'body', message: 'oi {{1}}', variables: [{ key: 'nome' }] }] }]);
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
  it('mensagens: received é entrada, internal é marcada', () => {
    const m = normalizarMensagens([{ id: 'm1', chatId: 'c1', time: 't', status: 'received', type: 'public' }, { id: 'm2', chatId: 'c1', time: 't', status: 'sended', type: 'internal' }]);
    expect(m[0].direcao).toBe('entrada'); expect(m[1].direcao).toBe('saida'); expect(m[1].interna).toBe(true);
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
  it('verificar: conversa aberta recente → SENDABLE_FREEFORM', async () => {
    const chats = [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-10T09:00:00.000Z' }];
    const r = await tratarCanal(req({ acao: 'verificar', comunicacaoId: COM }), ambiente({ chats }).deps);
    expect((r.corpo.entregabilidade as { resultado: string }).resultado).toBe('SENDABLE_FREEFORM');
    expect((r.corpo.conversa as { id: string }).id).toBe('chat-1');
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

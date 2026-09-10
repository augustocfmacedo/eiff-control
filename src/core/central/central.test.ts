// EIFF Central 01: provider Meta Cloud read-only, webhook assinado, contexto INTERNAL/EXTERNAL, identidade e contratos.
// Nenhuma chamada real a Graph API: fetch mockado. Nenhuma mensagem enviada.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaCloudProvider, normalizarNumeroMeta, normalizarTemplatesMeta, tratarWebhookMeta, verificarAssinaturaMeta, VARIAVEIS_META, type ConfigMeta, type DepsMeta } from './metaServidor';
import { contextoDoNumero, normalizarEventosMeta, verificarDesafioMeta } from './metaEventos';
import { AGENTE_POR_INTENCAO, CONFIANCA_MINIMA, INTENCOES_INTERNAS, PERMISSAO_POR_INTENCAO, decisaoSegura, resolverIdentidade, type WhatsappIdentity } from './tipos';
import { PROVIDERS } from '../radar/canais';
import { getState, pode } from '../../data/store';

const TOKEN = 'EAAsegredo-de-acesso-nunca-vaza-1234567890';
const APP_SECRET = 'app-secret-de-teste';
const INTERNO = 'pn-interno-1';
const EXTERNO = 'pn-externo-2';
const TELEFONE = '5562988887777';

function ambiente(extra: Partial<DepsMeta> = {}, cfg?: Partial<ConfigMeta>) {
  const chamadas: { url: string; metodo: string; auth?: string }[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({ url: String(url), metodo: init?.method ?? 'GET', auth: h.authorization });
    const u = String(url);
    if (/\/message_templates/.test(u)) return new Response(JSON.stringify({ data: [{ id: 't1', name: 'aviso_obra', status: 'APPROVED', category: 'UTILITY', language: 'pt_BR', components: [{ type: 'BODY', text: 'Olá {{1}}, obra {{2}}' }] }, { id: 't2', name: 'x', status: 'REJECTED', language: 'pt_BR', components: [] }] }), { status: 200 });
    return new Response(JSON.stringify({ id: INTERNO, display_phone_number: '+55 62 98888-7777', verified_name: 'EIFF Central', quality_rating: 'GREEN', code_verification_status: 'VERIFIED' }), { status: 200 });
  }) as unknown as typeof fetch;
  const meta: ConfigMeta = { accessToken: TOKEN, phoneNumberId: INTERNO, wabaId: 'waba-1', verifyToken: 'verifica-me', appSecret: APP_SECRET, ...cfg };
  const deps: DepsMeta = { fetch: fetchMock, meta, numeros: { interno: INTERNO, externo: EXTERNO }, agora: () => '2026-09-10T12:00:00.000Z', ...extra };
  return { deps, chamadas, posts: () => chamadas.filter((c) => c.metodo === 'POST') };
}
const assinar = async (corpo: string, segredo = APP_SECRET) => {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const a = await crypto.subtle.sign('HMAC', k, enc.encode(corpo));
  return `sha256=${[...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};
const payloadMensagem = (phoneNumberId = INTERNO) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5562988887777', phone_number_id: phoneNumberId }, contacts: [{ profile: { name: 'Fulano' }, wa_id: '5562999991234' }], messages: [{ id: 'wamid.1', from: '5562999991234', timestamp: '1789000000', type: 'text', text: { body: 'preciso pagar um frete' } }] } }] }],
});

describe('provider Meta Cloud (read-only)', () => {
  it('sem configuração → NOT_CONFIGURED, com as variáveis que faltam e sem nenhuma chamada', async () => {
    const { deps, chamadas } = ambiente();
    const p = metaCloudProvider(undefined, { ...deps, meta: undefined, faltando: [...VARIAVEIS_META] });
    const s = await p.healthCheck();
    expect(s.estado).toBe('NOT_CONFIGURED');
    expect(s.variaveisFaltando).toEqual([...VARIAVEIS_META]);
    expect(chamadas).toHaveLength(0);
  });
  it('configurado → CONNECTED, com o número mascarado e o token só no cabeçalho', async () => {
    const { deps, chamadas } = ambiente();
    const p = metaCloudProvider(deps.meta, deps);
    const s = await p.healthCheck();
    expect(s.estado).toBe('CONNECTED');
    expect(s.detalhe).not.toContain('98888'); // telefone mascarado
    expect(chamadas[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });
  it('templates: APPROVED vira approved e ativo; REJECTED não; variáveis saem do corpo', async () => {
    const { deps } = ambiente();
    const t = await metaCloudProvider(deps.meta, deps).listTemplates();
    expect(t[0]).toMatchObject({ id: 't1', nome: 'aviso_obra', status: 'approved', ativo: true, idioma: 'pt_BR', categoria: 'UTILITY' });
    expect(t[0].variaveis).toEqual(['1', '2']);
    expect(t[1]).toMatchObject({ status: 'rejected', ativo: false });
    expect(normalizarTemplatesMeta({ data: [{ id: 'x', status: 'PENDING' }] })[0].status).toBe('pending');
    expect(normalizarNumeroMeta({ id: 'p', display_phone_number: '+55 62 3000-0000' }).numero).toBe('556230000000');
  });
  it('erro da Graph API vira ERROR sem vazar o token na mensagem', async () => {
    const fetchMock = (async () => new Response(JSON.stringify({ error: { message: `token ${TOKEN} inválido` } }), { status: 401 })) as unknown as typeof fetch;
    const { deps } = ambiente();
    const s = await metaCloudProvider(deps.meta, { ...deps, fetch: fetchMock }).healthCheck();
    expect(s.estado).toBe('ERROR');
    expect(s.detalhe).not.toContain(TOKEN);
  });
});

describe('envio da Central: fail-closed', () => {
  const pedido = { comunicacaoId: 'c', contatoId: 'x', canal: 'WHATSAPP' as const, modo: 'TEMPLATE' as const, idempotencyKey: 'k', telefone: TELEFONE };
  it('modo disabled (padrão) → erro e nenhuma requisição', async () => {
    const { deps, chamadas } = ambiente();
    await expect(metaCloudProvider(deps.meta, deps).sendApproved(pedido)).rejects.toMatchObject({ codigo: 'envio_desligado' });
    expect(chamadas).toHaveLength(0);
  });
  it('canary fora da allowlist → erro e nenhuma requisição', async () => {
    const { deps, chamadas } = ambiente({ modoEnvio: 'canary', canaryNumeros: ['556230000000'] });
    await expect(metaCloudProvider(deps.meta, deps).sendApproved(pedido)).rejects.toMatchObject({ codigo: 'canary_destination_not_allowed' });
    expect(chamadas).toHaveLength(0);
  });
  it('mesmo autorizado, a Central ainda não envia nesta fase', async () => {
    const { deps, posts } = ambiente({ modoEnvio: 'canary', canaryNumeros: [TELEFONE] });
    await expect(metaCloudProvider(deps.meta, deps).sendApproved(pedido)).rejects.toMatchObject({ codigo: 'envio_bloqueado_piloto' });
    expect(posts()).toHaveLength(0);
  });
});

describe('webhook: verificação e assinatura', () => {
  it('GET com token certo devolve o challenge; token errado, modo errado ou sem token é recusado', async () => {
    const { deps } = ambiente();
    const ok = await tratarWebhookMeta({ metodo: 'GET', query: new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verifica-me', 'hub.challenge': '12345' }), corpoBruto: '' }, deps);
    expect(ok).toMatchObject({ status: 200, corpo: '12345', tipo: 'text/plain' });
    const errado = await tratarWebhookMeta({ metodo: 'GET', query: new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'outro', 'hub.challenge': '1' }), corpoBruto: '' }, deps);
    expect(errado.status).toBe(403);
    expect(verificarDesafioMeta(new URLSearchParams({ 'hub.mode': 'unsubscribe' }), 'verifica-me').ok).toBe(false);
    expect(verificarDesafioMeta(new URLSearchParams(), undefined).motivo).toMatch(/VERIFY_TOKEN/);
  });
  it('POST sem assinatura, com assinatura errada ou com outro segredo → 401 e nada processado', async () => {
    const { deps } = ambiente();
    const corpo = payloadMensagem();
    const sem = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo }, deps);
    expect(sem.status).toBe(401); expect(sem.eventos).toBeUndefined();
    const errada = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo, assinatura: `sha256=${'0'.repeat(64)}` }, deps);
    expect(errada.status).toBe(401);
    const outro = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo, assinatura: await assinar(corpo, 'segredo-errado') }, deps);
    expect(outro.status).toBe(401);
    // corpo adulterado depois de assinado também cai
    const adulterado = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo.replace('frete', 'guindaste'), corpoAdulterado: true, assinatura: await assinar(corpo) } as never, deps);
    expect(adulterado.status).toBe(401);
  });
  it('assinatura válida → eventos normalizados', async () => {
    const { deps } = ambiente();
    const corpo = payloadMensagem();
    const r = await tratarWebhookMeta({ metodo: 'POST', query: new URLSearchParams(), corpoBruto: corpo, assinatura: await assinar(corpo) }, deps);
    expect(r.status).toBe(200);
    expect(r.eventos).toHaveLength(1);
    expect(r.eventos![0]).toMatchObject({ provider: 'META_CLOUD', eventType: 'MESSAGE_RECEIVED', direction: 'inbound', contactPhone: '5562999991234', messageType: 'text', contexto: 'INTERNAL' });
  });
  it('verificarAssinaturaMeta recusa formato estranho e falta de segredo', async () => {
    expect(await verificarAssinaturaMeta('x', 'sha1=abc', APP_SECRET)).toBe(false);
    expect(await verificarAssinaturaMeta('x', 'abc', APP_SECRET)).toBe(false);
    expect(await verificarAssinaturaMeta('x', await assinar('x'), undefined)).toBe(false);
    expect(await verificarAssinaturaMeta('x', null, APP_SECRET)).toBe(false);
    expect(await verificarAssinaturaMeta('x', await assinar('x'), APP_SECRET)).toBe(true);
  });
});

describe('normalização de eventos e contexto', () => {
  it('contexto vem do número que recebeu, nunca do texto', () => {
    expect(contextoDoNumero(INTERNO, { interno: INTERNO, externo: EXTERNO })).toBe('INTERNAL');
    expect(contextoDoNumero(EXTERNO, { interno: INTERNO, externo: EXTERNO })).toBe('EXTERNAL');
    expect(contextoDoNumero('outro', { interno: INTERNO, externo: EXTERNO })).toBeUndefined();
    expect(contextoDoNumero(undefined, {})).toBeUndefined();
    // o mesmo texto muda de contexto só porque o número de entrada mudou
    const texto = 'preciso pagar um frete';
    const interno = normalizarEventosMeta(JSON.parse(payloadMensagem(INTERNO)), { numeros: { interno: INTERNO, externo: EXTERNO } });
    const externo = normalizarEventosMeta(JSON.parse(payloadMensagem(EXTERNO)), { numeros: { interno: INTERNO, externo: EXTERNO } });
    expect(texto).toBeTruthy();
    expect(interno[0].contexto).toBe('INTERNAL');
    expect(externo[0].contexto).toBe('EXTERNAL');
  });
  it('statuses viram MESSAGE_SENT/DELIVERED/READ/FAILED; status desconhecido é ignorado', () => {
    const status = (s: string, extra: Record<string, unknown> = {}) => ({
      object: 'whatsapp_business_account',
      entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: INTERNO }, statuses: [{ id: 'wamid.9', status: s, timestamp: '1789000000', recipient_id: '5562999991234', conversation: { id: 'conv-1' }, ...extra }] } }] }],
    });
    const tipo = (s: string, extra?: Record<string, unknown>) => normalizarEventosMeta(status(s, extra), { numeros: { interno: INTERNO } })[0]?.eventType;
    expect(tipo('sent')).toBe('MESSAGE_SENT');
    expect(tipo('delivered')).toBe('MESSAGE_DELIVERED');
    expect(tipo('read')).toBe('MESSAGE_READ');
    expect(tipo('failed')).toBe('MESSAGE_FAILED');
    expect(tipo('inventado')).toBeUndefined();
    const falha = normalizarEventosMeta(status('failed', { errors: [{ code: 131047, title: 'Re-engagement message' }] }), { numeros: { interno: INTERNO } })[0];
    expect(falha).toMatchObject({ direction: 'outbound', externalConversationId: 'conv-1', erroCodigo: '131047', contactPhone: '5562999991234' });
  });
  it('payload de outro object ou outro field é ignorado, sem erro', () => {
    expect(normalizarEventosMeta({ object: 'page', entry: [] })).toEqual([]);
    expect(normalizarEventosMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] })).toEqual([]);
    expect(normalizarEventosMeta(null)).toEqual([]);
    expect(normalizarEventosMeta({ object: 'whatsapp_business_account' })).toEqual([]);
  });
});

describe('identidade interna', () => {
  const base: WhatsappIdentity = { id: 'i1', organizationId: 'org', usuarioId: 'u-augusto', telefoneNormalizado: TELEFONE, contexto: 'INTERNAL', situacao: 'VERIFIED', criadoEm: '2026-09-01' };
  it('só identidade VERIFIED do mesmo contexto é confiável', () => {
    expect(resolverIdentidade(TELEFONE, [base], 'INTERNAL')).toMatchObject({ conhecida: true, verificada: true });
    expect(resolverIdentidade(TELEFONE, [base], 'EXTERNAL').conhecida).toBe(false); // contexto diferente não vale
    expect(resolverIdentidade(TELEFONE, [{ ...base, situacao: 'PENDING' }], 'INTERNAL')).toMatchObject({ conhecida: true, verificada: false });
    expect(resolverIdentidade(TELEFONE, [{ ...base, situacao: 'REVOKED' }], 'INTERNAL')).toMatchObject({ conhecida: true, verificada: false });
    expect(resolverIdentidade('5562911112222', [base], 'INTERNAL')).toMatchObject({ conhecida: false, verificada: false });
    expect(resolverIdentidade(undefined, [base], 'INTERNAL').verificada).toBe(false);
  });
  it('identidade desconhecida ou não verificada nunca libera ação sensível', () => {
    for (const id of [resolverIdentidade(undefined, [], 'INTERNAL'), resolverIdentidade('5562911112222', [base], 'INTERNAL'), resolverIdentidade(TELEFONE, [{ ...base, situacao: 'PENDING' }], 'INTERNAL')]) {
      const d = decisaoSegura({ intent: 'FINANCE', confidence: 0.99, motivo: 'pedido de pagamento' }, id);
      expect(d.requiresHuman).toBe(true);
      expect(d.requiresConfirmation).toBe(true);
    }
  });
});

describe('contratos do orquestrador e dos agentes', () => {
  it('toda intenção tem agente e permissão, e a permissão existe na matriz do EIFF Control', () => {
    const usuario = getState().usuario;
    for (const i of INTENCOES_INTERNAS) {
      expect(AGENTE_POR_INTENCAO[i]).toBeTruthy();
      const permissao = PERMISSAO_POR_INTENCAO[i];
      expect(permissao).toBeTruthy();
      // pode() estoura se a ação não existir na MATRIZ: isto prende o reuso da ACL única
      expect(() => pode(usuario, permissao as never)).not.toThrow();
    }
  });
  it('a decisão sempre exige confirmação e cai para humano com confiança baixa', () => {
    const verificada = { conhecida: true, verificada: true, motivo: 'ok' };
    const alta = decisaoSegura({ intent: 'PURCHASE', confidence: 0.95, motivo: 'compra' }, verificada);
    expect(alta).toMatchObject({ targetAgent: 'PURCHASE_AGENT', requiresHuman: false, requiresConfirmation: true, requiredPermission: 'comprar' });
    const baixa = decisaoSegura({ intent: 'PURCHASE', confidence: CONFIANCA_MINIMA - 0.01, motivo: 'compra' }, verificada);
    expect(baixa.requiresHuman).toBe(true);
  });
  it('o contrato não executa nada: decisaoSegura é pura e devolve só a decisão', () => {
    const d = decisaoSegura({ intent: 'FINANCE', confidence: 0.9, motivo: 'x' }, { conhecida: true, verificada: true, motivo: 'ok' });
    expect(Object.keys(d).sort()).toEqual(['confidence', 'intent', 'motivo', 'requiredPermission', 'requiresConfirmation', 'requiresHuman', 'targetAgent']);
    expect(typeof (d as unknown as Record<string, unknown>).execute).toBe('undefined');
  });
});

describe('fronteiras de código', () => {
  it('META_CLOUD entra na abstração sem remover OCTADESK', () => {
    expect(PROVIDERS).toContain('MANUAL'); expect(PROVIDERS).toContain('OCTADESK'); expect(PROVIDERS).toContain('META_CLOUD');
  });
  it('o core puro não conhece a Graph API: só o módulo server-side fala com graph.facebook.com', () => {
    const arquivos = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const fontes = arquivos('src').filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
    const comGraph = fontes.filter((f) => /graph\.facebook\.com/.test(fs.readFileSync(f, 'utf8')));
    expect(comGraph).toEqual(['src/core/central/metaServidor.ts']);
    // os módulos puros não importam o servidor
    for (const f of ['src/core/central/tipos.ts', 'src/core/central/metaEventos.ts']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/metaServidor|graph\.facebook/);
    }
  });
  it('nenhuma tela do navegador lê variáveis META_WHATSAPP_*', () => {
    const arquivos = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    for (const f of arquivos('src/screens').concat(arquivos('src/ui'))) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/META_WHATSAPP|VITE_META/);
    }
  });
});

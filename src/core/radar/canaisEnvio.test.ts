// Send Canary 01: caminho real de envio, protegido por modo e allowlist. Nenhuma chamada real ao Octadesk (fetch mockado).
// Cada teste confere tambem se houve (ou nao) POST no provider: a garantia mais importante desta fase.
import { describe, expect, it } from 'vitest';
import { autorizarDestino, interpretarRespostaEnvio, lerModoEnvio, lerNumerosCanary, permitePostar, validarCoerenciaCanal, type ModoEnvio } from './canais';
import { octadeskProvider, tratarCanal, type DepsCanal } from './canaisServidor';

const URL_SB = 'https://sb.test';
const OCTA = 'https://api.octadesk.test';
const COM = '11111111-1111-1111-1111-111111111111';
const CONTATO = '22222222-2222-2222-2222-222222222222';
const EMPRESA = '33333333-3333-3333-3333-333333333333';
const ORG = '44444444-4444-4444-4444-444444444444';
const AUTORIZADO = '5562988887777'; // numero ficticio do canario (nunca um numero real neste arquivo)
const TEXTO = 'Bom dia, queria entender a frente de expansão.';

interface Cenario {
  modoEnvio?: ModoEnvio; allowlist?: string[]; semService?: boolean;
  canal?: string; estado?: string; suprimido?: boolean; whatsapp?: string | null;
  chats?: unknown[]; mensagens?: unknown[]; templates?: unknown[]; numeros?: unknown[];
  respostaEnvio?: { status: number; corpo?: unknown }; falhaEnvio?: 'timeout' | 'rede';
  criarFalha?: string; transicaoFalha?: string; statusInicial?: string; jaExiste?: boolean;
}
function ambiente(c: Cenario = {}) {
  const chamadas: { url: string; metodo: string }[] = [];
  const entregas = new Map<string, { status: string }>();
  const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET'; const u = String(url);
    chamadas.push({ url: u, metodo });
    if (u.startsWith(`${URL_SB}/auth/v1/user`)) return j({ id: 'u-1' });
    if (u.includes('/rest/v1/profile')) return j([{ name: 'Augusto', role: 'Administrador', organization_id: ORG }]);
    if (u.includes('/rest/v1/rpc/radar_delivery_create')) {
      if (c.criarFalha) return j({ ok: false, erro: c.criarFalha });
      const id = '55555555-5555-5555-5555-555555555555';
      const existia = c.jaExiste === true || entregas.has(id);
      if (!entregas.has(id)) entregas.set(id, { status: c.statusInicial ?? 'READY' });
      return j({ ok: true, existente: existia, delivery_id: id, status: entregas.get(id)!.status });
    }
    if (u.includes('/rest/v1/rpc/radar_delivery_transition')) {
      const b = JSON.parse(String(init?.body ?? '{}')) as { p_delivery_id: string; p_to_status: string };
      if (c.transicaoFalha) return j({ ok: false, erro: c.transicaoFalha });
      entregas.set(b.p_delivery_id, { status: b.p_to_status });
      return j({ ok: true, status: b.p_to_status });
    }
    if (u.includes('/rest/v1/radar_communication?')) return j([{ id: COM, organization_id: ORG, company_id: EMPRESA, contact_id: CONTATO, channel: c.canal ?? 'WHATSAPP', state: c.estado ?? 'APPROVED', generated_content: { versaoPrincipal: TEXTO }, edited_content: null }]);
    if (u.includes('/rest/v1/radar_contact')) return j([{ id: CONTATO, organization_id: ORG, full_name: 'Fulano Fictício', email: 'f@x.test', phone: null, mobile_phone: null, whatsapp: c.whatsapp === undefined ? AUTORIZADO : c.whatsapp, phone_status: 'valido', status: 'ATIVO', active: true }]);
    if (u.includes('/rest/v1/radar_suppression')) return j(c.suprimido ? [{ id: 's1' }] : []);
    if (u.startsWith(`${OCTA}/auth/check`)) return j(true);
    if (u.startsWith(`${OCTA}/chat/numbers`)) return j(c.numeros ?? [{ id: 'n1', name: 'Comercial', number: '556230000000' }]);
    if (u.startsWith(`${OCTA}/chat/templates-message`)) return j(c.templates ?? [{ id: 't1', name: 'canary_teste', status: 'approved', enable: true, components: [] }]);
    if (/\/chat\/[^/]+\/messages/.test(u) && metodo === 'POST') {
      if (c.falhaEnvio) { const e = new Error('falhou'); e.name = c.falhaEnvio === 'timeout' ? 'AbortError' : 'TypeError'; throw e; }
      return j(c.respostaEnvio?.corpo ?? { id: 'msg-1', chatId: 'chat-1', status: 'sended' }, c.respostaEnvio?.status ?? 201);
    }
    if (u.startsWith(`${OCTA}/chat/send-template`) && metodo === 'POST') {
      if (c.falhaEnvio) { const e = new Error('falhou'); e.name = c.falhaEnvio === 'timeout' ? 'AbortError' : 'TypeError'; throw e; }
      return j(c.respostaEnvio?.corpo ?? { result: { messageKey: 'mk-1', roomKey: 'rk-1' } }, c.respostaEnvio?.status ?? 201);
    }
    if (/\/chat\/[^/]+\/messages/.test(u)) return j(c.mensagens ?? []);
    if (u.startsWith(`${OCTA}/chat`)) return j(c.chats ?? []);
    return j({}, 404);
  }) as unknown as typeof fetch;
  const deps: DepsCanal = {
    fetch: fetchMock, supabaseUrl: URL_SB, anon: 'anon',
    octadesk: { baseUrl: OCTA, apiKey: 'segredo-nunca-vaza', agentEmail: 'a@b.c' },
    modoEnvio: c.modoEnvio ?? 'canary', canaryNumeros: c.allowlist ?? [AUTORIZADO],
    serviceKey: c.semService ? undefined : 'service-role-fake',
    agora: () => '2026-09-10T12:00:00.000Z',
  };
  const postsProvider = () => chamadas.filter((x) => x.url.startsWith(OCTA) && x.metodo === 'POST');
  return { deps, chamadas, postsProvider, entregas };
}
const enviar = (extra: Record<string, unknown> = {}) => ({ method: 'POST', authorization: 'Bearer jwt', body: { acao: 'enviar_canary', comunicacaoId: COM, ...extra } });
// conversa aberta COM mensagem do contato dentro de 24 h (janela comprovada) → caminho FREEFORM
const freeform = { chats: [{ id: 'chat-1', status: 'talking', channel: 'whatsapp', lastMessageDate: '2026-09-10T09:00:00.000Z' }], mensagens: [{ id: 'm1', chatId: 'chat-1', time: '2026-09-10T09:00:00.000Z', type: 'public', body: 'oi', sentBy: { type: 'contact' } }] };

describe('modo de envio e allowlist (só no servidor)', () => {
  it('o padrão é disabled e valores estranhos caem para disabled', () => {
    expect(lerModoEnvio(undefined)).toBe('disabled');
    expect(lerModoEnvio('pilot ')).toBe('pilot');
    expect(lerModoEnvio('qualquer')).toBe('disabled');
  });
  it('a allowlist normaliza para E.164 e ignora lixo', () => {
    expect(lerNumerosCanary('(62) 98888-7777; +55 62 3000-0000')).toEqual(['5562988887777', '556230000000']);
    expect(lerNumerosCanary(undefined)).toEqual([]);
  });
  it('autorizarDestino: disabled bloqueia tudo, pilot ainda não libera nada, canary só a lista', () => {
    expect(autorizarDestino(AUTORIZADO, 'disabled', [AUTORIZADO]).codigo).toBe('envio_desligado');
    expect(autorizarDestino(AUTORIZADO, 'pilot', [AUTORIZADO]).codigo).toBe('modo_pilot_nao_liberado');
    expect(autorizarDestino('5562999990000', 'canary', [AUTORIZADO]).codigo).toBe('canary_destination_not_allowed');
    expect(autorizarDestino(AUTORIZADO, 'canary', [AUTORIZADO]).permitido).toBe(true);
    expect(autorizarDestino(undefined, 'canary', [AUTORIZADO]).codigo).toBe('sem_telefone');
  });
  it('coerência de canal: e-mail nunca vira envio Octadesk', () => {
    expect(validarCoerenciaCanal({ canalComunicacao: 'EMAIL', canalEntrega: 'EMAIL', provider: 'OCTADESK' }).ok).toBe(false);
    expect(validarCoerenciaCanal({ canalComunicacao: 'WHATSAPP', canalEntrega: 'EMAIL', provider: 'OCTADESK' }).ok).toBe(false);
    expect(validarCoerenciaCanal({ canalComunicacao: 'WHATSAPP', canalEntrega: 'WHATSAPP', provider: 'OCTADESK' }).ok).toBe(true);
  });
  it('entrega já em andamento não permite novo POST', () => {
    expect(permitePostar('READY')).toBe(true); expect(permitePostar('REQUESTED')).toBe(true);
    for (const s of ['ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN'] as const) expect(permitePostar(s)).toBe(false);
  });
});

describe('guardas antes do POST', () => {
  it('modo disabled → 403 e nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ modoEnvio: 'disabled', ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(403); expect(r.corpo.erro).toBe('envio_desligado');
    expect(postsProvider()).toHaveLength(0);
  });
  it('destino fora da allowlist → 403 canary_destination_not_allowed e nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ allowlist: ['556230000000'], ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(403); expect(r.corpo.erro).toBe('canary_destination_not_allowed');
    expect(postsProvider()).toHaveLength(0);
  });
  it('a allowlist nunca aparece na resposta', async () => {
    const { deps } = ambiente(freeform);
    const r = await tratarCanal({ method: 'POST', authorization: 'Bearer jwt', body: { acao: 'preparar_envio', comunicacaoId: COM } }, deps);
    const corpo = JSON.stringify(r.corpo);
    expect(corpo).not.toContain(AUTORIZADO);
    expect((r.corpo.envio as { destinoAutorizado: boolean }).destinoAutorizado).toBe(true);
  });
  it('comunicação de EMAIL → bloqueada e nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ canal: 'EMAIL', ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(409); expect(r.corpo.erro).toBe('canal_incoerente');
    expect(postsProvider()).toHaveLength(0);
  });
  it('comunicação não aprovada → bloqueada e nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ estado: 'READY_FOR_REVIEW', ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(409); expect(r.corpo.erro).toBe('comunicacao_nao_aprovada');
    expect(postsProvider()).toHaveLength(0);
  });
  it('contato suprimido ou sem WhatsApp → bloqueado e nenhum POST', async () => {
    const sup = ambiente({ suprimido: true, ...freeform });
    const r1 = await tratarCanal(enviar(), sup.deps);
    expect(r1.status).toBe(409); expect(r1.corpo.erro).toBe('nao_entregavel');
    expect(sup.postsProvider()).toHaveLength(0);
    const semFone = ambiente({ whatsapp: null, ...freeform });
    const r2 = await tratarCanal(enviar(), semFone.deps);
    expect(r2.status).toBe(403); expect(r2.corpo.erro).toBe('sem_telefone'); // nem chega à entregabilidade
    expect(semFone.postsProvider()).toHaveLength(0);
  });
  it('freeform sem mensagem do contato comprovada → bloqueado e nenhum POST', async () => {
    // conversa aberta, mas a última mensagem é nossa: cai para TEMPLATE; sem template aprovado, bloqueia
    const { deps, postsProvider } = ambiente({
      chats: [{ id: 'chat-1', status: 'talking', lastMessageDate: '2026-09-10T11:00:00.000Z' }],
      mensagens: [{ id: 'm1', chatId: 'chat-1', time: '2026-09-10T11:00:00.000Z', type: 'public', body: 'oi', sentBy: { type: 'agent' } }],
      templates: [],
    });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(409); expect(r.corpo.resultado).toBe('NO_APPROVED_TEMPLATE');
    expect(postsProvider()).toHaveLength(0);
  });
  it('template pendente, ou com variáveis sem mapeamento → bloqueado e nenhum POST', async () => {
    const pendente = ambiente({ templates: [{ id: 't1', name: 'x', status: 'pending', enable: true }] });
    const r1 = await tratarCanal(enviar(), pendente.deps);
    expect(r1.status).toBe(409); expect(r1.corpo.resultado).toBe('NO_APPROVED_TEMPLATE');
    expect(pendente.postsProvider()).toHaveLength(0);
    const comVar = ambiente({ templates: [{ id: 't1', name: 'x', status: 'approved', enable: true, components: [{ variables: [{ key: 'nome' }] }] }] });
    const r2 = await tratarCanal(enviar(), comVar.deps);
    expect(r2.status).toBe(409); expect(r2.corpo.erro).toBe('template_sem_mapeamento');
    expect(comVar.postsProvider()).toHaveLength(0);
  });
  it('template escolhido que não está entre os aprovados atuais → bloqueado', async () => {
    const { deps, postsProvider } = ambiente();
    const r = await tratarCanal(enviar({ templateId: 't-inventado' }), deps);
    expect(r.status).toBe(409); expect(r.corpo.erro).toBe('template_invalido');
    expect(postsProvider()).toHaveLength(0);
  });
});

describe('delivery first: sem entrega, sem POST', () => {
  it('falha ao criar a entrega → nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ criarFalha: 'comunicacao_nao_aprovada', ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(500); expect(r.corpo.erro).toBe('entrega_nao_criada');
    expect(postsProvider()).toHaveLength(0);
  });
  it('READY que não vira REQUESTED → nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ transicaoFalha: 'transicao_invalida', ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(500); expect(r.corpo.erro).toBe('entrega_nao_solicitada');
    expect(postsProvider()).toHaveLength(0);
  });
  it('sem service_role configurado → nenhuma entrega e nenhum POST', async () => {
    const { deps, postsProvider } = ambiente({ semService: true, ...freeform });
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(500); expect(r.corpo.erro).toBe('entrega_nao_criada');
    expect(postsProvider()).toHaveLength(0);
  });
  it('entrega já processada (duplo clique) → nenhum segundo POST', async () => {
    for (const status of ['REQUESTED', 'ACCEPTED', 'UNKNOWN']) {
      const { deps, postsProvider } = ambiente({ jaExiste: true, statusInicial: status, ...freeform });
      const r = await tratarCanal(enviar(), deps);
      expect(r.status).toBe(200);
      expect((r.corpo.entrega as { jaProcessada?: boolean; status: string }).jaProcessada, status).toBe(true);
      expect(postsProvider(), status).toHaveLength(0);
    }
  });
});

describe('envio autorizado e classificação do retorno', () => {
  it('freeform autorizado → um POST na conversa e entrega ACCEPTED com os ids do provider', async () => {
    const { deps, postsProvider, entregas } = ambiente(freeform);
    const r = await tratarCanal(enviar(), deps);
    expect(r.status).toBe(200);
    const posts = postsProvider();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/chat/chat-1/messages');
    const e = r.corpo.entrega as { status: string; mensagemProviderId: string; conversaProviderId: string };
    expect(e.status).toBe('ACCEPTED'); expect(e.mensagemProviderId).toBe('msg-1'); expect(e.conversaProviderId).toBe('chat-1');
    expect([...entregas.values()][0].status).toBe('ACCEPTED');
    expect(r.corpo.comunicacaoMarcadaComoEnviada).toBe(false); // SENT fica para o Send Pilot 02
  });
  it('template autorizado → um POST em send-template e ACCEPTED', async () => {
    const { deps, postsProvider } = ambiente(); // sem conversa aberta → TEMPLATE
    const r = await tratarCanal(enviar(), deps);
    const posts = postsProvider();
    expect(posts).toHaveLength(1); expect(posts[0].url).toContain('/chat/send-template');
    const e = r.corpo.entrega as { status: string; mensagemProviderId: string; conversaProviderId: string; modo: string };
    expect(e.modo).toBe('TEMPLATE'); expect(e.status).toBe('ACCEPTED'); expect(e.mensagemProviderId).toBe('mk-1'); expect(e.conversaProviderId).toBe('rk-1');
  });
  it('rejeição explícita do provider → FAILED', async () => {
    const { deps, postsProvider } = ambiente({ ...freeform, respostaEnvio: { status: 400, corpo: { errorCode: 'INVALID_NUMBER', errorMessage: 'número inválido' } } });
    const r = await tratarCanal(enviar(), deps);
    const e = r.corpo.entrega as { status: string; erroCodigo: string };
    expect(e.status).toBe('FAILED'); expect(e.erroCodigo).toBe('INVALID_NUMBER');
    expect(postsProvider()).toHaveLength(1);
    expect(r.corpo.proximoPasso).toBe('revisar');
  });
  it('timeout, rede, 5xx e 2xx sem identificadores → UNKNOWN, com próximo passo reconciliar', async () => {
    for (const cen of [{ falhaEnvio: 'timeout' as const }, { falhaEnvio: 'rede' as const }, { respostaEnvio: { status: 502 } }, { respostaEnvio: { status: 201, corpo: {} } }]) {
      const { deps, postsProvider } = ambiente({ ...freeform, ...cen });
      const r = await tratarCanal(enviar(), deps);
      expect((r.corpo.entrega as { status: string }).status, JSON.stringify(cen)).toBe('UNKNOWN');
      expect(r.corpo.proximoPasso).toBe('reconciliar');
      expect(postsProvider()).toHaveLength(1); // um POST, nunca dois
    }
  });
  it('UNKNOWN não gera retry automático: o handler não tenta de novo', async () => {
    const { deps, postsProvider } = ambiente({ ...freeform, falhaEnvio: 'timeout' });
    await tratarCanal(enviar(), deps);
    expect(postsProvider()).toHaveLength(1);
  });
  it('a resposta não devolve telefone, texto nem a chave da API', async () => {
    const { deps } = ambiente(freeform);
    const r = await tratarCanal(enviar(), deps);
    const corpo = JSON.stringify(r.corpo);
    expect(corpo).not.toContain(AUTORIZADO); expect(corpo).not.toContain(TEXTO); expect(corpo).not.toContain('segredo-nunca-vaza');
  });
});

describe('leitura da resposta do provider', () => {
  it('ids presentes → ACCEPTED; errorCode → FAILED; ambíguo → UNKNOWN', () => {
    expect(interpretarRespostaEnvio({ httpStatus: 201, corpo: { result: { messageKey: 'm', roomKey: 'r' } } })).toMatchObject({ status: 'ACCEPTED', mensagemId: 'm', conversaId: 'r' });
    expect(interpretarRespostaEnvio({ httpStatus: 201, corpo: { id: 'm1', chatId: 'c1' } })).toMatchObject({ status: 'ACCEPTED', mensagemId: 'm1', conversaId: 'c1' });
    expect(interpretarRespostaEnvio({ httpStatus: 200, corpo: { errorCode: 'X' } }).status).toBe('FAILED');
    expect(interpretarRespostaEnvio({ httpStatus: 400, corpo: { errorCode: 'X' } }).status).toBe('FAILED');
    expect(interpretarRespostaEnvio({ httpStatus: 400, corpo: {} }).status).toBe('UNKNOWN');
    expect(interpretarRespostaEnvio({ httpStatus: 500 }).status).toBe('UNKNOWN');
    expect(interpretarRespostaEnvio({ timeout: true }).status).toBe('UNKNOWN');
    expect(interpretarRespostaEnvio({ httpStatus: 201, corpo: {} }).status).toBe('UNKNOWN');
  });
});


describe('fronteira do efeito externo: sendApproved é fail-closed', () => {
  /** Provider isolado, sem handler: prova que a guarda vive no próprio ponto que dispara o POST. */
  function providerDireto(modoEnvio: ModoEnvio, allowlist: string[] = [AUTORIZADO]) {
    const chamadas: { url: string; metodo: string }[] = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url: String(url), metodo: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ id: 'msg-1', chatId: 'chat-1', status: 'sended' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const deps: DepsCanal = { fetch: fetchMock, supabaseUrl: URL_SB, anon: 'anon', octadesk: { baseUrl: OCTA, apiKey: 'segredo-nunca-vaza' }, modoEnvio, canaryNumeros: allowlist };
    return { provider: octadeskProvider(deps.octadesk, deps), posts: () => chamadas.filter((x) => x.metodo === 'POST'), chamadas };
  }
  const pedido = (telefone = AUTORIZADO) => ({ comunicacaoId: COM, contatoId: CONTATO, canal: 'WHATSAPP' as const, modo: 'FREEFORM' as const, idempotencyKey: 'k', telefone, conversaId: 'chat-1', texto: 'oi' });

  it('modo disabled → erro e nenhuma requisição, mesmo chamando o provider direto', async () => {
    const { provider, chamadas } = providerDireto('disabled');
    await expect(provider.sendApproved(pedido())).rejects.toMatchObject({ codigo: 'envio_desligado' });
    expect(chamadas).toHaveLength(0);
  });
  it('modo pilot → erro e nenhuma requisição (pilot não libera destino nesta fase)', async () => {
    const { provider, chamadas } = providerDireto('pilot');
    await expect(provider.sendApproved(pedido())).rejects.toMatchObject({ codigo: 'modo_pilot_nao_liberado' });
    expect(chamadas).toHaveLength(0);
  });
  it('canary com destino fora da allowlist → erro e nenhuma requisição', async () => {
    const { provider, chamadas } = providerDireto('canary', ['556230000000']);
    await expect(provider.sendApproved(pedido())).rejects.toMatchObject({ codigo: 'canary_destination_not_allowed' });
    expect(chamadas).toHaveLength(0);
  });
  it('sem telefone → erro e nenhuma requisição', async () => {
    const { provider, chamadas } = providerDireto('canary');
    await expect(provider.sendApproved(pedido(''))).rejects.toMatchObject({ codigo: 'sem_telefone' });
    expect(chamadas).toHaveLength(0);
  });
  it('canary com destino autorizado → exatamente um POST', async () => {
    const { provider, posts } = providerDireto('canary');
    const r = await provider.sendApproved(pedido());
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toContain('/chat/chat-1/messages');
    expect(r.aceito).toBe(true); expect(r.mensagemId).toBe('msg-1');
  });
  it('a allowlist do provider é independente do handler: allowlist vazia bloqueia tudo', async () => {
    const { provider, chamadas } = providerDireto('canary', []);
    await expect(provider.sendApproved(pedido())).rejects.toMatchObject({ codigo: 'canary_destination_not_allowed' });
    expect(chamadas).toHaveLength(0);
  });
});

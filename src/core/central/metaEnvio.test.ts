// EIFF Central — caminho de envio da Meta WhatsApp Cloud API: montagem, guardas, delivery first e classificacao.
// INVARIANTE DESTA ONDA: nada e enviado. Todo cenario confere que o fetch mockado NAO recebeu POST em /messages,
// e nenhuma chamada real a Graph API acontece (o transporte de producao e o TRANSPORTE_BLOQUEADO).
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITE_TEXTO_META, TRANSPORTE_BLOQUEADO, canonizarRespostaMeta, contextoDoPedidoMeta, executarEnvioMeta,
  interpretarRespostaMetaEnvio, mensagensDeEventosMeta, montarRequisicaoMeta, prepararEnvioMeta, provaJanelaMeta,
  resolverVariaveisTemplateMeta, sanitizarVariavelMeta, validarCoerenciaCanalMeta,
  type ContextoEnvioMeta, type PortasEntregaMeta, type RequisicaoEnvioMeta, type RespostaEnvioBruta,
  type TransporteEnvioMeta,
} from './metaEnvio';
import { metaCloudProvider, type ConfigMeta, type DepsMeta } from './metaServidor';
import { normalizarEventosMeta } from './metaEventos';
import { TRANSICOES_ENTREGA, type ChannelInboundEvent, type EstadoEntrega, type TemplateCanal } from '../radar/canais';

const PHONE_ID = 'pn-central-1';
const AUTORIZADO = '5562988887777'; // numero ficticio do canario (nunca um numero real neste arquivo)
const OUTRO = '5562911112222';
const COM = 'c-1';
const CONTATO = 'ct-1';
const AGORA = '2026-09-10T12:00:00.000Z';
const TEXTO = 'Bom dia, queria entender a frente de expansão.';

const TEMPLATE: TemplateCanal = { id: 't1', nome: 'aviso_obra', status: 'approved', ativo: true, idioma: 'pt_BR', categoria: 'UTILITY', variaveis: [] };
const janelaViva = { janelaComprovada: true, ultimaMensagemInboundEm: '2026-09-10T10:00:00.000Z', janelaLivreAte: '2026-09-11T10:00:00.000Z', motivo: 'prova' };

function ctx(extra: Partial<ContextoEnvioMeta> = {}): ContextoEnvioMeta {
  return {
    comunicacaoId: COM, contatoId: CONTATO, canalComunicacao: 'WHATSAPP', phoneNumberId: PHONE_ID,
    telefone: AUTORIZADO, modo: 'FREEFORM', texto: TEXTO, janela: janelaViva,
    modoEnvio: 'canary', allowlist: [AUTORIZADO], ...extra,
  };
}

// ---------------------------------------------------------------------------
// fetch global mockado: nenhum cenario pode disparar POST em /messages
// ---------------------------------------------------------------------------
let chamadas: { url: string; metodo: string }[] = [];
const fetchMock = ((url: string, init?: RequestInit) => {
  chamadas.push({ url: String(url), metodo: init?.method ?? 'GET' });
  return Promise.resolve(new Response(JSON.stringify({ id: PHONE_ID, display_phone_number: '+55 62 98888-7777', verified_name: 'EIFF Central' }), { status: 200 }));
}) as unknown as typeof fetch;
const postsDeMensagem = () => chamadas.filter((c) => c.metodo === 'POST' && /\/messages/.test(c.url));

beforeEach(() => { chamadas = []; vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { expect(postsDeMensagem()).toHaveLength(0); vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// portas do ledger (RPCs), gravando a ordem exata das chamadas
// ---------------------------------------------------------------------------
interface Registro { passo: string; detalhe?: string }
function portas(opts: { transporte?: TransporteEnvioMeta; criarFalha?: string; transicaoFalha?: string; statusInicial?: EstadoEntrega; existente?: boolean } = {}) {
  const linha: Registro[] = [];
  const enviados: RequisicaoEnvioMeta[] = [];
  const transicoes: { de: EstadoEntrega; para: EstadoEntrega }[] = [];
  let status: EstadoEntrega = opts.statusInicial ?? 'READY';
  const p: PortasEntregaMeta = {
    criar: async (c) => {
      linha.push({ passo: 'criar', detalhe: c.idempotencyKey });
      if (opts.criarFalha) return { ok: false, erro: opts.criarFalha };
      return { ok: true, deliveryId: 'dlv-1', status, existente: opts.existente === true };
    },
    transicionar: async (c) => {
      linha.push({ passo: `transicionar:${c.para}` });
      if (opts.transicaoFalha) return { ok: false, erro: opts.transicaoFalha };
      transicoes.push({ de: status, para: c.para });
      status = c.para;
      return { ok: true };
    },
    enviar: opts.transporte,
  };
  if (opts.transporte) {
    const original = opts.transporte.postar;
    p.enviar = { liberado: opts.transporte.liberado, postar: async (r) => { linha.push({ passo: 'postar', detalhe: r.caminho }); enviados.push(r); return original(r); } };
  }
  return { portas: p, linha, enviados, transicoes };
}
const transporteFalso = (resposta: RespostaEnvioBruta): TransporteEnvioMeta => ({ liberado: true, postar: async () => resposta });
const RESPOSTA_OK: RespostaEnvioBruta = { httpStatus: 200, corpo: { messaging_product: 'whatsapp', contacts: [{ input: AUTORIZADO, wa_id: AUTORIZADO }], messages: [{ id: 'wamid.HBg1', message_status: 'accepted' }] } };

// ---------------------------------------------------------------------------

describe('montagem da requisição (POST /{PHONE_NUMBER_ID}/messages)', () => {
  it('FREEFORM vira type text no caminho do número, com o destino normalizado', () => {
    const m = montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'FREEFORM', texto: TEXTO });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.requisicao).toMatchObject({ metodo: 'POST', caminho: `/${PHONE_ID}/messages` });
    expect(m.requisicao.corpo).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: AUTORIZADO, type: 'text', text: { preview_url: false, body: TEXTO } });
  });
  it('FREEFORM sem texto ou com texto acima do limite da Cloud API não monta', () => {
    expect(montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'FREEFORM', texto: '   ' })).toMatchObject({ ok: false, codigo: 'sem_texto_aprovado' });
    expect(montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'FREEFORM', texto: 'a'.repeat(LIMITE_TEXTO_META + 1) })).toMatchObject({ ok: false, codigo: 'texto_muito_longo' });
    expect(montarRequisicaoMeta({ phoneNumberId: '', telefone: AUTORIZADO, modo: 'FREEFORM', texto: TEXTO })).toMatchObject({ ok: false, codigo: 'sem_remetente' });
    expect(montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: '', modo: 'FREEFORM', texto: TEXTO })).toMatchObject({ ok: false, codigo: 'sem_telefone' });
  });
  it('TEMPLATE leva name, language.code e os parâmetros na ordem dos marcadores', () => {
    const m = montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'TEMPLATE', template: { nome: 'aviso_obra', idioma: 'pt_BR' }, parametros: [{ chave: '1', valor: 'Fulano' }, { chave: '2', valor: 'Obra X' }] });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.requisicao.corpo).toMatchObject({ type: 'template', template: { name: 'aviso_obra', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Fulano' }, { type: 'text', text: 'Obra X' }] }] } });
  });
  it('marcador com nome vira parameter_name; template sem variável não manda components; sem idioma não monta', () => {
    const nomeado = montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'TEMPLATE', template: { nome: 'x', idioma: 'pt_BR' }, parametros: [{ chave: 'cliente', valor: 'Fulano' }] });
    expect(nomeado.ok && (nomeado.requisicao.corpo.template as { components: { parameters: unknown[] }[] }).components[0].parameters[0]).toMatchObject({ type: 'text', parameter_name: 'cliente', text: 'Fulano' });
    const semVar = montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'TEMPLATE', template: { nome: 'x', idioma: 'pt_BR' } });
    expect(semVar.ok && (semVar.requisicao.corpo.template as Record<string, unknown>).components).toBeUndefined();
    expect(montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'TEMPLATE', template: { nome: 'x', idioma: '' } })).toMatchObject({ ok: false, codigo: 'template_sem_idioma' });
    expect(montarRequisicaoMeta({ phoneNumberId: PHONE_ID, telefone: AUTORIZADO, modo: 'TEMPLATE' })).toMatchObject({ ok: false, codigo: 'template_invalido' });
  });
});

describe('variáveis de template: só mapeamento explícito', () => {
  const comVar: TemplateCanal = { ...TEMPLATE, variaveis: ['2', '1'] };
  it('template com variáveis e sem mapeamento não envia: texto livre do LLM nunca vira template', () => {
    expect(resolverVariaveisTemplateMeta(comVar, undefined, {})).toMatchObject({ ok: false, codigo: 'template_sem_mapeamento' });
    expect(resolverVariaveisTemplateMeta(comVar, { templateId: 'outro', variaveis: [{ chave: '1', origem: 'fixo', valorFixo: 'a' }] }, {})).toMatchObject({ ok: false, codigo: 'template_sem_mapeamento' });
  });
  it('mapeamento completo resolve na ordem numérica; mapeamento incompleto ou valor vazio recusa', () => {
    const mapa = { templateId: 't1', variaveis: [{ chave: '1', origem: 'contato.nome' as const }, { chave: '2', origem: 'empresa.nome' as const }] };
    expect(resolverVariaveisTemplateMeta(comVar, mapa, { contatoNome: 'Fulano', empresaNome: 'Empresa Fictícia' })).toEqual({ ok: true, parametros: [{ chave: '1', valor: 'Fulano' }, { chave: '2', valor: 'Empresa Fictícia' }] });
    const faltando = resolverVariaveisTemplateMeta(comVar, mapa, { contatoNome: 'Fulano' });
    expect(faltando.ok).toBe(false);
    expect(!faltando.ok && faltando.mensagem).toContain('2');
    expect(resolverVariaveisTemplateMeta(TEMPLATE, undefined, {})).toEqual({ ok: true, parametros: [] });
  });
  it('parâmetro sai sanitizado: sem quebra de linha, tabulação ou sequência de espaços', () => {
    expect(sanitizarVariavelMeta(' Obra\nNova\tGrande    Ltda ')).toBe('Obra Nova Grande Ltda');
    expect(sanitizarVariavelMeta('a'.repeat(2000)).length).toBe(1024);
  });
});

describe('janela de 24 h: a prova vem do webhook, nunca de um GET', () => {
  const evento = (tipo: ChannelInboundEvent['eventType'], em: string, direcao: ChannelInboundEvent['direction'] = 'inbound'): ChannelInboundEvent =>
    ({ provider: 'META_CLOUD', externalConversationId: AUTORIZADO, externalMessageId: `wamid.${em}`, direction: direcao, eventType: tipo, occurredAt: em, contactPhone: AUTORIZADO });
  it('MESSAGE_RECEIVED recente abre a janela; passada de 24 h, não', () => {
    expect(provaJanelaMeta([evento('MESSAGE_RECEIVED', '2026-09-10T10:00:00.000Z')], AGORA)).toMatchObject({ janelaComprovada: true, janelaLivreAte: '2026-09-11T10:00:00.000Z' });
    expect(provaJanelaMeta([evento('MESSAGE_RECEIVED', '2026-09-09T05:00:00.000Z')], AGORA).janelaComprovada).toBe(false);
  });
  it('só mensagem nossa (SENT/DELIVERED/READ) nunca prova janela, e histórico vazio também não', () => {
    const nossos = [evento('MESSAGE_SENT', '2026-09-10T11:00:00.000Z', 'outbound'), evento('MESSAGE_DELIVERED', '2026-09-10T11:01:00.000Z', 'outbound')];
    expect(provaJanelaMeta(nossos, AGORA).janelaComprovada).toBe(false);
    expect(mensagensDeEventosMeta(nossos).every((m) => m.direcao === 'saida')).toBe(true);
    expect(provaJanelaMeta([], AGORA)).toMatchObject({ janelaComprovada: false });
  });
  it('o webhook real vira prova: payload de mensagem recebida abre a janela', () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, messages: [{ id: 'wamid.1', from: AUTORIZADO, timestamp: String(Math.floor(Date.parse('2026-09-10T11:30:00.000Z') / 1000)), type: 'text' }] } }] }] };
    expect(provaJanelaMeta(normalizarEventosMeta(payload, { numeros: { interno: PHONE_ID } }), AGORA).janelaComprovada).toBe(true);
  });
  it('o status da Meta traz o fim da janela e o erro com título, sem inventar data', () => {
    const status = (extra: Record<string, unknown>) => normalizarEventosMeta({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'wamid.9', status: 'failed', timestamp: '1789000000', recipient_id: AUTORIZADO, conversation: { id: 'conv-1', expiration_timestamp: '1789086400', origin: { type: 'service' } }, ...extra }] } }] }] }, { numeros: { interno: PHONE_ID } })[0];
    const e = status({ errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'fora da janela' } }] });
    expect(e).toMatchObject({ erroCodigo: '131047', erroTitulo: 'Re-engagement message', erroDetalhe: 'fora da janela', origemConversa: 'service' });
    expect(e.janelaExpiraEm).toBe(new Date(1789086400 * 1000).toISOString());
    expect(status({ conversation: {} }).janelaExpiraEm).toBeUndefined();
  });
});

describe('três guardas fail-closed, antes de qualquer efeito', () => {
  it('modo de envio: disabled (padrão) e pilot não liberam ninguém', () => {
    expect(prepararEnvioMeta(ctx({ modoEnvio: 'disabled' }))).toMatchObject({ ok: false, codigo: 'envio_desligado', httpStatus: 403 });
    expect(prepararEnvioMeta(ctx({ modoEnvio: 'pilot' }))).toMatchObject({ ok: false, codigo: 'modo_pilot_nao_liberado', httpStatus: 403 });
  });
  it('allowlist do canário: destino fora da lista é recusado; sem telefone também', () => {
    expect(prepararEnvioMeta(ctx({ telefone: OUTRO }))).toMatchObject({ ok: false, codigo: 'canary_destination_not_allowed', httpStatus: 403 });
    expect(prepararEnvioMeta(ctx({ telefone: undefined }))).toMatchObject({ ok: false, codigo: 'sem_telefone' });
  });
  it('coerência de canal: Meta Cloud só entrega WhatsApp', () => {
    expect(validarCoerenciaCanalMeta({ canalComunicacao: 'WHATSAPP', canalEntrega: 'WHATSAPP' }).ok).toBe(true);
    expect(validarCoerenciaCanalMeta({ canalComunicacao: 'EMAIL', canalEntrega: 'EMAIL' }).ok).toBe(false);
    expect(validarCoerenciaCanalMeta({ canalComunicacao: 'WHATSAPP', canalEntrega: 'EMAIL' }).ok).toBe(false);
    expect(prepararEnvioMeta(ctx({ canalComunicacao: 'EMAIL' }))).toMatchObject({ ok: false, codigo: 'canal_incoerente' });
  });
  it('entregabilidade: não apta, modo manual, janela não comprovada e template não aprovado não passam', () => {
    expect(prepararEnvioMeta(ctx({ entregabilidade: { resultado: 'MISSING_PHONE', apto: false, motivo: 'sem telefone' } }))).toMatchObject({ ok: false, codigo: 'nao_entregavel' });
    expect(prepararEnvioMeta(ctx({ modo: 'MANUAL' }))).toMatchObject({ ok: false, codigo: 'modo_nao_suportado' });
    expect(prepararEnvioMeta(ctx({ janela: { janelaComprovada: false, motivo: 'sem histórico' } }))).toMatchObject({ ok: false, codigo: 'janela_nao_comprovada' });
    expect(prepararEnvioMeta(ctx({ janela: undefined }))).toMatchObject({ ok: false, codigo: 'janela_nao_comprovada' });
    expect(prepararEnvioMeta(ctx({ modo: 'TEMPLATE', template: { ...TEMPLATE, status: 'pending', ativo: false } }))).toMatchObject({ ok: false, codigo: 'template_invalido' });
  });
  it('preparo aprovado devolve chave de idempotência e impressão do comando, estáveis e sensíveis ao comando', () => {
    const a = prepararEnvioMeta(ctx());
    const b = prepararEnvioMeta(ctx());
    expect(a.ok && b.ok && a.idempotencyKey).toBe(b.ok ? b.idempotencyKey : '');
    expect(a.ok && a.idempotencyKey).toContain('META_CLOUD');
    const outroTexto = prepararEnvioMeta(ctx({ texto: 'outro texto aprovado' }));
    expect(a.ok && outroTexto.ok && a.fingerprint === outroTexto.fingerprint).toBe(false);
    const template = prepararEnvioMeta(ctx({ modo: 'TEMPLATE', template: TEMPLATE, texto: undefined, janela: undefined }));
    expect(template.ok && template.idempotencyKey === (a.ok ? a.idempotencyKey : '')).toBe(false);
  });
});

describe('classificação do retorno da Graph API', () => {
  it('ids presentes → ACCEPTED, sem usar o wa_id (telefone) como id de conversa', () => {
    const r = interpretarRespostaMetaEnvio(RESPOSTA_OK);
    expect(r).toMatchObject({ status: 'ACCEPTED', mensagemId: 'wamid.HBg1', statusProvider: 'accepted' });
    expect(r.conversaId).toBeUndefined();
    expect(JSON.stringify(canonizarRespostaMeta(RESPOSTA_OK.corpo))).not.toContain(AUTORIZADO);
  });
  it('erro explícito da Meta (code numérico) → FAILED com o código em texto', () => {
    const r = interpretarRespostaMetaEnvio({ httpStatus: 400, corpo: { error: { message: 'Re-engagement message', type: 'OAuthException', code: 131047, fbtrace_id: 'x' } } });
    expect(r).toMatchObject({ status: 'FAILED', erroCodigo: '131047' });
  });
  it('timeout, rede, 5xx e 2xx sem identificador → UNKNOWN (nunca FAILED)', () => {
    expect(interpretarRespostaMetaEnvio({ timeout: true }).status).toBe('UNKNOWN');
    expect(interpretarRespostaMetaEnvio({ rede: true }).status).toBe('UNKNOWN');
    expect(interpretarRespostaMetaEnvio({ httpStatus: 503 }).status).toBe('UNKNOWN');
    expect(interpretarRespostaMetaEnvio({ httpStatus: 200, corpo: { messaging_product: 'whatsapp' } }).status).toBe('UNKNOWN');
    expect(interpretarRespostaMetaEnvio({ httpStatus: 401, corpo: {} }).status).toBe('UNKNOWN'); // 4xx sem código não é rejeição confirmada
  });
});

describe('delivery first: entrega antes do POST, sempre', () => {
  it('ordem do rito: criar → REQUESTED → postar → ACCEPTED, e só transições permitidas', async () => {
    const p = portas({ transporte: transporteFalso(RESPOSTA_OK) });
    const r = await executarEnvioMeta(ctx(), p.portas);
    expect(p.linha.map((x) => x.passo)).toEqual(['criar', 'transicionar:REQUESTED', 'postar', 'transicionar:ACCEPTED']);
    expect(p.enviados[0].caminho).toBe(`/${PHONE_ID}/messages`);
    expect(r).toMatchObject({ ok: true, postou: true, proximoPasso: 'confirmado', entrega: { id: 'dlv-1', status: 'ACCEPTED', mensagemProviderId: 'wamid.HBg1' } });
    for (const t of p.transicoes) expect(TRANSICOES_ENTREGA[t.de]).toContain(t.para);
  });
  it('guarda reprovada: a entrega nem chega a ser criada', async () => {
    const p = portas({ transporte: transporteFalso(RESPOSTA_OK) });
    const r = await executarEnvioMeta(ctx({ telefone: OUTRO }), p.portas);
    expect(r).toMatchObject({ ok: false, codigo: 'canary_destination_not_allowed', postou: false });
    expect(p.linha).toEqual([]);
    expect(p.enviados).toHaveLength(0);
  });
  it('falha ao criar a entrega ou ao marcá-la como solicitada: nada é postado', async () => {
    const semEntrega = portas({ transporte: transporteFalso(RESPOSTA_OK), criarFalha: 'sem_permissao' });
    expect(await executarEnvioMeta(ctx(), semEntrega.portas)).toMatchObject({ ok: false, codigo: 'entrega_nao_criada', postou: false });
    expect(semEntrega.enviados).toHaveLength(0);
    const semRequest = portas({ transporte: transporteFalso(RESPOSTA_OK), transicaoFalha: 'transicao_invalida' });
    expect(await executarEnvioMeta(ctx(), semRequest.portas)).toMatchObject({ ok: false, codigo: 'entrega_nao_solicitada', postou: false });
    expect(semRequest.enviados).toHaveLength(0);
    expect(semRequest.linha.map((x) => x.passo)).toEqual(['criar', 'transicionar:REQUESTED']);
  });
  it('entrega que já existia (duplo clique) nunca gera um segundo POST', async () => {
    const p = portas({ transporte: transporteFalso(RESPOSTA_OK), existente: true });
    const r = await executarEnvioMeta(ctx(), p.portas);
    expect(r).toMatchObject({ postou: false, entrega: { jaProcessada: true } });
    expect(p.enviados).toHaveLength(0);
    const terminal = portas({ transporte: transporteFalso(RESPOSTA_OK), statusInicial: 'ACCEPTED' });
    expect(await executarEnvioMeta(ctx(), terminal.portas)).toMatchObject({ postou: false, entrega: { jaProcessada: true } });
    expect(terminal.enviados).toHaveLength(0);
  });
  it('resposta ambígua vira UNKNOWN e manda reconciliar; rejeição explícita vira FAILED e manda revisar', async () => {
    const desconhecido = portas({ transporte: transporteFalso({ httpStatus: 500 }) });
    expect(await executarEnvioMeta(ctx(), desconhecido.portas)).toMatchObject({ ok: false, postou: true, proximoPasso: 'reconciliar', entrega: { status: 'UNKNOWN' } });
    const falhou = portas({ transporte: transporteFalso({ httpStatus: 400, corpo: { error: { code: 131047 } } }) });
    expect(await executarEnvioMeta(ctx(), falhou.portas)).toMatchObject({ ok: false, postou: true, proximoPasso: 'revisar', entrega: { status: 'FAILED', erroCodigo: '131047' } });
    const caiu = portas({ transporte: { liberado: true, postar: async () => { const e = new Error('sem rede'); e.name = 'TypeError'; throw e; } } });
    expect(await executarEnvioMeta(ctx(), caiu.portas)).toMatchObject({ postou: true, entrega: { status: 'UNKNOWN' } });
  });
});

describe('nada é enviado nesta onda', () => {
  it('sem transporte liberado, a execução para antes de criar a entrega', async () => {
    const p = portas();
    const r = await executarEnvioMeta(ctx(), p.portas);
    expect(r).toMatchObject({ ok: false, httpStatus: 503, codigo: 'envio_bloqueado_piloto', postou: false });
    expect(p.linha).toEqual([]);
  });
  it('o transporte de produção é o bloqueado: sua última linha recusa', async () => {
    expect(TRANSPORTE_BLOQUEADO.liberado).toBe(false);
    await expect(TRANSPORTE_BLOQUEADO.postar({ metodo: 'POST', caminho: `/${PHONE_ID}/messages`, corpo: {} })).rejects.toMatchObject({ codigo: 'envio_bloqueado_piloto' });
  });
  it('sendApproved do provider Meta: guardas em segunda camada e recusa, sem nenhuma requisição', async () => {
    const meta: ConfigMeta = { accessToken: 'EAAsegredo-nunca-vaza-0123456789', phoneNumberId: PHONE_ID, wabaId: 'waba-1' };
    const deps = (extra: Partial<DepsMeta> = {}): DepsMeta => ({ fetch: fetchMock, meta, modoEnvio: 'canary', canaryNumeros: [AUTORIZADO], ...extra });
    const base = { comunicacaoId: COM, contatoId: CONTATO, canal: 'WHATSAPP' as const, idempotencyKey: 'k', telefone: AUTORIZADO };
    const p = metaCloudProvider(meta, deps());
    await expect(p.sendApproved({ ...base, modo: 'TEMPLATE' })).rejects.toMatchObject({ codigo: 'envio_bloqueado_piloto' });
    await expect(p.sendApproved({ ...base, modo: 'FREEFORM', texto: TEXTO })).rejects.toMatchObject({ codigo: 'janela_nao_comprovada' });
    await expect(p.sendApproved({ ...base, modo: 'FREEFORM', texto: TEXTO, janela: janelaViva } as never)).rejects.toMatchObject({ codigo: 'envio_bloqueado_piloto' });
    await expect(p.sendApproved({ ...base, canal: 'EMAIL', modo: 'TEMPLATE' })).rejects.toMatchObject({ codigo: 'canal_incoerente' });
    await expect(p.sendApproved({ ...base, modo: 'TEMPLATE', entregabilidade: { resultado: 'NEEDS_REVIEW', apto: false, motivo: 'não aprovada' } } as never)).rejects.toMatchObject({ codigo: 'nao_entregavel' });
    await expect(metaCloudProvider(meta, deps({ modoEnvio: 'disabled' })).sendApproved({ ...base, modo: 'TEMPLATE' })).rejects.toMatchObject({ codigo: 'envio_desligado' });
    await expect(p.sendApproved({ ...base, modo: 'TEMPLATE', telefone: OUTRO })).rejects.toMatchObject({ codigo: 'canary_destination_not_allowed' });
    expect(chamadas).toHaveLength(0);
  });
  it('o pedido do provider vira contexto de envio sem perder as guardas', () => {
    const c = contextoDoPedidoMeta({ comunicacaoId: COM, contatoId: CONTATO, canal: 'WHATSAPP', modo: 'FREEFORM', idempotencyKey: 'k', telefone: AUTORIZADO, texto: TEXTO, janela: janelaViva }, { phoneNumberId: PHONE_ID, modoEnvio: 'canary', allowlist: [AUTORIZADO] });
    expect(prepararEnvioMeta(c).ok).toBe(true);
    expect(prepararEnvioMeta({ ...c, allowlist: [] })).toMatchObject({ ok: false, codigo: 'canary_destination_not_allowed' });
  });
  it('nenhum arquivo de produção da Central faz POST na Graph API', () => {
    const envio = fs.readFileSync('src/core/central/metaEnvio.ts', 'utf8');
    expect(envio).not.toMatch(/fetch\s*\(/); // o módulo do caminho de envio não conhece rede
    for (const f of ['src/core/central/metaServidor.ts', 'netlify/functions/channel-meta.ts', 'netlify/functions/channel-meta-webhook.ts']) {
      const fonte = fs.readFileSync(f, 'utf8');
      for (const m of fonte.matchAll(/method:\s*'(\w+)'/g)) expect(m[1], f).toBe('GET');
    }
    // o único transporte declarado no código de produção é o bloqueado
    const fontes = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fontes(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const comLiberado = fontes('src').concat(fontes('netlify')).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && /liberado:\s*true/.test(fs.readFileSync(f, 'utf8')));
    expect(comLiberado).toEqual([]);
  });
});

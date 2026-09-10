// Provider Octadesk, SOMENTE server-side (mesmo padrao de vibeServidor/comunicacaoServidor: fetch injetado, testavel).
// Nesta fase e READ-ONLY: GET /auth/check, /chat/numbers, /chat/templates-message e /chat (busca de conversa).
// Nenhum POST de mensagem existe aqui: sendApproved chama recusarEnvio(). A chave OCTADESK_API_KEY nunca sai desta
// camada (nem para o navegador, nem para log, nem para a resposta). Contrato da API em docs/octadesk.md.
import { ErroCanal, NOME_PROVIDER, avaliarEntregabilidade, avaliarJanelaLivre, comProvaDeJanela, direcaoMensagem, impressaoMensagem, mascararTelefone, reconciliarEntrega, recusarEnvio, whatsappDoContato, type ComandoReconciliacao, type CommunicationChannelProvider, type ConversaCanal, type ConversaCandidata, type Entregabilidade, type EstadoProvider, type MensagemCanal, type ModoEntrega, type Reconciliacao, type RemetenteCanal, type SaudeProvider, type TemplateCanal } from './canais';
import { permiteReenvioAutomatico, type EstadoEntrega } from './canais';
import { autenticar, type Sessao } from './comunicacaoServidor';
import type { Canal, Contato } from './types';

type Row = Record<string, unknown>;
type Resp = { status: number; corpo: Record<string, unknown> };
type Req = { method: string; authorization?: string | null; body: unknown };
const resp = (status: number, corpo: Record<string, unknown>): Resp => ({ status, corpo });
const ehResp = (x: unknown): x is Resp => !!x && typeof x === 'object' && 'status' in (x as Resp) && 'corpo' in (x as Resp);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nada de chave, e-mail ou telefone em mensagem de erro que sobe para a resposta. */
const seguro = (s: string) => s.replace(/[A-Za-z0-9_-]{20,}/g, '***').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').replace(/\b\d{8,}\b/g, '***').slice(0, 200);

export const VARIAVEIS_OCTADESK = ['OCTADESK_API_KEY', 'OCTADESK_BASE_URL', 'OCTADESK_AGENT_EMAIL'] as const;
/** Propriedade de filtro do telefone do contato em GET /chat (ContactsPayload.phoneContacts[].number). */
export const PROPRIEDADE_TELEFONE = 'contact.phoneContacts.number';
export interface ConfigOctadesk { baseUrl: string; apiKey: string; agentEmail?: string }
export interface DepsCanal {
  fetch: typeof fetch;
  supabaseUrl: string; anon: string;
  octadesk?: ConfigOctadesk; // ausente = NOT_CONFIGURED
  faltando?: string[]; // variaveis de ambiente ausentes (nomes, nunca valores)
  agora?: () => string;
  timeoutMs?: number;
  log?: (t: Record<string, unknown>) => void; // provider, operation, status, http_status, latency_ms, ids sanitizados
}

// ---------------------------------------------------------------------------
// Normalizadores (puros, testaveis sem rede) — schemas conferidos em docs/octadesk.md
// ---------------------------------------------------------------------------
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
export function normalizarNumeros(bruto: unknown): RemetenteCanal[] {
  const lista = Array.isArray(bruto) ? bruto : Array.isArray((bruto as Row)?.data) ? ((bruto as Row).data as unknown[]) : [];
  return lista.map((x) => x as Row).filter((x) => txt(x.id)).map((x) => ({ id: String(x.id), nome: txt(x.name), numero: txt(x.number) }));
}
const STATUS_TEMPLATE = ['approved', 'pending', 'rejected'] as const;
export function normalizarTemplates(bruto: unknown): TemplateCanal[] {
  const lista = Array.isArray(bruto) ? bruto : Array.isArray((bruto as Row)?.data) ? ((bruto as Row).data as unknown[]) : [];
  return lista.map((x) => x as Row).filter((x) => txt(x.id)).map((x) => {
    const s = (txt(x.status) ?? '').toLowerCase();
    const componentes = Array.isArray(x.components) ? (x.components as Row[]) : [];
    const variaveis = [...new Set(componentes.flatMap((c) => (Array.isArray(c.variables) ? (c.variables as unknown[]) : [])).map((v) => (typeof v === 'string' ? v : txt((v as Row)?.key) ?? txt((v as Row)?.name))).filter((v): v is string => !!v))];
    return {
      id: String(x.id), nome: txt(x.name) ?? String(x.id),
      status: (STATUS_TEMPLATE as readonly string[]).includes(s) ? (s as TemplateCanal['status']) : 'desconhecido',
      categoria: txt(x.category), idioma: txt(x.language) ?? txt(x.languageCode),
      ativo: x.enable === undefined ? true : !!x.enable, variaveis,
    };
  });
}
const ABERTOS = ['waiting', 'talking', 'started']; // ver docs/octadesk.md (status de chat)
export function normalizarConversas(bruto: unknown): ConversaCanal[] {
  const lista = Array.isArray(bruto) ? bruto : Array.isArray((bruto as Row)?.data) ? ((bruto as Row).data as unknown[]) : [];
  return lista.map((x) => x as Row).filter((x) => txt(x.id)).map((x) => {
    const status = (txt(x.status) ?? 'desconhecido').toLowerCase();
    return { id: String(x.id), canal: txt(x.channel) ?? 'whatsapp', status, aberta: ABERTOS.includes(status), ultimaMensagemEm: txt(x.lastMessageDate) ?? txt(x.updatedAt), naoLidas: typeof x.unreadMessages === 'number' ? x.unreadMessages : undefined };
  });
}
/**
 * Direcao vem de sentBy.type ("if is an agent or a contact", doc oficial). NUNCA do status: "received" significa
 * "delivered to recipient", ou seja, mensagem NOSSA entregue (ver docs/octadesk.md). Sem sentBy.type = desconhecida.
 * `impressao` e o hash comparavel do corpo, calculado em transito: o corpo em si nunca sai daqui.
 */
export function normalizarMensagens(bruto: unknown, conversaId?: string): (MensagemCanal & { impressao?: string })[] {
  const lista = Array.isArray(bruto) ? bruto : Array.isArray((bruto as Row)?.data) ? ((bruto as Row).data as unknown[]) : [];
  return lista.map((x) => x as Row).filter((x) => txt(x.id)).map((x) => {
    const st = (txt(x.status) ?? '').toLowerCase();
    const chat = txt(x.chatId) ?? conversaId ?? '';
    const corpo = txt(x.body);
    return {
      id: String(x.id), conversaId: chat, em: txt(x.time) ?? '',
      direcao: direcaoMensagem(txt((x.sentBy as Row | undefined)?.type)),
      status: st || undefined, interna: txt(x.type) === 'internal',
      impressao: corpo && chat ? impressaoMensagem({ conversaId: chat, texto: corpo }) : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Cliente HTTP do Octadesk (read-only)
// ---------------------------------------------------------------------------
const TIMEOUT_PADRAO_MS = 12_000;
export function octadeskProvider(cfg: ConfigOctadesk | undefined, d: DepsCanal): CommunicationChannelProvider {
  const faltando = cfg ? [] : (d.faltando ?? [...VARIAVEIS_OCTADESK]);
  const base = (cfg?.baseUrl ?? '').replace(/\/+$/, '');
  const exigir = (): ConfigOctadesk => { if (!cfg || !base) throw new ErroCanal('nao_configurado', `Octadesk não configurado: falta ${faltando.join(', ') || 'configuração'}.`); return cfg; };
  const get = async (caminho: string, operacao: string): Promise<unknown> => {
    const c = exigir();
    const inicio = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), d.timeoutMs ?? TIMEOUT_PADRAO_MS);
    try {
      const r = await d.fetch(`${base}${caminho}`, { method: 'GET', signal: ctrl.signal, headers: { accept: 'application/json', 'X-API-KEY': c.apiKey, ...(c.agentEmail ? { 'octa-agent-email': c.agentEmail } : {}) } });
      const texto = await r.text();
      d.log?.({ evento: 'channel_call', provider: 'OCTADESK', operation: operacao, http_status: r.status, latency_ms: Date.now() - inicio, ok: r.ok });
      if (!r.ok) throw new ErroCanal('provider_http', `Octadesk ${operacao}: HTTP ${r.status}${texto ? ` — ${seguro(texto)}` : ''}`, r.status);
      try { return texto ? JSON.parse(texto) : []; } catch { throw new ErroCanal('resposta_invalida', `Octadesk ${operacao}: resposta não é JSON.`); }
    } catch (e) {
      if (e instanceof ErroCanal) throw e;
      const abortou = (e as Error).name === 'AbortError';
      d.log?.({ evento: 'channel_call', provider: 'OCTADESK', operation: operacao, latency_ms: Date.now() - inicio, ok: false, erro: abortou ? 'timeout' : 'rede' });
      throw new ErroCanal(abortou ? 'timeout' : 'rede', `Octadesk ${operacao}: ${abortou ? 'tempo esgotado' : 'falha de rede'}.`);
    } finally { clearTimeout(t); }
  };
  const lerMensagens = async (id: string) => normalizarMensagens(await get(`/chat/${encodeURIComponent(id)}/messages?page=1&limit=100&property=time&direction=desc`, 'messages'), id);
  const filtros = (f: { property: string; operator: string; value: string }[]) => f.map((x, i) => `filters[${i}][property]=${encodeURIComponent(x.property)}&filters[${i}][operator]=${encodeURIComponent(x.operator)}&filters[${i}][value]=${encodeURIComponent(x.value)}`).join('&');
  return {
    codigo: 'OCTADESK', nome: NOME_PROVIDER.OCTADESK,
    capabilities: () => ['NEW_CONVERSATION_TEMPLATE', 'OPEN_CONVERSATION_FREEFORM', 'READ_CONVERSATION', 'READ_TEMPLATES'], // sem INBOUND_WEBHOOK: nao documentado
    healthCheck: async (): Promise<SaudeProvider> => {
      if (!cfg || !base) return { estado: 'NOT_CONFIGURED', variaveisFaltando: faltando, detalhe: `Falta configurar ${faltando.join(', ')} no Netlify.`, verificadoEm: d.agora?.() };
      try {
        const v = await get('/auth/check', 'auth_check');
        const valida = v === true || (v as Row)?.valid === true || (v as Row)?.success === true;
        return valida ? { estado: 'CONNECTED', verificadoEm: d.agora?.() } : { estado: 'ERROR', detalhe: 'Chave recusada pela Octadesk (/auth/check).', verificadoEm: d.agora?.() };
      } catch (e) { return { estado: 'ERROR', detalhe: seguro((e as Error).message), verificadoEm: d.agora?.() }; }
    },
    listSenders: async () => normalizarNumeros(await get('/chat/numbers', 'numbers')),
    listTemplates: async () => normalizarTemplates(await get(`/chat/templates-message?${filtros([{ property: 'status', operator: 'eq', value: 'approved' }])}&page=1&limit=100`, 'templates')),
    findConversation: async (telefone: string) => {
      // propriedade correta do filtro: contact.phoneContacts.number (ContactsPayload.phoneContacts[].number)
      const lista = normalizarConversas(await get(`/chat?${filtros([{ property: PROPRIEDADE_TELEFONE, operator: 'eq', value: telefone }])}&page=1&limit=20`, 'chat_lookup'));
      const c = lista.filter((x) => x.aberta).sort((a, b) => (b.ultimaMensagemEm ?? '').localeCompare(a.ultimaMensagemEm ?? ''))[0] ?? lista[0];
      if (!c) return undefined;
      // janela livre so com prova no historico: lastMessageDate pode ser mensagem NOSSA
      let prova: ReturnType<typeof avaliarJanelaLivre>;
      try { prova = avaliarJanelaLivre(await lerMensagens(c.id), d.agora?.()); }
      catch (e) { prova = { janelaComprovada: false, motivo: `histórico indisponível: ${seguro((e as Error).message)}` }; }
      return comProvaDeJanela(c, prova);
    },
    getConversation: async (id: string) => normalizarConversas([await get(`/chat/${encodeURIComponent(id)}`, 'chat_get')])[0],
    getMessages: (id: string) => lerMensagens(id),
    sendApproved: async () => recusarEnvio(), // Channel Provider 01: nenhum POST de mensagem
    reconcileDelivery: async (cmd: ComandoReconciliacao): Promise<Reconciliacao> => {
      // read-only: descobre se o envio ambiguo chegou. Nunca reenvia, nunca transiciona sozinho.
      // Conversa desconhecida (send-template com resposta perdida): TODAS as conversas do telefone viram candidatas,
      // e a impressao esperada e recalculada com o id de CADA candidata (nunca hash(null + texto)).
      let ids = cmd.conversaProviderId ? [cmd.conversaProviderId] : [];
      if (!ids.length && cmd.telefone) {
        const lista = normalizarConversas(await get(`/chat?${filtros([{ property: PROPRIEDADE_TELEFONE, operator: 'eq', value: cmd.telefone }])}&page=1&limit=20`, 'chat_lookup'));
        ids = lista.map((c) => c.id);
      }
      if (!ids.length) return { resultado: 'NOT_FOUND', candidatos: 0, motivo: 'nenhuma conversa no provider para este contato' };
      const candidatas: ConversaCandidata[] = [];
      for (const id of ids.slice(0, 10)) candidatas.push({ conversaId: id, mensagens: await lerMensagens(id) });
      return reconciliarEntrega(candidatas, cmd);
    },
  };
}

// ---------------------------------------------------------------------------
// Handler /api/channel/octadesk (read-only)
// ---------------------------------------------------------------------------
export const ACOES_CANAL = ['status', 'numbers', 'templates', 'conversa', 'verificar', 'reconciliar'] as const;
export type AcaoCanal = (typeof ACOES_CANAL)[number];
export interface PedidoCanal { acao: AcaoCanal; comunicacaoId?: string; contatoId?: string; deliveryId?: string }
export const CAMPOS_CANAL = ['acao', 'comunicacaoId', 'contatoId', 'deliveryId'] as const;

/** Contrato publico minimo: so acao + ids. Telefone, chave e configuracao nunca vem do navegador. */
export function validarPedidoCanal(bruto: unknown): PedidoCanal | { erro: string; campos?: string[] } {
  if (!bruto || typeof bruto !== 'object') return { erro: 'corpo_invalido' };
  const o = bruto as Row;
  const extras = Object.keys(o).filter((k) => !(CAMPOS_CANAL as readonly string[]).includes(k));
  if (extras.length) return { erro: 'campos_nao_permitidos', campos: extras };
  if (!(ACOES_CANAL as readonly string[]).includes(o.acao as string)) return { erro: 'acao_invalida' };
  for (const k of ['comunicacaoId', 'contatoId', 'deliveryId'] as const) if (o[k] !== undefined && !(typeof o[k] === 'string' && UUID.test(o[k] as string))) return { erro: `${k}_invalido` };
  if (o.acao === 'reconciliar' && !o.deliveryId) return { erro: 'deliveryId_obrigatorio' };
  return { acao: o.acao as AcaoCanal, comunicacaoId: o.comunicacaoId as string | undefined, contatoId: o.contatoId as string | undefined, deliveryId: o.deliveryId as string | undefined };
}

const contatoDaLinha = (x: Row): Pick<Contato, 'whatsapp' | 'celular' | 'telefone' | 'statusTelefone' | 'situacao'> => ({
  whatsapp: txt(x.whatsapp), celular: txt(x.mobile_phone), telefone: txt(x.phone),
  statusTelefone: txt(x.phone_status) as Contato['statusTelefone'], situacao: txt(x.status) as Contato['situacao'],
});

/**
 * Trata o pedido: JWT -> perfil real do banco -> organizacao -> permissao Radar (autenticar, o mesmo de /api/comunicacao),
 * depois so leitura no Octadesk. Nunca devolve chave, telefone completo nem configuracao.
 */
export async function tratarCanal(req: Req, d: DepsCanal): Promise<Resp> {
  if (req.method !== 'POST') return resp(405, { erro: 'metodo' });
  const s = await autenticar(req, { fetch: d.fetch, supabaseUrl: d.supabaseUrl, anon: d.anon } as never);
  if (ehResp(s)) return s;
  const sessao = s as Sessao;
  const p = validarPedidoCanal(req.body);
  if ('erro' in p) return resp(400, p as Record<string, unknown>);

  const provider = octadeskProvider(d.octadesk, d);
  const faltando = d.octadesk ? [] : (d.faltando ?? [...VARIAVEIS_OCTADESK]);
  const saude = await provider.healthCheck();
  const base: Record<string, unknown> = { provider: 'OCTADESK', nome: provider.nome, capacidades: provider.capabilities(), saude, variaveisFaltando: faltando, webhookInbound: false, envioBloqueado: true };
  if (p.acao === 'status') return resp(200, base);
  if (saude.estado !== 'CONNECTED') return resp(200, { ...base, remetentes: [], templates: [] });

  const ler = async <T>(f: () => Promise<T>, vazio: T): Promise<T> => { try { return await f(); } catch (e) { base.aviso = seguro((e as Error).message); return vazio; } };
  if (p.acao === 'reconciliar') return tratarReconciliacao(p.deliveryId!, sessao, provider, base);
  if (p.acao === 'numbers') return resp(200, { ...base, remetentes: await ler(() => provider.listSenders(), [] as RemetenteCanal[]) });
  if (p.acao === 'templates') return resp(200, { ...base, templates: await ler(() => provider.listTemplates(), [] as TemplateCanal[]) });

  // conversa/verificar: o telefone vem do BANCO (Server Truth), nunca do navegador
  let contatoRow: Row | undefined; let comunicacao: Row | undefined;
  if (p.comunicacaoId) {
    const c = ((await sessao.get(`radar_communication?id=eq.${p.comunicacaoId}&select=id,company_id,contact_id,channel,state,organization_id`)) ?? [])[0];
    if (!c) return resp(404, { erro: 'comunicacao_nao_encontrada' });
    if (c.organization_id !== sessao.perfil.organization_id) return resp(403, { erro: 'comunicacao_de_outra_organizacao' });
    comunicacao = c;
  }
  const contatoId = p.contatoId ?? (comunicacao?.contact_id as string | undefined);
  if (contatoId) {
    const c = ((await sessao.get(`radar_contact?id=eq.${contatoId}&select=id,company_id,phone,mobile_phone,whatsapp,phone_status,status,organization_id`)) ?? [])[0];
    if (!c) return resp(404, { erro: 'contato_nao_encontrado' });
    if (c.organization_id !== sessao.perfil.organization_id) return resp(403, { erro: 'contato_de_outra_organizacao' });
    contatoRow = c;
  }
  if (!contatoRow) return resp(400, { erro: 'contato_obrigatorio' });

  const contato = contatoDaLinha(contatoRow);
  const telefone = whatsappDoContato(contato);
  const [remetentes, templates] = await Promise.all([ler(() => provider.listSenders(), [] as RemetenteCanal[]), ler(() => provider.listTemplates(), [] as TemplateCanal[])]);
  const conversa = telefone ? await ler(() => provider.findConversation(telefone), undefined as ConversaCanal | undefined) : undefined;
  const estado: EstadoProvider = { provider: 'OCTADESK', saude, remetentes, templates, conversa, agora: d.agora?.() };
  const entregabilidade: Entregabilidade | undefined = comunicacao
    ? avaliarEntregabilidade({ estado: String(comunicacao.state), canal: String(comunicacao.channel) as Canal }, contato, estado)
    : undefined;
  d.log?.({ evento: 'channel_check', provider: 'OCTADESK', operation: p.acao, communication_id: p.comunicacaoId ?? null, conversa_id: conversa?.id ?? null, resultado: entregabilidade?.resultado ?? null, remetentes: remetentes.length, templates: templates.length });
  // telefone sai mascarado: a resposta vai para o navegador
  return resp(200, { ...base, remetentes, templates, conversa, telefoneMascarado: mascararTelefone(telefone), entregabilidade: entregabilidade ? { ...entregabilidade, telefone: undefined } : undefined });
}

/**
 * Server Truth da reconciliacao: o navegador manda SO o deliveryId. Aqui o servidor carrega a entrega, a comunicacao,
 * o conteudo aprovado efetivo (edicao humana quando existe) e o contato, e so entao consulta o provider.
 * Nada de impressao pronta vinda do cliente. Somente leitura: nao transiciona a entrega.
 */
async function tratarReconciliacao(deliveryId: string, sessao: Sessao, provider: CommunicationChannelProvider, base: Record<string, unknown>): Promise<Resp> {
  const org = sessao.perfil.organization_id;
  const ent = ((await sessao.get(`radar_communication_delivery?id=eq.${deliveryId}&select=id,organization_id,communication_id,contact_id,provider,channel,mode,status,requested_at,created_at,provider_conversation_id`)) ?? [])[0];
  if (!ent) return resp(404, { erro: 'entrega_nao_encontrada' });
  if (ent.organization_id !== org) return resp(403, { erro: 'entrega_de_outra_organizacao' });
  const com = ((await sessao.get(`radar_communication?id=eq.${ent.communication_id}&select=id,organization_id,state,generated_content,edited_content`)) ?? [])[0];
  if (!com) return resp(404, { erro: 'comunicacao_nao_encontrada' });
  if (com.organization_id !== org) return resp(403, { erro: 'comunicacao_de_outra_organizacao' });
  const contatoRow = ent.contact_id ? ((await sessao.get(`radar_contact?id=eq.${ent.contact_id}&select=id,organization_id,phone,mobile_phone,whatsapp,phone_status,status`)) ?? [])[0] : undefined;
  if (contatoRow && contatoRow.organization_id !== org) return resp(403, { erro: 'contato_de_outra_organizacao' });

  // conteudo aprovado efetivo: edicao humana quando existe, senao a versao principal gerada
  const editado = (com.edited_content as Row | null)?.texto;
  const gerado = (com.generated_content as Row | null)?.versaoPrincipal;
  const modo = String(ent.mode) as ModoEntrega;
  const textoAprovado = modo === 'TEMPLATE' ? undefined : (typeof editado === 'string' && editado.trim() ? editado : typeof gerado === 'string' ? gerado : undefined);
  const cmd: ComandoReconciliacao = {
    deliveryId, comunicacaoId: String(ent.communication_id), modo,
    solicitadoEm: String(ent.requested_at ?? ent.created_at),
    telefone: contatoRow ? whatsappDoContato(contatoDaLinha(contatoRow)) : undefined,
    conversaProviderId: txt(ent.provider_conversation_id),
    textoAprovado,
  };
  let r: Reconciliacao;
  try { r = await provider.reconcileDelivery(cmd); }
  catch (e) { return resp(200, { ...base, entrega: { id: deliveryId, status: ent.status }, reconciliacao: { resultado: 'AMBIGUOUS', candidatos: 0, motivo: `provider indisponível: ${seguro((e as Error).message)}` } }); }
  return resp(200, {
    ...base,
    entrega: { id: deliveryId, status: ent.status, modo, provider: ent.provider, canal: ent.channel },
    reconciliacao: r,
    // a decisao de reenviar nunca e automatica: a resposta diz explicitamente o que e permitido
    reenvioAutomatico: permiteReenvioAutomatico(String(ent.status) as EstadoEntrega, r),
  });
}

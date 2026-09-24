// EIFF Inbox — Octopus Router no SERVIDOR: portas de leitura (PostgREST) e de aplicacao (RPC inbox_apply_routing, 0057)
// com a chave de servico, mais a orquestracao do passo "roteia depois de ingerir". Excecao declarada de pureza do modulo
// (como ingestaoPorta.ts): `fetch` e a chave sao INJETADOS e nunca saem daqui (nem em log, nem em erro).
//
// Fluxo por mensagem ingerida (ingestaoServidor.ts chama `rotearNoServidor`):
//   carregar contexto (thread, mensagens recentes, contato, threads anteriores do contato, setores, equipes, membros,
//   configuracao, obra, perfis ativos) -> decidirRoteamento DETERMINISTICO -> [IA disponivel? classificarSeguro refina e
//   decide de novo com a classificacao] -> thread ja roteada? reavaliar -> RPC inbox_apply_routing (persistir decisao,
//   aplicar pela banda, eventos, numa transacao). Qualquer falha aqui NUNCA desfaz a ingestao: a mensagem ja esta no banco.
import { classificarSeguro, type IntelligenceProvider } from './fronteiras';
import { alvoDaDecisao, decidirRoteamento, reavaliar, type EntradaRoteador } from './roteador';
import { CONFIGURACAO_PADRAO, inboxVazio, type Classificacao, type ConfiguracaoInbox, type ContatoInbox, type DecisaoOctopus, type Equipe, type InboxDataset, type InboxMessage, type InboxThread, type MembroSetor, type Setor } from './tipos';

export interface ConfigPortaRoteamento { url: string; chave: string; organizacaoId: string }
type Row = Record<string, any>; // linhas cruas do PostgREST

/** GET PostgREST com a chave de servico. O erro carrega so o status. */
async function ler(cfg: ConfigPortaRoteamento, fetchFn: typeof fetch, tabela: string, query: string): Promise<Row[]> {
  const r = await fetchFn(`${cfg.url}/rest/v1/${tabela}?${query}`, { headers: { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, accept: 'application/json' } });
  if (!r.ok) throw new Error(`rest ${tabela} http ${r.status}`);
  return (await r.json()) as Row[];
}
const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export interface ContextoServidor { entrada: EntradaRoteador; setores: { codigo: string; nome: string }[]; equipes: Equipe[]; regras: { id: string; setorCodigo: string; motivo: string }[]; obras: { codigo: string; nome?: string }[] }
/**
 * Le do banco SO o necessario para rotear UMA thread (nao o Inbox inteiro) e monta a entrada do router com ids do banco
 * (uuid de setor -> code; equipe/perfil por uuid). O slice devolvido e parcial de proposito: threads = esta + as
 * anteriores do contato; mensagens = as desta thread.
 */
export function portaContextoRest(cfg: ConfigPortaRoteamento, fetchFn: typeof fetch): (threadId: string, messageId: string) => Promise<ContextoServidor | undefined> {
  return async (threadId, messageId) => {
    const org = `organization_id=eq.${cfg.organizacaoId}`;
    const [threads] = await Promise.all([ler(cfg, fetchFn, 'inbox_thread', `id=eq.${threadId}&${org}&select=*`)]);
    const t = threads[0];
    if (!t) return undefined;
    const [mensagens, contatos, identidades, setoresRows, equipesRows, membrosRows, cfgRows, anteriores, perfis] = await Promise.all([
      ler(cfg, fetchFn, 'inbox_message', `thread_id=eq.${threadId}&order=occurred_at.desc&limit=10&select=id,thread_id,provider,direction,content_type,sender_kind,sender_id,sender_name,body,attachments,occurred_at,external_message_id`),
      ler(cfg, fetchFn, 'inbox_contact', `id=eq.${t.contact_id}&select=*`),
      ler(cfg, fetchFn, 'inbox_contact_identity', `contact_id=eq.${t.contact_id}&select=channel,identifier,display_name,verified`),
      ler(cfg, fetchFn, 'inbox_sector', `${org}&select=id,code,name,active,sort_order,default_assignee_id`),
      ler(cfg, fetchFn, 'inbox_team', `${org}&select=id,sector_id,name,active,sort_order,default_assignee_id`),
      ler(cfg, fetchFn, 'inbox_member', `${org}&select=id,profile_id,sector_id,team_id,member_role`),
      ler(cfg, fetchFn, 'inbox_config', `${org}&select=*`),
      ler(cfg, fetchFn, 'inbox_thread', `contact_id=eq.${t.contact_id}&id=neq.${threadId}&order=last_message_at.desc&limit=5&select=id,contact_id,channel,context,subject,status,priority,service_level,sector_id,team_id,assignee_id,classification,opened_at,last_message_at,last_inbound_at,resolved_at`),
      ler(cfg, fetchFn, 'profile', `${org}&active=eq.true&select=id,role`),
    ]);
    const codigo = new Map<string, string>(setoresRows.map((x) => [x.id, x.code]));
    const setores: Setor[] = setoresRows.map((x) => ({ codigo: x.code, nome: x.name, ativo: !!x.active, ordem: Number(x.sort_order ?? 0), responsavelPadraoId: s(x.default_assignee_id) }));
    const equipes: Equipe[] = equipesRows.map((x) => ({ id: x.id, setorCodigo: codigo.get(x.sector_id) ?? '', nome: x.name, ativo: !!x.active, ordem: Number(x.sort_order ?? 0), responsavelPadraoId: s(x.default_assignee_id) }));
    const membros: MembroSetor[] = membrosRows.map((x) => ({ id: x.id, usuarioId: x.profile_id, setorCodigo: codigo.get(x.sector_id) ?? '', equipeId: s(x.team_id), papel: x.member_role }));
    const c = cfgRows[0];
    const configuracao: ConfiguracaoInbox = c ? {
      setorFallback: c.fallback_sector_code, setorEscalacao: c.escalation_sector_code, slaHorasPorPrioridade: { ...CONFIGURACAO_PADRAO.slaHorasPorPrioridade, ...(c.sla_hours ?? {}) }, nivelPadrao: c.default_level,
      regrasNivel: Array.isArray(c.level_rules) && c.level_rules.length ? c.level_rules : CONFIGURACAO_PADRAO.regrasNivel,
      regrasRoteamento: Array.isArray(c.routing_rules) && c.routing_rules.length ? c.routing_rules : CONFIGURACAO_PADRAO.regrasRoteamento,
      regrasAutomacao: Array.isArray(c.automation_rules) && c.automation_rules.length ? c.automation_rules : CONFIGURACAO_PADRAO.regrasAutomacao,
      autoRoteamento: { ...CONFIGURACAO_PADRAO.autoRoteamento, ...(c.auto_routing && typeof c.auto_routing === 'object' ? c.auto_routing : {}) },
    } : CONFIGURACAO_PADRAO;
    const cr = contatos[0];
    const contato: ContatoInbox | undefined = cr ? { id: cr.id, nome: cr.name, empresaNome: s(cr.company_name), tipoRelacao: cr.relation_kind, contatoRadarId: s(cr.radar_contact_id), empresaRadarId: s(cr.radar_company_id), colaboradorId: s(cr.worker_id), usuarioId: s(cr.profile_id), obras: cr.project_codes ?? [], criadoEm: cr.created_at, identidades: identidades.map((i) => ({ canal: i.channel, identificador: i.identifier, nomeInformado: s(i.display_name), verificada: !!i.verified })) } : undefined;
    const thread = (x: Row): InboxThread => ({
      id: x.id, canal: x.channel, provider: x.provider ?? 'META_CLOUD', contexto: x.context, contatoId: x.contact_id, assunto: x.subject, status: x.status, prioridade: x.priority, nivel: x.service_level,
      setorCodigo: codigo.get(x.sector_id), equipeId: s(x.team_id), responsavelId: s(x.assignee_id), participantes: x.participant_ids ?? [], labels: x.labels ?? [],
      classificacao: (x.classification as Classificacao | null) ?? undefined, roteamento: (x.routing as DecisaoOctopus | null) ?? undefined, resumo: s(x.summary),
      sla: x.sla_first_response_due ? { primeiraRespostaAte: x.sla_first_response_due, primeiraRespostaEm: s(x.sla_first_response_at) } : undefined,
      abertaEm: x.opened_at, ultimaMensagemEm: x.last_message_at, ultimaInboundEm: s(x.last_inbound_at), resolvidaEm: s(x.resolved_at), origem: x.origin ?? 'META_CLOUD',
    });
    const msgs: InboxMessage[] = mensagens.map((m) => ({ id: m.id, threadId: m.thread_id, provider: m.provider, direcao: m.direction, tipo: m.content_type, autor: { tipo: m.sender_kind, id: s(m.sender_id), nome: m.sender_name }, texto: m.body ?? '', anexos: Array.isArray(m.attachments) ? m.attachments : [], em: m.occurred_at, externalMessageId: s(m.external_message_id) })).reverse();
    const mensagem = msgs.find((m) => m.id === messageId) ?? msgs.filter((m) => m.direcao === 'inbound').at(-1);
    if (!mensagem) return undefined;
    const inbox: InboxDataset = { ...inboxVazio(), origem: 'remoto', setores, equipes, membros, contatos: contato ? [contato] : [], threads: [thread(t), ...anteriores.map(thread)], mensagens: msgs, configuracao };
    const obras = (contato?.obras ?? []).map((cod) => ({ codigo: cod }));
    return {
      entrada: { inbox, thread: thread(t), mensagem, obras, usuarios: perfis.map((p) => ({ id: p.id, ativo: true, papel: p.role })), agora: new Date().toISOString() },
      setores: setores.filter((x) => x.ativo).map((x) => ({ codigo: x.codigo, nome: x.nome })), equipes: equipes.filter((q) => q.ativo),
      regras: configuracao.regrasRoteamento.filter((r) => r.ativa).map((r) => ({ id: r.id, setorCodigo: r.destino.setorCodigo, motivo: r.motivo })), obras,
    };
  };
}

export interface PedidoAplicarRoteamento { threadId: string; messageId?: string; routing: DecisaoOctopus; classification?: Classificacao; summary?: string; sectorCode?: string; teamId?: string; assigneeId?: string; priority: string; serviceLevel: string; apply: boolean }
export interface ResultadoAplicarRoteamento { ok: boolean; aplicado?: boolean; motivo?: string; erro?: string; status?: string }
/** Porta da RPC inbox_apply_routing (service_role). O erro carrega so o status HTTP. */
export function portaAplicarRoteamentoRpc(cfg: ConfigPortaRoteamento, fetchFn: typeof fetch): (p: PedidoAplicarRoteamento) => Promise<ResultadoAplicarRoteamento> {
  return async (p) => {
    const r = await fetchFn(`${cfg.url}/rest/v1/rpc/inbox_apply_routing`, {
      method: 'POST', headers: { apikey: cfg.chave, authorization: `Bearer ${cfg.chave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_organization_id: cfg.organizacaoId, p_thread_id: p.threadId, p_message_id: p.messageId ?? null, p_routing: p.routing, p_classification: p.classification ?? null, p_summary: p.summary ?? null,
        p_sector_code: p.sectorCode ?? null, p_team_id: p.teamId ?? null, p_assignee_id: p.assigneeId ?? null, p_priority: p.priority, p_service_level: p.serviceLevel, p_apply: p.apply,
      }),
    });
    if (!r.ok) throw new Error(`rpc inbox_apply_routing http ${r.status}`);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: d.ok === true, aplicado: d.aplicado === true, motivo: typeof d.motivo === 'string' ? d.motivo : undefined, erro: typeof d.erro === 'string' ? d.erro : undefined, status: typeof d.status === 'string' ? d.status : undefined };
  };
}

export interface PortasRoteamentoServidor {
  contexto: (threadId: string, messageId: string) => Promise<ContextoServidor | undefined>;
  aplicar: (p: PedidoAplicarRoteamento) => Promise<ResultadoAplicarRoteamento>;
  /** Fabrica do provedor de IA com o contexto extra (equipes/regras/obras); ausente = so deterministico. */
  inteligencia?: (ctx: ContextoServidor) => IntelligenceProvider;
  log?: (t: Record<string, unknown>) => void;
  agora?: () => string;
}
export interface ResultadoRoteamentoServidor { ok: boolean; aplicado: boolean; origem?: DecisaoOctopus['origem']; setorCodigo?: string; banda?: string; confianca?: number; reavaliacao?: string; motivo?: string; classificado: boolean }

/** Passos 1-15 no servidor para uma thread recem-tocada. Nunca lanca: devolve `{ ok: false, motivo }`. */
export async function rotearNoServidor(threadId: string, messageId: string, portas: PortasRoteamentoServidor): Promise<ResultadoRoteamentoServidor> {
  const agora = portas.agora?.() ?? new Date().toISOString();
  try {
    const ctx = await portas.contexto(threadId, messageId);
    if (!ctx) return { ok: false, aplicado: false, classificado: false, motivo: 'contexto indisponível' };
    const entrada: EntradaRoteador = { ...ctx.entrada, agora };
    let classificacao: Classificacao | undefined; let resumo: string | undefined; let classificado = false;
    if (portas.inteligencia) {
      const c = await classificarSeguro(portas.inteligencia(ctx), { thread: entrada.thread, mensagem: entrada.mensagem, historico: entrada.inbox.mensagens.slice(-10), contato: ctx.entrada.inbox.contatos[0], organizacaoId: '', contexto: entrada.thread.contexto, setoresDisponiveis: ctx.setores }, agora);
      if (c.ok) { classificacao = c.classificacao; resumo = c.resumo; classificado = true; }
      else portas.log?.({ evento: 'inbox_inteligencia', outcome: 'indisponivel', motivo: c.motivo.slice(0, 160), threadId });
    }
    const decisao = decidirRoteamento({ ...entrada, classificacaoIa: classificacao });
    const t = entrada.thread;
    let apply = decisao.aplicacao !== 'TRIAGEM'; let reav: string | undefined; let d: DecisaoOctopus = decisao;
    if (t.setorCodigo) {
      const rv = reavaliar(t, decisao, entrada.inbox.configuracao.autoRoteamento);
      d = { ...decisao, reavaliacao: rv, override: t.roteamento?.override };
      reav = rv.veredicto;
      apply = rv.veredicto === 'AUTO_TRANSFER';
      if (apply) d = { ...d, aplicacao: 'ATRIBUIR_SETOR' };
    }
    const alvo = alvoDaDecisao(d);
    const r = await portas.aplicar({
      threadId, messageId, routing: d, classification: classificacao, summary: resumo,
      sectorCode: alvo?.setorCodigo ?? d.setorCodigo, teamId: alvo?.equipeId, assigneeId: alvo?.responsavelId, priority: d.prioridade, serviceLevel: d.nivel, apply: apply && !!alvo,
    });
    portas.log?.({ evento: 'inbox_roteamento', outcome: r.ok ? 'ok' : 'recusado', threadId, aplicado: r.aplicado === true, origem: d.origem, banda: d.banda, confianca: d.confianca, setor: d.setorCodigo, automacao: d.automacao.modo, reavaliacao: reav, erro: r.erro, motivo: r.motivo });
    return { ok: r.ok, aplicado: r.aplicado === true, origem: d.origem, setorCodigo: d.setorCodigo, banda: d.banda, confianca: d.confianca, reavaliacao: reav, motivo: r.erro ?? r.motivo, classificado };
  } catch (e) {
    const motivo = ((e as Error).message ?? 'erro').slice(0, 160);
    portas.log?.({ evento: 'inbox_roteamento', outcome: 'falha', threadId, erro: motivo });
    return { ok: false, aplicado: false, classificado: false, motivo };
  }
}

// Persistencia do EIFF Inbox no Supabase (tabelas inbox_*, migration 0056). Mesmo desenho do Radar: leitura converte
// linhas em InboxDataset; escrita grava so as diferencas, na ordem das dependencias. Recebe os helpers do provider
// principal (nao cria ciclo de import e nao conhece o cliente do Supabase).
//
// Regras desta camada (docs/eiff-inbox.md § fase 2):
// - mensagem e evento sao INSERT-ONLY (o banco recusa update de conteudo e delete): nada aqui reescreve historia;
// - thread e atualizada SEM RETURNING: quem transfere uma conversa para fora do proprio recorte deixa de enxerga-la
//   e um `select` na volta seria recusado pelo RLS (o autor continua participante, entao na pratica segue vendo);
// - ids de app que nao sao uuid (modo local: THR-00001) so existem antes do primeiro insert; depois o mapa `refs`
//   traduz app id -> uuid, como no Radar;
// - o corpo da mensagem vai para inbox_message.body e para lugar nenhum mais (audit_log recebe ids e estados).
import { CONFIGURACAO_PADRAO, inboxVazio, type Atribuicao, type Classificacao, type ConfiguracaoInbox, type ContatoInbox, type Equipe, type InboxAction, type InboxDataset, type InboxJob, type InboxMessage, type InboxThread, type MembroSetor, type Setor, type ThreadEvent } from '../core/inbox';

type Row = Record<string, any>;
export interface HelpersInbox {
  sel: (tabela: string, ordem: string, comId?: boolean) => Promise<Row[]>;
  inserir: (tabela: string, rows: Row[]) => Promise<Row[]>;
  /** UPDATE por id SEM select na volta (ver cabecalho). */
  atualizar: (tabela: string, id: string, row: Row) => Promise<void>;
  gravarComposta: (tabela: string, chave: Record<string, string>, row: Row) => Promise<void>;
  apagar: (tabela: string, id: string) => Promise<void>;
  orgId: string;
  atorId: string;
  uuid: (v?: string) => string | null;
  perfil: (usuarioId?: string) => string | null;
  /** codigo da obra -> project.id e o inverso */
  obra: (codigo?: string) => string | null;
  obraCodigo: (id?: string | null) => string | undefined;
}

type Colecao = 'setores' | 'equipes' | 'membros' | 'contatos' | 'threads' | 'mensagens' | 'atribuicoes' | 'eventos' | 'acoes' | 'jobs';
const TABELA: Record<Colecao, string> = { setores: 'inbox_sector', equipes: 'inbox_team', membros: 'inbox_member', contatos: 'inbox_contact', threads: 'inbox_thread', mensagens: 'inbox_message', atribuicoes: 'inbox_assignment', eventos: 'inbox_thread_event', acoes: 'inbox_action', jobs: 'inbox_job' };

// mapa app id -> uuid por colecao (setores: codigo -> uuid). Preenchido na carga; ids novos entram apos o insert.
let refs: Map<Colecao, Map<string, string>> | null = null;
// a linha de inbox_config existe no banco? (primeira gravacao cria; depois so quando a configuracao muda)
let configExiste = false;
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const nn = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Registra um id ja gravado no banco (ex.: thread criada pela RPC inbox_ingest) para a persistencia nao reinserir. */
export function registrarRefInbox(colecao: Colecao, id: string): void { refs?.get(colecao)?.set(id, id); }

// ---------------------------------------------------------------------------------------------------------- leitura
export async function carregarInbox(h: Pick<HelpersInbox, 'sel' | 'orgId' | 'obraCodigo'>): Promise<InboxDataset> {
  const [sectors, teams, members, contacts, identities, threads, messages, assignments, events, actions, jobs, configs] = await Promise.all([
    h.sel('inbox_sector', 'sort_order'), h.sel('inbox_team', 'sort_order'), h.sel('inbox_member', 'created_at'), h.sel('inbox_contact', 'created_at'), h.sel('inbox_contact_identity', 'created_at'),
    h.sel('inbox_thread', 'opened_at'), h.sel('inbox_message', 'occurred_at'), h.sel('inbox_assignment', 'assigned_at'), h.sel('inbox_thread_event', 'occurred_at'), h.sel('inbox_action', 'created_at'), h.sel('inbox_job', 'created_at'),
    h.sel('inbox_config', 'organization_id', false),
  ]);
  const codigoDoSetor = new Map<string, string>(sectors.map((x) => [x.id, x.code]));
  refs = new Map<Colecao, Map<string, string>>([
    ['setores', new Map(sectors.map((x) => [x.code, x.id]))],
    ...(['equipes', 'membros', 'contatos', 'threads', 'mensagens', 'atribuicoes', 'eventos', 'acoes', 'jobs'] as const).map((c) => [c, new Map<string, string>()] as [Colecao, Map<string, string>]),
  ]);
  const marcar = (c: Colecao, rows: Row[]) => rows.forEach((x) => refs!.get(c)!.set(x.id, x.id));
  marcar('equipes', teams); marcar('membros', members); marcar('contatos', contacts); marcar('threads', threads); marcar('mensagens', messages); marcar('atribuicoes', assignments); marcar('eventos', events); marcar('acoes', actions); marcar('jobs', jobs);
  const identPor = new Map<string, Row[]>();
  for (const i of identities) identPor.set(i.contact_id, [...(identPor.get(i.contact_id) ?? []), i]);
  const cfgRow = configs[0];
  configExiste = !!cfgRow;
  const configuracao: ConfiguracaoInbox = cfgRow ? {
    setorFallback: cfgRow.fallback_sector_code, setorEscalacao: cfgRow.escalation_sector_code,
    slaHorasPorPrioridade: { ...CONFIGURACAO_PADRAO.slaHorasPorPrioridade, ...(cfgRow.sla_hours ?? {}) }, nivelPadrao: cfgRow.default_level,
    regrasNivel: Array.isArray(cfgRow.level_rules) && cfgRow.level_rules.length ? cfgRow.level_rules : CONFIGURACAO_PADRAO.regrasNivel,
    regrasRoteamento: Array.isArray(cfgRow.routing_rules) && cfgRow.routing_rules.length ? cfgRow.routing_rules : CONFIGURACAO_PADRAO.regrasRoteamento,
  } : CONFIGURACAO_PADRAO;
  const ator = (x: Row) => ({ tipo: x.actor_kind ?? x.proposed_by_kind, id: s(x.actor_id ?? x.proposed_by_id), nome: x.actor_name ?? x.proposed_by_name ?? '—' });
  return {
    ...inboxVazio(),
    origem: sectors.length || threads.length ? 'remoto' : 'vazio',
    configuracao,
    setores: sectors.map<Setor>((x) => ({ codigo: x.code, nome: x.name, ativo: !!x.active, ordem: Number(x.sort_order ?? 0), responsavelPadraoId: s(x.default_assignee_id) })),
    equipes: teams.map<Equipe>((x) => ({ id: x.id, setorCodigo: codigoDoSetor.get(x.sector_id) ?? '', nome: x.name, ativo: !!x.active, ordem: Number(x.sort_order ?? 0), responsavelPadraoId: s(x.default_assignee_id) })),
    membros: members.map<MembroSetor>((x) => ({ id: x.id, usuarioId: x.profile_id, setorCodigo: codigoDoSetor.get(x.sector_id) ?? '', equipeId: s(x.team_id), papel: x.member_role })),
    contatos: contacts.map<ContatoInbox>((x) => ({
      id: x.id, nome: x.name, empresaNome: s(x.company_name), tipoRelacao: x.relation_kind, contatoRadarId: s(x.radar_contact_id), empresaRadarId: s(x.radar_company_id), colaboradorId: s(x.worker_id), usuarioId: s(x.profile_id),
      obras: x.project_codes ?? [], observacoes: s(x.notes), criadoEm: x.created_at,
      identidades: (identPor.get(x.id) ?? []).map((i) => ({ canal: i.channel, identificador: i.identifier, nomeInformado: s(i.display_name), verificada: !!i.verified })),
    })),
    threads: threads.map<InboxThread>((x) => ({
      id: x.id, canal: x.channel, provider: x.provider, contexto: x.context, contatoId: x.contact_id, conversaCentralId: s(x.central_conversation_id), externalConversationId: s(x.external_conversation_id),
      assunto: x.subject, status: x.status, prioridade: x.priority, nivel: x.service_level, setorCodigo: x.sector_id ? codigoDoSetor.get(x.sector_id) : undefined, equipeId: s(x.team_id), responsavelId: s(x.assignee_id),
      participantes: x.participant_ids ?? [], codigoObra: h.obraCodigo(x.project_id), labels: x.labels ?? [], classificacao: (x.classification as Classificacao | null) ?? undefined, resumo: s(x.summary),
      sla: x.sla_first_response_due ? { primeiraRespostaAte: x.sla_first_response_due, primeiraRespostaEm: s(x.sla_first_response_at), resolucaoAte: s(x.sla_resolution_due) } : undefined,
      abertaEm: x.opened_at, ultimaMensagemEm: x.last_message_at, ultimaInboundEm: s(x.last_inbound_at), resolvidaEm: s(x.resolved_at), fechadaEm: s(x.closed_at), resolvidaPor: s(x.resolved_by) as InboxThread['resolvidaPor'], origem: x.origin ?? 'MANUAL',
    })),
    mensagens: messages.map<InboxMessage>((x) => ({
      id: x.id, threadId: x.thread_id, provider: x.provider, direcao: x.direction, tipo: x.content_type, autor: { tipo: x.sender_kind, id: s(x.sender_id), nome: x.sender_name }, texto: x.body, anexos: x.attachments ?? [], em: x.occurred_at,
      externalMessageId: s(x.external_message_id), replyToExternalId: s(x.reply_to_external_id), mensagemCentralId: s(x.central_message_id), entrega: s(x.delivery_state) as InboxMessage['entrega'], propostaId: s(x.proposal_id), meta: x.meta && Object.keys(x.meta).length ? x.meta : undefined,
    })),
    atribuicoes: assignments.map<Atribuicao>((x) => ({ id: x.id, threadId: x.thread_id, setorCodigo: x.sector_id ? codigoDoSetor.get(x.sector_id) : undefined, equipeId: s(x.team_id), usuarioId: s(x.assignee_id), atribuidaEm: x.assigned_at, liberadaEm: s(x.released_at), motivo: s(x.reason), origem: x.origin, atorId: s(x.actor_id) })),
    eventos: events.map<ThreadEvent>((x) => ({ id: x.id, threadId: x.thread_id, mensagemId: s(x.message_id), tipo: x.event_type, em: x.occurred_at, ator: ator(x), detalhe: x.detail, antes: s(x.before_value), depois: s(x.after_value) })),
    acoes: actions.map<InboxAction>((x) => ({
      id: x.id, threadId: x.thread_id, tipo: x.action_kind, titulo: x.title, descricao: x.description ?? '', parametros: x.params ?? {}, estado: x.state,
      aprovacao: { exigida: !!x.approval_required, papelDecisor: s(x.approver_role), decisao: s(x.decision) as InboxAction['aprovacao']['decisao'], decididaPor: s(x.decided_by), decididaEm: s(x.decided_at), motivo: s(x.decision_reason) },
      propostaPor: ator(x), criadaEm: x.created_at, executadaEm: s(x.executed_at), jobId: s(x.job_id), referencia: s(x.reference),
    })),
    jobs: jobs.map<InboxJob>((x) => ({ id: x.id, threadId: x.thread_id, acaoId: x.action_id, titulo: x.title, objetivo: x.objective ?? '', contexto: x.context ?? [], criteriosAceite: x.acceptance_criteria ?? [], provider: x.provider, estado: x.state, referenciaExterna: s(x.external_ref), resultado: x.result ?? undefined, criadoEm: x.created_at, criadoPor: x.created_by ?? '' })),
  };
}

// ---------------------------------------------------------------------------------------------------------- escrita
export async function persistirInbox(h: HelpersInbox, antes: InboxDataset | undefined, depois: InboxDataset | undefined): Promise<void> {
  if (!depois || !refs) return;
  const a = antes ?? inboxVazio();
  const ref = (c: Colecao, id?: string): string | null => (id ? refs!.get(c)?.get(id) ?? h.uuid(id) : null);
  const setorId = (codigo?: string) => (codigo ? refs!.get('setores')!.get(codigo) ?? null : null);
  const mudados = <T extends { id: string }>(c: Exclude<Colecao, 'setores'>): { novos: T[]; alterados: T[] } => {
    const antigos = new Map(((a[c] ?? []) as unknown as T[]).map((x) => [x.id, x]));
    const mapa = refs!.get(c)!;
    const lista = (depois[c] ?? []) as unknown as T[];
    return { novos: lista.filter((x) => !mapa.has(x.id)), alterados: lista.filter((x) => mapa.has(x.id) && antigos.has(x.id) && !igual(antigos.get(x.id), x)) };
  };
  const inserirNovos = async <T extends { id: string }>(c: Exclude<Colecao, 'setores'>, novos: T[], row: (x: T) => Row) => {
    if (!novos.length) return;
    const data = await h.inserir(TABELA[c], novos.map((x) => ({ organization_id: h.orgId, ...row(x) })));
    novos.forEach((x, i) => { if (data[i]?.id) refs!.get(c)!.set(x.id, data[i].id); });
  };
  const atualizarAlterados = async <T extends { id: string }>(c: Exclude<Colecao, 'setores'>, alterados: T[], row: (x: T) => Row) => {
    for (const x of alterados) await h.atualizar(TABELA[c], refs!.get(c)!.get(x.id)!, row(x));
  };

  // 1) setores (chave = codigo)
  const setoresAntes = new Map(a.setores.map((x) => [x.codigo, x]));
  for (const st of depois.setores) {
    const id = refs.get('setores')!.get(st.codigo);
    const row = { code: st.codigo, name: st.nome, active: st.ativo, sort_order: st.ordem, default_assignee_id: h.perfil(st.responsavelPadraoId) };
    if (!id) { const data = await h.inserir('inbox_sector', [{ organization_id: h.orgId, ...row }]); if (data[0]?.id) refs.get('setores')!.set(st.codigo, data[0].id); }
    else if (!igual(setoresAntes.get(st.codigo), st)) await h.atualizar('inbox_sector', id, row);
  }
  // 2) equipes
  const eq = mudados<Equipe>('equipes');
  const equipeRow = (e: Equipe): Row => ({ sector_id: setorId(e.setorCodigo), name: e.nome, active: e.ativo, sort_order: e.ordem, default_assignee_id: h.perfil(e.responsavelPadraoId) });
  await inserirNovos('equipes', eq.novos, equipeRow); await atualizarAlterados('equipes', eq.alterados, equipeRow);
  // 3) membros (unica colecao com delete)
  const mb = mudados<MembroSetor>('membros');
  const membroRow = (m: MembroSetor): Row => ({ profile_id: h.perfil(m.usuarioId) ?? h.atorId, sector_id: setorId(m.setorCodigo), team_id: ref('equipes', m.equipeId), member_role: m.papel });
  await inserirNovos('membros', mb.novos, membroRow); await atualizarAlterados('membros', mb.alterados, membroRow);
  const membrosDepois = new Set(depois.membros.map((x) => x.id));
  for (const m of a.membros.filter((x) => !membrosDepois.has(x.id) && refs!.get('membros')!.has(x.id))) { await h.apagar('inbox_member', refs.get('membros')!.get(m.id)!); refs.get('membros')!.delete(m.id); }
  // 4) contatos + identidades
  const ct = mudados<ContatoInbox>('contatos');
  const contatoRow = (c: ContatoInbox): Row => ({ name: c.nome, company_name: nn(c.empresaNome), relation_kind: c.tipoRelacao, radar_contact_id: h.uuid(c.contatoRadarId), radar_company_id: h.uuid(c.empresaRadarId), worker_id: h.uuid(c.colaboradorId), profile_id: h.perfil(c.usuarioId), project_codes: c.obras, notes: nn(c.observacoes) });
  await inserirNovos('contatos', ct.novos, contatoRow); await atualizarAlterados('contatos', ct.alterados, contatoRow);
  for (const c of [...ct.novos, ...ct.alterados]) {
    const cid = refs.get('contatos')!.get(c.id); if (!cid) continue;
    for (const i of c.identidades) await h.gravarComposta('inbox_contact_identity', { organization_id: h.orgId, channel: i.canal, identifier: i.identificador }, { contact_id: cid, display_name: nn(i.nomeInformado), verified: i.verificada });
  }
  // 5) threads (update sem select)
  const th = mudados<InboxThread>('threads');
  const threadRow = (t: InboxThread): Row => ({
    channel: t.canal, provider: t.provider, context: t.contexto, contact_id: ref('contatos', t.contatoId), central_conversation_id: h.uuid(t.conversaCentralId), external_conversation_id: nn(t.externalConversationId), subject: t.assunto.slice(0, 200),
    status: t.status, priority: t.prioridade, service_level: t.nivel, sector_id: setorId(t.setorCodigo), team_id: ref('equipes', t.equipeId), assignee_id: h.perfil(t.responsavelId),
    participant_ids: t.participantes.map((p) => h.perfil(p)).filter((p): p is string => !!p), project_id: h.obra(t.codigoObra), labels: t.labels, classification: t.classificacao ?? null, summary: nn(t.resumo?.slice(0, 600)),
    sla_first_response_due: nn(t.sla?.primeiraRespostaAte), sla_first_response_at: nn(t.sla?.primeiraRespostaEm), sla_resolution_due: nn(t.sla?.resolucaoAte),
    opened_at: t.abertaEm, last_message_at: t.ultimaMensagemEm, last_inbound_at: nn(t.ultimaInboundEm), resolved_at: nn(t.resolvidaEm), closed_at: nn(t.fechadaEm), resolved_by: nn(t.resolvidaPor), origin: t.origem,
  });
  await inserirNovos('threads', th.novos, threadRow); await atualizarAlterados('threads', th.alterados, threadRow);
  // 6) acoes (passo 1: job_id so quando o job ja existe)
  const ac = mudados<InboxAction>('acoes');
  const acaoRow = (x: InboxAction): Row => ({
    thread_id: ref('threads', x.threadId), action_kind: x.tipo, title: x.titulo.slice(0, 200), description: x.descricao, params: x.parametros, state: x.estado, approval_required: x.aprovacao.exigida, approver_role: nn(x.aprovacao.papelDecisor),
    decision: nn(x.aprovacao.decisao), decided_by: x.aprovacao.decisao ? h.perfil(x.aprovacao.decididaPor) ?? h.atorId : null, decided_at: x.aprovacao.decisao ? x.aprovacao.decididaEm ?? new Date().toISOString() : null, decision_reason: nn(x.aprovacao.motivo),
    proposed_by_kind: x.propostaPor.tipo, proposed_by_id: nn(x.propostaPor.id), proposed_by_name: x.propostaPor.nome, executed_at: nn(x.executadaEm), job_id: ref('jobs', x.jobId), reference: nn(x.referencia),
  });
  await inserirNovos('acoes', ac.novos, acaoRow); await atualizarAlterados('acoes', ac.alterados, acaoRow);
  // 7) mensagens (insert-only: o banco garante a imutabilidade)
  const ms = mudados<InboxMessage>('mensagens');
  await inserirNovos('mensagens', ms.novos, (m) => ({
    thread_id: ref('threads', m.threadId), provider: m.provider, direction: m.direcao, content_type: m.tipo, sender_kind: m.autor.tipo, sender_id: nn(m.autor.tipo === 'usuario' ? h.perfil(m.autor.id) ?? m.autor.id : m.autor.tipo === 'contato' ? ref('contatos', m.autor.id) ?? m.autor.id : m.autor.id), sender_name: m.autor.nome,
    body: m.texto, attachments: m.anexos, external_message_id: nn(m.externalMessageId), reply_to_external_id: nn(m.replyToExternalId), central_message_id: h.uuid(m.mensagemCentralId), occurred_at: m.em, delivery_state: nn(m.entrega), proposal_id: ref('acoes', m.propostaId), meta: m.meta ?? {},
  }));
  // 8) jobs, depois o job_id das acoes que acabaram de ganhar job
  const jb = mudados<InboxJob>('jobs');
  const jobRow = (j: InboxJob): Row => ({ thread_id: ref('threads', j.threadId), action_id: ref('acoes', j.acaoId), title: j.titulo.slice(0, 200), objective: j.objetivo, context: j.contexto, acceptance_criteria: j.criteriosAceite, provider: j.provider, state: j.estado, external_ref: nn(j.referenciaExterna), result: j.resultado ?? null, created_by: h.perfil(j.criadoPor) ?? h.atorId });
  await inserirNovos('jobs', jb.novos, jobRow); await atualizarAlterados('jobs', jb.alterados, jobRow);
  for (const j of jb.novos) { const acao = depois.acoes.find((x) => x.jobId === j.id); const aid = acao ? refs.get('acoes')!.get(acao.id) : undefined; if (aid) await h.atualizar('inbox_action', aid, { job_id: ref('jobs', j.id) }); }
  // 9) atribuicoes (historico: nova = insert; a vigente que fechou = update de released_at)
  const at = mudados<Atribuicao>('atribuicoes');
  const atrRow = (x: Atribuicao): Row => ({ thread_id: ref('threads', x.threadId), sector_id: setorId(x.setorCodigo), team_id: ref('equipes', x.equipeId), assignee_id: h.perfil(x.usuarioId), assigned_at: x.atribuidaEm, released_at: nn(x.liberadaEm), reason: nn(x.motivo), origin: x.origem, actor_id: h.perfil(x.atorId) });
  await inserirNovos('atribuicoes', at.novos, atrRow); await atualizarAlterados('atribuicoes', at.alterados, atrRow);
  // 10) eventos (append-only)
  const ev = mudados<ThreadEvent>('eventos');
  await inserirNovos('eventos', ev.novos, (e) => ({ thread_id: ref('threads', e.threadId), message_id: ref('mensagens', e.mensagemId), event_type: e.tipo, occurred_at: e.em, actor_kind: e.ator.tipo, actor_id: nn(e.ator.tipo === 'usuario' ? h.perfil(e.ator.id) ?? e.ator.id : e.ator.id), actor_name: e.ator.nome, detail: e.detalhe.slice(0, 500), before_value: nn(e.antes?.slice(0, 200)), after_value: nn(e.depois?.slice(0, 200)) }));
  // 11) configuracao (uma linha por organizacao)
  if (!configExiste || !igual(a.configuracao, depois.configuracao)) {
    const c = depois.configuracao;
    await h.gravarComposta('inbox_config', { organization_id: h.orgId }, { fallback_sector_code: c.setorFallback, escalation_sector_code: c.setorEscalacao, sla_hours: c.slaHorasPorPrioridade, default_level: c.nivelPadrao, level_rules: c.regrasNivel, routing_rules: c.regrasRoteamento });
    configExiste = true;
  }
}

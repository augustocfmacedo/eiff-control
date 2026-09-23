-- EIFF Inbox — persistencia operacional (fase 2). Espelha src/core/inbox (tipos.ts, estados.ts, roteamento.ts, fronteiras.ts).
--
-- Dependencias: 0001 (organization, profile, project, role_kind, touch_updated_at), 0003 (current_org, has_role), 0008 (worker),
-- 0031 (radar_contact, radar_company). NAO depende de 0049..0051 (EIFF Central): as colunas central_conversation_id e
-- central_message_id sao referencias LOGICAS, sem FK, para que o Inbox possa ser aplicado antes ou depois da Central.
--
-- O que o banco garante (nao so o codigo):
--   1) IDEMPOTENCIA da entrada: unique (organization_id, provider, external_message_id) em inbox_message e a funcao
--      inbox_ingest (server-only) que deduplica, resolve identidade -> contato, reusa/reabre/abre a thread e grava
--      mensagem + eventos numa transacao so. Reenvio do provider (a Meta reenvia ate receber 200) nunca vira segunda
--      mensagem, segunda thread nem segunda acao;
--   2) uma identidade de canal (canal + identificador normalizado) pertence a UM contato por organizacao; o contato
--      NAO e acoplado ao numero de WhatsApp: pessoa -> n identidades (whatsapp, e-mail, portal...);
--   3) inbox_thread_event e APPEND-ONLY (triggers recusam update e delete) e o detalhe e curto (<= 500) e nunca
--      contem sequencia longa de digitos: historico operacional, nao copia da mensagem;
--   4) a MENSAGEM e imutavel no que veio do canal (corpo, direcao, thread, remetente, ids externos, ocorrencia);
--      so o estado de entrega e a meta segura evoluem. meta e attachments nunca carregam segredo/cabecalho
--      (CHECK por chave profunda);
--   5) classificacao persistida como jsonb operacional (intencao, entidades, recomendacoes, confianca, sinais e
--      trechos de evidencia) — sem raciocinio encadeado; chaves sensiveis proibidas por CHECK;
--   6) RLS por organizacao E por recorte de setor: Administrador/Diretoria veem tudo; os demais veem as threads dos
--      setores em que sao membros, as que lhes foram atribuidas, de que participam (escreveram/decidiram), as ainda sem
--      setor (triagem) e as que ENCAMINHARAM enquanto a atribuicao que fizeram estiver vigente (inbox_encaminhei).
--      Filhos (mensagem, evento, atribuicao, acao, job) HERDAM a visibilidade da thread por EXISTS. Configuracao
--      (setor, equipe, membro, regras) so Administrador/Diretoria escrevem — a mesma matriz de src/core/permissoes.ts
--      (`inbox` e `inbox_config`), nunca uma segunda ACL;
--   7) auditoria: audit_log continua recebendo so ids/estados pela aplicacao; nenhum trigger copia corpo de mensagem.
-- Migration idempotente: pode ser aplicada mais de uma vez.

-- ---------------------------------------------------------------------------------------------------------------
-- 0) helpers
-- ---------------------------------------------------------------------------------------------------------------
-- papeis com a permissao `inbox` (src/core/permissoes.ts). Mudou a matriz, muda aqui: o teste em src/ prende a lista.
create or replace function inbox_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade')
$$;
create or replace function inbox_config_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria')
$$;
-- chave profunda proibida em jsonb (mesma ideia de 0039). Recriada aqui por seguranca de ordem (0039 ja a define).
create or replace function jsonb_tem_chave_profunda(j jsonb, chaves text[]) returns boolean language sql immutable as $$
  select case jsonb_typeof(j)
    when 'object' then exists (select 1 from jsonb_each(j) e where e.key = any (chaves) or jsonb_tem_chave_profunda(e.value, chaves))
    when 'array' then exists (select 1 from jsonb_array_elements(j) a where jsonb_tem_chave_profunda(a, chaves))
    else false end
$$;
create or replace function inbox_jsonb_seguro(j jsonb) returns boolean language sql immutable as $$
  select j is null or not jsonb_tem_chave_profunda(j, array['authorization','token','access_token','secret','api_key','apikey','password','senha','cookie','headers','raw_payload','bruto'])
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) setores, equipes, membros, configuracao
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_sector (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  default_assignee_id uuid references profile(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint inbox_sector_code_uk unique (organization_id, code)
);
create table if not exists inbox_team (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  sector_id uuid not null references inbox_sector(id),
  name text not null check (length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  default_assignee_id uuid references profile(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint inbox_team_nome_uk unique (organization_id, sector_id, name)
);
-- membro de um SETOR, opcionalmente dentro de uma equipe. Roteamento e visibilidade sao por setor; a equipe refina.
create table if not exists inbox_member (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  profile_id uuid not null references profile(id),
  sector_id uuid not null references inbox_sector(id),
  team_id uuid references inbox_team(id),
  member_role text not null default 'atendente' check (member_role in ('atendente', 'gestor')),
  created_at timestamptz not null default now()
);
create unique index if not exists inbox_member_uk on inbox_member (organization_id, profile_id, sector_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists inbox_member_profile_idx on inbox_member (profile_id, sector_id);
-- uma linha por organizacao: fallback, escalacao, SLA e regras (as regras sao dados, editaveis pela tela de configuracao)
create table if not exists inbox_config (
  organization_id uuid primary key references organization(id),
  fallback_sector_code text not null default 'ADMINISTRATIVO',
  escalation_sector_code text not null default 'DIRETORIA',
  sla_hours jsonb not null default '{"Urgente":1,"Alta":4,"Normal":24,"Baixa":72}'::jsonb,
  default_level text not null default 'B' check (default_level in ('A', 'B', 'C')),
  level_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(level_rules) = 'array'),
  routing_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(routing_rules) = 'array'),
  updated_at timestamptz not null default now(),
  version integer not null default 0
);

-- ---------------------------------------------------------------------------------------------------------------
-- 2) contato e identidades de canal (pessoa -> n identidades; nunca acoplada ao WhatsApp)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_contact (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null check (length(name) between 1 and 160),
  company_name text check (company_name is null or length(company_name) <= 160),
  relation_kind text not null default 'desconhecido' check (relation_kind in ('cliente', 'fornecedor', 'parceiro', 'prestador', 'lead', 'equipe_externa', 'colaborador', 'desconhecido')),
  radar_contact_id uuid references radar_contact(id),
  radar_company_id uuid references radar_company(id),
  worker_id uuid references worker(id),
  profile_id uuid references profile(id),
  project_codes text[] not null default '{}',
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0
);
create table if not exists inbox_contact_identity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  contact_id uuid not null references inbox_contact(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP', 'EMAIL', 'PORTAL', 'WEBCHAT', 'SISTEMA')),
  -- normalizado: E.164 sem "+" (WHATSAPP), e-mail em minusculas, id de sessao/usuario nos demais
  identifier text not null check (length(identifier) between 1 and 200),
  display_name text check (display_name is null or length(display_name) <= 120),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint inbox_contact_identity_uk unique (organization_id, channel, identifier)
);
create index if not exists inbox_contact_identity_contato_idx on inbox_contact_identity (contact_id);

-- ---------------------------------------------------------------------------------------------------------------
-- 3) thread (unidade central), mensagem, atribuicao, evento
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_thread (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  channel text not null check (channel in ('WHATSAPP', 'EMAIL', 'PORTAL', 'WEBCHAT', 'SISTEMA')),
  provider text not null check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD')),
  context text not null check (context in ('INTERNAL', 'EXTERNAL')),
  contact_id uuid not null references inbox_contact(id),
  central_conversation_id uuid,        -- referencia logica a central_conversation (0050), sem FK de proposito
  external_conversation_id text,
  subject text not null check (length(subject) between 1 and 200),
  status text not null default 'NOVA' check (status in ('NOVA', 'TRIADA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA')),
  priority text not null default 'Normal' check (priority in ('Baixa', 'Normal', 'Alta', 'Urgente')),
  service_level text not null default 'C' check (service_level in ('A', 'B', 'C')),
  sector_id uuid references inbox_sector(id),
  team_id uuid references inbox_team(id),
  assignee_id uuid references profile(id),
  participant_ids uuid[] not null default '{}',
  project_id uuid references project(id),
  labels text[] not null default '{}',
  classification jsonb check (classification is null or (jsonb_typeof(classification) = 'object' and inbox_jsonb_seguro(classification))),
  summary text check (summary is null or length(summary) <= 600),
  sla_first_response_due timestamptz,
  sla_first_response_at timestamptz,
  sla_resolution_due timestamptz,
  opened_at timestamptz not null,
  last_message_at timestamptz not null,
  last_inbound_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolved_by text check (resolved_by is null or resolved_by in ('ia', 'humano')),
  origin text not null default 'MANUAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint inbox_thread_resolvida_chk check (status not in ('RESOLVIDA', 'FECHADA') or resolved_at is not null),
  constraint inbox_thread_fechada_chk check (status <> 'FECHADA' or closed_at is not null),
  constraint inbox_thread_atribuida_chk check (status <> 'ATRIBUIDA' or assignee_id is not null)
);
create index if not exists inbox_thread_org_status_idx on inbox_thread (organization_id, status, last_message_at desc);
create index if not exists inbox_thread_contato_idx on inbox_thread (organization_id, contact_id, channel, context, last_message_at desc);
create index if not exists inbox_thread_setor_idx on inbox_thread (organization_id, sector_id, status);
create index if not exists inbox_thread_responsavel_idx on inbox_thread (organization_id, assignee_id, status);
-- a politica testa `auth.uid() = any (participant_ids)`: GIN no array
create index if not exists inbox_thread_participantes_idx on inbox_thread using gin (participant_ids);

create table if not exists inbox_message (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  provider text not null check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD')),
  direction text not null check (direction in ('inbound', 'outbound', 'interna')),
  content_type text not null default 'texto' check (content_type in ('texto', 'imagem', 'documento', 'audio', 'nota')),
  sender_kind text not null check (sender_kind in ('contato', 'usuario', 'ia', 'sistema')),
  sender_id text,
  sender_name text not null check (length(sender_name) between 1 and 160),
  -- conteudo OPERACIONAL: o texto como chegou (ou como foi registrado). Retencao e decisao do Inbox (docs/eiff-inbox.md).
  body text not null check (length(body) <= 20000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and inbox_jsonb_seguro(attachments)),
  external_message_id text,
  reply_to_external_id text,
  central_message_id uuid,             -- referencia logica a central_message (0050), sem FK de proposito
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  delivery_state text check (delivery_state is null or delivery_state in ('registrada', 'enviada', 'entregue', 'lida', 'falhou')),
  proposal_id uuid,                    -- acao (sugestao da IA) que originou esta saida, quando houver
  -- metadados TECNICOS seguros (ids do provider, tipo original, janela): nunca segredo, cabecalho ou payload bruto
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and inbox_jsonb_seguro(meta)),
  body_search tsvector generated always as (to_tsvector('portuguese', coalesce(body, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0
);
-- 1) idempotencia no BANCO: a mesma mensagem externa entra uma vez so
create unique index if not exists inbox_message_externa_uk on inbox_message (organization_id, provider, external_message_id) where external_message_id is not null;
create index if not exists inbox_message_thread_idx on inbox_message (thread_id, occurred_at);
create index if not exists inbox_message_busca_idx on inbox_message using gin (body_search);

-- historico de atribuicao: quem/onde a thread esteve, de quando ate quando, por que e por qual origem
create table if not exists inbox_assignment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  sector_id uuid references inbox_sector(id),
  team_id uuid references inbox_team(id),
  assignee_id uuid references profile(id),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  reason text check (reason is null or length(reason) <= 500),
  origin text not null check (origin in ('roteamento', 'triagem', 'manual', 'escalacao', 'sistema')),
  actor_id uuid references profile(id),
  created_at timestamptz not null default now()
);
create index if not exists inbox_assignment_thread_idx on inbox_assignment (thread_id, assigned_at desc);
-- inbox_encaminhei(): atribuicao vigente feita por mim
create index if not exists inbox_assignment_ator_idx on inbox_assignment (actor_id, thread_id) where released_at is null;

-- eventos da thread: append-only, curtos, sem corpo de mensagem
create table if not exists inbox_thread_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  message_id uuid references inbox_message(id),
  event_type text not null check (event_type in (
    'THREAD_CREATED', 'THREAD_REOPENED', 'MESSAGE_RECEIVED', 'MESSAGE_REGISTERED', 'NOTE_ADDED', 'AI_ANALYZED', 'TRIAGED', 'ROUTED',
    'ASSIGNED', 'REASSIGNED', 'RELEASED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'LABELS_CHANGED', 'SLA_ESCALATED',
    'ACTION_PROPOSED', 'ACTION_APPROVED', 'ACTION_REJECTED', 'ACTION_EXECUTED', 'JOB_CREATED', 'JOB_COMPLETED', 'JOB_FAILED',
    'RESOLVED', 'CLOSED')),
  occurred_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('contato', 'usuario', 'ia', 'sistema')),
  actor_id text,
  actor_name text not null check (length(actor_name) between 1 and 160),
  -- 3) detalhe SEGURO: curto e sem sequencia longa de digitos (telefone nunca inteiro)
  detail text not null check (length(detail) <= 500 and detail !~ '[0-9]{9,}'),
  before_value text check (before_value is null or length(before_value) <= 200),
  after_value text check (after_value is null or length(after_value) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists inbox_thread_event_thread_idx on inbox_thread_event (thread_id, occurred_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 4) acao (com aprovacao embutida), job (com resultado e evidencias)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_action (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  action_kind text not null check (action_kind in ('responder', 'encaminhar', 'criar_tarefa', 'consultar_sistema', 'registrar_previsao', 'criar_job')),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and inbox_jsonb_seguro(params)),
  state text not null default 'proposta' check (state in ('proposta', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 'executada', 'falhou')),
  approval_required boolean not null default false,
  approver_role text,
  decision text check (decision is null or decision in ('aprovada', 'rejeitada')),
  decided_by uuid references profile(id),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 500),
  proposed_by_kind text not null check (proposed_by_kind in ('contato', 'usuario', 'ia', 'sistema')),
  proposed_by_id text,
  proposed_by_name text not null,
  executed_at timestamptz,
  job_id uuid,                          -- referencia logica ao job (o job tem FK para a acao)
  reference text check (reference is null or length(reference) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  constraint inbox_action_decisao_chk check (decision is null or (decided_by is not null and decided_at is not null))
);
create index if not exists inbox_action_thread_idx on inbox_action (thread_id, created_at);

create table if not exists inbox_job (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  action_id uuid not null references inbox_action(id),
  title text not null check (length(title) between 1 and 200),
  objective text not null default '',
  context text[] not null default '{}',
  acceptance_criteria text[] not null default '{}',
  provider text not null check (provider in ('MANUAL', 'FACTORY')),
  state text not null default 'RASCUNHO' check (state in ('RASCUNHO', 'ENVIADO', 'EM_EXECUCAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO')),
  external_ref text,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and inbox_jsonb_seguro(result))),
  created_by uuid references profile(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0
);
create index if not exists inbox_job_thread_idx on inbox_job (thread_id, created_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 5) triggers: touch, append-only, imutabilidade da mensagem, coerencia
-- ---------------------------------------------------------------------------------------------------------------
do $t$ declare tb text; begin
  foreach tb in array array['inbox_sector', 'inbox_team', 'inbox_config', 'inbox_contact', 'inbox_thread', 'inbox_message', 'inbox_action', 'inbox_job'] loop
    execute format('drop trigger if exists %I_touch on %I', tb, tb);
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', tb, tb);
  end loop;
end $t$;

create or replace function inbox_evento_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'evento do Inbox é imutável (%): não pode ser alterado nem apagado', tg_op;
end $$;
drop trigger if exists inbox_thread_event_no_update on inbox_thread_event;
create trigger inbox_thread_event_no_update before update on inbox_thread_event for each row execute function inbox_evento_imutavel();
drop trigger if exists inbox_thread_event_no_delete on inbox_thread_event;
create trigger inbox_thread_event_no_delete before delete on inbox_thread_event for each row execute function inbox_evento_imutavel();

-- 4) a mensagem nao muda no que veio do canal; so entrega e meta evoluem
create or replace function inbox_mensagem_imutavel() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.thread_id is distinct from old.thread_id
     or new.provider is distinct from old.provider or new.direction is distinct from old.direction
     or new.content_type is distinct from old.content_type or new.sender_kind is distinct from old.sender_kind
     or new.sender_id is distinct from old.sender_id or new.body is distinct from old.body
     or new.attachments is distinct from old.attachments or new.external_message_id is distinct from old.external_message_id
     or new.reply_to_external_id is distinct from old.reply_to_external_id or new.occurred_at is distinct from old.occurred_at
     or new.received_at is distinct from old.received_at or new.created_at is distinct from old.created_at then
    raise exception 'mensagem do Inbox é imutável no conteúdo (id %): só entrega e meta evoluem', old.id;
  end if;
  return new;
end $$;
drop trigger if exists inbox_message_imutavel on inbox_message;
create trigger inbox_message_imutavel before update on inbox_message for each row execute function inbox_mensagem_imutavel();
create or replace function inbox_mensagem_no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'mensagem do Inbox não pode ser apagada (id %)', old.id;
end $$;
drop trigger if exists inbox_message_no_delete on inbox_message;
create trigger inbox_message_no_delete before delete on inbox_message for each row execute function inbox_mensagem_no_delete();

-- coerencia: filhos vivem na organizacao da thread; setor/equipe/responsavel da mesma organizacao
create or replace function inbox_coerencia_filho() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select organization_id into v_org from inbox_thread where id = new.thread_id;
  if v_org is null then raise exception 'thread % não encontrada', new.thread_id; end if;
  if v_org <> new.organization_id then raise exception 'linha de outra organização (thread %)', new.thread_id; end if;
  return new;
end $$;
do $t$ declare tb text; begin
  foreach tb in array array['inbox_message', 'inbox_assignment', 'inbox_thread_event', 'inbox_action', 'inbox_job'] loop
    execute format('drop trigger if exists %I_coerencia on %I', tb, tb);
    execute format('create trigger %I_coerencia before insert or update on %I for each row execute function inbox_coerencia_filho()', tb, tb);
  end loop;
end $t$;
create or replace function inbox_thread_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from inbox_contact c where c.id = new.contact_id and c.organization_id = new.organization_id) then
    raise exception 'contato % não pertence à organização da thread', new.contact_id;
  end if;
  if new.sector_id is not null and not exists (select 1 from inbox_sector s where s.id = new.sector_id and s.organization_id = new.organization_id) then
    raise exception 'setor % não pertence à organização da thread', new.sector_id;
  end if;
  if new.team_id is not null and not exists (select 1 from inbox_team t where t.id = new.team_id and t.organization_id = new.organization_id and (new.sector_id is null or t.sector_id = new.sector_id)) then
    raise exception 'equipe % não pertence ao setor/organização da thread', new.team_id;
  end if;
  if new.assignee_id is not null and not exists (select 1 from profile p where p.id = new.assignee_id and p.organization_id = new.organization_id) then
    raise exception 'responsável % não pertence à organização da thread', new.assignee_id;
  end if;
  return new;
end $$;
drop trigger if exists inbox_thread_coerencia on inbox_thread;
create trigger inbox_thread_coerencia before insert or update on inbox_thread for each row execute function inbox_thread_coerencia();
create or replace function inbox_member_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from profile p where p.id = new.profile_id and p.organization_id = new.organization_id) then
    raise exception 'perfil % não pertence à organização', new.profile_id;
  end if;
  if not exists (select 1 from inbox_sector s where s.id = new.sector_id and s.organization_id = new.organization_id) then
    raise exception 'setor % não pertence à organização', new.sector_id;
  end if;
  if new.team_id is not null and not exists (select 1 from inbox_team t where t.id = new.team_id and t.sector_id = new.sector_id) then
    raise exception 'equipe % não é do setor informado', new.team_id;
  end if;
  return new;
end $$;
drop trigger if exists inbox_member_coerencia on inbox_member;
create trigger inbox_member_coerencia before insert or update on inbox_member for each row execute function inbox_member_coerencia();

-- ---------------------------------------------------------------------------------------------------------------
-- 6) ingestao server-only (a porta unica da entrada de canal; espelha receberMensagem em src/core/inbox/fronteiras.ts)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function inbox_ingest(
  p_organization_id uuid, p_provider text, p_channel text, p_context text,
  p_identifier text, p_display_name text, p_external_message_id text, p_external_conversation_id text,
  p_body text, p_content_type text, p_occurred_at timestamptz,
  p_reply_to_external_id text default null, p_central_conversation_id uuid default null, p_central_message_id uuid default null,
  p_attachments jsonb default '[]'::jsonb, p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_contact uuid; v_contact_name text; v_new_contact boolean := false;
  v_thread inbox_thread; v_new_thread boolean := false; v_reopened boolean := false;
  v_msg uuid; v_existing inbox_message; v_cfg inbox_config; v_sla timestamptz; v_subject text; v_relation text;
  v_now timestamptz := coalesce(p_occurred_at, now());
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_organization_id is null or coalesce(p_external_message_id, '') = '' or coalesce(p_identifier, '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'parametros');
  end if;
  if p_context not in ('INTERNAL', 'EXTERNAL') then return jsonb_build_object('ok', false, 'erro', 'contexto_indefinido'); end if;
  if p_channel not in ('WHATSAPP', 'EMAIL', 'PORTAL', 'WEBCHAT', 'SISTEMA') then return jsonb_build_object('ok', false, 'erro', 'canal'); end if;
  if not exists (select 1 from organization o where o.id = p_organization_id) then return jsonb_build_object('ok', false, 'erro', 'organizacao'); end if;

  -- 1) idempotencia: a mesma mensagem externa ja entrou
  select * into v_existing from inbox_message where organization_id = p_organization_id and provider = p_provider and external_message_id = p_external_message_id;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicada', true, 'thread_id', v_existing.thread_id, 'message_id', v_existing.id);
  end if;

  -- 2) identidade -> contato (cria contato "não identificado" quando a identidade e nova)
  select ci.contact_id into v_contact from inbox_contact_identity ci where ci.organization_id = p_organization_id and ci.channel = p_channel and ci.identifier = p_identifier;
  if v_contact is null then
    v_relation := case when p_context = 'INTERNAL' then 'colaborador' else 'desconhecido' end;
    insert into inbox_contact (organization_id, name, relation_kind)
      values (p_organization_id, coalesce(nullif(trim(coalesce(p_display_name, '')), ''), 'Contato não identificado'), v_relation)
      returning id into v_contact;
    insert into inbox_contact_identity (organization_id, contact_id, channel, identifier, display_name, verified)
      values (p_organization_id, v_contact, p_channel, p_identifier, nullif(trim(coalesce(p_display_name, '')), ''), false);
    v_new_contact := true;
  end if;
  select name into v_contact_name from inbox_contact where id = v_contact;

  -- 3) thread: aberta do contato no mesmo canal e contexto; senao a fechada mais recente (reabre); senao nova
  select * into v_thread from inbox_thread
    where organization_id = p_organization_id and contact_id = v_contact and channel = p_channel and context = p_context and status <> 'FECHADA'
    order by last_message_at desc limit 1;
  if v_thread.id is null then
    select * into v_thread from inbox_thread
      where organization_id = p_organization_id and contact_id = v_contact and channel = p_channel and context = p_context and status = 'FECHADA'
      order by last_message_at desc limit 1;
  end if;
  select * into v_cfg from inbox_config where organization_id = p_organization_id;

  if v_thread.id is null then
    v_subject := coalesce(nullif(left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 80), ''), 'Conversa por ' || lower(p_channel));
    v_sla := v_now + (coalesce((v_cfg.sla_hours ->> 'Normal')::numeric, 24) * interval '1 hour');
    insert into inbox_thread (organization_id, channel, provider, context, contact_id, central_conversation_id, external_conversation_id, subject,
        status, priority, service_level, opened_at, last_message_at, last_inbound_at, sla_first_response_due, origin)
      values (p_organization_id, p_channel, p_provider, p_context, v_contact, p_central_conversation_id, p_external_conversation_id, v_subject,
        'NOVA', 'Normal', 'C', v_now, v_now, v_now, v_sla, p_provider)
      returning * into v_thread;
    v_new_thread := true;
    insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail)
      values (p_organization_id, v_thread.id, 'THREAD_CREATED', v_now, 'sistema', 'Inbox', 'conversa aberta por ' || lower(p_channel) || ' (' || p_context || ')');
  else
    if v_thread.status in ('AGUARDANDO_CONTATO', 'RESOLVIDA', 'FECHADA') then
      insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
        values (p_organization_id, v_thread.id, 'THREAD_REOPENED', v_now, 'sistema', 'Inbox', 'mensagem nova do contato reabriu a conversa', v_thread.status, 'EM_ATENDIMENTO');
      update inbox_thread set status = 'EM_ATENDIMENTO', resolved_at = null, closed_at = null, resolved_by = null,
          last_message_at = greatest(last_message_at, v_now), last_inbound_at = greatest(coalesce(last_inbound_at, v_now), v_now),
          central_conversation_id = coalesce(central_conversation_id, p_central_conversation_id),
          external_conversation_id = coalesce(external_conversation_id, p_external_conversation_id)
        where id = v_thread.id;
      v_reopened := true;
    else
      update inbox_thread set last_message_at = greatest(last_message_at, v_now), last_inbound_at = greatest(coalesce(last_inbound_at, v_now), v_now),
          central_conversation_id = coalesce(central_conversation_id, p_central_conversation_id),
          external_conversation_id = coalesce(external_conversation_id, p_external_conversation_id)
        where id = v_thread.id;
    end if;
  end if;

  -- 4) mensagem + evento (a unique de external_message_id segura a corrida entre dois webhooks simultaneos)
  insert into inbox_message (organization_id, thread_id, provider, direction, content_type, sender_kind, sender_id, sender_name, body, attachments,
      external_message_id, reply_to_external_id, central_message_id, occurred_at, meta)
    values (p_organization_id, v_thread.id, p_provider, 'inbound', coalesce(p_content_type, 'texto'), 'contato', v_contact::text, v_contact_name, coalesce(p_body, ''),
      coalesce(p_attachments, '[]'::jsonb), p_external_message_id, p_reply_to_external_id, p_central_message_id, v_now, coalesce(p_meta, '{}'::jsonb))
    returning id into v_msg;
  insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, occurred_at, actor_kind, actor_id, actor_name, detail)
    values (p_organization_id, v_thread.id, v_msg, 'MESSAGE_RECEIVED', v_now, 'contato', v_contact::text, v_contact_name, 'mensagem recebida (' || coalesce(p_content_type, 'texto') || ')');

  return jsonb_build_object('ok', true, 'duplicada', false, 'thread_id', v_thread.id, 'message_id', v_msg, 'contact_id', v_contact,
    'nova_thread', v_new_thread, 'novo_contato', v_new_contact, 'reaberta', v_reopened);
exception when unique_violation then
  -- corrida: dois webhooks com a mesma mensagem ao mesmo tempo; quem perde a unique devolve a que ganhou
  select * into v_existing from inbox_message where organization_id = p_organization_id and provider = p_provider and external_message_id = p_external_message_id;
  return jsonb_build_object('ok', true, 'duplicada', true, 'corrida', true, 'thread_id', v_existing.thread_id, 'message_id', v_existing.id);
end $$;
revoke execute on function inbox_ingest(uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function inbox_ingest(uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, uuid, uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 7) RLS
-- ---------------------------------------------------------------------------------------------------------------
-- setores em que o usuario e membro (le so inbox_member: nunca a tabela que a politica protege)
create or replace function inbox_user_sectors() returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select sector_id from inbox_member where profile_id = auth.uid()
$$;
-- quem ENCAMINHOU a conversa enxerga-a enquanto a atribuicao que fez estiver vigente (released_at nulo). Isto e o que
-- faz o UPDATE de transferencia passar pela politica de SELECT da linha nova sem transformar o autor em participante
-- permanente: "participou" fica em inbox_assignment (historico); o ACESSO acaba na proxima reatribuicao.
-- Definer e le SO inbox_assignment: a politica de inbox_assignment olha inbox_thread por EXISTS, e sem o definer a
-- politica da thread voltaria a consultar a atribuicao como o usuario — recursao.
create or replace function inbox_encaminhei(p_thread uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from inbox_assignment a where a.thread_id = p_thread and a.released_at is null and a.actor_id = auth.uid())
$$;

alter table inbox_sector enable row level security;
alter table inbox_team enable row level security;
alter table inbox_member enable row level security;
alter table inbox_config enable row level security;
alter table inbox_contact enable row level security;
alter table inbox_contact_identity enable row level security;
alter table inbox_thread enable row level security;
alter table inbox_message enable row level security;
alter table inbox_assignment enable row level security;
alter table inbox_thread_event enable row level security;
alter table inbox_action enable row level security;
alter table inbox_job enable row level security;

-- configuracao: quem tem `inbox` le; so `inbox_config` (Administrador, Diretoria) escreve
do $p$ declare tb text; begin
  foreach tb in array array['inbox_sector', 'inbox_team', 'inbox_member', 'inbox_config'] loop
    execute format('drop policy if exists %I_select on %I', tb, tb);
    execute format('create policy %I_select on %I for select using (organization_id = current_org() and inbox_role())', tb, tb);
    execute format('drop policy if exists %I_write on %I', tb, tb);
    execute format('create policy %I_write on %I for all using (organization_id = current_org() and inbox_config_role()) with check (organization_id = current_org() and inbox_config_role())', tb, tb);
  end loop;
end $p$;

-- contato e identidades: todo usuario do Inbox da organizacao le e cadastra (o nome e a empresa sao contexto da conversa)
do $p$ declare tb text; begin
  foreach tb in array array['inbox_contact', 'inbox_contact_identity'] loop
    execute format('drop policy if exists %I_select on %I', tb, tb);
    execute format('create policy %I_select on %I for select using (organization_id = current_org() and inbox_role())', tb, tb);
    execute format('drop policy if exists %I_insert on %I', tb, tb);
    execute format('create policy %I_insert on %I for insert with check (organization_id = current_org() and inbox_role())', tb, tb);
    execute format('drop policy if exists %I_update on %I', tb, tb);
    execute format('create policy %I_update on %I for update using (organization_id = current_org() and inbox_role()) with check (organization_id = current_org() and inbox_role())', tb, tb);
  end loop;
end $p$;

-- 6) thread: transversal (Administrador/Diretoria), atribuida a mim, participo, sem setor (triagem) ou setor em que sou membro.
--    Tudo por colunas da PROPRIA linha + funcoes que leem profile/inbox_member (nunca inbox_thread): sem recursao.
drop policy if exists inbox_thread_select on inbox_thread;
create policy inbox_thread_select on inbox_thread for select using (
  organization_id = current_org() and inbox_role() and (
    inbox_config_role() or assignee_id = auth.uid() or auth.uid() = any (participant_ids)
    or sector_id is null or sector_id in (select inbox_user_sectors()) or inbox_encaminhei(id)
  )
);
drop policy if exists inbox_thread_insert on inbox_thread;
create policy inbox_thread_insert on inbox_thread for insert with check (organization_id = current_org() and inbox_role());
drop policy if exists inbox_thread_update on inbox_thread;
create policy inbox_thread_update on inbox_thread for update using (
  organization_id = current_org() and inbox_role() and (
    inbox_config_role() or assignee_id = auth.uid() or auth.uid() = any (participant_ids)
    or sector_id is null or sector_id in (select inbox_user_sectors()) or inbox_encaminhei(id)
  )
) with check (organization_id = current_org() and inbox_role());

-- filhos HERDAM a visibilidade da thread: o EXISTS passa pela politica de inbox_thread (roda como o usuario que consulta)
do $p$ declare tb text; begin
  foreach tb in array array['inbox_message', 'inbox_assignment', 'inbox_thread_event', 'inbox_action', 'inbox_job'] loop
    execute format('drop policy if exists %I_select on %I', tb, tb);
    execute format('create policy %I_select on %I for select using (organization_id = current_org() and exists (select 1 from inbox_thread t where t.id = %I.thread_id))', tb, tb, tb);
    execute format('drop policy if exists %I_insert on %I', tb, tb);
    execute format('create policy %I_insert on %I for insert with check (organization_id = current_org() and inbox_role() and exists (select 1 from inbox_thread t where t.id = %I.thread_id))', tb, tb, tb);
  end loop;
  foreach tb in array array['inbox_message', 'inbox_assignment', 'inbox_action', 'inbox_job'] loop
    execute format('drop policy if exists %I_update on %I', tb, tb);
    execute format('create policy %I_update on %I for update using (organization_id = current_org() and inbox_role() and exists (select 1 from inbox_thread t where t.id = %I.thread_id)) with check (organization_id = current_org() and inbox_role())', tb, tb, tb);
  end loop;
end $p$;

-- grants: nenhum DELETE para authenticated, exceto membros (a configuracao remove membros; o resto so inativa)
do $g$ declare tb text; begin
  foreach tb in array array['inbox_sector', 'inbox_team', 'inbox_member', 'inbox_config', 'inbox_contact', 'inbox_contact_identity', 'inbox_thread', 'inbox_message', 'inbox_assignment', 'inbox_thread_event', 'inbox_action', 'inbox_job'] loop
    execute format('revoke all on %I from authenticated', tb);
    execute format('grant select, insert on %I to authenticated', tb);
  end loop;
  foreach tb in array array['inbox_sector', 'inbox_team', 'inbox_member', 'inbox_config', 'inbox_contact', 'inbox_contact_identity', 'inbox_thread', 'inbox_message', 'inbox_assignment', 'inbox_action', 'inbox_job'] loop
    execute format('grant update on %I to authenticated', tb);
  end loop;
  execute 'grant delete on inbox_member to authenticated';
end $g$;

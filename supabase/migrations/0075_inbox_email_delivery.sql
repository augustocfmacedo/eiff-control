-- 0075 — EIFF Inbox: livro de entregas do e-mail comercial (docs/email-comercial.md §6.2; etapa E2).
--
-- NAO APLICADA EM PRODUCAO. Este arquivo e desenvolvimento autorizado; a aplicacao exige autorizacao propria.
-- Prova em banco descartavel: `npm run smoke:email` (PGlite, ROLLBACK ao final).
--
-- O que cria:
--   1) provider GOOGLE_WORKSPACE em inbox_message (a conversa continua com o provider de origem);
--   2) inbox_email_delivery — o LIVRO: uma linha por intencao de envio, sem endereco e sem conteudo (o texto vive na
--      mensagem do Inbox, o endereco no contato);
--   3) inbox_email_delivery_event — historico IMUTAVEL de cada mudanca de estado, com o ator real;
--   4) maquina de estados no banco (READY -> REQUESTED -> ACCEPTED | FAILED | UNKNOWN; UNKNOWN -> ACCEPTED | FAILED),
--      comando imutavel, terminais sem regressao, sem DELETE;
--   5) tres RPCs SO para service_role (create, transition, accept). O navegador so le.
--      - create confere: perfil ativo com papel de envio, conversa aberta e externa, idempotencia por intencao,
--        entrega pendente na conversa e os tetos diarios (usuario e organizacao), tudo numa transacao;
--      - accept grava entrega ACCEPTED + mensagem `enviada` + SLA de primeira resposta numa transacao;
--   6) a mensagem do provider GOOGLE_WORKSPACE so nasce e so muda de entrega pelas RPCs (rascunho nao vira «enviada»
--      por UPDATE do navegador).
--
-- Vinculo com o SLA: so `inbox_email_delivery_accept` preenche `sla_first_response_at`, e so se estiver vazio
-- (o primeiro contato e o que vale). READY, REQUESTED, FAILED e UNKNOWN nunca tocam o SLA.
-- Idempotente: pode ser reaplicada.

-- ---------------------------------------------------------------------------------------------------------------
-- 1) provider novo na mensagem
-- ---------------------------------------------------------------------------------------------------------------
alter table inbox_message drop constraint if exists inbox_message_provider_check;
alter table inbox_message add constraint inbox_message_provider_check check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD', 'GOOGLE_WORKSPACE'));

-- ---------------------------------------------------------------------------------------------------------------
-- 2) o livro
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_email_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  thread_id uuid not null references inbox_thread(id),
  contact_id uuid not null references inbox_contact(id),
  -- a mensagem do Inbox que carrega o texto: nasce `registrada` (rascunho) e vira `enviada` so no aceite
  message_id uuid not null references inbox_message(id),
  requested_by uuid not null references profile(id),
  -- intencao gerada na tela ANTES do primeiro clique: a mesma intencao nunca vira dois e-mails
  idempotency_key uuid not null,
  -- sha256 de destinatario + assunto + corpo: a mesma intencao com outro conteudo e recusada. Nao e o conteudo.
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider text not null default 'GOOGLE_WORKSPACE' check (provider = 'GOOGLE_WORKSPACE'),
  -- Message-ID gerado por nos (<id@eiff.com.br>): chave de reconciliacao e de associacao da resposta
  rfc_message_id text not null check (rfc_message_id ~ '^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$'),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) between 1 and 200),
  provider_thread_id text check (provider_thread_id is null or length(provider_thread_id) between 1 and 200),
  status text not null default 'READY' check (status in ('READY', 'REQUESTED', 'ACCEPTED', 'FAILED', 'UNKNOWN')),
  reason text check (reason is null or reason in (
    'credencial_revogada', 'credencial_invalida', 'provedor_indisponivel', 'mensagem_recusada', 'acesso_recusado', 'limite_do_provedor',
    'resultado_desconhecido', 'registro_falhou', 'mensagem_invalida', 'declarado_nao_enviado', 'declarado_encontrado')),
  reconciled boolean not null default false,
  -- este aceite foi a PRIMEIRA resposta da conversa?
  sla_fulfilled boolean,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_email_delivery_intencao_uk unique (organization_id, idempotency_key),
  constraint inbox_email_delivery_aceite_chk check ((status = 'ACCEPTED') = (accepted_at is not null)),
  constraint inbox_email_delivery_fim_chk check ((status in ('ACCEPTED', 'FAILED')) = (finished_at is not null))
);
-- no maximo UMA entrega sem desfecho por conversa: enquanto ela existir, nao ha novo envio ali
create unique index if not exists inbox_email_delivery_pendente_uk on inbox_email_delivery (thread_id) where status in ('READY', 'REQUESTED', 'UNKNOWN');
create index if not exists inbox_email_delivery_thread_idx on inbox_email_delivery (thread_id, requested_at);
-- contagem dos tetos diarios
create index if not exists inbox_email_delivery_teto_idx on inbox_email_delivery (organization_id, requested_at) where status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN');

create table if not exists inbox_email_delivery_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  delivery_id uuid not null references inbox_email_delivery(id),
  from_status text check (from_status is null or from_status in ('READY', 'REQUESTED', 'ACCEPTED', 'FAILED', 'UNKNOWN')),
  to_status text not null check (to_status in ('READY', 'REQUESTED', 'ACCEPTED', 'FAILED', 'UNKNOWN')),
  reason text,
  -- quem PEDIU fica em inbox_email_delivery.requested_by; aqui fica quem TRANSICIONOU
  actor_id uuid references profile(id),
  actor_kind text not null check (actor_kind in ('USER', 'SERVER', 'SYSTEM')),
  occurred_at timestamptz not null default now()
);
create index if not exists inbox_email_delivery_event_idx on inbox_email_delivery_event (delivery_id, occurred_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 3) guardas: maquina de estados, comando imutavel, historico append-only
-- ---------------------------------------------------------------------------------------------------------------
create or replace function inbox_email_delivery_guarda() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ator uuid := nullif(current_setting('inbox.email_ator', true), '')::uuid;
  v_tipo text := coalesce(nullif(current_setting('inbox.email_ator_tipo', true), ''), 'SYSTEM');
begin
  if tg_op = 'DELETE' then
    raise exception 'entrega de e-mail não pode ser apagada (id %)', old.id;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'READY' then raise exception 'entrega de e-mail nasce READY (veio %)', new.status; end if;
    insert into inbox_email_delivery_event (organization_id, delivery_id, from_status, to_status, reason, actor_id, actor_kind)
      values (new.organization_id, new.id, null, 'READY', null, v_ator, v_tipo);
    return new;
  end if;
  -- comando imutavel: mudar o comando e criar OUTRA entrega
  if new.organization_id is distinct from old.organization_id or new.thread_id is distinct from old.thread_id
     or new.contact_id is distinct from old.contact_id or new.message_id is distinct from old.message_id
     or new.requested_by is distinct from old.requested_by or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint or new.rfc_message_id is distinct from old.rfc_message_id
     or new.provider is distinct from old.provider or new.requested_at is distinct from old.requested_at
     or new.created_at is distinct from old.created_at then
    raise exception 'o comando da entrega de e-mail é imutável (id %)', old.id;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'READY' and new.status in ('REQUESTED', 'FAILED'))
         or (old.status = 'REQUESTED' and new.status in ('ACCEPTED', 'FAILED', 'UNKNOWN'))
         or (old.status = 'UNKNOWN' and new.status in ('ACCEPTED', 'FAILED'))) then
      raise exception 'transição de entrega de e-mail não permitida: % -> %', old.status, new.status;
    end if;
    insert into inbox_email_delivery_event (organization_id, delivery_id, from_status, to_status, reason, actor_id, actor_kind)
      values (new.organization_id, new.id, old.status, new.status, new.reason, v_ator, v_tipo);
  elsif old.status in ('ACCEPTED', 'FAILED') then
    raise exception 'entrega de e-mail encerrada não muda (id %, %)', old.id, old.status;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_email_delivery_guarda_iu on inbox_email_delivery;
create trigger inbox_email_delivery_guarda_iu before update on inbox_email_delivery for each row execute function inbox_email_delivery_guarda();
drop trigger if exists inbox_email_delivery_guarda_i on inbox_email_delivery;
create trigger inbox_email_delivery_guarda_i after insert on inbox_email_delivery for each row execute function inbox_email_delivery_guarda();
drop trigger if exists inbox_email_delivery_guarda_d on inbox_email_delivery;
create trigger inbox_email_delivery_guarda_d before delete on inbox_email_delivery for each row execute function inbox_email_delivery_guarda();

create or replace function inbox_email_evento_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'histórico da entrega de e-mail é imutável (%)', tg_op;
end $$;
drop trigger if exists inbox_email_delivery_event_no_update on inbox_email_delivery_event;
create trigger inbox_email_delivery_event_no_update before update on inbox_email_delivery_event for each row execute function inbox_email_evento_imutavel();
drop trigger if exists inbox_email_delivery_event_no_delete on inbox_email_delivery_event;
create trigger inbox_email_delivery_event_no_delete before delete on inbox_email_delivery_event for each row execute function inbox_email_evento_imutavel();

-- a mensagem do e-mail so nasce e so muda de entrega dentro das RPCs (GUC local ligado por elas)
create or replace function inbox_email_mensagem_governada() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('inbox.email_governado', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' and new.provider = 'GOOGLE_WORKSPACE' then
    raise exception 'mensagem de e-mail comercial só nasce pelo servidor de envio';
  end if;
  if tg_op = 'UPDATE' and old.provider = 'GOOGLE_WORKSPACE' and (new.delivery_state is distinct from old.delivery_state or new.meta is distinct from old.meta) then
    raise exception 'a entrega de uma mensagem de e-mail comercial só muda pelo servidor de envio (id %)', old.id;
  end if;
  return new;
end $$;
drop trigger if exists inbox_message_email_governada on inbox_message;
create trigger inbox_message_email_governada before insert or update on inbox_message for each row execute function inbox_email_mensagem_governada();

-- ---------------------------------------------------------------------------------------------------------------
-- 4) RPCs (somente service_role)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function inbox_email_somente_servidor() returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role' and auth.uid() is null
$$;

create or replace function inbox_email_entrega_json(d inbox_email_delivery) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', d.id, 'status', d.status, 'message_id', d.message_id, 'reason', d.reason, 'accepted_at', d.accepted_at,
    'sla_fulfilled', d.sla_fulfilled, 'requested_at', d.requested_at, 'provider_message_id', d.provider_message_id)
$$;

-- Cria a entrega READY e o rascunho na conversa. Tudo o que pode recusar o envio e conferido AQUI, numa transacao.
create or replace function inbox_email_delivery_create(
  p_organization_id uuid, p_thread_id uuid, p_contact_id uuid, p_requested_by uuid, p_requester_name text,
  p_idempotency_key uuid, p_fingerprint text, p_body text, p_limit_user integer, p_limit_org integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_thread inbox_thread; v_d inbox_email_delivery; v_perfil profile; v_id uuid := gen_random_uuid(); v_msg uuid;
  v_dia timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_fio jsonb; v_nome text := left(coalesce(nullif(trim(p_requester_name), ''), 'Usuário'), 160);
begin
  if not inbox_email_somente_servidor() then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_limit_user is null or p_limit_user < 1 or p_limit_org is null or p_limit_org < 1 then return jsonb_build_object('ok', false, 'erro', 'pedido_invalido'); end if;
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 20000 then return jsonb_build_object('ok', false, 'erro', 'pedido_invalido'); end if;

  -- quem pede: perfil ATIVO, da organizacao, com papel de envio (espelho de MATRIZ.enviar_email)
  select * into v_perfil from profile where id = p_requested_by;
  if not found or not v_perfil.active or v_perfil.organization_id <> p_organization_id or v_perfil.role::text not in ('Administrador', 'Diretoria') then
    return jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  end if;

  -- a conversa, travada: duas intencoes ao mesmo tempo na mesma conversa se enfileiram aqui
  select * into v_thread from inbox_thread where id = p_thread_id and organization_id = p_organization_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'conversa_nao_encontrada'); end if;

  -- idempotencia: a mesma intencao devolve o que ja existe
  select * into v_d from inbox_email_delivery where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_d.request_fingerprint <> p_fingerprint or v_d.thread_id <> p_thread_id then return jsonb_build_object('ok', false, 'erro', 'intencao_reutilizada'); end if;
    return jsonb_build_object('ok', true, 'nova', false, 'entrega', inbox_email_entrega_json(v_d));
  end if;

  if v_thread.context <> 'EXTERNAL' then return jsonb_build_object('ok', false, 'erro', 'conversa_interna'); end if;
  if v_thread.status = 'FECHADA' then return jsonb_build_object('ok', false, 'erro', 'conversa_fechada'); end if;
  if v_thread.contact_id <> p_contact_id then return jsonb_build_object('ok', false, 'erro', 'pedido_invalido'); end if;
  if exists (select 1 from inbox_email_delivery where thread_id = p_thread_id and status in ('READY', 'REQUESTED', 'UNKNOWN')) then
    return jsonb_build_object('ok', false, 'erro', 'entrega_pendente');
  end if;

  -- tetos diarios (dia de Sao Paulo). Conta o que saiu ou pode ter saido; READY e FAILED nao contam.
  -- advisory lock por organizacao: dois envios simultaneos em conversas diferentes nao furam o teto
  perform pg_advisory_xact_lock(hashtextextended('inbox_email_teto:' || p_organization_id::text, 0));
  if (select count(*) from inbox_email_delivery where organization_id = p_organization_id and requested_by = p_requested_by
        and status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN') and requested_at >= v_dia) >= p_limit_user then
    return jsonb_build_object('ok', false, 'erro', 'limite_usuario');
  end if;
  if (select count(*) from inbox_email_delivery where organization_id = p_organization_id
        and status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN') and requested_at >= v_dia) >= p_limit_org then
    return jsonb_build_object('ok', false, 'erro', 'limite_organizacao');
  end if;

  -- o fio: a ultima entrega aceita desta conversa (a resposta continua nele)
  select jsonb_build_object('rfc_message_id', rfc_message_id, 'provider_thread_id', provider_thread_id) into v_fio
    from inbox_email_delivery where thread_id = p_thread_id and status = 'ACCEPTED' order by accepted_at desc limit 1;

  perform set_config('inbox.email_governado', 'on', true);
  perform set_config('inbox.email_ator', p_requested_by::text, true);
  perform set_config('inbox.email_ator_tipo', 'USER', true);
  insert into inbox_message (organization_id, thread_id, provider, direction, content_type, sender_kind, sender_id, sender_name, body, occurred_at, delivery_state, meta)
    values (p_organization_id, p_thread_id, 'GOOGLE_WORKSPACE', 'outbound', 'texto', 'usuario', p_requested_by::text, v_nome, p_body, now(), 'registrada',
            jsonb_build_object('canalSaida', 'EMAIL', 'entregaId', v_id::text, 'entregaEstado', 'READY'))
    returning id into v_msg;
  insert into inbox_email_delivery (id, organization_id, thread_id, contact_id, message_id, requested_by, idempotency_key, request_fingerprint, rfc_message_id)
    values (v_id, p_organization_id, p_thread_id, p_contact_id, v_msg, p_requested_by, p_idempotency_key, p_fingerprint, '<' || v_id::text || '@eiff.com.br>')
    returning * into v_d;
  insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, actor_kind, actor_id, actor_name, detail)
    values (p_organization_id, p_thread_id, v_msg, 'MESSAGE_REGISTERED', 'usuario', p_requested_by::text, v_nome, 'e-mail preparado para envio: é rascunho até o aceite do Google');
  perform set_config('inbox.email_governado', '', true);

  return jsonb_build_object('ok', true, 'nova', true, 'entrega', inbox_email_entrega_json(v_d)) || case when v_fio is null then '{}'::jsonb else jsonb_build_object('fio', v_fio) end;
exception when unique_violation then
  -- corrida: outra transacao criou a mesma intencao ou outra entrega pendente na conversa
  select * into v_d from inbox_email_delivery where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found and v_d.request_fingerprint = p_fingerprint then return jsonb_build_object('ok', true, 'nova', false, 'entrega', inbox_email_entrega_json(v_d)); end if;
  return jsonb_build_object('ok', false, 'erro', case when found then 'intencao_reutilizada' else 'entrega_pendente' end);
end $$;

-- READY -> REQUESTED | FAILED ; REQUESTED -> FAILED | UNKNOWN ; UNKNOWN -> FAILED. (ACCEPTED so pela RPC de aceite.)
create or replace function inbox_email_delivery_transition(
  p_delivery_id uuid, p_to text, p_actor uuid, p_reason text default null, p_provider_message_id text default null, p_provider_thread_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d inbox_email_delivery; v_nome text;
begin
  if not inbox_email_somente_servidor() then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_to not in ('REQUESTED', 'FAILED', 'UNKNOWN') then return jsonb_build_object('ok', false, 'erro', 'transicao_invalida'); end if;
  select * into v_d from inbox_email_delivery where id = p_delivery_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'entrega_nao_encontrada'); end if;
  if v_d.status = p_to then return jsonb_build_object('ok', true, 'repetida', true, 'entrega', inbox_email_entrega_json(v_d)); end if;
  if not ((v_d.status = 'READY' and p_to in ('REQUESTED', 'FAILED')) or (v_d.status = 'REQUESTED' and p_to in ('FAILED', 'UNKNOWN')) or (v_d.status = 'UNKNOWN' and p_to = 'FAILED')) then
    return jsonb_build_object('ok', false, 'erro', 'transicao_invalida', 'status', v_d.status);
  end if;
  if p_to in ('FAILED', 'UNKNOWN') and p_reason is null then return jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); end if;
  if p_actor is not null and not exists (select 1 from profile where id = p_actor and organization_id = v_d.organization_id) then
    return jsonb_build_object('ok', false, 'erro', 'ator_invalido');
  end if;

  perform set_config('inbox.email_governado', 'on', true);
  perform set_config('inbox.email_ator', coalesce(p_actor::text, ''), true);
  perform set_config('inbox.email_ator_tipo', case when p_actor is null then 'SERVER' else 'USER' end, true);
  update inbox_email_delivery set status = p_to, reason = coalesce(p_reason, reason),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id), provider_thread_id = coalesce(p_provider_thread_id, provider_thread_id),
      finished_at = case when p_to = 'FAILED' then now() else null end
    where id = p_delivery_id returning * into v_d;
  update inbox_message set delivery_state = case when p_to = 'FAILED' then 'falhou' else 'registrada' end,
      meta = meta || jsonb_build_object('entregaEstado', p_to)
    where id = v_d.message_id;
  if p_to in ('FAILED', 'UNKNOWN') then
    select coalesce((select name from profile where id = p_actor), 'Servidor de envio') into v_nome;
    insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, actor_kind, actor_id, actor_name, detail)
      values (v_d.organization_id, v_d.thread_id, v_d.message_id, 'MESSAGE_REGISTERED', case when p_actor is null then 'sistema' else 'usuario' end, p_actor::text, left(v_nome, 160),
              case when p_to = 'FAILED' then 'e-mail NÃO enviado (' || p_reason || '): não conta como resposta'
                   else 'resultado do envio de e-mail DESCONHECIDO (' || p_reason || '): não reenviar; conferir a pasta Enviados' end);
  end if;
  perform set_config('inbox.email_governado', '', true);
  return jsonb_build_object('ok', true, 'entrega', inbox_email_entrega_json(v_d));
end $$;

-- O ACEITE: entrega ACCEPTED + mensagem `enviada` + SLA de primeira resposta, numa transacao.
create or replace function inbox_email_delivery_accept(
  p_delivery_id uuid, p_actor uuid, p_accepted_at timestamptz, p_provider_message_id text default null, p_provider_thread_id text default null, p_reconciled boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d inbox_email_delivery; v_t inbox_thread; v_primeira boolean; v_nome text; v_no_prazo boolean;
begin
  if not inbox_email_somente_servidor() then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  select * into v_d from inbox_email_delivery where id = p_delivery_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'entrega_nao_encontrada'); end if;
  if v_d.status = 'ACCEPTED' then return jsonb_build_object('ok', true, 'repetida', true, 'entrega', inbox_email_entrega_json(v_d)); end if;
  if v_d.status not in ('REQUESTED', 'UNKNOWN') then return jsonb_build_object('ok', false, 'erro', 'transicao_invalida', 'status', v_d.status); end if;
  -- aceite direto (nao reconciliado) exige o id que o Google devolveu: sem id, nao houve confirmacao
  if not coalesce(p_reconciled, false) and coalesce(p_provider_message_id, v_d.provider_message_id) is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_confirmacao_do_provedor');
  end if;
  if p_accepted_at is null or p_accepted_at > now() + interval '2 minutes' or p_accepted_at < v_d.requested_at - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'erro', 'instante_invalido');
  end if;
  if p_actor is null or not exists (select 1 from profile where id = p_actor and organization_id = v_d.organization_id and active) then
    return jsonb_build_object('ok', false, 'erro', 'ator_invalido');
  end if;
  select * into v_t from inbox_thread where id = v_d.thread_id for update;
  v_primeira := v_t.sla_first_response_at is null;
  v_no_prazo := v_t.sla_first_response_due is null or p_accepted_at <= v_t.sla_first_response_due;

  perform set_config('inbox.email_governado', 'on', true);
  perform set_config('inbox.email_ator', p_actor::text, true);
  perform set_config('inbox.email_ator_tipo', 'USER', true);
  update inbox_email_delivery set status = 'ACCEPTED', accepted_at = p_accepted_at, finished_at = now(), sla_fulfilled = v_primeira,
      reconciled = coalesce(p_reconciled, false), reason = case when coalesce(p_reconciled, false) then 'declarado_encontrado' else null end,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id), provider_thread_id = coalesce(p_provider_thread_id, provider_thread_id)
    where id = p_delivery_id returning * into v_d;
  update inbox_message set delivery_state = 'enviada', meta = meta || jsonb_build_object('entregaEstado', 'ACCEPTED', 'enviadaEm', p_accepted_at, 'reconciliada', coalesce(p_reconciled, false))
    where id = v_d.message_id;
  -- o mesmo efeito de `aoResponder` (src/core/inbox/estados.ts) com efetiva = true
  update inbox_thread set
      sla_first_response_at = coalesce(sla_first_response_at, p_accepted_at),
      status = case when status in ('NOVA', 'TRIADA', 'ATRIBUIDA') then 'EM_ATENDIMENTO' else status end,
      last_message_at = greatest(last_message_at, p_accepted_at),
      participant_ids = case when p_actor = any(participant_ids) then participant_ids else participant_ids || p_actor end
    where id = v_d.thread_id;
  select coalesce((select name from profile where id = p_actor), 'Usuário') into v_nome;
  insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, actor_kind, actor_id, actor_name, detail)
    values (v_d.organization_id, v_d.thread_id, v_d.message_id, 'MESSAGE_REGISTERED', 'usuario', p_actor::text, left(v_nome, 160),
            'e-mail enviado: ' || case when coalesce(p_reconciled, false) then 'envio conferido por pessoa na pasta Enviados' else 'aceite confirmado pelo Google' end
            || case when v_primeira then ' — primeira resposta ' || case when v_no_prazo then 'dentro do prazo' else 'FORA do prazo' end else ' (a primeira resposta já estava registrada)' end);
  if v_t.status in ('NOVA', 'TRIADA', 'ATRIBUIDA') then
    insert into inbox_thread_event (organization_id, thread_id, event_type, actor_kind, actor_id, actor_name, detail, before_value, after_value)
      values (v_d.organization_id, v_d.thread_id, 'STATUS_CHANGED', 'usuario', p_actor::text, left(v_nome, 160), 'primeira ação da EIFF na conversa', v_t.status, 'EM_ATENDIMENTO');
  end if;
  perform set_config('inbox.email_governado', '', true);
  return jsonb_build_object('ok', true, 'entrega', inbox_email_entrega_json(v_d), 'message_id', v_d.message_id, 'cumpriu_primeira_resposta', v_primeira);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5) RLS e privilegios: o navegador so LE, e so o que e de conversa que ele enxerga
-- ---------------------------------------------------------------------------------------------------------------
alter table inbox_email_delivery enable row level security;
alter table inbox_email_delivery_event enable row level security;
drop policy if exists inbox_email_delivery_select on inbox_email_delivery;
create policy inbox_email_delivery_select on inbox_email_delivery for select
  using (organization_id = current_org() and exists (select 1 from inbox_thread t where t.id = inbox_email_delivery.thread_id));
drop policy if exists inbox_email_delivery_event_select on inbox_email_delivery_event;
create policy inbox_email_delivery_event_select on inbox_email_delivery_event for select
  using (organization_id = current_org() and exists (select 1 from inbox_email_delivery d where d.id = inbox_email_delivery_event.delivery_id));

revoke all on inbox_email_delivery, inbox_email_delivery_event from public, anon, authenticated;
grant select on inbox_email_delivery, inbox_email_delivery_event to authenticated;
grant all on inbox_email_delivery, inbox_email_delivery_event to service_role;

revoke execute on function inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function inbox_email_delivery_transition(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function inbox_email_delivery_accept(uuid, uuid, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke execute on function inbox_email_delivery_guarda() from public, anon, authenticated;
grant execute on function inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer) to service_role;
grant execute on function inbox_email_delivery_transition(uuid, text, uuid, text, text, text) to service_role;
grant execute on function inbox_email_delivery_accept(uuid, uuid, timestamptz, text, text, boolean) to service_role;

-- Delivery Authority & Reconciliation Patch 01: autoridade server-only sobre o ledger de entrega.
-- Incremental sobre 0045/0046 (nao as altera). O envio segue desligado; nenhuma entrega existe.
--
-- 1) authenticated passa a ter SOMENTE SELECT em radar_communication_delivery. Criacao e transicao acontecem
--    exclusivamente pelas funcoes radar_delivery_create/radar_delivery_transition, chamadas pela funcao Netlify
--    com service_role DEPOIS de validar o JWT do usuario (mesmo padrao server-only das RPCs do Vibe, migration 0035).
revoke insert, update, delete, truncate on radar_communication_delivery from authenticated;
grant select on radar_communication_delivery to authenticated;

-- 2) ator real da transicao: quem PEDIU (requested_by) e quem/qual processo TRANSICIONOU (last_actor_*)
alter table radar_communication_delivery add column if not exists last_actor_id uuid references profile(id);
alter table radar_communication_delivery add column if not exists last_actor_kind text check (last_actor_kind is null or last_actor_kind in ('USER', 'SERVER', 'PROVIDER', 'SYSTEM'));
alter table radar_communication_delivery_event add column if not exists actor_kind text check (actor_kind is null or actor_kind in ('USER', 'SERVER', 'PROVIDER', 'SYSTEM'));
alter table radar_communication_delivery_event add column if not exists requested_by uuid references profile(id);

-- 3) snapshot do COMANDO imutavel: mudanca de comando = nova entrega. Só os campos de resultado evoluem.
create or replace function radar_delivery_comando_imutavel() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.communication_id is distinct from old.communication_id
     or new.company_id is distinct from old.company_id or new.contact_id is distinct from old.contact_id
     or new.provider is distinct from old.provider or new.channel is distinct from old.channel or new.mode is distinct from old.mode
     or new.idempotency_key is distinct from old.idempotency_key or new.request_fingerprint is distinct from old.request_fingerprint
     or new.provider_sender_id is distinct from old.provider_sender_id or new.provider_template_id is distinct from old.provider_template_id
     or new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at then
    raise exception 'comando da entrega e imutavel: mudanca de comando gera nova entrega (id %)', old.id;
  end if;
  -- requested_at nasce nulo e e preenchido UMA vez, na transicao para REQUESTED; depois disso tambem e imutavel
  if old.requested_at is not null and new.requested_at is distinct from old.requested_at then
    raise exception 'requested_at da entrega e imutavel depois de definido (id %)', old.id;
  end if;
  return new;
end $$;
create trigger radar_delivery_comando before update on radar_communication_delivery for each row execute function radar_delivery_comando_imutavel();

-- 4) o evento passa a registrar o ator REAL da transicao, alem de quem pediu
create or replace function radar_delivery_estado() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare permitido text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'READY' then raise exception 'entrega nasce em READY (recebido: %)', new.status; end if;
    insert into radar_communication_delivery_event (organization_id, delivery_id, from_status, to_status, provider_status, occurred_at, actor_id, actor_kind, requested_by, reason_safe)
      values (new.organization_id, new.id, null, new.status, new.provider_status, now(), coalesce(new.last_actor_id, new.requested_by), coalesce(new.last_actor_kind, 'SERVER'), new.requested_by, null);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  permitido := case old.status
    when 'READY' then array['REQUESTED']
    when 'REQUESTED' then array['ACCEPTED', 'FAILED', 'UNKNOWN']
    when 'ACCEPTED' then array['DELIVERED', 'FAILED', 'UNKNOWN']
    else array[]::text[] end;
  if not (new.status = any (permitido)) then
    raise exception 'transição de entrega % -> % não é permitida', old.status, new.status;
  end if;
  insert into radar_communication_delivery_event (organization_id, delivery_id, from_status, to_status, provider_status, occurred_at, actor_id, actor_kind, requested_by, reason_safe)
    values (new.organization_id, new.id, old.status, new.status, new.provider_status, now(), coalesce(new.last_actor_id, new.requested_by), coalesce(new.last_actor_kind, 'SERVER'), new.requested_by, left(new.error_message_safe, 500));
  return new;
end $$;

-- 5) porta unica server-side: criar entrega (idempotente) e transicionar. EXECUTE so para service_role.
create or replace function radar_delivery_create(
  p_user_id uuid, p_communication_id uuid, p_provider text, p_channel text, p_mode text,
  p_idempotency_key text, p_request_fingerprint text, p_sender_id text default null, p_template_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_role text; v_com record; v_id uuid; v_existente radar_communication_delivery;
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); end if;
  select organization_id, role::text into v_org, v_role from profile where id = p_user_id;
  if v_org is null then return jsonb_build_object('ok', false, 'erro', 'sem_perfil'); end if;
  if v_role not in ('Administrador', 'Diretoria', 'Financeiro', 'Compras', 'Gestor de obra', 'Engenharia') then return jsonb_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  select id, organization_id, company_id, contact_id, state into v_com from radar_communication where id = p_communication_id;
  if v_com.id is null then return jsonb_build_object('ok', false, 'erro', 'comunicacao_nao_encontrada'); end if;
  if v_com.organization_id <> v_org then return jsonb_build_object('ok', false, 'erro', 'comunicacao_de_outra_organizacao'); end if;
  if v_com.state <> 'APPROVED' then return jsonb_build_object('ok', false, 'erro', 'comunicacao_nao_aprovada', 'estado', v_com.state); end if;

  -- idempotencia: a mesma chave devolve a entrega existente, nunca cria a segunda
  select * into v_existente from radar_communication_delivery where organization_id = v_org and idempotency_key = p_idempotency_key;
  if v_existente.id is not null then
    return jsonb_build_object('ok', true, 'existente', true, 'delivery_id', v_existente.id, 'status', v_existente.status);
  end if;
  insert into radar_communication_delivery (organization_id, communication_id, company_id, contact_id, provider, channel, mode, status,
      idempotency_key, request_fingerprint, provider_sender_id, provider_template_id, requested_by, last_actor_id, last_actor_kind)
    values (v_org, v_com.id, v_com.company_id, v_com.contact_id, p_provider, p_channel, p_mode, 'READY',
      p_idempotency_key, p_request_fingerprint, p_sender_id, p_template_id, p_user_id, p_user_id, 'USER')
    returning id into v_id;
  return jsonb_build_object('ok', true, 'existente', false, 'delivery_id', v_id, 'status', 'READY');
end $$;
revoke execute on function radar_delivery_create(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function radar_delivery_create(uuid, uuid, text, text, text, text, text, text, text) to service_role;

create or replace function radar_delivery_transition(
  p_user_id uuid, p_delivery_id uuid, p_to_status text, p_actor_kind text default 'SERVER',
  p_provider_conversation_id text default null, p_provider_message_id text default null,
  p_provider_status text default null, p_error_code text default null, p_reason_safe text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_role text; v_d radar_communication_delivery; v_permitido text[]; v_agora timestamptz := now();
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); end if;
  if p_actor_kind not in ('USER', 'SERVER', 'PROVIDER', 'SYSTEM') then return jsonb_build_object('ok', false, 'erro', 'ator_invalido'); end if;
  select organization_id, role::text into v_org, v_role from profile where id = p_user_id;
  if v_org is null then return jsonb_build_object('ok', false, 'erro', 'sem_perfil'); end if;
  if v_role not in ('Administrador', 'Diretoria', 'Financeiro', 'Compras', 'Gestor de obra', 'Engenharia') then return jsonb_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  select * into v_d from radar_communication_delivery where id = p_delivery_id for update;
  if v_d.id is null then return jsonb_build_object('ok', false, 'erro', 'entrega_nao_encontrada'); end if;
  if v_d.organization_id <> v_org then return jsonb_build_object('ok', false, 'erro', 'entrega_de_outra_organizacao'); end if;
  v_permitido := case v_d.status
    when 'READY' then array['REQUESTED']
    when 'REQUESTED' then array['ACCEPTED', 'FAILED', 'UNKNOWN']
    when 'ACCEPTED' then array['DELIVERED', 'FAILED', 'UNKNOWN']
    else array[]::text[] end;
  if not (p_to_status = any (v_permitido)) then
    return jsonb_build_object('ok', false, 'erro', 'transicao_invalida', 'de', v_d.status, 'para', p_to_status);
  end if;
  update radar_communication_delivery set
    status = p_to_status,
    last_actor_id = p_user_id, last_actor_kind = p_actor_kind,
    provider_conversation_id = coalesce(p_provider_conversation_id, provider_conversation_id),
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    provider_status = coalesce(p_provider_status, provider_status),
    error_code = coalesce(p_error_code, error_code),
    error_message_safe = coalesce(left(p_reason_safe, 500), error_message_safe),
    requested_at = case when p_to_status = 'REQUESTED' then coalesce(requested_at, v_agora) else requested_at end,
    accepted_at = case when p_to_status = 'ACCEPTED' then v_agora else accepted_at end,
    delivered_at = case when p_to_status = 'DELIVERED' then v_agora else delivered_at end,
    failed_at = case when p_to_status = 'FAILED' then v_agora else failed_at end
  where id = p_delivery_id;
  return jsonb_build_object('ok', true, 'delivery_id', p_delivery_id, 'de', v_d.status, 'status', p_to_status);
end $$;
revoke execute on function radar_delivery_transition(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function radar_delivery_transition(uuid, uuid, text, text, text, text, text, text, text) to service_role;

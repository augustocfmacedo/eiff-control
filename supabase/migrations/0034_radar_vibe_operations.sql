-- Vibe/Explorium: ledger de operacoes pagas, politica de creditos e reserva transacional no servidor.
-- (0033 ja existia; esta e a migration "radar_vibe_operations" pedida na revisao.)
-- Nenhuma chamada paga pode ocorrer sem uma operacao RESERVED/RUNNING criada por reserve_vibe_operation, que valida
-- usuario, organizacao, papel, idempotencia, politica e saldo sob advisory lock por organizacao.

create table radar_vibe_credit_policy (
  org_id uuid primary key references organization(id),
  enabled boolean not null default true,
  daily_budget numeric(10,2) not null default 60,
  monthly_budget numeric(10,2) not null default 600,
  reserve_credits numeric(10,2) not null default 20,
  max_credits_per_operation numeric(10,2) not null default 40,
  max_paid_records_per_operation integer not null default 20,
  email_cache_days integer not null default 90,
  allowed_roles role_kind[] not null default array['Administrador','Diretoria']::role_kind[],
  validated_filters jsonb, -- catalogo confirmado pelo autocomplete (job_level, job_department, job_title); null = nada validado
  validated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id)
);

create table radar_vibe_operation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  idempotency_key text not null,
  request_hash text not null,
  operation_type text not null check (operation_type in ('match','discovery','discovery_pool','enrich_email','enrich_phone','test_email')),
  status text not null default 'PLANNED' check (status in ('PLANNED','RESERVED','RUNNING','SUCCEEDED','FAILED','UNCERTAIN','CANCELLED')),
  estimated_credits numeric(10,2) not null default 0,
  reserved_credits numeric(10,2) not null default 0,
  actual_credits numeric(10,2),
  credits_before numeric(12,2),
  credits_after numeric(12,2),
  records_requested integer not null default 0,
  records_returned integer not null default 0,
  paid_record_cap integer,
  correlation_ids text[] not null default '{}',
  requested_by uuid not null references profile(id),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message_sanitized text,
  result_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  unique (org_id, idempotency_key)
);
create index radar_vibe_operation_org_status_idx on radar_vibe_operation (org_id, status, created_at desc);
create trigger radar_vibe_operation_touch before update on radar_vibe_operation for each row execute function touch_updated_at();
create trigger radar_vibe_operation_audit after insert or update on radar_vibe_operation for each row execute function audit_row();
create trigger radar_vibe_credit_policy_audit after insert or update on radar_vibe_credit_policy for each row execute function audit_row();

alter table radar_vibe_credit_policy enable row level security;
alter table radar_vibe_operation enable row level security;
create policy rvcp_select on radar_vibe_credit_policy for select using (org_id = current_org());
create policy rvcp_config on radar_vibe_credit_policy for all using (org_id = current_org() and has_role('Administrador','Diretoria')) with check (org_id = current_org() and has_role('Administrador','Diretoria'));
create policy rvo_select on radar_vibe_operation for select using (org_id = current_org());
-- escrita SO pelas funcoes abaixo (security definer); nenhuma politica de insert/update para authenticated
grant select, insert, update on radar_vibe_credit_policy to authenticated;
grant select on radar_vibe_operation to authenticated;

-- consumo comprometido no periodo: reservas abertas + consumo real (ou reservado, quando UNCERTAIN)
create or replace function vibe_credits_committed(p_org uuid, p_since timestamptz) returns numeric language sql stable security definer as $$
  select coalesce(sum(case when status in ('RESERVED','RUNNING','UNCERTAIN') then reserved_credits when status = 'SUCCEEDED' then coalesce(actual_credits, reserved_credits) else 0 end), 0)
  from radar_vibe_operation where org_id = p_org and created_at >= p_since
$$;

/**
 * Reserva transacional. Retorna jsonb { authorized, status, operation_id, reason, limits }.
 * p_dry_run = true so avalia (para a tela mostrar se a politica autoriza) sem gravar.
 */
create or replace function reserve_vibe_operation(
  p_idempotency_key text, p_request_hash text, p_operation_type text, p_estimated_credits numeric, p_records_requested integer,
  p_credits_available numeric, p_paid_record_cap integer default null, p_dry_run boolean default false
) returns jsonb language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid(); v_org uuid; v_role role_kind; v_pol radar_vibe_credit_policy; v_existing radar_vibe_operation;
  v_day numeric; v_month numeric; v_limit numeric; v_reason text; v_id uuid; v_limits jsonb;
begin
  if v_uid is null then return jsonb_build_object('authorized', false, 'reason', 'nao_autenticado'); end if;
  select organization_id, role into v_org, v_role from profile where id = v_uid and active;
  if v_org is null then return jsonb_build_object('authorized', false, 'reason', 'sem_perfil'); end if;
  -- serializa reservas da organizacao: duas requisicoes simultaneas nao reservam o mesmo saldo
  perform pg_advisory_xact_lock(hashtext('vibe:' || v_org::text));
  select * into v_pol from radar_vibe_credit_policy where org_id = v_org;
  if not found then
    insert into radar_vibe_credit_policy (org_id, updated_by) values (v_org, v_uid) returning * into v_pol;
  end if;
  if not v_pol.enabled then return jsonb_build_object('authorized', false, 'reason', 'politica_desabilitada'); end if;
  if not (v_role = any(v_pol.allowed_roles)) then return jsonb_build_object('authorized', false, 'reason', 'papel_nao_permitido'); end if;
  -- idempotencia
  select * into v_existing from radar_vibe_operation where org_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then return jsonb_build_object('authorized', false, 'reason', 'payload_diferente', 'operation_id', v_existing.id, 'status', v_existing.status); end if;
    if v_existing.status = 'SUCCEEDED' then return jsonb_build_object('authorized', false, 'reason', 'ja_executada', 'operation_id', v_existing.id, 'status', v_existing.status, 'result_summary', v_existing.result_summary); end if;
    if v_existing.status in ('RESERVED','RUNNING') then return jsonb_build_object('authorized', false, 'reason', 'operacao_em_andamento', 'operation_id', v_existing.id, 'status', v_existing.status); end if;
    if v_existing.status = 'UNCERTAIN' then return jsonb_build_object('authorized', false, 'reason', 'reconciliacao_necessaria', 'operation_id', v_existing.id, 'status', v_existing.status); end if;
    -- FAILED/CANCELLED/PLANNED: nada foi consumido; pode reservar de novo na mesma linha
  end if;
  v_day := vibe_credits_committed(v_org, date_trunc('day', now()));
  v_month := vibe_credits_committed(v_org, date_trunc('month', now()));
  v_limit := least(v_pol.max_credits_per_operation, v_pol.daily_budget - v_day, v_pol.monthly_budget - v_month, p_credits_available - v_pol.reserve_credits);
  v_limits := jsonb_build_object('max_per_operation', v_pol.max_credits_per_operation, 'daily_remaining', v_pol.daily_budget - v_day, 'monthly_remaining', v_pol.monthly_budget - v_month, 'available_minus_reserve', p_credits_available - v_pol.reserve_credits, 'limit', v_limit, 'max_paid_records', v_pol.max_paid_records_per_operation, 'reserve_credits', v_pol.reserve_credits, 'email_cache_days', v_pol.email_cache_days);
  if p_estimated_credits <= 0 then v_reason := 'custo_invalido';
  elsif p_estimated_credits > v_limit then v_reason := 'orcamento_insuficiente';
  elsif p_records_requested > v_pol.max_paid_records_per_operation then v_reason := 'registros_acima_do_limite';
  elsif p_operation_type not in ('match','discovery','discovery_pool','enrich_email','enrich_phone','test_email') then v_reason := 'tipo_invalido';
  end if;
  if v_reason is not null then return jsonb_build_object('authorized', false, 'reason', v_reason, 'limits', v_limits); end if;
  if p_dry_run then return jsonb_build_object('authorized', true, 'reason', 'simulacao', 'limits', v_limits); end if;
  if v_existing.id is not null then
    update radar_vibe_operation set status = 'RESERVED', request_hash = p_request_hash, operation_type = p_operation_type, estimated_credits = p_estimated_credits, reserved_credits = p_estimated_credits, records_requested = p_records_requested, paid_record_cap = p_paid_record_cap, requested_by = v_uid, started_at = null, finished_at = null, error_code = null, error_message_sanitized = null, result_summary = null, records_returned = 0, correlation_ids = '{}', actual_credits = null, credits_before = null, credits_after = null
      where id = v_existing.id returning id into v_id;
  else
    insert into radar_vibe_operation (org_id, idempotency_key, request_hash, operation_type, status, estimated_credits, reserved_credits, records_requested, paid_record_cap, requested_by)
      values (v_org, p_idempotency_key, p_request_hash, p_operation_type, 'RESERVED', p_estimated_credits, p_estimated_credits, p_records_requested, p_paid_record_cap, v_uid) returning id into v_id;
  end if;
  return jsonb_build_object('authorized', true, 'reason', 'reservada', 'operation_id', v_id, 'status', 'RESERVED', 'limits', v_limits);
end $$;

/** Transicoes: RESERVED->RUNNING (start), RUNNING->RUNNING (progress), RUNNING/RESERVED->SUCCEEDED|FAILED|UNCERTAIN|CANCELLED. */
create or replace function update_vibe_operation(p_id uuid, p_status text, p_fields jsonb default '{}') returns jsonb language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_op radar_vibe_operation; v_role role_kind;
begin
  select * into v_op from radar_vibe_operation where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nao_encontrada'); end if;
  select role into v_role from profile where id = v_uid and active and organization_id = v_op.org_id;
  if v_role is null or (v_op.requested_by <> v_uid and v_role <> 'Administrador') then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  if v_op.status in ('SUCCEEDED','FAILED','CANCELLED') then return jsonb_build_object('ok', false, 'reason', 'operacao_encerrada', 'status', v_op.status); end if;
  if v_op.status = 'UNCERTAIN' and p_status not in ('SUCCEEDED','FAILED') then return jsonb_build_object('ok', false, 'reason', 'reconciliacao_necessaria'); end if;
  if p_status = 'RUNNING' and v_op.status = 'RESERVED' then
    update radar_vibe_operation set status = 'RUNNING', started_at = coalesce(started_at, now()), credits_before = coalesce((p_fields->>'credits_before')::numeric, credits_before) where id = p_id;
  elsif p_status = 'RUNNING' then
    update radar_vibe_operation set records_returned = records_returned + coalesce((p_fields->>'records_delta')::integer, 0), correlation_ids = correlation_ids || coalesce(array(select jsonb_array_elements_text(p_fields->'correlation_ids')), '{}'), credits_after = coalesce((p_fields->>'credits_after')::numeric, credits_after), result_summary = coalesce(p_fields->'result_summary', result_summary) where id = p_id;
  elsif p_status in ('SUCCEEDED','FAILED','UNCERTAIN','CANCELLED') then
    update radar_vibe_operation set status = p_status, finished_at = now(),
      credits_after = coalesce((p_fields->>'credits_after')::numeric, credits_after),
      actual_credits = case when p_status = 'SUCCEEDED' then coalesce((p_fields->>'actual_credits')::numeric, credits_before - coalesce((p_fields->>'credits_after')::numeric, credits_after)) else actual_credits end,
      reserved_credits = case when p_status in ('FAILED','CANCELLED') then 0 else reserved_credits end,
      records_returned = records_returned + coalesce((p_fields->>'records_delta')::integer, 0),
      correlation_ids = correlation_ids || coalesce(array(select jsonb_array_elements_text(p_fields->'correlation_ids')), '{}'),
      error_code = p_fields->>'error_code', error_message_sanitized = left(p_fields->>'error_message', 300),
      result_summary = coalesce(p_fields->'result_summary', result_summary)
      where id = p_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'transicao_invalida');
  end if;
  select * into v_op from radar_vibe_operation where id = p_id;
  return jsonb_build_object('ok', true, 'status', v_op.status, 'records_returned', v_op.records_returned, 'reserved_credits', v_op.reserved_credits, 'paid_record_cap', v_op.paid_record_cap, 'operation_type', v_op.operation_type, 'request_hash', v_op.request_hash);
end $$;

/** Leitura de uma operacao pela funcao (estado atual) e resumo de consumo do dia/mes. */
create or replace function vibe_operation_state(p_id uuid) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'operation_type', o.operation_type, 'request_hash', o.request_hash, 'reserved_credits', o.reserved_credits, 'records_returned', o.records_returned, 'paid_record_cap', o.paid_record_cap, 'requested_by', o.requested_by, 'idempotency_key', o.idempotency_key, 'result_summary', o.result_summary)
  from radar_vibe_operation o where o.id = p_id and o.org_id = current_org()
$$;
create or replace function vibe_budget_status(p_credits_available numeric default null) returns jsonb language plpgsql stable security definer as $$
declare v_org uuid := current_org(); v_pol radar_vibe_credit_policy; v_day numeric; v_month numeric;
begin
  select * into v_pol from radar_vibe_credit_policy where org_id = v_org;
  if not found then return jsonb_build_object('policy', null); end if;
  v_day := vibe_credits_committed(v_org, date_trunc('day', now())); v_month := vibe_credits_committed(v_org, date_trunc('month', now()));
  return jsonb_build_object('enabled', v_pol.enabled, 'daily_budget', v_pol.daily_budget, 'daily_used', v_day, 'daily_remaining', v_pol.daily_budget - v_day, 'monthly_budget', v_pol.monthly_budget, 'monthly_remaining', v_pol.monthly_budget - v_month, 'reserve_credits', v_pol.reserve_credits, 'max_credits_per_operation', v_pol.max_credits_per_operation, 'max_paid_records_per_operation', v_pol.max_paid_records_per_operation, 'email_cache_days', v_pol.email_cache_days, 'allowed_roles', to_jsonb(v_pol.allowed_roles), 'validated_filters', v_pol.validated_filters, 'validated_at', v_pol.validated_at, 'available_minus_reserve', case when p_credits_available is null then null else p_credits_available - v_pol.reserve_credits end, 'uncertain_operations', (select count(*) from radar_vibe_operation where org_id = v_org and status = 'UNCERTAIN'));
end $$;
grant execute on function reserve_vibe_operation(text, text, text, numeric, integer, numeric, integer, boolean) to authenticated;
grant execute on function update_vibe_operation(uuid, text, jsonb) to authenticated;
grant execute on function vibe_operation_state(uuid) to authenticated;
grant execute on function vibe_budget_status(numeric) to authenticated;
grant execute on function vibe_credits_committed(uuid, timestamptz) to authenticated;

-- Política inicial para as organizações existentes (idempotente); novas organizações recebem a linha na primeira reserva.
insert into radar_vibe_credit_policy (org_id) select id from organization on conflict (org_id) do nothing;

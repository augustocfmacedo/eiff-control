-- Vibe/Explorium: fronteira de confianca das RPCs de consumo.
-- - reserve_vibe_operation e update_vibe_operation passam a ser server-only (EXECUTE so para service_role) e recebem
--   o usuario ja validado pela funcao Netlify (p_user_id); o saldo (p_credits_available) vem do servidor, nunca do navegador.
-- - vibe_credits_committed deixa de ser chamavel por authenticated (so por service_role e pelas funcoes definer).
-- - Toda funcao SECURITY DEFINER do modulo fixa search_path = public, pg_temp.
-- - Politica de creditos: leitura por Administrador/Diretoria; alteracao so por Administrador (Diretoria nao aumenta
--   o proprio teto); catalogo validado e gravado pela funcao Netlify com service_role.

-- ---------------------------------------------------------------------------------------------------- RPCs antigas
drop function if exists reserve_vibe_operation(text, text, text, numeric, integer, numeric, integer, boolean);
drop function if exists update_vibe_operation(uuid, text, jsonb);

-- ---------------------------------------------------------------------------------------------------- consumo comprometido
create or replace function vibe_credits_committed(p_org uuid, p_since timestamptz) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when status in ('RESERVED','RUNNING','UNCERTAIN') then reserved_credits when status = 'SUCCEEDED' then coalesce(actual_credits, reserved_credits) else 0 end), 0)
  from radar_vibe_operation where org_id = p_org and created_at >= p_since
$$;
revoke execute on function vibe_credits_committed(uuid, timestamptz) from public, anon, authenticated;
grant execute on function vibe_credits_committed(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------- reserva (server-only)
/**
 * Reserva transacional chamada SOMENTE pela funcao Netlify com service_role, depois de validar o JWT do usuario.
 * p_user_id: usuario ja autenticado no servidor. p_credits_available: saldo consultado pelo servidor na Explorium.
 * Retorna jsonb { authorized, status, operation_id, reason, limits }. p_dry_run = true so avalia, sem gravar.
 */
create or replace function reserve_vibe_operation(
  p_user_id uuid, p_idempotency_key text, p_request_hash text, p_operation_type text, p_estimated_credits numeric, p_records_requested integer,
  p_credits_available numeric, p_paid_record_cap integer default null, p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_role role_kind; v_pol radar_vibe_credit_policy; v_existing radar_vibe_operation;
  v_day numeric; v_month numeric; v_limit numeric; v_reason text; v_id uuid; v_limits jsonb;
begin
  -- defesa em profundidade alem do GRANT: via PostgREST so o service_role chega aqui
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('authorized', false, 'reason', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('authorized', false, 'reason', 'nao_autenticado'); end if;
  if p_credits_available is null then return jsonb_build_object('authorized', false, 'reason', 'saldo_nao_informado'); end if;
  select organization_id, role into v_org, v_role from profile where id = p_user_id and active;
  if v_org is null then return jsonb_build_object('authorized', false, 'reason', 'sem_perfil'); end if;
  -- serializa reservas da organizacao: duas requisicoes simultaneas nao reservam o mesmo saldo
  perform pg_advisory_xact_lock(hashtext('vibe:' || v_org::text));
  select * into v_pol from radar_vibe_credit_policy where org_id = v_org;
  if not found then
    insert into radar_vibe_credit_policy (org_id, updated_by) values (v_org, p_user_id) returning * into v_pol;
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
  -- auditoria (audit_row) atribui a escrita ao usuario validado, nao ao service_role; desfeito logo depois
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  if v_existing.id is not null then
    update radar_vibe_operation set status = 'RESERVED', request_hash = p_request_hash, operation_type = p_operation_type, estimated_credits = p_estimated_credits, reserved_credits = p_estimated_credits, records_requested = p_records_requested, paid_record_cap = p_paid_record_cap, requested_by = p_user_id, started_at = null, finished_at = null, error_code = null, error_message_sanitized = null, result_summary = null, records_returned = 0, correlation_ids = '{}', actual_credits = null, credits_before = null, credits_after = null
      where id = v_existing.id returning id into v_id;
  else
    insert into radar_vibe_operation (org_id, idempotency_key, request_hash, operation_type, status, estimated_credits, reserved_credits, records_requested, paid_record_cap, requested_by)
      values (v_org, p_idempotency_key, p_request_hash, p_operation_type, 'RESERVED', p_estimated_credits, p_estimated_credits, p_records_requested, p_paid_record_cap, p_user_id) returning id into v_id;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('authorized', true, 'reason', 'reservada', 'operation_id', v_id, 'status', 'RESERVED', 'limits', v_limits);
end $$;
revoke execute on function reserve_vibe_operation(uuid, text, text, text, numeric, integer, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function reserve_vibe_operation(uuid, text, text, text, numeric, integer, numeric, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------- transicoes (server-only)
/** Transicoes: RESERVED->RUNNING (start), RUNNING->RUNNING (progress), RUNNING/RESERVED->SUCCEEDED|FAILED|UNCERTAIN|CANCELLED. */
create or replace function update_vibe_operation(p_user_id uuid, p_id uuid, p_status text, p_fields jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'; v_op radar_vibe_operation; v_role role_kind;
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'reason', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('ok', false, 'reason', 'nao_autenticado'); end if;
  select * into v_op from radar_vibe_operation where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nao_encontrada'); end if;
  select role into v_role from profile where id = p_user_id and active and organization_id = v_op.org_id;
  if v_role is null or (v_op.requested_by <> p_user_id and v_role <> 'Administrador') then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  if v_op.status in ('SUCCEEDED','FAILED','CANCELLED') then return jsonb_build_object('ok', false, 'reason', 'operacao_encerrada', 'status', v_op.status); end if;
  if v_op.status = 'UNCERTAIN' and p_status not in ('SUCCEEDED','FAILED') then return jsonb_build_object('ok', false, 'reason', 'reconciliacao_necessaria'); end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true); -- auditoria atribuida ao usuario; desfeito abaixo
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
    perform set_config('request.jwt.claim.sub', '', true);
    return jsonb_build_object('ok', false, 'reason', 'transicao_invalida');
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  select * into v_op from radar_vibe_operation where id = p_id;
  return jsonb_build_object('ok', true, 'status', v_op.status, 'records_returned', v_op.records_returned, 'reserved_credits', v_op.reserved_credits, 'paid_record_cap', v_op.paid_record_cap, 'operation_type', v_op.operation_type, 'request_hash', v_op.request_hash);
end $$;
revoke execute on function update_vibe_operation(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function update_vibe_operation(uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------- leitura (authenticated, current_org)
create or replace function vibe_operation_state(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'operation_type', o.operation_type, 'request_hash', o.request_hash, 'reserved_credits', o.reserved_credits, 'records_returned', o.records_returned, 'paid_record_cap', o.paid_record_cap, 'requested_by', o.requested_by, 'idempotency_key', o.idempotency_key, 'result_summary', o.result_summary, 'credits_before', o.credits_before, 'credits_after', o.credits_after)
  from radar_vibe_operation o where o.id = p_id and o.org_id = current_org()
$$;
create or replace function vibe_budget_status(p_credits_available numeric default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := current_org(); v_pol radar_vibe_credit_policy; v_day numeric; v_month numeric;
begin
  if v_org is null or not has_role('Administrador', 'Diretoria') then return jsonb_build_object('policy', null, 'reason', 'papel_nao_permitido'); end if;
  select * into v_pol from radar_vibe_credit_policy where org_id = v_org;
  if not found then return jsonb_build_object('policy', null); end if;
  v_day := vibe_credits_committed(v_org, date_trunc('day', now())); v_month := vibe_credits_committed(v_org, date_trunc('month', now()));
  return jsonb_build_object('enabled', v_pol.enabled, 'daily_budget', v_pol.daily_budget, 'daily_used', v_day, 'daily_remaining', v_pol.daily_budget - v_day, 'monthly_budget', v_pol.monthly_budget, 'monthly_remaining', v_pol.monthly_budget - v_month, 'reserve_credits', v_pol.reserve_credits, 'max_credits_per_operation', v_pol.max_credits_per_operation, 'max_paid_records_per_operation', v_pol.max_paid_records_per_operation, 'email_cache_days', v_pol.email_cache_days, 'allowed_roles', to_jsonb(v_pol.allowed_roles), 'validated_filters', v_pol.validated_filters, 'validated_at', v_pol.validated_at, 'available_minus_reserve', case when p_credits_available is null then null else p_credits_available - v_pol.reserve_credits end, 'uncertain_operations', (select count(*) from radar_vibe_operation where org_id = v_org and status = 'UNCERTAIN'));
end $$;
revoke execute on function vibe_operation_state(uuid) from public, anon;
revoke execute on function vibe_budget_status(numeric) from public, anon;
grant execute on function vibe_operation_state(uuid) to authenticated, service_role;
grant execute on function vibe_budget_status(numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- politica de creditos
drop policy if exists rvcp_select on radar_vibe_credit_policy;
drop policy if exists rvcp_config on radar_vibe_credit_policy;
drop policy if exists rvcp_update on radar_vibe_credit_policy;
create policy rvcp_select on radar_vibe_credit_policy for select using (org_id = current_org() and has_role('Administrador', 'Diretoria'));
-- limites financeiros e papeis: so Administrador (Diretoria nao aumenta o proprio teto); catalogo validado: funcao Netlify (service_role)
create policy rvcp_update on radar_vibe_credit_policy for update using (org_id = current_org() and has_role('Administrador')) with check (org_id = current_org() and has_role('Administrador'));
revoke insert, update on radar_vibe_credit_policy from authenticated;
grant select, update (enabled, daily_budget, monthly_budget, reserve_credits, max_credits_per_operation, max_paid_records_per_operation, email_cache_days, allowed_roles, updated_at, updated_by) on radar_vibe_credit_policy to authenticated;
revoke all on radar_vibe_operation from anon;

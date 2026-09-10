-- Send Canary 01: coerencia de canal tambem no banco (defesa em profundidade).
-- Incremental sobre 0047 (so troca o corpo de radar_delivery_create). Uma comunicacao de e-mail nunca pode gerar
-- entrega Octadesk, mesmo que o handler falhe: a entrega precisa ter o MESMO canal da comunicacao, e OCTADESK so
-- entrega WHATSAPP. Espelha validarCoerenciaCanal em src/core/radar/canais.ts.
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
  select id, organization_id, company_id, contact_id, state, channel into v_com from radar_communication where id = p_communication_id;
  if v_com.id is null then return jsonb_build_object('ok', false, 'erro', 'comunicacao_nao_encontrada'); end if;
  if v_com.organization_id <> v_org then return jsonb_build_object('ok', false, 'erro', 'comunicacao_de_outra_organizacao'); end if;
  if v_com.state <> 'APPROVED' then return jsonb_build_object('ok', false, 'erro', 'comunicacao_nao_aprovada', 'estado', v_com.state); end if;
  -- coerencia de canal (defesa em profundidade; o handler ja valida antes)
  if p_channel is distinct from v_com.channel then
    return jsonb_build_object('ok', false, 'erro', 'canal_incoerente', 'canal_comunicacao', v_com.channel, 'canal_entrega', p_channel);
  end if;
  if p_provider = 'OCTADESK' and v_com.channel <> 'WHATSAPP' then
    return jsonb_build_object('ok', false, 'erro', 'canal_incoerente', 'motivo', 'Octadesk só entrega WhatsApp', 'canal_comunicacao', v_com.channel);
  end if;

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

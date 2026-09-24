-- 0057 — EIFF Inbox, fase 3: OCTOPUS ROUTER (docs/eiff-inbox.md §14). Idempotente. Nao altera a semantica da 0056.
--
-- O que muda:
--   1) inbox_thread.routing (jsonb): a decisao de roteamento (setor/equipe/pessoa sugeridos, confianca, banda, sinais,
--      automacao, SLA, reavaliacao, override humano) — auditavel, minimizada pelo mesmo CHECK de PII da classificacao;
--      atualizavel por `authenticated` (e edicao de dado, como classification) e pela RPC server-only abaixo.
--   2) inbox_thread_event: tipos ROUTING_DECIDED, ROUTING_OVERRIDDEN e ROUTING_REEVALUATED.
--   3) inbox_config.auto_routing (limiares e modo padrao) e inbox_config.automation_rules (regras AUTO/APPROVAL/HUMAN).
--   4) RPC inbox_apply_routing (service_role): passos 13-15 do router no servidor — persiste classificacao/decisao,
--      aplica a atribuicao dentro do contexto permitido (setor ativo da organizacao, equipe do setor, pessoa ativa e
--      membro do setor ou padrao do setor/equipe), deriva o status, respeita override humano e registra os eventos,
--      tudo numa transacao. Nunca chamada pelo navegador (EXECUTE so para service_role); a atribuicao humana continua
--      pela inbox_assign_thread da 0056, inalterada.
--   5) inbox_thread_autoridade: override humano (routing.override) so pode ser escrito por quem tem autoridade de
--      atribuir (a mesma regra da RPC): transversal, responsavel atual, gestor do setor, ou triagem sem setor.

-- 1) decisao do router na thread ---------------------------------------------------------------------------------
alter table inbox_thread add column if not exists routing jsonb;
alter table inbox_thread drop constraint if exists inbox_thread_routing_chk;
alter table inbox_thread add constraint inbox_thread_routing_chk check (routing is null or (jsonb_typeof(routing) = 'object' and inbox_jsonb_seguro(routing)));
grant update (routing) on inbox_thread to authenticated;

-- 2) eventos novos ------------------------------------------------------------------------------------------------
alter table inbox_thread_event drop constraint if exists inbox_thread_event_event_type_check;
alter table inbox_thread_event add constraint inbox_thread_event_event_type_check check (event_type in (
  'THREAD_CREATED', 'THREAD_REOPENED', 'MESSAGE_RECEIVED', 'MESSAGE_REGISTERED', 'NOTE_ADDED', 'AI_ANALYZED', 'TRIAGED', 'ROUTED',
  'ASSIGNED', 'REASSIGNED', 'RELEASED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'LABELS_CHANGED', 'SLA_ESCALATED',
  'ACTION_PROPOSED', 'ACTION_APPROVED', 'ACTION_REJECTED', 'ACTION_EXECUTED', 'JOB_CREATED', 'JOB_COMPLETED', 'JOB_FAILED',
  'RESOLVED', 'CLOSED', 'ROUTING_DECIDED', 'ROUTING_OVERRIDDEN', 'ROUTING_REEVALUATED'));

-- 3) configuracao: limiares e regras de automacao -----------------------------------------------------------------
alter table inbox_config add column if not exists auto_routing jsonb not null default '{}'::jsonb;
alter table inbox_config add column if not exists automation_rules jsonb not null default '[]'::jsonb;
alter table inbox_config drop constraint if exists inbox_config_auto_routing_chk;
alter table inbox_config add constraint inbox_config_auto_routing_chk check (jsonb_typeof(auto_routing) = 'object');
alter table inbox_config drop constraint if exists inbox_config_automation_rules_chk;
alter table inbox_config add constraint inbox_config_automation_rules_chk check (jsonb_typeof(automation_rules) = 'array');

-- 4) RPC server-only: aplicar a decisao do router -----------------------------------------------------------------
create or replace function inbox_apply_routing(
  p_organization_id uuid, p_thread_id uuid, p_message_id uuid,
  p_routing jsonb, p_classification jsonb default null, p_summary text default null,
  p_sector_code text default null, p_team_id uuid default null, p_assignee_id uuid default null,
  p_priority text default null, p_service_level text default null, p_apply boolean default true
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  t inbox_thread; v_sector uuid; v_team uuid; v_now timestamptz := now();
  v_prio text; v_rank_old int; v_rank_new int; v_level text; v_sla timestamptz; v_horas numeric;
  v_override jsonb; v_routing jsonb; v_apply boolean := coalesce(p_apply, true); v_motivo text := null;
  v_assign uuid; v_eventos uuid[] := '{}'; v_ev uuid; v_novo_status text; v_cod_de text; v_nome_de text; v_nome_para text;
  v_permitido boolean; v_detalhe text;
begin
  -- so o servidor (service_role) aplica roteamento automatico; o navegador nunca chega aqui
  if auth.uid() is not null or coalesce(v_caller, '') not in ('service_role', '') then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_routing is null or jsonb_typeof(p_routing) <> 'object' or not inbox_jsonb_seguro(p_routing) then return jsonb_build_object('ok', false, 'erro', 'routing_invalido'); end if;
  if p_classification is not null and (jsonb_typeof(p_classification) <> 'object' or not inbox_jsonb_seguro(p_classification)) then return jsonb_build_object('ok', false, 'erro', 'classificacao_invalida'); end if;
  if p_priority is not null and p_priority not in ('Baixa', 'Normal', 'Alta', 'Urgente') then return jsonb_build_object('ok', false, 'erro', 'prioridade_invalida'); end if;
  if p_service_level is not null and p_service_level not in ('A', 'B', 'C') then return jsonb_build_object('ok', false, 'erro', 'nivel_invalido'); end if;

  select * into t from inbox_thread where id = p_thread_id and organization_id = p_organization_id for update;
  if t.id is null then return jsonb_build_object('ok', false, 'erro', 'thread_nao_encontrada'); end if;
  if p_message_id is not null and not exists (select 1 from inbox_message m where m.id = p_message_id and m.thread_id = t.id) then return jsonb_build_object('ok', false, 'erro', 'mensagem_invalida'); end if;

  -- destino: SEMPRE dentro do contexto permitido, mesmo quando so se registra a sugestao
  if p_sector_code is not null then
    select id into v_sector from inbox_sector where organization_id = p_organization_id and code = p_sector_code and active;
    if v_sector is null then return jsonb_build_object('ok', false, 'erro', 'setor_invalido'); end if;
  end if;
  if p_team_id is not null then
    select id into v_team from inbox_team where id = p_team_id and organization_id = p_organization_id and active and sector_id = v_sector;
    if v_team is null then return jsonb_build_object('ok', false, 'erro', 'equipe_invalida'); end if;
  end if;
  if p_assignee_id is not null then
    if v_sector is null then return jsonb_build_object('ok', false, 'erro', 'responsavel_sem_setor'); end if;
    select exists (select 1 from profile p where p.id = p_assignee_id and p.organization_id = p_organization_id and p.active)
      and (exists (select 1 from inbox_member m where m.profile_id = p_assignee_id and m.sector_id = v_sector)
        or exists (select 1 from inbox_sector s where s.id = v_sector and s.default_assignee_id = p_assignee_id)
        or (v_team is not null and exists (select 1 from inbox_team q where q.id = v_team and q.default_assignee_id = p_assignee_id)))
      into v_permitido;
    if not v_permitido then return jsonb_build_object('ok', false, 'erro', 'responsavel_fora_do_contexto'); end if;
  end if;

  -- prioridade so sobe; nivel so pela politica (o servidor manda o que o router decidiu)
  v_rank_old := case t.priority when 'Baixa' then 0 when 'Normal' then 1 when 'Alta' then 2 else 3 end;
  v_rank_new := case coalesce(p_priority, t.priority) when 'Baixa' then 0 when 'Normal' then 1 when 'Alta' then 2 else 3 end;
  v_prio := case when v_rank_new > v_rank_old then p_priority else t.priority end;
  v_level := coalesce(p_service_level, t.service_level);
  v_sla := t.sla_first_response_due;
  if v_sla is null then
    select coalesce((c.sla_hours ->> v_prio)::numeric, 24) into v_horas from inbox_config c where c.organization_id = p_organization_id;
    v_sla := t.opened_at + (coalesce(v_horas, 24) * interval '1 hour');
  end if;

  -- override humano preservado: a decisao nova entra, o override continua e NADA e movido
  v_override := t.routing -> 'override';
  v_routing := p_routing;
  if v_override is not null then v_routing := v_routing || jsonb_build_object('override', v_override); v_apply := false; v_motivo := 'override_humano'; end if;

  perform set_config('inbox.governada', 'on', true);
  update inbox_thread set routing = v_routing, classification = coalesce(p_classification, classification), summary = coalesce(left(p_summary, 600), summary),
    priority = v_prio, service_level = v_level, sla_first_response_due = v_sla where id = t.id;
  perform set_config('inbox.governada', '', true);

  if p_classification is not null then
    insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, occurred_at, actor_kind, actor_name, detail)
      values (p_organization_id, t.id, p_message_id, 'AI_ANALYZED', v_now, 'ia', coalesce(left(p_classification ->> 'provedor', 40), 'IA'),
        left('intenção ' || coalesce(p_classification ->> 'intencao', '—') || ' · confiança ' || coalesce(round((p_classification ->> 'confianca')::numeric * 100)::text, '—') || '%', 500))
      returning id into v_ev;
    v_eventos := v_eventos || v_ev;
  end if;
  v_detalhe := regexp_replace(left(coalesce(p_routing ->> 'aplicacao', '—') || ' ' || coalesce(p_sector_code, '—') || ' · ' || coalesce(round((p_routing ->> 'confianca')::numeric * 100)::text, '—') || '% (' || coalesce(p_routing ->> 'banda', '—') || ') · automação ' || coalesce(p_routing -> 'automacao' ->> 'modo', '—') || ' · ' || coalesce(p_routing ->> 'motivoOperacional', ''), 500), '[0-9]{9,}', '***', 'g');
  select code into v_cod_de from inbox_sector where id = t.sector_id;
  insert into inbox_thread_event (organization_id, thread_id, message_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
    values (p_organization_id, t.id, p_message_id, 'ROUTING_DECIDED', v_now, 'sistema', 'Octopus Router', v_detalhe, v_cod_de, p_sector_code)
    returning id into v_ev;
  v_eventos := v_eventos || v_ev;
  if v_prio <> t.priority then
    insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
      values (p_organization_id, t.id, 'PRIORITY_CHANGED', v_now, 'sistema', 'Octopus Router', 'prioridade pelo roteamento', t.priority, v_prio) returning id into v_ev;
    v_eventos := v_eventos || v_ev;
  end if;

  -- aplicar (TRIAGEM = p_apply false: so a sugestao fica registrada e a thread continua em Nao atribuidos)
  if not v_apply or v_sector is null then
    return jsonb_build_object('ok', true, 'aplicado', false, 'motivo', coalesce(v_motivo, 'sugestao_registrada'), 'thread_id', t.id, 'status', t.status, 'event_ids', to_jsonb(v_eventos));
  end if;
  if v_sector is not distinct from t.sector_id and v_team is not distinct from t.team_id and p_assignee_id is not distinct from t.assignee_id then
    return jsonb_build_object('ok', true, 'aplicado', false, 'motivo', 'sem_mudanca', 'thread_id', t.id, 'status', t.status, 'event_ids', to_jsonb(v_eventos));
  end if;
  v_novo_status := t.status;
  if t.status in ('NOVA', 'TRIADA', 'ATRIBUIDA') then
    v_novo_status := case when p_assignee_id is not null then 'ATRIBUIDA' when t.status = 'ATRIBUIDA' then 'TRIADA' else 'TRIADA' end;
  elsif p_assignee_id is null and t.status in ('AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO') then
    v_novo_status := 'TRIADA';
  end if;

  update inbox_assignment set released_at = v_now where thread_id = t.id and released_at is null;
  insert into inbox_assignment (organization_id, thread_id, sector_id, team_id, assignee_id, assigned_at, reason, origin, actor_id)
    values (p_organization_id, t.id, v_sector, v_team, p_assignee_id, v_now, left(p_routing ->> 'motivoOperacional', 500), 'roteamento', null) returning id into v_assign;
  perform set_config('inbox.governada', 'on', true);
  update inbox_thread set sector_id = v_sector, team_id = v_team, assignee_id = p_assignee_id, status = v_novo_status where id = t.id;
  perform set_config('inbox.governada', '', true);

  if v_sector is distinct from t.sector_id or v_team is distinct from t.team_id then
    insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
      values (p_organization_id, t.id, case when t.sector_id is null then 'ROUTED' else 'REASSIGNED' end, v_now, 'sistema', 'Octopus Router',
        regexp_replace(left('setor ' || coalesce(v_cod_de, '—') || ' → ' || coalesce(p_sector_code, '—') || ' · ' || coalesce(p_routing ->> 'motivoOperacional', ''), 500), '[0-9]{9,}', '***', 'g'), v_cod_de, p_sector_code)
      returning id into v_ev;
    v_eventos := v_eventos || v_ev;
  end if;
  if p_assignee_id is distinct from t.assignee_id then
    select name into v_nome_de from profile where id = t.assignee_id;
    select name into v_nome_para from profile where id = p_assignee_id;
    insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
      values (p_organization_id, t.id, case when p_assignee_id is null then 'RELEASED' when t.assignee_id is null then 'ASSIGNED' else 'REASSIGNED' end, v_now, 'sistema', 'Octopus Router',
        left('responsável ' || coalesce(v_nome_de, '—') || ' → ' || coalesce(v_nome_para, '—') || ' · roteamento', 500), t.assignee_id::text, p_assignee_id::text)
      returning id into v_ev;
    v_eventos := v_eventos || v_ev;
  end if;
  if v_novo_status <> t.status then
    insert into inbox_thread_event (organization_id, thread_id, event_type, occurred_at, actor_kind, actor_name, detail, before_value, after_value)
      values (p_organization_id, t.id, 'STATUS_CHANGED', v_now, 'sistema', 'Octopus Router', 'status derivado do roteamento', t.status, v_novo_status) returning id into v_ev;
    v_eventos := v_eventos || v_ev;
  end if;
  return jsonb_build_object('ok', true, 'aplicado', true, 'thread_id', t.id, 'assignment_id', v_assign, 'status', v_novo_status, 'event_ids', to_jsonb(v_eventos));
end $$;
revoke execute on function inbox_apply_routing(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function inbox_apply_routing(uuid, uuid, uuid, jsonb, jsonb, text, text, uuid, uuid, text, text, boolean) to service_role;

-- 5) override humano so por quem tem autoridade de atribuir (segunda camada; a primeira e o store) -----------------
create or replace function inbox_thread_autoridade() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_trans boolean; v_ok boolean; v_novos uuid[];
begin
  if v_uid is null then return new; end if;                                   -- service_role (ingestao / router) nao passa por aqui
  if coalesce(current_setting('inbox.governada', true), '') = 'on' then return new; end if;  -- dentro da RPC ja autorizada
  v_trans := inbox_config_role();
  if new.sector_id is distinct from old.sector_id or new.team_id is distinct from old.team_id or new.assignee_id is distinct from old.assignee_id then
    raise exception 'atribuição só pela operação governada inbox_assign_thread';
  end if;
  if new.status is distinct from old.status or new.priority is distinct from old.priority or new.service_level is distinct from old.service_level then
    v_ok := v_trans or old.assignee_id = v_uid or inbox_gestor_de(old.sector_id)
      or (old.assignee_id is null and (old.sector_id is null or old.sector_id in (select inbox_user_sectors())) and new.status in ('TRIADA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'FECHADA'));
    if not v_ok then raise exception 'sem autoridade para mudar status, prioridade ou nível desta conversa'; end if;
  end if;
  if new.participant_ids is distinct from old.participant_ids and not v_trans then
    select coalesce(array_agg(p), '{}') into v_novos from unnest(new.participant_ids) p where not (p = any (old.participant_ids)) and p <> v_uid;
    if array_length(v_novos, 1) > 0 then raise exception 'participante só entra por conta própria (quem escreve ou decide)'; end if;
  end if;
  -- override humano do roteamento: mesma autoridade de atribuir (transversal, responsavel, gestor do setor, triagem sem setor)
  if (new.routing -> 'override') is distinct from (old.routing -> 'override') and (new.routing -> 'override') is not null then
    v_ok := v_trans or old.assignee_id = v_uid or inbox_gestor_de(old.sector_id) or (old.assignee_id is null and old.sector_id is null)
      or (old.assignee_id is null and old.sector_id in (select inbox_user_sectors()));
    if not v_ok then raise exception 'sem autoridade para sobrescrever o roteamento desta conversa'; end if;
    if (new.routing -> 'override' ->> 'por') is distinct from v_uid::text and not v_trans then raise exception 'override tem de ser de quem o faz (auth.uid())'; end if;
  end if;
  return new;
end $$;

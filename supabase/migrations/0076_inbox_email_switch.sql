-- 0076 — EIFF Inbox: CHAVE CENTRAL do envio de e-mail comercial (docs/email-comercial-chave-central.md).
--
-- NAO APLICADA EM PRODUCAO. A aplicacao exige «APLICAÇÃO 0076 AUTORIZADA» e o envelope de scripts/email-0076/.
-- Prova em banco descartavel: `npm run smoke:email-chave` (PGlite, ROLLBACK ao final).
--
-- Por que existe: a variavel EIFF_EMAIL_SEND_MODE vale POR DEPLOY (o Netlify congela as variaveis no build). Um deploy
-- construido com o envio ligado continua respondendo pelo endereco proprio ate ser apagado. A chave central fica no
-- BANCO, que todos os deploys consultam, e por isso desliga TODOS ao mesmo tempo.
--
-- Como revoga tambem o codigo ja publicado: todo codigo de envio publicado segue «livro primeiro» — cria a entrega
-- (inbox_email_delivery_create), leva a REQUESTED (inbox_email_delivery_transition) e so entao chama o Google. Uma
-- recusa de qualquer uma dessas duas RPCs faz o codigo parar SEM chamar o Google (erro desconhecido do livro vira
-- `livro_indisponivel`; transicao sem `ok: true` encerra o pedido). A chave e conferida dentro das duas.
--
-- O que a chave NAO faz: nao cancela uma chamada ao Google que ja comecou. Uma entrega que ja estava REQUESTED quando
-- a chave desligou pode terminar ACCEPTED, FAILED ou UNKNOWN; o desligamento registra quantas eram.
--
-- O que cria:
--   1) inbox_email_switch — uma linha por organizacao. SEM LINHA = BLOQUEADO. Semeada DESLIGADA;
--   2) inbox_email_switch_event — historico IMUTAVEL de cada mudanca (ator, papel, motivo, entregas em curso);
--   3) motivo `envio_bloqueado` no livro;
--   4) create e transition (REQUESTED) passam a conferir a chave; accept, FAILED, UNKNOWN e reconciliacao NAO;
--   5) inbox_email_switch_set (Administrador liga e desliga, Diretoria so desliga; motivo obrigatorio) e
--      inbox_email_switch_desligar_sistema (so service_role/dono do banco, so desliga: emergencia sem o app).
-- Idempotente: pode ser reaplicada (a linha semeada nao e sobrescrita).

-- ---------------------------------------------------------------------------------------------------------------
-- 1) a chave e o historico
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists inbox_email_switch (
  organization_id uuid primary key references organization(id),
  enabled boolean not null default false,
  version bigint not null default 1 check (version >= 1),
  reason text not null check (length(trim(reason)) between 3 and 500),
  changed_by uuid references profile(id),
  changed_by_kind text not null check (changed_by_kind in ('USER', 'SYSTEM')),
  changed_at timestamptz not null default now()
);

create table if not exists inbox_email_switch_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  from_enabled boolean,
  to_enabled boolean not null,
  version bigint not null,
  reason text not null,
  actor_id uuid references profile(id),
  actor_kind text not null check (actor_kind in ('USER', 'SYSTEM')),
  actor_role text,
  -- entregas sem desfecho no instante da mudanca: READY sera barrada na transicao; REQUESTED ja foi autorizada e a
  -- chamada ao Google pode estar em curso (nao e cancelada); UNKNOWN espera reconciliacao
  pending_ready integer not null default 0,
  pending_requested integer not null default 0,
  pending_unknown integer not null default 0,
  occurred_at timestamptz not null default now()
);
create index if not exists inbox_email_switch_event_idx on inbox_email_switch_event (organization_id, occurred_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 2) guardas: a chave so muda pelas funcoes; o historico nasce do gatilho e nunca muda
-- ---------------------------------------------------------------------------------------------------------------
create or replace function inbox_email_switch_guarda() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ator uuid := nullif(current_setting('inbox.email_switch_ator', true), '')::uuid;
  v_tipo text := coalesce(nullif(current_setting('inbox.email_switch_ator_tipo', true), ''), 'SYSTEM');
  v_papel text := nullif(current_setting('inbox.email_switch_papel', true), '');
  v_r integer; v_q integer; v_u integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'a chave do e-mail comercial não pode ser apagada (organização %)', old.organization_id;
  end if;
  if coalesce(current_setting('inbox.email_switch_governado', true), '') <> 'on' then
    raise exception 'a chave do e-mail comercial só muda pelas funções da chave';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'a organização da chave do e-mail comercial é imutável';
  end if;
  select count(*) filter (where status = 'READY'), count(*) filter (where status = 'REQUESTED'), count(*) filter (where status = 'UNKNOWN')
    into v_r, v_q, v_u from inbox_email_delivery where organization_id = new.organization_id and status in ('READY', 'REQUESTED', 'UNKNOWN');
  perform set_config('inbox.email_switch_evento', 'on', true);
  insert into inbox_email_switch_event (organization_id, from_enabled, to_enabled, version, reason, actor_id, actor_kind, actor_role, pending_ready, pending_requested, pending_unknown)
    values (new.organization_id, case when tg_op = 'UPDATE' then old.enabled end, new.enabled, new.version, new.reason, v_ator, v_tipo, v_papel, v_r, v_q, v_u);
  perform set_config('inbox.email_switch_evento', '', true);
  return null;
end $$;

create or replace function inbox_email_switch_pre() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a chave do e-mail comercial não pode ser apagada (organização %)', old.organization_id;
  end if;
  if coalesce(current_setting('inbox.email_switch_governado', true), '') <> 'on' then
    raise exception 'a chave do e-mail comercial só muda pelas funções da chave';
  end if;
  return new;
end $$;

drop trigger if exists inbox_email_switch_pre on inbox_email_switch;
create trigger inbox_email_switch_pre before insert or update or delete on inbox_email_switch for each row execute function inbox_email_switch_pre();
drop trigger if exists inbox_email_switch_evento on inbox_email_switch;
create trigger inbox_email_switch_evento after insert or update on inbox_email_switch for each row execute function inbox_email_switch_guarda();

create or replace function inbox_email_switch_evento_guarda() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and coalesce(current_setting('inbox.email_switch_evento', true), '') = 'on' then return new; end if;
  raise exception 'histórico da chave do e-mail comercial é imutável (%)', tg_op;
end $$;
drop trigger if exists inbox_email_switch_event_guarda on inbox_email_switch_event;
create trigger inbox_email_switch_event_guarda before insert or update or delete on inbox_email_switch_event for each row execute function inbox_email_switch_evento_guarda();

create or replace function inbox_email_switch_sem_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'a chave do e-mail comercial e o histórico dela não podem ser esvaziados (%)', tg_table_name;
end $$;
drop trigger if exists inbox_email_switch_no_truncate on inbox_email_switch;
create trigger inbox_email_switch_no_truncate before truncate on inbox_email_switch for each statement execute function inbox_email_switch_sem_truncate();
drop trigger if exists inbox_email_switch_event_no_truncate on inbox_email_switch_event;
create trigger inbox_email_switch_event_no_truncate before truncate on inbox_email_switch_event for each statement execute function inbox_email_switch_sem_truncate();

-- ---------------------------------------------------------------------------------------------------------------
-- 3) motivo novo no livro
-- ---------------------------------------------------------------------------------------------------------------
do $m$
declare v_nome text;
begin
  for v_nome in
    select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
     where t.relname = 'inbox_email_delivery' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%declarado_encontrado%'
  loop
    execute format('alter table inbox_email_delivery drop constraint %I', v_nome);
  end loop;
end $m$;
alter table inbox_email_delivery add constraint inbox_email_delivery_reason_check check (reason is null or reason in (
  'credencial_revogada', 'credencial_invalida', 'provedor_indisponivel', 'mensagem_recusada', 'acesso_recusado', 'limite_do_provedor',
  'resultado_desconhecido', 'registro_falhou', 'mensagem_invalida', 'declarado_nao_enviado', 'declarado_encontrado', 'envio_bloqueado'));

-- ---------------------------------------------------------------------------------------------------------------
-- 4) a leitura da chave (interna: so as RPCs a chamam)
-- ---------------------------------------------------------------------------------------------------------------
-- FOR SHARE: enquanto uma criacao ou uma transicao para REQUESTED estiver aberta, o desligamento (FOR UPDATE) espera
-- ela terminar; depois do desligamento confirmado, nenhuma nova entrega passa de READY. Sem linha = bloqueado.
create or replace function inbox_email_envio_liberado(p_organization_id uuid) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v boolean;
begin
  select enabled into v from inbox_email_switch where organization_id = p_organization_id for share;
  return coalesce(v, false);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5) create e transition conferem a chave (o restante igual a 0075)
-- ---------------------------------------------------------------------------------------------------------------
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

  -- idempotencia: a mesma intencao devolve o que ja existe (devolver nao envia nada, por isso vem antes da chave)
  select * into v_d from inbox_email_delivery where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_d.request_fingerprint <> p_fingerprint or v_d.thread_id <> p_thread_id then return jsonb_build_object('ok', false, 'erro', 'intencao_reutilizada'); end if;
    return jsonb_build_object('ok', true, 'nova', false, 'entrega', inbox_email_entrega_json(v_d));
  end if;

  -- 0076: CHAVE CENTRAL. Desligada (ou sem linha): nada nasce.
  if not inbox_email_envio_liberado(p_organization_id) then return jsonb_build_object('ok', false, 'erro', 'envio_bloqueado'); end if;

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
-- 0076: ir a REQUESTED (a autorizacao da chamada ao Google) exige a chave ligada. Desligada:
--   - READY vira FAILED com motivo `envio_bloqueado` NESTA transacao (a conversa fica livre, o historico registra) e
--     a resposta e `ok: false` — o codigo publicado para sem chamar o Google;
--   - qualquer outro estado devolve `ok: false` sem mudar nada (nem a repeticao de um REQUESTED ja concedido).
-- FAILED e UNKNOWN continuam permitidos com a chave desligada: registrar o que aconteceu nunca e bloqueado.
create or replace function inbox_email_delivery_transition(
  p_delivery_id uuid, p_to text, p_actor uuid, p_reason text default null, p_provider_message_id text default null, p_provider_thread_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d inbox_email_delivery; v_nome text; v_bloqueado boolean := false;
begin
  if not inbox_email_somente_servidor() then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_to not in ('REQUESTED', 'FAILED', 'UNKNOWN') then return jsonb_build_object('ok', false, 'erro', 'transicao_invalida'); end if;
  select * into v_d from inbox_email_delivery where id = p_delivery_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'entrega_nao_encontrada'); end if;

  if p_to = 'REQUESTED' and not inbox_email_envio_liberado(v_d.organization_id) then
    if v_d.status <> 'READY' then
      return jsonb_build_object('ok', false, 'erro', 'envio_bloqueado', 'status', v_d.status);
    end if;
    if p_actor is not null and not exists (select 1 from profile where id = p_actor and organization_id = v_d.organization_id) then
      return jsonb_build_object('ok', false, 'erro', 'ator_invalido');
    end if;
    v_bloqueado := true;
    p_to := 'FAILED'; p_reason := 'envio_bloqueado'; p_provider_message_id := null; p_provider_thread_id := null;
  end if;

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
              case when v_bloqueado then 'e-mail NÃO enviado: o envio de e-mail está bloqueado pela chave central; não conta como resposta'
                   when p_to = 'FAILED' then 'e-mail NÃO enviado (' || p_reason || '): não conta como resposta'
                   else 'resultado do envio de e-mail DESCONHECIDO (' || p_reason || '): não reenviar; conferir a pasta Enviados' end);
  end if;
  perform set_config('inbox.email_governado', '', true);
  if v_bloqueado then
    return jsonb_build_object('ok', false, 'erro', 'envio_bloqueado', 'entrega', inbox_email_entrega_json(v_d));
  end if;
  return jsonb_build_object('ok', true, 'entrega', inbox_email_entrega_json(v_d));
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6) ligar e desligar
-- ---------------------------------------------------------------------------------------------------------------
-- Quem: o usuario do JWT (auth.uid()), perfil ATIVO. Administrador liga e desliga; Diretoria so desliga.
-- Ligar e recusado com entrega UNKNOWN sem reconciliar (o resultado de um envio anterior ainda e desconhecido).
-- Repetir o estado atual nao gera evento (idempotente).
create or replace function inbox_email_switch_set(p_enabled boolean, p_reason text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_perfil profile; v_s inbox_email_switch; v_motivo text := trim(coalesce(p_reason, '')); v_r integer; v_q integer; v_u integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); end if;
  if p_enabled is null then return jsonb_build_object('ok', false, 'erro', 'pedido_invalido'); end if;
  select * into v_perfil from profile where id = v_uid;
  if not found or not v_perfil.active then return jsonb_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  if v_perfil.role::text = 'Administrador' then null;
  elsif v_perfil.role::text = 'Diretoria' and not p_enabled then null;
  else return jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 500 then return jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); end if;

  perform set_config('inbox.email_switch_governado', 'on', true);
  perform set_config('inbox.email_switch_ator', v_uid::text, true);
  perform set_config('inbox.email_switch_ator_tipo', 'USER', true);
  perform set_config('inbox.email_switch_papel', v_perfil.role::text, true);
  insert into inbox_email_switch (organization_id, enabled, reason, changed_by, changed_by_kind)
    values (v_perfil.organization_id, false, 'linha criada ao primeiro uso (bloqueado)', v_uid, 'USER')
    on conflict (organization_id) do nothing;
  select * into v_s from inbox_email_switch where organization_id = v_perfil.organization_id for update;

  if p_enabled and exists (select 1 from inbox_email_delivery where organization_id = v_perfil.organization_id and status = 'UNKNOWN') then
    perform set_config('inbox.email_switch_governado', '', true);
    return jsonb_build_object('ok', false, 'erro', 'reconciliar_pendentes');
  end if;

  if v_s.enabled = p_enabled then
    perform set_config('inbox.email_switch_governado', '', true);
    return jsonb_build_object('ok', true, 'mudou', false, 'enabled', v_s.enabled, 'version', v_s.version);
  end if;

  update inbox_email_switch set enabled = p_enabled, version = version + 1, reason = v_motivo, changed_by = v_uid, changed_by_kind = 'USER', changed_at = now()
    where organization_id = v_perfil.organization_id returning * into v_s;
  perform set_config('inbox.email_switch_governado', '', true);
  select count(*) filter (where status = 'READY'), count(*) filter (where status = 'REQUESTED'), count(*) filter (where status = 'UNKNOWN')
    into v_r, v_q, v_u from inbox_email_delivery where organization_id = v_perfil.organization_id and status in ('READY', 'REQUESTED', 'UNKNOWN');
  return jsonb_build_object('ok', true, 'mudou', true, 'enabled', v_s.enabled, 'version', v_s.version,
    'em_curso', jsonb_build_object('ready', v_r, 'requested', v_q, 'unknown', v_u));
end $$;

-- Emergencia sem o app (SQL do dono do banco ou chave de servico): SO DESLIGA. Ator SYSTEM, motivo obrigatorio.
create or replace function inbox_email_switch_desligar_sistema(p_organization_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s inbox_email_switch; v_motivo text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is not null then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if not exists (select 1 from organization where id = p_organization_id) then return jsonb_build_object('ok', false, 'erro', 'organizacao_nao_encontrada'); end if;
  if length(v_motivo) < 3 or length(v_motivo) > 500 then return jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); end if;
  perform set_config('inbox.email_switch_governado', 'on', true);
  perform set_config('inbox.email_switch_ator', '', true);
  perform set_config('inbox.email_switch_ator_tipo', 'SYSTEM', true);
  perform set_config('inbox.email_switch_papel', 'sistema', true);
  insert into inbox_email_switch (organization_id, enabled, reason, changed_by_kind)
    values (p_organization_id, false, v_motivo, 'SYSTEM')
    on conflict (organization_id) do nothing;
  select * into v_s from inbox_email_switch where organization_id = p_organization_id for update;
  if v_s.enabled then
    update inbox_email_switch set enabled = false, version = version + 1, reason = v_motivo, changed_by = null, changed_by_kind = 'SYSTEM', changed_at = now()
      where organization_id = p_organization_id returning * into v_s;
  end if;
  perform set_config('inbox.email_switch_governado', '', true);
  return jsonb_build_object('ok', true, 'enabled', v_s.enabled, 'version', v_s.version);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7) semente: toda organizacao existente comeca BLOQUEADA, com evento de origem
-- ---------------------------------------------------------------------------------------------------------------
do $s$
begin
  perform set_config('inbox.email_switch_governado', 'on', true);
  perform set_config('inbox.email_switch_ator', '', true);
  perform set_config('inbox.email_switch_ator_tipo', 'SYSTEM', true);
  perform set_config('inbox.email_switch_papel', 'migration 0076', true);
  insert into inbox_email_switch (organization_id, enabled, reason, changed_by_kind)
    select id, false, 'estado inicial da 0076: envio de e-mail comercial bloqueado', 'SYSTEM' from organization
    on conflict (organization_id) do nothing;
  perform set_config('inbox.email_switch_governado', '', true);
end $s$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8) RLS e privilegios: o navegador so LE (Administrador e Diretoria da propria organizacao)
-- ---------------------------------------------------------------------------------------------------------------
alter table inbox_email_switch enable row level security;
alter table inbox_email_switch_event enable row level security;
drop policy if exists inbox_email_switch_select on inbox_email_switch;
create policy inbox_email_switch_select on inbox_email_switch for select
  using (organization_id = current_org() and has_role('Administrador', 'Diretoria'));
drop policy if exists inbox_email_switch_event_select on inbox_email_switch_event;
create policy inbox_email_switch_event_select on inbox_email_switch_event for select
  using (organization_id = current_org() and has_role('Administrador', 'Diretoria'));

revoke all on inbox_email_switch, inbox_email_switch_event from public, anon, authenticated;
grant select on inbox_email_switch, inbox_email_switch_event to authenticated;

-- privilegios EXPLICITOS (o Supabase concede EXECUTE por padrao a anon/authenticated/service_role em funcao nova)
revoke execute on function inbox_email_envio_liberado(uuid) from public, anon, authenticated, service_role;
revoke execute on function inbox_email_switch_guarda() from public, anon, authenticated, service_role;
revoke execute on function inbox_email_switch_pre() from public, anon, authenticated, service_role;
revoke execute on function inbox_email_switch_evento_guarda() from public, anon, authenticated, service_role;
revoke execute on function inbox_email_switch_sem_truncate() from public, anon, authenticated, service_role;
-- ligar/desligar e do USUARIO (auth.uid()); a chave de servico usa a funcao de emergencia
revoke execute on function inbox_email_switch_set(boolean, text) from public, anon, service_role;
grant execute on function inbox_email_switch_set(boolean, text) to authenticated;
revoke execute on function inbox_email_switch_desligar_sistema(uuid, text) from public, anon, authenticated;
grant execute on function inbox_email_switch_desligar_sistema(uuid, text) to service_role;
-- create/transition: mesmas permissoes da 0075 (create or replace preserva; reafirmado aqui)
revoke execute on function inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function inbox_email_delivery_transition(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer) to service_role;
grant execute on function inbox_email_delivery_transition(uuid, text, uuid, text, text, text) to service_role;

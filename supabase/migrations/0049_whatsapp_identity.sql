-- EIFF Central: identidade de WhatsApp (vinculo numero -> pessoa do EIFF Control).
-- Espelha src/core/central/identidade.ts. Nesta fase a Central nao age: a tabela existe para que o vinculo ja nasca
-- verificavel, auditavel e server-only.
--
-- Regras que o banco garante (nao so o codigo):
--   1) a chave e (organizacao, contexto, telefone): identidade de outro contexto ou de outra organizacao nunca serve;
--   2) um so VERIFIED por (organizacao, contexto, telefone) - indice unico PARCIAL (uma pessoa pode ter varios numeros,
--      o mesmo numero nao pode estar verificado para duas pessoas no mesmo contexto);
--   3) PENDING -> VERIFIED -> REVOKED, sem volta (REVOKED e terminal);
--   4) o CODIGO de verificacao nunca e gravado em claro: so o hash, e nem o hash entra na auditoria;
--   5) escrita SOMENTE server-side (precedente do ledger de entrega, migration 0047): `authenticated` so le.
-- Migration idempotente: pode ser aplicada mais de uma vez.

create table if not exists whatsapp_identity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  profile_id uuid references profile(id),       -- usuario do EIFF Control
  worker_id uuid references worker(id),         -- colaborador (equipe), quando aplicavel
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{9,14}$'),  -- E.164 sem "+"
  context text not null check (context in ('INTERNAL', 'EXTERNAL')),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REVOKED')),
  -- desafio de verificacao: hash do codigo (nunca o codigo), validade curta e tentativas contadas
  verification_code_hash text,
  verification_expires_at timestamptz,
  verification_attempts integer not null default 0 check (verification_attempts >= 0),
  verified_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 500),
  requested_by uuid references profile(id),
  last_actor_id uuid references profile(id),
  last_actor_kind text check (last_actor_kind is null or last_actor_kind in ('USER', 'SERVER', 'SYSTEM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  -- identidade sem pessoa nao e identidade
  constraint whatsapp_identity_pessoa_chk check (profile_id is not null or worker_id is not null),
  constraint whatsapp_identity_verificada_chk check (status <> 'VERIFIED' or verified_at is not null),
  constraint whatsapp_identity_revogada_chk check (status <> 'REVOKED' or revoked_at is not null),
  -- codigo em claro NUNCA: a coluna guarda hash (64 hex do SHA-256) ou nada
  constraint whatsapp_identity_hash_chk check (verification_code_hash is null or verification_code_hash ~ '^[0-9a-f]{64}$')
);
-- 2) um so VERIFIED por (organizacao, contexto, telefone); PENDING pode repetir (dois pedidos, uma verificacao)
create unique index if not exists whatsapp_identity_verificada_uk on whatsapp_identity (organization_id, context, phone_e164) where status = 'VERIFIED';
create index if not exists whatsapp_identity_pessoa_idx on whatsapp_identity (organization_id, profile_id);
create index if not exists whatsapp_identity_telefone_idx on whatsapp_identity (organization_id, context, phone_e164);

drop trigger if exists whatsapp_identity_touch on whatsapp_identity;
create trigger whatsapp_identity_touch before update on whatsapp_identity for each row execute function touch_updated_at();

-- auditoria com o numero MASCARADO e sem o hash do codigo: a trilha existe, o segredo nao circula
create or replace function whatsapp_identity_seguro(j jsonb) returns jsonb language sql immutable as $$
  select case when j is null then null else
    (j - 'verification_code_hash') || jsonb_build_object('phone_e164',
      left(j ->> 'phone_e164', 4) || repeat('*', greatest(length(j ->> 'phone_e164') - 6, 0)) || right(j ->> 'phone_e164', 2))
  end
$$;
create or replace function whatsapp_identity_audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb; v_after jsonb;
begin
  if tg_op <> 'INSERT' then v_before := whatsapp_identity_seguro(to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_after := whatsapp_identity_seguro(to_jsonb(new)); end if;
  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, source)
  values (coalesce(v_after ->> 'organization_id', v_before ->> 'organization_id')::uuid, auth.uid(), tg_op, tg_table_name,
          coalesce(v_after ->> 'id', v_before ->> 'id'), v_before, v_after, 'db');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists whatsapp_identity_audit on whatsapp_identity;
create trigger whatsapp_identity_audit after insert or update or delete on whatsapp_identity for each row execute function whatsapp_identity_audit();

-- 3) maquina de estados no banco: PENDING -> VERIFIED | REVOKED; VERIFIED -> REVOKED; REVOKED e terminal
create or replace function whatsapp_identity_estado() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (new.status = any (case old.status
        when 'PENDING' then array['VERIFIED', 'REVOKED']
        when 'VERIFIED' then array['REVOKED']
        else array[]::text[] end)) then
      raise exception 'transição de identidade % -> % não é permitida', old.status, new.status;
    end if;
  end if;
  -- o telefone, o contexto e a pessoa sao o COMANDO: mudar qualquer um deles e criar outra identidade
  if new.organization_id is distinct from old.organization_id or new.phone_e164 is distinct from old.phone_e164
     or new.context is distinct from old.context or new.profile_id is distinct from old.profile_id
     or new.worker_id is distinct from old.worker_id or new.created_at is distinct from old.created_at then
    raise exception 'organização, telefone, contexto e pessoa da identidade são imutáveis (id %)', old.id;
  end if;
  return new;
end $$;
drop trigger if exists whatsapp_identity_estado on whatsapp_identity;
create trigger whatsapp_identity_estado before update on whatsapp_identity for each row execute function whatsapp_identity_estado();

-- 5) RLS: leitura por organizacao (coluna da PROPRIA linha; nunca funcao STABLE que consulte esta tabela, senao
--    INSERT ... RETURNING quebra - ver CLAUDE.md). Escrita: nenhuma para `authenticated`.
alter table whatsapp_identity enable row level security;
drop policy if exists wi_select on whatsapp_identity;
create policy wi_select on whatsapp_identity for select using (
  organization_id = current_org()
  and (has_role('Administrador', 'Diretoria', 'Financeiro') or profile_id = auth.uid())
);
revoke all on whatsapp_identity from authenticated;
grant select on whatsapp_identity to authenticated;

-- Porta unica server-side: pedir o vinculo (cria/renova o desafio) e transicionar. EXECUTE so para service_role,
-- chamado pela funcao Netlify DEPOIS de validar o JWT do usuario (mesmo padrao das RPCs do Vibe e da entrega).
create or replace function whatsapp_identity_request(
  p_user_id uuid, p_phone text, p_context text, p_code_hash text, p_expires_at timestamptz,
  p_profile_id uuid default null, p_worker_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_role text; v_alvo uuid; v_id uuid; v_ex record;
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); end if;
  if p_context not in ('INTERNAL', 'EXTERNAL') then return jsonb_build_object('ok', false, 'erro', 'contexto_invalido'); end if;
  select organization_id, role::text into v_org, v_role from profile where id = p_user_id and active;
  if v_org is null then return jsonb_build_object('ok', false, 'erro', 'sem_perfil'); end if;
  v_alvo := coalesce(p_profile_id, case when p_worker_id is null then p_user_id end);
  -- vincular o numero de OUTRA pessoa e ato de cadastro; o proprio numero cada um pede para si
  if coalesce(v_alvo, '00000000-0000-0000-0000-000000000000'::uuid) <> p_user_id
     and v_role not in ('Administrador', 'Diretoria', 'Financeiro') then
    return jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  end if;
  if v_alvo is not null and exists (select 1 from profile where id = v_alvo and organization_id <> v_org) then
    return jsonb_build_object('ok', false, 'erro', 'pessoa_de_outra_organizacao');
  end if;
  -- ja verificado para outra pessoa neste contexto: nao ha o que pedir
  select * into v_ex from whatsapp_identity
    where organization_id = v_org and context = p_context and phone_e164 = p_phone and status = 'VERIFIED';
  if v_ex.id is not null and (v_ex.profile_id is distinct from v_alvo or v_alvo is null) then
    return jsonb_build_object('ok', false, 'erro', 'numero_ja_verificado_para_outra_pessoa');
  end if;
  -- pedido pendente da MESMA pessoa: renova o desafio, nao cria uma segunda linha
  select * into v_ex from whatsapp_identity
    where organization_id = v_org and context = p_context and phone_e164 = p_phone and status = 'PENDING'
      and profile_id is not distinct from v_alvo and worker_id is not distinct from p_worker_id
    order by created_at desc limit 1;
  if v_ex.id is not null then
    update whatsapp_identity set verification_code_hash = p_code_hash, verification_expires_at = p_expires_at,
      verification_attempts = 0, last_actor_id = p_user_id, last_actor_kind = 'SERVER' where id = v_ex.id;
    return jsonb_build_object('ok', true, 'existente', true, 'identity_id', v_ex.id, 'status', 'PENDING');
  end if;
  insert into whatsapp_identity (organization_id, profile_id, worker_id, phone_e164, context, status,
      verification_code_hash, verification_expires_at, requested_by, last_actor_id, last_actor_kind)
    values (v_org, v_alvo, p_worker_id, p_phone, p_context, 'PENDING', p_code_hash, p_expires_at, p_user_id, p_user_id, 'SERVER')
    returning id into v_id;
  return jsonb_build_object('ok', true, 'existente', false, 'identity_id', v_id, 'status', 'PENDING');
end $$;
revoke execute on function whatsapp_identity_request(uuid, text, text, text, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function whatsapp_identity_request(uuid, text, text, text, timestamptz, uuid, uuid) to service_role;

-- tentativa de codigo: a contagem vive no banco, para o limite valer mesmo com varias instancias da funcao
create or replace function whatsapp_identity_attempt(p_user_id uuid, p_identity_id uuid, p_max integer default 5)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_i whatsapp_identity;
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  select organization_id into v_org from profile where id = p_user_id and active;
  if v_org is null then return jsonb_build_object('ok', false, 'erro', 'sem_perfil'); end if;
  select * into v_i from whatsapp_identity where id = p_identity_id for update;
  if v_i.id is null or v_i.organization_id <> v_org then return jsonb_build_object('ok', false, 'erro', 'identidade_nao_encontrada'); end if;
  if v_i.verification_attempts >= p_max then return jsonb_build_object('ok', false, 'erro', 'tentativas_excedidas', 'tentativas', v_i.verification_attempts); end if;
  update whatsapp_identity set verification_attempts = verification_attempts + 1,
    last_actor_id = p_user_id, last_actor_kind = 'SERVER' where id = p_identity_id;
  return jsonb_build_object('ok', true, 'tentativas', v_i.verification_attempts + 1);
end $$;
revoke execute on function whatsapp_identity_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function whatsapp_identity_attempt(uuid, uuid, integer) to service_role;

create or replace function whatsapp_identity_transition(
  p_user_id uuid, p_identity_id uuid, p_to_status text, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_org uuid; v_role text; v_i whatsapp_identity; v_agora timestamptz := now();
begin
  if v_caller is not null and v_caller <> 'service_role' then return jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_user_id is null then return jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); end if;
  if p_to_status not in ('VERIFIED', 'REVOKED') then return jsonb_build_object('ok', false, 'erro', 'situacao_invalida'); end if;
  select organization_id, role::text into v_org, v_role from profile where id = p_user_id and active;
  if v_org is null then return jsonb_build_object('ok', false, 'erro', 'sem_perfil'); end if;
  select * into v_i from whatsapp_identity where id = p_identity_id for update;
  if v_i.id is null then return jsonb_build_object('ok', false, 'erro', 'identidade_nao_encontrada'); end if;
  if v_i.organization_id <> v_org then return jsonb_build_object('ok', false, 'erro', 'identidade_de_outra_organizacao'); end if;
  if v_i.profile_id is distinct from p_user_id and v_role not in ('Administrador', 'Diretoria', 'Financeiro') then
    return jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  end if;
  if p_to_status = 'VERIFIED' then
    if v_i.status <> 'PENDING' then return jsonb_build_object('ok', false, 'erro', 'transicao_invalida', 'de', v_i.status); end if;
    -- so verifica quem tem desafio VIVO: o codigo tem vida curta, e a validade e conferida tambem aqui
    if v_i.verification_expires_at is null or v_i.verification_expires_at < v_agora then
      return jsonb_build_object('ok', false, 'erro', 'codigo_expirado');
    end if;
    if exists (select 1 from whatsapp_identity o where o.organization_id = v_i.organization_id and o.context = v_i.context
                 and o.phone_e164 = v_i.phone_e164 and o.status = 'VERIFIED' and o.id <> v_i.id) then
      return jsonb_build_object('ok', false, 'erro', 'numero_ja_verificado_para_outra_pessoa');
    end if;
    update whatsapp_identity set status = 'VERIFIED', verified_at = v_agora,
      verification_code_hash = null, verification_expires_at = null, verification_attempts = 0,
      last_actor_id = p_user_id, last_actor_kind = 'SERVER' where id = p_identity_id;
  else
    if v_i.status = 'REVOKED' then return jsonb_build_object('ok', false, 'erro', 'transicao_invalida', 'de', v_i.status); end if;
    update whatsapp_identity set status = 'REVOKED', revoked_at = v_agora, revoke_reason = left(p_reason, 500),
      verification_code_hash = null, verification_expires_at = null,
      last_actor_id = p_user_id, last_actor_kind = 'SERVER' where id = p_identity_id;
  end if;
  return jsonb_build_object('ok', true, 'identity_id', p_identity_id, 'de', v_i.status, 'status', p_to_status);
end $$;
revoke execute on function whatsapp_identity_transition(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function whatsapp_identity_transition(uuid, uuid, text, text) to service_role;

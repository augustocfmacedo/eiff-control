-- 0069 · Widgets do iPad: token por aparelho, SÓ LEITURA do resumo do caixa (decisão do Augusto em 14/10/2026).
--
-- O widget (Scriptable no iPad) não tem login: ele apresenta um token que o próprio Administrador gerou no app. O token:
--   * nasce DENTRO do banco (gen_random_uuid, gerador criptográfico do PostgreSQL), é devolvido UMA vez e nunca é gravado
--     em claro — a tabela guarda só o SHA-256 e os 4 últimos caracteres para reconhecer o aparelho;
--   * serve para UMA coisa (escopo 'caixa_resumo'): o servidor (/api/widget-caixa) troca o token pelo perfil e devolve o
--     resumo do caixa; nada é gravado no sistema por ele;
--   * só existe para quem vê o caixa (papel Administrador, o mesmo de ver_bancos na MATRIZ) e com perfil ativo — se o papel
--     mudar ou o perfil for desativado, o token para de valer na hora, sem precisar revogar;
--   * tem validade (1 a 365 dias), é revogável pelo dono com motivo e nunca é apagado (histórico e auditoria).
-- Validação só no servidor: widget_token_validar tem EXECUTE apenas para service_role (a chave de serviço do Netlify).
-- O cliente (authenticated) lê os PRÓPRIOS tokens, sem a coluna token_hash, e escreve só pelas RPCs.
-- Todas as funções fixam search_path = pg_catalog, pg_temp e qualificam o que leem/gravam (mesmo hardening da 0068).

create table widget_token (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  profile_id uuid not null references profile(id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  scope text not null default 'caixa_resumo' check (scope = 'caixa_resumo'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (token_hint ~ '^[0-9a-f]{4}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references profile(id),
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 200),
  constraint widget_token_validade check (expires_at > created_at),
  constraint widget_token_revogacao check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);
create index widget_token_perfil_idx on widget_token (profile_id, created_at desc);

-- token nunca é apagado; depois de criado só mudam o último uso e a revogação (uma vez)
create or replace function widget_token_imutavel() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'widget: tokens não são apagados (revogue o aparelho)'; end if;
  if (new.id, new.organization_id, new.profile_id, new.name, new.scope, new.token_hash, new.token_hint, new.created_at, new.expires_at)
     is distinct from (old.id, old.organization_id, old.profile_id, old.name, old.scope, old.token_hash, old.token_hint, old.created_at, old.expires_at) then
    raise exception 'widget: só o último uso e a revogação mudam';
  end if;
  if old.revoked_at is not null and (new.revoked_at, new.revoked_by, new.revoke_reason) is distinct from (old.revoked_at, old.revoked_by, old.revoke_reason) then
    raise exception 'widget: token já revogado';
  end if;
  return new;
end $$;
create trigger widget_token_sem_update before update on widget_token for each row execute function widget_token_imutavel();
create trigger widget_token_sem_delete before delete on widget_token for each row execute function widget_token_imutavel();
create trigger widget_token_sem_truncate before truncate on widget_token for each statement execute function widget_token_imutavel();

alter table widget_token enable row level security;
-- cada um vê só os próprios aparelhos (perfil ativo, não Solicitante: current_org() da 0067)
create policy widget_token_select on widget_token for select
  using (profile_id = auth.uid() and organization_id = current_org());
revoke all on widget_token from public, anon, authenticated;
grant select (id, name, scope, token_hint, created_at, expires_at, last_used_at, revoked_at, revoke_reason) on widget_token to authenticated;

-- ---------------------------------------------------------------------------------------------------- criar (Administrador)
create or replace function widget_token_criar(p_nome text, p_dias integer default 365) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid; v_papel public.role_kind; v_ativo boolean;
  v_nome text := pg_catalog.btrim(coalesce(p_nome, ''));
  v_segredo text; v_id uuid; v_expira timestamptz; v_final text;
begin
  if v_ator is null then raise exception 'widget: sessão não autenticada'; end if;
  select p.organization_id, p.role, p.active into v_org, v_papel, v_ativo from public.profile p where p.id = v_ator;
  if v_org is null or v_ativo is not true then raise exception 'widget: usuário sem perfil ativo'; end if;
  if v_papel is distinct from 'Administrador'::public.role_kind then raise exception 'widget: só quem vê o caixa (Administrador) cria widget'; end if;
  if pg_catalog.char_length(v_nome) not between 1 and 60 then raise exception 'widget: informe o nome do aparelho (1 a 60 caracteres)'; end if;
  if p_dias is null or p_dias not between 1 and 365 then raise exception 'widget: validade de 1 a 365 dias'; end if;
  if (select count(*) from public.widget_token t where t.profile_id = v_ator and t.revoked_at is null and t.expires_at > now()) >= 10 then
    raise exception 'widget: limite de 10 aparelhos ativos (revogue um antes)';
  end if;
  -- 2 × 122 bits do gerador criptográfico; só o hash fica no banco
  v_segredo := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_final := pg_catalog.right(v_segredo, 4);
  v_expira := now() + pg_catalog.make_interval(days => p_dias);
  insert into public.widget_token (organization_id, profile_id, name, token_hash, token_hint, expires_at)
  values (v_org, v_ator, v_nome, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_segredo, 'UTF8')), 'hex'), v_final, v_expira)
  returning id into v_id;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (v_org, v_ator, 'widget_token_criar', 'widget_token', v_id::text, null,
    pg_catalog.jsonb_build_object('nome', v_nome, 'escopo', 'caixa_resumo', 'final', v_final, 'expira_em', v_expira),
    'widget do iPad (somente leitura do caixa)', 'rpc');
  return pg_catalog.jsonb_build_object('id', v_id, 'token', 'eiffw_' || v_segredo, 'final', v_final, 'expira_em', v_expira, 'nome', v_nome);
end $$;

-- ---------------------------------------------------------------------------------------------------- revogar (o dono)
create or replace function widget_token_revogar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid; v_ativo boolean;
  v_motivo text := pg_catalog.btrim(coalesce(p_motivo, ''));
  v_t public.widget_token%rowtype;
begin
  if v_ator is null then raise exception 'widget: sessão não autenticada'; end if;
  select p.organization_id, p.active into v_org, v_ativo from public.profile p where p.id = v_ator;
  if v_org is null or v_ativo is not true then raise exception 'widget: usuário sem perfil ativo'; end if;
  if pg_catalog.char_length(v_motivo) not between 3 and 200 then raise exception 'widget: informe o motivo (3 a 200 caracteres)'; end if;
  select * into v_t from public.widget_token t where t.id = p_id for update;
  if v_t.id is null or v_t.profile_id is distinct from v_ator or v_t.organization_id is distinct from v_org then raise exception 'widget: aparelho não encontrado'; end if;
  if v_t.revoked_at is not null then raise exception 'widget: aparelho já revogado'; end if;
  update public.widget_token set revoked_at = now(), revoked_by = v_ator, revoke_reason = v_motivo where id = p_id;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (v_org, v_ator, 'widget_token_revogar', 'widget_token', p_id::text,
    pg_catalog.jsonb_build_object('nome', v_t.name, 'final', v_t.token_hint), pg_catalog.jsonb_build_object('revogado', true), v_motivo, 'rpc');
  return pg_catalog.jsonb_build_object('id', p_id, 'revogado', true);
end $$;

-- ---------------------------------------------------------------------------------------------------- validar (só servidor)
-- Troca o token pelo perfil. Recusa: formato, desconhecido, revogado, expirado, perfil inativo ou sem o papel que vê o caixa.
-- Marca o último uso no máximo uma vez por minuto (o widget atualiza a cada 15-30 min).
create or replace function widget_token_validar(p_token text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_quem text := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_t public.widget_token%rowtype;
  v_papel public.role_kind; v_ativo boolean; v_org uuid;
begin
  if v_quem is not null and v_quem <> 'service_role' then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'somente_servidor'); end if;
  if p_token is null or p_token !~ '^eiffw_[0-9a-f]{64}$' then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'token_invalido'); end if;
  select * into v_t from public.widget_token t
   where t.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(p_token, 7), 'UTF8')), 'hex');
  if v_t.id is null then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'token_invalido'); end if;
  if v_t.revoked_at is not null then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'token_revogado'); end if;
  if v_t.expires_at <= now() then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'token_expirado'); end if;
  select p.role, p.active, p.organization_id into v_papel, v_ativo, v_org from public.profile p where p.id = v_t.profile_id;
  if v_ativo is not true or v_org is distinct from v_t.organization_id then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'perfil_inativo'); end if;
  if v_papel is distinct from 'Administrador'::public.role_kind then return pg_catalog.jsonb_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  if v_t.last_used_at is null or v_t.last_used_at < now() - interval '1 minute' then
    update public.widget_token set last_used_at = now() where id = v_t.id;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'perfil_id', v_t.profile_id, 'organizacao_id', v_t.organization_id, 'token_id', v_t.id, 'nome', v_t.name, 'expira_em', v_t.expires_at);
end $$;

revoke all on function widget_token_criar(text, integer) from public, anon;
revoke all on function widget_token_revogar(uuid, text) from public, anon;
revoke all on function widget_token_validar(text) from public, anon, authenticated;
grant execute on function widget_token_criar(text, integer) to authenticated;
grant execute on function widget_token_revogar(uuid, text) to authenticated;
grant execute on function widget_token_validar(text) to service_role;

-- RETRATO SOMENTE LEITURA do que a migration 0075 toca ou usa. Um unico SELECT; nenhum dado de conteudo.
with alvo(t) as (values ('inbox_thread'), ('inbox_message'), ('inbox_contact'), ('inbox_contact_identity'), ('inbox_thread_event'), ('profile'), ('organization')),
fn(n) as (values ('current_org'), ('auth_profile'), ('current_role_kind'), ('has_role'), ('inbox_role'), ('inbox_config_role'), ('inbox_user_sectors'), ('inbox_encaminhei'),
  ('inbox_ingest'), ('inbox_assign_thread'), ('inbox_apply_routing'), ('inbox_thread_autoridade'), ('touch_updated_at'))
select jsonb_build_object(
  'colunas', (select jsonb_object_agg(k, v) from (select c.table_name || '.' || c.column_name k,
      concat_ws('|', c.udt_name, c.is_nullable, coalesce(c.column_default, '')) v
    from information_schema.columns c join alvo on alvo.t = c.table_name where c.table_schema = 'public') x),
  'constraints', (select jsonb_object_agg(k, v) from (select cl.relname || '.' || co.conname k, pg_get_constraintdef(co.oid) v
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace join alvo on alvo.t = cl.relname where n.nspname = 'public') x),
  'triggers', (select jsonb_object_agg(k, v) from (select cl.relname || '.' || tg.tgname k, pg_get_triggerdef(tg.oid) v
    from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace join alvo on alvo.t = cl.relname where n.nspname = 'public' and not tg.tgisinternal) x),
  'indices', (select jsonb_object_agg(indexname, indexdef) from pg_indexes join alvo on alvo.t = tablename where schemaname = 'public'),
  'politicas', (select jsonb_object_agg(k, v) from (select p.tablename || '.' || p.policyname k,
      concat_ws(' | ', p.cmd, array_to_string(p.roles, ','), coalesce(p.qual, ''), coalesce(p.with_check, '')) v
    from pg_policies p join alvo on alvo.t = p.tablename where p.schemaname = 'public') x),
  'rls', (select jsonb_object_agg(cl.relname, cl.relrowsecurity) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace join alvo on alvo.t = cl.relname where n.nspname = 'public'),
  'funcoes', (select jsonb_object_agg(k, v) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k,
      md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.n = p.proname where n.nspname = 'public') x),
  'funcoes_de_trigger', (select jsonb_object_agg(k, v) from (select distinct p.proname k, md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) v
    from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace join alvo on alvo.t = cl.relname
    join pg_proc p on p.oid = tg.tgfoid where n.nspname = 'public' and not tg.tgisinternal) x),
  'ja_existe_0075', jsonb_build_object(
    'inbox_email_delivery', to_regclass('public.inbox_email_delivery') is not null,
    'inbox_email_delivery_event', to_regclass('public.inbox_email_delivery_event') is not null,
    'funcoes', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%')),
  'dados', jsonb_build_object(
    'inbox_message_por_provider', (select jsonb_object_agg(provider, q) from (select provider, count(*) q from inbox_message group by 1) x),
    'inbox_message_por_entrega', (select jsonb_object_agg(coalesce(delivery_state, 'null'), q) from (select delivery_state, count(*) q from inbox_message group by 1) x),
    'inbox_thread', (select count(*) from inbox_thread), 'inbox_message', (select count(*) from inbox_message), 'inbox_contact', (select count(*) from inbox_contact),
    'inbox_contact_identity', (select count(*) from inbox_contact_identity), 'inbox_thread_event', (select count(*) from inbox_thread_event),
    'profile', (select count(*) from profile), 'organization', (select count(*) from organization),
    'perfis_que_enviam', (select count(*) from profile where active and role::text in ('Administrador', 'Diretoria')),
    'impressao_mensagens', (select md5(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id)) from inbox_message),
    'impressao_conversas', (select md5(string_agg(id::text || '|' || status || '|' || coalesce(sla_first_response_at::text, '') || '|' || coalesce(sla_first_response_due::text, ''), ',' order by id)) from inbox_thread)),
  'servidor', jsonb_build_object('versao', current_setting('server_version'), 'fuso', current_setting('TimeZone'),
    'papeis', (select jsonb_agg(rolname order by rolname) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
    'papel_enum', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = (select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'profile' and column_name = 'role')))
) as retrato;

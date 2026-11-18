-- RETRATO SOMENTE LEITURA do que a migration 0076 toca ou usa. Um unico SELECT; nenhum dado de conteudo.
-- Escopo: o livro do e-mail (0075), a chave central (0076, se ja existir), mensagem, conversa, perfil e organizacao,
-- e todas as funcoes inbox_email_* e auxiliares de que a 0076 depende. O estado da chave (linhas, ligadas, eventos) e
-- conferido pelo envelope, nao aqui: o retrato tem de rodar igual antes da 0076, quando as tabelas ainda nao existem.
with alvo(t) as (values ('inbox_email_delivery'), ('inbox_email_delivery_event'), ('inbox_email_switch'), ('inbox_email_switch_event'),
  ('inbox_message'), ('inbox_thread'), ('profile'), ('organization')),
fn as (select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'inbox_email%' or p.proname in ('current_org', 'has_role', 'touch_updated_at')))
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
  'funcoes', (select jsonb_object_agg(k, v) from (select fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')' k,
      md5(regexp_replace(pg_get_functiondef(fn.oid), '\s+', ' ', 'g')) v from fn) x),
  'privilegios', (select jsonb_object_agg(k, v) from (select fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')' k,
      concat_ws(',', case when has_function_privilege('anon', fn.oid, 'execute') then 'anon' end,
        case when has_function_privilege('authenticated', fn.oid, 'execute') then 'authenticated' end,
        case when has_function_privilege('service_role', fn.oid, 'execute') then 'service_role' end) v from fn where fn.proname like 'inbox_email%') x),
  'ja_existe_0076', jsonb_build_object(
    'inbox_email_switch', to_regclass('public.inbox_email_switch') is not null,
    'inbox_email_switch_event', to_regclass('public.inbox_email_switch_event') is not null,
    'funcoes_inbox_email', (select count(*) from fn where fn.proname like 'inbox_email%')),
  'dados', jsonb_build_object(
    'entregas', (select count(*) from inbox_email_delivery), 'eventos_entrega', (select count(*) from inbox_email_delivery_event),
    'entregas_por_estado', (select jsonb_object_agg(status, q) from (select status, count(*) q from inbox_email_delivery group by 1) x),
    'impressao_livro', (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(reason, '') || '|' || coalesce(provider_message_id, '') || '|' || coalesce(accepted_at::text, ''), ',' order by id), '')) from inbox_email_delivery),
    'impressao_eventos_entrega', (select md5(coalesce(string_agg(id::text || '|' || coalesce(from_status, '') || '|' || to_status || '|' || occurred_at::text, ',' order by id), '')) from inbox_email_delivery_event),
    'inbox_thread', (select count(*) from inbox_thread), 'inbox_message', (select count(*) from inbox_message),
    'impressao_mensagens', (select md5(coalesce(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id), '')) from inbox_message),
    'impressao_conversas', (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(sla_first_response_at::text, '') || '|' || coalesce(sla_first_response_due::text, ''), ',' order by id), '')) from inbox_thread),
    'organization', (select count(*) from organization), 'profile', (select count(*) from profile)),
  'servidor', jsonb_build_object('versao', current_setting('server_version'))
) as retrato;

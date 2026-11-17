-- Retrato de privilégios da Segurança S3, versão 2 (somente leitura, só catálogo; nenhum dado de negócio).
-- Uso: IMEDIATAMENTE antes de aplicar a 0077 em produção, sem nenhuma migration no meio. A reversão é gerada dele e
-- recusa retrato com mais de 24 h, anterior à C1 (views com anon/PUBLIC ou escrita de authenticated), posterior à 0077
-- (views já com security_invoker) ou com concessão feita por outro papel:
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f docs/seguranca/s3-0077-retrato.sql -o json > retrato-antes-0077.json
--   node scripts/s3-0077-reversao.mjs --retrato retrato-antes-0077.json > reversao-0077.sql
-- search_path = pg_catalog só nesta transação: assinaturas de função e tipos saem com o schema (não dependem do
-- search_path de quem gera ou executa a reversão).
set transaction read only;
set local search_path = pg_catalog;
with eu as (select oid, rolname from pg_roles where rolname = current_user)
select jsonb_build_object(
  'versao_retrato', 2,
  'tirado_em', now(),
  'banco', current_database(),
  'papel', (select rolname from eu),
  'versao', current_setting('server_version_num'),
  'views', (select coalesce(jsonb_agg(jsonb_build_object('nome', format('%I.%I', n.nspname, c.relname),
              'opcoes', coalesce(to_jsonb(c.reloptions), '[]'), 'acl', to_jsonb(c.relacl::text[]))
              order by n.nspname, c.relname), '[]')
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'v' and n.nspname in ('public', 'mart')),
  'relacoes', (select coalesce(jsonb_agg(jsonb_build_object('nome', format('%I.%I', n.nspname, c.relname), 'tipo', c.relkind::text,
              'acl', to_jsonb(c.relacl::text[])) order by n.nspname, c.relname), '[]')
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'm', 'f', 'S') and n.nspname in ('public', 'mart') and c.relowner = (select oid from eu)),
  'funcoes', (select coalesce(jsonb_agg(jsonb_build_object('assinatura', p.oid::regprocedure::text,
              'acl', to_jsonb(p.proacl::text[])) order by p.oid::regprocedure::text), '[]')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'mart') and p.proowner = (select oid from eu)
              and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  'padrao', (select coalesce(jsonb_agg(jsonb_build_object('schema', case when d.defaclnamespace = 0 then null else d.defaclnamespace::regnamespace::text end,
              'tipo', d.defaclobjtype::text, 'acl', to_jsonb(d.defaclacl::text[])) order by d.defaclnamespace, d.defaclobjtype), '[]')
            from pg_default_acl d where d.defaclrole = (select oid from eu))
) retrato;

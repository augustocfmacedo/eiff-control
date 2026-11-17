-- Retrato de privilégios da Segurança S3 (somente leitura, só catálogo; nenhum dado de negócio).
-- Uso: ANTES de aplicar a 0077 em produção, guardar a saída (um JSON) — é dela que a reversão é gerada:
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f docs/seguranca/s3-0077-retrato.sql -o json > retrato-antes-0077.json
--   node scripts/s3-0077-reversao.mjs --retrato retrato-antes-0077.json > reversao-0077.sql
-- Depois de aplicar, rodar de novo e comparar (o smoke faz o mesmo em PGlite).
-- Conteúdo: views (opções e ACL), relações e funções de public/mart do papel que roda (ACL), privilégio padrão do papel.
set transaction read only;
with eu as (select oid, rolname from pg_roles where rolname = current_user)
select jsonb_build_object(
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

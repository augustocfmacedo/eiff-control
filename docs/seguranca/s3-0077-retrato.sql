-- Retrato de privilégios da Segurança S3, versão 2 (somente leitura, só catálogo; nenhum dado de negócio).
-- Uso: IMEDIATAMENTE antes de aplicar a 0077 em produção, sem nenhuma migration no meio. A reversão é gerada dele e
-- recusa retrato com mais de 24 h, anterior à C1 (views com anon/PUBLIC ou escrita de authenticated), posterior à 0077
-- (views já com security_invoker) ou com concessão feita por outro papel:
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f docs/seguranca/s3-0077-retrato.sql -o json > retrato-antes-0077.json
--   node scripts/s3-0077-reversao.mjs --retrato retrato-antes-0077.json > reversao-0077.sql
-- As assinaturas de função são montadas aqui com o schema da função e de cada tipo de argumento (pg_catalog fica sem
-- prefixo, como sempre resolve): não dependem do search_path de quem tira o retrato nem de quem executa a reversão, e
-- não dependem de SET LOCAL (a CLI pode executar instrução por instrução). `set transaction read only` é só reforço: fora
-- de transação o PostgreSQL apenas avisa.
set transaction read only;
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
  'funcoes', (select coalesce(jsonb_agg(jsonb_build_object('assinatura', format('%I.%I(%s)', n.nspname, p.proname, coalesce((select string_agg(
                case when tn.nspname = 'pg_catalog' then format_type(t.oid, null)
                     when t.typcategory = 'A' and et.oid is not null then
                       (case when etn.nspname = 'pg_catalog' then format_type(et.oid, null) else format('%I.%I', etn.nspname, et.typname) end) || '[]'
                     else format('%I.%I', tn.nspname, t.typname) end, ',' order by a.ord)
              from unnest(p.proargtypes::oid[]) with ordinality a(tid, ord)
              join pg_type t on t.oid = a.tid join pg_namespace tn on tn.oid = t.typnamespace
              left join pg_type et on et.oid = t.typelem and t.typcategory = 'A' left join pg_namespace etn on etn.oid = et.typnamespace), '')),
              'acl', to_jsonb(p.proacl::text[])) order by n.nspname, p.proname, p.oid), '[]')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'mart') and p.proowner = (select oid from eu)
              and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  'padrao', (select coalesce(jsonb_agg(jsonb_build_object('schema', case when d.defaclnamespace = 0 then null else d.defaclnamespace::regnamespace::text end,
              'tipo', d.defaclobjtype::text, 'acl', to_jsonb(d.defaclacl::text[])) order by d.defaclnamespace, d.defaclobjtype), '[]')
            from pg_default_acl d where d.defaclrole = (select oid from eu))
) retrato;

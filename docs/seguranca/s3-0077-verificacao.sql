-- Verificação da 0077 (Segurança S3): somente leitura, só catálogo. Depois de aplicar, TODA linha com esperado = 0 tem
-- de dar 0. As linhas "informativo" descrevem objetos de outros donos (fora do alcance da 0077) para a avaliação de risco.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f docs/seguranca/s3-0077-verificacao.sql
set transaction read only;
with eu as (select oid from pg_roles where rolname = current_user),
privs as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] ||
                        case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else array[]::text[] end) p),
v as (select c.oid, n.nspname || '.' || c.relname nome from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v' and n.nspname in ('public', 'mart')),
rel as (select c.oid, c.relkind, c.relowner, n.nspname || '.' || c.relname nome from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'm', 'f', 'S') and n.nspname in ('public', 'mart')),
fn as (select p.oid, p.proowner, p.oid::regprocedure::text nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'mart')
         and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
itens(ordem, item, esperado, nomes) as (
  select 1, 'views de public/mart', '25', array(select nome from v order by 1)
  union all select 2, 'views sem security_invoker', '0', array(select nome from v join pg_class c using (oid)
    where not coalesce(c.reloptions && array['security_invoker=true','security_invoker=on','security_invoker=1'], false) order by 1)
  union all select 3, 'views com qualquer privilégio de anon', '0', array(select distinct nome from v, privs where has_table_privilege('anon', v.oid, privs.p) order by 1)
  union all select 4, 'views com escrita de authenticated', '0', array(select distinct nome from v, privs where privs.p <> 'SELECT' and has_table_privilege('authenticated', v.oid, privs.p) order by 1)
  union all select 5, 'views sem SELECT de authenticated', '0', array(select nome from v where not has_table_privilege('authenticated', v.oid, 'SELECT') order by 1)
  union all select 6, 'views com grant a PUBLIC', '0', array(select nome from v join pg_class c using (oid), aclexplode(c.relacl) a where a.grantee = 0 order by 1)
  union all select 7, 'relações do dono com privilégio de anon', '0', array(select distinct nome from rel, privs where rel.relowner = (select oid from eu)
    and (case when rel.relkind = 'S' then privs.p = 'SELECT' and (has_sequence_privilege('anon', rel.oid, 'USAGE') or has_sequence_privilege('anon', rel.oid, 'SELECT') or has_sequence_privilege('anon', rel.oid, 'UPDATE'))
              else has_table_privilege('anon', rel.oid, privs.p) end) order by 1)
  union all select 8, 'funções do dono executáveis por anon', '0', array(select nome from fn where proowner = (select oid from eu) and has_function_privilege('anon', fn.oid, 'EXECUTE') order by 1)
  union all select 9, 'funções fechadas executáveis por authenticated', '0', array(select nome from fn where fn.oid in (to_regprocedure('public.fn_cancel_entry(uuid, text)'),
    to_regprocedure('public.fn_close_period(uuid, character)'), to_regprocedure('public.fn_reopen_period(uuid, text)')) and has_function_privilege('authenticated', fn.oid, 'EXECUTE') order by 1)
  union all select 10, 'privilégio padrão do dono que ainda concede a anon (schema public)', '0', array(select d.defaclobjtype::text from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = (select oid from eu) and d.defaclnamespace = 'public'::regnamespace and a.grantee = (select oid from pg_roles where rolname = 'anon'))
  union all select 11, 'privilégio padrão do dono que ainda dá EXECUTE a PUBLIC', '0', case when exists (select 1 from pg_default_acl d where d.defaclrole = (select oid from eu)
    and d.defaclnamespace = 0 and d.defaclobjtype = 'f' and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)) then array[]::text[] else array['global (funções)'] end
  union all select 12, 'informativo: relações de OUTRO dono com privilégio de anon', 'informativo', array(select distinct nome || ' (' || pg_get_userbyid(rel.relowner) || ')' from rel, privs
    where rel.relowner <> (select oid from eu) and rel.relkind <> 'S' and has_table_privilege('anon', rel.oid, privs.p) order by 1)
  union all select 13, 'informativo: funções de OUTRO dono executáveis por anon', 'informativo', array(select nome || ' (' || pg_get_userbyid(proowner) || ')' from fn
    where proowner <> (select oid from eu) and has_function_privilege('anon', fn.oid, 'EXECUTE') order by 1)
  union all select 14, 'informativo: privilégio padrão de OUTROS papéis que concede a anon no schema public', 'informativo', array(select pg_get_userbyid(d.defaclrole) || '/' || d.defaclobjtype::text
    from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclrole <> (select oid from eu) and d.defaclnamespace = 'public'::regnamespace
      and a.grantee = (select oid from pg_roles where rolname = 'anon'))
)
select ordem, item, esperado, cardinality(nomes) encontrado, array_to_string(nomes[1:8], ', ') exemplos from itens order by ordem;

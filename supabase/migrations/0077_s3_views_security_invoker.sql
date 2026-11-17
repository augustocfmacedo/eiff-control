-- 0077 · Segurança S3: views respeitam a RLS de quem consulta, `anon` sai de tudo e o padrão do schema deixa de abrir
-- objetos novos (autorização da Direção para desenvolvimento em 17/11/2026; correções R1–R8 da revisão independente
-- em 17/11/2026; NÃO aplicada em produção).
--
-- O incidente (docs/seguranca/s3.md):
--   * as 21 views de public e as 4 de mart rodavam com os direitos do DONO (postgres, BYPASSRLS), sem security_invoker
--     e sem filtro de organização: a RLS das tabelas não valia por elas;
--   * o privilégio padrão do schema public (pg_default_acl do postgres) dava ALL a `anon` em toda tabela/view nova e
--     EXECUTE em toda função nova: `anon` (a chave pública do bundle) lia 19 views e escrevia por v_radar_company_queue;
--   * a contenção C1 (17/11/2026 14:54:42 UTC, registrada em docs/seguranca/s3-c1-contencao.sql) tirou `anon` das 21
--     views de public e a escrita de `authenticated`. Faltava o recorte: qualquer `authenticated` (Solicitante,
--     Engenharia de uma obra, outra organização) ainda lia todas as linhas.
--
-- O que esta migration faz, num único bloco (atômico com ou sem transação explícita):
--   1. pré-condição: PostgreSQL 15+, inventário de views de public+mart EXATAMENTE igual às 25 abaixo, todas do papel
--      que aplica, e as três funções fechadas no passo 4 existentes. Qualquer divergência aborta sem alterar nada;
--   2. retrato do privilégio EFETIVO de authenticated e service_role em toda relação e função do dono em public/mart
--      (inclui o que vinha por PUBLIC): é ele que os passos 3 e 4 preservam e que a pós-condição confere (R1);
--   3. views: security_invoker = true nas 25 (inclui as 3 do Radar, que a proposta comercial-acesso também tocaria: lá
--      vira operação idempotente; ALTER VIEW SET não recria a view, nenhuma regra de KPI muda). PUBLIC e anon sem nada;
--      authenticated só SELECT (agora sujeito à RLS). service_role fica EXATAMENTE como estava — inclusive a escrita
--      nas duas views auto-atualizáveis (v_parameter, v_radar_company_queue): é a chave do servidor, já ignora a RLS e
--      nenhum código do servidor escreve pelas views; mudar isso não foi autorizado (R5);
--   4. demais objetos do papel que aplica em public/mart:
--        - tabelas e sequências: PUBLIC e anon sem privilégio nenhum — repõe a intenção da 0003 ("revoke all on all
--          tables in schema public from anon"), desfeita pelo privilégio padrão. Antes de tirar PUBLIC, o que
--          authenticated e service_role tinham de fato vira concessão explícita (nada além disso) (R1);
--        - funções: EXECUTE sai de PUBLIC e de anon, com a mesma preservação de authenticated e service_role, e três
--          exceções fechadas também para authenticated: fn_cancel_entry, fn_close_period e fn_reopen_period (0003).
--          São SECURITY DEFINER, não conferem a organização do título/empresa/fechamento e nenhum código do app, das
--          funções Netlify ou dos scripts as chama; service_role mantém;
--   5. prevenção (privilégio padrão do papel que aplica) (R2, R4):
--        - schema public: tabelas, sequências e funções novas não dão mais nada a anon;
--        - global (vale para public, mart, schemas novos e funções de extensões instaladas por este papel): funções
--          novas deixam de dar EXECUTE a PUBLIC — o PostgreSQL só aceita tirar PUBLIC no padrão global — e passam a dar
--          EXECUTE explícito a authenticated e service_role, que antes o recebiam por PUBLIC. Assim nenhuma função nova
--          fica executável por anon, e nenhuma deixa de ser executável pelos papéis da aplicação e do servidor. Papéis
--          internos do Supabase que dependessem de PUBLIC em função NOVA precisam de concessão própria (documentado);
--        - qualquer padrão do papel, em qualquer schema ou global, que ainda conceda a anon é removido;
--      View nova continua nascendo SEM security_invoker: isso é barrado pelo Quality Gate (scripts/pg-smoke-views.mjs,
--      prova G) e pela regra no CLAUDE.md;
--   6. pós-condição: confere tudo acima pelo privilégio EFETIVO (has_*_privilege, que inclui PUBLIC e herança), compara
--      authenticated e service_role com o retrato do passo 2 e aborta se qualquer item divergir.
--
-- Fora daqui: tabelas/funções de outros donos (supabase_admin, extensões), schemas do Supabase (auth, storage), RLS e
-- políticas das tabelas (inalteradas), definição das views, dados. Idempotente: reaplicar não muda nada.
-- Reversão: docs/seguranca/s3.md §6 (gerada do retrato tirado imediatamente antes; volta ao estado pós-C1 e recusa
-- qualquer retrato que reabriria o que a C1 fechou).

do $s3$
declare
  eu oid := (select oid from pg_roles where rolname = current_user);
  anon_oid oid := (select oid from pg_roles where rolname = 'anon');
  views_esperadas text[] := array[
    'mart.aging', 'mart.cash_weekly', 'mart.dre_monthly', 'mart.project_360',
    'public.v_aging', 'public.v_composition_cost', 'public.v_dre_monthly', 'public.v_financial_entry_calc',
    'public.v_heat_traceability', 'public.v_opening_balance', 'public.v_parameter', 'public.v_project_360',
    'public.v_purchase_order', 'public.v_radar_company_queue', 'public.v_radar_contact_coverage', 'public.v_radar_pipeline',
    'public.v_service_billing', 'public.v_service_cost', 'public.v_service_labor', 'public.v_service_progress',
    'public.v_service_weight', 'public.v_station_productivity', 'public.v_steel_cost_by_service', 'public.v_stock_position',
    'public.v_training_progress'];
  views_atuais text[];
  fechadas oid[];
  privs text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  privs_seq text[] := array['USAGE', 'SELECT', 'UPDATE'];
  antes_fn jsonb;   -- oid da função → [authenticated executa, service_role executa]
  antes_rel jsonb;  -- oid da relação → {"a": privilégios de authenticated, "s": privilégios de service_role}
  r record;
  pa text[];
  ps text[];
  auth_tinha boolean;
  svc_tinha boolean;
  ruins text[] := '{}';
begin
  -- 1. pré-condição ------------------------------------------------------------------------------------------------
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'S3/0077: security_invoker exige PostgreSQL 15+ (servidor %)', current_setting('server_version');
  end if;
  if current_setting('server_version_num')::int >= 170000 then privs := privs || 'MAINTAIN'::text; end if;
  if anon_oid is null then raise exception 'S3/0077: papel anon inexistente'; end if;

  select array_agg(n.nspname || '.' || c.relname order by n.nspname || '.' || c.relname collate "C") into views_atuais
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname in ('public', 'mart');
  if views_atuais is distinct from (select array_agg(x order by x collate "C") from unnest(views_esperadas) x) then
    raise exception 'S3/0077: inventário de views divergente. Esperadas: %. Encontradas: %', views_esperadas, views_atuais;
  end if;
  select array_agg(n.nspname || '.' || c.relname) into ruins
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname in ('public', 'mart') and c.relowner <> eu;
  if ruins is not null then raise exception 'S3/0077: views de outro dono (aplicar como o dono): %', ruins; end if;
  ruins := '{}';

  fechadas := array[to_regprocedure('public.fn_cancel_entry(uuid, text)'), to_regprocedure('public.fn_close_period(uuid, character)'),
                    to_regprocedure('public.fn_reopen_period(uuid, text)')];
  if array_position(fechadas, null) is not null then
    raise exception 'S3/0077: funções esperadas ausentes (fn_cancel_entry, fn_close_period, fn_reopen_period): %', fechadas;
  end if;

  -- 2. retrato do privilégio efetivo de authenticated e service_role (o que os passos 3 e 4 têm de preservar) ----
  select coalesce(jsonb_object_agg(p.oid::text, jsonb_build_array(
           has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE'))), '{}')
    into antes_fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'mart') and p.proowner = eu
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

  select coalesce(jsonb_object_agg(c.oid::text, jsonb_build_object(
           'a', to_jsonb(array(select pv from unnest(case when c.relkind = 'S' then privs_seq else privs end) pv
                               where case when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, pv)
                                          else has_table_privilege('authenticated', c.oid, pv) end)),
           's', to_jsonb(array(select pv from unnest(case when c.relkind = 'S' then privs_seq else privs end) pv
                               where case when c.relkind = 'S' then has_sequence_privilege('service_role', c.oid, pv)
                                          else has_table_privilege('service_role', c.oid, pv) end)))), '{}')
    into antes_rel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname in ('public', 'mart') and c.relowner = eu;

  -- 3 e 4a. relações: service_role e authenticated preservados por concessão explícita; PUBLIC e anon fora ----------
  for r in select c.oid, n.nspname, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname in ('public', 'mart') and c.relowner = eu
           order by 2, 3 loop
    pa := array(select jsonb_array_elements_text(antes_rel -> r.oid::text -> 'a'));
    ps := array(select jsonb_array_elements_text(antes_rel -> r.oid::text -> 's'));
    if cardinality(ps) > 0 then
      execute format('grant %s on %s %I.%I to service_role', array_to_string(ps, ', '),
                     case when r.relkind = 'S' then 'sequence' else 'table' end, r.nspname, r.relname);
    end if;
    if r.relkind = 'v' then
      execute format('alter view %I.%I set (security_invoker = true)', r.nspname, r.relname);
      execute format('revoke all on table %I.%I from public, anon, authenticated', r.nspname, r.relname);
      execute format('grant select on table %I.%I to authenticated', r.nspname, r.relname);
    else
      if cardinality(pa) > 0 then
        execute format('grant %s on %s %I.%I to authenticated', array_to_string(pa, ', '),
                       case when r.relkind = 'S' then 'sequence' else 'table' end, r.nspname, r.relname);
      end if;
      execute format('revoke all on %s %I.%I from public, anon',
                     case when r.relkind = 'S' then 'sequence' else 'table' end, r.nspname, r.relname);
    end if;
  end loop;

  -- 4b. funções: PUBLIC e anon saem; authenticated e service_role ficam como estavam (menos as três fechadas) ------
  for r in select p.oid, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'mart') and p.proowner = eu
             and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
           order by 2 loop
    auth_tinha := (antes_fn -> r.oid::text ->> 0)::boolean and not r.oid = any(fechadas);
    svc_tinha := (antes_fn -> r.oid::text ->> 1)::boolean;
    if auth_tinha then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if svc_tinha then execute format('grant execute on function %s to service_role', r.sig); end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    if not auth_tinha then execute format('revoke execute on function %s from authenticated', r.sig); end if;
  end loop;

  -- 5. prevenção: privilégio padrão do papel que aplica -----------------------------------------------------------
  execute format('alter default privileges for role %I in schema public revoke all on tables from anon', current_user);
  execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', current_user);
  execute format('alter default privileges for role %I in schema public revoke all on functions from anon', current_user);
  execute format('alter default privileges for role %I revoke execute on functions from public', current_user);
  execute format('alter default privileges for role %I grant execute on functions to authenticated, service_role', current_user);
  -- qualquer outro padrão do papel (outro schema ou global) que ainda conceda a anon
  for r in select distinct d.defaclnamespace, d.defaclobjtype from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = eu and a.grantee = anon_oid loop
    execute format('alter default privileges for role %I%s revoke all on %s from anon', current_user,
                   case when r.defaclnamespace = 0 then '' else format(' in schema %I', r.defaclnamespace::regnamespace) end,
                   case r.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
                                        when 'T' then 'types' when 'n' then 'schemas' when 'L' then 'large objects' end);
  end loop;

  -- 6. pós-condição (privilégio efetivo) ---------------------------------------------------------------------------
  -- 6a. views: security_invoker, nada para anon, só SELECT para authenticated, nenhum grant a PUBLIC
  select ruins || coalesce(array_agg(format('%s.%s sem security_invoker', n.nspname, c.relname)), '{}') into ruins
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname in ('public', 'mart')
    and not coalesce(c.reloptions && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'], false);
  select ruins || coalesce(array_agg(format('%s.%s: %s %s', n.nspname, c.relname, papel, pv)), '{}') into ruins
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(privs) pv cross join unnest(array['anon', 'authenticated']) papel
  where c.relkind = 'v' and n.nspname in ('public', 'mart')
    and ((papel = 'anon' and has_table_privilege('anon', c.oid, pv))
      or (papel = 'authenticated' and has_table_privilege('authenticated', c.oid, pv) <> (pv = 'SELECT')));
  select ruins || coalesce(array_agg(format('%s.%s: grant a PUBLIC', n.nspname, c.relname)), '{}') into ruins
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname in ('public', 'mart') and c.relowner = eu and a.grantee = 0;
  -- 6b. relações do papel que aplica: anon sem nada; authenticated (fora das views) e service_role iguais ao retrato
  select ruins || coalesce(array_agg(format('%s.%s: %s', n.nspname, c.relname, m.motivo)), '{}') into ruins
  from pg_class c join pg_namespace n on n.oid = c.relnamespace,
  lateral (select string_agg(x, ', ') motivo from (
      select format('anon %s', pv) x from unnest(case when c.relkind = 'S' then privs_seq else privs end) pv
      where case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, pv) else has_table_privilege('anon', c.oid, pv) end
      union all
      select format('%s %s mudou', papel, pv) from unnest(case when c.relkind = 'S' then privs_seq else privs end) pv,
        unnest(array['authenticated', 'service_role']) papel
      where (papel = 'service_role' or c.relkind <> 'v') and antes_rel ? c.oid::text
        and (case when c.relkind = 'S' then has_sequence_privilege(papel, c.oid, pv) else has_table_privilege(papel, c.oid, pv) end)
            <> (antes_rel -> c.oid::text -> (case when papel = 'authenticated' then 'a' else 's' end) ? pv)) y) m
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname in ('public', 'mart') and c.relowner = eu and m.motivo is not null;
  -- 6c. funções: anon sem EXECUTE; authenticated e service_role iguais ao retrato (as três fechadas sem authenticated)
  select ruins || coalesce(array_agg(format('%s: %s', p.oid::regprocedure, m.motivo)), '{}') into ruins
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  lateral (select case
      when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon executa'
      when p.oid = any(fechadas) and has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated executa função fechada'
      when not p.oid = any(fechadas) and antes_fn ? p.oid::text
           and has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (antes_fn -> p.oid::text ->> 0)::boolean then 'authenticated mudou'
      when antes_fn ? p.oid::text
           and has_function_privilege('service_role', p.oid, 'EXECUTE') <> (antes_fn -> p.oid::text ->> 1)::boolean then 'service_role mudou'
    end motivo) m
  where n.nspname in ('public', 'mart') and p.proowner = eu and m.motivo is not null
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  -- 6d. privilégio padrão do papel: nada para anon em lugar nenhum (schema ou global); padrão global de funções sem
  --     PUBLIC e com authenticated e service_role
  select ruins || coalesce(array_agg(format('padrão %s/%s ainda concede a anon',
           case when d.defaclnamespace = 0 then 'global' else d.defaclnamespace::regnamespace::text end, d.defaclobjtype)), '{}') into ruins
  from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = eu and a.grantee = anon_oid;
  if not exists (select 1 from pg_default_acl d where d.defaclrole = eu and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
                 and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)
                 and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE')
                 and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE')) then
    ruins := ruins || 'padrão global de funções: PUBLIC ainda executa ou authenticated/service_role sem EXECUTE'::text;
  end if;

  if cardinality(ruins) > 0 then
    raise exception 'S3/0077: pós-condição falhou (nada foi gravado): %', array_to_string(ruins, ' · ');
  end if;
  raise notice 'S3/0077: 25 views com security_invoker; anon sem privilégio em views, relações e funções do dono; padrão corrigido';
end $s3$;

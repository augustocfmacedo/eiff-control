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
--      que aplica, e as três funções fechadas no passo 4 existentes. Também aborta (R9) se o catálogo mostrar papel
--      interno dependendo de PUBLIC: política dirigida a papel que não seja PUBLIC/anon/authenticated/service_role, ou
--      DEFAULT/CHECK/view fora de public/mart chamando função do dono. Nada é concedido a papel interno: quem ficar sem
--      acesso só por PUBLIC (supabase_auth_admin, supabase_storage_admin...) aparece no inventário do pré-voo
--      (docs/seguranca/s3-0077-verificacao.sql, item 17) para decisão humana. Qualquer divergência aborta sem alterar nada;
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
--          authenticated e service_role tinham de fato vira concessão explícita (nada além disso) (R1). Outros papéis
--          (internos do Supabase) que dependiam de PUBLIC perdem esse acesso: ver o passo 1 e o item 17 do pré-voo (R9);
--        - funções: EXECUTE sai de PUBLIC e de anon, com a mesma preservação de authenticated e service_role, e três
--          exceções fechadas também para authenticated: fn_cancel_entry, fn_close_period e fn_reopen_period (0003).
--          São SECURITY DEFINER, não conferem a organização do título/empresa/fechamento e nenhum código do app, das
--          funções Netlify ou dos scripts as chama; service_role mantém;
--   5. prevenção (privilégio padrão do papel que aplica), por MENOR PRIVILÉGIO (R2, R4, R10):
--        - schema public: tabelas e sequências novas não dão mais nada a anon (authenticated segue recebendo o padrão de
--          tabelas, que a RLS protege);
--        - funções novas, em QUALQUER schema (public, mart, schemas novos, extensões instaladas por este papel): EXECUTE
--          só para o dono e service_role. Nem PUBLIC, nem anon, nem authenticated. Função que o cliente precisa chamar
--          recebe `grant execute ... to authenticated` explícito na própria migration (regra no CLAUDE.md; o Quality
--          Gate confere a lista de SECURITY DEFINER executáveis por authenticated). Revogar PUBLIC só no schema não
--          neutraliza o padrão global do PostgreSQL; por isso a revogação é global;
--        - qualquer outro padrão do papel que conceda a anon, ou EXECUTE de função a authenticated, é removido;
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
  -- espera no máximo 5 s por bloqueio (ALTER VIEW pega AccessExclusiveLock); se não conseguir, aborta sem gravar nada
  perform set_config('lock_timeout', '5s', true);
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

  -- R9: dependências de papéis internos que o catálogo mostra e que a retirada de PUBLIC quebraria. Aborta (falha
  -- fechada) em vez de conceder algo a um papel interno: a decisão é humana, pelo inventário do pré-voo.
  --   a) política (public, mart, storage) dirigida a papel que não seja PUBLIC/anon/authenticated/service_role: ela
  --      avalia funções do dono com os direitos desse papel;
  select array_agg(format('%s.%s política %s', n.nspname, c.relname, p.polname)) into ruins
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'mart', 'storage')
    and exists (select 1 from unnest(p.polroles) x where x <> 0 and x not in (anon_oid, 'authenticated'::regrole, 'service_role'::regrole));
  if ruins is not null then raise exception 'S3/0077: políticas dirigidas a papéis internos (avaliar no pré-voo): %', ruins; end if;
  --   b) DEFAULT, CHECK ou view FORA de public/mart que chama função do dono em public/mart (DEFAULT e CHECK conferem
  --      EXECUTE de quem grava; view de outro schema roda com os direitos do dono dela). Gatilhos não entram: o
  --      PostgreSQL não confere EXECUTE quando o gatilho dispara.
  select array_agg(distinct format('%s -> %s', ct.oid::regclass, d.refobjid::regprocedure)) into ruins
  from pg_depend d
  join pg_proc pf on pf.oid = d.refobjid join pg_namespace nf on nf.oid = pf.pronamespace
  left join pg_attrdef ad on d.classid = 'pg_attrdef'::regclass and ad.oid = d.objid
  left join pg_constraint co on d.classid = 'pg_constraint'::regclass and co.oid = d.objid
  left join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and rw.oid = d.objid
  join pg_class ct on ct.oid = coalesce(ad.adrelid, co.conrelid, rw.ev_class)
  join pg_namespace nt on nt.oid = ct.relnamespace
  where d.refclassid = 'pg_proc'::regclass and nf.nspname in ('public', 'mart') and pf.proowner = eu
    and d.classid in ('pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_rewrite'::regclass)
    and nt.nspname not in ('public', 'mart');
  if ruins is not null then raise exception 'S3/0077: objetos fora de public/mart dependem de funções do dono (avaliar no pré-voo): %', ruins; end if;
  ruins := '{}';

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
    if auth_tinha then execute format('grant execute on routine %s to authenticated', r.sig); end if;
    if svc_tinha then execute format('grant execute on routine %s to service_role', r.sig); end if;
    execute format('revoke execute on routine %s from public, anon', r.sig);
    if not auth_tinha then execute format('revoke execute on routine %s from authenticated', r.sig); end if;
  end loop;

  -- 5. prevenção: privilégio padrão do papel que aplica -----------------------------------------------------------
  execute format('alter default privileges for role %I in schema public revoke all on tables from anon', current_user);
  execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', current_user);
  execute format('alter default privileges for role %I in schema public revoke all on functions from anon, authenticated', current_user);
  execute format('alter default privileges for role %I revoke execute on functions from public', current_user);
  execute format('alter default privileges for role %I revoke execute on functions from anon, authenticated', current_user);
  execute format('alter default privileges for role %I grant execute on functions to service_role', current_user);
  -- qualquer outro padrão do papel (outro schema ou global) que ainda conceda a anon
  for r in select distinct d.defaclnamespace, d.defaclobjtype from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = eu and a.grantee = anon_oid loop
    execute format('alter default privileges for role %I%s revoke all on %s from anon', current_user,
                   case when r.defaclnamespace = 0 then '' else format(' in schema %I', r.defaclnamespace::regnamespace) end,
                   case r.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
                                        when 'T' then 'types' when 'n' then 'schemas' when 'L' then 'large objects' end);
  end loop;
  -- e qualquer padrão de funções do papel, em outro schema, que conceda EXECUTE a authenticated (R10)
  for r in select distinct d.defaclnamespace from pg_default_acl d, aclexplode(d.defaclacl) a
           where d.defaclrole = eu and d.defaclobjtype = 'f' and d.defaclnamespace <> 0 and a.grantee = 'authenticated'::regrole loop
    execute format('alter default privileges for role %I in schema %I revoke execute on functions from authenticated', current_user, r.defaclnamespace::regnamespace);
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
  select ruins || coalesce(array_agg(format('padrão de funções %s ainda concede EXECUTE a authenticated',
           case when d.defaclnamespace = 0 then 'global' else d.defaclnamespace::regnamespace::text end)), '{}') into ruins
  from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = eu and d.defaclobjtype = 'f' and a.grantee = 'authenticated'::regrole;
  if not exists (select 1 from pg_default_acl d where d.defaclrole = eu and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
                 and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)
                 and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE')) then
    ruins := ruins || 'padrão global de funções: PUBLIC ainda executa ou service_role sem EXECUTE'::text;
  end if;

  if cardinality(ruins) > 0 then
    raise exception 'S3/0077: pós-condição falhou (nada foi gravado): %', array_to_string(ruins, ' · ');
  end if;
  raise notice 'S3/0077: 25 views com security_invoker; anon sem privilégio em views, relações e funções do dono; padrão corrigido';
end $s3$;

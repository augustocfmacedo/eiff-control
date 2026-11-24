-- S3 · C1 — contenção emergencial (versão C1-v1, 17/11/2026). Escopo: as 21 views do schema public.
-- Só GRANT/REVOKE. Não toca tabela, função, RLS, view (definição), credencial nem dado.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PRÉ-CONDIÇÃO: o schema public tem exatamente estas 21 views (nem mais, nem menos)
do $$
declare esperado text[] := array['v_aging','v_composition_cost','v_dre_monthly','v_financial_entry_calc','v_heat_traceability',
  'v_opening_balance','v_parameter','v_project_360','v_purchase_order','v_radar_company_queue','v_radar_contact_coverage',
  'v_radar_pipeline','v_service_billing','v_service_cost','v_service_labor','v_service_progress','v_service_weight',
  'v_station_productivity','v_steel_cost_by_service','v_stock_position','v_training_progress'];
  achado text[];
begin
  select array_agg(c.relname::text order by c.relname) into achado from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m');
  if achado is distinct from esperado then raise exception 'C1 abortada: views em public diferem do escopo: %', achado; end if;
end $$;

-- 1) anon: nenhum privilégio nas 21 views
revoke all on public.v_aging, public.v_composition_cost, public.v_dre_monthly, public.v_financial_entry_calc,
  public.v_heat_traceability, public.v_opening_balance, public.v_parameter, public.v_project_360, public.v_purchase_order,
  public.v_radar_company_queue, public.v_radar_contact_coverage, public.v_radar_pipeline, public.v_service_billing,
  public.v_service_cost, public.v_service_labor, public.v_service_progress, public.v_service_weight,
  public.v_station_productivity, public.v_steel_cost_by_service, public.v_stock_position, public.v_training_progress
  from anon;

-- 2) authenticated: só leitura (SELECT mantido; nada é ampliado)
revoke insert, update, delete, truncate, references, trigger, maintain on public.v_aging, public.v_composition_cost,
  public.v_dre_monthly, public.v_financial_entry_calc, public.v_heat_traceability, public.v_opening_balance, public.v_parameter,
  public.v_project_360, public.v_purchase_order, public.v_radar_company_queue, public.v_radar_contact_coverage,
  public.v_radar_pipeline, public.v_service_billing, public.v_service_cost, public.v_service_labor, public.v_service_progress,
  public.v_service_weight, public.v_station_productivity, public.v_steel_cost_by_service, public.v_stock_position,
  public.v_training_progress
  from authenticated;

-- PÓS-CONDIÇÃO (privilégio EFETIVO: has_table_privilege considera PUBLIC e herança). Qualquer divergência = rollback.
do $$
declare r record; p text; erros text := '';
begin
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('anon', r.oid, p) then erros := erros || format('anon %s %s; ', p, r.relname); end if;
      if p = 'SELECT' and not has_table_privilege('authenticated', r.oid, p) then erros := erros || format('authenticated perdeu SELECT %s; ', r.relname); end if;
      if p <> 'SELECT' and has_table_privilege('authenticated', r.oid, p) then erros := erros || format('authenticated %s %s; ', p, r.relname); end if;
      if not has_table_privilege('service_role', r.oid, p) then erros := erros || format('service_role perdeu %s %s; ', p, r.relname); end if;
      if not has_table_privilege('postgres', r.oid, p) then erros := erros || format('postgres perdeu %s %s; ', p, r.relname); end if;
    end loop;
    if exists (select 1 from aclexplode(coalesce((select relacl from pg_class where oid = r.oid), '{}')) a where a.grantee = 0) then
      erros := erros || format('PUBLIC tem grant em %s; ', r.relname); end if;
  end loop;
  if erros <> '' then raise exception 'C1 abortada na pós-condição: %', erros; end if;
end $$;

commit;
select 'C1 aplicada' as resultado, now() as instante;

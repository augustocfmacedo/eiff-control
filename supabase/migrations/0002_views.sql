-- EIFF Control - views de calculo (camada mart)
-- Reproduzem no banco as mesmas regras do motor TypeScript (src/core/engine.ts) para que
-- Power BI, n8n e relatorios usem definicoes unicas de KPI.

-- parametros ativos por organizacao
create or replace view v_parameter as
select p.*,
  (select inflow_factor from scenario_factor f where f.parameter_set_id = p.id and f.scenario = p.scenario) as inflow_factor,
  (select outflow_factor from scenario_factor f where f.parameter_set_id = p.id and f.scenario = p.scenario) as outflow_factor
from parameter_set p where p.active;

-- lancamento calculado (colunas X, Z, AA, AB, AC, AD, AG, AH, AI, AJ da planilha)
create or replace view v_financial_entry_calc as
select
  e.*,
  ca.category, ca.cash_group, ca.dre_group, ca.account_class,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) as included,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente') as official,
  case when e.status = 'Realizado' then coalesce(e.settlement_date, e.due_date) else e.due_date end as cash_date,
  case when e.entry_type = 'Entrada' then p.inflow_factor else p.outflow_factor end as scenario_factor,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.status = 'Cancelado' then 0
    when e.status = 'Realizado' then case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end
    when e.entry_type = 'Entrada' then e.planned_net_amount * e.probability * p.inflow_factor
    else -e.planned_net_amount * p.outflow_factor
  end as projected_cash_amount,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.status = 'Cancelado' then 0
    when e.status = 'Realizado' then case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end
    when e.entry_type = 'Entrada' then e.planned_net_amount else -e.planned_net_amount
  end as management_amount,
  to_char(e.competence_date, 'YYYYMM')::int as competence_key,
  case
    when not (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) then 'Ignorado'
    when e.status = 'Rascunho' then 'Rascunho'
    when e.status = 'Pendente' then 'Pendente de aprovação'
    when e.status = 'Cancelado' then 'Cancelado'
    when e.status = 'Realizado' then 'Realizado'
    when e.settled_amount > 0 and e.settled_amount < e.planned_net_amount then 'Parcialmente liquidado'
    when e.due_date is null then 'Sem vencimento'
    when e.due_date < p.base_date then 'Atrasado'
    when e.due_date <= p.base_date + 7 then 'Próximos 7 dias'
    else 'A vencer'
  end as situation,
  greatest(0, case when e.status in ('Cancelado','Realizado') then 0 else e.planned_net_amount - e.settled_amount end) as open_balance
from financial_entry e
join chart_account ca on ca.id = e.chart_account_id
join v_parameter p on p.organization_id = e.organization_id and (p.company_id is null or p.company_id = e.company_id);

-- saldo inicial consolidado (CONFIG!B13)
create or replace view v_opening_balance as
select b.organization_id, b.company_id, sum(b.opening_balance) as opening_balance, sum(b.linked_reserve) as linked_reserve
from bank_account b join v_parameter p on p.organization_id = b.organization_id
where b.active and (b.record_kind = 'Real' or (b.record_kind = 'Exemplo' and p.include_demo))
group by b.organization_id, b.company_id;

-- fluxo semanal de 13 semanas por categoria (FLUXO 13S)
create or replace function fn_cash_flow_weekly(p_org uuid, p_weeks int default 13)
returns table (week_no int, week_start date, week_end date, cash_group text, category text, entry_type entry_type, amount numeric)
language sql stable as $$
  with p as (select base_date from v_parameter where organization_id = p_org limit 1),
  w as (select g as week_no, (p.base_date + (g-1)*7)::date as week_start, (p.base_date + (g-1)*7 + 6)::date as week_end from p, generate_series(1, p_weeks) g)
  select w.week_no, w.week_start, w.week_end, ca.cash_group, ca.category, ca.entry_type,
         coalesce(sum(case when ca.entry_type = 'Entrada' then e.projected_cash_amount else -e.projected_cash_amount end), 0)
  from w cross join chart_account ca
  left join v_financial_entry_calc e on e.chart_account_id = ca.id and e.official and e.cash_date between w.week_start and w.week_end
  where ca.organization_id = p_org and ca.active
  group by w.week_no, w.week_start, w.week_end, ca.cash_group, ca.category, ca.entry_type
  order by w.week_no, ca.entry_type desc, ca.cash_group, ca.category;
$$;

-- fluxo mensal de 24 meses por grupo (FLUXO 24M)
create or replace function fn_cash_flow_monthly(p_org uuid, p_months int default 24)
returns table (month_no int, month_start date, month_end date, cash_group text, entry_type entry_type, amount numeric)
language sql stable as $$
  with p as (select date_trunc('month', base_date)::date as m0 from v_parameter where organization_id = p_org limit 1),
  m as (select g as month_no, (p.m0 + ((g-1) || ' month')::interval)::date as month_start,
               (p.m0 + (g || ' month')::interval - interval '1 day')::date as month_end from p, generate_series(1, p_months) g),
  grp as (select distinct cash_group, entry_type from chart_account where organization_id = p_org and active)
  select m.month_no, m.month_start, m.month_end, grp.cash_group, grp.entry_type,
         coalesce(sum(case when grp.entry_type = 'Entrada' then e.projected_cash_amount else -e.projected_cash_amount end), 0)
  from m cross join grp
  left join v_financial_entry_calc e on e.cash_group = grp.cash_group and e.official and e.cash_date between m.month_start and m.month_end and e.organization_id = p_org
  group by m.month_no, m.month_start, m.month_end, grp.cash_group, grp.entry_type
  order by m.month_no, grp.entry_type desc, grp.cash_group;
$$;

-- saldos acumulados semanais (roll-forward)
create or replace function fn_cash_balance_weekly(p_org uuid, p_weeks int default 13)
returns table (week_no int, week_start date, inflows numeric, outflows numeric, net numeric, closing_balance numeric, min_reserve numeric, surplus numeric)
language sql stable as $$
  with f as (
    select week_no, week_start,
      sum(case when entry_type = 'Entrada' then amount else 0 end) as inflows,
      sum(case when entry_type = 'Saída' then amount else 0 end) as outflows
    from fn_cash_flow_weekly(p_org, p_weeks) group by week_no, week_start),
  ob as (select coalesce(sum(opening_balance),0) as ob from v_opening_balance where organization_id = p_org),
  pr as (select min_reserve from v_parameter where organization_id = p_org limit 1)
  select f.week_no, f.week_start, f.inflows, f.outflows, f.inflows - f.outflows,
         ob.ob + sum(f.inflows - f.outflows) over (order by f.week_no),
         pr.min_reserve,
         ob.ob + sum(f.inflows - f.outflows) over (order by f.week_no) - pr.min_reserve
  from f, ob, pr order by f.week_no;
$$;

-- DRE gerencial por competencia (DRE GERENCIAL)
create or replace view v_dre_monthly as
select organization_id, company_id, competence_key,
  sum(case when dre_group = 'Receita Operacional' then management_amount else 0 end) as gross_revenue,
  -sum(case when dre_group = 'Deduções da Receita' then management_amount else 0 end) as deductions,
  -sum(case when dre_group = 'Custos Diretos' then management_amount else 0 end) as direct_costs,
  -sum(case when dre_group = 'Despesas com Pessoal' then management_amount else 0 end) as personnel,
  -sum(case when dre_group = 'Despesas Administrativas' then management_amount else 0 end) as administrative,
  -sum(case when dre_group = 'Despesas Comerciais' then management_amount else 0 end) as commercial,
  -sum(case when dre_group = 'Despesas Operacionais' then management_amount else 0 end) as operational,
  -sum(case when dre_group = 'Outras Despesas' then management_amount else 0 end) as other_expenses,
  -sum(case when dre_group = 'Resultado Financeiro' then management_amount else 0 end) as financial_result,
  sum(case when dre_group in ('Outras Receitas','Outras Receitas Operacionais') then management_amount else 0 end) as other_revenue,
  -sum(case when dre_group = 'Tributos' then management_amount else 0 end) as general_taxes
from v_financial_entry_calc where official
group by organization_id, company_id, competence_key;

-- Obra 360 (OBRAS + Blueprint secao 5)
create or replace view v_project_360 as
with e as (
  select project_id,
    sum(case when entry_type = 'Entrada' and status = 'Realizado' then settled_amount else 0 end) as received,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status <> 'Cancelado' then planned_net_amount else 0 end) as committed,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status = 'Realizado' then settled_amount else 0 end) as paid
  from v_financial_entry_calc where official and project_id is not null group by project_id)
select p.id, p.organization_id, p.company_id, p.code, p.name, p.client_name, p.status, p.contractual_end,
  p.contract_value + p.addenda_value as total_revenue,
  p.contract_value + p.addenda_value - p.budgeted_cost as budgeted_gross_margin,
  p.measured_invoiced,
  coalesce(e.received,0) as received,
  greatest(0, p.contract_value + p.addenda_value - p.measured_invoiced) as to_measure,
  greatest(0, p.measured_invoiced - coalesce(e.received,0)) as receivable,
  p.budgeted_cost,
  coalesce(e.committed,0) as committed_cost,
  coalesce(e.paid,0) as paid_cost,
  greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0)) as open_committed,
  p.estimate_to_complete as etc,
  greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))) as etc_uncommitted,
  coalesce(e.paid,0) + greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))
    + greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))) as eac,
  p.contract_value + p.addenda_value - (coalesce(e.paid,0) + greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))
    + greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0)))) as projected_margin,
  coalesce(e.received,0) - coalesce(e.paid,0) as project_cash,
  p.budgeted_cost - coalesce(e.committed,0) as budget_available
from project p left join e on e.project_id = p.id;

-- aging a receber/pagar
create or replace view v_aging as
select organization_id, company_id, entry_type,
  case when due_date >= (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) then 'A vencer'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 7 then '1-7 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 30 then '8-30 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 60 then '31-60 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 90 then '61-90 dias'
       else '> 90 dias' end as bucket,
  sum(open_balance) as amount, count(*) as qty
from v_financial_entry_calc c
where official and status not in ('Cancelado','Realizado') and due_date is not null
group by 1,2,3,4;

-- checks de integridade (CHECKS)
create or replace function fn_checks(p_org uuid)
returns table (check_id text, name text, actual numeric, expected numeric, tolerance numeric, status text, kind text)
language sql stable as $$
  select 'CHK-02','Lançamentos ativos sem categoria', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and chart_account_id is null
  union all
  select 'CHK-04','Lançamentos não cancelados sem vencimento', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status <> 'Cancelado' and due_date is null
  union all
  select 'CHK-05','Realizados sem data de realização', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status = 'Realizado' and settlement_date is null
  union all
  select 'CHK-06','Realizados sem valor realizado', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status = 'Realizado' and settled_amount = 0
  union all
  select 'CHK-11','Conciliações divergentes', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from reconciliation where organization_id = p_org and status = 'Divergente' and justification is null
  union all
  select 'CHK-13','Custos diretos sem obra', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and cash_group = 'Custos Diretos de Obras' and project_id is null and status <> 'Cancelado'
  union all
  select 'ALT-02','Caixa mínimo abaixo da reserva (13 semanas)', min(closing_balance), max(min_reserve), 0::numeric,
         case when min(closing_balance) >= max(min_reserve) then 'OK' else 'ATENÇÃO' end, 'alerta'
    from fn_cash_balance_weekly(p_org, 13)
  union all
  select 'ALT-03','Realizados sem conciliação', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'ATENÇÃO' end, 'alerta'
    from v_financial_entry_calc where organization_id = p_org and official and status = 'Realizado' and not reconciled
  union all
  select 'ALT-04','Aprovações com SLA vencido', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'ATENÇÃO' end, 'alerta'
    from approval_request where organization_id = p_org and status = 'Pendente' and sla_deadline < now();
$$;

-- marts somente leitura para Power BI (usuario de BI recebe grant apenas neste schema)
create or replace view mart.cash_weekly as select * from fn_cash_balance_weekly((select id from organization limit 1), 13);
create or replace view mart.dre_monthly as select * from v_dre_monthly;
create or replace view mart.project_360 as select * from v_project_360;
create or replace view mart.aging as select * from v_aging;

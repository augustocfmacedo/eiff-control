-- Faturamento direto ao cliente: compra da obra paga pelo cliente direto ao fornecedor. Abate o contrato global e o
-- orcamento do servico, mas nao passa pelo caixa nem pelo DRE da EIFF. Espelha src/core/engine.ts (direto).
alter table financial_entry add column if not exists direct_billing boolean not null default false;

-- v_financial_entry_calc usa e.*: precisa ser recriada para expor as colunas novas (service_id, direct_billing)
-- as views de BI em mart.* dependem destas e sao recriadas no fim
drop view if exists v_aging cascade;
drop view if exists v_project_360 cascade;
drop view if exists v_dre_monthly cascade;
drop view if exists v_financial_entry_calc cascade;

create view v_financial_entry_calc as
select
  e.*,
  ca.category, ca.cash_group, ca.dre_group, ca.account_class,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) as included,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente') as official,
  case when e.status = 'Realizado' then coalesce(e.settlement_date, e.due_date) else e.due_date end as cash_date,
  case when e.entry_type = 'Entrada' then p.inflow_factor else p.outflow_factor end as scenario_factor,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.direct_billing then 0
    when e.status = 'Cancelado' then 0
    when e.status = 'Realizado' then case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end
    when e.entry_type = 'Entrada' then e.planned_net_amount * e.probability * p.inflow_factor
    else -e.planned_net_amount * p.outflow_factor
  end as projected_cash_amount,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.direct_billing then 0
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

create view v_dre_monthly as
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

-- Obra 360: comprometido inclui faturamento direto (controle do orcamento); caixa da obra exclui
create view v_project_360 as
with e as (
  select project_id,
    sum(case when entry_type = 'Entrada' and status = 'Realizado' then settled_amount else 0 end) as received,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status <> 'Cancelado' then planned_net_amount else 0 end) as committed,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status = 'Realizado' then settled_amount else 0 end) as paid,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status <> 'Cancelado' and direct_billing then planned_net_amount else 0 end) as direct_committed,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status = 'Realizado' and direct_billing then settled_amount else 0 end) as direct_paid
  from v_financial_entry_calc where official and project_id is not null group by project_id),
d as (select project_id, sum(direct_amount) as direct_contracted from measurement where status <> 'Cancelado' group by project_id)
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
  coalesce(e.received,0) - (coalesce(e.paid,0) - coalesce(e.direct_paid,0)) as project_cash,
  p.budgeted_cost - coalesce(e.committed,0) as budget_available,
  coalesce(e.direct_committed,0) as direct_billing_committed,
  coalesce(e.direct_paid,0) as direct_billing_paid,
  coalesce(d.direct_contracted,0) as direct_billing_contracted,
  coalesce(d.direct_contracted,0) - coalesce(e.direct_committed,0) as direct_billing_available
from project p left join e on e.project_id = p.id left join d on d.project_id = p.id;

-- aging: faturamento direto nao e conta a pagar da EIFF
create view v_aging as
select organization_id, company_id, entry_type,
  case when due_date >= (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) then 'A vencer'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 7 then '1-7 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 30 then '8-30 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 60 then '31-60 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 90 then '61-90 dias'
       else '> 90 dias' end as bucket,
  sum(open_balance) as amount, count(*) as qty
from v_financial_entry_calc c
where official and not direct_billing and status not in ('Cancelado','Realizado') and due_date is not null
group by 1,2,3,4;

-- custo por servico: separa o faturamento direto
create or replace view v_service_cost as
select s.id, s.organization_id, s.project_id, p.code as project_code, s.code, s.name, s.phase, s.status,
  s.budgeted_cost, s.sale_price, s.planned_end,
  coalesce(sum(case when e.entry_type = 'Saída' and e.status <> 'Cancelado' then e.planned_net_amount end), 0) as committed_cost,
  coalesce(sum(case when e.entry_type = 'Saída' and e.status = 'Realizado' then e.settled_amount end), 0) as paid_cost,
  coalesce(sum(case when e.entry_type = 'Entrada' and e.status <> 'Cancelado' then e.planned_net_amount end), 0) as planned_revenue,
  coalesce(sum(case when e.entry_type = 'Saída' and e.status <> 'Cancelado' and e.direct_billing then e.planned_net_amount end), 0) as direct_billing_committed
from project_service s
join project p on p.id = s.project_id
left join financial_entry e on e.service_id = s.id and e.record_kind = 'Real' and e.status not in ('Rascunho', 'Pendente')
group by s.id, p.code;

-- camada mart (BI) recriada sobre as views novas
create or replace view mart.dre_monthly as select * from v_dre_monthly;
create or replace view mart.project_360 as select * from v_project_360;
create or replace view mart.aging as select * from v_aging;

grant select on v_financial_entry_calc, v_dre_monthly, v_project_360, v_aging, v_service_cost, mart.dre_monthly, mart.project_360, mart.aging to authenticated;

-- Medicao fisica de servico (boletim de avanco) e peso da fabricacao no avanco fisico dos servicos de estrutura.
-- Regras em src/core/obras.ts (calcServico): fabricacao x montagem ponderadas (kg ou ordens) > medicoes > quantidade > faturamento.
alter table project_service add column if not exists fab_weight numeric(5,4);

create table service_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid not null references project_service(id),
  measured_on date not null,
  quantity numeric(16,4) not null,
  pct numeric(6,4),
  description text not null,
  evidence text,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);
create index on service_progress (service_id, measured_on);
create trigger service_progress_audit after insert or delete on service_progress for each row execute function audit_row();

alter table service_progress enable row level security;
create policy sp_select on service_progress for select using (organization_id = current_org() and can_access_project(project_id));
create policy sp_insert on service_progress for insert with check (organization_id = current_org() and can_access_project(project_id) and not has_role('Auditoria'));
create policy sp_delete on service_progress for delete using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Gestor de obra','Engenharia','Financeiro'));
grant select, insert, delete on service_progress to authenticated;

create or replace view v_service_progress as
select s.id as service_id, s.project_id, s.code, s.budgeted_qty,
  coalesce(sum(p.quantity), 0) as measured_qty,
  case when s.budgeted_qty > 0 then least(1, coalesce(sum(p.quantity), 0) / s.budgeted_qty) else 0 end as measured_pct,
  count(p.id) as bulletins, max(p.measured_on) as last_measured_on
from project_service s left join service_progress p on p.service_id = s.id
group by s.id;
grant select on v_service_progress to authenticated;

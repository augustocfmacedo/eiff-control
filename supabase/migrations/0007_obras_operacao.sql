-- Modulo de operacao de obras: servicos (orcamento x prazo x custo), demandas em check-list e
-- ordens de fabricacao/montagem, todos ligados a obra e a base unica de lancamentos.

create type service_status as enum ('Não iniciado', 'Em andamento', 'Concluído', 'Suspenso');
create type demand_period as enum ('Diária', 'Semanal', 'Mensal', 'Única');
create type production_kind as enum ('Fabricação', 'Montagem');
create type stage_status as enum ('Pendente', 'Em andamento', 'Concluída');

-- servico/atividade da obra (codigo comum ao orcamento, cronograma, compra e medicao)
create table project_service (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  code text not null,
  name text not null,
  phase text not null default 'Outros',
  unit text not null default 'vb',
  budgeted_qty numeric(16,4) not null default 0,
  executed_qty numeric(16,4) not null default 0,
  budgeted_cost numeric(16,2) not null default 0,
  sale_price numeric(16,2) not null default 0,
  estimate_to_complete numeric(16,2),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  status service_status not null default 'Não iniciado',
  manager_id uuid references profile(id),
  default_category text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

alter table financial_entry add column service_id uuid references project_service(id);
create index on financial_entry (service_id);

-- demanda de check-list (recorrente ou unica); conclusoes por periodo
create table demand (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid references project_service(id),
  title text not null,
  description text,
  period demand_period not null default 'Diária',
  assignee_id uuid references profile(id),
  due_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);

create table demand_completion (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references demand(id) on delete cascade,
  completed_on date not null,
  completed_by uuid references profile(id),
  created_at timestamptz not null default now(),
  unique (demand_id, completed_on)
);

-- ordem de fabricacao (linha de producao) ou de montagem (linha de montagem)
create table production_order (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid references project_service(id),
  kind production_kind not null,
  code text not null,
  description text not null,
  quantity numeric(16,4) not null default 0,
  unit text not null default 'pç',
  priority text not null default 'Normal',
  needed_on date,
  notes text,
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  unique (project_id, code)
);

create table production_stage (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references production_order(id) on delete cascade,
  stage_order integer not null,
  name text not null,
  status stage_status not null default 'Pendente',
  completed_qty numeric(16,4) not null default 0,
  started_on date,
  finished_on date,
  responsible text,
  notes text,
  unique (order_id, stage_order)
);

create trigger project_service_touch before update on project_service for each row execute function touch_updated_at();
create trigger project_service_audit after insert or update or delete on project_service for each row execute function audit_row();
create trigger production_order_audit after insert or update on production_order for each row execute function audit_row();

-- RLS: mesmo escopo de obra; edicao por Gestor de obra, Engenharia, Compras (ordens), Financeiro e Administrador
alter table project_service enable row level security;
alter table demand enable row level security;
alter table demand_completion enable row level security;
alter table production_order enable row level security;
alter table production_stage enable row level security;

create policy service_select on project_service for select using (organization_id = current_org() and can_access_project(project_id));
create policy service_write on project_service for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia'));

create policy demand_select on demand for select using (organization_id = current_org() and can_access_project(project_id));
create policy demand_write on demand for all using (organization_id = current_org() and can_access_project(project_id) and not has_role('Auditoria'));
create policy completion_select on demand_completion for select using (exists (select 1 from demand d where d.id = demand_id and d.organization_id = current_org() and can_access_project(d.project_id)));
create policy completion_write on demand_completion for all using (exists (select 1 from demand d where d.id = demand_id and d.organization_id = current_org() and can_access_project(d.project_id)) and not has_role('Auditoria'));

create policy order_select on production_order for select using (organization_id = current_org() and can_access_project(project_id));
create policy order_write on production_order for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia','Compras'));
create policy stage_select on production_stage for select using (exists (select 1 from production_order o where o.id = order_id and o.organization_id = current_org() and can_access_project(o.project_id)));
create policy stage_write on production_stage for all using (exists (select 1 from production_order o where o.id = order_id and o.organization_id = current_org() and can_access_project(o.project_id)) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia','Compras'));

grant select, insert, update, delete on project_service, demand, demand_completion, production_order, production_stage to authenticated;

-- view: custo por servico (orcado x comprometido x pago) para BI.
-- Usa financial_entry diretamente: v_financial_entry_calc foi criada antes da coluna service_id existir
-- (o "e.*" de uma view e expandido na criacao) e sera recriada em uma migration futura.
create or replace view v_service_cost as
select s.id, s.organization_id, s.project_id, p.code as project_code, s.code, s.name, s.phase, s.status,
  s.budgeted_cost, s.sale_price, s.planned_end,
  coalesce(sum(case when e.entry_type = 'Saída' and e.status <> 'Cancelado' then e.planned_net_amount end), 0) as committed_cost,
  coalesce(sum(case when e.entry_type = 'Saída' and e.status = 'Realizado' then e.settled_amount end), 0) as paid_cost,
  coalesce(sum(case when e.entry_type = 'Entrada' and e.status <> 'Cancelado' then e.planned_net_amount end), 0) as planned_revenue
from project_service s
join project p on p.id = s.project_id
left join financial_entry e on e.service_id = s.id and e.record_kind = 'Real' and e.status not in ('Rascunho', 'Pendente')
group by s.id, p.code;

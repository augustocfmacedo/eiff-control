-- Equipe e produtividade: colaboradores, apontamento diario (obra/fabrica) e tarefas de campo.

create type work_location as enum ('Obra', 'Fábrica', 'Escritório');
create type attendance_kind as enum ('Presente', 'Falta', 'Atestado', 'Férias', 'Folga');
create type timesheet_status as enum ('Rascunho', 'Fechado');

create table worker (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  name text not null,
  role_name text not null,
  employment text not null default 'CLT',
  team text,
  location work_location not null default 'Obra',
  default_project_id uuid references project(id),
  hourly_cost numeric(12,2) not null default 0,
  daily_hours numeric(5,2) not null default 8.8,
  profile_id uuid references profile(id),
  phone text,
  hired_on date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table timesheet (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  work_date date not null,
  location work_location not null,
  project_id uuid references project(id),
  team text,
  weather text,
  notes text,
  photos text[] default '{}',
  status timesheet_status not null default 'Rascunho',
  responsible_id uuid references profile(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, work_date, location, project_id)
);

create table timesheet_line (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheet(id) on delete cascade,
  worker_id uuid not null references worker(id),
  attendance attendance_kind not null default 'Presente',
  hours numeric(5,2) not null default 0,
  overtime_hours numeric(5,2) not null default 0,
  service_id uuid references project_service(id),
  order_id uuid references production_order(id),
  note text,
  unique (timesheet_id, worker_id)
);

create table timesheet_output (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheet(id) on delete cascade,
  service_id uuid references project_service(id),
  order_id uuid references production_order(id),
  description text not null,
  quantity numeric(16,4) not null default 0,
  unit text not null default 't'
);

create table timesheet_incident (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheet(id) on delete cascade,
  kind text not null,
  description text,
  lost_hours numeric(6,2) not null default 0
);

-- tarefas de campo/fabrica: campos adicionais na tabela task
alter table task add column if not exists description text;
alter table task add column if not exists worker_id uuid references worker(id);
alter table task add column if not exists project_id uuid references project(id);
alter table task add column if not exists service_id uuid references project_service(id);
alter table task add column if not exists order_id uuid references production_order(id);
alter table task add column if not exists location work_location;
alter table task add column if not exists priority text default 'Normal';
alter table task add column if not exists done_at timestamptz;
alter table task add column if not exists blocked_reason text;

create trigger worker_touch before update on worker for each row execute function touch_updated_at();
create trigger worker_audit after insert or update on worker for each row execute function audit_row();
create trigger timesheet_audit after insert or update on timesheet for each row execute function audit_row();

alter table worker enable row level security;
alter table timesheet enable row level security;
alter table timesheet_line enable row level security;
alter table timesheet_output enable row level security;
alter table timesheet_incident enable row level security;

-- colaboradores: leitura por toda a organizacao; custo/hora e edicao restritos
create policy worker_select on worker for select using (organization_id = current_org());
create policy worker_write on worker for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));

-- apontamentos: escopo de obra; fabrica visivel a todos da organizacao
create policy ts_select on timesheet for select using (organization_id = current_org() and (project_id is null or can_access_project(project_id)));
create policy ts_write on timesheet for all using (organization_id = current_org() and (project_id is null or can_access_project(project_id)) and not has_role('Auditoria'));
create policy tsl_select on timesheet_line for select using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))));
create policy tsl_write on timesheet_line for all using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))) and not has_role('Auditoria'));
create policy tso_select on timesheet_output for select using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))));
create policy tso_write on timesheet_output for all using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))) and not has_role('Auditoria'));
create policy tsi_select on timesheet_incident for select using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))));
create policy tsi_write on timesheet_incident for all using (exists (select 1 from timesheet t where t.id = timesheet_id and t.organization_id = current_org() and (t.project_id is null or can_access_project(t.project_id))) and not has_role('Auditoria'));

grant select, insert, update, delete on worker, timesheet, timesheet_line, timesheet_output, timesheet_incident to authenticated;
grant delete on task to authenticated;

-- view: custo de mao de obra apropriado por servico (HH x custo/hora; hora extra 1,5x)
create or replace view v_service_labor as
select l.service_id, t.project_id, sum(l.hours) as hours, sum(l.overtime_hours) as overtime_hours,
  sum(l.hours * w.hourly_cost + l.overtime_hours * w.hourly_cost * 1.5) as labor_cost,
  count(distinct t.work_date) as days
from timesheet_line l
join timesheet t on t.id = l.timesheet_id
join worker w on w.id = l.worker_id
where l.attendance = 'Presente' and l.service_id is not null
group by l.service_id, t.project_id;

-- Cadastros: funcoes de colaborador (catalogo com categoria e custo/hora padrao) e alocacoes (colaborador em obra/fabrica/
-- escritorio por periodo e percentual). A alocacao vigente passa a definir onde o colaborador aparece no diario do dia e
-- no custo por obra; sem alocacao vale o local/obra padrao do cadastro (compatibilidade). Regras em src/core/equipe.ts.
create table job_function (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  category text not null default 'Canteiro' check (category in ('Fábrica', 'Canteiro', 'Escritório')),
  default_hourly_cost numeric(12,2),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger job_function_touch before update on job_function for each row execute function touch_updated_at();
create trigger job_function_audit after insert or update on job_function for each row execute function audit_row();
alter table job_function enable row level security;
create policy jf_select on job_function for select using (organization_id = current_org());
create policy jf_write on job_function for all using (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'));
grant select, insert, update, delete on job_function to authenticated;

create table worker_allocation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  worker_id uuid not null references worker(id),
  location work_location not null default 'Obra',
  project_id uuid references project(id),
  starts_on date not null,
  ends_on date,
  share numeric(5,4) not null default 1 check (share > 0 and share <= 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (location <> 'Obra' or project_id is not null)
);
create index on worker_allocation (worker_id, starts_on);
create index on worker_allocation (project_id, starts_on);
create trigger worker_allocation_touch before update on worker_allocation for each row execute function touch_updated_at();
create trigger worker_allocation_audit after insert or update or delete on worker_allocation for each row execute function audit_row();
alter table worker_allocation enable row level security;
create policy wa_select on worker_allocation for select using (organization_id = current_org());
create policy wa_write on worker_allocation for all using (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia'));
grant select, insert, update, delete on worker_allocation to authenticated;

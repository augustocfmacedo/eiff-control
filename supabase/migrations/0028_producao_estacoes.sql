-- Producao por estacao: apontamento diario (kg, pecas, horas por colaborador) e romaneios de expedicao.
-- Colaboradores e conjuntos do apontamento ficam em jsonb (uuids); regras em src/core/producao.ts e no store.
create type production_line as enum ('Fabricação', 'Montagem');
create type shipment_status as enum ('Emitido', 'Entregue', 'Cancelado');

create table station_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid references project_service(id),
  order_id uuid references production_order(id),
  log_date date not null,
  line production_line not null,
  station text not null,
  assemblies jsonb not null default '[]',
  pieces numeric(12,2) not null default 0,
  weight_kg numeric(14,2) not null default 0,
  workers jsonb not null default '[]',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);
create index on station_log (project_id, log_date);
create index on station_log (station);

create table shipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  number text not null,
  shipped_on date not null,
  carrier text not null,
  plate text,
  driver text,
  destination text,
  items jsonb not null default '[]',
  status shipment_status not null default 'Emitido',
  delivered_on date,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, number)
);
create trigger shipment_touch before update on shipment for each row execute function touch_updated_at();
create trigger shipment_audit after insert or update on shipment for each row execute function audit_row();

alter table station_log enable row level security;
alter table shipment enable row level security;
create policy sl_select on station_log for select using (organization_id = current_org() and can_access_project(project_id));
create policy sl_insert on station_log for insert with check (organization_id = current_org() and can_access_project(project_id) and not has_role('Auditoria'));
create policy sl_delete on station_log for delete using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Gestor de obra','Engenharia','Financeiro'));
create policy sh_select on shipment for select using (organization_id = current_org() and can_access_project(project_id));
create policy sh_write on shipment for all using (organization_id = current_org() and can_access_project(project_id) and not has_role('Auditoria'));
grant select, insert, delete on station_log to authenticated;
grant select, insert, update on shipment to authenticated;

-- view: produtividade por estacao (kg, horas, kg/HH)
create or replace view v_station_productivity as
select l.project_id, l.line, l.station, count(*) as logs, sum(l.weight_kg) as kg, sum(l.pieces) as pieces,
  sum((select coalesce(sum((w->>'horas')::numeric), 0) from jsonb_array_elements(l.workers) w)) as hours,
  case when sum((select coalesce(sum((w->>'horas')::numeric), 0) from jsonb_array_elements(l.workers) w)) > 0
    then sum(l.weight_kg) / sum((select coalesce(sum((w->>'horas')::numeric), 0) from jsonb_array_elements(l.workers) w)) else 0 end as kg_per_hour
from station_log l group by l.project_id, l.line, l.station;
grant select on v_station_productivity to authenticated;

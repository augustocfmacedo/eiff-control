-- Lista de materiais: conjuntos/marcas de montagem em kg por obra e servico, com avanco fisico por peso
-- (liberado, fabricado, expedido, montado). Regras em src/core/materiais.ts e no store.

create type assembly_kind as enum ('Pilar', 'Viga', 'Terça', 'Treliça', 'Contraventamento', 'Chumbador', 'Escada', 'Fechamento', 'Plataforma', 'Outros');

create table assembly (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid references project_service(id),
  order_id uuid references production_order(id),
  mark text not null,
  description text,
  profile text,
  kind assembly_kind not null default 'Viga',
  quantity numeric(12,2) not null default 1,
  unit_weight numeric(12,3) not null default 0,
  revision text,
  released_on date,
  fabricated_qty numeric(12,2) not null default 0,
  shipped_qty numeric(12,2) not null default 0,
  erected_qty numeric(12,2) not null default 0,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (project_id, mark)
);
create index on assembly (service_id);
create trigger assembly_touch before update on assembly for each row execute function touch_updated_at();

alter table assembly enable row level security;
create policy assembly_select on assembly for select using (organization_id = current_org() and can_access_project(project_id));
create policy assembly_write on assembly for all using (organization_id = current_org() and can_access_project(project_id) and not has_role('Auditoria'));
grant select, insert, update, delete on assembly to authenticated;

-- view: avanco por peso por servico (kg total, fabricado, expedido, montado)
create or replace view v_service_weight as
select a.project_id, a.service_id,
  sum(a.quantity * a.unit_weight) as total_kg,
  sum(least(a.fabricated_qty, a.quantity) * a.unit_weight) as fabricated_kg,
  sum(least(a.shipped_qty, a.quantity) * a.unit_weight) as shipped_kg,
  sum(least(a.erected_qty, a.quantity) * a.unit_weight) as erected_kg,
  count(*) as assemblies
from assembly a group by a.project_id, a.service_id;
grant select on v_service_weight to authenticated;

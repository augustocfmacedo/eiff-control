-- Estoque de aco com rastreabilidade de corrida: itens (perfis, chapas, tubos, consumiveis) e movimentos
-- (entrada com certificado/corrida, consumo por obra/ordem/conjunto, sobra, ajuste, estorno). Tudo em kg.
-- Regras (saldo por lote, custo medio movel, custo por servico) em src/core/estoque.ts e no store.
create type stock_movement_kind as enum ('Entrada', 'Consumo', 'Sobra', 'Ajuste', 'Estorno');
create type stock_location as enum ('Fábrica', 'Obra');

create table stock_item (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  description text not null,
  family text not null,
  catalog_input_id uuid references catalog_input(id),
  unit_weight numeric(12,4),
  min_stock numeric(14,2) not null default 0,
  active boolean not null default true,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, code)
);
create trigger stock_item_touch before update on stock_item for each row execute function touch_updated_at();
create trigger stock_item_audit after insert or update on stock_item for each row execute function audit_row();

create table stock_movement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  moved_on date not null,
  kind stock_movement_kind not null,
  item_id uuid not null references stock_item(id),
  location stock_location not null default 'Fábrica',
  project_id uuid references project(id),
  service_id uuid references project_service(id),
  order_id uuid references production_order(id),
  assemblies jsonb not null default '[]',
  quantity_kg numeric(14,3) not null,
  pieces numeric(12,2),
  heat_number text,
  certificate text,
  supplier text,
  purchase_order_id uuid references purchase_order(id),
  invoice text,
  unit_cost numeric(14,4) not null default 0,
  origin_id uuid references stock_movement(id),
  origin_kind stock_movement_kind,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);
create index on stock_movement (item_id, moved_on);
create index on stock_movement (project_id);
create index on stock_movement (heat_number);

alter table stock_item enable row level security;
alter table stock_movement enable row level security;
create policy si_select on stock_item for select using (organization_id = current_org());
create policy si_write on stock_item for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Compras','Gestor de obra','Engenharia'));
create policy sm_select on stock_movement for select using (organization_id = current_org() and (project_id is null or can_access_project(project_id)));
create policy sm_insert on stock_movement for insert with check (organization_id = current_org() and (project_id is null or can_access_project(project_id)) and not has_role('Auditoria'));
grant select, insert, update on stock_item to authenticated;
grant select, insert on stock_movement to authenticated;

-- posicao por item (saldo total e por local; custo medio simples das entradas)
create or replace view v_stock_position as
select i.organization_id, i.id as item_id, i.code, i.description, i.family, i.min_stock,
  coalesce(sum(case when m.kind = 'Consumo' then -m.quantity_kg else m.quantity_kg end), 0) as balance_kg,
  coalesce(sum(case when m.location = 'Fábrica' then (case when m.kind = 'Consumo' then -m.quantity_kg else m.quantity_kg end) else 0 end), 0) as balance_factory_kg,
  coalesce(sum(case when m.location = 'Obra' then (case when m.kind = 'Consumo' then -m.quantity_kg else m.quantity_kg end) else 0 end), 0) as balance_site_kg,
  coalesce(sum(case when m.kind = 'Entrada' then m.quantity_kg * m.unit_cost else 0 end) / nullif(sum(case when m.kind = 'Entrada' then m.quantity_kg else 0 end), 0), 0) as avg_entry_cost,
  count(distinct m.heat_number) filter (where m.heat_number is not null) as heats
from stock_item i left join stock_movement m on m.item_id = i.id
group by i.organization_id, i.id, i.code, i.description, i.family, i.min_stock;
grant select on v_stock_position to authenticated;

-- rastreabilidade: cada movimento com corrida, com o codigo da obra
create or replace view v_heat_traceability as
select m.organization_id, m.heat_number, i.code as item_code, i.description as item_description, m.kind, m.moved_on, m.location,
  p.code as project_code, m.service_id, m.order_id, m.quantity_kg, m.assemblies, m.supplier, m.certificate, m.invoice, m.unit_cost
from stock_movement m join stock_item i on i.id = m.item_id left join project p on p.id = m.project_id
where m.heat_number is not null;
grant select on v_heat_traceability to authenticated;

-- custo real de aco por obra e servico (consumo menos sobras; estornos revertem)
create or replace view v_steel_cost_by_service as
select m.organization_id, m.project_id, p.code as project_code, m.service_id,
  sum(case when coalesce(m.origin_kind, m.kind) = 'Consumo' then (case when m.kind = 'Estorno' then -m.quantity_kg else m.quantity_kg end) else 0 end) as consumed_kg,
  sum(case when coalesce(m.origin_kind, m.kind) = 'Sobra' then (case when m.kind = 'Estorno' then -m.quantity_kg else m.quantity_kg end) else 0 end) as returned_kg,
  sum(case when coalesce(m.origin_kind, m.kind) = 'Consumo' then (case when m.kind = 'Estorno' then -m.quantity_kg else m.quantity_kg end) * m.unit_cost
           when coalesce(m.origin_kind, m.kind) = 'Sobra' then -(case when m.kind = 'Estorno' then -m.quantity_kg else m.quantity_kg end) * m.unit_cost else 0 end) as cost
from stock_movement m join project p on p.id = m.project_id
where m.kind in ('Consumo', 'Sobra') or (m.kind = 'Estorno' and m.origin_kind in ('Consumo', 'Sobra'))
group by m.organization_id, m.project_id, p.code, m.service_id;
grant select on v_steel_cost_by_service to authenticated;

-- Suprimentos: pedidos de compra da obra, ligados ao servico, ao catalogo de insumos e ao lancamento gerado na emissao.
-- Regras no motor (src/core/compras.ts) e no store (emitir gera lancamento previsto; receber atualiza preco do insumo).

create type purchase_order_status as enum ('Rascunho', 'Emitido', 'Recebido parcial', 'Recebido', 'Cancelado');

create table purchase_order (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  service_id uuid references project_service(id),
  code text not null,
  supplier_name text not null,
  document text,
  order_date date not null default current_date,
  expected_on date,
  payment_days integer not null default 28,
  chart_account_id uuid references chart_account(id),
  direct_billing boolean not null default false,
  status purchase_order_status not null default 'Rascunho',
  entry_id uuid references financial_entry(id),
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, code)
);

create table purchase_order_item (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references purchase_order(id) on delete cascade,
  item_order integer not null,
  input_id uuid references catalog_input(id),
  description text not null,
  unit text not null default 'un',
  quantity numeric(18,4) not null,
  unit_price numeric(16,4) not null default 0,
  received_qty numeric(18,4) not null default 0
);
create index on purchase_order (project_id);
create index on purchase_order_item (order_id);

create trigger purchase_order_touch before update on purchase_order for each row execute function touch_updated_at();
create trigger purchase_order_audit after insert or update on purchase_order for each row execute function audit_row();

alter table purchase_order enable row level security;
alter table purchase_order_item enable row level security;
create policy po_select on purchase_order for select using (organization_id = current_org() and can_access_project(project_id));
create policy po_write on purchase_order for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Financeiro','Compras','Gestor de obra','Engenharia'));
create policy poi_select on purchase_order_item for select using (exists (select 1 from purchase_order o where o.id = order_id and o.organization_id = current_org() and can_access_project(o.project_id)));
create policy poi_write on purchase_order_item for all using (exists (select 1 from purchase_order o where o.id = order_id and o.organization_id = current_org() and can_access_project(o.project_id)) and has_role('Administrador','Diretoria','Financeiro','Compras','Gestor de obra','Engenharia'));
grant select, insert, update, delete on purchase_order, purchase_order_item to authenticated;

-- view: pedidos com totais para BI
create or replace view v_purchase_order as
select o.id, o.organization_id, o.project_id, p.code as project_code, o.service_id, o.code, o.supplier_name, o.order_date, o.expected_on, o.status, o.direct_billing, o.entry_id,
  coalesce(sum(i.quantity * i.unit_price), 0) as total,
  coalesce(sum(least(i.received_qty, i.quantity) * i.unit_price), 0) as received_total
from purchase_order o
join project p on p.id = o.project_id
left join purchase_order_item i on i.order_id = o.id
group by o.id, p.code;
grant select on v_purchase_order to authenticated;

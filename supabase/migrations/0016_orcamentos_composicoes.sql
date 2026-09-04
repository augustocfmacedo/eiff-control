-- Orcamentos: catalogo de insumos e composicoes (SINAPI/TCPO/proprias) e propostas com itens.
-- O custo unitario da composicao e calculado no motor (src/core/orcamentos.ts): soma(coeficiente x preco),
-- recursivo nas composicoes auxiliares. A view v_composition_cost espelha um nivel para BI.

create type catalog_source as enum ('SINAPI', 'TCPO', 'Própria');
create type input_kind as enum ('Material', 'Mão de obra', 'Equipamento', 'Serviço', 'Outros');
create type estimate_status as enum ('Rascunho', 'Enviado', 'Aprovado', 'Contratado', 'Perdido', 'Cancelado');

-- insumo do catalogo de precos
create table catalog_input (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source catalog_source not null default 'Própria',
  code text not null,
  description text not null,
  unit text not null default 'un',
  kind input_kind not null default 'Material',
  price numeric(16,4) not null default 0,
  price_date date,
  price_source text,
  class_name text,
  active boolean not null default true,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, code)
);

-- composicao de custo unitario
create table catalog_composition (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source catalog_source not null default 'Própria',
  code text not null,
  description text not null,
  unit text not null default 'un',
  group_name text,
  active boolean not null default true,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, code)
);

create table catalog_composition_item (
  id uuid primary key default gen_random_uuid(),
  composition_id uuid not null references catalog_composition(id) on delete cascade,
  item_order integer not null,
  input_id uuid references catalog_input(id),
  child_composition_id uuid references catalog_composition(id),
  coefficient numeric(18,8) not null,
  check ((input_id is not null) <> (child_composition_id is not null)),
  check (child_composition_id is distinct from composition_id)
);
create index on catalog_composition_item (composition_id);
create index on catalog_composition_item (input_id);

-- orcamento / proposta
create table estimate (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  code text not null,
  title text not null,
  client_name text,
  project_id uuid references project(id),
  estimate_date date not null default current_date,
  valid_until date,
  status estimate_status not null default 'Rascunho',
  bdi numeric(8,4) not null default 0.25,
  price_reference text,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, code)
);

create table estimate_item (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimate(id) on delete cascade,
  item_order integer not null,
  stage text,
  code text,
  description text not null,
  unit text not null default 'un',
  quantity numeric(18,4) not null default 0,
  composition_id uuid references catalog_composition(id),
  manual_unit_cost numeric(16,4),
  service_id uuid references project_service(id)
);
create index on estimate_item (estimate_id);

create trigger catalog_input_touch before update on catalog_input for each row execute function touch_updated_at();
create trigger catalog_composition_touch before update on catalog_composition for each row execute function touch_updated_at();
create trigger estimate_touch before update on estimate for each row execute function touch_updated_at();
create trigger estimate_audit after insert or update on estimate for each row execute function audit_row();

-- RLS: catalogo e orcamentos sao da organizacao; edicao por quem orca
alter table catalog_input enable row level security;
alter table catalog_composition enable row level security;
alter table catalog_composition_item enable row level security;
alter table estimate enable row level security;
alter table estimate_item enable row level security;

create policy input_select on catalog_input for select using (organization_id = current_org());
create policy input_write on catalog_input for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Engenharia','Compras','Gestor de obra'));
create policy composition_select on catalog_composition for select using (organization_id = current_org());
create policy composition_write on catalog_composition for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Engenharia','Compras','Gestor de obra'));
create policy composition_item_select on catalog_composition_item for select using (exists (select 1 from catalog_composition c where c.id = composition_id and c.organization_id = current_org()));
create policy composition_item_write on catalog_composition_item for all using (exists (select 1 from catalog_composition c where c.id = composition_id and c.organization_id = current_org()) and has_role('Administrador','Diretoria','Financeiro','Engenharia','Compras','Gestor de obra'));
create policy estimate_select on estimate for select using (organization_id = current_org());
create policy estimate_write on estimate for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Engenharia','Compras','Gestor de obra'));
create policy estimate_item_select on estimate_item for select using (exists (select 1 from estimate e where e.id = estimate_id and e.organization_id = current_org()));
create policy estimate_item_write on estimate_item for all using (exists (select 1 from estimate e where e.id = estimate_id and e.organization_id = current_org()) and has_role('Administrador','Diretoria','Financeiro','Engenharia','Compras','Gestor de obra'));

grant select, insert, update, delete on catalog_input, catalog_composition, catalog_composition_item, estimate, estimate_item to authenticated;

-- view: custo direto de um nivel da composicao (insumos diretos; auxiliares resolvidas no motor)
create or replace view v_composition_cost as
select c.id, c.organization_id, c.source, c.code, c.description, c.unit, c.group_name,
  coalesce(sum(i.coefficient * n.price), 0) as direct_input_cost,
  count(*) filter (where i.child_composition_id is not null) as child_compositions
from catalog_composition c
left join catalog_composition_item i on i.composition_id = c.id
left join catalog_input n on n.id = i.input_id
group by c.id;

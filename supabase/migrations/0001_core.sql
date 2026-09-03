-- EIFF Control - modelo canonico (camada core)
-- Blueprint Funcional v1, secao 6. Padroes transversais:
--  * UUID interno + codigo humano estavel
--  * organization_id em toda tabela de negocio; company_id quando pertence a uma entidade juridica
--  * created/updated by/at, version, status, source_system, external_id nos registros auditaveis
--  * documentos financeiros nao sao apagados: cancelamento/estorno
--  * valores monetarios positivos (numeric); o tipo define o sinal

create extension if not exists "pgcrypto";

create schema if not exists raw;      -- payload externo imutavel
create schema if not exists staging;  -- normalizacao, validacao, quarentena
create schema if not exists mart;     -- visoes para BI

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type entry_type as enum ('Entrada', 'Saída');
create type entry_status as enum ('Rascunho', 'Pendente', 'Aprovado', 'Programado', 'Realizado', 'Cancelado');
create type confidence_level as enum ('Confirmado', 'Provável', 'Estimado');
create type project_status as enum ('Planejamento', 'Em execução', 'Suspensa', 'Concluída', 'Cancelada');
create type scenario_kind as enum ('Conservador', 'Base', 'Otimista');
create type record_kind as enum ('Real', 'Exemplo');
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');
create type approval_kind as enum ('Lançamento', 'Compra', 'Medição', 'Aditivo', 'Revisão de orçamento', 'Dívida', 'Reabertura de período');
create type approval_decision as enum ('Pendente', 'Aprovado', 'Rejeitado', 'Devolvido');
create type reconciliation_status as enum ('Pendente', 'Parcial', 'Conciliado', 'Divergente');
create type debt_status as enum ('Ativa', 'Quitada', 'Renegociada');

-- ---------------------------------------------------------------------------
-- Organizacao e acesso
-- ---------------------------------------------------------------------------
create table organization (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table company (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  name text not null,
  cnpj text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- perfil ligado ao auth.users do Supabase
create table profile (
  id uuid primary key, -- = auth.users.id
  organization_id uuid not null references organization(id),
  name text not null,
  email text not null,
  role role_kind not null,
  active boolean not null default true,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now()
);

-- escopo por empresa e obra (NULL em project_id = todas as obras da empresa)
create table user_scope (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  profile_id uuid not null references profile(id) on delete cascade,
  company_id uuid not null references company(id),
  project_id uuid, -- fk adicionada abaixo
  read_only boolean not null default false,
  valid_until date,
  unique (profile_id, company_id, project_id)
);

-- ---------------------------------------------------------------------------
-- Parametros (CONFIG) - versionados, nunca escondidos em formulas
-- ---------------------------------------------------------------------------
create table parameter_set (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  base_date date not null,
  scenario scenario_kind not null default 'Base',
  include_demo boolean not null default false,
  min_reserve numeric(16,2) not null default 0,
  limit_project_manager numeric(16,2) not null default 0,
  limit_finance numeric(16,2) not null default 0,
  limit_board numeric(16,2) not null default 0,
  budget_deviation_allowed numeric(6,4) not null default 0.05,
  reconciliation_tolerance numeric(16,2) not null default 0.01,
  approval_sla_hours integer not null default 48,
  responsible text,
  version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);

create table scenario_factor (
  id uuid primary key default gen_random_uuid(),
  parameter_set_id uuid not null references parameter_set(id) on delete cascade,
  scenario scenario_kind not null,
  inflow_factor numeric(6,4) not null,
  outflow_factor numeric(6,4) not null,
  note text,
  unique (parameter_set_id, scenario)
);

-- ---------------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------------
create table chart_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text,
  category text not null,
  entry_type entry_type not null,
  cash_group text not null,      -- Grupo de Fluxo
  dre_group text not null,       -- Grupo DRE ("Não DRE" fica fora do resultado)
  account_class text not null,   -- Classe
  guidance text,
  active boolean not null default true,
  unique (organization_id, category)
);

create table cost_center (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  code text not null,
  name text not null,
  parent_id uuid references cost_center(id),
  active boolean not null default true,
  unique (organization_id, code)
);

create table counterparty (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text,
  name text not null,
  document text, -- CNPJ/CPF
  kind text not null default 'Fornecedor', -- Cliente | Fornecedor | Credor | Parceiro | Colaboradores
  email text,
  phone text,
  bank_details jsonb,
  active boolean not null default true,
  source_system text,
  external_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table bank_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  code text not null,
  record_kind record_kind not null default 'Real',
  institution text not null,
  account_label text not null,
  account_type text not null,
  opening_balance numeric(16,2) not null default 0,
  opening_balance_date date,
  linked_reserve numeric(16,2) not null default 0,
  active boolean not null default true,
  pluggy_item_id text,
  pluggy_account_id text,
  last_sync_at timestamptz,
  connection_status text,
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- Obras e contratos
-- ---------------------------------------------------------------------------
create table project (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  code text not null,
  record_kind record_kind not null default 'Real',
  name text not null,
  client_id uuid references counterparty(id),
  client_name text,
  city_state text,
  status project_status not null default 'Planejamento',
  scope text,
  signed_at date,
  starts_at date,
  contractual_end date,
  contract_value numeric(16,2) not null default 0,
  addenda_value numeric(16,2) not null default 0,
  budgeted_cost numeric(16,2) not null default 0,
  physical_progress numeric(6,4) not null default 0,
  measured_invoiced numeric(16,2) not null default 0,
  estimate_to_complete numeric(16,2) not null default 0, -- ETC informado (tudo que falta, contratado ou nao)
  etc_updated_at date,
  etc_updated_by uuid references profile(id),
  etc_justification text,
  manager_id uuid references profile(id),
  notes text,
  source_system text,
  external_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, code)
);
alter table user_scope add constraint user_scope_project_fk foreign key (project_id) references project(id);

create table contract (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  number text,
  value numeric(16,2) not null,
  signed_at date,
  ends_at date,
  document_url text,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table contract_addendum (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contract(id),
  number text,
  value numeric(16,2) not null,
  days_extension integer default 0,
  approved boolean not null default false,
  approved_at timestamptz,
  document_url text
);

create table project_phase (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  code text not null,
  name text not null,
  sort_order integer default 0,
  unique (project_id, code)
);

create table activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  phase_id uuid references project_phase(id),
  code text not null,
  name text not null,
  planned_start date,
  planned_end date,
  progress numeric(6,4) not null default 0,
  source_system text,
  external_id text,
  unique (project_id, code)
);

create table budget_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  version integer not null,
  status text not null default 'Rascunho', -- Rascunho | Aprovada | Substituída
  base boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references profile(id),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table budget_item (
  id uuid primary key default gen_random_uuid(),
  budget_version_id uuid not null references budget_version(id) on delete cascade,
  activity_id uuid references activity(id),
  chart_account_id uuid references chart_account(id),
  description text not null,
  quantity numeric(16,4),
  unit text,
  unit_cost numeric(16,4),
  total_cost numeric(16,2) not null
);

create table measurement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid not null references project(id),
  number text not null,
  kind text not null default 'Cliente', -- Interna | Cliente
  period_start date,
  period_end date,
  amount numeric(16,2) not null,
  status text not null default 'Rascunho', -- Rascunho | Revisão | Enviada | Aprovada | Faturada | Recebida
  invoice_number text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);

-- ---------------------------------------------------------------------------
-- Financeiro (LANCAMENTOS)
-- ---------------------------------------------------------------------------
create table financial_entry (
  id uuid primary key default gen_random_uuid(),
  code text not null,                       -- ID humano (REC-..., PAG-...)
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  record_kind record_kind not null default 'Real',
  entry_type entry_type not null,
  chart_account_id uuid not null references chart_account(id),
  sub_category text,
  cost_center_id uuid references cost_center(id),
  cost_center_label text,
  project_id uuid references project(id),
  activity_id uuid references activity(id),
  counterparty_id uuid references counterparty(id),
  counterparty_name text,
  document_number text,
  description text not null,
  competence_date date not null,
  due_date date,
  settlement_date date,
  status entry_status not null default 'Programado',
  confidence confidence_level not null default 'Estimado',
  probability numeric(5,4) not null default 1 check (probability between 0 and 1),
  bank_account_id uuid references bank_account(id),
  gross_amount numeric(16,2) not null check (gross_amount >= 0),
  tax_amount numeric(16,2) not null default 0 check (tax_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  interest_amount numeric(16,2) not null default 0 check (interest_amount >= 0),
  planned_net_amount numeric(16,2) generated always as (gross_amount - tax_amount - discount_amount + interest_amount) stored,
  settled_amount numeric(16,2) not null default 0,
  reconciled boolean not null default false,
  reconciliation_status reconciliation_status not null default 'Pendente',
  approval_state approval_decision,
  approved_by uuid references profile(id),
  approved_at timestamptz,
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references profile(id),
  notes text,
  measurement_id uuid references measurement(id),
  source_system text not null default 'eiff-control',
  external_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  unique (organization_id, code),
  unique (organization_id, source_system, external_id),
  constraint due_date_required check (status = 'Cancelado' or due_date is not null),
  constraint settled_requires_date check (status <> 'Realizado' or settlement_date is not null)
);
create index on financial_entry (organization_id, company_id, status);
create index on financial_entry (project_id);
create index on financial_entry (due_date);
create index on financial_entry (competence_date);

-- rateio por obra / centro / atividade (soma = 100%)
create table financial_allocation (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references financial_entry(id) on delete cascade,
  project_id uuid references project(id),
  cost_center_id uuid references cost_center(id),
  activity_id uuid references activity(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  amount numeric(16,2)
);

create table settlement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entry_id uuid not null references financial_entry(id),
  settled_on date not null,
  amount numeric(16,2) not null check (amount > 0),
  bank_account_id uuid not null references bank_account(id),
  document_number text,
  evidence_url text,
  reversed boolean not null default false,
  reversal_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);

create table attachment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entity_type text not null,
  entity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references profile(id)
);

-- recorrencia basica (FIN-007)
create table recurrence_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  template_entry_id uuid not null references financial_entry(id),
  frequency text not null default 'Mensal',
  day_rule text, -- ex.: "5º dia útil"
  next_run date,
  ends_on date,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Bancos e conciliacao (CONCILIACAO)
-- ---------------------------------------------------------------------------
create table bank_connection (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  provider text not null default 'pluggy',
  external_item_id text not null,
  consent_owner text,
  status text not null default 'ACTIVE',
  last_sync_at timestamptz,
  last_error text,
  unique (provider, external_item_id)
);

-- movimento bancario imutavel normalizado
create table bank_transaction (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  bank_account_id uuid not null references bank_account(id),
  record_kind record_kind not null default 'Real',
  external_id text,
  transaction_date date not null,
  description text,
  document_number text,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  amount numeric(16,2) generated always as (credit - debit) stored,
  balance_after numeric(16,2),
  raw_payload_id uuid,
  imported_at timestamptz not null default now(),
  unique (bank_account_id, external_id)
);
create index on bank_transaction (bank_account_id, transaction_date);

-- vinculo 1:1, 1:N e N:1 entre transacoes e liquidacoes/titulos
create table reconciliation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  bank_transaction_id uuid not null references bank_transaction(id),
  entry_id uuid references financial_entry(id),
  settlement_id uuid references settlement(id),
  matched_amount numeric(16,2) not null,
  difference numeric(16,2) not null default 0,
  status reconciliation_status not null default 'Pendente',
  justification text,
  match_score integer,
  match_criteria text[],
  reconciled_at timestamptz,
  reconciled_by uuid references profile(id)
);

-- ---------------------------------------------------------------------------
-- Dividas (DIVIDAS)
-- ---------------------------------------------------------------------------
create table debt (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  code text not null,
  record_kind record_kind not null default 'Real',
  creditor_id uuid references counterparty(id),
  creditor_name text,
  instrument text not null,
  contracted_at date,
  principal numeric(16,2) not null,
  outstanding_balance numeric(16,2) not null,
  annual_rate numeric(8,4),
  monthly_installment numeric(16,2),
  next_due_date date,
  remaining_installments integer,
  guarantee text,
  status debt_status not null default 'Ativa',
  notes text,
  unique (organization_id, code)
);

create table debt_installment (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debt(id) on delete cascade,
  number integer not null,
  due_date date not null,
  principal_amount numeric(16,2) not null default 0,
  interest_amount numeric(16,2) not null default 0,
  entry_id uuid references financial_entry(id), -- parcela lancada na base unica
  unique (debt_id, number)
);

-- ---------------------------------------------------------------------------
-- Tesouraria: cenarios e versoes de forecast
-- ---------------------------------------------------------------------------
create table forecast_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  base_date date not null,
  scenario scenario_kind not null,
  label text,
  assumptions jsonb,
  snapshot jsonb not null, -- fluxo 13S/24M congelado
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);

-- ---------------------------------------------------------------------------
-- Governanca: aprovacoes, colaboracao, fechamento, auditoria
-- ---------------------------------------------------------------------------
create table approval_policy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  entity_kind approval_kind not null,
  min_amount numeric(16,2) not null default 0,
  max_amount numeric(16,2),
  requires_project boolean,
  exception_only boolean not null default false,
  steps role_kind[] not null,
  sla_hours integer not null default 48,
  active boolean not null default true
);

create table approval_request (
  id uuid primary key default gen_random_uuid(),
  code text,
  organization_id uuid not null references organization(id),
  company_id uuid references company(id),
  entity_kind approval_kind not null,
  entity_id uuid not null,
  title text not null,
  amount numeric(16,2) not null default 0,
  project_id uuid references project(id),
  requested_by uuid not null references profile(id),
  requested_at timestamptz not null default now(),
  sla_deadline timestamptz not null,
  status approval_decision not null default 'Pendente',
  impact jsonb, -- orcamento disponivel, EAC, margem, saldo minimo 13S antes/depois
  exception_justification text,
  version integer not null default 1,
  unique (organization_id, code)
);

create table approval_step (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references approval_request(id) on delete cascade,
  step_order integer not null,
  role role_kind not null,
  delegate_id uuid references profile(id),
  status approval_decision not null default 'Pendente',
  decided_by uuid references profile(id),
  decided_at timestamptz,
  justification text,
  unique (request_id, step_order)
);

create table comment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entity_type text not null,
  entity_id uuid not null,
  author_id uuid not null references profile(id),
  body text not null,
  mentions uuid[] default '{}',
  created_at timestamptz not null default now()
);
create index on comment (entity_type, entity_id);

create table task (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  title text not null,
  entity_type text,
  entity_id uuid,
  assignee_id uuid references profile(id),
  due_on date,
  status text not null default 'Aberta',
  origin text,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);

create table period_close (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references company(id),
  period char(7) not null, -- yyyy-mm
  closed_at timestamptz not null default now(),
  closed_by uuid references profile(id),
  reopened_at timestamptz,
  reopened_by uuid references profile(id),
  reopen_reason text,
  unique (company_id, period)
);

create table audit_log (
  id bigserial primary key,
  organization_id uuid,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  source text default 'app'
);
create index on audit_log (entity_type, entity_id);
create index on audit_log (occurred_at);

-- ---------------------------------------------------------------------------
-- Integracoes
-- ---------------------------------------------------------------------------
create table raw.integration_event (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  event_type text not null,
  external_id text,
  idempotency_key text not null unique,
  payload jsonb not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received', -- received | processed | failed | quarantined
  error text,
  attempts integer not null default 0
);

create table sync_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organization(id),
  source_system text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  records_read integer default 0,
  records_written integer default 0,
  records_rejected integer default 0,
  error text
);

create table external_mapping (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_system text not null,
  entity_type text not null,
  external_code text not null,
  internal_id uuid not null,
  version integer not null default 1,
  unique (source_system, entity_type, external_code)
);

-- ---------------------------------------------------------------------------
-- Gatilhos: updated_at, versao, auditoria e bloqueio de periodo fechado
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

create trigger financial_entry_touch before update on financial_entry for each row execute function touch_updated_at();
create trigger project_touch before update on project for each row execute function touch_updated_at();

create or replace function audit_row() returns trigger language plpgsql security definer as $$
declare v_before jsonb; v_after jsonb; v_org uuid; v_id text;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_org := coalesce((v_after ->> 'organization_id')::uuid, (v_before ->> 'organization_id')::uuid);
  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');
  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, source)
  values (v_org, auth.uid(), tg_op, tg_table_name, v_id, v_before, v_after, 'db');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger financial_entry_audit after insert or update or delete on financial_entry for each row execute function audit_row();
create trigger settlement_audit after insert or update or delete on settlement for each row execute function audit_row();
create trigger reconciliation_audit after insert or update or delete on reconciliation for each row execute function audit_row();
create trigger project_audit after insert or update or delete on project for each row execute function audit_row();
create trigger approval_request_audit after insert or update on approval_request for each row execute function audit_row();
create trigger approval_step_audit after update on approval_step for each row execute function audit_row();
create trigger parameter_set_audit after insert or update on parameter_set for each row execute function audit_row();
create trigger period_close_audit after insert or update on period_close for each row execute function audit_row();

-- documentos financeiros nao sao apagados
create or replace function forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Registro financeiro nao pode ser apagado; use cancelamento/estorno (%).', tg_table_name;
end $$;
create trigger financial_entry_no_delete before delete on financial_entry for each row execute function forbid_delete();
create trigger settlement_no_delete before delete on settlement for each row execute function forbid_delete();
create trigger bank_transaction_no_delete before delete on bank_transaction for each row execute function forbid_delete();

-- periodo fechado bloqueia edicao retroativa por competencia
create or replace function block_closed_period() returns trigger language plpgsql as $$
declare v_period char(7);
begin
  v_period := to_char(coalesce(new.competence_date, old.competence_date), 'YYYY-MM');
  if exists (
    select 1 from period_close pc
    where pc.company_id = coalesce(new.company_id, old.company_id)
      and pc.period = v_period and pc.reopened_at is null
  ) then
    raise exception 'Periodo % fechado. Reabertura exige justificativa e dupla aprovacao.', v_period;
  end if;
  return coalesce(new, old);
end $$;
create trigger financial_entry_closed_period before insert or update on financial_entry for each row execute function block_closed_period();

-- liquidacao atualiza saldo e status do titulo (transacional, nao depende do frontend)
create or replace function apply_settlement() returns trigger language plpgsql as $$
declare v_total numeric(16,2); v_net numeric(16,2); v_last date;
begin
  select coalesce(sum(amount),0), max(settled_on) into v_total, v_last
    from settlement where entry_id = coalesce(new.entry_id, old.entry_id) and not reversed;
  select planned_net_amount into v_net from financial_entry where id = coalesce(new.entry_id, old.entry_id);
  update financial_entry set
    settled_amount = v_total,
    settlement_date = case when v_total >= v_net then v_last else settlement_date end,
    status = case when v_total >= v_net then 'Realizado'::entry_status
                  when status = 'Realizado' and v_total < v_net then 'Programado'::entry_status
                  else status end
  where id = coalesce(new.entry_id, old.entry_id);
  return coalesce(new, old);
end $$;
create trigger settlement_apply after insert or update on settlement for each row execute function apply_settlement();

-- rateio deve somar 100%
create or replace function check_allocation_total() returns trigger language plpgsql as $$
declare v_sum numeric;
begin
  select coalesce(sum(percentage),0) into v_sum from financial_allocation where entry_id = coalesce(new.entry_id, old.entry_id);
  if v_sum > 100.0001 then
    raise exception 'Rateio do lancamento excede 100%% (soma atual: % %%).', v_sum;
  end if;
  return coalesce(new, old);
end $$;
create trigger financial_allocation_total after insert or update or delete on financial_allocation for each row execute function check_allocation_total();

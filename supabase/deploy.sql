-- EIFF Control - implantacao completa (schema + views + RLS + carga inicial)
-- Gerado em 2026-09-03T18:18:08.647Z. Cole no SQL Editor do Supabase e execute uma vez.


-- ============================================================================
-- 0001_core.sql
-- ============================================================================
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


-- ============================================================================
-- 0002_views.sql
-- ============================================================================
-- EIFF Control - views de calculo (camada mart)
-- Reproduzem no banco as mesmas regras do motor TypeScript (src/core/engine.ts) para que
-- Power BI, n8n e relatorios usem definicoes unicas de KPI.

-- parametros ativos por organizacao
create or replace view v_parameter as
select p.*,
  (select inflow_factor from scenario_factor f where f.parameter_set_id = p.id and f.scenario = p.scenario) as inflow_factor,
  (select outflow_factor from scenario_factor f where f.parameter_set_id = p.id and f.scenario = p.scenario) as outflow_factor
from parameter_set p where p.active;

-- lancamento calculado (colunas X, Z, AA, AB, AC, AD, AG, AH, AI, AJ da planilha)
create or replace view v_financial_entry_calc as
select
  e.*,
  ca.category, ca.cash_group, ca.dre_group, ca.account_class,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) as included,
  (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente') as official,
  case when e.status = 'Realizado' then coalesce(e.settlement_date, e.due_date) else e.due_date end as cash_date,
  case when e.entry_type = 'Entrada' then p.inflow_factor else p.outflow_factor end as scenario_factor,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.status = 'Cancelado' then 0
    when e.status = 'Realizado' then case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end
    when e.entry_type = 'Entrada' then e.planned_net_amount * e.probability * p.inflow_factor
    else -e.planned_net_amount * p.outflow_factor
  end as projected_cash_amount,
  case
    when not ((e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) and e.status not in ('Rascunho','Pendente')) then 0
    when e.status = 'Cancelado' then 0
    when e.status = 'Realizado' then case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end
    when e.entry_type = 'Entrada' then e.planned_net_amount else -e.planned_net_amount
  end as management_amount,
  to_char(e.competence_date, 'YYYYMM')::int as competence_key,
  case
    when not (e.record_kind = 'Real' or (e.record_kind = 'Exemplo' and p.include_demo)) then 'Ignorado'
    when e.status = 'Rascunho' then 'Rascunho'
    when e.status = 'Pendente' then 'Pendente de aprovação'
    when e.status = 'Cancelado' then 'Cancelado'
    when e.status = 'Realizado' then 'Realizado'
    when e.settled_amount > 0 and e.settled_amount < e.planned_net_amount then 'Parcialmente liquidado'
    when e.due_date is null then 'Sem vencimento'
    when e.due_date < p.base_date then 'Atrasado'
    when e.due_date <= p.base_date + 7 then 'Próximos 7 dias'
    else 'A vencer'
  end as situation,
  greatest(0, case when e.status in ('Cancelado','Realizado') then 0 else e.planned_net_amount - e.settled_amount end) as open_balance
from financial_entry e
join chart_account ca on ca.id = e.chart_account_id
join v_parameter p on p.organization_id = e.organization_id and (p.company_id is null or p.company_id = e.company_id);

-- saldo inicial consolidado (CONFIG!B13)
create or replace view v_opening_balance as
select b.organization_id, b.company_id, sum(b.opening_balance) as opening_balance, sum(b.linked_reserve) as linked_reserve
from bank_account b join v_parameter p on p.organization_id = b.organization_id
where b.active and (b.record_kind = 'Real' or (b.record_kind = 'Exemplo' and p.include_demo))
group by b.organization_id, b.company_id;

-- fluxo semanal de 13 semanas por categoria (FLUXO 13S)
create or replace function fn_cash_flow_weekly(p_org uuid, p_weeks int default 13)
returns table (week_no int, week_start date, week_end date, cash_group text, category text, entry_type entry_type, amount numeric)
language sql stable as $$
  with p as (select base_date from v_parameter where organization_id = p_org limit 1),
  w as (select g as week_no, (p.base_date + (g-1)*7)::date as week_start, (p.base_date + (g-1)*7 + 6)::date as week_end from p, generate_series(1, p_weeks) g)
  select w.week_no, w.week_start, w.week_end, ca.cash_group, ca.category, ca.entry_type,
         coalesce(sum(case when ca.entry_type = 'Entrada' then e.projected_cash_amount else -e.projected_cash_amount end), 0)
  from w cross join chart_account ca
  left join v_financial_entry_calc e on e.chart_account_id = ca.id and e.official and e.cash_date between w.week_start and w.week_end
  where ca.organization_id = p_org and ca.active
  group by w.week_no, w.week_start, w.week_end, ca.cash_group, ca.category, ca.entry_type
  order by w.week_no, ca.entry_type desc, ca.cash_group, ca.category;
$$;

-- fluxo mensal de 24 meses por grupo (FLUXO 24M)
create or replace function fn_cash_flow_monthly(p_org uuid, p_months int default 24)
returns table (month_no int, month_start date, month_end date, cash_group text, entry_type entry_type, amount numeric)
language sql stable as $$
  with p as (select date_trunc('month', base_date)::date as m0 from v_parameter where organization_id = p_org limit 1),
  m as (select g as month_no, (p.m0 + ((g-1) || ' month')::interval)::date as month_start,
               (p.m0 + (g || ' month')::interval - interval '1 day')::date as month_end from p, generate_series(1, p_months) g),
  grp as (select distinct cash_group, entry_type from chart_account where organization_id = p_org and active)
  select m.month_no, m.month_start, m.month_end, grp.cash_group, grp.entry_type,
         coalesce(sum(case when grp.entry_type = 'Entrada' then e.projected_cash_amount else -e.projected_cash_amount end), 0)
  from m cross join grp
  left join v_financial_entry_calc e on e.cash_group = grp.cash_group and e.official and e.cash_date between m.month_start and m.month_end and e.organization_id = p_org
  group by m.month_no, m.month_start, m.month_end, grp.cash_group, grp.entry_type
  order by m.month_no, grp.entry_type desc, grp.cash_group;
$$;

-- saldos acumulados semanais (roll-forward)
create or replace function fn_cash_balance_weekly(p_org uuid, p_weeks int default 13)
returns table (week_no int, week_start date, inflows numeric, outflows numeric, net numeric, closing_balance numeric, min_reserve numeric, surplus numeric)
language sql stable as $$
  with f as (
    select week_no, week_start,
      sum(case when entry_type = 'Entrada' then amount else 0 end) as inflows,
      sum(case when entry_type = 'Saída' then amount else 0 end) as outflows
    from fn_cash_flow_weekly(p_org, p_weeks) group by week_no, week_start),
  ob as (select coalesce(sum(opening_balance),0) as ob from v_opening_balance where organization_id = p_org),
  pr as (select min_reserve from v_parameter where organization_id = p_org limit 1)
  select f.week_no, f.week_start, f.inflows, f.outflows, f.inflows - f.outflows,
         ob.ob + sum(f.inflows - f.outflows) over (order by f.week_no),
         pr.min_reserve,
         ob.ob + sum(f.inflows - f.outflows) over (order by f.week_no) - pr.min_reserve
  from f, ob, pr order by f.week_no;
$$;

-- DRE gerencial por competencia (DRE GERENCIAL)
create or replace view v_dre_monthly as
select organization_id, company_id, competence_key,
  sum(case when dre_group = 'Receita Operacional' then management_amount else 0 end) as gross_revenue,
  -sum(case when dre_group = 'Deduções da Receita' then management_amount else 0 end) as deductions,
  -sum(case when dre_group = 'Custos Diretos' then management_amount else 0 end) as direct_costs,
  -sum(case when dre_group = 'Despesas com Pessoal' then management_amount else 0 end) as personnel,
  -sum(case when dre_group = 'Despesas Administrativas' then management_amount else 0 end) as administrative,
  -sum(case when dre_group = 'Despesas Comerciais' then management_amount else 0 end) as commercial,
  -sum(case when dre_group = 'Despesas Operacionais' then management_amount else 0 end) as operational,
  -sum(case when dre_group = 'Outras Despesas' then management_amount else 0 end) as other_expenses,
  -sum(case when dre_group = 'Resultado Financeiro' then management_amount else 0 end) as financial_result,
  sum(case when dre_group in ('Outras Receitas','Outras Receitas Operacionais') then management_amount else 0 end) as other_revenue,
  -sum(case when dre_group = 'Tributos' then management_amount else 0 end) as general_taxes
from v_financial_entry_calc where official
group by organization_id, company_id, competence_key;

-- Obra 360 (OBRAS + Blueprint secao 5)
create or replace view v_project_360 as
with e as (
  select project_id,
    sum(case when entry_type = 'Entrada' and status = 'Realizado' then settled_amount else 0 end) as received,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status <> 'Cancelado' then planned_net_amount else 0 end) as committed,
    sum(case when entry_type = 'Saída' and cash_group = 'Custos Diretos de Obras' and status = 'Realizado' then settled_amount else 0 end) as paid
  from v_financial_entry_calc where official and project_id is not null group by project_id)
select p.id, p.organization_id, p.company_id, p.code, p.name, p.client_name, p.status, p.contractual_end,
  p.contract_value + p.addenda_value as total_revenue,
  p.contract_value + p.addenda_value - p.budgeted_cost as budgeted_gross_margin,
  p.measured_invoiced,
  coalesce(e.received,0) as received,
  greatest(0, p.contract_value + p.addenda_value - p.measured_invoiced) as to_measure,
  greatest(0, p.measured_invoiced - coalesce(e.received,0)) as receivable,
  p.budgeted_cost,
  coalesce(e.committed,0) as committed_cost,
  coalesce(e.paid,0) as paid_cost,
  greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0)) as open_committed,
  p.estimate_to_complete as etc,
  greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))) as etc_uncommitted,
  coalesce(e.paid,0) + greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))
    + greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))) as eac,
  p.contract_value + p.addenda_value - (coalesce(e.paid,0) + greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0))
    + greatest(0, p.estimate_to_complete - greatest(0, coalesce(e.committed,0) - coalesce(e.paid,0)))) as projected_margin,
  coalesce(e.received,0) - coalesce(e.paid,0) as project_cash,
  p.budgeted_cost - coalesce(e.committed,0) as budget_available
from project p left join e on e.project_id = p.id;

-- aging a receber/pagar
create or replace view v_aging as
select organization_id, company_id, entry_type,
  case when due_date >= (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) then 'A vencer'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 7 then '1-7 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 30 then '8-30 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 60 then '31-60 dias'
       when (select base_date from v_parameter v where v.organization_id = c.organization_id limit 1) - due_date <= 90 then '61-90 dias'
       else '> 90 dias' end as bucket,
  sum(open_balance) as amount, count(*) as qty
from v_financial_entry_calc c
where official and status not in ('Cancelado','Realizado') and due_date is not null
group by 1,2,3,4;

-- checks de integridade (CHECKS)
create or replace function fn_checks(p_org uuid)
returns table (check_id text, name text, actual numeric, expected numeric, tolerance numeric, status text, kind text)
language sql stable as $$
  select 'CHK-02','Lançamentos ativos sem categoria', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and chart_account_id is null
  union all
  select 'CHK-04','Lançamentos não cancelados sem vencimento', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status <> 'Cancelado' and due_date is null
  union all
  select 'CHK-05','Realizados sem data de realização', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status = 'Realizado' and settlement_date is null
  union all
  select 'CHK-06','Realizados sem valor realizado', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and status = 'Realizado' and settled_amount = 0
  union all
  select 'CHK-11','Conciliações divergentes', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from reconciliation where organization_id = p_org and status = 'Divergente' and justification is null
  union all
  select 'CHK-13','Custos diretos sem obra', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'FALHA' end, 'bloqueante'
    from v_financial_entry_calc where organization_id = p_org and included and cash_group = 'Custos Diretos de Obras' and project_id is null and status <> 'Cancelado'
  union all
  select 'ALT-02','Caixa mínimo abaixo da reserva (13 semanas)', min(closing_balance), max(min_reserve), 0::numeric,
         case when min(closing_balance) >= max(min_reserve) then 'OK' else 'ATENÇÃO' end, 'alerta'
    from fn_cash_balance_weekly(p_org, 13)
  union all
  select 'ALT-03','Realizados sem conciliação', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'ATENÇÃO' end, 'alerta'
    from v_financial_entry_calc where organization_id = p_org and official and status = 'Realizado' and not reconciled
  union all
  select 'ALT-04','Aprovações com SLA vencido', count(*)::numeric, 0::numeric, 0::numeric, case when count(*)=0 then 'OK' else 'ATENÇÃO' end, 'alerta'
    from approval_request where organization_id = p_org and status = 'Pendente' and sla_deadline < now();
$$;

-- marts somente leitura para Power BI (usuario de BI recebe grant apenas neste schema)
create or replace view mart.cash_weekly as select * from fn_cash_balance_weekly((select id from organization limit 1), 13);
create or replace view mart.dre_monthly as select * from v_dre_monthly;
create or replace view mart.project_360 as select * from v_project_360;
create or replace view mart.aging as select * from v_aging;


-- ============================================================================
-- 0003_rls.sql
-- ============================================================================
-- EIFF Control - seguranca por contexto (RLS)
-- NFR-01: toda tabela exposta tem RLS e grants minimos.
-- Permissoes efetivas = papel x empresa x obra x tipo de dado (Blueprint secao 7).

-- ---------------------------------------------------------------------------
-- Funcoes auxiliares (security definer, sem expor dados alem do necessario)
-- ---------------------------------------------------------------------------
create or replace function auth_profile() returns profile language sql stable security definer as $$
  select * from profile where id = auth.uid() and active
$$;

create or replace function current_org() returns uuid language sql stable security definer as $$
  select organization_id from profile where id = auth.uid() and active
$$;

create or replace function current_role_kind() returns role_kind language sql stable security definer as $$
  select role from profile where id = auth.uid() and active
$$;

create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles))
$$;

-- escopo de empresa: Administrador/Diretoria enxergam toda a organizacao; demais exigem user_scope
create or replace function can_access_company(p_company uuid) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profile pr join company c on c.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and c.id = p_company
      and (pr.role in ('Administrador','Diretoria')
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = c.id
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

-- escopo de obra: NULL em user_scope.project_id libera todas as obras da empresa
create or replace function can_access_project(p_project uuid) returns boolean language sql stable security definer as $$
  select p_project is null or exists (
    select 1 from profile pr join project p on p.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and p.id = p_project
      and (pr.role in ('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras')
           and can_access_company(p.company_id)
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = p.company_id
                        and (s.project_id is null or s.project_id = p.id)
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

-- ---------------------------------------------------------------------------
-- Habilitar RLS
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
alter table raw.integration_event enable row level security;

-- ---------------------------------------------------------------------------
-- Politicas por tabela
-- ---------------------------------------------------------------------------
-- organizacao / empresa
create policy org_select on organization for select using (id = current_org());
create policy company_select on company for select using (organization_id = current_org());
create policy company_admin on company for all using (organization_id = current_org() and has_role('Administrador'));

-- perfis e escopos: todos leem os colegas da organizacao; somente Administrador altera
create policy profile_select on profile for select using (organization_id = current_org());
create policy profile_admin on profile for all using (organization_id = current_org() and has_role('Administrador'));
create policy scope_select on user_scope for select using (organization_id = current_org());
create policy scope_admin on user_scope for all using (organization_id = current_org() and has_role('Administrador'));

-- parametros: leitura geral; alteracao por Administrador/Financeiro/Diretoria
create policy params_select on parameter_set for select using (organization_id = current_org());
create policy params_write on parameter_set for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy factors_select on scenario_factor for select using (exists (select 1 from parameter_set p where p.id = parameter_set_id and p.organization_id = current_org()));
create policy factors_write on scenario_factor for all using (exists (select 1 from parameter_set p where p.id = parameter_set_id and p.organization_id = current_org()) and has_role('Administrador','Financeiro','Diretoria'));

-- cadastros mestres
create policy chart_select on chart_account for select using (organization_id = current_org());
create policy chart_write on chart_account for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy cc_select on cost_center for select using (organization_id = current_org());
create policy cc_write on cost_center for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy cp_select on counterparty for select using (organization_id = current_org());
create policy cp_write on counterparty for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Compras'));

-- contas bancarias: Engenharia/Compras/Gestor nao enxergam saldos
create policy bank_select on bank_account for select using (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy bank_write on bank_account for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy conn_select on bank_connection for select using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy conn_admin on bank_connection for all using (organization_id = current_org() and has_role('Administrador'));
create policy tx_select on bank_transaction for select using (
  organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy tx_insert on bank_transaction for insert with check (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy rec_select on reconciliation for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy rec_write on reconciliation for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

-- obras: leitura por escopo; edicao por gestor/engenharia da obra, Financeiro e Administrador
create policy project_select on project for select using (organization_id = current_org() and can_access_project(id));
create policy project_insert on project for insert with check (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy project_update on project for update using (
  organization_id = current_org() and can_access_project(id)
  and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia'));
create policy contract_select on contract for select using (organization_id = current_org() and can_access_project(project_id));
create policy contract_write on contract for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy addendum_select on contract_addendum for select using (exists (select 1 from contract c where c.id = contract_id and can_access_project(c.project_id)));
create policy addendum_write on contract_addendum for all using (exists (select 1 from contract c where c.id = contract_id and can_access_project(c.project_id)) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy phase_select on project_phase for select using (organization_id = current_org() and can_access_project(project_id));
create policy phase_write on project_phase for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy activity_select on activity for select using (organization_id = current_org() and can_access_project(project_id));
create policy activity_write on activity for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy budget_select on budget_version for select using (organization_id = current_org() and can_access_project(project_id));
create policy budget_write on budget_version for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia','Financeiro'));
create policy budget_item_select on budget_item for select using (exists (select 1 from budget_version v where v.id = budget_version_id and can_access_project(v.project_id)));
create policy budget_item_write on budget_item for all using (exists (select 1 from budget_version v where v.id = budget_version_id and can_access_project(v.project_id)) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy meas_select on measurement for select using (organization_id = current_org() and can_access_project(project_id));
create policy meas_write on measurement for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia','Financeiro'));

-- lancamentos: escopo de obra; sem obra, exige escopo de empresa e papel corporativo
create policy entry_select on financial_entry for select using (
  organization_id = current_org() and can_access_company(company_id)
  and (project_id is not null and can_access_project(project_id)
       or project_id is null and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras')));
create policy entry_insert on financial_entry for insert with check (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Financeiro','Gestor de obra','Engenharia','Compras','Diretoria'));
create policy entry_update on financial_entry for update using (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Financeiro','Gestor de obra','Compras','Diretoria'));
-- delete bloqueado pelo trigger forbid_delete; sem politica de delete

create policy alloc_select on financial_allocation for select using (exists (select 1 from financial_entry e where e.id = entry_id and e.organization_id = current_org()));
create policy alloc_write on financial_allocation for all using (exists (select 1 from financial_entry e where e.id = entry_id and e.organization_id = current_org()) and has_role('Administrador','Financeiro','Gestor de obra'));

-- liquidacao: somente Financeiro/Administrador
create policy settle_select on settlement for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy settle_write on settlement for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

create policy attach_select on attachment for select using (organization_id = current_org());
create policy attach_write on attachment for insert with check (organization_id = current_org() and not has_role('Auditoria'));
create policy recur_select on recurrence_rule for select using (organization_id = current_org());
create policy recur_write on recurrence_rule for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

-- dividas
create policy debt_select on debt for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy debt_write on debt for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy debt_inst_select on debt_installment for select using (exists (select 1 from debt d where d.id = debt_id and d.organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria')));
create policy debt_inst_write on debt_installment for all using (exists (select 1 from debt d where d.id = debt_id and d.organization_id = current_org()) and has_role('Administrador','Financeiro'));

-- tesouraria
create policy forecast_select on forecast_version for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy forecast_write on forecast_version for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));

-- aprovacoes: solicitante ve as suas; papeis de etapa veem as pendentes; Diretoria/Admin veem tudo
create policy policy_select on approval_policy for select using (organization_id = current_org());
create policy policy_admin on approval_policy for all using (organization_id = current_org() and has_role('Administrador'));
create policy apr_select on approval_request for select using (
  organization_id = current_org() and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro','Auditoria')
    or exists (select 1 from approval_step s where s.request_id = id and s.role = current_role_kind())));
create policy apr_insert on approval_request for insert with check (organization_id = current_org() and requested_by = auth.uid());
create policy apr_update on approval_request for update using (organization_id = current_org() and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro')));
create policy step_select on approval_step for select using (exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org()));
-- segregacao: o solicitante nao decide a propria solicitacao
create policy step_decide on approval_step for update using (
  exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org() and r.requested_by <> auth.uid())
  and (role = current_role_kind() or delegate_id = auth.uid()));
create policy step_insert on approval_step for insert with check (exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org()));

-- colaboracao
create policy comment_select on comment for select using (organization_id = current_org());
create policy comment_insert on comment for insert with check (organization_id = current_org() and author_id = auth.uid() and not has_role('Auditoria'));
create policy task_select on task for select using (organization_id = current_org());
create policy task_write on task for all using (organization_id = current_org() and not has_role('Auditoria'));

-- fechamento: Financeiro fecha; reabertura exige Diretoria (validada na funcao fn_reopen_period)
create policy close_select on period_close for select using (organization_id = current_org());
create policy close_insert on period_close for insert with check (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy close_update on period_close for update using (organization_id = current_org() and has_role('Administrador','Diretoria'));

-- auditoria: somente leitura para perfis autorizados; escrita apenas por triggers (security definer)
create policy audit_select on audit_log for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));

-- integracoes: Administrador
create policy sync_select on sync_run for select using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy map_select on external_mapping for select using (organization_id = current_org());
create policy map_admin on external_mapping for all using (organization_id = current_org() and has_role('Administrador'));
-- raw.integration_event: sem politicas para usuarios finais (somente service role via n8n)

-- ---------------------------------------------------------------------------
-- Funcoes transacionais criticas (nao dependem de calculo no frontend)
-- ---------------------------------------------------------------------------
-- fechamento de periodo: exige checks bloqueantes zerados
create or replace function fn_close_period(p_company uuid, p_period char(7)) returns uuid
language plpgsql security definer as $$
declare v_org uuid; v_fail int; v_id uuid;
begin
  if not has_role('Administrador','Financeiro') then raise exception 'Somente Financeiro/Administrador fecham periodo'; end if;
  select organization_id into v_org from company where id = p_company;
  select count(*) into v_fail from fn_checks(v_org) where kind = 'bloqueante' and status = 'FALHA';
  if v_fail > 0 then raise exception 'Fechamento bloqueado: % check(s) com falha', v_fail; end if;
  insert into period_close (organization_id, company_id, period, closed_by) values (v_org, p_company, p_period, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- reabertura: Diretoria com motivo (dupla aprovacao registrada via approval_request do tipo 'Reabertura de período')
create or replace function fn_reopen_period(p_close uuid, p_reason text) returns void
language plpgsql security definer as $$
begin
  if not has_role('Diretoria','Administrador') then raise exception 'Reabertura exige Diretoria'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'Motivo obrigatorio'; end if;
  update period_close set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = p_reason where id = p_close;
end $$;

-- cancelamento/estorno de titulo com motivo obrigatorio
create or replace function fn_cancel_entry(p_entry uuid, p_reason text) returns void
language plpgsql security definer as $$
begin
  if not has_role('Administrador','Financeiro','Diretoria') then raise exception 'Sem permissao para cancelar'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'Motivo obrigatorio'; end if;
  update settlement set reversed = true, reversal_reason = p_reason where entry_id = p_entry and not reversed;
  update financial_entry set status = 'Cancelado', cancellation_reason = p_reason, cancelled_at = now(), cancelled_by = auth.uid(), settled_amount = 0
  where id = p_entry;
end $$;

-- grants minimos
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on schema mart to authenticated;
grant select on all tables in schema mart to authenticated;
-- usuario de BI (criar role 'bi_reader' no projeto) enxerga apenas mart
-- create role bi_reader noinherit login password '...';
-- grant usage on schema mart to bi_reader; grant select on all tables in schema mart to bi_reader;


-- ============================================================================
-- 0004_fix_rls_recursion.sql
-- ============================================================================
-- Corrige recursao infinita entre as politicas de approval_request e approval_step.
-- As politicas passam a usar funcoes security definer (que nao acionam RLS) para consultar a outra tabela.

create or replace function approval_request_org(p_request uuid) returns uuid
language sql stable security definer as $$
  select organization_id from approval_request where id = p_request
$$;

create or replace function approval_request_requester(p_request uuid) returns uuid
language sql stable security definer as $$
  select requested_by from approval_request where id = p_request
$$;

create or replace function approval_has_step_for_me(p_request uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from approval_step s
    where s.request_id = p_request and (s.role = current_role_kind() or s.delegate_id = auth.uid())
  )
$$;

drop policy if exists apr_select on approval_request;
create policy apr_select on approval_request for select using (
  organization_id = current_org()
  and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro','Auditoria') or approval_has_step_for_me(id)));

drop policy if exists step_select on approval_step;
create policy step_select on approval_step for select using (approval_request_org(request_id) = current_org());

drop policy if exists step_decide on approval_step;
create policy step_decide on approval_step for update using (
  approval_request_org(request_id) = current_org()
  and approval_request_requester(request_id) <> auth.uid()
  and (role = current_role_kind() or delegate_id = auth.uid() or has_role('Administrador')));

drop policy if exists step_insert on approval_step;
create policy step_insert on approval_step for insert with check (approval_request_org(request_id) = current_org());


-- ============================================================================
-- 0005_audit_app_insert.sql
-- ============================================================================
-- Permite que o aplicativo grave sua propria trilha de auditoria (acao de negocio + justificativa),
-- alem da trilha tecnica gravada por trigger. Continua imutavel: nao ha politicas de update/delete.
create policy audit_insert_app on audit_log for insert
  with check (organization_id = current_org() and actor_id = auth.uid() and source = 'app');


-- ============================================================================
-- 0006_admin_full_power.sql
-- ============================================================================
-- Fase de validacao com um unico operador: o Administrador pode decidir qualquer etapa de aprovacao,
-- inclusive das proprias solicitacoes. A auditoria marca essas decisoes como auto-aprovacao.
drop policy if exists step_decide on approval_step;
create policy step_decide on approval_step for update using (
  approval_request_org(request_id) = current_org()
  and (
    has_role('Administrador')
    or (approval_request_requester(request_id) <> auth.uid() and (role = current_role_kind() or delegate_id = auth.uid()))
  ));

-- Administrador tambem pode reabrir periodo, liquidar, conciliar e alterar cadastros (ja previsto nas politicas).
-- Promove o operador da validacao. Para voltar a Diretoria: update profile set role = 'Diretoria' where email = '...';
update profile set role = 'Administrador', active = true where lower(email) = 'augusto@eiff.com.br';


-- ============================================================================
-- 0007_obras_operacao.sql
-- ============================================================================
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


-- ============================================================================
-- 0008_equipe.sql
-- ============================================================================
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


-- ============================================================================
-- CARGA INICIAL (gerada de src/data/seed.json em 2026-09-03T18:18:08.646Z)
-- Origem: planilha Fluxo_de_Caixa_EIFF.xlsx | data-base 2026-09-01 | cenario Base
-- ============================================================================
insert into organization (code, name) values ('EIFF', 'EIFF') on conflict (code) do nothing;
insert into company (organization_id, code, name) values ((select id from organization where code = 'EIFF'), 'EIFF', 'EIFF Engenharia') on conflict (organization_id, code) do nothing;

insert into parameter_set (organization_id, base_date, scenario, include_demo, min_reserve, limit_project_manager, limit_finance, limit_board,
  budget_deviation_allowed, reconciliation_tolerance, approval_sla_hours, responsible, version)
select (select id from organization where code = 'EIFF'), '2026-09-01', 'Base', false, 0,
  20000, 100000, 100000,
  0.05, 0.01, 48,
  'Diretoria Financeira', '1.0 — Implantação'
where not exists (select 1 from parameter_set where organization_id = (select id from organization where code = 'EIFF') and active);
insert into scenario_factor (parameter_set_id, scenario, inflow_factor, outflow_factor)
select id, 'Conservador', 0.85, 1.05 from parameter_set where organization_id = (select id from organization where code = 'EIFF') and active
on conflict (parameter_set_id, scenario) do nothing;
insert into scenario_factor (parameter_set_id, scenario, inflow_factor, outflow_factor)
select id, 'Base', 1, 1 from parameter_set where organization_id = (select id from organization where code = 'EIFF') and active
on conflict (parameter_set_id, scenario) do nothing;
insert into scenario_factor (parameter_set_id, scenario, inflow_factor, outflow_factor)
select id, 'Otimista', 1.1, 0.95 from parameter_set where organization_id = (select id from organization where code = 'EIFF') and active
on conflict (parameter_set_id, scenario) do nothing;

-- plano de contas
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Sinais e adiantamentos', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Entradas antecipadas de clientes', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Medições de obras', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Recebimentos vinculados a medição', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Parcelas contratuais', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Parcelas previstas em contrato', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Projetos e engenharia', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Projetos, detalhamento e engenharia', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Venda de estruturas e materiais', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Estruturas, perfis e materiais', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Serviços de montagem', 'Entrada', 'Receitas Operacionais', 'Receita Operacional', 'Operacional', 'Montagem e instalação', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Reembolsos', 'Entrada', 'Outras Entradas', 'Outras Receitas Operacionais', 'Operacional', 'Reembolsos de despesas', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Empréstimos recebidos', 'Entrada', 'Financiamento e Capital', 'Não DRE', 'Financiamento', 'Captação de dívida', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Aportes de sócios', 'Entrada', 'Financiamento e Capital', 'Não DRE', 'Capital', 'Aporte de capital', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Venda de ativos', 'Entrada', 'Outras Entradas', 'Outras Receitas', 'Não operacional', 'Alienação de ativos', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Outros recebimentos', 'Entrada', 'Outras Entradas', 'Outras Receitas Operacionais', 'Operacional', 'Demais entradas de caixa', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Aço e perfis', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Perfis laminados, soldados e conformados', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Chapas, telhas e painéis', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Chapas, coberturas e fechamentos', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Concreto e fundações', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Infraestrutura e fundações', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Componentes e fixadores', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Parafusos, consumíveis e componentes', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Mão de obra terceirizada', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Fabricação, montagem e equipes terceiras', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Transporte e mobilização', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Fretes, guindastes e mobilização', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Equipamentos e locações', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Locações aplicadas às obras', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Projetos, ART e licenças', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Projetos, responsabilidade técnica e taxas', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Instalações e acabamentos', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Instalações e acabamentos contratados', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Outros custos diretos', 'Saída', 'Custos Diretos de Obras', 'Custos Diretos', 'Custo direto', 'Demais custos vinculados à obra', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Folha e salários', 'Saída', 'Despesas com Pessoal', 'Despesas com Pessoal', 'Despesa indireta', 'Folha mensal', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Pró-labore', 'Saída', 'Despesas com Pessoal', 'Despesas com Pessoal', 'Despesa indireta', 'Pró-labore da administração', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Encargos e benefícios', 'Saída', 'Despesas com Pessoal', 'Despesas com Pessoal', 'Despesa indireta', 'Encargos, benefícios e provisões', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Aluguel e condomínio', 'Saída', 'Despesas Administrativas', 'Despesas Administrativas', 'Despesa indireta', 'Imóveis administrativos e fabris', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Energia, água e internet', 'Saída', 'Despesas Administrativas', 'Despesas Administrativas', 'Despesa indireta', 'Utilidades', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Contabilidade e jurídico', 'Saída', 'Despesas Administrativas', 'Despesas Administrativas', 'Despesa indireta', 'Serviços profissionais', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Seguros', 'Saída', 'Despesas Administrativas', 'Despesas Administrativas', 'Despesa indireta', 'Seguros corporativos e de obras', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Tecnologia e software', 'Saída', 'Despesas Administrativas', 'Despesas Administrativas', 'Despesa indireta', 'Licenças e sistemas', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Marketing e tráfego', 'Saída', 'Despesas Comerciais', 'Despesas Comerciais', 'Despesa indireta', 'Aquisição de demanda', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Comissões', 'Saída', 'Despesas Comerciais', 'Despesas Comerciais', 'Despesa indireta', 'Comissões de vendas', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Viagens e representação', 'Saída', 'Despesas Comerciais', 'Despesas Comerciais', 'Despesa indireta', 'Visitas, viagens e representação', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Veículos e combustível', 'Saída', 'Despesas Operacionais', 'Despesas Operacionais', 'Despesa indireta', 'Frota e deslocamentos', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Manutenção', 'Saída', 'Despesas Operacionais', 'Despesas Operacionais', 'Despesa indireta', 'Manutenção fabril e geral', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Segurança e limpeza', 'Saída', 'Despesas Operacionais', 'Despesas Operacionais', 'Despesa indireta', 'Serviços de apoio', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Impostos sobre faturamento', 'Saída', 'Tributos', 'Deduções da Receita', 'Tributo', 'Tributos incidentes sobre receita', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Tributos e taxas gerais', 'Saída', 'Tributos', 'Tributos', 'Tributo', 'Tributos não vinculados diretamente ao faturamento', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Juros e tarifas bancárias', 'Saída', 'Serviço da Dívida', 'Resultado Financeiro', 'Financeiro', 'Juros, IOF e tarifas', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Amortização de dívidas', 'Saída', 'Serviço da Dívida', 'Não DRE', 'Financiamento', 'Principal de empréstimos e financiamentos', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Máquinas e equipamentos', 'Saída', 'Investimentos', 'Não DRE', 'Investimento', 'CAPEX produtivo', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Obras e benfeitorias', 'Saída', 'Investimentos', 'Não DRE', 'Investimento', 'CAPEX em instalações', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Distribuição de lucros', 'Saída', 'Outras Saídas', 'Não DRE', 'Capital', 'Distribuições aos sócios', true) on conflict (organization_id, category) do nothing;
insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values ((select id from organization where code = 'EIFF'), 'Outros pagamentos', 'Saída', 'Outras Saídas', 'Outras Despesas', 'Não operacional', 'Demais saídas de caixa', true) on conflict (organization_id, category) do nothing;

-- contas financeiras
insert into bank_account (organization_id, company_id, code, record_kind, institution, account_label, account_type, opening_balance, opening_balance_date, linked_reserve, active) values ((select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'CTA-001', 'Real', 'Caixa', 'Caixa disponível', 'Caixa', 11544.48, '2026-09-01', 0, true) on conflict (organization_id, code) do nothing;

-- obras
insert into project (organization_id, company_id, code, record_kind, name, client_name, city_state, status, scope, signed_at, starts_at, contractual_end, contract_value, addenda_value, budgeted_cost, physical_progress, measured_invoiced, estimate_to_complete, notes, source_system, external_id)
values ((select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'OB-SF-CL-01', 'Real', 'Smart Fit - Avenida César Lattes', 'Invest Market Construção Sob Medida Ltda ME', 'Goiânia / GO', 'Em execução', 'Execução da unidade Smart Fit em regime de empreitada global Turn Key', null, null, null, 1291500, 0, 0, 0, 157975, 0, 'Fontes: espelho/planilha de medição de 01/09/2026 e fluxo de recebimentos informado pelo usuário. Receita própria MODO; faturamento direto excluído.', 'planilha', 'OB-SF-CL-01')
on conflict (organization_id, code) do nothing;

-- lancamentos
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-001', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Invest Market Construção Sob Medida Ltda ME', 'NF 47', 'Medição aprovada E03, E05, E06 e E07 - NF 47 MODO', '2026-09-01', '2026-09-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 157975, 7898.75, 0, 0, 0, false, 'Fonte: NF 47 e espelho de medição aprovados em 01/09/2026.', 'planilha', 'REC-SF-CL-001')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-002', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-002', 'Receita prevista - mão de obra - ago/26', '2026-08-10', '2026-08-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 193975, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-002')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-003', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-003', 'Receita prevista - mão de obra - set/26', '2026-09-10', '2026-09-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 172000, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-003')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-004', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-004', 'Receita prevista - mão de obra - out/26', '2026-10-10', '2026-10-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 323175, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-004')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-005', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-005', 'Receita prevista - mão de obra - nov/26', '2026-11-10', '2026-11-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 238000, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-005')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-006', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-006', 'Receita prevista - mão de obra - dez/26', '2026-12-10', '2026-12-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 121000, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-006')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-007', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-007', 'Receita prevista - mão de obra - jan/27', '2027-01-10', '2027-01-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 144500, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-007')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-008', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-008', 'Receita prevista - mão de obra - fev/27', '2027-02-10', '2027-02-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 70500, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-008')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-009', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-009', 'Receita prevista - estrutura metálica - set/26', '2026-09-10', '2026-09-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 61818.99, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-009')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-010', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-010', 'Receita prevista - estrutura metálica - out/26', '2026-10-10', '2026-10-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 71091.84, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-010')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-011', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-011', 'Receita prevista - estrutura metálica - nov/26', '2026-11-10', '2026-11-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 103546.81, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-011')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-012', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-012', 'Receita prevista - estrutura metálica - dez/26', '2026-12-10', '2026-12-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 16828.5, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-012')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-013', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-013', 'Receita prevista - pintura estrutura metálica - out/26', '2026-10-10', '2026-10-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 36666.67, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-013')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-014', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-014', 'Receita prevista - pintura estrutura metálica - nov/26', '2026-11-10', '2026-11-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 62333.33, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-014')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-015', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-015', 'Receita prevista - telha isotérmica - dez/26', '2026-12-10', '2026-12-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 66330, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-015')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-016', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-016', 'Receita prevista - concreto piso e laje - nov/26', '2026-11-10', '2026-11-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 16615.38, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-016')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('REC-SF-CL-017', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Entrada', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Medições de obras'), null, 'Obra', (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'Fornecedor a definir', 'REC-SF-CL-017', 'Receita prevista - laje Steel Deck - set/26', '2026-09-10', '2026-09-10', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 104850, 0, 0, 0, 0, false, 'Fonte: fluxo de pagamentos informado pelo usuário em 01/09/2026.', 'planilha', 'REC-SF-CL-017')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2026-09', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2026-09', 'Folha de pagamento - 2026-09 (5º dia útil)', '2026-09-07', '2026-09-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2026-09')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2026-10', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2026-10', 'Folha de pagamento - 2026-10 (5º dia útil)', '2026-10-07', '2026-10-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2026-10')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2026-11', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2026-11', 'Folha de pagamento - 2026-11 (5º dia útil)', '2026-11-06', '2026-11-06', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2026-11')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2026-12', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2026-12', 'Folha de pagamento - 2026-12 (5º dia útil)', '2026-12-07', '2026-12-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2026-12')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-01', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-01', 'Folha de pagamento - 2027-01 (5º dia útil)', '2027-01-07', '2027-01-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-01')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-02', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-02', 'Folha de pagamento - 2027-02 (5º dia útil)', '2027-02-05', '2027-02-05', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-02')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-03', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-03', 'Folha de pagamento - 2027-03 (5º dia útil)', '2027-03-05', '2027-03-05', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-03')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-04', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-04', 'Folha de pagamento - 2027-04 (5º dia útil)', '2027-04-07', '2027-04-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-04')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-05', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-05', 'Folha de pagamento - 2027-05 (5º dia útil)', '2027-05-07', '2027-05-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-05')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-06', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-06', 'Folha de pagamento - 2027-06 (5º dia útil)', '2027-06-07', '2027-06-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-06')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-07', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-07', 'Folha de pagamento - 2027-07 (5º dia útil)', '2027-07-07', '2027-07-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-07')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-08', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-08', 'Folha de pagamento - 2027-08 (5º dia útil)', '2027-08-06', '2027-08-06', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-08')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-09', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-09', 'Folha de pagamento - 2027-09 (5º dia útil)', '2027-09-07', '2027-09-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-09')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-10', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-10', 'Folha de pagamento - 2027-10 (5º dia útil)', '2027-10-07', '2027-10-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-10')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-11', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-11', 'Folha de pagamento - 2027-11 (5º dia útil)', '2027-11-05', '2027-11-05', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-11')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2027-12', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2027-12', 'Folha de pagamento - 2027-12 (5º dia útil)', '2027-12-07', '2027-12-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2027-12')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-01', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-01', 'Folha de pagamento - 2028-01 (5º dia útil)', '2028-01-07', '2028-01-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-01')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-02', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-02', 'Folha de pagamento - 2028-02 (5º dia útil)', '2028-02-07', '2028-02-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-02')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-03', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-03', 'Folha de pagamento - 2028-03 (5º dia útil)', '2028-03-07', '2028-03-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-03')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-04', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-04', 'Folha de pagamento - 2028-04 (5º dia útil)', '2028-04-07', '2028-04-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-04')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-05', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-05', 'Folha de pagamento - 2028-05 (5º dia útil)', '2028-05-05', '2028-05-05', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-05')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-06', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-06', 'Folha de pagamento - 2028-06 (5º dia útil)', '2028-06-07', '2028-06-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-06')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-07', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-07', 'Folha de pagamento - 2028-07 (5º dia útil)', '2028-07-07', '2028-07-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-07')
on conflict (organization_id, code) do nothing;
insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values ('PAG-FOLHA-2028-08', (select id from organization where code = 'EIFF'), (select id from company where code = 'EIFF' and organization_id = (select id from organization where code = 'EIFF')), 'Real', 'Saída', (select id from chart_account where organization_id = (select id from organization where code = 'EIFF') and category = 'Folha e salários'), null, 'Corporativo', null, 'Colaboradores EIFF', 'FOLHA-2028-08', 'Folha de pagamento - 2028-08 (5º dia útil)', '2028-08-07', '2028-08-07', null, 'Programado', 'Confirmado', 1, (select id from bank_account where organization_id = (select id from organization where code = 'EIFF') and institution = 'Caixa' limit 1), 63220.04, 0, 0, 0, 0, false, 'Folha mensal recorrente: 12 colaboradores | valores informados pelo usuário | dias úteis sem feriados.', 'planilha', 'PAG-FOLHA-2028-08')
on conflict (organization_id, code) do nothing;

-- servicos das obras (derivados das receitas previstas) e vinculo dos lancamentos
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-01', 'Mão de obra', 'Montagem', 'vb', 1, 0, 0, 1263150, null, '2026-08-01', '2027-02-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-02', 'Estrutura metálica', 'Fabricação', 'vb', 1, 0, 0, 253286.14, null, '2026-09-01', '2026-12-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-03', 'Pintura estrutura metálica', 'Fabricação', 'vb', 1, 0, 0, 99000, null, '2026-10-01', '2026-11-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-04', 'Telha isotérmica', 'Cobertura e fechamento', 'vb', 1, 0, 0, 66330, null, '2026-12-01', '2026-12-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-05', 'Concreto piso e laje', 'Civil', 'vb', 1, 0, 0, 16615.38, null, '2026-11-01', '2026-11-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values ((select id from organization where code = 'EIFF'), (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01'), 'SFCL-06', 'Laje Steel Deck', 'Civil', 'vb', 1, 0, 0, 104850, null, '2026-09-01', '2026-09-10', 'Não iniciado', 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', true)
on conflict (project_id, code) do nothing;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-002' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-003' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-004' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-005' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-006' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-007' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-01') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-008' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-02') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-009' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-02') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-010' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-02') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-011' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-02') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-012' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-03') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-013' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-03') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-014' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-04') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-015' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-05') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-016' and service_id is null;
update financial_entry set service_id = (select id from project_service where project_id = (select id from project where organization_id = (select id from organization where code = 'EIFF') and code = 'OB-SF-CL-01') and code = 'SFCL-06') where organization_id = (select id from organization where code = 'EIFF') and code = 'REC-SF-CL-017' and service_id is null;

-- dividas

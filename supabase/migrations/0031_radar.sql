-- EIFF Radar: inteligencia comercial e CRM de oportunidades industriais.
-- Prefixo radar_ para nao colidir com company/project do modulo de obras. Regras em src/core/radar e no store;
-- RLS por organizacao (current_org) e papel (has_role). Auditoria por trigger nas entidades centrais.

create table radar_source (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  name text not null,
  source_type text not null,
  description text,
  reliability numeric(4,3) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table radar_company (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  cnpj text,
  legal_name text not null,
  trade_name text,
  domain text,
  website text,
  linkedin_url text,
  industry text,
  cnae text,
  city text,
  state text,
  country text not null default 'Brasil',
  employee_range text,
  revenue_range text,
  capital_social numeric(18,2),
  number_of_locations integer,
  source_id uuid references radar_source(id),
  source_external_id text,
  notes text,
  active boolean not null default true,
  merged_into uuid references radar_company(id),
  fit_score numeric(5,1) not null default 0,
  intent_score numeric(5,1) not null default 0,
  timing_score numeric(5,1) not null default 0,
  relationship_score numeric(5,1) not null default 0,
  data_quality_score numeric(5,1) not null default 0,
  priority_score numeric(5,1) not null default 0,
  priority_class text not null default 'D' check (priority_class in ('A+','A','B','C','D')),
  last_signal_at timestamptz,
  last_contact_at timestamptz,
  next_action_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  constraint radar_company_cnpj_chk check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);
create unique index radar_company_cnpj_uq on radar_company (organization_id, cnpj) where cnpj is not null and merged_into is null;
create index radar_company_domain_idx on radar_company (organization_id, domain);
create index radar_company_priority_idx on radar_company (organization_id, priority_score desc);
create index radar_company_next_action_idx on radar_company (organization_id, next_action_at);
create index radar_company_name_idx on radar_company (organization_id, lower(legal_name));

create table radar_contact (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  full_name text not null,
  job_title text,
  department text,
  seniority text,
  email text,
  phone text,
  mobile_phone text,
  whatsapp text,
  linkedin_url text,
  is_decision_maker boolean not null default false,
  decision_power text check (decision_power is null or decision_power in ('Baixo','Médio','Alto')),
  contact_quality numeric(5,1) not null default 0,
  source_id uuid references radar_source(id),
  last_verified_at timestamptz,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index radar_contact_company_idx on radar_contact (company_id);
create index radar_contact_email_idx on radar_contact (organization_id, lower(email));

create table radar_project (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  name text not null,
  project_type text,
  city text,
  state text,
  address text,
  estimated_area_m2 numeric(14,2),
  estimated_value numeric(18,2),
  stage text,
  expected_start_date date,
  source_id uuid references radar_source(id),
  source_external_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index radar_project_company_idx on radar_project (company_id);

create table radar_signal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  project_id uuid references radar_project(id),
  source_id uuid not null references radar_source(id),
  source_type text not null,
  signal_type text not null check (signal_type in ('CNO_NEW','CNO_EXPANSION','WAREHOUSE','NEW_FACTORY','NEW_DC','NEW_OFFICE','LAND_PURCHASE','EXPANSION','INVESTMENT','FUNDING','HIRING_ENGINEERING','HIRING_OPERATIONS','PUBLIC_TENDER','PUBLIC_PLAN','PROJECT_IDENTIFIED','PARTNER_REFERRAL','WEBSITE_CHANGE','NEWS','MANUAL')),
  title text not null,
  description text,
  event_at timestamptz not null,
  detected_at timestamptz not null default now(),
  confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  original_url text,
  external_id text,
  raw_payload jsonb,
  base_score numeric(6,1) not null default 0,
  effective_score numeric(6,1) not null default 0,
  verified boolean not null default false,
  verified_by uuid references profile(id),
  created_at timestamptz not null default now()
);
create index radar_signal_company_idx on radar_signal (company_id);
create index radar_signal_detected_idx on radar_signal (organization_id, detected_at desc);
create index radar_signal_type_idx on radar_signal (organization_id, signal_type);
create unique index radar_signal_external_uq on radar_signal (source_id, external_id) where external_id is not null;

create table radar_strategy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  name text not null,
  description text,
  message_template text,
  active boolean not null default true,
  sort_order integer not null default 0,
  unique (organization_id, code)
);

create table radar_response_type (
  organization_id uuid not null references organization(id),
  code text not null,
  name text not null,
  sentiment text not null check (sentiment in ('positivo','neutro','negativo')),
  active boolean not null default true,
  primary key (organization_id, code)
);

create table radar_opportunity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  project_id uuid references radar_project(id),
  title text not null,
  stage text not null check (stage in ('DETECTED','RESEARCHING','QUALIFIED','DECISION_MAKER_FOUND','CONTACT_STARTED','ENGAGED','NEED_CONFIRMED','PROJECT_RECEIVED','ENGINEERING','PRICING','PROPOSAL_SENT','NEGOTIATION','WON','LOST','NURTURE')),
  estimated_value numeric(18,2),
  probability numeric(4,3) not null default 0,
  expected_close_date date,
  owner_id uuid references profile(id),
  strategy_id uuid references radar_strategy(id),
  next_action text,
  next_action_at timestamptz,
  close_reason text,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profile(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profile(id),
  closed_at timestamptz
);
create index radar_opportunity_stage_idx on radar_opportunity (organization_id, stage);
create index radar_opportunity_company_idx on radar_opportunity (company_id);
create index radar_opportunity_next_action_idx on radar_opportunity (organization_id, next_action_at);

create table radar_opportunity_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  opportunity_id uuid not null references radar_opportunity(id),
  from_stage text,
  to_stage text not null,
  user_id uuid references profile(id),
  reason text,
  changed_at timestamptz not null default now()
);
create index radar_stage_history_opp_idx on radar_opportunity_stage_history (opportunity_id, changed_at);

create table radar_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  contact_id uuid references radar_contact(id),
  project_id uuid references radar_project(id),
  opportunity_id uuid references radar_opportunity(id),
  user_id uuid references profile(id),
  activity_type text not null check (activity_type in ('CALL','MESSAGE','EMAIL','MEETING','VISIT','PRESENTATION','PROPOSAL','NOTE','OTHER')),
  channel text not null check (channel in ('PHONE','WHATSAPP','EMAIL','LINKEDIN','VISIT','REFERRAL','OTHER')),
  strategy_id uuid references radar_strategy(id),
  occurred_at timestamptz not null,
  outcome text,
  notes text,
  raw_content text,
  created_at timestamptz not null default now()
);
create index radar_activity_company_idx on radar_activity (company_id, occurred_at desc);
create index radar_activity_user_idx on radar_activity (organization_id, user_id, occurred_at desc);

create table radar_task (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  contact_id uuid references radar_contact(id),
  opportunity_id uuid references radar_opportunity(id),
  assigned_to uuid references profile(id),
  task_type text not null check (task_type in ('CALL','FOLLOW_UP','EMAIL','MEETING','RESEARCH','PROPOSAL','VISIT','OTHER')),
  priority text not null default 'Normal' check (priority in ('Alta','Normal','Baixa')),
  due_at timestamptz not null,
  status text not null default 'Aberta' check (status in ('Aberta','Concluída','Cancelada')),
  description text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index radar_task_due_idx on radar_task (organization_id, status, due_at);
create index radar_task_company_idx on radar_task (company_id);

create table radar_experiment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  hypothesis text,
  strategy_id uuid references radar_strategy(id),
  channel text,
  started_at date not null,
  ended_at date,
  status text not null default 'Planejado' check (status in ('Planejado','Em andamento','Concluído')),
  result text,
  created_at timestamptz not null default now()
);

create table radar_score_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  rule_name text not null,
  dimension text not null check (dimension in ('FIT','TIMING','INTENT','RELATIONSHIP','DATA_QUALITY')),
  signal_type text,
  condition jsonb not null,
  weight numeric(6,1) not null,
  decay_enabled boolean not null default false,
  decay_days integer,
  active boolean not null default true,
  priority integer not null default 0
);
create index radar_score_rule_org_idx on radar_score_rule (organization_id, active, dimension);

create table radar_score_setting (
  organization_id uuid not null references organization(id),
  key text not null,
  value numeric(10,4) not null,
  primary key (organization_id, key)
);

create table radar_score_snapshot (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  scored_at timestamptz not null default now(),
  fit numeric(5,1) not null, timing numeric(5,1) not null, intent numeric(5,1) not null, relationship numeric(5,1) not null, data_quality numeric(5,1) not null,
  total numeric(5,1) not null,
  priority_class text not null,
  explanation jsonb not null
);
create index radar_score_snapshot_company_idx on radar_score_snapshot (company_id, scored_at desc);

create table radar_import_job (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_id uuid references radar_source(id),
  job_type text not null check (job_type in ('empresas','contatos')),
  file_name text not null,
  status text not null check (status in ('Processando','Concluída','Com erros','Falhou')),
  total_rows integer not null default 0,
  imported integer not null default 0,
  updated integer not null default 0,
  duplicates integer not null default 0,
  errors integer not null default 0,
  created_by uuid references profile(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table radar_import_row (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  job_id uuid not null references radar_import_job(id),
  row_number integer not null,
  data jsonb not null,
  status text not null check (status in ('importada','atualizada','duplicata_possivel','erro','ignorada')),
  entity_id uuid,
  message text
);
create index radar_import_row_job_idx on radar_import_row (job_id, row_number);
create table radar_import_error (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  job_id uuid not null references radar_import_job(id),
  row_number integer not null,
  field text,
  message text not null
);
create index radar_import_error_job_idx on radar_import_error (job_id);

create table radar_possible_duplicate (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  candidate_id uuid not null references radar_company(id),
  confidence numeric(4,3) not null,
  reason text not null,
  status text not null default 'pendente' check (status in ('pendente','mesclada','descartada')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profile(id)
);
create index radar_possible_duplicate_status_idx on radar_possible_duplicate (organization_id, status);

create table radar_suppression (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  contact_id uuid references radar_contact(id),
  company_id uuid references radar_company(id),
  suppression_type text not null check (suppression_type in ('do_not_contact','email_bounced','invalid_phone','opt_out')),
  reason text,
  created_by uuid references profile(id),
  created_at timestamptz not null default now(),
  check (contact_id is not null or company_id is not null)
);
create index radar_suppression_contact_idx on radar_suppression (contact_id);
create index radar_suppression_company_idx on radar_suppression (company_id);

create table radar_source_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_id uuid not null references radar_source(id),
  record_type text not null check (record_type in ('empresa','contato','projeto','sinal')),
  external_id text,
  payload jsonb not null,
  entity_id uuid,
  received_at timestamptz not null default now()
);
create index radar_source_record_source_idx on radar_source_record (source_id, received_at desc);

-- auditoria e updated_at nas entidades centrais
create trigger radar_company_touch before update on radar_company for each row execute function touch_updated_at();
create trigger radar_company_audit after insert or update on radar_company for each row execute function audit_row();
create trigger radar_contact_touch before update on radar_contact for each row execute function touch_updated_at();
create trigger radar_project_touch before update on radar_project for each row execute function touch_updated_at();
create trigger radar_opportunity_touch before update on radar_opportunity for each row execute function touch_updated_at();
create trigger radar_opportunity_audit after insert or update on radar_opportunity for each row execute function audit_row();
create trigger radar_score_rule_audit after insert or update on radar_score_rule for each row execute function audit_row();
create trigger radar_suppression_audit after insert or delete on radar_suppression for each row execute function audit_row();

-- RLS: leitura para toda a organizacao; escrita para os papeis comerciais; configuracao para Administrador/Diretoria
do $$
declare t text;
begin
  foreach t in array array['radar_source','radar_company','radar_contact','radar_project','radar_signal','radar_strategy','radar_response_type','radar_opportunity','radar_opportunity_stage_history','radar_activity','radar_task','radar_experiment','radar_score_rule','radar_score_setting','radar_score_snapshot','radar_import_job','radar_import_row','radar_import_error','radar_possible_duplicate','radar_suppression','radar_source_record'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (organization_id = current_org())', t || '_select', t);
  end loop;
  foreach t in array array['radar_company','radar_contact','radar_project','radar_signal','radar_opportunity','radar_opportunity_stage_history','radar_activity','radar_task','radar_experiment','radar_score_snapshot','radar_import_job','radar_import_row','radar_import_error','radar_possible_duplicate','radar_suppression','radar_source_record'] loop
    execute format('create policy %I on %I for all using (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras'')) with check (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras''))', t || '_write', t);
  end loop;
  foreach t in array array['radar_source','radar_strategy','radar_response_type','radar_score_rule','radar_score_setting'] loop
    execute format('create policy %I on %I for all using (organization_id = current_org() and has_role(''Administrador'',''Diretoria'')) with check (organization_id = current_org() and has_role(''Administrador'',''Diretoria''))', t || '_config', t);
  end loop;
end $$;
grant select, insert, update, delete on radar_source, radar_company, radar_contact, radar_project, radar_signal, radar_strategy, radar_response_type, radar_opportunity, radar_opportunity_stage_history, radar_activity, radar_task, radar_experiment, radar_score_rule, radar_score_setting, radar_score_snapshot, radar_import_job, radar_import_row, radar_import_error, radar_possible_duplicate, radar_suppression, radar_source_record to authenticated;

-- views de leitura (BI)
create or replace view v_radar_pipeline as
select o.organization_id, o.stage, count(*) as opportunities, sum(o.estimated_value) as value, sum(o.estimated_value * o.probability) as weighted_value
from radar_opportunity o group by o.organization_id, o.stage;
grant select on v_radar_pipeline to authenticated;

create or replace view v_radar_company_queue as
select c.organization_id, c.id as company_id, c.legal_name, c.city, c.state, c.industry, c.priority_score, c.priority_class, c.fit_score, c.timing_score, c.intent_score, c.relationship_score, c.data_quality_score,
  c.last_signal_at, c.last_contact_at, c.next_action_at,
  (select count(*) from radar_opportunity o where o.company_id = c.id and o.stage not in ('WON','LOST','NURTURE') and o.next_action_at is null and not exists (select 1 from radar_task t where t.opportunity_id = o.id and t.status = 'Aberta')) as opportunities_without_next_action
from radar_company c where c.active and c.merged_into is null;
grant select on v_radar_company_queue to authenticated;

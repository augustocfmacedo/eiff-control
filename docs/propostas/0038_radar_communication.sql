-- PROPOSTA (nao aplicada): persistencia das comunicacoes geradas pelo Radar (Communication Hardening 01).
-- Segue os padroes das tabelas radar_* (organization_id + RLS por current_org(), touch_updated_at com version, audit_row).
-- Estados: DRAFT | READY_FOR_REVIEW | APPROVED | REJECTED | SENT | REPLIED | CANCELLED (SENT/REPLIED so por acao humana).
-- Idempotencia: unico por (organization_id, context_hash) enquanto o rascunho estiver em DRAFT/READY_FOR_REVIEW/APPROVED.
-- Versionamento: playbook_version, content_spec_version, provider, model, prompt_version -> qual mensagem, por qual logica, com quais fatos.

create table radar_communication (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  contact_id uuid not null references radar_contact(id),
  signal_id uuid references radar_signal(id),
  strategy_id uuid references radar_strategy(id),
  objective text not null,
  playbook text not null,
  channel text not null check (channel in ('PHONE','WHATSAPP','EMAIL','LINKEDIN','VISIT','REFERRAL','OTHER')),
  state text not null default 'READY_FOR_REVIEW' check (state in ('DRAFT','READY_FOR_REVIEW','APPROVED','REJECTED','SENT','REPLIED','CANCELLED')),
  context_hash text not null,
  content_spec jsonb not null,      -- allowedClaims/deniedClaims/technicalClaims, cta, elementos, sourceDisclosure, versoes (nunca raw_payload)
  generated_content jsonb not null, -- versaoPrincipal, versoesAlternativas, assunto, roteiroLigacao, objecoes, claimsUsados, metadados
  edited_content jsonb,             -- { texto, assunto } editados pelo revisor
  validation jsonb,                 -- { ok, problemas } do fact gate (deterministico e, depois, semantico)
  provider text not null,
  model text,
  prompt_version text not null,
  playbook_version text not null,
  content_spec_version text not null,
  created_by uuid not null references profile(id),
  approved_by uuid references profile(id),
  approved_at timestamptz,
  rejected_by uuid references profile(id),
  rejected_at timestamptz,
  rejection_reason text,
  sent_at timestamptz,
  sent_activity_id uuid references radar_activity(id), -- o envio manual vira atividade; SENT so com ela
  replied_at timestamptz,
  replied_activity_id uuid references radar_activity(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index on radar_communication (organization_id, company_id, created_at desc);
create index on radar_communication (organization_id, state);
create unique index radar_communication_context_hash_ativo on radar_communication (organization_id, context_hash) where state in ('DRAFT','READY_FOR_REVIEW','APPROVED');

-- historico de estados (auditabilidade alem do audit_log)
create table radar_communication_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  communication_id uuid not null references radar_communication(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_id uuid references profile(id),
  reason text,
  occurred_at timestamptz not null default now()
);
create index on radar_communication_event (communication_id, occurred_at);

create trigger radar_communication_touch before update on radar_communication for each row execute function touch_updated_at();
create trigger radar_communication_audit after insert or update on radar_communication for each row execute function audit_row();
create trigger radar_communication_no_delete before delete on radar_communication for each row execute function forbid_delete();

alter table radar_communication enable row level security;
alter table radar_communication_event enable row level security;
create policy rc_select on radar_communication for select using (organization_id = current_org());
create policy rc_write on radar_communication for all using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro')) with check (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro'));
create policy rce_select on radar_communication_event for select using (organization_id = current_org());
create policy rce_insert on radar_communication_event for insert with check (organization_id = current_org());

-- Decisoes pendentes antes de aplicar:
-- 1) papeis com permissao 'radar' (hoje no app) x has_role aqui: alinhar a lista com a permissao radar do store;
-- 2) SENT exige sent_activity_id? (proposta: sim, o envio manual e registrado como atividade e a comunicacao referencia);
-- 3) retencao de content_spec/generated_content (dados pessoais do contato dentro do jsonb): mesma politica dos contatos.

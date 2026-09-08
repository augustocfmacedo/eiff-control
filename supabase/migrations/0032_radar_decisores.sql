-- EIFF Radar: selecao e qualidade de decisores. Persona configuravel, decision fit com matriz de pesos em tabela,
-- contato principal, status de e-mail/telefone, situacao do contato e fila de revisao da importacao.
alter table radar_contact
  add column if not exists persona text,
  add column if not exists persona_manual boolean not null default false,
  add column if not exists decision_fit_score numeric(5,1) not null default 0,
  add column if not exists is_primary_contact boolean not null default false,
  add column if not exists professional_email_status text check (professional_email_status is null or professional_email_status in ('valido','invalido','devolvido','desconhecido','catch_all')),
  add column if not exists phone_status text check (phone_status is null or phone_status in ('valido','invalido','desconhecido')),
  add column if not exists status text not null default 'ATIVO' check (status in ('ATIVO','INVALIDO','SAIU_DA_EMPRESA'));
create unique index if not exists radar_contact_primary_uq on radar_contact (company_id) where is_primary_contact;
create index if not exists radar_contact_fit_idx on radar_contact (company_id, decision_fit_score desc);

create table radar_persona_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  persona text not null,
  field text not null check (field in ('cargo','departamento','ambos')),
  terms text[] not null,
  exclude_terms text[],
  priority integer not null default 0,
  active boolean not null default true
);
create index radar_persona_rule_org_idx on radar_persona_rule (organization_id, priority);

create table radar_decision_fit_weight (
  organization_id uuid not null references organization(id),
  key text not null,
  value numeric(10,4) not null,
  primary key (organization_id, key)
);

alter table radar_import_row drop constraint if exists radar_import_row_status_check;
alter table radar_import_row add constraint radar_import_row_status_check check (status in ('importada','atualizada','duplicata_possivel','erro','ignorada','revisao'));
alter table radar_import_row add column if not exists candidates jsonb;

alter table radar_persona_rule enable row level security;
alter table radar_decision_fit_weight enable row level security;
create policy radar_persona_rule_select on radar_persona_rule for select using (organization_id = current_org());
create policy radar_persona_rule_config on radar_persona_rule for all using (organization_id = current_org() and has_role('Administrador','Diretoria')) with check (organization_id = current_org() and has_role('Administrador','Diretoria'));
create policy radar_decision_fit_weight_select on radar_decision_fit_weight for select using (organization_id = current_org());
create policy radar_decision_fit_weight_config on radar_decision_fit_weight for all using (organization_id = current_org() and has_role('Administrador','Diretoria')) with check (organization_id = current_org() and has_role('Administrador','Diretoria'));
grant select, insert, update, delete on radar_persona_rule, radar_decision_fit_weight to authenticated;

-- cobertura de contatos por organizacao
create or replace view v_radar_contact_coverage as
select c.organization_id,
  count(*) as companies,
  count(*) filter (where exists (select 1 from radar_contact k where k.company_id = c.id and k.active and k.status = 'ATIVO')) as with_contact,
  count(*) filter (where exists (select 1 from radar_contact k where k.company_id = c.id and k.active and k.status = 'ATIVO' and k.decision_fit_score >= 40)) as with_decision_maker,
  count(*) filter (where exists (select 1 from radar_contact k where k.company_id = c.id and k.active and k.status = 'ATIVO' and ((k.email is not null and coalesce(k.professional_email_status,'desconhecido') not in ('invalido','devolvido')) or ((k.phone is not null or k.mobile_phone is not null or k.whatsapp is not null) and coalesce(k.phone_status,'desconhecido') <> 'invalido')))) as with_channel
from radar_company c where c.active and c.merged_into is null
group by c.organization_id;
grant select on v_radar_contact_coverage to authenticated;

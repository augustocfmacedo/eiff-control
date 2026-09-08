-- Integracao Vibe Prospecting: identificadores da Explorium na empresa (business_id) e no contato (prospect_id),
-- para associar enriquecimentos sem depender de nome/dominio.
alter table radar_company add column if not exists explorium_business_id text;
create unique index if not exists radar_company_explorium_uq on radar_company (organization_id, explorium_business_id) where explorium_business_id is not null and merged_into is null;
alter table radar_contact add column if not exists source_external_id text;
create index if not exists radar_contact_source_external_idx on radar_contact (organization_id, source_external_id);

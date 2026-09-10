-- Fotos de campo (modo campo offline): evidencia fotografica ligada a uma ordem, tarefa, demanda, apontamento ou obra.
-- A imagem vai comprimida (JPEG <= 1280 px, data URL) na propria linha para sincronizar pelo mesmo caminho dos demais dados,
-- inclusive na fila offline; limite de 800 KB por foto. Sem trigger de auditoria: copiar a imagem para o audit_log nao faz sentido.
create table field_photo (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  project_id uuid references project(id),
  ref_type text not null check (ref_type in ('ordem', 'tarefa', 'demanda', 'apontamento', 'obra')),
  ref_id text not null,
  taken_at timestamptz not null default now(),
  taken_by uuid references profile(id),
  note text,
  data_url text not null check (data_url like 'data:image/%' and length(data_url) <= 800000),
  created_at timestamptz not null default now()
);
create index on field_photo (organization_id, taken_at);
create index on field_photo (project_id, taken_at);
create index on field_photo (ref_type, ref_id);

alter table field_photo enable row level security;
create policy fp_select on field_photo for select using (organization_id = current_org() and (project_id is null or can_access_project(project_id)));
create policy fp_insert on field_photo for insert with check (organization_id = current_org() and (project_id is null or can_access_project(project_id)) and not has_role('Auditoria'));
create policy fp_delete on field_photo for delete using (organization_id = current_org() and (taken_by = auth.uid() or has_role('Administrador', 'Diretoria', 'Gestor de obra', 'Engenharia')));
grant select, insert, delete on field_photo to authenticated;

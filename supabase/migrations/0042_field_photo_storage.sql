-- Fotos de campo no Supabase Storage: bucket privado `fotos-campo`, caminho <organization_id>/<project_id|sem-obra>/<id>.jpg.
-- A linha em field_photo passa a guardar storage_path; data_url fica opcional (fotos antigas continuam validas; fotos novas
-- enviadas sem rede ficam com data_url so no aparelho ate a fila offline subir o arquivo). RLS por prefixo da organizacao.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-campo', 'fotos-campo', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "fotos_campo_select" on storage.objects for select to authenticated
  using (bucket_id = 'fotos-campo' and (storage.foldername(name))[1] = current_org()::text);
create policy "fotos_campo_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-campo' and (storage.foldername(name))[1] = current_org()::text and not has_role('Auditoria'));
create policy "fotos_campo_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos-campo' and (storage.foldername(name))[1] = current_org()::text and (owner = auth.uid() or has_role('Administrador', 'Diretoria', 'Gestor de obra', 'Engenharia')));

alter table field_photo add column if not exists storage_path text;
alter table field_photo alter column data_url drop not null;
alter table field_photo drop constraint if exists field_photo_data_url_check;
alter table field_photo add constraint field_photo_imagem check (
  (storage_path is not null and length(storage_path) <= 300)
  or (data_url is not null and data_url like 'data:image/%' and length(data_url) <= 800000)
);
create index if not exists field_photo_storage_path_idx on field_photo (storage_path);

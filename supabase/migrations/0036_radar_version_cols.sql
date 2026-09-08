-- touch_updated_at() incrementa "version" (0001): radar_contact e radar_project receberam o trigger em 0031 sem a coluna,
-- entao qualquer UPDATE nessas tabelas falhava com 'record "new" has no field "version"'. Mesmo padrao de 0015.
alter table radar_contact add column if not exists version integer not null default 1;
alter table radar_project add column if not exists version integer not null default 1;

-- touch_updated_at() incrementa "version": tabelas com esse trigger precisam da coluna.
alter table project_service add column if not exists version integer not null default 1;
alter table worker add column if not exists version integer not null default 1;

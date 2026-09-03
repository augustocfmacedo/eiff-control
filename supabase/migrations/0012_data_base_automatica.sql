-- Data-base automatica: quando true, o app avanca base_date para o dia corrente (verificado ao carregar e a cada 10 min).
alter table parameter_set add column if not exists auto_base_date boolean not null default true;
update parameter_set set auto_base_date = true where active;

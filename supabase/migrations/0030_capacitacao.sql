-- Capacitacao: progresso de cada usuario nas licoes do modulo de estudo (conteudo fica no app, src/core/capacitacao.ts).
create table training_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  user_id uuid not null references profile(id),
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  score numeric(5,2),
  unique (user_id, lesson_id)
);
create index on training_progress (organization_id, user_id);

alter table training_progress enable row level security;
create policy tp_select on training_progress for select using (organization_id = current_org() and (user_id = auth.uid() or has_role('Administrador','Diretoria','Financeiro','Gestor de obra')));
create policy tp_insert on training_progress for insert with check (organization_id = current_org() and user_id = auth.uid());
create policy tp_delete on training_progress for delete using (organization_id = current_org() and (user_id = auth.uid() or has_role('Administrador')));
grant select, insert, delete on training_progress to authenticated;

create or replace view v_training_progress as
select t.organization_id, t.user_id, p.name as user_name, p.role, count(*) as lessons_done, max(t.completed_at) as last_completed
from training_progress t join profile p on p.id = t.user_id
group by t.organization_id, t.user_id, p.name, p.role;
grant select on v_training_progress to authenticated;

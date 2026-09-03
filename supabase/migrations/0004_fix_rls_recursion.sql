-- Corrige recursao infinita entre as politicas de approval_request e approval_step.
-- As politicas passam a usar funcoes security definer (que nao acionam RLS) para consultar a outra tabela.

create or replace function approval_request_org(p_request uuid) returns uuid
language sql stable security definer as $$
  select organization_id from approval_request where id = p_request
$$;

create or replace function approval_request_requester(p_request uuid) returns uuid
language sql stable security definer as $$
  select requested_by from approval_request where id = p_request
$$;

create or replace function approval_has_step_for_me(p_request uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from approval_step s
    where s.request_id = p_request and (s.role = current_role_kind() or s.delegate_id = auth.uid())
  )
$$;

drop policy if exists apr_select on approval_request;
create policy apr_select on approval_request for select using (
  organization_id = current_org()
  and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro','Auditoria') or approval_has_step_for_me(id)));

drop policy if exists step_select on approval_step;
create policy step_select on approval_step for select using (approval_request_org(request_id) = current_org());

drop policy if exists step_decide on approval_step;
create policy step_decide on approval_step for update using (
  approval_request_org(request_id) = current_org()
  and approval_request_requester(request_id) <> auth.uid()
  and (role = current_role_kind() or delegate_id = auth.uid() or has_role('Administrador')));

drop policy if exists step_insert on approval_step;
create policy step_insert on approval_step for insert with check (approval_request_org(request_id) = current_org());

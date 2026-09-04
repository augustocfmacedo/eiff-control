-- Criar obra falhava com "new row violates row-level security policy for table project": a politica de SELECT
-- usava can_access_project(id), funcao STABLE que consulta a tabela project e, dentro do mesmo comando de
-- INSERT ... RETURNING, ainda nao enxerga a linha nova. A politica passa a usar as colunas da propria linha
-- e um helper que consulta apenas user_scope.
create or replace function scope_allows(p_company uuid, p_project uuid) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from user_scope s
    where s.profile_id = auth.uid() and s.company_id = p_company
      and (s.project_id is null or s.project_id = p_project)
      and (s.valid_until is null or s.valid_until >= current_date)
  )
$$;

drop policy if exists project_select on project;
create policy project_select on project for select using (
  organization_id = current_org()
  and (
    (has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras') and can_access_company(company_id))
    or scope_allows(company_id, id)
  )
);
drop policy if exists project_update on project;
create policy project_update on project for update using (
  organization_id = current_org()
  and ((has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras') and can_access_company(company_id)) or scope_allows(company_id, id))
  and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia'));

-- EIFF Control - seguranca por contexto (RLS)
-- NFR-01: toda tabela exposta tem RLS e grants minimos.
-- Permissoes efetivas = papel x empresa x obra x tipo de dado (Blueprint secao 7).

-- ---------------------------------------------------------------------------
-- Funcoes auxiliares (security definer, sem expor dados alem do necessario)
-- ---------------------------------------------------------------------------
create or replace function auth_profile() returns profile language sql stable security definer as $$
  select * from profile where id = auth.uid() and active
$$;

create or replace function current_org() returns uuid language sql stable security definer as $$
  select organization_id from profile where id = auth.uid() and active
$$;

create or replace function current_role_kind() returns role_kind language sql stable security definer as $$
  select role from profile where id = auth.uid() and active
$$;

create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles))
$$;

-- escopo de empresa: Administrador/Diretoria enxergam toda a organizacao; demais exigem user_scope
create or replace function can_access_company(p_company uuid) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profile pr join company c on c.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and c.id = p_company
      and (pr.role in ('Administrador','Diretoria')
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = c.id
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

-- escopo de obra: NULL em user_scope.project_id libera todas as obras da empresa
create or replace function can_access_project(p_project uuid) returns boolean language sql stable security definer as $$
  select p_project is null or exists (
    select 1 from profile pr join project p on p.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and p.id = p_project
      and (pr.role in ('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras')
           and can_access_company(p.company_id)
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = p.company_id
                        and (s.project_id is null or s.project_id = p.id)
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

-- ---------------------------------------------------------------------------
-- Habilitar RLS
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
alter table raw.integration_event enable row level security;

-- ---------------------------------------------------------------------------
-- Politicas por tabela
-- ---------------------------------------------------------------------------
-- organizacao / empresa
create policy org_select on organization for select using (id = current_org());
create policy company_select on company for select using (organization_id = current_org());
create policy company_admin on company for all using (organization_id = current_org() and has_role('Administrador'));

-- perfis e escopos: todos leem os colegas da organizacao; somente Administrador altera
create policy profile_select on profile for select using (organization_id = current_org());
create policy profile_admin on profile for all using (organization_id = current_org() and has_role('Administrador'));
create policy scope_select on user_scope for select using (organization_id = current_org());
create policy scope_admin on user_scope for all using (organization_id = current_org() and has_role('Administrador'));

-- parametros: leitura geral; alteracao por Administrador/Financeiro/Diretoria
create policy params_select on parameter_set for select using (organization_id = current_org());
create policy params_write on parameter_set for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy factors_select on scenario_factor for select using (exists (select 1 from parameter_set p where p.id = parameter_set_id and p.organization_id = current_org()));
create policy factors_write on scenario_factor for all using (exists (select 1 from parameter_set p where p.id = parameter_set_id and p.organization_id = current_org()) and has_role('Administrador','Financeiro','Diretoria'));

-- cadastros mestres
create policy chart_select on chart_account for select using (organization_id = current_org());
create policy chart_write on chart_account for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy cc_select on cost_center for select using (organization_id = current_org());
create policy cc_write on cost_center for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy cp_select on counterparty for select using (organization_id = current_org());
create policy cp_write on counterparty for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Compras'));

-- contas bancarias: Engenharia/Compras/Gestor nao enxergam saldos
create policy bank_select on bank_account for select using (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy bank_write on bank_account for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy conn_select on bank_connection for select using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy conn_admin on bank_connection for all using (organization_id = current_org() and has_role('Administrador'));
create policy tx_select on bank_transaction for select using (
  organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy tx_insert on bank_transaction for insert with check (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy rec_select on reconciliation for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy rec_write on reconciliation for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

-- obras: leitura por escopo; edicao por gestor/engenharia da obra, Financeiro e Administrador
create policy project_select on project for select using (organization_id = current_org() and can_access_project(id));
create policy project_insert on project for insert with check (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy project_update on project for update using (
  organization_id = current_org() and can_access_project(id)
  and has_role('Administrador','Diretoria','Financeiro','Gestor de obra','Engenharia'));
create policy contract_select on contract for select using (organization_id = current_org() and can_access_project(project_id));
create policy contract_write on contract for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy addendum_select on contract_addendum for select using (exists (select 1 from contract c where c.id = contract_id and can_access_project(c.project_id)));
create policy addendum_write on contract_addendum for all using (exists (select 1 from contract c where c.id = contract_id and can_access_project(c.project_id)) and has_role('Administrador','Diretoria','Financeiro','Gestor de obra'));
create policy phase_select on project_phase for select using (organization_id = current_org() and can_access_project(project_id));
create policy phase_write on project_phase for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy activity_select on activity for select using (organization_id = current_org() and can_access_project(project_id));
create policy activity_write on activity for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy budget_select on budget_version for select using (organization_id = current_org() and can_access_project(project_id));
create policy budget_write on budget_version for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia','Financeiro'));
create policy budget_item_select on budget_item for select using (exists (select 1 from budget_version v where v.id = budget_version_id and can_access_project(v.project_id)));
create policy budget_item_write on budget_item for all using (exists (select 1 from budget_version v where v.id = budget_version_id and can_access_project(v.project_id)) and has_role('Administrador','Gestor de obra','Engenharia'));
create policy meas_select on measurement for select using (organization_id = current_org() and can_access_project(project_id));
create policy meas_write on measurement for all using (organization_id = current_org() and can_access_project(project_id) and has_role('Administrador','Gestor de obra','Engenharia','Financeiro'));

-- lancamentos: escopo de obra; sem obra, exige escopo de empresa e papel corporativo
create policy entry_select on financial_entry for select using (
  organization_id = current_org() and can_access_company(company_id)
  and (project_id is not null and can_access_project(project_id)
       or project_id is null and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras')));
create policy entry_insert on financial_entry for insert with check (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Financeiro','Gestor de obra','Engenharia','Compras','Diretoria'));
create policy entry_update on financial_entry for update using (
  organization_id = current_org() and can_access_company(company_id)
  and has_role('Administrador','Financeiro','Gestor de obra','Compras','Diretoria'));
-- delete bloqueado pelo trigger forbid_delete; sem politica de delete

create policy alloc_select on financial_allocation for select using (exists (select 1 from financial_entry e where e.id = entry_id and e.organization_id = current_org()));
create policy alloc_write on financial_allocation for all using (exists (select 1 from financial_entry e where e.id = entry_id and e.organization_id = current_org()) and has_role('Administrador','Financeiro','Gestor de obra'));

-- liquidacao: somente Financeiro/Administrador
create policy settle_select on settlement for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy settle_write on settlement for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

create policy attach_select on attachment for select using (organization_id = current_org());
create policy attach_write on attachment for insert with check (organization_id = current_org() and not has_role('Auditoria'));
create policy recur_select on recurrence_rule for select using (organization_id = current_org());
create policy recur_write on recurrence_rule for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));

-- dividas
create policy debt_select on debt for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy debt_write on debt for all using (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy debt_inst_select on debt_installment for select using (exists (select 1 from debt d where d.id = debt_id and d.organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria')));
create policy debt_inst_write on debt_installment for all using (exists (select 1 from debt d where d.id = debt_id and d.organization_id = current_org()) and has_role('Administrador','Financeiro'));

-- tesouraria
create policy forecast_select on forecast_version for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));
create policy forecast_write on forecast_version for all using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));

-- aprovacoes: solicitante ve as suas; papeis de etapa veem as pendentes; Diretoria/Admin veem tudo
create policy policy_select on approval_policy for select using (organization_id = current_org());
create policy policy_admin on approval_policy for all using (organization_id = current_org() and has_role('Administrador'));
create policy apr_select on approval_request for select using (
  organization_id = current_org() and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro','Auditoria')
    or exists (select 1 from approval_step s where s.request_id = id and s.role = current_role_kind())));
create policy apr_insert on approval_request for insert with check (organization_id = current_org() and requested_by = auth.uid());
create policy apr_update on approval_request for update using (organization_id = current_org() and (requested_by = auth.uid() or has_role('Administrador','Diretoria','Financeiro')));
create policy step_select on approval_step for select using (exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org()));
-- segregacao: o solicitante nao decide a propria solicitacao
create policy step_decide on approval_step for update using (
  exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org() and r.requested_by <> auth.uid())
  and (role = current_role_kind() or delegate_id = auth.uid()));
create policy step_insert on approval_step for insert with check (exists (select 1 from approval_request r where r.id = request_id and r.organization_id = current_org()));

-- colaboracao
create policy comment_select on comment for select using (organization_id = current_org());
create policy comment_insert on comment for insert with check (organization_id = current_org() and author_id = auth.uid() and not has_role('Auditoria'));
create policy task_select on task for select using (organization_id = current_org());
create policy task_write on task for all using (organization_id = current_org() and not has_role('Auditoria'));

-- fechamento: Financeiro fecha; reabertura exige Diretoria (validada na funcao fn_reopen_period)
create policy close_select on period_close for select using (organization_id = current_org());
create policy close_insert on period_close for insert with check (organization_id = current_org() and has_role('Administrador','Financeiro'));
create policy close_update on period_close for update using (organization_id = current_org() and has_role('Administrador','Diretoria'));

-- auditoria: somente leitura para perfis autorizados; escrita apenas por triggers (security definer)
create policy audit_select on audit_log for select using (organization_id = current_org() and has_role('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria'));

-- integracoes: Administrador
create policy sync_select on sync_run for select using (organization_id = current_org() and has_role('Administrador','Financeiro','Diretoria'));
create policy map_select on external_mapping for select using (organization_id = current_org());
create policy map_admin on external_mapping for all using (organization_id = current_org() and has_role('Administrador'));
-- raw.integration_event: sem politicas para usuarios finais (somente service role via n8n)

-- ---------------------------------------------------------------------------
-- Funcoes transacionais criticas (nao dependem de calculo no frontend)
-- ---------------------------------------------------------------------------
-- fechamento de periodo: exige checks bloqueantes zerados
create or replace function fn_close_period(p_company uuid, p_period char(7)) returns uuid
language plpgsql security definer as $$
declare v_org uuid; v_fail int; v_id uuid;
begin
  if not has_role('Administrador','Financeiro') then raise exception 'Somente Financeiro/Administrador fecham periodo'; end if;
  select organization_id into v_org from company where id = p_company;
  select count(*) into v_fail from fn_checks(v_org) where kind = 'bloqueante' and status = 'FALHA';
  if v_fail > 0 then raise exception 'Fechamento bloqueado: % check(s) com falha', v_fail; end if;
  insert into period_close (organization_id, company_id, period, closed_by) values (v_org, p_company, p_period, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- reabertura: Diretoria com motivo (dupla aprovacao registrada via approval_request do tipo 'Reabertura de período')
create or replace function fn_reopen_period(p_close uuid, p_reason text) returns void
language plpgsql security definer as $$
begin
  if not has_role('Diretoria','Administrador') then raise exception 'Reabertura exige Diretoria'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'Motivo obrigatorio'; end if;
  update period_close set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = p_reason where id = p_close;
end $$;

-- cancelamento/estorno de titulo com motivo obrigatorio
create or replace function fn_cancel_entry(p_entry uuid, p_reason text) returns void
language plpgsql security definer as $$
begin
  if not has_role('Administrador','Financeiro','Diretoria') then raise exception 'Sem permissao para cancelar'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'Motivo obrigatorio'; end if;
  update settlement set reversed = true, reversal_reason = p_reason where entry_id = p_entry and not reversed;
  update financial_entry set status = 'Cancelado', cancellation_reason = p_reason, cancelled_at = now(), cancelled_by = auth.uid(), settled_amount = 0
  where id = p_entry;
end $$;

-- grants minimos
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on schema mart to authenticated;
grant select on all tables in schema mart to authenticated;
-- usuario de BI (criar role 'bi_reader' no projeto) enxerga apenas mart
-- create role bi_reader noinherit login password '...';
-- grant usage on schema mart to bi_reader; grant select on all tables in schema mart to bi_reader;

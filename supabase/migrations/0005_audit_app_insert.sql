-- Permite que o aplicativo grave sua propria trilha de auditoria (acao de negocio + justificativa),
-- alem da trilha tecnica gravada por trigger. Continua imutavel: nao ha politicas de update/delete.
create policy audit_insert_app on audit_log for insert
  with check (organization_id = current_org() and actor_id = auth.uid() and source = 'app');

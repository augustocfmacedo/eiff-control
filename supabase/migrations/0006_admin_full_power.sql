-- Fase de validacao com um unico operador: o Administrador pode decidir qualquer etapa de aprovacao,
-- inclusive das proprias solicitacoes. A auditoria marca essas decisoes como auto-aprovacao.
drop policy if exists step_decide on approval_step;
create policy step_decide on approval_step for update using (
  approval_request_org(request_id) = current_org()
  and (
    has_role('Administrador')
    or (approval_request_requester(request_id) <> auth.uid() and (role = current_role_kind() or delegate_id = auth.uid()))
  ));

-- Administrador tambem pode reabrir periodo, liquidar, conciliar e alterar cadastros (ja previsto nas politicas).
-- Promove o operador da validacao. Para voltar a Diretoria: update profile set role = 'Diretoria' where email = '...';
update profile set role = 'Administrador', active = true where lower(email) = 'augusto@eiff.com.br';

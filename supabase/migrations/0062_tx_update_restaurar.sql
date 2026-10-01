-- Restaura a policy de UPDATE em bank_transaction (criada na 0059 e derrubada como contenção em 30/09/2026).
--
-- APLICAR SÓ DEPOIS QUE O APP COM O HOTFIX DE IDENTIDADE ESTIVER PUBLICADO (id da transação = uuid da linha, FITID
-- só em idExterno; commit "Extrato: id da transação bancária passa a ser o uuid da linha"). Com o app antigo, o mesmo
-- FITID em duas contas vira o mesmo id no navegador e descartar/mover uma linha pode gravar na outra.
--
-- Sem esta policy o app não consegue descartar, mover nem restaurar transação do extrato. Desde o hotfix a gravação
-- confere as linhas afetadas e falha alto quando a RLS filtra o UPDATE (antes ela "passava" sem gravar — foi assim que
-- a limpeza de 30/09 23:42 apagou as conciliações e deixou as 441 transações ativas). O fato bancário continua
-- imutável pelo trigger bank_transaction_fato (0059): só conta, descarte e rastro mudam.
drop policy if exists tx_update on bank_transaction;
create policy tx_update on bank_transaction for update
  using (organization_id = current_org() and has_role('Administrador', 'Financeiro'))
  with check (organization_id = current_org() and has_role('Administrador', 'Financeiro'));

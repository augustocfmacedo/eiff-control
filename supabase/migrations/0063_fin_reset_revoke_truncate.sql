-- FIN-RESET-01: fecha o TRUNCATE nas tabelas de auditoria do reset.
--
-- A 0061 revogou INSERT/UPDATE/DELETE dos papéis do app, mas os privilégios padrão do Supabase também concedem
-- TRUNCATE em toda tabela nova. TRUNCATE não passa pela RLS nem pelos triggers de linha (financial_reset_no_delete,
-- financial_reset_item_no_delete), então apagaria o registro e o retrato do reset de uma vez. Aqui só se revoga
-- TRUNCATE; nada é concedido. authenticated segue com o SELECT da 0061, sujeito à RLS; o dono do banco segue sendo
-- quem executa fin_reset_extrato / fin_reset_desfazer.
revoke truncate on financial_reset, financial_reset_item from public, anon, authenticated, service_role;

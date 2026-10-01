-- FIN-RESET-01 · DESFAZER (ESCREVE EM PRODUÇÃO). Plano de rollback, só com autorização explícita.
-- Restaura, a partir do retrato em financial_reset_item: transações (descarte removido), conciliações (mesmos ids),
-- liquidações (reversed = false; o trigger refaz o liquidado) e os campos dos títulos (status, cancelamento, exclusão,
-- conciliado, liquidado, data). Recusa se alguma linha já foi reimportada (FITID ativo de novo na mesma conta):
-- nesse caso, descartar a reimportação antes. Uma transação; qualquer erro = nada gravado.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/fin-reset/desfazer.sql
begin;
select fin_reset_desfazer(
  (select id from organization where code = 'EIFF'),
  'FIN-RESET-01',
  'Desfazer o FIN-RESET-01 (preencher o motivo real antes de rodar).',
  (select p.id from profile p join organization o on o.id = p.organization_id where o.code = 'EIFF' and p.email = 'augusto@eiff.com.br')
) as resultado;
commit;

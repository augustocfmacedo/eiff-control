-- Remove os dados de teste da validacao do OFX (03/09/2026): 2 transacoes TESTE-OFX e o lancamento PAG-0042.
delete from reconciliation where bank_transaction_id in (select id from bank_transaction where external_id like 'TESTE-OFX%');
update settlement set reversed = true, reversal_reason = 'dados de teste da validacao OFX' where entry_id in (select id from financial_entry where code = 'PAG-0042');
update financial_entry set status = 'Cancelado', cancellation_reason = 'dados de teste da validacao OFX', cancelled_at = now(), settled_amount = 0, reconciled = false where code = 'PAG-0042';
alter table bank_transaction disable trigger bank_transaction_no_delete;
delete from bank_transaction where external_id like 'TESTE-OFX%';
alter table bank_transaction enable trigger bank_transaction_no_delete;

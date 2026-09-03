-- Correcao de dados: a primeira importacao OFX (Banco do Brasil, valores sem sinal) gravou debitos como credito.
-- Inverte para debito as transacoes nao conciliadas cujo historico indica saida.
update bank_transaction t
set debit = t.credit, credit = 0
where t.credit > 0 and t.debit = 0
  and t.external_id not like 'TESTE%'
  and not exists (select 1 from reconciliation r where r.bank_transaction_id = t.id)
  and (t.description ilike 'Pix - Enviado%' or t.description ilike 'Pagamento%' or t.description ilike 'Tarifa%'
       or t.description ilike '%Débito%' or t.description ilike 'Compra%' or t.description ilike 'Saque%');

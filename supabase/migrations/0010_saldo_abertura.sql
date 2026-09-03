-- Saldo de abertura da conta CTA-001 no inicio de 01/09/2026 = 44.012,24 (definido pela Diretoria em 03/09/2026).
update bank_account set opening_balance = 44012.24, opening_balance_date = '2026-09-01' where code = 'CTA-001';
insert into audit_log (organization_id, action, entity_type, entity_id, before_data, after_data, reason, source)
select organization_id, 'alterar_conta', 'conta', 'CTA-001', jsonb_build_object('saldoInicial', 11544.48), jsonb_build_object('saldoInicial', 44012.24), 'Saldo de abertura em 01/09/2026 definido pela Diretoria', 'app'
from bank_account where code = 'CTA-001';

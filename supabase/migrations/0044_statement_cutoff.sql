-- Corte do extrato bancario: movimentos do extrato (OFX/CSV) anteriores a esta data ficam fora da posicao bancaria, da
-- conciliacao e das importacoes (nao sao apagados: o banco proibe DELETE em bank_transaction). Decisao da Diretoria em
-- 10/09/2026: contabilizar tudo a partir de 01/09/2026, inclusive o que ja estava importado e pendente de conciliacao.
alter table parameter_set add column if not exists statement_cutoff date;
update parameter_set set statement_cutoff = '2026-09-01' where active and statement_cutoff is null;

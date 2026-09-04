-- Preco de venda informado por item do orcamento (proposta/contrato). Quando presente, o preco do item nao
-- deriva do custo x (1 + BDI); a margem passa a ser calculada contra o custo das composicoes.
alter table estimate_item add column if not exists sale_unit_price numeric(18,6);

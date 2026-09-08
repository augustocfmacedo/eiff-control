-- Exclusao logica de lancamento para corrigir erro: o registro nao e apagado (forbid_delete continua), fica marcado.
-- Lancamento excluido sai das listas, do caixa, do fluxo e da DRE no motor do app e pode ser restaurado.
alter table financial_entry add column if not exists deleted_at timestamptz;
alter table financial_entry add column if not exists deleted_by uuid references profile(id);
alter table financial_entry add column if not exists deletion_reason text;
create index if not exists financial_entry_deleted_idx on financial_entry (organization_id, deleted_at) where deleted_at is not null;

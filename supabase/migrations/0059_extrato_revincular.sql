-- Extrato importado na conta errada: revincular à conta certa e descartar duplicata.
-- O movimento bancário é fato e nunca é apagado (o trigger bank_transaction_no_delete continua valendo);
-- o que passa a existir é (a) trocar a CONTA de uma transação, com rastro de onde ela veio, e
-- (b) descartar logicamente uma transação que já existe na conta certa (duplicata da importação errada).
-- Valor, data, histórico e identificador do banco continuam imutáveis: o trigger abaixo recusa alterá-los.
-- Regras em src/core/extratos.ts; ações no store: moverTransacoes / descartarTransacao.

alter table bank_transaction add column if not exists discarded_at timestamptz;
alter table bank_transaction add column if not exists discarded_by uuid references profile(id);
alter table bank_transaction add column if not exists discard_reason text;
alter table bank_transaction add column if not exists moved_at timestamptz;
alter table bank_transaction add column if not exists moved_by uuid references profile(id);
alter table bank_transaction add column if not exists moved_from_account_id uuid references bank_account(id);
comment on column bank_transaction.discarded_at is 'Descarte lógico: transação importada indevidamente (duplicata da mesma linha em outra conta). Fica fora do caixa e da conciliação; a linha nunca é apagada.';
comment on column bank_transaction.moved_from_account_id is 'Conta em que a transação foi importada antes de ser revinculada à conta correta.';
create index if not exists bank_transaction_descartada on bank_transaction (bank_account_id) where discarded_at is null;

-- dados do extrato no cadastro da conta: permitem reconhecer o arquivo OFX e recusar a conta errada
alter table bank_account add column if not exists ofx_bank_id text;
alter table bank_account add column if not exists ofx_branch text;
alter table bank_account add column if not exists ofx_account text;
comment on column bank_account.ofx_account is 'Número da conta como vem no arquivo OFX (ACCTID), usado para reconhecer o extrato na importação.';

-- UPDATE não existia em bank_transaction: por isso um extrato na conta errada não tinha conserto pelo app.
create policy tx_update on bank_transaction for update using (
  organization_id = current_org() and has_role('Administrador', 'Financeiro'));

-- o fato bancário continua imutável: só conta, descarte e rastro de movimentação podem mudar
create or replace function bank_transaction_fato_imutavel() returns trigger language plpgsql as $$
begin
  if new.organization_id <> old.organization_id then raise exception 'transação bancária: organização não pode mudar'; end if;
  if new.transaction_date <> old.transaction_date then raise exception 'transação bancária: data é fato do banco e não muda'; end if;
  if new.debit <> old.debit or new.credit <> old.credit then raise exception 'transação bancária: valor é fato do banco e não muda'; end if;
  if new.external_id is distinct from old.external_id then raise exception 'transação bancária: identificador do banco não muda'; end if;
  if new.description is distinct from old.description then raise exception 'transação bancária: histórico é fato do banco e não muda'; end if;
  if new.bank_account_id <> old.bank_account_id and new.moved_from_account_id is null then
    raise exception 'transação bancária: trocar de conta exige registrar a conta de origem (moved_from_account_id)';
  end if;
  return new;
end $$;
drop trigger if exists bank_transaction_fato on bank_transaction;
create trigger bank_transaction_fato before update on bank_transaction for each row execute function bank_transaction_fato_imutavel();

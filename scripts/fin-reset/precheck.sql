-- FIN-RESET-01 · PRECHECK (SOMENTE LEITURA: nenhum insert/update/delete). Uma linha de texto por fato.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/fin-reset/precheck.sql
with org as (select id from organization where code = 'EIFF'),
par as (select p.statement_cutoff corte from parameter_set p join org on org.id = p.organization_id where p.active order by p.created_at desc limit 1),
der as (select e.* from financial_entry e join org on org.id = e.organization_id
        where e.source_system in ('ofx', 'extrato') and e.status <> 'Cancelado' and e.deleted_at is null),
ini as (select b.id, greatest(coalesce(b.opening_balance_date, '1900-01-01'), coalesce((select corte from par), '1900-01-01')) d
        from bank_account b join org on org.id = b.organization_id)
select l from (
  select 10 o, concat_ws(' | ', 'SCHEMA',
    'unique_antiga=' || exists (select 1 from pg_constraint where conname = 'bank_transaction_bank_account_id_external_id_key'),
    'indice_parcial=' || exists (select 1 from pg_indexes where indexname = 'bank_transaction_fitid_ativo'),
    'financial_reset=' || exists (select 1 from pg_tables where tablename = 'financial_reset'),
    'fn_reset=' || exists (select 1 from pg_proc where proname = 'fin_reset_extrato'),
    'tx_update=' || exists (select 1 from pg_policies where tablename = 'bank_transaction' and policyname = 'tx_update'),
    'trigger_fato=' || exists (select 1 from pg_trigger where tgname = 'bank_transaction_fato'),
    'cols_0059=' || (select count(*) from information_schema.columns where table_name = 'bank_transaction'
                      and column_name in ('discarded_at', 'discarded_by', 'discard_reason', 'moved_at', 'moved_by', 'moved_from_account_id'))) l
  union all select 20, concat_ws(' | ', 'CONTA', b.code, b.institution, b.account_label, 'abertura=' || b.opening_balance || '@' || b.opening_balance_date,
    'inicio_posicao=' || i.d,
    'ativas=' || count(t.id) filter (where t.discarded_at is null), 'descartadas=' || count(t.id) filter (where t.discarded_at is not null),
    'ativas_antes_do_corte=' || count(t.id) filter (where t.discarded_at is null and t.transaction_date < (select corte from par)),
    'saldo_bancario=' || (b.opening_balance + coalesce(sum(t.credit - t.debit) filter (where t.discarded_at is null and t.transaction_date >= i.d), 0)),
    'saldo_lancamentos_aprox=' || (b.opening_balance + coalesce((select sum(case when e.entry_type = 'Entrada' then e.settled_amount else -e.settled_amount end)
        from financial_entry e where e.bank_account_id = b.id and e.status = 'Realizado' and e.deleted_at is null and e.record_kind = 'Real'
         and not e.direct_billing and coalesce(e.settlement_date, e.due_date) >= i.d), 0)),
    'fitid_ativo_repetido_na_conta=' || (select count(*) from (select x.external_id from bank_transaction x where x.bank_account_id = b.id
        and x.discarded_at is null and x.external_id is not null group by 1 having count(*) > 1) z))
    from bank_account b join org on org.id = b.organization_id join ini i on i.id = b.id left join bank_transaction t on t.bank_account_id = b.id
    group by b.id, b.code, b.institution, b.account_label, b.opening_balance, b.opening_balance_date, i.d
  union all select 30, concat_ws(' | ', 'FITID_ATIVO_EM_DUAS_CONTAS', count(*)) from (select t.external_id from bank_transaction t join org on org.id = t.organization_id
    where t.discarded_at is null group by t.external_id having count(distinct t.bank_account_id) > 1) z
  union all select 40, concat_ws(' | ', 'CONCILIACAO', r.status, 'tx=' || t.external_id || '@' || b.code, 'lanc=' || e.code, e.source_system, r.matched_amount)
    from reconciliation r join org on org.id = r.organization_id join bank_transaction t on t.id = r.bank_transaction_id
    join bank_account b on b.id = t.bank_account_id left join financial_entry e on e.id = r.entry_id
  union all select 50, concat_ws(' | ', 'DERIVADO', e.code, e.source_system, e.status, e.gross_amount, 'liq=' || e.settled_amount, b.code, e.competence_date,
    'ext=' || e.external_id,
    'liquidacoes=' || (select count(*) || '/' || coalesce(sum(amount), 0) from settlement s where s.entry_id = e.id and not s.reversed),
    'conc=' || (select count(*) from reconciliation r where r.entry_id = e.id), 'rec_flag=' || e.reconciled,
    'audit_lancar=' || exists (select 1 from audit_log a where a.action = 'lancar_transacao' and a.entity_id = e.code),
    'vinculos=' || ((select count(*) from purchase_order p where p.entry_id = e.id) + (select count(*) from measurement m where m.entry_id = e.id)
                  + (select count(*) from entry_service_split q where q.entry_id = e.id)
                  + (select count(*) from approval_request a where a.entity_id = e.id and a.status = 'Pendente')),
    case when e.status = 'Realizado' and not exists (select 1 from settlement s where s.entry_id = e.id and not s.reversed)
         then 'ANOMALIA: Realizado sem liquidação' end)
    from der e left join bank_account b on b.id = e.bank_account_id
  union all select 60, concat_ws(' | ', 'DERIVADO_JA_NEUTRO', e.code, e.status, 'excluido=' || (e.deleted_at is not null), e.gross_amount,
    'liq_ativas=' || (select count(*) from settlement s where s.entry_id = e.id and not s.reversed))
    from financial_entry e join org on org.id = e.organization_id
    where e.source_system in ('ofx', 'extrato') and (e.status = 'Cancelado' or e.deleted_at is not null)
  union all select 70, concat_ws(' | ', 'PREEXISTENTE_CONCILIADO', e.code, e.source_system, e.status, e.gross_amount, 'rec_flag=' || e.reconciled)
    from financial_entry e join org on org.id = e.organization_id
    where e.source_system not in ('ofx', 'extrato') and (e.reconciled or exists (select 1 from reconciliation r where r.entry_id = e.id))
  union all select 80, concat_ws(' | ', 'LIQUIDACAO_DE_TITULO_PREEXISTENTE (fica)', e.code, e.source_system, e.status, s.amount, s.settled_on, 'doc=' || s.document_number)
    from settlement s join financial_entry e on e.id = s.entry_id join org on org.id = e.organization_id
    where not s.reversed and e.source_system not in ('ofx', 'extrato')
  union all select 90, concat_ws(' | ', 'TOTAIS', 'derivados=' || (select count(*) from der), 'derivados_valor=' || (select coalesce(sum(gross_amount), 0) from der),
    'liquidacoes_derivados=' || (select count(*) || '/' || coalesce(sum(amount), 0) from settlement s where s.entry_id in (select id from der) and not s.reversed),
    'conciliacoes=' || (select count(*) from reconciliation r join org on org.id = r.organization_id))
  union all select 95, concat_ws(' | ', 'PERIODO_FECHADO', pc.period, pc.closed_at, coalesce(pc.reopened_at::text, 'NAO REABERTO'))
    from period_close pc join org on org.id = pc.organization_id
  union all select 96, concat_ws(' | ', 'PERIODOS_FECHADOS_SEM_REABERTURA',
    (select count(*) from period_close pc join org on org.id = pc.organization_id where pc.reopened_at is null))
) x order by o, l;

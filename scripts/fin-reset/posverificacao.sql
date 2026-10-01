-- FIN-RESET-01 · PÓS-VERIFICAÇÃO (SOMENTE LEITURA). Rodar logo depois de executar.sql e de novo depois da reimportação.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/fin-reset/posverificacao.sql
with org as (select id from organization where code = 'EIFF'),
rs as (select f.* from financial_reset f join org on org.id = f.organization_id where f.code = 'FIN-RESET-01')
select l from (
  select 1 o, concat_ws(' | ', 'RESET', rs.code, rs.executed_at, 'desfeito=' || (rs.rolled_back_at is not null), 'antes=' || rs.counts_before::text,
    'depois=' || rs.counts_after::text, 'anomalias=' || rs.anomalies::text) l from rs
  union all select 2, concat_ws(' | ', 'ITENS', i.entity_type, i.action, count(*)) from financial_reset_item i join rs on rs.id = i.reset_id group by i.entity_type, i.action
  union all select 3, concat_ws(' | ', 'CONTA', b.code, b.institution,
    'ativas=' || count(t.id) filter (where t.discarded_at is null),
    'descartadas_reset=' || count(t.id) filter (where t.discard_reason like 'FIN-RESET-01:%'),
    'movimento_ativo=' || coalesce(sum(t.credit - t.debit) filter (where t.discarded_at is null), 0),
    'fitid_ativo_repetido=' || (select count(*) from (select x.external_id from bank_transaction x where x.bank_account_id = b.id and x.discarded_at is null
                                and x.external_id is not null group by 1 having count(*) > 1) z))
    from bank_account b join org on org.id = b.organization_id left join bank_transaction t on t.bank_account_id = b.id group by b.id, b.code, b.institution
  union all select 4, concat_ws(' | ', 'CONCILIACOES_EM_LINHA_DESCARTADA', count(*)) from reconciliation r join bank_transaction t on t.id = r.bank_transaction_id where t.discarded_at is not null
  union all select 5, concat_ws(' | ', 'DERIVADOS_RESETADOS_ATIVOS', count(*)) from financial_entry e join financial_reset_item i on i.entity_id = e.id and i.action = 'cancel_exclude'
    join rs on rs.id = i.reset_id where e.deleted_at is null or e.status <> 'Cancelado' or e.settled_amount <> 0
  union all select 6, concat_ws(' | ', 'LIQUIDACOES_ATIVAS_DOS_RESETADOS', count(*)) from settlement s join financial_reset_item i on i.entity_id = s.entry_id and i.action = 'cancel_exclude'
    join rs on rs.id = i.reset_id where not s.reversed
  union all select 7, concat_ws(' | ', 'DERIVADOS_ATIVOS_GERAL (novos, de reimportação)', count(*)) from financial_entry e join org on org.id = e.organization_id
    where e.source_system in ('ofx', 'extrato') and e.status <> 'Cancelado' and e.deleted_at is null
  union all select 8, concat_ws(' | ', 'TITULOS_INDEPENDENTES', e.source_system, e.status, count(*), sum(e.gross_amount))
    from financial_entry e join org on org.id = e.organization_id where e.source_system not in ('ofx', 'extrato') and e.deleted_at is null group by e.source_system, e.status
  union all select 9, concat_ws(' | ', 'AUDITORIA', a.action, a.occurred_at, a.actor_id) from audit_log a join org on org.id = a.organization_id
    where a.entity_type = 'financial_reset' and a.entity_id = 'FIN-RESET-01'
) x order by o, l;

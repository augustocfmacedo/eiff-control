-- FIN-RESET-01 · lista fechada (SOMENTE LEITURA). Calcula, com a MESMA regra de fin_reset_extrato (0061), o p_esperado
-- que vai em executar.sql. Rodar logo antes de executar: se o banco mudar entre este retrato e a execução, a função
-- recusa (RAISE) e nada é gravado.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/fin-reset/esperado.sql
-- "manter": códigos gerados do extrato que a pessoa decidiu NÃO tocar (exceção explícita). Se mudar aqui, mudar também
-- no p_esperado de executar.sql.
with org as (select id from organization where code = 'EIFF'),
manter as (select unnest('{}'::text[]) code),
tx as (select t.id from bank_transaction t join org on org.id = t.organization_id where t.discarded_at is null),
der as (select e.id, e.code from financial_entry e join org on org.id = e.organization_id
        where e.source_system in ('ofx', 'extrato') and e.status <> 'Cancelado' and e.deleted_at is null
          and e.code not in (select code from manter)),
rec as (select r.id, r.entry_id from reconciliation r join org on org.id = r.organization_id
        where r.bank_transaction_id in (select id from tx) or r.entry_id in (select id from der)),
pre as (select e.code from financial_entry e join org on org.id = e.organization_id
        where e.id not in (select id from der) and e.code not in (select code from manter)
          and (e.id in (select entry_id from rec where entry_id is not null)
               or (e.reconciled and e.source_system not in ('ofx', 'extrato')))),
liq as (select s.amount from settlement s where s.entry_id in (select id from der) and not s.reversed)
select jsonb_build_object(
  'transacoes', (select count(*) from tx),
  'transacoes_md5', (select coalesce(md5(string_agg(id::text, ',' order by id::text)), '') from tx),
  'derivados', (select coalesce(jsonb_agg(code order by code), '[]'::jsonb) from der),
  'manter', (select coalesce(jsonb_agg(code order by code), '[]'::jsonb) from manter),
  'preexistentes', (select coalesce(jsonb_agg(code order by code), '[]'::jsonb) from pre),
  'conciliacoes', (select count(*) from rec),
  'liquidacoes', (select count(*) from liq),
  'liquidacoes_valor', (select coalesce(sum(amount), 0) from liq)
) as esperado;

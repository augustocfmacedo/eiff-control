-- FIN-RESET-01: reset controlado do extrato bancário, para reimportar os OFX do zero.
--
-- Três peças, nenhuma apaga fato financeiro:
--   1) o FITID passa a ser único só entre as linhas ATIVAS da conta. A linha descartada (por um reset ou por ter
--      entrado na conta errada) continua no banco como histórico, e o MESMO OFX pode entrar de novo como linha
--      nova. Duas linhas ativas com o mesmo (conta, FITID) continuam impossíveis, inclusive ao restaurar uma
--      descartada — o índice parcial recusa;
--   2) financial_reset + financial_reset_item: cada reset tem código, motivo, quem, quando, a lista fechada que a
--      pessoa autorizou, contagens antes/depois e o retrato (to_jsonb) de cada linha antes de ser tocada — é desse
--      retrato que sai o desfazer;
--   3) fin_reset_extrato(...) e fin_reset_desfazer(...): o reset numa transação só, com guardas (lista fechada
--      igual ao que o banco tem agora, senão RAISE) e pós-condições verificadas antes do COMMIT. Executam só como
--      dono do banco (Supabase CLI); nenhum papel do app (anon, authenticated, service_role) chama.
--
-- O que o reset faz (mesma regra de src/core/resetExtrato.ts):
--   * transação do extrato ativa       -> descarte lógico (discarded_*), com o código do reset no motivo;
--   * conciliação ligada a ela          -> removida (o vínculo não é fato; o retrato fica no item do reset e o
--                                          trigger audit_row grava o DELETE);
--   * título pré-existente conciliado   -> só perde a conciliação (reconciled = false); valor, status, liquidações
--                                          e natureza ficam como estão;
--   * lançamento gerado do extrato      -> liquidação estornada (settlement.reversed, nunca DELETE), título
--     (source_system ofx/extrato)         cancelado e excluído logicamente: sai do caixa, do fluxo e da DRE
--                                          (motor: excluidoEm; views SQL: status Cancelado) e continua consultável
--                                          no filtro "Excluídos";
--   * lançamento ligado a pedido de compra, medição ou rateio de faturamento nunca é tocado: o reset RECUSA.

-- 1) FITID único só entre linhas ativas -----------------------------------------------------------------------
alter table bank_transaction drop constraint if exists bank_transaction_bank_account_id_external_id_key;
create unique index if not exists bank_transaction_fitid_ativo
  on bank_transaction (bank_account_id, external_id) where discarded_at is null;
comment on index bank_transaction_fitid_ativo is
  'Uma linha ATIVA por (conta, FITID). Linhas descartadas ficam como histórico e não impedem reimportar o mesmo OFX.';

-- 2) registro do reset ----------------------------------------------------------------------------------------
create table if not exists financial_reset (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  reason text not null check (length(btrim(reason)) > 0),
  executed_by uuid not null references profile(id),
  executed_at timestamptz not null default now(),
  expected jsonb not null,
  counts_before jsonb not null,
  counts_after jsonb,
  anomalies jsonb not null default '[]'::jsonb,
  rolled_back_at timestamptz,
  rolled_back_by uuid references profile(id),
  rollback_reason text,
  unique (organization_id, code)
);
comment on table financial_reset is 'Reset extraordinário e controlado do extrato bancário (FIN-RESET). Nunca apagado; o desfazer marca rolled_back_*.';

create table if not exists financial_reset_item (
  id bigserial primary key,
  reset_id uuid not null references financial_reset(id),
  entity_type text not null check (entity_type in ('bank_transaction', 'reconciliation', 'settlement', 'financial_entry')),
  entity_id uuid not null,
  action text not null check (action in ('discard', 'unlink', 'reverse', 'cancel_exclude', 'unreconcile')),
  entity_code text,
  before_data jsonb not null,
  unique (reset_id, entity_type, entity_id, action)
);
create index if not exists financial_reset_item_reset on financial_reset_item (reset_id, entity_type);
comment on table financial_reset_item is 'Retrato de cada linha antes do reset (to_jsonb). Imutável: base do desfazer e da auditoria.';

drop trigger if exists financial_reset_no_delete on financial_reset;
create trigger financial_reset_no_delete before delete on financial_reset for each row execute function forbid_delete();
drop trigger if exists financial_reset_item_no_delete on financial_reset_item;
create trigger financial_reset_item_no_delete before delete on financial_reset_item for each row execute function forbid_delete();

create or replace function financial_reset_item_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'financial_reset_item é imutável (retrato do reset).';
end $$;
drop trigger if exists financial_reset_item_imutavel on financial_reset_item;
create trigger financial_reset_item_imutavel before update on financial_reset_item for each row execute function financial_reset_item_imutavel();

alter table financial_reset enable row level security;
alter table financial_reset_item enable row level security;
drop policy if exists fin_reset_select on financial_reset;
create policy fin_reset_select on financial_reset for select using (
  organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'));
drop policy if exists fin_reset_item_select on financial_reset_item;
create policy fin_reset_item_select on financial_reset_item for select using (
  exists (select 1 from financial_reset r where r.id = reset_id and r.organization_id = current_org())
  and has_role('Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'));
-- sem policy de escrita: o app só lê. Escrita só pelas funções abaixo, rodadas pelo dono do banco.
revoke insert, update, delete on financial_reset, financial_reset_item from anon, authenticated, service_role;
grant select on financial_reset, financial_reset_item to authenticated;

-- 3) o reset --------------------------------------------------------------------------------------------------
-- p_esperado (lista fechada aprovada pela pessoa a partir do precheck):
--   { "transacoes": <n>, "transacoes_md5": "<md5 dos uuids ativos ordenados, separados por vírgula>",
--     "derivados": ["PAG-...", ...],     -- lançamentos gerados do extrato que serão estornados/cancelados/excluídos
--     "manter": ["PAG-...", ...],        -- gerados do extrato que a pessoa decidiu NÃO tocar (exceção explícita)
--     "preexistentes": ["REC-...", ...], -- títulos de pagar/receber que só perdem a conciliação
--     "conciliacoes": <n>, "liquidacoes": <n>, "liquidacoes_valor": <numérico> }
create or replace function fin_reset_extrato(p_org uuid, p_codigo text, p_motivo text, p_ator uuid, p_esperado jsonb)
returns jsonb language plpgsql as $$
declare
  v_reset uuid;
  v_agora timestamptz := now();
  v_tx_n int; v_tx_md5 text;
  v_der text[]; v_pre text[]; v_manter text[];
  v_esp_der text[]; v_esp_pre text[];
  v_rec_n int; v_liq_n int; v_liq_v numeric;
  v_antes jsonb; v_depois jsonb; v_anom jsonb;
  v_bloqueio text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_motivo = '' then raise exception 'FIN-RESET: motivo obrigatório.'; end if;
  if coalesce(btrim(p_codigo), '') = '' then raise exception 'FIN-RESET: código obrigatório.'; end if;
  if not exists (select 1 from profile where id = p_ator and organization_id = p_org and active and role in ('Administrador', 'Diretoria', 'Financeiro')) then
    raise exception 'FIN-RESET: ator % não é Administrador/Diretoria/Financeiro ativo da organização.', p_ator;
  end if;
  if exists (select 1 from financial_reset where organization_id = p_org and code = p_codigo) then
    raise exception 'FIN-RESET: % já foi executado nesta organização.', p_codigo;
  end if;
  if exists (select 1 from pg_constraint where conname = 'bank_transaction_bank_account_id_external_id_key') then
    raise exception 'FIN-RESET: a unique antiga (conta, FITID) ainda existe; aplicar a 0061 inteira antes.';
  end if;
  -- o actor real aparece no audit_row dos triggers (auth.uid() lê o claim)
  perform set_config('request.jwt.claim.sub', p_ator::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);

  drop table if exists _fr_tx, _fr_der, _fr_rec, _fr_pre, _fr_liq;
  -- conjuntos -------------------------------------------------------------------------------------------------
  create temporary table _fr_tx on commit drop as
    select t.* from bank_transaction t where t.organization_id = p_org and t.discarded_at is null;
  v_manter := coalesce(array(select jsonb_array_elements_text(coalesce(p_esperado -> 'manter', '[]'::jsonb))), '{}');
  create temporary table _fr_der on commit drop as
    select e.* from financial_entry e
    where e.organization_id = p_org and e.source_system in ('ofx', 'extrato')
      and e.status <> 'Cancelado' and e.deleted_at is null and not (e.code = any (v_manter));
  create temporary table _fr_rec on commit drop as
    select r.* from reconciliation r
    where r.organization_id = p_org
      and (r.bank_transaction_id in (select id from _fr_tx) or r.entry_id in (select id from _fr_der));
  create temporary table _fr_pre on commit drop as
    select e.* from financial_entry e
    where e.organization_id = p_org and e.id not in (select id from _fr_der) and not (e.code = any (v_manter))
      and (e.id in (select entry_id from _fr_rec) or (e.reconciled and e.source_system not in ('ofx', 'extrato')));
  create temporary table _fr_liq on commit drop as
    select s.* from settlement s where s.entry_id in (select id from _fr_der) and not s.reversed;

  -- guardas: o banco de agora tem de ser exatamente o que a pessoa aprovou -----------------------------------
  select count(*), coalesce(md5(string_agg(id::text, ',' order by id::text)), '') into v_tx_n, v_tx_md5 from _fr_tx;
  v_der := coalesce(array(select code from _fr_der order by code), '{}');
  v_pre := coalesce(array(select code from _fr_pre order by code), '{}');
  v_esp_der := coalesce(array(select x from jsonb_array_elements_text(coalesce(p_esperado -> 'derivados', '[]'::jsonb)) x order by x), '{}');
  v_esp_pre := coalesce(array(select x from jsonb_array_elements_text(coalesce(p_esperado -> 'preexistentes', '[]'::jsonb)) x order by x), '{}');
  select count(*) into v_rec_n from _fr_rec;
  select count(*), coalesce(sum(amount), 0) into v_liq_n, v_liq_v from _fr_liq;

  if v_tx_n <> (p_esperado ->> 'transacoes')::int or v_tx_md5 <> coalesce(p_esperado ->> 'transacoes_md5', '') then
    raise exception 'FIN-RESET: transações ativas mudaram desde o precheck (agora % / %, aprovado % / %).',
      v_tx_n, v_tx_md5, p_esperado ->> 'transacoes', p_esperado ->> 'transacoes_md5';
  end if;
  if v_der <> v_esp_der then
    raise exception 'FIN-RESET: lançamentos gerados do extrato diferem do aprovado. Agora: %. Aprovado: %.', v_der, v_esp_der;
  end if;
  if v_pre <> v_esp_pre then
    raise exception 'FIN-RESET: títulos pré-existentes conciliados diferem do aprovado. Agora: %. Aprovado: %.', v_pre, v_esp_pre;
  end if;
  if v_rec_n <> (p_esperado ->> 'conciliacoes')::int or v_liq_n <> (p_esperado ->> 'liquidacoes')::int
     or v_liq_v <> (p_esperado ->> 'liquidacoes_valor')::numeric then
    raise exception 'FIN-RESET: conciliações/liquidações mudaram (agora % conc., % liq. = %; aprovado %, %, %).',
      v_rec_n, v_liq_n, v_liq_v, p_esperado ->> 'conciliacoes', p_esperado ->> 'liquidacoes', p_esperado ->> 'liquidacoes_valor';
  end if;
  -- nunca tocar título ligado a pedido, medição ou rateio de faturamento, nem em período fechado
  select string_agg(d.code || ' (' || d.por || ')', ', ') into v_bloqueio from (
    select e.code, 'pedido de compra' por from _fr_der e join purchase_order p on p.entry_id = e.id
    union all select e.code, 'medição' from _fr_der e join measurement m on m.entry_id = e.id
    union all select e.code, 'rateio de faturamento' from _fr_der e join entry_service_split q on q.entry_id = e.id
    union all select e.code, 'aprovação pendente' from _fr_der e join approval_request a on a.entity_id = e.id and a.status = 'Pendente'
    union all select e.code, 'período fechado ' || pc.period from _fr_der e join period_close pc
      on pc.company_id = e.company_id and pc.period = to_char(e.competence_date, 'YYYY-MM') and pc.reopened_at is null
  ) d;
  if v_bloqueio is not null then raise exception 'FIN-RESET: lançamento(s) fora do escopo do reset: %.', v_bloqueio; end if;

  -- anomalias (não bloqueiam: a pessoa já decidiu na lista fechada; ficam registradas)
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_anom from (
    select jsonb_build_object('lancamento', e.code, 'anomalia', 'Realizado sem liquidação registrada', 'liquidado', e.settled_amount) a
      from _fr_der e where e.status = 'Realizado' and not exists (select 1 from _fr_liq s where s.entry_id = e.id)
    union all
    select jsonb_build_object('lancamento', e.code, 'anomalia', 'sem auditoria lancar_transacao')
      from _fr_der e where not exists (select 1 from audit_log a where a.organization_id = p_org and a.action = 'lancar_transacao' and a.entity_id = e.code)
  ) x;

  v_antes := jsonb_build_object(
    'transacoes_ativas', v_tx_n,
    'transacoes_por_conta', (select coalesce(jsonb_object_agg(b.code, jsonb_build_object('ativas', x.n, 'movimento', x.mov)), '{}'::jsonb)
                             from (select bank_account_id, count(*) n, sum(credit - debit) mov from _fr_tx group by 1) x join bank_account b on b.id = x.bank_account_id),
    'conciliacoes', v_rec_n,
    'derivados', to_jsonb(v_der), 'derivados_valor', (select coalesce(sum(gross_amount), 0) from _fr_der),
    'preexistentes', to_jsonb(v_pre), 'manter', to_jsonb(v_manter),
    'liquidacoes', v_liq_n, 'liquidacoes_valor', v_liq_v);

  insert into financial_reset (organization_id, code, reason, executed_by, executed_at, expected, counts_before, anomalies)
  values (p_org, p_codigo, v_motivo, p_ator, v_agora, p_esperado, v_antes, v_anom) returning id into v_reset;

  -- retratos antes de tocar --------------------------------------------------------------------------------
  insert into financial_reset_item (reset_id, entity_type, entity_id, action, entity_code, before_data)
    select v_reset, 'bank_transaction', id, 'discard', external_id, to_jsonb(t) from _fr_tx t;
  insert into financial_reset_item (reset_id, entity_type, entity_id, action, entity_code, before_data)
    select v_reset, 'reconciliation', id, 'unlink', null, to_jsonb(r) from _fr_rec r;
  insert into financial_reset_item (reset_id, entity_type, entity_id, action, entity_code, before_data)
    select v_reset, 'settlement', s.id, 'reverse', e.code, to_jsonb(s) from _fr_liq s join _fr_der e on e.id = s.entry_id;
  insert into financial_reset_item (reset_id, entity_type, entity_id, action, entity_code, before_data)
    select v_reset, 'financial_entry', id, 'cancel_exclude', code, to_jsonb(e) from _fr_der e;
  insert into financial_reset_item (reset_id, entity_type, entity_id, action, entity_code, before_data)
    select v_reset, 'financial_entry', id, 'unreconcile', code, to_jsonb(e) from _fr_pre e;

  -- mutação ------------------------------------------------------------------------------------------------
  delete from reconciliation where id in (select id from _fr_rec);
  -- estorno primeiro: o trigger apply_settlement zera o liquidado do título
  update settlement set reversed = true, reversal_reason = p_codigo || ': ' || v_motivo where id in (select id from _fr_liq);
  update financial_entry e set
    status = 'Cancelado', cancellation_reason = p_codigo || ': ' || v_motivo, cancelled_at = v_agora, cancelled_by = p_ator,
    deleted_at = v_agora, deleted_by = p_ator, deletion_reason = p_codigo || ': ' || v_motivo,
    reconciled = false, settled_amount = 0, settlement_date = null, updated_by = p_ator
  where e.id in (select id from _fr_der);
  update financial_entry e set reconciled = false, updated_by = p_ator where e.id in (select id from _fr_pre) and e.reconciled;
  update bank_transaction t set discarded_at = v_agora, discarded_by = p_ator, discard_reason = p_codigo || ': ' || v_motivo
  where t.id in (select id from _fr_tx);

  -- pós-condições ------------------------------------------------------------------------------------------
  if exists (select 1 from bank_transaction where organization_id = p_org and discarded_at is null) then
    raise exception 'FIN-RESET pós: ainda há transação ativa.'; end if;
  if exists (select 1 from reconciliation r where r.bank_transaction_id in (select id from _fr_tx) or r.entry_id in (select id from _fr_der)) then
    raise exception 'FIN-RESET pós: sobrou conciliação do ciclo resetado.'; end if;
  if exists (select 1 from settlement s where s.entry_id in (select id from _fr_der) and not s.reversed) then
    raise exception 'FIN-RESET pós: sobrou liquidação ativa em lançamento gerado do extrato.'; end if;
  if exists (select 1 from financial_entry e where e.id in (select id from _fr_der)
             and (e.status <> 'Cancelado' or e.deleted_at is null or e.settled_amount <> 0 or e.reconciled)) then
    raise exception 'FIN-RESET pós: lançamento gerado do extrato ainda ativo.'; end if;
  if exists (select 1 from financial_entry e join _fr_pre p on p.id = e.id
             where e.status <> p.status or e.gross_amount <> p.gross_amount or e.settled_amount <> p.settled_amount
                or e.deleted_at is not null or e.bank_account_id is distinct from p.bank_account_id) then
    raise exception 'FIN-RESET pós: título pré-existente mudou além da conciliação.'; end if;

  v_depois := jsonb_build_object(
    'transacoes_ativas', (select count(*) from bank_transaction where organization_id = p_org and discarded_at is null),
    'transacoes_descartadas_pelo_reset', (select count(*) from bank_transaction where id in (select id from _fr_tx) and discarded_at = v_agora),
    'conciliacoes_restantes', (select count(*) from reconciliation where organization_id = p_org),
    'derivados_ativos', (select count(*) from financial_entry where id in (select id from _fr_der) and deleted_at is null),
    'liquidacoes_ativas_derivados', (select count(*) from settlement where entry_id in (select id from _fr_der) and not reversed),
    'preexistentes_conciliados', (select count(*) from financial_entry where id in (select id from _fr_pre) and reconciled));
  update financial_reset set counts_after = v_depois where id = v_reset;

  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (p_org, p_ator, 'fin_reset_extrato', 'financial_reset', p_codigo, v_antes, v_depois || jsonb_build_object('anomalias', v_anom), v_motivo, 'app');

  return jsonb_build_object('reset_id', v_reset, 'codigo', p_codigo, 'antes', v_antes, 'depois', v_depois, 'anomalias', v_anom);
end $$;

-- desfazer: só antes de reimportar (com linha nova ativa no mesmo (conta, FITID) o índice parcial recusaria) ------
create or replace function fin_reset_desfazer(p_org uuid, p_codigo text, p_motivo text, p_ator uuid)
returns jsonb language plpgsql as $$
declare
  v_reset financial_reset%rowtype;
  v_conflitos int;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_motivo = '' then raise exception 'FIN-RESET desfazer: motivo obrigatório.'; end if;
  select * into v_reset from financial_reset where organization_id = p_org and code = p_codigo for update;
  if not found then raise exception 'FIN-RESET desfazer: % não existe.', p_codigo; end if;
  if v_reset.rolled_back_at is not null then raise exception 'FIN-RESET desfazer: % já foi desfeito.', p_codigo; end if;
  perform set_config('request.jwt.claim.sub', p_ator::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);

  select count(*) into v_conflitos from financial_reset_item i join bank_transaction n
    on n.bank_account_id = (i.before_data ->> 'bank_account_id')::uuid and n.external_id = i.before_data ->> 'external_id'
   and n.discarded_at is null and n.id <> i.entity_id
  where i.reset_id = v_reset.id and i.entity_type = 'bank_transaction';
  if v_conflitos > 0 then
    raise exception 'FIN-RESET desfazer: % linha(s) já foram reimportadas; desfazer criaria FITID duplicado. Descarte a reimportação antes.', v_conflitos;
  end if;

  update bank_transaction t set discarded_at = null, discarded_by = null, discard_reason = null
  from financial_reset_item i where i.reset_id = v_reset.id and i.entity_type = 'bank_transaction' and i.entity_id = t.id;
  update settlement s set reversed = false, reversal_reason = null
  from financial_reset_item i where i.reset_id = v_reset.id and i.entity_type = 'settlement' and i.entity_id = s.id;
  update financial_entry e set
    status = (i.before_data ->> 'status')::entry_status,
    cancellation_reason = i.before_data ->> 'cancellation_reason', cancelled_at = (i.before_data ->> 'cancelled_at')::timestamptz,
    cancelled_by = (i.before_data ->> 'cancelled_by')::uuid,
    deleted_at = (i.before_data ->> 'deleted_at')::timestamptz, deleted_by = (i.before_data ->> 'deleted_by')::uuid,
    deletion_reason = i.before_data ->> 'deletion_reason',
    reconciled = (i.before_data ->> 'reconciled')::boolean, settled_amount = (i.before_data ->> 'settled_amount')::numeric,
    settlement_date = (i.before_data ->> 'settlement_date')::date, updated_by = p_ator
  from financial_reset_item i where i.reset_id = v_reset.id and i.entity_type = 'financial_entry' and i.entity_id = e.id;
  insert into reconciliation select (jsonb_populate_record(null::reconciliation, i.before_data)).*
  from financial_reset_item i where i.reset_id = v_reset.id and i.entity_type = 'reconciliation';

  update financial_reset set rolled_back_at = now(), rolled_back_by = p_ator, rollback_reason = v_motivo where id = v_reset.id;
  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (p_org, p_ator, 'fin_reset_desfazer', 'financial_reset', p_codigo, v_reset.counts_after, v_reset.counts_before, v_motivo, 'app');
  return jsonb_build_object('codigo', p_codigo, 'desfeito', true, 'restaurado', v_reset.counts_before);
end $$;

revoke all on function fin_reset_extrato(uuid, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function fin_reset_desfazer(uuid, text, text, uuid) from public, anon, authenticated, service_role;

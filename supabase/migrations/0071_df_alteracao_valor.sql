-- 0071 · Diretor Financeiro: pedido de ALTERAÇÃO DE VALOR de um pedido de pagamento (pedido do Augusto em 14/10/2026).
--
-- A equipe pede pagamentos pelo Diretor Financeiro (origem 'diretor-financeiro'). Quando o valor muda depois do pedido feito,
-- quem pediu solicita a alteração com motivo; o valor do título NÃO muda até a Diretoria aceitar. Aceitar grava o novo valor
-- no título pelo app (alçadas normais) e marca a alteração ACEITA; recusar guarda o motivo, que o solicitante vê.
--
--   payment_change_request      uma linha por alteração pedida (histórico: aceitas, recusadas e canceladas ficam)
--   df_pedir_alteracao(...)     porta de quem pediu (todos os papéis que pedem pagamento, inclusive o Solicitante, que não lê
--                               tabela nenhuma — 0067): valida dono, origem, situação e cria a linha PENDENTE
--   df_cancelar_alteracao(id)   quem pediu desiste da alteração ainda pendente
--   decisão                     UPDATE pela Diretoria (Administrador, Diretoria, Financeiro) via app, conferido pelo gatilho
--   df_pedido_json              passa a levar a última alteração do pedido (o Solicitante a vê em "Meus pedidos")
--
-- Sem DELETE (nenhuma política): alteração é histórico. Numeração: 0070 está reservada para a frente do Radar.

create table if not exists payment_change_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entry_id uuid not null references financial_entry(id),
  requested_by uuid not null references profile(id),
  requested_at timestamptz not null default now(),
  previous_amount numeric(16,2) not null check (previous_amount >= 0),
  new_amount numeric(16,2) not null check (new_amount > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'ACEITA', 'RECUSADA', 'CANCELADA')),
  decided_by uuid references profile(id),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (new_amount <> previous_amount),
  check ((status = 'PENDENTE') = (decided_at is null)),
  check (status <> 'RECUSADA' or char_length(btrim(coalesce(decision_reason, ''))) >= 3)
);
create unique index if not exists payment_change_request_uma_pendente on payment_change_request (entry_id) where status = 'PENDENTE';
create index if not exists payment_change_request_org on payment_change_request (organization_id, requested_at desc);

-- gatilho: o pedido é imutável; só a decisão muda, uma vez, por quem pode decidir (ou o cancelamento por quem pediu)
create or replace function payment_change_request_guarda() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_papel role_kind; v_valor numeric(16,2);
begin
  if new.organization_id is distinct from old.organization_id or new.entry_id is distinct from old.entry_id
     or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at
     or new.previous_amount is distinct from old.previous_amount or new.new_amount is distinct from old.new_amount
     or new.reason is distinct from old.reason or new.created_at is distinct from old.created_at then
    raise exception 'Pedido de alteração é imutável: só a decisão muda.' using errcode = '42501';
  end if;
  if old.status <> 'PENDENTE' then
    raise exception 'Alteração já decidida (%).', old.status using errcode = '42501';
  end if;
  if new.status = 'PENDENTE' then return new; end if;
  select role into v_papel from profile where id = v_uid and active;
  if new.status = 'CANCELADA' then
    if v_uid is distinct from old.requested_by then raise exception 'Só quem pediu cancela a alteração.' using errcode = '42501'; end if;
  else
    if v_papel is null or v_papel not in ('Administrador', 'Diretoria', 'Financeiro') then
      raise exception 'Decisão de alteração de valor é da Diretoria.' using errcode = '42501';
    end if;
    -- segregação: quem pediu não decide (Administrador é a exceção da fase de validação, como no app)
    if v_uid = old.requested_by and v_papel <> 'Administrador' then
      raise exception 'Segregação de funções: quem pediu não decide a própria alteração.' using errcode = '42501';
    end if;
    if new.status = 'ACEITA' then
      select gross_amount into v_valor from financial_entry where id = old.entry_id;
      if v_valor is distinct from old.new_amount then
        raise exception 'Aceite a alteração gravando o novo valor no título (título com %, alteração pede %).', v_valor, old.new_amount using errcode = '23514';
      end if;
    end if;
  end if;
  new.decided_by := v_uid;
  new.decided_at := now();
  return new;
end $$;

drop trigger if exists payment_change_request_guarda on payment_change_request;
create trigger payment_change_request_guarda before update on payment_change_request for each row execute function payment_change_request_guarda();
drop trigger if exists payment_change_request_touch on payment_change_request;
create trigger payment_change_request_touch before update on payment_change_request for each row execute function touch_updated_at();
drop trigger if exists payment_change_request_audit on payment_change_request;
create trigger payment_change_request_audit after insert or update on payment_change_request for each row execute function audit_row();

alter table payment_change_request enable row level security;
drop policy if exists pcr_select on payment_change_request;
create policy pcr_select on payment_change_request for select
  using (organization_id = current_org() and (has_role('Administrador', 'Diretoria', 'Financeiro') or requested_by = auth.uid()));
drop policy if exists pcr_decidir on payment_change_request;
create policy pcr_decidir on payment_change_request for update
  using (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro'))
  with check (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro'));
-- sem política de INSERT/DELETE: nasce só pela porta df_pedir_alteracao; nunca é apagada
revoke delete on payment_change_request from authenticated, anon;
revoke all on payment_change_request from anon;

-- alteração no formato que o app usa
create or replace function df_alteracao_json(a payment_change_request) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'codigo', (select code from financial_entry where id = a.entry_id),
    'solicitadoPor', (select name from profile where id = a.requested_by), 'solicitadoEm', a.requested_at,
    'valorAnterior', a.previous_amount, 'valorNovo', a.new_amount, 'motivo', a.reason, 'status', a.status,
    'decididoPor', (select name from profile where id = a.decided_by), 'decididoEm', a.decided_at, 'motivoDecisao', a.decision_reason)
$$;
revoke all on function df_alteracao_json(payment_change_request) from public, anon, authenticated;

create or replace function df_pedir_alteracao(p_codigo text, p_valor numeric, p_motivo text) returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v profile; v_e financial_entry; v_a payment_change_request;
  v_valor numeric(16,2) := round(p_valor, 2);
  v_motivo text := left(btrim(coalesce(p_motivo, '')), 500);
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  if v.role not in ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Solicitante') then
    raise exception 'Seu perfil não pede pagamentos.' using errcode = '42501';
  end if;
  select * into v_e from financial_entry where organization_id = v.organization_id and code = p_codigo for update;
  if v_e.id is null or v_e.source_system <> 'diretor-financeiro' or v_e.created_by is distinct from v.id then
    raise exception 'Pedido não encontrado entre os seus pedidos.' using errcode = '42501';
  end if;
  if v_e.deleted_at is not null then raise exception 'Pedido excluído não pode ser alterado.' using errcode = '22023'; end if;
  if v_e.status not in ('Rascunho', 'Programado', 'Pendente') then
    raise exception 'Pedido % não pode mais ter o valor alterado: %.', v_e.code, case v_e.status::text when 'Realizado' then 'já foi pago' when 'Cancelado' then 'não foi aprovado' else v_e.status::text end using errcode = '22023';
  end if;
  if exists (select 1 from settlement s where s.entry_id = v_e.id and not s.reversed) then
    raise exception 'Pedido já tem pagamento registrado: fale com a Diretoria.' using errcode = '22023';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor > 1e9 then raise exception 'Novo valor deve ser positivo.' using errcode = '22023'; end if;
  if v_valor = v_e.gross_amount then raise exception 'O novo valor é igual ao atual.' using errcode = '22023'; end if;
  if char_length(v_motivo) < 3 then raise exception 'Explique o motivo da alteração.' using errcode = '22023'; end if;
  select * into v_a from payment_change_request where entry_id = v_e.id and status = 'PENDENTE';
  if v_a.id is not null then
    if v_a.new_amount = v_valor then return df_alteracao_json(v_a) || jsonb_build_object('repetido', true); end if;
    raise exception 'Já há uma alteração deste pedido em análise pela Diretoria: cancele-a antes de pedir outra.' using errcode = '22023';
  end if;
  insert into payment_change_request (organization_id, entry_id, requested_by, previous_amount, new_amount, reason)
  values (v.organization_id, v_e.id, v.id, v_e.gross_amount, v_valor, v_motivo) returning * into v_a;
  return df_alteracao_json(v_a);
end $$;

create or replace function df_cancelar_alteracao(p_id uuid) returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare v profile; v_a payment_change_request;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  select * into v_a from payment_change_request where id = p_id and organization_id = v.organization_id and requested_by = v.id;
  if v_a.id is null then raise exception 'Alteração não encontrada entre as suas.' using errcode = '42501'; end if;
  if v_a.status <> 'PENDENTE' then raise exception 'Alteração já decidida (%).', v_a.status using errcode = '22023'; end if;
  update payment_change_request set status = 'CANCELADA' where id = v_a.id returning * into v_a;
  return df_alteracao_json(v_a);
end $$;

-- pedido no formato do app: agora com a última alteração (mesma assinatura e campos da 0067, mais 'alteracao')
create or replace function df_pedido_json(e financial_entry) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'codigo', e.code, 'descricao', e.description, 'contraparte', e.counterparty_name,
    'categoria', (select category from chart_account where id = e.chart_account_id),
    'codigoObra', (select code from project where id = e.project_id),
    'valor', e.gross_amount, 'vencimento', e.due_date, 'status', e.status,
    'motivoCancelamento', e.cancellation_reason, 'excluido', e.deleted_at is not null,
    'reagendado', coalesce(e.notes, '') ~ 'Reagendada no alinhamento',
    'criadoEm', e.created_at, 'atualizadoEm', e.updated_at,
    'alteracao', (select df_alteracao_json(a) from payment_change_request a where a.entry_id = e.id order by a.requested_at desc limit 1))
$$;
revoke all on function df_pedido_json(financial_entry) from public, anon, authenticated;

revoke all on function df_pedir_alteracao(text, numeric, text) from public, anon;
revoke all on function df_cancelar_alteracao(uuid) from public, anon;
grant execute on function df_pedir_alteracao(text, numeric, text) to authenticated;
grant execute on function df_cancelar_alteracao(uuid) to authenticated;
grant select, update on payment_change_request to authenticated;

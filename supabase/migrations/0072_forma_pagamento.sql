-- 0072 · Forma e dados de pagamento no lançamento (pedido do Augusto em 14/10/2026).
--
-- Quem pede um pagamento ao Diretor Financeiro escolhe COMO pagar e informa os dados; eles ficam no próprio título e
-- aparecem em Lançamentos e Contas a pagar:
--   financial_entry.payment_method   PIX | Boleto | Transferência | Cartão | Dinheiro (nulo = não informado)
--   financial_entry.payment_details  objeto pequeno com os campos da forma (chave PIX, linha digitável, banco/agência/conta,
--                                    favorecido e documento). Regras completas no app (src/core/pagamento.ts); aqui o mínimo.
--   df_registrar_pedido              a porta do Solicitante aceita formaPagamento + dadosPagamento (confere os obrigatórios)
--   df_pedido_json                   devolve a forma e os dados (o Solicitante vê no "Meus pedidos")
--
-- Aditiva: o código antigo continua funcionando com as colunas novas. APLICAR ANTES de publicar o código que grava nelas.

alter table financial_entry add column if not exists payment_method text;
alter table financial_entry add column if not exists payment_details jsonb;
alter table financial_entry drop constraint if exists financial_entry_payment_method_check;
alter table financial_entry add constraint financial_entry_payment_method_check
  check (payment_method is null or payment_method in ('PIX', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro'));
alter table financial_entry drop constraint if exists financial_entry_payment_details_check;
alter table financial_entry add constraint financial_entry_payment_details_check
  check (payment_details is null or (jsonb_typeof(payment_details) = 'object' and octet_length(payment_details::text) <= 2000));

-- dados de pagamento validados no mínimo: forma do catálogo e campos obrigatórios presentes (formato fino fica no app)
create or replace function df_dados_pagamento_ok(p_forma text, d jsonb) returns text language plpgsql immutable
set search_path = public, pg_temp as $$
declare v text;
begin
  if p_forma is null then return null; end if;
  if p_forma not in ('PIX', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro') then return 'Forma de pagamento inválida.'; end if;
  if d is not null and (jsonb_typeof(d) <> 'object' or octet_length(d::text) > 2000) then return 'Dados de pagamento inválidos.'; end if;
  if p_forma = 'PIX' then
    if coalesce(d ->> 'pixTipo', '') not in ('CPF', 'CNPJ', 'E-mail', 'Telefone', 'Aleatória') then return 'Pagamento: escolha o tipo da chave PIX.'; end if;
    if btrim(coalesce(d ->> 'pixChave', '')) = '' then return 'Pagamento: informe a chave PIX.'; end if;
  elsif p_forma = 'Boleto' then
    v := regexp_replace(coalesce(d ->> 'boletoLinha', ''), '\D', '', 'g');
    if length(v) not in (44, 47, 48) then return 'Pagamento: linha digitável do boleto inválida.'; end if;
  elsif p_forma = 'Transferência' then
    foreach v in array array['banco', 'agencia', 'conta', 'favorecido', 'documentoFavorecido'] loop
      if btrim(coalesce(d ->> v, '')) = '' then return 'Pagamento: dados da transferência incompletos (' || v || ').'; end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function df_dados_pagamento_ok(text, jsonb) from public, anon, authenticated;

-- pedido no formato do app: mesmos campos da 0071 (inclusive 'alteracao') + forma e dados de pagamento
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
    'formaPagamento', e.payment_method, 'dadosPagamento', e.payment_details,
    'alteracao', (select df_alteracao_json(a) from payment_change_request a where a.entry_id = e.id order by a.requested_at desc limit 1))
$$;
revoke all on function df_pedido_json(financial_entry) from public, anon, authenticated;

-- porta do Solicitante: a mesma da 0067, agora com forma e dados de pagamento
create or replace function df_registrar_pedido(p jsonb) returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v profile; v_cia uuid; v_conta uuid; v_cat uuid; v_obra uuid; v_e financial_entry; v_n int; v_erro text;
  v_valor numeric(16,2) := round((p ->> 'valor')::numeric, 2);
  v_venc date := nullif(p ->> 'vencimento', '')::date;
  v_categoria text := btrim(coalesce(p ->> 'categoria', ''));
  v_obra_cod text := nullif(btrim(coalesce(p ->> 'codigoObra', '')), '');
  v_contraparte text := left(coalesce(nullif(btrim(coalesce(p ->> 'contraparte', '')), ''), 'A definir'), 120);
  v_descricao text := left(btrim(coalesce(p ->> 'descricao', '')), 120);
  v_obs text := left(btrim(coalesce(p ->> 'observacoes', '')), 2000);
  v_forma text := nullif(btrim(coalesce(p ->> 'formaPagamento', '')), '');
  v_dados jsonb := case when jsonb_typeof(p -> 'dadosPagamento') = 'object' then p -> 'dadosPagamento' end;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null or v.role <> 'Solicitante' then
    raise exception 'Só o perfil Solicitante registra pedidos por aqui.' using errcode = '42501';
  end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor do pedido deve ser positivo.' using errcode = '22023'; end if;
  if v_venc is null then raise exception 'Data do pedido é obrigatória.' using errcode = '22023'; end if;
  if v_descricao = '' then raise exception 'Descrição do pedido é obrigatória.' using errcode = '22023'; end if;
  select id into v_cat from chart_account where organization_id = v.organization_id and category = v_categoria and active and entry_type = 'Saída';
  if v_cat is null then raise exception 'Categoria inválida: %', v_categoria using errcode = '22023'; end if;
  if v_obra_cod is not null then
    select id into v_obra from project where organization_id = v.organization_id and code = v_obra_cod;
    if v_obra is null then raise exception 'Obra inválida: %', v_obra_cod using errcode = '22023'; end if;
  end if;
  v_erro := df_dados_pagamento_ok(v_forma, v_dados);
  if v_erro is not null then raise exception '%', v_erro using errcode = '22023'; end if;
  if v_forma is null then v_dados := null; end if;

  -- idempotencia: o mesmo pedido da mesma pessoa ainda aguardando decisao devolve o existente (clique repetido nao duplica)
  select * into v_e from financial_entry e
   where e.organization_id = v.organization_id and e.created_by = v.id and e.source_system = 'diretor-financeiro'
     and e.status = 'Rascunho' and e.deleted_at is null and e.gross_amount = v_valor and e.due_date = v_venc
     and e.chart_account_id = v_cat and e.project_id is not distinct from v_obra
     and e.counterparty_name = v_contraparte and e.description = v_descricao
   limit 1;
  if v_e.id is not null then return df_pedido_json(v_e) || jsonb_build_object('repetido', true); end if;

  select c.id into v_cia from company c join organization o on o.id = c.organization_id
   where c.organization_id = v.organization_id order by (c.code = o.code) desc, c.code limit 1;
  select id into v_conta from bank_account where organization_id = v.organization_id and active order by code limit 1;
  -- codigo PED-nnnn: sequencia propria por organizacao, serializada (o app gera PAG/REC no cliente; aqui nao disputa)
  perform pg_advisory_xact_lock(hashtext(v.organization_id::text || ':PED'));
  select coalesce(max(substring(code from '^PED-(\d+)$')::int), 0) + 1 into v_n
    from financial_entry where organization_id = v.organization_id and code ~ '^PED-\d+$';

  insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label,
    project_id, counterparty_name, description, competence_date, due_date, status, confidence, probability, bank_account_id,
    gross_amount, notes, source_system, created_by, updated_by, payment_method, payment_details)
  values ('PED-' || lpad(v_n::text, 4, '0'), v.organization_id, v_cia, 'Real', 'Saída', v_cat,
    case when v_obra is null then 'Corporativo' else 'Obra' end, v_obra, v_contraparte, v_descricao, v_venc, v_venc,
    'Rascunho', 'Estimado', 1, v_conta, v_valor,
    concat_ws(E'\n', 'Pedido de ' || v.name || ' pelo Diretor Financeiro virtual (perfil Solicitante). Aguarda o alinhamento diário da Diretoria.', nullif(v_obs, '')),
    'diretor-financeiro', v.id, v.id, v_forma, v_dados)
  returning * into v_e;
  return df_pedido_json(v_e);
end $$;

revoke all on function df_registrar_pedido(jsonb) from public, anon;
grant execute on function df_registrar_pedido(jsonb) to authenticated;

-- Acesso do papel Solicitante (0066): SO o chat do Diretor Financeiro. Duas metades:
--
-- 1) FECHAMENTO. As politicas RLS do schema leem o contexto do usuario pelas funcoes auxiliares da 0003 (current_org,
--    auth_profile, has_role, can_access_company, can_access_project). Elas passam a ignorar o perfil Solicitante: para
--    ele current_org() e NULL, entao nenhuma politica "organization_id = current_org()" casa, e nenhuma tabela e lida ou
--    gravada pelas vias normais (prova em scripts/pg-smoke-solicitante.mjs, que tenta ler e gravar CADA tabela como
--    Solicitante). Os demais papeis nao mudam em nada.
-- 2) TRES PORTAS (security definer, search_path fixo, EXECUTE so para authenticated):
--    df_contexto()          -> o proprio perfil + o catalogo minimo do pedido (categorias de saida ativas, obras ativas)
--    df_registrar_pedido(j) -> grava UM pedido: Rascunho, origem diretor-financeiro, codigo PED-nnnn gerado aqui
--                              (sequencia propria: nao disputa PAG/REC gerados pelo app), idempotente
--    df_meus_pedidos()      -> so os pedidos criados por quem chama
--    Nada de saldo, caixa, banco, outros lancamentos ou cadastros sai por elas.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) funcoes auxiliares da 0003 sem o Solicitante (mesmas assinaturas e corpos, so o filtro de papel a mais)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function auth_profile() returns profile language sql stable security definer as $$
  select * from profile where id = auth.uid() and active and role <> 'Solicitante'
$$;

create or replace function current_org() returns uuid language sql stable security definer as $$
  select organization_id from profile where id = auth.uid() and active and role <> 'Solicitante'
$$;

create or replace function current_role_kind() returns role_kind language sql stable security definer as $$
  select role from profile where id = auth.uid() and active and role <> 'Solicitante'
$$;

create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from profile where id = auth.uid() and active and role <> 'Solicitante' and role = any(roles))
$$;

create or replace function can_access_company(p_company uuid) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profile pr join company c on c.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and pr.role <> 'Solicitante' and c.id = p_company
      and (pr.role in ('Administrador','Diretoria')
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = c.id
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

create or replace function can_access_project(p_project uuid) returns boolean language sql stable security definer as $$
  select p_project is null or exists (
    select 1 from profile pr join project p on p.organization_id = pr.organization_id
    where pr.id = auth.uid() and pr.active and pr.role <> 'Solicitante' and p.id = p_project
      and (pr.role in ('Administrador','Diretoria','Financeiro','Contabilidade','Auditoria','Compras')
           and can_access_company(p.company_id)
           or exists (select 1 from user_scope s where s.profile_id = pr.id and s.company_id = p.company_id
                        and (s.project_id is null or s.project_id = p.id)
                        and (s.valid_until is null or s.valid_until >= current_date)))
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) as tres portas
-- ---------------------------------------------------------------------------------------------------------------------
-- pedido no formato que o app usa (mesmo campo em df_registrar_pedido e df_meus_pedidos)
create or replace function df_pedido_json(e financial_entry) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'codigo', e.code, 'descricao', e.description, 'contraparte', e.counterparty_name,
    'categoria', (select category from chart_account where id = e.chart_account_id),
    'codigoObra', (select code from project where id = e.project_id),
    'valor', e.gross_amount, 'vencimento', e.due_date, 'status', e.status,
    'motivoCancelamento', e.cancellation_reason, 'excluido', e.deleted_at is not null,
    'reagendado', coalesce(e.notes, '') ~ 'Reagendada no alinhamento',
    'criadoEm', e.created_at, 'atualizadoEm', e.updated_at)
$$;
revoke all on function df_pedido_json(financial_entry) from public, anon, authenticated;

create or replace function df_contexto() returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v profile;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'perfil', jsonb_build_object('id', v.id, 'nome', v.name, 'email', v.email, 'papel', v.role),
    'organizacao', v.organization_id,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', category, 'grupoFluxo', cash_group) order by category) from chart_account
                             where organization_id = v.organization_id and active and entry_type = 'Saída'), '[]'::jsonb),
    'obras', coalesce((select jsonb_agg(jsonb_build_object('codigo', code, 'nome', name) order by code) from project
                        where organization_id = v.organization_id and record_kind = 'Real'
                          and status in ('Planejamento', 'Em execução')), '[]'::jsonb));
end $$;

create or replace function df_registrar_pedido(p jsonb) returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v profile; v_cia uuid; v_conta uuid; v_cat uuid; v_obra uuid; v_e financial_entry; v_n int;
  v_valor numeric(16,2) := round((p ->> 'valor')::numeric, 2);
  v_venc date := nullif(p ->> 'vencimento', '')::date;
  v_categoria text := btrim(coalesce(p ->> 'categoria', ''));
  v_obra_cod text := nullif(btrim(coalesce(p ->> 'codigoObra', '')), '');
  v_contraparte text := left(coalesce(nullif(btrim(coalesce(p ->> 'contraparte', '')), ''), 'A definir'), 120);
  v_descricao text := left(btrim(coalesce(p ->> 'descricao', '')), 120);
  v_obs text := left(btrim(coalesce(p ->> 'observacoes', '')), 2000);
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
    gross_amount, notes, source_system, created_by, updated_by)
  values ('PED-' || lpad(v_n::text, 4, '0'), v.organization_id, v_cia, 'Real', 'Saída', v_cat,
    case when v_obra is null then 'Corporativo' else 'Obra' end, v_obra, v_contraparte, v_descricao, v_venc, v_venc,
    'Rascunho', 'Estimado', 1, v_conta, v_valor,
    concat_ws(E'\n', 'Pedido de ' || v.name || ' pelo Diretor Financeiro virtual (perfil Solicitante). Aguarda o alinhamento diário da Diretoria.', nullif(v_obs, '')),
    'diretor-financeiro', v.id, v.id)
  returning * into v_e;
  return df_pedido_json(v_e);
end $$;

create or replace function df_meus_pedidos() returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v profile;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(df_pedido_json(e) order by e.created_at desc) from (
    select * from financial_entry e
     where e.organization_id = v.organization_id and e.created_by = v.id and e.source_system = 'diretor-financeiro'
     order by e.created_at desc limit 200) e), '[]'::jsonb);
end $$;

revoke all on function df_contexto() from public, anon;
revoke all on function df_registrar_pedido(jsonb) from public, anon;
revoke all on function df_meus_pedidos() from public, anon;
grant execute on function df_contexto() to authenticated;
grant execute on function df_registrar_pedido(jsonb) to authenticated;
grant execute on function df_meus_pedidos() to authenticated;

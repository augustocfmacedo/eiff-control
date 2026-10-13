-- CD-D5.2 — atribuição GOVERNADA do dono comercial da conta (docs/commercial-director-1.0.md §19.5).
--
-- Até a 0064, qualquer usuário com papel de escrita do Radar podia gravar radar_company.commercial_owner_id direto pela
-- API do banco (UPDATE de tabela para authenticated). O gatilho radar_company_dono_valido barrava dono inválido e a
-- auditoria do banco (audit_row) registrava, mas sem motivo; o motivo só existia na auditoria do app, gravada numa
-- requisição separada.
--
-- Esta migration segue o padrão do EIFF Inbox (0056: inbox_assign_thread + privilégio por coluna):
--   1. a mudança de dono passa a ser OPERAÇÃO GOVERNADA, só pela RPC radar_definir_dono_conta (security definer):
--      ator = auth.uid() com perfil ativo, papel Administrador ou Diretoria (permissão `radar_dono` do app), conta da
--      mesma organização e não mesclada, motivo obrigatório; grava o dono e a auditoria (antes, depois, autor, data,
--      motivo) NA MESMA TRANSAÇÃO; qualquer recusa levanta exceção e nada muda;
--   2. authenticated perde INSERT/UPDATE da coluna commercial_owner_id (as demais colunas seguem como antes, por
--      privilégio de coluna); anon perde INSERT/UPDATE da tabela (já era barrado pela RLS; nada muda na prática).
--
-- Nada muda em dados, na RLS de radar_company, no gatilho radar_company_dono_valido (continua como segunda barreira)
-- nem no audit_row. Coluna nova em radar_company daqui para frente precisa entrar nos GRANTs abaixo.

create or replace function radar_definir_dono_conta(p_empresa uuid, p_dono uuid, p_motivo text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid;
  v_papel role_kind;
  v_ativo boolean;
  v_empresa radar_company%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_versao bigint;
begin
  if v_ator is null then
    raise exception 'dono da conta: sessão não autenticada' using errcode = 'insufficient_privilege';
  end if;
  select p.organization_id, p.role, p.active into v_org, v_papel, v_ativo from profile p where p.id = v_ator;
  -- falha fechada também para valores nulos (as colunas são NOT NULL hoje; a função não depende disso)
  if not found or v_ativo is null or not v_ativo then
    raise exception 'dono da conta: usuário sem perfil ativo' using errcode = 'insufficient_privilege';
  end if;
  if v_papel is null or v_papel not in ('Administrador', 'Diretoria') then
    raise exception 'dono da conta: sem permissão para definir o dono comercial' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 500 then
    raise exception 'dono da conta: informe o motivo (3 a 500 caracteres)' using errcode = 'check_violation';
  end if;

  select * into v_empresa from radar_company c where c.id = p_empresa for update;
  if not found or v_empresa.organization_id is distinct from v_org then
    raise exception 'dono da conta: empresa não encontrada' using errcode = 'no_data_found';
  end if;
  if v_empresa.merged_into is not null then
    raise exception 'dono da conta: conta mesclada, defina o dono na conta canônica' using errcode = 'check_violation';
  end if;
  if p_dono is not null and not exists (select 1 from profile p where p.id = p_dono and p.organization_id = v_org and p.active) then
    raise exception 'dono comercial inválido: o usuário precisa estar ativo e pertencer à mesma organização da conta' using errcode = 'check_violation';
  end if;

  if v_empresa.commercial_owner_id is not distinct from p_dono then
    return jsonb_build_object('alterado', false, 'antes', v_empresa.commercial_owner_id, 'depois', p_dono);
  end if;

  -- o gatilho radar_company_dono_valido revalida (segunda barreira) e o audit_row grava a linha antes/depois
  update radar_company set commercial_owner_id = p_dono, updated_by = v_ator where id = p_empresa
  returning version into v_versao;

  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (
    v_org, v_ator,
    case when p_dono is null then 'radar_remover_dono_conta' else 'radar_definir_dono_conta' end,
    'radar_empresa', p_empresa::text,
    jsonb_build_object('commercialOwnerId', v_empresa.commercial_owner_id),
    jsonb_build_object('commercialOwnerId', p_dono),
    v_motivo, 'rpc'
  );

  return jsonb_build_object('alterado', true, 'antes', v_empresa.commercial_owner_id, 'depois', p_dono, 'versao', v_versao);
end $$;

revoke execute on function radar_definir_dono_conta(uuid, uuid, text) from public, anon;
grant execute on function radar_definir_dono_conta(uuid, uuid, text) to authenticated;

-- privilégios de coluna: o dono só muda pela RPC; as demais colunas seguem graváveis como antes
revoke insert, update on radar_company from anon;
revoke insert, update on radar_company from authenticated;
grant insert (id, organization_id, cnpj, legal_name, trade_name, domain, website, linkedin_url, industry, cnae, city, state,
  country, employee_range, revenue_range, capital_social, number_of_locations, source_id, source_external_id, notes, active,
  merged_into, fit_score, intent_score, timing_score, relationship_score, data_quality_score, priority_score, priority_class,
  last_signal_at, last_contact_at, next_action_at, version, created_at, created_by, updated_at, updated_by,
  explorium_business_id) on radar_company to authenticated;
grant update (id, organization_id, cnpj, legal_name, trade_name, domain, website, linkedin_url, industry, cnae, city, state,
  country, employee_range, revenue_range, capital_social, number_of_locations, source_id, source_external_id, notes, active,
  merged_into, fit_score, intent_score, timing_score, relationship_score, data_quality_score, priority_score, priority_class,
  last_signal_at, last_contact_at, next_action_at, version, created_at, created_by, updated_at, updated_by,
  explorium_business_id) on radar_company to authenticated;

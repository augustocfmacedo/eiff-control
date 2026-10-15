-- 0074 · CD-D3/E5 (E5-REL-01) — idempotência por INTENÇÃO na definição de meta comercial.
--
-- Problema: a RPC radar_definir_meta_comercial (0068) não reconhece reenvio. Se ela fez COMMIT e o cliente perdeu a
-- resposta (rede, app fechado), o reenvio da mesma intenção criava outra versão — e, com outra sessão tendo mudado a meta
-- no meio, restabelecia o valor ANTIGO sobre o mais novo.
--
-- Solução (sem alterar a 0068): cada pedido do app carrega um identificador estável gerado no cliente ANTES do primeiro
-- envio (`p_intencao`) e a versão vigente em que a decisão se baseou (`p_versao_base`, 0 = nenhuma). A nova RPC
-- radar_definir_meta_comercial_intencao, numa transação e sob trava da intenção:
--   * intenção já registrada com o MESMO conteúdo → devolve o resultado original (`repetida: true`), sem criar versão,
--     mesmo que outra sessão tenha mudado a meta depois (a versão mais recente é preservada);
--   * intenção já registrada com conteúdo DIFERENTE → recusa;
--   * intenção nova → pré-condição: a versão vigente do mês tem de ser a `p_versao_base` (senão recusa: a decisão foi
--     tomada sobre dados desatualizados e não substitui em silêncio uma decisão posterior); então aplica pela RPC da 0068
--     (mesmas guardas de papel, mês, valor, motivo, versão e auditoria) e registra a intenção com o resultado.
-- Nova decisão explícita = nova intenção: segue a governança da 0068 e gera versão legítima.
-- O registro de intenções é imutável e só a RPC escreve nele.

create table radar_commercial_goal_intent (
  organization_id uuid not null references organization(id),
  intent_id uuid not null,
  period_month date not null check (extract(day from period_month) = 1),
  amount numeric(18,2) check (amount is null or (amount > 0 and amount <= 1000000000000)),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  base_version integer not null check (base_version >= 0),
  -- resultado devolvido pela RPC da 0068 na primeira execução (id, versão, valor, alterado)
  result jsonb not null,
  created_by uuid not null references profile(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, intent_id)
);

create or replace function radar_commercial_goal_intent_imutavel() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'meta comercial: o registro de intenções é imutável' using errcode = 'insufficient_privilege';
end $$;
create trigger radar_commercial_goal_intent_imutavel before update or delete on radar_commercial_goal_intent
  for each row execute function radar_commercial_goal_intent_imutavel();
create trigger radar_commercial_goal_intent_sem_truncate before truncate on radar_commercial_goal_intent
  for each statement execute function radar_commercial_goal_intent_imutavel();

alter table radar_commercial_goal_intent enable row level security;
create policy radar_commercial_goal_intent_select on radar_commercial_goal_intent for select using (organization_id = public.current_org());
revoke all on radar_commercial_goal_intent from public, anon, authenticated, service_role;
grant select on radar_commercial_goal_intent to authenticated;
revoke all on function radar_commercial_goal_intent_imutavel() from public, anon, authenticated, service_role;

create or replace function radar_definir_meta_comercial_intencao(p_intencao uuid, p_mes date, p_valor numeric, p_motivo text, p_versao_base integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid;
  v_motivo text := pg_catalog.btrim(coalesce(p_motivo, ''));
  v_existente public.radar_commercial_goal_intent%rowtype;
  v_vigente integer;
  v_res jsonb;
begin
  if v_ator is null then
    raise exception 'meta comercial: sessão não autenticada' using errcode = 'insufficient_privilege';
  end if;
  select p.organization_id into v_org from public.profile p where p.id = v_ator and p.active;
  if v_org is null then
    raise exception 'meta comercial: usuário sem perfil ativo' using errcode = 'insufficient_privilege';
  end if;
  if p_intencao is null then
    raise exception 'meta comercial: intenção sem identificador' using errcode = 'check_violation';
  end if;
  if p_versao_base is null or p_versao_base < 0 then
    raise exception 'meta comercial: informe a versão vigente em que a decisão se baseou' using errcode = 'check_violation';
  end if;

  -- trava da INTENÇÃO: a mesma intenção executada ao mesmo tempo por duas sessões se serializa aqui; a segunda vê o
  -- registro da primeira (cada comando do READ COMMITTED lê o que já foi confirmado)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('radar_commercial_goal_intent:' || v_org::text || ':' || p_intencao::text, 0));
  select * into v_existente from public.radar_commercial_goal_intent i where i.organization_id = v_org and i.intent_id = p_intencao;
  if found then
    if v_existente.period_month is distinct from p_mes or v_existente.amount is distinct from p_valor
       or pg_catalog.btrim(v_existente.reason) is distinct from v_motivo or v_existente.base_version is distinct from p_versao_base then
      raise exception 'meta comercial: esta intenção já foi usada com outro conteúdo; nada foi alterado' using errcode = 'unique_violation';
    end if;
    return v_existente.result || pg_catalog.jsonb_build_object('intencao', p_intencao, 'repetida', true);
  end if;

  -- pré-condição sob a MESMA trava do mês da 0068 (reentrante na transação): a decisão foi tomada sobre a versão vigente
  if p_mes is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('radar_commercial_goal:' || v_org::text || ':' || p_mes::text, 0));
  end if;
  select coalesce(max(g.version), 0) into v_vigente from public.radar_commercial_goal g
    where g.organization_id = v_org and g.scope = 'ORGANIZACAO' and g.metric = 'RECEITA_GANHA' and g.currency = 'BRL' and g.period_month = p_mes;
  if v_vigente <> p_versao_base then
    raise exception 'meta comercial: a meta mudou em outra sessão (versão atual %, a decisão partiu da versão %); revise antes de salvar', v_vigente, p_versao_base
      using errcode = 'serialization_failure';
  end if;

  -- aplica pela RPC da 0068: papel, mês corrente/futuro, valor, motivo, versão, mesmo valor sem versão e auditoria
  v_res := public.radar_definir_meta_comercial(p_mes, p_valor, p_motivo);

  insert into public.radar_commercial_goal_intent (organization_id, intent_id, period_month, amount, reason, base_version, result, created_by)
  values (v_org, p_intencao, p_mes, p_valor, v_motivo, p_versao_base, v_res, v_ator);

  return v_res || pg_catalog.jsonb_build_object('intencao', p_intencao, 'repetida', false);
end $$;

revoke all on function radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer) from public, anon, service_role;
grant execute on function radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer) to authenticated;

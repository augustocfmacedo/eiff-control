-- CD-D3 / E2 — metas comerciais governadas (docs/commercial-director-1.0.md §19.8).
--
-- Meta de RECEITA GANHA em BRL, mensal (mês comercial em America/Sao_Paulo), consolidada da organização (D3-E),
-- VERSIONADA: cada definição ou retirada é uma linha nova; nenhuma versão é alterada ou apagada. O cálculo
-- (vigente, realizado, atingimento) é do motor `src/core/radar/metaComercial.ts` (E1); aqui só a persistência.
--
-- Escrita só pela RPC radar_definir_meta_comercial (security definer), no padrão da 0065: o ator é auth.uid() com perfil
-- ativo e papel Administrador ou Diretoria (permissão `radar_config` do app); a organização vem do perfil, nunca do
-- navegador; motivo de 3 a 500 caracteres; só mês corrente ou futuro no fuso de São Paulo (D3-C); valor positivo com até
-- 2 casas, ou NULL para retirar; a versão é calculada sob trava transacional por organização + mês; meta e auditoria
-- gravadas na mesma transação. Qualquer recusa levanta exceção e nada muda.
--
-- RLS: leitura para a organização (como as demais tabelas radar_*: current_org(), que desde a 0067 ignora o
-- Solicitante); `authenticated` só tem SELECT; `anon` nada. UPDATE e DELETE recusados por gatilho para qualquer papel.
--
-- Hardening pré-merge: as três funções fixam `search_path = pg_catalog, pg_temp` (pg_temp explicitamente por último) e a
-- RPC qualifica por schema tudo o que lê ou grava (public.profile, public.radar_commercial_goal, public.audit_log,
-- public.role_kind, public.radar_mes_comercial_de; auth.uid já era qualificado). Como `public` não está no caminho, um nome
-- sem schema não resolveria, e uma tabela temporária de mesmo nome (o papel `authenticated` tem TEMP no banco) não desvia
-- nada. Valor máximo da meta = R$ 1.000.000.000.000,00 (1e14 centavos), o mesmo de VALOR_MAXIMO_META no motor da E1, com
-- folga sobre o inteiro seguro do cálculo em centavos (9.007.199.254.740.991).

-- mês comercial (dia 1) de um instante, no fuso de São Paulo — o mesmo de `mesComercialDe` no motor
create or replace function radar_mes_comercial_de(p_instante timestamptz) returns date
language sql stable
set search_path = pg_catalog, pg_temp
as $$ select pg_catalog.date_trunc('month', p_instante at time zone 'America/Sao_Paulo')::date $$;

create table radar_commercial_goal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  period_month date not null check (extract(day from period_month) = 1),
  metric text not null default 'RECEITA_GANHA' check (metric = 'RECEITA_GANHA'),
  currency text not null default 'BRL' check (currency = 'BRL'),
  scope text not null default 'ORGANIZACAO' check (scope = 'ORGANIZACAO'),
  -- NULL = meta retirada nesta versão
  -- teto alinhado ao motor (VALOR_MAXIMO_META): R$ 1 trilhão
  amount numeric(18,2) check (amount is null or (amount > 0 and amount <= 1000000000000)),
  version integer not null check (version >= 1),
  supersedes_id uuid references radar_commercial_goal(id),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by uuid not null references profile(id),
  created_at timestamptz not null default now(),
  constraint radar_commercial_goal_versao_unica unique (organization_id, scope, metric, currency, period_month, version),
  constraint radar_commercial_goal_substitui check ((version = 1) = (supersedes_id is null))
);
create index radar_commercial_goal_mes_idx on radar_commercial_goal (organization_id, period_month);

-- histórico imutável: nenhuma versão muda nem some, para nenhum papel
create or replace function radar_commercial_goal_imutavel() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'meta comercial: versões são imutáveis (crie uma nova versão)' using errcode = 'insufficient_privilege';
end $$;
create trigger radar_commercial_goal_imutavel before update or delete on radar_commercial_goal
  for each row execute function radar_commercial_goal_imutavel();
create trigger radar_commercial_goal_sem_truncate before truncate on radar_commercial_goal
  for each statement execute function radar_commercial_goal_imutavel();

alter table radar_commercial_goal enable row level security;
create policy radar_commercial_goal_select on radar_commercial_goal for select using (organization_id = current_org());
revoke all on radar_commercial_goal from public, anon, authenticated;
grant select on radar_commercial_goal to authenticated;

create or replace function radar_definir_meta_comercial(p_mes date, p_valor numeric, p_motivo text) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid;
  v_papel public.role_kind;
  v_ativo boolean;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_atual public.radar_commercial_goal%rowtype;
  v_nova public.radar_commercial_goal%rowtype;
begin
  if v_ator is null then
    raise exception 'meta comercial: sessão não autenticada' using errcode = 'insufficient_privilege';
  end if;
  select p.organization_id, p.role, p.active into v_org, v_papel, v_ativo from public.profile p where p.id = v_ator;
  if not found or v_ativo is null or not v_ativo then
    raise exception 'meta comercial: usuário sem perfil ativo' using errcode = 'insufficient_privilege';
  end if;
  if v_papel is null or v_papel not in ('Administrador', 'Diretoria') then
    raise exception 'meta comercial: sem permissão para definir metas' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 500 then
    raise exception 'meta comercial: informe o motivo (3 a 500 caracteres)' using errcode = 'check_violation';
  end if;
  if p_mes is null or extract(day from p_mes) <> 1 then
    raise exception 'meta comercial: mês inválido (use o dia 1 do mês)' using errcode = 'check_violation';
  end if;
  if p_mes < public.radar_mes_comercial_de(now()) then
    raise exception 'meta comercial: só o mês corrente ou meses futuros' using errcode = 'check_violation';
  end if;
  if p_valor is not null and (p_valor <= 0 or p_valor <> round(p_valor, 2)) then
    raise exception 'meta comercial: valor positivo em reais com no máximo 2 casas' using errcode = 'check_violation';
  end if;
  if p_valor > 1000000000000 then
    raise exception 'meta comercial: valor acima do máximo (R$ 1.000.000.000.000,00)' using errcode = 'check_violation';
  end if;

  -- trava transacional por organização + mês: duas definições concorrentes nunca leem a mesma versão
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('radar_commercial_goal:' || v_org::text || ':' || p_mes::text, 0));

  select * into v_atual from public.radar_commercial_goal g
    where g.organization_id = v_org and g.scope = 'ORGANIZACAO' and g.metric = 'RECEITA_GANHA' and g.currency = 'BRL' and g.period_month = p_mes
    order by g.version desc limit 1;

  if p_valor is null and (not found or v_atual.amount is null) then
    raise exception 'meta comercial: não há meta vigente para retirar' using errcode = 'check_violation';
  end if;
  if found and v_atual.amount is not distinct from p_valor then
    return jsonb_build_object('alterado', false, 'id', v_atual.id, 'versao', v_atual.version, 'mes', p_mes, 'valor', v_atual.amount);
  end if;

  insert into public.radar_commercial_goal (organization_id, period_month, amount, version, supersedes_id, reason, created_by)
  values (v_org, p_mes, p_valor, coalesce(v_atual.version, 0) + 1, v_atual.id, v_motivo, v_ator)
  returning * into v_nova;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (
    v_org, v_ator,
    case when p_valor is null then 'radar_retirar_meta_comercial' else 'radar_definir_meta_comercial' end,
    'radar_meta_comercial', v_nova.id::text,
    case when v_atual.id is null then null else jsonb_build_object('id', v_atual.id, 'versao', v_atual.version, 'valor', v_atual.amount) end,
    jsonb_build_object('mes', p_mes, 'versao', v_nova.version, 'valor', v_nova.amount, 'substitui', v_nova.supersedes_id),
    v_motivo, 'rpc'
  );

  return jsonb_build_object('alterado', true, 'id', v_nova.id, 'versao', v_nova.version, 'mes', p_mes, 'valor', v_nova.amount);
end $$;

revoke execute on function radar_definir_meta_comercial(date, numeric, text) from public, anon;
grant execute on function radar_definir_meta_comercial(date, numeric, text) to authenticated;

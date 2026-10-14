-- 0070 · CD-D3/E3 — livro imutável de desfechos comerciais (docs/commercial-director-1.0.md §19.9).
--
-- O realizado da meta comercial (motor E1, src/core/radar/metaComercial.ts) é lido de FATOS, não do estado atual das
-- oportunidades. Cada fato é um evento do contrato `EventoDesfecho`:
--   * GANHO            — a oportunidade entrou em WON. Congela oportunidade, organização, empresa, responsável, dono da
--                        conta (radar_company.commercial_owner_id naquele instante), autor e instante; leva o VALOR FECHADO
--                        CONFIRMADO (`won_amount`) quando houver. `estimated_value` NUNCA vira valor de venda.
--   * ESTORNO_GANHO    — a oportunidade ganha foi reaberta (saiu de WON, inclusive para LOST). Cita o ganho original e
--                        conta no mês em que ocorreu (D3-A); o ganho continua no livro.
--   * COMPLEMENTO_VALOR — completa, por operação governada, um ganho registrado sem valor (D3-B: corrige o mês do ganho
--                        sem apagar nada). Um por ganho.
-- Quem escreve: só o banco. GANHO e ESTORNO nascem do gatilho em radar_opportunity, na MESMA transação da mudança de
-- estágio (se o evento falhar, a mudança de estágio falha junto); COMPLEMENTO só pela RPC radar_complementar_valor_ganho
-- (Administrador ou Diretoria). O livro é append-only: UPDATE, DELETE e TRUNCATE recusados para qualquer papel.
-- O instante do evento é o do banco (clock_timestamp(): o relógio real, crescente mesmo dentro de uma transação, para que
-- GANHO → ESTORNO → novo GANHO numa só transação não empatem) — a hora do aparelho não decide o mês. Sem backfill: oportunidade ganha
-- antes desta migration não ganha evento fabricado (produção tinha 0 oportunidades ao planejar a E3).
-- Funções com search_path = pg_catalog, pg_temp e referências qualificadas (mesmo hardening da 0068 e da 0069).

-- ---------------------------------------------------------------------------------------- valor fechado confirmado
alter table public.radar_opportunity add column won_amount numeric(18,2);
alter table public.radar_opportunity add constraint radar_opportunity_won_amount_valido
  check (won_amount is null or (won_amount > 0 and won_amount <= 1000000000000));
alter table public.radar_opportunity add constraint radar_opportunity_won_amount_so_ganha
  check (won_amount is null or stage = 'WON');
comment on column public.radar_opportunity.won_amount is
  'CD-D3/E3: valor fechado confirmado ao marcar WON (vazio = ganho sem valor, sinalizado). Nunca copiado de estimated_value.';

-- ---------------------------------------------------------------------------------------- livro de desfechos
create table public.radar_commercial_outcome (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  opportunity_id uuid not null references public.radar_opportunity(id) on delete restrict,
  company_id uuid not null,
  event_type text not null check (event_type in ('GANHO', 'ESTORNO_GANHO', 'COMPLEMENTO_VALOR')),
  won_event_id uuid references public.radar_commercial_outcome(id),
  amount numeric(18,2) check (amount is null or (amount > 0 and amount <= 1000000000000)),
  occurred_at timestamptz not null default clock_timestamp(),
  from_stage text,
  to_stage text,
  owner_id uuid,
  account_owner_id uuid,
  actor_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  source text not null check (source in ('trigger', 'rpc')),
  created_at timestamptz not null default now(),
  constraint radar_commercial_outcome_ganho_ref check ((event_type = 'GANHO') = (won_event_id is null)),
  constraint radar_commercial_outcome_valor check (
    (event_type = 'GANHO')
    or (event_type = 'ESTORNO_GANHO' and amount is null)
    or (event_type = 'COMPLEMENTO_VALOR' and amount is not null and reason is not null and char_length(btrim(reason)) >= 3))
);
create unique index radar_commercial_outcome_estorno_unico on public.radar_commercial_outcome (won_event_id) where event_type = 'ESTORNO_GANHO';
create unique index radar_commercial_outcome_complemento_unico on public.radar_commercial_outcome (won_event_id) where event_type = 'COMPLEMENTO_VALOR';
create index radar_commercial_outcome_org_idx on public.radar_commercial_outcome (organization_id, occurred_at);
create index radar_commercial_outcome_opp_idx on public.radar_commercial_outcome (opportunity_id, occurred_at);

-- coerência de cada evento no INSERT (defesa em profundidade: só funções do banco inserem)
create or replace function public.radar_commercial_outcome_coerencia() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp as $$
declare v_g public.radar_commercial_outcome%rowtype;
begin
  if not exists (select 1 from public.radar_opportunity o where o.id = new.opportunity_id and o.organization_id = new.organization_id) then
    raise exception 'desfecho: oportunidade e organização do evento não conferem';
  end if;
  if new.event_type = 'GANHO' then
    -- o ganho congela a empresa da oportunidade naquele instante; estorno e complemento herdam a do ganho
    if not exists (select 1 from public.radar_opportunity o where o.id = new.opportunity_id and o.company_id = new.company_id) then
      raise exception 'desfecho: a empresa do ganho precisa ser a da oportunidade';
    end if;
    if exists (select 1 from public.radar_commercial_outcome g where g.opportunity_id = new.opportunity_id and g.event_type = 'GANHO'
                 and not exists (select 1 from public.radar_commercial_outcome e where e.won_event_id = g.id and e.event_type = 'ESTORNO_GANHO')) then
      raise exception 'desfecho: a oportunidade já tem um ganho vigente (reabra antes de ganhar de novo)';
    end if;
    return new;
  end if;
  select * into v_g from public.radar_commercial_outcome g where g.id = new.won_event_id;
  if v_g.id is null or v_g.event_type <> 'GANHO' or v_g.opportunity_id <> new.opportunity_id or v_g.organization_id <> new.organization_id or v_g.company_id <> new.company_id then
    raise exception 'desfecho: o evento precisa citar o ganho original da mesma oportunidade';
  end if;
  if new.occurred_at < v_g.occurred_at then raise exception 'desfecho: evento anterior ao ganho que ele cita'; end if;
  if new.event_type = 'COMPLEMENTO_VALOR' and v_g.amount is not null then raise exception 'desfecho: o ganho já tem valor confirmado'; end if;
  return new;
end $$;
create trigger radar_commercial_outcome_coerencia before insert on public.radar_commercial_outcome
  for each row execute function public.radar_commercial_outcome_coerencia();

-- histórico imutável para qualquer papel
create or replace function public.radar_commercial_outcome_imutavel() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'desfecho: o livro de desfechos é imutável (registre um estorno ou um complemento)';
end $$;
create trigger radar_commercial_outcome_sem_update before update or delete on public.radar_commercial_outcome
  for each row execute function public.radar_commercial_outcome_imutavel();
create trigger radar_commercial_outcome_sem_truncate before truncate on public.radar_commercial_outcome
  for each statement execute function public.radar_commercial_outcome_imutavel();

alter table public.radar_commercial_outcome enable row level security;
create policy radar_commercial_outcome_select on public.radar_commercial_outcome for select using (organization_id = public.current_org());
revoke all on public.radar_commercial_outcome from public, anon, authenticated;
grant select on public.radar_commercial_outcome to authenticated;

-- ---------------------------------------------------------------------------------------- oportunidade ganha travada
-- Valor fechado só existe em oportunidade ganha (sair de WON limpa). Ganha e mantida ganha: valor fechado, valor
-- estimado, empresa, responsável, organização e data de fechamento não mudam (corrigir = reabrir com motivo).
create or replace function public.radar_opportunity_ganho_travado() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp as $$
begin
  if new.stage is distinct from 'WON' then new.won_amount := null; end if;
  if tg_op = 'UPDATE' and old.stage = 'WON' and new.stage = 'WON' and (
       new.won_amount is distinct from old.won_amount
    or new.estimated_value is distinct from old.estimated_value
    or new.company_id is distinct from old.company_id
    or new.organization_id is distinct from old.organization_id
    or new.closed_at is distinct from old.closed_at
    or (old.owner_id is not null and new.owner_id is distinct from old.owner_id)) then
    raise exception 'desfecho: oportunidade ganha não muda valor, empresa, responsável nem data de fechamento (reabra com motivo)';
  end if;
  return new;
end $$;
create trigger radar_opportunity_ganho_travado before insert or update on public.radar_opportunity
  for each row execute function public.radar_opportunity_ganho_travado();

-- ---------------------------------------------------------------------------------------- gatilho dos desfechos
-- Entrar em WON (criação já ganha ou mudança de estágio) = GANHO; sair de WON = ESTORNO do ganho vigente. WON → WON
-- não é transição: nada é gravado (regravar o mesmo estado, reenvio da fila offline ou duas sessões ao mesmo tempo —
-- a trava de linha do UPDATE serializa e a segunda já vê WON). Roda como dono (security definer) porque só ele insere.
create or replace function public.radar_opportunity_desfecho() returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_ator uuid := auth.uid();
  v_ganho public.radar_commercial_outcome%rowtype;
  v_dono uuid;
  v_id uuid;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return null; end if;

  if tg_op = 'UPDATE' and old.stage = 'WON' then
    select g.* into v_ganho from public.radar_commercial_outcome g
     where g.opportunity_id = old.id and g.event_type = 'GANHO'
       and not exists (select 1 from public.radar_commercial_outcome e where e.won_event_id = g.id and e.event_type = 'ESTORNO_GANHO')
     order by g.occurred_at desc, g.id desc limit 1;
    -- ganho anterior à 0070 não tem evento: sem backfill, a reabertura não fabrica estorno
    if v_ganho.id is not null then
      insert into public.radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, amount,
        occurred_at, from_stage, to_stage, owner_id, account_owner_id, actor_id, reason, source)
      values (v_ganho.organization_id, v_ganho.opportunity_id, v_ganho.company_id, 'ESTORNO_GANHO', v_ganho.id, null,
        pg_catalog.clock_timestamp(), old.stage, new.stage, v_ganho.owner_id, v_ganho.account_owner_id, v_ator, null, 'trigger')
      returning id into v_id;
      insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
      values (v_ganho.organization_id, v_ator, 'radar_desfecho_estorno', 'radar_desfecho', v_id::text,
        pg_catalog.jsonb_build_object('ganho', v_ganho.id, 'estagio', old.stage),
        pg_catalog.jsonb_build_object('estorno', v_id, 'oportunidade', new.id, 'estagio', new.stage), null, 'trigger');
    end if;
  end if;

  if new.stage = 'WON' then
    select c.commercial_owner_id into v_dono from public.radar_company c where c.id = new.company_id;
    insert into public.radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, amount,
      occurred_at, from_stage, to_stage, owner_id, account_owner_id, actor_id, reason, source)
    values (new.organization_id, new.id, new.company_id, 'GANHO', null, new.won_amount,
      pg_catalog.clock_timestamp(), case when tg_op = 'UPDATE' then old.stage end, new.stage, new.owner_id, v_dono, v_ator,
      pg_catalog.left(new.close_reason, 500), 'trigger')
    returning id into v_id;
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
    values (new.organization_id, v_ator, 'radar_desfecho_ganho', 'radar_desfecho', v_id::text, null,
      pg_catalog.jsonb_build_object('ganho', v_id, 'oportunidade', new.id, 'valor', new.won_amount, 'sem_valor', new.won_amount is null),
      pg_catalog.left(new.close_reason, 500), 'trigger');
  end if;
  return null;
end $$;
create trigger radar_opportunity_desfecho after insert or update of stage on public.radar_opportunity
  for each row execute function public.radar_opportunity_desfecho();

-- ---------------------------------------------------------------------------------------- complemento governado
-- Completa um ganho registrado SEM valor (D3-B: o realizado do mês do ganho é corrigido; nada é apagado). Ator =
-- auth.uid() com perfil ativo Administrador ou Diretoria; organização do perfil; motivo de 3 a 500; valor positivo com
-- até 2 casas e no máximo R$ 1 trilhão; um complemento por ganho (trava da linha do ganho + índice único).
create or replace function public.radar_complementar_valor_ganho(p_ganho uuid, p_valor numeric, p_motivo text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_ator uuid := auth.uid();
  v_org uuid; v_papel public.role_kind; v_ativo boolean;
  v_motivo text := pg_catalog.btrim(coalesce(p_motivo, ''));
  v_g public.radar_commercial_outcome%rowtype;
  v_id uuid;
begin
  if v_ator is null then raise exception 'desfecho: sessão não autenticada'; end if;
  select p.organization_id, p.role, p.active into v_org, v_papel, v_ativo from public.profile p where p.id = v_ator;
  if v_org is null or v_ativo is not true then raise exception 'desfecho: usuário sem perfil ativo'; end if;
  if v_papel is null or v_papel not in ('Administrador'::public.role_kind, 'Diretoria'::public.role_kind) then
    raise exception 'desfecho: sem permissão para completar o valor de um ganho';
  end if;
  if pg_catalog.char_length(v_motivo) not between 3 and 500 then raise exception 'desfecho: informe o motivo (3 a 500 caracteres)'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> pg_catalog.round(p_valor, 2) then raise exception 'desfecho: valor positivo em reais com no máximo 2 casas'; end if;
  if p_valor > 1000000000000 then raise exception 'desfecho: valor acima do máximo (R$ 1.000.000.000.000,00)'; end if;
  select * into v_g from public.radar_commercial_outcome g where g.id = p_ganho for update;
  if v_g.id is null or v_g.organization_id is distinct from v_org or v_g.event_type <> 'GANHO' then raise exception 'desfecho: ganho não encontrado'; end if;
  if v_g.amount is not null then raise exception 'desfecho: o ganho já tem valor confirmado'; end if;
  if exists (select 1 from public.radar_commercial_outcome c where c.won_event_id = v_g.id and c.event_type = 'COMPLEMENTO_VALOR') then
    raise exception 'desfecho: o ganho já foi complementado';
  end if;
  insert into public.radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, amount,
    occurred_at, from_stage, to_stage, owner_id, account_owner_id, actor_id, reason, source)
  values (v_g.organization_id, v_g.opportunity_id, v_g.company_id, 'COMPLEMENTO_VALOR', v_g.id, p_valor,
    pg_catalog.clock_timestamp(), null, null, v_g.owner_id, v_g.account_owner_id, v_ator, v_motivo, 'rpc')
  returning id into v_id;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason, source)
  values (v_org, v_ator, 'radar_complementar_valor_ganho', 'radar_desfecho', v_id::text,
    pg_catalog.jsonb_build_object('ganho', v_g.id, 'valor', null),
    pg_catalog.jsonb_build_object('complemento', v_id, 'ganho', v_g.id, 'oportunidade', v_g.opportunity_id, 'valor', p_valor), v_motivo, 'rpc');
  return pg_catalog.jsonb_build_object('id', v_id, 'ganho', v_g.id, 'valor', p_valor);
end $$;
revoke all on function public.radar_complementar_valor_ganho(uuid, numeric, text) from public, anon;
grant execute on function public.radar_complementar_valor_ganho(uuid, numeric, text) to authenticated;

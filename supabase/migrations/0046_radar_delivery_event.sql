-- Channel Send Safety Patch 01: trilha imutavel da entrega e maquina de estados no banco.
-- Incremental sobre 0045 (nao a altera). Nenhuma entrega existe ainda: o envio segue desligado.
-- Transicoes permitidas (espelham src/core/radar/canais.ts TRANSICOES_ENTREGA):
--   READY -> REQUESTED | REQUESTED -> ACCEPTED, FAILED, UNKNOWN | ACCEPTED -> DELIVERED, FAILED, UNKNOWN
-- DELIVERED, FAILED e UNKNOWN sao terminais: sair de UNKNOWN exige regra aprovada em fase futura (a reconciliacao
-- informa, mas nao transiciona sozinha). Nada de regressao arbitraria.
create table radar_communication_delivery_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  delivery_id uuid not null references radar_communication_delivery(id) on delete cascade,
  from_status text,
  to_status text not null,
  provider_status text,
  occurred_at timestamptz not null default now(),
  actor_id uuid references profile(id),
  reason_safe text check (reason_safe is null or length(reason_safe) <= 500),
  created_at timestamptz not null default now()
);
create index on radar_communication_delivery_event (delivery_id, occurred_at);

-- append-only: usuarios autenticados so leem; o evento nasce apenas do trigger security definer abaixo
alter table radar_communication_delivery_event enable row level security;
create policy rcde_select on radar_communication_delivery_event for select using (organization_id = current_org());
-- o Supabase concede ALL por padrao em tabela nova do schema public: revogar antes (mesma defesa da 0039)
revoke all on radar_communication_delivery_event from authenticated;
grant select on radar_communication_delivery_event to authenticated;
-- o ledger de entrega tambem nao se apaga: sem DELETE nem TRUNCATE (0045 herdara este ajuste)
revoke all on radar_communication_delivery from authenticated;
grant select, insert, update on radar_communication_delivery to authenticated;
create or replace function radar_delivery_event_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'evento de entrega e imutavel (%): nao pode ser alterado nem apagado', tg_op;
end $$;
create trigger rcde_no_update before update on radar_communication_delivery_event for each row execute function radar_delivery_event_imutavel();
create trigger rcde_no_delete before delete on radar_communication_delivery_event for each row execute function radar_delivery_event_imutavel();

-- maquina de estados + producao do evento: unica porta de mudanca de status da entrega
create or replace function radar_delivery_estado() returns trigger language plpgsql security definer set search_path = public as $$
declare permitido text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'READY' then raise exception 'entrega nasce em READY (recebido: %)', new.status; end if;
    insert into radar_communication_delivery_event (organization_id, delivery_id, from_status, to_status, provider_status, occurred_at, actor_id, reason_safe)
      values (new.organization_id, new.id, null, new.status, new.provider_status, now(), new.requested_by, null);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  permitido := case old.status
    when 'READY' then array['REQUESTED']
    when 'REQUESTED' then array['ACCEPTED', 'FAILED', 'UNKNOWN']
    when 'ACCEPTED' then array['DELIVERED', 'FAILED', 'UNKNOWN']
    else array[]::text[] end;
  if not (new.status = any (permitido)) then
    raise exception 'transição de entrega % -> % não é permitida', old.status, new.status;
  end if;
  insert into radar_communication_delivery_event (organization_id, delivery_id, from_status, to_status, provider_status, occurred_at, actor_id, reason_safe)
    values (new.organization_id, new.id, old.status, new.status, new.provider_status, now(), new.requested_by, left(new.error_message_safe, 500));
  return new;
end $$;
create trigger radar_delivery_estado after insert or update on radar_communication_delivery for each row execute function radar_delivery_estado();

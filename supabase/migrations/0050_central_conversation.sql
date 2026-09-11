-- EIFF Central: conversa, mensagem e evento. Espelha src/core/central/conversa.ts.
-- Nesta fase a Central so RECEBE: nenhuma mensagem e enviada por aqui.
--
-- O que o banco garante (nao so o codigo):
--   1) DEDUP: unique (organization_id, provider, external_message_id). A Meta reenvia a notificacao ate receber 200,
--      entao a mesma mensagem chega varias vezes - e aqui ela para, mesmo que duas instancias da funcao rodem juntas;
--   2) uma conversa por (organizacao, contexto, telefone) - a mesma chave do core;
--   3) central_event e APPEND-ONLY (triggers recusam update e delete, como radar_communication_event);
--   4) o status da mensagem nunca anda para tras (delivered que chega antes de sent nao rebaixa nada);
--   5) o CONTEUDO da mensagem nao e guardado: o ChannelInboundEvent so traz metadados e o corpo bruto do webhook
--      nunca e persistido (docs/eiff-central.md). Texto so entrara com decisao propria de retencao;
--   6) escrita SOMENTE server-side: quem chama o webhook e a Meta, nao um usuario com JWT.
-- Migration idempotente: pode ser aplicada mais de uma vez.

create table if not exists central_conversation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  context text not null check (context in ('INTERNAL', 'EXTERNAL')),
  provider text not null check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD')),
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{9,14}$'),
  external_conversation_id text,
  identity_id uuid references whatsapp_identity(id),
  status text not null default 'ABERTA' check (status in ('ABERTA', 'ATENDIMENTO_HUMANO', 'ENCERRADA')),
  -- takeover: com humano responsavel, nenhum agente responde
  human_owner_id uuid references profile(id),
  opened_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  -- 2) a chave da conversa e (organizacao, contexto, telefone): a mesma do core
  constraint central_conversation_chave_uk unique (organization_id, context, phone_e164),
  constraint central_conversation_humano_chk check (status <> 'ATENDIMENTO_HUMANO' or human_owner_id is not null),
  constraint central_conversation_encerrada_chk check (status <> 'ENCERRADA' or closed_at is not null)
);
create index if not exists central_conversation_org_idx on central_conversation (organization_id, status, last_message_at desc);

create table if not exists central_message (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  conversation_id uuid not null references central_conversation(id) on delete cascade,
  provider text not null check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD')),
  external_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text,  -- text, image, audio... (o TIPO, nunca o conteudo)
  status text check (status in ('RECEBIDA', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU')),
  error_code text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  -- 1) a garantia de dedup no BANCO, nao so no codigo
  constraint central_message_externo_uk unique (organization_id, provider, external_message_id)
);
create index if not exists central_message_conversa_idx on central_message (conversation_id, occurred_at desc);

create table if not exists central_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  conversation_id uuid not null references central_conversation(id) on delete cascade,
  message_id uuid references central_message(id) on delete cascade,
  event_type text not null check (event_type in (
    'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELIVERED', 'MESSAGE_READ', 'MESSAGE_FAILED', 'MESSAGE_STATUS',
    'CONVERSATION_STATUS', 'CONVERSA_ABERTA', 'CONVERSA_REABERTA', 'ATENDIMENTO_HUMANO', 'ATENDIMENTO_DEVOLVIDO', 'CONVERSA_ENCERRADA')),
  occurred_at timestamptz not null default now(),
  actor_id uuid references profile(id),
  actor_kind text check (actor_kind is null or actor_kind in ('USER', 'SERVER', 'PROVIDER', 'SYSTEM')),
  -- detalhe SEGURO: telefone sempre mascarado. A checagem barra qualquer sequencia longa de digitos.
  detail_safe text check (detail_safe is null or (length(detail_safe) <= 500 and detail_safe !~ '[0-9]{7,}')),
  created_at timestamptz not null default now()
);
create index if not exists central_event_conversa_idx on central_event (conversation_id, occurred_at);
-- o mesmo evento da mesma mensagem so entra uma vez (idempotencia do webhook tambem na trilha)
create unique index if not exists central_event_mensagem_uk on central_event (organization_id, message_id, event_type) where message_id is not null;

drop trigger if exists central_conversation_touch on central_conversation;
create trigger central_conversation_touch before update on central_conversation for each row execute function touch_updated_at();
drop trigger if exists central_message_touch on central_message;
create trigger central_message_touch before update on central_message for each row execute function touch_updated_at();

-- 3) append-only: o evento nao muda e nao se apaga
create or replace function central_event_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'evento da Central é imutável (%): não pode ser alterado nem apagado', tg_op;
end $$;
drop trigger if exists central_event_no_update on central_event;
create trigger central_event_no_update before update on central_event for each row execute function central_event_imutavel();
drop trigger if exists central_event_no_delete on central_event;
create trigger central_event_no_delete before delete on central_event for each row execute function central_event_imutavel();

-- 4) o status da mensagem so anda para FRENTE (mesma ordem de src/core/central/conversa.ts: ORDEM_STATUS)
create or replace function central_message_ordem(p_status text) returns integer language sql immutable as $$
  select case p_status when 'RECEBIDA' then 0 when 'ENVIADA' then 1 when 'FALHOU' then 2
                       when 'ENTREGUE' then 3 when 'LIDA' then 4 else -1 end
$$;
create or replace function central_message_estado() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.provider is distinct from old.provider
     or new.external_message_id is distinct from old.external_message_id or new.direction is distinct from old.direction
     or new.conversation_id is distinct from old.conversation_id or new.occurred_at is distinct from old.occurred_at then
    raise exception 'mensagem da Central é imutável no que veio do provider (id %)', old.id;
  end if;
  if new.status is distinct from old.status and old.status is not null
     and central_message_ordem(new.status) <= central_message_ordem(old.status) then
    -- evento fora de ordem (delivered antes de sent): o status nao rebaixa, e nao e erro
    new.status := old.status;
  end if;
  return new;
end $$;
drop trigger if exists central_message_estado on central_message;
create trigger central_message_estado before update on central_message for each row execute function central_message_estado();

-- coerencia: mensagem e evento vivem na mesma organizacao e na mesma conversa
create or replace function central_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_conversa uuid;
begin
  select organization_id into v_org from central_conversation where id = new.conversation_id;
  if v_org is null then raise exception 'conversa % não encontrada', new.conversation_id; end if;
  if v_org <> new.organization_id then raise exception 'linha de outra organização'; end if;
  if tg_table_name = 'central_event' and new.message_id is not null then
    select conversation_id into v_conversa from central_message where id = new.message_id;
    if v_conversa is distinct from new.conversation_id then raise exception 'evento com mensagem de outra conversa'; end if;
  end if;
  return new;
end $$;
-- a conversa nao referencia identidade nem dono de OUTRA organizacao, mesmo via service_role com parametro errado
create or replace function central_conversation_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $
begin
  if new.identity_id is not null and not exists (
    select 1 from whatsapp_identity i where i.id = new.identity_id and i.organization_id = new.organization_id) then
    raise exception 'identidade % não pertence à organização da conversa', new.identity_id;
  end if;
  if new.human_owner_id is not null and not exists (
    select 1 from profile p where p.id = new.human_owner_id and p.organization_id = new.organization_id) then
    raise exception 'responsável % não pertence à organização da conversa', new.human_owner_id;
  end if;
  return new;
end $;
drop trigger if exists central_conversation_coerencia on central_conversation;
create trigger central_conversation_coerencia before insert or update on central_conversation for each row execute function central_conversation_coerencia();

-- o ator do evento tambem e da organizacao da linha
create or replace function central_event_ator_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $
begin
  if new.actor_id is not null and not exists (
    select 1 from profile p where p.id = new.actor_id and p.organization_id = new.organization_id) then
    raise exception 'ator % não pertence à organização do evento', new.actor_id;
  end if;
  return new;
end $;
drop trigger if exists central_event_ator on central_event;
create trigger central_event_ator before insert on central_event for each row execute function central_event_ator_coerencia();

drop trigger if exists central_message_coerencia on central_message;
create trigger central_message_coerencia before insert or update on central_message for each row execute function central_coerencia();
drop trigger if exists central_event_coerencia on central_event;
create trigger central_event_coerencia before insert on central_event for each row execute function central_coerencia();

-- 6) RLS: leitura por organizacao (coluna da PROPRIA linha, nunca funcao STABLE sobre a propria tabela - ver CLAUDE.md).
--    Escrita: nenhuma para `authenticated`. Quem grava e o webhook server-side (service_role), depois de validar a
--    assinatura da Meta; nenhum navegador insere conversa, mensagem ou evento.
alter table central_conversation enable row level security;
alter table central_message enable row level security;
alter table central_event enable row level security;
-- conversa EXTERNAL (cliente, lead, parceiro) e da organizacao; conversa INTERNAL e do colaborador: so a Diretoria,
-- o Financeiro, o Administrador e quem assumiu o atendimento enxergam. Mensagem e evento nao guardam telefone.
drop policy if exists cc_select on central_conversation;
create policy cc_select on central_conversation for select using (
  organization_id = current_org()
  and (context = 'EXTERNAL' or has_role('Administrador', 'Diretoria', 'Financeiro') or human_owner_id = auth.uid())
);
-- mensagem e evento HERDAM a visibilidade da conversa: o EXISTS abaixo passa pela propria RLS de
-- central_conversation (a politica roda como o usuario que consulta), entao a regra e exatamente a mesma, escrita
-- uma vez so. Sem recursao: a politica da conversa nao olha para mensagem nem para evento.
drop policy if exists cm_select on central_message;
create policy cm_select on central_message for select using (
  organization_id = current_org()
  and exists (select 1 from central_conversation c where c.id = central_message.conversation_id)
);
drop policy if exists ce_select on central_event;
create policy ce_select on central_event for select using (
  organization_id = current_org()
  and exists (select 1 from central_conversation c where c.id = central_event.conversation_id)
);
revoke all on central_conversation from authenticated;
revoke all on central_message from authenticated;
revoke all on central_event from authenticated;
grant select on central_conversation to authenticated;
grant select on central_message to authenticated;
grant select on central_event to authenticated;

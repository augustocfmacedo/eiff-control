-- Ledger de entrega das comunicacoes do Radar (Channel Provider 01). Uma linha por tentativa de entrega de uma
-- comunicacao APROVADA por um canal (provider). Nesta fase NADA e inserido: o envio esta bloqueado; a tabela existe
-- para que a entrega futura ja nasca idempotente e auditavel.
-- Minimizacao: nunca guardar chave de API, JWT, payload bruto do provider, telefone ou o texto da mensagem
-- (o texto oficial continua em radar_communication.generated_content/edited_content). provider_metadata e minimizado
-- por trigger, como em radar_communication (migration 0039).
create table radar_communication_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  communication_id uuid not null references radar_communication(id) on delete cascade,
  company_id uuid not null references radar_company(id),
  contact_id uuid references radar_contact(id),
  provider text not null check (provider in ('MANUAL', 'OCTADESK')),
  channel text not null check (channel in ('PHONE', 'WHATSAPP', 'EMAIL', 'LINKEDIN', 'VISIT', 'REFERRAL', 'OTHER')),
  status text not null default 'READY' check (status in ('READY', 'REQUESTED', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN')),
  mode text not null check (mode in ('TEMPLATE', 'FREEFORM', 'MANUAL')),
  idempotency_key text not null,
  provider_conversation_id text,
  provider_message_id text,
  provider_sender_id text,
  provider_template_id text,
  request_fingerprint text,
  provider_status text,
  error_code text,
  error_message_safe text,
  requested_by uuid references profile(id),
  requested_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  -- idempotencia: a API da Octadesk nao documenta chave de idempotencia (docs/octadesk.md), entao a garantia e nossa
  unique (organization_id, idempotency_key),
  -- coerencia de datas com o status
  check (status <> 'ACCEPTED' or accepted_at is not null),
  check (status <> 'DELIVERED' or delivered_at is not null),
  check (status <> 'FAILED' or failed_at is not null),
  check (error_message_safe is null or length(error_message_safe) <= 500)
);
create index on radar_communication_delivery (communication_id, created_at desc);
create index on radar_communication_delivery (organization_id, status);
create index on radar_communication_delivery (provider_conversation_id);

-- coerencia referencial: a entrega e da mesma organizacao e da mesma comunicacao/empresa/contato
create or replace function radar_delivery_coerencia() returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select organization_id, company_id, contact_id, state into c from radar_communication where id = new.communication_id;
  if c is null then raise exception 'comunicação % não encontrada', new.communication_id; end if;
  if c.organization_id <> new.organization_id then raise exception 'entrega de outra organização'; end if;
  if c.company_id <> new.company_id then raise exception 'entrega com empresa diferente da comunicação'; end if;
  if new.contact_id is not null and c.contact_id <> new.contact_id then raise exception 'entrega com contato diferente da comunicação'; end if;
  if c.state not in ('APPROVED', 'SENT', 'REPLIED') then raise exception 'entrega só de comunicação aprovada (estado atual: %)', c.state; end if;
  return new;
end $$;
create trigger radar_delivery_coerencia before insert or update on radar_communication_delivery for each row execute function radar_delivery_coerencia();

-- minimizacao: provider_metadata nunca guarda PII nem payload bruto (mesma defesa da migration 0039)
create or replace function radar_delivery_minimizar() returns trigger language plpgsql as $$
begin
  if jsonb_tem_chave_profunda(new.provider_metadata, array['phone','telefone','whatsapp','email','e_mail','body','message','texto','text','content','apiKey','api_key','token','authorization','raw','payload']) then
    raise exception 'provider_metadata não pode conter PII, texto de mensagem, payload bruto ou credenciais';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  return new;
end $$;
create trigger radar_delivery_minimizar before insert or update on radar_communication_delivery for each row execute function radar_delivery_minimizar();

alter table radar_communication_delivery enable row level security;
create policy rcd_select on radar_communication_delivery for select using (organization_id = current_org());
create policy rcd_write on radar_communication_delivery for all using (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras'));
grant select, insert, update on radar_communication_delivery to authenticated;

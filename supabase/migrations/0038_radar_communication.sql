-- Comunicacoes geradas pelo Radar (Communication Persistence 01): rascunhos com fact gate, revisao humana e ciclo
-- DRAFT -> READY_FOR_REVIEW -> APPROVED -> SENT (so com a atividade do envio manual) -> REPLIED (so com a atividade da resposta).
-- Padroes das tabelas radar_* (0031): organization_id, RLS por current_org() e has_role, touch_updated_at (version), audit_row, forbid_delete.
-- content_spec e o snapshot minimo (claims permitidos, objetivo, playbook, canal, CTA, versoes); nunca raw_payload, telefone, e-mail ou perfil.

create table radar_communication (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  company_id uuid not null references radar_company(id),
  contact_id uuid not null references radar_contact(id),
  signal_id uuid references radar_signal(id),
  strategy_id uuid references radar_strategy(id),
  objective text not null,
  playbook text not null,
  channel text not null check (channel in ('PHONE','WHATSAPP','EMAIL','LINKEDIN','VISIT','REFERRAL','OTHER')),
  state text not null default 'READY_FOR_REVIEW' check (state in ('DRAFT','READY_FOR_REVIEW','APPROVED','REJECTED','SENT','REPLIED','CANCELLED')),
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  content_spec jsonb not null,
  generated_content jsonb not null,
  edited_content jsonb,
  validation jsonb,
  provider text not null,
  model text,
  prompt_version text not null,
  playbook_version text not null,
  content_spec_version text not null,
  created_by uuid not null references profile(id),
  approved_by uuid references profile(id),
  approved_at timestamptz,
  rejected_by uuid references profile(id),
  rejected_at timestamptz,
  rejection_reason text,
  sent_at timestamptz,
  sent_activity_id uuid references radar_activity(id),
  replied_at timestamptz,
  replied_activity_id uuid references radar_activity(id),
  last_transition_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  -- invariantes: SENT exige atividade de envio; REPLIED exige envio e resposta
  constraint radar_communication_sent_chk check (state <> 'SENT' or sent_activity_id is not null),
  constraint radar_communication_replied_chk check (state <> 'REPLIED' or (sent_activity_id is not null and replied_activity_id is not null)),
  -- minimizacao: o snapshot nunca carrega bruto, telefone, e-mail ou linkedin
  constraint radar_communication_spec_minimo_chk check (not (content_spec ? 'bruto') and not (content_spec ? 'raw_payload') and content_spec::text !~* '"(celular|telefone|whatsapp|email|linkedin|mobile_phone|professional_email)"\s*:')
);
create index radar_communication_company_idx on radar_communication (organization_id, company_id, created_at desc);
create index radar_communication_state_idx on radar_communication (organization_id, state);
-- idempotencia: um unico rascunho ativo por contexto
create unique index radar_communication_context_hash_ativo on radar_communication (organization_id, context_hash) where state in ('DRAFT','READY_FOR_REVIEW','APPROVED');

create table radar_communication_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  communication_id uuid not null references radar_communication(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_id uuid references profile(id),
  reason text,
  occurred_at timestamptz not null default now()
);
create index radar_communication_event_idx on radar_communication_event (communication_id, occurred_at);

-- toda mudanca de estado gera evento (nenhum update silencioso); o ator vem da sessao (auth.uid()) ou da claim usada pelos scripts
create or replace function radar_communication_state_event() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid;
begin
  v_actor := coalesce(auth.uid(), nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
  if tg_op = 'INSERT' then
    insert into radar_communication_event (organization_id, communication_id, from_state, to_state, actor_id, reason) values (new.organization_id, new.id, null, new.state, v_actor, new.last_transition_reason);
  elsif new.state is distinct from old.state then
    -- transicoes permitidas (espelho de TRANSICOES_COMUNICACAO no app)
    if not (
      (old.state = 'DRAFT' and new.state in ('READY_FOR_REVIEW','CANCELLED')) or
      (old.state = 'READY_FOR_REVIEW' and new.state in ('APPROVED','REJECTED','CANCELLED')) or
      (old.state = 'APPROVED' and new.state in ('SENT','REJECTED','CANCELLED')) or
      (old.state = 'REJECTED' and new.state in ('READY_FOR_REVIEW','CANCELLED')) or
      (old.state = 'SENT' and new.state in ('REPLIED','CANCELLED'))
    ) then raise exception 'transicao de comunicacao nao permitida: % -> %', old.state, new.state; end if;
    insert into radar_communication_event (organization_id, communication_id, from_state, to_state, actor_id, reason) values (new.organization_id, new.id, old.state, new.state, v_actor, new.last_transition_reason);
  end if;
  return new;
end $$;
create trigger radar_communication_state_event after insert or update on radar_communication for each row execute function radar_communication_state_event();

create trigger radar_communication_touch before update on radar_communication for each row execute function touch_updated_at();
create trigger radar_communication_audit after insert or update on radar_communication for each row execute function audit_row();
create trigger radar_communication_no_delete before delete on radar_communication for each row execute function forbid_delete();

-- RLS: mesmo padrao e mesma matriz das tabelas radar_* (0031): leitura por organizacao; escrita pelos papeis com permissao radar
do $$
declare t text;
begin
  foreach t in array array['radar_communication','radar_communication_event'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (organization_id = current_org())', t || '_select', t);
    execute format('create policy %I on %I for all using (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras'')) with check (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras''))', t || '_write', t);
  end loop;
end $$;
grant select, insert, update on radar_communication, radar_communication_event to authenticated;

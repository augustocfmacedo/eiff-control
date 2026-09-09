-- Communication Persistence Integrity Patch 01: evento imutavel, snapshot imutavel e minimizacao recursiva de PII/raw.
-- Incremental sobre 0038 (nao a altera).

-- 1) Trilha de eventos imutavel: usuarios autenticados so leem; eventos nascem apenas do trigger security definer
--    (radar_communication_state_event) ou de caminho server-side (service_role). Belt and braces: trigger recusa update/delete.
drop policy if exists radar_communication_event_write on radar_communication_event;
revoke all on radar_communication_event from authenticated; -- o grant amplo de 0038 (insert/update/delete/truncate/references/trigger) cai
grant select on radar_communication_event to authenticated;
create or replace function radar_communication_event_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'evento de comunicacao e imutavel (%): nao pode ser alterado nem apagado', tg_op;
end $$;
create trigger radar_communication_event_no_update before update on radar_communication_event for each row execute function radar_communication_event_imutavel();
create trigger radar_communication_event_no_delete before delete on radar_communication_event for each row execute function radar_communication_event_imutavel();
-- o trigger de estado insere como definer (dono da tabela): continua funcionando sem policy de insert
alter function radar_communication_state_event() security definer;

-- 2) Snapshot imutavel: depois do INSERT, so os campos operacionais mudam. Contexto novo = comunicacao nova.
create or replace function radar_communication_snapshot_imutavel() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.company_id is distinct from old.company_id or new.contact_id is distinct from old.contact_id
     or new.signal_id is distinct from old.signal_id or new.strategy_id is distinct from old.strategy_id or new.objective is distinct from old.objective
     or new.playbook is distinct from old.playbook or new.channel is distinct from old.channel or new.context_hash is distinct from old.context_hash
     or new.content_spec is distinct from old.content_spec or new.generated_content is distinct from old.generated_content
     or new.provider is distinct from old.provider or new.model is distinct from old.model or new.prompt_version is distinct from old.prompt_version
     or new.playbook_version is distinct from old.playbook_version or new.content_spec_version is distinct from old.content_spec_version
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'snapshot da comunicacao e imutavel: mudanca de contexto gera nova comunicacao (id %)', old.id;
  end if;
  return new;
end $$;
create trigger radar_communication_snapshot before update on radar_communication for each row execute function radar_communication_snapshot_imutavel();

-- 3) Minimizacao recursiva: nenhuma CHAVE proibida em qualquer nivel do JSON (texto com a palavra "email" e permitido; url/original_url sao permitidas)
create or replace function jsonb_tem_chave_profunda(j jsonb, chaves text[]) returns boolean language sql immutable as $$
  select case jsonb_typeof(j)
    when 'object' then exists (select 1 from jsonb_each(j) e where e.key = any (chaves) or jsonb_tem_chave_profunda(e.value, chaves))
    when 'array' then exists (select 1 from jsonb_array_elements(j) a where jsonb_tem_chave_profunda(a, chaves))
    else false end
$$;
alter table radar_communication drop constraint if exists radar_communication_spec_minimo_chk;
alter table radar_communication add constraint radar_communication_spec_minimo_chk check (
  not jsonb_tem_chave_profunda(content_spec, array['raw_payload','bruto','celular','telefone','whatsapp','email','linkedin','mobile_phone','professional_email'])
);
alter table radar_communication add constraint radar_communication_conteudo_minimo_chk check (
  not jsonb_tem_chave_profunda(generated_content, array['raw_payload','bruto','celular','telefone','whatsapp','email','linkedin','mobile_phone','professional_email'])
  and (edited_content is null or not jsonb_tem_chave_profunda(edited_content, array['raw_payload','bruto','celular','telefone','whatsapp','email','linkedin','mobile_phone','professional_email']))
);

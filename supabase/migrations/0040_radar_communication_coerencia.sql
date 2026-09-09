-- LLM Server Truth Patch 01: coerencia referencial da comunicacao no banco (ultima defesa, independente de quem insere).
-- contact.company_id, signal.company_id e a organizacao de empresa/contato/sinal/estrategia devem bater com a comunicacao.
-- SECURITY DEFINER com search_path fixo: enxerga linhas de outras organizacoes para recusar explicitamente (sob RLS a
-- leitura devolveria vazio e o resultado seria o mesmo: recusa).
create or replace function radar_communication_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_emp uuid;
begin
  select organization_id into v_org from radar_company where id = new.company_id;
  if v_org is null or v_org <> new.organization_id then raise exception 'comunicacao incoerente: empresa inexistente ou de outra organizacao'; end if;
  select organization_id, company_id into v_org, v_emp from radar_contact where id = new.contact_id;
  if v_org is null or v_org <> new.organization_id then raise exception 'comunicacao incoerente: contato inexistente ou de outra organizacao'; end if;
  if v_emp <> new.company_id then raise exception 'comunicacao incoerente: contato nao pertence a empresa'; end if;
  if new.signal_id is not null then
    select organization_id, company_id into v_org, v_emp from radar_signal where id = new.signal_id;
    if v_org is null or v_org <> new.organization_id then raise exception 'comunicacao incoerente: sinal inexistente ou de outra organizacao'; end if;
    if v_emp <> new.company_id then raise exception 'comunicacao incoerente: sinal nao pertence a empresa'; end if;
  end if;
  if new.strategy_id is not null then
    select organization_id into v_org from radar_strategy where id = new.strategy_id;
    if v_org is null or v_org <> new.organization_id then raise exception 'comunicacao incoerente: estrategia inexistente ou de outra organizacao'; end if;
  end if;
  return new;
end $$;
drop trigger if exists radar_communication_coerencia on radar_communication;
create trigger radar_communication_coerencia before insert or update on radar_communication for each row execute function radar_communication_coerencia();

-- Acompanhamento de faturamento do contrato (substitui a planilha ACOMPANHAMENTO_FATURAMENTO_*.xlsx).
-- Duas coisas, ambas sobre os titulos que ja existem: (1) a data em que a nota de faturamento direto
-- foi repassada ao cliente e (2) o rateio de um titulo por servico/etapa, porque uma NF cobre varias
-- etapas do contrato (a medicao da construtora e parcial por etapa, e a nota do fornecedor tambem).
-- O rateio e leitura por etapa do MESMO titulo: nao muda valor, caixa, custo nem DRE.
-- Regras em src/core/faturamento.ts.

alter table financial_entry add column if not exists client_forwarded_on date;
comment on column financial_entry.client_forwarded_on is 'Nota repassada ao cliente para faturamento direto (planilha: ENVIADO INVEST); nulo = nao enviada.';

create table entry_service_split (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entry_id uuid not null references financial_entry(id) on delete cascade,
  project_id uuid not null references project(id),
  service_id uuid not null references project_service(id),
  measurement_id uuid references measurement(id),
  description text,
  amount numeric(16,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  created_by uuid references profile(id)
);
create index on entry_service_split (entry_id);
create index on entry_service_split (project_id, service_id);
create trigger entry_service_split_audit after insert or update or delete on entry_service_split for each row execute function audit_row();
alter table entry_service_split enable row level security;
create policy ess_select on entry_service_split for select using (organization_id = current_org());
create policy ess_write on entry_service_split for all using (organization_id = current_org() and has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'));
grant select, insert, update, delete on entry_service_split to authenticated;

-- coerencia referencial: o rateio pertence ao mesmo titulo, obra e organizacao; o servico e da obra do titulo
create or replace function entry_service_split_coerencia() returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_proj uuid; v_srv_proj uuid; v_med_proj uuid;
begin
  select organization_id, project_id into v_org, v_proj from financial_entry where id = new.entry_id;
  if v_org is null then raise exception 'rateio: titulo % nao encontrado', new.entry_id; end if;
  if v_proj is null then raise exception 'rateio: titulo % nao tem obra', new.entry_id; end if;
  if new.organization_id <> v_org then raise exception 'rateio: organizacao diferente da do titulo'; end if;
  if new.project_id <> v_proj then raise exception 'rateio: obra diferente da do titulo'; end if;
  select project_id into v_srv_proj from project_service where id = new.service_id;
  if v_srv_proj is distinct from v_proj then raise exception 'rateio: servico de outra obra'; end if;
  if new.measurement_id is not null then
    select project_id into v_med_proj from measurement where id = new.measurement_id;
    if v_med_proj is distinct from v_proj then raise exception 'rateio: medicao de outra obra'; end if;
  end if;
  return new;
end $$;
create trigger entry_service_split_coerencia before insert or update on entry_service_split for each row execute function entry_service_split_coerencia();

-- Medicoes do cronograma fisico-financeiro e projecao de custo por servico (margem alvo).

alter table project add column if not exists target_margin numeric(6,4);
alter table project_service add column if not exists sale_direct numeric(16,2);
alter table project_service add column if not exists budget_base numeric(16,2);
alter table project_service add column if not exists target_margin numeric(6,4);

-- measurement: campos do evento do cronograma (numero, mes, etapa, valores bruto/direto/construtora/retencao)
alter table measurement add column if not exists service_id uuid references project_service(id);
alter table measurement add column if not exists month_no integer;
alter table measurement add column if not exists stage text;
alter table measurement add column if not exists title text;
alter table measurement add column if not exists scope text;
alter table measurement add column if not exists criteria text;
alter table measurement add column if not exists documents text;
alter table measurement add column if not exists approver text;
alter table measurement add column if not exists planned_on date;
alter table measurement add column if not exists gross_amount numeric(16,2);
alter table measurement add column if not exists direct_amount numeric(16,2) default 0;
alter table measurement add column if not exists contractor_amount numeric(16,2);
alter table measurement add column if not exists retention_amount numeric(16,2) default 0;
alter table measurement add column if not exists planned_progress numeric(6,4) default 0;
alter table measurement add column if not exists measured_on date;
alter table measurement add column if not exists measured_amount numeric(16,2);
alter table measurement add column if not exists entry_id uuid references financial_entry(id);
alter table measurement add column if not exists notes text;
alter table measurement alter column kind set default 'Percentual físico';
alter table measurement alter column status set default 'Pendente';
create index if not exists measurement_service_idx on measurement (service_id);

create trigger measurement_audit after insert or update on measurement for each row execute function audit_row();
grant delete on measurement to authenticated;

-- view: faturamento da construtora por servico (medido x a medir) para BI
create or replace view v_service_billing as
select m.service_id, m.project_id,
  sum(m.contractor_amount) as contractor_total,
  sum(case when m.status in ('Medido','Faturado','Recebido') then coalesce(m.measured_amount, m.contractor_amount) else 0 end) as measured_total,
  sum(m.retention_amount * case when m.gross_amount > 0 then m.contractor_amount / m.gross_amount else 0 end) as retention_contractor
from measurement m where m.status <> 'Cancelado'
group by m.service_id, m.project_id;

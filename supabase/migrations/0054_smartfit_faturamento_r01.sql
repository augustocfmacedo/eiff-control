-- Carga do acompanhamento de faturamento do contrato OB-SF-CL-01: a planilha ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx
-- (revisao vigente do cronograma e notas ja faturadas), que passa a viver no sistema.
-- Gerado por scripts/faturamento-planilha.mjs --sql. Idempotente: pode rodar de novo sem duplicar.
--
-- (1) Cronograma na revisao da planilha. O total do contrato nao muda: muda a distribuicao entre eventos e o
--     split direto/construtora. E07 nao e tocado: no sistema ele esta desdobrado e ja soma o mesmo.

update measurement m set gross_amount = 15750, direct_amount = 0, contractor_amount = 15750, retention_amount = 1575, stage = 'Projetos Executivos', month_no = 1
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E01'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (15750, 0, 15750, 1575);
update measurement m set gross_amount = 15750, direct_amount = 0, contractor_amount = 15750, retention_amount = 1575, stage = 'Projetos Executivos', month_no = 1
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E02'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (15750, 0, 15750, 1575);
update measurement m set gross_amount = 15750, direct_amount = 0, contractor_amount = 15750, retention_amount = 1575, stage = 'Projetos Executivos', month_no = 2
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E03'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (15750, 0, 15750, 1575);
update measurement m set gross_amount = 15750, direct_amount = 0, contractor_amount = 15750, retention_amount = 1575, stage = 'Projetos Executivos', month_no = 2
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E04'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (15750, 0, 15750, 1575);
update measurement m set gross_amount = 120000, direct_amount = 0, contractor_amount = 120000, retention_amount = 12000, stage = 'Administração / Mobilização', month_no = 3
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E05'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (120000, 0, 120000, 12000);
update measurement m set gross_amount = 82000, direct_amount = 30000, contractor_amount = 52000, retention_amount = 8200, stage = 'Serviços Preliminares', month_no = 3
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E06'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (82000, 30000, 52000, 8200);
update measurement m set gross_amount = 130000, direct_amount = 0, contractor_amount = 130000, retention_amount = 13000, stage = 'Fundação e Arrimo', month_no = 3
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E08'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (130000, 0, 130000, 13000);
update measurement m set gross_amount = 260000, direct_amount = 50000, contractor_amount = 210000, retention_amount = 26000, stage = 'Fundação e Arrimo', month_no = 4
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E09'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (260000, 50000, 210000, 26000);
update measurement m set gross_amount = 260000, direct_amount = 260000, contractor_amount = 0, retention_amount = 26000, stage = 'Estrutura Metálica', month_no = 4
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E10'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (260000, 260000, 0, 26000);
update measurement m set gross_amount = 185000, direct_amount = 145000, contractor_amount = 40000, retention_amount = 18500, stage = 'Estrutura Metálica', month_no = 4
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E11'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (185000, 145000, 40000, 18500);
update measurement m set gross_amount = 230000, direct_amount = 200000, contractor_amount = 30000, retention_amount = 23000, stage = 'Estrutura Metálica', month_no = 5
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E12'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (230000, 200000, 30000, 23000);
update measurement m set gross_amount = 210000, direct_amount = 100000, contractor_amount = 110000, retention_amount = 21000, stage = 'Estrutura Metálica', month_no = 5
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E13'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (210000, 100000, 110000, 21000);
update measurement m set gross_amount = 225000, direct_amount = 220000, contractor_amount = 5000, retention_amount = 22500, stage = 'Cobertura', month_no = 5
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E14'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (225000, 220000, 5000, 22500);
update measurement m set gross_amount = 150000, direct_amount = 130000, contractor_amount = 20000, retention_amount = 15000, stage = 'Instalações Gerais', month_no = 5
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E15'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (150000, 130000, 20000, 15000);
update measurement m set gross_amount = 250000, direct_amount = 210000, contractor_amount = 40000, retention_amount = 25000, stage = 'Steel Deck', month_no = 6
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E16'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (250000, 210000, 40000, 25000);
update measurement m set gross_amount = 255000, direct_amount = 220000, contractor_amount = 35000, retention_amount = 25500, stage = 'Vedação Externa', month_no = 6
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E17'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (255000, 220000, 35000, 25500);
update measurement m set gross_amount = 185000, direct_amount = 130000, contractor_amount = 55000, retention_amount = 18500, stage = 'Instalações Gerais', month_no = 6
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E18'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (185000, 130000, 55000, 18500);
update measurement m set gross_amount = 105000, direct_amount = 40000, contractor_amount = 65000, retention_amount = 10500, stage = 'Estrutura/Cobertura/Transporte', month_no = 6
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E19'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (105000, 40000, 65000, 10500);
update measurement m set gross_amount = 260000, direct_amount = 180000, contractor_amount = 80000, retention_amount = 26000, stage = 'Piso Industrial', month_no = 7
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E20'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (260000, 180000, 80000, 26000);
update measurement m set gross_amount = 205000, direct_amount = 150000, contractor_amount = 55000, retention_amount = 20500, stage = 'Pintura', month_no = 7
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E21'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (205000, 150000, 55000, 20500);
update measurement m set gross_amount = 130000, direct_amount = 50000, contractor_amount = 80000, retention_amount = 13000, stage = 'Instalações / Acabamentos', month_no = 7
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E22'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (130000, 50000, 80000, 13000);
update measurement m set gross_amount = 215000, direct_amount = 160000, contractor_amount = 55000, retention_amount = 21500, stage = 'Acabamentos / Testes', month_no = 8
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E23'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (215000, 160000, 55000, 21500);
update measurement m set gross_amount = 170000, direct_amount = 140000, contractor_amount = 30000, retention_amount = 17000, stage = 'Acabamentos / Pré-entrega', month_no = 8
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E24'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (170000, 140000, 30000, 17000);
update measurement m set gross_amount = 190000, direct_amount = 150000, contractor_amount = 40000, retention_amount = 19000, stage = 'Entrega Final', month_no = 9
  from project p where m.project_id = p.id and p.code = 'OB-SF-CL-01' and m.number = 'E25'
  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (190000, 150000, 40000, 19000);

-- (2) Notas de faturamento direto: cada linha da planilha vira um titulo de saida com faturamento direto,
--     vinculado ao servico da etapa. Situacao ESTIMATIVA entra como Rascunho (a nota ainda nao existe).
--     Faturamento direto nao passa pelo caixa nem pelo DRE da EIFF; conta no comprometido da obra e abate o
--     saldo de faturamento direto do contrato. "ENVIADO INVEST = SIM" vira client_forwarded_on na data da nota.

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-001', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-08-10', 'JK CONTAINERS', '50604', 'Locação mensal de containers de 28/07 a 26/08', '2026-08-10', '2026-08-10', 'Programado', 'Confirmado', 1, 2060,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Serviços Preliminares.', 'planilha-faturamento', 'PAG-FD-001', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-03'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Equipamentos e locações'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-001');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-002', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-09', 'JK CONTAINERS', '51264', 'Locação mensal de containers de 27/08 a 25/09', '2026-09-09', '2026-09-09', 'Programado', 'Confirmado', 1, 1700,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Serviços Preliminares.', 'planilha-faturamento', 'PAG-FD-002', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-03'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Equipamentos e locações'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-002');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-003', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-08-11', 'PAIS E FILHOS TERRAPLANAGEM', '37', 'Terraplanagem', '2026-08-11', '2026-08-11', 'Programado', 'Confirmado', 1, 35000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Movimentação de Terra.', 'planilha-faturamento', 'PAG-FD-003', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-003');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-004', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-03', 'LOCABROCK PERFURAÇÕES', '83', 'Terraplanagem', '2026-09-03', '2026-09-03', 'Programado', 'Confirmado', 1, 24650.78,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Movimentação de Terra.', 'planilha-faturamento', 'PAG-FD-004', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-004');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-005', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-14', 'LOCABROCK PERFURAÇÕES', '88', 'Perfuração estacas', '2026-09-14', '2026-09-14', 'Programado', 'Confirmado', 1, 20000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-005', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-005');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-006', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-10-02', 'SUZANA LOCAÇÕES', '4415', 'Rolo compactador', '2026-10-02', '2026-10-02', 'Programado', 'Confirmado', 1, 6000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Movimentação de Terra.', 'planilha-faturamento', 'PAG-FD-006', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Equipamentos e locações'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-006');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-007', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-14', 'SUL MADEIRAS MATERIAIS PARA CONSTRUCAO LTDA', '1028', 'Pontaletes para Fundação', '2026-09-14', '2026-09-14', 'Programado', 'Confirmado', 1, 2248.5,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-007', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Outros custos diretos'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-007');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-008', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-05', 'PAIS E FILHOS TERRAPLANAGEM', '38', 'Terraplanagem', '2026-09-05', '2026-09-05', 'Programado', 'Confirmado', 1, 23000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Movimentação de Terra.', 'planilha-faturamento', 'PAG-FD-008', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-008');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-009', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-05', 'PAIS E FILHOS TERRAPLANAGEM', '38', 'Terraplanagem', '2026-09-05', '2026-09-05', 'Programado', 'Confirmado', 1, 7000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-009', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-009');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-010', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-08-20', 'JS ARMAÇÕES LTDA', '16', 'ARMAÇÃO FUNDAÇÃO', '2026-08-20', '2026-08-20', 'Programado', 'Confirmado', 1, 8515.2,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-010', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Aço e perfis'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-010');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-011', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-15', 'HUMBERTOSAMPAIOOLIVEIRA', '41', 'FURAÇÃO MINIPOÇO', '2026-09-15', '2026-09-15', 'Programado', 'Confirmado', 1, 3200,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-011', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Mão de obra terceirizada'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-011');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-012', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, '2026-09-10', 'MODO MODULAR', '48', 'CHAPAS DE BASE E CHUMBADORES FUNDAÇÃO', '2026-09-10', '2026-09-10', 'Programado', 'Confirmado', 1, 28730,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Estrutura Metálica.', 'planilha-faturamento', 'PAG-FD-012', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-06'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Componentes e fixadores'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-012');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-013', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, null, 'FERREIRA FERRO E AÇO', '33525', 'FERRAGEM FUNDAÇÃO', '2026-09-15', '2026-09-15', 'Programado', 'Confirmado', 1, 16500,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-013', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Aço e perfis'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-013');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-014', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, null, 'Mix Master Concreto Usinado Ltda', null, 'CONCRETO FUNDAÇÃO', '2026-09-16', '2026-09-16', 'Programado', 'Confirmado', 1, 65220,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-014', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Concreto e fundações'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-014');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-015', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, null, 'SUL MADEIRAS MATERIAIS PARA CONSTRUCAO LTDA', null, 'MADEIRAS FUNDAÇÃO', '2026-09-16', '2026-09-16', 'Rascunho', 'Estimado', 1, 5000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-015', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Outros custos diretos'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-015');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-016', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, null, 'A definir', null, 'BLOCO E CANALETA', '2026-09-16', '2026-09-16', 'Rascunho', 'Estimado', 1, 10000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Fundação e Arrimo.', 'planilha-faturamento', 'PAG-FD-016', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-05'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Outros custos diretos'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-016');

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'PAG-FD-017', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, null, 'REIFER DISTRIBUIDORA DE FERRAGENS E FERRAMENTAS LTDA', null, 'EPI- MATERIAIS DE CANTEIRO', '2026-09-16', '2026-09-16', 'Programado', 'Confirmado', 1, 2136.04,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx) · etapa Serviços Preliminares.', 'planilha-faturamento', 'PAG-FD-017', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-03'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Outros custos diretos'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'PAG-FD-017');

-- (3) Notas da construtora: uma NF cobre varias etapas, entao o titulo e unico e quem diz quanto foi faturado
--     em cada etapa e o rateio (entry_service_split). Nota ja existente no sistema so ganha o rateio; as demais
--     entram como recebiveis Programados, a conferir e conciliar com o extrato.

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'REC-FC-39', o.id, c.id, 'Real', 'Entrada', ca.id, 'Obra', p.id, 'MODO MODULAR', 'NF 39', '1ª Medição · NF 39', '2026-05-28', '2026-05-28', 'Programado', 'Confirmado', 1, 28350,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx). Conferir recebimento e conciliar com o extrato.', 'planilha-faturamento', 'REC-FC-39', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Medições de obras'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'REC-FC-39');

delete from entry_service_split where entry_id in (select e.id from financial_entry e join project p on p.id = e.project_id where p.code = 'OB-SF-CL-01' and e.code = 'REC-FC-39');
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '1ª Medição · Projetos Executivos', 28350, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-FC-39'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-01'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';

insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)
select 'REC-FC-43', o.id, c.id, 'Real', 'Entrada', ca.id, 'Obra', p.id, 'MODO MODULAR', 'NF 43', '2ª Medição · NF 43', '2026-08-12', '2026-08-12', 'Programado', 'Confirmado', 1, 36000,
  'Carga do acompanhamento de faturamento (ACOMPANHAMENTO_FATURAMENTO_INVEST_CESAR LATTES_R01.xlsx). Conferir recebimento e conciliar com o extrato.', 'planilha-faturamento', 'REC-FC-43', pr.id, pr.id
from organization o join company c on c.organization_id = o.id and c.code = o.code
  join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join chart_account ca on ca.organization_id = o.id and ca.category = 'Medições de obras'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = 'REC-FC-43');

delete from entry_service_split where entry_id in (select e.id from financial_entry e join project p on p.id = e.project_id where p.code = 'OB-SF-CL-01' and e.code = 'REC-FC-43');
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '2ª Medição · Administração / Mobilização', 12000, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-FC-43'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-02'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '2ª Medição · Serviços Preliminares', 12000, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-FC-43'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-03'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '2ª Medição · Movimentação de Terra', 12000, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-FC-43'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';

delete from entry_service_split where entry_id in (select e.id from financial_entry e join project p on p.id = e.project_id where p.code = 'OB-SF-CL-01' and e.code = 'REC-SF-CL-001');
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '3ª Medição · Projetos Executivos', 14175, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-SF-CL-001'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-01'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '3ª Medição · Administração / Mobilização', 16000, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-SF-CL-001'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-02'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '3ª Medição · Serviços Preliminares', 31800, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-SF-CL-001'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-03'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';
insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)
select o.id, e.id, p.id, s.id, '3ª Medição · Movimentação de Terra', 96000, pr.id
from organization o join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
  join financial_entry e on e.organization_id = o.id and e.code = 'REC-SF-CL-001'
  join project_service s on s.project_id = p.id and s.code = 'SFCL-04'
  join profile pr on pr.organization_id = o.id and pr.email = 'augusto@eiff.com.br'
where o.code = 'EIFF';


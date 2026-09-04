-- Proposta comercial 328 R02 (Modo, 05/05/2026) da obra OB-SF-CL-01: 81 itens com preco de venda
-- vinculados aos servicos do cronograma. Gerado por scripts/proposta-smartfit.mjs. Idempotente.
insert into estimate (organization_id, company_id, code, title, client_name, project_id, estimate_date, status, bdi, price_reference, notes)
select o.id, c.id, 'ORC-328', 'Proposta 328 R02 · Smart Fit César Lattes (BTS)', p.client_name, p.id, '2026-05-05', 'Contratado', 0,
  'Proposta Modo nº 328 R02 (preços de venda contratados)',
  'Itens transcritos do PDF PROPOSTA_BTS_SF_CESAR LATTES_R02. Total R$ 4.131.354,17. Custos por composição a vincular.'
from organization o
join company c on c.organization_id = o.id and c.code = o.code
join project p on p.organization_id = o.id and p.code = 'OB-SF-CL-01'
where o.code = 'EIFF' and not exists (select 1 from estimate e where e.organization_id = o.id and e.code = 'ORC-328');

delete from estimate_item where estimate_id in (select id from estimate where code = 'ORC-328');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 1, 'Etapa 1: Administrativo de obras', '1.1', 'Engenheiro civil de obra júnior (horista) [PU proposta R$ 121.99]', 'h', 192, 121.985677, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-02')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 2, 'Etapa 1: Administrativo de obras', '1.2', 'Encarregado geral de obras (mensalista)', 'mês', 4, 7494.8625, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-02')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 3, 'Etapa 1: Administrativo de obras', '1.4', 'Técnico em segurança do trabalho (horista) [PU proposta R$ 32.66]', 'h', 384, 32.6625, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-02')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 4, 'Etapa 1: Administrativo de obras', '1.5', 'Topógrafo com encargos complementares', 'mês', 1, 6833.84, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-02')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 5, 'Etapa 2: Serviços preliminares', '2.1', 'Locação de container 2,30 x 6,00 m, alt. 2,50 m, com 1 sanitário, para escritório, completo, sem divisórias internas (não inclui mobilização/desmobilização)', 'mês', 4, 915.9, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 6, 'Etapa 2: Serviços preliminares', '2.2', 'Locação de container 2,30 x 6,00 m, alt. 2,50 m, para sanitário, com 4 bacias, 8 chuveiros, 1 lavatório e 1 mictório (não inclui mobilização/desmobilização)', 'mês', 4, 1068.55, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 7, 'Etapa 2: Serviços preliminares', '2.3', 'Mobilização e desmobilização', 'un', 2, 1404.38, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 8, 'Etapa 2: Serviços preliminares', '2.4', 'Ligação provisória de luz e força', 'un', 1, 3358.3, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 9, 'Etapa 2: Serviços preliminares', '2.5', 'Ligação provisória de água, incluso retirada do esgoto sanitário', 'un', 1, 976.96, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 10, 'Etapa 2: Serviços preliminares', '2.6', 'Equipamento de proteção individual (EPI) e equipamento de proteção coletiva (EPC)', 'mês', 2, 1587.56, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 11, 'Etapa 2: Serviços preliminares', '2.7', 'Locação de equipamentos / ferramentas / caçamba de entulho', 'mês', 4, 1831.8, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 12, 'Etapa 2: Serviços preliminares', '2.8', 'Material de limpeza', 'mês', 4, 146.545, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 13, 'Etapa 2: Serviços preliminares', '2.10', 'Placa de obra (para construção civil) em chapa galvanizada n. 22, adesivada, de 2,4 x 1,2 m (sem postes para fixação)', 'm²', 4.32, 341.935185, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 14, 'Etapa 2: Serviços preliminares', '2.11', 'Transporte de entulho em caçamba estacionária, incluso a carga manual (entulho estimado em 5% da área total do terreno) [PU proposta R$ 113.01]', 'm³', 72.38, 113.013816, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 15, 'Etapa 2: Serviços preliminares', '2.12', 'Locação convencional de obra, utilizando gabarito de tábuas corridas pontaletadas a cada 2,00 m, 2 utilizações (af_03/2024) [PU proposta R$ 78.72]', 'm', 167.94, 78.71853, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 16, 'Etapa 2: Serviços preliminares', '2.13', 'Limpeza mecanizada de camada vegetal, vegetação e pequenas árvores (diâmetro de tronco menor que 0,20 m), com trator de esteiras [PU proposta R$ 9.82]', 'm²', 1447.65, 9.820841, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-03')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 17, 'Etapa 3: Movimentação de terra', '3.1', 'Aterro mecanizado de vala com minicarregadeira, com terra para aterro [PU proposta R$ 144.58]', 'm³', 1663.29, 144.577079, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-04')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 18, 'Etapa 4: Fundação e arrimo', '4.1.1', 'Estrutura principal: estaca escavada mecanicamente, sem fluido estabilizante, com 60 cm de diâmetro, concreto lançado por bomba lança (exclusive bombeamento, mobilização e desmobilização) (af_01/2020) [PU proposta R$ 369.85]', 'm', 416, 369.85262, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 19, 'Etapa 4: Fundação e arrimo', '4.1.2', 'Estrutura principal: fabricação, montagem e desmontagem de fôrma para bloco de coroamento, em madeira serrada, e=25 mm, 4 utilizações (af_01/2024) [PU proposta R$ 109.41]', 'm²', 225.5, 109.409268, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 20, 'Etapa 4: Fundação e arrimo', '4.1.3', 'Estrutura principal: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-60 de 5,0 mm, montagem (af_06/2022) [PU proposta R$ 20.11]', 'kg', 625.95, 20.113172, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 21, 'Etapa 4: Fundação e arrimo', '4.1.4', 'Estrutura principal: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-50 de 10,0 mm, montagem (af_06/2022) [PU proposta R$ 13.23]', 'kg', 2108, 13.225598, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 22, 'Etapa 4: Fundação e arrimo', '4.1.6', 'Estrutura principal: armação de bloco utilizando aço CA-50 de 6,3 mm, montagem (af_01/2024) [PU proposta R$ 21.10]', 'kg', 437.94, 21.102343, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 23, 'Etapa 4: Fundação e arrimo', '4.1.8', 'Estrutura principal: lançamento com uso de bomba, adensamento e acabamento de concreto em estruturas (af_02/2022) [PU proposta R$ 55.75]', 'm³', 157.7, 55.747749, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 24, 'Etapa 4: Fundação e arrimo', '4.6.2', 'Baldrame/arrimo: estaca escavada mecanicamente, sem fluido estabilizante, com 60 cm de diâmetro, concreto lançado por bomba lança (af_01/2020) [PU proposta R$ 369.85]', 'm', 180, 369.852611, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 25, 'Etapa 4: Fundação e arrimo', '4.6.3', 'Baldrame/arrimo: fôrma para bloco de coroamento, madeira serrada, e=25 mm, 4 utilizações (af_01/2024) [PU proposta R$ 109.41]', 'm²', 71.82, 109.407268, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 26, 'Etapa 4: Fundação e arrimo', '4.6.4', 'Baldrame/arrimo: fôrma para viga baldrame, madeira serrada, e=25 mm, 4 utilizações (af_01/2024)', 'm²', 91.2, 95.070395, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 27, 'Etapa 4: Fundação e arrimo', '4.6.5', 'Baldrame/arrimo: fabricação de fôrma para pilares e estruturas similares, madeira serrada, e=25 mm (af_09/2020) [PU proposta R$ 200.85]', 'm²', 118.2, 200.850761, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 28, 'Etapa 4: Fundação e arrimo', '4.6.6', 'Baldrame/arrimo: fabricação de fôrma para lajes, madeira serrada, e=25 mm (af_09/2020)', 'm²', 48.9, 97.170961, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 29, 'Etapa 4: Fundação e arrimo', '4.6.7', 'Baldrame/arrimo: concretagem de bloco de coroamento, fck 30 MPa, com bomba, lançamento, adensamento e acabamento (af_01/2024)', 'm³', 18.28, 1050.158643, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 30, 'Etapa 4: Fundação e arrimo', '4.6.8', 'Baldrame/arrimo: concretagem de viga baldrame, fck 30 MPa, com bomba, lançamento, adensamento e acabamento (af_01/2024)', 'm³', 28.4, 1050.158803, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 31, 'Etapa 4: Fundação e arrimo', '4.6.9', 'Baldrame/arrimo: concretagem de pilares, fck 25 MPa, com bomba, lançamento, adensamento e acabamento (af_02/2022)', 'm³', 12.96, 945.452932, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 32, 'Etapa 4: Fundação e arrimo', '4.6.10', 'Baldrame/arrimo: concretagem de vigas e lajes, fck 25 MPa, lajes pré-moldadas, com bomba (af_02/2022)', 'm³', 3.7, 974.932432, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 33, 'Etapa 4: Fundação e arrimo', '4.6.11', 'Baldrame/arrimo: concretagem de escadas, fck 25 MPa, com bomba, lançamento, adensamento e acabamento (af_02/2022)', 'm³', 10.73, 1040.291705, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 34, 'Etapa 4: Fundação e arrimo', '4.6.12', 'Baldrame/arrimo: armação de bloco utilizando aço CA-50 de 6,3 mm, montagem (af_01/2024) [PU proposta R$ 21.10]', 'kg', 272.94, 21.10233, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 35, 'Etapa 4: Fundação e arrimo', '4.6.13', 'Baldrame/arrimo: armação de escada, estrutura convencional de concreto armado, aço CA-50 de 6,3 mm, montagem (af_11/2020)', 'kg', 23.52, 24.240646, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 36, 'Etapa 4: Fundação e arrimo', '4.6.14', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 6,3 mm, montagem (af_06/2022) [PU proposta R$ 14.07]', 'kg', 147, 14.068231, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 37, 'Etapa 4: Fundação e arrimo', '4.6.15', 'Baldrame/arrimo: armação de pilar ou viga embutida em alvenaria de vedação, aço CA-50 de 10,0 mm, montagem (af_06/2022) [PU proposta R$ 14.30]', 'kg', 293.2, 14.300239, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 38, 'Etapa 4: Fundação e arrimo', '4.6.16', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-60 de 5,0 mm, montagem (af_06/2022)', 'kg', 115.87, 16.339691, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 39, 'Etapa 4: Fundação e arrimo', '4.6.17', 'Baldrame/arrimo: armação de escada, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_11/2020) [PU proposta R$ 18.65]', 'kg', 194.34, 18.647731, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 40, 'Etapa 4: Fundação e arrimo', '4.6.18', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_06/2022) [PU proposta R$ 12.83]', 'kg', 66.36, 12.83484, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 41, 'Etapa 4: Fundação e arrimo', '4.6.19', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_06/2022) [PU proposta R$ 13.52]', 'kg', 568.8, 13.518688, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 42, 'Etapa 4: Fundação e arrimo', '4.6.20', 'Baldrame/arrimo: armação de bloco utilizando aço CA-50 de 10 mm, montagem (af_01/2024) [PU proposta R$ 15.90]', 'kg', 799.48, 15.900098, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 43, 'Etapa 4: Fundação e arrimo', '4.6.21', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 10,0 mm, montagem (af_06/2022) [PU proposta R$ 11.21]', 'kg', 214.72, 11.210414, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 44, 'Etapa 4: Fundação e arrimo', '4.6.22', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 10,0 mm, montagem (af_06/2022) [PU proposta R$ 11.83]', 'kg', 1088.39, 11.833405, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 45, 'Etapa 4: Fundação e arrimo', '4.6.23', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 12,5 mm, montagem (af_06/2022) [PU proposta R$ 9.82]', 'kg', 231.12, 9.818449, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 46, 'Etapa 4: Fundação e arrimo', '4.6.24', 'Baldrame/arrimo: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-60 de 5,0 mm, montagem (af_06/2022) [PU proposta R$ 20.11]', 'kg', 980, 20.113163, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 47, 'Etapa 4: Fundação e arrimo', '4.6.25', 'Baldrame/arrimo: alvenaria de blocos de concreto estrutural 14x19x29 cm (espessura 14 cm), fbk 14 MPa, utilizando colher de pedreiro (af_10/2022) [PU proposta R$ 212.35]', 'm²', 168, 212.354464, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 48, 'Etapa 4: Fundação e arrimo', '4.6.26', 'Baldrame/arrimo: cinta com bloco canaleta, espessura de 15 cm [PU proposta R$ 83.62]', 'm', 240, 83.62075, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 49, 'Etapa 5: Impermeabilização', '5.1', 'Impermeabilização de superfície com emulsão asfáltica, 2 demãos (af_09/2023) [PU proposta R$ 45.11]', 'm²', 216, 45.1125, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 50, 'Etapa 5: Impermeabilização', '5.2', 'Aditivo impermeabilizante de pega normal para argamassas e concretos sem armação, líquido e isento de cloretos [PU proposta R$ 8.68]', 'l', 72, 8.675, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-05')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 51, 'Etapa 6: Instalações gerais', '6.1.1.1', 'Elétrica (estimativa): transformador trifásico de 225 kVA com suporte para instalação', 'un', 1, 76519.32, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 52, 'Etapa 6: Instalações gerais', '6.1.1.2', 'Elétrica (estimativa): assentamento de poste de concreto com comprimento nominal de 10 m, carga nominal de 1000 daN, engastamento base concretada com 1 m de concreto e 0,6 m de solo (não inclui fornecimento) (af_11/2019)', 'un', 1, 2135.66, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 53, 'Etapa 6: Instalações gerais', '6.1.1.3', 'Elétrica (estimativa): instalações elétricas', 'vb', 1, 82600, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 54, 'Etapa 6: Instalações gerais', '6.1.2.1', 'Projeto e execução de SPDA: estimativa de projeto, material e execução', 'vb', 1, 27140, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 55, 'Etapa 6: Instalações gerais', '6.2.3', 'Instalações hidrossanitárias: água fria, esgoto, pluvial e drenagem [PU proposta R$ 42.66]', 'm²', 1562.27, 42.657108, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 56, 'Etapa 6: Instalações gerais', '6.2.4', 'Dreno profundo (seção 0,50 x 1,50 m), cego, enchimento de brita, envolvido com manta geotêxtil (af_07/2021) [PU proposta R$ 207.04]', 'm', 70, 207.042857, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 57, 'Etapa 6: Instalações gerais', '6.3.1', 'Prevenção e combate a incêndio: projeto e execução', 'vb', 1, 70800, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 58, 'Etapa 6: Instalações gerais', '6.4.1', 'Instalação de gás: instalação básica (estimativa)', 'vb', 1, 10620, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-08')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 59, 'Etapa 7: Piso (térreo)', '7.11', 'Execução de piso industrial de concreto armado, fck 20 MPa, espessura de 14,0 cm (af_04/2022) [PU proposta R$ 184.22]', 'm²', 1447.65, 184.224999, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-12')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 60, 'Etapa 8: Piso térreo - steel deck', '8.1', 'Concreto usinado bombeável, classe de resistência C30, brita 0 e 1, slump 100 ± 20 mm, com bombeamento (disponibilização de bomba), sem o lançamento (NBR 8953) [PU proposta R$ 851.05]', 'm³', 92.63, 851.05074, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 61, 'Etapa 8: Piso térreo - steel deck', '8.2', 'Lançamento com uso de bomba, adensamento e acabamento de concreto em estruturas (af_02/2022) [PU proposta R$ 57.06]', 'm³', 92.63, 57.062507, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 62, 'Etapa 8: Piso térreo - steel deck', '8.3', 'Fabricação, montagem e desmontagem de fôrma para radier, piso de concreto ou laje sobre solo, madeira serrada, 4 utilizações (af_09/2021) [PU proposta R$ 168.39]', 'm²', 32.34, 168.387446, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 63, 'Etapa 8: Piso térreo - steel deck', '8.4', 'Chapa em aço galvanizado para steel deck, com nervuras trapezoidais, largura útil de 915 mm e espessura de 0,80 mm [PU proposta R$ 125.21]', 'm²', 823.38, 125.212271, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 64, 'Etapa 8: Piso térreo - steel deck', '8.5', 'Armação para execução de laje, com uso de tela Q-92 (ref. SINAPI) [PU proposta R$ 17.81]', 'kg', 1218.6, 17.808214, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 65, 'Etapa 8: Piso térreo - steel deck', '8.6', 'Eletrodo revestido AWS E7018, diâmetro 4,00 mm', 'kg', 28, 31.25, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 66, 'Etapa 8: Piso térreo - steel deck', '8.7', 'Pino stud welding 3/4" x 5.3/8" (19 x 110 mm)', 'un', 2480, 15.25, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-09')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 67, 'Etapa 10: Estrutura metálica', '10.1', 'Parafusos, porcas e arruelas', 'un', 6911.5, 2.5, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-06')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 68, 'Etapa 10: Estrutura metálica', '10.2', 'Chumbador 3/4" [PU proposta R$ 58.46]', 'un', 276, 58.4625, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-06')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 69, 'Etapa 10: Estrutura metálica', '10.3', 'Estrutura metálica "MODO" (fabricação e montagem) [PU proposta R$ 18.96]', 'kg', 72323.1, 18.9625, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-06')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 70, 'Etapa 10: Estrutura metálica', '10.4', 'Eletrodo revestido AWS E7018, diâmetro 4,00 mm [PU proposta R$ 31.25]', 'kg', 1655.11, 31.250038, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-06')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 71, 'Etapa 11: Vedação externa', '11.1', 'Isopainel PIR AP 50 mm microfrisado/liso RAL 9003 [PU proposta R$ 248.13]', 'm²', 1042.87, 248.124052, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-10')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 72, 'Etapa 11: Vedação externa', '11.2', 'Fechamento com telha trapezoidal TP-40, montagem incluso pintura [PU proposta R$ 80.85]', 'm²', 281.42, 80.845533, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-10')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 73, 'Etapa 12: Cobertura', '12.1', 'Telhamento com telha metálica isotelha e = 30 mm (PIR aço/filme), com até 2 águas, incluso içamento [PU proposta R$ 150.31]', 'm²', 1520.03, 150.311336, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-07')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 74, 'Etapa 12: Cobertura', '12.2', 'Instalação de cumeeira metálica trapezoidal (largura útil 0,98 m), incluso material e instalação [PU proposta R$ 94.68]', 'un', 43, 94.684651, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-07')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 75, 'Etapa 12: Cobertura', '12.3', 'Rufo externo/interno de chapa de aço galvanizado, corte de 80 cm, incluso içamento [PU proposta R$ 132.47]', 'm', 178.88, 132.32642, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-07')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 76, 'Etapa 12: Cobertura', '12.4', 'Calha em chapa de aço galvanizado nº 24, desenvolvimento de 100 cm, incluso transporte vertical (kit calha + suporte + fixadores e PU) (af_07/2019) [PU proposta R$ 180.11]', 'm', 113.15, 180.106142, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-07')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 77, 'Etapa 13: Pintura', '13.1', 'Pintura com tinta alquídica de acabamento (esmalte sintético acetinado) pulverizada sobre superfícies metálicas (exceto perfil), executada em obra, 2 demãos (af_01/2020) [PU proposta R$ 67.11]', 'm²', 3420, 67.1125, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-13')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 78, 'Etapa 13: Pintura', '13.2', 'Pintura de demarcação de vaga com tinta epóxi, e = 10 cm, aplicação manual (af_05/2021) [PU proposta R$ 8.47]', 'm', 495, 8.47501, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-13')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 79, 'Etapa 13: Pintura', '13.3', 'Aplicação manual de pintura com tinta texturizada acrílica em panos cegos de fachada (sem presença de vãos) de edifícios de múltiplos pavimentos, duas cores (af_03/2024) [PU proposta R$ 27.90]', 'm²', 394.04, 27.899706, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-13')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 80, 'Etapa 14: Transporte', '14.1', 'Custo de transporte por carga: transporte dos materiais, estrutura metálica e demais materiais para o canteiro de obras', 'un', 7, 6716.6, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-11')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');
insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, 81, 'Etapa 15: Serviços diversos', '15.1', 'Limpeza final de obra [PU proposta R$ 4.63]', 'm²', 2231.82, 4.625001, (select s.id from project_service s where s.project_id = e.project_id and s.code = 'SFCL-17')
from estimate e where e.code = 'ORC-328' and e.organization_id = (select id from organization where code = 'EIFF');

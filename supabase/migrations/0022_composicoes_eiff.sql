-- Composicoes proprias da EIFF (scripts/composicoes-eiff.mjs) para os itens do ORC-328 sem equivalente SINAPI.
-- Precos dos insumos proprios sao ESTIMATIVAS marcadas no campo notes/price_source. Idempotente.
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-01', 'Pino stud welding 3/4" x 5.3/8" (19 x 110 mm) para steel deck', 'un', 'Material', 9, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-02', 'Parafuso estrutural ASTM A325 com porca e arruela, bitola média (5/8" a 3/4")', 'un', 'Material', 1.8, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-03', 'Chumbador 3/4" x 300 mm com porca e arruela (fornecimento)', 'un', 'Material', 32, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-04', 'Isopainel PIR 50 mm microfrisado/liso RAL 9003 (fornecimento)', 'm²', 'Material', 165, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-05', 'Acessórios de fixação e vedação de painel isotérmico (parafusos, fitas, silicone), por m²', 'm²', 'Material', 8, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-06', 'Custo fabril por kg de estrutura (energia, gases, consumíveis miúdos, depreciação de máquinas)', 'kg', 'Outros', 0.6, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-07', 'Kit EPI/EPC mensal para equipe de 10 pessoas (reposição e coletivos)', 'mês', 'Material', 1200, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-08', 'Locação mensal de ferramentas e equipamentos leves (furadeiras, esmerilhadeiras, andaimes, extensões)', 'mês', 'Equipamento', 1500, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-09', 'Material de limpeza de canteiro (mês)', 'mês', 'Material', 120, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-10', 'Locação de caçamba estacionária 5 m³ com retirada e destinação', 'un', 'Serviço', 350, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-11', 'Material para ligação provisória de energia (padrão de entrada, disjuntor, cabos, quadro)', 'vb', 'Material', 1800, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-12', 'Material para ligação provisória de água (tubos, registro, caixa, conexões)', 'vb', 'Material', 450, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-15', 'Material de limpeza final de obra, por m²', 'm²', 'Material', 0.3, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-20', 'Subempreitada de instalações elétricas (verba)', 'vb', 'Serviço', 70210, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-21', 'Subempreitada de projeto e execução de SPDA (verba)', 'vb', 'Serviço', 23069, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-22', 'Subempreitada de instalações hidrossanitárias (água fria, esgoto, pluvial e drenagem), por m²', 'm²', 'Serviço', 36.26, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-23', 'Subempreitada de projeto e execução de prevenção e combate a incêndio (verba)', 'vb', 'Serviço', 60180, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-INS-24', 'Subempreitada de instalação básica de gás (verba)', 'vb', 'Serviço', 9027, '2026-09-04', 'Estimativa EIFF', 'Estimativa', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-FAB-KG', 'Fabricação de estrutura metálica em perfis laminados e chapas soldadas, por kg (fábrica EIFF), inclusive fundo anticorrosivo', 'kg', 'Estrutura metálica EIFF', 'Índices: aço 1,05 kg/kg; 17,5 HH/t na fábrica; primer 0,15 l/m² em 30 m²/t. ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-FAB-KG');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '43082', 'I', 0.75),
(2, 'SINAPI', '1332', 'I', 0.3),
(3, 'SINAPI', '10997', 'I', 0.015),
(4, 'SINAPI', '44495', 'I', 0.0015),
(5, 'SINAPI', '7307', 'I', 0.005),
(6, 'SINAPI', '88317', 'C', 0.004),
(7, 'SINAPI', '88315', 'C', 0.004),
(8, 'SINAPI', '88240', 'C', 0.006),
(9, 'SINAPI', '88278', 'C', 0.002),
(10, 'SINAPI', '88310', 'C', 0.0015),
(11, 'Própria', 'EIFF-INS-06', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-FAB-KG'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-MON-KG', 'Montagem de estrutura metálica em obra, por kg (içamento, aprumo, parafusamento e solda de campo)', 'kg', 'Estrutura metálica EIFF', 'Índices: 26 HH/t em campo; guindaste 1,2 h/t; plataforma 3 h/t. ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-MON-KG');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '88278', 'C', 0.012),
(2, 'SINAPI', '88240', 'C', 0.012),
(3, 'SINAPI', '88317', 'C', 0.002),
(4, 'SINAPI', '89272', 'C', 0.0012),
(5, 'SINAPI', '102886', 'C', 0.003),
(6, 'SINAPI', '10997', 'I', 0.002)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-MON-KG'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-EST-KG', 'Estrutura metálica fabricada, transportada internamente e montada, por kg (EIFF)', 'kg', 'Estrutura metálica EIFF', 'Soma de fabricação e montagem. Transporte externo e parafusos/chumbadores em itens próprios da proposta.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-EST-KG');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-FAB-KG', 'C', 1),
(2, 'Própria', 'EIFF-MON-KG', 'C', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-EST-KG'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-STUD', 'Pino stud welding 3/4" x 5.3/8" soldado em viga para steel deck, por unidade', 'un', 'Estrutura metálica EIFF', 'Máquina stud 0,02 h/un e soldador 0,03 h/un. ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-STUD');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-01', 'I', 1),
(2, 'SINAPI', '102868', 'C', 0.02),
(3, 'SINAPI', '88317', 'C', 0.03)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-STUD'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-PARAF', 'Parafuso estrutural ASTM A325 com porca e arruela, aplicado e torqueado, por unidade', 'un', 'Estrutura metálica EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-PARAF');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-02', 'I', 1),
(2, 'SINAPI', '88278', 'C', 0.02)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-PARAF'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-CHUMB', 'Chumbador 3/4" com porca e arruela, posicionado e nivelado na fundação, por unidade', 'un', 'Estrutura metálica EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-CHUMB');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-03', 'I', 1),
(2, 'SINAPI', '88278', 'C', 0.2),
(3, 'SINAPI', '88240', 'C', 0.2)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-CHUMB'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-ISOP', 'Isopainel PIR 50 mm microfrisado/liso RAL 9003, fornecimento e montagem em fechamento, por m²', 'm²', 'Vedação e cobertura EIFF', 'Montagem 0,5 HH/m² e plataforma 0,04 h/m². ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-ISOP');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-04', 'I', 1),
(2, 'Própria', 'EIFF-INS-05', 'I', 1),
(3, 'SINAPI', '88278', 'C', 0.25),
(4, 'SINAPI', '88240', 'C', 0.25),
(5, 'SINAPI', '102886', 'C', 0.04)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-ISOP'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-CUMEEIRA', 'Cumeeira metálica trapezoidal, peça de 3,00 m com largura útil 0,98 m, instalada, por unidade', 'un', 'Vedação e cobertura EIFF', 'Composição SINAPI de cumeeira por metro x 3,00 m por peça.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-CUMEEIRA');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '100326', 'C', 3)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-CUMEEIRA'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-RUFO-80', 'Rufo externo/interno em chapa de aço galvanizado nº 26, corte de 80 cm, instalado com içamento, por m', 'm', 'Vedação e cobertura EIFF', 'Chapa proporcional ao corte (80/33); telhadista 0,3 h/m. ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-RUFO-80');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '1113', 'I', 2.42),
(2, 'SINAPI', '88323', 'C', 0.3),
(3, 'SINAPI', '88240', 'C', 0.3),
(4, 'SINAPI', '102886', 'C', 0.05)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-RUFO-80'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-TRANSP', 'Transporte de carga de estrutura metálica da fábrica ao canteiro, viagem de caminhão trucado com carga e descarga', 'un', 'Logística EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-TRANSP');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '91031', 'C', 16),
(2, 'SINAPI', '88240', 'C', 24),
(3, 'SINAPI', '88286', 'C', 8)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-TRANSP'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-LIMP-FINAL', 'Limpeza final de obra, por m²', 'm²', 'Canteiro EIFF', 'Servente 0,10 h/m². ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIMP-FINAL');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '88316', 'C', 0.1),
(2, 'Própria', 'EIFF-INS-15', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-LIMP-FINAL'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-MOB', 'Mobilização e desmobilização de equipe e equipamentos, por evento', 'un', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-MOB');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'SINAPI', '91031', 'C', 5),
(2, 'SINAPI', '88240', 'C', 8),
(3, 'SINAPI', '88278', 'C', 4)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-MOB'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-LIG-LUZ', 'Ligação provisória de luz e força, por unidade', 'un', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIG-LUZ');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-11', 'I', 1),
(2, 'SINAPI', '88264', 'C', 16),
(3, 'SINAPI', '88247', 'C', 16)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-LIG-LUZ'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-LIG-AGUA', 'Ligação provisória de água, inclusive retirada do esgoto sanitário, por unidade', 'un', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIG-AGUA');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-12', 'I', 1),
(2, 'SINAPI', '88267', 'C', 8),
(3, 'SINAPI', '88248', 'C', 8)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-LIG-AGUA'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-EPI-MES', 'EPI e EPC para a equipe, por mês', 'mês', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-EPI-MES');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-07', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-EPI-MES'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-LOC-EQUIP', 'Locação de equipamentos, ferramentas e caçamba, por mês', 'mês', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LOC-EQUIP');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-08', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-LOC-EQUIP'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-LIMP-MES', 'Material de limpeza de canteiro, por mês', 'mês', 'Canteiro EIFF', 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIMP-MES');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-09', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-LIMP-MES'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-ENTULHO', 'Transporte de entulho em caçamba estacionária 5 m³, inclusive carga manual, por m³', 'm³', 'Canteiro EIFF', 'Uma caçamba a cada 5 m³; servente 0,8 h/m³. ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-ENTULHO');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-10', 'I', 0.2),
(2, 'SINAPI', '88316', 'C', 0.8)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-ENTULHO'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-SUB-ELET', 'Instalações elétricas por subempreitada (verba)', 'vb', 'Subempreitadas', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-ELET');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-20', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-SUB-ELET'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-SUB-SPDA', 'Projeto e execução de SPDA por subempreitada (verba)', 'vb', 'Subempreitadas', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-SPDA');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-21', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-SUB-SPDA'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-SUB-HIDRO', 'Instalações hidrossanitárias por subempreitada, por m²', 'm²', 'Subempreitadas', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-HIDRO');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-22', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-SUB-HIDRO'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-SUB-INC', 'Prevenção e combate a incêndio por subempreitada (verba)', 'vb', 'Subempreitadas', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-INC');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-23', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-SUB-INC'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values ((select id from organization where code = 'EIFF'), 'Própria', 'EIFF-SUB-GAS', 'Instalação básica de gás por subempreitada (verba)', 'vb', 'Subempreitadas', 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.', true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-GAS');
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values
(1, 'Própria', 'EIFF-INS-24', 'I', 1)) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = (select id from organization where code = 'EIFF') and c.source = 'Própria' and c.code = 'EIFF-SUB-GAS'
left join catalog_input i on v.k = 'I' and i.organization_id = (select id from organization where code = 'EIFF') and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = (select id from organization where code = 'EIFF') and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-MOB') where code = '2.3' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIG-LUZ') where code = '2.4' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIG-AGUA') where code = '2.5' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-EPI-MES') where code = '2.6' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LOC-EQUIP') where code = '2.7' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIMP-MES') where code = '2.8' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-ENTULHO') where code = '2.11' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-ELET') where code = '6.1.1.3' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-SPDA') where code = '6.1.2.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-HIDRO') where code = '6.2.3' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-INC') where code = '6.3.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-SUB-GAS') where code = '6.4.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-STUD') where code = '8.7' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-PARAF') where code = '10.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-CHUMB') where code = '10.2' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-EST-KG') where code = '10.3' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-ISOP') where code = '11.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-CUMEEIRA') where code = '12.2' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-RUFO-80') where code = '12.3' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-TRANSP') where code = '14.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');
update estimate_item set composition_id = (select id from catalog_composition where organization_id = (select id from organization where code = 'EIFF') and source = 'Própria' and code = 'EIFF-LIMP-FINAL') where code = '15.1' and estimate_id = (select id from estimate where organization_id = (select id from organization where code = 'EIFF') and code = 'ORC-328');

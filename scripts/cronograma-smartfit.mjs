// Gera supabase/migrations/0014_smartfit_cronograma.sql a partir do cronograma fisico-financeiro do contrato
// Invest Market / Modo Modular - Smart Fit Cesar Lattes (03. CRONOGRAMA FISICO FINANCEIRO.pdf, rev. contraproposta).
// Regras: retencao contratual = 10% do bruto; recebivel da EIFF por evento = faturamento construtora - 10%.
// Mes contratual 01 = junho/2026 (E03, E05, E06 e E07 foram medidos na NF 47 de 01/09/2026).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBRA = 'OB-SF-CL-01';
const MES1 = { ano: 2026, mes: 6 };
const fimMes = (n) => { const d = new Date(Date.UTC(MES1.ano, MES1.mes - 1 + (n - 1) + 1, 0)); return d.toISOString().slice(0, 10); };

// etapa -> [codigo, nome, fase do sistema, valor base orcamento original]
const ETAPAS = {
  'Projetos Executivos': ['SFCL-01', 'Projetos executivos', 'Projeto', 63000],
  'Administração / Mobilização': ['SFCL-02', 'Administração e mobilização do canteiro', 'Outros', 72776.94],
  'Serviços Preliminares': ['SFCL-03', 'Serviços preliminares e instalações temporárias', 'Civil', 63264.55],
  'Movimentação de Terra': ['SFCL-04', 'Movimentação de terra e regularização', 'Civil', 240473.61],
  'Fundação e Arrimo': ['SFCL-05', 'Fundação, baldrames e arrimos', 'Civil', 557042.70],
  'Estrutura Metálica': ['SFCL-06', 'Estrutura metálica: aço, fabricação e montagem', 'Fabricação', 1456563.44],
  'Cobertura': ['SFCL-07', 'Cobertura metálica', 'Cobertura e fechamento', 276598.74],
  'Instalações Gerais': ['SFCL-08', 'Instalações elétricas, SPDA, hidrossanitárias e incêndio', 'Instalações', 350949.89],
  'Steel Deck': ['SFCL-09', 'Laje steel deck', 'Civil', 253057.55],
  'Vedação Externa': ['SFCL-10', 'Vedação externa (isopainéis e fechamentos)', 'Cobertura e fechamento', 281512.68],
  'Estrutura/Cobertura/Transporte': ['SFCL-11', 'Logística, transporte e conclusão de montagem', 'Montagem', 47016.20],
  'Piso Industrial': ['SFCL-12', 'Piso industrial', 'Civil', 266693.32],
  'Pintura': ['SFCL-13', 'Pintura industrial e demarcações', 'Pintura', 244713.48],
  'Instalações / Acabamentos': ['SFCL-14', 'Instalações finais e arremates', 'Instalações', null],
  'Acabamentos / Testes': ['SFCL-15', 'Finalizações e testes operacionais', 'Outros', null],
  'Acabamentos / Pré-entrega': ['SFCL-16', 'Pré-entrega e fechamento de pendências', 'Outros', null],
  'Entrega Final': ['SFCL-17', 'Entrega técnica, as built e desmobilização', 'Outros', 10322.17],
};

// [numero, mes, etapa, evento, escopo, criterio, documentos, bruto, direto, construtora, retencao, tipo, aprovacao, pctPlanejada, status, obs]
const EVENTOS = [
  ['E01', 1, 'Projetos Executivos', 'Kickoff, compatibilização inicial e cronograma macro', 'Reunião de partida, matriz de responsabilidades, cronograma macro, levantamento de interferências e diretrizes de suprimentos.', 'Cronograma preliminar e matriz de responsabilidades aprovados.', 'Ata de kickoff, cronograma preliminar, matriz de pendências e relatório técnico inicial.', 15750, 0, 15750, 1575, 'Entrega técnica', 'Contratante / Fiscalização', 0.0038, 'Pendente', ''],
  ['E02', 1, 'Projetos Executivos', 'Desenvolvimento inicial dos projetos executivos', 'Desenvolvimento das disciplinas executivas, compatibilização inicial e consolidação dos quantitativos preliminares.', 'Projetos em revisão inicial protocolados e compatibilização inicial entregue.', 'Pranchas em revisão, memorial técnico preliminar e relatório de compatibilização.', 15750, 0, 15750, 1575, 'Entrega técnica', 'Contratante / Fiscalização', 0.0038, 'Pendente', ''],
  ['E03', 2, 'Projetos Executivos', 'Planejamento executivo final e equalização técnica', 'Consolidação do planejamento executivo, planejamento de fabricação, logística, suprimentos e sequenciamento da obra.', 'Planejamento executivo final aprovado.', 'Plano executivo, cronograma atualizado, matriz de fornecedores e planejamento de suprimentos.', 15750, 0, 15750, 1575, 'Entrega técnica', 'Contratante / Fiscalização', 0.0038, 'Faturado', 'Medido na NF 47 (01/09/2026).'],
  ['E04', 2, 'Projetos Executivos', 'Liberação técnica para produção e mobilização', 'Liberação final de desenhos, diretrizes de fabricação, premissas de montagem e liberação para mobilização.', 'Desenhos liberados para produção/mobilização.', 'Desenhos liberados, relatório de liberação e aceite técnico.', 15750, 0, 15750, 1575, 'Entrega técnica', 'Contratante / Fiscalização', 0.0038, 'Pendente', ''],
  ['E05', 3, 'Administração / Mobilização', 'Mobilização do canteiro e administração inicial', 'Implantação do canteiro, containers, ligações provisórias, estrutura de apoio, equipe inicial e gestão operacional.', 'Canteiro funcional implantado.', 'Relatório fotográfico, check-list de mobilização, evidências de canteiro funcional.', 120000, 0, 120000, 12000, 'Evento físico', 'Fiscalização', 0.0293, 'Faturado', 'Medido na NF 47 (01/09/2026).'],
  ['E06', 3, 'Serviços Preliminares', 'Serviços preliminares e instalações temporárias', 'Locações, proteções, equipamentos iniciais, limpeza, placa de obra, ligações provisórias e apoio operacional.', 'Serviços preliminares executados conforme escopo.', 'Relatório fotográfico, diário de obra e check-list de serviços preliminares.', 82000, 30000, 52000, 8200, 'Evento físico/documental', 'Fiscalização', 0.02, 'Faturado', 'Medido na NF 47 (01/09/2026).'],
  ['E07', 3, 'Movimentação de Terra', 'Terraplenagem e regularização inicial', 'Movimentação de terra, aterro, regularização de áreas, preparação de plataformas e infraestrutura inicial.', 'Terraplenagem e regularização executadas conforme frente liberada.', 'Relatório de volume/área executada, fotos, diário de obra e validação topográfica quando aplicável.', 110000, 50000, 60000, 11000, 'Percentual físico', 'Fiscalização', 0.0537, 'Faturado', 'Medido na NF 47 (01/09/2026). Contraproposta: terraplenagem dividida 50% M3 e 50% M4.'],
  ['E08', 3, 'Fundação e Arrimo', 'Fundação inicial', 'Início das estacas, blocos, armaduras, concretagens e liberação parcial para continuidade estrutural.', 'Fundação inicial executada e registrada.', 'Fotos, diário de concretagem, controle tecnológico quando aplicável e relatório de avanço físico.', 68000, 0, 68000, 6800, 'Percentual físico', 'Fiscalização', 0.0317, 'Pendente', 'Contraproposta: reduzida de R$ 130k para R$ 68k.'],
  ['E07b', 4, 'Movimentação de Terra', 'Conclusão da terraplenagem e regularização', 'Conclusão do aterro, regularização de áreas e infraestrutura de plataforma, segunda metade do volume contratado.', 'Volume real executado validado por topografia, 50% restante do aterro contratado.', 'Relatório de volume executado, fotos, diário de obra e validação topográfica.', 110000, 50000, 60000, 11000, 'Percentual físico', 'Fiscalização', 0.0268, 'Pendente', 'Contraproposta: segunda metade da terraplenagem.'],
  ['E09', 4, 'Fundação e Arrimo', 'Conclusão das fundações, baldrames e arrimos', 'Conclusão de estacas, blocos, vigas baldrame, arrimos, armaduras e concretagens estruturais.', 'Fundações, baldrames e arrimos liberados para montagem.', 'Relatório de avanço, fotos, diário de concretagem, check-list de liberação estrutural.', 150000, 50000, 100000, 15000, 'Percentual físico', 'Fiscalização', 0.0634, 'Pendente', 'Contraproposta: ajustada para R$ 150k, absorve saldo da fundação inicial.'],
  ['E10', 4, 'Estrutura Metálica', 'Compra estratégica de aço e insumos metálicos', 'Aquisição de matéria-prima metálica, perfis, chapas, chumbadores e insumos industriais de fabricação.', 'Compra/reserva de aço e insumos comprovada documentalmente.', 'Pedido de compra, nota fiscal, comprovante de pedido, romaneio ou evidência de reserva/compra.', 175000, 175000, 0, 17500, 'Fornecimento direto', 'Contratante / Suprimentos', 0.0634, 'Pendente', 'Contraproposta: adiantamento de aço reduzido de R$ 260k para R$ 175k. 100% faturamento direto.'],
  ['E11', 4, 'Estrutura Metálica', 'Fabricação industrial da estrutura metálica - fase 01', 'Corte, preparação, soldagem, montagem fabril, chumbadores, peças primárias e controle produtivo.', 'Fabricação fase 01 comprovada por relatório fabril.', 'Relatório fabril, fotos de produção, romaneio parcial e controle de qualidade.', 185000, 145000, 40000, 18500, 'Fabricação', 'Fiscalização / Qualidade', 0.0451, 'Pendente', ''],
  ['E12', 5, 'Estrutura Metálica', 'Fabricação industrial da estrutura metálica - fase 02', 'Continuidade da fabricação metálica, estrutura secundária, travamentos, preparação para pintura e expedição.', 'Fabricação fase 02 comprovada por relatório fabril.', 'Relatório fabril, fotos, romaneio, controle de qualidade e evidência de avanço produtivo.', 230000, 200000, 30000, 23000, 'Fabricação', 'Fiscalização / Qualidade', 0.0561, 'Pendente', ''],
  ['E13', 5, 'Estrutura Metálica', 'Montagem metálica principal', 'Transporte interno, içamento, posicionamento de pórticos, ligações metálicas, alinhamento e travamentos.', 'Montagem metálica principal com avanço físico validado.', 'Relatório fotográfico, diário de montagem, check-list de segurança e avanço físico.', 210000, 100000, 110000, 21000, 'Percentual físico', 'Fiscalização', 0.0512, 'Pendente', ''],
  ['E14', 5, 'Cobertura', 'Fornecimento e início da cobertura metálica', 'Telhas termoacústicas, calhas, rufos, arremates e início da instalação de cobertura.', 'Materiais de cobertura entregues e início de instalação comprovado.', 'NF/romaneio de materiais, fotos de entrega e instalação, relatório de avanço.', 190000, 185000, 5000, 19000, 'Fornecimento + execução', 'Fiscalização', 0.0549, 'Pendente', 'Contraproposta: R$ 35k de cobertura realocados para M6.'],
  ['E15', 5, 'Instalações Gerais', 'Instalações elétricas e SPDA - fase 01', 'Infraestrutura elétrica inicial, entrada elétrica, aterramentos, eletrodutos, quadros e SPDA inicial.', 'Infraestrutura elétrica/SPDA fase 01 executada.', 'Relatório técnico, fotos, diário de obra e check-list das instalações executadas.', 150000, 130000, 20000, 15000, 'Percentual físico', 'Fiscalização', 0.0366, 'Pendente', ''],
  ['E16', 6, 'Steel Deck', 'Fornecimento e execução de steel deck', 'Fornecimento de chapas, pinos, armaduras, concretagem e execução de laje steel deck.', 'Steel deck executado conforme avanço físico.', 'NF/romaneio, fotos, diário de concretagem, relatório de avanço físico.', 285000, 245000, 40000, 28500, 'Fornecimento + execução', 'Fiscalização', 0.061, 'Pendente', 'Contraproposta: absorve R$ 35k da cobertura realocados do M5.'],
  ['E17', 6, 'Vedação Externa', 'Fornecimento e montagem de vedação externa', 'Isopainéis, fechamentos metálicos, vedações laterais, arremates e acessórios.', 'Vedação externa executada conforme área medida.', 'NF/romaneio, fotos, relatório de área executada e aceite parcial.', 255000, 220000, 35000, 25500, 'Fornecimento + execução', 'Fiscalização', 0.0622, 'Pendente', ''],
  ['E18', 6, 'Instalações Gerais', 'Instalações hidrossanitárias, drenagem e incêndio', 'Água fria, esgoto, drenagem, pluvial, combate a incêndio, gás e complementos de instalações.', 'Instalações hidrossanitárias/drenagem/incêndio executadas por percentual validado.', 'Relatório técnico, fotos, testes parciais e diário de obra.', 185000, 130000, 55000, 18500, 'Percentual físico', 'Fiscalização', 0.0451, 'Pendente', ''],
  ['E19', 6, 'Estrutura/Cobertura/Transporte', 'Logística, transporte e conclusão de montagem', 'Fretes estruturais, entrega de materiais, ajustes de montagem, travamentos e arremates estruturais.', 'Logística e conclusão de montagem comprovadas por romaneio e fotos.', 'CT-e/NF, romaneios, fotos, relatório logístico e check-list de montagem.', 95000, 35000, 60000, 9500, 'Evento físico/documental', 'Fiscalização', 0.0256, 'Pendente', 'Contraproposta: ajuste de R$ 105k para R$ 95k.'],
  ['E20', 7, 'Piso Industrial', 'Execução de piso industrial', 'Piso industrial armado, preparo de base, concretagem, acabamento superficial e juntas.', 'Piso industrial executado conforme área liberada.', 'Relatório de concretagem, fotos, diário de obra e check-list de liberação.', 260000, 180000, 80000, 26000, 'Percentual físico', 'Fiscalização', 0.0634, 'Pendente', ''],
  ['E21', 7, 'Pintura', 'Pintura industrial e demarcações', 'Pintura de superfícies metálicas, demarcações, acabamentos de pintura e correções.', 'Pintura e demarcações executadas conforme área medida.', 'Fotos, relatório de área executada, check-list de acabamento e aceite parcial.', 205000, 150000, 55000, 20500, 'Percentual físico', 'Fiscalização', 0.05, 'Pendente', ''],
  ['E22', 7, 'Instalações / Acabamentos', 'Instalações finais e arremates executivos', 'Finalização de instalações, arremates, testes parciais, correções e preparação para comissionamento.', 'Instalações finais e arremates executados conforme check-list.', 'Relatório técnico, fotos, diário de obra e check-list de pendências.', 175000, 70000, 105000, 17500, 'Percentual físico', 'Fiscalização', 0.0317, 'Pendente', 'Contraproposta: aumentado de R$ 130k para R$ 175k.'],
  ['E23', 8, 'Acabamentos / Testes', 'Finalizações executivas e testes operacionais', 'Ajustes finais, pinturas finais, testes de instalações, comissionamento e correções operacionais.', 'Testes operacionais e finalizações validados.', 'Relatório de testes, check-list de comissionamento, fotos e lista de pendências.', 215000, 160000, 55000, 21500, 'Evento físico', 'Fiscalização / Contratante', 0.0524, 'Pendente', 'Contraproposta: mantido em R$ 215k.'],
  ['E24', 8, 'Acabamentos / Pré-entrega', 'Pré-entrega e fechamento de pendências', 'Pré-entrega técnica, ajustes finais, validações de campo, arremates e liberação para entrega final.', 'Pré-entrega e fechamento de pendências validados.', 'Check-list de pré-entrega, relatório fotográfico e aceite parcial.', 245000, 180000, 65000, 24500, 'Evento físico', 'Contratante / Fiscalização', 0.0415, 'Pendente', 'Contraproposta: aumentado de R$ 170k para R$ 245k.'],
  ['E25', 9, 'Entrega Final', 'Entrega técnica, limpeza final e desmobilização', 'Limpeza final, entrega documental, as built, desmobilização e termo de entrega técnica.', 'Termo de entrega técnica emitido.', 'Termo de entrega, as built, check-list final, relatório fotográfico e documentação de encerramento.', 337000, 187000, 150000, 33700, 'Entrega final', 'Contratante', 0.0463, 'Pendente', 'Contraproposta: aumentado de R$ 190k para R$ 337k.'],
];

const q = (v) => (v === undefined || v === null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === undefined || v === null ? 'null' : Number(v));
const org = `(select id from organization where code = 'EIFF')`;
const proj = `(select id from project where code = '${OBRA}')`;
const srv = (etapa) => `(select id from project_service where project_id = ${proj} and code = '${ETAPAS[etapa][0]}')`;

// totais por etapa
const porEtapa = {};
for (const e of EVENTOS) {
  const [, mes, etapa, , , , , bruto, direto, constr, ret] = e;
  const t = (porEtapa[etapa] ??= { liquido: 0, direto: 0, bruto: 0, ini: 99, fim: 0 });
  const pctRet = bruto ? ret / bruto : 0;
  t.liquido += constr * (1 - pctRet);
  t.direto += direto;
  t.bruto += bruto;
  t.ini = Math.min(t.ini, mes);
  t.fim = Math.max(t.fim, mes);
}

let sql = `-- Cronograma fisico-financeiro Smart Fit Cesar Lattes (gerado por scripts/cronograma-smartfit.mjs em ${new Date().toISOString().slice(0, 10)})
-- Fonte: 03. CRONOGRAMA FISICO FINANCEIRO.pdf (rev. contraproposta). Retencao 10%; mes 01 = junho/2026.
update project set starts_at = coalesce(starts_at, '2026-06-01'), contractual_end = coalesce(contractual_end, '${fimMes(9)}'), target_margin = coalesce(target_margin, 0.25),
  scope = coalesce(nullif(scope,''), 'Execução da unidade Smart Fit em regime de empreitada global Turn Key') where code = '${OBRA}';

-- os servicos SFCL-01..06 derivados da planilha sao substituidos (mesmo codigo) pelas etapas do cronograma;
-- as receitas "mao de obra" perdem o vinculo (nao ha etapa equivalente) e as demais sao religadas pelo nome abaixo
update financial_entry e set service_id = null where e.project_id = ${proj} and e.description ilike '%mão de obra%';
`;
for (const [etapa, [code, nome, fase, base]] of Object.entries(ETAPAS)) {
  const t = porEtapa[etapa];
  sql += `insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, sale_direct, budget_base, planned_start, planned_end, status, notes, active)
values (${org}, ${proj}, '${code}', ${q(nome)}, ${q(fase)}, 'vb', 1, 0, 0, ${t.liquido.toFixed(2)}, ${t.direto.toFixed(2)}, ${n(base)}, '${fimMes(t.ini - 1).slice(0, 8)}01', '${fimMes(t.fim)}', 'Não iniciado', 'Etapa do cronograma contratual: ${etapa}. Preço = faturamento da construtora líquido de retenção (10%).', true)
on conflict (project_id, code) do update set name = excluded.name, phase = excluded.phase, sale_price = excluded.sale_price, sale_direct = excluded.sale_direct, budget_base = excluded.budget_base, planned_start = excluded.planned_start, planned_end = excluded.planned_end, active = true;\n`;
}
sql += '\n-- eventos de medicao\n';
for (const e of EVENTOS) {
  const [num, mes, etapa, evento, escopo, criterio, docs, bruto, direto, constr, ret, tipo, aprov, pct, status, obs] = e;
  const medido = status !== 'Pendente';
  sql += `insert into measurement (organization_id, project_id, service_id, number, kind, period_start, period_end, amount, status, month_no, stage, title, scope, criteria, documents, approver, planned_on, gross_amount, direct_amount, contractor_amount, retention_amount, planned_progress, measured_on, entry_id, notes)
values (${org}, ${proj}, ${srv(etapa)}, '${num}', ${q(tipo)}, '${fimMes(mes - 1).slice(0, 8)}01', '${fimMes(mes)}', ${constr}, ${q(status)}, ${mes}, ${q(etapa)}, ${q(evento)}, ${q(escopo)}, ${q(criterio)}, ${q(docs)}, ${q(aprov)}, '${fimMes(mes)}', ${bruto}, ${direto}, ${constr}, ${ret}, ${pct}, ${medido ? "'2026-09-01'" : 'null'}, ${medido ? "(select id from financial_entry where code = 'REC-SF-CL-001')" : 'null'}, ${q(obs)})
on conflict (project_id, number) do update set service_id = excluded.service_id, stage = excluded.stage, title = excluded.title, gross_amount = excluded.gross_amount, direct_amount = excluded.direct_amount, contractor_amount = excluded.contractor_amount, retention_amount = excluded.retention_amount, planned_on = excluded.planned_on;\n`;
}
sql += `
-- religa as receitas previstas da planilha aos servicos do cronograma (pelo nome)
update financial_entry e set service_id = ${srv('Estrutura Metálica')} where e.project_id = ${proj} and e.description ilike '%estrutura met%';
update financial_entry e set service_id = ${srv('Pintura')} where e.project_id = ${proj} and e.description ilike '%pintura%';
update financial_entry e set service_id = ${srv('Cobertura')} where e.project_id = ${proj} and e.description ilike '%telha%';
update financial_entry e set service_id = ${srv('Piso Industrial')} where e.project_id = ${proj} and e.description ilike '%concreto piso%';
update financial_entry e set service_id = ${srv('Steel Deck')} where e.project_id = ${proj} and e.description ilike '%steel deck%';
update financial_entry e set service_id = null where e.project_id = ${proj} and e.service_id in (select id from project_service where project_id = ${proj} and active = false);
`;
fs.writeFileSync(path.join(root, 'supabase', 'migrations', '0014_smartfit_cronograma.sql'), sql);
const totalLiq = Object.values(porEtapa).reduce((a, t) => a + t.liquido, 0);
console.log(`0014 gerado: ${Object.keys(ETAPAS).length} servicos, ${EVENTOS.length} eventos, receita liquida construtora ${totalLiq.toFixed(2)}, direto ${Object.values(porEtapa).reduce((a, t) => a + t.direto, 0).toFixed(2)}`);

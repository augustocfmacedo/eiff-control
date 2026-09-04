// Composicoes proprias da EIFF para os itens da proposta ORC-328 sem equivalente no SINAPI, com insumos de mercado
// marcados como ESTIMATIVA (a substituir por cotacao/apontamento real). Gera supabase/migrations/0022_composicoes_eiff.sql
// e imprime o custo previsto de cada composicao (calculado com o catalogo em scripts/tmp/catalogo-go.json, se existir).
// Coeficientes = consumo por unidade da composicao (kg de aco por kg de estrutura, horas por kg, etc.).
// Uso: node scripts/composicoes-eiff.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODIGO_ORC = 'ORC-328';
const EST = 'ESTIMATIVA de mercado (set/2026): substituir pela cotação ou pelo apontamento real da EIFF.';

// insumos proprios: [codigo, descricao, unidade, tipo, preco]
export const INSUMOS = [
  ['EIFF-INS-01', 'Pino stud welding 3/4" x 5.3/8" (19 x 110 mm) para steel deck', 'un', 'Material', 9.0],
  ['EIFF-INS-02', 'Parafuso estrutural ASTM A325 com porca e arruela, bitola média (5/8" a 3/4")', 'un', 'Material', 1.8],
  ['EIFF-INS-03', 'Chumbador 3/4" x 300 mm com porca e arruela (fornecimento)', 'un', 'Material', 32.0],
  ['EIFF-INS-04', 'Isopainel PIR 50 mm microfrisado/liso RAL 9003 (fornecimento)', 'm²', 'Material', 165.0],
  ['EIFF-INS-05', 'Acessórios de fixação e vedação de painel isotérmico (parafusos, fitas, silicone), por m²', 'm²', 'Material', 8.0],
  ['EIFF-INS-06', 'Custo fabril por kg de estrutura (energia, gases, consumíveis miúdos, depreciação de máquinas)', 'kg', 'Outros', 0.6],
  ['EIFF-INS-07', 'Kit EPI/EPC mensal para equipe de 10 pessoas (reposição e coletivos)', 'mês', 'Material', 1200.0],
  ['EIFF-INS-08', 'Locação mensal de ferramentas e equipamentos leves (furadeiras, esmerilhadeiras, andaimes, extensões)', 'mês', 'Equipamento', 1500.0],
  ['EIFF-INS-09', 'Material de limpeza de canteiro (mês)', 'mês', 'Material', 120.0],
  ['EIFF-INS-10', 'Locação de caçamba estacionária 5 m³ com retirada e destinação', 'un', 'Serviço', 350.0],
  ['EIFF-INS-11', 'Material para ligação provisória de energia (padrão de entrada, disjuntor, cabos, quadro)', 'vb', 'Material', 1800.0],
  ['EIFF-INS-12', 'Material para ligação provisória de água (tubos, registro, caixa, conexões)', 'vb', 'Material', 450.0],
  ['EIFF-INS-15', 'Material de limpeza final de obra, por m²', 'm²', 'Material', 0.3],
  ['EIFF-INS-20', 'Subempreitada de instalações elétricas (verba)', 'vb', 'Serviço', 70210.0],
  ['EIFF-INS-21', 'Subempreitada de projeto e execução de SPDA (verba)', 'vb', 'Serviço', 23069.0],
  ['EIFF-INS-22', 'Subempreitada de instalações hidrossanitárias (água fria, esgoto, pluvial e drenagem), por m²', 'm²', 'Serviço', 36.26],
  ['EIFF-INS-23', 'Subempreitada de projeto e execução de prevenção e combate a incêndio (verba)', 'vb', 'Serviço', 60180.0],
  ['EIFF-INS-24', 'Subempreitada de instalação básica de gás (verba)', 'vb', 'Serviço', 9027.0],
];
const NOTA_SUB = 'ESTIMATIVA: 85% do preço de venda da proposta; substituir pela cotação do subempreiteiro.';

// composicoes proprias: [codigo, descricao, unidade, grupo, itens[[ref, coeficiente]], observacoes]
// ref: 'S<codigo>' composicao SINAPI, 'I<codigo>' insumo SINAPI, 'P<codigo>' insumo proprio, 'C<codigo>' composicao propria
export const COMPOSICOES = [
  ['EIFF-FAB-KG', 'Fabricação de estrutura metálica em perfis laminados e chapas soldadas, por kg (fábrica EIFF), inclusive fundo anticorrosivo', 'kg', 'Estrutura metálica EIFF', [
    ['I43082', 0.75], // perfil I/W laminado (kg de aco por kg de estrutura, com perda de corte)
    ['I1332', 0.30], // chapa A36 3/8" (ligacoes, chapas de base, enrijecedores)
    ['I10997', 0.015], // eletrodo E7018 kg/kg
    ['I44495', 0.0015], // disco de corte 12" un/kg
    ['I7307', 0.005], // fundo anticorrosivo l/kg (aprox. 30 m2 por t x 0,15 l/m2)
    ['S88317', 0.004], // soldador h/kg (4 HH/t)
    ['S88315', 0.004], // serralheiro/caldeireiro h/kg
    ['S88240', 0.006], // ajudante de estrutura metalica h/kg
    ['S88278', 0.002], // montador (pre-montagem fabril) h/kg
    ['S88310', 0.0015], // pintor (primer) h/kg
    ['PEIFF-INS-06', 1], // custo fabril por kg
  ], 'Índices: aço 1,05 kg/kg; 17,5 HH/t na fábrica; primer 0,15 l/m² em 30 m²/t. ' + EST],
  ['EIFF-MON-KG', 'Montagem de estrutura metálica em obra, por kg (içamento, aprumo, parafusamento e solda de campo)', 'kg', 'Estrutura metálica EIFF', [
    ['S88278', 0.012], // montador h/kg (12 HH/t)
    ['S88240', 0.012], // ajudante h/kg
    ['S88317', 0.002], // soldador de campo h/kg
    ['S89272', 0.0012], // guindaste 30 t CHP h/kg (1,2 h/t)
    ['S102886', 0.003], // plataforma elevatoria CHP h/kg
    ['I10997', 0.002], // eletrodo kg/kg
  ], 'Índices: 26 HH/t em campo; guindaste 1,2 h/t; plataforma 3 h/t. ' + EST],
  ['EIFF-EST-KG', 'Estrutura metálica fabricada, transportada internamente e montada, por kg (EIFF)', 'kg', 'Estrutura metálica EIFF', [
    ['CEIFF-FAB-KG', 1], ['CEIFF-MON-KG', 1],
  ], 'Soma de fabricação e montagem. Transporte externo e parafusos/chumbadores em itens próprios da proposta.'],
  ['EIFF-STUD', 'Pino stud welding 3/4" x 5.3/8" soldado em viga para steel deck, por unidade', 'un', 'Estrutura metálica EIFF', [
    ['PEIFF-INS-01', 1], ['S102868', 0.02], ['S88317', 0.03],
  ], 'Máquina stud 0,02 h/un e soldador 0,03 h/un. ' + EST],
  ['EIFF-PARAF', 'Parafuso estrutural ASTM A325 com porca e arruela, aplicado e torqueado, por unidade', 'un', 'Estrutura metálica EIFF', [
    ['PEIFF-INS-02', 1], ['S88278', 0.02],
  ], EST],
  ['EIFF-CHUMB', 'Chumbador 3/4" com porca e arruela, posicionado e nivelado na fundação, por unidade', 'un', 'Estrutura metálica EIFF', [
    ['PEIFF-INS-03', 1], ['S88278', 0.2], ['S88240', 0.2],
  ], EST],
  ['EIFF-ISOP', 'Isopainel PIR 50 mm microfrisado/liso RAL 9003, fornecimento e montagem em fechamento, por m²', 'm²', 'Vedação e cobertura EIFF', [
    ['PEIFF-INS-04', 1], ['PEIFF-INS-05', 1], ['S88278', 0.25], ['S88240', 0.25], ['S102886', 0.04],
  ], 'Montagem 0,5 HH/m² e plataforma 0,04 h/m². ' + EST],
  ['EIFF-CUMEEIRA', 'Cumeeira metálica trapezoidal, peça de 3,00 m com largura útil 0,98 m, instalada, por unidade', 'un', 'Vedação e cobertura EIFF', [
    ['S100326', 3.0],
  ], 'Composição SINAPI de cumeeira por metro x 3,00 m por peça.'],
  ['EIFF-RUFO-80', 'Rufo externo/interno em chapa de aço galvanizado nº 26, corte de 80 cm, instalado com içamento, por m', 'm', 'Vedação e cobertura EIFF', [
    ['I1113', 2.42], // rufo corte 33 cm proporcional ao desenvolvimento de 80 cm
    ['S88323', 0.30], ['S88240', 0.30], ['S102886', 0.05],
  ], 'Chapa proporcional ao corte (80/33); telhadista 0,3 h/m. ' + EST],
  ['EIFF-TRANSP', 'Transporte de carga de estrutura metálica da fábrica ao canteiro, viagem de caminhão trucado com carga e descarga', 'un', 'Logística EIFF', [
    ['S91031', 16], // caminhao trucado CHP, 16 h por viagem (ida, descarga, volta)
    ['S88240', 24], // 2 ajudantes x 12 h
    ['S88286', 8], // motorista operador de munck para descarga
  ], EST],
  ['EIFF-LIMP-FINAL', 'Limpeza final de obra, por m²', 'm²', 'Canteiro EIFF', [
    ['S88316', 0.10], ['PEIFF-INS-15', 1],
  ], 'Servente 0,10 h/m². ' + EST],
  ['EIFF-MOB', 'Mobilização e desmobilização de equipe e equipamentos, por evento', 'un', 'Canteiro EIFF', [
    ['S91031', 5], ['S88240', 8], ['S88278', 4], // meio periodo de caminhao trucado, 2 ajudantes e 1 montador
  ], EST],
  ['EIFF-LIG-LUZ', 'Ligação provisória de luz e força, por unidade', 'un', 'Canteiro EIFF', [
    ['PEIFF-INS-11', 1], ['S88264', 16], ['S88247', 16],
  ], EST],
  ['EIFF-LIG-AGUA', 'Ligação provisória de água, inclusive retirada do esgoto sanitário, por unidade', 'un', 'Canteiro EIFF', [
    ['PEIFF-INS-12', 1], ['S88267', 8], ['S88248', 8],
  ], EST],
  ['EIFF-EPI-MES', 'EPI e EPC para a equipe, por mês', 'mês', 'Canteiro EIFF', [['PEIFF-INS-07', 1]], EST],
  ['EIFF-LOC-EQUIP', 'Locação de equipamentos, ferramentas e caçamba, por mês', 'mês', 'Canteiro EIFF', [['PEIFF-INS-08', 1]], EST],
  ['EIFF-LIMP-MES', 'Material de limpeza de canteiro, por mês', 'mês', 'Canteiro EIFF', [['PEIFF-INS-09', 1]], EST],
  ['EIFF-ENTULHO', 'Transporte de entulho em caçamba estacionária 5 m³, inclusive carga manual, por m³', 'm³', 'Canteiro EIFF', [
    ['PEIFF-INS-10', 0.2], ['S88316', 0.8],
  ], 'Uma caçamba a cada 5 m³; servente 0,8 h/m³. ' + EST],
  ['EIFF-SUB-ELET', 'Instalações elétricas por subempreitada (verba)', 'vb', 'Subempreitadas', [['PEIFF-INS-20', 1]], NOTA_SUB],
  ['EIFF-SUB-SPDA', 'Projeto e execução de SPDA por subempreitada (verba)', 'vb', 'Subempreitadas', [['PEIFF-INS-21', 1]], NOTA_SUB],
  ['EIFF-SUB-HIDRO', 'Instalações hidrossanitárias por subempreitada, por m²', 'm²', 'Subempreitadas', [['PEIFF-INS-22', 1]], NOTA_SUB],
  ['EIFF-SUB-INC', 'Prevenção e combate a incêndio por subempreitada (verba)', 'vb', 'Subempreitadas', [['PEIFF-INS-23', 1]], NOTA_SUB],
  ['EIFF-SUB-GAS', 'Instalação básica de gás por subempreitada (verba)', 'vb', 'Subempreitadas', [['PEIFF-INS-24', 1]], NOTA_SUB],
];

// item da proposta -> composicao propria
export const VINCULOS_EIFF = {
  '2.3': 'EIFF-MOB', '2.4': 'EIFF-LIG-LUZ', '2.5': 'EIFF-LIG-AGUA', '2.6': 'EIFF-EPI-MES', '2.7': 'EIFF-LOC-EQUIP', '2.8': 'EIFF-LIMP-MES', '2.11': 'EIFF-ENTULHO',
  '6.1.1.3': 'EIFF-SUB-ELET', '6.1.2.1': 'EIFF-SUB-SPDA', '6.2.3': 'EIFF-SUB-HIDRO', '6.3.1': 'EIFF-SUB-INC', '6.4.1': 'EIFF-SUB-GAS',
  '8.7': 'EIFF-STUD', '10.1': 'EIFF-PARAF', '10.2': 'EIFF-CHUMB', '10.3': 'EIFF-EST-KG', '11.1': 'EIFF-ISOP', '12.2': 'EIFF-CUMEEIRA', '12.3': 'EIFF-RUFO-80',
  '14.1': 'EIFF-TRANSP', '15.1': 'EIFF-LIMP-FINAL',
};

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const ORG = "(select id from organization where code = 'EIFF')";
const ref = (r) => (r[0] === 'S' ? ['SINAPI', r.slice(1), 'C'] : r[0] === 'I' ? ['SINAPI', r.slice(1), 'I'] : r[0] === 'P' ? ['Própria', r.slice(1), 'I'] : ['Própria', r.slice(1), 'C']);

function gerar() {
  const hoje = new Date().toISOString().slice(0, 10);
  let sql = `-- Composicoes proprias da EIFF (scripts/composicoes-eiff.mjs) para os itens do ${CODIGO_ORC} sem equivalente SINAPI.
-- Precos dos insumos proprios sao ESTIMATIVAS marcadas no campo notes/price_source. Idempotente.
`;
  for (const [cod, desc, un, tipo, preco] of INSUMOS) {
    sql += `insert into catalog_input (organization_id, source, code, description, unit, kind, price, price_date, price_source, class_name, notes, active)
values (${ORG}, 'Própria', ${q(cod)}, ${q(desc)}, ${q(un)}, ${q(tipo)}, ${preco}, '${hoje}', 'Estimativa EIFF', 'Estimativa', ${q(cod.startsWith('EIFF-INS-2') ? NOTA_SUB : EST)}, true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, kind = excluded.kind, price = excluded.price, price_date = excluded.price_date, price_source = excluded.price_source, notes = excluded.notes;\n`;
  }
  for (const [cod, desc, un, grupo, itens, obs] of COMPOSICOES) {
    sql += `insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active) values (${ORG}, 'Própria', ${q(cod)}, ${q(desc)}, ${q(un)}, ${q(grupo)}, ${q(obs)}, true)
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit, group_name = excluded.group_name, notes = excluded.notes;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = ${ORG} and source = 'Própria' and code = ${q(cod)});
insert into catalog_composition_item (composition_id, item_order, input_id, child_composition_id, coefficient)
select c.id, v.ordem, i.id, cc.id, v.coef from (values\n${itens.map(([r, coef], i) => { const [src, code, k] = ref(r); return `(${i + 1}, ${q(src)}, ${q(code)}, ${q(k)}, ${coef})`; }).join(',\n')}) as v(ordem, src, code, k, coef)
join catalog_composition c on c.organization_id = ${ORG} and c.source = 'Própria' and c.code = ${q(cod)}
left join catalog_input i on v.k = 'I' and i.organization_id = ${ORG} and i.source = v.src::catalog_source and i.code = v.code
left join catalog_composition cc on v.k = 'C' and cc.organization_id = ${ORG} and cc.source = v.src::catalog_source and cc.code = v.code
where i.id is not null or cc.id is not null;\n`;
  }
  for (const [item, cod] of Object.entries(VINCULOS_EIFF)) {
    sql += `update estimate_item set composition_id = (select id from catalog_composition where organization_id = ${ORG} and source = 'Própria' and code = ${q(cod)}) where code = ${q(item)} and estimate_id = (select id from estimate where organization_id = ${ORG} and code = ${q(CODIGO_ORC)});\n`;
  }
  const out = path.join(root, 'supabase', 'migrations', '0022_composicoes_eiff.sql');
  fs.writeFileSync(out, sql);
  console.log(`gerado ${path.relative(root, out)}: ${INSUMOS.length} insumos próprios, ${COMPOSICOES.length} composições, ${Object.keys(VINCULOS_EIFF).length} vínculos`);
}

/** Previa dos custos com o catalogo SINAPI em scripts/tmp/catalogo-go.json (se existir). */
async function previa() {
  const arq = path.join(root, 'scripts', 'tmp', 'catalogo-go.json');
  if (!fs.existsSync(arq)) return;
  const { Calculadora } = await import(new URL('../scripts/tmp/orcamentos.mjs', import.meta.url).href).catch(() => ({}));
  if (!Calculadora) return;
  const cat = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const insumos = [...cat.insumos.map((i) => ({ ...i, id: 'I' + i.codigo })), ...INSUMOS.map(([codigo, descricao, unidade, tipo, preco]) => ({ id: 'P' + codigo, codigo, descricao, unidade, tipo, preco }))];
  const comps = [...cat.composicoes.map((c) => ({ ...c, id: 'S' + c.codigo, itens: c.itens.map((it) => ({ tipo: it.tipo, refId: (it.tipo === 'Insumo' ? 'I' : 'S') + it.codigo, coeficiente: it.coeficiente })) })),
    ...COMPOSICOES.map(([codigo, descricao, unidade, grupo, itens]) => ({ id: 'C' + codigo, codigo, descricao, unidade, grupo, itens: itens.map(([r, coef]) => ({ tipo: r[0] === 'S' || r[0] === 'C' ? 'Composição' : 'Insumo', refId: r, coeficiente: coef })) }))];
  const calc = new Calculadora({ insumos, composicoes: comps });
  const { ITENS } = await import('./proposta-smartfit.mjs');
  const venda = Object.fromEntries(ITENS.map(([, item, , qtd, un, pu]) => [item, { pu, un, qtd }]));
  const inv = Object.fromEntries(Object.entries(VINCULOS_EIFF).map(([k, v]) => [v, k]));
  console.log('composição        | custo unit. | venda unit. | margem | item');
  for (const [cod, , un] of COMPOSICOES) {
    const r = calc.custo('C' + cod);
    const item = inv[cod]; const v = item ? venda[item] : null;
    console.log(`${cod.padEnd(17)} | ${r.custoUnitario.toFixed(2).padStart(11)} ${un.padEnd(3)}| ${v ? v.pu.toFixed(2).padStart(11) : '—'.padStart(11)} | ${v ? ((1 - r.custoUnitario / v.pu) * 100).toFixed(1).padStart(5) + '%' : '      '} | ${item ?? ''}${r.faltantes.length ? ' FALTAM ' + r.faltantes.join(',') : ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { gerar(); await previa(); }

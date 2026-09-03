// Gera supabase/deploy.sql: migrations 0001..0003 + carga inicial a partir de src/data/seed.json.
// Uso: node scripts/build-deploy-sql.mjs
// O arquivo resultante e colado uma unica vez no SQL Editor do Supabase (ou aplicado com `supabase db push`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'seed.json'), 'utf8'));
const migDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

const q = (v) => (v === undefined || v === null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === undefined || v === null || v === '' ? '0' : Number(v));
const b = (v) => (v ? 'true' : 'false');
const d = (v) => (v ? `'${v}'` : 'null');

const ORG = seed.params.organizacao || 'EIFF';
const CO = seed.params.empresa || 'EIFF';
const org = `(select id from organization where code = ${q(ORG)})`;
const co = `(select id from company where code = ${q(ORG)} and organization_id = ${org})`;
const conta = (inst) => `(select id from bank_account where organization_id = ${org} and institution = ${q(inst)} limit 1)`;
const plano = (cat) => `(select id from chart_account where organization_id = ${org} and category = ${q(cat)})`;
const obra = (cod) => (cod ? `(select id from project where organization_id = ${org} and code = ${q(cod)})` : 'null');

let s = `-- ============================================================================
-- CARGA INICIAL (gerada de src/data/seed.json em ${new Date().toISOString()})
-- Origem: planilha Fluxo_de_Caixa_EIFF.xlsx | data-base ${seed.params.dataBase} | cenario ${seed.params.cenario}
-- ============================================================================
insert into organization (code, name) values (${q(ORG)}, ${q(ORG)}) on conflict (code) do nothing;
insert into company (organization_id, code, name) values (${org}, ${q(ORG)}, ${q(CO)}) on conflict (organization_id, code) do nothing;

insert into parameter_set (organization_id, base_date, scenario, include_demo, min_reserve, limit_project_manager, limit_finance, limit_board,
  budget_deviation_allowed, reconciliation_tolerance, approval_sla_hours, responsible, version)
select ${org}, ${d(seed.params.dataBase)}, ${q(seed.params.cenario)}, ${b(seed.params.incluirDemo)}, ${n(seed.params.reservaMinima)},
  ${n(seed.params.alcadas.limiteGestorObra)}, ${n(seed.params.alcadas.limiteFinanceiro)}, ${n(seed.params.alcadas.limiteDiretoria)},
  ${n(seed.params.alcadas.desvioOrcamentoPermitido)}, ${n(seed.params.alcadas.toleranciaConciliacao)}, ${n(seed.params.alcadas.slaAprovacaoHoras)},
  ${q(seed.params.responsavel)}, ${q(seed.params.versao)}
where not exists (select 1 from parameter_set where organization_id = ${org} and active);
`;
for (const c of ['Conservador', 'Base', 'Otimista']) {
  const f = seed.params.fatores[c];
  s += `insert into scenario_factor (parameter_set_id, scenario, inflow_factor, outflow_factor)
select id, ${q(c)}, ${n(f.entradas)}, ${n(f.saidas)} from parameter_set where organization_id = ${org} and active
on conflict (parameter_set_id, scenario) do nothing;\n`;
}
s += '\n-- plano de contas\n';
for (const p of seed.planoContas) {
  s += `insert into chart_account (organization_id, category, entry_type, cash_group, dre_group, account_class, guidance, active) values (${org}, ${q(p.categoria)}, ${q(p.tipo)}, ${q(p.grupoFluxo)}, ${q(p.grupoDre)}, ${q(p.classe)}, ${q(p.orientacao)}, ${b(p.ativa)}) on conflict (organization_id, category) do nothing;\n`;
}
s += '\n-- contas financeiras\n';
for (const c of seed.contas) {
  s += `insert into bank_account (organization_id, company_id, code, record_kind, institution, account_label, account_type, opening_balance, opening_balance_date, linked_reserve, active) values (${org}, ${co}, ${q(c.id)}, ${q(c.registro)}, ${q(c.instituicao)}, ${q(c.conta)}, ${q(c.tipo)}, ${n(c.saldoInicial)}, ${d(seed.params.dataBase)}, ${n(c.reservaVinculada)}, ${b(c.ativa)}) on conflict (organization_id, code) do nothing;\n`;
}
s += '\n-- obras\n';
for (const o of seed.obras) {
  s += `insert into project (organization_id, company_id, code, record_kind, name, client_name, city_state, status, scope, signed_at, starts_at, contractual_end, contract_value, addenda_value, budgeted_cost, physical_progress, measured_invoiced, estimate_to_complete, notes, source_system, external_id)
values (${org}, ${co}, ${q(o.codigo)}, ${q(o.registro)}, ${q(o.nome)}, ${q(o.cliente)}, ${q(o.cidadeUf)}, ${q(o.status)}, ${q(o.escopo)}, ${d(o.assinatura)}, ${d(o.inicio)}, ${d(o.fimContratual)}, ${n(o.valorContrato)}, ${n(o.aditivos)}, ${n(o.custoOrcado)}, ${n(o.execucaoFisica)}, ${n(o.medidoFaturado)}, ${n(o.estimativaConcluir)}, ${q(o.observacoes)}, 'planilha', ${q(o.codigo)})
on conflict (organization_id, code) do nothing;\n`;
}
s += '\n-- lancamentos\n';
const tipoDe = new Map(seed.planoContas.map((p) => [p.categoria, p.tipo]));
for (const l of seed.lancamentos) {
  s += `insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, sub_category, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, settlement_date, status, confidence, probability, bank_account_id, gross_amount, tax_amount, discount_amount, interest_amount, settled_amount, reconciled, notes, source_system, external_id)
values (${q(l.id)}, ${org}, ${co}, ${q(l.registro)}, ${q(tipoDe.get(l.categoria))}, ${plano(l.categoria)}, ${q(l.subcategoria)}, ${q(l.centroCusto)}, ${obra(l.codigoObra)}, ${q(l.contraparte)}, ${q(l.documento)}, ${q(l.descricao)}, ${d(l.competencia)}, ${d(l.vencimento)}, ${d(l.realizacao)}, ${q(l.status)}, ${q(l.confiabilidade)}, ${n(l.probabilidade)}, ${conta(l.contaFinanceira)}, ${n(l.valorBruto)}, ${n(l.retencoes)}, ${n(l.desconto)}, ${n(l.multaJuros)}, ${n(l.valorRealizado)}, ${b(l.conciliado)}, ${q(l.observacoes)}, 'planilha', ${q(l.idExterno || l.id)})
on conflict (organization_id, code) do nothing;\n`;
}
s += '\n-- servicos das obras (derivados das receitas previstas) e vinculo dos lancamentos\n';
for (const sv of seed.servicos || []) {
  s += `insert into project_service (organization_id, project_id, code, name, phase, unit, budgeted_qty, executed_qty, budgeted_cost, sale_price, estimate_to_complete, planned_start, planned_end, status, notes, active)
values (${org}, ${obra(sv.codigoObra)}, ${q(sv.codigo)}, ${q(sv.nome)}, ${q(sv.etapa)}, ${q(sv.unidade)}, ${n(sv.quantidadeOrcada)}, ${n(sv.quantidadeExecutada)}, ${n(sv.custoOrcado)}, ${n(sv.precoVenda)}, ${sv.estimativaConcluir === undefined || sv.estimativaConcluir === null ? 'null' : n(sv.estimativaConcluir)}, ${d(sv.inicioPrevisto)}, ${d(sv.fimPrevisto)}, ${q(sv.status)}, ${q(sv.observacoes)}, ${b(sv.ativo)})
on conflict (project_id, code) do nothing;\n`;
}
for (const l of seed.lancamentos.filter((x) => x.servicoId)) {
  const sv = seed.servicos.find((x) => x.id === l.servicoId);
  if (!sv) continue;
  s += `update financial_entry set service_id = (select id from project_service where project_id = ${obra(sv.codigoObra)} and code = ${q(sv.codigo)}) where organization_id = ${org} and code = ${q(l.id)} and service_id is null;\n`;
}

s += '\n-- dividas\n';
for (const dv of seed.dividas) {
  s += `insert into debt (organization_id, company_id, code, record_kind, creditor_name, instrument, contracted_at, principal, outstanding_balance, annual_rate, monthly_installment, next_due_date, remaining_installments, guarantee, status, notes)
values (${org}, ${co}, ${q(dv.id)}, ${q(dv.registro)}, ${q(dv.credor)}, ${q(dv.instrumento)}, ${d(dv.contratacao)}, ${n(dv.principal)}, ${n(dv.saldoDevedor)}, ${n(dv.taxaAa)}, ${n(dv.parcelaMensal)}, ${d(dv.proximoVencimento)}, ${n(dv.parcelasRestantes)}, ${q(dv.garantia)}, ${q(dv.status)}, ${q(dv.observacoes)})
on conflict (organization_id, code) do nothing;\n`;
}

let out = `-- EIFF Control - implantacao completa (schema + views + RLS + carga inicial)\n-- Gerado em ${new Date().toISOString()}. Cole no SQL Editor do Supabase e execute uma vez.\n\n`;
for (const m of migrations) {
  out += `\n-- ============================================================================\n-- ${m}\n-- ============================================================================\n`;
  out += fs.readFileSync(path.join(migDir, m), 'utf8') + '\n';
}
out += '\n' + s;
fs.writeFileSync(path.join(root, 'supabase', 'deploy.sql'), out);
fs.writeFileSync(path.join(root, 'supabase', 'seed.sql'), s);
console.log(`deploy.sql: ${out.length} caracteres | ${migrations.length} migrations | ${seed.lancamentos.length} lancamentos, ${seed.obras.length} obras, ${seed.planoContas.length} categorias`);

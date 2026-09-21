// Paridade do mapeamento linha -> Dataset (Wave 03, prework do Architect).
//
// Este teste foi GRAVADO sobre o `carregarRemoto` original (antes da extracao de `mapeamentoDataset.ts`): o snapshot
// e o Dataset que o navegador montava a partir de um conjunto fixo de linhas do banco. A extracao so e valida se o
// snapshot continuar identico — o mesmo teste prova, depois, que o servidor (datasetServidor.ts) monta o MESMO
// Dataset a partir das mesmas linhas.
//
// O cliente do Supabase e falso: devolve as linhas da fixture por tabela e ignora filtros (order/eq/limit), porque o
// que se prova aqui e a TRANSFORMACAO, nao as consultas. `range` e honrado para o `selTodos` terminar.
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const ORG = '00000000-0000-4000-8000-00000000000a';
const COMPANY = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const GESTOR = '00000000-0000-4000-8000-0000000000a2';
const PLANO_1 = '00000000-0000-4000-8000-0000000000c1';
const PLANO_2 = '00000000-0000-4000-8000-0000000000c2';
const CONTA_1 = '00000000-0000-4000-8000-0000000000d1';
const OBRA_1 = '00000000-0000-4000-8000-0000000000e1';
const LANC_1 = '00000000-0000-4000-8000-0000000000f1';
const LANC_2 = '00000000-0000-4000-8000-0000000000f2';
const TRANS_1 = '00000000-0000-4000-8000-000000000101';
const APROV_1 = '00000000-0000-4000-8000-000000000111';
const SERV_1 = '00000000-0000-4000-8000-000000000121';
const DEM_1 = '00000000-0000-4000-8000-000000000131';
const ORD_1 = '00000000-0000-4000-8000-000000000141';
const WORKER_1 = '00000000-0000-4000-8000-000000000151';
const TS_1 = '00000000-0000-4000-8000-000000000161';
const MED_1 = '00000000-0000-4000-8000-000000000171';
const PED_1 = '00000000-0000-4000-8000-000000000181';
const CONJ_1 = '00000000-0000-4000-8000-000000000191';
const AV_1 = '00000000-0000-4000-8000-0000000001a1';
const EST_1 = '00000000-0000-4000-8000-0000000001b1';
const ROM_1 = '00000000-0000-4000-8000-0000000001c1';
const ITEM_1 = '00000000-0000-4000-8000-0000000001d1';
const MOV_1 = '00000000-0000-4000-8000-0000000001e1';
const INS_1 = '00000000-0000-4000-8000-0000000001f1';
const COMP_1 = '00000000-0000-4000-8000-000000000201';
const ORC_1 = '00000000-0000-4000-8000-000000000211';
const PARAM_1 = '00000000-0000-4000-8000-000000000221';
const FUNC_1 = '00000000-0000-4000-8000-000000000231';
const ALOC_1 = '00000000-0000-4000-8000-000000000241';
const FOTO_1 = '00000000-0000-4000-8000-000000000251';
const TREINO_1 = '00000000-0000-4000-8000-000000000261';

/** Uma linha por tabela lida pelo carregarRemoto, com as colunas que o mapeamento consome. */
export const FIXTURE: Record<string, Row[]> = {
  profile: [
    { id: ADMIN, organization_id: ORG, name: 'Augusto', email: 'augusto@eiff.com.br', role: 'Administrador', active: true },
    { id: GESTOR, organization_id: ORG, name: 'Gestora', email: 'gestora@eiff.com.br', role: 'Gestor de obra', active: true },
  ],
  organization: [{ id: ORG, name: 'EIFF' }],
  company: [{ id: COMPANY, organization_id: ORG, name: 'EIFF Estruturas' }],
  parameter_set: [{ id: PARAM_1, organization_id: ORG, active: true, base_date: '2026-09-10', auto_base_date: true, scenario: 'Base', include_demo: false, min_reserve: 50000, statement_cutoff: '2026-09-01', limit_project_manager: 5000, limit_finance: 20000, limit_board: 100000, budget_deviation_allowed: 0.05, reconciliation_tolerance: 0.01, approval_sla_hours: 48, responsible: 'Financeiro', version: 'v1' }],
  scenario_factor: [
    { parameter_set_id: PARAM_1, scenario: 'Conservador', inflow_factor: 0.9, outflow_factor: 1.1 },
    { parameter_set_id: PARAM_1, scenario: 'Base', inflow_factor: 1, outflow_factor: 1 },
    { parameter_set_id: PARAM_1, scenario: 'Otimista', inflow_factor: 1.1, outflow_factor: 0.95 },
  ],
  chart_account: [
    { id: PLANO_1, organization_id: ORG, category: 'Receita de obra', entry_type: 'Entrada', cash_group: 'Operacional', dre_group: 'Receita', account_class: 'Operacional', guidance: 'medições', active: true },
    { id: PLANO_2, organization_id: ORG, category: 'Outros custos diretos', entry_type: 'Saída', cash_group: 'Operacional', dre_group: 'Custo direto', account_class: 'Custo', guidance: null, active: true },
  ],
  bank_account: [{ id: CONTA_1, organization_id: ORG, code: 'CX-01', record_kind: 'Real', institution: 'Banco Alfa', account_label: 'CC 123', account_type: 'Corrente', opening_balance: 10000, opening_balance_date: '2026-09-01', linked_reserve: 2000, active: true }],
  project: [{ id: OBRA_1, organization_id: ORG, code: 'OB-01', record_kind: 'Real', name: 'Obra Um', client_name: 'Cliente', city_state: 'Goiânia/GO', status: 'Em execução', scope: 'Estrutura', signed_at: '2026-06-01', starts_at: '2026-06-15', contractual_end: '2026-12-15', contract_value: 1000000, addenda_value: 0, budgeted_cost: 700000, physical_progress: 0.3, measured_invoiced: 200000, estimate_to_complete: 500000, target_margin: 0.2, notes: null, manager_id: GESTOR }],
  financial_entry: [
    { id: LANC_1, organization_id: ORG, code: 'L-0001', record_kind: 'Real', chart_account_id: PLANO_1, sub_category: null, cost_center_label: null, project_id: OBRA_1, service_id: SERV_1, counterparty_name: 'Cliente', document_number: 'NF 1', description: 'Medição 1', competence_date: '2026-07-01', due_date: '2026-07-30', settlement_date: '2026-07-28', status: 'Realizado', confidence: 'Contratado', probability: 1, bank_account_id: CONTA_1, gross_amount: 100000, tax_amount: 5000, discount_amount: 0, interest_amount: 0, settled_amount: 95000, reconciled: true, notes: null, source_system: 'planilha', external_id: null, created_at: '2026-07-01T10:00:00Z', created_by: ADMIN, updated_at: '2026-07-28T10:00:00Z', updated_by: ADMIN, version: 2, cancellation_reason: null, direct_billing: false, deleted_at: null, deleted_by: null, deletion_reason: null },
    { id: LANC_2, organization_id: ORG, code: 'L-0002', record_kind: 'Real', chart_account_id: PLANO_2, sub_category: 'Frete', cost_center_label: 'Obra', project_id: OBRA_1, service_id: null, counterparty_name: 'Transportadora', document_number: null, description: 'Frete', competence_date: '2026-09-01', due_date: '2026-09-20', settlement_date: null, status: 'Programado', confidence: 'Previsto', probability: 0.9, bank_account_id: null, gross_amount: 5000, tax_amount: 0, discount_amount: 0, interest_amount: 0, settled_amount: 0, reconciled: false, notes: 'obs', source_system: 'diretor-financeiro', external_id: 'ext-2', created_at: '2026-09-01T10:00:00Z', created_by: GESTOR, updated_at: '2026-09-01T10:00:00Z', updated_by: GESTOR, version: 0, cancellation_reason: null, direct_billing: true, deleted_at: '2026-09-05T10:00:00Z', deleted_by: ADMIN, deletion_reason: 'duplicado' },
  ],
  settlement: [{ id: '00000000-0000-4000-8000-000000000301', entry_id: LANC_1, settled_on: '2026-07-28', amount: 95000, bank_account_id: CONTA_1, document_number: 'DOC 1', created_by: ADMIN, created_at: '2026-07-28T10:00:00Z', reversed: false }],
  bank_transaction: [{ id: TRANS_1, organization_id: ORG, external_id: 'FITID-1', record_kind: 'Real', transaction_date: '2026-07-28', bank_account_id: CONTA_1, description: 'TED recebida', document_number: '1', debit: 0, credit: 95000 }],
  reconciliation: [{ bank_transaction_id: TRANS_1, entry_id: LANC_1, justification: null }],
  debt: [{ id: '00000000-0000-4000-8000-000000000311', organization_id: ORG, code: 'D-01', record_kind: 'Real', creditor_name: 'Banco Beta', instrument: 'CCB', contracted_at: '2026-01-10', principal: 200000, outstanding_balance: 150000, annual_rate: 0.18, monthly_installment: 8000, next_due_date: '2026-10-10', remaining_installments: 20, guarantee: 'Aval', status: 'Ativa', notes: null }],
  approval_request: [{ id: APROV_1, organization_id: ORG, code: 'AP-01', entity_kind: 'lancamento', entity_id: LANC_2, title: 'Frete', amount: 5000, project_id: OBRA_1, requested_by: GESTOR, requested_at: '2026-09-01T11:00:00Z', sla_deadline: '2026-09-03T11:00:00Z', status: 'Pendente', impact: { caixa: -5000 }, exception_justification: null }],
  approval_step: [
    { request_id: APROV_1, step_order: 1, role: 'Gestor de obra', status: 'Aprovado', decided_by: GESTOR, decided_at: '2026-09-01T12:00:00Z', justification: 'ok' },
    { request_id: APROV_1, step_order: 2, role: 'Financeiro', status: 'Pendente', decided_by: null, decided_at: null, justification: null },
  ],
  comment: [{ id: '00000000-0000-4000-8000-000000000321', entity_type: 'lancamento', entity_id: LANC_2, author_id: GESTOR, created_at: '2026-09-01T12:30:00Z', body: 'urgente' }],
  task: [{ id: '00000000-0000-4000-8000-000000000331', title: 'Conferir frete', description: null, entity_type: 'lancamento', entity_id: LANC_2, assignee_id: ADMIN, due_on: '2026-09-10', status: 'Aberta', origin: 'manual', created_at: '2026-09-01T13:00:00Z', created_by: GESTOR, worker_id: null, project_id: OBRA_1, service_id: null, order_id: null, location: null, priority: 'Alta', done_at: null, blocked_reason: null }],
  period_close: [{ period: '2026-07', closed_at: '2026-08-05T10:00:00Z', closed_by: ADMIN, reopened_at: null, reopened_by: null, reopen_reason: null }],
  audit_log: [{ id: 1, occurred_at: '2026-09-01T10:00:00Z', actor_id: GESTOR, action: 'INSERT', entity_type: 'financial_entry', entity_id: LANC_2, before_data: null, after_data: { code: 'L-0002' }, reason: null }],
  user_scope: [{ profile_id: GESTOR, project_id: OBRA_1 }],
  project_service: [{ id: SERV_1, project_id: OBRA_1, code: 'S-01', name: 'Estrutura metálica', phase: 'Fabricação', unit: 'kg', budgeted_qty: 50000, executed_qty: 12000, budgeted_cost: 400000, sale_price: 600000, sale_direct: null, budget_base: 600000, target_margin: null, fab_weight: 0.6, estimate_to_complete: null, planned_start: '2026-06-15', planned_end: '2026-10-15', actual_start: '2026-06-20', actual_end: null, status: 'Em andamento', manager_id: GESTOR, default_category: 'Outros custos diretos', notes: null, active: true }],
  demand: [{ id: DEM_1, project_id: OBRA_1, service_id: SERV_1, title: 'Diário de obra', description: null, period: 'Diária', assignee_id: GESTOR, due_on: null, active: true, created_at: '2026-06-20T10:00:00Z', created_by: ADMIN }],
  demand_completion: [{ demand_id: DEM_1, completed_on: '2026-09-02' }, { demand_id: DEM_1, completed_on: '2026-09-01' }],
  production_order: [{ id: ORD_1, project_id: OBRA_1, service_id: SERV_1, kind: 'Fabricação', code: 'OP-01', description: 'Pórticos', quantity: 10000, unit: 'kg', priority: 'Normal', needed_on: '2026-09-30', notes: null, created_at: '2026-08-01T10:00:00Z', created_by: ADMIN, cancelled: false }],
  production_stage: [{ order_id: ORD_1, stage_order: 1, name: 'Corte', status: 'Concluída', completed_qty: 10000, started_on: '2026-08-02', finished_on: '2026-08-05', responsible: 'Fábrica', notes: null }],
  worker: [{ id: WORKER_1, organization_id: ORG, name: 'Soldador', role_name: 'Soldador', employment: 'CLT', team: 'Fábrica A', location: 'Fábrica', default_project_id: null, hourly_cost: 35, daily_hours: 8.8, profile_id: null, phone: null, hired_on: '2025-03-01', active: true, notes: null }],
  timesheet: [{ id: TS_1, organization_id: ORG, work_date: '2026-09-02', location: 'Fábrica', project_id: null, team: 'Fábrica A', weather: null, notes: null, photos: [], status: 'Fechado', responsible_id: ADMIN, created_at: '2026-09-02T18:00:00Z', closed_at: '2026-09-02T19:00:00Z' }],
  timesheet_line: [{ timesheet_id: TS_1, worker_id: WORKER_1, attendance: 'P', hours: 8.8, overtime_hours: 1, service_id: null, order_id: ORD_1, note: null }],
  timesheet_output: [{ timesheet_id: TS_1, service_id: SERV_1, order_id: ORD_1, description: 'Solda', quantity: 900, unit: 'kg' }],
  timesheet_incident: [{ timesheet_id: TS_1, kind: 'Falta de material', description: null, lost_hours: 1.5 }],
  measurement: [{ id: MED_1, project_id: OBRA_1, service_id: SERV_1, number: 'E01', month_no: 1, stage: 'Fabricação', title: 'Evento 1', scope: 'Pórticos', criteria: 'Fabricado', documents: 'Romaneio', kind: 'Física', approver: 'Cliente', planned_on: '2026-07-30', gross_amount: 100000, direct_amount: 40000, contractor_amount: 60000, retention_amount: 5000, planned_progress: 0.1, status: 'Medida', measured_on: '2026-07-28', measured_amount: 100000, entry_id: LANC_1, notes: null }],
  purchase_order: [{ id: PED_1, organization_id: ORG, code: 'PC-01', project_id: OBRA_1, service_id: SERV_1, supplier_name: 'Aço SA', document: null, order_date: '2026-08-10', expected_on: '2026-08-20', payment_days: 28, chart_account_id: PLANO_2, direct_billing: false, status: 'Emitido', entry_id: null, notes: null, created_at: '2026-08-10T10:00:00Z', created_by: 'Compras', updated_at: '2026-08-10T10:00:00Z' }],
  purchase_order_item: [{ id: '00000000-0000-4000-8000-000000000341', order_id: PED_1, item_order: 1, input_id: INS_1, description: 'Perfil W', unit: 'kg', quantity: 5000, unit_price: 8.5, received_qty: 0 }],
  assembly: [{ id: CONJ_1, project_id: OBRA_1, service_id: SERV_1, order_id: ORD_1, mark: 'P-01', description: 'Pilar', profile: 'W 250', kind: 'Pilar', quantity: 4, unit_weight: 320, revision: 'A', released_on: '2026-08-01', fabricated_qty: 4, shipped_qty: 2, erected_qty: 0, notes: null, updated_at: '2026-09-01T10:00:00Z' }],
  service_progress: [{ id: AV_1, project_id: OBRA_1, service_id: SERV_1, measured_on: '2026-08-31', quantity: 12000, pct: null, description: 'apontado', evidence: null, created_by: ADMIN, created_at: '2026-08-31T10:00:00Z' }],
  station_log: [{ id: EST_1, log_date: '2026-09-02', project_id: OBRA_1, service_id: SERV_1, order_id: ORD_1, line: 'Fábrica', station: 'Solda', assemblies: [{ conjuntoId: CONJ_1, quantidade: 2 }], pieces: 8, weight_kg: 640, workers: [{ colaboradorId: WORKER_1, horas: 8.8 }], notes: null, created_by: ADMIN, created_at: '2026-09-02T18:00:00Z' }],
  shipment: [{ id: ROM_1, organization_id: ORG, project_id: OBRA_1, number: 'ROM-0001', shipped_on: '2026-09-03', carrier: 'Transportadora', plate: 'ABC1D23', driver: null, destination: 'Obra Um', items: [{ conjuntoId: CONJ_1, quantidade: 2 }], status: 'Em trânsito', delivered_on: null, notes: null, created_by: ADMIN, created_at: '2026-09-03T08:00:00Z' }],
  stock_item: [{ id: ITEM_1, organization_id: ORG, code: 'AC-01', description: 'Perfil W 250', family: 'perfil', catalog_input_id: INS_1, unit_weight: null, min_stock: 1000, active: true, notes: null }],
  stock_movement: [{ id: MOV_1, organization_id: ORG, moved_on: '2026-08-20', kind: 'Entrada', item_id: ITEM_1, location: 'Fábrica', project_id: null, service_id: null, order_id: null, assemblies: [], quantity_kg: 5000, pieces: 40, heat_number: 'H-1', certificate: 'C-1', supplier: 'Aço SA', purchase_order_id: PED_1, invoice: 'NF 9', unit_cost: 8.5, origin_id: null, origin_kind: null, notes: null, created_by: ADMIN, created_at: '2026-08-20T10:00:00Z' }],
  catalog_input: [{ id: INS_1, organization_id: ORG, code: '00001', description: 'Aço perfil W', unit: 'kg', kind: 'Material', source: 'SINAPI', price: 8.5, price_date: '2026-07-01', price_source: 'GO', class_name: null, active: true, notes: null }],
  catalog_composition: [{ id: COMP_1, organization_id: ORG, code: 'EIFF-EST-KG', description: 'Estrutura por kg', unit: 'kg', group_name: 'Estrutura', source: 'Própria', active: true, notes: null }],
  catalog_composition_item: [{ composition_id: COMP_1, item_order: 1, input_id: INS_1, child_composition_id: null, coefficient: 1.05 }],
  estimate: [{ id: ORC_1, organization_id: ORG, code: 'ORC-01', title: 'Proposta', client_name: 'Cliente', project_id: OBRA_1, estimate_date: '2026-05-05', valid_until: '2026-06-05', status: 'Contratado', bdi: 0.25, price_reference: 'SINAPI 07/2026', notes: null, created_at: '2026-05-05T10:00:00Z', created_by: 'Augusto', updated_at: '2026-05-05T10:00:00Z' }],
  estimate_item: [{ id: '00000000-0000-4000-8000-000000000351', estimate_id: ORC_1, item_order: 1, stage: 'Estrutura', code: '10.3', description: 'Estrutura metálica', unit: 'kg', quantity: 50000, composition_id: COMP_1, manual_unit_cost: null, sale_unit_price: 12, service_id: SERV_1 }],
  training_progress: [{ id: TREINO_1, user_id: GESTOR, lesson_id: 'obra-360', completed_at: '2026-08-01T10:00:00Z', score: 1 }],
  field_photo: [{ id: FOTO_1, project_id: OBRA_1, ref_type: 'apontamento', ref_id: TS_1, taken_at: '2026-09-02T17:00:00Z', taken_by: ADMIN, note: null, data_url: null, storage_path: `${ORG}/${OBRA_1}/${FOTO_1}.jpg` }],
  job_function: [{ id: FUNC_1, organization_id: ORG, name: 'Soldador', category: 'Fábrica', default_hourly_cost: 35, description: null, active: true }],
  worker_allocation: [{ id: ALOC_1, worker_id: WORKER_1, location: 'Fábrica', project_id: null, starts_on: '2026-01-01', ends_on: null, share: 1, notes: null }],
};

/** Cliente falso: `from(t).select()` com cadeia fluente e `await` resolvendo as linhas da fixture. */
function clienteFalso(fixture: Record<string, Row[]>) {
  const builder = (tabela: string) => {
    let de = 0; let ate = Infinity;
    const q: Record<string, unknown> = {};
    const fluente = ['select', 'order', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'gt', 'lt', 'limit', 'filter', 'or', 'ilike'];
    for (const m of fluente) q[m] = () => q;
    q.range = (a: number, b: number) => { de = a; ate = b + 1; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: (fixture[tabela] ?? []).slice(de, ate), error: null }).then(res, rej);
    return q;
  };
  return {
    from: (tabela: string) => builder(tabela),
    auth: { getSession: async () => ({ data: { session: { user: { id: ADMIN, email: 'augusto@eiff.com.br' }, access_token: 't' } } }) },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => clienteFalso(FIXTURE) }));

describe('paridade linha -> Dataset', () => {
  let carregado: { ds: unknown; usuario: unknown };
  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://paridade.local');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-de-teste');
    vi.resetModules();
    const mod = await import('./supabase');
    carregado = await mod.carregarRemoto();
  });

  it('carregarRemoto monta o mesmo Dataset de sempre a partir das mesmas linhas (snapshot)', () => {
    // JSON: o snapshot nao depende de undefined vs ausente nem de Map/Set
    expect(JSON.parse(JSON.stringify(carregado.ds))).toMatchSnapshot();
  });

  it('o usuario da sessao e o perfil do banco, com escopo corporativo', () => {
    expect(carregado.usuario).toEqual({ id: ADMIN, nome: 'Augusto', email: 'augusto@eiff.com.br', papel: 'Administrador', obras: '*', ativo: true });
  });
});

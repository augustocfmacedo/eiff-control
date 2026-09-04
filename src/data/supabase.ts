// Provider remoto: Supabase/PostgreSQL (Fase 1 do blueprint).
// Le o modelo canonico para o formato Dataset usado pelas telas e pelo motor, e grava de volta as
// diferencas produzidas pelas acoes do store. Toda regra critica tambem existe no banco (triggers/RLS),
// entao o servidor rejeita o que o cliente nao deveria fazer.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Aprovacao,
  Dataset,
  Lancamento,
  Obra,
  Papel,
  Params,
  Usuario,
} from '../core/types';
import { mapaPlano } from '../core/engine';

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
export const remotoAtivo = !!(URL && KEY);
export const supabase: SupabaseClient | null = remotoAtivo ? createClient(URL!, KEY!) : null;

 
type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RemotoError extends Error {}
const falha = (ctx: string, e: { message?: string } | null) => {
  if (e) throw new RemotoError(`${ctx}: ${e.message ?? 'erro desconhecido'}`);
};

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------
export async function sessaoAtual(): Promise<{ userId: string; email: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  return u ? { userId: u.id, email: u.email ?? '' } : null;
}

export async function login(email: string, senha: string): Promise<void> {
  if (!supabase) throw new RemotoError('Supabase não configurado.');
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw new RemotoError(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message);
}

export async function logout(): Promise<void> {
  await supabase?.auth.signOut();
}

export function aoMudarSessao(cb: (ativa: boolean) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evt, session) => cb(!!session));
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Referencias (codigo humano <-> uuid)
// ---------------------------------------------------------------------------
interface Refs {
  orgId: string;
  companyId: string;
  plano: Map<string, string>; // categoria -> id
  planoInv: Map<string, string>; // id -> categoria
  obras: Map<string, string>; // codigo -> id
  obrasInv: Map<string, string>;
  contas: Map<string, string>; // instituicao -> id
  contasInv: Map<string, string>;
  lancs: Map<string, string>; // code -> id
  lancsInv: Map<string, string>;
  trans: Map<string, string>; // app id (external_id ou uuid) -> uuid
  aprov: Map<string, string>; // code -> id
  perfis: Map<string, string>; // id -> nome
  perfisInv: Map<string, string>; // nome -> id
  servicos: Map<string, string>; // app id -> uuid
  demandas: Map<string, string>;
  ordens: Map<string, string>;
  colaboradores: Map<string, string>;
  apontamentos: Map<string, string>;
  medicoes: Map<string, string>;
  insumos: Map<string, string>; // app id -> uuid
  composicoes: Map<string, string>;
  orcamentos: Map<string, string>;
  pedidos: Map<string, string>;
  conjuntos: Map<string, string>;
  avancos: Map<string, string>;
}
let refs: Refs | null = null;

const CORPORATIVOS: Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria', 'Compras'];

async function sel(tabela: string, colunas = '*', filtro?: (q: any) => any): Promise<Row[]> {
  let q = supabase!.from(tabela).select(colunas);
  if (filtro) q = filtro(q);
  const { data, error } = await q;
  falha(`ler ${tabela}`, error);
  return (data ?? []) as Row[];
}

/** Le a tabela inteira em paginas de 1000 linhas (limite padrao do PostgREST). */
async function selTodos(tabela: string, ordem: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase!.from(tabela).select('*').order(ordem).order('id').range(de, de + 999);
    falha(`ler ${tabela}`, error);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leitura: banco -> Dataset
// ---------------------------------------------------------------------------
export async function carregarRemoto(): Promise<{ ds: Dataset; usuario: Usuario }> {
  if (!supabase) throw new RemotoError('Supabase não configurado.');
  const sessao = await sessaoAtual();
  if (!sessao) throw new RemotoError('Sem sessão.');

  const [perfis, orgs, companies] = await Promise.all([sel('profile'), sel('organization'), sel('company')]);
  const meu = perfis.find((p) => p.id === sessao.userId);
  if (!meu) throw new RemotoError(`Usuário ${sessao.email} autenticado, mas sem perfil na tabela profile. Execute supabase/seed_profiles.sql.`);
  const org = orgs[0];
  const company = companies[0];
  if (!org || !company) throw new RemotoError('Organização/empresa não encontradas. Execute supabase/deploy.sql.');

  const [params, fatores, plano, contas, obras, lancs, liqs, trans, recs, dividas, aprovs, steps, coms, tasks, closes, audit, scopes] = await Promise.all([
    sel('parameter_set', '*', (q) => q.eq('active', true).limit(1)),
    sel('scenario_factor'),
    sel('chart_account', '*', (q) => q.order('category')),
    sel('bank_account', '*', (q) => q.order('code')),
    sel('project', '*', (q) => q.order('code')),
    sel('financial_entry', '*', (q) => q.order('code')),
    sel('settlement', '*', (q) => q.eq('reversed', false).order('settled_on')),
    sel('bank_transaction', '*', (q) => q.order('transaction_date', { ascending: false })),
    sel('reconciliation'),
    sel('debt', '*', (q) => q.order('code')),
    sel('approval_request', '*', (q) => q.order('requested_at', { ascending: false })),
    sel('approval_step', '*', (q) => q.order('step_order')),
    sel('comment', '*', (q) => q.order('created_at')),
    sel('task', '*', (q) => q.order('created_at')),
    sel('period_close'),
    sel('audit_log', '*', (q) => q.order('occurred_at', { ascending: false }).limit(500)),
    sel('user_scope'),
  ]);
  const [servicosRows, demandasRows, conclusoesRows, ordensRows, etapasRows] = await Promise.all([
    sel('project_service', '*', (q) => q.order('code')),
    sel('demand', '*', (q) => q.order('created_at')),
    sel('demand_completion'),
    sel('production_order', '*', (q) => q.order('code')),
    sel('production_stage', '*', (q) => q.order('stage_order')),
  ]);
  const [workers, timesheets, tsLines, tsOutputs, tsIncidents, medicoesRows] = await Promise.all([
    sel('worker', '*', (q) => q.order('name')),
    sel('timesheet', '*', (q) => q.order('work_date', { ascending: false }).limit(2000)),
    sel('timesheet_line'),
    sel('timesheet_output'),
    sel('timesheet_incident'),
    sel('measurement', '*', (q) => q.order('month_no').order('number')),
  ]);
  const [pedidosRows, pedidosItens, conjuntosRows, avancosRows] = await Promise.all([selTodos('purchase_order', 'code'), selTodos('purchase_order_item', 'item_order'), selTodos('assembly', 'mark'), selTodos('service_progress', 'measured_on')]);
  const pedItensPor = new Map<string, Row[]>();
  for (const i of pedidosItens) pedItensPor.set(i.order_id, [...(pedItensPor.get(i.order_id) ?? []), i]);
  const [insumosRows, compRows, compItens, estRows, estItens] = await Promise.all([
    selTodos('catalog_input', 'code'),
    selTodos('catalog_composition', 'code'),
    selTodos('catalog_composition_item', 'item_order'),
    selTodos('estimate', 'code'),
    selTodos('estimate_item', 'item_order'),
  ]);
  const compItensPor = new Map<string, Row[]>();
  for (const i of compItens) compItensPor.set(i.composition_id, [...(compItensPor.get(i.composition_id) ?? []), i]);
  const estItensPor = new Map<string, Row[]>();
  for (const i of estItens) estItensPor.set(i.estimate_id, [...(estItensPor.get(i.estimate_id) ?? []), i]);
  const linhasPor = new Map<string, Row[]>();
  for (const l of tsLines) linhasPor.set(l.timesheet_id, [...(linhasPor.get(l.timesheet_id) ?? []), l]);
  const prodPor = new Map<string, Row[]>();
  for (const p of tsOutputs) prodPor.set(p.timesheet_id, [...(prodPor.get(p.timesheet_id) ?? []), p]);
  const ocPor = new Map<string, Row[]>();
  for (const o of tsIncidents) ocPor.set(o.timesheet_id, [...(ocPor.get(o.timesheet_id) ?? []), o]);

  const perfilNome = new Map<string, string>(perfis.map((p) => [p.id, p.name]));
  const nome = (id?: string | null) => (id ? perfilNome.get(id) ?? id : 'sistema');
  refs = {
    orgId: org.id,
    companyId: company.id,
    plano: new Map(plano.map((p) => [p.category, p.id])),
    planoInv: new Map(plano.map((p) => [p.id, p.category])),
    obras: new Map(obras.map((o) => [o.code, o.id])),
    obrasInv: new Map(obras.map((o) => [o.id, o.code])),
    contas: new Map(contas.map((c) => [c.institution, c.id])),
    contasInv: new Map(contas.map((c) => [c.id, c.institution])),
    lancs: new Map(lancs.map((l) => [l.code, l.id])),
    lancsInv: new Map(lancs.map((l) => [l.id, l.code])),
    trans: new Map(trans.map((t) => [t.external_id ?? t.id, t.id])),
    aprov: new Map(aprovs.filter((a) => a.code).map((a) => [a.code, a.id])),
    perfis: perfilNome,
    perfisInv: new Map(perfis.map((p) => [p.name, p.id])),
    servicos: new Map(servicosRows.map((s) => [s.id, s.id])),
    demandas: new Map(demandasRows.map((d) => [d.id, d.id])),
    ordens: new Map(ordensRows.map((o) => [o.id, o.id])),
    colaboradores: new Map(workers.map((w) => [w.id, w.id])),
    apontamentos: new Map(timesheets.map((t) => [t.id, t.id])),
    medicoes: new Map(medicoesRows.map((m) => [m.id, m.id])),
    insumos: new Map(insumosRows.map((x) => [x.id, x.id])),
    composicoes: new Map(compRows.map((x) => [x.id, x.id])),
    orcamentos: new Map(estRows.map((x) => [x.id, x.id])),
    pedidos: new Map(pedidosRows.map((x) => [x.id, x.id])),
    conjuntos: new Map(conjuntosRows.map((x) => [x.id, x.id])),
    avancos: new Map(avancosRows.map((x) => [x.id, x.id])),
  };
  const r = refs;
  const concluidasPor = new Map<string, string[]>();
  for (const c of conclusoesRows) concluidasPor.set(c.demand_id, [...(concluidasPor.get(c.demand_id) ?? []), c.completed_on]);
  const etapasPor = new Map<string, Row[]>();
  for (const e of etapasRows) etapasPor.set(e.order_id, [...(etapasPor.get(e.order_id) ?? []), e]);

  const p = params[0];
  const fator = (c: string) => {
    const f = fatores.find((x) => x.parameter_set_id === p?.id && x.scenario === c);
    return f ? { entradas: Number(f.inflow_factor), saidas: Number(f.outflow_factor) } : { entradas: 1, saidas: 1 };
  };
  const dsParams: Params = {
    organizacao: org.name,
    empresa: company.name,
    dataBase: p?.base_date ?? new Date().toISOString().slice(0, 10),
    dataBaseAutomatica: !!p?.auto_base_date,
    cenario: p?.scenario ?? 'Base',
    incluirDemo: !!p?.include_demo,
    reservaMinima: Number(p?.min_reserve ?? 0),
    fatores: { Conservador: fator('Conservador'), Base: fator('Base'), Otimista: fator('Otimista') },
    alcadas: {
      limiteGestorObra: Number(p?.limit_project_manager ?? 0),
      limiteFinanceiro: Number(p?.limit_finance ?? 0),
      limiteDiretoria: Number(p?.limit_board ?? 0),
      desvioOrcamentoPermitido: Number(p?.budget_deviation_allowed ?? 0.05),
      toleranciaConciliacao: Number(p?.reconciliation_tolerance ?? 0.01),
      slaAprovacaoHoras: Number(p?.approval_sla_hours ?? 48),
    },
    responsavel: p?.responsible ?? '',
    versao: p?.version ?? '',
  };

  const recPorTrans = new Map<string, Row[]>();
  for (const rc of recs) recPorTrans.set(rc.bank_transaction_id, [...(recPorTrans.get(rc.bank_transaction_id) ?? []), rc]);
  const stepsPorReq = new Map<string, Row[]>();
  for (const s of steps) stepsPorReq.set(s.request_id, [...(stepsPorReq.get(s.request_id) ?? []), s]);

  const usuarios: Usuario[] = perfis.map((pf) => {
    const meus = scopes.filter((s) => s.profile_id === pf.id);
    const todas = CORPORATIVOS.includes(pf.role) || meus.some((s) => !s.project_id);
    return { id: pf.id, nome: pf.name, email: pf.email, papel: pf.role, obras: todas ? '*' : meus.map((s) => r.obrasInv.get(s.project_id) ?? '').filter(Boolean), ativo: pf.active };
  });

  const ds: Dataset = {
    params: dsParams,
    planoContas: plano.map((x) => ({ categoria: x.category, tipo: x.entry_type, grupoFluxo: x.cash_group, grupoDre: x.dre_group, classe: x.account_class, orientacao: x.guidance ?? '', ativa: x.active })),
    contas: contas.map((c) => ({ id: c.code, registro: c.record_kind, instituicao: c.institution, conta: c.account_label, tipo: c.account_type, saldoInicial: Number(c.opening_balance), saldoInicialData: c.opening_balance_date ?? undefined, reservaVinculada: Number(c.linked_reserve), ativa: c.active })),
    obras: obras.map((o) => ({
      codigo: o.code, registro: o.record_kind, nome: o.name, cliente: o.client_name ?? '', cidadeUf: o.city_state ?? '', status: o.status, escopo: o.scope ?? '',
      assinatura: o.signed_at ?? undefined, inicio: o.starts_at ?? undefined, fimContratual: o.contractual_end ?? undefined,
      valorContrato: Number(o.contract_value), aditivos: Number(o.addenda_value), custoOrcado: Number(o.budgeted_cost), execucaoFisica: Number(o.physical_progress),
      medidoFaturado: Number(o.measured_invoiced), estimativaConcluir: Number(o.estimate_to_complete), margemAlvo: o.target_margin === null || o.target_margin === undefined ? undefined : Number(o.target_margin), observacoes: o.notes ?? '', responsavel: o.manager_id ?? undefined,
    })),
    lancamentos: lancs.map((l) => ({
      id: l.code, registro: l.record_kind, categoria: r.planoInv.get(l.chart_account_id) ?? '', subcategoria: l.sub_category ?? '', centroCusto: l.cost_center_label ?? (l.project_id ? 'Obra' : 'Corporativo'),
      codigoObra: l.project_id ? r.obrasInv.get(l.project_id) ?? '' : '', servicoId: l.service_id ?? undefined, contraparte: l.counterparty_name ?? '', documento: l.document_number ?? '', descricao: l.description,
      competencia: l.competence_date, vencimento: l.due_date ?? '', realizacao: l.settlement_date ?? undefined, status: l.status, confiabilidade: l.confidence, probabilidade: Number(l.probability),
      contaFinanceira: l.bank_account_id ? r.contasInv.get(l.bank_account_id) ?? '' : '', valorBruto: Number(l.gross_amount), retencoes: Number(l.tax_amount), desconto: Number(l.discount_amount), multaJuros: Number(l.interest_amount),
      valorRealizado: Number(l.settled_amount) > 0 ? Number(l.settled_amount) : undefined, conciliado: l.reconciled, observacoes: l.notes ?? '', anexos: [], origem: l.source_system, idExterno: l.external_id ?? undefined,
      criadoEm: l.created_at, criadoPor: nome(l.created_by), atualizadoEm: l.updated_at, atualizadoPor: nome(l.updated_by), versao: l.version, motivoCancelamento: l.cancellation_reason ?? undefined, faturamentoDireto: !!l.direct_billing,
    })),
    liquidacoes: liqs.map((q) => ({ id: q.id, lancamentoId: r.lancsInv.get(q.entry_id) ?? '', data: q.settled_on, valor: Number(q.amount), conta: r.contasInv.get(q.bank_account_id) ?? '', documento: q.document_number ?? undefined, criadoPor: nome(q.created_by), criadoEm: q.created_at })),
    transacoes: trans.map((t) => {
      const links = recPorTrans.get(t.id) ?? [];
      return { id: t.external_id ?? t.id, registro: t.record_kind, data: t.transaction_date, conta: r.contasInv.get(t.bank_account_id) ?? '', historico: t.description ?? '', documento: t.document_number ?? '', debito: Number(t.debit), credito: Number(t.credit), lancamentoIds: links.map((x) => r.lancsInv.get(x.entry_id) ?? '').filter(Boolean), justificativa: links.find((x) => x.justification)?.justification ?? undefined, origem: 'supabase', idExterno: t.external_id ?? undefined };
    }),
    dividas: dividas.map((d) => ({ id: d.code, registro: d.record_kind, credor: d.creditor_name ?? '', instrumento: d.instrument, contratacao: d.contracted_at ?? undefined, principal: Number(d.principal), saldoDevedor: Number(d.outstanding_balance), taxaAa: Number(d.annual_rate ?? 0), parcelaMensal: Number(d.monthly_installment ?? 0), proximoVencimento: d.next_due_date ?? undefined, parcelasRestantes: Number(d.remaining_installments ?? 0), garantia: d.guarantee ?? '', status: d.status, observacoes: d.notes ?? '' })),
    aprovacoes: aprovs.map((a) => ({
      id: a.code ?? a.id, tipo: a.entity_kind, entidadeId: r.lancsInv.get(a.entity_id) ?? a.entity_id, titulo: a.title, valor: Number(a.amount), codigoObra: a.project_id ? r.obrasInv.get(a.project_id) : undefined,
      solicitante: nome(a.requested_by), criadoEm: a.requested_at, prazoSla: a.sla_deadline, status: a.status, impacto: a.impact ?? {}, justificativaExcecao: a.exception_justification ?? undefined,
      etapas: (stepsPorReq.get(a.id) ?? []).map((s) => ({ papel: s.role, status: s.status, decididoPor: s.decided_by ? nome(s.decided_by) : undefined, decididoEm: s.decided_at ?? undefined, justificativa: s.justification ?? undefined })),
    })),
    auditoria: audit.map((a) => ({ id: String(a.id), ts: a.occurred_at, usuario: nome(a.actor_id), acao: a.action, entidade: a.entity_type, entidadeId: a.entity_id ?? '', antes: a.before_data ?? undefined, depois: a.after_data ?? undefined, motivo: a.reason ?? undefined })),
    comentarios: coms.map((c) => ({ id: c.id, entidade: c.entity_type, entidadeId: c.entity_id, autor: nome(c.author_id), ts: c.created_at, texto: c.body, mencoes: [] })),
    tarefas: tasks.map((t) => ({
      id: t.id, titulo: t.title, descricao: t.description ?? undefined, entidade: t.entity_type ?? undefined, entidadeId: t.entity_id ?? undefined, responsavel: t.assignee_id ?? '', prazo: t.due_on ?? '', status: t.status, origem: t.origin ?? '', criadoEm: t.created_at, criadoPor: nome(t.created_by),
      colaboradorId: t.worker_id ?? undefined, codigoObra: t.project_id ? r.obrasInv.get(t.project_id) : undefined, servicoId: t.service_id ?? undefined, ordemId: t.order_id ?? undefined, local: t.location ?? undefined, prioridade: t.priority ?? 'Normal', concluidoEm: t.done_at ?? undefined, bloqueio: t.blocked_reason ?? undefined,
    })),
    usuarios,
    fechamentos: closes.map((c) => ({ periodo: c.period, fechadoEm: c.closed_at, fechadoPor: nome(c.closed_by), reaberto: c.reopened_at ? { em: c.reopened_at, por: nome(c.reopened_by), motivo: c.reopen_reason ?? '' } : undefined })),
    servicos: servicosRows.map((s) => ({
      id: s.id, codigoObra: r.obrasInv.get(s.project_id) ?? '', codigo: s.code, nome: s.name, etapa: s.phase, unidade: s.unit, quantidadeOrcada: Number(s.budgeted_qty), quantidadeExecutada: Number(s.executed_qty),
      custoOrcado: Number(s.budgeted_cost), precoVenda: Number(s.sale_price), faturamentoDireto: s.sale_direct === null || s.sale_direct === undefined ? undefined : Number(s.sale_direct), valorBaseOrcamento: s.budget_base === null || s.budget_base === undefined ? undefined : Number(s.budget_base), margemAlvo: s.target_margin === null || s.target_margin === undefined ? undefined : Number(s.target_margin), pesoFabricacao: s.fab_weight === null || s.fab_weight === undefined ? undefined : Number(s.fab_weight), estimativaConcluir: s.estimate_to_complete === null ? undefined : Number(s.estimate_to_complete),
      inicioPrevisto: s.planned_start ?? undefined, fimPrevisto: s.planned_end ?? undefined, inicioReal: s.actual_start ?? undefined, fimReal: s.actual_end ?? undefined,
      status: s.status, responsavel: s.manager_id ?? undefined, categoriaPadrao: s.default_category ?? undefined, observacoes: s.notes ?? '', ativo: s.active,
    })),
    demandas: demandasRows.map((d) => ({
      id: d.id, codigoObra: r.obrasInv.get(d.project_id) ?? '', servicoId: d.service_id ?? undefined, titulo: d.title, descricao: d.description ?? '', periodicidade: d.period,
      responsavel: d.assignee_id ?? '', prazo: d.due_on ?? undefined, conclusoes: (concluidasPor.get(d.id) ?? []).sort(), ativo: d.active, criadoEm: d.created_at, criadoPor: nome(d.created_by),
    })),
    ordens: ordensRows.map((o) => ({
      id: o.id, codigoObra: r.obrasInv.get(o.project_id) ?? '', servicoId: o.service_id ?? undefined, tipo: o.kind, codigo: o.code, descricao: o.description, quantidade: Number(o.quantity), unidade: o.unit,
      prioridade: o.priority, dataNecessidade: o.needed_on ?? undefined, observacoes: o.notes ?? '', criadoEm: o.created_at, criadoPor: nome(o.created_by), cancelada: o.cancelled,
      etapas: (etapasPor.get(o.id) ?? []).map((e) => ({ nome: e.name, status: e.status, quantidadeConcluida: Number(e.completed_qty), inicio: e.started_on ?? undefined, fim: e.finished_on ?? undefined, responsavel: e.responsible ?? undefined, observacoes: e.notes ?? undefined })),
    })),
    colaboradores: workers.map((w) => ({
      id: w.id, nome: w.name, funcao: w.role_name, vinculo: w.employment, equipe: w.team ?? '', local: w.location, codigoObraPadrao: w.default_project_id ? r.obrasInv.get(w.default_project_id) : undefined,
      custoHora: Number(w.hourly_cost), jornadaDiaria: Number(w.daily_hours), usuarioId: w.profile_id ?? undefined, telefone: w.phone ?? undefined, admissao: w.hired_on ?? undefined, ativo: w.active, observacoes: w.notes ?? '',
    })),
    apontamentos: timesheets.map((t) => ({
      id: t.id, data: t.work_date, local: t.location, codigoObra: t.project_id ? r.obrasInv.get(t.project_id) : undefined, equipe: t.team ?? undefined, clima: t.weather ?? undefined, observacoes: t.notes ?? '', fotos: t.photos ?? [],
      status: t.status, responsavel: nome(t.responsible_id), criadoEm: t.created_at, fechadoEm: t.closed_at ?? undefined,
      linhas: (linhasPor.get(t.id) ?? []).map((l) => ({ colaboradorId: l.worker_id, presenca: l.attendance, horas: Number(l.hours), horasExtras: Number(l.overtime_hours), servicoId: l.service_id ?? undefined, ordemId: l.order_id ?? undefined, observacao: l.note ?? undefined })),
      producao: (prodPor.get(t.id) ?? []).map((p) => ({ servicoId: p.service_id ?? undefined, ordemId: p.order_id ?? undefined, descricao: p.description, quantidade: Number(p.quantity), unidade: p.unit })),
      ocorrencias: (ocPor.get(t.id) ?? []).map((o) => ({ tipo: o.kind, descricao: o.description ?? '', horasPerdidas: Number(o.lost_hours) })),
    })),
    insumos: [], composicoes: [], orcamentos: [], pedidos: [], conjuntos: [], avancos: [],
    medicoes: medicoesRows.map((m) => ({
      id: m.id, codigoObra: r.obrasInv.get(m.project_id) ?? '', servicoId: m.service_id ?? undefined, numero: m.number, mes: Number(m.month_no ?? 1), etapa: m.stage ?? '', evento: m.title ?? m.number, escopo: m.scope ?? '', criterio: m.criteria ?? '', documentos: m.documents ?? '',
      tipoMedicao: m.kind ?? '', responsavelAprovacao: m.approver ?? '', dataPrevista: m.planned_on ?? undefined, valorBruto: Number(m.gross_amount ?? m.amount ?? 0), faturamentoDireto: Number(m.direct_amount ?? 0), faturamentoConstrutora: Number(m.contractor_amount ?? m.amount ?? 0), retencao: Number(m.retention_amount ?? 0),
      pctEvolucaoPlanejada: Number(m.planned_progress ?? 0), status: m.status, dataMedicao: m.measured_on ?? undefined, valorMedido: m.measured_amount === null || m.measured_amount === undefined ? undefined : Number(m.measured_amount), lancamentoId: m.entry_id ? r.lancsInv.get(m.entry_id) : undefined, observacoes: m.notes ?? '',
    })),
  };
  const usuario = usuarios.find((u) => u.id === meu.id)!;
  ds.insumos = insumosRows.map((x) => ({ id: x.id, codigo: x.code, descricao: x.description, unidade: x.unit, tipo: x.kind, origem: x.source, preco: Number(x.price), precoData: x.price_date ?? undefined, precoFonte: x.price_source ?? undefined, classe: x.class_name ?? undefined, ativo: x.active, observacoes: x.notes ?? '' }));
  ds.composicoes = compRows.map((x) => ({
    id: x.id, codigo: x.code, descricao: x.description, unidade: x.unit, grupo: x.group_name ?? '', origem: x.source, ativo: x.active, observacoes: x.notes ?? '',
    itens: (compItensPor.get(x.id) ?? []).sort((a, b) => a.item_order - b.item_order).map((i) => ({ tipo: i.input_id ? ('Insumo' as const) : ('Composição' as const), refId: i.input_id ?? i.child_composition_id, coeficiente: Number(i.coefficient) })),
  }));
  ds.orcamentos = estRows.map((x) => ({
    id: x.id, codigo: x.code, titulo: x.title, cliente: x.client_name ?? '', codigoObra: x.project_id ? r.obrasInv.get(x.project_id) : undefined, data: x.estimate_date, validade: x.valid_until ?? undefined, status: x.status, bdi: Number(x.bdi), referenciaPrecos: x.price_reference ?? '',
    observacoes: x.notes ?? '', criadoEm: x.created_at, criadoPor: x.created_by ?? '', atualizadoEm: x.updated_at,
    itens: (estItensPor.get(x.id) ?? []).sort((a, b) => a.item_order - b.item_order).map((i) => ({ id: i.id, ordem: i.item_order, etapa: i.stage ?? '', codigo: i.code ?? '', descricao: i.description, unidade: i.unit, quantidade: Number(i.quantity), composicaoId: i.composition_id ?? undefined, custoUnitarioManual: i.manual_unit_cost === null || i.manual_unit_cost === undefined ? undefined : Number(i.manual_unit_cost), precoUnitarioVenda: i.sale_unit_price === null || i.sale_unit_price === undefined ? undefined : Number(i.sale_unit_price), servicoId: i.service_id ?? undefined })),
  }));
  ds.pedidos = pedidosRows.map((x) => ({
    id: x.id, codigo: x.code, codigoObra: r.obrasInv.get(x.project_id) ?? '', servicoId: x.service_id ?? undefined, fornecedor: x.supplier_name ?? '', documento: x.document ?? undefined, data: x.order_date, previsaoEntrega: x.expected_on ?? undefined,
    prazoPagamentoDias: Number(x.payment_days ?? 28), categoria: r.planoInv.get(x.chart_account_id) ?? '', faturamentoDireto: !!x.direct_billing, status: x.status, lancamentoId: x.entry_id ? r.lancsInv.get(x.entry_id) : undefined, observacoes: x.notes ?? '',
    criadoEm: x.created_at, criadoPor: x.created_by ?? '', atualizadoEm: x.updated_at,
    itens: (pedItensPor.get(x.id) ?? []).sort((a, b) => a.item_order - b.item_order).map((i) => ({ id: i.id, insumoId: i.input_id ?? undefined, descricao: i.description, unidade: i.unit, quantidade: Number(i.quantity), precoUnitario: Number(i.unit_price), quantidadeRecebida: Number(i.received_qty ?? 0) })),
  }));
  ds.conjuntos = conjuntosRows.map((x) => ({
    id: x.id, codigoObra: r.obrasInv.get(x.project_id) ?? '', servicoId: x.service_id ?? undefined, ordemId: x.order_id ?? undefined, marca: x.mark, descricao: x.description ?? '', perfil: x.profile ?? undefined, tipo: x.kind, quantidade: Number(x.quantity), pesoUnitario: Number(x.unit_weight),
    revisao: x.revision ?? undefined, liberadoEm: x.released_on ?? undefined, fabricadoQtd: Number(x.fabricated_qty ?? 0), expedidoQtd: Number(x.shipped_qty ?? 0), montadoQtd: Number(x.erected_qty ?? 0), observacoes: x.notes ?? '', atualizadoEm: x.updated_at,
  }));
  ds.avancos = avancosRows.map((x) => ({ id: x.id, codigoObra: r.obrasInv.get(x.project_id) ?? '', servicoId: x.service_id, data: x.measured_on, quantidade: Number(x.quantity), pct: x.pct === null || x.pct === undefined ? undefined : Number(x.pct), descricao: x.description ?? '', evidencia: x.evidence ?? undefined, responsavel: x.created_by ?? '', criadoEm: x.created_at }));
  return { ds, usuario };
}

// ---------------------------------------------------------------------------
// Escrita: diferencas do Dataset -> tabelas
// ---------------------------------------------------------------------------
const mudou = <T,>(antes: T[], depois: T[], chave: keyof T): T[] => {
  const a = new Map(antes.map((x) => [String(x[chave]), JSON.stringify(x)]));
  return depois.filter((x) => a.get(String(x[chave])) !== JSON.stringify(x));
};
const uuidOuNulo = (v?: string) => (v && UUID.test(v) ? v : null);

/**
 * Atualiza a linha que casa com `filtro` ou insere uma nova. Evita INSERT ... ON CONFLICT (upsert), que o
 * PostgreSQL avalia contra a politica de INSERT mesmo quando a linha ja existe e acaba negando sob RLS.
 */
async function gravar(tabela: string, filtro: Record<string, string | null | undefined>, row: Row, extraInsert: Row = {}): Promise<Row | undefined> {
  const sb = supabase!;
  if (Object.values(filtro).every((v) => v)) {
    let q = sb.from(tabela).update(row);
    for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v as string);
    const { data, error } = await q.select('id');
    falha(`atualizar ${tabela}`, error);
    if (data?.length) return data[0];
  }
  const { data, error } = await sb.from(tabela).insert({ ...row, ...extraInsert }).select('id');
  falha(`inserir ${tabela}`, error);
  return data?.[0];
}

export async function persistirRemoto(antes: Dataset, depois: Dataset, atorId: string): Promise<void> {
  if (!supabase || !refs) throw new RemotoError('Provider remoto não inicializado.');
  const r = refs;
  const sb = supabase;
  const tipoDe = mapaPlano(depois);

  // parametros
  if (JSON.stringify(antes.params) !== JSON.stringify(depois.params)) {
    const p = depois.params;
    const { data, error } = await sb.from('parameter_set').update({
      base_date: p.dataBase, auto_base_date: p.dataBaseAutomatica ?? false, scenario: p.cenario, include_demo: p.incluirDemo, min_reserve: p.reservaMinima,
      limit_project_manager: p.alcadas.limiteGestorObra, limit_finance: p.alcadas.limiteFinanceiro, limit_board: p.alcadas.limiteDiretoria,
      budget_deviation_allowed: p.alcadas.desvioOrcamentoPermitido, reconciliation_tolerance: p.alcadas.toleranciaConciliacao, approval_sla_hours: p.alcadas.slaAprovacaoHoras,
      responsible: p.responsavel, version: p.versao,
    }).eq('organization_id', r.orgId).eq('active', true).select('id');
    falha('salvar parâmetros', error);
    const pid = data?.[0]?.id;
    if (pid) {
      for (const c of ['Conservador', 'Base', 'Otimista'] as const) {
        await gravar('scenario_factor', { parameter_set_id: pid, scenario: c }, { inflow_factor: p.fatores[c].entradas, outflow_factor: p.fatores[c].saidas }, { parameter_set_id: pid, scenario: c });
      }
    }
  }

  // plano de contas
  for (const p of mudou(antes.planoContas, depois.planoContas, 'categoria')) {
    const data = await gravar('chart_account', { id: r.plano.get(p.categoria) }, { entry_type: p.tipo, cash_group: p.grupoFluxo, dre_group: p.grupoDre, account_class: p.classe, guidance: p.orientacao, active: p.ativa }, { organization_id: r.orgId, category: p.categoria });
    if (data) { r.plano.set(p.categoria, data.id); r.planoInv.set(data.id, p.categoria); }
  }

  // contas financeiras
  for (const c of mudou(antes.contas, depois.contas, 'id')) {
    const data = await gravar('bank_account', { organization_id: r.orgId, code: c.id }, { record_kind: c.registro, institution: c.instituicao, account_label: c.conta, account_type: c.tipo, opening_balance: c.saldoInicial, opening_balance_date: c.saldoInicialData ?? depois.params.dataBase, linked_reserve: c.reservaVinculada, active: c.ativa }, { organization_id: r.orgId, company_id: r.companyId, code: c.id });
    if (data) { r.contas.set(c.instituicao, data.id); r.contasInv.set(data.id, c.instituicao); }
  }

  // obras
  for (const o of mudou(antes.obras, depois.obras, 'codigo')) {
    const row = obraRow(o, r, atorId);
    const data = await gravar('project', { id: r.obras.get(o.codigo) }, row, { created_by: atorId });
    if (data) { r.obras.set(o.codigo, data.id); r.obrasInv.set(data.id, o.codigo); }
  }

  // liquidacoes revertidas (cancelamento/estorno) antes do titulo
  const liqDepois = new Set(depois.liquidacoes.map((q) => q.id));
  for (const q of antes.liquidacoes.filter((x) => !liqDepois.has(x.id) && UUID.test(x.id))) {
    const { error } = await sb.from('settlement').update({ reversed: true, reversal_reason: 'estorno/cancelamento do título' }).eq('id', q.id);
    falha('reverter liquidação', error);
  }

  // lancamentos
  const lancAntes = new Map(antes.lancamentos.map((l) => [l.id, l]));
  for (const l of mudou(antes.lancamentos, depois.lancamentos, 'id')) {
    const row = lancRow(l, r, tipoDe, atorId);
    const prev = lancAntes.get(l.id);
    if (prev && r.lancs.has(l.id)) {
      const { data, error } = await sb.from('financial_entry').update(row).eq('id', r.lancs.get(l.id)!).eq('version', prev.versao).select('id');
      falha(`salvar lançamento ${l.id}`, error);
      if (!data?.length) throw new RemotoError(`Lançamento ${l.id} foi alterado por outro usuário. Recarregue.`);
    } else {
      const { data, error } = await sb.from('financial_entry').insert({ ...row, code: l.id, organization_id: r.orgId, company_id: r.companyId, created_by: atorId }).select('id');
      falha(`criar lançamento ${l.id}`, error);
      if (data?.[0]) { r.lancs.set(l.id, data[0].id); r.lancsInv.set(data[0].id, l.id); }
    }
  }

  // liquidacoes alteradas (ex.: data de realizacao ajustada na grade)
  const liqAntesMapa = new Map(antes.liquidacoes.map((q) => [q.id, JSON.stringify(q)]));
  for (const q of depois.liquidacoes.filter((x) => UUID.test(x.id) && liqAntesMapa.has(x.id) && liqAntesMapa.get(x.id) !== JSON.stringify(x))) {
    const { error } = await sb.from('settlement').update({ settled_on: q.data, amount: q.valor, bank_account_id: r.contas.get(q.conta), document_number: q.documento }).eq('id', q.id);
    falha(`alterar liquidação de ${q.lancamentoId}`, error);
  }

  // liquidacoes novas
  const liqAntes = new Set(antes.liquidacoes.map((q) => q.id));
  for (const q of depois.liquidacoes.filter((x) => !liqAntes.has(x.id))) {
    const { error } = await sb.from('settlement').insert({ organization_id: r.orgId, entry_id: r.lancs.get(q.lancamentoId), settled_on: q.data, amount: q.valor, bank_account_id: r.contas.get(q.conta), document_number: q.documento, created_by: atorId });
    falha(`registrar liquidação de ${q.lancamentoId}`, error);
  }

  // transacoes bancarias e conciliacao
  const transAntes = new Map(antes.transacoes.map((t) => [t.id, t]));
  for (const t of mudou(antes.transacoes, depois.transacoes, 'id')) {
    let tid = r.trans.get(t.id);
    if (!tid) {
      const { data, error } = await sb.from('bank_transaction').insert({ organization_id: r.orgId, bank_account_id: r.contas.get(t.conta), record_kind: t.registro, external_id: t.idExterno ?? t.id, transaction_date: t.data, description: t.historico, document_number: t.documento, debit: t.debito, credit: t.credito }).select('id');
      falha('importar transação', error);
      tid = data?.[0]?.id;
      if (tid) r.trans.set(t.id, tid);
    }
    const prev = transAntes.get(t.id);
    if (tid && (!prev || JSON.stringify(prev.lancamentoIds) !== JSON.stringify(t.lancamentoIds) || prev.justificativa !== t.justificativa)) {
      const { error: e1 } = await sb.from('reconciliation').delete().eq('bank_transaction_id', tid);
      falha('limpar vínculos', e1);
      const movimento = t.credito - t.debito;
      for (const lid of t.lancamentoIds) {
        const lc = depois.lancamentos.find((x) => x.id === lid);
        const conciliado = !!lc?.conciliado;
        const { error: e2 } = await sb.from('reconciliation').insert({ organization_id: r.orgId, bank_transaction_id: tid, entry_id: r.lancs.get(lid), matched_amount: movimento, difference: 0, status: conciliado ? 'Conciliado' : 'Divergente', justification: t.justificativa ?? null, reconciled_at: new Date().toISOString(), reconciled_by: atorId });
        falha('vincular conciliação', e2);
      }
    }
  }

  // dividas
  for (const d of mudou(antes.dividas, depois.dividas, 'id')) {
    await gravar('debt', { organization_id: r.orgId, code: d.id }, { record_kind: d.registro, creditor_name: d.credor, instrument: d.instrumento, contracted_at: d.contratacao ?? null, principal: d.principal, outstanding_balance: d.saldoDevedor, annual_rate: d.taxaAa, monthly_installment: d.parcelaMensal, next_due_date: d.proximoVencimento ?? null, remaining_installments: d.parcelasRestantes, guarantee: d.garantia, status: d.status, notes: d.observacoes }, { organization_id: r.orgId, company_id: r.companyId, code: d.id });
  }

  // aprovacoes
  for (const a of mudou(antes.aprovacoes, depois.aprovacoes, 'id')) {
    let aid = r.aprov.get(a.id) ?? uuidOuNulo(a.id);
    const base = { entity_kind: a.tipo, entity_id: r.lancs.get(a.entidadeId) ?? uuidOuNulo(a.entidadeId), title: a.titulo, amount: a.valor, project_id: a.codigoObra ? r.obras.get(a.codigoObra) ?? null : null, sla_deadline: a.prazoSla, status: a.status, impact: a.impacto, exception_justification: a.justificativaExcecao ?? null };
    if (!aid) {
      const { data, error } = await sb.from('approval_request').insert({ ...base, code: a.id, organization_id: r.orgId, company_id: r.companyId, requested_by: atorId, requested_at: a.criadoEm }).select('id');
      falha(`abrir aprovação ${a.id}`, error);
      aid = data?.[0]?.id;
      if (aid) r.aprov.set(a.id, aid);
      if (aid) for (const [i, e] of a.etapas.entries()) {
        const { error: e2 } = await sb.from('approval_step').insert({ request_id: aid, step_order: i + 1, role: e.papel, status: e.status });
        falha('criar etapa', e2);
      }
    } else {
      const { error } = await sb.from('approval_request').update(base).eq('id', aid);
      falha(`atualizar aprovação ${a.id}`, error);
      for (const [i, e] of a.etapas.entries()) {
        const { error: e2 } = await sb.from('approval_step').update({ status: e.status, decided_by: e.decididoPor ? r.perfisInv.get(e.decididoPor) ?? null : null, decided_at: e.decididoEm ?? null, justification: e.justificativa ?? null }).eq('request_id', aid).eq('step_order', i + 1);
        falha('decidir etapa', e2);
      }
    }
  }

  // comentarios e tarefas
  const comAntes = new Set(antes.comentarios.map((c) => c.id));
  for (const c of depois.comentarios.filter((x) => !comAntes.has(x.id))) {
    const { error } = await sb.from('comment').insert({ organization_id: r.orgId, entity_type: c.entidade, entity_id: uuidOuNulo(c.entidadeId) ?? r.lancs.get(c.entidadeId) ?? r.obras.get(c.entidadeId) ?? r.aprov.get(c.entidadeId), author_id: atorId, body: c.texto });
    falha('comentar', error);
  }
  for (const t of mudou(antes.tarefas, depois.tarefas, 'id')) {
    const row = {
      organization_id: r.orgId, title: t.titulo, description: t.descricao ?? null, entity_type: t.entidade ?? null, entity_id: t.entidadeId ? uuidOuNulo(t.entidadeId) ?? r.lancs.get(t.entidadeId) ?? r.obras.get(t.entidadeId) ?? null : null,
      assignee_id: uuidOuNulo(t.responsavel), due_on: t.prazo || null, status: t.status, origin: t.origem,
      worker_id: t.colaboradorId ? r.colaboradores.get(t.colaboradorId) ?? null : null, project_id: t.codigoObra ? r.obras.get(t.codigoObra) ?? null : null,
      service_id: t.servicoId ? r.servicos.get(t.servicoId) ?? null : null, order_id: t.ordemId ? r.ordens.get(t.ordemId) ?? null : null, location: t.local ?? null,
      priority: t.prioridade ?? 'Normal', done_at: t.concluidoEm ?? null, blocked_reason: t.bloqueio ?? null,
    };
    const { error } = UUID.test(t.id) ? await sb.from('task').update(row).eq('id', t.id) : await sb.from('task').insert({ ...row, created_by: atorId });
    falha('salvar tarefa', error);
  }

  // colaboradores
  for (const c of mudou(antes.colaboradores ?? [], depois.colaboradores ?? [], 'id')) {
    const row = { name: c.nome, role_name: c.funcao, employment: c.vinculo, team: c.equipe || null, location: c.local, default_project_id: c.codigoObraPadrao ? r.obras.get(c.codigoObraPadrao) ?? null : null, hourly_cost: c.custoHora, daily_hours: c.jornadaDiaria, profile_id: uuidOuNulo(c.usuarioId), phone: c.telefone ?? null, hired_on: c.admissao ?? null, active: c.ativo, notes: c.observacoes };
    const data = await gravar('worker', { id: r.colaboradores.get(c.id) }, row, { organization_id: r.orgId, company_id: r.companyId });
    if (data) r.colaboradores.set(c.id, data.id);
  }

  // apontamentos diarios (cabecalho + linhas, producao e ocorrencias substituidas por completo)
  const aptAntes = new Map((antes.apontamentos ?? []).map((a) => [a.id, JSON.stringify([a.linhas, a.producao, a.ocorrencias])]));
  for (const a of mudou(antes.apontamentos ?? [], depois.apontamentos ?? [], 'id')) {
    const row = { work_date: a.data, location: a.local, project_id: a.codigoObra ? r.obras.get(a.codigoObra) ?? null : null, team: a.equipe ?? null, weather: a.clima ?? null, notes: a.observacoes, photos: a.fotos, status: a.status, closed_at: a.fechadoEm ?? null };
    const data = await gravar('timesheet', { id: r.apontamentos.get(a.id) }, row, { organization_id: r.orgId, responsible_id: atorId });
    const tid = data?.id ?? r.apontamentos.get(a.id);
    if (data) r.apontamentos.set(a.id, data.id);
    if (tid && aptAntes.get(a.id) !== JSON.stringify([a.linhas, a.producao, a.ocorrencias])) {
      for (const tabela of ['timesheet_line', 'timesheet_output', 'timesheet_incident']) {
        const { error } = await sb.from(tabela).delete().eq('timesheet_id', tid);
        falha(`limpar ${tabela}`, error);
      }
      if (a.linhas.length) {
        const { error } = await sb.from('timesheet_line').insert(a.linhas.map((l) => ({ timesheet_id: tid, worker_id: r.colaboradores.get(l.colaboradorId) ?? l.colaboradorId, attendance: l.presenca, hours: l.horas, overtime_hours: l.horasExtras, service_id: l.servicoId ? r.servicos.get(l.servicoId) ?? null : null, order_id: l.ordemId ? r.ordens.get(l.ordemId) ?? null : null, note: l.observacao ?? null })));
        falha('gravar efetivo', error);
      }
      if (a.producao.length) {
        const { error } = await sb.from('timesheet_output').insert(a.producao.map((p) => ({ timesheet_id: tid, service_id: p.servicoId ? r.servicos.get(p.servicoId) ?? null : null, order_id: p.ordemId ? r.ordens.get(p.ordemId) ?? null : null, description: p.descricao, quantity: p.quantidade, unit: p.unidade })));
        falha('gravar produção', error);
      }
      if (a.ocorrencias.length) {
        const { error } = await sb.from('timesheet_incident').insert(a.ocorrencias.map((o) => ({ timesheet_id: tid, kind: o.tipo, description: o.descricao, lost_hours: o.horasPerdidas })));
        falha('gravar ocorrências', error);
      }
    }
  }

  // fechamentos
  for (const f of mudou(antes.fechamentos, depois.fechamentos, 'periodo')) {
    await gravar('period_close', { company_id: r.companyId, period: f.periodo }, { closed_at: f.fechadoEm, closed_by: atorId, reopened_at: f.reaberto?.em ?? null, reopened_by: f.reaberto ? atorId : null, reopen_reason: f.reaberto?.motivo ?? null }, { organization_id: r.orgId, company_id: r.companyId, period: f.periodo });
  }

  // servicos da obra
  for (const s of mudou(antes.servicos ?? [], depois.servicos ?? [], 'id')) {
    const row = {
      code: s.codigo, name: s.nome, phase: s.etapa, unit: s.unidade, budgeted_qty: s.quantidadeOrcada, executed_qty: s.quantidadeExecutada, budgeted_cost: s.custoOrcado, sale_price: s.precoVenda,
      sale_direct: s.faturamentoDireto ?? null, budget_base: s.valorBaseOrcamento ?? null, target_margin: s.margemAlvo ?? null, fab_weight: s.pesoFabricacao ?? null,
      estimate_to_complete: s.estimativaConcluir ?? null, planned_start: s.inicioPrevisto ?? null, planned_end: s.fimPrevisto ?? null, actual_start: s.inicioReal ?? null, actual_end: s.fimReal ?? null,
      status: s.status, manager_id: uuidOuNulo(s.responsavel), default_category: s.categoriaPadrao ?? null, notes: s.observacoes, active: s.ativo,
    };
    const data = await gravar('project_service', { id: r.servicos.get(s.id) }, row, { organization_id: r.orgId, project_id: r.obras.get(s.codigoObra) });
    if (data) r.servicos.set(s.id, data.id);
  }

  // demandas e conclusoes por periodo
  const demAntes = new Map((antes.demandas ?? []).map((d) => [d.id, d]));
  for (const d of mudou(antes.demandas ?? [], depois.demandas ?? [], 'id')) {
    const row = { service_id: d.servicoId ? r.servicos.get(d.servicoId) ?? null : null, title: d.titulo, description: d.descricao, period: d.periodicidade, assignee_id: uuidOuNulo(d.responsavel), due_on: d.prazo ?? null, active: d.ativo };
    const data = await gravar('demand', { id: r.demandas.get(d.id) }, row, { organization_id: r.orgId, project_id: r.obras.get(d.codigoObra), created_by: atorId });
    const did = data?.id ?? r.demandas.get(d.id);
    if (data) r.demandas.set(d.id, data.id);
    const prev = demAntes.get(d.id)?.conclusoes ?? [];
    if (did && JSON.stringify(prev) !== JSON.stringify(d.conclusoes)) {
      const { error: e1 } = await sb.from('demand_completion').delete().eq('demand_id', did);
      falha('limpar conclusões', e1);
      if (d.conclusoes.length) {
        const { error: e2 } = await sb.from('demand_completion').insert(d.conclusoes.map((c) => ({ demand_id: did, completed_on: c, completed_by: atorId })));
        falha('registrar conclusões', e2);
      }
    }
  }

  // ordens de fabricacao/montagem e etapas
  const ordAntes = new Map((antes.ordens ?? []).map((o) => [o.id, o]));
  for (const o of mudou(antes.ordens ?? [], depois.ordens ?? [], 'id')) {
    const row = { service_id: o.servicoId ? r.servicos.get(o.servicoId) ?? null : null, kind: o.tipo, code: o.codigo, description: o.descricao, quantity: o.quantidade, unit: o.unidade, priority: o.prioridade, needed_on: o.dataNecessidade ?? null, notes: o.observacoes, cancelled: !!o.cancelada };
    const data = await gravar('production_order', { id: r.ordens.get(o.id) }, row, { organization_id: r.orgId, project_id: r.obras.get(o.codigoObra), created_by: atorId });
    const oid = data?.id ?? r.ordens.get(o.id);
    if (data) r.ordens.set(o.id, data.id);
    const prev = ordAntes.get(o.id)?.etapas;
    if (oid && JSON.stringify(prev) !== JSON.stringify(o.etapas)) {
      for (const [i, e] of o.etapas.entries()) {
        await gravar('production_stage', { order_id: oid, stage_order: String(i + 1) }, { name: e.nome, status: e.status, completed_qty: e.quantidadeConcluida, started_on: e.inicio ?? null, finished_on: e.fim ?? null, responsible: e.responsavel ?? null, notes: e.observacoes ?? null }, { order_id: oid, stage_order: i + 1 });
      }
    }
  }

  // medicoes / cronograma
  for (const m of mudou(antes.medicoes ?? [], depois.medicoes ?? [], 'id')) {
    const row = {
      service_id: m.servicoId ? r.servicos.get(m.servicoId) ?? null : null, number: m.numero, month_no: m.mes, stage: m.etapa, title: m.evento, scope: m.escopo, criteria: m.criterio, documents: m.documentos,
      kind: m.tipoMedicao, approver: m.responsavelAprovacao, planned_on: m.dataPrevista ?? null, amount: m.faturamentoConstrutora, gross_amount: m.valorBruto, direct_amount: m.faturamentoDireto, contractor_amount: m.faturamentoConstrutora, retention_amount: m.retencao,
      planned_progress: m.pctEvolucaoPlanejada, status: m.status, measured_on: m.dataMedicao ?? null, measured_amount: m.valorMedido ?? null, entry_id: m.lancamentoId ? r.lancs.get(m.lancamentoId) ?? null : null, notes: m.observacoes,
    };
    const data = await gravar('measurement', { id: r.medicoes.get(m.id) }, row, { organization_id: r.orgId, project_id: r.obras.get(m.codigoObra) });
    if (data) r.medicoes.set(m.id, data.id);
  }

  // catalogo: insumos (novos em lote; alterados um a um)
  const insumoRow = (i: Dataset['insumos'][number]): Row => ({ source: i.origem, code: i.codigo, description: i.descricao, unit: i.unidade, kind: i.tipo, price: i.preco, price_date: i.precoData ?? null, price_source: i.precoFonte ?? null, class_name: i.classe ?? null, active: i.ativo, notes: i.observacoes || null });
  const insumosMud = mudou(antes.insumos ?? [], depois.insumos ?? [], 'id');
  const insumosNovos = insumosMud.filter((i) => !r.insumos.get(i.id));
  for (let k = 0; k < insumosNovos.length; k += 500) {
    const lote = insumosNovos.slice(k, k + 500);
    const { data, error } = await sb.from('catalog_input').insert(lote.map((i) => ({ ...insumoRow(i), organization_id: r.orgId }))).select('id');
    falha('inserir insumos', error);
    lote.forEach((i, idx) => { if (data?.[idx]) r.insumos.set(i.id, data[idx].id); });
  }
  for (const i of insumosMud.filter((x) => r.insumos.get(x.id))) {
    const { error } = await sb.from('catalog_input').update(insumoRow(i)).eq('id', r.insumos.get(i.id)!);
    falha('atualizar insumo', error);
  }

  // catalogo: composicoes (cabecalhos em lote, depois itens de todas as alteradas)
  const compRow = (c: Dataset['composicoes'][number]): Row => ({ source: c.origem, code: c.codigo, description: c.descricao, unit: c.unidade, group_name: c.grupo || null, active: c.ativo, notes: c.observacoes || null });
  const compsMud = mudou(antes.composicoes ?? [], depois.composicoes ?? [], 'id');
  const compsNovas = compsMud.filter((c) => !r.composicoes.get(c.id));
  for (let k = 0; k < compsNovas.length; k += 500) {
    const lote = compsNovas.slice(k, k + 500);
    const { data, error } = await sb.from('catalog_composition').insert(lote.map((c) => ({ ...compRow(c), organization_id: r.orgId }))).select('id');
    falha('inserir composições', error);
    lote.forEach((c, idx) => { if (data?.[idx]) r.composicoes.set(c.id, data[idx].id); });
  }
  const compAntes = new Map((antes.composicoes ?? []).map((c) => [c.id, c]));
  const itensRows: Row[] = [];
  for (const c of compsMud) {
    const cid = r.composicoes.get(c.id);
    if (!cid) continue;
    const prev = compAntes.get(c.id);
    if (prev) {
      const { error } = await sb.from('catalog_composition').update(compRow(c)).eq('id', cid);
      falha('atualizar composição', error);
      if (JSON.stringify(prev.itens) === JSON.stringify(c.itens)) continue;
      const { error: e1 } = await sb.from('catalog_composition_item').delete().eq('composition_id', cid);
      falha('limpar itens da composição', e1);
    }
    c.itens.forEach((it, idx) => {
      const ref = it.tipo === 'Insumo' ? r.insumos.get(it.refId) : r.composicoes.get(it.refId);
      if (!ref) return;
      itensRows.push({ composition_id: cid, item_order: idx + 1, input_id: it.tipo === 'Insumo' ? ref : null, child_composition_id: it.tipo === 'Composição' ? ref : null, coefficient: it.coeficiente });
    });
  }
  for (let k = 0; k < itensRows.length; k += 1000) {
    const { error } = await sb.from('catalog_composition_item').insert(itensRows.slice(k, k + 1000));
    falha('inserir itens das composições', error);
  }

  // orcamentos e itens (itens regravados quando mudam)
  const orcAntes = new Map((antes.orcamentos ?? []).map((o) => [o.id, o]));
  for (const o of mudou(antes.orcamentos ?? [], depois.orcamentos ?? [], 'id')) {
    const row = { code: o.codigo, title: o.titulo, client_name: o.cliente || null, project_id: o.codigoObra ? r.obras.get(o.codigoObra) ?? null : null, estimate_date: o.data, valid_until: o.validade ?? null, status: o.status, bdi: o.bdi, price_reference: o.referenciaPrecos || null, notes: o.observacoes || null, updated_by: atorId };
    const data = await gravar('estimate', { id: r.orcamentos.get(o.id) }, row, { organization_id: r.orgId, company_id: r.companyId, created_by: atorId });
    const oid = data?.id ?? r.orcamentos.get(o.id);
    if (data) r.orcamentos.set(o.id, data.id);
    const prev = orcAntes.get(o.id);
    if (oid && (!prev || JSON.stringify(prev.itens) !== JSON.stringify(o.itens))) {
      const { error: e1 } = await sb.from('estimate_item').delete().eq('estimate_id', oid);
      falha('limpar itens do orçamento', e1);
      if (o.itens.length) {
        const { error: e2 } = await sb.from('estimate_item').insert(o.itens.map((it, idx) => ({ estimate_id: oid, item_order: idx + 1, stage: it.etapa || null, code: it.codigo || null, description: it.descricao, unit: it.unidade || 'un', quantity: it.quantidade, composition_id: it.composicaoId ? r.composicoes.get(it.composicaoId) ?? null : null, manual_unit_cost: it.custoUnitarioManual ?? null, sale_unit_price: it.precoUnitarioVenda ?? null, service_id: it.servicoId ? r.servicos.get(it.servicoId) ?? null : null })));
        falha('inserir itens do orçamento', e2);
      }
    }
  }

  // pedidos de compra e itens
  const pedAntes = new Map((antes.pedidos ?? []).map((p) => [p.id, p]));
  for (const p of mudou(antes.pedidos ?? [], depois.pedidos ?? [], 'id')) {
    const row = { code: p.codigo, service_id: p.servicoId ? r.servicos.get(p.servicoId) ?? null : null, supplier_name: p.fornecedor, document: p.documento ?? null, order_date: p.data, expected_on: p.previsaoEntrega ?? null, payment_days: p.prazoPagamentoDias, chart_account_id: r.plano.get(p.categoria) ?? null, direct_billing: p.faturamentoDireto, status: p.status, entry_id: p.lancamentoId ? r.lancs.get(p.lancamentoId) ?? null : null, notes: p.observacoes || null, updated_by: atorId };
    const data = await gravar('purchase_order', { id: r.pedidos.get(p.id) }, row, { organization_id: r.orgId, project_id: r.obras.get(p.codigoObra), created_by: atorId });
    const pid = data?.id ?? r.pedidos.get(p.id);
    if (data) r.pedidos.set(p.id, data.id);
    const prev = pedAntes.get(p.id);
    if (pid && (!prev || JSON.stringify(prev.itens) !== JSON.stringify(p.itens))) {
      const { error: e1 } = await sb.from('purchase_order_item').delete().eq('order_id', pid);
      falha('limpar itens do pedido', e1);
      if (p.itens.length) {
        const { error: e2 } = await sb.from('purchase_order_item').insert(p.itens.map((it, idx) => ({ order_id: pid, item_order: idx + 1, input_id: it.insumoId ? r.insumos.get(it.insumoId) ?? null : null, description: it.descricao, unit: it.unidade || 'un', quantity: it.quantidade, unit_price: it.precoUnitario, received_qty: it.quantidadeRecebida })));
        falha('inserir itens do pedido', e2);
      }
    }
  }

  // lista de materiais (novos em lote; alterados um a um; excluidos removidos)
  const cjRow = (c: Dataset['conjuntos'][number]): Row => ({ service_id: c.servicoId ? r.servicos.get(c.servicoId) ?? null : null, order_id: c.ordemId ? r.ordens.get(c.ordemId) ?? null : null, mark: c.marca, description: c.descricao, profile: c.perfil ?? null, kind: c.tipo, quantity: c.quantidade, unit_weight: c.pesoUnitario, revision: c.revisao ?? null, released_on: c.liberadoEm ?? null, fabricated_qty: c.fabricadoQtd, shipped_qty: c.expedidoQtd, erected_qty: c.montadoQtd, notes: c.observacoes || null, updated_by: atorId });
  const cjMud = mudou(antes.conjuntos ?? [], depois.conjuntos ?? [], 'id');
  const cjNovos = cjMud.filter((c) => !r.conjuntos.get(c.id));
  for (let k = 0; k < cjNovos.length; k += 500) {
    const lote = cjNovos.slice(k, k + 500);
    const { data, error } = await sb.from('assembly').insert(lote.map((c) => ({ ...cjRow(c), organization_id: r.orgId, project_id: r.obras.get(c.codigoObra), created_by: atorId }))).select('id');
    falha('inserir conjuntos', error);
    lote.forEach((c, idx) => { if (data?.[idx]) r.conjuntos.set(c.id, data[idx].id); });
  }
  for (const c of cjMud.filter((x) => r.conjuntos.get(x.id))) {
    const { error } = await sb.from('assembly').update(cjRow(c)).eq('id', r.conjuntos.get(c.id)!);
    falha('atualizar conjunto', error);
  }
  const cjDepois = new Set((depois.conjuntos ?? []).map((c) => c.id));
  for (const c of (antes.conjuntos ?? []).filter((x) => !cjDepois.has(x.id) && r.conjuntos.get(x.id))) {
    const { error } = await sb.from('assembly').delete().eq('id', r.conjuntos.get(c.id)!);
    falha('excluir conjunto', error);
    r.conjuntos.delete(c.id);
  }

  // medicoes fisicas de servico (imutaveis: insere novas, remove excluidas)
  for (const a of mudou(antes.avancos ?? [], depois.avancos ?? [], 'id').filter((x) => !r.avancos.get(x.id))) {
    const { data, error } = await sb.from('service_progress').insert({ organization_id: r.orgId, project_id: r.obras.get(a.codigoObra), service_id: r.servicos.get(a.servicoId), measured_on: a.data, quantity: a.quantidade, pct: a.pct ?? null, description: a.descricao, evidence: a.evidencia ?? null, created_by: atorId }).select('id');
    falha('registrar medição de serviço', error);
    if (data?.[0]) r.avancos.set(a.id, data[0].id);
  }
  const avDepois = new Set((depois.avancos ?? []).map((a) => a.id));
  for (const a of (antes.avancos ?? []).filter((x) => !avDepois.has(x.id) && r.avancos.get(x.id))) {
    const { error } = await sb.from('service_progress').delete().eq('id', r.avancos.get(a.id)!);
    falha('excluir medição de serviço', error);
    r.avancos.delete(a.id);
  }

  // auditoria da aplicacao (o banco tambem grava a sua por trigger)
  const audAntes = new Set(antes.auditoria.map((a) => a.id));
  const novas = depois.auditoria.filter((a) => !audAntes.has(a.id) && !/^\d+$/.test(a.id));
  if (novas.length) {
    const { error } = await sb.from('audit_log').insert(novas.map((a) => ({ organization_id: r.orgId, occurred_at: a.ts, actor_id: atorId, action: a.acao, entity_type: a.entidade, entity_id: a.entidadeId, before_data: a.antes ?? null, after_data: a.depois ?? null, reason: a.motivo ?? null, source: 'app' })));
    if (error && !/policy/i.test(error.message)) falha('auditoria', error);
  }
}

function obraRow(o: Obra, r: Refs, atorId: string): Row {
  return {
    organization_id: r.orgId, company_id: r.companyId, code: o.codigo, record_kind: o.registro, name: o.nome, client_name: o.cliente, city_state: o.cidadeUf, status: o.status, scope: o.escopo,
    signed_at: o.assinatura ?? null, starts_at: o.inicio ?? null, contractual_end: o.fimContratual ?? null, contract_value: o.valorContrato, addenda_value: o.aditivos, budgeted_cost: o.custoOrcado,
    physical_progress: o.execucaoFisica, measured_invoiced: o.medidoFaturado, estimate_to_complete: o.estimativaConcluir, target_margin: o.margemAlvo ?? null, notes: o.observacoes, manager_id: uuidOuNulo(o.responsavel), updated_by: atorId,
  };
}

function lancRow(l: Lancamento, r: Refs, tipoDe: ReturnType<typeof mapaPlano>, atorId: string): Row {
  const realizado = l.status === 'Realizado';
  return {
    record_kind: l.registro, entry_type: tipoDe.get(l.categoria)?.tipo ?? 'Saída', chart_account_id: r.plano.get(l.categoria), sub_category: l.subcategoria || null, cost_center_label: l.centroCusto,
    project_id: l.codigoObra ? r.obras.get(l.codigoObra) ?? null : null, service_id: l.servicoId ? r.servicos.get(l.servicoId) ?? null : null, counterparty_name: l.contraparte, document_number: l.documento || null, description: l.descricao,
    competence_date: l.competencia, due_date: l.vencimento || null, settlement_date: realizado ? l.realizacao ?? l.vencimento : null, status: l.status, confidence: l.confiabilidade, probability: l.probabilidade,
    bank_account_id: r.contas.get(l.contaFinanceira) ?? null, gross_amount: l.valorBruto, tax_amount: l.retencoes, discount_amount: l.desconto, interest_amount: l.multaJuros,
    settled_amount: l.status === 'Cancelado' ? 0 : l.valorRealizado ?? 0, reconciled: l.conciliado, notes: l.observacoes || null, source_system: l.origem || 'eiff-control', external_id: l.idExterno ?? l.id,
    direct_billing: !!l.faturamentoDireto, cancellation_reason: l.motivoCancelamento ?? null, cancelled_at: l.status === 'Cancelado' ? new Date().toISOString() : null, cancelled_by: l.status === 'Cancelado' ? atorId : null, updated_by: atorId,
  };
}

export type { Aprovacao };

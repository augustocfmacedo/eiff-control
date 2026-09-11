// Transformacao PURA linha do banco -> Dataset. Extraida de supabase.ts (carregarRemoto) na Wave 03 para que o
// navegador e o servidor (datasetServidor.ts) montem o MESMO Dataset a partir das mesmas linhas: nenhuma consulta,
// nenhum cliente, nenhuma variavel de ambiente aqui. A paridade com o carregarRemoto original e presa por snapshot
// em mapeamentoDataset.test.ts — mudou a transformacao, muda o snapshot com justificativa.
import type { Dataset, Papel, Params, Usuario } from '../core/types';
import { radarVazio } from '../core/radar/types';

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Referencias (codigo humano <-> uuid): o navegador as guarda para gravar de volta; o servidor so le
// ---------------------------------------------------------------------------
export interface Refs {
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
  apontEstacao: Map<string, string>;
  romaneios: Map<string, string>;
  itensEstoque: Map<string, string>;
  movEstoque: Map<string, string>;
  treinamentos: Map<string, string>;
  fotos: Map<string, string>;
  funcoes: Map<string, string>;
  alocacoes: Map<string, string>;
}

export const CORPORATIVOS: Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria', 'Compras'];

/** Linhas cruas por tabela, na forma em que o PostgREST as devolve. Quem consulta (navegador ou servidor) preenche. */
export interface LinhasDataset {
  perfis: Row[];
  orgs: Row[];
  companies: Row[];
  params: Row[];
  fatores: Row[];
  plano: Row[];
  contas: Row[];
  obras: Row[];
  lancs: Row[];
  liqs: Row[];
  trans: Row[];
  recs: Row[];
  dividas: Row[];
  aprovs: Row[];
  steps: Row[];
  coms: Row[];
  tasks: Row[];
  closes: Row[];
  audit: Row[];
  scopes: Row[];
  servicosRows: Row[];
  demandasRows: Row[];
  conclusoesRows: Row[];
  ordensRows: Row[];
  etapasRows: Row[];
  workers: Row[];
  timesheets: Row[];
  tsLines: Row[];
  tsOutputs: Row[];
  tsIncidents: Row[];
  medicoesRows: Row[];
  pedidosRows: Row[];
  pedidosItens: Row[];
  conjuntosRows: Row[];
  avancosRows: Row[];
  estacaoRows: Row[];
  romaneioRows: Row[];
  stockItems: Row[];
  stockMovs: Row[];
  trainingRows: Row[];
  fotoRows: Row[];
  funcRows: Row[];
  alocRows: Row[];
  insumosRows: Row[];
  compRows: Row[];
  compItens: Row[];
  estRows: Row[];
  estItens: Row[];
}

/**
 * Monta o Dataset a partir das linhas. `radar` sai vazio: o slice do Radar tem carregador proprio (radar.supabase.ts)
 * e o chamador o preenche quando quiser. Lanca se organizacao ou empresa faltarem — sem elas nao ha Dataset.
 */
export function montarDataset(l: LinhasDataset): { ds: Dataset; refs: Refs } {
  const { perfis, orgs, companies, params, fatores, plano, contas, obras, lancs, liqs, trans, recs, dividas, aprovs, steps, coms, tasks, closes, audit, scopes, servicosRows, demandasRows, conclusoesRows, ordensRows, etapasRows, workers, timesheets, tsLines, tsOutputs, tsIncidents, medicoesRows, pedidosRows, pedidosItens, conjuntosRows, avancosRows, estacaoRows, romaneioRows, stockItems, stockMovs, trainingRows, fotoRows, funcRows, alocRows, insumosRows, compRows, compItens, estRows, estItens } = l;
  const org = orgs[0];
  const company = companies[0];
  if (!org || !company) throw new Error('Organização/empresa não encontradas.');
  const pedItensPor = new Map<string, Row[]>();
  for (const i of pedidosItens) pedItensPor.set(i.order_id, [...(pedItensPor.get(i.order_id) ?? []), i]);
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
  const refs: Refs = {
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
    apontEstacao: new Map(estacaoRows.map((x) => [x.id, x.id])),
    romaneios: new Map(romaneioRows.map((x) => [x.id, x.id])),
    itensEstoque: new Map(stockItems.map((x) => [x.id, x.id])),
    movEstoque: new Map(stockMovs.map((x) => [x.id, x.id])),
    treinamentos: new Map(trainingRows.map((x) => [x.id, x.id])),
    fotos: new Map(fotoRows.map((x) => [x.id, x.id])),
    funcoes: new Map(funcRows.map((x) => [x.id, x.id])),
    alocacoes: new Map(alocRows.map((x) => [x.id, x.id])),
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
    corteExtrato: p?.statement_cutoff ?? undefined,
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
      excluidoEm: l.deleted_at ?? undefined, excluidoPor: l.deleted_by ? nome(l.deleted_by) : undefined, motivoExclusao: l.deletion_reason ?? undefined,
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
    insumos: [], composicoes: [], orcamentos: [], pedidos: [], conjuntos: [], avancos: [], apontamentosEstacao: [], romaneios: [], itensEstoque: [], movimentosEstoque: [], treinamentos: [], fotos: [], funcoes: [], alocacoes: [], radar: radarVazio(),
    medicoes: medicoesRows.map((m) => ({
      id: m.id, codigoObra: r.obrasInv.get(m.project_id) ?? '', servicoId: m.service_id ?? undefined, numero: m.number, mes: Number(m.month_no ?? 1), etapa: m.stage ?? '', evento: m.title ?? m.number, escopo: m.scope ?? '', criterio: m.criteria ?? '', documentos: m.documents ?? '',
      tipoMedicao: m.kind ?? '', responsavelAprovacao: m.approver ?? '', dataPrevista: m.planned_on ?? undefined, valorBruto: Number(m.gross_amount ?? m.amount ?? 0), faturamentoDireto: Number(m.direct_amount ?? 0), faturamentoConstrutora: Number(m.contractor_amount ?? m.amount ?? 0), retencao: Number(m.retention_amount ?? 0),
      pctEvolucaoPlanejada: Number(m.planned_progress ?? 0), status: m.status, dataMedicao: m.measured_on ?? undefined, valorMedido: m.measured_amount === null || m.measured_amount === undefined ? undefined : Number(m.measured_amount), lancamentoId: m.entry_id ? r.lancsInv.get(m.entry_id) : undefined, observacoes: m.notes ?? '',
    })),
  };
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
  ds.apontamentosEstacao = estacaoRows.map((x) => ({ id: x.id, data: x.log_date, codigoObra: r.obrasInv.get(x.project_id) ?? '', servicoId: x.service_id ?? undefined, ordemId: x.order_id ?? undefined, linha: x.line, estacao: x.station, conjuntos: (x.assemblies ?? []) as { conjuntoId: string; quantidade: number }[], pecas: Number(x.pieces ?? 0), pesoKg: Number(x.weight_kg ?? 0), colaboradores: (x.workers ?? []) as { colaboradorId: string; horas: number }[], observacao: x.notes ?? '', responsavel: x.created_by ?? '', criadoEm: x.created_at }));
  ds.itensEstoque = stockItems.map((x) => ({ id: x.id, codigo: x.code, descricao: x.description, familia: x.family, insumoId: x.catalog_input_id ?? undefined, pesoUnitario: x.unit_weight != null ? Number(x.unit_weight) : undefined, estoqueMinimo: Number(x.min_stock ?? 0), ativo: !!x.active, observacoes: x.notes ?? '' }));
  ds.movimentosEstoque = stockMovs.map((x) => ({ id: x.id, data: x.moved_on, tipo: x.kind, itemId: x.item_id, local: x.location, codigoObra: x.project_id ? r.obrasInv.get(x.project_id) : undefined, servicoId: x.service_id ?? undefined, ordemId: x.order_id ?? undefined, conjuntos: (x.assemblies ?? []) as { conjuntoId: string; quantidade: number }[], quantidade: Number(x.quantity_kg), pecas: x.pieces != null ? Number(x.pieces) : undefined, corrida: x.heat_number ?? undefined, certificado: x.certificate ?? undefined, fornecedor: x.supplier ?? undefined, pedidoId: x.purchase_order_id ?? undefined, notaFiscal: x.invoice ?? undefined, custoUnitario: Number(x.unit_cost ?? 0), origemId: x.origin_id ?? undefined, origemTipo: x.origin_kind ?? undefined, observacao: x.notes ?? '', responsavel: x.created_by ?? '', criadoEm: x.created_at }));
  ds.treinamentos = trainingRows.map((x) => ({ id: x.id, usuarioId: x.user_id, licaoId: x.lesson_id, concluidoEm: x.completed_at, acertos: x.score != null ? Number(x.score) : undefined }));
  ds.fotos = fotoRows.map((x) => ({ id: x.id, codigoObra: x.project_id ? r.obrasInv.get(x.project_id) ?? '' : '', referenciaTipo: x.ref_type, referenciaId: x.ref_id, tomadaEm: x.taken_at, tomadaPor: x.taken_by ?? '', nota: x.note ?? undefined, dataUrl: x.data_url ?? undefined, caminho: x.storage_path ?? undefined }));
  ds.funcoes = funcRows.map((x) => ({ id: x.id, nome: x.name, categoria: x.category, custoHoraPadrao: x.default_hourly_cost === null || x.default_hourly_cost === undefined ? undefined : Number(x.default_hourly_cost), descricao: x.description ?? '', ativa: !!x.active }));
  ds.alocacoes = alocRows.map((x) => ({ id: x.id, colaboradorId: x.worker_id, local: x.location, codigoObra: x.project_id ? r.obrasInv.get(x.project_id) ?? undefined : undefined, de: x.starts_on, ate: x.ends_on ?? undefined, percentual: Number(x.share), observacoes: x.notes ?? '' }));
  ds.romaneios = romaneioRows.map((x) => ({ id: x.id, codigoObra: r.obrasInv.get(x.project_id) ?? '', numero: x.number, data: x.shipped_on, transportadora: x.carrier ?? '', placa: x.plate ?? undefined, motorista: x.driver ?? undefined, destino: x.destination ?? '', itens: (x.items ?? []) as { conjuntoId: string; quantidade: number }[], status: x.status, entregueEm: x.delivered_on ?? undefined, observacoes: x.notes ?? '', criadoPor: x.created_by ?? '', criadoEm: x.created_at }));
  return { ds, refs };
}

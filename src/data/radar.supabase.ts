// Persistencia do EIFF Radar no Supabase: mapeamento generico entidade <-> tabela (prefixo radar_).
// Leitura converte linhas em RadarDataset; escrita grava so as diferencas (update-senao-insert nas mutaveis,
// insert nas imutaveis). Recebe os helpers do provider principal para nao criar ciclo de import.
import type { RadarDataset } from '../core/radar/types';


type Row = Record<string, any>;
export interface HelpersRadar {
  sel: (tabela: string, ordem: string, comId?: boolean) => Promise<Row[]>;
  gravar: (tabela: string, filtro: Record<string, string | null | undefined>, row: Row, extraInsert?: Row) => Promise<Row | undefined>;
  inserir: (tabela: string, rows: Row[]) => Promise<Row[]>;
  apagar: (tabela: string, id: string) => Promise<void>;
  orgId: string;
  atorId: string;
  uuid: (v?: string) => string | null;
  perfil: (usuarioId?: string) => string | null; // id de usuario do app -> profile.id
}

type Chave = keyof RadarDataset;
interface Spec<T extends { id: string }> {
  chave: Chave;
  tabela: string;
  ordem: string;
  imutavel?: boolean; // insert-only (com delete quando some do dataset)
  app: (row: Row) => T;
  db: (o: T, ref: (chave: Chave, id?: string) => string | null, h: HelpersRadar) => Row;
}

const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const nn = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);

// especificacoes; ordem = dependencias (fontes antes de empresas, empresas antes de filhos...)
const SPECS: Spec<{ id: string }>[] = [
  { chave: 'fontes', tabela: 'radar_source', ordem: 'code', app: (x) => ({ id: x.id, codigo: x.code, nome: x.name, tipo: x.source_type, descricao: x.description ?? '', confiabilidade: Number(x.reliability ?? 1), ativo: !!x.active, criadoEm: x.created_at }), db: (o: Row) => ({ code: o.codigo, name: o.nome, source_type: o.tipo, description: nn(o.descricao), reliability: o.confiabilidade, active: o.ativo }) },
  { chave: 'estrategias', tabela: 'radar_strategy', ordem: 'sort_order', app: (x) => ({ id: x.id, codigo: x.code, nome: x.name, descricao: x.description ?? '', mensagemModelo: x.message_template ?? '', ativo: !!x.active, ordem: Number(x.sort_order ?? 0) }), db: (o: Row) => ({ code: o.codigo, name: o.nome, description: nn(o.descricao), message_template: nn(o.mensagemModelo), active: o.ativo, sort_order: o.ordem }) },
  { chave: 'regrasScore', tabela: 'radar_score_rule', ordem: 'priority', app: (x) => ({ id: x.id, nome: x.rule_name, dimensao: x.dimension, tipoSinal: s(x.signal_type), condicao: x.condition, peso: Number(x.weight), decaimento: !!x.decay_enabled, decaimentoDias: n(x.decay_days), ativo: !!x.active, prioridade: Number(x.priority ?? 0) }), db: (o: Row) => ({ rule_name: o.nome, dimension: o.dimensao, signal_type: nn(o.tipoSinal), condition: o.condicao, weight: o.peso, decay_enabled: o.decaimento, decay_days: nn(o.decaimentoDias), active: o.ativo, priority: o.prioridade }) },
  { chave: 'empresas', tabela: 'radar_company', ordem: 'legal_name', app: (x) => ({ id: x.id, cnpj: s(x.cnpj), razaoSocial: x.legal_name, nomeFantasia: s(x.trade_name), dominio: s(x.domain), site: s(x.website), linkedin: s(x.linkedin_url), setor: s(x.industry), cnae: s(x.cnae), cidade: s(x.city), uf: s(x.state), pais: x.country ?? 'Brasil', faixaFuncionarios: s(x.employee_range), faixaReceita: s(x.revenue_range), capitalSocial: n(x.capital_social), numeroUnidades: n(x.number_of_locations), fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), businessId: s(x.explorium_business_id), observacoes: x.notes ?? '', ativo: !!x.active, mescladaEm: s(x.merged_into), criadoEm: x.created_at, atualizadoEm: x.updated_at, fitScore: Number(x.fit_score ?? 0), intentScore: Number(x.intent_score ?? 0), timingScore: Number(x.timing_score ?? 0), relationshipScore: Number(x.relationship_score ?? 0), dataQualityScore: Number(x.data_quality_score ?? 0), priorityScore: Number(x.priority_score ?? 0), priorityClass: x.priority_class ?? 'D', ultimoSinalEm: s(x.last_signal_at), ultimoContatoEm: s(x.last_contact_at), proximaAcaoEm: s(x.next_action_at) }), db: (o: Row, ref, h) => ({ cnpj: nn(o.cnpj), legal_name: o.razaoSocial, trade_name: nn(o.nomeFantasia), domain: nn(o.dominio), website: nn(o.site), linkedin_url: nn(o.linkedin), industry: nn(o.setor), cnae: nn(o.cnae), city: nn(o.cidade), state: nn(o.uf), country: o.pais ?? 'Brasil', employee_range: nn(o.faixaFuncionarios), revenue_range: nn(o.faixaReceita), capital_social: nn(o.capitalSocial), number_of_locations: nn(o.numeroUnidades), source_id: ref('fontes', o.fonteId), source_external_id: nn(o.fonteExternaId), explorium_business_id: nn(o.businessId), notes: nn(o.observacoes), active: o.ativo, merged_into: ref('empresas', o.mescladaEm), fit_score: o.fitScore, intent_score: o.intentScore, timing_score: o.timingScore, relationship_score: o.relationshipScore, data_quality_score: o.dataQualityScore, priority_score: o.priorityScore, priority_class: o.priorityClass, last_signal_at: nn(o.ultimoSinalEm), last_contact_at: nn(o.ultimoContatoEm), next_action_at: nn(o.proximaAcaoEm), updated_by: h.atorId }) },
  { chave: 'regrasPersona', tabela: 'radar_persona_rule', ordem: 'priority', app: (x) => ({ id: x.id, persona: x.persona, campo: x.field, termos: x.terms ?? [], excluir: x.exclude_terms ?? undefined, prioridade: Number(x.priority ?? 0), ativo: !!x.active }), db: (o: Row) => ({ persona: o.persona, field: o.campo, terms: o.termos, exclude_terms: o.excluir ?? null, priority: o.prioridade, active: o.ativo }) },
  { chave: 'contatos', tabela: 'radar_contact', ordem: 'full_name', app: (x) => ({ id: x.id, empresaId: x.company_id, nome: x.full_name, cargo: s(x.job_title), departamento: s(x.department), senioridade: s(x.seniority), email: s(x.email), telefone: s(x.phone), celular: s(x.mobile_phone), whatsapp: s(x.whatsapp), linkedin: s(x.linkedin_url), decisor: !!x.is_decision_maker, poderDecisao: s(x.decision_power), persona: s(x.persona), personaManual: !!x.persona_manual, decisionFitScore: Number(x.decision_fit_score ?? 0), isPrimario: !!x.is_primary_contact, qualidade: Number(x.contact_quality ?? 0), statusEmail: s(x.professional_email_status), statusTelefone: s(x.phone_status), situacao: x.status ?? 'ATIVO', fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), verificadoEm: s(x.last_verified_at), observacoes: x.notes ?? '', ativo: !!x.active, criadoEm: x.created_at, atualizadoEm: x.updated_at }), db: (o: Row, ref) => ({ company_id: ref('empresas', o.empresaId), source_external_id: nn(o.fonteExternaId), full_name: o.nome, job_title: nn(o.cargo), department: nn(o.departamento), seniority: nn(o.senioridade), email: nn(o.email), phone: nn(o.telefone), mobile_phone: nn(o.celular), whatsapp: nn(o.whatsapp), linkedin_url: nn(o.linkedin), is_decision_maker: o.decisor, decision_power: nn(o.poderDecisao), persona: nn(o.persona), persona_manual: !!o.personaManual, decision_fit_score: o.decisionFitScore ?? 0, is_primary_contact: !!o.isPrimario, contact_quality: o.qualidade, professional_email_status: nn(o.statusEmail), phone_status: nn(o.statusTelefone), status: o.situacao ?? 'ATIVO', source_id: ref('fontes', o.fonteId), last_verified_at: nn(o.verificadoEm), notes: nn(o.observacoes), active: o.ativo }) },
  { chave: 'projetos', tabela: 'radar_project', ordem: 'name', app: (x) => ({ id: x.id, empresaId: x.company_id, nome: x.name, tipo: s(x.project_type), cidade: s(x.city), uf: s(x.state), endereco: s(x.address), areaM2: n(x.estimated_area_m2), valorEstimado: n(x.estimated_value), estagio: s(x.stage), inicioPrevisto: s(x.expected_start_date), fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), observacoes: x.notes ?? '', criadoEm: x.created_at, atualizadoEm: x.updated_at }), db: (o: Row, ref) => ({ company_id: ref('empresas', o.empresaId), name: o.nome, project_type: nn(o.tipo), city: nn(o.cidade), state: nn(o.uf), address: nn(o.endereco), estimated_area_m2: nn(o.areaM2), estimated_value: nn(o.valorEstimado), stage: nn(o.estagio), expected_start_date: nn(o.inicioPrevisto), source_id: ref('fontes', o.fonteId), source_external_id: nn(o.fonteExternaId), notes: nn(o.observacoes) }) },
  { chave: 'sinais', tabela: 'radar_signal', ordem: 'detected_at', imutavel: true, app: (x) => ({ id: x.id, empresaId: x.company_id, projetoId: s(x.project_id), fonteId: x.source_id, fonteTipo: x.source_type, tipo: x.signal_type, titulo: x.title, descricao: x.description ?? '', eventoEm: x.event_at, detectadoEm: x.detected_at, confianca: Number(x.confidence ?? 1), url: s(x.original_url), externoId: s(x.external_id), payload: x.raw_payload ?? undefined, scoreBase: Number(x.base_score ?? 0), scoreEfetivo: Number(x.effective_score ?? 0), verificado: !!x.verified, verificadoPor: s(x.verified_by), criadoEm: x.created_at }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), project_id: ref('projetos', o.projetoId), source_id: ref('fontes', o.fonteId), source_type: o.fonteTipo, signal_type: o.tipo, title: o.titulo, description: nn(o.descricao), event_at: o.eventoEm, detected_at: o.detectadoEm, confidence: o.confianca, original_url: nn(o.url), external_id: nn(o.externoId), raw_payload: o.payload ?? null, base_score: o.scoreBase, effective_score: o.scoreEfetivo, verified: o.verificado, verified_by: o.verificado ? h.perfil(o.verificadoPor) ?? h.atorId : null }) },
  { chave: 'oportunidades', tabela: 'radar_opportunity', ordem: 'created_at', app: (x) => ({ id: x.id, empresaId: x.company_id, projetoId: s(x.project_id), titulo: x.title, estagio: x.stage, valorEstimado: n(x.estimated_value), probabilidade: Number(x.probability ?? 0), previsaoFechamento: s(x.expected_close_date), responsavelId: x.owner_id ?? '', estrategiaId: s(x.strategy_id), proximaAcao: s(x.next_action), proximaAcaoEm: s(x.next_action_at), motivoFechamento: s(x.close_reason), observacoes: x.notes ?? '', criadoEm: x.created_at, atualizadoEm: x.updated_at, fechadoEm: s(x.closed_at) }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), project_id: ref('projetos', o.projetoId), title: o.titulo, stage: o.estagio, estimated_value: nn(o.valorEstimado), probability: o.probabilidade, expected_close_date: nn(o.previsaoFechamento), owner_id: h.perfil(o.responsavelId) ?? h.atorId, strategy_id: ref('estrategias', o.estrategiaId), next_action: nn(o.proximaAcao), next_action_at: nn(o.proximaAcaoEm), close_reason: nn(o.motivoFechamento), notes: nn(o.observacoes), closed_at: nn(o.fechadoEm), updated_by: h.atorId }) },
  { chave: 'historicoEstagios', tabela: 'radar_opportunity_stage_history', ordem: 'changed_at', imutavel: true, app: (x) => ({ id: x.id, oportunidadeId: x.opportunity_id, de: s(x.from_stage), para: x.to_stage, usuarioId: x.user_id ?? '', motivo: s(x.reason), em: x.changed_at }), db: (o: Row, ref, h) => ({ opportunity_id: ref('oportunidades', o.oportunidadeId), from_stage: nn(o.de), to_stage: o.para, user_id: h.perfil(o.usuarioId) ?? h.atorId, reason: nn(o.motivo), changed_at: o.em }) },
  { chave: 'atividades', tabela: 'radar_activity', ordem: 'occurred_at', imutavel: true, app: (x) => ({ id: x.id, empresaId: x.company_id, contatoId: s(x.contact_id), projetoId: s(x.project_id), oportunidadeId: s(x.opportunity_id), usuarioId: x.user_id ?? '', tipo: x.activity_type, canal: x.channel, estrategiaId: s(x.strategy_id), ocorreuEm: x.occurred_at, resultado: s(x.outcome), notas: x.notes ?? '', conteudoBruto: s(x.raw_content), criadoEm: x.created_at }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), contact_id: ref('contatos', o.contatoId), project_id: ref('projetos', o.projetoId), opportunity_id: ref('oportunidades', o.oportunidadeId), user_id: h.perfil(o.usuarioId) ?? h.atorId, activity_type: o.tipo, channel: o.canal, strategy_id: ref('estrategias', o.estrategiaId), occurred_at: o.ocorreuEm, outcome: nn(o.resultado), notes: nn(o.notas), raw_content: nn(o.conteudoBruto) }) },
  { chave: 'tarefas', tabela: 'radar_task', ordem: 'due_at', app: (x) => ({ id: x.id, empresaId: x.company_id, contatoId: s(x.contact_id), oportunidadeId: s(x.opportunity_id), responsavelId: x.assigned_to ?? '', tipo: x.task_type, prioridade: x.priority, venceEm: x.due_at, status: x.status, descricao: x.description, criadoEm: x.created_at, concluidaEm: s(x.completed_at) }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), contact_id: ref('contatos', o.contatoId), opportunity_id: ref('oportunidades', o.oportunidadeId), assigned_to: h.perfil(o.responsavelId) ?? h.atorId, task_type: o.tipo, priority: o.prioridade, due_at: o.venceEm, status: o.status, description: o.descricao, completed_at: nn(o.concluidaEm) }) },
  { chave: 'experimentos', tabela: 'radar_experiment', ordem: 'started_at', app: (x) => ({ id: x.id, nome: x.name, hipotese: x.hypothesis ?? '', estrategiaId: s(x.strategy_id), canal: s(x.channel), inicioEm: x.started_at, fimEm: s(x.ended_at), status: x.status, resultado: x.result ?? '', criadoEm: x.created_at }), db: (o: Row, ref) => ({ name: o.nome, hypothesis: nn(o.hipotese), strategy_id: ref('estrategias', o.estrategiaId), channel: nn(o.canal), started_at: o.inicioEm, ended_at: nn(o.fimEm), status: o.status, result: nn(o.resultado) }) },
  { chave: 'snapshotsScore', tabela: 'radar_score_snapshot', ordem: 'scored_at', imutavel: true, app: (x) => ({ id: x.id, empresaId: x.company_id, em: x.scored_at, fit: Number(x.fit), timing: Number(x.timing), intent: Number(x.intent), relationship: Number(x.relationship), dataQuality: Number(x.data_quality), total: Number(x.total), classe: x.priority_class, explicacao: x.explanation }), db: (o: Row, ref) => ({ company_id: ref('empresas', o.empresaId), scored_at: o.em, fit: o.fit, timing: o.timing, intent: o.intent, relationship: o.relationship, data_quality: o.dataQuality, total: o.total, priority_class: o.classe, explanation: o.explicacao }) },
  { chave: 'importacoes', tabela: 'radar_import_job', ordem: 'created_at', app: (x) => ({ id: x.id, fonteId: x.source_id ?? '', tipo: x.job_type, arquivo: x.file_name, status: x.status, total: Number(x.total_rows), importados: Number(x.imported), atualizados: Number(x.updated), duplicados: Number(x.duplicates), erros: Number(x.errors), criadoPor: x.created_by ?? '', criadoEm: x.created_at, concluidoEm: s(x.completed_at) }), db: (o: Row, ref, h) => ({ source_id: ref('fontes', o.fonteId), job_type: o.tipo, file_name: o.arquivo, status: o.status, total_rows: o.total, imported: o.importados, updated: o.atualizados, duplicates: o.duplicados, errors: o.erros, created_by: h.perfil(o.criadoPor) ?? h.atorId, completed_at: nn(o.concluidoEm) }) },
  { chave: 'importacaoLinhas', tabela: 'radar_import_row', ordem: 'row_number', app: (x) => ({ id: x.id, jobId: x.job_id, numero: Number(x.row_number), dados: x.data ?? {}, status: x.status, entidadeId: s(x.entity_id), mensagem: s(x.message), candidatos: x.candidates ?? undefined }), db: (o: Row, ref) => ({ job_id: ref('importacoes', o.jobId), row_number: o.numero, data: o.dados, status: o.status, entity_id: ref('empresas', o.entidadeId) ?? ref('contatos', o.entidadeId), message: nn(o.mensagem), candidates: o.candidatos ? o.candidatos.map((c: Row) => ({ ...c, empresaId: ref('empresas', c.empresaId) ?? c.empresaId })) : null }) },
  { chave: 'importacaoErros', tabela: 'radar_import_error', ordem: 'row_number', imutavel: true, app: (x) => ({ id: x.id, jobId: x.job_id, numero: Number(x.row_number), campo: s(x.field), mensagem: x.message }), db: (o: Row, ref) => ({ job_id: ref('importacoes', o.jobId), row_number: o.numero, field: nn(o.campo), message: o.mensagem }) },
  { chave: 'duplicatas', tabela: 'radar_possible_duplicate', ordem: 'created_at', app: (x) => ({ id: x.id, empresaId: x.company_id, candidataId: x.candidate_id, confianca: Number(x.confidence), motivo: x.reason, status: x.status, criadoEm: x.created_at, resolvidoEm: s(x.resolved_at), resolvidoPor: s(x.resolved_by) }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), candidate_id: ref('empresas', o.candidataId), confidence: o.confianca, reason: o.motivo, status: o.status, resolved_at: nn(o.resolvidoEm), resolved_by: o.resolvidoPor ? h.perfil(o.resolvidoPor) ?? h.atorId : null }) },
  { chave: 'supressoes', tabela: 'radar_suppression', ordem: 'created_at', imutavel: true, app: (x) => ({ id: x.id, contatoId: s(x.contact_id), empresaId: s(x.company_id), tipo: x.suppression_type, motivo: x.reason ?? '', criadoPor: x.created_by ?? '', criadoEm: x.created_at }), db: (o: Row, ref, h) => ({ contact_id: ref('contatos', o.contatoId), company_id: ref('empresas', o.empresaId), suppression_type: o.tipo, reason: nn(o.motivo), created_by: h.perfil(o.criadoPor) ?? h.atorId }) },
  { chave: 'registrosFonte', tabela: 'radar_source_record', ordem: 'received_at', imutavel: true, app: (x) => ({ id: x.id, fonteId: x.source_id, tipo: x.record_type, externoId: s(x.external_id), payload: x.payload, entidadeId: s(x.entity_id), recebidoEm: x.received_at }), db: (o: Row, ref) => ({ source_id: ref('fontes', o.fonteId), record_type: o.tipo, external_id: nn(o.externoId), payload: o.payload ?? {}, entity_id: ref('empresas', o.entidadeId) ?? ref('contatos', o.entidadeId), received_at: o.recebidoEm }) },
];

// mapa app id -> uuid por entidade (identidade apos a carga; ids locais novos entram apos o insert)
let refs: Map<Chave, Map<string, string>> | null = null;

export async function carregarRadar(h: Pick<HelpersRadar, 'sel' | 'orgId'>): Promise<RadarDataset> {
  const linhas = await Promise.all(SPECS.map((sp) => h.sel(sp.tabela, sp.ordem)));
  // tabelas de chave composta (sem coluna id): ordenar so pela chave de negocio
  const [tiposResposta, configScore, pesosFit] = await Promise.all([h.sel('radar_response_type', 'code', false), h.sel('radar_score_setting', 'key', false), h.sel('radar_decision_fit_weight', 'key', false)]);
  refs = new Map(SPECS.map((sp, i) => [sp.chave, new Map(linhas[i].map((x) => [x.id, x.id]))]));
  const ds = Object.fromEntries(SPECS.map((sp, i) => [sp.chave, linhas[i].map(sp.app)])) as unknown as RadarDataset;
  ds.tiposResposta = tiposResposta.map((x) => ({ codigo: x.code, nome: x.name, sentimento: x.sentiment, ativo: !!x.active }));
  ds.configScore = configScore.map((x) => ({ chave: x.key, valor: Number(x.value) }));
  ds.pesosDecisionFit = pesosFit.map((x) => ({ chave: x.key, valor: Number(x.value) }));
  return ds;
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function persistirRadar(h: HelpersRadar, antes: RadarDataset | undefined, depois: RadarDataset | undefined): Promise<void> {
  if (!depois || !refs) return;
  const a = antes ?? ({} as RadarDataset);
  const ref = (chave: Chave, id?: string) => (id ? refs!.get(chave)?.get(id) ?? h.uuid(id) : null);
  for (const sp of SPECS) {
    const mapa = refs.get(sp.chave)!;
    const lista = (depois[sp.chave] ?? []) as { id: string }[];
    const anterior = new Map(((a[sp.chave] ?? []) as { id: string }[]).map((x) => [x.id, x]));
    if (sp.imutavel) {
      const novos = lista.filter((x) => !mapa.has(x.id));
      if (novos.length) {
        const rows = novos.map((x) => ({ organization_id: h.orgId, ...sp.db(x, ref, h) }));
        const data = await h.inserir(sp.tabela, rows);
        novos.forEach((x, i) => { if (data[i]?.id) mapa.set(x.id, data[i].id); });
      }
      const atuais = new Set(lista.map((x) => x.id));
      for (const [id] of anterior) if (!atuais.has(id) && mapa.get(id)) { await h.apagar(sp.tabela, mapa.get(id)!); mapa.delete(id); }
      continue;
    }
    for (const x of lista) {
      if (mapa.has(x.id) && igual(anterior.get(x.id), x)) continue;
      const data = await h.gravar(sp.tabela, { id: mapa.get(x.id) }, sp.db(x, ref, h), { organization_id: h.orgId, ...(sp.chave === 'empresas' || sp.chave === 'oportunidades' ? { created_by: h.atorId } : {}) });
      if (data?.id) mapa.set(x.id, data.id);
    }
  }
  // tabelas de chave composta
  for (const t of depois.tiposResposta ?? []) {
    if (igual((a.tiposResposta ?? []).find((x) => x.codigo === t.codigo), t)) continue;
    await h.gravar('radar_response_type', { organization_id: h.orgId, code: t.codigo }, { name: t.nome, sentiment: t.sentimento, active: t.ativo }, { organization_id: h.orgId, code: t.codigo });
  }
  for (const c of depois.configScore ?? []) {
    if (igual((a.configScore ?? []).find((x) => x.chave === c.chave), c)) continue;
    await h.gravar('radar_score_setting', { organization_id: h.orgId, key: c.chave }, { value: c.valor }, { organization_id: h.orgId, key: c.chave });
  }
  for (const c of depois.pesosDecisionFit ?? []) {
    if (igual((a.pesosDecisionFit ?? []).find((x) => x.chave === c.chave), c)) continue;
    await h.gravar('radar_decision_fit_weight', { organization_id: h.orgId, key: c.chave }, { value: c.valor }, { organization_id: h.orgId, key: c.chave });
  }
}

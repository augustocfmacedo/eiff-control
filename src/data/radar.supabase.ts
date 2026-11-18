// Persistencia do EIFF Radar no Supabase: mapeamento generico entidade <-> tabela (prefixo radar_).
// Leitura converte linhas em RadarDataset; escrita grava so as diferencas (update-senao-insert nas mutaveis,
// insert nas imutaveis). Recebe os helpers do provider principal para nao criar ciclo de import.
import { contentSpecPersistivel, type ContentSpec } from '../core/radar/comunicacao';
import type { OperacaoVibeLedger, RadarDataset } from '../core/radar/types';
import type { EventoDesfecho, VersaoMetaComercial } from '../core/radar/metaComercial';
import { comIntencao } from './metaConfirmada';


type Row = Record<string, any>;
export interface HelpersRadar {
  sel: (tabela: string, ordem: string, comId?: boolean) => Promise<Row[]>;
  gravar: (tabela: string, filtro: Record<string, string | null | undefined>, row: Row, extraInsert?: Row) => Promise<Row | undefined>;
  /** update-senao-insert para tabelas de chave composta (sem coluna id): o filtro e a propria chave. */
  gravarComposta: (tabela: string, chave: Record<string, string>, row: Row) => Promise<void>;
  inserir: (tabela: string, rows: Row[]) => Promise<Row[]>;
  apagar: (tabela: string, id: string) => Promise<void>;
  orgId: string;
  atorId: string;
  uuid: (v?: string) => string | null;
  perfil: (usuarioId?: string) => string | null; // id de usuario do app -> profile.id
  /** operação governada no banco, com o JWT do usuário (a autoridade é conferida lá) */
  rpc: (nome: string, args: Row) => Promise<unknown>;
  /** CD-D5.2: motivo da mudança de dono da empresa (id do app), lido da auditoria do app desta sincronização */
  motivoDono: (empresaId: string) => string | undefined;
  /** CD-D3/E3: o banco tem o livro de desfechos (0070)? Sem ele a coluna won_amount não existe e não é enviada. */
  desfechos?: boolean;
  /**
   * CD-D3/E5: avisado logo depois de cada RPC de meta que o banco ACEITOU (antes do que vier depois na rodada). O store
   * põe a versão na base sincronizada e na pendência offline, para que a retomada nunca reenvie a mesma intenção.
   */
  aoGravarMeta?: (m: VersaoMetaComercial) => void;
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

/**
 * LE-2A — RegistroFonte.entidadeId e POLIMORFICO: aponta para quatro tabelas diferentes, e quem diz qual e o
 * proprio record_type. Procurar a entidade chutando colecao por colecao acertaria por acidente e erraria em
 * silencio quando dois namespaces tivessem o mesmo id de app.
 */
export const COLECAO_DO_REGISTRO = { empresa: 'empresas', contato: 'contatos', projeto: 'projetos', sinal: 'sinais' } as const;

const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const nn = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);

// especificacoes; ordem = dependencias (fontes antes de empresas, empresas antes de filhos...)
const SPECS: Spec<{ id: string }>[] = [
  { chave: 'fontes', tabela: 'radar_source', ordem: 'code', app: (x) => ({ id: x.id, codigo: x.code, nome: x.name, tipo: x.source_type, descricao: x.description ?? '', confiabilidade: Number(x.reliability ?? 1), ativo: !!x.active, criadoEm: x.created_at }), db: (o: Row) => ({ code: o.codigo, name: o.nome, source_type: o.tipo, description: nn(o.descricao), reliability: o.confiabilidade, active: o.ativo }) },
  { chave: 'estrategias', tabela: 'radar_strategy', ordem: 'sort_order', app: (x) => ({ id: x.id, codigo: x.code, nome: x.name, descricao: x.description ?? '', mensagemModelo: x.message_template ?? '', ativo: !!x.active, ordem: Number(x.sort_order ?? 0) }), db: (o: Row) => ({ code: o.codigo, name: o.nome, description: nn(o.descricao), message_template: nn(o.mensagemModelo), active: o.ativo, sort_order: o.ordem }) },
  { chave: 'regrasScore', tabela: 'radar_score_rule', ordem: 'priority', app: (x) => ({ id: x.id, nome: x.rule_name, dimensao: x.dimension, tipoSinal: s(x.signal_type), condicao: x.condition, peso: Number(x.weight), decaimento: !!x.decay_enabled, decaimentoDias: n(x.decay_days), ativo: !!x.active, prioridade: Number(x.priority ?? 0) }), db: (o: Row) => ({ rule_name: o.nome, dimension: o.dimensao, signal_type: nn(o.tipoSinal), condition: o.condicao, weight: o.peso, decay_enabled: o.decaimento, decay_days: nn(o.decaimentoDias), active: o.ativo, priority: o.prioridade }) },
  { chave: 'empresas', tabela: 'radar_company', ordem: 'legal_name', app: (x) => ({ id: x.id, cnpj: s(x.cnpj), razaoSocial: x.legal_name, nomeFantasia: s(x.trade_name), dominio: s(x.domain), site: s(x.website), linkedin: s(x.linkedin_url), setor: s(x.industry), cnae: s(x.cnae), cidade: s(x.city), uf: s(x.state), pais: x.country ?? 'Brasil', faixaFuncionarios: s(x.employee_range), faixaReceita: s(x.revenue_range), capitalSocial: n(x.capital_social), numeroUnidades: n(x.number_of_locations), fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), businessId: s(x.explorium_business_id), observacoes: x.notes ?? '', ativo: !!x.active, mescladaEm: s(x.merged_into), commercialOwnerId: s(x.commercial_owner_id), criadoEm: x.created_at, atualizadoEm: x.updated_at, fitScore: Number(x.fit_score ?? 0), intentScore: Number(x.intent_score ?? 0), timingScore: Number(x.timing_score ?? 0), relationshipScore: Number(x.relationship_score ?? 0), dataQualityScore: Number(x.data_quality_score ?? 0), priorityScore: Number(x.priority_score ?? 0), priorityClass: x.priority_class ?? 'D', ultimoSinalEm: s(x.last_signal_at), ultimoContatoEm: s(x.last_contact_at), proximaAcaoEm: s(x.next_action_at) }), db: (o: Row, ref, h) => ({ cnpj: nn(o.cnpj), legal_name: o.razaoSocial, trade_name: nn(o.nomeFantasia), domain: nn(o.dominio), website: nn(o.site), linkedin_url: nn(o.linkedin), industry: nn(o.setor), cnae: nn(o.cnae), city: nn(o.cidade), state: nn(o.uf), country: o.pais ?? 'Brasil', employee_range: nn(o.faixaFuncionarios), revenue_range: nn(o.faixaReceita), capital_social: nn(o.capitalSocial), number_of_locations: nn(o.numeroUnidades), source_id: ref('fontes', o.fonteId), source_external_id: nn(o.fonteExternaId), explorium_business_id: nn(o.businessId), notes: nn(o.observacoes), active: o.ativo, merged_into: ref('empresas', o.mescladaEm), /* CD-D5.2: commercial_owner_id NÃO vai na escrita genérica (o banco nem concede a coluna); muda só pela RPC radar_definir_dono_conta em persistirRadar */ fit_score: o.fitScore, intent_score: o.intentScore, timing_score: o.timingScore, relationship_score: o.relationshipScore, data_quality_score: o.dataQualityScore, priority_score: o.priorityScore, priority_class: o.priorityClass, last_signal_at: nn(o.ultimoSinalEm), last_contact_at: nn(o.ultimoContatoEm), next_action_at: nn(o.proximaAcaoEm), updated_by: h.atorId }) },
  { chave: 'regrasPersona', tabela: 'radar_persona_rule', ordem: 'priority', app: (x) => ({ id: x.id, persona: x.persona, campo: x.field, termos: x.terms ?? [], excluir: x.exclude_terms ?? undefined, prioridade: Number(x.priority ?? 0), ativo: !!x.active }), db: (o: Row) => ({ persona: o.persona, field: o.campo, terms: o.termos, exclude_terms: o.excluir ?? null, priority: o.prioridade, active: o.ativo }) },
  { chave: 'contatos', tabela: 'radar_contact', ordem: 'full_name', app: (x) => ({ id: x.id, empresaId: x.company_id, nome: x.full_name, cargo: s(x.job_title), departamento: s(x.department), senioridade: s(x.seniority), email: s(x.email), telefone: s(x.phone), celular: s(x.mobile_phone), whatsapp: s(x.whatsapp), linkedin: s(x.linkedin_url), decisor: !!x.is_decision_maker, poderDecisao: s(x.decision_power), persona: s(x.persona), personaManual: !!x.persona_manual, decisionFitScore: Number(x.decision_fit_score ?? 0), isPrimario: !!x.is_primary_contact, qualidade: Number(x.contact_quality ?? 0), statusEmail: s(x.professional_email_status), statusTelefone: s(x.phone_status), situacao: x.status ?? 'ATIVO', fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), verificadoEm: s(x.last_verified_at), observacoes: x.notes ?? '', ativo: !!x.active, criadoEm: x.created_at, atualizadoEm: x.updated_at }), db: (o: Row, ref) => ({ company_id: ref('empresas', o.empresaId), source_external_id: nn(o.fonteExternaId), full_name: o.nome, job_title: nn(o.cargo), department: nn(o.departamento), seniority: nn(o.senioridade), email: nn(o.email), phone: nn(o.telefone), mobile_phone: nn(o.celular), whatsapp: nn(o.whatsapp), linkedin_url: nn(o.linkedin), is_decision_maker: o.decisor, decision_power: nn(o.poderDecisao), persona: nn(o.persona), persona_manual: !!o.personaManual, decision_fit_score: o.decisionFitScore ?? 0, is_primary_contact: !!o.isPrimario, contact_quality: o.qualidade, professional_email_status: nn(o.statusEmail), phone_status: nn(o.statusTelefone), status: o.situacao ?? 'ATIVO', source_id: ref('fontes', o.fonteId), last_verified_at: nn(o.verificadoEm), notes: nn(o.observacoes), active: o.ativo }) },
  { chave: 'projetos', tabela: 'radar_project', ordem: 'name', app: (x) => ({ id: x.id, empresaId: x.company_id, nome: x.name, tipo: s(x.project_type), cidade: s(x.city), uf: s(x.state), endereco: s(x.address), areaM2: n(x.estimated_area_m2), valorEstimado: n(x.estimated_value), estagio: s(x.stage), inicioPrevisto: s(x.expected_start_date), fonteId: s(x.source_id), fonteExternaId: s(x.source_external_id), observacoes: x.notes ?? '', criadoEm: x.created_at, atualizadoEm: x.updated_at }), db: (o: Row, ref) => ({ company_id: ref('empresas', o.empresaId), name: o.nome, project_type: nn(o.tipo), city: nn(o.cidade), state: nn(o.uf), address: nn(o.endereco), estimated_area_m2: nn(o.areaM2), estimated_value: nn(o.valorEstimado), stage: nn(o.estagio), expected_start_date: nn(o.inicioPrevisto), source_id: ref('fontes', o.fonteId), source_external_id: nn(o.fonteExternaId), notes: nn(o.observacoes) }) },
  { chave: 'sinais', tabela: 'radar_signal', ordem: 'detected_at', imutavel: true, app: (x) => ({ id: x.id, empresaId: x.company_id, projetoId: s(x.project_id), fonteId: x.source_id, fonteTipo: x.source_type, tipo: x.signal_type, titulo: x.title, descricao: x.description ?? '', eventoEm: x.event_at, detectadoEm: x.detected_at, confianca: Number(x.confidence ?? 1), url: s(x.original_url), externoId: s(x.external_id), payload: x.raw_payload ?? undefined, scoreBase: Number(x.base_score ?? 0), scoreEfetivo: Number(x.effective_score ?? 0), verificado: !!x.verified, verificadoPor: s(x.verified_by), criadoEm: x.created_at }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), project_id: ref('projetos', o.projetoId), source_id: ref('fontes', o.fonteId), source_type: o.fonteTipo, signal_type: o.tipo, title: o.titulo, description: nn(o.descricao), event_at: o.eventoEm, detected_at: o.detectadoEm, confidence: o.confianca, original_url: nn(o.url), external_id: nn(o.externoId), raw_payload: o.payload ?? null, base_score: o.scoreBase, effective_score: o.scoreEfetivo, verified: o.verificado, verified_by: o.verificado ? h.perfil(o.verificadoPor) ?? h.atorId : null }) },
  { chave: 'oportunidades', tabela: 'radar_opportunity', ordem: 'created_at', app: (x) => ({ id: x.id, empresaId: x.company_id, projetoId: s(x.project_id), titulo: x.title, estagio: x.stage, valorEstimado: n(x.estimated_value), valorFechado: n(x.won_amount), probabilidade: Number(x.probability ?? 0), previsaoFechamento: s(x.expected_close_date), responsavelId: x.owner_id ?? '', estrategiaId: s(x.strategy_id), proximaAcao: s(x.next_action), proximaAcaoEm: s(x.next_action_at), motivoFechamento: s(x.close_reason), motivoEstagio: s(x.stage_reason), observacoes: x.notes ?? '', criadoEm: x.created_at, atualizadoEm: x.updated_at, fechadoEm: s(x.closed_at) }), db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), project_id: ref('projetos', o.projetoId), title: o.titulo, stage: o.estagio, estimated_value: nn(o.valorEstimado), probability: o.probabilidade, expected_close_date: nn(o.previsaoFechamento), owner_id: h.perfil(o.responsavelId) ?? h.atorId, strategy_id: ref('estrategias', o.estrategiaId), next_action: nn(o.proximaAcao), next_action_at: nn(o.proximaAcaoEm), close_reason: nn(o.motivoFechamento), notes: nn(o.observacoes), closed_at: nn(o.fechadoEm), updated_by: h.atorId, ...(h.desfechos ? { won_amount: nn(o.valorFechado), stage_reason: nn(o.motivoEstagio) } : {}) }) },
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
  // comunicacoes: content_spec persistido e o snapshot minimo (sem raw_payload/telefone/e-mail); historico de estados fica em radar_communication_event (trigger)
  { chave: 'comunicacoes', tabela: 'radar_communication', ordem: 'created_at', app: (x) => ({ id: x.id, empresaId: x.company_id, contatoId: x.contact_id, sinalId: s(x.signal_id), estrategiaId: s(x.strategy_id), canal: x.channel, objetivo: x.objective, playbook: x.playbook, estado: x.state, spec: x.content_spec ?? {}, resultado: x.generated_content ?? { versaoPrincipal: '', versoesAlternativas: [], objecoes: [], claimsUsados: [], metadados: {} }, textoEditado: s(x.edited_content?.texto), assuntoEditado: s(x.edited_content?.assunto), editadoPor: s(x.edited_content?.por), editadoEm: s(x.edited_content?.em), contextHash: x.context_hash, versoes: { playbook: x.playbook_version, contentSpec: x.content_spec_version, prompt: x.prompt_version, provedor: x.provider, modelo: s(x.model) }, validacao: x.validation ?? { ok: true, problemas: [] }, aprovadoPor: s(x.approved_by), aprovadoEm: s(x.approved_at), rejeitadoPor: s(x.rejected_by), rejeitadoEm: s(x.rejected_at), motivoRejeicao: s(x.rejection_reason), enviadaEm: s(x.sent_at), atividadeEnvioId: s(x.sent_activity_id), respondidaEm: s(x.replied_at), atividadeRespostaId: s(x.replied_activity_id), ultimoMotivo: s(x.last_transition_reason), criadoEm: x.created_at, atualizadoEm: x.updated_at, criadoPor: x.created_by ?? '', historico: [] }),
    db: (o: Row, ref, h) => ({ company_id: ref('empresas', o.empresaId), contact_id: ref('contatos', o.contatoId), signal_id: ref('sinais', o.sinalId), strategy_id: ref('estrategias', o.estrategiaId), objective: o.objetivo, playbook: o.playbook, channel: o.canal, state: o.estado, context_hash: o.contextHash, content_spec: contentSpecPersistivel(o.spec as ContentSpec), generated_content: o.resultado, edited_content: o.textoEditado ? { texto: o.textoEditado, assunto: o.assuntoEditado ?? null, por: h.perfil(o.editadoPor) ?? h.atorId, em: o.editadoEm ?? null } : null, validation: o.validacao ?? null, provider: o.versoes?.provedor ?? 'deterministico', model: nn(o.versoes?.modelo), prompt_version: o.versoes?.prompt ?? '', playbook_version: o.versoes?.playbook ?? '', content_spec_version: o.versoes?.contentSpec ?? '', created_by: h.perfil(o.criadoPor) ?? h.atorId, approved_by: h.perfil(o.aprovadoPor), approved_at: nn(o.aprovadoEm), rejected_by: h.perfil(o.rejeitadoPor), rejected_at: nn(o.rejeitadoEm), rejection_reason: nn(o.motivoRejeicao), sent_at: nn(o.enviadaEm), sent_activity_id: ref('atividades', o.atividadeEnvioId), replied_at: nn(o.respondidaEm), replied_activity_id: ref('atividades', o.atividadeRespostaId), last_transition_reason: nn(o.ultimoMotivo) }) },
  // registrosFonte segue insert-only (imutavel): a evidencia bruta nunca e reescrita, e a migration 0055 poe a mesma
  // regra no banco (trigger radar_source_record_evidencia). Os campos de decisao do Lead Engine sao gravados no
  // INSERT; transicionar um candidato (PENDING -> RESOLVED/REJECTED) e do LE-2 e exige tornar esta spec mutavel.
  // LE-2A: MUTAVEL de proposito. A decisao do Lead Engine (PENDING -> REVIEW -> RESOLVED/REJECTED) precisa virar
  // UPDATE, e o ramo mutavel do persistidor NAO apaga linha que some do dataset — evidencia bruta e trilha de
  // auditoria, nao cache. A evidencia continua imutavel onde importa: o trigger radar_source_record_evidencia
  // (migration 0055) recusa mudanca em organization_id, source_id, record_type, external_id, payload,
  // payload_fingerprint e received_at. So os campos de decisao e a ligacao com a entidade evoluem.
  { chave: 'registrosFonte', tabela: 'radar_source_record', ordem: 'received_at', app: (x) => ({ id: x.id, fonteId: x.source_id, tipo: x.record_type, externoId: s(x.external_id), payload: x.payload, entidadeId: s(x.entity_id), recebidoEm: x.received_at, payloadFingerprint: s(x.payload_fingerprint), statusIntake: s(x.intake_status), decididoEm: s(x.decided_at), decididoPor: s(x.decided_by), motivoDecisao: s(x.decision_reason) }), db: (o: Row, ref, h) => ({ source_id: ref('fontes', o.fonteId), record_type: o.tipo, external_id: nn(o.externoId), payload: o.payload ?? {}, entity_id: ref(COLECAO_DO_REGISTRO[o.tipo as keyof typeof COLECAO_DO_REGISTRO] ?? 'empresas', o.entidadeId), received_at: o.recebidoEm, payload_fingerprint: nn(o.payloadFingerprint), intake_status: nn(o.statusIntake), decided_at: nn(o.decididoEm), decided_by: o.decididoPor ? h.perfil(o.decididoPor) ?? h.atorId : null, decision_reason: nn(o.motivoDecisao) }) },
];

// mapa app id -> uuid por entidade (identidade apos a carga; ids locais novos entram apos o insert)
let refs: Map<Chave, Map<string, string>> | null = null;

export async function carregarRadar(h: Pick<HelpersRadar, 'sel' | 'orgId'>): Promise<RadarDataset> {
  const linhas = await Promise.all(SPECS.map((sp) => h.sel(sp.tabela, sp.ordem)));
  // tabelas de chave composta (sem coluna id): ordenar so pela chave de negocio
  const [tiposResposta, configScore, pesosFit] = await Promise.all([h.sel('radar_response_type', 'code', false), h.sel('radar_score_setting', 'key', false), h.sel('radar_decision_fit_weight', 'key', false)]);
  refs = new Map(SPECS.map((sp, i) => [sp.chave, new Map(linhas[i].map((x) => [x.id, x.id]))]));
  const ds = Object.fromEntries(SPECS.map((sp, i) => [sp.chave, linhas[i].map(sp.app)])) as unknown as RadarDataset;
  // ledger do Vibe: somente leitura (RLS de select por organizacao; escrita so pelas RPCs server-only)
  const ops = await h.sel('radar_vibe_operation', 'created_at').catch(() => [] as Row[]);
  ds.operacoesVibe = ops.map((x) => ({ id: String(x.id), tipo: x.operation_type as OperacaoVibeLedger['tipo'], status: x.status as OperacaoVibeLedger['status'], creditosEstimados: Number(x.estimated_credits ?? 0), creditosReservados: Number(x.reserved_credits ?? 0), creditosReais: n(x.actual_credits), creditosAntes: n(x.credits_before), creditosDepois: n(x.credits_after), registrosPedidos: Number(x.records_requested ?? 0), registrosDevolvidos: Number(x.records_returned ?? 0), tetoRegistros: n(x.paid_record_cap), resumo: (x.result_summary as Record<string, unknown> | null) ?? undefined, criadoEm: String(x.created_at), concluidoEm: s(x.finished_at) }));
  ds.tiposResposta = tiposResposta.map((x) => ({ codigo: x.code, nome: x.name, sentimento: x.sentiment, ativo: !!x.active }));
  ds.configScore = configScore.map((x) => ({ chave: x.key, valor: Number(x.value) }));
  ds.pesosDecisionFit = pesosFit.map((x) => ({ chave: x.key, valor: Number(x.value) }));
  // CD-D3/E2: metas comerciais (somente leitura; escrita só pela RPC). Banco sem a 0068: indisponível (undefined), nunca "sem meta".
  ds.metasComerciais = await h.sel('radar_commercial_goal', 'created_at').then((linhas) => linhas.map(metaDoBanco)).catch(() => undefined);
  // CD-D3/E3: livro de desfechos (somente leitura; o banco escreve). Banco sem a 0070: indisponível (undefined), nunca "sem ganho".
  ds.desfechos = await h.sel('radar_commercial_outcome', 'occurred_at').then((linhas) => linhas.map(eventoDoBanco)).catch(() => undefined);
  return ds;
}

/** Linha de radar_commercial_outcome → `EventoDesfecho` do motor E1 (valor como veio do banco; instante com fuso). */
export function eventoDoBanco(x: Row): EventoDesfecho {
  const opc = (k: keyof EventoDesfecho, v: unknown) => (v === null || v === undefined ? {} : { [k]: String(v) });
  return { id: String(x.id), tipo: x.event_type, oportunidadeId: String(x.opportunity_id), empresaId: String(x.company_id), ocorridoEm: String(x.occurred_at),
    ...opc('valor', x.amount), ...opc('ganhoId', x.won_event_id), ...opc('responsavelId', x.owner_id), ...opc('donoContaId', x.account_owner_id), ...opc('motivo', x.reason), ...opc('registradoPor', x.actor_id) } as EventoDesfecho;
}

/**
 * CD-D3/E3 — o app nunca grava GANHO nem ESTORNO (o gatilho da 0070 grava na mesma transação da mudança de estágio).
 * Cada COMPLEMENTO_VALOR novo desde a última sincronização vira UMA chamada da RPC governada, depois da escrita das
 * oportunidades; recusa = exceção, nada muda. Sem motivo: falha fechada.
 */
async function persistirDesfechos(h: HelpersRadar, antes: readonly EventoDesfecho[] | undefined, depois: readonly EventoDesfecho[] | undefined): Promise<void> {
  if (!depois) return;
  const ja = new Set((antes ?? []).map((e) => e.id));
  for (const e of depois.filter((x) => !ja.has(x.id) && x.tipo === 'COMPLEMENTO_VALOR')) {
    if (!e.motivo?.trim() || !e.ganhoId) throw new Error('desfecho: complemento sem motivo ou sem ganho; nada foi gravado.');
    await h.rpc('radar_complementar_valor_ganho', { p_ganho: h.uuid(e.ganhoId) ?? e.ganhoId, p_valor: Number(e.valor), p_motivo: e.motivo.trim() });
  }
}

/** Linha de radar_commercial_goal → versão de meta do motor (mês AAAA-MM; valor como veio do banco, null = retirada). */
export function metaDoBanco(x: Row): VersaoMetaComercial {
  return { id: String(x.id), mes: String(x.period_month).slice(0, 7), metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor: x.amount ?? null, versao: Number(x.version), ...(x.supersedes_id ? { substituiId: String(x.supersedes_id) } : {}), motivo: String(x.reason), definidaPor: String(x.created_by), definidaEm: String(x.created_at) };
}

/**
 * CD-D3/E2 — cada versão de meta nova (criada pela ação do store desde a última sincronização) vira UMA chamada da RPC
 * governada, na ordem de mês e versão. O banco é a autoridade: recalcula a versão sob trava, confere papel, organização,
 * mês, valor e motivo e audita na mesma transação; a versão local é só a intenção (o número final é o do banco, que a
 * recarga traz). Nunca há INSERT direto (authenticated não tem). Mesmo valor da vigente: a RPC não cria versão.
 * Cada versão aceita é avisada em `h.aoGravarMeta` na hora: se algo POSTERIOR da rodada falhar, a retomada não a
 * reenvia (um reenvio, com outra sessão tendo mudado a meta no meio, recriaria o valor antigo sobre o mais novo).
 */
async function persistirMetas(h: HelpersRadar, antes: readonly VersaoMetaComercial[] | undefined, depois: readonly VersaoMetaComercial[] | undefined): Promise<void> {
  if (!depois) return;
  const ja = new Set((antes ?? []).map((m) => m.id));
  const novas = depois.filter((m) => !ja.has(m.id)).sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : a.versao - b.versao));
  for (const m of novas) {
    if (!m.motivo?.trim()) throw new Error('meta comercial: versão sem motivo; nada foi gravado.');
    const [rpc, args] = chamadaDaMeta(m);
    await h.rpc(rpc, args);
    h.aoGravarMeta?.(m);
  }
}

/**
 * CD-D3/E5 (0074) — a chamada de uma versão de meta: SEMPRE a RPC idempotente radar_definir_meta_comercial_intencao.
 * Intenção incompleta é recusada antes de sair; registro legado (sem intenção) ganha intenção determinística e a versão
 * base de quando foi criado (`comIntencao`). A RPC antiga da 0068 não é chamada pelo app.
 */
export function chamadaDaMeta(m: VersaoMetaComercial & { intencao?: string; versaoBase?: number }): [string, Row] {
  const x = comIntencao(m);
  const p_valor = x.valor === null || x.valor === undefined || x.valor === '' ? null : Number(x.valor);
  return ['radar_definir_meta_comercial_intencao', { p_intencao: x.intencao, p_mes: `${x.mes}-01`, p_valor, p_motivo: x.motivo.trim(), p_versao_base: x.versaoBase }];
}

/** Mapeamentos expostos para scripts de carga (mesmas regras da persistencia do app). */
export function linhaDb(chave: Chave, obj: { id: string }, ref: (chave: Chave, id?: string) => string | null, h: HelpersRadar): Row { const sp = SPECS.find((x) => x.chave === chave); if (!sp) throw new Error(`sem spec para ${chave}`); return sp.db(obj as never, ref, h); }
export function tabelaDe(chave: Chave): string { const sp = SPECS.find((x) => x.chave === chave); if (!sp) throw new Error(`sem spec para ${chave}`); return sp.tabela; }
export function linhaApp(chave: Chave, row: Row): { id: string } { const sp = SPECS.find((x) => x.chave === chave); if (!sp) throw new Error(`sem spec para ${chave}`); return sp.app(row); }
export type { Chave as ChaveRadar };
/** Registra um id ja gravado no banco (ex.: linha inserida pela funcao /api/comunicacao) para a persistencia nao reinserir. */
export function registrarRefRadar(chave: Chave, id: string): void { refs?.get(chave)?.set(id, id); }

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Empresa sem os campos que a escrita genérica não grava (dono e carimbo local): só o dono mudou = nada a gravar na tabela. */
const semDono = (e?: { id: string }) => { if (!e) return e; const resto: Record<string, unknown> = { ...e }; delete resto.commercialOwnerId; delete resto.atualizadoEm; return resto; };
const donoDe = (e?: { id: string }) => (e as { commercialOwnerId?: string } | undefined)?.commercialOwnerId?.trim() || undefined;

/**
 * CD-D5.2 — dono comercial da conta pela operação governada (0065): uma chamada por empresa cujo dono mudou desde a
 * última sincronização, depois da escrita genérica (a empresa nova já existe no banco). A RPC confere autor, papel,
 * organização, conta, novo dono e motivo e grava dono + auditoria numa transação; recusa = exceção, nada muda.
 * Falha fechada: sem motivo na auditoria do app não chama a RPC e a sincronização para com erro.
 * Fila offline: várias trocas da mesma conta viram UMA chamada com o estado final e o motivo mais recente.
 */
async function persistirDonos(h: HelpersRadar, antes: { id: string }[], depois: { id: string }[], mapa: Map<string, string>): Promise<void> {
  const anterior = new Map(antes.map((x) => [x.id, x]));
  for (const x of depois) {
    const novo = donoDe(x);
    if (donoDe(anterior.get(x.id)) === novo) continue;
    // conta nova sem dono: nasce sem dono no banco, nada a chamar
    if (!anterior.has(x.id) && !novo) continue;
    const empresa = mapa.get(x.id) ?? h.uuid(x.id);
    const motivo = h.motivoDono(x.id)?.trim();
    if (!empresa) throw new Error('dono da conta: empresa ainda não gravada no banco.');
    if (!motivo) throw new Error('dono da conta: mudança sem motivo registrado; nada foi gravado.');
    // sem tradução para profile.id vai o id cru e o banco recusa (nunca vira remoção em silêncio)
    await h.rpc('radar_definir_dono_conta', { p_empresa: empresa, p_dono: novo ? h.perfil(novo) ?? novo : null, p_motivo: motivo });
  }
}

export async function persistirRadar(h: HelpersRadar, antes: RadarDataset | undefined, depois: RadarDataset | undefined): Promise<void> {
  if (!depois || !refs) return;
  h = { ...h, desfechos: depois.desfechos !== undefined };
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
      if (mapa.has(x.id) && (sp.chave === 'empresas' ? igual(semDono(anterior.get(x.id)), semDono(x)) : igual(anterior.get(x.id), x))) continue;
      const data = await h.gravar(sp.tabela, { id: mapa.get(x.id) }, sp.db(x, ref, h), { organization_id: h.orgId, ...(sp.chave === 'empresas' || sp.chave === 'oportunidades' ? { created_by: h.atorId } : {}) });
      if (data?.id) mapa.set(x.id, data.id);
    }
    if (sp.chave === 'empresas') await persistirDonos(h, (a.empresas ?? []) as { id: string }[], lista, mapa);
  }
  // tabelas de chave composta
  for (const t of depois.tiposResposta ?? []) {
    if (igual((a.tiposResposta ?? []).find((x) => x.codigo === t.codigo), t)) continue;
    await h.gravarComposta('radar_response_type', { organization_id: h.orgId, code: t.codigo }, { name: t.nome, sentiment: t.sentimento, active: t.ativo });
  }
  for (const c of depois.configScore ?? []) {
    if (igual((a.configScore ?? []).find((x) => x.chave === c.chave), c)) continue;
    await h.gravarComposta('radar_score_setting', { organization_id: h.orgId, key: c.chave }, { value: c.valor });
  }
  for (const c of depois.pesosDecisionFit ?? []) {
    if (igual((a.pesosDecisionFit ?? []).find((x) => x.chave === c.chave), c)) continue;
    await h.gravarComposta('radar_decision_fit_weight', { organization_id: h.orgId, key: c.chave }, { value: c.valor });
  }
  await persistirMetas(h, a.metasComerciais, depois.metasComerciais);
  await persistirDesfechos(h, a.desfechos, depois.desfechos);
}

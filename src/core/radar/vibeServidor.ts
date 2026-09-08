// Regras do lado servidor da integracao Vibe (puras, testaveis): hash de requisicao, decisao de reserva (espelho da
// RPC reserve_vibe_operation), maquina de estados, teto de registros pagos, paginacao com fallback, pool de descoberta
// com catalogo validado, cache de e-mail e classificacao de erros. A funcao Netlify e a tela usam este modulo.
import { CUSTO_VIBE, PAGE_SIZE_MAX_VIBE } from './vibe';

// ---------------------------------------------------------------------------
// Idempotencia: hash dos parametros normalizados
// ---------------------------------------------------------------------------
function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]));
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}
/** FNV-1a de 64 bits em hex sobre o JSON canonico (mesmo payload -> mesmo hash; sem dependencia de crypto). */
export function hashRequisicao(params: unknown): string {
  const s = JSON.stringify(ordenar(params));
  let h1 = 0xcbf29ce4; let h2 = 0x84222325;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0; }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Politica e reserva (espelho da RPC, para testes e para a simulacao na tela)
// ---------------------------------------------------------------------------
export type StatusOperacao = 'PLANNED' | 'RESERVED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN' | 'CANCELLED';
export type TipoOperacao = 'match' | 'discovery' | 'discovery_pool' | 'enrich_email' | 'enrich_phone' | 'test_email';
export interface PoliticaVibe { enabled: boolean; dailyBudget: number; monthlyBudget: number; reserveCredits: number; maxCreditsPerOperation: number; maxPaidRecordsPerOperation: number; emailCacheDays: number; allowedRoles: string[] }
export const POLITICA_PADRAO: PoliticaVibe = { enabled: true, dailyBudget: 60, monthlyBudget: 600, reserveCredits: 20, maxCreditsPerOperation: 40, maxPaidRecordsPerOperation: 20, emailCacheDays: 90, allowedRoles: ['Administrador', 'Diretoria'] };
export interface OperacaoVibe { id: string; idempotencyKey: string; requestHash: string; operationType: TipoOperacao; status: StatusOperacao; estimatedCredits: number; reservedCredits: number; actualCredits?: number | null; recordsRequested: number; recordsReturned: number; paidRecordCap?: number | null; createdAt: string; resultSummary?: unknown }
export interface PedidoReserva { idempotencyKey: string; requestHash: string; operationType: TipoOperacao; estimatedCredits: number; recordsRequested: number; creditsAvailable: number; paidRecordCap?: number; role: string; agora: string }
export interface DecisaoReserva { authorized: boolean; reason: string; operationId?: string; status?: StatusOperacao; limits?: { maxPerOperation: number; dailyRemaining: number; monthlyRemaining: number; availableMinusReserve: number; limit: number; maxPaidRecords: number }; resultSummary?: unknown }

export const creditosComprometidos = (ops: OperacaoVibe[], desde: string) => ops.filter((o) => o.createdAt >= desde).reduce((s, o) => s + (o.status === 'RESERVED' || o.status === 'RUNNING' || o.status === 'UNCERTAIN' ? o.reservedCredits : o.status === 'SUCCEEDED' ? (o.actualCredits ?? o.reservedCredits) : 0), 0);
const inicioDia = (iso: string) => `${iso.slice(0, 10)}T00:00:00.000Z`;
const inicioMes = (iso: string) => `${iso.slice(0, 7)}-01T00:00:00.000Z`;

/** Decide a reserva exatamente como a RPC (sem gravar). `ops` sao as operacoes da organizacao. */
export function decidirReserva(politica: PoliticaVibe, ops: OperacaoVibe[], p: PedidoReserva): DecisaoReserva {
  if (!politica.enabled) return { authorized: false, reason: 'politica_desabilitada' };
  if (!politica.allowedRoles.includes(p.role)) return { authorized: false, reason: 'papel_nao_permitido' };
  const existente = ops.find((o) => o.idempotencyKey === p.idempotencyKey);
  if (existente) {
    if (existente.requestHash !== p.requestHash) return { authorized: false, reason: 'payload_diferente', operationId: existente.id, status: existente.status };
    if (existente.status === 'SUCCEEDED') return { authorized: false, reason: 'ja_executada', operationId: existente.id, status: existente.status, resultSummary: existente.resultSummary };
    if (existente.status === 'RESERVED' || existente.status === 'RUNNING') return { authorized: false, reason: 'operacao_em_andamento', operationId: existente.id, status: existente.status };
    if (existente.status === 'UNCERTAIN') return { authorized: false, reason: 'reconciliacao_necessaria', operationId: existente.id, status: existente.status };
  }
  const dia = creditosComprometidos(ops, inicioDia(p.agora)); const mes = creditosComprometidos(ops, inicioMes(p.agora));
  const limits = { maxPerOperation: politica.maxCreditsPerOperation, dailyRemaining: politica.dailyBudget - dia, monthlyRemaining: politica.monthlyBudget - mes, availableMinusReserve: p.creditsAvailable - politica.reserveCredits, limit: Math.min(politica.maxCreditsPerOperation, politica.dailyBudget - dia, politica.monthlyBudget - mes, p.creditsAvailable - politica.reserveCredits), maxPaidRecords: politica.maxPaidRecordsPerOperation };
  if (!(p.estimatedCredits > 0)) return { authorized: false, reason: 'custo_invalido', limits };
  if (p.estimatedCredits > limits.limit) return { authorized: false, reason: 'orcamento_insuficiente', limits };
  if (p.recordsRequested > politica.maxPaidRecordsPerOperation) return { authorized: false, reason: 'registros_acima_do_limite', limits };
  return { authorized: true, reason: existente ? 'reservada_reaproveitando' : 'reservada', operationId: existente?.id, status: 'RESERVED', limits };
}

/** Ledger em memoria com a mesma semantica da RPC (usado nos testes de concorrencia/idempotencia e no modo local). */
export class LedgerMemoria {
  ops: OperacaoVibe[] = [];
  private seq = 0;
  constructor(public politica: PoliticaVibe = POLITICA_PADRAO) {}
  reservar(p: PedidoReserva): DecisaoReserva {
    // a RPC serializa por advisory lock; aqui a chamada e sincrona, logo atomica por construcao
    const d = decidirReserva(this.politica, this.ops, p);
    if (!d.authorized) return d;
    const existente = this.ops.find((o) => o.idempotencyKey === p.idempotencyKey);
    const op: OperacaoVibe = { id: existente?.id ?? `op-${++this.seq}`, idempotencyKey: p.idempotencyKey, requestHash: p.requestHash, operationType: p.operationType, status: 'RESERVED', estimatedCredits: p.estimatedCredits, reservedCredits: p.estimatedCredits, recordsRequested: p.recordsRequested, recordsReturned: 0, paidRecordCap: p.paidRecordCap ?? null, createdAt: p.agora, actualCredits: null };
    this.ops = existente ? this.ops.map((o) => (o.id === op.id ? op : o)) : [...this.ops, op];
    return { ...d, operationId: op.id };
  }
  atualizar(id: string, status: StatusOperacao, campos: { recordsDelta?: number; actualCredits?: number; resultSummary?: unknown } = {}): { ok: boolean; reason?: string } {
    const o = this.ops.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'nao_encontrada' };
    const t = transicao(o.status, status);
    if (!t.ok) return t;
    const n: OperacaoVibe = { ...o, status: status === 'RUNNING' ? 'RUNNING' : status, recordsReturned: o.recordsReturned + (campos.recordsDelta ?? 0), actualCredits: status === 'SUCCEEDED' ? campos.actualCredits ?? o.actualCredits ?? o.reservedCredits : o.actualCredits, reservedCredits: status === 'FAILED' || status === 'CANCELLED' ? 0 : o.reservedCredits, resultSummary: campos.resultSummary ?? o.resultSummary };
    this.ops = this.ops.map((x) => (x.id === id ? n : x));
    return { ok: true };
  }
}

/** Transicoes validas (mesmas da RPC update_vibe_operation). */
export function transicao(de: StatusOperacao, para: StatusOperacao): { ok: boolean; reason?: string } {
  if (de === 'SUCCEEDED' || de === 'FAILED' || de === 'CANCELLED') return { ok: false, reason: 'operacao_encerrada' };
  if (de === 'UNCERTAIN' && para !== 'SUCCEEDED' && para !== 'FAILED') return { ok: false, reason: 'reconciliacao_necessaria' };
  if (para === 'RUNNING') return de === 'RESERVED' || de === 'RUNNING' ? { ok: true } : { ok: false, reason: 'transicao_invalida' };
  if (para === 'SUCCEEDED' || para === 'FAILED' || para === 'UNCERTAIN' || para === 'CANCELLED') return { ok: true };
  return { ok: false, reason: 'transicao_invalida' };
}

/** Erro antes de enviar a Explorium (resposta HTTP recebida com erro, validacao) -> FAILED; erro de rede/timeout apos enviar -> UNCERTAIN. */
export const classificarErro = (e: { enviado?: boolean; httpStatus?: number }): 'FAILED' | 'UNCERTAIN' => (e.enviado && !e.httpStatus ? 'UNCERTAIN' : 'FAILED');

// ---------------------------------------------------------------------------
// Teto global de registros pagos e tamanho de pagina
// ---------------------------------------------------------------------------
/** page_size = min(100, cap restante da operacao, limite da politica restante, creditos reservados restantes em registros). */
export function tamanhoPaginaServidor(x: { paidRecordCap?: number | null; recordsReturned: number; maxPaidRecords: number; reservedCredits: number; creditosGastos: number; custoPorRegistro?: number; desejado?: number }): number {
  const custo = x.custoPorRegistro ?? CUSTO_VIBE.buscaFull;
  const capRestante = x.paidRecordCap != null ? x.paidRecordCap - x.recordsReturned : Infinity;
  const politicaRestante = x.maxPaidRecords - x.recordsReturned;
  const orcamentoRestante = Math.floor((x.reservedCredits - x.creditosGastos) / custo);
  return Math.max(0, Math.min(PAGE_SIZE_MAX_VIBE, capRestante, politicaRestante, orcamentoRestante, x.desejado ?? PAGE_SIZE_MAX_VIBE));
}

// ---------------------------------------------------------------------------
// Paginacao: cursor em locais documentados/observados, fallback por page numerica, parada sem progresso
// ---------------------------------------------------------------------------
export interface PaginaVibe { data?: { prospect_id?: string; business_id?: string }[]; page?: { next_cursor?: string | null; size?: number }; next_cursor?: string | null; pagination?: { next_cursor?: string | null }; response_context?: { correlation_id?: string } }
export const cursorDe = (r: PaginaVibe): string | null => r.page?.next_cursor ?? r.next_cursor ?? r.pagination?.next_cursor ?? null;

export interface EstadoPaginacao { pagina: number; cursor: string | null; vistos: Set<string>; devolvidos: number; correlacoes: string[] }
export const novoEstadoPaginacao = (): EstadoPaginacao => ({ pagina: 0, cursor: null, vistos: new Set(), devolvidos: 0, correlacoes: [] });

/** Parametros da proxima pagina: cursor quando existe; senao page numerica incremental (nunca repete a page 1). */
export const proximaPagina = (e: EstadoPaginacao, pageSize: number): Record<string, unknown> => ({ page_size: pageSize, ...(e.cursor ? { next_cursor: e.cursor } : { page: e.pagina + 1 }) });

/** Aplica a resposta ao estado e diz se deve continuar. */
export function aplicarPagina(e: EstadoPaginacao, r: PaginaVibe, pageSize: number, limites: { maxPaginas: number; capAtingido: boolean; orcamentoAtingido: boolean }): { novos: { prospect_id?: string; business_id?: string }[]; continuar: boolean; motivo: string } {
  const dados = r.data ?? [];
  const novos = dados.filter((d) => d.prospect_id && !e.vistos.has(d.prospect_id.toLowerCase()));
  for (const d of novos) e.vistos.add(d.prospect_id!.toLowerCase());
  e.pagina++; e.devolvidos += dados.length;
  if (r.response_context?.correlation_id) e.correlacoes.push(r.response_context.correlation_id);
  const cursor = cursorDe(r);
  e.cursor = cursor;
  if (!dados.length) return { novos, continuar: false, motivo: 'pagina_vazia' };
  if (!novos.length) return { novos, continuar: false, motivo: 'sem_novos_ids' };
  if (limites.capAtingido) return { novos, continuar: false, motivo: 'cap_atingido' };
  if (limites.orcamentoAtingido) return { novos, continuar: false, motivo: 'orcamento_atingido' };
  if (e.pagina >= limites.maxPaginas) return { novos, continuar: false, motivo: 'max_paginas' };
  if (!cursor && dados.length < pageSize) return { novos, continuar: false, motivo: 'fim_sem_cursor' };
  return { novos, continuar: true, motivo: cursor ? 'cursor' : 'page_numerica' };
}

// ---------------------------------------------------------------------------
// Catalogo de filtros e pool de descoberta
// ---------------------------------------------------------------------------
export interface CatalogoFiltros { job_level: string[]; job_department: string[]; job_title?: string[]; validado_em?: string }
export const POOL_JOB_LEVEL = ['c-suite', 'president', 'owner', 'founder', 'partner', 'vice president', 'director', 'senior manager', 'manager'];
export const POOL_JOB_DEPARTMENT = ['engineering', 'manufacturing', 'operations', 'real estate', 'logistics', 'procurement', 'c-suite'];
export const TITULOS_ESPECIFICOS: Record<string, string[]> = {
  'direção industrial': ['diretor industrial', 'industrial director', 'plant director', 'diretor de produção', 'diretor fabril'],
  'expansão': ['diretor de expansão', 'expansion director', 'gerente de expansão', 'head of expansion'],
  facilities: ['facilities', 'gerente de facilities', 'infraestrutura', 'manutenção predial'],
  COO: ['COO', 'chief operating officer', 'diretor de operações'],
  presidente: ['presidente', 'president'],
  CEO: ['CEO', 'chief executive officer', 'diretor geral'],
  'supply chain': ['supply chain'],
  'logística': ['logística', 'logistics'],
  'compras e suprimentos': ['compras', 'suprimentos', 'procurement', 'purchasing'],
};
const norm = (s: string) => s.trim().toLowerCase();

/** Intersecao dos valores desejados com o catalogo validado; sem catalogo, nada e permitido em chamada paga. */
export function filtrosValidados(desejados: { job_level?: string[]; job_department?: string[] }, catalogo?: CatalogoFiltros | null): { job_level: string[]; job_department: string[]; rejeitados: string[] } {
  if (!catalogo) return { job_level: [], job_department: [], rejeitados: [...(desejados.job_level ?? []), ...(desejados.job_department ?? [])] };
  const ok = (lista: string[] | undefined, cat: string[]) => { const c = new Set(cat.map(norm)); const aceitos = (lista ?? []).filter((v) => c.has(norm(v))); return { aceitos, rejeitados: (lista ?? []).filter((v) => !c.has(norm(v))) }; };
  const l = ok(desejados.job_level, catalogo.job_level); const d = ok(desejados.job_department, catalogo.job_department);
  return { job_level: l.aceitos, job_department: d.aceitos, rejeitados: [...l.rejeitados, ...d.rejeitados] };
}

/** Filtros do pool unico de descoberta (job_level + job_department validados, business_id das empresas-alvo, e-mail opcional). */
export function filtrosPool(businessIds: string[], catalogo: CatalogoFiltros | null | undefined, somenteComEmail: boolean): { filtros: Record<string, unknown>; rejeitados: string[] } | { erro: string; rejeitados: string[] } {
  const v = filtrosValidados({ job_level: POOL_JOB_LEVEL, job_department: POOL_JOB_DEPARTMENT }, catalogo);
  if (!v.job_level.length || !v.job_department.length) return { erro: 'catalogo_nao_validado', rejeitados: v.rejeitados };
  return { filtros: { business_id: { values: businessIds }, job_level: { values: v.job_level }, job_department: { values: v.job_department }, ...(somenteComEmail ? { has_contact_details: { value: 'email' } } : {}) }, rejeitados: v.rejeitados };
}

// ---------------------------------------------------------------------------
// Cache de e-mail: nao enriquecer de novo dentro do periodo
// ---------------------------------------------------------------------------
export function precisaEnriquecerEmail(c: { email?: string; statusEmail?: string; verificadoEm?: string }, hoje: string, cacheDias: number): { precisa: boolean; motivo: string } {
  const valido = !!c.email && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido';
  if (!valido) return { precisa: true, motivo: c.email ? 'e-mail inválido/devolvido' : 'sem e-mail' };
  const dias = c.verificadoEm ? Math.floor((new Date(hoje).getTime() - new Date(c.verificadoEm).getTime()) / 86400000) : Infinity;
  if (dias <= cacheDias) return { precisa: false, motivo: `e-mail válido verificado há ${dias} dia(s) (cache ${cacheDias})` };
  return { precisa: true, motivo: `verificação com ${Number.isFinite(dias) ? dias : '?'} dias, acima do cache` };
}

/** Force refresh: so Administrador, com justificativa e nova chave de idempotencia. */
export function validarForceRefresh(x: { papel: string; justificativa?: string; idempotencyKeyNova?: string; idempotencyKeyAnterior?: string }): { ok: boolean; motivo?: string } {
  if (x.papel !== 'Administrador') return { ok: false, motivo: 'so Administrador pode forçar' };
  if (!x.justificativa || x.justificativa.trim().length < 5) return { ok: false, motivo: 'justificativa obrigatória' };
  if (!x.idempotencyKeyNova || x.idempotencyKeyNova === x.idempotencyKeyAnterior) return { ok: false, motivo: 'nova idempotencyKey obrigatória' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Configuracao do servidor: quais acoes exigem a chave da Explorium e a service role (RPCs mutaveis sao server-only)
// ---------------------------------------------------------------------------
/** Acoes que reservam/alteram consumo ou gravam a politica: so com SUPABASE_SERVICE_ROLE_KEY (nunca fallback para anon). */
export const ACOES_SERVIDOR = ['simular', 'reservar', 'cancelar', 'concluir', 'executar', 'catalogo'] as const;
/** Acoes que nao precisam da chave da Explorium (so leem o banco). */
export const ACOES_SEM_EXPLORIUM = ['orcamento', 'estado', 'cancelar'] as const;
export function verificarConfiguracaoServidor(x: { acao: string; temChave: boolean; temServiceRole: boolean }): { ok: true } | { ok: false; erro: 'configuracao_incompleta' | 'nao_configurado'; mensagem: string } {
  if ((ACOES_SERVIDOR as readonly string[]).includes(x.acao) && !x.temServiceRole) return { ok: false, erro: 'configuracao_incompleta', mensagem: 'SUPABASE_SERVICE_ROLE_KEY não definida no painel do Netlify: operações de consumo bloqueadas.' };
  if (!x.temChave && !(ACOES_SEM_EXPLORIUM as readonly string[]).includes(x.acao)) return { ok: false, erro: 'nao_configurado', mensagem: 'VIBE_API_KEY não definida no painel do Netlify.' };
  return { ok: true };
}

// Logica pura do cliente Vibe/Explorium (sem rede, sem chave): limites de pagina, paginacao com cursor em varias
// posicoes e fallback por page numerica, contrato do enriquecimento, estimativa, budget guard, idempotencia e log.
// Usada por scripts/vibe.mjs e coberta por src/core/radar/vibe-cli.test.ts.

/** AgentSource v2 limita page_size a 100. */
export const PAGE_SIZE_MAX = 100;
export const LOTE_ENRIQUECIMENTO_MAX = 50;
export const CUSTO = { match: 1, buscaFull: 1, email: 2, telefone: 5, perfil: 1 };
export const RESERVA_PADRAO = 20;
export const BUDGET_PADRAO = 180;

export const tamanhoPagina = (desejado) => Math.max(1, Math.min(PAGE_SIZE_MAX, Math.floor(Number(desejado) || 1)));

/** Valores do pool unico de descoberta (devem ser confirmados pelo autocomplete antes de qualquer chamada paga). */
export const POOL_JOB_LEVEL = ['c-suite', 'president', 'owner', 'founder', 'partner', 'vice president', 'director', 'senior manager', 'manager'];
export const POOL_JOB_DEPARTMENT = ['engineering', 'manufacturing', 'operations', 'real estate', 'logistics', 'procurement', 'c-suite'];

/** Filtros de um tier de prioridade + business_ids (+ disponibilidade de e-mail quando pedido). */
export function filtrosDecisores(tier, businessIds, somenteComEmail = false) {
  return { business_id: { values: businessIds }, ...tier.filtros, ...(somenteComEmail ? { has_contact_details: { value: 'email' } } : {}) };
}

/** Intersecao com o catalogo validado pelo autocomplete; sem catalogo, nada e permitido. */
export function filtrosValidados(desejados, catalogo) {
  const n = (s) => String(s).trim().toLowerCase();
  if (!catalogo) return { job_level: [], job_department: [], rejeitados: [...(desejados.job_level ?? []), ...(desejados.job_department ?? [])] };
  const ok = (lista, cat) => { const c = new Set((cat ?? []).map(n)); return { aceitos: (lista ?? []).filter((v) => c.has(n(v))), rejeitados: (lista ?? []).filter((v) => !c.has(n(v))) }; };
  const l = ok(desejados.job_level, catalogo.job_level); const d = ok(desejados.job_department, catalogo.job_department);
  return { job_level: l.aceitos, job_department: d.aceitos, rejeitados: [...l.rejeitados, ...d.rejeitados] };
}

export function filtrosPool(businessIds, catalogo, somenteComEmail = false) {
  const v = filtrosValidados({ job_level: POOL_JOB_LEVEL, job_department: POOL_JOB_DEPARTMENT }, catalogo);
  if (!v.job_level.length || !v.job_department.length) return { erro: 'catalogo_nao_validado', rejeitados: v.rejeitados };
  return { filtros: { business_id: { values: businessIds }, job_level: { values: v.job_level }, job_department: { values: v.job_department }, ...(somenteComEmail ? { has_contact_details: { value: 'email' } } : {}) }, rejeitados: v.rejeitados };
}

/** Acrescenta a `escolhidos` (Map business_id -> prospect) no maximo 1 pessoa por empresa valida. Retorna quantos entraram. */
export function escolherPorEmpresa(prospects, businessIdsValidos, escolhidos, max, extra = {}) {
  const validos = new Set(businessIdsValidos.map((b) => b.toLowerCase()));
  let novos = 0;
  for (const p of prospects) {
    const bid = (p.business_id ?? '').toLowerCase();
    if (!bid || !validos.has(bid) || escolhidos.has(bid) || escolhidos.size >= max) continue;
    escolhidos.set(bid, { ...p, business_id: bid, ...extra });
    novos++;
  }
  return novos;
}

/** Cursor em posicoes documentadas/observadas. */
export const cursorDe = (r) => r?.page?.next_cursor ?? r?.next_cursor ?? r?.pagination?.next_cursor ?? null;

/**
 * Paginacao segura: cursor quando existir, senao page numerica incremental (nunca repete a page 1); conjunto de ids
 * vistos; para em pagina vazia, sem novos ids, pagina menor que o tamanho sem cursor, cap de registros pagos,
 * orcamento reservado ou maxPaginas. `buscarPagina(params)` devolve { data, page|next_cursor|pagination, response_context }.
 */
export async function paginar(buscarPagina, { businessIds, escolhidos, max, maxPaginas = 5, extra = {}, cap = Infinity, orcamento = Infinity, custoPorRegistro = CUSTO.buscaFull }) {
  const correlacoes = []; const vistos = new Set(); let devolvidos = 0; let paginas = 0; let cursor = null; let motivo = 'max_paginas';
  while (paginas < maxPaginas && escolhidos.size < max) {
    const restanteCap = cap - devolvidos; const restanteOrc = Math.floor(orcamento / custoPorRegistro) - devolvidos;
    const tamanho = Math.min(tamanhoPagina((max - escolhidos.size) * 2), restanteCap, restanteOrc);
    if (tamanho <= 0) { motivo = restanteCap <= 0 ? 'cap_atingido' : 'orcamento_atingido'; break; }
    const r = await buscarPagina({ page_size: tamanho, ...(cursor ? { next_cursor: cursor } : { page: paginas + 1 }) });
    paginas++;
    const dados = r?.data ?? [];
    devolvidos += dados.length;
    if (r?.response_context?.correlation_id) correlacoes.push(r.response_context.correlation_id);
    const novos = dados.filter((d) => d.prospect_id && !vistos.has(String(d.prospect_id).toLowerCase()));
    for (const d of novos) vistos.add(String(d.prospect_id).toLowerCase());
    escolherPorEmpresa(novos, businessIds, escolhidos, max, extra);
    cursor = cursorDe(r);
    if (!dados.length) { motivo = 'pagina_vazia'; break; }
    if (!novos.length) { motivo = 'sem_novos_ids'; break; }
    if (devolvidos >= cap) { motivo = 'cap_atingido'; break; }
    if (devolvidos * custoPorRegistro >= orcamento) { motivo = 'orcamento_atingido'; break; }
    if (escolhidos.size >= max) { motivo = 'max_atingido'; break; }
    if (!cursor && dados.length < tamanho) { motivo = 'fim_sem_cursor'; break; }
  }
  return { paginas, devolvidos, correlacoes, motivo, vistos: vistos.size };
}

/** Contrato v2: campo `prospect_id` com uma string ou lista de ate 50 ids. */
export function payloadEnriquecimento(prospectIds, tipos = ['email']) {
  const ids = [...new Set(prospectIds.map((p) => String(p).toLowerCase()).filter((p) => /^[a-f0-9]{40}$/.test(p)))];
  if (!ids.length) throw new Error('Nenhum prospect_id válido.');
  if (ids.length > LOTE_ENRIQUECIMENTO_MAX) throw new Error(`No máximo ${LOTE_ENRIQUECIMENTO_MAX} prospect_ids por chamada.`);
  return { prospect_id: ids.length === 1 ? ids[0] : ids, parameters: { contact_types: tipos } };
}

/** Normaliza a resposta do enriquecimento aceitando prospect_id/entity_id no item ou em item.data. */
export function normalizarEnriquecimento(resposta) {
  const itens = Array.isArray(resposta) ? resposta : Array.isArray(resposta?.data) ? resposta.data : resposta ? [resposta] : [];
  return itens.map((item) => {
    const inner = item?.data && typeof item.data === 'object' ? item.data : {};
    const prospect_id = String(item?.prospect_id ?? item?.entity_id ?? inner.prospect_id ?? inner.entity_id ?? '').toLowerCase();
    return { prospect_id, professional_email: item?.professional_email ?? inner.professional_email ?? null, professional_email_status: item?.professional_email_status ?? inner.professional_email_status ?? null, mobile_phone: item?.mobile_phone ?? inner.mobile_phone ?? null };
  }).filter((x) => /^[a-f0-9]{40}$/.test(x.prospect_id));
}

/** Estimativa (nao e valor exato): descoberta, e-mail, telefone, perfil so se pedido, e reserva. */
export function estimar({ decisores, cobertura = Infinity, email = true, telefone = false, perfil = false, paginasMax = 5, reserva = RESERVA_PADRAO }) {
  const buscaMax = Math.min(decisores * 2 * paginasMax, Number.isFinite(cobertura) ? cobertura : decisores * 2 * paginasMax) * CUSTO.buscaFull;
  const buscaProvavel = Math.min(decisores * 2, Number.isFinite(cobertura) ? cobertura : decisores * 2) * CUSTO.buscaFull;
  const custoEmail = email ? decisores * CUSTO.email : 0;
  const custoTelefone = telefone ? decisores * (email ? CUSTO.telefone - CUSTO.email : CUSTO.telefone) : 0;
  const custoPerfil = perfil ? decisores * CUSTO.perfil : 0;
  const subtotal = buscaProvavel + custoEmail + custoTelefone + custoPerfil;
  return { busca: buscaProvavel, buscaMaxima: buscaMax, email: custoEmail, telefone: custoTelefone, perfil: custoPerfil, subtotal, reserva, total: subtotal + reserva, maximoProjetado: buscaMax + custoEmail + custoTelefone + custoPerfil, natureza: 'estimativa' };
}

/** Bloqueia se o custo maximo projetado puder ultrapassar min(budget, disponiveis - reserve). Nunca inicia lote parcial. */
export function budgetGuard({ custoMaximo, disponiveis, budget = BUDGET_PADRAO, reserve = RESERVA_PADRAO }) {
  const limite = Math.min(Number(budget), Number(disponiveis) - Number(reserve));
  const ok = Number.isFinite(limite) && custoMaximo <= limite;
  return { ok, limite, motivo: ok ? `custo máximo projetado ${custoMaximo} ≤ limite ${limite}` : `custo máximo projetado ${custoMaximo} ultrapassa o limite ${limite} (budget ${budget}, disponíveis ${disponiveis}, reserva ${reserve})` };
}

/** Remove prospects ja processados (CSV de saida e/ou ids importados). */
export const filtrarJaProcessados = (prospects, jaIds) => { const s = new Set([...jaIds].map((x) => String(x).toLowerCase())); return prospects.filter((p) => !s.has(String(p.prospect_id ?? '').toLowerCase())); };
export const emailValidoPresente = (linha) => !!linha.email && !['invalido', 'invalid', 'devolvido', 'bounced'].includes(String(linha.status_email ?? '').toLowerCase());
/** Cache: e-mail valido verificado dentro de `cacheDias` nao e enriquecido de novo (salvo force). */
export const dentroDoCache = (linha, hoje, cacheDias = 90) => { if (!emailValidoPresente(linha) || !linha.verificado_em) return false; const dias = Math.floor((new Date(hoje).getTime() - new Date(linha.verificado_em).getTime()) / 86400000); return dias >= 0 && dias <= cacheDias; };
/** Linhas que precisam de enriquecimento: sem e-mail valido, ou valido mas fora do cache (ou todas, com force). */
export const linhasParaEnriquecer = (linhas, { force = false, hoje = new Date().toISOString().slice(0, 10), cacheDias = 90 } = {}) => linhas.filter((l) => /^[a-f0-9]{40}$/i.test(String(l.prospect_id ?? '')) && (force || !emailValidoPresente(l) || !dentroDoCache(l, hoje, cacheDias)));

export const mascararEmail = (e) => { if (!e) return ''; const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 1)}***@${d}` : '***'; };
const CHAVE_LONGA = /[A-Za-z0-9_-]{24,}/g;
export const mascararChaves = (s) => String(s).replace(CHAVE_LONGA, (m) => (/^[a-f0-9]{32}$|^[a-f0-9]{40}$/.test(m) ? m : `${m.slice(0, 4)}…`));

/** Registro de consumo sem dados pessoais nem chave. */
export function registroConsumo({ operation, records_requested = 0, records_returned = 0, credits_before = null, credits_after = null, estimated_credits = 0, correlation_id = null, status = 'ok', detalhe = '' }) {
  const actual = credits_before != null && credits_after != null ? Number(credits_before) - Number(credits_after) : null;
  return { timestamp: new Date().toISOString(), operation, records_requested, records_returned, credits_before, credits_after, actual_credit_delta: actual, estimated_credits, correlation_id, status, detalhe: mascararChaves(detalhe).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => mascararEmail(m)).replace(/\+?\d[\d ()-]{7,}\d/g, '***') };
}

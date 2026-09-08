// Vibe Prospecting (Explorium Data API) no servidor, com controle de consumo no banco:
// - chave VIBE_API_KEY so no painel do Netlify; sessao Supabase obrigatoria; papel validado pela RPC;
// - toda acao paga exige uma operacao reservada (reserve_vibe_operation: idempotencia, politica, saldo, advisory lock);
// - a funcao marca RUNNING antes de chamar a Explorium e SUCCEEDED/FAILED/UNCERTAIN depois, com delta real de creditos;
// - budget/reserve/confirmar vindos do navegador nao sao fonte de verdade: a politica esta no banco;
// - as RPCs que reservam/alteram consumo sao server-only: chamadas com SUPABASE_SERVICE_ROLE_KEY (so no Netlify, nunca
//   no navegador, nunca em logs) DEPOIS de validar o JWT do usuario; o saldo passado a RPC vem de /v2/credits no servidor.
import { CUSTO_VIBE, PRIORIDADE_DECISORES, normalizarEnriquecimentoVibe, payloadEnriquecimentoVibe } from '../../src/core/radar/vibe';
import { POOL_JOB_DEPARTMENT, POOL_JOB_LEVEL, TITULOS_ESPECIFICOS, classificarErro, filtrosPool, filtrosValidados, hashRequisicao, proximaPagina, tamanhoPaginaServidor, verificarConfiguracaoServidor, type CatalogoFiltros, type TipoOperacao } from '../../src/core/radar/vibeServidor';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const BASE = process.env.VIBE_API_BASE ?? 'https://api.explorium.ai';
const mascarar = (s: string) => s.replace(/[A-Za-z0-9_-]{24,}/g, (m) => (/^[a-f0-9]{32}$|^[a-f0-9]{40}$/.test(m) ? m : `${m.slice(0, 4)}…`)).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***');

class ErroExplorium extends Error { constructor(msg: string, public enviado: boolean, public httpStatus?: number) { super(msg); } }
type Row = Record<string, unknown>;

async function explorium(chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Row> {
  let r: Response;
  try { r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: { accept: 'application/json', 'content-type': 'application/json', api_key: chave }, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new ErroExplorium(`rede/timeout: ${mascarar((e as Error).message)}`, true); }
  const texto = await r.text();
  let dados: Row; try { dados = JSON.parse(texto) as Row; } catch { dados = { raw: texto.slice(0, 300) }; }
  if (!r.ok) throw new ErroExplorium(`Explorium ${metodo} ${caminho} HTTP ${r.status}: ${mascarar(JSON.stringify(dados).slice(0, 300))}`, true, r.status);
  return dados;
}
const correlacao = (r: Row) => ((r.response_context as { correlation_id?: string } | undefined)?.correlation_id ?? null);

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = (process.env.VIBE_API_KEY ?? '').trim();
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(); // server-only; nunca sai desta funcao
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !anon) return json({ erro: 'nao_autenticado' }, 401);
  const cab = { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const user = await fetch(`${url}/auth/v1/user`, { headers: cab });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);
  const u = (await user.json()) as { id?: string };
  const perfilR = await fetch(`${url}/rest/v1/profile?id=eq.${u.id}&select=role,organization_id`, { headers: cab });
  const perfil = ((await perfilR.json().catch(() => [])) as { role?: string; organization_id?: string }[])[0];
  if (!perfil?.role) return json({ erro: 'sem_perfil' }, 403);
  // RPCs de leitura: com o JWT do usuario (current_org). RPCs mutaveis: com service_role, so depois do JWT validado acima.
  const cabServidor = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' };
  const chamarRpc = async (nome: string, args: Row, headers: Record<string, string>): Promise<Row> => { const r = await fetch(`${url}/rest/v1/rpc/${nome}`, { method: 'POST', headers, body: JSON.stringify(args) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`rpc ${nome}: ${mascarar(JSON.stringify(d).slice(0, 200))}`); return (d ?? {}) as Row; };
  const rpc = (nome: string, args: Row) => chamarRpc(nome, args, cab);
  const rpcServidor = (nome: string, args: Row) => chamarRpc(nome, { p_user_id: u.id, ...args }, cabServidor);
  const creditos = async () => { const c = await explorium(chave, 'GET', '/v2/credits'); return Number(c.remaining_credits); };
  const politica = async (disp?: number) => rpc('vibe_budget_status', { p_credits_available: disp ?? null });

  let corpo: Row; try { corpo = (await req.json()) as Row; } catch { return json({ erro: 'corpo_invalido' }, 400); }
  const acao = String(corpo.acao ?? '');
  const ids = ((corpo.businessIds as string[] | undefined) ?? []).filter((b) => /^[a-f0-9]{32}$/i.test(b)).map((b) => b.toLowerCase()).slice(0, 10000);
  const somenteComEmail = !!corpo.somenteComEmail;
  const cfg = verificarConfiguracaoServidor({ acao, temChave: !!chave, temServiceRole: !!service });
  if (!cfg.ok) return json({ erro: cfg.erro, mensagem: cfg.mensagem }, 501); // sem fallback para anon; nada e enviado a Explorium

  try {
    // ------------------------------------------------------------------ acoes gratuitas
    if (acao === 'creditos') { const c = await explorium(chave, 'GET', '/v2/credits'); return json({ disponiveis: c.remaining_credits, alocados: c.allocated_credits, conta: c.account_type }); }
    if (acao === 'orcamento') { const disp = chave ? await creditos().catch(() => undefined) : undefined; return json({ disponiveis: disp ?? null, politica: await politica(disp) }); }
    if (acao === 'estado') return json({ operacao: await rpc('vibe_operation_state', { p_id: corpo.operationId }) });
    if (acao === 'teste') {
      const antes = await creditos();
      const stats = await explorium(chave, 'POST', '/v2/prospects/stats', { filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] } } });
      const pv = await explorium(chave, 'POST', '/v2/prospects', { mode: 'preview', page_size: 1, page: 1, filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] } } });
      const depois = await creditos();
      const d = (pv.data as Row[] | undefined)?.[0];
      return json({ ok: true, chave: `presente (${chave.length} caracteres)`, creditosAntes: antes, creditosDepois: depois, engenhariaBrasil: stats.total_results, correlationIds: [correlacao(stats), correlacao(pv)], preview: d ? { prospect_id: d.prospect_id, business_id: d.business_id, job_title: d.job_title, company_name: d.company_name, job_level_main: d.job_level_main, job_department_main: d.job_department_main } : null });
    }
    if (acao === 'catalogo') {
      // valida pelo autocomplete (gratis) os valores usados no pool e nos titulos; grava na politica
      const valida = async (campo: string, valores: string[]) => { const ok: string[] = []; const nao: string[] = []; for (const v of valores) { const r = await explorium(chave, 'GET', `/v2/autocomplete?field=${encodeURIComponent(campo)}&query=${encodeURIComponent(v)}`); const lista = ((r.data as Row[] | undefined) ?? (r.results as Row[] | undefined) ?? (Array.isArray(r) ? (r as unknown as Row[]) : [])).map((x) => String(x.value ?? x.label ?? x.name ?? x).toLowerCase()); if (lista.includes(v.toLowerCase())) ok.push(v); else nao.push(`${v} (sugestões: ${lista.slice(0, 5).join(', ') || 'nenhuma'})`); } return { ok, nao }; };
      const antes = await creditos();
      const jl = await valida('job_level', POOL_JOB_LEVEL); const jd = await valida('job_department', POOL_JOB_DEPARTMENT);
      const titulos: Record<string, { ok: string[]; nao: string[] }> = {};
      for (const [grupo, lista] of Object.entries(TITULOS_ESPECIFICOS)) titulos[grupo] = await valida('job_title', lista);
      const depois = await creditos();
      const catalogo: CatalogoFiltros = { job_level: jl.ok, job_department: jd.ok, job_title: Object.values(titulos).flatMap((t) => t.ok), validado_em: new Date().toISOString() };
      const up = await fetch(`${url}/rest/v1/radar_vibe_credit_policy?org_id=eq.${perfil.organization_id}`, { method: 'PATCH', headers: { ...cabServidor, prefer: 'return=representation' }, body: JSON.stringify({ validated_filters: catalogo, validated_at: catalogo.validado_em, updated_by: u.id }) });
      const linhas = (await up.json().catch(() => [])) as unknown[];
      if (up.ok && !linhas.length) await fetch(`${url}/rest/v1/radar_vibe_credit_policy`, { method: 'POST', headers: cabServidor, body: JSON.stringify({ org_id: perfil.organization_id, validated_filters: catalogo, validated_at: catalogo.validado_em, updated_by: u.id }) });
      return json({ catalogo, divergencias: { job_level: jl.nao, job_department: jd.nao, job_title: Object.fromEntries(Object.entries(titulos).map(([g, t]) => [g, t.nao])) }, creditosAntes: antes, creditosDepois: depois, gravado: up.ok });
    }
    if (acao === 'cobertura' || acao === 'amostra') {
      if (!ids.length) return json({ erro: 'sem_business_ids' }, 400);
      const pol = await politica();
      const pool = filtrosPool(ids, (pol.validated_filters as CatalogoFiltros | null) ?? null, somenteComEmail);
      if (acao === 'cobertura') {
        const cobertura: { nome: string; total: number; validado: boolean }[] = [];
        if ('filtros' in pool) { const s = await explorium(chave, 'POST', '/v2/prospects/stats', { filters: pool.filtros }); cobertura.push({ nome: 'DISCOVERY_POOL', total: Number(s.total_results ?? 0), validado: true }); }
        else cobertura.push({ nome: 'DISCOVERY_POOL', total: 0, validado: false });
        for (const p of PRIORIDADE_DECISORES) { const s = await explorium(chave, 'POST', '/v2/prospects/stats', { filters: { business_id: { values: ids }, ...p.filtros, ...(somenteComEmail ? { has_contact_details: { value: 'email' } } : {}) } }); cobertura.push({ nome: p.nome, total: Number(s.total_results ?? 0), validado: false }); }
        return json({ cobertura, empresas: ids.length, catalogoValidado: 'filtros' in pool, rejeitados: pool.rejeitados });
      }
      if (!('filtros' in pool)) return json({ erro: 'catalogo_nao_validado', rejeitados: pool.rejeitados }, 409);
      const pv = await explorium(chave, 'POST', '/v2/prospects', { mode: 'preview', page_size: Math.max(1, Math.min(10, Number(corpo.n ?? 5))), page: 1, filters: pool.filtros });
      return json({ tier: 'DISCOVERY_POOL', amostra: pv.data ?? [], total: pv.total_results, correlationId: correlacao(pv) });
    }

    // ------------------------------------------------------------------ reserva (fonte de verdade: RPC + politica)
    const tipo = String(corpo.tipo ?? '') as TipoOperacao;
    const paramsReserva = (): { params: Row; estimado: number; registros: number; cap: number | null } => {
      if (tipo === 'match') { const emp = ((corpo.empresas as Row[] | undefined) ?? []).filter((e) => e.nome || e.dominio).slice(0, 50); return { params: { tipo, empresas: emp.map((e) => ({ id: e.id, nome: e.nome, dominio: e.dominio })) }, estimado: emp.length * CUSTO_VIBE.match, registros: emp.length, cap: emp.length }; }
      if (tipo === 'discovery_pool' || tipo === 'discovery') { const cap = Math.max(1, Math.min(500, Number(corpo.paidRecordCap ?? 20))); return { params: { tipo, businessIds: ids, somenteComEmail, paidRecordCap: cap, tier: tipo === 'discovery' ? Number(corpo.tier ?? 0) : null }, estimado: cap * CUSTO_VIBE.buscaFull, registros: cap, cap }; }
      if (tipo === 'enrich_email' || tipo === 'enrich_phone' || tipo === 'test_email') { const pids = ((corpo.prospectIds as string[] | undefined) ?? []).filter((p) => /^[a-f0-9]{40}$/i.test(p)).map((p) => p.toLowerCase()).slice(0, 50); return { params: { tipo, prospectIds: pids, justificativa: corpo.justificativa ?? null }, estimado: pids.length * (tipo === 'enrich_phone' ? CUSTO_VIBE.telefone : CUSTO_VIBE.email), registros: pids.length, cap: pids.length }; }
      throw new Error('tipo_invalido');
    };
    if (acao === 'simular' || acao === 'reservar') {
      const key = String(corpo.idempotencyKey ?? '').trim();
      if (!key || key.length < 8) return json({ erro: 'idempotency_key_obrigatoria' }, 400);
      const pr = paramsReserva();
      if (!pr.registros) return json({ erro: 'sem_registros' }, 400);
      const disp = await creditos(); // saldo obtido pelo servidor; o navegador nunca fornece o valor usado na decisao
      const r = await rpcServidor('reserve_vibe_operation', { p_idempotency_key: key, p_request_hash: hashRequisicao(pr.params), p_operation_type: tipo, p_estimated_credits: pr.estimado, p_records_requested: pr.registros, p_credits_available: disp, p_paid_record_cap: pr.cap, p_dry_run: acao === 'simular' });
      return json({ ...r, disponiveis: disp, estimado: pr.estimado, registros: pr.registros, requestHash: hashRequisicao(pr.params) });
    }
    if (acao === 'cancelar') { const r = await rpcServidor('update_vibe_operation', { p_id: corpo.operationId, p_status: 'CANCELLED', p_fields: { error_code: 'cancelada_pelo_usuario' } }); return json(r); }
    if (acao === 'concluir') {
      const disp = await creditos();
      const r = await rpcServidor('update_vibe_operation', { p_id: corpo.operationId, p_status: 'SUCCEEDED', p_fields: { credits_after: disp } });
      return json({ ...r, disponiveis: disp });
    }

    // ------------------------------------------------------------------ execucao paga: exige operacao RESERVED/RUNNING
    if (acao !== 'executar') return json({ erro: 'acao_invalida' }, 400);
    const opId = String(corpo.operationId ?? '');
    if (!opId || !String(corpo.idempotencyKey ?? '')) return json({ erro: 'operacao_obrigatoria', mensagem: 'Toda ação paga exige operationId e idempotencyKey reservados.' }, 400);
    const est = await rpc('vibe_operation_state', { p_id: opId });
    if (!est || !est.status) return json({ erro: 'operacao_nao_encontrada' }, 404);
    if (est.idempotency_key !== corpo.idempotencyKey) return json({ erro: 'idempotency_key_diferente' }, 409);
    if (est.status === 'SUCCEEDED') return json({ erro: 'ja_executada', resultado: est.result_summary }, 409);
    if (est.status === 'UNCERTAIN') return json({ erro: 'reconciliacao_necessaria' }, 409);
    if (est.status !== 'RESERVED' && est.status !== 'RUNNING') return json({ erro: 'operacao_nao_reservada', status: est.status }, 409);
    if (est.requested_by !== u.id && perfil.role !== 'Administrador') return json({ erro: 'sem_permissao' }, 403);
    const pr = paramsReserva();
    if (hashRequisicao(pr.params) !== est.request_hash) return json({ erro: 'payload_diferente', mensagem: 'Os parâmetros não são os mesmos da reserva.' }, 409);
    const pol = await politica();
    const antes = await creditos();
    if (est.status === 'RESERVED') await rpcServidor('update_vibe_operation', { p_id: opId, p_status: 'RUNNING', p_fields: { credits_before: antes } });
    const registrar = async (status: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN' | 'RUNNING', fields: Row) => rpcServidor('update_vibe_operation', { p_id: opId, p_status: status, p_fields: fields });
    let enviado = false;
    try {
      if (tipo === 'match') {
        const emp = pr.params.empresas as Row[];
        enviado = true;
        const r = await explorium(chave, 'POST', '/v2/businesses/match', { businesses_to_match: emp.map((e) => ({ name: e.nome || undefined, domain: e.dominio || undefined })) });
        const m = (r.matched_businesses as Row[] | undefined) ?? [];
        const resultados = emp.map((e, i) => ({ id: e.id, businessId: (m[i]?.business_id as string | null) ?? null }));
        const depois = await creditos();
        await registrar('SUCCEEDED', { credits_after: depois, records_delta: resultados.filter((x) => x.businessId).length, correlation_ids: [correlacao(r)].filter(Boolean), result_summary: { casadas: resultados.filter((x) => x.businessId).length, tentadas: emp.length } });
        return json({ resultados, casadas: resultados.filter((x) => x.businessId).length, creditosAntes: antes, creditosDepois: depois, correlationId: correlacao(r), operationId: opId });
      }
      if (tipo === 'enrich_email' || tipo === 'enrich_phone' || tipo === 'test_email') {
        const pids = pr.params.prospectIds as string[];
        enviado = true;
        const r = await explorium(chave, 'POST', '/v2/prospects/contact_information/enrich', payloadEnriquecimentoVibe(pids, tipo === 'enrich_phone' ? ['email', 'phone'] : ['email']));
        const resultados = normalizarEnriquecimentoVibe(r).map((x) => ({ ...x, professional_email: x.professional_email }));
        const depois = await creditos();
        await registrar('SUCCEEDED', { credits_after: depois, records_delta: resultados.length, correlation_ids: [correlacao(r)].filter(Boolean), result_summary: { pedidos: pids.length, retornados: resultados.length, com_email: resultados.filter((x) => x.professional_email).length, com_email_valid: resultados.filter((x) => x.professional_email && String(x.professional_email_status ?? '').toLowerCase() === 'valid').length } });
        return json({ resultados, creditosAntes: antes, creditosDepois: depois, correlationId: correlacao(r), operationId: opId });
      }
      // discovery: uma pagina por chamada, dentro do teto global da operacao (cap, politica, creditos reservados)
      // creditos ja gastos nesta operacao: delta real desde o inicio quando conhecido; senao, registros devolvidos x custo
      const gastos = est.credits_before != null ? Math.max(0, Number(est.credits_before) - antes) : Number(est.records_returned ?? 0) * CUSTO_VIBE.buscaFull;
      const pageSize = tamanhoPaginaServidor({ paidRecordCap: Number(est.paid_record_cap ?? pr.cap), recordsReturned: Number(est.records_returned ?? 0), maxPaidRecords: Number(pol.max_paid_records_per_operation ?? 20), reservedCredits: Number(est.reserved_credits ?? 0), creditosGastos: gastos, desejado: Number(corpo.n ?? 100) });
      if (pageSize <= 0) return json({ erro: 'cap_atingido', mensagem: 'Teto de registros pagos da operação atingido.', prospects: [], nextCursor: null }, 409);
      const catalogo = (pol.validated_filters as CatalogoFiltros | null) ?? null;
      let filtros: Row;
      if (tipo === 'discovery_pool') { const p = filtrosPool(ids, catalogo, somenteComEmail); if (!('filtros' in p)) return json({ erro: 'catalogo_nao_validado', rejeitados: p.rejeitados }, 409); filtros = p.filtros; }
      else {
        const tier = PRIORIDADE_DECISORES[Math.max(0, Math.min(PRIORIDADE_DECISORES.length - 1, Number(pr.params.tier ?? 0)))];
        const f = tier.filtros as Row;
        const v = filtrosValidados({ job_level: (f.job_level as { values?: string[] } | undefined)?.values, job_department: (f.job_department as { values?: string[] } | undefined)?.values }, catalogo);
        if (v.rejeitados.length) return json({ erro: 'filtro_nao_validado', rejeitados: v.rejeitados }, 409);
        filtros = { business_id: { values: ids }, ...f, ...(somenteComEmail ? { has_contact_details: { value: 'email' } } : {}) };
      }
      const estado = { pagina: Number(corpo.pagina ?? 0), cursor: (corpo.cursor as string | null) ?? null, vistos: new Set<string>(), devolvidos: 0, correlacoes: [] as string[] };
      enviado = true;
      const r = await explorium(chave, 'POST', '/v2/prospects', { mode: 'full', ...proximaPagina(estado, pageSize), filters: filtros });
      const dados = (r.data as Row[] | undefined) ?? [];
      const depois = await creditos();
      await registrar('RUNNING', { credits_after: depois, records_delta: dados.length, correlation_ids: [correlacao(r)].filter(Boolean), ...(Number(est.records_returned ?? 0) === 0 ? { result_summary: { empresas_alvo: ids.length, estrategia: tipo } } : {}) });
      const cursor = ((r.page as { next_cursor?: string | null } | undefined)?.next_cursor ?? (r.next_cursor as string | null | undefined) ?? (r.pagination as { next_cursor?: string | null } | undefined)?.next_cursor) ?? null;
      return json({ prospects: dados, pageSize, nextCursor: cursor, pagina: estado.pagina + 1, total: r.total_results, creditosAntes: antes, creditosDepois: depois, correlationId: correlacao(r), operationId: opId });
    } catch (e) {
      const erro = e as ErroExplorium;
      const status = classificarErro({ enviado: enviado && erro.enviado, httpStatus: erro.httpStatus });
      await registrar(status, { error_code: status === 'UNCERTAIN' ? 'rede_apos_envio' : `http_${erro.httpStatus ?? 'x'}`, error_message: mascarar(erro.message) }).catch(() => undefined);
      return json({ erro: status === 'UNCERTAIN' ? 'reconciliacao_necessaria' : 'vibe_indisponivel', status, mensagem: mascarar(erro.message), operationId: opId }, 502);
    }
  } catch (e) {
    return json({ erro: 'falha', mensagem: mascarar((e as Error).message) }, 500);
  }
};

export const config = { path: '/api/vibe' };

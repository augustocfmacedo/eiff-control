// Vibe Prospecting (Explorium Data API) no servidor: a chave VIBE_API_KEY fica so no painel do Netlify.
// Exige sessao valida do Supabase e papel Administrador ou Diretoria. Cada acao e pequena para caber no tempo da
// funcao; a tela encadeia as chamadas (match em lotes de 50, um tier de decisores por chamada, enriquecimento em 50).
// Nada da chave vai para logs ou para a resposta.
import { PRIORIDADE_DECISORES } from '../../src/core/radar/vibe';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const BASE = process.env.VIBE_API_BASE ?? 'https://api.explorium.ai';
const mascarar = (s: string) => s.replace(/[A-Za-z0-9_-]{24,}/g, (m) => `${m.slice(0, 4)}…`);

async function explorium(chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: { accept: 'application/json', 'content-type': 'application/json', api_key: chave }, body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let dados: Record<string, unknown>; try { dados = JSON.parse(texto) as Record<string, unknown>; } catch { dados = { raw: texto.slice(0, 300) }; }
  if (!r.ok) throw new Error(`Explorium ${metodo} ${caminho} HTTP ${r.status}: ${mascarar(JSON.stringify(dados).slice(0, 300))}`);
  return dados;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = (process.env.VIBE_API_KEY ?? '').trim();
  if (!chave) return json({ erro: 'nao_configurado', mensagem: 'VIBE_API_KEY não definida no painel do Netlify.' }, 501);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !anon) return json({ erro: 'nao_autenticado' }, 401);
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);
  const u = (await user.json()) as { id?: string };
  const perfil = await fetch(`${url}/rest/v1/profile?id=eq.${u.id}&select=role`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  const rows = (await perfil.json().catch(() => [])) as { role?: string }[];
  if (!['Administrador', 'Diretoria'].includes(rows?.[0]?.role ?? '')) return json({ erro: 'sem_permissao', mensagem: 'Só Administrador e Diretoria usam a integração Vibe.' }, 403);

  let corpo: { acao?: string; empresas?: { id: string; nome?: string; dominio?: string }[]; businessIds?: string[]; tier?: number; n?: number; max?: number; prospectIds?: string[]; telefone?: boolean; confirmar?: boolean };
  try { corpo = (await req.json()) as typeof corpo; } catch { return json({ erro: 'corpo_invalido' }, 400); }
  const ids = (corpo.businessIds ?? []).filter((b) => /^[a-f0-9]{32}$/i.test(b)).map((b) => b.toLowerCase()).slice(0, 10000);
  try {
    switch (corpo.acao) {
      case 'creditos': {
        const c = await explorium(chave, 'GET', '/v2/credits');
        return json({ disponiveis: c.remaining_credits, alocados: c.allocated_credits, conta: c.account_type });
      }
      case 'teste': {
        const antes = await explorium(chave, 'GET', '/v2/credits');
        const stats = await explorium(chave, 'POST', '/v2/prospects/stats', { filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] } } });
        const pv = await explorium(chave, 'POST', '/v2/prospects', { mode: 'preview', page_size: 1, page: 1, filters: { company_country_code: { values: ['br'] }, job_department: { values: ['engineering'] }, job_level: { values: ['director'] } } });
        const depois = await explorium(chave, 'GET', '/v2/credits');
        const d = (pv.data as Record<string, unknown>[] | undefined)?.[0];
        return json({ ok: true, chave: `presente (${chave.length} caracteres)`, creditosAntes: antes.remaining_credits, creditosDepois: depois.remaining_credits, alocados: antes.allocated_credits, conta: antes.account_type, engenhariaBrasil: stats.total_results, preview: d ? { prospect_id: d.prospect_id, business_id: d.business_id, job_title: d.job_title, company_name: d.company_name, job_level_main: d.job_level_main, job_department_main: d.job_department_main } : null });
      }
      case 'match': {
        const lote = (corpo.empresas ?? []).slice(0, 50).filter((e) => e.nome || e.dominio);
        if (!lote.length) return json({ erro: 'sem_empresas' }, 400);
        if (!corpo.confirmar) return json({ estimativa: { creditos: lote.length, empresas: lote.length } });
        const r = await explorium(chave, 'POST', '/v2/businesses/match', { businesses_to_match: lote.map((e) => ({ name: e.nome || undefined, domain: e.dominio || undefined })) });
        const m = (r.matched_businesses as Record<string, unknown>[] | undefined) ?? [];
        return json({ resultados: lote.map((e, i) => ({ id: e.id, businessId: (m[i]?.business_id as string | null) ?? null })), casadas: r.total_matches });
      }
      case 'cobertura': {
        if (!ids.length) return json({ erro: 'sem_business_ids' }, 400);
        const cobertura: { nome: string; total: number }[] = [];
        for (const p of PRIORIDADE_DECISORES) {
          const s = await explorium(chave, 'POST', '/v2/prospects/stats', { filters: { business_id: { values: ids }, ...p.filtros } });
          cobertura.push({ nome: p.nome, total: Number(s.total_results ?? 0) });
        }
        return json({ cobertura, empresas: ids.length });
      }
      case 'amostra': {
        if (!ids.length) return json({ erro: 'sem_business_ids' }, 400);
        const tier = PRIORIDADE_DECISORES[Math.max(0, Math.min(PRIORIDADE_DECISORES.length - 1, corpo.tier ?? 0))];
        const pv = await explorium(chave, 'POST', '/v2/prospects', { mode: 'preview', page_size: Math.max(1, Math.min(10, corpo.n ?? 5)), page: 1, filters: { business_id: { values: ids }, ...tier.filtros } });
        return json({ tier: tier.nome, amostra: pv.data ?? [], total: pv.total_results });
      }
      case 'decisores': {
        // um tier por chamada (modo full = ~1 credito por registro devolvido); a tela acumula e escolhe 1 por empresa
        if (!ids.length) return json({ erro: 'sem_business_ids' }, 400);
        if (!corpo.confirmar) return json({ erro: 'confirmar' }, 400);
        const i = Math.max(0, Math.min(PRIORIDADE_DECISORES.length - 1, corpo.tier ?? 0));
        const tamanho = Math.max(1, Math.min(200, corpo.n ?? 20));
        const r = await explorium(chave, 'POST', '/v2/prospects', { mode: 'full', page_size: tamanho, page: 1, filters: { business_id: { values: ids }, ...PRIORIDADE_DECISORES[i].filtros } });
        return json({ tier: PRIORIDADE_DECISORES[i].nome, prospects: r.data ?? [], total: r.total_results });
      }
      case 'enriquecer': {
        const pids = (corpo.prospectIds ?? []).filter((p) => /^[a-f0-9]{40}$/i.test(p)).slice(0, 50);
        if (!pids.length) return json({ erro: 'sem_prospect_ids' }, 400);
        const tipos = corpo.telefone ? ['email', 'phone'] : ['email'];
        if (!corpo.confirmar) return json({ estimativa: { creditos: pids.length * (corpo.telefone ? 5 : 2), registros: pids.length } });
        const r = await explorium(chave, 'POST', '/v2/prospects/contact_information/enrich', { prospect_ids: pids, parameters: { contact_types: tipos } });
        const dados = ((r.data as Record<string, unknown>[] | undefined) ?? []).map((d) => { const inner = (d.data as Record<string, unknown> | undefined) ?? d; return { prospect_id: d.prospect_id ?? inner.prospect_id, professional_email: inner.professional_email ?? null, professional_email_status: inner.professional_email_status ?? null, mobile_phone: inner.mobile_phone ?? null }; });
        return json({ resultados: dados });
      }
      default: return json({ erro: 'acao_invalida' }, 400);
    }
  } catch (e) {
    return json({ erro: 'vibe_indisponivel', mensagem: mascarar((e as Error).message) }, 502);
  }
};

export const config = { path: '/api/vibe' };

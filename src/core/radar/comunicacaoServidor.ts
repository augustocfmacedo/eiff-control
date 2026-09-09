// Handler da funcao /api/comunicacao com dependencias injetadas (fetch, portas do LLM), para ser testado sem rede.
// Fluxo: JWT -> usuario -> perfil (papel SO do banco) -> validacao estrutural do spec -> idempotencia por context_hash ->
// LLM (+juiz, uma regeneracao) -> INSERT completo em radar_communication (READY_FOR_REVIEW) com o JWT do usuario (RLS).
// Nada e enviado; nenhuma chave aparece em resposta ou log.
import { contentSpecPersistivel, type ContentSpec } from './comunicacao';
import { ErroGeracaoLlm, PAPEIS_RADAR, PROMPT_LLM_VERSION, PROVEDOR_ANTHROPIC, orquestrarGeracaoLlm, validarRequisicaoGeracao, type PortasLlm } from './comunicacaoLlm';

export interface DepsServidor {
  fetch: typeof fetch;
  supabaseUrl: string; anon: string;
  llmDisponivel: boolean; // ANTHROPIC_API_KEY presente
  portas: (modelo: string) => PortasLlm;
  modelo: string;
  agora?: () => string;
}
type Resp = { status: number; corpo: Record<string, unknown> };
const resp = (status: number, corpo: Record<string, unknown>): Resp => ({ status, corpo });
const mascarar = (s: string) => s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 300);

export async function tratarGeracaoComunicacao(req: { method: string; authorization?: string | null; body: unknown }, d: DepsServidor): Promise<Resp> {
  if (req.method !== 'POST') return resp(405, { erro: 'metodo' });
  const token = (req.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return resp(401, { erro: 'nao_autenticado' });
  const cab = { apikey: d.anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  // 1) usuario pelo Supabase Auth
  const user = await d.fetch(`${d.supabaseUrl}/auth/v1/user`, { headers: cab });
  if (!user.ok) return resp(401, { erro: 'nao_autenticado' });
  const u = (await user.json()) as { id?: string };
  if (!u.id) return resp(401, { erro: 'nao_autenticado' });
  // 2) papel SOMENTE do banco; sem perfil = negar; nada vindo do cliente
  const perfilR = await d.fetch(`${d.supabaseUrl}/rest/v1/profile?id=eq.${u.id}&select=role,organization_id`, { headers: cab });
  const perfil = perfilR.ok ? ((await perfilR.json().catch(() => [])) as { role?: string; organization_id?: string }[])[0] : undefined;
  if (!perfil?.role || !perfil.organization_id) return resp(403, { erro: 'sem_perfil' });
  if (!(PAPEIS_RADAR as readonly string[]).includes(perfil.role)) return resp(403, { erro: 'sem_permissao' });
  // 3) validacao estrutural (nunca texto livre; nunca PII; catalogos fechados; hash recalculado)
  const v = validarRequisicaoGeracao(req.body);
  if (!v.ok) return resp(400, { erro: 'requisicao_invalida', motivos: v.erros });
  const { req: r, } = v; const spec: ContentSpec = r.spec;
  // 4) idempotencia: comunicacao ativa com o mesmo context_hash -> devolve sem gastar tokens
  const existente = await d.fetch(`${d.supabaseUrl}/rest/v1/radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`, { headers: cab });
  if (existente.ok) { const rows = (await existente.json().catch(() => [])) as Record<string, unknown>[]; if (rows[0]) return resp(200, { comunicacao: rows[0], existente: true }); }
  if (!d.llmDisponivel) return resp(501, { erro: 'nao_configurado', mensagem: 'ANTHROPIC_API_KEY não definida no Netlify; use a versão padrão.' });
  // 5) LLM + validacoes (uma regeneracao corretiva)
  let gerado;
  try { gerado = await orquestrarGeracaoLlm(spec, d.portas(d.modelo)); }
  catch (e) {
    if (e instanceof ErroGeracaoLlm) return resp(e.codigo === 'provedor' || e.codigo === 'recusa' ? 502 : 422, { erro: e.codigo, mensagem: mascarar(e.message), motivos: e.motivos.map(mascarar) });
    return resp(502, { erro: 'ia_indisponivel', mensagem: mascarar((e as Error).message) });
  }
  // 6) INSERT completo (snapshot imutavel), estado READY_FOR_REVIEW, com o JWT do usuario (RLS decide)
  const agora = (d.agora ?? (() => new Date().toISOString()))();
  const row = {
    organization_id: perfil.organization_id, company_id: r.empresaId, contact_id: r.contatoId, signal_id: r.sinalId ?? null, strategy_id: r.estrategiaId ?? null,
    objective: spec.objetivo, playbook: spec.playbook, channel: spec.canal, state: 'READY_FOR_REVIEW', context_hash: spec.contextHash,
    content_spec: contentSpecPersistivel(spec), generated_content: gerado.resultado, edited_content: null, validation: gerado.validacao,
    provider: PROVEDOR_ANTHROPIC, model: gerado.resultado.metadados.modelo ?? d.modelo, prompt_version: PROMPT_LLM_VERSION, playbook_version: spec.versoes.playbook, content_spec_version: spec.versoes.contentSpec,
    created_by: u.id, last_transition_reason: `gerado por ${PROVEDOR_ANTHROPIC} em ${agora}`,
  };
  const ins = await d.fetch(`${d.supabaseUrl}/rest/v1/radar_communication`, { method: 'POST', headers: { ...cab, prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!ins.ok) {
    const texto = await ins.text().catch(() => '');
    if (ins.status === 409 || /duplicate|unique/i.test(texto)) { const de = await d.fetch(`${d.supabaseUrl}/rest/v1/radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`, { headers: cab }); const rows = de.ok ? ((await de.json().catch(() => [])) as Record<string, unknown>[]) : []; if (rows[0]) return resp(200, { comunicacao: rows[0], existente: true }); }
    return resp(500, { erro: 'persistencia', mensagem: mascarar(texto) });
  }
  const rows = (await ins.json().catch(() => [])) as Record<string, unknown>[];
  return resp(201, { comunicacao: rows[0], existente: false, metricas: { inputTokens: gerado.resultado.metadados.inputTokens, outputTokens: gerado.resultado.metadados.outputTokens, latenciaMs: gerado.resultado.metadados.latenciaMs, regenerado: gerado.validacao.regenerado, modelo: gerado.resultado.metadados.modelo } });
}

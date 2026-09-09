// Handler da funcao /api/comunicacao com dependencias injetadas (fetch, portas do LLM), para ser testado sem rede.
// O SERVIDOR e a unica fonte de verdade do ContentSpec: recebe so ids/canal/preferencias, carrega os dados reais do
// Radar com o JWT do usuario (RLS), verifica as relacoes (empresa/contato/sinal/estrategia da mesma organizacao e empresa),
// reconstroi o contexto e o spec, calcula o context_hash, reaproveita rascunho ativo, chama o LLM (+juiz, uma regeneracao)
// e insere a comunicacao completa em READY_FOR_REVIEW. Nada e enviado; nenhuma chave aparece em resposta ou log.
import { contentSpecPersistivel, contextoComunicacaoDe, montarContentSpec, type ContentSpec } from './comunicacao';
import { ErroGeracaoLlm, PAPEIS_RADAR, PROMPT_LLM_VERSION, PROVEDOR_ANTHROPIC, orquestrarGeracaoLlm, validarPedidoGeracao, validarRequisicaoGeracao, type PortasLlm } from './comunicacaoLlm';
import { radarVazio, type RadarDataset } from './types';
import { linhaApp, type ChaveRadar } from '../../data/radar.supabase';

export interface DepsServidor {
  fetch: typeof fetch;
  supabaseUrl: string; anon: string;
  llmDisponivel: boolean; // ANTHROPIC_API_KEY presente
  portas: (modelo: string) => PortasLlm;
  modelo: string;
  cidadeRemetente: string; // configuracao da organizacao no servidor (env), nunca do navegador
  agora?: () => string;
}
type Resp = { status: number; corpo: Record<string, unknown> };
type Row = Record<string, unknown>;
const resp = (status: number, corpo: Record<string, unknown>): Resp => ({ status, corpo });
const mascarar = (s: string) => s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 300);

export async function tratarGeracaoComunicacao(req: { method: string; authorization?: string | null; body: unknown }, d: DepsServidor): Promise<Resp> {
  if (req.method !== 'POST') return resp(405, { erro: 'metodo' });
  const token = (req.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return resp(401, { erro: 'nao_autenticado' });
  const cab = { apikey: d.anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const get = async (caminho: string): Promise<Row[] | null> => { const r = await d.fetch(`${d.supabaseUrl}/rest/v1/${caminho}`, { headers: cab }); if (!r.ok) return null; const j = await r.json().catch(() => null); return Array.isArray(j) ? (j as Row[]) : null; };
  // 1) usuario pelo Supabase Auth
  const user = await d.fetch(`${d.supabaseUrl}/auth/v1/user`, { headers: cab });
  if (!user.ok) return resp(401, { erro: 'nao_autenticado' });
  const u = (await user.json()) as { id?: string };
  if (!u.id) return resp(401, { erro: 'nao_autenticado' });
  // 2) papel SOMENTE do banco; sem perfil = negar; nada vindo do cliente
  const perfil = ((await get(`profile?id=eq.${u.id}&select=name,role,organization_id`)) ?? [])[0] as { name?: string; role?: string; organization_id?: string } | undefined;
  if (!perfil?.role || !perfil.organization_id) return resp(403, { erro: 'sem_perfil' });
  if (!(PAPEIS_RADAR as readonly string[]).includes(perfil.role)) return resp(403, { erro: 'sem_permissao' });
  // 3) contrato publico estrito: ids, canal, preferencias. Qualquer campo de contexto/spec/hash vindo do cliente e recusado
  const vp = validarPedidoGeracao(req.body);
  if (!vp.ok) return resp(400, { erro: 'requisicao_invalida', motivos: vp.erros });
  const p = vp.pedido;
  // 4) dados reais, escopados pela RLS do usuario
  const empRows = await get(`radar_company?id=eq.${p.empresaId}&select=*`);
  if (!empRows?.length) return resp(404, { erro: 'empresa_nao_encontrada' });
  const emp = empRows[0];
  if (emp.organization_id !== perfil.organization_id) return resp(403, { erro: 'empresa_de_outra_organizacao' });
  const contatoRows = await get(`radar_contact?id=eq.${p.contatoId}&select=*`);
  if (!contatoRows?.length) return resp(404, { erro: 'contato_nao_encontrado' });
  if (contatoRows[0].organization_id !== perfil.organization_id) return resp(403, { erro: 'contato_de_outra_organizacao' });
  if (contatoRows[0].company_id !== p.empresaId) return resp(400, { erro: 'contato_de_outra_empresa' });
  if (p.sinalId) {
    const sRows = await get(`radar_signal?id=eq.${p.sinalId}&select=id,company_id,organization_id`);
    if (!sRows?.length) return resp(404, { erro: 'sinal_nao_encontrado' });
    if (sRows[0].organization_id !== perfil.organization_id) return resp(403, { erro: 'sinal_de_outra_organizacao' });
    if (sRows[0].company_id !== p.empresaId) return resp(400, { erro: 'sinal_de_outra_empresa' });
  }
  const [contatos, sinais, atividades, oportunidades, projetos, supressoes, fontes, estrategias, regrasPersona, pesosFit, empresaEiff] = await Promise.all([
    get(`radar_contact?company_id=eq.${p.empresaId}&select=*`), get(`radar_signal?company_id=eq.${p.empresaId}&select=*`), get(`radar_activity?company_id=eq.${p.empresaId}&select=*`),
    get(`radar_opportunity?company_id=eq.${p.empresaId}&select=*`), get(`radar_project?company_id=eq.${p.empresaId}&select=*`), get(`radar_suppression?or=(company_id.eq.${p.empresaId},contact_id.eq.${p.contatoId})&select=*`),
    get('radar_source?select=*'), get('radar_strategy?select=*'), get('radar_persona_rule?select=*&order=priority'), get('radar_decision_fit_weight?select=key,value'), get('company?select=name&active=is.true&limit=1'),
  ]);
  if (!contatos || !sinais || !atividades || !oportunidades || !projetos || !supressoes || !fontes || !estrategias || !regrasPersona || !pesosFit) return resp(502, { erro: 'leitura_falhou' });
  if (p.estrategiaId && !estrategias.some((e) => e.id === p.estrategiaId && e.active)) return resp(400, { erro: 'estrategia_invalida' });
  const m = <T,>(chave: ChaveRadar, rows: Row[]) => rows.map((x) => linhaApp(chave, x)) as unknown as T[];
  const r: RadarDataset = { ...radarVazio(), empresas: m('empresas', [emp]), contatos: m('contatos', contatos), sinais: m('sinais', sinais), atividades: m('atividades', atividades), oportunidades: m('oportunidades', oportunidades), projetos: m('projetos', projetos), supressoes: m('supressoes', supressoes), fontes: m('fontes', fontes), estrategias: m('estrategias', estrategias), regrasPersona: m('regrasPersona', regrasPersona), pesosDecisionFit: pesosFit.map((x) => ({ chave: String(x.key), valor: Number(x.value) })) };
  // 5) contexto e spec reconstruidos AQUI; remetente do perfil + organizacao (nunca do cliente); canal confirmado contra os disponiveis
  const hoje = (d.agora ?? (() => new Date().toISOString()))().slice(0, 10);
  const ctx = contextoComunicacaoDe(r, p.empresaId, hoje, { contatoId: p.contatoId, canal: p.canal, citarIndicacao: p.citarIndicacao, sinalId: p.sinalId, estrategiaId: p.estrategiaId });
  if (!ctx || !ctx.contato) return resp(400, { erro: 'contexto_indisponivel' });
  if (!ctx.comunicar || !ctx.objetivo || !ctx.playbook) return resp(409, { erro: 'sem_comunicacao', mensagem: ctx.motivoSelecao });
  if (!ctx.canal.disponiveis.includes(p.canal)) return resp(400, { erro: 'canal_indisponivel', mensagem: `${p.canal} não tem dado válido para este contato`, disponiveis: ctx.canal.disponiveis });
  const remetente = { nome: String(perfil.name ?? '').trim() || 'Equipe comercial', empresa: String(empresaEiff?.[0]?.name ?? 'EIFF Engenharia'), cidade: d.cidadeRemetente };
  let spec: ContentSpec;
  try { spec = montarContentSpec(ctx, p.canal, remetente, { horaLocal: p.horaLocal }); } catch (e) { return resp(409, { erro: 'sem_comunicacao', mensagem: mascarar((e as Error).message) }); }
  // fact gate estrutural sobre o spec que o proprio servidor montou (defesa em profundidade)
  const vr = validarRequisicaoGeracao({ empresaId: p.empresaId, contatoId: p.contatoId, sinalId: ctx.sinal?.id, estrategiaId: p.estrategiaId, spec });
  if (!vr.ok) return resp(500, { erro: 'spec_invalido', motivos: vr.erros });
  // 6) idempotencia por hash calculado no servidor
  const ativas = await get(`radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`);
  if (ativas?.[0]) return resp(200, { comunicacao: ativas[0], existente: true });
  if (!d.llmDisponivel) return resp(501, { erro: 'nao_configurado', mensagem: 'ANTHROPIC_API_KEY não definida no Netlify; use a versão padrão.' });
  // 7) LLM + validacoes (uma regeneracao corretiva)
  let gerado;
  try { gerado = await orquestrarGeracaoLlm(spec, d.portas(d.modelo)); }
  catch (e) {
    if (e instanceof ErroGeracaoLlm) return resp(e.codigo === 'provedor' || e.codigo === 'recusa' ? 502 : 422, { erro: e.codigo, mensagem: mascarar(e.message), motivos: e.motivos.map(mascarar) });
    return resp(502, { erro: 'ia_indisponivel', mensagem: mascarar((e as Error).message) });
  }
  // 8) INSERT completo (snapshot imutavel), READY_FOR_REVIEW, com o JWT do usuario (RLS + trigger de coerencia no banco)
  const agora = (d.agora ?? (() => new Date().toISOString()))();
  const row = {
    organization_id: perfil.organization_id, company_id: p.empresaId, contact_id: p.contatoId, signal_id: ctx.sinal?.id ?? null, strategy_id: p.estrategiaId ?? estrategias.find((e) => e.code === ctx.estrategia)?.id ?? null,
    objective: spec.objetivo, playbook: spec.playbook, channel: spec.canal, state: 'READY_FOR_REVIEW', context_hash: spec.contextHash,
    content_spec: contentSpecPersistivel(spec), generated_content: gerado.resultado, edited_content: null, validation: gerado.validacao,
    provider: PROVEDOR_ANTHROPIC, model: gerado.resultado.metadados.modelo ?? d.modelo, prompt_version: PROMPT_LLM_VERSION, playbook_version: spec.versoes.playbook, content_spec_version: spec.versoes.contentSpec,
    created_by: u.id, last_transition_reason: `gerado por ${PROVEDOR_ANTHROPIC} em ${agora}`,
  };
  const ins = await d.fetch(`${d.supabaseUrl}/rest/v1/radar_communication`, { method: 'POST', headers: { ...cab, prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!ins.ok) {
    const texto = await ins.text().catch(() => '');
    if (ins.status === 409 || /duplicate|unique/i.test(texto)) { const de = await get(`radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`); if (de?.[0]) return resp(200, { comunicacao: de[0], existente: true }); }
    return resp(500, { erro: 'persistencia', mensagem: mascarar(texto) });
  }
  const rows = (await ins.json().catch(() => [])) as Row[];
  return resp(201, { comunicacao: rows[0], existente: false, metricas: { inputTokens: gerado.resultado.metadados.inputTokens, outputTokens: gerado.resultado.metadados.outputTokens, latenciaMs: gerado.resultado.metadados.latenciaMs, regenerado: gerado.validacao.regenerado, modelo: gerado.resultado.metadados.modelo } });
}

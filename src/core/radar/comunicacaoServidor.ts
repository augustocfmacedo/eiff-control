// Handler da funcao /api/comunicacao com dependencias injetadas (fetch, portas do LLM), para ser testado sem rede.
// O SERVIDOR e a unica fonte de verdade do ContentSpec: recebe so ids/canal/preferencias, carrega os dados reais do
// Radar com o JWT do usuario (RLS), verifica as relacoes (empresa/contato/sinal/estrategia da mesma organizacao e empresa),
// reconstroi o contexto e o spec, calcula o context_hash, reaproveita rascunho ativo, chama o LLM (+juiz, uma regeneracao)
// e insere a comunicacao completa em READY_FOR_REVIEW. Nada e enviado; nenhuma chave aparece em resposta ou log.
// Acao `validar_edicao` (Approval Path Fix 01): revalida no servidor o conteudo EDITADO de uma comunicacao existente
// (o snapshot minimizado do navegador nunca serve para validar), reconstruindo o spec completo pelo Server Truth,
// conferindo a coerencia do contexto (context_changed) e passando o texto pelo fact gate + juiz. Nao gera texto; nao grava.
import { contentSpecPersistivel, contextHashDe, contextoComunicacaoDe, hashTextoEfetivo, montarContentSpec, type ContentSpec, type VeredictoEdicao } from './comunicacao';
import { validarGeracao, type ResultadoGeracao } from './comunicacaoGeracao';
import { ANTHROPIC_CALL_TIMEOUT_MS, CANAIS_GERACAO_LLM, COMMUNICATION_DEADLINE_MS, ErroGeracaoLlm, ErroTimeoutLlm, PAPEIS_RADAR, PROMPT_LLM_VERSION, PROVEDOR_ANTHROPIC, comTimeout, montarMensagemJuiz, orquestrarGeracaoLlm, validarPedidoGeracao, validarRequisicaoGeracao, type PedidoGeracao, type PortasLlm, type TemposLlm } from './comunicacaoLlm';
import { radarVazio, type RadarDataset } from './types';
import { linhaApp, type ChaveRadar } from '../../data/radar.supabase';

export interface DepsServidor {
  fetch: typeof fetch;
  supabaseUrl: string; anon: string;
  llmDisponivel: boolean; // ANTHROPIC_API_KEY presente
  portas: (modelo: string, modeloJuiz: string) => PortasLlm;
  modelo: string; // modelo do motor comercial (ANTHROPIC_COMMUNICATION_MODEL), nunca o do Assistente
  modeloJuiz?: string;
  cidadeRemetente: string; // configuracao da organizacao no servidor (env), nunca do navegador
  agora?: () => string;
  // orcamento de tempo (Latency Budget Patch 01): a funcao sincrona tem 60 s; nunca deixar o Netlify responder 504
  deadlineMs?: number; timeoutChamadaMs?: number; relogio?: () => number;
  log?: (telemetria: Record<string, unknown>) => void; // communication_timing: so numeros, modelos, etapa e outcome
}
type Resp = { status: number; corpo: Record<string, unknown> };
type Row = Record<string, unknown>;
type Req = { method: string; authorization?: string | null; body: unknown };
const resp = (status: number, corpo: Record<string, unknown>): Resp => ({ status, corpo });
const ehResp = (x: unknown): x is Resp => !!x && typeof x === 'object' && 'status' in (x as Resp) && 'corpo' in (x as Resp);
const mascarar = (s: string) => s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').slice(0, 300);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Sessao { uid: string; perfil: { name?: string; role: string; organization_id: string }; cab: Record<string, string>; get: (caminho: string) => Promise<Row[] | null> }
/** 1-2) usuario pelo Supabase Auth e papel SOMENTE do banco; sem perfil = negar; nada vindo do cliente. */
export async function autenticar(req: Req, d: DepsServidor): Promise<Resp | Sessao> {
  const token = (req.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return resp(401, { erro: 'nao_autenticado' });
  const cab = { apikey: d.anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const get = async (caminho: string): Promise<Row[] | null> => { const r = await d.fetch(`${d.supabaseUrl}/rest/v1/${caminho}`, { headers: cab }); if (!r.ok) return null; const j = await r.json().catch(() => null); return Array.isArray(j) ? (j as Row[]) : null; };
  const user = await d.fetch(`${d.supabaseUrl}/auth/v1/user`, { headers: cab });
  if (!user.ok) return resp(401, { erro: 'nao_autenticado' });
  const u = (await user.json()) as { id?: string };
  if (!u.id) return resp(401, { erro: 'nao_autenticado' });
  const perfil = ((await get(`profile?id=eq.${u.id}&select=name,role,organization_id`)) ?? [])[0] as { name?: string; role?: string; organization_id?: string } | undefined;
  if (!perfil?.role || !perfil.organization_id) return resp(403, { erro: 'sem_perfil' });
  if (!(PAPEIS_RADAR as readonly string[]).includes(perfil.role)) return resp(403, { erro: 'sem_permissao' });
  return { uid: u.id, perfil: { name: perfil.name, role: perfil.role, organization_id: perfil.organization_id }, cab, get };
}

interface Reconstrucao { spec: ContentSpec; ctx: NonNullable<ReturnType<typeof contextoComunicacaoDe>>; estrategias: Row[] }
/** 4-5) Server Truth: dados reais escopados pela RLS, relacoes conferidas, contexto e spec reconstruidos AQUI (remetente do perfil + organizacao). */
async function reconstruir(p: PedidoGeracao, s: Sessao, d: DepsServidor): Promise<Resp | Reconstrucao> {
  const { get, perfil } = s;
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
  return { spec, ctx, estrategias };
}

export async function tratarGeracaoComunicacao(req: Req, d: DepsServidor): Promise<Resp> {
  if (req.method !== 'POST') return resp(405, { erro: 'metodo' });
  if (req.body && typeof req.body === 'object' && (req.body as Row).acao === 'validar_edicao') return tratarValidacaoEdicao(req, d);
  const relogio = d.relogio ?? Date.now; const t0 = relogio(); const deadline = d.deadlineMs ?? COMMUNICATION_DEADLINE_MS;
  const restanteMs = () => deadline - (relogio() - t0);
  const tempos: TemposLlm & Record<string, unknown> = {};
  const fim = (r: Resp, outcome: string): Resp => { d.log?.({ evento: 'communication_timing', ...tempos, total_ms: relogio() - t0, outcome, status: r.status, etapa: r.corpo.etapa ?? null }); return r; };
  const s = await autenticar(req, d); if (ehResp(s)) return s;
  const { cab, get, perfil, uid } = s;
  // 3) contrato publico estrito: ids, canal, preferencias. Qualquer campo de contexto/spec/hash vindo do cliente e recusado
  tempos.auth_ms = relogio() - t0;
  const vp = validarPedidoGeracao(req.body);
  if (!vp.ok) return resp(400, { erro: 'requisicao_invalida', motivos: vp.erros });
  const p = vp.pedido;
  const rec = await reconstruir(p, s, d); if (ehResp(rec)) return rec;
  const { spec, ctx, estrategias } = rec;
  tempos.context_load_ms = relogio() - t0 - Number(tempos.auth_ms ?? 0);
  // 6) idempotencia por hash calculado no servidor
  const ativas = await get(`radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`);
  if (ativas?.[0]) return resp(200, { comunicacao: ativas[0], existente: true });
  if (!d.llmDisponivel) return resp(501, { erro: 'nao_configurado', mensagem: 'ANTHROPIC_API_KEY não definida no Netlify; use a versão padrão.' });
  // 7) LLM + validacoes (uma regeneracao corretiva)
  let gerado;
  try { gerado = await orquestrarGeracaoLlm(spec, d.portas(d.modelo, d.modeloJuiz ?? d.modelo), { orcamento: { restanteMs, timeoutChamadaMs: d.timeoutChamadaMs ?? ANTHROPIC_CALL_TIMEOUT_MS }, tempos, relogio }); }
  catch (e) {
    if (e instanceof ErroGeracaoLlm && e.codigo === 'llm_timeout') return fim(resp(503, { erro: 'llm_timeout', etapa: e.etapa ?? null, mensagem: 'A geração excedeu o orçamento de tempo. Tente novamente.', motivos: e.motivos.map(mascarar) }), 'llm_timeout');
    if (e instanceof ErroGeracaoLlm) return fim(resp(e.codigo === 'provedor' || e.codigo === 'recusa' ? 502 : 422, { erro: e.codigo, mensagem: mascarar(e.message), motivos: e.motivos.map(mascarar) }), e.codigo);
    return fim(resp(502, { erro: 'ia_indisponivel', mensagem: mascarar((e as Error).message) }), 'ia_indisponivel');
  }
  // 8) INSERT completo (snapshot imutavel), READY_FOR_REVIEW, com o JWT do usuario (RLS + trigger de coerencia no banco)
  const agora = (d.agora ?? (() => new Date().toISOString()))();
  const row = {
    organization_id: perfil.organization_id, company_id: p.empresaId, contact_id: p.contatoId, signal_id: ctx.sinal?.id ?? null, strategy_id: p.estrategiaId ?? estrategias.find((e) => e.code === ctx.estrategia)?.id ?? null,
    objective: spec.objetivo, playbook: spec.playbook, channel: spec.canal, state: 'READY_FOR_REVIEW', context_hash: spec.contextHash,
    content_spec: contentSpecPersistivel(spec), generated_content: gerado.resultado, edited_content: null, validation: gerado.validacao,
    provider: PROVEDOR_ANTHROPIC, model: gerado.resultado.metadados.modelo ?? d.modelo, prompt_version: PROMPT_LLM_VERSION, playbook_version: spec.versoes.playbook, content_spec_version: spec.versoes.contentSpec,
    created_by: uid, last_transition_reason: `gerado por ${PROVEDOR_ANTHROPIC} em ${agora}`,
  };
  const tIns = relogio();
  const ins = await d.fetch(`${d.supabaseUrl}/rest/v1/radar_communication`, { method: 'POST', headers: { ...cab, prefer: 'return=representation' }, body: JSON.stringify(row) });
  tempos.persistence_ms = relogio() - tIns;
  if (!ins.ok) {
    const texto = await ins.text().catch(() => '');
    if (ins.status === 409 || /duplicate|unique/i.test(texto)) { const de = await get(`radar_communication?context_hash=eq.${spec.contextHash}&state=in.(DRAFT,READY_FOR_REVIEW,APPROVED)&select=*&limit=1`); if (de?.[0]) return fim(resp(200, { comunicacao: de[0], existente: true }), 'existente_corrida'); }
    return fim(resp(500, { erro: 'persistencia', mensagem: mascarar(texto) }), 'persistencia');
  }
  const rows = (await ins.json().catch(() => [])) as Row[];
  return fim(resp(201, { comunicacao: rows[0], existente: false, metricas: { inputTokens: gerado.resultado.metadados.inputTokens, outputTokens: gerado.resultado.metadados.outputTokens, latenciaMs: gerado.resultado.metadados.latenciaMs, regenerado: gerado.validacao.regenerado, modelo: gerado.resultado.metadados.modelo, tempos: { ...gerado.tempos, persistence_ms: tempos.persistence_ms, total_ms: relogio() - t0 } } }), 'ok');
}

// ---------------------------------------------------------------------------------------------------------------------
// Approval Path Fix 01: revalidacao server-side do conteudo editado. O snapshot persistido (content_spec) e minimo por
// desenho (deniedClaims sem texto, technicalClaims como ids) e NAO serve para validar; o spec completo e reconstruido
// pelo Server Truth e conferido contra o rascunho (context_changed). Nao gera texto e nao grava nada: devolve o veredito
// que o navegador precisa apresentar ao store para a transicao READY_FOR_REVIEW -> APPROVED.
// ---------------------------------------------------------------------------------------------------------------------
export const CAMPOS_VALIDAR_EDICAO = ['acao', 'communicationId', 'textoEditado', 'assuntoEditado'] as const;
export const MENSAGEM_CONTEXTO_MUDOU = 'O contexto comercial mudou desde a geração. Gere uma nova abordagem antes de aprovar.';
export async function tratarValidacaoEdicao(req: Req, d: DepsServidor): Promise<Resp> {
  const relogio = d.relogio ?? Date.now; const t0 = relogio(); const deadline = d.deadlineMs ?? COMMUNICATION_DEADLINE_MS;
  const tempos: TemposLlm & Record<string, unknown> = {};
  const fim = (r: Resp, outcome: string): Resp => { d.log?.({ evento: 'communication_timing', acao: 'validar_edicao', ...tempos, total_ms: relogio() - t0, outcome, status: r.status }); return r; };
  const s = await autenticar(req, d); if (ehResp(s)) return s;
  tempos.auth_ms = relogio() - t0;
  const b = (req.body ?? {}) as Row;
  const extras = Object.keys(b).filter((k) => !(CAMPOS_VALIDAR_EDICAO as readonly string[]).includes(k));
  const erros: string[] = [];
  if (extras.length) erros.push(`campos não permitidos: ${extras.slice(0, 6).join(', ')}`);
  if (!UUID.test(String(b.communicationId ?? ''))) erros.push('communicationId inválido');
  if (typeof b.textoEditado !== 'string' || !b.textoEditado.trim()) erros.push('textoEditado obrigatório');
  if (typeof b.textoEditado === 'string' && b.textoEditado.length > 6000) erros.push('textoEditado acima de 6000 caracteres');
  if (b.assuntoEditado !== undefined && b.assuntoEditado !== null && (typeof b.assuntoEditado !== 'string' || b.assuntoEditado.length > 300)) erros.push('assuntoEditado inválido');
  if (erros.length) return resp(400, { erro: 'requisicao_invalida', motivos: erros });
  const id = String(b.communicationId); const textoEditado = String(b.textoEditado); const assuntoEditado = typeof b.assuntoEditado === 'string' ? b.assuntoEditado : undefined;
  // comunicacao existente (RLS do usuario), da mesma organizacao, ainda em revisao
  const rows = await s.get(`radar_communication?id=eq.${id}&select=*`);
  if (!rows?.length) return resp(404, { erro: 'comunicacao_nao_encontrada' });
  const c = rows[0];
  if (c.organization_id !== s.perfil.organization_id) return resp(403, { erro: 'comunicacao_de_outra_organizacao' });
  if (c.state !== 'READY_FOR_REVIEW') return resp(409, { erro: 'estado_invalido', mensagem: `comunicação em ${String(c.state)}: só rascunhos em revisão são validados para aprovação` });
  const snapshot = (c.content_spec ?? {}) as Row;
  const canal = String(c.channel);
  if (!(CANAIS_GERACAO_LLM as readonly string[]).includes(canal)) return fim(resp(409, { erro: 'context_changed', mensagem: MENSAGEM_CONTEXTO_MUDOU, detalhe: 'canal fora do catálogo de validação' }), 'context_changed');
  // Server Truth: o spec completo e reconstruido a partir do banco, nunca do snapshot enviado pelo navegador
  const pedido: PedidoGeracao = { empresaId: String(c.company_id), contatoId: String(c.contact_id), sinalId: c.signal_id ? String(c.signal_id) : undefined, estrategiaId: c.strategy_id ? String(c.strategy_id) : undefined, canal: canal as PedidoGeracao['canal'], citarIndicacao: snapshot.sourceDisclosure === 'ALLOWED', horaLocal: typeof snapshot.horaLocal === 'number' ? snapshot.horaLocal : undefined };
  const rec = await reconstruir(pedido, s, d);
  if (ehResp(rec)) { if (rec.status === 401 || rec.status === 403 || rec.status >= 500) return rec; return fim(resp(409, { erro: 'context_changed', mensagem: MENSAGEM_CONTEXTO_MUDOU, detalhe: rec.corpo.erro }), 'context_changed'); }
  const { spec, ctx } = rec;
  tempos.context_load_ms = relogio() - t0 - Number(tempos.auth_ms ?? 0);
  // coerencia: o contexto reconstruido (com as versoes gravadas no rascunho) tem de produzir o mesmo context_hash do rascunho
  const versoes = { playbook: String(c.playbook_version ?? spec.versoes.playbook), contentSpec: String(c.content_spec_version ?? spec.versoes.contentSpec) };
  const hashAtual = contextHashDe({ empresaId: pedido.empresaId, contatoId: pedido.contatoId, sinalId: ctx.sinal?.id, objetivo: spec.objetivo, playbook: spec.playbook, canal: spec.canal, claims: spec.allowedClaims, sourceDisclosure: spec.sourceDisclosure, versoes });
  if (hashAtual !== String(c.context_hash)) return fim(resp(409, { erro: 'context_changed', mensagem: MENSAGEM_CONTEXTO_MUDOU, detalhe: 'context_hash divergente' }), 'context_changed');
  const versoesDiferentes = versoes.playbook !== spec.versoes.playbook || versoes.contentSpec !== spec.versoes.contentSpec;
  // conteudo efetivo = original + edicao humana; fact gate deterministico com o spec COMPLETO
  const original = (c.generated_content ?? {}) as Partial<ResultadoGeracao>;
  const efetivo: ResultadoGeracao = { versaoPrincipal: textoEditado, versoesAlternativas: original.versoesAlternativas ?? [], objecoes: original.objecoes ?? [], assunto: assuntoEditado ?? original.assunto, roteiroLigacao: original.roteiroLigacao, claimsUsados: original.claimsUsados ?? [], metadados: (original.metadados ?? { provedor: 'deterministico', modelo: '', promptVersao: '', regenerado: false }) as ResultadoGeracao['metadados'] };
  const textoHash = hashTextoEfetivo(textoEditado, efetivo.assunto);
  const base = { communicationId: id, contextHash: String(c.context_hash), textoHash, validadoEm: (d.agora ?? (() => new Date().toISOString()))(), versoesDiferentes };
  const tDet = relogio(); const det = validarGeracao(spec, efetivo); tempos.deterministic_validation_ms = relogio() - tDet;
  if (!det.ok) { const veredito: VeredictoEdicao = { ...base, ok: false, problemas: det.problemas, juiz: 'SKIPPED' }; return fim(resp(422, { erro: 'validacao_deterministica', mensagem: 'O conteúdo editado não passou pela validação.', motivos: det.problemas.map(mascarar), veredito }), 'validacao_deterministica'); }
  // juiz semantico (uma chamada, dentro do orcamento de tempo; sem regeneracao: aqui ninguem gera texto)
  if (!d.llmDisponivel) return resp(501, { erro: 'nao_configurado', mensagem: 'ANTHROPIC_API_KEY não definida no Netlify: a edição não pode ser revalidada.' });
  const restante = deadline - (relogio() - t0); const timeoutMs = Math.max(1, Math.min(d.timeoutChamadaMs ?? ANTHROPIC_CALL_TIMEOUT_MS, restante));
  if (restante < 4_000) return fim(resp(503, { erro: 'llm_timeout', etapa: 'juiz', mensagem: 'A validação excedeu o orçamento de tempo. Tente novamente.' }), 'llm_timeout');
  const tJ = relogio();
  let j;
  try { j = await comTimeout(d.portas(d.modelo, d.modeloJuiz ?? d.modelo).julgar(montarMensagemJuiz(spec, efetivo), { timeoutMs }), timeoutMs, 'juiz'); }
  catch (e) {
    if (e instanceof ErroTimeoutLlm || (e instanceof ErroGeracaoLlm && e.codigo === 'llm_timeout')) return fim(resp(503, { erro: 'llm_timeout', etapa: 'juiz', mensagem: 'A validação excedeu o orçamento de tempo. Tente novamente.' }), 'llm_timeout');
    return fim(resp(502, { erro: 'ia_indisponivel', mensagem: mascarar((e as Error).message) }), 'ia_indisponivel');
  }
  tempos.judge_ms = relogio() - tJ; tempos.model_judge = j.modelo;
  const veredictoJuiz = (j.json ?? {}) as { verdict?: string; reasons?: string[] };
  if (veredictoJuiz.verdict !== 'PASS') { const problemas = (veredictoJuiz.reasons ?? ['reprovado pelo validador semântico']).map(String); const veredito: VeredictoEdicao = { ...base, ok: false, problemas, juiz: 'FAIL' }; return fim(resp(422, { erro: 'validacao_semantica', mensagem: 'O conteúdo editado não passou pela validação.', motivos: problemas.map(mascarar), veredito }), 'validacao_semantica'); }
  const veredito: VeredictoEdicao = { ...base, ok: true, problemas: [], juiz: 'PASS' };
  return fim(resp(200, { ok: true, veredito }), 'ok');
}

// /api/comunicacao com fetch e LLM mockados: auth, papel do banco, validacao, idempotencia, insert completo, chave nunca exposta.
import { describe, expect, it } from 'vitest';
import { buildCommunicationContext, montarContentSpec, type EntradaContexto } from './comunicacao';
import { gerarComunicacaoSincrona } from './comunicacaoGeracao';
import { type ChamadaLlm, type PortasLlm } from './comunicacaoLlm';
import { tratarGeracaoComunicacao, type DepsServidor } from './comunicacaoServidor';
import { FONTES_PADRAO } from './padroes';
import type { Contato, Empresa, Sinal } from './types';

const CHAVE_FALSA = 'sk-ant-chave-ficticia-nunca-exposta';
const U = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const F = (c: string) => FONTES_PADRAO.find((f) => f.codigo === c)!;
const E1: Empresa = { id: U(1), razaoSocial: 'Indústria Fictícia', pais: 'Brasil', cidade: 'Cidade Fictícia', uf: 'GO', faixaFuncionarios: '[1001-5000]', fonteId: F('VIBE').id, observacoes: '', ativo: true, criadoEm: '2026-09-01T00:00:00.000Z', atualizadoEm: '', fitScore: 80, intentScore: 0, timingScore: 20, relationshipScore: 0, dataQualityScore: 60, priorityScore: 30, priorityClass: 'C' };
const CEO = { id: U(11), empresaId: E1.id, nome: 'Executivo Fictício', cargo: 'Presidente', persona: 'CEO', decisionFitScore: 55, senioridade: 'C-level', email: 'x@exemplo.invalid', statusEmail: 'valido', celular: '+55', fonteId: F('VIBE').id, ativo: true, criadoEm: '2026-09-02T00:00:00.000Z', atualizadoEm: '', qualidade: 70, decisor: false } as Contato;
const S1: Sinal = { id: U(21), empresaId: E1.id, fonteId: F('WEBSITE').id, fonteTipo: 'WEBSITE', tipo: 'NEW_FACTORY', titulo: 'nova unidade', descricao: '', eventoEm: '2026-06-01', detectadoEm: '', confianca: 0.9, url: 'https://x.invalid', payload: { bruto: {}, leitura: { relevanciaEstrutural: 'DIRECT', oQueAconteceu: 'A Indústria Fictícia inaugurou nova unidade de 20 mil m²' } }, scoreBase: 55, scoreEfetivo: 50, verificado: true, criadoEm: '' };
const entrada: EntradaContexto = { empresa: E1, contato: CEO, sinal: S1, atividades: [], contatos: [CEO], fontes: FONTES_PADRAO, fitIdeal: 70, proximaAcaoAtual: 'SEARCH_DECISION_MAKER', hoje: '2026-09-09' };
const spec = montarContentSpec(buildCommunicationContext(entrada), 'WHATSAPP', { nome: 'Vendedor Fictício', empresa: 'EIFF Engenharia', cidade: 'Goiânia' }, { horaLocal: 10 });
const corpoOk = { empresaId: E1.id, contatoId: CEO.id, sinalId: S1.id, spec };
const PERFIL = U(99);

interface Cenario { user?: { ok: boolean; id?: string }; perfil?: { role?: string; organization_id?: string } | null | 'erro'; existente?: Record<string, unknown>; insertOk?: boolean }
function deps(c: Cenario, log: { url: string; init?: RequestInit }[] = []): DepsServidor {
  const fetchMock = (async (url: string, init?: RequestInit) => {
    log.push({ url, init });
    const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.includes('/auth/v1/user')) return c.user?.ok ? j(200, { id: c.user.id ?? PERFIL }) : j(401, {});
    if (url.includes('/rest/v1/profile')) return c.perfil === 'erro' ? j(500, {}) : j(200, c.perfil === null ? [] : [c.perfil ?? { role: 'Administrador', organization_id: U(7) }]);
    if (url.includes('/rest/v1/radar_communication?')) return j(200, c.existente ? [c.existente] : []);
    if (url.includes('/rest/v1/radar_communication')) return c.insertOk === false ? j(409, { message: 'duplicate key value violates unique constraint' }) : j(201, [{ id: U(55), ...JSON.parse(String(init?.body ?? '{}')) }]);
    return j(404, {});
  }) as unknown as typeof fetch;
  const portas: PortasLlm = {
    gerar: async () => { const r = gerarComunicacaoSincrona(spec); return { json: { primary: r.versaoPrincipal, alternatives: r.versoesAlternativas, claims_used: r.claimsUsados }, modelo: 'mock-model', inputTokens: 120, outputTokens: 60, latenciaMs: 7 } as ChamadaLlm; },
    julgar: async () => ({ json: { verdict: 'PASS', reasons: [] }, modelo: 'mock-model', inputTokens: 80, outputTokens: 5, latenciaMs: 3 }),
  };
  return { fetch: fetchMock, supabaseUrl: 'https://supabase.invalid', anon: 'anon-publica', llmDisponivel: true, portas: () => portas, modelo: 'mock-model', agora: () => '2026-09-09T12:00:00.000Z' };
}
const req = (body: unknown, auth: string | null = 'Bearer jwt-ficticio') => ({ method: 'POST', authorization: auth, body });

describe('/api/comunicacao (handler com dependências mockadas)', () => {
  it('sem JWT → 401; JWT inválido → 401; perfil ausente → 403; erro ao carregar perfil → 403; papel sem radar → 403', async () => {
    expect((await tratarGeracaoComunicacao(req(corpoOk, null), deps({ user: { ok: true } }))).status).toBe(401);
    expect((await tratarGeracaoComunicacao(req(corpoOk), deps({ user: { ok: false } }))).status).toBe(401);
    expect((await tratarGeracaoComunicacao(req(corpoOk), deps({ user: { ok: true }, perfil: null }))).status).toBe(403);
    expect((await tratarGeracaoComunicacao(req(corpoOk), deps({ user: { ok: true }, perfil: 'erro' }))).status).toBe(403);
    expect((await tratarGeracaoComunicacao(req(corpoOk), deps({ user: { ok: true }, perfil: { role: 'Auditoria', organization_id: U(7) } }))).status).toBe(403);
    expect((await tratarGeracaoComunicacao({ method: 'GET', authorization: 'x', body: {} }, deps({ user: { ok: true } }))).status).toBe(405);
  });
  it('papel enviado pelo cliente é ignorado: só o perfil do banco conta', async () => {
    const r = await tratarGeracaoComunicacao(req({ ...corpoOk, role: 'Administrador', papel: 'Administrador' }), deps({ user: { ok: true }, perfil: { role: 'Contabilidade', organization_id: U(7) } }));
    expect(r.status).toBe(403);
  });
  it('payload com raw_payload/email/telefone → 400; objective inválido → 400; playbook inválido → 400; claim desconhecido → 422', async () => {
    const d = deps({ user: { ok: true } });
    expect((await tratarGeracaoComunicacao(req({ ...corpoOk, spec: { ...spec, raw_payload: {} } }), d)).status).toBe(400);
    expect((await tratarGeracaoComunicacao(req({ ...corpoOk, spec: { ...spec, audiencia: { ...spec.audiencia, email: 'a@b', telefone: '1' } } }), d)).status).toBe(400);
    expect((await tratarGeracaoComunicacao(req({ ...corpoOk, spec: { ...spec, objetivo: 'OUTRO' } }), d)).status).toBe(400);
    expect((await tratarGeracaoComunicacao(req({ ...corpoOk, spec: { ...spec, playbook: 'OUTRO' } }), d)).status).toBe(400);
    const dClaim = deps({ user: { ok: true } }); dClaim.portas = () => ({ gerar: async () => ({ json: { primary: 'x', alternatives: [], claims_used: ['inexistente'] }, modelo: 'm', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }), julgar: async () => ({ json: { verdict: 'PASS', reasons: [] }, modelo: 'm', inputTokens: 1, outputTokens: 1, latenciaMs: 1 }) });
    const r = await tratarGeracaoComunicacao(req(corpoOk), dClaim); expect(r.status).toBe(422); expect(r.corpo.erro).toBe('claim_desconhecido');
  });
  it('idempotência: comunicação ativa com o mesmo context_hash é devolvida sem chamar o modelo nem inserir', async () => {
    const log: { url: string; init?: RequestInit }[] = [];
    let chamouLlm = false;
    const d = deps({ user: { ok: true }, existente: { id: U(77), context_hash: spec.contextHash, state: 'READY_FOR_REVIEW' } }, log);
    d.portas = () => ({ gerar: async () => { chamouLlm = true; throw new Error('não deveria'); }, julgar: async () => { throw new Error('não deveria'); } });
    const r = await tratarGeracaoComunicacao(req(corpoOk), d);
    expect(r.status).toBe(200); expect(r.corpo.existente).toBe(true); expect(chamouLlm).toBe(false);
    expect(log.some((l) => l.init?.method === 'POST' && l.url.endsWith('/rest/v1/radar_communication'))).toBe(false);
    // corrida: unique no insert -> devolve a existente
    const d2 = deps({ user: { ok: true }, insertOk: false }); const log2: { url: string; init?: RequestInit }[] = [];
    d2.fetch = (async (url: string, init?: RequestInit) => { log2.push({ url, init }); if (url.includes('radar_communication?') && log2.filter((l) => l.url.includes('radar_communication?')).length > 1) return new Response(JSON.stringify([{ id: U(78), context_hash: spec.contextHash }]), { status: 200 }); return deps({ user: { ok: true }, insertOk: false }).fetch(url, init); }) as unknown as typeof fetch;
    const r2 = await tratarGeracaoComunicacao(req(corpoOk), d2); expect(r2.status).toBe(200); expect(r2.corpo.existente).toBe(true);
  });
  it('sucesso: INSERT completo em READY_FOR_REVIEW com provider ANTHROPIC, modelo, prompt versionado, validação, métricas; chave nunca na resposta; sem LLM → 501', async () => {
    const log: { url: string; init?: RequestInit }[] = [];
    const r = await tratarGeracaoComunicacao(req(corpoOk), deps({ user: { ok: true } }, log));
    expect(r.status).toBe(201); expect(r.corpo.existente).toBe(false);
    const ins = log.find((l) => l.init?.method === 'POST' && l.url.endsWith('/rest/v1/radar_communication'))!;
    expect(ins.init?.headers).toMatchObject({ authorization: 'Bearer jwt-ficticio', prefer: 'return=representation' });
    const row = JSON.parse(String(ins.init?.body)) as Record<string, unknown>;
    expect(row).toMatchObject({ state: 'READY_FOR_REVIEW', provider: 'ANTHROPIC', model: 'mock-model', prompt_version: 'COMMUNICATION_LLM_PROMPT_V1', context_hash: spec.contextHash, company_id: E1.id, contact_id: CEO.id, signal_id: S1.id, created_by: PERFIL, organization_id: U(7), edited_content: null });
    expect(row.generated_content).toMatchObject({ metadados: { inputTokens: 120, outputTokens: 60, latenciaMs: 7, regenerado: false } });
    expect(row.validation).toMatchObject({ ok: true, juiz: 'PASS' });
    expect(JSON.stringify(row)).not.toMatch(/raw_payload|bruto|"email"|"celular"|"telefone"/);
    expect(JSON.stringify(r.corpo)).not.toContain(CHAVE_FALSA); expect(JSON.stringify(row)).not.toContain(CHAVE_FALSA);
    expect(r.corpo.metricas).toMatchObject({ inputTokens: 120, outputTokens: 60, modelo: 'mock-model', regenerado: false });
    const semLlm = deps({ user: { ok: true } }); semLlm.llmDisponivel = false;
    expect((await tratarGeracaoComunicacao(req(corpoOk), semLlm)).status).toBe(501);
  });
});

// Adapter READ-ONLY do GitHub e handler puro de /api/development-status (Wave 03, F4).
// Nenhuma chamada real de rede: fetch mockado em todos os casos, e um afterEach global confere que so houve GET.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PAPEIS } from '../capacitacao';
import { pode } from '../../data/store';
import type { Usuario } from '../types';
import {
  ESTADOS_FONTE, MAX_BRANCHES_DETALHE, PAPEIS_MISSION_CONTROL, REPOSITORIO_GITHUB, VARIAVEL_TOKEN_GITHUB, WORKFLOW_QUALITY_GATE,
  ehBranchDeTrabalho, estadoDoHttp, lerStatusDesenvolvimento, normalizarBranchDetalhe, normalizarExecucao, normalizarListaBranches,
  tratarDevelopmentStatus, type DepsDevelopmentStatus, type RespostaDevelopmentStatus,
} from './githubAdapter';

const RAIZ = path.resolve(__dirname, '../../..');
const GH = 'https://api.github.test';
const SB = 'https://sb.test';
const TOKEN = 'github_pat_SEGREDO_NUNCA_VAZA';
const REPO = `${GH}/repos/${REPOSITORIO_GITHUB.dono}/${REPOSITORIO_GITHUB.nome}`;
const AGORA = '2026-09-11T12:00:00.000Z';

// ---------------------------------------------------------------------------- guarda global: so GET
const chamadasGlobais: { url: string; metodo: string; init?: RequestInit }[] = [];
afterEach(() => {
  for (const c of chamadasGlobais) expect(c.metodo, `${c.url} usou ${c.metodo}`).toBe('GET');
  chamadasGlobais.length = 0;
});

const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const branchDetalhe = (name: string, sha: string, date: string, message = 'msg') => ({ name, commit: { sha, commit: { message, committer: { date }, author: { date } } } });

interface Cenario {
  mainHttp?: number; execHttp?: number; listaHttp?: number; detalheHttp?: number;
  mainThrow?: 'abort' | 'rede'; branches?: { name: string; sha: string }[]; runs?: unknown[]; mainSemJson?: boolean;
  perfil?: { role?: string; organization_id?: string } | null; autenticado?: boolean;
}
function ambiente(c: Cenario = {}) {
  const chamadas: { url: string; metodo: string; headers: Record<string, string> }[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    chamadas.push({ url: String(url), metodo, headers });
    chamadasGlobais.push({ url: String(url), metodo, init });
    const u = String(url);
    if (u.startsWith(`${SB}/auth/v1/user`)) return c.autenticado === false ? j({}, 401) : j({ id: 'u-1' });
    if (u.includes('/rest/v1/profile')) return j(c.perfil === null ? [] : [c.perfil ?? { role: 'Administrador', organization_id: 'org-1' }]);
    if (u === `${REPO}/branches/main`) {
      if (c.mainThrow === 'abort') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      if (c.mainThrow === 'rede') throw new TypeError('fetch failed');
      if (c.mainHttp && c.mainHttp !== 200) return j({ message: 'x' }, c.mainHttp);
      if (c.mainSemJson) return new Response('<html>', { status: 200 });
      return j(branchDetalhe('main', 'abcdef1234567890', '2026-09-11T10:00:00Z', 'Wave 03: plano\n\ncorpo'));
    }
    if (u.startsWith(`${REPO}/actions/workflows/`)) {
      if (c.execHttp && c.execHttp !== 200) return j({}, c.execHttp);
      return j({ total_count: 1, workflow_runs: c.runs ?? [{ name: WORKFLOW_QUALITY_GATE.nome, status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/runs/1', updated_at: '2026-09-11T11:00:00Z', head_sha: 'abcdef1234567890', run_number: 42 }] });
    }
    if (u.startsWith(`${REPO}/branches?`)) {
      if (c.listaHttp && c.listaHttp !== 200) return j({}, c.listaHttp);
      const lista = c.branches ?? [{ name: 'main', sha: 'abcdef1234567890' }, { name: 'central/alpha-e2e', sha: '1111111aaaa' }, { name: 'integracao-wave03', sha: '2222222bbbb' }, { name: 'feature/outra', sha: '3333333cccc' }];
      return j(lista.map((b) => ({ name: b.name, commit: { sha: b.sha } })));
    }
    const det = /\/branches\/([^?]+)$/.exec(u);
    if (det) {
      if (c.detalheHttp && c.detalheHttp !== 200) return j({}, c.detalheHttp);
      const nome = decodeURIComponent(det[1]);
      return j(branchDetalhe(nome, `${nome.replace(/\W/g, '').padEnd(12, '0')}`, '2026-09-10T08:00:00Z'));
    }
    return j({ message: 'not found' }, 404);
  }) as unknown as typeof fetch;
  return { fetchMock, chamadas };
}

// ------------------------------------------------------------------------------------ normalizadores
describe('normalizadores derivados', () => {
  it('detalhe de branch: sha7, data do committer e primeira linha da mensagem cortada', () => {
    const r = normalizarBranchDetalhe(branchDetalhe('main', 'abcdef1234567890', '2026-09-11T10:00:00Z', 'Titulo longo\n\ncorpo'));
    expect(r).toEqual({ nome: 'main', sha7: 'abcdef1', data: '2026-09-11T10:00:00Z', mensagem: 'Titulo longo' });
    expect(normalizarBranchDetalhe({})).toBeUndefined();
    expect(normalizarBranchDetalhe(null)).toBeUndefined();
  });
  it('lista de branches: so central/* e integracao-*, ordenadas, sem payload bruto', () => {
    const r = normalizarListaBranches([{ name: 'z-central/x', commit: { sha: '1' } }, { name: 'integracao-wave03', commit: { sha: '2222222bbbb', url: 'x' } }, { name: 'central/alpha', commit: { sha: '1111111aaaa' } }, { name: 'sem-sha' }]);
    expect(r).toEqual([{ nome: 'central/alpha', sha7: '1111111' }, { nome: 'integracao-wave03', sha7: '2222222' }]);
    expect(normalizarListaBranches({ nao: 'lista' })).toEqual([]);
    expect(ehBranchDeTrabalho('central/x')).toBe(true);
    expect(ehBranchDeTrabalho('integracao-wave02')).toBe(true);
    expect(ehBranchDeTrabalho('main')).toBe(false);
  });
  it('execucao: status e conclusao so do catalogo; fora dele vira desconhecido; sem execucao vira undefined', () => {
    expect(normalizarExecucao({ workflow_runs: [] })).toBeUndefined();
    expect(normalizarExecucao(undefined)).toBeUndefined();
    const r = normalizarExecucao({ workflow_runs: [{ name: 'EIFF Quality Gate', status: 'completed', conclusion: 'failure', html_url: 'u', updated_at: 'd', head_sha: 'abcdef1234', run_number: 7 }] });
    expect(r).toEqual({ nome: 'EIFF Quality Gate', status: 'completed', conclusao: 'failure', url: 'u', quando: 'd', sha7: 'abcdef1', numero: 7 });
    expect(normalizarExecucao({ workflow_runs: [{ status: 'weird', conclusion: 'odd' }] })).toMatchObject({ status: 'desconhecido', conclusao: 'desconhecido', nome: WORKFLOW_QUALITY_GATE.nome });
    expect(normalizarExecucao({ workflow_runs: [{ status: 'in_progress', conclusion: null }] })).toMatchObject({ status: 'in_progress', conclusao: null });
  });
  it('estadoDoHttp: 401/403 nao autorizado; 404 e 5xx indisponivel', () => {
    expect(estadoDoHttp(401)).toBe('nao_autorizado');
    expect(estadoDoHttp(403)).toBe('nao_autorizado');
    expect(estadoDoHttp(404)).toBe('indisponivel');
    expect(estadoDoHttp(500)).toBe('indisponivel');
    expect(estadoDoHttp(502)).toBe('indisponivel');
  });
});

// ----------------------------------------------------------------------------------------- adapter
describe('lerStatusDesenvolvimento', () => {
  it('feliz: main, quality gate e branches de trabalho com data; so o derivado, nunca o payload nem o token', async () => {
    const { fetchMock, chamadas } = ambiente();
    const r = await lerStatusDesenvolvimento({ http: fetchMock, token: TOKEN, agora: () => AGORA, baseUrl: GH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.repositorio).toBe('augustocfmacedo/eiff-control');
    expect(r.status.main).toEqual({ sha: 'abcdef1234567890', sha7: 'abcdef1', data: '2026-09-11T10:00:00Z', mensagem: 'Wave 03: plano' });
    expect(r.status.qualityGate).toMatchObject({ nome: 'EIFF Quality Gate', status: 'completed', conclusao: 'success', url: 'https://github.com/x/runs/1', numero: 42 });
    expect(r.status.branches.map((b) => b.nome)).toEqual(['central/alpha-e2e', 'integracao-wave03']);
    expect(r.status.branches.every((b) => b.data === '2026-09-10T08:00:00Z' && b.sha7.length === 7)).toBe(true);
    expect(r.status.branchesTotal).toBe(2);
    expect(r.status.consultadoEm).toBe(AGORA);
    expect(r.status.avisos).toEqual([]);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain('workflow_runs');
    expect(texto).not.toContain('html_url');
    // toda chamada foi GET, com o token so no cabecalho e o workflow certo
    expect(chamadas.every((c) => c.metodo === 'GET' && c.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(chamadas.some((c) => c.url === `${REPO}/actions/workflows/${WORKFLOW_QUALITY_GATE.arquivo}/runs?branch=main&per_page=1`)).toBe(true);
    expect(chamadas.some((c) => c.url.endsWith('/branches/central%2Falpha-e2e'))).toBe(true);
  });
  it('sem token: nao_configurado sem nenhuma chamada', async () => {
    const { fetchMock, chamadas } = ambiente();
    for (const token of [undefined, '', '   ']) {
      const r = await lerStatusDesenvolvimento({ http: fetchMock, token, baseUrl: GH });
      expect(r).toMatchObject({ ok: false, estado: 'nao_configurado' });
    }
    expect(chamadas).toHaveLength(0);
  });
  it.each([[401, 'nao_autorizado'], [403, 'nao_autorizado'], [404, 'indisponivel'], [500, 'indisponivel'], [503, 'indisponivel']] as const)('main com HTTP %i vira estado %s, sem excecao', async (http, estado) => {
    const { fetchMock } = ambiente({ mainHttp: http });
    const r = await lerStatusDesenvolvimento({ http: fetchMock, token: TOKEN, baseUrl: GH });
    expect(r).toEqual({ ok: false, estado, detalhe: `http ${http}` });
  });
  it('timeout e falha de rede sao estados nomeados; resposta ininteligivel e indisponivel', async () => {
    expect(await lerStatusDesenvolvimento({ http: ambiente({ mainThrow: 'abort' }).fetchMock, token: TOKEN, baseUrl: GH })).toMatchObject({ ok: false, estado: 'timeout' });
    expect(await lerStatusDesenvolvimento({ http: ambiente({ mainThrow: 'rede' }).fetchMock, token: TOKEN, baseUrl: GH })).toMatchObject({ ok: false, estado: 'rede' });
    expect(await lerStatusDesenvolvimento({ http: ambiente({ mainSemJson: true }).fetchMock, token: TOKEN, baseUrl: GH })).toMatchObject({ ok: false, estado: 'indisponivel', detalhe: 'resposta ininteligivel' });
  });
  it('timeout real: fetch que nunca responde e abortado pelo AbortController dentro do prazo', async () => {
    const lento = ((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); })) as unknown as typeof fetch;
    const r = await lerStatusDesenvolvimento({ http: lento, token: TOKEN, baseUrl: GH, timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, estado: 'timeout' });
  });
  it('quality gate ou lista de branches falhando nao derruba o status: vira aviso nomeado', async () => {
    const { fetchMock } = ambiente({ execHttp: 403, listaHttp: 500 });
    const r = await lerStatusDesenvolvimento({ http: fetchMock, token: TOKEN, baseUrl: GH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.qualityGate).toBeUndefined();
    expect(r.status.branches).toEqual([]);
    expect(r.status.avisos).toEqual(['quality_gate: nao_autorizado', 'branches: indisponivel']);
  });
  it('detalhe de branch falhando mantem a branch com sha da lista e sem data', async () => {
    const { fetchMock } = ambiente({ detalheHttp: 500 });
    const r = await lerStatusDesenvolvimento({ http: fetchMock, token: TOKEN, baseUrl: GH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.branches).toEqual([{ nome: 'central/alpha-e2e', sha7: '1111111', data: undefined }, { nome: 'integracao-wave03', sha7: '2222222', data: undefined }]);
    expect(r.status.avisos).toEqual(['branches_detalhe: 2 sem data']);
  });
  it('limita o detalhe a MAX_BRANCHES_DETALHE mas informa o total', async () => {
    const muitas = Array.from({ length: MAX_BRANCHES_DETALHE + 5 }, (_, i) => ({ name: `central/f${String(i).padStart(2, '0')}`, sha: `${i}`.padEnd(10, 'a') }));
    const { fetchMock, chamadas } = ambiente({ branches: muitas });
    const r = await lerStatusDesenvolvimento({ http: fetchMock, token: TOKEN, baseUrl: GH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.branches).toHaveLength(MAX_BRANCHES_DETALHE);
    expect(r.status.branchesTotal).toBe(MAX_BRANCHES_DETALHE + 5);
    // main + runs + lista + detalhes
    expect(chamadas).toHaveLength(3 + MAX_BRANCHES_DETALHE);
  });
});

// ----------------------------------------------------------------------------------------- handler
const deps = (fetchMock: typeof fetch, extra: Partial<DepsDevelopmentStatus> = {}): DepsDevelopmentStatus => ({ http: fetchMock, supabaseUrl: SB, anon: 'anon-publica', tokenGithub: TOKEN, agora: () => AGORA, githubBaseUrl: GH, ...extra });
const GET = (authorization: string | null = 'Bearer jwt') => ({ metodo: 'GET', authorization });

describe('tratarDevelopmentStatus (handler puro de /api/development-status)', () => {
  it('so GET', async () => {
    const { fetchMock, chamadas } = ambiente();
    for (const metodo of ['POST', 'PUT', 'DELETE']) expect(await tratarDevelopmentStatus({ metodo, authorization: 'Bearer jwt' }, deps(fetchMock))).toEqual({ status: 405, corpo: { erro: 'metodo' } });
    expect(chamadas).toHaveLength(0);
  });
  it('sem JWT ou JWT invalido: 401 antes de qualquer leitura no GitHub', async () => {
    const a = ambiente();
    expect(await tratarDevelopmentStatus(GET(null), deps(a.fetchMock))).toEqual({ status: 401, corpo: { erro: 'nao_autenticado' } });
    expect(a.chamadas).toHaveLength(0);
    const b = ambiente({ autenticado: false });
    expect(await tratarDevelopmentStatus(GET(), deps(b.fetchMock))).toEqual({ status: 401, corpo: { erro: 'nao_autenticado' } });
    expect(b.chamadas.some((c) => c.url.startsWith(GH))).toBe(false);
  });
  it('sem anon no ambiente usa a do cliente (e publica); sem nenhuma, 401', async () => {
    const a = ambiente();
    expect((await tratarDevelopmentStatus({ ...GET(), anonDoCliente: 'anon-do-navegador' }, deps(a.fetchMock, { anon: undefined }))).status).toBe(200);
    expect(a.chamadas[0].headers.apikey).toBe('anon-do-navegador');
    expect((await tratarDevelopmentStatus(GET(), deps(ambiente().fetchMock, { anon: '' }))).status).toBe(401);
  });
  it('sem perfil no banco: 403; perfil sem organizacao: 403', async () => {
    expect(await tratarDevelopmentStatus(GET(), deps(ambiente({ perfil: null }).fetchMock))).toEqual({ status: 403, corpo: { erro: 'sem_perfil' } });
    expect(await tratarDevelopmentStatus(GET(), deps(ambiente({ perfil: { role: 'Administrador' } }).fetchMock))).toEqual({ status: 403, corpo: { erro: 'sem_perfil' } });
  });
  it('ver_mission_control e conferida pelo papel do PERFIL: so Administrador e Diretoria passam; o cliente nao manda papel', async () => {
    for (const papel of PAPEIS) {
      const a = ambiente({ perfil: { role: papel, organization_id: 'org-1' } });
      const r = await tratarDevelopmentStatus(GET(), deps(a.fetchMock));
      const permitido = (PAPEIS_MISSION_CONTROL as readonly string[]).includes(papel);
      expect(r.status, papel).toBe(permitido ? 200 : 403);
      if (!permitido) { expect(r.corpo).toEqual({ erro: 'sem_permissao' }); expect(a.chamadas.some((c) => c.url.startsWith(GH))).toBe(false); }
    }
  });
  it('PAPEIS_MISSION_CONTROL espelha a MATRIZ do store (pode(usuario, "ver_mission_control"))', () => {
    for (const papel of PAPEIS) {
      const u: Usuario = { id: 'x', nome: 'x', email: 'x@x', papel, obras: '*', ativo: true };
      expect(pode(u, 'ver_mission_control'), papel).toBe((PAPEIS_MISSION_CONTROL as readonly string[]).includes(papel));
    }
  });
  it('sem GITHUB_READ_TOKEN: 200 SNAPSHOT nao_configurado, sem tocar o GitHub', async () => {
    const a = ambiente();
    const r = await tratarDevelopmentStatus(GET(), deps(a.fetchMock, { tokenGithub: undefined }));
    expect(r).toEqual({ status: 200, corpo: { modo: 'SNAPSHOT', geradoEm: AGORA, motivo: 'nao_configurado' } });
    expect(a.chamadas.some((c) => c.url.startsWith(GH))).toBe(false);
  });
  it('fonte falhando: 200 SNAPSHOT com o estado nomeado (nunca 5xx para o usuario)', async () => {
    const r = await tratarDevelopmentStatus(GET(), deps(ambiente({ mainHttp: 401 }).fetchMock));
    expect(r).toEqual({ status: 200, corpo: { modo: 'SNAPSHOT', geradoEm: AGORA, motivo: 'nao_autorizado', detalhe: 'http 401' } });
    const t = await tratarDevelopmentStatus(GET(), deps(ambiente({ mainThrow: 'abort' }).fetchMock));
    expect(t.corpo).toMatchObject({ modo: 'SNAPSHOT', motivo: 'timeout' });
  });
  it('feliz: 200 LIVE com geradoEm e status derivado; token, jwt e anon nunca aparecem na resposta nem no log', async () => {
    const logs: Record<string, unknown>[] = [];
    const r = await tratarDevelopmentStatus(GET('Bearer jwt-SECRETO'), deps(ambiente().fetchMock, { log: (t) => logs.push(t) }));
    expect(r.status).toBe(200);
    const corpo = r.corpo as RespostaDevelopmentStatus;
    expect(corpo.modo).toBe('LIVE');
    if (corpo.modo !== 'LIVE') return;
    expect(corpo.geradoEm).toBe(AGORA);
    expect(corpo.status.main.sha7).toBe('abcdef1');
    const texto = JSON.stringify(r) + JSON.stringify(logs);
    for (const segredo of [TOKEN, 'jwt-SECRETO', 'anon-publica', 'org-1']) expect(texto).not.toContain(segredo);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ evento: 'development_status', http_status: 200, modo: 'LIVE', quality_gate: 'success', branches: 2 });
    expect(Object.keys(corpo).sort()).toEqual(['geradoEm', 'modo', 'status']);
  });
  it('catalogo de estados da fonte e fechado', () => {
    expect([...ESTADOS_FONTE]).toEqual(['nao_configurado', 'nao_autorizado', 'indisponivel', 'rede', 'timeout']);
    expect(VARIAVEL_TOKEN_GITHUB).toBe('GITHUB_READ_TOKEN');
  });
});

// --------------------------------------------------------------------------- varredura de codigo-fonte
describe('fronteiras no codigo-fonte', () => {
  const adapter = fs.readFileSync(path.join(RAIZ, 'src/core/central/githubAdapter.ts'), 'utf8');
  const funcao = fs.readFileSync(path.join(RAIZ, 'netlify/functions/development-status.ts'), 'utf8');
  it('o adapter nunca escreve: nenhum metodo de mutacao HTTP', () => {
    expect(adapter).not.toMatch(/method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/);
    expect(adapter).not.toMatch(/['"`](POST|PUT|PATCH|DELETE)['"`]/);
  });
  it('token so no servidor: nenhum VITE_ e nenhum console.log com token na funcao nem no adapter', () => {
    for (const [nome, texto] of [['development-status.ts', funcao], ['githubAdapter.ts', adapter]] as const) {
      expect(texto, nome).not.toContain('VITE_');
      const logsComToken = texto.split('\n').filter((l) => /console\.(log|info|warn|error)/.test(l) && /token/i.test(l));
      expect(logsComToken, nome).toEqual([]);
    }
    // a funcao Netlify nao faz rede por conta propria: so o handler puro
    expect(funcao).not.toMatch(/await\s+fetch\(/);
    expect(funcao).toContain('tratarDevelopmentStatus');
    expect(funcao).toContain("path: '/api/development-status'");
    expect(funcao).toContain("'cache-control': 'no-store'");
    expect(funcao).toContain('GITHUB_READ_TOKEN');
  });
  it('o navegador nunca ve o token: nenhum arquivo de src/ le GITHUB_READ_TOKEN fora do adapter (e sempre via deps)', () => {
    const arquivos: string[] = [];
    const varrer = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) varrer(p); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) arquivos.push(p); } };
    varrer(path.join(RAIZ, 'src'));
    for (const a of arquivos) {
      const t = fs.readFileSync(a, 'utf8');
      if (/process\.env\.GITHUB_READ_TOKEN|GITHUB_READ_TOKEN\s*\]/.test(t)) expect.fail(`${a} le o token do ambiente; so a funcao Netlify pode`);
    }
  });
});

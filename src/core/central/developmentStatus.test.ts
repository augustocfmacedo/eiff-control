// MC-LIVE-1 — a primeira fonte viva do Mission Control so vale se ela nao puder mentir nem vazar.
//
// O que estes testes impedem, em ordem de gravidade:
//   1. segredo no navegador (token no bundle, no codigo do front, ou o front falando com o GitHub);
//   2. endpoint aberto (sem JWT, sem perfil, sem permissao) ou virando proxy do GitHub;
//   3. falha da fonte virando dado ("nenhum item" como se fosse verdade);
//   4. inferencia: CI/estado/evento deduzidos de coisa que a fonte nao disse;
//   5. N+1 no GitHub;
//   6. perda do estado cru atras do normalizado.
//
// Nenhuma chamada real: `fetch` e sintetico, o token e fake e a suite roda sem GITHUB_READ_TOKEN.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHAMADAS_POR_CICLO, REPOSITORIOS_OBSERVADOS, classificarRespostaGitHub, ehRepositorioObservado,
  estadoDaLabel, extrairTaskId, lerGitHub, semCache, situacaoDoCi, type CacheCondicional, type EntradaCache,
} from './githubAdapter';
import { avaliarStatusVivo, compararBuild, humanizarIdade, LIMITE_STALE_GITHUB_S, ORIGEM_SHA_BUILD } from './statusVivo';
import { autenticarStatus, laneDasLabels, projetarWorkItems, tratarDevelopmentStatus, type DepsStatus, type DevelopmentStatusResposta } from './statusServidor';
import { lerStatusRemoto, proximoIntervalo, INTERVALO_STATUS_MS, INTERVALO_MAXIMO_MS } from '../../data/statusRemoto';
import {
  CAMINHOS, CHECKS_VERMELHO, ISSUES_FACTORY, ROTAS_SAUDAVEIS, SHA_MAIN_CONTROL, criarFetchGitHub, type Rotas,
} from './__fixtures__/github';

const AGORA = '2026-09-22T09:10:00.000Z';
const TOKEN_FAKE = 'token-de-teste-sem-valor';

// ------------------------------------------------------------------------------ deps sinteticas

const SUPA = 'https://exemplo.supabase.co';

interface OpcoesDeps { rotas?: Rotas; token?: string; perfil?: { role?: string; active?: boolean } | null; autenticado?: boolean; cache?: CacheCondicional; shaBuild?: string | null }

function deps(o: OpcoesDeps = {}): DepsStatus & { chamadasGitHub: () => number } {
  const gh = criarFetchGitHub(o.rotas ?? ROTAS_SAUDAVEIS);
  const f = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.startsWith(`${SUPA}/auth/v1/user`)) {
      return o.autenticado === false
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ id: 'u-1', email: 'a@eiff.com.br' }), { status: 200 });
    }
    if (u.startsWith(`${SUPA}/rest/v1/profile`)) {
      if (o.perfil === null) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify([{ name: 'Augusto', role: o.perfil?.role ?? 'Administrador', active: o.perfil?.active ?? true }]), { status: 200 });
    }
    return gh(url, init);
  }) as typeof fetch;
  return {
    fetch: f, supabaseUrl: SUPA, anon: 'anon-fake', agora: () => AGORA,
    githubToken: o.token === undefined ? TOKEN_FAKE : o.token,
    cache: o.cache ?? semCache,
    build: { sha: o.shaBuild === undefined ? SHA_MAIN_CONTROL : o.shaBuild, origem: o.shaBuild === null ? null : ORIGEM_SHA_BUILD },
    chamadasGitHub: () => gh.chamadas.length,
  };
}

const req = (authorization: string | null = 'Bearer jwt-fake', method = 'GET') => ({ method, authorization });
const corpo = (r: { corpo: unknown }) => r.corpo as DevelopmentStatusResposta;

// ------------------------------------------------------------------------------- 1. segredos

describe('segredo nunca chega ao navegador', () => {
  const arquivos = (dir: string, ext: RegExp): string[] => {
    const saida: string[] = [];
    const andar = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') andar(p); continue; }
        if (ext.test(e.name)) saida.push(p);
      }
    };
    andar(dir);
    return saida;
  };

  it('GITHUB_READ_TOKEN só existe na função Netlify — nunca em src/', () => {
    const comToken = arquivos('src', /\.(ts|tsx)$/).filter((f) => fs.readFileSync(f, 'utf8').includes('GITHUB_READ_TOKEN'));
    // o teste pode citar o nome; o codigo de producao do front, nao
    expect(comToken.filter((f) => !f.endsWith('developmentStatus.test.ts'))).toEqual([]);
    expect(fs.readFileSync('netlify/functions/development-status.ts', 'utf8')).toContain('GITHUB_READ_TOKEN');
  });

  it('não existe variável VITE_ para GitHub em lugar nenhum', () => {
    const alvos = [...arquivos('src', /\.(ts|tsx)$/), ...arquivos('netlify', /\.ts$/)]
      .filter((f) => !f.endsWith('developmentStatus.test.ts')); // o próprio teste cita o nome proibido
    for (const f of alvos) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/VITE_GITHUB/);
  });

  it('o navegador não fala com api.github.com: só o servidor conhece o GitHub', () => {
    // o que importa é USO (URL em literal de string), não menção em comentário
    const usoDaApi = /["'`]https?:\/\/api\.github\.com/;
    const front = arquivos('src', /\.(ts|tsx)$/).filter((f) => !f.includes('githubAdapter') && !f.endsWith('.test.ts') && !f.includes('__fixtures__'));
    for (const f of front) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(usoDaApi);
    // e o unico modulo que cita a API do GitHub e o adapter server-side
    expect(fs.readFileSync('src/core/central/githubAdapter.ts', 'utf8')).toContain('https://api.github.com');
    expect(fs.readFileSync('src/data/statusRemoto.ts', 'utf8')).toContain('/api/development-status');
  });

  it('o bundle publicado não carrega o token nem a URL do GitHub (quando dist existe)', () => {
    if (!fs.existsSync('dist/assets')) return; // sem build nesta execucao: o teste acima ja cobre o codigo
    for (const f of arquivos('dist/assets', /\.js$/)) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t, f).not.toContain('GITHUB_READ_TOKEN');
      expect(t, f).not.toContain('api.github.com');
    }
  });
});

// --------------------------------------------------------------------------- 2. auth e authz

describe('autenticação e autorização', () => {
  it('sem JWT → 401, e o GitHub nem é consultado', async () => {
    const d = deps();
    const r = await tratarDevelopmentStatus(req(null), d);
    expect(r.status).toBe(401);
    expect(d.chamadasGitHub()).toBe(0);
  });

  it('JWT inválido → 401', async () => {
    const r = await tratarDevelopmentStatus(req(), deps({ autenticado: false }));
    expect(r.status).toBe(401);
  });

  it('sem perfil no banco → 403 (o papel nunca vem do navegador)', async () => {
    const r = await tratarDevelopmentStatus(req(), deps({ perfil: null }));
    expect(r.status).toBe(403);
    expect((r.corpo as { erro: string }).erro).toBe('sem_perfil');
  });

  it('papel sem ver_mission_control → 403, e o GitHub não é consultado', async () => {
    for (const role of ['Financeiro', 'Auditoria', 'Gestor de obra', 'Engenharia']) {
      const d = deps({ perfil: { role } });
      const r = await tratarDevelopmentStatus(req(), d);
      expect(r.status, role).toBe(403);
      expect(d.chamadasGitHub(), role).toBe(0);
    }
  });

  it('perfil inativo não passa, mesmo com papel certo', async () => {
    const r = await tratarDevelopmentStatus(req(), deps({ perfil: { role: 'Administrador', active: false } }));
    expect(r.status).toBe(403);
  });

  it('Administrador e Diretoria passam', async () => {
    for (const role of ['Administrador', 'Diretoria']) {
      const r = await tratarDevelopmentStatus(req(), deps({ perfil: { role } }));
      expect(r.status, role).toBe(200);
    }
  });

  it('método diferente de GET é recusado antes de qualquer coisa', async () => {
    const d = deps();
    expect((await tratarDevelopmentStatus(req('Bearer x', 'POST'), d)).status).toBe(405);
    expect(d.chamadasGitHub()).toBe(0);
  });

  it('autenticar devolve o usuário do banco, nunca o que o cliente disser', async () => {
    const s = await autenticarStatus(req(), deps());
    expect('usuario' in s && s.usuario.papel).toBe('Administrador');
  });
});

// --------------------------------------------------------------------------- 3. allowlist

describe('allowlist de repositórios', () => {
  it('só os dois repositórios da EIFF são observados', () => {
    expect(REPOSITORIOS_OBSERVADOS.map((r) => r.repository)).toEqual(['augustocfmacedo/eiff-control', 'augustocfmacedo/eiff-dev-factory']);
    expect(ehRepositorioObservado('augustocfmacedo/eiff-control')).toBe(true);
    expect(ehRepositorioObservado('outra-org/qualquer-coisa')).toBe(false);
  });

  it('o endpoint não aceita repositório do cliente: não existe parâmetro para isso', () => {
    const servidor = fs.readFileSync('src/core/central/statusServidor.ts', 'utf8');
    const funcao = fs.readFileSync('netlify/functions/development-status.ts', 'utf8');
    for (const t of [servidor, funcao]) {
      expect(t).not.toMatch(/searchParams|req\.query|\?repo=/);
    }
    // a requisicao aceita SOMENTE metodo e authorization
    expect(servidor).toMatch(/export interface RequisicaoStatus \{\s*method: string;\s*authorization: string \| null;\s*\}/);
  });

  it('as chamadas feitas são só para os repositórios da allowlist', async () => {
    const urls: string[] = [];
    const gh = criarFetchGitHub(ROTAS_SAUDAVEIS, (u) => urls.push(u));
    await lerGitHub({ fetch: gh as unknown as typeof fetch, token: TOKEN_FAKE, agora: () => AGORA });
    for (const u of urls) {
      expect(REPOSITORIOS_OBSERVADOS.some((r) => u.includes(r.repository)), u).toBe(true);
    }
  });
});

// ------------------------------------------------------------------- 4. leitura e normalização

describe('GitHub saudável', () => {
  it('lê main, CI, PRs e issues dos dois repositórios', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps()));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    const factory = r.repositorios.find((x) => x.papel === 'fabrica')!;

    expect(control.disponivel).toBe(true);
    expect(control.main?.sha).toBe(SHA_MAIN_CONTROL);
    expect(control.main?.shaCurto).toBe(SHA_MAIN_CONTROL.slice(0, 7));
    expect(control.main?.commitadoEm).toBe('2026-09-22T09:00:00Z');
    expect(control.ci).toEqual(expect.objectContaining({ situacao: 'VERDE', statusOrigem: 'completed:success' }));
    expect(control.pullRequests).toHaveLength(2);
    expect(control.issues).toHaveLength(0); // so a fabrica tem issues de job

    expect(factory.ci?.situacao).toBe('RODANDO');
    expect(factory.ci?.statusOrigem).toBe('in_progress');
    expect(factory.issues).toHaveLength(3); // o PR devolvido pela API de issues foi descartado
  });

  it('no máximo 7 chamadas por ciclo: nenhuma chamada por cartão', async () => {
    const d = deps();
    const r = corpo(await tratarDevelopmentStatus(req(), d));
    expect(MAX_CHAMADAS_POR_CICLO).toBe(7);
    expect(d.chamadasGitHub()).toBeLessThanOrEqual(MAX_CHAMADAS_POR_CICLO);
    expect(r.fontes.github.chamadas).toBe(d.chamadasGitHub());
    // 5 cartoes (3 issues + 2 PRs) e ainda assim 7 chamadas: N+1 nao existe aqui
    expect(r.workItems.length).toBeGreaterThanOrEqual(4);
  });

  it('normaliza issue preservando o estado cru e sem inventar responsável', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps()));
    const ci = r.workItems.find((i) => i.sourceId === 'augustocfmacedo/eiff-dev-factory#41')!;
    expect(ci.status).toBe('EM_VALIDACAO');
    expect(ci.statusOrigem).toBe('CI_RUNNING');       // o fato bruto continua visivel
    expect(ci.correlationId).toBe('EC-0142');          // identidade canonica, nao id gerado
    expect(ci.procedencia).toBe('GITHUB_PROJECTION');  // projecao, nao estado operacional da fabrica
    expect(ci.updatedAt).toBe('2026-09-22T08:31:00Z'); // data da FONTE, nunca "agora"
    expect(ci.medidas).toBeUndefined();                // sem turno, lease, custo: nao existem nesta fonte

    const humano = r.workItems.find((i) => i.sourceId === 'augustocfmacedo/eiff-dev-factory#43')!;
    expect(humano.status).toBe('AGUARDANDO_HUMANO');
    expect(humano.responsavel?.tipo).toBe('HUMAN');
  });

  it('normaliza PR como código em conferência, sem inferir CI por PR', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps()));
    const pr = r.workItems.find((i) => i.links?.pullRequest?.endsWith('/pull/23'))!;
    expect(pr.status).toBe('EM_VALIDACAO');
    expect(pr.statusOrigem).toBe('pr:draft');
    expect(pr.links?.branch).toBe('ajuste/manual');
    expect(pr.correlationId).toBe('augustocfmacedo/eiff-control#23'); // sem taskId, a identidade e o endereco
  });

  it('a cadeia issue ↔ PR com o mesmo taskId vira UM cartão só', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps()));
    const daCadeia = r.workItems.filter((i) => i.correlationId === 'EC-0142');
    expect(daCadeia).toHaveLength(1);
    expect(daCadeia[0].source).toBe('FACTORY');                     // a issue manda
    expect(daCadeia[0].links?.pullRequest).toContain('/pull/22');   // o PR enriquece
    expect(daCadeia[0].links?.branch).toBe('factory/EC-0142-a1');
  });

  it('a Factory é declarada como projeção do GitHub, nunca como estado operacional', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps()));
    expect(r.factory.procedencia).toBe('GITHUB_PROJECTION');
    expect(r.factory.aviso).toMatch(/Não é o estado operacional da Factory/);
    expect(r.factory.contagens.EM_VALIDACAO).toBe(1);
    expect(r.factory.contagens.EXECUTANDO).toBe(1);
    expect(r.factory.contagens.AGUARDANDO_HUMANO).toBe(1);
    // o aviso CITA esses campos para dizer que não existem nesta fonte; o DADO nunca os traz
    expect(JSON.stringify({ repositorios: r.repositorios, workItems: r.workItems })).not.toMatch(/heartbeat|lastTool|leaseExpires|costUsd/i);
  });
});

describe('normalização de CI e labels', () => {
  it('sem check run não é verde nem vermelho: é SEM_CI', () => {
    expect(situacaoDoCi([])).toEqual({ situacao: 'SEM_CI', statusOrigem: 'sem_check_run' });
  });
  it('qualquer run não concluído deixa o CI rodando', () => {
    expect(situacaoDoCi([{ status: 'completed', conclusion: 'success' }, { status: 'queued', conclusion: null }]).situacao).toBe('RODANDO');
  });
  it('falha manda, e o estado cru diz qual foi', () => {
    expect(situacaoDoCi([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }])).toEqual({ situacao: 'VERMELHO', statusOrigem: 'completed:failure' });
  });
  it('conclusão desconhecida vira INDEFINIDO, não verde', () => {
    expect(situacaoDoCi([{ status: 'completed', conclusion: 'action_required' }]).situacao).toBe('INDEFINIDO');
  });
  it('label desconhecida não vira estado de job', () => {
    expect(estadoDaLabel(['factory:state:INVENTADO', 'factory:task'])).toBeNull();
    expect(estadoDaLabel(['factory:state:CODING'])).toBe('CODING');
    expect(laneDasLabels(['factory:risk:RED'])).toBe('RED');
    expect(laneDasLabels(['factory:task'])).toBeNull();
  });
  it('taskId sai do formato canônico da fábrica, nunca de palpite', () => {
    expect(extrairTaskId('[EC-0142] Exportar CSV')).toBe('EC-0142');
    expect(extrairTaskId('factory/DF-0418-a2')).toBe('DF-0418');
    expect(extrairTaskId('Ajuste sem identificador')).toBeNull();
    expect(extrairTaskId(null)).toBeNull();
  });
});

// ----------------------------------------------------------------------------- 5. falhas

describe('falha da fonte nunca vira dado', () => {
  const soControlFalhando = (status: number, headers?: Record<string, string>): Rotas => ({
    ...ROTAS_SAUDAVEIS,
    [`${CAMINHOS.CONTROL}/commits/main`]: { status, corpo: { message: 'erro' }, headers },
  });

  it('401 → AUTH_FAILURE', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas: soControlFalhando(401) })));
    expect(r.repositorios.find((x) => x.papel === 'produto')).toEqual(expect.objectContaining({ disponivel: false, erroCodigo: 'AUTH_FAILURE' }));
  });

  it('403 sem limite zerado → PERMISSION_FAILURE; 403 com limite zerado → RATE_LIMIT', () => {
    expect(classificarRespostaGitHub(403, '12')).toBe('PERMISSION_FAILURE');
    expect(classificarRespostaGitHub(403, '0')).toBe('RATE_LIMIT');
    expect(classificarRespostaGitHub(429, null)).toBe('RATE_LIMIT');
    expect(classificarRespostaGitHub(404, null)).toBe('NOT_FOUND');
    expect(classificarRespostaGitHub(500, null)).toBe('SOURCE_UNAVAILABLE');
    expect(classificarRespostaGitHub(401, null)).toBe('AUTH_FAILURE');
  });

  it('rate limit não apaga o que já se sabia: vira fonte indisponível, não lista vazia', async () => {
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas: soControlFalhando(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000' }) })));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    expect(control.disponivel).toBe(false);
    expect(control.erroCodigo).toBe('RATE_LIMIT');
    expect(control.main).toBeNull();
    expect(control.pullRequests).toEqual([]); // vazio COM disponivel=false: a UI sabe que e ausencia de leitura
  });

  it('erro de rede vira NETWORK_FAILURE sem vazar detalhe', async () => {
    const f = (async () => { throw new Error('ECONNRESET em algum host interno'); }) as unknown as typeof fetch;
    const leitura = await lerGitHub({ fetch: f, token: TOKEN_FAKE, agora: () => AGORA });
    expect(leitura.repositorios.every((r) => r.erroCodigo === 'NETWORK_FAILURE')).toBe(true);
    expect(JSON.stringify(leitura)).not.toContain('ECONNRESET');
  });

  it('payload que não é JSON vira INVALID_PAYLOAD', async () => {
    const f = (async () => new Response('<html>não sou json</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const leitura = await lerGitHub({ fetch: f, token: TOKEN_FAKE, agora: () => AGORA });
    expect(leitura.repositorios[0].erroCodigo).toBe('INVALID_PAYLOAD');
  });

  it('resposta PARCIAL: um repositório fora do ar não derruba o outro', async () => {
    const rotas: Rotas = { ...ROTAS_SAUDAVEIS, [`${CAMINHOS.FACTORY}/commits/main`]: { status: 500, corpo: {} } };
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    expect(r.repositorios.find((x) => x.papel === 'produto')!.disponivel).toBe(true);
    expect(r.repositorios.find((x) => x.papel === 'fabrica')!.disponivel).toBe(false);
    expect(r.fontes.github.disponivel).toBe(true); // a fonte segue utilizavel
    expect(r.workItems.some((i) => i.links?.repository === 'augustocfmacedo/eiff-control')).toBe(true);
  });

  it('sem token: NOT_CONFIGURED, zero chamada ao GitHub e nenhum dado inventado', async () => {
    const d = deps({ token: '' });
    const r = corpo(await tratarDevelopmentStatus(req(), d));
    expect(d.chamadasGitHub()).toBe(0);
    expect(r.fontes.github.disponivel).toBe(false);
    expect(r.fontes.github.erroCodigo).toBe('NOT_CONFIGURED');
    expect(r.workItems).toEqual([]);
    expect(r.repositorios.every((x) => x.erroCodigo === 'NOT_CONFIGURED' && x.main === null)).toBe(true);
  });
});

// ------------------------------------------------------------------------------ 6. cache/ETag

describe('requisição condicional (otimização oportunista)', () => {
  it('304 reaproveita o corpo guardado; sem corpo guardado não manda If-None-Match', async () => {
    const memoria = new Map<string, EntradaCache>();
    const cache: CacheCondicional = { ler: (k) => memoria.get(k), gravar: (k, v) => void memoria.set(k, v) };

    const primeira = deps({ cache });
    const a = corpo(await tratarDevelopmentStatus(req(), primeira));
    expect(a.repositorios[0].main?.sha).toBe(SHA_MAIN_CONTROL);

    // segunda rodada: o GitHub responde 304 e o corpo tem de vir do cache
    const rotas: Rotas = { ...ROTAS_SAUDAVEIS, [`${CAMINHOS.CONTROL}/commits/main`]: { status: 304, headers: { etag: 'W/"c1"' } } };
    const b = corpo(await tratarDevelopmentStatus(req(), deps({ rotas, cache })));
    expect(b.repositorios[0].main?.sha).toBe(SHA_MAIN_CONTROL);
    expect(b.repositorios[0].disponivel).toBe(true);
  });

  it('304 sem nada guardado não finge sucesso', async () => {
    const rotas: Rotas = { ...ROTAS_SAUDAVEIS, [`${CAMINHOS.CONTROL}/commits/main`]: { status: 304 } };
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    expect(r.repositorios[0].disponivel).toBe(false);
  });
});

// ------------------------------------------------------------------- 7. LIVE / SNAPSHOT / STALE

describe('LIVE × SNAPSHOT × STALE × UNAVAILABLE', () => {
  const base = { disponivel: true, observadoEm: AGORA, agora: AGORA, limiteStaleSegundos: LIMITE_STALE_GITHUB_S };

  it('build igual ao main observado → LIVE', () => {
    const v = avaliarStatusVivo({ ...base, build: { sha: SHA_MAIN_CONTROL, origem: ORIGEM_SHA_BUILD }, shaMainObservado: SHA_MAIN_CONTROL });
    expect(v.situacao).toBe('LIVE');
    expect(v.comparacaoBuild.comparacao).toBe('ATUALIZADO');
  });

  it('build atrás do main observado → SNAPSHOT, com os dois SHAs no texto', () => {
    const v = avaliarStatusVivo({ ...base, build: { sha: 'aaaaaaa1111', origem: ORIGEM_SHA_BUILD }, shaMainObservado: SHA_MAIN_CONTROL });
    expect(v.situacao).toBe('SNAPSHOT');
    expect(v.detalhe).toContain('aaaaaaa');
    expect(v.detalhe).toContain(SHA_MAIN_CONTROL.slice(0, 7));
  });

  it('sem SHA de build a lacuna é declarada — e nunca vira acusação de desatualizado', () => {
    const v = avaliarStatusVivo({ ...base, build: { sha: null, origem: null }, shaMainObservado: SHA_MAIN_CONTROL });
    expect(v.comparacaoBuild.comparacao).toBe('DESCONHECIDO');
    expect(v.comparacaoBuild.texto).toContain(ORIGEM_SHA_BUILD);
    expect(v.situacao).toBe('LIVE');
  });

  it('leitura velha → STALE; fonte fora do ar → UNAVAILABLE com a causa', () => {
    expect(avaliarStatusVivo({ ...base, observadoEm: '2026-09-22T09:00:00.000Z' }).situacao).toBe('STALE');
    const u = avaliarStatusVivo({ ...base, disponivel: false, erroCodigo: 'RATE_LIMIT' });
    expect(u.situacao).toBe('UNAVAILABLE');
    expect(u.detalhe).toMatch(/Limite de chamadas/);
  });

  it('cada situação tem rótulo em texto — a cor nunca informa sozinha', () => {
    for (const s of ['LIVE', 'SNAPSHOT', 'STALE', 'UNAVAILABLE'] as const) {
      const v = avaliarStatusVivo({ ...base, disponivel: s !== 'UNAVAILABLE' });
      expect(v.rotulo.length).toBeGreaterThan(0);
      expect(v.detalhe.length).toBeGreaterThan(0);
    }
    expect(humanizarIdade(23)).toBe('23 s');
    expect(humanizarIdade(240)).toBe('4 min');
    expect(compararBuild({ sha: null, origem: null }, null).comparacao).toBe('DESCONHECIDO');
  });
});

// ------------------------------------------------------------------------------- 8. cliente

describe('cliente de polling', () => {
  it('sem sessão não chama o endpoint', async () => {
    let chamou = false;
    const f = (async () => { chamou = true; return new Response('{}'); }) as unknown as typeof fetch;
    expect(await lerStatusRemoto(null, f)).toEqual({ erro: 'SEM_SESSAO' });
    expect(chamou).toBe(false);
  });

  it('401/403 viram NAO_AUTORIZADO; erro de rede vira REDE; corpo estranho vira RESPOSTA_INVALIDA', async () => {
    const resp = (status: number, body = '{}') => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await lerStatusRemoto('t', resp(401))).toEqual({ erro: 'NAO_AUTORIZADO' });
    expect(await lerStatusRemoto('t', resp(403))).toEqual({ erro: 'NAO_AUTORIZADO' });
    expect(await lerStatusRemoto('t', resp(500))).toEqual({ erro: 'SERVIDOR' });
    expect(await lerStatusRemoto('t', resp(200, '{"nada":1}'))).toEqual({ erro: 'RESPOSTA_INVALIDA' });
    const quebra = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await lerStatusRemoto('t', quebra)).toEqual({ erro: 'REDE' });
  });

  it('resposta válida passa e leva o token no cabeçalho', async () => {
    const corpoOk = corpo(await tratarDevelopmentStatus(req(), deps()));
    let auth: string | undefined;
    const f = (async (_u: string, init?: RequestInit) => { auth = (init?.headers as Record<string, string>)?.authorization; return new Response(JSON.stringify(corpoOk)); }) as unknown as typeof fetch;
    const r = await lerStatusRemoto('token-x', f);
    expect('dados' in r).toBe(true);
    expect(auth).toBe('Bearer token-x');
  });

  it('polling é conservador e o backoff tem teto', () => {
    expect(INTERVALO_STATUS_MS).toBe(60_000);
    expect(proximoIntervalo(0)).toBe(60_000);
    expect(proximoIntervalo(1)).toBe(120_000);
    expect(proximoIntervalo(9)).toBe(INTERVALO_MAXIMO_MS);
  });

  it('o hook cancela e não sobrepõe chamadas (guardas presentes no código)', () => {
    const t = fs.readFileSync('src/data/statusRemoto.ts', 'utf8');
    expect(t).toContain('AbortController');
    expect(t).toContain('ctrl?.abort()');
    expect(t).toContain('if (cancelado || emVoo) return;');
    expect(t).toContain('clearTimeout');
    // o estado do ciclo vive DENTRO do efeito: remontar a tela não pode travar o polling
    expect(t).not.toMatch(/emVoo\s*=\s*useRef/);
  });
});

// ------------------------------------------------------------------------------ 9. projeção

describe('projeção', () => {
  it('repositório indisponível não produz item nenhum (ausência não é zero)', async () => {
    const leitura = await lerGitHub({ fetch: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch, token: TOKEN_FAKE, agora: () => AGORA });
    expect(projetarWorkItems(leitura, { observadoEm: AGORA, agora: AGORA, limiteStaleSegundos: 60 })).toEqual([]);
  });

  it('issue sem label de estado é demanda de arquitetura, não job em execução', async () => {
    const rotas: Rotas = {
      ...ROTAS_SAUDAVEIS,
      [`${CAMINHOS.FACTORY}/issues`]: { status: 200, corpo: [{ ...ISSUES_FACTORY[0], labels: [{ name: 'factory:task' }] }] },
    };
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const item = r.workItems.find((i) => i.sourceId.endsWith('#41'))!;
    expect(item.source).toBe('ARCHITECTURE');
    expect(item.status).toBe('ARQUITETURA');
    expect(item.statusOrigem).toBe('issue:open'); // o fato bruto: a issue esta aberta, so isso
  });

  it('CI vermelho aparece como vermelho, com o motivo cru', async () => {
    const rotas: Rotas = { ...ROTAS_SAUDAVEIS, [`${CAMINHOS.CONTROL}/commits/${SHA_MAIN_CONTROL}/check-runs`]: { status: 200, corpo: CHECKS_VERMELHO } };
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    expect(r.repositorios[0].ci).toEqual(expect.objectContaining({ situacao: 'VERMELHO', statusOrigem: 'completed:failure' }));
  });
});

// ------------------------------------------------------- 10. o runtime da Function nao e o navegador

describe('grafo de imports das funções Netlify', () => {
  // O Deploy Preview 5 da MC-LIVE-1 respondeu 502 com
  // "Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')": a função importava `pode` de
  // src/data/store.ts, que puxa src/data/supabase.ts, que lê `import.meta.env` no topo do módulo. No
  // runtime da Function isso é undefined e o módulo nem carrega. Nenhum teste pegava — este pega.
  // comentário que CITA o nome não é uso: a varredura olha o código, não a prosa
  const semComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const resolver = (de: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null; // pacote do npm: fora do nosso grafo
    const base = path.resolve(path.dirname(de), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  };

  const grafo = (entrada: string): string[] => {
    const vistos = new Set<string>();
    const fila = [path.resolve(entrada)];
    while (fila.length) {
      const f = fila.shift()!;
      if (vistos.has(f)) continue;
      vistos.add(f);
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const alvo = resolver(f, m[1]);
        if (alvo && !vistos.has(alvo)) fila.push(alvo);
      }
    }
    return [...vistos];
  };

  const funcoes = fs.readdirSync('netlify/functions').filter((f) => f.endsWith('.ts')).map((f) => path.join('netlify/functions', f));

  it('nenhuma função Netlify alcança um módulo que lê import.meta.env', () => {
    const culpados: string[] = [];
    for (const f of funcoes) {
      for (const m of grafo(f)) {
        if (/import\.meta\.env/.test(semComentarios(fs.readFileSync(m, 'utf8')))) culpados.push(`${path.basename(f)} → ${path.relative(process.cwd(), m)}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  it('a matriz de permissões é única e utilizável dos dois lados', () => {
    const puro = semComentarios(fs.readFileSync('src/core/permissoes.ts', 'utf8'));
    expect(puro).not.toMatch(/from 'react'/);
    expect(puro).not.toMatch(/seed\.json/);
    expect(puro).not.toMatch(/import\.meta\.env/);
    expect(puro).not.toMatch(/from '\.\.\/\.\.\/data\//);
    expect(puro).toMatch(/export function pode\(/);
    // o store REEXPORTA a mesma funcao: continua existindo uma matriz so
    const store = fs.readFileSync('src/data/store.ts', 'utf8');
    expect(store).toMatch(/from '\.\.\/core\/permissoes'/);
    expect(store).not.toMatch(/export function pode\(/);
    expect(store.match(/const MATRIZ/g) ?? []).toEqual([]);
  });

  it('o endpoint continua autorizando pela MATRIZ, não por lista própria', () => {
    const servidor = fs.readFileSync('src/core/central/statusServidor.ts', 'utf8');
    expect(servidor).toMatch(/import \{ pode \} from '\.\.\/permissoes'/);
    expect(servidor).toMatch(/pode\(usuario, 'ver_mission_control'\)/);
    expect(servidor).not.toMatch(/\['Administrador', 'Diretoria'\]/); // nada de ACL paralela
  });
});

// ------------------------------------------- 11. granularidade: uma capacidade nao derruba as outras

describe('degradação por capacidade', () => {
  // Regra do proprietário (MC-LIVE-1, smoke real): `Checks` é uma permissão à parte do PAT e pode
  // simplesmente não ter sido concedida. Perder o CI NÃO pode apagar main, PRs e issues do repositório.
  const so = (caminho: string, resposta: { status: number; corpo?: unknown; headers?: Record<string, string> }): Rotas => ({ ...ROTAS_SAUDAVEIS, [caminho]: resposta });

  it('403 no check-runs deixa o repositório LIVE e marca só o CI', async () => {
    const rotas = so(`${CAMINHOS.CONTROL}/commits/${SHA_MAIN_CONTROL}/check-runs`, { status: 403, corpo: { message: 'Resource not accessible by personal access token' } });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    expect(control.disponivel).toBe(true);                       // o repositório NÃO cai
    expect(control.main?.sha).toBe(SHA_MAIN_CONTROL);            // main continua
    expect(control.pullRequests).toHaveLength(2);                // PRs continuam
    expect(control.ci).toBeNull();
    expect(control.erroCi).toBe('CHECKS_PERMISSION_UNAVAILABLE'); // e o CI diz por que sumiu
    expect(control.erroCodigo).toBeUndefined();
  });

  it('404 no check-runs é tratado igual: a credencial não enxerga Checks', async () => {
    const rotas = so(`${CAMINHOS.CONTROL}/commits/${SHA_MAIN_CONTROL}/check-runs`, { status: 404, corpo: {} });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    expect(control.disponivel).toBe(true);
    expect(control.erroCi).toBe('CHECKS_PERMISSION_UNAVAILABLE');
  });

  it('rate limit no check-runs NÃO vira falta de permissão: o código real é preservado', async () => {
    const rotas = so(`${CAMINHOS.CONTROL}/commits/${SHA_MAIN_CONTROL}/check-runs`, { status: 403, corpo: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000' } });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    expect(r.repositorios[0].erroCi).toBe('RATE_LIMIT');
  });

  it('403 nas issues não derruba a fábrica: main, CI e PRs continuam; a lista vazia vem COM código', async () => {
    const rotas = so(`${CAMINHOS.FACTORY}/issues`, { status: 403, corpo: {} });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const fab = r.repositorios.find((x) => x.papel === 'fabrica')!;
    expect(fab.disponivel).toBe(true);
    expect(fab.main).not.toBeNull();
    expect(fab.issues).toEqual([]);
    expect(fab.erroIssues).toBe('PERMISSION_FAILURE'); // ausência de leitura, nunca "nenhuma issue"
    expect(r.factory.contagens.EXECUTANDO).toBe(0);
  });

  it('403 nos PRs não derruba o repositório', async () => {
    const rotas = so(`${CAMINHOS.CONTROL}/pulls`, { status: 403, corpo: {} });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    expect(control.disponivel).toBe(true);
    expect(control.ci?.situacao).toBe('VERDE');
    expect(control.pullRequests).toEqual([]);
    expect(control.erroPullRequests).toBe('PERMISSION_FAILURE');
  });

  it('só a falha do commit de main derruba o repositório inteiro', async () => {
    const rotas = so(`${CAMINHOS.CONTROL}/commits/main`, { status: 403, corpo: {} });
    const r = corpo(await tratarDevelopmentStatus(req(), deps({ rotas })));
    const control = r.repositorios.find((x) => x.papel === 'produto')!;
    expect(control.disponivel).toBe(false);
    expect(control.erroCodigo).toBe('PERMISSION_FAILURE');
    expect(control.main).toBeNull();
  });

  it('a tela distingue as três ausências em texto, não só por cor', () => {
    const tela = fs.readFileSync('src/screens/MissionControl.tsx', 'utf8');
    expect(tela).toContain('CI indisponível');
    expect(tela).toContain('PRs indisponíveis');
    expect(tela).toContain('issues indisponíveis');
  });
});

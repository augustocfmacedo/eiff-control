// MC-LIVE-3B — prontidão para consumir a Factory real, sem conectá-la.
//
// O que estes testes impedem, em ordem de gravidade:
//   1. Factory e GitHub da MESMA task virarem dois cartões, ou a precedência depender da ordem de um array;
//   2. estado operacional vindo do GitHub quando a Factory fala, ou artefato do GitHub sobrescrito pela Factory;
//   3. worker de outra task colando, CI agregado virando CI de task, INTEGRATED virando MERGED, humanGates virando gate;
//   4. payload fora do contrato entrando (ou Factory indisponível virando "zero jobs");
//   5. contrato da fábrica mudando sem o CI do EIFF Control perceber;
//   6. transporte, segredo, escrita ou fetch aparecendo antes da hora.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAMPOS_AUDITADOS, CAPACIDADES_CONTRATO_FACTORY, ESPELHO_CAMPOS_API, ESPELHO_CAMPOS_CI_AGREGADO, EVENTOS_DA_API_FACTORY,
  LIMITE_STALE_FACTORY_S, NIVEIS_CAPACIDADE, avaliarFonteFactory, eventosDaFactory, projetarStatusFactory,
  validarStatusFactory, workerDaTask, type FactoryReadPort, type StatusFactory,
} from './factoryAdapter';
import { ELOS_CADEIA, cadeiaDoItem, diagnosticarCorrelacao, eventosDoItem } from './correlacao';
import { moduloDaTarefa } from './construcao';
import { gatePorId } from './missionControl';
import { semCache } from './githubAdapter';
import { ORIGEM_SHA_BUILD } from './statusVivo';
import { projetarWorkItems, tratarDevelopmentStatus, type DepsStatus, type DevelopmentStatusResposta } from './statusServidor';
import {
  CONTRATO_FACTORY, consolidarWorkItems, normalizarJobFactory, precedenciaOperacional,
  type ContextoNormalizacao, type JobFactory, type MissionControlWorkItem, type WorkerFactory,
} from './workItem';
import { CAMINHOS, ROTAS_SAUDAVEIS, SHA_MAIN_CONTROL, criarFetchGitHub, type Rotas } from './__fixtures__/github';

const AGORA = '2026-09-30T12:00:00.000Z';
const ctx: ContextoNormalizacao = { observadoEm: AGORA, agora: AGORA, limiteStaleSegundos: LIMITE_STALE_FACTORY_S };
const REPO = 'augustocfmacedo/eiff-control';
const ISSUE_7 = `https://github.com/${REPO}/issues/7`;
const PR_24 = `https://github.com/${REPO}/pull/24`;
const SHA_PR_24 = '9999888877776666555544443333222211110000';

const task = (o: Partial<JobFactory> = {}): JobFactory => ({
  taskId: 'EC-0042', title: 'Rateio de faturamento por etapa', repository: REPO, state: 'CI_RUNNING', risk: 'GREEN',
  role: 'worker', attempt: 2, priority: 50, issueUrl: ISSUE_7, prUrl: `https://github.com/${REPO}/pull/99`,
  headSha: 'b'.repeat(40), updatedAt: '2026-09-30T11:00:00Z', costUsd: 1.25, ...o,
});
const worker = (o: Partial<WorkerFactory> = {}): WorkerFactory => ({
  workerId: 'w-17', taskId: 'EC-0042', attempt: 2, role: 'worker', phase: 'testing', turn: 7, maxTurns: 40,
  lastHeartbeatAt: '2026-09-30T11:59:30Z', leaseExpiresAt: '2026-09-30T12:05:00Z', startedAt: '2026-09-30T11:40:00Z',
  durationSec: 1200, costUsd: 0.9, model: 'claude-sonnet-5', lastTool: 'Edit', ...o,
});
const status = (o: Partial<StatusFactory> = {}): StatusFactory => ({
  version: 'w5-teste', generatedAt: '2026-09-30T11:59:50Z',
  factory: { state: 'RUNNING', reason: null, since: '2026-09-30T08:00:00Z', by: null, enabled: true, stage: 1 },
  workers: [worker()], queue: [task()], blockers: [], humanGates: [], throughput: [],
  cost: { anthropicTodayUsd: 1, openaiTodayUsd: 0, factoryTodayUsd: 1, factoryMonthUsd: 10, caps: { maxCostPerJob: 15, maxAnthropicDaily: 50, maxOpenaiDaily: 10, maxFactoryDaily: 60, maxFactoryMonthly: 600 }, breakersTripped: [] },
  lastActivityAt: '2026-09-30T11:59:00Z', ci: { running: 3, failed24h: 2 }, ...o,
});

/** Porta de TESTE. Nenhuma implementação real existe; a porta só devolve o corpo e conta as leituras. */
const porta = (corpo: unknown | (() => never)) => {
  const p = { leituras: 0, lerStatus: async () => { p.leituras += 1; return typeof corpo === 'function' ? (corpo as () => never)() : corpo; } };
  return p satisfies FactoryReadPort & { leituras: number };
};

// deps do endpoint: Supabase sintético + GitHub das fixtures (issue #7 com bloco EC-0042, PR #24 na factory/EC-0042-a1)
const SUPA = 'https://exemplo.supabase.co';
function deps(extra: Partial<DepsStatus> = {}, rotas: Rotas = ROTAS_SAUDAVEIS): DepsStatus {
  const gh = criarFetchGitHub(rotas);
  const f = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.startsWith(`${SUPA}/auth/v1/user`)) return new Response(JSON.stringify({ id: 'u-1', email: 'a@eiff.com.br' }), { status: 200 });
    if (u.startsWith(`${SUPA}/rest/v1/profile`)) return new Response(JSON.stringify([{ name: 'Augusto', role: 'Administrador', active: true }]), { status: 200 });
    return gh(url, init);
  }) as typeof fetch;
  return { fetch: f, supabaseUrl: SUPA, anon: 'anon-fake', agora: () => AGORA, githubToken: 'token-de-teste', cache: semCache, build: { sha: SHA_MAIN_CONTROL, origem: ORIGEM_SHA_BUILD }, ...extra };
}
const req = { method: 'GET', authorization: 'Bearer jwt-fake' };
const ler = async (d: DepsStatus) => (await tratarDevelopmentStatus(req, d)).corpo as DevelopmentStatusResposta;
const doTask = (itens: MissionControlWorkItem[], t: string) => itens.filter((i) => i.correlationId === t);
const elo = (i: MissionControlWorkItem, e: (typeof ELOS_CADEIA)[number]) => cadeiaDoItem(i).find((x) => x.elo === e)!;
const arquivo = (f: string) => fs.readFileSync(path.resolve(f), 'utf8');

// ------------------------------------------------------------------------------ os 20 obrigatórios

describe('MC-LIVE-3B — Factory + GitHub (obrigatórios)', () => {
  it('1 · Factory EC-0042 + GitHub EC-0042 = um item, em qualquer ordem de entrada', async () => {
    const r = await ler(deps({ factory: porta(status()) }));
    const c = doTask(r.workItems, 'EC-0042');
    expect(c).toHaveLength(1);
    expect(c[0].correlacaoPor).toEqual(['BLOCO_DA_ISSUE', 'BRANCH_CANONICA', 'FACTORY_API']);
    // mesma fusão com a entrada invertida: o conteúdo do cartão não depende da ordem do array
    const gh = projetarWorkItems({ observadoEm: AGORA, chamadas: 0, repositorios: r.repositorios }, ctx);
    const fac = projetarStatusFactory(status(), ctx).itens;
    const a = doTask(consolidarWorkItems([...gh, ...fac]), 'EC-0042')[0];
    const b = doTask(consolidarWorkItems([...fac, ...gh]), 'EC-0042')[0];
    const c2 = doTask(consolidarWorkItems([...fac, ...[...gh].reverse()]), 'EC-0042')[0];
    expect(a).toEqual(b);
    expect(a).toEqual(c2);
  });

  it('2 · o estado operacional vem da Factory (a label do GitHub diz CODING, a Factory diz CI_RUNNING)', async () => {
    const [c] = doTask((await ler(deps({ factory: porta(status()) }))).workItems, 'EC-0042');
    expect(c.procedencia).toBe('FACTORY_API');
    expect(c.statusOrigem).toBe('CI_RUNNING');
    expect(c.status).toBe('EM_VALIDACAO');
    expect(c.medidas).toEqual(expect.objectContaining({ tentativa: 2, custoUsd: 1.25, turno: 7, maxTurnos: 40 }));
    expect(precedenciaOperacional(c)).toBeGreaterThan(precedenciaOperacional({ source: 'FACTORY', procedencia: 'GITHUB_PROJECTION' }));
    expect(diagnosticarCorrelacao(c).operacional).toEqual(expect.objectContaining({ estado: 'CI_RUNNING', tentativa: 2 }));
  });

  it('3 · os links do GitHub continuam sendo os do GitHub (a Factory declara outro PR e outro sha)', async () => {
    const [c] = doTask((await ler(deps({ factory: porta(status()) }))).workItems, 'EC-0042');
    expect(c.links?.issue).toBe(ISSUE_7);
    expect(c.links?.pullRequest).toBe(PR_24);                 // não o pull/99 da Factory
    expect(c.links?.branch).toBe('factory/EC-0042-a1');
    expect(c.links?.commit).toBe(SHA_PR_24);                  // não o 'bbbb…' da Factory
  });

  it('4 · o worker só entra na própria task (mesmo taskId e mesma tentativa) e confirma o elo', async () => {
    const [c] = doTask((await ler(deps({ factory: porta(status()) }))).workItems, 'EC-0042');
    expect(c.worker).toEqual({ workerId: 'w-17', tentativa: 2, iniciadoEm: '2026-09-30T11:40:00Z', fase: 'testing' });
    expect(elo(c, 'WORKER')).toEqual(expect.objectContaining({ estado: 'CONFIRMADO', valor: 'w-17' }));
  });

  it('5 · worker de outra task, de outra tentativa ou ambíguo não cola', () => {
    const it0 = (ws: WorkerFactory[]) => projetarStatusFactory(status({ workers: ws }), ctx).itens.find((i) => i.correlationId === 'EC-0042')!;
    expect(it0([worker({ taskId: 'EC-0043' })]).worker).toBeUndefined();
    expect(it0([worker({ attempt: 1 })]).worker).toBeUndefined();
    expect(it0([worker(), worker({ workerId: 'w-18' })]).worker).toBeUndefined();   // dois candidatos: nenhum
    // mesmo passado à mão para a função errada, o worker de outra task é recusado
    expect(normalizarJobFactory(task(), ctx, worker({ taskId: 'EC-0043' })).worker).toBeUndefined();
    expect(workerDaTask(task(), [worker({ taskId: 'EC-0043', attempt: 2 })])).toBeUndefined();
    for (const ws of [[worker({ taskId: 'EC-0043' })], [worker({ attempt: 1 })]]) expect(elo(it0(ws), 'WORKER').estado).not.toBe('CONFIRMADO');
  });

  it('6 · headSha enriquece o commit sem inventar branch (task que o GitHub não observou)', () => {
    const [so] = projetarStatusFactory(status({ queue: [task({ taskId: 'EC-0099', prUrl: null })], workers: [] }), ctx).itens;
    expect(so.links?.commit).toBe('b'.repeat(40));
    expect(so.links?.branch).toBeUndefined();
    expect(elo(so, 'COMMIT').estado).toBe('CONFIRMADO');
    expect(elo(so, 'BRANCH').estado).toBe('NAO_DISPONIVEL');
  });

  it('7 · prUrl não cria identidade por texto: a URL igual à de um PR do GitHub não cola os cartões', async () => {
    const q = [task({ taskId: 'EC-0099', prUrl: `https://github.com/${REPO}/pull/23`, issueUrl: `https://github.com/${REPO}/issues/99` })];
    const r = await ler(deps({ factory: porta(status({ queue: q, workers: [] })) }));
    const doPr23 = r.workItems.filter((i) => i.links?.pullRequest === `https://github.com/${REPO}/pull/23`);
    expect(doPr23).toHaveLength(2);                                   // o PR humano e a task EC-0099, separados
    expect(new Set(doPr23.map((i) => i.correlationId))).toEqual(new Set([`${REPO}#23`, 'EC-0099']));
  });

  it('8 · CI agregado (ci.running/ci.failed24h) não vira CI da task, do PR nem do módulo', async () => {
    const r = await ler(deps({ factory: porta(status({ ci: { running: 9, failed24h: 7 } })) }));
    expect(r.events.some((e) => /^CI_|^TEST_/.test(e.tipo))).toBe(false);
    for (const i of r.workItems) {
      expect(elo(i, 'CI').estado, i.id).not.toBe('CONFIRMADO');
      expect(JSON.stringify(i), i.id).not.toMatch(/failed24h|"running"/);
    }
  });

  it('9 · INTEGRATED é o estado atual, não um MERGED', () => {
    const s = status({ queue: [task({ state: 'INTEGRATED' })] });
    const p = projetarStatusFactory(s, ctx);
    expect(p.itens[0].statusOrigem).toBe('INTEGRATED');
    expect(p.eventos.some((e) => e.tipo === 'MERGED')).toBe(false);
    expect(elo(p.itens[0], 'MERGE').estado).not.toBe('CONFIRMADO');
  });

  it('10 · updatedAt não vira evento histórico: a API só produz WORKER_STARTED', () => {
    const s = status({ queue: [task({ state: 'DONE', updatedAt: '2026-09-30T11:11:11Z' })] });
    const ev = eventosDaFactory(s);
    expect(ev.map((e) => e.tipo)).toEqual(['WORKER_STARTED']);
    expect(ev.map((e) => e.ocorridoEm)).not.toContain('2026-09-30T11:11:11Z');
    expect([...EVENTOS_DA_API_FACTORY]).toEqual(['WORKER_STARTED']);
    // e sem worker não há evento nenhum
    expect(eventosDaFactory(status({ workers: [] }))).toEqual([]);
  });

  it('11 · humanGates não viram gateId nem GATE_CLOSED', () => {
    const s = status({ queue: [], humanGates: [task({ state: 'AWAITING_HUMAN' })] });
    const p = projetarStatusFactory(s, ctx);
    expect(p.itens[0].status).toBe('AGUARDANDO_HUMANO');
    expect(p.itens[0].gateIds).toBeUndefined();
    expect(p.eventos.some((e) => e.tipo === 'GATE_CLOSED')).toBe(false);
    expect(elo(p.itens[0], 'GATE').estado).toBe('NAO_DISPONIVEL');
  });

  it('12 · payload inválido é recusado inteiro e degrada a fonte (GitHub intacto)', async () => {
    const ruins: unknown[] = [
      null, 'texto', [], {},
      { ...status(), version: undefined },
      status({ queue: [task({ taskId: 'ec-42' })] }),
      status({ queue: [task({ state: 'TELEPORTANDO' as never })] }),
      status({ workers: [worker({ startedAt: 'ontem' })] }),
      status({ queue: [task({ headSha: 'curto' })] }),
      status({ ci: { running: -1, failed24h: 0 } }),
    ];
    for (const x of ruins) expect(validarStatusFactory(x).ok, JSON.stringify(x)?.slice(0, 60)).toBe(false);
    const semFactory = await ler(deps());
    const r = await ler(deps({ factory: porta(status({ queue: [task({ taskId: 'ec-42' })] })) }));
    expect(r.fontes.factory).toEqual(expect.objectContaining({ situacao: 'UNAVAILABLE', erroCodigo: 'INVALID_PAYLOAD', tarefas: null }));
    expect(r.workItems).toEqual(semFactory.workItems);           // nada da Factory entrou, nada do GitHub saiu
    // os motivos trazem caminho, nunca valor
    const v = validarStatusFactory(status({ queue: [task({ taskId: 'segredo-123' })] }));
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain('segredo-123');
  });

  it('13 · drift de contrato é detectado: campo novo na resposta = CONTRACT_DRIFT, e o detector de arquivo funciona', async () => {
    const comCampoNovo = { ...status(), queue: [{ ...task(), branch: 'factory/EC-0042-a2' }] };
    const v = validarStatusFactory(comCampoNovo);
    expect(v).toEqual(expect.objectContaining({ ok: false, codigo: 'CONTRACT_DRIFT' }));
    const r = await ler(deps({ factory: porta(comCampoNovo) }));
    expect(r.fontes.factory).toEqual(expect.objectContaining({ situacao: 'UNAVAILABLE', erroCodigo: 'CONTRACT_DRIFT' }));
    // o parser de api.ts pega um campo novo num schema sintético (vale também no CI, sem clone da fábrica)
    const sintetico = `export const TaskSummarySchema = z.strictObject({\n${ESPELHO_CAMPOS_API.TaskSummarySchema.map((k) => `  ${k}: x,`).join('\n')}\n  branch: linha(200),\n});\n`;
    expect(camposDoSchema(sintetico, 'TaskSummarySchema')).not.toEqual([...ESPELHO_CAMPOS_API.TaskSummarySchema].sort());
  });

  it('14 · Factory ausente mantém o comportamento atual: sem chave nova, mesmos itens e eventos', async () => {
    const r = await ler(deps());
    expect(Object.keys(r.fontes)).toEqual(['github']);
    expect(r.workItems.every((i) => i.procedencia !== 'FACTORY_API')).toBe(true);
    expect(r.events.every((e) => e.source === 'GITHUB')).toBe(true);
    // a função Netlify de produção não injeta porta nenhuma
    const fn = arquivo('netlify/functions/development-status.ts');
    expect(fn).not.toMatch(/\bfactory\s*:/);
    expect(fn).not.toMatch(/FactoryReadPort|lerStatus/);
  });

  it('15 · Factory indisponível não vira zero: contagem da fábrica segue a da projeção, tarefas = null', async () => {
    const semFactory = await ler(deps());
    const r = await ler(deps({ factory: porta(() => { throw new Error('rede'); }) }));
    expect(r.fontes.factory).toEqual(expect.objectContaining({ situacao: 'UNAVAILABLE', erroCodigo: 'SOURCE_UNAVAILABLE', tarefas: null, workers: null, estadoFabrica: null }));
    expect(r.factory.contagens).toEqual(semFactory.factory.contagens);
    expect(r.workItems).toEqual(semFactory.workItems);
    expect(JSON.stringify(r.fontes.factory)).not.toMatch(/rede|Error/);
  });

  it('16 · nenhuma escrita na Factory: a porta só lê, uma vez por ciclo', async () => {
    const p = porta(status());
    await ler(deps({ factory: p }));
    expect(p.leituras).toBe(1);
    const src = arquivo('src/core/central/factoryAdapter.ts');
    const interfacePorta = src.slice(src.indexOf('export interface FactoryReadPort'), src.indexOf('}', src.indexOf('export interface FactoryReadPort')));
    expect(interfacePorta.match(/\w+\(/g)).toEqual(['lerStatus(']);
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)|export function (salvar|gravar|atualizar|mover|transicionar|enviar|escrever)/i);
  });

  it('17 · o adapter é puro: sem fetch, env, URL, React, Supabase ou SDK do GitHub', () => {
    const src = arquivo('src/core/central/factoryAdapter.ts');
    expect(src).not.toMatch(/\bfetch\s*\(|process\.env|import\.meta|from 'react'|supabase|@octokit|localStorage/);
    expect(src).not.toMatch(/https?:\/\/[a-z0-9]/i);                  // nenhuma URL inventada
    expect(src).not.toMatch(/\basync\b|\bawait\b/);                   // nem I/O: a leitura é da porta, no servidor
  });

  it('18 · nenhum segredo da Factory no código nem no bundle', () => {
    const nome = ['FACTORY', 'READ', 'TOKEN'].join('_');            // montado para este arquivo não conter o nome
    const varrer = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? varrer(p) : /\.(ts|tsx|mts|js|mjs)$/.test(e.name) ? [p] : [];
    });
    for (const f of [...varrer('src'), ...varrer('netlify')]) expect(fs.readFileSync(f, 'utf8'), f).not.toContain(nome);
    if (fs.existsSync('dist')) for (const f of varrer('dist')) expect(fs.readFileSync(f, 'utf8'), f).not.toContain(nome);
  });

  it('19 · continua existindo um único useStatusRemoto', () => {
    const telas = fs.readdirSync('src/screens').filter((f) => f.endsWith('.tsx')).map((f) => `src/screens/${f}`);
    expect(telas.reduce((n, f) => n + (arquivo(f).match(/useStatusRemoto\(/g)?.length ?? 0), 0)).toBe(1);
  });

  it('20 · nenhum task → módulo por heurística: título, repositório e papel da Factory não dão módulo', () => {
    const s = status({ queue: [task({ taskId: 'EC-0077', title: 'Inbox Octopus Router', repository: 'augustocfmacedo/eiff-dev-factory', role: 'integrator' })], workers: [] });
    for (const i of projetarStatusFactory(s, ctx).itens) {
      expect(moduloDaTarefa(i)).toBeUndefined();
      expect(i.workstreamId).toBeUndefined();
      expect(i.gateIds).toBeUndefined();
    }
    expect(arquivo('src/core/central/factoryAdapter.ts')).not.toMatch(/MODULOS_CONSTRUCAO|moduloDaTarefa|from '\.\/construcao'/);
  });
});

// ------------------------------------------------------------------------ drift do contrato da API

/**
 * Campos de nível superior de um `z.strictObject({...})` no texto do api.ts (indentação de 2 espaços). Aceita
 * `campo: schema,` e a forma abreviada `campo,` — o api.ts usa as duas (`taskId,` importa o schema de mesmo nome).
 */
function camposDoSchema(texto: string, nome: string): string[] {
  const ini = texto.indexOf(`export const ${nome} = z.strictObject({`);
  if (ini < 0) throw new Error(`schema ${nome} não encontrado`);
  const fim = texto.indexOf('\n});', ini);
  const bloco = texto.slice(ini, fim);
  return [...bloco.matchAll(/^ {2}(\w+)\s*[:,]/gm)].map((m) => m[1]).sort();
}

describe('drift do contrato da API da fábrica (packages/contracts/src/api.ts)', () => {
  const repo = process.env[CONTRATO_FACTORY.envRepoLocal] ?? CONTRATO_FACTORY.repoLocalPadrao;
  const arq = path.join(repo, CONTRATO_FACTORY.api);
  const disponivel = fs.existsSync(arq);

  it('os campos espelhados batem com os schemas da fábrica', () => {
    // sem clone (CI do eiff-control): vale a conferência local; com o caminho INFORMADO, o arquivo tem de existir
    if (process.env[CONTRATO_FACTORY.envRepoLocal]) expect(disponivel, arq).toBe(true);
    if (!disponivel) { expect(ESPELHO_CAMPOS_API.TaskSummarySchema).toHaveLength(13); return; }
    const texto = fs.readFileSync(arq, 'utf8');
    for (const [nome, campos] of Object.entries(ESPELHO_CAMPOS_API)) {
      expect(camposDoSchema(texto, nome), nome).toEqual([...campos].sort());
    }
    const ci = /\bci: z\.strictObject\(\{([^}]*)\}\)/.exec(texto);
    expect(ci, 'ci agregado').not.toBeNull();
    expect([...ci![1].matchAll(/(\w+):/g)].map((m) => m[1]).sort()).toEqual([...ESPELHO_CAMPOS_CI_AGREGADO].sort());
  });
});

// -------------------------------------------------------------------------------- capacidades e fonte

describe('MC-LIVE-3B — matriz de capacidades, eventos e degradação', () => {
  it('a matriz cobre os nove elos, só cita campos que existem e não inventa capacidade', () => {
    const existentes = new Set<string>([
      ...ESPELHO_CAMPOS_API.TaskSummarySchema.map((c) => `TaskSummary.${c}`),
      ...ESPELHO_CAMPOS_API.WorkerStatusSchema.map((c) => `WorkerStatus.${c}`),
    ]);
    expect(Object.keys(CAPACIDADES_CONTRATO_FACTORY).sort()).toEqual([...ELOS_CADEIA].sort());
    for (const [elo, c] of Object.entries(CAPACIDADES_CONTRATO_FACTORY)) {
      expect(NIVEIS_CAPACIDADE, elo).toContain(c.nivel);
      for (const campo of c.campos) expect(existentes.has(campo), `${elo}: ${campo}`).toBe(true);
      expect(c.nivel === 'AUSENTE_DO_CONTRATO' ? c.campos.length === 0 : c.campos.length > 0, elo).toBe(true);
    }
    for (const e of ['BRANCH', 'CI', 'MERGE', 'GATE'] as const) expect(CAPACIDADES_CONTRATO_FACTORY[e].nivel).toBe('AUSENTE_DO_CONTRATO');
    expect(CAPACIDADES_CONTRATO_FACTORY.WORKER.nivel).toBe('PARCIAL');
    expect(CAMPOS_AUDITADOS.map((c) => c.campo)).toEqual(expect.arrayContaining([
      'TaskSummary.issueUrl', 'TaskSummary.taskId', 'WorkerStatus.taskId', 'WorkerStatus.workerId', 'WorkerStatus.startedAt',
      'TaskSummary.headSha', 'TaskSummary.prUrl', 'TaskSummary.state', 'FactoryStatusResponse.humanGates',
      'FactoryStatusResponse.ci.running', 'FactoryStatusResponse.ci.failed24h',
    ]));
  });

  it('WORKER_STARTED só com taskId canônico + workerId + startedAt, e cai no cartão da própria task', async () => {
    const [e] = eventosDaFactory(status());
    expect(e).toEqual(expect.objectContaining({ tipo: 'WORKER_STARTED', correlationId: 'EC-0042', ocorridoEm: '2026-09-30T11:40:00Z', tipoOrigem: 'worker.startedAt' }));
    expect(e.ator).toEqual(expect.objectContaining({ tipo: 'WORKER', id: 'w-17' }));
    const r = await ler(deps({ factory: porta(status()) }));
    const [c] = doTask(r.workItems, 'EC-0042');
    expect(eventosDoItem(c, r.events).map((x) => x.tipo)).toEqual(['TASK_CREATED', 'PR_OPENED', 'WORKER_STARTED']);
    // um cartão de OUTRA task não recebe o evento
    const outro = r.workItems.find((i) => i.correlationId === 'EC-0142')!;
    expect(eventosDoItem(outro, r.events).some((x) => x.tipo === 'WORKER_STARTED')).toBe(false);
  });

  it('degradação: NOT_CONFIGURED sem porta, STALE com generatedAt velho, LIVE só com leitura boa e fresca', () => {
    expect(avaliarFonteFactory(null, AGORA)).toEqual(expect.objectContaining({ situacao: 'NOT_CONFIGURED', tarefas: null }));
    const velha = { ok: true as const, observadoEm: AGORA, status: status({ generatedAt: '2026-09-30T11:00:00Z' }) };
    expect(avaliarFonteFactory(velha, AGORA).situacao).toBe('STALE');
    const fresca = { ok: true as const, observadoEm: AGORA, status: status() };
    expect(avaliarFonteFactory(fresca, AGORA)).toEqual(expect.objectContaining({ situacao: 'LIVE', tarefas: 1, workers: 1, estadoFabrica: 'RUNNING' }));
  });

  it('em produção a Factory nunca aparece LIVE nesta rodada: nenhuma porta é injetada', async () => {
    expect(arquivo('netlify/functions/development-status.ts')).not.toMatch(/factory/i);
    expect((await ler(deps())).fontes.factory).toBeUndefined();
  });

  it('ordem de saída: a consolidação não reordena, só funde (primeira aparição de cada grupo)', () => {
    const gh = projetarWorkItems({ observadoEm: AGORA, chamadas: 0, repositorios: [] }, ctx);
    const fac = projetarStatusFactory(status({ queue: [task({ taskId: 'EC-0003' }), task({ taskId: 'EC-0001' }), task({ taskId: 'EC-0002' })], workers: [] }), ctx).itens;
    const ordemEntrada = fac.map((i) => i.correlationId);
    expect(consolidarWorkItems([...gh, ...fac]).map((i) => i.correlationId)).toEqual(ordemEntrada);
  });

  it('o gate FACTORY_ADAPTER_READONLY e o WORK_ITEM_CORRELACAO continuam ABERTOS', () => {
    expect(gatePorId('FACTORY_ADAPTER_READONLY')?.situacao).toBe('aberto');
    expect(gatePorId('WORK_ITEM_CORRELACAO')?.situacao).toBe('aberto');
    expect(gatePorId('FACTORY_ADAPTER_READONLY')?.evidencias?.some((e) => e.referencia === 'src/core/central/factoryAdapter.ts' && /transporte real/.test(e.nota ?? ''))).toBe(true);
  });

  it('a mesma task em mais de uma lista vira um cartão só, escolhido pelos dados e não pela posição', () => {
    const a = task({ state: 'BLOCKED', updatedAt: '2026-09-30T11:30:00Z' });
    const b = task({ state: 'CI_RUNNING', updatedAt: '2026-09-30T11:00:00Z' });
    const x = projetarStatusFactory(status({ queue: [b], blockers: [a], workers: [] }), ctx).itens;
    const y = projetarStatusFactory(status({ queue: [a], blockers: [b], workers: [] }), ctx).itens;
    expect(x).toHaveLength(1);
    expect(x[0].statusOrigem).toBe('BLOCKED');
    expect(x).toEqual(y);
  });

  it('Factory lida mantém a leitura do GitHub com a mesma quantidade de chamadas (nenhuma chamada por cartão)', async () => {
    let chamadasGitHub = 0;
    const gh = criarFetchGitHub(ROTAS_SAUDAVEIS, () => { chamadasGitHub += 1; });
    await ler({ ...deps({ factory: porta(status()) }), fetch: (async (u: string | URL | Request, i?: RequestInit) => {
      const s = String(u);
      if (s.startsWith(`${SUPA}/auth/v1/user`)) return new Response(JSON.stringify({ id: 'u-1' }), { status: 200 });
      if (s.startsWith(`${SUPA}/rest/v1/profile`)) return new Response(JSON.stringify([{ role: 'Administrador', active: true }]), { status: 200 });
      return gh(u, i);
    }) as typeof fetch });
    expect(chamadasGitHub).toBe(8);
    expect(CAMINHOS.CONTROL).toBe(`/repos/${REPO}`);
  });
});

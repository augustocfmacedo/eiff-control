// MC-LIVE-3 — correlação e eventos confirmados. A cadeia só vale se ela não puder colar o que a fonte não liga,
// e o evento só vale se tiver fato e data da própria fonte.
//
// Estes testes impedem, em ordem de gravidade:
//   1. correlação por título, texto livre, branch fora do padrão ou nome de módulo;
//   2. evento fabricado: `updated_at` virando transição, CI do main virando CI da tarefa, worker/teste/merge
//      deduzidos sem evento específico da fonte;
//   3. duas tarefas no mesmo cartão, ou a mesma tarefa em dois;
//   4. chamada por cartão, escrita em qualquer fonte, segundo polling.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVENTOS_DA_PROJECAO_GITHUB, ELOS_CADEIA, ELOS_LIDOS_POR_PROCEDENCIA, ROTULO_ESTADO_ELO, ROTULO_TIPO_EVENTO,
  cadeiaDoItem, chaveDeCorrelacao, dataHoraEvento, diagnosticarCorrelacao, eventosDaIssue, eventosDoItem,
  eventosDoPullRequest, projetarEventos,
} from './correlacao';
import { moduloDaTarefa } from './construcao';
import {
  MAX_CHAMADAS_POR_CICLO, lerGitHub, semCache,
  type IssueObservada, type LeituraGitHub, type PullRequestObservado, type RepositorioStatus,
} from './githubAdapter';
import { gatePorId } from './missionControl';
import { projetarWorkItems } from './statusServidor';
import {
  MC_TIPOS_EVENTO, consolidarEventos, normalizarJobFactory, normalizarPullRequest,
  type ContextoNormalizacao, type MissionControlWorkItem,
} from './workItem';
import { ciDoItem } from './quadroOperacional';
import { CAMINHOS, ROTAS_SAUDAVEIS, blocoFactoryTask, criarFetchGitHub } from './__fixtures__/github';

const AGORA = '2026-09-30T12:00:00.000Z';
const ctx: ContextoNormalizacao = { observadoEm: AGORA, agora: AGORA, limiteStaleSegundos: 120 };
const REPO = 'augustocfmacedo/eiff-control';
const FABRICA = 'augustocfmacedo/eiff-dev-factory';

const issue = (o: Partial<IssueObservada> = {}): IssueObservada => ({
  numero: 7, titulo: '[factory] Rateio de faturamento por etapa', estadoFactory: 'CODING', taskId: 'EC-0042',
  labelsFactory: ['factory:task', 'factory:state:CODING'], estadoGitHub: 'open',
  criadoEm: '2026-09-22T05:00:00Z', atualizadoEm: '2026-09-22T08:00:00Z',
  url: `https://github.com/${REPO}/issues/7`, ...o,
});
const pr = (o: Partial<PullRequestObservado> = {}): PullRequestObservado => ({
  numero: 24, titulo: 'Rateio de faturamento por etapa', branch: 'factory/EC-0042-a1',
  headSha: '9999888877776666555544443333222211110000', rascunho: false,
  criadoEm: '2026-09-22T06:00:00Z', atualizadoEm: '2026-09-22T09:30:00Z',
  url: `https://github.com/${REPO}/pull/24`, taskId: 'EC-0042', ...o,
});
const repo = (issues: IssueObservada[], pullRequests: PullRequestObservado[], o: Partial<RepositorioStatus> = {}): RepositorioStatus => ({
  repository: REPO, papel: 'produto', ramoPrincipal: 'main', observadoEm: AGORA, disponivel: true,
  main: { sha: 'a'.repeat(40), shaCurto: 'aaaaaaa', commitadoEm: '2026-09-22T09:00:00Z' },
  ci: { situacao: 'VERDE', statusOrigem: 'completed:success', nome: 'Quality Gate', concluidoEm: '2026-09-22T09:05:00Z' },
  pullRequests, issues, chamadas: 4, ...o,
});
const leitura = (...repositorios: RepositorioStatus[]): LeituraGitHub => ({ observadoEm: AGORA, repositorios, chamadas: 8 });

const projetar = (l: LeituraGitHub) => ({ itens: projetarWorkItems(l, ctx), eventos: projetarEventos(l) });
const doTask = (itens: MissionControlWorkItem[], t: string) => itens.filter((i) => i.correlationId === t);
const elo = (i: MissionControlWorkItem, e: (typeof ELOS_CADEIA)[number]) => cadeiaDoItem(i).find((x) => x.elo === e)!;

const ler = (f: string) => fs.readFileSync(path.resolve(f), 'utf8');

// ------------------------------------------------------------------------------ os 15 obrigatórios

describe('MC-LIVE-3 — correlação e eventos (obrigatórios)', () => {
  it('1 · issue + PR da mesma tarefa viram UM item, com a identidade vinda do bloco E da branch', () => {
    const { itens, eventos } = projetar(leitura(repo([issue()], [pr()])));
    const c = doTask(itens, 'EC-0042');
    expect(c).toHaveLength(1);
    expect(c[0].source).toBe('FACTORY');
    expect(c[0].correlacaoPor).toEqual(['BLOCO_DA_ISSUE', 'BRANCH_CANONICA']);
    const d = diagnosticarCorrelacao(c[0], eventos);
    expect(d.chave).toBe('TASK_ID');
    for (const e of ['ISSUE', 'TASK_ID', 'BRANCH', 'COMMIT', 'PR'] as const) expect(elo(c[0], e).estado, e).toBe('CONFIRMADO');
    expect(d.eventos.map((e) => e.tipo)).toEqual(['TASK_CREATED', 'PR_OPENED']); // os dois objetos, um cartão
  });

  it('2 · o taskId vence o título: [EC-0099] no título da issue e do PR não cria nem cola EC-0099', () => {
    const { itens, eventos } = projetar(leitura(repo(
      [issue({ titulo: '[EC-0099] Rateio' })],
      [pr({ titulo: '[EC-0099] Rateio' })],
    )));
    expect(itens.some((i) => i.correlationId === 'EC-0099')).toBe(false);
    expect(doTask(itens, 'EC-0042')).toHaveLength(1);
    expect(eventos.some((e) => e.correlationId === 'EC-0099')).toBe(false);
  });

  it('3 · duas tarefas nunca consolidam, nem com o mesmo título; cada PR cola só na sua', () => {
    const { itens } = projetar(leitura(repo(
      [issue(), issue({ numero: 8, taskId: 'EC-0043', url: `https://github.com/${REPO}/issues/8` })],
      [pr({ numero: 25, branch: 'factory/EC-0043-a2', url: `https://github.com/${REPO}/pull/25` })],
    )));
    expect(doTask(itens, 'EC-0042')).toHaveLength(1);
    expect(doTask(itens, 'EC-0043')).toHaveLength(1);
    expect(doTask(itens, 'EC-0042')[0].links?.pullRequest).toBeUndefined();
    expect(doTask(itens, 'EC-0043')[0].links?.pullRequest).toContain('/pull/25');
  });

  it('4 · a branch canônica correlaciona o PR — a normalização confere sozinha, sem depender do taskId da entrada', () => {
    const it0 = normalizarPullRequest({
      repositorio: REPO, numero: 30, titulo: 'Sem id no título', branch: 'factory/EC-0042-a3', headSha: 'f'.repeat(40),
      rascunho: false, taskId: null, criadoEm: '2026-09-22T06:00:00Z', atualizadoEm: '2026-09-22T06:00:00Z',
      url: `https://github.com/${REPO}/pull/30`,
    }, ctx);
    expect(it0.correlationId).toBe('EC-0042');
    expect(it0.correlacaoPor).toEqual(['BRANCH_CANONICA']);
    expect(chaveDeCorrelacao(it0)).toBe('TASK_ID');
  });

  it('5 · PR sem identidade segura não cola: título, branch fora do padrão e taskId injetado na entrada não bastam', () => {
    for (const branch of ['feature/EC-0042-a1', 'factory/EC-0042', 'factory/EC-0042-a0', 'EC-0042', 'ajuste/EC-0042']) {
      const i0 = normalizarPullRequest({
        repositorio: REPO, numero: 31, titulo: '[EC-0042] Rateio', branch, headSha: 'e'.repeat(40), rascunho: false,
        taskId: 'EC-0042', criadoEm: '2026-09-22T06:00:00Z', atualizadoEm: '2026-09-22T06:00:00Z',
        url: `https://github.com/${REPO}/pull/31`,
      }, ctx);
      expect(i0.correlationId, branch).toBe(`${REPO}#31`);
      expect(i0.correlacaoPor, branch).toBeUndefined();
      expect(chaveDeCorrelacao(i0), branch).toBe('SEM_CORRELACAO');
    }
    const { itens } = projetar(leitura(repo([issue()], [pr({ titulo: '[EC-0042] Rateio', branch: 'feature/EC-0042-a1', taskId: null })])));
    const daTask = doTask(itens, 'EC-0042');
    expect(daTask).toHaveLength(1);
    expect(daTask[0].links?.pullRequest).toBeUndefined();       // a issue NÃO ganhou o PR
    expect(itens.find((i) => i.sourceId === `${REPO}#24`)!.correlationId).toBe(`${REPO}#24`);
  });

  it('6 · updatedAt nunca vira evento: nenhuma data de atualização aparece como ocorrência', () => {
    const iss = issue({ atualizadoEm: '2026-09-29T23:59:00Z' });
    const p = pr({ atualizadoEm: '2026-09-29T23:58:00Z' });
    const eventos = projetarEventos(leitura(repo([iss], [p])));
    const datas = eventos.map((e) => e.ocorridoEm);
    expect(datas).not.toContain(iss.atualizadoEm);
    expect(datas).not.toContain(p.atualizadoEm);
    // e nenhum evento de "progresso" é fabricado a partir da atualização
    expect(eventos.some((e) => e.tipo === 'TASK_PROGRESS')).toBe(false);
    expect(eventos.every((e) => !/updated/.test(e.tipoOrigem))).toBe(true);
  });

  it('7 · TASK_CREATED usa o timestamp de criação da issue, e só com bloco canônico', () => {
    const [e] = eventosDaIssue(REPO, issue());
    expect(e.tipo).toBe('TASK_CREATED');
    expect(e.ocorridoEm).toBe('2026-09-22T05:00:00Z');
    expect(e.tipoOrigem).toBe('issue.created_at');
    expect(e.correlationId).toBe('EC-0042');
    // sem bloco a issue é demanda registrada, não tarefa criada
    const [d] = eventosDaIssue(REPO, issue({ taskId: null }));
    expect(d.tipo).toBe('WORK_ITEM_CREATED');
    // data inválida não vira "agora": não há evento
    expect(eventosDaIssue(REPO, issue({ criadoEm: 'ontem' }))).toEqual([]);
  });

  it('8 · PR_OPENED usa o timestamp de abertura do PR', () => {
    const [e] = eventosDoPullRequest(REPO, pr());
    expect(e.tipo).toBe('PR_OPENED');
    expect(e.ocorridoEm).toBe('2026-09-22T06:00:00Z');
    expect(e.tipoOrigem).toBe('pull_request.created_at');
    expect(e.correlationId).toBe('EC-0042');
    expect(e.ator.tipo).toBe('GITHUB');   // quem abriu não é lido: nunca vira humano inventado
  });

  it('9 · eventos duplicados viram um só (mesma ocorrência lida duas vezes, ou em duas coletas)', () => {
    const l = leitura(repo([issue(), issue()], [pr(), pr()]));
    const uma = projetarEventos(l);
    expect(uma).toHaveLength(2);
    const duasColetas = consolidarEventos([...uma, ...projetarEventos(leitura(repo([issue()], [pr()])))]);
    expect(duasColetas).toHaveLength(2);
    expect(new Set(duasColetas.map((e) => e.id)).size).toBe(2);
  });

  it('10 · evento sem correlação segura fica SEM correlationId e só se liga ao próprio objeto', () => {
    const humano = pr({ numero: 23, branch: 'ajuste/manual', titulo: '[EC-0042] Ajuste', url: `https://github.com/${REPO}/pull/23` });
    const demanda = issue({ numero: 9, taskId: null, url: `https://github.com/${REPO}/issues/9` });
    const { itens, eventos } = projetar(leitura(repo([issue(), demanda], [pr(), humano])));
    const doHumano = eventos.find((e) => e.sourceId === `${REPO}#23`)!;
    const daDemanda = eventos.find((e) => e.sourceId === `${REPO}#9`)!;
    expect('correlationId' in doHumano).toBe(false);
    expect('correlationId' in daDemanda).toBe(false);
    // o cartão da tarefa EC-0042 não recebe o evento do PR humano, mesmo com EC-0042 no título dele
    const task = doTask(itens, 'EC-0042')[0];
    expect(eventosDoItem(task, eventos).map((e) => e.sourceId)).not.toContain(`${REPO}#23`);
    // e o cartão do PR humano só recebe o próprio evento
    const cartaoHumano = itens.find((i) => i.sourceId === `${REPO}#23`)!;
    expect(eventosDoItem(cartaoHumano, eventos).map((e) => e.id)).toEqual([doHumano.id]);
  });

  it('11 · CI do main não é CI da tarefa: nenhum evento de CI, elo CI "não disponível nesta fonte"', () => {
    const vermelho = repo([issue()], [pr()], { ci: { situacao: 'VERMELHO', statusOrigem: 'completed:failure', concluidoEm: '2026-09-22T09:05:00Z' } });
    for (const l of [leitura(repo([issue()], [pr()])), leitura(vermelho)]) {
      const { itens, eventos } = projetar(l);
      expect(eventos.some((e) => /^CI_|^TEST_/.test(e.tipo))).toBe(false);
      expect(eventos.some((e) => e.ocorridoEm === '2026-09-22T09:05:00Z')).toBe(false);
      const task = doTask(itens, 'EC-0042')[0];
      expect(elo(task, 'CI').estado).toBe('NAO_DISPONIVEL');
      expect(ciDoItem(task)).toBeUndefined();
    }
  });

  it('12 · módulo sem heurística: título, branch e texto com nome de módulo não ligam a tarefa a módulo nem gate', () => {
    const { itens } = projetar(leitura(repo(
      [issue({ titulo: 'Inbox — Octopus Router', taskId: 'EC-0077', url: `https://github.com/${REPO}/issues/11`, numero: 11 })],
      [pr({ numero: 40, titulo: 'Inbox Octopus Router', branch: 'feature/inbox-octopus-router', url: `https://github.com/${REPO}/pull/40` })],
    )));
    for (const i of itens) {
      expect(moduloDaTarefa(i), i.sourceId).toBeUndefined();
      expect(i.gateIds, i.sourceId).toBeUndefined();
      expect(elo(i, 'GATE').estado).toBe('NAO_DISPONIVEL');
    }
    expect(doTask(itens, 'EC-0077')[0].links?.pullRequest).toBeUndefined();
    // o módulo de correlação não conhece módulos nem o mapa: não tem de onde tirar heurística
    const src = ler('src/core/central/correlacao.ts');
    expect(src).not.toMatch(/from '\.\/(construcao|mapaVivo|mapaExecutivo)'/);
    expect(src).not.toMatch(/MODULOS_CONSTRUCAO|moduloDaTarefa|\.title\b|\.titulo\b/);
  });

  it('13 · nenhum fetch por cartão: 50 issues e 20 PRs custam o mesmo teto do ciclo, e o diagnóstico não chama nada', async () => {
    const issues = Array.from({ length: 50 }, (_, k) => ({
      number: 100 + k, title: `[factory] Job ${k}`, state: 'open',
      body: blocoFactoryTask({ taskId: `EC-${String(1000 + k)}`, repository: REPO }),
      created_at: '2026-09-22T05:00:00Z', updated_at: '2026-09-22T08:00:00Z', closed_at: null,
      html_url: `https://github.com/${REPO}/issues/${100 + k}`, labels: [{ name: 'factory:task' }, { name: 'factory:state:CODING' }],
    }));
    const pulls = Array.from({ length: 20 }, (_, k) => ({
      number: 300 + k, title: `Job ${k}`, draft: false, created_at: '2026-09-22T06:00:00Z', updated_at: '2026-09-22T09:00:00Z',
      html_url: `https://github.com/${REPO}/pull/${300 + k}`, head: { ref: `factory/EC-${1000 + k}-a1`, sha: 'c'.repeat(40) },
    }));
    const f = criarFetchGitHub({
      ...ROTAS_SAUDAVEIS,
      [`${CAMINHOS.CONTROL}/issues`]: { status: 200, corpo: issues },
      [`${CAMINHOS.CONTROL}/pulls`]: { status: 200, corpo: pulls },
    });
    const l = await lerGitHub({ fetch: f as typeof fetch, token: 'token-fake', agora: () => AGORA, cache: semCache });
    const { itens, eventos } = projetar(l);
    for (const i of itens) diagnosticarCorrelacao(i, eventos);
    expect(f.chamadas.length).toBe(MAX_CHAMADAS_POR_CICLO);
    expect(itens.filter((i) => i.correlacaoPor?.includes('BRANCH_CANONICA'))).toHaveLength(20);
    expect(eventos.filter((e) => e.tipo === 'PR_OPENED')).toHaveLength(20);
  });

  it('14 · read-only: correlação e tela não escrevem, não buscam e não mudam a leitura recebida', () => {
    for (const f of ['src/core/central/correlacao.ts', 'src/screens/MissionControlQuadro.tsx']) {
      const src = ler(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(|from '[^']*supabase|actions\.|useStatusRemoto\(|setInterval|localStorage|method:\s*['"](POST|PATCH|PUT|DELETE)/i);
      expect(src, f).not.toMatch(/onDrag|draggable/);
    }
    const congelar = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.values(o).forEach(congelar); Object.freeze(o); } return o; };
    const l = congelar(leitura(repo([issue()], [pr()])));
    const antes = JSON.stringify(l);
    const { itens, eventos } = projetar(l);
    for (const i of itens) diagnosticarCorrelacao(congelar(i), congelar(eventos));
    expect(JSON.stringify(l)).toBe(antes);
  });

  it('15 · continua existindo um único useStatusRemoto', () => {
    const telas = fs.readdirSync('src/screens').filter((f) => f.endsWith('.tsx')).map((f) => `src/screens/${f}`);
    const total = telas.reduce((n, f) => n + (ler(f).match(/useStatusRemoto\(/g)?.length ?? 0), 0);
    expect(total).toBe(1);
    expect(ler('src/screens/MissionControl.tsx').match(/useStatusRemoto\(/g)?.length).toBe(1);
  });
});

// ------------------------------------------------------------------------------------- além dos 15

describe('MC-LIVE-3 — cadeia, eventos e gate', () => {
  it('a projeção do GitHub só emite os quatro tipos sustentados por data da fonte', () => {
    const { eventos } = projetar(leitura(repo([issue(), issue({ numero: 9, taskId: null })], [pr()])));
    for (const e of eventos) expect(EVENTOS_DA_PROJECAO_GITHUB, e.tipo).toContain(e.tipo);
    for (const proibido of ['WORKER_STARTED', 'TEST_PASSED', 'CI_STARTED', 'CI_PASSED', 'MERGED', 'GATE_CLOSED'] as const) {
      expect(EVENTOS_DA_PROJECAO_GITHUB).not.toContain(proibido);
    }
  });

  it('WORK_ITEM_COMPLETED exige label DONE + issue fechada + closed_at; label INTEGRATED não é merge', () => {
    const fechada = issue({ estadoFactory: 'DONE', estadoGitHub: 'closed', fechadaEm: '2026-09-25T10:00:00Z' });
    expect(eventosDaIssue(REPO, fechada).map((e) => [e.tipo, e.ocorridoEm])).toContainEqual(['WORK_ITEM_COMPLETED', '2026-09-25T10:00:00Z']);
    // DONE aberta, fechada sem DONE (pode ser "not planned") ou sem data: nada de conclusão
    expect(eventosDaIssue(REPO, issue({ estadoFactory: 'DONE' })).some((e) => e.tipo === 'WORK_ITEM_COMPLETED')).toBe(false);
    expect(eventosDaIssue(REPO, issue({ estadoGitHub: 'closed', fechadaEm: '2026-09-25T10:00:00Z' })).some((e) => e.tipo === 'WORK_ITEM_COMPLETED')).toBe(false);
    expect(eventosDaIssue(REPO, issue({ estadoFactory: 'DONE', estadoGitHub: 'closed' })).some((e) => e.tipo === 'WORK_ITEM_COMPLETED')).toBe(false);
    const integrada = issue({ estadoFactory: 'INTEGRATED' });
    expect(eventosDaIssue(REPO, integrada).some((e) => e.tipo === 'MERGED')).toBe(false);
    const [it0] = projetarWorkItems(leitura(repo([integrada], [])), ctx);
    expect(elo(it0, 'MERGE').estado).toBe('NAO_DISPONIVEL');
  });

  it('cada ausência é nomeada: ainda não observado × não informado × não disponível nesta fonte', () => {
    // tarefa sem PR ainda: branch/commit/PR podem aparecer
    const [soIssue] = projetarWorkItems(leitura(repo([issue()], [])), ctx);
    expect(elo(soIssue, 'PR').estado).toBe('NAO_OBSERVADO');
    expect(elo(soIssue, 'BRANCH').estado).toBe('NAO_OBSERVADO');
    expect(elo(soIssue, 'WORKER').estado).toBe('NAO_DISPONIVEL');
    // PR da tarefa com a issue fora da leitura (fechada ou em outro lugar)
    const [soPr] = projetarWorkItems(leitura(repo([], [pr()])), ctx);
    expect(elo(soPr, 'ISSUE').estado).toBe('NAO_OBSERVADO');
    // PR sem identidade: não há como ligar a issue
    const [humano] = projetarWorkItems(leitura(repo([], [pr({ branch: 'ajuste/manual' })])), ctx);
    expect(elo(humano, 'ISSUE').estado).toBe('NAO_INFORMADO');
    expect(elo(humano, 'TASK_ID').estado).toBe('NAO_INFORMADO');
    expect(elo(humano, 'BRANCH').estado).toBe('CONFIRMADO');   // a branch dele é fato, só não é de tarefa
    for (const e of ['NAO_INFORMADO', 'NAO_DISPONIVEL', 'NAO_OBSERVADO'] as const) expect(ROTULO_ESTADO_ELO[e]).toBeTruthy();
  });

  it('o worker só é confirmado com o estado operacional da Factory (WorkerStatus), nunca pela projeção', () => {
    const job = {
      taskId: 'EC-0042', title: 'x', repository: REPO, state: 'CODING' as const, risk: 'GREEN' as const, role: 'worker' as const,
      attempt: 1, priority: 50, issueUrl: `https://github.com/${REPO}/issues/7`, prUrl: null, headSha: null, updatedAt: AGORA, costUsd: 0,
    };
    const semWorker = normalizarJobFactory(job, ctx);
    expect(elo(semWorker, 'WORKER').estado).toBe('NAO_OBSERVADO');
    const comWorker = normalizarJobFactory(job, ctx, {
      workerId: 'w-7', taskId: 'EC-0042', attempt: 1, role: 'worker', phase: 'coding', turn: 3, maxTurns: 40,
      lastHeartbeatAt: AGORA, leaseExpiresAt: AGORA, startedAt: AGORA, durationSec: 60, costUsd: 0.1, model: 'm', lastTool: 't',
    });
    expect(elo(comWorker, 'WORKER')).toEqual(expect.objectContaining({ estado: 'CONFIRMADO', valor: 'w-7' }));
    expect(elo(comWorker, 'BRANCH').estado).toBe('NAO_DISPONIVEL'); // a API não traz branch e ela não é deduzida
    expect(ELOS_LIDOS_POR_PROCEDENCIA.GITHUB_PROJECTION.WORKER).toBe(false);
  });

  it('issue e PR em repositórios diferentes com o mesmo taskId canônico continuam um cartão', () => {
    const naFabrica = issue({ numero: 41, taskId: 'EC-0142', url: `https://github.com/${FABRICA}/issues/41` });
    const { itens } = projetar(leitura(
      repo([naFabrica], [], { repository: FABRICA, papel: 'fabrica' }),
      repo([], [pr({ numero: 22, branch: 'factory/EC-0142-a1', url: `https://github.com/${REPO}/pull/22` })]),
    ));
    expect(doTask(itens, 'EC-0142')).toHaveLength(1);
  });

  it('repositório indisponível não produz evento (ausência não é fato)', () => {
    expect(projetarEventos(leitura(repo([issue()], [pr()], { disponivel: false })))).toEqual([]);
  });

  it('o gate WORK_ITEM_CORRELACAO continua aberto: depende de FACTORY_ADAPTER_READONLY, que segue aberto', () => {
    expect(gatePorId('WORK_ITEM_CORRELACAO')?.situacao).not.toBe('fechado');
    expect(gatePorId('FACTORY_ADAPTER_READONLY')?.situacao).not.toBe('fechado');
    expect(gatePorId('WORK_ITEM_CORRELACAO')?.dependeDe).toContain('FACTORY_ADAPTER_READONLY');
  });

  it('rótulos totais e data no fuso da EIFF, sem "agora" para data ruim', () => {
    for (const t of MC_TIPOS_EVENTO) expect(ROTULO_TIPO_EVENTO[t], t).toBeTruthy();
    expect(dataHoraEvento('2026-09-22T05:00:00Z')).toBe('22/09/2026, 02:00');
    expect(dataHoraEvento('ontem')).toBe('—');
  });

  it('a resposta do endpoint leva os eventos sem corpo de issue nem comentário', async () => {
    const f = criarFetchGitHub(ROTAS_SAUDAVEIS);
    const l = await lerGitHub({ fetch: f as typeof fetch, token: 'token-fake', agora: () => AGORA, cache: semCache });
    const txt = JSON.stringify(projetarEventos(l));
    expect(txt).not.toContain('factory-task:v1');
    expect(txt).not.toContain('baseSha');
    expect(txt).not.toMatch(/authorization|token-fake|api\.github\.com/i);
    expect(ler('src/core/central/statusServidor.ts')).toMatch(/events: projetarEventos\(leitura\)/);
  });
});

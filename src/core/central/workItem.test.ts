// Mission Control Live — a fronteira de normalizacao so vale se ela NAO puder mentir.
//
// Estes testes existem para impedir, em ordem de gravidade:
//   1. o Mission Control virar autoridade de estado (ele observa; nao escreve, nao decide, nao reordena);
//   2. estado inventado quando a fonte cai (indisponibilidade tem de aparecer como indisponibilidade);
//   3. a mesma entidade virar dois cartoes;
//   4. correlacao por id gerado em vez de identidade canonica;
//   5. o estado cru sumir atras da abstracao ("Em validacao" sem o "CI_RUNNING" ao lado);
//   6. divergencia silenciosa entre o espelho e o contrato da fabrica;
//   7. bloqueio POR DESENHO ser lido como falha.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATES, gatePorId } from './missionControl';
import {
  ARESTAS, NOS, ciclosDoMapa, dependenciasDe, gatesDesconhecidosNoMapa, noPorId, TIPOS_ARESTA,
} from './mapaVivo';
import {
  ATOR_POR_ESTADO_FACTORY, CONTRATO_FACTORY, COR_MC_SINAL, ESPELHO_ACTORS, ESPELHO_COMMENT_KINDS,
  ESPELHO_FACTORY_STATES, ESPELHO_JOB_STATES, ESPELHO_LANES, ESPELHO_WORKER_ROLES, MC_ATORES, MC_FONTES,
  MC_SINAIS, MC_STATUS, MC_TIPOS_EVENTO, ORDEM_MC_STATUS, ROTULO_MC_ATOR, ROTULO_MC_SINAL,
  ROTULO_MC_STATUS, STATUS_POR_CATEGORIA_CM, STATUS_POR_ESTADO_FACTORY, avaliarFrescor, consolidarEventos,
  consolidarWorkItems, contarPorStatus, descricaoStatus, idEvento, idWorkItem, normalizarComerciais,
  normalizarGate, normalizarJobFactory, ordenarEventos, porStatus, preservarUltimoConhecido, sinalDoItem,
  tipoEventoDoComentario, type ContextoNormalizacao, type JobFactory, type MissionControlEvent,
  type MissionControlWorkItem,
} from './workItem';

const AGORA = '2026-09-22T12:00:00.000Z';
const ctx = (p: Partial<ContextoNormalizacao> = {}): ContextoNormalizacao => ({ observadoEm: AGORA, agora: AGORA, limiteStaleSegundos: 120, ...p });

const job = (p: Partial<JobFactory> = {}): JobFactory => ({
  taskId: 'DF-0412',
  title: 'Implementar adapter X',
  repository: 'augustocfmacedo/eiff-control',
  state: 'CODING',
  risk: 'GREEN',
  role: 'worker',
  attempt: 1,
  priority: 50,
  issueUrl: 'https://github.com/augustocfmacedo/eiff-dev-factory/issues/12',
  prUrl: null,
  headSha: null,
  updatedAt: AGORA,
  costUsd: 0.42,
  ...p,
});

// ---------------------------------------------------------------------------------------- pureza

describe('pureza da fronteira', () => {
  const fonte = fs.readFileSync('src/core/central/workItem.ts', 'utf8');
  const mapa = fs.readFileSync('src/core/central/mapaVivo.ts', 'utf8');

  it('o contrato nao conhece rede, banco, store nem React', () => {
    for (const arquivo of [fonte, mapa]) {
      expect(arquivo).not.toMatch(/\bfetch\s*\(/);
      expect(arquivo).not.toMatch(/from '@supabase/);
      expect(arquivo).not.toMatch(/from 'react'/);
      expect(arquivo).not.toMatch(/from '\.\.\/\.\.\/data\//);
      expect(arquivo).not.toMatch(/@octokit/);
    }
  });

  it('o Mission Control nao ganha porta de escrita: nenhuma funcao que altere fonte', () => {
    // observar nunca e autoridade: nada aqui pode se chamar salvar/gravar/atualizar/mover/transicionar
    expect(fonte).not.toMatch(/export function (salvar|gravar|atualizar|mover|transicionar|enviar)/);
    expect(mapa).not.toMatch(/export function (salvar|gravar|atualizar|mover|transicionar|enviar)/);
  });

  it('a normalizacao comercial nao importa a Maquina Comercial: nada de fonte paralela nem de reordenacao', () => {
    // citar o modulo num comentario e apontar autoridade; IMPORTAR seria criar fonte paralela
    expect(fonte).not.toMatch(/^import[\s\S]*?from '[^']*commercial/im);
    expect(fonte).not.toMatch(/from '\.\.\/radar\//);
    // a unica ordenacao permitida aqui e a de eventos (por data); item de fila nunca e reordenado
    const sorts = fonte.match(/\.sort\(/g) ?? [];
    expect(sorts.length).toBeLessThanOrEqual(2);
  });
});

// ------------------------------------------------------------------------ contract drift da fabrica

describe('contract drift com o eiff-dev-factory', () => {
  const repo = process.env[CONTRATO_FACTORY.envRepoLocal] ?? CONTRATO_FACTORY.repoLocalPadrao;
  const arquivo = path.join(repo, CONTRATO_FACTORY.estados);
  const disponivel = fs.existsSync(arquivo);

  const catalogo = (texto: string, nome: string): string[] => {
    const m = texto.match(new RegExp(`export const ${nome} = \\[([\\s\\S]*?)\\] as const;`));
    if (!m) throw new Error(`catalogo ${nome} nao encontrado no contrato da fabrica`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('o espelho aponta para a autoridade certa', () => {
    expect(CONTRATO_FACTORY.repositorio).toBe('augustocfmacedo/eiff-dev-factory');
    expect(CONTRATO_FACTORY.estados).toBe('packages/contracts/src/estados.ts');
  });

  it('os catalogos espelhados batem com o contrato da fabrica', () => {
    // O clone da fabrica nao existe no CI do eiff-control (checkout de um repositorio so). Sem ele, o
    // que vale e a conferencia local antes de integrar — registrada em docs/mission-control-live.md.
    if (!disponivel) { expect(ESPELHO_JOB_STATES.length).toBe(15); return; }
    const texto = fs.readFileSync(arquivo, 'utf8');
    expect(catalogo(texto, 'JOB_STATES')).toEqual([...ESPELHO_JOB_STATES]);
    expect(catalogo(texto, 'LANES')).toEqual([...ESPELHO_LANES]);
    expect(catalogo(texto, 'WORKER_ROLES')).toEqual([...ESPELHO_WORKER_ROLES]);
    expect(catalogo(texto, 'FACTORY_STATES')).toEqual([...ESPELHO_FACTORY_STATES]);
    expect(catalogo(texto, 'COMMENT_KINDS')).toEqual([...ESPELHO_COMMENT_KINDS]);
    expect(catalogo(texto, 'ACTORS')).toEqual([...ESPELHO_ACTORS]);
  });
});

// --------------------------------------------------------------------------- normalizacao de estado

describe('normalizacao de estado', () => {
  it('todos os 15 estados do job tem traducao e ator, sem sobra e sem falta', () => {
    expect(Object.keys(STATUS_POR_ESTADO_FACTORY).sort()).toEqual([...ESPELHO_JOB_STATES].sort());
    expect(Object.keys(ATOR_POR_ESTADO_FACTORY).sort()).toEqual([...ESPELHO_JOB_STATES].sort());
    for (const e of ESPELHO_JOB_STATES) {
      expect(MC_STATUS, e).toContain(STATUS_POR_ESTADO_FACTORY[e]);
      expect(MC_ATORES, e).toContain(ATOR_POR_ESTADO_FACTORY[e]);
    }
  });

  it('a traducao respeita a maquina de estados da fabrica', () => {
    expect(STATUS_POR_ESTADO_FACTORY.BACKLOG).toBe('ARQUITETURA');
    expect(STATUS_POR_ESTADO_FACTORY.READY).toBe('PRONTO');
    expect(STATUS_POR_ESTADO_FACTORY.CODING).toBe('EXECUTANDO');
    expect(STATUS_POR_ESTADO_FACTORY.CI_RUNNING).toBe('EM_VALIDACAO');
    expect(STATUS_POR_ESTADO_FACTORY.AWAITING_HUMAN).toBe('AGUARDANDO_HUMANO');
    expect(STATUS_POR_ESTADO_FACTORY.BLOCKED).toBe('BLOQUEADO');
    expect(STATUS_POR_ESTADO_FACTORY.DONE).toBe('CONCLUIDO');
  });

  it('o estado cru NUNCA some atras do normalizado', () => {
    for (const e of ESPELHO_JOB_STATES) {
      const it = normalizarJobFactory(job({ state: e }), ctx());
      expect(it.statusOrigem).toBe(e);
      expect(descricaoStatus(it)).toBe(`${ROTULO_MC_STATUS[it.status]} · ${e}`);
    }
    expect(descricaoStatus(normalizarJobFactory(job({ state: 'CI_RUNNING' }), ctx()))).toBe('Em validação · CI_RUNNING');
  });

  it('lane RED em ARCH_APPROVED aponta para o humano, nao para o dispatcher', () => {
    expect(normalizarJobFactory(job({ state: 'ARCH_APPROVED', risk: 'RED' }), ctx()).responsavel?.tipo).toBe('HUMAN');
    expect(normalizarJobFactory(job({ state: 'ARCH_APPROVED', risk: 'GREEN' }), ctx()).responsavel?.tipo).toBe('DISPATCHER');
  });

  it('agente nunca vira humano inventado', () => {
    const it = normalizarJobFactory(job({ state: 'CODING' }), ctx());
    expect(it.responsavel?.tipo).toBe('WORKER');
    expect(it.responsavel?.id).toBeUndefined(); // sem worker informado, nao se inventa um id
  });
});

// ----------------------------------------------------------------------------- identidade e cadeia

describe('identidade e correlacao', () => {
  it('o id e determinstico e a correlacao e o taskId — identidade canonica, nunca id gerado', () => {
    const a = normalizarJobFactory(job(), ctx());
    const b = normalizarJobFactory(job({ state: 'TESTING' }), ctx());
    expect(a.id).toBe('FACTORY:DF-0412');
    expect(a.id).toBe(b.id);
    expect(a.correlationId).toBe('DF-0412');
    expect(idWorkItem('GATE', 'MISSION_CONTROL_LIVE')).toBe('GATE:MISSION_CONTROL_LIVE');
  });

  it('item sem identidade na fonte e recusado em vez de ganhar id aleatorio', () => {
    expect(() => idWorkItem('FACTORY', '  ')).toThrow(/sem identidade/);
  });

  it('a mesma entidade lida duas vezes nao vira dois cartoes; fica o mais recente', () => {
    const antigo = normalizarJobFactory(job({ state: 'CODING', updatedAt: '2026-09-22T11:00:00.000Z' }), ctx());
    const novo = normalizarJobFactory(job({ state: 'TESTING', updatedAt: '2026-09-22T11:30:00.000Z' }), ctx());
    const r = consolidarWorkItems([antigo, novo]);
    expect(r).toHaveLength(1);
    expect(r[0].statusOrigem).toBe('TESTING');
  });

  it('a cadeia se junta num cartao so: o GitHub enriquece a Factory, nao compete com ela', () => {
    const factory = normalizarJobFactory(job({ state: 'CI_RUNNING', prUrl: 'https://github.com/x/y/pull/18' }), ctx());
    const github: MissionControlWorkItem = {
      id: idWorkItem('GITHUB', 'pr-18'),
      correlationId: 'DF-0412',
      source: 'GITHUB',
      sourceId: 'pr-18',
      title: 'PR #18',
      status: 'EM_VALIDACAO',
      statusOrigem: 'check_run:in_progress',
      updatedAt: AGORA,
      links: { branch: 'factory/DF-0412-a1', commit: '39afe82' },
      frescor: avaliarFrescor(ctx()),
    };
    const r = consolidarWorkItems([factory, github]);
    expect(r).toHaveLength(1);
    expect(r[0].source).toBe('FACTORY');            // precedencia: quem tem estado operacional manda
    expect(r[0].links?.pullRequest).toBe('https://github.com/x/y/pull/18');
    expect(r[0].links?.branch).toBe('factory/DF-0412-a1');
    expect(r[0].links?.commit).toBe('39afe82');     // a cadeia inteira sobrevive a consolidacao
  });

  it('correlacoes diferentes nao sao fundidas por acidente', () => {
    const a = normalizarGate(gatePorId('THREAT_MODEL')!, ctx());
    const b = normalizarGate(gatePorId('OBSERVABILIDADE')!, ctx());
    expect(consolidarWorkItems([a, b])).toHaveLength(2);
  });
});

// ------------------------------------------------------------------------------------ gates

describe('gate como item do quadro', () => {
  it('gate fechado e concluido; gate aberto e proximo — e a autoridade continua no gate', () => {
    expect(normalizarGate(gatePorId('THREAT_MODEL')!, ctx()).status).toBe('CONCLUIDO');
    expect(normalizarGate(gatePorId('MISSION_CONTROL_LIVE')!, ctx()).status).toBe('PROXIMO');
  });

  it('bloqueio POR DESENHO nao vira falha', () => {
    const desenho = normalizarGate(gatePorId('ENVIO_CANARY_LIBERADO')!, ctx());
    expect(desenho.bloqueio?.porDesenho).toBe(true);
    expect(sinalDoItem(desenho)).toBe('desenho');
    expect(sinalDoItem(desenho)).not.toBe('bloqueado');
    expect(COR_MC_SINAL[sinalDoItem(desenho)]).not.toBe('vermelho');
  });

  it('bloqueio real continua vermelho e com motivo', () => {
    const real = normalizarGate(gatePorId('RATE_LIMIT_EDGE')!, ctx());
    expect(real.bloqueio?.porDesenho).toBe(false);
    expect(real.bloqueio?.motivo.length).toBeGreaterThan(10);
    expect(sinalDoItem(real)).toBe('bloqueado');
    expect(COR_MC_SINAL.bloqueado).toBe('vermelho');
  });

  it('a dependencia declarada do gate viaja para o item', () => {
    const live = normalizarGate(gatePorId('MISSION_CONTROL_LIVE')!, ctx());
    expect(live.dependsOn).toContain('DEVELOPMENT_STATUS_ENDPOINT');
    expect(live.dependsOn).toContain('MC_DEGRADACAO');
  });

  it('task concluida nao fecha gate: sao eixos separados', () => {
    const done = normalizarJobFactory(job({ state: 'DONE' }), ctx());
    expect(done.status).toBe('CONCLUIDO');
    // o gate que o trabalho serve continua exatamente como o catalogo diz
    expect(gatePorId('MISSION_CONTROL_LIVE')?.situacao).toBe('aberto');
    expect(done.gateIds ?? []).toEqual([]);
  });
});

// ------------------------------------------------------------------------------ frescor e queda

describe('frescor e degradacao', () => {
  it('dado velho e marcado como stale', () => {
    expect(avaliarFrescor(ctx({ observadoEm: '2026-09-22T11:59:30.000Z' })).stale).toBe(false);
    expect(avaliarFrescor(ctx({ observadoEm: '2026-09-22T11:50:00.000Z' })).stale).toBe(true);
  });

  it('data ilegivel nunca passa por fresca', () => {
    expect(avaliarFrescor(ctx({ observadoEm: 'nao-e-data' })).stale).toBe(true);
  });

  it('fonte indisponivel preserva o ultimo estado conhecido e diz que esta indisponivel', () => {
    const anterior = normalizarJobFactory(job({ state: 'CODING' }), ctx({ observadoEm: '2026-09-22T11:00:00.000Z' }));
    const r = preservarUltimoConhecido(anterior, undefined)!;
    expect(r.statusOrigem).toBe('CODING');            // o estado nao muda...
    expect(r.frescor.fonteIndisponivel).toBe(true);   // ...mas a tela sabe que e o ultimo conhecido
    expect(r.frescor.stale).toBe(true);
    expect(r.frescor.observadoEm).toBe('2026-09-22T11:00:00.000Z');
  });

  it('sem estado anterior, a queda da fonte nao inventa item', () => {
    expect(preservarUltimoConhecido(undefined, undefined)).toBeUndefined();
  });

  it('leitura nova sempre vence o ultimo conhecido', () => {
    const anterior = normalizarJobFactory(job({ state: 'CODING' }), ctx());
    const novo = normalizarJobFactory(job({ state: 'TESTING' }), ctx());
    expect(preservarUltimoConhecido(anterior, novo)!.statusOrigem).toBe('TESTING');
  });
});

// ------------------------------------------------------------------------------------- eventos

describe('eventos', () => {
  const ev = (tipo: Parameters<typeof idEvento>[2], ocorridoEm: string, sourceId = 'DF-0412'): MissionControlEvent => ({
    id: idEvento('FACTORY', sourceId, tipo, ocorridoEm),
    correlationId: sourceId,
    tipo,
    ocorridoEm,
    source: 'FACTORY',
    sourceId,
    ator: { tipo: 'WORKER', rotulo: ROTULO_MC_ATOR.WORKER },
  });

  it('todo comentario estruturado da fabrica tem traducao dentro do catalogo', () => {
    for (const k of ESPELHO_COMMENT_KINDS) {
      expect(MC_TIPOS_EVENTO, k).toContain(tipoEventoDoComentario(k));
    }
    expect(tipoEventoDoComentario('CI_RESULT', true)).toBe('CI_PASSED');
    expect(tipoEventoDoComentario('CI_RESULT', false)).toBe('CI_FAILED');
    expect(tipoEventoDoComentario('WORKER_REPORT', false)).toBe('TEST_FAILED');
    expect(tipoEventoDoComentario('SPEC_WRITTEN')).toBe('ARCHITECTURE_STARTED');
    expect(tipoEventoDoComentario('INTEGRATED')).toBe('MERGED');
  });

  it('a mesma ocorrencia lida duas vezes e um evento so', () => {
    const a = ev('CI_PASSED', '2026-09-22T09:36:00.000Z');
    const b = ev('CI_PASSED', '2026-09-22T09:36:00.000Z');
    expect(a.id).toBe(b.id);
    expect(consolidarEventos([a, b])).toHaveLength(1);
  });

  it('a ordem e consistente e estavel, inclusive no empate de horario', () => {
    const e1 = ev('WORKER_STARTED', '2026-09-22T09:16:00.000Z');
    const e2 = ev('CI_STARTED', '2026-09-22T09:33:00.000Z');
    const e3 = ev('CI_PASSED', '2026-09-22T09:33:00.000Z');
    const uma = ordenarEventos([e3, e1, e2]).map((x) => x.id);
    const outra = ordenarEventos([e2, e3, e1]).map((x) => x.id);
    expect(uma).toEqual(outra);
    expect(uma[0]).toBe(e1.id);
  });
});

// --------------------------------------------------------------------------- projecao comercial

describe('projecao da Maquina Comercial', () => {
  const entrada = [
    { itemId: 'e1:SINAL_ACIONAVEL:sinal:s1:-', empresaId: 'e1', titulo: 'Alfa', categoria: 'AGIR_AGORA', atualizadoEm: AGORA },
    { itemId: 'e2:SEM_PROXIMA_ACAO:oportunidade:o1:-', empresaId: 'e2', titulo: 'Beta', categoria: 'FOLLOW_UP', atualizadoEm: AGORA },
    { itemId: 'e3:DUPLICATA:empresa:e3:DUPLICATA_PENDENTE', empresaId: 'e3', titulo: 'Gama', categoria: 'REVISAR', atualizadoEm: AGORA, trava: { codigo: 'DUPLICATA_PENDENTE', texto: 'Possível duplicata pendente de revisão.' } },
  ];

  it('a ordem recebida e preservada: a fila continua sendo da Maquina Comercial', () => {
    const r = normalizarComerciais(entrada, ctx());
    expect(r.map((x) => x.sourceId)).toEqual(entrada.map((x) => x.itemId));
  });

  it('a categoria crua continua visivel e a trava vira bloqueio', () => {
    const r = normalizarComerciais(entrada, ctx());
    expect(r[0].statusOrigem).toBe('AGIR_AGORA');
    expect(r[0].status).toBe('PRONTO');
    expect(r[2].status).toBe('BLOQUEADO');
    expect(r[2].bloqueio?.porDesenho).toBe(false);
  });

  it('toda categoria traduzida cai numa situacao do catalogo', () => {
    for (const [cat, st] of Object.entries(STATUS_POR_CATEGORIA_CM)) expect(MC_STATUS, cat).toContain(st);
  });
});

// ------------------------------------------------------------------------------- apresentacao

describe('apresentacao', () => {
  it('todo status, ator e sinal tem texto — nunca so cor', () => {
    for (const s of MC_STATUS) expect(ROTULO_MC_STATUS[s].trim().length, s).toBeGreaterThan(0);
    for (const a of MC_ATORES) expect(ROTULO_MC_ATOR[a].trim().length, a).toBeGreaterThan(0);
    for (const s of MC_SINAIS) {
      expect(ROTULO_MC_SINAL[s].trim().length, s).toBeGreaterThan(0);
      expect(COR_MC_SINAL[s], s).toBeDefined();
    }
  });

  it('aguardando humano tem destaque proprio e nao se confunde com falha', () => {
    expect(COR_MC_SINAL.humano).toBe('destaque');
    expect(COR_MC_SINAL.humano).not.toBe(COR_MC_SINAL.bloqueado);
  });

  it('as colunas cobrem todos os itens, sem perder e sem duplicar', () => {
    const itens = ESPELHO_JOB_STATES.map((e, i) => normalizarJobFactory(job({ taskId: `DF-${i}`, state: e }), ctx()));
    const colunas = porStatus(itens);
    expect(colunas.map((c) => c.status)).toEqual([...MC_STATUS].sort((a, b) => ORDEM_MC_STATUS[a] - ORDEM_MC_STATUS[b]));
    expect(colunas.reduce((n, c) => n + c.itens.length, 0)).toBe(itens.length);
    const contagem = contarPorStatus(itens);
    for (const c of colunas) expect(contagem[c.status], c.status).toBe(c.itens.length);
  });

  it('as fontes declaradas sao as cinco do contrato', () => {
    expect([...MC_FONTES]).toEqual(['FACTORY', 'ARCHITECTURE', 'GITHUB', 'COMMERCIAL', 'GATE']);
  });
});

// ------------------------------------------------------------------------------- mapa (modelo)

describe('modelo do mapa vivo', () => {
  it('toda aresta liga nos que existem e usa tipo do catalogo', () => {
    for (const a of ARESTAS) {
      expect(noPorId(a.de), `no inexistente: ${a.de}`).toBeDefined();
      expect(noPorId(a.para), `no inexistente: ${a.para}`).toBeDefined();
      expect(TIPOS_ARESTA).toContain(a.tipo);
      expect(a.de).not.toBe(a.para);
    }
  });

  it('nao ha ciclo no que implica ordem', () => {
    expect(ciclosDoMapa()).toEqual([]);
  });

  it('todo no tem id unico e papel escrito', () => {
    const ids = NOS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of NOS) expect(n.papel.trim().length, n.id).toBeGreaterThan(10);
  });

  it('gate citado pelo mapa existe no catalogo', () => {
    expect(gatesDesconhecidosNoMapa()).toEqual([]);
  });

  it('o no do Mission Control so OBSERVA as fontes: observar nunca e autoridade', () => {
    const saindo = ARESTAS.filter((a) => a.de === 'MISSION_CONTROL');
    expect(saindo.length).toBeGreaterThan(0);
    for (const a of saindo) expect(a.tipo, `${a.de} -> ${a.para}`).toBe('observa');
    // e ninguem depende do Mission Control para funcionar
    expect(ARESTAS.filter((a) => a.para === 'MISSION_CONTROL' && (a.tipo === 'fluxo' || a.tipo === 'dependencia'))).toEqual([]);
  });

  it('a cadeia demanda -> producao esta ligada de ponta a ponta', () => {
    expect(dependenciasDe('ARCHITECT')).toContain('DEMANDA');
    expect(dependenciasDe('WORKER')).toContain('DISPATCHER');
    expect(dependenciasDe('CI')).toContain('PR');
    expect(dependenciasDe('PRODUCAO')).toContain('APROVACAO');
  });

  it('o mapa nao inventa gate proprio: todo gate do no vem do catalogo do Mission Control', () => {
    const conhecidos = new Set(GATES.map((x) => x.id));
    for (const n of NOS) for (const id of n.gates) expect(conhecidos.has(id), `${n.id} -> ${id}`).toBe(true);
  });
});

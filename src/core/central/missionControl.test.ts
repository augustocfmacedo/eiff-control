// Mission Control — o painel so vale se a evidencia for real.
//
// Estes testes existem para impedir exatamente o que o painel promete nao fazer: numero inventado e
// evidencia decorativa. Cada gate fechado tem o arquivo citado ABERTO aqui, e o simbolo PROCURADO dentro
// dele. Prontidao e recomputada por contagem independente: se alguem digitar uma porcentagem em qualquer
// lugar, a suite quebra.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENEFICIOS, CAMADAS, DEGRAUS, GATES, MARCOS, ONDAS, SITUACOES_GATE, SITUACOES_ONDA, TIPOS_EVIDENCIA, WORKSTREAMS,
  beneficioDesbloqueado, bloqueios, degrauAtual, gatePorId, gatesDoDegrau, pctGates, prontidao, prontidaoDaCamada,
  prontidaoDoDegrau, prontidaoDoMarco, prontidaoDoSistema, prontidaoDoWorkstream, proximoDegrau, proximoMarco,
  resumoMissionControl, type Evidencia,
} from './missionControl';

const existe = (caminho: string) => fs.existsSync(caminho);
const conteudo = (caminho: string) => fs.readFileSync(caminho, 'utf8');
const ARQUIVO: Record<string, boolean> = { modulo: true, teste: true, migration: true, script: true, documento: true, funcao: true, commit: false };

// ---------------------------------------------------------------------- a evidencia e verificavel

describe('evidencia', () => {
  it('todo gate fechado tem pelo menos uma evidencia', () => {
    for (const g of GATES.filter((x) => x.situacao === 'fechado')) {
      expect(g.evidencias.length, `gate ${g.id} fechado sem evidencia`).toBeGreaterThan(0);
    }
  });

  it('toda evidencia de arquivo aponta para arquivo que existe', () => {
    const faltando: string[] = [];
    for (const g of GATES) {
      for (const e of g.evidencias) {
        if (!ARQUIVO[e.tipo]) continue;
        if (!existe(e.referencia)) faltando.push(`${g.id} -> ${e.referencia}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it('toda evidencia que cita uma migration aponta para arquivo em supabase/migrations', () => {
    const migrations = GATES.flatMap((g) => g.evidencias.filter((e) => e.tipo === 'migration').map((e) => ({ g: g.id, e })));
    expect(migrations.length).toBeGreaterThan(0);
    for (const { g, e } of migrations) {
      expect(e.referencia, `${g}: migration fora da pasta`).toMatch(/^supabase\/migrations\/\d{4}_[a-z0-9_]+\.sql$/);
      expect(existe(e.referencia), `${g}: migration ${e.referencia} nao existe`).toBe(true);
    }
  });

  it('toda evidencia que cita um modulo aponta para arquivo em src/', () => {
    const modulos = GATES.flatMap((g) => g.evidencias.filter((e) => e.tipo === 'modulo' || e.tipo === 'teste').map((e) => ({ g: g.id, e })));
    expect(modulos.length).toBeGreaterThan(0);
    for (const { g, e } of modulos) {
      expect(e.referencia, `${g}: modulo fora de src/`).toMatch(/^src\/.+\.tsx?$/);
      expect(existe(e.referencia), `${g}: modulo ${e.referencia} nao existe`).toBe(true);
    }
  });

  it('todo simbolo citado existe dentro do arquivo citado', () => {
    const erradas: string[] = [];
    for (const g of GATES) {
      for (const e of g.evidencias) {
        if (!e.simbolo || !ARQUIVO[e.tipo]) continue;
        if (!conteudo(e.referencia).includes(e.simbolo)) erradas.push(`${g.id}: "${e.simbolo}" nao esta em ${e.referencia}`);
      }
    }
    expect(erradas).toEqual([]);
  });

  it('todo commit citado existe no repositorio', () => {
    const shas = [...new Set(GATES.flatMap((g) => g.evidencias.filter((e) => e.tipo === 'commit').map((e) => e.referencia)))];
    expect(shas.length).toBeGreaterThan(0);
    for (const sha of shas) expect(sha, `sha mal formado: ${sha}`).toMatch(/^[0-9a-f]{7,40}$/);
    let git = true;
    try { execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }); } catch { git = false; }
    if (!git) return; // sem git (tarball, sandbox): o formato ja foi conferido acima
    for (const sha of shas) {
      const tipo = execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim();
      expect(tipo, `commit ${sha} nao existe`).toBe('commit');
    }
  });

  it('evidencia so usa tipo do catalogo e referencia nao vazia', () => {
    for (const g of GATES) {
      for (const e of g.evidencias as Evidencia[]) {
        expect(TIPOS_EVIDENCIA).toContain(e.tipo);
        expect(e.referencia.trim().length, `${g.id}: referencia vazia`).toBeGreaterThan(0);
      }
    }
  });
});

// ------------------------------------------------------------------------------- higiene dos gates

describe('gates', () => {
  it('id unico, titulo e prova preenchidos, situacao do catalogo', () => {
    const ids = GATES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GATES) {
      expect(g.id).toMatch(/^[A-Z0-9_]+$/);
      expect(g.titulo.trim().length).toBeGreaterThan(0);
      expect(g.prova.trim().length, `gate ${g.id} sem prova`).toBeGreaterThan(10);
      expect(SITUACOES_GATE).toContain(g.situacao);
    }
  });

  it('gate bloqueado explica o bloqueio; gate nao bloqueado nao finge bloqueio', () => {
    for (const g of GATES) {
      if (g.situacao === 'bloqueado') expect(g.bloqueio?.trim().length ?? 0, `gate ${g.id} bloqueado sem motivo`).toBeGreaterThan(10);
      else expect(g.bloqueio, `gate ${g.id} nao esta bloqueado mas tem motivo de bloqueio`).toBeUndefined();
    }
  });

  it('porDesenho so existe em gate bloqueado', () => {
    for (const g of GATES) if (g.porDesenho) expect(g.situacao, `gate ${g.id}`).toBe('bloqueado');
  });

  it('gate aberto ou bloqueado nunca conta como pronto', () => {
    for (const g of GATES.filter((x) => x.situacao !== 'fechado')) {
      expect(prontidao([g.id]).pronto, `gate ${g.id}`).toBe(false);
    }
  });

  it('nenhum gate declara prontidao propria a mao', () => {
    const proibidas = /^(pct|percent|percentual|prontidao|readiness|progresso|completo)$/i;
    for (const g of GATES) for (const k of Object.keys(g)) expect(proibidas.test(k), `gate ${g.id} tem campo ${k}`).toBe(false);
  });
});

// ------------------------------------------------------------------ prontidao e SEMPRE derivada

describe('prontidao derivada', () => {
  it('fracao e sempre fechados sobre exigidos', () => {
    const alvos = [...MARCOS.map((m) => m.gates), ...DEGRAUS.map((d) => gatesDoDegrau(d.id)), ...WORKSTREAMS.map((w) => w.gates), ...CAMADAS.map((c) => c.gates)];
    for (const ids of alvos) {
      const p = prontidao(ids);
      const fechados = ids.filter((i) => gatePorId(i)?.situacao === 'fechado').length;
      expect(p.fechados).toBe(fechados);
      expect(p.exigidos).toBe(ids.length);
      expect(p.fracao).toBeCloseTo(fechados / ids.length, 10);
      expect(p.fechados + p.abertos + p.bloqueados).toBe(p.exigidos);
      expect(p.faltando.length).toBe(p.abertos + p.bloqueados);
      expect(p.conta).toBe(`${fechados} de ${ids.length} gates fechados`);
    }
  });

  it('a prontidao do sistema e a contagem de todos os gates', () => {
    const p = prontidaoDoSistema();
    expect(p.exigidos).toBe(GATES.length);
    expect(p.fechados).toBe(GATES.filter((g) => g.situacao === 'fechado').length);
    expect(p.pronto).toBe(false); // ainda ha gate aberto: o painel nunca deve mentir que acabou
  });

  it('lista vazia nao vira 100%', () => {
    const p = prontidao([]);
    expect(p.fracao).toBe(0);
    expect(p.pronto).toBe(false);
  });

  it('gate inexistente nao entra na conta', () => {
    expect(prontidao(['NAO_EXISTE']).exigidos).toBe(0);
  });

  it('pctGates e a unica formatacao de porcentagem e vem da fracao', () => {
    expect(pctGates(prontidao(['THREAT_MODEL']))).toBe('100%');
    // um gate fechado e um aberto de verdade hoje (as migrations nao foram aplicadas em producao)
    expect(pctGates(prontidao(['THREAT_MODEL', 'MIGRATIONS_APLICADAS']))).toBe('50%');
    expect(pctGates(prontidao(['MIGRATIONS_APLICADAS']))).toBe('0%');
  });

  it('nenhum marco, degrau, workstream ou camada declara numero de prontidao a mao', () => {
    const proibidas = /^(pct|percent|percentual|prontidao|readiness|progresso|fracao|completo)$/i;
    for (const o of [...MARCOS, ...DEGRAUS, ...WORKSTREAMS, ...CAMADAS] as unknown as Record<string, unknown>[]) {
      for (const k of Object.keys(o)) expect(proibidas.test(k), `campo ${k}`).toBe(false);
      for (const v of Object.values(o)) expect(typeof v === 'number', 'valor numerico digitado').toBe(false);
    }
  });
});

// ----------------------------------------------------------------------------- referencias cruzadas

describe('referencias', () => {
  const conhecidos = new Set(GATES.map((g) => g.id));
  const cita = (rotulo: string, ids: string[]) => { for (const i of ids) expect(conhecidos.has(i), `${rotulo} cita gate inexistente: ${i}`).toBe(true); };

  it('marco, degrau, workstream, camada e beneficio so citam gate que existe', () => {
    for (const m of MARCOS) cita(`marco ${m.id}`, m.gates);
    for (const d of DEGRAUS) cita(`degrau ${d.id}`, d.novos);
    for (const w of WORKSTREAMS) cita(`workstream ${w.id}`, w.gates);
    for (const c of CAMADAS) cita(`camada ${c.id}`, c.gates);
    for (const b of BENEFICIOS) cita(`beneficio ${b.id}`, b.gates);
  });

  it('os workstreams particionam os gates: cada gate tem exatamente um dono', () => {
    const donos = new Map<string, string[]>();
    for (const w of WORKSTREAMS) for (const i of w.gates) donos.set(i, [...(donos.get(i) ?? []), w.id]);
    const semDono = GATES.filter((g) => !donos.has(g.id)).map((g) => g.id);
    const comDoisDonos = [...donos].filter(([, ws]) => ws.length > 1).map(([i, ws]) => `${i}: ${ws.join(', ')}`);
    expect(semDono).toEqual([]);
    expect(comDoisDonos).toEqual([]);
  });

  it('as camadas cobrem todos os gates', () => {
    const cobertos = new Set(CAMADAS.flatMap((c) => c.gates));
    expect(GATES.filter((g) => !cobertos.has(g.id)).map((g) => g.id)).toEqual([]);
  });

  it('todo gate aparece em pelo menos um degrau da escada', () => {
    const naEscada = new Set(DEGRAUS.flatMap((d) => d.novos));
    expect(GATES.filter((g) => !naEscada.has(g.id)).map((g) => g.id)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------- a escada

describe('release ladder', () => {
  it('e cumulativa: o degrau seguinte contem todos os gates do anterior', () => {
    for (let i = 1; i < DEGRAUS.length; i++) {
      const antes = new Set(gatesDoDegrau(DEGRAUS[i - 1].id));
      const agora = new Set(gatesDoDegrau(DEGRAUS[i].id));
      for (const x of antes) expect(agora.has(x), `${DEGRAUS[i].id} perdeu ${x}`).toBe(true);
      expect(agora.size).toBeGreaterThan(antes.size);
    }
  });

  it('nenhum degrau repete gate ja exigido pelo anterior', () => {
    const vistos = new Set<string>();
    for (const d of DEGRAUS) {
      for (const x of d.novos) { expect(vistos.has(x), `${d.id} repete ${x}`).toBe(false); vistos.add(x); }
    }
  });

  it('"quando podemos iniciar X" tem resposta factual: os gates que faltam', () => {
    for (const d of DEGRAUS) {
      const p = prontidaoDoDegrau(d);
      expect(p.exigidos).toBe(gatesDoDegrau(d.id).length);
      if (!p.pronto) expect(p.faltando.length).toBeGreaterThan(0);
      for (const f of p.faltando) expect(f.situacao).not.toBe('fechado');
    }
  });

  it('o degrau atual e o ultimo liberado em sequencia, e o proximo e o primeiro que falta', () => {
    const prox = proximoDegrau();
    const atual = degrauAtual();
    expect(prox).toBeDefined();
    expect(prontidaoDoDegrau(prox!).pronto).toBe(false);
    if (atual) expect(DEGRAUS.indexOf(atual)).toBeLessThan(DEGRAUS.indexOf(prox!));
    const anteriores = DEGRAUS.slice(0, DEGRAUS.indexOf(prox!));
    for (const d of anteriores) expect(prontidaoDoDegrau(d).pronto, `${d.id} deveria estar liberado`).toBe(true);
  });

  it('hoje o Alpha interno ainda nao esta liberado, e o que falta e nomeado', () => {
    const alpha = DEGRAUS.find((d) => d.id === 'ALPHA')!;
    const p = prontidaoDoDegrau(alpha);
    expect(p.pronto).toBe(false);
    expect(p.faltando.map((f) => f.id).sort()).toEqual(['MIGRATIONS_APLICADAS']);
  });

  it('gatesDoDegrau devolve vazio para degrau desconhecido', () => {
    expect(gatesDoDegrau('NAO_EXISTE')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------- marcos

describe('marcos', () => {
  it('todo marco exige pelo menos um gate e tem objetivo', () => {
    for (const m of MARCOS) {
      expect(m.gates.length).toBeGreaterThan(0);
      expect(m.objetivo.trim().length).toBeGreaterThan(10);
    }
  });

  it('o proximo marco e o primeiro que ainda nao fechou', () => {
    const m = proximoMarco();
    expect(m).toBeDefined();
    const i = MARCOS.indexOf(m!);
    for (const anterior of MARCOS.slice(0, i)) expect(prontidaoDoMarco(anterior).pronto, `${anterior.id}`).toBe(true);
    expect(prontidaoDoMarco(m!).pronto).toBe(false);
  });

  it('canal e nucleo estao fechados; banco depende da aplicacao em producao', () => {
    expect(prontidaoDoMarco(MARCOS.find((m) => m.id === 'M1_CANAL')!).pronto).toBe(true);
    expect(prontidaoDoMarco(MARCOS.find((m) => m.id === 'M2_NUCLEO')!).pronto).toBe(true);
    const banco = prontidaoDoMarco(MARCOS.find((m) => m.id === 'M3_BANCO')!);
    expect(banco.pronto).toBe(false);
    expect(banco.faltando.map((f) => f.id)).toEqual(['MIGRATIONS_APLICADAS']);
  });
});

// ---------------------------------------------------------------------------------- bloqueios

describe('bloqueios', () => {
  it('separa o que esta fechado de proposito do que e trabalho pendente', () => {
    const b = bloqueios();
    expect(b.porDesenho.length + b.reais.length).toBe(GATES.filter((g) => g.situacao === 'bloqueado').length);
    for (const g of b.porDesenho) expect(g.porDesenho).toBe(true);
    for (const g of b.reais) expect(g.porDesenho).not.toBe(true);
  });

  it('envio e escrita continuam fechados de proposito', () => {
    const del = bloqueios().porDesenho.map((g) => g.id);
    expect(del).toContain('ENVIO_CANARY_LIBERADO');
    expect(del).toContain('ESCRITA_SERVIDOR');
  });

  it('a divida de borda e a aplicacao das migrations sao bloqueios reais, nao porDesenho', () => {
    const reais = bloqueios().reais.map((g) => g.id);
    expect(reais).toContain('RATE_LIMIT_EDGE');
    expect(reais).toContain('MIGRATIONS_APLICADAS');
  });

  it('os gates que provam que nada e enviado e nada e gravado estao FECHADOS', () => {
    expect(gatePorId('ENVIO_FAIL_CLOSED')!.situacao).toBe('fechado');
    expect(gatePorId('ESCRITA_FAIL_CLOSED')!.situacao).toBe('fechado');
  });
});

// -------------------------------------------------------------------------- workstreams e camadas

describe('squad e arquitetura', () => {
  it('cada workstream tem responsavel, onda e foco', () => {
    for (const w of WORKSTREAMS) {
      expect(w.responsavel.trim().length).toBeGreaterThan(0);
      expect(w.onda.trim().length).toBeGreaterThan(0);
      expect(w.foco.trim().length).toBeGreaterThan(10);
      expect(w.gates.length).toBeGreaterThan(0);
      expect(prontidaoDoWorkstream(w).exigidos).toBe(w.gates.length);
    }
  });

  it('cada camada da arquitetura tem papel e prontidao derivada', () => {
    for (const c of CAMADAS) {
      expect(c.papel.trim().length).toBeGreaterThan(10);
      expect(prontidaoDaCamada(c).exigidos).toBe(c.gates.length);
    }
  });
});

// --------------------------------------------------------------------------------- linha do tempo

describe('linha do tempo', () => {
  it('onda concluida cita um commit que existe entre as evidencias ou no repositorio', () => {
    let git = true;
    try { execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }); } catch { git = false; }
    for (const o of ONDAS.filter((x) => x.situacao === 'concluida')) {
      expect(o.commit, `onda ${o.id} concluida sem commit`).toBeDefined();
      expect(o.commit!).toMatch(/^[0-9a-f]{7,40}$/);
      if (git) expect(execFileSync('git', ['cat-file', '-t', o.commit!], { encoding: 'utf8' }).trim()).toBe('commit');
    }
  });

  it('toda onda tem situacao do catalogo e pelo menos uma entrega', () => {
    for (const o of ONDAS) {
      expect(SITUACOES_ONDA).toContain(o.situacao);
      expect(o.entregas.length, `onda ${o.id} sem entrega`).toBeGreaterThan(0);
      for (const e of o.entregas) expect(e.trim().length).toBeGreaterThan(10);
    }
  });

  it('onda planejada nao cita commit', () => {
    for (const o of ONDAS.filter((x) => x.situacao === 'planejada')) expect(o.commit).toBeUndefined();
  });

  it('ha exatamente uma onda em andamento', () => {
    expect(ONDAS.filter((o) => o.situacao === 'em_andamento').length).toBe(1);
  });
});

// ----------------------------------------------------------------------------------- beneficios

describe('beneficios', () => {
  it('beneficio so aparece desbloqueado quando todos os gates dele fecharam', () => {
    for (const b of BENEFICIOS) {
      expect(beneficioDesbloqueado(b)).toBe(b.gates.every((i) => gatePorId(i)?.situacao === 'fechado'));
    }
  });

  it('o que depende de envio ou de escrita continua bloqueado', () => {
    expect(beneficioDesbloqueado(BENEFICIOS.find((b) => b.id === 'PEDIR_PELO_ZAP')!)).toBe(false);
    expect(beneficioDesbloqueado(BENEFICIOS.find((b) => b.id === 'PREVISAO_SOZINHA')!)).toBe(false);
  });

  it('o que ja esta provado aparece desbloqueado', () => {
    expect(beneficioDesbloqueado(BENEFICIOS.find((b) => b.id === 'NADA_SAI')!)).toBe(true);
    expect(beneficioDesbloqueado(BENEFICIOS.find((b) => b.id === 'SEM_DUPLICATA')!)).toBe(true);
  });
});

// --------------------------------------------------------------------------------------- resumo

describe('resumo', () => {
  it('responde as perguntas do painel com numeros derivados', () => {
    const r = resumoMissionControl();
    expect(r.sistema.exigidos).toBe(GATES.length);
    expect(r.proximoDegrau).toBeDefined();
    expect(r.prontidaoProximoDegrau!.exigidos).toBe(gatesDoDegrau(r.proximoDegrau!.id).length);
    expect(r.proximoMarco).toBeDefined();
    expect(r.beneficiosTotal).toBe(BENEFICIOS.length);
    expect(r.beneficiosAtivos).toBe(BENEFICIOS.filter(beneficioDesbloqueado).length);
    expect(r.bloqueiosReais.length + r.bloqueiosPorDesenho.length).toBe(GATES.filter((g) => g.situacao === 'bloqueado').length);
  });

  it('a frase de dez segundos nomeia os gates que faltam para o proximo degrau', () => {
    const r = resumoMissionControl();
    for (const f of r.prontidaoProximoDegrau!.faltando) expect(r.faltaPara).toContain(f.titulo);
  });
});

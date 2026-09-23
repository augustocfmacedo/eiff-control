// LE-3D — a fronteira de intake termina em RegistroFonte PENDING. Nada e promovido, nada e criado alem disso.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CnoObservacao, CnoObservacaoCanonica } from './cnoDadosAbertos';
import { envelopeCno, pedidoIntakeCno } from './cnoDadosAbertos';
import { payloadFingerprint, validarIntake, type PedidoIntake } from './leadEngineIntake';
import { filaDeRevisao } from './leadEngineReview';
import {
  CONFIRMACAO_PILOTO, aplicarPlanoEmMemoria, conferirManifest, modoExecucao, planejarBatchIntake, resolverFonteCno, resumoDoPlano,
} from './leadEngineBatchIntake';
import type { Fonte, RadarDataset, RegistroFonte } from './types';

const FONTE = 'FONTE-CNO';
const EM = '2026-09-23T10:00:00.000Z';
const CNPJ = '11222333000181';

const obs = (cno: string, p: Partial<CnoObservacaoCanonica> = {}): CnoObservacao => {
  const canonical: CnoObservacaoCanonica = {
    cno, dataInicio: '2026-09-01', cnpjResponsavel: CNPJ, nomeResponsavel: 'Construtora Fictícia Alfa Ltda',
    nomeObra: 'Galpão ' + cno, municipio: 'ANÁPOLIS', uf: 'GO', areaTotal: 1500, unidadeMedida: 'm2', situacao: '02',
    areas: [{ categoria: 'Obra Nova', destinacao: 'Galpão industrial' }], cnaes: [], vinculos: [], ...p,
  };
  return { cno, evidence: { obra: { CNO: cno, Nome: 'Galpão ' + cno, 'Situação': canonical.situacao ?? '' }, areas: [{ CNO: cno, Categoria: 'Obra Nova' }], cnaes: [], vinculos: [] }, canonical };
};
const pedido = (cno: string, p: Partial<CnoObservacaoCanonica> = {}) => pedidoIntakeCno(obs(cno, p), FONTE, EM);
const cinquenta = () => Array.from({ length: 50 }, (_, i) => pedido(String(900000000000 + i)));
let seq = 0;
const novoId = () => `SR-${String(++seq).padStart(5, '0')}`;

const radarVazio = (registros: RegistroFonte[] = []): RadarDataset => ({
  fontes: [{ id: FONTE, codigo: 'CNO', nome: 'CNO', tipo: 'CNO', descricao: '', confiabilidade: 0.9, ativo: true, criadoEm: EM } as Fonte],
  empresas: [], contatos: [], projetos: [], sinais: [], oportunidades: [], historicoEstagios: [], atividades: [], tarefas: [],
  tiposResposta: [], estrategias: [], experimentos: [], regrasScore: [], regrasPersona: [], pesosDecisionFit: [], snapshotsScore: [],
  importacoes: [], importacaoLinhas: [], importacaoErros: [], duplicatas: [], supressoes: [], registrosFonte: registros, comunicacoes: [],
  configScore: undefined as never, operacoesVibe: [],
} as unknown as RadarDataset);

describe('LE-3D · plano de intake em lote', () => {
  it('1 · NOVO_REGISTRO cria um RegistroFonte em memória', () => {
    const p = planejarBatchIntake([pedido('1')], [], novoId);
    expect(resumoDoPlano(p)).toEqual({ entradas: 1, NOVO_REGISTRO: 1, NOVA_OBSERVACAO: 0, IDEMPOTENT_NOOP: 0, INVALIDO: 0, WOULD_INSERT: 1 });
    expect(p.registros).toHaveLength(1);
    expect(p.entradas[0]).toMatchObject({ indice: 0, externoId: '1', resultado: 'NOVO_REGISTRO', registroId: p.registros[0].id });
  });

  it('2 · NOVA_OBSERVACAO nasce ao lado da anterior, que fica intacta', () => {
    const base = planejarBatchIntake([pedido('1')], [], novoId);
    const anterior = base.registros[0];
    const copiaAnterior = JSON.parse(JSON.stringify(anterior));
    const p = planejarBatchIntake([pedido('1', { situacao: '15' })], base.registros, novoId);
    expect(resumoDoPlano(p)).toMatchObject({ NOVA_OBSERVACAO: 1, NOVO_REGISTRO: 0, IDEMPOTENT_NOOP: 0 });
    expect(p.registros[0].id).not.toBe(anterior.id);
    expect(p.registros[0].externoId).toBe(anterior.externoId);
    expect(p.registros[0].payloadFingerprint).not.toBe(anterior.payloadFingerprint);
    expect(p.entradas[0].observacaoAnteriorId).toBe(anterior.id);
    expect(anterior).toEqual(copiaAnterior);
  });

  it('3 · IDEMPOTENT_NOOP não cria nada', () => {
    const base = planejarBatchIntake([pedido('1')], [], novoId);
    const p = planejarBatchIntake([pedido('1')], base.registros, novoId);
    expect(resumoDoPlano(p)).toMatchObject({ IDEMPOTENT_NOOP: 1, WOULD_INSERT: 0 });
    expect(p.registros).toHaveLength(0);
    expect(p.noops[0].payloadFingerprint).toBe(base.registros[0].payloadFingerprint);
  });

  it('4 · pedido inválido é diagnosticado, não inventado', () => {
    const invalido: PedidoIntake = { fonteId: FONTE, tipo: 'projeto', externoId: undefined, payload: { x: 1 }, recebidoEm: EM };
    const p = planejarBatchIntake([invalido, pedido('2')], [], novoId);
    expect(resumoDoPlano(p)).toMatchObject({ INVALIDO: 1, NOVO_REGISTRO: 1, entradas: 2 });
    expect(p.invalidos[0]).toMatchObject({ indice: 0, resultado: 'INVALIDO' });
    expect(p.invalidos[0].motivos).toContain('SEM_IDENTIDADE_EXTERNA');
    expect(p.registros).toHaveLength(1);
  });

  it('5-6 · o registro nasce PENDING e sem entidade', () => {
    const p = planejarBatchIntake(cinquenta(), [], novoId);
    for (const r of p.registros) {
      expect(r.statusIntake).toBe('PENDING');
      expect(r.entidadeId).toBeUndefined();
      expect(r.decididoEm).toBeUndefined();
      expect(r.decididoPor).toBeUndefined();
    }
  });

  it('7-9 · o payload é o envelope completo: evidence e canonical preservados', () => {
    const o = obs('1');
    const p = planejarBatchIntake([pedidoIntakeCno(o, FONTE, EM)], [], novoId);
    const payload = p.registros[0].payload as ReturnType<typeof envelopeCno>;
    expect(payload).toEqual(envelopeCno(o));
    expect(payload.schema).toBe('CNO_OPEN_DATA_V1');
    expect(payload.evidence.obra['Nome']).toBe('Galpão 1');
    expect(payload.evidence.areas).toHaveLength(1);
    expect((payload.canonical as Record<string, unknown>).nomeObra).toBe('Galpão 1');
  });

  it('10 · o fingerprint gravado é o do LE-1 sobre o envelope', () => {
    const o = obs('1');
    const p = planejarBatchIntake([pedidoIntakeCno(o, FONTE, EM)], [], novoId);
    expect(p.registros[0].payloadFingerprint).toBe(payloadFingerprint(envelopeCno(o)));
    const v = validarIntake(pedidoIntakeCno(o, FONTE, EM));
    if (!v.ok) throw new Error('inválido');
    expect(p.registros[0].payloadFingerprint).toBe(v.payloadFingerprint);
  });

  it('11-12 · fonte CNO e record_type projeto; externoId = CNO', () => {
    const p = planejarBatchIntake([pedido('7')], [], novoId);
    expect(p.registros[0].fonteId).toBe(FONTE);
    expect(p.registros[0].tipo).toBe('projeto');
    expect(p.registros[0].externoId).toBe('7');
    expect(p.registros[0].recebidoEm).toBe(EM);
  });

  it('13 · 50 em estado vazio → 50 NOVO_REGISTRO; mesma passagem de novo → 50 NOOP e 0 novos', () => {
    const p1 = planejarBatchIntake(cinquenta(), [], novoId);
    expect(resumoDoPlano(p1)).toMatchObject({ NOVO_REGISTRO: 50, WOULD_INSERT: 50 });
    const r = aplicarPlanoEmMemoria(radarVazio(), p1);
    expect(r.registrosFonte).toHaveLength(50);
    const p2 = planejarBatchIntake(cinquenta(), r.registrosFonte, novoId);
    expect(resumoDoPlano(p2)).toEqual({ entradas: 50, NOVO_REGISTRO: 0, NOVA_OBSERVACAO: 0, IDEMPOTENT_NOOP: 50, INVALIDO: 0, WOULD_INSERT: 0 });
  });

  it('14-15 · alterar o payload real de UM CNO → 49 NOOP + 1 NOVA_OBSERVACAO; a anterior não é sobrescrita', () => {
    const p1 = planejarBatchIntake(cinquenta(), [], novoId);
    const r = aplicarPlanoEmMemoria(radarVazio(), p1);
    const antes = JSON.parse(JSON.stringify(r.registrosFonte));
    const pedidos = cinquenta();
    pedidos[3] = pedido(String(900000000003), { situacao: '15' });
    const p2 = planejarBatchIntake(pedidos, r.registrosFonte, novoId);
    expect(resumoDoPlano(p2)).toMatchObject({ IDEMPOTENT_NOOP: 49, NOVA_OBSERVACAO: 1, NOVO_REGISTRO: 0 });
    const r2 = aplicarPlanoEmMemoria(r, p2);
    expect(r2.registrosFonte).toHaveLength(51);
    expect(r2.registrosFonte.slice(0, 50)).toEqual(antes);
    expect(r2.registrosFonte.filter((x) => x.externoId === String(900000000003))).toHaveLength(2);
  });

  it('recebidoEm não integra a identidade nem o fingerprint', () => {
    const base = planejarBatchIntake([pedidoIntakeCno(obs('1'), FONTE, EM)], [], novoId);
    const p = planejarBatchIntake([pedidoIntakeCno(obs('1'), FONTE, '2026-12-31T23:59:59.000Z')], base.registros, novoId);
    expect(resumoDoPlano(p).IDEMPOTENT_NOOP).toBe(1);
  });

  it('dois pedidos idênticos no MESMO lote dão um registro e um NOOP; o id nunca deriva do CNO', () => {
    const CNO = '900000000777';
    const p = planejarBatchIntake([pedido(CNO), pedido(CNO)], [], novoId);
    expect(resumoDoPlano(p)).toMatchObject({ NOVO_REGISTRO: 1, IDEMPOTENT_NOOP: 1 });
    expect(p.registros[0].id).not.toContain(CNO);
    expect(p.registros[0].id).not.toContain('777');
    expect(p.registros[0].id).toMatch(/^SR-\d{5}$/);
    expect(p.registros[0].externoId).toBe(CNO);
  });
});

describe('LE-3D · conferência do manifest e fonte', () => {
  const esperados = [{ cno: 'A', payloadFingerprint: 'fa' }, { cno: 'B', payloadFingerprint: 'fb' }];

  it('16 · todas as entradas encontradas, fingerprint e política iguais → ok', () => {
    const c = conferirManifest({ esperados, encontrados: [{ cno: 'A', payloadFingerprint: 'fa', elegivel: true }, { cno: 'B', payloadFingerprint: 'fb', elegivel: true }] });
    expect(c).toMatchObject({ manifestEntries: 2, snapshotMatch: 2, fingerprintMatch: 2, policyMatch: 2, ok: true });
    expect(conferirManifest({ esperados: [], encontrados: [] }).ok).toBe(false);
  });
  it('17 · fingerprint divergente bloqueia o lote inteiro', () => {
    const c = conferirManifest({ esperados, encontrados: [{ cno: 'A', payloadFingerprint: 'OUTRA', elegivel: true }, { cno: 'B', payloadFingerprint: 'fb', elegivel: true }] });
    expect(c.ok).toBe(false);
    expect(c.fingerprintMatch).toBe(1);
    expect(c.fingerprintDivergente).toEqual(['A']);
  });
  it('18 · CNO ausente no snapshot bloqueia', () => {
    const c = conferirManifest({ esperados, encontrados: [{ cno: 'A', payloadFingerprint: 'fa', elegivel: true }] });
    expect(c.ok).toBe(false);
    expect(c.snapshotMatch).toBe(1);
    expect(c.faltantes).toEqual(['B']);
  });
  it('19 · política divergente bloqueia', () => {
    const c = conferirManifest({ esperados, encontrados: [{ cno: 'A', payloadFingerprint: 'fa', elegivel: false }, { cno: 'B', payloadFingerprint: 'fb', elegivel: true }] });
    expect(c.ok).toBe(false);
    expect(c.policyMatch).toBe(1);
    expect(c.politicaDivergente).toEqual(['A']);
  });
  it('20 · fonte CNO ausente bloqueia', () => {
    expect(resolverFonteCno([{ id: 'x', codigo: 'PNCP', ativo: true }])).toEqual({ ok: false, motivo: 'FONTE_CNO_AUSENTE' });
  });
  it('21 · fonte CNO duplicada bloqueia', () => {
    expect(resolverFonteCno([{ id: 'a', codigo: 'CNO', ativo: true }, { id: 'b', codigo: 'CNO', ativo: true }])).toEqual({ ok: false, motivo: 'FONTE_CNO_DUPLICADA' });
  });
  it('22 · fonte inativa bloqueia; exatamente uma ativa resolve pelo id do banco', () => {
    expect(resolverFonteCno([{ id: 'a', codigo: 'CNO', ativo: false }])).toEqual({ ok: false, motivo: 'FONTE_CNO_INATIVA' });
    expect(resolverFonteCno([{ id: 'uuid-do-banco', codigo: 'CNO', ativo: true }, { id: 'v', codigo: 'VIBE', ativo: true }])).toEqual({ ok: true, fonteId: 'uuid-do-banco' });
  });
});

describe('LE-3D · efeitos: só RegistroFonte', () => {
  it('23-29 · o plano aplicado não cria Empresa, Projeto, Sinal, Oportunidade, Tarefa, Atividade ou Comunicação', () => {
    const p = planejarBatchIntake(cinquenta(), [], novoId);
    const r = aplicarPlanoEmMemoria(radarVazio(), p);
    expect(r.empresas).toHaveLength(0);
    expect(r.projetos).toHaveLength(0);
    expect(r.sinais).toHaveLength(0);
    expect(r.oportunidades).toHaveLength(0);
    expect(r.tarefas).toHaveLength(0);
    expect(r.atividades).toHaveLength(0);
    expect(r.comunicacoes).toHaveLength(0);
    expect(r.contatos).toHaveLength(0);
    expect(r.registrosFonte).toHaveLength(50);
  });

  it('34 · os registros planejados aparecem em filaDeRevisao como candidatos PENDING', () => {
    const p = planejarBatchIntake(cinquenta(), [], novoId);
    const r = aplicarPlanoEmMemoria(radarVazio(), p);
    const fila = filaDeRevisao(r);
    expect(fila).toHaveLength(50);
    expect(fila.every((i) => i.status === 'PENDING')).toBe(true);
    // a promocao continua humana: nada mudou de estado
    expect(r.registrosFonte.every((x) => x.statusIntake === 'PENDING' && x.entidadeId === undefined)).toBe(true);
  });
});

describe('LE-3D · hard gate do runner', () => {
  it('35 · sem --executar = simulação', () => { expect(modoExecucao({ executar: false })).toBe('SIMULACAO'); });
  it('36 · --executar sem --confirmar CNO_PILOT_V1 = recusa', () => {
    expect(modoExecucao({ executar: true })).toBe('RECUSADO');
    expect(modoExecucao({ executar: true, confirmar: 'sim' })).toBe('RECUSADO');
    expect(modoExecucao({ executar: true, confirmar: 'cno_pilot_v1' })).toBe('RECUSADO');
  });
  it('37 · --confirmar sem --executar = simulação', () => { expect(modoExecucao({ executar: false, confirmar: CONFIRMACAO_PILOTO })).toBe('SIMULACAO'); });
  it('38 · só as duas flags juntas chegam à escrita, e no runner a escrita fica atrás desse único modo', () => {
    expect(modoExecucao({ executar: true, confirmar: CONFIRMACAO_PILOTO })).toBe('ESCRITA');
    const runner = readFileSync('scripts/cno-intake-producao.mts', 'utf8');
    expect(runner).toMatch(/if \(modo !== 'ESCRITA'\) \{[\s\S]*process\.exit\(0\);/);
    expect(runner).toContain("if (modo === 'RECUSADO') falhar(");
    expect(runner.indexOf("if (modo !== 'ESCRITA')")).toBeLessThan(runner.indexOf('aplicarEmProducao(script)'));
  });
});

describe('LE-3D · guardas estruturais', () => {
  const core = readFileSync('src/core/radar/leadEngineBatchIntake.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const runner = readFileSync('scripts/cno-intake-producao.mts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('30 · ingerirRegistrosRadar nunca é usado no core nem no runner (ela cria entidades direto)', () => {
    expect(core).not.toContain('ingerirRegistrosRadar');
    expect(runner).not.toContain('ingerirRegistrosRadar');
    // e ela existe no store exatamente com esse comportamento: normaliza pelo adapter e ingere entidades
    const store = readFileSync('src/data/store.ts', 'utf8');
    expect(store).toMatch(/ingerirRegistrosRadar\(fonteCodigo: string, brutos: unknown\[\]\) \{[\s\S]*?adapter\.normalizar\(bruto\)/);
  });
  it('31 · processarCandidatoLeadEngine nunca é chamado no intake; ela é porta de DECISÃO de candidato existente', () => {
    expect(core).not.toContain('processarCandidatoLeadEngine');
    expect(runner).not.toContain('processarCandidatoLeadEngine(');
    const store = readFileSync('src/data/store.ts', 'utf8');
    expect(store).toMatch(/processarCandidatoLeadEngine\(cmd: ComandoLeadEngine\)[\s\S]*?aplicarDecisao\(r, cmd\.pedido, ctx\)/);
  });
  it('core puro: sem store, Supabase, fs, rede, score ou entidade comercial; reutiliza o LE-1', () => {
    for (const p of ['data/store', 'actions.', 'supabase', 'Supabase', 'node:fs', 'fetch(', 'process.env', 'score', 'priority', 'CommercialQueue', 'upsertEmpresa', 'upsertProjeto', 'registrarSinal', 'oportunidade', 'tarefa', 'atividade', 'comunicac', 'sha256', 'createHash']) {
      expect(core).not.toContain(p);
    }
    expect(core).toContain('validarIntake');
    expect(core).toContain('discoveryRecords');
    expect(core).toContain('classificarIntake');
    expect(core).toContain('registroDeIntake');
    const imports = [...core.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('./'))).toBe(true);
  });
  it('39 · o runner só gera INSERT em radar_source_record, com guarda no próprio SQL, e a suíte nunca o executa', () => {
    expect(runner).toContain("if (tabelasTocadas.some((t) => t !== 'insert into radar_source_record'))");
    expect(runner).toContain("if (/on conflict/i.test(script)) falhar(");
    for (const p of ['radar_company', 'radar_project', 'radar_signal', 'radar_opportunity', 'radar_task', 'radar_activity', 'radar_communication']) expect(runner).not.toContain(`into ${p}`);
    expect(runner).toContain("'begin;'");
    expect(runner).toContain("'commit;'");
  });
});

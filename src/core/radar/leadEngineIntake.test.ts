// Lead Engine LE-1 — intake canonico, staging logico, idempotencia e NAO-REGRESSAO.
// Nomes ficticios; nenhuma conta real. Nenhuma rede, nenhum banco, nenhuma UI.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_INTAKE_INVALIDO, RESULTADOS_INTAKE, STATUS_INTAKE, chaveIdentidade, classificarIntake, discoveryRecordDe,
  discoveryRecords, mesmaIdentidade, payloadCanonico, payloadFingerprint, problemasDoDiscoveryRecord, registroDeIntake,
  validarIntake, type DiscoveryRecord, type IntakeValido, type PedidoIntake,
} from './leadEngineIntake';
import { construirCommercialQueue } from './commercialMachine';
import { planosDaFilaCM } from './commercialActionPlan';
import { cadenciasDaFilaCM } from './commercialCadence';
import { criarIds, importarCsv } from './importacao';
import { radarVazio, type Empresa, type Fonte, type RadarDataset, type RegistroFonte } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------
const HOJE = '2026-09-15';
const AGORA = '2026-09-15T10:00:00.000Z';
const FONTE_CNO = 'FONTE-CNO';

const obra = (p: Partial<Record<string, unknown>> = {}) => ({
  cno: '11.111.11111/11',
  nomeResponsavel: 'Construtora Fictícia Alfa Ltda',
  cnpjResponsavel: '11111111000111',
  municipio: 'Anápolis',
  uf: 'GO',
  dataInicio: '2026-09-01',
  areaM2: 4200,
  ...p,
});

const pedido = (p: Partial<PedidoIntake> = {}): PedidoIntake => ({
  fonteId: FONTE_CNO, tipo: 'projeto', externoId: '11.111.11111/11', payload: obra(), recebidoEm: AGORA, ...p,
});

const valido = (p: PedidoIntake): IntakeValido => {
  const v = validarIntake(p);
  if (!v.ok) throw new Error(`fixture invalida: ${v.motivos.join(',')}`);
  return v;
};

/** Registro do Lead Engine (gerenciado). */
const gerenciado = (id: string, p: Partial<RegistroFonte> = {}): RegistroFonte => ({
  id, fonteId: FONTE_CNO, tipo: 'projeto', externoId: '11.111.11111/11', payload: obra(),
  recebidoEm: AGORA, payloadFingerprint: payloadFingerprint(obra()), statusIntake: 'PENDING', ...p,
});

/** Registro anterior ao Lead Engine: sem statusIntake, sem impressao. */
const legado = (id: string, p: Partial<RegistroFonte> = {}): RegistroFonte => ({
  id, fonteId: 'FONTE-CSV', tipo: 'empresa', externoId: 'x-1', payload: { nome: 'Antiga Fictícia' },
  recebidoEm: '2026-08-01T10:00:00.000Z', ...p,
});

const dr = (p: Partial<DiscoveryRecord> = {}): DiscoveryRecord => ({
  registroFonteId: 'SR-1', fonteId: FONTE_CNO, externoId: '11.111.11111/11', tipo: 'projeto',
  payloadFingerprint: payloadFingerprint(obra()), status: 'PENDING', recebidoEm: AGORA, ...p,
});

const emp = (id: string, priorityClass: Empresa['priorityClass'] = 'A', priorityScore = 75): Empresa => ({
  id, razaoSocial: `Conta ${id}`, pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-01-01', atualizadoEm: '2026-09-01',
  fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore, priorityClass,
});

const fonteCsv: Fonte = { id: 'FONTE-CSV', codigo: 'CSV', nome: 'Planilha CSV', tipo: 'CSV', descricao: '', confiabilidade: 0.8, ativo: true, criadoEm: '2026-01-01' };

const FONTE_TS = readFileSync('src/core/radar/leadEngineIntake.ts', 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const CODIGO = semComentarios(FONTE_TS);

// ---------------------------------------------------------------------------------------------------------------------
// §24 — Canonicalizacao (1..10)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · canonicalizacao do payload', () => {
  it('1 · mesmas chaves e mesmos valores produzem o mesmo canonical', () => {
    expect(payloadCanonico({ a: 1, b: 'x' })).toBe(payloadCanonico({ a: 1, b: 'x' }));
  });

  it('2 · ordem diferente das chaves produz o mesmo canonical', () => {
    expect(payloadCanonico({ b: 'x', a: 1 })).toBe(payloadCanonico({ a: 1, b: 'x' }));
  });

  it('3 · objeto aninhado com ordem diferente produz o mesmo canonical', () => {
    const um = { topo: 1, dentro: { z: 9, a: { n: 2, m: 1 } } };
    const outro = { dentro: { a: { m: 1, n: 2 }, z: 9 }, topo: 1 };
    expect(payloadCanonico(outro)).toBe(payloadCanonico(um));
  });

  it('4 · arrays preservam a ordem recebida (ordem de array e informacao da fonte)', () => {
    expect(payloadCanonico({ etapas: [3, 1, 2] })).toContain('[3,1,2]');
    expect(payloadCanonico({ etapas: [3, 1, 2] })).not.toBe(payloadCanonico({ etapas: [1, 2, 3] }));
  });

  it('5 · null e preservado e nao vira ausencia', () => {
    expect(payloadCanonico({ uf: null })).toBe('{"uf":null}');
    expect(payloadCanonico({ uf: null })).not.toBe(payloadCanonico({}));
  });

  it('6 · boolean e preservado com o seu tipo', () => {
    expect(payloadCanonico({ ativo: true })).toBe('{"ativo":true}');
    expect(payloadCanonico({ ativo: true })).not.toBe(payloadCanonico({ ativo: 'true' }));
  });

  it('7 · numeros sao preservados e nao viram texto', () => {
    expect(payloadCanonico({ areaM2: 4200 })).toBe('{"areaM2":4200}');
    expect(payloadCanonico({ areaM2: 4200 })).not.toBe(payloadCanonico({ areaM2: '4200' }));
  });

  it('8 · strings sao preservadas, inclusive acentuacao e espacos', () => {
    expect(payloadCanonico({ municipio: 'Anápolis ' })).toBe('{"municipio":"Anápolis "}');
    expect(payloadCanonico({ municipio: 'Anápolis ' })).not.toBe(payloadCanonico({ municipio: 'Anápolis' }));
  });

  it('9 · alteracao factual muda o canonical', () => {
    expect(payloadCanonico(obra({ areaM2: 4300 }))).not.toBe(payloadCanonico(obra()));
  });

  it('10 · a entrada nao e mutada pela canonicalizacao', () => {
    const entrada = obra({ lista: [2, 1] });
    const antes = JSON.stringify(entrada);
    payloadCanonico(entrada);
    payloadFingerprint(entrada);
    expect(JSON.stringify(entrada)).toBe(antes);
    expect(Object.keys(entrada)).toEqual(Object.keys(obra({ lista: [2, 1] })));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// §25 — Fingerprint (11..16)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · impressao da observacao', () => {
  it('11 · payload igual produz o mesmo fingerprint', () => {
    expect(payloadFingerprint(obra())).toBe(payloadFingerprint(obra()));
  });

  it('12 · ordem das chaves nao muda o fingerprint', () => {
    const invertido = Object.fromEntries(Object.entries(obra()).reverse());
    expect(Object.keys(invertido)[0]).not.toBe(Object.keys(obra())[0]);
    expect(payloadFingerprint(invertido)).toBe(payloadFingerprint(obra()));
  });

  it('13 · mudanca factual muda o fingerprint', () => {
    expect(payloadFingerprint(obra({ areaM2: 9999 }))).not.toBe(payloadFingerprint(obra()));
  });

  it('14 · fingerprint e determinista entre chamadas e tem forma de sha256', () => {
    const a = payloadFingerprint(obra());
    const b = payloadFingerprint(obra());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('15 · fingerprint nao depende de recebidoEm', () => {
    const cedo = valido(pedido({ recebidoEm: '2026-09-15T08:00:00.000Z' }));
    const tarde = valido(pedido({ recebidoEm: '2026-12-31T23:59:00.000Z' }));
    expect(tarde.payloadFingerprint).toBe(cedo.payloadFingerprint);
  });

  it('16 · fingerprint nao depende do id local do registro', () => {
    const v = valido(pedido());
    const p = pedido();
    expect(registroDeIntake(v, p, 'SR-aaa').payloadFingerprint).toBe(registroDeIntake(v, p, 'SR-zzz').payloadFingerprint);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// §26 — Identidade externa (17..21)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · identidade externa', () => {
  it('17 · fonte + externoId forma a source identity', () => {
    const v = valido(pedido());
    expect(v.identidade).toEqual({ fonteId: FONTE_CNO, externoId: '11.111.11111/11' });
    expect(chaveIdentidade(v.identidade)).toContain(FONTE_CNO);
  });

  it('18 · outra fonte com o mesmo externoId nao e a mesma identidade', () => {
    expect(mesmaIdentidade({ fonteId: FONTE_CNO, externoId: 'A' }, { fonteId: 'FONTE-PNCP', externoId: 'A' })).toBe(false);
  });

  it('19 · mesma fonte com outro externoId nao e a mesma identidade', () => {
    expect(mesmaIdentidade({ fonteId: FONTE_CNO, externoId: 'A' }, { fonteId: FONTE_CNO, externoId: 'B' })).toBe(false);
    // e a concatenacao nao pode colidir por ambiguidade de separador
    expect(chaveIdentidade({ fonteId: 'a', externoId: 'b|c' })).not.toBe(chaveIdentidade({ fonteId: 'a|b', externoId: 'c' }));
  });

  it('20 · intake automatico sem externoId e invalido (SEM_IDENTIDADE_EXTERNA)', () => {
    const v = validarIntake(pedido({ externoId: undefined }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.motivos).toContain('SEM_IDENTIDADE_EXTERNA');
    expect(validarIntake(pedido({ externoId: '   ' })).ok).toBe(false);
    expect(MOTIVOS_INTAKE_INVALIDO).toContain('SEM_IDENTIDADE_EXTERNA');
  });

  it('21 · o intake nao faz nenhum match por nome/CNPJ/dominio de empresa', () => {
    // dois objetos externos com a MESMA empresa no payload continuam sendo dois objetos distintos
    const a = valido(pedido({ externoId: 'obra-1' }));
    const b = valido(pedido({ externoId: 'obra-2' }));
    expect(mesmaIdentidade(a.identidade, b.identidade)).toBe(false);
    const c = classificarIntake(b, [dr({ externoId: 'obra-1', payloadFingerprint: a.payloadFingerprint })]);
    expect(c.resultado).toBe('NOVO_REGISTRO');
    // e o modulo nem conhece a escada de identidade de empresa (isso e do LE-2)
    for (const proibido of ['encontrarEmpresa', './normalizar', 'razaoSocial', 'cnpj', 'dominio', 'duplicata']) {
      expect(CODIGO).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// §27 — Idempotencia (22..26)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · idempotencia', () => {
  it('22 · mesma identidade + mesmo fingerprint = IDEMPOTENT_NOOP', () => {
    const v = valido(pedido());
    const existente = dr({ payloadFingerprint: v.payloadFingerprint });
    const c = classificarIntake(v, [existente]);
    expect(c.resultado).toBe('IDEMPOTENT_NOOP');
    expect(c.observacaoExistente?.registroFonteId).toBe('SR-1');
    expect(RESULTADOS_INTAKE).toContain('IDEMPOTENT_NOOP');
  });

  it('23 · mesma identidade + fingerprint diferente = NOVA_OBSERVACAO', () => {
    const v = valido(pedido({ payload: obra({ areaM2: 5000 }) }));
    const c = classificarIntake(v, [dr()]);
    expect(c.resultado).toBe('NOVA_OBSERVACAO');
    expect(c.observacaoExistente).toBeUndefined();
    expect(c.observacoesAnteriores.map((o) => o.registroFonteId)).toEqual(['SR-1']);
  });

  it('24 · identidade desconhecida = NOVO_REGISTRO', () => {
    const c = classificarIntake(valido(pedido({ externoId: 'outra-obra' })), [dr()]);
    expect(c.resultado).toBe('NOVO_REGISTRO');
    expect(c.observacoesAnteriores).toEqual([]);
  });

  it('25 · repeticao exata nao cria um segundo registro no staging', () => {
    const v = valido(pedido());
    const staging = [dr({ payloadFingerprint: v.payloadFingerprint })];
    const c = classificarIntake(v, staging);
    const depois = c.resultado === 'IDEMPOTENT_NOOP' ? staging : [...staging, discoveryRecordDe(registroDeIntake(v, pedido(), 'SR-2'))!];
    expect(depois).toHaveLength(1);
    expect(depois).toBe(staging);
  });

  it('26 · nova observacao preserva a observacao anterior intacta', () => {
    const antes = gerenciado('SR-1');
    const payloadAntes = JSON.stringify(antes.payload);
    const v = valido(pedido({ payload: obra({ areaM2: 5000 }) }));
    const novo = registroDeIntake(v, pedido({ payload: obra({ areaM2: 5000 }) }), 'SR-2');
    expect(novo.id).not.toBe(antes.id);
    expect(novo.payloadFingerprint).not.toBe(antes.payloadFingerprint);
    expect(novo.externoId).toBe(antes.externoId); // mesmo objeto externo
    expect(JSON.stringify(antes.payload)).toBe(payloadAntes); // bruto anterior nao foi reescrito
    expect(discoveryRecords([antes, novo])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// §28 — Staging (27..34)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · staging logico', () => {
  it('27 · intake valido nasce PENDING, sem entidade e sem decisao', () => {
    const v = valido(pedido());
    const r = registroDeIntake(v, pedido(), 'SR-1');
    expect(r.statusIntake).toBe('PENDING');
    expect(r.entidadeId).toBeUndefined();
    expect(r.decididoEm).toBeUndefined();
    expect(r.decididoPor).toBeUndefined();
    expect(STATUS_INTAKE[0]).toBe('PENDING');
  });

  it('28 · REVIEW e representavel e nao exige entidade', () => {
    const d = dr({ status: 'REVIEW' });
    expect(problemasDoDiscoveryRecord(d)).toEqual([]);
    expect(d.entidadeId).toBeUndefined();
  });

  it('29 · REJECTED preserva o payload e exige motivo', () => {
    const r = gerenciado('SR-1', { statusIntake: 'REJECTED', motivoDecisao: 'fora do perfil', decididoEm: AGORA, decididoPor: 'U' });
    expect(r.payload).toEqual(obra());
    const d = discoveryRecordDe(r)!;
    expect(problemasDoDiscoveryRecord(d)).toEqual([]);
    expect(problemasDoDiscoveryRecord({ ...d, motivoDecisao: undefined })).toContain('REJECTED exige motivo');
  });

  it('30 · RESOLVED pode referenciar a entidade criada', () => {
    const d = dr({ status: 'RESOLVED', entidadeId: 'EMP-00001', decididoEm: AGORA, decididoPor: 'U' });
    expect(problemasDoDiscoveryRecord(d)).toEqual([]);
    expect(d.entidadeId).toBe('EMP-00001');
  });

  it('31 · PENDING nao exige entidade', () => {
    expect(problemasDoDiscoveryRecord(dr({ status: 'PENDING' }))).toEqual([]);
  });

  it('32 · RESOLVED sem entidade e incoerente (mesma regra do CHECK da migration)', () => {
    expect(problemasDoDiscoveryRecord(dr({ status: 'RESOLVED', decididoEm: AGORA }))).toContain('RESOLVED exige entidade ligada');
    const sql = readFileSync('supabase/migrations/0055_lead_engine_intake.sql', 'utf8');
    expect(sql).toContain("check (intake_status is distinct from 'RESOLVED' or entity_id is not null)");
  });

  it('33 · registro rejeitado continua no staging e continua consultavel', () => {
    const staging = [gerenciado('SR-1', { statusIntake: 'REJECTED', motivoDecisao: 'fora do perfil', decididoEm: AGORA })];
    const ds = discoveryRecords(staging);
    expect(ds).toHaveLength(1);
    expect(ds[0].status).toBe('REJECTED');
    expect(ds[0].payloadFingerprint).toBeTruthy();
  });

  it('34 · registro historico NUNCA vira pendencia do Lead Engine', () => {
    const historico = [legado('SR-velho-1'), legado('SR-velho-2', { entidadeId: 'EMP-00001' })];
    expect(discoveryRecords(historico)).toEqual([]);
    expect(discoveryRecordDe(historico[0])).toBeUndefined();
    expect(discoveryRecordDe(historico[1])).toBeUndefined(); // nem o que ja tem entidade
    // misturado com registros do Lead Engine, so os gerenciados aparecem
    expect(discoveryRecords([...historico, gerenciado('SR-novo')]).map((d) => d.registroFonteId)).toEqual(['SR-novo']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// §29 — Nao-regressao (35..45)
// ---------------------------------------------------------------------------------------------------------------------
describe('LE-1 · nao-regressao', () => {
  const base = (): RadarDataset => ({
    ...radarVazio(),
    pesosDecisionFit: [{ chave: 'fit.ideal', valor: 70 }, { chave: 'fit.adequado', valor: 40 }],
    empresas: [emp('alfa', 'A', 80), emp('beta', 'B', 55)],
  });
  const comStaging = (): RadarDataset => ({
    ...base(),
    registrosFonte: [gerenciado('SR-1'), gerenciado('SR-2', { payload: obra({ areaM2: 5000 }), payloadFingerprint: payloadFingerprint(obra({ areaM2: 5000 })) })],
  });

  it('35 · Commercial Queue nao muda com o staging do Lead Engine no dataset', () => {
    expect(JSON.stringify(construirCommercialQueue(comStaging(), HOJE))).toBe(JSON.stringify(construirCommercialQueue(base(), HOJE)));
  });

  it('36 · Action Plan nao muda', () => {
    const p = (r: RadarDataset) => planosDaFilaCM(r, construirCommercialQueue(r, HOJE));
    expect(JSON.stringify(p(comStaging()))).toBe(JSON.stringify(p(base())));
  });

  it('37 · Cadence nao muda', () => {
    const c = (r: RadarDataset) => { const f = construirCommercialQueue(r, HOJE); return cadenciasDaFilaCM(r, f, planosDaFilaCM(r, f), HOJE); };
    expect(JSON.stringify(c(comStaging()))).toBe(JSON.stringify(c(base())));
  });

  it('38 · a Commercial UX nao ganha entrada nova: o staging nao vira item de fila', () => {
    const f = construirCommercialQueue(comStaging(), HOJE);
    expect(f.itens.map((i) => i.empresaId).sort()).toEqual(['alfa', 'beta']);
    expect(JSON.stringify(f)).not.toContain('SR-1');
    for (const proibido of ['comercialVisao', 'comercialPipeline', 'comercialEntrada', 'commercialMachine', 'Hoje']) {
      expect(CODIGO).not.toContain(proibido);
    }
  });

  it('39 · nenhum score e tocado: o intake nao le nem escreve prioridade', () => {
    const r = comStaging();
    expect(r.empresas.map((e) => [e.priorityScore, e.priorityClass, e.fitScore])).toEqual([[80, 'A', 50], [55, 'B', 50]]);
    for (const proibido of ['priorityScore', 'priorityClass', 'fitScore', 'decisionFit', 'recomendarAcao', './score', './pipeline']) {
      expect(CODIGO).not.toContain(proibido);
    }
  });

  it('40 · importacao CSV segue igual e nao cria pendencia do Lead Engine', () => {
    const r = { ...radarVazio(), fontes: [fonteCsv] };
    const ids = criarIds(r, { hoje: HOJE, agora: AGORA, usuarioId: 'U' });
    const saida = importarCsv(r, ['business_name,business_domain', 'Alfa Fictícia,alfa.invalid'].join('\n'), { tipo: 'empresas', fonte: fonteCsv, usuarioId: 'U', agora: AGORA }, ids);
    expect(saida.job.importados).toBe(1);
    expect(saida.radar.registrosFonte.length).toBeGreaterThan(0);
    expect(saida.radar.registrosFonte.every((x) => x.statusIntake === undefined)).toBe(true);
    expect(discoveryRecords(saida.radar.registrosFonte)).toEqual([]); // zero backlog falso
  });

  it('41 · o intake nao conhece o Vibe nem operacao paga', () => {
    for (const proibido of ['vibe', 'Vibe', 'credito', 'creditos', 'Explorium', 'businessId']) {
      expect(CODIGO).not.toContain(proibido);
    }
  });

  it('42 · o intake nao cria oportunidade', () => {
    const v = valido(pedido());
    const r = registroDeIntake(v, pedido(), 'SR-1');
    expect(Object.keys(r).sort()).toEqual(['externoId', 'fonteId', 'id', 'payload', 'payloadFingerprint', 'recebidoEm', 'statusIntake', 'tipo']);
    for (const proibido of ['oportunidade', 'Oportunidade', 'estagio']) expect(CODIGO).not.toContain(proibido);
  });

  it('43 · o intake nao cria tarefa', () => {
    for (const proibido of ['TarefaRadar', 'tarefas', 'venceEm']) expect(CODIGO).not.toContain(proibido);
  });

  it('44 · o intake nao cria nem envia comunicacao', () => {
    for (const proibido of ['comunicacao', 'Comunicacao', 'delivery', 'sendApproved', 'canais']) expect(CODIGO).not.toContain(proibido);
  });

  it('45 · o intake nao toca em Central/Mission Control nem em rede', () => {
    for (const proibido of ['core/central', 'central/', 'whatsapp', 'fetch(', 'supabase', 'store', 'react', 'axios', 'process.env']) {
      expect(CODIGO).not.toContain(proibido);
    }
    // a unica dependencia do modulo sao o hash canonico e os tipos do Radar
    const imports = [...FONTE_TS.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./hash', './types']);
  });

  it('46 · a evidencia bruta continua protegida — agora pelo banco, nao pelo insert-only', () => {
    const mapa = readFileSync('src/data/radar.supabase.ts', 'utf8');
    const linha = mapa.split('\n').find((l) => l.includes("tabela: 'radar_source_record'"))!;
    // MUDANCA CONSCIENTE DO LE2-A: a spec deixou de ser insert-only porque a decisao humana
    // (PENDING -> REVIEW -> RESOLVED/REJECTED) precisa virar UPDATE — no ramo imutavel nao existe caminho de
    // update e a transicao era descartada em silencio. A garantia nao se perdeu, mudou de lugar:
    //   * a evidencia e protegida pelo TRIGGER do Postgres (abaixo, e exercitado em pg-smoke-lead-engine.mjs);
    //   * o ramo mutavel NAO apaga linha que some do dataset, o que o ramo imutavel fazia.
    // O contrato completo esta em docs/lead-engine-1.0.md §28; os testes, em src/data/radar.persistencia.test.ts.
    expect(linha).not.toContain('imutavel: true');
    expect(linha).toContain('COLECAO_DO_REGISTRO'); // entity_id polimorfico pelo record_type
    const sql = readFileSync('supabase/migrations/0055_lead_engine_intake.sql', 'utf8');
    expect(sql).toContain('radar_source_record_evidencia_imutavel');
    expect(sql).toContain('new.payload is distinct from old.payload');
    // idempotencia no banco: unico por observacao, nunca por objeto externo
    expect(sql).toContain('(organization_id, source_id, external_id, payload_fingerprint)');
    expect(sql).not.toMatch(/unique index[\s\S]{0,200}\(organization_id, source_id, external_id\)\s*$/m);
  });
});

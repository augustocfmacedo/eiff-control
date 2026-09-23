// LE-2A — persistencia canonica do staging do Lead Engine.
//
// Prova o que o ADAPTER garante: round-trip dos quatro tipos, `entity_id` polimorfico pelo `record_type`,
// decisao virando UPDATE (e nao insert novo), e ausencia no dataset NAO virando DELETE.
//
// DIVISAO DE TRABALHO, declarada de proposito:
//   * AQUI (TypeScript): o que o mapeamento e o persistidor fazem — quais colunas sao escritas, com que valores,
//     por qual caminho (gravar x inserir x apagar).
//   * NO POSTGRES (scripts/pg-smoke-lead-engine.mjs, PGlite): o que o BANCO recusa — o trigger
//     `radar_source_record_evidencia` e os CHECKs da migration 0055.
// Teste de TypeScript nao substitui trigger de PostgreSQL: o adapter pode mandar o que quiser, quem diz nao e o
// banco. Por isso as duas metades existem e sao citadas uma pela outra.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLECAO_DO_REGISTRO, carregarRadar, linhaApp, linhaDb, persistirRadar, type ChaveRadar, type HelpersRadar } from './radar.supabase';
import { radarVazio, type RadarDataset, type RegistroFonte, type StatusIntake, type TipoRegistroFonte } from '../core/radar/types';

const ORG = 'org-1';
const AGORA = '2026-09-23T12:00:00.000Z';

// ---------------------------------------------------------------------------------------------------------
// Helpers de teste: um espelho do que o provider real faz, mas gravando as chamadas em vez de falar com a rede
// ---------------------------------------------------------------------------------------------------------
interface Chamada { op: 'gravar' | 'inserir' | 'apagar'; tabela: string; filtro?: unknown; row?: Record<string, unknown>; rows?: Record<string, unknown>[]; id?: string }

function helpers(linhas: Record<string, Record<string, unknown>[]> = {}): HelpersRadar & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    sel: async (tabela) => (linhas[tabela] ?? []) as never,
    gravar: async (tabela, filtro, row, extra) => { chamadas.push({ op: 'gravar', tabela, filtro, row: { ...extra, ...row } }); return { id: (filtro.id as string) ?? `novo-${tabela}` }; },
    gravarComposta: async () => {},
    inserir: async (tabela, rows) => { chamadas.push({ op: 'inserir', tabela, rows }); return rows.map((_, i) => ({ id: `ins-${i}` })); },
    apagar: async (tabela, id) => { chamadas.push({ op: 'apagar', tabela, id }); },
    orgId: ORG,
    atorId: 'perfil-ator',
    uuid: (v) => v ?? null,
    perfil: (u) => (u ? `perfil-${u}` : null),
  };
}

/** `ref` de teste: devolve o proprio id, para a asserção falar de QUAL colecao foi consultada. */
const refDe = (visto: { chaves: ChaveRadar[] }) => (chave: ChaveRadar, id?: string) => { if (!id) return null; visto.chaves.push(chave); return id; };

const registro = (p: Partial<RegistroFonte> & { id: string; tipo: TipoRegistroFonte }): RegistroFonte => ({
  fonteId: 'FONTE-CNO', externoId: '11.111.11111/11', payload: { cno: '11.111.11111/11', municipio: 'Anápolis' },
  recebidoEm: AGORA, payloadFingerprint: 'f'.repeat(64), statusIntake: 'PENDING', ...p,
});

const ds = (registros: RegistroFonte[]): RadarDataset => ({ ...radarVazio(), registrosFonte: registros });

const FONTE = readFileSync('src/data/radar.supabase.ts', 'utf8');

// ---------------------------------------------------------------------------------------------------------
// entity_id polimorfico
// ---------------------------------------------------------------------------------------------------------
describe('LE-2A · entity_id segue o record_type', () => {
  const casos: [TipoRegistroFonte, ChaveRadar][] = [['empresa', 'empresas'], ['contato', 'contatos'], ['projeto', 'projetos'], ['sinal', 'sinais']];

  it.each(casos)('tipo %s resolve a entidade em %s', (tipo, colecao) => {
    const visto = { chaves: [] as ChaveRadar[] };
    const row = linhaDb('registrosFonte', registro({ id: 'SR-1', tipo, entidadeId: 'ENT-1' }), refDe(visto), helpers());
    expect(row.entity_id).toBe('ENT-1');
    expect(visto.chaves).toContain(colecao);
  });

  it('nao chuta colecao: o tipo escolhe UMA, nunca varre as outras', () => {
    for (const [tipo, colecao] of casos) {
      const visto = { chaves: [] as ChaveRadar[] };
      linhaDb('registrosFonte', registro({ id: 'SR-1', tipo, entidadeId: 'ENT-1' }), refDe(visto), helpers());
      const consultadas = visto.chaves.filter((c) => (['empresas', 'contatos', 'projetos', 'sinais'] as ChaveRadar[]).includes(c));
      expect(consultadas, `tipo ${tipo}`).toEqual([colecao]);
    }
    // e a tabela de colecao cobre exatamente os quatro tipos de RegistroFonte
    expect(Object.keys(COLECAO_DO_REGISTRO).sort()).toEqual(['contato', 'empresa', 'projeto', 'sinal']);
  });

  it('sem entidade ligada, entity_id vai nulo', () => {
    const row = linhaDb('registrosFonte', registro({ id: 'SR-1', tipo: 'projeto' }), refDe({ chaves: [] }), helpers());
    expect(row.entity_id).toBeNull();
  });

  it('o mapeamento antigo (empresas ?? contatos) nao existe mais NA SPEC do staging', () => {
    // a guarda e da linha de `radar_source_record`: `radar_import_row` tem o proprio `entity_id` e nao e
    // assunto do LE-2A — varrer o arquivo inteiro acusaria a spec da importacao CSV por engano
    const linha = FONTE.split('\n').find((l) => l.includes("tabela: 'radar_source_record'"))!;
    expect(linha).not.toContain("ref('empresas', o.entidadeId) ?? ref('contatos', o.entidadeId)");
    expect(linha).toContain('COLECAO_DO_REGISTRO');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------------------------------------
describe('LE-2A · round-trip RadarDataset -> linha DB -> linha app', () => {
  const completo = (tipo: TipoRegistroFonte): RegistroFonte => registro({
    id: 'SR-1', tipo, entidadeId: 'ENT-1', statusIntake: 'RESOLVED',
    decididoEm: AGORA, decididoPor: 'U-1', motivoDecisao: 'promovido na revisão',
  });

  it.each(['empresa', 'contato', 'projeto', 'sinal'] as TipoRegistroFonte[])('preserva tudo no tipo %s', (tipo) => {
    const original = completo(tipo);
    const row = linhaDb('registrosFonte', original, refDe({ chaves: [] }), helpers());
    // o app nao le o proprio id da linha de negocio: o provider devolve o id do banco, entao injetamos
    const volta = linhaApp('registrosFonte', { ...row, id: original.id, decided_by: original.decididoPor }) as RegistroFonte;
    expect(volta.tipo).toBe(original.tipo);
    expect(volta.externoId).toBe(original.externoId);
    expect(volta.payload).toEqual(original.payload);
    expect(volta.entidadeId).toBe(original.entidadeId);
    expect(volta.recebidoEm).toBe(original.recebidoEm);
    expect(volta.payloadFingerprint).toBe(original.payloadFingerprint);
    expect(volta.statusIntake).toBe(original.statusIntake);
    expect(volta.decididoEm).toBe(original.decididoEm);
    expect(volta.decididoPor).toBe(original.decididoPor);
    expect(volta.motivoDecisao).toBe(original.motivoDecisao);
  });

  it('registro legado (sem statusIntake) volta sem inventar estado', () => {
    const legado = registro({ id: 'SR-velho', tipo: 'empresa', statusIntake: undefined, payloadFingerprint: undefined });
    const row = linhaDb('registrosFonte', legado, refDe({ chaves: [] }), helpers());
    expect(row.intake_status).toBeNull();
    expect(row.payload_fingerprint).toBeNull();
    const volta = linhaApp('registrosFonte', { ...row, id: legado.id }) as RegistroFonte;
    expect(volta.statusIntake).toBeUndefined();
    expect(volta.payloadFingerprint).toBeUndefined();
    expect(volta.payload).toEqual(legado.payload);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Transicoes persistidas
// ---------------------------------------------------------------------------------------------------------
describe('LE-2A · a decisao chega ao banco', () => {
  const transicao = async (de: RegistroFonte, para: RegistroFonte) => {
    const h = helpers({ radar_source_record: [{ ...linhaDb('registrosFonte', de, refDe({ chaves: [] }), helpers()), id: de.id }] });
    const antes = await carregarRadar(h);
    await persistirRadar(h, antes, ds([para]));
    return h.chamadas.filter((c) => c.tabela === 'radar_source_record');
  };

  it('T1 · PENDING -> REVIEW vira UPDATE, sem tocar no bruto', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    const c = await transicao(de, { ...de, statusIntake: 'REVIEW' });
    expect(c).toHaveLength(1);
    expect(c[0].op).toBe('gravar');
    expect(c[0].filtro).toEqual({ id: 'SR-1' });
    expect(c[0].row!.intake_status).toBe('REVIEW');
    expect(c[0].row!.payload).toEqual(de.payload);
    expect(c[0].row!.external_id).toBe(de.externoId);
    expect(c[0].row!.payload_fingerprint).toBe(de.payloadFingerprint);
    expect(c[0].row!.received_at).toBe(de.recebidoEm);
  });

  it('T2 · PENDING -> RESOLVED com entidade de empresa', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    const c = await transicao(de, { ...de, statusIntake: 'RESOLVED', entidadeId: 'EMP-1', decididoEm: AGORA, decididoPor: 'U-1' });
    expect(c[0].row!.intake_status).toBe('RESOLVED');
    expect(c[0].row!.entity_id).toBe('EMP-1');
    expect(c[0].row!.decided_at).toBe(AGORA);
    expect(c[0].row!.decided_by).toBe('perfil-U-1');
  });

  it('T3 · REVIEW -> RESOLVED com entidade de projeto', async () => {
    const de = registro({ id: 'SR-1', tipo: 'projeto', statusIntake: 'REVIEW' });
    const c = await transicao(de, { ...de, statusIntake: 'RESOLVED', entidadeId: 'PRJ-1', decididoEm: AGORA, decididoPor: 'U-1' });
    expect(c[0].row!.intake_status).toBe('RESOLVED');
    expect(c[0].row!.entity_id).toBe('PRJ-1');
    expect(c[0].row!.record_type).toBe('projeto');
  });

  it('T4 · PENDING -> RESOLVED com entidade de sinal', async () => {
    const de = registro({ id: 'SR-1', tipo: 'sinal' });
    const c = await transicao(de, { ...de, statusIntake: 'RESOLVED', entidadeId: 'SIN-1', decididoEm: AGORA, decididoPor: 'U-1' });
    expect(c[0].row!.intake_status).toBe('RESOLVED');
    expect(c[0].row!.entity_id).toBe('SIN-1');
    expect(c[0].row!.record_type).toBe('sinal');
  });

  it('T5 · PENDING -> REJECTED grava ator, data e motivo, e nao exige entidade', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    const c = await transicao(de, { ...de, statusIntake: 'REJECTED', decididoEm: AGORA, decididoPor: 'U-1', motivoDecisao: 'fora do perfil' });
    expect(c[0].row!.intake_status).toBe('REJECTED');
    expect(c[0].row!.decided_at).toBe(AGORA);
    expect(c[0].row!.decided_by).toBe('perfil-U-1');
    expect(c[0].row!.decision_reason).toBe('fora do perfil');
    expect(c[0].row!.entity_id).toBeNull();
  });

  it('T6 · registro legado sem statusIntake continua persistindo normalmente', async () => {
    const legado = registro({ id: 'SR-velho', tipo: 'empresa', statusIntake: undefined, payloadFingerprint: undefined });
    const c = await transicao(legado, { ...legado, entidadeId: 'EMP-9' });
    expect(c[0].op).toBe('gravar');
    expect(c[0].row!.intake_status).toBeNull();
    expect(c[0].row!.entity_id).toBe('EMP-9');
  });

  it('registro sem mudanca nenhuma nao gera escrita', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    const h = helpers({ radar_source_record: [{ ...linhaDb('registrosFonte', de, refDe({ chaves: [] }), helpers()), id: de.id }] });
    const antes = await carregarRadar(h);
    // o "depois" tem de ser o MESMO objeto que veio do banco: comparar com um objeto montado a mao aqui
    // acusaria diferenca de forma (ordem de chaves), nao de conteudo
    await persistirRadar(h, antes, ds(antes.registrosFonte));
    expect(h.chamadas.filter((c) => c.tabela === 'radar_source_record')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Evidencia bruta e trilha de auditoria
// ---------------------------------------------------------------------------------------------------------
describe('LE-2A · a evidencia bruta continua protegida', () => {
  it('registrosFonte deixou de ser insert-only, e e o UNICO caminho de decisao', () => {
    const linha = FONTE.split('\n').find((l) => l.includes("tabela: 'radar_source_record'"))!;
    expect(linha).not.toContain('imutavel: true');
    // e o motivo esta escrito ao lado, para ninguem "consertar" de volta sem ler
    expect(FONTE).toContain('radar_source_record_evidencia');
  });

  it('SOURCE RECORD DELETE BY ORDINARY DATASET DIFF = FORBIDDEN', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    const h = helpers({ radar_source_record: [{ ...linhaDb('registrosFonte', de, refDe({ chaves: [] }), helpers()), id: de.id }] });
    const antes = await carregarRadar(h);
    expect(antes.registrosFonte).toHaveLength(1);
    // o registro SOME do dataset — o que no ramo imutavel disparava apagar()
    await persistirRadar(h, antes, ds([]));
    expect(h.chamadas.filter((c) => c.op === 'apagar')).toEqual([]);
    expect(h.chamadas.filter((c) => c.tabela === 'radar_source_record')).toEqual([]);
  });

  it('o adapter manda os campos de evidencia sempre iguais aos do registro (o NAO e do banco)', async () => {
    const de = registro({ id: 'SR-1', tipo: 'empresa' });
    // mesmo que alguem monte um registro com bruto diferente, o adapter apenas o transporta:
    // quem RECUSA a alteracao e o trigger do Postgres, provado em scripts/pg-smoke-lead-engine.mjs
    const adulterado = { ...de, payload: { cno: 'OUTRO' }, externoId: 'outro', statusIntake: 'REVIEW' as StatusIntake };
    const row = linhaDb('registrosFonte', adulterado, refDe({ chaves: [] }), helpers());
    expect(row.payload).toEqual({ cno: 'OUTRO' });
    expect(row.external_id).toBe('outro');
    // a suite declara a fronteira em vez de fingir que o TypeScript bloqueia
    const smoke = readFileSync('scripts/pg-smoke-lead-engine.mjs', 'utf8');
    expect(smoke).toContain('radar_source_record_evidencia');
    expect(smoke).toContain('payload');
  });

  it('a migration 0055 continua com trigger e CHECKs intactos', () => {
    const sql = readFileSync('supabase/migrations/0055_lead_engine_intake.sql', 'utf8');
    expect(sql).toContain('create trigger radar_source_record_evidencia');
    expect(sql).toContain('new.payload is distinct from old.payload');
    expect(sql).toContain("check (intake_status is distinct from 'RESOLVED' or entity_id is not null)");
    expect(sql).toContain('(organization_id, source_id, external_id, payload_fingerprint)');
  });
});

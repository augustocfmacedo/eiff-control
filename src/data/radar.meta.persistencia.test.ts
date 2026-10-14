// CD-D3 / E2 — persistência das metas comerciais: leitura tolerante e escrita SÓ pela RPC radar_definir_meta_comercial.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carregarRadar, metaDoBanco, persistirRadar, type HelpersRadar } from './radar.supabase';
import { ACOES_AUDITADAS_PELA_RPC, ACOES_META_RPC } from './supabase';
import { VALOR_MAXIMO_META, radarVazio, type RadarDataset, type VersaoMetaComercial } from '../core/radar';

interface Chamada { op: string; tabela: string; row?: Record<string, unknown> }
function helpers(linhas: Record<string, Record<string, unknown>[]> = {}, falhar: string[] = []): HelpersRadar & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    sel: async (tabela) => { if (falhar.includes(tabela)) throw new Error(`relation "${tabela}" does not exist`); return (linhas[tabela] ?? []) as never; },
    gravar: async (tabela, filtro, row) => { chamadas.push({ op: 'gravar', tabela, row }); return { id: String(filtro.id ?? 'novo') }; },
    gravarComposta: async (tabela) => { chamadas.push({ op: 'gravarComposta', tabela }); },
    inserir: async (tabela, rows) => { chamadas.push({ op: 'inserir', tabela }); return rows.map((_, i) => ({ id: `ins-${i}` })); },
    apagar: async (tabela) => { chamadas.push({ op: 'apagar', tabela }); },
    orgId: 'org-1', atorId: 'perfil-ator', uuid: () => null, perfil: () => null,
    rpc: async (nome, args) => { chamadas.push({ op: 'rpc', tabela: nome, row: args }); return { alterado: true }; },
    motivoDono: () => undefined,
  };
}
const versao = (id: string, mes: string, versao: number, valor: VersaoMetaComercial['valor'], motivo = 'motivo da meta'): VersaoMetaComercial =>
  ({ id, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao, motivo, definidaPor: 'u-adm', definidaEm: '2026-10-13T12:00:00.000Z' });
const com = (metas: VersaoMetaComercial[] | undefined): RadarDataset => ({ ...radarVazio(), metasComerciais: metas });

describe('E2 · leitura', () => {
  it('linha do banco vira versão do motor (mês AAAA-MM, valor como veio, substituída, instante com fuso)', () => {
    const v = metaDoBanco({ id: 'g2', period_month: '2026-10-01', amount: '120000.50', version: 2, supersedes_id: 'g1', reason: 'revisão', created_by: 'p1', created_at: '2026-10-13T12:00:00.123456+00:00' });
    expect(v).toEqual({ id: 'g2', mes: '2026-10', metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor: '120000.50', versao: 2, substituiId: 'g1', motivo: 'revisão', definidaPor: 'p1', definidaEm: '2026-10-13T12:00:00.123456+00:00' });
    expect(metaDoBanco({ id: 'g3', period_month: '2026-10-01', amount: null, version: 3, supersedes_id: 'g2', reason: 'retirada', created_by: 'p1', created_at: 'x' }).valor).toBeNull();
  });

  it('carga com a tabela: lista de versões; banco sem a 0068: indisponível (undefined), e o resto do Radar carrega', async () => {
    const com0068 = await carregarRadar(helpers({ radar_commercial_goal: [{ id: 'g1', period_month: '2026-10-01', amount: '100000.00', version: 1, reason: 'meta', created_by: 'p1', created_at: '2026-10-13T12:00:00Z' }] }));
    expect(com0068.metasComerciais).toHaveLength(1);
    const sem0068 = await carregarRadar(helpers({}, ['radar_commercial_goal']));
    expect(sem0068.metasComerciais).toBeUndefined();
    expect(sem0068.empresas).toEqual([]);
  });
});

describe('E2 · escrita só pela RPC', () => {
  it('cada versão nova vira uma chamada da RPC, em ordem de mês e versão; as já sincronizadas não são reenviadas', async () => {
    const h = helpers();
    await carregarRadar(h);
    const antes = com([versao('g1', '2026-10', 1, '100000.00')]);
    const depois = com([...antes.metasComerciais!, versao('L3', '2026-11', 1, 90000, ' plano '), versao('L2', '2026-10', 3, null, 'suspensa'), versao('L1', '2026-10', 2, 120000.5, 'revisão')]);
    await persistirRadar(h, antes, depois);
    expect(h.chamadas).toEqual([
      { op: 'rpc', tabela: 'radar_definir_meta_comercial', row: { p_mes: '2026-10-01', p_valor: 120000.5, p_motivo: 'revisão' } },
      { op: 'rpc', tabela: 'radar_definir_meta_comercial', row: { p_mes: '2026-10-01', p_valor: null, p_motivo: 'suspensa' } },
      { op: 'rpc', tabela: 'radar_definir_meta_comercial', row: { p_mes: '2026-11-01', p_valor: 90000, p_motivo: 'plano' } },
    ]);
  });

  it('versão sem motivo: falha fechada, nenhuma chamada', async () => {
    const h = helpers();
    await carregarRadar(h);
    await expect(persistirRadar(h, com([]), com([versao('L1', '2026-10', 1, 1, '  ')]))).rejects.toThrow(/sem motivo/);
    expect(h.chamadas.filter((c) => c.op === 'rpc')).toEqual([]);
  });

  it('metas indisponíveis no dataset: nada a gravar', async () => {
    const h = helpers();
    await carregarRadar(h);
    await persistirRadar(h, com(undefined), com(undefined));
    expect(h.chamadas).toEqual([]);
  });

  it('a auditoria do app não reenvia as ações de meta (a RPC audita na mesma transação)', () => {
    expect([...ACOES_META_RPC].sort()).toEqual(['radar_definir_meta_comercial', 'radar_retirar_meta_comercial']);
    for (const a of ACOES_META_RPC) expect(ACOES_AUDITADAS_PELA_RPC.has(a)).toBe(true);
  });

  it('guardas de fonte: radar_commercial_goal fora da escrita genérica; só a RPC grava', () => {
    const fonte = readFileSync('src/data/radar.supabase.ts', 'utf8');
    expect(fonte).not.toMatch(/tabela: 'radar_commercial_goal'/);
    expect(fonte.match(/'radar_commercial_goal'/g)).toHaveLength(1); // só a leitura em carregarRadar
    expect(fonte).toContain("'radar_definir_meta_comercial_intencao'"); // E5-REL-01: com intenção, a RPC idempotente da 0074
    expect(fonte).toContain("['radar_definir_meta_comercial', base]"); // sem intenção (versão antiga guardada offline), a da 0068
    expect(fonte).toContain('await h.rpc(rpc, args);');
    const migration = readFileSync('supabase/migrations/0068_radar_commercial_goal.sql', 'utf8');
    expect(migration).toMatch(/grant select on radar_commercial_goal to authenticated;/);
    expect(migration).not.toMatch(/grant (insert|update|delete|all)[^;]*on radar_commercial_goal/i);
  });

  it('hardening: teto igual ao do motor, search_path seguro e referências qualificadas na RPC', () => {
    const migration = readFileSync('supabase/migrations/0068_radar_commercial_goal.sql', 'utf8');
    const teto = String(VALOR_MAXIMO_META);
    expect(migration).toContain(`amount <= ${teto}`); // CHECK da tabela
    expect(migration).toContain(`p_valor > ${teto}`); // RPC
    expect(migration.match(/set search_path = pg_catalog, pg_temp/g)).toHaveLength(3);
    expect(migration).not.toMatch(/set search_path = public/);
    const rpc = migration.slice(migration.indexOf('create or replace function radar_definir_meta_comercial'), migration.indexOf('end $$;', migration.indexOf('create or replace function radar_definir_meta_comercial')));
    for (const ref of rpc.matchAll(/\b(?:from|into|update|join)\s+([a-z_][\w.]*)/gi)) {
      if (/^[vp]_/.test(ref[1])) continue; // "into v_…" é variável; "extract(day from p_…)" é parâmetro
      expect(ref[1], `referência sem schema: ${ref[0]}`).toMatch(/^(public|auth|pg_catalog)\./);
    }
    expect(rpc).toContain('v_papel public.role_kind;');
    expect(rpc).toContain('public.radar_commercial_goal%rowtype');
  });

  it('o rollback versionado remove exatamente o que a 0068 cria', () => {
    const rb = readFileSync('supabase/rollbacks/0068_radar_commercial_goal.rollback.sql', 'utf8');
    for (const o of ['function if exists public.radar_definir_meta_comercial(date, numeric, text)', 'table if exists public.radar_commercial_goal', 'function if exists public.radar_commercial_goal_imutavel()', 'function if exists public.radar_mes_comercial_de(timestamptz)']) expect(rb).toContain(`drop ${o};`);
    expect(rb.match(/^begin;$/gm)).toHaveLength(1);
    expect(rb.match(/^commit;$/gm)).toHaveLength(1);
    const migration = readFileSync('supabase/migrations/0068_radar_commercial_goal.sql', 'utf8');
    expect([...migration.matchAll(/create (?:or replace )?(function|table) (\w+)/g)].map((m) => m[2]).sort()).toEqual(['radar_commercial_goal', 'radar_commercial_goal_imutavel', 'radar_definir_meta_comercial', 'radar_mes_comercial_de']);
    expect(migration).not.toMatch(/\balter table (?!radar_commercial_goal)/); // não altera objeto existente
  });
});

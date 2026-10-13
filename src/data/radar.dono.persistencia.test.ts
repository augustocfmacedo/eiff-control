// CD-D5.2 — o dono da conta chega ao banco SÓ pela RPC governada radar_definir_dono_conta (migration 0065).
//
// DIVISÃO DE TRABALHO, como em radar.persistencia.test.ts:
//   * AQUI (TypeScript): o que o persistidor faz — a escrita genérica de radar_company nunca leva commercial_owner_id,
//     a mudança de dono vira UMA chamada de RPC com o motivo da auditoria do app, e sem motivo nada é chamado.
//   * NO POSTGRES (scripts/pg-smoke-dono-conta.mjs, PGlite): o que o BANCO recusa — papel, organização, usuário
//     inativo, conta mesclada, motivo, atomicidade da auditoria e UPDATE/INSERT direto da coluna negado.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carregarRadar, linhaDb, persistirRadar, type ChaveRadar, type HelpersRadar } from './radar.supabase';
import { ACOES_DONO_RPC, motivoDonoDaAuditoria } from './supabase';
import { radarVazio, type Empresa, type RadarDataset } from '../core/radar/types';
import type { Auditoria } from '../core/types';

interface Chamada { op: 'gravar' | 'inserir' | 'apagar' | 'rpc'; tabela: string; row?: Record<string, unknown> }

function helpers(linhas: Record<string, Record<string, unknown>[]>, motivos: Record<string, string> = {}): HelpersRadar & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    sel: async (tabela) => (linhas[tabela] ?? []) as never,
    gravar: async (tabela, filtro, row, extra) => { chamadas.push({ op: 'gravar', tabela, row: { ...extra, ...row } }); return { id: (filtro.id as string) ?? `db-${String(row.legal_name)}` }; },
    gravarComposta: async () => {},
    inserir: async (tabela, rows) => { chamadas.push({ op: 'inserir', tabela }); return rows.map((_, i) => ({ id: `ins-${i}` })); },
    apagar: async (tabela) => { chamadas.push({ op: 'apagar', tabela }); },
    orgId: 'org-1',
    atorId: 'perfil-ator',
    uuid: () => null,
    perfil: (u) => (u?.startsWith('u-') ? `perfil-${u}` : null),
    rpc: async (nome, args) => { chamadas.push({ op: 'rpc', tabela: nome, row: args }); return { alterado: true }; },
    motivoDono: (id) => motivos[id],
  };
}

const ref = (_c: ChaveRadar, id?: string) => id ?? null;
const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Empresa ${id} Fictícia`, pais: 'Brasil', observacoes: '', ativo: true, criadoEm: '2026-10-01T00:00:00.000Z', atualizadoEm: '2026-10-01T00:00:00.000Z',
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});
const ds = (empresas: Empresa[]): RadarDataset => ({ ...radarVazio(), empresas });

/** Carrega o "antes" do banco (com o dono lido da coluna) e devolve helpers + dataset. */
async function doBanco(empresas: Empresa[], motivos: Record<string, string> = {}) {
  const linhas = { radar_company: empresas.map((e) => ({ ...linhaDb('empresas', e, ref, helpers({})), id: e.id, legal_name: e.razaoSocial, active: e.ativo, commercial_owner_id: e.commercialOwnerId ?? null })) };
  const h = helpers(linhas, motivos);
  const antes = await carregarRadar(h);
  return { h, antes };
}
const comDono = (antes: RadarDataset, id: string, dono: string | undefined, extra: Partial<Empresa> = {}) =>
  ds(antes.empresas.map((e) => (e.id === id ? { ...e, commercialOwnerId: dono, atualizadoEm: '2026-10-13T10:00:00.000Z', ...extra } : e)));

describe('CD-D5.2 · dono da conta pela RPC governada', () => {
  it('só o dono mudou: nenhuma escrita genérica em radar_company e UMA chamada da RPC com perfil e motivo', async () => {
    const { h, antes } = await doBanco([emp('E1')], { E1: 'redistribuição da carteira' });
    await persistirRadar(h, antes, comDono(antes, 'E1', 'u-ana'));
    expect(h.chamadas).toEqual([{ op: 'rpc', tabela: 'radar_definir_dono_conta', row: { p_empresa: 'E1', p_dono: 'perfil-u-ana', p_motivo: 'redistribuição da carteira' } }]);
  });

  it('troca e remoção também vão só pela RPC (remoção = p_dono null)', async () => {
    const { h, antes } = await doBanco([emp('E1', { commercialOwnerId: 'perfil-u-ana' })], { E1: 'saiu da carteira' });
    expect(antes.empresas[0].commercialOwnerId).toBe('perfil-u-ana'); // lido da coluna
    await persistirRadar(h, antes, comDono(antes, 'E1', undefined));
    expect(h.chamadas).toEqual([{ op: 'rpc', tabela: 'radar_definir_dono_conta', row: { p_empresa: 'E1', p_dono: null, p_motivo: 'saiu da carteira' } }]);
  });

  it('outros campos e dono juntos: escrita genérica SEM commercial_owner_id e, depois, a RPC', async () => {
    const { h, antes } = await doBanco([emp('E1')], { E1: 'conta nova na carteira' });
    await persistirRadar(h, antes, comDono(antes, 'E1', 'u-beto', { observacoes: 'editada' }));
    expect(h.chamadas.map((c) => c.op)).toEqual(['gravar', 'rpc']);
    expect(h.chamadas[0].row).not.toHaveProperty('commercial_owner_id');
    expect(h.chamadas[0].row!.notes).toBe('editada');
  });

  it('edição comum da empresa nunca leva a coluna nem chama a RPC', async () => {
    const { h, antes } = await doBanco([emp('E1', { commercialOwnerId: 'perfil-u-ana' })]);
    await persistirRadar(h, antes, ds(antes.empresas.map((e) => ({ ...e, observacoes: 'só observação' }))));
    expect(h.chamadas.map((c) => c.op)).toEqual(['gravar']);
    expect(h.chamadas[0].row).not.toHaveProperty('commercial_owner_id');
  });

  it('falha fechada: mudança de dono sem motivo na auditoria não chama a RPC e a sincronização para com erro', async () => {
    const { h, antes } = await doBanco([emp('E1')]);
    await expect(persistirRadar(h, antes, comDono(antes, 'E1', 'u-ana'))).rejects.toThrow(/motivo/);
    expect(h.chamadas.filter((c) => c.op === 'rpc')).toEqual([]);
  });

  it('id sem tradução para perfil vai cru e o banco recusa (nunca vira remoção em silêncio)', async () => {
    const { h, antes } = await doBanco([emp('E1')], { E1: 'teste de id cru' });
    await persistirRadar(h, antes, comDono(antes, 'E1', 'x-desconhecido'));
    expect(h.chamadas[0].row).toMatchObject({ p_dono: 'x-desconhecido' });
  });

  it('empresa nova sem dono: só a inserção, sem RPC', async () => {
    const { h, antes } = await doBanco([]);
    await persistirRadar(h, antes, ds([emp('NOVA-1')]));
    expect(h.chamadas.map((c) => `${c.op}:${c.tabela}`)).toEqual(['gravar:radar_company']);
    expect(h.chamadas[0].row).not.toHaveProperty('commercial_owner_id');
  });

  it('empresa nova com dono e motivo: RPC depois da inserção, apontando para o id gravado', async () => {
    const { h, antes } = await doBanco([], { 'NOVA-2': 'dono definido na criação' });
    await persistirRadar(h, antes, ds([emp('NOVA-2', { commercialOwnerId: 'u-ana' })]));
    expect(h.chamadas.map((c) => c.op)).toEqual(['gravar', 'rpc']);
    expect(h.chamadas[0].row).not.toHaveProperty('commercial_owner_id');
    expect(h.chamadas[1].row).toEqual({ p_empresa: 'db-Empresa NOVA-2 Fictícia', p_dono: 'perfil-u-ana', p_motivo: 'dono definido na criação' });
  });

  it('dono igual ao do banco: nada a gravar', async () => {
    const { h, antes } = await doBanco([emp('E1', { commercialOwnerId: 'perfil-u-ana' })], { E1: 'x' });
    await persistirRadar(h, antes, comDono(antes, 'E1', 'perfil-u-ana'));
    expect(h.chamadas).toEqual([]);
  });
});

describe('CD-D5.2 · auditoria do app não duplica a da RPC', () => {
  const aud = (id: string, acao: string, entidadeId: string, ts: string, motivo?: string): Auditoria => ({ id, ts, usuario: 'u-admin', acao, entidade: 'radar_empresa', entidadeId, motivo });

  it('as duas ações de dono são as que a RPC audita', () => {
    expect([...ACOES_DONO_RPC].sort()).toEqual(['radar_definir_dono_conta', 'radar_remover_dono_conta']);
  });

  it('motivo = o da mudança de dono mais recente da empresa no lote (fila offline colapsa no estado final)', () => {
    const lote = [
      aud('a1', 'radar_definir_dono_conta', 'E1', '2026-10-13T10:00:00.000Z', 'primeira'),
      aud('a2', 'radar_alterar_empresa', 'E1', '2026-10-13T10:05:00.000Z', 'outra ação'),
      aud('a3', 'radar_remover_dono_conta', 'E1', '2026-10-13T10:10:00.000Z', '  a última  '),
      aud('a4', 'radar_definir_dono_conta', 'E2', '2026-10-13T10:20:00.000Z', 'de outra empresa'),
    ];
    expect(motivoDonoDaAuditoria(lote, 'E1')).toBe('a última');
    expect(motivoDonoDaAuditoria(lote, 'E2')).toBe('de outra empresa');
    expect(motivoDonoDaAuditoria(lote, 'E3')).toBeUndefined();
    expect(motivoDonoDaAuditoria([aud('b1', 'radar_definir_dono_conta', 'E1', '2026-10-13T10:00:00.000Z', '   ')], 'E1')).toBeUndefined();
  });
});

describe('CD-D5.2 · guardas de fonte', () => {
  const fonte = (f: string) => readFileSync(f, 'utf8');

  it('commercial_owner_id só é LIDO no app (mapeamento de leitura); nenhuma escrita direta da coluna', () => {
    const radarSb = fonte('src/data/radar.supabase.ts');
    const usos = radarSb.split('\n').flatMap((l) => [...l.matchAll(/(\S*)commercial_owner_id(\S*)/g)].map((m) => m[0]));
    // a única ocorrência fora de comentário é a leitura x.commercial_owner_id
    expect(usos.filter((u) => !u.startsWith('/*') && !u.startsWith('*') && u.includes('x.commercial_owner_id'))).toHaveLength(1);
    expect(radarSb).not.toMatch(/commercial_owner_id\s*:/);
    expect(fonte('src/data/supabase.ts')).not.toContain('commercial_owner_id');
    expect(fonte('src/data/store.ts')).not.toContain('commercial_owner_id');
  });

  it('a mudança de dono vai pela RPC; a auditoria do app pula as ações que a RPC já audita', () => {
    expect(fonte('src/data/radar.supabase.ts')).toContain("h.rpc('radar_definir_dono_conta'");
    const sb = fonte('src/data/supabase.ts');
    expect(sb).toContain('novas.filter((a) => !ACOES_DONO_RPC.has(a.acao))');
    expect(sb).toContain('motivoDono: (empresaId) => motivoDonoDaAuditoria(novas, empresaId)');
  });
});

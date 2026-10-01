// CD-D5 — Dono da conta: funções puras, medida base.contasSemDono (CD-1.2), mapeamento da coluna e caminhos de
// escrita que NUNCA tocam o dono (importação/adapters/Lead Engine via upsertEmpresa).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contasSemDonoValido, donoValido, entraEmMetricaIndividual, estadoDonoConta, motivosRecusaDono, type UsuarioDono } from './donoConta';
import { snapshotComercialCD, VERSAO_REGRAS_CD } from './commercialDirector';
import { AMOSTRA_MINIMA_TAXA } from './commercialMetrics';
import { upsertEmpresa, type Ids } from './ingestao';
import { CONFIG_SCORE_PADRAO, FONTES_PADRAO, REGRAS_PADRAO, RESPOSTAS_PADRAO } from './padroes';
import { radarVazio, type Empresa, type RadarDataset } from './types';
import { linhaApp, linhaDb } from '../../data/radar.supabase';

const HOJE = '2026-09-30';
const AGORA = '2026-09-30T12:00:00.000Z';
const USUARIOS: UsuarioDono[] = [{ id: 'u-ana', ativo: true }, { id: 'u-beto', ativo: true }, { id: 'u-ivo', ativo: false }];
const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({
  id, razaoSocial: `Empresa ${id}`, pais: 'Brasil', observacoes: '', ativo: true, criadoEm: AGORA, atualizadoEm: AGORA,
  fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D', ...p,
});
const base = (empresas: Empresa[]): RadarDataset => ({ ...radarVazio(), fontes: FONTES_PADRAO, regrasScore: REGRAS_PADRAO, configScore: CONFIG_SCORE_PADRAO, tiposResposta: RESPOSTAS_PADRAO, empresas });

describe('CD-D5 · estado do dono (puro)', () => {
  it('SEM_DONO, COM_DONO e DONO_INATIVO; dono válido só quando ativo', () => {
    expect(estadoDonoConta(emp('a'), USUARIOS)).toBe('SEM_DONO');
    expect(estadoDonoConta(emp('a', { commercialOwnerId: '  ' }), USUARIOS)).toBe('SEM_DONO');
    expect(estadoDonoConta(emp('a', { commercialOwnerId: 'u-ana' }), USUARIOS)).toBe('COM_DONO');
    expect(estadoDonoConta(emp('a', { commercialOwnerId: 'u-ivo' }), USUARIOS)).toBe('DONO_INATIVO');
    expect(estadoDonoConta(emp('a', { commercialOwnerId: 'u-de-fora' }), USUARIOS)).toBe('DONO_INATIVO'); // não é usuário da organização
    expect(donoValido(emp('a', { commercialOwnerId: 'u-ana' }), USUARIOS)).toBe('u-ana');
    expect(donoValido(emp('a', { commercialOwnerId: 'u-ivo' }), USUARIOS)).toBeUndefined();
    expect(donoValido(emp('a'), USUARIOS)).toBeUndefined();
  });

  it('motivos de recusa: vazio, fora da organização e inativo; ativo da organização passa', () => {
    expect(motivosRecusaDono('', USUARIOS)).toHaveLength(1);
    expect(motivosRecusaDono('u-de-fora', USUARIOS)[0]).toMatch(/mesma organização/);
    expect(motivosRecusaDono('u-ivo', USUARIOS)[0]).toMatch(/ativo/);
    expect(motivosRecusaDono('u-ana', USUARIOS)).toEqual([]);
  });

  it('contas sem dono válido = ativas e não mescladas com SEM_DONO ou DONO_INATIVO, na ordem do dataset', () => {
    const r = base([
      emp('sem'), emp('com', { commercialOwnerId: 'u-ana' }), emp('inativo', { commercialOwnerId: 'u-ivo' }),
      emp('mesclada', { mescladaEm: 'com' }), emp('desativada', { ativo: false }),
    ]);
    expect(contasSemDonoValido(r, USUARIOS).map((e) => e.id)).toEqual(['sem', 'inativo']);
    expect(r.empresas.map((e) => entraEmMetricaIndividual(e, USUARIOS))).toEqual([false, true, false, false, false]);
  });

  it('o módulo é autoridade de atribuição, não regra comercial: sem ordenação, score nem fila', () => {
    const codigo = readFileSync('src/core/radar/donoConta.ts', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(codigo).not.toMatch(/\.sort\(|priorityScore|fitScore|construirCommercialQueue|responsavelId|from '\.\/(commercialMachine|commercialActionPlan|commercialCadence|score)'/);
  });
});

describe('CD-D5 · medida base.contasSemDono no snapshot (CD-1.2)', () => {
  it('versão CD-1.2 e a CD-D4 preservada', () => {
    expect(VERSAO_REGRAS_CD).toBe('CD-1.2');
    expect(AMOSTRA_MINIMA_TAXA).toBe(30);
  });

  it('com a lista de usuários: conta SEM_DONO e DONO_INATIVO, só entre ativas e não mescladas', () => {
    const r = base([emp('sem'), emp('com', { commercialOwnerId: 'u-ana' }), emp('inativo', { commercialOwnerId: 'u-ivo' }), emp('mesclada', { mescladaEm: 'com' })]);
    const s = snapshotComercialCD(r, HOJE, { usuarios: USUARIOS });
    expect(s.base.contasSemDono).toMatchObject({ id: 'base.contasSemDono', estado: 'DISPONIVEL', valor: 2, base: 3, unidade: 'CONTAS' });
    expect(s.versaoRegras).toBe('CD-1.2');
  });

  it('sem a lista de usuários: sem nenhum dono gravado ainda dá para contar; com dono gravado é DADO_INSUFICIENTE', () => {
    expect(snapshotComercialCD(base([emp('a'), emp('b')]), HOJE).base.contasSemDono).toMatchObject({ estado: 'DISPONIVEL', valor: 2 });
    const comDono = snapshotComercialCD(base([emp('a'), emp('b', { commercialOwnerId: 'u-ana' })]), HOJE).base.contasSemDono;
    expect(comDono.estado).toBe('DADO_INSUFICIENTE');
    expect(comDono.valor).toBeUndefined();
  });

  it('o dono não muda nenhuma outra medida do snapshot nem a fila', () => {
    const sem = base([emp('a'), emp('b'), emp('c')]);
    const com = base([emp('a', { commercialOwnerId: 'u-ana' }), emp('b', { commercialOwnerId: 'u-beto' }), emp('c', { commercialOwnerId: 'u-ivo' })]);
    const s1 = snapshotComercialCD(sem, HOJE, { usuarios: USUARIOS });
    const s2 = snapshotComercialCD(com, HOJE, { usuarios: USUARIOS });
    const tirar = (s: typeof s1) => ({ ...s, base: { ...s.base, contasSemDono: null } });
    expect(tirar(s2)).toEqual(tirar(s1));
  });
});

describe('CD-D5 · persistência e caminhos que não tocam o dono', () => {
  const h = { orgId: 'org', atorId: 'perfil-ator', uuid: (v?: string) => v ?? null, perfil: (u?: string) => (u ? `perfil-${u}` : null) };
  const ref = (_: string, id?: string) => id ?? null;

  it('radar_company.commercial_owner_id ida e volta; sem dono vira null; id sem tradução vai cru (o banco recusa)', () => {
    expect(linhaDb('empresas', emp('a', { commercialOwnerId: 'u-ana' }), ref, h as never).commercial_owner_id).toBe('perfil-u-ana');
    expect(linhaDb('empresas', emp('a'), ref, h as never).commercial_owner_id).toBeNull();
    expect(linhaDb('empresas', emp('a', { commercialOwnerId: 'x' }), ref, { ...h, perfil: () => null } as never).commercial_owner_id).toBe('x');
    expect((linhaApp('empresas', { id: 'a', legal_name: 'A', active: true, commercial_owner_id: 'p-1' }) as Empresa).commercialOwnerId).toBe('p-1');
    expect((linhaApp('empresas', { id: 'a', legal_name: 'A', active: true, commercial_owner_id: null }) as Empresa).commercialOwnerId).toBeUndefined();
  });

  it('upsertEmpresa (importação, adapters, Lead Engine) cria sem dono e nunca troca o dono existente, nem sobrescrevendo', () => {
    let n = 0;
    const ids: Ids = { novo: (p) => `${p}-${++n}`, hoje: HOJE, agora: AGORA, usuarioId: 'u-ana' };
    const nova = upsertEmpresa(base([]), { razaoSocial: 'Nova Fictícia', cnpj: '11222333000181' }, undefined, ids, { sobrescrever: true });
    expect(nova.empresa.commercialOwnerId).toBeUndefined();
    const existente = base([emp('e1', { razaoSocial: 'Existente Fictícia', cnpj: '11222333000181', commercialOwnerId: 'u-ana' })]);
    const atualizada = upsertEmpresa(existente, { razaoSocial: 'Outro Nome', cnpj: '11222333000181', cidade: 'Goiânia' }, undefined, ids, { sobrescrever: true });
    expect(atualizada.empresa.commercialOwnerId).toBe('u-ana');
  });
});

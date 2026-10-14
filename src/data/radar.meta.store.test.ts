// CD-D3 / E2 — ação canônica de metas comerciais no store (docs/commercial-director-1.0.md §19.8).
// O banco (RPC radar_definir_meta_comercial) é provado à parte em scripts/pg-smoke-meta-comercial.mjs.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { apurarMetaComercial, mesComercialDe, mesSeguinte, type VersaoMetaComercial } from '../core/radar';

const metas = () => getState().ds.radar.metasComerciais!;
const doMes = (mes: string) => metas().filter((m) => m.mes === mes).sort((a, b) => a.versao - b.versao);
const ultimaAuditoria = () => getState().ds.auditoria[0];
const agoraIso = () => new Date().toISOString();
let atual = '';
let proximo = '';
let anterior = '';

beforeAll(() => {
  actions.trocarUsuario('u-admin');
  actions.restaurarPlanilha();
  atual = mesComercialDe(agoraIso())!;
  proximo = mesSeguinte(atual);
  const [a, m] = atual.split('-').map(Number);
  anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
});
beforeEach(() => actions.trocarUsuario('u-admin'));

describe('E2 · definir, revisar e retirar a meta', () => {
  it('modo local começa sem metas (lista vazia, disponível)', () => {
    expect(metas()).toEqual([]);
  });

  it('Administrador define a meta do mês corrente: versão 1, auditada com motivo', () => {
    const v1 = actions.definirMetaComercialRadar(atual, 100000, ' meta inicial ');
    expect(v1).toMatchObject({ mes: atual, versao: 1, valor: 100000, motivo: 'meta inicial', definidaPor: 'u-admin', metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO' });
    expect(v1.substituiId).toBeUndefined();
    expect(ultimaAuditoria()).toMatchObject({ acao: 'radar_definir_meta_comercial', entidade: 'radar_meta_comercial', entidadeId: v1.id, depois: { mes: atual, versao: 1, valor: 100000 }, motivo: 'meta inicial' });
  });

  it('Diretoria revisa: versão 2 aponta para a 1, que continua intacta', () => {
    const v1 = structuredClone(doMes(atual)[0]);
    actions.trocarUsuario('u-augusto'); // Diretoria
    const v2 = actions.definirMetaComercialRadar(atual, 120000.5, 'revisão da diretoria');
    expect(v2).toMatchObject({ versao: 2, substituiId: v1.id, valor: 120000.5, definidaPor: 'u-augusto' });
    expect(doMes(atual)[0]).toEqual(v1);
    expect(ultimaAuditoria()).toMatchObject({ antes: { versao: 1, valor: 100000 }, depois: { versao: 2, valor: 120000.5 } });
  });

  it('mesmo valor da vigente não cria versão nem auditoria', () => {
    const n = metas().length; const nAud = getState().ds.auditoria.length;
    const r = actions.definirMetaComercialRadar(atual, 120000.5, 'mesmo valor');
    expect(r.versao).toBe(2);
    expect(metas()).toHaveLength(n);
    expect(getState().ds.auditoria).toHaveLength(nAud);
  });

  it('retirar cria a versão 3 com valor nulo; retirar de novo é recusado; redefinir cria a 4', () => {
    const r = actions.definirMetaComercialRadar(atual, null, 'meta suspensa');
    expect(r).toMatchObject({ versao: 3, valor: null });
    expect(ultimaAuditoria().acao).toBe('radar_retirar_meta_comercial');
    expect(() => actions.definirMetaComercialRadar(atual, null, 'de novo')).toThrow(/vigente para retirar/);
    expect(actions.definirMetaComercialRadar(atual, 110000, 'retomada').versao).toBe(4);
    expect(() => actions.definirMetaComercialRadar(mesSeguinte(proximo), null, 'nada para retirar')).toThrow(/vigente para retirar/);
  });

  it('mês futuro aceito; mês passado, valor inválido e motivo curto recusados (sem mudança)', () => {
    expect(actions.definirMetaComercialRadar(proximo, 90000, 'planejamento').versao).toBe(1);
    const n = metas().length; const nAud = getState().ds.auditoria.length;
    expect(() => actions.definirMetaComercialRadar(anterior, 1, 'mês passado')).toThrow(/corrente ou para meses futuros/);
    expect(() => actions.definirMetaComercialRadar(atual, 0, 'zero')).toThrow(/positiva/);
    expect(() => actions.definirMetaComercialRadar(atual, -5, 'negativa')).toThrow(/positiva/);
    expect(() => actions.definirMetaComercialRadar(atual, 1.005, 'três casas')).toThrow(/2 casas/);
    expect(() => actions.definirMetaComercialRadar(atual, 1, 'ab')).toThrow(/motivo/);
    expect(() => actions.definirMetaComercialRadar('2026-13', 1, 'mês ruim')).toThrow(RegraDeNegocioError);
    expect(metas()).toHaveLength(n);
    expect(getState().ds.auditoria).toHaveLength(nAud);
  });

  it('o motor da E1 lê as versões do store: vigente = última', () => {
    const a = apurarMetaComercial({ mes: atual, agora: agoraIso(), eventos: [], metas: metas() });
    expect(a.meta).toMatchObject({ estado: 'VIGENTE', centavos: 11_000_000 });
    expect(a.medidas.meta).toMatchObject({ estado: 'DISPONIVEL', valor: 110000 });
  });
});

describe('E2 · permissões e disponibilidade', () => {
  it('só Administrador e Diretoria (radar_config); os demais papéis são recusados sem mudança', () => {
    const n = metas().length;
    for (const u of ['u-fin', 'u-obra', 'u-eng', 'u-compras', 'u-contab', 'u-audit', 'u-solicitante']) {
      actions.trocarUsuario(u);
      expect(() => actions.definirMetaComercialRadar(proximo, 1, 'tentativa'), u).toThrow(/permiss/i);
    }
    expect(metas()).toHaveLength(n);
  });

  it('banco sem a 0068 (metas indisponíveis): a ação recusa em vez de gravar só no navegador', () => {
    const radar = getState().ds.radar as { metasComerciais?: VersaoMetaComercial[] };
    const guardadas = radar.metasComerciais;
    radar.metasComerciais = undefined;
    try {
      expect(() => actions.definirMetaComercialRadar(proximo, 1, 'sem tabela')).toThrow(/não estão disponíveis/);
    } finally {
      radar.metasComerciais = guardadas;
    }
  });
});

// CD-D3/E5 — salvar a meta só com confirmação do banco (src/data/metaConfirmada.ts) e o caminho real do store.
//
// Orquestrador com portas simuladas (o banco real e a RPC estão provados em scripts/pg-smoke-meta-comercial.mjs): sucesso
// só depois de a versão voltar do banco; recusa do banco recarrega e devolve erro; sem rede = pendente; começar com
// alterações não sincronizadas é recusado; nunca há sucesso falso. Depois, o store em modo local (ação canônica E2).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { definirMetaConfirmada, type PortasMetaConfirmada, type SyncMeta } from './metaConfirmada';
import { actions, getState } from './store';
import { mesComercialDe, mesSeguinte, type VersaoMetaComercial } from '../core/radar';

const versao = (p: Partial<VersaoMetaComercial> = {}): VersaoMetaComercial => ({
  id: 'META-L', mes: '2026-10', metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor: 250000, versao: 1, motivo: 'meta aprovada', definidaPor: 'u1', definidaEm: '2026-10-14T18:00:00Z', ...p,
});

/** Banco simulado: o estado local, a fila de sincronização e o que o banco devolve na recarga. */
function cenario(o: { remoto?: boolean; antes?: SyncMeta; depois?: SyncMeta; recusaLocal?: string; doBanco?: VersaoMetaComercial[]; falhaRecarga?: string; mesmoValor?: boolean } = {}) {
  let locais: VersaoMetaComercial[] = [];
  const chamadas: string[] = [];
  const p: PortasMetaConfirmada = {
    remoto: o.remoto ?? true,
    syncAtual: () => o.antes ?? { status: 'ok' },
    definir: () => {
      chamadas.push('definir');
      if (o.recusaLocal) throw new Error(o.recusaLocal);
      const v = versao();
      if (!o.mesmoValor) locais = [...locais, v];
      return v;
    },
    aguardarSincronizacao: async () => { chamadas.push('aguardar'); return o.depois ?? { status: 'ok' }; },
    recarregar: async () => { chamadas.push('recarregar'); if (o.falhaRecarga) throw new Error(o.falhaRecarga); locais = o.doBanco ?? []; },
    versoesDoMes: () => locais,
  };
  return { p, chamadas, locais: () => locais };
}

describe('E5 · confirmação do banco antes de dizer "salvo"', () => {
  it('sucesso: espera a sincronização, recarrega e devolve a versão PERSISTIDA (número do banco)', async () => {
    const c = cenario({ doBanco: [versao({ id: 'uuid-1', versao: 7, valor: '250000.00' })] });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toEqual({ ok: true, mudou: true, versao: versao({ id: 'uuid-1', versao: 7, valor: '250000.00' }) });
    expect(c.chamadas).toEqual(['definir', 'aguardar', 'recarregar']);
  });

  it('banco recusou (RPC): recarrega (a versão local some) e devolve erro — sem sucesso falso', async () => {
    const c = cenario({ depois: { status: 'erro', msg: 'meta comercial: mês encerrado' }, doBanco: [] });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toEqual({ ok: false, estado: 'nao_confirmada', mensagem: 'O banco não confirmou a meta; nada foi gravado. meta comercial: mês encerrado' });
    expect(c.chamadas).toEqual(['definir', 'aguardar', 'recarregar']);
    expect(c.locais()).toEqual([]);
  });

  it('sem rede: pendente, guardada no aparelho e explicitamente NÃO confirmada', async () => {
    const r = await definirMetaConfirmada(cenario({ depois: { status: 'pendente' } }).p);
    expect(r).toMatchObject({ ok: false, estado: 'pendente' });
    expect((r as { mensagem: string }).mensagem).toMatch(/NÃO foi confirmada/);
  });

  it('a recarga não trouxe a versão (ou trouxe outra): não confirmada', async () => {
    expect(await definirMetaConfirmada(cenario({ doBanco: [] }).p)).toMatchObject({ ok: false, estado: 'nao_confirmada' });
    expect(await definirMetaConfirmada(cenario({ doBanco: [versao({ valor: '1.00' })] }).p)).toMatchObject({ ok: false, estado: 'nao_confirmada' });
    expect(await definirMetaConfirmada(cenario({ doBanco: [versao({ motivo: 'outro motivo' })] }).p)).toMatchObject({ ok: false, estado: 'nao_confirmada' });
    expect(await definirMetaConfirmada(cenario({ falhaRecarga: 'rede caiu' }).p)).toMatchObject({ ok: false, estado: 'nao_confirmada' });
  });

  it('retirada confirmada: valor nulo volta nulo do banco', async () => {
    const c = cenario();
    const locais: VersaoMetaComercial[] = [];
    c.p.versoesDoMes = () => locais;
    c.p.definir = () => { const v = versao({ valor: null, versao: 2 }); locais.push(v); return v; };
    c.p.recarregar = async () => { locais.splice(0, locais.length, versao({ id: 'uuid-2', valor: null, versao: 2 })); };
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: true, versao: { id: 'uuid-2', valor: null, versao: 2 } });
  });

  it('com alterações ainda não confirmadas, não começa (uma falha descartaria trabalho de outra tela)', async () => {
    for (const antes of [{ status: 'erro' as const }, { status: 'pendente' as const }]) {
      const c = cenario({ antes });
      expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: false, estado: 'recusada' });
      expect(c.chamadas).toEqual([]);
    }
  });

  it('sincronização em andamento: espera terminar antes de começar', async () => {
    const c = cenario({ antes: { status: 'enviando' }, doBanco: [versao()] });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: true });
    expect(c.chamadas).toEqual(['aguardar', 'definir', 'aguardar', 'recarregar']);
  });

  it('recusa da ação canônica (validação, permissão): erro, sem sincronizar', async () => {
    const c = cenario({ recusaLocal: 'Informe o motivo (3 a 500 caracteres).' });
    expect(await definirMetaConfirmada(c.p)).toEqual({ ok: false, estado: 'recusada', mensagem: 'Informe o motivo (3 a 500 caracteres).' });
    expect(c.chamadas).toEqual(['definir']);
  });

  it('mesmo valor da vigente: nada a versionar, nada a sincronizar', async () => {
    const c = cenario({ mesmoValor: true });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: true, mudou: false });
    expect(c.chamadas).toEqual(['definir']);
  });

  it('modo local: a ação canônica basta (não há banco a confirmar)', async () => {
    const c = cenario({ remoto: false });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: true, mudou: true });
    expect(c.chamadas).toEqual(['definir']);
  });
});

describe('E5 · caminho real do store (modo local): criar, revisar, retirar e versionar pela ação canônica', () => {
  const metas = () => getState().ds.radar.metasComerciais!;
  let atual = ''; let proximo = ''; let anterior = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    atual = mesComercialDe(new Date().toISOString())!; proximo = mesSeguinte(atual);
    const [a, m] = atual.split('-').map(Number); anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  });
  beforeEach(() => actions.trocarUsuario('u-admin'));
  const doMes = (mes: string) => metas().filter((m) => m.mes === mes).sort((a, b) => a.versao - b.versao);

  it('define (v1), revisa (v2 → v1) e retira (v3, valor nulo): cada passo uma versão nova, auditada', async () => {
    expect(await actions.definirMetaComercialConfirmada(proximo, 100000, 'meta inicial do mês')).toMatchObject({ ok: true, mudou: true, versao: { versao: 1, valor: 100000 } });
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'radar_definir_meta_comercial', motivo: 'meta inicial do mês' });
    expect(await actions.definirMetaComercialConfirmada(proximo, 120000.5, 'revisão aprovada')).toMatchObject({ ok: true, versao: { versao: 2, valor: 120000.5 } });
    expect(await actions.definirMetaComercialConfirmada(proximo, 120000.5, 'mesmo valor')).toMatchObject({ ok: true, mudou: false });
    expect(await actions.definirMetaComercialConfirmada(proximo, null, 'meta suspensa')).toMatchObject({ ok: true, versao: { versao: 3, valor: null } });
    expect(getState().ds.auditoria[0]).toMatchObject({ acao: 'radar_retirar_meta_comercial', motivo: 'meta suspensa' });
    const vs = doMes(proximo);
    expect(vs.map((v) => [v.versao, v.valor, v.substituiId === undefined ? null : vs.find((x) => x.id === v.substituiId)?.versao])).toEqual([[1, 100000, null], [2, 120000.5, 1], [3, null, 2]]);
    // nenhuma versão anterior foi editada
    expect(vs[0]).toMatchObject({ valor: 100000, motivo: 'meta inicial do mês' });
  });

  it('retirar sem meta vigente, mês encerrado, valor inválido e motivo curto: recusados sem mudança', async () => {
    const n = metas().length;
    expect(await actions.definirMetaComercialConfirmada(proximo, null, 'de novo')).toMatchObject({ ok: false, estado: 'recusada', mensagem: 'Não há meta vigente para retirar neste mês.' });
    expect(await actions.definirMetaComercialConfirmada(anterior, 1000, 'mês passado')).toMatchObject({ ok: false, mensagem: 'Meta só pode ser definida para o mês corrente ou para meses futuros.' });
    expect(await actions.definirMetaComercialConfirmada(atual, 0, 'valor zero')).toMatchObject({ ok: false, mensagem: 'Informe uma meta positiva em reais (ou retire a meta).' });
    expect(await actions.definirMetaComercialConfirmada(atual, 10.005, 'três casas')).toMatchObject({ ok: false, mensagem: 'A meta aceita no máximo 2 casas decimais.' });
    expect(await actions.definirMetaComercialConfirmada(atual, 1000, 'x')).toMatchObject({ ok: false, mensagem: 'Informe o motivo (3 a 500 caracteres).' });
    expect(metas()).toHaveLength(n);
  });

  it('somente Administrador e Diretoria: os demais papéis são recusados sem mudança', async () => {
    const n = metas().length;
    actions.trocarUsuario('u-augusto'); // Diretoria
    expect(await actions.definirMetaComercialConfirmada(atual, 5000, 'meta da diretoria')).toMatchObject({ ok: true });
    for (const u of ['u-fin', 'u-obra', 'u-eng', 'u-compras', 'u-contab', 'u-audit']) {
      actions.trocarUsuario(u);
      expect(await actions.definirMetaComercialConfirmada(proximo, 1, 'tentativa'), u).toMatchObject({ ok: false, estado: 'recusada' });
    }
    expect(metas()).toHaveLength(n + 1);
  });

  it('aguardarSincronizacao no modo local devolve o status local', async () => {
    expect((await actions.aguardarSincronizacao()).status).toBe('local');
  });
});

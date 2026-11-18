// CD-D3/E5 — salvar a meta só com confirmação do banco (src/data/metaConfirmada.ts) e o caminho real do store.
//
// Banco simulado com DUAS coisas separadas, como no app: a fila global de sincronização (status ok/erro/pendente) e as
// versões PERSISTIDAS da meta (o que a RPC gravou). A prova é sempre a leitura das persistidas — o status da fila nunca
// basta: outra operação pode falhar depois de a meta ter sido gravada, a meta pode não ter sido gravada com a fila "ok",
// e outra sessão pode mudar a meta. Depois, o store em modo local (ação canônica E2).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { definirMetaConfirmada, type PortasMetaConfirmada, type SyncMeta } from './metaConfirmada';
import { actions, getState } from './store';
import { mesComercialDe, mesSeguinte, type VersaoMetaComercial } from '../core/radar';

const v = (versao: number, valor: VersaoMetaComercial['valor'], motivo: string, id = `uuid-${versao}`): VersaoMetaComercial => ({
  id, mes: '2026-10', metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao, motivo, definidaPor: 'u1', definidaEm: `2026-10-14T18:0${versao}:00Z`,
});

/**
 * `banco`: versões persistidas antes do pedido. `rpc`: o que a RPC da meta faz ao sincronizar ('grava' acrescenta a
 * versão pedida; 'nao_grava' não acrescenta; 'outra_sessao' acrescenta uma versão de outra pessoa ANTES da nossa).
 * `fila`: o status final da fila global (independente do que a RPC fez). `cache`: versões do mês que o app tem.
 */
function cenario(o: { banco?: VersaoMetaComercial[]; cache?: VersaoMetaComercial[]; pedido?: { valor: VersaoMetaComercial['valor']; motivo: string }; rpc?: 'grava' | 'nao_grava' | 'outra_sessao' | 'outra_sessao_depois'; fila?: SyncMeta; antes?: SyncMeta; falhaLeitura?: 'antes' | 'depois'; recusaLocal?: string } = {}) {
  const banco = [...(o.banco ?? [])];
  let cache = [...(o.cache ?? o.banco ?? [])];
  const pedido = o.pedido ?? { valor: 250000, motivo: 'meta aprovada' };
  const chamadas: string[] = [];
  let leituras = 0;
  let definido = false; let enviado = false; // o banco simulado só "executa a RPC" depois da ação, uma vez
  const p: PortasMetaConfirmada = {
    remoto: true,
    syncAtual: () => o.antes ?? { status: 'ok' },
    definir: () => {
      chamadas.push('definir');
      if (o.recusaLocal) throw new Error(o.recusaLocal);
      definido = true;
      const vig = cache.reduce<VersaoMetaComercial | undefined>((u, x) => (!u || x.versao > u.versao ? x : u), undefined);
      if (vig && vig.valor !== null && pedido.valor !== null && Number(vig.valor) === Number(pedido.valor)) return vig; // E2: mesmo valor não versiona (no cache)
      const nova = v(cache.length + 1, pedido.valor, pedido.motivo, 'META-LOCAL');
      cache = [...cache, nova];
      return nova;
    },
    aguardarSincronizacao: async () => {
      chamadas.push('aguardar');
      if (!definido || enviado) return o.fila ?? { status: 'ok' };
      enviado = true;
      const prox = () => banco.reduce((m, x) => Math.max(m, x.versao), 0) + 1;
      if (o.rpc === 'outra_sessao') banco.push(v(prox(), 999, 'outra pessoa'));
      if (o.rpc === undefined || o.rpc === 'grava' || o.rpc === 'outra_sessao' || o.rpc === 'outra_sessao_depois') banco.push(v(prox(), String(pedido.valor === null ? '' : Number(pedido.valor).toFixed(2)) || null, pedido.motivo));
      if (o.rpc === 'outra_sessao_depois') banco.push(v(prox(), '777.00', 'outra pessoa depois'));
      return o.fila ?? { status: 'ok' };
    },
    recarregar: async () => { chamadas.push('recarregar'); cache = [...banco]; },
    versoesDoMes: () => cache,
    lerPersistidas: async () => {
      leituras++; chamadas.push('ler');
      if ((o.falhaLeitura === 'antes' && leituras === 1) || (o.falhaLeitura === 'depois' && leituras === 2)) throw new Error('rede caiu');
      return [...banco];
    },
  };
  return { p, chamadas, banco, cache: () => cache };
}

describe('E5 · a prova é a versão persistida, nunca o status da fila', () => {
  it('RPC da meta gravou e uma operação independente posterior falhou: a meta está CONFIRMADA (com aviso), sem recarga que apagaria a outra alteração', async () => {
    const c = cenario({ rpc: 'grava', fila: { status: 'erro', msg: 'lançamento PAG-0200 alterado por outro usuário' } });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toMatchObject({ ok: true, mudou: true, versao: { id: 'uuid-1', versao: 1, valor: '250000.00' } });
    expect((r as { aviso?: string }).aviso).toMatch(/Outra alteração não foi sincronizada \(lançamento PAG-0200.*a meta está gravada/);
    expect(c.chamadas).toEqual(['ler', 'definir', 'aguardar', 'ler']); // nenhuma recarga com a fila em erro
    expect(c.banco.map((x) => x.versao)).toEqual([1]); // a meta permanece persistida
  });

  it('fila "ok" mas a meta não está no banco: NÃO GRAVADA, comprovado pela leitura (nunca sucesso pela fila)', async () => {
    const r = await definirMetaConfirmada(cenario({ rpc: 'nao_grava', fila: { status: 'ok' } }).p);
    expect(r).toEqual({ ok: false, estado: 'nao_gravada', mensagem: 'Conferido no banco: a meta NÃO foi gravada.' });
  });

  it('fila em erro e a meta não está no banco: não gravada, comprovado, com o erro da sincronização', async () => {
    const c = cenario({ rpc: 'nao_grava', fila: { status: 'erro', msg: 'meta comercial: mês encerrado' } });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toEqual({ ok: false, estado: 'nao_gravada', mensagem: 'Conferido no banco: a meta NÃO foi gravada. Erro da sincronização: meta comercial: mês encerrado' });
    expect(c.chamadas).not.toContain('recarregar'); // a fila em erro fica para "Tentar de novo"/"Descartar" do app
  });

  it('sem leitura do banco depois da sincronização: INDETERMINADO — nunca "nada foi gravado"', async () => {
    for (const fila of [{ status: 'ok' as const }, { status: 'erro' as const, msg: 'x' }]) {
      const r = await definirMetaConfirmada(cenario({ fila, falhaLeitura: 'depois' }).p);
      expect(r).toMatchObject({ ok: false, estado: 'indeterminado' });
      expect((r as { mensagem: string }).mensagem).not.toMatch(/nada foi gravado|NÃO foi gravada/);
      expect((r as { mensagem: string }).mensagem).toMatch(/Recarregue a tela e confira/);
    }
  });

  it('sem leitura do banco ANTES de enviar: recusa sem enviar nada', async () => {
    const c = cenario({ falhaLeitura: 'antes' });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: false, estado: 'recusada' });
    expect(c.chamadas).toEqual(['ler']);
  });

  it('sem rede: pendente, explicitamente NÃO confirmada', async () => {
    const r = await definirMetaConfirmada(cenario({ fila: { status: 'pendente' } }).p);
    expect(r).toMatchObject({ ok: false, estado: 'pendente' });
  });

  it('outra sessão gravou antes da nossa: a nossa versão é confirmada pelo número do banco (v2), não pela local', async () => {
    const r = await definirMetaConfirmada(cenario({ rpc: 'outra_sessao' }).p);
    expect(r).toMatchObject({ ok: true, versao: { versao: 2, motivo: 'meta aprovada' } });
  });

  it('outra sessão mudou DEPOIS da nossa: confirmada, com aviso do que vale agora', async () => {
    const r = await definirMetaConfirmada(cenario({ rpc: 'outra_sessao_depois' }).p);
    expect(r).toMatchObject({ ok: true, versao: { versao: 1 } });
    expect((r as { aviso?: string }).aviso).toMatch(/Outra sessão já mudou a meta depois: vale R\$ 777,00 \(versão 2\)/);
  });

  it('retirada confirmada: valor nulo gravado e lido de volta', async () => {
    const r = await definirMetaConfirmada(cenario({ banco: [v(1, '250000.00', 'meta aprovada')], pedido: { valor: null, motivo: 'meta suspensa' } }).p);
    expect(r).toMatchObject({ ok: true, mudou: true, versao: { versao: 2, valor: null, motivo: 'meta suspensa' } });
  });
});

describe('E5 · mesmo valor da vigente (sem versão nova) conferido no banco', () => {
  it('cache e banco com o mesmo valor: confirmado sem versão nova (regra da E2), com a versão do banco', async () => {
    const c = cenario({ banco: [v(1, '250000.00', 'meta aprovada')], pedido: { valor: 250000, motivo: 'mesmo valor' } });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toEqual({ ok: true, mudou: false, versao: v(1, '250000.00', 'meta aprovada') });
    expect(c.chamadas).toEqual(['ler', 'definir']); // nada enviado
  });

  it('outra sessão mudou a meta (cache desatualizado): DESATUALIZADA — nada é dado como confirmado; recarrega', async () => {
    const c = cenario({ cache: [v(1, '250000.00', 'meta aprovada')], banco: [v(1, '250000.00', 'meta aprovada'), v(2, '300000.00', 'revisão da outra sessão')], pedido: { valor: 250000, motivo: 'mesmo valor' } });
    const r = await definirMetaConfirmada(c.p);
    expect(r).toEqual({ ok: false, estado: 'desatualizada', mensagem: 'A meta mudou em outra sessão: no banco está R$ 300.000,00 (versão 2). Confira e tente de novo.' });
    expect(c.chamadas).toEqual(['ler', 'recarregar']); // detectado antes de chamar a ação: nada é enviado
    expect(c.cache().map((x) => x.versao)).toEqual([1, 2]);
  });

  it('outra sessão retirou a meta: desatualizada, com "meta retirada"', async () => {
    const c = cenario({ cache: [v(1, '250000.00', 'meta aprovada')], banco: [v(1, '250000.00', 'meta aprovada'), v(2, null, 'retirada pela outra sessão')], pedido: { valor: 250000, motivo: 'mesmo valor' } });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: false, estado: 'desatualizada', mensagem: 'A meta mudou em outra sessão: no banco está meta retirada (versão 2). Confira e tente de novo.' });
  });
});

describe('E5 · pré-condições e recusas', () => {
  it('com alterações ainda não confirmadas, não começa', async () => {
    for (const antes of [{ status: 'erro' as const }, { status: 'pendente' as const }]) {
      const c = cenario({ antes });
      expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: false, estado: 'recusada' });
      expect(c.chamadas).toEqual([]);
    }
  });

  it('sincronização em andamento: espera terminar antes de começar', async () => {
    const c = cenario({ antes: { status: 'enviando' } });
    expect(await definirMetaConfirmada(c.p)).toMatchObject({ ok: true });
    expect(c.chamadas).toEqual(['aguardar', 'ler', 'definir', 'aguardar', 'ler', 'recarregar']);
  });

  it('recusa da ação canônica (validação, permissão): erro, nada enviado', async () => {
    const c = cenario({ recusaLocal: 'Informe o motivo (3 a 500 caracteres).' });
    expect(await definirMetaConfirmada(c.p)).toEqual({ ok: false, estado: 'recusada', mensagem: 'Informe o motivo (3 a 500 caracteres).' });
    expect(c.chamadas).toEqual(['ler', 'definir']);
  });

  it('modo local: a ação canônica basta (não há banco a conferir)', async () => {
    const c = cenario();
    c.p.remoto = false;
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

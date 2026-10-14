// Widgets do iPad — visão pedidos: leitura de centralDF (a mesma da Central e da Caixa), nada recalculado.
import { describe, expect, it } from 'vitest';
import { centralDF } from './cfo';
import { MAX_PENDENTES_WIDGET, orientacaoCurta, resumoWidgetPedidos } from './widgetPedidos';
import type { Dataset, Lancamento } from './types';
import { actions, getState } from '../data/store';

const HOJE = '2026-10-14';
const AGORA = new Date('2026-10-14T12:00:00Z');
function base(): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const ds = getState().ds;
  const conta = { ...ds.contas[0], ativa: true, saldoInicial: 50000, saldoInicialData: '2026-10-13', reservaVinculada: 0 };
  return { ...ds, lancamentos: [], liquidacoes: [], transacoes: [], aprovacoes: [], contas: [conta], params: { ...ds.params, dataBase: HOJE, dataBaseAutomatica: false, corteExtrato: '2026-10-13', reservaMinima: 20000 } };
}
let n = 0;
function pedido(ds: Dataset, p: Partial<Lancamento> & { valorBruto: number; vencimento: string }): Lancamento {
  n += 1;
  return { id: `PED-${String(n).padStart(4, '0')}`, registro: 'Real', categoria: 'Outros pagamentos', subcategoria: '', centroCusto: 'Administrativo', codigoObra: '', contraparte: 'Fornecedor X', documento: '', descricao: `pedido ${n}`, competencia: p.vencimento, status: 'Rascunho', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: ds.contas[0].instituicao, retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [], origem: 'diretor-financeiro', criadoEm: `${HOJE}T10:00:00Z`, criadoPor: 'Tiago', atualizadoEm: `${HOJE}T10:00:00Z`, atualizadoPor: 'Tiago', versao: 1, ...p };
}

describe('widget de pedidos = Central do Diretor', () => {
  let ds = base();
  ds = { ...ds, lancamentos: [
    pedido(ds, { valorBruto: 500, vencimento: '2026-10-16', descricao: 'Frete da obra', contraparte: 'Transportadora Teste', criadoPor: 'Tiago' }),
    pedido(ds, { valorBruto: 200000, vencimento: '2026-10-15', descricao: 'Compra grande de aço', criadoPor: 'Yuri', criadoEm: '2026-10-11T09:00:00Z' }),
    pedido(ds, { valorBruto: 180, vencimento: '2026-10-14', descricao: 'Vale combustível', criadoPor: 'Tiago' }),
    pedido(ds, { valorBruto: 900, vencimento: '2026-10-20', status: 'Programado', descricao: 'Já decidido', criadoPor: 'Yuri', atualizadoEm: '2026-10-13T15:00:00Z' }),
    pedido(ds, { valorBruto: 70, vencimento: '2026-10-20', origem: 'caixa', descricao: 'Rascunho que não é pedido' }),
  ] };
  const r = resumoWidgetPedidos(ds, AGORA);
  const c = centralDF(ds, 3);

  it('só os pedidos do Diretor ainda em rascunho, pelo vencimento (o mais urgente antes)', () => {
    expect(r.visao).toBe('pedidos');
    expect(r.hoje).toBe(HOJE);
    expect(r.pendentes.map((p) => p.descricao)).toEqual(['Vale combustível', 'Compra grande de aço', 'Frete da obra']);
    expect(r.totalPendentes).toBe(3);
    expect(r.valorPendente).toBe(200680);
  });

  it('orientação de cada pedido é a da Central; a contagem bate', () => {
    for (const p of r.pendentes) {
      const o = c.orientacoes.get(p.id)!;
      expect(p.acao).toBe(o.acaoSugerida);
      expect(p.orientacao).toBe(orientacaoCurta(o.acaoSugerida, p.vencimento, o.dataSugerida));
    }
    expect(r.contagem).toEqual(c.contagem);
    expect(r.pendentes.find((p) => p.descricao === 'Compra grande de aço')!.acao).not.toBe('programar'); // não cabe no caixa
    expect(r.pendentes.find((p) => p.descricao === 'Vale combustível')!.acao).toBe('programar');
  });

  it('quem pediu, há quantos dias e "novo" para o pedido de hoje', () => {
    const aco = r.pendentes.find((p) => p.descricao === 'Compra grande de aço')!;
    expect([aco.solicitante, aco.diasEsperando, aco.novo]).toEqual(['Yuri', 3, false]);
    const frete = r.pendentes.find((p) => p.descricao === 'Frete da obra')!;
    expect([frete.solicitante, frete.para, frete.novo, frete.valor]).toEqual(['Tiago', 'Transportadora Teste', true, 500]);
  });

  it('decididos dos últimos dias, com o status que o solicitante vê', () => {
    expect(r.decididos.map((d) => [d.descricao, d.status])).toEqual([['Já decidido', 'programado']]);
  });

  it('só o que o widget usa', () => {
    expect(Object.keys(r).sort()).toEqual(['contagem', 'decididos', 'geradoEm', 'hoje', 'pendentes', 'totalPendentes', 'valorPendente', 'versao', 'visao']);
    expect(JSON.stringify(r)).not.toContain(ds.contas[0].instituicao);
  });

  it('lista cortada no máximo, total preservado', () => {
    let muitos = base();
    muitos = { ...muitos, lancamentos: Array.from({ length: MAX_PENDENTES_WIDGET + 3 }, (_, i) => pedido(muitos, { valorBruto: 10, vencimento: '2026-10-20', descricao: `p${i}` })) };
    const m = resumoWidgetPedidos(muitos, AGORA);
    expect([m.pendentes.length, m.totalPendentes]).toEqual([MAX_PENDENTES_WIDGET, MAX_PENDENTES_WIDGET + 3]);
  });

  it('orientação curta', () => {
    expect(orientacaoCurta('programar', '2026-10-16')).toBe('programar 16/10');
    expect(orientacaoCurta('reagendar', '2026-10-16', '2026-10-28')).toBe('reagendar p/ 28/10');
    expect(orientacaoCurta('avaliar', '2026-10-16')).toBe('seu aval (reserva)');
    expect(orientacaoCurta('recusar', '2026-10-16')).toBe('não recomendado');
  });
});

// Pagamentos no modo celular: o que entra na lista, cada filtro, os totais, a seleção e o pagamento em lote pelas ações do store.
import { beforeEach, describe, expect, it } from 'vitest';
import { pagamentosCampo, resumoPagamentosCampo, selecaoPagavel } from './pagamentosCampo';
import { addDays } from './engine';
import type { Dataset, Lancamento } from './types';
import { actions, getState } from '../data/store';

const HOJE = '2026-10-14';
let n = 0;
function lanc(ds: Dataset, p: Partial<Lancamento> & { valorBruto: number; vencimento: string }): Lancamento {
  n += 1;
  return { id: `PC-${String(n).padStart(3, '0')}`, registro: 'Real', categoria: 'Outros pagamentos', subcategoria: '', centroCusto: 'Administrativo', codigoObra: '', contraparte: `Fornecedor ${n}`, documento: '', descricao: `conta ${n}`, competencia: p.vencimento, status: 'Programado', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: ds.contas[0].instituicao, retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false, observacoes: '', anexos: [], origem: 'teste', criadoEm: '', criadoPor: '', atualizadoEm: '', atualizadoPor: '', versao: 1, ...p };
}
function cenario(): Dataset {
  actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
  const base = getState().ds;
  const ds: Dataset = { ...base, lancamentos: [], liquidacoes: [], transacoes: [], aprovacoes: [], anexosLancamento: [], contas: [{ ...base.contas[0], ativa: true }], params: { ...base.params, dataBase: HOJE, dataBaseAutomatica: false } };
  const obra = base.obras[0].codigo;
  const ls = [
    lanc(ds, { valorBruto: 300, vencimento: addDays(HOJE, -5), contraparte: 'Enel' }), // atrasado
    lanc(ds, { valorBruto: 1200, vencimento: HOJE, contraparte: 'Imobiliária' }), // hoje
    lanc(ds, { valorBruto: 800, vencimento: addDays(HOJE, 3), contraparte: 'Oficina' }), // semana
    lanc(ds, { valorBruto: 5000, vencimento: addDays(HOJE, 20), contraparte: 'Usina' }), // mais tarde
    lanc(ds, { valorBruto: 450, vencimento: addDays(HOJE, 2), status: 'Rascunho', origem: 'diretor-financeiro', contraparte: 'Frete' }), // aguardando decisão
    lanc(ds, { valorBruto: 999, vencimento: HOJE, faturamentoDireto: true, codigoObra: obra, centroCusto: 'Obra', categoria: 'Outros custos diretos' }), // cliente paga: fora
    lanc(ds, { valorBruto: 777, vencimento: HOJE, status: 'Cancelado' }), // fora
    lanc(ds, { valorBruto: 50, vencimento: HOJE, categoria: 'Outros recebimentos' }), // entrada: fora
    lanc(ds, { valorBruto: 640, vencimento: addDays(HOJE, -1), status: 'Realizado', realizacao: HOJE, valorRealizado: 640, contraparte: 'Pago hoje' }),
  ];
  return { ...ds, lancamentos: ls };
}

describe('pagamentos no modo celular', () => {
  let ds: Dataset;
  beforeEach(() => { ds = cenario(); });

  it('filtros: atrasados, até hoje, 7 dias, todos a pagar, aguardando decisão, pagos; faturamento direto, cancelado e entrada nunca aparecem', () => {
    const nomes = (f: Parameters<typeof pagamentosCampo>[1]) => pagamentosCampo(ds, f, '', HOJE).map((p) => p.l.contraparte);
    expect(nomes('atrasados')).toEqual(['Enel']);
    expect(nomes('hoje')).toEqual(['Enel', 'Imobiliária']);
    expect(nomes('semana')).toEqual(['Enel', 'Imobiliária', 'Oficina']);
    expect(nomes('abertos')).toEqual(['Enel', 'Imobiliária', 'Oficina', 'Usina']);
    expect(nomes('aprovacao')).toEqual(['Frete']);
    expect(nomes('pagos')).toEqual(['Pago hoje']);
    expect(nomes('sem_comprovante')).toEqual(['Pago hoje']);
    const tudo = ['atrasados', 'hoje', 'semana', 'abertos', 'aprovacao', 'pagos'].flatMap((f) => nomes(f as never));
    expect(tudo.some((x) => /Fornecedor/.test(x))).toBe(false); // direto, cancelado e entrada ficam fora
  });

  it('busca por fornecedor/descrição/ID sem acento; atrasado marcado com os dias; rascunho não é pagável', () => {
    expect(pagamentosCampo(ds, 'abertos', 'imobiliaria', HOJE).map((p) => p.l.contraparte)).toEqual(['Imobiliária']);
    const enel = pagamentosCampo(ds, 'atrasados', '', HOJE)[0];
    expect([enel.atrasado, enel.diasAtraso, enel.pagavel]).toEqual([true, 5, true]);
    expect(pagamentosCampo(ds, 'aprovacao', '', HOJE)[0]).toMatchObject({ pagavel: false, motivoNaoPagavel: expect.stringMatching(/Central/) });
  });

  it('totais do topo e contagem dos chips', () => {
    const r = resumoPagamentosCampo(ds, HOJE);
    expect([r.atrasados, r.ateHoje, r.semana]).toEqual([300, 1500, 2300]);
    expect(r.pagosHoje).toEqual({ quantidade: 1, valor: 640 });
    expect(r.contagem).toMatchObject({ atrasados: 1, hoje: 2, semana: 3, abertos: 4, aprovacao: 1, pagos: 1, sem_comprovante: 1 });
  });

  it('comprovante anexado tira o pago do filtro "sem comprovante"', () => {
    const pago = ds.lancamentos.find((l) => l.contraparte === 'Pago hoje')!;
    const com = { ...ds, anexosLancamento: [{ id: 'a', lancamentoId: pago.id, tipo: 'COMPROVANTE' as const, nome: 'c.pdf', mime: 'application/pdf', tamanho: 1, enviadoPor: 'Administrador', enviadoEm: `${HOJE}T10:00:00Z` }] };
    expect(pagamentosCampo(com, 'sem_comprovante', '', HOJE)).toHaveLength(0);
    expect(pagamentosCampo(com, 'pagos', '', HOJE)[0]).toMatchObject({ comprovante: true, documentos: 1 });
  });

  it('seleção soma só o que dá para pagar; o lote paga pelas ações do store (liquidar)', () => {
    const itens = pagamentosCampo(ds, 'semana', '', HOJE);
    const s = selecaoPagavel(itens, new Set(itens.map((p) => p.l.id)));
    expect(s.total).toBe(2300);
    actions.trocarUsuario('u-admin');
    actions.importarJson(JSON.stringify(ds));
    for (const p of s.pagaveis) actions.liquidar(p.l.id, { data: HOJE, valor: p.valor, conta: ds.contas[0].instituicao, documento: 'Celular: pago' });
    const depois = getState().ds;
    expect(pagamentosCampo(depois, 'semana', '', HOJE)).toHaveLength(0);
    expect(pagamentosCampo(depois, 'pagos', '', HOJE).map((p) => p.l.contraparte).sort()).toEqual(['Enel', 'Imobiliária', 'Oficina', 'Pago hoje']);
    expect(resumoPagamentosCampo(depois, HOJE).contagem.sem_comprovante).toBe(4);
  });
});

// Diretor Financeiro virtual: interpretacao do pedido, projecao diaria, parecer, previsao e alinhamento.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from './engine';
import { alinhamentoDoDia, analisarPagamento, catalogoDe, completarPedido, extrairData, extrairValor, interpretacaoDaIa, interpretarPedido, montarPrevisao, previsoesDF, projecaoDiaria, responderDF } from './cfo';
import { RegraDeNegocioError, actions, getState } from '../data/store';

const HOJE = '2026-09-01';
describe('Diretor Financeiro: interpretação do pedido', () => {
  const cat = { hoje: HOJE, categorias: ['Transporte e mobilização', 'Aço e perfis', 'Outros pagamentos', 'Veículos e combustível'], obras: [{ codigo: 'OB-SF-CL-01', nome: 'Smart Fit - Avenida César Lattes' }] };
  it('extrai valores em vários formatos', () => {
    expect(extrairValor('frete de R$ 1.500,00')).toBe(1500);
    expect(extrairValor('uns 500 reais')).toBe(500);
    expect(extrairValor('quinhentos pro frete')).toBe(500);
    expect(extrairValor('2 mil de aço')).toBe(2000);
    expect(extrairValor('1,5 mil')).toBe(1500);
    expect(extrairValor('pagar 750 amanhã')).toBe(750);
    expect(extrairValor('pagar no dia 15/09')).toBeUndefined();
  });
  it('extrai datas relativas a hoje (terça 01/09/2026)', () => {
    expect(extrairData('amanhã', HOJE)).toBe('2026-09-02');
    expect(extrairData('depois de amanhã', HOJE)).toBe('2026-09-03');
    expect(extrairData('na sexta', HOJE)).toBe('2026-09-04');
    expect(extrairData('terça que vem', HOJE)).toBe('2026-09-08');
    expect(extrairData('dia 15', HOJE)).toBe('2026-09-15');
    expect(extrairData('em 15/08', HOJE)).toBe('2027-08-15');
    expect(extrairData('em 3 dias', HOJE)).toBe('2026-09-04');
    expect(extrairData('semana que vem', HOJE)).toBe('2026-09-07');
    expect(extrairData('fim do mês', HOJE)).toBe('2026-09-30');
    expect(extrairData('sem data', HOJE)).toBeUndefined();
  });
  it('classifica intenção, categoria, obra e fornecedor', () => {
    const p = interpretarPedido('Preciso pagar um frete de R$ 500 amanhã para a Transportadora Rápida, obra Smart Fit', cat);
    expect(p).toMatchObject({ intencao: 'pagamento', valor: 500, vencimento: '2026-09-02', categoria: 'Transporte e mobilização', codigoObra: 'OB-SF-CL-01', faltando: [] });
    expect(p.contraparte).toMatch(/Transportadora Rápida/);
    expect(interpretarPedido('como está o caixa hoje?', cat).intencao).toBe('consulta_caixa');
    expect(interpretarPedido('o que vence essa semana?', cat).intencao).toBe('vencimentos');
    expect(interpretarPedido('quais previsões estão pendentes?', cat).intencao).toBe('previsoes');
    expect(interpretarPedido('preciso pagar o combustível do caminhão', cat)).toMatchObject({ intencao: 'pagamento', categoria: 'Veículos e combustível', faltando: ['valor', 'vencimento'] });
    expect(interpretarPedido('bom dia', cat).intencao).toBe('outro');
  });
  it('completa o pedido com a resposta seguinte e normaliza a saída da IA contra o catálogo', () => {
    const p1 = interpretarPedido('preciso pagar o frete da viga', cat);
    const p2 = completarPedido(p1, interpretarPedido('500 reais, sexta', cat));
    expect(p2).toMatchObject({ valor: 500, vencimento: '2026-09-04', categoria: 'Transporte e mobilização', faltando: [] });
    const ia = interpretacaoDaIa({ intencao: 'pagamento', valor: 500, vencimento: '2026-09-02', categoria: 'Categoria Inventada', codigoObra: 'OB-XX', contraparte: ' Zé Fretes ', descricao: 'Frete das vigas' }, cat, 'texto');
    expect(ia).toMatchObject({ intencao: 'pagamento', valor: 500, vencimento: '2026-09-02', categoria: undefined, codigoObra: undefined, contraparte: 'Zé Fretes', descricao: 'Frete das vigas', origem: 'ia', faltando: [] });
    expect(interpretacaoDaIa({ intencao: 'hackear' }, cat, 'x')).toBeNull();
  });
});

describe('Diretor Financeiro: parecer, previsão e alinhamento', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });
  it('projeção diária começa no saldo de abertura e acumula entradas e saídas por dia', () => {
    const ds = getState().ds;
    const proj = projecaoDiaria(ds, addDays(ds.params.dataBase, 5));
    expect(proj).toHaveLength(6); expect(proj[0].data).toBe(ds.params.dataBase);
    for (let i = 1; i < proj.length; i++) expect(proj[i].saldo).toBeCloseTo(proj[i - 1].saldo + proj[i].entradas - proj[i].saidas, 2);
  });
  it('parecer libera quando cabe, reagenda quando aperta e sinaliza alçada acima do limite do gestor', () => {
    actions.salvarParametros({ ...getState().ds.params, reservaMinima: 5000 });
    const ds = getState().ds; const hoje = ds.params.dataBase;
    const proj = projecaoDiaria(ds, addDays(hoje, 40));
    const min30 = Math.min(...proj.filter((d) => d.data >= addDays(hoje, 1) && d.data <= addDays(hoje, 31)).map((d) => d.saldo));
    const folga = min30 - 5000;
    const cabe = analisarPagamento(ds, { valor: Math.max(1, Math.min(Math.floor(folga / 2), ds.params.alcadas.limiteGestorObra - 1)), vencimento: addDays(hoje, 1) });
    expect(cabe.decisao).toBe('liberar'); expect(cabe.precisaAprovacao).toBe(false); expect(cabe.motivos.length).toBeGreaterThan(2);
    const grande = analisarPagamento(ds, { valor: ds.params.alcadas.limiteGestorObra + 1, vencimento: addDays(hoje, 1), codigoObra: ds.obras[0].codigo });
    expect(grande.precisaAprovacao).toBe(true); expect(grande.alcada.length).toBeGreaterThan(0);
    const impossivel = analisarPagamento(ds, { valor: 1e9, vencimento: hoje });
    expect(impossivel.decisao).toBe('nao_recomendado'); expect(impossivel.saldoDepois).toBeLessThan(0);
    const apertado = analisarPagamento(ds, { valor: folga + 1, vencimento: addDays(hoje, 1) });
    expect(['reagendar', 'atencao', 'nao_recomendado']).toContain(apertado.decisao);
    if (apertado.decisao === 'reagendar') expect(apertado.dataSugerida! > addDays(hoje, 1)).toBe(true);
  });
  it('responderDF pede o que falta, e registra a previsão como rascunho de origem diretor-financeiro que entra no alinhamento', () => {
    const ds = getState().ds; const cat = catalogoDe(ds); const hoje = ds.params.dataBase;
    const u = getState().usuario;
    const semData = responderDF(ds, u, interpretarPedido('preciso pagar um frete de 300', cat));
    expect(semData.parecer).toBeUndefined(); expect(semData.texto).toMatch(/para que dia/);
    const pedido = interpretarPedido(`frete de R$ 300 amanhã para Transportadora Teste, obra ${ds.obras[0].codigo}`, cat);
    const r = responderDF(ds, u, pedido);
    expect(r.parecer).toBeDefined(); expect(r.texto).toMatch(/R\$ 300,00/);
    const prev = montarPrevisao(ds, pedido, r.parecer!, r.parecer!.dataSugerida ?? r.parecer!.vencimento);
    expect(prev.categoria).toBe('Transporte e mobilização');
    const l = actions.registrarPrevisaoDF(prev);
    expect(l.status).toBe('Rascunho'); expect(l.origem).toBe('diretor-financeiro'); expect(l.valorBruto).toBe(300); expect(l.vencimento).toBe(addDays(hoje, 1));
    expect(previsoesDF(getState().ds).some((x) => x.id === l.id)).toBe(true);
    const al = alinhamentoDoDia(getState().ds);
    expect(al.previsoes.some((p) => p.lancamento.id === l.id)).toBe(true);
    const dia = al.dias.find((d) => d.data === l.vencimento)!;
    expect(dia.saldoComPrevisoes).toBeCloseTo(dia.saldo - 300, 2);
    // rascunho nao entra no caixa oficial ate ser programado
    expect(projecaoDiaria(getState().ds, l.vencimento).find((d) => d.data === l.vencimento)!.saldo).toBeCloseTo(dia.saldo, 2);
    // decisao da Diretoria: reagendar mantem rascunho; programar vira lancamento oficial; recusar cancela com motivo
    actions.decidirPrevisaoDF(l.id, 'reagendar', { vencimento: addDays(hoje, 3) });
    expect(getState().ds.lancamentos.find((x) => x.id === l.id)).toMatchObject({ status: 'Rascunho', vencimento: addDays(hoje, 3) });
    actions.decidirPrevisaoDF(l.id, 'programar');
    const prog = getState().ds.lancamentos.find((x) => x.id === l.id)!;
    expect(['Programado', 'Pendente']).toContain(prog.status);
    expect(previsoesDF(getState().ds).some((x) => x.id === l.id)).toBe(false);
    expect(() => actions.decidirPrevisaoDF(l.id, 'recusar', { motivo: 'x' })).toThrow(RegraDeNegocioError);
    const l2 = actions.registrarPrevisaoDF({ ...prev, descricao: 'outro frete' });
    actions.decidirPrevisaoDF(l2.id, 'recusar', { motivo: 'sem necessidade' });
    expect(getState().ds.lancamentos.find((x) => x.id === l2.id)?.status).toBe('Cancelado');
    actions.trocarUsuario('u-fin');
    const l3 = actions.registrarPrevisaoDF({ ...prev, descricao: 'frete do financeiro' });
    expect(l3.criadoPor).toBe('Financeiro EIFF');
    actions.trocarUsuario('u-admin');
  });
});

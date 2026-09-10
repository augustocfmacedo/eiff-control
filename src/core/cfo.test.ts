// Diretor Financeiro virtual: interpretacao do pedido, projecao diaria, parecer, previsao e alinhamento.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, calcLancamentos, posicaoBancaria } from './engine';
import { alinhamentoDoDia, analisarPagamento, catalogoDe, centralDF, recebiveisVencidos, saldoBancarioHoje, completarPedido, extrairData, extrairValor, interpretacaoDaIa, interpretarPedido, montarPrevisao, orientacaoDF, previsoesDF, projecaoDiaria, responderDF, statusPedidoDF } from './cfo';
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
  it('projeção diária parte do saldo bancário do extrato; realizados e recebíveis vencidos ficam fora, pagamentos vencidos entram no primeiro dia', () => {
    const ds = getState().ds; const hoje = ds.params.dataBase;
    const lancs = calcLancamentos(ds);
    const banco = posicaoBancaria(ds, lancs).reduce((a, p) => a + p.saldoBancario, 0);
    expect(saldoBancarioHoje(ds)).toBeCloseTo(banco, 2);
    const proj = projecaoDiaria(ds, addDays(hoje, 5));
    expect(proj).toHaveLength(6); expect(proj[0].data).toBe(hoje);
    const dia0 = lancs.filter((l) => l.oficial && !l.direto && l.status !== 'Cancelado' && l.status !== 'Realizado' && !!l.dataCaixa && (l.dataCaixa === hoje || (l.dataCaixa < hoje && l.tipo === 'Saída'))).reduce((s, l) => s + l.valorCaixaProjetado, 0);
    expect(proj[0].saldo).toBeCloseTo(banco + dia0, 2);
    // o recebivel vencido do demo nao entra: o saldo do dia 0 fica abaixo de banco + recebiveis vencidos
    if (recebiveisVencidos(lancs) > 0) expect(proj[0].saldo).toBeLessThan(banco + dia0 + recebiveisVencidos(lancs));
    for (let i = 1; i < proj.length; i++) expect(proj[i].saldo).toBeCloseTo(proj[i - 1].saldo + proj[i].entradas - proj[i].saidas, 2);
  });
  it('parecer libera quando cabe, reagenda quando aperta e sinaliza alçada acima do limite do gestor', () => {
    const ds0 = getState().ds; const hoje = ds0.params.dataBase;
    const proj = projecaoDiaria(ds0, addDays(hoje, 40));
    const min30 = Math.min(...proj.filter((d) => d.data >= addDays(hoje, 1) && d.data <= addDays(hoje, 31)).map((d) => d.saldo));
    // reserva abaixo do menor saldo do periodo: um pagamento pequeno cabe; um do tamanho da folga + 1 nao cabe
    const reserva = Math.max(0, Math.floor(min30) - 1000);
    actions.salvarParametros({ ...ds0.params, reservaMinima: reserva });
    const ds = getState().ds;
    const folga = min30 - reserva;
    // primeira data em que os 30 dias seguintes ficam acima da reserva com folga: um pagamento pequeno cabe nela
    const proj2 = projecaoDiaria(ds, addDays(hoje, 75));
    const minDesde = (d: string) => Math.min(...proj2.filter((x) => x.data >= d && x.data <= addDays(d, 30)).map((x) => x.saldo));
    const dataBoa = proj2.map((x) => x.data).find((d) => d > hoje && minDesde(d) - reserva > 1000);
    expect(dataBoa).toBeDefined();
    const cabe = analisarPagamento(ds, { valor: 500, vencimento: dataBoa });
    expect(cabe.decisao).toBe('liberar'); expect(cabe.precisaAprovacao).toBe(false); expect(cabe.motivos.length).toBeGreaterThan(2);
    expect(cabe.saldoHoje).toBeCloseTo(saldoBancarioHoje(ds), 2);
    const grande = analisarPagamento(ds, { valor: ds.params.alcadas.limiteGestorObra + 1, vencimento: addDays(hoje, 1), codigoObra: ds.obras[0].codigo });
    expect(grande.precisaAprovacao).toBe(true); expect(grande.alcada.length).toBeGreaterThan(0);
    const impossivel = analisarPagamento(ds, { valor: 1e9, vencimento: hoje });
    expect(impossivel.decisao).toBe('nao_recomendado'); expect(impossivel.saldoDepois).toBeLessThan(0);
    const apertado = analisarPagamento(ds, { valor: Math.max(1, Math.floor(folga) + 1), vencimento: addDays(hoje, 1) });
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
    expect(l.status).toBe('Rascunho'); expect(l.origem).toBe('diretor-financeiro'); expect(l.valorBruto).toBe(300); expect(l.vencimento).toBe(r.parecer!.dataSugerida ?? addDays(hoje, 1));
    expect(previsoesDF(getState().ds).some((x) => x.id === l.id)).toBe(true);
    const al = alinhamentoDoDia(getState().ds, 40);
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
  it('equipe não vê saldo nem parecer: só o pedido anotado, o andamento e os motivos; a Diretoria recebe a orientação e o briefing', () => {
    const ds = getState().ds; const cat = catalogoDe(ds); const u = getState().usuario;
    const pedido = interpretarPedido('preciso pagar um frete de R$ 450 amanhã para Fretes Silva', cat);
    const equipe = responderDF(ds, u, pedido, false);
    expect(equipe.parecer).toBeDefined();
    expect(equipe.texto).toMatch(/R\$ 450,00/); expect(equipe.texto).not.toMatch(/saldo|reserva|caixa hoje|R\$ (?!450,00)/i);
    expect(responderDF(ds, u, interpretarPedido('como está o caixa?', cat), false).texto).toMatch(/ficam com a Diretoria/);
    expect(responderDF(ds, u, interpretarPedido('o que vence essa semana?', cat), false).texto).not.toMatch(/R\$/);
    const l = actions.registrarPrevisaoDF(montarPrevisao(ds, pedido, equipe.parecer!, equipe.parecer!.vencimento));
    expect(statusPedidoDF(l)).toBe('aguardando');
    const meus = responderDF(getState().ds, u, interpretarPedido('meus pedidos', cat), false).texto;
    expect(meus).toMatch(/aguardando a Diretoria/); expect(meus).not.toMatch(/saldo|reserva/i);
    const c = centralDF(getState().ds);
    const o = c.orientacoes.get(l.id)!;
    expect(['programar', 'reagendar', 'avaliar', 'recusar']).toContain(o.acaoSugerida);
    expect(o.titulo.length).toBeGreaterThan(5); expect(o.detalhe).toMatch(/R\$/);
    expect(c.briefing).toMatch(/aguardam sua decisão/); expect(c.briefing).toMatch(/Minha orientação/);
    expect(orientacaoDF({ ...equipe.parecer!, decisao: 'reagendar', dataSugerida: '2026-09-10' }).acaoSugerida).toBe('reagendar');
    expect(orientacaoDF({ ...equipe.parecer!, decisao: 'nao_recomendado' }).acaoSugerida).toBe('recusar');
    actions.decidirPrevisaoDF(l.id, 'reagendar', { vencimento: '2026-09-10' });
    expect(statusPedidoDF(getState().ds.lancamentos.find((x) => x.id === l.id)!)).toBe('reagendado');
    actions.decidirPrevisaoDF(l.id, 'recusar', { motivo: 'fornecedor sem nota' });
    const rec = getState().ds.lancamentos.find((x) => x.id === l.id)!;
    expect(statusPedidoDF(rec)).toBe('recusado');
    expect(responderDF(getState().ds, u, interpretarPedido('meus pedidos', cat), false).texto).toMatch(/não aprovado.*fornecedor sem nota/);
    expect(centralDF(getState().ds).decididas.some((d) => d.lancamento.id === l.id && d.status === 'recusado')).toBe(true);
  });
});

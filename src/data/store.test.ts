// Jornadas criticas do MVP (Blueprint secao 9) exercitadas na camada de dados:
// registrar compromisso -> aprovar -> liquidar -> conciliar -> fechar mes; cancelamento e segregacao.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState, inicializar, pode } from './store';
import { calcLancamento, hojeLocal } from '../core/engine';

const u = (id: string) => actions.trocarUsuario(id);

describe('jornada: compromisso de obra acima da alçada', () => {
  let id = '';
  beforeAll(() => { u('u-admin'); actions.restaurarPlanilha(); });

  it('gestor cria compromisso e ele vai para aprovação com etapas por alçada', () => {
    u('u-obra');
    const novo = actions.novoLancamento({ categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', centroCusto: 'Obra', contraparte: 'Gerdau', documento: 'PED-001', descricao: 'Perfis W para estrutura', competencia: '2026-09-05', vencimento: '2026-09-25', valorBruto: 150000 });
    const r = actions.salvarLancamento(novo);
    id = r.lancamento.id;
    expect(id.startsWith('PAG-')).toBe(true);
    expect(r.aprovacaoAberta).toBe(true);
    expect(r.lancamento.status).toBe('Pendente');
    const ap = getState().ds.aprovacoes.find((a) => a.entidadeId === id)!;
    expect(ap.etapas.map((e) => e.papel)).toEqual(['Gestor de obra', 'Financeiro', 'Diretoria']);
    expect(ap.impacto.saldoMinimo13sDepois).toBeCloseTo(-51675.56, 2); // vence na S4, quando ja ha caixa
    // pendente nao entra nas visoes oficiais
    expect(calcLancamento(getState().ds.lancamentos.find((l) => l.id === id)!, getState().ds).valorCaixaProjetado).toBe(0);
  });

  it('solicitante não aprova a própria solicitação', () => {
    const ap = getState().ds.aprovacoes.find((a) => a.entidadeId === id)!;
    expect(() => actions.decidirAprovacao(ap.id, 'Aprovado', '')).toThrow(RegraDeNegocioError);
  });

  it('papel errado não decide a etapa; cadeia Gestor → Financeiro → Diretoria aprova', () => {
    const ap = getState().ds.aprovacoes.find((a) => a.entidadeId === id)!;
    u('u-fin');
    expect(() => actions.decidirAprovacao(ap.id, 'Aprovado', '')).toThrow(/Gestor de obra/);
    u('u-admin'); // administrador pode agir na etapa do gestor (fallback)
    actions.decidirAprovacao(ap.id, 'Aprovado', 'dentro do escopo');
    u('u-fin');
    actions.decidirAprovacao(ap.id, 'Aprovado', 'documento ok');
    expect(getState().ds.aprovacoes.find((a) => a.id === ap.id)!.status).toBe('Pendente');
    u('u-augusto');
    actions.decidirAprovacao(ap.id, 'Aprovado', '');
    expect(getState().ds.aprovacoes.find((a) => a.id === ap.id)!.status).toBe('Aprovado');
    const l = getState().ds.lancamentos.find((x) => x.id === id)!;
    expect(l.status).toBe('Aprovado');
    expect(calcLancamento(l, getState().ds).valorCaixaProjetado).toBeCloseTo(-150000, 2);
  });

  it('alteração relevante após aprovação reabre o fluxo (APR-003)', () => {
    u('u-obra');
    const l = getState().ds.lancamentos.find((x) => x.id === id)!;
    const r = actions.salvarLancamento({ ...l, valorBruto: 180000 });
    expect(r.aprovacaoAberta).toBe(true);
    expect(r.lancamento.status).toBe('Pendente');
    const aps = getState().ds.aprovacoes.filter((a) => a.entidadeId === id);
    expect(aps.filter((a) => a.status === 'Pendente')).toHaveLength(1);
    // aprova de novo pela cadeia
    const ap = aps.find((a) => a.status === 'Pendente')!;
    u('u-admin'); actions.decidirAprovacao(ap.id, 'Aprovado', '');
    u('u-fin'); actions.decidirAprovacao(ap.id, 'Aprovado', '');
    u('u-augusto'); actions.decidirAprovacao(ap.id, 'Aprovado', '');
    expect(getState().ds.lancamentos.find((x) => x.id === id)!.status).toBe('Aprovado');
  });

  it('engenharia não liquida; financeiro liquida parcial e total com evidência', () => {
    u('u-eng');
    expect(pode(getState().usuario, 'liquidar')).toBe(false);
    expect(() => actions.liquidar(id, { data: '2026-09-25', valor: 1000, conta: 'Caixa', documento: 'x' })).toThrow(RegraDeNegocioError);
    u('u-fin');
    expect(() => actions.liquidar(id, { data: '2026-09-25', valor: 100000, conta: 'Caixa', documento: '' })).toThrow(/evidência/);
    let l = actions.liquidar(id, { data: '2026-09-25', valor: 100000, conta: 'Caixa', documento: 'TED 1' });
    expect(l.status).toBe('Aprovado');
    expect(calcLancamento(l, getState().ds).situacao).toBe('Parcialmente liquidado');
    l = actions.liquidar(id, { data: '2026-09-26', valor: 80000, conta: 'Caixa', documento: 'TED 2' });
    expect(l.status).toBe('Realizado');
    expect(l.valorRealizado).toBe(180000);
    expect(l.realizacao).toBe('2026-09-26');
  });

  it('extrato importado deduplica e concilia N:1 com tolerância', () => {
    u('u-fin');
    const linhas = [
      { data: '2026-09-25', historico: 'TED GERDAU PED-001', documento: 'PED-001', debito: 100000, credito: 0 },
      { data: '2026-09-26', historico: 'TED GERDAU PED-001', documento: 'PED-001', debito: 80000, credito: 0 },
      { data: '2026-09-25', historico: 'TED GERDAU PED-001', documento: 'PED-001', debito: 100000, credito: 0 },
    ];
    const r = actions.importarTransacoes('Caixa', linhas);
    expect(r).toEqual({ importadas: 2, duplicadas: 1 });
    const t1 = getState().ds.transacoes[0];
    // 1 transacao de 100k contra titulo de 180k = divergente sem justificativa
    expect(() => actions.conciliar(t1.id, [id])).toThrow(/tolerância/);
    actions.conciliar(t1.id, [id], 'liquidação em duas TEDs');
    expect(getState().ds.lancamentos.find((x) => x.id === id)!.conciliado).toBe(false);
  });

  it('fechamento bloqueia edição retroativa e reabertura exige Diretoria com motivo', () => {
    u('u-fin');
    actions.fecharPeriodo('2026-09');
    u('u-obra');
    const novo = actions.novoLancamento({ categoria: 'Transporte e mobilização', codigoObra: 'OB-SF-CL-01', contraparte: 'Frete', descricao: 'Frete', competencia: '2026-09-10', vencimento: '2026-10-10', valorBruto: 500 });
    expect(() => actions.salvarLancamento(novo)).toThrow(/fechado/);
    u('u-fin');
    expect(() => actions.reabrirPeriodo('2026-09', 'ajuste')).toThrow(RegraDeNegocioError);
    u('u-augusto');
    actions.reabrirPeriodo('2026-09', 'ajuste de competência da NF 47');
    u('u-obra');
    expect(actions.salvarLancamento(novo).lancamento.status).toBe('Programado'); // 500 < limite do gestor
  });

  it('estorno de realizado exige motivo e preserva o registro', () => {
    u('u-fin');
    expect(() => actions.cancelarLancamento(id, '')).toThrow(/Motivo/);
    actions.cancelarLancamento(id, 'pedido cancelado pelo fornecedor');
    const l = getState().ds.lancamentos.find((x) => x.id === id)!;
    expect(l.status).toBe('Cancelado');
    expect(getState().ds.liquidacoes.filter((q) => q.lancamentoId === id)).toHaveLength(0);
    expect(getState().ds.auditoria.some((a) => a.acao === 'estornar_lancamento' && a.entidadeId === id)).toBe(true);
  });
});

describe('edição de datas na grade', () => {
  it('altera competência e vencimento de título aberto e reabre aprovação se aprovado', () => {
    u('u-admin');
    actions.restaurarPlanilha();
    u('u-fin');
    const l = actions.alterarDatas('PAG-FOLHA-2026-10', { vencimento: '2026-10-09', competencia: '2026-10-01' });
    expect(l.vencimento).toBe('2026-10-09');
    expect(l.competencia).toBe('2026-10-01');
    // vencimento e alteracao relevante (APR-003): titulo acima da alcada volta para aprovacao
    expect(l.status).toBe('Pendente');
    expect(getState().ds.aprovacoes.some((a) => a.entidadeId === 'PAG-FOLHA-2026-10' && a.status === 'Pendente')).toBe(true);
    // titulo pequeno dentro da alcada nao exige aprovacao
    const pequeno = actions.salvarLancamento(actions.novoLancamento({ categoria: 'Seguros', contraparte: 'X', descricao: 'pequeno', competencia: '2026-09-15', vencimento: '2026-09-20', valorBruto: 100 })).lancamento;
    expect(actions.alterarDatas(pequeno.id, { vencimento: '2026-09-25' }).status).toBe('Programado');
  });
  it('cancelado não edita; realizado só ajusta realização com papel de liquidar', () => {
    u('u-fin');
    const novo = actions.novoLancamento({ categoria: 'Seguros', contraparte: 'Seguradora', descricao: 'Apólice', competencia: '2026-09-15', vencimento: '2026-09-20', valorBruto: 500 });
    const { lancamento } = actions.salvarLancamento(novo);
    actions.liquidar(lancamento.id, { data: '2026-09-21', valor: 500, conta: 'Caixa', documento: 'PIX 1' });
    u('u-eng');
    expect(() => actions.alterarDatas(lancamento.id, { realizacao: '2026-09-22' })).toThrow(RegraDeNegocioError);
    u('u-fin');
    const l = actions.alterarDatas(lancamento.id, { realizacao: '2026-09-22' });
    expect(l.realizacao).toBe('2026-09-22');
    expect(getState().ds.liquidacoes.find((q) => q.lancamentoId === lancamento.id)!.data).toBe('2026-09-22');
    expect(calcLancamento(l, getState().ds).dataCaixa).toBe('2026-09-22');
    actions.cancelarLancamento(lancamento.id, 'teste');
    expect(() => actions.alterarDatas(lancamento.id, { vencimento: '2026-09-30' })).toThrow(/cancelado/i);
  });
});

describe('extrato OFX: dedup por FITID e lançar a partir da transação', () => {
  it('importa uma vez por FITID mesmo com períodos sobrepostos', () => {
    u('u-admin');
    actions.restaurarPlanilha();
    u('u-fin');
    const linhas = [
      { data: '2026-09-03', historico: 'TARIFA PACOTE SERVICOS', documento: '', debito: 89.9, credito: 0, idExterno: 'F1' },
      { data: '2026-09-03', historico: 'PIX RECEBIDO INVEST MARKET NF 47', documento: 'NF 47', debito: 0, credito: 150076.25, idExterno: 'F2' },
    ];
    expect(actions.importarTransacoes('Caixa', linhas)).toEqual({ importadas: 2, duplicadas: 0 });
    expect(actions.importarTransacoes('Caixa', [...linhas, { data: '2026-09-04', historico: 'IOF', documento: '', debito: 1.5, credito: 0, idExterno: 'F3' }])).toEqual({ importadas: 1, duplicadas: 2 });
    expect(getState().ds.transacoes.find((t) => t.idExterno === 'F1')!.origem).toBe('ofx');
  });
  it('cria lançamento realizado, liquidado e conciliado a partir da tarifa', () => {
    u('u-fin');
    const t = getState().ds.transacoes.find((x) => x.idExterno === 'F1')!;
    expect(() => actions.lancarTransacao(t.id, { categoria: 'Medições de obras', contraparte: 'Banco', descricao: 'x' })).toThrow(/Saída/);
    const l = actions.lancarTransacao(t.id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'Tarifa pacote' });
    expect(l.status).toBe('Realizado');
    expect(l.valorBruto).toBeCloseTo(89.9, 2);
    expect(l.valorRealizado).toBeCloseTo(89.9, 2);
    expect(l.realizacao).toBe('2026-09-03');
    expect(l.conciliado).toBe(true);
    expect(l.origem).toBe('ofx');
    const ds = getState().ds;
    expect(ds.liquidacoes.find((q) => q.lancamentoId === l.id)!.valor).toBeCloseTo(89.9, 2);
    expect(ds.transacoes.find((x) => x.id === t.id)!.lancamentoIds).toEqual([l.id]);
    const calc = calcLancamento(l, ds);
    expect(calc.valorCaixaProjetado).toBeCloseTo(-89.9, 2);
    expect(() => actions.lancarTransacao(t.id, { categoria: 'Juros e tarifas bancárias', contraparte: 'Banco', descricao: 'de novo' })).toThrow(/já conciliada/);
    u('u-eng');
    const t2 = getState().ds.transacoes.find((x) => x.idExterno === 'F2')!;
    expect(() => actions.lancarTransacao(t2.id, { categoria: 'Medições de obras', contraparte: 'Cliente', descricao: 'x', codigoObra: 'OB-SF-CL-01' })).toThrow(RegraDeNegocioError);
  });
});

describe('data-base automática', () => {
  it('avança a data-base para hoje quando ativa e registra na auditoria', async () => {
    u('u-admin');
    actions.restaurarPlanilha();
    u('u-fin');
    expect(getState().ds.params.dataBase).toBe('2026-09-01');
    actions.salvarParametros({ ...getState().ds.params, dataBaseAutomatica: true });
    const hoje = hojeLocal();
    expect(getState().ds.params.dataBase).toBe(hoje);
    expect(getState().ds.auditoria.some((a) => a.acao === 'avancar_data_base')).toBe(hoje !== '2026-09-01');
    await inicializar();
    expect(getState().ds.params.dataBase).toBe(hoje);
    actions.salvarParametros({ ...getState().ds.params, dataBaseAutomatica: false, dataBase: '2026-09-01' });
    await inicializar();
    expect(getState().ds.params.dataBase).toBe('2026-09-01');
  });
});

describe('validações do lançamento', () => {
  it('reproduz as regras da planilha no servidor', () => {
    u('u-fin');
    const base = actions.novoLancamento({ categoria: 'Aço e perfis', contraparte: 'X', descricao: 'sem obra', valorBruto: 10 });
    expect(() => actions.salvarLancamento(base)).toThrow(/Código Obra/);
    expect(() => actions.salvarLancamento({ ...base, codigoObra: 'OB-SF-CL-01', probabilidade: 1.5 })).toThrow(/Probabilidade/);
    expect(() => actions.salvarLancamento({ ...base, codigoObra: 'OB-SF-CL-01', vencimento: '' })).toThrow(/Vencimento/);
    expect(() => actions.salvarLancamento({ ...base, categoria: 'Nada' })).toThrow(/plano de contas/);
  });
  it('auditoria bloqueada para escrita', () => {
    u('u-audit');
    expect(pode(getState().usuario, 'editar_lancamento')).toBe(false);
    expect(pode(getState().usuario, 'ver_bancos')).toBe(true);
    u('u-eng');
    expect(pode(getState().usuario, 'ver_bancos')).toBe(false);
  });
});

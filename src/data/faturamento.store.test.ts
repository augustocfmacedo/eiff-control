// Faturamento do contrato: rateio de um titulo por etapa (uma NF cobre varias) e repasse da nota ao cliente.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';
import { acompanhamentoFaturamento } from '../core/faturamento';

const ds = () => getState().ds;
const acompanhamento = () => {
  const d = ds();
  return acompanhamentoFaturamento({ codigoObra: 'OB-SF-CL-01', servicos: d.servicos, medicoes: d.medicoes, lancamentos: d.lancamentos, rateios: d.rateios, planoContas: d.planoContas });
};

describe('rateio de faturamento por etapa', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('rateia uma entrada entre dois serviços e exige que as somas fechem', () => {
    const entrada = ds().lancamentos.find((l) => l.codigoObra === 'OB-SF-CL-01' && l.documento === 'NF 47')!;
    const [a, b] = ds().servicos.filter((s) => s.codigoObra === 'OB-SF-CL-01');
    expect(() => actions.salvarRateioFaturamento(entrada.id, [{ servicoId: a.id, valor: 1000 }])).toThrow(/somas têm de fechar/);
    const metade = Math.round((entrada.valorBruto / 2) * 100) / 100;
    const novos = actions.salvarRateioFaturamento(entrada.id, [
      { servicoId: a.id, descricao: 'parte A', valor: metade },
      { servicoId: b.id, descricao: 'parte B', valor: entrada.valorBruto - metade },
    ]);
    expect(novos).toHaveLength(2);
    const r = acompanhamento();
    expect(r.etapas.find((e) => e.servicoId === a.id)!.faturadoConstrutora).toBeCloseTo(metade, 2);
    expect(r.etapas.find((e) => e.servicoId === b.id)!.faturadoConstrutora).toBeCloseTo(entrada.valorBruto - metade, 2);
    expect(r.totais.faturadoConstrutora).toBeCloseTo(entrada.valorBruto, 2);
    // regravar substitui o rateio anterior; lista vazia remove
    actions.salvarRateioFaturamento(entrada.id, []);
    expect(ds().rateios.filter((x) => x.lancamentoId === entrada.id)).toHaveLength(0);
    expect(acompanhamento().totais.faturadoConstrutora).toBe(0);
  });

  it('recusa serviço de outra obra e valor não positivo', () => {
    const entrada = ds().lancamentos.find((l) => l.codigoObra === 'OB-SF-CL-01' && l.documento === 'NF 47')!;
    const outro = ds().servicos.find((s) => s.codigoObra !== 'OB-SF-CL-01');
    if (outro) expect(() => actions.salvarRateioFaturamento(entrada.id, [{ servicoId: outro.id, valor: entrada.valorBruto }])).toThrow(RegraDeNegocioError);
    expect(() => actions.salvarRateioFaturamento(entrada.id, [{ servicoId: 'nao-existe', valor: entrada.valorBruto }])).toThrow(/não pertence à obra/);
    expect(() => actions.salvarRateioFaturamento(entrada.id, [{ servicoId: ds().servicos[0].id, valor: -10 }])).toThrow(RegraDeNegocioError);
  });

  it('registra o repasse da nota direta ao cliente e marca o que ainda não foi enviado', () => {
    const servico = ds().servicos.find((s) => s.codigoObra === 'OB-SF-CL-01')!;
    const { lancamento: nota } = actions.salvarLancamento({
      ...actions.novoLancamento(),
      categoria: 'Aço e perfis', codigoObra: 'OB-SF-CL-01', servicoId: servico.id, faturamentoDireto: true,
      contraparte: 'FERREIRA FERRO E AÇO', documento: 'NF 33525', descricao: 'Ferragem da fundação',
      competencia: '2026-09-15', vencimento: '2026-09-30', valorBruto: 16500, status: 'Programado',
    });
    let linha = acompanhamento().etapas.find((e) => e.servicoId === servico.id)!;
    expect(linha.faturadoDireto).toBeCloseTo(16500, 2);
    expect(linha.diretoNaoEnviado).toBeCloseTo(16500, 2);

    actions.marcarEnvioCliente(nota.id, '2026-09-17');
    linha = acompanhamento().etapas.find((e) => e.servicoId === servico.id)!;
    expect(linha.diretoNaoEnviado).toBe(0);
    expect(acompanhamento().notas.find((n) => n.documento === 'NF 33525')!.enviadoClienteEm).toBe('2026-09-17');

    actions.marcarEnvioCliente(nota.id);
    expect(ds().lancamentos.find((l) => l.id === nota.id)!.enviadoClienteEm).toBeUndefined();

    const semDireto = ds().lancamentos.find((l) => l.codigoObra === 'OB-SF-CL-01' && !l.faturamentoDireto)!;
    expect(() => actions.marcarEnvioCliente(semDireto.id, '2026-09-17')).toThrow(/faturamento direto/);
  });
});

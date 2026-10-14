// CD-D3 / E1 — motor de cálculo da meta comercial (docs/commercial-director-1.0.md §19.7).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ALERTA_META, VALOR_MAXIMO_META_CENTAVOS, apurarMetaComercial, ateDuasCasas, fimDoMes, inicioDoMes, lerLivroDesfechos, lerValor, mesComercialDe, metaVigenteDoMes,
  motivosRecusaNovaMeta, proximaVersaoMeta, situacaoDoMes, type EventoDesfecho, type VersaoMetaComercial,
} from './metaComercial';

// ------------------------------------------------------------------------------------------------ construtores
let seq = 0;
const meta = (mes: string, valor: VersaoMetaComercial['valor'], versao: number, definidaEm: string, extra: Partial<VersaoMetaComercial> = {}): VersaoMetaComercial => ({
  id: `META-${mes}-v${versao}${extra.id ? '' : `-${++seq}`}`, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao, motivo: 'definição da diretoria', definidaPor: 'u-adm', definidaEm, ...extra,
});
const ganho = (id: string, opp: string, ocorridoEm: string, valor?: EventoDesfecho['valor']): EventoDesfecho => ({ id, tipo: 'GANHO', oportunidadeId: opp, empresaId: `E-${opp}`, ocorridoEm, ...(valor === undefined ? {} : { valor }) });
const estorno = (id: string, opp: string, ganhoId: string, ocorridoEm: string): EventoDesfecho => ({ id, tipo: 'ESTORNO_GANHO', oportunidadeId: opp, empresaId: `E-${opp}`, ganhoId, ocorridoEm, motivo: 'cliente desistiu' });
const complemento = (id: string, opp: string, ganhoId: string, ocorridoEm: string, valor: EventoDesfecho['valor']): EventoDesfecho => ({ id, tipo: 'COMPLEMENTO_VALOR', oportunidadeId: opp, empresaId: `E-${opp}`, ganhoId, ocorridoEm, valor });
const apurar = (mes: string, agora: string, eventos: EventoDesfecho[], metas: VersaoMetaComercial[] = [meta(mes, '100000.00', 1, `${mes}-01T12:00:00Z`)]) =>
  apurarMetaComercial({ mes, agora, eventos, metas });
const v = (a: ReturnType<typeof apurar>, k: keyof ReturnType<typeof apurar>['medidas']) => a.medidas[k];
const codigos = (a: ReturnType<typeof apurar>) => a.alertas.map((x) => x.codigo);

describe('E1 · mês comercial no fuso de São Paulo', () => {
  it('a virada do mês segue America/Sao_Paulo, não UTC', () => {
    expect(mesComercialDe('2026-10-01T02:59:59Z')).toBe('2026-09'); // 23:59:59 de 30/09 em São Paulo
    expect(mesComercialDe('2026-10-01T03:00:00Z')).toBe('2026-10'); // 00:00 de 01/10 em São Paulo
    expect(mesComercialDe('2026-09-30T23:30:00-03:00')).toBe('2026-09');
    expect(mesComercialDe('2026-10-01T00:30:00+00:00')).toBe('2026-09');
    expect(mesComercialDe('2026-12-31T23:59:59-03:00')).toBe('2026-12');
    expect(mesComercialDe('2027-01-01T02:00:00Z')).toBe('2026-12'); // virada de ano também
  });
  it('data civil e mês são lidos como estão; instante sem fuso ou inválido não vira mês', () => {
    expect(mesComercialDe('2026-10-01')).toBe('2026-10');
    expect(mesComercialDe('2026-10')).toBe('2026-10');
    expect(mesComercialDe('2026-10-01T10:00:00')).toBeUndefined(); // sem fuso: nunca o fuso da máquina
    expect(mesComercialDe('ontem')).toBeUndefined();
    expect(mesComercialDe('2026-13')).toBeUndefined();
  });
  it('limites do mês em UTC: [início, fim) com meia-noite de São Paulo', () => {
    expect(inicioDoMes('2026-10')).toBe('2026-10-01T03:00:00.000Z');
    expect(fimDoMes('2026-10')).toBe('2026-11-01T03:00:00.000Z');
    expect(fimDoMes('2026-12')).toBe('2027-01-01T03:00:00.000Z');
    expect(situacaoDoMes('2026-10', '2026-10-13T12:00:00Z')).toBe('CORRENTE');
    expect(situacaoDoMes('2026-09', '2026-10-01T02:59:59Z')).toBe('CORRENTE'); // ainda 30/09 em São Paulo
    expect(situacaoDoMes('2026-09', '2026-10-01T03:00:00Z')).toBe('ENCERRADO');
    expect(situacaoDoMes('2026-11', '2026-10-13T12:00:00Z')).toBe('FUTURO');
  });
  it('um ganho às 23:30 de 30/09 em São Paulo (02:30 UTC de 01/10) conta em setembro', () => {
    const ev = [ganho('G1', 'O1', '2026-10-01T02:30:00Z', '50000.00')];
    expect(v(apurar('2026-09', '2026-10-05T12:00:00Z', ev), 'valorGanhos').valor).toBe(50000);
    expect(v(apurar('2026-10', '2026-10-05T12:00:00Z', ev), 'valorGanhos').valor).toBe(0);
  });
});

describe('E1 · meta: ausente, retirada, versionada', () => {
  const agora = '2026-10-13T12:00:00Z';
  it('sem meta: DADO_INSUFICIENTE e alerta META_AUSENTE no mês corrente', () => {
    const a = apurar('2026-10', agora, [ganho('G1', 'O1', '2026-10-05T12:00:00Z', '10.00')], []);
    expect(v(a, 'meta')).toMatchObject({ estado: 'DADO_INSUFICIENTE', motivoInsuficiencia: 'sem meta definida para o mês' });
    expect(v(a, 'atingimento')).toMatchObject({ estado: 'DADO_INSUFICIENTE', motivoInsuficiencia: 'sem meta definida para o mês' });
    expect(v(a, 'faltaParaMeta').estado).toBe('DADO_INSUFICIENTE');
    expect(v(a, 'realizado')).toMatchObject({ estado: 'DISPONIVEL', valor: 10 }); // o realizado não depende da meta
    expect(codigos(a)).toContain('META_AUSENTE');
  });
  it('meta retirada (versão com valor nulo): DADO_INSUFICIENTE com a versão e alerta META_RETIRADA', () => {
    const metas = [meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z'), meta('2026-10', null, 2, '2026-10-10T12:00:00Z')];
    const a = apurar('2026-10', agora, [], metas);
    expect(a.meta.estado).toBe('RETIRADA');
    expect(v(a, 'meta').motivoInsuficiencia).toBe('meta retirada (versão 2)');
    expect(v(a, 'atingimento').estado).toBe('DADO_INSUFICIENTE');
    expect(codigos(a)).toContain('META_RETIRADA');
  });
  it('vigente = maior versão definida até o instante de referência; histórico não é sobrescrito', () => {
    const metas = [meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z'), meta('2026-10', '120000', 2, '2026-10-08T12:00:00Z'), meta('2026-10', '150000', 3, '2026-10-20T12:00:00Z')];
    expect(metaVigenteDoMes(metas, '2026-10', '2026-10-05T12:00:00Z')).toMatchObject({ estado: 'VIGENTE', centavos: 10_000_000 });
    expect(metaVigenteDoMes(metas, '2026-10', '2026-10-13T12:00:00Z')).toMatchObject({ estado: 'VIGENTE', centavos: 12_000_000 });
    expect(metaVigenteDoMes(metas, '2026-10', '2026-10-25T12:00:00Z').versao!.versao).toBe(3);
    expect(metas.map((m) => m.valor)).toEqual(['100000', '120000', '150000']); // nada foi alterado
    expect(proximaVersaoMeta(metas, '2026-10')).toBe(4);
    expect(proximaVersaoMeta(metas, '2026-11')).toBe(1);
  });
  it('mês encerrado: versão criada depois do fim do mês é ignorada (D3-C) e sinalizada', () => {
    const metas = [meta('2026-09', '100000', 1, '2026-09-02T12:00:00Z'), meta('2026-09', '1', 2, '2026-10-02T12:00:00Z')];
    const r = metaVigenteDoMes(metas, '2026-09', '2026-10-13T12:00:00Z');
    expect(r).toMatchObject({ estado: 'VIGENTE', centavos: 10_000_000 });
    expect(r.inconsistencias.map((i) => i.codigo)).toEqual(['META_DEFINIDA_APOS_ENCERRAMENTO']);
  });
  it('versão repetida e valor inválido viram inconsistência, nunca meta silenciosa', () => {
    const dup = [meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z', { id: 'A' }), meta('2026-10', '90000', 1, '2026-10-02T12:00:00Z', { id: 'B' })];
    const r = metaVigenteDoMes(dup, '2026-10', agora);
    expect(r.versao!.id).toBe('B'); // mesma versão: a definida por último, de forma determinística
    expect(r.inconsistencias[0]).toMatchObject({ codigo: 'META_VERSAO_DUPLICADA', metaId: 'A' });
    const invalida = apurar('2026-10', agora, [], [meta('2026-10', '-5', 1, '2026-10-01T12:00:00Z')]);
    expect(invalida.meta.estado).toBe('INVALIDA');
    expect(codigos(invalida)).toContain('META_INCONSISTENTE');
  });
  it('nova versão de meta: só mês corrente ou futuro, valor positivo com até 2 casas, motivo obrigatório', () => {
    const base = { motivo: 'plano comercial', agora };
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: '150000.00' })).toEqual([]);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-11', valor: 150000 })).toEqual([]);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: null })).toEqual([]); // retirar
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-09', valor: 1 })[0]).toMatch(/corrente ou para meses futuros/);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: 0 })[0]).toMatch(/positiva/);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: '1.005' })[0]).toMatch(/2 casas/);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: '1.234,56' })[0]).toMatch(/positiva/);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-10', valor: 1, motivo: 'ok' })[0]).toMatch(/motivo/);
    expect(motivosRecusaNovaMeta({ ...base, mes: '2026-1', valor: 1 })[0]).toMatch(/Mês inválido/);
    // virada: às 23:59 de 31/10 em São Paulo outubro ainda é corrente
    expect(motivosRecusaNovaMeta({ ...base, agora: '2026-11-01T02:59:00Z', mes: '2026-10', valor: 1 })).toEqual([]);
    expect(motivosRecusaNovaMeta({ ...base, agora: '2026-11-01T03:00:00Z', mes: '2026-10', valor: 1 })).toHaveLength(1);
  });
});

describe('E2 · teto da meta alinhado ao banco', () => {
  const agora = '2026-10-13T12:00:00Z';
  const base = { motivo: 'plano comercial', agora, mes: '2026-11' };
  it('R$ 1 trilhão é o máximo: aceito exato, recusado um centavo acima, com folga sobre o inteiro seguro', () => {
    expect(VALOR_MAXIMO_META_CENTAVOS).toBe(100_000_000_000_000);
    expect(VALOR_MAXIMO_META_CENTAVOS < Number.MAX_SAFE_INTEGER).toBe(true);
    expect(motivosRecusaNovaMeta({ ...base, valor: '1000000000000.00' })).toEqual([]);
    expect(motivosRecusaNovaMeta({ ...base, valor: 1_000_000_000_000 })).toEqual([]);
    expect(motivosRecusaNovaMeta({ ...base, valor: '1000000000000.01' })[0]).toMatch(/máxima/);
    expect(motivosRecusaNovaMeta({ ...base, valor: 9_000_000_000_000 })[0]).toMatch(/máxima/);
    expect(motivosRecusaNovaMeta({ ...base, valor: '99999999999999999999' })[0]).toMatch(/positiva/); // fora do inteiro seguro
  });
  it('versão gravada acima do teto é inválida (nunca entra no cálculo); no teto, o cálculo é exato', () => {
    expect(metaVigenteDoMes([meta('2026-11', '1000000000000.01', 1, '2026-10-10T12:00:00Z')], '2026-11', agora).estado).toBe('INVALIDA');
    const a = apurarMetaComercial({ mes: '2026-10', agora: '2026-11-02T12:00:00Z', metas: [meta('2026-10', '1000000000000.00', 1, '2026-10-01T12:00:00Z')], eventos: [ganho('G1', 'O1', '2026-10-10T12:00:00Z', '999999999999.99')] });
    expect(a.medidas.faltaParaMeta).toMatchObject({ estado: 'DISPONIVEL', valor: 0.01 });
    expect(a.medidas.atingimento.valor).toBeCloseTo(0.99999999999999, 12);
  });
});

describe('E1 · ganhos, valor ausente e complemento', () => {
  it('ganho sem valor entra na quantidade, nunca no valor; o realizado exato fica incompleto', () => {
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', [ganho('G1', 'O1', '2026-10-02T12:00:00Z', '30000.00'), ganho('G2', 'O2', '2026-10-03T12:00:00Z')]);
    expect(v(a, 'ganhos').valor).toBe(2);
    expect(v(a, 'ganhosSemValor').valor).toBe(1);
    expect(v(a, 'valorGanhos').valor).toBe(30000);
    expect(v(a, 'realizadoConfirmado').valor).toBe(30000);
    expect(v(a, 'realizado')).toMatchObject({ estado: 'DADO_INSUFICIENTE', motivoInsuficiencia: 'realizado incompleto: 1 ganho(s) e 0 estorno(s) sem valor confirmado' });
    expect(v(a, 'atingimento').estado).toBe('DADO_INSUFICIENTE');
    expect(a.alertas.find((x) => x.codigo === 'GANHOS_SEM_VALOR')!.evidencias).toEqual(['G2']);
  });
  it('valor zero explícito é um valor confirmado (diferente de ausente)', () => {
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', [ganho('G1', 'O1', '2026-10-02T12:00:00Z', 0)]);
    expect(v(a, 'ganhosSemValor').valor).toBe(0);
    expect(v(a, 'realizado')).toMatchObject({ estado: 'DISPONIVEL', valor: 0 });
  });
  it('complemento posterior retifica o MÊS DO GANHO, com rastro; o mês do complemento não recebe o valor', () => {
    const ev = [ganho('G1', 'O1', '2026-09-20T12:00:00Z'), complemento('C1', 'O1', 'G1', '2026-10-05T12:00:00Z', '80000.00')];
    const metas = [meta('2026-09', '100000', 1, '2026-09-01T12:00:00Z'), meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z')];
    const antes = apurarMetaComercial({ mes: '2026-09', agora: '2026-10-01T12:00:00Z', eventos: ev, metas }); // visto antes do complemento
    expect(v(antes, 'realizado').estado).toBe('DADO_INSUFICIENTE');
    const depois = apurarMetaComercial({ mes: '2026-09', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(v(depois, 'realizado')).toMatchObject({ estado: 'DISPONIVEL', valor: 80000 });
    expect(v(depois, 'atingimento')).toMatchObject({ estado: 'DISPONIVEL', valor: 0.8 });
    expect(depois.retificacoes).toEqual([{ ganhoId: 'G1', oportunidadeId: 'O1', complementoId: 'C1', complementadoEm: '2026-10-05T12:00:00Z', mesDoComplemento: '2026-10', centavos: 8_000_000 }]);
    expect(codigos(depois)).toEqual(expect.arrayContaining(['RETIFICACAO_POR_COMPLEMENTO', 'META_NAO_ATINGIDA']));
    const outubro = apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(v(outubro, 'valorGanhos').valor).toBe(0);
    expect(v(outubro, 'ganhos').valor).toBe(0);
  });
  it('complemento inválido é descartado com motivo: ganho com valor, repetido, sem valor, antes do ganho, de outra oportunidade', () => {
    const livro = lerLivroDesfechos([
      ganho('G1', 'O1', '2026-10-02T12:00:00Z', '10.00'), complemento('C1', 'O1', 'G1', '2026-10-03T12:00:00Z', '5.00'),
      ganho('G2', 'O2', '2026-10-02T12:00:00Z'), complemento('C2', 'O2', 'G2', '2026-10-04T12:00:00Z', '7.00'), complemento('C3', 'O2', 'G2', '2026-10-05T12:00:00Z', '9.00'),
      ganho('G3', 'O3', '2026-10-02T12:00:00Z'), complemento('C4', 'O3', 'G3', '2026-10-04T12:00:00Z', null), complemento('C5', 'O3', 'G3', '2026-10-01T12:00:00Z', '1.00'),
      complemento('C6', 'O9', 'G3', '2026-10-06T12:00:00Z', '1.00'),
    ]);
    expect(livro.inconsistencias.map((i) => `${i.eventoId}:${i.codigo}`).sort()).toEqual([
      'C1:COMPLEMENTO_EM_GANHO_COM_VALOR', 'C3:COMPLEMENTO_REPETIDO', 'C4:COMPLEMENTO_SEM_VALOR', 'C5:COMPLEMENTO_SEM_GANHO', 'C6:COMPLEMENTO_SEM_GANHO',
    ]);
    expect(livro.ganhos.find((g) => g.id === 'G2')!.complemento!.centavos).toBe(700);
  });
});

describe('E1 · estornos (D3-A) e dupla contagem', () => {
  const metas = [meta('2026-09', '100000', 1, '2026-09-01T12:00:00Z'), meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z')];
  it('estorno em outro mês: o mês do ganho não muda; o estorno abate no mês em que ocorreu, ligado ao ganho', () => {
    const ev = [ganho('G1', 'O1', '2026-09-10T12:00:00Z', '100000.00'), estorno('S1', 'O1', 'G1', '2026-10-04T12:00:00Z'), ganho('G2', 'O2', '2026-10-06T12:00:00Z', '30000.00')];
    const set = apurarMetaComercial({ mes: '2026-09', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(v(set, 'realizado')).toMatchObject({ estado: 'DISPONIVEL', valor: 100000 });
    expect(codigos(set)).toContain('META_ATINGIDA');
    const out = apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(v(out, 'estornos').valor).toBe(1);
    expect(v(out, 'valorEstornos').valor).toBe(100000);
    expect(v(out, 'realizado')).toMatchObject({ estado: 'DISPONIVEL', valor: -70000 }); // líquido negativo é mostrado, não escondido
    expect(v(out, 'faltaParaMeta').valor).toBe(170000);
    expect(out.estornos).toEqual([{ id: 'S1', ganhoId: 'G1', oportunidadeId: 'O1', ocorridoEm: '2026-10-04T12:00:00Z', mes: '2026-10', mesDoGanho: '2026-09', centavos: 10_000_000 }]);
    expect(out.alertas.find((x) => x.codigo === 'ESTORNO_NO_MES')!.mensagem).toMatch(/de 2026-09/);
  });
  it('estorno de ganho sem valor deixa o mês do estorno incompleto', () => {
    const ev = [ganho('G1', 'O1', '2026-09-10T12:00:00Z'), estorno('S1', 'O1', 'G1', '2026-10-04T12:00:00Z')];
    const out = apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(v(out, 'estornosSemValor').valor).toBe(1);
    expect(v(out, 'realizado').estado).toBe('DADO_INSUFICIENTE');
    expect(codigos(out)).toContain('ESTORNOS_SEM_VALOR');
  });
  it('evento repetido conta uma vez; id repetido com conteúdo diferente vale o primeiro', () => {
    const g = ganho('G1', 'O1', '2026-10-02T12:00:00Z', '10000.00');
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', [g, { ...g }, { ...g, valor: '99999.00', ocorridoEm: '2026-10-03T12:00:00Z' }]);
    expect(v(a, 'ganhos').valor).toBe(1);
    expect(v(a, 'valorGanhos').valor).toBe(10000);
    expect(a.inconsistencias.eventos.map((i) => i.codigo).sort()).toEqual(['EVENTO_REPETIDO', 'EVENTO_REPETIDO_DIVERGENTE']);
    expect(codigos(a)).toContain('EVENTOS_INCONSISTENTES');
  });
  it('dois ganhos da mesma oportunidade sem estorno no meio não contam duas vezes; reganho depois do estorno conta', () => {
    const ev = [
      ganho('G1', 'O1', '2026-10-02T12:00:00Z', '10000.00'), ganho('G2', 'O1', '2026-10-03T12:00:00Z', '10000.00'),
      estorno('S1', 'O1', 'G1', '2026-10-04T12:00:00Z'), estorno('S2', 'O1', 'G1', '2026-10-05T12:00:00Z'),
      ganho('G3', 'O1', '2026-10-06T12:00:00Z', '12000.00'),
      estorno('S3', 'O1', 'G9', '2026-10-07T12:00:00Z'), estorno('S4', 'O2', 'G3', '2026-10-07T12:00:00Z'),
    ];
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', ev);
    expect(v(a, 'ganhos').valor).toBe(2); // G1 e G3
    expect(v(a, 'estornos').valor).toBe(1); // S1
    expect(v(a, 'realizado').valor).toBe(12000); // 10.000 + 12.000 − 10.000
    expect(a.inconsistencias.eventos.map((i) => `${i.eventoId}:${i.codigo}`).sort()).toEqual(['G2:GANHO_REPETIDO', 'S2:ESTORNO_REPETIDO', 'S3:ESTORNO_SEM_GANHO', 'S4:ESTORNO_SEM_GANHO']);
  });
  it('estorno anterior ao ganho e evento sem fuso são desconsiderados', () => {
    const livro = lerLivroDesfechos([ganho('G1', 'O1', '2026-10-05T12:00:00Z', '1.00'), estorno('S1', 'O1', 'G1', '2026-10-05T11:00:00Z'), ganho('G2', 'O2', '2026-10-05T12:00:00')]);
    expect(livro.inconsistencias.map((i) => `${i.eventoId}:${i.codigo}`).sort()).toEqual(['G2:INSTANTE_INVALIDO', 'S1:ESTORNO_SEM_GANHO']);
  });
  it('a ordem de chegada dos eventos não muda o resultado', () => {
    const ev = [ganho('G1', 'O1', '2026-10-02T12:00:00Z', '1.10'), estorno('S1', 'O1', 'G1', '2026-10-04T12:00:00Z'), ganho('G2', 'O1', '2026-10-06T12:00:00Z', '2.20'), ganho('G3', 'O2', '2026-10-06T12:00:00Z')];
    const metas = [meta('2026-10', '100000', 1, '2026-10-01T12:00:00Z')];
    const base = apurar('2026-10', '2026-10-13T12:00:00Z', ev, metas);
    for (const perm of [[...ev].reverse(), [ev[2], ev[0], ev[3], ev[1]]]) expect(apurar('2026-10', '2026-10-13T12:00:00Z', perm, [...metas].reverse())).toEqual(base);
  });
});

describe('E1 · realizado × meta', () => {
  const agora = '2026-11-02T12:00:00Z'; // outubro encerrado
  const comValor = (valor: string) => apurar('2026-10', agora, [ganho('G1', 'O1', '2026-10-10T12:00:00Z', valor)]);
  it('abaixo da meta: atingimento parcial, falta, META_NAO_ATINGIDA no mês encerrado', () => {
    const a = comValor('50000.00');
    expect(v(a, 'atingimento')).toMatchObject({ estado: 'DISPONIVEL', valor: 0.5, unidade: 'RAZAO' });
    expect(v(a, 'faltaParaMeta').valor).toBe(50000);
    expect(v(a, 'excedente').valor).toBe(0);
    expect(codigos(a)).toContain('META_NAO_ATINGIDA');
  });
  it('igual à meta: 100% e META_ATINGIDA', () => {
    const a = comValor('100000.00');
    expect(v(a, 'atingimento').valor).toBe(1);
    expect(v(a, 'faltaParaMeta').valor).toBe(0);
    expect(codigos(a)).toEqual(['META_ATINGIDA']);
  });
  it('acima da meta: atingimento acima de 1 e excedente', () => {
    const a = comValor('120000.50');
    expect(v(a, 'atingimento').valor).toBeCloseTo(1.200005, 10);
    expect(v(a, 'excedente').valor).toBe(20000.5);
  });
  it('mês corrente abaixo da meta não gera "não atingida" (ainda não acabou)', () => {
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', [ganho('G1', 'O1', '2026-10-10T12:00:00Z', '1.00')]);
    expect(codigos(a)).toEqual([]);
  });
  it('mês futuro: realizado e comparação são NAO_APLICAVEL; meta já definida é mostrada', () => {
    const a = apurar('2026-12', '2026-10-13T12:00:00Z', [], [meta('2026-12', '200000', 1, '2026-10-10T12:00:00Z')]);
    expect(a.situacao).toBe('FUTURO');
    expect(v(a, 'meta')).toMatchObject({ estado: 'DISPONIVEL', valor: 200000 });
    for (const k of ['ganhos', 'realizado', 'realizadoConfirmado', 'atingimento', 'faltaParaMeta'] as const) expect(v(a, k).estado, k).toBe('NAO_APLICAVEL');
  });
});

describe('E1 · dinheiro em centavos', () => {
  it('leitura de valores: texto do banco, número, ausente, inválido e arredondamento meio para cima', () => {
    expect(lerValor('1234.56')).toEqual({ estado: 'VALIDO', centavos: 123456 });
    expect(lerValor('1234.5')).toEqual({ estado: 'VALIDO', centavos: 123450 });
    expect(lerValor('1234')).toEqual({ estado: 'VALIDO', centavos: 123400 });
    expect(lerValor(1.005)).toEqual({ estado: 'VALIDO', centavos: 101 }); // ponto flutuante não engana o arredondamento
    expect(lerValor('1.0049')).toEqual({ estado: 'VALIDO', centavos: 100 });
    expect(lerValor(0)).toEqual({ estado: 'VALIDO', centavos: 0 });
    for (const ausente of [null, undefined, '', '   ']) expect(lerValor(ausente)).toEqual({ estado: 'AUSENTE' });
    for (const invalido of ['-5', -5, 'abc', '1.234,56', '1,5', Number.NaN, Number.POSITIVE_INFINITY, '9'.repeat(20)]) expect(lerValor(invalido as never), String(invalido)).toEqual({ estado: 'INVALIDO' });
    expect(ateDuasCasas('10.25')).toBe(true);
    expect(ateDuasCasas(10.25)).toBe(true);
    expect(ateDuasCasas('10.255')).toBe(false);
  });
  it('soma exata em centavos (0,10 + 0,20 = 0,30) e ganho com valor inválido descartado', () => {
    const a = apurar('2026-10', '2026-10-13T12:00:00Z', [ganho('G1', 'O1', '2026-10-02T12:00:00Z', 0.1), ganho('G2', 'O2', '2026-10-02T12:00:00Z', 0.2), ganho('G3', 'O3', '2026-10-02T12:00:00Z', '-1')]);
    expect(v(a, 'valorGanhos').valor).toBe(0.3);
    expect(v(a, 'ganhos').valor).toBe(2);
    expect(a.inconsistencias.eventos).toEqual([{ codigo: 'VALOR_INVALIDO', eventoId: 'G3', detalhe: 'valor -1' }]);
  });
});

describe('E1 · alertas e guardas', () => {
  it('catálogo fechado de alertas, sem ritmo (D3-D)', () => {
    expect(CODIGOS_ALERTA_META.some((c) => /RITMO|PACE|PROJEC/.test(c))).toBe(false);
  });
  it('mês encerrado sem meta não gera META_AUSENTE (D3-C: meta passada não pode mais ser definida)', () => {
    const a = apurar('2026-09', '2026-10-13T12:00:00Z', [], []);
    expect(codigos(a)).not.toContain('META_AUSENTE');
    expect(v(a, 'atingimento').estado).toBe('DADO_INSUFICIENTE');
  });
  it('entrada congelada não é alterada e o resultado é determinístico', () => {
    const ev = Object.freeze([Object.freeze(ganho('G1', 'O1', '2026-10-02T12:00:00Z')), Object.freeze(complemento('C1', 'O1', 'G1', '2026-10-03T12:00:00Z', '5.00'))]) as unknown as EventoDesfecho[];
    const metas = Object.freeze([Object.freeze(meta('2026-10', '10', 1, '2026-10-01T12:00:00Z'))]) as unknown as VersaoMetaComercial[];
    const a = apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00Z', eventos: ev, metas });
    expect(apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00Z', eventos: ev, metas })).toEqual(a);
  });
  it('fonte: sem relógio, sem estimativa, sem financeiro, imports fechados', () => {
    const fonte = readFileSync('src/core/radar/metaComercial.ts', 'utf8');
    const codigo = fonte.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
    expect(codigo).not.toMatch(/Date\.now\(|new Date\(\)/);
    expect(codigo).not.toMatch(/valorEstimado|probabilidade|estagio|Lancamento|financial|faturamento/i);
    expect([...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['./commercialMetrics']);
  });
  it('instante de referência inválido falha alto (nunca usa o relógio)', () => {
    expect(() => apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13', eventos: [], metas: [] })).toThrow(/instante/);
    expect(() => apurarMetaComercial({ mes: '2026-10', agora: '2026-10-13T12:00:00', eventos: [], metas: [] })).toThrow(/instante/);
  });
});

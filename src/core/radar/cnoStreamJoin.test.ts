// LE-3B — merge join em streaming: memoria do tamanho de um CNO, ordenacao provada e falha fechada.
import { describe, expect, it } from 'vitest';
import type { CnoAreaCanonica, CnoCnaeCanonico, CnoObservacaoCanonica, CnoVinculoCanonico, LinhaLida } from './cnoDadosAbertos';
import { ErroOrdenacaoCno, juntarOrdenadoCno, verificarOrdenacao, type EventoJoin } from './cnoStreamJoin';

const obra = (cno: string): LinhaLida<CnoObservacaoCanonica> => ({ cno, bruta: { CNO: cno, Nome: 'Obra ' + cno }, canonica: { cno, nomeObra: 'Obra ' + cno, areas: [], cnaes: [], vinculos: [] } });
const area = (cno: string, categoria: string, metragem = 100): LinhaLida<CnoAreaCanonica> => ({ cno, bruta: { CNO: cno, Categoria: categoria, Metragem: String(metragem) }, canonica: { categoria, metragem } });
const cnae = (cno: string, codigo: string): LinhaLida<CnoCnaeCanonico> => ({ cno, bruta: { CNO: cno, CNAE: codigo }, canonica: { cnae: codigo } });
const vinculo = (cno: string, inicio: string): LinhaLida<CnoVinculoCanonico> => ({ cno, bruta: { CNO: cno, 'Data de início': inicio }, canonica: { inicio } });

/** Fluxo assincrono a partir de um array — simula o arquivo chegando aos poucos. */
async function* fluxo<T>(itens: T[]): AsyncGenerator<T> { for (const i of itens) { await Promise.resolve(); yield i; } }

const coletar = async (g: AsyncGenerator<EventoJoin>) => {
  const obs: EventoJoin[] = [];
  for await (const e of g) obs.push(e);
  return {
    observacoes: obs.filter((e): e is Extract<EventoJoin, { tipo: 'observacao' }> => e.tipo === 'observacao').map((e) => e.observacao),
    diagnosticos: obs.filter((e): e is Extract<EventoJoin, { tipo: 'diagnostico' }> => e.tipo === 'diagnostico').map((e) => e.diagnostico),
  };
};

describe('LE-3B · verificação de ordenação', () => {
  it('fluxo ordenado → YES com a contagem de linhas', async () => {
    expect(await verificarOrdenacao(fluxo([{ cno: '1' }, { cno: '1' }, { cno: '2' }, { cno: '9' }]))).toEqual({ ordenado: true, linhas: 4 });
    expect(await verificarOrdenacao([{ cno: '1' }])).toEqual({ ordenado: true, linhas: 1 });
    expect(await verificarOrdenacao([])).toEqual({ ordenado: true, linhas: 0 });
  });
  it('quebra → NO, apontando onde', async () => {
    const r = await verificarOrdenacao(fluxo([{ cno: '000000000001' }, { cno: '000000000003' }, { cno: '000000000002' }]), 'x');
    expect(r.ordenado).toBe(false);
    expect(r.quebra).toEqual({ linha: 3, anterior: '000000000003', atual: '000000000002' });
  });
});

describe('LE-3B · merge join por CNO', () => {
  it('1 obra sem filhos', async () => {
    const r = await coletar(juntarOrdenadoCno({ obras: fluxo([obra('1')]) }));
    expect(r.observacoes).toHaveLength(1);
    expect(r.observacoes[0].cno).toBe('1');
    expect(r.observacoes[0].canonical.areas).toEqual([]);
    expect(r.observacoes[0].evidence.areas).toEqual([]);
    expect(r.diagnosticos).toEqual([]);
  });

  it('1 obra com N áreas, N CNAEs e N vínculos — evidência e canônica emparelhadas', async () => {
    const r = await coletar(juntarOrdenadoCno({
      obras: fluxo([obra('1')]),
      areas: fluxo([area('1', 'Reforma', 10), area('1', 'Obra Nova', 900), area('1', 'Acréscimo', 50)]),
      cnaes: fluxo([cnae('1', '4120400'), cnae('1', '4110700')]),
      vinculos: fluxo([vinculo('1', '2020-01-01'), vinculo('1', '2019-01-01')]),
    }));
    const o = r.observacoes[0];
    expect(o.canonical.areas).toHaveLength(3);
    expect(o.evidence.areas).toHaveLength(3);
    // ordem deterministica, e a bruta i e a origem da canonica i
    o.canonical.areas.forEach((a, i) => expect(o.evidence.areas[i]['Categoria']).toBe(a.categoria));
    expect(o.canonical.cnaes.map((c) => c.cnae)).toEqual(['4110700', '4120400']);
    expect(o.canonical.vinculos.map((v) => v.inicio)).toEqual(['2019-01-01', '2020-01-01']);
  });

  it('mudança de CNO fecha o grupo anterior; os filhos vão para o pai certo', async () => {
    const r = await coletar(juntarOrdenadoCno({
      obras: fluxo([obra('1'), obra('2'), obra('3')]),
      areas: fluxo([area('1', 'Obra Nova'), area('2', 'Reforma'), area('2', 'Existente')]),
      cnaes: fluxo([cnae('3', '1')]),
    }));
    expect(r.observacoes.map((o) => o.cno)).toEqual(['1', '2', '3']);
    expect(r.observacoes[0].canonical.areas.map((a) => a.categoria)).toEqual(['Obra Nova']);
    expect(r.observacoes[1].canonical.areas.map((a) => a.categoria)).toEqual(['Existente', 'Reforma']);
    expect(r.observacoes[2].canonical.areas).toEqual([]);
    expect(r.observacoes[2].canonical.cnaes).toHaveLength(1);
    expect(r.diagnosticos).toEqual([]);
  });

  it('EOF fecha o último grupo, inclusive quando o último filho é da última obra', async () => {
    const r = await coletar(juntarOrdenadoCno({ obras: fluxo([obra('1'), obra('2')]), areas: fluxo([area('2', 'Obra Nova')]) }));
    expect(r.observacoes[1].canonical.areas).toHaveLength(1);
    expect(r.diagnosticos).toEqual([]);
  });

  it('órfãos diagnosticados: antes da primeira obra, entre obras e depois da última', async () => {
    const r = await coletar(juntarOrdenadoCno({
      obras: fluxo([obra('2'), obra('4')]),
      areas: fluxo([area('1', 'x'), area('2', 'y'), area('3', 'z'), area('5', 'w')]),
      cnaes: fluxo([cnae('9', '1')]),
      vinculos: fluxo([vinculo('0', '2020-01-01')]),
    }));
    expect(r.observacoes.map((o) => o.cno)).toEqual(['2', '4']);
    expect(r.observacoes[0].canonical.areas).toHaveLength(1);
    expect(r.diagnosticos).toEqual(expect.arrayContaining([
      { tipo: 'AREA_ORFA', cno: '1' }, { tipo: 'AREA_ORFA', cno: '3' }, { tipo: 'AREA_ORFA', cno: '5' },
      { tipo: 'CNAE_ORFAO', cno: '9' }, { tipo: 'VINCULO_ORFAO', cno: '0' },
    ]));
    expect(r.diagnosticos).toHaveLength(5);
  });

  it('obra repetida vira CNO_DUPLICADO e sai sem filhos (eles já foram para a primeira)', async () => {
    const r = await coletar(juntarOrdenadoCno({ obras: fluxo([obra('1'), obra('1')]), areas: fluxo([area('1', 'Obra Nova')]) }));
    expect(r.observacoes).toHaveLength(2);
    expect(r.observacoes[0].canonical.areas).toHaveLength(1);
    expect(r.observacoes[1].canonical.areas).toHaveLength(0);
    expect(r.diagnosticos).toEqual([{ tipo: 'CNO_DUPLICADO', cno: '1' }]);
  });

  it('fluxo de obras fora de ordem → falha fechada, nunca resultado silenciosamente errado', async () => {
    await expect(coletar(juntarOrdenadoCno({ obras: fluxo([obra('2'), obra('1')]) }))).rejects.toBeInstanceOf(ErroOrdenacaoCno);
  });

  it('fluxo filho fora de ordem → falha fechada', async () => {
    await expect(coletar(juntarOrdenadoCno({ obras: fluxo([obra('1'), obra('2'), obra('3')]), areas: fluxo([area('3', 'a'), area('1', 'b')]) }))).rejects.toBeInstanceOf(ErroOrdenacaoCno);
  });

  it('memória: cada observação é emitida antes de a próxima obra ser lida (nada acumula)', async () => {
    const lidas: string[] = [];
    const emitidas: string[] = [];
    async function* obras() { for (const c of ['1', '2', '3']) { lidas.push(c); yield obra(c); } }
    for await (const e of juntarOrdenadoCno({ obras: obras() })) {
      if (e.tipo === 'observacao') {
        emitidas.push(e.observacao.cno);
        // no momento em que a obra N e emitida, a obra N+1 ainda nao foi lida
        expect(lidas).toHaveLength(emitidas.length);
      }
    }
    expect(emitidas).toEqual(['1', '2', '3']);
  });

  it('aceita iteráveis síncronos também', async () => {
    const r = await coletar(juntarOrdenadoCno({ obras: [obra('1')], areas: [area('1', 'Obra Nova')] }));
    expect(r.observacoes[0].canonical.areas).toHaveLength(1);
  });
});

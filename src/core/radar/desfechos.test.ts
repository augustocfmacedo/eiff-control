// CD-D3/E3 — espelho do gatilho da 0070 no app e integração com o motor E1 (metaComercial). As mesmas regras são
// provadas no banco por scripts/pg-smoke-desfechos.mjs; aqui, a lógica pura e o contrato EventoDesfecho.
import { describe, expect, it } from 'vitest';
import { complementoDoGanho, eventosDaTransicao, ganhoVigente, ganhosDaOportunidade, motivosRecusaComplemento } from './desfechos';
import { apurarMetaComercial, lerLivroDesfechos, type EventoDesfecho, type VersaoMetaComercial } from './metaComercial';
import { aplicarTransicao } from './estagioOportunidade';
import type { Oportunidade } from './types';

let n = 0;
const novoId = () => `DSF-${++n}`;
const opp = (p: Partial<Oportunidade> = {}): Oportunidade => ({ id: 'OPP-1', empresaId: 'EMP-1', titulo: 'Galpão', estagio: 'NEGOTIATION', valorEstimado: 500000, probabilidade: 0.8, responsavelId: 'u-resp', observacoes: '', criadoEm: '2026-10-01T12:00:00.000Z', atualizadoEm: '2026-10-01T12:00:00.000Z', ...p });
const ctx = (agora: string, extra: Partial<{ donoContaId: string; atorId: string }> = {}) => ({ agora, atorId: extra.atorId ?? 'u-ator', donoContaId: extra.donoContaId, novoId });
/** aplica a transição canônica (E0) e o espelho do gatilho, acumulando o livro */
function transicao(livro: EventoDesfecho[], antes: Oportunidade, para: Oportunidade['estagio'], agora: string, dados: { motivo?: string; valorFechado?: number } = {}, dono?: string) {
  const depois = aplicarTransicao(antes, para, { motivo: dados.motivo ?? 'motivo', valorFechado: dados.valorFechado }, agora);
  return { depois, livro: [...livro, ...eventosDaTransicao(antes, depois, livro, ctx(agora, { donoContaId: dono }))] };
}

describe('espelho do gatilho radar_opportunity_desfecho', () => {
  it('entrar em WON = GANHO com o valor fechado confirmado e tudo congelado; o estimado não vira valor', () => {
    const { depois, livro } = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { motivo: 'contrato assinado', valorFechado: 1250000.5 }, 'u-dono');
    expect(depois.valorEstimado).toBe(500000);
    expect(livro).toEqual([{ id: expect.any(String), tipo: 'GANHO', oportunidadeId: 'OPP-1', empresaId: 'EMP-1', ocorridoEm: '2026-10-14T15:00:00.000Z', valor: 1250000.5, responsavelId: 'u-resp', donoContaId: 'u-dono', motivo: 'contrato assinado', registradoPor: 'u-ator' }]);
  });

  it('ganho sem valor confirmado: sem `valor` (incompleto), nunca o estimado', () => {
    const { livro } = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z');
    expect(livro[0].tipo).toBe('GANHO');
    expect('valor' in livro[0]).toBe(false);
  });

  it('criação já ganha também gera GANHO', () => {
    const nova = aplicarTransicao(opp({ estagio: 'WON' }), 'WON', { motivo: 'fechado', valorFechado: 880000 }, '2026-10-14T15:00:00.000Z');
    expect(eventosDaTransicao(undefined, nova, [], ctx('2026-10-14T15:00:00.000Z')).map((e) => [e.tipo, e.valor])).toEqual([['GANHO', 880000]]);
  });

  it('WON → WON e transições entre estágios abertos não gravam nada', () => {
    const { depois, livro } = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 10 });
    expect(eventosDaTransicao(depois, { ...depois, titulo: 'outro' }, livro, ctx('2026-10-14T16:00:00.000Z'))).toEqual([]);
    expect(eventosDaTransicao(opp({ estagio: 'QUALIFIED' }), opp({ estagio: 'PRICING' }), [], ctx('2026-10-14T16:00:00.000Z'))).toEqual([]);
  });

  it('reabrir = ESTORNO do ganho vigente, com o mesmo responsável e dono do ganho; o valor fechado some da oportunidade', () => {
    const a = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 1000 }, 'u-dono');
    const b = transicao(a.livro, a.depois, 'NEGOTIATION', '2026-11-02T10:00:00.000Z', { motivo: 'cliente pediu revisão' }, 'outro-dono');
    expect(b.depois.valorFechado).toBeUndefined();
    expect(b.livro.map((e) => [e.tipo, e.ganhoId, e.donoContaId, e.responsavelId])).toEqual([['GANHO', undefined, 'u-dono', 'u-resp'], ['ESTORNO_GANHO', a.livro[0].id, 'u-dono', 'u-resp']]);
  });

  it('novo ganho depois de reabrir; LOST também estorna; o vigente é o mais recente', () => {
    const a = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 1000 });
    const b = transicao(a.livro, a.depois, 'NEGOTIATION', '2026-10-15T15:00:00.000Z');
    const c = transicao(b.livro, b.depois, 'WON', '2026-10-16T15:00:00.000Z', { valorFechado: 1100 });
    expect(ganhoVigente(c.livro, 'OPP-1')?.valor).toBe(1100);
    const d = transicao(c.livro, c.depois, 'LOST', '2026-10-17T15:00:00.000Z');
    expect(d.livro.map((e) => e.tipo)).toEqual(['GANHO', 'ESTORNO_GANHO', 'GANHO', 'ESTORNO_GANHO']);
    expect(d.livro[3].ganhoId).toBe(c.livro[2].id);
    expect(ganhoVigente(d.livro, 'OPP-1')).toBeUndefined();
  });

  it('ganho anterior ao livro (sem evento) reaberto: nenhum estorno fabricado', () => {
    expect(eventosDaTransicao(opp({ estagio: 'WON' }), opp({ estagio: 'NEGOTIATION' }), [], ctx('2026-10-14T15:00:00.000Z'))).toEqual([]);
  });

  it('defesa: entrar em WON com ganho vigente no livro é recusado', () => {
    const a = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 1 });
    expect(() => eventosDaTransicao(opp({ estagio: 'NEGOTIATION' }), a.depois, a.livro, ctx('2026-10-14T16:00:00.000Z'))).toThrow(/ganho vigente/);
  });

  it('mesmo instante do relógio: o evento seguinte sai 1 ms depois (como o clock_timestamp do banco, nunca empata)', () => {
    const t = '2026-10-14T15:00:00.000Z';
    const a = transicao([], opp(), 'WON', t, { valorFechado: 1 });
    const b = transicao(a.livro, a.depois, 'NEGOTIATION', t);
    const c = transicao(b.livro, b.depois, 'WON', t, { valorFechado: 2 });
    expect(c.livro.map((e) => e.ocorridoEm)).toEqual(['2026-10-14T15:00:00.000Z', '2026-10-14T15:00:00.001Z', '2026-10-14T15:00:00.002Z']);
    expect(lerLivroDesfechos(c.livro).inconsistencias).toEqual([]);
  });
});

describe('complemento de valor (mesmas regras da RPC radar_complementar_valor_ganho)', () => {
  const a = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z');
  const g = a.livro[0];
  it('só ganho sem valor, uma vez, valor positivo com 2 casas, com motivo', () => {
    expect(motivosRecusaComplemento(a.livro, g.id, 450000.75, 'valor da NF')).toEqual([]);
    expect(motivosRecusaComplemento(a.livro, 'NAO-EXISTE', 1, 'ok ok')).toEqual(['Ganho não encontrado no livro de desfechos.']);
    expect(motivosRecusaComplemento(a.livro, g.id, 0, 'motivo')[0]).toMatch(/valor positivo/);
    expect(motivosRecusaComplemento(a.livro, g.id, 10.001, 'motivo')[0]).toMatch(/2 casas/);
    expect(motivosRecusaComplemento(a.livro, g.id, 1e12 + 1, 'motivo')[0]).toMatch(/máximo/);
    expect(motivosRecusaComplemento(a.livro, g.id, 10, 'x')[0]).toMatch(/motivo/);
    const comValor = transicao([], opp({ id: 'OPP-2' }), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 5 });
    expect(motivosRecusaComplemento(comValor.livro, comValor.livro[0].id, 10, 'motivo')).toContain('O ganho já tem valor confirmado.');
    const c = complementoDoGanho(a.livro, g.id, 450000.75, ' valor da NF ', { agora: '2026-10-20T10:00:00.000Z', atorId: 'u-dir', novoId });
    expect(c).toMatchObject({ tipo: 'COMPLEMENTO_VALOR', ganhoId: g.id, valor: 450000.75, motivo: 'valor da NF', registradoPor: 'u-dir', oportunidadeId: 'OPP-1', empresaId: 'EMP-1' });
    expect(motivosRecusaComplemento([...a.livro, c], g.id, 1, 'de novo')).toContain('O ganho já foi complementado.');
  });
});

describe('integração com o motor E1 (apurarMetaComercial) — o livro alimenta a meta sem tradução', () => {
  const meta = (mes: string, valor: number): VersaoMetaComercial => ({ id: `META-${mes}`, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao: 1, motivo: 'meta do mês', definidaPor: 'u-dir', definidaEm: '2026-10-01T12:00:00.000Z' });
  const metas = [meta('2026-10', 1000000), meta('2026-11', 1000000)];

  it('ganho em outubro conta em outubro; reabertura em novembro estorna em novembro (D3-A)', () => {
    const a = transicao([], opp(), 'WON', '2026-10-14T15:00:00.000Z', { valorFechado: 1250000.5 });
    const b = transicao(a.livro, a.depois, 'NEGOTIATION', '2026-11-03T15:00:00.000Z');
    const out = apurarMetaComercial({ metas, eventos: b.livro, mes: '2026-10', agora: '2026-12-01T12:00:00.000Z' });
    expect(out.medidas.realizado).toMatchObject({ estado: 'DISPONIVEL', valor: 1250000.5 });
    const nov = apurarMetaComercial({ metas, eventos: b.livro, mes: '2026-11', agora: '2026-12-01T12:00:00.000Z' });
    expect(nov.medidas.realizado).toMatchObject({ estado: 'DISPONIVEL', valor: -1250000.5 });
  });

  it('ganho sem valor deixa o realizado incompleto; o complemento corrige o mês do ganho (D3-B), sem apagar nada', () => {
    const a = transicao([], opp(), 'WON', '2026-10-30T15:00:00.000Z');
    const antes = apurarMetaComercial({ metas, eventos: a.livro, mes: '2026-10', agora: '2026-11-10T12:00:00.000Z' });
    expect(antes.medidas.realizado.estado).toBe('DADO_INSUFICIENTE');
    const c = complementoDoGanho(a.livro, a.livro[0].id, 400000, 'valor da NF', { agora: '2026-11-05T10:00:00.000Z', atorId: 'u-dir', novoId });
    const depois = apurarMetaComercial({ metas, eventos: [...a.livro, c], mes: '2026-10', agora: '2026-11-10T12:00:00.000Z' });
    expect(depois.medidas.realizado).toMatchObject({ estado: 'DISPONIVEL', valor: 400000 });
    expect(depois.retificacoes.map((x) => x.mesDoComplemento)).toEqual(['2026-11']);
    expect(ganhosDaOportunidade([...a.livro, c], 'OPP-1')).toEqual([{ ganhoId: a.livro[0].id, ocorridoEm: '2026-10-30T15:00:00.000Z', valor: 400000, semValor: false, complementoId: c.id, vigente: true }]);
  });

  it('linha do banco (amount como texto, instante +00:00) entra no motor como veio', () => {
    const doBanco: EventoDesfecho[] = [{ id: 'b1', tipo: 'GANHO', oportunidadeId: 'o', empresaId: 'e', ocorridoEm: '2026-10-14T15:00:00.123456+00:00', valor: '1250000.50' }];
    expect(apurarMetaComercial({ metas, eventos: doBanco, mes: '2026-10', agora: '2026-10-20T12:00:00.000Z' }).medidas.realizado).toMatchObject({ estado: 'DISPONIVEL', valor: 1250000.5 });
  });
});

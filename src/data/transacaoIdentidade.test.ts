// Identidade da transacao bancaria no modo remoto: o id da entidade no app e o uuid da linha de bank_transaction; o
// FITID do banco (external_id) e so idExterno. Motivo: o mesmo FITID aparece em contas diferentes (extrato importado na
// conta errada ao lado da linha certa, ou dois bancos que numeram FITID por data + sequencia), e sao duas linhas distintas.
// Se o FITID virar id, as duas colidem no app e o mapa id -> uuid da persistencia guarda so uma delas.
import { beforeEach, describe, expect, it } from 'vitest';
import { planejarMovimentacao } from '../core/extratos';
import { posicaoBancaria } from '../core/engine';
import type { TransacaoBancaria } from '../core/types';
import { actions, getState } from './store';
import { mapaTransacoes, transacaoDoBanco } from './supabase';

const UUID_A = '11111111-1111-4111-8111-111111111111'; // conta errada (BB)
const UUID_B = '22222222-2222-4222-8222-222222222222'; // conta certa (Inter), mesma linha do banco
const UUID_C = '33333333-3333-4333-8333-333333333333'; // so existe na conta errada
const CONTA_BB = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONTA_INTER = 'aaaaaaaa-0000-4000-8000-000000000002';
const FITID = '202609040772';

const linha = (id: string, conta: string, external_id: string, debit: number, extra: Record<string, unknown> = {}) => ({
  id, organization_id: 'org', bank_account_id: conta, record_kind: 'Real', external_id, transaction_date: '2026-09-04',
  description: 'PIX ENVIADO', document_number: null, debit, credit: 0, imported_at: '2026-09-15T16:52:00Z', ...extra,
});
const LINHAS = [linha(UUID_A, CONTA_BB, FITID, 45), linha(UUID_B, CONTA_INTER, FITID, 45), linha(UUID_C, CONTA_BB, '202609250771', 30)];
const contasInv = new Map([[CONTA_BB, 'BB'], [CONTA_INTER, 'Inter']]);
const doBanco = (conciliacoes: Record<string, { entry_id: string }[]> = {}, lancsInv = new Map<string, string>()): TransacaoBancaria[] =>
  LINHAS.map((t) => transacaoDoBanco(t, { contasInv, lancsInv, conciliacoes: conciliacoes[t.id] ?? [] }));

describe('adaptador Supabase: id = uuid da linha, idExterno = FITID', () => {
  it('duas linhas com o mesmo FITID em contas diferentes viram duas transacoes distintas', () => {
    const [a, b] = doBanco();
    expect(a.id).toBe(UUID_A);
    expect(b.id).toBe(UUID_B);
    expect(a.id).not.toBe(b.id);
    expect(a.idExterno).toBe(FITID);
    expect(b.idExterno).toBe(a.idExterno);
    expect([a.conta, b.conta]).toEqual(['BB', 'Inter']);
  });
  it('o mapa da persistencia resolve cada transacao para o seu proprio uuid (nunca um mapa FITID -> uuid)', () => {
    const mapa = mapaTransacoes(LINHAS);
    expect(mapa.size).toBe(LINHAS.length);
    for (const t of doBanco()) expect(mapa.get(t.id)).toBe(t.id);
    expect(mapa.get(UUID_A)).toBe(UUID_A);
    expect(mapa.get(UUID_B)).toBe(UUID_B);
    expect(mapa.has(FITID)).toBe(false);
  });
  it('a conciliacao fica na linha certa: o vinculo de B nao aparece em A', () => {
    const [a, b] = doBanco({ [UUID_B]: [{ entry_id: 'uuid-lanc' }] }, new Map([['uuid-lanc', 'PAG-0069']]));
    expect(b.lancamentoIds).toEqual(['PAG-0069']);
    expect(a.lancamentoIds).toEqual([]);
  });
  it('a tela pode listar as duas linhas ao mesmo tempo: nenhuma chave de React repetida', () => {
    const ids = doBanco().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('linha sem FITID continua com id = uuid e idExterno ausente', () => {
    const t = transacaoDoBanco(linha(UUID_C, CONTA_BB, null as unknown as string, 10), { contasInv, lancsInv: new Map(), conciliacoes: [] });
    expect(t.id).toBe(UUID_C);
    expect(t.idExterno).toBeUndefined();
  });
});

describe('store com transacoes no formato remoto (mesmo FITID em duas contas)', () => {
  const ds = () => getState().ds;
  const porId = (id: string) => ds().transacoes.find((t) => t.id === id)!;
  const saldo = (conta: string) => posicaoBancaria(ds()).find((p) => p.conta.instituicao === conta)?.saldoBancario ?? 0;
  beforeEach(() => {
    actions.trocarUsuario('u-admin');
    actions.restaurarPlanilha();
    const base = ds();
    const contas = [
      { id: 'CTA-BB', registro: 'Real' as const, instituicao: 'BB', conta: '0001-0', tipo: 'Conta corrente', saldoInicial: 0, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true },
      { id: 'CTA-INTER', registro: 'Real' as const, instituicao: 'Inter', conta: '0002-0', tipo: 'Conta corrente', saldoInicial: 0, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true },
    ];
    actions.importarJson(JSON.stringify({ ...base, contas: [...base.contas, ...contas], transacoes: doBanco() }));
  });

  it('carrega as tres linhas sem colisao', () => {
    expect(ds().transacoes.filter((t) => t.idExterno === FITID).map((t) => t.id).sort()).toEqual([UUID_A, UUID_B]);
  });
  it('planejarMovimentacao escolhe A como origem e acha B como gemea pelo idExterno', () => {
    const plano = planejarMovimentacao(ds().transacoes, [UUID_A], 'Inter');
    expect(plano.itens).toHaveLength(1);
    expect(plano.itens[0].transacao.id).toBe(UUID_A);
    expect(plano.itens[0].transacao.conta).toBe('BB');
    expect(plano.itens[0].acao).toBe('descartar_duplicata');
    expect(plano.itens[0].gemeaId).toBe(UUID_B);
  });
  it('moverTransacoes descarta A (duplicata) e move C, sem tocar em B', () => {
    const b = porId(UUID_B);
    const r = actions.moverTransacoes([UUID_A, UUID_C], 'Inter', 'extrato do Inter importado no BB');
    expect(r).toMatchObject({ movidas: 1, descartadas: 1 });
    expect(porId(UUID_A)).toMatchObject({ conta: 'BB' });
    expect(porId(UUID_A).descartadaEm).toBeTruthy();
    expect(porId(UUID_C)).toMatchObject({ conta: 'Inter', contaOrigem: 'BB' });
    expect(porId(UUID_B)).toEqual(b);
    expect(saldo('BB')).toBeCloseTo(0, 2);
    expect(saldo('Inter')).toBeCloseTo(-75, 2); // B (-45) + C movida (-30); a duplicata A nao conta
  });
  it('descartar e restaurar trabalham pela linha certa', () => {
    const b = porId(UUID_B);
    actions.descartarTransacao(UUID_A, 'duplicata');
    expect(porId(UUID_A).descartadaEm).toBeTruthy();
    expect(porId(UUID_B)).toEqual(b);
    actions.restaurarTransacao(UUID_A);
    expect(porId(UUID_A).descartadaEm).toBeUndefined();
    expect(porId(UUID_B)).toEqual(b);
  });
  it('conciliar A nunca altera B, e conciliar B nunca altera A', () => {
    const lanc = ds().lancamentos.find((l) => l.status !== 'Cancelado' && !l.excluidoEm)!;
    actions.conciliar(UUID_B, [lanc.id], 'teste de identidade');
    expect(porId(UUID_B).lancamentoIds).toEqual([lanc.id]);
    expect(porId(UUID_A).lancamentoIds).toEqual([]);
    actions.conciliar(UUID_B, []);
    actions.conciliar(UUID_A, [lanc.id], 'teste de identidade');
    expect(porId(UUID_A).lancamentoIds).toEqual([lanc.id]);
    expect(porId(UUID_B).lancamentoIds).toEqual([]);
  });
  it('a importacao continua deduplicando por conta + FITID (identidade da entidade e dedup sao coisas diferentes)', () => {
    const linhaOfx = { data: '2026-09-04', historico: 'PIX ENVIADO', documento: '', debito: 45, credito: 0, idExterno: FITID };
    expect(actions.importarTransacoes('Inter', [linhaOfx])).toMatchObject({ importadas: 0, duplicadas: 1 });
    expect(actions.importarTransacoes('BB', [linhaOfx])).toMatchObject({ importadas: 0, duplicadas: 1 });
    expect(ds().transacoes.filter((t) => t.idExterno === FITID)).toHaveLength(2);
  });
});

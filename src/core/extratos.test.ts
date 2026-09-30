// Extrato na conta errada: lotes de importação, plano de revinculação e detecção da conta certa.
import { describe, expect, it } from 'vitest';
import { contaDosIdentificadores, lotesDeImportacao, planejarMovimentacao } from './extratos';
import type { TransacaoBancaria } from './types';

const t = (p: Partial<TransacaoBancaria> & { id: string }): TransacaoBancaria => ({
  registro: 'Real', data: '2026-09-15', conta: 'BB', historico: 'Pix', documento: '', debito: 0, credito: 0,
  lancamentoIds: [], origem: 'ofx', ...p,
});

describe('lotes de importação', () => {
  it('agrupa por conta e momento, com período, valores e o que já foi conciliado', () => {
    const lotes = lotesDeImportacao([
      t({ id: 'A1', conta: 'BB', data: '2026-09-01', debito: 100, importadoEm: '2026-09-15T16:51:02Z', idExterno: '1.1' }),
      t({ id: 'A2', conta: 'BB', data: '2026-09-03', credito: 500, importadoEm: '2026-09-15T16:51:40Z', idExterno: '1.2', lancamentoIds: ['PAG-1'] }),
      t({ id: 'B1', conta: 'Inter', data: '2026-09-10', debito: 20, importadoEm: '2026-09-20T09:00:00Z', idExterno: '2.1' }),
    ]);
    expect(lotes).toHaveLength(2);
    const bb = lotes.find((l) => l.conta === 'BB')!;
    expect(bb.quantidade).toBe(2);
    expect(bb.de).toBe('2026-09-01');
    expect(bb.ate).toBe('2026-09-03');
    expect(bb.movimento).toBe(400);
    expect(bb.conciliadas).toBe(1);
    expect(lotes[0].conta).toBe('Inter'); // mais recente primeiro
  });

  it('aponta a conta provável quando o lote repete identificadores de outra conta', () => {
    const lotes = lotesDeImportacao([
      t({ id: 'X1', conta: 'BB', idExterno: '202609010771', importadoEm: '2026-09-15T16:52:00Z' }),
      t({ id: 'X2', conta: 'BB', idExterno: '202609020771', importadoEm: '2026-09-15T16:52:00Z' }),
      t({ id: 'Y1', conta: 'Inter', idExterno: '202609010771', importadoEm: '2026-09-08T21:40:00Z' }),
      t({ id: 'Y2', conta: 'Inter', idExterno: '202609020771', importadoEm: '2026-09-08T21:40:00Z' }),
    ]);
    expect(lotes.find((l) => l.conta === 'BB')!.contaProvavel).toBe('Inter');
    expect(lotes.find((l) => l.conta === 'Inter')!.contaProvavel).toBe('BB'); // simétrico: quem decide é o usuário
  });
});

describe('plano de revinculação', () => {
  const base = [
    t({ id: 'M1', conta: 'BB', idExterno: '202609150771', debito: 300 }),
    t({ id: 'D1', conta: 'BB', idExterno: '202609010771', debito: 17, lancamentoIds: ['PAG-9'] }),
    t({ id: 'D2', conta: 'BB', idExterno: '202609020771', debito: 19 }),
    t({ id: 'G1', conta: 'Inter', idExterno: '202609010771', debito: 17 }),
    t({ id: 'G2', conta: 'Inter', idExterno: '202609020771', debito: 19, lancamentoIds: ['PAG-8'] }),
    t({ id: 'N1', conta: 'Inter', idExterno: '202609200771', credito: 50 }),
  ];

  it('separa o que move do que é duplicata e mede o efeito no caixa', () => {
    const p = planejarMovimentacao(base, ['M1', 'D1', 'D2', 'N1'], 'Inter');
    expect(p.mover).toBe(1);
    expect(p.descartar).toBe(2);
    expect(p.semEfeito).toBe(1); // N1 já está na conta de destino
    expect(p.itens.find((i) => i.transacao.id === 'M1')!.acao).toBe('mover');
    expect(p.itens.find((i) => i.transacao.id === 'D1')!.gemeaId).toBe('G1');
    expect(p.movimentoQueSai).toBe(-336); // 300 + 17 + 19 saem da conta de origem
    expect(p.movimentoQueEntra).toBe(-300); // só a que move entra no destino
  });

  it('transfere a conciliação para a gêmea livre e avisa quando a gêmea já está conciliada', () => {
    const p = planejarMovimentacao(base, ['D1', 'D2'], 'Inter');
    expect(p.conciliacoesTransferidas).toBe(1); // D1 -> G1 (G1 está livre)
    expect(p.conciliacoesPerdidas).toBe(0); // D2 não tem conciliação para perder
    const comConflito = planejarMovimentacao(
      [...base, t({ id: 'D3', conta: 'BB', idExterno: '202609020771', debito: 19, lancamentoIds: ['PAG-7'] })],
      ['D3'], 'Inter',
    );
    expect(comConflito.conciliacoesPerdidas).toBe(1); // G2 já está conciliada: ninguém assume
    expect(comConflito.itens[0].transfereConciliacao).toBeFalsy();
  });

  it('já descartada não entra de novo no plano', () => {
    const p = planejarMovimentacao([t({ id: 'Z1', conta: 'BB', descartadaEm: '2026-09-30T10:00:00Z' })], ['Z1'], 'Inter');
    expect(p.itens[0].acao).toBe('descartada');
    expect(p.mover + p.descartar).toBe(0);
  });
});

describe('detecção da conta na importação', () => {
  const existentes = [
    t({ id: 'I1', conta: 'Inter', idExterno: '202609250771' }),
    t({ id: 'I2', conta: 'Inter', idExterno: '202609260771' }),
  ];
  it('avisa quando o arquivo escolhido para uma conta já existe em outra', () => {
    const r = contaDosIdentificadores(['202609250771', '202609260771', '202609270771'], existentes, 'BB');
    expect(r).toEqual({ conta: 'Inter', encontrados: 2 });
  });
  it('não avisa quando o arquivo é da própria conta ou é novo', () => {
    expect(contaDosIdentificadores(['202609250771'], existentes, 'Inter')).toBeUndefined();
    expect(contaDosIdentificadores(['999'], existentes, 'BB')).toBeUndefined();
    expect(contaDosIdentificadores([], existentes, 'BB')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { resumirUso, type EventoUso } from './telemetria';

describe('telemetria de uso (local)', () => {
  it('resume visitas por tela, ações e por dia dentro da janela', () => {
    const hoje = new Date('2026-09-10T12:00:00Z');
    const ev: EventoUso[] = [
      { t: 'tela', k: '/', em: '2026-09-10T08:00:00Z' }, { t: 'tela', k: '/lancamentos', em: '2026-09-10T08:05:00Z' }, { t: 'tela', k: '/', em: '2026-09-09T08:00:00Z' },
      { t: 'acao', k: 'paleta:tema', em: '2026-09-09T09:00:00Z' }, { t: 'acao', k: 'paleta:tema', em: '2026-09-10T09:00:00Z' }, { t: 'tela', k: '/', em: '2026-07-01T08:00:00Z' },
    ];
    const r = resumirUso(ev, 30, hoje);
    expect(r.total).toBe(5); expect(r.telas[0]).toEqual({ rota: '/', visitas: 2 }); expect(r.telas[1]).toEqual({ rota: '/lancamentos', visitas: 1 });
    expect(r.acoes).toEqual([{ nome: 'paleta:tema', vezes: 2 }]);
    expect(r.porDia).toHaveLength(30); expect(r.porDia.at(-1)).toEqual({ data: '2026-09-10', visitas: 2 }); expect(r.porDia.at(-2)?.visitas).toBe(1);
    expect(r.desde).toBe('2026-09-10T08:00:00Z');
  });
});

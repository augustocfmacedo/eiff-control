// Widgets do iPad: o resumo do caixa que o widget (Scriptable) mostra. É uma LEITURA dos mesmos números da tela Caixa e do
// Diretor Financeiro — livroCaixa (saldo de hoje, mínimo, saldo dia a dia, vencidos), saudeCaixa (semáforo) e
// defasagemExtrato — recortada no que cabe num widget. Nada é calculado de novo aqui e nada é gravado. O servidor
// (/api/widget-caixa) só chega aqui depois de validar o token do aparelho (migration 0069).
import type { Dataset } from './types';
import { addDays, calcLancamentos, round2 } from './engine';
import { livroCaixa } from './caixa';
import { saudeCaixa, type Sinal } from './saudeCaixa';
import { defasagemExtrato } from './cfo';

export const VERSAO_RESUMO_WIDGET = 1;
/** dias da curva (de hoje até hoje + 30) e janela da lista de próximos */
export const DIAS_CURVA_WIDGET = 30;
export const DIAS_PROXIMOS_WIDGET = 7;
export const MAX_PROXIMOS_WIDGET = 8;

export interface ProximoWidget { data: string; descricao: string; tipo: 'Entrada' | 'Saída'; valor: number; vencido: boolean; foraDoSaldo: boolean }
export interface ResumoWidgetCaixa {
  versao: typeof VERSAO_RESUMO_WIDGET;
  geradoEm: string; // instante UTC em que o servidor montou o resumo
  hoje: string; // data-base (AAAA-MM-DD, São Paulo)
  caixaHoje: number; // o mesmo "Saldo hoje" da Caixa e o "caixa hoje" do Diretor Financeiro
  minimo: number; // caixa mínimo = reserva mínima + reserva vinculada das contas
  abaixoDoMinimo: boolean;
  menor: { data: string; saldo: number }; // menor saldo de hoje até o fim da curva
  fim: { data: string; saldo: number };
  em7Dias: number;
  curva: number[]; // saldo no fim de cada dia, de hoje até hoje + DIAS_CURVA_WIDGET (inclusive)
  semana: { entradas: number; saidas: number }; // o que ainda entra e sai (em aberto) de hoje até hoje + 6
  vencidos: { pagar: number; receber: number };
  saude: { geral: Sinal; vermelhos: number; amarelos: number; alertas: { titulo: string; valor: string; sinal: Sinal }[] };
  extrato: { ate: string | null; dias: number | null; alerta: string | null };
  proximos: ProximoWidget[];
}

const curto = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Monta o resumo do widget a partir do dataset JÁ com a data-base de hoje (o servidor ajusta para São Paulo). */
export function resumoWidgetCaixa(ds: Dataset, geradoEm: Date): ResumoWidgetCaixa {
  const hoje = ds.params.dataBase;
  const lancs = calcLancamentos(ds);
  const ate = addDays(hoje, DIAS_CURVA_WIDGET);
  const lv = livroCaixa(ds, ate, lancs, { verBancos: true });
  const saude = saudeCaixa(ds, lancs);
  const ext = defasagemExtrato(ds);

  const fimSemana = addDays(hoje, DIAS_PROXIMOS_WIDGET - 1);
  // o que AINDA entra e sai na semana (os pagos de hoje já estão no caixa de hoje, como na saúde do caixa)
  const semana = lv.linhas.filter((x) => x.contaNoSaldo && x.situacao !== 'Pago' && x.situacao !== 'Extrato' && x.dataSaldo <= fimSemana);
  const abertos = lv.linhas.filter((x) => (x.situacao === 'Previsto' || x.situacao === 'Vencido') && x.data <= fimSemana);
  // vencidos primeiro (o mais antigo antes), depois por data; no mesmo dia, o maior valor antes
  abertos.sort((a, b) => Number(b.situacao === 'Vencido') - Number(a.situacao === 'Vencido') || a.data.localeCompare(b.data) || (b.entra + b.sai) - (a.entra + a.sai));
  const ordem: Record<Sinal, number> = { vermelho: 0, amarelo: 1, verde: 2 };

  return {
    versao: VERSAO_RESUMO_WIDGET,
    geradoEm: geradoEm.toISOString(),
    hoje,
    caixaHoje: lv.saldoHoje,
    minimo: lv.reserva,
    abaixoDoMinimo: lv.saldoHoje < lv.reserva,
    menor: lv.menor,
    fim: { data: ate, saldo: lv.saldoFinal },
    em7Dias: lv.previsto7,
    curva: lv.dias.map((d) => d.saldo),
    semana: { entradas: round2(semana.reduce((a, x) => a + x.entra, 0)), saidas: round2(semana.reduce((a, x) => a + x.sai, 0)) },
    vencidos: { pagar: lv.vencidosPagar, receber: lv.vencidosReceber },
    saude: {
      geral: saude.geral, vermelhos: saude.vermelhos, amarelos: saude.amarelos,
      alertas: saude.indicadores.filter((i) => i.sinal !== 'verde').sort((a, b) => ordem[a.sinal] - ordem[b.sinal]).slice(0, 3).map((i) => ({ titulo: i.titulo, valor: i.valor, sinal: i.sinal })),
    },
    extrato: { ate: ext.ate ?? null, dias: Number.isFinite(ext.dias) ? ext.dias : null, alerta: ext.alerta ?? null },
    proximos: abertos.slice(0, MAX_PROXIMOS_WIDGET).map((x) => ({
      data: x.data, descricao: curto(x.descricao || x.contraparte || '(sem descrição)'), tipo: x.tipo,
      valor: round2(x.entra + x.sai), vencido: x.situacao === 'Vencido', foraDoSaldo: !x.contaNoSaldo,
    })),
  };
}

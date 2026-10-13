// Saude do caixa (Fase 1 do CFO): indicadores com semaforo sobre os MESMOS numeros da Caixa (livroCaixa) e do Diretor
// Financeiro (caixaHoje, reserva minima). Funcao pura: nada grava, nada e calculado na tela. Os limites de cada cor ficam em
// LIMITES_SAUDE (um lugar so); mudou a regra, muda aqui e no teste.
import type { Dataset } from './types';
import { addDays, calcLancamentos, round2, type LancamentoCalc } from './engine';
import { livroCaixa } from './caixa';
import { defasagemExtrato } from './cfo';

export type Sinal = 'verde' | 'amarelo' | 'vermelho';
export interface IndicadorSaude {
  id: 'folga' | 'menor' | 'folego' | 'cobertura' | 'concentracao' | 'juros' | 'pagar_vencido' | 'receber_vencido' | 'extrato';
  titulo: string;
  valor: string; // ja formatado para a tela
  sinal: Sinal;
  explicacao: string; // o que o numero quer dizer, em uma frase
  acao?: string; // o que fazer quando nao esta verde
  rota?: string;
}
export interface SaudeCaixa { geral: Sinal; indicadores: IndicadorSaude[]; vermelhos: number; amarelos: number; janela: number }

/** Limites das cores. `reserva` = caixa minimo (reserva minima + reserva vinculada das contas). */
export const LIMITES_SAUDE = {
  janelaDias: 30,
  folga: { verdeMultiploReserva: 2 }, // caixa hoje >= 2x o minimo = verde; >= minimo = amarelo; abaixo = vermelho
  menor: { verdeMultiploReserva: 1.5 }, // menor saldo em 30 dias >= 1,5x o minimo = verde; >= minimo = amarelo
  folego: { verde: 30, amarelo: 15 }, // dias que o caixa de hoje paga as saidas previstas (media diaria dos proximos 30 dias)
  cobertura: { verde: 1.2, amarelo: 1 }, // (caixa hoje + entradas 30d) / saidas 30d
  concentracao: { amarelo: 0.5, vermelho: 0.75 }, // fatia do maior pagador nas entradas previstas de 30 dias
  juros: { amarelo: 0.05, vermelho: 0.1 }, // juros e tarifas / saidas previstas de 30 dias
  receberVencido: { amareloDias: 15 }, // ate 15 dias de atraso = amarelo; mais = vermelho
  extrato: { verdeDias: 1, amareloDias: 3 }, // dias desde o ultimo movimento importado
} as const;

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const PESO: Record<Sinal, number> = { verde: 0, amarelo: 1, vermelho: 2 };

export function saudeCaixa(ds: Dataset, lancs: LancamentoCalc[] = calcLancamentos(ds)): SaudeCaixa {
  const L = LIMITES_SAUDE;
  const hoje = ds.params.dataBase;
  const ate = addDays(hoje, L.janelaDias);
  const lv = livroCaixa(ds, ate, lancs);
  const reserva = lv.reserva;
  // so o que ainda vai entrar/sair na janela (os pagos de hoje ja estao no caixa de hoje)
  const abertas = lv.linhas.filter((x) => x.contaNoSaldo && x.situacao !== 'Pago' && x.situacao !== 'Extrato' && x.dataSaldo <= ate);
  const entradas30 = round2(abertas.reduce((a, x) => a + x.entra, 0));
  const saidas30 = round2(abertas.reduce((a, x) => a + x.sai, 0));
  const ind: IndicadorSaude[] = [];
  // com caixa minimo: verde a partir de `mult` vezes o minimo, amarelo entre o minimo e isso, vermelho abaixo do minimo;
  // sem caixa minimo definido: verde se positivo, vermelho se zero ou negativo
  const porMinimo = (v: number, mult: number): Sinal => (reserva > 0 ? (v >= reserva * mult ? 'verde' : v >= reserva ? 'amarelo' : 'vermelho') : v > 0 ? 'verde' : 'vermelho');

  // 1. folga do caixa de hoje sobre o caixa minimo
  ind.push({ id: 'folga', titulo: 'Caixa hoje sobre o mínimo', valor: fmt(round2(lv.saldoHoje - reserva)), sinal: porMinimo(lv.saldoHoje, L.folga.verdeMultiploReserva),
    explicacao: `Caixa hoje ${fmt(lv.saldoHoje)}; caixa mínimo ${fmt(reserva)}.`, acao: 'Segure pagamentos sem data obrigatória e antecipe recebimentos.' });
  // 2. menor saldo previsto na janela
  ind.push({ id: 'menor', titulo: `Menor saldo em ${L.janelaDias} dias`, valor: fmt(lv.menor.saldo), sinal: porMinimo(lv.menor.saldo, L.menor.verdeMultiploReserva),
    explicacao: `Em ${br(lv.menor.data)}, com o que já está previsto.`, acao: `Reagende saídas antes de ${br(lv.menor.data)} ou garanta uma entrada até lá.` });
  // 3. folego: quantos dias o caixa de hoje paga as saidas previstas
  const mediaDia = saidas30 / L.janelaDias;
  const folego = mediaDia > 0 ? lv.saldoHoje / mediaDia : Infinity;
  ind.push({ id: 'folego', titulo: 'Fôlego do caixa', valor: Number.isFinite(folego) ? `${Math.max(0, Math.floor(folego))} dias` : 'sem saídas previstas',
    sinal: folego >= L.folego.verde ? 'verde' : folego >= L.folego.amarelo ? 'amarelo' : 'vermelho',
    explicacao: `Quantos dias o caixa de hoje paga as saídas previstas (média de ${fmt(round2(mediaDia))} por dia), sem contar nenhuma entrada.`, acao: 'Dependência alta das entradas previstas: acompanhe cada recebimento.' });
  // 4. cobertura dos compromissos da janela
  const cobertura = saidas30 > 0 ? (lv.saldoHoje + entradas30) / saidas30 : Infinity;
  ind.push({ id: 'cobertura', titulo: `Cobertura de ${L.janelaDias} dias`, valor: Number.isFinite(cobertura) ? `${cobertura.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×` : 'sem saídas previstas',
    sinal: cobertura >= L.cobertura.verde ? 'verde' : cobertura >= L.cobertura.amarelo ? 'amarelo' : 'vermelho',
    explicacao: `Caixa hoje + entradas previstas (${fmt(entradas30)}) contra saídas previstas (${fmt(saidas30)}).`, acao: 'As entradas previstas não cobrem as saídas com folga: negocie prazos ou busque recebimentos.' });
  // 5. concentracao das entradas em um pagador
  const entradasAbertas = abertas.filter((x) => x.tipo === 'Entrada');
  const porPagador = new Map<string, number>();
  for (const x of entradasAbertas) { const k = (x.contraparte || x.descricao).trim() || '—'; porPagador.set(k, (porPagador.get(k) ?? 0) + x.entra); }
  const maior = [...porPagador.entries()].sort((a, b) => b[1] - a[1])[0];
  const fatia = maior && entradas30 > 0 ? maior[1] / entradas30 : 0;
  ind.push({ id: 'concentracao', titulo: 'Dependência de um pagador', valor: maior ? pct(fatia) : 'sem entradas previstas',
    sinal: !maior ? 'amarelo' : fatia > L.concentracao.vermelho ? 'vermelho' : fatia > L.concentracao.amarelo ? 'amarelo' : 'verde',
    explicacao: maior ? `${maior[0]} responde por ${fmt(round2(maior[1]))} das entradas previstas em ${L.janelaDias} dias.` : `Nenhuma entrada prevista em ${L.janelaDias} dias.`,
    acao: maior ? `Se ${maior[0]} atrasar, o caixa sente direto: confirme a data com o cliente.` : 'Lance as entradas previstas para o caixa enxergar o mês.' });
  // 6. peso dos juros e tarifas nas saidas
  const juros = round2(abertas.filter((x) => x.tipo === 'Saída' && x.categoria === 'Juros e tarifas bancárias').reduce((a, x) => a + x.sai, 0));
  const pesoJuros = saidas30 > 0 ? juros / saidas30 : 0;
  ind.push({ id: 'juros', titulo: 'Peso dos juros', valor: pct(pesoJuros), sinal: pesoJuros > L.juros.vermelho ? 'vermelho' : pesoJuros > L.juros.amarelo ? 'amarelo' : 'verde',
    explicacao: `${fmt(juros)} de juros e tarifas nas saídas previstas de ${L.janelaDias} dias.`, acao: 'Juros altos consomem o caixa todo mês: avalie quitar ou renegociar a dívida mais cara.', rota: '/dividas' });
  // 7. pagamentos vencidos
  ind.push({ id: 'pagar_vencido', titulo: 'Pagamentos vencidos', valor: fmt(lv.vencidosPagar), sinal: lv.vencidosPagar > 0 ? 'vermelho' : 'verde',
    explicacao: lv.vencidosPagar > 0 ? 'Já entram no caixa de hoje.' : 'Nada vencido a pagar.', acao: 'Pague ou renegocie e atualize a data.', rota: '/pagar?situacao=Atrasado' });
  // 8. recebimentos vencidos
  const atrasados = lancs.filter((l) => l.oficial && !l.direto && l.tipo === 'Entrada' && l.situacao === 'Atrasado');
  const maiorAtraso = atrasados.reduce((m, l) => Math.max(m, l.diasAtraso), 0);
  ind.push({ id: 'receber_vencido', titulo: 'Recebimentos vencidos', valor: fmt(lv.vencidosReceber), sinal: !atrasados.length ? 'verde' : maiorAtraso <= L.receberVencido.amareloDias ? 'amarelo' : 'vermelho',
    explicacao: atrasados.length ? `${atrasados.length} título(s), o mais antigo com ${maiorAtraso} dia(s) de atraso; fora do caixa até entrarem.` : 'Nada vencido a receber.', acao: 'Cobre o cliente ou ajuste a data prevista.', rota: '/receber?situacao=Atrasado' });
  // 9. extrato em dia
  const ext = defasagemExtrato(ds);
  ind.push({ id: 'extrato', titulo: 'Extrato em dia', valor: ext.ate ? `até ${br(ext.ate)}` : 'sem extrato', sinal: !ext.ate ? 'vermelho' : ext.dias <= L.extrato.verdeDias ? 'verde' : ext.dias <= L.extrato.amareloDias ? 'amarelo' : 'vermelho',
    explicacao: ext.ate ? `Último movimento importado há ${ext.dias} dia(s).` : 'Sem extrato depois do marco: o caixa ainda não foi conferido com o banco.', acao: 'Importe o OFX em Bancos e conciliação.', rota: '/conciliacao' });

  const geral = ind.reduce<Sinal>((g, i) => (PESO[i.sinal] > PESO[g] ? i.sinal : g), 'verde');
  return { geral, indicadores: ind, vermelhos: ind.filter((i) => i.sinal === 'vermelho').length, amarelos: ind.filter((i) => i.sinal === 'amarelo').length, janela: L.janelaDias };
}

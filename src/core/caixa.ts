// Caixa no formato da planilha (PLANILHA CAIXA-2026.xlsx): uma lista unica com data, descricao, departamento, entra, sai,
// situacao (pago/previsto) e saldo corrido, mais o saldo previsto dia a dia. E uma LEITURA dos lancamentos do motor: cada
// linha e um lancamento de verdade (DRE, Obra 360, Diretor Financeiro e conciliacao continuam valendo); o departamento e o
// centro de custo do lancamento e escolhe a categoria do plano por tras (categoriaDoCaixa). Nada aqui grava.
import type { Dataset } from './types';
import { addDays, caixaHoje, calcLancamentos, incluirRegistro, mapaPlano, reservaVinculadaTotal, round2, type LancamentoCalc } from './engine';

export interface Departamento { id: string; saida: string; entrada: string; pedeObra?: boolean }

/** Departamentos da planilha (coluna DEP) e a categoria do plano que cada um usa em saidas e entradas. */
export const DEPARTAMENTOS: Departamento[] = [
  { id: 'Obra', saida: 'Outros custos diretos', entrada: 'Medições de obras', pedeObra: true },
  { id: 'Fábrica', saida: 'Outros custos diretos', entrada: 'Venda de estruturas e materiais' },
  { id: 'Projetos', saida: 'Projetos, ART e licenças', entrada: 'Projetos e engenharia' },
  { id: 'Folha', saida: 'Folha e salários', entrada: 'Outros recebimentos' },
  { id: 'Pró-labore', saida: 'Pró-labore', entrada: 'Aportes de sócios' },
  { id: 'Empréstimo', saida: 'Juros e tarifas bancárias', entrada: 'Empréstimos recebidos' },
  { id: 'Jurídico', saida: 'Contabilidade e jurídico', entrada: 'Outros recebimentos' },
  { id: 'Veículos', saida: 'Veículos e combustível', entrada: 'Venda de ativos' },
  { id: 'Impostos', saida: 'Tributos e taxas gerais', entrada: 'Outros recebimentos' },
  { id: 'Administrativo', saida: 'Outros pagamentos', entrada: 'Outros recebimentos' },
];
const GENERICA = { Entrada: 'Outros recebimentos', Saída: 'Outros pagamentos' } as const;
export const ORIGEM_CAIXA = 'caixa';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Categoria exige obra (mesma regra de validarLancamento): custo direto ou receita operacional. */
export function categoriaExigeObra(ds: Dataset, categoria: string): boolean {
  const p = mapaPlano(ds).get(categoria);
  return !!p && (p.grupoFluxo === 'Custos Diretos de Obras' || p.grupoDre === 'Receita Operacional');
}

/**
 * Categoria do plano para um lancamento feito no caixa. Usa a do departamento; se ela nao existe/esta inativa no plano, ou
 * exige obra e nenhuma foi informada, cai na generica (Outros pagamentos / Outros recebimentos) e avisa por `ajustada`.
 */
export function categoriaDoCaixa(ds: Dataset, departamento: string, tipo: 'Entrada' | 'Saída', codigoObra = ''): { categoria: string; ajustada: boolean } {
  const d = DEPARTAMENTOS.find((x) => norm(x.id) === norm(departamento)) ?? DEPARTAMENTOS[DEPARTAMENTOS.length - 1];
  const preferida = tipo === 'Entrada' ? d.entrada : d.saida;
  const p = mapaPlano(ds).get(preferida);
  const valida = !!p && p.ativa && p.tipo === tipo && (!!codigoObra || !categoriaExigeObra(ds, preferida));
  return valida ? { categoria: preferida, ajustada: false } : { categoria: GENERICA[tipo], ajustada: true };
}

/** Departamento de um lancamento: o centro de custo quando e um departamento; senao, o departamento cuja categoria e a dele. */
export function departamentoDe(l: { centroCusto: string; categoria: string; codigoObra?: string }): string {
  const porCentro = DEPARTAMENTOS.find((x) => norm(x.id) === norm(l.centroCusto ?? ''));
  if (porCentro) return porCentro.id;
  if (l.codigoObra) return 'Obra';
  const porCategoria = DEPARTAMENTOS.find((x) => x.saida === l.categoria || x.entrada === l.categoria);
  return porCategoria?.id ?? (l.centroCusto?.trim() || 'Administrativo');
}

export type SituacaoCaixa = 'Pago' | 'Previsto' | 'Vencido' | 'Em aprovação' | 'Rascunho' | 'Extrato';

export interface LinhaCaixa {
  chave: string;
  lancamentoId: string;
  data: string; // data da linha: realizacao (pago) ou vencimento (previsto)
  dataSaldo: string; // dia em que entra no saldo previsto (previsto vencido conta hoje)
  descricao: string;
  contraparte: string;
  departamento: string;
  codigoObra: string;
  tipo: 'Entrada' | 'Saída';
  categoria: string; // categoria do plano (vazio na linha de ajuste do extrato)
  entra: number;
  sai: number;
  situacao: SituacaoCaixa;
  contaNoSaldo: boolean; // recebivel vencido, rascunho e em aprovacao ficam fora do saldo
  nota?: string;
  saldo?: number; // saldo corrido apos a linha (so linhas que contam)
  conciliado: boolean;
}

export interface DiaCaixaPlanilha { data: string; entra: number; sai: number; saldo: number; abaixoReserva: boolean }

export interface LivroCaixa {
  marco: string; hoje: string; ate: string;
  saldoAbertura: number;
  saldoHoje: number; // caixa de hoje (caixaHoje do motor): o mesmo do Diretor Financeiro
  ajusteExtrato: number; // extrato - lancamentos: movimentos do banco ainda nao lancados/conciliados (linha 'Extrato' da lista)
  saldoBanco?: number; extratoAte?: string; // extrato importado (quando ha permissao de ver bancos)
  reserva: number;
  linhas: LinhaCaixa[];
  dias: DiaCaixaPlanilha[]; // de hoje ate `ate`, saldo no fim do dia
  saldoFinal: number;
  menor: { data: string; saldo: number };
  previsto7: number; previsto30: number;
  entradasPrevistas: number; saidasPrevistas: number;
  vencidosPagar: number; vencidosReceber: number;
  porDepartamento: { departamento: string; entra: number; sai: number }[];
}

/**
 * Monta o caixa no formato da planilha, do marco (corte do extrato) ate `ate`. Saldo de partida = abertura das contas ativas
 * (o saldo do inicio do dia do marco). Pagos entram na data em que foram pagos; previstos na data de vencimento; pagamento
 * vencido e nao pago entra hoje (tem de ser pago), recebivel vencido fica fora do saldo ate entrar (mesma regra do Diretor
 * Financeiro). Valores nominais, sem fator de cenario: e a planilha, nao a projecao ponderada.
 */
export function livroCaixa(ds: Dataset, ate: string, lancs: LancamentoCalc[] = calcLancamentos(ds), opcoes: { verBancos?: boolean } = {}): LivroCaixa {
  const hoje = ds.params.dataBase;
  const contas = ds.contas.filter((c) => c.ativa && incluirRegistro(c.registro, ds.params));
  const marco = ds.params.corteExtrato ?? contas.map((c) => c.saldoInicialData ?? hoje).sort()[0] ?? hoje;
  const saldoAbertura = round2(contas.reduce((a, c) => a + c.saldoInicial, 0));
  const reserva = round2(ds.params.reservaMinima + reservaVinculadaTotal(ds));

  const linhas: LinhaCaixa[] = [];
  for (const l of lancs) {
    if (!l.incluir || l.direto || l.status === 'Cancelado' || (l.tipo !== 'Entrada' && l.tipo !== 'Saída')) continue;
    const tipo = l.tipo;
    const base = { lancamentoId: l.id, categoria: l.categoria, descricao: l.descricao, contraparte: l.contraparte, departamento: departamentoDe(l), codigoObra: l.codigoObra, tipo, conciliado: l.vinculoBancario || l.conciliado } as const;
    const valores = (v: number) => (tipo === 'Entrada' ? { entra: round2(v), sai: 0 } : { entra: 0, sai: round2(v) });
    // parte paga (titulo realizado ou liquidacao parcial)
    if (l.valorRealizadoTotal > 0) {
      const dataPago = l.status === 'Realizado' ? (l.realizacao ?? l.vencimento) : ds.liquidacoes.filter((q) => q.lancamentoId === l.id).map((q) => q.data).sort().pop() ?? hoje;
      if (dataPago >= marco && dataPago <= ate) linhas.push({ ...base, chave: `${l.id}:pago`, data: dataPago, dataSaldo: dataPago, ...valores(l.valorRealizadoTotal), situacao: 'Pago', contaNoSaldo: true });
    }
    if (l.status === 'Realizado' || l.saldoAberto <= 0) continue;
    const venc = l.vencimento || hoje;
    const vencido = venc < hoje;
    if (!vencido && venc > ate) continue;
    let situacao: SituacaoCaixa = vencido ? 'Vencido' : 'Previsto';
    let contaNoSaldo = true; let nota: string | undefined;
    if (l.status === 'Rascunho') { situacao = 'Rascunho'; contaNoSaldo = false; nota = 'rascunho: fora do saldo até ser programado'; }
    else if (l.status === 'Pendente') { situacao = 'Em aprovação'; contaNoSaldo = false; nota = 'aguardando aprovação: fora do saldo'; }
    else if (vencido && tipo === 'Entrada') { contaNoSaldo = false; nota = 'recebimento vencido: fica fora do saldo até entrar'; }
    else if (vencido) nota = 'pagamento vencido: conta no saldo de hoje';
    linhas.push({ ...base, chave: `${l.id}:aberto`, data: venc, dataSaldo: vencido ? hoje : venc, ...valores(l.saldoAberto), situacao, contaNoSaldo, nota });
  }
  // ordem da planilha: por data; no mesmo dia, pagos antes dos previstos
  const peso = (x: LinhaCaixa) => (x.situacao === 'Pago' ? 0 : 1);
  linhas.sort((a, b) => a.dataSaldo.localeCompare(b.dataSaldo) || peso(a) - peso(b) || a.data.localeCompare(b.data) || a.lancamentoId.localeCompare(b.lancamentoId));
  // o caixa de hoje vem do motor (extrato + pagos fora do extrato); o que o extrato tem e os lancamentos ainda nao explicam
  // vira uma linha propria hoje, para o saldo corrido da lista bater com o caixa e com o Diretor Financeiro
  const caixa = caixaHoje(ds, lancs);
  const pagosAteHoje = linhas.filter((x) => x.situacao === 'Pago' && x.dataSaldo <= hoje).reduce((a, x) => a + x.entra - x.sai, 0);
  const ajusteExtrato = round2(caixa.total - (saldoAbertura + pagosAteHoje));
  if (Math.abs(ajusteExtrato) >= 0.01) {
    const idx = linhas.findIndex((x) => x.dataSaldo > hoje || (x.dataSaldo === hoje && x.situacao !== 'Pago'));
    const linha: LinhaCaixa = { chave: 'extrato:ajuste', lancamentoId: '', categoria: '', data: hoje, dataSaldo: hoje, descricao: 'Movimentos do extrato ainda não lançados ou conciliados', contraparte: '', departamento: '—', codigoObra: '', tipo: ajusteExtrato > 0 ? 'Entrada' : 'Saída', entra: ajusteExtrato > 0 ? ajusteExtrato : 0, sai: ajusteExtrato < 0 ? -ajusteExtrato : 0, situacao: 'Extrato', contaNoSaldo: true, nota: 'lance ou concilie em Bancos e conciliação', conciliado: false };
    linhas.splice(idx < 0 ? linhas.length : idx, 0, linha);
  }
  let saldo = saldoAbertura;
  for (const x of linhas) if (x.contaNoSaldo) { saldo = round2(saldo + x.entra - x.sai); x.saldo = saldo; }

  const contam = linhas.filter((x) => x.contaNoSaldo);
  const saldoAteDia = (d: string) => round2(saldoAbertura + contam.filter((x) => x.dataSaldo <= d).reduce((a, x) => a + x.entra - x.sai, 0));
  const saldoHoje = caixa.total;
  const dias: DiaCaixaPlanilha[] = [];
  for (let d = hoje; d <= ate; d = addDays(d, 1)) {
    const doDia = contam.filter((x) => x.dataSaldo === d);
    const s = saldoAteDia(d);
    dias.push({ data: d, entra: round2(doDia.reduce((a, x) => a + x.entra, 0)), sai: round2(doDia.reduce((a, x) => a + x.sai, 0)), saldo: s, abaixoReserva: s < reserva });
  }
  const menor = dias.reduce((m, x) => (x.saldo < m.saldo ? { data: x.data, saldo: x.saldo } : m), { data: hoje, saldo: dias[0]?.saldo ?? saldoHoje });
  const emAberto = linhas.filter((x) => x.situacao !== 'Pago' && x.situacao !== 'Extrato');
  const porDep = new Map<string, { entra: number; sai: number }>();
  for (const x of linhas.filter((y) => y.situacao !== 'Extrato')) { const p = porDep.get(x.departamento) ?? { entra: 0, sai: 0 }; p.entra += x.entra; p.sai += x.sai; porDep.set(x.departamento, p); }

  const saldoBanco = opcoes.verBancos ? caixa.banco : undefined;
  const extratoAte = opcoes.verBancos ? caixa.extratoAte : undefined;
  return {
    marco, hoje, ate, saldoAbertura, saldoHoje, ajusteExtrato, saldoBanco, extratoAte, reserva, linhas, dias,
    saldoFinal: saldoAteDia(ate), menor,
    previsto7: saldoAteDia(addDays(hoje, 7)), previsto30: saldoAteDia(addDays(hoje, 30)),
    entradasPrevistas: round2(emAberto.filter((x) => x.contaNoSaldo).reduce((a, x) => a + x.entra, 0)),
    saidasPrevistas: round2(emAberto.filter((x) => x.contaNoSaldo).reduce((a, x) => a + x.sai, 0)),
    vencidosPagar: round2(emAberto.filter((x) => x.situacao === 'Vencido' && x.tipo === 'Saída').reduce((a, x) => a + x.sai, 0)),
    vencidosReceber: round2(emAberto.filter((x) => x.situacao === 'Vencido' && x.tipo === 'Entrada').reduce((a, x) => a + x.entra, 0)),
    porDepartamento: [...porDep.entries()].map(([departamento, v]) => ({ departamento, entra: round2(v.entra), sai: round2(v.sai) })).sort((a, b) => b.sai + b.entra - (a.sai + a.entra)),
  };
}

export interface NovaLinhaCaixa { data: string; descricao: string; departamento: string; tipo: 'Entrada' | 'Saída'; valor: number; pago: boolean; codigoObra?: string; contraparte?: string }

/** Validacao da linha digitada no caixa (antes de virar lancamento; as regras do lancamento continuam no store). */
export function validarLinhaCaixa(x: NovaLinhaCaixa): string[] {
  const e: string[] = [];
  if (!x.data) e.push('Informe a data.');
  if (!x.descricao.trim()) e.push('Informe a descrição.');
  if (!(x.valor > 0)) e.push('Informe o valor em Entra ou em Sai.');
  if (!DEPARTAMENTOS.some((d) => d.id === x.departamento)) e.push('Escolha o departamento.');
  return e;
}

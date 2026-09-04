// Estoque de aco com rastreabilidade de corrida: entradas com certificado, saldo por item e por lote (corrida),
// consumo por obra/ordem/conjunto, sobras (retalhos que voltam ao estoque), ajustes e estornos.
// Tudo em kg; custo medio movel por item e por lote; custo real de material por servico.

import type { Dataset, FamiliaEstoque, ItemEstoque, LocalEstoque, MovimentoEstoque } from './types';

export const FAMILIAS_ESTOQUE: FamiliaEstoque[] = ['Perfil laminado', 'Perfil soldado', 'Chapa', 'Tubo', 'Barra', 'Cantoneira', 'Telha e fechamento', 'Consumível', 'Outros'];
const COM_CORRIDA = new Set<FamiliaEstoque>(['Perfil laminado', 'Perfil soldado', 'Chapa', 'Tubo', 'Barra', 'Cantoneira']);
/** Familias de aco estrutural: a entrada exige o numero da corrida do certificado de qualidade. */
export const exigeCorrida = (f: FamiliaEstoque) => COM_CORRIDA.has(f);
export const LOCAIS_ESTOQUE: LocalEstoque[] = ['Fábrica', 'Obra'];

/** Efeito do movimento no saldo em kg: Entrada e Sobra entram, Consumo sai, Ajuste e Estorno ja carregam o sinal. */
export const efeitoMovimento = (m: Pick<MovimentoEstoque, 'tipo' | 'quantidade'>): number => (m.tipo === 'Consumo' ? -m.quantidade : m.quantidade);
export const normalizarCorrida = (c?: string) => (c ?? '').trim().toUpperCase();

export interface LoteCalc {
  itemId: string;
  corrida: string; // vazio = sem corrida
  certificado?: string;
  fornecedor?: string;
  entradaEm?: string;
  entradas: number;
  saidas: number;
  saldo: number;
  saldoPorLocal: Record<LocalEstoque, number>;
  custoMedio: number;
}

export interface ItemEstoqueCalc extends ItemEstoque {
  entradas: number;
  consumos: number;
  sobras: number;
  saldo: number;
  saldoFabrica: number;
  saldoObra: number;
  custoMedio: number; // R$/kg, media movel das entradas
  valor: number;
  lotes: LoteCalc[];
  abaixoMinimo: boolean;
  ultimoMovimento?: string;
}

export interface PosicaoEstoque {
  itens: ItemEstoqueCalc[];
  saldoKg: number;
  valor: number;
  saldoFabrica: number;
  saldoObra: number;
  entradasKg: number;
  consumidoKg: number;
  sobrasKg: number;
  abaixoMinimo: number;
  lotes: number;
  porFamilia: { familia: FamiliaEstoque; saldo: number; valor: number }[];
}

const ordenar = (movs: MovimentoEstoque[]) => movs.slice().sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : 0));

function mediaMovel(saldo: number, custoMedio: number, e: number, custo: number): number {
  if (e <= 0) return custoMedio;
  const base = Math.max(saldo, 0);
  const c = custo > 0 ? custo : custoMedio;
  return base + e > 0 ? (base * custoMedio + e * c) / (base + e) : c;
}

function calcItem(i: ItemEstoque, movs: MovimentoEstoque[]): ItemEstoqueCalc {
  let saldo = 0; let custoMedio = 0; let entradas = 0; let consumos = 0; let sobras = 0;
  const porLocal: Record<LocalEstoque, number> = { Fábrica: 0, Obra: 0 };
  const lotes = new Map<string, LoteCalc>();
  let ultimo: string | undefined;
  for (const m of movs) {
    const e = efeitoMovimento(m);
    const corrida = normalizarCorrida(m.corrida);
    const l = lotes.get(corrida) ?? { itemId: i.id, corrida, entradas: 0, saidas: 0, saldo: 0, saldoPorLocal: { Fábrica: 0, Obra: 0 }, custoMedio: 0 };
    if (m.tipo === 'Entrada') { l.certificado = m.certificado || l.certificado; l.fornecedor = m.fornecedor || l.fornecedor; l.entradaEm = l.entradaEm ?? m.data; entradas += m.quantidade; }
    else if (m.tipo === 'Consumo') consumos += m.quantidade;
    else if (m.tipo === 'Sobra') sobras += m.quantidade;
    else if (m.tipo === 'Estorno') {
      if (m.origemTipo === 'Entrada') entradas += m.quantidade; // quantidade negativa
      else if (m.origemTipo === 'Consumo') consumos -= m.quantidade; // quantidade positiva
      else if (m.origemTipo === 'Sobra') sobras += m.quantidade; // negativa
    }
    custoMedio = mediaMovel(saldo, custoMedio, e, m.custoUnitario);
    l.custoMedio = mediaMovel(l.saldo, l.custoMedio, e, m.custoUnitario);
    saldo += e; porLocal[m.local] += e;
    l.saldo += e; l.saldoPorLocal[m.local] += e; l.entradas += Math.max(e, 0); l.saidas += Math.max(-e, 0);
    lotes.set(corrida, l);
    ultimo = m.data;
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    ...i, entradas: r(entradas), consumos: r(consumos), sobras: r(sobras), saldo: r(saldo), saldoFabrica: r(porLocal.Fábrica), saldoObra: r(porLocal.Obra),
    custoMedio, valor: Math.max(saldo, 0) * custoMedio,
    lotes: [...lotes.values()].map((l) => ({ ...l, saldo: r(l.saldo), entradas: r(l.entradas), saidas: r(l.saidas), saldoPorLocal: { Fábrica: r(l.saldoPorLocal.Fábrica), Obra: r(l.saldoPorLocal.Obra) } })).sort((a, b) => b.saldo - a.saldo),
    abaixoMinimo: (i.estoqueMinimo ?? 0) > 0 && saldo < i.estoqueMinimo,
    ultimoMovimento: ultimo,
  };
}

/** Posicao do estoque ate a data (inclusive): saldo, custo medio e lotes por item. */
export function posicaoEstoque(ds: Pick<Dataset, 'itensEstoque' | 'movimentosEstoque'>, ate?: string): PosicaoEstoque {
  const movs = ordenar((ds.movimentosEstoque ?? []).filter((m) => !ate || m.data <= ate));
  const porItem = new Map<string, MovimentoEstoque[]>();
  for (const m of movs) porItem.set(m.itemId, [...(porItem.get(m.itemId) ?? []), m]);
  const itens = (ds.itensEstoque ?? []).map((i) => calcItem(i, porItem.get(i.id) ?? [])).sort((a, b) => b.valor - a.valor || a.codigo.localeCompare(b.codigo));
  const soma = (f: (i: ItemEstoqueCalc) => number) => itens.reduce((s, i) => s + f(i), 0);
  const fam = new Map<FamiliaEstoque, { familia: FamiliaEstoque; saldo: number; valor: number }>();
  for (const i of itens) { const f = fam.get(i.familia) ?? { familia: i.familia, saldo: 0, valor: 0 }; f.saldo += i.saldo; f.valor += i.valor; fam.set(i.familia, f); }
  return {
    itens, saldoKg: soma((i) => i.saldo), valor: soma((i) => i.valor), saldoFabrica: soma((i) => i.saldoFabrica), saldoObra: soma((i) => i.saldoObra),
    entradasKg: soma((i) => i.entradas), consumidoKg: soma((i) => i.consumos), sobrasKg: soma((i) => i.sobras),
    abaixoMinimo: itens.filter((i) => i.abaixoMinimo).length, lotes: itens.reduce((s, i) => s + i.lotes.filter((l) => l.saldo > 0).length, 0),
    porFamilia: [...fam.values()].sort((a, b) => b.saldo - a.saldo),
  };
}

// ---------------------------------------------------------------------------
// Consumo de aco por obra e servico (custo real de material)
// ---------------------------------------------------------------------------
export interface ConsumoAco { chave: string; nome: string; consumidoKg: number; sobraKg: number; liquidoKg: number; custo: number; custoPorKg: number; movimentos: number }

const vazio = (chave: string, nome: string): ConsumoAco => ({ chave, nome, consumidoKg: 0, sobraKg: 0, liquidoKg: 0, custo: 0, custoPorKg: 0, movimentos: 0 });
const fechar = (c: ConsumoAco): ConsumoAco => ({ ...c, liquidoKg: c.consumidoKg - c.sobraKg, custoPorKg: c.consumidoKg - c.sobraKg > 0 ? c.custo / (c.consumidoKg - c.sobraKg) : 0 });

/** Aco consumido (menos sobras devolvidas) e seu custo, por obra, servico e item. Estornos revertem. */
export function consumoAco(ds: Pick<Dataset, 'movimentosEstoque' | 'servicos' | 'itensEstoque'>, filtro: { codigoObra?: string; de?: string; ate?: string } = {}): { total: ConsumoAco; porServico: ConsumoAco[]; porObra: ConsumoAco[]; porItem: ConsumoAco[] } {
  const movs = (ds.movimentosEstoque ?? []).filter((m) => m.codigoObra && (!filtro.codigoObra || m.codigoObra === filtro.codigoObra) && (!filtro.de || m.data >= filtro.de) && (!filtro.ate || m.data <= filtro.ate)
    && (m.tipo === 'Consumo' || m.tipo === 'Sobra' || (m.tipo === 'Estorno' && (m.origemTipo === 'Consumo' || m.origemTipo === 'Sobra'))));
  const nomeSrv = new Map((ds.servicos ?? []).map((s) => [s.id, `${s.codigo} · ${s.nome}`]));
  const nomeItem = new Map((ds.itensEstoque ?? []).map((i) => [i.id, `${i.codigo} · ${i.descricao}`]));
  const total = vazio('total', 'Total');
  const srv = new Map<string, ConsumoAco>(); const obra = new Map<string, ConsumoAco>(); const item = new Map<string, ConsumoAco>();
  const aplicar = (c: ConsumoAco, m: MovimentoEstoque) => {
    const tipo = m.tipo === 'Estorno' ? m.origemTipo : m.tipo;
    const q = m.tipo === 'Estorno' ? (tipo === 'Consumo' ? -m.quantidade : -m.quantidade) : m.quantidade; // estorno de consumo: quantidade > 0 reduz; de sobra: quantidade < 0 reduz sobra
    if (tipo === 'Consumo') c.consumidoKg += q; else c.sobraKg += q;
    c.custo += (tipo === 'Consumo' ? q : -q) * m.custoUnitario;
    c.movimentos++;
  };
  for (const m of movs) {
    aplicar(total, m);
    const ks = m.servicoId ?? ''; const s = srv.get(ks) ?? vazio(ks, ks ? nomeSrv.get(ks) ?? ks : 'Sem serviço'); aplicar(s, m); srv.set(ks, s);
    const o = obra.get(m.codigoObra!) ?? vazio(m.codigoObra!, m.codigoObra!); aplicar(o, m); obra.set(m.codigoObra!, o);
    const it = item.get(m.itemId) ?? vazio(m.itemId, nomeItem.get(m.itemId) ?? m.itemId); aplicar(it, m); item.set(m.itemId, it);
  }
  const lista = (mp: Map<string, ConsumoAco>) => [...mp.values()].map(fechar).sort((a, b) => b.liquidoKg - a.liquidoKg);
  return { total: fechar(total), porServico: lista(srv), porObra: lista(obra), porItem: lista(item) };
}

// ---------------------------------------------------------------------------
// Rastreabilidade: corrida -> obras/conjuntos; conjunto -> corridas
// ---------------------------------------------------------------------------
export interface ConsumoRastreado extends MovimentoEstoque { marcas: { marca: string; quantidade: number }[]; item: string }
export interface RastroCorrida {
  corrida: string;
  lotes: { item: ItemEstoque; lote: LoteCalc }[];
  entradas: (MovimentoEstoque & { item: string })[];
  consumos: ConsumoRastreado[];
  obras: string[];
  kgEntrado: number;
  kgConsumido: number;
  kgSaldo: number;
}

export function corridas(ds: Pick<Dataset, 'movimentosEstoque'>): string[] {
  return [...new Set((ds.movimentosEstoque ?? []).map((m) => normalizarCorrida(m.corrida)).filter(Boolean))].sort();
}

export function rastrearCorrida(ds: Pick<Dataset, 'itensEstoque' | 'movimentosEstoque' | 'conjuntos'>, corrida: string): RastroCorrida | undefined {
  const c = normalizarCorrida(corrida);
  if (!c) return undefined;
  const movs = ordenar((ds.movimentosEstoque ?? []).filter((m) => normalizarCorrida(m.corrida) === c));
  if (!movs.length) return undefined;
  const pos = posicaoEstoque(ds);
  const nomeItem = new Map((ds.itensEstoque ?? []).map((i) => [i.id, `${i.codigo} · ${i.descricao}`]));
  const marca = new Map((ds.conjuntos ?? []).map((x) => [x.id, x.marca]));
  const lotes = pos.itens.flatMap((i) => i.lotes.filter((l) => l.corrida === c).map((lote) => ({ item: i as ItemEstoque, lote })));
  const entradas = movs.filter((m) => m.tipo === 'Entrada').map((m) => ({ ...m, item: nomeItem.get(m.itemId) ?? m.itemId }));
  const consumos = movs.filter((m) => m.tipo === 'Consumo').map((m) => ({ ...m, item: nomeItem.get(m.itemId) ?? m.itemId, marcas: m.conjuntos.map((x) => ({ marca: marca.get(x.conjuntoId) ?? x.conjuntoId, quantidade: x.quantidade })) }));
  const kgEntrado = entradas.reduce((s, m) => s + m.quantidade, 0);
  const kgConsumido = consumos.reduce((s, m) => s + m.quantidade, 0) - movs.filter((m) => m.tipo === 'Estorno' && m.origemTipo === 'Consumo').reduce((s, m) => s + m.quantidade, 0);
  return { corrida: c, lotes, entradas, consumos, obras: [...new Set(movs.map((m) => m.codigoObra).filter((x): x is string => !!x))], kgEntrado, kgConsumido, kgSaldo: lotes.reduce((s, l) => s + l.lote.saldo, 0) };
}

/** Corridas que entraram em um conjunto (marca), pelos consumos que o citam. */
export function rastrearConjunto(ds: Pick<Dataset, 'itensEstoque' | 'movimentosEstoque'>, conjuntoId: string): { corrida: string; certificado?: string; fornecedor?: string; data: string; kg: number; item: string; quantidade: number }[] {
  const nomeItem = new Map((ds.itensEstoque ?? []).map((i) => [i.id, `${i.codigo} · ${i.descricao}`]));
  const cert = new Map<string, { certificado?: string; fornecedor?: string }>();
  for (const m of ds.movimentosEstoque ?? []) if (m.tipo === 'Entrada' && m.corrida) cert.set(`${m.itemId}|${normalizarCorrida(m.corrida)}`, { certificado: m.certificado, fornecedor: m.fornecedor });
  return ordenar((ds.movimentosEstoque ?? []).filter((m) => m.tipo === 'Consumo' && m.conjuntos.some((c) => c.conjuntoId === conjuntoId)))
    .map((m) => ({ corrida: normalizarCorrida(m.corrida) || '(sem corrida)', ...cert.get(`${m.itemId}|${normalizarCorrida(m.corrida)}`), data: m.data, kg: m.quantidade, item: nomeItem.get(m.itemId) ?? m.itemId, quantidade: m.conjuntos.find((c) => c.conjuntoId === conjuntoId)!.quantidade }));
}

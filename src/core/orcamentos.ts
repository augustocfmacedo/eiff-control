// Orcamentos: custo unitario por composicao (insumos + composicoes auxiliares), planilha de venda com
// BDI, curva ABC de insumos e de itens, e conversao do orcamento contratado em servicos da obra.
// Mesma logica dos orcamentos de engenharia (SINAPI/TCPO): custo direto = soma(coeficiente x preco).

import type { Composicao, EtapaObra, Insumo, ItemOrcamento, Orcamento, Servico, TipoInsumo } from './types';

export const TIPOS_INSUMO: TipoInsumo[] = ['Material', 'Mão de obra', 'Equipamento', 'Serviço', 'Outros'];

export interface Catalogo {
  insumos: Insumo[];
  composicoes: Composicao[];
}

const porTipoVazio = (): Record<TipoInsumo, number> => ({ Material: 0, 'Mão de obra': 0, Equipamento: 0, Serviço: 0, Outros: 0 });

// ---------------------------------------------------------------------------
// Custo da composicao (recursivo, com cache e protecao contra ciclos)
// ---------------------------------------------------------------------------
export interface CustoComposicao {
  custoUnitario: number;
  porTipo: Record<TipoInsumo, number>;
  /** quantidade de cada insumo por unidade da composicao (explosao completa) */
  insumos: Map<string, number>;
  faltantes: string[]; // refIds nao encontrados no catalogo
  ciclo: boolean;
}

export class Calculadora {
  private insumo: Map<string, Insumo>;
  private comp: Map<string, Composicao>;
  private cache = new Map<string, CustoComposicao>();
  constructor(cat: Catalogo) {
    this.insumo = new Map(cat.insumos.map((i) => [i.id, i]));
    this.comp = new Map(cat.composicoes.map((c) => [c.id, c]));
  }
  getInsumo(id: string) { return this.insumo.get(id); }
  getComposicao(id: string) { return this.comp.get(id); }

  custo(id: string, visitados: Set<string> = new Set()): CustoComposicao {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const c = this.comp.get(id);
    const r: CustoComposicao = { custoUnitario: 0, porTipo: porTipoVazio(), insumos: new Map(), faltantes: [], ciclo: false };
    if (!c) { r.faltantes.push(id); return r; }
    if (visitados.has(id)) { r.ciclo = true; return r; }
    visitados.add(id);
    for (const it of c.itens) {
      if (it.tipo === 'Insumo') {
        const i = this.insumo.get(it.refId);
        if (!i) { r.faltantes.push(it.refId); continue; }
        const v = it.coeficiente * i.preco;
        r.custoUnitario += v;
        r.porTipo[i.tipo] += v;
        r.insumos.set(i.id, (r.insumos.get(i.id) ?? 0) + it.coeficiente);
      } else {
        const sub = this.custo(it.refId, visitados);
        if (sub.ciclo) r.ciclo = true;
        r.faltantes.push(...sub.faltantes);
        r.custoUnitario += it.coeficiente * sub.custoUnitario;
        for (const t of TIPOS_INSUMO) r.porTipo[t] += it.coeficiente * sub.porTipo[t];
        for (const [iid, q] of sub.insumos) r.insumos.set(iid, (r.insumos.get(iid) ?? 0) + it.coeficiente * q);
      }
    }
    visitados.delete(id);
    if (!r.ciclo) this.cache.set(id, r);
    return r;
  }
}

/** Verifica se incluir `itens` em `composicaoId` cria ciclo (a composicao referenciando a si mesma). */
export function criaCiclo(composicaoId: string, itens: Composicao['itens'], cat: Catalogo): boolean {
  const comp = new Map(cat.composicoes.map((c) => [c.id, c]));
  const visita = (id: string, pilha: Set<string>): boolean => {
    if (id === composicaoId) return true;
    if (pilha.has(id)) return false;
    pilha.add(id);
    const c = comp.get(id);
    return !!c && c.itens.some((it) => it.tipo === 'Composição' && visita(it.refId, pilha));
  };
  return itens.some((it) => it.tipo === 'Composição' && visita(it.refId, new Set()));
}

// ---------------------------------------------------------------------------
// Orcamento
// ---------------------------------------------------------------------------
export interface ItemOrcamentoCalc extends ItemOrcamento {
  custoUnitario: number;
  custoTotal: number;
  precoUnitario: number; // com BDI, ou preco de venda informado
  precoTotal: number;
  margem: number; // precoTotal - custoTotal
  pctMargem: number;
  precoInformado: boolean;
  porTipo: Record<TipoInsumo, number>; // custo total por tipo
  origemCusto: 'Composição' | 'Manual' | 'Sem custo';
  composicao?: Composicao;
  incompleto: boolean; // composicao com itens faltantes ou ciclo
}

export type ClasseAbc = 'A' | 'B' | 'C';

export interface CurvaAbcItem {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  precoUnitario: number;
  valor: number;
  pct: number;
  acumulado: number;
  classe: ClasseAbc;
  tipo?: TipoInsumo;
}

export interface OrcamentoCalc extends Orcamento {
  itens: ItemOrcamentoCalc[];
  custoTotal: number;
  precoTotal: number;
  valorBdi: number;
  porTipo: Record<TipoInsumo, number>;
  porEtapa: { etapa: string; custo: number; preco: number; pct: number; itens: number }[];
  porServico: { servicoId: string; custo: number; preco: number; itens: number }[]; // itens vinculados a servicos da obra
  margem: number;
  pctMargem: number;
  curvaInsumos: CurvaAbcItem[];
  curvaItens: CurvaAbcItem[];
  incompletos: number;
  semCusto: number;
}

export const LIMITES_ABC = { A: 0.8, B: 0.95 };

export function classificarAbc<T extends { valor: number }>(itens: T[]): (T & { pct: number; acumulado: number; classe: ClasseAbc })[] {
  const total = itens.reduce((a, i) => a + Math.max(0, i.valor), 0);
  let acc = 0;
  return [...itens].sort((a, b) => b.valor - a.valor).map((i) => {
    const pct = total ? Math.max(0, i.valor) / total : 0;
    acc += pct;
    const classe: ClasseAbc = acc <= LIMITES_ABC.A + 1e-9 ? 'A' : acc <= LIMITES_ABC.B + 1e-9 ? 'B' : 'C';
    return { ...i, pct, acumulado: Math.min(1, acc), classe };
  });
}

export function calcOrcamento(o: Orcamento, cat: Catalogo): OrcamentoCalc {
  const calc = new Calculadora(cat);
  const consumo = new Map<string, number>();
  const itens: ItemOrcamentoCalc[] = [...o.itens].sort((a, b) => a.ordem - b.ordem).map((it) => {
    let custoUnitario = 0;
    let porTipo = porTipoVazio();
    let origemCusto: ItemOrcamentoCalc['origemCusto'] = 'Sem custo';
    let incompleto = false;
    const composicao = it.composicaoId ? calc.getComposicao(it.composicaoId) : undefined;
    if (it.composicaoId) {
      const c = calc.custo(it.composicaoId);
      custoUnitario = c.custoUnitario;
      porTipo = { ...c.porTipo };
      origemCusto = 'Composição';
      incompleto = c.ciclo || c.faltantes.length > 0 || !composicao;
      for (const [iid, q] of c.insumos) consumo.set(iid, (consumo.get(iid) ?? 0) + q * it.quantidade);
    } else if (it.custoUnitarioManual !== undefined && it.custoUnitarioManual !== null) {
      custoUnitario = it.custoUnitarioManual;
      porTipo.Outros = custoUnitario;
      origemCusto = 'Manual';
    }
    const custoTotal = custoUnitario * it.quantidade;
    const precoInformado = it.precoUnitarioVenda !== undefined && it.precoUnitarioVenda !== null;
    const precoUnitario = precoInformado ? it.precoUnitarioVenda! : custoUnitario * (1 + o.bdi);
    const precoTotal = precoUnitario * it.quantidade;
    for (const t of TIPOS_INSUMO) porTipo[t] *= it.quantidade;
    return { ...it, custoUnitario, custoTotal, precoUnitario, precoTotal, margem: precoTotal - custoTotal, pctMargem: precoTotal ? (precoTotal - custoTotal) / precoTotal : 0, precoInformado, porTipo, origemCusto, composicao, incompleto };
  });
  const custoTotal = itens.reduce((a, i) => a + i.custoTotal, 0);
  const precoTotal = itens.reduce((a, i) => a + i.precoTotal, 0);
  const porTipo = porTipoVazio();
  for (const i of itens) for (const t of TIPOS_INSUMO) porTipo[t] += i.porTipo[t];
  const etapas = [...new Set(itens.map((i) => i.etapa || 'Sem etapa'))];
  const porEtapa = etapas.map((etapa) => {
    const meus = itens.filter((i) => (i.etapa || 'Sem etapa') === etapa);
    const custo = meus.reduce((a, i) => a + i.custoTotal, 0);
    return { etapa, custo, preco: meus.reduce((a, i) => a + i.precoTotal, 0), pct: custoTotal ? custo / custoTotal : 0, itens: meus.length };
  });
  const servicos = [...new Set(itens.map((i) => i.servicoId).filter((s): s is string => !!s))];
  const porServico = servicos.map((servicoId) => {
    const meus = itens.filter((i) => i.servicoId === servicoId);
    return { servicoId, custo: meus.reduce((a, i) => a + i.custoTotal, 0), preco: meus.reduce((a, i) => a + i.precoTotal, 0), itens: meus.length };
  });
  const curvaInsumos = classificarAbc([...consumo].map(([iid, q]) => {
    const i = calc.getInsumo(iid);
    return { id: iid, codigo: i?.codigo ?? iid, descricao: i?.descricao ?? '(insumo não encontrado)', unidade: i?.unidade ?? '', quantidade: q, precoUnitario: i?.preco ?? 0, valor: q * (i?.preco ?? 0), tipo: i?.tipo };
  }));
  const curvaItens = classificarAbc(itens.map((i) => ({ id: i.id, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade, precoUnitario: i.custoUnitario, valor: i.custoTotal })));
  return {
    ...o, itens, custoTotal, precoTotal, valorBdi: precoTotal - custoTotal, margem: precoTotal - custoTotal, pctMargem: precoTotal ? (precoTotal - custoTotal) / precoTotal : 0, porTipo, porEtapa, porServico, curvaInsumos, curvaItens,
    incompletos: itens.filter((i) => i.incompleto).length, semCusto: itens.filter((i) => i.origemCusto === 'Sem custo').length,
  };
}

// ---------------------------------------------------------------------------
// Conversao em servicos da obra (orcamento contratado)
// ---------------------------------------------------------------------------
/** Mapeia a etapa textual do orcamento para a etapa padrao da obra. */
export function etapaObraDe(texto: string): EtapaObra {
  const t = texto.toLowerCase();
  if (/projeto|engenharia|detalh/.test(t)) return 'Projeto';
  if (/montag|içamento|icamento|fixação|torque/.test(t)) return 'Montagem';
  if (/fabric|estrutura|aço|aco|perfil|solda|corte/.test(t)) return 'Fabricação';
  if (/pintura|tinta|jateamento/.test(t)) return 'Pintura';
  if (/cobertura|telha|fechamento|calha|rufo/.test(t)) return 'Cobertura e fechamento';
  if (/civil|funda|concreto|alvenaria|chumbador|grout/.test(t)) return 'Civil';
  if (/instala|elétr|eletr|hidr/.test(t)) return 'Instalações';
  return 'Outros';
}

/**
 * Gera os servicos da obra a partir dos itens do orcamento: custo orcado = custo direto do item,
 * preco de venda = preco com BDI (ou redistribuido para fechar no valor do contrato quando informado).
 */
export function servicosDeOrcamento(o: OrcamentoCalc, codigoObra: string, sigla: string, existentes: Servico[], valorContrato?: number): Servico[] {
  const fator = valorContrato && o.precoTotal > 0 ? valorContrato / o.precoTotal : 1;
  const usados = new Set(existentes.filter((s) => s.codigoObra === codigoObra).map((s) => s.codigo));
  let n = existentes.filter((s) => s.codigoObra === codigoObra).length;
  return o.itens.filter((i) => i.quantidade > 0).map((i) => {
    let codigo = i.codigo?.trim() ? `${sigla}-${i.codigo.trim()}` : '';
    while (!codigo || usados.has(codigo)) codigo = `${sigla}-${String(++n).padStart(2, '0')}`;
    usados.add(codigo);
    return {
      id: `SRV-${codigoObra}-${i.id}`, codigoObra, codigo, nome: i.descricao, etapa: etapaObraDe(`${i.etapa} ${i.descricao}`), unidade: i.unidade || 'vb',
      quantidadeOrcada: i.quantidade, quantidadeExecutada: 0, custoOrcado: Math.round(i.custoTotal * 100) / 100, precoVenda: Math.round(i.precoTotal * fator * 100) / 100,
      valorBaseOrcamento: Math.round(i.precoTotal * 100) / 100, status: 'Não iniciado', observacoes: `Gerado do orçamento ${o.codigo}${i.composicao ? ` · composição ${i.composicao.codigo}` : ''}`, ativo: true,
    };
  });
}

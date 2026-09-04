// Producao por estacao: apontamento diario de quilos, pecas e horas por estacao da fabrica ou do canteiro,
// produtividade em kg por hora-homem contra a meta das composicoes, e romaneios de expedicao.
// A conclusao de certas estacoes alimenta a lista de materiais (fabricado, expedido, montado) e as ordens.

import type { ApontamentoEstacao, Colaborador, Dataset, LinhaProducao, Romaneio } from './types';

export const ESTACOES_FABRICA = ['Corte', 'Furação', 'Montagem e ponteamento', 'Solda', 'Pintura', 'Expedição'] as const;
export const ESTACOES_CANTEIRO = ['Recebimento em obra', 'Pré-montagem', 'Içamento', 'Fixação / torqueamento', 'Liberação'] as const;
export const estacoesDe = (linha: LinhaProducao): readonly string[] => (linha === 'Fabricação' ? ESTACOES_FABRICA : ESTACOES_CANTEIRO);
/** Estacao que conclui cada marco da lista de materiais. */
export const ESTACAO_CONCLUI: Record<string, 'fabricado' | 'expedido' | 'montado'> = { Pintura: 'fabricado', Expedição: 'expedido', Liberação: 'montado' };
/** Meta padrao: 17,5 HH/t na fabrica (composicao EIFF-FAB-KG) = 57 kg/HH; 26 HH/t em campo = 38 kg/HH. */
export const META_KG_HH: Record<LinhaProducao, number> = { Fabricação: 1000 / 17.5, Montagem: 1000 / 26 };

export interface ApontamentoEstacaoCalc extends ApontamentoEstacao {
  horas: number; // soma das horas dos colaboradores
  kgPorHH: number;
  custoMaoDeObra: number; // horas x custo/hora dos colaboradores
  custoPorKg: number;
}

export function calcApontamentoEstacao(a: ApontamentoEstacao, colaboradores: Colaborador[]): ApontamentoEstacaoCalc {
  const custoDe = new Map(colaboradores.map((c) => [c.id, c.custoHora]));
  const horas = a.colaboradores.reduce((s, c) => s + c.horas, 0);
  const custoMaoDeObra = a.colaboradores.reduce((s, c) => s + c.horas * (custoDe.get(c.colaboradorId) ?? 0), 0);
  return { ...a, horas, kgPorHH: horas ? a.pesoKg / horas : 0, custoMaoDeObra, custoPorKg: a.pesoKg ? custoMaoDeObra / a.pesoKg : 0 };
}

export interface LinhaProdutividade { chave: string; nome: string; kg: number; horas: number; pecas: number; kgPorHH: number; custo: number; custoPorKg: number; dias: number; meta?: number; pctMeta?: number }

export interface ResumoProdutividade {
  apontamentos: ApontamentoEstacaoCalc[];
  kgFabricados: number; // estacao Pintura (conclui fabricacao)
  kgExpedidos: number;
  kgMontados: number; // estacao Liberacao
  horasFabrica: number;
  horasCanteiro: number;
  kgPorHHFabrica: number;
  kgPorHHCanteiro: number;
  metaFabrica: number;
  metaCanteiro: number;
  custoMaoDeObra: number;
  porEstacao: LinhaProdutividade[];
  porColaborador: LinhaProdutividade[];
  porDia: { data: string; fabrica: number; canteiro: number; horas: number }[];
}

export function resumoProdutividade(ds: Pick<Dataset, 'apontamentosEstacao' | 'colaboradores'>, filtro: { codigoObra?: string; de?: string; ate?: string; linha?: LinhaProducao } = {}, metas: Record<LinhaProducao, number> = META_KG_HH): ResumoProdutividade {
  const aps = (ds.apontamentosEstacao ?? [])
    .filter((a) => (!filtro.codigoObra || a.codigoObra === filtro.codigoObra) && (!filtro.de || a.data >= filtro.de) && (!filtro.ate || a.data <= filtro.ate) && (!filtro.linha || a.linha === filtro.linha))
    .map((a) => calcApontamentoEstacao(a, ds.colaboradores))
    .sort((a, b) => (a.data < b.data ? 1 : -1));
  const soma = (f: (a: ApontamentoEstacaoCalc) => number, p: (a: ApontamentoEstacaoCalc) => boolean = () => true) => aps.filter(p).reduce((s, a) => s + f(a), 0);
  const nomeCol = new Map(ds.colaboradores.map((c) => [c.id, c.nome]));
  const grupo = (chave: (a: ApontamentoEstacaoCalc) => { k: string; nome: string; meta?: number }[], horasDe?: (a: ApontamentoEstacaoCalc, k: string) => number, kgDe?: (a: ApontamentoEstacaoCalc, k: string) => number) => {
    const m = new Map<string, LinhaProdutividade & { datas: Set<string> }>();
    for (const a of aps) for (const { k, nome, meta } of chave(a)) {
      const g = m.get(k) ?? { chave: k, nome, kg: 0, horas: 0, pecas: 0, kgPorHH: 0, custo: 0, custoPorKg: 0, dias: 0, meta, datas: new Set<string>() };
      const h = horasDe ? horasDe(a, k) : a.horas;
      const kg = kgDe ? kgDe(a, k) : a.pesoKg;
      g.kg += kg; g.horas += h; g.pecas += kgDe ? 0 : a.pecas; g.custo += horasDe ? h * (ds.colaboradores.find((c) => c.id === k)?.custoHora ?? 0) : a.custoMaoDeObra; g.datas.add(a.data);
      m.set(k, g);
    }
    return [...m.values()].map(({ datas, ...g }) => ({ ...g, dias: datas.size, kgPorHH: g.horas ? g.kg / g.horas : 0, custoPorKg: g.kg ? g.custo / g.kg : 0, pctMeta: g.meta && g.horas ? g.kg / g.horas / g.meta : undefined })).sort((a, b) => b.kg - a.kg);
  };
  const porEstacao = grupo((a) => [{ k: `${a.linha}:${a.estacao}`, nome: `${a.estacao} (${a.linha === 'Fabricação' ? 'fábrica' : 'canteiro'})` }]);
  // colaborador: horas e kg proporcionais as horas dele no apontamento
  const porColaborador = grupo(
    (a) => a.colaboradores.map((c) => ({ k: c.colaboradorId, nome: nomeCol.get(c.colaboradorId) ?? c.colaboradorId, meta: metas[a.linha] })),
    (a, k) => a.colaboradores.find((c) => c.colaboradorId === k)?.horas ?? 0,
    (a, k) => (a.horas ? (a.pesoKg * (a.colaboradores.find((c) => c.colaboradorId === k)?.horas ?? 0)) / a.horas : 0),
  );
  const dias = new Map<string, { data: string; fabrica: number; canteiro: number; horas: number }>();
  for (const a of aps) { const dd = dias.get(a.data) ?? { data: a.data, fabrica: 0, canteiro: 0, horas: 0 }; if (a.linha === 'Fabricação') dd.fabrica += a.pesoKg; else dd.canteiro += a.pesoKg; dd.horas += a.horas; dias.set(a.data, dd); }
  const horasFabrica = soma((a) => a.horas, (a) => a.linha === 'Fabricação');
  const horasCanteiro = soma((a) => a.horas, (a) => a.linha === 'Montagem');
  const kgFab = soma((a) => a.pesoKg, (a) => a.linha === 'Fabricação');
  const kgCant = soma((a) => a.pesoKg, (a) => a.linha === 'Montagem');
  return {
    apontamentos: aps,
    kgFabricados: soma((a) => a.pesoKg, (a) => ESTACAO_CONCLUI[a.estacao] === 'fabricado'),
    kgExpedidos: soma((a) => a.pesoKg, (a) => ESTACAO_CONCLUI[a.estacao] === 'expedido'),
    kgMontados: soma((a) => a.pesoKg, (a) => ESTACAO_CONCLUI[a.estacao] === 'montado'),
    horasFabrica, horasCanteiro,
    kgPorHHFabrica: horasFabrica ? kgFab / horasFabrica : 0,
    kgPorHHCanteiro: horasCanteiro ? kgCant / horasCanteiro : 0,
    metaFabrica: metas.Fabricação, metaCanteiro: metas.Montagem,
    custoMaoDeObra: soma((a) => a.custoMaoDeObra),
    porEstacao, porColaborador,
    porDia: [...dias.values()].sort((a, b) => (a.data < b.data ? -1 : 1)),
  };
}

export interface RomaneioCalc extends Romaneio { pesoTotal: number; pecas: number }
export function calcRomaneio(r: Romaneio, conjuntos: Dataset['conjuntos']): RomaneioCalc {
  const peso = new Map(conjuntos.map((c) => [c.id, c.pesoUnitario]));
  return { ...r, pesoTotal: r.itens.reduce((s, i) => s + i.quantidade * (peso.get(i.conjuntoId) ?? 0), 0), pecas: r.itens.reduce((s, i) => s + i.quantidade, 0) };
}

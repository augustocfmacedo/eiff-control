// Equipe e produtividade: efetivo, horas, custo de mao de obra apropriado, producao e ocorrencias,
// calculados a partir dos apontamentos diarios de obra e de fabrica.

import type { Apontamento, ApontamentoLinha, Colaborador, Dataset, LocalTrabalho, Tarefa } from './types';

export const FATOR_HORA_EXTRA = 1.5;

export interface PeriodoDatas {
  ini: string;
  fim: string;
}

export interface FiltroEquipe {
  local?: LocalTrabalho | '';
  codigoObra?: string;
  equipe?: string;
}

export const custoLinha = (l: ApontamentoLinha, c?: Colaborador): number =>
  c ? l.horas * c.custoHora + l.horasExtras * c.custoHora * FATOR_HORA_EXTRA : 0;

export interface LinhaColaborador {
  colaborador: Colaborador;
  dias: number;
  presentes: number;
  faltas: number;
  atestados: number;
  horas: number;
  horasExtras: number;
  custo: number;
  absenteismo: number;
}

export interface LinhaServicoMO {
  servicoId: string;
  nome: string;
  codigoObra: string;
  horas: number;
  horasExtras: number;
  custoMO: number;
  custoOrcado: number;
  producao: { unidade: string; quantidade: number }[];
  hhPorUnidade?: number; // horas por unidade principal produzida
}

export interface ResumoEquipe {
  periodo: PeriodoDatas;
  apontamentos: Apontamento[];
  diasApontados: number;
  efetivoMedio: number;
  presentes: number;
  faltas: number;
  atestados: number;
  absenteismo: number; // faltas / (presentes + faltas)
  horas: number;
  horasExtras: number;
  pctHorasExtras: number;
  custoMO: number;
  horasPerdidas: number;
  ocorrencias: { tipo: string; quantidade: number; horas: number }[];
  producao: { unidade: string; quantidade: number }[];
  hhPorTonelada?: number;
  porColaborador: LinhaColaborador[];
  porEquipe: { equipe: string; efetivoMedio: number; horas: number; custo: number }[];
  porServico: LinhaServicoMO[];
  porLocal: { local: string; horas: number; custo: number; dias: number }[];
}

export function resumoEquipe(ds: Dataset, periodo: PeriodoDatas, filtro: FiltroEquipe = {}): ResumoEquipe {
  const colabs = new Map((ds.colaboradores ?? []).map((c) => [c.id, c]));
  const aps = (ds.apontamentos ?? []).filter(
    (a) => a.data >= periodo.ini && a.data <= periodo.fim && (!filtro.local || a.local === filtro.local) && (!filtro.codigoObra || a.codigoObra === filtro.codigoObra),
  );
  const linhas = aps.flatMap((a) => a.linhas.map((l) => ({ a, l, c: colabs.get(l.colaboradorId) }))).filter((x) => x.c && (!filtro.equipe || x.c.equipe === filtro.equipe));
  const dias = new Set(aps.map((a) => a.data)).size;
  const presentesLinhas = linhas.filter((x) => x.l.presenca === 'Presente');
  const presentes = presentesLinhas.length;
  const faltas = linhas.filter((x) => x.l.presenca === 'Falta').length;
  const atestados = linhas.filter((x) => x.l.presenca === 'Atestado').length;
  const horas = presentesLinhas.reduce((s, x) => s + x.l.horas, 0);
  const horasExtras = presentesLinhas.reduce((s, x) => s + x.l.horasExtras, 0);
  const custoMO = presentesLinhas.reduce((s, x) => s + custoLinha(x.l, x.c), 0);

  const ocMap = new Map<string, { quantidade: number; horas: number }>();
  for (const a of aps) for (const o of a.ocorrencias) { const v = ocMap.get(o.tipo) ?? { quantidade: 0, horas: 0 }; ocMap.set(o.tipo, { quantidade: v.quantidade + 1, horas: v.horas + o.horasPerdidas }); }
  const ocorrencias = [...ocMap.entries()].map(([tipo, v]) => ({ tipo, ...v })).sort((a, b) => b.horas - a.horas);
  const horasPerdidas = ocorrencias.reduce((s, o) => s + o.horas, 0);

  const prodMap = new Map<string, number>();
  for (const a of aps) for (const p of a.producao) prodMap.set(p.unidade, (prodMap.get(p.unidade) ?? 0) + p.quantidade);
  const producao = [...prodMap.entries()].map(([unidade, quantidade]) => ({ unidade, quantidade })).sort((a, b) => b.quantidade - a.quantidade);
  const toneladas = prodMap.get('t') ?? 0;

  const porColabMap = new Map<string, LinhaColaborador>();
  for (const x of linhas) {
    const r = porColabMap.get(x.c!.id) ?? { colaborador: x.c!, dias: 0, presentes: 0, faltas: 0, atestados: 0, horas: 0, horasExtras: 0, custo: 0, absenteismo: 0 };
    r.dias += 1;
    if (x.l.presenca === 'Presente') { r.presentes += 1; r.horas += x.l.horas; r.horasExtras += x.l.horasExtras; r.custo += custoLinha(x.l, x.c); }
    if (x.l.presenca === 'Falta') r.faltas += 1;
    if (x.l.presenca === 'Atestado') r.atestados += 1;
    porColabMap.set(x.c!.id, r);
  }
  const porColaborador = [...porColabMap.values()].map((r) => ({ ...r, absenteismo: r.presentes + r.faltas ? r.faltas / (r.presentes + r.faltas) : 0 })).sort((a, b) => b.horas - a.horas);

  const eqMap = new Map<string, { horas: number; custo: number; presencas: number }>();
  for (const x of presentesLinhas) { const v = eqMap.get(x.c!.equipe) ?? { horas: 0, custo: 0, presencas: 0 }; eqMap.set(x.c!.equipe, { horas: v.horas + x.l.horas + x.l.horasExtras, custo: v.custo + custoLinha(x.l, x.c), presencas: v.presencas + 1 }); }
  const porEquipe = [...eqMap.entries()].map(([equipe, v]) => ({ equipe, horas: v.horas, custo: v.custo, efetivoMedio: dias ? v.presencas / dias : 0 })).sort((a, b) => b.horas - a.horas);

  const servMap = new Map<string, LinhaServicoMO>();
  for (const x of presentesLinhas) {
    if (!x.l.servicoId) continue;
    const s = ds.servicos.find((sv) => sv.id === x.l.servicoId);
    const r = servMap.get(x.l.servicoId) ?? { servicoId: x.l.servicoId, nome: s ? `${s.codigo} · ${s.nome}` : x.l.servicoId, codigoObra: s?.codigoObra ?? x.a.codigoObra ?? '', horas: 0, horasExtras: 0, custoMO: 0, custoOrcado: s?.custoOrcado ?? 0, producao: [] };
    r.horas += x.l.horas; r.horasExtras += x.l.horasExtras; r.custoMO += custoLinha(x.l, x.c);
    servMap.set(x.l.servicoId, r);
  }
  for (const a of aps) for (const p of a.producao) {
    if (!p.servicoId) continue;
    const r = servMap.get(p.servicoId);
    if (!r) continue;
    const u = r.producao.find((q) => q.unidade === p.unidade);
    if (u) u.quantidade += p.quantidade; else r.producao.push({ unidade: p.unidade, quantidade: p.quantidade });
  }
  const porServico = [...servMap.values()].map((r) => { const principal = r.producao[0]; return { ...r, hhPorUnidade: principal && principal.quantidade > 0 ? (r.horas + r.horasExtras) / principal.quantidade : undefined }; }).sort((a, b) => b.horas - a.horas);

  const locMap = new Map<string, { horas: number; custo: number; dias: Set<string> }>();
  for (const x of presentesLinhas) { const k = x.a.local === 'Obra' ? `Obra ${x.a.codigoObra ?? ''}` : x.a.local; const v = locMap.get(k) ?? { horas: 0, custo: 0, dias: new Set<string>() }; v.horas += x.l.horas + x.l.horasExtras; v.custo += custoLinha(x.l, x.c); v.dias.add(x.a.data); locMap.set(k, v); }
  const porLocal = [...locMap.entries()].map(([local, v]) => ({ local, horas: v.horas, custo: v.custo, dias: v.dias.size }));

  return {
    periodo, apontamentos: aps, diasApontados: dias,
    efetivoMedio: dias ? presentes / dias : 0, presentes, faltas, atestados,
    absenteismo: presentes + faltas ? faltas / (presentes + faltas) : 0,
    horas, horasExtras, pctHorasExtras: horas ? horasExtras / horas : 0, custoMO, horasPerdidas, ocorrencias, producao,
    hhPorTonelada: toneladas > 0 ? (horas + horasExtras) / toneladas : undefined,
    porColaborador, porEquipe, porServico, porLocal,
  };
}

/** Apontamento existente de um dia/local (obra especifica quando local = Obra). */
export function apontamentoDoDia(ds: Dataset, data: string, local: LocalTrabalho, codigoObra?: string): Apontamento | undefined {
  return (ds.apontamentos ?? []).find((a) => a.data === data && a.local === local && (local !== 'Obra' || a.codigoObra === codigoObra));
}

export interface LocalApontamento {
  local: LocalTrabalho;
  codigoObra?: string;
  rotulo: string;
  apontamento?: Apontamento;
  colaboradores: Colaborador[];
}

/** Locais que devem ter diario no dia: obras ativas com equipe e a fabrica, com o status do apontamento. */
export function locaisDoDia(ds: Dataset, data: string): LocalApontamento[] {
  const colabs = (ds.colaboradores ?? []).filter((c) => c.ativo);
  const out: LocalApontamento[] = [];
  const fab = colabs.filter((c) => c.local === 'Fábrica');
  if (fab.length) out.push({ local: 'Fábrica', rotulo: 'Fábrica', apontamento: apontamentoDoDia(ds, data, 'Fábrica'), colaboradores: fab });
  for (const o of ds.obras.filter((x) => x.status === 'Em execução' || x.status === 'Planejamento')) {
    const equipe = colabs.filter((c) => c.local === 'Obra' && (!c.codigoObraPadrao || c.codigoObraPadrao === o.codigo));
    out.push({ local: 'Obra', codigoObra: o.codigo, rotulo: `${o.codigo} · ${o.nome}`, apontamento: apontamentoDoDia(ds, data, 'Obra', o.codigo), colaboradores: equipe });
  }
  return out;
}

export interface TarefaCalc extends Tarefa {
  atrasada: boolean;
  diasParaPrazo: number;
}

export function calcTarefas(ds: Dataset, dataBase: string): TarefaCalc[] {
  const dia = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
  return (ds.tarefas ?? []).map((t) => ({ ...t, diasParaPrazo: t.prazo ? dia(t.prazo, dataBase) : 0, atrasada: t.status !== 'Concluída' && !!t.prazo && t.prazo < dataBase }));
}

export const STATUS_TAREFA: Tarefa['status'][] = ['Aberta', 'Em andamento', 'Bloqueada', 'Concluída'];
export const FUNCOES_PADRAO = ['Encarregado', 'Montador', 'Soldador', 'Caldeireiro', 'Ajudante', 'Pintor', 'Operador de máquina', 'Projetista', 'Almoxarife', 'Motorista', 'Técnico de segurança', 'Administrativo'];
export const TIPOS_OCORRENCIA = ['Chuva', 'Acidente', 'Paralisação', 'Falta de material', 'Falta de equipamento', 'Retrabalho', 'Outra'] as const;

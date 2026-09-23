// LE-3C — politica PILOTO do CNO e lote determinístico de dry-run.
//
// Puro. A politica aqui e a PRIMEIRA hipotese operacional da EIFF, congelada para medir conversao — nao a
// regra definitiva. Ela foi escolhida com a matriz do LE3-B (§35.8) na mao e sera revista com dados de
// conversao, em gate proprio. Nada neste modulo pontua, classifica ou ordena comercialmente: a ordem do lote e
// controle de lote (evento mais recente primeiro, CNO como desempate), nao prioridade.
//
// Zero persistencia: o maximo que sai daqui e uma projecao de manifest em memoria. `RegistroFonte`, Empresa,
// Projeto e Sinal so nascem no gate de ingestao, pela porta governada do LE-2.
import { dataEventoCno, envelopeCno, sinalCno, type CnoObservacao } from './cnoDadosAbertos';
import { payloadFingerprint } from './leadEngineIntake';
import type { CnoSnapshotDescriptor } from './cnoSnapshot';
import { areaM2, avaliarPolitica, dataMenosDias, type CnoDiscoveryPolicy, type ResultadoPolitica } from './cnoDiscoveryPolicy';

// --------------------------------------------------------------------------------------------- politica V1
export const CNO_PILOT_POLICY_VERSION = 'CNO_PILOT_POLICY_V1' as const;

/** Parametros fixos do piloto. `janelaDias` vira `eventoDepoisDe` so quando a data de referencia e informada. */
export const CNO_PILOT_POLICY_V1 = {
  ufs: ['GO'],
  situacoes: ['02'], // ATIVA
  exigirPessoaJuridica: true,
  exigirCnpjValido: true,
  exigirSinal: true,
  areaMinimaM2: 1000,
  janelaDias: 90,
  categorias: ['Obra Nova', 'Acréscimo', 'Reforma'],
  // deliberadamente SEM filtro de destinacao: a destinacao acompanha o candidato para medir conversao depois
} as const;

/**
 * A politica avaliavel, derivada da data de referencia informada pela execucao. Nao existe `new Date()`:
 * mesma referencia, mesma politica, mesmo resultado — e por isso o dry-run e reproduzivel.
 */
export function politicaPiloto(dataReferencia: string): CnoDiscoveryPolicy {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) throw new Error(`data de referencia invalida: ${dataReferencia} (esperado AAAA-MM-DD)`);
  const v = CNO_PILOT_POLICY_V1;
  return {
    ufs: [...v.ufs],
    situacoes: [...v.situacoes],
    exigirPessoaJuridica: v.exigirPessoaJuridica,
    exigirCnpjValido: v.exigirCnpjValido,
    exigirSinal: v.exigirSinal,
    areaMinimaM2: v.areaMinimaM2,
    categorias: [...v.categorias],
    eventoDepoisDe: dataMenosDias(dataReferencia, v.janelaDias),
  };
}

// ---------------------------------------------------------------------------------------------- manifest
/** O que vai para o manifest local de auditoria. So obras com PJ passam na politica, entao nao ha dado de PF. */
export interface EntradaManifest {
  cno: string;
  eventoEm: string;
  origemEvento: string;
  tipoSinal: 'CNO_NEW' | 'CNO_EXPANSION';
  municipio?: string;
  uf?: string;
  areaTotal?: number;
  categorias: string[];
  destinacoes: string[];
  situacao?: string;
  cnpjResponsavel: string;
  nomeResponsavel: string;
  qualificacaoResponsavel?: string;
  qualificacaoResponsavelNome?: string;
  /** o MESMO fingerprint que o intake do LE-1 calcularia sobre o envelope */
  payloadFingerprint: string;
}

/** Avalia e, se elegivel, projeta. Devolve tambem os motivos para o dry-run contar recusas. */
export function avaliarPiloto(obs: CnoObservacao, politica: CnoDiscoveryPolicy): { resultado: ResultadoPolitica; entrada?: EntradaManifest } {
  const resultado = avaliarPolitica(obs.canonical, politica);
  if (!resultado.elegivel) return { resultado };
  return { resultado, entrada: projetarEntrada(obs) };
}

/** Projecao segura: nada de evidence, endereco ou NI bruto. Lanca se a obra nao tiver o que a politica exige. */
export function projetarEntrada(obs: CnoObservacao): EntradaManifest {
  const o = obs.canonical;
  const ev = dataEventoCno(o);
  const sinal = sinalCno(o);
  if (!ev || sinal === 'NENHUM' || !o.cnpjResponsavel || !o.nomeResponsavel) {
    throw new Error(`obra ${o.cno} nao e projetavel: exige evento datado, sinal e PJ (a politica deveria ter recusado)`);
  }
  const unicos = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    cno: o.cno,
    eventoEm: ev.data,
    origemEvento: ev.origem,
    tipoSinal: sinal,
    municipio: o.municipio,
    uf: o.uf,
    areaTotal: areaM2(o),
    categorias: unicos(o.areas.map((a) => a.categoria)),
    destinacoes: unicos(o.areas.map((a) => a.destinacao)),
    situacao: o.situacao,
    cnpjResponsavel: o.cnpjResponsavel,
    nomeResponsavel: o.nomeResponsavel,
    qualificacaoResponsavel: o.qualificacaoResponsavel,
    qualificacaoResponsavelNome: o.qualificacaoResponsavelNome,
    payloadFingerprint: payloadFingerprint(envelopeCno(obs)),
  };
}

// ------------------------------------------------------------------------------------------ ordem e lote
/** Ordem de CONTROLE do lote: evento mais recente primeiro, CNO ascendente como desempate. Nao e prioridade. */
export const compararEntradas = (a: EntradaManifest, b: EntradaManifest): number =>
  (a.eventoEm < b.eventoEm ? 1 : a.eventoEm > b.eventoEm ? -1 : 0) || (a.cno < b.cno ? -1 : a.cno > b.cno ? 1 : 0);

export const ordenarLote = (entradas: EntradaManifest[]): EntradaManifest[] => [...entradas].sort(compararEntradas);

export const montarLote = (elegiveis: EntradaManifest[], limite: number): EntradaManifest[] => ordenarLote(elegiveis).slice(0, Math.max(0, limite));

// ---------------------------------------------------------------------------------------- cap por empresa
export interface SimulacaoCap {
  cap: number | null;
  lote: number;
  empresasUnicasNoLote: number;
  cnosExcluidosPeloCap: number;
  maiorOcupacaoNoLote: number;
  cnos: string[];
}

/**
 * SIMULA um teto de CNOs por CNPJ, respeitando a ordem de controle: os primeiros N de cada empresa ficam, o
 * resto sai. `cap = null` e "sem cap". Isto mede diversidade do lote; NAO e aplicado a politica.
 */
export function simularCap(elegiveis: EntradaManifest[], cap: number | null, limite: number): SimulacaoCap {
  const ordenados = ordenarLote(elegiveis);
  const porCnpj = new Map<string, number>();
  const mantidos: EntradaManifest[] = [];
  let excluidos = 0;
  for (const e of ordenados) {
    const n = porCnpj.get(e.cnpjResponsavel) ?? 0;
    if (cap !== null && n >= cap) { excluidos++; continue; }
    porCnpj.set(e.cnpjResponsavel, n + 1);
    mantidos.push(e);
  }
  const lote = mantidos.slice(0, limite);
  const ocupacao = new Map<string, number>();
  for (const e of lote) ocupacao.set(e.cnpjResponsavel, (ocupacao.get(e.cnpjResponsavel) ?? 0) + 1);
  return {
    cap, lote: lote.length, empresasUnicasNoLote: ocupacao.size, cnosExcluidosPeloCap: excluidos,
    maiorOcupacaoNoLote: Math.max(0, ...ocupacao.values()), cnos: lote.map((e) => e.cno),
  };
}

// ----------------------------------------------------------------------------------------------- metricas
const contar = (xs: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

/** Percentil exato sobre a lista (o lote e pequeno — ate 50 — entao guardar a lista e correto aqui). */
export function percentilExato(valores: number[], p: number): number | undefined {
  if (!valores.length) return undefined;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

export interface MetricasLote {
  tamanho: number;
  porSinal: [string, number][];
  areaP50?: number;
  areaP90?: number;
  municipios: [string, number][];
  destinacoes: [string, number][];
  cnpjsUnicos: number;
  obrasPorCnpj: [string, number][];
  maiorOcupacao: number;
  cnpjsComMaisDeUmaVaga: number;
}

export function metricasLote(lote: EntradaManifest[]): MetricasLote {
  const areas = lote.map((e) => e.areaTotal).filter((a): a is number => a !== undefined);
  const porCnpj = contar(lote.map((e) => e.cnpjResponsavel));
  return {
    tamanho: lote.length,
    porSinal: contar(lote.map((e) => e.tipoSinal)),
    areaP50: percentilExato(areas, 50),
    areaP90: percentilExato(areas, 90),
    municipios: contar(lote.map((e) => e.municipio ?? '—')),
    destinacoes: contar(lote.flatMap((e) => (e.destinacoes.length ? e.destinacoes : ['—']))),
    cnpjsUnicos: porCnpj.length,
    obrasPorCnpj: porCnpj,
    maiorOcupacao: porCnpj[0]?.[1] ?? 0,
    cnpjsComMaisDeUmaVaga: porCnpj.filter(([, n]) => n > 1).length,
  };
}

// ----------------------------------------------------------------------------------------------- manifest
export interface ManifestPiloto {
  versaoPolitica: typeof CNO_PILOT_POLICY_VERSION;
  politica: CnoDiscoveryPolicy;
  dataReferencia: string;
  /** auditoria do lote; NUNCA entra no envelope nem no fingerprint */
  snapshot: CnoSnapshotDescriptor & { arquivo?: string };
  totalAnalisado: number;
  totalElegivel: number;
  totalRecusado: number;
  batchSize: number;
  lote: EntradaManifest[];
  fingerprints: string[];
}

export function montarManifest(p: {
  dataReferencia: string; snapshot: ManifestPiloto['snapshot']; totalAnalisado: number; elegiveis: EntradaManifest[]; limite: number;
}): ManifestPiloto {
  const lote = montarLote(p.elegiveis, p.limite);
  return {
    versaoPolitica: CNO_PILOT_POLICY_VERSION,
    politica: politicaPiloto(p.dataReferencia),
    dataReferencia: p.dataReferencia,
    snapshot: p.snapshot,
    totalAnalisado: p.totalAnalisado,
    totalElegivel: p.elegiveis.length,
    totalRecusado: p.totalAnalisado - p.elegiveis.length,
    batchSize: lote.length,
    lote,
    fingerprints: lote.map((e) => e.payloadFingerprint),
  };
}

/** Dois dry-runs sobre o mesmo snapshot tem de dar o MESMO lote, na MESMA ordem, com os MESMOS fingerprints. */
export function manifestosIguais(a: ManifestPiloto, b: ManifestPiloto): boolean {
  return a.totalElegivel === b.totalElegivel
    && a.lote.length === b.lote.length
    && a.lote.every((e, i) => e.cno === b.lote[i].cno && e.payloadFingerprint === b.lote[i].payloadFingerprint);
}

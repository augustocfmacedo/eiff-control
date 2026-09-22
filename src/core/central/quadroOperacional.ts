// MC-LIVE-2A — Mission Control Operational V0: a projecao do quadro operacional.
//
// Este modulo agrupa, filtra e conta. Ele NAO decide status: a unica regra de status continua sendo a
// normalizacao de `workItem.ts` (`MissionControlWorkItem.status`), e as colunas sao exatamente `MC_STATUS`
// na ordem de `ORDEM_MC_STATUS`. Nenhum segundo vocabulario, nenhuma reclassificacao na tela.
//
//   GitHub / Factory  ->  adapter  ->  normalizacao  ->  MissionControlWorkItem  ->  quadro (aqui)  ->  UI
//
// O quadro e uma PROJECAO: nao move item, nao escreve em lugar nenhum, nao reordena por prioridade comercial.
// Ordenar por "mexeu por ultimo" e leitura, nao autoridade.
//
// Proibido aqui: React, fetch, Supabase, store, escrita de qualquer tipo.
import { MC_STATUS, ORDEM_MC_STATUS, ROTULO_PROCEDENCIA, type McFonte, type McStatus, type MissionControlWorkItem } from './workItem';

/** As colunas do quadro, na ordem de leitura ja definida pela MC-LIVE-1. */
export const COLUNAS_QUADRO: McStatus[] = [...MC_STATUS].sort((a, b) => ORDEM_MC_STATUS[a] - ORDEM_MC_STATUS[b]);

/** Os numeros da barra superior: o que o operador precisa ver antes de olhar qualquer cartao. */
export const STATUS_DESTAQUE: McStatus[] = ['EXECUTANDO', 'AGUARDANDO_HUMANO', 'BLOQUEADO', 'EM_VALIDACAO', 'CONCLUIDO'];

// ---------------------------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------------------------

export const ESCOPOS_QUADRO = ['TODOS', 'ARQUITETURA', 'FACTORY'] as const;
export type EscopoQuadro = (typeof ESCOPOS_QUADRO)[number];

/** Que fontes cada escopo abre. GATE e ARCHITECTURE sao a curadoria do repositorio; FACTORY/GITHUB, a execucao. */
const FONTES_DO_ESCOPO: Readonly<Record<EscopoQuadro, McFonte[] | undefined>> = {
  TODOS: undefined,
  ARQUITETURA: ['ARCHITECTURE', 'GATE'],
  FACTORY: ['FACTORY', 'GITHUB'],
};

export interface FiltroQuadro {
  escopo: EscopoQuadro;
  /** `undefined` = todos os status */
  status?: McStatus;
  /** busca por taskId/correlationId/titulo; sem acento e sem caixa */
  busca?: string;
  /** so entra quando a fonte informa workstream de verdade (ver `workstreamsDisponiveis`) */
  workstreamId?: string;
}

export const FILTRO_VAZIO: FiltroQuadro = { escopo: 'TODOS' };

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Texto pesquisavel de um item: identidade da fonte + titulo. Nunca status normalizado (isso e filtro proprio). */
export const textoBuscavel = (i: MissionControlWorkItem): string =>
  semAcento([i.correlationId, i.sourceId, i.title].filter(Boolean).join(' '));

export function aplicarFiltroQuadro(itens: readonly MissionControlWorkItem[], f: FiltroQuadro): MissionControlWorkItem[] {
  const fontes = FONTES_DO_ESCOPO[f.escopo];
  const termo = semAcento((f.busca ?? '').trim());
  return itens.filter((i) => {
    if (fontes && !fontes.includes(i.source)) return false;
    if (f.status && i.status !== f.status) return false;
    if (f.workstreamId && i.workstreamId !== f.workstreamId) return false;
    if (termo && !textoBuscavel(i).includes(termo)) return false;
    return true;
  });
}

/**
 * Workstreams realmente presentes nos itens. Se nenhuma fonte informa workstream, devolve lista vazia e a UI
 * simplesmente nao oferece o filtro — o contrato e nao inventar workstream.
 */
export const workstreamsDisponiveis = (itens: readonly MissionControlWorkItem[]): string[] =>
  [...new Set(itens.map((i) => i.workstreamId).filter((x): x is string => !!x))].sort();

// ---------------------------------------------------------------------------------------------
// Ordenacao dentro da coluna
// ---------------------------------------------------------------------------------------------

/**
 * Quem mexeu por ultimo aparece primeiro. Item sem `updatedAt` (fonte que nao informa data de alteracao) vai para
 * o fim: ausencia de data NAO vira "muito antigo" nem "agora" — nao se fabrica historicidade. Empate desempata
 * pelo id, para a ordem ser deterministica e a tela nao tremer entre dois polls iguais.
 */
export function compararItensQuadro(a: MissionControlWorkItem, b: MissionControlWorkItem): number {
  if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.updatedAt && !b.updatedAt) return -1;
  if (!a.updatedAt && b.updatedAt) return 1;
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------------------------
// Quadro
// ---------------------------------------------------------------------------------------------

export interface ColunaQuadro {
  status: McStatus;
  itens: MissionControlWorkItem[];
  total: number;
}

export interface QuadroOperacional {
  colunas: ColunaQuadro[];
  /** contagem por status DEPOIS do filtro (o que esta na tela) */
  contagens: Readonly<Record<McStatus, number>>;
  /** total de itens na tela e total antes do filtro, para a UI dizer "12 de 47" sem recalcular */
  visiveis: number;
  totalSemFiltro: number;
  /** quantos itens vieram de fonte indisponivel ou vencida — o operador precisa saber que olha dado velho */
  stale: number;
  fonteIndisponivel: number;
}

const zeradas = (): Record<McStatus, number> => Object.fromEntries(MC_STATUS.map((s) => [s, 0])) as Record<McStatus, number>;

export function montarQuadro(itens: readonly MissionControlWorkItem[], filtro: FiltroQuadro = FILTRO_VAZIO): QuadroOperacional {
  const visiveis = aplicarFiltroQuadro(itens, filtro).sort(compararItensQuadro);
  const contagens = zeradas();
  for (const i of visiveis) contagens[i.status] += 1;
  return {
    colunas: COLUNAS_QUADRO.map((status) => {
      const desta = visiveis.filter((i) => i.status === status);
      return { status, itens: desta, total: desta.length };
    }),
    contagens,
    visiveis: visiveis.length,
    totalSemFiltro: itens.length,
    stale: visiveis.filter((i) => i.frescor.stale).length,
    fonteIndisponivel: visiveis.filter((i) => i.frescor.fonteIndisponivel).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Tempo relativo (leitura humana, sem biblioteca)
// ---------------------------------------------------------------------------------------------

/**
 * "2 min", "3 h", "5 d". Devolve `undefined` quando nao ha data — a tela mostra um travessao, nunca "agora".
 * Data no futuro (relogio da fonte adiantado) vira "agora": e o unico arredondamento aceitavel, porque a
 * alternativa seria exibir tempo negativo.
 */
export function haQuantoTempo(iso: string | undefined, agoraIso: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  const agora = Date.parse(agoraIso);
  if (!Number.isFinite(t) || !Number.isFinite(agora)) return undefined;
  const s = Math.floor((agora - t) / 1000);
  if (s <= 0) return 'agora';
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// ---------------------------------------------------------------------------------------------
// Apresentacao do cartao (MC-LIVE-2B)
// ---------------------------------------------------------------------------------------------

/**
 * Literal reservado a UM caso: item da fabrica observado atraves do GitHub. Ele nomeia a distancia entre
 * o que a fabrica faz e o que conseguimos enxergar dela — e por isso nao pode vazar para item nenhum que
 * seja do proprio GitHub, sob pena de anunciar uma fabrica que nao estamos lendo.
 */
export const ROTULO_FACTORY_VIA_GITHUB = 'GitHub projection of Factory';

/**
 * Rotulo de procedencia do cartao. `source` e `procedencia` respondem perguntas diferentes:
 *
 *     source      = de QUEM e o item     (FACTORY = job da fabrica; GITHUB = issue/PR do proprio GitHub)
 *     procedencia = por ONDE o dado veio (GITHUB_PROJECTION = lido pelas APIs do GitHub)
 *
 * So o encontro dos dois — item da fabrica visto pelo GitHub — merece o literal acima. Todo o resto usa o
 * rotulo canonico, porque ROTULO_PROCEDENCIA continua sendo a unica autoridade de procedencia; esta
 * funcao e apresentacao, nao um segundo catalogo.
 */
export function rotuloProcedenciaDoItem(i: Pick<MissionControlWorkItem, 'source' | 'procedencia'>): string {
  if (i.source === 'FACTORY' && i.procedencia === 'GITHUB_PROJECTION') return ROTULO_FACTORY_VIA_GITHUB;
  return ROTULO_PROCEDENCIA[i.procedencia];
}

/**
 * CI do cartao. O contrato do item NAO carrega check run correlacionado, e o estado cru da fonte nunca e
 * CI: `pr:draft` e situacao do pull request, nao resultado de teste; um nome que por acaso lembra CI
 * tambem nao vira CI. Sem evidencia do proprio item, a resposta honesta e "nao sei" — que a tela mostra
 * como travessao, e nao apagando o campo. Correlacionar PR/commit/check e outro assunto e outro bloco;
 * enquanto ele nao existir, esta funcao devolve undefined para todo item, de proposito.
 */
export const ciDoItem = (_i: MissionControlWorkItem): string | undefined => undefined;

/**
 * O que a tela diz quando o CI do cartao e desconhecido. Existe para o travessao nao ser mudo: "—" sozinho
 * confunde "nao ha CI" com "nao conseguimos ler". A frase mora aqui, ao lado da regra, e nao no JSX.
 */
export const SEM_EVIDENCIA_DE_CI = 'Sem evidência de CI correlacionada a este item.';

// Commercial UX 1.0 — UX-4: projecao PURA da zona PIPELINE ATIVO do Panorama.
//
// Este modulo nao decide nada: recebe fatos que ja existem e devolve um view-model pequeno. Em particular, ele NAO
// escolhe oportunidade. A oportunidade de referencia da conta ja foi escolhida pela autoridade CM1-A e viaja em
// `CommercialQueueItem.oportunidadeId`; aqui ela apenas e localizada, conferida (mesma empresa, estagio ainda ativo)
// e apresentada. Sem `oportunidadeId`, sem id correspondente ou com negocio fechado/NURTURE, a conta simplesmente
// nao entra — nunca ha fallback para "a melhor oportunidade da empresa".
//
// Uma linha da fila -> no maximo UMA oportunidade no Panorama. O pipeline completo da empresa continua nas telas de
// inteligencia (`/radar`) e da empresa; este resumo nao inventa uma segunda politica de ordenacao entre negocios.
//
// Ordem: a ordem recebida (CM1-A). Nao ha `sort` aqui — nem por valor, probabilidade, valor ponderado, estagio,
// data, risco ou score.
//
// Movimento: a MESMA definicao factual do CM1-A (`commercialMachine.ts`): criacao da oportunidade, historico de
// estagio e atividades reais ligadas aquela oportunidade (`NOTE` nao e movimento comercial). `atualizadoEm` NUNCA
// entra: e carimbo de escrita, nao fato comercial.
//
// Estado: PARADA e EM RISCO vem EXCLUSIVAMENTE das excecoes ja projetadas pelo UX-0. Nenhum SLA e recalculado aqui,
// e nao existe classificacao positiva inventada ("em movimento", "saudavel"): sem contrato, simplesmente nao ha
// badge.
//
// Contrato de design: docs/commercial-ux-1.0-decisao.md § 5.
import { diasEntre } from '../../core/radar/score';
import type { CommercialQueueItem } from '../../core/radar/commercialMachine';
import { estagioAtivo, type Atividade, type Estagio, type HistoricoEstagio, type Oportunidade } from '../../core/radar/types';
import type { ContaComercialUX } from './comercialVisao';

/** Estados que o resumo pode marcar. Nao existe estado positivo: ausencia de badge e o caso normal. */
export const ESTADOS_PIPELINE_UX = ['PARADA', 'EM_RISCO'] as const;
export type EstadoPipelineUX = (typeof ESTADOS_PIPELINE_UX)[number];

/** O que a tela ja tem em maos para cada linha da fila filtrada. */
export interface EntradaPipelineUX {
  item: CommercialQueueItem;
  conta: ContaComercialUX;
}

/** Coleccoes factuais necessarias. Nada de store, actions ou React. */
export interface FatosPipelineUX {
  oportunidades: readonly Oportunidade[];
  historicoEstagios: readonly HistoricoEstagio[];
  atividades: readonly Atividade[];
  /** Data-base do sistema (`ds.params.dataBase`), nunca `new Date()`. */
  hoje: string;
}

export interface OportunidadePipelineUX {
  itemId: string;
  empresaId: string;
  oportunidadeId: string;
  titulo: string;
  estagio: Estagio;
  /** So quando o dado existe: valor ausente nunca vira zero. */
  valorEstimado?: number;
  /** Maior data factual entre criacao, mudanca de estagio e atividade real da oportunidade. */
  ultimoMovimentoEm?: string;
  /** Distancia entre o ultimo movimento e `hoje`. Fato temporal, nao julgamento. */
  diasSemMovimento?: number;
  estado?: EstadoPipelineUX;
}

const dia = (v: string) => v.slice(0, 10);

/**
 * Ultimo movimento da oportunidade, com as MESMAS fontes do CM1-A:
 *   `o.criadoEm` + `historicoEstagios` da oportunidade + atividades reais (`tipo !== 'NOTE'`) ligadas a ela.
 * `o.atualizadoEm` nao participa, e atividade de outra oportunidade (ou sem `oportunidadeId`) nao conta.
 */
export function ultimoMovimentoUX(o: Oportunidade, historicoEstagios: readonly HistoricoEstagio[], atividades: readonly Atividade[]): string {
  const datas = [
    dia(o.criadoEm),
    ...historicoEstagios.filter((h) => h.oportunidadeId === o.id).map((h) => dia(h.em)),
    ...atividades.filter((a) => a.oportunidadeId === o.id && a.tipo !== 'NOTE').map((a) => dia(a.ocorreuEm)),
  ].sort();
  return datas[datas.length - 1];
}

/**
 * Estado do negocio a partir das excecoes que o UX-0 ja projetou, e so delas:
 *   - `OPORTUNIDADE_PARADA_CRITICA` desta oportunidade -> EM RISCO;
 *   - excecao bloqueante da conta (trava ou bloqueio do plano) -> EM RISCO;
 *   - `OPORTUNIDADE_PARADA` desta oportunidade -> PARADA.
 * Precedencia EM RISCO > PARADA: o fato mais grave e o que aparece, nunca os dois badges.
 * A referencia e conferida por id: parada de OUTRA oportunidade nao marca esta.
 */
export function estadoPipelineUX(conta: ContaComercialUX, oportunidadeId: string): EstadoPipelineUX | undefined {
  const daOportunidade = conta.excecoes.filter((e) => e.referencia?.tipo === 'oportunidade' && e.referencia.id === oportunidadeId);
  if (daOportunidade.some((e) => e.tipo === 'OPORTUNIDADE_PARADA_CRITICA')) return 'EM_RISCO';
  if (conta.excecoes.some((e) => e.bloqueante && e.severidade === 'BLOQUEIO')) return 'EM_RISCO';
  if (daOportunidade.some((e) => e.tipo === 'OPORTUNIDADE_PARADA')) return 'PARADA';
  return undefined;
}

/**
 * Projeta a zona PIPELINE ATIVO preservando a ordem recebida. Cada entrada rende no maximo uma oportunidade — a de
 * referencia do CM1-A — e nenhuma entrada sem negocio ativo produz linha.
 */
export function pipelineAtivoUX(entradas: readonly EntradaPipelineUX[], fatos: FatosPipelineUX): OportunidadePipelineUX[] {
  const saida: OportunidadePipelineUX[] = [];
  for (const { item, conta } of entradas) {
    if (!item.oportunidadeId) continue; // conta sem negocio de referencia: nao se inventa um
    const o = fatos.oportunidades.find((x) => x.id === item.oportunidadeId && x.empresaId === item.empresaId && estagioAtivo(x.estagio));
    if (!o) continue; // id inexistente, de outra empresa ou negocio fechado/NURTURE: sem fallback
    const ultimoMovimentoEm = ultimoMovimentoUX(o, fatos.historicoEstagios, fatos.atividades);
    const estado = estadoPipelineUX(conta, o.id);
    saida.push({
      itemId: conta.itemId,
      empresaId: o.empresaId,
      oportunidadeId: o.id,
      titulo: o.titulo,
      estagio: o.estagio,
      ...(o.valorEstimado !== undefined ? { valorEstimado: o.valorEstimado } : {}),
      ultimoMovimentoEm,
      diasSemMovimento: diasEntre(ultimoMovimentoEm, dia(fatos.hoje)),
      ...(estado ? { estado } : {}),
    });
  }
  return saida;
}

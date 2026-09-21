// Commercial UX 1.0 — UX-0: projecao PURA de apresentacao sobre o que CM1/CM2 ja decidiram.
//
// Este modulo nao decide nada de negocio: recebe o resultado pronto (item da fila, plano, cadencia e sugestao) e devolve
// um view-model pequeno para o Panorama e o Modo Foco. Nao recalcula motor, nao reordena, nao escolhe contato ou canal,
// nao cria CTA, nao pontua e nao inventa motivo — quando o motor nao diz, o campo fica ausente.
//
// Dois eixos ORTOGONAIS, porque misturar os dois foi a origem da densidade atual:
//   Eixo A (execucao da conta): AGORA | AGUARDANDO | PROGRAMADO | SEM_DESTAQUE — mutuamente exclusivo, vem da cadencia.
//   Eixo B (excecoes): colecao sobreposta de fatos que ja existem (travas, bloqueios do plano, oportunidade parada).
// Uma conta PROGRAMADA pode ter excecao; uma conta AGORA tambem. Risco nao e horizonte.
//
// Contrato de design: docs/commercial-ux-1.0-decisao.md.
import type { CommercialActionPlan, ModoPlanoCM, CodigoBloqueioPlanoCM } from '../../core/radar/commercialActionPlan';
import { RETOMADAS_CADENCIA_CM, type CadenceRecommendationCM, type NaturezaToqueCM, type RetomadaCadenciaCM } from '../../core/radar/commercialCadence';
import type { EstadoSugestaoTarefaCM, TaskSuggestionCM } from '../../core/radar/commercialCadenceTask';
import { TEXTO_RAZAO_CM, type CodigoRazaoCM, type CodigoTravaCM, type CommercialQueueItem, type ReferenciaCM } from '../../core/radar/commercialMachine';
import type { Canal } from '../../core/radar/types';

// ---------------------------------------------------------------------------------------------------------------------
// Eixo A — horizonte de execucao da conta
// ---------------------------------------------------------------------------------------------------------------------
export const HORIZONTES_EXECUCAO_UX = ['AGORA', 'AGUARDANDO', 'PROGRAMADO', 'SEM_DESTAQUE'] as const;
export type HorizonteExecucaoUX = (typeof HORIZONTES_EXECUCAO_UX)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Eixo B — excecoes (sobrepostas ao horizonte)
// ---------------------------------------------------------------------------------------------------------------------
export const TIPOS_EXCECAO_UX = ['TRAVA', 'BLOQUEIO_PLANO', 'OPORTUNIDADE_PARADA', 'OPORTUNIDADE_PARADA_CRITICA'] as const;
export type TipoExcecaoUX = (typeof TIPOS_EXCECAO_UX)[number];

/** BLOQUEIO impede executar; RISCO e o negocio em risco declarado pelo CM1-A; ATENCAO e pendencia que nao impede. */
export const SEVERIDADES_EXCECAO_UX = ['BLOQUEIO', 'RISCO', 'ATENCAO'] as const;
export type SeveridadeExcecaoUX = (typeof SEVERIDADES_EXCECAO_UX)[number];

export interface ExcecaoComercialUX {
  tipo: TipoExcecaoUX;
  /** Codigo original da autoridade que produziu o fato (trava, bloqueio do plano ou razao do CM1-A). */
  codigo: CodigoTravaCM | CodigoBloqueioPlanoCM | CodigoRazaoCM;
  severidade: SeveridadeExcecaoUX;
  /** Impede executar a acao (trava bloqueante ou bloqueio do plano). Nunca inferido. */
  bloqueante: boolean;
  referencia?: ReferenciaCM;
}

/** Severidades que entram no contador "EM RISCO" do Panorama. ATENCAO fica na lista, fora do numero. */
export const SEVERIDADES_EM_RISCO_UX: readonly SeveridadeExcecaoUX[] = ['BLOQUEIO', 'RISCO'];

// ---------------------------------------------------------------------------------------------------------------------
// Entrada e saida
// ---------------------------------------------------------------------------------------------------------------------
/** O que a tela ja tem em maos: a cadeia CM1-A -> CM1-B -> CM2-B -> CM2-C, sem dataset e sem recalculo. */
export interface EntradaContaComercialUX {
  item: CommercialQueueItem;
  plano: CommercialActionPlan;
  cadencia: CadenceRecommendationCM;
  sugestao: TaskSuggestionCM;
}

export interface ContaComercialUX {
  itemId: string;
  empresaId: string;
  posicao: number;
  horizonte: HorizonteExecucaoUX;
  /** Razao principal do CM1-A, com o texto da autoridade existente e os fatos temporais separados. */
  motivo: { codigo: CodigoRazaoCM; texto: string; dias?: number; em?: string; venceEm?: string };
  /** So quando a cadencia tem proximo toque. A natureza e preservada: RECOMENDADA nao vira compromisso firme. */
  proximoToque?: { natureza: NaturezaToqueCM; em?: string };
  /** So quando a conta espera. `retomaCom` ausente = o motor nao informou; a UI nunca preenche. */
  espera?: { retomaCom?: RetomadaCadenciaCM };
  /** Contato e canal decididos pelo CM1-B. A projecao nunca procura contato melhor nem inventa canal. */
  contato?: { id: string; canal?: Canal };
  modo: ModoPlanoCM;
  sugestao: { estado: EstadoSugestaoTarefaCM };
  excecoes: ExcecaoComercialUX[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Eixo A: regra do horizonte
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Ordem das regras (a ordem e o contrato):
 * 1. `DEVIDA` -> AGORA, sempre. Pendencia de data, contato ou responsavel nao rebaixa o que o motor declarou devido.
 * 2. `ENCERRADA` / `NAO_APLICAVEL` -> SEM_DESTAQUE (antes da data, porque NAO_APLICAVEL pode carregar toque secundario).
 * 3. proximo toque com data -> PROGRAMADO (FIRME, BASE_CM1 ou RECOMENDADA; a natureza continua visivel).
 * 4. resto (AGUARDANDO, PAUSADA, SUGERIR_PROXIMO_PASSO sem data) -> AGUARDANDO, com o motivo so quando o motor o deu.
 */
export function horizonteDaCadenciaUX(cadencia: CadenceRecommendationCM): HorizonteExecucaoUX {
  if (cadencia.estado === 'DEVIDA') return 'AGORA';
  if (cadencia.estado === 'ENCERRADA' || cadencia.estado === 'NAO_APLICAVEL') return 'SEM_DESTAQUE';
  if (cadencia.proximoToque?.em) return 'PROGRAMADO';
  return 'AGUARDANDO';
}

// ---------------------------------------------------------------------------------------------------------------------
// Eixo B: excecoes a partir de fatos existentes
// ---------------------------------------------------------------------------------------------------------------------
const RAZOES_DE_RISCO_UX: Readonly<Record<string, { tipo: TipoExcecaoUX; severidade: SeveridadeExcecaoUX } | undefined>> = {
  OPORTUNIDADE_PARADA: { tipo: 'OPORTUNIDADE_PARADA', severidade: 'ATENCAO' },
  OPORTUNIDADE_PARADA_CRITICA: { tipo: 'OPORTUNIDADE_PARADA_CRITICA', severidade: 'RISCO' },
};
const chaveExcecao = (e: ExcecaoComercialUX) => `${e.tipo}:${e.codigo}:${e.referencia?.tipo ?? ''}:${e.referencia?.id ?? ''}`;

/**
 * Colecao de fatos que ja existem: travas do item, bloqueios do plano e razoes de oportunidade parada (principal ou
 * secundaria). Nenhuma heuristica nova: nada de score, valor, tempo arbitrario ou leitura de texto. Duplicata exata
 * (mesmo tipo, codigo e referencia) aparece uma vez; a ordem e a das autoridades de origem.
 */
export function excecoesDaContaUX(item: CommercialQueueItem, plano: CommercialActionPlan): ExcecaoComercialUX[] {
  const saida: ExcecaoComercialUX[] = [];
  const vistas = new Set<string>();
  const juntar = (e: ExcecaoComercialUX) => { const k = chaveExcecao(e); if (vistas.has(k)) return; vistas.add(k); saida.push(e); };
  for (const t of item.travas) {
    const bloqueante = t.bloqueante && t.bloqueia.length > 0;
    juntar({ tipo: 'TRAVA', codigo: t.codigo, severidade: bloqueante ? 'BLOQUEIO' : 'ATENCAO', bloqueante, referencia: t.referencia });
  }
  for (const b of plano.bloqueios) juntar({ tipo: 'BLOQUEIO_PLANO', codigo: b.codigo, severidade: 'BLOQUEIO', bloqueante: true, referencia: b.referencia });
  for (const razao of [item.porQueAgora, ...item.secundarias]) {
    const r = RAZOES_DE_RISCO_UX[razao.codigo];
    if (r) juntar({ tipo: r.tipo, codigo: razao.codigo, severidade: r.severidade, bloqueante: false, referencia: razao.referencia });
  }
  return saida;
}

export const contaEmRiscoUX = (conta: ContaComercialUX) => conta.excecoes.some((e) => SEVERIDADES_EM_RISCO_UX.includes(e.severidade));

// ---------------------------------------------------------------------------------------------------------------------
// Projecao
// ---------------------------------------------------------------------------------------------------------------------
/** Uma conta do Panorama. Copia decisao pronta; nada aqui escolhe, ordena ou calcula prioridade. */
export function contaComercialUX({ item, plano, cadencia, sugestao }: EntradaContaComercialUX): ContaComercialUX {
  const p = item.porQueAgora;
  const conta: ContaComercialUX = {
    itemId: cadencia.itemId,
    empresaId: item.empresaId,
    posicao: item.posicao,
    horizonte: horizonteDaCadenciaUX(cadencia),
    motivo: { codigo: p.codigo, texto: TEXTO_RAZAO_CM[p.codigo] },
    modo: plano.modo,
    sugestao: { estado: sugestao.estado },
    excecoes: excecoesDaContaUX(item, plano),
  };
  if (p.dias != null) conta.motivo.dias = p.dias;
  if (p.em) conta.motivo.em = p.em;
  if (p.venceEm) conta.motivo.venceEm = p.venceEm;
  if (cadencia.proximoToque) {
    conta.proximoToque = { natureza: cadencia.proximoToque.natureza };
    if (cadencia.proximoToque.em) conta.proximoToque.em = cadencia.proximoToque.em;
  }
  if (conta.horizonte === 'AGUARDANDO') conta.espera = cadencia.retomaCom ? { retomaCom: cadencia.retomaCom } : {};
  if (plano.contato) {
    conta.contato = { id: plano.contato.id };
    if (plano.comunicacao?.canal) conta.contato.canal = plano.comunicacao.canal;
  }
  return conta;
}

/** Projeta a fila inteira PRESERVANDO A ORDEM de entrada (a ordem e do CM1-A; esta camada nunca reordena). */
export const visaoComercialUX = (entradas: readonly EntradaContaComercialUX[]): ContaComercialUX[] => entradas.map(contaComercialUX);

// ---------------------------------------------------------------------------------------------------------------------
// Recortes (filtro, nunca ordenacao)
// ---------------------------------------------------------------------------------------------------------------------
export const contasDoHorizonteUX = (contas: readonly ContaComercialUX[], horizonte: HorizonteExecucaoUX) => contas.filter((c) => c.horizonte === horizonte);
export const contasEmRiscoUX = (contas: readonly ContaComercialUX[]) => contas.filter(contaEmRiscoUX);

// ---------------------------------------------------------------------------------------------------------------------
// Resumos — contagem objetiva, sem indice sintetico
// ---------------------------------------------------------------------------------------------------------------------
export interface ResumoComercialUX {
  agora: number;
  aguardando: number;
  programado: number;
  semDestaque: number;
  /** Contas com ao menos uma excecao BLOQUEIO ou RISCO. Uma conta conta uma vez, tendo quantas excecoes tiver. */
  emRisco: number;
  total: number;
}

export function resumoComercialUX(contas: readonly ContaComercialUX[]): ResumoComercialUX {
  const resumo: ResumoComercialUX = { agora: 0, aguardando: 0, programado: 0, semDestaque: 0, emRisco: 0, total: contas.length };
  for (const c of contas) {
    if (c.horizonte === 'AGORA') resumo.agora += 1;
    else if (c.horizonte === 'AGUARDANDO') resumo.aguardando += 1;
    else if (c.horizonte === 'PROGRAMADO') resumo.programado += 1;
    else resumo.semDestaque += 1;
    if (contaEmRiscoUX(c)) resumo.emRisco += 1;
  }
  return resumo;
}

/** AGUARDANDO vira resumo por motivo, nunca lista. `retomaCom` ausente = o motor nao informou (nao inventar rotulo). */
export interface EsperaComercialUX { retomaCom?: RetomadaCadenciaCM; contas: number }

export function resumoEsperaUX(contas: readonly ContaComercialUX[]): EsperaComercialUX[] {
  const esperando = contasDoHorizonteUX(contas, 'AGUARDANDO');
  const saida: EsperaComercialUX[] = [];
  for (const retomaCom of RETOMADAS_CADENCIA_CM) {
    const n = esperando.filter((c) => c.espera?.retomaCom === retomaCom).length;
    if (n) saida.push({ retomaCom, contas: n });
  }
  const semMotivo = esperando.filter((c) => !c.espera?.retomaCom).length;
  if (semMotivo) saida.push({ contas: semMotivo });
  return saida;
}

// ---------------------------------------------------------------------------------------------------------------------
// Orcamento visual do Panorama (contrato de UX, nao regra comercial)
// ---------------------------------------------------------------------------------------------------------------------
export const ORCAMENTO_PANORAMA_COMERCIAL = { agora: 3, pipeline: 3, risco: 3, entrada: 3, programado: 3 } as const;

export interface RecorteUX<T> { visiveis: T[]; ocultos: number }
/** Corta pelo teto da zona preservando a ordem recebida. Nunca reprioriza: o que sobra vai para "Ver todos". */
export function recorteUX<T>(itens: readonly T[], limite: number): RecorteUX<T> {
  const visiveis = itens.slice(0, Math.max(0, limite));
  return { visiveis, ocultos: Math.max(0, itens.length - visiveis.length) };
}

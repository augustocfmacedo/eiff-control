// EIFF Commercial Machine — CM2-B: projecao temporal pura (cadencia) sobre a Commercial Queue e o Action Plan.
//
// Responde "qual e a situacao temporal desta conta agora?" e, quando ha autoridade, "quando ela volta?". Nao reinterpreta
// categoria, razao, contato, canal, objetivo, playbook, prioridade nem travas: o motivo temporal e sempre o codigo da razao
// principal escolhido pelo CM1-A. Nao sugere nem cria tarefa (CM2-C), nao grava, nao envia, nao muda a fila.
//
// Fonte temporal unica: datas firmes e de intervalo vem da saida do CM1-A; valores de politica vem de
// HIPOTESE_COMMERCIAL_MACHINE. A unica logica temporal propria e a lacuna D4 (silencio depois de conversa tratada).
// Contrato: docs/commercial-machine-cm2.md.
import { HIPOTESE_PLANO_CM, itemIdCM, type CommercialActionPlan } from './commercialActionPlan';
import {
  HIPOTESE_COMMERCIAL_MACHINE, TEXTO_RAZAO_CM, canaisAcionaveisCM, canonicalizarDatasetCM, normalizarHojeCM,
  type CodigoRazaoCM, type CommercialQueue, type CommercialQueueItem, type RazaoCM, type ReferenciaCM,
} from './commercialMachine';
import { TRANSICOES_RESULTADO, historicoDe } from './comunicacao';
import { contatoElegivel } from './contatos';
import { estagioAtivo, type Atividade, type Canal, type CodigoResposta, type Contato, type RadarDataset } from './types';

/** Versao do contrato temporal do CM2 (independente de CM1-A/CM1-B, que viajam em campos proprios). */
export const VERSAO_REGRAS_CADENCIA_CM = 'CM2-B.1';

export const ESTADOS_CADENCIA_CM = ['DEVIDA', 'AGUARDANDO', 'SUGERIR_PROXIMO_PASSO', 'PAUSADA', 'ENCERRADA', 'NAO_APLICAVEL'] as const;
export type EstadoCadenciaCM = (typeof ESTADOS_CADENCIA_CM)[number];
export const RETOMADAS_CADENCIA_CM = ['DATA', 'FATO_NOVO', 'DADO', 'DECISAO_HUMANA'] as const;
export type RetomadaCadenciaCM = (typeof RETOMADAS_CADENCIA_CM)[number];
/** FIRME = compromisso humano; BASE_CM1 = data do intervalo calculada pelo CM1-A; RECOMENDADA = lacuna D4; IMEDIATA = agora (sem data). */
export const NATUREZAS_TOQUE_CM = ['FIRME', 'BASE_CM1', 'RECOMENDADA', 'IMEDIATA'] as const;
export type NaturezaToqueCM = (typeof NATUREZAS_TOQUE_CM)[number];

export const CODIGOS_AVISO_CADENCIA_CM = [
  'DATA_DO_CLIENTE_NECESSARIA', 'ANCORA_TEMPORAL_AUSENTE', 'RESPONSAVEL_NECESSARIO', 'COMPROMISSOS_CONCORRENTES',
  'CANAL_DA_TAREFA_INDISPONIVEL', 'CONTATO_DA_TAREFA_INELEGIVEL', 'TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO',
  'COMUNICACAO_PENDENTE_NO_MESMO_TOQUE', 'HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO', 'GATEKEEPER_NAO_CONTA_NO_LIMITE',
  'ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA', 'CONTAGEM_POR_EMPRESA', 'CONTATO_RECOMENDADO_SEM_CANAL',
  'CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA',
] as const;
export type CodigoAvisoCadenciaCM = (typeof CODIGOS_AVISO_CADENCIA_CM)[number];

export interface ProximoToqueCM {
  natureza: NaturezaToqueCM;
  /** YYYY-MM-DD. Ausente em IMEDIATA: a informacao util e "agora". */
  em?: string;
  /** Fato concreto de onde a data (ou a imediaticidade) vem. */
  origem: ReferenciaCM;
  /** RECOMENDADA: dia da ancora real usada no calculo. */
  ancoraEm?: string;
}

export interface CadenceRecommendationCM {
  itemId: string;
  empresaId: string;
  versaoCadencia: string;
  versaoRegrasFila: string;
  versaoPlano: string;
  estado: EstadoCadenciaCM;
  /** Sempre o codigo da razao principal do CM1-A. */
  motivo: CodigoRazaoCM;
  retomaCom?: RetomadaCadenciaCM;
  proximoToque?: ProximoToqueCM;
  tentativa?: { semRespostaSeguidas: number; limite: number; doContato?: number };
  avisos: CodigoAvisoCadenciaCM[];
  explicacao: { titulo: string; porQue: string; fatos: string[] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mapa exaustivo razao do CM1-A -> comportamento temporal (unica fonte do significado temporal de cada razao)
// ---------------------------------------------------------------------------------------------------------------------
/** Como o proximo toque nasce: IMEDIATA; FIRME/BASE_CM1 da propria razao; FIRME_SECUNDARIA de um compromisso secundario; LACUNA_D4. */
type OrigemToque = 'IMEDIATA' | 'FIRME' | 'BASE_CM1' | 'FIRME_SECUNDARIA' | 'LACUNA_D4';
interface RegraTemporalCM { estado: EstadoCadenciaCM; retomaCom?: RetomadaCadenciaCM; toque?: OrigemToque }

export const REGRA_TEMPORAL_CM: Readonly<Record<CodigoRazaoCM, RegraTemporalCM>> = {
  RESPOSTA_NAO_TRATADA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  TAREFA_VENCIDA: { estado: 'DEVIDA', toque: 'FIRME' },
  OPORTUNIDADE_ACAO_VENCIDA: { estado: 'DEVIDA', toque: 'FIRME' },
  SINAL_ACIONAVEL_NOVO: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  OPORTUNIDADE_PARADA_CRITICA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  OPORTUNIDADE_SEM_PROXIMA_ACAO: { estado: 'SUGERIR_PROXIMO_PASSO', toque: 'LACUNA_D4' },
  OPORTUNIDADE_PARADA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  PROXIMA_ACAO_HOJE: { estado: 'DEVIDA', toque: 'FIRME' },
  COMUNICACAO_APROVADA_NAO_ENVIADA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  FOLLOW_UP_SEM_RESPOSTA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  TENTATIVA_CONTATO_INVALIDO: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  COMUNICACAO_PARA_REVISAO: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  TRAVA_PARA_RESOLVER: { estado: 'PAUSADA', retomaCom: 'DECISAO_HUMANA' },
  INCONSISTENCIA_PARA_REVISAR: { estado: 'NAO_APLICAVEL', toque: 'FIRME_SECUNDARIA' },
  CONTA_PRIORITARIA_NUNCA_ABORDADA: { estado: 'DEVIDA', toque: 'IMEDIATA' },
  SINAL_NAO_VERIFICADO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_DECISOR_IDEAL_PARA_SINAL: { estado: 'PAUSADA', retomaCom: 'DADO' },
  SEM_CANAL_VALIDO: { estado: 'PAUSADA', retomaCom: 'DADO' },
  RESULTADO_NEGATIVO_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  TENTATIVAS_ESGOTADAS: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  OPORTUNIDADE_EM_NURTURE: { estado: 'PAUSADA', retomaCom: 'FATO_NOVO' },
  CLIENTE_GANHO: { estado: 'ENCERRADA', retomaCom: 'FATO_NOVO' },
  /** Sem lacuna D4 fica NAO_APLICAVEL; com lacuna vira SUGERIR_PROXIMO_PASSO. */
  SEM_TIMING_ATUAL: { estado: 'NAO_APLICAVEL', toque: 'LACUNA_D4' },
  PROXIMA_ACAO_AGENDADA: { estado: 'AGUARDANDO', retomaCom: 'DATA', toque: 'FIRME' },
  FOLLOW_UP_EM_INTERVALO: { estado: 'AGUARDANDO', retomaCom: 'DATA', toque: 'BASE_CM1' },
};

/** Resultados em que a data do proximo passo pertence ao cliente: a lacuna D4 nunca a preenche. */
const RESULTADOS_COM_DATA_DO_CLIENTE: ReadonlySet<CodigoResposta> = new Set<CodigoResposta>(['CALL_BACK', 'FUTURE_PROJECT', 'REQUESTED_MEETING']);
/** Razoes da cadencia de tentativas sem resposta (onde contagem e intervalo do CM1-A aparecem). */
const RAZOES_DE_TENTATIVA: ReadonlySet<CodigoRazaoCM> = new Set<CodigoRazaoCM>(['FOLLOW_UP_EM_INTERVALO', 'FOLLOW_UP_SEM_RESPOSTA', 'TENTATIVAS_ESGOTADAS']);
const RAZOES_DE_COMUNICACAO_PENDENTE: ReadonlySet<CodigoRazaoCM> = new Set<CodigoRazaoCM>(['COMUNICACAO_PARA_REVISAO', 'COMUNICACAO_APROVADA_NAO_ENVIADA']);
const RAZOES_DE_FOLLOW_UP: ReadonlySet<CodigoRazaoCM> = new Set<CodigoRazaoCM>(['FOLLOW_UP_EM_INTERVALO', 'FOLLOW_UP_SEM_RESPOSTA']);

// ---------------------------------------------------------------------------------------------------------------------
// Textos pt-BR
// ---------------------------------------------------------------------------------------------------------------------
export const TEXTO_ESTADO_CADENCIA_CM: Readonly<Record<EstadoCadenciaCM, string>> = {
  DEVIDA: 'Ação devida agora',
  AGUARDANDO: 'Aguardando uma data já definida',
  SUGERIR_PROXIMO_PASSO: 'Conta sem próximo passo definido',
  PAUSADA: 'Cadência pausada',
  ENCERRADA: 'Cadência encerrada',
  NAO_APLICAVEL: 'Sem cadência temporal para esta razão',
};
export const TEXTO_RETOMADA_CADENCIA_CM: Readonly<Record<RetomadaCadenciaCM, string>> = {
  DATA: 'Retoma na data definida',
  FATO_NOVO: 'Retoma só com fato novo (sinal acionável ou nova interação)',
  DADO: 'Retoma quando o dado que falta for completado',
  DECISAO_HUMANA: 'Retoma depois de uma decisão humana',
};
export const TEXTO_NATUREZA_TOQUE_CM: Readonly<Record<NaturezaToqueCM, string>> = {
  FIRME: 'compromisso já agendado',
  BASE_CM1: 'fim do intervalo depois da tentativa sem resposta',
  RECOMENDADA: 'data recomendada, ainda sem compromisso',
  IMEDIATA: 'agora',
};
export const TEXTO_AVISO_CADENCIA_CM: Readonly<Record<CodigoAvisoCadenciaCM, string>> = {
  DATA_DO_CLIENTE_NECESSARIA: 'O próximo passo depende de uma data do cliente que ainda não está registrada em uma tarefa',
  ANCORA_TEMPORAL_AUSENTE: 'Não há fato com data confiável para recomendar quando voltar: decisão humana necessária',
  RESPONSAVEL_NECESSARIO: 'Não há responsável definido para assumir o próximo passo',
  COMPROMISSOS_CONCORRENTES: 'Há mais de uma tarefa aberta para o mesmo contato e negócio',
  CANAL_DA_TAREFA_INDISPONIVEL: 'O canal que a tarefa exige deixou de ser válido para o contato',
  CONTATO_DA_TAREFA_INELEGIVEL: 'A tarefa aponta para um contato que não pode ser abordado',
  TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO: 'Existe tarefa aberta criada antes de um resultado negativo',
  COMUNICACAO_PENDENTE_NO_MESMO_TOQUE: 'Há abordagem pendente enquanto o follow-up está em curso',
  HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO: 'A data guardada em oportunidade em nutrição não é lida pela fila: registrar como tarefa',
  GATEKEEPER_NAO_CONTA_NO_LIMITE: 'Barreira na recepção não conta no limite de tentativas (regra atual)',
  ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA: 'Atividade registrada sem resultado conta como tentativa sem resposta (regra atual)',
  CONTAGEM_POR_EMPRESA: 'Tentativas e intervalo contam pela conta, não pelo contato (regra atual)',
  CONTATO_RECOMENDADO_SEM_CANAL: 'O contato recomendado não tem canal, mas outro contato da conta tem',
  CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA: 'A conta tem oportunidade registrada mas nenhuma atividade, então aparece como nunca abordada',
};

// ---------------------------------------------------------------------------------------------------------------------
// Utilitarios puros
// ---------------------------------------------------------------------------------------------------------------------
const MS_POR_DIA = 86_400_000;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dia = (v: string) => v.slice(0, 10);
const diaValido = (d: string | undefined): d is string => { const ms = d ? Date.parse(`${d}T00:00:00Z`) : Number.NaN; return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === d; };
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * MS_POR_DIA).toISOString().slice(0, 10);
const maxDia = (a: string, b: string) => (a > b ? a : b);
const dataBr = (d: string) => d.split('-').reverse().join('/');
const respostaAcionavel = (x?: CodigoResposta): x is CodigoResposta => !!x && x !== 'NO_RESPONSE' && x !== 'GATEKEEPER' && !!TRANSICOES_RESULTADO[x]?.comunicar;
const semResposta = (x?: CodigoResposta) => !x || x === 'NO_RESPONSE' || x === 'GATEKEEPER';
const ehReferenciaDeTarefa = (r: RazaoCM) => r.referencia?.tipo === 'tarefa';

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------
/** Cadencia de uma conta da fila. `item` e `plano` devem vir do mesmo dataset e do mesmo `hoje`. */
export function cadenciaDaContaCM(ds: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, hoje: string): CadenceRecommendationCM {
  return projetar(canonicalizarDatasetCM(ds), item, plano, normalizarHojeCM(hoje));
}

/** Cadencia de toda a fila, na ordem da fila. Contas fora da fila nao recebem cadencia. */
export function cadenciasDaFilaCM(ds: RadarDataset, fila: CommercialQueue, planos: readonly CommercialActionPlan[], hoje: string): CadenceRecommendationCM[] {
  const d0 = normalizarHojeCM(hoje);
  if (fila.geradaEm !== d0) throw new Error('cadencia_hoje_divergente_da_fila');
  const r = canonicalizarDatasetCM(ds);
  const porItem = new Map(planos.map((p) => [p.itemId, p]));
  return fila.itens.map((item) => {
    const plano = porItem.get(itemIdCM(item));
    if (!plano) throw new Error('cadencia_plano_ausente');
    return projetar(r, item, plano, d0);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------------------------------
function projetar(r: RadarDataset, item: CommercialQueueItem, plano: CommercialActionPlan, d0: string): CadenceRecommendationCM {
  const itemId = itemIdCM(item);
  if (plano.itemId !== itemId || plano.empresaId !== item.empresaId) throw new Error('cadencia_plano_incompativel');
  if (!r.empresas.some((e) => e.id === item.empresaId)) throw new Error('cadencia_empresa_inexistente');

  const p = item.porQueAgora;
  const regra = REGRA_TEMPORAL_CM[p.codigo] as RegraTemporalCM | undefined;
  if (!regra) throw new Error('cadencia_razao_sem_regra');
  const razoes: readonly RazaoCM[] = [p, ...item.secundarias];
  const reais = r.atividades.filter((a) => a.empresaId === item.empresaId && a.tipo !== 'NOTE')
    .sort((a, b) => cmp(a.ocorreuEm, b.ocorreuEm) || cmp(a.criadoEm, b.criadoEm) || cmp(a.id, b.id));
  const avisos = new Set<CodigoAvisoCadenciaCM>();

  let estado = regra.estado;
  let proximoToque: ProximoToqueCM | undefined;
  const origemPadrao: ReferenciaCM = p.referencia ?? { tipo: 'empresa', id: item.empresaId };

  switch (regra.toque) {
    case 'IMEDIATA': proximoToque = { natureza: 'IMEDIATA', origem: origemPadrao }; break;
    case 'FIRME': proximoToque = toqueFirme(r, p); break;
    case 'BASE_CM1':
      if (!p.venceEm || !p.referencia) throw new Error('cadencia_intervalo_sem_prazo');
      proximoToque = { natureza: 'BASE_CM1', em: dia(p.venceEm), origem: p.referencia };
      break;
    case 'FIRME_SECUNDARIA': {
      const s = item.secundarias.find((x) => REGRA_TEMPORAL_CM[x.codigo].toque === 'FIRME' && x.estado !== 'BLOQUEADA' && !!x.venceEm);
      if (s) proximoToque = toqueFirme(r, s);
      break;
    }
    case 'LACUNA_D4': {
      const lacuna = lacunaD4(r, item, reais, d0);
      if (lacuna.aplica) {
        estado = 'SUGERIR_PROXIMO_PASSO';
        proximoToque = lacuna.toque;
        for (const a of lacuna.avisos) avisos.add(a);
      }
      break;
    }
    case undefined: break;
  }

  // Tentativas: numeros do CM1-A (historico da fila) e limite da hipotese vigente
  const razaoDeTentativa = razoes.find((x) => RAZOES_DE_TENTATIVA.has(x.codigo));
  let tentativa: CadenceRecommendationCM['tentativa'];
  if (razaoDeTentativa) {
    const atividade = razaoDeTentativa.referencia?.tipo === 'atividade' ? reais.find((a) => a.id === razaoDeTentativa.referencia!.id) : undefined;
    tentativa = { semRespostaSeguidas: item.historico.semRespostaSeguidas, limite: HIPOTESE_COMMERCIAL_MACHINE.limiteTentativasSemResposta };
    if (atividade?.contatoId) tentativa.doContato = historicoDe(r.atividades, item.empresaId, atividade.contatoId).semRespostaSeguidas;
    for (const a of avisosDeTentativa(reais)) avisos.add(a);
  }

  for (const a of avisosDeFatos(r, item, razoes, estado)) avisos.add(a);
  const listaAvisos = CODIGOS_AVISO_CADENCIA_CM.filter((c) => avisos.has(c));

  const rec: CadenceRecommendationCM = {
    itemId, empresaId: item.empresaId,
    versaoCadencia: VERSAO_REGRAS_CADENCIA_CM, versaoRegrasFila: plano.versaoRegrasFila, versaoPlano: plano.versaoPlano,
    estado, motivo: p.codigo, avisos: listaAvisos,
    explicacao: { titulo: TEXTO_ESTADO_CADENCIA_CM[estado], porQue: TEXTO_RAZAO_CM[p.codigo], fatos: [] },
  };
  if (regra.retomaCom) rec.retomaCom = regra.retomaCom;
  if (proximoToque) rec.proximoToque = proximoToque;
  if (tentativa) rec.tentativa = tentativa;
  rec.explicacao.fatos = fatosDe(rec);
  return rec;
}

/** Data FIRME: so um compromisso real (tarefa aberta ou proxima acao de oportunidade ativa) que o CM1-A ja trouxe. */
function toqueFirme(r: RadarDataset, razao: RazaoCM): ProximoToqueCM {
  const ref = razao.referencia;
  if (!ref || !razao.venceEm) throw new Error('cadencia_compromisso_sem_prazo');
  const em = dia(razao.venceEm);
  const real = ref.tipo === 'tarefa'
    ? r.tarefas.some((t) => t.id === ref.id && t.status === 'Aberta' && dia(t.venceEm) === em)
    : ref.tipo === 'oportunidade' && r.oportunidades.some((o) => o.id === ref.id && estagioAtivo(o.estagio) && !!o.proximaAcaoEm && dia(o.proximaAcaoEm) === em);
  if (!real) throw new Error('cadencia_compromisso_inexistente');
  return { natureza: 'FIRME', em, origem: ref };
}

interface ResultadoLacuna { aplica: boolean; toque?: ProximoToqueCM; avisos: CodigoAvisoCadenciaCM[] }

/**
 * Lacuna D4: unica regra temporal propria do CM2. Nunca muda a fila; a data e RECOMENDADA e nunca anterior a hoje.
 * - Oportunidade ativa sem proxima acao: ultimo movimento (derivado de `dias` do CM1-A) + SLA do estagio do CM1-A.
 * - Silencio depois de conversa acionavel tratada: ancora real + intervaloFollowUpDias do CM1-A.
 * Sem ancora confiavel nao ha data. Data que pertence ao cliente nunca e preenchida.
 */
function lacunaD4(r: RadarDataset, item: CommercialQueueItem, reais: readonly Atividade[], d0: string): ResultadoLacuna {
  const p = item.porQueAgora;
  const H = HIPOTESE_COMMERCIAL_MACHINE;

  if (p.codigo === 'OPORTUNIDADE_SEM_PROXIMA_ACAO') {
    const o = p.referencia?.tipo === 'oportunidade' ? r.oportunidades.find((x) => x.id === p.referencia!.id && estagioAtivo(x.estagio)) : undefined;
    const sla = o ? (H.slaEstagioDias as Readonly<Record<string, number>>)[o.estagio] : undefined;
    if (!o || sla === undefined || p.dias === undefined) return { aplica: true, avisos: ['ANCORA_TEMPORAL_AUSENTE'] };
    const ancora = somarDias(d0, -p.dias);
    return { aplica: true, toque: { natureza: 'RECOMENDADA', em: maxDia(somarDias(ancora, sla), d0), origem: { tipo: 'oportunidade', id: o.id }, ancoraEm: ancora }, avisos: [] };
  }

  // SEM_TIMING_ATUAL: so e lacuna se a ultima interacao real foi uma resposta acionavel (ja tratada, pois o CM1-A nao a
  // devolveu como RESPOSTA_NAO_TRATADA e nao ha tarefa, oportunidade ativa ou comunicacao viva gerando razao).
  const ultima = reais[reais.length - 1];
  if (!ultima || !respostaAcionavel(ultima.resultado)) return { aplica: false, avisos: [] };
  if (RESULTADOS_COM_DATA_DO_CLIENTE.has(ultima.resultado)) return { aplica: true, avisos: ['DATA_DO_CLIENTE_NECESSARIA'] };

  const marco = ultima.criadoEm || ultima.ocorreuEm;
  const candidatas: { em: string; origem: ReferenciaCM }[] = [];
  if (diaValido(dia(ultima.ocorreuEm)) && dia(ultima.ocorreuEm) <= d0) candidatas.push({ em: dia(ultima.ocorreuEm), origem: { tipo: 'atividade', id: ultima.id } });
  for (const t of r.tarefas) {
    if (t.empresaId !== item.empresaId || t.status !== 'Concluída' || !t.concluidaEm || t.criadoEm < marco) continue;
    if (diaValido(dia(t.concluidaEm)) && dia(t.concluidaEm) <= d0) candidatas.push({ em: dia(t.concluidaEm), origem: { tipo: 'tarefa', id: t.id } });
  }
  const ancora = candidatas.sort((a, b) => cmp(b.em, a.em) || cmp(a.origem.id, b.origem.id))[0];
  if (!ancora) return { aplica: true, avisos: ['ANCORA_TEMPORAL_AUSENTE'] };
  return { aplica: true, toque: { natureza: 'RECOMENDADA', em: maxDia(somarDias(ancora.em, H.intervaloFollowUpDias), d0), origem: ancora.origem, ancoraEm: ancora.em }, avisos: [] };
}

/** Dividas de contagem do CM1-A.1 visiveis na sequencia final de tentativas sem resposta (so explicam; nao corrigem). */
function avisosDeTentativa(reais: readonly Atividade[]): CodigoAvisoCadenciaCM[] {
  const sequencia: Atividade[] = [];
  for (let i = reais.length - 1; i >= 0 && semResposta(reais[i].resultado); i--) sequencia.push(reais[i]);
  const out: CodigoAvisoCadenciaCM[] = [];
  if (sequencia.some((a) => a.resultado === 'GATEKEEPER')) out.push('GATEKEEPER_NAO_CONTA_NO_LIMITE');
  if (sequencia.some((a) => !a.resultado)) out.push('ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA');
  if (new Set(sequencia.map((a) => a.contatoId ?? '')).size > 1) out.push('CONTAGEM_POR_EMPRESA');
  return out;
}

function avisosDeFatos(r: RadarDataset, item: CommercialQueueItem, razoes: readonly RazaoCM[], estado: EstadoCadenciaCM): CodigoAvisoCadenciaCM[] {
  const p = item.porQueAgora;
  const out: CodigoAvisoCadenciaCM[] = [];
  const tarefaDe = (x: RazaoCM) => (ehReferenciaDeTarefa(x) ? r.tarefas.find((t) => t.id === x.referencia!.id) : undefined);
  const contatoPorId = (id: string) => r.contatos.find((c) => c.id === id);

  if (p.codigo === 'RESPOSTA_NAO_TRATADA' && p.resultado && RESULTADOS_COM_DATA_DO_CLIENTE.has(p.resultado)) out.push('DATA_DO_CLIENTE_NECESSARIA');

  if (item.travas.some((t) => t.codigo === 'OPORTUNIDADE_SEM_RESPONSAVEL') || (estado === 'SUGERIR_PROXIMO_PASSO' && !item.responsavelId)) out.push('RESPONSAVEL_NECESSARIO');

  const tarefas = razoes.map(tarefaDe).filter((t): t is NonNullable<typeof t> => !!t && t.status === 'Aberta');
  const grupos = new Map<string, number>();
  for (const t of new Map(tarefas.map((t) => [t.id, t])).values()) { const k = `${t.contatoId ?? '-'}|${t.oportunidadeId ?? '-'}`; grupos.set(k, (grupos.get(k) ?? 0) + 1); }
  if ([...grupos.values()].some((n) => n > 1)) out.push('COMPROMISSOS_CONCORRENTES');

  // canal que a tarefa exige e que o contato tinha, mas deixou de ser acionavel (supressao/status); ausencia pura nao conta
  const temDadoDoCanal = (c: Contato, canal: Canal) => (canal === 'EMAIL' ? !!c.email : !!(c.telefone || c.celular || c.whatsapp));
  if (tarefas.some((t) => {
    const canal = HIPOTESE_PLANO_CM.canalDaTarefa[t.tipo];
    const c = t.contatoId ? contatoPorId(t.contatoId) : undefined;
    return !!canal && !!c && contatoElegivel(c, r.supressoes) && temDadoDoCanal(c, canal) && !canaisAcionaveisCM(c, r.supressoes).includes(canal);
  })) out.push('CANAL_DA_TAREFA_INDISPONIVEL');

  const bloqueadaPorContato = razoes.some((x) => ehReferenciaDeTarefa(x) && !!x.bloqueadaPor?.includes('CONTATO_INELEGIVEL'))
    || (p.codigo === 'TRAVA_PARA_RESOLVER' && p.trava === 'CONTATO_INELEGIVEL' && p.referencia?.tipo === 'tarefa');
  if (bloqueadaPorContato) out.push('CONTATO_DA_TAREFA_INELEGIVEL');

  const negativa = razoes.find((x) => x.codigo === 'RESULTADO_NEGATIVO_SEM_FATO_NOVO' && x.referencia?.tipo === 'atividade');
  const atividadeNegativa = negativa ? r.atividades.find((a) => a.id === negativa.referencia!.id) : undefined;
  if (atividadeNegativa && tarefas.some((t) => t.criadoEm < (atividadeNegativa.criadoEm || atividadeNegativa.ocorreuEm))) out.push('TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO');

  if (RAZOES_DE_FOLLOW_UP.has(p.codigo) && item.secundarias.some((x) => RAZOES_DE_COMUNICACAO_PENDENTE.has(x.codigo))) out.push('COMUNICACAO_PENDENTE_NO_MESMO_TOQUE');

  if (r.oportunidades.some((o) => o.empresaId === item.empresaId && o.estagio === 'NURTURE' && !!o.proximaAcaoEm)) out.push('HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO');

  if (p.codigo === 'SEM_CANAL_VALIDO' && p.referencia?.tipo === 'contato') {
    const semCanal = p.referencia.id;
    if (r.contatos.some((c) => c.empresaId === item.empresaId && c.id !== semCanal && contatoElegivel(c, r.supressoes) && canaisAcionaveisCM(c, r.supressoes).length > 0)) out.push('CONTATO_RECOMENDADO_SEM_CANAL');
  }

  if (p.codigo === 'CONTA_PRIORITARIA_NUNCA_ABORDADA' && r.oportunidades.some((o) => o.empresaId === item.empresaId)) out.push('CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA');
  return out;
}

function fatosDe(rec: CadenceRecommendationCM): string[] {
  const fatos: string[] = [];
  const t = rec.proximoToque;
  if (t) fatos.push(`Próximo toque: ${TEXTO_NATUREZA_TOQUE_CM[t.natureza]}${t.em ? ` em ${dataBr(t.em)}` : ''}`);
  if (t?.ancoraEm) fatos.push(`Calculado a partir do último movimento real em ${dataBr(t.ancoraEm)}`);
  if (rec.tentativa) fatos.push(`Tentativas sem resposta seguidas: ${rec.tentativa.semRespostaSeguidas} de ${rec.tentativa.limite}`);
  if (rec.retomaCom) fatos.push(TEXTO_RETOMADA_CADENCIA_CM[rec.retomaCom]);
  for (const a of rec.avisos) fatos.push(TEXTO_AVISO_CADENCIA_CM[a]);
  return fatos;
}

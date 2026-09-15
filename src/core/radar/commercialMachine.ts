// EIFF Commercial Machine — CM1-A: motor da fila operacional comercial (uma entrada por conta).
//
// Orquestra as regras que o Radar ja tem (pipeline, contatos, sinalLeitura, comunicacao). Nao cria score comercial,
// nao soma pesos, nao cria entidade, nao grava e nao envia nada. A posicao de cada conta vem da escada de precedencia
// (categoria), da urgencia medida em fatos reais (dias de atraso, dias sem tratamento...) e so entao das chaves de
// desempate do Radar (classe, priorityScore, valor ponderado, prazo, id). Dado faltante nunca melhora a posicao.
//
// Tempo: `hoje` e normalizado para YYYY-MM-DD e toda comparacao comercial e por dia. A entrada e canonicalizada
// (colecoes ordenadas por id) antes de chamar qualquer regra, entao a saida nao depende da ordem das colecoes.
import { historicoDe, TRANSICOES_RESULTADO, type HistoricoComunicacao } from './comunicacao';
import { calcularDecisionFit, contatoElegivel, tipoProjetoPrincipal } from './contatos';
import { contatoRecomendado, empresaSuprimida, fitIdealDe, semProximaAcao } from './pipeline';
import { diasEntre } from './score';
import { HIPOTESE_RECENCIA_FALLBACK_DIAS, janelaPorTipo, sinalAcionavel } from './sinalLeitura';
import { estagioAtivo, type Atividade, type Canal, type ClassePrioridade, type CodigoResposta, type Contato, type Empresa, type Estagio, type Oportunidade, type RadarDataset, type Sinal, type Supressao, type TipoTarefa } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Versao e hipoteses operacionais
// ---------------------------------------------------------------------------------------------------------------------
/** Versao das regras da fila. Sobe sempre que uma hipotese, codigo ou precedencia mudar. */
export const VERSAO_REGRAS_CM = 'CM1-A.1';

type EstagioAtivo = Exclude<Estagio, 'WON' | 'LOST' | 'NURTURE'>;

/**
 * HIPOTESES OPERACIONAIS versionadas por VERSAO_REGRAS_CM — pontos de partida para medir, NAO verdade de negocio.
 * Ficam em codigo nesta fase (sem migration, sem tela de configuracao). Mudar um valor exige subir a versao.
 */
export const HIPOTESE_COMMERCIAL_MACHINE = {
  /** Dias maximos sem movimento (mudanca de estagio ou atividade real ligada a oportunidade) por estagio ativo. */
  slaEstagioDias: { DETECTED: 14, RESEARCHING: 10, QUALIFIED: 7, DECISION_MAKER_FOUND: 5, CONTACT_STARTED: 5, ENGAGED: 7, NEED_CONFIRMED: 7, PROJECT_RECEIVED: 3, ENGINEERING: 10, PRICING: 7, PROPOSAL_SENT: 5, NEGOTIATION: 5 } as Readonly<Record<EstagioAtivo, number>>,
  /** Parada por N vezes o SLA do estagio (ou mais) e critica: sobe para AGIR_AGORA. */
  multiplicadorParadaCritica: 2,
  /** Dias de espera depois de uma tentativa sem resposta antes do proximo toque. */
  intervaloFollowUpDias: 4,
  /** Tentativas seguidas sem resposta (contagem de historicoDe) a partir das quais a conta vai para NURTURE. */
  limiteTentativasSemResposta: 5,
  /** Sinal acionavel detectado ha ate N dias e ainda nao tratado vira AGIR_AGORA. */
  sinalNovoDias: 7,
  /** Espelho do padrao de `fit.adequado` usado em pipeline.ts (la e privado); so vale quando a chave nao existe. */
  fitAdequadoPadrao: 40,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Taxonomia
// ---------------------------------------------------------------------------------------------------------------------
/** Categorias na ordem da escada de precedencia (indice + 1 = degrau). AGENDADO nao e acionavel antes do prazo. */
export const CATEGORIAS_COMMERCIAL_QUEUE = ['AGIR_AGORA', 'AVANCAR_OPORTUNIDADE', 'FOLLOW_UP', 'REVISAR', 'PROSPECTAR', 'ENRIQUECER', 'NURTURE', 'AGENDADO'] as const;
export type CategoriaCommercialQueue = (typeof CATEGORIAS_COMMERCIAL_QUEUE)[number];
export const DEGRAU_CATEGORIA: Readonly<Record<CategoriaCommercialQueue, number>> = { AGIR_AGORA: 1, AVANCAR_OPORTUNIDADE: 2, FOLLOW_UP: 3, REVISAR: 4, PROSPECTAR: 5, ENRIQUECER: 6, NURTURE: 7, AGENDADO: 8 };

export const CODIGOS_RAZAO_CM = [
  'RESPOSTA_NAO_TRATADA', 'TAREFA_VENCIDA', 'OPORTUNIDADE_ACAO_VENCIDA', 'SINAL_ACIONAVEL_NOVO', 'OPORTUNIDADE_PARADA_CRITICA',
  'OPORTUNIDADE_SEM_PROXIMA_ACAO', 'OPORTUNIDADE_PARADA',
  'PROXIMA_ACAO_HOJE', 'COMUNICACAO_APROVADA_NAO_ENVIADA', 'FOLLOW_UP_SEM_RESPOSTA', 'TENTATIVA_CONTATO_INVALIDO',
  'COMUNICACAO_PARA_REVISAO', 'TRAVA_PARA_RESOLVER', 'INCONSISTENCIA_PARA_REVISAR',
  'CONTA_PRIORITARIA_NUNCA_ABORDADA',
  'SINAL_NAO_VERIFICADO', 'SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL', 'SEM_CANAL_VALIDO',
  'RESULTADO_NEGATIVO_SEM_FATO_NOVO', 'OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO', 'TENTATIVAS_ESGOTADAS', 'OPORTUNIDADE_EM_NURTURE', 'CLIENTE_GANHO', 'SEM_TIMING_ATUAL',
  'PROXIMA_ACAO_AGENDADA', 'FOLLOW_UP_EM_INTERVALO',
] as const;
export type CodigoRazaoCM = (typeof CODIGOS_RAZAO_CM)[number];

export const CODIGOS_TRAVA_CM = ['DUPLICATA_PENDENTE', 'CONTATO_INELEGIVEL', 'CONFLITO_TAREFA_COMUNICACAO', 'OPORTUNIDADE_SEM_RESPONSAVEL'] as const;
export type CodigoTravaCM = (typeof CODIGOS_TRAVA_CM)[number];

export const MOTIVOS_FORA_DA_FILA = ['EMPRESA_MESCLADA', 'EMPRESA_INATIVA', 'EMPRESA_SUPRIMIDA', 'SEM_RELEVANCIA_ATUAL'] as const;
export type MotivoForaDaFila = (typeof MOTIVOS_FORA_DA_FILA)[number];

/** Categoria, degrau interno (tier), tipo de tarefa sugerido e se a razao cede lugar a uma acao ja agendada. */
interface RegraRazao { categoria: CategoriaCommercialQueue; tier: number; tipoTarefa: TipoTarefa; adiavel: boolean }
const REGRA_RAZAO: Readonly<Record<CodigoRazaoCM, RegraRazao>> = {
  RESPOSTA_NAO_TRATADA: { categoria: 'AGIR_AGORA', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  TAREFA_VENCIDA: { categoria: 'AGIR_AGORA', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  OPORTUNIDADE_ACAO_VENCIDA: { categoria: 'AGIR_AGORA', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  SINAL_ACIONAVEL_NOVO: { categoria: 'AGIR_AGORA', tier: 2, tipoTarefa: 'CALL', adiavel: false },
  OPORTUNIDADE_PARADA_CRITICA: { categoria: 'AGIR_AGORA', tier: 3, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  OPORTUNIDADE_SEM_PROXIMA_ACAO: { categoria: 'AVANCAR_OPORTUNIDADE', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  OPORTUNIDADE_PARADA: { categoria: 'AVANCAR_OPORTUNIDADE', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  PROXIMA_ACAO_HOJE: { categoria: 'FOLLOW_UP', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  COMUNICACAO_APROVADA_NAO_ENVIADA: { categoria: 'FOLLOW_UP', tier: 1, tipoTarefa: 'OTHER', adiavel: false },
  FOLLOW_UP_SEM_RESPOSTA: { categoria: 'FOLLOW_UP', tier: 2, tipoTarefa: 'CALL', adiavel: true },
  TENTATIVA_CONTATO_INVALIDO: { categoria: 'FOLLOW_UP', tier: 2, tipoTarefa: 'RESEARCH', adiavel: true },
  COMUNICACAO_PARA_REVISAO: { categoria: 'REVISAR', tier: 0, tipoTarefa: 'OTHER', adiavel: false },
  TRAVA_PARA_RESOLVER: { categoria: 'REVISAR', tier: 0, tipoTarefa: 'OTHER', adiavel: false },
  INCONSISTENCIA_PARA_REVISAR: { categoria: 'REVISAR', tier: 1, tipoTarefa: 'OTHER', adiavel: false },
  CONTA_PRIORITARIA_NUNCA_ABORDADA: { categoria: 'PROSPECTAR', tier: 1, tipoTarefa: 'CALL', adiavel: true },
  SINAL_NAO_VERIFICADO: { categoria: 'ENRIQUECER', tier: 1, tipoTarefa: 'RESEARCH', adiavel: true },
  SEM_DECISOR: { categoria: 'ENRIQUECER', tier: 5, tipoTarefa: 'RESEARCH', adiavel: true },
  SEM_DECISOR_IDEAL_PARA_SINAL: { categoria: 'ENRIQUECER', tier: 1, tipoTarefa: 'RESEARCH', adiavel: true },
  SEM_CANAL_VALIDO: { categoria: 'ENRIQUECER', tier: 5, tipoTarefa: 'RESEARCH', adiavel: true },
  RESULTADO_NEGATIVO_SEM_FATO_NOVO: { categoria: 'NURTURE', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO: { categoria: 'NURTURE', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  TENTATIVAS_ESGOTADAS: { categoria: 'NURTURE', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  OPORTUNIDADE_EM_NURTURE: { categoria: 'NURTURE', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  CLIENTE_GANHO: { categoria: 'NURTURE', tier: 2, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  SEM_TIMING_ATUAL: { categoria: 'NURTURE', tier: 3, tipoTarefa: 'FOLLOW_UP', adiavel: true },
  PROXIMA_ACAO_AGENDADA: { categoria: 'AGENDADO', tier: 0, tipoTarefa: 'FOLLOW_UP', adiavel: false },
  FOLLOW_UP_EM_INTERVALO: { categoria: 'AGENDADO', tier: 1, tipoTarefa: 'FOLLOW_UP', adiavel: false },
};

/** Acoes de contato que uma duplicata pendente segura ate a revisao (compromissos e oportunidades nao sao bloqueados). */
const BLOQUEADAS_POR_DUPLICATA: ReadonlySet<CodigoRazaoCM> = new Set<CodigoRazaoCM>(['SINAL_ACIONAVEL_NOVO', 'FOLLOW_UP_SEM_RESPOSTA', 'TENTATIVA_CONTATO_INVALIDO', 'COMUNICACAO_APROVADA_NAO_ENVIADA', 'CONTA_PRIORITARIA_NUNCA_ABORDADA', 'SINAL_NAO_VERIFICADO', 'SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL', 'SEM_CANAL_VALIDO']);

// ---------------------------------------------------------------------------------------------------------------------
// Textos pt-BR (a tela mostra estes textos; nenhuma regra mora na tela)
// ---------------------------------------------------------------------------------------------------------------------
export const NOME_CATEGORIA_CM: Readonly<Record<CategoriaCommercialQueue, string>> = { AGIR_AGORA: 'Agir agora', AVANCAR_OPORTUNIDADE: 'Avançar oportunidade', FOLLOW_UP: 'Follow-up', REVISAR: 'Revisar', PROSPECTAR: 'Prospectar', ENRIQUECER: 'Enriquecer', NURTURE: 'Nutrir', AGENDADO: 'Agendado' };
export const TEXTO_RAZAO_CM: Readonly<Record<CodigoRazaoCM, string>> = {
  RESPOSTA_NAO_TRATADA: 'O cliente respondeu e ninguém tratou a resposta ainda',
  TAREFA_VENCIDA: 'Tarefa com prazo vencido',
  OPORTUNIDADE_ACAO_VENCIDA: 'Próxima ação da oportunidade com prazo vencido',
  SINAL_ACIONAVEL_NOVO: 'Sinal de mercado novo e acionável, com decisor pronto para abordar',
  OPORTUNIDADE_SEM_PROXIMA_ACAO: 'Oportunidade ativa sem próxima ação',
  OPORTUNIDADE_PARADA: 'Oportunidade parada além do prazo do estágio',
  OPORTUNIDADE_PARADA_CRITICA: 'Oportunidade parada há pelo menos o dobro do prazo do estágio',
  PROXIMA_ACAO_HOJE: 'Próxima ação vence hoje',
  COMUNICACAO_APROVADA_NAO_ENVIADA: 'Abordagem aprovada aguardando envio manual e registro',
  FOLLOW_UP_SEM_RESPOSTA: 'Tentativa sem resposta: hora do próximo toque',
  TENTATIVA_CONTATO_INVALIDO: 'Última tentativa deu contato inválido: seguir por outro canal ou contato válido',
  COMUNICACAO_PARA_REVISAO: 'Abordagem aguardando revisão humana',
  TRAVA_PARA_RESOLVER: 'Existe uma trava impedindo a próxima ação',
  INCONSISTENCIA_PARA_REVISAR: 'Inconsistência de dados para revisar',
  CONTA_PRIORITARIA_NUNCA_ABORDADA: 'Conta prioritária nunca abordada, com decisor e canal prontos',
  SINAL_NAO_VERIFICADO: 'Sinal acionável ainda não verificado',
  SEM_DECISOR: 'Falta um decisor adequado para abordar',
  SEM_DECISOR_IDEAL_PARA_SINAL: 'O sinal pede o decisor ideal e o melhor contato está abaixo do corte',
  SEM_CANAL_VALIDO: 'O contato não tem canal válido',
  RESULTADO_NEGATIVO_SEM_FATO_NOVO: 'Último resultado negativo e nenhum fato novo desde então',
  OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO: 'Oportunidade perdida e nenhum fato novo desde então',
  TENTATIVAS_ESGOTADAS: 'Limite de tentativas sem resposta atingido',
  OPORTUNIDADE_EM_NURTURE: 'Oportunidade em nutrição',
  CLIENTE_GANHO: 'Cliente com oportunidade ganha e sem negócio ativo',
  SEM_TIMING_ATUAL: 'Conta relevante sem momento comercial atual',
  PROXIMA_ACAO_AGENDADA: 'Próxima ação já agendada',
  FOLLOW_UP_EM_INTERVALO: 'Aguardando o intervalo antes do próximo toque',
};
export const TEXTO_TRAVA_CM: Readonly<Record<CodigoTravaCM, string>> = {
  DUPLICATA_PENDENTE: 'Possível duplicata pendente: resolver antes de abordar',
  CONTATO_INELEGIVEL: 'O contato da ação não pode ser abordado (não contatar, opt-out, inválido, saiu da empresa ou inexistente)',
  CONFLITO_TAREFA_COMUNICACAO: 'Tarefa e abordagem apontam para contatos diferentes',
  OPORTUNIDADE_SEM_RESPONSAVEL: 'Oportunidade sem responsável válido',
};
export const TEXTO_FORA_DA_FILA: Readonly<Record<MotivoForaDaFila, string>> = {
  EMPRESA_MESCLADA: 'Empresa mesclada em outra',
  EMPRESA_INATIVA: 'Empresa inativa',
  EMPRESA_SUPRIMIDA: 'Empresa marcada como não contatar',
  SEM_RELEVANCIA_ATUAL: 'Sem relevância comercial atual (classe C/D sem histórico, sinal, oportunidade ou tarefa)',
};

// ---------------------------------------------------------------------------------------------------------------------
// Contrato de saida
// ---------------------------------------------------------------------------------------------------------------------
export type TipoReferenciaCM = 'empresa' | 'contato' | 'tarefa' | 'atividade' | 'oportunidade' | 'sinal' | 'comunicacao' | 'duplicata';
export interface ReferenciaCM { tipo: TipoReferenciaCM; id: string }

export interface RazaoCM {
  codigo: CodigoRazaoCM;
  categoria: CategoriaCommercialQueue;
  estado: 'PRINCIPAL' | 'PENDENTE' | 'BLOQUEADA' | 'ADIADA';
  degrau: number;
  tier: number;
  /** Maior = mais urgente. Sempre derivada de fato real (dias); AGENDADO usa -dias ate o prazo. */
  urgencia: number;
  tipoTarefa: TipoTarefa;
  referencia?: ReferenciaCM;
  contatoId?: string;
  /** Data do fato que originou a razao (YYYY-MM-DD). */
  em?: string;
  /** Prazo da acao (YYYY-MM-DD), quando existe. */
  venceEm?: string;
  dias?: number;
  resultado?: CodigoResposta;
  /** TRAVA_PARA_RESOLVER / INCONSISTENCIA_PARA_REVISAR: qual trava. */
  trava?: CodigoTravaCM;
  /** TRAVA_PARA_RESOLVER: a acao que ficou bloqueada. */
  acaoBloqueada?: CodigoRazaoCM;
  /** Estado BLOQUEADA: travas que seguram esta acao. */
  bloqueadaPor?: CodigoTravaCM[];
}

export interface TravaCM { codigo: CodigoTravaCM; bloqueante: boolean; referencia: ReferenciaCM; relacionada?: ReferenciaCM; contatoId?: string; bloqueia: CodigoRazaoCM[] }

export interface ContatoCM { id: string; fit: number; ideal: boolean; adequado: boolean; canais: Canal[]; recomendado: boolean; razoesFit: string[] }

export interface OrdemCM { degrau: number; tier: number; urgencia: number; classe: number; priorityScore: number; valorPonderado: number; venceEm?: string }
export const CHAVES_ORDEM_CM = ['degrau', 'tier', 'urgencia', 'classe', 'priorityScore', 'valorPonderado', 'venceEm', 'empresaId'] as const;
export type ChaveOrdemCM = (typeof CHAVES_ORDEM_CM)[number];

export type OrigemResponsavelCM = 'TAREFA' | 'OPORTUNIDADE' | 'ATIVIDADE' | 'COMUNICACAO' | 'NENHUMA';

export interface CommercialQueueItem {
  empresaId: string;
  posicao: number;
  categoria: CategoriaCommercialQueue;
  porQueAgora: RazaoCM;
  secundarias: RazaoCM[];
  travas: TravaCM[];
  /** Quem abordar: o contato da acao (se elegivel) ou o recomendado. Nunca inelegivel. */
  contato?: ContatoCM;
  oportunidadeId?: string;
  sinalId?: string;
  responsavelId?: string;
  origemResponsavel: OrigemResponsavelCM;
  historico: HistoricoComunicacao;
  priorityScore: number;
  priorityClass: ClassePrioridade;
  ordem: OrdemCM;
}

export interface CommercialQueue {
  geradaEm: string;
  versaoRegras: string;
  itens: CommercialQueueItem[];
  porCategoria: Record<CategoriaCommercialQueue, number>;
  foraDaFila: { empresaId: string; motivo: MotivoForaDaFila }[];
}

export interface OpcoesCommercialQueue {
  /** Ids de usuarios validos; sem a lista, so responsavel vazio conta como "sem responsavel". */
  usuariosValidos?: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilitarios puros
// ---------------------------------------------------------------------------------------------------------------------
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dia = (v: string) => v.slice(0, 10);
/** a nao e anterior a b: timestamps completos se comparam inteiros; se algum for so data, compara o dia. */
const naoAntes = (a: string, b: string) => (a.length > 10 && b.length > 10 ? a >= b : dia(a) >= dia(b));
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const RANK_CLASSE: Readonly<Record<ClassePrioridade, number>> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 };

/** Normaliza a data de referencia para YYYY-MM-DD (aceita data ou ISO); recusa valor invalido. */
export function normalizarHojeCM(hoje: string): string {
  const d = typeof hoje === 'string' ? hoje.slice(0, 10) : '';
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d && !Number.isNaN(Date.parse(hoje));
  if (!valida) throw new Error('commercial_queue_data_invalida');
  return d;
}

const porId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => cmp(a.id, b.id));
/** Canonicaliza as colecoes lidas pelas regras reutilizadas (varias desempatam pela ordem de entrada). */
function canonico(r: RadarDataset): RadarDataset {
  return {
    ...r,
    empresas: porId(r.empresas), contatos: porId(r.contatos), projetos: porId(r.projetos), sinais: porId(r.sinais),
    oportunidades: porId(r.oportunidades), historicoEstagios: porId(r.historicoEstagios), atividades: porId(r.atividades),
    tarefas: porId(r.tarefas), comunicacoes: porId(r.comunicacoes), duplicatas: porId(r.duplicatas), supressoes: porId(r.supressoes),
    regrasPersona: porId(r.regrasPersona), pesosDecisionFit: [...r.pesosDecisionFit].sort((a, b) => cmp(a.chave, b.chave) || a.valor - b.valor),
  };
}

function agrupar<T>(xs: readonly T[], chave: (x: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = chave(x); if (k === undefined) continue; const l = m.get(k); if (l) l.push(x); else m.set(k, [x]); }
  return m;
}

/**
 * Canais acionaveis do contato para a fila. Mesma base de `temCanal` (e-mail e telefone com status valido; LinkedIn nao
 * conta) e, alem dela, respeita as supressoes por canal `email_bounced` / `invalid_phone` — criadas automaticamente por
 * INVALID_CONTACT e ainda ignoradas por `temCanal`/`canaisDoContato`. Regra local da fila: nao altera o Server Truth.
 */
export function canaisAcionaveisCM(c: Contato, supressoes: readonly Supressao[]): Canal[] {
  const suprimido = (tipo: Supressao['tipo']) => supressoes.some((s) => s.contatoId === c.id && s.tipo === tipo);
  const telefoneOk = (!!c.telefone || !!c.celular || !!c.whatsapp) && c.statusTelefone !== 'invalido' && !suprimido('invalid_phone');
  const out: Canal[] = [];
  if (telefoneOk && (c.celular || c.whatsapp)) out.push('WHATSAPP');
  if (telefoneOk) out.push('PHONE');
  if (c.email && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido' && !suprimido('email_bounced')) out.push('EMAIL');
  return out;
}

const respostaAcionavel = (x?: CodigoResposta): x is CodigoResposta => !!x && x !== 'NO_RESPONSE' && x !== 'GATEKEEPER' && !!TRANSICOES_RESULTADO[x]?.comunicar;
const resultadoNegativo = (x?: CodigoResposta): x is CodigoResposta => !!x && x !== 'INVALID_CONTACT' && !!TRANSICOES_RESULTADO[x] && !TRANSICOES_RESULTADO[x].comunicar;
const semResposta = (x?: CodigoResposta) => !x || x === 'NO_RESPONSE' || x === 'GATEKEEPER';
const comunicacaoViva = (estado: string) => estado !== 'REJECTED' && estado !== 'CANCELLED';

// ---------------------------------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------------------------------
type Candidata = RazaoCM;

function compararRazoes(a: RazaoCM, b: RazaoCM): number {
  return a.degrau - b.degrau || a.tier - b.tier || b.urgencia - a.urgencia || cmp(a.codigo, b.codigo) || cmp(a.referencia?.id ?? '', b.referencia?.id ?? '') || cmp(a.trava ?? '', b.trava ?? '');
}

/** Primeira chave de ordenacao em que dois itens diferem (explica "por que esta acima"). */
export function chaveQueDecideCM(a: CommercialQueueItem, b: CommercialQueueItem): ChaveOrdemCM | 'EMPATE' {
  for (const k of CHAVES_ORDEM_CM) if (compararPorChave(a, b, k) !== 0) return k;
  return 'EMPATE';
}
function compararPorChave(a: CommercialQueueItem, b: CommercialQueueItem, k: ChaveOrdemCM): number {
  switch (k) {
    case 'degrau': return a.ordem.degrau - b.ordem.degrau;
    case 'tier': return a.ordem.tier - b.ordem.tier;
    case 'urgencia': return b.ordem.urgencia - a.ordem.urgencia;
    case 'classe': return a.ordem.classe - b.ordem.classe;
    case 'priorityScore': return b.ordem.priorityScore - a.ordem.priorityScore;
    case 'valorPonderado': return b.ordem.valorPonderado - a.ordem.valorPonderado;
    case 'venceEm': return cmp(a.ordem.venceEm ?? '9999-12-31', b.ordem.venceEm ?? '9999-12-31');
    case 'empresaId': return cmp(a.empresaId, b.empresaId);
  }
}
export function compararItensCM(a: CommercialQueueItem, b: CommercialQueueItem): number {
  for (const k of CHAVES_ORDEM_CM) { const c = compararPorChave(a, b, k); if (c) return c; }
  return 0;
}

export function construirCommercialQueue(ds: RadarDataset, hoje: string, opcoes: OpcoesCommercialQueue = {}): CommercialQueue {
  const d0 = normalizarHojeCM(hoje);
  const r = canonico(ds);
  const H = HIPOTESE_COMMERCIAL_MACHINE;
  const fitIdeal = fitIdealDe(r);
  const fitAdequado = r.pesosDecisionFit.find((p) => p.chave === 'fit.adequado')?.valor ?? H.fitAdequadoPadrao;
  const usuariosValidos = opcoes.usuariosValidos ? new Set(opcoes.usuariosValidos) : undefined;

  const contatoPorId = new Map(r.contatos.map((c) => [c.id, c]));
  const oportunidadePorId = new Map(r.oportunidades.map((o) => [o.id, o]));
  const tarefasPorEmpresa = agrupar(r.tarefas, (t) => t.empresaId);
  const atividadesPorEmpresa = agrupar(r.atividades, (a) => a.empresaId);
  const oportunidadesPorEmpresa = agrupar(r.oportunidades, (o) => o.empresaId);
  const historicoPorOportunidade = agrupar(r.historicoEstagios, (h) => h.oportunidadeId);
  const sinaisPorEmpresa = agrupar(r.sinais, (s) => s.empresaId);
  const comunicacoesPorEmpresa = agrupar(r.comunicacoes, (c) => c.empresaId);

  const diasDesde = (data: string) => diasEntre(dia(data), d0);
  const diasAte = (data: string) => diasEntre(d0, dia(data));
  const dentroJanela = (s: Sinal) => diasDesde(s.eventoEm) <= (janelaPorTipo(s.tipo) ?? HIPOTESE_RECENCIA_FALLBACK_DIAS);

  const itens: CommercialQueueItem[] = [];
  const foraDaFila: CommercialQueue['foraDaFila'] = [];

  for (const e of r.empresas) {
    if (e.mescladaEm) { foraDaFila.push({ empresaId: e.id, motivo: 'EMPRESA_MESCLADA' }); continue; }
    if (!e.ativo) { foraDaFila.push({ empresaId: e.id, motivo: 'EMPRESA_INATIVA' }); continue; }
    if (empresaSuprimida(e.id, r)) { foraDaFila.push({ empresaId: e.id, motivo: 'EMPRESA_SUPRIMIDA' }); continue; }
    const item = avaliarConta(e);
    if (item) itens.push(item); else foraDaFila.push({ empresaId: e.id, motivo: 'SEM_RELEVANCIA_ATUAL' });
  }

  itens.sort(compararItensCM);
  itens.forEach((it, i) => { it.posicao = i + 1; });
  const porCategoria = Object.fromEntries(CATEGORIAS_COMMERCIAL_QUEUE.map((c) => [c, itens.filter((i) => i.categoria === c).length])) as Record<CategoriaCommercialQueue, number>;
  return { geradaEm: d0, versaoRegras: VERSAO_REGRAS_CM, itens, porCategoria, foraDaFila };

  function avaliarConta(e: Empresa): CommercialQueueItem | undefined {
    const tarefas = tarefasPorEmpresa.get(e.id) ?? [];
    const abertas = tarefas.filter((t) => t.status === 'Aberta');
    // NOTE nao e interacao com o cliente (mesma regra de historicoDe e atualizarCaches)
    const reais = (atividadesPorEmpresa.get(e.id) ?? []).filter((a) => a.tipo !== 'NOTE').sort((a, b) => cmp(a.ocorreuEm, b.ocorreuEm) || cmp(a.criadoEm, b.criadoEm) || cmp(a.id, b.id));
    const ultima: Atividade | undefined = reais[reais.length - 1];
    const historico = historicoDe(r.atividades, e.id);
    const oportunidades = oportunidadesPorEmpresa.get(e.id) ?? [];
    const ativas = oportunidades.filter((o) => estagioAtivo(o.estagio));
    const sinais = sinaisPorEmpresa.get(e.id) ?? [];
    const sinaisVerificados = sinais.filter((s) => s.verificado);
    const comunicacoes = comunicacoesPorEmpresa.get(e.id) ?? [];
    const duplicatas = r.duplicatas.filter((x) => x.status === 'pendente' && (x.empresaId === e.id || x.candidataId === e.id));
    const recomendado = contatoRecomendado(e.id, r);
    const elegivel = (c: Contato | undefined): boolean => !!c && c.empresaId === e.id && contatoElegivel(c, r.supressoes);
    const canais = (c: Contato) => canaisAcionaveisCM(c, r.supressoes);

    const cands: Candidata[] = [];
    const travas: TravaCM[] = [];
    const nova = (codigo: CodigoRazaoCM, p: Partial<Omit<RazaoCM, 'codigo'>> = {}): Candidata => {
      const regra = REGRA_RAZAO[codigo];
      const categoria = p.categoria ?? regra.categoria;
      const c: Candidata = { codigo, categoria, estado: 'PENDENTE', degrau: DEGRAU_CATEGORIA[categoria], tier: regra.tier, urgencia: 0, tipoTarefa: regra.tipoTarefa, ...p };
      cands.push(c);
      return c;
    };
    /** Acao de contato que depende de dado: sem decisor ou canal vira ENRIQUECER no degrau 6, com tier = degrau da acao que existiria. */
    const acaoDeContato = (seProto: () => void, c: Contato | undefined, fitMinimo: number | undefined, fit: number | undefined, degrauDaAcao: number, ref: ReferenciaCM, em?: string) => {
      if (!c) { nova('SEM_DECISOR', { tier: degrauDaAcao, referencia: ref, em }); return; }
      if (fitMinimo !== undefined && (fit ?? 0) < fitMinimo) { nova(fitMinimo === fitIdeal && degrauDaAcao === 1 ? 'SEM_DECISOR_IDEAL_PARA_SINAL' : 'SEM_DECISOR', { tier: degrauDaAcao, referencia: ref, em }); return; }
      if (!canais(c).length) { nova('SEM_CANAL_VALIDO', { tier: degrauDaAcao, referencia: { tipo: 'contato', id: c.id }, em }); return; }
      seProto();
    };

    // 1) Resposta do cliente: urgente ate ser tratada, sem prazo de expiracao
    if (ultima && respostaAcionavel(ultima.resultado)) {
      const marco = ultima.criadoEm || ultima.ocorreuEm;
      const tratada = tarefas.some((t) => t.status !== 'Cancelada' && naoAntes(t.criadoEm, marco))
        || oportunidades.some((o) => naoAntes(o.criadoEm, marco) || (historicoPorOportunidade.get(o.id) ?? []).some((h) => naoAntes(h.em, marco)))
        || comunicacoes.some((c) => comunicacaoViva(c.estado) && naoAntes(c.criadoEm, marco));
      if (!tratada) { const dias = diasDesde(ultima.ocorreuEm); nova('RESPOSTA_NAO_TRATADA', { referencia: { tipo: 'atividade', id: ultima.id }, contatoId: ultima.contatoId, em: dia(ultima.ocorreuEm), dias, urgencia: dias, resultado: ultima.resultado, tipoTarefa: TRANSICOES_RESULTADO[ultima.resultado].objetivo === 'SCHEDULE_MEETING' ? 'MEETING' : 'FOLLOW_UP' }); }
    }

    // 2) Resultado negativo e perda: a conta so reacende com fato novo (sinal acionavel verificado detectado depois)
    const fatoNovoApos = (marcoDia: string) => sinaisVerificados.some((s) => sinalAcionavel(s) && dentroJanela(s) && dia(s.detectadoEm) > marcoDia);
    let emEspera = false;
    if (ultima && resultadoNegativo(ultima.resultado) && !fatoNovoApos(dia(ultima.ocorreuEm))) {
      emEspera = true;
      nova('RESULTADO_NEGATIVO_SEM_FATO_NOVO', { referencia: { tipo: 'atividade', id: ultima.id }, em: dia(ultima.ocorreuEm), dias: diasDesde(ultima.ocorreuEm), resultado: ultima.resultado });
    }
    const fechadas = oportunidades.filter((o) => o.estagio === 'WON' || o.estagio === 'LOST').map((o) => ({ o, em: dia(o.fechadoEm ?? o.atualizadoEm) })).sort((a, b) => cmp(a.em, b.em) || cmp(a.o.id, b.o.id));
    const ultimaFechada = fechadas[fechadas.length - 1];
    if (!ativas.length && ultimaFechada?.o.estagio === 'LOST' && !reais.some((a) => dia(a.ocorreuEm) > ultimaFechada.em) && !fatoNovoApos(ultimaFechada.em)) {
      emEspera = true;
      nova('OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO', { referencia: { tipo: 'oportunidade', id: ultimaFechada.o.id }, em: ultimaFechada.em, dias: diasDesde(ultimaFechada.em) });
    }
    if (!ativas.length && ultimaFechada?.o.estagio === 'WON') nova('CLIENTE_GANHO', { referencia: { tipo: 'oportunidade', id: ultimaFechada.o.id }, em: ultimaFechada.em });
    const emNurture = oportunidades.find((o) => o.estagio === 'NURTURE');
    if (!ativas.length && emNurture) nova('OPORTUNIDADE_EM_NURTURE', { referencia: { tipo: 'oportunidade', id: emNurture.id } });

    // 3) Tarefas abertas (compromissos do vendedor)
    for (const t of abertas) {
      const v = dia(t.venceEm);
      const base = { referencia: { tipo: 'tarefa', id: t.id } as ReferenciaCM, contatoId: t.contatoId, venceEm: v, tipoTarefa: t.tipo };
      if (v < d0) { const dias = diasEntre(v, d0); nova('TAREFA_VENCIDA', { ...base, em: v, dias, urgencia: dias }); }
      else if (v === d0) nova('PROXIMA_ACAO_HOJE', { ...base, em: v, dias: 0 });
      else { const dias = diasAte(v); nova('PROXIMA_ACAO_AGENDADA', { ...base, em: v, dias, urgencia: -dias }); }
    }

    // 4) Oportunidades ativas
    for (const o of ativas) {
      const doNegocio = abertas.filter((t) => t.oportunidadeId === o.id);
      const movimentos = [dia(o.criadoEm), ...(historicoPorOportunidade.get(o.id) ?? []).map((h) => dia(h.em)), ...reais.filter((a) => a.oportunidadeId === o.id).map((a) => dia(a.ocorreuEm))].sort();
      const semMovimento = diasEntre(movimentos[movimentos.length - 1], d0);
      const ref: ReferenciaCM = { tipo: 'oportunidade', id: o.id };
      if (semProximaAcao(o, r.tarefas)) nova('OPORTUNIDADE_SEM_PROXIMA_ACAO', { referencia: ref, dias: semMovimento, urgencia: semMovimento });
      else if (o.proximaAcaoEm) {
        const v = dia(o.proximaAcaoEm);
        if (v < d0 && !doNegocio.some((t) => dia(t.venceEm) >= d0)) { const dias = diasEntre(v, d0); nova('OPORTUNIDADE_ACAO_VENCIDA', { referencia: ref, em: v, venceEm: v, dias, urgencia: dias }); }
        else if (v === d0) nova('PROXIMA_ACAO_HOJE', { referencia: ref, em: v, venceEm: v, dias: 0 });
        else if (v > d0) { const dias = diasAte(v); nova('PROXIMA_ACAO_AGENDADA', { referencia: ref, em: v, venceEm: v, dias, urgencia: -dias }); }
      }
      const sla = H.slaEstagioDias[o.estagio as EstagioAtivo];
      // aging nao cede a uma acao agendada: prazo futuro nao faz o negocio andar
      if (semMovimento > sla) nova(semMovimento >= sla * H.multiplicadorParadaCritica ? 'OPORTUNIDADE_PARADA_CRITICA' : 'OPORTUNIDADE_PARADA', { referencia: ref, em: movimentos[movimentos.length - 1], dias: semMovimento, urgencia: semMovimento - sla });
      if (!o.responsavelId?.trim() || (usuariosValidos && !usuariosValidos.has(o.responsavelId))) travas.push({ codigo: 'OPORTUNIDADE_SEM_RESPONSAVEL', bloqueante: false, referencia: ref, bloqueia: [] });
    }

    // 5) Sinais: acionavel (sinalAcionavel), verificado, dentro da janela da familia, novo e nao tratado
    const tratadoDesde = (d: string) => reais.some((a) => dia(a.ocorreuEm) >= d) || tarefas.some((t) => t.status !== 'Cancelada' && dia(t.criadoEm) >= d) || comunicacoes.some((c) => comunicacaoViva(c.estado) && dia(c.criadoEm) >= d);
    const quente = (s: Sinal) => sinalAcionavel(s) && dentroJanela(s) && diasDesde(s.detectadoEm) <= H.sinalNovoDias && !tratadoDesde(dia(s.detectadoEm));
    const porDeteccao = (a: Sinal, b: Sinal) => cmp(a.detectadoEm, b.detectadoEm) || cmp(a.id, b.id);
    let caminhoDeSinal = false;
    if (!emEspera) {
      const s = sinaisVerificados.filter(quente).sort(porDeteccao)[0];
      if (s) {
        caminhoDeSinal = true;
        const ref: ReferenciaCM = { tipo: 'sinal', id: s.id }; const dias = diasDesde(s.detectadoEm);
        acaoDeContato(() => nova('SINAL_ACIONAVEL_NOVO', { referencia: ref, contatoId: recomendado!.contato.id, em: dia(s.detectadoEm), dias, urgencia: dias }), recomendado?.contato, fitIdeal, recomendado?.fit.score, 1, ref, dia(s.detectadoEm));
      }
      const naoVerificado = sinais.filter((x) => !x.verificado && quente(x)).sort(porDeteccao)[0];
      if (naoVerificado) { caminhoDeSinal = true; nova('SINAL_NAO_VERIFICADO', { referencia: { tipo: 'sinal', id: naoVerificado.id }, em: dia(naoVerificado.detectadoEm), dias: diasDesde(naoVerificado.detectadoEm) }); }
    }

    // 6) Follow-up depois de tentativa sem resposta (cadencia minima; a cadencia completa e CM2)
    if (ultima && !emEspera && semResposta(ultima.resultado)) {
      const ref: ReferenciaCM = { tipo: 'atividade', id: ultima.id };
      const dias = diasDesde(ultima.ocorreuEm);
      if (historico.semRespostaSeguidas >= H.limiteTentativasSemResposta) nova('TENTATIVAS_ESGOTADAS', { referencia: ref, em: dia(ultima.ocorreuEm), dias });
      else if (dias < H.intervaloFollowUpDias) { const v = somarDias(dia(ultima.ocorreuEm), H.intervaloFollowUpDias); const faltam = diasAte(v); nova('FOLLOW_UP_EM_INTERVALO', { referencia: ref, em: dia(ultima.ocorreuEm), venceEm: v, dias: faltam, urgencia: -faltam }); }
      else {
        const alvo = ultima.contatoId ? contatoPorId.get(ultima.contatoId) : undefined;
        const c = elegivel(alvo) ? alvo : recomendado?.contato;
        acaoDeContato(() => nova('FOLLOW_UP_SEM_RESPOSTA', { referencia: ref, contatoId: c!.id, em: dia(ultima.ocorreuEm), dias, urgencia: dias }), c, undefined, undefined, 3, ref, dia(ultima.ocorreuEm));
      }
    }

    // 6b) Ultima tentativa deu contato invalido (TRANSICOES_RESULTADO: trocar de contato/canal); a supressao por canal ja
    // existe, entao so segue com contato elegivel que ainda tenha canal acionavel — sem esperar intervalo
    if (ultima && !emEspera && ultima.resultado === 'INVALID_CONTACT') {
      const ref: ReferenciaCM = { tipo: 'atividade', id: ultima.id };
      const dias = diasDesde(ultima.ocorreuEm);
      const alvo = ultima.contatoId ? contatoPorId.get(ultima.contatoId) : undefined;
      const c = alvo && elegivel(alvo) && canais(alvo).length ? alvo : recomendado?.contato;
      acaoDeContato(() => nova('TENTATIVA_CONTATO_INVALIDO', { referencia: ref, contatoId: c!.id, em: dia(ultima.ocorreuEm), dias, urgencia: dias, resultado: 'INVALID_CONTACT' }), c, undefined, undefined, 3, ref, dia(ultima.ocorreuEm));
    }

    // 7) Comunicacoes (revisao humana; aprovada aguardando envio manual). Nada e enviado aqui.
    for (const c of comunicacoes) {
      const ref: ReferenciaCM = { tipo: 'comunicacao', id: c.id };
      if (c.estado === 'DRAFT' || c.estado === 'READY_FOR_REVIEW') { const dias = diasDesde(c.criadoEm); nova('COMUNICACAO_PARA_REVISAO', { referencia: ref, contatoId: c.contatoId, em: dia(c.criadoEm), dias, urgencia: dias }); }
      else if (c.estado === 'APPROVED' && !c.atividadeEnvioId && !c.enviadaEm && !emEspera) {
        const categoria: CategoriaCommercialQueue = reais.length ? 'FOLLOW_UP' : 'PROSPECTAR';
        const alvo = contatoPorId.get(c.contatoId);
        const canalConferido = c.canal === 'EMAIL' || c.canal === 'PHONE' || c.canal === 'WHATSAPP';
        const desde = c.aprovadoEm ?? c.atualizadoEm; const dias = diasDesde(desde);
        if (alvo && elegivel(alvo) && canalConferido && !canais(alvo).includes(c.canal)) nova('SEM_CANAL_VALIDO', { tier: DEGRAU_CATEGORIA[categoria], referencia: { tipo: 'contato', id: alvo.id }, em: dia(desde) });
        else nova('COMUNICACAO_APROVADA_NAO_ENVIADA', { categoria, tier: categoria === 'PROSPECTAR' ? 0 : REGRA_RAZAO.COMUNICACAO_APROVADA_NAO_ENVIADA.tier, referencia: ref, contatoId: c.contatoId, em: dia(desde), dias, urgencia: dias });
      }
    }
    const pendentes = comunicacoes.filter((c) => (c.estado === 'DRAFT' || c.estado === 'READY_FOR_REVIEW' || c.estado === 'APPROVED') && !c.atividadeEnvioId);
    for (const t of abertas) for (const c of pendentes) if (t.contatoId && c.contatoId !== t.contatoId) travas.push({ codigo: 'CONFLITO_TAREFA_COMUNICACAO', bloqueante: false, referencia: { tipo: 'comunicacao', id: c.id }, relacionada: { tipo: 'tarefa', id: t.id }, bloqueia: [] });

    // 8) Prospeccao: conta prioritaria nunca abordada (o caminho de sinal ja cobre o primeiro contato quando existe)
    if ((e.priorityClass === 'A+' || e.priorityClass === 'A') && !reais.length && !ativas.length && !emEspera && !caminhoDeSinal) {
      const ref: ReferenciaCM = { tipo: 'empresa', id: e.id };
      acaoDeContato(() => nova('CONTA_PRIORITARIA_NUNCA_ABORDADA', { referencia: ref, contatoId: recomendado!.contato.id }), recomendado?.contato, fitAdequado, recomendado?.fit.score, 5, ref);
    }

    // 9) Travas
    for (const x of duplicatas) travas.push({ codigo: 'DUPLICATA_PENDENTE', bloqueante: true, referencia: { tipo: 'duplicata', id: x.id }, bloqueia: [] });
    for (const c of cands) {
      if (!c.contatoId) continue;
      const alvo = contatoPorId.get(c.contatoId);
      if (elegivel(alvo)) continue;
      if (!alvo) c.contatoId = undefined; // referencia inexistente nunca sai no item
      travas.push({ codigo: 'CONTATO_INELEGIVEL', bloqueante: true, referencia: c.referencia ?? { tipo: 'empresa', id: e.id }, contatoId: alvo?.id, bloqueia: [] });
      (c.bloqueadaPor ??= []).push('CONTATO_INELEGIVEL');
    }

    // 10) Uma acao ja agendada (hoje ou adiante) segura o trabalho gerado pela maquina: nada concorrente
    const temAgenda = abertas.some((t) => dia(t.venceEm) >= d0) || ativas.some((o) => !!o.proximaAcaoEm && dia(o.proximaAcaoEm) >= d0);
    if (temAgenda) for (const c of cands) if (REGRA_RAZAO[c.codigo].adiavel) c.estado = 'ADIADA';

    for (const c of cands) if (c.estado !== 'ADIADA' && BLOQUEADAS_POR_DUPLICATA.has(c.codigo) && duplicatas.length) (c.bloqueadaPor ??= []).push('DUPLICATA_PENDENTE');
    for (const t of travas) {
      t.bloqueia = t.bloqueante ? [...new Set(cands.filter((c) => c.estado !== 'ADIADA' && c.bloqueadaPor?.includes(t.codigo) && (t.codigo !== 'CONTATO_INELEGIVEL' || (c.referencia?.id === t.referencia.id && c.referencia?.tipo === t.referencia.tipo))).map((c) => c.codigo))].sort(cmp) : [];
    }
    const travasUnicas = dedupTravas(travas);
    // trava que nao segura nenhuma acao efetiva continua visivel como revisao
    for (const t of travasUnicas) if (!t.bloqueia.length) nova('INCONSISTENCIA_PARA_REVISAR', { referencia: t.referencia, trava: t.codigo, contatoId: undefined });

    if (!cands.length) {
      const relevante = e.priorityClass === 'A+' || e.priorityClass === 'A' || e.priorityClass === 'B' || reais.length > 0 || oportunidades.length > 0 || tarefas.length > 0 || comunicacoes.length > 0 || sinaisVerificados.some(dentroJanela);
      if (!relevante) return undefined;
      nova('SEM_TIMING_ATUAL', { referencia: { tipo: 'empresa', id: e.id } });
    }

    // 11) Acao principal: melhor candidata efetiva; bloqueada vira TRAVA_PARA_RESOLVER no mesmo degrau/tier/urgencia
    for (const c of cands) if (c.bloqueadaPor?.length && c.estado !== 'ADIADA') { c.estado = 'BLOQUEADA'; c.bloqueadaPor = [...new Set(c.bloqueadaPor)].sort(cmp) as CodigoTravaCM[]; }
    const efetivas: { razao: RazaoCM }[] = cands.filter((c) => c.estado !== 'ADIADA').map((c) => {
      if (c.estado !== 'BLOQUEADA') return { razao: c };
      const mesmaReferencia = (t: TravaCM) => t.codigo !== 'CONTATO_INELEGIVEL' || (t.referencia.tipo === c.referencia?.tipo && t.referencia.id === c.referencia?.id);
      const trava = travasUnicas.filter((t) => t.bloqueia.includes(c.codigo) && c.bloqueadaPor!.includes(t.codigo) && mesmaReferencia(t)).sort((a, b) => cmp(a.codigo, b.codigo) || cmp(a.referencia.id, b.referencia.id))[0];
      const razao: RazaoCM = { codigo: 'TRAVA_PARA_RESOLVER', categoria: 'REVISAR', estado: 'PENDENTE', degrau: c.degrau, tier: c.tier, urgencia: c.urgencia, tipoTarefa: 'OTHER', referencia: trava?.referencia ?? c.referencia, em: c.em, venceEm: c.venceEm, dias: c.dias, trava: trava?.codigo ?? c.bloqueadaPor![0], acaoBloqueada: c.codigo };
      return { razao };
    });
    efetivas.sort((a, b) => compararRazoes(a.razao, b.razao));
    const principal = { ...efetivas[0].razao, estado: 'PRINCIPAL' as const };
    const secundarias = cands.filter((c) => c !== efetivas[0].razao).map((c) => ({ ...c })).sort(compararRazoes);

    // contato: o da acao (se elegivel) ou o recomendado; nunca inelegivel
    const tipoProjeto = tipoProjetoPrincipal(e.id, r.projetos);
    const contatoDaAcao = principal.contatoId ? contatoPorId.get(principal.contatoId) : principal.referencia?.tipo === 'contato' ? contatoPorId.get(principal.referencia.id) : undefined;
    const alvo = elegivel(contatoDaAcao) ? contatoDaAcao : recomendado?.contato;
    const contato: ContatoCM | undefined = alvo && (() => {
      const fit = recomendado && recomendado.contato.id === alvo.id ? recomendado.fit : calcularDecisionFit(alvo, e, r.pesosDecisionFit, r.regrasPersona, tipoProjeto);
      return { id: alvo.id, fit: fit.score, ideal: fit.score >= fitIdeal, adequado: fit.score >= fitAdequado, canais: canais(alvo), recomendado: recomendado?.contato.id === alvo.id, razoesFit: fit.razoes };
    })();

    const refPrincipal = principal.referencia;
    const tarefaPrincipal = refPrincipal?.tipo === 'tarefa' ? abertas.find((t) => t.id === refPrincipal.id) : undefined;
    const valorPonderadoDe = (o: Oportunidade) => (o.valorEstimado ?? 0) * (o.probabilidade ?? 0);
    const melhorAtiva = [...ativas].sort((a, b) => valorPonderadoDe(b) - valorPonderadoDe(a) || cmp(a.id, b.id))[0];
    const oportunidadeId = refPrincipal?.tipo === 'oportunidade' ? refPrincipal.id : tarefaPrincipal?.oportunidadeId && oportunidadePorId.get(tarefaPrincipal.oportunidadeId)?.empresaId === e.id ? tarefaPrincipal.oportunidadeId : melhorAtiva?.id;
    const sinalId = refPrincipal?.tipo === 'sinal' ? refPrincipal.id : sinaisVerificados.filter((s) => sinalAcionavel(s) && dentroJanela(s)).sort((a, b) => porDeteccao(b, a))[0]?.id;

    let responsavelId: string | undefined; let origemResponsavel: OrigemResponsavelCM = 'NENHUMA';
    const definir = (id: string | undefined, origem: OrigemResponsavelCM) => { if (!responsavelId && id?.trim()) { responsavelId = id; origemResponsavel = origem; } };
    if (tarefaPrincipal) definir(tarefaPrincipal.responsavelId, 'TAREFA');
    if (refPrincipal?.tipo === 'oportunidade') definir(oportunidadePorId.get(refPrincipal.id)?.responsavelId, 'OPORTUNIDADE');
    if (refPrincipal?.tipo === 'atividade') definir(reais.find((a) => a.id === refPrincipal.id)?.usuarioId, 'ATIVIDADE');
    if (refPrincipal?.tipo === 'comunicacao') definir(comunicacoes.find((c) => c.id === refPrincipal.id)?.criadoPor, 'COMUNICACAO');
    definir(melhorAtiva?.responsavelId, 'OPORTUNIDADE');
    definir(ultima?.usuarioId, 'ATIVIDADE');

    return {
      empresaId: e.id, posicao: 0, categoria: principal.categoria, porQueAgora: principal, secundarias, travas: travasUnicas, contato, oportunidadeId, sinalId, responsavelId, origemResponsavel, historico,
      priorityScore: e.priorityScore, priorityClass: e.priorityClass,
      ordem: { degrau: principal.degrau, tier: principal.tier, urgencia: principal.urgencia, classe: RANK_CLASSE[e.priorityClass] ?? 9, priorityScore: e.priorityScore, valorPonderado: melhorAtiva ? valorPonderadoDe(melhorAtiva) : 0, venceEm: principal.venceEm },
    };
  }
}

function dedupTravas(travas: TravaCM[]): TravaCM[] {
  const vistas = new Map<string, TravaCM>();
  for (const t of travas) {
    const k = [t.codigo, t.referencia.tipo, t.referencia.id, t.relacionada?.tipo ?? '', t.relacionada?.id ?? '', t.contatoId ?? ''].join('|');
    const j = vistas.get(k);
    if (j) j.bloqueia = [...new Set([...j.bloqueia, ...t.bloqueia])].sort(cmp) as CodigoRazaoCM[]; else vistas.set(k, { ...t, bloqueia: [...t.bloqueia] });
  }
  return [...vistas.values()].sort((a, b) => cmp(a.codigo, b.codigo) || cmp(a.referencia.tipo, b.referencia.tipo) || cmp(a.referencia.id, b.referencia.id) || cmp(a.relacionada?.id ?? '', b.relacionada?.id ?? ''));
}

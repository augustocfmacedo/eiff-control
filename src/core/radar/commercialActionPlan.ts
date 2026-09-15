// EIFF Commercial Machine — CM1-B: plano de acao por item da fila ("como executar a acao principal").
//
// Projecao puramente derivada: nao altera a fila, nao persiste, nao cria tarefa, nao gera texto, nao chama IA nem
// servidor e nao envia nada. A AUTORIDADE sobre o que fazer agora e o CommercialQueueItem (CM1-A): o plano nunca troca
// a acao principal, a categoria nem a urgencia, e nunca consulta recomendarAcao. Por isso nao usa contextoComunicacaoDe
// em tempo de execucao (ele embute recomendarAcao em `proximaAcaoAtual`): monta localmente as mesmas pecas publicas que
// o contexto de comunicacao compoe — historicoDe, indicacaoDe, estagioEfetivo, selecionarPlaybook, recomendarCanal —
// alimentadas pelo item da fila. Os testes usam contextoComunicacaoDe so como oraculo de paridade.
//
// O modo operacional nasce da ACAO concreta (codigo + tarefa/oportunidade/artefato referenciado), nunca da categoria.
// So o modo CONTATO recebe objetivo, playbook e canal, e so depois de passar pelas sete condicoes de elegibilidade.
import {
  TEXTO_RAZAO_CM, VERSAO_REGRAS_CM, canaisAcionaveisCM, canonicalizarDatasetCM,
  type CategoriaCommercialQueue, type CodigoRazaoCM, type CodigoTravaCM, type CommercialQueue, type CommercialQueueItem, type ReferenciaCM,
} from './commercialMachine';
import {
  OBJETIVOS, OBJETIVOS_COMUNICACAO, PLAYBOOKS_CODIGOS, TRANSICOES_RESULTADO, estagioEfetivo, historicoDe, indicacaoDe, recomendarCanal, selecionarPlaybook,
  type HistoricoComunicacao, type ObjetivoComunicacao, type PlaybookCodigo, type RecomendacaoCanal,
} from './comunicacao';
import { calcularDecisionFit, contatoElegivel, tipoProjetoPrincipal } from './contatos';
import { empresaSuprimida, fitIdealDe } from './pipeline';
import { estagioAtivo, type Atividade, type Canal, type CodigoResposta, type ComunicacaoRadar, type Contato, type Estagio, type Persona, type RadarDataset, type TipoAtividade, type TipoTarefa } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Versao e hipoteses do plano (separadas das hipoteses congeladas do CM1-A)
// ---------------------------------------------------------------------------------------------------------------------
export const VERSAO_REGRAS_PLANO_CM = 'CM1-B.1';

/** HIPOTESES OPERACIONAIS do plano, versionadas por VERSAO_REGRAS_PLANO_CM — a calibrar com dados, nao verdade de negocio. */
export const HIPOTESE_PLANO_CM = {
  /** Estagios em que o proximo movimento depende do cliente: oportunidade vencida/parada vira contato. Nos demais o movimento e da EIFF (pesquisa, engenharia, preco). */
  estagiosMovimentoComCliente: ['DECISION_MAKER_FOUND', 'CONTACT_STARTED', 'ENGAGED', 'NEED_CONFIRMED', 'PROPOSAL_SENT', 'NEGOTIATION'] as readonly Estagio[],
  /** Tipos de tarefa executados falando com o contato. MEETING e VISIT sao compromissos ja marcados (acao interna). */
  tiposTarefaDeContato: ['CALL', 'FOLLOW_UP', 'EMAIL'] as readonly TipoTarefa[],
  tiposTarefaPresencial: ['MEETING', 'VISIT'] as readonly TipoTarefa[],
  /** Canal que o tipo da tarefa pede; entra como a preferencia explicita do contexto de comunicacao (canalPreferido). */
  canalDaTarefa: { CALL: 'PHONE', EMAIL: 'EMAIL' } as Readonly<Partial<Record<TipoTarefa, Canal>>>,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------------------------------------------------
export const MODOS_PLANO_CM = ['CONTATO', 'ACAO_INTERNA', 'REVISAR', 'ENRIQUECER', 'AGUARDAR'] as const;
export type ModoPlanoCM = (typeof MODOS_PLANO_CM)[number];

export const MOTIVOS_MODO_PLANO_CM = [
  'RESPONDER_CLIENTE', 'TAREFA_DE_CONTATO', 'SINAL_COM_DECISOR_PRONTO', 'FOLLOW_UP_DE_TENTATIVA', 'PRIMEIRO_CONTATO', 'EXECUTAR_ABORDAGEM_APROVADA', 'MOVIMENTO_COM_CLIENTE', 'TROCA_DE_CONTATO',
  'TAREFA_INTERNA', 'COMPROMISSO_PRESENCIAL', 'MOVIMENTO_INTERNO', 'DEFINIR_PROXIMA_ACAO',
  'REVISAR_ABORDAGEM', 'RESOLVER_TRAVA', 'RESOLVER_INCONSISTENCIA', 'CONTATO_NAO_PERMITIDO',
  'COMPLETAR_DECISOR', 'COMPLETAR_CANAL', 'VERIFICAR_SINAL', 'VALIDAR_CONTATO',
  'AGUARDAR_PRAZO', 'NUTRIR_SEM_ABORDAGEM', 'RESULTADO_PEDE_ESPERA',
] as const;
export type MotivoModoPlanoCM = (typeof MOTIVOS_MODO_PLANO_CM)[number];

export const CODIGOS_BLOQUEIO_PLANO_CM = [
  'EMPRESA_SUPRIMIDA', 'CONTATO_AUSENTE', 'CONTATO_DE_OUTRA_EMPRESA', 'CONTATO_INELEGIVEL', 'SEM_CANAL_ACIONAVEL',
  'RESULTADO_NAO_PERMITE_COMUNICACAO', 'CONTATO_INVALIDO_NA_ULTIMA_TENTATIVA', 'TRAVA_BLOQUEANTE', 'ABORDAGEM_PENDENTE_MESMO_CONTATO', 'ARTEFATO_FORA_DO_CATALOGO',
] as const;
export type CodigoBloqueioPlanoCM = (typeof CODIGOS_BLOQUEIO_PLANO_CM)[number];

export interface BloqueioPlanoCM { codigo: CodigoBloqueioPlanoCM; referencia?: ReferenciaCM; trava?: CodigoTravaCM; resultado?: CodigoResposta }

export interface CanalDescartadoCM { canal: Canal; motivo: 'NAO_ACIONAVEL' }

export interface ComunicacaoPlanoCM {
  /** SELECAO_ATUAL: objetivo/playbook/canal escolhidos agora pelas regras existentes. ARTEFATO_APROVADO: os da comunicacao ja aprovada. */
  origem: 'SELECAO_ATUAL' | 'ARTEFATO_APROVADO';
  comunicacaoId?: string;
  objetivo: ObjetivoComunicacao;
  playbook: PlaybookCodigo;
  canal: Canal;
  canaisAlternativos: Canal[];
  /** CTA do catalogo OBJETIVOS (texto existente; nenhum texto novo e gerado). */
  cta: string;
  estagio: Estagio;
  motivoSelecao: string;
  motivoCanal: string;
  canaisDescartados: CanalDescartadoCM[];
}

export interface HistoricoPlanoCM {
  /** Ultima interacao real com a conta (NOTE nunca conta). */
  ultimaInteracao?: { atividadeId: string; em: string; tipo: TipoAtividade; canal: Canal; contatoId?: string; resultado?: CodigoResposta };
  ultimoResultado?: { atividadeId: string; em: string; resultado: CodigoResposta };
  ultimoContatoId?: string;
  tentativas: number;
  semRespostaSeguidas: number;
  houveResposta: boolean;
  /** Historico do contato do plano (so em CONTATO). */
  doContato?: Pick<HistoricoComunicacao, 'tentativas' | 'ultimoResultado' | 'ultimoCanal' | 'ultimaEm' | 'semRespostaSeguidas'>;
  comunicacoesEmRevisao: string[];
  comunicacoesAprovadasNaoEnviadas: string[];
}

export interface CommercialActionPlan {
  itemId: string;
  empresaId: string;
  versaoPlano: string;
  versaoRegrasFila: string;
  /** Copiados do item da fila; nunca recalculados. */
  acaoCodigo: CodigoRazaoCM;
  categoria: CategoriaCommercialQueue;
  modo: ModoPlanoCM;
  motivoModo: MotivoModoPlanoCM;
  referencia?: ReferenciaCM;
  tipoTarefa: TipoTarefa;
  aguardarAte?: string;
  /** Somente em CONTATO: contato elegivel da propria empresa, com os canais realmente acionaveis. */
  contato?: { id: string; fit: number; persona: Persona; motivo: string; canaisAcionaveis: Canal[] };
  /** Somente em CONTATO. */
  comunicacao?: ComunicacaoPlanoCM;
  enriquecer?: { alvo: 'DECISOR' | 'CANAL' | 'VERIFICAR_SINAL' | 'CONTATO_VALIDO'; contatoId?: string; sinalId?: string };
  revisar?: { alvo: 'COMUNICACAO' | 'TRAVA' | 'INCONSISTENCIA' | 'COMPROMISSO' | 'CADASTRO'; referencia?: ReferenciaCM; trava?: CodigoTravaCM };
  historico: HistoricoPlanoCM;
  bloqueios: BloqueioPlanoCM[];
  explicacao: { acao: string; modo: string; bloqueios: string[] };
}

export const TEXTO_MOTIVO_MODO_CM: Readonly<Record<MotivoModoPlanoCM, string>> = {
  RESPONDER_CLIENTE: 'Responder ao cliente a partir do que ele pediu',
  TAREFA_DE_CONTATO: 'A tarefa é falar com o contato',
  SINAL_COM_DECISOR_PRONTO: 'Sinal novo com decisor adequado e canal válido',
  FOLLOW_UP_DE_TENTATIVA: 'Retomar a tentativa sem resposta',
  PRIMEIRO_CONTATO: 'Primeiro contato com a conta prioritária',
  EXECUTAR_ABORDAGEM_APROVADA: 'Executar manualmente a abordagem já aprovada e registrar o envio',
  MOVIMENTO_COM_CLIENTE: 'O próximo movimento da oportunidade depende do cliente',
  TROCA_DE_CONTATO: 'A última tentativa deu contato inválido: seguir com outro contato elegível',
  TAREFA_INTERNA: 'Tarefa interna: não é falar com o cliente',
  COMPROMISSO_PRESENCIAL: 'Compromisso já marcado: executar e registrar o resultado',
  MOVIMENTO_INTERNO: 'O próximo movimento da oportunidade é da EIFF (pesquisa, engenharia ou preço)',
  DEFINIR_PROXIMA_ACAO: 'Definir a próxima ação da oportunidade',
  REVISAR_ABORDAGEM: 'Revisar a abordagem existente antes de qualquer nova',
  RESOLVER_TRAVA: 'Resolver a trava que segura a ação',
  RESOLVER_INCONSISTENCIA: 'Resolver a inconsistência de dados',
  CONTATO_NAO_PERMITIDO: 'A ação pede contato, mas uma regra impede abordar agora',
  COMPLETAR_DECISOR: 'Encontrar o decisor adequado',
  COMPLETAR_CANAL: 'Conseguir um canal válido para o contato',
  VERIFICAR_SINAL: 'Verificar o sinal antes de usá-lo',
  VALIDAR_CONTATO: 'Validar ou trocar o contato que se mostrou inválido',
  AGUARDAR_PRAZO: 'Aguardar o prazo já definido; nada concorrente agora',
  NUTRIR_SEM_ABORDAGEM: 'Conta em nutrição: sem abordagem imediata',
  RESULTADO_PEDE_ESPERA: 'O último resultado não permite comunicação agora',
};
export const TEXTO_BLOQUEIO_PLANO_CM: Readonly<Record<CodigoBloqueioPlanoCM, string>> = {
  EMPRESA_SUPRIMIDA: 'Empresa marcada como não contatar',
  CONTATO_AUSENTE: 'Nenhum contato disponível para a ação',
  CONTATO_DE_OUTRA_EMPRESA: 'O contato não pertence a esta empresa',
  CONTATO_INELEGIVEL: 'O contato não pode ser abordado (não contatar, opt-out, inválido ou saiu da empresa)',
  SEM_CANAL_ACIONAVEL: 'Nenhum canal recomendado pela política é realmente acionável',
  RESULTADO_NAO_PERMITE_COMUNICACAO: 'O último resultado não permite nova comunicação',
  CONTATO_INVALIDO_NA_ULTIMA_TENTATIVA: 'A última tentativa com este contato deu contato inválido',
  TRAVA_BLOQUEANTE: 'Uma trava da fila impede o contato',
  ABORDAGEM_PENDENTE_MESMO_CONTATO: 'Já existe abordagem em revisão ou aprovada para este contato',
  ARTEFATO_FORA_DO_CATALOGO: 'A abordagem aprovada usa objetivo ou playbook fora do catálogo atual',
};

// ---------------------------------------------------------------------------------------------------------------------
// Canais: politica existente ∩ canais acionaveis
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Canais que a politica recomendou (primario, secundario) e que tambem sao acionaveis na fila. Nunca promove canal que
 * a politica nao recomendou so porque existe no contato. REFERRAL/LINKEDIN nunca sao acionaveis aqui.
 */
export function canaisDaPoliticaCM(rec: Pick<RecomendacaoCanal, 'primario' | 'secundario'>, acionaveis: readonly Canal[]): Canal[] {
  const out: Canal[] = [];
  for (const c of [rec.primario, rec.secundario]) if (c && acionaveis.includes(c) && !out.includes(c)) out.push(c);
  return out;
}

/** Contato projetado para a politica de canal: sem os dados de canal que a fila ja sabe invalidos (supressao ou status). */
function contatoProjetadoParaPolitica(c: Contato, acionaveis: readonly Canal[]): Contato {
  const telefone = acionaveis.includes('PHONE');
  return { ...c, telefone: telefone ? c.telefone : undefined, celular: telefone ? c.celular : undefined, whatsapp: telefone ? c.whatsapp : undefined, email: acionaveis.includes('EMAIL') ? c.email : undefined };
}

// ---------------------------------------------------------------------------------------------------------------------
// Intencao: modo pretendido pela acao concreta
// ---------------------------------------------------------------------------------------------------------------------
interface Intencao {
  modo: ModoPlanoCM; motivo: MotivoModoPlanoCM; canalPedido?: Canal; artefato?: ComunicacaoRadar;
  enriquecer?: CommercialActionPlan['enriquecer']; revisar?: CommercialActionPlan['revisar']; bloqueio?: BloqueioPlanoCM; aguardarAte?: string;
}

function intencaoDaAcao(item: CommercialQueueItem, r: RadarDataset): Intencao {
  const p = item.porQueAgora;
  const ref = p.referencia;
  const oportunidade = () => (ref?.tipo === 'oportunidade' ? r.oportunidades.find((o) => o.id === ref.id) : undefined);
  const movimentoDaOportunidade = (): Intencao => {
    const o = oportunidade();
    return o && HIPOTESE_PLANO_CM.estagiosMovimentoComCliente.includes(o.estagio) ? { modo: 'CONTATO', motivo: 'MOVIMENTO_COM_CLIENTE' } : { modo: 'ACAO_INTERNA', motivo: 'MOVIMENTO_INTERNO' };
  };
  switch (p.codigo) {
    case 'RESPOSTA_NAO_TRATADA': return { modo: 'CONTATO', motivo: 'RESPONDER_CLIENTE' };
    case 'TAREFA_VENCIDA':
    case 'PROXIMA_ACAO_HOJE': {
      if (ref?.tipo !== 'tarefa') return movimentoDaOportunidade();
      const t = r.tarefas.find((x) => x.id === ref.id);
      if (!t) return { modo: 'REVISAR', motivo: 'RESOLVER_INCONSISTENCIA', revisar: { alvo: 'COMPROMISSO', referencia: ref } };
      if (HIPOTESE_PLANO_CM.tiposTarefaDeContato.includes(t.tipo)) return { modo: 'CONTATO', motivo: 'TAREFA_DE_CONTATO', canalPedido: HIPOTESE_PLANO_CM.canalDaTarefa[t.tipo] };
      return { modo: 'ACAO_INTERNA', motivo: HIPOTESE_PLANO_CM.tiposTarefaPresencial.includes(t.tipo) ? 'COMPROMISSO_PRESENCIAL' : 'TAREFA_INTERNA' };
    }
    case 'OPORTUNIDADE_ACAO_VENCIDA':
    case 'OPORTUNIDADE_PARADA':
    case 'OPORTUNIDADE_PARADA_CRITICA': return movimentoDaOportunidade();
    case 'OPORTUNIDADE_SEM_PROXIMA_ACAO': return { modo: 'ACAO_INTERNA', motivo: 'DEFINIR_PROXIMA_ACAO' };
    case 'SINAL_ACIONAVEL_NOVO': return { modo: 'CONTATO', motivo: 'SINAL_COM_DECISOR_PRONTO' };
    case 'FOLLOW_UP_SEM_RESPOSTA': return { modo: 'CONTATO', motivo: 'FOLLOW_UP_DE_TENTATIVA' };
    case 'TENTATIVA_CONTATO_INVALIDO': {
      const a = ref?.tipo === 'atividade' ? r.atividades.find((x) => x.id === ref.id) : undefined;
      // mesmo contato da tentativa invalida: nunca abordar de novo por ali — validar ou trocar
      if (!a || !p.contatoId || p.contatoId === a.contatoId) return { modo: 'ENRIQUECER', motivo: 'VALIDAR_CONTATO', enriquecer: { alvo: 'CONTATO_VALIDO', contatoId: a?.contatoId }, bloqueio: { codigo: 'CONTATO_INVALIDO_NA_ULTIMA_TENTATIVA', referencia: ref, resultado: 'INVALID_CONTACT' } };
      return { modo: 'CONTATO', motivo: 'TROCA_DE_CONTATO' };
    }
    case 'CONTA_PRIORITARIA_NUNCA_ABORDADA': return { modo: 'CONTATO', motivo: 'PRIMEIRO_CONTATO' };
    case 'COMUNICACAO_APROVADA_NAO_ENVIADA': {
      const artefato = ref?.tipo === 'comunicacao' ? r.comunicacoes.find((c) => c.id === ref.id) : undefined;
      if (!artefato) return { modo: 'REVISAR', motivo: 'RESOLVER_INCONSISTENCIA', revisar: { alvo: 'COMUNICACAO', referencia: ref } };
      return { modo: 'CONTATO', motivo: 'EXECUTAR_ABORDAGEM_APROVADA', artefato };
    }
    case 'COMUNICACAO_PARA_REVISAO': return { modo: 'REVISAR', motivo: 'REVISAR_ABORDAGEM', revisar: { alvo: 'COMUNICACAO', referencia: ref } };
    case 'TRAVA_PARA_RESOLVER': return { modo: 'REVISAR', motivo: 'RESOLVER_TRAVA', revisar: { alvo: 'TRAVA', referencia: ref, trava: p.trava } };
    case 'INCONSISTENCIA_PARA_REVISAR': return { modo: 'REVISAR', motivo: 'RESOLVER_INCONSISTENCIA', revisar: { alvo: 'INCONSISTENCIA', referencia: ref, trava: p.trava } };
    case 'SINAL_NAO_VERIFICADO': return { modo: 'ENRIQUECER', motivo: 'VERIFICAR_SINAL', enriquecer: { alvo: 'VERIFICAR_SINAL', sinalId: ref?.tipo === 'sinal' ? ref.id : undefined } };
    case 'SEM_DECISOR':
    case 'SEM_DECISOR_IDEAL_PARA_SINAL': return { modo: 'ENRIQUECER', motivo: 'COMPLETAR_DECISOR', enriquecer: { alvo: 'DECISOR', sinalId: ref?.tipo === 'sinal' ? ref.id : undefined } };
    case 'SEM_CANAL_VALIDO': return { modo: 'ENRIQUECER', motivo: 'COMPLETAR_CANAL', enriquecer: { alvo: 'CANAL', contatoId: ref?.tipo === 'contato' ? ref.id : item.contato?.id } };
    case 'RESULTADO_NEGATIVO_SEM_FATO_NOVO':
    case 'OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO':
    case 'TENTATIVAS_ESGOTADAS':
    case 'OPORTUNIDADE_EM_NURTURE':
    case 'CLIENTE_GANHO':
    case 'SEM_TIMING_ATUAL': return { modo: 'AGUARDAR', motivo: 'NUTRIR_SEM_ABORDAGEM' };
    case 'PROXIMA_ACAO_AGENDADA':
    case 'FOLLOW_UP_EM_INTERVALO': return { modo: 'AGUARDAR', motivo: 'AGUARDAR_PRAZO', aguardarAte: p.venceEm };
    default: { const nunca: never = p.codigo; throw new Error(`commercial_plan_acao_desconhecida:${String(nunca)}`); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------------------------------------------------
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pendente = (c: ComunicacaoRadar) => (c.estado === 'DRAFT' || c.estado === 'READY_FOR_REVIEW' || c.estado === 'APPROVED') && !c.atividadeEnvioId && !c.enviadaEm;
const respondeu = (x?: CodigoResposta) => !!x && x !== 'NO_RESPONSE' && x !== 'GATEKEEPER' && x !== 'INVALID_CONTACT';

export const itemIdCM = (item: CommercialQueueItem) => [item.empresaId, item.porQueAgora.codigo, item.porQueAgora.referencia?.tipo ?? '-', item.porQueAgora.referencia?.id ?? '-', item.porQueAgora.trava ?? '-'].join(':');

function historicoDaConta(r: RadarDataset, empresaId: string): HistoricoPlanoCM {
  const reais = r.atividades.filter((a) => a.empresaId === empresaId && a.tipo !== 'NOTE').sort((a, b) => cmp(a.ocorreuEm, b.ocorreuEm) || cmp(a.criadoEm, b.criadoEm) || cmp(a.id, b.id));
  const ultima: Atividade | undefined = reais[reais.length - 1];
  const comResultado = reais.filter((a) => a.resultado);
  const ultimoRes = comResultado[comResultado.length - 1];
  const comContato = reais.filter((a) => a.contatoId);
  const h = historicoDe(r.atividades, empresaId);
  const comunicacoes = r.comunicacoes.filter((c) => c.empresaId === empresaId);
  return {
    ultimaInteracao: ultima ? { atividadeId: ultima.id, em: ultima.ocorreuEm, tipo: ultima.tipo, canal: ultima.canal, contatoId: ultima.contatoId, resultado: ultima.resultado } : undefined,
    ultimoResultado: ultimoRes?.resultado ? { atividadeId: ultimoRes.id, em: ultimoRes.ocorreuEm, resultado: ultimoRes.resultado } : undefined,
    ultimoContatoId: comContato[comContato.length - 1]?.contatoId,
    tentativas: h.tentativas, semRespostaSeguidas: h.semRespostaSeguidas,
    houveResposta: reais.some((a) => respondeu(a.resultado)),
    comunicacoesEmRevisao: comunicacoes.filter((c) => c.estado === 'DRAFT' || c.estado === 'READY_FOR_REVIEW').map((c) => c.id),
    comunicacoesAprovadasNaoEnviadas: comunicacoes.filter((c) => c.estado === 'APPROVED' && !c.atividadeEnvioId && !c.enviadaEm).map((c) => c.id),
  };
}

/** Plano de acao para um item da fila. Funcao pura: mesmo dataset + mesmo item = mesmo plano. */
export function planoDeAcaoCM(ds: RadarDataset, item: CommercialQueueItem): CommercialActionPlan {
  const r = canonicalizarDatasetCM(ds);
  const e = r.empresas.find((x) => x.id === item.empresaId);
  if (!e) throw new Error('commercial_plan_empresa_inexistente');
  const p = item.porQueAgora;
  const historico = historicoDaConta(r, e.id);
  const intencao = intencaoDaAcao(item, r);

  const montar = (modo: ModoPlanoCM, motivo: MotivoModoPlanoCM, extra: Partial<CommercialActionPlan> = {}): CommercialActionPlan => {
    const bloqueios = extra.bloqueios ?? [];
    return {
      itemId: itemIdCM(item), empresaId: e.id, versaoPlano: VERSAO_REGRAS_PLANO_CM, versaoRegrasFila: VERSAO_REGRAS_CM,
      acaoCodigo: p.codigo, categoria: item.categoria, modo, motivoModo: motivo, referencia: p.referencia, tipoTarefa: p.tipoTarefa,
      aguardarAte: modo === 'AGUARDAR' ? intencao.aguardarAte : undefined,
      historico, ...extra, bloqueios,
      explicacao: { acao: TEXTO_RAZAO_CM[p.codigo], modo: TEXTO_MOTIVO_MODO_CM[motivo], bloqueios: bloqueios.map((b) => TEXTO_BLOQUEIO_PLANO_CM[b.codigo]) },
    };
  };
  if (intencao.modo !== 'CONTATO') return montar(intencao.modo, intencao.motivo, { enriquecer: intencao.enriquecer, revisar: intencao.revisar, bloqueios: intencao.bloqueio ? [intencao.bloqueio] : [] });

  // --- as sete condicoes do plano CONTATO -----------------------------------------------------------------------------
  const naoPermitido = (modo: ModoPlanoCM, motivo: MotivoModoPlanoCM, bloqueio: BloqueioPlanoCM, extra: Partial<CommercialActionPlan> = {}) => montar(modo, motivo, { ...extra, bloqueios: [bloqueio] });
  // (1) empresa nao suprimida
  if (empresaSuprimida(e.id, r)) return naoPermitido('REVISAR', 'CONTATO_NAO_PERMITIDO', { codigo: 'EMPRESA_SUPRIMIDA', referencia: { tipo: 'empresa', id: e.id } }, { revisar: { alvo: 'CADASTRO', referencia: { tipo: 'empresa', id: e.id } } });
  // (2)(3) contato existente, da empresa e elegivel — o da acao (artefato, tarefa, resposta) ou o indicado pela fila
  const contatoId = intencao.artefato?.contatoId ?? p.contatoId ?? item.contato?.id;
  const contato = contatoId ? r.contatos.find((c) => c.id === contatoId) : undefined;
  if (!contato) return naoPermitido('ENRIQUECER', 'COMPLETAR_DECISOR', { codigo: 'CONTATO_AUSENTE', referencia: p.referencia }, { enriquecer: { alvo: 'DECISOR' } });
  const refContato: ReferenciaCM = { tipo: 'contato', id: contato.id };
  if (contato.empresaId !== e.id) return naoPermitido('REVISAR', 'CONTATO_NAO_PERMITIDO', { codigo: 'CONTATO_DE_OUTRA_EMPRESA', referencia: p.referencia }, { revisar: { alvo: 'CADASTRO', referencia: p.referencia } });
  if (!contatoElegivel(contato, r.supressoes)) return naoPermitido('REVISAR', 'CONTATO_NAO_PERMITIDO', { codigo: 'CONTATO_INELEGIVEL', referencia: refContato }, { revisar: { alvo: 'CADASTRO', referencia: refContato } });
  // (7) nenhuma trava bloqueante da fila sobre esta acao ou este contato
  const trava = item.travas.find((t) => t.bloqueante && (t.bloqueia.includes(p.codigo) || (t.codigo === 'CONTATO_INELEGIVEL' && t.contatoId === contato.id)));
  if (trava) return naoPermitido('REVISAR', 'RESOLVER_TRAVA', { codigo: 'TRAVA_BLOQUEANTE', referencia: trava.referencia, trava: trava.codigo }, { revisar: { alvo: 'TRAVA', referencia: trava.referencia, trava: trava.codigo } });
  // nada concorrente: outra abordagem pendente para o mesmo contato manda revisar a existente
  const concorrente = r.comunicacoes.find((c) => c.empresaId === e.id && c.contatoId === contato.id && pendente(c) && c.id !== intencao.artefato?.id);
  if (concorrente) return naoPermitido('REVISAR', 'REVISAR_ABORDAGEM', { codigo: 'ABORDAGEM_PENDENTE_MESMO_CONTATO', referencia: { tipo: 'comunicacao', id: concorrente.id } }, { revisar: { alvo: 'COMUNICACAO', referencia: { tipo: 'comunicacao', id: concorrente.id } } });

  // (5) historico/resultado permite comunicar — pelas regras existentes (selecionarPlaybook + TRANSICOES_RESULTADO)
  const fitIdeal = fitIdealDe(r);
  const fit = calcularDecisionFit(contato, e, r.pesosDecisionFit, r.regrasPersona, tipoProjetoPrincipal(e.id, r.projetos));
  const historicoContato = historicoDe(r.atividades, e.id, contato.id);
  const atividadeResposta = p.codigo === 'RESPOSTA_NAO_TRATADA' && p.referencia?.tipo === 'atividade' ? r.atividades.find((a) => a.id === p.referencia!.id) : undefined;
  // a resposta sem contato registrado vale para a conta: a selecao parte dela, nao do historico vazio do contato indicado
  const historicoSelecao = atividadeResposta && !atividadeResposta.contatoId ? historicoDe(r.atividades, e.id) : historicoContato;
  const oportunidade = item.oportunidadeId ? r.oportunidades.find((o) => o.id === item.oportunidadeId && o.empresaId === e.id && estagioAtivo(o.estagio)) : undefined;
  const estagio = estagioEfetivo({ estagioOportunidade: oportunidade?.estagio, decisionFit: fit.score, fitIdeal, historico: historicoSelecao, temSinal: !!item.sinalId });
  const indicacao = indicacaoDe(contato, r.atividades, r.contatos);
  const atividadesComEstrategia = r.atividades.filter((a) => a.empresaId === e.id && a.estrategiaId).sort((a, b) => cmp(b.ocorreuEm, a.ocorreuEm) || cmp(a.id, b.id));
  const estrategiaId = oportunidade?.estrategiaId ?? atividadesComEstrategia[0]?.estrategiaId;
  const estrategia = estrategiaId ? r.estrategias.find((s) => s.id === estrategiaId) : undefined;
  const selecao = selecionarPlaybook({ persona: fit.persona, decisionFit: fit.score, fitIdeal, historico: historicoSelecao, indicacao, estrategia: estrategia?.codigo, estagio, temContato: true });
  const transicao = atividadeResposta?.resultado ? TRANSICOES_RESULTADO[atividadeResposta.resultado] : undefined;
  if (!selecao.comunicar || (transicao && !transicao.comunicar)) {
    const resultado = historicoSelecao.ultimoResultado;
    if (resultado === 'INVALID_CONTACT') return naoPermitido('ENRIQUECER', 'VALIDAR_CONTATO', { codigo: 'CONTATO_INVALIDO_NA_ULTIMA_TENTATIVA', referencia: refContato, resultado }, { enriquecer: { alvo: 'CONTATO_VALIDO', contatoId: contato.id } });
    // compromisso humano (tarefa/artefato) que conflita com o resultado vai para revisao; o resto aguarda
    const compromisso = intencao.motivo === 'TAREFA_DE_CONTATO' || intencao.motivo === 'EXECUTAR_ABORDAGEM_APROVADA';
    return naoPermitido(compromisso ? 'REVISAR' : 'AGUARDAR', compromisso ? 'CONTATO_NAO_PERMITIDO' : 'RESULTADO_PEDE_ESPERA', { codigo: 'RESULTADO_NAO_PERMITE_COMUNICACAO', referencia: refContato, resultado }, compromisso ? { revisar: { alvo: 'COMPROMISSO', referencia: p.referencia } } : {});
  }

  // (4) canal: politica existente (sobre o contato projetado sem canais invalidos) ∩ canais acionaveis
  const acionaveis = canaisAcionaveisCM(contato, r.supressoes);
  const politicaBruta = recomendarCanal({ contato, persona: fit.persona, historico: historicoSelecao, indicacao, estagio, playbook: selecao.playbook });
  const canaisDescartados: CanalDescartadoCM[] = politicaBruta.disponiveis.filter((c) => !acionaveis.includes(c)).map((c) => ({ canal: c, motivo: 'NAO_ACIONAVEL' }));

  let objetivo: ObjetivoComunicacao | undefined; let playbook: PlaybookCodigo | undefined; let motivoSelecao = selecao.motivo; let candidatos: Canal[]; let motivoCanal: string;
  if (intencao.artefato) {
    // abordagem ja aprovada: usa o que foi aprovado (sem delivery nesta fase) e confere catalogo e canal
    const a = intencao.artefato;
    if (!(OBJETIVOS_COMUNICACAO as readonly string[]).includes(a.objetivo) || !(PLAYBOOKS_CODIGOS as readonly string[]).includes(a.playbook)) {
      return naoPermitido('REVISAR', 'REVISAR_ABORDAGEM', { codigo: 'ARTEFATO_FORA_DO_CATALOGO', referencia: { tipo: 'comunicacao', id: a.id } }, { revisar: { alvo: 'COMUNICACAO', referencia: { tipo: 'comunicacao', id: a.id } } });
    }
    objetivo = a.objetivo as ObjetivoComunicacao; playbook = a.playbook as PlaybookCodigo; motivoSelecao = 'abordagem aprovada na revisão humana';
    candidatos = acionaveis.includes(a.canal) ? [a.canal] : [];
    motivoCanal = `canal da abordagem aprovada (${a.canal})`;
    if (!candidatos.length) canaisDescartados.push({ canal: a.canal, motivo: 'NAO_ACIONAVEL' });
  } else {
    objetivo = selecao.objetivo; playbook = selecao.playbook;
    const politica = recomendarCanal({ contato: contatoProjetadoParaPolitica(contato, acionaveis), persona: fit.persona, historico: historicoSelecao, indicacao, estagio, playbook });
    // preferencia explicita da tarefa, exatamente como canalPreferido no contexto de comunicacao existente
    let rec: RecomendacaoCanal = politica;
    if (intencao.canalPedido && politica.disponiveis.includes(intencao.canalPedido)) rec = { ...politica, primario: intencao.canalPedido, secundario: politica.primario === intencao.canalPedido ? politica.secundario : politica.primario, motivo: `canal pedido pela tarefa (${intencao.canalPedido})` };
    candidatos = canaisDaPoliticaCM(rec, acionaveis);
    for (const c of [rec.primario, rec.secundario]) if (c && c !== 'REFERRAL' && !acionaveis.includes(c) && !canaisDescartados.some((d) => d.canal === c)) canaisDescartados.push({ canal: c, motivo: 'NAO_ACIONAVEL' });
    motivoCanal = rec.motivo;
  }
  if (!candidatos.length) return naoPermitido('ENRIQUECER', 'COMPLETAR_CANAL', { codigo: 'SEM_CANAL_ACIONAVEL', referencia: refContato }, { enriquecer: { alvo: 'CANAL', contatoId: contato.id } });
  if (!objetivo || !playbook) return naoPermitido('AGUARDAR', 'RESULTADO_PEDE_ESPERA', { codigo: 'RESULTADO_NAO_PERMITE_COMUNICACAO', referencia: refContato });

  canaisDescartados.sort((a, b) => cmp(a.canal, b.canal));
  return montar('CONTATO', intencao.motivo, {
    contato: { id: contato.id, fit: fit.score, persona: fit.persona, motivo: item.contato?.id === contato.id && item.contato.recomendado ? 'contato recomendado da conta' : 'contato da ação', canaisAcionaveis: acionaveis },
    comunicacao: {
      origem: intencao.artefato ? 'ARTEFATO_APROVADO' : 'SELECAO_ATUAL', comunicacaoId: intencao.artefato?.id,
      objetivo, playbook, canal: candidatos[0], canaisAlternativos: candidatos.slice(1), cta: OBJETIVOS[objetivo].cta, estagio,
      motivoSelecao, motivoCanal, canaisDescartados,
    },
    historico: { ...historico, doContato: { tentativas: historicoContato.tentativas, ultimoResultado: historicoContato.ultimoResultado, ultimoCanal: historicoContato.ultimoCanal, ultimaEm: historicoContato.ultimaEm, semRespostaSeguidas: historicoContato.semRespostaSeguidas } },
  });
}

/** Planos de todos os itens da fila, na ordem da fila. */
export function planosDaFilaCM(ds: RadarDataset, fila: CommercialQueue): CommercialActionPlan[] {
  return fila.itens.map((i) => planoDeAcaoCM(ds, i));
}

/** Contagem por modo (apoio a tela; nada recalcula a fila). */
export function resumoPorModoCM(planos: readonly CommercialActionPlan[]): Record<ModoPlanoCM, number> {
  return Object.fromEntries(MODOS_PLANO_CM.map((m) => [m, planos.filter((x) => x.modo === m).length])) as Record<ModoPlanoCM, number>;
}

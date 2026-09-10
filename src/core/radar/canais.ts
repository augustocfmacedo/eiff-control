// Channel Provider: infraestrutura generica de canal de entrega para as comunicacoes aprovadas do Radar.
// Regras puras (sem rede, sem SDK): o core NUNCA importa a API do Octadesk nem de qualquer provider.
// Nesta fase (Channel Provider 01) o envio esta BLOQUEADO: sendApproved existe na interface e recusa.
// A avaliacao de entregabilidade e deterministica e recebe um retrato do provider (EstadoProvider) como dado.
import { hashCanonico, sha256Hex } from './hash';
import type { Canal, Contato } from './types';

// ---------------------------------------------------------------------------
// 1) Abstracao de provider
// ---------------------------------------------------------------------------
export const PROVIDERS = ['MANUAL', 'OCTADESK'] as const;
export type CodigoProvider = (typeof PROVIDERS)[number];
export const NOME_PROVIDER: Record<CodigoProvider, string> = { MANUAL: 'Manual (copiar e enviar)', OCTADESK: 'Octadesk · WhatsApp Oficial' };

/** O que um provider sabe fazer. NEW_CONVERSATION_TEMPLATE: abrir conversa nova exige template aprovado (regra da Meta). */
export const CAPACIDADES = ['NEW_CONVERSATION_TEMPLATE', 'OPEN_CONVERSATION_FREEFORM', 'READ_CONVERSATION', 'READ_TEMPLATES', 'INBOUND_WEBHOOK'] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

export type EstadoConexao = 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';
export interface SaudeProvider { estado: EstadoConexao; detalhe?: string; variaveisFaltando?: string[]; verificadoEm?: string }
/** Numero remetente (WhatsApp Oficial) exposto pelo provider. */
export interface RemetenteCanal { id: string; nome?: string; numero?: string }
/** Template aprovado na Meta, na visao minima do Radar (sem guardar conteudo sensivel). */
export interface TemplateCanal { id: string; nome: string; status: 'approved' | 'pending' | 'rejected' | 'desconhecido'; categoria?: string; idioma?: string; ativo: boolean; variaveis: string[] }
/** Conversa existente no provider, o suficiente para decidir template x mensagem livre. */
export interface ConversaCanal {
  id: string; canal: string; status: string; aberta: boolean; ultimaMensagemEm?: string; naoLidas?: number;
  // prova da janela livre: so o historico de mensagens decide, nunca lastMessageDate sozinho (pode ser mensagem NOSSA)
  ultimaMensagemInboundEm?: string; janelaLivreAte?: string; janelaComprovada?: boolean;
}
export interface MensagemCanal { id: string; conversaId: string; em: string; direcao: 'entrada' | 'saida' | 'desconhecida'; status?: string; interna: boolean }

export interface PedidoEnvio { comunicacaoId: string; contatoId: string; canal: Canal; modo: ModoEntrega; remetenteId?: string; templateId?: string; idempotencyKey: string }
export interface ResultadoEnvio { aceito: boolean; conversaId?: string; mensagemId?: string; statusProvider?: string; erroCodigo?: string; erroMensagem?: string }

/**
 * Contrato que todo canal implementa. `sendApproved` existe para o fluxo futuro, mas nesta fase todos os
 * providers recusam com ENVIO_BLOQUEADO: nenhum caminho do sistema chama POST de mensagem.
 */
export interface CommunicationChannelProvider {
  codigo: CodigoProvider;
  nome: string;
  capabilities(): Capacidade[];
  healthCheck(): Promise<SaudeProvider>;
  listSenders(): Promise<RemetenteCanal[]>;
  listTemplates(): Promise<TemplateCanal[]>;
  findConversation(telefone: string): Promise<ConversaCanal | undefined>;
  getConversation(id: string): Promise<ConversaCanal | undefined>;
  getMessages(id: string): Promise<MensagemCanal[]>;
  sendApproved(pedido: PedidoEnvio): Promise<ResultadoEnvio>;
  /** Descobre se um envio de resultado ambiguo (UNKNOWN) chegou mesmo ao provider. Nunca reenvia. */
  reconcileDelivery(entrega: EntregaParaReconciliar): Promise<Reconciliacao>;
}

export const ENVIO_BLOQUEADO = 'envio_bloqueado_piloto';
export const MENSAGEM_ENVIO_BLOQUEADO = 'Envio desativado nesta fase (Channel Provider 01): a infraestrutura está pronta, mas nenhuma mensagem é enviada até a reconciliação de idempotência ser fechada.';
/** Guarda unica de envio: qualquer provider chama isto no sendApproved enquanto o piloto nao for liberado. */
export function recusarEnvio(): never { throw new ErroCanal(ENVIO_BLOQUEADO, MENSAGEM_ENVIO_BLOQUEADO); }
export class ErroCanal extends Error { constructor(public codigo: string, mensagem: string, public httpStatus?: number) { super(mensagem); this.name = 'ErroCanal'; } }

/** Provider manual: o humano copia o texto e envia por fora. Nao le nem escreve em lugar nenhum. */
export function providerManual(): CommunicationChannelProvider {
  const vazio = async () => [];
  return {
    codigo: 'MANUAL', nome: NOME_PROVIDER.MANUAL,
    capabilities: () => ['OPEN_CONVERSATION_FREEFORM'],
    healthCheck: async () => ({ estado: 'CONNECTED', detalhe: 'Envio manual pelo próprio usuário.' }),
    listSenders: vazio, listTemplates: vazio,
    findConversation: async () => undefined, getConversation: async () => undefined, getMessages: vazio,
    sendApproved: async () => recusarEnvio(),
    reconcileDelivery: async () => ({ resultado: 'NOT_FOUND', motivo: 'Envio manual não tem registro no provider: confirme com quem enviou.', candidatos: 0 }),
  };
}

// ---------------------------------------------------------------------------
// 2) Telefone
// ---------------------------------------------------------------------------
/** Normaliza para E.164 sem "+": so digitos, com DDI 55 quando o numero vem no formato brasileiro. */
export function normalizarTelefone(bruto?: string): string | undefined {
  if (!bruto) return undefined;
  let d = bruto.replace(/\D+/g, '');
  if (!d) return undefined;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`; // DDD + numero, sem DDI
  if (d.length < 12 || d.length > 15) return undefined;
  if (d.startsWith('55') && d.length !== 12 && d.length !== 13) return undefined; // BR: 55 + DDD + 8 ou 9 digitos
  return d;
}
/** Melhor numero do contato para WhatsApp, na ordem whatsapp -> celular -> telefone. */
export function whatsappDoContato(c: Pick<Contato, 'whatsapp' | 'celular' | 'telefone' | 'statusTelefone'>): string | undefined {
  if (c.statusTelefone === 'invalido') return undefined;
  return normalizarTelefone(c.whatsapp) ?? normalizarTelefone(c.celular) ?? normalizarTelefone(c.telefone);
}
/** Nunca logar telefone inteiro: mantem DDI/DDD e os 2 ultimos digitos. */
export const mascararTelefone = (t?: string) => (t ? `${t.slice(0, 4)}${'*'.repeat(Math.max(0, t.length - 6))}${t.slice(-2)}` : '—');

// ---------------------------------------------------------------------------
// 3) Entregabilidade
// ---------------------------------------------------------------------------
export const RESULTADOS_ENTREGABILIDADE = ['SENDABLE_FREEFORM', 'SENDABLE_TEMPLATE', 'MISSING_PHONE', 'NO_APPROVED_TEMPLATE', 'NO_SENDER', 'PROVIDER_NOT_CONFIGURED', 'UNSUPPORTED_CHANNEL', 'NEEDS_REVIEW'] as const;
export type ResultadoEntregabilidade = (typeof RESULTADOS_ENTREGABILIDADE)[number];
export type ModoEntrega = 'TEMPLATE' | 'FREEFORM' | 'MANUAL';

/** Janela livre da Meta: fora dela, conversa nova exige template aprovado, mesmo com chat aberto no provider. */
export const JANELA_LIVRE_HORAS = 24;

/** Retrato do provider no momento da avaliacao: dados lidos por quem chama, nunca buscados aqui. */
export interface EstadoProvider {
  provider: CodigoProvider;
  saude: SaudeProvider;
  remetentes: RemetenteCanal[];
  templates: TemplateCanal[];
  conversa?: ConversaCanal;
  agora?: string; // ISO, para a janela de 24 h
}
export interface Entregabilidade {
  resultado: ResultadoEntregabilidade;
  apto: boolean;
  modo?: ModoEntrega;
  motivo: string;
  telefone?: string; // normalizado, so para uso server-side
  remetenteId?: string;
  templateId?: string;
  janelaLivreAte?: string;
}
const MOTIVOS: Record<ResultadoEntregabilidade, string> = {
  SENDABLE_FREEFORM: 'Conversa aberta — mensagem livre elegível',
  SENDABLE_TEMPLATE: 'Nova conversa exige template aprovado (há um disponível)',
  MISSING_PHONE: 'Contato sem WhatsApp válido',
  NO_APPROVED_TEMPLATE: 'Nova conversa exige template aprovado e não há nenhum aprovado',
  NO_SENDER: 'Número oficial não configurado',
  PROVIDER_NOT_CONFIGURED: 'Provider não configurado',
  UNSUPPORTED_CHANNEL: 'Canal não suportado por este provider',
  NEEDS_REVIEW: 'Comunicação ainda não aprovada por revisão humana',
};
const r = (resultado: ResultadoEntregabilidade, extra: Partial<Entregabilidade> = {}): Entregabilidade =>
  ({ resultado, apto: resultado === 'SENDABLE_FREEFORM' || resultado === 'SENDABLE_TEMPLATE', motivo: MOTIVOS[resultado], ...extra });

/**
 * Decide se uma comunicacao APROVADA poderia ser entregue e como. APPROVED nao significa SENDABLE:
 * revisao humana e uma coisa, canal e telefone sao outra.
 */
export function avaliarEntregabilidade(
  comunicacao: { estado: string; canal: Canal },
  contato: Pick<Contato, 'whatsapp' | 'celular' | 'telefone' | 'statusTelefone' | 'situacao'> & { suprimido?: boolean },
  estado: EstadoProvider,
): Entregabilidade {
  if (comunicacao.estado !== 'APPROVED') return r('NEEDS_REVIEW');
  if (contato.suprimido || contato.situacao === 'INVALIDO' || contato.situacao === 'SAIU_DA_EMPRESA') return r('NEEDS_REVIEW', { motivo: 'Contato suprimido, inválido ou fora da empresa' });
  const telefone = whatsappDoContato(contato);

  if (estado.provider === 'MANUAL') {
    if (comunicacao.canal === 'WHATSAPP' && !telefone) return r('MISSING_PHONE');
    return r('SENDABLE_FREEFORM', { modo: 'MANUAL', telefone, motivo: 'Envio manual: copie o texto aprovado e envie você mesmo' });
  }
  // OCTADESK: WhatsApp Oficial
  if (comunicacao.canal !== 'WHATSAPP') return r('UNSUPPORTED_CHANNEL');
  if (estado.saude.estado !== 'CONNECTED') return r('PROVIDER_NOT_CONFIGURED', { motivo: estado.saude.estado === 'ERROR' ? `Provider com erro: ${estado.saude.detalhe ?? 'sem detalhe'}` : MOTIVOS.PROVIDER_NOT_CONFIGURED });
  if (!telefone) return r('MISSING_PHONE');
  const remetente = estado.remetentes[0];
  if (!remetente) return r('NO_SENDER');

  // janela livre so com PROVA: mensagem do contato dentro da janela (avaliarJanelaLivre). lastMessageDate sozinho
  // nao serve — pode ser mensagem nossa. Sem prova, cai para template.
  const c = estado.conversa;
  const agora = estado.agora ? Date.parse(estado.agora) : Date.now();
  const janelaViva = !!c?.janelaComprovada && !!c.janelaLivreAte && agora < Date.parse(c.janelaLivreAte);
  if (c?.aberta && janelaViva) {
    return r('SENDABLE_FREEFORM', { modo: 'FREEFORM', telefone, remetenteId: remetente.id, janelaLivreAte: c.janelaLivreAte });
  }
  const template = estado.templates.find((t) => t.status === 'approved' && t.ativo);
  if (!template) return r('NO_APPROVED_TEMPLATE', { telefone, remetenteId: remetente.id });
  return r('SENDABLE_TEMPLATE', { modo: 'TEMPLATE', telefone, remetenteId: remetente.id, templateId: template.id });
}

// ---------------------------------------------------------------------------
// 4) Idempotencia da entrega
// ---------------------------------------------------------------------------
export const VERSAO_COMANDO_ENTREGA = 'v1';
/**
 * Chave de idempotencia da ENTREGA (nossa, nao do provider: a API da Octadesk nao documenta idempotencia).
 * Deterministica e auditavel: mesma comunicacao + provider + canal + modo + remetente/template = mesma chave,
 * entao duplo clique nao gera duas entregas (unique parcial no banco).
 */
export function chaveIdempotencia(p: { comunicacaoId: string; provider: CodigoProvider; canal: Canal; modo: ModoEntrega; remetenteId?: string; templateId?: string; versao?: string }): string {
  return ['DLV', p.versao ?? VERSAO_COMANDO_ENTREGA, p.comunicacaoId, p.provider, p.canal, p.modo, p.remetenteId ?? '-', p.templateId ?? '-'].join(':');
}
export const ESTADOS_ENTREGA = ['READY', 'REQUESTED', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN'] as const;
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];
/** Entrega no ledger (radar_communication_delivery), na visao do app. Nunca guarda texto, telefone ou payload bruto. */
export interface EntregaComunicacao {
  id: string; comunicacaoId: string; empresaId: string; contatoId?: string;
  provider: CodigoProvider; canal: Canal; status: EstadoEntrega; modo: ModoEntrega; idempotencyKey: string;
  conversaProviderId?: string; mensagemProviderId?: string; remetenteProviderId?: string; templateProviderId?: string;
  statusProvider?: string; erroCodigo?: string; erroMensagem?: string;
  solicitadoPor?: string; solicitadoEm?: string; aceitoEm?: string; entregueEm?: string; falhouEm?: string;
  criadoEm: string; atualizadoEm: string; versao: number;
}

// ---------------------------------------------------------------------------
// 5) Template mapping (proposta; nada persistido enquanto nao houver template aprovado)
// ---------------------------------------------------------------------------
/** De playbook + objetivo + canal para um template aprovado do provider. Ainda nao persistido: so o contrato. */
export interface CommunicationTemplateMapping {
  playbook: string; objetivo: string; canal: Canal;
  providerTemplateId: string; templateNome: string; idioma: string;
  variaveis: { chave: string; origem: 'contato.nome' | 'contato.email' | 'empresa.nome' | 'remetente.nome' | 'fixo'; valorFixo?: string }[];
  ativo: boolean;
}
/** O texto livre do LLM NAO vira template automaticamente: o template e aprovado na Meta e mapeado a mao. */
export const MAPEAMENTOS_TEMPLATE: CommunicationTemplateMapping[] = [];

// ---------------------------------------------------------------------------
// 6) Inbound (interface apenas; nenhum endpoint publico nesta fase)
// ---------------------------------------------------------------------------
export const EVENTOS_INBOUND = ['MESSAGE_RECEIVED', 'MESSAGE_STATUS', 'CONVERSATION_STATUS'] as const;
export type TipoEventoInbound = (typeof EVENTOS_INBOUND)[number];
/**
 * Evento de entrada de um canal. A Octadesk NAO documenta webhook de saida para o nosso servidor nem assinatura,
 * entao nenhum endpoint publico e criado agora (ver docs/octadesk.md). A estrategia futura e reconciliacao por
 * GET /chat + GET /chat/{id}/messages, disparada por acao humana, sem polling.
 */
export interface ChannelInboundEvent {
  provider: CodigoProvider;
  externalConversationId: string;
  externalMessageId?: string;
  direction: 'inbound' | 'outbound';
  eventType: TipoEventoInbound;
  occurredAt: string;
  externalStatus?: string;
}
export const WEBHOOK_INBOUND_DISPONIVEL = false;
export const ESTRATEGIA_INBOUND = 'reconciliation'; // ver docs/octadesk.md


// ---------------------------------------------------------------------------
// 7) Janela de atendimento (customer service window)
// ---------------------------------------------------------------------------
/**
 * Direcao da mensagem SOMENTE por evidencia positiva: a doc da Octadesk diz que `sentBy.type` informa
 * "if is an agent or a contact". O campo `status` NAO serve para isso: "received" significa
 * "delivered to recipient" (mensagem NOSSA entregue), nao "recebida do contato" (ver docs/octadesk.md).
 * Sem evidencia, "desconhecida" — e desconhecida nunca prova janela.
 */
const TIPO_ENTRADA = ['contact', 'contato', 'customer', 'cliente', 'client', 'lead', 'person'];
const TIPO_SAIDA = ['agent', 'agente', 'user', 'usuario', 'bot', 'system', 'sistema', 'operator'];
export function direcaoMensagem(sentByTipo?: string): MensagemCanal['direcao'] {
  const t = (sentByTipo ?? '').trim().toLowerCase();
  if (!t) return 'desconhecida';
  if (TIPO_ENTRADA.some((x) => t === x || t.includes(x))) return 'entrada';
  if (TIPO_SAIDA.some((x) => t === x || t.includes(x))) return 'saida';
  return 'desconhecida';
}

export interface ProvaJanela { ultimaMensagemInboundEm?: string; janelaLivreAte?: string; janelaComprovada: boolean; motivo: string }
/**
 * A janela livre so abre com prova: uma mensagem PUBLICA de ENTRADA, com data valida, dentro da janela.
 * Historico vazio, so mensagens nossas ou direcao indeterminada = nao comprovada (e, portanto, template).
 */
export function avaliarJanelaLivre(mensagens: MensagemCanal[], agoraIso?: string, janelaHoras = JANELA_LIVRE_HORAS): ProvaJanela {
  const agora = agoraIso ? Date.parse(agoraIso) : Date.now();
  const entradas = mensagens
    .filter((m) => m.direcao === 'entrada' && !m.interna && !!m.em && Number.isFinite(Date.parse(m.em)))
    .sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
  if (!mensagens.length) return { janelaComprovada: false, motivo: 'sem histórico de mensagens para comprovar a janela' };
  if (!entradas.length) return { janelaComprovada: false, motivo: 'nenhuma mensagem do contato identificada no histórico (só mensagens nossas ou direção indeterminada)' };
  const ultima = entradas[0].em;
  const ate = new Date(Date.parse(ultima) + janelaHoras * 3_600_000).toISOString();
  const dentro = agora < Date.parse(ate);
  return { ultimaMensagemInboundEm: ultima, janelaLivreAte: ate, janelaComprovada: dentro, motivo: dentro ? `última mensagem do contato em ${ultima}` : `última mensagem do contato passou de ${janelaHoras} h (${ultima})` };
}
/** Junta a prova na conversa. Sem prova, a conversa nunca carrega janelaComprovada true. */
export const comProvaDeJanela = (c: ConversaCanal, p: ProvaJanela): ConversaCanal => ({ ...c, ultimaMensagemInboundEm: p.ultimaMensagemInboundEm, janelaLivreAte: p.janelaLivreAte, janelaComprovada: p.janelaComprovada });

// ---------------------------------------------------------------------------
// 8) Maquina de estados da entrega
// ---------------------------------------------------------------------------
/** Transicoes permitidas. DELIVERED, FAILED e UNKNOWN sao terminais: nada de regressao arbitraria. */
export const TRANSICOES_ENTREGA: Record<EstadoEntrega, EstadoEntrega[]> = {
  READY: ['REQUESTED'],
  REQUESTED: ['ACCEPTED', 'FAILED', 'UNKNOWN'],
  ACCEPTED: ['DELIVERED', 'FAILED', 'UNKNOWN'],
  DELIVERED: [],
  FAILED: [],
  UNKNOWN: [], // sair de UNKNOWN exige regra aprovada em fase futura (reconciliacao decide, mas nao transiciona sozinha)
};
export const podeTransicionarEntrega = (de: EstadoEntrega, para: EstadoEntrega) => TRANSICOES_ENTREGA[de]?.includes(para) ?? false;
export interface EventoEntrega { deStatus: EstadoEntrega; paraStatus: EstadoEntrega; statusProvider?: string; ocorreuEm: string; atorId?: string; motivoSeguro?: string }
/** Unica porta de mudanca de status: devolve o evento que sera gravado (append-only) ou recusa. */
export function transicionarEntrega(de: EstadoEntrega, para: EstadoEntrega, ctx: { em: string; atorId?: string; statusProvider?: string; motivoSeguro?: string } ): EventoEntrega {
  if (!podeTransicionarEntrega(de, para)) throw new ErroCanal('transicao_invalida', `Transição de entrega ${de} → ${para} não é permitida.`);
  return { deStatus: de, paraStatus: para, statusProvider: ctx.statusProvider, ocorreuEm: ctx.em, atorId: ctx.atorId, motivoSeguro: ctx.motivoSeguro?.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// 9) Impressao do envio (fingerprint) — hash, nunca conteudo em texto claro
// ---------------------------------------------------------------------------
export const VERSAO_IMPRESSAO = 1;
/** Fingerprint do envio para o ledger: so hashes; telefone e texto nunca aparecem em claro. */
export function impressaoEnvio(p: { comunicacaoId: string; provider: CodigoProvider; canal: Canal; modo: ModoEntrega; remetenteId?: string; templateId?: string; telefone?: string; texto?: string }): string {
  return hashCanonico({
    v: VERSAO_IMPRESSAO, comunicacao: p.comunicacaoId, provider: p.provider, canal: p.canal, modo: p.modo,
    remetente: p.remetenteId ?? null, template: p.templateId ?? null,
    telefone: p.telefone ? sha256Hex(p.telefone) : null, texto: p.texto ? sha256Hex(p.texto.trim()) : null,
  });
}
/** Parte comparavel na reconciliacao: existe dos dois lados (o que mandamos x o que aparece no provider). */
export const impressaoComparavel = (p: { conversaId?: string; texto: string }) => hashCanonico({ v: VERSAO_IMPRESSAO, conversa: p.conversaId ?? null, texto: sha256Hex(p.texto.trim()) });

// ---------------------------------------------------------------------------
// 10) Reconciliacao de resultado ambiguo
// ---------------------------------------------------------------------------
export type ResultadoReconciliacao = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
export interface Reconciliacao { resultado: ResultadoReconciliacao; conversaId?: string; mensagemId?: string; candidatos: number; motivo: string; statusProvider?: string }
export interface EntregaParaReconciliar { comunicacaoId: string; telefone?: string; conversaProviderId?: string; solicitadoEm: string; impressaoEsperada?: string }
export const TOLERANCIA_RECONCILIACAO_MS = 15 * 60_000; // janela de busca em torno do pedido

/**
 * Decide FOUND / NOT_FOUND / AMBIGUOUS a partir das mensagens lidas do provider. Sem impressao comparavel,
 * ou com mais de um candidato, o resultado e AMBIGUOUS: nada e dado como enviado sem prova.
 */
export function reconciliarPorMensagens(
  mensagens: (MensagemCanal & { impressao?: string })[],
  p: { solicitadoEm: string; impressaoEsperada?: string; toleranciaMs?: number; conversaId?: string },
): Reconciliacao {
  const inicio = Date.parse(p.solicitadoEm) - 60_000; // um minuto de folga para relogio
  const fim = Date.parse(p.solicitadoEm) + (p.toleranciaMs ?? TOLERANCIA_RECONCILIACAO_MS);
  const candidatos = mensagens.filter((m) => m.direcao !== 'entrada' && !m.interna && Number.isFinite(Date.parse(m.em)) && Date.parse(m.em) >= inicio && Date.parse(m.em) <= fim);
  if (!candidatos.length) return { resultado: 'NOT_FOUND', candidatos: 0, conversaId: p.conversaId, motivo: 'nenhuma mensagem de saída na janela do pedido: o envio não chegou ao provider' };
  if (!p.impressaoEsperada) return { resultado: 'AMBIGUOUS', candidatos: candidatos.length, conversaId: p.conversaId, motivo: 'há mensagem na janela, mas sem impressão para comparar: não dá para provar que é a nossa' };
  const iguais = candidatos.filter((m) => m.impressao && m.impressao === p.impressaoEsperada);
  if (iguais.length === 1) return { resultado: 'FOUND', candidatos: candidatos.length, conversaId: p.conversaId ?? iguais[0].conversaId, mensagemId: iguais[0].id, statusProvider: iguais[0].status, motivo: 'mensagem com a mesma impressão encontrada na janela do pedido' };
  if (iguais.length > 1) return { resultado: 'AMBIGUOUS', candidatos: candidatos.length, conversaId: p.conversaId, motivo: `${iguais.length} mensagens com a mesma impressão: duplicidade possível, decidir a mão` };
  return { resultado: 'AMBIGUOUS', candidatos: candidatos.length, conversaId: p.conversaId, motivo: 'mensagens na janela, nenhuma com a nossa impressão: pode ser outro envio ou texto alterado' };
}

/**
 * Reenvio automatico: NUNCA depois de UNKNOWN nem de reconciliacao AMBIGUOUS; nunca sobre entrega ja aceita.
 * So um humano decide reenviar nesses casos.
 */
export function permiteReenvioAutomatico(status: EstadoEntrega, reconciliacao?: Reconciliacao): { permite: boolean; motivo: string } {
  if (reconciliacao?.resultado === 'AMBIGUOUS') return { permite: false, motivo: 'reconciliação ambígua: só reenviar com decisão humana' };
  if (reconciliacao?.resultado === 'FOUND') return { permite: false, motivo: 'a mensagem já chegou ao provider' };
  if (status === 'UNKNOWN') return { permite: false, motivo: 'resultado desconhecido: reconcilie antes; reenvio automático nunca' };
  if (status === 'ACCEPTED' || status === 'DELIVERED') return { permite: false, motivo: 'entrega já aceita pelo provider' };
  if (status === 'REQUESTED') return { permite: false, motivo: 'entrega em andamento' };
  if (status === 'FAILED' && reconciliacao?.resultado !== 'NOT_FOUND') return { permite: false, motivo: 'falha sem reconciliação: confirme que nada chegou antes de reenviar' };
  return { permite: true, motivo: status === 'FAILED' ? 'falha confirmada sem mensagem no provider' : 'entrega ainda não solicitada' };
}

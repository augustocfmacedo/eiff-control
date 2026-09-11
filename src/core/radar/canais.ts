// Channel Provider: infraestrutura generica de canal de entrega para as comunicacoes aprovadas do Radar.
// Regras puras (sem rede, sem SDK): o core NUNCA importa a API do Octadesk nem de qualquer provider.
// Nesta fase (Channel Provider 01) o envio esta BLOQUEADO: sendApproved existe na interface e recusa.
// A avaliacao de entregabilidade e deterministica e recebe um retrato do provider (EstadoProvider) como dado.
import { hashCanonico, sha256Hex } from './hash';
import type { Canal, Contato } from './types';

// ---------------------------------------------------------------------------
// 1) Abstracao de provider
// ---------------------------------------------------------------------------
export const PROVIDERS = ['MANUAL', 'OCTADESK', 'META_CLOUD'] as const;
export type CodigoProvider = (typeof PROVIDERS)[number];
export const NOME_PROVIDER: Record<CodigoProvider, string> = { MANUAL: 'Manual (copiar e enviar)', OCTADESK: 'Octadesk · WhatsApp Oficial', META_CLOUD: 'Meta WhatsApp Cloud API' };
/** Providers que o painel de entrega da comunicacao oferece hoje. META_CLOUD ainda nao envia (EIFF Central 01). */
export const PROVIDERS_ENTREGA: CodigoProvider[] = ['MANUAL', 'OCTADESK'];
/**
 * Contexto da conversa. NUNCA inferido pelo texto: quem define e o numero/inbox de entrada
 * (EIFF_CENTRAL_PHONE_NUMBER_ID = INTERNAL, EIFF_COMMERCIAL_PHONE_NUMBER_ID = EXTERNAL).
 */
export const CONTEXTOS_COMUNICACAO = ['INTERNAL', 'EXTERNAL'] as const;
export type CommunicationContext = (typeof CONTEXTOS_COMUNICACAO)[number];

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

export interface PedidoEnvio {
  comunicacaoId: string; contatoId: string; canal: Canal; modo: ModoEntrega; idempotencyKey: string;
  telefone: string; nomeContato?: string; emailContato?: string;
  remetenteId?: string; remetenteNumero?: string;
  templateId?: string; templateCodigo?: string; variaveis?: { chave: string; valor: string }[];
  conversaId?: string; texto?: string;
}
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
  reconcileDelivery(cmd: ComandoReconciliacao): Promise<Reconciliacao>;
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
export const EVENTOS_INBOUND = ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELIVERED', 'MESSAGE_READ', 'MESSAGE_FAILED', 'MESSAGE_STATUS', 'CONVERSATION_STATUS'] as const;
export type TipoEventoInbound = (typeof EVENTOS_INBOUND)[number];
/**
 * Evento de entrada de um canal. A Octadesk NAO documenta webhook de saida para o nosso servidor nem assinatura,
 * entao nenhum endpoint publico e criado agora (ver docs/octadesk.md). A estrategia futura e reconciliacao por
 * GET /chat + GET /chat/{id}/messages, disparada por acao humana, sem polling.
 */
export interface ChannelInboundEvent {
  provider: CodigoProvider;
  /** Numero/inbox que recebeu o evento: e ele que define o contexto, nunca o conteudo da mensagem. */
  phoneNumberId?: string;
  contexto?: CommunicationContext;
  externalConversationId: string;
  externalMessageId?: string;
  direction: 'inbound' | 'outbound';
  eventType: TipoEventoInbound;
  occurredAt: string;
  externalStatus?: string;
  /** Telefone do contato, normalizado (E.164 sem "+"). Nunca logar inteiro: use mascararTelefone. */
  contactPhone?: string;
  messageType?: string;
  erroCodigo?: string;
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
// 9) Duas impressoes com papeis DIFERENTES (nunca intercambiaveis)
// ---------------------------------------------------------------------------
export const VERSAO_IMPRESSAO = 1;
/**
 * request_fingerprint: identidade AUDITAVEL do comando de envio, gravada no ledger. Descreve o que foi mandado
 * fazer (comunicacao, provider, canal, modo, remetente, template, destino e texto) — tudo em hash, nunca em claro.
 * NAO serve para casar mensagem no provider: o id da conversa nem existe quando o comando e criado.
 */
export function impressaoComando(p: { comunicacaoId: string; provider: CodigoProvider; canal: Canal; modo: ModoEntrega; remetenteId?: string; templateId?: string; telefone?: string; texto?: string }): string {
  return hashCanonico({
    v: VERSAO_IMPRESSAO, tipo: 'comando', comunicacao: p.comunicacaoId, provider: p.provider, canal: p.canal, modo: p.modo,
    remetente: p.remetenteId ?? null, template: p.templateId ?? null,
    telefone: p.telefone ? sha256Hex(p.telefone) : null, texto: p.texto ? sha256Hex(p.texto.trim()) : null,
  });
}
/**
 * message_match_fingerprint: impressao TRANSITORIA para casar uma mensagem DENTRO de uma conversa candidata.
 * O id da conversa e obrigatorio de proposito: comparar hash(null + texto) com hash(chatA + texto) nunca casa,
 * e era exatamente o furo da reconciliacao de conversa nova. Calculada em memoria, nunca gravada.
 */
export const impressaoMensagem = (p: { conversaId: string; texto: string }) => hashCanonico({ v: VERSAO_IMPRESSAO, tipo: 'mensagem', conversa: p.conversaId, texto: sha256Hex(p.texto.trim()) });

// ---------------------------------------------------------------------------
// 10) Reconciliacao de resultado ambiguo
// ---------------------------------------------------------------------------
export type ResultadoReconciliacao = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
export interface Reconciliacao { resultado: ResultadoReconciliacao; conversaId?: string; mensagemId?: string; candidatos: number; motivo: string; statusProvider?: string }
/** Comando reconstruido pelo servidor (Server Truth). O navegador manda so o deliveryId. */
export interface ComandoReconciliacao {
  deliveryId?: string; comunicacaoId: string; modo: ModoEntrega; solicitadoEm: string;
  telefone?: string; conversaProviderId?: string;
  /** Texto aprovado efetivo. Ausente em modo TEMPLATE: o corpo no provider e o template renderizado, que nao conhecemos. */
  textoAprovado?: string;
}
/** Uma conversa candidata do contato, com as mensagens ja lidas do provider. */
export interface ConversaCandidata { conversaId: string; mensagens: (MensagemCanal & { impressao?: string })[] }
export const TOLERANCIA_RECONCILIACAO_MS = 15 * 60_000; // janela de busca em torno do pedido

/**
 * Reconciliacao por CONVERSA CANDIDATA. Para cada conversa, a impressao esperada e recalculada com o id DAQUELA
 * conversa (impressaoMensagem) e comparada com a impressao das mensagens dela. Resolve o caso critico: send-template
 * aceito, resposta perdida e id de conversa desconhecido — as candidatas vem da busca pelo telefone.
 * So conta como prova a mensagem de SAIDA, com corpo (impressao presente) e impressao igual: direcao desconhecida
 * ou mensagem sem corpo nunca provam FOUND.
 */
export function reconciliarEntrega(candidatas: ConversaCandidata[], cmd: ComandoReconciliacao, opts: { toleranciaMs?: number } = {}): Reconciliacao {
  const inicio = Date.parse(cmd.solicitadoEm) - 60_000; // um minuto de folga para relogio
  const fim = Date.parse(cmd.solicitadoEm) + (opts.toleranciaMs ?? TOLERANCIA_RECONCILIACAO_MS);
  const naJanela = (m: MensagemCanal) => m.direcao !== 'entrada' && !m.interna && Number.isFinite(Date.parse(m.em)) && Date.parse(m.em) >= inicio && Date.parse(m.em) <= fim;
  let candidatos = 0;
  const achados: { conversaId: string; m: MensagemCanal }[] = [];
  for (const c of candidatas) {
    const doPeriodo = c.mensagens.filter(naJanela);
    candidatos += doPeriodo.length;
    if (!cmd.textoAprovado) continue;
    const esperada = impressaoMensagem({ conversaId: c.conversaId, texto: cmd.textoAprovado });
    for (const m of doPeriodo) if (m.direcao === 'saida' && m.impressao && m.impressao === esperada) achados.push({ conversaId: c.conversaId, m });
  }
  if (achados.length === 1) return { resultado: 'FOUND', candidatos, conversaId: achados[0].conversaId, mensagemId: achados[0].m.id, statusProvider: achados[0].m.status, motivo: 'mensagem com a impressão do texto aprovado encontrada na conversa e na janela do pedido' };
  if (achados.length > 1) return { resultado: 'AMBIGUOUS', candidatos, motivo: `${achados.length} mensagens iguais em conversas diferentes: duplicidade possível, decidir a mão` };
  if (!candidatos) return { resultado: 'NOT_FOUND', candidatos: 0, conversaId: cmd.conversaProviderId, motivo: 'nenhuma mensagem de saída na janela do pedido: o envio não chegou ao provider' };
  if (!cmd.textoAprovado) return { resultado: 'AMBIGUOUS', candidatos, motivo: 'modo template: o corpo no provider é o template renderizado, que não conhecemos — há mensagem na janela e não dá para provar que é a nossa' };
  return { resultado: 'AMBIGUOUS', candidatos, motivo: 'mensagens na janela, nenhuma com a impressão do texto aprovado: pode ser outro envio ou texto alterado' };
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


// ---------------------------------------------------------------------------
// 11) Classificacao da falha do provider (regra para o Send Pilot)
// ---------------------------------------------------------------------------
export interface RespostaProvider { httpStatus?: number; timeout?: boolean; rede?: boolean; corpoInterpretavel?: boolean; erroCodigo?: string; erroMensagem?: string }
/**
 * FAILED so com rejeicao EXPLICITA e DEFINITIVA do provider (4xx com codigo de erro identificado).
 * Timeout, erro de rede, 5xx e resposta impossivel de interpretar depois do POST viram UNKNOWN — nunca FAILED,
 * porque a mensagem pode ter sido aceita. UNKNOWN nunca reenvia sozinho (permiteReenvioAutomatico).
 */
export function classificarFalhaEnvio(r: RespostaProvider): { status: Extract<EstadoEntrega, 'FAILED' | 'UNKNOWN'>; motivo: string } {
  if (r.timeout) return { status: 'UNKNOWN', motivo: 'tempo esgotado depois do POST: o provider pode ter aceitado' };
  if (r.rede) return { status: 'UNKNOWN', motivo: 'falha de rede depois do POST: o provider pode ter aceitado' };
  if (r.httpStatus && r.httpStatus >= 500) return { status: 'UNKNOWN', motivo: `provider respondeu ${r.httpStatus}: falha do lado dele, resultado indeterminado` };
  if (r.corpoInterpretavel === false) return { status: 'UNKNOWN', motivo: 'resposta do provider não pôde ser interpretada: resultado indeterminado' };
  if (r.httpStatus && r.httpStatus >= 400 && r.httpStatus < 500 && r.erroCodigo) return { status: 'FAILED', motivo: `rejeição explícita do provider (HTTP ${r.httpStatus}, código ${r.erroCodigo})` };
  if (r.httpStatus && r.httpStatus >= 400 && r.httpStatus < 500) return { status: 'UNKNOWN', motivo: `HTTP ${r.httpStatus} sem código de erro identificado: rejeição não confirmada` };
  return { status: 'UNKNOWN', motivo: 'resultado do provider indeterminado' };
}

// ---------------------------------------------------------------------------
// 12) Ator da transicao: quem pediu x quem/qual processo transicionou
// ---------------------------------------------------------------------------
export const ORIGENS_ATOR = ['USER', 'SERVER', 'PROVIDER', 'SYSTEM'] as const;
export type OrigemAtor = (typeof ORIGENS_ATOR)[number];
/** Comando de transicao entregue a porta server-side. atorId vem SEMPRE do JWT validado no servidor. */
export interface ComandoTransicao { deliveryId: string; para: EstadoEntrega; atorId: string; origemAtor: OrigemAtor; statusProvider?: string; motivoSeguro?: string; provider?: { conversaId?: string; mensagemId?: string } }


// ---------------------------------------------------------------------------
// 13) Modo de envio e allowlist do canario (Send Canary 01)
// ---------------------------------------------------------------------------
export const MODOS_ENVIO = ['disabled', 'canary', 'pilot'] as const;
export type ModoEnvio = (typeof MODOS_ENVIO)[number];
export const MODO_ENVIO_PADRAO: ModoEnvio = 'disabled';
export const lerModoEnvio = (v?: string): ModoEnvio => ((MODOS_ENVIO as readonly string[]).includes((v ?? '').trim()) ? ((v as string).trim() as ModoEnvio) : MODO_ENVIO_PADRAO);
/** Allowlist do canario: numeros normalizados, so no servidor. Nunca vai para o navegador nem para o repositorio. */
export const lerNumerosCanary = (v?: string): string[] => (v ?? '').split(/[,;\r\n]+/).map((x) => normalizarTelefone(x)).filter((x): x is string => !!x);

export interface AutorizacaoDestino { permitido: boolean; codigo?: 'envio_desligado' | 'canary_destination_not_allowed' | 'modo_pilot_nao_liberado' | 'sem_telefone'; motivo: string }
/**
 * Quem pode receber. disabled: ninguem. canary: so numeros da allowlist do servidor. pilot: ainda nao liberado
 * nesta fase (Send Canary 01) — nenhum destino, por decisao explicita.
 */
export function autorizarDestino(telefone: string | undefined, modo: ModoEnvio, allowlist: string[]): AutorizacaoDestino {
  if (!telefone) return { permitido: false, codigo: 'sem_telefone', motivo: 'contato sem WhatsApp válido' };
  // a variavel depende do provider (OCTADESK_SEND_MODE / META_WHATSAPP_SEND_MODE): a mensagem nao cita a errada
  if (modo === 'disabled') return { permitido: false, codigo: 'envio_desligado', motivo: 'envio desligado (modo de envio = disabled)' };
  if (modo === 'pilot') return { permitido: false, codigo: 'modo_pilot_nao_liberado', motivo: 'modo pilot ainda não liberado: só canary nesta fase' };
  if (!allowlist.includes(telefone)) return { permitido: false, codigo: 'canary_destination_not_allowed', motivo: 'destino fora da lista de números autorizados do canário' };
  return { permitido: true, motivo: 'destino autorizado no canário' };
}

/** Canal da comunicacao x canal da entrega x provider: uma comunicacao de e-mail nunca vira envio Octadesk. */
export function validarCoerenciaCanal(p: { canalComunicacao: Canal; canalEntrega: Canal; provider: CodigoProvider }): { ok: boolean; motivo: string } {
  if (p.canalComunicacao !== p.canalEntrega) return { ok: false, motivo: `canal da entrega (${p.canalEntrega}) diferente do canal da comunicação (${p.canalComunicacao})` };
  if (p.provider === 'OCTADESK' && p.canalComunicacao !== 'WHATSAPP') return { ok: false, motivo: `Octadesk só entrega WhatsApp; esta comunicação é ${p.canalComunicacao}` };
  if (p.provider === 'META_CLOUD' && p.canalComunicacao !== 'WHATSAPP') return { ok: false, motivo: `Meta Cloud só entrega WhatsApp; esta comunicação é ${p.canalComunicacao}` };
  return { ok: true, motivo: 'canal coerente' };
}

// ---------------------------------------------------------------------------
// 14) Interpretacao da resposta do POST de envio
// ---------------------------------------------------------------------------
export interface LeituraRespostaEnvio { status: Extract<EstadoEntrega, 'ACCEPTED' | 'FAILED' | 'UNKNOWN'>; conversaId?: string; mensagemId?: string; statusProvider?: string; erroCodigo?: string; motivo: string }
/**
 * Le a resposta do provider SEM guardar payload bruto. Positiva e interpretavel (ids presentes) = ACCEPTED;
 * rejeicao explicita e definitiva = FAILED; qualquer ambiguidade (timeout, rede, 5xx, corpo sem ids) = UNKNOWN.
 */
export function interpretarRespostaEnvio(r: { httpStatus?: number; timeout?: boolean; rede?: boolean; corpo?: unknown }): LeituraRespostaEnvio {
  if (r.timeout || r.rede || !r.httpStatus || r.httpStatus >= 500) {
    const f = classificarFalhaEnvio({ timeout: r.timeout, rede: r.rede, httpStatus: r.httpStatus });
    return { status: 'UNKNOWN', motivo: f.motivo };
  }
  const corpo = (r.corpo ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const erroCodigo = texto(corpo.errorCode) ?? texto((corpo.error as Record<string, unknown> | undefined)?.code);
  if (r.httpStatus >= 400) {
    const f = classificarFalhaEnvio({ httpStatus: r.httpStatus, erroCodigo });
    return { status: f.status, erroCodigo, motivo: f.motivo };
  }
  if (erroCodigo) return { status: 'FAILED', erroCodigo, motivo: `provider respondeu ${r.httpStatus} com código de erro ${erroCodigo}` };
  const resultado = (corpo.result ?? {}) as Record<string, unknown>;
  const mensagemId = texto(resultado.messageKey) ?? texto(corpo.id);
  const conversaId = texto(resultado.roomKey) ?? texto(corpo.chatId);
  if (mensagemId || conversaId) return { status: 'ACCEPTED', conversaId, mensagemId, statusProvider: texto(corpo.status), motivo: 'provider aceitou e devolveu identificadores' };
  return { status: 'UNKNOWN', motivo: `provider respondeu ${r.httpStatus} sem identificadores: resultado indeterminado` };
}

/** Entrega ja em andamento nao pode virar um segundo POST (duplo clique). */
export const permitePostar = (status: EstadoEntrega) => status === 'READY' || status === 'REQUESTED';

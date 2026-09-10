// Channel Provider: infraestrutura generica de canal de entrega para as comunicacoes aprovadas do Radar.
// Regras puras (sem rede, sem SDK): o core NUNCA importa a API do Octadesk nem de qualquer provider.
// Nesta fase (Channel Provider 01) o envio esta BLOQUEADO: sendApproved existe na interface e recusa.
// A avaliacao de entregabilidade e deterministica e recebe um retrato do provider (EstadoProvider) como dado.
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
export interface ConversaCanal { id: string; canal: string; status: string; aberta: boolean; ultimaMensagemEm?: string; naoLidas?: number }
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

  const agora = estado.agora ? Date.parse(estado.agora) : Date.now();
  const ultima = estado.conversa?.ultimaMensagemEm ? Date.parse(estado.conversa.ultimaMensagemEm) : NaN;
  const dentroDaJanela = Number.isFinite(ultima) && agora - ultima < JANELA_LIVRE_HORAS * 3_600_000;
  if (estado.conversa?.aberta && dentroDaJanela) {
    return r('SENDABLE_FREEFORM', { modo: 'FREEFORM', telefone, remetenteId: remetente.id, janelaLivreAte: new Date(ultima + JANELA_LIVRE_HORAS * 3_600_000).toISOString() });
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

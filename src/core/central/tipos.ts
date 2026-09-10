// EIFF Central: contratos da central de WhatsApp da empresa. SO CONTRATO nesta fase — nada aqui executa mutacao.
// Regra fundamental: a IA interpreta linguagem; o Business Engine decide; as permissoes autorizam; o servidor executa;
// a auditoria registra. Nunca LLM escrevendo direto no banco.
// Este arquivo e puro: nao conhece Graph API, nao faz rede e nao importa provider nenhum.
import type { CommunicationContext } from '../radar/canais';

export type { CommunicationContext };

// ---------------------------------------------------------------------------
// 1) Identidade de WhatsApp (quem e a pessoa do outro lado)
// ---------------------------------------------------------------------------
export const SITUACOES_IDENTIDADE = ['PENDING', 'VERIFIED', 'REVOKED'] as const;
export type SituacaoIdentidade = (typeof SITUACOES_IDENTIDADE)[number];
/**
 * Vinculo entre um numero de WhatsApp e uma pessoa do EIFF Control. O nome que o WhatsApp informa NUNCA e
 * identidade: e apelido escolhido pelo dono do aparelho. So `VERIFIED` autoriza qualquer acao sensivel.
 * Modelo conceitual: a persistencia entra na fase em que a Central passar a agir (ver docs/eiff-central.md).
 */
export interface WhatsappIdentity {
  id: string;
  organizationId: string;
  usuarioId?: string; // usuario do EIFF Control
  colaboradorId?: string; // colaborador (equipe), quando aplicavel
  telefoneNormalizado: string; // E.164 sem "+"
  contexto: CommunicationContext;
  situacao: SituacaoIdentidade;
  verificadoEm?: string;
  revogadoEm?: string;
  criadoEm: string;
}
export interface IdentidadeResolvida { identidade?: WhatsappIdentity; conhecida: boolean; verificada: boolean; motivo: string }
/** Resolve o telefone para uma identidade. Desconhecida ou nao verificada = nenhuma acao sensivel, sempre. */
export function resolverIdentidade(telefone: string | undefined, identidades: WhatsappIdentity[], contexto: CommunicationContext): IdentidadeResolvida {
  if (!telefone) return { conhecida: false, verificada: false, motivo: 'evento sem telefone normalizado' };
  const candidatas = identidades.filter((i) => i.telefoneNormalizado === telefone && i.contexto === contexto);
  const viva = candidatas.find((i) => i.situacao === 'VERIFIED');
  if (viva) return { identidade: viva, conhecida: true, verificada: true, motivo: 'identidade verificada' };
  const pendente = candidatas.find((i) => i.situacao === 'PENDING');
  if (pendente) return { identidade: pendente, conhecida: true, verificada: false, motivo: 'identidade cadastrada, ainda não verificada' };
  const revogada = candidatas.find((i) => i.situacao === 'REVOKED');
  if (revogada) return { identidade: revogada, conhecida: true, verificada: false, motivo: 'identidade revogada' };
  return { conhecida: false, verificada: false, motivo: 'número não vinculado a nenhuma pessoa nesta organização' };
}

// ---------------------------------------------------------------------------
// 2) Orquestrador (so contrato: interpreta, nunca executa)
// ---------------------------------------------------------------------------
export const INTENCOES_INTERNAS = ['FINANCE', 'PURCHASE', 'WORKSITE', 'INVENTORY', 'COMMERCIAL', 'HR_ADMIN', 'EXECUTIVE', 'GENERAL'] as const;
export type InternalIntent = (typeof INTENCOES_INTERNAS)[number];
export const AGENTES = ['FINANCE_AGENT', 'PURCHASE_AGENT', 'WORKSITE_AGENT', 'INVENTORY_AGENT', 'COMMERCIAL_AGENT', 'HR_AGENT', 'EXECUTIVE_AGENT', 'GENERAL_AGENT'] as const;
export type CodigoAgente = (typeof AGENTES)[number];

/**
 * Permissao exigida por intencao, reaproveitando a MATRIZ do EIFF Control: o WhatsApp NAO cria uma segunda ACL.
 * Os valores sao acoes de `src/data/store.ts` (type Acao); o teste prende essa correspondencia.
 */
export const PERMISSAO_POR_INTENCAO: Record<InternalIntent, string> = {
  FINANCE: 'editar_lancamento',
  PURCHASE: 'comprar',
  WORKSITE: 'editar_obra',
  INVENTORY: 'editar_etc',
  COMMERCIAL: 'radar',
  HR_ADMIN: 'editar_cadastros',
  EXECUTIVE: 'ver_bancos',
  GENERAL: 'comentar',
};
export const AGENTE_POR_INTENCAO: Record<InternalIntent, CodigoAgente> = {
  FINANCE: 'FINANCE_AGENT', PURCHASE: 'PURCHASE_AGENT', WORKSITE: 'WORKSITE_AGENT', INVENTORY: 'INVENTORY_AGENT',
  COMMERCIAL: 'COMMERCIAL_AGENT', HR_ADMIN: 'HR_AGENT', EXECUTIVE: 'EXECUTIVE_AGENT', GENERAL: 'GENERAL_AGENT',
};

export interface OrchestratorDecision {
  intent: InternalIntent;
  confidence: number; // 0-1
  targetAgent: CodigoAgente;
  requiresHuman: boolean;
  requiresConfirmation: boolean;
  requiredPermission: string;
  motivo: string;
}
/** Contrato do orquestrador: recebe texto e contexto, devolve DECISAO. Nao executa, nao grava, nao envia. */
export interface CommunicationOrchestrator {
  codigo: string;
  decide(entrada: { texto: string; contexto: CommunicationContext; identidade: IdentidadeResolvida }): Promise<OrchestratorDecision>;
}
/** Piso de segurança do contrato: sem identidade verificada, nada avança sem humano. */
export function decisaoSegura(base: Pick<OrchestratorDecision, 'intent' | 'confidence' | 'motivo'>, identidade: IdentidadeResolvida): OrchestratorDecision {
  const exigeHumano = !identidade.verificada || base.confidence < CONFIANCA_MINIMA;
  return {
    intent: base.intent, confidence: base.confidence, targetAgent: AGENTE_POR_INTENCAO[base.intent],
    requiresHuman: exigeHumano, requiresConfirmation: true, requiredPermission: PERMISSAO_POR_INTENCAO[base.intent],
    motivo: exigeHumano ? `${base.motivo}; exige revisão humana (${identidade.verificada ? 'confiança baixa' : identidade.motivo})` : base.motivo,
  };
}
export const CONFIANCA_MINIMA = 0.7;

// ---------------------------------------------------------------------------
// 3) Agente de dominio (so contrato)
// ---------------------------------------------------------------------------
export interface ContextoAgente { contexto: CommunicationContext; identidade: IdentidadeResolvida; texto: string; agoraIso: string }
/** Leitura do pedido pelo agente: o que a pessoa quer, em campos, sem decidir nada. */
export interface LeituraAgente { resumo: string; campos: Record<string, string | number | undefined>; faltando: string[] }
/**
 * Acao PROPOSTA por um agente. Proposta nao e execucao: precisa de permissao, regra de negocio e, quando o
 * dominio exigir, confirmacao humana. `executar` roda SEMPRE no servidor, chamando o motor deterministico
 * existente (nunca escrevendo direto no banco, nunca por LLM).
 */
export interface AcaoProposta {
  codigo: string; titulo: string; descricao: string;
  permissao: string; exigeConfirmacao: boolean; reversivel: boolean;
  parametros: Record<string, unknown>;
}
export interface ResultadoAcao { ok: boolean; mensagem: string; referencia?: string }
export interface EnterpriseAgent {
  code: CodigoAgente;
  canHandle(intent: InternalIntent, ctx: ContextoAgente): boolean;
  interpret(ctx: ContextoAgente): Promise<LeituraAgente>;
  proposeAction(leitura: LeituraAgente, ctx: ContextoAgente): Promise<AcaoProposta | undefined>;
  /** Executa a acao JA autorizada. Quem autoriza e a camada de permissoes + motor, nunca o agente. */
  execute(acao: AcaoProposta, ctx: ContextoAgente): Promise<ResultadoAcao>;
}
/**
 * FINANCE_AGENT sera um ADAPTER sobre o Diretor Financeiro que ja existe (src/core/cfo.ts): a IA so interpreta o
 * texto e o parecer continua vindo do motor deterministico (projecao diaria, reserva, alcadas). Nenhuma regra
 * financeira e reescrita aqui. Ver docs/eiff-central.md.
 */
export const ADAPTERS_PLANEJADOS: Record<CodigoAgente, string> = {
  FINANCE_AGENT: 'adapter sobre src/core/cfo.ts (Diretor Financeiro): interpretarPedido + analisarPagamento + registrarPrevisaoDF',
  PURCHASE_AGENT: 'adapter sobre src/core/compras.ts e as ações de pedido de compra do store',
  WORKSITE_AGENT: 'adapter sobre src/core/obras.ts e o diário de obra (apontamentos)',
  INVENTORY_AGENT: 'adapter sobre src/core/estoque.ts (movimentos imutáveis)',
  COMMERCIAL_AGENT: 'adapter sobre o Radar (src/core/radar): fila de hoje, sinais, abordagem',
  HR_AGENT: 'adapter sobre equipe/alocações (src/core/equipe.ts)',
  EXECUTIVE_AGENT: 'leitura consolidada do motor (src/core/engine.ts): painel, fluxo, obras',
  GENERAL_AGENT: 'assistente do manual (src/core/assistente.ts), sem ação de escrita',
};

// ---------------------------------------------------------------------------
// 4) Conversa e mensagem (modelo interno, independente de provider)
// ---------------------------------------------------------------------------
/**
 * Conversa da Central: um fio por (organizacao, contexto, telefone). NAO e a "conversa" do provider — o id
 * externo e guardado para reconciliar, mas quem manda e o nosso modelo. Contexto vem do numero que recebeu.
 */
export const SITUACOES_CONVERSA = ['ABERTA', 'AGUARDANDO_HUMANO', 'ENCERRADA'] as const;
export type SituacaoConversa = (typeof SITUACOES_CONVERSA)[number];
export interface CentralConversation {
  id: string;
  organizationId: string;
  contexto: CommunicationContext;
  provider: string; // CodigoProvider
  telefoneNormalizado: string; // E.164 sem "+", mascarado em qualquer log
  externalConversationId?: string;
  identidadeId?: string; // WhatsappIdentity, quando conhecida
  situacao: SituacaoConversa;
  /** Quem assumiu o atendimento humano (takeover). Enquanto houver dono humano, nenhum agente responde. */
  humanoResponsavelId?: string;
  ultimaMensagemEm?: string;
  criadaEm: string;
}
/**
 * Mensagem da conversa. `externalMessageId` e a chave de deduplicacao: a Meta reenvia o webhook ate receber 200,
 * entao a MESMA mensagem chega varias vezes e nunca pode virar duas acoes (unique por organizacao + provider + id).
 */
export interface CentralMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  provider: string; // CodigoProvider
  externalMessageId: string;
  direcao: 'inbound' | 'outbound';
  tipo: string; // text, image, audio, ...
  /** Texto da mensagem. E DADO, nunca instrucao: nada aqui altera regra, permissao ou prompt de sistema. */
  texto?: string;
  ocorreuEm: string;
  registradaEm: string;
  statusExterno?: string;
  erroCodigo?: string;
}
/** Evento de ciclo de vida (status de entrega, takeover, decisao do orquestrador). Append-only, como a trilha da entrega. */
export interface CentralEvent {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId?: string;
  tipo: string;
  ocorreuEm: string;
  atorId?: string;
  origemAtor: 'USER' | 'SERVER' | 'PROVIDER' | 'SYSTEM';
  detalheSeguro?: string; // nunca telefone inteiro, token ou payload bruto
}

// ---------------------------------------------------------------------------
// 5) Caixa de entrada humana (adapter: hoje META_DIRECT; Chatwoot, se entrar, e so isto)
// ---------------------------------------------------------------------------
export const INBOX_PROVIDERS = ['META_DIRECT', 'CHATWOOT'] as const;
export type CodigoInbox = (typeof INBOX_PROVIDERS)[number];
/**
 * Caixa de entrada humana. O Chatwoot, SE entrar, entra por aqui: inbox, times, atribuicao, historico e takeover.
 * Nunca CRM, banco mestre, motor financeiro, permissoes ou IA — nada disso sai do EIFF Control (ADR em docs/eiff-central.md).
 */
export interface ConversationInboxProvider {
  codigo: CodigoInbox;
  nome: string;
  /** Espelha a conversa na inbox humana. Idempotente por conversationId. */
  sincronizarConversa(c: CentralConversation): Promise<{ inboxConversationId?: string }>;
  /** Registra a mensagem na inbox (nao envia nada ao contato). */
  registrarMensagem(m: CentralMessage): Promise<void>;
  /** Quem assumiu o atendimento, se alguem assumiu. Com dono humano, nenhum agente responde. */
  responsavelHumano(c: CentralConversation): Promise<{ humanoResponsavelId?: string }>;
}

// ---------------------------------------------------------------------------
// 6) Nomes do contrato publico (docs/eiff-central.md e CENTRAL_PARALLEL_PLAN.md)
// ---------------------------------------------------------------------------
export type CentralIdentity = WhatsappIdentity;
export type AgentActionProposal = AcaoProposta;
export type AgentExecutionResult = ResultadoAcao;

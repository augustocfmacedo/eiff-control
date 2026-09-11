// EIFF Central: contratos da central de WhatsApp da empresa. SO CONTRATO nesta fase — nada aqui executa mutacao.
// Regra fundamental: a IA interpreta linguagem; o Business Engine decide; as permissoes autorizam; o servidor executa;
// a auditoria registra. Nunca LLM escrevendo direto no banco.
// Este arquivo e puro: nao conhece Graph API, nao faz rede e nao importa provider nenhum.
import type { CommunicationContext } from '../radar/canais';
// SO TIPO: a matriz de permissoes do EIFF Control e a unica ACL; o WhatsApp nao cria uma segunda.
// Nenhum acoplamento em tempo de execucao (store.ts nao importa nada de central/).
import type { Acao } from '../../data/store';

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
/**
 * Resolve o telefone para uma identidade. Desconhecida ou nao verificada = nenhuma acao sensivel, sempre.
 * A chave e o TRIO (organizacao, contexto, telefone): `organizationId` e obrigatorio de proposito — sem ele a
 * assinatura convidava a resolver identidade de outra organizacao, que e justamente a ameaca.
 */
export function resolverIdentidade(telefone: string | undefined, identidades: WhatsappIdentity[], contexto: CommunicationContext, organizationId: string): IdentidadeResolvida {
  if (!telefone) return { conhecida: false, verificada: false, motivo: 'evento sem telefone normalizado' };
  if (!organizationId) return { conhecida: false, verificada: false, motivo: 'organização não informada: identidade não resolve' };
  const candidatas = identidades.filter((i) => i.telefoneNormalizado === telefone && i.contexto === contexto && i.organizationId === organizationId);
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
 * REGRA DEFINITIVA: a INTENCAO escolhe o AGENTE; a ACAO PROPOSTA escolhe a PERMISSAO.
 *
 * Nao existe mais mapa de intencao -> permissao. Ele era autoridade errada: "FINANCE" nao diz o que a pessoa
 * quer FAZER, e a mesma intencao cobre desde consultar o caixa (`ver_bancos`) ate liquidar (`liquidar`).
 * Autorizar pela intencao ou daria permissao demais para uma consulta, ou de menos para uma execucao — e nos
 * dois casos a decisao teria saido do roteador, que interpreta linguagem, em vez do catalogo de acoes.
 * A permissao vem de CATALOGO_ACOES (secao 3b), pelo codigo da acao, e e conferida com `pode()` do Control.
 */
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
  /** NUNCA carrega permissao: rotear nao e autorizar. Quem autoriza e a acao proposta, na secao 3b. */
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
    requiresHuman: exigeHumano, requiresConfirmation: true,
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
  /** Codigo do CATALOGO_ACOES. E ele, e nao o campo `permissao` abaixo, que decide o que a acao exige. */
  codigo: string; titulo: string; descricao: string;
  /**
   * Permissao que o agente DECLARA precisar. E declaracao, nao autoridade: `autorizarAcao` confere contra o
   * catalogo e recusa quando divergem. Agente com defeito nao consegue pedir menos permissao do que a acao exige.
   */
  permissao: Acao; exigeConfirmacao: boolean; reversivel: boolean;
  /** Obra sobre a qual a acao age, quando houver: e o escopo passado a `pode(usuario, acao, codigoObra)`. */
  escopoObra?: string;
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
// ---------------------------------------------------------------------------
// 3b) Catalogo de acoes: a ACAO escolhe a PERMISSAO (autoridade unica de autorizacao)
// ---------------------------------------------------------------------------
/**
 * Definicao congelada de uma acao concreta. A permissao mora AQUI, nao na intencao e nao na proposta:
 * a proposta apenas DECLARA o que acha que precisa, e `autorizarAcao` confere contra este catalogo.
 * Assim um agente com defeito (ou adulterado) nao consegue pedir uma permissao mais fraca do que a acao exige.
 */
export interface DefinicaoAcao {
  codigo: string;
  agente: CodigoAgente;
  /** Acao da matriz do EIFF Control. `null` = ajuda/roteiro, sem dado de negocio (ainda exige identidade VERIFIED). */
  permissao: Acao | null;
  /** Acao que muda estado exige confirmacao humana explicita antes de executar. Consulta nao exige. */
  exigeConfirmacao: boolean;
  /** Acao que age sobre uma obra: sem `escopoObra` nao autoriza, porque `pode()` confere a obra do usuario. */
  exigeObra: boolean;
  /** So le. Nunca chama caminho de escrita do motor. */
  leitura: boolean;
  titulo: string;
}

/**
 * Uma intencao cobre acoes de permissoes MUITO diferentes — e por isso que a intencao nao autoriza:
 * FINANCE vai de consultar o caixa (`ver_bancos`) a liquidar (`liquidar`, so Administrador e Financeiro).
 */
export const CATALOGO_ACOES: DefinicaoAcao[] = [
  // FINANCE
  { codigo: 'FINANCE_CONSULTA_CAIXA', agente: 'FINANCE_AGENT', permissao: 'ver_bancos', exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Consultar o caixa projetado' },
  { codigo: 'FINANCE_VENCIMENTOS', agente: 'FINANCE_AGENT', permissao: 'ver_bancos', exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Consultar vencimentos' },
  { codigo: 'FINANCE_MEUS_PEDIDOS', agente: 'FINANCE_AGENT', permissao: null, exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Ver o andamento dos meus pedidos' },
  { codigo: 'FINANCE_REGISTRAR_PREVISAO', agente: 'FINANCE_AGENT', permissao: 'editar_lancamento', exigeConfirmacao: true, exigeObra: false, leitura: false, titulo: 'Registrar previsão de pagamento (rascunho)' },
  { codigo: 'FINANCE_APROVAR', agente: 'FINANCE_AGENT', permissao: 'aprovar', exigeConfirmacao: true, exigeObra: false, leitura: false, titulo: 'Aprovar pedido na alçada' },
  { codigo: 'FINANCE_LIQUIDAR', agente: 'FINANCE_AGENT', permissao: 'liquidar', exigeConfirmacao: true, exigeObra: false, leitura: false, titulo: 'Liquidar título' },
  // demais dominios: contrato declarado agora para que a permissao nunca nasca no agente
  { codigo: 'PURCHASE_REGISTRAR_PEDIDO', agente: 'PURCHASE_AGENT', permissao: 'comprar', exigeConfirmacao: true, exigeObra: false, leitura: false, titulo: 'Registrar pedido de compra' },
  { codigo: 'WORKSITE_APONTAR_DIARIO', agente: 'WORKSITE_AGENT', permissao: 'editar_obra', exigeConfirmacao: true, exigeObra: true, leitura: false, titulo: 'Apontar o diário da obra' },
  { codigo: 'INVENTORY_MOVIMENTO', agente: 'INVENTORY_AGENT', permissao: 'editar_etc', exigeConfirmacao: true, exigeObra: true, leitura: false, titulo: 'Registrar movimento de estoque' },
  { codigo: 'COMMERCIAL_CONSULTAR', agente: 'COMMERCIAL_AGENT', permissao: 'radar', exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Consultar o Radar' },
  { codigo: 'HR_CONSULTAR_EQUIPE', agente: 'HR_AGENT', permissao: 'editar_cadastros', exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Consultar equipe e alocações' },
  { codigo: 'EXECUTIVE_PAINEL', agente: 'EXECUTIVE_AGENT', permissao: 'ver_bancos', exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Leitura consolidada do painel' },
  { codigo: 'GENERAL_AJUDA', agente: 'GENERAL_AGENT', permissao: null, exigeConfirmacao: false, exigeObra: false, leitura: true, titulo: 'Ajuda do manual' },
];
const POR_CODIGO = new Map(CATALOGO_ACOES.map((a) => [a.codigo, a]));
export const definicaoDaAcao = (codigo: string): DefinicaoAcao | undefined => POR_CODIGO.get(codigo);

export interface AutorizacaoAcao { autorizado: boolean; permissao: Acao | null; motivo: string }
/**
 * PONTE DE PERMISSAO. Unico caminho de autorizacao da Central, e ele parte da ACAO PROPOSTA:
 *
 *   mensagem -> identidade -> intencao -> agente -> ACAO PROPOSTA -> permissao DA ACAO
 *            -> pode(usuario, permissao, escopo) -> motor -> confirmacao -> execucao -> auditoria
 *
 * A decisao do orquestrador nao entra nesta conta: rotear nao autoriza. `pode` chega por parametro para que
 * este modulo continue puro — quem liga a matriz real do Control e o servidor.
 */
export function autorizarAcao(
  entrada: { usuario: { ativo: boolean; papel: string }; agente: CodigoAgente; proposta: AcaoProposta; identidade: IdentidadeResolvida },
  pode: (acao: Acao, escopoObra?: string) => boolean,
): AutorizacaoAcao {
  const { proposta, identidade } = entrada;
  const def = definicaoDaAcao(proposta.codigo);
  if (!def) return { autorizado: false, permissao: null, motivo: `ação "${proposta.codigo}" não está no catálogo: nada é executado` };
  // identidade primeiro: numero nao verificado nunca age, mesmo que o papel tivesse a permissao
  if (!identidade.verificada) return { autorizado: false, permissao: def.permissao, motivo: `identidade não verificada (${identidade.motivo})` };
  if (!entrada.usuario.ativo) return { autorizado: false, permissao: def.permissao, motivo: 'usuário inativo' };
  // o agente que propoe tem de ser o dono da acao: GENERAL_AGENT nao proproe FINANCE_LIQUIDAR
  if (def.agente !== entrada.agente) return { autorizado: false, permissao: def.permissao, motivo: `ação ${def.codigo} não pertence ao agente ${entrada.agente}` };
  // a permissao declarada na proposta e conferida contra o catalogo: declarar menos nao vale
  if (proposta.permissao !== def.permissao && def.permissao !== null) {
    return { autorizado: false, permissao: def.permissao, motivo: `a proposta declarou "${proposta.permissao}" mas ${def.codigo} exige "${def.permissao}"` };
  }
  if (def.exigeObra && !proposta.escopoObra) return { autorizado: false, permissao: def.permissao, motivo: `${def.codigo} age sobre uma obra e nenhuma foi informada` };
  if (def.permissao === null) return { autorizado: true, permissao: null, motivo: 'ação de ajuda, sem dado de negócio' };
  if (!pode(def.permissao, proposta.escopoObra)) {
    return { autorizado: false, permissao: def.permissao, motivo: `perfil ${entrada.usuario.papel} não tem "${def.permissao}"${proposta.escopoObra ? ` na obra ${proposta.escopoObra}` : ''}` };
  }
  return { autorizado: true, permissao: def.permissao, motivo: `autorizado por "${def.permissao}"` };
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
// 4) Conversa e mensagem
// ---------------------------------------------------------------------------
/**
 * O modelo vive em `./conversa`, junto da funcao que aplica os eventos — foi la que ele nasceu com a regra de
 * deduplicacao, a ordem de status e a chave de evento, e um contrato sem implementacao ao lado envelhece sozinho.
 * Reexportado aqui para que `tipos.ts` continue sendo a porta unica dos contratos da Central.
 *
 * A regra que estes tipos carregam: `externalMessageId` e a chave de deduplicacao. A Meta reenvia a notificacao
 * ate receber 200, entao a MESMA mensagem chega varias vezes e nunca pode virar duas acoes — a garantia esta no
 * core e tambem no banco (unique (organization_id, provider, external_message_id), migration 0050).
 */
export type { CentralConversation, CentralMessage, CentralEvent, SituacaoConversa, StatusMensagem, TipoEventoCentral } from './conversa';
export { SITUACOES_CONVERSA, STATUS_MENSAGEM, EVENTOS_CENTRAL } from './conversa';

// ---------------------------------------------------------------------------
// 5) Caixa de entrada humana (adapter: hoje META_DIRECT; Chatwoot, se entrar, e so isto)
// ---------------------------------------------------------------------------
import type { CentralConversation as ConversaCentral, CentralMessage as MensagemCentral } from './conversa';

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
  sincronizarConversa(c: ConversaCentral): Promise<{ inboxConversationId?: string }>;
  /** Registra a mensagem na inbox (nao envia nada ao contato). */
  registrarMensagem(m: MensagemCentral): Promise<void>;
  /** Quem assumiu o atendimento, se alguem assumiu. Com dono humano, nenhum agente responde. */
  responsavelHumano(c: ConversaCentral): Promise<{ humanoResponsavelId?: string }>;
}

// ---------------------------------------------------------------------------
// 6) Nomes do contrato publico (docs/eiff-central.md e CENTRAL_PARALLEL_PLAN.md)
// ---------------------------------------------------------------------------
export type CentralIdentity = WhatsappIdentity;
export type AgentActionProposal = AcaoProposta;
export type AgentExecutionResult = ResultadoAcao;

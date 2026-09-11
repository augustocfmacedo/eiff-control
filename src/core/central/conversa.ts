// EIFF Central: modelo de conversa, mensagem e evento. PURO: nenhuma rede, nenhuma IA, nenhuma escrita no banco.
//
// O ponto critico e a IDEMPOTENCIA do webhook: a Meta reenvia a notificacao ate receber 200, entao a MESMA mensagem
// chega varias vezes e nunca pode virar duas acoes. A deduplicacao acontece aqui (por externalMessageId) e tambem no
// banco (unique (organization_id, provider, external_message_id), migration 0050) — cinto e suspensorio.
//
// Outras regras desta camada:
// - conversa e reusada por (organizacao, contexto, telefone); contexto indefinido NAO vira INTERNAL por conveniencia;
// - evento fora de ordem (delivered antes de sent) nunca faz o status andar para tras;
// - conversa com humano responsavel (takeover) e registrada normalmente, mas NENHUM agente responde;
// - o conteudo da mensagem nao trafega nem e guardado aqui: o ChannelInboundEvent so traz metadados;
// - telefone sempre mascarado em qualquer texto de saida.
import { EVENTOS_INBOUND, mascararTelefone, normalizarTelefone, type ChannelInboundEvent, type CodigoProvider, type CommunicationContext, type TipoEventoInbound } from '../radar/canais';

// ---------------------------------------------------------------------------
// 1) Modelo
// ---------------------------------------------------------------------------
export const SITUACOES_CONVERSA = ['ABERTA', 'ATENDIMENTO_HUMANO', 'ENCERRADA'] as const;
export type SituacaoConversa = (typeof SITUACOES_CONVERSA)[number];

export interface CentralConversation {
  id: string;
  organizationId: string;
  contexto: CommunicationContext;
  provider: CodigoProvider;
  telefoneNormalizado: string; // E.164 sem "+"; mascarado em qualquer saida
  externalConversationId?: string;
  identidadeId?: string;
  situacao: SituacaoConversa;
  /** Takeover: enquanto houver humano responsavel, nenhum agente responde. */
  humanoResponsavelId?: string;
  abertaEm: string;
  ultimaMensagemEm?: string;
  ultimaMensagemInboundEm?: string;
  encerradaEm?: string;
}

export const STATUS_MENSAGEM = ['RECEBIDA', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU'] as const;
export type StatusMensagem = (typeof STATUS_MENSAGEM)[number];
/**
 * Ordem de avanco do status. O status so anda para FRENTE: `delivered` que chega antes de `sent` fica em ENTREGUE e o
 * `sent` atrasado nao rebaixa nada. FALHOU vale sobre ENVIADA, mas nao apaga uma entrega ja comprovada.
 */
export const ORDEM_STATUS: Record<StatusMensagem, number> = { RECEBIDA: 0, ENVIADA: 1, FALHOU: 2, ENTREGUE: 3, LIDA: 4 };
const STATUS_POR_EVENTO: Partial<Record<TipoEventoInbound, StatusMensagem>> = {
  MESSAGE_RECEIVED: 'RECEBIDA', MESSAGE_SENT: 'ENVIADA', MESSAGE_DELIVERED: 'ENTREGUE', MESSAGE_READ: 'LIDA', MESSAGE_FAILED: 'FALHOU',
};

export interface CentralMessage {
  id: string;
  organizationId: string;
  conversaId: string;
  provider: CodigoProvider;
  externalMessageId: string;
  direcao: 'inbound' | 'outbound';
  tipo?: string; // text, image, audio... (nunca o conteudo)
  status?: StatusMensagem;
  erroCodigo?: string;
  ocorridaEm: string;
  registradaEm: string;
}

export const EVENTOS_CENTRAL = [...EVENTOS_INBOUND, 'CONVERSA_ABERTA', 'CONVERSA_REABERTA', 'ATENDIMENTO_HUMANO', 'ATENDIMENTO_DEVOLVIDO', 'CONVERSA_ENCERRADA'] as const;
export type TipoEventoCentral = (typeof EVENTOS_CENTRAL)[number];
export interface CentralEvent {
  id: string;
  organizationId: string;
  conversaId: string;
  mensagemId?: string;
  tipo: TipoEventoCentral;
  /** Chave de deduplicacao: mesma chave = mesmo evento reenviado pela Meta. */
  chave: string;
  ocorridaEm: string;
  registradaEm: string;
  detalhe: string; // telefone SEMPRE mascarado
}

export interface EstadoCentral { conversas: CentralConversation[]; mensagens: CentralMessage[]; eventos: CentralEvent[] }
export const estadoVazio = (): EstadoCentral => ({ conversas: [], mensagens: [], eventos: [] });

// ---------------------------------------------------------------------------
// 2) Identificadores estaveis (o telefone nunca entra no id em claro)
// ---------------------------------------------------------------------------
const fnv = (texto: string, semente: number): string => {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};
/** Digest curto e estavel de uma chave: o id local nao e uuid (isso e do banco), mas e deterministico e nao vaza PII. */
export const impressaoChave = (texto: string): string => `${fnv(texto, 0x811c9dc5)}${fnv(texto, 0x01000193)}`;
export const chaveConversa = (organizationId: string, contexto: CommunicationContext, telefone: string): string => `${organizationId}|${contexto}|${telefone}`;
export const chaveMensagem = (organizationId: string, provider: CodigoProvider, externalMessageId: string): string => `${organizationId}|${provider}|${externalMessageId}`;
/** Chave do EVENTO: a mesma mensagem tem varios eventos (sent, delivered, read), mas cada par acontece uma vez so. */
export function chaveEvento(organizationId: string, e: ChannelInboundEvent): string {
  return e.externalMessageId
    ? `${organizationId}|${e.provider}|${e.externalMessageId}|${e.eventType}`
    : `${organizationId}|${e.provider}|conversa:${e.externalConversationId}|${e.eventType}|${e.occurredAt}`;
}

// ---------------------------------------------------------------------------
// 3) Takeover humano e situacao da conversa
// ---------------------------------------------------------------------------
/** Enquanto houver humano responsavel — ou a conversa estiver encerrada — nenhum agente responde. */
export const podeAgenteResponder = (c: CentralConversation): boolean => !c.humanoResponsavelId && c.situacao === 'ABERTA';
export const assumirAtendimento = (c: CentralConversation, humanoResponsavelId: string): CentralConversation =>
  ({ ...c, situacao: 'ATENDIMENTO_HUMANO', humanoResponsavelId, encerradaEm: undefined });
export const devolverAtendimento = (c: CentralConversation): CentralConversation =>
  ({ ...c, situacao: 'ABERTA', humanoResponsavelId: undefined });
export const encerrarConversa = (c: CentralConversation, agoraIso: string): CentralConversation =>
  ({ ...c, situacao: 'ENCERRADA', encerradaEm: agoraIso });
/** Resumo seguro para tela e log. */
export const resumoConversa = (c: CentralConversation): string =>
  `${mascararTelefone(c.telefoneNormalizado)} · ${c.contexto} · ${c.situacao}${c.humanoResponsavelId ? ' (atendimento humano)' : ''}`;

// ---------------------------------------------------------------------------
// 4) Aplicacao idempotente dos eventos do webhook
// ---------------------------------------------------------------------------
export interface OpcoesAplicacao { organizationId: string; agoraIso: string }
export interface EventoIgnorado { evento: ChannelInboundEvent; motivo: string }
export interface ResultadoAplicacao {
  estado: EstadoCentral;
  /** So o que e NOVO nesta rodada: reaplicar o mesmo lote devolve tudo vazio. */
  conversasNovas: CentralConversation[];
  mensagensNovas: CentralMessage[];
  eventosNovos: CentralEvent[];
  conversasAtualizadas: CentralConversation[];
  /** Mensagens recebidas que um agente PODE tratar (conversa aberta, sem humano responsavel). */
  paraAgente: CentralMessage[];
  ignorados: EventoIgnorado[];
  duplicados: EventoIgnorado[];
  foraDeOrdem: EventoIgnorado[];
}

/**
 * Aplica uma lista de `ChannelInboundEvent` sobre o estado e devolve o que e NOVO.
 * Idempotente por construcao: reenvio da Meta (mesmo `externalMessageId` + mesmo tipo de evento) nao cria mensagem,
 * nao cria evento e nao entra em `paraAgente`. Nada e mutado: o estado devolvido e novo.
 */
export function aplicarEventos(estado: EstadoCentral, eventos: ChannelInboundEvent[], opcoes: OpcoesAplicacao): ResultadoAplicacao {
  const { organizationId: org, agoraIso } = opcoes;
  const conversas = new Map(estado.conversas.map((c) => [c.id, c]));
  const porChaveConversa = new Map(estado.conversas.map((c) => [chaveConversa(c.organizationId, c.contexto, c.telefoneNormalizado), c.id]));
  const mensagens = new Map(estado.mensagens.map((m) => [m.id, m]));
  const porChaveMensagem = new Map(estado.mensagens.map((m) => [chaveMensagem(m.organizationId, m.provider, m.externalMessageId), m.id]));
  const chavesVistas = new Set(estado.eventos.map((e) => e.chave));
  const listaEventos = [...estado.eventos];

  const r: ResultadoAplicacao = {
    estado, conversasNovas: [], mensagensNovas: [], eventosNovos: [], conversasAtualizadas: [],
    paraAgente: [], ignorados: [], duplicados: [], foraDeOrdem: [],
  };
  const tocadas = new Set<string>();

  for (const evento of eventos) {
    // 1) contexto: vem do numero que RECEBEU. Indefinido = nao confiavel; nao vira conversa nenhuma.
    if (!evento.contexto) { r.ignorados.push({ evento, motivo: 'contexto indefinido: número de entrada desconhecido, evento não confiável' }); continue; }
    // 2) telefone: sem numero normalizavel nao ha com quem conversar
    const telefone = normalizarTelefone(evento.contactPhone);
    if (!telefone) { r.ignorados.push({ evento, motivo: 'evento sem telefone normalizado' }); continue; }
    // 3) idempotencia: a Meta reenvia ate receber 200
    const chave = chaveEvento(org, evento);
    if (chavesVistas.has(chave)) { r.duplicados.push({ evento, motivo: 'evento repetido (a Meta reenvia a notificação até receber 200)' }); continue; }

    // 4) conversa por (organizacao, contexto, telefone): reusa, reabre ou abre
    const ck = chaveConversa(org, evento.contexto, telefone);
    let conversaId = porChaveConversa.get(ck);
    let conversa = conversaId ? conversas.get(conversaId) : undefined;
    let tipoAbertura: TipoEventoCentral | undefined;
    if (!conversa) {
      conversa = {
        id: `conv-${impressaoChave(ck)}`, organizationId: org, contexto: evento.contexto, provider: evento.provider,
        telefoneNormalizado: telefone, externalConversationId: evento.externalConversationId || undefined,
        situacao: 'ABERTA', abertaEm: evento.occurredAt,
      };
      conversaId = conversa.id;
      porChaveConversa.set(ck, conversaId);
      conversas.set(conversaId, conversa);
      r.conversasNovas.push(conversa);
      tipoAbertura = 'CONVERSA_ABERTA';
    } else if (conversa.situacao === 'ENCERRADA') {
      conversa = { ...conversa, situacao: 'ABERTA', encerradaEm: undefined };
      tipoAbertura = 'CONVERSA_REABERTA';
    }
    conversaId = conversa.id;

    // 5) mensagem: uma linha por externalMessageId; os status seguintes so atualizam a que ja existe
    let mensagem: CentralMessage | undefined;
    const status = STATUS_POR_EVENTO[evento.eventType];
    if (evento.externalMessageId) {
      const mk = chaveMensagem(org, evento.provider, evento.externalMessageId);
      const existenteId = porChaveMensagem.get(mk);
      const existente = existenteId ? mensagens.get(existenteId) : undefined;
      if (!existente) {
        mensagem = {
          id: `msg-${impressaoChave(mk)}`, organizationId: org, conversaId, provider: evento.provider,
          externalMessageId: evento.externalMessageId, direcao: evento.direction, tipo: evento.messageType,
          status, erroCodigo: evento.erroCodigo, ocorridaEm: evento.occurredAt, registradaEm: agoraIso,
        };
        porChaveMensagem.set(mk, mensagem.id);
        mensagens.set(mensagem.id, mensagem);
        r.mensagensNovas.push(mensagem);
      } else {
        const atual = existente.status;
        const avanca = !!status && (!atual || ORDEM_STATUS[status] > ORDEM_STATUS[atual]);
        if (avanca) {
          mensagem = { ...existente, status, erroCodigo: evento.erroCodigo ?? existente.erroCodigo, ocorridaEm: existente.ocorridaEm };
          mensagens.set(mensagem.id, mensagem);
        } else {
          mensagem = existente;
          if (status && atual && ORDEM_STATUS[status] <= ORDEM_STATUS[atual]) {
            r.foraDeOrdem.push({ evento, motivo: `status ${status} chegou depois de ${atual}: o status da mensagem não anda para trás` });
          }
        }
      }
    }

    // 6) evento (append-only) — inclusive o de abertura/reabertura da conversa
    if (tipoAbertura) {
      const chaveA = `${ck}|${tipoAbertura}|${evento.occurredAt}`;
      if (!chavesVistas.has(chaveA)) {
        const abertura: CentralEvent = {
          id: `evt-${impressaoChave(chaveA)}`, organizationId: org, conversaId, tipo: tipoAbertura, chave: chaveA,
          ocorridaEm: evento.occurredAt, registradaEm: agoraIso,
          detalhe: `${tipoAbertura === 'CONVERSA_ABERTA' ? 'conversa aberta' : 'conversa reaberta'} com ${mascararTelefone(telefone)} (${evento.contexto})`,
        };
        chavesVistas.add(chaveA);
        listaEventos.push(abertura);
        r.eventosNovos.push(abertura);
      }
    }
    const registro: CentralEvent = {
      id: `evt-${impressaoChave(chave)}`, organizationId: org, conversaId, mensagemId: mensagem?.id, tipo: evento.eventType,
      chave, ocorridaEm: evento.occurredAt, registradaEm: agoraIso,
      detalhe: `${evento.eventType} · ${evento.direction} · ${mascararTelefone(telefone)}${evento.erroCodigo ? ` · erro ${evento.erroCodigo}` : ''}`,
    };
    chavesVistas.add(chave);
    listaEventos.push(registro);
    r.eventosNovos.push(registro);

    // 7) marcas de tempo da conversa
    const maior = (a: string | undefined, b: string) => (!a || b > a ? b : a);
    conversa = {
      ...conversa,
      externalConversationId: conversa.externalConversationId ?? (evento.externalConversationId || undefined),
      ultimaMensagemEm: maior(conversa.ultimaMensagemEm, evento.occurredAt),
      ultimaMensagemInboundEm: evento.direction === 'inbound' ? maior(conversa.ultimaMensagemInboundEm, evento.occurredAt) : conversa.ultimaMensagemInboundEm,
    };
    conversas.set(conversaId, conversa);
    tocadas.add(conversaId);

    // 8) takeover: com humano responsavel, nada vai para agente nenhum
    if (evento.eventType === 'MESSAGE_RECEIVED' && mensagem && r.mensagensNovas.includes(mensagem)) {
      if (podeAgenteResponder(conversa)) r.paraAgente.push(mensagem);
      else r.ignorados.push({ evento, motivo: conversa.humanoResponsavelId ? 'conversa em atendimento humano: nenhum agente responde' : `conversa ${conversa.situacao.toLowerCase()}: nenhum agente responde` });
    }
  }

  const listaConversas = [...conversas.values()];
  r.estado = { conversas: listaConversas, mensagens: [...mensagens.values()], eventos: listaEventos };
  r.conversasAtualizadas = listaConversas.filter((c) => tocadas.has(c.id) && !r.conversasNovas.some((n) => n.id === c.id));
  // as conversas novas tambem evoluiram no passo 7: devolver a versao final, nunca a do momento da criacao
  r.conversasNovas = r.conversasNovas.map((c) => conversas.get(c.id) ?? c);
  r.mensagensNovas = r.mensagensNovas.map((m) => mensagens.get(m.id) ?? m);
  r.paraAgente = r.paraAgente.map((m) => mensagens.get(m.id) ?? m);
  return r;
}

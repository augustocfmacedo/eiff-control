// EIFF Inbox: as tres fronteiras (canal, inteligencia, execucao) e o gateway de entrada. PURO.
//
// Cada fronteira e uma interface com UMA implementacao real nesta fase, e nenhuma delas produz efeito externo:
// - ChannelProvider MANUAL: registra a mensagem de saida no Inbox e devolve `registrada`. Nada e enviado. O WhatsApp
//   entrara como outro provider (a Meta Cloud ja existe na EIFF Central) SEM mudar a thread;
// - IntelligenceProvider: NAO existe implementacao automatica aqui — nada de IA ficticia. Existe a assinatura, o
//   provedor `SEM_INTELIGENCIA` (devolve indisponivel) e a triagem HUMANA, que produz uma Classificacao com
//   `provedor: 'HUMANO'`. O LLM entrara por funcao Netlify protegida, como o Diretor Financeiro e a comunicacao do Radar;
// - ExecutionProvider MANUAL: o job fica ENVIADO aguardando uma pessoa; o FactoryProvider e codigo reservado que
//   recusa (fail-closed) ate a Factory expor sua API (packages/api, W5 da fabrica).
//
// O gateway (`receberMensagem`) e idempotente por (canal, provider, externalMessageId): reenvio do provider nao cria
// mensagem, nem thread, nem evento. E o mesmo principio de src/core/central/conversa.ts, agora com TEXTO — a
// retencao do conteudo e decisao do Inbox (docs/eiff-inbox.md), nao da Central.
import type { ChannelInboundEvent, CodigoProvider, CommunicationContext } from '../radar/canais';
import { aoReceberMensagem } from './estados';
import type { CanalInbox, Classificacao, ContatoInbox, IdentidadeCanal, InboxDataset, InboxJob, InboxMessage, InboxThread, JobResult, NivelAtendimento, Prioridade, ThreadEvent, TipoRelacao } from './tipos';

// ---------------------------------------------------------------------------
// 1) Canal
// ---------------------------------------------------------------------------
/** Mensagem de entrada ja normalizada pelo provider do canal: e o UNICO formato que o Inbox conhece. */
export interface MensagemRecebida {
  canal: CanalInbox;
  provider: CodigoProvider;
  contexto: CommunicationContext;
  identidade: IdentidadeCanal;
  externalMessageId: string;
  externalConversationId?: string;
  texto: string;
  tipo: InboxMessage['tipo'];
  em: string;
}

export interface PedidoEnvio { thread: InboxThread; contato: ContatoInbox; texto: string }
export interface ResultadoEnvio { entrega: InboxMessage['entrega']; externalMessageId?: string; motivo: string }

/** Fronteira de canal. `enviar` e a fronteira do efeito externo: so um provider real conectado a produz. */
export interface ChannelProvider {
  canal: CanalInbox;
  provider: CodigoProvider;
  enviar(pedido: PedidoEnvio): Promise<ResultadoEnvio>;
}

export const PROVEDOR_MANUAL: ChannelProvider = {
  canal: 'SISTEMA', provider: 'MANUAL',
  async enviar() { return { entrega: 'registrada', motivo: 'canal não conectado: a resposta ficou registrada no Inbox e nada foi enviado' }; },
};

/**
 * Escolha do provider de canal para uma thread. Nesta fase existe SO o MANUAL, para qualquer canal: e o unico ponto
 * que mudara quando o WhatsApp (Meta Cloud, EIFF Central) ou o e-mail entrarem — a thread e as acoes nao mudam.
 */
export const provedorCanal = (_t: Pick<InboxThread, 'canal' | 'provider'>): ChannelProvider => PROVEDOR_MANUAL;

/**
 * Traduz um evento da EIFF Central para a entrada do Inbox. A Central nao carrega texto (decisao dela); quem tem o
 * corpo e o adapter do provider, que o passa aqui. Evento sem contexto ou sem telefone e recusado — nunca vira INTERNAL
 * por conveniencia (mesma regra de conversa.ts).
 */
export function deEventoCentral(e: ChannelInboundEvent, texto: string): MensagemRecebida | { erro: string } {
  if (e.eventType !== 'MESSAGE_RECEIVED' || e.direction !== 'inbound') return { erro: 'só MESSAGE_RECEIVED inbound vira mensagem do Inbox' };
  if (!e.contexto) return { erro: 'contexto indefinido: número de entrada desconhecido' };
  if (!e.contactPhone) return { erro: 'evento sem telefone normalizado' };
  if (!e.externalMessageId) return { erro: 'evento sem externalMessageId: sem chave de deduplicação' };
  return {
    canal: 'WHATSAPP', provider: e.provider, contexto: e.contexto, externalMessageId: e.externalMessageId, externalConversationId: e.externalConversationId,
    identidade: { canal: 'WHATSAPP', identificador: e.contactPhone, verificada: false }, texto, tipo: e.messageType === 'image' ? 'imagem' : e.messageType === 'audio' ? 'audio' : e.messageType === 'document' ? 'documento' : 'texto', em: e.occurredAt,
  };
}

// ---------------------------------------------------------------------------
// 2) Inteligencia
// ---------------------------------------------------------------------------
export interface EntradaInteligencia { thread: InboxThread; mensagens: InboxMessage[]; contato?: ContatoInbox; setoresAtivos: string[] }
export type SaidaInteligencia = { ok: true; classificacao: Classificacao; resumo?: string } | { ok: false; motivo: string };
export interface IntelligenceProvider {
  codigo: Classificacao['provedor'];
  analisar(entrada: EntradaInteligencia): Promise<SaidaInteligencia>;
}
/** Sem LLM configurado nada e inventado: a thread fica sem classificacao e a triagem e humana. */
export const SEM_INTELIGENCIA: IntelligenceProvider = {
  codigo: 'LLM',
  async analisar() { return { ok: false, motivo: 'inteligência não configurada: triagem humana' }; },
};

export const VERSAO_TRIAGEM_HUMANA = 'triagem-humana-1';
/** Triagem feita por uma pessoa vira Classificacao com provedor HUMANO e confianca 1: e uma decisao, nao uma estimativa. */
export function triagemHumana(dados: { intencao: string; assunto: string; setorRecomendado?: string; prioridade: Prioridade; nivel: NivelAtendimento; sinais?: string[]; acaoSugerida?: string }, agoraIso: string): Classificacao {
  return {
    intencao: dados.intencao.trim(), assunto: dados.assunto.trim(), entidades: [], setorRecomendado: dados.setorRecomendado, prioridadeRecomendada: dados.prioridade,
    nivelRecomendado: dados.nivel, acaoSugerida: dados.acaoSugerida, confianca: 1, sinais: dados.sinais ?? ['triagem humana'], evidencias: [], provedor: 'HUMANO', versao: VERSAO_TRIAGEM_HUMANA, em: agoraIso,
  };
}

/** Uma classificacao so e aceita se guardar apenas sinais e evidencias curtas — nada que pareca raciocinio encadeado. */
export function classificacaoAuditavel(c: Classificacao): { ok: boolean; motivo: string } {
  if (c.confianca < 0 || c.confianca > 1) return { ok: false, motivo: 'confiança fora de 0-1' };
  if (c.sinais.some((s) => s.length > 200)) return { ok: false, motivo: 'sinal longo demais: guarde sinais, não raciocínio' };
  if (c.evidencias.some((e) => e.trecho.length > 300)) return { ok: false, motivo: 'evidência longa demais: guarde o trecho, não a mensagem inteira' };
  if (!c.intencao || !c.assunto) return { ok: false, motivo: 'classificação sem intenção ou assunto' };
  return { ok: true, motivo: 'auditável' };
}

// ---------------------------------------------------------------------------
// 3) Execucao
// ---------------------------------------------------------------------------
export interface ExecutionProvider {
  codigo: InboxJob['provider'];
  /** Aceita o job. So um provider real devolve `referenciaExterna`; MANUAL devolve ENVIADO e espera uma pessoa. */
  execute(job: InboxJob): Promise<{ estado: InboxJob['estado']; referenciaExterna?: string; resultado?: JobResult; motivo: string }>;
}

export const EXECUCAO_MANUAL: ExecutionProvider = {
  codigo: 'MANUAL',
  async execute() { return { estado: 'ENVIADO', motivo: 'execução manual: o job aguarda uma pessoa registrar o resultado' }; },
};

export const FACTORY_INDISPONIVEL = 'FactoryProvider reservado: a EIFF Dev Factory ainda não expõe API para o Inbox (packages/api, W5). Nenhum job foi enviado.';
/** Reservado e fail-closed: nada sai daqui ate a fabrica publicar o contrato de entrada. */
export const EXECUCAO_FACTORY_RESERVADA: ExecutionProvider = {
  codigo: 'FACTORY',
  async execute() { return { estado: 'RASCUNHO', motivo: FACTORY_INDISPONIVEL }; },
};

export const provedorExecucao = (codigo: InboxJob['provider']): ExecutionProvider => (codigo === 'FACTORY' ? EXECUCAO_FACTORY_RESERVADA : EXECUCAO_MANUAL);

// ---------------------------------------------------------------------------
// 4) Gateway de entrada (idempotente)
// ---------------------------------------------------------------------------
export interface Relogio { agora: string; novoId: (prefixo: string) => string }
export interface ResultadoRecebimento {
  ds: InboxDataset;
  thread?: InboxThread;
  mensagem?: InboxMessage;
  contato?: ContatoInbox;
  novaThread: boolean;
  novoContato: boolean;
  duplicada: boolean;
  motivo: string;
}

const chaveMensagem = (m: { provider: CodigoProvider; externalMessageId?: string }) => (m.externalMessageId ? `${m.provider}|${m.externalMessageId}` : undefined);
export const mesmaIdentidade = (a: IdentidadeCanal, b: IdentidadeCanal): boolean => a.canal === b.canal && a.identificador === b.identificador;

export function contatoPorIdentidade(contatos: ContatoInbox[], i: IdentidadeCanal): ContatoInbox | undefined {
  return contatos.find((c) => c.identidades.some((x) => mesmaIdentidade(x, i)));
}

/** Thread aberta do contato no mesmo canal e contexto; se so houver fechadas, a mais recente (que sera reaberta). */
export function threadDoContato(threads: InboxThread[], contatoId: string, canal: CanalInbox, contexto: CommunicationContext): InboxThread | undefined {
  const dele = threads.filter((t) => t.contatoId === contatoId && t.canal === canal && t.contexto === contexto);
  const aberta = dele.filter((t) => t.status !== 'FECHADA').sort((a, b) => (a.ultimaMensagemEm < b.ultimaMensagemEm ? 1 : -1))[0];
  return aberta ?? dele.sort((a, b) => (a.ultimaMensagemEm < b.ultimaMensagemEm ? 1 : -1))[0];
}

/**
 * Recebe uma mensagem normalizada: deduplica, resolve o contato (cria um `desconhecido` se nao existir), reusa ou abre
 * a thread e registra mensagem + evento. Nao classifica, nao roteia: isso e um passo seguinte, com sua propria
 * fronteira. Uma mensagem em thread FECHADA reabre a thread (regra de `aoReceberMensagem`).
 */
export function receberMensagem(ds: InboxDataset, m: MensagemRecebida, relogio: Relogio): ResultadoRecebimento {
  const chave = chaveMensagem(m);
  if (chave && ds.mensagens.some((x) => chaveMensagem({ provider: m.provider, externalMessageId: x.externalMessageId }) === chave)) {
    return { ds, novaThread: false, novoContato: false, duplicada: true, motivo: 'mensagem repetida: o provider reenvia até receber confirmação' };
  }
  let contato = contatoPorIdentidade(ds.contatos, m.identidade);
  const novoContato = !contato;
  if (!contato) {
    const tipo: TipoRelacao = m.contexto === 'INTERNAL' ? 'colaborador' : 'desconhecido';
    contato = { id: relogio.novoId('CTI'), nome: m.identidade.nomeInformado?.trim() || 'Contato não identificado', tipoRelacao: tipo, identidades: [{ ...m.identidade, verificada: false }], obras: [], criadoEm: relogio.agora };
  }
  let thread = threadDoContato(ds.threads, contato.id, m.canal, m.contexto);
  const novaThread = !thread;
  const eventos: ThreadEvent[] = [];
  if (!thread) {
    thread = {
      id: relogio.novoId('THR'), canal: m.canal, provider: m.provider, contexto: m.contexto, contatoId: contato.id, externalConversationId: m.externalConversationId,
      assunto: m.texto.slice(0, 80) || `Conversa por ${m.canal.toLowerCase()}`, status: 'NOVA', prioridade: 'Normal', nivel: 'C', participantes: [], labels: [],
      abertaEm: m.em, ultimaMensagemEm: m.em, ultimaInboundEm: m.em,
    };
    eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, tipo: 'ABERTA', em: m.em, ator: { tipo: 'sistema', nome: 'Inbox' }, detalhe: `conversa aberta por ${m.canal.toLowerCase()} (${m.contexto})` });
  } else {
    const antes = thread.status;
    thread = aoReceberMensagem(thread, m.em);
    if (antes !== thread.status) eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, tipo: 'STATUS', em: m.em, ator: { tipo: 'sistema', nome: 'Inbox' }, detalhe: 'mensagem nova do contato reabriu a conversa', antes, depois: thread.status });
  }
  const mensagem: InboxMessage = {
    id: relogio.novoId('MSG'), threadId: thread.id, direcao: 'inbound', tipo: m.tipo, autor: { tipo: 'contato', id: contato.id, nome: contato.nome }, texto: m.texto, anexos: [], em: m.em, externalMessageId: m.externalMessageId,
  };
  eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, tipo: 'MENSAGEM', em: m.em, ator: { tipo: 'contato', id: contato.id, nome: contato.nome }, detalhe: `mensagem recebida (${m.tipo})` });
  const t = thread;
  return {
    ds: {
      ...ds,
      contatos: novoContato ? [...ds.contatos, contato] : ds.contatos,
      threads: novaThread ? [...ds.threads, t] : ds.threads.map((x) => (x.id === t.id ? t : x)),
      mensagens: [...ds.mensagens, mensagem],
      eventos: [...ds.eventos, ...eventos],
    },
    thread, mensagem, contato, novaThread, novoContato, duplicada: false, motivo: novaThread ? 'conversa aberta' : 'mensagem acrescentada à conversa existente',
  };
}

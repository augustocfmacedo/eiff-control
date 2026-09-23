// EIFF Inbox: as tres fronteiras (canal, inteligencia, execucao) e o gateway de entrada. PURO.
//
// Cada fronteira e uma interface com UMA implementacao real nesta fase, e nenhuma delas produz efeito externo:
// - ChannelProvider MANUAL: registra a saida no Inbox como RASCUNHO (`registrada`). Nada e enviado. O WhatsApp
//   entrara como outro provider (a Meta Cloud ja existe na EIFF Central) SEM mudar a thread;
// - IntelligenceProvider: contrato fechado (`InboxAnalysisInput` -> `InboxAnalysisResult`), sem IA ficticia. Existe o
//   provedor `SEM_INTELIGENCIA` (indisponivel) e a triagem HUMANA. `classificarSeguro` garante o FALLBACK: a
//   indisponibilidade da inteligencia nunca impede o recebimento — a thread fica NOVA, em "Nao atribuidos";
// - ExecutionProvider MANUAL: o job fica ENVIADO aguardando uma pessoa; FACTORY e reservado e recusa (fail-closed)
//   ate a Factory expor sua API (packages/api, W5 da fabrica).
//
// O gateway (`receberMensagem`) e idempotente por (provider, externalMessageId): reenvio do provider nao cria mensagem,
// nem thread, nem evento. No banco a MESMA regra vive em inbox_ingest (migration 0056), que o servidor chama; aqui
// fica a versao em memoria (modo local, testes) e a regra de resolucao de thread que as duas compartilham:
//   mesma identidade + mesmo canal + mesmo contexto + thread nao FECHADA = reutiliza; so FECHADA = reabre; senao cria.
import type { ChannelInboundEvent, CodigoProvider, CommunicationContext } from '../radar/canais';
import { aoReceberMensagem } from './estados';
import { normalizarIdentificador, type CanalInbox, type Classificacao, type ContatoInbox, type EntidadeExtraida, type IdentidadeCanal, type InboxDataset, type InboxJob, type InboxMessage, type InboxThread, type JobResult, type NivelAtendimento, type Prioridade, type ThreadEvent, type TipoRelacao } from './tipos';

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
  replyToExternalId?: string;
  /** Referencias LOGICAS a EIFF Central (0050), quando a mensagem passou por la. */
  conversaCentralId?: string;
  mensagemCentralId?: string;
  texto: string;
  tipo: InboxMessage['tipo'];
  anexos?: InboxMessage['anexos'];
  meta?: InboxMessage['meta'];
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
  async enviar() { return { entrega: 'registrada', motivo: 'canal não conectado: a resposta ficou registrada como rascunho no Inbox e nada foi enviado' }; },
};

/**
 * Escolha do provider de canal para uma thread. Nesta fase existe SO o MANUAL, para qualquer canal: e o unico ponto
 * que mudara quando o WhatsApp (Meta Cloud, EIFF Central) ou o e-mail entrarem — a thread e as acoes nao mudam.
 */
export const provedorCanal = (_t: Pick<InboxThread, 'canal' | 'provider'>): ChannelProvider => PROVEDOR_MANUAL;

const TIPO_POR_META: Record<string, InboxMessage['tipo']> = { image: 'imagem', audio: 'audio', voice: 'audio', document: 'documento', sticker: 'imagem', video: 'documento' };
/**
 * Traduz um evento da EIFF Central para a entrada do Inbox. A Central nao carrega texto (decisao dela); quem tem o
 * corpo e o adapter do provider, que o passa aqui (`conteudo`). Evento sem contexto ou sem telefone e recusado —
 * nunca vira INTERNAL por conveniencia (mesma regra de conversa.ts).
 */
export function deEventoCentral(e: ChannelInboundEvent, conteudo: string | { texto: string; replyToExternalId?: string; nomeInformado?: string; anexos?: InboxMessage['anexos']; conversaCentralId?: string; mensagemCentralId?: string }): MensagemRecebida | { erro: string } {
  if (e.eventType !== 'MESSAGE_RECEIVED' || e.direction !== 'inbound') return { erro: 'só MESSAGE_RECEIVED inbound vira mensagem do Inbox' };
  if (!e.contexto) return { erro: 'contexto indefinido: número de entrada desconhecido' };
  if (!e.contactPhone) return { erro: 'evento sem telefone normalizado' };
  if (!e.externalMessageId) return { erro: 'evento sem externalMessageId: sem chave de deduplicação' };
  const c = typeof conteudo === 'string' ? { texto: conteudo } : conteudo;
  return {
    canal: 'WHATSAPP', provider: e.provider, contexto: e.contexto, externalMessageId: e.externalMessageId, externalConversationId: e.externalConversationId,
    replyToExternalId: c.replyToExternalId, conversaCentralId: c.conversaCentralId, mensagemCentralId: c.mensagemCentralId,
    identidade: { canal: 'WHATSAPP', identificador: e.contactPhone, nomeInformado: c.nomeInformado, verificada: false },
    texto: c.texto, tipo: TIPO_POR_META[e.messageType ?? ''] ?? 'texto', anexos: c.anexos, em: e.occurredAt,
    meta: { tipoOriginal: e.messageType ?? null, phoneNumberId: e.phoneNumberId ?? null },
  };
}

// ---------------------------------------------------------------------------
// 2) Inteligencia (contrato fechado; nenhuma implementacao automatica nesta fase)
// ---------------------------------------------------------------------------
export interface InboxAnalysisInput {
  thread: InboxThread;
  /** A mensagem que disparou a analise. */
  mensagem: InboxMessage;
  /** Historico LIMITADO (ultimas mensagens), nunca a conversa inteira. */
  historico: InboxMessage[];
  contato?: ContatoInbox;
  organizacaoId: string;
  contexto: CommunicationContext;
  setoresDisponiveis: { codigo: string; nome: string }[];
}
export interface InboxAnalysisResult {
  intencao: string;
  assunto: string;
  entidades: EntidadeExtraida[];
  resumo?: string;
  prioridade: Prioridade;
  nivel?: NivelAtendimento;
  setorRecomendado?: string;
  responsavelRecomendadoId?: string;
  acaoSugerida?: string;
  /** 0-1 */
  confianca: number;
  sinais: string[];
  motivoOperacional?: string;
  provedor: Classificacao['provedor'];
  versao: string;
  modelo?: string;
}
export type SaidaInteligencia = { ok: true; resultado: InboxAnalysisResult } | { ok: false; motivo: string };
export interface IntelligenceProvider {
  codigo: Classificacao['provedor'];
  analisar(entrada: InboxAnalysisInput): Promise<SaidaInteligencia>;
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

/** Converte o resultado da inteligencia em Classificacao persistivel (o que o motor de roteamento le). */
export function classificacaoDe(r: InboxAnalysisResult, mensagemId: string, agoraIso: string): Classificacao {
  return {
    intencao: r.intencao, assunto: r.assunto, entidades: r.entidades ?? [], setorRecomendado: r.setorRecomendado, responsavelRecomendadoId: r.responsavelRecomendadoId,
    prioridadeRecomendada: r.prioridade, nivelRecomendado: r.nivel ?? 'C', acaoSugerida: r.acaoSugerida, confianca: r.confianca, sinais: r.sinais ?? [],
    motivoOperacional: r.motivoOperacional, evidencias: r.sinais?.length ? [{ mensagemId, trecho: (r.sinais[0] ?? '').slice(0, 300) }] : [], provedor: r.provedor, versao: r.versao, modelo: r.modelo, em: agoraIso,
  };
}

/** Uma classificacao so e aceita se guardar apenas sinais e evidencias curtas — nada que pareca raciocinio encadeado. */
export function classificacaoAuditavel(c: Classificacao): { ok: boolean; motivo: string } {
  if (!(c.confianca >= 0 && c.confianca <= 1)) return { ok: false, motivo: 'confiança fora de 0-1' };
  if (c.sinais.some((s) => s.length > 200)) return { ok: false, motivo: 'sinal longo demais: guarde sinais, não raciocínio' };
  if ((c.motivoOperacional ?? '').length > 300) return { ok: false, motivo: 'motivo operacional longo demais: uma frase' };
  if (c.evidencias.some((e) => e.trecho.length > 300)) return { ok: false, motivo: 'evidência longa demais: guarde o trecho, não a mensagem inteira' };
  if (!c.intencao || !c.assunto) return { ok: false, motivo: 'classificação sem intenção ou assunto' };
  return { ok: true, motivo: 'auditável' };
}

/**
 * FALLBACK SEM IA: chama o provedor e converte QUALQUER falha (indisponivel, excecao, resultado nao auditavel) em
 * `{ ok: false }`. Nunca lanca. Quem chama ja persistiu a mensagem antes; sem classificacao a thread fica NOVA.
 */
export async function classificarSeguro(provedor: IntelligenceProvider | undefined, entrada: InboxAnalysisInput, agoraIso: string): Promise<{ ok: true; classificacao: Classificacao; resumo?: string } | { ok: false; motivo: string }> {
  if (!provedor) return { ok: false, motivo: 'inteligência não configurada: triagem humana' };
  try {
    const r = await provedor.analisar(entrada);
    if (!r.ok) return { ok: false, motivo: r.motivo };
    const c = classificacaoDe(r.resultado, entrada.mensagem.id, agoraIso);
    const a = classificacaoAuditavel(c);
    if (!a.ok) return { ok: false, motivo: `classificação recusada: ${a.motivo}` };
    return { ok: true, classificacao: c, resumo: r.resultado.resumo };
  } catch (e) {
    return { ok: false, motivo: `inteligência falhou: ${(e as Error).message ?? 'erro'}` };
  }
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
// 4) Gateway de entrada (idempotente; espelha inbox_ingest da migration 0056)
// ---------------------------------------------------------------------------
export interface Relogio { agora: string; novoId: (prefixo: string) => string }
export interface ResultadoRecebimento {
  ds: InboxDataset;
  thread?: InboxThread;
  mensagem?: InboxMessage;
  contato?: ContatoInbox;
  novaThread: boolean;
  novoContato: boolean;
  reaberta: boolean;
  duplicada: boolean;
  motivo: string;
}

const chaveMensagem = (m: { provider: CodigoProvider; externalMessageId?: string }) => (m.externalMessageId ? `${m.provider}|${m.externalMessageId}` : undefined);
export const mesmaIdentidade = (a: IdentidadeCanal, b: IdentidadeCanal): boolean => a.canal === b.canal && normalizarIdentificador(a.canal, a.identificador) === normalizarIdentificador(b.canal, b.identificador);

export function contatoPorIdentidade(contatos: ContatoInbox[], i: IdentidadeCanal): ContatoInbox | undefined {
  return contatos.find((c) => c.identidades.some((x) => mesmaIdentidade(x, i)));
}

/** Thread nao fechada do contato no mesmo canal e contexto (a mais recente); se so houver fechadas, a mais recente (sera reaberta). */
export function threadDoContato(threads: InboxThread[], contatoId: string, canal: CanalInbox, contexto: CommunicationContext): InboxThread | undefined {
  const dele = threads.filter((t) => t.contatoId === contatoId && t.canal === canal && t.contexto === contexto);
  const porRecencia = (a: InboxThread, b: InboxThread) => (a.ultimaMensagemEm < b.ultimaMensagemEm ? 1 : a.ultimaMensagemEm > b.ultimaMensagemEm ? -1 : 0);
  const aberta = dele.filter((t) => t.status !== 'FECHADA').sort(porRecencia)[0];
  return aberta ?? dele.sort(porRecencia)[0];
}

/**
 * Recebe uma mensagem normalizada: deduplica, resolve o contato (cria um `desconhecido` se nao existir), reusa,
 * reabre ou abre a thread e registra mensagem + evento. Nao classifica, nao roteia: isso e um passo seguinte, com sua
 * propria fronteira e seu proprio fallback.
 */
export function receberMensagem(ds: InboxDataset, m: MensagemRecebida, relogio: Relogio): ResultadoRecebimento {
  const chave = chaveMensagem(m);
  if (chave && ds.mensagens.some((x) => chaveMensagem({ provider: x.provider, externalMessageId: x.externalMessageId }) === chave)) {
    return { ds, novaThread: false, novoContato: false, reaberta: false, duplicada: true, motivo: 'mensagem repetida: o provider reenvia até receber confirmação' };
  }
  const identidade: IdentidadeCanal = { ...m.identidade, identificador: normalizarIdentificador(m.identidade.canal, m.identidade.identificador), verificada: false };
  let contato = contatoPorIdentidade(ds.contatos, identidade);
  const novoContato = !contato;
  if (!contato) {
    const tipo: TipoRelacao = m.contexto === 'INTERNAL' ? 'colaborador' : 'desconhecido';
    contato = { id: relogio.novoId('CTI'), nome: identidade.nomeInformado?.trim() || 'Contato não identificado', tipoRelacao: tipo, identidades: [identidade], obras: [], criadoEm: relogio.agora };
  }
  let thread = threadDoContato(ds.threads, contato.id, m.canal, m.contexto);
  const novaThread = !thread;
  let reaberta = false;
  const eventos: ThreadEvent[] = [];
  if (!thread) {
    thread = {
      id: relogio.novoId('THR'), canal: m.canal, provider: m.provider, contexto: m.contexto, contatoId: contato.id, externalConversationId: m.externalConversationId,
      conversaCentralId: m.conversaCentralId, assunto: m.texto.replace(/\s+/g, ' ').trim().slice(0, 80) || `Conversa por ${m.canal.toLowerCase()}`, status: 'NOVA', prioridade: 'Normal', nivel: 'C',
      participantes: [], labels: [], abertaEm: m.em, ultimaMensagemEm: m.em, ultimaInboundEm: m.em, origem: m.provider,
    };
    eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, tipo: 'THREAD_CREATED', em: m.em, ator: { tipo: 'sistema', nome: 'Inbox' }, detalhe: `conversa aberta por ${m.canal.toLowerCase()} (${m.contexto})` });
  } else {
    const antes = thread.status;
    thread = aoReceberMensagem({ ...thread, conversaCentralId: thread.conversaCentralId ?? m.conversaCentralId, externalConversationId: thread.externalConversationId ?? m.externalConversationId }, m.em);
    if (antes !== thread.status) {
      reaberta = true;
      eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, tipo: 'THREAD_REOPENED', em: m.em, ator: { tipo: 'sistema', nome: 'Inbox' }, detalhe: 'mensagem nova do contato reabriu a conversa', antes, depois: thread.status });
    }
  }
  const mensagem: InboxMessage = {
    id: relogio.novoId('MSG'), threadId: thread.id, provider: m.provider, direcao: 'inbound', tipo: m.tipo, autor: { tipo: 'contato', id: contato.id, nome: contato.nome }, texto: m.texto,
    anexos: m.anexos ?? [], em: m.em, externalMessageId: m.externalMessageId, replyToExternalId: m.replyToExternalId, mensagemCentralId: m.mensagemCentralId, meta: m.meta,
  };
  eventos.push({ id: relogio.novoId('EVT'), threadId: thread.id, mensagemId: mensagem.id, tipo: 'MESSAGE_RECEIVED', em: m.em, ator: { tipo: 'contato', id: contato.id, nome: contato.nome }, detalhe: `mensagem recebida (${m.tipo})` });
  const t = thread;
  return {
    ds: {
      ...ds,
      contatos: novoContato ? [...ds.contatos, contato] : ds.contatos,
      threads: novaThread ? [...ds.threads, t] : ds.threads.map((x) => (x.id === t.id ? t : x)),
      mensagens: [...ds.mensagens, mensagem],
      eventos: [...ds.eventos, ...eventos],
    },
    thread, mensagem, contato, novaThread, novoContato, reaberta, duplicada: false, motivo: novaThread ? 'conversa aberta' : reaberta ? 'conversa reaberta pela mensagem do contato' : 'mensagem acrescentada à conversa existente',
  };
}

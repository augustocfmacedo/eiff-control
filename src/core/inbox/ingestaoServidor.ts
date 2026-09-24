// EIFF Inbox: ingestao SERVER-SIDE dos eventos da EIFF Central. PURO (portas injetadas): sem fetch, sem segredo.
//
// Fluxo (docs/eiff-inbox.md § fase 2):
//   Channel Provider -> EIFF Central (webhook assinado, normalizacao) -> ChannelInboundEvent + conteudo
//     -> deEventoCentral (adapter) -> porta `ingerir` (RPC inbox_ingest, server-only, idempotente)
//     -> [porta `rotear` (Octopus Router, roteamentoPorta.ts): deterministico + IA opcional + RPC inbox_apply_routing]
//     -> [sem a porta: inteligencia disponivel? classifica : fica NOVA em "Nao atribuidos"]
//
// Regras:
// - a Central continua sendo a UNICA porta do webhook: nenhuma assinatura e revalidada aqui e o payload bruto nunca chega;
// - so MESSAGE_RECEIVED inbound com contexto conhecido vira mensagem; o resto (status de entrega, numero desconhecido)
//   e contado e ignorado, nunca inventado;
// - a inteligencia e OPCIONAL e nunca bloqueia: falha da IA = mensagem persistida, thread NOVA, motivo no log;
// - o log nunca leva telefone inteiro, texto ou payload: so contagens, ids e outcomes.
import type { ChannelInboundEvent } from '../radar/canais';
import { mascararTelefone } from '../radar/canais';
import { classificarSeguro, deEventoCentral, type IntelligenceProvider, type MensagemRecebida } from './fronteiras';
import type { Classificacao, InboxMessage, InboxThread } from './tipos';

/** Conteudo da mensagem, que a Central nao transporta no evento: chega separado, pela chave `externalMessageId`. */
export interface ConteudoMensagem { externalMessageId: string; texto: string; replyToExternalId?: string; nomeInformado?: string }

export interface PedidoIngest {
  organizationId: string;
  provider: MensagemRecebida['provider'];
  canal: MensagemRecebida['canal'];
  contexto: MensagemRecebida['contexto'];
  identificador: string;
  nomeInformado?: string;
  externalMessageId: string;
  externalConversationId?: string;
  texto: string;
  tipo: InboxMessage['tipo'];
  em: string;
  replyToExternalId?: string;
  conversaCentralId?: string;
  mensagemCentralId?: string;
  anexos: InboxMessage['anexos'];
  meta: InboxMessage['meta'];
}
export interface ResultadoIngest { ok: boolean; duplicada?: boolean; threadId?: string; messageId?: string; contactId?: string; novaThread?: boolean; novoContato?: boolean; reaberta?: boolean; erro?: string }

export interface PortasIngestao {
  /** RPC inbox_ingest (service_role). Idempotente por (provider, externalMessageId). */
  ingerir(p: PedidoIngest): Promise<ResultadoIngest>;
  /** Opcional: classifica a thread recem-tocada. Se ausente ou falhar, nada muda (fallback). */
  inteligencia?: IntelligenceProvider;
  /** Opcional: le thread + mensagem para montar a entrada da inteligencia (so quando ha provedor). */
  carregarParaAnalise?(threadId: string, messageId: string): Promise<{ thread: InboxThread; mensagem: InboxMessage; historico: InboxMessage[]; setores: { codigo: string; nome: string }[] } | undefined>;
  /** Opcional: aplica a classificacao (thread + evento AI_ANALYZED). Nunca chamado sem sucesso da inteligencia. */
  aplicarClassificacao?(threadId: string, classificacao: Classificacao, resumo?: string): Promise<void>;
  /** Fase 3: Octopus Router no servidor (deterministico + IA opcional + RPC). Quando presente, substitui o caminho de classificacao acima. Nunca lanca. */
  rotear?(threadId: string, messageId: string): Promise<{ ok: boolean; aplicado: boolean; classificado: boolean; motivo?: string }>;
  log?(t: Record<string, unknown>): void;
  agora?(): string;
}

export interface RelatorioIngestao {
  recebidos: number;
  ingeridos: number;
  duplicados: number;
  ignorados: { motivo: string }[];
  falhas: { externalMessageId: string; erro: string }[];
  classificados: number;
  semInteligencia: number;
  /** Fase 3: threads roteadas pelo Octopus Router (decisao persistida) e quantas tiveram atribuicao aplicada. */
  roteados: number;
  atribuidos: number;
  threads: string[];
}

export const pedidoDe = (organizationId: string, m: MensagemRecebida): PedidoIngest => ({
  organizationId, provider: m.provider, canal: m.canal, contexto: m.contexto, identificador: m.identidade.identificador, nomeInformado: m.identidade.nomeInformado,
  externalMessageId: m.externalMessageId, externalConversationId: m.externalConversationId, texto: m.texto, tipo: m.tipo, em: m.em, replyToExternalId: m.replyToExternalId,
  conversaCentralId: m.conversaCentralId, mensagemCentralId: m.mensagemCentralId, anexos: m.anexos ?? [], meta: m.meta ?? {},
});

/**
 * Ingere os eventos de um webhook da Central. Cada evento e independente: uma falha nao derruba os outros, e o
 * relatorio diz o que aconteceu com cada um. `falhas` > 0 e o sinal para o webhook devolver 500 (a Meta reenvia; a
 * RPC e idempotente, entao o reenvio so completa o que faltou).
 */
export async function ingerirEventosCentral(organizationId: string, eventos: ChannelInboundEvent[], conteudos: ConteudoMensagem[], portas: PortasIngestao): Promise<RelatorioIngestao> {
  const r: RelatorioIngestao = { recebidos: eventos.length, ingeridos: 0, duplicados: 0, ignorados: [], falhas: [], classificados: 0, semInteligencia: 0, roteados: 0, atribuidos: 0, threads: [] };
  const porId = new Map(conteudos.map((c) => [c.externalMessageId, c]));
  const agora = portas.agora?.() ?? new Date().toISOString();
  for (const e of eventos) {
    if (e.eventType !== 'MESSAGE_RECEIVED' || e.direction !== 'inbound') { r.ignorados.push({ motivo: `evento ${e.eventType} ${e.direction}: não é mensagem recebida` }); continue; }
    const c = e.externalMessageId ? porId.get(e.externalMessageId) : undefined;
    const m = deEventoCentral(e, { texto: c?.texto ?? '', replyToExternalId: c?.replyToExternalId, nomeInformado: c?.nomeInformado });
    if ('erro' in m) { r.ignorados.push({ motivo: m.erro }); portas.log?.({ evento: 'inbox_ingest', outcome: 'ignorado', motivo: m.erro, telefone: mascararTelefone(e.contactPhone) }); continue; }
    let res: ResultadoIngest;
    try { res = await portas.ingerir(pedidoDe(organizationId, m)); }
    catch (err) { const erro = (err as Error).message ?? 'erro'; r.falhas.push({ externalMessageId: m.externalMessageId, erro }); portas.log?.({ evento: 'inbox_ingest', outcome: 'falha', erro: erro.slice(0, 200) }); continue; }
    if (!res.ok) { r.falhas.push({ externalMessageId: m.externalMessageId, erro: res.erro ?? 'recusado' }); portas.log?.({ evento: 'inbox_ingest', outcome: 'recusado', erro: res.erro }); continue; }
    if (res.duplicada) { r.duplicados++; portas.log?.({ evento: 'inbox_ingest', outcome: 'duplicada', threadId: res.threadId }); continue; }
    r.ingeridos++;
    if (res.threadId && !r.threads.includes(res.threadId)) r.threads.push(res.threadId);
    portas.log?.({ evento: 'inbox_ingest', outcome: 'ok', threadId: res.threadId, novaThread: res.novaThread, novoContato: res.novoContato, reaberta: res.reaberta, telefone: mascararTelefone(e.contactPhone) });

    // OCTOPUS ROUTER (fase 3): roteia no servidor — deterministico sempre, IA como refino. Nunca desfaz a ingestao.
    if (portas.rotear && res.threadId && res.messageId) {
      const rot = await portas.rotear(res.threadId, res.messageId);
      if (rot.ok) r.roteados++; if (rot.aplicado) r.atribuidos++; if (rot.classificado) r.classificados++; else r.semInteligencia++;
      continue;
    }
    // FALLBACK SEM IA: tudo abaixo e opcional e nunca desfaz o que ja foi persistido
    if (!portas.inteligencia || !portas.carregarParaAnalise || !portas.aplicarClassificacao || !res.threadId || !res.messageId) { r.semInteligencia++; continue; }
    try {
      const entrada = await portas.carregarParaAnalise(res.threadId, res.messageId);
      if (!entrada) { r.semInteligencia++; continue; }
      const c2 = await classificarSeguro(portas.inteligencia, { thread: entrada.thread, mensagem: entrada.mensagem, historico: entrada.historico.slice(-10), organizacaoId: organizationId, contexto: m.contexto, setoresDisponiveis: entrada.setores }, agora);
      if (!c2.ok) { r.semInteligencia++; portas.log?.({ evento: 'inbox_inteligencia', outcome: 'indisponivel', motivo: c2.motivo.slice(0, 160), threadId: res.threadId }); continue; }
      await portas.aplicarClassificacao(res.threadId, c2.classificacao, c2.resumo);
      r.classificados++;
    } catch (err) {
      r.semInteligencia++;
      portas.log?.({ evento: 'inbox_inteligencia', outcome: 'falha', erro: ((err as Error).message ?? 'erro').slice(0, 160), threadId: res.threadId });
    }
  }
  return r;
}

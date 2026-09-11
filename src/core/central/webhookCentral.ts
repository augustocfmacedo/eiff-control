// EIFF Central — Wave 03 F2-WEBHOOK: orquestracao PURA do webhook sobre PORTAS injetadas.
//
// Recebe os eventos ja normalizados (tratarWebhookMeta validou assinatura e formato ANTES), o contexto do servidor
// (contextoServidor.ts) e as portas da F2-DATA (persistencia da Central e carga SELECT-only do Dataset), e decide:
//   1) contexto nao pronto -> 200, nada carregado, nada persistido (comportamento anterior: contar e descartar);
//   2) filtro D4 (Wave INTERNAL only): so evento INTERNAL de numero da allowlist entra; o resto e contado e descartado
//      sem persistencia, sem leitura de texto e sem Dataset;
//   3) estado + identidades -> aplicarEventos -> persistirLote ANTES de qualquer negocio (idempotencia primeiro);
//   4) so com mensagem nova para agente carrega o Dataset e roda fluxoInterno (mesmo filtro);
//   5) cada atendimento vira UMA linha CONCLUIDO em central_message_processing (hashes, intent, situacao; can_execute
//      e sent literalmente false; nunca o texto);
//   6) erro deterministico -> linha ERRO best-effort + 200 (a Meta nao reenvia o que nunca vai passar);
//      erro transitorio (ou desconhecido) -> linha ERRO best-effort + 503 (a Meta reenvia; no retry a mensagem pendente
//      e reprocessada); acima de LIMITE_TENTATIVAS_TRANSITORIAS -> 200 + `tentativas_esgotadas` (a F2R reprocessa).
//
// Nada aqui conhece cliente de banco, ambiente ou rede: quem cria o cliente service_role e injeta as portas e a funcao
// Netlify. Nenhum texto de mensagem e nenhum telefone inteiro sai no resumo, em erro ou em qualquer retorno.
import { sha256Hex } from '../radar/hash';
import { normalizarTelefone } from '../radar/canais';
import { aplicarEventos, type CentralMessage, type EstadoCentral } from './conversa';
import { fluxoInterno, textosDoPayload, type AtendimentoInterno } from './fluxoInterno';
import type { EventoCentralMeta } from './metaEventos';
import {
  ErroCentralServidor, HTTP_POR_CLASSE, LIMITE_TENTATIVAS_TRANSITORIAS,
  type CarregarDatasetServidor, type ClasseErro, type ContextoCentralServidor, type EstadoPersistido,
  type PortasPersistenciaCentral, type RegistroProcessamento, type ResultadoPersistencia, type ResumoWebhookCentral,
} from './servidorContratos';
import { resolverIdentidade } from './tipos';

export interface EntradaWebhookCentral {
  /** Payload JA validado (assinatura conferida por tratarWebhookMeta). So e lido por textosDoPayload/fluxoInterno. */
  payload: unknown;
  /** Eventos normalizados que tratarWebhookMeta devolveu com status 200. */
  eventos: EventoCentralMeta[];
  contexto: ContextoCentralServidor;
  portas: PortasPersistenciaCentral;
  carregarDataset: CarregarDatasetServidor;
  agoraIso: string;
  /** Relogio em ms para `durationMs`; injetavel para teste deterministico. */
  relogio?: () => number;
}
export interface SaidaWebhookCentral { status: number; resumo: ResumoWebhookCentral }

/**
 * Impressao SHA-256 (hex minusculo, 64 caracteres) de um texto UTF-8 — a MESMA impressao que a F2-DATA grava em
 * `central_message_content.body_sha256` e que a trigger da 0052 compara com `input_sha256`. A implementacao e a pura do
 * projeto (radar/hash.ts); `webhookCentral.test.ts` prova a paridade byte a byte com `createHash('sha256')` do Node.
 */
export const impressaoTexto = (texto: string): string => sha256Hex(texto);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Codigo curto e sem dados para a linha ERRO e para o resumo: nunca mensagem de excecao, texto ou telefone.
 * Sequencias de 5+ digitos caem fora (a 0052 recusa error_code com 7+ digitos; telefone e wamid nunca viram codigo).
 */
export const codigoSeguro = (bruto: string): string => (
  bruto.toLowerCase().replace(/[0-9]{5,}/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'erro'
);

/** Predicado D4: evento INTERNAL cujo telefone (normalizado) esta na allowlist. E o mesmo usado como `filtroEventos` do fluxoInterno. */
export const filtroAlpha = (contexto: ContextoCentralServidor) => (e: EventoCentralMeta): boolean =>
  e.contexto === 'INTERNAL' && contexto.numerosPermitidos.has(normalizarTelefone(e.contactPhone) ?? '');

/**
 * Tira do estado as mensagens pendentes de processamento (persistidas sem CONCLUIDO: crash entre persistir e processar)
 * e os eventos delas. Assim `aplicarEventos` e `fluxoInterno` as tratam como NOVAS e o reenvio da Meta as reprocessa;
 * a persistencia continua idempotente (`on conflict do nothing`), entao nada e duplicado no banco. Mensagens ja CONCLUIDO
 * ficam no estado e viram duplicadas: o motor nao roda de novo.
 */
export function removerPendentes(estado: EstadoCentral, externalIds: ReadonlySet<string>): EstadoCentral {
  if (externalIds.size === 0) return estado;
  const idsMensagens = new Set(estado.mensagens.filter((m) => externalIds.has(m.externalMessageId)).map((m) => m.id));
  return {
    conversas: estado.conversas,
    mensagens: estado.mensagens.filter((m) => !idsMensagens.has(m.id)),
    eventos: estado.eventos.filter((e) => !(e.mensagemId && idsMensagens.has(e.mensagemId))),
  };
}

/** Pendentes com erros transitorios abaixo do teto sao reprocessadas; as demais ficam para a F2R. */
export function separarPendentes(estado: EstadoPersistido): { reprocessar: Set<string>; esgotadas: string[] } {
  const reprocessar = new Set<string>();
  const esgotadas: string[] = [];
  for (const id of estado.pendentesDeProcessamento) {
    if ((estado.errosPorMensagem.get(id) ?? 0) >= LIMITE_TENTATIVAS_TRANSITORIAS) esgotadas.push(id);
    else reprocessar.add(id);
  }
  return { reprocessar, esgotadas };
}

const classeDe = (e: unknown): ClasseErro => (e instanceof ErroCentralServidor ? e.classe : 'transitorio');
const codigoDe = (e: unknown): string => codigoSeguro(e instanceof ErroCentralServidor ? e.codigo : 'erro_inesperado');

/** uuid do banco para um id do core: pelo mapa da persistencia ou, quando o core ja carregou a linha do banco, o proprio id. */
const uuidDe = (mapa: ReadonlyMap<string, string> | undefined, idCore: string): string | undefined =>
  mapa?.get(idCore) ?? (UUID.test(idCore) ? idCore : undefined);

interface Alvo { conversaId: string; mensagemId: string; externalMessageId: string }
/**
 * uuids das mensagens que o banco JA conhecia (estado carregado: ids sao uuids), por externalMessageId. Servem para a
 * linha ERRO best-effort de uma mensagem pendente reprocessada quando `persistirLote` falha antes de devolver o mapa.
 */
function uuidsPrevios(estado: EstadoCentral): Map<string, Alvo> {
  const previos = new Map<string, Alvo>();
  for (const m of estado.mensagens) {
    if (UUID.test(m.id) && UUID.test(m.conversaId)) previos.set(m.externalMessageId, { conversaId: m.conversaId, mensagemId: m.id, externalMessageId: m.externalMessageId });
  }
  return previos;
}
/** Mensagens inbound do lote (novas ou reprocessadas) com os dois uuids conhecidos: so para elas existe linha de processamento. */
function alvosDoLote(mensagens: CentralMessage[], ids: ResultadoPersistencia['ids'] | undefined, previos: ReadonlyMap<string, Alvo>): Alvo[] {
  const alvos: Alvo[] = [];
  for (const m of mensagens) {
    const mensagemId = uuidDe(ids?.mensagens, m.id) ?? previos.get(m.externalMessageId)?.mensagemId;
    const conversaId = uuidDe(ids?.conversas, m.conversaId) ?? previos.get(m.externalMessageId)?.conversaId;
    if (mensagemId && conversaId) alvos.push({ conversaId, mensagemId, externalMessageId: m.externalMessageId });
  }
  return alvos;
}

/**
 * Orquestra um lote do webhook. Nunca lanca: toda falha vira status + codigo no resumo. O resumo carrega SO contagens e
 * codigos (nenhum texto, nenhum telefone, nenhuma pilha).
 */
export async function processarWebhookCentral(entrada: EntradaWebhookCentral): Promise<SaidaWebhookCentral> {
  const { contexto, eventos, portas, agoraIso } = entrada;
  const relogio = entrada.relogio ?? (() => Date.now());
  const inicio = relogio();
  const resumo: ResumoWebhookCentral = {
    modo: contexto.modo, status: 200, eventos: eventos.length, descartados: 0, persistidos: 0, processados: 0, concluidos: 0, erros: 0, codigos: [],
  };
  const codigo = (c: string) => { if (!resumo.codigos.includes(c)) resumo.codigos.push(c); };
  const responder = (status: number): SaidaWebhookCentral => { resumo.status = status; return { status, resumo }; };

  // 1) contexto fechado: exatamente o comportamento anterior — contar e descartar, sem tocar em porta nenhuma
  if (!contexto.pronto || !contexto.organizationId) { resumo.descartados = eventos.length; return responder(200); }
  const org = contexto.organizationId;

  // 2) filtro D4: INTERNAL + allowlist. Fora disso nada e persistido, lido ou carregado.
  const permitido = filtroAlpha(contexto);
  const permitidos = eventos.filter(permitido);
  resumo.descartados = eventos.length - permitidos.length;
  if (permitidos.length === 0) return responder(200);

  const telefones = [...new Set(permitidos.map((e) => normalizarTelefone(e.contactPhone)).filter((t): t is string => !!t))];
  const externalIds = [...new Set(permitidos.map((e) => e.externalMessageId).filter((id): id is string => !!id))];
  const idsPermitidos = new Set(externalIds);

  // do que ja foi persistido depende a linha ERRO best-effort; fica fora do try para o catch alcancar
  let ids: ResultadoPersistencia['ids'] | undefined;
  let candidatas: CentralMessage[] = [];
  let previos: Map<string, Alvo> = new Map();
  let textos: Map<string, string> = new Map();

  try {
    // 4) estado previo e identidades da chave (organizacao, INTERNAL, telefones)
    const estado = await portas.carregarEstado(org, 'INTERNAL', telefones, externalIds);
    const identidades = await portas.carregarIdentidades(org, 'INTERNAL', telefones);
    const { reprocessar, esgotadas } = separarPendentes(estado);
    if (esgotadas.length) codigo('tentativas_esgotadas');
    previos = uuidsPrevios(estado.estado);
    // pendente abaixo do teto sai do estado para ser tratada como nova (reprocessada); esgotada fica e vira duplicada
    const estadoAjustado = removerPendentes(estado.estado, reprocessar);

    // 5) aplicacao idempotente + textos (so dos ids permitidos) + identidade VERIFIED por conversa
    const aplicado = aplicarEventos(estadoAjustado, permitidos, { organizationId: org, agoraIso });
    textos = new Map([...textosDoPayload(entrada.payload)].filter(([id]) => idsPermitidos.has(id)));
    const identidadePorConversa = new Map<string, string>();
    for (const c of aplicado.estado.conversas) {
      const r = resolverIdentidade(c.telefoneNormalizado, identidades, 'INTERNAL', org);
      if (r.verificada && r.identidade) identidadePorConversa.set(c.id, r.identidade.id);
    }

    // 6) persistencia ANTES de qualquer negocio (as candidatas ficam conhecidas antes, para a linha ERRO best-effort)
    candidatas = aplicado.paraAgente;
    const resultado = await portas.persistirLote({ organizationId: org, aplicado, textos, identidadePorConversa, agoraIso });
    ids = resultado.ids;
    resumo.persistidos = aplicado.mensagensNovas.length;

    // 7) nada novo para agente: so status/duplicatas — o Dataset nem e carregado
    if (aplicado.paraAgente.length === 0) return responder(200);

    // 8) Dataset SELECT-only e o caminho continuo, com o MESMO filtro D4
    const ds = await entrada.carregarDataset(org);
    const fluxo = await fluxoInterno({
      payload: entrada.payload,
      servidor: { ds, organizationId: org, identidades, numeros: contexto.numeros },
      agoraIso, estado: estadoAjustado, filtroEventos: permitido,
    });

    // 9) uma linha CONCLUIDO por atendimento
    const porIdCore = new Map(aplicado.estado.mensagens.map((m) => [m.id, m]));
    for (const a of fluxo.atendimentos) {
      // defesa: nesta fase NENHUM atendimento executa; qualquer outra coisa e bug e nunca vira registro
      if (a.podeExecutar !== false) throw new ErroCentralServidor('execucao_indevida', 'deterministico');
      const mensagem = porIdCore.get(a.mensagemId);
      const mensagemId = uuidDe(ids.mensagens, a.mensagemId) ?? previos.get(a.externalMessageId)?.mensagemId;
      const conversaId = mensagem ? (uuidDe(ids.conversas, mensagem.conversaId) ?? previos.get(a.externalMessageId)?.conversaId) : undefined;
      if (!mensagem || !mensagemId || !conversaId) throw new ErroCentralServidor('ids_persistencia_ausentes', 'transitorio');
      const registro = montarRegistro({
        a, org, conversaId, mensagemId, contexto,
        identidadeId: a.identidade.verificada ? identidadePorConversa.get(mensagem.conversaId) : undefined,
        texto: textos.get(a.externalMessageId), durationMs: relogio() - inicio, agoraIso,
      });
      const r = await portas.registrarProcessamento(registro);
      resumo.processados += 1;
      if (!r.jaConcluido) resumo.concluidos += 1;
    }
    return responder(200);
  } catch (e) {
    const classe = classeDe(e);
    resumo.erros += 1;
    codigo(codigoDe(e));
    // linha ERRO best-effort para as mensagens do lote que ja tem uuid; falha aqui nao muda o status
    await registrarErros({ portas, org, contexto, alvos: alvosDoLote(candidatas, ids, previos), textos, errorCode: codigoDe(e), durationMs: relogio() - inicio, agoraIso });
    return responder(HTTP_POR_CLASSE[classe]);
  }
}

function montarRegistro(p: {
  a: AtendimentoInterno; org: string; conversaId: string; mensagemId: string; contexto: ContextoCentralServidor;
  identidadeId?: string; texto?: string; durationMs: number; agoraIso: string;
}): RegistroProcessamento {
  const { a } = p;
  return {
    organizationId: p.org, conversaId: p.conversaId, mensagemId: p.mensagemId, identidadeId: p.identidadeId,
    origem: 'WEBHOOK', engineSha: p.contexto.engineSha, flowVersion: p.contexto.flowVersion,
    // sem texto (audio, imagem, documento) nao ha inputSha256: a situacao sera `sem_texto` (constraint da 0052)
    inputSha256: p.texto ? impressaoTexto(p.texto) : undefined,
    outputSha256: impressaoTexto(a.resposta.texto),
    intent: a.decisao.intent, situacao: a.situacao,
    status: 'CONCLUIDO', canExecute: false, sent: false,
    durationMs: Math.max(0, p.durationMs), processedAt: p.agoraIso,
  };
}

async function registrarErros(p: {
  portas: PortasPersistenciaCentral; org: string; contexto: ContextoCentralServidor; alvos: Alvo[];
  textos: ReadonlyMap<string, string>; errorCode: string; durationMs: number; agoraIso: string;
}): Promise<void> {
  for (const alvo of p.alvos) {
    const texto = p.textos.get(alvo.externalMessageId);
    const registro: RegistroProcessamento = {
      organizationId: p.org, conversaId: alvo.conversaId, mensagemId: alvo.mensagemId,
      origem: 'WEBHOOK', engineSha: p.contexto.engineSha, flowVersion: p.contexto.flowVersion,
      inputSha256: texto ? impressaoTexto(texto) : undefined,
      status: 'ERRO', errorCode: p.errorCode, canExecute: false, sent: false,
      durationMs: Math.max(0, p.durationMs), processedAt: p.agoraIso,
    };
    try { await p.portas.registrarProcessamento(registro); } catch { /* best-effort: o status HTTP ja foi decidido pela classe do erro */ }
  }
}

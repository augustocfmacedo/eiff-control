// EIFF Central — CAMINHO DE ENVIO da Meta WhatsApp Cloud API. Puro e testavel: nenhuma rede aqui dentro,
// nenhum segredo e nenhum endereco de servidor — o host da Graph API vive so em metaServidor.ts, e um teste de
// fronteira prende isso. Aqui as requisicoes sao descritas por CAMINHO relativo e corpo.
//
// NESTA ONDA NADA E ENVIADO. Todo o rito do canario do Octadesk (src/core/radar/canaisEnvio.test.ts,
// canaisServidor.ts) esta implementado e testado — montagem da requisicao, tres guardas fail-closed em duas
// camadas, delivery first e classificacao do retorno — mas a porta do efeito externo e o TRANSPORTE_BLOQUEADO,
// cuja ultima linha e recusarEnvio(). Nenhum caminho do sistema faz POST de mensagem na Graph API.
//
// As regras genericas continuam vindo de src/core/radar/canais.ts (chaveIdempotencia, TRANSICOES_ENTREGA,
// impressaoComando, classificarFalhaEnvio, interpretarRespostaEnvio, autorizarDestino): aqui nao ha versao nova
// de nenhuma delas, so a traducao do formato da Meta para o contrato canonico.
import {
  ENVIO_BLOQUEADO, ErroCanal, JANELA_LIVRE_HORAS, MENSAGEM_ENVIO_BLOQUEADO,
  autorizarDestino, avaliarJanelaLivre, chaveIdempotencia, impressaoComando, interpretarRespostaEnvio,
  permitePostar, recusarEnvio, validarCoerenciaCanal,
  type ChannelInboundEvent, type Entregabilidade, type EstadoEntrega, type LeituraRespostaEnvio,
  type MensagemCanal, type ModoEnvio, type ModoEntrega, type OrigemAtor, type PedidoEnvio, type ProvaJanela,
  type TemplateCanal,
} from '../radar/canais';
import type { Canal } from '../radar/types';

export const PROVIDER_META = 'META_CLOUD' as const;
/** Limite do corpo de uma mensagem de texto da Cloud API. */
export const LIMITE_TEXTO_META = 4096;
/** Limite pratico de um parametro de template (a Meta recusa parametro gigante ou com quebra de linha). */
export const LIMITE_VARIAVEL_META = 1024;

// ---------------------------------------------------------------------------
// 1) Coerencia de canal
// ---------------------------------------------------------------------------
/**
 * Mesma regra do Octadesk, com a linha da Meta: META_CLOUD so entrega WHATSAPP. `validarCoerenciaCanal`
 * (canais.ts) segue sendo a regra geral — aqui so se acrescenta o provider novo, sem reescrever nada.
 */
export function validarCoerenciaCanalMeta(p: { canalComunicacao: Canal; canalEntrega: Canal }): { ok: boolean; motivo: string } {
  const base = validarCoerenciaCanal({ canalComunicacao: p.canalComunicacao, canalEntrega: p.canalEntrega, provider: PROVIDER_META });
  if (!base.ok) return base;
  if (p.canalComunicacao !== 'WHATSAPP') return { ok: false, motivo: `Meta Cloud só entrega WhatsApp; esta comunicação é ${p.canalComunicacao}` };
  return base;
}

// ---------------------------------------------------------------------------
// 2) Janela de 24 h: na Meta a prova vem do WEBHOOK, nao de um GET
// ---------------------------------------------------------------------------
/**
 * A Cloud API nao tem "conversa" consultavel como o Octadesk: quem prova que o contato falou conosco e o evento
 * MESSAGE_RECEIVED do webhook. Traduzimos os eventos para o mesmo formato que `avaliarJanelaLivre` ja entende,
 * entao a regra da janela continua UMA so (canais.ts), com a mesma exigencia de prova positiva.
 */
export function mensagensDeEventosMeta(eventos: ChannelInboundEvent[]): MensagemCanal[] {
  return eventos
    .filter((e) => e.provider === PROVIDER_META && e.externalMessageId && e.occurredAt)
    .map((e) => ({
      id: e.externalMessageId!, conversaId: e.externalConversationId, em: e.occurredAt,
      // so a mensagem RECEBIDA do contato prova a janela; status das nossas mensagens nunca prova
      direcao: e.eventType === 'MESSAGE_RECEIVED' ? 'entrada' : e.direction === 'outbound' ? 'saida' : 'desconhecida',
      status: e.externalStatus, interna: false,
    }));
}
/** Prova da janela livre a partir dos eventos do webhook do contato (mais recentes ou nao, tanto faz: a regra ordena). */
export function provaJanelaMeta(eventos: ChannelInboundEvent[], agoraIso?: string): ProvaJanela {
  return avaliarJanelaLivre(mensagensDeEventosMeta(eventos), agoraIso, JANELA_LIVRE_HORAS);
}

// ---------------------------------------------------------------------------
// 3) Montagem da requisicao (POST /{PHONE_NUMBER_ID}/messages)
// ---------------------------------------------------------------------------
export interface RequisicaoEnvioMeta {
  metodo: 'POST';
  /** Caminho relativo a versao da Graph API. O host vive so no modulo server-side. */
  caminho: string;
  corpo: Record<string, unknown>;
}
/** Origem de cada variavel do template. O texto livre do LLM NUNCA vira template: o mapeamento e explicito. */
export type OrigemVariavelMeta = 'contato.nome' | 'contato.email' | 'empresa.nome' | 'remetente.nome' | 'fixo';
export interface MapeamentoTemplateMeta { templateId: string; variaveis: { chave: string; origem: OrigemVariavelMeta; valorFixo?: string }[] }
export interface DadosVariaveisMeta { contatoNome?: string; contatoEmail?: string; empresaNome?: string; remetenteNome?: string }

/** Parametro de template nao aceita quebra de linha, tabulacao nem sequencia longa de espacos. */
export const sanitizarVariavelMeta = (v: string) => v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, LIMITE_VARIAVEL_META);
const numerico = (s: string) => /^\d+$/.test(s);

export type ResolucaoVariaveis = { ok: true; parametros: { chave: string; valor: string }[] } | { ok: false; codigo: string; mensagem: string };
/**
 * Variaveis do template: so mapeamento EXPLICITO do servidor. Template com variaveis e sem mapeamento (ou com
 * mapeamento incompleto, ou com valor vazio) nao envia — a Meta rejeita, e adivinhar valor seria inventar fato.
 */
export function resolverVariaveisTemplateMeta(t: TemplateCanal, mapeamento: MapeamentoTemplateMeta | undefined, dados: DadosVariaveisMeta): ResolucaoVariaveis {
  const chaves = [...t.variaveis].sort((a, b) => (numerico(a) && numerico(b) ? Number(a) - Number(b) : a.localeCompare(b)));
  if (!chaves.length) return { ok: true, parametros: [] };
  if (!mapeamento || mapeamento.templateId !== t.id || !mapeamento.variaveis.length) {
    return { ok: false, codigo: 'template_sem_mapeamento', mensagem: `template "${t.nome}" tem variáveis (${chaves.join(', ')}) e não há mapeamento aprovado no servidor` };
  }
  const parametros: { chave: string; valor: string }[] = [];
  const faltando: string[] = [];
  for (const chave of chaves) {
    const m = mapeamento.variaveis.find((x) => x.chave === chave);
    const bruto = !m ? '' : m.origem === 'contato.nome' ? dados.contatoNome ?? '' : m.origem === 'contato.email' ? dados.contatoEmail ?? ''
      : m.origem === 'empresa.nome' ? dados.empresaNome ?? '' : m.origem === 'remetente.nome' ? dados.remetenteNome ?? '' : m.valorFixo ?? '';
    const valor = sanitizarVariavelMeta(bruto);
    if (!valor) { faltando.push(chave); continue; }
    parametros.push({ chave, valor });
  }
  if (faltando.length) return { ok: false, codigo: 'template_sem_mapeamento', mensagem: `variáveis sem valor no mapeamento do template "${t.nome}": ${faltando.join(', ')}` };
  return { ok: true, parametros };
}

export interface EntradaMontagemMeta {
  phoneNumberId: string;
  telefone: string;
  modo: Extract<ModoEntrega, 'TEMPLATE' | 'FREEFORM'>;
  texto?: string;
  template?: { nome: string; idioma: string };
  parametros?: { chave: string; valor: string }[];
}
export type MontagemMeta = { ok: true; requisicao: RequisicaoEnvioMeta } | { ok: false; codigo: string; mensagem: string };
/**
 * Monta o corpo oficial da Cloud API. FREEFORM = `type: 'text'` (so dentro da janela comprovada, conferida antes);
 * TEMPLATE = `type: 'template'` com name, language.code e components. Nenhum texto do LLM entra em template.
 */
export function montarRequisicaoMeta(e: EntradaMontagemMeta): MontagemMeta {
  if (!e.phoneNumberId) return { ok: false, codigo: 'sem_remetente', mensagem: 'número oficial (phone number id) não configurado' };
  if (!e.telefone) return { ok: false, codigo: 'sem_telefone', mensagem: 'destino sem WhatsApp válido' };
  const caminho = `/${encodeURIComponent(e.phoneNumberId)}/messages`;
  const cabecalho = { messaging_product: 'whatsapp', recipient_type: 'individual', to: e.telefone };
  if (e.modo === 'FREEFORM') {
    const texto = (e.texto ?? '').trim();
    if (!texto) return { ok: false, codigo: 'sem_texto_aprovado', mensagem: 'a comunicação não tem texto aprovado efetivo' };
    if (texto.length > LIMITE_TEXTO_META) return { ok: false, codigo: 'texto_muito_longo', mensagem: `texto aprovado passa de ${LIMITE_TEXTO_META} caracteres para a Cloud API` };
    return { ok: true, requisicao: { metodo: 'POST', caminho, corpo: { ...cabecalho, type: 'text', text: { preview_url: false, body: texto } } } };
  }
  const t = e.template;
  if (!t?.nome) return { ok: false, codigo: 'template_invalido', mensagem: 'envio por template exige um template aprovado e ativo do provider' };
  if (!t.idioma) return { ok: false, codigo: 'template_sem_idioma', mensagem: `template "${t.nome}" sem idioma (language.code) na lista do provider` };
  const parametros = e.parametros ?? [];
  const componentes = parametros.length
    ? [{ type: 'body', parameters: parametros.map((p) => (numerico(p.chave) ? { type: 'text', text: p.valor } : { type: 'text', parameter_name: p.chave, text: p.valor })) }]
    : [];
  return { ok: true, requisicao: { metodo: 'POST', caminho, corpo: { ...cabecalho, type: 'template', template: { name: t.nome, language: { code: t.idioma }, ...(componentes.length ? { components: componentes } : {}) } } } };
}

// ---------------------------------------------------------------------------
// 4) Preparo completo: as tres guardas + a montagem, tudo antes de qualquer efeito
// ---------------------------------------------------------------------------
/** PedidoEnvio (canais.ts) com o que a Cloud API exige a mais: nome e idioma do template e a prova da janela. */
export interface PedidoEnvioMeta extends PedidoEnvio { templateNome?: string; templateIdioma?: string; janela?: ProvaJanela; entregabilidade?: Entregabilidade }

export interface ContextoEnvioMeta {
  comunicacaoId: string; contatoId: string;
  canalComunicacao: Canal;
  phoneNumberId: string;
  telefone?: string;
  modo: ModoEntrega;
  texto?: string;
  template?: TemplateCanal;
  mapeamento?: MapeamentoTemplateMeta;
  dados?: DadosVariaveisMeta;
  janela?: ProvaJanela;
  entregabilidade?: Entregabilidade;
  modoEnvio: ModoEnvio;
  allowlist: string[];
}
export interface PreparoOk {
  ok: true;
  requisicao: RequisicaoEnvioMeta;
  modo: Extract<ModoEntrega, 'TEMPLATE' | 'FREEFORM'>;
  telefone: string;
  idempotencyKey: string;
  fingerprint: string;
  templateId?: string;
  janelaLivreAte?: string;
}
export interface PreparoErro { ok: false; codigo: string; mensagem: string; httpStatus: number }
export type PreparoEnvioMeta = PreparoOk | PreparoErro;
const erro = (codigo: string, mensagem: string, httpStatus = 409): PreparoErro => ({ ok: false, codigo, mensagem, httpStatus });

/**
 * Guardas, na ordem: (1) modo de envio + allowlist do canario (autorizarDestino, a mesma do Octadesk),
 * (2) coerencia de canal, (3) entregabilidade — e a entregabilidade do modo FREEFORM exige janela COMPROVADA.
 * So depois disso a requisicao e montada. Nada aqui grava, envia ou toca em rede.
 */
export function prepararEnvioMeta(c: ContextoEnvioMeta): PreparoEnvioMeta {
  const autorizacao = autorizarDestino(c.telefone, c.modoEnvio, c.allowlist);
  if (!autorizacao.permitido) return erro(autorizacao.codigo ?? 'destino_nao_autorizado', autorizacao.motivo, autorizacao.codigo === 'sem_telefone' ? 409 : 403);
  const coerencia = validarCoerenciaCanalMeta({ canalComunicacao: c.canalComunicacao, canalEntrega: c.canalComunicacao });
  if (!coerencia.ok) return erro('canal_incoerente', coerencia.motivo);
  if (c.entregabilidade && !c.entregabilidade.apto) return erro('nao_entregavel', c.entregabilidade.motivo);
  if (c.modo !== 'TEMPLATE' && c.modo !== 'FREEFORM') return erro('modo_nao_suportado', 'a Meta Cloud entrega por template ou por mensagem livre; envio manual não passa por aqui');
  if (c.modo === 'FREEFORM' && !c.janela?.janelaComprovada) return erro('janela_nao_comprovada', `mensagem livre exige janela de ${JANELA_LIVRE_HORAS} h comprovada por mensagem do contato${c.janela?.motivo ? ` (${c.janela.motivo})` : ''}`);

  let parametros: { chave: string; valor: string }[] = [];
  if (c.modo === 'TEMPLATE') {
    if (!c.template || c.template.status !== 'approved' || !c.template.ativo) return erro('template_invalido', 'escolha um template aprovado e ativo entre os atuais do provider');
    const v = resolverVariaveisTemplateMeta(c.template, c.mapeamento, c.dados ?? {});
    if (!v.ok) return erro(v.codigo, v.mensagem);
    parametros = v.parametros;
  }
  const montagem = montarRequisicaoMeta({
    phoneNumberId: c.phoneNumberId, telefone: c.telefone!, modo: c.modo, texto: c.texto,
    template: c.template ? { nome: c.template.nome, idioma: c.template.idioma ?? '' } : undefined, parametros,
  });
  if (!montagem.ok) return erro(montagem.codigo, montagem.mensagem);
  const comum = { comunicacaoId: c.comunicacaoId, provider: PROVIDER_META, canal: c.canalComunicacao, modo: c.modo, remetenteId: c.phoneNumberId, templateId: c.template?.id };
  return {
    ok: true, requisicao: montagem.requisicao, modo: c.modo, telefone: c.telefone!,
    idempotencyKey: chaveIdempotencia(comum),
    fingerprint: impressaoComando({ ...comum, telefone: c.telefone, texto: c.modo === 'FREEFORM' ? c.texto : undefined }),
    templateId: c.template?.id, janelaLivreAte: c.janela?.janelaLivreAte,
  };
}

/** Contexto montado a partir do PedidoEnvio que o provider recebe (fronteira do efeito externo). */
export const contextoDoPedidoMeta = (p: PedidoEnvioMeta, extra: { phoneNumberId: string; modoEnvio: ModoEnvio; allowlist: string[] }): ContextoEnvioMeta => ({
  comunicacaoId: p.comunicacaoId, contatoId: p.contatoId, canalComunicacao: p.canal,
  phoneNumberId: p.remetenteId || extra.phoneNumberId, telefone: p.telefone, modo: p.modo, texto: p.texto,
  template: p.templateId || p.templateNome
    ? { id: p.templateId ?? p.templateNome!, nome: p.templateNome ?? p.templateCodigo ?? '', status: 'approved', ativo: true, idioma: p.templateIdioma, variaveis: (p.variaveis ?? []).map((v) => v.chave) }
    : undefined,
  mapeamento: p.templateId && p.variaveis?.length ? { templateId: p.templateId, variaveis: p.variaveis.map((v) => ({ chave: v.chave, origem: 'fixo' as const, valorFixo: v.valor })) } : undefined,
  janela: p.janela, entregabilidade: p.entregabilidade, modoEnvio: extra.modoEnvio, allowlist: extra.allowlist,
});

// ---------------------------------------------------------------------------
// 5) Classificacao do retorno da Graph API
// ---------------------------------------------------------------------------
export interface RespostaEnvioBruta { httpStatus?: number; timeout?: boolean; rede?: boolean; corpo?: unknown }
type Row = Record<string, unknown>;
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/**
 * Traduz o corpo da Cloud API para o contrato canonico que `interpretarRespostaEnvio` (canais.ts) le, sem
 * duplicar a regra de classificacao.
 * Sucesso: { messaging_product, contacts:[{input, wa_id}], messages:[{id, message_status}] }.
 * Erro:    { error: { message, type, code, error_subcode, fbtrace_id } } — `code` vem como NUMERO, e por isso
 *          e convertido em texto aqui (o contrato canonico so enxerga codigo em string).
 * `wa_id` e o TELEFONE do destinatario: nunca vira id de conversa (o ledger jamais guarda telefone). A conversa
 * so aparece depois, no webhook de status (`conversation.id`).
 */
export function canonizarRespostaMeta(corpo: unknown): Row {
  const c = (corpo ?? {}) as Row;
  const e = (c.error ?? {}) as Row;
  const codigo = txt(e.code) ?? (e.code !== undefined && e.code !== null ? String(e.code) : undefined);
  const m = arr(c.messages)[0];
  return {
    ...(codigo ? { errorCode: codigo } : {}),
    ...(m && txt(m.id) ? { id: txt(m.id) } : {}),
    ...(m && txt(m.message_status) ? { status: txt(m.message_status) } : {}),
  };
}
/** Ids presentes = ACCEPTED; rejeicao explicita da Meta = FAILED; timeout, rede, 5xx e 2xx sem id = UNKNOWN. */
export function interpretarRespostaMetaEnvio(r: RespostaEnvioBruta): LeituraRespostaEnvio {
  return interpretarRespostaEnvio({ httpStatus: r.httpStatus, timeout: r.timeout, rede: r.rede, corpo: canonizarRespostaMeta(r.corpo) });
}

// ---------------------------------------------------------------------------
// 6) Transporte: a fronteira do efeito externo, fechada nesta onda
// ---------------------------------------------------------------------------
export interface TransporteEnvioMeta {
  /** Falso enquanto a onda de envio nao for liberada. Com transporte fechado, nem a entrega chega a ser criada. */
  liberado: boolean;
  postar(req: RequisicaoEnvioMeta): Promise<RespostaEnvioBruta>;
}
/** Unico transporte que existe hoje no sistema: recusa. Nenhum POST de mensagem sai daqui. */
export const TRANSPORTE_BLOQUEADO: TransporteEnvioMeta = { liberado: false, postar: async () => recusarEnvio() };

// ---------------------------------------------------------------------------
// 7) Delivery first: entrega READY -> REQUESTED -> (POST) -> ACCEPTED/FAILED/UNKNOWN
// ---------------------------------------------------------------------------
export interface ComandoCriarEntregaMeta { comunicacaoId: string; canal: Canal; modo: ModoEntrega; idempotencyKey: string; fingerprint: string; remetenteId: string; templateId?: string }
export interface RespostaCriarEntrega { ok: boolean; erro?: string; deliveryId?: string; status?: EstadoEntrega; existente?: boolean }
export interface ComandoTransicionarEntregaMeta {
  deliveryId: string; para: EstadoEntrega; origemAtor: OrigemAtor;
  conversaProviderId?: string; mensagemProviderId?: string; statusProvider?: string; erroCodigo?: string; motivoSeguro?: string;
}
/**
 * Portas do ledger de entrega (as funcoes server-only do banco, que so a funcao Netlify chama com service_role)
 * e do provider. Sao INJETADAS: este modulo nao importa banco, nao conhece nome de RPC e nao escreve em lugar nenhum.
 */
export interface PortasEntregaMeta {
  criar(cmd: ComandoCriarEntregaMeta): Promise<RespostaCriarEntrega>;
  transicionar(cmd: ComandoTransicionarEntregaMeta): Promise<{ ok: boolean; erro?: string }>;
  enviar?: TransporteEnvioMeta;
}
export interface ResultadoExecucaoMeta {
  ok: boolean; httpStatus: number; codigo?: string; mensagem?: string;
  /** Provado nos testes: false em TODOS os caminhos desta onda. */
  postou: boolean;
  entrega?: { id: string; status: EstadoEntrega; modo: ModoEntrega; jaProcessada?: boolean; conversaProviderId?: string; mensagemProviderId?: string; statusProvider?: string; erroCodigo?: string };
  leitura?: LeituraRespostaEnvio;
  proximoPasso?: 'reconciliar' | 'revisar' | 'confirmado';
}

/**
 * Rito completo do canario, na ordem que importa:
 *   guardas -> transporte liberado? -> cria a entrega (READY) -> REQUESTED -> POST -> classifica -> transiciona.
 * Falhou antes do POST, nada e enviado. Entrega que ja existia (duplo clique) nunca gera um segundo POST.
 * Nesta onda o transporte padrao e o BLOQUEADO: a recusa acontece ANTES de criar a entrega, para nao queimar a
 * chave de idempotencia com uma entrega que nunca sairia — o ledger continua vazio, como no Octadesk antes do canario.
 */
export async function executarEnvioMeta(ctx: ContextoEnvioMeta, portas: PortasEntregaMeta): Promise<ResultadoExecucaoMeta> {
  const preparo = prepararEnvioMeta(ctx);
  if (!preparo.ok) return { ok: false, httpStatus: preparo.httpStatus, codigo: preparo.codigo, mensagem: preparo.mensagem, postou: false };
  const transporte = portas.enviar ?? TRANSPORTE_BLOQUEADO;
  if (!transporte.liberado) return { ok: false, httpStatus: 503, codigo: ENVIO_BLOQUEADO, mensagem: MENSAGEM_ENVIO_BLOQUEADO, postou: false };

  const criada = await portas.criar({ comunicacaoId: ctx.comunicacaoId, canal: ctx.canalComunicacao, modo: preparo.modo, idempotencyKey: preparo.idempotencyKey, fingerprint: preparo.fingerprint, remetenteId: ctx.phoneNumberId, templateId: preparo.templateId });
  if (!criada.ok || !criada.deliveryId) return { ok: false, httpStatus: 500, codigo: 'entrega_nao_criada', mensagem: criada.erro ?? 'não foi possível registrar a entrega; nada foi enviado', postou: false };
  const deliveryId = criada.deliveryId;
  const status = (criada.status ?? 'READY') as EstadoEntrega;
  if (criada.existente === true || !permitePostar(status)) {
    return { ok: true, httpStatus: 200, mensagem: 'esta entrega já foi processada; nenhum novo envio foi feito', postou: false, entrega: { id: deliveryId, status, modo: preparo.modo, jaProcessada: true } };
  }
  if (status === 'READY') {
    const req = await portas.transicionar({ deliveryId, para: 'REQUESTED', origemAtor: 'USER' });
    if (!req.ok) return { ok: false, httpStatus: 500, codigo: 'entrega_nao_solicitada', mensagem: req.erro ?? 'não foi possível marcar a entrega como solicitada; nada foi enviado', postou: false, entrega: { id: deliveryId, status: 'READY', modo: preparo.modo } };
  }

  // ---- fronteira do efeito externo
  let leitura: LeituraRespostaEnvio;
  try { leitura = interpretarRespostaMetaEnvio(await transporte.postar(preparo.requisicao)); }
  catch (e) {
    if (e instanceof ErroCanal && e.codigo === ENVIO_BLOQUEADO) throw e; // transporte fechado: nao mascarar
    const abortou = (e as Error).name === 'AbortError';
    leitura = interpretarRespostaMetaEnvio({ timeout: abortou, rede: !abortou });
  }
  const destino = leitura.status;
  await portas.transicionar({
    deliveryId, para: destino, origemAtor: 'SERVER',
    conversaProviderId: leitura.conversaId, mensagemProviderId: leitura.mensagemId,
    // motivo e sempre texto NOSSO (interpretarRespostaEnvio), nunca payload do provider; ainda assim vai limitado
    statusProvider: leitura.statusProvider, erroCodigo: leitura.erroCodigo, motivoSeguro: leitura.motivo.slice(0, 500),
  });
  return {
    ok: destino === 'ACCEPTED', httpStatus: 200, postou: true, leitura,
    entrega: { id: deliveryId, status: destino, modo: preparo.modo, conversaProviderId: leitura.conversaId, mensagemProviderId: leitura.mensagemId, statusProvider: leitura.statusProvider, erroCodigo: leitura.erroCodigo },
    proximoPasso: destino === 'UNKNOWN' ? 'reconciliar' : destino === 'FAILED' ? 'revisar' : 'confirmado',
  };
}

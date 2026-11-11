/**
 * A GRAVAÇÃO: executa o plano certificado, nesta ordem, e só devolve sucesso
 * do que confirmou.
 *
 * ── O DESENHO, EM UMA FRASE ──────────────────────────────────────────────
 *
 * Duas gravações em subsistemas sem transação comum (evidência no Lead
 * Engine, conversa no Inbox), tornadas seguras por três coisas: ordem fixa
 * (evidência primeiro), a MESMA chave de idempotência nas duas, e um reenvio
 * que COMPLETA em vez de duplicar.
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ────────────────────────────────────────────
 *
 * Não sabe o que é HTTP, não sabe o que é PostgREST e não tem segredo nenhum.
 * As portas são injetadas (`PortasGravacao`): a implementação real está em
 * `formularioPorta.ts` e o smoke em PostgreSQL usa as MESMAS funções de
 * montagem de linha e de argumentos — é isso que impede o adapter de produção
 * e a prova de banco de divergirem.
 *
 * Reusa o que já existia, sem segundo mecanismo: `inbox_ingest` (a porta do
 * Inbox, idempotente no banco) para a conversa e o Octopus Router (0057) para
 * setor, responsável e SLA. Não há fila de follow-up própria, não há segundo
 * roteador e nada aqui promove empresa, cria oportunidade ou envia mensagem.
 *
 * ── ENRIQUECER O CONTATO NÃO É FATAL ─────────────────────────────────────
 *
 * Completar o contato (nome, empresa, telefone, relação `lead`) é
 * CONVERGENTE: roda em qualquer passagem, só preenche o que está vazio e
 * nunca derruba o pedido. Se falhar, a conversa já está visível e a próxima
 * passagem completa — o contrário (derrubar o pedido) faria o reenvio voltar
 * como IDEMPOTENTE e o contato nunca se completaria.
 */
import { descricaoSegura } from '../erroSeguro'
import { planejarGravacao, type EstadoAtual, type PlanoDeGravacao, type ResultadoBorda } from './formularioServidor'
import { canonicoDaSubmissao, observacoesDoLead, pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import { validarIntake } from './leadEngineIntake'
import { prazoUtil } from '../inbox/calendarioComercial'
import { PROVIDER_FORMULARIO, dadosDoContato, deSubmissaoDoSite, type DadosDoContato, type ResumoDaSubmissao } from '../inbox/formularioSite'
import type { MensagemRecebida } from '../inbox/fronteiras'
import { recusaDoIngest, type PortasIngestao, type ResultadoIngest } from '../inbox/ingestaoServidor'
import type { CodigoProvider } from './canais'
import type { RegistroFonte } from './types'

/* ---------------------------------------------------------------
   1 · O que o atendente lê
--------------------------------------------------------------- */

/**
 * Campos da submissão que vão ao Inbox fora do canônico. `leitura` é a
 * leitura técnica que a própria página mostrou a quem preencheu: é contexto
 * que o atendente precisa e que não muda a impressão do payload (o canônico
 * fica como está — mexer nele mudaria o fingerprint de toda submissão).
 */
export const CAMPOS_EXIBIDOS_DO_BRUTO: readonly string[] = Object.freeze(['leitura'])

/**
 * Linhas de `observacoesDoLead` que `textoDaMensagem` já escreve a partir dos
 * campos próprios (`resumo` e `mensagem`). Sem este filtro a conversa mostra
 * a configuração duas vezes e repete a mensagem da pessoa logo abaixo dela.
 */
export const LINHAS_JA_ESCRITAS: readonly string[] = Object.freeze(['Configuração:', 'Mensagem:'])

/**
 * Como a leitura técnica da página entra na conversa.
 *
 * A página do simulador compara o que o visitante digitou com o que a EIFF já
 * executou e mostra um texto automático («vão dentro do que já foi executado»,
 * «acima do já projetado, exige estudo estrutural específico»). Isso é
 * EVIDÊNCIA do que a pessoa viu antes de pedir contato, e por isso vai para a
 * conversa palavra por palavra.
 *
 * O que não pode acontecer é o atendente ler aquilo como parecer da
 * engenharia e repetir ao cliente: nenhum desses textos passou por
 * homologação estrutural. Daí o rótulo — a linha diz de quem é a fala antes
 * de dizer qual é.
 */
export const ROTULO_LEITURA_DA_PAGINA =
  'Mostrado ao visitante pela página (texto automático do site, não é orientação de engenharia da EIFF)'

/** O site de onde a solicitação veio. */
export const ORIGEM_DO_SITE = 'eiff.com.br'

/**
 * De onde a solicitação veio, dito na própria conversa.
 *
 * O canal `PORTAL` e o `meta.formulario` já guardam isso para a máquina, mas
 * quem abre o Inbox lê texto: sem esta linha, a conversa não diz que o pedido
 * entrou por um formulário do site nem qual deles. E o instante fica de fora
 * de propósito — a mensagem já tem data e hora, que a interface mostra no
 * fuso de quem lê, e repetir um instante UTC aqui convidaria a ler o horário
 * errado.
 */
export function linhaDeOrigem(c: { formulario: string }): string {
  return `Origem: formulário "${c.formulario}" do site (${ORIGEM_DO_SITE}).`
}

/** Submissão → o que a conversa mostra. Nome, telefone, e-mail, lugar e o galpão. */
export function resumoParaOInbox(s: SubmissaoFormulario): ResumoDaSubmissao {
  const c = canonicoDaSubmissao(s)
  const lugar = [c.cidade, c.uf].filter((x) => x !== undefined).join('/')
  // `observacoesDoLead` abre com a linha de origem; o resto são as linhas de detalhe,
  // menos as que a própria mensagem já escreve pelos campos `resumo` e `mensagem`.
  const linhas = observacoesDoLead(c).split('\n').slice(1)
    .filter((l) => !LINHAS_JA_ESCRITAS.some((p) => l.startsWith(p)))
  for (const campo of CAMPOS_EXIBIDOS_DO_BRUTO) {
    const v = s.campos[campo]?.trim()
    if (v !== undefined && v !== '') linhas.push(`${ROTULO_LEITURA_DA_PAGINA}: ${v}`)
  }
  linhas.push(linhaDeOrigem(c))
  return {
    ...(c.nome !== undefined ? { nome: c.nome } : {}),
    ...(c.email !== undefined ? { email: c.email } : {}),
    ...(c.telefone !== undefined ? { telefone: c.telefone } : {}),
    ...(c.empresa !== undefined ? { empresa: c.empresa } : {}),
    ...(lugar !== '' ? { cidade: lugar } : {}),
    ...(c.resumo !== undefined ? { resumo: c.resumo } : {}),
    ...(c.mensagem !== undefined ? { mensagem: c.mensagem } : {}),
    linhas,
  }
}

/* ---------------------------------------------------------------
   2 · As linhas que vão ao banco (compartilhadas com a prova)
--------------------------------------------------------------- */

/** Linha de `radar_source_record`: a evidência, PENDING e sem entidade. */
export function linhaDeEvidencia(plano: PlanoDeGravacao, organizacaoId: string): Record<string, unknown> {
  return {
    organization_id: organizacaoId,
    source_id: plano.pedidoIntake.fonteId,
    record_type: plano.pedidoIntake.tipo,
    external_id: plano.externoId,
    payload: plano.pedidoIntake.payload,
    payload_fingerprint: plano.payloadFingerprint,
    // Candidato, nunca conta: enquanto `entity_id` for nulo não existe empresa comercial.
    intake_status: 'PENDING',
    entity_id: null,
    received_at: plano.pedidoIntake.recebidoEm,
    decided_at: null, decided_by: null, decision_reason: null,
  }
}

/* ---------------------------------------------------------------
   3 · As portas
--------------------------------------------------------------- */

/** O que já existe, para um conjunto de submissões. */
export interface EstadoEmLote {
  /** Uma entrada por evidência gravada: id externo e impressão do payload. */
  evidencias: readonly { externoId: string; impressao?: string }[]
  /** Ids externos que já têm conversa. */
  conversas: readonly string[]
  /**
   * O prazo de primeira resposta da conversa de cada submissão. Sem ele, uma
   * submissão que parou entre a conversa e o ajuste do prazo pareceria «já
   * dentro» e a rodada agendada nunca a consertaria.
   */
  prazos?: readonly (EstadoDoPrazo & { externoId: string })[]
}

/* ---------------------------------------------------------------
   3a · A fonte: QUAL origem recebe a evidência
--------------------------------------------------------------- */

/** Tipo da fonte canônica do formulário do site em `radar_source`. */
export const TIPO_DA_FONTE_DO_SITE = 'WEBSITE'
/**
 * O código é o que distingue a fonte do site das outras fontes do MESMO tipo
 * (em produção há duas WEBSITE: `WEBSITE` e `OFFICIAL_COMPANY_SOURCE`). É o
 * código de `FONTES_PADRAO`, único por organização no banco.
 */
export const CODIGO_DA_FONTE_DO_SITE = 'WEBSITE'

/** A linha de `radar_source` que a porta leu, já filtrada pela organização. */
export interface FonteLida { id: string; codigo: string; tipo: string; ativa: boolean }

export type MotivoFonteInvalida = 'fonte_inexistente' | 'fonte_nao_website' | 'fonte_nao_canonica' | 'fonte_inativa'

/**
 * A fonte configurada é a do formulário do site? Fonte de outra organização
 * chega aqui como inexistente: a porta filtra pela organização antes.
 */
export function validarFonte(fonteId: string, f: FonteLida | undefined): { ok: true } | { ok: false; motivo: MotivoFonteInvalida } {
  if (f === undefined || f.id !== fonteId) return { ok: false, motivo: 'fonte_inexistente' }
  if (f.tipo !== TIPO_DA_FONTE_DO_SITE) return { ok: false, motivo: 'fonte_nao_website' }
  if (f.codigo !== CODIGO_DA_FONTE_DO_SITE) return { ok: false, motivo: 'fonte_nao_canonica' }
  if (!f.ativa) return { ok: false, motivo: 'fonte_inativa' }
  return { ok: true }
}

/** Configuração errada, percebida ANTES de qualquer escrita. A borda responde 503. */
export class ErroDeConfiguracao extends Error {
  constructor(readonly motivo: MotivoFonteInvalida | 'fonte_nao_verificada') {
    super(`integração não configurada: ${motivo}`)
    this.name = 'ErroDeConfiguracao'
  }
}

/* ---------------------------------------------------------------
   3b · O prazo de primeira resposta do lead do site
--------------------------------------------------------------- */

/** Minutos ÚTEIS para a primeira resposta a um lead do formulário do site. */
export const PRAZO_PRIMEIRA_RESPOSTA_MIN = 30

/**
 * O vencimento: 30 minutos de expediente a partir do instante ORIGINAL da
 * submissão (o `created_at` do Netlify), nunca do processamento — um lead
 * recuperado uma hora depois chega vencido, e isso é a verdade.
 *
 * Só o caminho do formulário chama isto. Os SLAs dos demais canais continuam
 * sendo as horas corridas de `inbox_config.sla_hours`, intocadas.
 */
export const prazoDoLead = (s: SubmissaoFormulario): string => prazoUtil(s.recebidoEm, PRAZO_PRIMEIRA_RESPOSTA_MIN)

/** O que a conversa da submissão diz hoje sobre o prazo. */
export interface EstadoDoPrazo {
  threadId: string
  /** `sla_first_response_due` atual. */
  venceEm?: string
  /** `sla_first_response_at`: alguém já respondeu. */
  respondidaEm?: string
  /** Falso para conversa resolvida ou fechada. */
  aberta: boolean
  /** `opened_at`: o instante da primeira mensagem da conversa (a RPC abre com o instante da mensagem). */
  abertaEm?: string
}

export type DecisaoDoPrazo =
  | { acao: 'definir'; venceEm: string }
  | { acao: 'manter'; motivo: 'ja_respondida' | 'encerrada' | 'prazo_correto' | 'prazo_anterior_mais_curto' }

/**
 * O prazo da conversa precisa mudar?
 *
 * - já respondida ou encerrada: não se mexe — o SLA já foi cumprido ou não se aplica;
 * - senão, o vencimento CERTO é o menor entre o alvo desta submissão e os 30
 *   minutos úteis contados da ABERTURA da conversa: quando a mesma pessoa manda
 *   um segundo pedido sem resposta ao primeiro, vale o prazo do primeiro;
 * - qualquer outro valor é corrigido, seja maior ou MENOR. «Menor» não é
 *   detalhe: a conversa nasce com as 24 h CORRIDAS da configuração, e para um
 *   lead de sexta à noite isso cai no sábado — antes da segunda-feira que o
 *   calendário comercial manda. Manter «o mais curto» ali marcaria como
 *   vencido, no fim de semana, um lead que ninguém podia ter atendido
 *   (achado da prova T do smoke em PostgreSQL).
 */
export function decidirPrazo(e: EstadoDoPrazo, alvoIso: string): DecisaoDoPrazo {
  if (e.respondidaEm !== undefined) return { acao: 'manter', motivo: 'ja_respondida' }
  if (!e.aberta) return { acao: 'manter', motivo: 'encerrada' }
  const alvo = Date.parse(alvoIso)
  let certo = alvo
  if (e.abertaEm !== undefined && !Number.isNaN(Date.parse(e.abertaEm))) {
    const daAbertura = Date.parse(prazoUtil(e.abertaEm, PRAZO_PRIMEIRA_RESPOSTA_MIN))
    if (daAbertura < certo) certo = daAbertura
  }
  const atual = e.venceEm === undefined ? Number.NaN : Date.parse(e.venceEm)
  if (atual === certo) return { acao: 'manter', motivo: certo < alvo ? 'prazo_anterior_mais_curto' : 'prazo_correto' }
  return { acao: 'definir', venceEm: new Date(certo).toISOString() }
}

export interface ResumoContatoCompletado {
  /** Campos do contato que estavam vazios e foram preenchidos. */
  campos: readonly string[]
  /** Identidades acrescentadas (o telefone, quando ainda não pertencia a ninguém). */
  identidades: number
}

export interface PortasGravacao {
  /** A fonte configurada, lida do banco e já filtrada pela organização. Obrigatória: sem ela nada é gravado. */
  fonte(fonteId: string): Promise<FonteLida | undefined>
  /** O prazo atual da conversa desta submissão (provider + externalMessageId). */
  prazoDaConversa(provider: CodigoProvider, externalMessageId: string): Promise<EstadoDoPrazo | undefined>
  /** Grava o vencimento da primeira resposta e devolve o valor que FICOU no banco — a confirmação. */
  definirPrazo(threadId: string, venceEmIso: string): Promise<string | undefined>
  /** Registros de origem já existentes para esta fonte e este id externo. */
  registrosDaSubmissao(fonteId: string, externoId: string): Promise<readonly RegistroFonte[]>
  /** A conversa desta submissão já existe? (provider + externalMessageId) */
  conversaExiste(provider: CodigoProvider, externalMessageId: string): Promise<boolean>
  /** INSERT em `radar_source_record`. Devolve o id gravado — a confirmação. */
  gravarEvidencia(linha: Record<string, unknown>): Promise<string>
  /** RPC `inbox_ingest` (a porta que já existia). Idempotente no banco. */
  ingerir: PortasIngestao['ingerir']
  /** Octopus Router (0057). Ausente quando a flag está desligada. Nunca lança. */
  rotear?: PortasIngestao['rotear']
  /**
   * Estado de VÁRIAS submissões de uma vez, para a reconciliação agendada
   * saber o que já está dentro sem gastar uma rodada de gravação em cada uma.
   *
   * Não é atalho de regra: quem decide o que pular é o core, com os mesmos
   * dois critérios do plano — evidência com a MESMA impressão (versão nova da
   * submissão não é «já dentro») e conversa existente.
   */
  estadoEmLote?(fonteId: string, provider: CodigoProvider, externoIds: readonly string[]): Promise<EstadoEmLote>
  /** Contato da identidade do canal, para completar em qualquer passagem. */
  contatoDaIdentidade?(canal: string, identificador: string): Promise<string | undefined>
  /** Completa o contato: preenche vazio, nunca sobrescreve. */
  completarContato?(contatoId: string, dados: DadosDoContato): Promise<ResumoContatoCompletado>
  log?(t: Record<string, unknown>): void
}

export interface ResultadoGravacao {
  resultado: ResultadoBorda
  externoId: string
  payloadFingerprint: string
  registroFonteId: string
  threadId?: string
  mensagemId?: string
  contatoId?: string
  novaConversa: boolean
  conversaDuplicada: boolean
  contatoCompletado?: ResumoContatoCompletado
  roteada?: { aplicado: boolean; motivo?: string }
  /** O prazo de primeira resposta que a conversa TEM ao final, conferido no banco. */
  prazo: { venceEm?: string; ajustado: boolean; motivo: string }
  passos: readonly string[]
  porque: string
}

/**
 * `detalhe` é SEMPRE texto seguro: ou uma frase fixa deste arquivo, ou um código devolvido pelo banco, ou a
 * `descricaoSegura` de uma exceção (código + status + operação). Nunca a mensagem bruta de uma exceção — ela
 * pode conter o valor de um cabeçalho (src/core/erroSeguro.ts).
 */
export class ErroDeGravacao extends Error {
  constructor(readonly etapa: 'evidencia' | 'conversa' | 'prazo', readonly detalhe: string) {
    super(`gravação falhou na etapa ${etapa}: ${detalhe}`)
    this.name = 'ErroDeGravacao'
  }
}

/* ---------------------------------------------------------------
   4 · A execução
--------------------------------------------------------------- */

/**
 * Lê o estado, decide pelo core e executa. Lança `ErroDeGravacao` quando uma
 * gravação EXIGIDA não foi confirmada — é o que faz a borda devolver 5xx em
 * vez de um sucesso que não aconteceu.
 */
export async function gravarSubmissao(
  s: SubmissaoFormulario,
  fonteId: string,
  organizacaoId: string,
  portas: PortasGravacao,
): Promise<ResultadoGravacao> {
  // A identidade externa vem antes de qualquer leitura: é por ela que se pergunta
  // ao banco o que já existe. Mesmo cálculo do Lead Engine, sem segunda definição.
  const valido = validarIntake(pedidoDeIntake(s, fonteId))
  if (!valido.ok) throw new ErroDeGravacao('evidencia', `intake inválido: ${valido.motivos.join(', ')}`)
  const externoId = valido.identidade.externoId

  // 0) a fonte, ANTES de qualquer leitura de estado e de qualquer escrita: evidência
  //    gravada na fonte errada é imutável, não tem conserto depois.
  let fonteLida: FonteLida | undefined
  try { fonteLida = await portas.fonte(fonteId) } catch { throw new ErroDeConfiguracao('fonte_nao_verificada') }
  const fonteOk = validarFonte(fonteId, fonteLida)
  if (!fonteOk.ok) throw new ErroDeConfiguracao(fonteOk.motivo)
  // O alvo do prazo também vem antes: instante ilegível tem de falhar sem ter gravado nada.
  let alvoDoPrazo: string
  try { alvoDoPrazo = prazoDoLead(s) } catch (e) { throw new ErroDeGravacao('prazo', descricaoSegura(e)) }

  const registros = await portas.registrosDaSubmissao(fonteId, externoId)
  const conversaExiste = await portas.conversaExiste(PROVIDER_FORMULARIO, externoId)
  const estado: EstadoAtual = { registros, conversaExiste }
  const plano = planejarGravacao(s, fonteId, estado)

  // 1) evidência. Quando o plano não a grava, ela já existe: o id vem do registro
  //    de mesma impressão — assim o rastro da conversa aponta para a evidência REAL,
  //    nunca para um marcador.
  let registroFonteId: string
  if (plano.passos.includes('GRAVAR_EVIDENCIA')) {
    try {
      registroFonteId = await portas.gravarEvidencia(linhaDeEvidencia(plano, organizacaoId))
    } catch (e) {
      throw new ErroDeGravacao('evidencia', descricaoSegura(e))
    }
    if (registroFonteId === undefined || registroFonteId === '') {
      throw new ErroDeGravacao('evidencia', 'insert sem id na volta: gravação não confirmada')
    }
  } else {
    const mesma = registros.find((r) => r.payloadFingerprint === plano.payloadFingerprint)
    registroFonteId = mesma?.id ?? registros[0]?.id ?? ''
    if (registroFonteId === '') throw new ErroDeGravacao('evidencia', 'plano sem gravação e sem evidência existente')
  }

  const resumo = resumoParaOInbox(s)
  const mensagem = deSubmissaoDoSite({
    externalMessageId: plano.externoId,
    em: s.recebidoEm,
    rastro: { registroFonteId, payloadFingerprint: plano.payloadFingerprint, formulario: canonicoDaSubmissao(s).formulario },
    resumo,
  })
  if ('erro' in mensagem) throw new ErroDeGravacao('conversa', mensagem.erro)

  // 2) conversa
  let ingest: ResultadoIngest | undefined
  if (plano.passos.includes('GRAVAR_CONVERSA')) {
    try {
      ingest = await portas.ingerir(pedidoDaMensagem(organizacaoId, mensagem))
    } catch (e) {
      throw new ErroDeGravacao('conversa', descricaoSegura(e))
    }
    // `ingest.erro` vem da RPC (ou de quem implementa a porta): so sai um codigo do catalogo fechado. O texto
    // recebido nunca chega ao detalhe, que a borda e a reconciliacao registram em log.
    if (!ingest.ok) throw new ErroDeGravacao('conversa', `rpc recusou: ${recusaDoIngest(ingest.erro)}`)
    if (ingest.threadId === undefined) throw new ErroDeGravacao('conversa', 'rpc sem thread na volta: gravação não confirmada')
  }

  const r: ResultadoGravacao = {
    resultado: plano.resultado,
    externoId: plano.externoId,
    payloadFingerprint: plano.payloadFingerprint,
    registroFonteId,
    ...(ingest?.threadId !== undefined ? { threadId: ingest.threadId } : {}),
    ...(ingest?.messageId !== undefined ? { mensagemId: ingest.messageId } : {}),
    ...(ingest?.contactId !== undefined ? { contatoId: ingest.contactId } : {}),
    novaConversa: ingest?.novaThread === true,
    conversaDuplicada: ingest?.duplicada === true,
    prazo: { ajustado: false, motivo: 'pendente' },
    passos: plano.passos,
    porque: plano.porque,
  }

  // 2b) o prazo de primeira resposta. EXIGIDO e CONVERGENTE: roda em toda passagem
  //     (inclusive no reenvio IDEMPOTENTE), e sem o prazo certo confirmado no banco
  //     não há sucesso — a conversa nasce com as 24 h corridas da configuração, e
  //     devolver 200 nesse estado esconderia um lead com prazo errado. A falha vira
  //     5xx, o reenvio volta aqui e conserta, sem duplicar conversa nem evidência.
  r.prazo = await ajustarPrazo(portas, plano.externoId, alvoDoPrazo)

  // 3) o contato, com o que a submissão trouxe. Convergente e nunca fatal.
  const contatoId = r.contatoId ?? await contatoDaConversa(portas, mensagem)
  if (contatoId !== undefined && portas.completarContato !== undefined) {
    try {
      r.contatoCompletado = await portas.completarContato(contatoId, dadosDoContato(resumo))
      r.contatoId = contatoId
    } catch (e) {
      portas.log?.({ evento: 'formulario_contato', outcome: 'falhou', motivo: descricaoSegura(e) })
    }
  }

  // 4) setor, responsável e SLA pelo roteador que já existe. Nunca lança.
  if (r.threadId !== undefined && r.mensagemId !== undefined && portas.rotear !== undefined) {
    const rot = await portas.rotear(r.threadId, r.mensagemId)
    r.roteada = { aplicado: rot.aplicado, ...(rot.motivo !== undefined ? { motivo: rot.motivo } : {}) }
  }
  return r
}

async function ajustarPrazo(portas: PortasGravacao, externoId: string, alvoIso: string): Promise<ResultadoGravacao['prazo']> {
  let estado: EstadoDoPrazo | undefined
  try { estado = await portas.prazoDaConversa(PROVIDER_FORMULARIO, externoId) } catch (e) {
    throw new ErroDeGravacao('prazo', descricaoSegura(e))
  }
  if (estado === undefined) throw new ErroDeGravacao('prazo', 'conversa da submissão não encontrada para conferir o prazo')
  const decisao = decidirPrazo(estado, alvoIso)
  if (decisao.acao === 'manter') {
    return { ...(estado.venceEm !== undefined ? { venceEm: estado.venceEm } : {}), ajustado: false, motivo: decisao.motivo }
  }
  let ficou: string | undefined
  try { ficou = await portas.definirPrazo(estado.threadId, decisao.venceEm) } catch (e) {
    throw new ErroDeGravacao('prazo', descricaoSegura(e))
  }
  if (ficou === undefined || Date.parse(ficou) !== Date.parse(decisao.venceEm)) {
    throw new ErroDeGravacao('prazo', 'vencimento não confirmado pelo banco')
  }
  return { venceEm: decisao.venceEm, ajustado: true, motivo: 'definido' }
}

async function contatoDaConversa(portas: PortasGravacao, m: MensagemRecebida): Promise<string | undefined> {
  if (portas.contatoDaIdentidade === undefined) return undefined
  try { return await portas.contatoDaIdentidade(m.identidade.canal, m.identidade.identificador) } catch { return undefined }
}

/** Mensagem do Inbox → argumentos da ingestão (o mesmo formato do caminho da Central). */
export function pedidoDaMensagem(organizacaoId: string, m: MensagemRecebida): Parameters<PortasIngestao['ingerir']>[0] {
  return {
    organizationId: organizacaoId, provider: m.provider, canal: m.canal, contexto: m.contexto,
    identificador: m.identidade.identificador, nomeInformado: m.identidade.nomeInformado,
    externalMessageId: m.externalMessageId, texto: m.texto, tipo: m.tipo, em: m.em,
    anexos: [], meta: m.meta ?? {},
  }
}

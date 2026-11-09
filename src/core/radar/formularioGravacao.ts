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
import { planejarGravacao, type EstadoAtual, type PlanoDeGravacao, type ResultadoBorda } from './formularioServidor'
import { canonicoDaSubmissao, observacoesDoLead, pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import { validarIntake } from './leadEngineIntake'
import { PROVIDER_FORMULARIO, dadosDoContato, deSubmissaoDoSite, type DadosDoContato, type ResumoDaSubmissao } from '../inbox/formularioSite'
import type { MensagemRecebida } from '../inbox/fronteiras'
import type { PortasIngestao, ResultadoIngest } from '../inbox/ingestaoServidor'
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

/** Submissão → o que a conversa mostra. Nome, telefone, e-mail, lugar e o galpão. */
export function resumoParaOInbox(s: SubmissaoFormulario): ResumoDaSubmissao {
  const c = canonicoDaSubmissao(s)
  const lugar = [c.cidade, c.uf].filter((x) => x !== undefined).join('/')
  // `observacoesDoLead` abre com a linha de origem; o resto são as linhas de detalhe.
  const linhas = observacoesDoLead(c).split('\n').slice(1)
  for (const campo of CAMPOS_EXIBIDOS_DO_BRUTO) {
    const v = s.campos[campo]?.trim()
    if (v !== undefined && v !== '') linhas.push(`Leitura da página: ${v}`)
  }
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

export interface ResumoContatoCompletado {
  /** Campos do contato que estavam vazios e foram preenchidos. */
  campos: readonly string[]
  /** Identidades acrescentadas (o telefone, quando ainda não pertencia a ninguém). */
  identidades: number
}

export interface PortasGravacao {
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
  passos: readonly string[]
  porque: string
}

export class ErroDeGravacao extends Error {
  constructor(readonly etapa: 'evidencia' | 'conversa', readonly detalhe: string) {
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
      throw new ErroDeGravacao('evidencia', (e as Error).message ?? 'erro')
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
      throw new ErroDeGravacao('conversa', (e as Error).message ?? 'erro')
    }
    if (!ingest.ok) throw new ErroDeGravacao('conversa', ingest.erro ?? 'rpc recusou')
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
    passos: plano.passos,
    porque: plano.porque,
  }

  // 3) o contato, com o que a submissão trouxe. Convergente e nunca fatal.
  const contatoId = r.contatoId ?? await contatoDaConversa(portas, mensagem)
  if (contatoId !== undefined && portas.completarContato !== undefined) {
    try {
      r.contatoCompletado = await portas.completarContato(contatoId, dadosDoContato(resumo))
      r.contatoId = contatoId
    } catch (e) {
      portas.log?.({ evento: 'formulario_contato', outcome: 'falhou', motivo: (e as Error).message ?? 'erro' })
    }
  }

  // 4) setor, responsável e SLA pelo roteador que já existe. Nunca lança.
  if (r.threadId !== undefined && r.mensagemId !== undefined && portas.rotear !== undefined) {
    const rot = await portas.rotear(r.threadId, r.mensagemId)
    r.roteada = { aplicado: rot.aplicado, ...(rot.motivo !== undefined ? { motivo: rot.motivo } : {}) }
  }
  return r
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

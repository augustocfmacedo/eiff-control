/**
 * O que cumpre o SLA de primeira resposta — e o que só parecia cumprir.
 * Regra pura; a porta (store) tem prova própria em `src/data/inbox.contato.store.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  MEIOS_CONTATO, NOME_SITUACAO_RESPOSTA, RESUMO_MINIMO, aoResponder, contatoDaMensagem, contatoDuplicado, ehRespostaEfetiva, estadoSla,
  metaDoContato, origemPrimeiraResposta, primeiroContatoEfetivo, situacaoPrimeiraResposta, validarContato,
  type InboxMessage, type InboxThread, type PedidoDeContato,
} from './index'
import { prazoDoLead } from '../radar/formularioGravacao'

const ABERTA = '2026-11-10T13:00:00.000Z'
const VENCE = '2026-11-10T13:30:00.000Z'
const AGORA = '2026-11-10T15:00:00.000Z'

const thread = (extra: Partial<InboxThread> = {}): InboxThread => ({
  id: 'T1', canal: 'PORTAL', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'C1', assunto: 'Galpão', status: 'ATRIBUIDA', prioridade: 'Normal', nivel: 'C',
  participantes: [], labels: [], origem: 'MANUAL', sla: { primeiraRespostaAte: VENCE }, abertaEm: ABERTA, ultimaMensagemEm: ABERTA, ultimaInboundEm: ABERTA, ...extra,
} as InboxThread)

const msg = (extra: Partial<InboxMessage>): InboxMessage => ({
  id: 'M1', threadId: 'T1', provider: 'MANUAL', direcao: 'outbound', tipo: 'texto', autor: { tipo: 'usuario', id: 'u1', nome: 'Ana' }, texto: 'Falei com a cliente.', anexos: [], em: '2026-11-10T13:20:00.000Z', ...extra,
})

const pedido = (extra: Partial<PedidoDeContato> = {}): PedidoDeContato => ({ resultado: 'realizado', meio: 'telefone', em: '2026-11-10T13:20:00.000Z', resumo: 'Falei com a cliente; pediu proposta.', ...extra })

describe('primeira resposta · o que é resposta efetiva', () => {
  it('rascunho (entrega registrada), falha, nota interna e mensagem recebida NÃO são resposta efetiva', () => {
    expect(ehRespostaEfetiva(msg({ entrega: 'registrada' }))).toBe(false)
    expect(ehRespostaEfetiva(msg({ entrega: 'falhou' }))).toBe(false)
    expect(ehRespostaEfetiva(msg({ entrega: undefined }))).toBe(false)
    expect(ehRespostaEfetiva(msg({ direcao: 'interna', tipo: 'nota' }))).toBe(false)
    expect(ehRespostaEfetiva(msg({ direcao: 'inbound', entrega: 'entregue' }))).toBe(false)
  })

  it('contato declarado como realizado e envio feito por canal SÃO', () => {
    expect(ehRespostaEfetiva(msg({ entrega: 'entregue', meta: metaDoContato({ resultado: 'realizado', meio: 'telefone' }) }))).toBe(true)
    for (const entrega of ['enviada', 'entregue', 'lida'] as const) expect(ehRespostaEfetiva(msg({ entrega })), entrega).toBe(true)
  })

  it('tentativa sem sucesso nunca é resposta efetiva, nem se alguém a gravar como mensagem de saída', () => {
    const tentativa = msg({ direcao: 'interna', tipo: 'nota', meta: metaDoContato({ resultado: 'tentativa', meio: 'telefone' }) })
    expect(contatoDaMensagem(tentativa)).toEqual({ resultado: 'tentativa', meio: 'telefone' })
    expect(ehRespostaEfetiva(tentativa)).toBe(false)
    expect(ehRespostaEfetiva(msg({ entrega: 'registrada', meta: metaDoContato({ resultado: 'tentativa', meio: 'telefone' }) }))).toBe(false)
  })

  it('meta estranha não vira contato: catálogo fechado', () => {
    expect(contatoDaMensagem(msg({ meta: { contato: 'sim' } }))).toBeUndefined()
    expect(contatoDaMensagem(msg({ meta: { contato: 'realizado', contatoMeio: 'pombo' } }))).toEqual({ resultado: 'realizado' })
    expect(contatoDaMensagem(msg({}))).toBeUndefined()
  })
})

describe('primeira resposta · validação do contato declarado', () => {
  it('aceita os quatro meios', () => {
    expect([...MEIOS_CONTATO]).toEqual(['telefone', 'email', 'whatsapp_externo', 'presencial'])
    for (const meio of MEIOS_CONTATO) expect(validarContato(pedido({ meio }), thread(), AGORA), meio).toEqual([])
  })

  it('recusa meio fora do catálogo, resumo curto, instante ilegível, futuro e anterior à abertura', () => {
    expect(validarContato(pedido({ meio: 'fax' as never }), thread(), AGORA).join(' ')).toMatch(/meio/)
    expect(validarContato(pedido({ resumo: 'ok' }), thread(), AGORA).join(' ')).toMatch(new RegExp(String(RESUMO_MINIMO)))
    expect(validarContato(pedido({ em: '' }), thread(), AGORA).join(' ')).toMatch(/data e a hora/)
    expect(validarContato(pedido({ em: '2026-11-10T16:00:00.000Z' }), thread(), AGORA).join(' ')).toMatch(/futuro/)
    expect(validarContato(pedido({ em: '2026-11-10T12:59:00.000Z' }), thread(), AGORA).join(' ')).toMatch(/anterior à abertura/)
  })

  it('tolera o relógio do navegador um pouco adiantado, e não mais que isso', () => {
    expect(validarContato(pedido({ em: '2026-11-10T15:01:30.000Z' }), thread(), AGORA)).toEqual([])
    expect(validarContato(pedido({ em: '2026-11-10T15:03:00.000Z' }), thread(), AGORA).join(' ')).toMatch(/futuro/)
  })

  it('conversa fechada exige reabrir; resultado fora do catálogo é recusado', () => {
    expect(validarContato(pedido(), thread({ status: 'FECHADA' }), AGORA).join(' ')).toMatch(/reabra/)
    expect(validarContato(pedido({ resultado: 'talvez' as never }), thread(), AGORA).join(' ')).toMatch(/realizado ou/)
  })

  it('duplicado é o mesmo autor, meio, instante, resultado e resumo na mesma conversa', () => {
    const gravada = msg({ entrega: 'entregue', texto: pedido().resumo, meta: metaDoContato(pedido()) })
    expect(contatoDuplicado([gravada], 'T1', 'u1', pedido())?.id).toBe('M1')
    expect(contatoDuplicado([gravada], 'T1', 'u2', pedido())).toBeUndefined()
    expect(contatoDuplicado([gravada], 'T1', 'u1', pedido({ meio: 'email' }))).toBeUndefined()
    expect(contatoDuplicado([gravada], 'T1', 'u1', pedido({ em: '2026-11-10T13:21:00.000Z' }))).toBeUndefined()
    expect(contatoDuplicado([gravada], 'T2', 'u1', pedido())).toBeUndefined()
  })
})

describe('primeira resposta · a situação', () => {
  it('as quatro situações que a tela distingue, mais «sem SLA»', () => {
    expect(situacaoPrimeiraResposta(thread())).toBe('aguardando')
    expect(situacaoPrimeiraResposta(thread({ sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: '2026-11-10T13:20:00.000Z' } }))).toBe('respondida_no_prazo')
    expect(situacaoPrimeiraResposta(thread({ sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: '2026-11-10T14:10:00.000Z' } }))).toBe('respondida_fora_do_prazo')
    expect(situacaoPrimeiraResposta(thread({ status: 'RESOLVIDA' }))).toBe('encerrada_sem_resposta')
    expect(situacaoPrimeiraResposta(thread({ status: 'FECHADA' }))).toBe('encerrada_sem_resposta')
    expect(situacaoPrimeiraResposta(thread({ sla: undefined }))).toBe('sem_sla')
    expect(Object.keys(NOME_SITUACAO_RESPOSTA)).toHaveLength(5)
  })

  it('respondida exatamente no vencimento está no prazo; um segundo depois, fora', () => {
    expect(situacaoPrimeiraResposta(thread({ sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: VENCE } }))).toBe('respondida_no_prazo')
    expect(situacaoPrimeiraResposta(thread({ sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: '2026-11-10T13:30:01.000Z' } }))).toBe('respondida_fora_do_prazo')
  })

  it('encerrar depois de responder continua «respondida»: o encerramento não apaga a resposta', () => {
    const t = thread({ status: 'FECHADA', sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: '2026-11-10T13:20:00.000Z' } })
    expect(situacaoPrimeiraResposta(t)).toBe('respondida_no_prazo')
    expect(estadoSla(t, AGORA)).toBe('cumprido')
  })

  it('aguardando continua sendo medido contra o prazo: vencido enquanto ninguém fala com a pessoa', () => {
    expect(estadoSla(thread(), AGORA)).toBe('vencido')
    expect(estadoSla(aoResponder(thread(), AGORA, false), AGORA)).toBe('vencido') // rascunho não tira do vermelho
    expect(estadoSla(aoResponder(thread(), '2026-11-10T14:10:00.000Z', true), AGORA)).toBe('atrasada')
    expect(estadoSla(aoResponder(thread(), '2026-11-10T13:20:00.000Z', true), AGORA)).toBe('cumprido')
  })

  it('reabertura (mensagem nova do contato) não apaga a primeira resposta já registrada', () => {
    const respondida = aoResponder(thread(), '2026-11-10T13:20:00.000Z', true)
    const reaberta: InboxThread = { ...respondida, status: 'EM_ATENDIMENTO', resolvidaEm: undefined }
    expect(reaberta.sla?.primeiraRespostaEm).toBe('2026-11-10T13:20:00.000Z')
    expect(aoResponder(reaberta, '2026-11-12T10:00:00.000Z', true).sla?.primeiraRespostaEm).toBe('2026-11-10T13:20:00.000Z')
  })
})

describe('primeira resposta · origem do registro e histórico', () => {
  const respondida = thread({ sla: { primeiraRespostaAte: VENCE, primeiraRespostaEm: '2026-11-10T13:20:00.000Z' } })

  it('registro feito quando o rascunho ainda cumpria o SLA aparece como «anterior à regra», sem ser reclassificado', () => {
    const rascunhoAntigo = msg({ entrega: 'registrada' })
    expect(origemPrimeiraResposta(respondida, [rascunhoAntigo])).toBe('anterior_a_regra')
    // a situação NÃO muda: o dado existente fica como está
    expect(situacaoPrimeiraResposta(respondida)).toBe('respondida_no_prazo')
  })

  it('contato declarado e envio por canal são reconhecidos; sem resposta não há origem', () => {
    expect(origemPrimeiraResposta(respondida, [msg({ entrega: 'entregue', meta: metaDoContato({ resultado: 'realizado', meio: 'email' }) })])).toBe('contato_declarado')
    expect(origemPrimeiraResposta(respondida, [msg({ entrega: 'enviada' })])).toBe('envio_por_canal')
    expect(origemPrimeiraResposta(thread(), [])).toBeUndefined()
  })

  it('o primeiro contato efetivo é o mais antigo pelo instante DECLARADO, não pela ordem de registro', () => {
    const tarde = msg({ id: 'M-tarde', em: '2026-11-10T14:40:00.000Z', entrega: 'entregue', meta: metaDoContato({ resultado: 'realizado', meio: 'telefone' }) })
    const cedo = msg({ id: 'M-cedo', em: '2026-11-10T13:10:00.000Z', entrega: 'entregue', meta: metaDoContato({ resultado: 'realizado', meio: 'email' }) })
    const rascunho = msg({ id: 'M-rascunho', em: '2026-11-10T13:05:00.000Z', entrega: 'registrada' })
    expect(primeiroContatoEfetivo(thread(), [tarde, rascunho, cedo])?.id).toBe('M-cedo')
  })
})

describe('primeira resposta · lead do site com 30 minutos úteis', () => {
  // submissão de sexta 13/11/2026 às 17:50 em São Paulo: o prazo útil vence segunda 16/11 às 08:20 (11:20 UTC)
  const SUBMETIDA = '2026-11-13T20:50:00.000Z'
  const vence = prazoDoLead({ id: 'nf-1', formulario: 'simular-galpao', recebidoEm: SUBMETIDA, campos: { email: 'a@exemplo.invalido' } })
  const lead = () => thread({ abertaEm: SUBMETIDA, ultimaMensagemEm: SUBMETIDA, sla: { primeiraRespostaAte: vence } })

  it('o vencimento do lead do site continua sendo o do calendário comercial', () => {
    expect(vence).toBe('2026-11-16T11:20:00.000Z')
  })

  it('rascunho no sábado não cumpre; contato na segunda às 08:10 está no prazo; às 08:25, fora', () => {
    expect(situacaoPrimeiraResposta(aoResponder(lead(), '2026-11-14T15:00:00.000Z', false))).toBe('aguardando')
    expect(situacaoPrimeiraResposta(aoResponder(lead(), '2026-11-16T11:10:00.000Z', true))).toBe('respondida_no_prazo')
    expect(situacaoPrimeiraResposta(aoResponder(lead(), '2026-11-16T11:25:00.000Z', true))).toBe('respondida_fora_do_prazo')
  })

  it('contato declarado é validado contra a abertura da conversa do lead, não contra o expediente', () => {
    // a pessoa pode ter ligado no sábado: é contato de verdade, e está dentro do prazo
    expect(validarContato(pedido({ em: '2026-11-14T14:00:00.000Z' }), lead(), '2026-11-16T12:00:00.000Z')).toEqual([])
    expect(situacaoPrimeiraResposta(aoResponder(lead(), '2026-11-14T14:00:00.000Z', true))).toBe('respondida_no_prazo')
  })
})

// E-mail comercial, etapa E4: o que a tela mostra. A tela não decide nada — estes testes prendem as leituras.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chamarEmailComercial } from '../../data/emailComercial'
import { ERROS_EMAIL } from './emailEnvio'
import { NOME_SITUACAO_EMAIL, chaveDoConteudo, ehMensagemDeEmail, entregaSemDesfecho, lerDisponibilidade, lerRespostaDoEnvio, situacaoDoEmail } from './emailTela'
import { contatoDaMensagem, ehRespostaEfetiva } from './primeiraResposta'
import type { InboxMessage } from './tipos'

const msg = (p: Partial<InboxMessage> & { provider?: string }): InboxMessage => ({ id: 'm1', threadId: 't1', provider: 'MANUAL', direcao: 'outbound', tipo: 'texto', autor: { tipo: 'usuario', nome: 'Ana' }, texto: 'x', anexos: [], em: '2026-11-11T18:00:00.000Z', ...p } as InboxMessage)
const email = (entrega: InboxMessage['entrega'], estado: string, extra: Partial<InboxMessage> = {}) => msg({ provider: 'GOOGLE_WORKSPACE', entrega, meta: { canalSaida: 'EMAIL', entregaId: 'e1', entregaEstado: estado }, ...extra })

describe('a mensagem de e-mail na conversa: rascunho, tentativa e enviada nunca se confundem', () => {
  it('cada estado gravado pelo servidor tem a sua leitura', () => {
    expect(situacaoDoEmail(email('registrada', 'READY'))).toBe('preparado')
    expect(situacaoDoEmail(email('registrada', 'REQUESTED'))).toBe('enviando')
    expect(situacaoDoEmail(email('registrada', 'UNKNOWN'))).toBe('sem_confirmacao')
    expect(situacaoDoEmail(email('falhou', 'FAILED'))).toBe('falhou')
    expect(situacaoDoEmail(email('enviada', 'ACCEPTED'))).toBe('enviado')
  })
  it('só `enviada` é resposta efetiva (SLA); preparado, em envio, sem confirmação e falha não são', () => {
    expect(ehRespostaEfetiva(email('enviada', 'ACCEPTED'))).toBe(true)
    for (const m of [email('registrada', 'READY'), email('registrada', 'REQUESTED'), email('registrada', 'UNKNOWN'), email('falhou', 'FAILED')]) expect(ehRespostaEfetiva(m)).toBe(false)
  })
  it('mensagens de outros tipos não são e-mail: rascunho manual, contato declarado, tentativa, nota e recebida', () => {
    const rascunho = msg({ entrega: 'registrada' })
    const contato = msg({ entrega: 'entregue', meta: { contato: 'realizado', contatoMeio: 'email' } })
    const tentativa = msg({ direcao: 'interna', tipo: 'nota', meta: { contato: 'tentativa', contatoMeio: 'telefone' } })
    for (const m of [rascunho, contato, tentativa, msg({ direcao: 'interna', tipo: 'nota' }), msg({ direcao: 'inbound' }), msg({ provider: 'GOOGLE_WORKSPACE', direcao: 'inbound' })]) {
      expect(ehMensagemDeEmail(m)).toBe(false)
      expect(situacaoDoEmail(m)).toBeUndefined()
    }
    // e o contato declarado por e-mail continua sendo contato declarado, não «e-mail enviado pelo sistema»
    expect(contatoDaMensagem(contato)?.resultado).toBe('realizado')
  })
  it('os rótulos dizem com todas as letras o que NÃO foi enviado', () => {
    expect(NOME_SITUACAO_EMAIL.preparado).toContain('não enviado')
    expect(NOME_SITUACAO_EMAIL.falhou).toContain('NÃO enviado')
    expect(NOME_SITUACAO_EMAIL.sem_confirmacao).toContain('sem confirmação')
    expect(NOME_SITUACAO_EMAIL.enviado).toBe('E-mail enviado')
  })
})

describe('entrega sem desfecho da conversa', () => {
  it('acha a entrega pendente da conversa pedida e ignora as terminadas e as de outras conversas', () => {
    const lista = [email('enviada', 'ACCEPTED', { id: 'a' }), email('falhou', 'FAILED', { id: 'b' }), email('registrada', 'UNKNOWN', { id: 'c', threadId: 't2' }), msg({ id: 'd', entrega: 'registrada' })]
    expect(entregaSemDesfecho(lista, 't1')).toBeUndefined()
    expect(entregaSemDesfecho(lista, 't2')).toEqual({ entregaId: 'e1', mensagemId: 'c', situacao: 'sem_confirmacao', em: '2026-11-11T18:00:00.000Z' })
    expect(entregaSemDesfecho([email('registrada', 'READY')], 't1')?.situacao).toBe('preparado')
  })
  it('sem o id da entrega não há o que reconciliar', () => {
    expect(entregaSemDesfecho([msg({ provider: 'GOOGLE_WORKSPACE', entrega: 'registrada', meta: { entregaEstado: 'UNKNOWN' } })], 't1')).toBeUndefined()
  })
})

describe('disponibilidade: a tela nunca presume que pode enviar', () => {
  it('só está disponível com 200, disponivel = true, remetente e destinatário', () => {
    expect(lerDisponibilidade(200, { disponivel: true, modo: 'ativo', remetente: 'contato@eiff.com.br', destinatario: 'm•••@x.com' })).toEqual({ disponivel: true, modo: 'ativo', remetente: 'contato@eiff.com.br', destinatario: 'm•••@x.com' })
    expect(lerDisponibilidade(200, { disponivel: true, remetente: 'contato@eiff.com.br' }).disponivel).toBe(false)
    expect(lerDisponibilidade(200, { disponivel: 'true', remetente: 'a', destinatario: 'b' }).disponivel).toBe(false)
    expect(lerDisponibilidade(200, { disponivel: false, motivo: 'envio_desligado', mensagem: 'O envio de e-mail está desligado.' })).toMatchObject({ disponivel: false, motivo: 'envio_desligado' })
  })
  it('erro, resposta vazia, HTML de 404 (função não publicada) e falha de rede são indisponível', () => {
    for (const [status, corpo] of [[403, { erro: 'sem_permissao', mensagem: 'x' }], [404, null], [500, 'texto'], [0, { erro: 'sem_resposta' }], [401, {}]] as const) expect(lerDisponibilidade(status, corpo).disponivel).toBe(false)
    expect(lerDisponibilidade(404, null).mensagem).toContain('não está disponível')
  })
})

describe('desfecho do envio em linguagem de gente', () => {
  it('aceito: diz que o Google confirmou e se contou como primeira resposta', () => {
    const a = lerRespostaDoEnvio(200, { estado: 'ACCEPTED', entregaId: 'e1', enviadaEm: '2026-11-11T18:00:00.000Z', cumpriuPrimeiraResposta: true })
    expect(a).toMatchObject({ desfecho: 'enviado', entregaId: 'e1', cumpriuPrimeiraResposta: true, recarregar: true })
    expect(a.titulo).toMatch(/^E-mail enviado às \d\d:\d\d$/)
    expect(a.texto).toContain('O Google confirmou o aceite')
    expect(a.texto).toContain('primeira resposta')
    expect(lerRespostaDoEnvio(200, { estado: 'ACCEPTED', cumpriuPrimeiraResposta: false }).texto).not.toContain('primeira resposta')
    expect(lerRespostaDoEnvio(200, { estado: 'ACCEPTED', reconciliada: true }).texto).toContain('conferido por você')
  })
  it('desconhecido: manda NÃO reenviar e conferir a pasta Enviados', () => {
    const a = lerRespostaDoEnvio(200, { estado: 'UNKNOWN', entregaId: 'e1' })
    expect(a).toMatchObject({ desfecho: 'desconhecido', entregaId: 'e1', recarregar: true })
    expect(a.texto).toContain('Não envie de novo')
    expect(a.texto).toContain('Enviados')
  })
  it('em andamento (pedido repetido) também não oferece reenvio', () => {
    expect(lerRespostaDoEnvio(200, { estado: 'EM_ANDAMENTO', entregaId: 'e1' })).toMatchObject({ desfecho: 'em_andamento', recarregar: true })
  })
  it('cada erro do catálogo vira a mensagem do catálogo; o que não é do catálogo vira texto genérico', () => {
    for (const [codigo, e] of Object.entries(ERROS_EMAIL)) {
      if (codigo === 'pedido_invalido') continue
      const a = lerRespostaDoEnvio(e.http, { erro: codigo, mensagem: 'TEXTO QUE NÃO DEVE APARECER' })
      expect(a).toMatchObject({ desfecho: 'nao_enviado', texto: e.mensagem })
    }
    const estranho = lerRespostaDoEnvio(500, { erro: 'Invalid To header from Google', mensagem: 'stack trace' })
    expect(estranho.texto).toBe('Não foi possível concluir o envio. Nada foi enviado.')
    expect(lerRespostaDoEnvio(502, null).desfecho).toBe('nao_enviado')
  })
  it('conteúdo inválido mostra a recusa específica; falha com entrega FAILED pede recarga', () => {
    expect(lerRespostaDoEnvio(400, { erro: 'pedido_invalido', mensagem: 'Escreva o assunto do e-mail.' }).texto).toBe('Escreva o assunto do e-mail.')
    expect(lerRespostaDoEnvio(502, { erro: 'provedor_recusou', estado: 'FAILED', entregaId: 'e1' })).toMatchObject({ recarregar: true, entregaId: 'e1' })
    expect(lerRespostaDoEnvio(403, { erro: 'envio_desligado' }).recarregar).toBe(false)
    expect(lerRespostaDoEnvio(200, { estado: 'FAILED', reconciliada: true }).titulo).toBe('Registrado como não enviado')
  })
  it('a chave do conteúdo muda com conversa, assunto ou corpo e ignora espaços nas pontas e CRLF', () => {
    const base = chaveDoConteudo('t1', 'Oi', 'a\nb')
    expect(chaveDoConteudo('t1', ' Oi ', 'a\r\nb\n')).toBe(base)
    for (const outra of [chaveDoConteudo('t2', 'Oi', 'a\nb'), chaveDoConteudo('t1', 'Oi!', 'a\nb'), chaveDoConteudo('t1', 'Oi', 'a\nc')]) expect(outra).not.toBe(base)
  })
})

describe('cliente do navegador e fronteiras da tela', () => {
  it('sem sessão não chama a função (modo local e testes não têm token)', async () => {
    let chamou = 0
    const r = await chamarEmailComercial({ acao: 'preparar', threadId: 't' }, (async () => { chamou += 1; return new Response('{}') }) as unknown as typeof fetch)
    expect(r).toEqual({ status: 401, corpo: { erro: 'nao_autenticado' } })
    expect(chamou).toBe(0)
  })
  const raiz = path.resolve(__dirname, '../../..')
  const ler = (f: string) => fs.readFileSync(path.join(raiz, f), 'utf8')
  it('o pedido do navegador não tem campo de destinatário nem de remetente', () => {
    const cliente = ler('src/data/emailComercial.ts')
    const tipo = cliente.slice(cliente.indexOf('export type PedidoEmailComercial'), cliente.indexOf('/** Chave pública'))
    expect(tipo).not.toMatch(/\b(para|to|de|from|remetente|destinatario|cc|bcc)\s*[:?]/i)
    expect(cliente).not.toMatch(/emailPorta|googleapis|SERVICE_ROLE|refresh/i)
  })
  it('a tela de envio tem os dois gestos, não oferece reenvio no desconhecido e não fala com o Google', () => {
    const tela = ler('src/ui/EnvioEmail.tsx')
    expect(tela).toContain('Enviar e-mail')
    expect(tela).toContain('Enviar agora')
    expect(tela).toContain('Encontrei em Enviados')
    expect(tela).toContain('Não foi enviado')
    expect(tela).not.toMatch(/emailPorta|googleapis|fetch\(/)
    expect(tela).not.toMatch(/Tentar de novo|Reenviar/)
  })
  it('o Inbox mostra o envio só em conversa externa e exige a ação enviar_email', () => {
    const inbox = ler('src/screens/Inbox.tsx')
    expect(inbox).toContain("thread.contexto === 'EXTERNAL' && <label><input type=\"checkbox\" checked={modoEmail}")
    expect(inbox).toContain("podeEnviar={pode(usuario, 'enviar_email')}")
  })
})

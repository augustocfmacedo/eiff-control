// E-mail comercial, etapa E1: a mensagem (validação e RFC 5322) e as regras puras do envio.
import { describe, expect, it } from 'vitest'
import {
  ERROS_EMAIL, LIMITE_ORGANIZACAO_PADRAO, LIMITE_USUARIO_PADRAO, MOTIVOS_ENTREGA, autorizarDestino, cumpreSla, entregaPendente, erroDoMotivo,
  lerLimite, lerListaCanario, lerModoEmail, lerRespostaDoEnvio, lerRespostaDoToken, ESTADOS_ENTREGA_EMAIL,
} from './emailEnvio'
import {
  LIMITE_ASSUNTO, LIMITE_CORPO, MensagemInvalida, assinatura, base64, base64url, cabecalhoCodificado, corpoComAssinatura, dataRfc5322, emailValido,
  impressaoDoPedido, mascararEmail, messageIdDaEntrega, montarMensagem, rawParaGmail, textoNaConversa, utf8, validarConteudo, type PedidoDeMensagem,
} from './emailMensagem'

const PEDIDO: PedidoDeMensagem = {
  remetente: { nome: 'EIFF', email: 'contato@eiff.com.br' }, para: 'marina@exemplo.com.br', assunto: 'Sua solicitação de galpão',
  corpo: 'Olá, Marina.\n\nSegue a proposta — ação imediata.\n\nAugusto Macedo\nEIFF', messageId: '<0f8fad5b-d9cb-469f-a165-70867728950e@eiff.com.br>', em: '2026-11-11T18:00:05.000Z',
}
const partes = (m: string) => { const [cab, ...resto] = m.split('\r\n\r\n'); return { cab: cab.split('\r\n'), corpo: resto.join('\r\n\r\n') } }
const deBase64 = (s: string) => Buffer.from(s.replace(/\r\n/g, ''), 'base64').toString('utf8')

describe('endereço de e-mail', () => {
  it('aceita endereço simples e recusa o que carregaria mais de um destinatário ou cabeçalho', () => {
    for (const ok of ['a@b.com', 'nome.sobrenome+tag@empresa.com.br', 'contato@eiff.com.br']) expect(emailValido(ok)).toBe(true)
    for (const ruim of ['', 'sem-arroba', 'a@b', 'a b@c.com', 'a@b.com, c@d.com', 'a@b.com;c@d.com', 'Nome <a@b.com>', 'a@b.com\r\nBcc: x@y.com', 'a@b.com\n', '"a"@b.com', 'a@-b.com', undefined]) expect(emailValido(ruim as string)).toBe(false)
    expect(emailValido(`${'a'.repeat(250)}@b.com`)).toBe(false)
  })
  it('mascara para a tela e para o log', () => {
    expect(mascararEmail('marina@exemplo.com.br')).toBe('m•••@exemplo.com.br')
    expect(mascararEmail('semarroba')).toBe('•••')
  })
})

describe('validação do que a pessoa escreveu', () => {
  it('conteúdo normal passa, inclusive com acentos e várias linhas', () => {
    expect(validarConteudo({ assunto: 'Proposta — galpão 20 x 60 m', corpo: 'Olá.\n\nSegue.\r\nAté.' })).toEqual([])
  })
  it('assunto e corpo vazios, longos demais ou com tipo errado são recusados', () => {
    expect(validarConteudo({ assunto: ' ', corpo: ' ' }).length).toBe(2)
    expect(validarConteudo({ assunto: 'a'.repeat(LIMITE_ASSUNTO + 1), corpo: 'x' })[0]).toContain('assunto passa')
    expect(validarConteudo({ assunto: 'a', corpo: 'x'.repeat(LIMITE_CORPO + 1) })[0]).toContain('mensagem passa')
    expect(validarConteudo({ assunto: 1, corpo: null } as never).length).toBe(2)
  })
  it('injeção de cabeçalho no assunto é RECUSA, não limpeza', () => {
    for (const assunto of ['Oi\r\nBcc: x@y.com', 'Oi\nCc: x@y.com', 'Oi\rX', 'Oi\tX', `Oi${String.fromCharCode(0)}`]) expect(validarConteudo({ assunto, corpo: 'x' })[0]).toContain('quebra de linha')
  })
  it('caractere de controle no corpo é recusado; quebra de linha e tabulação não', () => {
    expect(validarConteudo({ assunto: 'a', corpo: `x${String.fromCharCode(0)}y` }).length).toBe(1)
    expect(validarConteudo({ assunto: 'a', corpo: 'x\ty\nz' })).toEqual([])
  })
})

describe('assinatura e texto da conversa', () => {
  it('assinatura = nome do atendente + EIFF; sem nome (ou nome com quebra) fica só EIFF', () => {
    expect(assinatura('Augusto Macedo')).toBe('Augusto Macedo\nEIFF')
    expect(assinatura(undefined)).toBe('EIFF')
    expect(assinatura('  ')).toBe('EIFF')
    expect(assinatura('Nome\r\nBcc: x@y.com')).toBe('EIFF')
  })
  it('o corpo final normaliza quebras e acrescenta a assinatura; o texto da conversa abre com o assunto', () => {
    const corpo = corpoComAssinatura('  Olá.\r\nTudo bem?\r\n', 'Ana')
    expect(corpo).toBe('Olá.\nTudo bem?\n\nAna\nEIFF')
    expect(textoNaConversa(' Proposta ', corpo)).toBe('Assunto: Proposta\n\nOlá.\nTudo bem?\n\nAna\nEIFF')
  })
  it('Message-ID deriva da entrega; a impressão muda com destinatário, assunto ou corpo e ignora caixa, espaços e CRLF', () => {
    expect(messageIdDaEntrega('abc-123')).toBe('<abc-123@eiff.com.br>')
    const base = { para: 'a@b.com', assunto: 'Oi', corpo: 'x\ny' }
    expect(impressaoDoPedido(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(impressaoDoPedido({ para: ' A@B.com ', assunto: ' Oi ', corpo: 'x\r\ny\n' })).toBe(impressaoDoPedido(base))
    for (const outro of [{ ...base, para: 'c@b.com' }, { ...base, assunto: 'Oi!' }, { ...base, corpo: 'x\nz' }]) expect(impressaoDoPedido(outro)).not.toBe(impressaoDoPedido(base))
  })
})

describe('codificação', () => {
  it('utf8 e base64 batem com o Node em ASCII, acentos, emoji e todos os restos de 3', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'ação', 'São Paulo — ok', '日本', '🙂 fim', 'x'.repeat(200)]) {
      expect(utf8(s)).toEqual([...Buffer.from(s, 'utf8')])
      expect(base64(utf8(s))).toBe(Buffer.from(s, 'utf8').toString('base64'))
      expect(base64url(utf8(s))).toBe(Buffer.from(s, 'utf8').toString('base64url'))
    }
  })
  it('cabeçalho ASCII vai como está; com acento vira encoded-word que decodifica de volta', () => {
    expect(cabecalhoCodificado('Proposta 123')).toBe('Proposta 123')
    const longo = 'Solicitação de orçamento para galpão logístico de 4.000 m² em Aparecida de Goiânia — retorno'
    const cod = cabecalhoCodificado(longo)
    for (const linha of cod.split('\r\n ')) { expect(linha.length).toBeLessThanOrEqual(75); expect(linha).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/) }
    expect(cod.split('\r\n ').map((p) => Buffer.from(p.slice(10, -2), 'base64').toString('utf8')).join('')).toBe(longo)
  })
  it('data RFC 5322 em UTC, independente do fuso de quem executa', () => {
    expect(dataRfc5322('2026-11-11T18:00:05.000Z')).toBe('Wed, 11 Nov 2026 18:00:05 +0000')
    expect(dataRfc5322('2026-01-01T02:03:04-03:00')).toBe('Thu, 01 Jan 2026 05:03:04 +0000')
    expect(() => dataRfc5322('ontem')).toThrow(MensagemInvalida)
  })
})

describe('montagem da mensagem para a Gmail API', () => {
  it('cabeçalhos exatos, um destinatário, texto puro em base64 e nada além disso', () => {
    const { cab, corpo } = partes(montarMensagem(PEDIDO))
    expect(cab).toEqual([
      'From: "EIFF" <contato@eiff.com.br>',
      'To: marina@exemplo.com.br',
      'Reply-To: contato@eiff.com.br',
      `Subject: ${cabecalhoCodificado('Sua solicitação de galpão')}`,
      'Date: Wed, 11 Nov 2026 18:00:05 +0000',
      'Message-ID: <0f8fad5b-d9cb-469f-a165-70867728950e@eiff.com.br>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ])
    expect(deBase64(corpo)).toBe(PEDIDO.corpo.replace(/\n/g, '\r\n'))
    for (const linha of corpo.trimEnd().split('\r\n')) expect(linha.length).toBeLessThanOrEqual(76)
  })
  it('não existe Cc, Bcc, HTML, anexo nem rastreamento', () => {
    const m = montarMensagem(PEDIDO)
    expect(m).not.toMatch(/^(Cc|Bcc|X-|List-|Disposition-Notification-To):/im)
    expect(m).not.toMatch(/text\/html|multipart|<img|http/i)
  })
  it('continuação de fio leva In-Reply-To e References', () => {
    const { cab } = partes(montarMensagem({ ...PEDIDO, emRespostaA: '<anterior@eiff.com.br>' }))
    expect(cab).toContain('In-Reply-To: <anterior@eiff.com.br>')
    expect(cab).toContain('References: <anterior@eiff.com.br>')
  })
  it('nome exibido com acento é codificado; aspas e barras somem do nome ASCII', () => {
    expect(partes(montarMensagem({ ...PEDIDO, remetente: { nome: 'EIFF Estruturas Metálicas', email: 'contato@eiff.com.br' } })).cab[0]).toMatch(/^From: =\?UTF-8\?B\?.+\?= <contato@eiff\.com\.br>$/)
    expect(partes(montarMensagem({ ...PEDIDO, remetente: { nome: 'EIFF "x" \\', email: 'contato@eiff.com.br' } })).cab[0]).toBe('From: "EIFF x " <contato@eiff.com.br>')
  })
  it('é a última linha antes do efeito externo: recusa de novo tudo o que não confere', () => {
    const lanca = (p: Partial<PedidoDeMensagem>, motivo: string) => { try { montarMensagem({ ...PEDIDO, ...p }); throw new Error('não lançou') } catch (e) { expect(e).toBeInstanceOf(MensagemInvalida); expect((e as MensagemInvalida).motivo).toBe(motivo) } }
    lanca({ para: 'a@b.com, c@d.com' }, 'destinatario_invalido')
    lanca({ para: 'a@b.com\r\nBcc: x@y.com' }, 'destinatario_invalido')
    lanca({ remetente: { nome: 'EIFF', email: 'nao-e-email' } }, 'remetente_invalido')
    lanca({ remetente: { nome: 'EIFF\r\nBcc: x@y.com', email: 'contato@eiff.com.br' } }, 'remetente_invalido')
    lanca({ assunto: 'Oi\r\nBcc: x@y.com' }, 'assunto_invalido')
    lanca({ assunto: '  ' }, 'assunto_invalido')
    lanca({ corpo: '' }, 'corpo_invalido')
    lanca({ messageId: 'sem-sinais@eiff.com.br' }, 'message_id_invalido')
    lanca({ emRespostaA: '<a@b>\r\nBcc: x@y.com' }, 'message_id_invalido')
    lanca({ em: 'agora' }, 'data_invalida')
  })
  it('nenhum cabeçalho carrega quebra de linha vinda do conteúdo', () => {
    const { cab } = partes(montarMensagem({ ...PEDIDO, assunto: 'Assunto com acentuação muito longa para forçar a dobra do cabeçalho em várias partes codificadas' }))
    const nomes = cab.filter((l) => !l.startsWith(' ')).map((l) => l.split(':')[0])
    expect(nomes).toEqual(['From', 'To', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'])
  })
  it('raw é base64url da mensagem inteira, como a Gmail API pede', () => {
    const m = montarMensagem(PEDIDO)
    const raw = rawParaGmail(m)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe(m)
  })
})

describe('modo, canário e tetos', () => {
  it('desligado é o padrão: ausente, vazio, desconhecido ou com outro nome', () => {
    for (const v of [undefined, '', ' ', 'on', 'true', 'enabled', 'active', 'pilot', 'ATIVADO', '1']) expect(lerModoEmail(v)).toBe('disabled')
    expect(lerModoEmail(' Canary ')).toBe('canary')
    expect(lerModoEmail('ATIVO')).toBe('ativo')
  })
  it('lista do canário: só endereços válidos, sem repetição, em minúsculas', () => {
    expect(lerListaCanario(' A@eiff.com.br, b@eiff.com.br;a@eiff.com.br  lixo  ')).toEqual(['a@eiff.com.br', 'b@eiff.com.br'])
    expect(lerListaCanario(undefined)).toEqual([])
  })
  it('autorização do destino nos três modos', () => {
    expect(autorizarDestino('disabled', ['a@b.com'], 'a@b.com')).toEqual({ ok: false, erro: 'envio_desligado' })
    expect(autorizarDestino('canary', ['a@b.com'], 'A@B.com ')).toEqual({ ok: true })
    expect(autorizarDestino('canary', [], 'a@b.com')).toEqual({ ok: false, erro: 'destino_nao_autorizado' })
    expect(autorizarDestino('canary', ['a@b.com'], 'c@b.com')).toEqual({ ok: false, erro: 'destino_nao_autorizado' })
    expect(autorizarDestino('ativo', [], 'qualquer@cliente.com')).toEqual({ ok: true })
  })
  it('tetos: valor inválido cai no padrão da Direção (30 e 100), nunca em «sem limite»', () => {
    expect([LIMITE_USUARIO_PADRAO, LIMITE_ORGANIZACAO_PADRAO]).toEqual([30, 100])
    for (const v of [undefined, '', '0', '-5', 'abc', '1.5', '99999', 'Infinity']) expect(lerLimite(v, 30)).toBe(30)
    expect(lerLimite(' 12 ', 30)).toBe(12)
  })
})

describe('leitura das respostas do Google', () => {
  it('token: só 2xx com access_token serve; invalid_grant é revogação; 5xx, 429, rede e tempo são indisponibilidade', () => {
    expect(lerRespostaDoToken({ tipo: 'http', status: 200, corpo: { access_token: 't' } })).toEqual({ ok: true, accessToken: 't' })
    expect(lerRespostaDoToken({ tipo: 'http', status: 200, corpo: { access_token: '' } })).toEqual({ ok: false, motivo: 'provedor_indisponivel' })
    expect(lerRespostaDoToken({ tipo: 'http', status: 400, corpo: { error: 'invalid_grant' } })).toEqual({ ok: false, motivo: 'credencial_revogada' })
    expect(lerRespostaDoToken({ tipo: 'http', status: 401, corpo: { error: 'invalid_client' } })).toEqual({ ok: false, motivo: 'credencial_invalida' })
    expect(lerRespostaDoToken({ tipo: 'http', status: 400, corpo: 'texto' })).toEqual({ ok: false, motivo: 'credencial_invalida' })
    for (const r of [{ tipo: 'http', status: 503, corpo: {} }, { tipo: 'http', status: 429, corpo: {} }, { tipo: 'rede' }, { tipo: 'tempo' }] as const) expect(lerRespostaDoToken(r)).toEqual({ ok: false, motivo: 'provedor_indisponivel' })
  })
  it('envio: ACCEPTED só com 2xx e id; FAILED só com recusa explícita; o resto é UNKNOWN', () => {
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 200, corpo: { id: 'm1', threadId: 't1' } })).toEqual({ desfecho: 'ACCEPTED', providerMessageId: 'm1', providerThreadId: 't1' })
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 200, corpo: { id: 'm1' } })).toEqual({ desfecho: 'ACCEPTED', providerMessageId: 'm1' })
    for (const r of [{ tipo: 'http', status: 200, corpo: {} }, { tipo: 'http', status: 200, corpo: null }, { tipo: 'http', status: 204, corpo: '' }, { tipo: 'http', status: 500, corpo: {} }, { tipo: 'http', status: 502, corpo: {} }, { tipo: 'http', status: 302, corpo: {} }, { tipo: 'rede' }, { tipo: 'tempo' }] as const) expect(lerRespostaDoEnvio(r).desfecho).toBe('UNKNOWN')
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 400, corpo: {} })).toEqual({ desfecho: 'FAILED', motivo: 'mensagem_recusada' })
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 401, corpo: {} })).toEqual({ desfecho: 'FAILED', motivo: 'credencial_invalida' })
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 429, corpo: {} })).toEqual({ desfecho: 'FAILED', motivo: 'limite_do_provedor' })
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 403, corpo: { error: { reason: 'dailyLimitExceeded' } } })).toEqual({ desfecho: 'FAILED', motivo: 'limite_do_provedor' })
    expect(lerRespostaDoEnvio({ tipo: 'http', status: 403, corpo: { error: { status: 'PERMISSION_DENIED' } } })).toEqual({ desfecho: 'FAILED', motivo: 'acesso_recusado' })
  })
  it('catálogos fechados: todo motivo de falha tem erro, todo erro tem HTTP e mensagem humana', () => {
    for (const m of MOTIVOS_ENTREGA.filter((x) => !['resultado_desconhecido', 'registro_falhou', 'declarado_nao_enviado', 'declarado_encontrado'].includes(x))) expect(ERROS_EMAIL[erroDoMotivo[m as keyof typeof erroDoMotivo]]).toBeDefined()
    for (const e of Object.values(ERROS_EMAIL)) { expect(e.http).toBeGreaterThanOrEqual(400); expect(e.mensagem.length).toBeGreaterThan(10) }
  })
  it('só ACCEPTED cumpre o SLA; READY, REQUESTED e UNKNOWN são pendentes', () => {
    expect(ESTADOS_ENTREGA_EMAIL.filter(cumpreSla)).toEqual(['ACCEPTED'])
    expect(ESTADOS_ENTREGA_EMAIL.filter(entregaPendente)).toEqual(['READY', 'REQUESTED', 'UNKNOWN'])
  })
})

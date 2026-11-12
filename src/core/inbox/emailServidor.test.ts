// E-mail comercial, etapa E1: o handler com portas simuladas. NENHUMA chamada real — a suíte conta as chamadas à
// porta do Google, e o ponto de cada teste é quantas houve (zero, na maioria) e o que ficou no livro.
import { describe, expect, it } from 'vitest'
import { MATRIZ } from '../permissoes'
import { PAPEIS } from '../usuarios'
import { TRANSICOES_ENTREGA_EMAIL, transicaoDeEntregaPermitida, type EstadoEntregaEmail, type MotivoEntrega, type RespostaGoogle } from './emailEnvio'
import { CONFIRMACAO_NAO_ENVIADO, ESPERA_RECONCILIACAO_MS, lerPedido, resolverDestinatario, podeEnviarEmail, tratarEmailComercial, type AmbienteEmail, type ConversaLida, type DepsEmail, type EntregaLida, type UsuarioDaSessao } from './emailServidor'

const ORG = 'org-1'
const T1 = '11111111-1111-4111-8111-111111111111'
const INT = '22222222-2222-4222-8222-222222222222'
const INT2 = '33333333-3333-4333-8333-333333333333'
const AGORA = '2026-11-11T18:00:00.000Z'
const ADMIN: UsuarioDaSessao = { id: 'u-admin', nome: 'Augusto Macedo', papel: 'Administrador', organizacaoId: ORG, ativo: true }
const CONVERSA: ConversaLida = { id: T1, organizacaoId: ORG, status: 'ATRIBUIDA', contexto: 'EXTERNAL', contatoId: 'c-1', canal: 'PORTAL', identidades: [{ canal: 'PORTAL', identificador: 'Marina@Exemplo.com.br' }] }
const PARA = 'marina@exemplo.com.br'
const AMBIENTE: AmbienteEmail = { modo: 'ativo', canario: [], remetente: 'contato@eiff.com.br', nomeExibido: 'EIFF', limiteUsuario: 30, limiteOrganizacao: 100, credenciais: true }
const TOKEN_OK: RespostaGoogle = { tipo: 'http', status: 200, corpo: { access_token: 'tok-de-teste' } }
const ENVIO_OK: RespostaGoogle = { tipo: 'http', status: 200, corpo: { id: 'gm-1', threadId: 'gt-1' } }

interface Linha { id: string; intencao: string; impressao: string; threadId: string; solicitanteId: string; estado: EstadoEntregaEmail; texto: string; motivo?: MotivoEntrega; providerMessageId?: string; aceitaEm?: string; cumpriu?: boolean; reconciliada?: boolean }

function mundo(p: { ambiente?: Partial<AmbienteEmail>; usuario?: UsuarioDaSessao | null; conversa?: ConversaLida | null; token?: RespostaGoogle; envio?: RespostaGoogle; livroFora?: boolean; aceiteFalha?: boolean; transicaoFalha?: boolean; primeiraRespostaJaExiste?: boolean } = {}) {
  const linhas: Linha[] = []
  const chamadas = { token: 0, enviar: 0, criar: 0, usuario: 0, conversa: 0 }
  const enviados: { raw: string; destino: string; providerThreadId?: string }[] = []
  const logs: Record<string, unknown>[] = []
  let primeiraResposta = p.primeiraRespostaJaExiste ?? false
  const deps: DepsEmail = {
    ambiente: { ...AMBIENTE, ...p.ambiente },
    agora: () => AGORA,
    log: (t) => logs.push(t),
    sessao: {
      async usuario() { chamadas.usuario += 1; return p.usuario === undefined ? ADMIN : p.usuario },
      async conversa() { chamadas.conversa += 1; return p.conversa === undefined ? CONVERSA : p.conversa },
      async entrega(_a, id): Promise<EntregaLida | null> { const l = linhas.find((x) => x.id === id); return l ? { id: l.id, threadId: l.threadId, organizacaoId: ORG, estado: l.estado, criadaEm: '2026-11-11T17:50:00.000Z' } : null },
    },
    livro: {
      async criar(c) {
        chamadas.criar += 1
        if (p.livroFora) return { ok: false, erro: 'livro_indisponivel' }
        const existente = linhas.find((l) => l.intencao === c.intencao)
        if (existente) {
          if (existente.impressao !== c.impressao) return { ok: false, erro: 'intencao_reutilizada' }
          return { ok: true, nova: false, entrega: { id: existente.id, estado: existente.estado, motivo: existente.motivo, aceitaEm: existente.aceitaEm, cumpriuPrimeiraResposta: existente.cumpriu, mensagemId: `msg-${existente.id}` } }
        }
        if (linhas.some((l) => l.threadId === c.threadId && (l.estado === 'READY' || l.estado === 'REQUESTED' || l.estado === 'UNKNOWN'))) return { ok: false, erro: 'entrega_pendente' }
        const contam = (l: Linha) => l.estado !== 'FAILED' && l.estado !== 'READY'
        if (linhas.filter((l) => l.solicitanteId === c.solicitanteId && contam(l)).length >= c.limiteUsuario) return { ok: false, erro: 'limite_usuario' }
        if (linhas.filter(contam).length >= c.limiteOrganizacao) return { ok: false, erro: 'limite_organizacao' }
        const l: Linha = { id: `0000000${linhas.length + 1}-0000-4000-8000-000000000000`, intencao: c.intencao, impressao: c.impressao, threadId: c.threadId, solicitanteId: c.solicitanteId, estado: 'READY', texto: c.texto }
        linhas.push(l)
        const fio = linhas.filter((x) => x.threadId === c.threadId && x.estado === 'ACCEPTED').pop()
        return { ok: true, nova: true, entrega: { id: l.id, estado: 'READY', mensagemId: `msg-${l.id}`, ...(fio ? { fio: { rfcMessageId: `<${fio.id}@eiff.com.br>`, providerThreadId: 'gt-1' } } : {}) } }
      },
      async transicionar(id, para, dados) {
        const l = linhas.find((x) => x.id === id)
        if (!l || p.transicaoFalha || !transicaoDeEntregaPermitida(l.estado, para)) return false
        l.estado = para; if (dados.motivo) l.motivo = dados.motivo; if (dados.providerMessageId) l.providerMessageId = dados.providerMessageId
        return true
      },
      async aceitar(id, dados) {
        const l = linhas.find((x) => x.id === id)
        if (!l || p.aceiteFalha || !transicaoDeEntregaPermitida(l.estado, 'ACCEPTED')) return { ok: false }
        l.estado = 'ACCEPTED'; l.aceitaEm = dados.aceitaEm; l.providerMessageId = dados.providerMessageId ?? l.providerMessageId; l.reconciliada = dados.reconciliada
        l.cumpriu = !primeiraResposta; primeiraResposta = true
        return { ok: true, mensagemId: `msg-${l.id}`, cumpriuPrimeiraResposta: l.cumpriu }
      },
    },
    google: {
      async token() { chamadas.token += 1; return p.token ?? TOKEN_OK },
      async enviar(e) { chamadas.enviar += 1; enviados.push({ raw: e.raw, destino: e.destino, providerThreadId: e.providerThreadId }); return p.envio ?? ENVIO_OK },
    },
  }
  const pedir = (body: unknown, authorization: string | null = 'Bearer jwt-de-teste') => tratarEmailComercial({ authorization, body }, deps)
  const enviar = (extra: Record<string, unknown> = {}) => pedir({ acao: 'enviar', threadId: T1, assunto: 'Sua solicitação de galpão', corpo: 'Olá, Marina.\n\nPodemos conversar amanhã?', intencao: INT, destinatario: PARA, ...extra })
  return { deps, linhas, chamadas, enviados, logs, pedir, enviar }
}
const decodificar = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

describe('permissão enviar_email', () => {
  it('só Administrador e Diretoria, e é separada de `inbox`', () => {
    expect(MATRIZ.enviar_email).toEqual(['Administrador', 'Diretoria'])
    for (const papel of PAPEIS) expect(podeEnviarEmail({ papel, ativo: true })).toBe(papel === 'Administrador' || papel === 'Diretoria')
    expect(MATRIZ.inbox.length).toBeGreaterThan(MATRIZ.enviar_email.length)
  })
  it('perfil inativo não envia, mesmo sendo Administrador', () => {
    expect(podeEnviarEmail({ papel: 'Administrador', ativo: false })).toBe(false)
  })
})

describe('forma do pedido: chaves fechadas', () => {
  it('aceita exatamente as chaves de cada ação', () => {
    expect(lerPedido({ acao: 'saude' })).toEqual({ acao: 'saude' })
    expect(lerPedido({ acao: 'preparar', threadId: T1 })).toEqual({ acao: 'preparar', threadId: T1 })
    expect(lerPedido({ acao: 'reconciliar', entregaId: T1, desfecho: 'encontrado' })).toMatchObject({ desfecho: 'encontrado' })
  })
  it('destinatário, remetente, cópia ou qualquer chave a mais é recusa', () => {
    const base = { acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', intencao: INT, destinatario: PARA }
    expect(lerPedido(base)).toBeDefined()
    for (const extra of ['para', 'to', 'de', 'from', 'remetente', 'cc', 'bcc', 'anexos', 'html', 'papel', 'organizacaoId']) expect(lerPedido({ ...base, [extra]: 'x' })).toBeUndefined()
  })
  it('ids que não são uuid, ação desconhecida, chave faltando e tipos errados são recusa', () => {
    expect(lerPedido({ acao: 'enviar', threadId: 'THR-1', assunto: 'a', corpo: 'b', intencao: INT, destinatario: PARA })).toBeUndefined()
    expect(lerPedido({ acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', destinatario: PARA })).toBeUndefined()
    expect(lerPedido({ acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', intencao: INT })).toBeUndefined()
    expect(lerPedido({ acao: 'enviar', threadId: T1, assunto: 1, corpo: 'b', intencao: INT, destinatario: PARA })).toBeUndefined()
    expect(lerPedido({ acao: 'enviar_em_massa', threads: [T1] })).toBeUndefined()
    expect(lerPedido({ acao: 'reconciliar', entregaId: T1, desfecho: 'reenviar' })).toBeUndefined()
    expect(lerPedido([{ acao: 'saude' }])).toBeUndefined()
    expect(lerPedido(null)).toBeUndefined()
  })
  it('pedido malformado: 400 sem tocar em nenhuma porta', async () => {
    const m = mundo()
    expect((await m.pedir({ acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', intencao: INT, destinatario: PARA, para: 'outro@exemplo.com' })).status).toBe(400)
    expect(m.chamadas).toEqual({ token: 0, enviar: 0, criar: 0, usuario: 0, conversa: 0 })
  })
})

describe('as chaves de segurança, uma a uma', () => {
  it('modo disabled (o padrão): 403 antes de autenticar, zero porta chamada', async () => {
    const m = mundo({ ambiente: { modo: 'disabled' } })
    const r = await m.enviar()
    expect(r).toMatchObject({ status: 403, corpo: { erro: 'envio_desligado' } })
    expect(m.chamadas).toEqual({ token: 0, enviar: 0, criar: 0, usuario: 0, conversa: 0 })
  })
  it('sem JWT ou sessão inválida: 401, nada criado, nada enviado', async () => {
    const m = mundo()
    expect((await m.pedir({ acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', intencao: INT, destinatario: PARA }, null)).status).toBe(401)
    expect((await m.pedir({ acao: 'enviar', threadId: T1, assunto: 'a', corpo: 'b', intencao: INT, destinatario: PARA }, 'token-sem-bearer')).status).toBe(401)
    const semSessao = mundo({ usuario: null })
    expect((await semSessao.enviar()).status).toBe(401)
    expect(m.chamadas.enviar + semSessao.chamadas.enviar + m.chamadas.criar + semSessao.chamadas.criar).toBe(0)
  })
  it('cada papel fora da ação recebe 403 sem ler a conversa nem chamar o Google', async () => {
    for (const papel of PAPEIS.filter((x) => x !== 'Administrador' && x !== 'Diretoria')) {
      const m = mundo({ usuario: { ...ADMIN, papel } })
      expect(await m.enviar()).toMatchObject({ status: 403, corpo: { erro: 'sem_permissao' } })
      expect(m.chamadas).toMatchObject({ conversa: 0, criar: 0, token: 0, enviar: 0 })
    }
  })
  it('perfil inativo: 403', async () => {
    const m = mundo({ usuario: { ...ADMIN, ativo: false } })
    expect((await m.enviar()).status).toBe(403)
    expect(m.chamadas.enviar).toBe(0)
  })
  it('Diretoria envia', async () => {
    const m = mundo({ usuario: { ...ADMIN, id: 'u-dir', papel: 'Diretoria' } })
    expect((await m.enviar()).corpo['estado']).toBe('ACCEPTED')
  })
  it('canário: destinatário fora da lista é 403 e nada é criado; dentro da lista envia', async () => {
    const fora = mundo({ ambiente: { modo: 'canary', canario: ['interno@eiff.com.br'] } })
    expect(await fora.enviar()).toMatchObject({ status: 403, corpo: { erro: 'destino_nao_autorizado' } })
    expect(fora.chamadas).toMatchObject({ criar: 0, token: 0, enviar: 0 })
    const dentro = mundo({ ambiente: { modo: 'canary', canario: ['marina@exemplo.com.br'] } })
    expect((await dentro.enviar()).corpo['estado']).toBe('ACCEPTED')
    expect(dentro.chamadas.enviar).toBe(1)
  })
  it('credencial ou remetente ausentes: 503, nada criado, nada enviado', async () => {
    const semCred = mundo({ ambiente: { credenciais: false } })
    expect(await semCred.enviar()).toMatchObject({ status: 503, corpo: { erro: 'credencial_indisponivel' } })
    const semRem = mundo({ ambiente: { remetente: undefined } })
    expect(await semRem.enviar()).toMatchObject({ status: 503, corpo: { erro: 'remetente_nao_configurado' } })
    expect(semCred.chamadas.criar + semRem.chamadas.criar + semCred.chamadas.token + semRem.chamadas.token).toBe(0)
  })
})

describe('Server Truth: conversa e destinatário vêm do banco', () => {
  it('conversa invisível ou de outra organização: 404 igual, nada criado', async () => {
    expect(await mundo({ conversa: null }).enviar()).toMatchObject({ status: 404, corpo: { erro: 'conversa_nao_encontrada' } })
    const outra = mundo({ conversa: { ...CONVERSA, organizacaoId: 'org-2' } })
    expect(await outra.enviar()).toMatchObject({ status: 404, corpo: { erro: 'conversa_nao_encontrada' } })
    expect(outra.chamadas.criar).toBe(0)
  })
  it('conversa fechada, interna ou sem e-mail válido: recusa sem criar entrega', async () => {
    expect((await mundo({ conversa: { ...CONVERSA, status: 'FECHADA' } }).enviar()).corpo['erro']).toBe('conversa_fechada')
    expect((await mundo({ conversa: { ...CONVERSA, contexto: 'INTERNAL' } }).enviar()).corpo['erro']).toBe('conversa_interna')
    const semEmail = mundo({ conversa: { ...CONVERSA, identidades: [{ canal: 'PORTAL', identificador: 'não é e-mail' }, { canal: 'EMAIL', identificador: '' }, { canal: 'WHATSAPP', identificador: '5562999990000' }] } })
    expect(await semEmail.enviar()).toMatchObject({ status: 422, corpo: { erro: 'sem_email_valido' } })
    expect(semEmail.chamadas.criar).toBe(0)
  })
  it('o destinatário é o do banco, em minúsculas; o remetente é o do ambiente', async () => {
    const m = mundo()
    await m.enviar()
    expect(m.enviados[0].destino).toBe('marina@exemplo.com.br')
    const msg = decodificar(m.enviados[0].raw)
    expect(msg).toContain('To: marina@exemplo.com.br')
    expect(msg).toContain('From: "EIFF" <contato@eiff.com.br>')
    expect(msg).toContain('Reply-To: contato@eiff.com.br')
  })
  it('conteúdo inválido: 400 com a mensagem humana, nada criado', async () => {
    const m = mundo()
    expect(await m.enviar({ assunto: 'Assunto\r\nBcc: outro@exemplo.com' })).toMatchObject({ status: 400, corpo: { erro: 'pedido_invalido' } })
    expect((await m.enviar({ corpo: '   ' })).status).toBe(400)
    expect(m.chamadas).toMatchObject({ criar: 0, enviar: 0 })
  })
})

describe('livro primeiro e idempotência', () => {
  it('livro indisponível: 503 e ZERO chamada ao Google', async () => {
    const m = mundo({ livroFora: true })
    expect(await m.enviar()).toMatchObject({ status: 503, corpo: { erro: 'livro_indisponivel' } })
    expect(m.chamadas).toMatchObject({ token: 0, enviar: 0 })
  })
  it('falha ao passar para REQUESTED: nada é enviado', async () => {
    const m = mundo({ transicaoFalha: true })
    expect((await m.enviar()).status).toBe(503)
    expect(m.chamadas).toMatchObject({ token: 0, enviar: 0 })
  })
  it('envio feliz: UMA chamada de envio, entrega ACCEPTED, mensagem com assunto e assinatura', async () => {
    const m = mundo()
    const r = await m.enviar()
    expect(r).toMatchObject({ status: 200, corpo: { estado: 'ACCEPTED', enviadaEm: AGORA, cumpriuPrimeiraResposta: true } })
    expect(m.chamadas).toMatchObject({ token: 1, enviar: 1, criar: 1 })
    expect(m.linhas[0]).toMatchObject({ estado: 'ACCEPTED', providerMessageId: 'gm-1' })
    expect(m.linhas[0].texto).toBe('Assunto: Sua solicitação de galpão\n\nOlá, Marina.\n\nPodemos conversar amanhã?\n\nAugusto Macedo\nEIFF')
    expect(decodificar(m.enviados[0].raw)).toContain(`Message-ID: <${m.linhas[0].id}@eiff.com.br>`)
  })
  it('duplo clique (mesma intenção): um e-mail só, e a segunda resposta é a original', async () => {
    const m = mundo()
    const a = await m.enviar(); const b = await m.enviar()
    expect(m.chamadas.enviar).toBe(1)
    expect(b.corpo).toMatchObject({ estado: 'ACCEPTED', entregaId: a.corpo['entregaId'], repetida: true })
    expect(m.linhas.length).toBe(1)
  })
  it('mesma intenção com outro conteúdo: 409, nenhum segundo envio', async () => {
    const m = mundo()
    await m.enviar()
    expect(await m.enviar({ corpo: 'Outro texto.' })).toMatchObject({ status: 409, corpo: { erro: 'intencao_reutilizada' } })
    expect(m.chamadas.enviar).toBe(1)
  })
  it('entrega sem desfecho bloqueia novo envio na mesma conversa', async () => {
    const m = mundo({ envio: { tipo: 'tempo' } })
    expect((await m.enviar()).corpo['estado']).toBe('UNKNOWN')
    expect(await m.enviar({ intencao: INT2 })).toMatchObject({ status: 409, corpo: { erro: 'entrega_pendente' } })
    expect(m.chamadas.enviar).toBe(1)
  })
  it('tetos diários: o que passa do limite do usuário ou da organização é 429 sem envio', async () => {
    const usuario = mundo({ ambiente: { limiteUsuario: 1 } })
    await usuario.enviar()
    expect(await usuario.enviar({ intencao: INT2 })).toMatchObject({ status: 429, corpo: { erro: 'limite_usuario' } })
    expect(usuario.chamadas.enviar).toBe(1)
    const org = mundo({ ambiente: { limiteOrganizacao: 1 } })
    await org.enviar()
    expect((await org.enviar({ intencao: INT2 })).corpo['erro']).toBe('limite_organizacao')
  })
  it('segundo e-mail na conversa continua o fio do primeiro', async () => {
    const m = mundo()
    await m.enviar()
    await m.enviar({ intencao: INT2, corpo: 'Segue o complemento.' })
    const segundo = decodificar(m.enviados[1].raw)
    expect(segundo).toContain(`In-Reply-To: <${m.linhas[0].id}@eiff.com.br>`)
    expect(m.enviados[1].providerThreadId).toBe('gt-1')
    expect(m.chamadas.enviar).toBe(2)
  })
})

describe('sucesso, falha e resultado desconhecido', () => {
  const casos: [string, Partial<Parameters<typeof mundo>[0]>, { status: number; estado: EstadoEntregaEmail; erro?: string; enviar: number }][] = [
    ['token revogado (invalid_grant)', { token: { tipo: 'http', status: 400, corpo: { error: 'invalid_grant' } } }, { status: 503, estado: 'FAILED', erro: 'credencial_indisponivel', enviar: 0 }],
    ['cliente OAuth inválido', { token: { tipo: 'http', status: 401, corpo: { error: 'invalid_client' } } }, { status: 503, estado: 'FAILED', erro: 'credencial_indisponivel', enviar: 0 }],
    ['Google fora do ar ANTES do envio', { token: { tipo: 'tempo' } }, { status: 503, estado: 'FAILED', erro: 'provedor_indisponivel', enviar: 0 }],
    ['token 200 sem access_token', { token: { tipo: 'http', status: 200, corpo: {} } }, { status: 503, estado: 'FAILED', erro: 'provedor_indisponivel', enviar: 0 }],
    ['envio recusado (400)', { envio: { tipo: 'http', status: 400, corpo: { error: { message: 'Invalid To header' } } } }, { status: 502, estado: 'FAILED', erro: 'provedor_recusou', enviar: 1 }],
    ['token de acesso recusado no envio (401)', { envio: { tipo: 'http', status: 401, corpo: {} } }, { status: 503, estado: 'FAILED', erro: 'credencial_indisponivel', enviar: 1 }],
    ['limite do Google (429)', { envio: { tipo: 'http', status: 429, corpo: {} } }, { status: 502, estado: 'FAILED', erro: 'limite_do_provedor', enviar: 1 }],
    ['escopo insuficiente (403)', { envio: { tipo: 'http', status: 403, corpo: { error: { status: 'PERMISSION_DENIED' } } } }, { status: 502, estado: 'FAILED', erro: 'provedor_recusou', enviar: 1 }],
    ['tempo esgotado no envio', { envio: { tipo: 'tempo' } }, { status: 200, estado: 'UNKNOWN', enviar: 1 }],
    ['rede no envio', { envio: { tipo: 'rede' } }, { status: 200, estado: 'UNKNOWN', enviar: 1 }],
    ['5xx no envio', { envio: { tipo: 'http', status: 503, corpo: {} } }, { status: 200, estado: 'UNKNOWN', enviar: 1 }],
    ['200 sem id', { envio: { tipo: 'http', status: 200, corpo: {} } }, { status: 200, estado: 'UNKNOWN', enviar: 1 }],
  ]
  it.each(casos)('%s', async (_nome, cenario, esperado) => {
    const m = mundo(cenario)
    const r = await m.enviar()
    expect(r.status).toBe(esperado.status)
    expect(m.linhas[0].estado).toBe(esperado.estado)
    expect(m.chamadas.enviar).toBe(esperado.enviar)
    if (esperado.erro) expect(r.corpo['erro']).toBe(esperado.erro)
    else expect(r.corpo['estado']).toBe('UNKNOWN')
    // só o aceite confirmado cumpre a primeira resposta
    expect(m.linhas[0].cumpriu).toBeUndefined()
  })
  it('resultado desconhecido NUNCA é reenviado: repetir o pedido não chama o Google de novo', async () => {
    const m = mundo({ envio: { tipo: 'tempo' } })
    await m.enviar()
    const r = await m.enviar()
    expect(r.corpo).toMatchObject({ estado: 'UNKNOWN', repetida: true })
    expect(m.chamadas.enviar).toBe(1)
  })
  it('falha repetida também não reenvia: a intenção é a mesma, a resposta é a falha original', async () => {
    const m = mundo({ envio: { tipo: 'http', status: 400, corpo: {} } })
    await m.enviar()
    const r = await m.enviar()
    expect(r).toMatchObject({ status: 502, corpo: { estado: 'FAILED', repetida: true } })
    expect(m.chamadas.enviar).toBe(1)
  })
  it('o Google aceitou e o registro falhou: fica UNKNOWN com o id anotado, sem reenvio', async () => {
    const m = mundo({ aceiteFalha: true })
    const r = await m.enviar()
    expect(r.corpo['estado']).toBe('UNKNOWN')
    expect(m.linhas[0]).toMatchObject({ estado: 'UNKNOWN', motivo: 'registro_falhou', providerMessageId: 'gm-1' })
    await m.enviar()
    expect(m.chamadas.enviar).toBe(1)
  })
  it('primeira resposta já registrada antes: o aceite não a sobrescreve', async () => {
    const m = mundo({ primeiraRespostaJaExiste: true })
    expect((await m.enviar()).corpo['cumpriuPrimeiraResposta']).toBe(false)
  })
  it('em nenhum caso há mais de uma chamada de envio por pedido', async () => {
    for (const [, cenario] of casos) { const m = mundo(cenario); await m.enviar(); expect(m.chamadas.enviar).toBeLessThanOrEqual(1) }
  })
})

describe('reconciliação humana do resultado desconhecido', () => {
  const desconhecida = async () => { const m = mundo({ envio: { tipo: 'tempo' } }); const r = await m.enviar(); return { m, id: r.corpo['entregaId'] as string } }
  it('«encontrei em Enviados»: vira ACCEPTED com o instante do pedido original, sem chamar o Google', async () => {
    const { m, id } = await desconhecida()
    const r = await m.pedir({ acao: 'reconciliar', entregaId: id, desfecho: 'encontrado' })
    expect(r.corpo).toMatchObject({ estado: 'ACCEPTED', reconciliada: true, enviadaEm: '2026-11-11T17:50:00.000Z', cumpriuPrimeiraResposta: true })
    expect(m.linhas[0]).toMatchObject({ estado: 'ACCEPTED', reconciliada: true })
    expect(m.chamadas.enviar).toBe(1)
  })
  it('«não foi enviado»: vira FAILED e libera novo envio na conversa', async () => {
    const { m, id } = await desconhecida()
    expect((await m.pedir({ acao: 'reconciliar', entregaId: id, desfecho: 'nao_enviado', confirmacao: CONFIRMACAO_NAO_ENVIADO })).corpo).toMatchObject({ estado: 'FAILED', reconciliada: true })
    expect(m.linhas[0].motivo).toBe('declarado_nao_enviado')
  })
  it('entrega já terminada não é reconciliada; entrega inexistente é 404', async () => {
    const m = mundo()
    const r = await m.enviar()
    expect(await m.pedir({ acao: 'reconciliar', entregaId: r.corpo['entregaId'], desfecho: 'nao_enviado', confirmacao: CONFIRMACAO_NAO_ENVIADO })).toMatchObject({ status: 409, corpo: { erro: 'reconciliacao_indevida' } })
    expect((await m.pedir({ acao: 'reconciliar', entregaId: INT2, desfecho: 'encontrado' })).status).toBe(404)
    expect(m.linhas[0].estado).toBe('ACCEPTED')
  })
  it('exige a mesma permissão do envio', async () => {
    const { m, id } = await desconhecida()
    m.deps.sessao.usuario = async () => ({ ...ADMIN, papel: 'Financeiro' })
    expect((await m.pedir({ acao: 'reconciliar', entregaId: id, desfecho: 'encontrado' })).status).toBe(403)
    expect(m.linhas[0].estado).toBe('UNKNOWN')
  })
  it('a espera mínima para reconciliar entrega parada é maior que o tempo de vida da função', () => {
    expect(ESPERA_RECONCILIACAO_MS).toBeGreaterThanOrEqual(60_000)
  })
})

describe('preparar e saúde: informam, nunca enviam', () => {
  it('preparar diz por que o envio não está disponível e para quem a conversa responde', async () => {
    const off = mundo({ ambiente: { modo: 'disabled' } })
    expect((await off.pedir({ acao: 'preparar', threadId: T1 })).corpo).toMatchObject({ disponivel: false, motivo: 'envio_desligado', destinatario: PARA, remetente: 'contato@eiff.com.br' })
    const semCred = mundo({ ambiente: { credenciais: false } })
    expect((await semCred.pedir({ acao: 'preparar', threadId: T1 })).corpo).toMatchObject({ disponivel: false, motivo: 'credencial_indisponivel' })
    const canario = mundo({ ambiente: { modo: 'canary', canario: [] } })
    expect((await canario.pedir({ acao: 'preparar', threadId: T1 })).corpo).toMatchObject({ disponivel: false, motivo: 'destino_nao_autorizado' })
    const ok = mundo()
    expect((await ok.pedir({ acao: 'preparar', threadId: T1 })).corpo).toEqual({ modo: 'ativo', remetente: 'contato@eiff.com.br', disponivel: true, destinatario: PARA })
    for (const m of [off, semCred, canario, ok]) expect(m.chamadas).toMatchObject({ token: 0, enviar: 0, criar: 0 })
  })
  it('preparar nunca devolve a lista do canário', async () => {
    const m = mundo({ ambiente: { modo: 'canary', canario: ['interno@eiff.com.br'] } })
    expect(JSON.stringify((await m.pedir({ acao: 'preparar', threadId: T1 })).corpo)).not.toContain('interno@eiff.com.br')
  })
  it('preparar e saúde exigem a permissão de envio', async () => {
    const m = mundo({ usuario: { ...ADMIN, papel: 'Compras' } })
    expect((await m.pedir({ acao: 'preparar', threadId: T1 })).status).toBe(403)
    expect((await m.pedir({ acao: 'saude' })).status).toBe(403)
  })
  it('saúde sem credencial não chama o Google; com credencial pede só o token', async () => {
    const sem = mundo({ ambiente: { credenciais: false } })
    expect((await sem.pedir({ acao: 'saude' })).corpo).toMatchObject({ credenciais: 'ausentes', token: 'nao_testado' })
    expect(sem.chamadas.token).toBe(0)
    const com = mundo({ ambiente: { modo: 'disabled' } })
    expect((await com.pedir({ acao: 'saude' })).corpo).toMatchObject({ modo: 'disabled', credenciais: 'presentes', token: 'ok' })
    expect(com.chamadas).toMatchObject({ token: 1, enviar: 0 })
    const revogada = mundo({ token: { tipo: 'http', status: 400, corpo: { error: 'invalid_grant' } } })
    expect((await revogada.pedir({ acao: 'saude' })).corpo['token']).toBe('credencial_revogada')
  })
})

describe('não vazamento', () => {
  it('nenhum log ou resposta carrega token, destinatário, assunto ou corpo', async () => {
    for (const cenario of [{}, { envio: { tipo: 'tempo' } as RespostaGoogle }, { envio: { tipo: 'http', status: 400, corpo: { error: { message: 'texto do Google com marina@exemplo.com.br' } } } as RespostaGoogle }, { token: { tipo: 'http', status: 400, corpo: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } as RespostaGoogle }]) {
      const m = mundo(cenario)
      const r = await m.enviar()
      const tudo = JSON.stringify([m.logs, r.corpo])
      for (const proibido of ['tok-de-teste', 'jwt-de-teste', 'marina@exemplo.com.br', 'Sua solicitação de galpão', 'Podemos conversar', 'texto do Google', 'expired or revoked']) expect(tudo).not.toContain(proibido)
      expect(m.logs.length).toBeGreaterThan(0)
    }
  })
  it('a máquina de estados é fechada: terminais sem saída e UNKNOWN só sai por reconciliação', () => {
    expect(TRANSICOES_ENTREGA_EMAIL.ACCEPTED).toEqual([])
    expect(TRANSICOES_ENTREGA_EMAIL.FAILED).toEqual([])
    expect(TRANSICOES_ENTREGA_EMAIL.UNKNOWN).toEqual(['ACCEPTED', 'FAILED'])
    expect(transicaoDeEntregaPermitida('READY', 'ACCEPTED')).toBe(false)
    expect(transicaoDeEntregaPermitida('UNKNOWN', 'REQUESTED')).toBe(false)
  })
})

/* ---------------------------------------------------------------
   Revisão final da Direção (11/11/2026): destinatário, confirmação e reconciliação
--------------------------------------------------------------- */

describe('regressão — para QUAL endereço a conversa responde', () => {
  const id = (canal: string, identificador: string) => ({ canal, identificador })
  it('conversa do formulário do site responde ao e-mail do FORMULÁRIO, mesmo com outra identidade de e-mail no contato', async () => {
    const conversa: ConversaLida = { ...CONVERSA, canal: 'PORTAL', identidades: [id('EMAIL', 'antigo@outra-empresa.com'), id('PORTAL', 'marina@exemplo.com.br'), id('WHATSAPP', '5562999990000')] }
    expect(resolverDestinatario(conversa)).toEqual({ ok: true, destino: 'marina@exemplo.com.br' })
    const m = mundo({ conversa })
    expect((await m.pedir({ acao: 'preparar', threadId: T1 })).corpo).toMatchObject({ disponivel: true, destinatario: 'marina@exemplo.com.br' })
    expect((await m.enviar()).corpo['estado']).toBe('ACCEPTED')
    expect(m.enviados.map((e) => e.destino)).toEqual(['marina@exemplo.com.br'])
    expect(decodificar(m.enviados[0]!.raw)).toContain('To: marina@exemplo.com.br')
    expect(decodificar(m.enviados[0]!.raw)).not.toContain('antigo@outra-empresa.com')
  })
  it('a ordem em que o banco devolve as identidades não muda o destino', () => {
    const a = [id('EMAIL', 'antigo@outra-empresa.com'), id('PORTAL', 'marina@exemplo.com.br')]
    expect(resolverDestinatario({ canal: 'PORTAL', identidades: a })).toEqual(resolverDestinatario({ canal: 'PORTAL', identidades: [...a].reverse() }))
    expect(resolverDestinatario({ canal: 'EMAIL', identidades: a })).toEqual({ ok: true, destino: 'antigo@outra-empresa.com' })
  })
  it('dois endereços possíveis sem critério seguro: ambíguo, nada é criado nem enviado', async () => {
    const doisNoFormulario: ConversaLida = { ...CONVERSA, identidades: [id('PORTAL', 'marina@exemplo.com.br'), id('PORTAL', 'compras@exemplo.com.br')] }
    const outroCanal: ConversaLida = { ...CONVERSA, canal: 'WHATSAPP', identidades: [id('EMAIL', 'a@exemplo.com.br'), id('PORTAL', 'b@exemplo.com.br')] }
    for (const conversa of [doisNoFormulario, outroCanal]) {
      expect(resolverDestinatario(conversa)).toEqual({ ok: false, erro: 'destinatario_ambiguo' })
      const m = mundo({ conversa })
      expect((await m.pedir({ acao: 'preparar', threadId: T1 })).corpo).toMatchObject({ disponivel: false, motivo: 'destinatario_ambiguo' })
      for (const destinatario of ['marina@exemplo.com.br', 'a@exemplo.com.br']) expect(await m.enviar({ destinatario })).toMatchObject({ status: 409, corpo: { erro: 'destinatario_ambiguo' } })
      expect(m.chamadas).toMatchObject({ criar: 0, token: 0, enviar: 0 })
    }
  })
  it('o mesmo endereço em duas identidades não é ambiguidade; conversa de outro canal com UM e-mail usa esse', () => {
    expect(resolverDestinatario({ canal: 'PORTAL', identidades: [id('PORTAL', 'Marina@Exemplo.com.br '), id('EMAIL', 'marina@exemplo.com.br')] })).toEqual({ ok: true, destino: 'marina@exemplo.com.br' })
    expect(resolverDestinatario({ canal: 'WHATSAPP', identidades: [id('WHATSAPP', '5562999990000'), id('PORTAL', 'marina@exemplo.com.br')] })).toEqual({ ok: true, destino: 'marina@exemplo.com.br' })
    expect(resolverDestinatario({ canal: 'PORTAL', identidades: [id('PORTAL', 'sem-arroba'), id('EMAIL', 'marina@exemplo.com.br')] })).toEqual({ ok: true, destino: 'marina@exemplo.com.br' })
    expect(resolverDestinatario({ canal: 'PORTAL', identidades: [id('WHATSAPP', 'marina@exemplo.com.br')] })).toEqual({ ok: false, erro: 'sem_email_valido' })
  })
  it('o navegador não escolhe o destino: endereço diferente do banco é recusa, nunca redirecionamento', async () => {
    const m = mundo()
    expect(await m.enviar({ destinatario: 'atacante@exemplo.org' })).toMatchObject({ status: 409, corpo: { erro: 'destinatario_mudou' } })
    expect(m.chamadas).toMatchObject({ criar: 0, token: 0, enviar: 0 })
    expect((await m.enviar({ destinatario: ' Marina@Exemplo.com.br ' })).corpo['estado']).toBe('ACCEPTED')
    expect(m.enviados.map((e) => e.destino)).toEqual([PARA])
  })
  it('o endereço mudou entre a confirmação e o envio: nada sai', async () => {
    const m = mundo()
    const visto = (await m.pedir({ acao: 'preparar', threadId: T1 })).corpo['destinatario'] as string
    m.deps.sessao.conversa = async () => ({ ...CONVERSA, identidades: [{ canal: 'PORTAL', identificador: 'novo@exemplo.com.br' }] })
    expect(await m.enviar({ destinatario: visto })).toMatchObject({ status: 409, corpo: { erro: 'destinatario_mudou' } })
    expect(m.chamadas).toMatchObject({ criar: 0, enviar: 0 })
  })
})

describe('regressão — endereço completo na confirmação', () => {
  it('quem pode enviar vê o endereço inteiro; quem não pode, nenhum', async () => {
    expect((await mundo().pedir({ acao: 'preparar', threadId: T1 })).corpo['destinatario']).toBe(PARA)
    for (const papel of ['Financeiro', 'Compras', 'Solicitante']) {
      const r = await mundo({ usuario: { ...ADMIN, papel } }).pedir({ acao: 'preparar', threadId: T1 })
      expect(r.status).toBe(403)
      expect(JSON.stringify(r.corpo)).not.toContain('exemplo.com.br')
    }
    const inativo = await mundo({ usuario: { ...ADMIN, ativo: false } }).pedir({ acao: 'preparar', threadId: T1 })
    expect(JSON.stringify(inativo.corpo)).not.toContain('exemplo.com.br')
  })
  it('conversa que a pessoa não enxerga (RLS) ou de outra organização não revela endereço', async () => {
    for (const conversa of [null, { ...CONVERSA, organizacaoId: 'outra-org' }]) {
      const r = await mundo({ conversa }).pedir({ acao: 'preparar', threadId: T1 })
      expect(r.corpo).toMatchObject({ disponivel: false, motivo: 'conversa_nao_encontrada' })
      expect(JSON.stringify(r.corpo)).not.toContain('exemplo.com.br')
    }
  })
  it('o endereço nunca vai para o log, em nenhuma ação', async () => {
    const m = mundo()
    await m.pedir({ acao: 'preparar', threadId: T1 }); await m.enviar(); await m.enviar({ destinatario: 'outro@exemplo.org', intencao: INT2 })
    expect(JSON.stringify(m.logs)).not.toMatch(/exemplo\.com\.br|exemplo\.org/)
  })
})

describe('regressão — «não foi enviado» exige confirmação explícita', () => {
  const desconhecida = async () => { const m = mundo({ envio: { tipo: 'tempo' } }); const r = await m.enviar(); return { m, id: r.corpo['entregaId'] as string } }
  it('sem a confirmação (ou com outra) o pedido é 400 e a entrega continua UNKNOWN', async () => {
    const { m, id } = await desconhecida()
    for (const extra of [{}, { confirmacao: true }, { confirmacao: 'sim' }, { confirmacao: '' }]) {
      expect((await m.pedir({ acao: 'reconciliar', entregaId: id, desfecho: 'nao_enviado', ...extra })).status).toBe(400)
    }
    expect(m.linhas[0]!.estado).toBe('UNKNOWN')
    // e continua bloqueando novo envio: nenhum e-mail a mais saiu
    expect(m.chamadas.enviar).toBe(1)
  })
  it('com a confirmação: FAILED, com quem declarou e o motivo no livro', async () => {
    const { m, id } = await desconhecida()
    const r = await m.pedir({ acao: 'reconciliar', entregaId: id, desfecho: 'nao_enviado', confirmacao: CONFIRMACAO_NAO_ENVIADO })
    expect(r.corpo).toMatchObject({ estado: 'FAILED', reconciliada: true })
    expect(m.linhas[0]).toMatchObject({ estado: 'FAILED', motivo: 'declarado_nao_enviado' })
    expect(m.logs.at(-1)).toMatchObject({ acao: 'reconciliar', outcome: 'declarado_nao_enviado', entregaId: id })
  })
  it('«encontrei em Enviados» não aceita a chave de confirmação (forma fechada)', () => {
    expect(lerPedido({ acao: 'reconciliar', entregaId: T1, desfecho: 'encontrado', confirmacao: CONFIRMACAO_NAO_ENVIADO })).toBeUndefined()
    expect(lerPedido({ acao: 'reconciliar', entregaId: T1, desfecho: 'nao_enviado', confirmacao: CONFIRMACAO_NAO_ENVIADO })).toEqual({ acao: 'reconciliar', entregaId: T1, desfecho: 'nao_enviado' })
  })
})

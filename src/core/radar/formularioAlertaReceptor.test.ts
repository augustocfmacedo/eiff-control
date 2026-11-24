/**
 * Prova isolada do ciclo de alerta (D3): observador → canal webhook assinado → HTTP REAL → receptor de referência →
 * destino simulado (no lugar do chat ou do e-mail). Nada sai da máquina: o servidor escuta em 127.0.0.1 numa porta
 * livre, e o único ajuste é trocar o endereço https de teste pelo servidor local (o papel de um terminador TLS).
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assinarWebhook, canalDoAmbiente } from './formularioAlertaCanais'
import { problemasDeDadoPessoal, type RodadaRegistrada } from './formularioMonitor'
import { portaMonitorMemoria } from './formularioMonitorPorta'
import { observar } from './formularioObservador'
import {
  TOLERANCIA_SEGUNDOS, mensagemParaChat, memoriaEmProcesso, receptorHttp, type AlertaRecebido, type DestinoAlerta,
} from './formularioAlertaReceptor'

const SEGREDO = 'segredo-do-receptor-de-teste-com-mais-de-32-chars'
const URL_TESTE = 'https://receptor.teste.invalido/alertas'
const H = 3_600_000
const T0 = Date.parse('2026-11-20T10:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

/** Destino simulado (o chat da equipe): guarda o que recebeu e pode ficar fora do ar. */
const destino = { nome: 'chat-simulado', fora: false, recebidos: [] as AlertaRecebido[], async encaminhar(a: AlertaRecebido) {
  if (destino.fora) throw new Error('chat fora do ar')
  destino.recebidos.push(a)
} } satisfies DestinoAlerta & Record<string, unknown>
const memoria = memoriaEmProcesso()
/** O receptor usa o relógio real, como o emissor (o canal assina com Date.now). */
const agoraSeg = () => Math.floor(Date.now() / 1000)
const handler = receptorHttp({ segredo: SEGREDO, destino, memoria, agoraSegundos: agoraSeg })

let servidor: Server
let porta = 0
const respostas: { status: number; desfecho: string }[] = []
beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const partes: Buffer[] = []
    for await (const p of req) partes.push(p as Buffer)
    const r = await handler(new Request(`http://127.0.0.1${req.url ?? '/'}`, {
      method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? Buffer.concat(partes) : undefined,
    }))
    const corpo = await r.text()
    respostas.push({ status: r.status, desfecho: (JSON.parse(corpo || '{}') as { desfecho?: string }).desfecho ?? '' })
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(corpo)
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()))
  porta = (servidor.address() as { port: number }).port
})
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())))

/** O «terminador TLS» do teste: o mesmo pedido, para o servidor local. */
const fetchLocal = ((url: string, init?: RequestInit) => fetch(String(url).replace('https://receptor.teste.invalido', `http://127.0.0.1:${porta}`), init)) as typeof fetch
const env = { FORMULARIO_MONITOR: 'ativo', FORMULARIO_INTERVALO_MIN: '60' }
const semRede = (async () => { throw new Error('o monitor não usa rede neste teste') }) as unknown as typeof fetch
const rodada = (horas: number, extra: Partial<RodadaRegistrada> = {}): RodadaRegistrada => ({
  em: iso(T0 + horas * H), desfecho: 'concluida', lidas: 14, elegiveis: 0, jaDentro: 0, processadas: 0, restam: 0, retidas: 14, recuperadas: 0, falhas: 0, ...extra,
})
const canal = (segredo = SEGREDO) => canalDoAmbiente({ FORMULARIO_ALERTA_CANAL: 'webhook', FORMULARIO_ALERTA_WEBHOOK_URL: URL_TESTE, FORMULARIO_ALERTA_WEBHOOK_SEGREDO: segredo }, fetchLocal, () => {})
const limpar = () => { destino.recebidos.length = 0; destino.fora = false; memoria.chaves.clear(); respostas.length = 0 }

describe('ciclo completo do alerta por HTTP real (D3)', () => {
  it('recuperação → webhook assinado → receptor confere → destino recebe UMA vez, sem dado pessoal, com tipo, severidade e chave', async () => {
    limpar()
    const p = portaMonitorMemoria()
    p.rodadas.push(rodada(0, { elegiveis: 1, processadas: 1, recuperadas: 1 }))
    p.definirAgora(iso(T0 + 0.1 * H))
    const o = await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: p })
    expect(o).toMatchObject({ novos: 1, pendentes: 0 })
    expect(respostas).toEqual([{ status: 200, desfecho: 'entregue' }])
    expect(destino.recebidos).toHaveLength(1)
    const a = destino.recebidos[0]!
    expect(a).toMatchObject({ tipo: 'RECUPERACAO', severidade: 'aviso', versao: 'v1' })
    expect(a.chave).toMatch(/^RECUPERACAO\|/)
    expect(problemasDeDadoPessoal(a)).toEqual([])
    expect(mensagemParaChat(a).text).toContain('[AVISO]')
    // passada seguinte: deduplicado no emissor, nada sai
    p.definirAgora(iso(T0 + 0.1 * H + 10 * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: p })).toMatchObject({ novos: 0, suprimidos: 1 })
    expect(respostas).toHaveLength(1)
  })

  it('assinatura com outro segredo: 401, nada chega ao destino, e o emissor mantém pendente', async () => {
    limpar()
    const p = portaMonitorMemoria()
    p.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    p.definirAgora(iso(T0 + 0.1 * H))
    const o = await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal('outro-segredo-qualquer-com-mais-de-32-caracteres'), porta: p })
    expect(o).toMatchObject({ novos: 0, pendentes: 1 })
    expect(respostas).toEqual([{ status: 401, desfecho: 'assinatura_invalida' }])
    expect(destino.recebidos).toHaveLength(0)
  })

  it('destino fora do ar: 503, o emissor reenvia na passada seguinte e o destino recebe uma vez quando volta', async () => {
    limpar()
    const p = portaMonitorMemoria()
    p.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    destino.fora = true
    p.definirAgora(iso(T0 + 0.1 * H))
    expect(await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: p })).toMatchObject({ pendentes: 1 })
    destino.fora = false
    p.definirAgora(iso(T0 + 0.1 * H + 10 * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: p })).toMatchObject({ novos: 1 })
    expect(respostas.map((r) => r.status)).toEqual([503, 200])
    expect(destino.recebidos).toHaveLength(1)
    expect(destino.recebidos[0]).toMatchObject({ tipo: 'FALHA_LEITURA', severidade: 'critico' })
  })

  it('reenvio da mesma entrega (o emissor não conseguiu gravar a confirmação): o receptor deduplica, o destino recebe uma vez', async () => {
    limpar()
    const p = portaMonitorMemoria()
    let falharConfirmacao = true
    const pFalha = { ...p, async confirmarEntrega(c: string, r: string, n: string) { if (falharConfirmacao) { falharConfirmacao = false; throw new Error('postgrest POST audit_log http 503') } return p.confirmarEntrega(c, r, n) } }
    p.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    p.definirAgora(iso(T0 + 0.1 * H))
    const o1 = await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: pFalha })
    expect(o1.desfecho).toBe('erro')
    p.definirAgora(iso(T0 + 0.1 * H + 10 * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: p.agora, canal: canal(), porta: pFalha })).toMatchObject({ novos: 1 })
    expect(respostas.map((r) => r.desfecho)).toEqual(['entregue', 'duplicado'])
    expect(destino.recebidos).toHaveLength(1)
  })
})

describe('o receptor recusa o que não deve passar', () => {
  const postar = async (corpo: string, cab: Record<string, string>) => {
    const r = await fetch(`http://127.0.0.1:${porta}/alertas`, { method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: corpo })
    return { status: r.status, desfecho: ((await r.json()) as { desfecho: string }).desfecho }
  }
  const assinado = async (obj: Record<string, unknown>, ts = String(agoraSeg())) => {
    const corpo = JSON.stringify(obj)
    return { corpo, cab: { 'x-eiff-timestamp': ts, 'x-eiff-assinatura': `v1=${await assinarWebhook(SEGREDO, ts, corpo)}`, 'x-eiff-entrega': String(obj['chave'] ?? '') } }
  }
  const valido = { tipo: 'RECUPERACAO', severidade: 'aviso', titulo: '[AVISO] x', texto: 'y', acao: 'z', desde: iso(T0), em: iso(T0), contagens: {}, chave: 'RECUPERACAO|-|aviso|2026-11-20T10:00:00.000Z', origem: 'teste', versao: 'v1' }

  it('mensagem antiga reenviada (fora da tolerância de 5 min): 401', async () => {
    limpar()
    const { corpo, cab } = await assinado(valido, String(agoraSeg() - TOLERANCIA_SEGUNDOS - 1))
    expect(await postar(corpo, cab)).toEqual({ status: 401, desfecho: 'horario_invalido' })
  })
  it('corpo alterado depois de assinado: 401', async () => {
    const { cab } = await assinado(valido)
    expect(await postar(JSON.stringify({ ...valido, severidade: 'info' }), cab)).toEqual({ status: 401, desfecho: 'assinatura_invalida' })
  })
  it('dado pessoal, mesmo assinado: 422 e nada ao destino', async () => {
    limpar()
    const { corpo, cab } = await assinado({ ...valido, texto: 'contato ana@exemplo.com' })
    expect(await postar(corpo, cab)).toEqual({ status: 422, desfecho: 'dado_pessoal' })
    expect(destino.recebidos).toHaveLength(0)
  })
  it('chave do corpo diferente da entrega do cabeçalho, versão ou tipo desconhecidos: 400', async () => {
    for (const obj of [{ ...valido, versao: 'v9' }, { ...valido, tipo: 'INVENTADO' }]) {
      const { corpo, cab } = await assinado(obj)
      expect(await postar(corpo, cab)).toEqual({ status: 400, desfecho: 'corpo_invalido' })
    }
    const { corpo, cab } = await assinado(valido)
    expect(await postar(corpo, { ...cab, 'x-eiff-entrega': 'outra' })).toEqual({ status: 400, desfecho: 'corpo_invalido' })
  })
  it('só POST', async () => {
    expect((await fetch(`http://127.0.0.1:${porta}/alertas`)).status).toBe(405)
  })
})

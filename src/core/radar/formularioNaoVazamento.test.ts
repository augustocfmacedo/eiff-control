/**
 * NÃO VAZAMENTO: nenhuma credencial sai em log, resumo, relatório ou corpo de resposta do caminho do formulário.
 *
 * POR QUE EXISTE (GO-3, etapa 1). O Node inclui o valor do cabeçalho na mensagem de alguns erros de `fetch`, e o
 * caminho do formulário registrava `(e as Error).message` em seis pontos: a rodada agendada (leitura, estado e
 * gravação), a borda, a porta do banco e o roteador. Aqui cada ponto é exercitado com uma exceção que CARREGA uma
 * credencial fictícia — em `message`, em `cause.message` e até em `cause.code` — e a prova é sempre a mesma: a
 * credencial não aparece em NADA do que o código produz.
 *
 * As credenciais são fictícias e reconhecíveis. Nenhuma requisição real é feita: `fetch` e portas são injetados.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODIGOS_RECUSA_INGEST } from '../inbox/ingestaoServidor'
import { resultadoIngest } from '../inbox/ingestaoPorta'
import { CODIGOS_RECUSA_ROTEAMENTO, MOTIVOS_ROTEAMENTO } from '../inbox/roteamentoPorta'
import { corpoDaResposta, rodadaDeReconciliacao, type AmbienteAgendado, type DepsAgendado } from './formularioAgendado'
import { tratarPedidoFormulario } from './formularioBorda'
import { ErroDeGravacao, gravarSubmissao, type PortasGravacao } from './formularioGravacao'
import { montarPortasIntegracao } from './formularioPorta'
import { validarCorpo } from './formularioServidor'
import { corpoDaSubmissaoNetlify } from './formularioTransporte'
import { FORMULARIOS } from './formularioSite'
import type { RegistroFonte } from './types'

const TOKEN_NETLIFY = 'nfp_FICTICIO_tokenDeLeitura_7c1e9a_NAO_PODE_VAZAR'
const CHAVE_BANCO = 'srv_FICTICIA_chaveDeServico_44b0d2_NAO_PODE_VAZAR'
const SEGREDO_BORDA = 'seg_FICTICIO_segredoDoEndpoint_a93f10_NAO_PODE_VAZAR'
const SEGREDOS = [TOKEN_NETLIFY, CHAVE_BANCO, SEGREDO_BORDA]
/** Dado pessoal fictício do lead: também não pode aparecer em log de falha. */
const EMAIL_DO_LEAD = 'lead-ficticio-nao-vazar@exemplo.invalido'

const FONTE = 'FNT-WEBSITE'
const ORG = 'ORG-EIFF'
const MARCO = '2026-11-10T00:00:00.000Z'

/** Tudo o que o código produziu, num texto só: é nele que se procura o que não pode estar. */
const tudo = (...partes: unknown[]): string => partes.map((p) => {
  try { return JSON.stringify(p) ?? String(p) } catch { return String(p) }
}).join('\n')
const semSegredos = (texto: string, extras: string[] = []) => {
  for (const s of [...SEGREDOS, ...extras]) expect(texto, `vazou: ${s.slice(0, 12)}…`).not.toContain(s)
  expect(texto).not.toMatch(/Bearer /)
  expect(texto).not.toMatch(/authorization/i)
}

/** As formas reais em que o Node põe o valor do cabeçalho numa exceção, mais as que um teste hostil inventaria. */
const excecoesComSegredo = (segredo: string): Record<string, () => Error> => ({
  'valor na message (Headers.append)': () => new TypeError(`Headers.append: "Bearer ${segredo}" is an invalid header value.`),
  'valor na cause.message': () => new TypeError('fetch failed', { cause: Object.assign(new Error(`invalid authorization header Bearer ${segredo}`), { code: 'UND_ERR_INVALID_ARG' }) }),
  'valor no cause.code': () => new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: segredo }) }),
  'valor em mensagem qualquer': () => new Error(`falha inesperada; authorization: Bearer ${segredo}; lead ${EMAIL_DO_LEAD}`),
  'valor junto de um status HTTP': () => new Error(`postgrest POST radar_source_record http 500 apikey=${segredo}`),
})

const submissao = (id: string, criadoEm = '2026-11-11T10:00:00Z') => ({
  id, form_name: 'simular-galpao', state: 'verified', created_at: criadoEm,
  data: {
    nome: 'Lead Fictício', email: EMAIL_DO_LEAD, telefone: '62 90000-0000', empresa: 'Empresa Fictícia',
    cidade: 'Goiânia, GO', uso: 'industrial', area: '900', observacao: 'Preciso de um galpão.',
  },
})

interface Falhas { recusaIngest?: string; estado?: () => Error; evidencia?: () => Error; conversa?: () => Error; prazoLer?: () => Error; prazoGravar?: () => Error; contato?: () => Error }

/** Portas em memória, com a falha pedida em cada etapa. */
function portasCom(f: Falhas = {}) {
  const registros: RegistroFonte[] = []
  const conversas = new Set<string>()
  const logs: Record<string, unknown>[] = []
  const portas: PortasGravacao = {
    async fonte(fonteId) { return { id: fonteId, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: true } },
    async registrosDaSubmissao(fonteId, externoId) { return registros.filter((r) => r.fonteId === fonteId && r.externoId === externoId) },
    async conversaExiste(_p, id) { return conversas.has(id) },
    async gravarEvidencia(linha) {
      if (f.evidencia) throw f.evidencia()
      const id = `RF-${registros.length + 1}`
      registros.push({ id, fonteId: String(linha['source_id']), tipo: linha['record_type'] as RegistroFonte['tipo'], externoId: String(linha['external_id']), payload: linha['payload'], recebidoEm: String(linha['received_at']), payloadFingerprint: String(linha['payload_fingerprint']), statusIntake: 'PENDING' })
      return id
    },
    async ingerir(p) {
      if (f.conversa) throw f.conversa()
      if (f.recusaIngest !== undefined) return { ok: false, erro: f.recusaIngest }
      conversas.add(p.externalMessageId)
      return { ok: true, duplicada: false, threadId: `THR-${p.externalMessageId}`, messageId: `MSG-${p.externalMessageId}`, contactId: 'CTI-1', novaThread: true }
    },
    async prazoDaConversa(_p, id) {
      if (f.prazoLer) throw f.prazoLer()
      return conversas.has(id) ? { threadId: `THR-${id}`, venceEm: '2026-11-12T10:00:00.000Z', aberta: true, abertaEm: '2026-11-11T10:00:00.000Z' } : undefined
    },
    async definirPrazo(_t, venceEm) { if (f.prazoGravar) throw f.prazoGravar(); return venceEm },
    async estadoEmLote() { if (f.estado) throw f.estado(); return { evidencias: [], conversas: [], prazos: [] } },
    async completarContato() { if (f.contato) throw f.contato(); return { campos: [], identidades: 0 } },
    log: (t) => { logs.push(t) },
  }
  return { portas, registros, conversas, logs }
}

interface CenarioRodada { env?: Partial<AmbienteAgendado>; fetch?: (url: string, init?: RequestInit) => Promise<Response>; falhas?: Falhas; submissoes?: unknown[] }

function rodada(c: CenarioRodada = {}) {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const logs: Record<string, unknown>[] = []
  const banco = portasCom(c.falhas)
  const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)
  const padrao = async (url: string) => {
    if (url.endsWith('/forms')) return ok([{ id: 'F1', name: 'simular-galpao' }])
    if (url.includes('/submissions')) return ok(url.includes('page=1') ? (c.submissoes ?? [submissao('s1')]) : [])
    return ok([])
  }
  const env: AmbienteAgendado = { FORMULARIO_RECONCILIACAO: 'ativa', EIFF_FORM_MARCO: MARCO, EIFF_FORM_NETLIFY_SITE: 'site-eiff', NETLIFY_AUTH_TOKEN: TOKEN_NETLIFY, ...c.env }
  const deps: DepsAgendado = {
    fetch: (async (url: string, init?: RequestInit) => { chamadas.push({ url: String(url), init }); return (c.fetch ?? padrao)(String(url), init) }) as unknown as typeof fetch,
    agora: () => 0, agoraIso: () => '2026-11-12T10:00:00.000Z',
    log: (t) => { logs.push(t) },
    portas: { portas: banco.portas, fonteId: FONTE, organizacaoId: ORG },
  }
  return { env, deps, chamadas, logs, banco, executar: async () => { const r = await rodadaDeReconciliacao(env, deps); return { r, saida: tudo(r, corpoDaResposta(r), logs, banco.logs) } } }
}

/* =============================================================== rodada agendada · credencial */

describe('rodada agendada · a credencial é conferida ANTES de qualquer requisição', () => {
  it('token ausente: nenhuma requisição, código e nome da variável', async () => {
    for (const valor of [undefined, '', '   ']) {
      const m = rodada({ env: { NETLIFY_AUTH_TOKEN: valor } })
      const { r, saida } = await m.executar()
      expect(r.desfecho).toBe('erro_de_leitura')
      expect(r.motivo).toBe('CREDENCIAL_AUSENTE: NETLIFY_AUTH_TOKEN')
      expect(m.chamadas).toEqual([])
      semSegredos(saida)
    }
  })

  it('token com caractere de controle, quebra interna ou fora do Latin-1: nenhuma requisição e o valor não aparece', async () => {
    for (const sujo of [`${TOKEN_NETLIFY}\u0016`, `\u001b${TOKEN_NETLIFY}`, `${TOKEN_NETLIFY}\nX`, `${TOKEN_NETLIFY}\u007f`, `${TOKEN_NETLIFY}—`, `nfp\ufeff${TOKEN_NETLIFY}`]) {
      const m = rodada({ env: { NETLIFY_AUTH_TOKEN: sujo } })
      const { r, saida } = await m.executar()
      expect(r.desfecho, JSON.stringify(sujo.slice(-3))).toBe('erro_de_leitura')
      expect(r.motivo).toBe('CREDENCIAL_INVALIDA: NETLIFY_AUTH_TOKEN')
      expect(m.chamadas).toEqual([])
      expect(m.banco.registros).toEqual([])
      semSegredos(saida)
    }
  })

  it('token válido não é alterado: vai inteiro no cabeçalho, e só as pontas em branco são ignoradas', async () => {
    const m = rodada({ env: { NETLIFY_AUTH_TOKEN: `  ${TOKEN_NETLIFY}\r\n` } })
    await m.executar()
    expect(m.chamadas.length).toBeGreaterThan(0)
    for (const c of m.chamadas) expect((c.init?.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TOKEN_NETLIFY}`)
  })
})

/* =============================================================== rodada agendada · falhas */

describe('rodada agendada · falha de LEITURA das submissões', () => {
  for (const [nome, fabricar] of Object.entries(excecoesComSegredo(TOKEN_NETLIFY))) {
    it(`exceção com ${nome}: vira desfecho, e a credencial não sai`, async () => {
      const m = rodada({ fetch: async () => { throw fabricar() } })
      const { r, saida } = await m.executar()
      expect(r.desfecho).toBe('erro_de_leitura')
      expect(r.motivo).toMatch(/^FALHA_LEITURA: (CREDENCIAL_INVALIDA|ERRO_REDE|ERRO_HTTP|SEM_CODIGO)/)
      expect(m.banco.registros).toEqual([])
      semSegredos(saida, [EMAIL_DO_LEAD])
    })
  }

  it('falha de rede: o código técnico da causa é preservado', async () => {
    const m = rodada({ fetch: async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ECONNREFUSED 10.0.0.1:443 Bearer ${TOKEN_NETLIFY}`), { code: 'ECONNREFUSED' }) }) } })
    const { r, saida } = await m.executar()
    expect(r.motivo).toBe('FALHA_LEITURA: ERRO_REDE ECONNREFUSED')
    semSegredos(saida)
  })

  for (const status of [401, 403, 500]) {
    it(`HTTP ${status} na leitura: o status é preservado e nada é gravado`, async () => {
      const m = rodada({ fetch: async () => ({ ok: false, status, json: async () => ({ message: `token ${TOKEN_NETLIFY} recusado` }), text: async () => TOKEN_NETLIFY } as unknown as Response) })
      const { r, saida } = await m.executar()
      expect(r.desfecho).toBe('erro_de_leitura')
      expect(r.motivo).toBe(`lista de formulários: http ${status}`)
      expect(m.banco.registros).toEqual([])
      semSegredos(saida)
    })
  }

  it('HTTP de erro na página de submissões, e resposta ilegível', async () => {
    const lista = { ok: true, status: 200, json: async () => [{ id: 'F1', name: 'simular-galpao' }] } as unknown as Response
    let m = rodada({ fetch: async (url) => (url.endsWith('/forms') ? lista : { ok: false, status: 403, json: async () => ({}) } as unknown as Response) })
    let x = await m.executar()
    expect(x.r.motivo).toBe('submissões: http 403'); semSegredos(x.saida)
    m = rodada({ fetch: async (url) => (url.endsWith('/forms') ? lista : { ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token; Bearer ${TOKEN_NETLIFY}`) } } as unknown as Response) })
    x = await m.executar()
    expect(x.r.desfecho).toBe('erro_de_leitura'); expect(x.r.motivo).toBe('FALHA_LEITURA: SEM_CODIGO'); semSegredos(x.saida)
  })
})

describe('rodada agendada · falha na consulta ao ESTADO do banco', () => {
  for (const [nome, fabricar] of Object.entries(excecoesComSegredo(CHAVE_BANCO))) {
    it(`exceção com ${nome}: a rodada continua, registra a etapa e não vaza`, async () => {
      const m = rodada({ falhas: { estado: fabricar } })
      const { r, saida } = await m.executar()
      expect(r.desfecho).toBe('concluida')
      expect(r.recuperadas).toBe(1) // sem o estado em lote, cada submissão ainda é idempotente uma a uma
      const log = m.logs.find((l) => l['evento'] === 'RECONCILIACAO_ESTADO')!
      expect(log).toMatchObject({ outcome: 'indisponivel', etapa: 'estado' })
      expect(['CREDENCIAL_INVALIDA', 'ERRO_REDE', 'ERRO_HTTP', 'SEM_CODIGO']).toContain(log['codigo'])
      semSegredos(saida, [EMAIL_DO_LEAD])
    })
  }
})

describe('rodada agendada · falha de GRAVAÇÃO', () => {
  const etapas: [keyof Falhas, string][] = [['evidencia', 'evidencia'], ['conversa', 'conversa'], ['prazoLer', 'prazo'], ['prazoGravar', 'prazo']]
  for (const [onde, etapa] of etapas) {
    for (const [nome, fabricar] of Object.entries(excecoesComSegredo(CHAVE_BANCO))) {
      it(`${onde} · exceção com ${nome}: conta a falha, registra a etapa «${etapa}» e não vaza`, async () => {
        // o prazo só é gravado quando difere do que a conversa tem: a submissão de sexta à noite garante a diferença
        const m = rodada({ falhas: { [onde]: fabricar }, submissoes: [submissao('s1', '2026-11-13T22:00:00Z')] })
        const { r, saida } = await m.executar()
        expect(r.desfecho).toBe('concluida')
        expect(r.falhas).toBe(1)
        expect(r.recuperadas).toBe(0)
        const log = m.logs.find((l) => l['evento'] === 'RECONCILIACAO_FALHA')!
        expect(log).toMatchObject({ codigo: 'FALHA_GRAVACAO', etapa })
        expect(String(log['motivo'])).toMatch(/^(CREDENCIAL_INVALIDA|ERRO_REDE|ERRO_HTTP|SEM_CODIGO)/)
        semSegredos(saida, [EMAIL_DO_LEAD])
      })
    }
  }

  it('erro HTTP do banco na gravação: status e operação preservados', async () => {
    const m = rodada({ falhas: { evidencia: () => new Error('postgrest POST radar_source_record http 503') } })
    const { saida } = await m.executar()
    expect(m.logs.find((l) => l['evento'] === 'RECONCILIACAO_FALHA')).toMatchObject({ codigo: 'FALHA_GRAVACAO', etapa: 'evidencia', motivo: 'ERRO_HTTP 503 (postgrest POST radar_source_record)' })
    semSegredos(saida)
  })

  it('falha ao completar o contato (não fatal): o log da porta também não vaza', async () => {
    const m = rodada({ falhas: { contato: excecoesComSegredo(CHAVE_BANCO)['valor na message (Headers.append)']! } })
    const { r, saida } = await m.executar()
    expect(r.recuperadas).toBe(1)
    expect(m.banco.logs.find((l) => l['evento'] === 'formulario_contato')).toMatchObject({ outcome: 'falhou', motivo: 'CREDENCIAL_INVALIDA' })
    semSegredos(saida, [EMAIL_DO_LEAD])
  })
})

/* =============================================================== gravação · o erro que sobe */

describe('gravarSubmissao · o erro lançado não carrega a mensagem bruta', () => {
  const sub = (() => {
    const t = corpoDaSubmissaoNetlify(submissao('s9'), { formulariosAceitos: FORMULARIOS })
    if (!t.ok) throw new Error('fixture')
    const v = validarCorpo(t.corpo)
    if (!v.ok) throw new Error('fixture')
    return v.submissao
  })()
  for (const [nome, fabricar] of Object.entries(excecoesComSegredo(CHAVE_BANCO))) {
    it(`evidência · ${nome}`, async () => {
      let erro: (Error & { detalhe?: string }) | undefined
      try { await gravarSubmissao(sub, FONTE, ORG, portasCom({ evidencia: fabricar }).portas) } catch (e) { erro = e as Error & { detalhe?: string } }
      if (erro === undefined) throw new Error('a gravação deveria ter falhado')
      expect(erro).toBeInstanceOf(Error)
      semSegredos(tudo(erro.message, erro.detalhe, String(erro), erro.stack?.split('\n')[0]), [EMAIL_DO_LEAD])
    })
  }
})

/* =============================================================== borda */

describe('borda /api/formulario-site · log e corpo de resposta', () => {
  const env = { EIFF_FORM_SECRET: SEGREDO_BORDA, EIFF_FORM_SOURCE_ID: 'FNT-SITE', SUPABASE_SERVICE_ROLE_KEY: CHAVE_BANCO, EIFF_INBOX_ORGANIZATION_ID: 'ORG-1', SUPABASE_URL: 'https://banco.exemplo', EIFF_INBOX_ROUTER_ENABLED: 'false' }
  const pedir = (fetchFn: typeof fetch, ambiente: Record<string, string | undefined> = env) => {
    const logs: unknown[] = []
    const req = new Request('https://eiffcontrol.com.br/api/formulario-site', { method: 'POST', headers: { 'content-type': 'application/json', 'x-eiff-form-secret': SEGREDO_BORDA }, body: JSON.stringify({ payload: submissao('nf-1') }) })
    return tratarPedidoFormulario(req, { env: ambiente, fetch: fetchFn, log: (t) => { logs.push(t) } }).then((r) => ({ r, logs, saida: tudo(r, logs) }))
  }
  const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)

  for (const [nome, fabricar] of Object.entries(excecoesComSegredo(CHAVE_BANCO))) {
    it(`banco lança com ${nome}: resposta 5xx sem a credencial, e o log idem`, async () => {
      const x = await pedir((async (url: string) => {
        if (String(url).includes('radar_source?')) return ok([{ id: 'FNT-SITE', code: 'WEBSITE', source_type: 'WEBSITE', active: true }])
        throw fabricar()
      }) as unknown as typeof fetch)
      expect(x.r.status).toBeGreaterThanOrEqual(500)
      semSegredos(x.saida, [EMAIL_DO_LEAD])
    })
  }

  for (const status of [401, 403, 500]) {
    it(`banco responde HTTP ${status} na gravação: 502 com a etapa, e o status no log`, async () => {
      const x = await pedir((async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('radar_source?')) return ok([{ id: 'FNT-SITE', code: 'WEBSITE', source_type: 'WEBSITE', active: true }])
        if (u.includes('radar_source_record') && init?.method === 'POST') return { ok: false, status, json: async () => ({ message: CHAVE_BANCO }) } as unknown as Response
        return ok([])
      }) as unknown as typeof fetch)
      expect(x.r).toEqual({ status: 502, corpo: { erro: 'gravacao_falhou', etapa: 'evidencia' } })
      expect(x.logs).toContainEqual(expect.objectContaining({ resultado: 'falhou', etapa: 'evidencia', motivo: `ERRO_HTTP ${status} (postgrest POST radar_source_record)` }))
      semSegredos(x.saida, [EMAIL_DO_LEAD])
    })
  }

  it('chave de serviço com caractere inválido: 503 antes de qualquer requisição, com o NOME da variável', async () => {
    let chamadas = 0
    const x = await pedir((async () => { chamadas += 1; return ok([]) }) as unknown as typeof fetch, { ...env, SUPABASE_SERVICE_ROLE_KEY: `${CHAVE_BANCO}\u0016` })
    expect(x.r).toEqual({ status: 503, corpo: { erro: 'integracao_nao_configurada', motivo: 'CREDENCIAL_INVALIDA: SUPABASE_SERVICE_ROLE_KEY' } })
    expect(chamadas).toBe(0)
    semSegredos(x.saida)
  })

  it('montarPortasIntegracao recusa a chave inválida e aceita a válida sem alterá-la', () => {
    const fetchFn = (async () => ok([])) as unknown as typeof fetch
    expect(montarPortasIntegracao({ ...env, SUPABASE_SERVICE_ROLE_KEY: `${CHAVE_BANCO}\nX` }, { fetch: fetchFn })).toEqual({ ok: false, motivo: 'CREDENCIAL_INVALIDA: SUPABASE_SERVICE_ROLE_KEY' })
    const boa = montarPortasIntegracao(env, { fetch: fetchFn })
    expect(boa.ok).toBe(true)
    if (boa.ok) expect(boa.cfg.chave).toBe(CHAVE_BANCO)
  })
})

/* =============================================================== código devolvido pela RPC */

describe('texto devolvido pela RPC inbox_ingest nunca vai direto ao detalhe, ao log, ao relatório nem à resposta', () => {
  const SEGREDO_RPC = 'SEGREDO_FICTICIO_123456'
  const sub = (() => {
    const t = corpoDaSubmissaoNetlify(submissao('s-rpc'), { formulariosAceitos: FORMULARIOS })
    if (!t.ok) throw new Error('fixture')
    const v = validarCorpo(t.corpo)
    if (!v.ok) throw new Error('fixture')
    return v.submissao
  })()
  const falhar = async (recusaIngest: string): Promise<ErroDeGravacao> => {
    try { await gravarSubmissao(sub, FONTE, ORG, portasCom({ recusaIngest }).portas) } catch (e) { return e as ErroDeGravacao }
    throw new Error('a gravação deveria ter falhado')
  }

  it('detalhe da exceção: o texto da RPC vira o marcador fixo', async () => {
    const erro = await falhar(SEGREDO_RPC)
    expect(erro).toBeInstanceOf(ErroDeGravacao)
    expect(erro.etapa).toBe('conversa')
    expect(erro.detalhe).toBe('rpc recusou: CODIGO_NAO_CATALOGADO')
    semSegredos(tudo(erro.message, erro.detalhe, String(erro)), [SEGREDO_RPC])
  })

  it('código legítimo da RPC é preservado, e a ausência de código também tem texto fixo', async () => {
    for (const codigo of CODIGOS_RECUSA_INGEST) expect((await falhar(codigo)).detalhe).toBe(`rpc recusou: ${codigo}`)
    expect((await falhar('')).detalhe).toBe('rpc recusou: recusado')
  })

  it('reconciliação agendada: log da falha, resumo e corpo de resposta sem o texto da RPC', async () => {
    const m = rodada({ falhas: { recusaIngest: SEGREDO_RPC } })
    const { r, saida } = await m.executar()
    expect(r.desfecho).toBe('concluida')
    expect(r.falhas).toBe(1)
    expect(m.logs.find((l) => l['evento'] === 'RECONCILIACAO_FALHA')).toMatchObject({ codigo: 'FALHA_GRAVACAO', etapa: 'conversa', motivo: 'rpc recusou: CODIGO_NAO_CATALOGADO' })
    semSegredos(saida, [SEGREDO_RPC, EMAIL_DO_LEAD])
  })

  it('borda: a RPC responde { ok: false, erro: <texto> } e nem o log nem o corpo da resposta o reproduzem', async () => {
    const logs: unknown[] = []
    const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/rpc/inbox_ingest')) return ok({ ok: false, erro: SEGREDO_RPC })
      if (u.includes('radar_source?')) return ok([{ id: 'FNT-SITE', code: 'WEBSITE', source_type: 'WEBSITE', active: true }])
      if (u.includes('radar_source_record') && init?.method === 'POST') return ok([{ id: 'RF-1' }])
      return ok([])
    }) as unknown as typeof fetch
    const req = new Request('https://eiffcontrol.com.br/api/formulario-site', { method: 'POST', headers: { 'content-type': 'application/json', 'x-eiff-form-secret': SEGREDO_BORDA }, body: JSON.stringify({ payload: submissao('nf-rpc') }) })
    const r = await tratarPedidoFormulario(req, {
      env: { EIFF_FORM_SECRET: SEGREDO_BORDA, EIFF_FORM_SOURCE_ID: 'FNT-SITE', SUPABASE_SERVICE_ROLE_KEY: CHAVE_BANCO, EIFF_INBOX_ORGANIZATION_ID: 'ORG-1', SUPABASE_URL: 'https://banco.exemplo', EIFF_INBOX_ROUTER_ENABLED: 'false' },
      fetch: fetchFn, log: (t) => { logs.push(t) },
    })
    expect(r).toEqual({ status: 502, corpo: { erro: 'gravacao_falhou', etapa: 'conversa' } })
    expect(logs).toContainEqual(expect.objectContaining({ resultado: 'falhou', etapa: 'conversa', motivo: 'rpc recusou: CODIGO_NAO_CATALOGADO' }))
    semSegredos(tudo(r, logs), [SEGREDO_RPC, EMAIL_DO_LEAD])
  })

  it('na fronteira com a RPC o texto já sai saneado', () => {
    expect(resultadoIngest({ ok: false, erro: SEGREDO_RPC }).erro).toBe('CODIGO_NAO_CATALOGADO')
    expect(resultadoIngest({ ok: false, erro: 'canal' }).erro).toBe('canal')
    expect(resultadoIngest({ ok: true }).erro).toBeUndefined()
  })

  it('os catálogos são exatamente os códigos que as RPCs devolvem nas migrations', () => {
    const pasta = path.resolve('supabase', 'migrations')
    const corpoDa = (arquivo: string, funcao: string): string => {
      const sql = fs.readFileSync(path.join(pasta, arquivo), 'utf8')
      const inicio = sql.indexOf(`create or replace function ${funcao}(`)
      expect(inicio, funcao).toBeGreaterThan(-1)
      return sql.slice(inicio, sql.indexOf('\n$$;', inicio))
    }
    const codigos = (texto: string, chave: string) => new Set([...texto.matchAll(new RegExp(`'${chave}', *'([a-z_]+)'`, 'g'))].map((x) => x[1]!))
    const ingest = corpoDa('0056_inbox.sql', 'inbox_ingest')
    expect(codigos(ingest, 'erro')).toEqual(new Set(CODIGOS_RECUSA_INGEST))
    const roteamento = corpoDa('0057_inbox_octopus_router.sql', 'inbox_apply_routing')
    expect(codigos(roteamento, 'erro')).toEqual(new Set(CODIGOS_RECUSA_ROTEAMENTO))
    // motivos: os literais devolvidos e o que entra por variável (v_motivo := '…', coalesce(v_motivo, '…'))
    const motivos = new Set([...codigos(roteamento, 'motivo'), ...[...roteamento.matchAll(/v_motivo(?: :=|,) *'([a-z_]+)'/g)].map((x) => x[1]!)])
    expect(motivos).toEqual(new Set(MOTIVOS_ROTEAMENTO))
  })
})

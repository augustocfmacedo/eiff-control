/**
 * As portas reais (PostgREST). Sem rede: `fetch` é injetado.
 *
 * O que estes testes protegem: a chave de serviço ignora RLS, então o filtro
 * de organização é NOSSO e tem de estar em cada consulta; o erro nunca ecoa
 * corpo nem chave; o id de volta é a confirmação da gravação; e completar o
 * contato só preenche o que está vazio.
 */
import { describe, expect, it } from 'vitest'
import { configPortaFormulario, portasFormularioRest, registroDoBanco, SUPABASE_URL_PADRAO } from './formularioPorta'
import type { DadosDoContato } from '../inbox/formularioSite'

const CFG = { url: 'https://banco.exemplo', chave: 'chave-de-servico-secreta', organizacaoId: 'ORG-1', fonteId: 'FNT-SITE' }

interface Chamada { url: string; metodo: string; corpo?: unknown; prefer?: string }

function falso(respostas: Record<string, unknown[] | { status: number }>) {
  const chamadas: Chamada[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const caminho = url.replace(`${CFG.url}/rest/v1/`, '')
    const h = (init?.headers ?? {}) as Record<string, string>
    chamadas.push({
      url: caminho, metodo: init?.method ?? 'GET',
      ...(init?.body !== undefined ? { corpo: JSON.parse(String(init.body)) } : {}),
      ...(h['prefer'] !== undefined ? { prefer: h['prefer'] } : {}),
    })
    // casa pela TABELA exata: `inbox_contact` é prefixo de `inbox_contact_identity`
    const tabela = caminho.split('?')[0]
    const chave = Object.keys(respostas).find((k) => k === tabela)
    const r = chave === undefined ? [] : respostas[chave]!
    if (!Array.isArray(r)) return { ok: false, status: r.status, json: async () => ({ message: 'detalhe que não deve vazar' }) } as unknown as Response
    return { ok: true, status: 200, json: async () => r } as unknown as Response
  }) as unknown as typeof fetch
  return { chamadas, fetchFn }
}

const LINHA = {
  id: 'RF-1', source_id: 'FNT-SITE', record_type: 'empresa', external_id: 'nf-777',
  payload: { schema: 'FORMULARIO_SITE_V1' }, payload_fingerprint: 'abc', intake_status: 'PENDING',
  entity_id: null, received_at: '2026-11-09T14:00:00.000Z', decided_at: null, decided_by: null, decision_reason: null,
}

describe('porta · configuração', () => {
  it('exige chave, organização e fonte — e diz qual falta', () => {
    expect(configPortaFormulario({})).toEqual({ motivo: 'sem SUPABASE_SERVICE_ROLE_KEY' })
    expect(configPortaFormulario({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({ motivo: 'sem EIFF_INBOX_ORGANIZATION_ID' })
    expect(configPortaFormulario({ SUPABASE_SERVICE_ROLE_KEY: 'k', EIFF_INBOX_ORGANIZATION_ID: 'o' })).toEqual({ motivo: 'sem EIFF_FORM_SOURCE_ID' })
  })

  it('completa com o projeto conhecido e tira a barra final', () => {
    const c = configPortaFormulario({ SUPABASE_SERVICE_ROLE_KEY: 'k', EIFF_INBOX_ORGANIZATION_ID: 'o', EIFF_FORM_SOURCE_ID: 'f' })
    expect(c).toMatchObject({ url: SUPABASE_URL_PADRAO, organizacaoId: 'o', fonteId: 'f' })
    const d = configPortaFormulario({ SUPABASE_URL: 'https://x.y/', SUPABASE_SERVICE_ROLE_KEY: 'k', EIFF_INBOX_ORGANIZATION_ID: 'o', EIFF_FORM_SOURCE_ID: 'f' })
    expect((d as { url: string }).url).toBe('https://x.y')
  })
})

describe('porta · a organização está em toda consulta', () => {
  it('leitura de evidência, de conversa, de identidade e de contato', async () => {
    const { chamadas, fetchFn } = falso({ radar_source_record: [LINHA], inbox_message: [], inbox_contact_identity: [{ contact_id: 'CTI-1' }], inbox_contact: [{ id: 'CTI-1', name: 'x', company_name: null, relation_kind: 'desconhecido' }] })
    const p = portasFormularioRest(CFG, fetchFn)
    await p.registrosDaSubmissao('FNT-SITE', 'nf-777')
    await p.conversaExiste('MANUAL', 'nf-777')
    await p.contatoDaIdentidade!('PORTAL', 'ana@exemplo.com.br')
    for (const c of chamadas) expect(c.url).toContain('organization_id=eq.ORG-1')
  })

  it('e a linha gravada também carrega a organização', async () => {
    const { chamadas, fetchFn } = falso({ radar_source_record: [{ id: 'RF-9' }] })
    const p = portasFormularioRest(CFG, fetchFn)
    await p.gravarEvidencia({ organization_id: 'ORG-1', source_id: 'FNT-SITE' })
    expect((chamadas[0]!.corpo as Record<string, unknown>)['organization_id']).toBe('ORG-1')
  })
})

describe('porta · a gravação da evidência', () => {
  it('pede a linha de volta e devolve o id: isso é a confirmação', async () => {
    const { chamadas, fetchFn } = falso({ radar_source_record: [{ id: 'RF-9' }] })
    const id = await portasFormularioRest(CFG, fetchFn).gravarEvidencia({ a: 1 })
    expect(id).toBe('RF-9')
    expect(chamadas[0]!.metodo).toBe('POST')
    expect(chamadas[0]!.prefer).toContain('return=representation')
  })

  it('sem id na volta devolve vazio — quem chamou recusa o sucesso', async () => {
    const { fetchFn } = falso({ radar_source_record: [] })
    expect(await portasFormularioRest(CFG, fetchFn).gravarEvidencia({ a: 1 })).toBe('')
  })

  it('erro do banco carrega só o status: nunca a chave, nunca o corpo', async () => {
    const { fetchFn } = falso({ radar_source_record: { status: 409 } })
    await expect(portasFormularioRest(CFG, fetchFn).gravarEvidencia({ a: 1 })).rejects.toThrow(/http 409/)
    await portasFormularioRest(CFG, fetchFn).gravarEvidencia({ a: 1 }).catch((e: Error) => {
      expect(e.message).not.toContain(CFG.chave)
      expect(e.message).not.toContain('detalhe que não deve vazar')
    })
  })
})

describe('porta · a conversa', () => {
  it('existe quando há mensagem com o mesmo provider e id externo', async () => {
    const { chamadas, fetchFn } = falso({ inbox_message: [{ id: 'MSG-1' }] })
    expect(await portasFormularioRest(CFG, fetchFn).conversaExiste('MANUAL', 'nf-777')).toBe(true)
    expect(chamadas[0]!.url).toContain('provider=eq.MANUAL')
    expect(chamadas[0]!.url).toContain('external_message_id=eq.nf-777')
  })

  it('não existe quando não há', async () => {
    const { fetchFn } = falso({ inbox_message: [] })
    expect(await portasFormularioRest(CFG, fetchFn).conversaExiste('MANUAL', 'nf-777')).toBe(false)
  })

  it('e esta porta NÃO escreve conversa: isso é da RPC inbox_ingest', async () => {
    const { fetchFn } = falso({})
    await expect(portasFormularioRest(CFG, fetchFn).ingerir({} as never)).rejects.toThrow(/montarPortasInbox/)
  })
})

describe('porta · completar o contato', () => {
  const dados: DadosDoContato = {
    nome: 'Ana Lima', empresaNome: 'Lima Indústria', relacaoSeDesconhecido: 'lead',
    identidades: [{ canal: 'WHATSAPP', identificador: '5562900000000', verificada: false }],
  }

  it('preenche o que está vazio e acrescenta a identidade', async () => {
    const { chamadas, fetchFn } = falso({
      inbox_contact: [{ id: 'CTI-1', name: 'Contato não identificado', company_name: null, relation_kind: 'desconhecido' }],
      inbox_contact_identity: [{ id: 'ID-1' }],
    })
    const r = await portasFormularioRest(CFG, fetchFn).completarContato!('CTI-1', dados)
    expect([...r.campos].sort()).toEqual(['company_name', 'name', 'relation_kind'])
    expect(r.identidades).toBe(1)
    const patch = chamadas.find((c) => c.metodo === 'PATCH')!
    expect(patch.corpo).toEqual({ name: 'Ana Lima', company_name: 'Lima Indústria', relation_kind: 'lead' })
  })

  it('NÃO sobrescreve o que já existe', async () => {
    const { chamadas, fetchFn } = falso({
      inbox_contact: [{ id: 'CTI-1', name: 'Ana Souza', company_name: 'Outra S.A.', relation_kind: 'cliente' }],
      inbox_contact_identity: [],
    })
    const r = await portasFormularioRest(CFG, fetchFn).completarContato!('CTI-1', dados)
    expect(r.campos).toEqual([])
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false)
  })

  it('a identidade entra com ignore-duplicates: o número já de alguém não troca de dono', async () => {
    const { chamadas, fetchFn } = falso({
      inbox_contact: [{ id: 'CTI-1', name: 'Contato não identificado', company_name: null, relation_kind: 'desconhecido' }],
      inbox_contact_identity: [],
    })
    const r = await portasFormularioRest(CFG, fetchFn).completarContato!('CTI-1', dados)
    const post = chamadas.find((c) => c.url.startsWith('inbox_contact_identity') && c.metodo === 'POST')!
    expect(post.prefer).toContain('resolution=ignore-duplicates')
    expect((post.corpo as Record<string, unknown>)['verified']).toBe(false)
    /* nada acrescentado: a unique do banco é quem decide */
    expect(r.identidades).toBe(0)
  })

  it('contato que não existe não vira erro', async () => {
    const { fetchFn } = falso({ inbox_contact: [] })
    expect(await portasFormularioRest(CFG, fetchFn).completarContato!('CTI-X', dados)).toEqual({ campos: [], identidades: 0 })
  })
})

describe('porta · o mapeamento da linha', () => {
  it('é o mesmo do adapter do Radar', () => {
    const r = registroDoBanco(LINHA)
    expect(r).toMatchObject({
      id: 'RF-1', fonteId: 'FNT-SITE', tipo: 'empresa', externoId: 'nf-777',
      payloadFingerprint: 'abc', statusIntake: 'PENDING',
    })
    expect(r.entidadeId).toBeUndefined()
  })
})

describe('porta · o estado de muitas submissões de uma vez', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `nf-${String(i).padStart(3, '0')}`)

  it('pergunta por evidência e por conversa, em lotes de 50, sempre com a organização', async () => {
    const f = falso({
      radar_source_record: [{ external_id: 'nf-000', payload_fingerprint: 'abc' }],
      inbox_message: [{ external_message_id: 'nf-000' }],
    })
    const r = await portasFormularioRest(CFG, f.fetchFn).estadoEmLote!(CFG.fonteId, 'MANUAL', ids)

    /* 120 ids → 3 lotes × 2 consultas */
    expect(f.chamadas).toHaveLength(6)
    expect(f.chamadas.every((c) => c.metodo === 'GET')).toBe(true)
    expect(f.chamadas.every((c) => c.url.includes('organization_id=eq.ORG-1'))).toBe(true)
    /* a chave de serviço ignora RLS: a fonte e o provider também vão explícitos */
    expect(f.chamadas.filter((c) => c.url.startsWith('radar_source_record')).every((c) => c.url.includes('source_id=eq.FNT-SITE'))).toBe(true)
    expect(f.chamadas.filter((c) => c.url.startsWith('inbox_message')).every((c) => c.url.includes('provider=eq.MANUAL'))).toBe(true)
    /* os ids vão entre aspas, no formato `in.()` do PostgREST */
    expect(f.chamadas[0]!.url).toContain('external_id=in.("nf-000"')
    /* e não se pede payload: só o que decide */
    expect(f.chamadas[0]!.url).toContain('select=external_id,payload_fingerprint')
    expect(f.chamadas[0]!.url).not.toContain('payload&')

    expect(r.evidencias).toEqual([{ externoId: 'nf-000', impressao: 'abc' }, { externoId: 'nf-000', impressao: 'abc' }, { externoId: 'nf-000', impressao: 'abc' }])
    expect(r.conversas).toEqual(['nf-000', 'nf-000', 'nf-000'])
  })

  it('evidência sem impressão volta sem impressão — e não como texto «null»', async () => {
    const f = falso({ radar_source_record: [{ external_id: 'nf-legada', payload_fingerprint: null }] })
    const r = await portasFormularioRest(CFG, f.fetchFn).estadoEmLote!(CFG.fonteId, 'MANUAL', ['nf-legada'])
    expect(r.evidencias).toEqual([{ externoId: 'nf-legada' }])
  })

  it('falha do banco sobe como status, sem corpo e sem a chave', async () => {
    const f = falso({ radar_source_record: { status: 500 } })
    await expect(portasFormularioRest(CFG, f.fetchFn).estadoEmLote!(CFG.fonteId, 'MANUAL', ['nf-1']))
      .rejects.toThrow(/http 500/)
    try {
      await portasFormularioRest(CFG, f.fetchFn).estadoEmLote!(CFG.fonteId, 'MANUAL', ['nf-1'])
    } catch (e) {
      const m = (e as Error).message
      expect(m).not.toContain(CFG.chave)
      expect(m).not.toContain('não deve vazar')
    }
  })
})

/**
 * A reconciliação agendada: a rede de segurança rodando sozinha.
 *
 * O que estes testes protegem, uma exigência por vez:
 *
 *   1. as DUAS chaves (interruptor e marco) e o fail-closed: desligada não lê
 *      nem escreve NADA — nem a lista de formulários;
 *   2. os leads históricos: submissão anterior ao marco é retida, e esta
 *      rodada não tem como liberá-la;
 *   3. a idempotência pelo id da submissão — a segunda rodada não duplica;
 *   4. o lote dentro do limite de 30 s: teto de submissões e parada por
 *      tempo, sempre das mais ANTIGAS para as mais novas;
 *   5. o registro: contagens, falhas e última execução, sem conteúdo de lead
 *      e sem segredo;
 *   6. a retomada: o que ficou de fora volta na rodada seguinte e entra.
 *
 * A gravação é a REAL (`gravarSubmissao` com o plano de verdade) sobre portas
 * em memória — é o que faz a idempotência ser medida, não afirmada.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOTE, rodadaDeReconciliacao, type AmbienteAgendado, type DepsAgendado } from './formularioAgendado'
import type { PortasGravacao } from './formularioGravacao'
import type { RegistroFonte } from './types'

const FONTE = 'FNT-WEBSITE'
const ORG = 'ORG-EIFF'
const MARCO = '2026-11-10T00:00:00.000Z'
const SEGREDO_NO_AMBIENTE = 'token-secreto-do-netlify'

const submissao = (id: string, criadoEm: string, extra: Record<string, string> = {}) => ({
  id,
  form_name: 'simular-galpao',
  state: 'verified',
  created_at: criadoEm,
  data: {
    nome: 'Ana Lima (FICTÍCIO)', email: `${id}@exemplo.invalido`, telefone: '62 90000-0000',
    empresa: 'Lima Indústria (FICTÍCIO)', cidade: 'Goiânia, GO', uso: 'industrial', area: '900',
    observacao: 'Preciso de um galpão.', ...extra,
  },
})

/** Um banco minúsculo, com as regras que importam: unicidade por id e por conversa. */
function bancoFalso(opcoes: { falharEm?: string; semEstadoEmLote?: boolean; falharPrazoEm?: string } = {}) {
  const registros: RegistroFonte[] = []
  const conversas = new Set<string>()
  /** Vencimento da primeira resposta por conversa: nasce com 24 h corridas, como no banco. */
  const prazos = new Map<string, string>()
  const aberturas = new Map<string, string>()
  let n = 0
  const portas: PortasGravacao = {
    async fonte(fonteId) { return { id: fonteId, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: true } },
    async prazoDaConversa(_provider, externalMessageId) {
      if (!conversas.has(externalMessageId)) return undefined
      return { threadId: `THR-${externalMessageId}`, venceEm: prazos.get(externalMessageId), aberta: true, abertaEm: aberturas.get(externalMessageId) }
    },
    async definirPrazo(threadId, venceEmIso) {
      if (opcoes.falharPrazoEm !== undefined && threadId === `THR-${opcoes.falharPrazoEm}`) throw new Error('postgrest PATCH inbox_thread http 500')
      prazos.set(threadId.replace(/^THR-/, ''), venceEmIso)
      return venceEmIso
    },
    async registrosDaSubmissao(fonteId, externoId) {
      return registros.filter((r) => r.fonteId === fonteId && r.externoId === externoId)
    },
    async conversaExiste(_provider, externalMessageId) { return conversas.has(externalMessageId) },
    async gravarEvidencia(linha) {
      if (opcoes.falharEm !== undefined && String(linha['external_id']) === opcoes.falharEm) {
        throw new Error('postgrest http 503')
      }
      n += 1
      const id = `RF-${n}`
      registros.push({
        id,
        fonteId: String(linha['source_id']),
        tipo: linha['record_type'] as RegistroFonte['tipo'],
        externoId: String(linha['external_id']),
        payload: linha['payload'],
        recebidoEm: String(linha['received_at']),
        payloadFingerprint: String(linha['payload_fingerprint']),
        statusIntake: 'PENDING',
      })
      return id
    },
    async estadoEmLote(fonteId, _provider, externoIds) {
      if (opcoes.semEstadoEmLote === true) throw new Error('postgrest GET radar_source_record http 500')
      return {
        evidencias: registros
          .filter((r) => r.fonteId === fonteId && externoIds.includes(r.externoId ?? ''))
          .map((r) => ({ externoId: r.externoId ?? '', ...(r.payloadFingerprint === undefined ? {} : { impressao: r.payloadFingerprint }) })),
        conversas: externoIds.filter((x) => conversas.has(x)),
        prazos: externoIds.filter((x) => conversas.has(x)).map((x) => ({ externoId: x, threadId: `THR-${x}`, venceEm: prazos.get(x), aberta: true, abertaEm: aberturas.get(x) })),
      }
    },
    async ingerir(p) {
      conversas.add(p.externalMessageId)
      prazos.set(p.externalMessageId, new Date(Date.parse(p.em) + 24 * 3_600_000).toISOString())
      aberturas.set(p.externalMessageId, p.em)
      return { ok: true, duplicada: false, threadId: `THR-${p.externalMessageId}`, messageId: `MSG-${p.externalMessageId}`, novaThread: true }
    },
  }
  return { portas, registros, conversas, prazos, opcoes }
}

interface Cenario {
  env?: Partial<AmbienteAgendado>
  submissoes?: unknown[]
  /** Milissegundos que cada chamada ao relógio avança. */
  passoMs?: number
  banco?: ReturnType<typeof bancoFalso>
  falhaNaLeitura?: number
}

function montar(c: Cenario = {}) {
  const chamadas: string[] = []
  const logs: Record<string, unknown>[] = []
  const banco = c.banco ?? bancoFalso()
  let agora = 0
  const env: AmbienteAgendado = {
    FORMULARIO_RECONCILIACAO: 'ativa',
    EIFF_FORM_MARCO: MARCO,
    EIFF_FORM_NETLIFY_SITE: 'site-eiff',
    NETLIFY_AUTH_TOKEN: SEGREDO_NO_AMBIENTE,
    ...c.env,
  }
  const deps: DepsAgendado = {
    fetch: (async (url: string) => {
      chamadas.push(String(url))
      const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)
      if (c.falhaNaLeitura !== undefined) return { ok: false, status: c.falhaNaLeitura, json: async () => ({}) } as unknown as Response
      if (String(url).includes('/forms?') || String(url).endsWith('/forms')) {
        return ok([{ id: 'F1', name: 'simular-galpao' }, { id: 'F9', name: 'outro-formulario' }])
      }
      if (String(url).includes('/submissions')) {
        return ok(String(url).includes('page=1') ? (c.submissoes ?? []) : [])
      }
      return ok([])
    }) as unknown as typeof fetch,
    agora: () => { const t = agora; agora += c.passoMs ?? 0; return t },
    agoraIso: () => '2026-11-12T10:00:00.000Z',
    log: (t) => { logs.push(t) },
    portas: { portas: banco.portas, fonteId: FONTE, organizacaoId: ORG },
  }
  return { env, deps, chamadas, logs, banco }
}

describe('reconciliação agendada · as duas chaves', () => {
  it('sem o interruptor NÃO lê nada: nem a lista de formulários', async () => {
    const m = montar({ env: { FORMULARIO_RECONCILIACAO: undefined } })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.desfecho).toBe('desligada')
    expect(m.chamadas).toEqual([])
    expect(m.banco.registros).toEqual([])
  })

  it('«true» não liga: o interruptor é a palavra exata', async () => {
    const m = montar({ env: { FORMULARIO_RECONCILIACAO: 'true' } })
    expect((await rodadaDeReconciliacao(m.env, m.deps)).desfecho).toBe('desligada')
    expect(m.chamadas).toEqual([])
  })

  it('ligada SEM marco não começa — um marco padrão processaria lead real', async () => {
    for (const marco of [undefined, '', 'ontem']) {
      const m = montar({ env: { EIFF_FORM_MARCO: marco } })
      const r = await rodadaDeReconciliacao(m.env, m.deps)
      expect(r.desfecho).toBe('nao_configurada')
      expect(r.motivo).toContain('EIFF_FORM_MARCO')
      expect(m.chamadas).toEqual([])
    }
  })

  it('sem token de leitura a rodada para antes de gravar qualquer coisa', async () => {
    const m = montar({ env: { NETLIFY_AUTH_TOKEN: '' }, submissoes: [submissao('s1', '2026-11-11T10:00:00Z')] })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.desfecho).toBe('erro_de_leitura')
    expect(r.motivo).toContain('NETLIFY_AUTH_TOKEN')
    expect(m.banco.registros).toEqual([])
  })

  it('erro da API não vira exceção: vira desfecho com motivo', async () => {
    const m = montar({ falhaNaLeitura: 429 })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.desfecho).toBe('erro_de_leitura')
    expect(r.motivo).toContain('429')
    expect(r.falhas).toBe(0)
  })
})

describe('reconciliação agendada · os leads históricos', () => {
  it('submissão anterior ao marco é RETIDA, e a posterior entra', async () => {
    const m = montar({
      submissoes: [submissao('antiga', '2026-10-13T11:00:00Z'), submissao('nova', '2026-11-11T09:00:00Z')],
    })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.desfecho).toBe('concluida')
    expect(r.lidas).toBe(2)
    expect(r.elegiveis).toBe(1)
    expect(r.retidas).toBe(1)
    expect(r.motivosRetencao['anterior_ao_marco']).toBe(1)
    expect(r.recuperadas).toBe(1)
    expect(m.banco.registros.map((x) => x.externoId)).toEqual(['nova'])
  })

  it('e não existe caminho nesta rodada para liberar o que é anterior ao marco', () => {
    /* o script tem `--incluir-anteriores` com duas confirmações; a rodada agendada não tem como passar a opção */
    const fonte = readFileSync('src/core/radar/formularioAgendado.ts', 'utf8')
    expect(/incluirAnteriores\s*:/.test(fonte)).toBe(false)
    const involucro = readFileSync('netlify/functions/formulario-reconciliar.mts', 'utf8')
    expect(/incluirAnteriores/.test(involucro)).toBe(false)
  })

  it('id excluído pelo ambiente também fica fora', async () => {
    const m = montar({
      env: { EIFF_FORM_EXCLUIDOS: 'nao-esta, s2 ' },
      submissoes: [submissao('s1', '2026-11-11T09:00:00Z'), submissao('s2', '2026-11-11T10:00:00Z')],
    })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.motivosRetencao['id_excluido']).toBe(1)
    expect(m.banco.registros.map((x) => x.externoId)).toEqual(['s1'])
  })
})

describe('reconciliação agendada · idempotência e retomada', () => {
  it('a segunda rodada sobre a mesma submissão não duplica nada', async () => {
    const banco = bancoFalso()
    const primeira = await rodadaDeReconciliacao(...(() => { const m = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] }); return [m.env, m.deps] as const })())
    expect(primeira.resultados['REGISTRADO']).toBe(1)
    expect(primeira.recuperadas).toBe(1)

    const m2 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    const segunda = await rodadaDeReconciliacao(m2.env, m2.deps)
    /* já está inteiramente dentro: sai da fila antes de gastar uma gravação */
    expect(segunda.jaDentro).toBe(1)
    expect(segunda.processadas).toBe(0)
    expect(segunda.recuperadas).toBe(0)
    expect(banco.registros).toHaveLength(1)
    expect(banco.conversas.size).toBe(1)
  })

  it('evidência gravada e conversa faltando: a rodada COMPLETA, sem segunda evidência', async () => {
    const banco = bancoFalso()
    const m1 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    await rodadaDeReconciliacao(m1.env, m1.deps)
    banco.conversas.clear() // como se a conversa nunca tivesse sido gravada

    const m2 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    const r = await rodadaDeReconciliacao(m2.env, m2.deps)
    expect(r.resultados['COMPLETADO']).toBe(1)
    expect(banco.registros).toHaveLength(1)
    expect(banco.conversas.size).toBe(1)
  })

  it('falha numa submissão não derruba a rodada: conta a falha e segue', async () => {
    const banco = bancoFalso({ falharEm: 's2' })
    const m = montar({
      banco,
      submissoes: [submissao('s1', '2026-11-11T09:00:00Z'), submissao('s2', '2026-11-11T10:00:00Z'), submissao('s3', '2026-11-11T11:00:00Z')],
    })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.processadas).toBe(3)
    expect(r.falhas).toBe(1)
    expect(r.recuperadas).toBe(2)
    expect(banco.registros.map((x) => x.externoId)).toEqual(['s1', 's3'])
  })
})

describe('reconciliação agendada · o lote dentro do limite', () => {
  const muitas = (n: number) => Array.from({ length: n }, (_, i) =>
    submissao(`s${String(i).padStart(2, '0')}`, new Date(Date.parse('2026-11-11T00:00:00Z') + i * 60_000).toISOString()))

  it(`processa no máximo ${LOTE} por rodada e diz quantas restam`, async () => {
    const banco = bancoFalso()
    const m = montar({ banco, submissoes: muitas(LOTE + 5) })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.elegiveis).toBe(LOTE + 5)
    expect(r.processadas).toBe(LOTE)
    expect(r.restam).toBe(5)
    /* as mais ANTIGAS primeiro: quem espera há mais tempo entra antes */
    expect(banco.registros[0]!.externoId).toBe('s00')
    expect(banco.registros.map((x) => x.externoId)).not.toContain('s24')
  })

  it('e a rodada seguinte pega o resto: a retomada não precisa de estado', async () => {
    const banco = bancoFalso()
    const m1 = montar({ banco, submissoes: muitas(LOTE + 5) })
    await rodadaDeReconciliacao(m1.env, m1.deps)
    const m2 = montar({ banco, submissoes: muitas(LOTE + 5) })
    const r = await rodadaDeReconciliacao(m2.env, m2.deps)
    /* as 20 que já estão dentro saem da fila ANTES do teto — é isso que faz a fila andar */
    expect(r.jaDentro).toBe(LOTE)
    expect(r.processadas).toBe(5)
    expect(r.resultados['REGISTRADO']).toBe(5)
    expect(r.restam).toBe(0)
    expect(banco.registros).toHaveLength(LOTE + 5)
  })

  it('sem o estado em lote a rodada continua, uma a uma e ainda idempotente', async () => {
    const banco = bancoFalso({ semEstadoEmLote: true })
    const m1 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    expect((await rodadaDeReconciliacao(m1.env, m1.deps)).recuperadas).toBe(1)
    const m2 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    const r = await rodadaDeReconciliacao(m2.env, m2.deps)
    expect(r.jaDentro).toBe(0)
    expect(r.resultados['IDEMPOTENTE']).toBe(1)
    expect(banco.registros).toHaveLength(1)
    expect(m2.logs.some((l) => l['evento'] === 'RECONCILIACAO_ESTADO')).toBe(true)
  })

  it('versão nova da mesma submissão NÃO conta como já dentro', async () => {
    const banco = bancoFalso()
    const m1 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    await rodadaDeReconciliacao(m1.env, m1.deps)
    const m2 = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z', { area: '1200' })] })
    const r = await rodadaDeReconciliacao(m2.env, m2.deps)
    expect(r.jaDentro).toBe(0)
    expect(r.resultados['NOVA_OBSERVACAO']).toBe(1)
    expect(banco.registros).toHaveLength(2)
  })

  it('o tempo também para a rodada, antes do limite de 30 s da plataforma', async () => {
    const banco = bancoFalso()
    /* cada leitura do relógio avança 2 s: o orçamento (30 − 8) acaba em poucas submissões */
    const m = montar({ banco, submissoes: muitas(LOTE), passoMs: 2_000 })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.processadas).toBeGreaterThan(0)
    expect(r.processadas).toBeLessThan(LOTE)
    expect(r.restam).toBe(LOTE - r.processadas)
    expect(r.duracaoMs).toBeLessThanOrEqual(30_000)
  })
})

describe('reconciliação agendada · o registro', () => {
  it('uma linha por rodada, com contagens, falhas e a última execução', async () => {
    const m = montar({ submissoes: [submissao('s1', '2026-11-11T09:00:00Z')] })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    const linha = m.logs.find((l) => l['evento'] === 'RECONCILIACAO_AGENDADA')!
    expect(linha).toBeTruthy()
    expect(linha['desfecho']).toBe('concluida')
    expect(linha['recuperadas']).toBe(1)
    expect(linha['falhas']).toBe(0)
    expect(linha['em']).toBe('2026-11-12T10:00:00.000Z')
    expect(r.em).toBe(linha['em'])
  })

  it('e NADA de lead ou de segredo aparece em log nenhum', async () => {
    const banco = bancoFalso({ falharEm: 's2' })
    const m = montar({ banco, submissoes: [submissao('s1', '2026-11-11T09:00:00Z'), submissao('s2', '2026-11-11T10:00:00Z')] })
    await rodadaDeReconciliacao(m.env, m.deps)
    const tudo = JSON.stringify(m.logs)
    for (const proibido of [SEGREDO_NO_AMBIENTE, 'Ana Lima', 'exemplo.invalido', '62 90000-0000', 'Lima Indústria', 'galpão']) {
      expect(tudo.includes(proibido)).toBe(false)
    }
  })

  it('até a rodada desligada registra a última execução', async () => {
    const m = montar({ env: { FORMULARIO_RECONCILIACAO: undefined } })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(m.logs.some((l) => l['evento'] === 'RECONCILIACAO_AGENDADA' && l['desfecho'] === 'desligada')).toBe(true)
    expect(r.em).toBeTruthy()
  })
})

describe('reconciliação agendada · o prazo de primeira resposta', () => {
  const S1 = submissao('nf-prazo-1', '2026-11-10T14:00:00.000Z')
  // terça 10/11/2026 às 11:00 em São Paulo: 30 min úteis → 14:30 UTC
  const ALVO = '2026-11-10T14:30:00.000Z'

  it('a rodada grava o lead com 30 minutos úteis, não com as 24 h corridas', async () => {
    const m = montar({ submissoes: [S1] })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.falhas).toBe(0)
    expect(m.banco.prazos.get('nf-prazo-1')).toBe(ALVO)
  })

  it('falha ao gravar o prazo conta como FALHA da rodada, nunca como recuperada', async () => {
    const m = montar({ submissoes: [S1], banco: bancoFalso({ falharPrazoEm: 'nf-prazo-1' }) })
    const r = await rodadaDeReconciliacao(m.env, m.deps)
    expect(r.falhas).toBe(1)
    expect(r.recuperadas).toBe(0)
  })

  it('estado parcial (evidência + conversa, prazo ainda errado) NÃO é «já dentro»: a rodada seguinte conserta', async () => {
    const banco = bancoFalso({ falharPrazoEm: 'nf-prazo-1' })
    const primeira = montar({ submissoes: [S1], banco })
    expect((await rodadaDeReconciliacao(primeira.env, primeira.deps)).falhas).toBe(1)
    expect(banco.registros).toHaveLength(1)
    expect(banco.conversas.has('nf-prazo-1')).toBe(true)
    expect(banco.prazos.get('nf-prazo-1')).not.toBe(ALVO)

    // o banco volta a aceitar; a mesma submissão tem de voltar à fila
    delete banco.opcoes.falharPrazoEm
    const segunda = montar({ submissoes: [S1], banco })
    const r = await rodadaDeReconciliacao(segunda.env, segunda.deps)
    expect(r.jaDentro).toBe(0)
    expect(r.processadas).toBe(1)
    expect(r.falhas).toBe(0)
    expect(r.resultados['IDEMPOTENTE']).toBe(1)
    // sem evidência nem conversa novas: só o prazo mudou
    expect(banco.registros).toHaveLength(1)
    expect(banco.prazos.get('nf-prazo-1')).toBe(ALVO)

    // e a terceira já a encontra inteiramente dentro
    const terceira = montar({ submissoes: [S1], banco })
    expect((await rodadaDeReconciliacao(terceira.env, terceira.deps)).jaDentro).toBe(1)
  })
})

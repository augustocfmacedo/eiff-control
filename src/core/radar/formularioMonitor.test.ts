/**
 * Monitor da reconciliação: os cenários de aceite da E10.15, um por bloco.
 *
 *   1. rodada concluída sem falha → nenhum alerta
 *   2. falha de leitura (credencial na 1ª; transitória só na 2ª seguida)
 *   3. falha parcial de gravação com HTTP 200
 *   4. falhas consecutivas
 *   5. rodada não executada (só o observador separado vê)
 *   6. recuperação inesperada
 *   7. nenhum dado pessoal nem segredo em alerta ou registro
 *   8. nenhuma duplicidade: nem de alerta, nem de processamento
 *
 * A integração no fim usa a rodada REAL (`rodadaDeReconciliacao` + `gravarSubmissao`) sobre portas em memória,
 * o `registrarRodada` e o `observar` — o caminho inteiro, sem rede.
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rodadaDeReconciliacao, type AmbienteAgendado, type ResumoRodada } from './formularioAgendado'
import type { PortasGravacao } from './formularioGravacao'
import {
  CODIGOS, CONFIG_PADRAO, INTERVALO_PADRAO_MIN, avaliarRodadas, codigoDoMotivo, configParaIntervalo, deduplicar,
  orcamentoDaFrequencia, problemasDeDadoPessoal, registroDaRodada, type Alerta, type RodadaRegistrada,
} from './formularioMonitor'
import { menorId, portaMonitorMemoria, portaMonitorRest, rodadaDaLinha } from './formularioMonitorPorta'
import { JANELA_REIVINDICACAO_MIN, canalSomenteRegistro, intervaloDe, observar, portaDoAmbiente, registrarRodada } from './formularioObservador'
import { canalComRegistro, canalComposto, canalDoAmbiente, canalSimulado, canalWebhook, mensagemDoAlerta } from './formularioAlertaCanais'
import { VERSAO_CONTRATO, estadoOperacional, estadoOperacionalDasLinhas, saudeExibivel } from './formularioMonitorCentral'
import type { RegistroFonte } from './types'

const H = 3_600_000
const T0 = Date.parse('2026-11-20T10:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

const rodada = (horas: number, extra: Partial<RodadaRegistrada> = {}): RodadaRegistrada => ({
  em: iso(T0 + horas * H), desfecho: 'concluida',
  lidas: 14, elegiveis: 0, jaDentro: 0, processadas: 0, restam: 0, retidas: 14, recuperadas: 0, falhas: 0,
  ...extra,
})
/** Os cenários abaixo usam rodadas de hora em hora; a configuração é explícita. */
const C60 = configParaIntervalo(60)
const tipos = (as: Alerta[]) => as.map((a) => `${a.tipo}:${a.severidade}`).sort()

describe('1 · rodada concluída sem falha', () => {
  it('sequência limpa não gera alerta', () => {
    const rs = [0, 1, 2, 3].map((h) => rodada(h))
    expect(avaliarRodadas(rs, iso(T0 + 3.5 * H), C60)).toEqual([])
  })
  it('reconciliação desligada de propósito não é falha nem ausência: só o informativo DESLIGADA', () => {
    const rs = [rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }), rodada(1, { desfecho: 'desligada' }), rodada(25, { desfecho: 'desligada' })]
    const a = avaliarRodadas(rs, iso(T0 + 30 * H), C60)
    expect(tipos(a)).toEqual(['DESLIGADA:info'])
    // a chave usa o INÍCIO do período desligado: o registro diário não gera aviso novo
    expect(a[0]!.desde).toBe(rs[1]!.em)
  })
  it('a frequência padrão é a mesma do agendamento da rodada', () => {
    expect(INTERVALO_PADRAO_MIN).toBe(10)
    expect(readFileSync('netlify/functions/formulario-reconciliar.mts', 'utf8')).toContain(`schedule: '*/${INTERVALO_PADRAO_MIN} * * * *'`)
    expect(CONFIG_PADRAO.intervaloMin).toBe(INTERVALO_PADRAO_MIN)
  })
  it('sem histórico nenhum, nada a dizer (o monitor ainda não viu a rodada ligada)', () => {
    expect(avaliarRodadas([], iso(T0), C60)).toEqual([])
  })
})

describe('2 · falha de leitura', () => {
  it('credencial recusada alerta já na primeira rodada', () => {
    for (const codigo of ['CREDENCIAL_AUSENTE', 'CREDENCIAL_INVALIDA', 'HTTP_401', 'HTTP_403'] as const) {
      const a = avaliarRodadas([rodada(0), rodada(1, { desfecho: 'erro_de_leitura', codigo })], iso(T0 + 1.1 * H), C60)
      expect(tipos(a)).toEqual(['FALHA_LEITURA:critico'])
      expect(a[0]!.codigo).toBe(codigo)
    }
  })
  it('erro transitório (5xx) só alerta na segunda seguida', () => {
    const um = [rodada(0), rodada(1, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' })]
    expect(avaliarRodadas(um, iso(T0 + 1.1 * H), C60)).toEqual([])
    const dois = [...um, rodada(2, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' })]
    const a = avaliarRodadas(dois, iso(T0 + 2.1 * H), C60)
    expect(tipos(a)).toEqual(['FALHA_LEITURA:critico'])
    expect(a[0]!.contagens['seguidas']).toBe(2)
    expect(a[0]!.desde).toBe(um[1]!.em)
  })
  it('o motivo bruto vira código de catálogo, nunca texto copiado', () => {
    expect(codigoDoMotivo('erro_de_leitura', 'CREDENCIAL_AUSENTE: NETLIFY_AUTH_TOKEN')).toBe('CREDENCIAL_AUSENTE')
    expect(codigoDoMotivo('erro_de_leitura', 'submissões: http 401')).toBe('HTTP_401')
    expect(codigoDoMotivo('erro_de_leitura', 'lista de formulários: http 503')).toBe('HTTP_5XX')
    expect(codigoDoMotivo('erro_de_leitura', 'FALHA_LEITURA: TypeError fetch failed')).toBe('FALHA_LEITURA')
    expect(codigoDoMotivo('nao_configurada', 'sem EIFF_FORM_MARCO (instante ISO)')).toBe('SEM_MARCO')
    expect(codigoDoMotivo('nao_configurada', 'sem SUPABASE_SERVICE_ROLE_KEY')).toBe('SEM_BANCO')
    expect(codigoDoMotivo('nao_configurada', 'texto qualquer com fulano@exemplo.com')).toBe('OUTRO')
    expect(codigoDoMotivo('concluida', 'x')).toBeUndefined()
    for (const m of ['http 418', 'resposta inesperada', 'nenhum formulário do catálogo', 'sem EIFF_FORM_NETLIFY_SITE']) {
      expect(CODIGOS).toContain(codigoDoMotivo('erro_de_leitura', m))
    }
  })
  it('rodada ligada sem configuração é alerta de configuração', () => {
    const a = avaliarRodadas([rodada(0, { desfecho: 'nao_configurada', codigo: 'SEM_MARCO' })], iso(T0 + 0.1 * H), C60)
    expect(tipos(a)).toEqual(['CONFIGURACAO:critico'])
  })
})

describe('3 · falha parcial de gravação, com a função respondendo 200', () => {
  it('rodada CONCLUÍDA com falhas > 0 é aviso na primeira e crítico na segunda seguida', () => {
    const um = [rodada(0), rodada(1, { elegiveis: 3, processadas: 3, falhas: 1, recuperadas: 2 })]
    const a1 = avaliarRodadas(um, iso(T0 + 1.1 * H), C60)
    expect(tipos(a1)).toEqual(['FALHA_GRAVACAO:aviso', 'RECUPERACAO:aviso'])
    const dois = [...um, rodada(2, { elegiveis: 1, processadas: 1, falhas: 1 })]
    const a2 = avaliarRodadas(dois, iso(T0 + 2.1 * H), C60)
    // a recuperação da rodada anterior continua na avaliação (fato próprio); quem evita repetir é a deduplicação
    expect(tipos(a2)).toEqual(['FALHA_GRAVACAO:critico', 'RECUPERACAO:aviso'])
  })
  it('a falha some quando a rodada seguinte grava: nada mais a alertar', () => {
    const rs = [rodada(0, { processadas: 1, falhas: 1 }), rodada(1, { processadas: 1, recuperadas: 1 })]
    expect(tipos(avaliarRodadas(rs, iso(T0 + 1.1 * H), C60))).toEqual(['RECUPERACAO:aviso'])
  })
})

describe('4 · falhas consecutivas', () => {
  it('três rodadas seguidas com problema, de qualquer tipo, são um alerta próprio', () => {
    const rs = [
      rodada(0),
      rodada(1, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }),
      rodada(2, { falhas: 1, processadas: 1 }),
      rodada(3, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }),
    ]
    const a = avaliarRodadas(rs, iso(T0 + 3.1 * H), C60)
    expect(a.find((x) => x.tipo === 'FALHAS_CONSECUTIVAS')?.contagens['seguidas']).toBe(3)
    expect(a.find((x) => x.tipo === 'FALHAS_CONSECUTIVAS')?.desde).toBe(rs[1]!.em)
  })
  it('uma rodada limpa no meio zera a contagem', () => {
    const rs = [
      rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }), rodada(1, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }),
      rodada(2), rodada(3, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' }),
    ]
    expect(avaliarRodadas(rs, iso(T0 + 3.1 * H), C60).some((x) => x.tipo === 'FALHAS_CONSECUTIVAS')).toBe(false)
  })
})

describe('5 · rodada não executada', () => {
  it('com rodada de hora em hora: até 2 h 5 min é normal; depois, crítico', () => {
    const rs = [rodada(0), rodada(1)]
    expect(avaliarRodadas(rs, iso(T0 + 1 * H + 125 * 60_000), C60)).toEqual([])
    const a = avaliarRodadas(rs, iso(T0 + 1 * H + 126 * 60_000), C60)
    expect(tipos(a)).toEqual(['RODADA_AUSENTE:critico'])
    expect(a[0]!.desde).toBe(rs[1]!.em)
  })
  it('com rodada a cada 10 min: ausência em 25 min', () => {
    const cfg = configParaIntervalo(10)
    const rs = [rodada(0)]
    expect(avaliarRodadas(rs, iso(T0 + 25 * 60_000), cfg)).toEqual([])
    expect(tipos(avaliarRodadas(rs, iso(T0 + 26 * 60_000), cfg))).toEqual(['RODADA_AUSENTE:critico'])
  })
  it('a ausência não depende de a última rodada ter falhado', () => {
    const rs = [rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })]
    expect(tipos(avaliarRodadas(rs, iso(T0 + 5 * H), C60))).toEqual(['FALHA_LEITURA:critico', 'RODADA_AUSENTE:critico'])
  })
})

describe('6 · recuperação inesperada', () => {
  it('rodada que gravou algo que o evento não entregou avisa, com a contagem', () => {
    const a = avaliarRodadas([rodada(0, { elegiveis: 2, processadas: 2, recuperadas: 2 })], iso(T0 + 0.1 * H), C60)
    expect(tipos(a)).toEqual(['RECUPERACAO:aviso'])
    expect(a[0]!.contagens).toEqual({ recuperadas: 2, processadas: 2 })
  })
  it('«já dentro» não é recuperação: o caminho principal funcionou', () => {
    expect(avaliarRodadas([rodada(0, { elegiveis: 5, jaDentro: 5 })], iso(T0 + 0.1 * H), C60)).toEqual([])
  })
})

describe('7 · sem dado pessoal e sem segredo', () => {
  const resumoComTudo: ResumoRodada = {
    desfecho: 'erro_de_leitura',
    motivo: 'FALHA_LEITURA: ana.lima@exemplo.com 62 99999-0000 6af761a6cbe0316d6d3211b9 Bearer abc',
    em: iso(T0), lidas: 3, elegiveis: 1, jaDentro: 0, processadas: 0, restam: 0, retidas: 2,
    motivosRetencao: { id_excluido: 1 }, resultados: {}, recuperadas: 0, falhas: 0, duracaoMs: 12,
  }
  it('o registro da rodada é lista fechada: o motivo bruto não entra', () => {
    const r = registroDaRodada(resumoComTudo)
    expect(Object.keys(r).sort()).toEqual(['codigo', 'desfecho', 'elegiveis', 'em', 'falhas', 'jaDentro', 'lidas', 'processadas', 'recuperadas', 'restam', 'retidas'].sort())
    expect(r.codigo).toBe('FALHA_LEITURA')
    expect(problemasDeDadoPessoal(r)).toEqual([])
  })
  it('todo alerta possível passa pela barreira', () => {
    const cenarios: RodadaRegistrada[][] = [
      [rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })],
      [rodada(0, { desfecho: 'nao_configurada', codigo: 'SEM_BANCO' })],
      [rodada(0, { falhas: 4, processadas: 9, recuperadas: 5 }), rodada(1, { falhas: 2, processadas: 2 })],
      [1, 2, 3].map((h) => rodada(h, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' })),
    ]
    let n = 0
    for (const rs of cenarios) {
      for (const a of avaliarRodadas(rs, iso(T0 + 9 * H), C60)) { expect(problemasDeDadoPessoal(a)).toEqual([]); n += 1 }
    }
    expect(n).toBeGreaterThanOrEqual(6)
  })
  it('a barreira reconhece o que não pode sair', () => {
    expect(problemasDeDadoPessoal({ x: 'fulano@exemplo.com' })).toContain('arroba (e-mail)')
    expect(problemasDeDadoPessoal({ x: '62 90000-1234' })).toContain('sequência longa de dígitos (telefone ou documento)')
    expect(problemasDeDadoPessoal({ x: '6af761a6cbe0316d6d3211b9' })).toContain('id de submissão do Netlify')
    expect(problemasDeDadoPessoal({ x: '9118f1e4-065d-4848-b0cf-ebc7018eefd1' })).toContain('uuid de registro')
    expect(problemasDeDadoPessoal({ x: 'Bearer abc' })).toContain('palavra de credencial')
    expect(problemasDeDadoPessoal({ em: '2026-11-20T10:00:00.000Z', n: 14 })).toEqual([])
  })
  it('a porta REST não põe a chave em erro', async () => {
    const porta = portaMonitorRest({ url: 'https://x.supabase.co', chave: 'CHAVE-DE-SERVICO-SECRETA', organizacaoId: 'org' },
      (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch)
    const e = await porta.gravarRodada(rodada(0)).catch((x: Error) => x)
    expect(String(e)).toContain('http 500')
    expect(String(e)).not.toContain('CHAVE-DE-SERVICO-SECRETA')
  })
})

describe('8 · nenhuma duplicidade de alerta', () => {
  it('o mesmo problema contínuo avisa uma vez e só lembra depois do prazo de reemissão', () => {
    const rs = [rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })]
    const a1 = avaliarRodadas(rs, iso(T0 + 0.25 * H), C60)
    const r1 = deduplicar(a1, [], iso(T0 + 0.25 * H))
    expect(r1.novos).toHaveLength(1)
    const emitidos = r1.novos.map((a) => ({ chave: a.chave, em: iso(T0 + 0.25 * H) }))
    // mesma situação, 15 min depois: a chave é a mesma (usa o início da sequência)
    const a2 = avaliarRodadas([...rs, rodada(1, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })], iso(T0 + 1.25 * H), C60)
    const falha = a2.find((a) => a.tipo === 'FALHA_LEITURA')!
    expect(falha.chave).toBe(r1.novos[0]!.chave)
    expect(deduplicar([falha], emitidos, iso(T0 + 1.25 * H)).novos).toEqual([])
    // depois de 6 h, lembra
    expect(deduplicar([falha], emitidos, iso(T0 + 0.25 * H + CONFIG_PADRAO.reemitirAposMin * 60_000)).novos).toHaveLength(1)
  })
  it('mudança de severidade é alerta novo (aviso → crítico)', () => {
    const um = [rodada(0, { falhas: 1, processadas: 1 })]
    const aviso = avaliarRodadas(um, iso(T0 + 0.1 * H), C60).find((a) => a.tipo === 'FALHA_GRAVACAO')!
    const critico = avaliarRodadas([...um, rodada(1, { falhas: 1, processadas: 1 })], iso(T0 + 1.1 * H), C60).find((a) => a.tipo === 'FALHA_GRAVACAO')!
    expect(critico.chave).not.toBe(aviso.chave)
    expect(deduplicar([critico], [{ chave: aviso.chave, em: iso(T0 + 0.1 * H) }], iso(T0 + 1.1 * H)).novos).toHaveLength(1)
  })
  it('duas cópias da mesma chave na mesma avaliação viram uma', () => {
    const a = avaliarRodadas([rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })], iso(T0 + 0.1 * H), C60)
    expect(deduplicar([...a, ...a], [], iso(T0 + 0.1 * H)).novos).toHaveLength(1)
  })
})

describe('observador e registro da rodada (portas em memória)', () => {
  const env = { FORMULARIO_MONITOR: 'ativo', FORMULARIO_INTERVALO_MIN: '60' }
  const semRede = (async () => { throw new Error('rede proibida neste teste') }) as unknown as typeof fetch
  const resumo = (desfecho: ResumoRodada['desfecho'], em: string) => ({
    desfecho, em, lidas: 0, elegiveis: 0, jaDentro: 0, processadas: 0, restam: 0, retidas: 0,
    motivosRetencao: {}, resultados: {}, recuperadas: 0, falhas: 0, duracaoMs: 1,
  }) as ResumoRodada

  it('desligado por padrão: não lê nem grava nada', async () => {
    const porta = portaMonitorMemoria()
    const r = await observar({}, { fetch: semRede, agoraIso: () => iso(T0), canal: canalSomenteRegistro(() => {}), porta })
    expect(r.desfecho).toBe('desligado')
    expect(porta.reivindicacoes).toEqual([])
    expect(await registrarRodada({}, resumo('concluida', iso(T0)), { fetch: semRede, porta })).toBe('monitor_desligado')
    expect(porta.rodadas).toEqual([])
  })
  it('«true» não liga: a palavra é exata', async () => {
    const r = await observar({ FORMULARIO_MONITOR: 'true' }, { fetch: semRede, agoraIso: () => iso(T0), canal: canalSomenteRegistro(() => {}), porta: portaMonitorMemoria() })
    expect(r.desfecho).toBe('desligado')
  })
  it('sem chave de serviço não monta a porta e diz qual variável falta, sem valor', async () => {
    const r = await observar(env, { fetch: semRede, agoraIso: () => iso(T0), canal: canalSomenteRegistro(() => {}) })
    expect(r.desfecho).toBe('sem_configuracao')
    expect(r.motivo).toBe('sem SUPABASE_SERVICE_ROLE_KEY')
  })
  it('rodada desligada: grava na transição e depois uma vez por dia', async () => {
    const porta = portaMonitorMemoria()
    expect(await registrarRodada(env, resumo('concluida', iso(T0)), { fetch: semRede, porta })).toBe('gravada')
    expect(await registrarRodada(env, resumo('desligada', iso(T0 + 1 * H)), { fetch: semRede, porta })).toBe('gravada')
    expect(await registrarRodada(env, resumo('desligada', iso(T0 + 2 * H)), { fetch: semRede, porta })).toBe('desligada_ja_registrada')
    expect(await registrarRodada(env, resumo('desligada', iso(T0 + 25 * H)), { fetch: semRede, porta })).toBe('gravada')
    expect(porta.rodadas.map((r) => r.desfecho)).toEqual(['concluida', 'desligada', 'desligada'])
  })
  it('falha ao gravar a rodada não lança e não muda nada na rodada', async () => {
    const quebrada = { ...portaMonitorMemoria(), async gravarRodada() { throw new Error('postgrest POST audit_log http 503') } }
    const logs: Record<string, unknown>[] = []
    expect(await registrarRodada(env, resumo('concluida', iso(T0)), { fetch: semRede, porta: quebrada, log: (t) => logs.push(t) })).toBe('falhou')
    expect(logs[0]).toMatchObject({ evento: 'RECONCILIACAO_MONITOR', outcome: 'falhou', etapa: 'gravar_rodada' })
  })
  it('entrega uma vez, grava reivindicação e entrega, e a passada seguinte suprime', async () => {
    const porta = portaMonitorMemoria()
    porta.rodadas.push(rodada(0), rodada(1, { desfecho: 'erro_de_leitura', codigo: 'HTTP_403' }))
    const canal = canalSimulado()
    porta.definirAgora(iso(T0 + 1.1 * H))
    const r1 = await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })
    expect(r1).toMatchObject({ desfecho: 'concluida', novos: 1, suprimidos: 0, cedidos: 0, pendentes: 0, bloqueados: 0, tipos: ['FALHA_LEITURA'] })
    porta.definirAgora(iso(T0 + 1.35 * H))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 0, suprimidos: 1 })
    expect(canal.recebidos).toHaveLength(1)
    expect(porta.reivindicacoes).toHaveLength(1)
    expect(porta.entregas).toHaveLength(1)
  })
  it('dois observadores ao mesmo tempo: só o de menor reivindicação avisa', async () => {
    const porta = portaMonitorMemoria()
    porta.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    porta.definirAgora(iso(T0 + 0.2 * H))
    const c1 = canalSimulado('c1')
    const c2 = canalSimulado('c2')
    const [a, b] = await Promise.all([
      observar(env, { fetch: semRede, agoraIso: porta.agora, canal: c1, porta }),
      observar(env, { fetch: semRede, agoraIso: porta.agora, canal: c2, porta }),
    ])
    expect(c1.recebidos.length + c2.recebidos.length).toBe(1)
    expect(a.cedidos + b.cedidos).toBe(1)
    expect(porta.reivindicacoes).toHaveLength(2)
    expect(porta.entregas).toHaveLength(1)
  })
  it('canal fora do ar: nada é confirmado e a passada seguinte entrega', async () => {
    const porta = portaMonitorMemoria()
    porta.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    const canal = canalSimulado()
    canal.falhar = true
    porta.definirAgora(iso(T0 + 0.2 * H))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 0, pendentes: 1 })
    canal.falhar = false
    porta.definirAgora(iso(T0 + 0.2 * H + (JANELA_REIVINDICACAO_MIN + 1) * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 1, pendentes: 0 })
    expect(canal.recebidos).toHaveLength(1)
  })
  it('execução interrompida depois de reivindicar: a reivindicação velha não segura o alerta', async () => {
    const porta = portaMonitorMemoria()
    porta.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    porta.definirAgora(iso(T0 + 0.2 * H))
    const a = avaliarRodadas(porta.rodadas, porta.agora(), C60)[0]!
    await porta.reivindicarAlerta(a) // o observador morreu aqui, antes do aviso
    const canal = canalSimulado()
    // dentro da janela, a reivindicação viva ainda segura (outro observador pode estar avisando)
    porta.definirAgora(iso(T0 + 0.2 * H + 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 0, cedidos: 1 })
    // na passada seguinte do agendamento (10 min depois), as duas reivindicações caducaram: o alerta sai uma vez
    porta.definirAgora(iso(T0 + 0.2 * H + 60_000 + INTERVALO_PADRAO_MIN * 60_000))
    expect(INTERVALO_PADRAO_MIN).toBeGreaterThan(JANELA_REIVINDICACAO_MIN)
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 1 })
    expect(canal.recebidos).toHaveLength(1)
  })
  it('o menor id é numérico, não textual', () => {
    expect(menorId([{ id: '10', em: '' }, { id: '9', em: '' }])).toBe('9')
  })
  it('intervalo: padrão é o da rodada; inválido nunca vira zero', () => {
    expect(intervaloDe({})).toBe(INTERVALO_PADRAO_MIN)
    expect(intervaloDe({ FORMULARIO_INTERVALO_MIN: '0' })).toBe(INTERVALO_PADRAO_MIN)
    expect(intervaloDe({ FORMULARIO_INTERVALO_MIN: '60' })).toBe(60)
  })
  it('linha malformada da auditoria é descartada, não inventada', () => {
    expect(rodadaDaLinha({ after_data: { desfecho: 'inventado', em: iso(T0) } })).toBeUndefined()
    expect(rodadaDaLinha({ after_data: null })).toBeUndefined()
    expect(rodadaDaLinha({ after_data: { ...rodada(0) } })).toEqual(rodada(0))
  })
})

// ── integração: rodada real → registro → observador ───────────────────────────

function bancoEmMemoria(opcoes: { falharGravacaoDe?: string; falharIngestDe?: string } = {}) {
  const registros: RegistroFonte[] = []
  const conversas = new Set<string>()
  const prazos = new Map<string, string>()
  const aberturas = new Map<string, string>()
  let gravacoes = 0
  const portas: PortasGravacao = {
    async fonte(id) { return { id, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: true } },
    async prazoDaConversa(_p, ext) { return conversas.has(ext) ? { threadId: `THR-${ext}`, venceEm: prazos.get(ext), aberta: true, abertaEm: aberturas.get(ext) } : undefined },
    async definirPrazo(threadId, venceEm) { prazos.set(threadId.replace(/^THR-/, ''), venceEm); return venceEm },
    async registrosDaSubmissao(f, ext) { return registros.filter((r) => r.fonteId === f && r.externoId === ext) },
    async conversaExiste(_p, ext) { return conversas.has(ext) },
    async gravarEvidencia(l) {
      if (String(l['external_id']) === opcoes.falharGravacaoDe) throw new Error('postgrest http 503')
      // o índice único (organização, fonte, id externo, impressão), como o PostgREST relata: 409
      if (registros.some((r) => r.externoId === String(l['external_id']) && r.payloadFingerprint === String(l['payload_fingerprint']))) {
        throw new Error('postgrest POST radar_source_record http 409')
      }
      gravacoes += 1
      registros.push({ id: `RF-${gravacoes}`, fonteId: String(l['source_id']), tipo: l['record_type'] as RegistroFonte['tipo'], externoId: String(l['external_id']), payload: l['payload'], recebidoEm: String(l['received_at']), payloadFingerprint: String(l['payload_fingerprint']), statusIntake: 'PENDING' })
      return `RF-${gravacoes}`
    },
    async estadoEmLote(f, _p, ids) {
      return {
        evidencias: registros.filter((r) => r.fonteId === f && ids.includes(r.externoId ?? '')).map((r) => ({ externoId: r.externoId ?? '', impressao: r.payloadFingerprint })),
        conversas: ids.filter((x) => conversas.has(x)),
        prazos: ids.filter((x) => conversas.has(x)).map((x) => ({ externoId: x, threadId: `THR-${x}`, venceEm: prazos.get(x), aberta: true, abertaEm: aberturas.get(x) })),
      }
    },
    async ingerir(p) {
      if (p.externalMessageId === opcoes.falharIngestDe) throw new Error('rpc inbox_ingest http 503')
      // a conversa demora um pouco mais que a evidência: é a janela em que a outra rodada pode olhar
      await new Promise((r) => setTimeout(r, 1))
      conversas.add(p.externalMessageId)
      prazos.set(p.externalMessageId, new Date(Date.parse(p.em) + 24 * H).toISOString())
      aberturas.set(p.externalMessageId, p.em)
      return { ok: true, duplicada: false, threadId: `THR-${p.externalMessageId}`, messageId: `MSG-${p.externalMessageId}`, novaThread: true }
    },
  }
  return { portas, registros, conversas, get gravacoes() { return gravacoes } }
}

const sub = (id: string, criadoEm: string) => ({
  id, form_name: 'simular-galpao', state: 'verified', created_at: criadoEm,
  data: { nome: 'Ana Lima (FICTÍCIO)', email: `${id}@exemplo.invalido`, telefone: '62 90000-0000', empresa: 'Lima (FICTÍCIO)', cidade: 'Goiânia, GO', uso: 'industrial', area: '900', observacao: 'Galpão.' },
})

async function rodar(banco: ReturnType<typeof bancoEmMemoria>, subs: unknown[], emIso: string, extraEnv: Partial<AmbienteAgendado> = {}) {
  const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d } as unknown as Response)
  const env: AmbienteAgendado = { FORMULARIO_RECONCILIACAO: 'ativa', EIFF_FORM_MARCO: '2026-11-10T01:21:02Z', EIFF_FORM_NETLIFY_SITE: 'site', NETLIFY_AUTH_TOKEN: 'segredo-de-teste', ...extraEnv }
  return rodadaDeReconciliacao(env, {
    fetch: (async (url: string) => {
      if (String(url).endsWith('/forms')) return ok([{ id: 'F1', name: 'simular-galpao' }])
      if (String(url).includes('/submissions')) return ok(String(url).includes('page=1') ? subs : [])
      return ok([])
    }) as unknown as typeof fetch,
    agora: () => 0, agoraIso: () => emIso, log: () => {}, esperar: () => new Promise((r) => setTimeout(r, 5)),
    portas: { portas: banco.portas, fonteId: 'FNT', organizacaoId: 'ORG' },
  })
}

describe('integração: rodada real → registro → observador', () => {
  it('cenário completo: recuperação, idempotência, falha parcial, ausência — sem duplicar nada', async () => {
    const banco = bancoEmMemoria({ falharGravacaoDe: 'sub-c' })
    const porta = portaMonitorMemoria()
    const env = { FORMULARIO_MONITOR: 'ativo', FORMULARIO_INTERVALO_MIN: '60' }
    const linhas: Record<string, unknown>[] = []
    const canal = canalSomenteRegistro((t) => linhas.push(t))
    const semRede = (async () => { throw new Error('rede') }) as unknown as typeof fetch
    const subs = [sub('sub-hist', '2026-11-01T10:00:00Z'), sub('sub-a', '2026-11-20T09:00:00Z'), sub('sub-b', '2026-11-20T09:10:00Z'), sub('sub-c', '2026-11-20T09:20:00Z')]
    const passo = async (horas: number) => {
      const em = iso(T0 + horas * H)
      const r = await rodar(banco, subs, em)
      await registrarRodada(env, r, { fetch: semRede, porta })
      porta.definirAgora(iso(T0 + horas * H + 10 * 60_000))
      const o = await observar(env, { fetch: semRede, agoraIso: () => iso(T0 + horas * H + 10 * 60_000), canal, porta })
      return { r, o }
    }

    // 1ª rodada: a e b recuperadas, c falha, a histórica fica retida
    const p1 = await passo(0)
    expect(p1.r).toMatchObject({ desfecho: 'concluida', retidas: 1, elegiveis: 3, recuperadas: 2, falhas: 1 })
    expect(p1.o.tipos.sort()).toEqual(['FALHA_GRAVACAO', 'RECUPERACAO'])
    expect(banco.registros.map((r) => r.externoId).sort()).toEqual(['sub-a', 'sub-b'])

    // 2ª rodada: a e b já dentro (NÃO regravadas), c falha de novo → crítico
    const p2 = await passo(1)
    expect(p2.r).toMatchObject({ jaDentro: 2, processadas: 1, recuperadas: 0, falhas: 1 })
    expect(banco.gravacoes).toBe(2)
    expect(p2.o.tipos).toEqual(['FALHA_GRAVACAO'])
    expect(porta.reivindicacoes.filter((a) => a.tipo === 'FALHA_GRAVACAO').map((a) => a.severidade)).toEqual(['aviso', 'critico'])

    // 3ª: o problema persiste; FALHAS_CONSECUTIVAS aparece uma vez; nada se repete
    const p3 = await passo(2)
    expect(p3.o.tipos).toEqual(['FALHAS_CONSECUTIVAS'])
    expect(p3.o.suprimidos).toBe(2) // a falha crítica e a recuperação da 1ª rodada, já entregues

    // a rodada para de rodar: só o observador percebe
    const tarde = iso(T0 + 2 * H + 3 * H)
    porta.definirAgora(tarde)
    const o4 = await observar(env, { fetch: semRede, agoraIso: () => tarde, canal, porta })
    expect(o4.tipos).toContain('RODADA_AUSENTE')

    // nenhum processamento duplicado, nenhuma conversa a mais, nenhum dado pessoal em linha alguma
    expect(banco.registros).toHaveLength(2)
    expect(banco.conversas.size).toBe(2)
    for (const l of linhas) expect(problemasDeDadoPessoal(l)).toEqual([])
    for (const r of porta.rodadas) expect(problemasDeDadoPessoal(r)).toEqual([])
    expect(new Set(porta.entregas.map((a) => a.chave)).size).toBe(porta.entregas.length)
    expect(porta.entregas).toHaveLength(porta.reivindicacoes.length)
  })
})

describe('concorrência entre rodadas (E10.19: classificador ligado à rodada)', () => {
  it('duas rodadas ao mesmo tempo sobre uma submissão nova: exatamente uma vez, nenhuma falha, nenhum alerta falso', async () => {
    const banco = bancoEmMemoria()
    const subs = [sub('sub-corrida', '2026-11-20T09:00:00Z')]
    const [a, b] = await Promise.all([rodar(banco, subs, iso(T0)), rodar(banco, subs, iso(T0))])
    expect(banco.registros).toHaveLength(1)
    expect(banco.conversas.size).toBe(1)
    expect(a.falhas + b.falhas).toBe(0)
    expect(a.recuperadas + b.recuperadas).toBe(1)
    expect((a.resultados['CONCORRENTE'] ?? 0) + (b.resultados['CONCORRENTE'] ?? 0)).toBe(1)
    const alertas = avaliarRodadas([a, b].map(registroDaRodada), iso(T0 + 60_000), configParaIntervalo(10))
    expect(alertas.map((x) => x.tipo)).toEqual(['RECUPERACAO'])
  })
  it('a vencedora para no meio (conversa falhou): a perdedora vê PARCIAL e conta falha — o problema é real', async () => {
    const banco = bancoEmMemoria({ falharIngestDe: 'sub-meio' })
    const subs = [sub('sub-meio', '2026-11-20T09:00:00Z')]
    const [a, b] = await Promise.all([rodar(banco, subs, iso(T0)), rodar(banco, subs, iso(T0))])
    expect(banco.registros).toHaveLength(1)
    expect(a.falhas + b.falhas).toBe(2)
    expect((a.resultados['PARCIAL'] ?? 0) + (b.resultados['PARCIAL'] ?? 0)).toBe(1)
    expect((a.resultados['CONCORRENTE'] ?? 0) + (b.resultados['CONCORRENTE'] ?? 0)).toBe(0)
  })
  it('sem conflito, nada muda: uma falha de rede continua falha e não abre verificação', async () => {
    const banco = bancoEmMemoria({ falharGravacaoDe: 'sub-rede' })
    const r = await rodar(banco, [sub('sub-rede', '2026-11-20T09:00:00Z')], iso(T0))
    expect(r.falhas).toBe(1)
    expect(r.resultados['CONCORRENTE']).toBeUndefined()
    expect(r.resultados['PARCIAL']).toBeUndefined()
  })
})

describe('canais de alerta (simulados; nenhum envio real)', () => {
  const todos = (): Alerta[] => [
    ...avaliarRodadas([rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })], iso(T0 + 3 * H), C60),
    ...avaliarRodadas([rodada(0, { falhas: 1, processadas: 2, recuperadas: 1 })], iso(T0 + 0.1 * H), C60),
    ...avaliarRodadas([1, 2, 3].map((h) => rodada(h, { desfecho: 'erro_de_leitura', codigo: 'HTTP_5XX' })), iso(T0 + 3.1 * H), C60),
    ...avaliarRodadas([rodada(0, { desfecho: 'nao_configurada', codigo: 'SEM_MARCO' })], iso(T0 + 0.1 * H), C60),
    ...avaliarRodadas([rodada(0, { desfecho: 'desligada' })], iso(T0 + 0.1 * H), C60),
  ]
  it('as sete situações saem com título e ação distintos, sem dado pessoal', () => {
    const ms = todos().map(mensagemDoAlerta)
    const porTipo = new Map(ms.map((m) => [m.tipo, m]))
    expect([...porTipo.keys()].sort()).toEqual(['CONFIGURACAO', 'DESLIGADA', 'FALHAS_CONSECUTIVAS', 'FALHA_GRAVACAO', 'FALHA_LEITURA', 'RECUPERACAO', 'RODADA_AUSENTE'])
    expect(new Set([...porTipo.values()].map((m) => m.titulo)).size).toBe(7)
    expect(porTipo.get('DESLIGADA')!.titulo).toContain('[INFORMATIVO]')
    expect(porTipo.get('RODADA_AUSENTE')!.titulo).toContain('[CRÍTICO]')
    for (const m of ms) expect(problemasDeDadoPessoal(m)).toEqual([])
  })
  const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123'
  it('webhook: POST JSON assinado, 2xx entrega, erro não vaza URL nem segredo', async () => {
    const pedidos: { corpo: string; cab: Record<string, string> }[] = []
    let status = 200
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      pedidos.push({ corpo: String(init.body), cab: init.headers as Record<string, string> })
      return { ok: status < 300, status } as Response
    }) as unknown as typeof fetch
    const c = canalWebhook('https://hooks.exemplo.invalido/segredo-no-caminho', fetchFalso, { segredo: SEGREDO, agoraSegundos: () => 1_790_000_000 })
    const a = todos()[0]!
    await c.avisar(a)
    const { corpo, cab } = pedidos[0]!
    expect(JSON.parse(corpo)).toMatchObject({ tipo: a.tipo, severidade: 'critico', chave: a.chave, versao: 'v1' })
    expect(problemasDeDadoPessoal(JSON.parse(corpo))).toEqual([])
    // o receptor confere a assinatura com o mesmo segredo e o mesmo timestamp
    const esperada = createHmac('sha256', SEGREDO).update(`1790000000.${corpo}`).digest('hex')
    expect(cab['x-eiff-assinatura']).toBe(`v1=${esperada}`)
    expect(cab['x-eiff-timestamp']).toBe('1790000000')
    expect(cab['x-eiff-entrega']).toBe(a.chave)
    expect(corpo).not.toContain(SEGREDO)
    status = 503
    const e = await c.avisar(a).catch((x: Error) => x)
    expect(String(e)).toContain('http 503')
    expect(String(e)).not.toContain('segredo-no-caminho')
    expect(String(e)).not.toContain(SEGREDO)
  })
  it('webhook exige https e segredo forte', () => {
    expect(() => canalWebhook('http://exemplo.invalido/x', fetch, { segredo: SEGREDO })).toThrow(/https/)
    expect(() => canalWebhook('https://exemplo.invalido/x', fetch, { segredo: 'curto' })).toThrow(/segredo/)
  })
  it('com registro: a falha do webhook NÃO vira entrega (o registro sozinho nunca confirma)', async () => {
    const linhas: Record<string, unknown>[] = []
    const fora = canalSimulado('fora')
    fora.falhar = true
    await expect(canalComRegistro(fora, (t) => linhas.push(t)).avisar(todos()[0]!)).rejects.toThrow(/indisponível/)
    expect(linhas).toHaveLength(1)
  })
  it('composto de canais de entrega: basta um aceitar; se todos falharem, falha', async () => {
    const ok = canalSimulado('ok')
    const ruim = canalSimulado('ruim')
    ruim.falhar = true
    await canalComposto([ruim, ok]).avisar(todos()[0]!)
    expect(ok.recebidos).toHaveLength(1)
    ok.falhar = true
    await expect(canalComposto([ruim, ok]).avisar(todos()[0]!)).rejects.toThrow(/ruim.*ok/)
  })
  it('pelo ambiente: registro por padrão; webhook sem URL ou sem segredo cai no registro, sem derrubar e sem vazar', () => {
    const logs: Record<string, unknown>[] = []
    expect(canalDoAmbiente({}, fetch, (t) => logs.push(t)).nome).toBe('registro')
    expect(canalDoAmbiente({ FORMULARIO_ALERTA_CANAL: 'webhook', FORMULARIO_ALERTA_WEBHOOK_SEGREDO: SEGREDO }, fetch, (t) => logs.push(t)).nome).toBe('registro')
    expect(canalDoAmbiente({ FORMULARIO_ALERTA_CANAL: 'webhook', FORMULARIO_ALERTA_WEBHOOK_URL: 'https://x.invalido/h', FORMULARIO_ALERTA_WEBHOOK_SEGREDO: 'curto' }, fetch, (t) => logs.push(t)).nome).toBe('registro')
    expect(logs.map((l) => l['outcome'])).toEqual(['canal_invalido', 'canal_invalido'])
    expect(JSON.stringify(logs)).not.toContain(SEGREDO)
    expect(canalDoAmbiente({ FORMULARIO_ALERTA_CANAL: 'webhook', FORMULARIO_ALERTA_WEBHOOK_URL: 'https://x.invalido/h', FORMULARIO_ALERTA_WEBHOOK_SEGREDO: SEGREDO }, fetch, () => {}).nome).toBe('registro+webhook')
  })
  it('observador com webhook fora do ar: fica pendente e a passada seguinte entrega uma vez', async () => {
    const porta = portaMonitorMemoria()
    porta.rodadas.push(rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' }))
    let status = 503
    const chamadas: string[] = []
    const fetchFalso = (async (_u: string, init: RequestInit) => { chamadas.push(String(init.body)); return { ok: status < 300, status } as Response }) as unknown as typeof fetch
    const canal = canalDoAmbiente({ FORMULARIO_ALERTA_CANAL: 'webhook', FORMULARIO_ALERTA_WEBHOOK_URL: 'https://x.invalido/h', FORMULARIO_ALERTA_WEBHOOK_SEGREDO: SEGREDO }, fetchFalso, () => {})
    const env = { FORMULARIO_MONITOR: 'ativo', FORMULARIO_INTERVALO_MIN: '60' }
    const semRede = (async () => { throw new Error('rede') }) as unknown as typeof fetch
    porta.definirAgora(iso(T0 + 0.2 * H))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 0, pendentes: 1 })
    status = 200
    porta.definirAgora(iso(T0 + 0.2 * H + INTERVALO_PADRAO_MIN * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 1, pendentes: 0 })
    porta.definirAgora(iso(T0 + 0.2 * H + 2 * INTERVALO_PADRAO_MIN * 60_000))
    expect(await observar(env, { fetch: semRede, agoraIso: porta.agora, canal, porta })).toMatchObject({ novos: 0, suprimidos: 1 })
    expect(chamadas).toHaveLength(2)
    expect(porta.entregas).toHaveLength(1)
  })
  it('nenhum canal depende da frente de e-mail comercial', () => {
    // só o código: os comentários citam a frente de e-mail justamente para dizer que não a usam
    const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const fonte = ['formularioAlertaCanais.ts', 'formularioObservador.ts', 'formularioMonitor.ts', 'formularioMonitorPorta.ts']
      .map((f) => semComentario(readFileSync(`src/core/radar/${f}`, 'utf8'))).join('\n')
    expect(fonte).not.toMatch(/GOOGLE_OAUTH|email-comercial|emailComercial|gmail/i)
  })
})

describe('contrato somente leitura para a Central', () => {
  it('estado ok, com as somas da janela e o último alerta entregue', () => {
    const rs = [rodada(-30), rodada(0, { lidas: 15, elegiveis: 2, processadas: 2, recuperadas: 1, falhas: 1 }), rodada(1, { lidas: 16 })]
    const e = estadoOperacional(rs, [{ chave: 'x', em: iso(T0 + 0.5 * H) }], iso(T0 + 1.2 * H), C60)
    expect(e).toEqual({
      versao: VERSAO_CONTRATO, geradoEm: iso(T0 + 1.2 * H), situacao: 'ok', intervaloMin: 60,
      ultimaExecucao: iso(T0 + 1 * H), ultimoDesfecho: 'concluida', examinadas: 16, janelaHoras: 24,
      recuperadas: 1, falhasGravacao: 1, rodadasComFalha: 0, ultimoAlertaEm: iso(T0 + 0.5 * H),
    })
    expect(problemasDeDadoPessoal(e)).toEqual([])
  })
  it('as cinco situações', () => {
    expect(estadoOperacional([], [], iso(T0), C60).situacao).toBe('sem_registro')
    expect(estadoOperacional([rodada(0, { desfecho: 'desligada' })], [], iso(T0 + 30 * H), C60).situacao).toBe('desligada')
    expect(estadoOperacional([rodada(0)], [], iso(T0 + 3 * H), C60).situacao).toBe('ausente')
    const f = estadoOperacional([rodada(0, { desfecho: 'erro_de_leitura', codigo: 'HTTP_401' })], [], iso(T0 + 0.1 * H), C60)
    expect(f).toMatchObject({ situacao: 'com_falha', codigoUltimaFalha: 'HTTP_401', rodadasComFalha: 1 })
    expect(f.examinadas).toBeUndefined()
  })
})

describe('frequência de 10 minutos (D2)', () => {
  it('orçamento: hoje (60 min) × proposta (10 min), com a base de 16/11', () => {
    const hoje = orcamentoDaFrequencia({ intervaloMin: 60, submissoesLidas: 14, elegiveis: 0, formularios: 2, lote: 20 })
    const dez = orcamentoDaFrequencia({ intervaloMin: 10, submissoesLidas: 14, elegiveis: 0, formularios: 2, lote: 20 })
    expect(hoje).toMatchObject({ rodadasPorDia: 24, invocacoesPorMes: 720, chamadasNetlifyPorRodada: 3, chamadasNetlifyPorDia: 72, vazaoMaximaPorHora: 20, atrasoMaximoMin: 60 })
    expect(dez).toMatchObject({ rodadasPorDia: 144, invocacoesPorMes: 4320, chamadasNetlifyPorRodada: 3, chamadasNetlifyPorDia: 432, vazaoMaximaPorHora: 120, atrasoMaximoMin: 10 })
  })
  it('crescimento: com 1.000 submissões e 500 elegíveis, cada rodada continua pequena', () => {
    const o = orcamentoDaFrequencia({ intervaloMin: 10, submissoesLidas: 1000, elegiveis: 500, formularios: 2, lote: 20 })
    expect(o.chamadasNetlifyPorRodada).toBe(11)
    expect(o.consultasBancoPorRodada).toBe(30)
  })
  it('rodada e observador agendados a cada 10 minutos, independentes um do outro', () => {
    const rodadaFn = readFileSync('netlify/functions/formulario-reconciliar.mts', 'utf8')
    const observadorFn = readFileSync('netlify/functions/formulario-observador.mts', 'utf8')
    expect(rodadaFn).toContain("schedule: '*/10 * * * *'")
    expect(observadorFn).toContain("schedule: '*/10 * * * *'")
    // o observador não chama a rodada: só lê o que ela registrou
    expect(observadorFn).not.toMatch(/rodadaDeReconciliacao/)
  })
})

describe('contrato da Central: leitura das linhas da auditoria e saúde exibível (E10.22)', () => {
  it('linhas cruas → estado → saúde, sem dado pessoal; linhas estranhas são ignoradas', () => {
    const linhas = [
      { action: 'rodada', after_data: rodada(0, { recuperadas: 1, processadas: 1 }) },
      { action: 'rodada', after_data: rodada(1) },
      { action: 'alerta_entregue', entity_id: 'RECUPERACAO|-|aviso|x', occurred_at: iso(T0 + 0.2 * H) },
      { action: 'alerta', entity_id: 'reivindicacao-nao-conta', occurred_at: iso(T0 + 0.3 * H) },
      { action: 'rodada', after_data: { desfecho: 'inventado' } },
      { action: 'salvar_lancamento', entity_id: 'L-1' },
    ]
    const e = estadoOperacionalDasLinhas(linhas, iso(T0 + 1.2 * H), C60)
    expect(e).toMatchObject({ situacao: 'ok', recuperadas: 1, ultimoAlertaEm: iso(T0 + 0.2 * H), examinadas: 14 })
    const s = saudeExibivel(e)
    expect(s).toMatchObject({ situacao: 'ok', tom: 'ok' })
    expect(problemasDeDadoPessoal(s)).toEqual([])
  })
  it('cada situação tem rótulo e tom próprios', () => {
    const tons = (['sem_registro', 'desligada', 'ok', 'com_falha', 'ausente'] as const).map((situacao) => saudeExibivel({ ...estadoOperacional([], [], iso(T0)), situacao }))
    expect(new Set(tons.map((t) => t.rotulo)).size).toBe(5)
    expect(tons.find((t) => t.situacao === 'ausente')!.tom).toBe('critico')
  })
})

describe('porta do monitor: chave de serviço pela regra central (S1/R1)', () => {
  it('chave publicável ou desconhecida falha fechada, sem montar a porta', () => {
    const semRede = (() => { throw new Error('não pode chamar a rede') }) as unknown as typeof fetch
    for (const chave of ['sb_publishable_x', 'sb_temp_x', 'sb_outra_x']) {
      const p = portaDoAmbiente({ SUPABASE_SERVICE_ROLE_KEY: chave, EIFF_INBOX_ORGANIZATION_ID: 'org' }, semRede)
      expect('motivo' in p && p.motivo).toBe('credencial_invalida: SUPABASE_SERVICE_ROLE_KEY')
    }
  })
})

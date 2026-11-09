/**
 * A gravação: executa o plano e só devolve o que confirmou.
 *
 * ── O QUE ESTES TESTES PROTEGEM ──────────────────────────────────────────
 *
 * 1. a ORDEM (evidência antes da conversa) e o que acontece quando o
 *    processo morre no meio — o reenvio COMPLETA, não duplica;
 * 2. a RECUSA DE SUCESSO: evidência sem id de volta, ou RPC que não confirma
 *    a thread, viram erro — nunca um 200 sobre gravação que não houve;
 * 3. o RASTRO: a conversa aponta para a evidência REAL, inclusive quando a
 *    evidência foi gravada numa passagem anterior;
 * 4. o CONTATO: completa em qualquer passagem, só o que está vazio, e falhar
 *    nele não derruba o pedido.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ErroDeConfiguracao, ErroDeGravacao, PRAZO_PRIMEIRA_RESPOSTA_MIN, ROTULO_LEITURA_DA_PAGINA, decidirPrazo, gravarSubmissao, linhaDeEvidencia,
  linhaDeOrigem, prazoDoLead, resumoParaOInbox, validarFonte, type EstadoDoPrazo, type FonteLida, type PortasGravacao,
} from './formularioGravacao'
import { textoDaMensagem } from '../inbox/formularioSite'
import { pedidoDeIntake, type SubmissaoFormulario } from './formularioSite'
import { planejarGravacao } from './formularioServidor'
import { registroDeIntake, validarIntake } from './leadEngineIntake'
import type { RegistroFonte } from './types'

const FONTE = 'FNT-SITE'
const ORG = 'ORG-1'

const SUB: SubmissaoFormulario = {
  id: 'nf-777',
  formulario: 'simular-galpao',
  recebidoEm: '2026-11-09T14:00:00.000Z',
  campos: {
    nome: 'Ana Lima (FICTÍCIO)', email: 'ana@exemplo.com.br', telefone: '62 90000-0000',
    empresa: 'Lima Indústria', cidade: 'Goiânia, GO', uso: 'industrial', area: '900',
    vao: '20', observacao: 'Preciso de um galpão para a fábrica.', resumo: 'Industrial · 900 m² · vão 20 m',
    leitura: '[especial] Vão de 20 m acima do já projetado. É possível, mas exige estudo estrutural específico.',
  },
}

const evidenciaExistente = (s: SubmissaoFormulario, id = 'RF-1'): RegistroFonte => {
  const p = pedidoDeIntake(s, FONTE)
  const v = validarIntake(p)
  if (!v.ok) throw new Error('setup')
  return registroDeIntake(v, p, id)
}

interface Espiao {
  portas: PortasGravacao
  ordem: string[]
  evidencias: Record<string, unknown>[]
  ingestoes: unknown[]
  completados: { contatoId: string; dados: unknown }[]
  roteadas: string[]
  prazos: { threadId: string; venceEm: string }[]
}

function espiao(opcoes: {
  registros?: RegistroFonte[]
  conversaExiste?: boolean
  idEvidencia?: string | (() => string)
  ingest?: Partial<{ ok: boolean; duplicada: boolean; threadId: string; messageId: string; contactId: string; novaThread: boolean; erro: string }>
  falharIngest?: boolean
  falharContato?: boolean
  semRotear?: boolean
  contatoDaIdentidade?: string
  fonte?: FonteLida | undefined
  falharFonte?: boolean
  prazo?: Partial<EstadoDoPrazo>
  falharLeituraDoPrazo?: boolean
  falharPrazo?: 'erro' | 'sem_confirmacao' | 'valor_diferente'
} = {}): Espiao {
  const e: Espiao = { ordem: [], evidencias: [], ingestoes: [], completados: [], roteadas: [], prazos: [], portas: {} as PortasGravacao }
  let conversa = opcoes.conversaExiste ?? false
  // a conversa nasce com 24 h corridas, como a RPC grava; o passo do prazo é o que corrige
  let vence: string | undefined = opcoes.prazo && 'venceEm' in opcoes.prazo ? opcoes.prazo.venceEm : '2026-11-10T14:00:00.000Z'
  e.portas = {
    fonte: async (fonteId) => {
      if (opcoes.falharFonte === true) throw new Error('postgrest GET radar_source http 500')
      return 'fonte' in opcoes ? opcoes.fonte : { id: fonteId, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: true }
    },
    prazoDaConversa: async () => {
      if (opcoes.falharLeituraDoPrazo === true) throw new Error('postgrest GET inbox_thread http 500')
      if (!conversa) return undefined
      return { threadId: 'THR-1', aberta: true, ...opcoes.prazo, ...(vence !== undefined ? { venceEm: vence } : {}) }
    },
    definirPrazo: async (threadId, venceEmIso) => {
      e.ordem.push('prazo')
      e.prazos.push({ threadId, venceEm: venceEmIso })
      if (opcoes.falharPrazo === 'erro') throw new Error('postgrest PATCH inbox_thread http 500')
      if (opcoes.falharPrazo === 'sem_confirmacao') return undefined
      if (opcoes.falharPrazo === 'valor_diferente') return '2026-11-10T14:00:00.000Z'
      vence = venceEmIso
      return venceEmIso
    },
    registrosDaSubmissao: async () => opcoes.registros ?? [],
    conversaExiste: async () => opcoes.conversaExiste ?? false,
    gravarEvidencia: async (linha) => {
      e.ordem.push('evidencia')
      e.evidencias.push(linha)
      const id = opcoes.idEvidencia ?? 'RF-NOVO'
      return typeof id === 'function' ? id() : id
    },
    ingerir: async (p) => {
      e.ordem.push('conversa')
      e.ingestoes.push(p)
      if (opcoes.falharIngest === true) throw new Error('rpc caiu')
      if (opcoes.ingest?.ok !== false) conversa = true
      return {
        ok: true, duplicada: false, threadId: 'THR-1', messageId: 'MSG-1', contactId: 'CTI-1',
        novaThread: true, novoContato: true, reaberta: false, ...opcoes.ingest,
      }
    },
    contatoDaIdentidade: async () => opcoes.contatoDaIdentidade,
    completarContato: async (contatoId, dados) => {
      e.ordem.push('contato')
      if (opcoes.falharContato === true) throw new Error('patch recusado')
      e.completados.push({ contatoId, dados })
      return { campos: ['name', 'company_name', 'relation_kind'], identidades: 1 }
    },
    ...(opcoes.semRotear === true ? {} : {
      rotear: async (threadId) => { e.ordem.push('rotear'); e.roteadas.push(threadId); return { ok: true, aplicado: true, classificado: false } },
    }),
  }
  return e
}

/* ------------------------------------------------------------------ */

describe('gravação · submissão nova', () => {
  it('grava evidência e conversa, NESSA ordem, e devolve os dois ids', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('REGISTRADO')
    expect(e.ordem.slice(0, 2)).toEqual(['evidencia', 'conversa'])
    expect(r.registroFonteId).toBe('RF-NOVO')
    expect(r.threadId).toBe('THR-1')
    expect(r.novaConversa).toBe(true)
  })

  it('a evidência nasce PENDING, sem entidade e com a impressão do Lead Engine', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    const linha = e.evidencias[0]!
    expect(linha['organization_id']).toBe(ORG)
    expect(linha['source_id']).toBe(FONTE)
    expect(linha['intake_status']).toBe('PENDING')
    expect(linha['entity_id']).toBeNull()
    expect(linha['payload_fingerprint']).toBe(r.payloadFingerprint)
    /* o instante é o da submissão, não o do processamento */
    expect(linha['received_at']).toBe(SUB.recebidoEm)
  })

  it('a conversa leva o rastro da evidência real, nunca um marcador', async () => {
    const e = espiao({ idEvidencia: 'RF-42' })
    await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    const meta = (e.ingestoes[0] as { meta: Record<string, unknown> }).meta
    expect(meta['registroFonteId']).toBe('RF-42')
    expect(String(meta['registroFonteId'])).not.toBe('pendente')
    expect(meta['formulario']).toBe('simular-galpao')
  })

  it('e vai ao Inbox como PORTAL externo, sem exigir empresa nem CNPJ', async () => {
    const e = espiao()
    await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    const p = e.ingestoes[0] as Record<string, unknown>
    expect(p['canal']).toBe('PORTAL')
    expect(p['contexto']).toBe('EXTERNAL')
    expect(p['identificador']).toBe('ana@exemplo.com.br')
    expect(p['externalMessageId']).toBe('nf-777')
    expect(JSON.stringify(p)).not.toContain('cnpj')
  })
})

describe('gravação · recuperação', () => {
  it('evidência gravada e conversa não: COMPLETA só a conversa', async () => {
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: false })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('COMPLETADO')
    expect(e.ordem).not.toContain('evidencia')
    expect(e.ordem).toContain('conversa')
    /* e o rastro aponta para a evidência que JÁ existia */
    expect(r.registroFonteId).toBe('RF-1')
    expect((e.ingestoes[0] as { meta: Record<string, unknown> }).meta['registroFonteId']).toBe('RF-1')
  })

  it('as duas já existem: reenvio não grava nada', async () => {
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: true })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('IDEMPOTENTE')
    expect(e.evidencias.length).toBe(0)
    expect(e.ingestoes.length).toBe(0)
  })

  it('nova versão da mesma submissão: nasce ao lado e NÃO repete a conversa', async () => {
    const outra = { ...SUB, campos: { ...SUB.campos, area: '1200' } }
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: true })
    const r = await gravarSubmissao(outra, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('NOVA_OBSERVACAO')
    expect(e.evidencias.length).toBe(1)
    expect(e.ingestoes.length).toBe(0)
  })

  it('nova versão SEM conversa: nasce ao lado e abre o atendimento que faltou', async () => {
    const outra = { ...SUB, campos: { ...SUB.campos, area: '1200' } }
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: false })
    const r = await gravarSubmissao(outra, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('NOVA_OBSERVACAO')
    expect(e.ordem.slice(0, 2)).toEqual(['evidencia', 'conversa'])
  })

  it('o reenvio depois de tudo pronto é inofensivo, quantas vezes vier', async () => {
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: true })
    for (let i = 0; i < 5; i += 1) await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(e.evidencias.length).toBe(0)
    expect(e.ingestoes.length).toBe(0)
  })
})

describe('gravação · nunca devolve sucesso do que não gravou', () => {
  it('insert sem id na volta é erro, e a conversa nem é tentada', async () => {
    const e = espiao({ idEvidencia: '' })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toThrow(ErroDeGravacao)
    expect(e.ingestoes.length).toBe(0)
  })

  it('porta da evidência que explode é erro na etapa evidência', async () => {
    const e = espiao({ idEvidencia: () => { throw new Error('unique violada') } })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toMatchObject({ etapa: 'evidencia' })
    expect(e.ingestoes.length).toBe(0)
  })

  it('RPC que explode é erro na etapa conversa — com a evidência já salva', async () => {
    const e = espiao({ falharIngest: true })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toMatchObject({ etapa: 'conversa' })
    expect(e.evidencias.length).toBe(1)
  })

  it('RPC que recusa (ok falso) é erro, não sucesso silencioso', async () => {
    const e = espiao({ ingest: { ok: false, erro: 'somente_servidor' } })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toThrow(/somente_servidor/)
  })

  it('RPC sem thread na volta é erro: a gravação não está confirmada', async () => {
    const e = espiao({ ingest: { ok: true, threadId: undefined } })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toThrow(/não confirmada/)
  })

  it('evidência existente sem id utilizável é erro, não rastro vazio', async () => {
    // O plano não grava (impressão idêntica), então o id tem de vir do registro.
    // Se o banco devolveu uma linha sem id, a conversa ficaria com rastro vazio:
    // isso é erro, não «grava assim mesmo».
    const e = espiao({ registros: [{ ...evidenciaExistente(SUB), id: '' }], conversaExiste: false })
    await expect(gravarSubmissao(SUB, FONTE, ORG, e.portas)).rejects.toThrow(/sem gravação e sem evidência/)
    expect(e.ingestoes.length).toBe(0)
  })
})

describe('gravação · o contato do atendente', () => {
  it('é completado com nome, empresa e telefone da submissão', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.contatoId).toBe('CTI-1')
    expect(r.contatoCompletado?.campos).toContain('relation_kind')
    const dados = e.completados[0]!.dados as { nome: string; empresaNome: string; relacaoSeDesconhecido: string; identidades: { canal: string; identificador: string }[] }
    expect(dados.nome).toBe('Ana Lima (FICTÍCIO)')
    expect(dados.empresaNome).toBe('Lima Indústria')
    expect(dados.relacaoSeDesconhecido).toBe('lead')
    /* o telefone entra em E.164 como segunda identidade */
    expect(dados.identidades[0]).toMatchObject({ canal: 'WHATSAPP', identificador: '5562900000000' })
  })

  it('completa também quando a RPC não devolve contato (reenvio): lê pela identidade', async () => {
    const e = espiao({ ingest: { duplicada: true, contactId: undefined }, contatoDaIdentidade: 'CTI-9' })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.contatoId).toBe('CTI-9')
    expect(e.completados[0]!.contatoId).toBe('CTI-9')
  })

  it('falhar ao completar NÃO derruba o pedido: a conversa já está visível', async () => {
    const e = espiao({ falharContato: true })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.threadId).toBe('THR-1')
    expect(r.contatoCompletado).toBeUndefined()
  })
})

describe('gravação · setor, responsável e prazo pelo que já existe', () => {
  it('chama o Octopus Router com a thread e a mensagem', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(e.roteadas).toEqual(['THR-1'])
    expect(r.roteada?.aplicado).toBe(true)
    /* o roteamento é o ÚLTIMO passo: nada depende dele para o lead existir */
    expect(e.ordem[e.ordem.length - 1]).toBe('rotear')
  })

  it('router desligado não impede nada', async () => {
    const e = espiao({ semRotear: true })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.threadId).toBe('THR-1')
    expect(r.roteada).toBeUndefined()
  })
})

describe('gravação · o que o atendente lê', () => {
  it('a mensagem da pessoa, a configuração, as medidas e o contato', () => {
    const r = resumoParaOInbox(SUB)
    expect(r.nome).toBe('Ana Lima (FICTÍCIO)')
    expect(r.email).toBe('ana@exemplo.com.br')
    expect(r.telefone).toBe('62 90000-0000')
    expect(r.cidade).toBe('Goiânia/GO')
    expect(r.mensagem).toBe('Preciso de um galpão para a fábrica.')
    expect(r.resumo).toBe('Industrial · 900 m² · vão 20 m')
    const linhas = (r.linhas ?? []).join(' | ')
    expect(linhas).toContain('vão 20 m')
    expect(linhas).toContain(ROTULO_LEITURA_DA_PAGINA)
  })

  it('e diz de onde a solicitação veio: formulário e site, uma vez só', () => {
    const t = textoDaMensagem(resumoParaOInbox(SUB))
    expect(t).toContain('Origem: formulário "simular-galpao" do site (eiff.com.br).')
    expect(t.split('Origem:').length - 1).toBe(1)
    expect(linhaDeOrigem({ formulario: 'iniciar-projeto' })).toContain('"iniciar-projeto"')
    /* o instante fica para a data da mensagem, que a interface mostra no fuso de quem lê */
    expect(t).not.toContain(SUB.recebidoEm)
  })

  it('a leitura técnica da página vai como EVIDÊNCIA rotulada, nunca como orientação da EIFF', () => {
    const t = textoDaMensagem(resumoParaOInbox(SUB))
    /* o texto do site é preservado palavra por palavra… */
    expect(t).toContain('exige estudo estrutural específico')
    /* …e a linha diz de quem é a fala ANTES de dizer qual é */
    const linha = t.split('\n').find((l) => l.includes('exige estudo estrutural específico'))!
    expect(linha.startsWith(ROTULO_LEITURA_DA_PAGINA)).toBe(true)
    expect(linha).toContain('não é orientação de engenharia da EIFF')
    /* e o rótulo nunca se apresenta como recomendação nossa */
    expect(ROTULO_LEITURA_DA_PAGINA.toLowerCase()).not.toContain('recomend')
  })

  it('e NADA aparece duas vezes no texto da conversa', () => {
    const t = textoDaMensagem(resumoParaOInbox(SUB))
    const vezes = (p: string) => t.split(p).length - 1
    expect(vezes('Configuração:')).toBe(1)
    expect(vezes('Preciso de um galpão para a fábrica.')).toBe(1)
    expect(vezes('Mensagem:')).toBe(0)
    /* e cada linha é única */
    const linhas = t.split('\n').filter((l) => l.trim() !== '')
    expect(new Set(linhas).size).toBe(linhas.length)
  })

  it('submissão magra não inventa texto', () => {
    const r = resumoParaOInbox({ id: 'x', formulario: 'iniciar-projeto', recebidoEm: SUB.recebidoEm, campos: { email: 'a@b.com' } })
    expect(r.nome).toBeUndefined()
    expect(r.mensagem).toBeUndefined()
    expect(r.email).toBe('a@b.com')
  })
})

describe('gravação · a linha da evidência é a mesma que a prova de banco usa', () => {
  it('as colunas são as da migration 0055, sem invenção', () => {
    const plano = planejarGravacao(SUB, FONTE, { registros: [], conversaExiste: false })
    const linha = linhaDeEvidencia(plano, ORG)
    expect(Object.keys(linha).sort()).toEqual([
      'decided_at', 'decided_by', 'decision_reason', 'entity_id', 'external_id',
      'intake_status', 'organization_id', 'payload', 'payload_fingerprint', 'received_at', 'record_type', 'source_id',
    ])
  })

  it('o payload é o envelope do formulário, com evidência e canônico', () => {
    const plano = planejarGravacao(SUB, FONTE, { registros: [], conversaExiste: false })
    const p = linhaDeEvidencia(plano, ORG)['payload'] as Record<string, unknown>
    expect(p['schema']).toBe('FORMULARIO_SITE_V1')
    expect(p['evidence']).toBeTruthy()
    expect(p['canonical']).toBeTruthy()
  })
})

describe('gravação · o que ela não faz', () => {
  // Guarda sobre o CÓDIGO, não sobre o espião: a promoção é humana, e o caminho
  // automático não pode ganhar um atalho para ela num refactor distraído.
  const fonte = readFileSync(new URL('./formularioGravacao.ts', import.meta.url), 'utf8')

  it('não chama promoção, criação de conta, oportunidade nem envio', () => {
    for (const proibido of [
      'ingerirRegistrosRadar', 'processarCandidatoLeadEngine', 'aplicarDecisao',
      'upsertContato', 'oportunidadeDoFormulario', 'sendApproved', 'generateCommunication',
    ]) {
      expect(fonte).not.toContain(proibido)
    }
  })

  it('e não encosta no motor estrutural', () => {
    for (const proibido of ['solveFrame', 'checkMember', 'resolverPortico']) {
      expect(fonte).not.toContain(proibido)
    }
  })

  it('o resultado não carrega empresa, oportunidade nem tarefa', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    for (const chave of ['empresaId', 'oportunidadeId', 'tarefaId', 'enviada']) {
      expect(Object.keys(r)).not.toContain(chave)
    }
  })
})

/* ------------------------------------------------------------------ */

describe('gravação · a fonte configurada é a do formulário do site', () => {
  const FONTE_OK: FonteLida = { id: FONTE, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: true }

  it('a regra pura: existe, é WEBSITE, é a canônica e está ativa', () => {
    expect(validarFonte(FONTE, FONTE_OK)).toEqual({ ok: true })
    expect(validarFonte(FONTE, undefined)).toEqual({ ok: false, motivo: 'fonte_inexistente' })
    expect(validarFonte(FONTE, { ...FONTE_OK, id: 'OUTRA' })).toEqual({ ok: false, motivo: 'fonte_inexistente' })
    expect(validarFonte(FONTE, { ...FONTE_OK, tipo: 'CNO', codigo: 'CNO' })).toEqual({ ok: false, motivo: 'fonte_nao_website' })
    // a outra fonte WEBSITE que existe em produção: mesmo tipo, outro código
    expect(validarFonte(FONTE, { ...FONTE_OK, codigo: 'OFFICIAL_COMPANY_SOURCE' })).toEqual({ ok: false, motivo: 'fonte_nao_canonica' })
    expect(validarFonte(FONTE, { ...FONTE_OK, ativa: false })).toEqual({ ok: false, motivo: 'fonte_inativa' })
  })

  const invalidas: [string, Parameters<typeof espiao>[0], string][] = [
    ['inexistente (ou de outra organização: a porta filtra antes)', { fonte: undefined }, 'fonte_inexistente'],
    ['de outro tipo', { fonte: { id: FONTE, codigo: 'CNO', tipo: 'CNO', ativa: true } }, 'fonte_nao_website'],
    ['WEBSITE, mas não a do simulador', { fonte: { id: FONTE, codigo: 'OFFICIAL_COMPANY_SOURCE', tipo: 'WEBSITE', ativa: true } }, 'fonte_nao_canonica'],
    ['inativa', { fonte: { id: FONTE, codigo: 'WEBSITE', tipo: 'WEBSITE', ativa: false } }, 'fonte_inativa'],
    ['que não pôde ser lida', { falharFonte: true }, 'fonte_nao_verificada'],
  ]
  it.each(invalidas)('fonte %s → erro de configuração e ZERO escrita', async (_nome, opcoes, motivo) => {
    const e = espiao(opcoes)
    const erro = await gravarSubmissao(SUB, FONTE, ORG, e.portas).catch((x: unknown) => x)
    expect(erro).toBeInstanceOf(ErroDeConfiguracao)
    expect((erro as ErroDeConfiguracao).motivo).toBe(motivo)
    expect(e.ordem).toEqual([])
    expect(e.evidencias).toEqual([])
    expect(e.ingestoes).toEqual([])
    expect(e.prazos).toEqual([])
  })

  it('fonte válida: o processamento é o de sempre', async () => {
    const e = espiao({ fonte: FONTE_OK })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('REGISTRADO')
    expect(e.ordem.slice(0, 2)).toEqual(['evidencia', 'conversa'])
  })
})

describe('gravação · prazo de primeira resposta do lead do site', () => {
  // SUB chega segunda 09/11/2026 às 11:00 em São Paulo (14:00 UTC): 30 min úteis → 11:30 (14:30 UTC)
  const ALVO = '2026-11-09T14:30:00.000Z'

  it('o alvo são 30 minutos ÚTEIS a partir do instante ORIGINAL da submissão', () => {
    expect(PRAZO_PRIMEIRA_RESPOSTA_MIN).toBe(30)
    expect(prazoDoLead(SUB)).toBe(ALVO)
    // sexta 13/11 às 19:00 em São Paulo → segunda 16/11 às 08:30
    expect(prazoDoLead({ ...SUB, recebidoEm: '2026-11-13T22:00:00.000Z' })).toBe('2026-11-16T11:30:00.000Z')
  })

  it('a conversa nasce com 24 h corridas e SAI com 30 min úteis, confirmados pelo banco', async () => {
    const e = espiao()
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(e.prazos).toEqual([{ threadId: 'THR-1', venceEm: ALVO }])
    expect(r.prazo).toEqual({ venceEm: ALVO, ajustado: true, motivo: 'definido' })
    // depois da conversa e antes do contato e do roteador (que preserva o prazo que encontra)
    expect(e.ordem).toEqual(['evidencia', 'conversa', 'prazo', 'contato', 'rotear'])
  })

  const falhas: [string, Parameters<typeof espiao>[0]][] = [
    ['o banco recusa a gravação do prazo', { falharPrazo: 'erro' }],
    ['a gravação volta sem confirmação', { falharPrazo: 'sem_confirmacao' }],
    ['o banco devolve outro vencimento', { falharPrazo: 'valor_diferente' }],
    ['o prazo atual não pôde ser lido', { falharLeituraDoPrazo: true }],
  ]
  it.each(falhas)('SEM FALSO SUCESSO: %s → erro na etapa «prazo», nunca resultado', async (_nome, opcoes) => {
    const e = espiao(opcoes)
    const erro = await gravarSubmissao(SUB, FONTE, ORG, e.portas).catch((x: unknown) => x)
    expect(erro).toBeInstanceOf(ErroDeGravacao)
    expect((erro as ErroDeGravacao).etapa).toBe('prazo')
    // parou antes do contato e do roteador: quem chamou recebe 5xx e reenvia
    expect(e.ordem).not.toContain('rotear')
  })

  it('RECUPERAÇÃO: o reenvio depois da falha conserta o prazo sem regravar evidência nem conversa', async () => {
    // estado parcial deixado pela tentativa anterior: evidência e conversa existem, prazo ainda de 24 h
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: true })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('IDEMPOTENTE')
    expect(e.evidencias).toEqual([])
    expect(e.ingestoes).toEqual([])
    expect(e.prazos).toEqual([{ threadId: 'THR-1', venceEm: ALVO }])
    expect(r.prazo.ajustado).toBe(true)
  })

  it('reenvio com o prazo já certo: nada é escrito', async () => {
    const e = espiao({ registros: [evidenciaExistente(SUB)], conversaExiste: true, prazo: { venceEm: ALVO } })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(r.resultado).toBe('IDEMPOTENTE')
    expect(e.prazos).toEqual([])
    expect(r.prazo).toEqual({ venceEm: ALVO, ajustado: false, motivo: 'prazo_correto' })
  })

  it('segunda solicitação da mesma pessoa, com a primeira ainda sem resposta: vale o prazo mais curto (o da primeira)', async () => {
    // a conversa foi aberta por um pedido das 09:40 (12:40 UTC), ainda sem resposta: vence 10:10
    const anterior = '2026-11-09T13:10:00.000Z'
    const e = espiao({ prazo: { venceEm: anterior, abertaEm: '2026-11-09T12:40:00.000Z' } })
    const r = await gravarSubmissao(SUB, FONTE, ORG, e.portas)
    expect(e.prazos).toEqual([])
    expect(r.prazo).toEqual({ venceEm: anterior, ajustado: false, motivo: 'prazo_anterior_mais_curto' })
  })

  it('conversa já respondida ou encerrada: o prazo não é reaberto pelo formulário', () => {
    expect(decidirPrazo({ threadId: 'T', aberta: true, venceEm: '2026-11-10T14:00:00.000Z', respondidaEm: '2026-11-09T14:05:00.000Z' }, ALVO))
      .toEqual({ acao: 'manter', motivo: 'ja_respondida' })
    expect(decidirPrazo({ threadId: 'T', aberta: false, venceEm: '2026-11-10T14:00:00.000Z' }, ALVO)).toEqual({ acao: 'manter', motivo: 'encerrada' })
    expect(decidirPrazo({ threadId: 'T', aberta: true }, ALVO)).toEqual({ acao: 'definir', venceEm: ALVO })
  })

  it('prazo de fábrica MENOR que o alvo também é corrigido: sexta à noite não vence no sábado', () => {
    // lead de sexta 13/11 às 19:00 em São Paulo; a RPC grava +24 h corridas = sábado 19:00
    const abertaEm = '2026-11-13T22:00:00.000Z'
    const alvo = '2026-11-16T11:30:00.000Z' // segunda 08:30
    expect(decidirPrazo({ threadId: 'T', aberta: true, abertaEm, venceEm: '2026-11-14T22:00:00.000Z' }, alvo)).toEqual({ acao: 'definir', venceEm: alvo })
    expect(decidirPrazo({ threadId: 'T', aberta: true, abertaEm, venceEm: alvo }, alvo)).toEqual({ acao: 'manter', motivo: 'prazo_correto' })
  })

  it('instante ilegível falha ANTES de gravar qualquer coisa', async () => {
    const e = espiao()
    const erro = await gravarSubmissao({ ...SUB, recebidoEm: 'ontem' }, FONTE, ORG, e.portas).catch((x: unknown) => x)
    expect(erro).toBeInstanceOf(Error)
    expect(e.evidencias).toEqual([])
    expect(e.ingestoes).toEqual([])
  })
})

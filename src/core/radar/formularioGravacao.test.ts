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
import { ErroDeGravacao, gravarSubmissao, linhaDeEvidencia, resumoParaOInbox, type PortasGravacao } from './formularioGravacao'
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
    leitura: '[atencao] Vão de 20 m pede treliça (pré-engenharia)',
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
} = {}): Espiao {
  const e: Espiao = { ordem: [], evidencias: [], ingestoes: [], completados: [], roteadas: [], portas: {} as PortasGravacao }
  e.portas = {
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
    expect(linhas).toContain('Leitura da página:')
    /* a linha de origem não se repete: ela já é o cabeçalho de observacoesDoLead */
    expect(linhas).not.toContain('Origem: formulário')
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

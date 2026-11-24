// E11.1B — homologação: uma jornada completa com dados FICTÍCIOS (cliente «Grãos do Vale», do exemplo do Inbox) e as
// verificações de integridade pedidas pela Direção. Cada passo muda só o que o módulo-autoridade mudaria; a Central lê.
import { describe, expect, it } from 'vitest'
import { seedInbox } from '../inbox/seed'
import type { InboxDataset, InboxThread } from '../inbox/tipos'
import { construirCommercialQueue } from '../radar/commercialMachine'
import { radarVazio, type Empresa, type Oportunidade, type RadarDataset } from '../radar/types'
import type { Orcamento } from '../types'
import {
  CICLOS_DE_VIDA, SUBMISSOES_DE_ENSAIO, chaveContato, chaveEmpresa, dossie, ehEnsaio, indiceDossies, retratoCentral, type ContextoCentral, type FontesCentral,
} from './central'
import { demonstracaoCentral } from './demonstracao'

const AGORA = '2026-11-16T15:00:00.000Z'
const HOJE = '2026-11-16'
const USUARIOS = [{ id: 'u-augusto', nome: 'Augusto Macedo', ativo: true }]
const ctx: ContextoCentral = { usuario: { id: 'u-augusto', papel: 'Diretoria' }, agoraIso: AGORA, hoje: HOJE, veInbox: true }
const fontes = (inbox: InboxDataset, radar: RadarDataset = radarVazio(), orcamentos: Orcamento[] = []): FontesCentral => ({ inbox, radar, orcamentos, catalogo: { insumos: [], composicoes: [] }, usuarios: USUARIOS })
const comThread = (inbox: InboxDataset, id: string, f: (t: InboxThread) => InboxThread): InboxDataset => ({ ...inbox, threads: inbox.threads.map((t) => (t.id === id ? f(t) : t)) })

const EMPRESA: Empresa = {
  id: 'ficticia-graos', razaoSocial: 'Grãos do Vale Armazéns Ltda (fictícia)', nomeFantasia: 'Grãos do Vale Armazéns', cidade: 'Rio Verde', uf: 'GO', pais: 'BR', observacoes: '', ativo: true,
  criadoEm: '2026-11-16T14:00:00Z', atualizadoEm: '2026-11-16T14:00:00Z', fitScore: 60, intentScore: 60, timingScore: 60, relationshipScore: 30, dataQualityScore: 70, priorityScore: 60, priorityClass: 'A',
}
const op = (estagio: Oportunidade['estagio'], extra: Partial<Oportunidade> = {}): Oportunidade => ({
  id: 'ficticia-op', empresaId: EMPRESA.id, titulo: 'Galpão de armazenagem 25 × 80 m', estagio, valorEstimado: 1_400_000, probabilidade: 0.3, responsavelId: 'u-augusto',
  proximaAcao: 'Retornar com a visita técnica', proximaAcaoEm: '2026-11-20', observacoes: '', criadoEm: '2026-11-16T14:00:00Z', atualizadoEm: '2026-11-16T14:00:00Z', ...extra,
})
const faseDe = (f: FontesCentral, chave: string) => retratoCentral(f, ctx).jornada.dossies.find((d) => d.chave === chave)?.fase

describe('Jornada completa — cliente fictício «Grãos do Vale»', () => {
  const base = seedInbox(AGORA)

  it('1 · solicitação recebida pelo simulador: Lead recebido, dossiê do CONTATO, configuração como declaração', () => {
    const f = fontes(base)
    expect(faseDe(f, chaveContato('CTI-00010'))).toBe('lead')
    const d = dossie(chaveContato('CTI-00010'), f, ctx, retratoCentral(f, ctx))!
    expect(d.solicitacoesDoSite).toHaveLength(1)
    expect(d.configuracao?.medidas).toContain('vão 25 m')
    expect(d.orcamentos).toBe('sem_vinculo')
  })

  it('2 · primeiro atendimento (contato realizado registrado no Inbox): Atendimento', () => {
    const inbox = comThread(base, 'THR-00011', (t) => ({ ...t, status: 'EM_ATENDIMENTO', sla: { ...t.sla!, primeiraRespostaEm: '2026-11-16T14:20:00Z' } }))
    expect(faseDe(fontes(inbox), chaveContato('CTI-00010'))).toBe('atendimento')
  })

  it('3 · qualificação: contato associado à empresa do Radar e oportunidade QUALIFIED — UM dossiê, o da empresa', () => {
    const inbox = { ...base, contatos: base.contatos.map((c) => (c.id === 'CTI-00010' ? { ...c, empresaRadarId: EMPRESA.id } : c)) }
    const radar = { ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('QUALIFIED')] }
    const f = fontes(inbox, radar)
    const r = retratoCentral(f, ctx)
    expect(faseDe(f, chaveEmpresa(EMPRESA.id))).toBe('qualificacao')
    expect(dossie(chaveContato('CTI-00010'), f, ctx, r)).toBeUndefined() // o contato não tem mais dossiê próprio
    expect(indiceDossies(f, r).filter((i) => i.titulo.includes('Grãos'))).toHaveLength(1)
    const d = dossie(chaveEmpresa(EMPRESA.id), f, ctx, r)!
    expect(d.atendimentos.map((l) => l.threadId)).toEqual(['THR-00011']) // a conversa veio junto
  })

  it('4 · atividade e retorno: tarefa do Radar vira retorno e próxima atividade do dossiê; a fila CM1-A diz o que fazer', () => {
    // antes do 1º contato registrado, o retorno mais urgente do dossiê é o 1º contato do lead (prazo de 30 min úteis)
    const respondido = comThread(base, 'THR-00011', (t) => ({ ...t, status: 'EM_ATENDIMENTO', sla: { ...t.sla!, primeiraRespostaEm: '2026-11-16T14:20:00Z' } }))
    const inbox = { ...respondido, contatos: respondido.contatos.map((c) => (c.id === 'CTI-00010' ? { ...c, empresaRadarId: EMPRESA.id } : c)) }
    const radar: RadarDataset = {
      ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('NEED_CONFIRMED', { proximaAcao: undefined, proximaAcaoEm: undefined })],
      atividades: [{ id: 'ficticia-a1', empresaId: EMPRESA.id, oportunidadeId: 'ficticia-op', usuarioId: 'u-augusto', tipo: 'CALL', canal: 'PHONE', ocorreuEm: '2026-11-16T14:30:00Z', notas: 'Confirmou a necessidade.', criadoEm: '2026-11-16T14:30:00Z' }],
      tarefas: [{ id: 'ficticia-t1', empresaId: EMPRESA.id, oportunidadeId: 'ficticia-op', responsavelId: 'u-augusto', tipo: 'VISIT', prioridade: 'Normal', venceEm: '2026-11-18', status: 'Aberta', descricao: 'Visita técnica ao terreno', criadoEm: '2026-11-16T14:30:00Z' }],
    }
    const f = fontes(inbox, radar)
    const r = retratoCentral(f, ctx)
    expect(r.retornos.some((x) => x.id === 'tarefa:ficticia-t1' && x.situacao === 'proximo')).toBe(true)
    const d = dossie(chaveEmpresa(EMPRESA.id), f, ctx, r)!
    expect(d.proximaAtividade?.descricao).toBe('Visita técnica ao terreno')
    expect(d.historico.some((h) => h.tipo === 'atividade')).toBe(true)
    const item = construirCommercialQueue(radar, HOJE, { usuariosValidos: ['u-augusto'] }).itens.find((i) => i.empresaId === EMPRESA.id)
    expect(d.filaCM?.posicao).toBe(item?.posicao)
  })

  it('5 · orçamento técnico: aparece na lista, mas o vínculo com o cliente é PENDENTE (não se casa por nome)', () => {
    const orc: Orcamento = { id: 'ficticio-orc', codigo: 'ORC-F01', titulo: 'Galpão 25 × 80 m', cliente: 'Grãos do Vale Armazéns', status: 'Rascunho', data: HOJE, bdi: 0.25, referenciaPrecos: 'fictício', itens: [], observacoes: '', criadoEm: AGORA, criadoPor: 'u-augusto', atualizadoEm: AGORA }
    const radar = { ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('PRICING')] }
    const inbox = { ...base, contatos: base.contatos.map((c) => (c.id === 'CTI-00010' ? { ...c, empresaRadarId: EMPRESA.id } : c)) }
    const f = fontes(inbox, radar, [orc])
    const r = retratoCentral(f, ctx)
    expect(r.orcamentos.map((o) => o.codigo)).toEqual(['ORC-F01'])
    expect(faseDe(f, chaveEmpresa(EMPRESA.id))).toBe('estudo')
    expect(dossie(chaveEmpresa(EMPRESA.id), f, ctx, r)!.orcamentos).toBe('sem_vinculo')
  })

  it('6 · proposta (NÃO implementada como entidade): só o sinal do Radar; o ciclo diz o que falta', () => {
    const radar = { ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('PROPOSAL_SENT')] }
    const f = fontes(base, radar)
    const r = retratoCentral(f, ctx)
    expect(r.propostas.map((p) => p.oportunidadeId)).toEqual(['ficticia-op'])
    expect(r.propostas[0].propostasRegistradas).toBe(0)
    expect(CICLOS_DE_VIDA.find((c) => c.id === 'proposta_comercial')!.estados.filter((e) => e.situacao === 'a_desenvolver').map((e) => e.nome)).toEqual(['Emitida (R0, R1…)', 'Aceita / recusada / expirada'])
  })

  it('7 · pedido de projeto (NÃO implementado como entidade): sinal de atividade, documentos indisponíveis', () => {
    const radar: RadarDataset = { ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('NEGOTIATION')], atividades: [{ id: 'ficticia-a2', empresaId: EMPRESA.id, oportunidadeId: 'ficticia-op', usuarioId: 'u-augusto', tipo: 'MEETING', canal: 'VISIT', ocorreuEm: '2026-11-16T15:00:00Z', resultado: 'REQUESTED_TECHNICAL_ANALYSIS', notas: 'Pediu análise da laje do mezanino.', criadoEm: AGORA }] }
    const r = retratoCentral(fontes(base, radar), ctx)
    const s = r.solicitacoes.find((x) => x.id === 'atividade:ficticia-a2')!
    expect(s.tipo).toBe('Pediu análise técnica')
    expect(s.documentos).toBe('indisponivel')
    expect(r.visao.analisesEngenharia.valor).toBe(1)
  })

  it('8 · negociação e contratação: valor fechado só o confirmado', () => {
    const radar = { ...radarVazio(), empresas: [EMPRESA], oportunidades: [op('WON', { valorFechado: 1_320_000, fechadoEm: '2026-11-16T15:00:00Z', proximaAcao: undefined, proximaAcaoEm: undefined })] }
    const f = fontes(base, radar)
    expect(faseDe(f, chaveEmpresa(EMPRESA.id))).toBe('contratacao')
    expect(retratoCentral(f, ctx).visao.valorGanho.valor).toBe(1_320_000)
  })
})

describe('Integridade e rastreabilidade (E11.1B)', () => {
  it('o mesmo contato com duas conversas (site + WhatsApp) tem UM dossiê com as duas', () => {
    const base = seedInbox(AGORA)
    const zap: InboxThread = { ...base.threads.find((t) => t.id === 'THR-00011')!, id: 'THR-ZAP', canal: 'WHATSAPP', labels: [] }
    const inbox = { ...base, threads: [...base.threads, zap] }
    const f = fontes(inbox)
    const r = retratoCentral(f, ctx)
    const daMarina = r.atendimentos!.filter((l) => l.dossie === chaveContato('CTI-00010')).map((l) => l.threadId).sort()
    expect(daMarina).toEqual(['THR-00011', 'THR-ZAP'])
    const chaves = indiceDossies(f, r).map((i) => i.chave)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(r.jornada.dossies.filter((d) => d.chave === chaveContato('CTI-00010'))).toHaveLength(1)
  })

  it('duas solicitações do mesmo cliente aparecem separadas no dossiê (demonstração: Barros Logística)', () => {
    const d0 = demonstracaoCentral(HOJE, seedInbox(AGORA))
    const f: FontesCentral = { inbox: d0.inbox, radar: d0.radar, orcamentos: d0.orcamentos, catalogo: { insumos: [], composicoes: [] }, usuarios: USUARIOS }
    const d = dossie(chaveEmpresa('demo-barros'), f, ctx, retratoCentral(f, ctx))!
    expect(d.solicitacoesDoSite).toHaveLength(2)
    expect(new Set(d.solicitacoesDoSite.map((s) => s.externoId)).size).toBe(2)
    expect(d.solicitacoesDoSite.map((s) => s.formulario).sort()).toEqual(['iniciar-projeto', 'simular-galpao'])
  })

  it('ensaio reconhecido pelo id da SUBMISSÃO (mesma lista da reconciliação); uma submissão real na conversa a torna real', () => {
    const base = seedInbox(AGORA)
    const t = base.threads.find((x) => x.id === 'THR-00011')!
    const msgs = base.mensagens.map((m) => (m.threadId === 'THR-00011' && m.direcao === 'inbound' ? { ...m, externalMessageId: SUBMISSOES_DE_ENSAIO[0] } : m))
    expect(ehEnsaio(t, msgs)).toBe(true)
    expect(ehEnsaio(t, base.mensagens)).toBe(false)
    const real = { ...msgs.find((m) => m.threadId === 'THR-00011' && m.direcao === 'inbound')!, id: 'outra', externalMessageId: 'submissao-real' }
    expect(ehEnsaio(t, [...msgs, real])).toBe(false)
    const r = retratoCentral(fontes({ ...base, mensagens: msgs }), ctx)
    expect(r.jornada.dossies.some((d) => d.chave === chaveContato('CTI-00010'))).toBe(false)
  })

  it('demonstração nunca se mistura com dado real: todo registro de Radar e orçamento é identificado como demo', () => {
    const d = demonstracaoCentral(HOJE)
    const ids = [...d.radar.empresas, ...d.radar.oportunidades, ...d.radar.atividades, ...d.radar.tarefas, ...d.radar.contatos, ...d.radar.projetos, ...d.radar.historicoEstagios, ...d.orcamentos].map((x) => x.id)
    expect(ids.every((id) => id.startsWith('demo-'))).toBe(true)
    expect(d.radar.empresas.every((e) => e.dominio?.endsWith('.exemplo'))).toBe(true)
    expect(d.inbox).toBeUndefined() // sem o exemplo do Inbox, não toca no Inbox recebido
  })
})

describe('Vínculo lead → empresa pela promoção do Lead Engine (E11.1B)', () => {
  it('candidato RESOLVED com entidadeId junta a conversa ao dossiê da empresa; PENDING ou REJECTED não', () => {
    const base = seedInbox(AGORA)
    const registroId = String(base.mensagens.find((m) => m.threadId === 'THR-00011' && m.direcao === 'inbound')!.meta!['registroFonteId'])
    const rf = (statusIntake: 'PENDING' | 'RESOLVED' | 'REJECTED') => ({ id: registroId, fonteId: 'f-site', tipo: 'empresa' as const, payload: {}, recebidoEm: AGORA, statusIntake, entidadeId: statusIntake === 'PENDING' ? undefined : EMPRESA.id })
    const chave = (st: 'PENDING' | 'RESOLVED' | 'REJECTED') => retratoCentral(fontes(base, { ...radarVazio(), empresas: [EMPRESA], registrosFonte: [rf(st)] }), ctx).atendimentos!.find((l) => l.threadId === 'THR-00011')!.dossie
    expect(chave('RESOLVED')).toBe(chaveEmpresa(EMPRESA.id))
    expect(chave('PENDING')).toBe(chaveContato('CTI-00010'))
    expect(chave('REJECTED')).toBe(chaveContato('CTI-00010'))
  })
})

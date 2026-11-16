import { describe, expect, it } from 'vitest'
import { seedInbox } from '../inbox/seed'
import { radarVazio } from '../radar/types'
import {
  CICLOS_DE_VIDA, CONVERSAS_DE_ENSAIO, FASE_DO_ESTAGIO, FASES_JORNADA, OPERACOES_CENTRAL, faseDoDossie, chaveContato, chaveEmpresa, contarAtendimentos, dossie, ETIQUETA_ENSAIO, filtrarAtendimentos, indiceDossies, lerChaveDossie, pipeline, retratoCentral,
  situacaoDoPrazo, type ContextoCentral, type FontesCentral,
} from './central'
import { demonstracaoCentral } from './demonstracao'

const AGORA = '2026-11-16T15:00:00.000Z'
const HOJE = '2026-11-16'
const USUARIOS = [{ id: 'u-augusto', nome: 'Augusto Macedo', ativo: true }, { id: 'u-fin', nome: 'Financeiro EIFF', ativo: true }]
const ctx = (p: Partial<ContextoCentral> = {}): ContextoCentral => ({ usuario: { id: 'u-augusto', papel: 'Diretoria' }, agoraIso: AGORA, hoje: HOJE, veInbox: true, ...p })
const fontesDemo = (): FontesCentral => {
  const d = demonstracaoCentral(HOJE, seedInbox(AGORA))
  return { inbox: d.inbox, radar: d.radar, orcamentos: d.orcamentos, catalogo: { insumos: [], composicoes: [] }, usuarios: USUARIOS }
}

describe('Central de Gestão Comercial — retrato', () => {
  it('lê sem alterar as fontes (projeção pura)', () => {
    const f = fontesDemo()
    const antes = JSON.stringify(f)
    retratoCentral(f, ctx())
    expect(JSON.stringify(f)).toBe(antes)
  })

  it('leads e atendimentos vêm do Inbox: leads do site primeiro, depois as conversas externas do Comercial', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const at = r.atendimentos!
    expect(at.filter((l) => l.origem === 'site').map((l) => l.threadId).sort()).toEqual(['THR-00011', 'THR-00012', 'THR-00013', 'THR-00014'])
    const primeiraConversa = at.findIndex((l) => l.origem === 'conversa')
    expect(primeiraConversa === -1 || at.slice(primeiraConversa).every((l) => l.origem === 'conversa')).toBe(true)
    const marina = at.find((l) => l.threadId === 'THR-00011')!
    expect(marina.configuracao).toBe('Galpão de armazenagem 25 x 80 m, pé-direito 10 m, 2.000 m²') // o resumo do simulador vira a linha «Configuração:»
    expect(marina.medidas).toContain('vão 25 m')
    expect(marina.responsavelNome).toBe('Augusto Macedo')
  })

  it('sem o Inbox (ou sem a permissão) os indicadores de lead são indisponíveis, nunca zero', () => {
    const f = { ...fontesDemo(), inbox: undefined }
    const r = retratoCentral(f, ctx())
    expect(r.atendimentos).toBeUndefined()
    expect(r.visao.leadsRecebidos.valor).toBeNull()
    expect(r.visao.leadsRecebidos.motivo).toMatch(/Inbox/)
    const semPermissao = retratoCentral(fontesDemo(), ctx({ veInbox: false }))
    expect(semPermissao.visao.aguardandoPrimeiraResposta.valor).toBeNull()
    // o Radar continua disponível
    expect(semPermissao.visao.propostasEmAndamento.valor).toBe(3)
  })

  it('conversa marcada como ensaio sai dos indicadores e só aparece no filtro de ensaios', () => {
    const f = fontesDemo()
    const inbox = f.inbox!
    const comEnsaio = { ...f, inbox: { ...inbox, threads: inbox.threads.map((t) => (t.id === 'THR-00011' ? { ...t, labels: [...t.labels, ETIQUETA_ENSAIO] } : t)) } }
    const base = retratoCentral(f, ctx())
    const r = retratoCentral(comEnsaio, ctx())
    expect(r.visao.aguardandoPrimeiraResposta.valor).toBe((base.visao.aguardandoPrimeiraResposta.valor as number) - 1)
    expect(filtrarAtendimentos(r.atendimentos!, 'ensaios', 'u-augusto').map((l) => l.threadId)).toEqual(['THR-00011'])
    expect(filtrarAtendimentos(r.atendimentos!, 'todos', 'u-augusto').some((l) => l.threadId === 'THR-00011')).toBe(true)
    expect(filtrarAtendimentos(r.atendimentos!, 'abertos', 'u-augusto').some((l) => l.threadId === 'THR-00011')).toBe(false)
    expect(r.retornos.some((x) => x.id === 'conversa:THR-00011')).toBe(false)
    expect(contarAtendimentos(r.atendimentos!, 'u-augusto').ensaios).toBe(1)
  })

  it('busca sem acento e por configuração', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    expect(filtrarAtendimentos(r.atendimentos!, 'todos', 'u-augusto', 'logistica').map((l) => l.threadId)).toContain('THR-00013')
    expect(filtrarAtendimentos(r.atendimentos!, 'todos', 'u-augusto', 'ponte rolante').map((l) => l.threadId)).toContain('THR-00012')
  })
})

describe('Retornos e acompanhamentos', () => {
  it('cada prazo aparece uma vez, no registro que o guarda, do mais antigo ao mais novo', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const ids = r.retornos.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('tarefa:demo-t1')
    expect(ids).toContain('oportunidade:demo-o2')
    expect(ids).not.toContain('tarefa:demo-t3') // concluída
    const datas = r.retornos.map((x) => x.venceEm)
    expect([...datas].sort()).toEqual(datas)
    expect(r.retornos.find((x) => x.id === 'oportunidade:demo-o2')!.situacao).toBe('vencido')
    expect(r.retornos.find((x) => x.id === 'tarefa:demo-t1')!.diasAtraso).toBe(1)
  })

  it('situação do prazo', () => {
    expect(situacaoDoPrazo('2026-11-15', HOJE)).toBe('vencido')
    expect(situacaoDoPrazo('2026-11-16', HOJE)).toBe('hoje')
    expect(situacaoDoPrazo('2026-11-23', HOJE)).toBe('proximo')
    expect(situacaoDoPrazo('2026-11-24', HOJE)).toBe('futuro')
  })

  it('oportunidade sem próxima ação segue a regra do Radar (sem data e sem tarefa aberta)', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    expect(r.semProximaAcao.map((o) => o.oportunidadeId)).toEqual([])
    const f = fontesDemo()
    f.radar = { ...f.radar, oportunidades: f.radar.oportunidades.map((o) => (o.id === 'demo-o1' ? { ...o, proximaAcaoEm: undefined, proximaAcao: undefined } : o)) }
    expect(retratoCentral(f, ctx()).semProximaAcao.map((o) => o.oportunidadeId)).toEqual(['demo-o1'])
  })

  it('oportunidade parada vem da fila CM1-A, sem limiar próprio', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const metalforte = r.paradas.find((p) => p.oportunidadeId === 'demo-o2')
    expect(metalforte).toBeDefined()
    expect(metalforte!.critica).toBe(true) // 16 dias em PROPOSAL_SENT, SLA 5 × 2
    expect(r.versaoFila).toMatch(/^CM1-A/)
  })
})

describe('Orçamentos e propostas', () => {
  it('orçamento técnico usa o cálculo do módulo de Orçamentos e marca validade vencida só quando ainda está em aberto', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const d01 = r.orcamentos.find((o) => o.codigo === 'ORC-D01')!
    expect(d01.custoTotal).toBeCloseTo(96_000 * 13.2 + 3_400 * 118, 2)
    expect(d01.precoTotal).toBeCloseTo(d01.custoTotal * 1.25, 2)
    expect(d01.validadeVencida).toBe(false)
    expect(r.orcamentos.find((o) => o.codigo === 'ORC-D02')!.validadeVencida).toBe(true)
    expect(r.visao.orcamentosAguardando.valor).toBe(2)
  })

  it('proposta é SINAL do Radar: estágio de proposta, revisões = atividades PROPOSAL', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    expect(r.propostas.map((p) => p.oportunidadeId)).toEqual(['demo-o1', 'demo-o2', 'demo-o3'])
    const cerrado = r.propostas[0]
    expect(cerrado.propostasRegistradas).toBe(2)
    expect(cerrado.diasNoEstagio).toBe(3)
  })

  it('desfechos: valor fechado só na ganha, nunca o estimado; motivo preservado', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const ganha = r.desfechos.find((d) => d.resultado === 'WON')!
    const perdida = r.desfechos.find((d) => d.resultado === 'LOST')!
    expect(ganha.valorFechado).toBe(198_500)
    expect(perdida.valorFechado).toBeUndefined()
    expect(perdida.motivo).toMatch(/concorrente/)
    expect(r.visao.ganhos.valor).toBe(1)
    expect(r.visao.perdidos.valor).toBe(1)
    expect(r.visao.valorGanho.valor).toBe(198_500)
  })
})

describe('Solicitações de projeto', () => {
  it('junta os três sinais sem duplicar: a atividade de oportunidade já em projeto vira evidência dela', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const ids = r.solicitacoes.map((s) => s.id)
    expect(ids).toContain('oportunidade:demo-o4')
    expect(ids).not.toContain('atividade:demo-a5')
    expect(ids).toContain('atividade:demo-a4')
    expect(ids.filter((i) => i.startsWith('conversa:')).length).toBeGreaterThan(0)
    expect(r.solicitacoes.every((s) => s.documentos === 'indisponivel')).toBe(true)
    const norte = r.solicitacoes.find((s) => s.id === 'oportunidade:demo-o4')!
    expect(norte.dadosTecnicos).toContain('1.800 m²')
  })
})

describe('Pipeline', () => {
  it('soma só o que tem valor estimado, pondera pela probabilidade registrada e conta o que fica de fora', () => {
    const f = fontesDemo()
    const p = pipeline(f, { hoje: HOJE })
    expect(p.ativas).toBe(5)
    expect(p.semValor).toBe(1) // demo-o4 sem valor
    expect(p.valorTotal).toBe(1_850_000 + 980_000 + 2_400_000 + 3_100_000)
    expect(p.ponderadoTotal).toBeCloseTo(1_850_000 * 0.6 + 980_000 * 0.4 + 2_400_000 * 0.3 + 3_100_000 * 0.2, 2)
    expect(p.previsao.map((m) => m.mes)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(p.previsao[0].valor + p.previsao[1].valor + p.previsao[2].valor).toBe(1_850_000 + 980_000 + 3_100_000)
    expect(p.foraDaPrevisao).toBe(2) // sem valor ou sem previsão
  })

  it('pipeline sem nenhum valor estimado é indisponível, não zero', () => {
    const f = fontesDemo()
    f.radar = { ...f.radar, oportunidades: f.radar.oportunidades.map((o) => ({ ...o, valorEstimado: undefined })) }
    expect(retratoCentral(f, ctx()).visao.valorPipeline.valor).toBeNull()
    const vazio = { ...fontesDemo(), radar: radarVazio() }
    expect(retratoCentral(vazio, ctx()).visao.valorPipeline.valor).toBe(0)
  })
})

describe('Dossiê comercial único', () => {
  it('lead cujo contato já tem empresa no Radar cai no dossiê DA EMPRESA, nunca em dois', () => {
    const f = fontesDemo()
    const r = retratoCentral(f, ctx())
    const helena = r.atendimentos!.find((l) => l.threadId === 'THR-00013')!
    expect(helena.dossie).toBe(chaveEmpresa('demo-barros'))
    expect(dossie(chaveContato('CTI-00012'), f, ctx(), r)).toBeUndefined()
    const d = dossie(chaveEmpresa('demo-barros'), f, ctx(), r)!
    expect(d.titulo).toBe('Barros Logística')
    expect(d.atendimentos.map((l) => l.threadId)).toEqual(['THR-00013'])
    expect(d.oportunidades.map((o) => o.id)).toEqual(['demo-o5'])
    expect(d.configuracao?.medidas).toContain('vão 20 m') // a submissão mais recente (segunda solicitação da demonstração)
    expect(d.solicitacoesDoSite.map((x) => x.solicitacao.medidas).join(' ')).toContain('vão 40 m')
    expect(d.solicitacoesDoSite).toHaveLength(2)
    expect(d.donoContaNome).toBe('Augusto Macedo')
    expect(d.orcamentos).toBe('sem_vinculo')
    expect(d.historico.some((h) => h.tipo === 'conversa')).toBe(true)
    expect(d.links.map((l) => l.to)).toContain('/radar/empresas/demo-barros')
  })

  it('conversa sem empresa tem dossiê próprio; empresa com decisões mostra o histórico de estágios', () => {
    const f = fontesDemo()
    const r = retratoCentral(f, ctx())
    const marina = dossie(chaveContato('CTI-00010'), f, ctx(), r)!
    expect(marina.empresa).toBeUndefined()
    expect(marina.subtitulo).toMatch(/não associado/)
    const solar = dossie(chaveEmpresa('demo-solar'), f, ctx(), r)!
    expect(solar.decisoes.map((x) => x.id)).toEqual(['h:demo-h5'])
  })

  it('chaves inválidas ou invisíveis não abrem dossiê', () => {
    const f = fontesDemo()
    const r = retratoCentral(f, ctx())
    expect(dossie('qualquer', f, ctx(), r)).toBeUndefined()
    expect(dossie(chaveEmpresa('nao-existe'), f, ctx(), r)).toBeUndefined()
    expect(dossie(chaveContato('CTI-00010'), f, ctx({ veInbox: false }), retratoCentral(f, ctx({ veInbox: false })))).toBeUndefined()
    expect(lerChaveDossie('empresa:x')).toEqual({ tipo: 'empresa', id: 'x' })
  })

  it('índice de dossiês tem uma entrada por chave canônica', () => {
    const f = fontesDemo()
    const idx = indiceDossies(f, retratoCentral(f, ctx()))
    const chaves = idx.map((i) => i.chave)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaves).toContain(chaveEmpresa('demo-barros'))
    expect(chaves).not.toContain(chaveContato('CTI-00012'))
  })
})

describe('Jornada comercial (E11.1)', () => {
  it('todo estágio do Radar tem fase e a ordem da jornada é a pedida pela Direção', () => {
    expect(FASES_JORNADA).toEqual(['lead', 'atendimento', 'qualificacao', 'estudo', 'proposta', 'negociacao', 'contratacao'])
    expect(FASE_DO_ESTAGIO.PROPOSAL_SENT).toBe('proposta')
    expect(FASE_DO_ESTAGIO.WON).toBe('contratacao')
    expect(FASE_DO_ESTAGIO.LOST).toBe('perdido')
  })

  it('situação do dossiê: oportunidade ativa mais avançada; conversa aberta antes de desfecho antigo', () => {
    const op = (estagio: Parameters<typeof faseDoDossie>[0][number]['estagio']) => ({ estagio, atualizadoEm: '2026-11-01T00:00:00Z' })
    expect(faseDoDossie([op('ENGAGED'), op('PRICING')], [])).toBe('estudo')
    expect(faseDoDossie([op('WON')], [{ aberta: true, situacao: 'aguardando', ensaio: false }])).toBe('lead')
    expect(faseDoDossie([op('WON')], [{ aberta: false, situacao: 'respondida_no_prazo', ensaio: false }])).toBe('contratacao')
    expect(faseDoDossie([], [{ aberta: true, situacao: 'aguardando', ensaio: true }])).toBeUndefined()
  })

  it('um cliente conta uma vez na jornada (lead associado à empresa não duplica)', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    const chaves = r.jornada.dossies.map((d) => d.chave)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(r.jornada.dossies.find((d) => d.chave === chaveEmpresa('demo-barros'))?.fase).toBe('qualificacao')
    expect(r.jornada.dossies.find((d) => d.chave === chaveEmpresa('demo-cerrado'))?.fase).toBe('negociacao')
    expect(r.jornada.porFase.contratacao).toBe(1)
  })

  it('negociações avançando × paradas e propostas aguardando resposta com valor', () => {
    const r = retratoCentral(fontesDemo(), ctx())
    expect(r.visao.propostasAguardandoResposta.valor).toBe(1)
    expect(r.visao.valorPropostasAguardando.valor).toBe(980_000)
    expect(r.visao.negociacoesParadas.valor).toBe(1) // Metalforte, parada pela fila CM1-A
    expect(r.visao.negociacoesAvancando.valor).toBe(1) // Cerrado
    expect(r.visao.analisesEngenharia.valor).toBe(1) // atividade «pediu análise técnica» da Agrovia
  })
})

describe('Ensaios do formulário (docs/formulario-site-go2-go3.md §1.3.1)', () => {
  it('as conversas de ensaio conhecidas saem dos indicadores pelo id, sem etiqueta', () => {
    const f = fontesDemo()
    const inbox = f.inbox!
    const id = CONVERSAS_DE_ENSAIO[1]
    const comEnsaio = { ...f, inbox: { ...inbox, threads: inbox.threads.map((t) => (t.id === 'THR-00012' ? { ...t, id } : t)), mensagens: inbox.mensagens.map((m) => (m.threadId === 'THR-00012' ? { ...m, threadId: id } : m)) } }
    const r = retratoCentral(comEnsaio, ctx())
    const linha = r.atendimentos!.find((l) => l.threadId === id)!
    expect(linha.ensaio).toBe(true)
    expect(filtrarAtendimentos(r.atendimentos!, 'abertos', 'u-augusto').some((l) => l.threadId === id)).toBe(false)
    expect(r.jornada.dossies.some((d) => d.chave === chaveContato('CTI-00011'))).toBe(false)
  })
})

describe('Ciclos de vida e operações', () => {
  it('orçamento técnico, proposta e solicitação de projeto são três ciclos distintos; só o orçamento está implementado', () => {
    expect(CICLOS_DE_VIDA.map((c) => c.id)).toEqual(['orcamento_tecnico', 'proposta_comercial', 'solicitacao_projeto'])
    expect(CICLOS_DE_VIDA[0].estados.every((e) => e.situacao === 'implementado')).toBe(true)
    expect(CICLOS_DE_VIDA.slice(1).every((c) => c.estados.some((e) => e.situacao === 'a_desenvolver'))).toBe(true)
  })
  it('toda operação que já opera aponta a tela da autoridade', () => {
    expect(OPERACOES_CENTRAL.filter((o) => o.situacao === 'opera').every((o) => o.rota)).toBe(true)
  })
})

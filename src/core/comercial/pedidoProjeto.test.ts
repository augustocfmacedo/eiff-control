// E11.2A — Gestão de Solicitações de Projeto: motor de estados, permissões, vínculos por id, idempotência, duplicidade,
// isolamento entre organizações e a visão técnica da Engenharia. Dados FICTÍCIOS (demonstração da Central).
import { describe, expect, it } from 'vitest'
import { seedInbox } from '../inbox/seed'
import type { Papel, Usuario } from '../types'
import { PAPEIS } from '../usuarios'
import { SUBMISSOES_DE_ENSAIO } from './central'
import { demonstracaoCentral } from './demonstracao'
import {
  ACOES_PEDIDO, CAMPOS_PROIBIDOS_PEDIDO, ErroPedido, REGRAS_ACAO, SITUACOES_FINAIS, SITUACOES_PEDIDO, acoesDisponiveis, criarPedido, divergenciaDeEstagio, errosDeVinculo,
  motivoBloqueio, resumoPedidos, situacaoPrazo, visaoTecnica, type DadosAcao, type EntradaPedido, type FontesVinculo, type PedidoProjeto,
} from './pedidoProjeto'
import { semearExemploPedidos } from './pedidosExemplo'
import { repositorioEmMemoria } from './pedidosRepositorio'

const HOJE = '2026-11-16'
const AGORA = '2026-11-16T15:00:00.000Z'
const u = (papel: Papel, id = `u-${papel}`, ativo = true): Usuario => ({ id, nome: papel, email: `${id}@exemplo`, papel, ativo, obras: '*' })
const DIR = u('Diretoria'), ADM = u('Administrador'), ENG = u('Engenharia'), ENG2 = u('Engenharia', 'u-eng-2'), FIN = u('Financeiro'), CONT = u('Contabilidade')
const ORG = 'org-a', OUTRA = 'org-b'
const demo = demonstracaoCentral(HOJE, seedInbox(AGORA))
const FONTES: FontesVinculo = { radar: demo.radar, inbox: demo.inbox, orcamentos: demo.orcamentos }
const radarAntes = JSON.stringify(demo.radar)

const entrada = (extra: Partial<EntradaPedido> = {}): EntradaPedido => ({
  empresaId: 'demo-barros', oportunidadeId: 'demo-o5', origemLead: 'REUNIAO', tipo: 'Estudo preliminar', prioridade: 'Alta', prazoSolicitado: '2026-11-22',
  responsavelComercialId: DIR.id, dados: { cidade: 'Aparecida de Goiânia', uf: 'GO', comprimentoM: 100, larguraM: 40, alturaM: 12 },
  documentos: { arquitetura: 'pendente', sondagem: 'recebido' }, ...extra,
})
const novoRepo = () => { let n = 0; return repositorioEmMemoria({ agora: () => AGORA, novoId: (p) => `${p}-${++n}` }) }
const erro = (f: () => unknown) => { try { f(); return undefined } catch (e) { return e instanceof ErroPedido ? e.codigo : `OUTRO: ${String(e)}` } }
let intencoes = 0
const novaInt = () => `int-${++intencoes}`
const agir = (repo: ReturnType<typeof novoRepo>, id: string, acao: (typeof ACOES_PEDIDO)[number], quem: Usuario, d: Omit<DadosAcao, 'versao'> = {}, org = ORG) =>
  repo.agir(id, acao, quem, { ...d, versao: repo.obter(DIR, org, id)?.versao ?? 0 }, { organizacaoId: org, intencao: novaInt(), orcamentos: FONTES.orcamentos }).pedido
const criar = (repo: ReturnType<typeof novoRepo>, e = entrada(), quem = DIR, org = ORG) => repo.criar(e, quem, { organizacaoId: org, intencao: novaInt(), fontes: FONTES }).pedido

describe('Ciclo completo: Comercial → Engenharia → Comercial', () => {
  it('solicitado → triagem → dados pendentes → triagem → desenvolvimento → entregue → encerrado, com histórico auditável', () => {
    const repo = novoRepo()
    const p = criar(repo)
    expect(p).toMatchObject({ situacao: 'SOLICITADO', codigo: 'SP-0001', versaoTipo: 1 })
    agir(repo, p.id, 'iniciar_triagem', ENG, { equipeTecnica: 'Engenharia estrutural' })
    agir(repo, p.id, 'registrar_triagem', ENG, { validar: ['cidade', 'uf', 'larguraM'], nota: 'Vão conferido no croqui.' })
    agir(repo, p.id, 'pedir_dados', ENG, { motivo: 'Falta a arquitetura para definir as docas', pendencias: ['Planta de arquitetura', 'Posição das docas'] })
    agir(repo, p.id, 'atualizar_documento', DIR, { documento: { tipo: 'arquitetura', situacao: 'recebido', referencia: 'arquitetura-r01.pdf' } })
    agir(repo, p.id, 'responder_pendencias', DIR, { resposta: 'Arquitetura recebida; docas na lateral norte.' })
    agir(repo, p.id, 'atualizar_documento', ENG, { documento: { tipo: 'arquitetura', situacao: 'validado' } })
    agir(repo, p.id, 'assumir_desenvolvimento', ENG, { prazoEntrega: '2026-11-25' })
    agir(repo, p.id, 'registrar_andamento', ENG, { nota: 'Pré-dimensionamento dos pórticos concluído.' })
    agir(repo, p.id, 'entregar', ENG, { entrega: { resumo: 'Estudo preliminar da estrutura', resultados: 'Pórticos a cada 6 m; consumo estimado de aço anexo.', referencias: ['estudo-preliminar.pdf'] } })
    const fim = agir(repo, p.id, 'encerrar', DIR, { resultado: { tipo: 'ORCAMENTO_VINCULADO', orcamentoId: 'demo-orc4' } })
    expect(fim).toMatchObject({ situacao: 'ENCERRADO', responsavelTecnicoId: ENG.id, prazoEntrega: '2026-11-25', vinculos: { orcamentoId: 'demo-orc4' }, resultado: { tipo: 'ORCAMENTO_VINCULADO' } })
    expect(fim.dados.larguraM).toMatchObject({ situacao: 'validado', validadoPor: ENG.id })
    expect(fim.dados.alturaM?.situacao).toBe('declarado')
    expect(fim.pendencias.every((x) => !x.aberta && x.resposta)).toBe(true)
    const ev = repo.eventos(DIR, ORG, p.id)
    expect(ev.map((e) => e.acao)).toEqual(['criar', 'iniciar_triagem', 'registrar_triagem', 'pedir_dados', 'atualizar_documento', 'responder_pendencias', 'atualizar_documento', 'assumir_desenvolvimento', 'registrar_andamento', 'entregar', 'encerrar'])
    expect(ev.find((e) => e.acao === 'pedir_dados')).toMatchObject({ de: 'TRIAGEM_TECNICA', para: 'DADOS_PENDENTES', por: ENG.id, papel: 'Engenharia', motivo: 'Falta a arquitetura para definir as docas' })
    expect(ev.every((e) => e.intencao && e.em === AGORA)).toBe(true)
  })

  it('o Comercial pode recusar a entrega (reabrir, com motivo) e encerrar como «não seguiu», com motivo', () => {
    const repo = novoRepo()
    const p = criar(repo, entrada({ documentos: {} }))
    agir(repo, p.id, 'iniciar_triagem', ENG)
    agir(repo, p.id, 'assumir_desenvolvimento', ENG, { prazoEntrega: '2026-11-25' })
    agir(repo, p.id, 'entregar', ENG, { entrega: { resumo: 'Primeira entrega técnica', resultados: 'Vão de 40 m' } })
    expect(erro(() => agir(repo, p.id, 'reabrir', DIR))).toBe('MOTIVO_OBRIGATORIO')
    expect(agir(repo, p.id, 'reabrir', DIR, { motivo: 'Cliente mudou o vão para 30 m' })).toMatchObject({ situacao: 'EM_DESENVOLVIMENTO', entrega: undefined })
    agir(repo, p.id, 'entregar', ENG, { entrega: { resumo: 'Entrega revisada para 30 m', resultados: 'Vão de 30 m' } })
    expect(erro(() => agir(repo, p.id, 'encerrar', DIR, { resultado: { tipo: 'NAO_SEGUIU' } }))).toBe('MOTIVO_OBRIGATORIO')
    expect(agir(repo, p.id, 'encerrar', DIR, { resultado: { tipo: 'NAO_SEGUIU' }, motivo: 'Cliente adiou o investimento' })).toMatchObject({ situacao: 'ENCERRADO', motivo: 'Cliente adiou o investimento' })
  })

  it('cancelamento com motivo; estado final não admite nenhuma ação', () => {
    const repo = novoRepo()
    const p = criar(repo)
    expect(erro(() => agir(repo, p.id, 'cancelar', DIR))).toBe('MOTIVO_OBRIGATORIO')
    const c = agir(repo, p.id, 'cancelar', DIR, { motivo: 'Cliente desistiu da obra' })
    expect(c.situacao).toBe('CANCELADO')
    for (const a of ACOES_PEDIDO) expect(erro(() => agir(repo, p.id, a, ADM, { motivo: 'qualquer motivo', nota: 'x', prazoEntrega: '2026-12-01' })), a).toBe('ESTADO_FINAL')
  })
})

describe('Tabela de ações', () => {
  it('cobre todas as ações; nenhuma sai de estado final; todo estado aberto tem saída', () => {
    expect(Object.keys(REGRAS_ACAO).sort()).toEqual([...ACOES_PEDIDO].sort())
    for (const r of Object.values(REGRAS_ACAO)) for (const f of SITUACOES_FINAIS) expect(r.de).not.toContain(f)
    for (const s of SITUACOES_PEDIDO) if (!SITUACOES_FINAIS.includes(s)) expect(Object.values(REGRAS_ACAO).some((r) => r.de.includes(s) && r.para && r.para !== s), s).toBe(true)
  })
  it('assumir exige prazo e nenhuma pendência; entregar exige resumo, resultados e documentos resolvidos', () => {
    const repo = novoRepo()
    const p = criar(repo)
    agir(repo, p.id, 'iniciar_triagem', ENG)
    expect(erro(() => agir(repo, p.id, 'assumir_desenvolvimento', ENG))).toBe('DADOS_INCOMPLETOS')
    agir(repo, p.id, 'assumir_desenvolvimento', ENG, { prazoEntrega: '2026-11-25' })
    expect(erro(() => agir(repo, p.id, 'entregar', ENG, { entrega: { resumo: 'Entrega técnica completa', resultados: 'ok ok' } }))).toBe('DADOS_INCOMPLETOS') // arquitetura pendente
  })
  it('versão desatualizada e transição fora da tabela são recusadas', () => {
    const repo = novoRepo()
    const p = criar(repo)
    expect(erro(() => repo.agir(p.id, 'iniciar_triagem', ENG, { versao: 0 }, { organizacaoId: ORG, intencao: novaInt() }))).toBe('VERSAO_DESATUALIZADA')
    expect(erro(() => agir(repo, p.id, 'entregar', ENG, { entrega: { resumo: 'antes da hora!!', resultados: 'nada' } }))).toBe('TRANSICAO_INVALIDA')
  })
  it('editar dado validado faz ele voltar a declarado', () => {
    const repo = novoRepo()
    const p = criar(repo)
    agir(repo, p.id, 'iniciar_triagem', ENG)
    agir(repo, p.id, 'registrar_triagem', ENG, { validar: ['larguraM'] })
    agir(repo, p.id, 'pedir_dados', ENG, { motivo: 'Conferir o vão com o cliente', pendencias: ['Vão'] })
    const e = agir(repo, p.id, 'editar_dados', DIR, { dados: { cidade: 'Aparecida de Goiânia', uf: 'GO', comprimentoM: 100, larguraM: 30, alturaM: 12 } })
    expect(e.dados.larguraM).toEqual({ dado: 30, situacao: 'declarado' })
  })
})

describe('Autorização por perfil', () => {
  it('só a gestão comercial abre; demais perfis (Engenharia inclusive) são recusados', () => {
    for (const papel of PAPEIS) {
      const repo = novoRepo()
      const r = erro(() => criar(repo, entrada(), u(papel)))
      expect(r, papel).toBe(['Administrador', 'Diretoria'].includes(papel) ? undefined : 'SEM_PERMISSAO')
    }
  })
  it('Engenharia vê e age pelo lado técnico; Financeiro, Contabilidade e os demais não veem nada', () => {
    const repo = novoRepo()
    criar(repo)
    expect(repo.listar(ENG, ORG)).toHaveLength(1)
    for (const papel of PAPEIS.filter((p) => !['Administrador', 'Diretoria', 'Engenharia'].includes(p))) {
      expect(repo.listar(u(papel), ORG), papel).toHaveLength(0)
      expect(repo.obter(u(papel), ORG, repo.listar(DIR, ORG)[0].id), papel).toBeUndefined()
    }
    expect(repo.listar(u('Diretoria', 'x', false), ORG)).toHaveLength(0)
  })
  it('cada lado só faz as suas ações; só o responsável técnico age depois da triagem; Engenharia só recusa na triagem', () => {
    const repo = novoRepo()
    const p = criar(repo)
    expect(erro(() => agir(repo, p.id, 'editar_dados', ENG, { dados: { larguraM: 35 } }))).toBe('SEM_PERMISSAO') // ação do Comercial, válida em SOLICITADO
    expect(erro(() => agir(repo, p.id, 'iniciar_triagem', FIN))).toBe('SEM_PERMISSAO')
    agir(repo, p.id, 'iniciar_triagem', ENG)
    expect(erro(() => agir(repo, p.id, 'assumir_desenvolvimento', ENG2, { prazoEntrega: '2026-11-25' }))).toBe('SEM_PERMISSAO')
    expect(repo.obter(ENG2, ORG, p.id)).toBeUndefined() // atribuída ao ENG: some da vista do ENG2 (fila técnica, E11.2B)
    expect(acoesDisponiveis(ENG2, repo.obter(DIR, ORG, p.id)!)).toEqual([])
    expect(acoesDisponiveis(ENG, repo.obter(ENG, ORG, p.id)!)).toEqual(expect.arrayContaining(['registrar_triagem', 'pedir_dados', 'assumir_desenvolvimento', 'cancelar']))
    agir(repo, p.id, 'assumir_desenvolvimento', ENG, { prazoEntrega: '2026-11-25' })
    expect(erro(() => agir(repo, p.id, 'cancelar', ENG, { motivo: 'desistência da engenharia' }))).toBe('SEM_PERMISSAO')
    expect(motivoBloqueio(ENG, repo.obter(ENG, ORG, p.id)!, 'encerrar')).toBeDefined()
  })
  it('documento: o Comercial recebe; validar e dispensar são da Engenharia', () => {
    const repo = novoRepo()
    const p = criar(repo)
    expect(erro(() => agir(repo, p.id, 'atualizar_documento', ENG, { documento: { tipo: 'arquitetura', situacao: 'recebido' } }))).toBe('SEM_PERMISSAO')
    expect(erro(() => agir(repo, p.id, 'atualizar_documento', DIR, { documento: { tipo: 'arquitetura', situacao: 'validado' } }))).toBeUndefined() // Direção age pelos dois lados
  })
})

describe('Integridade, duplicidade e idempotência', () => {
  it('vínculos só por id oficial: oportunidade de outra empresa, inexistente ou fechada é recusada', () => {
    expect(errosDeVinculo(entrada(), FONTES)).toEqual([])
    expect(errosDeVinculo(entrada({ oportunidadeId: 'demo-o1' }), FONTES)).toContain('a oportunidade não é desta empresa')
    expect(errosDeVinculo(entrada({ oportunidadeId: 'nao-existe' }), FONTES)).toContain('oportunidade não encontrada no Radar')
    expect(errosDeVinculo(entrada({ empresaId: 'demo-solar', oportunidadeId: 'demo-o6' }), FONTES)).toContain('a oportunidade não está ativa (ganha, perdida ou em nutrição)')
    expect(errosDeVinculo(entrada({ vinculos: { inboxThreadId: 'thread-inexistente' } }), FONTES)).toContain('conversa do Inbox não encontrada')
    expect(errosDeVinculo(entrada({ vinculos: { registroFonteId: 'reg-inexistente' } }), FONTES)).toContain('evidência do Lead Engine não encontrada')
    expect(errosDeVinculo(entrada({ vinculos: { submissaoId: 'sub-inexistente' } }), FONTES)).toContain('submissão do simulador não encontrada no Inbox')
    expect(erro(() => criar(novoRepo(), entrada({ vinculos: { submissaoId: SUBMISSOES_DE_ENSAIO[0] } })))).toBe('ENSAIO')
  })
  it('submissão real do Inbox é aceita pelo id da mensagem do formulário', () => {
    const sub = demo.inbox!.mensagens.find((m) => m.externalMessageId && typeof m.meta?.['formulario'] === 'string')!
    expect(errosDeVinculo(entrada({ vinculos: { submissaoId: sub.externalMessageId! } }), FONTES)).toEqual([])
  })
  it('a mesma intenção não cria duas solicitações nem aplica a ação duas vezes', () => {
    const repo = novoRepo()
    const a = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: 'clique-1', fontes: FONTES })
    const b = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: 'clique-1', fontes: FONTES })
    expect(b).toEqual({ pedido: a.pedido, repetida: true })
    expect(repo.listar(DIR, ORG)).toHaveLength(1)
    const t1 = repo.agir(a.pedido.id, 'iniciar_triagem', ENG, { versao: 1 }, { organizacaoId: ORG, intencao: 'tri-1' })
    const t2 = repo.agir(a.pedido.id, 'iniciar_triagem', ENG, { versao: 1 }, { organizacaoId: ORG, intencao: 'tri-1' })
    expect(t2.repetida).toBe(true)
    expect(t2.pedido.versao).toBe(t1.pedido.versao)
    expect(repo.eventos(DIR, ORG, a.pedido.id)).toHaveLength(2)
  })
  it('uma solicitação aberta por tipo; outro tipo convive; depois de encerrada, a seguinte é a versão 2', () => {
    const repo = novoRepo()
    const p1 = criar(repo)
    expect(erro(() => criar(repo))).toBe('DUPLICADA')
    expect(criar(repo, entrada({ tipo: 'Análise técnica' })).versaoTipo).toBe(1)
    agir(repo, p1.id, 'cancelar', DIR, { motivo: 'Refazer com novo escopo' })
    const p2 = criar(repo)
    expect(p2).toMatchObject({ versaoTipo: 2, codigo: 'SP-0003' })
  })
  it('isolamento entre organizações: nada aparece nem é alterado de outra', () => {
    const repo = novoRepo()
    const p = criar(repo)
    criar(repo, entrada(), DIR, OUTRA)
    expect(repo.listar(DIR, ORG)).toHaveLength(1)
    expect(repo.listar(DIR, OUTRA)).toHaveLength(1)
    expect(repo.obter(DIR, OUTRA, p.id)).toBeUndefined()
    expect(repo.eventos(DIR, OUTRA, p.id)).toEqual([])
    expect(erro(() => repo.agir(p.id, 'cancelar', DIR, { versao: 1, motivo: 'tentativa de outra organização' }, { organizacaoId: OUTRA, intencao: novaInt() }))).toBe('SEM_PERMISSAO')
  })
})

describe('Engenharia sem dados comerciais', () => {
  it('a visão técnica não leva oportunidade nem vínculos, e nenhuma chave comercial existe em solicitação ou evento', () => {
    const repo = novoRepo()
    const p = criar(repo, entrada({ vinculos: { inboxThreadId: demo.inbox!.threads[0].id } }))
    agir(repo, p.id, 'iniciar_triagem', ENG)
    const tec = visaoTecnica(repo.obter(ENG, ORG, p.id)!, 'Barros Logística')
    expect('oportunidadeId' in tec).toBe(false)
    expect('vinculos' in tec).toBe(false)
    const chaves = new Set<string>()
    const visitar = (x: unknown) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { chaves.add(k); visitar(v) } }
    visitar(tec); visitar(repo.eventos(ENG, ORG, p.id))
    for (const c of CAMPOS_PROIBIDOS_PEDIDO) expect(chaves.has(c), c).toBe(false)
    const texto = JSON.stringify(tec)
    const op = demo.radar.oportunidades.find((o) => o.id === 'demo-o5')!
    for (const s of [op.titulo, String(op.valorEstimado), ...demo.radar.contatos.filter((c) => c.empresaId === 'demo-barros').flatMap((c) => [c.nome, c.email, c.telefone])].filter((x): x is string => !!x && x.length > 3)) expect(texto.includes(s), s).toBe(false)
  })
})

describe('Compatibilidade com Radar, Inbox e Orçamentos', () => {
  it('o ciclo inteiro e o exemplo não mudam o Radar (estágio da oportunidade inclusive) nem os orçamentos', () => {
    const repo = novoRepo()
    semearExemploPedidos(repo, { organizacaoId: ORG, fontes: FONTES, comercial: DIR, engenharia: ENG, hoje: HOJE })
    expect(repo.listar(DIR, ORG).map((p) => p.situacao).sort()).toEqual(['DADOS_PENDENTES', 'EM_DESENVOLVIMENTO', 'SOLICITADO'])
    expect(JSON.stringify(demo.radar)).toBe(radarAntes)
    expect(demo.radar.oportunidades.find((o) => o.id === 'demo-o4')?.estagio).toBe('PROJECT_RECEIVED')
  })
  it('divergência de estágio só é sugerida', () => {
    expect(divergenciaDeEstagio({ situacao: 'EM_DESENVOLVIMENTO' }, 'QUALIFIED')).toBe('ENGINEERING')
    expect(divergenciaDeEstagio({ situacao: 'EM_DESENVOLVIMENTO' }, 'ENGINEERING')).toBeUndefined()
    // oportunidade já adiante nunca recebe sugestão de voltar; fechada também não
    expect(divergenciaDeEstagio({ situacao: 'SOLICITADO' }, 'PROPOSAL_SENT')).toBeUndefined()
    expect(divergenciaDeEstagio({ situacao: 'ENTREGUE' }, 'NEGOTIATION')).toBeUndefined()
    expect(divergenciaDeEstagio({ situacao: 'ENTREGUE' }, 'ENGINEERING')).toBe('PRICING')
    expect(divergenciaDeEstagio({ situacao: 'SOLICITADO' }, 'WON')).toBeUndefined()
  })
})

describe('Prazo e indicadores', () => {
  it('situação do prazo usa o de entrega e, antes dele, o solicitado', () => {
    const base = { situacao: 'EM_DESENVOLVIMENTO' as const }
    expect(situacaoPrazo({ ...base, prazoEntrega: '2026-11-15' }, HOJE)).toBe('atrasado')
    expect(situacaoPrazo({ ...base, prazoSolicitado: '2026-11-18' }, HOJE)).toBe('vence_logo')
    expect(situacaoPrazo({ ...base, prazoSolicitado: '2026-11-18', prazoEntrega: '2026-12-01' }, HOJE)).toBe('no_prazo')
    expect(situacaoPrazo({ situacao: 'ENTREGUE', prazoEntrega: '2026-11-01' }, HOJE)).toBe('concluido')
  })
  it('resumo: com quem está, atrasadas e pendências abertas', () => {
    const repo = novoRepo()
    semearExemploPedidos(repo, { organizacaoId: ORG, fontes: FONTES, comercial: DIR, engenharia: ENG, hoje: HOJE })
    const r = resumoPedidos(repo.listar(DIR, ORG), HOJE)
    expect(r).toMatchObject({ abertas: 3, comEngenharia: 2, comComercial: 1, atrasadas: 1, pendenciasAbertas: 2 })
  })
  it('o contrato de criação recusa campos obrigatórios ausentes', () => {
    expect(erro(() => criar(novoRepo(), entrada({ dados: { cidade: 'Goiânia', uf: 'GO' } })))).toBe('DADOS_INCOMPLETOS')
    expect(erro(() => criar(novoRepo(), entrada({ dados: { cidade: 'Goiânia', uf: 'GO', larguraM: -3 } })))).toBe('DADOS_INCOMPLETOS')
    expect(erro(() => criarPedido(entrada(), DIR, { id: 'x', organizacaoId: ORG, agora: AGORA, intencao: 'i', existentes: [] as PedidoProjeto[], fontes: FONTES, novoId: () => 'e' }))).toBeUndefined()
  })
})

void CONT

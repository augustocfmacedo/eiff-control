// E11.2B — relógio operacional (separado da data-base financeira) e fila técnica da Engenharia. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest'
import { seedInbox } from '../inbox/seed'
import type { Papel, Usuario } from '../types'
import { demonstracaoCentral } from './demonstracao'
import { filaTecnica, situacaoPrazo, type EntradaPedido, type FontesVinculo } from './pedidoProjeto'
import { semearExemploPedidos } from './pedidosExemplo'
import { repositorioEmMemoria } from './pedidosRepositorio'
import { dataOperacional, diasEntre, hojeOperacional, relogioFixo, somarDias } from './relogio'

const u = (papel: Papel, id = `u-${papel}`): Usuario => ({ id, nome: papel, email: `${id}@exemplo`, papel, ativo: true, obras: '*' })
const DIR = u('Diretoria'), ENG = u('Engenharia'), ENG2 = u('Engenharia', 'u-eng-2'), FIN = u('Financeiro')
const ORG = 'org-a', OUTRA = 'org-b'
const demo = demonstracaoCentral('2026-11-16', seedInbox('2026-11-16T15:00:00.000Z'))
const FONTES: FontesVinculo = { radar: demo.radar, inbox: demo.inbox, orcamentos: demo.orcamentos }
const entrada = (extra: Partial<EntradaPedido> = {}): EntradaPedido => ({
  empresaId: 'demo-barros', oportunidadeId: 'demo-o5', origemLead: 'REUNIAO', tipo: 'Estudo preliminar', prioridade: 'Alta', responsavelComercialId: DIR.id,
  dados: { cidade: 'Aparecida de Goiânia', uf: 'GO', larguraM: 40 }, documentos: {}, ...extra,
})
let n = 0
const int = () => `i-${++n}`
const novoRepo = (agora = '2026-11-16T15:00:00.000Z') => repositorioEmMemoria({ agora: () => agora, novoId: (p) => `${p}-${++n}` })

describe('Relógio operacional', () => {
  it('a data de hoje é a civil de São Paulo, não a de UTC (virada de dia às 03:00Z)', () => {
    expect(dataOperacional('2026-11-17T02:59:59.000Z')).toBe('2026-11-16') // 23:59:59 em São Paulo
    expect(dataOperacional('2026-11-17T03:00:00.000Z')).toBe('2026-11-17') // 00:00 em São Paulo
    expect(hojeOperacional(relogioFixo('2026-12-31T23:30:00.000Z'))).toBe('2026-12-31') // 20:30 em São Paulo
    expect(hojeOperacional(relogioFixo('2027-01-01T02:00:00.000Z'))).toBe('2026-12-31') // ainda 23:00 do dia 31
  })
  it('datas sem horário são comparadas como datas civis', () => {
    expect(diasEntre('2026-11-16', '2026-11-16')).toBe(0)
    expect(diasEntre('2026-11-16', '2026-11-18')).toBe(2)
    expect(diasEntre('2026-11-30', '2026-12-01')).toBe(1)
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('vencimento: no próprio dia «vence logo», no dia seguinte «atrasado» — e a virada vem do fuso de São Paulo', () => {
    const p = { situacao: 'EM_DESENVOLVIMENTO' as const, prazoEntrega: '2026-11-16' }
    expect(situacaoPrazo(p, hojeOperacional(relogioFixo('2026-11-17T02:59:00.000Z')))).toBe('vence_logo') // 23:59 do dia 16
    expect(situacaoPrazo(p, hojeOperacional(relogioFixo('2026-11-17T03:00:00.000Z')))).toBe('atrasado') // 00:00 do dia 17
    expect(situacaoPrazo({ ...p, prazoEntrega: '2026-11-19' }, '2026-11-16')).toBe('no_prazo')
    expect(situacaoPrazo({ ...p, prazoEntrega: '2026-11-18' }, '2026-11-16')).toBe('vence_logo')
  })
  it('a data-base financeira parada no passado não comanda os prazos (o caso que motivou a correção)', () => {
    const p = { situacao: 'EM_DESENVOLVIMENTO' as const, prazoEntrega: '2026-09-10' }
    expect(situacaoPrazo(p, '2026-09-01')).toBe('no_prazo') // o que a tela mostrava com a data-base de 01/09
    expect(situacaoPrazo(p, hojeOperacional(relogioFixo('2026-11-16T15:00:00.000Z')))).toBe('atrasado') // a verdade em 16/11
  })
  it('o exemplo nasce com datas coerentes com o dia de operação', () => {
    const repo = novoRepo()
    semearExemploPedidos(repo, { organizacaoId: ORG, fontes: FONTES, comercial: DIR, engenharia: ENG, hoje: '2026-11-16' })
    const lista = repo.listar(DIR, ORG)
    for (const p of lista) {
      expect(p.criadoEm.slice(0, 10) <= '2026-11-16').toBe(true)
      if (p.prazoSolicitado) expect(p.prazoSolicitado >= '2026-11-16').toBe(true)
    }
    const atrasada = lista.find((p) => situacaoPrazo(p, '2026-11-16') === 'atrasado')
    expect(atrasada?.prazoEntrega).toBe('2026-11-15') // a única atrasada é a de propósito, com prazo de ontem
  })
})

describe('Fila técnica da Engenharia', () => {
  it('aguardando triagem é aberta à equipe técnica; atribuída sai da vista dos outros engenheiros', () => {
    const repo = novoRepo()
    const p = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES }).pedido
    expect(repo.listar(ENG, ORG)).toHaveLength(1)
    expect(repo.listar(ENG2, ORG)).toHaveLength(1)
    expect(filaTecnica(p, ENG)).toBe('triagem')
    repo.agir(p.id, 'iniciar_triagem', ENG, { versao: 1 }, { organizacaoId: ORG, intencao: int() })
    expect(repo.listar(ENG, ORG)).toHaveLength(1)
    expect(repo.listar(ENG2, ORG)).toHaveLength(0)
    expect(repo.eventos(ENG2, ORG, p.id)).toEqual([])
    expect(filaTecnica(repo.obter(ENG, ORG, p.id)!, ENG)).toBe('atribuidas')
  })
  it('reatribuição pela Direção move a solicitação entre engenheiros', () => {
    const repo = novoRepo()
    const p = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES }).pedido
    repo.agir(p.id, 'iniciar_triagem', ENG, { versao: 1 }, { organizacaoId: ORG, intencao: int() })
    repo.agir(p.id, 'atribuir', DIR, { versao: 2, responsavelTecnicoId: ENG2.id }, { organizacaoId: ORG, intencao: int() })
    expect(repo.listar(ENG, ORG)).toHaveLength(0)
    expect(filaTecnica(repo.obter(ENG2, ORG, p.id)!, ENG2)).toBe('atribuidas')
  })
  it('pré-atribuída na triagem: todos da equipe veem, só o responsável age', () => {
    const repo = novoRepo()
    const p = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES }).pedido
    repo.agir(p.id, 'atribuir', DIR, { versao: 1, responsavelTecnicoId: ENG2.id }, { organizacaoId: ORG, intencao: int() })
    expect(repo.listar(ENG, ORG)).toHaveLength(1) // continua na fila de triagem
    expect(() => repo.agir(p.id, 'iniciar_triagem', ENG, { versao: 2 }, { organizacaoId: ORG, intencao: int() })).toThrow(/responsável técnico/)
    expect(() => repo.agir(p.id, 'atribuir', ENG, { versao: 2, responsavelTecnicoId: ENG.id }, { organizacaoId: ORG, intencao: int() })).toThrow(/responsável técnico/)
    expect(repo.agir(p.id, 'iniciar_triagem', ENG2, { versao: 2 }, { organizacaoId: ORG, intencao: int() }).pedido.responsavelTecnicoId).toBe(ENG2.id)
  })
  it('engenheiro pode assumir uma solicitação sem responsável (atribuir a si)', () => {
    const repo = novoRepo()
    const p = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES }).pedido
    expect(repo.agir(p.id, 'atribuir', ENG2, { versao: 1, responsavelTecnicoId: ENG2.id }, { organizacaoId: ORG, intencao: int() }).pedido.responsavelTecnicoId).toBe(ENG2.id)
  })
  it('devolvidas e encerradas: o responsável continua vendo; ninguém mais da Engenharia', () => {
    const repo = novoRepo()
    const p = repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES }).pedido
    repo.agir(p.id, 'iniciar_triagem', ENG, { versao: 1 }, { organizacaoId: ORG, intencao: int() })
    repo.agir(p.id, 'pedir_dados', ENG, { versao: 2, motivo: 'Falta o layout interno', pendencias: ['layout'] }, { organizacaoId: ORG, intencao: int() })
    expect(filaTecnica(repo.obter(ENG, ORG, p.id)!, ENG)).toBe('devolvidas')
    expect(repo.listar(ENG2, ORG)).toHaveLength(0)
    repo.agir(p.id, 'cancelar', DIR, { versao: 3, motivo: 'Cliente desistiu' }, { organizacaoId: ORG, intencao: int() })
    expect(filaTecnica(repo.obter(ENG, ORG, p.id)!, ENG)).toBe('encerradas')
    expect(repo.listar(ENG2, ORG)).toHaveLength(0)
  })
  it('organização e perfil: outra organização e o Financeiro não veem nada, em nenhuma fila', () => {
    const repo = novoRepo()
    repo.criar(entrada(), DIR, { organizacaoId: ORG, intencao: int(), fontes: FONTES })
    expect(repo.listar(ENG, OUTRA)).toHaveLength(0)
    expect(repo.listar(FIN, ORG)).toHaveLength(0)
  })
})

// E11.2 (preparação, E11.1F) — contrato do pedido de projeto: jornada completa Comercial → Engenharia → Comercial,
// permissões por lado, visibilidade, devolução, entrega, histórico e o que nunca entra no pedido. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest'
import type { Papel, Usuario } from '../types'
import { PAPEIS } from '../usuarios'
import { SUBMISSOES_DE_ENSAIO } from './central'
import {
  ACOES_PEDIDO, CAMPOS_PROIBIDOS_PEDIDO, ErroPedido, SITUACOES_FINAIS, SITUACOES_PEDIDO, TRANSICOES_PEDIDO, aplicarAcao, divergenciaDeEstagio, pedidoVisivel,
  pendenciasDeEnvio, rascunhoDoSimulador, type AcaoPedido, type DadosAcao, type EventoPedido, type PedidoProjeto,
} from './pedidoProjeto'

const u = (papel: Papel, id = `u-${papel}`): Usuario => ({ id, nome: papel, email: `${id}@exemplo`, papel, ativo: true, obras: '*' })
const DIR = u('Diretoria'), ENG = u('Engenharia'), ENG2 = u('Engenharia', 'u-eng-2'), FIN = u('Financeiro'), CONT = u('Contabilidade')
let seq = 0
const novoId = (p: string) => `${p}-${++seq}`
const T = (h: number) => `2026-11-16T${String(10 + h).padStart(2, '0')}:00:00.000Z`

const SOLICITACAO = { mensagem: 'Meu nome é Fulana, telefone 62 99999-0000', configuracao: 'Galpão com 1 vão, cobertura em duas águas', medidas: 'vão 25 m × 80 m, pé-direito 10 m', especificacao: 'fechamento lateral em telha', prazo: 'até março', leituraDaPagina: ['texto automático'], contato: ['Fulana', 'Empresa Fictícia'], canais: [] }
const rascunho = (): PedidoProjeto => {
  const p = rascunhoDoSimulador({ externoId: 'sub-ficticia-1', threadId: 'TH-1', em: T(0), solicitacao: SOLICITACAO }, { id: 'PP-1', codigo: 'PP-0001', empresaId: 'emp-ficticia', oportunidadeId: 'op-ficticia', responsavelComercialId: DIR.id, agora: T(0), criadoPor: DIR.id })
  return { ...p, terreno: { cidade: 'Rio Verde', uf: 'GO' } }
}
function rodar(p: PedidoProjeto, passos: [AcaoPedido, Usuario, Omit<DadosAcao, 'versao'>?][]) {
  const eventos: EventoPedido[] = []
  let atual = p
  passos.forEach(([acao, quem, dados], i) => {
    const r = aplicarAcao(atual, acao, quem, { ...(dados ?? {}), versao: atual.versao }, T(i + 1), novoId)
    atual = r.pedido; eventos.push(r.evento)
  })
  return { pedido: atual, eventos }
}
const erro = (f: () => unknown) => { try { f(); return undefined } catch (e) { return e instanceof ErroPedido ? e.codigo : 'OUTRO' } }

describe('Jornada completa: Comercial → Engenharia → Comercial', () => {
  it('rascunho → solicitado → triagem → dados pendentes → triagem → desenvolvimento → entregue → encerrado, com histórico', () => {
    const { pedido, eventos } = rodar(rascunho(), [
      ['enviar', DIR],
      ['iniciar_triagem', ENG],
      ['pedir_dados', ENG, { motivo: 'Falta a sondagem e o layout', pendencias: ['sondagem', 'layout interno'] }],
      ['responder_pendencias', DIR],
      ['aceitar', ENG, { prazo: '2026-11-30' }],
      ['entregar', ENG, { entrega: { resumo: 'Estudo preliminar de estrutura entregue', anexoIds: ['ANX-1'] } }],
      ['encerrar', DIR, { resultado: { tipo: 'ORCAMENTO_GERADO', orcamentoId: 'ORC-9' } }],
    ])
    expect(pedido.situacao).toBe('ENCERRADO')
    expect(pedido.responsavelTecnicoId).toBe(ENG.id)
    expect(pedido.pendencias.map((x) => x.aberta)).toEqual([false, false])
    expect(pedido.entrega?.anexoIds).toEqual(['ANX-1'])
    expect(pedido.resultado).toEqual({ tipo: 'ORCAMENTO_GERADO', orcamentoId: 'ORC-9' })
    expect(pedido.versao).toBe(8)
    expect(eventos.map((e) => `${e.de}>${e.para}`)).toEqual(['RASCUNHO>SOLICITADO', 'SOLICITADO>TRIAGEM_TECNICA', 'TRIAGEM_TECNICA>DADOS_PENDENTES', 'DADOS_PENDENTES>TRIAGEM_TECNICA', 'TRIAGEM_TECNICA>EM_DESENVOLVIMENTO', 'EM_DESENVOLVIMENTO>ENTREGUE', 'ENTREGUE>ENCERRADO'])
    expect(eventos[2]).toMatchObject({ motivo: 'Falta a sondagem e o layout', por: ENG.id, papel: 'Engenharia' })
  })

  it('o Comercial pode recusar a entrega (reabrir com motivo) e encerrar como «não seguiu» com motivo', () => {
    const base = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG], ['aceitar', ENG, { prazo: '2026-11-30' }], ['entregar', ENG, { entrega: { resumo: 'Primeira entrega técnica' } }]]).pedido
    expect(erro(() => aplicarAcao(base, 'reabrir', DIR, { versao: base.versao }, T(9), novoId))).toBe('MOTIVO_OBRIGATORIO')
    const { pedido } = rodar(base, [['reabrir', DIR, { motivo: 'Cliente mudou o vão para 30 m' }], ['entregar', ENG, { entrega: { resumo: 'Entrega revisada para 30 m' } }], ['encerrar', DIR, { resultado: { tipo: 'NAO_SEGUIU' }, motivo: 'Cliente adiou o investimento' }]])
    expect(pedido).toMatchObject({ situacao: 'ENCERRADO', motivo: 'Cliente adiou o investimento', resultado: { tipo: 'NAO_SEGUIU' } })
  })
})

describe('Regras de transição', () => {
  it('a tabela cobre todas as ações; estados finais não saem', () => {
    expect(Object.keys(TRANSICOES_PEDIDO).sort()).toEqual([...ACOES_PEDIDO].sort())
    for (const regra of Object.values(TRANSICOES_PEDIDO)) for (const f of SITUACOES_FINAIS) expect(regra.de).not.toContain(f)
    for (const s of SITUACOES_PEDIDO) if (!SITUACOES_FINAIS.includes(s)) expect(Object.values(TRANSICOES_PEDIDO).some((r) => r.de.includes(s)), s).toBe(true)
  })

  it('envio exige empresa, oportunidade, responsável, cidade/UF e um dado técnico', () => {
    expect(pendenciasDeEnvio(rascunho())).toEqual([])
    const vazio = { ...rascunho(), terreno: {}, dadosDeclarados: [], construcao: {} }
    expect(pendenciasDeEnvio(vazio)).toEqual(['cidade e UF da obra', 'ao menos um dado técnico (construção ou dado declarado)'])
    expect(erro(() => aplicarAcao(vazio, 'enviar', DIR, { versao: 1 }, T(1), novoId))).toBe('DADOS_INCOMPLETOS')
  })

  it('aceitar exige prazo e nenhuma pendência aberta; entregar exige resumo e documentos resolvidos', () => {
    const triagem = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG]]).pedido
    expect(erro(() => aplicarAcao(triagem, 'aceitar', ENG, { versao: triagem.versao }, T(5), novoId))).toBe('DADOS_INCOMPLETOS')
    const comDoc = { ...rodar(triagem, [['aceitar', ENG, { prazo: '2026-11-30' }]]).pedido, documentos: [{ tipo: 'sondagem' as const, situacao: 'pendente' as const }] }
    expect(erro(() => aplicarAcao(comDoc, 'entregar', ENG, { versao: comDoc.versao, entrega: { resumo: 'Entrega técnica completa' } }, T(6), novoId))).toBe('DADOS_INCOMPLETOS')
  })

  it('versão desatualizada é recusada (concorrência)', () => {
    const p = rascunho()
    expect(erro(() => aplicarAcao(p, 'enviar', DIR, { versao: 0 }, T(1), novoId))).toBe('VERSAO_DESATUALIZADA')
  })

  it('transição fora da tabela é recusada', () => {
    expect(erro(() => aplicarAcao(rascunho(), 'entregar', DIR, { versao: 1, entrega: { resumo: 'antes da hora' } }, T(1), novoId))).toBe('TRANSICAO_INVALIDA')
  })
})

describe('Permissões e visibilidade', () => {
  it('a Engenharia não vê rascunho; vê o encaminhado; demais perfis nunca veem', () => {
    const r = rascunho()
    const enviado = rodar(r, [['enviar', DIR]]).pedido
    expect(pedidoVisivel(ENG, r)).toBe(false)
    expect(pedidoVisivel(ENG, enviado)).toBe(true)
    for (const papel of PAPEIS.filter((p) => !['Administrador', 'Diretoria', 'Engenharia'].includes(p))) {
      expect(pedidoVisivel(u(papel), enviado), papel).toBe(false)
      expect(erro(() => aplicarAcao(enviado, 'iniciar_triagem', u(papel), { versao: enviado.versao }, T(2), novoId)), papel).toBe('SEM_PERMISSAO')
    }
  })

  it('cada lado só faz as suas ações; a Engenharia não envia nem encerra', () => {
    expect(erro(() => aplicarAcao(rascunho(), 'enviar', ENG, { versao: 1 }, T(1), novoId))).toBe('SEM_PERMISSAO')
    const entregue = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG], ['aceitar', ENG, { prazo: '2026-11-30' }], ['entregar', ENG, { entrega: { resumo: 'Entrega técnica completa' } }]]).pedido
    expect(erro(() => aplicarAcao(entregue, 'encerrar', ENG, { versao: entregue.versao, resultado: { tipo: 'NAO_SEGUIU' }, motivo: 'tentativa da engenharia' }, T(7), novoId))).toBe('SEM_PERMISSAO')
  })

  it('depois da triagem, só o responsável técnico age pela Engenharia', () => {
    const triagem = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG]]).pedido
    expect(erro(() => aplicarAcao(triagem, 'aceitar', ENG2, { versao: triagem.versao, prazo: '2026-11-30' }, T(3), novoId))).toBe('SEM_PERMISSAO')
  })

  it('a Engenharia só cancela (recusa) na triagem, com motivo; depois disso, cancelar é do Comercial', () => {
    const triagem = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG]]).pedido
    expect(erro(() => aplicarAcao(triagem, 'cancelar', ENG, { versao: triagem.versao }, T(3), novoId))).toBe('MOTIVO_OBRIGATORIO')
    expect(aplicarAcao(triagem, 'cancelar', ENG, { versao: triagem.versao, motivo: 'Fora do escopo da EIFF (obra civil)' }, T(3), novoId).pedido.situacao).toBe('CANCELADO')
    const dev = rodar(triagem, [['aceitar', ENG, { prazo: '2026-11-30' }]]).pedido
    expect(erro(() => aplicarAcao(dev, 'cancelar', ENG, { versao: dev.versao, motivo: 'desistência da engenharia' }, T(4), novoId))).toBe('SEM_PERMISSAO')
  })

  it('Financeiro e Contabilidade não agem nem veem', () => {
    const enviado = rodar(rascunho(), [['enviar', DIR]]).pedido
    expect(pedidoVisivel(FIN, enviado)).toBe(false)
    expect(pedidoVisivel(CONT, enviado)).toBe(false)
  })
})

describe('Origem e dados declarados', () => {
  it('do simulador: só o técnico declarado, marcado com a fonte; mensagem livre, contato e leitura da página ficam de fora', () => {
    const p = rascunho()
    expect(p.origemRef).toEqual({ tipo: 'submissao', id: 'sub-ficticia-1' })
    expect(p.dadosDeclarados.map((d) => d.rotulo)).toEqual(['Configuração', 'Medidas', 'Especificação', 'Prazo informado'])
    expect(p.dadosDeclarados.every((d) => d.fonte === 'SIMULADOR')).toBe(true)
    const texto = JSON.stringify(p)
    for (const s of ['Fulana', '99999', 'texto automático', 'Empresa Fictícia']) expect(texto.includes(s), s).toBe(false)
  })

  it('ensaio nunca vira pedido; sem empresa promovida, também não', () => {
    const ctx = { id: 'x', codigo: 'PP-X', empresaId: 'e', oportunidadeId: 'o', responsavelComercialId: DIR.id, agora: T(0), criadoPor: DIR.id }
    expect(erro(() => rascunhoDoSimulador({ externoId: SUBMISSOES_DE_ENSAIO[0], threadId: 't', em: T(0), solicitacao: SOLICITACAO }, ctx))).toBe('ENSAIO')
    expect(erro(() => rascunhoDoSimulador({ externoId: 'real', threadId: 't', em: T(0), solicitacao: SOLICITACAO }, { ...ctx, empresaId: undefined }))).toBe('SEM_EMPRESA')
  })

  it('o pedido não tem nenhum campo comercial, em nenhuma etapa', () => {
    const { pedido, eventos } = rodar(rascunho(), [['enviar', DIR], ['iniciar_triagem', ENG], ['aceitar', ENG, { prazo: '2026-11-30' }], ['entregar', ENG, { entrega: { resumo: 'Entrega técnica completa' } }]])
    const chaves = new Set<string>()
    const visitar = (x: unknown) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { chaves.add(k); visitar(v) } }
    visitar(pedido); visitar(eventos)
    for (const c of CAMPOS_PROIBIDOS_PEDIDO) expect(chaves.has(c), c).toBe(false)
  })

  it('o estágio da oportunidade só é SUGERIDO quando diverge', () => {
    expect(divergenciaDeEstagio({ situacao: 'EM_DESENVOLVIMENTO' }, 'QUALIFIED')).toBe('ENGINEERING')
    expect(divergenciaDeEstagio({ situacao: 'EM_DESENVOLVIMENTO' }, 'ENGINEERING')).toBeUndefined()
    expect(divergenciaDeEstagio({ situacao: 'RASCUNHO' }, 'QUALIFIED')).toBeUndefined()
  })
})

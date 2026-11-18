/**
 * DEMONSTRAÇÃO da Central de Gestão Comercial — dados FICTÍCIOS, só em memória.
 *
 * O modo local do app traz o exemplo do EIFF Inbox (leads do site fictícios), mas o Radar e os orçamentos do seed
 * vêm vazios. Para a Central ser navegável no ensaio local, esta função monta um Radar e orçamentos de exemplo
 * (empresas `.exemplo`, nenhum dado de cliente real) e associa UM contato do exemplo do Inbox a uma empresa
 * fictícia, para mostrar o dossiê consolidando conversa + Radar.
 *
 * Regras: nunca é gravado (nada passa pelo store), nunca aparece no modo remoto e a tela mostra a faixa
 * «Demonstração · dados fictícios» enquanto está ligada. Datas relativas à data-base recebida.
 */
import type { Orcamento } from '../types'
import type { InboxDataset } from '../inbox/tipos'
import { radarVazio, type Atividade, type Contato, type Empresa, type HistoricoEstagio, type Oportunidade, type Projeto, type RadarDataset, type TarefaRadar } from '../radar/types'

export const MARCA_DEMONSTRACAO = 'Demonstração · dados fictícios, nada é gravado'

const somar = (hoje: string, dias: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
const iso = (hoje: string, dias: number) => `${somar(hoje, dias)}T13:00:00.000Z`

function empresa(id: string, nome: string, cidade: string, uf: string, setor: string, classe: Empresa['priorityClass'], hoje: string, dono?: string): Empresa {
  return {
    id, razaoSocial: `${nome} Ltda`, nomeFantasia: nome, dominio: `${id}.exemplo`, setor, cidade, uf, pais: 'BR', observacoes: 'Empresa fictícia (demonstração).', ativo: true,
    ...(dono ? { commercialOwnerId: dono } : {}), criadoEm: iso(hoje, -120), atualizadoEm: iso(hoje, -3),
    fitScore: 70, intentScore: 60, timingScore: 50, relationshipScore: 40, dataQualityScore: 80, priorityScore: 62, priorityClass: classe,
  }
}

/** Radar + orçamentos fictícios e o Inbox do exemplo com um contato associado a uma empresa fictícia. */
export function demonstracaoCentral(hoje: string, inboxExemplo?: InboxDataset): { radar: RadarDataset; orcamentos: Orcamento[]; inbox?: InboxDataset } {
  const empresas: Empresa[] = [
    empresa('demo-barros', 'Barros Logística', 'Aparecida de Goiânia', 'GO', 'Logística', 'A', hoje, 'u-augusto'),
    empresa('demo-cerrado', 'Cerrado Alimentos', 'Rio Verde', 'GO', 'Alimentos', 'A+', hoje, 'u-augusto'),
    empresa('demo-metalforte', 'Metalforte Implementos', 'Anápolis', 'GO', 'Indústria metalmecânica', 'B', hoje),
    empresa('demo-agrovia', 'Agrovia Cooperativa', 'Jataí', 'GO', 'Agronegócio', 'B', hoje, 'u-augusto'),
    empresa('demo-solar', 'Solar Atacarejo', 'Goiânia', 'GO', 'Varejo', 'C', hoje),
    empresa('demo-norte', 'Norte Frio Armazéns', 'Palmas', 'TO', 'Armazenagem frigorificada', 'A', hoje),
  ]
  const contatos: Contato[] = [
    { id: 'demo-c1', empresaId: 'demo-cerrado', nome: 'Luiza Prado', cargo: 'Gerente de engenharia', email: 'luiza@cerrado.exemplo', ativo: true } as Contato,
    { id: 'demo-c2', empresaId: 'demo-metalforte', nome: 'Sérgio Lemos', cargo: 'Diretor industrial', telefone: '+5562900000201', ativo: true } as Contato,
    { id: 'demo-c3', empresaId: 'demo-agrovia', nome: 'Patrícia Nunes', cargo: 'Coordenadora de expansão', email: 'patricia@agrovia.exemplo', ativo: true } as Contato,
    { id: 'demo-c4', empresaId: 'demo-norte', nome: 'Daniel Rocha', cargo: 'Diretor de operações', email: 'daniel@nortefrio.exemplo', ativo: true } as Contato,
  ]
  const projetos: Projeto[] = [
    { id: 'demo-p1', empresaId: 'demo-cerrado', nome: 'Ampliação da fábrica de rações', tipo: 'Galpão industrial', cidade: 'Rio Verde', uf: 'GO', areaM2: 3200, observacoes: '', criadoEm: iso(hoje, -60), atualizadoEm: iso(hoje, -10) },
    { id: 'demo-p2', empresaId: 'demo-norte', nome: 'Câmara fria e doca', tipo: 'Armazém frigorificado', cidade: 'Palmas', uf: 'TO', areaM2: 1800, observacoes: '', criadoEm: iso(hoje, -30), atualizadoEm: iso(hoje, -6) },
  ]
  const op = (o: Partial<Oportunidade> & Pick<Oportunidade, 'id' | 'empresaId' | 'titulo' | 'estagio' | 'probabilidade'>): Oportunidade =>
    ({ responsavelId: 'u-augusto', observacoes: '', criadoEm: iso(hoje, -45), atualizadoEm: iso(hoje, -5), ...o })
  const oportunidades: Oportunidade[] = [
    op({ id: 'demo-o1', empresaId: 'demo-cerrado', projetoId: 'demo-p1', titulo: 'Galpão da fábrica de rações (3.200 m²)', estagio: 'NEGOTIATION', valorEstimado: 1_850_000, probabilidade: 0.6, previsaoFechamento: somar(hoje, 20), proximaAcao: 'Reunião de fechamento com a diretoria', proximaAcaoEm: somar(hoje, 2) }),
    op({ id: 'demo-o2', empresaId: 'demo-metalforte', titulo: 'Galpão com ponte rolante 10 t', estagio: 'PROPOSAL_SENT', valorEstimado: 980_000, probabilidade: 0.4, previsaoFechamento: somar(hoje, 45), proximaAcao: 'Follow-up da proposta R01', proximaAcaoEm: somar(hoje, -3) }),
    op({ id: 'demo-o3', empresaId: 'demo-agrovia', titulo: 'Armazém graneleiro — estudo', estagio: 'PRICING', valorEstimado: 2_400_000, probabilidade: 0.3 }),
    op({ id: 'demo-o4', empresaId: 'demo-norte', projetoId: 'demo-p2', titulo: 'Câmara fria e doca de expedição', estagio: 'PROJECT_RECEIVED', probabilidade: 0.25, proximaAcao: 'Engenharia revisar a planta recebida', proximaAcaoEm: somar(hoje, 5) }),
    op({ id: 'demo-o5', empresaId: 'demo-barros', titulo: 'Centro de distribuição 40 × 100 m', estagio: 'NEED_CONFIRMED', valorEstimado: 3_100_000, probabilidade: 0.2, previsaoFechamento: somar(hoje, 75) }),
    op({ id: 'demo-o6', empresaId: 'demo-solar', titulo: 'Mezanino da loja', estagio: 'WON', valorEstimado: 210_000, valorFechado: 198_500, probabilidade: 1, fechadoEm: iso(hoje, -12), motivoFechamento: 'Prazo de montagem atendeu a inauguração', motivoEstagio: 'Pedido de compra assinado' }),
    op({ id: 'demo-o7', empresaId: 'demo-agrovia', titulo: 'Cobertura do pátio de máquinas', estagio: 'LOST', valorEstimado: 340_000, probabilidade: 0, fechadoEm: iso(hoje, -20), motivoFechamento: 'Preço: concorrente local 12% abaixo', motivoEstagio: 'Cliente escolheu outro fornecedor' }),
  ]
  const historicoEstagios: HistoricoEstagio[] = [
    { id: 'demo-h1', oportunidadeId: 'demo-o1', de: 'PROPOSAL_SENT', para: 'NEGOTIATION', usuarioId: 'u-augusto', motivo: 'Cliente pediu condições de pagamento', em: iso(hoje, -3) },
    { id: 'demo-h2', oportunidadeId: 'demo-o2', de: 'PRICING', para: 'PROPOSAL_SENT', usuarioId: 'u-augusto', motivo: 'Proposta R01 enviada', em: iso(hoje, -16) },
    { id: 'demo-h3', oportunidadeId: 'demo-o3', de: 'PROJECT_RECEIVED', para: 'PRICING', usuarioId: 'u-augusto', em: iso(hoje, -25) },
    { id: 'demo-h4', oportunidadeId: 'demo-o4', de: 'NEED_CONFIRMED', para: 'PROJECT_RECEIVED', usuarioId: 'u-augusto', motivo: 'Planta e sondagem recebidas', em: iso(hoje, -4) },
    { id: 'demo-h5', oportunidadeId: 'demo-o6', de: 'NEGOTIATION', para: 'WON', usuarioId: 'u-augusto', motivo: 'Pedido de compra assinado', em: iso(hoje, -12) },
    { id: 'demo-h6', oportunidadeId: 'demo-o7', de: 'PROPOSAL_SENT', para: 'LOST', usuarioId: 'u-augusto', motivo: 'Cliente escolheu outro fornecedor', em: iso(hoje, -20) },
  ]
  const at = (a: Partial<Atividade> & Pick<Atividade, 'id' | 'empresaId' | 'tipo' | 'canal' | 'ocorreuEm' | 'notas'>): Atividade => ({ usuarioId: 'u-augusto', criadoEm: a.ocorreuEm, ...a })
  const atividades: Atividade[] = [
    at({ id: 'demo-a1', empresaId: 'demo-cerrado', oportunidadeId: 'demo-o1', contatoId: 'demo-c1', tipo: 'PROPOSAL', canal: 'EMAIL', ocorreuEm: iso(hoje, -18), notas: 'Proposta R00 enviada.' }),
    at({ id: 'demo-a2', empresaId: 'demo-cerrado', oportunidadeId: 'demo-o1', contatoId: 'demo-c1', tipo: 'PROPOSAL', canal: 'EMAIL', ocorreuEm: iso(hoje, -9), notas: 'Revisão R01 com cobertura termoacústica.' }),
    at({ id: 'demo-a3', empresaId: 'demo-metalforte', oportunidadeId: 'demo-o2', contatoId: 'demo-c2', tipo: 'PROPOSAL', canal: 'EMAIL', ocorreuEm: iso(hoje, -16), notas: 'Proposta R01 enviada.' }),
    at({ id: 'demo-a4', empresaId: 'demo-agrovia', contatoId: 'demo-c3', tipo: 'CALL', canal: 'PHONE', ocorreuEm: iso(hoje, -2), resultado: 'REQUESTED_TECHNICAL_ANALYSIS', notas: 'Quer avaliação técnica de um galpão existente para ampliar 20 m.' }),
    at({ id: 'demo-a6', empresaId: 'demo-barros', oportunidadeId: 'demo-o5', tipo: 'CALL', canal: 'PHONE', ocorreuEm: iso(hoje, -1), resultado: 'REQUESTED_BUDGET', notas: 'Pediu orçamento técnico do CD 40 × 100 m; enviará a planta do lote.' }),
    at({ id: 'demo-a5', empresaId: 'demo-norte', oportunidadeId: 'demo-o4', contatoId: 'demo-c4', tipo: 'MEETING', canal: 'VISIT', ocorreuEm: iso(hoje, -4), resultado: 'REQUESTED_BUDGET', notas: 'Entregou planta da câmara fria e sondagem.' }),
  ]
  const tarefas: TarefaRadar[] = [
    { id: 'demo-t1', empresaId: 'demo-agrovia', oportunidadeId: 'demo-o3', responsavelId: 'u-augusto', tipo: 'PROPOSAL', prioridade: 'Alta', venceEm: somar(hoje, -1), status: 'Aberta', descricao: 'Fechar preço do armazém graneleiro', criadoEm: iso(hoje, -10) },
    { id: 'demo-t2', empresaId: 'demo-barros', oportunidadeId: 'demo-o5', responsavelId: 'u-augusto', tipo: 'FOLLOW_UP', prioridade: 'Normal', venceEm: somar(hoje, 4), status: 'Aberta', descricao: 'Cobrar planta do lote e sondagem', criadoEm: iso(hoje, -3) },
    { id: 'demo-t3', empresaId: 'demo-cerrado', responsavelId: 'u-augusto', tipo: 'CALL', prioridade: 'Normal', venceEm: somar(hoje, -10), status: 'Concluída', descricao: 'Apresentar a EIFF ao comprador', criadoEm: iso(hoje, -30), concluidaEm: iso(hoje, -10) },
  ]
  const radar: RadarDataset = { ...radarVazio(), empresas, contatos, projetos, oportunidades, historicoEstagios, atividades, tarefas }

  const orc = (o: Partial<Orcamento> & Pick<Orcamento, 'id' | 'codigo' | 'titulo' | 'cliente' | 'status' | 'data'>): Orcamento =>
    ({ bdi: 0.25, referenciaPrecos: 'Demonstração (sem catálogo)', observacoes: 'Orçamento fictício (demonstração).', criadoEm: iso(hoje, -20), criadoPor: 'u-augusto', atualizadoEm: iso(hoje, -5), itens: [], ...o })
  const item = (id: string, descricao: string, unidade: string, quantidade: number, custo: number) => ({ id, ordem: 1, etapa: 'Estrutura', codigo: id, descricao, unidade, quantidade, custoUnitarioManual: custo })
  const orcamentos: Orcamento[] = [
    orc({ id: 'demo-orc1', codigo: 'ORC-D01', titulo: 'Galpão da fábrica de rações', cliente: 'Cerrado Alimentos', status: 'Enviado', data: somar(hoje, -18), validade: somar(hoje, 12), itens: [item('d1', 'Estrutura metálica fabricada e montada', 'kg', 96_000, 13.2), item('d2', 'Cobertura termoacústica', 'm²', 3_400, 118)] }),
    orc({ id: 'demo-orc2', codigo: 'ORC-D02', titulo: 'Galpão com ponte rolante', cliente: 'Metalforte', status: 'Enviado', data: somar(hoje, -16), validade: somar(hoje, -1), itens: [item('d3', 'Estrutura metálica com viga de rolamento', 'kg', 54_000, 14.1)] }),
    orc({ id: 'demo-orc4', codigo: 'ORC-D04', titulo: 'Centro de distribuição 40 × 100 m', cliente: 'Barros Logística', status: 'Rascunho', data: somar(hoje, -1), validade: somar(hoje, 29), itens: [item('d4', 'Estrutura metálica fabricada e montada', 'kg', 128_000, 12.9), item('d5', 'Cobertura e fechamento em telha trapezoidal', 'm²', 7_200, 96)] }),
    orc({ id: 'demo-orc3', codigo: 'ORC-D03', titulo: 'Armazém graneleiro (estudo)', cliente: 'Agrovia', status: 'Rascunho', data: somar(hoje, -6) }),
  ]

  let inbox: InboxDataset | undefined
  if (inboxExemplo) {
    // Associa o contato do lead fictício «Helena Barros» à empresa fictícia do Radar: o dossiê junta conversa + conta.
    // E uma SEGUNDA solicitação da mesma cliente pelo site (outro formulário, na mesma conversa): o dossiê mostra as duas.
    const contatoHelena = inboxExemplo.contatos.find((c) => c.id === 'CTI-00012')
    const segunda = contatoHelena ? [{
      id: 'MSG-DEMO-SEGUNDA', threadId: 'THR-00013', direcao: 'inbound' as const, tipo: 'texto' as const, autor: { tipo: 'contato' as const, id: 'CTI-00012', nome: contatoHelena.nome }, em: new Date(Date.parse(inboxExemplo.threads.find((t) => t.id === 'THR-00013')?.abertaEm ?? `${hoje}T12:00:00Z`) + 3_600_000).toISOString(),
      provider: 'MANUAL' as const, anexos: [], externalMessageId: 'demo-submissao-2', meta: { formulario: 'iniciar-projeto' },
      texto: 'Aproveitando: precisamos também de uma cobertura para o pátio de manobras.\nConfiguração: Cobertura de pátio 20 x 30 m\nMedidas: vão 20 m · comprimento 30 m · pé-direito 8 m\nPrazo informado: Até 6 meses\nOrigem: formulário "iniciar-projeto" do site (eiff.com.br).\nContato: Helena Barros · Barros Logística · Aparecida de Goiânia/GO\nhelena@barroslog.exemplo · (62) 90000-0113',
    }] : []
    inbox = { ...inboxExemplo, contatos: inboxExemplo.contatos.map((c) => (c.id === 'CTI-00012' ? { ...c, empresaRadarId: 'demo-barros' } : c)), mensagens: [...inboxExemplo.mensagens, ...segunda] }
  }
  return { radar, orcamentos, ...(inbox ? { inbox } : {}) }
}

// Exemplo FICTÍCIO de solicitações de projeto para a demonstração local (E11.2A). Usa as oportunidades fictícias da
// demonstração da Central (ids `demo-*`) e passa pelo MESMO motor e repositório da tela — nada é atalho. Só em memória.
import type { Usuario } from '../types'
import type { FontesVinculo } from './pedidoProjeto'
import type { RepositorioPedidos } from './pedidosRepositorio'

export const MARCA_EXEMPLO_PEDIDOS = 'Dados fictícios de demonstração — em memória, nada é gravado'

export function semearExemploPedidos(repo: RepositorioPedidos, ctx: { organizacaoId: string; fontes: FontesVinculo; comercial: Usuario; engenharia: Usuario; hoje: string }): void {
  if (!ctx.fontes.radar.oportunidades.some((o) => o.id === 'demo-o5')) return // exemplo depende da demonstração da Central
  const org = ctx.organizacaoId
  const dia = (n: number) => new Date(Date.parse(`${ctx.hoje}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const criar = (intencao: string, e: Parameters<RepositorioPedidos['criar']>[0]) => repo.criar(e, ctx.comercial, { organizacaoId: org, intencao, fontes: ctx.fontes }).pedido
  const agir = (id: string, intencao: string, acao: Parameters<RepositorioPedidos['agir']>[1], quem: Usuario, d: Omit<Parameters<RepositorioPedidos['agir']>[3], 'versao'>) => {
    const atual = repo.obter(quem, org, id)!
    return repo.agir(id, acao, quem, { ...d, versao: atual.versao }, { organizacaoId: org, intencao, orcamentos: ctx.fontes.orcamentos }).pedido
  }

  // 1. Barros: acabou de chegar à Engenharia
  criar('exemplo-barros', {
    empresaId: 'demo-barros', oportunidadeId: 'demo-o5', origemLead: 'REUNIAO', tipo: 'Estudo preliminar', prioridade: 'Alta', prazoSolicitado: dia(6),
    responsavelComercialId: ctx.comercial.id, equipeTecnica: 'Engenharia estrutural',
    dados: { cidade: 'Aparecida de Goiânia', uf: 'GO', uso: 'Logística / CD', comprimentoM: 100, larguraM: 40, alturaM: 12, areaM2: 4000, tipologia: 'A definir pela Engenharia', projetoArquitetonico: 'Em elaboração', observacoes: 'Docas em uma lateral; cliente quer vão livre.' },
    documentos: { arquitetura: 'pendente', implantacao: 'recebido', sondagem: 'pendente' },
  })

  // 2. Câmara fria (Norte): a Engenharia devolveu por dados pendentes
  const norte = criar('exemplo-norte', {
    empresaId: 'demo-norte', oportunidadeId: 'demo-o4', origemLead: 'RADAR', tipo: 'Anteprojeto estrutural', prioridade: 'Normal', prazoSolicitado: dia(10),
    responsavelComercialId: ctx.comercial.id,
    dados: { cidade: 'Anápolis', uf: 'GO', uso: 'Indústria', areaM2: 1200, cobertura: 'Termoacústica', fechamentos: 'Isopainel na câmara', fundacaoTerreno: 'Sem sondagem' },
    documentos: { topografia: 'pendente', sondagem: 'pendente' },
  })
  agir(norte.id, 'exemplo-norte-1', 'iniciar_triagem', ctx.engenharia, {})
  agir(norte.id, 'exemplo-norte-2', 'pedir_dados', ctx.engenharia, { motivo: 'Faltam dados para dimensionar a câmara', pendencias: ['Temperatura de projeto da câmara', 'Sondagem do terreno'] })

  // 3. Agrovia: em desenvolvimento, com dados validados
  const agro = criar('exemplo-agrovia', {
    empresaId: 'demo-agrovia', oportunidadeId: 'demo-o3', origemLead: 'INDICACAO', tipo: 'Apoio ao orçamento técnico', prioridade: 'Urgente', prazoSolicitado: dia(3),
    responsavelComercialId: ctx.comercial.id,
    dados: { cidade: 'Jataí', uf: 'GO', uso: 'Agro', comprimentoM: 60, larguraM: 30, alturaM: 14, tipologia: 'Treliçado', cobertura: 'Telha trapezoidal' },
    documentos: {},
  })
  agir(agro.id, 'exemplo-agro-1', 'iniciar_triagem', ctx.engenharia, {})
  agir(agro.id, 'exemplo-agro-2', 'registrar_triagem', ctx.engenharia, { validar: ['cidade', 'uf', 'comprimentoM', 'larguraM'], nota: 'Medidas conferidas com o croqui do cliente.' })
  agir(agro.id, 'exemplo-agro-3', 'assumir_desenvolvimento', ctx.engenharia, { prazoEntrega: dia(-1) })
}

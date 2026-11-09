/**
 * Entrada do formulário do site no Radar — `eiff.com.br/simular-galpao/` e
 * `/contato/`.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ, E POR QUÊ ────────────────────────────────
 *
 * Não cria CRM nenhum. Tudo o que a integração precisa já existe no Radar e é
 * REUSADO aqui, sem segunda via:
 *
 *   • identidade e idempotência: `validarIntake`, `classificarIntake` e
 *     `registroDeIntake` do Lead Engine — a mesma máquina que o CNO usa;
 *   • deduplicação de conta: `encontrarEmpresa` (CNPJ → domínio → nome+local);
 *   • evidência bruta: `RegistroFonte`, imutável no banco depois do INSERT;
 *   • follow-up: a cadência CM2-B.1, que já trata sinal acionável novo como
 *     toque IMEDIATO. Nenhum mecanismo novo de acompanhamento é criado.
 *
 * O que não existia — e é só isto — era o adapter da fonte WEBSITE e a ponte
 * do lead promovido para oportunidade.
 *
 * ── A DIFERENÇA ENTRE ESTA FONTE E AS DE PROSPECÇÃO ─────────────────────
 *
 * O CNO e o PNCP são DESCOBERTA: ninguém pediu para ser encontrado, e por isso
 * a promoção é humana e a identidade forte é exigida. O formulário é o oposto:
 * a pessoa se identificou e PEDIU contato. Isso muda duas coisas e só duas:
 *
 *   1. o contato nasce com o dado que ela mesma digitou, não inferido;
 *   2. existe pedido explícito de retorno, então a oportunidade nasce com
 *      próxima ação — e a regra do Radar que recusa oportunidade ativa sem
 *      próxima ação continua valendo, não é contornada.
 *
 * O que NÃO muda: a promoção segue passando pela revisão humana. Um formulário
 * é mais confiável que um raspador, não infalível — e `radar_source_record`
 * guarda a evidência de qualquer jeito.
 */
import type { AdapterFonte, ContatoNormalizado, EmpresaNormalizada, ProjetoNormalizado, RegistroNormalizado, SinalNormalizado } from './adapters'
import type { PedidoIntake } from './leadEngineIntake'
import { normalizarCidade, normalizarDominio, normalizarUf } from './normalizar'
import { PROBABILIDADE_ESTAGIO } from './padroes'
import type { Estagio, Oportunidade, TipoSinal } from './types'

/* ---------------------------------------------------------------
   1 · O envelope
--------------------------------------------------------------- */

/**
 * Mesma forma do CNO: a evidência como a fonte entregou, ao lado da projeção
 * normalizada. Normalização é LEITURA do dado, nunca o dado.
 */
export const SCHEMA_FORMULARIO_SITE = 'FORMULARIO_SITE_V1' as const

/** Os dois formulários publicados hoje. Catálogo fechado. */
export const FORMULARIOS = ['simular-galpao', 'iniciar-projeto'] as const
export type NomeFormulario = (typeof FORMULARIOS)[number]

/**
 * O que o Netlify entrega: os campos como o formulário os nomeia, mais o
 * identificador e o instante da submissão.
 */
export interface SubmissaoFormulario {
  /** O id da submissão no Netlify. É a identidade externa quando existe. */
  id?: string
  formulario: string
  recebidoEm: string
  /** Os campos, exatamente com o `name` do formulário. */
  campos: Readonly<Record<string, string>>
}

export interface EnvelopeFormulario {
  schema: typeof SCHEMA_FORMULARIO_SITE
  /** O que a fonte entregou. Nunca editado. */
  evidence: SubmissaoFormulario
  /** A projeção que o adapter lê. */
  canonical: CanonicoFormulario
}

export interface CanonicoFormulario {
  formulario: NomeFormulario | 'desconhecido'
  recebidoEm: string
  nome?: string
  empresa?: string
  /**
   * O CNPJ, quando o formulário o pede e a pessoa o informa.
   *
   * Importa mais do que parece: o Lead Engine só cria conta nova com
   * IDENTIDADE FORTE — CNPJ com dígito válido ou business_id. Sem ele o
   * candidato fica PENDING e quem revisa decide, que é o comportamento
   * correto e não um defeito. Os formulários publicados hoje não pedem CNPJ.
   */
  cnpj?: string
  email?: string
  telefone?: string
  cidade?: string
  uf?: string
  /** `uso` no simulador; ausente em `iniciar-projeto`. */
  uso?: string
  areaM2?: number
  vaoM?: number
  comprimentoM?: number
  peDireitoM?: number
  /** `observacao` no simulador, `mensagem` em `iniciar-projeto`. */
  mensagem?: string
  /** O resumo que a própria página montou, quando há. */
  resumo?: string
  especificacao?: string
  /** Origem de campanha, como o simulador a grava. */
  origem?: string
  prazo?: string
  escopo?: string
}

const limpo = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim()
  return t === '' ? undefined : t
}

/** Número em pt-BR ou simples; devolve indefinido em vez de NaN. */
export const numeroDe = (v: string | undefined): number | undefined => {
  const t = limpo(v)
  if (t === undefined) return undefined
  const so = t.replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  // Sem dígito nenhum, `Number('')` daria 0 — e um campo ilegível viraria
  // "0 m²" em vez de ficar ausente. Ausente é a resposta certa.
  if (!/\d/.test(so)) return undefined
  const n = Number(so)
  return Number.isFinite(n) ? n : undefined
}

/** «Aparecida de Goiânia, GO» → cidade e UF, sem inventar quando não há. */
export function cidadeEUf(bruto: string | undefined): { cidade?: string; uf?: string } {
  const t = limpo(bruto)
  if (t === undefined) return {}
  const m = /^(.*?)[,/-]\s*([A-Za-z]{2})\s*$/.exec(t)
  if (m) return { cidade: normalizarCidade(m[1]!), uf: normalizarUf(m[2]!) }
  return { cidade: normalizarCidade(t) }
}

/** A projeção. Lê os dois formulários; campo ausente fica ausente. */
export function canonicoDaSubmissao(s: SubmissaoFormulario): CanonicoFormulario {
  const c = s.campos
  const { cidade, uf } = cidadeEUf(c['cidade'])
  const formulario = (FORMULARIOS as readonly string[]).includes(s.formulario)
    ? (s.formulario as NomeFormulario)
    : 'desconhecido'
  return {
    formulario,
    recebidoEm: s.recebidoEm,
    nome: limpo(c['nome']),
    empresa: limpo(c['empresa']),
    cnpj: limpo(c['cnpj']),
    email: limpo(c['email']),
    telefone: limpo(c['telefone']),
    cidade,
    uf,
    uso: limpo(c['uso']),
    areaM2: numeroDe(c['area']),
    vaoM: numeroDe(c['vao']),
    comprimentoM: numeroDe(c['comprimento']),
    peDireitoM: numeroDe(c['peDireito']),
    mensagem: limpo(c['observacao']) ?? limpo(c['mensagem']),
    resumo: limpo(c['resumo']),
    especificacao: limpo(c['especificacao']),
    origem: limpo(c['origem']),
    prazo: limpo(c['prazo']),
    escopo: limpo(c['escopo']),
  }
}

export const envelopeDaSubmissao = (s: SubmissaoFormulario): EnvelopeFormulario => ({
  schema: SCHEMA_FORMULARIO_SITE,
  evidence: s,
  canonical: canonicoDaSubmissao(s),
})

/* ---------------------------------------------------------------
   2 · A identidade externa
--------------------------------------------------------------- */

/**
 * QUAL submissão é esta. O id do Netlify quando existe; na falta, uma chave
 * determinística do que identifica a submissão — formulário, instante e
 * e-mail. Nunca `Date.now()`: reenviar a mesma submissão tem de dar a MESMA
 * identidade, senão a idempotência do intake não vale nada.
 */
export function externoIdDaSubmissao(s: SubmissaoFormulario): string | undefined {
  const id = limpo(s.id)
  if (id !== undefined) return id
  const email = limpo(s.campos['email'])
  const quando = limpo(s.recebidoEm)
  if (email === undefined || quando === undefined) return undefined
  return `${s.formulario}|${quando}|${email.toLowerCase()}`
}

/** O pedido que entra no Lead Engine. A validação e a classificação são dele. */
export function pedidoDeIntake(s: SubmissaoFormulario, fonteId: string): PedidoIntake {
  return {
    fonteId,
    externoId: externoIdDaSubmissao(s),
    tipo: 'empresa',
    payload: envelopeDaSubmissao(s),
    // O instante é o da SUBMISSÃO, não o do processamento: reprocessar a
    // mesma submissão não pode produzir um registro com data diferente.
    recebidoEm: s.recebidoEm,
  }
}

/* ---------------------------------------------------------------
   3 · O adapter
--------------------------------------------------------------- */

/**
 * O tipo de sinal. Quem descreve dimensões de uma edificação identificou um
 * projeto; quem só escreveu uma mensagem, não. A distinção é do dado, não de
 * heurística sobre o texto.
 */
export function tipoDoSinal(c: CanonicoFormulario): TipoSinal {
  const temGeometria = c.areaM2 !== undefined || c.vaoM !== undefined || c.comprimentoM !== undefined
  return temGeometria ? 'PROJECT_IDENTIFIED' : 'MANUAL'
}

/** O título do sinal, com o que a pessoa informou — sem adjetivo nosso. */
export function tituloDoSinal(c: CanonicoFormulario): string {
  const partes: string[] = ['Solicitação pelo site']
  if (c.uso !== undefined) partes.push(c.uso)
  if (c.areaM2 !== undefined) partes.push(`${c.areaM2} m²`)
  if (c.cidade !== undefined) partes.push(c.uf !== undefined ? `${c.cidade}/${c.uf}` : c.cidade)
  return partes.join(' · ')
}

/**
 * A razão social da conta. A pessoa pode não ter empresa — e aí a conta é o
 * nome dela, marcado como pessoa física na observação, em vez de ficar sem
 * raiz. Empresa é a raiz do Radar: sem ela não há onde pendurar nada.
 */
export function razaoSocialDaConta(c: CanonicoFormulario): string | undefined {
  return c.empresa ?? c.nome
}

export function empresaNormalizada(c: CanonicoFormulario): EmpresaNormalizada | undefined {
  const razaoSocial = razaoSocialDaConta(c)
  if (razaoSocial === undefined) return undefined
  const dominio = c.email !== undefined ? normalizarDominio(c.email.split('@')[1] ?? '') : undefined
  return {
    razaoSocial,
    ...(c.cnpj !== undefined ? { cnpj: c.cnpj } : {}),
    ...(dominio !== undefined && dominio !== '' ? { dominio } : {}),
    ...(c.cidade !== undefined ? { cidade: c.cidade } : {}),
    ...(c.uf !== undefined ? { uf: c.uf } : {}),
  }
}

export function contatoNormalizado(c: CanonicoFormulario): ContatoNormalizado | undefined {
  if (c.nome === undefined) return undefined
  return {
    nome: c.nome,
    ...(c.email !== undefined ? { email: c.email } : {}),
    ...(c.telefone !== undefined ? { telefone: c.telefone } : {}),
    // Quem pede estudo para a própria obra decide ou fala com quem decide.
    // É hipótese declarada, e a revisão humana confirma ou corrige.
    decisor: true,
  }
}

export function projetoNormalizado(c: CanonicoFormulario): ProjetoNormalizado | undefined {
  if (c.areaM2 === undefined && c.vaoM === undefined && c.mensagem === undefined) return undefined
  return {
    nome: tituloDoSinal(c),
    ...(c.uso !== undefined ? { tipo: c.uso } : {}),
    ...(c.cidade !== undefined ? { cidade: c.cidade } : {}),
    ...(c.uf !== undefined ? { uf: c.uf } : {}),
    ...(c.areaM2 !== undefined ? { areaM2: c.areaM2 } : {}),
  }
}

export function sinalNormalizado(c: CanonicoFormulario): SinalNormalizado {
  const descricao = [c.resumo, c.especificacao, c.mensagem].filter((x) => x !== undefined).join(' · ')
  return {
    tipo: tipoDoSinal(c),
    titulo: tituloDoSinal(c),
    ...(descricao !== '' ? { descricao } : {}),
    eventoEm: c.recebidoEm,
    // A pessoa escreveu e enviou: a origem do dado é ela própria. Não é
    // inferência nossa, e por isso a confiança é a mais alta do catálogo.
    confianca: 0.95,
  }
}

export const adapterFormularioSite: AdapterFonte = {
  fonte: 'WEBSITE',
  nome: 'Formulário do site',
  normalizar(bruto: unknown): RegistroNormalizado | undefined {
    const env = bruto as Partial<EnvelopeFormulario> | undefined
    if (env?.schema !== SCHEMA_FORMULARIO_SITE || env.canonical === undefined) return undefined
    const c = env.canonical
    const empresa = empresaNormalizada(c)
    if (empresa === undefined) return undefined
    const contato = contatoNormalizado(c)
    const projeto = projetoNormalizado(c)
    return {
      fonte: 'WEBSITE',
      ...(env.evidence?.id !== undefined ? { externoId: env.evidence.id } : {}),
      empresa,
      ...(contato !== undefined ? { contatos: [contato] } : {}),
      ...(projeto !== undefined ? { projeto } : {}),
      sinais: [sinalNormalizado(c)],
      payload: bruto,
    }
  },
}

/* ---------------------------------------------------------------
   4 · A oportunidade
--------------------------------------------------------------- */

/**
 * O estágio inicial de um lead que chegou sozinho.
 *
 * `CONTACT_STARTED` diria que NÓS iniciamos — não iniciamos. `NEED_CONFIRMED`
 * diria que a necessidade foi confirmada em conversa — não houve conversa.
 * `ENGAGED` é o que de fato aconteceu: houve interação real, iniciada pela
 * outra parte, com necessidade descrita por escrito.
 *
 * É decisão comercial, não técnica: está numa constante para mudar em uma
 * linha se a leitura do funil for outra.
 */
export const ESTAGIO_INICIAL: Estagio = 'ENGAGED'

/** Prazo da primeira resposta, em dias. Lead parado perde valor rápido. */
export const PRAZO_PRIMEIRO_CONTATO_DIAS = 1

export interface PedidoDeOportunidade {
  id: string
  empresaId: string
  projetoId?: string
  responsavelId: string
  canonical: CanonicoFormulario
  /** Data-base do sistema, no formato ISO. */
  agora: string
  /** `agora` + PRAZO_PRIMEIRO_CONTATO_DIAS, calculado por quem chama. */
  proximaAcaoEm: string
}

/**
 * A oportunidade nasce COM próxima ação — não por exceção, mas porque existe
 * pedido explícito de retorno. A regra do Radar que recusa oportunidade ativa
 * sem próxima ação continua valendo e é satisfeita, não contornada.
 */
export function oportunidadeDoFormulario(p: PedidoDeOportunidade): Oportunidade {
  const c = p.canonical
  const onde = c.cidade !== undefined ? ` — ${c.cidade}${c.uf !== undefined ? `/${c.uf}` : ''}` : ''
  const o: Oportunidade = {
    id: p.id,
    empresaId: p.empresaId,
    ...(p.projetoId !== undefined ? { projetoId: p.projetoId } : {}),
    titulo: `${c.uso ?? 'Galpão'}${c.areaM2 !== undefined ? ` ${c.areaM2} m²` : ''}${onde}`,
    estagio: ESTAGIO_INICIAL,
    probabilidade: PROBABILIDADE_ESTAGIO[ESTAGIO_INICIAL],
    responsavelId: p.responsavelId,
    proximaAcao: 'Responder a solicitação recebida pelo site',
    proximaAcaoEm: p.proximaAcaoEm,
    observacoes: observacoesDoLead(c),
    criadoEm: p.agora,
    atualizadoEm: p.agora,
  }
  return o
}

/** O que a pessoa informou, em texto, para quem for atender ler de uma vez. */
export function observacoesDoLead(c: CanonicoFormulario): string {
  const linhas: string[] = [`Origem: formulário ${c.formulario} do site, em ${c.recebidoEm}.`]
  if (c.resumo !== undefined) linhas.push(`Configuração: ${c.resumo}`)
  if (c.especificacao !== undefined) linhas.push(`Especificação: ${c.especificacao}`)
  const medidas = [
    c.vaoM !== undefined ? `vão ${c.vaoM} m` : undefined,
    c.comprimentoM !== undefined ? `comprimento ${c.comprimentoM} m` : undefined,
    c.peDireitoM !== undefined ? `pé-direito ${c.peDireitoM} m` : undefined,
  ].filter((x) => x !== undefined)
  if (medidas.length > 0) linhas.push(`Medidas: ${medidas.join(' · ')}`)
  if (c.prazo !== undefined) linhas.push(`Prazo informado: ${c.prazo}`)
  if (c.escopo !== undefined) linhas.push(`Escopo: ${c.escopo}`)
  if (c.mensagem !== undefined) linhas.push(`Mensagem: ${c.mensagem}`)
  if (c.origem !== undefined) linhas.push(`Campanha: ${c.origem}`)
  return linhas.join('\n')
}

/* ---------------------------------------------------------------
   5 · O contato, que a promoção não cria
--------------------------------------------------------------- */

/**
 * `aplicarDecisao` promove empresa, projeto e sinal — e NÃO cria contato.
 * Não é esquecimento: nas fontes de descoberta não existe pessoa. O CNO
 * entrega uma obra e um responsável jurídico, não alguém com quem falar.
 *
 * No formulário é o contrário: a pessoa é o ativo. Quem preencheu pediu
 * retorno, deixou e-mail e telefone, e é com ela que o comercial fala.
 *
 * Por isso o contato entra num passo PRÓPRIO, depois da promoção, chamando o
 * mesmo `upsertContato` que o resto do Radar usa — com a mesma deduplicação
 * por id externo, e-mail ou nome. Nada do Lead Engine é alterado, e o
 * comportamento do CNO não muda em nada.
 */
export const CONTATO_VEM_DEPOIS = Object.freeze({
  porqueAPromocaoNaoCria: 'nas fontes de descoberta não existe pessoa: o CNO entrega obra e '
    + 'responsável jurídico, não alguém com quem falar',
  porqueAquiPrecisa: 'no formulário a pessoa é o ativo — ela pediu retorno e deixou canal',
  comoEntra: 'passo próprio depois da promoção, com o upsertContato do próprio Radar',
  oQueNaoMuda: 'o Lead Engine e o comportamento do CNO: nada neles é tocado',
})

/* ---------------------------------------------------------------
   6 · O que a integração nunca faz
--------------------------------------------------------------- */

export const PROIBICOES: readonly string[] = Object.freeze([
  'não envia mensagem a ninguém: a integração registra, quem fala é pessoa',
  'não promove sozinha — a decisão de criar conta segue sendo humana, na aba Candidatos',
  'não cria mecanismo de follow-up: a tarefa sai da cadência CM2-B.1 que já existe',
  'não chama o motor estrutural: nada aqui calcula peso, perfil, preço ou resistência',
  'não grava número de dimensionamento: o que vai para a oportunidade é o que a pessoa digitou',
  'não apaga nem edita a evidência: `radar_source_record` é imutável depois do INSERT',
])

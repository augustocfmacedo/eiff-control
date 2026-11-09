/**
 * Calendário comercial: quando a EIFF atende, e quanto tempo ÚTIL cabe entre
 * dois instantes.
 *
 * Módulo puro: não lê relógio, banco nem ambiente. Recebe um instante e
 * devolve outro. Quem usa hoje é o prazo de primeira resposta do lead do site
 * (`formularioGravacao.ts`); os SLAs dos demais canais continuam em horas
 * corridas, pela configuração do Inbox, e NÃO passam por aqui.
 *
 * ── O FUSO ───────────────────────────────────────────────────────────────
 *
 * `America/Sao_Paulo`. O Brasil não tem horário de verão desde 2019, então o
 * fuso é um deslocamento fixo de −03:00 e a conta é aritmética simples. Isso
 * é uma HIPÓTESE com data de validade: se o horário de verão voltar, o teste
 * `calendarioComercial.test.ts` («o deslocamento fixo confere com o fuso»)
 * falha, e é o sinal para trocar a conta por uma que consulte o fuso.
 *
 * ── OS FERIADOS: REGRA, NÃO LISTA DE DATAS ───────────────────────────────
 *
 * Cada feriado é uma REGRA (dia fixo, ou deslocamento a partir da Páscoa),
 * então o calendário vale para qualquer ano sem precisar de carga anual — e
 * um ano «esquecido» nunca derruba a entrada de leads.
 *
 * O que muda de um ano para o outro é a LEI, e isso é revisão humana:
 *
 *   PROCEDIMENTO ANUAL (todo dezembro, ou quando sair lei nova)
 *   1. conferir o calendário de feriados que o TJGO publica para o ano seguinte
 *      e os decretos do Estado de Goiás e da Prefeitura de Goiânia;
 *   2. regra nova ou revogada → editar `FERIADOS` (com a base legal);
 *   3. dia isolado que não é regra (luto, decreto, ponte decidida pela EIFF) →
 *      acrescentar em `EXCECOES`, com a data;
 *   4. atualizar `CALENDARIO_VERSAO` e `REVISADO_ATE`; rodar os testes.
 *
 * Feriado com `status: 'a_confirmar'` NÃO conta: fica na lista para ser visto
 * e decidido, e o dia é tratado como útil — errar para o lado do prazo mais
 * curto, nunca do mais folgado.
 */

export const CALENDARIO_VERSAO = '2026-11-09'
/** Último ano civil cuja legislação foi conferida por pessoa. */
export const REVISADO_ATE = 2026

export const FUSO_COMERCIAL = 'America/Sao_Paulo'
/** Deslocamento do fuso em minutos (−03:00). Hipótese vigiada por teste. */
export const DESLOCAMENTO_MIN = -180

export interface Expediente {
  /** Dias de atendimento: 0 = domingo … 6 = sábado. */
  diasUteis: readonly number[]
  /** Abertura e fechamento, em minutos desde a meia-noite local. */
  inicioMin: number
  fimMin: number
}

/** Segunda a sexta, 08:00 às 18:00. */
export const EXPEDIENTE_COMERCIAL: Expediente = Object.freeze({
  diasUteis: Object.freeze([1, 2, 3, 4, 5]),
  inicioMin: 8 * 60,
  fimMin: 18 * 60,
})

export type AmbitoFeriado = 'nacional' | 'estadual-GO' | 'municipal-Goiania'

export interface RegraFeriado {
  id: string
  nome: string
  ambito: AmbitoFeriado
  regra: { tipo: 'fixo'; mes: number; dia: number } | { tipo: 'pascoa'; deslocamentoDias: number }
  /** `a_confirmar` não conta como feriado até alguém conferir a base legal. */
  status: 'vigente' | 'a_confirmar'
  base: string
}

const fixo = (mes: number, dia: number) => ({ tipo: 'fixo' as const, mes, dia })

export const FERIADOS: readonly RegraFeriado[] = Object.freeze([
  { id: 'confraternizacao', nome: 'Confraternização Universal', ambito: 'nacional', regra: fixo(1, 1), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'sexta-santa', nome: 'Sexta-feira Santa', ambito: 'nacional', regra: { tipo: 'pascoa', deslocamentoDias: -2 }, status: 'vigente', base: 'Lei 9.093/1995 (feriado religioso) e calendário do TJGO' },
  { id: 'tiradentes', nome: 'Tiradentes', ambito: 'nacional', regra: fixo(4, 21), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'trabalho', nome: 'Dia do Trabalho', ambito: 'nacional', regra: fixo(5, 1), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'independencia', nome: 'Independência', ambito: 'nacional', regra: fixo(9, 7), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'aparecida', nome: 'Nossa Senhora Aparecida', ambito: 'nacional', regra: fixo(10, 12), status: 'vigente', base: 'Lei 6.802/1980' },
  { id: 'finados', nome: 'Finados', ambito: 'nacional', regra: fixo(11, 2), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'republica', nome: 'Proclamação da República', ambito: 'nacional', regra: fixo(11, 15), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'consciencia-negra', nome: 'Consciência Negra', ambito: 'nacional', regra: fixo(11, 20), status: 'vigente', base: 'Lei 14.759/2023' },
  { id: 'natal', nome: 'Natal', ambito: 'nacional', regra: fixo(12, 25), status: 'vigente', base: 'Lei 662/1949' },
  { id: 'auxiliadora', nome: 'Nossa Senhora Auxiliadora (padroeira de Goiânia)', ambito: 'municipal-Goiania', regra: fixo(5, 24), status: 'vigente', base: 'feriado municipal; consta no calendário de feriados do TJGO para a comarca de Goiânia' },
  { id: 'aniversario-goiania', nome: 'Aniversário de Goiânia', ambito: 'municipal-Goiania', regra: fixo(10, 24), status: 'vigente', base: 'feriado municipal' },
  // Não confirmados em fonte oficial em 09/11/2026: ficam visíveis e NÃO contam.
  { id: 'corpus-christi', nome: 'Corpus Christi', ambito: 'municipal-Goiania', regra: { tipo: 'pascoa', deslocamentoDias: 60 }, status: 'a_confirmar', base: 'ponto facultativo federal; as fontes divergem sobre ser feriado em Goiânia' },
  { id: 'fundacao-cidade-de-goias', nome: 'Fundação da Cidade de Goiás', ambito: 'estadual-GO', regra: fixo(7, 26), status: 'a_confirmar', base: 'transferência simbólica da capital; não confirmado como feriado estadual geral' },
])

/** Dia isolado que não é regra. `util: false` fecha um dia; `util: true` abre um feriado. */
export interface ExcecaoDeCalendario { data: string; nome: string; util: boolean }
export const EXCECOES: readonly ExcecaoDeCalendario[] = Object.freeze([])

export interface CalendarioComercial {
  expediente: Expediente
  feriados: readonly RegraFeriado[]
  excecoes: readonly ExcecaoDeCalendario[]
}

export const CALENDARIO_COMERCIAL: CalendarioComercial = Object.freeze({
  expediente: EXPEDIENTE_COMERCIAL, feriados: FERIADOS, excecoes: EXCECOES,
})

const DIA_MS = 86_400_000
const MIN_MS = 60_000
const dois = (n: number) => String(n).padStart(2, '0')
const dataCivil = (ano: number, mes: number, dia: number) => `${ano}-${dois(mes)}-${dois(dia)}`

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return { mes, dia }
}

/** Os feriados VIGENTES de um ano: data civil (AAAA-MM-DD) → nome. */
export function feriadosDoAno(ano: number, cal: CalendarioComercial = CALENDARIO_COMERCIAL): Map<string, string> {
  const out = new Map<string, string>()
  const p = pascoa(ano)
  for (const f of cal.feriados) {
    if (f.status !== 'vigente') continue
    if (f.regra.tipo === 'fixo') out.set(dataCivil(ano, f.regra.mes, f.regra.dia), f.nome)
    else {
      const d = new Date(Date.UTC(ano, p.mes - 1, p.dia) + f.regra.deslocamentoDias * DIA_MS)
      out.set(dataCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), f.nome)
    }
  }
  return out
}

/**
 * O dia civil (no fuso comercial) tem expediente?
 * Recebe a data civil AAAA-MM-DD — nunca um instante, para ninguém converter fuso duas vezes.
 */
export function ehDiaUtil(data: string, cal: CalendarioComercial = CALENDARIO_COMERCIAL): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  if (!m) throw new Error(`data civil inválida: ${data}`)
  const excecao = cal.excecoes.find((e) => e.data === data)
  if (excecao !== undefined) return excecao.util
  const ano = Number(m[1])
  const diaDaSemana = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  if (!cal.expediente.diasUteis.includes(diaDaSemana)) return false
  return !feriadosDoAno(ano, cal).has(data)
}

/** Relógio de parede no fuso comercial, guardado num `Date` «como se fosse UTC». */
const paraLocal = (instanteMs: number) => instanteMs + DESLOCAMENTO_MIN * MIN_MS
const paraInstante = (localMs: number) => localMs - DESLOCAMENTO_MIN * MIN_MS
const dataDoLocal = (localMs: number) => {
  const d = new Date(localMs)
  return dataCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}
const inicioDoDia = (localMs: number) => Math.floor(localMs / DIA_MS) * DIA_MS

/**
 * O instante em que se completam `minutos` de EXPEDIENTE a partir de `inicioIso`.
 *
 * - começou fora do expediente (noite, fim de semana, feriado): a contagem
 *   parte da abertura do próximo dia útil;
 * - não coube no dia: o que falta passa para a abertura do próximo dia útil;
 * - terminou exatamente no fechamento: o prazo é o fechamento daquele dia.
 *
 * Devolve ISO em UTC. Lança com entrada inválida — quem chama decide o que
 * fazer; devolver um prazo inventado seria pior do que não devolver nenhum.
 */
export function prazoUtil(inicioIso: string, minutos: number, cal: CalendarioComercial = CALENDARIO_COMERCIAL): string {
  const inicio = Date.parse(inicioIso)
  if (Number.isNaN(inicio)) throw new Error('instante inicial inválido')
  if (!Number.isFinite(minutos) || minutos <= 0) throw new Error('minutos úteis precisam ser positivos')
  const { inicioMin, fimMin } = cal.expediente
  if (!(fimMin > inicioMin)) throw new Error('expediente inválido')

  let cursor = paraLocal(inicio)
  let falta = minutos * MIN_MS
  // 3 anos de dias: nenhum calendário real chega perto, e um calendário sem dia útil não vira laço infinito.
  for (let passos = 0; passos < 1100; passos += 1) {
    const dia = inicioDoDia(cursor)
    const abre = dia + inicioMin * MIN_MS
    const fecha = dia + fimMin * MIN_MS
    if (!ehDiaUtil(dataDoLocal(cursor), cal) || cursor >= fecha) {
      cursor = dia + DIA_MS + inicioMin * MIN_MS
      continue
    }
    if (cursor < abre) cursor = abre
    const cabe = fecha - cursor
    if (falta <= cabe) return new Date(paraInstante(cursor + falta)).toISOString()
    falta -= cabe
    cursor = dia + DIA_MS + inicioMin * MIN_MS
  }
  throw new Error('calendário sem dia útil suficiente para o prazo')
}

/** O instante está dentro do expediente? */
export function emExpediente(instanteIso: string, cal: CalendarioComercial = CALENDARIO_COMERCIAL): boolean {
  const t = Date.parse(instanteIso)
  if (Number.isNaN(t)) throw new Error('instante inválido')
  const local = paraLocal(t)
  const minuto = (local - inicioDoDia(local)) / MIN_MS
  return ehDiaUtil(dataDoLocal(local), cal) && minuto >= cal.expediente.inicioMin && minuto < cal.expediente.fimMin
}

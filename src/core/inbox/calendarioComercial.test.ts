import { describe, expect, it } from 'vitest'
import {
  CALENDARIO_COMERCIAL, DESLOCAMENTO_MIN, FERIADOS, FUSO_COMERCIAL, REVISADO_ATE,
  ehDiaUtil, emExpediente, feriadosDoAno, pascoa, prazoUtil, type CalendarioComercial,
} from './calendarioComercial'

/** Instante a partir do relógio de parede de São Paulo (−03:00). */
const sp = (dataHora: string) => new Date(`${dataHora}:00-03:00`).toISOString()
const emSp = (iso: string) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: FUSO_COMERCIAL, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso)).replace(',', '')

describe('calendário · o fuso', () => {
  it('o deslocamento fixo confere com o fuso em todos os meses de 2026 a 2031 (se o horário de verão voltar, falha aqui)', () => {
    for (let ano = 2026; ano <= 2031; ano += 1) {
      for (let mes = 0; mes < 12; mes += 1) {
        const instante = new Date(Date.UTC(ano, mes, 15, 15, 0, 0))
        const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSO_COMERCIAL, hour: '2-digit', hour12: false }).format(instante))
        expect(hora, `${ano}-${mes + 1}`).toBe(15 + DESLOCAMENTO_MIN / 60)
      }
    }
  })
})

describe('calendário · feriados', () => {
  it('a Páscoa confere com datas conhecidas', () => {
    expect(pascoa(2024)).toEqual({ mes: 3, dia: 31 })
    expect(pascoa(2025)).toEqual({ mes: 4, dia: 20 })
    expect(pascoa(2026)).toEqual({ mes: 4, dia: 5 })
    expect(pascoa(2027)).toEqual({ mes: 3, dia: 28 })
  })

  it('os feriados vigentes de 2027: nacionais, Sexta-feira Santa e os dois de Goiânia', () => {
    const f = feriadosDoAno(2027)
    for (const d of ['2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-24', '2027-09-07', '2027-10-12', '2027-10-24', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25']) {
      expect(f.has(d), d).toBe(true)
    }
    expect(f.size).toBe(12)
  })

  it('feriado a confirmar NÃO conta e fica visível na lista', () => {
    const pendentes = FERIADOS.filter((f) => f.status === 'a_confirmar').map((f) => f.id)
    expect(pendentes).toEqual(['corpus-christi', 'fundacao-cidade-de-goias'])
    expect(feriadosDoAno(2027).has('2027-05-27')).toBe(false) // Corpus Christi 2027
    expect(ehDiaUtil('2027-07-26')).toBe(true)
  })

  it('toda regra tem base declarada, e o ano revisado está registrado', () => {
    for (const f of FERIADOS) expect(f.base.trim().length, f.id).toBeGreaterThan(5)
    expect(REVISADO_ATE).toBeGreaterThanOrEqual(2026)
  })

  it('ano sem revisão não derruba nada: as regras valem para qualquer ano', () => {
    expect(ehDiaUtil('2035-12-25')).toBe(false)
    expect(ehDiaUtil('2035-12-26')).toBe(true)
  })

  it('exceção isolada fecha um dia útil e abre um feriado', () => {
    const cal: CalendarioComercial = { ...CALENDARIO_COMERCIAL, excecoes: [{ data: '2027-03-01', nome: 'luto', util: false }, { data: '2027-04-21', nome: 'plantão', util: true }] }
    expect(ehDiaUtil('2027-03-01', cal)).toBe(false)
    expect(ehDiaUtil('2027-04-21', cal)).toBe(true)
  })

  it('sábado e domingo não são úteis; data malformada é recusada', () => {
    expect(ehDiaUtil('2026-11-14')).toBe(false)
    expect(ehDiaUtil('2026-11-15')).toBe(false)
    expect(() => ehDiaUtil('14/11/2026')).toThrow()
  })
})

describe('calendário · prazo em minutos úteis', () => {
  const casos: [string, string, string][] = [
    ['no meio do expediente', '2026-11-10 10:00', '2026-11-10 10:30'],
    ['na abertura', '2026-11-10 08:00', '2026-11-10 08:30'],
    ['termina exatamente no fechamento', '2026-11-10 17:30', '2026-11-10 18:00'],
    ['não cabe no dia: o resto vai para a abertura seguinte', '2026-11-10 17:50', '2026-11-11 08:20'],
    ['no minuto do fechamento', '2026-11-10 18:00', '2026-11-11 08:30'],
    ['de madrugada, antes de abrir', '2026-11-10 03:15', '2026-11-10 08:30'],
    ['à noite', '2026-11-10 22:40', '2026-11-11 08:30'],
    ['sexta à tarde, atravessando o fim de semana', '2026-11-13 17:50', '2026-11-16 08:20'],
    ['sexta à noite', '2026-11-13 19:00', '2026-11-16 08:30'],
    ['sábado', '2026-11-14 11:00', '2026-11-16 08:30'],
    ['domingo', '2026-11-15 23:59', '2026-11-16 08:30'],
    ['véspera de feriado no fim do dia (Consciência Negra, sexta 20/11)', '2026-11-19 17:45', '2026-11-23 08:15'],
    ['no feriado', '2026-11-20 10:00', '2026-11-23 08:30'],
    ['Natal numa sexta', '2026-12-24 17:55', '2026-12-28 08:25'],
    ['virada de ano', '2026-12-31 17:40', '2027-01-04 08:10'],
    ['Sexta-feira Santa de 2027', '2027-03-25 17:59', '2027-03-29 08:29'],
    ['aniversário de Goiânia em dia útil (terça 24/10/2028)', '2028-10-23 17:50', '2028-10-25 08:20'],
  ]
  it.each(casos)('%s', (_nome, de, ate) => {
    expect(emSp(prazoUtil(sp(de), 30))).toBe(ate)
  })

  it('virada de dia em UTC não muda o dia civil: 21:30 em São Paulo já é o dia seguinte em UTC', () => {
    // terça 10/11 21:30 −03:00 = quarta 11/11 00:30 UTC; o prazo é quarta 08:30 local, não quinta
    expect(prazoUtil('2026-11-11T00:30:00.000Z', 30)).toBe('2026-11-11T11:30:00.000Z')
  })

  it('preserva segundos e devolve ISO em UTC', () => {
    expect(prazoUtil('2026-11-10T13:00:42.000Z', 30)).toBe('2026-11-10T13:30:42.000Z')
  })

  it('prazo longo atravessa vários dias úteis (600 min = um expediente inteiro)', () => {
    expect(emSp(prazoUtil(sp('2026-11-10 12:00'), 600))).toBe('2026-11-11 12:00')
  })

  it('recusa entrada inválida em vez de inventar prazo', () => {
    expect(() => prazoUtil('ontem', 30)).toThrow()
    expect(() => prazoUtil(sp('2026-11-10 10:00'), 0)).toThrow()
    expect(() => prazoUtil(sp('2026-11-10 10:00'), Number.NaN)).toThrow()
  })

  it('calendário sem dia útil não entra em laço: lança', () => {
    const cal: CalendarioComercial = { ...CALENDARIO_COMERCIAL, expediente: { diasUteis: [], inicioMin: 480, fimMin: 1080 } }
    expect(() => prazoUtil(sp('2026-11-10 10:00'), 30, cal)).toThrow(/sem dia útil/)
  })

  it('emExpediente acompanha as mesmas bordas', () => {
    expect(emExpediente(sp('2026-11-10 08:00'))).toBe(true)
    expect(emExpediente(sp('2026-11-10 17:59'))).toBe(true)
    expect(emExpediente(sp('2026-11-10 18:00'))).toBe(false)
    expect(emExpediente(sp('2026-11-14 10:00'))).toBe(false)
    expect(emExpediente(sp('2026-11-20 10:00'))).toBe(false)
  })
})

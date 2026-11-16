// Relógio OPERACIONAL das solicitações de projeto (E11.2B).
//
// Separado de propósito da data-base FINANCEIRA (`ds.params.dataBase`), que é um parâmetro do motor de caixa/DRE e pode
// estar parada numa data passada (no seed, 01/09/2026). Solicitações, prazos, atrasos, filtros e indicadores usam a
// data real de operação. Nada aqui muda cálculo financeiro.
//
// Regras de tempo:
//   - instantes (criação, eventos) são ISO em UTC (`agora()`);
//   - "hoje" é a data CIVIL em America/Sao_Paulo derivada do instante (às 23:59 de São Paulo ainda é o mesmo dia, às
//     00:00 já é o seguinte, embora em UTC sejam 02:59 e 03:00);
//   - prazos são datas SEM horário (AAAA-MM-DD), comparadas como datas civis: vence no próprio dia, atrasa no seguinte.
//
// O relógio é injetável: testes usam um relógio fixo; o app usa o do sistema.

export const FUSO_OPERACIONAL = 'America/Sao_Paulo'

export interface Relogio { agora(): string }
export const relogioDoSistema: Relogio = { agora: () => new Date().toISOString() }
export const relogioFixo = (iso: string): Relogio => ({ agora: () => iso })

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_OPERACIONAL, year: 'numeric', month: '2-digit', day: '2-digit' })
/** Data civil (AAAA-MM-DD) do instante em São Paulo. */
export const dataOperacional = (iso: string): string => fmt.format(new Date(iso))
export const hojeOperacional = (r: Relogio = relogioDoSistema): string => dataOperacional(r.agora())

/** Diferença em dias entre duas datas civis (AAAA-MM-DD), sem fuso: meio-dia UTC evita borda de horário. */
export const diasEntre = (de: string, ate: string): number => Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86_400_000)
/** Data civil somada de n dias. */
export const somarDias = (data: string, n: number): string => new Date(Date.parse(`${data.slice(0, 10)}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

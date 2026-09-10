// Cenarios interativos de caixa: aplica ajustes hipoteticos sobre uma copia dos lancamentos (nada e gravado) para o motor
// recalcular o fluxo de 13 semanas. Regras: so titulos previstos (nao Realizado, nao Cancelado, nao excluidos) se movem;
// o novo contrato entra como parcelas de entrada clonadas de uma entrada real (mesma categoria/conta), status Programado.
import type { Dataset, Lancamento } from './types';

export interface AjustesCenario {
  atrasoRecebimentosDias: number; // recebimentos previstos atrasam N dias
  adiamentoPagamentosDias: number; // pagamentos previstos sao adiados N dias
  corteDespesasPct: number; // 0-1: corte nas saidas previstas sem obra (corporativo/administrativo)
  novoContratoValor: number; // receita liquida adicional
  novoContratoInicioSemanas: number; // primeira parcela em N semanas
  novoContratoParcelas: number; // numero de parcelas mensais
}
export const AJUSTES_ZERO: AjustesCenario = { atrasoRecebimentosDias: 0, adiamentoPagamentosDias: 0, corteDespesasPct: 0, novoContratoValor: 0, novoContratoInicioSemanas: 2, novoContratoParcelas: 3 };

export function somarDias(iso: string, dias: number): string {
  if (!iso) return iso;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const previsto = (l: Lancamento) => l.status !== 'Realizado' && l.status !== 'Cancelado' && !l.excluidoEm;

/** Copia do dataset com os ajustes aplicados (o original nao muda). */
export function aplicarCenario(ds: Dataset, a: AjustesCenario): Dataset {
  if (!cenarioAtivo(a)) return ds;
  const tipoDe = new Map(ds.planoContas.map((p) => [p.categoria, p.tipo]));
  const lancamentos: Lancamento[] = ds.lancamentos.map((l) => {
    if (!previsto(l)) return l;
    const tipo = tipoDe.get(l.categoria);
    if (tipo === 'Entrada' && a.atrasoRecebimentosDias) return { ...l, vencimento: somarDias(l.vencimento, a.atrasoRecebimentosDias) };
    if (tipo === 'Saída') {
      const corta = a.corteDespesasPct > 0 && !l.codigoObra; const adia = a.adiamentoPagamentosDias > 0;
      if (!corta && !adia) return l;
      const corte = corta ? 1 - Math.min(1, a.corteDespesasPct) : 1;
      return { ...l, vencimento: adia ? somarDias(l.vencimento, a.adiamentoPagamentosDias) : l.vencimento, valorBruto: Math.round(l.valorBruto * corte * 100) / 100 };
    }
    return l;
  });
  if (a.novoContratoValor > 0 && a.novoContratoParcelas > 0) {
    const modelo = ds.lancamentos.find((l) => tipoDe.get(l.categoria) === 'Entrada' && !l.excluidoEm);
    if (modelo) {
      const parcela = Math.round((a.novoContratoValor / a.novoContratoParcelas) * 100) / 100;
      for (let i = 0; i < a.novoContratoParcelas; i++) {
        const venc = somarDias(ds.params.dataBase, a.novoContratoInicioSemanas * 7 + i * 30);
        lancamentos.push({ ...modelo, id: `CEN-NOVO-${i + 1}`, registro: 'Real', descricao: `Cenário: novo contrato, parcela ${i + 1}/${a.novoContratoParcelas}`, documento: '', codigoObra: '', servicoId: undefined, faturamentoDireto: false, competencia: venc, vencimento: venc, status: 'Programado', valorBruto: parcela, retencoes: 0, desconto: 0, multaJuros: 0, probabilidade: 1, confiabilidade: 'Estimado', observacoes: 'simulação, não gravada' } as Lancamento);
      }
    }
  }
  return { ...ds, lancamentos };
}
export const cenarioAtivo = (a: AjustesCenario) => a.atrasoRecebimentosDias !== 0 || a.adiamentoPagamentosDias !== 0 || a.corteDespesasPct !== 0 || a.novoContratoValor > 0;

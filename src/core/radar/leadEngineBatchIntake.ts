// LE-3D — a fronteira de intake em lote do Lead Engine.
//
// Transforma PedidoIntake[] em um PLANO de RegistroFonte PENDING. Puro: nada aqui grava, promove, pontua ou
// cria entidade comercial. O unico objeto de negocio que este modulo conhece e RegistroFonte, e ele nasce com
// `statusIntake = 'PENDING'` e `entidadeId` ausente — o candidato existe, a conta comercial nao.
//
// Reutiliza o LE-1 sem reimplementar: `validarIntake`, `discoveryRecords`, `classificarIntake`,
// `registroDeIntake`. Nao ha segundo fingerprint nem segunda idempotencia.
//
// O que vem DEPOIS desta fronteira e humano: `filaDeRevisao` mostra o candidato e a decisao passa por
// `actions.processarCandidatoLeadEngine` (LE2-C). Este modulo nunca chama isso. E `ingerirRegistrosRadar` —
// que cria Empresa/Projeto/Sinal direto pelo adapter — e PROIBIDA neste fluxo: ela pularia a revisao.
import {
  classificarIntake, discoveryRecords, registroDeIntake, validarIntake,
  type ClassificacaoIntake, type DiscoveryRecord, type MotivoIntakeInvalido, type PedidoIntake, type ResultadoIntake,
} from './leadEngineIntake';
import type { RadarDataset, RegistroFonte } from './types';

export interface EntradaPlano {
  indice: number;
  externoId?: string;
  resultado: ResultadoIntake | 'INVALIDO';
  payloadFingerprint?: string;
  /** id do RegistroFonte planejado, quando NOVO_REGISTRO ou NOVA_OBSERVACAO */
  registroId?: string;
  /** id da observacao anterior do mesmo objeto externo, quando NOVA_OBSERVACAO */
  observacaoAnteriorId?: string;
  motivos?: MotivoIntakeInvalido[];
}

export interface PlanoBatchIntake {
  entradas: EntradaPlano[];
  novos: RegistroFonte[];
  novasObservacoes: RegistroFonte[];
  noops: EntradaPlano[];
  invalidos: EntradaPlano[];
  /** tudo que seria inserido, na ordem dos pedidos: novos + novas observacoes */
  registros: RegistroFonte[];
}

/**
 * Planeja o lote contra o estado atual (`existentes`) E contra o que o proprio lote ja planejou: dois pedidos
 * identicos no mesmo lote dao um registro e um NOOP, nunca dois registros. `novoId` e injetado — o core nao
 * decide como IDs nascem, e o ID nunca deriva do CNO.
 */
export function planejarBatchIntake(pedidos: PedidoIntake[], existentes: RegistroFonte[], novoId: () => string): PlanoBatchIntake {
  const vistos: DiscoveryRecord[] = discoveryRecords(existentes);
  const plano: PlanoBatchIntake = { entradas: [], novos: [], novasObservacoes: [], noops: [], invalidos: [], registros: [] };

  pedidos.forEach((p, indice) => {
    const v = validarIntake(p);
    if (!v.ok) {
      const e: EntradaPlano = { indice, externoId: p.externoId, resultado: 'INVALIDO', motivos: v.motivos };
      plano.entradas.push(e);
      plano.invalidos.push(e);
      return;
    }
    const c: ClassificacaoIntake = classificarIntake(v, vistos);
    if (c.resultado === 'IDEMPOTENT_NOOP') {
      const e: EntradaPlano = { indice, externoId: v.identidade.externoId, resultado: c.resultado, payloadFingerprint: v.payloadFingerprint };
      plano.entradas.push(e);
      plano.noops.push(e);
      return;
    }
    const registro = registroDeIntake(v, p, novoId());
    // invariantes da fronteira: nasce PENDING, sem entidade — a promocao e humana
    if (registro.statusIntake !== 'PENDING' || registro.entidadeId !== undefined) throw new Error('registroDeIntake violou a fronteira PENDING/sem entidade');
    const anterior = c.resultado === 'NOVA_OBSERVACAO' ? vistos.find((d) => d.fonteId === v.identidade.fonteId && d.externoId === v.identidade.externoId) : undefined;
    const e: EntradaPlano = { indice, externoId: v.identidade.externoId, resultado: c.resultado, payloadFingerprint: v.payloadFingerprint, registroId: registro.id, observacaoAnteriorId: anterior?.registroFonteId };
    plano.entradas.push(e);
    (c.resultado === 'NOVO_REGISTRO' ? plano.novos : plano.novasObservacoes).push(registro);
    plano.registros.push(registro);
    // o proprio lote passa a contar como "visto" para os pedidos seguintes
    vistos.push(...discoveryRecords([registro]));
  });

  return plano;
}

/** Aplica o plano SOMENTE EM MEMORIA: anexa os registros ao dataset. Nada anterior e alterado ou removido. */
export function aplicarPlanoEmMemoria(radar: RadarDataset, plano: PlanoBatchIntake): RadarDataset {
  return { ...radar, registrosFonte: [...radar.registrosFonte, ...plano.registros] };
}

export interface ResumoPlano {
  entradas: number;
  NOVO_REGISTRO: number;
  NOVA_OBSERVACAO: number;
  IDEMPOTENT_NOOP: number;
  INVALIDO: number;
  WOULD_INSERT: number;
}

export const resumoDoPlano = (p: PlanoBatchIntake): ResumoPlano => ({
  entradas: p.entradas.length,
  NOVO_REGISTRO: p.novos.length,
  NOVA_OBSERVACAO: p.novasObservacoes.length,
  IDEMPOTENT_NOOP: p.noops.length,
  INVALIDO: p.invalidos.length,
  WOULD_INSERT: p.novos.length + p.novasObservacoes.length,
});

// ------------------------------------------------------------------------------------------ hard gate do runner
export const CONFIRMACAO_PILOTO = 'CNO_PILOT_V1' as const;
export type ModoExecucao = 'SIMULACAO' | 'RECUSADO' | 'ESCRITA';

/**
 * Decide o modo do runner a partir das flags. Escrever exige `--executar` E `--confirmar CNO_PILOT_V1` ao mesmo
 * tempo; `--executar` sozinho e RECUSADO (nao cai em simulacao silenciosa), `--confirmar` sozinho e simulacao.
 */
export function modoExecucao(flags: { executar: boolean; confirmar?: string }): ModoExecucao {
  if (!flags.executar) return 'SIMULACAO';
  return flags.confirmar === CONFIRMACAO_PILOTO ? 'ESCRITA' : 'RECUSADO';
}

// ----------------------------------------------------------------------------------- fonte CNO da organizacao
export type ResolucaoFonte =
  | { ok: true; fonteId: string }
  | { ok: false; motivo: 'FONTE_CNO_AUSENTE' | 'FONTE_CNO_DUPLICADA' | 'FONTE_CNO_INATIVA' };

/** A fonte CNO vem do banco da organizacao, nunca de ID hardcoded. Exatamente uma, e ativa. */
export function resolverFonteCno(fontes: { id: string; codigo: string; ativo: boolean }[]): ResolucaoFonte {
  const cno = fontes.filter((f) => f.codigo === 'CNO');
  if (cno.length === 0) return { ok: false, motivo: 'FONTE_CNO_AUSENTE' };
  if (cno.length > 1) return { ok: false, motivo: 'FONTE_CNO_DUPLICADA' };
  if (!cno[0].ativo) return { ok: false, motivo: 'FONTE_CNO_INATIVA' };
  return { ok: true, fonteId: cno[0].id };
}

// ------------------------------------------------------------------------------- conferencia contra o manifest
export interface ConferenciaManifest {
  manifestEntries: number;
  snapshotMatch: number;
  fingerprintMatch: number;
  policyMatch: number;
  faltantes: string[];
  fingerprintDivergente: string[];
  politicaDivergente: string[];
  ok: boolean;
}

/**
 * O manifest NAO e payload: ele so diz quais CNOs e quais impressoes esperar. A observacao completa vem do
 * snapshot, o fingerprint e recalculado e a politica e reavaliada. Qualquer divergencia bloqueia o lote inteiro.
 */
export function conferirManifest(p: {
  esperados: { cno: string; payloadFingerprint: string }[];
  encontrados: { cno: string; payloadFingerprint: string; elegivel: boolean }[];
}): ConferenciaManifest {
  const porCno = new Map(p.encontrados.map((e) => [e.cno, e]));
  const faltantes: string[] = [];
  const fingerprintDivergente: string[] = [];
  const politicaDivergente: string[] = [];
  for (const e of p.esperados) {
    const f = porCno.get(e.cno);
    if (!f) { faltantes.push(e.cno); continue; }
    if (f.payloadFingerprint !== e.payloadFingerprint) fingerprintDivergente.push(e.cno);
    if (!f.elegivel) politicaDivergente.push(e.cno);
  }
  const n = p.esperados.length;
  const snapshotMatch = n - faltantes.length;
  return {
    manifestEntries: n,
    snapshotMatch,
    fingerprintMatch: snapshotMatch - fingerprintDivergente.length,
    policyMatch: snapshotMatch - politicaDivergente.length,
    faltantes, fingerprintDivergente, politicaDivergente,
    ok: n > 0 && !faltantes.length && !fingerprintDivergente.length && !politicaDivergente.length,
  };
}

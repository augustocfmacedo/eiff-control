// Signal Pilot 01: visao operacional de um grupo fixo de empresas para acompanhar como o score reage aos primeiros
// sinais reais inseridos manualmente. Nenhum valor e inventado: sem sinais, contagem 0, sinal "—", timing/intent atuais.
import { NOME_SINAL } from './padroes';
import { normalizarNome } from './normalizar';
import { contatoRecomendado, recomendarAcao, sinalPrincipal, type EstadoAcao } from './pipeline';
import type { RadarDataset } from './types';

/** Empresas do Signal Pilot 01 (nomes como estao no lote piloto; casamento por nome normalizado ou por inicio do nome). */
export const EMPRESAS_SIGNAL_PILOT = ['AgriConnection', 'BR agro', 'Cereal Ouro', 'Comid Agro', 'Oceana Minerals', 'Pivot Máquinas Agrícolas', 'Semear Performance Agronômica', 'Grupo Sinova', 'Agro Amazônia', 'Fiagril'];

export interface LinhaSignalPilot {
  nome: string; empresaId?: string; empresa?: string; encontrada: boolean;
  priorityScore?: number; classe?: string; decisionFit?: number; contato?: string; cargo?: string;
  signalCount: number; strongestSignal?: string; signalDate?: string; confidence?: number;
  timingScore?: number; intentScore?: number; recommendedAction: EstadoAcao | '—'; acao?: string;
}

export function visaoSignalPilot(r: RadarDataset, hoje: string, nomes: string[] = EMPRESAS_SIGNAL_PILOT): LinhaSignalPilot[] {
  const ativas = r.empresas.filter((e) => e.ativo && !e.mescladaEm);
  return nomes.map((nome) => {
    const alvo = normalizarNome(nome) ?? nome.toLowerCase();
    const e = ativas.find((x) => normalizarNome(x.razaoSocial) === alvo || (x.nomeFantasia && normalizarNome(x.nomeFantasia) === alvo)) ?? ativas.find((x) => (normalizarNome(x.razaoSocial) ?? '').startsWith(alvo));
    if (!e) return { nome, encontrada: false, signalCount: 0, recommendedAction: '—' };
    const sinais = r.sinais.filter((s) => s.empresaId === e.id);
    const forte = sinalPrincipal(e.id, r, hoje);
    const sug = contatoRecomendado(e.id, r);
    const rec = recomendarAcao(e, r, hoje);
    return {
      nome, empresaId: e.id, empresa: e.nomeFantasia ?? e.razaoSocial, encontrada: true,
      priorityScore: e.priorityScore, classe: e.priorityClass, decisionFit: sug?.fit.score, contato: sug?.contato.nome, cargo: sug?.contato.cargo,
      signalCount: sinais.length, strongestSignal: forte ? `${NOME_SINAL[forte.tipo] ?? forte.tipo}: ${forte.titulo}` : undefined, signalDate: forte?.eventoEm.slice(0, 10), confidence: forte?.confianca,
      timingScore: e.timingScore, intentScore: e.intentScore, recommendedAction: rec.estado, acao: rec.acao,
    };
  });
}

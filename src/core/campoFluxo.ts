// Fluxo guiado do dia (modo campo): regras puras do assistente passo a passo de fabrica e canteiro.
// A tela so percorre os passos; o que vale e o que vai para actions.salvarApontamento / apontarEstacao.
import type { Apontamento, ApontamentoLinha, ApontamentoOcorrencia, Colaborador, Dataset, LinhaProducao, LocalTrabalho, Presenca } from './types';
import { apontamentoDoDia, equipeDoLocal, linhasPadrao } from './equipe';
import { estacoesDe } from './producao';

export type Frente = 'fabrica' | 'canteiro';
export const LINHA_DA_FRENTE: Record<Frente, LinhaProducao> = { fabrica: 'Fabricação', canteiro: 'Montagem' };
export const LOCAL_DA_FRENTE: Record<Frente, LocalTrabalho> = { fabrica: 'Fábrica', canteiro: 'Obra' };
export const ROTULO_FRENTE: Record<Frente, string> = { fabrica: 'Fábrica', canteiro: 'Canteiro' };

export interface PassoFluxo { id: 'dia' | 'faltas' | 'extras' | 'estacoes' | 'ocorrencias' | 'resumo'; titulo: string; pergunta: string }
/** Passos do assistente por frente: canteiro pergunta o clima e as ocorrencias de campo; fabrica pergunta a temperatura e o turno. */
export function passosDoFluxo(frente: Frente): PassoFluxo[] {
  return [
    { id: 'dia', titulo: 'O dia', pergunta: frente === 'canteiro' ? 'Como está o dia no canteiro?' : 'Como está o dia na fábrica?' },
    { id: 'faltas', titulo: 'Faltas', pergunta: 'Quem não veio hoje?' },
    { id: 'extras', titulo: 'Hora extra', pergunta: 'Alguém fez hora extra?' },
    { id: 'estacoes', titulo: 'Produção', pergunta: frente === 'canteiro' ? 'O que foi montado hoje?' : 'O que passou por cada estação?' },
    { id: 'ocorrencias', titulo: 'Ocorrências', pergunta: 'Aconteceu algo que parou a equipe?' },
    { id: 'resumo', titulo: 'Fechar', pergunta: 'Confira e feche o dia' },
  ];
}

export const CLIMAS = ['Bom', 'Nublado', 'Chuva leve', 'Chuva forte', 'Impraticável'] as const;
/** Clima e temperatura viajam juntos no campo `clima` (texto livre no banco): "Nublado · 31 °C". */
export const climaTexto = (clima?: string, temperatura?: number): string | undefined => {
  const partes = [clima, temperatura !== undefined && Number.isFinite(temperatura) ? `${temperatura} °C` : undefined].filter(Boolean);
  return partes.length ? partes.join(' · ') : undefined;
};
export const climaDe = (texto?: string): { clima?: string; temperatura?: number } => {
  if (!texto) return {};
  const m = texto.match(/^(.*?)(?:\s*·\s*)?(-?\d+(?:[.,]\d+)?)\s*°C\s*$/);
  if (!m) return { clima: texto };
  return { clima: m[1].trim() || undefined, temperatura: Number(m[2].replace(',', '.')) };
};

/** Marcacoes de estacao do passo Producao: quilos e pecas por estacao e quem trabalhou nela. */
export interface MarcacaoEstacao { estacao: string; pesoKg: number; pecas: number; quem: string[]; ordemId?: string }
export const marcacoesVazias = (linha: LinhaProducao): MarcacaoEstacao[] => estacoesDe(linha).map((estacao) => ({ estacao, pesoKg: 0, pecas: 0, quem: [] }));

/**
 * Horas por colaborador em cada estacao: as horas do diario (normais + extras) divididas igualmente entre as estacoes
 * em que a pessoa foi marcada, para nao contar a mesma hora duas vezes na produtividade. Estacoes sem quilos e sem pecas
 * sao ignoradas.
 */
export function horasPorEstacao(linhas: ApontamentoLinha[], marcacoes: MarcacaoEstacao[], jornadaDe: (id: string) => number): Map<string, { colaboradorId: string; horas: number }[]> {
  const ativas = marcacoes.filter((m) => m.pesoKg > 0 || m.pecas > 0);
  const vezes = new Map<string, number>();
  for (const m of ativas) for (const id of m.quem) vezes.set(id, (vezes.get(id) ?? 0) + 1);
  const horasDe = (id: string) => { const l = linhas.find((x) => x.colaboradorId === id); return l ? (l.presenca === 'Presente' ? l.horas + l.horasExtras : 0) : jornadaDe(id); };
  const out = new Map<string, { colaboradorId: string; horas: number }[]>();
  for (const m of ativas) out.set(m.estacao, m.quem.map((id) => ({ colaboradorId: id, horas: Math.round((horasDe(id) / (vezes.get(id) ?? 1)) * 100) / 100 })).filter((c) => c.horas > 0));
  return out;
}

export interface EstadoFluxo { situacao: 'nao_iniciado' | 'rascunho' | 'fechado'; apontamento?: Apontamento; equipe: Colaborador[]; presentes: number; faltas: number; extras: number; kgEstacoes: number; estacoesHoje: number }
/** Situacao do dia de uma frente, para a tela inicial: sem diario, rascunho ou fechado, com os numeros do que ja foi lancado. */
export function estadoDoFluxo(ds: Dataset, data: string, frente: Frente, codigoObra?: string): EstadoFluxo {
  const local = LOCAL_DA_FRENTE[frente];
  const ap = apontamentoDoDia(ds, data, local, codigoObra);
  const est = (ds.apontamentosEstacao ?? []).filter((a) => a.data === data && a.linha === LINHA_DA_FRENTE[frente] && (frente === 'fabrica' || a.codigoObra === codigoObra));
  const presentes = ap?.linhas.filter((l) => l.presenca === 'Presente') ?? [];
  return {
    situacao: ap ? (ap.status === 'Fechado' ? 'fechado' : 'rascunho') : 'nao_iniciado', apontamento: ap, equipe: equipeDoLocal(ds, data, local, codigoObra),
    presentes: presentes.length, faltas: (ap?.linhas.length ?? 0) - presentes.length, extras: presentes.reduce((s, l) => s + l.horasExtras, 0),
    kgEstacoes: est.reduce((s, a) => s + a.pesoKg, 0), estacoesHoje: est.length,
  };
}

/** Rascunho do assistente: o diario em construcao mais as marcacoes de estacao, guardado no aparelho ate fechar. */
export interface RascunhoFluxo { passo: number; apontamento: Apontamento; marcacoes: MarcacaoEstacao[]; temperatura?: number; semExtras: boolean; semOcorrencias: boolean; estacoesRegistradas: boolean }
export function iniciarRascunho(ds: Dataset, data: string, frente: Frente, codigoObra: string | undefined, novo: () => Apontamento): RascunhoFluxo {
  const existente = apontamentoDoDia(ds, data, LOCAL_DA_FRENTE[frente], codigoObra);
  const ap = existente ?? novo();
  const { temperatura } = climaDe(ap.clima);
  return { passo: 0, apontamento: existente ? ap : { ...ap, linhas: ap.linhas.length ? ap.linhas : linhasPadrao(equipeDoLocal(ds, data, LOCAL_DA_FRENTE[frente], codigoObra)) }, marcacoes: marcacoesVazias(LINHA_DA_FRENTE[frente]), temperatura, semExtras: false, semOcorrencias: false, estacoesRegistradas: false };
}

export const AUSENCIAS: Presenca[] = ['Falta', 'Atestado', 'Férias', 'Folga'];
/** Marca ou desmarca uma ausencia: ausente zera horas; presente volta a jornada. */
export function alternarAusencia(linhas: ApontamentoLinha[], id: string, presenca: Presenca, jornada: number): ApontamentoLinha[] {
  return linhas.map((l) => (l.colaboradorId !== id ? l : presenca === 'Presente' ? { ...l, presenca, horas: jornada, horasExtras: 0 } : { ...l, presenca, horas: 0, horasExtras: 0 }));
}

/** Pendencias que impedem fechar: o que o assistente precisa que o gestor confirme. */
export function pendenciasDoFluxo(r: RascunhoFluxo, frente: Frente): string[] {
  const p: string[] = [];
  const a = r.apontamento;
  if (!a.linhas.length) p.push('Nenhuma pessoa no diário: adicione quem trabalhou.');
  if (frente === 'canteiro' && !climaDe(a.clima).clima) p.push('Informe o clima do canteiro.');
  if (!r.semExtras && !a.linhas.some((l) => l.horasExtras > 0)) p.push('Confirme se houve hora extra (ou marque "ninguém fez").');
  if (!r.semOcorrencias && !a.ocorrencias.length) p.push('Confirme se houve ocorrência (ou marque "nenhuma").');
  if (a.ocorrencias.some((o: ApontamentoOcorrencia) => !o.descricao.trim() && o.tipo === 'Outra')) p.push('Descreva a ocorrência do tipo "Outra".');
  if (r.marcacoes.some((m) => (m.pesoKg > 0 || m.pecas > 0) && !m.quem.length)) p.push('Marque quem trabalhou nas estações com produção.');
  return p;
}

// CD-D3/E5 — Metas e resultados no Command Center: modelo de exibição PURO do bloco `metaComercial` do snapshot CD-1.3.
//
// A tela não calcula indicador nenhum: cada número vem de uma medida do bloco (que é a apuração do motor E1). Aqui só se
// decide COMO mostrar — texto, tom e o estado da tela — e "—" com o motivo sempre que a medida não está disponível.
// Nunca 0 para "não sei". Sem relógio: o instante de referência chega pronto (capturado UMA vez pela tela).
import { FUSO_COMERCIAL, mesComercialDe, mesSeguinte, mesValido, type MesComercial } from '../../core/radar/metaComercial';
import type { BlocoMetaComercialCD } from '../../core/radar/commercialDirector';
import type { MedidaComercial } from '../../core/radar/commercialMetrics';
import { pode } from '../../core/permissoes';
import type { Usuario } from '../../core/types';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const INSTANTE = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_COMERCIAL, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "outubro de 2026" */
export function rotuloMes(mes: MesComercial): string {
  if (!mesValido(mes)) return mes;
  return `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
}

/** Instante de referência mostrado SEMPRE no fuso comercial (nunca o fuso da máquina): "14/10/2026 15:00 (São Paulo)". */
export function rotuloInstante(agoraIso: string): string {
  const ms = Date.parse(agoraIso);
  return Number.isFinite(ms) ? `${INSTANTE.format(ms).replace(',', '')} (horário de São Paulo)` : '—';
}

/** Meses do seletor, do mais recente ao mais antigo: `futuros` à frente do mês do instante e `passados` para trás. */
export function mesesDoSeletor(agoraIso: string, passados = 12, futuros = 3): MesComercial[] {
  const atual = mesComercialDe(agoraIso);
  if (!atual) return [];
  let ini = atual;
  for (let i = 0; i < passados; i++) ini = mesAnterior(ini);
  const out: MesComercial[] = [];
  for (let m = ini, i = 0; i <= passados + futuros; i++, m = mesSeguinte(m)) out.push(m);
  return out.reverse();
}
function mesAnterior(mes: MesComercial): MesComercial {
  const a = Number(mes.slice(0, 4)); const n = Number(mes.slice(5, 7));
  return n === 1 ? `${a - 1}-12` : `${a}-${String(n - 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado da tela
// ---------------------------------------------------------------------------------------------------------------------
export const ESTADOS_TELA_META = [
  'SEM_INSTANTE', 'METAS_INDISPONIVEIS', 'LIVRO_INDISPONIVEL', 'MES_FUTURO', 'SEM_META', 'META_RETIRADA', 'META_INVALIDA',
  'VALOR_INCOMPLETO', 'SEM_VENDAS', 'PARCIAL', 'ATINGIDA',
] as const;
export type EstadoTelaMeta = (typeof ESTADOS_TELA_META)[number];

const TITULO_ESTADO: Record<EstadoTelaMeta, string> = {
  SEM_INSTANTE: 'Sem instante de referência',
  METAS_INDISPONIVEIS: 'Metas indisponíveis',
  LIVRO_INDISPONIVEL: 'Livro de desfechos indisponível',
  MES_FUTURO: 'Mês ainda não começou',
  SEM_META: 'Sem meta definida',
  META_RETIRADA: 'Meta retirada',
  META_INVALIDA: 'Meta com problema',
  VALOR_INCOMPLETO: 'Ganhos sem valor confirmado',
  SEM_VENDAS: 'Meta vigente, nenhuma venda',
  PARCIAL: 'Meta parcialmente atingida',
  ATINGIDA: 'Meta atingida',
};

/**
 * Um estado por bloco, na ordem de gravidade: o que impede ler o resultado vem primeiro (sem instante, metas ou livro
 * indisponíveis), depois o que impede comparar (mês futuro, sem meta, retirada, inválida, valores incompletos) e só então
 * o resultado (sem vendas, parcial, atingida). Decidido pelos ESTADOS das medidas e pelo `metaVigente`, sem conta.
 */
export function estadoTelaMeta(b: BlocoMetaComercialCD): EstadoTelaMeta {
  const m = b.medidas;
  if (!b.disponibilidade.instante) return 'SEM_INSTANTE';
  if (!b.disponibilidade.metas) return 'METAS_INDISPONIVEIS';
  if (!b.disponibilidade.livro) return 'LIVRO_INDISPONIVEL';
  if (b.situacao === 'FUTURO') return 'MES_FUTURO';
  if (b.metaVigente?.estado === 'AUSENTE') return 'SEM_META';
  if (b.metaVigente?.estado === 'RETIRADA') return 'META_RETIRADA';
  if (b.metaVigente?.estado === 'INVALIDA') return 'META_INVALIDA';
  if (m.realizado.estado !== 'DISPONIVEL') return 'VALOR_INCOMPLETO';
  if (m.ganhos.valor === 0 && m.estornos.valor === 0) return 'SEM_VENDAS';
  return m.faltaParaMeta.estado === 'DISPONIVEL' && m.faltaParaMeta.valor === 0 ? 'ATINGIDA' : 'PARCIAL';
}

// ---------------------------------------------------------------------------------------------------------------------
// Modelo de exibição
// ---------------------------------------------------------------------------------------------------------------------
/** Um número da tela: o texto e, quando a medida não está disponível, "—" e o motivo (nunca 0). */
export interface ValorTela { texto: string; disponivel: boolean; motivo?: string; medidaId: string }

const dinheiro = (m: MedidaComercial): ValorTela => (m.estado === 'DISPONIVEL' ? { texto: BRL.format(m.valor!), disponivel: true, medidaId: m.id } : { texto: '—', disponivel: false, motivo: m.motivoInsuficiencia, medidaId: m.id });
const contagem = (m: MedidaComercial): ValorTela => (m.estado === 'DISPONIVEL' ? { texto: String(m.valor), disponivel: true, medidaId: m.id } : { texto: '—', disponivel: false, motivo: m.motivoInsuficiencia, medidaId: m.id });
const percentual = (m: MedidaComercial): ValorTela => (m.estado === 'DISPONIVEL' ? { texto: PCT.format(m.valor!), disponivel: true, medidaId: m.id } : { texto: '—', disponivel: false, motivo: m.motivoInsuficiencia, medidaId: m.id });

export interface VisaoMetaComercial {
  estado: EstadoTelaMeta;
  titulo: string;
  tom: 'ok' | 'warn' | 'bad' | undefined;
  mes?: MesComercial;
  meta: ValorTela;
  /** receita ganha líquida (medida meta.realizado) */
  receitaLiquida: ValorTela;
  /** piso conhecido quando o líquido exato não existe por falta de valor (medida meta.realizadoConfirmado) */
  pisoConhecido?: ValorTela;
  atingimento: ValorTela;
  /** fração 0..1 para a barra (só com atingimento disponível); nunca inventada */
  barra?: number;
  /** "Falta" ou "Excedente", conforme a medida do motor que for maior que zero */
  diferenca: { rotulo: 'Falta para a meta' | 'Excedente'; valor: ValorTela };
  ganhos: ValorTela;
  ganhosSemValor: ValorTela;
  estornos: ValorTela;
  valorEstornos: ValorTela;
  receitaGanha: ValorTela;
  retificacoes: ValorTela;
  eventosInconsistentes: ValorTela;
  /** alertas do motor com severidade ATENCAO (os INFO ficam nos detalhes) */
  atencao: number;
}

export function visaoMetaComercial(b: BlocoMetaComercialCD): VisaoMetaComercial {
  const m = b.medidas;
  const estado = estadoTelaMeta(b);
  const excedeu = m.excedente.estado === 'DISPONIVEL' && (m.excedente.valor ?? 0) > 0;
  const tom = estado === 'ATINGIDA' ? 'ok' : (['PARCIAL', 'SEM_VENDAS', 'MES_FUTURO'] as EstadoTelaMeta[]).includes(estado) ? undefined
    : (['LIVRO_INDISPONIVEL', 'METAS_INDISPONIVEIS', 'META_INVALIDA', 'SEM_INSTANTE'] as EstadoTelaMeta[]).includes(estado) ? 'bad' : 'warn';
  return {
    estado, titulo: TITULO_ESTADO[estado], tom, mes: b.mes,
    meta: dinheiro(m.meta),
    receitaLiquida: dinheiro(m.realizado),
    ...(m.realizado.estado !== 'DISPONIVEL' && m.realizadoConfirmado.estado === 'DISPONIVEL' ? { pisoConhecido: dinheiro(m.realizadoConfirmado) } : {}),
    atingimento: percentual(m.atingimento),
    ...(m.atingimento.estado === 'DISPONIVEL' ? { barra: Math.max(0, Math.min(1, m.atingimento.valor!)) } : {}),
    diferenca: excedeu ? { rotulo: 'Excedente', valor: dinheiro(m.excedente) } : { rotulo: 'Falta para a meta', valor: dinheiro(m.faltaParaMeta) },
    ganhos: contagem(m.ganhos),
    ganhosSemValor: contagem(m.ganhosSemValor),
    estornos: contagem(m.estornos),
    valorEstornos: dinheiro(m.valorEstornos),
    receitaGanha: dinheiro(m.valorGanhos),
    retificacoes: contagem(m.retificacoes),
    eventosInconsistentes: contagem(m.eventosInconsistentes),
    atencao: b.alertas.filter((a) => a.severidade === 'ATENCAO').length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Permissões da tela (a ação canônica repete tudo: a tela só esconde o que não vai passar)
// ---------------------------------------------------------------------------------------------------------------------
export interface EdicaoMeta { podeVer: boolean; podeEditar: boolean; podeRetirar: boolean; motivo?: string }

export function edicaoMeta(usuario: Usuario, b: BlocoMetaComercialCD): EdicaoMeta {
  const podeVer = pode(usuario, 'radar');
  if (!pode(usuario, 'radar_config')) return { podeVer, podeEditar: false, podeRetirar: false, motivo: 'Somente Administrador e Diretoria definem metas.' };
  if (!b.disponibilidade.instante || !b.mes) return { podeVer, podeEditar: false, podeRetirar: false, motivo: 'Sem instante de referência.' };
  if (!b.disponibilidade.metas) return { podeVer, podeEditar: false, podeRetirar: false, motivo: 'Metas indisponíveis neste banco.' };
  if (b.situacao === 'ENCERRADO') return { podeVer, podeEditar: false, podeRetirar: false, motivo: 'Mês encerrado: a meta não muda mais.' };
  return { podeVer, podeEditar: true, podeRetirar: b.metaVigente?.estado === 'VIGENTE' };
}

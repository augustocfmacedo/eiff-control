// CD-D3 / E1 — motor de cálculo da meta comercial (docs/commercial-director-1.0.md §19.1 e §19.7).
//
// Meta primária = RECEITA GANHA em BRL, mensal, no fuso America/Sao_Paulo, consolidada da organização (D3-E),
// versionada sem sobrescrita. Realizado = soma dos GANHOS do mês menos os ESTORNOS do mês (D3-A: o estorno conta no mês
// em que ocorre e mantém o vínculo com o ganho original). Ganho sem valor confirmado entra na quantidade, nunca no valor
// (ausência de valor não é zero); o complemento posterior do valor retifica o MÊS DO GANHO, com rastro (D3-B). Meta só
// para o mês corrente e os futuros (D3-C). Sem alertas de ritmo (D3-D).
//
// Entrada: versões de meta e EVENTOS DE DESFECHO (o livro imutável que a E3 vai gravar). Este módulo nunca lê a
// oportunidade (estágio, `valorEstimado`, probabilidade): estimativa não é venda realizada. Nada de faturamento
// financeiro aqui — receita ganha comercial e faturamento são medidas separadas.
//
// Puro: sem relógio (o instante de referência `agora` é sempre explícito), sem rede, sem persistência. Dinheiro em
// centavos inteiros; reais só na saída.
import { disponivel, insuficiente, naoAplicavel, type MedidaComercial, type UnidadeMedida } from './commercialMetrics';

/** Versão das regras de meta. Mudar fórmula, corte ou catálogo sobe esta versão. */
export const VERSAO_REGRAS_META = 'CD-D3-1.0';
export const FUSO_COMERCIAL = 'America/Sao_Paulo';
export const METRICA_META = 'RECEITA_GANHA';
export const MOEDA_META = 'BRL';
export const ESCOPO_META = 'ORGANIZACAO';
export const MOTIVO_META_MIN = 3;
export const MOTIVO_META_MAX = 500;
/**
 * Maior meta aceita: R$ 1.000.000.000.000,00 (1e14 centavos). O mesmo teto vale no banco (CHECK e RPC da 0068), e fica
 * com folga sobre o maior inteiro seguro em centavos (9.007.199.254.740.991), então meta, diferença e razão nunca perdem
 * precisão no cálculo.
 */
export const VALOR_MAXIMO_META = 1_000_000_000_000;
export const VALOR_MAXIMO_META_CENTAVOS = VALOR_MAXIMO_META * 100;

/** Mês comercial, `AAAA-MM`, no fuso America/Sao_Paulo. */
export type MesComercial = string;
/** Valor monetário como vem do banco (`numeric(18,2)`: número ou texto com ponto decimal). */
export type ValorBRL = number | string | null | undefined;

export interface VersaoMetaComercial {
  id: string;
  mes: MesComercial;
  metrica: typeof METRICA_META;
  moeda: typeof MOEDA_META;
  escopo: typeof ESCOPO_META;
  /** BRL com até 2 casas; `null` = meta retirada nesta versão */
  valor: ValorBRL;
  versao: number;
  substituiId?: string;
  motivo: string;
  definidaPor: string;
  /** instante ISO com fuso (Z ou ±hh:mm) */
  definidaEm: string;
}

export const TIPOS_EVENTO_DESFECHO = ['GANHO', 'ESTORNO_GANHO', 'COMPLEMENTO_VALOR'] as const;
export type TipoEventoDesfecho = (typeof TIPOS_EVENTO_DESFECHO)[number];

/** Um fato do livro de desfechos (imutável). Estorno e complemento apontam para o ganho original em `ganhoId`. */
export interface EventoDesfecho {
  id: string;
  tipo: TipoEventoDesfecho;
  oportunidadeId: string;
  empresaId: string;
  /** instante ISO com fuso (Z ou ±hh:mm) */
  ocorridoEm: string;
  /** GANHO: valor fechado confirmado (ausente = sem valor). COMPLEMENTO_VALOR: o valor que faltava. ESTORNO: ignorado. */
  valor?: ValorBRL;
  ganhoId?: string;
  /** congelados no evento (consolidação individual futura; a V1 é só da organização) */
  responsavelId?: string;
  donoContaId?: string;
  motivo?: string;
  registradoPor?: string;
}

// ------------------------------------------------------------------------------------------------ datas e fuso

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATA_CIVIL = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_COMERCIAL, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function partesLocais(ms: number) {
  const p = Object.fromEntries(FORMATO.formatToParts(ms).map((x) => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour), minuto: Number(p.minute), segundo: Number(p.second) };
}

/** Deslocamento do fuso comercial em minutos no instante (ex.: −180 para −03:00). */
function deslocamentoMinutos(ms: number): number {
  const p = partesLocais(ms);
  return Math.round((Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Instante ISO com fuso explícito → milissegundos; outro formato → `undefined` (nunca o fuso da máquina). */
export function instanteEmMs(valor: string | undefined): number | undefined {
  if (!valor || !INSTANTE.test(valor)) return undefined;
  // fração além do milissegundo é truncada explicitamente (nunca arredondada pelo motor de datas)
  const ms = Date.parse(valor.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * CD-D3/E3: instante em MICROSSEGUNDOS, só para ORDENAR e comparar eventos do livro. O banco grava o desfecho com
 * clock_timestamp() (microssegundos) e GANHO → ESTORNO → novo GANHO podem cair no mesmo milissegundo; com ms eles
 * empatavam e o desempate por tipo/id perdia a ordem real. O mês comercial continua vindo de `instanteEmMs`.
 */
export function instanteEmMicros(valor: string | undefined): number | undefined {
  const ms = instanteEmMs(valor);
  if (ms === undefined) return undefined;
  const fracao = /:\d{2}\.(\d+)/.exec(valor!)?.[1] ?? '';
  return ms * 1000 + Number((fracao + '000000').slice(3, 6));
}

export const mesValido = (mes: string): boolean => MES.test(mes);

/**
 * Mês comercial de um INSTANTE (convertido para America/Sao_Paulo) ou de uma data civil `AAAA-MM-DD` / mês `AAAA-MM`
 * (lidos como estão, sem conversão de fuso). Instante sem fuso explícito ou valor inválido → `undefined`.
 */
export function mesComercialDe(valor: string | undefined): MesComercial | undefined {
  if (!valor) return undefined;
  if (MES.test(valor)) return valor;
  if (DATA_CIVIL.test(valor)) return valor.slice(0, 7);
  const ms = instanteEmMs(valor);
  if (ms === undefined) return undefined;
  const p = partesLocais(ms);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}`;
}

/** Instante (UTC, ISO) da meia-noite do dia 1 do mês no fuso comercial. */
export function inicioDoMes(mes: MesComercial): string {
  const m = MES.exec(mes);
  if (!m) throw new Error(`mês comercial inválido: ${mes}`);
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  let t = base - deslocamentoMinutos(base) * 60_000;
  t = base - deslocamentoMinutos(t) * 60_000; // segunda passada: deslocamento no próprio instante local
  return new Date(t).toISOString();
}

export function mesSeguinte(mes: MesComercial): MesComercial {
  const m = MES.exec(mes);
  if (!m) throw new Error(`mês comercial inválido: ${mes}`);
  const a = Number(m[1]); const n = Number(m[2]);
  return n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}`;
}

/** Fim (exclusivo) do mês = início do mês seguinte. */
export const fimDoMes = (mes: MesComercial): string => inicioDoMes(mesSeguinte(mes));

export type SituacaoMes = 'FUTURO' | 'CORRENTE' | 'ENCERRADO';

export function situacaoDoMes(mes: MesComercial, agora: string): SituacaoMes {
  const atual = mesComercialDe(agora);
  if (!atual || !MES.test(mes)) throw new Error('mês ou instante de referência inválido');
  return mes > atual ? 'FUTURO' : mes === atual ? 'CORRENTE' : 'ENCERRADO';
}

// ------------------------------------------------------------------------------------------------ dinheiro

export type LeituraValor = { estado: 'AUSENTE' } | { estado: 'VALIDO'; centavos: number } | { estado: 'INVALIDO' };

/**
 * Lê um valor em BRL para centavos inteiros. Ausente (`null`, `undefined`, texto vazio) é AUSENTE — nunca zero.
 * Negativo, não numérico ou fora do inteiro seguro é INVALIDO. Mais de 2 casas: arredonda meio para cima na terceira
 * casa (1,005 → 1,01; 1,0049 → 1,00), feito sobre o texto decimal para não herdar erro de ponto flutuante.
 */
export function lerValor(valor: ValorBRL): LeituraValor {
  if (valor === null || valor === undefined) return { estado: 'AUSENTE' };
  let texto: string;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) return { estado: 'INVALIDO' };
    texto = /e/i.test(String(valor)) ? valor.toFixed(10) : String(valor);
  } else {
    texto = valor.trim();
    if (!texto) return { estado: 'AUSENTE' };
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) return { estado: 'INVALIDO' };
  const fracao = `${m[2] ?? ''}000`;
  const centavos = Number(m[1]) * 100 + Number(fracao.slice(0, 2)) + (Number(fracao[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(centavos) ? { estado: 'VALIDO', centavos } : { estado: 'INVALIDO' };
}

/** Centavos → reais (para a saída; a conta é sempre em centavos). */
export const reais = (centavos: number): number => centavos / 100;

/** O valor tem no máximo 2 casas decimais (sem arredondar nada)? */
export function ateDuasCasas(valor: ValorBRL): boolean {
  if (valor === null || valor === undefined) return true;
  const texto = typeof valor === 'number' ? (/e/i.test(String(valor)) ? valor.toFixed(10).replace(/0+$/, '') : String(valor)) : valor.trim();
  return /^\d+(\.\d{0,2})?$/.test(texto);
}

// ------------------------------------------------------------------------------------------------ metas

export interface InconsistenciaMeta {
  codigo: 'META_VERSAO_DUPLICADA' | 'META_DEFINIDA_APOS_ENCERRAMENTO' | 'META_VALOR_INVALIDO' | 'META_INSTANTE_INVALIDO';
  metaId: string;
  detalhe: string;
}

export interface MetaVigente {
  estado: 'VIGENTE' | 'RETIRADA' | 'AUSENTE' | 'INVALIDA';
  versao?: VersaoMetaComercial;
  centavos?: number;
  inconsistencias: InconsistenciaMeta[];
}

const doMesmoAlvo = (m: VersaoMetaComercial, mes: MesComercial) => m.mes === mes && m.metrica === METRICA_META && m.moeda === MOEDA_META && m.escopo === ESCOPO_META;

/**
 * Versão vigente da meta do mês, vista em `agora`: a de maior número entre as definidas até `agora`. Em mês
 * encerrado, versão definida depois do fim do mês é ignorada (D3-C: o histórico de um mês fechado não muda).
 */
export function metaVigenteDoMes(metas: readonly VersaoMetaComercial[], mes: MesComercial, agora: string): MetaVigente {
  const inconsistencias: InconsistenciaMeta[] = [];
  const agoraMs = instanteEmMs(agora);
  if (agoraMs === undefined) throw new Error('instante de referência inválido');
  const fimMs = Date.parse(fimDoMes(mes));
  const candidatas: VersaoMetaComercial[] = [];
  for (const m of metas.filter((x) => doMesmoAlvo(x, mes))) {
    const em = instanteEmMs(m.definidaEm);
    if (em === undefined) { inconsistencias.push({ codigo: 'META_INSTANTE_INVALIDO', metaId: m.id, detalhe: `definidaEm inválido: ${m.definidaEm}` }); continue; }
    if (em > agoraMs) continue; // ainda não existia no instante de referência
    if (em >= fimMs) { inconsistencias.push({ codigo: 'META_DEFINIDA_APOS_ENCERRAMENTO', metaId: m.id, detalhe: `versão ${m.versao} definida depois do fim de ${mes}` }); continue; }
    candidatas.push(m);
  }
  if (!candidatas.length) return { estado: 'AUSENTE', inconsistencias };
  const ordenadas = [...candidatas].sort((a, b) => b.versao - a.versao || (instanteEmMs(b.definidaEm)! - instanteEmMs(a.definidaEm)!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const vigente = ordenadas[0];
  for (const outra of ordenadas.slice(1)) {
    if (outra.versao === vigente.versao) inconsistencias.push({ codigo: 'META_VERSAO_DUPLICADA', metaId: outra.id, detalhe: `versão ${outra.versao} repetida; vale ${vigente.id}` });
  }
  const leitura = lerValor(vigente.valor);
  if (leitura.estado === 'AUSENTE') return { estado: 'RETIRADA', versao: vigente, inconsistencias };
  if (leitura.estado === 'INVALIDO' || leitura.centavos <= 0 || leitura.centavos > VALOR_MAXIMO_META_CENTAVOS) {
    inconsistencias.push({ codigo: 'META_VALOR_INVALIDO', metaId: vigente.id, detalhe: `valor ${String(vigente.valor)} não é uma meta positiva em BRL` });
    return { estado: 'INVALIDA', versao: vigente, inconsistencias };
  }
  return { estado: 'VIGENTE', versao: vigente, centavos: leitura.centavos, inconsistencias };
}

/** Próximo número de versão da meta do mês (1 quando não há nenhuma). */
export function proximaVersaoMeta(metas: readonly VersaoMetaComercial[], mes: MesComercial): number {
  return metas.filter((m) => doMesmoAlvo(m, mes)).reduce((max, m) => Math.max(max, m.versao), 0) + 1;
}

/**
 * Motivos para recusar uma nova versão de meta (lista vazia = pode). D3-C: só o mês corrente e os futuros. Valor
 * positivo em BRL com até 2 casas, ou `null` para retirar. Motivo de 3 a 500 caracteres.
 */
export function motivosRecusaNovaMeta(p: { mes: string; valor: ValorBRL; motivo?: string; agora: string }): string[] {
  const motivos: string[] = [];
  if (!MES.test(p.mes)) motivos.push('Mês inválido (use AAAA-MM).');
  else if (mesComercialDe(p.agora) === undefined) motivos.push('Instante de referência inválido.');
  else if (situacaoDoMes(p.mes, p.agora) === 'ENCERRADO') motivos.push('Meta só pode ser definida para o mês corrente ou para meses futuros.');
  if (p.valor !== null) {
    const l = lerValor(p.valor);
    if (l.estado !== 'VALIDO' || l.centavos <= 0) motivos.push('Informe uma meta positiva em reais (ou retire a meta).');
    else if (!ateDuasCasas(p.valor)) motivos.push('A meta aceita no máximo 2 casas decimais.');
    else if (l.centavos > VALOR_MAXIMO_META_CENTAVOS) motivos.push('A meta máxima é R$ 1.000.000.000.000,00.');
  }
  const n = (p.motivo ?? '').trim().length;
  if (n < MOTIVO_META_MIN || n > MOTIVO_META_MAX) motivos.push(`Informe o motivo (${MOTIVO_META_MIN} a ${MOTIVO_META_MAX} caracteres).`);
  return motivos;
}

// ------------------------------------------------------------------------------------------------ livro de desfechos

export const CODIGOS_INCONSISTENCIA_EVENTO = [
  'EVENTO_REPETIDO', 'EVENTO_REPETIDO_DIVERGENTE', 'TIPO_INVALIDO', 'INSTANTE_INVALIDO', 'VALOR_INVALIDO',
  'GANHO_REPETIDO', 'ESTORNO_SEM_GANHO', 'ESTORNO_REPETIDO', 'ESTORNO_ANTERIOR_AO_GANHO',
  'COMPLEMENTO_SEM_GANHO', 'COMPLEMENTO_SEM_VALOR', 'COMPLEMENTO_EM_GANHO_COM_VALOR', 'COMPLEMENTO_REPETIDO', 'COMPLEMENTO_ANTERIOR_AO_GANHO',
] as const;
export type CodigoInconsistenciaEvento = (typeof CODIGOS_INCONSISTENCIA_EVENTO)[number];

export interface InconsistenciaEvento { codigo: CodigoInconsistenciaEvento; eventoId: string; detalhe: string }

export interface GanhoApurado {
  id: string;
  oportunidadeId: string;
  empresaId: string;
  ocorridoEm: string;
  mes: MesComercial;
  /** valor confirmado no ganho, se houve */
  centavosNoGanho?: number;
  /** complemento posterior do valor (D3-B), atribuído ao mês do ganho */
  complemento?: { id: string; ocorridoEm: string; mes: MesComercial; centavos: number };
  estornadoPor?: string;
}

export interface EstornoApurado { id: string; ganhoId: string; oportunidadeId: string; ocorridoEm: string; mes: MesComercial }

export interface LivroDesfechos {
  ganhos: GanhoApurado[];
  estornos: EstornoApurado[];
  inconsistencias: InconsistenciaEvento[];
}

/** Valor do ganho para o realizado: o confirmado no ganho ou, sem ele, o complemento; nenhum = sem valor. */
export const centavosDoGanho = (g: GanhoApurado): number | undefined => g.centavosNoGanho ?? g.complemento?.centavos;

const ORDEM_TIPO: Record<TipoEventoDesfecho, number> = { GANHO: 0, COMPLEMENTO_VALOR: 1, ESTORNO_GANHO: 2 };
const canonico = (e: EventoDesfecho) => JSON.stringify(Object.keys(e).sort().map((k) => [k, (e as unknown as Record<string, unknown>)[k]]));

/**
 * Lê o livro de desfechos visto em `ate` (eventos depois dele não existem ainda). Cada evento conta uma vez: id
 * repetido é descartado; ganho repetido sem estorno no meio é descartado (sem dupla contagem); estorno precisa do
 * ganho ativo que ele cita; complemento só em ganho sem valor e uma vez. Tudo que é descartado vira inconsistência.
 */
export function lerLivroDesfechos(eventos: readonly EventoDesfecho[], ate?: string): LivroDesfechos {
  const inconsistencias: InconsistenciaEvento[] = [];
  const ateMs = ate === undefined ? undefined : instanteEmMicros(ate);
  if (ate !== undefined && ateMs === undefined) throw new Error('instante de referência inválido');

  // 1. validação e ordem determinística (instante, tipo, id, conteúdo)
  const validos: (EventoDesfecho & { ms: number })[] = [];
  for (const e of eventos) {
    if (!TIPOS_EVENTO_DESFECHO.includes(e.tipo)) { inconsistencias.push({ codigo: 'TIPO_INVALIDO', eventoId: e.id, detalhe: `tipo ${String(e.tipo)}` }); continue; }
    const ms = instanteEmMicros(e.ocorridoEm);
    if (ms === undefined) { inconsistencias.push({ codigo: 'INSTANTE_INVALIDO', eventoId: e.id, detalhe: `ocorridoEm ${e.ocorridoEm} sem fuso explícito ou inválido` }); continue; }
    if (ateMs !== undefined && ms > ateMs) continue; // ambos em microssegundos
    validos.push({ ...e, ms });
  }
  validos.sort((a, b) => a.ms - b.ms || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (canonico(a) < canonico(b) ? -1 : 1));

  // 2. cada id conta uma vez
  const vistos = new Map<string, string>();
  const unicos = validos.filter((e) => {
    const c = canonico(e);
    const anterior = vistos.get(e.id);
    if (anterior === undefined) { vistos.set(e.id, c); return true; }
    inconsistencias.push({ codigo: anterior === c ? 'EVENTO_REPETIDO' : 'EVENTO_REPETIDO_DIVERGENTE', eventoId: e.id, detalhe: anterior === c ? 'mesmo evento recebido de novo' : 'id repetido com conteúdo diferente; vale o primeiro' });
    return false;
  });

  // 3. máquina por oportunidade, em ordem de tempo
  const ganhos = new Map<string, GanhoApurado>();
  const ativoPorOportunidade = new Map<string, string>();
  const estornos: EstornoApurado[] = [];
  for (const e of unicos) {
    const mes = mesComercialDe(e.ocorridoEm)!;
    if (e.tipo === 'GANHO') {
      const ativo = ativoPorOportunidade.get(e.oportunidadeId);
      if (ativo) { inconsistencias.push({ codigo: 'GANHO_REPETIDO', eventoId: e.id, detalhe: `a oportunidade já tem o ganho ${ativo} ativo; não conta duas vezes` }); continue; }
      const l = lerValor(e.valor);
      if (l.estado === 'INVALIDO') { inconsistencias.push({ codigo: 'VALOR_INVALIDO', eventoId: e.id, detalhe: `valor ${String(e.valor)}` }); continue; }
      ganhos.set(e.id, { id: e.id, oportunidadeId: e.oportunidadeId, empresaId: e.empresaId, ocorridoEm: e.ocorridoEm, mes, ...(l.estado === 'VALIDO' ? { centavosNoGanho: l.centavos } : {}) });
      ativoPorOportunidade.set(e.oportunidadeId, e.id);
      continue;
    }
    const g = e.ganhoId ? ganhos.get(e.ganhoId) : undefined;
    if (e.tipo === 'ESTORNO_GANHO') {
      if (!g || g.oportunidadeId !== e.oportunidadeId) { inconsistencias.push({ codigo: 'ESTORNO_SEM_GANHO', eventoId: e.id, detalhe: `ganho ${e.ganhoId ?? '(não informado)'} não encontrado nesta oportunidade` }); continue; }
      if (g.estornadoPor) { inconsistencias.push({ codigo: 'ESTORNO_REPETIDO', eventoId: e.id, detalhe: `o ganho ${g.id} já foi estornado por ${g.estornadoPor}` }); continue; }
      if (e.ms < instanteEmMicros(g.ocorridoEm)!) { inconsistencias.push({ codigo: 'ESTORNO_ANTERIOR_AO_GANHO', eventoId: e.id, detalhe: `estorno antes do ganho ${g.id}` }); continue; }
      g.estornadoPor = e.id;
      if (ativoPorOportunidade.get(e.oportunidadeId) === g.id) ativoPorOportunidade.delete(e.oportunidadeId);
      estornos.push({ id: e.id, ganhoId: g.id, oportunidadeId: e.oportunidadeId, ocorridoEm: e.ocorridoEm, mes });
      continue;
    }
    // COMPLEMENTO_VALOR
    if (!g || g.oportunidadeId !== e.oportunidadeId) { inconsistencias.push({ codigo: 'COMPLEMENTO_SEM_GANHO', eventoId: e.id, detalhe: `ganho ${e.ganhoId ?? '(não informado)'} não encontrado nesta oportunidade` }); continue; }
    if (g.centavosNoGanho !== undefined) { inconsistencias.push({ codigo: 'COMPLEMENTO_EM_GANHO_COM_VALOR', eventoId: e.id, detalhe: `o ganho ${g.id} já tem valor confirmado` }); continue; }
    if (g.complemento) { inconsistencias.push({ codigo: 'COMPLEMENTO_REPETIDO', eventoId: e.id, detalhe: `o ganho ${g.id} já foi complementado por ${g.complemento.id}` }); continue; }
    if (e.ms < instanteEmMicros(g.ocorridoEm)!) { inconsistencias.push({ codigo: 'COMPLEMENTO_ANTERIOR_AO_GANHO', eventoId: e.id, detalhe: `complemento antes do ganho ${g.id}` }); continue; }
    const l = lerValor(e.valor);
    if (l.estado !== 'VALIDO') { inconsistencias.push({ codigo: l.estado === 'AUSENTE' ? 'COMPLEMENTO_SEM_VALOR' : 'VALOR_INVALIDO', eventoId: e.id, detalhe: `valor ${String(e.valor)}` }); continue; }
    g.complemento = { id: e.id, ocorridoEm: e.ocorridoEm, mes, centavos: l.centavos };
  }
  return { ganhos: [...ganhos.values()], estornos, inconsistencias };
}

// ------------------------------------------------------------------------------------------------ apuração do mês

export const CODIGOS_ALERTA_META = [
  'META_AUSENTE', 'META_RETIRADA', 'META_INCONSISTENTE', 'GANHOS_SEM_VALOR', 'ESTORNOS_SEM_VALOR', 'ESTORNO_NO_MES',
  'RETIFICACAO_POR_COMPLEMENTO', 'META_ATINGIDA', 'META_NAO_ATINGIDA', 'EVENTOS_INCONSISTENTES',
] as const;
export type CodigoAlertaMeta = (typeof CODIGOS_ALERTA_META)[number];

export interface AlertaMeta {
  codigo: CodigoAlertaMeta;
  severidade: 'INFO' | 'ATENCAO';
  mes: MesComercial;
  mensagem: string;
  /** ids das versões de meta ou dos eventos que sustentam o alerta */
  evidencias: string[];
}

export interface ApuracaoMetaComercial {
  versaoRegras: string;
  mes: MesComercial;
  situacao: SituacaoMes;
  /** instantes (UTC) que delimitam o mês no fuso comercial: [inicio, fim) */
  inicio: string;
  fim: string;
  /** instante de referência: tudo foi visto como estava nele */
  vistoEm: string;
  meta: MetaVigente;
  medidas: {
    meta: MedidaComercial;
    ganhos: MedidaComercial;
    ganhosSemValor: MedidaComercial;
    valorGanhos: MedidaComercial;
    estornos: MedidaComercial;
    estornosSemValor: MedidaComercial;
    valorEstornos: MedidaComercial;
    /** ganhos − estornos com valor conhecido (pode ser negativo) */
    realizadoConfirmado: MedidaComercial;
    /** o realizado exato: só DISPONIVEL sem ganho/estorno sem valor */
    realizado: MedidaComercial;
    /** realizado ÷ meta (razão; a amostra mínima de 30 não se aplica) */
    atingimento: MedidaComercial;
    faltaParaMeta: MedidaComercial;
    excedente: MedidaComercial;
  };
  ganhos: GanhoApurado[];
  estornos: (EstornoApurado & { mesDoGanho: MesComercial; centavos?: number })[];
  /** complementos (D3-B) que retificaram ESTE mês, com quando ocorreram */
  retificacoes: { ganhoId: string; oportunidadeId: string; complementoId: string; complementadoEm: string; mesDoComplemento: MesComercial; centavos: number }[];
  inconsistencias: { metas: InconsistenciaMeta[]; eventos: InconsistenciaEvento[] };
  alertas: AlertaMeta[];
}

const BRL: UnidadeMedida = 'BRL';
const def = (id: string, descricao: string, unidade: UnidadeMedida = BRL) => ({ id: `meta.${id}`, descricao, unidade, autoridade: 'META_COMERCIAL' as const });
const brl = (centavos: number) => reais(centavos).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Apura a meta comercial de UM mês, vista no instante `agora` (explícito). Ganho conta no mês em que ocorreu; estorno no
 * mês em que ocorreu (com o valor do ganho que estorna); complemento retifica o mês do ganho. Sem meta válida ou com
 * realizado incompleto, atingimento e diferença ficam DADO_INSUFICIENTE; mês futuro é NAO_APLICAVEL.
 */
export function apurarMetaComercial(entrada: { metas: readonly VersaoMetaComercial[]; eventos: readonly EventoDesfecho[]; mes: MesComercial; agora: string }): ApuracaoMetaComercial {
  const { mes, agora } = entrada;
  if (!MES.test(mes)) throw new Error(`mês comercial inválido: ${mes}`);
  if (instanteEmMs(agora) === undefined) throw new Error('instante de referência inválido (use ISO com fuso)');
  const situacao = situacaoDoMes(mes, agora);
  const meta = metaVigenteDoMes(entrada.metas, mes, agora);
  const livro = lerLivroDesfechos(entrada.eventos, agora);
  const ganhoPorId = new Map(livro.ganhos.map((g) => [g.id, g]));

  const ganhos = livro.ganhos.filter((g) => g.mes === mes);
  const semValor = ganhos.filter((g) => centavosDoGanho(g) === undefined);
  const valorGanhos = ganhos.reduce((s, g) => s + (centavosDoGanho(g) ?? 0), 0);
  const estornos = livro.estornos.filter((e) => e.mes === mes).map((e) => {
    const g = ganhoPorId.get(e.ganhoId)!;
    const c = centavosDoGanho(g);
    return { ...e, mesDoGanho: g.mes, ...(c === undefined ? {} : { centavos: c }) };
  });
  const estornosSemValor = estornos.filter((e) => e.centavos === undefined);
  const valorEstornos = estornos.reduce((s, e) => s + (e.centavos ?? 0), 0);
  const retificacoes = ganhos.filter((g) => g.complemento).map((g) => ({ ganhoId: g.id, oportunidadeId: g.oportunidadeId, complementoId: g.complemento!.id, complementadoEm: g.complemento!.ocorridoEm, mesDoComplemento: g.complemento!.mes, centavos: g.complemento!.centavos }));
  const confirmado = valorGanhos - valorEstornos;
  const completo = semValor.length === 0 && estornosSemValor.length === 0;
  const futuro = situacao === 'FUTURO';
  const NA = 'o mês ainda não começou';
  const incompleto = `realizado incompleto: ${semValor.length} ganho(s) e ${estornosSemValor.length} estorno(s) sem valor confirmado`;

  const dMeta = def('valor', 'meta de receita ganha do mês (versão vigente)');
  const medidaMeta = meta.estado === 'VIGENTE' ? disponivel(dMeta, reais(meta.centavos!))
    : insuficiente(dMeta, meta.estado === 'RETIRADA' ? `meta retirada (versão ${meta.versao!.versao})` : meta.estado === 'INVALIDA' ? 'a versão vigente da meta tem valor inválido' : 'sem meta definida para o mês');
  const contagem = (id: string, descricao: string, n: number) => futuro ? naoAplicavel(def(id, descricao, 'OPORTUNIDADES'), NA) : disponivel(def(id, descricao, 'OPORTUNIDADES'), n);
  const dinheiro = (id: string, descricao: string, c: number) => futuro ? naoAplicavel(def(id, descricao), NA) : disponivel(def(id, descricao), reais(c));

  const dReal = def('realizado', 'receita ganha líquida do mês (ganhos − estornos), exata');
  const realizado = futuro ? naoAplicavel(dReal, NA) : completo ? disponivel(dReal, reais(confirmado)) : insuficiente(dReal, incompleto);
  const comparavel = !futuro && completo && meta.estado === 'VIGENTE';
  const semComparacao = (id: string, descricao: string, unidade: UnidadeMedida = BRL) => futuro ? naoAplicavel(def(id, descricao, unidade), NA)
    : meta.estado !== 'VIGENTE' ? insuficiente(def(id, descricao, unidade), medidaMeta.motivoInsuficiencia ?? 'sem meta válida')
    : insuficiente(def(id, descricao, unidade), incompleto);
  const dAt = ['atingimento', 'realizado ÷ meta (razão; a amostra mínima de 30 não se aplica a meta)'] as const;
  const dFalta = ['faltaParaMeta', 'quanto falta para a meta (zero quando atingida)'] as const;
  const dExc = ['excedente', 'quanto o realizado passou da meta (zero quando não atingida)'] as const;

  const medidas: ApuracaoMetaComercial['medidas'] = {
    meta: medidaMeta,
    ganhos: contagem('ganhos', 'ganhos (WON) ocorridos no mês', ganhos.length),
    ganhosSemValor: contagem('ganhosSemValor', 'ganhos do mês sem valor confirmado nem complemento', semValor.length),
    valorGanhos: dinheiro('valorGanhos', 'soma dos valores confirmados dos ganhos do mês (com complementos)', valorGanhos),
    estornos: contagem('estornos', 'estornos de ganho ocorridos no mês', estornos.length),
    estornosSemValor: contagem('estornosSemValor', 'estornos do mês cujo ganho não tem valor confirmado', estornosSemValor.length),
    valorEstornos: dinheiro('valorEstornos', 'soma dos valores dos ganhos estornados no mês', valorEstornos),
    realizadoConfirmado: dinheiro('realizadoConfirmado', 'ganhos − estornos do mês com valor confirmado (piso conhecido)', confirmado),
    realizado,
    atingimento: comparavel ? disponivel(def(...dAt, 'RAZAO'), confirmado / meta.centavos!) : semComparacao(...dAt, 'RAZAO'),
    faltaParaMeta: comparavel ? disponivel(def(...dFalta), reais(Math.max(meta.centavos! - confirmado, 0))) : semComparacao(...dFalta),
    excedente: comparavel ? disponivel(def(...dExc), reais(Math.max(confirmado - meta.centavos!, 0))) : semComparacao(...dExc),
  };

  // alertas: só fatos (D3-D: sem ritmo)
  const alertas: AlertaMeta[] = [];
  const alerta = (codigo: CodigoAlertaMeta, severidade: AlertaMeta['severidade'], mensagem: string, evidencias: string[]) => alertas.push({ codigo, severidade, mes, mensagem, evidencias });
  if (situacao !== 'ENCERRADO' && meta.estado === 'AUSENTE') alerta('META_AUSENTE', 'ATENCAO', `${mes} não tem meta de receita ganha definida.`, []);
  if (situacao !== 'ENCERRADO' && meta.estado === 'RETIRADA') alerta('META_RETIRADA', 'ATENCAO', `A meta de ${mes} foi retirada (versão ${meta.versao!.versao}).`, [meta.versao!.id]);
  if (meta.estado === 'INVALIDA' || meta.inconsistencias.length) alerta('META_INCONSISTENTE', 'ATENCAO', `Versões de meta de ${mes} com problema: ${meta.inconsistencias.map((i) => i.codigo).join(', ') || 'valor inválido'}.`, meta.inconsistencias.map((i) => i.metaId));
  if (semValor.length) alerta('GANHOS_SEM_VALOR', 'ATENCAO', `${semValor.length} ganho(s) de ${mes} sem valor confirmado: o realizado exato fica incompleto até o valor ser complementado.`, semValor.map((g) => g.id));
  if (estornosSemValor.length) alerta('ESTORNOS_SEM_VALOR', 'ATENCAO', `${estornosSemValor.length} estorno(s) em ${mes} de ganho sem valor confirmado.`, estornosSemValor.map((e) => e.id));
  if (estornos.length) alerta('ESTORNO_NO_MES', 'INFO', `${estornos.length} ganho(s) estornado(s) em ${mes} (${brl(valorEstornos)} com valor conhecido), de ${[...new Set(estornos.map((e) => e.mesDoGanho))].sort().join(', ')}.`, estornos.map((e) => e.id));
  if (retificacoes.length) alerta('RETIFICACAO_POR_COMPLEMENTO', 'INFO', `${retificacoes.length} valor(es) de ganho de ${mes} complementado(s) depois (${retificacoes.map((r) => r.complementadoEm.slice(0, 10)).join(', ')}).`, retificacoes.map((r) => r.complementoId));
  if (comparavel && confirmado >= meta.centavos!) alerta('META_ATINGIDA', 'INFO', `Meta de ${mes} atingida: ${brl(confirmado)} de ${brl(meta.centavos!)}.`, [meta.versao!.id]);
  if (comparavel && situacao === 'ENCERRADO' && confirmado < meta.centavos!) alerta('META_NAO_ATINGIDA', 'ATENCAO', `Meta de ${mes} não atingida: ${brl(confirmado)} de ${brl(meta.centavos!)} (faltaram ${brl(meta.centavos! - confirmado)}).`, [meta.versao!.id]);
  if (livro.inconsistencias.length) alerta('EVENTOS_INCONSISTENTES', 'ATENCAO', `${livro.inconsistencias.length} evento(s) de desfecho desconsiderado(s) por inconsistência.`, livro.inconsistencias.map((i) => i.eventoId));

  return {
    versaoRegras: VERSAO_REGRAS_META, mes, situacao, inicio: inicioDoMes(mes), fim: fimDoMes(mes), vistoEm: agora, meta, medidas,
    ganhos, estornos, retificacoes, inconsistencias: { metas: meta.inconsistencias, eventos: livro.inconsistencias }, alertas,
  };
}

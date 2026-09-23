// UX-P01 — Financeiro compacto: view-model puro do piloto (somente leitura). Rodada 2.
//
// Filosofia: SITUACAO (como estamos) → ATENCAO (o que exige olhar: o que aconteceu, impacto, severidade, proximo passo)
// → COMPOSICAO (detalhe apenas quando pedido) → FRESCOR (microinformacao: base, extrato ate, atualizado ha).
//
// Este modulo NAO calcula nada financeiro. Ele SELECIONA, AGRUPA, ORDENA, ROTULA e PRIORIZA visualmente o que o motor
// ja devolve: `dashboard()`, `posicaoBancaria()`, `calcLancamentos()` (situacao, saldo aberto, dias de atraso),
// `reservaVinculadaTotal()`, `slaVencido()`, `saldoBancarioHoje()`/`defasagemExtrato()` (Diretor Financeiro),
// `sugestoesPara()` e `pode()`. Toda linha de composicao e uma linha canonica escolhida pelo campo canonico
// (ex.: `situacao === 'Atrasado'`), e o teste de paridade prova que a soma das linhas escolhidas e o proprio agregado do
// motor. Valor ausente e `null`, nunca zero. Conceitos distintos nunca se fundem num unico numero.
//
// CRITERIO DE APRESENTACAO (nao e regra financeira): cada item de atencao nasce de UMA condicao canonica ja existente
// (alerta do Painel, do Diretor Financeiro, check do motor ou sugestao do core) e recebe um `tom`, que e a SEVERIDADE
// canonica desse alerta. O grupo e apenas o rotulo dessa severidade — bad → "Precisa de acao", warn → "Atencao",
// info/ok → "Acompanhar" — sem derivar prazo, horizonte ou urgencia temporal; a ordem dentro de cada grupo preserva a
// ordem de origem. Nao ha score, peso nem soma de criterios.
import { calcLancamentos, dashboard, fmtBr, posicaoBancaria, reservaVinculadaTotal, slaVencido, type Dashboard, type LancamentoCalc, type PosicaoConta } from '../../core/engine';
import { defasagemExtrato, saldoBancarioHoje } from '../../core/cfo';
import { pode } from '../../core/permissoes';
import { sugestoesPara } from '../../core/sugestoes';
import type { Aprovacao, Dataset, Usuario } from '../../core/types';

export const VERSAO_PILOTO = 'UX-P01.3';
/** Teto do bloco SITUACAO por visao: o menor conjunto que ajuda a decidir. */
export const TETO_SITUACAO: Record<Visao, number> = { executivo: 3, operacional: 4 };
/** Teto da lista compacta de ATENCAO; o restante fica acessivel por "Ver todas". */
export const TETO_ATENCAO = 6;
export const TEXTO_RESTRITO = 'restrito (ver_bancos)';
export const TEXTO_SEM_EXTRATO = 'sem extrato';
export const TEXTO_SEM_BASE = 'sem base';

export type Visao = 'executivo' | 'operacional';
export const VISOES: { id: Visao; rotulo: string; descricao: string }[] = [
  { id: 'executivo', rotulo: 'Executivo', descricao: 'Caixa hoje, menor saldo projetado e vencidos: decide se o dinheiro cabe.' },
  { id: 'operacional', rotulo: 'Operacional', descricao: 'Vencidos, próximos 7 dias e pendências a destravar: decide o que fazer hoje.' },
];

export type Tom = 'bad' | 'warn' | 'info' | 'ok';
const ORDEM_TOM: Record<Tom, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
export type Severidade = 'acao' | 'atencao' | 'acompanhar';
/** Rotulo da severidade canonica (o tom do alerta); unico criterio de agrupamento, sem horizonte temporal. */
export const SEVERIDADE_POR_TOM: Record<Tom, Severidade> = { bad: 'acao', warn: 'atencao', info: 'acompanhar', ok: 'acompanhar' };
export const ROTULO_SEVERIDADE: Record<Severidade, string> = { acao: 'Precisa de ação', atencao: 'Atenção', acompanhar: 'Acompanhar' };
const ORDEM_SEVERIDADE: Severidade[] = ['acao', 'atencao', 'acompanhar'];
/** Sugestoes do painel (core) que este bloco ja apresenta pelo proprio campo do dashboard: nao repetir a mesma pendencia. */
const SUGESTOES_COBERTAS: Record<string, string> = { 'sla-aprovacoes': 'aprovacoes', 'sem-conciliacao': 'sem-conciliacao' };

export interface FonteDados {
  rotulo: string;
  modo: 'teste' | 'local' | 'remoto';
  /** Quando a fonte foi sincronizada/gerada (ISO). Ausente = desconhecido, e isso e dito na tela. */
  atualizadoEm?: string;
  id?: string;
}

export type EntradaPiloto =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'pronto'; fonte: FonteDados; ds: Dataset; usuario: Usuario; agora: string; visao?: Visao };

/** De onde o numero veio: funcao canonica, campo e a tela do EIFF Control que ja mostra o conjunto. */
export interface Origem { funcao: string; campo: string; regra: string; tela?: string }

export interface ParteSituacao { rotulo: string; valor: number | null; texto: string; tom?: Tom }
export interface ItemSituacao {
  id: 'caixa' | 'menor-saldo' | 'vencido' | 'proximos-7' | 'pendencias';
  rotulo: string;
  /** Valor principal; `null` = ausente (sem base ou restrito) e a tela mostra `texto`, nunca zero. */
  valor: number | null;
  texto: string;
  tom?: Tom;
  /** Microinformacao logo abaixo do valor (ex.: "S10 · 25/nov"), ja curta. */
  micro?: string;
  /** Partes separadas quando o item reune conceitos distintos (ex.: a receber × a pagar). Nunca somadas. */
  partes: ParteSituacao[];
  origem: Origem;
  composicaoId?: string;
}

export interface ItemAtencao {
  id: string;
  tom: Tom;
  severidade: Severidade;
  /** O que aconteceu, em uma frase curta. */
  texto: string;
  /** Impacto em poucas palavras, sempre com dado canonico (valor, contagem ou dias). */
  impacto: string;
  detalhe?: string;
  valor?: number | null;
  quantidade?: number;
  origem: Origem;
  /** Proximo passo disponivel: so leitura ("Ver pendencias", "Ver projecao", "Ver origem"). */
  destino?: { rotulo: string; to: string };
  composicaoId?: string;
}

export interface GrupoAtencao { severidade: Severidade; rotulo: string; itens: ItemAtencao[] }

export interface LinhaComposicao { id: string; titulo: string; sub?: string; data?: string; valor: number | null; texto: string; tom?: Tom; to?: string }
export interface Composicao {
  id: string;
  titulo: string;
  resumo: string;
  origem: Origem;
  colunas: { titulo: string; num?: boolean }[];
  linhas: LinhaComposicao[];
  total?: { rotulo: string; valor: number; texto: string };
  serie?: { valores: number[]; rotulos: string[]; referencia?: number; destaque?: number };
}

export interface ChipFrescor { id: string; texto: string; tom?: Tom; titulo?: string }
export interface Frescor {
  dataBase: string;
  periodo: { de: string; ate: string; rotulo: string };
  cenario: string;
  extratoAte?: string;
  diasExtrato?: number;
  fonteAtualizadaEm?: string;
  desatualizado: boolean;
  motivos: string[];
  /** Microinformacao contextual: "Base 23/09", "Extrato até 19/09 · 4 d", "Atualizado há 3 h". */
  chips: ChipFrescor[];
}

export type ModeloPiloto =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'vazio'; fonte: FonteDados; motivo: string; frescor: Frescor }
  | {
      estado: 'pronto';
      fonte: FonteDados;
      visao: Visao;
      empresa: string;
      usuario: { nome: string; papel: string; veBancos: boolean };
      situacao: ItemSituacao[];
      atencao: { compacta: ItemAtencao[]; todas: ItemAtencao[]; ocultas: number; grupos: GrupoAtencao[]; gruposCompactos: GrupoAtencao[] };
      composicoes: Record<string, Composicao>;
      frescor: Frescor;
    };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : brl.format(v));
const n = (q: number, s: string, p: string) => `${q} ${q === 1 ? s : p}`;
/** dd/mm sem ano, para microinformacao. */
export const diaMes = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

/** "agora", "há 5 min", "há 3 h", "há 8 d": distancia entre dois instantes ISO, sem regra de negocio. */
export function tempoRelativo(iso: string | undefined, agora: string): string {
  if (!iso) return 'desconhecido';
  const ms = Date.parse(agora) - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'desconhecido';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

function frescorDe(ds: Dataset, d: Dashboard | undefined, fonte: FonteDados, agora: string): Frescor {
  const def = defasagemExtrato(ds);
  const periodos = d?.fluxo13.periodos ?? [];
  const de = periodos[0]?.ini ?? ds.params.dataBase;
  const ate = periodos[periodos.length - 1]?.fim ?? ds.params.dataBase;
  const motivos: string[] = [];
  if (def.alerta) motivos.push(def.alerta);
  if (!fonte.atualizadoEm) motivos.push('Momento da última atualização da fonte desconhecido.');
  const diasExtrato = Number.isFinite(def.dias) ? def.dias : undefined;
  const chips: ChipFrescor[] = [
    { id: 'base', texto: `Base ${diaMes(ds.params.dataBase)}`, titulo: `Data-base ${fmtBr(ds.params.dataBase)} · cenário ${ds.params.cenario}` },
    def.ate
      ? { id: 'extrato', texto: `Extrato até ${diaMes(def.ate)}${diasExtrato ? ` · ${diasExtrato} d` : ''}`, tom: def.alerta ? 'warn' : undefined, titulo: def.alerta ?? `Último movimento do extrato em ${fmtBr(def.ate)}` }
      : { id: 'extrato', texto: 'Sem extrato', tom: 'warn', titulo: def.alerta },
    fonte.atualizadoEm
      ? { id: 'atualizado', texto: `Atualizado ${tempoRelativo(fonte.atualizadoEm, agora)}`, titulo: `Fonte ${fonte.rotulo} · ${new Date(fonte.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` }
      : { id: 'atualizado', texto: 'Atualização desconhecida', tom: 'warn', titulo: 'A fonte não informou quando foi sincronizada.' },
  ];
  return {
    dataBase: ds.params.dataBase,
    periodo: { de, ate, rotulo: periodos.length ? `${diaMes(de)}–${diaMes(ate)} · 13 sem.` : `base ${diaMes(ds.params.dataBase)} · sem projeção` },
    cenario: ds.params.cenario,
    extratoAte: def.ate,
    diasExtrato,
    fonteAtualizadaEm: fonte.atualizadoEm,
    desatualizado: motivos.length > 0,
    motivos,
    chips,
  };
}

const linhaLanc = (l: LancamentoCalc): LinhaComposicao => ({
  id: l.id,
  titulo: l.contraparte || l.descricao,
  sub: `${l.descricao}${l.codigoObra ? ` · ${l.codigoObra}` : ''}${l.diasAtraso ? ` · ${l.diasAtraso} d de atraso` : ''}${l.saldoAberto !== l.valorLiquidoPrevisto ? ` · saldo aberto ${moeda(l.saldoAberto)}` : ''}`,
  data: l.vencimento,
  valor: l.valorLiquidoPrevisto,
  texto: moeda(l.valorLiquidoPrevisto),
  tom: l.situacao === 'Atrasado' ? 'bad' : undefined,
  to: `/lancamentos/${l.id}`,
});

/** Mesmo recorte do painel (`somaSit` em engine.ts): oficial, nao direto, situacao pedida. So selecao. */
const porSituacao = (lancs: LancamentoCalc[], tipo: 'Entrada' | 'Saída', situacao: LancamentoCalc['situacao']) =>
  lancs.filter((l) => l.tipo === tipo && l.situacao === situacao && l.oficial && !l.direto);

function composicaoLancamentos(id: string, titulo: string, ls: LancamentoCalc[], agregado: number, origem: Origem): Composicao {
  const linhas = ls.slice().sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.id.localeCompare(b.id))).map(linhaLanc);
  return {
    id, titulo, origem,
    resumo: `${n(ls.length, 'título', 'títulos')} · ${moeda(agregado)}`,
    colunas: [{ titulo: 'Contraparte' }, { titulo: 'Vencimento' }, { titulo: 'Valor previsto', num: true }],
    linhas,
    total: { rotulo: 'Total (agregado do motor)', valor: agregado, texto: moeda(agregado) },
  };
}

function composicaoCaixa(posicao: PosicaoConta[], total: number): Composicao {
  return {
    id: 'caixa',
    titulo: 'Caixa hoje por conta',
    resumo: `${n(posicao.length, 'conta ativa', 'contas ativas')} · abertura + créditos − débitos do extrato`,
    origem: { funcao: 'posicaoBancaria(ds)', campo: 'saldoBancario por conta', regra: 'abertura da conta + créditos − débitos do extrato desde a abertura (nunca antes do corte)', tela: '/posicao' },
    colunas: [{ titulo: 'Conta · abertura + créditos − débitos' }, { titulo: 'Extrato até' }, { titulo: 'Saldo bancário', num: true }],
    linhas: posicao.map((p) => ({
      id: p.conta.id,
      titulo: p.conta.instituicao,
      sub: `${moeda(p.saldoInicial)} +${moeda(p.creditosBanco)} −${moeda(p.debitosBanco)}${p.transacoesPendentes ? ` · ${n(p.transacoesPendentes, 'movimento sem lançamento', 'movimentos sem lançamento')}` : ''}`,
      data: p.ultimaTransacao,
      valor: p.saldoBancario,
      texto: moeda(p.saldoBancario),
      tom: p.transacoesPendentes ? 'warn' : undefined,
    })),
    total: { rotulo: 'Saldo bancário hoje', valor: total, texto: moeda(total) },
  };
}

function composicaoProjecao(d: Dashboard, reserva: number): Composicao {
  const idx = d.fluxo13.saldoFinal.indexOf(d.menorSaldo13s);
  return {
    id: 'menor-saldo',
    titulo: 'Saldo projetado por semana',
    resumo: `menor ${moeda(d.menorSaldo13s)}${idx >= 0 ? ` na ${d.fluxo13.periodos[idx]?.rotulo}` : ''} · reserva ${moeda(reserva)}`,
    origem: { funcao: 'dashboard(ds).fluxo13', campo: 'saldoFinal[semana] · menorSaldo13s · necessidadeMaxima', regra: 'saldo inicial da data-base + entradas − saídas previstas por vencimento, no cenário dos parâmetros', tela: '/fluxo13' },
    colunas: [{ titulo: 'Semana · entradas / saídas' }, { titulo: 'Início' }, { titulo: 'Saldo final', num: true }],
    linhas: d.fluxo13.periodos.map((p, i) => ({
      id: p.ini,
      titulo: p.rotulo,
      sub: `+${moeda(d.fluxo13.totalEntradas[i])} · −${moeda(d.fluxo13.totalSaidas[i])}`,
      data: p.ini,
      valor: d.fluxo13.saldoFinal[i],
      texto: moeda(d.fluxo13.saldoFinal[i]),
      tom: d.fluxo13.saldoFinal[i] < reserva ? (d.fluxo13.saldoFinal[i] < 0 ? 'bad' : 'warn') : undefined,
    })),
    serie: { valores: d.fluxo13.saldoFinal, rotulos: d.fluxo13.periodos.map((p) => p.rotulo), referencia: reserva, destaque: idx },
  };
}

function composicaoAprovacoes(aprs: Aprovacao[], agora: string): Composicao {
  const pend = aprs.filter((a) => a.status === 'Pendente');
  return {
    id: 'aprovacoes',
    titulo: 'Aprovações pendentes',
    resumo: `${n(pend.length, 'pedido', 'pedidos')} · ${pend.filter((a) => slaVencido(a, agora)).length} com SLA vencido`,
    origem: { funcao: 'dashboard(ds)', campo: 'aprovacoesPendentes · aprovacoesSlaVencido', regra: "aprovacoes com status 'Pendente'; SLA vencido = prazoSla < agora (slaVencido)", tela: '/aprovacoes' },
    colunas: [{ titulo: 'Pedido · tipo · etapa atual' }, { titulo: 'Prazo do SLA' }, { titulo: 'Valor', num: true }],
    linhas: pend.map((a) => {
      const etapa = a.etapas.find((e) => e.status === 'Pendente');
      const venc = slaVencido(a, agora);
      return { id: a.id, titulo: a.titulo, sub: `${a.tipo} · ${a.solicitante} · etapa ${etapa?.papel ?? '—'}${venc ? ' · SLA vencido' : ''}`, data: a.prazoSla.slice(0, 10), valor: a.valor, texto: moeda(a.valor), tom: venc ? 'bad' : 'warn', to: '/aprovacoes' };
    }),
  };
}

function composicaoSemConciliacao(lancs: LancamentoCalc[]): Composicao {
  const ls = lancs.filter((l) => l.oficial && l.status === 'Realizado' && !l.vinculoBancario);
  return {
    id: 'sem-conciliacao',
    titulo: 'Realizados sem transação do extrato',
    resumo: n(ls.length, 'lançamento realizado sem vínculo bancário', 'lançamentos realizados sem vínculo bancário'),
    origem: { funcao: 'dashboard(ds)', campo: 'realizadosSemConciliacao', regra: "oficial, status 'Realizado' e sem transacao do extrato vinculada (vinculoBancario)", tela: '/conciliacao' },
    colunas: [{ titulo: 'Contraparte' }, { titulo: 'Realização' }, { titulo: 'Realizado', num: true }],
    linhas: ls.map((l) => ({ id: l.id, titulo: l.contraparte, sub: `${l.descricao} · ${l.contaFinanceira}`, data: l.realizacao ?? l.vencimento, valor: l.valorRealizadoTotal, texto: moeda(l.valorRealizadoTotal), to: `/lancamentos/${l.id}` })),
  };
}

function ordenarAtencao(itens: ItemAtencao[]): ItemAtencao[] {
  // ordenacao estavel por tom; dentro do tom preserva a ordem de origem (nao ha score nem peso)
  return itens.map((it, i) => ({ it, i })).sort((a, b) => ORDEM_TOM[a.it.tom] - ORDEM_TOM[b.it.tom] || a.i - b.i).map((x) => x.it);
}

export function agruparPorSeveridade(itens: ItemAtencao[]): GrupoAtencao[] {
  return ORDEM_SEVERIDADE.map((u) => ({ severidade: u, rotulo: ROTULO_SEVERIDADE[u], itens: itens.filter((i) => i.severidade === u) })).filter((g) => g.itens.length > 0);
}

const item = (base: Omit<ItemAtencao, 'severidade'>): ItemAtencao => ({ ...base, severidade: SEVERIDADE_POR_TOM[base.tom] });

export function montarPiloto(entrada: EntradaPiloto): ModeloPiloto {
  if (entrada.estado === 'carregando') return { estado: 'carregando', fonte: entrada.fonte };
  if (entrada.estado === 'erro') return { estado: 'erro', fonte: entrada.fonte, mensagem: entrada.mensagem, causa: entrada.causa };
  const { ds, usuario, fonte, agora } = entrada;
  const visao: Visao = entrada.visao ?? 'executivo';
  const lancs = calcLancamentos(ds);
  const contasAtivas = ds.contas.filter((c) => c.ativa);
  const oficiais = lancs.filter((l) => l.oficial && l.status !== 'Cancelado');
  if (contasAtivas.length === 0 && oficiais.length === 0) {
    return { estado: 'vazio', fonte, motivo: 'Nenhuma conta financeira ativa e nenhum lançamento oficial nesta fonte.', frescor: frescorDe(ds, undefined, fonte, agora) };
  }
  const d = dashboard(ds);
  const posicao = posicaoBancaria(ds, lancs);
  const veBancos = pode(usuario, 'ver_bancos');
  const reservaMin = ds.params.reservaMinima;
  const reservaVinc = reservaVinculadaTotal(ds);
  const frescor = frescorDe(ds, d, fonte, agora);
  const saldoBancario = posicao.length ? saldoBancarioHoje(ds, lancs) : null;
  const idxMenor = d.fluxo13.saldoFinal.indexOf(d.menorSaldo13s);
  const semanaMenor = idxMenor >= 0 ? d.fluxo13.periodos[idxMenor]?.rotulo ?? '' : '';

  const recAtras = porSituacao(lancs, 'Entrada', 'Atrasado');
  const pagAtras = porSituacao(lancs, 'Saída', 'Atrasado');
  const rec7 = porSituacao(lancs, 'Entrada', 'Próximos 7 dias');
  const pag7 = porSituacao(lancs, 'Saída', 'Próximos 7 dias');
  const naoLancadas = posicao.reduce((a, p) => a + p.transacoesPendentes, 0);

  const composicoes: Record<string, Composicao> = {};
  if (veBancos && saldoBancario !== null) composicoes.caixa = composicaoCaixa(posicao, saldoBancario);
  if (veBancos) composicoes['menor-saldo'] = composicaoProjecao(d, reservaMin);
  composicoes['vencido-receber'] = composicaoLancamentos('vencido-receber', 'Recebíveis vencidos', recAtras, d.recebiveisVencidos, { funcao: 'dashboard(ds)', campo: 'recebiveisVencidos', regra: "somaSit('Entrada', 'Atrasado'): oficial, não direto, vencimento anterior à data-base", tela: '/receber?situacao=Atrasado' });
  composicoes['vencido-pagar'] = composicaoLancamentos('vencido-pagar', 'Pagamentos vencidos', pagAtras, d.pagamentosVencidos, { funcao: 'dashboard(ds)', campo: 'pagamentosVencidos', regra: "somaSit('Saída', 'Atrasado'): oficial, não direto, vencimento anterior à data-base", tela: '/pagar?situacao=Atrasado' });
  composicoes['proximos-7-receber'] = composicaoLancamentos('proximos-7-receber', 'Entradas nos próximos 7 dias', rec7, d.proximos7DiasEntradas, { funcao: 'dashboard(ds)', campo: 'proximos7DiasEntradas', regra: "somaSit('Entrada', 'Próximos 7 dias'): vencimento entre a data-base e +7 dias", tela: '/receber?situacao=Pr%C3%B3ximos+7+dias' });
  composicoes['proximos-7-pagar'] = composicaoLancamentos('proximos-7-pagar', 'Saídas nos próximos 7 dias', pag7, d.proximos7DiasSaidas, { funcao: 'dashboard(ds)', campo: 'proximos7DiasSaidas', regra: "somaSit('Saída', 'Próximos 7 dias'): vencimento entre a data-base e +7 dias", tela: '/pagar?situacao=Pr%C3%B3ximos+7+dias' });
  composicoes.aprovacoes = composicaoAprovacoes(ds.aprovacoes, agora);
  composicoes['sem-conciliacao'] = composicaoSemConciliacao(lancs);

  // ---- SITUACAO: os mesmos campos canonicos em dois recortes; nada e calculado aqui ----
  const caixa: ItemSituacao = {
    id: 'caixa',
    rotulo: 'Caixa hoje',
    valor: veBancos ? saldoBancario : null,
    texto: !veBancos ? TEXTO_RESTRITO : saldoBancario === null ? TEXTO_SEM_BASE : moeda(saldoBancario),
    tom: !veBancos || saldoBancario === null ? undefined : frescor.extratoAte === undefined ? 'warn' : saldoBancario < reservaMin + reservaVinc ? 'bad' : undefined,
    micro: !veBancos ? undefined : frescor.extratoAte ? `extrato até ${diaMes(frescor.extratoAte)}` : TEXTO_SEM_EXTRATO,
    partes: veBancos ? [{ rotulo: 'Reserva mínima', valor: reservaMin, texto: moeda(reservaMin) }, { rotulo: 'Reserva vinculada', valor: reservaVinc, texto: moeda(reservaVinc) }] : [],
    origem: { funcao: 'posicaoBancaria(ds)', campo: 'Σ saldoBancario das contas ativas', regra: 'o mesmo número do KPI "Saldo bancário hoje" da Posição diária; nunca da projeção nem de lançamentos não baixados', tela: veBancos ? '/posicao' : undefined },
    composicaoId: veBancos && saldoBancario !== null ? 'caixa' : undefined,
  };
  const menorSaldo: ItemSituacao = {
    id: 'menor-saldo',
    rotulo: 'Menor saldo · 13 sem.',
    valor: veBancos ? d.menorSaldo13s : null,
    texto: veBancos ? moeda(d.menorSaldo13s) : TEXTO_RESTRITO,
    tom: !veBancos ? undefined : d.menorSaldo13s < 0 ? 'bad' : d.menorSaldo13s < reservaMin ? 'warn' : 'ok',
    micro: veBancos ? (semanaMenor ? `na ${semanaMenor}` : undefined) : undefined,
    partes: veBancos
      ? [
          { rotulo: 'Falta p/ reserva', valor: d.necessidadeMaxima, texto: d.necessidadeMaxima > 0 ? moeda(d.necessidadeMaxima) : 'nada', tom: d.necessidadeMaxima > 0 ? 'warn' : undefined },
          { rotulo: 'Saldo final', valor: d.saldoFinal13s, texto: moeda(d.saldoFinal13s), tom: d.saldoFinal13s < 0 ? 'bad' : undefined },
        ]
      : [],
    origem: { funcao: 'dashboard(ds)', campo: 'menorSaldo13s · necessidadeMaxima · saldoFinal13s', regra: 'projeção semanal do motor (fluxo13Semanas) no cenário dos parâmetros', tela: veBancos ? '/fluxo13' : undefined },
    composicaoId: veBancos ? 'menor-saldo' : undefined,
  };
  const vencido: ItemSituacao = {
    id: 'vencido',
    rotulo: 'Vencidos',
    valor: null,
    // nunca um total: contagens por direcao, lado a lado
    texto: recAtras.length === 0 && pagAtras.length === 0 ? 'nada vencido' : `${pagAtras.length} a pagar · ${recAtras.length} a receber`,
    tom: d.pagamentosVencidos > 0 ? 'bad' : d.recebiveisVencidos > 0 ? 'warn' : 'ok',
    partes: [
      { rotulo: 'A pagar', valor: d.pagamentosVencidos, texto: moeda(d.pagamentosVencidos), tom: d.pagamentosVencidos > 0 ? 'bad' : undefined },
      { rotulo: 'A receber', valor: d.recebiveisVencidos, texto: moeda(d.recebiveisVencidos), tom: d.recebiveisVencidos > 0 ? 'warn' : undefined },
    ],
    origem: { funcao: 'dashboard(ds)', campo: 'pagamentosVencidos · recebiveisVencidos', regra: 'dois conceitos, nunca somados: saída e entrada com situação Atrasado', tela: '/lancamentos?situacao=Atrasado' },
    composicaoId: d.pagamentosVencidos > 0 ? 'vencido-pagar' : d.recebiveisVencidos > 0 ? 'vencido-receber' : undefined,
  };
  const proximos: ItemSituacao = {
    id: 'proximos-7',
    rotulo: 'Próximos 7 dias',
    valor: null,
    texto: rec7.length === 0 && pag7.length === 0 ? 'nada vence' : `${n(pag7.length, 'saída', 'saídas')} · ${n(rec7.length, 'entrada', 'entradas')}`,
    partes: [
      { rotulo: 'Saídas', valor: d.proximos7DiasSaidas, texto: moeda(d.proximos7DiasSaidas) },
      { rotulo: 'Entradas', valor: d.proximos7DiasEntradas, texto: moeda(d.proximos7DiasEntradas) },
    ],
    origem: { funcao: 'dashboard(ds)', campo: 'proximos7DiasSaidas · proximos7DiasEntradas', regra: 'vencimentos entre a data-base e +7 dias, saída e entrada separadas', tela: '/lancamentos?situacao=Pr%C3%B3ximos+7+dias' },
    composicaoId: pag7.length ? 'proximos-7-pagar' : rec7.length ? 'proximos-7-receber' : undefined,
  };
  const contagensPend = [n(d.aprovacoesPendentes, 'aprovação', 'aprovações'), n(d.realizadosSemConciliacao, 'conciliação', 'conciliações'), ...(veBancos ? [n(naoLancadas, 'lançamento', 'lançamentos')] : [])];
  const algumaPend = d.aprovacoesPendentes > 0 || d.realizadosSemConciliacao > 0 || (veBancos && naoLancadas > 0);
  const pendencias: ItemSituacao = {
    id: 'pendencias',
    rotulo: 'Pendências operacionais',
    valor: null,
    // tres grandezas independentes lado a lado; nunca um total (nao ha prova de deduplicacao entre elas)
    texto: contagensPend.join(' · '),
    tom: d.aprovacoesSlaVencido > 0 ? 'bad' : algumaPend ? 'warn' : 'ok',
    micro: d.aprovacoesSlaVencido > 0 ? `${n(d.aprovacoesSlaVencido, 'SLA vencido', 'SLAs vencidos')}` : undefined,
    partes: [
      { rotulo: 'Aprovações pendentes', valor: d.aprovacoesPendentes, texto: String(d.aprovacoesPendentes), tom: d.aprovacoesSlaVencido > 0 ? 'bad' : d.aprovacoesPendentes > 0 ? 'warn' : undefined },
      { rotulo: 'Realizados sem conciliação', valor: d.realizadosSemConciliacao, texto: String(d.realizadosSemConciliacao), tom: d.realizadosSemConciliacao > 0 ? 'warn' : undefined },
      ...(veBancos ? [{ rotulo: 'Extrato sem lançamento', valor: naoLancadas, texto: String(naoLancadas), tom: naoLancadas > 0 ? ('info' as Tom) : undefined }] : []),
    ],
    origem: { funcao: 'dashboard(ds) · posicaoBancaria(ds)', campo: 'aprovacoesPendentes · aprovacoesSlaVencido · realizadosSemConciliacao · transacoesPendentes', regra: 'três contagens independentes; nunca somadas (não há prova de deduplicação entre elas)', tela: '/aprovacoes' },
    composicaoId: d.aprovacoesPendentes > 0 ? 'aprovacoes' : d.realizadosSemConciliacao > 0 ? 'sem-conciliacao' : undefined,
  };
  const situacao = (visao === 'executivo' ? [caixa, menorSaldo, vencido] : [vencido, proximos, pendencias, caixa]).slice(0, TETO_SITUACAO[visao]);

  // ---- ATENCAO: uma condicao canonica por item; impacto/severidade sao leitura, nao regra ----
  const atencao: ItemAtencao[] = [];
  if (veBancos && d.menorSaldo13s < reservaMin) atencao.push(item({ id: 'caixa-reserva', tom: d.menorSaldo13s < 0 ? 'bad' : 'warn', texto: d.menorSaldo13s < 0 ? 'Caixa projetado fica negativo.' : 'Caixa projetado fura a reserva mínima.', impacto: d.menorSaldo13s < 0 ? `${moeda(d.menorSaldo13s)}${semanaMenor ? ` na ${semanaMenor}` : ''}` : `faltam ${moeda(d.necessidadeMaxima)}${semanaMenor ? ` na ${semanaMenor}` : ''}`, valor: d.necessidadeMaxima, origem: { funcao: 'dashboard(ds)', campo: 'menorSaldo13s < params.reservaMinima · necessidadeMaxima', regra: 'mesmo alerta "Caixa abaixo da reserva (13S)" do Painel executivo', tela: '/fluxo13' }, destino: { rotulo: 'Ver projeção', to: '/fluxo13' }, composicaoId: 'menor-saldo' }));
  if (d.pagamentosVencidos > 0) atencao.push(item({ id: 'pagamentos-vencidos', tom: 'bad', texto: `${n(pagAtras.length, 'pagamento vencido', 'pagamentos vencidos')}.`, impacto: `${moeda(d.pagamentosVencidos)} a pagar`, detalhe: pagAtras.slice().sort((a, b) => b.diasAtraso - a.diasAtraso).slice(0, 2).map((l) => `${l.contraparte.replace(/^PILOTO · /, '')} · ${l.diasAtraso} d`).join(' · '), valor: d.pagamentosVencidos, quantidade: pagAtras.length, origem: { funcao: 'dashboard(ds)', campo: 'pagamentosVencidos', regra: "somaSit('Saída', 'Atrasado')", tela: '/pagar?situacao=Atrasado' }, destino: { rotulo: 'Ver pendências', to: '/pagar?situacao=Atrasado' }, composicaoId: 'vencido-pagar' }));
  if (d.recebiveisVencidos > 0) atencao.push(item({ id: 'recebiveis-vencidos', tom: 'warn', texto: `${n(recAtras.length, 'recebível vencido', 'recebíveis vencidos')}.`, impacto: `${moeda(d.recebiveisVencidos)} fora do caixa`, detalhe: recAtras.slice().sort((a, b) => b.diasAtraso - a.diasAtraso).slice(0, 2).map((l) => `${l.contraparte.replace(/^PILOTO · /, '')} · ${l.diasAtraso} d`).join(' · '), valor: d.recebiveisVencidos, quantidade: recAtras.length, origem: { funcao: 'dashboard(ds)', campo: 'recebiveisVencidos', regra: "somaSit('Entrada', 'Atrasado')", tela: '/receber?situacao=Atrasado' }, destino: { rotulo: 'Ver pendências', to: '/receber?situacao=Atrasado' }, composicaoId: 'vencido-receber' }));
  if (d.aprovacoesPendentes > 0) atencao.push(item({ id: 'aprovacoes', tom: d.aprovacoesSlaVencido > 0 ? 'bad' : 'warn', texto: `${n(d.aprovacoesPendentes, 'aprovação pendente', 'aprovações pendentes')}.`, impacto: d.aprovacoesSlaVencido > 0 ? `${n(d.aprovacoesSlaVencido, 'SLA vencido', 'SLAs vencidos')}` : 'dentro do SLA', quantidade: d.aprovacoesPendentes, valor: null, origem: { funcao: 'dashboard(ds)', campo: 'aprovacoesPendentes · aprovacoesSlaVencido', regra: "status 'Pendente'; SLA pelo prazoSla", tela: '/aprovacoes' }, destino: { rotulo: 'Ver pendências', to: '/aprovacoes' }, composicaoId: 'aprovacoes' }));
  if (d.realizadosSemConciliacao > 0) atencao.push(item({ id: 'sem-conciliacao', tom: 'warn', texto: `${n(d.realizadosSemConciliacao, 'realizado sem extrato', 'realizados sem extrato')}.`, impacto: 'saldo por lançamentos ≠ banco', quantidade: d.realizadosSemConciliacao, valor: null, origem: { funcao: 'dashboard(ds)', campo: 'realizadosSemConciliacao', regra: 'Realizado sem vínculo bancário', tela: '/conciliacao' }, destino: { rotulo: 'Ver pendências', to: '/conciliacao' }, composicaoId: 'sem-conciliacao' }));
  if (veBancos && naoLancadas > 0) atencao.push(item({ id: 'extrato-sem-lancamento', tom: 'info', texto: `${n(naoLancadas, 'movimento do extrato sem lançamento', 'movimentos do extrato sem lançamento')}.`, impacto: posicao.filter((p) => p.transacoesPendentes).map((p) => `${p.conta.instituicao.replace(/^PILOTO · /, '')} ${moeda(p.naoLancado)}`).join(' · '), quantidade: naoLancadas, valor: null, origem: { funcao: 'posicaoBancaria(ds)', campo: 'transacoesPendentes · naoLancado', regra: 'transações do extrato sem lancamentoIds', tela: '/conciliacao' }, destino: { rotulo: 'Ver pendências', to: '/conciliacao' }, composicaoId: 'caixa' }));
  if (d.obrasMargemNegativa > 0) atencao.push(item({ id: 'margem-negativa', tom: 'bad', texto: `${n(d.obrasMargemNegativa, 'obra com margem negativa', 'obras com margem negativa')}.`, impacto: 'margem projetada < 0', quantidade: d.obrasMargemNegativa, valor: null, origem: { funcao: 'dashboard(ds)', campo: 'obrasMargemNegativa', regra: 'carteiraObras: obra ativa com margemProjetada < 0', tela: '/obras' }, destino: { rotulo: 'Ver pendências', to: '/obras' } }));
  if (frescor.extratoAte === undefined && veBancos) atencao.push(item({ id: 'sem-extrato', tom: 'warn', texto: 'Nenhum extrato importado.', impacto: 'caixa hoje = só abertura', valor: null, origem: { funcao: 'defasagemExtrato(ds)', campo: 'ate', regra: 'última transação das contas ativas (Diretor Financeiro)', tela: '/posicao' }, destino: { rotulo: 'Ver origem', to: '/posicao' } }));
  else if (frescor.diasExtrato !== undefined && frescor.motivos.some((m) => m.startsWith('Extrato defasado')) && veBancos) atencao.push(item({ id: 'extrato-defasado', tom: 'warn', texto: `Extrato defasado.`, impacto: `${frescor.diasExtrato} d sem movimento · até ${diaMes(frescor.extratoAte)}`, valor: null, origem: { funcao: 'defasagemExtrato(ds)', campo: 'dias > LIMITE_DEFASAGEM_DIAS', regra: 'mesmo alerta do Diretor Financeiro', tela: '/posicao' }, destino: { rotulo: 'Ver origem', to: '/posicao' } }));
  for (const c of d.checks.filter((c) => c.status === 'FALHA')) atencao.push(item({ id: `check-${c.id}`, tom: c.tipo === 'bloqueante' ? 'bad' : 'warn', texto: `Controle "${c.nome}" falhou.`, impacto: `${String(c.atual)} × esperado ${String(c.esperado)}`, detalhe: c.nota, valor: null, origem: { funcao: 'dashboard(ds).checks', campo: c.id, regra: c.onde, tela: '/checks' }, destino: { rotulo: 'Ver origem', to: '/checks' } }));
  for (const s of sugestoesPara('/', ds, usuario, ds.params.dataBase)) {
    const coberta = SUGESTOES_COBERTAS[s.id];
    if (atencao.some((a) => a.id === s.id || (coberta !== undefined && a.id === coberta))) continue;
    atencao.push(item({ id: s.id, tom: s.tom === 'bad' ? 'bad' : s.tom === 'warn' ? 'warn' : 'info', texto: s.texto, impacto: s.detalhe ?? 'sugestão do core', valor: null, origem: { funcao: "sugestoesPara('/', ds, usuario)", campo: s.id, regra: 'sugestão do core para o painel', tela: s.acao?.to }, destino: s.acao ? { rotulo: 'Ver pendências', to: s.acao.to } : undefined })); // rotulo do core normalizado: so acoes de leitura
  }
  const todas = ordenarAtencao(atencao);
  const compacta = todas.slice(0, TETO_ATENCAO);

  return {
    estado: 'pronto',
    fonte,
    visao,
    empresa: ds.params.empresa,
    usuario: { nome: usuario.nome, papel: usuario.papel, veBancos },
    situacao,
    atencao: { compacta, todas, ocultas: todas.length - compacta.length, grupos: agruparPorSeveridade(todas), gruposCompactos: agruparPorSeveridade(compacta) },
    composicoes,
    frescor,
  };
}

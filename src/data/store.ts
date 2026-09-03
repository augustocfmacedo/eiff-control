// Camada de dados do EIFF Control.
// Repositorio local (localStorage) com as regras de negocio que, na versao Supabase, vivem em
// triggers, funcoes e RLS (supabase/migrations). A mesma API sera atendida por um provider
// remoto; as telas nao conhecem o mecanismo de persistencia.

import { useSyncExternalStore } from 'react';
import seed from './seed.json';
import type {
  Apontamento,
  Aprovacao,
  Auditoria,
  Colaborador,
  Comentario,
  ContaFinanceira,
  Dataset,
  Demanda,
  Divida,
  Lancamento,
  Liquidacao,
  Medicao,
  Obra,
  OrdemProducao,
  Papel,
  Params,
  PlanoConta,
  Servico,
  StatusEtapa,
  Tarefa,
  TipoOrdem,
  TransacaoBancaria,
  Usuario,
} from '../core/types';
import { addDays, calcLancamento, dataBaseEfetiva, etapasExigidas, executarChecks, impactoLancamento, mapaPlano, statusModelo } from '../core/engine';
import { etapasPadrao, inicioFimPeriodo } from '../core/obras';
import { aoMudarSessao, carregarRemoto, login as loginRemoto, logout as logoutRemoto, persistirRemoto, remotoAtivo, sessaoAtual } from './supabase';

const STORAGE_KEY = 'eiff-control:dataset:v1';
const USER_KEY = 'eiff-control:usuario';

export class RegraDeNegocioError extends Error {
  constructor(message: string, public readonly campos: string[] = []) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
export interface SyncStatus {
  status: 'ok' | 'enviando' | 'erro' | 'local';
  msg?: string;
  em?: string;
}

interface State {
  ds: Dataset;
  usuario: Usuario;
  modo: 'local' | 'remoto';
  carregando: boolean;
  sessao: boolean;
  sync: SyncStatus;
  erroInicial?: string;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function carregar(): State {
  const base = clone(seed) as unknown as Dataset;
  if (remotoAtivo) {
    return { ds: base, usuario: base.usuarios[0], modo: 'remoto', carregando: true, sessao: false, sync: { status: 'ok' } };
  }
  let ds = base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) ds = { ...base, ...(JSON.parse(raw) as Dataset) };
  } catch {
    ds = base;
  }
  let usuario = ds.usuarios[0];
  try {
    const uid = localStorage.getItem(USER_KEY);
    usuario = ds.usuarios.find((u) => u.id === uid) ?? usuario;
  } catch {
    /* ignore */
  }
  return { ds, usuario, modo: 'local', carregando: false, sessao: true, sync: { status: 'local' } };
}

let state: State = carregar();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persistir() {
  if (state.modo === 'remoto') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ds));
    localStorage.setItem(USER_KEY, state.usuario.id);
  } catch {
    /* modo somente memoria */
  }
}

// --- sincronizacao com o Supabase (fila serial; em erro, mantem local e permite tentar de novo)
let baseSincronizada: Dataset | null = null;
let fila: Promise<void> = Promise.resolve();

function setSync(sync: SyncStatus) {
  state = { ...state, sync };
  emit();
}

function sincronizar(depois: Dataset) {
  fila = fila.then(async () => {
    const antes = baseSincronizada ?? depois;
    setSync({ status: 'enviando' });
    try {
      await persistirRemoto(antes, depois, state.usuario.id);
      baseSincronizada = depois;
      setSync({ status: 'ok', em: new Date().toISOString() });
    } catch (e) {
      setSync({ status: 'erro', msg: (e as Error).message });
    }
  });
}

function commit(ds: Dataset) {
  state = { ...state, ds };
  persistir();
  emit();
  if (state.modo === 'remoto') sincronizar(ds);
}

/**
 * Data-base automatica: quando ativa, a data-base acompanha o dia de hoje. Verificada ao carregar e a cada
 * 10 minutos; a mudanca de dia e gravada como "avancar_data_base" (sem passar por permissao, e regra do sistema).
 */
function ajustarDataBase() {
  const p = state.ds.params;
  const hoje = dataBaseEfetiva(p);
  if (!p.dataBaseAutomatica || p.dataBase === hoje) return;
  const params: Params = { ...p, dataBase: hoje };
  const ds = registrar({ ...state.ds, params }, 'avancar_data_base', 'parametros', 'params', { dataBase: p.dataBase }, { dataBase: hoje });
  commit(ds);
}
if (typeof window !== 'undefined') window.setInterval(() => { if (state.sessao && !state.carregando) ajustarDataBase(); }, 10 * 60_000);

let inicializado = false;
/** Carrega a sessao e os dados do Supabase (modo remoto). No modo local nao faz nada. */
export async function inicializar(): Promise<void> {
  if (!remotoAtivo) { ajustarDataBase(); return; }
  if (inicializado) return;
  inicializado = true;
  const recarregar = async () => {
    state = { ...state, carregando: true, erroInicial: undefined };
    emit();
    try {
      const { ds, usuario } = await carregarRemoto();
      baseSincronizada = ds;
      state = { ...state, ds, usuario, carregando: false, sessao: true, sync: { status: 'ok', em: new Date().toISOString() } };
      emit();
      ajustarDataBase();
    } catch (e) {
      state = { ...state, carregando: false, sessao: false, erroInicial: (e as Error).message };
      await logoutRemoto();
    }
    emit();
  };
  const s = await sessaoAtual();
  if (s) await recarregar();
  else { state = { ...state, carregando: false, sessao: false }; emit(); }
  aoMudarSessao((ativa) => {
    if (ativa && !state.sessao) void recarregar();
    if (!ativa && state.sessao) { state = { ...state, sessao: false }; emit(); }
  });
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const getState = () => state;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const agora = () => new Date().toISOString();
const seq = (prefix: string, ids: string[]): string => {
  let n = ids.length + 1;
  let id = `${prefix}-${String(n).padStart(4, '0')}`;
  while (ids.includes(id)) id = `${prefix}-${String(++n).padStart(4, '0')}`;
  return id;
};

function registrar(ds: Dataset, acao: string, entidade: string, entidadeId: string, antes?: unknown, depois?: unknown, motivo?: string): Dataset {
  const a: Auditoria = { id: seq('AUD', ds.auditoria.map((x) => x.id)), ts: agora(), usuario: state.usuario.nome, acao, entidade, entidadeId, antes, depois, motivo };
  return { ...ds, auditoria: [a, ...ds.auditoria] };
}

// ---------------------------------------------------------------------------
// Permissoes (matriz da secao 7)
// ---------------------------------------------------------------------------
export type Acao =
  | 'ver_bancos'
  | 'editar_lancamento'
  | 'liquidar'
  | 'conciliar'
  | 'aprovar'
  | 'editar_obra'
  | 'editar_etc'
  | 'editar_cadastros'
  | 'editar_parametros'
  | 'fechar_periodo'
  | 'reabrir_periodo'
  | 'ver_auditoria'
  | 'administrar'
  | 'comentar'
  | 'exportar';

const MATRIZ: Record<Acao, Papel[]> = {
  ver_bancos: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
  editar_lancamento: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras'],
  liquidar: ['Administrador', 'Financeiro'],
  conciliar: ['Administrador', 'Financeiro'],
  aprovar: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'],
  editar_obra: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'],
  editar_etc: ['Administrador', 'Diretoria', 'Gestor de obra', 'Engenharia', 'Financeiro'],
  editar_cadastros: ['Administrador', 'Financeiro'],
  editar_parametros: ['Administrador', 'Financeiro', 'Diretoria'],
  fechar_periodo: ['Administrador', 'Financeiro'],
  reabrir_periodo: ['Administrador', 'Diretoria'],
  ver_auditoria: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
  administrar: ['Administrador'],
  comentar: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade'],
  exportar: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
};

export function pode(usuario: Usuario, acao: Acao, codigoObra?: string): boolean {
  if (!usuario.ativo) return false;
  if (!MATRIZ[acao].includes(usuario.papel)) return false;
  if (codigoObra && usuario.obras !== '*' && !usuario.obras.includes(codigoObra)) return false;
  return true;
}

export function obrasVisiveis(usuario: Usuario, obras: Obra[]): Obra[] {
  return usuario.obras === '*' ? obras : obras.filter((o) => (usuario.obras as string[]).includes(o.codigo));
}

function exigir(acao: Acao, codigoObra?: string) {
  if (!pode(state.usuario, acao, codigoObra)) {
    throw new RegraDeNegocioError(`Perfil ${state.usuario.papel} não tem permissão para esta ação${codigoObra ? ` na obra ${codigoObra}` : ''}.`);
  }
}

function periodoFechado(ds: Dataset, competencia: string): boolean {
  return ds.fechamentos.some((f) => f.periodo === competencia.slice(0, 7) && !f.reaberto);
}

// ---------------------------------------------------------------------------
// Validacao do lancamento (FIN-002: validacoes da planilha reproduzidas no servidor)
// ---------------------------------------------------------------------------
export function validarLancamento(ds: Dataset, l: Lancamento): string[] {
  const erros: string[] = [];
  const plano = mapaPlano(ds).get(l.categoria);
  if (!l.categoria) erros.push('Categoria é obrigatória.');
  else if (!plano) erros.push(`Categoria "${l.categoria}" não está no plano de contas.`);
  if (!l.descricao?.trim()) erros.push('Descrição é obrigatória.');
  if (!l.contraparte?.trim()) erros.push('Contraparte é obrigatória.');
  if (!l.competencia) erros.push('Competência é obrigatória.');
  if (l.status !== 'Cancelado' && !l.vencimento) erros.push('Vencimento é obrigatório.');
  if (!l.contaFinanceira) erros.push('Conta financeira é obrigatória.');
  if (!(l.valorBruto > 0)) erros.push('Valor bruto deve ser positivo.');
  if (l.retencoes < 0 || l.desconto < 0 || l.multaJuros < 0) erros.push('Retenções, descontos e juros devem ser positivos.');
  if (l.probabilidade < 0 || l.probabilidade > 1) erros.push('Probabilidade deve estar entre 0% e 100%.');
  if (l.status === 'Realizado' && (!l.realizacao || !(l.valorRealizado ?? 0))) erros.push('Realizado exige data e valor realizados (use Liquidar).');
  if (plano && (plano.grupoFluxo === 'Custos Diretos de Obras' || plano.grupoDre === 'Receita Operacional') && !l.codigoObra)
    erros.push('Custos diretos e receitas de obra exigem Código Obra.');
  if (l.codigoObra && !ds.obras.some((o) => o.codigo === l.codigoObra)) erros.push(`Obra ${l.codigoObra} não cadastrada.`);
  if (l.competencia && periodoFechado(ds, l.competencia)) erros.push(`Período ${l.competencia.slice(0, 7)} está fechado.`);
  return erros;
}

const CAMPOS_RELEVANTES: (keyof Lancamento)[] = ['valorBruto', 'retencoes', 'desconto', 'multaJuros', 'vencimento', 'codigoObra', 'categoria', 'contraparte'];

function precisaAprovacao(ds: Dataset, l: Lancamento): { precisa: boolean; excecao: boolean; impacto: ReturnType<typeof impactoLancamento> } {
  const calc = calcLancamento(l, ds);
  const impacto = impactoLancamento(ds, l);
  if (calc.tipo !== 'Saída') return { precisa: false, excecao: false, impacto };
  const excecao = !!impacto.foraDoOrcamento || !!impacto.abaixoDaReserva;
  const precisa = excecao || calc.valorLiquidoPrevisto > ds.params.alcadas.limiteGestorObra;
  return { precisa, excecao, impacto };
}

function abrirAprovacao(ds: Dataset, l: Lancamento, excecao: boolean, impacto: Aprovacao['impacto'], titulo: string): Dataset {
  const calc = calcLancamento(l, ds);
  const etapas = etapasExigidas(ds.params, calc.valorLiquidoPrevisto, !!l.codigoObra, excecao);
  const prazo = new Date(Date.now() + ds.params.alcadas.slaAprovacaoHoras * 3600_000).toISOString();
  const ap: Aprovacao = {
    id: seq('APR', ds.aprovacoes.map((a) => a.id)),
    tipo: 'Lançamento',
    entidadeId: l.id,
    titulo,
    valor: calc.valorLiquidoPrevisto,
    codigoObra: l.codigoObra || undefined,
    solicitante: state.usuario.nome,
    criadoEm: agora(),
    prazoSla: prazo,
    etapas: etapas.map((papel) => ({ papel, status: 'Pendente' })),
    status: 'Pendente',
    impacto,
    justificativaExcecao: excecao ? 'Exceção: fora do orçamento e/ou caixa abaixo da reserva' : undefined,
  };
  // aprovacoes anteriores da mesma entidade ficam superadas
  const anteriores = ds.aprovacoes.map((a) => (a.entidadeId === l.id && a.status === 'Pendente' ? { ...a, status: 'Devolvido' as const } : a));
  return { ...ds, aprovacoes: [ap, ...anteriores] };
}

// ---------------------------------------------------------------------------
// Acoes
// ---------------------------------------------------------------------------
export const actions = {
  trocarUsuario(id: string) {
    if (state.modo === 'remoto') return; // no modo remoto o usuario vem da sessao autenticada
    const u = state.ds.usuarios.find((x) => x.id === id);
    if (!u) return;
    state = { ...state, usuario: u };
    persistir();
    emit();
  },

  async entrar(email: string, senha: string) {
    await loginRemoto(email, senha);
  },

  async sair() {
    await logoutRemoto();
    state = { ...state, sessao: false };
    emit();
  },

  /** Reenvia ao Supabase tudo que ficou pendente desde a ultima sincronizacao bem-sucedida. */
  tentarNovamente() {
    if (state.modo === 'remoto') sincronizar(state.ds);
  },

  async recarregar() {
    if (state.modo !== 'remoto') return;
    const { ds, usuario } = await carregarRemoto();
    baseSincronizada = ds;
    state = { ...state, ds, usuario, sync: { status: 'ok', em: new Date().toISOString() } };
    emit();
  },

  novoLancamento(parcial: Partial<Lancamento> = {}): Lancamento {
    const ds = state.ds;
    const tipo = parcial.categoria ? mapaPlano(ds).get(parcial.categoria)?.tipo : undefined;
    const prefix = tipo === 'Entrada' ? 'REC' : 'PAG';
    return {
      id: seq(prefix, ds.lancamentos.map((l) => l.id)),
      registro: 'Real',
      categoria: '',
      subcategoria: '',
      centroCusto: 'Corporativo',
      codigoObra: '',
      contraparte: '',
      documento: '',
      descricao: '',
      competencia: ds.params.dataBase,
      vencimento: ds.params.dataBase,
      status: 'Programado',
      confiabilidade: 'Estimado',
      probabilidade: 1,
      contaFinanceira: ds.contas[0]?.instituicao ?? 'Caixa',
      valorBruto: 0,
      retencoes: 0,
      desconto: 0,
      multaJuros: 0,
      conciliado: false,
      observacoes: '',
      anexos: [],
      origem: 'eiff-control',
      criadoEm: agora(),
      criadoPor: state.usuario.nome,
      atualizadoEm: agora(),
      atualizadoPor: state.usuario.nome,
      versao: 0,
      ...parcial,
    };
  },

  /** Cria ou altera um lancamento aplicando validacoes, alcadas e reabertura de aprovacao (APR-003). */
  salvarLancamento(input: Lancamento): { lancamento: Lancamento; aprovacaoAberta: boolean } {
    let ds = state.ds;
    exigir('editar_lancamento', input.codigoObra || undefined);
    const atual = ds.lancamentos.find((l) => l.id === input.id);
    if (atual && atual.versao !== input.versao) throw new RegraDeNegocioError('Registro alterado por outro usuário. Recarregue e tente novamente.');
    if (atual && atual.status === 'Cancelado') throw new RegraDeNegocioError('Lançamento cancelado não pode ser editado.');
    if (atual && atual.status === 'Realizado') throw new RegraDeNegocioError('Lançamento realizado só pode ser estornado.');
    if (!atual && ds.lancamentos.some((l) => l.id === input.id)) throw new RegraDeNegocioError('ID já existe.');

    let l: Lancamento = { ...input, atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: (atual?.versao ?? 0) + 1, criadoEm: atual?.criadoEm ?? agora(), criadoPor: atual?.criadoPor ?? state.usuario.nome };
    if (l.status === 'Realizado' && !atual) l.status = 'Programado';
    const erros = validarLancamento(ds, l);
    if (erros.length) throw new RegraDeNegocioError(erros.join(' '), erros);

    const mudouRelevante = atual ? CAMPOS_RELEVANTES.some((c) => atual[c] !== l[c]) : true;
    let aprovacaoAberta = false;
    if (l.status !== 'Rascunho') {
      const { precisa, excecao, impacto } = precisaAprovacao(ds, l);
      const jaAprovado = atual && (atual.status === 'Aprovado' || atual.status === 'Programado') && !mudouRelevante;
      if (precisa && !jaAprovado) {
        l = { ...l, status: 'Pendente' };
        ds = abrirAprovacao(ds, l, excecao, impacto, `${l.id} · ${l.descricao}`);
        aprovacaoAberta = true;
      } else if (l.status === 'Pendente' && !precisa) {
        l = { ...l, status: 'Programado' };
      }
    }
    const lancamentos = atual ? ds.lancamentos.map((x) => (x.id === l.id ? l : x)) : [...ds.lancamentos, l];
    ds = registrar({ ...ds, lancamentos }, atual ? 'alterar_lancamento' : 'criar_lancamento', 'lancamento', l.id, atual, l);
    commit(ds);
    return { lancamento: l, aprovacaoAberta };
  },

  cancelarLancamento(id: string, motivo: string) {
    let ds = state.ds;
    const atual = ds.lancamentos.find((l) => l.id === id);
    if (!atual) throw new RegraDeNegocioError('Lançamento não encontrado.');
    exigir(atual.status === 'Realizado' ? 'liquidar' : 'editar_lancamento', atual.codigoObra || undefined);
    if (!motivo.trim()) throw new RegraDeNegocioError('Motivo do cancelamento/estorno é obrigatório.');
    if (periodoFechado(ds, atual.competencia)) throw new RegraDeNegocioError('Período fechado.');
    const l: Lancamento = { ...atual, status: 'Cancelado', motivoCancelamento: motivo, valorRealizado: undefined, realizacao: undefined, conciliado: false, atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: atual.versao + 1 };
    ds = {
      ...ds,
      lancamentos: ds.lancamentos.map((x) => (x.id === id ? l : x)),
      liquidacoes: ds.liquidacoes.filter((q) => q.lancamentoId !== id),
      aprovacoes: ds.aprovacoes.map((a) => (a.entidadeId === id && a.status === 'Pendente' ? { ...a, status: 'Devolvido' as const } : a)),
    };
    ds = registrar(ds, atual.status === 'Realizado' ? 'estornar_lancamento' : 'cancelar_lancamento', 'lancamento', id, atual, l, motivo);
    commit(ds);
  },

  /** FIN-005: liquidacao parcial ou total; exige conta, data, valor e evidencia. */
  liquidar(lancamentoId: string, dados: { data: string; valor: number; conta: string; documento: string }) {
    let ds = state.ds;
    exigir('liquidar');
    const atual = ds.lancamentos.find((l) => l.id === lancamentoId);
    if (!atual) throw new RegraDeNegocioError('Lançamento não encontrado.');
    if (atual.status === 'Cancelado') throw new RegraDeNegocioError('Lançamento cancelado.');
    if (atual.status === 'Pendente' || atual.status === 'Rascunho') throw new RegraDeNegocioError('Lançamento ainda não aprovado.');
    if (!dados.data || !(dados.valor > 0) || !dados.conta || !dados.documento.trim()) throw new RegraDeNegocioError('Informe data, valor, conta e evidência (documento).');
    if (periodoFechado(ds, atual.competencia)) throw new RegraDeNegocioError('Período fechado.');
    const liq: Liquidacao = { id: seq('LIQ', ds.liquidacoes.map((q) => q.id)), lancamentoId, data: dados.data, valor: dados.valor, conta: dados.conta, documento: dados.documento, criadoPor: state.usuario.nome, criadoEm: agora() };
    const liquidacoes = [...ds.liquidacoes, liq];
    const total = liquidacoes.filter((q) => q.lancamentoId === lancamentoId).reduce((a, q) => a + q.valor, 0);
    const liquido = atual.valorBruto - atual.retencoes - atual.desconto + atual.multaJuros;
    const l: Lancamento = {
      ...atual,
      valorRealizado: total,
      realizacao: total >= liquido - 0.005 ? dados.data : atual.realizacao,
      status: total >= liquido - 0.005 ? 'Realizado' : atual.status,
      atualizadoEm: agora(),
      atualizadoPor: state.usuario.nome,
      versao: atual.versao + 1,
    };
    ds = { ...ds, liquidacoes, lancamentos: ds.lancamentos.map((x) => (x.id === lancamentoId ? l : x)) };
    ds = registrar(ds, 'liquidar', 'lancamento', lancamentoId, atual, l);
    commit(ds);
    return l;
  },

  /** APR-002: aprovar, rejeitar ou devolver a etapa corrente. */
  decidirAprovacao(id: string, decisao: 'Aprovado' | 'Rejeitado' | 'Devolvido', justificativa: string) {
    let ds = state.ds;
    exigir('aprovar');
    const ap = ds.aprovacoes.find((a) => a.id === id);
    if (!ap) throw new RegraDeNegocioError('Aprovação não encontrada.');
    if (ap.status !== 'Pendente') throw new RegraDeNegocioError('Aprovação já decidida.');
    // Segregacao de funcoes: o solicitante nao decide a propria solicitacao. Administrador e a excecao
    // (fase de validacao com um unico operador); a decisao fica marcada na auditoria.
    const autoAprovacao = ap.solicitante === state.usuario.nome;
    if (autoAprovacao && state.usuario.papel !== 'Administrador') throw new RegraDeNegocioError('Segregação de funções: o solicitante não decide a própria solicitação.');
    const idx = ap.etapas.findIndex((e) => e.status === 'Pendente');
    const etapa = ap.etapas[idx];
    if (!etapa) throw new RegraDeNegocioError('Sem etapa pendente.');
    if (etapa.papel !== state.usuario.papel && state.usuario.papel !== 'Administrador') throw new RegraDeNegocioError(`Etapa atual exige o papel ${etapa.papel}.`);
    if (decisao !== 'Aprovado' && !justificativa.trim()) throw new RegraDeNegocioError('Justificativa obrigatória para rejeitar ou devolver.');
    if (ap.codigoObra && !pode(state.usuario, 'aprovar', ap.codigoObra)) throw new RegraDeNegocioError('Fora do seu escopo de obras.');

    const etapas = ap.etapas.map((e, i) => (i === idx ? { ...e, status: decisao, decididoPor: state.usuario.nome, decididoEm: agora(), justificativa } : e));
    const concluida = decisao === 'Aprovado' && etapas.every((e) => e.status === 'Aprovado');
    const novo: Aprovacao = { ...ap, etapas, status: decisao === 'Aprovado' ? (concluida ? 'Aprovado' : 'Pendente') : decisao };
    let lancamentos = ds.lancamentos;
    if (ap.tipo === 'Lançamento') {
      lancamentos = ds.lancamentos.map((l) => {
        if (l.id !== ap.entidadeId) return l;
        if (concluida) return { ...l, status: 'Aprovado', atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: l.versao + 1 };
        if (decisao !== 'Aprovado') return { ...l, status: 'Rascunho', observacoes: `${l.observacoes} [${decisao} por ${state.usuario.nome}: ${justificativa}]`.trim(), atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: l.versao + 1 };
        return l;
      });
    }
    ds = { ...ds, aprovacoes: ds.aprovacoes.map((a) => (a.id === id ? novo : a)), lancamentos };
    ds = registrar(ds, `aprovacao_${decisao.toLowerCase()}`, 'aprovacao', id, ap, novo, autoAprovacao ? `[auto-aprovação pelo solicitante como Administrador] ${justificativa}`.trim() : justificativa);
    commit(ds);
  },

  /**
   * Edicao rapida de datas na grade. Competencia e vencimento passam por salvarLancamento (validacoes,
   * periodo fechado e reabertura de aprovacao). A data de realizacao de um titulo Realizado e ajustada aqui,
   * junto com a ultima liquidacao, e exige o papel que liquida.
   */
  alterarDatas(id: string, datas: { competencia?: string; vencimento?: string; realizacao?: string }) {
    const atual = state.ds.lancamentos.find((l) => l.id === id);
    if (!atual) throw new RegraDeNegocioError('Lançamento não encontrado.');
    if (atual.status === 'Cancelado') throw new RegraDeNegocioError('Lançamento cancelado não pode ser editado.');
    if (datas.realizacao !== undefined) {
      exigir('liquidar');
      if (atual.status !== 'Realizado') throw new RegraDeNegocioError('Data de realização só existe em título realizado; altere o vencimento.');
      if (!datas.realizacao) throw new RegraDeNegocioError('Informe a data de realização.');
      if (periodoFechado(state.ds, atual.competencia)) throw new RegraDeNegocioError('Período fechado.');
      const liqs = state.ds.liquidacoes.filter((q) => q.lancamentoId === id).sort((a, b) => (a.data < b.data ? -1 : 1));
      const ultima = liqs[liqs.length - 1];
      const l: Lancamento = { ...atual, realizacao: datas.realizacao, atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: atual.versao + 1 };
      let ds: Dataset = {
        ...state.ds,
        lancamentos: state.ds.lancamentos.map((x) => (x.id === id ? l : x)),
        liquidacoes: ultima ? state.ds.liquidacoes.map((q) => (q.id === ultima.id ? { ...q, data: datas.realizacao! } : q)) : state.ds.liquidacoes,
      };
      ds = registrar(ds, 'alterar_data_realizacao', 'lancamento', id, { realizacao: atual.realizacao }, { realizacao: datas.realizacao });
      commit(ds);
      return l;
    }
    if (atual.status === 'Realizado') {
      // titulo realizado: competencia ainda pode ser corrigida (DRE); vencimento nao muda o caixa
      exigir('liquidar');
      const l: Lancamento = { ...atual, ...(datas.competencia ? { competencia: datas.competencia } : {}), ...(datas.vencimento ? { vencimento: datas.vencimento } : {}), atualizadoEm: agora(), atualizadoPor: state.usuario.nome, versao: atual.versao + 1 };
      if (periodoFechado(state.ds, atual.competencia) || periodoFechado(state.ds, l.competencia)) throw new RegraDeNegocioError('Período fechado.');
      const ds = registrar({ ...state.ds, lancamentos: state.ds.lancamentos.map((x) => (x.id === id ? l : x)) }, 'alterar_datas', 'lancamento', id, { competencia: atual.competencia, vencimento: atual.vencimento }, { competencia: l.competencia, vencimento: l.vencimento });
      commit(ds);
      return l;
    }
    return this.salvarLancamento({ ...atual, ...(datas.competencia ? { competencia: datas.competencia } : {}), ...(datas.vencimento ? { vencimento: datas.vencimento } : {}) }).lancamento;
  },

  // ---------------------------------------------------------------------------
  // Operacao de obras: servicos, demandas e producao
  // ---------------------------------------------------------------------------
  novoServico(codigoObra: string): Servico {
    const ds = state.ds;
    const sigla = codigoObra.split('-').slice(1, 3).join('') || 'OB';
    const n = ds.servicos.filter((s) => s.codigoObra === codigoObra).length + 1;
    return {
      id: seq(`SRV-${sigla}`, ds.servicos.map((s) => s.id)), codigoObra, codigo: `${sigla}-${String(n).padStart(2, '0')}`, nome: '', etapa: 'Fabricação', unidade: 't',
      quantidadeOrcada: 0, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 0, status: 'Não iniciado', observacoes: '', ativo: true,
    };
  },

  salvarServico(s: Servico) {
    let ds = state.ds;
    exigir('editar_etc', s.codigoObra);
    if (!s.nome.trim() || !s.codigo.trim()) throw new RegraDeNegocioError('Código e nome do serviço são obrigatórios.');
    if (!ds.obras.some((o) => o.codigo === s.codigoObra)) throw new RegraDeNegocioError('Obra não cadastrada.');
    if (s.custoOrcado < 0 || s.precoVenda < 0 || s.quantidadeOrcada < 0 || s.quantidadeExecutada < 0) throw new RegraDeNegocioError('Valores e quantidades devem ser positivos.');
    if (s.inicioPrevisto && s.fimPrevisto && s.fimPrevisto < s.inicioPrevisto) throw new RegraDeNegocioError('Fim previsto anterior ao início.');
    if (ds.servicos.some((x) => x.id !== s.id && x.codigoObra === s.codigoObra && x.codigo === s.codigo)) throw new RegraDeNegocioError(`Código ${s.codigo} já existe nesta obra.`);
    const atual = ds.servicos.find((x) => x.id === s.id);
    const novo: Servico = { ...s, estimativaConcluir: s.estimativaConcluir === undefined || Number.isNaN(s.estimativaConcluir) ? undefined : s.estimativaConcluir };
    const servicos = atual ? ds.servicos.map((x) => (x.id === s.id ? novo : x)) : [...ds.servicos, novo];
    ds = registrar({ ...ds, servicos }, atual ? 'alterar_servico' : 'criar_servico', 'servico', s.id, atual, novo);
    commit(ds);
    return novo;
  },

  /** Avanco fisico e status do servico com justificativa (historico por data-base e autor). */
  atualizarServico(id: string, dados: { quantidadeExecutada: number; status: Servico['status']; estimativaConcluir?: number; inicioReal?: string; fimReal?: string; justificativa: string }) {
    let ds = state.ds;
    const atual = ds.servicos.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Serviço não encontrado.');
    exigir('editar_etc', atual.codigoObra);
    if (!dados.justificativa.trim()) throw new RegraDeNegocioError('Justificativa é obrigatória.');
    const novo: Servico = { ...atual, quantidadeExecutada: dados.quantidadeExecutada, status: dados.status, estimativaConcluir: dados.estimativaConcluir, inicioReal: dados.inicioReal ?? atual.inicioReal, fimReal: dados.status === 'Concluído' ? dados.fimReal ?? ds.params.dataBase : dados.fimReal };
    ds = registrar({ ...ds, servicos: ds.servicos.map((x) => (x.id === id ? novo : x)) }, 'atualizar_avanco_servico', 'servico', id, atual, novo, dados.justificativa);
    commit(ds);
  },

  novaDemanda(codigoObra: string, servicoId?: string): Demanda {
    return { id: seq('DEM', state.ds.demandas.map((d) => d.id)), codigoObra, servicoId, titulo: '', descricao: '', periodicidade: 'Diária', responsavel: state.usuario.id, conclusoes: [], ativo: true, criadoEm: agora(), criadoPor: state.usuario.nome };
  },

  salvarDemanda(d: Demanda) {
    let ds = state.ds;
    exigir('comentar', d.codigoObra);
    if (!d.titulo.trim()) throw new RegraDeNegocioError('Título da demanda é obrigatório.');
    if (!d.responsavel) throw new RegraDeNegocioError('Responsável é obrigatório.');
    if (d.periodicidade === 'Única' && !d.prazo) throw new RegraDeNegocioError('Demanda única exige prazo.');
    const atual = ds.demandas.find((x) => x.id === d.id);
    const demandas = atual ? ds.demandas.map((x) => (x.id === d.id ? d : x)) : [...ds.demandas, d];
    ds = registrar({ ...ds, demandas }, atual ? 'alterar_demanda' : 'criar_demanda', 'demanda', d.id, atual, d);
    commit(ds);
  },

  /** Marca/desmarca a conclusao da demanda no periodo da data informada (padrao: data-base). */
  concluirDemanda(id: string, concluida: boolean, data: string = state.ds.params.dataBase) {
    let ds = state.ds;
    const atual = ds.demandas.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Demanda não encontrada.');
    exigir('comentar', atual.codigoObra);
    const { ini, fim } = inicioFimPeriodo(atual.periodicidade, data);
    const semPeriodo = atual.periodicidade === 'Única' ? [] : atual.conclusoes.filter((c) => c < ini || c > fim);
    const conclusoes = concluida ? [...semPeriodo, data].sort() : semPeriodo;
    const novo = { ...atual, conclusoes };
    ds = registrar({ ...ds, demandas: ds.demandas.map((x) => (x.id === id ? novo : x)) }, concluida ? 'concluir_demanda' : 'reabrir_demanda', 'demanda', id, { conclusoes: atual.conclusoes }, { conclusoes });
    commit(ds);
  },

  novaOrdem(codigoObra: string, tipo: TipoOrdem, servicoId?: string): OrdemProducao {
    const prefixo = tipo === 'Fabricação' ? 'OF' : 'OM';
    const n = state.ds.ordens.filter((o) => o.codigoObra === codigoObra && o.tipo === tipo).length + 1;
    return { id: seq(prefixo, state.ds.ordens.map((o) => o.id)), codigoObra, servicoId, tipo, codigo: `${prefixo}-${String(n).padStart(3, '0')}`, descricao: '', quantidade: 0, unidade: tipo === 'Fabricação' ? 't' : 'pç', prioridade: 'Normal', etapas: etapasPadrao(tipo), observacoes: '', criadoEm: agora(), criadoPor: state.usuario.nome };
  },

  salvarOrdem(o: OrdemProducao) {
    let ds = state.ds;
    exigir('editar_lancamento', o.codigoObra); // Gestor, Engenharia, Compras, Financeiro, Diretoria, Admin
    if (!o.descricao.trim()) throw new RegraDeNegocioError('Descrição da ordem é obrigatória.');
    if (!(o.quantidade > 0)) throw new RegraDeNegocioError('Quantidade deve ser positiva.');
    if (!o.etapas.length) throw new RegraDeNegocioError('Ordem sem etapas.');
    if (ds.ordens.some((x) => x.id !== o.id && x.codigoObra === o.codigoObra && x.codigo === o.codigo)) throw new RegraDeNegocioError(`Código ${o.codigo} já existe nesta obra.`);
    const atual = ds.ordens.find((x) => x.id === o.id);
    const ordens = atual ? ds.ordens.map((x) => (x.id === o.id ? o : x)) : [...ds.ordens, o];
    ds = registrar({ ...ds, ordens }, atual ? 'alterar_ordem' : 'criar_ordem', 'ordem', o.id, atual, o);
    commit(ds);
  },

  /** Muda o status de uma etapa da linha; concluir uma etapa inicia a seguinte. */
  avancarEtapa(id: string, idx: number, status: StatusEtapa, quantidadeConcluida?: number, responsavel?: string) {
    let ds = state.ds;
    const atual = ds.ordens.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Ordem não encontrada.');
    exigir('editar_lancamento', atual.codigoObra);
    if (atual.cancelada) throw new RegraDeNegocioError('Ordem cancelada.');
    if (idx > 0 && status !== 'Pendente' && atual.etapas[idx - 1].status !== 'Concluída') throw new RegraDeNegocioError(`Conclua a etapa "${atual.etapas[idx - 1].nome}" antes.`);
    const hoje = ds.params.dataBase;
    const etapas = atual.etapas.map((e, i) => {
      if (i === idx) return { ...e, status, quantidadeConcluida: status === 'Concluída' ? (quantidadeConcluida ?? atual.quantidade) : quantidadeConcluida ?? e.quantidadeConcluida, inicio: status === 'Pendente' ? undefined : e.inicio ?? hoje, fim: status === 'Concluída' ? hoje : undefined, responsavel: responsavel ?? e.responsavel ?? state.usuario.nome };
      if (i === idx + 1 && status === 'Concluída' && e.status === 'Pendente') return { ...e, status: 'Em andamento' as const, inicio: hoje };
      if (i > idx && status !== 'Concluída') return { ...e, status: 'Pendente' as const, inicio: undefined, fim: undefined, quantidadeConcluida: 0 };
      return e;
    });
    const novo = { ...atual, etapas };
    ds = registrar({ ...ds, ordens: ds.ordens.map((x) => (x.id === id ? novo : x)) }, 'avancar_etapa', 'ordem', id, { etapa: atual.etapas[idx] }, { etapa: etapas[idx] });
    commit(ds);
  },

  // ---------------------------------------------------------------------------
  // Equipe e produtividade
  // ---------------------------------------------------------------------------
  novoColaborador(): Colaborador {
    return { id: seq('COL', state.ds.colaboradores.map((c) => c.id)), nome: '', funcao: 'Montador', vinculo: 'CLT', equipe: 'Montagem', local: 'Obra', custoHora: 0, jornadaDiaria: 8.8, ativo: true, observacoes: '' };
  },

  salvarColaborador(c: Colaborador) {
    let ds = state.ds;
    exigir('editar_obra');
    if (!c.nome.trim() || !c.funcao.trim()) throw new RegraDeNegocioError('Nome e função são obrigatórios.');
    if (c.custoHora < 0 || c.jornadaDiaria <= 0) throw new RegraDeNegocioError('Custo/hora deve ser positivo e a jornada maior que zero.');
    if (c.codigoObraPadrao && !ds.obras.some((o) => o.codigo === c.codigoObraPadrao)) throw new RegraDeNegocioError('Obra padrão não cadastrada.');
    const atual = ds.colaboradores.find((x) => x.id === c.id);
    const colaboradores = atual ? ds.colaboradores.map((x) => (x.id === c.id ? c : x)) : [...ds.colaboradores, c];
    ds = registrar({ ...ds, colaboradores }, atual ? 'alterar_colaborador' : 'criar_colaborador', 'colaborador', c.id, atual, c);
    commit(ds);
  },

  /** Abre o diario do dia para um local, pre-preenchido com a equipe do local (presenca e jornada padrao). */
  novoApontamento(data: string, local: Colaborador['local'], codigoObra?: string): Apontamento {
    const ds = state.ds;
    const equipe = ds.colaboradores.filter((c) => c.ativo && c.local === local && (local !== 'Obra' || !c.codigoObraPadrao || c.codigoObraPadrao === codigoObra));
    return {
      id: seq('APT', ds.apontamentos.map((a) => a.id)), data, local, codigoObra: local === 'Obra' ? codigoObra : undefined,
      linhas: equipe.map((c) => ({ colaboradorId: c.id, presenca: 'Presente', horas: c.jornadaDiaria, horasExtras: 0 })),
      producao: [], ocorrencias: [], fotos: [], observacoes: '', status: 'Rascunho', responsavel: state.usuario.nome, criadoEm: agora(),
    };
  },

  salvarApontamento(a: Apontamento, fechar = false) {
    let ds = state.ds;
    exigir('comentar', a.codigoObra);
    if (!a.data) throw new RegraDeNegocioError('Data é obrigatória.');
    if (a.local === 'Obra' && !a.codigoObra) throw new RegraDeNegocioError('Apontamento de obra exige a obra.');
    const dup = ds.apontamentos.find((x) => x.id !== a.id && x.data === a.data && x.local === a.local && (x.local !== 'Obra' || x.codigoObra === a.codigoObra));
    if (dup) throw new RegraDeNegocioError(`Já existe apontamento de ${a.local}${a.codigoObra ? ` ${a.codigoObra}` : ''} em ${a.data.split('-').reverse().join('/')} (${dup.id}).`);
    const atual = ds.apontamentos.find((x) => x.id === a.id);
    if (atual?.status === 'Fechado' && !pode(state.usuario, 'editar_obra')) throw new RegraDeNegocioError('Apontamento fechado: só Gestor, Financeiro, Diretoria ou Administrador alteram.');
    for (const l of a.linhas) {
      if (l.horas < 0 || l.horasExtras < 0 || l.horas > 14 || l.horasExtras > 8) throw new RegraDeNegocioError('Horas fora da faixa aceitável (0 a 14 normais, 0 a 8 extras).');
      if (l.presenca !== 'Presente' && (l.horas > 0 || l.horasExtras > 0)) throw new RegraDeNegocioError('Colaborador ausente não pode ter horas.');
      if (l.servicoId && !ds.servicos.some((s) => s.id === l.servicoId)) throw new RegraDeNegocioError('Serviço inválido.');
    }
    if (a.producao.some((p) => !(p.quantidade > 0) || !p.descricao.trim())) throw new RegraDeNegocioError('Produção exige descrição e quantidade positiva.');
    if (a.ocorrencias.some((o) => o.horasPerdidas < 0)) throw new RegraDeNegocioError('Horas perdidas devem ser positivas.');
    const novo: Apontamento = { ...a, status: fechar ? 'Fechado' : a.status, fechadoEm: fechar ? agora() : a.fechadoEm, responsavel: a.responsavel || state.usuario.nome };
    const apontamentos = atual ? ds.apontamentos.map((x) => (x.id === a.id ? novo : x)) : [...ds.apontamentos, novo];
    ds = registrar({ ...ds, apontamentos }, fechar ? 'fechar_apontamento' : atual ? 'alterar_apontamento' : 'criar_apontamento', 'apontamento', a.id, atual, novo);
    commit(ds);
    return novo;
  },

  reabrirApontamento(id: string, motivo: string) {
    let ds = state.ds;
    exigir('editar_obra');
    const atual = ds.apontamentos.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Apontamento não encontrado.');
    if (!motivo.trim()) throw new RegraDeNegocioError('Motivo obrigatório.');
    const novo: Apontamento = { ...atual, status: 'Rascunho', fechadoEm: undefined };
    ds = registrar({ ...ds, apontamentos: ds.apontamentos.map((x) => (x.id === id ? novo : x)) }, 'reabrir_apontamento', 'apontamento', id, atual, novo, motivo);
    commit(ds);
  },

  novaTarefaCampo(parcial: Partial<Tarefa> = {}): Tarefa {
    return { id: seq('TSK', state.ds.tarefas.map((x) => x.id)), titulo: '', responsavel: state.usuario.id, prazo: state.ds.params.dataBase, status: 'Aberta', origem: 'campo', prioridade: 'Normal', criadoEm: agora(), criadoPor: state.usuario.nome, ...parcial };
  },

  salvarTarefa(t: Tarefa) {
    let ds = state.ds;
    exigir('comentar', t.codigoObra);
    if (!t.titulo.trim()) throw new RegraDeNegocioError('Título é obrigatório.');
    if (!t.responsavel && !t.colaboradorId) throw new RegraDeNegocioError('Informe o responsável ou o colaborador executor.');
    if (t.status === 'Bloqueada' && !t.bloqueio?.trim()) throw new RegraDeNegocioError('Tarefa bloqueada exige o motivo.');
    const atual = ds.tarefas.find((x) => x.id === t.id);
    const novo: Tarefa = { ...t, concluidoEm: t.status === 'Concluída' ? t.concluidoEm ?? agora() : undefined };
    const tarefas = atual ? ds.tarefas.map((x) => (x.id === t.id ? novo : x)) : [...ds.tarefas, novo];
    ds = registrar({ ...ds, tarefas }, atual ? 'alterar_tarefa' : 'criar_tarefa', 'tarefa', t.id, atual, novo);
    commit(ds);
  },

  moverTarefa(id: string, status: Tarefa['status'], bloqueio?: string) {
    const atual = state.ds.tarefas.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Tarefa não encontrada.');
    this.salvarTarefa({ ...atual, status, bloqueio: status === 'Bloqueada' ? bloqueio ?? atual.bloqueio : undefined });
  },

  // ---------------------------------------------------------------------------
  // Medicoes / cronograma fisico-financeiro
  // ---------------------------------------------------------------------------
  novaMedicao(codigoObra: string): Medicao {
    const n = state.ds.medicoes.filter((m) => m.codigoObra === codigoObra).length + 1;
    return { id: seq('MED', state.ds.medicoes.map((m) => m.id)), codigoObra, numero: `E${String(n).padStart(2, '0')}`, mes: 1, etapa: '', evento: '', escopo: '', criterio: '', documentos: '', tipoMedicao: 'Percentual físico', responsavelAprovacao: 'Fiscalização', valorBruto: 0, faturamentoDireto: 0, faturamentoConstrutora: 0, retencao: 0, pctEvolucaoPlanejada: 0, status: 'Pendente', observacoes: '' };
  },

  salvarMedicao(m: Medicao) {
    let ds = state.ds;
    exigir('editar_obra', m.codigoObra);
    if (!m.evento.trim() || !m.numero.trim()) throw new RegraDeNegocioError('Número e evento são obrigatórios.');
    if (m.valorBruto < 0 || m.faturamentoDireto < 0 || m.faturamentoConstrutora < 0 || m.retencao < 0) throw new RegraDeNegocioError('Valores devem ser positivos.');
    if (Math.abs(m.faturamentoDireto + m.faturamentoConstrutora - m.valorBruto) > 0.5) throw new RegraDeNegocioError('Faturamento direto + construtora deve ser igual ao valor bruto.');
    if (m.servicoId && !ds.servicos.some((s) => s.id === m.servicoId)) throw new RegraDeNegocioError('Serviço inválido.');
    const atual = ds.medicoes.find((x) => x.id === m.id);
    const medicoes = atual ? ds.medicoes.map((x) => (x.id === m.id ? m : x)) : [...ds.medicoes, m];
    ds = registrar({ ...ds, medicoes }, atual ? 'alterar_medicao' : 'criar_medicao', 'medicao', m.id, atual, m);
    commit(ds);
  },

  /**
   * Registra a medicao de um evento: muda o status, guarda data e valor medido e, opcionalmente, gera o
   * recebivel (parte da construtora liquida de retencao) ou vincula um recebivel existente.
   */
  registrarMedicao(id: string, dados: { status: Medicao['status']; dataMedicao?: string; valorMedido?: number; lancamentoId?: string; gerarRecebivel?: boolean; vencimento?: string; observacoes?: string }) {
    let ds = state.ds;
    const atual = ds.medicoes.find((x) => x.id === id);
    if (!atual) throw new RegraDeNegocioError('Medição não encontrada.');
    exigir('editar_obra', atual.codigoObra);
    if (dados.status !== 'Pendente' && dados.status !== 'Cancelado' && !dados.dataMedicao) throw new RegraDeNegocioError('Informe a data da medição.');
    if (dados.lancamentoId && !ds.lancamentos.some((l) => l.id === dados.lancamentoId)) throw new RegraDeNegocioError('Lançamento não encontrado.');
    let lancamentoId = dados.lancamentoId ?? atual.lancamentoId;
    let lancamentos = ds.lancamentos;
    if (dados.gerarRecebivel && !lancamentoId) {
      const pctRet = atual.valorBruto > 0 ? atual.retencao / atual.valorBruto : 0;
      const bruto = dados.valorMedido ?? atual.faturamentoConstrutora;
      if (!(bruto > 0)) throw new RegraDeNegocioError('Sem valor da construtora para gerar recebível.');
      const obra = ds.obras.find((o) => o.codigo === atual.codigoObra);
      const l: Lancamento = {
        ...this.novoLancamento({ categoria: 'Medições de obras' }),
        categoria: 'Medições de obras', centroCusto: 'Obra', codigoObra: atual.codigoObra, servicoId: atual.servicoId, contraparte: obra?.cliente ?? '', documento: atual.numero,
        descricao: `Medição ${atual.numero} · ${atual.evento}`, competencia: dados.dataMedicao ?? ds.params.dataBase, vencimento: dados.vencimento ?? addDays(dados.dataMedicao ?? ds.params.dataBase, 30),
        status: 'Programado', confiabilidade: 'Confirmado', probabilidade: 1, valorBruto: bruto, retencoes: Math.round(bruto * pctRet * 100) / 100, observacoes: `Gerado da medição ${atual.numero}. Retenção contratual ${Math.round(pctRet * 100)}% a receber no encerramento.`, origem: 'medicao', idExterno: `${atual.codigoObra}/${atual.numero}`,
      };
      const erros = validarLancamento(ds, l);
      if (erros.length) throw new RegraDeNegocioError(erros.join(' '), erros);
      lancamentos = [...lancamentos, l];
      lancamentoId = l.id;
    }
    const novo: Medicao = { ...atual, status: dados.status, dataMedicao: dados.dataMedicao ?? atual.dataMedicao, valorMedido: dados.valorMedido ?? atual.valorMedido, lancamentoId, observacoes: dados.observacoes ?? atual.observacoes };
    ds = registrar({ ...ds, lancamentos, medicoes: ds.medicoes.map((x) => (x.id === id ? novo : x)) }, 'registrar_medicao', 'medicao', id, atual, novo);
    commit(ds);
    return novo;
  },

  salvarObra(obra: Obra) {
    let ds = state.ds;
    const atual = ds.obras.find((o) => o.codigo === obra.codigo);
    exigir(atual ? 'editar_obra' : 'editar_obra', atual ? obra.codigo : undefined);
    if (!obra.codigo.trim() || !obra.nome.trim() || !obra.cliente.trim()) throw new RegraDeNegocioError('Código, nome e cliente são obrigatórios.');
    if (obra.valorContrato < 0 || obra.aditivos < 0 || obra.custoOrcado < 0 || obra.estimativaConcluir < 0) throw new RegraDeNegocioError('Valores devem ser positivos.');
    const obras = atual ? ds.obras.map((o) => (o.codigo === obra.codigo ? obra : o)) : [...ds.obras, obra];
    ds = registrar({ ...ds, obras }, atual ? 'alterar_obra' : 'criar_obra', 'obra', obra.codigo, atual, obra);
    commit(ds);
  },

  /** OBR-004: execucao fisica, medido e ETC com justificativa e historico. */
  atualizarExecucao(codigo: string, dados: { execucaoFisica: number; medidoFaturado: number; estimativaConcluir: number; justificativa: string }) {
    let ds = state.ds;
    exigir('editar_etc', codigo);
    const atual = ds.obras.find((o) => o.codigo === codigo);
    if (!atual) throw new RegraDeNegocioError('Obra não encontrada.');
    if (!dados.justificativa.trim()) throw new RegraDeNegocioError('Justificativa é obrigatória.');
    const obra: Obra = { ...atual, execucaoFisica: dados.execucaoFisica, medidoFaturado: dados.medidoFaturado, estimativaConcluir: dados.estimativaConcluir };
    ds = registrar({ ...ds, obras: ds.obras.map((o) => (o.codigo === codigo ? obra : o)) }, 'atualizar_execucao', 'obra', codigo, atual, obra, dados.justificativa);
    commit(ds);
  },

  salvarParametros(params: Params) {
    let ds = state.ds;
    exigir('editar_parametros');
    if (!params.dataBase) throw new RegraDeNegocioError('Data-base obrigatória.');
    if (!params.fatores[params.cenario]) throw new RegraDeNegocioError('Cenário inválido.');
    ds = registrar({ ...ds, params }, 'alterar_parametros', 'parametros', 'params', ds.params, params);
    commit(ds);
    ajustarDataBase();
  },

  salvarPlanoConta(item: PlanoConta, original?: string) {
    let ds = state.ds;
    exigir('editar_cadastros');
    if (!item.categoria.trim() || !item.grupoFluxo.trim() || !item.grupoDre.trim()) throw new RegraDeNegocioError('Categoria, grupo de fluxo e grupo DRE são obrigatórios.');
    const existe = ds.planoContas.find((p) => p.categoria === (original ?? item.categoria));
    let planoContas = existe ? ds.planoContas.map((p) => (p.categoria === (original ?? item.categoria) ? item : p)) : [...ds.planoContas, item];
    let lancamentos = ds.lancamentos;
    if (original && original !== item.categoria) lancamentos = ds.lancamentos.map((l) => (l.categoria === original ? { ...l, categoria: item.categoria } : l));
    ds = registrar({ ...ds, planoContas, lancamentos }, 'alterar_plano_contas', 'plano_contas', item.categoria, existe, item);
    commit(ds);
  },

  salvarConta(conta: ContaFinanceira) {
    let ds = state.ds;
    exigir('editar_cadastros');
    if (!conta.id.trim() || !conta.instituicao.trim()) throw new RegraDeNegocioError('ID e instituição são obrigatórios.');
    const existe = ds.contas.find((c) => c.id === conta.id);
    const contas = existe ? ds.contas.map((c) => (c.id === conta.id ? conta : c)) : [...ds.contas, conta];
    ds = registrar({ ...ds, contas }, 'alterar_conta', 'conta', conta.id, existe, conta);
    commit(ds);
  },

  salvarDivida(d: Divida) {
    let ds = state.ds;
    exigir('editar_cadastros');
    if (!d.credor.trim() || !d.instrumento.trim()) throw new RegraDeNegocioError('Credor e instrumento são obrigatórios.');
    const existe = ds.dividas.find((x) => x.id === d.id);
    const dividas = existe ? ds.dividas.map((x) => (x.id === d.id ? d : x)) : [...ds.dividas, d];
    ds = registrar({ ...ds, dividas }, 'alterar_divida', 'divida', d.id, existe, d);
    commit(ds);
  },

  /** BAN-002: importa transacoes (CSV: data;historico;documento;debito;credito) com deduplicacao. */
  importarTransacoes(conta: string, linhas: Omit<TransacaoBancaria, 'id' | 'registro' | 'conta' | 'lancamentoIds' | 'origem'>[]) {
    let ds = state.ds;
    exigir('conciliar');
    const existentes = new Set(ds.transacoes.map((t) => `${t.conta}|${t.data}|${t.debito}|${t.credito}|${t.historico}`));
    const externos = new Set(ds.transacoes.filter((t) => t.idExterno).map((t) => `${t.conta}|${t.idExterno}`));
    const novas: TransacaoBancaria[] = [];
    let duplicadas = 0;
    const ids = ds.transacoes.map((t) => t.id);
    for (const l of linhas) {
      // FITID do banco e a chave primaria de deduplicacao; sem ele, usa data+valor+historico
      const chaveExt = l.idExterno ? `${conta}|${l.idExterno}` : null;
      const chave = `${conta}|${l.data}|${l.debito}|${l.credito}|${l.historico}`;
      if ((chaveExt && externos.has(chaveExt)) || (!chaveExt && existentes.has(chave))) { duplicadas++; continue; }
      if (chaveExt) externos.add(chaveExt);
      existentes.add(chave);
      const id = seq('EXT', [...ids, ...novas.map((n) => n.id)]);
      novas.push({ id, registro: 'Real', conta, data: l.data, historico: l.historico, documento: l.documento, debito: l.debito, credito: l.credito, lancamentoIds: [], origem: l.idExterno ? 'ofx' : 'importacao', idExterno: l.idExterno });
    }
    ds = registrar({ ...ds, transacoes: [...ds.transacoes, ...novas] }, 'importar_extrato', 'transacoes', conta, undefined, { importadas: novas.length, duplicadas });
    commit(ds);
    return { importadas: novas.length, duplicadas };
  },

  /** BAN-004: concilia 1:1, 1:N; divergencia acima da tolerancia exige justificativa. */
  conciliar(transacaoId: string, lancamentoIds: string[], justificativa?: string) {
    let ds = state.ds;
    exigir('conciliar');
    const t = ds.transacoes.find((x) => x.id === transacaoId);
    if (!t) throw new RegraDeNegocioError('Transação não encontrada.');
    const movimento = t.credito - t.debito;
    const soma = lancamentoIds.reduce((a, id) => a + calcLancamento(ds.lancamentos.find((l) => l.id === id)!, ds).valorCaixaProjetado, 0);
    const dif = movimento - soma;
    const divergente = lancamentoIds.length > 0 && Math.abs(dif) > ds.params.alcadas.toleranciaConciliacao;
    if (divergente && !justificativa?.trim()) throw new RegraDeNegocioError(`Diferença de ${dif.toFixed(2)} acima da tolerância: justificativa obrigatória.`);
    const novo: TransacaoBancaria = { ...t, lancamentoIds, justificativa: divergente ? justificativa : undefined };
    const antesIds = new Set(t.lancamentoIds);
    const lancamentos = ds.lancamentos.map((l) => {
      if (lancamentoIds.includes(l.id)) return { ...l, conciliado: !divergente };
      if (antesIds.has(l.id)) return { ...l, conciliado: false };
      return l;
    });
    ds = registrar({ ...ds, transacoes: ds.transacoes.map((x) => (x.id === transacaoId ? novo : x)), lancamentos }, 'conciliar', 'transacao', transacaoId, t, novo, justificativa);
    commit(ds);
  },

  /**
   * Cria um lancamento a partir de um movimento bancario sem titulo (tarifa, IOF, recebimento nao cadastrado):
   * nasce Realizado, liquidado na conta do extrato e conciliado com a transacao. Movimento bancario e fato
   * consumado, por isso nao passa por alcada; fica na auditoria como "lancar_transacao".
   */
  lancarTransacao(transacaoId: string, dados: { categoria: string; contraparte: string; descricao: string; codigoObra?: string; servicoId?: string; subcategoria?: string; centroCusto?: string; documento?: string; observacoes?: string }) {
    let ds = state.ds;
    exigir('conciliar');
    const t = ds.transacoes.find((x) => x.id === transacaoId);
    if (!t) throw new RegraDeNegocioError('Transação não encontrada.');
    if (t.lancamentoIds.length) throw new RegraDeNegocioError('Transação já conciliada.');
    const movimento = t.credito - t.debito;
    if (!movimento) throw new RegraDeNegocioError('Transação sem valor.');
    const plano = mapaPlano(ds).get(dados.categoria);
    if (!plano) throw new RegraDeNegocioError('Categoria inválida.');
    if ((movimento > 0) !== (plano.tipo === 'Entrada')) throw new RegraDeNegocioError(`Movimento ${movimento > 0 ? 'de crédito' : 'de débito'} exige categoria de ${movimento > 0 ? 'Entrada' : 'Saída'}.`);
    const valor = Math.abs(movimento);
    const l: Lancamento = {
      ...this.novoLancamento({ categoria: dados.categoria }),
      categoria: dados.categoria, subcategoria: dados.subcategoria ?? '', centroCusto: dados.centroCusto ?? (dados.codigoObra ? 'Obra' : 'Corporativo'), codigoObra: dados.codigoObra ?? '', servicoId: dados.servicoId,
      contraparte: dados.contraparte, documento: dados.documento ?? t.documento ?? t.idExterno ?? '', descricao: dados.descricao,
      competencia: t.data, vencimento: t.data, realizacao: t.data, status: 'Realizado', confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: t.conta,
      valorBruto: valor, retencoes: 0, desconto: 0, multaJuros: 0, valorRealizado: valor, conciliado: true, observacoes: dados.observacoes ?? `Gerado do extrato ${t.id}: ${t.historico}`, origem: t.origem === 'ofx' ? 'ofx' : 'extrato', idExterno: t.idExterno ?? t.id, versao: 1,
    };
    const erros = validarLancamento(ds, l);
    if (erros.length) throw new RegraDeNegocioError(erros.join(' '), erros);
    const liq: Liquidacao = { id: seq('LIQ', ds.liquidacoes.map((q) => q.id)), lancamentoId: l.id, data: t.data, valor, conta: t.conta, documento: t.documento || t.idExterno || t.id, criadoPor: state.usuario.nome, criadoEm: agora() };
    const novaT: TransacaoBancaria = { ...t, lancamentoIds: [l.id], justificativa: undefined };
    ds = { ...ds, lancamentos: [...ds.lancamentos, l], liquidacoes: [...ds.liquidacoes, liq], transacoes: ds.transacoes.map((x) => (x.id === transacaoId ? novaT : x)) };
    ds = registrar(ds, 'lancar_transacao', 'lancamento', l.id, undefined, { lancamento: l, transacao: transacaoId });
    commit(ds);
    return l;
  },

  comentar(entidade: string, entidadeId: string, texto: string) {
    let ds = state.ds;
    exigir('comentar');
    if (!texto.trim()) return;
    const mencoes = [...texto.matchAll(/@([\wÀ-ú.]+)/g)].map((m) => m[1]);
    const c: Comentario = { id: seq('COM', ds.comentarios.map((x) => x.id)), entidade, entidadeId, autor: state.usuario.nome, ts: agora(), texto, mencoes };
    ds = { ...ds, comentarios: [...ds.comentarios, c] };
    commit(ds);
  },

  criarTarefa(t: Omit<Tarefa, 'id' | 'status' | 'criadoEm'>) {
    let ds = state.ds;
    exigir('comentar');
    if (!t.titulo.trim() || !t.responsavel) throw new RegraDeNegocioError('Título e responsável são obrigatórios.');
    const tarefa: Tarefa = { ...t, id: seq('TSK', ds.tarefas.map((x) => x.id)), status: 'Aberta', criadoEm: agora() };
    ds = registrar({ ...ds, tarefas: [...ds.tarefas, tarefa] }, 'criar_tarefa', 'tarefa', tarefa.id, undefined, tarefa);
    commit(ds);
  },

  concluirTarefa(id: string) {
    const ds = state.ds;
    commit({ ...ds, tarefas: ds.tarefas.map((t) => (t.id === id ? { ...t, status: 'Concluída' } : t)) });
  },

  /** CTL-003: fechamento bloqueia edicao retroativa; exige checks bloqueantes zerados. */
  fecharPeriodo(periodo: string) {
    let ds = state.ds;
    exigir('fechar_periodo');
    const checks = executarChecks(ds);
    if (statusModelo(checks) === 'FAIL') throw new RegraDeNegocioError('Fechamento bloqueado: há checks de integridade com falha.');
    if (ds.fechamentos.some((f) => f.periodo === periodo && !f.reaberto)) throw new RegraDeNegocioError('Período já fechado.');
    const f = { periodo, fechadoEm: agora(), fechadoPor: state.usuario.nome };
    ds = registrar({ ...ds, fechamentos: [...ds.fechamentos.filter((x) => x.periodo !== periodo), f] }, 'fechar_periodo', 'periodo', periodo, undefined, f);
    commit(ds);
  },

  reabrirPeriodo(periodo: string, motivo: string) {
    let ds = state.ds;
    exigir('reabrir_periodo');
    if (!motivo.trim()) throw new RegraDeNegocioError('Motivo obrigatório.');
    const f = ds.fechamentos.find((x) => x.periodo === periodo && !x.reaberto);
    if (!f) throw new RegraDeNegocioError('Período não está fechado.');
    const novo = { ...f, reaberto: { em: agora(), por: state.usuario.nome, motivo } };
    ds = registrar({ ...ds, fechamentos: ds.fechamentos.map((x) => (x === f ? novo : x)) }, 'reabrir_periodo', 'periodo', periodo, f, novo, motivo);
    commit(ds);
  },

  exportarJson(): string {
    exigir('exportar');
    const ds = registrar(state.ds, 'exportar_dados', 'dataset', 'json');
    commit(ds);
    return JSON.stringify(state.ds, null, 2);
  },

  importarJson(texto: string) {
    exigir('administrar');
    const ds = JSON.parse(texto) as Dataset;
    if (!ds.params || !Array.isArray(ds.lancamentos)) throw new RegraDeNegocioError('Arquivo inválido.');
    commit(registrar(ds, 'importar_dados', 'dataset', 'json'));
  },

  restaurarPlanilha() {
    exigir('administrar');
    const ds = clone(seed) as unknown as Dataset;
    commit(registrar(ds, 'restaurar_seed', 'dataset', 'seed'));
  },
};

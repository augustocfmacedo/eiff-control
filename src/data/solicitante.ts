// Perfil Solicitante (equipe que so conversa com o Diretor Financeiro). No banco ele nao le nenhuma tabela (0067): tudo vem
// das portas df_contexto / df_meus_pedidos e o pedido vai por df_registrar_pedido. Aqui ficam as conversoes PURAS entre o
// que as portas devolvem e o Dataset que o app usa — um Dataset minimo: o catalogo do pedido (categorias de saida e obras
// ativas) e os pedidos da propria pessoa. Nada de saldo, conta, lancamento alheio ou cadastro.
import seed from './seed.json';
import type { AlteracaoPedido, Dataset, Lancamento, Obra, PlanoConta, StatusAlteracaoPedido, StatusLancamento, Usuario } from '../core/types';
import { ORIGEM_DF } from '../core/cfo';

export interface ContextoSolicitante {
  perfil: { id: string; nome: string; email: string; papel: string };
  organizacao: string;
  categorias: { categoria: string; grupoFluxo: string }[];
  obras: { codigo: string; nome: string }[];
}
export interface PedidoSolicitante {
  codigo: string; descricao: string; contraparte: string | null; categoria: string | null; codigoObra: string | null;
  valor: number; vencimento: string; status: StatusLancamento; motivoCancelamento: string | null; excluido: boolean; reagendado: boolean;
  criadoEm: string; atualizadoEm: string; repetido?: boolean;
  /** ultima alteracao de valor pedida (0071); ausente antes da migration */
  alteracao?: AlteracaoJson | null;
}
/** Alteracao de valor como as portas devolvem (df_alteracao_json, 0071). */
export interface AlteracaoJson {
  id: string; codigo: string; solicitadoPor: string | null; solicitadoEm: string; valorAnterior: number; valorNovo: number; motivo: string;
  status: StatusAlteracaoPedido; decididoPor: string | null; decididoEm: string | null; motivoDecisao: string | null; repetido?: boolean;
}
export function alteracaoDoJson(a: AlteracaoJson, autor = ''): AlteracaoPedido {
  return {
    id: a.id, lancamentoId: a.codigo, solicitadoPor: a.solicitadoPor ?? autor, solicitadoEm: a.solicitadoEm, valorAnterior: Number(a.valorAnterior), valorNovo: Number(a.valorNovo),
    motivo: a.motivo, status: a.status, decididoPor: a.decididoPor ?? undefined, decididoEm: a.decididoEm ?? undefined, motivoDecisao: a.motivoDecisao ?? undefined,
  };
}
export interface NovoPedidoSolicitante { valor: number; vencimento: string; categoria: string; codigoObra?: string; contraparte: string; descricao: string; observacoes?: string }

/** Esqueleto vazio do Dataset: a mesma forma da semente, com toda lista vazia (inclusive dentro do radar). */
function esvaziar<T>(v: T): T {
  if (Array.isArray(v)) return [] as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, esvaziar(x)])) as T;
  return v;
}

/** Copia com valores neutros (texto vazio, zero, falso): so a forma do registro, nenhum dado da semente. */
function zerar<T>(v: T): T {
  if (Array.isArray(v)) return [] as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, zerar(x)])) as T;
  return (typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : typeof v === 'string' ? '' : v) as T;
}

export function lancamentoDoPedido(p: PedidoSolicitante, autor: string): Lancamento {
  return {
    id: p.codigo, registro: 'Real', categoria: p.categoria ?? 'Outros pagamentos', subcategoria: '', centroCusto: p.codigoObra ? 'Obra' : 'Corporativo',
    codigoObra: p.codigoObra ?? '', contraparte: p.contraparte ?? 'A definir', documento: '', descricao: p.descricao,
    competencia: p.vencimento, vencimento: p.vencimento, status: p.status, confiabilidade: 'Estimado', probabilidade: 1, contaFinanceira: '',
    valorBruto: Number(p.valor), retencoes: 0, desconto: 0, multaJuros: 0, conciliado: false,
    // statusPedidoDF reconhece o reagendamento por esta frase nas observacoes
    observacoes: p.reagendado ? 'Reagendada no alinhamento diário.' : '', anexos: [], origem: ORIGEM_DF,
    criadoEm: p.criadoEm, criadoPor: autor, atualizadoEm: p.atualizadoEm, atualizadoPor: '', versao: 1,
    motivoCancelamento: p.motivoCancelamento ?? undefined, excluidoEm: p.excluido ? p.atualizadoEm : undefined,
  };
}

/** Alteracoes de valor que vieram junto com os pedidos (so a ultima de cada um). */
export const alteracoesDosPedidos = (pedidos: PedidoSolicitante[], autor: string): AlteracaoPedido[] => pedidos.flatMap((p) => (p.alteracao ? [alteracaoDoJson(p.alteracao, autor)] : []));

/** Dataset do Solicitante a partir das portas do banco. `hoje` = data local (data-base fixa: o Solicitante nao grava parametros). */
export function datasetSolicitante(ctx: ContextoSolicitante, pedidos: PedidoSolicitante[], hoje: string): { ds: Dataset; usuario: Usuario } {
  const usuario: Usuario = { id: ctx.perfil.id, nome: ctx.perfil.nome, email: ctx.perfil.email, papel: 'Solicitante', obras: [], ativo: true };
  const base = esvaziar(seed as unknown as Dataset);
  const planoContas: PlanoConta[] = ctx.categorias.map((c) => ({ categoria: c.categoria, tipo: 'Saída', grupoFluxo: c.grupoFluxo, grupoDre: '', classe: '', orientacao: '', ativa: true }));
  const obras = ctx.obras.map((o) => ({ ...(zerar((seed as unknown as Dataset).obras[0] ?? {}) as Obra), codigo: o.codigo, nome: o.nome, registro: 'Real', status: 'Em execução' }) as Obra);
  const ds: Dataset = {
    ...base,
    params: { ...(seed as unknown as Dataset).params, dataBase: hoje, dataBaseAutomatica: false, reservaMinima: 0, corteExtrato: undefined },
    planoContas, obras, usuarios: [usuario],
    lancamentos: pedidos.map((p) => lancamentoDoPedido(p, usuario.nome)),
    alteracoesPedido: alteracoesDosPedidos(pedidos, usuario.nome),
  };
  return { ds, usuario };
}

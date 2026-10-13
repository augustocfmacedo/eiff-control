// Perfil Solicitante (equipe que so conversa com o Diretor Financeiro). No banco ele nao le nenhuma tabela (0066): tudo vem
// das portas df_contexto / df_meus_pedidos e o pedido vai por df_registrar_pedido. Aqui ficam as conversoes PURAS entre o
// que as portas devolvem e o Dataset que o app usa — um Dataset minimo: o catalogo do pedido (categorias de saida e obras
// ativas) e os pedidos da propria pessoa. Nada de saldo, conta, lancamento alheio ou cadastro.
import seed from './seed.json';
import type { Dataset, Lancamento, Obra, PlanoConta, StatusLancamento, Usuario } from '../core/types';
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
  };
  return { ds, usuario };
}

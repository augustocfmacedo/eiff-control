// UX-P05 — Compras compacto: view-model puro do piloto (somente leitura).
//
// Mesma filosofia dos pilotos de Financeiro e Obras: SITUACAO (poucos numeros canonicos) → lista curta (pedidos em aberto
// na Operacao, obras na Diretoria) → PENDENCIAS (fatos do fluxo de compras) → COMPOSICAO em gaveta, so quando pedida →
// FRESCOR e SINCRONIZACAO separados.
//
// Este modulo NAO calcula nada de compras. Ele SELECIONA, AGRUPA, ORDENA e ROTULA o que o core ja devolve:
// `resumoCompras`/`calcPedido` e `comparativoOrcadoComprado` (compras), `obra360().custoComprometido` e `calcLancamentos().oficial`
// (engine), `posicaoEstoque` (estoque) e `sugestoesPara` (sugestoes).
//
// SEVERIDADE: o dominio de compras NAO tem severidade canonica (nenhuma sugestao para /compras ou /estoque, nenhum check
// do motor sobre pedido). Por isso as pendencias sao fatos NEUTROS, sem bad/warn/info, sem score e sem ordem de
// prioridade: a ordem e a do catalogo de tipos (`TIPOS_PENDENCIA`). A unica excecao e a sugestao canonica
// `obra-<codigo>-direto`, que preserva o tom que o core ja atribui.
//
// EMITIDO != COMPROMETIDO: `resumoCompras.emitido` (pedidos ativos, inclusive com lancamento aguardando aprovacao) e
// `obra360.custoComprometido` (saidas oficiais de custo direto da obra, de qualquer origem) sao grandezas diferentes. O
// piloto mostra as duas lado a lado na composicao da obra, cada uma com sua funcao e regra, e nunca calcula a diferenca.
//
// NECESSIDADE: nao existe resultado canonico de necessidade, falta ou bloqueio por material. O piloto nao fala em
// "precisa comprar" nem em "falta": so o saldo a receber de cada item (`ItemPedidoCalc.saldoReceber`).
//
// VISIBILIDADE: o modelo recebe `codigosObraVisiveis` e limita a apresentacao a esse conjunto. Ele nao decide quem ve o
// que (isso e do App, pela regra oficial). Valores em R$ da carteira inteira so aparecem quando o conjunto visivel cobre
// todas as obras e todos os pedidos; com subconjunto, os valores ficam por obra e nunca sao somados aqui. O estoque e
// global e so de aco: so aparece com a carteira completa.
import { calcLancamentos, fmtBr, obra360, type LancamentoCalc } from '../../core/engine';
import { comparativoOrcadoComprado, resumoCompras, type Comparativo, type PedidoCalc, type ResumoCompras } from '../../core/compras';
import { posicaoEstoque, type PosicaoEstoque } from '../../core/estoque';
import { sugestoesPara, type Sugestao } from '../../core/sugestoes';
import type { Aprovacao, Dataset, Obra, Usuario } from '../../core/types';

export const VERSAO_PILOTO = 'UX-P05.1';
export const TETO_SITUACAO: Record<Visao, number> = { diretoria: 3, operacao: 4 };
export const TETO_PENDENCIAS = 6;
export const TETO_PEDIDOS = 8;
export const TEXTO_CARTEIRA_PARCIAL = 'carteira inteira não visível';
export const TEXTO_ESTOQUE_INDISPONIVEL = 'Estoque global indisponível nesta visão';

export type Visao = 'diretoria' | 'operacao';
export const VISOES: { id: Visao; rotulo: string; descricao: string }[] = [
  { id: 'diretoria', rotulo: 'Diretoria', descricao: 'Pedidos emitidos, pedidos atrasados e aprovações, com os valores por obra.' },
  { id: 'operacao', rotulo: 'Operação', descricao: 'Rascunhos, aprovações, a receber e pedidos atrasados, pedido a pedido.' },
];

/** Status em que o pedido ainda tem fluxo pela frente (entra na lista de pedidos em aberto). */
export const STATUS_EM_ABERTO: PedidoCalc['status'][] = ['Rascunho', 'Emitido', 'Recebido parcial'];

/**
 * Catalogo NEUTRO de pendencias: fatos que o core ja expoe sobre o fluxo de compras. A ordem e so a do catalogo (nao e
 * prioridade) e nenhum tipo carrega severidade.
 */
export const TIPOS_PENDENCIA = ['pedido-atrasado', 'aguardando-aprovacao', 'lancamento-rascunho', 'lancamento-ausente', 'rascunho', 'fora-orcamento', 'estoque-minimo', 'sugestao-direto'] as const;
export type TipoPendencia = (typeof TIPOS_PENDENCIA)[number];
export const ROTULO_PENDENCIA: Record<TipoPendencia, string> = {
  'pedido-atrasado': 'Pedido com entrega atrasada',
  'aguardando-aprovacao': 'Lançamento do pedido aguardando aprovação',
  'lancamento-rascunho': 'Pedido emitido · lançamento em Rascunho',
  'lancamento-ausente': 'Lançamento vinculado não encontrado',
  rascunho: 'Pedido em rascunho, ainda não emitido',
  'fora-orcamento': 'Comprado fora do orçamento',
  'estoque-minimo': 'Itens de estoque abaixo do mínimo',
  'sugestao-direto': 'Faturamento direto acima do saldo contratado',
};

export interface Sincronizacao { estado: 'sincronizado' | 'enviando' | 'pendente' | 'erro' | 'local'; em?: string; desde?: string; msg?: string }
export const ROTULO_SINCRONIZACAO: Record<Sincronizacao['estado'], string> = { sincronizado: 'Supabase · sincronizado', enviando: 'Supabase · sincronizando…', pendente: 'offline · alterações guardadas neste aparelho', erro: 'não sincronizado', local: 'modo local · seed' };
export interface FonteDados { rotulo: string; modo: 'teste' | 'local' | 'remoto'; atualizadoEm?: string; id?: string; sincronizacao?: Sincronizacao }

export type EntradaCompras =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'pronto'; fonte: FonteDados; ds: Dataset; usuario: Usuario; codigosObraVisiveis: string[]; agora: string; visao?: Visao };

export interface Origem { funcao: string; campo: string; regra: string; tela?: string }
export interface ParteSituacao { rotulo: string; valor: number | null; texto: string }
/** Tile de situacao: sem `tom` por construcao (compras nao tem severidade canonica). */
export interface ItemSituacao {
  id: 'emitidos' | 'atrasadas' | 'aprovacao' | 'rascunhos' | 'areceber';
  rotulo: string;
  valor: number | null;
  texto: string;
  micro?: string;
  partes: ParteSituacao[];
  origem: Origem;
  composicaoId?: string;
}
export interface LinhaPedido {
  id: string;
  codigo: string;
  fornecedor: string;
  codigoObra: string;
  nomeObra: string;
  servico?: string;
  status: PedidoCalc['status'];
  previsaoEntrega?: string;
  diasParaEntrega?: number;
  atrasado: boolean;
  total: number;
  totalRecebido: number;
  pctRecebido: number;
  itens: number;
  itensComSaldo: number;
  criadoPor: { id: string; nome?: string };
  /** undefined = pedido sem lancamento (rascunho); null = lancamentoId aponta para lancamento que nao existe. */
  lancamento?: { id: string; status: LancamentoCalc['status']; oficial?: boolean } | null;
  faturamentoDireto: boolean;
  composicaoId: string;
  to: string;
}
export interface LinhaObraCompras {
  codigo: string;
  nome: string;
  status: Obra['status'];
  pedidos: number;
  emitido: number;
  recebido: number;
  aReceber: number;
  atrasados: number;
  aguardandoAprovacao: number;
  rascunhos: number;
  composicoes: { id: string; rotulo: string }[];
  to: string;
}
export interface ItemPendencia {
  id: string;
  tipo: TipoPendencia;
  obra?: string;
  pedidoId?: string;
  texto: string;
  impacto: string;
  detalhe?: string;
  /** So existe quando a fonte e uma sugestao canonica do core (que ja traz o tom). */
  tom?: Sugestao['tom'];
  origem: Origem;
  destino?: { rotulo: string; to: string };
  composicaoId?: string;
}
export interface ParComposicao { rotulo: string; texto: string; sub?: string; to?: string }
export interface LinhaComposicao { id: string; titulo: string; sub?: string; data?: string; valor: number | null; texto: string; to?: string }
export interface Composicao {
  id: string;
  titulo: string;
  resumo: string;
  origem: Origem;
  pares: ParComposicao[];
  colunas: { titulo: string; num?: boolean }[];
  linhas: LinhaComposicao[];
  total?: { rotulo: string; valor: number; texto: string };
  nota?: string;
}
export interface ChipFrescor { id: string; texto: string; titulo?: string }
export interface Frescor { dataBase: string; ultimaAtualizacaoPedido?: string; ultimoMovimentoEstoque?: string; fonteAtualizadaEm?: string; chips: ChipFrescor[] }

export type ModeloCompras =
  | { estado: 'carregando'; fonte: FonteDados }
  | { estado: 'erro'; fonte: FonteDados; mensagem: string; causa?: string }
  | { estado: 'vazio'; fonte: FonteDados; semObras: boolean; motivo: string; frescor: Frescor }
  | { estado: 'sem-visibilidade'; fonte: FonteDados; motivo: string; frescor: Frescor; totalObras: number }
  | {
      estado: 'pronto';
      fonte: FonteDados;
      visao: Visao;
      empresa: string;
      usuario: { nome: string; papel: string };
      carteiraCompleta: boolean;
      obrasNoConjunto: number;
      totalObras: number;
      situacao: ItemSituacao[];
      /** Os dois conjuntos de tiles, com os MESMOS objetos: a visao so escolhe quais mostrar. */
      tiles: Record<ItemSituacao['id'], ItemSituacao>;
      obras: LinhaObraCompras[];
      pedidos: { compacta: LinhaPedido[]; todos: LinhaPedido[]; ocultos: number };
      pendencias: { compacta: ItemPendencia[]; todas: ItemPendencia[]; ocultas: number };
      estoque: { visivel: true; abaixoMinimo: number; saldoKg: number; composicaoId: string } | { visivel: false; motivo: string };
      composicoes: Record<string, Composicao>;
      frescor: Frescor;
    };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : brl.format(v));
export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const qtd = (v: number, unidade: string) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unidade}`.trim();
export const kg = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} kg`;
export const diaMes = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const n = (q: number, s: string, p: string) => `${q} ${q === 1 ? s : p}`;
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
const ultimaData = (datas: (string | undefined)[]) => datas.filter((d): d is string => !!d).sort().pop();

/** Previsao de entrega em palavras, a partir de `diasParaEntrega` do core (so o sinal vira texto; ausente nunca vira 0). */
export function textoEntrega(previsao: string | undefined, dias: number | undefined): string {
  if (!previsao || dias === undefined) return 'sem previsão de entrega';
  if (dias < 0) return `previsão ${diaMes(previsao)} · atrasado ${n(-dias, 'dia', 'dias')}`;
  if (dias === 0) return `previsão ${diaMes(previsao)} · hoje`;
  return `previsão ${diaMes(previsao)} · em ${n(dias, 'dia', 'dias')}`;
}

function frescorDe(ds: Dataset, pedidos: PedidoCalc[], carteiraCompleta: boolean, fonte: FonteDados, agora: string): Frescor {
  const ultimaAtualizacaoPedido = ultimaData(pedidos.map((p) => p.atualizadoEm));
  const ultimoMovimentoEstoque = carteiraCompleta ? ultimaData((ds.movimentosEstoque ?? []).map((m) => m.data)) : undefined;
  const chips: ChipFrescor[] = [
    { id: 'base', texto: `Base ${diaMes(ds.params.dataBase)}`, titulo: `Data-base ${fmtBr(ds.params.dataBase)}: referência de "pedido atrasado" (calcPedido.atrasado)` },
    ultimaAtualizacaoPedido ? { id: 'pedido', texto: `Pedido atualizado ${tempoRelativo(ultimaAtualizacaoPedido, agora)}`, titulo: `Última atualização de pedido visível: ${new Date(ultimaAtualizacaoPedido).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` } : { id: 'pedido', texto: 'Sem pedido visível', titulo: 'Nenhum pedido nas obras visíveis.' },
  ];
  if (carteiraCompleta) chips.push(ultimoMovimentoEstoque ? { id: 'estoque', texto: `Último movimento de estoque ${diaMes(ultimoMovimentoEstoque)}`, titulo: `Estoque de aço (global): ${fmtBr(ultimoMovimentoEstoque)}` } : { id: 'estoque', texto: 'Sem movimento de estoque', titulo: 'Nenhum movimento de estoque registrado.' });
  chips.push(fonte.atualizadoEm
    ? { id: 'atualizado', texto: `Atualizado ${tempoRelativo(fonte.atualizadoEm, agora)}`, titulo: `Fonte ${fonte.rotulo}` }
    : fonte.modo === 'local' ? { id: 'atualizado', texto: 'Seed local', titulo: 'Dados do seed em modo local: não são a operação real.' }
      : fonte.modo === 'teste' ? { id: 'atualizado', texto: 'Dados de teste', titulo: 'Fixture do piloto: nenhum número é real.' }
        : { id: 'atualizado', texto: 'Atualização desconhecida', titulo: 'A fonte não informou quando foi sincronizada.' });
  return { dataBase: ds.params.dataBase, ultimaAtualizacaoPedido, ultimoMovimentoEstoque, fonteAtualizadaEm: fonte.atualizadoEm, chips };
}

const TELA_COMPRAS = (obra?: string) => (obra ? `/compras?obra=${obra}` : '/compras');

function nomeUsuario(ds: Dataset, id: string): string | undefined {
  return ds.usuarios.find((u) => u.id === id)?.nome;
}

function aprovacaoDe(ds: Dataset, lancamentoId?: string): Aprovacao | undefined {
  if (!lancamentoId) return undefined;
  const todas = ds.aprovacoes.filter((a) => a.entidadeId === lancamentoId);
  return todas.find((a) => a.status === 'Pendente') ?? todas.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))[0];
}

function linhaPedido(p: PedidoCalc, ds: Dataset, lancPorId: Map<string, LancamentoCalc>): LinhaPedido {
  const obra = ds.obras.find((o) => o.codigo === p.codigoObra);
  const servico = p.servicoId ? ds.servicos.find((s) => s.id === p.servicoId) : undefined;
  const lc = p.lancamentoId ? lancPorId.get(p.lancamentoId) : undefined;
  const lancamento = !p.lancamentoId ? undefined : p.lancamento ? { id: p.lancamento.id, status: p.lancamento.status, oficial: lc?.oficial } : null;
  return {
    id: p.id, codigo: p.codigo, fornecedor: p.fornecedor, codigoObra: p.codigoObra, nomeObra: obra?.nome ?? p.codigoObra, servico: servico ? `${servico.codigo} · ${servico.nome}` : undefined,
    status: p.status, previsaoEntrega: p.previsaoEntrega, diasParaEntrega: p.diasParaEntrega, atrasado: p.atrasado,
    total: p.total, totalRecebido: p.totalRecebido, pctRecebido: p.pctRecebido, itens: p.itens.length, itensComSaldo: p.itens.filter((i) => i.saldoReceber > 0).length,
    criadoPor: { id: p.criadoPor, nome: nomeUsuario(ds, p.criadoPor) }, lancamento, faturamentoDireto: p.faturamentoDireto,
    composicaoId: `pedido:${p.id}`, to: TELA_COMPRAS(p.codigoObra),
  };
}

function composicaoPedido(p: PedidoCalc, l: LinhaPedido, ds: Dataset, estoque: PosicaoEstoque | null): Composicao {
  const pares: ParComposicao[] = [
    { rotulo: 'Fornecedor', texto: p.fornecedor },
    { rotulo: 'Obra', texto: `${l.codigoObra} · ${l.nomeObra}`, sub: l.servico ? `serviço ${l.servico}` : 'sem serviço vinculado', to: `/obras/${p.codigoObra}` },
    { rotulo: 'Entrega', texto: textoEntrega(p.previsaoEntrega, p.diasParaEntrega), sub: 'calcPedido.diasParaEntrega = previsão − data-base' },
    { rotulo: 'Total do pedido', texto: moeda(p.total), sub: 'calcPedido.total = Σ quantidade × preço' },
    { rotulo: 'Recebido (material)', texto: `${moeda(p.totalRecebido)} · ${pct(p.pctRecebido)}`, sub: 'calcPedido.totalRecebido: material recebido, em valor. Não é pagamento.' },
    { rotulo: 'Criado por', texto: l.criadoPor.nome ?? `usuário não encontrado (${l.criadoPor.id})`, sub: 'PedidoCompra.criadoPor' },
  ];
  if (!p.lancamentoId) pares.push({ rotulo: 'Lançamento', texto: 'sem lançamento', sub: 'o lançamento nasce ao emitir o pedido' });
  else if (!p.lancamento) pares.push({ rotulo: 'Lançamento', texto: `vínculo ${p.lancamentoId} não encontrado`, sub: 'PedidoCompra.lancamentoId aponta para um lançamento ausente' });
  else {
    pares.push({ rotulo: 'Lançamento', texto: `${p.lancamento.id} · ${p.lancamento.status}`, sub: `vencimento ${fmtBr(p.lancamento.vencimento)} · o pagamento segue o status do lançamento${l.lancamento?.oficial === false ? ' · ainda não entra no custo comprometido (engine: oficial)' : ''}`, to: `/lancamentos/${p.lancamento.id}` });
    const apr = aprovacaoDe(ds, p.lancamento.id);
    if (apr) for (const [i, e] of apr.etapas.entries()) pares.push({ rotulo: `Aprovação · etapa ${i + 1}`, texto: `${e.papel}: ${e.status}`, sub: e.decididoPor ? `por ${e.decididoPor}${e.decididoEm ? ` em ${fmtBr(e.decididoEm.slice(0, 10))}` : ''}` : `${apr.id} · aberta em ${fmtBr(apr.criadoEm.slice(0, 10))}`, to: `/aprovacoes?id=${apr.id}` });
  }
  const itemEstoque = (insumoId?: string) => (estoque && insumoId ? estoque.itens.find((i) => i.insumoId === insumoId) : undefined);
  return {
    id: l.composicaoId, titulo: `Pedido ${p.codigo} · ${p.fornecedor}`, resumo: `${p.status} · ${n(p.itens.length, 'item', 'itens')} · ${n(l.itensComSaldo, 'item com saldo a receber', 'itens com saldo a receber')}`,
    origem: { funcao: 'calcPedido(pedido, ds, dataBase)', campo: 'itens[].total · quantidadeRecebida · saldoReceber · desvioPreco · atrasado · lancamento', regra: 'os mesmos números da tela Compras; saldo a receber é quantidade (não é falta nem necessidade)', tela: TELA_COMPRAS(p.codigoObra) },
    pares,
    colunas: [{ titulo: 'Item · recebido / saldo' }, { titulo: '' }, { titulo: 'Total', num: true }],
    linhas: p.itens.map((it) => {
      // o estoque e sempre em kg: so aparece ao lado de item pedido em kg (unidades diferentes nunca se misturam)
      const ie = it.unidade.trim().toLowerCase() === 'kg' ? itemEstoque(it.insumoId) : undefined;
      const estoqueTxt = ie ? ` · estoque de aço (global) ${kg(ie.saldo)}` : '';
      const catalogo = it.desvioPreco === undefined ? 'sem preço de catálogo' : `preço ${pct(it.desvioPreco)} vs catálogo`;
      return { id: it.id, titulo: it.descricao, sub: `pedido ${qtd(it.quantidade, it.unidade)} · recebido ${qtd(it.quantidadeRecebida, it.unidade)} · saldo a receber ${qtd(it.saldoReceber, it.unidade)} · ${catalogo}${estoqueTxt}`, valor: it.total, texto: moeda(it.total) };
    }),
    total: { rotulo: 'Total do pedido (calcPedido.total)', valor: p.total, texto: moeda(p.total) },
    nota: estoque ? undefined : 'Estoque do insumo não é apresentado: o estoque é global e esta visão não cobre a carteira inteira.',
  };
}

function composicaoObra(obra: Obra, r: ResumoCompras, comprometido: number, lancPorId: Map<string, LancamentoCalc>): Composicao {
  const ativos = r.pedidos.filter((p) => p.ativo);
  return {
    id: `obra-compras:${obra.codigo}`, titulo: `Compras · ${obra.nome}`, resumo: `${n(r.pedidos.length, 'pedido', 'pedidos')} · pedidos emitidos e custo comprometido são grandezas diferentes`,
    origem: { funcao: `resumoCompras(ds, '${obra.codigo}') · obra360(ds, obra).custoComprometido`, campo: 'emitido · recebido · aReceber · direto · custoComprometido', regra: 'cada valor com a sua função e a sua regra; o piloto não calcula diferença entre eles', tela: TELA_COMPRAS(obra.codigo) },
    pares: [
      { rotulo: 'Pedidos emitidos', texto: moeda(r.emitido), sub: 'resumoCompras.emitido: pedidos ativos (emitido, recebido parcial, recebido), inclusive com lançamento aguardando aprovação' },
      { rotulo: 'Recebido (material)', texto: moeda(r.recebido), sub: 'resumoCompras.recebido' },
      { rotulo: 'A receber', texto: moeda(r.aReceber), sub: 'resumoCompras.aReceber = emitido − recebido' },
      { rotulo: 'Faturamento direto', texto: moeda(r.direto), sub: 'resumoCompras.direto: pedidos ativos pagos direto pelo cliente' },
      { rotulo: 'Custo comprometido', texto: moeda(comprometido), sub: 'obra360.custoComprometido: saídas oficiais de custo direto da obra, de qualquer origem (lançamento Pendente ou Rascunho não entra)', to: `/obras/${obra.codigo}` },
    ],
    colunas: [{ titulo: 'Pedido ativo · lançamento' }, { titulo: 'Data' }, { titulo: 'Total', num: true }],
    linhas: ativos.map((p) => {
      const lc = p.lancamentoId ? lancPorId.get(p.lancamentoId) : undefined;
      const lanc = !p.lancamentoId ? 'sem lançamento' : !p.lancamento ? `lançamento ${p.lancamentoId} não encontrado` : `lançamento ${p.lancamento.status}${lc ? (lc.oficial ? ' · entra no custo comprometido' : ' · não entra no custo comprometido') : ''}`;
      return { id: p.id, titulo: `${p.codigo} · ${p.fornecedor}`, sub: `${p.status} · ${lanc}`, data: p.data, valor: p.total, texto: moeda(p.total), to: p.lancamento ? `/lancamentos/${p.lancamento.id}` : undefined };
    }),
    total: { rotulo: 'Pedidos emitidos (resumoCompras.emitido)', valor: r.emitido, texto: moeda(r.emitido) },
    nota: 'O custo comprometido não é a soma destes pedidos: inclui outros custos diretos da obra e exclui lançamentos ainda não oficiais.',
  };
}

function composicaoOrcado(obra: Obra, c: Comparativo): Composicao {
  const semOrcamento = c.orcadoValor === 0;
  return {
    id: `orcado:${obra.codigo}`, titulo: `Orçado × comprado · ${obra.nome}`, resumo: semOrcamento ? 'sem orçamento Contratado com insumos para esta obra' : `comprado ${pct(c.pctComprado)} do orçado em valor`,
    origem: { funcao: `comparativoOrcadoComprado(ds, '${obra.codigo}')`, campo: 'linhas[].orcadoQtd · compradoQtd · pctComprado · orcadoValor · compradoValor · compradoForaOrcamento', regra: 'explosão de insumos dos orçamentos Contratados da obra × pedidos não rascunho/cancelados; quantidade na unidade do insumo', tela: TELA_COMPRAS(obra.codigo) },
    pares: [
      { rotulo: 'Orçado', texto: semOrcamento ? 'sem orçamento contratado' : moeda(c.orcadoValor), sub: 'Comparativo.orcadoValor' },
      { rotulo: 'Comprado', texto: moeda(c.compradoValor), sub: 'Comparativo.compradoValor (inclui o comprado fora do orçamento)' },
      { rotulo: 'Fora do orçamento', texto: moeda(c.compradoForaOrcamento), sub: 'Comparativo.compradoForaOrcamento: itens sem insumo do catálogo' },
      { rotulo: 'Comprado do orçado', texto: semOrcamento ? '—' : pct(c.pctComprado), sub: 'Comparativo.pctComprado (em valor)' },
    ],
    colunas: [{ titulo: 'Insumo · orçado / comprado' }, { titulo: 'Classe' }, { titulo: 'Comprado', num: true }],
    linhas: c.linhas.map((l) => ({ id: l.insumoId, titulo: `${l.codigo} · ${l.descricao}`, sub: `orçado ${qtd(l.orcadoQtd, l.unidade)} (${moeda(l.orcadoValor)}) · comprado ${qtd(l.compradoQtd, l.unidade)} · ${l.orcadoQtd ? `${pct(l.pctComprado)} da quantidade` : 'insumo sem quantidade orçada'}`, valor: l.compradoValor, texto: moeda(l.compradoValor) })),
    total: { rotulo: 'Comprado (Comparativo.compradoValor)', valor: c.compradoValor, texto: moeda(c.compradoValor) },
    nota: 'Comprado não é necessidade: o comparativo não diz o que falta comprar.',
  };
}

function composicaoEstoque(e: PosicaoEstoque): Composicao {
  return {
    id: 'estoque', titulo: 'Estoque de aço (global)', resumo: `${kg(e.saldoKg)} em saldo · ${n(e.abaixoMinimo, 'item abaixo do mínimo', 'itens abaixo do mínimo')}`,
    origem: { funcao: 'posicaoEstoque(ds)', campo: 'itens[].saldo · abaixoMinimo · saldoFabrica · saldoObra', regra: 'saldo físico em kg por local; não existe reserva, disponível nem necessidade no core', tela: '/estoque' },
    pares: [
      { rotulo: 'Saldo físico', texto: kg(e.saldoKg), sub: 'PosicaoEstoque.saldoKg' },
      { rotulo: 'Na fábrica · na obra', texto: `${kg(e.saldoFabrica)} · ${kg(e.saldoObra)}`, sub: 'PosicaoEstoque.saldoFabrica · saldoObra' },
      { rotulo: 'Consumido', texto: kg(e.consumidoKg), sub: 'PosicaoEstoque.consumidoKg' },
    ],
    colunas: [{ titulo: 'Item · mínimo' }, { titulo: '' }, { titulo: 'Saldo', num: true }],
    linhas: e.itens.filter((i) => i.abaixoMinimo).map((i) => ({ id: i.id, titulo: `${i.codigo} · ${i.descricao}`, sub: `mínimo ${kg(i.estoqueMinimo)} · ${i.familia}`, valor: i.saldo, texto: kg(i.saldo) })),
    nota: 'Abaixo do mínimo compara o saldo com o estoque mínimo cadastrado; não é falta para uma obra.',
  };
}

export function montarCompras(entrada: EntradaCompras): ModeloCompras {
  if (entrada.estado === 'carregando') return { estado: 'carregando', fonte: entrada.fonte };
  if (entrada.estado === 'erro') return { estado: 'erro', fonte: entrada.fonte, mensagem: entrada.mensagem, causa: entrada.causa };
  const { ds, usuario, fonte, agora, codigosObraVisiveis } = entrada;
  const visao: Visao = entrada.visao ?? 'diretoria';
  if (ds.obras.length === 0) return { estado: 'vazio', fonte, semObras: true, motivo: 'Nenhuma obra cadastrada nesta fonte.', frescor: frescorDe(ds, [], false, fonte, agora) };
  const visiveisSet = new Set(codigosObraVisiveis);
  const obrasVis = ds.obras.filter((o) => visiveisSet.has(o.codigo));
  if (obrasVis.length === 0) return { estado: 'sem-visibilidade', fonte, motivo: 'Nenhuma obra visível para este usuário. A visibilidade é definida pelo aplicativo, não pelo piloto.', frescor: frescorDe(ds, [], false, fonte, agora), totalObras: ds.obras.length };

  const global = resumoCompras(ds);
  // carteira completa = todas as obras E todos os pedidos dentro do conjunto visivel (so entao o agregado global vale para quem ve)
  const carteiraCompleta = ds.obras.every((o) => visiveisSet.has(o.codigo)) && global.pedidos.every((p) => visiveisSet.has(p.codigoObra));
  const pedidosVis = global.pedidos.filter((p) => visiveisSet.has(p.codigoObra));
  if (pedidosVis.length === 0) return { estado: 'vazio', fonte, semObras: false, motivo: 'Nenhum pedido de compra nas obras visíveis.', frescor: frescorDe(ds, [], carteiraCompleta, fonte, agora) };

  const lancs = calcLancamentos(ds);
  const lancPorId = new Map(lancs.map((l) => [l.id, l]));
  const porObra = new Map(obrasVis.map((o) => [o.codigo, resumoCompras(ds, o.codigo)]));
  const comparativos = new Map(obrasVis.map((o) => [o.codigo, comparativoOrcadoComprado(ds, o.codigo)]));
  const comprometido = new Map(obrasVis.map((o) => [o.codigo, obra360(ds, o, lancs).custoComprometido]));
  const estoque = carteiraCompleta ? posicaoEstoque(ds) : null;
  const frescor = frescorDe(ds, pedidosVis, carteiraCompleta, fonte, agora);

  // ---- composicoes ----
  const composicoes: Record<string, Composicao> = {};
  const linhas = pedidosVis.map((p) => linhaPedido(p, ds, lancPorId));
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  for (const p of pedidosVis) { const c = composicaoPedido(p, linhaPorId.get(p.id)!, ds, estoque); composicoes[c.id] = c; }
  for (const o of obrasVis) {
    const c1 = composicaoObra(o, porObra.get(o.codigo)!, comprometido.get(o.codigo)!, lancPorId); composicoes[c1.id] = c1;
    const c2 = composicaoOrcado(o, comparativos.get(o.codigo)!); composicoes[c2.id] = c2;
  }
  if (estoque) { const c = composicaoEstoque(estoque); composicoes[c.id] = c; }

  // ---- SITUACAO: valores canonicos; R$ so com a carteira completa (ou uma unica obra, dita como tal) ----
  const unica = obrasVis.length === 1 ? obrasVis[0] : undefined;
  const rValor: ResumoCompras | undefined = carteiraCompleta ? global : unica ? porObra.get(unica.codigo) : undefined;
  const escopo = carteiraCompleta ? 'todas as obras' : unica ? `somente ${unica.codigo}` : undefined;
  // contagens seguem a mesma regra dos valores: carteira completa (global) ou uma unica obra (resumo filtrado pelo core);
  // com varias obras visiveis e a carteira incompleta, nada e somado aqui: os numeros ficam por obra na lista
  const contagem = (f: (r: ResumoCompras) => number): number | null => (rValor ? f(rValor) : null);
  const tileContagem = (id: 'atrasadas' | 'aprovacao' | 'rascunhos', rotulo: string, f: (r: ResumoCompras) => number, micro: string, origem: Origem): ItemSituacao => {
    const v = contagem(f);
    return { id, rotulo, valor: v, texto: v === null ? TEXTO_CARTEIRA_PARCIAL : String(v), micro: v === null ? 'valores por obra na lista' : `${micro}${escopo === 'todas as obras' ? '' : ` · ${escopo}`}`, partes: [], origem };
  };
  const naoVisivel = (rotulo: string): ParteSituacao => ({ rotulo, valor: null, texto: 'não visível' });
  const composicaoValor = unica ? `obra-compras:${unica.codigo}` : undefined;
  const tiles: Record<ItemSituacao['id'], ItemSituacao> = {
    emitidos: {
      id: 'emitidos', rotulo: 'Pedidos emitidos', valor: rValor ? rValor.emitido : null, texto: rValor ? moeda(rValor.emitido) : TEXTO_CARTEIRA_PARCIAL,
      micro: escopo ?? 'valores por obra na lista',
      partes: rValor ? [{ rotulo: 'Recebido', valor: rValor.recebido, texto: moeda(rValor.recebido) }, { rotulo: 'A receber', valor: rValor.aReceber, texto: moeda(rValor.aReceber) }] : [naoVisivel('Recebido'), naoVisivel('A receber')],
      origem: { funcao: carteiraCompleta ? 'resumoCompras(ds)' : "resumoCompras(ds, codigoObra)", campo: 'emitido · recebido · aReceber', regra: 'valor dos pedidos ativos, inclusive com lançamento aguardando aprovação; não é o custo comprometido', tela: TELA_COMPRAS(unica?.codigo) },
      composicaoId: composicaoValor,
    },
    areceber: {
      id: 'areceber', rotulo: 'A receber', valor: rValor ? rValor.aReceber : null, texto: rValor ? moeda(rValor.aReceber) : TEXTO_CARTEIRA_PARCIAL,
      micro: escopo ?? 'valores por obra na lista',
      partes: rValor ? [{ rotulo: 'Pedidos emitidos', valor: rValor.emitido, texto: moeda(rValor.emitido) }, { rotulo: 'Recebido', valor: rValor.recebido, texto: moeda(rValor.recebido) }] : [naoVisivel('Pedidos emitidos'), naoVisivel('Recebido')],
      origem: { funcao: carteiraCompleta ? 'resumoCompras(ds)' : "resumoCompras(ds, codigoObra)", campo: 'aReceber = emitido − recebido', regra: 'material ainda não recebido, em valor; não é conta a pagar', tela: TELA_COMPRAS(unica?.codigo) },
      composicaoId: composicaoValor,
    },
    atrasadas: tileContagem('atrasadas', 'Pedidos atrasados', (r) => r.atrasados, 'data prevista de entrega já passou, sem recebimento total', { funcao: 'resumoCompras().atrasados', campo: 'PedidoCalc.atrasado', regra: 'pedido ativo, não Recebido, com previsão de entrega antes da data-base', tela: TELA_COMPRAS(unica?.codigo) }),
    aprovacao: tileContagem('aprovacao', 'Aguardando aprovação', (r) => r.aguardandoAprovacao, 'pedidos com lançamento Pendente', { funcao: 'resumoCompras().aguardandoAprovacao', campo: 'PedidoCalc.lancamento.status', regra: 'pedido ativo cujo lançamento está Pendente (alçada)', tela: '/aprovacoes' }),
    rascunhos: tileContagem('rascunhos', 'Rascunhos', (r) => r.rascunhos, 'pedidos ainda não emitidos', { funcao: 'resumoCompras().rascunhos', campo: "status === 'Rascunho'", regra: 'pedidos salvos e não emitidos; não geram lançamento', tela: TELA_COMPRAS(unica?.codigo) }),
  };
  const ordem: Record<Visao, ItemSituacao['id'][]> = { diretoria: ['emitidos', 'atrasadas', 'aprovacao'], operacao: ['rascunhos', 'aprovacao', 'areceber', 'atrasadas'] };
  const situacao = ordem[visao].map((id) => tiles[id]).slice(0, TETO_SITUACAO[visao]);

  // ---- OBRAS (Diretoria): uma linha por obra visivel com pedido, valores de resumoCompras(ds, obra) ----
  const obras: LinhaObraCompras[] = obrasVis.filter((o) => porObra.get(o.codigo)!.pedidos.length > 0).map((o) => {
    const r = porObra.get(o.codigo)!;
    return {
      codigo: o.codigo, nome: o.nome, status: o.status, pedidos: r.pedidos.length, emitido: r.emitido, recebido: r.recebido, aReceber: r.aReceber, atrasados: r.atrasados, aguardandoAprovacao: r.aguardandoAprovacao, rascunhos: r.rascunhos,
      composicoes: [{ id: `obra-compras:${o.codigo}`, rotulo: 'Emitido × comprometido' }, { id: `orcado:${o.codigo}`, rotulo: 'Orçado × comprado' }],
      to: TELA_COMPRAS(o.codigo),
    };
  });

  // ---- PEDIDOS EM ABERTO (Operacao): ordem por previsao de entrega (sem previsao por ultimo), depois codigo ----
  const abertos = linhas.filter((l) => STATUS_EM_ABERTO.includes(l.status)).sort((a, b) => {
    if (a.previsaoEntrega && b.previsaoEntrega && a.previsaoEntrega !== b.previsaoEntrega) return a.previsaoEntrega < b.previsaoEntrega ? -1 : 1;
    if (!!a.previsaoEntrega !== !!b.previsaoEntrega) return a.previsaoEntrega ? -1 : 1;
    return a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;
  });

  // ---- PENDENCIAS: fatos neutros, na ordem do catalogo ----
  const pend: ItemPendencia[] = [];
  for (const p of pedidosVis) {
    const l = linhaPorId.get(p.id)!;
    const base = { obra: p.codigoObra, pedidoId: p.id, composicaoId: l.composicaoId };
    if (p.atrasado) pend.push({ ...base, id: `pedido-atrasado:${p.id}`, tipo: 'pedido-atrasado', texto: `${p.codigo} · ${p.fornecedor}`, impacto: textoEntrega(p.previsaoEntrega, p.diasParaEntrega), detalhe: `${p.codigoObra} · ${n(l.itensComSaldo, 'item com saldo a receber', 'itens com saldo a receber')}`, origem: { funcao: 'calcPedido().atrasado', campo: 'previsaoEntrega · diasParaEntrega', regra: 'ativo, não Recebido e previsão antes da data-base', tela: TELA_COMPRAS(p.codigoObra) }, destino: { rotulo: 'Ver compras da obra', to: TELA_COMPRAS(p.codigoObra) } });
    if (p.ativo && p.lancamento?.status === 'Pendente') {
      const apr = aprovacaoDe(ds, p.lancamento.id);
      pend.push({ ...base, id: `aguardando-aprovacao:${p.id}`, tipo: 'aguardando-aprovacao', texto: `${p.codigo} · ${p.fornecedor}`, impacto: moeda(p.total), detalhe: `${p.codigoObra} · lançamento ${p.lancamento.id} Pendente`, origem: { funcao: 'resumoCompras().aguardandoAprovacao', campo: 'PedidoCalc.lancamento.status', regra: 'pedido ativo com lançamento Pendente', tela: '/aprovacoes' }, destino: { rotulo: 'Ver aprovação', to: apr ? `/aprovacoes?id=${apr.id}` : '/aprovacoes' } });
    }
    if (p.ativo && p.lancamento?.status === 'Rascunho') pend.push({ ...base, id: `lancamento-rascunho:${p.id}`, tipo: 'lancamento-rascunho', texto: `${p.codigo} · ${p.fornecedor}`, impacto: moeda(p.total), detalhe: `${p.codigoObra} · pedido ${p.status} · lançamento ${p.lancamento.id} em Rascunho`, origem: { funcao: 'calcPedido()', campo: 'status · lancamento.status', regra: 'estado atual do pedido e do lançamento, sem inferir a causa', tela: `/lancamentos/${p.lancamento.id}` }, destino: { rotulo: 'Ver lançamento', to: `/lancamentos/${p.lancamento.id}` } });
    if (p.lancamentoId && !p.lancamento) pend.push({ ...base, id: `lancamento-ausente:${p.id}`, tipo: 'lancamento-ausente', texto: `${p.codigo} · ${p.fornecedor}`, impacto: `vínculo ${p.lancamentoId}`, detalhe: `${p.codigoObra} · pedido ${p.status}`, origem: { funcao: 'calcPedido().lancamento', campo: 'PedidoCompra.lancamentoId', regra: 'o lançamento vinculado não está no Dataset', tela: TELA_COMPRAS(p.codigoObra) }, destino: { rotulo: 'Ver compras da obra', to: TELA_COMPRAS(p.codigoObra) } });
    if (p.status === 'Rascunho') pend.push({ ...base, id: `rascunho:${p.id}`, tipo: 'rascunho', texto: `${p.codigo} · ${p.fornecedor}`, impacto: moeda(p.total), detalhe: `${p.codigoObra} · criado por ${l.criadoPor.nome ?? l.criadoPor.id}`, origem: { funcao: 'resumoCompras().rascunhos', campo: "status === 'Rascunho'", regra: 'pedido salvo e não emitido', tela: TELA_COMPRAS(p.codigoObra) }, destino: { rotulo: 'Ver compras da obra', to: TELA_COMPRAS(p.codigoObra) } });
  }
  for (const o of obrasVis) {
    const c = comparativos.get(o.codigo)!;
    if (c.compradoForaOrcamento > 0) pend.push({ id: `fora-orcamento:${o.codigo}`, tipo: 'fora-orcamento', obra: o.codigo, texto: o.nome, impacto: moeda(c.compradoForaOrcamento), detalhe: 'itens comprados sem insumo do catálogo', origem: { funcao: `comparativoOrcadoComprado(ds, '${o.codigo}')`, campo: 'compradoForaOrcamento', regra: 'itens de pedidos ativos sem insumo do catálogo', tela: TELA_COMPRAS(o.codigo) }, destino: { rotulo: 'Ver compras da obra', to: TELA_COMPRAS(o.codigo) }, composicaoId: `orcado:${o.codigo}` });
  }
  if (estoque && estoque.abaixoMinimo > 0) pend.push({ id: 'estoque-minimo', tipo: 'estoque-minimo', texto: 'Estoque de aço (global)', impacto: n(estoque.abaixoMinimo, 'item', 'itens'), detalhe: 'saldo abaixo do estoque mínimo cadastrado', origem: { funcao: 'posicaoEstoque(ds)', campo: 'abaixoMinimo', regra: 'saldo < estoque mínimo (quando o mínimo é maior que zero)', tela: '/estoque' }, destino: { rotulo: 'Ver estoque', to: '/estoque' }, composicaoId: 'estoque' });
  for (const o of obrasVis) {
    for (const s of sugestoesPara(`/obras/${o.codigo}`, ds, usuario, ds.params.dataBase).filter((x) => x.id === `obra-${o.codigo}-direto`)) {
      pend.push({ id: `sugestao-direto:${o.codigo}`, tipo: 'sugestao-direto', obra: o.codigo, texto: o.nome, impacto: s.texto, tom: s.tom, origem: { funcao: `sugestoesPara('/obras/${o.codigo}')`, campo: s.id, regra: 'sugestão do core, com o tom que o core atribuiu', tela: `/obras/${o.codigo}` }, destino: { rotulo: 'Ver obra', to: `/obras/${o.codigo}` }, composicaoId: `obra-compras:${o.codigo}` });
    }
  }
  const todas = pend.map((it, i) => ({ it, i })).sort((a, b) => TIPOS_PENDENCIA.indexOf(a.it.tipo) - TIPOS_PENDENCIA.indexOf(b.it.tipo) || a.i - b.i).map((x) => x.it);
  const compacta = todas.slice(0, TETO_PENDENCIAS);

  return {
    estado: 'pronto', fonte, visao, empresa: ds.params.empresa, usuario: { nome: usuario.nome, papel: usuario.papel }, carteiraCompleta, obrasNoConjunto: obrasVis.length, totalObras: ds.obras.length,
    situacao, tiles, obras,
    pedidos: { compacta: abertos.slice(0, TETO_PEDIDOS), todos: abertos, ocultos: Math.max(0, abertos.length - TETO_PEDIDOS) },
    pendencias: { compacta, todas, ocultas: todas.length - compacta.length },
    estoque: estoque ? { visivel: true, abaixoMinimo: estoque.abaixoMinimo, saldoKg: estoque.saldoKg, composicaoId: 'estoque' } : { visivel: false, motivo: TEXTO_ESTOQUE_INDISPONIVEL },
    composicoes, frescor,
  };
}

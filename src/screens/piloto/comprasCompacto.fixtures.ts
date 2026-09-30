// UX-P05 — Compras compacto: DADOS DE TESTE do piloto.
//
// Tudo aqui e ficticio e visivelmente marcado ("PILOTO · DADOS DE TESTE"). Nenhum nome real do seed sobrevive: obras,
// fornecedores, insumos, orcamento, pedidos, lancamentos, aprovacao e estoque sao do piloto. O Dataset nasce de uma copia
// do seed (estrutura e plano de contas) e recebe tres obras: A com orcamento contratado e pedidos em todos os estados que
// o core conhece (normal, parcial com entrega vencida, aguardando aprovacao, rascunho sem previsao e com autor
// desconhecido, recebido e pago), B sem orcamento, com faturamento direto acima do saldo contratado, lancamento em
// Rascunho, vinculo de lancamento ausente e pedido cancelado, e C sem nenhum pedido. A fixture so existe para a
// demonstracao isolada (dev) e para os testes; nunca para o runtime integrado.
import seed from '../../data/seed.json';
import type { Aprovacao, Composicao, Dataset, Insumo, ItemEstoque, Lancamento, MovimentoEstoque, Obra, Orcamento, PedidoCompra, Servico, Usuario } from '../../core/types';

export const ROTULO_TESTE = 'PILOTO · DADOS DE TESTE';
export const PREFIXO_TESTE = 'PILOTO ·';
export const DATA_BASE_TESTE = '2026-09-23';
export const FIXTURE_GERADA_EM = '2026-09-23T12:00:00.000Z';

export const OBRA_A = 'OB-PC-A';
export const OBRA_B = 'OB-PC-B';
export const OBRA_C = 'OB-PC-C';
export const TODAS_AS_OBRAS = [OBRA_A, OBRA_B, OBRA_C];

export type VarianteFixture = 'padrao' | 'subconjunto' | 'parcial' | 'nenhuma' | 'sem-pedidos' | 'vazio';
export const VARIANTES: { id: VarianteFixture; rotulo: string; descricao: string }[] = [
  { id: 'padrao', rotulo: 'Todas as obras', descricao: 'Diretoria com as três obras visíveis: carteira completa, estoque global visível.' },
  { id: 'subconjunto', rotulo: 'Só a obra A', descricao: 'Comprador que enxerga só OB-PC-A: valores daquela obra, estoque global fora.' },
  { id: 'parcial', rotulo: 'Obras A e B', descricao: 'Duas de três obras: R$ só por obra, carteira inteira não visível.' },
  { id: 'nenhuma', rotulo: 'Nenhuma visível', descricao: 'Usuário sem obra visível: estado próprio, sem número.' },
  { id: 'sem-pedidos', rotulo: 'Sem pedidos', descricao: 'Obras cadastradas e visíveis, nenhum pedido de compra.' },
  { id: 'vazio', rotulo: 'Sem obras', descricao: 'Dataset sem obra cadastrada.' },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const AUD = { criadoEm: FIXTURE_GERADA_EM, criadoPor: 'piloto', atualizadoEm: FIXTURE_GERADA_EM, atualizadoPor: 'piloto', versao: 1 };
const CONTA = 'PILOTO · Banco C';

export const USUARIO_DIRETORIA: Usuario = { id: 'u-pc-dir', nome: 'PILOTO · Diretoria', email: 'pc-dir@teste.invalid', papel: 'Diretoria', obras: '*', ativo: true };
export const USUARIO_COMPRAS_A: Usuario = { id: 'u-pc-compras', nome: 'PILOTO · Compras da obra A', email: 'pc-compras@teste.invalid', papel: 'Compras', obras: [OBRA_A], ativo: true };
export const USUARIO_SEM_OBRA: Usuario = { id: 'u-pc-eng', nome: 'PILOTO · Engenharia sem obra', email: 'pc-eng@teste.invalid', papel: 'Engenharia', obras: [], ativo: true };
/** Autor gravado num pedido que nao existe em `ds.usuarios` (prova de ausencia: nunca vira nome inventado). */
export const AUTOR_DESCONHECIDO = 'u-pc-removido';

function obras(): Obra[] {
  const base = { registro: 'Real' as const, cidadeUf: 'Cidade de teste/UF', aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, observacoes: ROTULO_TESTE };
  return [
    { ...base, codigo: OBRA_A, nome: 'PILOTO · Galpão de compras A', cliente: 'PILOTO · Cliente Alfa', status: 'Em execução', escopo: 'Estrutura metálica fictícia', assinatura: '2026-06-01', inicio: '2026-06-15', fimContratual: '2026-12-20', valorContrato: 800_000, margemAlvo: 0.22, responsavel: 'PILOTO · Gestor da obra A' },
    { ...base, codigo: OBRA_B, nome: 'PILOTO · Mezanino de compras B', cliente: 'PILOTO · Cliente Beta', status: 'Em execução', escopo: 'Mezanino fictício', assinatura: '2026-07-01', inicio: '2026-07-10', fimContratual: '2026-11-30', valorContrato: 250_000, margemAlvo: 0.2 },
    { ...base, codigo: OBRA_C, nome: 'PILOTO · Cobertura sem compras C', cliente: 'PILOTO · Cliente Gama', status: 'Planejamento', escopo: 'Cobertura fictícia', valorContrato: 120_000, margemAlvo: 0.25 },
  ];
}

function servicos(): Servico[] {
  return [
    { id: 'SV-PC-A1', codigoObra: OBRA_A, codigo: 'A-01', nome: `${PREFIXO_TESTE} Fabricação da estrutura`, etapa: 'Fabricação', unidade: 'kg', quantidadeOrcada: 20_000, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 600_000, status: 'Em andamento', observacoes: ROTULO_TESTE, ativo: true },
  ];
}

const ins = (id: string, codigo: string, descricao: string, unidade: string, tipo: Insumo['tipo'], preco: number): Insumo => ({ id, codigo, descricao: `${PREFIXO_TESTE} ${descricao}`, unidade, tipo, origem: 'Própria', preco, precoData: DATA_BASE_TESTE, precoFonte: ROTULO_TESTE, ativo: true, observacoes: ROTULO_TESTE });
function insumos(): Insumo[] {
  return [
    ins('INS-PC-1', 'PC-PERFIL', 'Perfil laminado W', 'kg', 'Material', 9),
    ins('INS-PC-2', 'PC-CHAPA', 'Chapa de aço', 'kg', 'Material', 8.5),
    ins('INS-PC-3', 'PC-PARAF', 'Parafuso estrutural', 'un', 'Material', 4),
    ins('INS-PC-4', 'PC-TELHA', 'Telha trapezoidal', 'm²', 'Material', 60),
  ];
}
function composicoes(): Composicao[] {
  return [{ id: 'CMP-PC-1', codigo: 'PC-EST-KG', descricao: `${PREFIXO_TESTE} Estrutura metálica por kg`, unidade: 'kg', grupo: 'PILOTO', origem: 'Própria', itens: [{ tipo: 'Insumo', refId: 'INS-PC-1', coeficiente: 0.7 }, { tipo: 'Insumo', refId: 'INS-PC-2', coeficiente: 0.35 }, { tipo: 'Insumo', refId: 'INS-PC-3', coeficiente: 0.02 }], ativo: true, observacoes: ROTULO_TESTE }];
}
function orcamentos(): Orcamento[] {
  return [{ id: 'ORC-PC-A', codigo: 'ORC-PC-A', titulo: `${PREFIXO_TESTE} Orçamento executivo A`, cliente: 'PILOTO · Cliente Alfa', codigoObra: OBRA_A, data: '2026-05-20', status: 'Contratado', bdi: 0.25, referenciaPrecos: ROTULO_TESTE, itens: [{ id: 'IO-PC-1', ordem: 1, etapa: 'Fabricação', codigo: '1.1', descricao: `${PREFIXO_TESTE} Estrutura metálica`, unidade: 'kg', quantidade: 20_000, composicaoId: 'CMP-PC-1', servicoId: 'SV-PC-A1' }], observacoes: ROTULO_TESTE, criadoEm: FIXTURE_GERADA_EM, criadoPor: 'piloto', atualizadoEm: FIXTURE_GERADA_EM }];
}

interface Ped { id: string; obra: string; forn: string; data: string; prev?: string; status: PedidoCompra['status']; itens: [string | undefined, string, string, number, number, number][]; lanc?: string; direto?: boolean; servico?: string; autor?: string; atualizado?: string; cat?: string }
function ped(p: Ped): PedidoCompra {
  return {
    id: p.id, codigo: p.id, codigoObra: p.obra, servicoId: p.servico, fornecedor: `${PREFIXO_TESTE} ${p.forn}`, documento: `TESTE-${p.id}`, data: p.data, previsaoEntrega: p.prev, prazoPagamentoDias: 30,
    categoria: p.cat ?? 'Aço e perfis', faturamentoDireto: !!p.direto, status: p.status,
    itens: p.itens.map(([insumoId, descricao, unidade, quantidade, precoUnitario, quantidadeRecebida], i) => ({ id: `${p.id}-${i + 1}`, insumoId, descricao: `${PREFIXO_TESTE} ${descricao}`, unidade, quantidade, precoUnitario, quantidadeRecebida })),
    lancamentoId: p.lanc, observacoes: ROTULO_TESTE, criadoEm: FIXTURE_GERADA_EM, criadoPor: p.autor ?? USUARIO_COMPRAS_A.id, atualizadoEm: p.atualizado ?? FIXTURE_GERADA_EM,
  };
}
function pedidos(): PedidoCompra[] {
  return [
    // obra A
    ped({ id: 'PC-A1', obra: OBRA_A, servico: 'SV-PC-A1', forn: 'Siderúrgica Teste', data: '2026-09-10', prev: '2026-10-10', status: 'Emitido', lanc: 'L-PC-A1', itens: [['INS-PC-1', 'Perfil laminado W', 'kg', 5_000, 9.2, 0]] }),
    ped({ id: 'PC-A2', obra: OBRA_A, forn: 'Chaparia Teste', data: '2026-08-25', prev: '2026-09-15', status: 'Recebido parcial', lanc: 'L-PC-A2', atualizado: '2026-09-22T16:30:00.000Z', itens: [['INS-PC-2', 'Chapa de aço', 'kg', 3_000, 8.4, 1_500], ['INS-PC-3', 'Parafuso estrutural', 'un', 200, 4, 200]] }),
    ped({ id: 'PC-A3', obra: OBRA_A, forn: 'Fixadores Teste', data: '2026-09-18', prev: '2026-09-30', status: 'Emitido', lanc: 'L-PC-A3', cat: 'Componentes e fixadores', itens: [[undefined, 'Chumbador especial (item livre)', 'un', 50, 120, 0]] }),
    ped({ id: 'PC-A4', obra: OBRA_A, forn: 'Siderúrgica Teste', data: '2026-09-21', status: 'Rascunho', autor: AUTOR_DESCONHECIDO, itens: [['INS-PC-1', 'Perfil laminado W', 'kg', 2_000, 9, 0]] }),
    ped({ id: 'PC-A5', obra: OBRA_A, forn: 'Telhas Teste', data: '2026-08-01', prev: '2026-09-01', status: 'Recebido', lanc: 'L-PC-A5', cat: 'Chapas, telhas e painéis', itens: [['INS-PC-4', 'Telha trapezoidal', 'm²', 300, 58, 300]] }),
    // obra B
    ped({ id: 'PC-B1', obra: OBRA_B, forn: 'Painéis Teste', data: '2026-09-05', prev: '2026-09-20', status: 'Emitido', lanc: 'L-PC-B1', direto: true, cat: 'Chapas, telhas e painéis', itens: [[undefined, 'Painel isotérmico (item livre)', 'm²', 100, 150, 0]] }),
    ped({ id: 'PC-B2', obra: OBRA_B, forn: 'Chaparia Teste', data: '2026-09-12', prev: '2026-10-05', status: 'Emitido', lanc: 'L-PC-B2', direto: true, itens: [['INS-PC-2', 'Chapa de aço', 'kg', 1_000, 8.6, 0]] }),
    ped({ id: 'PC-B3', obra: OBRA_B, forn: 'Siderúrgica Teste', data: '2026-09-01', prev: '2026-09-10', status: 'Cancelado', itens: [['INS-PC-1', 'Perfil laminado W', 'kg', 800, 9, 0]] }),
    ped({ id: 'PC-B4', obra: OBRA_B, forn: 'Fixadores Teste', data: '2026-09-15', prev: '2026-10-01', status: 'Emitido', lanc: 'L-PC-INEXISTENTE', cat: 'Componentes e fixadores', itens: [['INS-PC-3', 'Parafuso estrutural', 'un', 500, 4.1, 0]] }),
  ];
}

interface Lanc { id: string; cat: string; obra: string; servico?: string; cp: string; desc: string; comp: string; venc: string; status: Lancamento['status']; valor: number; real?: string; direto?: boolean; origem?: string }
function lanc(l: Lanc): Lancamento {
  return {
    id: l.id, registro: 'Real', categoria: l.cat, subcategoria: '', centroCusto: 'Obra', codigoObra: l.obra, servicoId: l.servico, faturamentoDireto: l.direto, contraparte: `${PREFIXO_TESTE} ${l.cp}`, documento: `TESTE-${l.id}`, descricao: `${PREFIXO_TESTE} ${l.desc}`,
    competencia: l.comp, vencimento: l.venc, realizacao: l.real, status: l.status, confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: CONTA, valorBruto: l.valor, retencoes: 0, desconto: 0, multaJuros: 0, valorRealizado: l.real ? l.valor : undefined,
    conciliado: false, observacoes: ROTULO_TESTE, anexos: [], origem: l.origem ?? 'pedido', ...AUD,
  };
}
function lancamentos(): Lancamento[] {
  return [
    lanc({ id: 'L-PC-A1', cat: 'Aço e perfis', obra: OBRA_A, servico: 'SV-PC-A1', cp: 'Siderúrgica Teste', desc: 'Pedido PC-A1', comp: '2026-09-10', venc: '2026-10-10', status: 'Programado', valor: 46_000 }),
    lanc({ id: 'L-PC-A2', cat: 'Aço e perfis', obra: OBRA_A, cp: 'Chaparia Teste', desc: 'Pedido PC-A2', comp: '2026-08-25', venc: '2026-09-24', status: 'Programado', valor: 26_000 }),
    lanc({ id: 'L-PC-A3', cat: 'Componentes e fixadores', obra: OBRA_A, cp: 'Fixadores Teste', desc: 'Pedido PC-A3', comp: '2026-09-18', venc: '2026-10-18', status: 'Pendente', valor: 6_000 }),
    lanc({ id: 'L-PC-A5', cat: 'Chapas, telhas e painéis', obra: OBRA_A, cp: 'Telhas Teste', desc: 'Pedido PC-A5', comp: '2026-08-01', venc: '2026-08-31', status: 'Realizado', valor: 17_400, real: '2026-08-31' }),
    // custo direto da obra A que nao veio de pedido: prova de que o custo comprometido nao e a soma dos pedidos
    lanc({ id: 'L-PC-A9', cat: 'Mão de obra terceirizada', obra: OBRA_A, cp: 'Montagens Teste', desc: 'Montagem — setembro', comp: '2026-09-30', venc: '2026-10-15', status: 'Programado', valor: 40_000, origem: 'piloto' }),
    lanc({ id: 'L-PC-B1', cat: 'Chapas, telhas e painéis', obra: OBRA_B, cp: 'Painéis Teste', desc: 'Pedido PC-B1', comp: '2026-09-05', venc: '2026-10-05', status: 'Rascunho', valor: 15_000, direto: true }),
    lanc({ id: 'L-PC-B2', cat: 'Aço e perfis', obra: OBRA_B, cp: 'Chaparia Teste', desc: 'Pedido PC-B2', comp: '2026-09-12', venc: '2026-10-12', status: 'Programado', valor: 8_600, direto: true }),
  ];
}

function aprovacoes(): Aprovacao[] {
  return [{
    id: 'APR-PC-A3', tipo: 'Lançamento', entidadeId: 'L-PC-A3', titulo: `${PREFIXO_TESTE} Pedido PC-A3`, valor: 6_000, codigoObra: OBRA_A, solicitante: USUARIO_COMPRAS_A.nome, criadoEm: '2026-09-18T14:00:00.000Z', prazoSla: '2026-09-21T14:00:00.000Z',
    etapas: [{ papel: 'Gestor de obra', status: 'Aprovado', decididoPor: 'PILOTO · Gestor da obra A', decididoEm: '2026-09-19T09:00:00.000Z' }, { papel: 'Financeiro', status: 'Pendente' }],
    status: 'Pendente', impacto: { foraDoOrcamento: true },
  }];
}

function itensEstoque(): ItemEstoque[] {
  return [
    { id: 'IE-PC-1', codigo: 'PC-W200', descricao: `${PREFIXO_TESTE} Perfil W200`, familia: 'Perfil laminado', insumoId: 'INS-PC-1', estoqueMinimo: 5_000, ativo: true, observacoes: ROTULO_TESTE },
    { id: 'IE-PC-2', codigo: 'PC-CH38', descricao: `${PREFIXO_TESTE} Chapa 3/8`, familia: 'Chapa', insumoId: 'INS-PC-2', estoqueMinimo: 2_000, ativo: true, observacoes: ROTULO_TESTE },
  ];
}
const mov = (id: string, data: string, itemId: string, quantidade: number, custoUnitario: number, extra: Partial<MovimentoEstoque> = {}): MovimentoEstoque => ({ id, data, tipo: 'Entrada', itemId, local: 'Fábrica', conjuntos: [], quantidade, corrida: `PILOTO-${id}`, custoUnitario, observacao: ROTULO_TESTE, responsavel: 'piloto', criadoEm: FIXTURE_GERADA_EM, ...extra });
function movimentosEstoque(): MovimentoEstoque[] {
  return [mov('ME-PC-1', '2026-09-02', 'IE-PC-1', 3_000, 9.1), mov('ME-PC-2', '2026-09-18', 'IE-PC-2', 4_000, 8.4, { pedidoId: 'PC-A2', fornecedor: `${PREFIXO_TESTE} Chaparia Teste` })];
}

/** Dataset completo e ficticio da variante pedida. Sempre um objeto novo. */
export function datasetTeste(variante: VarianteFixture = 'padrao'): Dataset {
  const base = clone(seed) as unknown as Dataset;
  const ds: Dataset = {
    ...base,
    params: { ...base.params, organizacao: 'PILOTO', empresa: 'PILOTO · Empresa de teste', dataBase: DATA_BASE_TESTE, dataBaseAutomatica: false, cenario: 'Base', incluirDemo: false, reservaMinima: 50_000, corteExtrato: '2026-09-01', responsavel: ROTULO_TESTE, versao: 'piloto ux-p05' },
    contas: [{ id: 'CTA-PC', registro: 'Real', instituicao: CONTA, conta: 'PILOTO · conta corrente C', tipo: 'Conta corrente', saldoInicial: 200_000, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true }],
    obras: obras(), servicos: servicos(), medicoes: [], conjuntos: [], ordens: [], avancos: [], demandas: [], rateios: [],
    insumos: insumos(), composicoes: composicoes(), orcamentos: orcamentos(), pedidos: pedidos(),
    lancamentos: lancamentos(),
    liquidacoes: [{ id: 'LIQ-PC-A5', lancamentoId: 'L-PC-A5', data: '2026-08-31', valor: 17_400, conta: CONTA, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM }],
    transacoes: [], dividas: [], aprovacoes: aprovacoes(),
    itensEstoque: itensEstoque(), movimentosEstoque: movimentosEstoque(),
    usuarios: [USUARIO_DIRETORIA, USUARIO_COMPRAS_A, USUARIO_SEM_OBRA],
    auditoria: [],
  };
  if (variante === 'sem-pedidos') { ds.pedidos = []; ds.lancamentos = []; ds.liquidacoes = []; ds.aprovacoes = []; }
  if (variante === 'vazio') { ds.obras = []; ds.servicos = []; ds.pedidos = []; ds.lancamentos = []; ds.liquidacoes = []; ds.aprovacoes = []; ds.orcamentos = []; }
  return ds;
}

/** Usuario e conjunto de obras visiveis de cada variante (contrato de entrada do piloto; nao e ACL). */
export function entradaDaVariante(variante: VarianteFixture): { usuario: Usuario; codigosObraVisiveis: string[] } {
  if (variante === 'subconjunto') return { usuario: USUARIO_COMPRAS_A, codigosObraVisiveis: [OBRA_A] };
  if (variante === 'parcial') return { usuario: USUARIO_DIRETORIA, codigosObraVisiveis: [OBRA_A, OBRA_B] };
  if (variante === 'nenhuma') return { usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] };
  return { usuario: USUARIO_DIRETORIA, codigosObraVisiveis: variante === 'vazio' ? [] : TODAS_AS_OBRAS };
}

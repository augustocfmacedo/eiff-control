// UX-P01 — Financeiro compacto: DADOS DE TESTE do piloto.
//
// Tudo aqui e ficticio e visivelmente marcado ("PILOTO · DADOS DE TESTE"). Nenhum numero representa a situacao real da
// EIFF. O Dataset nasce de uma copia do seed (estrutura, plano de contas, radar) e recebe contas, extrato, lancamentos,
// aprovacoes e obra proprios do piloto, cobrindo cada situacao que o motor conhece (atrasado, proximos 7 dias, a vencer,
// realizado com e sem conciliacao, pendente de aprovacao, rascunho do Diretor Financeiro, faturamento direto,
// cancelado, excluido). O piloto NAO importa o store: a fixture e a unica fonte de dados desta fase.
import seed from '../../data/seed.json';
import type { Aprovacao, ContaFinanceira, Dataset, Lancamento, Obra, TransacaoBancaria, Usuario } from '../../core/types';

export const ROTULO_TESTE = 'PILOTO · DADOS DE TESTE';
export const PREFIXO_TESTE = 'PILOTO ·';
/** Data-base fixa da fixture (nao acompanha o dia de hoje): a demonstracao e reproduzivel. */
export const DATA_BASE_TESTE = '2026-09-23';
/** Ultimo movimento do extrato na variante padrao: 4 dias antes da data-base, para exercer o estado "desatualizado". */
export const EXTRATO_ATE_PADRAO = '2026-09-19';
/** Momento em que esta fixture foi escrita (aparece como "ultima atualizacao" da fonte de teste). */
export const FIXTURE_GERADA_EM = '2026-09-23T12:00:00.000Z';

export type VarianteFixture = 'padrao' | 'atualizado' | 'sem-extrato' | 'vazio' | 'restrito';
export const VARIANTES: { id: VarianteFixture; rotulo: string; descricao: string }[] = [
  { id: 'padrao', rotulo: 'Padrão', descricao: 'Extrato defasado 4 dias, vencidos, aprovações e caixa abaixo da reserva.' },
  { id: 'atualizado', rotulo: 'Extrato em dia', descricao: 'Mesmos dados com o extrato importado até a data-base.' },
  { id: 'sem-extrato', rotulo: 'Sem extrato', descricao: 'Contas sem nenhum movimento importado: o caixa de hoje é só a abertura.' },
  { id: 'vazio', rotulo: 'Vazio', descricao: 'Nenhuma conta ativa e nenhum lançamento oficial.' },
  { id: 'restrito', rotulo: 'Sem ver_bancos', descricao: 'Usuário Gestor de obra: saldos restritos pela permissão do core.' },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const CONTA_A = 'PILOTO · Banco A';
const CONTA_B = 'PILOTO · Banco B';
const OBRA = 'OB-PILOTO-01';
const AUD = { criadoEm: FIXTURE_GERADA_EM, criadoPor: 'piloto', atualizadoEm: FIXTURE_GERADA_EM, atualizadoPor: 'piloto', versao: 1 };

export const USUARIO_FINANCEIRO: Usuario = { id: 'u-piloto-fin', nome: 'PILOTO · Financeiro', email: 'piloto-fin@teste.invalid', papel: 'Financeiro', obras: '*', ativo: true };
export const USUARIO_OBRA: Usuario = { id: 'u-piloto-obra', nome: 'PILOTO · Gestor de obra', email: 'piloto-obra@teste.invalid', papel: 'Gestor de obra', obras: [OBRA], ativo: true };

function contas(): ContaFinanceira[] {
  return [
    { id: 'CTA-PILOTO-A', registro: 'Real', instituicao: CONTA_A, conta: 'PILOTO · conta corrente A', tipo: 'Conta corrente', saldoInicial: 182_400, saldoInicialData: '2026-09-01', reservaVinculada: 20_000, ativa: true },
    { id: 'CTA-PILOTO-B', registro: 'Real', instituicao: CONTA_B, conta: 'PILOTO · conta corrente B', tipo: 'Conta corrente', saldoInicial: 36_150.5, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true },
    { id: 'CTA-PILOTO-X', registro: 'Real', instituicao: 'PILOTO · Banco encerrado', conta: 'PILOTO · inativa', tipo: 'Conta corrente', saldoInicial: 999_999, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: false },
  ];
}

interface Lanc { id: string; cat: string; cp: string; desc: string; comp: string; venc: string; status: Lancamento['status']; valor: number; obra?: boolean; conta?: string; real?: string; ret?: number; direto?: boolean; origem?: string; excluido?: boolean; cancelado?: string; prob?: number }
function lanc(l: Lanc): Lancamento {
  return {
    id: l.id, registro: 'Real', categoria: l.cat, subcategoria: '', centroCusto: l.obra === false ? 'Administrativo' : 'Obra', codigoObra: l.obra === false ? '' : OBRA,
    faturamentoDireto: l.direto, contraparte: `${PREFIXO_TESTE} ${l.cp}`, documento: `TESTE-${l.id}`, descricao: `${PREFIXO_TESTE} ${l.desc}`,
    competencia: l.comp, vencimento: l.venc, realizacao: l.real, status: l.status, confiabilidade: 'Confirmado', probabilidade: l.prob ?? 1,
    contaFinanceira: l.conta ?? CONTA_A, valorBruto: l.valor, retencoes: l.ret ?? 0, desconto: 0, multaJuros: 0, valorRealizado: l.real ? l.valor - (l.ret ?? 0) : undefined,
    conciliado: false, observacoes: ROTULO_TESTE, anexos: [], origem: l.origem ?? 'piloto', ...AUD,
    motivoCancelamento: l.cancelado, excluidoEm: l.excluido ? FIXTURE_GERADA_EM : undefined, excluidoPor: l.excluido ? 'piloto' : undefined, motivoExclusao: l.excluido ? 'lançamento em duplicidade (teste)' : undefined,
  };
}

/** Lancamentos do piloto: cada situacao do motor aparece pelo menos uma vez. Valores redondos, ficticios. */
function lancamentos(): Lancamento[] {
  return [
    // entradas atrasadas (recebiveis vencidos): 2 titulos
    lanc({ id: 'REC-T01', cat: 'Medições de obras', cp: 'Construtora Alfa', desc: 'Medição 04 — NF teste 101', comp: '2026-08-01', venc: '2026-09-05', status: 'Programado', valor: 96_000, ret: 4_800 }),
    lanc({ id: 'REC-T02', cat: 'Parcelas contratuais', cp: 'Construtora Alfa', desc: 'Parcela 3 do contrato', comp: '2026-08-01', venc: '2026-09-15', status: 'Programado', valor: 42_500 }),
    // entradas nos proximos 7 dias e a vencer
    lanc({ id: 'REC-T03', cat: 'Medições de obras', cp: 'Construtora Alfa', desc: 'Medição 05 — NF teste 102', comp: '2026-09-01', venc: '2026-09-28', status: 'Programado', valor: 128_000, ret: 6_400 }),
    lanc({ id: 'REC-T04', cat: 'Medições de obras', cp: 'Construtora Alfa', desc: 'Medição 06', comp: '2026-10-01', venc: '2026-10-20', status: 'Programado', valor: 110_000, ret: 5_500 }),
    lanc({ id: 'REC-T05', cat: 'Medições de obras', cp: 'Construtora Alfa', desc: 'Medição 07', comp: '2026-11-01', venc: '2026-11-20', status: 'Programado', valor: 90_000, ret: 4_500, prob: 0.8 }),
    lanc({ id: 'REC-T06', cat: 'Outros recebimentos', cp: 'Cliente Beta', desc: 'Sinal de novo contrato (proposta)', comp: '2026-12-01', venc: '2026-12-10', status: 'Programado', valor: 60_000, obra: false, prob: 0.5 }),
    // entrada realizada e conciliada (aparece no extrato)
    lanc({ id: 'REC-T07', cat: 'Medições de obras', cp: 'Construtora Alfa', desc: 'Medição 03 — recebida', comp: '2026-08-01', venc: '2026-09-10', real: '2026-09-11', status: 'Realizado', valor: 80_000, ret: 4_000 }),
    // saidas atrasadas (pagamentos vencidos): 2 titulos
    lanc({ id: 'PAG-T01', cat: 'Aço e perfis', cp: 'Siderúrgica Gama', desc: 'Perfis W — lote 7', comp: '2026-08-15', venc: '2026-09-12', status: 'Programado', valor: 58_300 }),
    lanc({ id: 'PAG-T02', cat: 'Mão de obra terceirizada', cp: 'Montagens Delta', desc: 'Medição de montagem — agosto', comp: '2026-08-31', venc: '2026-09-20', status: 'Aprovado', valor: 31_200 }),
    // saidas nos proximos 7 dias
    lanc({ id: 'PAG-T03', cat: 'Folha e salários', cp: 'Folha', desc: 'Folha de setembro', comp: '2026-09-01', venc: '2026-09-30', status: 'Programado', valor: 74_000, obra: false }),
    lanc({ id: 'PAG-T04', cat: 'Transporte e mobilização', cp: 'Transportadora Épsilon', desc: 'Carreta — expedição 12', comp: '2026-09-15', venc: '2026-09-25', status: 'Programado', valor: 8_900 }),
    lanc({ id: 'PAG-T05', cat: 'Impostos sobre faturamento', cp: 'Tributos', desc: 'Impostos sobre a NF 101', comp: '2026-09-01', venc: '2026-09-24', status: 'Programado', valor: 11_400, obra: false }),
    // saidas a vencer ao longo das 13 semanas
    lanc({ id: 'PAG-T06', cat: 'Aço e perfis', cp: 'Siderúrgica Gama', desc: 'Chapas — lote 8', comp: '2026-09-20', venc: '2026-10-15', status: 'Programado', valor: 122_000 }),
    lanc({ id: 'PAG-T07', cat: 'Folha e salários', cp: 'Folha', desc: 'Folha de outubro', comp: '2026-10-01', venc: '2026-10-30', status: 'Programado', valor: 74_000, obra: false }),
    lanc({ id: 'PAG-T08', cat: 'Equipamentos e locações', cp: 'Locadora Zeta', desc: 'Guindaste — outubro', comp: '2026-10-01', venc: '2026-11-05', status: 'Programado', valor: 27_500 }),
    lanc({ id: 'PAG-T09', cat: 'Folha e salários', cp: 'Folha', desc: 'Folha de novembro', comp: '2026-11-01', venc: '2026-11-30', status: 'Programado', valor: 74_000, obra: false }),
    lanc({ id: 'PAG-T18', cat: 'Chapas, telhas e painéis', cp: 'Painéis Iota', desc: 'Isopainel — cobertura (lote 2)', comp: '2026-10-20', venc: '2026-11-10', status: 'Programado', valor: 135_000 }),
    lanc({ id: 'PAG-T10', cat: 'Aluguel e condomínio', cp: 'Imobiliária Eta', desc: 'Aluguel do galpão — outubro', comp: '2026-10-01', venc: '2026-10-05', status: 'Programado', valor: 9_800, obra: false, conta: CONTA_B }),
    // saida realizada e conciliada; saida realizada SEM conciliacao (alerta do painel)
    lanc({ id: 'PAG-T11', cat: 'Energia, água e internet', cp: 'Concessionária', desc: 'Energia — agosto', comp: '2026-08-01', venc: '2026-09-08', real: '2026-09-08', status: 'Realizado', valor: 4_350, obra: false, conta: CONTA_B }),
    lanc({ id: 'PAG-T12', cat: 'Componentes e fixadores', cp: 'Parafusos Theta', desc: 'Chumbadores — pago no balcão', comp: '2026-09-10', venc: '2026-09-16', real: '2026-09-16', status: 'Realizado', valor: 2_780 }),
    // pendente de aprovacao (acima da alcada do gestor) e rascunho do Diretor Financeiro
    lanc({ id: 'PAG-T13', cat: 'Chapas, telhas e painéis', cp: 'Painéis Iota', desc: 'Isopainel — cobertura', comp: '2026-09-20', venc: '2026-10-10', status: 'Pendente', valor: 45_000 }),
    lanc({ id: 'PAG-T14', cat: 'Transporte e mobilização', cp: 'Transportadora Épsilon', desc: 'Frete pedido pelo campo', comp: '2026-09-23', venc: '2026-09-26', status: 'Rascunho', valor: 500, origem: 'diretor-financeiro' }),
    // faturamento direto (cliente paga o fornecedor): fora do caixa da EIFF
    lanc({ id: 'PAG-T15', cat: 'Aço e perfis', cp: 'Siderúrgica Gama', desc: 'Perfis pagos direto pelo cliente', comp: '2026-09-01', venc: '2026-09-18', status: 'Programado', valor: 150_000, direto: true }),
    // cancelado e excluido: nunca entram
    lanc({ id: 'PAG-T16', cat: 'Outros pagamentos', cp: 'Fornecedor Kappa', desc: 'Pedido cancelado', comp: '2026-09-01', venc: '2026-09-14', status: 'Cancelado', valor: 12_000, cancelado: 'cancelado no teste' }),
    lanc({ id: 'PAG-T17', cat: 'Outros pagamentos', cp: 'Fornecedor Kappa', desc: 'Lançado em duplicidade', comp: '2026-09-01', venc: '2026-09-14', status: 'Programado', valor: 12_000, excluido: true }),
  ];
}

function transacoes(ate: string): TransacaoBancaria[] {
  const t = (id: string, data: string, conta: string, historico: string, credito: number, debito: number, lancamentoIds: string[] = []): TransacaoBancaria =>
    ({ id, registro: 'Real', data, conta, historico: `${PREFIXO_TESTE} ${historico}`, documento: '', debito, credito, lancamentoIds, origem: 'piloto' });
  const todas = [
    t('TRX-T01', '2026-09-08', CONTA_B, 'DEB ENERGIA', 0, 4_350, ['PAG-T11']),
    t('TRX-T02', '2026-09-11', CONTA_A, 'TED RECEBIDA CONSTRUTORA ALFA', 76_000, 0, ['REC-T07']),
    t('TRX-T03', '2026-09-12', CONTA_A, 'TARIFA PACOTE', 0, 89.9),
    t('TRX-T04', '2026-09-17', CONTA_A, 'PIX ENVIADO FORNECEDOR', 0, 15_000),
    t('TRX-T05', '2026-09-19', CONTA_B, 'RENDIMENTO APLICACAO', 210.35, 0),
    t('TRX-T06', '2026-09-22', CONTA_A, 'PIX RECEBIDO', 5_000, 0),
    t('TRX-T07', '2026-09-23', CONTA_A, 'TARIFA TED', 0, 12.5),
  ];
  return todas.filter((x) => x.data <= ate);
}

function aprovacoes(): Aprovacao[] {
  return [
    { id: 'APR-T01', tipo: 'Lançamento', entidadeId: 'PAG-T13', titulo: `${PREFIXO_TESTE} Isopainel — cobertura`, valor: 45_000, codigoObra: OBRA, solicitante: 'PILOTO · Gestor de obra', criadoEm: '2026-09-19T12:00:00.000Z', prazoSla: '2026-09-21T12:00:00.000Z', etapas: [{ papel: 'Gestor de obra', status: 'Aprovado', decididoPor: 'PILOTO · Gestor de obra', decididoEm: '2026-09-19T13:00:00.000Z' }, { papel: 'Financeiro', status: 'Pendente' }], status: 'Pendente', impacto: { foraDoOrcamento: false, abaixoDaReserva: false } },
    { id: 'APR-T02', tipo: 'Compra', entidadeId: 'PC-T01', titulo: `${PREFIXO_TESTE} Pedido de tinta epóxi`, valor: 18_700, codigoObra: OBRA, solicitante: 'PILOTO · Compras', criadoEm: '2026-09-23T09:00:00.000Z', prazoSla: '2026-09-25T09:00:00.000Z', etapas: [{ papel: 'Gestor de obra', status: 'Pendente' }], status: 'Pendente', impacto: {} },
    { id: 'APR-T03', tipo: 'Lançamento', entidadeId: 'PAG-T02', titulo: `${PREFIXO_TESTE} Medição de montagem — agosto`, valor: 31_200, codigoObra: OBRA, solicitante: 'PILOTO · Gestor de obra', criadoEm: '2026-09-02T12:00:00.000Z', prazoSla: '2026-09-04T12:00:00.000Z', etapas: [{ papel: 'Gestor de obra', status: 'Aprovado' }, { papel: 'Financeiro', status: 'Aprovado' }], status: 'Aprovado', impacto: {} },
  ];
}

function obra(): Obra {
  return { codigo: OBRA, registro: 'Real', nome: 'PILOTO · Galpão de teste', cliente: 'PILOTO · Construtora Alfa', cidadeUf: 'Cidade de teste/UF', status: 'Em execução', escopo: 'Estrutura metálica fictícia para o piloto', inicio: '2026-07-01', fimContratual: '2026-12-15', valorContrato: 900_000, aditivos: 0, custoOrcado: 720_000, execucaoFisica: 0.4, medidoFaturado: 300_000, estimativaConcluir: 430_000, margemAlvo: 0.2, observacoes: ROTULO_TESTE };
}

/** Dataset completo e ficticio da variante pedida. Sempre um objeto novo. */
export function datasetTeste(variante: VarianteFixture = 'padrao'): Dataset {
  const base = clone(seed) as unknown as Dataset;
  const ds: Dataset = {
    ...base,
    params: { ...base.params, organizacao: 'PILOTO', empresa: 'PILOTO · Empresa de teste', dataBase: DATA_BASE_TESTE, dataBaseAutomatica: false, cenario: 'Base', incluirDemo: false, reservaMinima: 60_000, corteExtrato: '2026-09-01', responsavel: ROTULO_TESTE, versao: 'piloto ux-p01' },
    contas: contas(),
    obras: [obra()],
    servicos: [],
    lancamentos: lancamentos(),
    liquidacoes: [
      { id: 'LIQ-T01', lancamentoId: 'REC-T07', data: '2026-09-11', valor: 76_000, conta: CONTA_A, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
      { id: 'LIQ-T02', lancamentoId: 'PAG-T11', data: '2026-09-08', valor: 4_350, conta: CONTA_B, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
      { id: 'LIQ-T03', lancamentoId: 'PAG-T12', data: '2026-09-16', valor: 2_780, conta: CONTA_A, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
    ],
    transacoes: transacoes(variante === 'atualizado' ? DATA_BASE_TESTE : EXTRATO_ATE_PADRAO),
    dividas: [{ id: 'DIV-T01', registro: 'Real', credor: 'PILOTO · Banco A', instrumento: 'Capital de giro (teste)', contratacao: '2026-03-01', principal: 200_000, saldoDevedor: 140_000, taxaAa: 0.21, parcelaMensal: 9_800, proximoVencimento: '2026-10-05', parcelasRestantes: 15, garantia: 'aval', status: 'Ativa', observacoes: ROTULO_TESTE }],
    aprovacoes: aprovacoes(),
    usuarios: [USUARIO_FINANCEIRO, USUARIO_OBRA],
    auditoria: [],
  };
  if (variante === 'sem-extrato') ds.transacoes = [];
  if (variante === 'vazio') {
    ds.contas = ds.contas.map((c) => ({ ...c, ativa: false }));
    ds.transacoes = [];
    ds.lancamentos = ds.lancamentos.filter((l) => l.status === 'Rascunho' || l.status === 'Cancelado' || l.excluidoEm);
    ds.aprovacoes = [];
    ds.dividas = [];
  }
  return ds;
}

export const usuarioDaVariante = (variante: VarianteFixture): Usuario => (variante === 'restrito' ? USUARIO_OBRA : USUARIO_FINANCEIRO);

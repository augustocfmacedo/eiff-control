// UX-P03 — Obras compacto: DADOS DE TESTE do piloto.
//
// Tudo aqui e ficticio e visivelmente marcado ("PILOTO · DADOS DE TESTE"). Nenhum nome real do seed sobrevive: obras,
// clientes, servicos, medicoes, conjuntos, ordens e lancamentos sao do piloto. O Dataset nasce de uma copia do seed
// (estrutura, plano de contas, radar) e recebe tres obras que cobrem os estados que o motor conhece: uma em execucao com
// medicoes atrasadas e producao em andamento, uma com margem projetada negativa, servicos sem datas e servico parado, e
// uma em planejamento sem servicos. A fixture so existe para a demonstracao isolada (dev) e para os testes.
import seed from '../../data/seed.json';
import type { Conjunto, Dataset, EtapaOrdem, Lancamento, Medicao, Obra, OrdemProducao, Servico, Usuario } from '../../core/types';

export const ROTULO_TESTE = 'PILOTO · DADOS DE TESTE';
export const PREFIXO_TESTE = 'PILOTO ·';
export const DATA_BASE_TESTE = '2026-09-23';
export const FIXTURE_GERADA_EM = '2026-09-23T12:00:00.000Z';

export const OBRA_A = 'OB-PILOTO-A';
export const OBRA_B = 'OB-PILOTO-B';
export const OBRA_C = 'OB-PILOTO-C';
export const TODAS_AS_OBRAS = [OBRA_A, OBRA_B, OBRA_C];

export type VarianteFixture = 'padrao' | 'subconjunto' | 'nenhuma' | 'vazio';
export const VARIANTES: { id: VarianteFixture; rotulo: string; descricao: string }[] = [
  { id: 'padrao', rotulo: 'Todas as obras', descricao: 'Diretoria com as três obras visíveis: execução, margem negativa e planejamento.' },
  { id: 'subconjunto', rotulo: 'Só a obra A', descricao: 'Gestor de obra que enxerga só OB-PILOTO-A: carteira inteira fica indisponível.' },
  { id: 'nenhuma', rotulo: 'Nenhuma visível', descricao: 'Usuário sem obra visível: estado próprio, sem número.' },
  { id: 'vazio', rotulo: 'Sem obras', descricao: 'Dataset sem obra cadastrada.' },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const AUD = { criadoEm: FIXTURE_GERADA_EM, criadoPor: 'piloto', atualizadoEm: FIXTURE_GERADA_EM, atualizadoPor: 'piloto', versao: 1 };
const CONTA = 'PILOTO · Banco A';

export const USUARIO_DIRETORIA: Usuario = { id: 'u-piloto-dir', nome: 'PILOTO · Diretoria', email: 'piloto-dir@teste.invalid', papel: 'Diretoria', obras: '*', ativo: true };
export const USUARIO_GESTOR_A: Usuario = { id: 'u-piloto-gestor', nome: 'PILOTO · Gestor da obra A', email: 'piloto-gestor@teste.invalid', papel: 'Gestor de obra', obras: [OBRA_A], ativo: true };
export const USUARIO_SEM_OBRA: Usuario = { id: 'u-piloto-eng', nome: 'PILOTO · Engenharia sem obra', email: 'piloto-eng@teste.invalid', papel: 'Engenharia', obras: [], ativo: true };

function obras(): Obra[] {
  return [
    { codigo: OBRA_A, registro: 'Real', nome: 'PILOTO · Galpão logístico A', cliente: 'PILOTO · Construtora Alfa', cidadeUf: 'Cidade de teste/UF', status: 'Em execução', escopo: 'Estrutura metálica fictícia (galpão)', assinatura: '2026-05-10', inicio: '2026-06-01', fimContratual: '2026-12-15', valorContrato: 900_000, aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, margemAlvo: 0.22, observacoes: ROTULO_TESTE, responsavel: 'PILOTO · Gestor da obra A' },
    { codigo: OBRA_B, registro: 'Real', nome: 'PILOTO · Mezanino industrial B', cliente: 'PILOTO · Indústria Beta', cidadeUf: 'Cidade de teste/UF', status: 'Em execução', escopo: 'Mezanino fictício', assinatura: '2026-07-01', inicio: '2026-07-15', fimContratual: '2026-10-30', valorContrato: 300_000, aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, margemAlvo: 0.2, observacoes: ROTULO_TESTE, responsavel: 'PILOTO · Gestor da obra A' },
    { codigo: OBRA_C, registro: 'Real', nome: 'PILOTO · Cobertura C', cliente: 'PILOTO · Cliente Gama', cidadeUf: 'Cidade de teste/UF', status: 'Planejamento', escopo: 'Cobertura fictícia ainda sem cronograma', valorContrato: 150_000, aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, margemAlvo: 0.25, observacoes: ROTULO_TESTE },
  ];
}

const serv = (id: string, obra: string, codigo: string, nome: string, etapa: Servico['etapa'], unidade: string, qtd: number, preco: number, status: Servico['status'], datas: { ini?: string; fim?: string; iniReal?: string; fimReal?: string } = {}, extra: Partial<Servico> = {}): Servico => ({
  id, codigoObra: obra, codigo, nome: `${PREFIXO_TESTE} ${nome}`, etapa, unidade, quantidadeOrcada: qtd, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: preco,
  inicioPrevisto: datas.ini, fimPrevisto: datas.fim, inicioReal: datas.iniReal, fimReal: datas.fimReal, status, observacoes: ROTULO_TESTE, ativo: true, ...extra,
});

function servicos(): Servico[] {
  return [
    // obra A: cronograma com datas; projeto concluido, fabricacao em andamento (com lista de materiais), montagem no prazo, pintura nao iniciada
    serv('SV-A1', OBRA_A, 'A-01', 'Projeto executivo', 'Projeto', 'vb', 1, 60_000, 'Concluído', { ini: '2026-06-01', fim: '2026-06-30', iniReal: '2026-06-01', fimReal: '2026-07-05' }),
    serv('SV-A2', OBRA_A, 'A-02', 'Fabricação da estrutura', 'Fabricação', 't', 120, 480_000, 'Em andamento', { ini: '2026-07-01', fim: '2026-10-15', iniReal: '2026-07-08' }, { custoOrcado: 360_000 }),
    serv('SV-A3', OBRA_A, 'A-03', 'Montagem da estrutura', 'Montagem', 't', 120, 240_000, 'Em andamento', { ini: '2026-09-01', fim: '2026-12-01', iniReal: '2026-09-10' }, { custoOrcado: 170_000 }),
    serv('SV-A4', OBRA_A, 'A-04', 'Pintura e acabamento', 'Pintura', 'm²', 3_000, 120_000, 'Não iniciado', { ini: '2026-11-01', fim: '2026-12-10' }),
    // obra B: sem datas previstas, servico em andamento sem avanco, custo comprometido acima da receita (margem negativa)
    serv('SV-B1', OBRA_B, 'B-01', 'Fabricação do mezanino', 'Fabricação', 't', 40, 180_000, 'Em andamento', {}, { custoOrcado: 150_000 }),
    serv('SV-B2', OBRA_B, 'B-02', 'Montagem do mezanino', 'Montagem', 't', 40, 120_000, 'Não iniciado', {}, { custoOrcado: 90_000 }),
    // obra C: sem servicos
  ];
}

const med = (id: string, obra: string, numero: string, mes: number, evento: string, servicoId: string | undefined, dataPrevista: string, bruto: number, direto: number, status: Medicao['status'], extra: Partial<Medicao> = {}): Medicao => ({
  id, codigoObra: obra, servicoId, numero, mes, etapa: evento, evento: `${PREFIXO_TESTE} ${evento}`, escopo: '', criterio: 'evento físico (teste)', documentos: '', tipoMedicao: 'Evento físico', responsavelAprovacao: 'PILOTO · Fiscal',
  dataPrevista, valorBruto: bruto, faturamentoDireto: direto, faturamentoConstrutora: bruto - direto, retencao: Math.round((bruto - direto) * 0.05 * 100) / 100, pctEvolucaoPlanejada: 0, status, observacoes: ROTULO_TESTE, ...extra,
});

function medicoes(): Medicao[] {
  return [
    med('MD-A1', OBRA_A, 'E01', 1, 'Projeto aprovado', 'SV-A1', '2026-07-05', 60_000, 0, 'Faturado', { dataMedicao: '2026-07-06', valorMedido: 60_000, lancamentoId: 'REC-A1' }),
    med('MD-A2', OBRA_A, 'E02', 3, 'Fabricação 50%', 'SV-A2', '2026-08-30', 240_000, 80_000, 'Medido', { dataMedicao: '2026-09-02', valorMedido: 160_000, lancamentoId: 'REC-A2' }),
    med('MD-A3', OBRA_A, 'E03', 4, 'Fabricação 100%', 'SV-A2', '2026-09-15', 240_000, 80_000, 'Pendente'),
    med('MD-A4', OBRA_A, 'E04', 5, 'Montagem 50%', 'SV-A3', '2026-10-20', 120_000, 0, 'Pendente'),
    med('MD-A5', OBRA_A, 'E05', 6, 'Montagem 100% e pintura', 'SV-A3', '2026-12-05', 240_000, 0, 'Pendente'),
    med('MD-B1', OBRA_B, 'E01', 1, 'Fabricação do mezanino', 'SV-B1', '2026-09-10', 180_000, 0, 'Pendente'),
    med('MD-B2', OBRA_B, 'E02', 2, 'Montagem do mezanino', 'SV-B2', '2026-10-25', 120_000, 0, 'Pendente'),
  ];
}

const conj = (id: string, obra: string, servicoId: string, marca: string, tipo: Conjunto['tipo'], qtd: number, pesoUnit: number, fab: number, exp: number, mont: number, ordemId?: string): Conjunto => ({
  id, codigoObra: obra, servicoId, ordemId, marca, descricao: `${PREFIXO_TESTE} ${tipo} ${marca}`, tipo, quantidade: qtd, pesoUnitario: pesoUnit, liberadoEm: '2026-07-01', fabricadoQtd: fab, expedidoQtd: exp, montadoQtd: mont, observacoes: ROTULO_TESTE, atualizadoEm: FIXTURE_GERADA_EM,
});

function conjuntos(): Conjunto[] {
  return [
    conj('CJ-A1', OBRA_A, 'SV-A2', 'P-01', 'Pilar', 20, 1_200, 20, 20, 12, 'OF-A1'),
    conj('CJ-A2', OBRA_A, 'SV-A2', 'V-01', 'Viga', 40, 800, 30, 20, 8, 'OF-A1'),
    conj('CJ-A3', OBRA_A, 'SV-A2', 'T-01', 'Terça', 200, 120, 120, 60, 0, 'OF-A2'),
    conj('CJ-A4', OBRA_A, 'SV-A2', 'C-01', 'Contraventamento', 60, 200, 20, 0, 0, 'OF-A2'),
  ];
}

const ordem = (id: string, obra: string, servicoId: string, tipo: OrdemProducao['tipo'], codigo: string, descricao: string, qtd: number, necessidade: string, etapas: [string, number][]): OrdemProducao => ({
  id, codigoObra: obra, servicoId, tipo, codigo, descricao: `${PREFIXO_TESTE} ${descricao}`, quantidade: qtd, unidade: 't', prioridade: 'Normal', dataNecessidade: necessidade,
  etapas: etapas.map(([nome, q]) => ({ nome, status: (q >= qtd ? 'Concluída' : q > 0 ? 'Em andamento' : 'Pendente') as EtapaOrdem['status'], quantidadeConcluida: q })), observacoes: ROTULO_TESTE, criadoEm: FIXTURE_GERADA_EM, criadoPor: 'piloto',
});

function ordens(): OrdemProducao[] {
  return [
    ordem('OF-A1', OBRA_A, 'SV-A2', 'Fabricação', 'OF-A01', 'Pilares e vigas principais', 56, '2026-09-10', [['Corte', 56], ['Furação', 56], ['Montagem e ponteamento', 56], ['Solda', 56], ['Pintura', 48], ['Expedição', 40]]),
    ordem('OF-A2', OBRA_A, 'SV-A2', 'Fabricação', 'OF-A02', 'Terças e contraventamentos', 36, '2026-10-05', [['Corte', 36], ['Furação', 30], ['Montagem e ponteamento', 26], ['Solda', 20], ['Pintura', 14], ['Expedição', 7]]),
    ordem('OM-A1', OBRA_A, 'SV-A3', 'Montagem', 'OM-A01', 'Montagem dos pórticos 1 a 6', 56, '2026-10-30', [['Recebimento em obra', 40], ['Pré-montagem', 30], ['Içamento', 20], ['Fixação / torqueamento', 20], ['Liberação', 20]]),
    ordem('OF-B1', OBRA_B, 'SV-B1', 'Fabricação', 'OF-B01', 'Vigas do mezanino', 40, '2026-09-05', [['Corte', 40], ['Furação', 40], ['Montagem e ponteamento', 40], ['Solda', 40], ['Pintura', 0], ['Expedição', 0]]),
  ];
}

interface Lanc { id: string; cat: string; obra: string; servico?: string; cp: string; desc: string; comp: string; venc: string; status: Lancamento['status']; valor: number; real?: string; direto?: boolean; ret?: number }
function lanc(l: Lanc): Lancamento {
  return {
    id: l.id, registro: 'Real', categoria: l.cat, subcategoria: '', centroCusto: 'Obra', codigoObra: l.obra, servicoId: l.servico, faturamentoDireto: l.direto, contraparte: `${PREFIXO_TESTE} ${l.cp}`, documento: `TESTE-${l.id}`, descricao: `${PREFIXO_TESTE} ${l.desc}`,
    competencia: l.comp, vencimento: l.venc, realizacao: l.real, status: l.status, confiabilidade: 'Confirmado', probabilidade: 1, contaFinanceira: CONTA, valorBruto: l.valor, retencoes: l.ret ?? 0, desconto: 0, multaJuros: 0, valorRealizado: l.real ? l.valor - (l.ret ?? 0) : undefined,
    conciliado: false, observacoes: ROTULO_TESTE, anexos: [], origem: 'piloto', ...AUD,
  };
}

function lancamentos(): Lancamento[] {
  return [
    // receitas da obra A (medicoes E01 recebida, E02 faturada e a receber)
    lanc({ id: 'REC-A1', cat: 'Medições de obras', obra: OBRA_A, servico: 'SV-A1', cp: 'Construtora Alfa', desc: 'E01 — projeto aprovado', comp: '2026-07-01', venc: '2026-08-05', real: '2026-08-05', status: 'Realizado', valor: 60_000, ret: 3_000 }),
    lanc({ id: 'REC-A2', cat: 'Medições de obras', obra: OBRA_A, servico: 'SV-A2', cp: 'Construtora Alfa', desc: 'E02 — fabricação 50%', comp: '2026-09-01', venc: '2026-10-02', status: 'Programado', valor: 160_000, ret: 8_000 }),
    // custos da obra A: aco pago, montagem a pagar, compra com faturamento direto (dentro do saldo contratado de 160 mil)
    lanc({ id: 'PAG-A1', cat: 'Aço e perfis', obra: OBRA_A, servico: 'SV-A2', cp: 'Siderúrgica Gama', desc: 'Perfis W — lotes 1 a 3', comp: '2026-07-15', venc: '2026-08-15', real: '2026-08-15', status: 'Realizado', valor: 150_000 }),
    lanc({ id: 'PAG-A2', cat: 'Aço e perfis', obra: OBRA_A, servico: 'SV-A2', cp: 'Siderúrgica Gama', desc: 'Chapas e terças — lote 4', comp: '2026-09-01', venc: '2026-10-01', status: 'Programado', valor: 90_000 }),
    lanc({ id: 'PAG-A3', cat: 'Mão de obra terceirizada', obra: OBRA_A, servico: 'SV-A3', cp: 'Montagens Delta', desc: 'Montagem — setembro', comp: '2026-09-30', venc: '2026-10-10', status: 'Programado', valor: 45_000 }),
    lanc({ id: 'PAG-A4', cat: 'Chapas, telhas e painéis', obra: OBRA_A, servico: 'SV-A2', cp: 'Painéis Iota', desc: 'Telhas pagas direto pelo cliente', comp: '2026-08-20', venc: '2026-09-20', status: 'Programado', valor: 70_000, direto: true }),
    // custos da obra B: comprometido acima da receita (margem projetada negativa)
    lanc({ id: 'PAG-B1', cat: 'Aço e perfis', obra: OBRA_B, servico: 'SV-B1', cp: 'Siderúrgica Gama', desc: 'Vigas do mezanino', comp: '2026-08-01', venc: '2026-09-01', real: '2026-09-01', status: 'Realizado', valor: 210_000 }),
    lanc({ id: 'PAG-B2', cat: 'Mão de obra terceirizada', obra: OBRA_B, servico: 'SV-B1', cp: 'Montagens Delta', desc: 'Fabricação terceirizada', comp: '2026-09-01', venc: '2026-10-05', status: 'Programado', valor: 95_000 }),
    lanc({ id: 'PAG-B3', cat: 'Equipamentos e locações', obra: OBRA_B, servico: 'SV-B2', cp: 'Locadora Zeta', desc: 'Guindaste reservado', comp: '2026-10-01', venc: '2026-11-05', status: 'Aprovado', valor: 30_000 }),
  ];
}

/** Dataset completo e ficticio da variante pedida. Sempre um objeto novo. */
export function datasetTeste(variante: VarianteFixture = 'padrao'): Dataset {
  const base = clone(seed) as unknown as Dataset;
  const ds: Dataset = {
    ...base,
    params: { ...base.params, organizacao: 'PILOTO', empresa: 'PILOTO · Empresa de teste', dataBase: DATA_BASE_TESTE, dataBaseAutomatica: false, cenario: 'Base', incluirDemo: false, reservaMinima: 50_000, corteExtrato: '2026-09-01', responsavel: ROTULO_TESTE, versao: 'piloto ux-p03' },
    contas: [{ id: 'CTA-PILOTO-A', registro: 'Real', instituicao: CONTA, conta: 'PILOTO · conta corrente A', tipo: 'Conta corrente', saldoInicial: 200_000, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true }],
    obras: obras(),
    servicos: servicos(),
    medicoes: medicoes(),
    conjuntos: conjuntos(),
    ordens: ordens(),
    avancos: [{ id: 'AV-A3', codigoObra: OBRA_A, servicoId: 'SV-A3', data: '2026-09-20', quantidade: 20, descricao: `${PREFIXO_TESTE} pórticos 1 a 2 montados`, responsavel: 'PILOTO · Gestor da obra A', criadoEm: FIXTURE_GERADA_EM }],
    lancamentos: lancamentos(),
    liquidacoes: [
      { id: 'LIQ-A1', lancamentoId: 'REC-A1', data: '2026-08-05', valor: 57_000, conta: CONTA, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
      { id: 'LIQ-A2', lancamentoId: 'PAG-A1', data: '2026-08-15', valor: 150_000, conta: CONTA, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
      { id: 'LIQ-B1', lancamentoId: 'PAG-B1', data: '2026-09-01', valor: 210_000, conta: CONTA, criadoPor: 'piloto', criadoEm: FIXTURE_GERADA_EM },
    ],
    transacoes: [],
    dividas: [],
    aprovacoes: [],
    demandas: [],
    usuarios: [USUARIO_DIRETORIA, USUARIO_GESTOR_A, USUARIO_SEM_OBRA],
    auditoria: [],
  };
  if (variante === 'vazio') { ds.obras = []; ds.servicos = []; ds.medicoes = []; ds.conjuntos = []; ds.ordens = []; ds.avancos = []; ds.lancamentos = []; ds.liquidacoes = []; }
  return ds;
}

/** Usuario e conjunto de obras visiveis de cada variante (contrato de entrada do piloto; nao e ACL). */
export function entradaDaVariante(variante: VarianteFixture): { usuario: Usuario; codigosObraVisiveis: string[] } {
  if (variante === 'subconjunto') return { usuario: USUARIO_GESTOR_A, codigosObraVisiveis: [OBRA_A] };
  if (variante === 'nenhuma') return { usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] };
  return { usuario: USUARIO_DIRETORIA, codigosObraVisiveis: variante === 'vazio' ? [] : TODAS_AS_OBRAS };
}

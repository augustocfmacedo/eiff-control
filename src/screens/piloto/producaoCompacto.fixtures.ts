// UX-P07 — Produção compacto: DADOS DE TESTE do piloto.
//
// Tudo aqui e ficticio e visivelmente marcado ("PILOTO · DADOS DE TESTE"). Nenhum nome real do seed sobrevive: obras,
// servicos, ordens, conjuntos, apontamentos, romaneios, colaboradores, estoque e usuarios sao do piloto. O Dataset nasce de
// uma copia do seed (estrutura, parametros e plano de contas) e recebe tres obras:
//   A — fabricacao normal, fabricacao parcial com data vencida (etapa atual sem responsavel), fabricacao concluida,
//       montagem pendente e montagem parcial sem data de necessidade; lista de materiais com conjunto nao liberado,
//       liberado, em fabricacao, fabricado (peso em fabrica), expedido (peso em canteiro) e montado; servico em risco;
//       apontamentos de fabrica; romaneio entregue e romaneio emitido; aco consumido.
//   B — montagem parcial com data vencida, ordem cancelada, fabricacao nao iniciada; servico atrasado e servico em
//       andamento sem avanco; apontamentos de canteiro abaixo da meta; romaneio cancelado.
//   C — nenhum dado de producao (ausente != zero) e servico sem datas previstas.
// A fixture so existe para a demonstracao isolada (dev) e para os testes; nunca para o runtime integrado.
import seed from '../../data/seed.json';
import { ETAPAS_FABRICACAO, ETAPAS_MONTAGEM } from '../../core/obras';
import type { ApontamentoEstacao, Colaborador, Conjunto, Dataset, EtapaOrdem, ItemEstoque, MovimentoEstoque, Obra, OrdemProducao, Romaneio, Servico, StatusEtapa, Usuario } from '../../core/types';

export const ROTULO_TESTE = 'PILOTO · DADOS DE TESTE';
export const PREFIXO_TESTE = 'PILOTO ·';
export const DATA_BASE_TESTE = '2026-09-23';
export const FIXTURE_GERADA_EM = '2026-09-23T12:00:00.000Z';

export const OBRA_A = 'OB-PP-A';
export const OBRA_B = 'OB-PP-B';
export const OBRA_C = 'OB-PP-C';
export const TODAS_AS_OBRAS = [OBRA_A, OBRA_B, OBRA_C];

export type VarianteFixture = 'padrao' | 'subconjunto' | 'parcial' | 'nenhuma' | 'sem-producao' | 'vazio';
export const VARIANTES: { id: VarianteFixture; rotulo: string; descricao: string }[] = [
  { id: 'padrao', rotulo: 'Todas as obras', descricao: 'Diretoria com as três obras visíveis: carteira completa, checks e sugestão global visíveis.' },
  { id: 'subconjunto', rotulo: 'Só a obra A', descricao: 'Gestor que enxerga só OB-PP-A: números daquela obra, globais fora.' },
  { id: 'parcial', rotulo: 'Obras A e B', descricao: 'Duas de três obras: agregadores canônicos sobre as obras visíveis, sem os globais.' },
  { id: 'nenhuma', rotulo: 'Nenhuma visível', descricao: 'Usuário sem obra visível: estado próprio, sem número.' },
  { id: 'sem-producao', rotulo: 'Sem produção', descricao: 'Obras cadastradas e visíveis, sem ordem, lista, apontamento ou romaneio.' },
  { id: 'vazio', rotulo: 'Sem obras', descricao: 'Dataset sem obra cadastrada.' },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const USUARIO_DIRETORIA: Usuario = { id: 'u-pp-dir', nome: 'PILOTO · Diretoria', email: 'pp-dir@teste.invalid', papel: 'Diretoria', obras: '*', ativo: true };
export const USUARIO_GESTOR_A: Usuario = { id: 'u-pp-gestor', nome: 'PILOTO · Gestor da obra A', email: 'pp-gestor@teste.invalid', papel: 'Gestor de obra', obras: [OBRA_A], ativo: true };
export const USUARIO_SEM_OBRA: Usuario = { id: 'u-pp-eng', nome: 'PILOTO · Engenharia sem obra', email: 'pp-eng@teste.invalid', papel: 'Engenharia', obras: [], ativo: true };
/** Nome de motorista gravado num romaneio: prova de que o piloto nao expoe esse dado. */
export const MOTORISTA_TESTE = 'PILOTO · Motorista de teste';

function obras(): Obra[] {
  const base = { registro: 'Real' as const, cidadeUf: 'Cidade de teste/UF', aditivos: 0, custoOrcado: 0, execucaoFisica: 0, medidoFaturado: 0, estimativaConcluir: 0, observacoes: ROTULO_TESTE };
  return [
    { ...base, codigo: OBRA_A, nome: 'PILOTO · Galpão de produção A', cliente: 'PILOTO · Cliente Alfa', status: 'Em execução', escopo: 'Estrutura metálica fictícia', assinatura: '2026-06-01', inicio: '2026-06-15', fimContratual: '2026-12-20', valorContrato: 900_000, margemAlvo: 0.22, responsavel: 'PILOTO · Gestor da obra A' },
    { ...base, codigo: OBRA_B, nome: 'PILOTO · Mezanino de produção B', cliente: 'PILOTO · Cliente Beta', status: 'Em execução', escopo: 'Mezanino fictício', assinatura: '2026-07-01', inicio: '2026-07-10', fimContratual: '2026-11-30', valorContrato: 260_000, margemAlvo: 0.2 },
    { ...base, codigo: OBRA_C, nome: 'PILOTO · Cobertura sem produção C', cliente: 'PILOTO · Cliente Gama', status: 'Planejamento', escopo: 'Cobertura fictícia', valorContrato: 120_000, margemAlvo: 0.25 },
  ];
}

const srv = (s: Partial<Servico> & Pick<Servico, 'id' | 'codigoObra' | 'codigo' | 'nome' | 'etapa' | 'status'>): Servico => ({ unidade: 'kg', quantidadeOrcada: 1_000, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 100_000, observacoes: ROTULO_TESTE, ativo: true, ...s, nome: `${PREFIXO_TESTE} ${s.nome}` });
function servicos(): Servico[] {
  return [
    srv({ id: 'SV-PP-A1', codigoObra: OBRA_A, codigo: 'A-01', nome: 'Fabricação da estrutura', etapa: 'Fabricação', status: 'Em andamento', quantidadeOrcada: 13_088, precoVenda: 600_000, inicioPrevisto: '2026-07-01', fimPrevisto: '2026-10-31', responsavel: 'PILOTO · Encarregado de fábrica' }),
    srv({ id: 'SV-PP-A2', codigoObra: OBRA_A, codigo: 'A-02', nome: 'Montagem da estrutura', etapa: 'Montagem', status: 'Não iniciado', precoVenda: 200_000, inicioPrevisto: '2026-10-01', fimPrevisto: '2026-12-10' }),
    srv({ id: 'SV-PP-B1', codigoObra: OBRA_B, codigo: 'B-01', nome: 'Mezanino metálico', etapa: 'Montagem', status: 'Em andamento', quantidadeOrcada: 2_200, precoVenda: 180_000, inicioPrevisto: '2026-07-10', fimPrevisto: '2026-09-15' }),
    srv({ id: 'SV-PP-B2', codigoObra: OBRA_B, codigo: 'B-02', nome: 'Escada de acesso', etapa: 'Fabricação', status: 'Em andamento', precoVenda: 40_000 }),
    srv({ id: 'SV-PP-C1', codigoObra: OBRA_C, codigo: 'C-01', nome: 'Cobertura', etapa: 'Cobertura e fechamento', status: 'Não iniciado', precoVenda: 90_000 }),
  ];
}

type E = [StatusEtapa, string?];
/** Etapas na ordem das estacoes do core; `E` = [status, responsavel?]. */
function etapas(tipo: OrdemProducao['tipo'], estados: E[], quantidade: number): EtapaOrdem[] {
  const nomes = tipo === 'Fabricação' ? ETAPAS_FABRICACAO : ETAPAS_MONTAGEM;
  return nomes.map((nome, i) => {
    const [status, responsavel] = estados[i] ?? ['Pendente'];
    return { nome, status, quantidadeConcluida: status === 'Concluída' ? quantidade : 0, responsavel, inicio: status !== 'Pendente' ? '2026-09-01' : undefined, fim: status === 'Concluída' ? '2026-09-10' : undefined };
  });
}
const C: E = ['Concluída'];
const ordem = (o: Omit<OrdemProducao, 'observacoes' | 'criadoEm' | 'criadoPor' | 'prioridade' | 'descricao'> & { descricao: string }): OrdemProducao => ({ prioridade: 'Normal', observacoes: ROTULO_TESTE, criadoEm: FIXTURE_GERADA_EM, criadoPor: 'PILOTO · Planejamento', ...o, descricao: `${PREFIXO_TESTE} ${o.descricao}` });
function ordens(): OrdemProducao[] {
  return [
    // obra A
    ordem({ id: 'OF-PP-A1', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', tipo: 'Fabricação', codigo: 'OF-A1', descricao: 'Lote 1 · pilares', quantidade: 6, unidade: 't', dataNecessidade: '2026-10-15', etapas: etapas('Fabricação', [['Concluída', 'PILOTO · Líder de corte'], C, ['Em andamento', 'PILOTO · Líder de montagem']], 6) }),
    ordem({ id: 'OF-PP-A2', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', tipo: 'Fabricação', codigo: 'OF-A2', descricao: 'Lote 2 · vigas', quantidade: 8, unidade: 't', dataNecessidade: '2026-09-18', etapas: etapas('Fabricação', [C, C, C, ['Em andamento']], 8) }),
    ordem({ id: 'OF-PP-A3', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', tipo: 'Fabricação', codigo: 'OF-A3', descricao: 'Lote 0 · chumbadores', quantidade: 1.2, unidade: 't', dataNecessidade: '2026-09-01', etapas: etapas('Fabricação', [C, C, C, C, C, C], 1.2) }),
    ordem({ id: 'OM-PP-A1', codigoObra: OBRA_A, servicoId: 'SV-PP-A2', tipo: 'Montagem', codigo: 'OM-A1', descricao: 'Eixos 1 a 4', quantidade: 14, unidade: 't', dataNecessidade: '2026-11-10', etapas: etapas('Montagem', [], 14) }),
    ordem({ id: 'OM-PP-A2', codigoObra: OBRA_A, servicoId: 'SV-PP-A2', tipo: 'Montagem', codigo: 'OM-A2', descricao: 'Eixos 5 a 8', quantidade: 10, unidade: 't', etapas: etapas('Montagem', [C, ['Em andamento', 'PILOTO · Encarregado de montagem']], 10) }),
    // obra B
    ordem({ id: 'OM-PP-B1', codigoObra: OBRA_B, servicoId: 'SV-PP-B1', tipo: 'Montagem', codigo: 'OM-B1', descricao: 'Mezanino completo', quantidade: 4, unidade: 't', dataNecessidade: '2026-09-10', etapas: etapas('Montagem', [C, C, ['Em andamento', 'PILOTO · Encarregado de montagem']], 4) }),
    ordem({ id: 'OF-PP-B1', codigoObra: OBRA_B, tipo: 'Fabricação', codigo: 'OF-B1', descricao: 'Lote cancelado', quantidade: 2, unidade: 't', dataNecessidade: '2026-08-30', cancelada: true, etapas: etapas('Fabricação', [C], 2) }),
    ordem({ id: 'OF-PP-B2', codigoObra: OBRA_B, servicoId: 'SV-PP-B2', tipo: 'Fabricação', codigo: 'OF-B2', descricao: 'Escada', quantidade: 20, unidade: 'pç', dataNecessidade: '2026-10-05', etapas: etapas('Fabricação', [], 20) }),
  ];
}

const cj = (c: Omit<Conjunto, 'observacoes' | 'atualizadoEm' | 'descricao'> & { descricao: string; atualizadoEm?: string }): Conjunto => ({ observacoes: ROTULO_TESTE, atualizadoEm: FIXTURE_GERADA_EM, ...c, descricao: `${PREFIXO_TESTE} ${c.descricao}` });
function conjuntos(): Conjunto[] {
  return [
    // obra A (13.088 kg): expedido com parte montada, em fabricacao, liberado, nao liberado, montado, fabricado
    cj({ id: 'CJ-PP-A1', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', ordemId: 'OF-PP-A1', marca: 'P-01', descricao: 'Pilar principal', perfil: 'W 310x38,7', tipo: 'Pilar', quantidade: 10, pesoUnitario: 400, liberadoEm: '2026-07-05', fabricadoQtd: 10, expedidoQtd: 10, montadoQtd: 4, atualizadoEm: '2026-09-22T17:40:00.000Z' }),
    cj({ id: 'CJ-PP-A2', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', ordemId: 'OF-PP-A2', marca: 'V-01', descricao: 'Viga de cobertura', tipo: 'Viga', quantidade: 12, pesoUnitario: 350, liberadoEm: '2026-08-01', fabricadoQtd: 8, expedidoQtd: 2, montadoQtd: 0 }),
    cj({ id: 'CJ-PP-A3', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', marca: 'T-01', descricao: 'Terça', tipo: 'Terça', quantidade: 40, pesoUnitario: 60, liberadoEm: '2026-09-01', fabricadoQtd: 0, expedidoQtd: 0, montadoQtd: 0 }),
    cj({ id: 'CJ-PP-A4', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', marca: 'C-01', descricao: 'Contraventamento', tipo: 'Contraventamento', quantidade: 16, pesoUnitario: 25, fabricadoQtd: 0, expedidoQtd: 0, montadoQtd: 0 }),
    cj({ id: 'CJ-PP-A5', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', ordemId: 'OF-PP-A3', marca: 'CH-01', descricao: 'Chumbador', tipo: 'Chumbador', quantidade: 24, pesoUnitario: 12, liberadoEm: '2026-07-01', fabricadoQtd: 24, expedidoQtd: 24, montadoQtd: 24 }),
    cj({ id: 'CJ-PP-A6', codigoObra: OBRA_A, servicoId: 'SV-PP-A1', marca: 'V-02', descricao: 'Viga de piso', tipo: 'Viga', quantidade: 6, pesoUnitario: 300, liberadoEm: '2026-08-10', fabricadoQtd: 6, expedidoQtd: 0, montadoQtd: 0 }),
    // obra B: expedido com parte montada, nao liberado
    cj({ id: 'CJ-PP-B1', codigoObra: OBRA_B, servicoId: 'SV-PP-B1', marca: 'M-01', descricao: 'Plataforma do mezanino', tipo: 'Plataforma', quantidade: 4, pesoUnitario: 500, liberadoEm: '2026-07-15', fabricadoQtd: 4, expedidoQtd: 4, montadoQtd: 1 }),
    cj({ id: 'CJ-PP-B2', codigoObra: OBRA_B, servicoId: 'SV-PP-B1', marca: 'G-01', descricao: 'Guarda-corpo', tipo: 'Outros', quantidade: 20, pesoUnitario: 10, fabricadoQtd: 0, expedidoQtd: 0, montadoQtd: 0 }),
  ];
}

function colaboradores(): Colaborador[] {
  const c = (id: string, nome: string, funcao: string, local: Colaborador['local'], custoHora: number): Colaborador => ({ id, nome: `${PREFIXO_TESTE} ${nome}`, funcao, vinculo: 'CLT', equipe: `${PREFIXO_TESTE} equipe`, local, custoHora, jornadaDiaria: 8, ativo: true, observacoes: ROTULO_TESTE });
  return [c('COL-PP-1', 'Cortador', 'Caldeireiro', 'Fábrica', 41.5), c('COL-PP-2', 'Soldador', 'Soldador', 'Fábrica', 47.25), c('COL-PP-3', 'Pintor', 'Pintor', 'Fábrica', 38.75), c('COL-PP-4', 'Montador 1', 'Montador', 'Obra', 44.5), c('COL-PP-5', 'Montador 2', 'Montador', 'Obra', 44.5)];
}

const ap = (a: Omit<ApontamentoEstacao, 'observacao' | 'responsavel' | 'criadoEm' | 'conjuntos'> & { conjuntos?: ApontamentoEstacao['conjuntos'] }): ApontamentoEstacao => ({ conjuntos: [], observacao: ROTULO_TESTE, responsavel: USUARIO_GESTOR_A.id, criadoEm: FIXTURE_GERADA_EM, ...a });
function apontamentos(): ApontamentoEstacao[] {
  return [
    // fora do periodo padrao (data-base − 30 dias): nao entra na produtividade
    ap({ id: 'AP-PP-A0', data: '2026-07-15', codigoObra: OBRA_A, linha: 'Fabricação', estacao: 'Corte', pecas: 8, pesoKg: 500, colaboradores: [{ colaboradorId: 'COL-PP-1', horas: 8 }] }),
    ap({ id: 'AP-PP-A1', data: '2026-09-20', codigoObra: OBRA_A, ordemId: 'OF-PP-A2', linha: 'Fabricação', estacao: 'Corte', pecas: 20, pesoKg: 1_200, colaboradores: [{ colaboradorId: 'COL-PP-1', horas: 8 }, { colaboradorId: 'COL-PP-2', horas: 8 }] }),
    ap({ id: 'AP-PP-A2', data: '2026-09-21', codigoObra: OBRA_A, ordemId: 'OF-PP-A2', linha: 'Fabricação', estacao: 'Solda', pecas: 10, pesoKg: 900, colaboradores: [{ colaboradorId: 'COL-PP-2', horas: 8 }, { colaboradorId: 'COL-PP-3', horas: 8 }] }),
    ap({ id: 'AP-PP-A3', data: '2026-09-21', codigoObra: OBRA_A, linha: 'Fabricação', estacao: 'Pintura', pecas: 6, pesoKg: 1_800, conjuntos: [{ conjuntoId: 'CJ-PP-A6', quantidade: 6 }], colaboradores: [{ colaboradorId: 'COL-PP-3', horas: 6 }] }),
    ap({ id: 'AP-PP-A4', data: '2026-09-22', codigoObra: OBRA_A, linha: 'Fabricação', estacao: 'Expedição', pecas: 2, pesoKg: 700, conjuntos: [{ conjuntoId: 'CJ-PP-A2', quantidade: 2 }], colaboradores: [{ colaboradorId: 'COL-PP-1', horas: 2 }] }),
    // canteiro da obra B: abaixo da meta de campo
    ap({ id: 'AP-PP-B1', data: '2026-09-19', codigoObra: OBRA_B, linha: 'Montagem', estacao: 'Içamento', pecas: 1, pesoKg: 300, colaboradores: [{ colaboradorId: 'COL-PP-4', horas: 8 }, { colaboradorId: 'COL-PP-5', horas: 8 }] }),
    ap({ id: 'AP-PP-B2', data: '2026-09-22', codigoObra: OBRA_B, linha: 'Montagem', estacao: 'Liberação', pecas: 1, pesoKg: 500, conjuntos: [{ conjuntoId: 'CJ-PP-B1', quantidade: 1 }], colaboradores: [{ colaboradorId: 'COL-PP-4', horas: 8 }, { colaboradorId: 'COL-PP-5', horas: 8 }] }),
  ];
}

const rom = (r: Omit<Romaneio, 'observacoes' | 'criadoEm' | 'criadoPor' | 'transportadora' | 'destino'> & { destino?: string }): Romaneio => ({ transportadora: `${PREFIXO_TESTE} Transportes Teste`, destino: `${PREFIXO_TESTE} canteiro`, observacoes: ROTULO_TESTE, criadoPor: 'PILOTO · Expedição', criadoEm: FIXTURE_GERADA_EM, motorista: MOTORISTA_TESTE, placa: 'TST0A00', ...r });
function romaneios(): Romaneio[] {
  return [
    rom({ id: 'ROM-PP-1', codigoObra: OBRA_A, numero: 'ROM-9001', data: '2026-09-10', itens: [{ conjuntoId: 'CJ-PP-A1', quantidade: 10 }], status: 'Entregue', entregueEm: '2026-09-11' }),
    rom({ id: 'ROM-PP-2', codigoObra: OBRA_A, numero: 'ROM-9002', data: '2026-09-22', itens: [{ conjuntoId: 'CJ-PP-A2', quantidade: 2 }], status: 'Emitido' }),
    rom({ id: 'ROM-PP-3', codigoObra: OBRA_B, numero: 'ROM-9003', data: '2026-09-05', itens: [{ conjuntoId: 'CJ-PP-B1', quantidade: 4 }], status: 'Entregue', entregueEm: '2026-09-06' }),
    rom({ id: 'ROM-PP-4', codigoObra: OBRA_B, numero: 'ROM-9004', data: '2026-09-08', itens: [{ conjuntoId: 'CJ-PP-B2', quantidade: 20 }], status: 'Cancelado' }),
  ];
}

function itensEstoque(): ItemEstoque[] {
  return [{ id: 'IE-PP-1', codigo: 'PP-W310', descricao: `${PREFIXO_TESTE} Perfil W310`, familia: 'Perfil laminado', estoqueMinimo: 2_000, ativo: true, observacoes: ROTULO_TESTE }];
}
const mov = (id: string, data: string, tipo: MovimentoEstoque['tipo'], quantidade: number, extra: Partial<MovimentoEstoque> = {}): MovimentoEstoque => ({ id, data, tipo, itemId: 'IE-PP-1', local: 'Fábrica', conjuntos: [], quantidade, corrida: 'PILOTO-CORRIDA-1', custoUnitario: 9, observacao: ROTULO_TESTE, responsavel: 'piloto', criadoEm: FIXTURE_GERADA_EM, ...extra });
function movimentosEstoque(): MovimentoEstoque[] {
  return [
    mov('ME-PP-1', '2026-08-20', 'Entrada', 10_000, { fornecedor: `${PREFIXO_TESTE} Siderúrgica Teste` }),
    mov('ME-PP-2', '2026-09-02', 'Consumo', 3_000, { codigoObra: OBRA_A, servicoId: 'SV-PP-A1', ordemId: 'OF-PP-A1' }),
    mov('ME-PP-3', '2026-09-12', 'Sobra', 200, { codigoObra: OBRA_A, servicoId: 'SV-PP-A1' }),
    mov('ME-PP-4', '2026-09-14', 'Consumo', 900, { codigoObra: OBRA_B, servicoId: 'SV-PP-B1' }),
  ];
}

/** Dataset completo e ficticio da variante pedida. Sempre um objeto novo. */
export function datasetTeste(variante: VarianteFixture = 'padrao'): Dataset {
  const base = clone(seed) as unknown as Dataset;
  const ds: Dataset = {
    ...base,
    params: { ...base.params, organizacao: 'PILOTO', empresa: 'PILOTO · Empresa de teste', dataBase: DATA_BASE_TESTE, dataBaseAutomatica: false, cenario: 'Base', incluirDemo: false, reservaMinima: 50_000, corteExtrato: '2026-09-01', responsavel: ROTULO_TESTE, versao: 'piloto ux-p07' },
    contas: [{ id: 'CTA-PP', registro: 'Real', instituicao: 'PILOTO · Banco P', conta: 'PILOTO · conta corrente P', tipo: 'Conta corrente', saldoInicial: 200_000, saldoInicialData: '2026-09-01', reservaVinculada: 0, ativa: true }],
    obras: obras(), servicos: servicos(), ordens: ordens(), conjuntos: conjuntos(), colaboradores: colaboradores(),
    apontamentosEstacao: apontamentos(), romaneios: romaneios(), itensEstoque: itensEstoque(), movimentosEstoque: movimentosEstoque(),
    medicoes: [], avancos: [], demandas: [], rateios: [], insumos: [], composicoes: [], orcamentos: [], pedidos: [],
    lancamentos: [], liquidacoes: [], transacoes: [], dividas: [], aprovacoes: [], auditoria: [], comentarios: [], tarefas: [],
    fechamentos: [], apontamentos: [], treinamentos: [], fotos: [], funcoes: [], alocacoes: [],
    usuarios: [USUARIO_DIRETORIA, USUARIO_GESTOR_A, USUARIO_SEM_OBRA],
  };
  if (variante === 'sem-producao') { ds.ordens = []; ds.conjuntos = []; ds.apontamentosEstacao = []; ds.romaneios = []; ds.movimentosEstoque = []; }
  if (variante === 'vazio') { ds.obras = []; ds.servicos = []; ds.ordens = []; ds.conjuntos = []; ds.apontamentosEstacao = []; ds.romaneios = []; ds.movimentosEstoque = []; }
  return ds;
}

/** Usuario e conjunto de obras visiveis de cada variante (contrato de entrada do piloto; nao e ACL). */
export function entradaDaVariante(variante: VarianteFixture): { usuario: Usuario; codigosObraVisiveis: string[] } {
  if (variante === 'subconjunto') return { usuario: USUARIO_GESTOR_A, codigosObraVisiveis: [OBRA_A] };
  if (variante === 'parcial') return { usuario: USUARIO_DIRETORIA, codigosObraVisiveis: [OBRA_A, OBRA_B] };
  if (variante === 'nenhuma') return { usuario: USUARIO_SEM_OBRA, codigosObraVisiveis: [] };
  return { usuario: USUARIO_DIRETORIA, codigosObraVisiveis: variante === 'vazio' ? [] : TODAS_AS_OBRAS };
}

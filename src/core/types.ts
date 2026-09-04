// Modelo de dominio do EIFF Control.
// Espelha o catalogo de entidades do Blueprint Funcional v1 e preserva os campos da planilha.

export type Cenario = 'Conservador' | 'Base' | 'Otimista';
export type Registro = 'Real' | 'Exemplo';
export type TipoLancamento = 'Entrada' | 'Saída';

/** Estados do lancamento financeiro (Blueprint, secao 5). */
export type StatusLancamento =
  | 'Rascunho'
  | 'Pendente'
  | 'Aprovado'
  | 'Programado'
  | 'Realizado'
  | 'Cancelado';

export type Confiabilidade = 'Confirmado' | 'Provável' | 'Estimado';
export type StatusObra = 'Planejamento' | 'Em execução' | 'Suspensa' | 'Concluída' | 'Cancelada';

export type Papel =
  | 'Administrador'
  | 'Diretoria'
  | 'Financeiro'
  | 'Gestor de obra'
  | 'Engenharia'
  | 'Compras'
  | 'Contabilidade'
  | 'Auditoria';

export interface FatoresCenario {
  entradas: number;
  saidas: number;
}

export interface Alcadas {
  limiteGestorObra: number;
  limiteFinanceiro: number;
  limiteDiretoria: number;
  desvioOrcamentoPermitido: number; // percentual 0-1
  toleranciaConciliacao: number; // valor absoluto
  slaAprovacaoHoras: number;
}

export interface Params {
  organizacao: string;
  empresa: string;
  dataBase: string; // yyyy-mm-dd
  dataBaseAutomatica?: boolean; // true = a data-base acompanha o dia de hoje; false = fixa (fechamento, simulação)
  cenario: Cenario;
  incluirDemo: boolean;
  reservaMinima: number;
  fatores: Record<Cenario, FatoresCenario>;
  alcadas: Alcadas;
  responsavel: string;
  versao: string;
}

export interface PlanoConta {
  categoria: string;
  tipo: TipoLancamento;
  grupoFluxo: string;
  grupoDre: string;
  classe: string;
  orientacao: string;
  ativa: boolean;
}

export interface ContaFinanceira {
  id: string;
  registro: Registro;
  instituicao: string;
  conta: string;
  tipo: string;
  saldoInicial: number;
  saldoInicialData?: string; // dia a partir do qual os movimentos sao somados (abertura = saldo no inicio deste dia)
  reservaVinculada: number;
  ativa: boolean;
}

export interface Obra {
  codigo: string;
  registro: Registro;
  nome: string;
  cliente: string;
  cidadeUf: string;
  status: StatusObra;
  escopo: string;
  assinatura?: string;
  inicio?: string;
  fimContratual?: string;
  valorContrato: number;
  aditivos: number;
  custoOrcado: number;
  execucaoFisica: number; // 0-1
  medidoFaturado: number;
  estimativaConcluir: number;
  margemAlvo?: number; // 0-1; padrao dos servicos sem custo orcado
  observacoes: string;
  responsavel?: string;
}

// ---------------------------------------------------------------------------
// Operacao de obras: servicos (orcamento/cronograma), demandas e producao
// ---------------------------------------------------------------------------
export type EtapaObra = 'Projeto' | 'Fabricação' | 'Montagem' | 'Civil' | 'Cobertura e fechamento' | 'Pintura' | 'Instalações' | 'Outros';
export type StatusServico = 'Não iniciado' | 'Em andamento' | 'Concluído' | 'Suspenso';

/** Servico/atividade da obra: unidade comum de orcamento, cronograma, compra e medicao (Blueprint ORC). */
export interface Servico {
  id: string;
  codigoObra: string;
  codigo: string; // ex.: SF-01
  nome: string;
  etapa: EtapaObra;
  unidade: string; // t, m², un, vb
  quantidadeOrcada: number;
  quantidadeExecutada: number;
  custoOrcado: number;
  precoVenda: number; // parcela da receita do contrato atribuida ao servico (faturamento da construtora, liquido de retencao)
  faturamentoDireto?: number; // materiais/servicos faturados direto pelo cliente (fora da receita e do custo da EIFF)
  valorBaseOrcamento?: number; // valor do grupo no orcamento original da proposta (informativo)
  margemAlvo?: number; // 0-1; quando custoOrcado = 0, custo previsto = precoVenda x (1 - margemAlvo)
  estimativaConcluir?: number; // ETC informado; se ausente, derivado do custo previsto - comprometido
  inicioPrevisto?: string;
  fimPrevisto?: string;
  inicioReal?: string;
  fimReal?: string;
  status: StatusServico;
  responsavel?: string;
  categoriaPadrao?: string; // categoria do plano de contas sugerida para os custos
  observacoes: string;
  ativo: boolean;
}

export type StatusMedicao = 'Pendente' | 'Medido' | 'Faturado' | 'Recebido' | 'Cancelado';

/** Evento do cronograma fisico-financeiro: marco de medicao/faturamento do contrato (Blueprint MED). */
export interface Medicao {
  id: string;
  codigoObra: string;
  servicoId?: string;
  numero: string; // E01, E07b...
  mes: number; // mes contratual (1 = primeiro mes)
  etapa: string; // etapa do orcamento (texto do cronograma)
  evento: string; // titulo
  escopo: string;
  criterio: string; // criterio de medicao / aceite
  documentos: string; // documentos obrigatorios
  tipoMedicao: string; // Entrega tecnica, Evento fisico, Percentual fisico, Fabricacao, Fornecimento direto...
  responsavelAprovacao: string;
  dataPrevista?: string;
  valorBruto: number; // valor total do evento no contrato
  faturamentoDireto: number; // parte faturada direto pelo cliente aos fornecedores
  faturamentoConstrutora: number; // parte faturada pela EIFF (bruta)
  retencao: number; // retencao contratual sobre a parte da construtora
  pctEvolucaoPlanejada: number; // 0-1
  status: StatusMedicao;
  dataMedicao?: string;
  valorMedido?: number; // valor efetivamente medido/aprovado da parte construtora (bruto)
  lancamentoId?: string; // recebivel gerado ou vinculado
  observacoes: string;
}

export type Periodicidade = 'Diária' | 'Semanal' | 'Mensal' | 'Única';

/** Item de check-list de demandas da obra. Recorrentes sao concluidos por periodo. */
export interface Demanda {
  id: string;
  codigoObra: string;
  servicoId?: string;
  titulo: string;
  descricao: string;
  periodicidade: Periodicidade;
  responsavel: string; // id do usuario
  prazo?: string; // para periodicidade Única
  conclusoes: string[]; // datas (yyyy-mm-dd) em que foi concluida
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
}

export type TipoOrdem = 'Fabricação' | 'Montagem';
export type StatusEtapa = 'Pendente' | 'Em andamento' | 'Concluída';

export interface EtapaOrdem {
  nome: string;
  status: StatusEtapa;
  quantidadeConcluida: number;
  inicio?: string;
  fim?: string;
  responsavel?: string;
  observacoes?: string;
}

/** Ordem de fabricacao (linha de producao) ou de montagem (linha de montagem). */
export interface OrdemProducao {
  id: string;
  codigoObra: string;
  servicoId?: string;
  tipo: TipoOrdem;
  codigo: string; // OF-001 / OM-001
  descricao: string; // lote, peca, eixo, modulo
  quantidade: number;
  unidade: string; // t, pç, m²
  prioridade: 'Alta' | 'Normal' | 'Baixa';
  dataNecessidade?: string; // prazo para estar pronta/montada
  etapas: EtapaOrdem[];
  observacoes: string;
  criadoEm: string;
  criadoPor: string;
  cancelada?: boolean;
}

export interface Lancamento {
  id: string;
  registro: Registro;
  categoria: string;
  subcategoria: string;
  centroCusto: string;
  codigoObra: string;
  servicoId?: string;
  contraparte: string;
  documento: string;
  descricao: string;
  competencia: string;
  vencimento: string;
  realizacao?: string;
  status: StatusLancamento;
  confiabilidade: Confiabilidade;
  probabilidade: number; // 0-1
  contaFinanceira: string;
  valorBruto: number;
  retencoes: number;
  desconto: number;
  multaJuros: number;
  valorRealizado?: number;
  conciliado: boolean;
  observacoes: string;
  anexos: string[];
  origem: string; // sistema de origem
  idExterno?: string;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
  atualizadoPor: string;
  versao: number;
  motivoCancelamento?: string;
}

export interface Liquidacao {
  id: string;
  lancamentoId: string;
  data: string;
  valor: number;
  conta: string;
  documento?: string;
  criadoPor: string;
  criadoEm: string;
}

export interface TransacaoBancaria {
  id: string;
  registro: Registro;
  data: string;
  conta: string;
  historico: string;
  documento: string;
  debito: number;
  credito: number;
  lancamentoIds: string[];
  justificativa?: string;
  origem: string;
  idExterno?: string;
}

export type StatusDivida = 'Ativa' | 'Quitada' | 'Renegociada';

export interface Divida {
  id: string;
  registro: Registro;
  credor: string;
  instrumento: string;
  contratacao?: string;
  principal: number;
  saldoDevedor: number;
  taxaAa: number; // 0-1
  parcelaMensal: number;
  proximoVencimento?: string;
  parcelasRestantes: number;
  garantia: string;
  status: StatusDivida;
  observacoes: string;
}

export type TipoAprovacao =
  | 'Lançamento'
  | 'Compra'
  | 'Medição'
  | 'Aditivo'
  | 'Revisão de orçamento'
  | 'Dívida'
  | 'Reabertura de período';

export type DecisaoAprovacao = 'Pendente' | 'Aprovado' | 'Rejeitado' | 'Devolvido';

export interface EtapaAprovacao {
  papel: Papel;
  status: DecisaoAprovacao;
  decididoPor?: string;
  decididoEm?: string;
  justificativa?: string;
}

export interface ImpactoAprovacao {
  orcamentoDisponivel?: number;
  comprometidoObra?: number;
  eacObra?: number;
  margemProjetadaObra?: number;
  saldoMinimo13sAntes?: number;
  saldoMinimo13sDepois?: number;
  foraDoOrcamento?: boolean;
  abaixoDaReserva?: boolean;
}

export interface Aprovacao {
  id: string;
  tipo: TipoAprovacao;
  entidadeId: string;
  titulo: string;
  valor: number;
  codigoObra?: string;
  solicitante: string;
  criadoEm: string;
  prazoSla: string;
  etapas: EtapaAprovacao[];
  status: DecisaoAprovacao;
  impacto: ImpactoAprovacao;
  justificativaExcecao?: string;
}

export interface Auditoria {
  id: string;
  ts: string;
  usuario: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  motivo?: string;
}

export interface Comentario {
  id: string;
  entidade: string;
  entidadeId: string;
  autor: string;
  ts: string;
  texto: string;
  mencoes: string[];
}

export type StatusTarefa = 'Aberta' | 'Em andamento' | 'Bloqueada' | 'Concluída';

export interface Tarefa {
  id: string;
  titulo: string;
  descricao?: string;
  entidade?: string;
  entidadeId?: string;
  responsavel: string; // id do usuario (quem responde)
  colaboradorId?: string; // quem executa em campo/fabrica
  codigoObra?: string;
  servicoId?: string;
  ordemId?: string;
  local?: LocalTrabalho;
  prioridade?: 'Alta' | 'Normal' | 'Baixa';
  prazo: string;
  status: StatusTarefa;
  origem: string;
  criadoEm: string;
  criadoPor?: string;
  concluidoEm?: string;
  bloqueio?: string; // motivo quando Bloqueada
}

// ---------------------------------------------------------------------------
// Equipe e produtividade: colaboradores e apontamento diario (obra e fabrica)
// ---------------------------------------------------------------------------
export type LocalTrabalho = 'Obra' | 'Fábrica' | 'Escritório';
export type Vinculo = 'CLT' | 'Terceiro' | 'Sócio' | 'Estagiário' | 'Temporário';

export interface Colaborador {
  id: string;
  nome: string;
  funcao: string; // Montador, Soldador, Encarregado, Ajudante, Caldeireiro, Pintor, Projetista...
  vinculo: Vinculo;
  equipe: string; // ex.: Montagem A, Fábrica - Solda
  local: LocalTrabalho;
  codigoObraPadrao?: string;
  custoHora: number; // custo total (salario + encargos) / hora
  jornadaDiaria: number; // horas normais por dia
  usuarioId?: string; // se tiver login
  telefone?: string;
  admissao?: string;
  ativo: boolean;
  observacoes: string;
}

export type Presenca = 'Presente' | 'Falta' | 'Atestado' | 'Férias' | 'Folga';

export interface ApontamentoLinha {
  colaboradorId: string;
  presenca: Presenca;
  horas: number; // horas normais trabalhadas
  horasExtras: number;
  servicoId?: string;
  ordemId?: string;
  observacao?: string;
}

export interface ApontamentoProducao {
  servicoId?: string;
  ordemId?: string;
  descricao: string;
  quantidade: number;
  unidade: string;
}

export type TipoOcorrencia = 'Chuva' | 'Acidente' | 'Paralisação' | 'Falta de material' | 'Falta de equipamento' | 'Retrabalho' | 'Outra';

export interface ApontamentoOcorrencia {
  tipo: TipoOcorrencia;
  descricao: string;
  horasPerdidas: number;
}

/** Diario de obra / diario de fabrica de um dia e um local. */
export interface Apontamento {
  id: string;
  data: string;
  local: LocalTrabalho;
  codigoObra?: string; // obrigatorio quando local = Obra
  equipe?: string;
  linhas: ApontamentoLinha[];
  producao: ApontamentoProducao[];
  ocorrencias: ApontamentoOcorrencia[];
  fotos: string[]; // nomes/URLs de evidencias
  clima?: string;
  observacoes: string;
  status: 'Rascunho' | 'Fechado';
  responsavel: string; // usuario que apontou
  criadoEm: string;
  fechadoEm?: string;
}

// ---------------------------------------------------------------------------
// Orcamentos: insumos, composicoes (SINAPI/TCPO/proprias) e propostas com curva ABC
// ---------------------------------------------------------------------------
export type TipoInsumo = 'Material' | 'Mão de obra' | 'Equipamento' | 'Serviço' | 'Outros';
export type OrigemCatalogo = 'SINAPI' | 'TCPO' | 'Própria';

/** Insumo do catalogo de precos (material, mao de obra, equipamento ou servico). */
export interface Insumo {
  id: string;
  codigo: string; // codigo SINAPI/TCPO ou proprio
  descricao: string;
  unidade: string;
  tipo: TipoInsumo;
  origem: OrigemCatalogo;
  preco: number; // preco unitario vigente
  precoData?: string; // data de referencia do preco
  precoFonte?: string; // ex.: SINAPI GO 07/2026, cotacao Gerdau, compra PAG-0031
  classe?: string; // classificacao/grupo do catalogo
  ativo: boolean;
  observacoes: string;
}

export interface ItemComposicao {
  tipo: 'Insumo' | 'Composição';
  refId: string; // id do insumo ou da composicao auxiliar
  coeficiente: number; // quantidade por unidade da composicao
}

/** Composicao de custo unitario: lista de insumos e composicoes auxiliares com coeficientes. */
export interface Composicao {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  grupo: string; // grupo/classe do catalogo (ex.: ESTRUTURAS METALICAS)
  origem: OrigemCatalogo;
  itens: ItemComposicao[];
  ativo: boolean;
  observacoes: string;
}

export type StatusOrcamento = 'Rascunho' | 'Enviado' | 'Aprovado' | 'Contratado' | 'Perdido' | 'Cancelado';

export interface ItemOrcamento {
  id: string;
  ordem: number;
  etapa: string; // agrupador da planilha de venda (ex.: Fabricacao, Montagem)
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  composicaoId?: string; // custo unitario vem da composicao
  custoUnitarioManual?: number; // usado quando nao ha composicao
  servicoId?: string; // servico da obra gerado ao contratar
}

/** Orcamento/proposta: itens com quantidade x composicao, BDI e conversao em servicos da obra. */
export interface Orcamento {
  id: string;
  codigo: string; // ORC-0001
  titulo: string;
  cliente: string;
  codigoObra?: string; // obra vinculada (obrigatoria ao contratar)
  data: string;
  validade?: string;
  status: StatusOrcamento;
  bdi: number; // 0-1; preco de venda = custo x (1 + bdi)
  referenciaPrecos: string; // ex.: SINAPI GO 07/2026 nao desonerado
  itens: ItemOrcamento[];
  observacoes: string;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  obras: string[] | '*';
  ativo: boolean;
}

export interface FechamentoPeriodo {
  periodo: string; // yyyy-mm
  fechadoEm: string;
  fechadoPor: string;
  reaberto?: { em: string; por: string; motivo: string };
}

export interface Dataset {
  params: Params;
  planoContas: PlanoConta[];
  contas: ContaFinanceira[];
  obras: Obra[];
  lancamentos: Lancamento[];
  liquidacoes: Liquidacao[];
  transacoes: TransacaoBancaria[];
  dividas: Divida[];
  aprovacoes: Aprovacao[];
  auditoria: Auditoria[];
  comentarios: Comentario[];
  tarefas: Tarefa[];
  usuarios: Usuario[];
  fechamentos: FechamentoPeriodo[];
  servicos: Servico[];
  demandas: Demanda[];
  ordens: OrdemProducao[];
  colaboradores: Colaborador[];
  apontamentos: Apontamento[];
  medicoes: Medicao[];
  insumos: Insumo[];
  composicoes: Composicao[];
  orcamentos: Orcamento[];
}

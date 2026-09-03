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
  precoVenda: number; // parcela da receita do contrato atribuida ao servico
  estimativaConcluir?: number; // ETC informado; se ausente, derivado do orcamento - comprometido
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
}

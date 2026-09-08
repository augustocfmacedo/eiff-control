// EIFF Radar: dominio de inteligencia comercial (empresas, contatos, projetos, sinais, oportunidades, atividades,
// tarefas, respostas, estrategias, experimentos, score, fontes). Nomes em portugues no app; snake_case ingles no banco
// (ver migration 0031 e src/data/radar.supabase.ts). Nada aqui depende de React ou de rede.

export type TipoFonte = 'VIBE' | 'CNO' | 'PNCP' | 'CNPJ_RFB' | 'NEWS' | 'LINKEDIN' | 'PARTNER' | 'MANUAL' | 'WEBSITE' | 'CSV';

export interface Fonte {
  id: string;
  codigo: string; // VIBE, CNO, PNCP...
  nome: string;
  tipo: TipoFonte;
  descricao: string;
  confiabilidade: number; // 0-1, multiplica a confianca dos sinais
  ativo: boolean;
  criadoEm: string;
}

export type ClassePrioridade = 'A+' | 'A' | 'B' | 'C' | 'D';

export interface Empresa {
  id: string;
  cnpj?: string; // somente digitos
  razaoSocial: string;
  nomeFantasia?: string;
  dominio?: string; // normalizado, sem www
  site?: string;
  linkedin?: string;
  setor?: string;
  cnae?: string;
  cidade?: string;
  uf?: string;
  pais: string;
  faixaFuncionarios?: string; // ex.: 51-200
  faixaReceita?: string;
  capitalSocial?: number;
  numeroUnidades?: number;
  fonteId?: string;
  fonteExternaId?: string;
  observacoes: string;
  ativo: boolean;
  mescladaEm?: string; // id da empresa que absorveu esta (duplicata resolvida)
  criadoEm: string;
  atualizadoEm: string;
  // cache de leitura (recalculado por recalcularEmpresa)
  fitScore: number;
  intentScore: number;
  timingScore: number;
  relationshipScore: number;
  dataQualityScore: number;
  priorityScore: number;
  priorityClass: ClassePrioridade;
  ultimoSinalEm?: string;
  ultimoContatoEm?: string;
  proximaAcaoEm?: string;
}

export type PoderDecisao = 'Baixo' | 'Médio' | 'Alto';

export interface Contato {
  id: string;
  empresaId: string;
  nome: string;
  cargo?: string;
  departamento?: string;
  senioridade?: string; // Analista, Coordenador, Gerente, Diretor, C-level, Sócio
  email?: string;
  telefone?: string;
  celular?: string;
  whatsapp?: string;
  linkedin?: string;
  decisor: boolean;
  poderDecisao?: PoderDecisao;
  qualidade: number; // 0-100
  fonteId?: string;
  verificadoEm?: string;
  observacoes: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface Projeto {
  id: string;
  empresaId: string;
  nome: string;
  tipo?: string; // galpão, fábrica, CD, escritório, retrofit...
  cidade?: string;
  uf?: string;
  endereco?: string;
  areaM2?: number;
  valorEstimado?: number;
  estagio?: string; // Estudo, Projeto, Licenciamento, Licitação, Obra, Concluído
  inicioPrevisto?: string;
  fonteId?: string;
  fonteExternaId?: string;
  observacoes: string;
  criadoEm: string;
  atualizadoEm: string;
}

export const TIPOS_SINAL = ['CNO_NEW', 'CNO_EXPANSION', 'WAREHOUSE', 'NEW_FACTORY', 'NEW_DC', 'NEW_OFFICE', 'LAND_PURCHASE', 'EXPANSION', 'INVESTMENT', 'FUNDING', 'HIRING_ENGINEERING', 'HIRING_OPERATIONS', 'PUBLIC_TENDER', 'PUBLIC_PLAN', 'PROJECT_IDENTIFIED', 'PARTNER_REFERRAL', 'WEBSITE_CHANGE', 'NEWS', 'MANUAL'] as const;
export type TipoSinal = (typeof TIPOS_SINAL)[number];

export interface Sinal {
  id: string;
  empresaId: string;
  projetoId?: string;
  fonteId: string;
  fonteTipo: TipoFonte;
  tipo: TipoSinal;
  titulo: string;
  descricao: string;
  eventoEm: string; // quando aconteceu
  detectadoEm: string; // quando o sistema soube
  confianca: number; // 0-1
  url?: string;
  externoId?: string;
  payload?: unknown; // bruto da fonte (nunca descartado)
  scoreBase: number;
  scoreEfetivo: number; // base x confianca (o decaimento e aplicado no calculo do score)
  verificado: boolean;
  verificadoPor?: string;
  criadoEm: string;
}

export const ESTAGIOS = ['DETECTED', 'RESEARCHING', 'QUALIFIED', 'DECISION_MAKER_FOUND', 'CONTACT_STARTED', 'ENGAGED', 'NEED_CONFIRMED', 'PROJECT_RECEIVED', 'ENGINEERING', 'PRICING', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST', 'NURTURE'] as const;
export type Estagio = (typeof ESTAGIOS)[number];
export const ESTAGIOS_FECHADOS: Estagio[] = ['WON', 'LOST'];
export const estagioAtivo = (e: Estagio) => !ESTAGIOS_FECHADOS.includes(e) && e !== 'NURTURE';

export interface Oportunidade {
  id: string;
  empresaId: string;
  projetoId?: string;
  titulo: string;
  estagio: Estagio;
  valorEstimado?: number;
  probabilidade: number; // 0-1 (padrao pelo estagio)
  previsaoFechamento?: string;
  responsavelId: string;
  estrategiaId?: string;
  proximaAcao?: string;
  proximaAcaoEm?: string;
  motivoFechamento?: string;
  observacoes: string;
  criadoEm: string;
  atualizadoEm: string;
  fechadoEm?: string;
}

export interface HistoricoEstagio {
  id: string;
  oportunidadeId: string;
  de?: Estagio;
  para: Estagio;
  usuarioId: string;
  motivo?: string;
  em: string;
}

export const CANAIS = ['PHONE', 'WHATSAPP', 'EMAIL', 'LINKEDIN', 'VISIT', 'REFERRAL', 'OTHER'] as const;
export type Canal = (typeof CANAIS)[number];
export const TIPOS_ATIVIDADE = ['CALL', 'MESSAGE', 'EMAIL', 'MEETING', 'VISIT', 'PRESENTATION', 'PROPOSAL', 'NOTE', 'OTHER'] as const;
export type TipoAtividade = (typeof TIPOS_ATIVIDADE)[number];

export const CODIGOS_RESPOSTA = ['NO_RESPONSE', 'INVALID_CONTACT', 'GATEKEEPER', 'REFERRED_TO_OTHER_PERSON', 'DECISION_MAKER_REACHED', 'NOT_INTERESTED', 'NO_PROJECT', 'FUTURE_PROJECT', 'ACTIVE_PROJECT', 'REQUESTED_PRESENTATION', 'REQUESTED_MEETING', 'REQUESTED_BUDGET', 'REQUESTED_TECHNICAL_ANALYSIS', 'ALREADY_HAS_SUPPLIER', 'COMPETITOR_SELECTED', 'PRICE_OBJECTION', 'TIME_OBJECTION', 'TECHNICAL_OBJECTION', 'PAYMENT_OBJECTION', 'CALL_BACK', 'POSITIVE', 'NEGATIVE'] as const;
export type CodigoResposta = (typeof CODIGOS_RESPOSTA)[number];

export interface TipoResposta {
  codigo: CodigoResposta;
  nome: string;
  sentimento: 'positivo' | 'neutro' | 'negativo';
  ativo: boolean;
}

export interface Atividade {
  id: string;
  empresaId: string;
  contatoId?: string;
  projetoId?: string;
  oportunidadeId?: string;
  usuarioId: string;
  tipo: TipoAtividade;
  canal: Canal;
  estrategiaId?: string;
  ocorreuEm: string;
  resultado?: CodigoResposta;
  notas: string;
  conteudoBruto?: string;
  criadoEm: string;
}

export const TIPOS_TAREFA = ['CALL', 'FOLLOW_UP', 'EMAIL', 'MEETING', 'RESEARCH', 'PROPOSAL', 'VISIT', 'OTHER'] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];

export interface TarefaRadar {
  id: string;
  empresaId: string;
  contatoId?: string;
  oportunidadeId?: string;
  responsavelId: string;
  tipo: TipoTarefa;
  prioridade: 'Alta' | 'Normal' | 'Baixa';
  venceEm: string;
  status: 'Aberta' | 'Concluída' | 'Cancelada';
  descricao: string;
  criadoEm: string;
  concluidaEm?: string;
}

export interface Estrategia {
  id: string;
  codigo: string; // TECHNICAL_AUDIT...
  nome: string;
  descricao: string;
  mensagemModelo: string; // editavel na tela; nunca fixa no codigo
  ativo: boolean;
  ordem: number;
}

export interface Experimento {
  id: string;
  nome: string;
  hipotese: string;
  estrategiaId?: string;
  canal?: Canal;
  inicioEm: string;
  fimEm?: string;
  status: 'Planejado' | 'Em andamento' | 'Concluído';
  resultado: string;
  criadoEm: string;
}

export const DIMENSOES = ['FIT', 'TIMING', 'INTENT', 'RELATIONSHIP', 'DATA_QUALITY'] as const;
export type Dimensao = (typeof DIMENSOES)[number];

/** Condicao avaliada pelo motor de score (src/core/radar/score.ts). Serializada em JSON na tabela. */
export type CondicaoRegra =
  | { tipo: 'sinal'; tipoSinal: TipoSinal; confiancaMinima?: number; somenteVerificado?: boolean }
  | { tipo: 'campo'; campo: keyof Empresa; op: 'eq' | 'in' | 'contem' | 'gte' | 'lte' | 'existe' | 'prefixo'; valor?: string | number | string[] }
  | { tipo: 'contato'; decisor?: boolean; comEmail?: boolean; comTelefone?: boolean; verificado?: boolean }
  | { tipo: 'resposta'; codigos: CodigoResposta[] }
  | { tipo: 'atividade'; tipos: TipoAtividade[] }
  | { tipo: 'projeto'; estagios?: string[]; valorMinimo?: number; inicioEmMeses?: number }
  | { tipo: 'completude'; campos: (keyof Empresa)[] };

export interface RegraScore {
  id: string;
  nome: string;
  dimensao: Dimensao;
  tipoSinal?: TipoSinal;
  condicao: CondicaoRegra;
  peso: number; // pontos (pode ser negativo)
  decaimento: boolean;
  decaimentoDias?: number;
  ativo: boolean;
  prioridade: number; // ordem de avaliacao/exibicao
}

/** Parametros do score: pesos por dimensao (peso.FIT...) e cortes de classe (classe.A+...). */
export interface ConfigScore { chave: string; valor: number }

export interface FatorScore { regraId: string; regra: string; pontos: number; base: number; fator: number; motivo: string }
export interface ExplicacaoScore {
  total: number;
  classe: ClassePrioridade;
  dimensoes: { dimensao: Dimensao; score: number; peso: number; fatores: FatorScore[] }[];
  calculadoEm: string;
}

export interface SnapshotScore {
  id: string;
  empresaId: string;
  em: string;
  fit: number;
  timing: number;
  intent: number;
  relationship: number;
  dataQuality: number;
  total: number;
  classe: ClassePrioridade;
  explicacao: ExplicacaoScore;
}

export type StatusImportacao = 'Processando' | 'Concluída' | 'Com erros' | 'Falhou';

export interface ImportacaoJob {
  id: string;
  fonteId: string;
  tipo: 'empresas' | 'contatos';
  arquivo: string;
  status: StatusImportacao;
  total: number;
  importados: number;
  atualizados: number;
  duplicados: number; // possiveis duplicatas sinalizadas
  erros: number;
  criadoPor: string;
  criadoEm: string;
  concluidoEm?: string;
}

export interface ImportacaoLinha {
  id: string;
  jobId: string;
  numero: number;
  dados: Record<string, string>;
  status: 'importada' | 'atualizada' | 'duplicata_possivel' | 'erro' | 'ignorada';
  entidadeId?: string;
  mensagem?: string;
}

export interface ImportacaoErro {
  id: string;
  jobId: string;
  numero: number;
  campo?: string;
  mensagem: string;
}

export interface PossivelDuplicata {
  id: string;
  empresaId: string; // a nova
  candidataId: string; // a existente parecida
  confianca: number; // 0-1
  motivo: string;
  status: 'pendente' | 'mesclada' | 'descartada';
  criadoEm: string;
  resolvidoEm?: string;
  resolvidoPor?: string;
}

export type TipoSupressao = 'do_not_contact' | 'email_bounced' | 'invalid_phone' | 'opt_out';
export interface Supressao {
  id: string;
  contatoId?: string;
  empresaId?: string;
  tipo: TipoSupressao;
  motivo: string;
  criadoPor: string;
  criadoEm: string;
}

/** Registro bruto recebido de uma fonte externa (linhagem e reprocessamento). */
export interface RegistroFonte {
  id: string;
  fonteId: string;
  tipo: 'empresa' | 'contato' | 'projeto' | 'sinal';
  externoId?: string;
  payload: unknown;
  entidadeId?: string;
  recebidoEm: string;
}

export interface RadarDataset {
  fontes: Fonte[];
  empresas: Empresa[];
  contatos: Contato[];
  projetos: Projeto[];
  sinais: Sinal[];
  oportunidades: Oportunidade[];
  historicoEstagios: HistoricoEstagio[];
  atividades: Atividade[];
  tarefas: TarefaRadar[];
  tiposResposta: TipoResposta[];
  estrategias: Estrategia[];
  experimentos: Experimento[];
  regrasScore: RegraScore[];
  configScore: ConfigScore[];
  snapshotsScore: SnapshotScore[];
  importacoes: ImportacaoJob[];
  importacaoLinhas: ImportacaoLinha[];
  importacaoErros: ImportacaoErro[];
  duplicatas: PossivelDuplicata[];
  supressoes: Supressao[];
  registrosFonte: RegistroFonte[];
}

export const radarVazio = (): RadarDataset => ({ fontes: [], empresas: [], contatos: [], projetos: [], sinais: [], oportunidades: [], historicoEstagios: [], atividades: [], tarefas: [], tiposResposta: [], estrategias: [], experimentos: [], regrasScore: [], configScore: [], snapshotsScore: [], importacoes: [], importacaoLinhas: [], importacaoErros: [], duplicatas: [], supressoes: [], registrosFonte: [] });

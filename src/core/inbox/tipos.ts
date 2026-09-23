// EIFF Inbox: modelo de dominio da central de comunicacao, atendimento e decisao.
//
// Este modulo e PURO: sem React, sem fetch, sem Supabase, sem IA. A THREAD e a unidade central de trabalho —
// mensagens, contato, contexto, classificacao, setor, responsavel, acoes, aprovacoes e jobs pendem dela, e a
// thread sobrevive a qualquer transferencia de setor ou responsavel (o historico fica em `ThreadEvent` e
// `Atribuicao`). Persistencia: a migration 0056 (0056_inbox.sql) espelha estes tipos.
//
// Fronteiras que este modelo respeita (docs/eiff-inbox.md):
// - canal e provider: a thread nunca conhece WhatsApp; conhece `CanalInbox` e uma `IdentidadeCanal`.
//   `CommunicationContext` e `CodigoProvider` vem da EIFF Central (src/core/radar/canais.ts), nao sao redefinidos;
// - permissao: a matriz unica do EIFF Control (`inbox`, `inbox_config` em src/core/permissoes.ts). A visibilidade
//   por setor e recorte DENTRO da permissao (e no RLS da 0056), nunca uma segunda ACL;
// - inteligencia: a classificacao guarda so justificativas operacionais, sinais e evidencias — nunca chain-of-thought;
// - execucao: `InboxJob` fala com uma fronteira (`ExecutionProvider`), nunca com a Factory diretamente;
// - privacidade: conteudo operacional (mensagem) x metadados tecnicos (`meta`) x dados pessoais (identidades, sempre
//   mascaradas em saida) x evidencias (jobs) x auditoria (ids e estados, nunca corpo).
import type { CodigoProvider, CommunicationContext } from '../radar/canais';

// ---------------------------------------------------------------------------
// 1) Setores, equipes e membros (dados configuraveis, nao uniao de tipos: setor novo nao muda estrutura)
// ---------------------------------------------------------------------------
export interface Setor {
  codigo: string; // ex.: FINANCEIRO, OBRAS — estavel, chave de negocio (inbox_sector.code)
  nome: string;
  ativo: boolean;
  /** Responsavel padrao do setor (id de usuario): recebe o que o roteamento manda sem responsavel explicito. */
  responsavelPadraoId?: string;
  ordem: number;
}
/** Equipe dentro de um setor (ex.: Financeiro › Contas a pagar). Refina roteamento e visibilidade; o setor continua sendo a unidade. */
export interface Equipe {
  id: string;
  setorCodigo: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  responsavelPadraoId?: string;
}
export const PAPEIS_SETOR = ['atendente', 'gestor'] as const;
export type PapelNoSetor = (typeof PAPEIS_SETOR)[number];
/** Pertencimento de um usuario do EIFF Control a um setor (e, opcionalmente, a uma equipe dele). Varios por usuario. */
export interface MembroSetor {
  id: string;
  usuarioId: string;
  setorCodigo: string;
  equipeId?: string;
  papel: PapelNoSetor;
}

// ---------------------------------------------------------------------------
// 2) Canal, identidade de canal e contato
// ---------------------------------------------------------------------------
export const CANAIS_INBOX = ['WHATSAPP', 'EMAIL', 'PORTAL', 'WEBCHAT', 'SISTEMA'] as const;
export type CanalInbox = (typeof CANAIS_INBOX)[number];

/**
 * Como um contato se apresenta num canal. O identificador de WhatsApp e o telefone em E.164 sem "+" e NUNCA aparece
 * inteiro em tela ou log (ver `identificadorMascarado`). O nome informado pelo canal e apelido, nao identidade.
 * Uma pessoa tem N identidades (WhatsApp, e-mail, portal...); a identidade e unica por (canal, identificador).
 */
export interface IdentidadeCanal {
  canal: CanalInbox;
  identificador: string; // telefone E.164 (WHATSAPP), e-mail minusculo (EMAIL), id de sessao (WEBCHAT/PORTAL), id de usuario (SISTEMA)
  nomeInformado?: string;
  verificada: boolean;
}
/** Normaliza o identificador do canal antes de comparar ou persistir. */
export function normalizarIdentificador(canal: CanalInbox, bruto: string): string {
  const v = (bruto ?? '').trim();
  if (canal === 'WHATSAPP') return v.replace(/\D/g, '');
  if (canal === 'EMAIL') return v.toLowerCase();
  return v;
}

export const TIPOS_RELACAO = ['cliente', 'fornecedor', 'parceiro', 'prestador', 'lead', 'equipe_externa', 'colaborador', 'desconhecido'] as const;
export type TipoRelacao = (typeof TIPOS_RELACAO)[number];

/**
 * Pessoa do outro lado. Ponte para os cadastros que ja existem — nada aqui duplica o Radar ou a equipe:
 * `contatoRadarId`/`empresaRadarId` apontam para src/core/radar, `colaboradorId`/`usuarioId` para o EIFF Control.
 */
export interface ContatoInbox {
  id: string;
  nome: string;
  empresaNome?: string;
  tipoRelacao: TipoRelacao;
  identidades: IdentidadeCanal[];
  contatoRadarId?: string;
  empresaRadarId?: string;
  colaboradorId?: string;
  usuarioId?: string;
  /** Obras em que este contato costuma aparecer (codigos): contexto, nao regra. */
  obras: string[];
  observacoes?: string;
  criadoEm: string;
}

// ---------------------------------------------------------------------------
// 3) Thread (unidade central), mensagem, atribuicao e evento
// ---------------------------------------------------------------------------
export const STATUS_THREAD = ['NOVA', 'TRIADA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA'] as const;
export type StatusThread = (typeof STATUS_THREAD)[number];

export const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** Nivel de atendimento da politica IA + humano: A = IA responde; B = IA prepara, humano aprova; C = humano obrigatorio. */
export const NIVEIS_ATENDIMENTO = ['A', 'B', 'C'] as const;
export type NivelAtendimento = (typeof NIVEIS_ATENDIMENTO)[number];

export interface SlaThread {
  primeiraRespostaAte: string;
  primeiraRespostaEm?: string;
  resolucaoAte?: string;
}

export interface InboxThread {
  id: string;
  canal: CanalInbox;
  provider: CodigoProvider;
  /** Contexto herdado da EIFF Central: INTERNAL (colaboradores) x EXTERNAL (clientes, fornecedores, parceiros). */
  contexto: CommunicationContext;
  contatoId: string;
  /** Referencia LOGICA da conversa na EIFF Central (`central_conversation`), quando o canal passar por la. */
  conversaCentralId?: string;
  externalConversationId?: string;
  assunto: string;
  status: StatusThread;
  prioridade: Prioridade;
  nivel: NivelAtendimento;
  setorCodigo?: string;
  equipeId?: string;
  responsavelId?: string;
  /** Usuarios internos que participaram (responsaveis atuais e passados, quem anotou, respondeu ou transferiu). */
  participantes: string[];
  codigoObra?: string;
  labels: string[];
  classificacao?: Classificacao;
  resumo?: string;
  sla?: SlaThread;
  abertaEm: string;
  ultimaMensagemEm: string;
  ultimaInboundEm?: string;
  resolvidaEm?: string;
  fechadaEm?: string;
  resolvidaPor?: 'ia' | 'humano';
  /** Por onde a conversa nasceu (provider/fonte). */
  origem: string;
}

export const DIRECOES_MENSAGEM = ['inbound', 'outbound', 'interna'] as const;
export type DirecaoMensagem = (typeof DIRECOES_MENSAGEM)[number];
export const TIPOS_MENSAGEM = ['texto', 'imagem', 'documento', 'audio', 'nota'] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];
export const TIPOS_AUTOR = ['contato', 'usuario', 'ia', 'sistema'] as const;
export type TipoAutor = (typeof TIPOS_AUTOR)[number];
/** Situacao da ENTREGA de uma saida. `registrada` = rascunho registrado no Inbox, nada foi enviado (fase atual). */
export const ENTREGAS = ['registrada', 'enviada', 'entregue', 'lida', 'falhou'] as const;
export type Entrega = (typeof ENTREGAS)[number];

export interface AnexoInbox { nome: string; tipo: string; tamanhoBytes?: number; referencia?: string }
/** Metadados TECNICOS seguros (ids do provider, tipo original, janela). Nunca segredo, cabecalho ou payload bruto (CHECK no banco). */
export type MetaMensagem = Record<string, string | number | boolean | null>;

export interface InboxMessage {
  id: string;
  threadId: string;
  provider: CodigoProvider;
  direcao: DirecaoMensagem;
  tipo: TipoMensagem;
  autor: { tipo: TipoAutor; id?: string; nome: string };
  /** Conteudo OPERACIONAL (texto como chegou ou como foi registrado). Nunca vai para audit_log. */
  texto: string;
  anexos: AnexoInbox[];
  em: string;
  /** Chave de deduplicacao quando a mensagem vem de um provider (a Meta reenvia ate receber 200). */
  externalMessageId?: string;
  replyToExternalId?: string;
  /** Referencia LOGICA a `central_message` (0050). */
  mensagemCentralId?: string;
  entrega?: Entrega;
  /** Acao (proposta da IA) que originou esta saida, quando houver. */
  propostaId?: string;
  meta?: MetaMensagem;
}

export const ORIGENS_ATRIBUICAO = ['roteamento', 'triagem', 'manual', 'escalacao', 'sistema'] as const;
export type OrigemAtribuicao = (typeof ORIGENS_ATRIBUICAO)[number];
/** Historico de onde/com quem a thread esteve. A atribuicao vigente e a que nao tem `liberadaEm`. */
export interface Atribuicao {
  id: string;
  threadId: string;
  setorCodigo?: string;
  equipeId?: string;
  usuarioId?: string;
  atribuidaEm: string;
  liberadaEm?: string;
  motivo?: string;
  origem: OrigemAtribuicao;
  atorId?: string;
}

export const TIPOS_EVENTO_THREAD = [
  'THREAD_CREATED', 'THREAD_REOPENED', 'MESSAGE_RECEIVED', 'MESSAGE_REGISTERED', 'NOTE_ADDED', 'AI_ANALYZED', 'TRIAGED', 'ROUTED',
  'ASSIGNED', 'REASSIGNED', 'RELEASED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'LABELS_CHANGED', 'SLA_ESCALATED',
  'ACTION_PROPOSED', 'ACTION_APPROVED', 'ACTION_REJECTED', 'ACTION_EXECUTED', 'JOB_CREATED', 'JOB_COMPLETED', 'JOB_FAILED',
  'RESOLVED', 'CLOSED',
] as const;
export type TipoEventoThread = (typeof TIPOS_EVENTO_THREAD)[number];

/** Historico append-only da thread: curto, sem corpo de mensagem, sem telefone inteiro. E o que a auditoria le. */
export interface ThreadEvent {
  id: string;
  threadId: string;
  mensagemId?: string;
  tipo: TipoEventoThread;
  em: string;
  ator: { tipo: TipoAutor; id?: string; nome: string };
  detalhe: string;
  antes?: string;
  depois?: string;
}

// ---------------------------------------------------------------------------
// 4) Classificacao (saida da fronteira de inteligencia)
// ---------------------------------------------------------------------------
export const TIPOS_ENTIDADE = ['nota_fiscal', 'obra', 'valor', 'data', 'documento', 'pessoa', 'empresa', 'pedido', 'medicao', 'outro'] as const;
export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];
export interface EntidadeExtraida { tipo: TipoEntidade; valor: string; mensagemId?: string }

export const PROVEDORES_INTELIGENCIA = ['SEED', 'HUMANO', 'LLM'] as const;
export type CodigoProvedorInteligencia = (typeof PROVEDORES_INTELIGENCIA)[number];

/**
 * O que a inteligencia devolve sobre uma thread. Guarda so o necessario para auditoria: sinais, o motivo operacional
 * e trechos de evidencia. Nunca raciocinio passo a passo. `provedor: 'HUMANO'` = triagem manual.
 */
export interface Classificacao {
  intencao: string; // ex.: consultar_pagamento, logistica_entrega, solicitar_orcamento
  assunto: string;
  entidades: EntidadeExtraida[];
  setorRecomendado?: string;
  equipeRecomendadaId?: string;
  responsavelRecomendadoId?: string;
  prioridadeRecomendada: Prioridade;
  nivelRecomendado: NivelAtendimento;
  acaoSugerida?: string;
  /** 0-1 */
  confianca: number;
  /** Sinais objetivos que sustentam a leitura (ex.: "menciona NF", "contato e fornecedor da obra"). */
  sinais: string[];
  /** Uma frase operacional: por que este setor/prioridade. Nao e raciocinio encadeado. */
  motivoOperacional?: string;
  evidencias: { mensagemId: string; trecho: string }[];
  provedor: CodigoProvedorInteligencia;
  versao: string;
  modelo?: string;
  em: string;
}

// ---------------------------------------------------------------------------
// 5) Acao (com aprovacao embutida), job, resultado e evidencia (conversa -> acao -> job)
// ---------------------------------------------------------------------------
export const TIPOS_ACAO = ['responder', 'encaminhar', 'criar_tarefa', 'consultar_sistema', 'registrar_previsao', 'criar_job'] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
/**
 * `proposta` = sugestao (da IA ou de regra) ainda nao decidida por pessoa; `aguardando_aprovacao` = proposta humana que
 * exige alcada; `aprovada` = pronta para executar; `executada`/`falhou` = resultado; `rejeitada` = descartada.
 */
export const ESTADOS_ACAO = ['proposta', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 'executada', 'falhou'] as const;
export type EstadoAcao = (typeof ESTADOS_ACAO)[number];

/** Aprovacao humana de uma acao. Vive DENTRO da acao (nao e tabela propria): uma acao tem no maximo uma decisao. */
export interface AprovacaoAcao {
  exigida: boolean;
  papelDecisor?: string;
  decisao?: 'aprovada' | 'rejeitada';
  decididaPor?: string;
  decididaEm?: string;
  motivo?: string;
}

export interface InboxAction {
  id: string;
  threadId: string;
  tipo: TipoAcao;
  titulo: string;
  /** Para `responder` proposta pela IA, e o texto sugerido. */
  descricao: string;
  parametros: Record<string, string | number | boolean | undefined>;
  estado: EstadoAcao;
  aprovacao: AprovacaoAcao;
  propostaPor: { tipo: TipoAutor; id?: string; nome: string };
  criadaEm: string;
  executadaEm?: string;
  jobId?: string;
  /** Referencia criada no EIFF Control quando a acao executa (id de tarefa, mensagem registrada, etc.). */
  referencia?: string;
}

export const PROVEDORES_EXECUCAO = ['MANUAL', 'FACTORY'] as const;
export type CodigoProvedorExecucao = (typeof PROVEDORES_EXECUCAO)[number];
export const ESTADOS_JOB = ['RASCUNHO', 'ENVIADO', 'EM_EXECUCAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO'] as const;
export type EstadoJob = (typeof ESTADOS_JOB)[number];

export const TIPOS_EVIDENCIA = ['link', 'arquivo', 'texto', 'commit', 'pr', 'check'] as const;
export type TipoEvidencia = (typeof TIPOS_EVIDENCIA)[number];
export interface Evidence { tipo: TipoEvidencia; referencia: string; descricao: string }

export interface JobResult {
  ok: boolean;
  resumo: string;
  evidencias: Evidence[];
  concluidoEm: string;
}

/**
 * Trabalho que sai da conversa e vai para uma fronteira de execucao. Os campos espelham, sem acoplar, o que o
 * JOB_CONTRACT da EIFF Dev Factory pede (objetivo, contexto, criterios de aceite).
 */
export interface InboxJob {
  id: string;
  threadId: string;
  acaoId: string;
  titulo: string;
  objetivo: string;
  contexto: string[];
  criteriosAceite: string[];
  provider: CodigoProvedorExecucao;
  estado: EstadoJob;
  /** Identificador no executor (ex.: taskId da fabrica). Preenchido pelo provider, nunca inventado. */
  referenciaExterna?: string;
  resultado?: JobResult;
  criadoEm: string;
  criadoPor: string;
}

// ---------------------------------------------------------------------------
// 6) Politica de atendimento e regras de roteamento (configuraveis, persistidas em inbox_config)
// ---------------------------------------------------------------------------
export interface RegraNivel {
  id: string;
  ordem: number;
  intencoes?: string[];
  setores?: string[];
  tiposRelacao?: TipoRelacao[];
  nivel: NivelAtendimento;
  motivo: string;
  ativa: boolean;
}
export interface RegraRoteamento {
  id: string;
  ordem: number;
  condicao: { intencoes?: string[]; tiposRelacao?: TipoRelacao[]; palavras?: string[]; contexto?: CommunicationContext };
  destino: { setorCodigo: string; equipeId?: string; responsavelId?: string; prioridade?: Prioridade };
  motivo: string;
  ativa: boolean;
}
export interface ConfiguracaoInbox {
  setorFallback: string;
  setorEscalacao: string;
  slaHorasPorPrioridade: Record<Prioridade, number>;
  nivelPadrao: NivelAtendimento;
  regrasNivel: RegraNivel[];
  regrasRoteamento: RegraRoteamento[];
}

// ---------------------------------------------------------------------------
// 7) Slice do dataset
// ---------------------------------------------------------------------------
export interface InboxDataset {
  setores: Setor[];
  equipes: Equipe[];
  membros: MembroSetor[];
  contatos: ContatoInbox[];
  threads: InboxThread[];
  mensagens: InboxMessage[];
  eventos: ThreadEvent[];
  atribuicoes: Atribuicao[];
  acoes: InboxAction[];
  jobs: InboxJob[];
  configuracao: ConfiguracaoInbox;
  /** De onde vieram os dados: `seed` = exemplo ficticio (modo local), `remoto` = banco, `vazio` = nada carregado. */
  origem: 'seed' | 'remoto' | 'vazio';
}

export const SETORES_PADRAO: Setor[] = [
  { codigo: 'COMERCIAL', nome: 'Comercial', ativo: true, ordem: 1 },
  { codigo: 'ENGENHARIA', nome: 'Engenharia', ativo: true, ordem: 2 },
  { codigo: 'OBRAS', nome: 'Obras / Operações', ativo: true, ordem: 3 },
  { codigo: 'COMPRAS', nome: 'Compras', ativo: true, ordem: 4 },
  { codigo: 'FINANCEIRO', nome: 'Financeiro', ativo: true, ordem: 5 },
  { codigo: 'JURIDICO', nome: 'Jurídico', ativo: true, ordem: 6 },
  { codigo: 'POS_VENDA', nome: 'Pós-venda', ativo: true, ordem: 7 },
  { codigo: 'ADMINISTRATIVO', nome: 'Administrativo', ativo: true, ordem: 8 },
  { codigo: 'FORNECEDORES', nome: 'Fornecedores', ativo: true, ordem: 9 },
  { codigo: 'DIRETORIA', nome: 'Diretoria', ativo: true, ordem: 10 },
  { codigo: 'SISTEMA', nome: 'Sistema', ativo: true, ordem: 11 },
  { codigo: 'FACTORY', nome: 'Factory', ativo: true, ordem: 12 },
];

export const NIVEL_PADRAO: NivelAtendimento = 'B';

export const CONFIGURACAO_PADRAO: ConfiguracaoInbox = {
  setorFallback: 'ADMINISTRATIVO',
  setorEscalacao: 'DIRETORIA',
  slaHorasPorPrioridade: { Urgente: 1, Alta: 4, Normal: 24, Baixa: 72 },
  nivelPadrao: NIVEL_PADRAO,
  regrasNivel: [
    { id: 'NIV-01', ordem: 1, intencoes: ['juridico', 'conflito', 'alteracao_contratual', 'excecao_financeira', 'risco_operacional'], nivel: 'C', motivo: 'tema sensível: humano obrigatório', ativa: true },
    { id: 'NIV-02', ordem: 2, intencoes: ['consultar_horario', 'consultar_endereco', 'solicitar_documento', 'confirmar_recebimento', 'consultar_status'], nivel: 'A', motivo: 'pergunta padronizada: a IA pode responder', ativa: true },
    { id: 'NIV-03', ordem: 3, intencoes: ['consultar_pagamento', 'negociacao', 'solicitar_orcamento', 'prazo_obra', 'reclamacao'], nivel: 'B', motivo: 'resposta com compromisso: IA prepara, humano aprova', ativa: true },
  ],
  regrasRoteamento: [
    { id: 'ROT-01', ordem: 1, condicao: { intencoes: ['juridico', 'alteracao_contratual'] }, destino: { setorCodigo: 'JURIDICO', prioridade: 'Alta' }, motivo: 'tema jurídico', ativa: true },
    { id: 'ROT-02', ordem: 2, condicao: { intencoes: ['consultar_pagamento', 'excecao_financeira', 'cobranca'] }, destino: { setorCodigo: 'FINANCEIRO' }, motivo: 'pagamento e cobrança', ativa: true },
    { id: 'ROT-03', ordem: 3, condicao: { intencoes: ['logistica_entrega', 'prazo_obra', 'risco_operacional', 'apontamento_campo'] }, destino: { setorCodigo: 'OBRAS' }, motivo: 'operação da obra', ativa: true },
    { id: 'ROT-04', ordem: 4, condicao: { intencoes: ['cotacao', 'pedido_compra', 'entrega_fornecedor'] }, destino: { setorCodigo: 'COMPRAS' }, motivo: 'suprimentos', ativa: true },
    { id: 'ROT-05', ordem: 5, condicao: { intencoes: ['solicitar_orcamento', 'negociacao', 'lead'] }, destino: { setorCodigo: 'COMERCIAL' }, motivo: 'oportunidade comercial', ativa: true },
    { id: 'ROT-06', ordem: 6, condicao: { intencoes: ['revisao_projeto', 'duvida_tecnica'] }, destino: { setorCodigo: 'ENGENHARIA' }, motivo: 'projeto e engenharia', ativa: true },
    { id: 'ROT-07', ordem: 7, condicao: { intencoes: ['reclamacao', 'garantia', 'assistencia'] }, destino: { setorCodigo: 'POS_VENDA', prioridade: 'Alta' }, motivo: 'pós-venda', ativa: true },
    { id: 'ROT-08', ordem: 8, condicao: { tiposRelacao: ['fornecedor'] }, destino: { setorCodigo: 'FORNECEDORES' }, motivo: 'contato de fornecedor sem intenção específica', ativa: true },
  ],
};

export const inboxVazio = (): InboxDataset => ({
  setores: [], equipes: [], membros: [], contatos: [], threads: [], mensagens: [], eventos: [], atribuicoes: [], acoes: [], jobs: [],
  configuracao: CONFIGURACAO_PADRAO, origem: 'vazio',
});

/** Identificador de canal seguro para tela e log: telefone e e-mail nunca inteiros. */
export function identificadorMascarado(i: IdentidadeCanal): string {
  const v = i.identificador;
  if (i.canal === 'WHATSAPP') return v.length > 6 ? `${v.slice(0, 4)}${'*'.repeat(v.length - 6)}${v.slice(-2)}` : '***';
  if (i.canal === 'EMAIL') { const [u, d] = v.split('@'); return d ? `${u.slice(0, 2)}***@${d}` : '***'; }
  return v;
}

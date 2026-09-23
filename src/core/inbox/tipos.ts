// EIFF Inbox: modelo de dominio da central de comunicacao, atendimento e decisao.
//
// Este modulo e PURO: sem React, sem fetch, sem Supabase, sem IA. A THREAD e a unidade central de trabalho —
// mensagens, contato, contexto, classificacao, setor, responsavel, acoes, aprovacoes e jobs pendem dela, e a
// thread sobrevive a qualquer transferencia de setor ou responsavel (o historico fica em `ThreadEvent`).
//
// Fronteiras que este modelo respeita (docs/eiff-inbox.md):
// - canal e provider: a thread nunca conhece WhatsApp; conhece `CanalInbox` e uma `IdentidadeCanal`.
//   `CommunicationContext` e `CodigoProvider` vem da EIFF Central (src/core/radar/canais.ts), nao sao redefinidos;
// - permissao: a matriz unica do EIFF Control (`inbox`, `inbox_config` em src/core/permissoes.ts). A visibilidade
//   por setor e recorte DENTRO da permissao, nunca uma segunda ACL;
// - inteligencia: a classificacao guarda so justificativas operacionais, sinais e evidencias — nunca chain-of-thought;
// - execucao: `InboxJob` fala com uma fronteira (`ExecutionProvider`), nunca com a Factory diretamente.
import type { CodigoProvider, CommunicationContext } from '../radar/canais';

// ---------------------------------------------------------------------------
// 1) Setores e equipes (dados configuraveis, nao uniao de tipos: setor novo nao muda estrutura)
// ---------------------------------------------------------------------------
export interface Setor {
  codigo: string; // ex.: FINANCEIRO, OBRAS — estavel, usado como chave
  nome: string;
  ativo: boolean;
  /** Responsavel padrao do setor (id de usuario): recebe o que o roteamento manda sem responsavel explicito. */
  responsavelPadraoId?: string;
  /** Ordem no menu de caixas. */
  ordem: number;
}

export const PAPEIS_SETOR = ['atendente', 'gestor'] as const;
export type PapelNoSetor = (typeof PAPEIS_SETOR)[number];
/** Pertencimento de um usuario do EIFF Control a um setor do Inbox. O mesmo usuario pode estar em varios setores. */
export interface MembroSetor {
  usuarioId: string;
  setorCodigo: string;
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
 */
export interface IdentidadeCanal {
  canal: CanalInbox;
  identificador: string; // telefone E.164 (WHATSAPP), e-mail (EMAIL), id de sessao (WEBCHAT/PORTAL), id de usuario (SISTEMA)
  nomeInformado?: string;
  verificada: boolean;
}

export const TIPOS_RELACAO = ['cliente', 'fornecedor', 'parceiro', 'prestador', 'lead', 'equipe_externa', 'colaborador', 'desconhecido'] as const;
export type TipoRelacao = (typeof TIPOS_RELACAO)[number];

/**
 * Pessoa do outro lado. E a ponte para os cadastros que ja existem — nada aqui duplica o Radar ou a equipe:
 * `contatoRadarId`/`empresaRadarId` apontam para src/core/radar, `colaboradorId`/`usuarioId` para o EIFF Control.
 * Todos opcionais: o Inbox precisa funcionar com contato ainda nao identificado.
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
// 3) Thread (unidade central), mensagem e evento
// ---------------------------------------------------------------------------
export const STATUS_THREAD = ['NOVA', 'TRIADA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'AGUARDANDO_CONTATO', 'AGUARDANDO_INTERNO', 'AGUARDANDO_APROVACAO', 'RESOLVIDA', 'FECHADA'] as const;
export type StatusThread = (typeof STATUS_THREAD)[number];

export const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** Nivel de atendimento da politica IA + humano: A = IA responde; B = IA prepara, humano aprova; C = humano obrigatorio. */
export const NIVEIS_ATENDIMENTO = ['A', 'B', 'C'] as const;
export type NivelAtendimento = (typeof NIVEIS_ATENDIMENTO)[number];

export interface SlaThread {
  /** Prazo para a primeira resposta da EIFF (ISO). */
  primeiraRespostaAte: string;
  primeiraRespostaEm?: string;
  /** Prazo para resolver (ISO), quando a politica define. */
  resolucaoAte?: string;
}

export interface InboxThread {
  id: string;
  canal: CanalInbox;
  provider: CodigoProvider;
  /** Contexto herdado da EIFF Central: INTERNAL (colaboradores) x EXTERNAL (clientes, fornecedores, parceiros). */
  contexto: CommunicationContext;
  contatoId: string;
  /** Referencia da conversa na EIFF Central (`central_conversation`), quando o canal passar por la. */
  conversaCentralId?: string;
  externalConversationId?: string;
  assunto: string;
  status: StatusThread;
  prioridade: Prioridade;
  nivel: NivelAtendimento;
  setorCodigo?: string;
  responsavelId?: string;
  /** Usuarios internos que participaram (responsaveis atuais e passados, quem anotou ou respondeu). */
  participantes: string[];
  codigoObra?: string;
  labels: string[];
  classificacao?: Classificacao;
  resumoIa?: string;
  sla?: SlaThread;
  abertaEm: string;
  ultimaMensagemEm: string;
  ultimaInboundEm?: string;
  resolvidaEm?: string;
  fechadaEm?: string;
  /** Quem resolveu: `ia` so quando a thread foi inteira tratada no nivel A; caso contrario, humano. */
  resolvidaPor?: 'ia' | 'humano';
}

export const DIRECOES_MENSAGEM = ['inbound', 'outbound', 'interna'] as const;
export type DirecaoMensagem = (typeof DIRECOES_MENSAGEM)[number];
export const TIPOS_MENSAGEM = ['texto', 'imagem', 'documento', 'audio', 'nota'] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];
export const TIPOS_AUTOR = ['contato', 'usuario', 'ia', 'sistema'] as const;
export type TipoAutor = (typeof TIPOS_AUTOR)[number];
/** Situacao da ENTREGA de uma mensagem de saida. `registrada` = ficou no Inbox, nada foi enviado (fase atual). */
export const ENTREGAS = ['registrada', 'enviada', 'entregue', 'lida', 'falhou'] as const;
export type Entrega = (typeof ENTREGAS)[number];

export interface AnexoInbox { nome: string; tipo: string; tamanhoBytes?: number; referencia?: string }

export interface InboxMessage {
  id: string;
  threadId: string;
  direcao: DirecaoMensagem;
  tipo: TipoMensagem;
  autor: { tipo: TipoAutor; id?: string; nome: string };
  texto: string;
  anexos: AnexoInbox[];
  em: string;
  /** Chave de deduplicacao quando a mensagem vem de um provider (a Meta reenvia ate receber 200). */
  externalMessageId?: string;
  entrega?: Entrega;
  /** Mensagem de saida que nasceu de uma sugestao da IA e foi aprovada por um humano. */
  sugestaoId?: string;
}

export const TIPOS_EVENTO_THREAD = ['ABERTA', 'MENSAGEM', 'CLASSIFICADA', 'ROTEADA', 'ATRIBUIDA', 'TRANSFERIDA', 'STATUS', 'NOTA', 'SUGESTAO', 'ACAO', 'APROVACAO', 'JOB', 'SLA', 'LABEL'] as const;
export type TipoEventoThread = (typeof TIPOS_EVENTO_THREAD)[number];

/** Historico append-only da thread: sobrevive a transferencias e e o que a auditoria le. */
export interface ThreadEvent {
  id: string;
  threadId: string;
  tipo: TipoEventoThread;
  em: string;
  ator: { tipo: TipoAutor; id?: string; nome: string };
  detalhe: string;
  antes?: string;
  depois?: string;
}

// ---------------------------------------------------------------------------
// 4) Classificacao (saida da fronteira de inteligencia) e sugestao
// ---------------------------------------------------------------------------
export const TIPOS_ENTIDADE = ['nota_fiscal', 'obra', 'valor', 'data', 'documento', 'pessoa', 'empresa', 'pedido', 'medicao', 'outro'] as const;
export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];
export interface EntidadeExtraida { tipo: TipoEntidade; valor: string; mensagemId?: string }

export const PROVEDORES_INTELIGENCIA = ['SEED', 'HUMANO', 'LLM'] as const;
export type CodigoProvedorInteligencia = (typeof PROVEDORES_INTELIGENCIA)[number];

/**
 * O que a inteligencia devolve sobre uma thread. Guarda so o necessario para auditoria: sinais, justificativas
 * operacionais e trechos de evidencia. Nunca raciocinio passo a passo. `provedor: 'HUMANO'` = triagem manual.
 */
export interface Classificacao {
  intencao: string; // ex.: consultar_pagamento, logistica_entrega, solicitar_orcamento
  assunto: string;
  entidades: EntidadeExtraida[];
  setorRecomendado?: string;
  responsavelRecomendadoId?: string;
  prioridadeRecomendada: Prioridade;
  nivelRecomendado: NivelAtendimento;
  acaoSugerida?: string;
  /** 0-1 */
  confianca: number;
  /** Sinais objetivos que sustentam a leitura (ex.: "menciona NF", "contato e fornecedor da obra"). */
  sinais: string[];
  evidencias: { mensagemId: string; trecho: string }[];
  provedor: CodigoProvedorInteligencia;
  versao: string;
  em: string;
}

export const TIPOS_SUGESTAO = ['resposta', 'acao', 'encaminhamento'] as const;
export type TipoSugestao = (typeof TIPOS_SUGESTAO)[number];
export const ESTADOS_SUGESTAO = ['pendente', 'aceita', 'descartada'] as const;
export type EstadoSugestao = (typeof ESTADOS_SUGESTAO)[number];
/** Proposta da IA (ou de uma regra) para o humano decidir. Nivel A pode aplicar sozinho; B e C exigem pessoa. */
export interface Sugestao {
  id: string;
  threadId: string;
  tipo: TipoSugestao;
  texto: string;
  estado: EstadoSugestao;
  provedor: CodigoProvedorInteligencia;
  criadaEm: string;
  decididaPor?: string;
  decididaEm?: string;
}

// ---------------------------------------------------------------------------
// 5) Acao, aprovacao, job, resultado e evidencia (conversa -> acao -> job)
// ---------------------------------------------------------------------------
export const TIPOS_ACAO = ['responder', 'encaminhar', 'criar_tarefa', 'consultar_sistema', 'registrar_previsao', 'criar_job'] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
export const ESTADOS_ACAO = ['proposta', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 'executada', 'falhou'] as const;
export type EstadoAcao = (typeof ESTADOS_ACAO)[number];

/** Aprovacao humana de uma acao. Vive DENTRO da acao (nao e tabela propria): uma acao tem no maximo uma decisao. */
export interface AprovacaoAcao {
  exigida: boolean;
  /** Papel do EIFF Control que decide (ex.: Financeiro, Diretoria). */
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
  descricao: string;
  parametros: Record<string, string | number | boolean | undefined>;
  estado: EstadoAcao;
  aprovacao: AprovacaoAcao;
  /** Origem da proposta: humano, IA ou regra. */
  propostaPor: { tipo: TipoAutor; id?: string; nome: string };
  criadaEm: string;
  executadaEm?: string;
  jobId?: string;
  /** Referencia criada no EIFF Control quando a acao executa (id de tarefa, lancamento, etc.). */
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
 * JOB_CONTRACT da EIFF Dev Factory pede (objetivo, contexto, criterios de aceite): quando o FactoryProvider
 * existir, ele traduz este contrato para a issue da fabrica — o Inbox nao precisa mudar.
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
// 6) Politica de atendimento e regras de roteamento (configuraveis)
// ---------------------------------------------------------------------------
/** Regra da politica IA + humano: a primeira que casar define o nivel. Sem regra, vale `NIVEL_PADRAO`. */
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

/** Regra de roteamento: condicao -> destino. A primeira que casar vence; sem regra, vale o fallback da configuracao. */
export interface RegraRoteamento {
  id: string;
  ordem: number;
  condicao: { intencoes?: string[]; tiposRelacao?: TipoRelacao[]; palavras?: string[]; contexto?: CommunicationContext };
  destino: { setorCodigo: string; responsavelId?: string; prioridade?: Prioridade };
  motivo: string;
  ativa: boolean;
}

export interface ConfiguracaoInbox {
  /** Setor que recebe o que nenhuma regra roteou. */
  setorFallback: string;
  /** Setor para onde escala quando o SLA vence sem resposta. */
  setorEscalacao: string;
  /** Horas para a primeira resposta, por prioridade. */
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
  membros: MembroSetor[];
  contatos: ContatoInbox[];
  threads: InboxThread[];
  mensagens: InboxMessage[];
  eventos: ThreadEvent[];
  sugestoes: Sugestao[];
  acoes: InboxAction[];
  jobs: InboxJob[];
  configuracao: ConfiguracaoInbox;
  /** De onde vieram os dados: `seed` = exemplo, `remoto` = banco, `vazio` = nada carregado. */
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
  setores: SETORES_PADRAO, membros: [], contatos: [], threads: [], mensagens: [], eventos: [], sugestoes: [], acoes: [], jobs: [],
  configuracao: CONFIGURACAO_PADRAO, origem: 'vazio',
});

/** Identificador de canal seguro para tela e log: telefone e e-mail nunca inteiros. */
export function identificadorMascarado(i: IdentidadeCanal): string {
  const v = i.identificador;
  if (i.canal === 'WHATSAPP') return v.length > 6 ? `${v.slice(0, 4)}${'*'.repeat(v.length - 6)}${v.slice(-2)}` : '***';
  if (i.canal === 'EMAIL') { const [u, d] = v.split('@'); return d ? `${u.slice(0, 2)}***@${d}` : '***'; }
  return v;
}

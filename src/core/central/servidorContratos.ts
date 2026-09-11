// EIFF Central — Wave 03 F2: CONTRATOS CONGELADOS entre o webhook (F2-WEBHOOK) e o acesso a dados (F2-DATA).
//
// Este arquivo e do Architect. Aqui vivem so tipos, constantes e assinaturas: nenhuma implementacao, nenhum cliente,
// nenhuma variavel de ambiente. Quem implementa:
//   - src/data/datasetServidor.ts        (F2-DATA)    -> `CarregarDatasetServidor`
//   - src/core/central/persistenciaCentral.ts (F2-DATA) -> `PortasPersistenciaCentral`
//   - src/core/central/contextoServidor.ts (F2-WEBHOOK) -> `resolverContextoCentral`-like sobre `VariaveisCentralServidor`
//   - src/core/central/webhookCentral.ts (F2-WEBHOOK)   -> orquestracao pura sobre as portas
//   - netlify/functions/channel-meta-webhook.ts (F2-WEBHOOK) -> cria o cliente service_role e injeta as portas
//
// Invariantes da Wave 03 que estes contratos materializam:
//   1/2) phone_number_id desconhecido e organizacao ausente => fail-closed (ContextoCentralServidor.pronto = false);
//   3)   toda carga de Dataset server-side recebe organizationId obrigatorio;
//   4)   service_role so existe dentro dos adapters: fluxoInterno, CFO, engine e agentes recebem DADOS, nunca cliente;
//   5)   Dataset server-side e SELECT-only sobre ALLOWLIST_DATASET;
//   6)   assinatura e idempotencia antes de qualquer negocio (o webhook so chama as portas depois de tratarWebhookMeta);
//   7/8) sent e can_execute sao literalmente `false` no tipo e CHECK no banco (0052);
//   9)   nenhuma mutacao financeira: TABELAS_ESCRITA_CENTRAL e a lista fechada do unico escritor.
import type { Dataset } from '../types';
import type { CommunicationContext } from '../radar/canais';
import type { EstadoCentral, ResultadoAplicacao } from './conversa';
import type { NumerosCentral } from './metaEventos';
import type { InternalIntent, WhatsappIdentity } from './tipos';
import type { SituacaoAtendimento } from './fluxoInterno';

// ---------------------------------------------------------------------------
// 0) Versao do caminho e textos fixos
// ---------------------------------------------------------------------------
/** Versao declarada do caminho continuo. Sobe quando a interpretacao/resposta muda de forma relevante para reprocessar. */
export const FLOW_VERSION = 'central-alpha-1';
/** Versao da normalizacao do texto persistido (limparTexto). Sobe se a normalizacao mudar. */
export const NORMALIZATION_VERSION = 1;
/** Aviso obrigatorio de toda tela/resposta de reprocessamento (D2). Texto EXATO. */
export const TEXTO_REPROCESSADO = 'Parecer reprocessado — nenhuma mensagem foi enviada ao WhatsApp.';

// ---------------------------------------------------------------------------
// 1) Contexto do servidor (F2-WEBHOOK: contextoServidor.ts)
// ---------------------------------------------------------------------------
export const MODOS_ALPHA = ['off', 'on'] as const;
export type ModoAlpha = (typeof MODOS_ALPHA)[number];

/** Variaveis que a funcao Netlify LE do ambiente e entrega como DADOS (nenhum arquivo de src/ le o ambiente diretamente). */
export interface VariaveisCentralServidor {
  CENTRAL_ALPHA_MODE?: string;               // 'off' (padrao) | 'on'
  EIFF_CENTRAL_PHONE_NUMBER_ID?: string;     // numero INTERNAL
  EIFF_COMMERCIAL_PHONE_NUMBER_ID?: string;  // numero EXTERNAL
  EIFF_CENTRAL_ORGANIZATION_ID?: string;     // organizacao dona dos numeros (uuid); ausente => fail-closed
  CENTRAL_ALPHA_NUMBERS?: string;            // allowlist E.164 sem "+", separada por virgula (D4)
  COMMIT_REF?: string;                       // SHA do deploy (Netlify), quando existir em runtime
}

export type MotivoContextoFechado = 'modo_off' | 'organizacao_ausente' | 'organizacao_invalida' | 'numeros_ausentes' | 'allowlist_vazia';

/** Resultado da leitura das variaveis. `pronto=false` significa: o webhook se comporta EXATAMENTE como hoje (conta e descarta). */
export interface ContextoCentralServidor {
  modo: ModoAlpha;
  pronto: boolean;
  motivo?: MotivoContextoFechado;
  organizationId?: string;
  numeros: NumerosCentral;
  /** Telefones (E.164 sem "+") autorizados no Alpha. Fora da lista: contado e descartado, sem persistencia (D4). */
  numerosPermitidos: ReadonlySet<string>;
  engineSha?: string;
  flowVersion: string;
}

// ---------------------------------------------------------------------------
// 2) Dataset server-side (F2-DATA: src/data/datasetServidor.ts)
// ---------------------------------------------------------------------------
/**
 * Allowlist explicita. `raiz: true` => a consulta leva `.eq('organization_id', organizationId)` obrigatoriamente.
 * `pai` => tabela filha SEM organization_id, consultada SOMENTE por `in(coluna, ids dos pais ja filtrados)`.
 * Tabelas fora desta lista entram VAZIAS no Dataset (mapeamento inalterado: montarDataset recebe []).
 * A lista e INICIAL: o teste de paridade do CFO (responderDF igual com o seed completo e com o seed reduzido a esta
 * lista, para os dois lados) e quem decide se falta tabela — cada inclusao vem com a justificativa no commit.
 */
export interface EntradaAllowlist {
  tabela: string;
  /** raiz: filtra pela organizacao na PROPRIA linha (coluna `colunaOrganizacao`, padrao organization_id) */
  raiz: boolean;
  colunaOrganizacao?: string;
  pai?: { tabela: string; coluna: string };
}
export const ALLOWLIST_DATASET: readonly EntradaAllowlist[] = [
  { tabela: 'organization', raiz: true, colunaOrganizacao: 'id' }, // a propria organizacao: id = organizationId
  { tabela: 'company', raiz: true },
  { tabela: 'profile', raiz: true },
  { tabela: 'user_scope', raiz: false, pai: { tabela: 'profile', coluna: 'profile_id' } },
  { tabela: 'parameter_set', raiz: true },
  { tabela: 'scenario_factor', raiz: false, pai: { tabela: 'parameter_set', coluna: 'parameter_set_id' } },
  { tabela: 'chart_account', raiz: true },
  { tabela: 'bank_account', raiz: true },
  { tabela: 'project', raiz: true },
  { tabela: 'financial_entry', raiz: true },
  { tabela: 'settlement', raiz: false, pai: { tabela: 'financial_entry', coluna: 'entry_id' } },
  { tabela: 'bank_transaction', raiz: true },
  { tabela: 'reconciliation', raiz: false, pai: { tabela: 'bank_transaction', coluna: 'bank_transaction_id' } },
  { tabela: 'debt', raiz: true },
  { tabela: 'approval_request', raiz: true },
  { tabela: 'approval_step', raiz: false, pai: { tabela: 'approval_request', coluna: 'request_id' } },
  { tabela: 'period_close', raiz: true },
  { tabela: 'project_service', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
  { tabela: 'measurement', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
  { tabela: 'demand', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
  { tabela: 'demand_completion', raiz: false, pai: { tabela: 'demand', coluna: 'demand_id' } },
  { tabela: 'production_order', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
  { tabela: 'production_stage', raiz: false, pai: { tabela: 'production_order', coluna: 'order_id' } },
  { tabela: 'purchase_order', raiz: true },
  { tabela: 'purchase_order_item', raiz: false, pai: { tabela: 'purchase_order', coluna: 'order_id' } },
  { tabela: 'assembly', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
  { tabela: 'service_progress', raiz: false, pai: { tabela: 'project', coluna: 'project_id' } },
];
/** Fatias que NUNCA entram no Dataset do servidor nesta wave (PII, volume ou irrelevancia para o parecer). */
export const FORA_DO_DATASET_SERVIDOR = ['audit_log', 'comment', 'task', 'worker', 'timesheet', 'timesheet_line', 'timesheet_output', 'timesheet_incident', 'station_log', 'shipment', 'stock_item', 'stock_movement', 'catalog_input', 'catalog_composition', 'catalog_composition_item', 'estimate', 'estimate_item', 'training_progress', 'field_photo', 'job_function', 'worker_allocation'] as const;

/** Carga SELECT-only. Recebe um leitor ja construido (o cliente service_role vive na funcao Netlify e nunca sai dela). */
export type CarregarDatasetServidor = (organizationId: string) => Promise<Dataset>;
/**
 * Fabricas FIXAS (a funcao Netlify importa exatamente estes nomes destes caminhos; ate a F2-DATA entregar, existem
 * como stubs que lancam ErroCentralServidor('nao_implementado', 'deterministico')):
 *   src/data/datasetServidor.ts            -> export function criarCarregadorDataset(cliente: SupabaseClient): CarregarDatasetServidor
 *   src/core/central/persistenciaCentral.ts -> export function criarPersistenciaCentral(cliente: SupabaseClient): PortasPersistenciaCentral
 */

// ---------------------------------------------------------------------------
// 3) Persistencia da Central (F2-DATA: persistenciaCentral.ts) — o UNICO escritor da F2
// ---------------------------------------------------------------------------
export const TABELAS_ESCRITA_CENTRAL = ['central_conversation', 'central_message', 'central_event', 'central_message_content', 'central_message_processing'] as const;
export type TabelaEscritaCentral = (typeof TABELAS_ESCRITA_CENTRAL)[number];

/** Estado previo carregado do banco para a chave (organizacao, contexto, telefones) e os ids externos do lote. */
export interface EstadoPersistido {
  /** Conversas/mensagens/eventos JA no banco, no modelo do core, com `id` = uuid do banco. */
  estado: EstadoCentral;
  /**
   * Mensagens inbound ja persistidas (por externalMessageId) SEM processamento WEBHOOK CONCLUIDO: crash entre persistir
   * e processar. `aplicarEventos` as veria como duplicadas; o orquestrador as reprocessa (o texto vem do reenvio da Meta).
   */
  pendentesDeProcessamento: string[];
  /** externalMessageId -> quantidade de linhas WEBHOOK com status ERRO. Alimenta o teto de retries transitorios. */
  errosPorMensagem: ReadonlyMap<string, number>;
}
/** Acima disto, falha transitoria repetida deixa de pedir retry a Meta (200 + codigo `tentativas_esgotadas`); a F2R reprocessa. */
export const LIMITE_TENTATIVAS_TRANSITORIAS = 3;

export interface LotePersistencia {
  organizationId: string;
  aplicado: ResultadoAplicacao;
  /** externalMessageId -> texto NORMALIZADO (limparTexto). So mensagens inbound de texto; nunca payload bruto. */
  textos: ReadonlyMap<string, string>;
  /** id da conversa (modelo do core) -> identidade VERIFIED resolvida para ela; ausente = conversa sem identidade valida. */
  identidadePorConversa: ReadonlyMap<string, string>;
  agoraIso: string;
}

export interface MapaIds {
  /** id do core (conv-xxxx ou uuid) -> uuid do banco */
  conversas: ReadonlyMap<string, string>;
  /** id do core (msg-xxxx ou uuid) -> uuid do banco */
  mensagens: ReadonlyMap<string, string>;
}

export interface ResultadoPersistencia {
  ids: MapaIds;
  /** externalMessageIds com conteudo persistido nesta chamada (insert efetivo; conflito = ja existia, nada sobrescrito). */
  conteudosNovos: string[];
}

export type OrigemProcessamento = 'WEBHOOK' | 'REPROCESSAMENTO';
export type StatusProcessamento = 'CONCLUIDO' | 'ERRO';

/** Uma linha de central_message_processing. Espelha a 0052 coluna a coluna; nada de jsonb. */
export interface RegistroProcessamento {
  organizationId: string;
  conversaId: string;   // uuid do banco
  mensagemId: string;   // uuid do banco
  identidadeId?: string; // SO a identidade vinculada a conversa, VERIFIED; senao ausente
  origem: OrigemProcessamento;
  atorId?: string;       // obrigatorio em REPROCESSAMENTO, proibido em WEBHOOK
  engineSha?: string;
  flowVersion: string;
  inputSha256?: string;  // = body_sha256 do conteudo; ausente so em sem_texto/ERRO sem conteudo
  outputSha256?: string; // sha256 de resposta.texto; obrigatorio em CONCLUIDO
  intent?: InternalIntent;
  situacao?: SituacaoAtendimento;
  status: StatusProcessamento;
  errorCode?: string;    // obrigatorio em ERRO; nunca contem texto, telefone ou stack
  canExecute: false;
  sent: false;
  durationMs: number;
  processedAt: string;
}

export interface PortasPersistenciaCentral {
  carregarEstado(organizationId: string, contexto: CommunicationContext, telefones: string[], externalMessageIds: string[]): Promise<EstadoPersistido>;
  carregarIdentidades(organizationId: string, contexto: CommunicationContext, telefones: string[]): Promise<WhatsappIdentity[]>;
  /** Idempotente por construcao: conversa por chave (upsert), mensagem/evento/conteudo `on conflict do nothing`. Nunca sobrescreve conteudo. */
  persistirLote(lote: LotePersistencia): Promise<ResultadoPersistencia>;
  /** Append-only. Conflito no indice parcial (segundo CONCLUIDO de webhook) devolve `{ jaConcluido: true }`, nunca erro. */
  registrarProcessamento(registro: RegistroProcessamento): Promise<{ id?: string; jaConcluido: boolean }>;
}

// ---------------------------------------------------------------------------
// 4) Erros: deterministicos (nunca retry) x transitorios (5xx => a Meta reenvia)
// ---------------------------------------------------------------------------
export type ClasseErro = 'deterministico' | 'transitorio';
export class ErroCentralServidor extends Error {
  constructor(readonly codigo: string, readonly classe: ClasseErro, mensagem?: string) {
    super(mensagem ?? codigo);
    this.name = 'ErroCentralServidor';
  }
}
/** Resposta HTTP do webhook por classe: transitorio => 503 (a Meta reenvia); deterministico => 200 (nada a repetir). */
export const HTTP_POR_CLASSE: Record<ClasseErro, number> = { deterministico: 200, transitorio: 503 };

// ---------------------------------------------------------------------------
// 5) Resultado da orquestracao do webhook (F2-WEBHOOK: webhookCentral.ts) — para log e teste; sem conteudo
// ---------------------------------------------------------------------------
export interface ResumoWebhookCentral {
  modo: ModoAlpha;
  status: number;
  /** eventos recebidos no lote (todos), descartados por allowlist/contexto, persistidos e processados */
  eventos: number;
  descartados: number;
  persistidos: number;
  processados: number;
  concluidos: number;
  erros: number;
  /** codigos de erro (sem texto, sem telefone) */
  codigos: string[];
}

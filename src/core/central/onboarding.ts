// EIFF Central — onboarding de identidade do WhatsApp (Wave 03, frente F3).
//
// Peca SERVER-SIDE e PURA: nenhuma rede propria, nenhuma variavel de ambiente, nenhuma escrita direta. Tudo passa
// pelas portas injetadas (`PortasIdentidade`), que a funcao Netlify (netlify/functions/central-identidade.ts)
// implementa sobre as RPCs server-only da migration 0049 (`whatsapp_identity_request` / `_verify` / `_transition`)
// e um SELECT em `whatsapp_identity`. O adapter PostgREST vive na funcao, nao aqui: nenhum modulo de
// src/core/central escreve no banco (guarda da ameaca 8 em seguranca.test.ts).
//
// Invariantes da Wave 03 que este modulo materializa (o teste onboarding.test.ts prende cada uma):
//  11. codigo de onboarding e EXPIRANTE (`VALIDADE_CODIGO_MINUTOS`), SINGLE-USE (a RPC zera o desafio ao verificar
//      e recusa fora de PENDING), LIMITADO em tentativas (teto fixado no banco, `MAX_TENTATIVAS_CODIGO` so aperta)
//      e VINCULADO a (organizacao, contexto, telefone);
//  12. nova solicitacao INVALIDA os codigos anteriores da mesma chave: todo PENDING de (organizacao, contexto,
//      telefone) e REVOGADO (via `whatsapp_identity_transition`) ANTES de `whatsapp_identity_request` criar o novo.
//      A RPC sozinha nao faz isso: para a MESMA pessoa ela renova o desafio na mesma linha, e para OUTRA pessoa
//      ela insere uma segunda linha PENDING deixando a antiga viva — por isso a revogacao e explicita aqui.
//
// Mais regras duras: o codigo em claro existe SO na resposta unica de `solicitarIdentidade` (nunca em log, motivo,
// listagem ou erro); o telefone sai sempre MASCARADO (`mascararTelefone`); papel e organizacao vem do perfil do
// banco (JWT -> profile), nunca do cliente; contexto desta wave: so INTERNAL.
//
// Autoridade: `PAPEIS_VER_CENTRAL` espelha a linha `ver_central` da MATRIZ de src/data/store.ts (o teste confere
// papel a papel com `pode`). O espelho existe pelo mesmo motivo de `PAPEIS_MISSION_CONTROL` no githubAdapter: a
// funcao Netlify nao pode carregar store.ts (React, seed.json, cliente Supabase com import.meta.env).
import { mascararTelefone, type CommunicationContext } from '../radar/canais';
import type { Papel } from '../types';
import {
  MAX_TENTATIVAS_CODIGO, TAMANHO_CODIGO, VALIDADE_CODIGO_MINUTOS, abrirDesafioVerificacao, codigoParaVerificacao,
  desafioPersistivel, fonteAleatoriaPadrao, telefoneCentral, type FonteAleatoria,
} from './identidade';
import type { SituacaoIdentidade, WhatsappIdentity } from './tipos';

// ------------------------------------------------------------------------------------------ constantes

/** papeis com `ver_central` — espelha a MATRIZ do store (teste confere com `pode`) */
export const PAPEIS_VER_CENTRAL = ['Administrador', 'Diretoria', 'Financeiro'] as const satisfies readonly Papel[];
export const temVerCentral = (papel: string | undefined): papel is Papel => (PAPEIS_VER_CENTRAL as readonly string[]).includes(papel ?? '');
/** contextos aceitos NESTA wave: o numero externo (EIFF Comercial) ainda nao vincula ninguem */
export const CONTEXTOS_ONBOARDING = ['INTERNAL'] as const;
export type ContextoOnboarding = (typeof CONTEXTOS_ONBOARDING)[number];
/** motivo gravado na revogacao automatica da invariante 12 (sem telefone, sem codigo) */
export const MOTIVO_REVOGACAO_RENOVACAO = 'nova solicitação de verificação para este número';
/** limite de caracteres do motivo de revogacao (CHECK da migration 0049) */
export const MAX_MOTIVO = 500;
/**
 * Colunas lidas de `whatsapp_identity`. `verification_code_hash` NAO esta aqui de proposito: nem o hash sai do
 * banco para o servidor. O adapter usa esta lista no `select=`.
 */
export const COLUNAS_IDENTIDADE = [
  'id', 'organization_id', 'profile_id', 'worker_id', 'phone_e164', 'context', 'status',
  'verification_expires_at', 'verification_attempts', 'verified_at', 'revoked_at', 'revoke_reason',
  'requested_by', 'created_at', 'updated_at',
] as const;

// ------------------------------------------------------------------------------------------- portas

/** Linha de `whatsapp_identity` como o SELECT devolve (sem o hash). */
export interface LinhaIdentidade {
  id: string;
  organization_id: string;
  profile_id: string | null;
  worker_id: string | null;
  phone_e164: string;
  context: string;
  status: string;
  verification_expires_at: string | null;
  verification_attempts: number;
  verified_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at?: string;
}

/** Resposta jsonb das RPCs da migration 0049. */
export type RespostaRpc = { ok: true; [k: string]: unknown } | { ok: false; erro: string; [k: string]: unknown };

export interface ArgsRequest { p_user_id: string; p_phone: string; p_context: ContextoOnboarding; p_code_hash: string; p_expires_at: string; p_profile_id: string | null; p_worker_id: string | null }
export interface ArgsVerify { p_user_id: string; p_identity_id: string; p_code_hash: string; p_max_attempts: number }
export interface ArgsTransition { p_user_id: string; p_identity_id: string; p_to_status: 'REVOKED'; p_reason: string }

/**
 * Portas server-side. O adapter real (funcao Netlify) chama as RPCs com a chave service_role SO depois de validar
 * o JWT; os mocks do teste nunca tocam rede. Qualquer excecao das portas e tratada como indisponibilidade.
 */
export interface PortasIdentidade {
  rpcRequest(args: ArgsRequest): Promise<RespostaRpc>;
  rpcVerify(args: ArgsVerify): Promise<RespostaRpc>;
  rpcTransition(args: ArgsTransition): Promise<RespostaRpc>;
  /** SELECT por organizacao (e contexto, quando dado), sem `verification_code_hash` */
  listarIdentidades(organizationId: string, contexto?: CommunicationContext): Promise<LinhaIdentidade[]>;
}

// ------------------------------------------------------------------------------------------ helpers

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const situacaoDe = (v: string): SituacaoIdentidade => (v === 'VERIFIED' || v === 'REVOKED' ? v : 'PENDING');

/** Excecao de porta (rede, RPC fora do ar) nunca sobe: vira estado nomeado. */
async function porta<T>(fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false }> {
  try { return { ok: true, valor: await fn() }; } catch { return { ok: false }; }
}

/** PENDING vivos da chave (organizacao, contexto, telefone), do mais novo ao mais antigo. */
export function pendentesDaChave(linhas: LinhaIdentidade[], chave: { organizationId: string; contexto: string; telefone: string }): LinhaIdentidade[] {
  return linhas
    .filter((l) => l.organization_id === chave.organizationId && l.context === chave.contexto && l.phone_e164 === chave.telefone && l.status === 'PENDING')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

// -------------------------------------------------------------------------------- 1) solicitar vinculo

export type ErroSolicitacao =
  | 'sem_permissao'
  | 'contexto_nao_suportado'
  | 'pessoa_ausente'
  | 'pessoa_dupla'
  | 'pessoa_invalida'
  | 'telefone_invalido'
  | 'falha_ao_revogar_anterior'
  | 'numero_ja_verificado_para_outra_pessoa'
  | 'pessoa_de_outra_organizacao'
  | 'sem_perfil'
  | 'rpc_recusou'
  | 'indisponivel';

export interface PedidoSolicitacao {
  organizationId: string;
  /** perfil de quem pede (do JWT -> profile, nunca do cliente) */
  solicitanteId: string;
  /** papel do perfil do banco */
  papel: string;
  contexto: string;
  telefoneBruto: string;
  profileId?: string;
  workerId?: string;
  agoraIso: string;
  /** origem do pedido, so para telemetria do chamador (nao entra no banco) */
  fonte?: string;
  /** fonte de aleatoriedade injetavel (teste); em producao, o crypto da plataforma */
  aleatorio?: FonteAleatoria;
}

export type ResultadoSolicitacao =
  | {
    ok: true;
    identidadeId: string;
    /** SEGREDO: mostrado UMA vez a quem pediu; nunca volta em listagem, log ou erro */
    codigo: string;
    expiraEm: string;
    telefoneMascarado: string;
    contexto: ContextoOnboarding;
    /** quantos PENDING anteriores da mesma chave foram revogados antes do novo pedido (invariante 12) */
    revogadosAntes: number;
  }
  | { ok: false; erro: ErroSolicitacao; telefoneMascarado?: string };

const ERROS_RPC_REQUEST: Record<string, ErroSolicitacao> = {
  sem_permissao: 'sem_permissao',
  sem_perfil: 'sem_perfil',
  nao_autenticado: 'sem_perfil',
  contexto_invalido: 'contexto_nao_suportado',
  pessoa_de_outra_organizacao: 'pessoa_de_outra_organizacao',
  colaborador_de_outra_organizacao: 'pessoa_de_outra_organizacao',
  numero_ja_verificado_para_outra_pessoa: 'numero_ja_verificado_para_outra_pessoa',
};

/**
 * Pede o vinculo numero -> pessoa: valida papel e pessoa, normaliza o telefone, REVOGA os PENDING anteriores da
 * chave (invariante 12), gera o desafio e chama `whatsapp_identity_request` so com o HASH. O codigo em claro
 * volta aqui, uma unica vez, para quem pediu entrega-lo pessoalmente ao colaborador.
 */
export async function solicitarIdentidade(portas: PortasIdentidade, pedido: PedidoSolicitacao): Promise<ResultadoSolicitacao> {
  if (!temVerCentral(pedido.papel)) return { ok: false, erro: 'sem_permissao' };
  if (!(CONTEXTOS_ONBOARDING as readonly string[]).includes(pedido.contexto)) return { ok: false, erro: 'contexto_nao_suportado' };
  const contexto = pedido.contexto as ContextoOnboarding;
  const profileId = s(pedido.profileId);
  const workerId = s(pedido.workerId);
  if (!profileId && !workerId) return { ok: false, erro: 'pessoa_ausente' };
  if (profileId && workerId) return { ok: false, erro: 'pessoa_dupla' };
  if ((profileId && !ehUuid(profileId)) || (workerId && !ehUuid(workerId))) return { ok: false, erro: 'pessoa_invalida' };
  if (!ehUuid(pedido.solicitanteId) || !ehUuid(pedido.organizationId)) return { ok: false, erro: 'sem_perfil' };
  const tel = telefoneCentral(pedido.telefoneBruto);
  if (!tel.ok || !tel.telefone) return { ok: false, erro: 'telefone_invalido' };
  const telefone = tel.telefone;
  const telefoneMascarado = mascararTelefone(telefone);

  // invariante 12: nenhum codigo anterior da chave sobrevive a um novo pedido — revogar ANTES de criar
  const lista = await porta(() => portas.listarIdentidades(pedido.organizationId, contexto));
  if (!lista.ok) return { ok: false, erro: 'indisponivel', telefoneMascarado };
  const anteriores = pendentesDaChave(lista.valor, { organizationId: pedido.organizationId, contexto, telefone });
  for (const ant of anteriores) {
    const r = await porta(() => portas.rpcTransition({ p_user_id: pedido.solicitanteId, p_identity_id: ant.id, p_to_status: 'REVOKED', p_reason: MOTIVO_REVOGACAO_RENOVACAO }));
    // fail closed: sem a revogacao provada, nenhum codigo novo nasce (o antigo continuaria valendo)
    if (!r.ok || !r.valor.ok) return { ok: false, erro: 'falha_ao_revogar_anterior', telefoneMascarado };
  }

  // desafio: o codigo nasce aqui e so o hash viaja para o banco
  const provisoria: WhatsappIdentity = { id: '', organizationId: pedido.organizationId, usuarioId: profileId, colaboradorId: workerId, telefoneNormalizado: telefone, contexto, situacao: 'PENDING', criadoEm: pedido.agoraIso };
  const desafio = abrirDesafioVerificacao(provisoria, pedido.agoraIso, { fonte: pedido.aleatorio ?? fonteAleatoriaPadrao });
  const persistivel = desafioPersistivel(desafio);
  const r = await porta(() => portas.rpcRequest({
    p_user_id: pedido.solicitanteId, p_phone: telefone, p_context: contexto,
    p_code_hash: persistivel.codeHash, p_expires_at: persistivel.expiraEm,
    p_profile_id: profileId ?? null, p_worker_id: workerId ?? null,
  }));
  if (!r.ok) return { ok: false, erro: 'indisponivel', telefoneMascarado };
  if (!r.valor.ok) return { ok: false, erro: ERROS_RPC_REQUEST[r.valor.erro] ?? 'rpc_recusou', telefoneMascarado };
  const identidadeId = s(r.valor.identity_id);
  if (!identidadeId) return { ok: false, erro: 'rpc_recusou', telefoneMascarado };
  return { ok: true, identidadeId, codigo: desafio.codigo, expiraEm: desafio.expiraEm, telefoneMascarado, contexto, revogadosAntes: anteriores.length };
}

// ------------------------------------------------------------------ 2) conferir codigo recebido (webhook)

/**
 * Extrai UM codigo de `TAMANHO_CODIGO` digitos do texto recebido. O texto e DADO: nada nele e instrucao, so os
 * digitos importam. Grupos de digitos separados apenas por espaco/pontuacao sao lidos juntos ("123 456" e
 * "123-456" valem "123456"); qualquer outro caractere entre grupos os separa. Dois candidatos validos = nenhum.
 */
export function extrairCodigoVerificacao(texto: string | undefined, tamanho = TAMANHO_CODIGO): string | undefined {
  if (!texto) return undefined;
  const candidatos: string[] = [];
  const re = /\d+(?:[\s.,;:\-–_/()]*\d+)*/g;
  for (const m of texto.match(re) ?? []) {
    const digitos = m.replace(/\D+/g, '');
    if (digitos.length === tamanho) candidatos.push(digitos);
  }
  const unicos = [...new Set(candidatos)];
  return unicos.length === 1 && candidatos.length === 1 ? unicos[0] : undefined;
}

export const RESULTADOS_CONFERENCIA = ['verificada', 'codigo_invalido', 'expirado', 'tentativas_excedidas', 'sem_pendente', 'texto_sem_codigo', 'indisponivel'] as const;
export type ResultadoConferencia = (typeof RESULTADOS_CONFERENCIA)[number];

export interface PedidoConferencia {
  organizationId: string;
  contexto: string;
  /** telefone de quem escreveu, ja normalizado pelo webhook (E.164 sem "+"); bruto tambem e aceito */
  telefoneNormalizado: string;
  /** corpo da mensagem recebida — dado, nunca instrucao */
  textoRecebido: string;
  agoraIso: string;
}

export interface SaidaConferencia {
  resultado: ResultadoConferencia;
  telefoneMascarado: string;
  identidadeId?: string;
  /** tentativas gastas ate agora (quando a RPC informa) */
  tentativas?: number;
  /** codigo de erro da RPC quando o resultado e `indisponivel` (nunca contem telefone nem codigo) */
  detalhe?: string;
}

const RESULTADO_RPC_VERIFY: Record<string, ResultadoConferencia> = {
  codigo_nao_confere: 'codigo_invalido',
  codigo_expirado: 'expirado',
  tentativas_excedidas: 'tentativas_excedidas',
  transicao_invalida: 'sem_pendente',
  identidade_nao_encontrada: 'sem_pendente',
  sem_desafio: 'sem_pendente',
};

/**
 * Ponto de ligacao para o webhook (Architect liga; este modulo NAO liga): dado o telefone de quem escreveu, o
 * contexto do numero que recebeu e o texto, localiza o PENDING da chave e chama `whatsapp_identity_verify` com o
 * hash do codigo. A RPC e a unica porta para VERIFIED (atomica, com row lock e teto de tentativas do banco).
 *
 * Ator (`p_user_id`) da RPC: a identidade do proprio usuario usa `profile_id` (a RPC sempre aceita a propria
 * pessoa); identidade de colaborador sem login usa `requested_by`, o perfil que pediu o vinculo — que a RPC de
 * request ja exigiu ser Administrador/Diretoria/Financeiro. Se esse perfil deixou de ter o papel ou foi
 * desativado, a RPC recusa e o resultado e `indisponivel` com o detalhe (ver relatorio da F3).
 */
export async function conferirCodigoRecebido(portas: PortasIdentidade, pedido: PedidoConferencia): Promise<SaidaConferencia> {
  const codigo = extrairCodigoVerificacao(pedido.textoRecebido);
  const tel = telefoneCentral(pedido.telefoneNormalizado);
  const telefoneMascarado = tel.ok && tel.telefone ? mascararTelefone(tel.telefone) : '—';
  if (!codigo) return { resultado: 'texto_sem_codigo', telefoneMascarado };
  if (!tel.ok || !tel.telefone) return { resultado: 'sem_pendente', telefoneMascarado };
  if (!(CONTEXTOS_ONBOARDING as readonly string[]).includes(pedido.contexto)) return { resultado: 'sem_pendente', telefoneMascarado };
  const contexto = pedido.contexto as ContextoOnboarding;

  const lista = await porta(() => portas.listarIdentidades(pedido.organizationId, contexto));
  if (!lista.ok) return { resultado: 'indisponivel', telefoneMascarado, detalhe: 'lista_indisponivel' };
  const [pendente] = pendentesDaChave(lista.valor, { organizationId: pedido.organizationId, contexto, telefone: tel.telefone });
  if (!pendente) return { resultado: 'sem_pendente', telefoneMascarado };
  // expiracao conferida antes de gastar uma chamada (a RPC confere de novo, com o relogio do banco)
  if (!pendente.verification_expires_at || pendente.verification_expires_at < pedido.agoraIso) return { resultado: 'expirado', telefoneMascarado, identidadeId: pendente.id };
  if (pendente.verification_attempts >= MAX_TENTATIVAS_CODIGO) return { resultado: 'tentativas_excedidas', telefoneMascarado, identidadeId: pendente.id, tentativas: pendente.verification_attempts };
  const ator = pendente.profile_id ?? pendente.requested_by;
  if (!ator) return { resultado: 'indisponivel', telefoneMascarado, identidadeId: pendente.id, detalhe: 'sem_ator' };

  const r = await porta(() => portas.rpcVerify({ p_user_id: ator, p_identity_id: pendente.id, p_code_hash: codigoParaVerificacao(codigo), p_max_attempts: MAX_TENTATIVAS_CODIGO }));
  if (!r.ok) return { resultado: 'indisponivel', telefoneMascarado, identidadeId: pendente.id, detalhe: 'rpc_indisponivel' };
  if (r.valor.ok) return { resultado: 'verificada', telefoneMascarado, identidadeId: pendente.id };
  const tentativas = typeof r.valor.tentativas === 'number' ? r.valor.tentativas : undefined;
  const mapeado = RESULTADO_RPC_VERIFY[r.valor.erro];
  return mapeado
    ? { resultado: mapeado, telefoneMascarado, identidadeId: pendente.id, tentativas }
    : { resultado: 'indisponivel', telefoneMascarado, identidadeId: pendente.id, tentativas, detalhe: r.valor.erro };
}

// ------------------------------------------------------------------------------------- 3) revogar

export type ErroRevogacao = 'sem_permissao' | 'motivo_obrigatorio' | 'identidade_nao_encontrada' | 'transicao_invalida' | 'rpc_recusou' | 'indisponivel';
export interface PedidoRevogacao { organizationId: string; atorId: string; papel: string; identidadeId: string; motivo: string }
export type ResultadoRevogacao = { ok: true; identidadeId: string; de: SituacaoIdentidade; telefoneMascarado: string } | { ok: false; erro: ErroRevogacao };

/** Revoga (PENDING ou VERIFIED -> REVOKED) via `whatsapp_identity_transition`. A identidade tem de ser da organizacao do ator. */
export async function revogarIdentidade(portas: PortasIdentidade, pedido: PedidoRevogacao): Promise<ResultadoRevogacao> {
  if (!temVerCentral(pedido.papel)) return { ok: false, erro: 'sem_permissao' };
  const motivo = (pedido.motivo ?? '').trim().slice(0, MAX_MOTIVO);
  if (!motivo) return { ok: false, erro: 'motivo_obrigatorio' };
  if (!ehUuid(pedido.identidadeId) || !ehUuid(pedido.atorId)) return { ok: false, erro: 'identidade_nao_encontrada' };
  const lista = await porta(() => portas.listarIdentidades(pedido.organizationId));
  if (!lista.ok) return { ok: false, erro: 'indisponivel' };
  // organizacao do ator != da identidade: nem chega a RPC (que recusaria de novo)
  const alvo = lista.valor.find((l) => l.id === pedido.identidadeId && l.organization_id === pedido.organizationId);
  if (!alvo) return { ok: false, erro: 'identidade_nao_encontrada' };
  if (alvo.status === 'REVOKED') return { ok: false, erro: 'transicao_invalida' };
  const r = await porta(() => portas.rpcTransition({ p_user_id: pedido.atorId, p_identity_id: pedido.identidadeId, p_to_status: 'REVOKED', p_reason: motivo }));
  if (!r.ok) return { ok: false, erro: 'indisponivel' };
  if (!r.valor.ok) {
    const e = r.valor.erro;
    return { ok: false, erro: e === 'sem_permissao' ? 'sem_permissao' : e === 'transicao_invalida' ? 'transicao_invalida' : e === 'identidade_nao_encontrada' || e === 'identidade_de_outra_organizacao' ? 'identidade_nao_encontrada' : 'rpc_recusou' };
  }
  return { ok: true, identidadeId: pedido.identidadeId, de: situacaoDe(alvo.status), telefoneMascarado: mascararTelefone(alvo.phone_e164) };
}

// ------------------------------------------------------------------------------------ 4) listar

/** Linha para a tela: telefone MASCARADO, sem hash, sem nada que nao esteja aqui. */
export interface IdentidadeTela {
  id: string;
  profileId?: string;
  workerId?: string;
  telefoneMascarado: string;
  contexto: string;
  situacao: SituacaoIdentidade;
  expiraEm?: string;
  tentativas: number;
  verificadoEm?: string;
  revogadoEm?: string;
  motivoRevogacao?: string;
  solicitadoPor?: string;
  criadoEm: string;
}
export interface ListaTela { linhas: IdentidadeTela[]; contagem: Record<SituacaoIdentidade, number> }

/** Projecao explicita: cada campo e escolhido a dedo — nada do banco passa por espalhamento. */
export function linhaParaTela(l: LinhaIdentidade): IdentidadeTela {
  return {
    id: l.id,
    profileId: l.profile_id ?? undefined,
    workerId: l.worker_id ?? undefined,
    telefoneMascarado: mascararTelefone(l.phone_e164),
    contexto: l.context,
    situacao: situacaoDe(l.status),
    expiraEm: l.status === 'PENDING' ? l.verification_expires_at ?? undefined : undefined,
    tentativas: l.verification_attempts ?? 0,
    verificadoEm: l.verified_at ?? undefined,
    revogadoEm: l.revoked_at ?? undefined,
    motivoRevogacao: l.revoke_reason ?? undefined,
    solicitadoPor: l.requested_by ?? undefined,
    criadoEm: l.created_at,
  };
}

export async function listarParaTela(portas: PortasIdentidade, organizationId: string): Promise<ListaTela | { erro: 'indisponivel' }> {
  const lista = await porta(() => portas.listarIdentidades(organizationId));
  if (!lista.ok) return { erro: 'indisponivel' };
  const linhas = lista.valor.filter((l) => l.organization_id === organizationId).map(linhaParaTela)
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));
  const contagem: Record<SituacaoIdentidade, number> = { PENDING: 0, VERIFIED: 0, REVOKED: 0 };
  for (const l of linhas) contagem[l.situacao] += 1;
  return { linhas, contagem };
}

// ------------------------------------------------------------------ 5) contrato publico de /api/central/identidade

export type PedidoIdentidadeApi =
  | { acao: 'listar' }
  | { acao: 'solicitar'; telefone: string; profileId?: string; workerId?: string }
  | { acao: 'revogar'; identidadeId: string; motivo: string };

const CHAVES_PERMITIDAS: Record<PedidoIdentidadeApi['acao'], readonly string[]> = {
  listar: ['acao'],
  solicitar: ['acao', 'telefone', 'profileId', 'workerId'],
  revogar: ['acao', 'identidadeId', 'motivo'],
};

/** Contrato FECHADO: qualquer chave fora da lista da acao e recusada (400). Valores sao conferidos por tipo. */
export function validarPedidoIdentidade(corpo: unknown): { ok: true; pedido: PedidoIdentidadeApi } | { ok: false; detalhe: string } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, detalhe: 'corpo deve ser um objeto' };
  const c = corpo as Record<string, unknown>;
  const acao = c.acao;
  if (acao !== 'listar' && acao !== 'solicitar' && acao !== 'revogar') return { ok: false, detalhe: 'acao desconhecida' };
  const extras = Object.keys(c).filter((k) => !CHAVES_PERMITIDAS[acao].includes(k));
  if (extras.length) return { ok: false, detalhe: `campos nao permitidos: ${extras.join(', ')}` };
  if (acao === 'listar') return { ok: true, pedido: { acao } };
  if (acao === 'solicitar') {
    if (typeof c.telefone !== 'string' || !c.telefone.trim()) return { ok: false, detalhe: 'telefone obrigatorio' };
    if (c.profileId !== undefined && typeof c.profileId !== 'string') return { ok: false, detalhe: 'profileId invalido' };
    if (c.workerId !== undefined && typeof c.workerId !== 'string') return { ok: false, detalhe: 'workerId invalido' };
    return { ok: true, pedido: { acao, telefone: c.telefone, profileId: c.profileId as string | undefined, workerId: c.workerId as string | undefined } };
  }
  if (typeof c.identidadeId !== 'string' || !c.identidadeId) return { ok: false, detalhe: 'identidadeId obrigatorio' };
  if (typeof c.motivo !== 'string') return { ok: false, detalhe: 'motivo obrigatorio' };
  return { ok: true, pedido: { acao, identidadeId: c.identidadeId, motivo: c.motivo } };
}

// ----------------------------------------------------------------------- 6) handler puro do endpoint

export interface EntradaIdentidadeApi {
  metodo: string;
  /** cabecalho Authorization cru (Bearer <jwt do Supabase>) */
  authorization?: string | null;
  /** chave anon enviada pelo navegador quando o servidor nao a tem no ambiente (e publica) */
  anonDoCliente?: string | null;
  /** corpo ja desserializado (a funcao Netlify faz o req.json()); invalido = 400 */
  corpo: unknown;
}

export interface DepsIdentidadeApi {
  /** porta HTTP injetada (no servidor, o fetch global); o modulo nao conhece rede por conta propria */
  http: typeof fetch;
  supabaseUrl: string;
  anon?: string;
  /** SUPABASE_SERVICE_ROLE_KEY: so no Netlify; ausente = 503 configuracao_incompleta. Nunca sai deste modulo. */
  serviceRoleKey?: string;
  /**
   * Fabrica das portas reais (adapter PostgREST da funcao Netlify), chamada SO depois do JWT validado e com a chave
   * de servico ja conferida. O core nunca monta requisicao ao banco por conta propria.
   */
  portas: (serviceRoleKey: string) => PortasIdentidade;
  agora?: () => string;
  /** telemetria minima: acao, outcome, http_status, latency_ms — nunca telefone inteiro, jwt, chave ou codigo */
  log?: (t: Record<string, unknown>) => void;
  /** fonte de aleatoriedade injetavel (teste) */
  aleatorio?: FonteAleatoria;
}

export interface SaidaIdentidadeApi { status: number; corpo: unknown }

type Perfil = { id: string; papel: string; organizationId: string };
const HTTP_AUTH = { nao_autenticado: 401, sem_perfil: 403, sem_permissao: 403 } as const;

/** JWT -> usuario -> perfil REAL do banco (papel, organizacao, ativo) -> ver_central. Nada vem do cliente. */
export async function autenticarCentral(entrada: Pick<EntradaIdentidadeApi, 'authorization' | 'anonDoCliente'>, deps: Pick<DepsIdentidadeApi, 'http' | 'supabaseUrl' | 'anon'>): Promise<{ ok: true; perfil: Perfil } | { ok: false; erro: keyof typeof HTTP_AUTH }> {
  const jwt = (entrada.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const anon = (deps.anon ?? '').trim() || (entrada.anonDoCliente ?? '').trim();
  if (!jwt || !anon) return { ok: false, erro: 'nao_autenticado' };
  const cab = { apikey: anon, authorization: `Bearer ${jwt}` };
  try {
    const user = await deps.http(`${deps.supabaseUrl}/auth/v1/user`, { headers: cab });
    if (!user.ok) return { ok: false, erro: 'nao_autenticado' };
    const u = (await user.json().catch(() => ({}))) as { id?: string };
    if (!ehUuid(u.id)) return { ok: false, erro: 'nao_autenticado' };
    const perfilR = await deps.http(`${deps.supabaseUrl}/rest/v1/profile?id=eq.${encodeURIComponent(u.id)}&select=role,organization_id,active`, { headers: cab });
    const perfil = ((await perfilR.json().catch(() => [])) as { role?: string; organization_id?: string; active?: boolean }[])[0];
    if (!perfilR.ok || !perfil?.role || !ehUuid(perfil.organization_id) || perfil.active === false) return { ok: false, erro: 'sem_perfil' };
    if (!temVerCentral(perfil.role)) return { ok: false, erro: 'sem_permissao' };
    return { ok: true, perfil: { id: u.id, papel: perfil.role, organizationId: perfil.organization_id } };
  } catch {
    return { ok: false, erro: 'nao_autenticado' };
  }
}

const HTTP_SOLICITACAO: Record<ErroSolicitacao, number> = {
  sem_permissao: 403, sem_perfil: 403, contexto_nao_suportado: 400, pessoa_ausente: 400, pessoa_dupla: 400, pessoa_invalida: 400,
  telefone_invalido: 400, pessoa_de_outra_organizacao: 403, numero_ja_verificado_para_outra_pessoa: 409,
  falha_ao_revogar_anterior: 502, rpc_recusou: 502, indisponivel: 502,
};
const HTTP_REVOGACAO: Record<ErroRevogacao, number> = { sem_permissao: 403, motivo_obrigatorio: 400, identidade_nao_encontrada: 404, transicao_invalida: 409, rpc_recusou: 502, indisponivel: 502 };

/**
 * Handler puro de /api/central/identidade: POST -> JWT -> perfil -> ver_central -> service_role presente ->
 * contrato fechado -> caso de uso. O log recebe apenas acao, outcome, http_status e latency_ms.
 */
export async function tratarCentralIdentidade(entrada: EntradaIdentidadeApi, deps: DepsIdentidadeApi): Promise<SaidaIdentidadeApi> {
  const inicio = Date.now();
  const agora = deps.agora ?? (() => new Date().toISOString());
  let acaoLog = 'desconhecida';
  const responder = (status: number, corpo: unknown, outcome: string): SaidaIdentidadeApi => {
    try { deps.log?.({ evento: 'central_identidade', acao: acaoLog, outcome, http_status: status, latency_ms: Date.now() - inicio }); } catch { /* ignore */ }
    return { status, corpo };
  };
  if (entrada.metodo !== 'POST') return responder(405, { erro: 'metodo' }, 'metodo');

  const auth = await autenticarCentral(entrada, deps);
  if (!auth.ok) return responder(HTTP_AUTH[auth.erro], { erro: auth.erro }, auth.erro);

  const service = (deps.serviceRoleKey ?? '').trim();
  if (!service) return responder(503, { erro: 'configuracao_incompleta', mensagem: 'Servidor sem a chave de serviço da Central. Nada foi alterado.' }, 'configuracao_incompleta');

  const v = validarPedidoIdentidade(entrada.corpo);
  if (!v.ok) return responder(400, { erro: 'pedido_invalido', detalhe: v.detalhe }, 'pedido_invalido');
  const pedido = v.pedido;
  acaoLog = pedido.acao;
  const portas = deps.portas(service);
  const { perfil } = auth;

  if (pedido.acao === 'listar') {
    const r = await listarParaTela(portas, perfil.organizationId);
    if ('erro' in r) return responder(502, { erro: r.erro }, r.erro);
    return responder(200, r, 'ok');
  }
  if (pedido.acao === 'solicitar') {
    const r = await solicitarIdentidade(portas, {
      organizationId: perfil.organizationId, solicitanteId: perfil.id, papel: perfil.papel, contexto: 'INTERNAL',
      telefoneBruto: pedido.telefone, profileId: pedido.profileId, workerId: pedido.workerId, agoraIso: agora(), fonte: 'api', aleatorio: deps.aleatorio,
    });
    if (!r.ok) return responder(HTTP_SOLICITACAO[r.erro], { erro: r.erro }, r.erro);
    // unica resposta que leva o codigo: quem pediu o entrega pessoalmente; o log acima nunca ve o corpo
    return responder(200, r, 'ok');
  }
  const r = await revogarIdentidade(portas, { organizationId: perfil.organizationId, atorId: perfil.id, papel: perfil.papel, identidadeId: pedido.identidadeId, motivo: pedido.motivo });
  if (!r.ok) return responder(HTTP_REVOGACAO[r.erro], { erro: r.erro }, r.erro);
  return responder(200, r, 'ok');
}

// reexport util para o chamador (webhook) montar o prazo e a mensagem sem reimplementar
export { TAMANHO_CODIGO, VALIDADE_CODIGO_MINUTOS, MAX_TENTATIVAS_CODIGO };

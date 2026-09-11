// EIFF Central: AUTORIDADE SERVER-SIDE. Quem e a pessoa, o que ela pode e ate onde a Central pode ir.
//
// Por que este modulo existe: o Diretor Financeiro escreve por `actions.registrarPrevisaoDF`, que usa
// `state.usuario` — a sessao do STORE, que e do navegador. Para o fluxo do WhatsApp isso nao pode ser
// autoridade: a pessoa do outro lado nao tem sessao no app, e uma sessao aberta na maquina de outro
// usuario viraria o ator da acao. Entao a autoridade e reconstruida aqui, explicitamente:
//
//   identidade VERIFIED -> usuarioId -> usuario real do Dataset -> organizacao confere -> ativo -> papel
//   -> autorizarAcao(catalogo) -> pode(usuario, permissao, escopo) -> motor -> confirmacao -> execucao
//
// NADA aqui le `state.usuario`, e nada aqui aceita papel, organizacao ou permissao vindos do payload do
// WhatsApp. Tudo entra por parametro explicito, vindo de fonte que o SERVIDOR ja validou.
//
// FRONTEIRA DESTA FASE: calcular e PROPOR funciona; EXECUTAR nao. Enquanto a unica porta de escrita for a
// sessao implicita do store, `portasSemEscrita` recusa a mutacao em vez de improvisar um ator. O Alpha
// interno responde e propoe; nao grava.
import type { Dataset, Usuario } from '../types';
import { pode } from '../../data/store';
import { autorizar, type Autorizacao } from './permissoes';
import { resolverIdentidade, type AcaoProposta, type CodigoAgente, type CommunicationContext, type IdentidadeResolvida, type WhatsappIdentity } from './tipos';
import type { PortasFinanceiro } from './agenteFinanceiro';

// ---------------------------------------------------------------------------
// 1) Execucao: fechada nesta fase
// ---------------------------------------------------------------------------
export const EXECUCAO_BLOQUEADA = 'execucao_sem_porta_servidor';
export const MENSAGEM_EXECUCAO_BLOQUEADA =
  'A Central ainda não executa mutações: a única porta de escrita hoje depende da sessão do navegador, e o pedido do WhatsApp não tem essa sessão. O pedido foi lido e avaliado, mas nada foi gravado.';
export class ExecucaoBloqueadaError extends Error {
  readonly codigo = EXECUCAO_BLOQUEADA;
  constructor(mensagem = MENSAGEM_EXECUCAO_BLOQUEADA) { super(mensagem); this.name = 'ExecucaoBloqueadaError'; }
}
/** Guarda unica de mutacao vinda da Central. Mesmo papel de `recusarEnvio()` no canal: fail-closed explicito. */
export function recusarExecucaoDaCentral(): never { throw new ExecucaoBloqueadaError(); }

// ---------------------------------------------------------------------------
// 2) Quem e a pessoa (nunca o payload, nunca o navegador)
// ---------------------------------------------------------------------------
export interface ContextoServidor {
  /** Dataset que o servidor carregou para a organizacao do JWT. */
  ds: Dataset;
  /** Organizacao validada pelo SERVIDOR (perfil do banco). Identidade de outra organizacao nunca resolve. */
  organizationId: string;
  /** Contexto vem do numero que RECEBEU a mensagem, nunca do texto. */
  contexto: CommunicationContext;
  /** Identidades carregadas para esta organizacao. */
  identidades: WhatsappIdentity[];
  /** Telefone normalizado (E.164 sem "+") de quem falou. */
  telefone?: string;
}
export type MotivoRecusaUsuario = 'identidade_nao_verificada' | 'sem_usuario' | 'usuario_inativo' | 'organizacao_divergente';
export interface UsuarioDaCentral {
  ok: boolean;
  usuario?: Usuario;
  identidade: IdentidadeResolvida;
  motivo: string;
  recusa?: MotivoRecusaUsuario;
}

/**
 * Resolve a pessoa por tras do numero. Ordem da desconfianca: identidade verificada na MESMA organizacao e no
 * MESMO contexto, depois usuario que existe de verdade no Dataset, depois ativo. O nome do perfil do WhatsApp
 * nunca entra nesta conta, e o papel vem SEMPRE do usuario do Control.
 */
export function resolverUsuarioDaCentral(c: ContextoServidor): UsuarioDaCentral {
  const identidade = resolverIdentidade(c.telefone, c.identidades, c.contexto, c.organizationId);
  if (!identidade.verificada) return { ok: false, identidade, motivo: identidade.motivo, recusa: 'identidade_nao_verificada' };
  const viva = identidade.identidade!;
  if (viva.organizationId !== c.organizationId) {
    // defesa em profundidade: resolverIdentidade ja filtra, e isto barra lista montada errada pelo chamador
    return { ok: false, identidade, motivo: 'identidade de outra organização', recusa: 'organizacao_divergente' };
  }
  const usuario = viva.usuarioId ? c.ds.usuarios.find((u) => u.id === viva.usuarioId) : undefined;
  if (!usuario) return { ok: false, identidade, motivo: 'número verificado, mas sem usuário do EIFF Control associado', recusa: 'sem_usuario' };
  if (!usuario.ativo) return { ok: false, identidade, usuario, motivo: `usuário ${usuario.nome} está inativo`, recusa: 'usuario_inativo' };
  return { ok: true, usuario, identidade, motivo: `${usuario.nome} (${usuario.papel})` };
}

/** A pessoa ve valores de caixa? Sai da MATRIZ do Control, do usuario resolvido — nunca de um default. */
export const veCaixaNaCentral = (usuario?: Usuario): boolean => (usuario ? pode(usuario, 'ver_bancos') : false);

// ---------------------------------------------------------------------------
// 3) O que ela pode fazer com a acao proposta
// ---------------------------------------------------------------------------
export interface PreparoDaCentral {
  usuario?: UsuarioDaCentral;
  autorizacao: Autorizacao;
  /** Pode executar AGORA? Nesta fase nunca: a porta de escrita server-side ainda nao existe. */
  podeExecutar: false;
  motivoExecucao: string;
}

/**
 * Junta identidade + usuario + catalogo + matriz numa decisao so. Nao executa e nao grava: devolve a
 * autorizacao e diz, em uma frase, por que a execucao continua fechada.
 */
export function prepararAcaoDaCentral(p: {
  servidor: ContextoServidor;
  agente: CodigoAgente;
  proposta: AcaoProposta;
  decisao?: Parameters<typeof autorizar>[0]['decisao'];
}): PreparoDaCentral {
  const quem = resolverUsuarioDaCentral(p.servidor);
  const autorizacao = autorizar({
    proposta: p.proposta,
    agente: p.agente,
    identidade: quem.identidade,
    usuario: quem.usuario,
    contexto: p.servidor.contexto,
    decisao: p.decisao,
  });
  return { usuario: quem, autorizacao, podeExecutar: false, motivoExecucao: MENSAGEM_EXECUCAO_BLOQUEADA };
}

// ---------------------------------------------------------------------------
// 4) Portas do agente financeiro sem escrita
// ---------------------------------------------------------------------------
/**
 * Portas para o fluxo do WhatsApp: leem o Dataset que o servidor carregou e o usuario JA resolvido, e
 * RECUSAM a escrita. Repare no que NAO existe aqui: nenhuma leitura da sessao do store. O ator nunca vem do navegador.
 */
export function portasSemEscrita(ctx: ContextoServidor): PortasFinanceiro {
  const quem = resolverUsuarioDaCentral(ctx);
  return {
    dataset: () => ctx.ds,
    usuarioDe: () => quem.usuario,
    registrarPrevisao: () => recusarExecucaoDaCentral(),
  };
}

// EIFF Central: ponte para a MATRIZ UNICA de permissoes do EIFF Control.
// Nao existe segunda ACL: quem autoriza e `pode(usuario, acao, codigoObra)` de src/data/store.ts.
//
// REGRA DEFINITIVA (ver tipos.ts, secao 3b): a INTENCAO escolhe o AGENTE; a ACAO PROPOSTA escolhe a PERMISSAO.
// A decisao do orquestrador entra aqui so como sinal de desconfianca (`requiresHuman`), NUNCA como autoridade:
// ela interpreta linguagem, e linguagem nao autoriza. A permissao sai do CATALOGO_ACOES pelo codigo da acao.
//
//   mensagem -> identidade -> intencao -> agente -> ACAO PROPOSTA -> permissao DA ACAO
//            -> pode(usuario, permissao, escopo) -> motor -> confirmacao -> execucao -> auditoria
//
// Nada aqui executa, grava ou envia.
import { pode, type Acao } from '../../data/store';
import type { Usuario } from '../types';
import { mascararTelefone } from '../radar/canais';
import { INTENCOES_INTERNAS, autorizarAcao, definicaoDaAcao, type AcaoProposta, type CommunicationContext, type IdentidadeResolvida, type InternalIntent, type OrchestratorDecision } from './tipos';

/** Toda intencao do catalogo e INTERNA: nenhuma delas e atendida pelo numero externo (clientes, leads, parceiros). */
export const ehIntencaoInterna = (intent: InternalIntent): boolean => (INTENCOES_INTERNAS as readonly string[]).includes(intent);

export type MotivoNegativa =
  | 'identidade_nao_verificada'
  | 'usuario_ausente'
  | 'usuario_inativo'
  | 'identidade_de_outra_pessoa'
  | 'contexto_externo'
  | 'revisao_humana'
  | 'acao_recusada_pelo_catalogo'
  | 'papel_sem_acao';

export interface Autorizacao {
  autorizado: boolean;
  /** Permissao EXIGIDA pela acao, vinda do catalogo. `null` = ajuda, sem dado de negocio. */
  acao: Acao | null;
  motivo: string;
  negativa?: MotivoNegativa;
  exigeConfirmacao: boolean;
  exigeHumano: boolean;
}
export interface PedidoAutorizacao {
  /** A acao que o agente PROPOS. E ela que define a permissao — nao a intencao. */
  proposta: AcaoProposta;
  /** Agente que propos: o catalogo confere que a acao pertence mesmo a ele. */
  agente: Parameters<typeof autorizarAcao>[0]['agente'];
  identidade: IdentidadeResolvida;
  usuario?: Usuario;
  contexto?: CommunicationContext;
  /** Sinal de desconfianca do roteador. Nunca autoriza; so pode APERTAR. */
  decisao?: Pick<OrchestratorDecision, 'intent' | 'requiresHuman' | 'motivo'>;
}

/**
 * Autoriza (ou nao) a ACAO PROPOSTA. A ordem das recusas e a ordem da desconfianca: primeiro quem esta falando,
 * depois de onde, depois se a regra pediu humano, e so por ultimo o catalogo e o papel na matriz.
 * Telefone nunca aparece inteiro no motivo.
 */
export function autorizar(pedido: PedidoAutorizacao): Autorizacao {
  const { proposta, agente, identidade, usuario, contexto, decisao } = pedido;
  const def = definicaoDaAcao(proposta.codigo);
  const exigida = def ? def.permissao : null;
  const exigeHumano = decisao?.requiresHuman ?? false;
  const base = { acao: exigida, exigeConfirmacao: def?.exigeConfirmacao ?? true, exigeHumano };
  const negar = (negativa: MotivoNegativa, motivo: string): Autorizacao => ({ ...base, autorizado: false, exigeHumano: true, negativa, motivo });

  if (!identidade.verificada) return negar('identidade_nao_verificada', `número não verificado: ${identidade.motivo}`);
  if (!usuario) return negar('usuario_ausente', 'número verificado, mas sem usuário do EIFF Control associado');
  if (!usuario.ativo) return negar('usuario_inativo', `usuário ${usuario.nome} está inativo`);
  if (identidade.identidade?.usuarioId && identidade.identidade.usuarioId !== usuario.id) {
    return negar('identidade_de_outra_pessoa', `o número ${mascararTelefone(identidade.identidade.telefoneNormalizado)} pertence a outra pessoa`);
  }
  if (contexto !== 'INTERNAL' && decisao && ehIntencaoInterna(decisao.intent)) {
    return negar('contexto_externo', `intenção ${decisao.intent} é interna e não é atendida pelo número ${contexto ?? 'desconhecido'}`);
  }
  if (exigeHumano) return negar('revisao_humana', `a decisão exige revisão humana: ${decisao?.motivo ?? 'confiança baixa'}`);

  // autoridade unica: catalogo (codigo -> permissao, dono da acao, escopo) + matriz do Control
  const veredicto = autorizarAcao({ usuario, agente, proposta, identidade }, (acao, obra) => pode(usuario, acao, obra));
  if (!veredicto.autorizado) {
    const doPapel = /não tem "/.test(veredicto.motivo);
    return negar(doPapel ? 'papel_sem_acao' : 'acao_recusada_pelo_catalogo', veredicto.motivo);
  }
  return { ...base, acao: veredicto.permissao, autorizado: true, motivo: `${usuario.papel}: ${veredicto.motivo}${base.exigeConfirmacao ? '; a ação ainda exige confirmação' : ''}` };
}

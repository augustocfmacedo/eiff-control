// EIFF Central: ponte para a MATRIZ UNICA de permissoes do EIFF Control.
// Nao existe segunda ACL: quem autoriza e `pode(usuario, acao, codigoObra)` de src/data/store.ts, com a acao vinda de
// PERMISSAO_POR_INTENCAO (tipos.ts). Esta camada so traduz a decisao do orquestrador em autorizado/negado com motivo
// legivel — nada aqui executa, grava ou envia.
import { pode, type Acao } from '../../data/store';
import type { Usuario } from '../types';
import { mascararTelefone } from '../radar/canais';
import { INTENCOES_INTERNAS, type CommunicationContext, type IdentidadeResolvida, type InternalIntent, type OrchestratorDecision } from './tipos';

/**
 * Espelho TIPADO de PERMISSAO_POR_INTENCAO: aqui o compilador recusa qualquer acao que nao exista em `Acao`
 * (a tabela do contrato e Record<InternalIntent, string> por desenho, para tipos.ts nao depender do store).
 * O teste prende a igualdade entre as duas — nenhuma pode andar sozinha.
 */
export const ACAO_POR_INTENCAO = {
  FINANCE: 'editar_lancamento',
  PURCHASE: 'comprar',
  WORKSITE: 'editar_obra',
  INVENTORY: 'editar_etc',
  COMMERCIAL: 'radar',
  HR_ADMIN: 'editar_cadastros',
  EXECUTIVE: 'ver_bancos',
  GENERAL: 'comentar',
} as const satisfies Record<InternalIntent, Acao>;

export const acaoDaIntencao = (intent: InternalIntent): Acao => ACAO_POR_INTENCAO[intent];
/** Toda intencao do catalogo e INTERNA: nenhuma delas e atendida pelo numero externo (clientes, leads, parceiros). */
export const ehIntencaoInterna = (intent: InternalIntent): boolean => (INTENCOES_INTERNAS as readonly string[]).includes(intent);

export type MotivoNegativa =
  | 'identidade_nao_verificada'
  | 'usuario_ausente'
  | 'usuario_inativo'
  | 'identidade_de_outra_pessoa'
  | 'contexto_externo'
  | 'revisao_humana'
  | 'papel_sem_acao';

export interface Autorizacao {
  autorizado: boolean;
  acao: Acao;
  motivo: string;
  negativa?: MotivoNegativa;
  exigeConfirmacao: boolean;
  exigeHumano: boolean;
}
export interface PedidoAutorizacao {
  decisao: OrchestratorDecision;
  identidade: IdentidadeResolvida;
  usuario?: Usuario;
  contexto?: CommunicationContext;
  codigoObra?: string;
}

/**
 * Autoriza (ou nao) a acao proposta. A ordem das recusas e a ordem da desconfianca: primeiro quem esta falando,
 * depois de onde, depois se a regra pediu humano e so por ultimo o papel na matriz.
 * Telefone nunca aparece inteiro no motivo.
 */
export function autorizar(pedido: PedidoAutorizacao): Autorizacao {
  const { decisao, identidade, usuario, contexto, codigoObra } = pedido;
  const acao = acaoDaIntencao(decisao.intent);
  const base = { acao, exigeConfirmacao: true, exigeHumano: decisao.requiresHuman };
  const negar = (negativa: MotivoNegativa, motivo: string): Autorizacao => ({ ...base, autorizado: false, exigeHumano: true, negativa, motivo });

  if (!identidade.verificada) return negar('identidade_nao_verificada', `número não verificado: ${identidade.motivo}`);
  if (!usuario) return negar('usuario_ausente', 'número verificado, mas sem usuário do EIFF Control associado');
  if (!usuario.ativo) return negar('usuario_inativo', `usuário ${usuario.nome} está inativo`);
  if (identidade.identidade?.usuarioId && identidade.identidade.usuarioId !== usuario.id) {
    return negar('identidade_de_outra_pessoa', `o número ${mascararTelefone(identidade.identidade.telefoneNormalizado)} pertence a outra pessoa`);
  }
  if (contexto !== 'INTERNAL' && ehIntencaoInterna(decisao.intent)) {
    return negar('contexto_externo', `intenção ${decisao.intent} é interna e não é atendida pelo número ${contexto ?? 'desconhecido'}`);
  }
  if (decisao.requiresHuman) return negar('revisao_humana', `a decisão exige revisão humana: ${decisao.motivo}`);
  if (!pode(usuario, acao, codigoObra)) {
    return negar('papel_sem_acao', `perfil ${usuario.papel} não tem a ação "${acao}"${codigoObra ? ` na obra ${codigoObra}` : ''}`);
  }
  return { ...base, autorizado: true, motivo: `${usuario.papel} pode "${acao}"${codigoObra ? ` na obra ${codigoObra}` : ''}; a ação ainda exige confirmação` };
}

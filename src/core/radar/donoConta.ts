// CD-D5 — Dono da conta (docs/commercial-director-1.0.md §19.3). Funções PURAS sobre o dono comercial canônico.
//
// O dono da conta é uma AUTORIDADE de atribuição, não uma regra comercial: aqui não há ranking, score, ordenação nem
// regra da Commercial Queue. Ele também não substitui o responsável da oportunidade (`Oportunidade.responsavelId`),
// o da tarefa (`TarefaRadar.responsavelId`) nem o responsável que a fila deriva por item (CM1-A); este módulo não
// lê nem escreve nenhum deles.
//
// Estados:
//   COM_DONO      — `commercialOwnerId` aponta para um usuário ATIVO da organização;
//   SEM_DONO      — `commercialOwnerId` ausente;
//   DONO_INATIVO  — `commercialOwnerId` gravado, mas o usuário está inativo (ou não está entre os usuários da
//                   organização). O vínculo histórico fica, nada é limpo automaticamente, e a conta não tem dono
//                   válido para fins operacionais. Trocar o dono é decisão humana.
//
// "Mesma organização" no app = estar na lista de usuários carregada para a organização (`Dataset.usuarios`, lida de
// `profile` sob RLS por organização). No banco, o trigger da migration 0063 confere a organização de verdade.
import type { Empresa, RadarDataset } from './types';

export const ESTADOS_DONO_CONTA = ['COM_DONO', 'SEM_DONO', 'DONO_INATIVO'] as const;
export type EstadoDonoConta = (typeof ESTADOS_DONO_CONTA)[number];

/** O mínimo de um usuário que a regra do dono precisa. `Usuario` (src/core/types.ts) satisfaz. */
export interface UsuarioDono {
  id: string;
  ativo: boolean;
}

/** Estado do dono da conta contra a lista de usuários da organização. */
export function estadoDonoConta(e: Pick<Empresa, 'commercialOwnerId'>, usuarios: readonly UsuarioDono[]): EstadoDonoConta {
  const id = e.commercialOwnerId?.trim();
  if (!id) return 'SEM_DONO';
  return usuarios.some((u) => u.id === id && u.ativo) ? 'COM_DONO' : 'DONO_INATIVO';
}

/** Id do dono válido (ativo e da organização), ou `undefined` quando a conta está SEM_DONO ou com DONO_INATIVO. */
export function donoValido(e: Pick<Empresa, 'commercialOwnerId'>, usuarios: readonly UsuarioDono[]): string | undefined {
  return estadoDonoConta(e, usuarios) === 'COM_DONO' ? e.commercialOwnerId!.trim() : undefined;
}

/**
 * Motivos para recusar `usuarioId` como novo dono (lista vazia = pode). Falha fechada: id vazio, usuário fora da
 * organização ou inativo são recusados.
 */
export function motivosRecusaDono(usuarioId: string, usuarios: readonly UsuarioDono[]): string[] {
  const id = usuarioId.trim();
  if (!id) return ['Informe o usuário que será dono da conta.'];
  const u = usuarios.find((x) => x.id === id);
  if (!u) return ['O dono precisa ser um usuário da mesma organização.'];
  if (!u.ativo) return ['O dono precisa ser um usuário ativo.'];
  return [];
}

/** Conta ativa e não mesclada: o universo das contas comerciais operacionais. */
const operacional = (e: Pick<Empresa, 'ativo' | 'mescladaEm'>) => e.ativo && !e.mescladaEm;

/** Contas ativas e não mescladas SEM dono válido (SEM_DONO ou DONO_INATIVO), na ordem do dataset. */
export function contasSemDonoValido(r: Pick<RadarDataset, 'empresas'>, usuarios: readonly UsuarioDono[]): Empresa[] {
  return r.empresas.filter((e) => operacional(e) && estadoDonoConta(e, usuarios) !== 'COM_DONO');
}

/**
 * Porta única para qualquer métrica de desempenho individual futura: só conta ativa, não mesclada e COM dono válido
 * entra. SEM_DONO e DONO_INATIVO ficam fora.
 */
export function entraEmMetricaIndividual(e: Pick<Empresa, 'ativo' | 'mescladaEm' | 'commercialOwnerId'>, usuarios: readonly UsuarioDono[]): boolean {
  return operacional(e) && estadoDonoConta(e, usuarios) === 'COM_DONO';
}

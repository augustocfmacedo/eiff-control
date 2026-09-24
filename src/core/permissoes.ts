// Matriz UNICA de permissoes do EIFF Control.
//
// Este modulo vive em src/core/ e NAO importa nada de navegador — sem React, sem seed.json, sem cliente
// do Supabase, sem `import.meta.env`. A razao e concreta e foi descoberta em producao (Deploy Preview 5
// da MC-LIVE-1): a funcao Netlify /api/development-status importava `pode` de src/data/store.ts, e o
// store puxa src/data/supabase.ts, que le `import.meta.env.VITE_SUPABASE_URL` no topo do modulo. No
// runtime da Function isso e `undefined` e a funcao quebrava com 502 ANTES de executar uma linha.
//
// A matriz continua sendo UMA SO: `src/data/store.ts` reexporta `pode` e `Acao` daqui, entao todo o
// app segue importando do mesmo lugar de sempre e nada foi duplicado. O que mudou e onde ela mora, para
// poder ser usada tambem do lado do servidor. Regra nenhuma foi alterada.
import { PAPEIS_RADAR } from './radar/comunicacaoLlm';
import type { Papel, Usuario } from './types';

export type Acao =
  | 'ver_bancos'
  | 'editar_lancamento'
  | 'liquidar'
  | 'conciliar'
  | 'aprovar'
  | 'editar_obra'
  | 'editar_etc'
  | 'editar_cadastros'
  | 'editar_parametros'
  | 'fechar_periodo'
  | 'reabrir_periodo'
  | 'ver_auditoria'
  | 'ver_mission_control'
  | 'administrar'
  | 'comentar'
  | 'exportar'
  | 'orcar'
  | 'comprar'
  | 'radar'
  | 'radar_config'
  | 'inbox'
  | 'inbox_config';

export const MATRIZ: Record<Acao, Papel[]> = {
  ver_bancos: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
  editar_lancamento: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras'],
  liquidar: ['Administrador', 'Financeiro'],
  conciliar: ['Administrador', 'Financeiro'],
  aprovar: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'],
  editar_obra: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra'],
  editar_etc: ['Administrador', 'Diretoria', 'Gestor de obra', 'Engenharia', 'Financeiro'],
  editar_cadastros: ['Administrador', 'Financeiro'],
  editar_parametros: ['Administrador', 'Financeiro', 'Diretoria'],
  fechar_periodo: ['Administrador', 'Financeiro'],
  reabrir_periodo: ['Administrador', 'Diretoria'],
  ver_auditoria: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
  // Mission Control (painel executivo da EIFF Central): SO Administrador e Diretoria nesta fase. Permissao propria de
  // proposito — ver_auditoria alcanca Financeiro, Contabilidade e Auditoria, que nao entram aqui.
  ver_mission_control: ['Administrador', 'Diretoria'],
  administrar: ['Administrador'],
  comentar: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade'],
  exportar: ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'],
  orcar: ['Administrador', 'Diretoria', 'Financeiro', 'Engenharia', 'Compras', 'Gestor de obra'],
  comprar: ['Administrador', 'Diretoria', 'Financeiro', 'Compras', 'Gestor de obra', 'Engenharia'],
  radar: [...PAPEIS_RADAR], // mesma lista que a funcao /api/comunicacao confere no perfil do banco
  radar_config: ['Administrador', 'Diretoria'],
  // EIFF Inbox: a permissao abre a central; o recorte por setor e feito DENTRO dela (src/core/inbox/roteamento.ts), nunca uma segunda ACL.
  inbox: ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade'],
  inbox_config: ['Administrador', 'Diretoria'],
};

export function pode(usuario: Usuario, acao: Acao, codigoObra?: string): boolean {
  if (!usuario.ativo) return false;
  if (!MATRIZ[acao].includes(usuario.papel)) return false;
  if (codigoObra && usuario.obras !== '*' && !usuario.obras.includes(codigoObra)) return false;
  return true;
}

// Gestao de usuarios: o que a TELA e o SERVIDOR compartilham (papeis e formato da lista). Fica separado de
// usuariosServidor.ts de proposito: aquele modulo fala da chave administrativa e nunca pode entrar no bundle do navegador
// (guarda em src/core/inbox/inbox.test.ts).
import type { Papel } from './types';

export const PAPEIS: Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', 'Solicitante'];
/** papeis que acompanham obras escolhidas (user_scope por obra; nenhuma escolhida = todas as obras da empresa) */
export const PAPEIS_COM_OBRAS: Papel[] = ['Gestor de obra', 'Engenharia'];

export interface UsuarioLista {
  id: string; nome: string; email: string; papel: Papel; ativo: boolean; obras: string[] | '*';
  convidadoEm?: string; confirmadoEm?: string; ultimoAcesso?: string; voce: boolean;
}

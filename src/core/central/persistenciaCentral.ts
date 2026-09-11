// STUB (Architect, prework da F2). A F2-DATA substitui este arquivo inteiro.
// Contrato: src/core/central/servidorContratos.ts (PortasPersistenciaCentral, TABELAS_ESCRITA_CENTRAL).
// E o UNICO escritor da Central: so central_conversation, central_message, central_event, central_message_content e
// central_message_processing; nenhuma RPC; nenhum console; nenhum texto ou telefone em erro.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErroCentralServidor, type PortasPersistenciaCentral } from './servidorContratos';

const naoImplementado = (): never => { throw new ErroCentralServidor('nao_implementado', 'deterministico', 'persistenciaCentral ainda não implementada (stub da F2)'); };

export function criarPersistenciaCentral(_cliente: SupabaseClient): PortasPersistenciaCentral {
  void _cliente;
  return {
    carregarEstado: async () => naoImplementado(),
    carregarIdentidades: async () => naoImplementado(),
    persistirLote: async () => naoImplementado(),
    registrarProcessamento: async () => naoImplementado(),
  };
}

// STUB (Architect, prework da F2). A F2-DATA substitui este arquivo inteiro.
// Contrato: src/core/central/servidorContratos.ts (CarregarDatasetServidor, ALLOWLIST_DATASET).
// Regras que a implementacao tem de cumprir: SELECT-only; toda raiz com organization_id; filhas so por ids dos pais;
// nada de insert/upsert/update/delete/rpc; usa montarDataset de ./mapeamentoDataset; nunca importa ./supabase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErroCentralServidor, type CarregarDatasetServidor } from '../core/central/servidorContratos';

export function criarCarregadorDataset(_cliente: SupabaseClient): CarregarDatasetServidor {
  void _cliente;
  return async () => { throw new ErroCentralServidor('nao_implementado', 'deterministico', 'datasetServidor ainda não implementado (stub da F2)'); };
}

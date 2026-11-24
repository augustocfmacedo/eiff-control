// Cliente Supabase das funções Netlify (chave de serviço, sem sessão, SEM realtime). A partir da 2.11x o supabase-js cria
// o cliente de realtime já no createClient e, no Node 20 (runtime das funções: NODE_VERSION = "20" no netlify.toml), RECUSA
// criar o cliente porque não há WebSocket nativo ("Node.js detected but native WebSocket not found"). As funções só fazem
// leitura/RPC por HTTP e nunca abrem canal de realtime, então passamos um transporte que recusa conectar: o cliente nasce
// e qualquer tentativa de realtime falha de forma explícita. Descoberto no widget do iPad em 14/10/2026 (e corrige o
// veredito do Diretor Financeiro, que usava o mesmo createClient). Nunca usar no navegador.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchServico } from '../core/chaveServico';

/** Transporte que existe só para o supabase-js não exigir WebSocket; conectar é erro (as funções não usam realtime). */
export class SemRealtime {
  constructor() { throw new Error('realtime não é usado nas funções do servidor'); }
}

// S1/R1: a chave pode ser a legada (JWT) ou a nova (sb_secret_…). Com a nova, `fetchServico` tira o `Authorization`
// das chamadas ao banco (fica só o `apikey`, o caminho recomendado). Chave publicável ou em formato desconhecido lança
// erro aqui, antes de qualquer requisição (falha fechada).
export function clienteServidor(url: string, chave: string, fetchBase: typeof fetch = fetch): SupabaseClient {
  return createClient(url, chave.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: SemRealtime as unknown as never },
    global: { fetch: fetchServico(chave, fetchBase) },
  });
}

// Cliente Supabase das funções Netlify (chave de serviço, sem sessão, SEM realtime). A partir da 2.11x o supabase-js cria
// o cliente de realtime já no createClient e, no Node 20 (runtime das funções: NODE_VERSION = "20" no netlify.toml), RECUSA
// criar o cliente porque não há WebSocket nativo ("Node.js detected but native WebSocket not found"). As funções só fazem
// leitura/RPC por HTTP e nunca abrem canal de realtime, então passamos um transporte que recusa conectar: o cliente nasce
// e qualquer tentativa de realtime falha de forma explícita. Descoberto no widget do iPad em 14/10/2026 (e corrige o
// veredito do Diretor Financeiro, que usava o mesmo createClient). Nunca usar no navegador.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Transporte que existe só para o supabase-js não exigir WebSocket; conectar é erro (as funções não usam realtime). */
export class SemRealtime {
  constructor() { throw new Error('realtime não é usado nas funções do servidor'); }
}

export function clienteServidor(url: string, chave: string): SupabaseClient {
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: SemRealtime as unknown as never },
  });
}

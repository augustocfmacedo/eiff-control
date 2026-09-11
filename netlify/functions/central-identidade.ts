// /api/central/identidade — onboarding de identidade do WhatsApp da EIFF Central (Wave 03, F3).
// POST com JWT do Supabase -> papel e organizacao SO do perfil no banco (ver_central: Administrador, Diretoria e
// Financeiro) -> RPCs server-only da migration 0049 chamadas com SUPABASE_SERVICE_ROLE_KEY (so no painel do
// Netlify; nunca no navegador, nunca em log, nunca na resposta) DEPOIS do JWT validado.
// Contrato fechado: { acao: 'listar' } | { acao: 'solicitar', telefone, profileId?, workerId? } |
// { acao: 'revogar', identidadeId, motivo }. O codigo de verificacao volta UMA vez, na resposta de `solicitar`.
// A logica vive em src/core/central/onboarding.ts (handler puro e testavel, portas injetadas); aqui entram o
// ambiente, a serializacao e o ADAPTER PostgREST das portas — o unico lugar que fala com o banco, porque nenhum
// modulo de src/core/central escreve nele (guarda da ameaca 8). Nada e enviado pelo WhatsApp por aqui.
import { COLUNAS_IDENTIDADE, tratarCentralIdentidade, type LinhaIdentidade, type PortasIdentidade, type RespostaRpc } from '../../src/core/central/onboarding';

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * Portas reais sobre o PostgREST do Supabase com a chave service_role — construidas SO depois do JWT validado (o
 * handler puro so chama esta fabrica depois de autenticar e conferir a chave). O SELECT filtra pela organizacao do
 * perfil (service_role ignora RLS, entao o filtro e nosso) e nunca pede `verification_code_hash`.
 * `http` e injetado para o teste exercitar o adapter sem rede.
 */
export function portasSupabase(deps: { http: typeof fetch; supabaseUrl: string }, serviceRoleKey: string): PortasIdentidade {
  const cab = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', accept: 'application/json' };
  const chamarRpc = async (nome: string, args: object): Promise<RespostaRpc> => {
    const r = await deps.http(`${deps.supabaseUrl}/rest/v1/rpc/${nome}`, { method: 'POST', headers: cab, body: JSON.stringify(args) });
    const d = (await r.json().catch(() => null)) as RespostaRpc | null;
    // erro HTTP ou corpo ininteligivel: excecao, que o core traduz em `indisponivel` (nunca sobe ao cliente)
    if (!r.ok || !d || typeof d !== 'object') throw new Error(`rpc ${nome}: http ${r.status}`);
    return d;
  };
  return {
    rpcRequest: (a) => chamarRpc('whatsapp_identity_request', a),
    rpcVerify: (a) => chamarRpc('whatsapp_identity_verify', a),
    rpcTransition: (a) => chamarRpc('whatsapp_identity_transition', a),
    listarIdentidades: async (organizationId, contexto) => {
      const filtro = `organization_id=eq.${encodeURIComponent(organizationId)}${contexto ? `&context=eq.${encodeURIComponent(contexto)}` : ''}`;
      const r = await deps.http(`${deps.supabaseUrl}/rest/v1/whatsapp_identity?${filtro}&select=${COLUNAS_IDENTIDADE.join(',')}&order=created_at.desc`, { headers: cab });
      if (!r.ok) throw new Error(`select whatsapp_identity: http ${r.status}`);
      const d = (await r.json().catch(() => null)) as unknown;
      return Array.isArray(d) ? (d as LinhaIdentidade[]) : [];
    },
  };
}

export default async (req: Request): Promise<Response> => {
  let corpo: unknown = null;
  if (req.method === 'POST') {
    try { corpo = await req.json(); } catch { corpo = null; }
  }
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim() || SUPABASE_URL_PADRAO;
  const saida = await tratarCentralIdentidade(
    { metodo: req.method, authorization: req.headers.get('authorization'), anonDoCliente: req.headers.get('x-supabase-anon'), corpo },
    {
      http: fetch,
      supabaseUrl,
      anon: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // server-only; o handler nunca o devolve nem loga
      portas: (chave) => portasSupabase({ http: fetch, supabaseUrl }, chave),
      agora: () => new Date().toISOString(),
      // telemetria minima: acao, outcome, http_status, latency_ms — o handler nunca passa telefone, codigo ou jwt
      log: (t) => { try { console.log(JSON.stringify({ evento: 'central', ...t })); } catch { /* ignore */ } },
    },
  );
  return json(saida.corpo, saida.status);
};

export const config = { path: '/api/central/identidade' };

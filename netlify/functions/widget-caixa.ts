// Widgets do iPad (Scriptable): GET /api/widget-caixa com o token do aparelho devolve o resumo do caixa (ou, com
// ?visao=pedidos, os pedidos da equipe ao Diretor Financeiro; com ?visao=pagamentos, os pagamentos do dia). Toda a regra está
// em src/core/widgetServidor.ts (handler puro, testado); aqui só o ambiente: SUPABASE_SERVICE_ROLE_KEY (só no painel do
// Netlify, nunca VITE_, nunca no navegador ou em log) valida o token pela RPC server-only widget_token_validar (0069) e
// carrega o dataset como o Diretor Financeiro já faz (carregarComoServidor). O token nunca é registrado em log.
import { erroParaLog, tratarWidgetCaixa, type ValidacaoTokenWidget } from '../../src/core/widgetServidor';
import { carregarComoServidor } from '../../src/data/supabase';
import { clienteServidor } from '../../src/data/clienteServidor';

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req: Request): Promise<Response> => {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!servico) return json({ erro: 'nao_configurado', mensagem: 'Widget ainda não configurado no servidor.' }, 501);
  const r = await tratarWidgetCaixa({ metodo: req.method, autorizacao: req.headers.get('authorization'), visao: new URL(req.url).searchParams.get('visao') }, {
    async validar(token) {
      const resp = await fetch(`${url}/rest/v1/rpc/widget_token_validar`, {
        method: 'POST',
        headers: { apikey: servico, authorization: `Bearer ${servico}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_token: token }),
      });
      if (!resp.ok) throw new Error(`validar ${resp.status}`);
      const v = (await resp.json()) as { ok?: boolean; erro?: string; perfil_id?: string; token_id?: string; nome?: string };
      return (v.ok && v.perfil_id ? { ok: true, perfilId: v.perfil_id, tokenId: v.token_id ?? '', nome: v.nome ?? '' } : { ok: false, erro: v.erro ?? 'desconhecido' }) as ValidacaoTokenWidget;
    },
    carregar: (perfilId) => carregarComoServidor(clienteServidor(url, servico), perfilId),
    agora: () => new Date(),
    registrar: (etapa, erro) => console.error('widget-caixa', etapa, erroParaLog(erro)),
  }).catch((e) => {
    console.error('widget-caixa', String((e as Error).message ?? e).split('\n')[0].slice(0, 160));
    return { status: 503, corpo: { erro: 'indisponivel', mensagem: 'Não foi possível montar o resumo agora.' } };
  });
  return json(r.corpo, r.status);
};

export const config = { path: '/api/widget-caixa' };

// /api/formulario-site — a submissão do formulário publicado em eiff.com.br entra no EIFF Controle.
//
// Esta função é o invólucro: toda a decisão mora em src/core/radar/formularioBorda.ts, que recebe `env` e
// `fetch` injetados e é testado sem rede (mesmo desenho de comunicacaoServidor/widgetServidor/usuariosServidor).
//
// O que o caminho faz: autentica, traduz a submissão do Netlify, decide pelo core e GRAVA — evidência no Lead
// Engine (radar_source_record, PENDING, sem entidade) e conversa no EIFF Inbox (visível na hora, sem exigir
// empresa nem CNPJ). Só devolve sucesso do que o banco confirmou.
//
// O que NÃO faz: não promove empresa, não cria contato do Radar, não cria oportunidade, não envia nada, não
// chama o motor estrutural. A decisão comercial segue humana, na aba Candidatos.
//
// Transporte (verificado em 09/11/2026): a notificação nativa do Netlify Forms NÃO aceita cabeçalho próprio,
// então quem chama aqui é uma função de evento do próprio site, que acrescenta `x-eiff-form-secret`. O
// reconciliador (scripts/formulario-reconciliar.mts) usa o MESMO endpoint com o mesmo segredo — e é ele a
// garantia de que nada se perde, porque o evento do Netlify não tem reenvio automático.
//
// Segredos só no painel do Netlify: EIFF_FORM_SECRET, SUPABASE_SERVICE_ROLE_KEY. Nunca VITE_, nunca em log.
import { tratarPedidoFormulario } from '../../src/core/radar/formularioBorda';

// Log sem payload: identificador, impressão e resultado. O conteúdo do lead vive no banco, não no log.
const log = (t: Record<string, unknown>) => { try { console.log(JSON.stringify({ evento: 'formulario_site', ...t })); } catch { /* ignore */ } };

export default async (req: Request): Promise<Response> => {
  const r = await tratarPedidoFormulario(req, { env: process.env, fetch, log });
  return new Response(JSON.stringify(r.corpo), {
    status: r.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/formulario-site' };

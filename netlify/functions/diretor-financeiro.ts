// Diretor Financeiro virtual: a IA so INTERPRETA a mensagem (valor, data, categoria, obra, fornecedor, intencao) e devolve
// JSON; nenhum numero de caixa passa por aqui e nada e gravado. O parecer e feito pelo motor no app (src/core/cfo.ts).
// Chave ANTHROPIC_API_KEY so no painel do Netlify; modelo ANTHROPIC_CFO_MODEL (padrao claude-sonnet-5). Sessao do Supabase validada.
import { createClient } from '@supabase/supabase-js';
import { ESQUEMA_INTERPRETACAO, PROMPT_DF_V1, analisarPagamento, promptInterpretacao, validarPedidoVeredicto, veredictoDe, type CatalogoDF } from '../../src/core/cfo';
import { carregarComoServidor } from '../../src/data/supabase';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const TIMEOUT_MS = 20_000;

/** Data de hoje no fuso da empresa (o servidor roda em UTC). */
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!url || !anon) return json({ erro: 'nao_configurado' }, 501);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ erro: 'nao_autenticado' }, 401);
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);
  // sessao valida nao basta: exige perfil ATIVO no banco (porta df_contexto da 0067, que tambem atende o Solicitante, que nao le
  // a tabela profile). Login sem perfil ou desativado nao usa a IA.
  const perfil = await fetch(`${url}/rest/v1/rpc/df_contexto`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  if (!perfil.ok) return json({ erro: 'sem_perfil' }, 403);

  let corpo: { acao?: string; pedido?: unknown; mensagens?: { papel: string; texto: string }[]; catalogo?: CatalogoDF };
  try { corpo = (await req.json()) as typeof corpo; } catch { return json({ erro: 'corpo_invalido' }, 400); }

  // VEREDITO para quem nao ve caixa (Solicitante e equipe): o servidor carrega o caixa com a chave de servico, roda o MESMO
  // parecer do motor (analisarPagamento) e devolve so decisao e datas. Nenhum saldo, reserva ou valor sai daqui.
  if (corpo.acao === 'veredicto') {
    const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!servico) return json({ erro: 'nao_configurado' }, 501);
    const pedido = validarPedidoVeredicto(corpo.pedido);
    if (typeof pedido === 'string') return json({ erro: 'pedido_invalido', mensagem: pedido }, 400);
    const quem = (await user.json()) as { id?: string };
    if (!quem.id) return json({ erro: 'nao_autenticado' }, 401);
    try {
      const { ds } = await carregarComoServidor(createClient(url, servico, { auth: { persistSession: false, autoRefreshToken: false } }), quem.id);
      const hoje = hojeSP();
      const dsHoje = { ...ds, params: { ...ds.params, dataBase: ds.params.dataBaseAutomatica === false ? ds.params.dataBase : hoje } };
      const veredicto = veredictoDe(analisarPagamento(dsHoje, { ...pedido, vencimento: pedido.vencimento < dsHoje.params.dataBase ? dsHoje.params.dataBase : pedido.vencimento }));
      return json({ veredicto });
    } catch (e) {
      console.error('df veredicto', String((e as Error).message ?? e).split('\n')[0].slice(0, 160));
      return json({ erro: 'indisponivel' }, 503);
    }
  }

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return json({ erro: 'nao_configurado' }, 501);
  const cat = corpo.catalogo;
  if (!cat || typeof cat.hoje !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cat.hoje) || !Array.isArray(cat.categorias) || !Array.isArray(cat.obras)) return json({ erro: 'catalogo_invalido' }, 400);
  const catalogo: CatalogoDF = { hoje: cat.hoje, categorias: cat.categorias.filter((c) => typeof c === 'string').slice(0, 80), obras: cat.obras.filter((o) => o && typeof o.codigo === 'string' && typeof o.nome === 'string').slice(0, 40).map((o) => ({ codigo: o.codigo.slice(0, 40), nome: o.nome.slice(0, 80) })) };
  const mensagens = (corpo.mensagens ?? []).filter((m) => m && (m.papel === 'usuario' || m.papel === 'assistente') && typeof m.texto === 'string').slice(-6).map((m) => ({ role: m.papel === 'usuario' ? 'user' : 'assistant', content: m.texto.slice(0, 1500) }));
  if (!mensagens.length || mensagens[mensagens.length - 1].role !== 'user') return json({ erro: 'sem_pergunta' }, 400);

  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_CFO_MODEL ?? 'claude-sonnet-5', max_tokens: 400,
        system: [{ type: 'text', text: promptInterpretacao(catalogo) }],
        messages: mensagens,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_INTERPRETACAO } },
      }),
    });
    if (!resposta.ok) return json({ erro: 'ia_indisponivel' }, 502);
    const dados = (await resposta.json()) as { model?: string; content?: { type: string; text?: string }[] };
    const texto = (dados.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    let interpretacao: unknown = null;
    try { interpretacao = JSON.parse(texto); } catch { return json({ erro: 'saida_invalida' }, 422); }
    return json({ interpretacao, modelo: dados.model, prompt: PROMPT_DF_V1 });
  } catch (e) {
    return json({ erro: (e as Error).name === 'AbortError' ? 'llm_timeout' : 'ia_indisponivel' }, 503);
  } finally { clearTimeout(timer); }
};

export const config = { path: '/api/diretor-financeiro' };

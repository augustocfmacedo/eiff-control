// Diretor Financeiro virtual: a IA so INTERPRETA a mensagem (valor, data, categoria, obra, fornecedor, intencao) e devolve
// JSON; nenhum numero de caixa passa por aqui e nada e gravado. O parecer e feito pelo motor no app (src/core/cfo.ts).
// Chave ANTHROPIC_API_KEY so no painel do Netlify; modelo ANTHROPIC_CFO_MODEL (padrao claude-sonnet-5). Sessao do Supabase validada.
import { ESQUEMA_INTERPRETACAO, PROMPT_DF_V1, promptInterpretacao, type CatalogoDF } from '../../src/core/cfo';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const TIMEOUT_MS = 20_000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return json({ erro: 'nao_configurado' }, 501);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!url || !anon) return json({ erro: 'nao_configurado' }, 501);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ erro: 'nao_autenticado' }, 401);
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);

  let corpo: { mensagens?: { papel: string; texto: string }[]; catalogo?: CatalogoDF };
  try { corpo = (await req.json()) as typeof corpo; } catch { return json({ erro: 'corpo_invalido' }, 400); }
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

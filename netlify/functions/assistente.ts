// Assistente do EIFF Control: funcao serverless que valida a sessao do Supabase e consulta o modelo da Anthropic
// com o conhecimento do sistema (src/core/assistente.ts). A chave ANTHROPIC_API_KEY fica so no painel do Netlify.
// Variaveis: ANTHROPIC_API_KEY (obrigatoria), ANTHROPIC_MODEL (opcional), VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
import { montarConhecimento, montarContexto, type ContextoAssistente, type MensagemChat } from '../../src/core/assistente';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const PAPEIS = ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria'];

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return json({ erro: 'nao_configurado', mensagem: 'ANTHROPIC_API_KEY não definida no Netlify.' }, 501);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ erro: 'nao_autenticado' }, 401);

  // sessao valida? (o token do usuario e verificado pelo proprio Supabase Auth)
  const user = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  if (!user.ok) return json({ erro: 'nao_autenticado' }, 401);
  const u = (await user.json()) as { id?: string; email?: string };

  let corpo: { mensagens?: MensagemChat[]; contexto?: ContextoAssistente };
  try { corpo = (await req.json()) as typeof corpo; } catch { return json({ erro: 'corpo_invalido' }, 400); }
  const mensagens = (corpo.mensagens ?? []).filter((m) => m && (m.papel === 'usuario' || m.papel === 'assistente') && typeof m.texto === 'string').slice(-20).map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 4000) }));
  if (!mensagens.length || mensagens[mensagens.length - 1].papel !== 'usuario') return json({ erro: 'sem_pergunta' }, 400);

  // papel e nome do perfil (RLS deixa o usuario ler o proprio perfil); se falhar, usa o que o app mandou
  const ctx: ContextoAssistente = { papel: 'Auditoria', nome: u.email ?? 'usuário', ...corpo.contexto };
  try {
    const perfil = await fetch(`${url}/rest/v1/profile?id=eq.${u.id}&select=name,role`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    const rows = (await perfil.json()) as { name?: string; role?: string }[];
    if (rows?.[0]?.role && PAPEIS.includes(rows[0].role)) { ctx.papel = rows[0].role as ContextoAssistente['papel']; ctx.nome = rows[0].name ?? ctx.nome; }
  } catch { /* mantem o contexto do app */ }
  if (!PAPEIS.includes(ctx.papel)) ctx.papel = 'Auditoria';

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
      max_tokens: 1024,
      system: [
        { type: 'text', text: montarConhecimento(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: montarContexto(ctx) },
      ],
      messages: mensagens.map((m) => ({ role: m.papel === 'usuario' ? 'user' : 'assistant', content: m.texto })),
    }),
  });
  if (!resposta.ok) return json({ erro: 'ia_indisponivel', detalhe: (await resposta.text()).slice(0, 300) }, 502);
  const dados = (await resposta.json()) as { model?: string; content?: { type: string; text?: string }[] };
  const texto = (dados.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  return json({ texto, modelo: dados.model });
};

export const config = { path: '/api/assistente' };

// /api/email-comercial: envio MANUAL de e-mail pela caixa corporativa (Gmail API), a partir de uma conversa do Inbox.
// docs/email-comercial.md e docs/email-comercial-e0.md. Invólucro fino: toda a regra está em
// src/core/inbox/emailServidor.ts (handler puro) e as portas em src/core/inbox/emailPorta.ts.
//
// DESLIGADO POR PADRÃO. Só envia com TODAS estas condições, lidas aqui no servidor:
//   EIFF_INBOX_OUTBOUND_ENABLED=true  E  EIFF_EMAIL_SEND_MODE=canary|ativo  E  as três credenciais do Google
//   E  EIFF_EMAIL_SENDER  E  (no canário) o destinatário em EIFF_EMAIL_CANARY_RECIPIENTS.
// Sem qualquer uma delas a função responde sem chamar o Google.
//
// Segredos só no painel do Netlify, nunca com prefixo VITE_, nunca em log:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, SUPABASE_SERVICE_ROLE_KEY.
import { GMAIL_SEND_URL, ambienteEmail, portaGoogle, portaLivro, portaSessao, type VariaveisEmail } from '../../src/core/inbox/emailPorta';
import { tratarEmailComercial, type DepsEmail } from '../../src/core/inbox/emailServidor';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const semRede = async () => ({ tipo: 'rede' as const });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO).replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '';
  if (!url || !anon) return json({ erro: 'nao_configurado', mensagem: 'Supabase não configurado na função.' }, 501);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ erro: 'pedido_invalido' }, 400); }

  const env = process.env as VariaveisEmail;
  const ambiente = ambienteEmail(env);
  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const deps: DepsEmail = {
    ambiente,
    sessao: portaSessao({ url, anon }, fetch),
    // sem a chave de serviço o livro fica indisponível: o handler recusa e NADA é enviado (livro primeiro)
    livro: chave ? portaLivro({ url, chave }, fetch) : { criar: async () => ({ ok: false, erro: 'livro_indisponivel' }), transicionar: async () => false, aceitar: async () => ({ ok: false }) },
    // sem credencial não existe porta para o Google: qualquer chamada seria «rede», e o handler nem chega a fazê-la
    google: ambiente.credenciais
      ? portaGoogle({ clientId: (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim(), clientSecret: (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim(), refreshToken: (env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '').trim(), modo: ambiente.modo, canario: ambiente.canario }, fetch)
      : { token: semRede, enviar: semRede },
    agora: () => new Date().toISOString(),
    // telemetria: só ação, modo, desfecho e ids internos; nunca destinatário, assunto, corpo, token ou chave
    log: (t) => { try { console.log(JSON.stringify({ ...t, destino_api: GMAIL_SEND_URL.split('/')[2] })); } catch { /* ignore */ } },
  };
  const r = await tratarEmailComercial({ authorization: req.headers.get('authorization'), body }, deps);
  return json(r.corpo, r.status);
};

export const config = { path: '/api/email-comercial' };

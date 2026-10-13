// Gestao de usuarios (Cadastros › Usuarios). Toda a regra esta em src/core/usuariosServidor.ts (handler puro, testado);
// aqui so o ambiente: SUPABASE_SERVICE_ROLE_KEY (so no painel do Netlify, nunca VITE_, nunca no navegador ou em log) e o
// endereco do site para onde o link do e-mail leva (EIFF_SITE_URL, senao URL do Netlify, senao eiffcontrol.com.br).
import { tratarUsuarios } from '../../src/core/usuariosServidor';

const SUPABASE_URL_PADRAO = 'https://dduobppgomqyagjviwpx.supabase.co';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ erro: 'metodo' }, 405);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ erro: 'corpo_invalido' }, 400); }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim() || null;
  try {
    const r = await tratarUsuarios({ token, corpo }, fetch, {
      url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? SUPABASE_URL_PADRAO,
      anon: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? req.headers.get('x-supabase-anon') ?? '',
      service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      site: process.env.EIFF_SITE_URL ?? process.env.URL ?? 'https://eiffcontrol.com.br',
    });
    return json(r.corpo, r.status);
  } catch (e) {
    // nunca devolve a chave nem o corpo bruto do Supabase; so a primeira linha da mensagem
    console.error('usuarios', String((e as Error).message ?? e).split('\n')[0].slice(0, 200));
    return json({ erro: 'falha', mensagem: 'Não foi possível concluir. Tente de novo em instantes.' }, 500);
  }
};

export const config = { path: '/api/usuarios' };

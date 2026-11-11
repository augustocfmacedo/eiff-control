// E-mail comercial — partes PURAS do consentimento OAuth (etapa E5). Sem rede, sem disco, sem ambiente.
// Usadas por scripts/email-oauth-consentimento.mjs e testadas em src/core/inbox/emailOauthScript.test.ts.
//
// Fluxo: «código de autorização com PKCE» para aplicativo instalado, com retorno em endereço de loopback
// (http://127.0.0.1:<porta>). É o fluxo que o Google documenta para aplicativos de computador: o navegador volta para
// um servidor que só existe na própria máquina de quem consente, durante alguns minutos.
import { createHash, randomBytes } from 'node:crypto';

export const AUTORIZACAO_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** O ÚNICO escopo pedido: enviar. Nada de leitura, composição ou configuração. (Mesmo valor de ESCOPO_GMAIL no servidor.) */
export const ESCOPO = 'https://www.googleapis.com/auth/gmail.send';
export const REMETENTE_PADRAO = 'contato@eiff.com.br';
export const HOST_LOOPBACK = '127.0.0.1';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Par PKCE e `state` aleatórios. O verificador nunca sai da máquina; o desafio é o seu SHA-256. */
export function novoDesafio(aleatorio = randomBytes) {
  const verificador = b64url(aleatorio(48));
  return { verificador, desafio: b64url(createHash('sha256').update(verificador).digest()), state: b64url(aleatorio(24)) };
}

export const redirectUri = (porta) => `http://${HOST_LOOPBACK}:${porta}`;

/** A URL que a pessoa abre no navegador, logada como a caixa remetente. */
export function urlDeConsentimento({ clientId, porta, desafio, state, conta = REMETENTE_PADRAO }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(porta), response_type: 'code', scope: ESCOPO,
    access_type: 'offline',   // pede o token de atualização
    prompt: 'consent',        // força a tela de consentimento: sem isso o Google pode não devolver token de atualização
    include_granted_scopes: 'false',
    code_challenge: desafio, code_challenge_method: 'S256', state, login_hint: conta,
  });
  return `${AUTORIZACAO_URL}?${q.toString()}`;
}

/** Lê o retorno do Google no loopback. Qualquer coisa fora do esperado é recusa — nunca se troca um código duvidoso. */
export function lerRetorno(urlRecebida, stateEsperado) {
  let u;
  try { u = new URL(urlRecebida, `http://${HOST_LOOPBACK}`); } catch { return { ok: false, motivo: 'retorno ilegível' }; }
  if (u.pathname !== '/') return { ok: false, motivo: 'caminho inesperado', ignorar: true };
  const erro = u.searchParams.get('error');
  if (erro) return { ok: false, motivo: erro === 'access_denied' ? 'consentimento negado na tela do Google' : 'o Google devolveu erro no consentimento' };
  if (u.searchParams.get('state') !== stateEsperado) return { ok: false, motivo: 'state não confere: o retorno não pertence a este pedido' };
  const codigo = u.searchParams.get('code');
  if (!codigo) return { ok: false, motivo: 'retorno sem código de autorização' };
  return { ok: true, codigo };
}

/** Corpo da troca do código pelo token (form-urlencoded). */
export function corpoDaTroca({ clientId, clientSecret, codigo, verificador, porta }) {
  return new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code: codigo, code_verifier: verificador, redirect_uri: redirectUri(porta) }).toString();
}

/**
 * Confere a resposta da troca. Só serve se vier token de atualização E o escopo concedido for EXATAMENTE o de envio.
 * Escopo a mais é recusa: a credencial não pode poder mais do que o sistema precisa.
 */
export function conferirTroca(status, corpo) {
  if (status < 200 || status >= 300 || !corpo || typeof corpo !== 'object') {
    const codigo = corpo && typeof corpo === 'object' && typeof corpo.error === 'string' ? corpo.error : `http ${status}`;
    return { ok: false, motivo: `o Google recusou a troca do código (${codigo})` };
  }
  const escopos = String(corpo.scope ?? '').split(/\s+/).filter(Boolean).sort();
  if (escopos.length !== 1 || escopos[0] !== ESCOPO) {
    return { ok: false, motivo: `escopo concedido diferente do esperado (${escopos.length} escopo(s)); revogue o acesso em myaccount.google.com e refaça pedindo só o envio`, revogar: true };
  }
  if (typeof corpo.refresh_token !== 'string' || corpo.refresh_token === '') {
    return { ok: false, motivo: 'o Google não devolveu token de atualização; revogue o acesso do aplicativo na conta e refaça o consentimento', revogar: true };
  }
  return { ok: true, refreshToken: corpo.refresh_token };
}

/** O que pode ser mostrado de um segredo: tamanho e os 4 últimos caracteres. */
export const resumoDoSegredo = (s) => `${s.length} caracteres, termina em …${s.slice(-4)}`;

/** ID de cliente OAuth do Google tem esta forma; conferir evita colar o segredo no campo errado. */
export const pareceClientId = (s) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(s.trim());

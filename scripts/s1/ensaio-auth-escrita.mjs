// S1/R3B — ENSAIO das rotas de ESCRITA do Auth admin com a chave secreta nova (criar, atualizar, convidar, recuperar),
// SÓ em ambiente DESCARTÁVEL. RECUSA o projeto de produção (dduobppgomqyagjviwpx) por qualquer forma de URL.
// Preparado na R1; EXECUÇÃO exige autorização própria da Direção. O agente não roda; nenhum teste ou CI roda.
//
//   node scripts/s1/ensaio-auth-escrita.mjs --url https://<ref-descartavel>.supabase.co --confirmar ENSAIO_AUTH_DESCARTAVEL
//
// Ambiente aceito: um projeto Supabase hospedado criado só para o ensaio (o mais fiel: mesmo gateway que trata a sb_secret
// em produção) ou a pilha local do Supabase CLI (http://127.0.0.1:54321; menos fiel no gateway). A chave pedida é a
// sb_secret DAQUELE ambiente, com a digitação oculta — nunca a de produção.
//
// O que faz, no formato que o código da R1 usa (B = `apikey` + `Authorization` idêntico); se uma etapa falhar em B, repete
// só aquela etapa em A (só `apikey`) para dizer qual correção fazer:
//   1. criar usuário (POST admin/users, e-mail @example.com, senha aleatória, confirmado)   → usuariosServidor 'criar'
//   2. buscar o usuário (GET admin/users/{id})                                               → 'editar' lê antes
//   3. atualizar senha e metadados (PUT admin/users/{id})                                    → 'definir_senha' / 'editar'
//   4. convidar outro e-mail @example.com (POST invite)                                     → 'convidar' / 'reenviar'
//   5. recuperar senha do usuário criado (POST recover)                                     → 'reenviar' para confirmado
//   6. LIMPEZA: apagar os dois usuários criados (DELETE admin/users/{id}) — o ambiente volta ao que era
// Imprime só etapa, formato, status e código. Os e-mails de convite/recuperação vão para @example.com (não entregáveis).
import { randomBytes } from 'node:crypto';
import { lerOculto } from './entradaOculta.mjs';

const PRODUCAO_REF = 'dduobppgomqyagjviwpx';
const FRASE = 'ENSAIO_AUTH_DESCARTAVEL';
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };

const url = (arg('--url') ?? '').trim().replace(/\/+$/, '');
const recusar = (m) => { console.error(`Recusado: ${m}. Nada foi chamado.`); process.exit(2); };
if (arg('--confirmar') !== FRASE) recusar(`falta --confirmar ${FRASE}`);
let alvo;
try { alvo = new URL(url); } catch { recusar('falta --url válida do ambiente descartável'); }
if (url.toLowerCase().includes(PRODUCAO_REF)) recusar('esta é a URL de PRODUÇÃO; a R3B só roda em ambiente descartável');
const local = alvo.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(alvo.hostname);
const hospedado = alvo.protocol === 'https:' && /^[a-z0-9]{20}\.supabase\.co$/.test(alvo.hostname);
if (!local && !hospedado) recusar('URL tem de ser https://<ref>.supabase.co de um projeto descartável ou a pilha local http://127.0.0.1:54321');
if (alvo.hostname.startsWith(PRODUCAO_REF)) recusar('esta é a URL de PRODUÇÃO');

let chave;
try { chave = (await lerOculto(`Chave sb_secret_ do ambiente DESCARTÁVEL ${alvo.hostname} (oculta) e Enter: `)).trim(); }
catch (e) { recusar(e.message); }
if (!/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(chave)) recusar('não é uma chave sb_secret_');

const cab = (modo) => (modo === 'A' ? { apikey: chave, 'content-type': 'application/json' } : { apikey: chave, authorization: `Bearer ${chave}`, 'content-type': 'application/json' });
const codigoDe = (c) => (c && typeof c === 'object' ? String(c.error_code ?? c.code ?? c.error ?? '') : '');
const chamar = async (modo, metodo, caminho, corpo) => {
  const r = await fetch(`${url}/auth/v1/${caminho}`, { method: metodo, headers: cab(modo), body: corpo ? JSON.stringify(corpo) : undefined });
  let c = null; try { c = await r.json(); } catch { /* corpo vazio */ }
  return { status: r.status, ok: r.ok, c };
};

const sufixo = randomBytes(4).toString('hex');
const emailCriado = `s1-r3b-${sufixo}@example.com`;
const emailConvite = `s1-r3b-convite-${sufixo}@example.com`;
const criados = [];
const linhas = [];
const etapa = async (id, metodo, caminho, corpo) => {
  const b = await chamar('B', metodo, caminho, corpo);
  linhas.push({ id, modo: 'B', status: b.status, codigo: b.ok ? '' : codigoDe(b.c), veredito: b.ok ? 'PASS' : 'FALHOU' });
  if (b.ok) return b;
  const a = await chamar('A', metodo, caminho, corpo);
  linhas.push({ id: `${id} (diagnóstico)`, modo: 'A', status: a.status, codigo: a.ok ? '' : codigoDe(a.c), veredito: a.ok ? 'PASS' : 'FALHOU', informativa: true });
  return a;
};

try {
  const c = await etapa('1_criar', 'POST', 'admin/users', { email: emailCriado, password: randomBytes(18).toString('base64url'), email_confirm: true, user_metadata: { s1_r3b: true } });
  const id = c.c?.id;
  if (id) criados.push(id);
  if (id) {
    await etapa('2_buscar', 'GET', `admin/users/${id}`);
    await etapa('3_atualizar', 'PUT', `admin/users/${id}`, { password: randomBytes(18).toString('base64url'), user_metadata: { s1_r3b: true, trocar_senha: false } });
    await etapa('5_recuperar', 'POST', 'recover', { email: emailCriado });
  }
  const v = await etapa('4_convidar', 'POST', 'invite', { email: emailConvite });
  if (v.c?.id) criados.push(v.c.id);
} catch (e) {
  linhas.push({ id: 'rede', modo: '-', status: 0, codigo: String(e?.message ?? e).replaceAll(chave, '[oculta]').slice(0, 60), veredito: 'FALHOU' });
} finally {
  for (const id of criados) {
    try {
      const d = await chamar('B', 'DELETE', `admin/users/${id}`);
      const d2 = d.ok ? d : await chamar('A', 'DELETE', `admin/users/${id}`);
      linhas.push({ id: '6_limpeza', modo: d.ok ? 'B' : 'A', status: d2.status, codigo: d2.ok ? '' : codigoDe(d2.c), veredito: d2.ok ? 'PASS' : 'FALHOU' });
    } catch { linhas.push({ id: '6_limpeza', modo: '-', status: 0, codigo: 'rede', veredito: 'FALHOU' }); }
  }
  chave = undefined;
}

console.log(`\nambiente: ${local ? 'pilha local' : 'projeto hospedado descartável'} (${alvo.hostname})`);
console.log('etapa                      modo  HTTP  código                       veredito');
for (const l of linhas) console.log(`${l.id.padEnd(26)} ${l.modo.padEnd(5)} ${String(l.status).padEnd(5)} ${(l.codigo || '-').slice(0, 28).padEnd(28)} ${l.veredito}`);
const falhas = linhas.filter((l) => !l.informativa && l.veredito !== 'PASS').length;
const limpo = criados.length > 0 && linhas.filter((l) => l.id === '6_limpeza').every((l) => l.veredito === 'PASS');
console.log(falhas === 0 ? '\nRESULTADO R3B: PASS — criar, buscar, atualizar, convidar e recuperar funcionam com a chave nova no formato do código.' : `\nRESULTADO R3B: FALHOU — ${falhas} etapa(s). As linhas de diagnóstico (formato A) dizem se a correção é mandar só o apikey.`);
if (!limpo) console.log('ATENÇÃO: a limpeza não confirmou a remoção de todos os usuários de ensaio; apague-os no painel do ambiente descartável.');
process.exit(falhas === 0 ? 0 : 1);

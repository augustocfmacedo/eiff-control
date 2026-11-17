// S1/R3B — ENSAIO das rotas de ESCRITA do Auth admin com a chave secreta nova (criar, atualizar, convidar, recuperar), SÓ
// no projeto Supabase DESCARTÁVEL explicitamente autorizado pela Direção. Preparado; EXECUÇÃO exige autorização própria.
// O agente não roda; nenhum teste ou CI roda. Plano completo em docs/s1-chave-servico-supabase.md (R3B).
//
//   node scripts/s1/ensaio-auth-escrita.mjs --ref <ref> --confirmar ENSAIO_AUTH_DESCARTAVEL
//   (opcional, autorização à parte) ... --email-real <endereço do membro da organização> --confirmar-email ENVIAR_DOIS_EMAILS
//
// PORTÕES (todos antes de pedir a chave e antes de qualquer requisição):
//   - REF_AUTORIZADO vazio → recusa. Ele só é preenchido por um commit revisado DEPOIS de a Direção aprovar o projeto criado;
//   - --ref diferente de REF_AUTORIZADO → recusa (aceita SÓ aquele projeto, não "qualquer um que não seja produção");
//   - --ref entre os projetos operacionais da conta → recusa (defesa extra, mesmo que alguém preencha errado a constante);
//   - sem a frase de confirmação → recusa.
// PORTÃO DO PROJETO (depois da chave, antes de qualquer escrita): GET admin/users tem de dar 200 e ZERO usuários. Uma chave
// de outro projeto (inclusive a de produção) dá 401 ali e o ensaio para sem escrever; um projeto com qualquer usuário também.
//
// E-MAIL: o SMTP padrão do Supabase só entrega a membros da equipe da organização; para qualquer outro endereço o Auth
// responde `email_address_not_authorized` e nada é enviado. Modo padrão: convite e recuperação para @example.com, e o
// código `email_address_not_authorized` conta como "porta de administrador atravessada, envio recusado" (nenhum e-mail sai).
// Modo --email-real: convite e recuperação para o endereço informado (membro da equipe), no máximo 2 e-mails, para provar o
// caminho de sucesso com envio.
//
// LIMPEZA CONFERIDA: apaga os usuários criados e, depois, qualquer usuário do projeto com e-mail do ensaio; o PASS exige que
// a listagem final volte a ZERO usuários. Imprime só etapa, formato, status, código e veredito.
import { randomBytes } from 'node:crypto';
import { lerOculto } from './entradaOculta.mjs';

const REF_AUTORIZADO = ''; // preencher por commit revisado, só depois da aprovação do projeto descartável pela Direção
const OPERACIONAIS = ['dduobppgomqyagjviwpx', 'htromxizctbknkwqxuvc', 'cbulkfgkqkuwcckgfwqc', 'wxtozqtxrathmftxacen'];
const FRASE = 'ENSAIO_AUTH_DESCARTAVEL';
const FRASE_EMAIL = 'ENVIAR_DOIS_EMAILS';
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const recusar = (m) => { console.error(`Recusado: ${m}. Nada foi chamado.`); process.exit(2); };

const ref = (arg('--ref') ?? '').trim().toLowerCase();
if (!REF_AUTORIZADO) recusar('nenhum projeto descartável autorizado ainda (REF_AUTORIZADO vazio no script)');
if (OPERACIONAIS.includes(REF_AUTORIZADO) || OPERACIONAIS.includes(ref)) recusar('o projeto é OPERACIONAL; a R3B só roda no descartável');
if (!/^[a-z]{20}$/.test(ref)) recusar('--ref precisa ser o identificador de 20 letras do projeto descartável');
if (ref !== REF_AUTORIZADO) recusar('--ref não é o projeto descartável autorizado');
if (arg('--confirmar') !== FRASE) recusar(`falta --confirmar ${FRASE}`);
const emailReal = arg('--email-real');
if (emailReal !== undefined && (arg('--confirmar-email') !== FRASE_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailReal))) {
  recusar(`--email-real exige um endereço válido e --confirmar-email ${FRASE_EMAIL}`);
}
const URL_ENSAIO = `https://${ref}.supabase.co`;

let chave;
try { chave = (await lerOculto(`Chave sb_secret_ do projeto DESCARTÁVEL ${ref} (oculta) e Enter: `)).trim(); }
catch (e) { recusar(e.message); }
if (!/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(chave)) recusar('não é uma chave sb_secret_');

const cab = (modo) => (modo === 'A' ? { apikey: chave, 'content-type': 'application/json' } : { apikey: chave, authorization: `Bearer ${chave}`, 'content-type': 'application/json' });
const codigoDe = (c) => (c && typeof c === 'object' ? String(c.error_code ?? c.code ?? c.error ?? '') : '');
const chamar = async (modo, metodo, caminho, corpo) => {
  const r = await fetch(`${URL_ENSAIO}/auth/v1/${caminho}`, { method: metodo, headers: cab(modo), body: corpo ? JSON.stringify(corpo) : undefined });
  let c = null; try { c = await r.json(); } catch { /* corpo vazio */ }
  return { status: r.status, ok: r.ok, c };
};
const listar = async () => {
  const r = await chamar('B', 'GET', 'admin/users?per_page=50');
  return { status: r.status, usuarios: Array.isArray(r.c?.users) ? r.c.users : null };
};

const sufixo = randomBytes(4).toString('hex');
const emailCriado = `s1-r3b-${sufixo}@example.com`;
const emailConvite = emailReal ?? `s1-r3b-convite-${sufixo}@example.com`;
const doEnsaio = (u) => typeof u?.email === 'string' && (u.email.startsWith('s1-r3b-') || u.email === emailReal);
const SMTP_RECUSOU = 'email_address_not_authorized';
const linhas = [];
const criados = [];

// Etapa no formato do código (B). Falhou → repete só ela em A, como diagnóstico. `aceitaSmtp`: no modo padrão, a recusa do
// SMTP padrão também prova que a porta de administrador foi atravessada (nada é enviado).
const etapa = async (id, metodo, caminho, corpo, aceitaSmtp = false) => {
  const b = await chamar('B', metodo, caminho, corpo);
  const smtp = aceitaSmtp && codigoDe(b.c) === SMTP_RECUSOU;
  linhas.push({ id, modo: 'B', status: b.status, codigo: b.ok ? '' : codigoDe(b.c), veredito: b.ok ? 'PASS' : smtp ? 'PASS (porta; e-mail não enviado)' : 'FALHOU' });
  if (b.ok || smtp) return b;
  const a = await chamar('A', metodo, caminho, corpo);
  linhas.push({ id: `${id} (diagnóstico)`, modo: 'A', status: a.status, codigo: a.ok ? '' : codigoDe(a.c), veredito: a.ok ? 'PASS' : 'FALHOU', informativa: true });
  return a;
};

let pronto = false;
try {
  // 0 — PORTÃO DO PROJETO: chave deste projeto e projeto vazio, antes de qualquer escrita.
  const antes = await listar();
  pronto = antes.status === 200 && antes.usuarios !== null && antes.usuarios.length === 0;
  linhas.push({ id: '0_projeto_vazio', modo: 'B', status: antes.status, codigo: antes.status === 200 ? `${antes.usuarios?.length ?? '?'} usuário(s)` : '', veredito: pronto ? 'PASS' : 'FALHOU' });
  if (pronto) {
    const c = await etapa('1_criar', 'POST', 'admin/users', { email: emailCriado, password: randomBytes(18).toString('base64url'), email_confirm: true, user_metadata: { s1_r3b: true } });
    if (c.c?.id) criados.push(c.c.id);
    if (c.c?.id) {
      await etapa('2_buscar', 'GET', `admin/users/${c.c.id}`);
      await etapa('3_atualizar', 'PUT', `admin/users/${c.c.id}`, { password: randomBytes(18).toString('base64url'), user_metadata: { s1_r3b: true, trocar_senha: false } });
    }
    const v = await etapa('4_convidar', 'POST', 'invite', { email: emailConvite }, !emailReal);
    if (v.c?.id) criados.push(v.c.id);
    await etapa('5_recuperar', 'POST', 'recover', { email: emailReal ?? emailCriado }, !emailReal);
  }
} catch (e) {
  linhas.push({ id: 'rede', modo: '-', status: 0, codigo: String(e?.message ?? e).replaceAll(chave, '[oculta]').slice(0, 60), veredito: 'FALHOU' });
} finally {
  if (pronto) {
    // 6 — LIMPEZA: os ids criados e, por garantia, qualquer usuário do ensaio que a listagem mostrar.
    try {
      const ids = new Set(criados);
      for (const u of (await listar()).usuarios ?? []) if (doEnsaio(u)) ids.add(u.id);
      for (const id of ids) {
        const d = await chamar('B', 'DELETE', `admin/users/${id}`);
        linhas.push({ id: '6_limpeza', modo: 'B', status: d.status, codigo: d.ok ? '' : codigoDe(d.c), veredito: d.ok ? 'PASS' : 'FALHOU' });
      }
      const depois = await listar();
      const zero = depois.status === 200 && depois.usuarios?.length === 0;
      linhas.push({ id: '7_limpeza_conferida', modo: 'B', status: depois.status, codigo: `${depois.usuarios?.length ?? '?'} usuário(s)`, veredito: zero ? 'PASS' : 'FALHOU' });
    } catch {
      linhas.push({ id: '7_limpeza_conferida', modo: '-', status: 0, codigo: 'rede', veredito: 'FALHOU' });
    }
  }
  chave = undefined;
}

console.log(`\nprojeto descartável: ${ref} · e-mail: ${emailReal ? 'real (membro da equipe), até 2 envios' : 'nenhum envio (@example.com)'}`);
console.log('etapa                         modo  HTTP  código                          veredito');
for (const l of linhas) console.log(`${l.id.padEnd(29)} ${l.modo.padEnd(5)} ${String(l.status).padEnd(5)} ${(l.codigo || '-').slice(0, 31).padEnd(31)} ${l.veredito}`);
const falhas = linhas.filter((l) => !l.informativa && !l.veredito.startsWith('PASS')).length;
const conferida = linhas.some((l) => l.id === '7_limpeza_conferida' && l.veredito === 'PASS');
const ok = pronto && falhas === 0 && conferida;
console.log(ok
  ? '\nRESULTADO R3B: PASS — escritas do Auth admin funcionam com a chave nova no formato do código, e o projeto voltou a zero usuários.'
  : `\nRESULTADO R3B: NO-GO — ${!pronto ? 'portão do projeto não passou (chave de outro projeto ou projeto não vazio); nada foi escrito' : `${falhas} etapa(s) falharam${conferida ? '' : '; limpeza NÃO conferida: apague os usuários no painel do descartável'}`}.`);
process.exit(ok ? 0 : 1);

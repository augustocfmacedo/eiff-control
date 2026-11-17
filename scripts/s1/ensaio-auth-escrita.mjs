// S1/R3B — ENSAIO das rotas de ESCRITA do Auth admin com a chave secreta nova (criar, atualizar, convidar, recuperar), SÓ
// no projeto Supabase DESCARTÁVEL cujo identificador exato a Direção autorizou. EXECUÇÃO exige «EXECUÇÃO R3B AUTORIZADA».
// O agente não roda; nenhum teste ou CI roda. Plano completo em docs/s1-chave-servico-supabase.md (R3B).
//
//   node scripts/s1/ensaio-auth-escrita.mjs --ref <ref> --confirmar ENSAIO_AUTH_DESCARTAVEL
//
// BLOQUEIO POR PADRÃO: REF_AUTORIZADO vazio recusa tudo. Só um commit revisado de autorização o preenche com o identificador
// EXATO do projeto descartável (conferido por metadados: organização descartável, não operacional). O teste de guarda aceita
// a constante vazia OU um identificador de 20 letras fora da lista operacional — nunca outra coisa.
//
// PORTÕES, antes de pedir a chave e de qualquer requisição: constante preenchida; --ref idêntico a ela; nenhum dos dois na
// lista operacional; frase de confirmação. PORTÃO DO PROJETO, depois da chave e antes de qualquer escrita: GET admin/users
// tem de dar 200 com ZERO usuários (a chave de outro projeto, inclusive a de produção, dá 401 e nada é escrito).
//
// ESCRITAS SEM REPETIÇÃO: cada POST/PUT/DELETE é feito UMA vez, só no formato do código (B = apikey + Authorization
// idêntico). Erro de rede/timeout numa escrita NÃO é "nada foi escrito": vira INDETERMINADA, interrompe as escritas
// seguintes e a limpeza conferida procura o que possa ter sido criado. Só as LEITURAS (GET) ganham uma segunda tentativa
// no formato A, para diagnóstico.
//
// TRÊS RESULTADOS por escrita: CONCLUIDA (2xx: a operação aconteceu); PORTA_ACEITA_EMAIL_RECUSADO (o Auth aceitou a chave
// de administrador e o SMTP padrão recusou o destinatário: `email_address_not_authorized`, nada enviado); NAO_HOMOLOGADA
// (qualquer outra resposta) ou INDETERMINADA (sem resposta).
//
// SEM E-MAIL REAL: convite e recuperação só para @example.com (domínio reservado pela RFC 2606, sem caixa de entrada) e o
// SMTP padrão do Supabase só entrega a membros da equipe da organização. Não existe modo de envio real neste script. Se
// convite ou recuperação responderem 2xx (o que indicaria um envio), o resultado é NO-GO com ALERTA.
//
// EXCLUSÃO CONFERIDA: antes de cada DELETE, confere que a requisição vai para o projeto autorizado e relê o usuário pelo id:
// só apaga se o e-mail for do ensaio (s1-r3b-…@example.com) E o metadado s1_r3b for verdadeiro. O PASS exige a listagem
// final com ZERO usuários. Imprime só etapa, formato, status, código e resultado.
import { randomBytes } from 'node:crypto';
import { lerOculto } from './entradaOculta.mjs';

const REF_AUTORIZADO = ''; // preenchido SÓ pelo commit de autorização, com o identificador exato do projeto descartável
const OPERACIONAIS = ['dduobppgomqyagjviwpx', 'htromxizctbknkwqxuvc', 'cbulkfgkqkuwcckgfwqc', 'wxtozqtxrathmftxacen'];
const FRASE = 'ENSAIO_AUTH_DESCARTAVEL';
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const recusar = (m) => { console.error(`Recusado: ${m}. Nada foi chamado.`); process.exit(2); };

const ref = (arg('--ref') ?? '').trim().toLowerCase();
if (!REF_AUTORIZADO) recusar('nenhum projeto descartável autorizado ainda (REF_AUTORIZADO vazio no script)');
if (OPERACIONAIS.includes(REF_AUTORIZADO) || OPERACIONAIS.includes(ref)) recusar('o projeto é OPERACIONAL; a R3B só roda no descartável');
if (!/^[a-z]{20}$/.test(ref)) recusar('--ref precisa ser o identificador de 20 letras do projeto descartável');
if (ref !== REF_AUTORIZADO) recusar('--ref não é o projeto descartável autorizado');
if (arg('--confirmar') !== FRASE) recusar(`falta --confirmar ${FRASE}`);
const HOST = `${REF_AUTORIZADO}.supabase.co`;
const URL_ENSAIO = `https://${HOST}`;

let chave;
try { chave = (await lerOculto(`Chave sb_secret_ do projeto DESCARTÁVEL ${ref} (oculta) e Enter: `)).trim(); }
catch (e) { recusar(e.message); }
if (!/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(chave)) recusar('não é uma chave sb_secret_');

const cab = (modo) => (modo === 'A' ? { apikey: chave, 'content-type': 'application/json' } : { apikey: chave, authorization: `Bearer ${chave}`, 'content-type': 'application/json' });
const codigoDe = (c) => (c && typeof c === 'object' ? String(c.error_code ?? c.code ?? c.error ?? '') : '');
/** Uma requisição, sem repetição. Sem resposta → { status: 0, rede: true }. */
const chamar = async (modo, metodo, caminho, corpo) => {
  const alvo = new URL(`${URL_ENSAIO}/auth/v1/${caminho}`);
  if (alvo.host !== HOST) throw new Error('requisição fora do projeto autorizado');
  try {
    const r = await fetch(alvo, { method: metodo, headers: cab(modo), body: corpo ? JSON.stringify(corpo) : undefined });
    let c = null; try { c = await r.json(); } catch { /* corpo vazio */ }
    return { status: r.status, ok: r.ok, c, rede: false };
  } catch {
    return { status: 0, ok: false, c: null, rede: true };
  }
};
const listar = async () => {
  const r = await chamar('B', 'GET', 'admin/users?per_page=50');
  return { status: r.status, usuarios: Array.isArray(r.c?.users) ? r.c.users : null };
};

const sufixo = randomBytes(4).toString('hex');
const PREFIXO = 's1-r3b-';
const DOMINIO = '@example.com';
const emailCriado = `${PREFIXO}${sufixo}${DOMINIO}`;
const emailConvite = `${PREFIXO}convite-${sufixo}${DOMINIO}`;
const doEnsaio = (u) => typeof u?.email === 'string' && u.email.startsWith(PREFIXO) && u.email.endsWith(DOMINIO);
const SMTP_RECUSOU = 'email_address_not_authorized';
const linhas = [];
const criados = new Set();
let interromper = false;
let alertaEnvio = false;

/** Leitura: formato B; se não passar, uma segunda tentativa em A só para diagnóstico. */
const leitura = async (id, caminho, esperado) => {
  const b = await chamar('B', 'GET', caminho);
  linhas.push({ id, modo: 'B', status: b.status, codigo: b.ok ? '' : codigoDe(b.c), resultado: b.status === esperado ? 'CONCLUIDA' : b.rede ? 'INDETERMINADA' : 'NAO_HOMOLOGADA' });
  if (b.status !== esperado) {
    const a = await chamar('A', 'GET', caminho);
    linhas.push({ id: `${id} (diagnóstico)`, modo: 'A', status: a.status, codigo: a.ok ? '' : codigoDe(a.c), resultado: a.status === esperado ? 'CONCLUIDA' : 'NAO_HOMOLOGADA', informativa: true });
  }
  return b;
};

/** Escrita: UMA vez, formato B, sem repetição. `email`: convite/recuperação, em que 2xx significaria envio. */
const escrita = async (id, metodo, caminho, corpo, email = false) => {
  if (interromper) { linhas.push({ id, modo: 'B', status: '-', codigo: 'não tentada', resultado: 'NAO_HOMOLOGADA' }); return null; }
  const r = await chamar('B', metodo, caminho, corpo);
  let resultado;
  if (r.rede) { resultado = 'INDETERMINADA'; interromper = true; }
  else if (email && r.ok) { resultado = 'CONCLUIDA'; alertaEnvio = true; }
  else if (r.ok) resultado = 'CONCLUIDA';
  else if (email && codigoDe(r.c) === SMTP_RECUSOU) resultado = 'PORTA_ACEITA_EMAIL_RECUSADO';
  else resultado = 'NAO_HOMOLOGADA';
  linhas.push({ id, modo: 'B', status: r.status, codigo: r.ok ? '' : r.rede ? 'sem resposta' : codigoDe(r.c), resultado });
  if (r.c?.id) criados.add(r.c.id);
  return r;
};

/** Exclusão conferida: projeto autorizado + usuário relido pelo id com e-mail e metadado do ensaio. */
const apagarConferido = async (id) => {
  const u = await chamar('B', 'GET', `admin/users/${id}`);
  if (u.status === 404) return; // não existe (convite recusado não cria usuário, por exemplo)
  const ehDoEnsaio = u.ok && doEnsaio(u.c) && u.c?.user_metadata?.s1_r3b === true;
  if (!ehDoEnsaio) { linhas.push({ id: '6_limpeza', modo: 'B', status: u.status, codigo: 'identidade não conferida', resultado: 'NAO_HOMOLOGADA' }); return; }
  const d = await chamar('B', 'DELETE', `admin/users/${id}`);
  linhas.push({ id: '6_limpeza', modo: 'B', status: d.status, codigo: d.ok ? '' : d.rede ? 'sem resposta' : codigoDe(d.c), resultado: d.ok ? 'CONCLUIDA' : d.rede ? 'INDETERMINADA' : 'NAO_HOMOLOGADA' });
};

let pronto = false;
try {
  // 0 — PORTÃO DO PROJETO: chave deste projeto e projeto vazio, antes de qualquer escrita.
  const antes = await listar();
  pronto = antes.status === 200 && antes.usuarios !== null && antes.usuarios.length === 0;
  linhas.push({ id: '0_projeto_vazio', modo: 'B', status: antes.status, codigo: antes.status === 200 ? `${antes.usuarios?.length ?? '?'} usuário(s)` : '', resultado: pronto ? 'CONCLUIDA' : 'NAO_HOMOLOGADA' });
  if (pronto) {
    const c = await escrita('1_criar', 'POST', 'admin/users', { email: emailCriado, password: randomBytes(18).toString('base64url'), email_confirm: true, user_metadata: { s1_r3b: true } });
    const id = c?.ok ? c.c?.id : undefined;
    if (id) {
      await leitura('2_buscar', `admin/users/${id}`, 200);
      await escrita('3_atualizar', 'PUT', `admin/users/${id}`, { password: randomBytes(18).toString('base64url'), user_metadata: { s1_r3b: true, trocar_senha: false } });
    } else {
      linhas.push({ id: '2_buscar', modo: 'B', status: '-', codigo: 'sem usuário criado', resultado: 'NAO_HOMOLOGADA' });
      linhas.push({ id: '3_atualizar', modo: 'B', status: '-', codigo: 'sem usuário criado', resultado: 'NAO_HOMOLOGADA' });
    }
    await escrita('4_convidar', 'POST', 'invite', { email: emailConvite, data: { s1_r3b: true } }, true);
    await escrita('5_recuperar', 'POST', 'recover', { email: emailCriado }, true);
  }
} finally {
  if (pronto) {
    // 6/7 — LIMPEZA CONFERIDA: ids devolvidos + qualquer usuário do ensaio na listagem (cobre escrita INDETERMINADA).
    const ids = new Set(criados);
    for (const u of (await listar()).usuarios ?? []) if (doEnsaio(u)) ids.add(u.id);
    for (const id of ids) await apagarConferido(id);
    const depois = await listar();
    const zero = depois.status === 200 && depois.usuarios?.length === 0;
    linhas.push({ id: '7_limpeza_conferida', modo: 'B', status: depois.status, codigo: `${depois.usuarios?.length ?? '?'} usuário(s)`, resultado: zero ? 'CONCLUIDA' : 'NAO_HOMOLOGADA' });
  }
  chave = undefined;
}

// Critério: etapas 0, 1, 2, 3, 7 CONCLUIDA; 4 e 5 PORTA_ACEITA_EMAIL_RECUSADO; limpezas CONCLUIDA; nenhum alerta de envio.
const ESPERADO = { '0_projeto_vazio': 'CONCLUIDA', '1_criar': 'CONCLUIDA', '2_buscar': 'CONCLUIDA', '3_atualizar': 'CONCLUIDA', '4_convidar': 'PORTA_ACEITA_EMAIL_RECUSADO', '5_recuperar': 'PORTA_ACEITA_EMAIL_RECUSADO', '6_limpeza': 'CONCLUIDA', '7_limpeza_conferida': 'CONCLUIDA' };
const obrigatorias = linhas.filter((l) => !l.informativa);
const falhas = obrigatorias.filter((l) => l.resultado !== ESPERADO[l.id]).length;
const faltando = Object.keys(ESPERADO).filter((k) => k !== '6_limpeza' && !obrigatorias.some((l) => l.id === k)).length;
const ok = pronto && falhas === 0 && faltando === 0 && !alertaEnvio;

console.log(`\nprojeto descartável: ${ref} · e-mail: nenhum envio (@example.com, SMTP padrão)`);
console.log('etapa                        modo  HTTP  código                         resultado');
for (const l of linhas) console.log(`${l.id.padEnd(28)} ${l.modo.padEnd(5)} ${String(l.status).padEnd(5)} ${(l.codigo || '-').slice(0, 30).padEnd(30)} ${l.resultado}`);
if (alertaEnvio) console.log('\nALERTA: convite ou recuperação responderam 2xx — o Auth pode ter tentado enviar e-mail. Pare e avise a Direção.');
console.log(ok
  ? '\nRESULTADO R3B: PASS — criar, buscar e atualizar concluídos; convite e recuperação com a porta de administrador aceita e o e-mail recusado pelo SMTP; projeto de volta a zero usuários.'
  : `\nRESULTADO R3B: NO-GO — ${!pronto ? 'portão do projeto não passou (chave de outro projeto ou projeto não vazio); nada foi escrito' : `${falhas + faltando} etapa(s) fora do esperado${linhas.some((l) => l.id === '7_limpeza_conferida' && l.resultado === 'CONCLUIDA') ? '' : '; limpeza NÃO conferida: não apague nada à mão sem conferir o projeto; avise a Direção'}`}.`);
process.exit(ok ? 0 : 1);

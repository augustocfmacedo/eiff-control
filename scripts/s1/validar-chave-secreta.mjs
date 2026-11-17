// S1/R3 — CONFERE a chave secreta nova (sb_secret_…) contra o projeto SEM PODER ALTERAR NADA e SEM IMPRIMIR A CHAVE.
// Rodado SÓ pelo Augusto, na máquina dele, num terminal interativo. O agente não roda este script; nenhum teste ou CI o roda
// (guarda em src/core/chaveServico.test.ts).
//
//   node scripts/s1/validar-chave-secreta.mjs
//
// A chave é pedida pelo próprio script, com a digitação OCULTA (funciona no Windows PowerShell 5.1 e no 7, sem Read-Host
// -MaskInput, sem variável de ambiente, sem histórico do terminal). Fica só na memória deste processo e some quando ele
// termina. Não há outra forma de entrada: sem terminal interativo, o script recusa.
//
// Por que nada pode ser alterado:
//   - banco: só HEAD e GET. HEAD não lê linhas; GET em /rpc roda numa transação SOMENTE LEITURA do PostgREST e a função
//     chamada (vibe_credits_committed, 0035) é STABLE e só soma — com uma organização inexistente;
//   - Auth admin: leitura (listar 1, buscar um id inexistente) e tentativas que o servidor RECUSA antes de gravar —
//     atualizar um id inexistente (404) e criar/convidar/recuperar com um e-mail SEM @ (400/422 de validação, nenhuma
//     conta criada, nenhum e-mail enviado). Uma linha de CONTROLE com chave falsa mostra que a recusa por validação só
//     acontece depois de a chave ser aceita (com chave falsa: 401/403).
//
// Matriz: cada prova roda nos dois formatos de cabeçalho — A = só `apikey`; B = `apikey` + `Authorization: Bearer` idêntico.
// O código da R1 usa A no banco e B no Auth admin; essas são as linhas OBRIGATÓRIAS. As outras são informativas e dizem
// qual correção fazer se uma obrigatória falhar. Imprime só status HTTP, código de erro e veredito. Sai 0 só se todas as
// obrigatórias passarem.
const URL_PROJETO = 'https://dduobppgomqyagjviwpx.supabase.co';
const SECRETA = /^sb_secret_[A-Za-z0-9_-]{8,}$/;
const ZERO = '00000000-0000-4000-8000-000000000000';
const EMAIL_INVALIDO = 's1-r3-sem-arroba'; // sem @: nenhum servidor de Auth aceita como e-mail

function lerOculto(rotulo) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('sem terminal interativo: rode direto no PowerShell, sem redirecionar a entrada'));
  }
  process.stdout.write(rotulo);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let v = '';
    const fim = (ok) => {
      process.stdin.removeListener('data', ao);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (ok) resolve(v); else reject(new Error('cancelado'));
    };
    const ao = (s) => {
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') return fim(true);
        if (ch === '\u0003' || ch === '\u001b') return fim(false); // Ctrl+C ou Esc
        if (ch === '\b' || ch === '\u007f') { v = v.slice(0, -1); continue; }
        if (ch >= ' ') v += ch;
      }
    };
    process.stdin.on('data', ao);
  });
}

const cab = (chave, modo, extra = {}) => (modo === 'A' ? { apikey: chave, ...extra } : { apikey: chave, authorization: `Bearer ${chave}`, ...extra });
const codigoDe = (c) => (c && typeof c === 'object' ? String(c.error_code ?? c.code ?? c.error ?? '') : '');
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const recusouPorValidacao = (s) => s === 400 || s === 422;

// Cada prova: o que faz, para quais modos é obrigatória, e o predicado de sucesso. Nenhuma devolve dado ao terminal.
const PROVAS = [
  {
    id: 'banco_leitura', obrigatoria: ['A'], desc: 'HEAD organization (conta, sem ler linhas) — RLS ignorada = papel service_role',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/rest/v1/organization?select=id`, { method: 'HEAD', headers: cab(k, m, { prefer: 'count=exact' }) });
      const total = Number((r.headers.get('content-range') ?? '').split('/')[1]);
      return { status: r.status, ok: (r.status === 200 || r.status === 206) && total >= 1, nota: Number.isFinite(total) ? (total >= 1 ? 'contagem ≥ 1' : 'contagem 0 (não é service_role)') : '' };
    },
  },
  {
    id: 'banco_rpc', obrigatoria: ['A'], desc: 'GET rpc vibe_credits_committed (só service_role; STABLE; transação somente leitura)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/rest/v1/rpc/vibe_credits_committed?p_org=${ZERO}&p_since=2026-01-01T00:00:00Z`, { headers: cab(k, m) });
      const c = await json(r);
      return { status: r.status, ok: r.status === 200 && (c === null || typeof c === 'number'), codigo: r.ok ? '' : codigoDe(c) };
    },
  },
  {
    id: 'auth_listar', obrigatoria: ['B'], desc: 'GET admin/users?per_page=1 (leitura)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/admin/users?per_page=1`, { headers: cab(k, m) });
      const c = await json(r);
      return { status: r.status, ok: r.status === 200 && Array.isArray(c?.users), codigo: r.ok ? '' : codigoDe(c) };
    },
  },
  {
    id: 'auth_buscar', obrigatoria: ['B'], desc: 'GET admin/users/<id inexistente> → 404',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/admin/users/${ZERO}`, { headers: cab(k, m) });
      const c = await json(r);
      return { status: r.status, ok: r.status === 404, codigo: codigoDe(c) };
    },
  },
  {
    id: 'auth_atualizar', obrigatoria: ['B'], desc: 'PUT admin/users/<id inexistente> → 404 (nada a atualizar)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/admin/users/${ZERO}`, { method: 'PUT', headers: cab(k, m, { 'content-type': 'application/json' }), body: JSON.stringify({ user_metadata: { s1_r3: true } }) });
      const c = await json(r);
      return { status: r.status, ok: r.status === 404, codigo: codigoDe(c) };
    },
  },
  {
    id: 'auth_criar', obrigatoria: ['B'], desc: 'POST admin/users com e-mail sem @ → recusa de validação (nada criado)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/admin/users`, { method: 'POST', headers: cab(k, m, { 'content-type': 'application/json' }), body: JSON.stringify({ email: EMAIL_INVALIDO, password: 's1-r3-nao-usada', email_confirm: false }) });
      const c = await json(r);
      return { status: r.status, ok: recusouPorValidacao(r.status), codigo: codigoDe(c), alerta: r.ok };
    },
  },
  {
    id: 'auth_convidar', obrigatoria: ['B'], desc: 'POST invite com e-mail sem @ → recusa de validação (nenhum e-mail)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/invite`, { method: 'POST', headers: cab(k, m, { 'content-type': 'application/json' }), body: JSON.stringify({ email: EMAIL_INVALIDO }) });
      const c = await json(r);
      return { status: r.status, ok: recusouPorValidacao(r.status), codigo: codigoDe(c), alerta: r.ok };
    },
  },
  {
    id: 'auth_recuperar', obrigatoria: ['B'], desc: 'POST recover com e-mail sem @ → recusa de validação (nenhum e-mail)',
    rodar: async (k, m) => {
      const r = await fetch(`${URL_PROJETO}/auth/v1/recover`, { method: 'POST', headers: cab(k, m, { 'content-type': 'application/json' }), body: JSON.stringify({ email: EMAIL_INVALIDO }) });
      const c = await json(r);
      return { status: r.status, ok: recusouPorValidacao(r.status), codigo: codigoDe(c), alerta: r.ok };
    },
  },
];

// Controle: com uma chave FALSA, as rotas de escrita do Auth admin têm de recusar por credencial (401/403), não por
// validação — senão um 400 nas provas acima não provaria nada.
async function controle() {
  const falsa = 'sb_secret_CONTROLE0000000000000000000000';
  const linhas = [];
  for (const [id, caminho, metodo] of [['controle_criar', 'admin/users', 'POST'], ['controle_convidar', 'invite', 'POST']]) {
    const r = await fetch(`${URL_PROJETO}/auth/v1/${caminho}`, { method: metodo, headers: cab(falsa, 'B', { 'content-type': 'application/json' }), body: JSON.stringify({ email: EMAIL_INVALIDO }) });
    const c = await json(r);
    linhas.push({ id, modo: 'B', status: r.status, codigo: codigoDe(c), veredito: r.status === 401 || r.status === 403 ? 'PASS' : 'FALHOU', obrigatoria: true });
  }
  return linhas;
}

let chave;
try {
  chave = (await lerOculto('Cole a chave sb_secret_ (não aparece na tela) e tecle Enter: ')).trim();
} catch (e) {
  console.error(`Recusado: ${e.message}. Nada foi chamado.`);
  process.exit(2);
}
if (!SECRETA.test(chave)) {
  console.error('Recusado: não é uma chave sb_secret_ (a publicável e a legada não servem aqui). Nada foi chamado.');
  process.exit(2);
}

const linhas = [];
let alertas = 0;
try {
  for (const p of PROVAS) {
    for (const modo of ['A', 'B']) {
      const r = await p.rodar(chave, modo);
      if (r.alerta) alertas++;
      linhas.push({ id: p.id, modo, status: r.status, codigo: r.codigo ?? '', nota: r.nota ?? '', veredito: r.ok ? 'PASS' : 'FALHOU', obrigatoria: p.obrigatoria.includes(modo) });
    }
  }
  linhas.push(...(await controle()));
} catch (e) {
  console.error(`Falha de rede: ${String(e?.message ?? e).replaceAll(chave, '[chave]').slice(0, 160)}`);
  process.exit(1);
} finally {
  chave = undefined;
}

console.log('\nprova              modo  obrig.  HTTP  código                       veredito');
for (const l of linhas) {
  console.log(`${l.id.padEnd(18)} ${l.modo.padEnd(5)} ${(l.obrigatoria ? 'sim' : 'não').padEnd(7)} ${String(l.status).padEnd(5)} ${(l.codigo || l.nota || '-').slice(0, 28).padEnd(28)} ${l.veredito}`);
}
const falhasObrig = linhas.filter((l) => l.obrigatoria && l.veredito !== 'PASS');
if (alertas) console.log(`\nALERTA: ${alertas} rota(s) de escrita aceitaram um e-mail sem @. Pare e avise a Direção.`);
console.log(falhasObrig.length === 0 && !alertas
  ? '\nRESULTADO: PASS — a chave nova funciona nos formatos que o código da R1 usa.'
  : `\nRESULTADO: FALHOU — ${falhasObrig.length} prova(s) obrigatória(s). Copie a tabela acima (ela não contém a chave).`);
process.exit(falhasObrig.length === 0 && !alertas ? 0 : 1);

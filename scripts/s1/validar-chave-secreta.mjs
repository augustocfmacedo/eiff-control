// S1/R3A — CONFERE a chave secreta nova (sb_secret_…) contra o projeto de PRODUÇÃO SÓ COM HEAD E GET.
// Nenhuma requisição deste script usa POST, PUT, PATCH ou DELETE (guarda em src/core/chaveServico.test.ts).
// Rodado SÓ pelo Augusto, na máquina dele, num terminal interativo. O agente não roda este script; nenhum teste ou CI o roda.
//
//   node scripts/s1/validar-chave-secreta.mjs
//
// A chave é pedida pelo próprio script com a digitação OCULTA (Windows PowerShell 5.1 e 7; sem Read-Host -MaskInput, sem
// variável de ambiente, sem histórico do terminal). Fica só na memória deste processo. Sem terminal interativo, recusa.
//
// Banco: HEAD não lê linhas; GET em /rpc roda numa transação SOMENTE LEITURA do PostgREST, e a função chamada
// (vibe_credits_committed, 0035) é STABLE, só soma, e recebe uma organização inexistente.
// Auth admin: só leituras (listar 1, buscar um id inexistente). As rotas de escrita (criar, atualizar, convidar, recuperar)
// ficam para a R3B, em projeto descartável (scripts/s1/ensaio-auth-escrita.mjs), nunca em produção.
//
// Matriz: cada prova roda nos dois formatos — A = só `apikey`; B = `apikey` + `Authorization: Bearer` idêntico. O código da
// R1 usa A no banco e B no Auth admin: essas linhas são OBRIGATÓRIAS; as outras dizem qual correção fazer se uma falhar.
// Controle: as mesmas leituras com uma chave FALSA têm de ser recusadas (401/403). Imprime só status, código e veredito.
import { lerOculto } from './entradaOculta.mjs';

const URL_PROJETO = 'https://dduobppgomqyagjviwpx.supabase.co';
const SECRETA = /^sb_secret_[A-Za-z0-9_-]{8,}$/;
const ZERO = '00000000-0000-4000-8000-000000000000';
const FALSA = 'sb_secret_CONTROLE0000000000000000000000';

const cab = (chave, modo, extra = {}) => (modo === 'A' ? { apikey: chave, ...extra } : { apikey: chave, authorization: `Bearer ${chave}`, ...extra });
const codigoDe = (c) => (c && typeof c === 'object' ? String(c.error_code ?? c.code ?? c.error ?? '') : '');
const json = async (r) => { try { return await r.json(); } catch { return null; } };
// ÚNICA função que faz requisição: só HEAD ou GET, por construção.
const ler = (caminho, headers, metodo = 'GET') => {
  if (metodo !== 'GET' && metodo !== 'HEAD') throw new Error('R3A só faz HEAD e GET');
  return fetch(`${URL_PROJETO}${caminho}`, { method: metodo, headers });
};

const PROVAS = [
  {
    id: 'banco_leitura', obrigatoria: ['A'],
    rodar: async (k, m) => {
      const r = await ler('/rest/v1/organization?select=id', cab(k, m, { prefer: 'count=exact' }), 'HEAD');
      const total = Number((r.headers.get('content-range') ?? '').split('/')[1]);
      return { status: r.status, ok: (r.status === 200 || r.status === 206) && total >= 1, nota: Number.isFinite(total) ? (total >= 1 ? 'contagem >= 1' : 'contagem 0') : '' };
    },
  },
  {
    id: 'banco_rpc', obrigatoria: ['A'],
    rodar: async (k, m) => {
      const r = await ler(`/rest/v1/rpc/vibe_credits_committed?p_org=${ZERO}&p_since=2026-01-01T00:00:00Z`, cab(k, m));
      const c = await json(r);
      return { status: r.status, ok: r.status === 200 && (c === null || typeof c === 'number'), codigo: r.ok ? '' : codigoDe(c) };
    },
  },
  {
    id: 'auth_listar', obrigatoria: ['B'],
    rodar: async (k, m) => {
      const r = await ler('/auth/v1/admin/users?per_page=1', cab(k, m));
      const c = await json(r);
      return { status: r.status, ok: r.status === 200 && Array.isArray(c?.users), codigo: r.ok ? '' : codigoDe(c) };
    },
  },
  {
    id: 'auth_buscar', obrigatoria: ['B'],
    rodar: async (k, m) => {
      const r = await ler(`/auth/v1/admin/users/${ZERO}`, cab(k, m));
      return { status: r.status, ok: r.status === 404, codigo: codigoDe(await json(r)) };
    },
  },
];

// Controle: com chave falsa, cada leitura tem de ser recusada por credencial — senão um 200/404 acima não provaria nada.
const CONTROLES = [
  ['controle_banco', '/rest/v1/organization?select=id', 'A'],
  ['controle_auth', '/auth/v1/admin/users?per_page=1', 'B'],
];

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
try {
  for (const p of PROVAS) {
    for (const modo of ['A', 'B']) {
      const r = await p.rodar(chave, modo);
      linhas.push({ id: p.id, modo, status: r.status, codigo: r.codigo ?? '', nota: r.nota ?? '', veredito: r.ok ? 'PASS' : 'FALHOU', obrigatoria: p.obrigatoria.includes(modo) });
    }
  }
  for (const [id, caminho, modo] of CONTROLES) {
    const r = await ler(caminho, cab(FALSA, modo));
    linhas.push({ id, modo, status: r.status, codigo: codigoDe(await json(r)), nota: '', veredito: r.status === 401 || r.status === 403 ? 'PASS' : 'FALHOU', obrigatoria: true });
  }
} catch (e) {
  console.error(`Falha de rede: ${String(e?.message ?? e).replaceAll(chave, '[oculta]').slice(0, 160)}`);
  process.exit(1);
} finally {
  chave = undefined;
}

console.log('\nprova            modo  obrig.  HTTP  código / nota                veredito');
for (const l of linhas) {
  console.log(`${l.id.padEnd(16)} ${l.modo.padEnd(5)} ${(l.obrigatoria ? 'sim' : 'não').padEnd(7)} ${String(l.status).padEnd(5)} ${(l.codigo || l.nota || '-').slice(0, 28).padEnd(28)} ${l.veredito}`);
}
const falhas = linhas.filter((l) => l.obrigatoria && l.veredito !== 'PASS').length;
console.log(falhas === 0
  ? '\nRESULTADO R3A: PASS — a chave nova lê o banco e o Auth admin nos formatos que o código da R1 usa.'
  : `\nRESULTADO R3A: FALHOU — ${falhas} prova(s) obrigatória(s). Copie a tabela acima (ela não contém a chave).`);
process.exit(falhas === 0 ? 0 : 1);

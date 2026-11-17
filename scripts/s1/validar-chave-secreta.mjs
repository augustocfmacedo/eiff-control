// S1/R3 — VALIDA a chave secreta nova (sb_secret_…) contra o projeto, SEM GRAVAR NADA e SEM IMPRIMIR A CHAVE.
// Rodado SÓ pelo Augusto, na máquina dele. A chave é lida da variável de ambiente EIFF_SB_SECRET da sessão do terminal
// (digitada por ele, nunca colada no chat, nunca gravada em arquivo). O agente não roda este script.
//
//   PowerShell:  $env:EIFF_SB_SECRET = Read-Host -MaskInput 'sb_secret'; node scripts/s1/validar-chave-secreta.mjs; Remove-Item Env:EIFF_SB_SECRET
//
// Três provas, todas de leitura ou de recusa:
//   1. banco (PostgREST) só com `apikey`: lê 1 id de `organization` → 200;
//   2. RPC só de service_role (0075): inbox_email_delivery_transition com uma entrega que não existe → `entrega_nao_encontrada`
//      (prova que a chave chega ao banco como service_role; não muda nada);
//   3. Auth admin com `apikey` + `Authorization` idêntico (o caminho do supabase-js): lista 1 usuário → 200.
// Imprime só status HTTP e códigos. Sai com 1 se qualquer prova falhar.
const URL_PROJETO = 'https://dduobppgomqyagjviwpx.supabase.co';
const chave = (process.env.EIFF_SB_SECRET ?? '').trim();
if (!/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(chave)) {
  console.error('Recusado: EIFF_SB_SECRET ausente ou não é uma chave sb_secret_. Nada foi chamado.');
  process.exit(2);
}

const resultado = {};
let falhas = 0;
const marca = (k, ok, det) => { resultado[k] = `${ok ? 'PASS' : 'FALHOU'} — ${det}`; if (!ok) falhas++; };

try {
  const r1 = await fetch(`${URL_PROJETO}/rest/v1/organization?select=id&limit=1`, { headers: { apikey: chave, accept: 'application/json' } });
  const c1 = await r1.json().catch(() => null);
  marca('1_banco_so_apikey', r1.status === 200 && Array.isArray(c1), `HTTP ${r1.status}, ${Array.isArray(c1) ? c1.length + ' linha(s)' : 'resposta inesperada'}`);

  const r2 = await fetch(`${URL_PROJETO}/rest/v1/rpc/inbox_email_delivery_transition`, {
    method: 'POST', headers: { apikey: chave, 'content-type': 'application/json' },
    body: JSON.stringify({ p_delivery_id: '00000000-0000-4000-8000-000000000000', p_to: 'FAILED', p_actor: null, p_reason: 'mensagem_invalida', p_provider_message_id: null, p_provider_thread_id: null }),
  });
  const c2 = await r2.json().catch(() => null);
  marca('2_rpc_service_role', r2.status === 200 && c2?.erro === 'entrega_nao_encontrada', `HTTP ${r2.status}, erro=${c2?.erro ?? c2?.code ?? '?'}`);

  const r3 = await fetch(`${URL_PROJETO}/auth/v1/admin/users?per_page=1`, { headers: { apikey: chave, authorization: `Bearer ${chave}` } });
  const c3 = await r3.json().catch(() => null);
  marca('3_auth_admin', r3.status === 200 && Array.isArray(c3?.users), `HTTP ${r3.status}`);
} catch (e) {
  marca('rede', false, String(e?.message ?? e).slice(0, 120));
}
console.log(JSON.stringify({ resultado, resumo: falhas === 0 ? 'PASS: a chave nova funciona nos três caminhos' : `FALHOU: ${falhas}` }, null, 2));
process.exit(falhas === 0 ? 0 : 1);

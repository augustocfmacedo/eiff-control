// Executa SQL no projeto Supabase pela Management API, sem depender da CLI.
// Uso:
//   node scripts/db-query.mjs supabase/migrations/0007_x.sql      # executa um arquivo
//   node scripts/db-query.mjs --sql "select count(*) from project" # executa um comando
//
// Credencial: variavel SUPABASE_ACCESS_TOKEN (Personal Access Token criado em
// https://supabase.com/dashboard/account/tokens). Coloque-a em .env.local (ignorado pelo git):
//   SUPABASE_ACCESS_TOKEN=sbp_...
// O token nunca e impresso por este script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'dduobppgomqyagjviwpx';

function carregarEnvLocal() {
  const f = path.join(root, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const linha of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnvLocal();

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN nao definido. Crie um Personal Access Token em https://supabase.com/dashboard/account/tokens e salve em .env.local');
  process.exit(2);
}

const args = process.argv.slice(2);
let sql;
if (args[0] === '--sql') sql = args.slice(1).join(' ');
else if (args[0]) sql = fs.readFileSync(path.resolve(root, args[0]), 'utf8');
else { console.error('Informe um arquivo .sql ou --sql "comando"'); process.exit(2); }

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const texto = await r.text();
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${texto.slice(0, 2000)}`);
  process.exit(1);
}
try {
  const dados = JSON.parse(texto);
  console.log(Array.isArray(dados) ? JSON.stringify(dados.slice(0, 200), null, 1) : texto);
} catch {
  console.log(texto.slice(0, 4000));
}

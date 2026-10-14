// Banco descartável com a FILA INTEIRA de migrations (PGlite em memória): o prelúdio que imita o Supabase (papéis anon /
// authenticated / service_role, schema auth com auth.uid() lendo `test.uid` ou o JWT, storage mínimo), a mesma correção
// histórica de ordem do preflight (0015 antes da 0014) e a semente depois da 0013. Usado pelo smoke da 0070
// (scripts/pg-smoke-desfechos.mjs) e pelo teste de integração app → banco (src/data/radar.desfechos.integracao.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const PRELUDIO = `
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $prel$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('test.uid', true), '')::uuid,
                  nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid) $fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user) $fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
`;

const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] };
const SEMENTE = '0013';

/**
 * Cria o PGlite (com `parsers` opcionais por OID de tipo) e aplica a fila de `raiz/supabase/migrations` (cada migration numa transação). `antesDe(numero)` roda
 * antes de cada migration (ex.: tirar um retrato do schema antes da 0070). Devolve { db, aplicadas }.
 */
export async function bancoComFila(raiz, { antesDe, parsers } = {}) {
  const pastaMigrations = path.join(raiz, 'supabase', 'migrations');
  // parsers: ex. devolver timestamptz como texto ISO com microssegundos, como o PostgREST
  const db = new PGlite({ extensions: { pgcrypto }, ...(parsers ? { parsers } : {}) });
  await db.exec(PRELUDIO);
  const arquivos = fs.readdirSync(pastaMigrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const feitas = new Set();
  const aplicar = async (arq) => {
    await db.exec('begin;');
    try { await db.exec(fs.readFileSync(path.join(pastaMigrations, arq), 'utf8')); await db.exec('commit;'); feitas.add(arq); }
    catch (e) { try { await db.exec('rollback;'); } catch { /* abortada */ } throw new Error(`${arq}: ${String(e?.message ?? e).split('\n')[0]}`); }
  };
  for (const arq of arquivos) {
    const n = arq.slice(0, 4);
    if (antesDe) await antesDe(n, db);
    for (const a of ORDEM_CORRIGIDA[n] ?? []) if (!feitas.has(a)) await aplicar(a);
    if (!feitas.has(arq)) await aplicar(arq);
    if (n === SEMENTE) { await db.exec('begin;'); await db.exec(fs.readFileSync(path.join(raiz, 'supabase', 'seed.sql'), 'utf8')); await db.exec('commit;'); }
  }
  return { db, aplicadas: [...feitas], ultima: arquivos[arquivos.length - 1] };
}

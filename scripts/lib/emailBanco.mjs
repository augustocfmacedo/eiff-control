// Banco DESCARTAVEL do e-mail comercial (PGlite em memoria): o preludio que imita o minimo do Supabase, as migrations
// 0056 + 0057 + 0075 e a semente ficticia. Compartilhado pelo smoke (scripts/pg-smoke-email.mjs) e pela prova ponta a
// ponta do handler (src/core/inbox/emailPorta.integracao.test.ts). Nada aqui toca banco real.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

export const RAIZ = new URL('../../supabase/migrations/', import.meta.url);
export const ler = (f) => fs.readFileSync(new URL(f, RAIZ), 'utf8');
export const SQL_0056 = ler('0056_inbox.sql');
export const SQL_0057 = ler('0057_inbox_octopus_router.sql');
export const SQL_0075 = ler('0075_inbox_email_delivery.sql');

export const ORG_A = '11111111-1111-1111-1111-111111111111';
export const ORG_B = '22222222-2222-2222-2222-222222222222';
export const ADM_A = 'aaaaaaaa-0000-0000-0000-000000000000'; // Administrador
export const DIR_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // Diretoria: transversal
export const FIN_A = 'aaaaaaaa-0000-0000-0000-000000000002'; // Financeiro: tem `inbox`, NAO tem `enviar_email`
export const ENG_A = 'aaaaaaaa-0000-0000-0000-000000000003'; // Engenharia: membro de OBRAS
export const INA_A = 'aaaaaaaa-0000-0000-0000-000000000005'; // Administrador INATIVO
export const ADM_B = 'bbbbbbbb-0000-0000-0000-000000000001'; // outra organizacao
export const SETOR_FIN = 'cccccccc-0000-0000-0000-000000000001';
export const SETOR_OBRAS = 'cccccccc-0000-0000-0000-000000000002';
export const FP = 'a'.repeat(64);
export const FP2 = 'b'.repeat(64);
export const uuid = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const PRELUDIO = `
create schema if not exists auth;
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $prel$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');
create table organization (id uuid primary key default gen_random_uuid(), name text not null);
create table profile (id uuid primary key, organization_id uuid not null references organization(id), name text not null, email text not null, role role_kind not null, active boolean not null default true);
create table company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text);
create table project (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), code text not null);
create table worker (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null);
create table radar_company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), legal_name text);
create table radar_contact (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), full_name text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
create or replace function current_org() returns uuid language sql stable security definer as $fn$ select organization_id from profile where id = auth.uid() and active $fn$;
create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $fn$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles)) $fn$;
create or replace function touch_updated_at() returns trigger language plpgsql as $fn$
begin new.updated_at := now(); new.version := coalesce(old.version, 0) + 1; return new; end $fn$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select on profile to authenticated;
`;
export const SEMENTE = `
insert into organization (id, name) values ('${ORG_A}', 'EIFF'), ('${ORG_B}', 'Outra');
insert into profile (id, organization_id, name, email, role, active) values
  ('${ADM_A}', '${ORG_A}', 'Augusto Macedo', 'adm@eiff', 'Administrador', true),
  ('${DIR_A}', '${ORG_A}', 'Diretora', 'd@eiff', 'Diretoria', true),
  ('${FIN_A}', '${ORG_A}', 'Financeiro', 'f@eiff', 'Financeiro', true),
  ('${ENG_A}', '${ORG_A}', 'Engenheiro', 'e@eiff', 'Engenharia', true),
  ('${INA_A}', '${ORG_A}', 'Ex-administrador', 'x@eiff', 'Administrador', false),
  ('${ADM_B}', '${ORG_B}', 'Estranho', 'x@outra', 'Administrador', true);
insert into inbox_sector (id, organization_id, code, name, sort_order) values
  ('${SETOR_FIN}', '${ORG_A}', 'FINANCEIRO', 'Financeiro', 1),
  ('${SETOR_OBRAS}', '${ORG_A}', 'OBRAS', 'Obras', 2);
insert into inbox_member (organization_id, profile_id, sector_id, member_role) values
  ('${ORG_A}', '${FIN_A}', '${SETOR_FIN}', 'gestor'),
  ('${ORG_A}', '${ENG_A}', '${SETOR_OBRAS}', 'atendente');
insert into inbox_config (organization_id) values ('${ORG_A}');
`;


/** PGlite novo com as migrations aplicadas (a 0075 duas vezes: prova de idempotencia). Sem semente. */
export async function bancoDoEmail() {
  const db = new PGlite();
  await db.exec(PRELUDIO);
  await db.exec(SQL_0056);
  await db.exec(SQL_0057);
  await db.exec(SQL_0075);
  await db.exec(SQL_0075);
  return db;
}

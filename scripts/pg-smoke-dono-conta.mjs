// Smoke test da migration 0063 (CD-D5 — dono da conta) contra um PostgreSQL DE VERDADE.
//
// Por que existe: teste de TypeScript prova o que o app MANDA; só o banco prova o que ele ACEITA. A regra do dono
// (perfil ativo e da mesma organização, validada só quando o dono muda) vive num trigger, então a prova é aqui.
//
// Como rodar:
//   node scripts/pg-smoke-dono-conta.mjs        (ou npm run smoke:dono-conta)
//
// O @electric-sql/pglite é devDependency FIXADA. O banco é criado em memória, roda dentro de BEGIN ... ROLLBACK e
// morre com o processo. NADA toca produção, não há conexão de rede.
//
// O prelúdio recria só o que a 0063 assume do resto do schema: organization, profile, audit_log com o audit_row()
// de produção (linha inteira antes/depois + auth.uid()) e a radar_company com as colunas que a regra usa. Não é o
// banco real; é o suficiente para provar FK, trigger, auditoria e a gravação da mescla.
//
// Cada asserção roda dentro de um SAVEPOINT: no Postgres, um comando que falha aborta a transação inteira (25P02).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL_0063 = readFileSync('supabase/migrations/0063_radar_company_owner.sql', 'utf8');

const PRELUDIO = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table organization (id uuid primary key default gen_random_uuid(), code text);
create table profile (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  active boolean not null default true
);
create table audit_log (
  id bigserial primary key,
  organization_id uuid,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  source text
);
-- audit_row() como está em produção (pg_get_functiondef em 01/10/2026)
create or replace function audit_row() returns trigger language plpgsql security definer as $fn$
declare v_before jsonb; v_after jsonb; v_org uuid; v_id text;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_org := coalesce((v_after ->> 'organization_id')::uuid, (v_before ->> 'organization_id')::uuid);
  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');
  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, source)
  values (v_org, auth.uid(), tg_op, tg_table_name, v_id, v_before, v_after, 'db');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create table radar_company (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  legal_name text not null,
  active boolean not null default true,
  merged_into uuid references radar_company(id)
);
create trigger radar_company_audit after insert or update on radar_company for each row execute function audit_row();
`;

const db = new PGlite();
let ok = 0;
let falhou = 0;
let sp = 0;

const passou = (nome) => { ok++; console.log('  ok    ' + nome); };
const quebrou = (nome, detalhe) => { falhou++; console.log('  FALHA ' + nome + '\n        ' + detalhe); };

async function emSavepoint(fn) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try {
    const r = await fn();
    await db.exec('release savepoint ' + nome);
    return { ok: true, r };
  } catch (e) {
    await db.exec('rollback to savepoint ' + nome);
    return { ok: false, e };
  }
}

/** Espera que o comando seja ACEITO. */
async function aceita(nome, sql, params = []) {
  const x = await emSavepoint(() => db.query(sql, params));
  if (x.ok) passou(nome);
  else quebrou(nome, 'recusado: ' + x.e.message);
}

/** Espera que o comando seja RECUSADO, e que a mensagem cite `pedaco`. */
async function recusa(nome, sql, params, pedaco) {
  const x = await emSavepoint(() => db.query(sql, params));
  if (x.ok) { quebrou(nome, 'o banco ACEITOU — a regra nao esta valendo'); return; }
  const msg = String(x.e.message).toLowerCase();
  if (pedaco && !msg.includes(pedaco.toLowerCase())) quebrou(nome, 'recusou pelo motivo errado: ' + x.e.message);
  else passou(nome);
}

/** Confere um valor lido do banco. */
function igual(nome, obtido, esperado) {
  if (obtido === esperado) passou(nome);
  else quebrou(nome, `esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
}

async function main() {
  console.log('CD-D5 · smoke da migration 0063 em PostgreSQL descartavel (PGlite)\n');
  await db.exec(PRELUDIO);
  await db.exec(SQL_0063);
  console.log('  preludio + 0063 aplicadas\n');

  await db.exec('begin');
  const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.id;
  const valor = async (sql, params = []) => { const r = (await db.query(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; };

  const org = await um("insert into organization (code) values ('EIFF') returning id");
  const outraOrg = await um("insert into organization (code) values ('OUTRA') returning id");
  const ana = await um("insert into profile (organization_id, name) values ($1,'Ana') returning id", [org]);
  const beto = await um("insert into profile (organization_id, name) values ($1,'Beto') returning id", [org]);
  const inativo = await um("insert into profile (organization_id, name, active) values ($1,'Ivo',false) returning id", [org]);
  const deFora = await um("insert into profile (organization_id, name) values ($1,'Fora') returning id", [outraOrg]);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ana]); // autor das gravações abaixo

  console.log('estrutura');
  igual('coluna commercial_owner_id existe e é uuid', await valor("select data_type from information_schema.columns where table_name='radar_company' and column_name='commercial_owner_id'"), 'uuid');
  igual('FK de commercial_owner_id aponta para profile', await valor(`select confrelid::regclass::text from pg_constraint where conrelid='radar_company'::regclass and contype='f' and conkey = array[(select attnum from pg_attribute where attrelid='radar_company'::regclass and attname='commercial_owner_id')]::smallint[]`), 'profile');
  igual('índice parcial por organização e dono', await valor("select count(*)::int from pg_indexes where tablename='radar_company' and indexname='radar_company_commercial_owner_idx'"), 1);

  console.log('\nconta nova');
  const conta = await um("insert into radar_company (organization_id, legal_name) values ($1,'Conta A') returning id", [org]);
  igual('conta nova nasce SEM_DONO (commercial_owner_id nulo)', await valor('select commercial_owner_id from radar_company where id=$1', [conta]), null);
  await recusa('inserir já com dono de outra organização é recusado', "insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1,'Conta X',$2)", [org, deFora], 'dono comercial inválido');
  await aceita('inserir já com dono ativo da mesma organização é aceito', "insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1,'Conta Y',$2)", [org, beto]);

  console.log('\ndefinir, trocar e remover dono');
  await recusa('perfil inexistente é recusado', 'update radar_company set commercial_owner_id = gen_random_uuid() where id=$1', [conta], 'dono comercial inválido');
  await recusa('usuário inativo é recusado', 'update radar_company set commercial_owner_id=$2 where id=$1', [conta, inativo], 'dono comercial inválido');
  await recusa('usuário de outra organização é recusado', 'update radar_company set commercial_owner_id=$2 where id=$1', [conta, deFora], 'dono comercial inválido');
  await aceita('usuário ativo da mesma organização é aceito', 'update radar_company set commercial_owner_id=$2 where id=$1', [conta, ana]);
  igual('o dono gravado é o usuário escolhido', await valor('select commercial_owner_id from radar_company where id=$1', [conta]), ana);
  await aceita('trocar para outro usuário ativo da mesma organização é aceito', 'update radar_company set commercial_owner_id=$2 where id=$1', [conta, beto]);
  await aceita('remover o dono (null) é aceito', 'update radar_company set commercial_owner_id=null where id=$1', [conta]);
  igual('depois de remover, a conta volta a SEM_DONO', await valor('select commercial_owner_id from radar_company where id=$1', [conta]), null);
  await recusa('mover a conta para outra organização com o dono antigo é recusado', 'update radar_company set organization_id=$2, commercial_owner_id=$3 where id=$1', [conta, outraOrg, ana], 'dono comercial inválido');

  console.log('\nauditoria (audit_row existente)');
  await db.query('update radar_company set commercial_owner_id=$2 where id=$1', [conta, ana]);
  const ev = (await db.query(`select actor_id, before_data->>'commercial_owner_id' as antes, after_data->>'commercial_owner_id' as depois from audit_log
    where entity_type='radar_company' and entity_id=$1::text and action='UPDATE' order by id desc limit 1`, [conta])).rows[0];
  igual('auditoria guarda o dono anterior (SEM_DONO)', ev?.antes ?? null, null);
  igual('auditoria guarda o dono novo', ev?.depois, ana);
  igual('auditoria guarda o autor da mudança', ev?.actor_id, ana);
  await db.query('update radar_company set commercial_owner_id=$2 where id=$1', [conta, beto]);
  const troca = (await db.query(`select before_data->>'commercial_owner_id' as antes, after_data->>'commercial_owner_id' as depois from audit_log
    where entity_type='radar_company' and entity_id=$1::text and action='UPDATE' order by id desc limit 1`, [conta])).rows[0];
  igual('troca de dono reconstruível: antes', troca?.antes, ana);
  igual('troca de dono reconstruível: depois', troca?.depois, beto);

  console.log('\ndono desativado depois de atribuído');
  await db.query('update profile set active=false where id=$1', [beto]);
  await aceita('outra gravação da conta continua passando (não revalida o dono)', "update radar_company set legal_name='Conta A (editada)' where id=$1", [conta]);
  igual('o vínculo histórico fica: nada é limpo automaticamente', await valor('select commercial_owner_id from radar_company where id=$1', [conta]), beto);
  await recusa('reatribuir a quem está inativo é recusado', 'update radar_company set commercial_owner_id=$2 where id=$1', [await um("insert into radar_company (organization_id, legal_name) values ($1,'Conta Z') returning id", [org]), beto], 'dono comercial inválido');

  console.log('\nmescla (a gravação que o app faz: absorvida inativa e apontando para a canônica)');
  const canonicaComDono = await um("insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1,'Canonica A',$2) returning id", [org, ana]);
  const absorvidaA = await um("insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1,'Absorvida A',$2) returning id", [org, ana]);
  await db.query('update radar_company set commercial_owner_id=$2 where id=$1', [absorvidaA, await um("insert into profile (organization_id, name) values ($1,'Caio') returning id", [org])]);
  await aceita('caso A: mesclar a absorvida (com dono) é aceito', 'update radar_company set active=false, merged_into=$2 where id=$1', [absorvidaA, canonicaComDono]);
  igual('caso A: a canônica mantém o próprio dono', await valor('select commercial_owner_id from radar_company where id=$1', [canonicaComDono]), ana);
  const canonicaSemDono = await um("insert into radar_company (organization_id, legal_name) values ($1,'Canonica B') returning id", [org]);
  const absorvidaB = await um("insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1,'Absorvida B',$2) returning id", [org, ana]);
  await aceita('caso B: mesclar a absorvida (com dono) é aceito', 'update radar_company set active=false, merged_into=$2 where id=$1', [absorvidaB, canonicaSemDono]);
  igual('caso B: a canônica sem dono continua SEM_DONO', await valor('select commercial_owner_id from radar_company where id=$1', [canonicaSemDono]), null);
  await db.query('update profile set active=false where id=$1', [ana]);
  const absorvidaC = await um("insert into radar_company (organization_id, legal_name) values ($1,'Absorvida C') returning id", [org]);
  await db.query('update profile set active=true where id=$1', [ana]);
  await db.query('update radar_company set commercial_owner_id=$2 where id=$1', [absorvidaC, ana]);
  await db.query('update profile set active=false where id=$1', [ana]);
  await aceita('mesclar absorvida cujo dono ficou inativo é aceito (não revalida)', 'update radar_company set active=false, merged_into=$2 where id=$1', [absorvidaC, canonicaSemDono]);

  await db.exec('rollback');
  console.log(`\n${ok} ok, ${falhou} falha(s)`);
  console.log(JSON.stringify({ smoke: 'cd-d5-dono-conta', ok, falhou }));
  if (falhou) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

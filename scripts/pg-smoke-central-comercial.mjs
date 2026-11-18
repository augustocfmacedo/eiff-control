// Smoke do acesso comercial (E11.1E) contra um PostgreSQL DE VERDADE (PGlite, em memória). NADA TOCA PRODUÇÃO.
//
// Duas fases sobre a FILA INTEIRA de migrations (0001..última) + carga inicial, com o mesmo prelúdio dos outros smokes:
//   ANTES  — mede o estado atual: quantas linhas das tabelas comerciais do Radar e das três views cada papel lê, inclusive
//            de OUTRA organização (as views não têm filtro de organização nem security_invoker);
//   DEPOIS — aplica docs/propostas/comercial-acesso.proposta.sql (duas transações, como 0066/0067) e prova: Contabilidade,
//            Auditoria e Solicitante deixam de ler; quem lia continua lendo o mesmo; o papel Comercial lê e grava; as
//            views passam a respeitar organização e papel; reaplicar é inofensivo.
// Também lista, como DIAGNÓSTICO (fora do escopo comercial), as demais views do schema public que devolvem linhas a
// quem não deveria ver nada (Solicitante).
//
// Como rodar:  node scripts/pg-smoke-central-comercial.mjs   (imprime JSON; sai com 1 se qualquer prova falhar)
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..', 'supabase', 'migrations');
const PROPOSTA = path.join(AQUI, '..', 'docs', 'propostas', 'comercial-acesso.proposta.sql');
const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] };
const SEMENTE = '0013';

const PRELUDIO = `
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

const res = { migrations: {}, antes: {}, depois: {}, diagnostico: {}, provas: {} };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];

const db = new PGlite({ extensions: { pgcrypto } });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let sp = 0;
/** roda `fn` como o usuário `uid` (papel authenticated) numa transação própria, sempre desfeita no fim */
async function como(uid, fn) {
  sp++;
  await db.exec('begin;');
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
    const valor = await fn();
    await db.exec('rollback;');
    return { valor, erro: null };
  } catch (e) {
    try { await db.exec('rollback;'); } catch { /* ja desfeita */ }
    return { valor: undefined, erro: so(e) };
  }
}

const RELACOES = ['radar_company', 'radar_contact', 'radar_opportunity', 'radar_activity', 'v_radar_pipeline', 'v_radar_company_queue', 'v_radar_contact_coverage'];
const PERFIS = {
  Administrador: 'cccccccc-0000-4000-8000-000000000001', Diretoria: 'cccccccc-0000-4000-8000-000000000002',
  Financeiro: 'cccccccc-0000-4000-8000-000000000003', Compras: 'cccccccc-0000-4000-8000-000000000004',
  'Gestor de obra': 'cccccccc-0000-4000-8000-000000000005', Engenharia: 'cccccccc-0000-4000-8000-000000000006',
  Contabilidade: 'cccccccc-0000-4000-8000-000000000007', Auditoria: 'cccccccc-0000-4000-8000-000000000008',
  Solicitante: 'cccccccc-0000-4000-8000-000000000009',
};
const COMERCIAL = 'cccccccc-0000-4000-8000-00000000000a';
const COM_RADAR = ['Administrador', 'Diretoria', 'Financeiro', 'Compras', 'Gestor de obra', 'Engenharia'];
const SEM_RADAR = ['Contabilidade', 'Auditoria', 'Solicitante'];

async function medir(uid) {
  const out = {};
  for (const r of RELACOES) {
    const x = await como(uid, async () => um(`select count(*)::int from ${r}`));
    out[r] = x.erro ? `negado: ${x.erro}` : x.valor;
  }
  // a outra organização, vista pelas views (que hoje não filtram organização)
  const outra = await como(uid, async () => um(`select count(*)::int from v_radar_company_queue where organization_id <> (select organization_id from profile where id = '${uid}')`));
  out.outraOrganizacao = outra.erro ? 'negado' : outra.valor;
  return out;
}
const linhas = (v) => (typeof v === 'number' ? v : 0);

try {
  await db.exec(PRELUDIO);
  const arquivos = fs.readdirSync(RAIZ).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const feitas = new Set();
  const aplicar = async (arq) => {
    await db.exec('begin;');
    try { await db.exec(fs.readFileSync(path.join(RAIZ, arq), 'utf8')); await db.exec('commit;'); res.migrations[arq.slice(0, 4)] = 'APLICADA'; feitas.add(arq); }
    catch (e) { try { await db.exec('rollback;'); } catch { /* abortada */ } res.migrations[arq.slice(0, 4)] = `ERRO: ${so(e)}`; throw e; }
  };
  for (const arq of arquivos) {
    const n = arq.slice(0, 4);
    for (const antes of ORDEM_CORRIGIDA[n] ?? []) if (!feitas.has(antes)) await aplicar(antes);
    if (!feitas.has(arq)) await aplicar(arq);
    if (n === SEMENTE) { await db.exec('begin;'); await db.exec(fs.readFileSync(path.join(RAIZ, '..', 'seed.sql'), 'utf8')); await db.exec('commit;'); }
  }

  // ---- dados fictícios: duas organizações, uma empresa/contato/oportunidade/atividade em cada
  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const org2 = await um(`insert into organization (code, name) values ('OUTRA', 'Outra organização (fictícia)') returning id`);
  for (const [papel, id] of Object.entries(PERFIS)) await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, $3, $4, $5)`, [id, org, `Perfil ${papel}`, `${id.slice(-2)}@exemplo`, papel]);
  const ADMIN2 = 'cccccccc-0000-4000-8000-0000000000b1';
  await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Admin da outra', 'b1@exemplo', 'Administrador')`, [ADMIN2, org2]);
  const semear = async (o, dono, sufixo) => {
    const emp = await um(`insert into radar_company (organization_id, legal_name, city, state, active) values ($1, $2, 'Goiânia', 'GO', true) returning id`, [o, `Empresa fictícia ${sufixo}`]);
    await q(`insert into radar_contact (organization_id, company_id, full_name, email, phone, active, status) values ($1, $2, $3, $4, '+5562900000000', true, 'ATIVO')`, [o, emp, `Contato fictício ${sufixo}`, `contato${sufixo}@exemplo`]);
    const op = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value, probability, owner_id, next_action_at) values ($1, $2, 'Galpão fictício', 'NEGOTIATION', 900000, 0.5, $3, now() + interval '3 days') returning id`, [o, emp, dono]);
    await q(`insert into radar_activity (organization_id, company_id, opportunity_id, activity_type, channel, occurred_at, notes) values ($1, $2, $3, 'CALL', 'PHONE', now(), 'negociação: desconto de 5%')`, [o, emp, op]);
  };
  await semear(org, PERFIS.Administrador, 'A');
  await semear(org2, ADMIN2, 'B');
  await db.exec('commit;');

  // ---- ANTES
  for (const [papel, id] of Object.entries(PERFIS)) res.antes[papel] = await medir(id);

  // diagnóstico: views do schema public que devolvem linhas ao Solicitante (que não deveria ler nada)
  const views = (await q(`select viewname from pg_views where schemaname = 'public' order by 1`)).map((r) => r.viewname);
  const vazam = [];
  for (const v of views) {
    const r = await como(PERFIS.Solicitante, async () => um(`select count(*)::int from ${v}`));
    if (!r.erro && r.valor > 0) vazam.push(`${v} (${r.valor})`);
  }
  res.diagnostico.viewsQueDevolvemLinhasAoSolicitante_ANTES = vazam;

  // ---- aplica a PROPOSTA em duas transações
  const sql = fs.readFileSync(PROPOSTA, 'utf8');
  const [parte1, parte2] = sql.split('-- @@PARTE2@@');
  await db.exec('begin;'); await db.exec(parte1); await db.exec('commit;'); res.migrations.proposta_parte1 = 'APLICADA';
  await db.exec('begin;'); await db.exec(parte2); await db.exec('commit;'); res.migrations.proposta_parte2 = 'APLICADA';
  await db.exec('begin;'); await db.exec(parte2); await db.exec('commit;'); res.migrations.proposta_reaplicacao = 'ok';
  await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Perfil Comercial', '0a@exemplo', 'Comercial')`, [COMERCIAL, org]);

  // ---- DEPOIS
  for (const [papel, id] of Object.entries(PERFIS)) res.depois[papel] = await medir(id);
  res.depois.Comercial = await medir(COMERCIAL);
  const vazamDepois = [];
  for (const v of views) {
    const r = await como(PERFIS.Solicitante, async () => um(`select count(*)::int from ${v}`));
    if (!r.erro && r.valor > 0) vazamDepois.push(`${v} (${r.valor})`);
  }
  res.diagnostico.viewsQueDevolvemLinhasAoSolicitante_DEPOIS = vazamDepois;

  // ---- PROVAS
  const vazouAntes = SEM_RADAR.filter((p) => RELACOES.some((r) => linhas(res.antes[p][r]) > 0));
  prova('A estado atual: papéis sem `radar` leem dados comerciais (achado reproduzido)', vazouAntes.length > 0, `leem hoje: ${vazouAntes.join(', ') || 'nenhum'}`);
  prova('B estado atual: as views mostram a OUTRA organização', COM_RADAR.concat(SEM_RADAR).some((p) => linhas(res.antes[p].outraOrganizacao) > 0), `Contabilidade vê ${res.antes.Contabilidade.outraOrganizacao} empresa(s) da outra organização`);

  const vazaDepois = SEM_RADAR.flatMap((p) => RELACOES.filter((r) => linhas(res.depois[p][r]) > 0).map((r) => `${p}:${r}`));
  prova('C depois: Contabilidade, Auditoria e Solicitante não leem tabela nem view comercial', vazaDepois.length === 0, vazaDepois.join(' · ') || `${SEM_RADAR.length} papéis × ${RELACOES.length} relações = 0 linhas`);

  const tabelas = RELACOES.filter((r) => !r.startsWith('v_'));
  const regressao = COM_RADAR.flatMap((p) => tabelas.filter((r) => res.depois[p][r] !== res.antes[p][r]).map((r) => `${p}:${r} ${res.antes[p][r]}→${res.depois[p][r]}`));
  prova('D sem regressão: quem tem `radar` lê as mesmas linhas das tabelas', regressao.length === 0, regressao.join(' · ') || `${COM_RADAR.length} papéis iguais`);

  const outraDepois = Object.entries(res.depois).filter(([, m]) => linhas(m.outraOrganizacao) > 0).map(([p]) => p);
  prova('E depois: nenhuma view mostra a outra organização', outraDepois.length === 0, outraDepois.join(', ') || 'views com security_invoker');
  const viewsAdmin = ['v_radar_pipeline', 'v_radar_company_queue', 'v_radar_contact_coverage'].map((v) => `${v}=${res.depois.Administrador[v]}`);
  prova('F depois: as views seguem úteis para quem tem `radar` (só a própria organização)', res.depois.Administrador.v_radar_company_queue === 1 && res.depois.Administrador.v_radar_pipeline === 1, viewsAdmin.join(' '));

  prova('G papel Comercial lê os dados comerciais', tabelas.every((r) => linhas(res.depois.Comercial[r]) > 0), JSON.stringify(res.depois.Comercial));
  const empA = await um(`select id from radar_company where organization_id = $1`, [org]);
  const grava = await como(COMERCIAL, async () => (await q(`update radar_company set notes = 'anotação do comercial' where id = $1 returning id`, [empA])).length);
  prova('H papel Comercial grava pela política _write', grava.valor === 1, grava.erro ?? `${grava.valor} linha`);
  const naoGrava = await como(PERFIS.Contabilidade, async () => (await q(`update radar_company set notes = 'x' where id = $1 returning id`, [empA])).length);
  prova('I Contabilidade não grava', naoGrava.erro !== null || naoGrava.valor === 0, naoGrava.erro ?? `${naoGrava.valor} linha`);
  const inbox = await como(COMERCIAL, async () => um(`select inbox_role()`));
  const inboxConta = await como(PERFIS.Contabilidade, async () => um(`select inbox_role()`));
  prova('J inbox_role: Comercial entra, Contabilidade continua como estava', inbox.valor === true && inboxConta.valor === true, `Comercial=${inbox.valor} Contabilidade=${inboxConta.valor}`);
  const orgSoPorOrg = await q(`select tablename, policyname from pg_policies where schemaname = 'public' and tablename like 'radar\\_%' and cmd = 'SELECT' and qual not like '%radar_leitura_role%'`);
  const config = new Set(['radar_source', 'radar_strategy', 'radar_response_type', 'radar_score_rule', 'radar_score_setting', 'radar_persona_rule', 'radar_decision_fit_weight', 'radar_vibe_credit_policy']);
  const sobra = orgSoPorOrg.filter((p) => !config.has(p.tablename)).map((p) => `${p.tablename}.${p.policyname}`);
  prova('K nenhuma tabela de DADOS do Radar ficou com leitura só por organização', sobra.length === 0, sobra.join(', ') || `config preservada: ${[...config].join(', ')}`);
  // L. views só leitura e fechadas para anon (achado da frente S3)
  const pelaView = await como(COMERCIAL, async () => (await q(`update v_radar_company_queue set legal_name = 'alterada pela view' returning company_id`)).length);
  const anonLe = await (async () => { await db.exec('begin;'); try { await db.exec('set local role anon;'); const n = await um('select count(*)::int from v_radar_pipeline'); await db.exec('rollback;'); return `leu ${n}`; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return `negado: ${so(e)}`; } })();
  prova('L views do Radar: sem escrita pela view e sem leitura para anon', pelaView.erro !== null && anonLe.startsWith('negado'), `update pela view: ${pelaView.erro ?? pelaView.valor + ' linha(s)'} · anon: ${anonLe}`);
} catch (e) {
  prova('execução', false, so(e));
}

console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);

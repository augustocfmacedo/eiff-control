// Smoke test da migration 0069 (widgets do iPad: token por aparelho, só leitura do resumo do caixa) contra um PostgreSQL
// de verdade (PGlite, devDependency fixada), em memória, dentro de BEGIN ... ROLLBACK. NADA toca produção.
//
// Como rodar:
//   node scripts/pg-smoke-widget-token.mjs        (ou npm run smoke:widget-token)
//
// Prova: quem cria (só Administrador ativo), o segredo nunca gravado em claro (só SHA-256 + 4 finais), a validação só para o
// servidor (service_role) com cada recusa (formato, desconhecido, revogado, expirado, perfil inativo, papel trocado), o último
// uso, a revogação pelo dono com motivo, o limite de aparelhos, RLS e colunas (o cliente nunca lê o hash), escrita direta
// negada, imutabilidade, search_path seguro contra tabelas temporárias de mesmo nome e o rollback exato versionado.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL_0069 = readFileSync('supabase/migrations/0069_widget_token.sql', 'utf8');
const ROLLBACK_0069 = readFileSync(new URL('../supabase/rollbacks/0069_widget_token.rollback.sql', import.meta.url), 'utf8').replace(/^(begin|commit);$/gm, '');

const PRELUDIO = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $r$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', 'Solicitante');
create table organization (id uuid primary key default gen_random_uuid(), code text);
create table profile (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  role role_kind not null default 'Administrador',
  active boolean not null default true
);
create table audit_log (
  id bigserial primary key, organization_id uuid, occurred_at timestamptz not null default now(), actor_id uuid,
  action text not null, entity_type text not null, entity_id text, before_data jsonb, after_data jsonb, reason text, source text
);
create function current_org() returns uuid language sql stable security definer as $$
  select organization_id from profile where id = auth.uid() and active and role <> 'Solicitante'
$$;
grant select on audit_log to authenticated;`;

const db = new PGlite();
let ok = 0;
let falhou = 0;
let sp = 0;
const passou = (nome) => { ok++; console.log('  ok    ' + nome); };
const quebrou = (nome, detalhe) => { falhou++; console.log('  FALHA ' + nome + '\n        ' + detalhe); };
async function emSavepoint(fn) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try { const r = await fn(); await db.exec('release savepoint ' + nome); return { ok: true, r }; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); return { ok: false, e }; }
}
async function recusa(nome, sql, params, pedaco) {
  const x = await emSavepoint(() => db.query(sql, params));
  if (x.ok) { quebrou(nome, 'o banco ACEITOU — a regra nao esta valendo'); return; }
  const msg = String(x.e.message).toLowerCase();
  if (pedaco && !msg.includes(pedaco.toLowerCase())) quebrou(nome, 'recusou pelo motivo errado: ' + x.e.message);
  else passou(nome);
}
function igual(nome, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) passou(nome);
  else quebrou(nome, `esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

async function main() {
  console.log('Widgets do iPad · smoke da migration 0069 (token por aparelho) em PostgreSQL descartavel (PGlite)\n');
  await db.exec(PRELUDIO);
  await db.exec('begin');
  const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.id;
  const valor = async (sql, params = []) => { const r = (await db.query(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; };
  const aclDe = (t) => valor(`select coalesce(relacl::text, '') from pg_class where oid = '${t}'::regclass`);
  const aclAntes = { audit_log: await aclDe('audit_log'), profile: await aclDe('profile'), organization: await aclDe('organization') };
  await db.exec(SQL_0069);
  console.log('  preludio + 0069 aplicadas\n');

  const org = await um("insert into organization (code) values ('EIFF') returning id");
  const outraOrg = await um("insert into organization (code) values ('OUTRA') returning id");
  const perfil = (nome, papel, organizacao = org, ativo = true) => um('insert into profile (organization_id, name, role, active) values ($1,$2,$3,$4) returning id', [organizacao, nome, papel, ativo]);
  const adm = await perfil('Adm', 'Administrador');
  const adm2 = await perfil('Adm 2', 'Administrador');
  const admFora = await perfil('Adm de fora', 'Administrador', outraOrg);
  const comoAutor = (id) => db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? '']);
  const comoJwt = (role) => db.query("select set_config('request.jwt.claims', $1, true)", [role ? JSON.stringify({ role }) : '']);
  const comoPapel = async (papel, sql, params = []) => emSavepoint(async () => {
    await db.exec(`set local role ${papel}`);
    const r = await db.query(sql, params); // se falhar, o rollback do savepoint desfaz o set local role
    await db.exec('reset role');
    return r;
  });
  const CRIAR = 'select widget_token_criar($1, $2) as r';
  const VALIDAR = 'select widget_token_validar($1) as r';
  const REVOGAR = 'select widget_token_revogar($1::uuid, $2) as r';
  const auditorias = (acao) => valor('select count(*)::int from audit_log where action = $1', [acao]);

  console.log('criação');
  await comoAutor(adm);
  const c1 = (await db.query(CRIAR, ['iPad do Augusto', 365])).rows[0].r;
  igual('Administrador cria: token eiffw_ + 64 hex, devolvido uma vez', /^eiffw_[0-9a-f]{64}$/.test(c1.token), true);
  const linha = (await db.query('select * from widget_token where id = $1', [c1.id])).rows[0];
  igual('o banco guarda só o SHA-256 do segredo e os 4 finais', [linha.token_hash === sha(c1.token.slice(6)), linha.token_hint, c1.final], [true, c1.token.slice(-4), c1.token.slice(-4)]);
  igual('nenhuma coluna guarda o segredo em claro', JSON.stringify(linha).includes(c1.token.slice(6)), false);
  igual('dono, organização, escopo e validade de 365 dias', [linha.profile_id, linha.organization_id, linha.scope, Math.round((new Date(linha.expires_at) - new Date(linha.created_at)) / 86400000)], [adm, org, 'caixa_resumo', 365]);
  const aud = (await db.query("select actor_id, action, source, after_data from audit_log where action = 'widget_token_criar' order by id desc limit 1")).rows[0];
  igual('auditoria da criação: autor, fonte rpc, nome e final, nunca o token', [aud.actor_id, aud.source, aud.after_data.nome, aud.after_data.final, JSON.stringify(aud).includes(c1.token.slice(6))], [adm, 'rpc', 'iPad do Augusto', c1.final, false]);
  const c2 = (await db.query(CRIAR, ['  iPad da sala  ', 30])).rows[0].r;
  igual('nome aparado e validade escolhida (30 dias)', [c2.nome, c2.token !== c1.token], ['iPad da sala', true]);

  console.log('\nquem não pode criar');
  for (const papel of ['Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', 'Solicitante']) {
    await comoAutor(await perfil(papel, papel));
    await recusa(`${papel} não cria widget de caixa`, CRIAR, ['tentativa', 30], 'só quem vê o caixa');
  }
  await comoAutor(await perfil('Adm inativo', 'Administrador', org, false));
  await recusa('Administrador inativo não cria', CRIAR, ['tentativa', 30], 'sem perfil ativo');
  await comoAutor(null);
  await recusa('sem sessão não cria', CRIAR, ['tentativa', 30], 'não autenticada');
  await comoAutor(adm);
  await recusa('nome vazio é recusado', CRIAR, ['   ', 30], 'nome do aparelho');
  await recusa('nome com mais de 60 caracteres é recusado', CRIAR, ['x'.repeat(61), 30], 'nome do aparelho');
  await recusa('validade 0 é recusada', CRIAR, ['ipad', 0], 'validade');
  await recusa('validade acima de 365 é recusada', CRIAR, ['ipad', 366], 'validade');

  console.log('\nvalidação (só servidor)');
  await comoJwt('service_role');
  let v = (await db.query(VALIDAR, [c1.token])).rows[0].r;
  igual('token válido: devolve o perfil, a organização e o aparelho', [v.ok, v.perfil_id, v.organizacao_id, v.token_id, v.nome], [true, adm, org, c1.id, 'iPad do Augusto']);
  igual('marca o último uso', (await valor('select last_used_at is not null from widget_token where id = $1', [c1.id])), true);
  igual('formato inválido', (await db.query(VALIDAR, ['abc'])).rows[0].r.erro, 'token_invalido');
  igual('token desconhecido', (await db.query(VALIDAR, ['eiffw_' + '0'.repeat(64)])).rows[0].r.erro, 'token_invalido');
  igual('o hash sozinho não vale como token', (await db.query(VALIDAR, ['eiffw_' + linha.token_hash])).rows[0].r.erro, 'token_invalido');
  await comoJwt('authenticated');
  igual('chamada com JWT de usuário: recusada dentro da função', (await db.query(VALIDAR, [c1.token])).rows[0].r.erro, 'somente_servidor');
  await comoJwt(null);
  const exAuth = await comoPapel('authenticated', VALIDAR, [c1.token]);
  igual('authenticated não tem EXECUTE na validação', exAuth.ok ? 'EXECUTOU' : /permission denied/.test(exAuth.e.message), true);
  const exAnon = await comoPapel('anon', VALIDAR, [c1.token]);
  igual('anon não tem EXECUTE na validação', exAnon.ok ? 'EXECUTOU' : /permission denied/.test(exAnon.e.message), true);
  const exServ = await comoPapel('service_role', VALIDAR, [c1.token]);
  igual('service_role executa a validação', exServ.ok ? exServ.r.rows[0].r.ok : exServ.e.message, true);

  console.log('\no token para de valer sozinho quando o perfil muda');
  await db.query("update profile set role = 'Diretoria' where id = $1", [adm2]);
  await comoAutor(adm); // cria como adm, depois testa adm2 abaixo
  await db.query("update profile set role = 'Administrador' where id = $1", [adm2]);
  await comoAutor(adm2);
  const c3 = (await db.query(CRIAR, ['iPad do Adm 2', 10])).rows[0].r;
  await db.query("update profile set role = 'Financeiro' where id = $1", [adm2]);
  igual('papel trocado para um que não vê caixa: sem_permissao', (await db.query(VALIDAR, [c3.token])).rows[0].r.erro, 'sem_permissao');
  await db.query("update profile set role = 'Administrador', active = false where id = $1", [adm2]);
  igual('perfil desativado: perfil_inativo', (await db.query(VALIDAR, [c3.token])).rows[0].r.erro, 'perfil_inativo');
  await db.query('update profile set active = true where id = $1', [adm2]);
  igual('reativado com o papel certo: volta a valer', (await db.query(VALIDAR, [c3.token])).rows[0].r.ok, true);
  await db.exec('alter table widget_token disable trigger widget_token_sem_update');
  await db.query("update widget_token set created_at = now() - interval '20 days', expires_at = now() - interval '1 second' where id = $1", [c3.id]);
  await db.exec('alter table widget_token enable trigger widget_token_sem_update');
  igual('vencido: token_expirado', (await db.query(VALIDAR, [c3.token])).rows[0].r.erro, 'token_expirado');

  console.log('\nrevogação');
  await comoAutor(adm2);
  await recusa('outro Administrador não revoga o aparelho alheio', REVOGAR, [c1.id, 'não é meu'], 'não encontrado');
  await comoAutor(admFora);
  await recusa('Administrador de outra organização não revoga', REVOGAR, [c1.id, 'de fora'], 'não encontrado');
  await comoAutor(adm);
  await recusa('revogar exige motivo', REVOGAR, [c1.id, ' x '], 'motivo');
  const nRev = await auditorias('widget_token_revogar');
  igual('o dono revoga com motivo', (await db.query(REVOGAR, [c1.id, 'iPad perdido'])).rows[0].r.revogado, true);
  igual('auditoria da revogação com o motivo', [(await auditorias('widget_token_revogar')) - nRev, await valor("select reason from audit_log where action = 'widget_token_revogar' order by id desc limit 1")], [1, 'iPad perdido']);
  igual('revogado: token_revogado', (await db.query(VALIDAR, [c1.token])).rows[0].r.erro, 'token_revogado');
  await recusa('revogar de novo é recusado', REVOGAR, [c1.id, 'outra vez'], 'já revogado');

  console.log('\nlimite de aparelhos ativos');
  const ativos = await valor("select count(*)::int from widget_token where profile_id = $1 and revoked_at is null and expires_at > now()", [adm]);
  for (let i = ativos; i < 10; i++) await db.query(CRIAR, [`aparelho ${i}`, 30]);
  await recusa('o 11º aparelho ativo é recusado', CRIAR, ['um a mais', 30], 'limite de 10');

  console.log('\nRLS, colunas e escrita direta');
  const vis = await comoPapel('authenticated', 'select id, name, token_hint, revoked_at from widget_token');
  igual('o dono lê os próprios aparelhos', vis.ok ? vis.r.rows.length : vis.e.message, 11);
  const hash = await comoPapel('authenticated', 'select token_hash from widget_token');
  igual('o cliente nunca lê o hash (sem privilégio na coluna)', hash.ok ? 'LEU' : /permission denied/.test(hash.e.message), true);
  const tudo = await comoPapel('authenticated', 'select * from widget_token');
  igual('select * também é negado (inclui o hash)', tudo.ok ? 'LEU' : /permission denied/.test(tudo.e.message), true);
  await comoAutor(adm2);
  const alheio = await comoPapel('authenticated', 'select id from widget_token where id = $1', [c1.id]); // o cliente nem filtra por profile_id (coluna sem privilégio): quem filtra é a RLS
  igual('outro Administrador não vê os aparelhos alheios', alheio.ok ? alheio.r.rows.length : alheio.e.message, 0);
  await comoAutor(await perfil('Solicitante RLS', 'Solicitante'));
  const sol = await comoPapel('authenticated', 'select id from widget_token');
  igual('Solicitante não vê nada', sol.ok ? sol.r.rows.length : sol.e.message, 0);
  await comoAutor(adm);
  for (const [nome, sql, params] of [
    ['insert direto', "insert into widget_token (organization_id, profile_id, name, token_hash, token_hint, expires_at) values ($1, $2, 'x', repeat('a', 64), 'aaaa', now() + interval '1 day')", [org, adm]],
    ['update direto', "update widget_token set expires_at = now() + interval '9 years'", []],
    ['delete direto', 'delete from widget_token', []],
  ]) {
    const x = await comoPapel('authenticated', sql, params);
    igual(`${nome} como authenticated é negado`, x.ok ? 'ACEITO' : /permission denied/.test(x.e.message), true);
  }
  const exCriar = await comoPapel('anon', CRIAR, ['anon', 1]);
  igual('anon não cria', exCriar.ok ? 'CRIOU' : /permission denied/.test(exCriar.e.message), true);
  await comoAutor(adm2); // o adm já está no limite de 10
  const exCriarAuth = await comoPapel('authenticated', CRIAR, ['pelo cliente', 1]);
  igual('authenticated cria pela RPC (com o papel certo)', exCriarAuth.ok ? /^eiffw_/.test(exCriarAuth.r.rows[0].r.token) : exCriarAuth.e.message, true);

  console.log('\nimutabilidade (mesmo para o dono do banco)');
  await recusa('não muda o hash', "update widget_token set token_hash = repeat('b', 64) where id = $1", [c2.id], 'só o último uso');
  await recusa('não estende a validade', "update widget_token set expires_at = expires_at + interval '1 year' where id = $1", [c2.id], 'só o último uso');
  await recusa('não desfaz a revogação', 'update widget_token set revoked_at = null, revoked_by = null, revoke_reason = null where id = $1', [c1.id], 'já revogado');
  await recusa('não apaga', 'delete from widget_token where id = $1', [c2.id], 'não são apagados');
  await recusa('não trunca', 'truncate widget_token', [], 'não são apagados');
  await recusa('hash fora do formato é recusado pela tabela', "insert into widget_token (organization_id, profile_id, name, token_hash, token_hint, expires_at) values ($1, $2, 'x', 'curto', 'aaaa', now() + interval '1 day')", [org, adm], 'check');
  await recusa('escopo é fixo', "insert into widget_token (organization_id, profile_id, name, scope, token_hash, token_hint, expires_at) values ($1, $2, 'x', 'escrita', repeat('c', 64), 'cccc', now() + interval '1 day')", [org, adm], 'check');

  console.log('\nsearch_path seguro e tabelas temporárias de mesmo nome');
  const caminhos = (await db.query("select proname, array_to_string(proconfig, ';') as c, prosecdef from pg_proc where proname like 'widget_token_%' order by proname")).rows;
  igual('as quatro funções fixam search_path = pg_catalog, pg_temp', caminhos.map((x) => [x.proname, x.c]), [['widget_token_criar', 'search_path=pg_catalog, pg_temp'], ['widget_token_imutavel', 'search_path=pg_catalog, pg_temp'], ['widget_token_revogar', 'search_path=pg_catalog, pg_temp'], ['widget_token_validar', 'search_path=pg_catalog, pg_temp']]);
  igual('as três RPCs são security definer; o gatilho não', caminhos.filter((x) => x.prosecdef).map((x) => x.proname), ['widget_token_criar', 'widget_token_revogar', 'widget_token_validar']);
  const compras = await perfil('Compras (sombra)', 'Compras');
  await db.exec(`create temp table profile (id uuid, organization_id uuid, name text, role public.role_kind, active boolean);
    create temp table widget_token (like public.widget_token);`);
  await db.query("insert into pg_temp.profile values ($1, $2, 'Sombra', 'Administrador', true)", [compras, org]);
  await comoAutor(compras);
  await recusa('perfil falso em tabela temporária não deixa o Compras criar', CRIAR, ['sombra', 30], 'só quem vê o caixa');
  await db.query("insert into pg_temp.widget_token (id, organization_id, profile_id, name, scope, token_hash, token_hint, created_at, expires_at) values (gen_random_uuid(), $1, $2, 'falso', 'caixa_resumo', $3, 'ffff', now(), now() + interval '1 day')", [org, adm, sha('f'.repeat(64))]);
  igual('token falso em tabela temporária não é aceito', (await db.query(VALIDAR, ['eiffw_' + 'f'.repeat(64)])).rows[0].r.erro, 'token_invalido');
  await db.exec('drop table pg_temp.profile, pg_temp.widget_token;');

  console.log('\nrollback EXATO da 0069 (supabase/rollbacks/0069_widget_token.rollback.sql)');
  await db.exec(ROLLBACK_0069);
  igual('rollback: nenhum objeto da 0069 sobra', await valor("select to_regclass('widget_token') is null and not exists (select 1 from pg_proc where proname like 'widget_token_%')"), true);
  igual('rollback: permissões das tabelas existentes iguais às de antes da 0069', { audit_log: await aclDe('audit_log'), profile: await aclDe('profile'), organization: await aclDe('organization') }, aclAntes);

  await db.exec('rollback');
  console.log(`\n${ok} ok, ${falhou} falha(s)`);
  console.log(JSON.stringify({ smoke: 'widget-token', ok, falhou }));
  if (falhou) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Smoke do papel Solicitante (migrations 0065 e 0066) contra um PostgreSQL DE VERDADE (PGlite, em memória).
//
// Por que existe: o Solicitante só pode conversar com o Diretor Financeiro. A tela esconde o resto, mas quem garante é o
// BANCO: aqui o Solicitante tenta ler CADA tabela do schema public e do storage, gravar lançamento direto, se promover a
// Administrador e usar as três portas (df_contexto, df_registrar_pedido, df_meus_pedidos). Os outros papéis têm de
// continuar exatamente como antes.
//
// O schema é a FILA INTEIRA de migrations (0001..última) mais a carga inicial, com o mesmo prelúdio do pg-smoke-fin-reset
// (imita a plataforma Supabase). NADA TOCA PRODUÇÃO: banco em memória, sem rede, sem segredo.
//
// Como rodar:  node scripts/pg-smoke-solicitante.mjs   (imprime JSON; sai com 1 se qualquer prova falhar)
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..', 'supabase', 'migrations');
const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] }; // mesma correção histórica do preflight
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

const res = { migrations: {}, provas: {} };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];

const db = new PGlite({ extensions: { pgcrypto } });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let sp = 0;
/** roda `fn` como o usuário `uid` (papel authenticated) dentro de um savepoint desfeito no fim; devolve { valor, erro } */
async function como(uid, fn, { manter = false } = {}) {
  const nome = `sp${++sp}`;
  await db.exec(`savepoint ${nome};`);
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
    const valor = await fn();
    await db.exec('reset role;');
    if (manter) await db.exec(`release savepoint ${nome};`); else await db.exec(`rollback to savepoint ${nome};`);
    return { valor, erro: null };
  } catch (e) {
    await db.exec(`rollback to savepoint ${nome};`);
    return { valor: undefined, erro: so(e) };
  }
}

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
  // reaplicar a 0066 tem de ser inofensivo (create or replace / grants)
  await db.exec(fs.readFileSync(path.join(RAIZ, arquivos.find((f) => f.startsWith('0066_'))), 'utf8'));
  res.migrations.reaplicacao_0066 = 'ok';

  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const cia = await um(`select id from company where organization_id = $1 order by code limit 1`, [org]);
  const obra = await um(`select code from project where organization_id = $1 and status in ('Planejamento','Em execução') order by code limit 1`, [org]);
  const ADMIN = 'bbbbbbbb-0000-4000-8000-000000000001', FIN = 'bbbbbbbb-0000-4000-8000-000000000002';
  const SOL = 'bbbbbbbb-0000-4000-8000-000000000003', SOL2 = 'bbbbbbbb-0000-4000-8000-000000000004';
  await q(`insert into profile (id, organization_id, name, email, role) values
    ($1,$5,'Admin','admin@t','Administrador'), ($2,$5,'Fin','fin@t','Financeiro'), ($3,$5,'Equipe Um','sol@t','Solicitante'), ($4,$5,'Equipe Dois','sol2@t','Solicitante')`, [ADMIN, FIN, SOL, SOL2, org]);
  // mesmo com escopo de empresa inteira (o pior caso de configuracao), o Solicitante nao pode ler nada
  await q(`insert into user_scope (organization_id, profile_id, company_id, project_id) values ($1,$2,$3,null), ($1,$4,$3,null)`, [org, SOL, cia, FIN]);
  const cat = await um(`select category from chart_account where organization_id = $1 and entry_type = 'Saída' and active order by category limit 1`, [org]);
  // um lancamento comum ja existente (para provar que o Solicitante nao o enxerga)
  await q(`insert into financial_entry (code, organization_id, company_id, entry_type, chart_account_id, description, competence_date, due_date, status, gross_amount, source_system)
    select 'PAG-9001', $1, $2, 'Saída', id, 'lançamento da casa', '2026-10-10', '2026-10-20', 'Programado', 1234, 'eiff-control' from chart_account where organization_id = $1 and category = $3`, [org, cia, cat]);

  // A. leitura: CADA tabela do schema public (e storage.objects) devolve 0 linhas ou permissão negada para o Solicitante
  const tabelas = (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.tablename);
  const vazou = []; let negadas = 0; let vazias = 0;
  for (const t of [...tabelas.map((x) => `public.${x}`), 'storage.objects', 'storage.buckets']) {
    const r = await como(SOL, async () => um(`select count(*)::int from ${t}`));
    if (r.erro) { if (/permission denied/.test(r.erro)) negadas++; else vazou.push(`${t}: erro inesperado ${r.erro}`); }
    else if (r.valor > 0) {
      const adm = await como(ADMIN, async () => um(`select count(*)::int from ${t}`));
      vazou.push(`${t}: ${r.valor} linha(s) (admin vê ${adm.valor})`);
    } else vazias++;
  }
  // storage.buckets nao tem RLS no preludio (no Supabase e da plataforma, sem dado de negocio): nao conta como vazamento
  const vazamentoReal = vazou.filter((v) => !v.startsWith('storage.buckets'));
  prova('A Solicitante não lê nenhuma tabela (public + storage)', vazamentoReal.length === 0,
    vazamentoReal.length ? vazamentoReal.join(' · ') : `${tabelas.length} tabelas public: ${vazias} vazias, ${negadas} negadas`);

  // B. escrita direta recusada: lancamento, auditoria e promocao do proprio perfil
  // valores literais (sem SELECT em tabela que o Solicitante nao le, senao seria um insert de zero linhas e nao provaria nada)
  const catId = await um(`select id from chart_account where organization_id = $1 and category = $2`, [org, cat]);
  const ins = await como(SOL, async () => q(`insert into financial_entry (code, organization_id, company_id, entry_type, chart_account_id, description, competence_date, due_date, status, gross_amount, source_system, created_by)
    values ('PAG-9999', $1, $2, 'Saída', $3, 'direto', '2026-10-10', '2026-10-20', 'Rascunho', 10, 'diretor-financeiro', $4)`, [org, cia, catId, SOL]));
  const aud = await como(SOL, async () => q(`insert into audit_log (organization_id, actor_id, action, entity_type, source) values ($1, $2, 'x', 'y', 'app')`, [org, SOL]));
  const prom = await como(SOL, async () => { await q(`update profile set role = 'Administrador' where id = $1`, [SOL]); return um(`select role::text from profile where id = $1`, [SOL]); });
  const roleDepois = await um(`select role::text from profile where id = $1`, [SOL]);
  prova('B escrita direta recusada (lançamento, auditoria, promoção a Administrador)',
    !!ins.erro && !!aud.erro && roleDepois === 'Solicitante', `insert: ${ins.erro} · audit: ${aud.erro} · update perfil: ${prom.erro ?? 'sem erro, 0 linhas'} → papel ${roleDepois}`);

  // C. as tres portas
  const ctx = await como(SOL, async () => um(`select df_contexto()`));
  const c = ctx.valor ?? {};
  prova('C df_contexto: próprio perfil + categorias de saída + obras ativas, nada mais',
    !ctx.erro && c.perfil?.papel === 'Solicitante' && Array.isArray(c.categorias) && c.categorias.some((x) => x.categoria === cat && 'grupoFluxo' in x && Object.keys(x).length === 2) && Array.isArray(c.obras) && Object.keys(c).sort().join(',') === 'categorias,obras,organizacao,perfil',
    ctx.erro ?? `${c.categorias?.length} categorias, ${c.obras?.length} obras`);
  const pedido = { valor: 800, vencimento: '2026-10-17', categoria: cat, codigoObra: obra, contraparte: 'Oficina do Zé', descricao: 'Manutenção da Saveiro', observacoes: 'urgente' };
  const r1 = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify(pedido)]), { manter: true });
  const linha = await q(`select code, status::text, source_system, created_by::text, project_id is not null as com_obra, gross_amount::text from financial_entry where code = $1`, [r1.valor?.codigo]);
  prova('D registrar pedido: PED-0001 em Rascunho, origem diretor-financeiro, criado pelo Solicitante',
    !r1.erro && r1.valor?.codigo === 'PED-0001' && linha[0]?.status === 'Rascunho' && linha[0]?.source_system === 'diretor-financeiro' && linha[0]?.created_by === SOL && linha[0]?.com_obra && linha[0]?.gross_amount === '800.00',
    r1.erro ?? JSON.stringify(linha[0]));
  const r2 = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify(pedido)]), { manter: true });
  const qtd = await um(`select count(*)::int from financial_entry where source_system = 'diretor-financeiro'`);
  prova('E idempotência: o mesmo pedido repetido devolve o existente', r2.valor?.codigo === 'PED-0001' && r2.valor?.repetido === true && qtd === 1, `${JSON.stringify(r2.valor ?? r2.erro)} · ${qtd} pedido(s)`);
  const r3 = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify({ ...pedido, valor: 300, descricao: 'Combustível', codigoObra: null })]), { manter: true });
  prova('F segundo pedido diferente: PED-0002, sem obra', r3.valor?.codigo === 'PED-0002' && r3.valor?.codigoObra === null, JSON.stringify(r3.valor ?? r3.erro));
  const invalidos = [];
  for (const [nome, p] of [['valor zero', { ...pedido, valor: 0 }], ['sem data', { ...pedido, vencimento: '' }], ['categoria inventada', { ...pedido, categoria: 'Inventada' }], ['obra inventada', { ...pedido, codigoObra: 'OB-XX' }], ['sem descrição', { ...pedido, descricao: ' ' }]]) {
    const r = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify(p)]));
    if (!r.erro) invalidos.push(`${nome} aceito`);
  }
  prova('G pedido inválido recusado (valor, data, categoria, obra, descrição)', invalidos.length === 0, invalidos.join(' · '));
  const meus = await como(SOL, async () => um(`select df_meus_pedidos()`));
  const meus2 = await como(SOL2, async () => um(`select df_meus_pedidos()`));
  prova('H meus pedidos: só os do próprio Solicitante', (meus.valor ?? []).map((x) => x.codigo).sort().join(',') === 'PED-0001,PED-0002' && (meus2.valor ?? []).length === 0,
    `um: ${(meus.valor ?? []).map((x) => x.codigo)} · dois: ${(meus2.valor ?? []).length}`);
  const ainda = await como(SOL, async () => um(`select count(*)::int from financial_entry`));
  prova('I depois de registrar, o Solicitante continua sem ler lançamentos (nem os próprios pela tabela)', ainda.valor === 0, String(ainda.valor ?? ainda.erro));

  // J. os outros papeis nao mudam: admin e financeiro leem os pedidos e o lancamento da casa; admin nao usa a porta do Solicitante
  const admVe = await como(ADMIN, async () => um(`select count(*)::int from financial_entry where code in ('PED-0001','PED-0002','PAG-9001')`));
  const finVe = await como(FIN, async () => um(`select count(*)::int from financial_entry where code in ('PED-0001','PED-0002','PAG-9001')`));
  const admPorta = await como(ADMIN, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify(pedido)]));
  const admCtx = await como(ADMIN, async () => um(`select df_contexto()`));
  const finOrg = await como(FIN, async () => um(`select current_org()`));
  prova('J demais papéis inalterados: Admin e Financeiro veem os pedidos; Admin não usa a porta do Solicitante',
    admVe.valor === 3 && finVe.valor === 3 && /Solicitante/.test(admPorta.erro ?? '') && admCtx.valor?.perfil?.papel === 'Administrador' && finOrg.valor === org,
    `admin vê ${admVe.valor} · fin vê ${finVe.valor} · porta admin: ${admPorta.erro} · ctx admin: ${admCtx.valor?.perfil?.papel}`);

  // K. anon nao executa as portas; df_pedido_json nao e chamavel por fora
  const priv = await q(`select p, f, has_function_privilege(p, f, 'EXECUTE') pode from unnest(array['anon','authenticated']) p, unnest(array['df_contexto()','df_registrar_pedido(jsonb)','df_meus_pedidos()','df_pedido_json(financial_entry)']) f`);
  const errado = priv.filter((x) => (x.p === 'anon' ? x.pode : x.f.startsWith('df_pedido_json') ? x.pode : !x.pode)).map((x) => `${x.p} ${x.f} ${x.pode}`);
  prova('K privilégios: anon não executa nada; authenticated só as três portas', errado.length === 0, errado.join(' · '));

  // L. perfil inativo: nem as portas abrem
  await q(`update profile set active = false where id = $1`, [SOL2]);
  const inat = await como(SOL2, async () => um(`select df_contexto()`));
  prova('L perfil inativo não abre as portas', !!inat.erro, inat.erro ?? 'abriu');

  await db.exec('rollback;');
} catch (e) {
  prova('EXECUCAO', false, so(e));
}
console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);

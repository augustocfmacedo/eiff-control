// Smoke da Segurança S3 (migration 0077) contra um PostgreSQL DE VERDADE (PGlite, em memória): quem lê, escreve e
// executa o quê pelas views, tabelas e funções — ANTES e DEPOIS da 0077, com identidades equivalentes às reais (papéis de
// banco anon / authenticated / service_role, perfis por papel de negócio com escopo de empresa ou de obra e, na prova N,
// um DONO que não é superusuário, como o `postgres` do Supabase).
//
// Por que existe: view sem `security_invoker` roda com os direitos do DONO (BYPASSRLS) e ignora a RLS das tabelas; o
// privilégio padrão do schema public dava tudo a `anon` em toda view e EXECUTE em toda função nova. O smoke:solicitante
// varria só pg_tables, então o vazamento passou despercebido (achado S3; incidente de 16/11/2026, contenção C1 em 17/11).
//
// Banco principal: FILA INTEIRA de migrations SEM a 0077 + carga inicial + cenário fictício (segunda obra, segunda
// organização, uma linha em cada tabela de base das 25 views nas duas obras). Reproduz-se o defeito, aplica-se a C1 (como
// em produção), tira-se o retrato, aplica-se a 0077 numa transação e mede-se de novo.
// Provas (todas têm de dar PASS; sai com 1 se qualquer uma falhar):
//   S      cenário: TODA view tem linha para o Administrador (nenhuma prova de leitura é vazia por falta de dado)
//   A0/A1  reprodução do defeito sem C1/0077 (leitura por Solicitante/outra organização/anon; escrita pela view)
//   P      pré-condição: inventário de views diferente aborta a 0077 sem alterar nada (retrato idêntico)
//   B      Solicitante, Administrador de outra organização e anon: 0 linhas ou negado em TODA view e no fluxo de caixa
//   C/C2   sem regressão: Administrador, Diretoria, Financeiro, Contabilidade e Auditoria com resultado idêntico (md5);
//          mart.cash_weekly passa a mostrar a organização de quem consulta
//   D      recorte: Gestor de obra e Engenharia (escopo de uma obra) veem pela view só a obra do escopo, em toda view de obra
//   D2     fluxo de caixa de Compras, Gestor e Engenharia: parte de saldo ZERO (não veem contas bancárias), coerente com
//          o próprio fluxo semanal; Compras tem as mesmas entradas/saídas do Administrador
//   E      escrita por QUALQUER view negada a todo authenticated (inclusive Administrador) e a anon
//   F      service_role lê as 21 views de public com o mesmo resultado de antes
//   F2     service_role NÃO tem acesso ao schema mart (sem USAGE): negado antes e depois — inalterado, não é aprovação
//   G      catálogo: nenhuma view de public/mart sem security_invoker (inclui as três do Radar)
//   H      anon: nenhum privilégio em relação nenhuma de public/mart e EXECUTE em função nenhuma; chamadas reais negadas
//   I      funções: authenticated e service_role executam exatamente o que executavam, menos as três fechadas
//   R1     relação cujo acesso vinha por PUBLIC continua acessível a authenticated e service_role, e sem anon
//   J      prevenção por menor privilégio (R10): função NOVA em public, mart, schema novo, SECURITY DEFINER ou de extensão
//          só executa para o dono e service_role; cliente e anon negados até concessão explícita; tabela/view novas sem
//          anon; view nova sem security_invoker é apontada pela guarda G
//   R10    SECURITY DEFINER executáveis pelo cliente = lista explícita (scripts/lib/s3Permissoes.mjs); só do servidor fechadas
//   R9     papéis internos do Supabase: nenhuma concessão nova; Storage, PostgREST, gatilho SECURITY DEFINER do Auth, hook com concessão
//          explícita e leitura por pg_read_all_data funcionam; política a papel interno ou DEFAULT fora de public/mart
//          abortam a 0077
//   R6     retrato em autocommit e com search_path estranho dá as mesmas assinaturas qualificadas
//   Q      ORDEM NUMÉRICA (produção): com a 0077 na posição dela, migrations futuras criam funções já fechadas; a lista
//          R10 vale e toda função usada por política/DEFAULT/CHECK/view tem EXECUTE de quem a avalia (pega concessão
//          esquecida numa 0078+)
//   K      reaplicar a 0077 não muda nada (idempotente)
//   R3     a reversão RECUSA retrato anterior à C1, posterior à 0077, antigo, sem schema ou com concedente estranho, e a
//          execução de uma reversão adulterada que reabriria a C1 é desfeita
//   M      recuperação: a reversão válida devolve exatamente o retrato pós-C1; reaplicar a 0077 volta ao novo
//   L      ordem: C1 + 0077 + 0074 (produção hoje: 0074 pendente) chega ao MESMO retrato que a fila em ordem
//   N      dono NÃO superusuário: a 0077 aplica, preserva o acesso por PUBLIC (R1), funções novas em outro schema e de
//          extensão seguem executáveis (R2), e um grant a anon feito por OUTRO concedente aborta a migration
// NADA TOCA PRODUÇÃO: banco em memória, sem rede, sem segredo, só dados fictícios.
// Como rodar:  node scripts/pg-smoke-views.mjs [--migracao <outra-0077.sql>] [--reversao <outro-s3Reversao.mjs>]
//   (as duas opções são para teste de mutação: com uma versão defeituosa, alguma prova tem de FALHAR)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { bancoComFila } from './lib/pgliteFila.mjs';
import { DEFINER_CLIENTE, SOMENTE_SERVIDOR } from './lib/s3Permissoes.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const arg = (nome) => { const i = process.argv.indexOf(nome); return i > 0 ? path.resolve(process.argv[i + 1]) : null; };
// --raiz <pasta>: outra pasta com supabase/migrations + supabase/seed.sql (teste de mutação: uma 0078 fictícia que
// dependa do padrão antigo tem de fazer a prova Q FALHAR). C1, retrato e reversão vêm sempre deste repositório.
const RAIZ_REPO = path.join(AQUI, '..');
const RAIZ = arg('--raiz') ?? RAIZ_REPO;
const NUM = '0077';
const ARQ_0077 = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).find((f) => f.startsWith(`${NUM}_`));
const SQL_0077 = fs.readFileSync(arg('--migracao') ?? path.join(RAIZ, 'supabase', 'migrations', ARQ_0077), 'utf8');
const SQL_C1 = fs.readFileSync(path.join(RAIZ_REPO, 'docs', 'seguranca', 's3-c1-contencao.sql'), 'utf8');
const { RETRATO_SQL, gerarReversao, VIEWS_S3 } = await import(pathToFileURL(arg('--reversao') ?? path.join(AQUI, 'lib', 's3Reversao.mjs')).href);
const FECHADAS = ['fn_cancel_entry(uuid,text)', 'fn_close_period(uuid,character)', 'fn_reopen_period(uuid,text)'];
// R9: papéis internos como no Supabase (atributos e participações equivalentes): o Auth grava em auth.* como
// supabase_auth_admin; o Storage conecta como supabase_storage_admin e avalia as políticas com SET ROLE authenticated;
// o PostgREST conecta como authenticator e troca para anon/authenticated/service_role; supabase_read_only_user lê tudo
// por pg_read_all_data. Mais um gatilho em auth.users que chama função de public (padrão "novo usuário") e um hook com
// concessão EXPLÍCITA a supabase_auth_admin (o que a documentação do Supabase exige para hooks).
const SQL_PAPEIS_INTERNOS = `
  create role supabase_auth_admin noinherit createrole nologin;
  create role supabase_storage_admin noinherit nologin; grant anon, authenticated, service_role to supabase_storage_admin;
  create role authenticator noinherit nologin; grant anon, authenticated, service_role to authenticator;
  create role supabase_read_only_user nologin bypassrls; grant pg_read_all_data to supabase_read_only_user;
  create role leitor_sem_bypass nologin; grant pg_read_all_data to leitor_sem_bypass;
  grant usage on schema auth to supabase_auth_admin; grant select, insert on auth.users to supabase_auth_admin;
  create function public.f_smoke_novo_usuario() returns trigger language plpgsql security definer as $f$ begin return new; end $f$;
  create trigger smoke_novo_usuario after insert on auth.users for each row execute function public.f_smoke_novo_usuario();
  create function public.f_smoke_hook(e jsonb) returns jsonb language sql stable as 'select e';
  revoke all on function public.f_smoke_hook(jsonb) from public, anon, authenticated;
  grant execute on function public.f_smoke_hook(jsonb) to supabase_auth_admin;`;
const INTERNOS = ['supabase_auth_admin', 'supabase_storage_admin', 'authenticator', 'supabase_read_only_user', 'leitor_sem_bypass'];

const res = { migrations: {}, views: [], antes: {}, depois: {}, diferencas: {}, provas: {} };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];
const negado = (e) => /permission denied/.test(e ?? '');

let db;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let sp = 0;
/** roda `fn` como `uid` no papel de banco `papel` (authenticated, anon ou service_role), num savepoint sempre desfeito */
async function como(uid, fn, papel = 'authenticated') {
  const nome = `sp${++sp}`;
  await db.exec(`savepoint ${nome};`);
  try {
    await db.exec(`set local role ${papel}; select set_config('test.uid', '${uid ?? ''}', true);`);
    const valor = await fn();
    await db.exec('reset role;');
    await db.exec(`rollback to savepoint ${nome};`);
    return { valor, erro: null };
  } catch (e) {
    await db.exec(`rollback to savepoint ${nome};`);
    return { valor: undefined, erro: so(e) };
  }
}
async function emTransacao(sql, banco = db) {
  await banco.exec('begin;');
  try { await banco.exec(sql); await banco.exec('commit;'); return null; } catch (e) { try { await banco.exec('rollback;'); } catch { /* */ } return so(e); }
}
/** executa o retrato (docs/seguranca/s3-0077-retrato.sql) como em produção: transação só leitura, depois desfeita */
async function retrato(banco = db) {
  await banco.exec('begin;');
  try { const r = await banco.exec(RETRATO_SQL); return r.at(-1).rows[0].retrato; } finally { await banco.exec('rollback;'); }
}
/** retrato normalizado: ACL nula vira a padrão do PostgreSQL; itens ordenados; só os quatro papéis da 0077 */
function normal(r) {
  const acl = (a, tipo, dono) => {
    const itens = a ?? (tipo === 'funcao' ? [`=X/${dono}`] : []);
    return itens.map((i) => i.replace(/^"([^"]*)"=/, '$1=')).filter((i) => /^(anon|authenticated|service_role|)=/.test(i)).sort().join(',');
  };
  const padrao = r.padrao.map((d) => [d.schema, d.tipo, acl(d.acl, 'padrao', r.papel)])
    .filter((d) => !(d[0] === null && d[1] === 'f' && d[2] === '=X/' + r.papel) && d[2] !== '');
  return JSON.stringify({
    views: r.views.map((v) => [v.nome, (v.opcoes ?? []).slice().sort().join(','), acl(v.acl, 'v', r.papel)]),
    relacoes: r.relacoes.map((x) => [x.nome, acl(x.acl, x.tipo, r.papel)]),
    funcoes: r.funcoes.map((f) => [f.assinatura, acl(f.acl, 'funcao', r.papel)]),
    padrao: padrao.length || r.padrao.some((d) => d.schema === null && d.tipo === 'f') ? padrao : [],
  });
}
const diff = (a, b) => {
  const A = JSON.parse(a), B = JSON.parse(b), out = [];
  for (const k of Object.keys(A)) {
    const ma = new Map(A[k].map((x) => [JSON.stringify(x.slice(0, -1)), x.at(-1)])), mb = new Map(B[k].map((x) => [JSON.stringify(x.slice(0, -1)), x.at(-1)]));
    for (const [id, v] of ma) if (mb.get(id) !== v) out.push(`${k} ${id}: ${v} → ${mb.get(id) ?? '(ausente)'}`);
    for (const id of mb.keys()) if (!ma.has(id)) out.push(`${k} ${id}: (novo)`);
  }
  return out;
};

const ORG2_ADMIN = 'cccccccc-0000-4000-8000-000000000099';
const ATORES = {
  Administrador: 'cccccccc-0000-4000-8000-000000000001', Diretoria: 'cccccccc-0000-4000-8000-000000000002',
  Financeiro: 'cccccccc-0000-4000-8000-000000000003', Contabilidade: 'cccccccc-0000-4000-8000-000000000004',
  Auditoria: 'cccccccc-0000-4000-8000-000000000005', Compras: 'cccccccc-0000-4000-8000-000000000006',
  'Gestor de obra': 'cccccccc-0000-4000-8000-000000000007', Engenharia: 'cccccccc-0000-4000-8000-000000000008',
  Solicitante: 'cccccccc-0000-4000-8000-000000000009',
};
// papéis que, pela RLS das TABELAS, já leem tudo o que as views de cálculo mostram: resultado tem de ser idêntico
const MESMO_RESULTADO = ['Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria'];
const BLOQUEADOS = ['Solicitante', 'outraOrganizacao', 'anon'];
const RECORTADOS = ['Compras', 'Gestor de obra', 'Engenharia'];
const FLUXO = 'fn_cash_balance_weekly(EIFF)';

const ident = (v) => v.split('.').map((x) => `"${x}"`).join('.');
async function medir(views) {
  const out = {};
  const atores = [...Object.entries(ATORES).map(([k, uid]) => [k, uid, 'authenticated']), ['outraOrganizacao', ORG2_ADMIN, 'authenticated'], ['anon', null, 'anon'], ['service_role', null, 'service_role']];
  for (const [nome, uid, papel] of atores) {
    out[nome] = {};
    for (const v of views) {
      const r = await como(uid, async () => (await q(`select count(*)::int n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from ${ident(v)} t`))[0], papel);
      out[nome][v] = r.erro ? (negado(r.erro) ? 'negado' : `ERRO ${r.erro}`) : { n: r.valor.n, h: r.valor.h.slice(0, 12) };
    }
    const f = await como(uid, async () => (await q(`select count(*)::int n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from fn_cash_balance_weekly((select id from organization where code = 'EIFF'), 13) t where t.inflows <> 0 or t.outflows <> 0 or t.closing_balance <> 0`))[0], papel);
    out[nome][FLUXO] = f.erro ? (negado(f.erro) ? 'negado' : `ERRO ${f.erro}`) : { n: f.valor.n, h: f.valor.h.slice(0, 12) };
  }
  return out;
}
const linhas = (x) => (x && typeof x === 'object' ? x.n : 0);
/** guarda G (a mesma que o Quality Gate usa): views de public/mart sem security_invoker */
const semInvoker = async () => (await q(`select n.nspname || '.' || c.relname v from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname in ('public','mart') and not coalesce(c.reloptions && array['security_invoker=true','security_invoker=on','security_invoker=1'], false) order by 1`)).map((r) => r.v);
const funcoesMapa = async () => Object.fromEntries((await q(`select p.oid::regprocedure::text f,
    has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u, has_function_privilege('service_role', p.oid, 'EXECUTE') s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','mart')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`)).map((r) => [r.f, [r.a, r.u, r.s]]));

try {
  ({ db } = await bancoComFila(RAIZ, { excluir: [NUM] }));
  res.migrations.fila = `0001..última sem a ${NUM}`;

  // ---- cenário fictício (gravado de verdade; C1 e 0077 rodam depois, em transações próprias, como em produção) ----
  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const cia = await um(`select id from company where organization_id = $1 order by code limit 1`, [org]);
  const obra1 = await um(`select id from project where organization_id = $1 order by code limit 1`, [org]);
  const servico1 = await um(`select id from project_service where project_id = $1 order by code limit 1`, [obra1]);
  const colunas = async (t) => (await q(`select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`, [t]))[0].c;
  const copiar = async (t, troca, onde, p) => um(`insert into ${t} (${await colunas(t)}) select ${await colunas(t)} from jsonb_populate_record(null::${t}, (select to_jsonb(x) || ${troca} from ${t} x where ${onde})) returning id`, p);
  const obra2 = await copiar('project', `jsonb_build_object('id', gen_random_uuid(), 'code', 'OB-SMOKE-02', 'name', 'Obra do smoke')`, 'x.id = $1', [obra1]);
  await copiar('financial_entry', `jsonb_build_object('id', gen_random_uuid(), 'code', 'PAG-SMOKE-2', 'project_id', $1::uuid, 'service_id', null, 'external_id', null)`,
    `x.id = (select id from financial_entry where organization_id = $2 and entry_type = 'Saída' and status <> 'Cancelado' order by code limit 1)`, [obra2, org]);
  // obra 2 também com um serviço, uma medição e um avanço físico (views de serviço medem o recorte)
  const servico2 = await copiar('project_service', `jsonb_build_object('id', gen_random_uuid(), 'project_id', $1::uuid, 'code', 'SMOKE-S2')`, 'x.id = $2', [obra2, servico1]);
  await copiar('measurement', `jsonb_build_object('id', gen_random_uuid(), 'project_id', $1::uuid, 'service_id', $2::uuid, 'entry_id', null)`,
    `x.id = (select id from measurement where project_id = $3 order by 1 limit 1)`, [obra2, servico2, obra1]);
  const radar = await um(`insert into radar_company (organization_id, legal_name, city, state) values ($1, 'Empresa Ficticia do Smoke', 'Cidade', 'GO') returning id`, [org]);
  await q(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value) values ($1, $2, 'Oportunidade ficticia', 'DETECTED', 1000)`, [org, radar]);
  // uma linha nas tabelas de base das views de estoque, compras, materiais, fábrica, apontamento e capacitação, NAS DUAS
  // obras quando a view é por obra (mede o recorte de Gestor/Engenharia em todas elas)
  const item = await um(`insert into stock_item (organization_id, code, description, family) values ($1, 'AC-SMOKE', 'Perfil ficticio', 'Perfil') returning id`, [org]);
  await q(`insert into stock_movement (organization_id, moved_on, kind, item_id, location, quantity_kg, unit_cost, heat_number) values ($1, current_date, 'Entrada', $2, 'Fábrica', 1000, 8, 'CORRIDA-1')`, [org, item]);
  for (const ob of [obra1, obra2]) {
    await q(`insert into stock_movement (organization_id, moved_on, kind, item_id, location, quantity_kg, unit_cost, heat_number, project_id) values ($1, current_date, 'Consumo', $2, 'Fábrica', 100, 8, 'CORRIDA-1', $3)`, [org, item, ob]);
    const po = await um(`insert into purchase_order (organization_id, project_id, code, supplier_name) values ($1, $2, $3, 'Fornecedor ficticio') returning id`, [org, ob, `PC-SMOKE-${ob === obra1 ? 1 : 2}`]);
    await q(`insert into purchase_order_item (order_id, item_order, description, quantity, unit_price) values ($1, 1, 'Item ficticio', 2, 50)`, [po]);
    await q(`insert into assembly (organization_id, project_id, mark, quantity, unit_weight) values ($1, $2, 'V-SMOKE', 2, 150)`, [org, ob]);
    await q(`insert into station_log (organization_id, project_id, log_date, line, station, weight_kg, workers) values ($1, $2, current_date, 'Fabricação', 'Corte', 300, '[{"horas": 4}]')`, [org, ob]);
  }
  const trabalhador = await um(`insert into worker (organization_id, name, role_name, hourly_cost) values ($1, 'Colaborador ficticio', 'Montador', 30) returning id`, [org]);
  const folha = await um(`insert into timesheet (organization_id, work_date, location, project_id) values ($1, current_date, 'Obra', $2) returning id`, [org, obra1]);
  await q(`insert into timesheet_line (timesheet_id, worker_id, attendance, hours, service_id) values ($1, $2, 'Presente', 8, $3)`, [folha, trabalhador, servico1]);
  // outra organização com um Administrador e nenhum dado
  const org2 = await um(`insert into organization (code, name) values ('OUTRA', 'Outra empresa') returning id`);
  await q(`insert into company (organization_id, code, name) values ($1, 'OUTRA', 'Outra empresa')`, [org2]);
  await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Admin da outra', 'adm@outra', 'Administrador')`, [ORG2_ADMIN, org2]);
  for (const [papel, uid] of Object.entries(ATORES)) {
    await q(`insert into profile (id, organization_id, name, email, role) values ($1, $2, $3, $4, $5)`, [uid, org, `Smoke ${papel}`, `${uid}@t`, papel]);
    // escopo como no seed_profiles: empresa para os papéis de empresa; obra 1 para Gestor/Engenharia; o Solicitante
    // recebe a empresa inteira de propósito (pior caso de configuração: mesmo assim não pode ler nada)
    if (['Financeiro', 'Contabilidade', 'Auditoria', 'Compras', 'Solicitante'].includes(papel)) await q(`insert into user_scope (organization_id, profile_id, company_id, project_id) values ($1,$2,$3,null)`, [org, uid, cia]);
    if (['Gestor de obra', 'Engenharia'].includes(papel)) await q(`insert into user_scope (organization_id, profile_id, company_id, project_id) values ($1,$2,$3,$4)`, [org, uid, cia, obra1]);
  }
  await q(`insert into training_progress (organization_id, user_id, lesson_id) values ($1, $2, 'licao-smoke'), ($1, $3, 'licao-smoke'), ($1, $4, 'licao-smoke'), ($1, $5, 'licao-smoke')`,
    [org, ATORES.Administrador, ATORES.Engenharia, ATORES.Contabilidade, ATORES.Auditoria]);
  await db.exec(SQL_PAPEIS_INTERNOS);
  // R1: tabela cujo acesso de authenticated e service_role vem SÓ por PUBLIC (como um grant feito pelo painel)
  await db.exec(`create table public.t_smoke_publico (id int); revoke all on public.t_smoke_publico from anon, authenticated, service_role;
    grant select on public.t_smoke_publico to public; insert into public.t_smoke_publico values (1);`);
  await db.exec('commit;');

  res.views = (await q(`select schemaname || '.' || viewname v from pg_views where schemaname in ('public', 'mart') order by 1`)).map((r) => r.v);
  res.atualizaveis = (await q(`select table_schema || '.' || table_name v from information_schema.views where table_schema in ('public','mart') and (is_updatable = 'YES' or is_insertable_into = 'YES') order by 1`)).map((r) => r.v);

  // ---- ANTES (sem C1 e sem 0077: o banco como estava em 16/11) ----
  await db.exec('begin;');
  res.antes = await medir(res.views);
  const escSolAntes = await como(ATORES.Solicitante, async () => um(`with u as (update v_parameter set responsible = 'smoke-invasor' returning 1) select count(*)::int from u`));
  const escAnonAntes = await como(null, async () => um(`with u as (update v_radar_company_queue set city = 'invadida' returning 1) select count(*)::int from u`), 'anon');
  await db.exec('rollback;');
  const vazou = (a) => res.views.filter((v) => linhas(res.antes[a][v]) > 0);
  prova('A0 reprodução: sem C1/0077, Solicitante, outra organização e anon leem dados da EIFF pelas views',
    vazou('Solicitante').length > 0 && vazou('outraOrganizacao').length > 0 && vazou('anon').length > 0,
    `Solicitante lê ${vazou('Solicitante').length} views · outra organização ${vazou('outraOrganizacao').length} · anon ${vazou('anon').length}`);
  prova('A1 reprodução: escrita pela view auto-atualizável grava na tabela (Solicitante em v_parameter, anon em v_radar_company_queue)',
    escSolAntes.valor > 0 && escAnonAntes.valor > 0, `Solicitante: ${escSolAntes.erro ?? `${escSolAntes.valor} linha(s)`} · anon: ${escAnonAntes.erro ?? `${escAnonAntes.valor} linha(s)`} · atualizáveis: ${res.atualizaveis.join(', ')}`);

  // ---- C1 (o SQL registrado, idêntico ao executado em produção) ----
  const errC1 = await (async () => { try { await db.exec(SQL_C1); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  res.migrations.C1 = errC1 ? `ERRO: ${errC1}` : 'APLICADA (estado de produção desde 17/11)';
  if (errC1) throw new Error(`C1: ${errC1}`);
  const retratoAntes = await retrato();
  const funcoesAntes = await funcoesMapa();

  // ---- P: pré-condição fecha sem alterar nada ----
  await db.exec('begin; create view public.v_smoke_intrusa as select 1 x; commit;');
  const errP = await emTransacao(SQL_0077);
  await db.exec('begin; drop view public.v_smoke_intrusa; commit;');
  prova('P pré-condição: inventário de views diferente aborta a 0077 e nada muda',
    /inventário de views divergente/.test(errP ?? '') && normal(await retrato()) === normal(retratoAntes), `${(errP ?? 'aplicou!').slice(0, 90)}…`);

  // ---- R9 antes: o que os papéis internos têm hoje só por PUBLIC; guardas da 0077 contra dependência de papel interno ----
  const internoAntes = {};
  await db.exec('begin;');
  internoAntes.authOrg = (await q(`select has_function_privilege('supabase_auth_admin', 'public.current_org()', 'EXECUTE') x`))[0].x;
  // leitor com pg_read_all_data SEM bypassrls: a RLS chama current_org(), que para ele devolve nulo — lia 0 linhas
  await db.exec('savepoint lr; set local role leitor_sem_bypass;');
  internoAntes.leitorSemBypass = await um(`select count(*)::int from financial_entry`);
  await db.exec('rollback to savepoint lr;');
  internoAntes.aclInternos = await um(`select count(*)::int from (select relacl acl from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','mart')
      union all select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','mart')) o, aclexplode(o.acl) a
    where a.grantee in (select oid from pg_roles where rolname = any($1))`, [INTERNOS]);
  await db.exec('rollback;');
  await db.exec(`begin; create policy smoke_interna on public.t_smoke_publico for select to supabase_auth_admin using (true); commit;`);
  const errR9a = await emTransacao(SQL_0077);
  await db.exec('begin; drop policy smoke_interna on public.t_smoke_publico; commit;');
  await db.exec(`begin; create table auth.t_smoke_dep (o uuid default public.current_org()); commit;`);
  const errR9b = await emTransacao(SQL_0077);
  await db.exec('begin; drop table auth.t_smoke_dep; commit;');
  const intactoR9 = normal(await retrato()) === normal(retratoAntes);

  // ---- 0077 (transação própria, como em produção) e reaplicação ----
  const err1 = await emTransacao(SQL_0077);
  res.migrations[NUM] = err1 ? `ERRO: ${err1}` : 'APLICADA';
  if (err1) throw new Error(`0077: ${err1}`);
  const retratoDepois = await retrato();
  const err2 = await emTransacao(SQL_0077);
  prova('K reaplicar a 0077 não muda nada (idempotente)', !err2 && normal(await retrato()) === normal(retratoDepois), err2 ?? 'retrato idêntico');

  // ---- DEPOIS ----
  await db.exec('begin;');
  res.depois = await medir(res.views);
  await db.exec('rollback;');

  // S medido DEPOIS: antes, mart.cash_weekly lia uma organização arbitrária (a outra, vazia) — ver C2
  const vaziasAdm = res.views.filter((v) => linhas(res.depois.Administrador[v]) === 0);
  prova('S cenário: todas as 25 views têm linha para o Administrador', vaziasAdm.length === 0 && res.views.length === 25,
    vaziasAdm.length ? `vazias: ${vaziasAdm.join(', ')}` : `${res.views.length} views com dado (${res.views.map((v) => `${v.replace('public.', '')}=${linhas(res.depois.Administrador[v])}`).join(', ')})`);

  const naoBloqueado = [];
  for (const a of BLOQUEADOS) for (const v of [...res.views, FLUXO]) {
    const x = res.depois[a][v];
    if (!(x === 'negado' || (typeof x === 'object' && x.n === 0))) naoBloqueado.push(`${a} ${v}: ${JSON.stringify(x)}`);
  }
  prova('B Solicitante, Administrador de outra organização e anon: 0 linhas ou negado em TODA view e no fluxo de caixa',
    naoBloqueado.length === 0, naoBloqueado.join(' · ') || `${res.views.length} views + ${FLUXO}`);

  // mart.cash_weekly lê o fluxo de `(select id from organization limit 1)`: como dono, com duas organizações, a "primeira"
  // era arbitrária. Com invoker, cada papel só enxerga a própria organização. É correção, conferida em C2.
  // v_training_progress: a RLS de training_progress (tp_select) deixa Contabilidade e Auditoria verem só o PRÓPRIO
  // progresso (Administrador, Diretoria, Financeiro e Gestor de obra veem a equipe). Pela view, antes, viam o de todos.
  // Também é correção, conferida em C3.
  const EXCECOES_C = new Set(['Contabilidade|public.v_training_progress', 'Auditoria|public.v_training_progress']);
  const mudou = [];
  for (const a of MESMO_RESULTADO) for (const v of [...res.views, FLUXO]) {
    if (v === 'mart.cash_weekly' || EXCECOES_C.has(`${a}|${v}`)) continue;
    if (JSON.stringify(res.antes[a][v]) !== JSON.stringify(res.depois[a][v])) mudou.push(`${a} ${v}: ${JSON.stringify(res.antes[a][v])} → ${JSON.stringify(res.depois[a][v])}`);
  }
  prova(`C sem regressão: ${MESMO_RESULTADO.join(', ')} com resultado IDÊNTICO (contagem + md5) em toda view`, mudou.length === 0, mudou.join(' · ') || `idênticos em ${res.views.length - 1} views + fluxo`);
  await db.exec('begin;');
  const c2 = [];
  for (const a of MESMO_RESULTADO) {
    const r = await como(ATORES[a], async () => (await q(`select (select md5(string_agg(t::text, '|' order by t::text)) from mart.cash_weekly t) m,
      (select md5(string_agg(t::text, '|' order by t::text)) from fn_cash_balance_weekly(current_org(), 13) t) f`))[0]);
    c2.push(`${a} ${r.valor && r.valor.m === r.valor.f ? 'ok' : JSON.stringify(r.valor ?? r.erro)}`);
  }
  await db.exec('rollback;');
  await db.exec('begin;');
  const c3 = [];
  for (const a of ['Contabilidade', 'Auditoria']) {
    const r = await como(ATORES[a], async () => (await q(`select (select count(*)::int from v_training_progress) v,
      (select count(*)::int from v_training_progress where user_id <> auth.uid()) outros, (select count(*)::int from training_progress) t`))[0]);
    c3.push({ a, ok: r.valor && r.valor.outros === 0 && r.valor.v === 1 && r.valor.t === 1, d: `${a}: view ${r.valor?.v ?? r.erro} (de outros: ${r.valor?.outros}) · tabela ${r.valor?.t} · antes pela view ${linhas(res.antes[a]['public.v_training_progress'])}` });
  }
  await db.exec('rollback;');
  prova('C3 v_training_progress: Contabilidade e Auditoria passam a ver o próprio progresso (1 linha) e nada dos outros, como a RLS da tabela (tp_select)',
    c3.every((x) => x.ok) && c3.every((x) => linhas(res.antes[x.a]['public.v_training_progress']) > 0), c3.map((x) => x.d).join(' · '));
  prova('C2 mart.cash_weekly passa a mostrar o fluxo da organização de quem consulta (antes: a "primeira" organização, arbitrária)',
    c2.every((x) => x.endsWith('ok')), `${c2.join(' · ')} · antes (Administrador): ${JSON.stringify(res.antes.Administrador['mart.cash_weekly'])}`);

  // D. recorte por obra em TODA view que tem obra: pela view, Gestor/Engenharia veem a obra do escopo e nunca a outra
  for (const a of RECORTADOS) {
    res.diferencas[a] = res.views.filter((v) => JSON.stringify(res.antes[a][v]) !== JSON.stringify(res.depois[a][v]))
      .map((v) => `${v.replace('public.', '')}: ${linhas(res.antes[a][v])} → ${typeof res.depois[a][v] === 'object' ? res.depois[a][v].n : res.depois[a][v]}`);
  }
  const VIEWS_OBRA = { 'public.v_financial_entry_calc': 'project_id', 'public.v_project_360': 'id', 'mart.project_360': 'id', 'public.v_service_cost': 'project_id',
    'public.v_service_billing': 'project_id', 'public.v_service_progress': 'project_id', 'public.v_purchase_order': 'project_id', 'public.v_service_weight': 'project_id',
    'public.v_station_productivity': 'project_id', 'public.v_steel_cost_by_service': 'project_id', 'public.v_heat_traceability': 'project_code', 'public.v_service_labor': 'project_id' };
  const codigo = async (id) => um(`select code from project where id = $1`, [id]);
  const [cod1, cod2] = [await codigo(obra1), await codigo(obra2)];
  await db.exec('begin;');
  const recorte = [];
  for (const a of ['Gestor de obra', 'Engenharia']) {
    const det = [];
    for (const [v, col] of Object.entries(VIEWS_OBRA)) {
      const p = col === 'project_code' ? [cod1, cod2] : [obra1, obra2];
      const viaView = await como(ATORES[a], async () => (await q(`select count(*) filter (where ${col} = $1)::int o1, count(*) filter (where ${col} = $2)::int o2 from ${ident(v)}`, p))[0]);
      const viaAdm = await como(ATORES.Administrador, async () => (await q(`select count(*) filter (where ${col} = $1)::int o1, count(*) filter (where ${col} = $2)::int o2 from ${ident(v)}`, p))[0]);
      const ok = viaView.valor && viaView.valor.o2 === 0 && viaView.valor.o1 === viaAdm.valor.o1 && viaAdm.valor.o1 > 0 && (v === 'public.v_service_labor' || viaAdm.valor.o2 > 0);
      det.push(`${v.replace('public.', '')} ${ok ? 'ok' : `FALHA ${JSON.stringify(viaView.valor ?? viaView.erro)} adm ${JSON.stringify(viaAdm.valor)}`}`);
    }
    const contas = await como(ATORES[a], async () => um(`select count(*)::int from v_opening_balance`));
    det.push(`saldo de abertura ${contas.valor === 0 ? 'ok (0)' : `FALHA ${contas.valor ?? contas.erro}`}`);
    recorte.push({ a, ok: det.every((x) => !x.includes('FALHA')), d: `${a}: ${det.filter((x) => x.includes('FALHA')).join(', ') || `${Object.keys(VIEWS_OBRA).length} views por obra só com a obra do escopo (a outra obra tem linha para o Administrador em todas, menos v_service_labor, que só tem apontamento na obra 1), saldo de abertura 0`}` });
  }
  const obra2Adm = await como(ATORES.Administrador, async () => um(`select count(*)::int from v_station_productivity where project_id = $1`, [obra2]));
  await db.exec('rollback;');
  prova('D recorte: Gestor de obra e Engenharia veem, em toda view por obra, só a obra do escopo (como a RLS das tabelas)',
    recorte.every((x) => x.ok) && obra2Adm.valor > 0, recorte.map((x) => x.d).join(' | '));

  // D2. fluxo de caixa dos papéis que não veem conta bancária: saldo inicial ZERO, coerente com o próprio fluxo
  await db.exec('begin;');
  const fluxo = async (uid) => (await como(uid, async () => q(`with b as (select * from fn_cash_balance_weekly(current_org(), 13)),
      f as (select week_no, sum(case when entry_type = 'Entrada' then amount else 0 end) e, sum(case when entry_type = 'Saída' then amount else 0 end) s
            from fn_cash_flow_weekly(current_org(), 13) group by week_no),
      ob as (select coalesce(sum(opening_balance), 0) ob from v_opening_balance)
    select b.week_no, b.inflows, b.outflows, b.closing_balance, (select ob from ob) ob,
      (select ob from ob) + sum(f.e - f.s) over (order by f.week_no) recalculado
    from b join f using (week_no) order by b.week_no`))).valor;
  const fAdm = await fluxo(ATORES.Administrador);
  const d2 = [];
  for (const a of RECORTADOS) {
    const f = await fluxo(ATORES[a]);
    const zero = f.every((x) => Number(x.ob) === 0);
    const coerente = f.every((x) => Math.abs(Number(x.closing_balance) - Number(x.recalculado)) < 0.005);
    const semana1 = f[0];
    let extra = '';
    if (a === 'Compras') {
      const iguais = f.every((x, i) => Number(x.inflows) === Number(fAdm[i].inflows) && Number(x.outflows) === Number(fAdm[i].outflows));
      const desloc = f.every((x, i) => Math.abs(Number(fAdm[i].closing_balance) - Number(x.closing_balance) - Number(fAdm[0].ob)) < 0.005);
      extra = ` · entradas/saídas iguais às do Administrador: ${iguais} · saldo = Administrador − abertura (${fAdm[0].ob}): ${desloc}`;
      if (!iguais || !desloc) extra += ' FALHA';
    }
    d2.push(`${a}: abertura 0 ${zero} · saldo = acumulado do próprio fluxo ${coerente} · semana 1 saldo ${semana1.closing_balance}${extra}`);
  }
  await db.exec('rollback;');
  prova('D2 fluxo de caixa de Compras, Gestor e Engenharia: parte de saldo ZERO (sem contas bancárias) e é coerente; Compras = Administrador menos a abertura',
    d2.every((x) => !x.includes('false') && !x.includes('FALHA')) && Number(fAdm[0].ob) !== 0, `${d2.join(' | ')} · Administrador: abertura ${fAdm[0].ob}`);

  // E. escrita por view: privilégio efetivo de TODO papel do cliente + tentativas reais nas duas auto-atualizáveis
  const escPriv = await q(`select n.nspname || '.' || c.relname v, papel, pv from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pv cross join unnest(array['anon','authenticated']) papel
    where c.relkind = 'v' and n.nspname in ('public','mart') and has_table_privilege(papel, c.oid, pv)`);
  await db.exec('begin;');
  const tentativas = [];
  for (const [quem, uid, papel] of [['Administrador', ATORES.Administrador, 'authenticated'], ['Solicitante', ATORES.Solicitante, 'authenticated'], ['anon', null, 'anon']]) {
    const a = await como(uid, async () => um(`with u as (update v_parameter set responsible = 'smoke-invasor' returning 1) select count(*)::int from u`), papel);
    const b = await como(uid, async () => um(`with u as (update v_radar_company_queue set city = 'invadida' returning 1) select count(*)::int from u`), papel);
    tentativas.push(`${quem}: v_parameter ${a.erro ? (negado(a.erro) ? 'negado' : a.erro) : a.valor} / fila ${b.erro ? (negado(b.erro) ? 'negado' : b.erro) : b.valor}`);
    if (!negado(a.erro) || !negado(b.erro)) tentativas.push('FALHA');
  }
  await db.exec('rollback;');
  prova('E escrita por QUALQUER view negada a anon e a todo authenticated (inclusive Administrador)',
    escPriv.length === 0 && !tentativas.includes('FALHA'), escPriv.length ? escPriv.map((r) => `${r.v} ${r.papel} ${r.pv}`).join(', ') : tentativas.join(' · '));

  const publicas = res.views.filter((v) => v.startsWith('public.'));
  const martv = res.views.filter((v) => v.startsWith('mart.'));
  const svcMudou = publicas.filter((v) => JSON.stringify(res.antes.service_role[v]) !== JSON.stringify(res.depois.service_role[v]) || typeof res.depois.service_role[v] !== 'object');
  prova('F service_role (servidor) lê as 21 views de public com o mesmo resultado de antes', svcMudou.length === 0 && publicas.length === 21,
    svcMudou.join(', ') || `${publicas.length} views idênticas (lançamentos: ${linhas(res.depois.service_role['public.v_financial_entry_calc'])})`);
  const svcMart = martv.map((v) => `${v}: ${JSON.stringify(res.antes.service_role[v])} → ${JSON.stringify(res.depois.service_role[v])}`);
  const svcUsage = await um(`select has_schema_privilege('service_role', 'mart', 'USAGE')`);
  prova('F2 service_role NÃO acessa o schema mart (sem USAGE): negado antes e depois — a 0077 não muda isso e não há aprovação a declarar',
    martv.every((v) => res.antes.service_role[v] === 'negado' && res.depois.service_role[v] === 'negado') && svcUsage === false, `${svcMart.join(' · ')} · USAGE em mart: ${svcUsage}`);

  const sem = await semInvoker();
  prova('G catálogo: nenhuma view de public/mart sem security_invoker (inclui as três do Radar)', sem.length === 0, sem.join(', ') || `${res.views.length} views com security_invoker`);

  // H. anon fora de tudo: catálogo (relações e funções) + chamadas reais
  const anonRel = await q(`select n.nspname || '.' || c.relname || ' ' || pv x from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pv
    where c.relkind in ('r','p','v','m','f') and n.nspname in ('public','mart') and has_table_privilege('anon', c.oid, pv)
    union all select n.nspname || '.' || c.relname || ' sequência' from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname in ('public','mart') and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'SELECT') or has_sequence_privilege('anon', c.oid, 'UPDATE'))`);
  const funcoesDepois = await funcoesMapa();
  const anonFn = Object.entries(funcoesDepois).filter(([, [a]]) => a).map(([f]) => f);
  await db.exec('begin;');
  const chamadas = [];
  for (const sql of [`select count(*) from financial_entry`, `select count(*) from bank_account`, `select count(*) from radar_company`, `select count(*) from t_smoke_publico`,
    `select count(*) from fn_checks((select id from organization limit 1))`, `select count(*) from fn_cash_flow_weekly(null, 13)`,
    `select count(*) from fn_cash_flow_monthly(null, 24)`, `select current_org()`, `select df_meus_pedidos()`, `select fn_cancel_entry(null, 'x')`]) {
    const r = await como(null, async () => um(sql), 'anon');
    chamadas.push(`${sql.replace(/^select (count\(\*\) from )?/, '')}: ${r.erro ? (negado(r.erro) ? 'negado' : `ERRO ${r.erro}`) : `PERMITIDO (${r.valor})`}`);
  }
  await db.exec('rollback;');
  prova('H anon: nenhum privilégio em relação de public/mart, EXECUTE em nenhuma função, e chamadas reais negadas',
    anonRel.length === 0 && anonFn.length === 0 && chamadas.every((c) => c.endsWith('negado')),
    [anonRel.length ? `relações: ${anonRel.map((r) => r.x).join(', ')}` : '', anonFn.length ? `funções: ${anonFn.join(', ')}` : '', chamadas.join(' · ')].filter(Boolean).join(' | '));

  // I. funções preservadas para authenticated e service_role (menos as três fechadas)
  const mudouFn = [];
  for (const [f, [, u, s]] of Object.entries(funcoesDepois)) {
    const [, ua, sa] = funcoesAntes[f] ?? [];
    const fechada = FECHADAS.some((x) => f.endsWith(x));
    if (fechada ? (u || !s) : (u !== ua || s !== sa)) mudouFn.push(`${f}: auth ${ua}→${u}, svc ${sa}→${s}`);
  }
  await db.exec('begin;');
  const admCancela = await como(ATORES.Administrador, async () => um(`select fn_cancel_entry(null, 'x')`));
  const admFecha = await como(ATORES.Administrador, async () => um(`select fn_close_period(null, '2026-11')`));
  const admOrg = await como(ATORES.Administrador, async () => um(`select current_org()`));
  const svcCancela = await como(null, async () => um(`select fn_cancel_entry(null, 'x')`), 'service_role');
  await db.exec('rollback;');
  prova('I funções: authenticated e service_role executam o mesmo que antes; as três definer sem checagem de organização fecham para authenticated',
    mudouFn.length === 0 && negado(admCancela.erro) && negado(admFecha.erro) && admOrg.valor === org && !negado(svcCancela.erro),
    mudouFn.join(' · ') || `${Object.keys(funcoesDepois).length} funções conferidas · Administrador: fn_cancel_entry ${admCancela.erro ? 'negado' : 'PERMITIDO'}, fn_close_period ${admFecha.erro ? 'negado' : 'PERMITIDO'}, current_org ${admOrg.valor === org ? 'ok' : admOrg.erro} · service_role: fn_cancel_entry ${negado(svcCancela.erro) ? 'negado' : 'executa (a função recusa pela regra de papel)'}`);

  // R1. relação acessível só por PUBLIC antes da 0077
  await db.exec('begin;');
  const r1 = {
    auth: await como(ATORES.Administrador, async () => um(`select count(*)::int from t_smoke_publico`)),
    svc: await como(null, async () => um(`select count(*)::int from t_smoke_publico`), 'service_role'),
    anon: await como(null, async () => um(`select count(*)::int from t_smoke_publico`), 'anon'),
  };
  const r1acl = await um(`select relacl::text from pg_class where oid = 'public.t_smoke_publico'::regclass`);
  await db.exec('rollback;');
  prova('R1 tabela acessível só por PUBLIC antes: authenticated e service_role continuam lendo (concessão explícita do que tinham), anon e PUBLIC não',
    r1.auth.valor === 1 && r1.svc.valor === 1 && negado(r1.anon.erro) && !/(^|[{,])=/.test(r1acl),
    `authenticated ${r1.auth.valor ?? r1.auth.erro} · service_role ${r1.svc.valor ?? r1.svc.erro} · anon ${r1.anon.erro ? 'negado' : r1.anon.valor} · ACL ${r1acl}`);

  // J. prevenção por menor privilégio (R10): objetos novos do dono depois da 0077, em public, mart, num schema novo e
  //    de uma extensão instalada depois. Função nova só executa para o dono e service_role; o cliente só depois de
  //    concessão explícita. Inclui SECURITY DEFINER "só do servidor".
  await db.exec('begin;');
  await db.exec(`create schema extra_smoke; grant usage on schema extra_smoke to authenticated, service_role, anon;
    create table public.t_smoke_nova (id int); create view public.v_smoke_nova as select 1 x;
    create function public.f_smoke_nova() returns int language sql as 'select 1';
    create function mart.f_smoke_nova() returns int language sql as 'select 1';
    create function extra_smoke.f_smoke_nova() returns int language sql as 'select 1';
    create function public.f_smoke_servidor() returns int language sql security definer as 'select 2';
    create function mart.f_smoke_servidor() returns int language sql security definer as 'select 2';
    create function extra_smoke.f_smoke_servidor() returns int language sql security definer as 'select 2';`);
  const fnNovas = ['public.f_smoke_nova()', 'mart.f_smoke_nova()', 'extra_smoke.f_smoke_nova()', 'public.f_smoke_servidor()', 'mart.f_smoke_servidor()', 'extra_smoke.f_smoke_servidor()'];
  const novaT = (await q(`select
      (select bool_or(has_table_privilege('anon', 'public.t_smoke_nova', p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) anon_tabela,
      (select bool_or(has_table_privilege('anon', 'public.v_smoke_nova', p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) anon_view,
      has_table_privilege('authenticated', 'public.t_smoke_nova', 'SELECT') auth_tabela`))[0];
  const novaF = [];
  for (const f of fnNovas) {
    const x = (await q(`select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') anon, has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') auth,
      has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') svc,
      exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = $1::regprocedure and a.grantee = 0) publico`, [f]))[0];
    const cli = await como(ATORES.Administrador, async () => um(`select ${f}`));
    const anonCh = await como(null, async () => um(`select ${f}`), 'anon');
    const svcCh = await como(null, async () => um(`select ${f}`), 'service_role');
    novaF.push({ f, ...x, cliente: cli.erro ? (negado(cli.erro) ? 'negado' : cli.erro) : cli.valor, anonCh: anonCh.erro ? (negado(anonCh.erro) ? 'negado' : anonCh.erro) : anonCh.valor, svcCh: svcCh.valor ?? svcCh.erro });
  }
  // concessão explícita libera o cliente (o caminho certo para RPC do app)
  await db.exec(`grant execute on function extra_smoke.f_smoke_nova() to authenticated;`);
  const comGrant = await como(ATORES.Administrador, async () => um(`select extra_smoke.f_smoke_nova()`));
  // extensão instalada pelo dono DEPOIS da 0077 (o pgcrypto da fila é removido e recriado num schema novo, só aqui)
  let ext;
  try {
    await db.exec(`savepoint ext; drop extension pgcrypto; create extension pgcrypto schema extra_smoke;`);
    ext = (await q(`select pg_get_userbyid(p.proowner) dono, has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
      has_function_privilege('service_role', p.oid, 'EXECUTE') svc from pg_proc p where p.oid = 'extra_smoke.gen_random_bytes(integer)'::regprocedure`))[0];
    const svcExt = await como(null, async () => um(`select length(extra_smoke.gen_random_bytes(4))`), 'service_role');
    ext.servidor = svcExt.valor ?? svcExt.erro;
    await db.exec('rollback to savepoint ext;');
  } catch (e) { ext = { erro: so(e) }; try { await db.exec('rollback to savepoint ext;'); } catch { /* */ } }
  const guardaVe = (await semInvoker()).includes('public.v_smoke_nova');
  await db.exec('rollback;');
  const jOk = !novaT.anon_tabela && !novaT.anon_view && novaT.auth_tabela && guardaVe && comGrant.valor === 1
    && novaF.every((x) => !x.anon && !x.auth && x.svc && !x.publico && x.cliente === 'negado' && x.anonCh === 'negado'
      && (x.f.startsWith('mart.') ? /permission denied for schema mart/.test(String(x.svcCh)) : (x.svcCh === 1 || x.svcCh === 2)))
    && !ext.auth && ext.svc && !ext.anon && ext.servidor === 4;
  prova('J prevenção por menor privilégio: função NOVA (public, mart, schema novo, SECURITY DEFINER e extensão) só executa para o dono e service_role; cliente e anon negados até concessão explícita; em mart o service_role segue sem USAGE no schema, como em F2; tabela/view novas sem anon; view sem invoker apontada',
    jOk, `${JSON.stringify(novaT)} · ${novaF.map((x) => `${x.f}: anon ${x.anon} auth ${x.auth} svc ${x.svc} PUBLIC ${x.publico} | chamada cliente ${x.cliente}, anon ${x.anonCh}, servidor ${x.svcCh}`).join(' · ')} · com grant explícito o cliente executa: ${comGrant.valor ?? comGrant.erro} · extensão instalada depois (pgcrypto): ${JSON.stringify(ext)} · guarda G aponta a view nova: ${guardaVe}`);

  // R10. lista explícita das SECURITY DEFINER executáveis pelo cliente (scripts/lib/s3Permissoes.mjs) e das só do servidor
  const r10 = await conferirR10();
  prova('R10 SECURITY DEFINER executáveis pelo cliente = lista explícita (scripts/lib/s3Permissoes.mjs); as só do servidor fechadas para authenticated e anon e abertas ao service_role',
    r10.ok, r10.detalhe);

  // R9. papéis internos depois da 0077: nada concedido a eles; os fluxos reais do Supabase continuam funcionando
  await db.exec('begin;');
  const r9 = {};
  r9.aclInternos = await um(`select count(*)::int from (select relacl acl from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','mart')
      union all select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','mart')) o, aclexplode(o.acl) a
    where a.grantee in (select oid from pg_roles where rolname = any($1))`, [INTERNOS]);
  const passo = async (nome, sql) => {
    await db.exec('savepoint r9;');
    try { const v = (await db.exec(sql)).at(-1).rows[0]; await db.exec('rollback to savepoint r9;'); r9[nome] = v ? Object.values(v)[0] : 'ok'; }
    catch (e) { await db.exec('rollback to savepoint r9;'); r9[nome] = negado(so(e)) ? 'negado' : `ERRO ${so(e)}`; }
  };
  await passo('storage', `set local role supabase_storage_admin; set local role authenticated; select set_config('test.uid', '${ATORES.Administrador}', true);
    select (select count(*) from storage.objects) >= 0 and anexo_pode_ver(null) is not distinct from anexo_pode_ver(null) ok;`);
  await passo('postgrestCliente', `set local role authenticator; set local role authenticated; select set_config('test.uid', '${ATORES.Administrador}', true); select current_org() = '${org}' ok;`);
  await passo('postgrestAnon', `set local role authenticator; set local role anon; select current_org();`);
  await passo('authGatilho', `set local role supabase_auth_admin; insert into auth.users (id, email) values (gen_random_uuid(), 'novo@smoke') returning true ok;`);
  await passo('authHook', `set local role supabase_auth_admin; select public.f_smoke_hook('{"a":1}'::jsonb) ->> 'a' ok;`);
  await passo('authSemGrant', `set local role supabase_auth_admin; select public.current_org();`);
  await passo('leitura', `set local role supabase_read_only_user; select count(*) > 0 ok from financial_entry;`);
  await passo('leituraSemBypass', `set local role leitor_sem_bypass; select count(*) from financial_entry;`);
  await db.exec('rollback;');
  const r9ok = r9.aclInternos === internoAntes.aclInternos && r9.storage === true && r9.postgrestCliente === true && r9.postgrestAnon === 'negado'
    && r9.authGatilho === true && r9.authHook === '1' && r9.authSemGrant === 'negado' && r9.leitura === true && internoAntes.authOrg === true
    && internoAntes.leitorSemBypass === 0 && r9.leituraSemBypass === 'negado'
    && /políticas dirigidas a papéis internos/.test(errR9a ?? '') && /objetos fora de public\/mart dependem/.test(errR9b ?? '') && intactoR9;
  prova('R9 papéis internos: nenhuma concessão nova a eles; Storage (SET ROLE authenticated), PostgREST, gatilho SECURITY DEFINER em auth.users, hook com concessão explícita e leitura por pg_read_all_data com BYPASSRLS funcionam; o que só vinha por PUBLIC sai (supabase_auth_admin em current_org; leitor sem BYPASSRLS, que já lia 0 linhas, passa a receber negado); política dirigida a papel interno ou DEFAULT fora de public/mart abortam a 0077',
    r9ok, `ACL de papéis internos antes ${internoAntes.aclInternos} → depois ${r9.aclInternos} · ${JSON.stringify(r9)} · supabase_auth_admin executava current_org antes: ${internoAntes.authOrg} · leitor sem BYPASSRLS antes: ${internoAntes.leitorSemBypass} linha(s) · guarda política: ${(errR9a ?? 'APLICOU').slice(0, 70)} · guarda dependência: ${(errR9b ?? 'APLICOU').slice(0, 70)} · nada mudou nas tentativas: ${intactoR9}`);

  // R3. guardas da reversão: geração recusa retratos perigosos; execução recusa resultado que reabriria a C1
  const recusa = (nome, r, op = {}) => { try { gerarReversao(r, op); return `${nome}: GEROU`; } catch (e) { return `${nome}: recusado (${so(e).replace(/^retrato recusado; nenhuma reversão gerada:/, '').trim() || so(e.message.split('\n')[1] ?? '')})`; } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const preC1 = clone(retratoAntes); preC1.views.find((v) => v.nome === 'public.v_aging').acl.push('anon=arwdDxtm/postgres');
  const escritaAuth = clone(retratoAntes); escritaAuth.views.find((v) => v.nome === 'public.v_parameter').acl = ['postgres=arwdDxtm/postgres', 'authenticated=arw/postgres'];
  const antigo = clone(retratoAntes); antigo.tirado_em = new Date(Date.now() - 25 * 3600_000).toISOString();
  const semSchema = clone(retratoAntes); semSchema.funcoes[0].assinatura = semSchema.funcoes[0].assinatura.replace(/^public\./, '');
  const concedente = clone(retratoAntes); concedente.funcoes[0].acl = [...(concedente.funcoes[0].acl ?? []), 'authenticated=X/supabase_admin'];
  const casos = [recusa('anterior à C1 (anon numa view)', preC1), recusa('anterior à C1 (escrita de authenticated)', escritaAuth), recusa('posterior à 0077', retratoDepois),
    recusa('antigo (25 h)', antigo), recusa('assinatura sem schema', semSchema), recusa('concedente estranho', concedente), recusa('versão 1', { ...clone(retratoAntes), versao_retrato: 1 })];
  const valida = gerarReversao(retratoAntes);
  const adulterada = valida.replace('do $c1$', 'grant select on table public.v_aging to anon;\ndo $c1$');
  const errAdult = await (async () => { try { await db.exec(adulterada); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  const adultMaint = valida.replace('do $c1$', 'grant maintain on table public.v_aging to anon;\ndo $c1$');
  const errMaint = await (async () => { try { await db.exec(adultMaint); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  await db.exec('begin; create table public.t_smoke_depois_do_retrato (id int); commit;');
  const errDepois = await (async () => { try { await db.exec(valida); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  await db.exec('begin; drop table public.t_smoke_depois_do_retrato; commit;');
  const intacto = normal(await retrato()) === normal(retratoDepois);
  prova('R3 a reversão recusa retrato anterior à C1, posterior à 0077, antigo, sem schema, de versão antiga ou com concedente estranho; na execução, reversão adulterada (SELECT ou MAINTAIN para anon) e objeto criado depois do retrato desfazem tudo',
    casos.every((c) => c.includes('recusado')) && /reabriria o que a C1 fechou/.test(errAdult ?? '') && /reabriria o que a C1 fechou/.test(errMaint ?? '')
      && /criados depois do retrato/.test(errDepois ?? '') && intacto,
    `${casos.join(' · ')} · adulterada SELECT: ${(errAdult ?? 'EXECUTOU').slice(0, 60)} · adulterada MAINTAIN: ${(errMaint ?? 'EXECUTOU').slice(0, 60)} · objeto novo: ${(errDepois ?? 'EXECUTOU').slice(0, 70)} · estado intacto: ${intacto}`);

  // R6. retrato independente do search_path e de transação: em autocommit e com search_path estranho, mesmas assinaturas
  await db.exec(`set search_path = mart, pg_catalog;`);
  let autoc;
  try { autoc = (await db.exec(RETRATO_SQL)).at(-1).rows[0].retrato; } finally { await db.exec('reset search_path;'); }
  const assinaturas = (r) => r.funcoes.map((f) => f.assinatura).join('|');
  const qualificadas = autoc.funcoes.every((f) => /^(public|mart)\./.test(f.assinatura));
  const viaReg = (await q(`select count(*)::int c from unnest($1::text[]) x where to_regprocedure(x) is null`, [autoc.funcoes.map((f) => f.assinatura)]))[0].c;
  prova('R6 retrato em autocommit e com search_path = mart: assinaturas idênticas às de dentro da transação, todas com schema, e todas resolvem por to_regprocedure',
    assinaturas(autoc) === assinaturas(retratoDepois) && qualificadas && viaReg === 0, `${autoc.funcoes.length} funções · qualificadas ${qualificadas} · não resolvidas ${viaReg} · ex.: ${autoc.funcoes.find((f) => f.assinatura.includes('[]'))?.assinatura}`);

  // M. recuperação: reversão gerada do retrato (pós-C1), aplicada, e 0077 de novo
  res.reversao_linhas = valida.split('\n').length;
  const errRev = await (async () => { try { await db.exec(valida); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  const dRev = errRev ? [errRev] : diff(normal(retratoAntes), normal(await retrato()));
  const anonViews = await um(`select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT','INSERT','UPDATE']) pv
    where c.relkind = 'v' and n.nspname in ('public','mart') and has_table_privilege('anon', c.oid, pv)`);
  const errRe = await emTransacao(SQL_0077);
  const dRe = errRe ? [errRe] : diff(normal(retratoDepois), normal(await retrato()));
  prova('M recuperação: a reversão válida devolve exatamente o retrato pós-C1 (views continuam sem anon); reaplicar a 0077 volta ao novo',
    dRev.length === 0 && dRe.length === 0 && anonViews === 0, [...dRev.map((x) => `reversão: ${x}`), ...dRe.map((x) => `reaplicação: ${x}`)].slice(0, 6).join(' · ') || `${res.reversao_linhas} linhas de SQL; retratos idênticos nos dois sentidos; anon nas views depois da reversão: ${anonViews}`);

  // L. ordem: produção tem a 0074 pendente. Fila sem 0074/0077 → C1 → 0077 → 0074 chega ao mesmo retrato da fila em ordem
  const emOrdem = normal(await retrato());
  const dbOrdem = db;
  ({ db } = await bancoComFila(RAIZ, { excluir: ['0074', NUM] }));
  await db.exec('begin; create table public.t_smoke_publico (id int); revoke all on public.t_smoke_publico from anon, authenticated, service_role; grant select on public.t_smoke_publico to public; commit;');
  await db.exec(`begin; ${SQL_PAPEIS_INTERNOS} commit;`);
  const eC1 = await (async () => { try { await db.exec(SQL_C1); return null; } catch (e) { return so(e); } })();
  const e77 = await emTransacao(SQL_0077);
  const arq74 = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).find((f) => f.startsWith('0074_'));
  const e74 = await emTransacao(fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', arq74), 'utf8'));
  const dOrdem = eC1 || e77 || e74 ? [eC1 ?? e77 ?? e74] : diff(emOrdem, normal(await retrato()));
  await db.close(); db = dbOrdem;
  prova('L ordem: com a 0074 ainda pendente, C1 + 0077 e a 0074 depois chegam ao MESMO retrato da fila em ordem',
    dOrdem.length === 0, dOrdem.slice(0, 6).join(' · ') || 'retratos idênticos');

  // Q. ORDEM NUMÉRICA (como em produção): a fila inteira com a 0077 na posição dela. Migrations depois da 0077 criam
  //    funções com o padrão NOVO (fechado para o cliente). Aqui o Quality Gate pega quem esqueceu a concessão:
  //    toda função do dono usada por política (dirigida a authenticated/PUBLIC), DEFAULT/CHECK de tabela ou view de
  //    public/mart tem de ser executável por authenticated (e, em DEFAULT/CHECK, pelo service_role); e a lista R10 vale.
  const dbPrincipal = db;
  ({ db } = await bancoComFila(RAIZ));
  const qR10 = await conferirR10();
  const usadas = await q(`select distinct d.refobjid::regprocedure::text f, d.classid::regclass::text origem,
      has_function_privilege('authenticated', d.refobjid, 'EXECUTE') auth, has_function_privilege('service_role', d.refobjid, 'EXECUTE') svc,
      coalesce(pol.polname, '') pol,
      coalesce((select bool_or(x = 0 or x = 'authenticated'::regrole) from unnest(pol.polroles) x), true) cliente
    from pg_depend d
    join pg_proc pf on pf.oid = d.refobjid join pg_namespace nf on nf.oid = pf.pronamespace
    left join pg_policy pol on d.classid = 'pg_policy'::regclass and pol.oid = d.objid
    left join pg_attrdef ad on d.classid = 'pg_attrdef'::regclass and ad.oid = d.objid
    left join pg_constraint co on d.classid = 'pg_constraint'::regclass and co.oid = d.objid
    left join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and rw.oid = d.objid
    join pg_class ct on ct.oid = coalesce(pol.polrelid, ad.adrelid, co.conrelid, rw.ev_class) join pg_namespace nt on nt.oid = ct.relnamespace
    where d.refclassid = 'pg_proc'::regclass and nf.nspname in ('public', 'mart') and pf.proowner = (select oid from pg_roles where rolname = current_user)
      and d.classid in ('pg_policy'::regclass, 'pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_rewrite'::regclass)
      and nt.nspname in ('public', 'mart', 'storage')
      and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = pf.oid and e.deptype = 'e')`);
  const quebradas = usadas.filter((u) => (u.origem === 'pg_policy' ? u.cliente && !u.auth : (u.origem === 'pg_rewrite' ? !u.auth : !u.auth || !u.svc)))
    .map((u) => `${u.f} (${u.origem}${u.pol ? ' ' + u.pol : ''}): auth ${u.auth} svc ${u.svc}`);
  await db.close(); db = dbPrincipal;
  prova('Q ordem numérica (como em produção, migrations futuras depois da 0077): lista R10 confere e toda função usada por política, DEFAULT/CHECK ou view de public/mart é executável por quem a avalia',
    qR10.ok && quebradas.length === 0,
    [qR10.ok ? `R10 ok (${qR10.detalhe})` : `R10: ${qR10.detalhe}`, quebradas.length ? `funções usadas sem EXECUTE: ${quebradas.join(' · ')}` : `${usadas.length} usos de função em política/DEFAULT/CHECK/view conferidos`].join(' | '));

  // N. dono NÃO superusuário (como o postgres do Supabase): banco mínimo com as 25 views
  const n = await provaDonoComum();
  prova('N dono não superusuário: 0077 aplica; acesso por PUBLIC preservado; funções novas (public, mart, schema novo) só para o dono e service_role (nem authenticated, nem anon); grant a anon de OUTRO concedente aborta',
    n.ok, n.detalhe);
} catch (e) {
  prova('EXECUCAO', false, so(e));
}

async function conferirR10() {
  const definerCli = (await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','mart') and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`)).map((r) => r.f);
  const sobra = definerCli.filter((f) => !DEFINER_CLIENTE.includes(f));
  const falta = DEFINER_CLIENTE.filter((f) => !definerCli.includes(f));
  const servAberto = [];
  for (const f of SOMENTE_SERVIDOR) {
    const x = (await q(`select to_regprocedure($1) is not null existe, coalesce(has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE'), false) auth,
      coalesce(has_function_privilege('anon', to_regprocedure($1), 'EXECUTE'), false) anon, coalesce(has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE'), false) svc`, [f]))[0];
    if (!x.existe || x.auth || x.anon || !x.svc) servAberto.push(`${f}: ${JSON.stringify(x)}`);
  }
  // SECURITY DEFINER nova que não está em nenhuma das duas listas também falha: toda DEFINER tem de ser classificada
  const todas = (await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','mart') and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`)).map((r) => r.f);
  const semClasse = todas.filter((f) => !DEFINER_CLIENTE.includes(f) && !SOMENTE_SERVIDOR.includes(f) && !/^f_smoke_/.test(f));
  const ok = sobra.length === 0 && falta.length === 0 && servAberto.length === 0 && semClasse.length === 0;
  const detalhe = [sobra.length ? `fora da lista: ${sobra.join(', ')}` : '', falta.length ? `na lista mas não executável: ${falta.join(', ')}` : '',
    servAberto.length ? `só servidor com problema: ${servAberto.join(' · ')}` : '', semClasse.length ? `DEFINER sem classificação: ${semClasse.join(', ')}` : '']
    .filter(Boolean).join(' | ') || `${definerCli.length} DEFINER do cliente conferidas · ${SOMENTE_SERVIDOR.length} só do servidor fechadas · toda DEFINER classificada`;
  return { ok, detalhe };
}

async function provaDonoComum() {
  const montar = async (comOutroConcedente) => {
    const b = new PGlite({ extensions: { pgcrypto } });
    await b.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create role dono_app nologin; create role outro nologin;
      create schema mart authorization dono_app; create schema extra authorization dono_app;
      grant create, usage on schema public to dono_app;
      grant usage on schema public to anon, authenticated, service_role;`);
    await b.exec(`set role dono_app;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      grant usage on schema mart to authenticated;
      create table public.t_publico (id int); revoke all on public.t_publico from anon, authenticated, service_role; grant select on public.t_publico to public;
      create table public.t_normal (id serial);
      create function public.fn_cancel_entry(uuid, text) returns void language sql security definer as 'select';
      create function public.fn_close_period(uuid, character) returns uuid language sql security definer as 'select null::uuid';
      create function public.fn_reopen_period(uuid, text) returns void language sql security definer as 'select';
      create function public.f_rpc() returns int language sql as 'select 1';
      ${VIEWS_S3.map((v) => `create view ${v} as select 1 x;`).join('\n')}
      ${comOutroConcedente ? 'grant select on public.t_normal to outro with grant option;' : ''}
      reset role;`);
    if (comOutroConcedente) await b.exec('set role outro; grant select on public.t_normal to anon; reset role;');
    return b;
  };
  const aplicar = async (b) => { await b.exec('begin; set local role dono_app;'); try { await b.exec(SQL_0077); await b.exec('commit;'); return null; } catch (e) { await b.exec('rollback;'); return so(e); } };
  const det = [];
  let ok = true;
  // N1: caso normal
  const b1 = await montar(false);
  const super1 = (await b1.query(`select rolsuper from pg_roles where rolname = 'dono_app'`)).rows[0].rolsuper;
  const e1 = await aplicar(b1);
  if (e1) { ok = false; det.push(`aplicação como dono_app: ${e1}`); }
  else {
    const x = (await b1.query(`select
        has_table_privilege('authenticated', 'public.t_publico', 'SELECT') a1, has_table_privilege('service_role', 'public.t_publico', 'SELECT') s1, has_table_privilege('anon', 'public.t_publico', 'SELECT') n1,
        has_table_privilege('anon', 'public.t_normal', 'SELECT') n2, has_function_privilege('anon', 'public.f_rpc()', 'EXECUTE') n3, has_function_privilege('authenticated', 'public.f_rpc()', 'EXECUTE') a3,
        has_function_privilege('authenticated', 'public.fn_cancel_entry(uuid,text)', 'EXECUTE') a4,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'v' and c.reloptions && array['security_invoker=true']) inv`)).rows[0];
    const okN1 = x.a1 && x.s1 && !x.n1 && !x.n2 && !x.n3 && x.a3 && !x.a4 && x.inv === 25;
    ok &&= okN1; det.push(`N1 dono_app (superusuário: ${super1}) aplica: ${okN1 ? 'ok' : 'FALHA'} ${JSON.stringify(x)}`);
    // funções novas do dono em public, mart, schema novo e de extensão (R2)
    await b1.exec(`set role dono_app; grant usage on schema extra to authenticated, service_role, anon;
      create function public.nova() returns int language sql as 'select 1'; create function mart.nova() returns int language sql as 'select 1';
      create function extra.nova() returns int language sql as 'select 1'; reset role;`);
    const fs2 = (await b1.query(`select p.oid::regprocedure::text f, pg_get_userbyid(p.proowner) dono, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('service_role', p.oid, 'EXECUTE') svc
      from pg_proc p where p.oid in ('public.nova()'::regprocedure, 'mart.nova()'::regprocedure, 'extra.nova()'::regprocedure)`)).rows;
    const okR2 = fs2.length === 3 && fs2.every((f) => !f.auth && f.svc && !f.anon && f.dono === 'dono_app');
    ok &&= okR2;
    det.push(`N2 funções novas: ${fs2.map((f) => `${f.f} (dono ${f.dono}) anon ${f.anon} auth ${f.auth} svc ${f.svc}`).join(' · ')} → ${okR2 ? 'ok' : 'FALHA'}`);
  }
  await b1.close();
  // N3: grant a anon feito por outro concedente → a 0077 não consegue revogar e aborta (nada gravado)
  const b2 = await montar(true);
  const e2 = await aplicar(b2);
  const inv2 = (await b2.query(`select count(*)::int c from pg_class where relkind = 'v' and reloptions && array['security_invoker=true']`)).rows[0].c;
  const okN3 = /pós-condição falhou/.test(e2 ?? '') && /t_normal: anon SELECT/.test(e2 ?? '') && inv2 === 0;
  ok &&= okN3; det.push(`N3 anon concedido por outro papel: ${okN3 ? 'abortou' : 'FALHA'} (${(e2 ?? 'APLICOU').slice(0, 110)}…; views com invoker depois: ${inv2})`);
  await b2.close();
  return { ok, detalhe: det.join(' | ') };
}

console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);

// Smoke da Segurança S3 (migration 0077) contra um PostgreSQL DE VERDADE (PGlite, em memória): quem lê, escreve e
// executa o quê pelas views, tabelas e funções — ANTES e DEPOIS da 0077, com identidades equivalentes às reais (papéis de
// banco anon / authenticated / service_role e perfis por papel de negócio com escopo de empresa ou de obra).
//
// Por que existe: view sem `security_invoker` roda com os direitos do DONO (BYPASSRLS) e ignora a RLS das tabelas; o
// privilégio padrão do schema public dava tudo a `anon` em toda view e EXECUTE em toda função nova. O smoke:solicitante
// varria só pg_tables, então o vazamento passou despercebido (achado S3; incidente de 16/11/2026, contenção C1 em 17/11).
//
// O banco é a FILA INTEIRA de migrations SEM a 0077 + carga inicial + um cenário fictício (segunda obra, segunda
// organização, uma empresa no Radar). Mede-se tudo, aplica-se a 0077 numa transação (como em produção) e mede-se de novo.
// Provas (todas têm de dar PASS; sai com 1 se qualquer uma falhar):
//   A0/A1  reprodução do defeito sem a 0077 (leitura por Solicitante/outra organização/anon; escrita pela view)
//   P      pré-condição: inventário de views diferente aborta a 0077 sem alterar nada (retrato idêntico)
//   B      Solicitante, Administrador de outra organização e anon: 0 linhas ou negado em TODA view e no fluxo de caixa
//   C      sem regressão: Administrador, Diretoria, Financeiro, Contabilidade e Auditoria com resultado idêntico (md5)
//   D      recorte: Gestor de obra e Engenharia (escopo de uma obra) veem pela view só o que a RLS da tabela mostra
//   E      escrita por QUALQUER view negada a todo authenticated (inclusive Administrador) e a anon
//   F      service_role (servidor) lê todas as views com o mesmo resultado de antes
//   G      catálogo: nenhuma view de public/mart sem security_invoker (inclui as três do Radar)
//   H      anon: nenhum privilégio em relação nenhuma de public/mart e EXECUTE em função nenhuma; chamadas reais negadas
//   I      funções: authenticated e service_role executam exatamente o que executavam, menos as três fechadas
//          (fn_cancel_entry, fn_close_period, fn_reopen_period), que seguem para service_role
//   J      prevenção: tabela, view e função NOVAS não dão nada a anon nem EXECUTE a PUBLIC; view nova sem
//          security_invoker é apontada pela guarda G (é assim que o Quality Gate barra a recorrência)
//   K      reaplicar a 0077 não muda nada (idempotente)
//   L      ordem: fila sem a 0074 + 0077 + 0074 (produção hoje: 0074 pendente) chega ao MESMO retrato que a fila em ordem
//   M      recuperação: a reversão gerada do retrato devolve exatamente o retrato anterior; reaplicar a 0077 volta ao novo
// NADA TOCA PRODUÇÃO: banco em memória, sem rede, sem segredo, só dados fictícios.
// Como rodar:  node scripts/pg-smoke-views.mjs [--migracao <outra-0077.sql>]   (imprime JSON)
import fs from 'node:fs';
import path from 'node:path';
import { bancoComFila } from './lib/pgliteFila.mjs';
import { RETRATO_SQL, gerarReversao } from './lib/s3Reversao.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..');
const NUM = '0077';
const ARQ_0077 = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).find((f) => f.startsWith(`${NUM}_`));
// --migracao <arquivo.sql>: roda as provas contra outra versão da 0077 (teste de mutação: a prova tem de FALHAR)
const iMig = process.argv.indexOf('--migracao');
const SQL_0077 = fs.readFileSync(iMig > 0 ? path.resolve(process.argv[iMig + 1]) : path.join(RAIZ, 'supabase', 'migrations', ARQ_0077), 'utf8');
const FECHADAS = ['fn_cancel_entry(uuid,text)', 'fn_close_period(uuid,character)', 'fn_reopen_period(uuid,text)'];

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
async function emTransacao(sql) {
  await db.exec('begin;');
  try { await db.exec(sql); await db.exec('commit;'); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); }
}
const retrato = async () => {
  const sql = RETRATO_SQL.replace(/^set transaction read only;$/m, '');
  return (await db.query(sql)).rows[0].retrato;
};
/** retrato normalizado: ACL nula vira a padrão do PostgreSQL; itens ordenados; só os quatro papéis da 0077 + o dono */
function normal(r) {
  const acl = (a, tipo, dono) => {
    const itens = a ?? (tipo === 'funcao' ? [`=X/${dono}`, `${dono}=X/${dono}`] : tipo === 'S' ? [`${dono}=rwU/${dono}`] : [`${dono}=${tipo === 'v' ? 'arwdDxtm' : 'arwdDxtm'}/${dono}`]);
    return itens.map((i) => i.replace(/^"([^"]*)"=/, '$1=')).filter((i) => /^(anon|authenticated|service_role|)=/.test(i)).sort().join(',');
  };
  return JSON.stringify({
    views: r.views.map((v) => [v.nome, (v.opcoes ?? []).slice().sort().join(','), acl(v.acl, 'v', r.papel)]),
    relacoes: r.relacoes.map((x) => [x.nome, acl(x.acl, x.tipo, r.papel)]),
    funcoes: r.funcoes.map((f) => [f.assinatura, acl(f.acl, 'funcao', r.papel)]),
    padrao: r.padrao.map((d) => [d.schema, d.tipo, (d.acl ?? []).slice().sort().join(',')]).filter((d) => !(d[0] === null && d[1] === 'f' && d[2] === `=X/${r.papel},${r.papel}=X/${r.papel}`)),
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
    // função de fluxo (invoker) que lê as views
    const f = await como(uid, async () => (await q(`select count(*)::int n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from fn_cash_balance_weekly((select id from organization where code = 'EIFF'), 13) t where t.inflows <> 0 or t.outflows <> 0 or t.closing_balance <> 0`))[0], papel);
    out[nome][FLUXO] = f.erro ? (negado(f.erro) ? 'negado' : `ERRO ${f.erro}`) : { n: f.valor.n, h: f.valor.h.slice(0, 12) };
  }
  return out;
}
const linhas = (x) => (x && typeof x === 'object' ? x.n : 0);
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
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

  // ---- cenário (gravado de verdade; a 0077 roda depois, numa transação própria, como em produção) ----
  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const cia = await um(`select id from company where organization_id = $1 order by code limit 1`, [org]);
  const obra1 = await um(`select id from project where organization_id = $1 order by code limit 1`, [org]);
  const colunas = async (t) => (await q(`select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`, [t]))[0].c;
  const copiar = async (t, troca, onde, p) => um(`insert into ${t} (${await colunas(t)}) select ${await colunas(t)} from jsonb_populate_record(null::${t}, (select to_jsonb(x) || ${troca} from ${t} x where ${onde})) returning id`, p);
  // segunda obra, com um lançamento, fora do escopo do Gestor/Engenharia (mede o recorte por obra)
  const obra2 = await copiar('project', `jsonb_build_object('id', gen_random_uuid(), 'code', 'OB-SMOKE-02', 'name', 'Obra do smoke')`, 'x.id = $1', [obra1]);
  await copiar('financial_entry', `jsonb_build_object('id', gen_random_uuid(), 'code', 'PAG-SMOKE-2', 'project_id', $1::uuid, 'service_id', null, 'external_id', null)`,
    `x.id = (select id from financial_entry where organization_id = $2 and entry_type = 'Saída' and status <> 'Cancelado' order by code limit 1)`, [obra2, org]);
  // uma empresa fictícia no Radar (as três views do Radar passam a ter linha para medir)
  await q(`insert into radar_company (organization_id, legal_name, city, state) values ($1, 'Empresa Ficticia do Smoke', 'Cidade', 'GO')`, [org]);
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
  await db.exec('commit;');

  res.views = (await q(`select schemaname || '.' || viewname v from pg_views where schemaname in ('public', 'mart') order by 1`)).map((r) => r.v);
  res.atualizaveis = (await q(`select table_schema || '.' || table_name v from information_schema.views where table_schema in ('public','mart') and (is_updatable = 'YES' or is_insertable_into = 'YES') order by 1`)).map((r) => r.v);
  const retratoAntes = await retrato();
  const funcoesAntes = await funcoesMapa();

  // ---- ANTES ----
  await db.exec('begin;');
  res.antes = await medir(res.views);
  const escSolAntes = await como(ATORES.Solicitante, async () => um(`with u as (update v_parameter set responsible = 'smoke-invasor' returning 1) select count(*)::int from u`));
  const escAnonAntes = await como(null, async () => um(`with u as (update v_radar_company_queue set city = 'invadida' returning 1) select count(*)::int from u`), 'anon');
  await db.exec('rollback;');
  const vazou = (a) => res.views.filter((v) => linhas(res.antes[a][v]) > 0);
  prova('A0 reprodução: sem a 0077, Solicitante, outra organização e anon leem dados da EIFF pelas views',
    vazou('Solicitante').length > 0 && vazou('outraOrganizacao').length > 0 && vazou('anon').length > 0,
    `Solicitante lê ${vazou('Solicitante').length} views · outra organização ${vazou('outraOrganizacao').length} · anon ${vazou('anon').length} (${vazou('anon').map((v) => v.replace('public.', '')).join(', ')})`);
  prova('A1 reprodução: escrita pela view auto-atualizável grava na tabela (Solicitante em v_parameter, anon em v_radar_company_queue)',
    escSolAntes.valor > 0 && escAnonAntes.valor > 0, `Solicitante: ${escSolAntes.erro ?? `${escSolAntes.valor} linha(s)`} · anon: ${escAnonAntes.erro ?? `${escAnonAntes.valor} linha(s)`} · atualizáveis: ${res.atualizaveis.join(', ')}`);

  // ---- P: pré-condição fecha sem alterar nada ----
  await db.exec('begin; create view public.v_smoke_intrusa as select 1 x; commit;');
  const errP = await emTransacao(SQL_0077);
  await db.exec('begin; drop view public.v_smoke_intrusa; commit;');
  const retratoP = await retrato();
  prova('P pré-condição: inventário de views diferente aborta a 0077 e nada muda',
    /inventário de views divergente/.test(errP ?? '') && normal(retratoP) === normal(retratoAntes), `${(errP ?? 'aplicou!').slice(0, 90)}…`);

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

  const naoBloqueado = [];
  for (const a of BLOQUEADOS) for (const v of [...res.views, FLUXO]) {
    const x = res.depois[a][v];
    if (!(x === 'negado' || (typeof x === 'object' && x.n === 0))) naoBloqueado.push(`${a} ${v}: ${JSON.stringify(x)}`);
  }
  prova('B Solicitante, Administrador de outra organização e anon: 0 linhas ou negado em TODA view e no fluxo de caixa',
    naoBloqueado.length === 0, naoBloqueado.join(' · ') || `${res.views.length} views + ${FLUXO}`);

  // mart.cash_weekly lê o fluxo de `(select id from organization limit 1)`: como dono, com duas organizações, a "primeira"
  // era arbitrária (aqui, a OUTRA → 0 linhas). Com invoker, cada papel só enxerga a própria organização, então a view
  // passa a mostrar o fluxo da organização de quem consulta. É correção, conferida à parte (C2), não regressão.
  const mudou = [];
  for (const a of MESMO_RESULTADO) for (const v of [...res.views, FLUXO]) {
    if (v === 'mart.cash_weekly') continue;
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
  prova('C2 mart.cash_weekly passa a mostrar o fluxo da organização de quem consulta (antes: a "primeira" organização, arbitrária)',
    c2.every((x) => x.endsWith('ok')), `${c2.join(' · ')} · antes (Administrador): ${JSON.stringify(res.antes.Administrador['mart.cash_weekly'])}`);

  // D. recorte por obra: Gestor de obra e Engenharia veem pela view o que a RLS da tabela mostra
  for (const a of ['Compras', 'Gestor de obra', 'Engenharia']) {
    res.diferencas[a] = res.views.filter((v) => JSON.stringify(res.antes[a][v]) !== JSON.stringify(res.depois[a][v]))
      .map((v) => `${v.replace('public.', '')}: ${linhas(res.antes[a][v])} → ${typeof res.depois[a][v] === 'object' ? res.depois[a][v].n : res.depois[a][v]}`);
  }
  await db.exec('begin;');
  const recorte = [];
  for (const a of ['Gestor de obra', 'Engenharia']) {
    const tabela = await como(ATORES[a], async () => (await q(`select count(*) filter (where project_id = $1)::int o1, count(*) filter (where project_id = $2)::int o2 from financial_entry`, [obra1, obra2]))[0]);
    const view = await como(ATORES[a], async () => (await q(`select count(*) filter (where project_id = $1)::int o1, count(*) filter (where project_id = $2)::int o2 from v_financial_entry_calc`, [obra1, obra2]))[0]);
    const obras = await como(ATORES[a], async () => (await q(`select count(*) filter (where id = $1)::int o1, count(*) filter (where id = $2)::int o2 from v_project_360`, [obra1, obra2]))[0]);
    const contas = await como(ATORES[a], async () => um(`select count(*)::int from bank_account`));
    const ok = view.valor?.o2 === 0 && view.valor?.o1 === tabela.valor?.o1 && obras.valor?.o2 === 0 && linhas(res.depois[a]['public.v_opening_balance']) === contas.valor;
    recorte.push({ a, ok, d: `${a}: tabela ${JSON.stringify(tabela.valor ?? tabela.erro)} · view ${JSON.stringify(view.valor ?? view.erro)} · obra360 ${JSON.stringify(obras.valor ?? obras.erro)} · contas ${contas.valor}` });
  }
  await db.exec('rollback;');
  prova('D recorte: Gestor de obra e Engenharia veem pela view só a obra do escopo (como na tabela) e nenhum saldo bancário',
    recorte.every((x) => x.ok), recorte.map((x) => x.d).join(' | '));

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

  const svcMudou = res.views.filter((v) => JSON.stringify(res.antes.service_role[v]) !== JSON.stringify(res.depois.service_role[v]));
  prova('F service_role (servidor) lê todas as views com o mesmo resultado de antes', svcMudou.length === 0 && linhas(res.depois.service_role['public.v_financial_entry_calc']) > 0,
    svcMudou.join(', ') || `${res.views.length} views idênticas (lançamentos: ${linhas(res.depois.service_role['public.v_financial_entry_calc'])})`);

  const sem = await semInvoker();
  prova('G catálogo: nenhuma view de public/mart sem security_invoker (inclui as três do Radar)', sem.length === 0, sem.join(', ') || `${res.views.length} views com security_invoker`);

  // H. anon fora de tudo: catálogo (relações e funções) + chamadas reais
  const anonRel = await q(`select n.nspname || '.' || c.relname || ' ' || pv x from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pv
    where c.relkind in ('r','p','v','m','f') and n.nspname in ('public','mart') and has_table_privilege('anon', c.oid, pv)
    union all select n.nspname || '.' || c.relname || ' sequência' from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname in ('public','mart') and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'UPDATE'))`);
  const funcoesDepois = await funcoesMapa();
  const anonFn = Object.entries(funcoesDepois).filter(([, [a]]) => a).map(([f]) => f);
  await db.exec('begin;');
  const chamadas = [];
  for (const sql of [`select count(*) from financial_entry`, `select count(*) from bank_account`, `select count(*) from radar_company`,
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

  // J. prevenção: objetos novos criados pelo dono depois da 0077
  await db.exec('begin;');
  await db.exec(`create table public.t_smoke_nova (id int); create view public.v_smoke_nova as select 1 x;
    create function public.f_smoke_nova() returns int language sql as 'select 1';`);
  const nova = (await q(`select
      (select bool_or(has_table_privilege('anon', 'public.t_smoke_nova', p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) anon_tabela,
      (select bool_or(has_table_privilege('anon', 'public.v_smoke_nova', p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) anon_view,
      has_function_privilege('anon', 'public.f_smoke_nova()', 'EXECUTE') anon_funcao,
      has_table_privilege('authenticated', 'public.t_smoke_nova', 'SELECT') auth_tabela,
      has_function_privilege('authenticated', 'public.f_smoke_nova()', 'EXECUTE') auth_funcao,
      has_function_privilege('service_role', 'public.f_smoke_nova()', 'EXECUTE') svc_funcao,
      exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.f_smoke_nova()'::regprocedure and a.grantee = 0) public_funcao`))[0];
  const guardaVe = (await semInvoker()).includes('public.v_smoke_nova');
  await db.exec('rollback;');
  prova('J prevenção: tabela/view/função NOVAS sem nada para anon nem EXECUTE para PUBLIC; view nova sem security_invoker é apontada pela guarda G',
    !nova.anon_tabela && !nova.anon_view && !nova.anon_funcao && !nova.public_funcao && nova.auth_tabela && nova.auth_funcao && nova.svc_funcao && guardaVe,
    `${JSON.stringify(nova)} · guarda G aponta a view nova: ${guardaVe}`);

  // M. recuperação: reversão gerada do retrato anterior, aplicada, e 0077 de novo
  const reversao = gerarReversao(retratoAntes);
  res.reversao_linhas = reversao.split('\n').length;
  const errRev = await (async () => { try { await db.exec(reversao); return null; } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return so(e); } })();
  const dRev = errRev ? [errRev] : diff(normal(retratoAntes), normal(await retrato()));
  const errRe = await emTransacao(SQL_0077);
  const dRe = errRe ? [errRe] : diff(normal(retratoDepois), normal(await retrato()));
  prova('M recuperação: a reversão gerada do retrato devolve exatamente o estado anterior; reaplicar a 0077 volta ao novo',
    dRev.length === 0 && dRe.length === 0, [...dRev.map((x) => `reversão: ${x}`), ...dRe.map((x) => `reaplicação: ${x}`)].slice(0, 6).join(' · ') || `${res.reversao_linhas} linhas de SQL; retratos idênticos nos dois sentidos`);

  // L. ordem: produção tem a 0074 pendente. Fila sem 0074/0077 → 0077 → 0074 chega ao mesmo retrato da fila em ordem
  const emOrdem = normal(await retrato());
  const dbOrdem = db;
  ({ db } = await bancoComFila(RAIZ, { excluir: ['0074', NUM] }));
  const e77 = await emTransacao(SQL_0077);
  const arq74 = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).find((f) => f.startsWith('0074_'));
  const e74 = await emTransacao(fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', arq74), 'utf8'));
  const dOrdem = e77 || e74 ? [e77 ?? e74] : diff(emOrdem, normal(await retrato()));
  await db.close(); db = dbOrdem;
  prova('L ordem: com a 0074 ainda pendente, 0077 antes e 0074 depois chegam ao MESMO retrato da fila em ordem',
    dOrdem.length === 0, dOrdem.slice(0, 6).join(' · ') || 'retratos idênticos');
} catch (e) {
  prova('EXECUCAO', false, so(e));
}
console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);

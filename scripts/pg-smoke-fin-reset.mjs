// Smoke do FIN-RESET-01 (migrations 0061, 0062 e 0063) contra um PostgreSQL DE VERDADE (PGlite, em memória, ROLLBACK ao final).
//
// Por que existe: a suíte vitest prova o que o APP decide (src/core/resetExtrato.ts, store) e o payload que ele manda;
// aqui se prova o que o BANCO aceita: o reset numa transação só com lista fechada, a reimportação do MESMO OFX sem
// violar unicidade, a recusa de FITID ativo duplicado, o relançamento sem colidir com o lançamento antigo, o desfazer
// e a autoridade (só o dono do banco executa; o app só lê o registro do reset).
//
// O schema é a FILA INTEIRA de migrations (0001..última) mais a carga inicial, como no pg-preflight-central.mjs, com o
// mesmo prelúdio que imita a plataforma Supabase. NADA TOCA PRODUÇÃO: banco em memória, sem rede, sem segredo.
//
// Como rodar:  node scripts/pg-smoke-fin-reset.mjs   (imprime JSON; sai com 1 se qualquer prova falhar)
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..', 'supabase', 'migrations');
const ESPERADO_SQL = fs.readFileSync(path.join(AQUI, 'fin-reset', 'esperado.sql'), 'utf8');
const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] }; // mesma correção histórica do preflight
const SEMENTE = '0013';

const PRELUDIO = `
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $prel$;
grant usage on schema public to anon, authenticated, service_role;
-- privilégios padrão do Supabase: toda tabela/função nova nasce com tudo para os papéis da API (inclusive TRUNCATE).
-- Sem isto a prova P seria vazia: foi desse padrão que veio o TRUNCATE fechado pela 0063.
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
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
`;

const res = { migrations: {}, provas: {}, rollback: '' };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];

const db = new PGlite({ extensions: { pgcrypto } });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let sp = 0;
/** roda dentro de um savepoint; devolve a mensagem de erro (ou null) e desfaz sempre */
async function tentar(fn) {
  const nome = `sp${++sp}`;
  await db.exec(`savepoint ${nome};`);
  try { await fn(); await db.exec(`rollback to savepoint ${nome};`); return null; }
  catch (e) { await db.exec(`rollback to savepoint ${nome};`); return so(e); }
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
  const PAPEIS = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
  const TABELAS_RESET = ['financial_reset', 'financial_reset_item'];
  /** privilégios explícitos por papel nas tabelas do reset (aclexplode: grantee 0 = PUBLIC) */
  const privilegios = async () => Object.fromEntries((await q(`select c.relname || ':' || coalesce(r.rolname, 'PUBLIC') k, string_agg(a.privilege_type, ',' order by a.privilege_type) v
      from pg_class c cross join lateral aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
     where c.relname = any($1) and (a.grantee = 0 or r.rolname = any($2)) group by 1`, [TABELAS_RESET, PAPEIS.slice(1)])).map((x) => [x.k, x.v]));
  let privAntes0063 = null;
  for (const arq of arquivos) {
    const n = arq.slice(0, 4);
    for (const antes of ORDEM_CORRIGIDA[n] ?? []) if (!feitas.has(antes)) await aplicar(antes);
    if (n === '0063') privAntes0063 = await privilegios();
    if (!feitas.has(arq)) await aplicar(arq);
    if (n === SEMENTE) { await db.exec('begin;'); await db.exec(fs.readFileSync(path.join(RAIZ, '..', 'seed.sql'), 'utf8')); await db.exec('commit;'); }
  }
  // reaplicar 0061/0062/0063 tem de ser inofensivo (idempotência das migrations)
  for (const arq of arquivos.filter((f) => /^006[123]_/.test(f))) { await db.exec(fs.readFileSync(path.join(RAIZ, arq), 'utf8')); }
  res.migrations.reaplicacao_0061_0062_0063 = 'ok';

  // P (0063): TRUNCATE fechado para PUBLIC/anon/authenticated/service_role; SELECT do app preservado; nada mais concedido
  const privDepois = await privilegios();
  const tem = (mapa, tabela, papel, priv) => (mapa?.[`${tabela}:${papel}`] ?? '').split(',').includes(priv);
  const temPriv = async (papel, tabela, priv) => Boolean(await um(`select has_table_privilege($1, $2, $3)`, [papel, tabela, priv]));
  const falhasP = [];
  if (!TABELAS_RESET.every((t) => tem(privAntes0063, t, 'authenticated', 'TRUNCATE'))) falhasP.push('brecha não reproduzida antes da 0063');
  for (const t of TABELAS_RESET) {
    for (const p of PAPEIS) if (tem(privDepois, t, p, 'TRUNCATE')) falhasP.push(`${t}: ${p} ainda tem TRUNCATE`);
    for (const p of PAPEIS.slice(1)) {
      if (await temPriv(p, t, 'TRUNCATE')) falhasP.push(`${t}: has_table_privilege(${p}, TRUNCATE)`);
      for (const priv of ['INSERT', 'UPDATE', 'DELETE']) if (await temPriv(p, t, priv)) falhasP.push(`${t}: ${p} tem ${priv}`);
    }
    if (!(await temPriv('authenticated', t, 'SELECT'))) falhasP.push(`${t}: authenticated perdeu SELECT`);
    for (const p of PAPEIS) {
      const novos = (privDepois[`${t}:${p}`] ?? '').split(',').filter(Boolean).filter((x) => !(privAntes0063?.[`${t}:${p}`] ?? '').split(',').includes(x));
      if (novos.length) falhasP.push(`${t}: ${p} ganhou ${novos}`);
    }
  }
  for (const fn of ['fin_reset_extrato(uuid,text,text,uuid,jsonb)', 'fin_reset_desfazer(uuid,text,text,uuid)'])
    for (const p of PAPEIS.slice(1)) if (await um(`select has_function_privilege($1, $2, 'EXECUTE')`, [p, fn])) falhasP.push(`${fn}: ${p} executa`);
  await db.exec('begin;');
  let errTrunc = null;
  try { await db.exec("set local role authenticated; truncate financial_reset_item, financial_reset;"); } catch (e) { errTrunc = so(e); }
  await db.exec('rollback;');
  if (!/permission denied/.test(errTrunc ?? '')) falhasP.push(`TRUNCATE como authenticated não foi recusado: ${errTrunc}`);
  prova('P TRUNCATE fechado nas tabelas do reset (0063); SELECT do app mantido; nada concedido; funções só do dono',
    falhasP.length === 0, falhasP.length ? falhasP.join(' · ') : `antes: ${JSON.stringify(privAntes0063)} · depois: ${JSON.stringify(privDepois)} · ${errTrunc}`);

  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const cia = await um(`select id from company where organization_id = $1 limit 1`, [org]);
  const saida = await um(`select id from chart_account where organization_id = $1 and entry_type = 'Saída' order by category limit 1`, [org]);
  const entrada = await um(`select id from chart_account where organization_id = $1 and entry_type = 'Entrada' order by category limit 1`, [org]);
  const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', FIN = 'aaaaaaaa-0000-4000-8000-000000000002', ENG = 'aaaaaaaa-0000-4000-8000-000000000003';
  await q(`insert into profile (id, organization_id, name, email, role) values ($1,$4,'Admin','admin@t','Administrador'), ($2,$4,'Fin','fin@t','Financeiro'), ($3,$4,'Eng','eng@t','Engenharia')`, [ADMIN, FIN, ENG, org]);
  const conta = async (code, inst) => um(`insert into bank_account (organization_id, company_id, code, institution, account_label, account_type, opening_balance, opening_balance_date)
    values ($1, $2, $3, $4, $4, 'Conta corrente', 1000, '2026-09-01') returning id`, [org, cia, code, inst]);
  const A = await conta('CTA-T1', 'Banco A'), B = await conta('CTA-T2', 'Banco B');
  const tx = async (contaId, fitid, mov, data = '2026-09-10') => um(`insert into bank_transaction (organization_id, bank_account_id, record_kind, external_id, transaction_date, description, debit, credit, imported_at)
    values ($1, $2, 'Real', $3, $4, 'Movimento ' || $3, $5, $6, '2026-09-15T16:51:00Z') returning id`, [org, contaId, fitid, data, mov < 0 ? -mov : 0, mov > 0 ? mov : 0]);
  const t1 = await tx(A, 'B1', -100), t2 = await tx(A, 'X', -45), t3 = await tx(B, 'X', -45), t4 = await tx(B, 'B4', 500), t5 = await tx(A, 'B5', -30);
  const lanc = async (code, origem, ext, tipo, valor, contaId, status = 'Programado') => um(`insert into financial_entry
      (code, organization_id, company_id, entry_type, chart_account_id, description, competence_date, due_date, status, bank_account_id, gross_amount, source_system, external_id, created_by)
    values ($1, $2, $3, $4, $5, 'teste ' || $1, '2026-09-10', '2026-09-10', $6, $7, $8, $9, $10, $11) returning id`,
  [code, org, cia, tipo, tipo === 'Saída' ? saida : entrada, status, contaId, valor, origem, ext, ADMIN]);
  const liquidar = (entry, valor, contaId) => q(`insert into settlement (organization_id, entry_id, settled_on, amount, bank_account_id, document_number, created_by) values ($1,$2,'2026-09-10',$3,$4,'doc',$5)`, [org, entry, valor, contaId, ADMIN]);
  const conciliar = (txId, entry, valor) => q(`insert into reconciliation (organization_id, bank_transaction_id, entry_id, matched_amount, status, reconciled_at, reconciled_by) values ($1,$2,$3,$4,'Conciliado',now(),$5)`, [org, txId, entry, valor, ADMIN]);

  // D1/D2: nasceram do extrato (Lançar a partir da transação); D2 conciliado à intrusa (A) e à gêmea (B), como em produção
  const D1 = await lanc('PAG-T1', 'extrato', 'B1', 'Saída', 100, A); await liquidar(D1, 100, A); await conciliar(t1, D1, -100);
  const D2 = await lanc('PAG-T2', 'extrato', 'X', 'Saída', 45, B); await liquidar(D2, 45, B); await conciliar(t2, D2, -45); await conciliar(t3, D2, -45);
  // D3: anomalia (Realizado sem liquidação registrada, como o PAG-0056)
  const D3 = await um(`insert into financial_entry (code, organization_id, company_id, entry_type, chart_account_id, description, competence_date, due_date, settlement_date, status, bank_account_id, gross_amount, settled_amount, source_system, external_id)
    values ('PAG-T3', $1, $2, 'Saída', $3, 'anomalia', '2026-09-10', '2026-09-10', '2026-09-10', 'Realizado', $4, 20, 20, 'extrato', 'B9') returning id`, [org, cia, saida, A]);
  // D4: gerado do extrato já neutro (cancelado, liquidação estornada): fora do reset
  const D4 = await lanc('PAG-T4', 'ofx', 'TESTE-OFX', 'Saída', 9, A); await liquidar(D4, 9, A);
  await q(`update settlement set reversed = true, reversal_reason = 'teste' where entry_id = $1`, [D4]);
  await q(`update financial_entry set status = 'Cancelado' where id = $1`, [D4]);
  // D5: gerado do extrato que a pessoa decidiu manter (exceção explícita)
  const D5 = await lanc('PAG-T5', 'extrato', 'B5', 'Saída', 30, A); await liquidar(D5, 30, A);
  // P1: título pré-existente (contas a receber cadastrado à mão) conciliado; P2: pré-existente liquidado à mão, sem conciliação
  const P1 = await lanc('REC-T1', 'eiff-control', 'REC-T1', 'Entrada', 500, B); await conciliar(t4, P1, 500);
  await q(`update financial_entry set reconciled = true where id = $1`, [P1]);
  const P2 = await lanc('REC-T2', 'eiff-control', 'REC-T2', 'Entrada', 300, B); await liquidar(P2, 300, B);
  // ruído de outra organização: nunca pode entrar no reset
  await q(`insert into organization (code, name) values ('OUTRA', 'Outra')`);
  const orgB = await um(`select id from organization where code = 'OUTRA'`);
  const ciaB = await um(`insert into company (organization_id, code, name) values ($1, 'OUTRA', 'Outra') returning id`, [orgB]);
  const contaB = await um(`insert into bank_account (organization_id, company_id, code, institution, account_label, account_type) values ($1,$2,'CTA-X','X','X','cc') returning id`, [orgB, ciaB]);
  await q(`insert into bank_transaction (organization_id, bank_account_id, external_id, transaction_date, debit, credit) values ($1,$2,'B1','2026-09-10',1,0)`, [orgB, contaB]);

  const p1Antes = (await q(`select status, gross_amount, settled_amount, bank_account_id, version from financial_entry where id = $1`, [P1]))[0];
  const contar = async () => ({
    ativas: Number(await um(`select count(*) from bank_transaction where organization_id = $1 and discarded_at is null`, [org])),
    conc: Number(await um(`select count(*) from reconciliation where organization_id = $1`, [org])),
    liqAtivas: Number(await um(`select count(*) from settlement where organization_id = $1 and not reversed`, [org])),
    liqTotal: Number(await um(`select count(*) from settlement where organization_id = $1`, [org])),
  });
  const antes = await contar();

  // esperado.sql calcula a lista fechada; o "manter" do teste é PAG-T5
  const esperado = await um(ESPERADO_SQL.replace(`unnest('{}'::text[])`, `unnest('{PAG-T5}'::text[])`));
  prova('A esperado.sql classifica: 4 derivados ativos menos o mantido, 1 pré-existente, anomalia incluída',
    JSON.stringify(esperado.derivados) === JSON.stringify(['PAG-T1', 'PAG-T2', 'PAG-T3']) && JSON.stringify(esperado.preexistentes) === JSON.stringify(['REC-T1'])
    && esperado.transacoes === 5 && esperado.conciliacoes === 4 && esperado.liquidacoes === 2 && Number(esperado.liquidacoes_valor) === 145,
    JSON.stringify(esperado));

  const reset = (esp, codigo = 'FIN-RESET-T', ator = ADMIN) => um(`select fin_reset_extrato($1, $2, 'teste do reset', $3, $4::jsonb)`, [org, codigo, ator, JSON.stringify(esp)]);
  const errDiv = await tentar(() => reset({ ...esperado, transacoes_md5: 'x' }));
  const errDer = await tentar(() => reset({ ...esperado, derivados: ['PAG-T1', 'PAG-T2'] }));
  const errAtor = await tentar(() => reset(esperado, 'FIN-RESET-T', ENG));
  prova('B lista fechada divergente ou ator sem papel: RAISE e nada gravado',
    /mudaram desde o precheck/.test(errDiv ?? '') && /diferem do aprovado/.test(errDer ?? '') && /não é Administrador/.test(errAtor ?? '')
    && JSON.stringify(await contar()) === JSON.stringify(antes), `${errDiv} · ${errDer} · ${errAtor}`);

  const errLig = await tentar(async () => {
    await q(`update financial_entry set project_id = (select project_id from project_service limit 1) where id = $1`, [D1]);
    const n = await q(`insert into entry_service_split (organization_id, entry_id, service_id, project_id, amount, description)
      select $1, $2, s.id, s.project_id, 100, 'teste' from project_service s limit 1 returning id`, [org, D1]);
    if (!n.length) throw new Error('sem serviço na carga para montar o rateio');
    await reset(esperado);
  });
  prova('C derivado ligado a pedido/rateio: o reset RECUSA', /fora do escopo do reset/.test(errLig ?? ''), errLig ?? 'não recusou');

  const r = await reset(esperado);
  const depois = await contar();
  const ent = async (id) => (await q(`select status, deleted_at, deletion_reason, cancellation_reason, settled_amount, reconciled, settlement_date, version from financial_entry where id = $1`, [id]))[0];
  const [e1, e2, e3, e4, e5, p1, p2] = [await ent(D1), await ent(D2), await ent(D3), await ent(D4), await ent(D5), await ent(P1), await ent(P2)];
  prova('D reset aplicado: nenhuma transação ativa, nenhuma conciliação do ciclo, liquidações estornadas (nunca apagadas)',
    depois.ativas === 0 && depois.conc === 0 && depois.liqTotal === antes.liqTotal && depois.liqAtivas === antes.liqAtivas - 2
    && Number(await um(`select count(*) from bank_transaction where organization_id = $1`, [orgB])) === 1
    && Number(await um(`select count(*) from bank_transaction where organization_id = $1 and discarded_at is null`, [orgB])) === 1,
    JSON.stringify({ antes, depois }));
  prova('E derivados cancelados e excluídos (fora de caixa/DRE), com motivo; anomalia tratada; mantido e já neutro intocados',
    [e1, e2, e3].every((e) => e.status === 'Cancelado' && e.deleted_at && /FIN-RESET-T/.test(e.deletion_reason) && Number(e.settled_amount) === 0 && !e.reconciled && !e.settlement_date)
    && e5.status === 'Realizado' && !e5.deleted_at && Number(e5.settled_amount) === 30 && e4.status === 'Cancelado' && !e4.deleted_at,
    JSON.stringify({ e1, e3, e5 }));
  prova('F título pré-existente: só perdeu a conciliação (status, valor, liquidado e conta iguais); o liquidado à mão ficou',
    !p1.reconciled && p1.status === p1Antes.status && Number(p1.settled_amount) === Number(p1Antes.settled_amount) && !p1.deleted_at
    && p2.status === 'Realizado' && Number(p2.settled_amount) === 300 && !p2.deleted_at, JSON.stringify(p1));
  const itens = await q(`select entity_type, action, count(*)::int n from financial_reset_item i join financial_reset f on f.id = i.reset_id where f.code = 'FIN-RESET-T' group by 1, 2 order by 1, 2`);
  const audit = await q(`select action, actor_id from audit_log where entity_type = 'financial_reset' and entity_id = 'FIN-RESET-T'`);
  const auditDb = Number(await um(`select count(*) from audit_log where source = 'db' and entity_type = 'financial_entry' and actor_id = $1 and occurred_at >= now() - interval '1 minute'`, [ADMIN]));
  prova('G auditoria: retrato de cada linha tocada, registro do reset com antes/depois e ator real nos triggers',
    JSON.stringify(itens) === JSON.stringify([
      { entity_type: 'bank_transaction', action: 'discard', n: 5 }, { entity_type: 'financial_entry', action: 'cancel_exclude', n: 3 },
      { entity_type: 'financial_entry', action: 'unreconcile', n: 1 }, { entity_type: 'reconciliation', action: 'unlink', n: 4 },
      { entity_type: 'settlement', action: 'reverse', n: 2 }])
    && audit.length === 1 && audit[0].action === 'fin_reset_extrato' && audit[0].actor_id === ADMIN && auditDb >= 4
    && r.anomalias.some((a) => a.lancamento === 'PAG-T3'), JSON.stringify({ itens, audit, auditDb, anomalias: r.anomalias }));
  const errRep = await tentar(() => reset(esperado));
  const errDel = await tentar(() => q(`delete from financial_reset_item`));
  const errUpd = await tentar(() => q(`update financial_reset_item set before_data = '{}'`));
  prova('H o mesmo código não roda duas vezes; o retrato não se apaga nem se altera',
    /já foi executado/.test(errRep ?? '') && /nao pode ser apagado/.test(errDel ?? '') && /imutável/.test(errUpd ?? ''), `${errRep} · ${errDel} · ${errUpd}`);

  // reimportação: o app grava exatamente linhaTransacaoNova (uuid gerado no app + FITID), como Financeiro autenticado
  // em erro não há reset: a transação abortou e o rollback do savepoint (tentar) desfaz o SET LOCAL
  const comoUsuario = async (uid, fn) => { await db.exec(`set local role authenticated; set local test.uid = '${uid}';`); const r = await fn(); await db.exec("reset role; set local test.uid = '';"); return r; };
  const novo = () => crypto.randomUUID();
  const ofx = [[A, 'B1', -100], [A, 'X', -45], [B, 'X', -45], [B, 'B4', 500], [A, 'B5', -30]];
  const ids = ofx.map(() => novo());
  const inserir = (id, [c, fitid, mov]) => q(`insert into bank_transaction (id, organization_id, bank_account_id, record_kind, external_id, transaction_date, description, debit, credit, imported_at)
    values ($1, $2, $3, 'Real', $4, '2026-09-10', 'Movimento ' || $4, $5, $6, now())`, [id, org, c, fitid, mov < 0 ? -mov : 0, mov > 0 ? mov : 0]);
  const errReimp = await (async () => { try { await comoUsuario(FIN, async () => { for (const [i, l] of ofx.entries()) await inserir(ids[i], l); }); return null; } catch (e) { return so(e); } })();
  const porConta = await q(`select b.code, count(*) filter (where t.discarded_at is null)::int ativas, count(*)::int todas from bank_transaction t join bank_account b on b.id = t.bank_account_id where t.organization_id = $1 group by 1 order by 1`, [org]);
  prova('I o MESMO OFX reimporta depois do reset (RLS de Financeiro, uuid do app), sem violar unicidade',
    errReimp === null && JSON.stringify(porConta) === JSON.stringify([{ code: 'CTA-T1', ativas: 3, todas: 6 }, { code: 'CTA-T2', ativas: 2, todas: 4 }]),
    errReimp ?? JSON.stringify(porConta));
  const errDup = await tentar(() => inserir(novo(), ofx[0]));
  const errRest = await tentar(() => q(`update bank_transaction set discarded_at = null, discarded_by = null, discard_reason = null where id = $1`, [t1]));
  const dupAtivo = Number(await um(`select count(*) from (select bank_account_id, external_id from bank_transaction where discarded_at is null group by 1, 2 having count(*) > 1) z`));
  prova('J FITID ativo duplicado é impossível: nova importação ou restauração da linha antiga são recusadas pelo banco',
    /bank_transaction_fitid_ativo/.test(errDup ?? '') && /bank_transaction_fitid_ativo/.test(errRest ?? '') && dupAtivo === 0, `${errDup} · ${errRest}`);
  const errFato = await tentar(() => q(`update bank_transaction set debit = 1 where id = $1`, [ids[0]]));
  prova('K o fato bancário segue imutável (trigger da 0059)', /valor é fato do banco/.test(errFato ?? ''), errFato ?? 'aceitou');

  // relançar a mesma linha do banco: o app agora grava external_id = uuid da linha; o FITID colidiria com o lançamento antigo
  const errFitid = await tentar(() => lanc('PAG-T9', 'extrato', 'B1', 'Saída', 100, A));
  const errUuid = await tentar(() => lanc('PAG-T9', 'extrato', ids[0], 'Saída', 100, A));
  prova('L relançamento após o reset: external_id = uuid da linha passa; com o FITID (regra antiga) colidiria com o excluído',
    errUuid === null && /financial_entry_organization_id_source_system_external_id_key/.test(errFitid ?? ''), `${errFitid} · ${errUuid}`);

  // autoridade: o app (authenticated/service_role) não executa as funções nem escreve no registro do reset; Financeiro lê
  const errExec = await tentar(() => comoUsuario(ADMIN, () => reset(esperado, 'FIN-RESET-APP')));
  const errIns = await tentar(() => comoUsuario(ADMIN, () => q(`insert into financial_reset (organization_id, code, reason, executed_by, expected, counts_before) values ($1,'X','x',$2,'{}','{}')`, [org, ADMIN])));
  const leFin = await comoUsuario(FIN, () => um(`select count(*)::int from financial_reset`));
  const leEng = await comoUsuario(ENG, () => um(`select count(*)::int from financial_reset`));
  prova('M só o dono do banco executa o reset; Financeiro lê o registro, Engenharia não',
    /permission denied/.test(errExec ?? '') && /permission denied/.test(errIns ?? '') && leFin === 1 && leEng === 0, `${errExec} · ${errIns} · fin=${leFin} eng=${leEng}`);

  // 0062: Financeiro descarta pela policy; Engenharia não altera nada
  const upd = async (uid) => comoUsuario(uid, () => q(`update bank_transaction set discarded_at = now(), discard_reason = 'teste' where id = $1 returning id`, [ids[4]]));
  let engAlterou = -1;
  await tentar(async () => { engAlterou = (await upd(ENG)).length; });
  const finAlterou = (await upd(FIN)).length;
  prova('N policy tx_update (0062): Financeiro descarta, Engenharia não', finAlterou === 1 && engAlterou === 0, `fin=${finAlterou} eng=${engAlterou}`);

  // desfazer: recusado com reimportação ativa; depois de descartar a reimportação, devolve exatamente o estado anterior
  const errDesf = await tentar(() => um(`select fin_reset_desfazer($1, 'FIN-RESET-T', 'teste', $2)`, [org, ADMIN]));
  await q(`update bank_transaction set discarded_at = now(), discard_reason = 'teste: descartar reimportação' where id = any($1::uuid[])`, [ids]);
  await q(`update financial_entry set deleted_at = now(), status = 'Cancelado' where code = 'PAG-T9'`);
  await um(`select fin_reset_desfazer($1, 'FIN-RESET-T', 'desfazer do teste', $2)`, [org, ADMIN]);
  const volta = await contar();
  const e1v = await ent(D1), e3v = await ent(D3), p1v = await ent(P1);
  prova('O desfazer: recusado enquanto há reimportação ativa; depois restaura transações, conciliações, liquidações e títulos',
    /criaria FITID duplicado/.test(errDesf ?? '') && volta.ativas === antes.ativas && volta.conc === antes.conc && volta.liqAtivas === antes.liqAtivas
    && e1v.status === 'Realizado' && !e1v.deleted_at && Number(e1v.settled_amount) === 100 && e3v.status === 'Realizado' && Number(e3v.settled_amount) === 20
    && p1v.reconciled === true && !!(await um(`select rolled_back_at from financial_reset where code = 'FIN-RESET-T'`)),
    `${errDesf} · ${JSON.stringify({ antes, volta })}`);

  await db.exec('rollback;');
  res.rollback = 'ROLLBACK ok (nada persistido)';
} catch (e) {
  res.erroFatal = so(e);
  falhas++;
}
console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);

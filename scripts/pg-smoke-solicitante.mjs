// Smoke do papel Solicitante (migrations 0066 e 0067) contra um PostgreSQL DE VERDADE (PGlite, em memória).
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
  // reaplicar a 0067 tem de ser inofensivo (create or replace / grants)
  await db.exec(fs.readFileSync(path.join(RAIZ, arquivos.find((f) => f.startsWith('0067_'))), 'utf8'));
  res.migrations.reaplicacao_0067 = 'ok';
  // a 0071 redefine df_pedido_json (com a alteração de valor): reaplicada por cima da 0067, e também tem de ser idempotente
  await db.exec(fs.readFileSync(path.join(RAIZ, arquivos.find((f) => f.startsWith('0071_'))), 'utf8'));
  res.migrations.reaplicacao_0071 = 'ok';
  // a 0072 redefine df_pedido_json e df_registrar_pedido (forma e dados de pagamento): reaplicada por último, idempotente
  await db.exec(fs.readFileSync(path.join(RAIZ, arquivos.find((f) => f.startsWith('0072_'))), 'utf8'));
  res.migrations.reaplicacao_0072 = 'ok';
  // a 0073 redefine df_pedido_json (com os anexos): reaplicada por último, idempotente. Ordem 0067 → 0071 → 0072 → 0073.
  await db.exec(fs.readFileSync(path.join(RAIZ, arquivos.find((f) => f.startsWith('0073_'))), 'utf8'));
  res.migrations.reaplicacao_0073 = 'ok';

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

  // ---- 0071: alteração de valor do pedido (porta df_pedir_alteracao, decisão pela Diretoria conferida pelo gatilho) ----
  const pedirAlt = (uid, codigo, valor, motivo, manter = true) => como(uid, async () => um(`select df_pedir_alteracao($1, $2, $3)`, [codigo, valor, motivo]), { manter });
  const m1 = await pedirAlt(SOL, 'PED-0001', 950, 'orçamento final com peça a mais');
  const valorTitulo = await um(`select gross_amount::text from financial_entry where code = 'PED-0001'`);
  prova('M Solicitante pede alteração do próprio pedido: PENDENTE, título continua com o valor antigo',
    !m1.erro && m1.valor?.status === 'PENDENTE' && Number(m1.valor?.valorAnterior) === 800 && Number(m1.valor?.valorNovo) === 950 && valorTitulo === '800.00',
    m1.erro ?? `${JSON.stringify(m1.valor)} · título ${valorTitulo}`);
  const m2 = await pedirAlt(SOL, 'PED-0001', 950, 'repetido', false);
  const m3 = await pedirAlt(SOL, 'PED-0001', 990, 'outra', false);
  const m4 = await pedirAlt(SOL2, 'PED-0001', 990, 'não é meu', false);
  const m5 = await pedirAlt(SOL, 'PED-0002', 300, 'igual', false);
  const m6 = await pedirAlt(SOL, 'PED-0002', 310, ' ', false);
  const m7 = await pedirAlt(SOL, 'PAG-9001', 10, 'pedido da casa', false);
  prova('N regras da porta: repetido devolve o mesmo; outra pendente, pedido alheio, valor igual, sem motivo e lançamento comum recusados',
    m2.valor?.repetido === true && !!m3.erro && !!m4.erro && !!m5.erro && !!m6.erro && !!m7.erro,
    `rep ${m2.valor?.repetido ?? m2.erro} · outra ${m3.erro} · alheio ${m4.erro} · igual ${m5.erro} · motivo ${m6.erro} · casa ${m7.erro}`);
  const solLe = await como(SOL, async () => um(`select count(*)::int from payment_change_request`));
  const meusAlt = await como(SOL, async () => um(`select df_meus_pedidos()`));
  const p1 = (meusAlt.valor ?? []).find((x) => x.codigo === 'PED-0001');
  prova('O Solicitante não lê a tabela, mas vê a alteração no próprio pedido (df_meus_pedidos)', solLe.valor === 0 && p1?.alteracao?.status === 'PENDENTE' && Number(p1?.alteracao?.valorNovo) === 950,
    `tabela ${solLe.valor ?? solLe.erro} · ${JSON.stringify(p1?.alteracao ?? null)}`);
  const altId = m1.valor?.id;
  const insDireto = await como(FIN, async () => q(`insert into payment_change_request (organization_id, entry_id, requested_by, previous_amount, new_amount, reason) select organization_id, id, $1, 1, 2, 'direto' from financial_entry where code = 'PAG-9001'`, [FIN]));
  const delDireto = await como(ADMIN, async () => q(`delete from payment_change_request where id = $1`, [altId]));
  const aindaExiste = await um(`select count(*)::int from payment_change_request where id = $1`, [altId]);
  prova('P sem caminho direto: insert recusado (só pela porta) e nada é apagado', !!insDireto.erro && aindaExiste === 1, `insert: ${insDireto.erro} · delete: ${delDireto.erro ?? 'sem erro, 0 linhas'} · existe ${aindaExiste}`);
  const semGravar = await como(FIN, async () => q(`update payment_change_request set status = 'ACEITA' where id = $1`, [altId]));
  const solDecide = await como(SOL, async () => q(`update payment_change_request set status = 'ACEITA' where id = $1`, [altId]));
  const mudaValor = await como(FIN, async () => q(`update payment_change_request set new_amount = 5 where id = $1`, [altId]));
  const aceita = await como(FIN, async () => {
    await q(`update financial_entry set gross_amount = 950 where code = 'PED-0001'`);
    await q(`update payment_change_request set status = 'ACEITA' where id = $1`, [altId]);
    return (await q(`select status, decided_by::text, decided_at is not null as em from payment_change_request where id = $1`, [altId]))[0];
  }, { manter: true });
  prova('Q decisão: aceitar sem gravar o valor no título é recusado; o pedido é imutável; Diretoria aceita e o gatilho grava quem e quando',
    /novo valor no título/.test(semGravar.erro ?? '') && !!mudaValor.erro && aceita.valor?.status === 'ACEITA' && aceita.valor?.decided_by === FIN && aceita.valor?.em,
    `sem gravar: ${semGravar.erro} · solicitante: ${solDecide.erro ?? 'sem erro, 0 linhas'} · muda valor: ${mudaValor.erro} · aceita: ${JSON.stringify(aceita.valor ?? aceita.erro)}`);
  const redecide = await como(FIN, async () => q(`update payment_change_request set status = 'RECUSADA', decision_reason = 'mudei de ideia' where id = $1`, [altId]));
  const m8 = await pedirAlt(SOL, 'PED-0001', 1000, 'mais um ajuste');
  const recSem = await como(FIN, async () => q(`update payment_change_request set status = 'RECUSADA' where id = $1`, [m8.valor?.id]));
  const cancOutro = await como(SOL2, async () => um(`select df_cancelar_alteracao($1)`, [m8.valor?.id]));
  const canc = await como(SOL, async () => um(`select df_cancelar_alteracao($1)`, [m8.valor?.id]), { manter: true });
  prova('R decidida não muda; recusa exige motivo; só quem pediu cancela',
    !!redecide.erro && !!recSem.erro && !!cancOutro.erro && canc.valor?.status === 'CANCELADA',
    `redecide ${redecide.erro} · recusa sem motivo ${recSem.erro} · outro cancela ${cancOutro.erro} · cancela ${canc.valor?.status ?? canc.erro}`);
  await q(`update financial_entry set status = 'Cancelado', cancellation_reason = 'teste' where code = 'PED-0002'`);
  const m9 = await pedirAlt(SOL, 'PED-0002', 400, 'depois de recusado', false);
  const privAlt = await q(`select p, f, has_function_privilege(p, f, 'EXECUTE') pode from unnest(array['anon','authenticated']) p, unnest(array['df_pedir_alteracao(text,numeric,text)','df_cancelar_alteracao(uuid)','df_alteracao_json(payment_change_request)']) f`);
  const privErrado = privAlt.filter((x) => (x.p === 'anon' ? x.pode : x.f.startsWith('df_alteracao_json') ? x.pode : !x.pode)).map((x) => `${x.p} ${x.f} ${x.pode}`);
  prova('S pedido não aprovado não altera; anon não executa as portas novas', !!m9.erro && privErrado.length === 0, `${m9.erro} · ${privErrado.join(' · ')}`);

  // ---- 0072: forma e dados de pagamento pela porta do Solicitante ----
  const comPix = { ...pedido, valor: 120, descricao: 'Peça com PIX', formaPagamento: 'PIX', dadosPagamento: { pixTipo: 'CNPJ', pixChave: '11222333000181', favorecido: 'Oficina do Zé' } };
  const t1 = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify(comPix)]), { manter: true });
  const t1Banco = (await q(`select payment_method, payment_details from financial_entry where code = $1`, [t1.valor?.codigo]))[0];
  prova('T pedido com forma de pagamento: gravado no título e devolvido ao Solicitante',
    !t1.erro && t1.valor?.formaPagamento === 'PIX' && t1.valor?.dadosPagamento?.pixChave === '11222333000181' && t1Banco?.payment_method === 'PIX' && t1Banco?.payment_details?.favorecido === 'Oficina do Zé',
    t1.erro ?? JSON.stringify(t1Banco));
  const ruins = [];
  for (const [nome, extra] of [['forma inventada', { formaPagamento: 'Cheque', dadosPagamento: {} }], ['PIX sem chave', { formaPagamento: 'PIX', dadosPagamento: { pixTipo: 'CPF' } }], ['boleto curto', { formaPagamento: 'Boleto', dadosPagamento: { boletoLinha: '123' } }], ['transferência sem conta', { formaPagamento: 'Transferência', dadosPagamento: { banco: 'Itaú', agencia: '1', favorecido: 'X', documentoFavorecido: '1' } }]]) {
    const r = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify({ ...pedido, valor: 77, descricao: `ruim ${nome}`, ...extra })]));
    if (!r.erro) ruins.push(`${nome} aceito`);
  }
  const semForma = await como(SOL, async () => um(`select df_registrar_pedido($1::jsonb)`, [JSON.stringify({ ...pedido, valor: 78, descricao: 'sem forma' })]));
  const ck = await como(ADMIN, async () => q(`update financial_entry set payment_method = 'Cheque' where code = 'PAG-9001'`));
  prova('U dados de pagamento incompletos ou forma fora do catálogo são recusados (porta e coluna); sem forma continua valendo',
    ruins.length === 0 && !semForma.erro && semForma.valor?.formaPagamento === null && !!ck.erro, `${ruins.join(' · ')} · sem forma: ${semForma.erro ?? 'ok'} · coluna: ${ck.erro}`);
  const meusT = await como(SOL, async () => um(`select df_meus_pedidos()`));
  const p1t = (meusT.valor ?? []).find((x) => x.codigo === 'PED-0001');
  prova('V df_meus_pedidos mantém a alteração da 0071 e traz a forma (0072)', ['ACEITA', 'CANCELADA'].includes(p1t?.alteracao?.status) && 'formaPagamento' in (p1t ?? {}), JSON.stringify({ alt: p1t?.alteracao?.status, forma: p1t?.formaPagamento }));

  // ---- 0073: documentos do pedido (nota fiscal, boleto, comprovante) ----
  const pedT = t1.valor?.codigo; // pedido do SOL (com PIX), ainda Rascunho
  const pasta = await como(SOL, async () => um(`select anexo_preparar($1, 'NOTA_FISCAL')`, [pedT]));
  const nfPath = `${pasta.valor?.pasta}/nf-1.pdf`;
  const upSol = await como(SOL, async () => q(`insert into storage.objects (bucket_id, name, owner) values ('anexos-financeiros', $1, $2)`, [nfPath, SOL]), { manter: true });
  const regNf = await como(SOL, async () => um(`select anexo_registrar($1, 'NOTA_FISCAL', $2, 'NF 123.pdf', 'application/pdf', 2048)`, [pedT, nfPath]), { manter: true });
  prova('W Solicitante anexa a nota fiscal ao próprio pedido (storage + registro) e vê no df_meus_pedidos',
    !pasta.erro && !upSol.erro && regNf.valor?.tipo === 'NOTA_FISCAL' && regNf.valor?.enviadoPor === 'Equipe Um',
    `${pasta.erro ?? ''} ${upSol.erro ?? ''} ${regNf.erro ?? JSON.stringify(regNf.valor)}`);
  const compSol = await como(SOL, async () => um(`select anexo_preparar($1, 'COMPROVANTE')`, [pedT]));
  const upSol2 = await como(SOL2, async () => q(`insert into storage.objects (bucket_id, name, owner) values ('anexos-financeiros', $1, $2)`, [`${pasta.valor?.pasta}/intruso.pdf`, SOL2]));
  const prepSol2 = await como(SOL2, async () => um(`select anexo_preparar($1, 'NOTA_FISCAL')`, [pedT]));
  const forjado = await como(SOL, async () => um(`select anexo_registrar($1, 'NOTA_FISCAL', $2, 'x.pdf', 'application/pdf', 10)`, [pedT, `${pasta.valor?.pasta}/nao-existe.pdf`]));
  const outraPasta = await como(SOL, async () => q(`insert into storage.objects (bucket_id, name, owner) values ('anexos-financeiros', $1, $2)`, [`${org}/${await um(`select id from financial_entry where code = 'PAG-9001'`)}/x.pdf`, SOL]));
  prova('X recusados: comprovante pelo solicitante, outra pessoa no pedido alheio, registro sem arquivo, upload na pasta de lançamento alheio',
    !!compSol.erro && !!upSol2.erro && !!prepSol2.erro && /não encontrado/.test(forjado.erro ?? '') && !!outraPasta.erro,
    `comp ${compSol.erro} · sol2 upload ${upSol2.erro} · sol2 preparar ${prepSol2.erro} · forjado ${forjado.erro} · pasta alheia ${outraPasta.erro}`);
  const compPath = `${pasta.valor?.pasta}/comprovante.pdf`;
  const upFin = await como(FIN, async () => { await q(`insert into storage.objects (bucket_id, name, owner) values ('anexos-financeiros', $1, $2)`, [compPath, FIN]); return um(`select anexo_registrar($1, 'COMPROVANTE', $2, 'comprovante.pdf', 'application/pdf', 4096)`, [pedT, compPath]); }, { manter: true });
  const solVeObj = await como(SOL, async () => um(`select count(*)::int from storage.objects where bucket_id = 'anexos-financeiros'`));
  const sol2VeObj = await como(SOL2, async () => um(`select count(*)::int from storage.objects where bucket_id = 'anexos-financeiros'`));
  const meusDocs = await como(SOL, async () => um(`select df_meus_pedidos()`));
  const docsPed = ((meusDocs.valor ?? []).find((x) => x.codigo === pedT)?.anexos ?? []).map((a) => a.tipo).sort().join(',');
  prova('Y Financeiro anexa o comprovante; o solicitante baixa os dois arquivos do próprio pedido; outra pessoa da equipe não vê nenhum',
    upFin.valor?.tipo === 'COMPROVANTE' && solVeObj.valor === 2 && sol2VeObj.valor === 0 && docsPed === 'COMPROVANTE,NOTA_FISCAL',
    `${upFin.erro ?? ''} sol vê ${solVeObj.valor ?? solVeObj.erro} · sol2 vê ${sol2VeObj.valor ?? sol2VeObj.erro} · docs ${docsPed}`);
  const nfId = regNf.valor?.id; const compId = upFin.valor?.id;
  const insDir = await como(FIN, async () => q(`insert into entry_attachment (organization_id, entry_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by) select organization_id, id, 'OUTRO', 'x', 'y', 'application/pdf', 1, $1 from financial_entry where code = 'PAG-9001'`, [FIN]));
  const delDir = await como(ADMIN, async () => q(`delete from entry_attachment where id = $1`, [nfId]));
  const solRemComp = await como(SOL, async () => um(`select anexo_remover($1, 'não quero')`, [compId]));
  const solRemNf = await como(SOL, async () => um(`select anexo_remover($1, 'arquivo errado')`, [nfId]), { manter: true });
  const aindaArquivo = await um(`select count(*)::int from storage.objects where name = $1`, [nfPath]);
  const linhaRem = (await q(`select removed_at is not null as rem, removal_reason from entry_attachment where id = $1`, [nfId]))[0];
  prova('Z sem caminho direto (insert/delete); solicitante não remove o comprovante; remoção lógica com motivo mantém o arquivo',
    !!insDir.erro && !!delDir.erro && !!solRemComp.erro && !solRemNf.erro && linhaRem?.rem && linhaRem?.removal_reason === 'arquivo errado' && aindaArquivo === 1,
    `insert ${insDir.erro} · delete ${delDir.erro} · remover comprovante ${solRemComp.erro} · remover nf ${solRemNf.erro ?? 'ok'} · arquivo ${aindaArquivo}`);

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

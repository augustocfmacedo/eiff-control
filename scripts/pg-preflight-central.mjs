// Preflight das migrations da EIFF Central: aplica a SEQUENCIA COMPLETA (0001..0051) num Postgres descartavel
// (PGlite, o Postgres compilado para WASM) e diz exatamente ate onde ela vai.
//
// Por que existe: o pg-smoke-central.mjs prova 0049/0050/0051 contra um schema MINIMO montado a mao. Isso pega
// sintaxe e as regras das tres migrations, mas nao pega interacao com as 48 anteriores (helpers com assinatura
// diferente, enum role_kind, ordem de criacao, constraint que ja existe com outro nome). Este harness responde a
// outra pergunta: "a fila inteira roda?" e, quando nao roda, "onde para e com qual mensagem?".
//
// NADA TOCA PRODUCAO. O banco e criado em memoria e morre com o processo. Nao ha conexao de rede.
//
// Como rodar:
//   node scripts/pg-preflight-central.mjs                 # 0001..0051, para no primeiro erro
//   node scripts/pg-preflight-central.mjs --continuar     # nao para: marca a falha, faz rollback e segue
//   node scripts/pg-preflight-central.mjs --ate 0048      # so ate a migration indicada
//   node scripts/pg-preflight-central.mjs --pular 0019    # pula migrations (0019 tem 2,7 MB de catalogo SINAPI)
//   node scripts/pg-preflight-central.mjs --detalhe       # imprime o trecho de SQL onde o erro caiu
//   node scripts/pg-preflight-central.mjs --semente 0013  # onde entra supabase/seed.sql (padrao 0013; 'nao' desliga)
//   node scripts/pg-preflight-central.mjs --ordem-corrigida  # adianta 0015 para antes de 0014 (ver ORDEM_CORRIGIDA)
//
// A ORDEM importa e nao e a do arquivo. As migrations de DADOS (0014, 0018, 0020, 0021, 0022) fazem
// `(select id from organization where code = 'EIFF')`: sem a carga inicial elas inserem organization_id nulo e
// quebram. Por isso a carga (supabase/seed.sql) entra depois de 0013 — o ultimo ponto antes da primeira migration
// de dados em que o seed de hoje ja encontra o schema de que precisa (ele referencia project_service, criada em
// 0007). Dois achados caem daqui, e valem para o runbook:
//   * o supabase/deploy.sql de hoje concatena TODAS as migrations e SO DEPOIS a carga: num banco vazio ele para
//     em 0014. O caminho "cole o deploy.sql" de docs/implantacao-supabase.md nao reconstroi mais o banco do zero;
//   * a fila tambem nao e replayavel em ordem de arquivo: 0015 (que cria project_service.version) e a CORRECAO de
//     0014, e vem depois dela. Com --ordem-corrigida o harness adianta 0015 e a fila inteira fica verde.
//
// O @electric-sql/pglite e devDependency FIXADA (0.3.16) desde a Wave 02; npm ci basta. O contrib pgcrypto vem
// do proprio pacote.
//
// ---------------------------------------------------------------------------------------------------------
// O QUE ESTE HARNESS *NAO* PROVA
//   * PGlite e PostgreSQL 17.5 em WASM; producao e o Postgres gerenciado do Supabase, com GUCs, extensoes e
//     papeis proprios. Sintaxe e semantica batem; comportamento de planner, locks e concorrencia nao entram.
//   * O PRELUDIO abaixo IMITA a plataforma Supabase (schema auth, papeis, schema storage). Nao e o Supabase:
//     se uma migration depender de um detalhe real do GoTrue ou do Storage, aqui ela passa e la nao.
//   * Nao ha dados de producao. Migration que altera constraint em tabela COM DADOS (0051 no `provider`) so e
//     exercitada contra tabela vazia; o risco de linha que viola o novo CHECK tem de ser conferido no banco.
// ---------------------------------------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const RAIZ = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', 'supabase', 'migrations');

// ---------------------------------------------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const valor = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : null; };
const tem = (nome) => argv.includes(nome);
const ATE = valor('--ate');
const PULAR = new Set((valor('--pular') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const CONTINUAR = tem('--continuar');
const DETALHE = tem('--detalhe');
const SEMENTE = valor('--semente') ?? '0013';
const ORDEM_OK = tem('--ordem-corrigida');

// Correcoes que o historico aplicou DEPOIS do problema. Chave = migration que precisa; valor = o que adiantar.
// 0015 cria project_service.version, que o trigger touch_updated_at() exige no `on conflict do update` de 0014.
const ORDEM_CORRIGIDA = { '0014': ['0015_version_cols.sql'] };

// ---------------------------------------------------------------------------------------------------- preludio
// Tudo aqui e SHIM: o que a plataforma Supabase da de graca e o Postgres cru nao tem. Cada bloco diz o que imita.
const PRELUDIO_PAPEIS = `
-- papeis do Supabase (o PostgREST conecta como um deles; as migrations fazem grant/revoke para eles)
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $prel$;
grant usage on schema public to anon, authenticated, service_role;
`;

const PRELUDIO_AUTH = `
-- schema auth: no Supabase vem do GoTrue. Aqui so as tres funcoes que as migrations usam, lendo de GUCs para o
-- teste poder trocar de usuario (set local test.uid = '<uuid>').
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('test.uid', true), '')::uuid,
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid)
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user)
$fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$fn$;
`;

const PRELUDIO_STORAGE = `
-- schema storage: no Supabase vem do servico de Storage (storage.buckets, storage.objects, storage.foldername).
-- A migration 0042 cria o bucket fotos-campo e politicas sobre storage.objects. Sem este shim ela nao roda aqui.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;
`;

// ---------------------------------------------------------------------------------------------------- execucao
const arquivos = fs.readdirSync(RAIZ).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const numero = (f) => f.slice(0, 4);

const res = {
  ambiente: {},
  preludio: {},
  migrations: [],
  parou_em: null,
  verificacao: null,
  observacoes: [],
};

const db = new PGlite({ extensions: { pgcrypto } });
const so = (e) => String(e?.message ?? e).split('\n')[0];

/** Recorta o trecho de SQL apontado por e.position (o Postgres devolve offset em bytes, 1-based). */
function trecho(sql, e) {
  const pos = Number(e?.position ?? e?.cause?.position ?? 0);
  if (!pos) return null;
  const ini = Math.max(0, pos - 220);
  return sql.slice(ini, pos + 120).replace(/\s+/g, ' ').trim();
}

try {
  res.ambiente.postgres = (await db.query('select version() v')).rows[0].v;
  res.ambiente.pglite = 'PGlite (Postgres em WASM), banco em memoria, sem rede';

  for (const [rotulo, sql] of [['papeis', PRELUDIO_PAPEIS], ['auth', PRELUDIO_AUTH], ['storage', PRELUDIO_STORAGE]]) {
    try { await db.exec(sql); res.preludio[rotulo] = 'shim aplicado'; }
    catch (e) { res.preludio[rotulo] = `ERRO: ${so(e)}`; throw e; }
  }

  for (const arq of arquivos) {
    const n = numero(arq);
    if (ATE && n > ATE) break;
    if (PULAR.has(n)) { res.migrations.push({ migration: n, arquivo: arq, estado: 'PULADA (--pular)' }); continue; }
    if (ORDEM_OK && ORDEM_CORRIGIDA[n]) {
      for (const antes of ORDEM_CORRIGIDA[n]) {
        if (res.migrations.some((m) => m.arquivo === antes)) continue;
        await db.exec('begin;');
        try {
          await db.exec(fs.readFileSync(path.join(RAIZ, antes), 'utf8'));
          await db.exec('commit;');
          res.migrations.push({ migration: numero(antes), arquivo: antes, estado: `APLICADA (adiantada para antes de ${n})` });
        } catch (e) { try { await db.exec('rollback;'); } catch { /* ja abortada */ } res.migrations.push({ migration: numero(antes), arquivo: antes, estado: 'ERRO', erro: so(e) }); }
      }
    }
    if (res.migrations.some((m) => m.arquivo === arq)) continue;  // ja entrou adiantada
    const sql = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const t0 = Date.now();
    await db.exec('begin;');
    try {
      await db.exec(sql);
      await db.exec('commit;');
      res.migrations.push({ migration: n, arquivo: arq, estado: 'APLICADA', ms: Date.now() - t0, kb: Math.round(sql.length / 1024) });
    } catch (e) {
      try { await db.exec('rollback;'); } catch { /* transacao ja abortada */ }
      const linha = { migration: n, arquivo: arq, estado: 'ERRO', ms: Date.now() - t0, erro: so(e) };
      const detalhe = e?.detail ?? e?.cause?.detail; if (detalhe) linha.detail = String(detalhe).split('\n')[0];
      const dica = e?.hint ?? e?.cause?.hint; if (dica) linha.hint = String(dica).split('\n')[0];
      if (DETALHE) { const t = trecho(sql, e); if (t) linha.trecho = t; }
      res.migrations.push(linha);
      if (!res.parou_em) res.parou_em = { migration: n, arquivo: arq, erro: linha.erro };
      if (!CONTINUAR) break;
    }

    // carga inicial no ponto historico certo (ver cabecalho): depois de 0003, antes das migrations de dados
    if (n === SEMENTE) {
      const t1 = Date.now();
      try {
        await db.exec('begin;');
        await db.exec(fs.readFileSync(path.join(RAIZ, '..', 'seed.sql'), 'utf8'));
        await db.exec('commit;');
        res.migrations.push({ migration: 'seed', arquivo: 'supabase/seed.sql', estado: 'APLICADA', ms: Date.now() - t1 });
      } catch (e) {
        try { await db.exec('rollback;'); } catch { /* ja abortada */ }
        res.migrations.push({ migration: 'seed', arquivo: 'supabase/seed.sql', estado: 'ERRO', erro: so(e) });
        if (!res.parou_em) res.parou_em = { migration: 'seed', arquivo: 'supabase/seed.sql', erro: so(e) };
        if (!CONTINUAR) break;
      }
    }
  }

  // ------------------------------------------------------------------ verificacao pos-aplicacao (so se chegou la)
  const chegou = res.migrations.some((m) => m.migration === '0051' && m.estado === 'APLICADA');
  if (chegou) {
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const lista = (rows) => rows.map((r) => Object.values(r)[0]).sort();
    res.verificacao = {
      tabelas: lista(await q(
        `select tablename from pg_tables where schemaname = 'public'
           and tablename in ('whatsapp_identity','central_conversation','central_message','central_event')`)),
      funcoes: lista(await q(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
           and proname in ('whatsapp_identity_request','whatsapp_identity_verify','whatsapp_identity_attempt',
             'whatsapp_identity_transition','whatsapp_identity_coerencia','whatsapp_identity_audit','whatsapp_identity_estado',
             'central_conversation_coerencia','central_event_ator_coerencia','central_coerencia','central_message_estado',
             'central_message_ordem','central_event_imutavel','radar_delivery_create')`)),
      triggers: lista(await q(
        `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal
           and c.relname in ('whatsapp_identity','central_conversation','central_message','central_event')`)),
      policies: lista(await q(
        `select policyname from pg_policies
           where tablename in ('whatsapp_identity','central_conversation','central_message','central_event')`)),
      provider_check: (await q(
        `select pg_get_constraintdef(oid) d from pg_constraint where conname = 'radar_communication_delivery_provider_check'`))[0]?.d ?? null,
      // GRANTs: authenticated so pode SELECT nas tabelas novas, e nenhuma das RPCs server-only e executavel por ele
      grants_authenticated: await q(
        `select table_name, string_agg(privilege_type, ',' order by privilege_type) privs
           from information_schema.role_table_grants where grantee = 'authenticated'
            and table_name in ('whatsapp_identity','central_conversation','central_message','central_event')
          group by table_name order by table_name`),
      execute_rpcs: await q(
        `select p.proname,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated,
                has_function_privilege('service_role', p.oid, 'EXECUTE') service_role,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('whatsapp_identity_request','whatsapp_identity_verify','whatsapp_identity_attempt',
              'whatsapp_identity_transition','radar_delivery_create','radar_delivery_transition')
          order by 1`),
      // a duvida real contra o schema completo: has_role recebe role_kind[], as policies passam literais de texto
      has_role_assinatura: (await q(
        `select pg_get_function_arguments(oid) a from pg_proc where proname = 'has_role'`))[0]?.a ?? null,
      politica_wi_select: (await q(
        `select qual from pg_policies where tablename = 'whatsapp_identity' and policyname = 'wi_select'`))[0]?.qual ?? null,
    };

    // ------------------------------------------------------------------ provas contra o SCHEMA REAL
    // O pg-smoke-central.mjs ja prova as regras contra um schema minimo. O que so aparece aqui e a interacao com
    // os objetos de verdade: role_kind como ENUM (as policies passam literais de texto para has_role, que recebe
    // variadic role_kind[]), current_org() real, profile/worker reais e o ledger de entrega vindo de 0045..0048.
    res.provas = {};
    const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; };
    const jsonDe = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
    const H = '1'.repeat(64);  // hash valido (64 hex); o codigo em claro nunca chega ao banco
    try {
      await db.exec('begin;');
      const org = (await db.query(`select id from organization where code = 'EIFF'`)).rows[0].id;
      await db.query(`insert into organization (code, name) values ('OUTRA', 'Outra Empresa')`);
      const orgB = (await db.query(`select id from organization where code = 'OUTRA'`)).rows[0].id;
      const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001';
      const COMUM = 'aaaaaaaa-0000-0000-0000-000000000002';
      const DONO = 'aaaaaaaa-0000-0000-0000-000000000003';
      await db.query(`insert into profile (id, organization_id, name, email, role) values
        ($1,$4,'Admin','admin@eiff.com.br','Administrador'), ($2,$4,'Engenheiro','eng@eiff.com.br','Engenharia'),
        ($3,$4,'Comprador','compras@eiff.com.br','Compras')`, [ADMIN, COMUM, DONO, org]);
      await db.query(`insert into worker (organization_id, name, role_name) values ($1, 'Montador de outra org', 'Montador')`, [orgB]);
      const workerB = (await db.query(`select id from worker where organization_id = $1`, [orgB])).rows[0].id;

      // P1) a RPC atravessa o enum real (profile.role role_kind -> role::text) e o ciclo PENDING -> VERIFIED fecha
      const req = jsonDe(await db.query(
        `select whatsapp_identity_request($1, '5562988887777', 'INTERNAL', $2, now() + interval '10 min', $1, null) j`, [ADMIN, H]));
      const ver = req.identity_id ? jsonDe(await db.query(`select whatsapp_identity_verify($1, $2, $3, 5) j`, [ADMIN, req.identity_id, H])) : {};
      prova('P1 identidade PENDING -> VERIFIED com role_kind real', req.ok === true && ver.ok === true && ver.status === 'VERIFIED', JSON.stringify(ver));

      // P2) cross-tenant fecha mesmo com service_role chamando com parametro errado
      const cross = jsonDe(await db.query(
        `select whatsapp_identity_request($1, '5562911112222', 'INTERNAL', $2, now() + interval '10 min', null, $3) j`, [ADMIN, H, workerB]));
      prova('P2 colaborador de outra organizacao recusado', cross.erro === 'colaborador_de_outra_organizacao', JSON.stringify(cross));

      // P3) RLS herdada com has_role/current_org REAIS: o usuario comum nao ve a conversa INTERNAL nem seus filhos
      const conv = async (ctx, tel, dono) => (await db.query(
        `insert into central_conversation (organization_id, context, provider, phone_e164, status, human_owner_id)
         values ($1, $2, 'META_CLOUD', $3, case when $4::uuid is null then 'ABERTA' else 'ATENDIMENTO_HUMANO' end, $4)
         returning id`, [org, ctx, tel, dono ?? null])).rows[0].id;
      const cInt = await conv('INTERNAL', '5562988887777', DONO);
      const cExt = await conv('EXTERNAL', '5562911112222', null);
      for (const [c, ext] of [[cInt, 'wamid.int'], [cExt, 'wamid.ext']]) {
        await db.query(`insert into central_message (organization_id, conversation_id, provider, external_message_id, direction, occurred_at)
          values ($1, $2, 'META_CLOUD', $3, 'inbound', now())`, [org, c, ext]);
        await db.query(`insert into central_event (organization_id, conversation_id, event_type) values ($1, $2, 'MESSAGE_RECEIVED')`, [org, c]);
      }
      const comoUsuario = async (uid, sql) => {
        await db.exec(`set local role authenticated; set local test.uid = '${uid}';`);
        const r = await db.query(sql); await db.exec('reset role;'); return r.rows[0].n;
      };
      const vComum = [await comoUsuario(COMUM, 'select count(*)::int n from central_conversation'),
        await comoUsuario(COMUM, 'select count(*)::int n from central_message'),
        await comoUsuario(COMUM, 'select count(*)::int n from central_event')];
      const vAdmin = await comoUsuario(ADMIN, 'select count(*)::int n from central_message');
      const vDono = await comoUsuario(DONO, 'select count(*)::int n from central_message');
      prova('P3 RLS herdada (comum ve so a EXTERNAL; admin e dono veem as duas)',
        vComum.join(',') === '1,1,1' && vAdmin === 2 && vDono === 2,
        `comum ${vComum.join('/')} (conversa/mensagem/evento), admin ${vAdmin}, dono ${vDono}`);

      // P4) 0051 de verdade: radar_delivery_create aceita META_CLOUD e continua barrando canal incoerente
      await db.query(`insert into radar_company (organization_id, legal_name) values ($1, 'Conta de teste')`, [org]);
      const emp = (await db.query(`select id from radar_company where organization_id = $1`, [org])).rows[0].id;
      await db.query(`insert into radar_contact (organization_id, company_id, full_name) values ($1, $2, 'Contato de teste')`, [org, emp]);
      const ct = (await db.query(`select id from radar_contact where company_id = $1`, [emp])).rows[0].id;
      const comunica = async (canal) => (await db.query(
        `insert into radar_communication (organization_id, company_id, contact_id, objective, playbook, channel, state,
           context_hash, content_spec, generated_content, provider, prompt_version, playbook_version, content_spec_version, created_by)
         values ($1,$2,$3,'START_DISCOVERY','TECHNICAL',$4,'APPROVED',$5,'{}'::jsonb,'{}'::jsonb,'DETERMINISTIC','1','1','1',$6)
         returning id`, [org, emp, ct, canal, '2'.repeat(64).slice(0, 63) + (canal === 'EMAIL' ? 'a' : 'b'), ADMIN])).rows[0].id;
      const cw = await comunica('WHATSAPP');
      const ce = await comunica('EMAIL');
      const meta = jsonDe(await db.query(
        `select radar_delivery_create($1, $2, 'META_CLOUD', 'WHATSAPP', 'TEMPLATE', 'idem-meta-1', 'fp1') j`, [ADMIN, cw]));
      const ruim = jsonDe(await db.query(
        `select radar_delivery_create($1, $2, 'META_CLOUD', 'EMAIL', 'TEMPLATE', 'idem-meta-2', 'fp2') j`, [ADMIN, ce]));
      const repetida = jsonDe(await db.query(
        `select radar_delivery_create($1, $2, 'META_CLOUD', 'WHATSAPP', 'TEMPLATE', 'idem-meta-1', 'fp1') j`, [ADMIN, cw]));
      prova('P4 entrega META_CLOUD aceita em WHATSAPP, recusada em EMAIL, idempotente na repeticao',
        meta.ok === true && meta.status === 'READY' && ruim.erro === 'canal_incoerente'
          && repetida.ok === true && repetida.existente === true && repetida.delivery_id === meta.delivery_id,
        `${JSON.stringify(meta)} | ${JSON.stringify(ruim)} | repeticao existente=${repetida.existente}`);

      // P5) a pergunta do CHECK de provider sobre tabela COM DADOS: nenhum valor fora do novo catalogo sobrevive
      const fora = (await db.query(
        `select count(*)::int n from radar_communication_delivery where provider not in ('MANUAL','OCTADESK','META_CLOUD')`)).rows[0].n;
      prova('P5 nenhuma entrega com provider fora do novo CHECK', fora === 0, `${fora} linha(s) fora do catalogo`);

      await db.exec('rollback;');
      res.provas.limpeza = 'ROLLBACK — as provas nao deixaram linha nenhuma';
    } catch (e) {
      try { await db.exec('rollback;'); } catch { /* ja abortada */ }
      res.provas.erro = so(e);
    }

    // reaplicar 0049..0051 sobre o schema ja migrado: a idempotencia prometida no cabecalho das tres
    try {
      await db.exec('begin;');
      for (const arq of ['0049_whatsapp_identity.sql', '0050_central_conversation.sql', '0051_central_meta_delivery.sql']) {
        await db.exec(fs.readFileSync(path.join(RAIZ, arq), 'utf8'));
      }
      await db.exec('commit;');
      res.verificacao.idempotencia = 'PASS — 0049/0050/0051 reaplicadas sobre o schema migrado sem erro';
    } catch (e) {
      try { await db.exec('rollback;'); } catch { /* ja abortada */ }
      res.verificacao.idempotencia = `FALHOU — reaplicar quebra: ${so(e)}`;
    }
  }
} catch (e) {
  res.erroFatal = so(e);
}

const aplicadas = res.migrations.filter((m) => m.estado === 'APLICADA').length;
const erros = res.migrations.filter((m) => m.estado === 'ERRO');
res.resumo = `${aplicadas} migrations aplicadas, ${erros.length} com erro` + (res.parou_em ? `; primeira falha em ${res.parou_em.migration}` : '');
console.log(JSON.stringify(res, null, 2));
process.exitCode = erros.length || res.erroFatal ? 1 : 0;

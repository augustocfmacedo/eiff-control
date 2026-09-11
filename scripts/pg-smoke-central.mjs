// Smoke test das migrations da EIFF Central (0049, 0050, 0051) contra um PostgreSQL DE VERDADE.
//
// Por que existe: teste estatico sobre o texto do SQL nao pega erro de sintaxe, delimitador quebrado nem
// curto-circuito de PL/pgSQL. Este harness aplica as tres migrations num Postgres descartavel (PGlite, o
// Postgres compilado para WASM), roda dez smoke tests e faz ROLLBACK. NADA toca producao.
//
// Como rodar:
//   node scripts/pg-smoke-central.mjs
//
// O @electric-sql/pglite NAO e dependencia declarada do projeto: hoje ele resolve porque ja vem como
// dependencia TRANSITIVA (esta no package-lock.json). Se um dia deixar de resolver, instale sob demanda
// sem gravar no package.json:  npm i --no-save @electric-sql/pglite
//
// O harness recria SO o que as migrations assumem do resto do schema (organization, profile, worker,
// audit_log, auth.uid(), current_org(), has_role(), touch_updated_at(), os papeis do Supabase e o minimo do
// ledger de entrega). NAO e o banco real: e o suficiente para provar sintaxe, objetos criados e as regras.
//
// Divisao de trabalho com o outro harness (scripts/pg-preflight-central.mjs):
//   * ESTE arquivo prova as REGRAS das tres migrations, rapido (segundos) e contra um schema minimo montado a mao;
//   * o pg-preflight-central.mjs aplica a FILA INTEIRA (0001..0051 + a carga inicial) e prova a INTERACAO com o
//     schema real — role_kind como enum de verdade, has_role(variadic role_kind[]), current_org(), profile/worker
//     reais e o ledger de entrega vindo de 0045..0048. Antes de aplicar em producao, rode os dois.
// Este `has_role` do preludio recebe role_kind[] igual ao de producao (0003_rls.sql): se um dia divergir, o
// preflight pega, porque la a funcao e a real.
//
// Os dez smoke tests: A) identidade cross-org recusada  B) worker de outra org recusado  C) identidade com
// telefone/contexto divergente da conversa recusada  D) usuario comum nao le filhos de conversa INTERNAL
// E) human_owner le a conversa assumida e os filhos  F) codigo errado incrementa tentativa  G) 6a tentativa
// nao passa nem com p_max_attempts=999  H) codigo certo promove para VERIFIED  I) transition nao promove
// VERIFIED  J) external_message_id duplicado e recusado pelo unique.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const sha = (t) => createHash('sha256').update(t).digest('hex');
const H_CERTO = sha('123456');
const H_ERRADO = sha('999999');

const RAIZ = new URL('../supabase/migrations/', import.meta.url);
const ler = (f) => fs.readFileSync(new URL(f, RAIZ), 'utf8');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const ADMIN_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const COMUM_A = 'aaaaaaaa-0000-0000-0000-000000000002'; // Engenharia: usuário comum, não vê INTERNAL
const DONO_A = 'aaaaaaaa-0000-0000-0000-000000000003'; // Compras: vira human_owner
const PERFIL_B = 'bbbbbbbb-0000-0000-0000-000000000001';
const WORKER_A = 'aaaaaaaa-1111-0000-0000-000000000001';
const WORKER_B = 'bbbbbbbb-1111-0000-0000-000000000001';
const TEL = '5562988887777';
const OUTRO_TEL = '5562911112222';

const PRELUDIO = `
create schema if not exists auth;
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $prel$;

create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');

create table organization (id uuid primary key default gen_random_uuid(), name text not null);
create table profile (
  id uuid primary key,
  organization_id uuid not null references organization(id),
  name text not null, email text not null, role role_kind not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table worker (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null
);
create table audit_log (
  id bigserial primary key, organization_id uuid, occurred_at timestamptz not null default now(),
  actor_id uuid, action text not null, entity_type text not null, entity_id text,
  before_data jsonb, after_data jsonb, reason text, source text default 'app'
);

-- auth.uid(): no Supabase vem do JWT; aqui vem de um GUC, para o teste poder trocar de usuario
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('test.uid', true), '')::uuid
$fn$;
create or replace function current_org() returns uuid language sql stable security definer as $fn$
  select organization_id from profile where id = auth.uid() and active
$fn$;
create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $fn$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles))
$fn$;
create or replace function touch_updated_at() returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $fn$;

-- minimo do ledger de entrega, so para a 0051 poder alterar constraint e funcao
create table radar_communication (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
  company_id uuid, contact_id uuid, state text not null, channel text not null
);
create table radar_communication_delivery (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
  communication_id uuid not null references radar_communication(id), company_id uuid, contact_id uuid,
  provider text not null constraint radar_communication_delivery_provider_check check (provider in ('MANUAL', 'OCTADESK')),
  channel text not null, mode text not null, status text not null,
  idempotency_key text not null, request_fingerprint text,
  provider_sender_id text, provider_template_id text,
  requested_by uuid, last_actor_id uuid, last_actor_kind text,
  created_at timestamptz not null default now(),
  constraint rcd_idem_uk unique (organization_id, idempotency_key)
);
create or replace function radar_delivery_create(
  p_user_id uuid, p_communication_id uuid, p_provider text, p_channel text, p_mode text,
  p_idempotency_key text, p_request_fingerprint text, p_sender_id text default null, p_template_id text default null
) returns jsonb language plpgsql as $fn$ begin return jsonb_build_object('ok', false, 'erro', 'stub'); end $fn$;

grant usage on schema public, auth to authenticated, anon, service_role;
`;

const SEMENTE = `
insert into organization (id, name) values ('${ORG_A}', 'EIFF'), ('${ORG_B}', 'Outra Empresa');
insert into profile (id, organization_id, name, email, role) values
  ('${ADMIN_A}', '${ORG_A}', 'Augusto', 'a@eiff.com.br', 'Administrador'),
  ('${COMUM_A}', '${ORG_A}', 'Engenheiro', 'e@eiff.com.br', 'Engenharia'),
  ('${DONO_A}', '${ORG_A}', 'Comprador', 'c@eiff.com.br', 'Compras'),
  ('${PERFIL_B}', '${ORG_B}', 'Estranho', 'x@outra.com', 'Administrador');
insert into worker (id, organization_id, name) values
  ('${WORKER_A}', '${ORG_A}', 'Montador A'), ('${WORKER_B}', '${ORG_B}', 'Montador B');
`;

const db = new PGlite();
const res = { estrutura: [], smoke: {}, migrations: {} };
const ok = (k, v, detalhe = '') => { res.smoke[k] = v ? `PASS${detalhe ? ' — ' + detalhe : ''}` : `FALHOU${detalhe ? ' — ' + detalhe : ''}`; };

/** Roda algo que DEVE falhar; devolve a mensagem de erro (ou null se, indevidamente, passou). */
let sp = 0;
async function deveFalhar(sql, params = []) {
  // savepoint: erro esperado aborta o bloco no Postgres, entao cada tentativa roda isolada
  const nome = `sp${++sp}`;
  await db.exec(`savepoint ${nome};`);
  try {
    await db.query(sql, params);
    await db.exec(`release savepoint ${nome};`);
    return null;
  } catch (e) {
    await db.exec(`rollback to savepoint ${nome};`);
    return String(e.message ?? e);
  }
}
const jsonDe = (r) => r.rows[0][Object.keys(r.rows[0])[0]];

try {
  await db.exec(PRELUDIO);
  await db.exec(SEMENTE);

  // ---------------------------------------------------------------- migrations, dentro da transacao
  await db.exec('BEGIN;');
  for (const arq of ['0049_whatsapp_identity.sql', '0050_central_conversation.sql', '0051_central_meta_delivery.sql']) {
    try {
      await db.exec(ler(arq));
      res.migrations[arq.slice(0, 4)] = 'APLICADA sem erro';
    } catch (e) {
      res.migrations[arq.slice(0, 4)] = `ERRO: ${String(e.message ?? e).split('\n')[0]}`;
      throw e;
    }
  }

  // ---------------------------------------------------------------- estrutura
  const conta = async (rotulo, sql) => {
    const r = await db.query(sql);
    res.estrutura.push(`${rotulo}: ${r.rows.map((x) => Object.values(x)[0]).join(', ') || '(nenhum)'}`);
  };
  await conta('tabelas', `select tablename from pg_tables where tablename in ('whatsapp_identity','central_conversation','central_message','central_event') order by 1`);
  await conta('funcoes', `select proname from pg_proc where proname in ('whatsapp_identity_request','whatsapp_identity_verify','whatsapp_identity_transition','whatsapp_identity_attempt','whatsapp_identity_coerencia','central_conversation_coerencia','central_event_ator_coerencia','central_coerencia','radar_delivery_create') order by 1`);
  await conta('triggers', `select tgname from pg_trigger where not tgisinternal and tgname like '%coerencia%' or tgname in ('central_event_ator','whatsapp_identity_estado','central_message_estado') order by 1`);
  await conta('policies', `select policyname from pg_policies where tablename in ('whatsapp_identity','central_conversation','central_message','central_event') order by 1`);
  const assinatura = await db.query(`select pg_get_function_arguments(oid) a from pg_proc where proname = 'whatsapp_identity_verify'`);
  res.estrutura.push(`assinatura whatsapp_identity_verify(${assinatura.rows[0].a})`);
  const provider = await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'radar_communication_delivery_provider_check'`);
  res.estrutura.push(`provider check: ${provider.rows[0].d}`);

  // ---------------------------------------------------------------- A) identidade cross-org
  const eA = await deveFalhar(
    `insert into whatsapp_identity (organization_id, profile_id, phone_e164, context) values ($1, $2, $3, 'INTERNAL')`,
    [ORG_A, PERFIL_B, TEL]);
  ok('A', !!eA && /organização/i.test(eA), eA ? eA.split('\n')[0] : 'PASSOU indevidamente');

  // ---------------------------------------------------------------- B) worker de outra org
  const rB = await db.query(
    `select whatsapp_identity_request($1, $2, 'INTERNAL', repeat('a', 64), now() + interval '10 min', null, $3) j`,
    [ADMIN_A, OUTRO_TEL, WORKER_B]);
  ok('B', jsonDe(rB).erro === 'colaborador_de_outra_organizacao', JSON.stringify(jsonDe(rB)));
  // e o worker da propria organizacao passa
  const rB2 = await db.query(
    `select whatsapp_identity_request($1, $2, 'INTERNAL', repeat('b', 64), now() + interval '10 min', null, $3) j`,
    [ADMIN_A, OUTRO_TEL, WORKER_A]);
  if (jsonDe(rB2).ok !== true) throw new Error('worker da propria org deveria passar: ' + JSON.stringify(jsonDe(rB2)));

  // ---------------------------------------------------------------- identidade valida para os proximos testes
  const rReq = await db.query(
    `select whatsapp_identity_request($1, $2, 'INTERNAL', '${H_CERTO}', now() + interval '10 min', $1, null) j`,
    [ADMIN_A, TEL]);
  const ID_OK = jsonDe(rReq).identity_id;
  if (!ID_OK) throw new Error('nao criou identidade base: ' + JSON.stringify(jsonDe(rReq)));

  // ---------------------------------------------------------------- C) binding conversa <-> identidade
  const eC = await deveFalhar(
    `insert into central_conversation (organization_id, context, provider, phone_e164, identity_id) values ($1, 'INTERNAL', 'META_CLOUD', $2, $3)`,
    [ORG_A, OUTRO_TEL, ID_OK]); // telefone da conversa != telefone da identidade
  ok('C', !!eC && /não corresponde a esta conversa/i.test(eC), eC ? eC.split('\n')[0] : 'PASSOU indevidamente');
  const eC2 = await deveFalhar(
    `insert into central_conversation (organization_id, context, provider, phone_e164, identity_id) values ($1, 'EXTERNAL', 'META_CLOUD', $2, $3)`,
    [ORG_A, TEL, ID_OK]); // contexto divergente
  if (!eC2) res.smoke.C += ' | ATENCAO: contexto divergente passou';

  // ---------------------------------------------------------------- conversas para D/E/J
  const cInt = await db.query(
    `insert into central_conversation (organization_id, context, provider, phone_e164, identity_id, status, human_owner_id)
     values ($1, 'INTERNAL', 'META_CLOUD', $2, $3, 'ATENDIMENTO_HUMANO', $4) returning id`, [ORG_A, TEL, ID_OK, DONO_A]);
  const CONV_INT = cInt.rows[0].id;
  const cExt = await db.query(
    `insert into central_conversation (organization_id, context, provider, phone_e164) values ($1, 'EXTERNAL', 'META_CLOUD', $2) returning id`,
    [ORG_A, OUTRO_TEL]);
  const CONV_EXT = cExt.rows[0].id;
  await db.query(
    `insert into central_message (organization_id, conversation_id, provider, external_message_id, direction, occurred_at)
     values ($1, $2, 'META_CLOUD', 'wamid.interna', 'inbound', now())`, [ORG_A, CONV_INT]);
  await db.query(
    `insert into central_message (organization_id, conversation_id, provider, external_message_id, direction, occurred_at)
     values ($1, $2, 'META_CLOUD', 'wamid.externa', 'inbound', now())`, [ORG_A, CONV_EXT]);
  await db.query(
    `insert into central_event (organization_id, conversation_id, event_type) values ($1, $2, 'MESSAGE_RECEIVED')`, [ORG_A, CONV_INT]);

  // ---------------------------------------------------------------- D) usuario comum nao le filhos de INTERNAL
  const comoUsuario = async (uid, sql) => {
    await db.exec(`set local role authenticated; set local test.uid = '${uid}';`);
    const r = await db.query(sql);
    await db.exec('reset role;');
    return r;
  };
  const dMsg = await comoUsuario(COMUM_A, `select count(*)::int n from central_message`);
  const dEv = await comoUsuario(COMUM_A, `select count(*)::int n from central_event`);
  const dConv = await comoUsuario(COMUM_A, `select count(*)::int n from central_conversation`);
  ok('D', dMsg.rows[0].n === 1 && dEv.rows[0].n === 0 && dConv.rows[0].n === 1,
    `comum vê ${dConv.rows[0].n} conversa (a EXTERNAL), ${dMsg.rows[0].n} mensagem (a EXTERNAL), ${dEv.rows[0].n} evento`);

  // ---------------------------------------------------------------- E) human_owner le a conversa assumida e os filhos
  const eConv = await comoUsuario(DONO_A, `select count(*)::int n from central_conversation`);
  const eMsg = await comoUsuario(DONO_A, `select count(*)::int n from central_message`);
  const eEv = await comoUsuario(DONO_A, `select count(*)::int n from central_event`);
  ok('E', eConv.rows[0].n === 2 && eMsg.rows[0].n === 2 && eEv.rows[0].n === 1,
    `dono vê ${eConv.rows[0].n} conversas, ${eMsg.rows[0].n} mensagens, ${eEv.rows[0].n} evento`);
  // e o Administrador vê tudo
  const adm = await comoUsuario(ADMIN_A, `select count(*)::int n from central_message`);
  if (adm.rows[0].n !== 2) res.smoke.E += ` | ATENCAO: Administrador vê ${adm.rows[0].n}`;

  // ---------------------------------------------------------------- F) codigo errado incrementa tentativa
  const errado = `select whatsapp_identity_verify($1, $2, '${H_ERRADO}', 999) j`;
  const rF = await db.query(errado, [ADMIN_A, ID_OK]);
  ok('F', jsonDe(rF).erro === 'codigo_nao_confere' && jsonDe(rF).tentativas === 1, JSON.stringify(jsonDe(rF)));

  // ---------------------------------------------------------------- G) 6a tentativa nao passa, mesmo com p_max = 999
  let ultimo;
  for (let i = 0; i < 5; i++) ultimo = jsonDe(await db.query(errado, [ADMIN_A, ID_OK]));
  ok('G', ultimo.erro === 'tentativas_excedidas' && ultimo.limite === 5, JSON.stringify(ultimo));
  // e nem o codigo CERTO passa depois do teto
  const certoBloqueado = jsonDe(await db.query(
    `select whatsapp_identity_verify($1, $2, '${H_CERTO}', 999) j`, [ADMIN_A, ID_OK]));
  if (certoBloqueado.ok === true) res.smoke.G += ' | ATENCAO: codigo certo passou apos o teto';

  // ---------------------------------------------------------------- H) codigo certo promove (identidade nova)
  const rReq2 = await db.query(
    `select whatsapp_identity_request($1, $2, 'EXTERNAL', '${H_CERTO}', now() + interval '10 min', $1, null) j`,
    [ADMIN_A, TEL]);
  const ID_H = jsonDe(rReq2).identity_id;
  const rH = jsonDe(await db.query(
    `select whatsapp_identity_verify($1, $2, '${H_CERTO}', 5) j`, [ADMIN_A, ID_H]));
  const linhaH = await db.query(`select status, verified_at, verification_code_hash, verification_attempts from whatsapp_identity where id = $1`, [ID_H]);
  const h = linhaH.rows[0];
  ok('H', rH.ok === true && h.status === 'VERIFIED' && h.verified_at !== null && h.verification_code_hash === null && h.verification_attempts === 0,
    `${JSON.stringify(rH)} / status=${h.status} hash=${h.verification_code_hash} tentativas=${h.verification_attempts}`);

  // ---------------------------------------------------------------- I) transition nao promove VERIFIED
  const rReq3 = await db.query(
    `select whatsapp_identity_request($1, $2, 'INTERNAL', '${H_CERTO}', now() + interval '10 min', $1, null) j`,
    [ADMIN_A, '5562900001111']);
  const ID_I = jsonDe(rReq3).identity_id;
  const rI = jsonDe(await db.query(`select whatsapp_identity_transition($1, $2, 'VERIFIED', null) j`, [ADMIN_A, ID_I]));
  const linhaI = await db.query(`select status from whatsapp_identity where id = $1`, [ID_I]);
  const rIrev = jsonDe(await db.query(`select whatsapp_identity_transition($1, $2, 'REVOKED', 'teste') j`, [ADMIN_A, ID_I]));
  ok('I', rI.ok === false && rI.erro === 'situacao_invalida' && linhaI.rows[0].status === 'PENDING' && rIrev.ok === true,
    `VERIFIED -> ${JSON.stringify(rI)}; status seguiu ${linhaI.rows[0].status}; REVOKED -> ok=${rIrev.ok}`);

  // ---------------------------------------------------------------- J) dedup por external_message_id
  const eJ = await deveFalhar(
    `insert into central_message (organization_id, conversation_id, provider, external_message_id, direction, occurred_at)
     values ($1, $2, 'META_CLOUD', 'wamid.interna', 'inbound', now())`, [ORG_A, CONV_INT]);
  ok('J', !!eJ && /central_message_externo_uk|duplicate key/i.test(eJ), eJ ? eJ.split('\n')[0] : 'PASSOU indevidamente');

  await db.exec('ROLLBACK;');
  const sobrou = await db.query(`select count(*)::int n from pg_tables where tablename = 'whatsapp_identity'`);
  res.rollback = sobrou.rows[0].n === 0 ? 'ROLLBACK ok — nada persistiu' : 'ATENCAO: tabela sobreviveu ao rollback';
} catch (e) {
  res.erroFatal = String(e.message ?? e);
  try { await db.exec('ROLLBACK;'); } catch { /* ja abortada */ }
}

console.log(JSON.stringify(res, null, 2));

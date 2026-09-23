// Smoke test da migration 0055 (staging do Lead Engine) contra um PostgreSQL DE VERDADE.
//
// Por que existe: o LE-2A tornou `registrosFonte` MUTAVEL no adapter, para a decisao humana
// (PENDING -> REVIEW -> RESOLVED/REJECTED) virar UPDATE. Isso so e seguro porque o BANCO recusa alteracao da
// evidencia bruta. Teste de TypeScript nao prova trigger de PostgreSQL: prova o que o adapter MANDA, nao o que
// o banco ACEITA. Este harness prova a outra metade.
//
// Como rodar:
//   node scripts/pg-smoke-lead-engine.mjs
//
// O @electric-sql/pglite e devDependency FIXADA (0.3.16). O banco e criado em memoria, roda dentro de
// BEGIN ... ROLLBACK e morre com o processo. NADA toca producao, NAO ha conexao de rede.
//
// O preludio recria SO o que a 0055 assume do resto do schema (organization, profile, radar_source e a
// radar_source_record como a 0031 a criou). Nao e o banco real; e o suficiente para provar o trigger, os CHECKs
// e o indice de idempotencia. A interacao com a fila inteira e assunto do pg-preflight-central.mjs.
//
// Cada asserção roda dentro de um SAVEPOINT: no Postgres, um comando que falha ABORTA a transacao inteira
// (25P02) e todos os seguintes seriam ignorados. Com savepoint, a recusa esperada volta so ate ali.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL_0055 = readFileSync('supabase/migrations/0055_lead_engine_intake.sql', 'utf8');

// radar_source_record exatamente como a migration 0031 a criou, mais o minimo de que ela depende.
// gen_random_uuid() e nativo do core desde o PostgreSQL 13: nao precisa de pgcrypto.
const PRELUDIO = `
create table organization (id uuid primary key default gen_random_uuid(), code text);
create table profile (id uuid primary key default gen_random_uuid(), nome text);
create table radar_source (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), code text);
create table radar_source_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_id uuid not null references radar_source(id),
  record_type text not null check (record_type in ('empresa','contato','projeto','sinal')),
  external_id text,
  payload jsonb not null,
  entity_id uuid,
  received_at timestamptz not null default now()
);
create index radar_source_record_source_idx on radar_source_record (source_id, received_at desc);
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

async function main() {
  console.log('LE-2A · smoke da migration 0055 em PostgreSQL descartavel (PGlite)\n');
  await db.exec(PRELUDIO);
  await db.exec(SQL_0055);
  console.log('  preludio + 0055 aplicadas\n');

  await db.exec('begin');

  const um = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const org = await um("insert into organization (code) values ('EIFF') returning id");
  const perfil = await um("insert into profile (nome) values ('Augusto') returning id");
  const fonte = await um("insert into radar_source (organization_id, code) values ($1,'CNO') returning id", [org]);
  const fonte2 = await um("insert into radar_source (organization_id, code) values ($1,'PNCP') returning id", [org]);
  const entidade = await um("insert into organization (code) values ('ALVO') returning id"); // faz as vezes da entidade ligada

  const INSERIR = `insert into radar_source_record (organization_id, source_id, record_type, external_id, payload, payload_fingerprint, intake_status)
                   values ($1,$2,'projeto',$3,'{"cno":"x"}'::jsonb,$4,'PENDING') returning id`;
  const a = await um(INSERIR, [org, fonte, 'obra-1', 'f'.repeat(64)]);

  console.log('evidencia bruta imutavel (trigger radar_source_record_evidencia)');
  await recusa('payload nao pode ser reescrito', `update radar_source_record set payload = '{"cno":"OUTRO"}'::jsonb where id = $1`, [a], 'evidencia bruta');
  await recusa('external_id nao pode mudar', `update radar_source_record set external_id = 'obra-9' where id = $1`, [a], 'evidencia bruta');
  await recusa('source_id nao pode mudar', `update radar_source_record set source_id = $2 where id = $1`, [a, fonte2], 'evidencia bruta');
  await recusa('record_type nao pode mudar', `update radar_source_record set record_type = 'empresa' where id = $1`, [a], 'evidencia bruta');
  await recusa('received_at nao pode mudar', `update radar_source_record set received_at = now() + interval '1 day' where id = $1`, [a], 'evidencia bruta');
  await recusa('payload_fingerprint nao pode mudar', `update radar_source_record set payload_fingerprint = $2 where id = $1`, [a, 'e'.repeat(64)], 'evidencia bruta');
  await recusa('organization_id nao pode mudar', `update radar_source_record set organization_id = $2 where id = $1`, [a, entidade], 'evidencia bruta');

  console.log('\ncampos de decisao PODEM mudar');
  await aceita('PENDING -> REVIEW', `update radar_source_record set intake_status = 'REVIEW' where id = $1`, [a]);
  await aceita(
    'REVIEW -> RESOLVED com entidade, ator, data e motivo',
    `update radar_source_record set intake_status='RESOLVED', entity_id=$2, decided_at=now(), decided_by=$3, decision_reason='promovido' where id = $1`,
    [a, entidade, perfil],
  );

  console.log('\ncoerencia de estado (CHECKs da 0055)');
  const b = await um(INSERIR, [org, fonte, 'obra-2', 'a'.repeat(64)]);
  await recusa('RESOLVED sem entidade e recusado', `update radar_source_record set intake_status='RESOLVED' where id = $1`, [b], 'intake_entidade');
  await aceita(
    'REJECTED sem entidade e permitido',
    `update radar_source_record set intake_status='REJECTED', decision_reason='fora do perfil', decided_at=now(), decided_by=$2 where id = $1`,
    [b, perfil],
  );
  await recusa('status fora do vocabulario e recusado', `update radar_source_record set intake_status='SUPERSEDED' where id = $1`, [b], 'intake_status');
  await recusa(
    'registro gerenciado exige identidade externa e impressao',
    `insert into radar_source_record (organization_id, source_id, record_type, payload, intake_status) values ($1,$2,'projeto','{}'::jsonb,'PENDING')`,
    [org, fonte],
    'intake_identidade',
  );

  console.log('\nidempotencia (indice unico por observacao)');
  await recusa('repeticao EXATA e proibida', INSERIR, [org, fonte, 'obra-2', 'a'.repeat(64)], 'duplicate key');
  await aceita('mesma identidade externa com OUTRA impressao e nova observacao', INSERIR, [org, fonte, 'obra-2', 'b'.repeat(64)]);

  console.log('\nregistro legado (anterior ao Lead Engine)');
  await aceita(
    'linha sem intake_status continua valida, sem external_id nem impressao',
    `insert into radar_source_record (organization_id, source_id, record_type, payload) values ($1,$2,'empresa','{"nome":"Antiga"}'::jsonb)`,
    [org, fonte],
  );
  const pendentes = (await db.query(`select count(*)::int as n from radar_source_record where intake_status = 'PENDING'`)).rows[0].n;
  if (pendentes === 1) passou('historico nao vira pendencia (so a observacao nova esta PENDING)');
  else quebrou('historico nao vira pendencia', 'esperava 1 PENDING, achou ' + pendentes);

  await db.exec('rollback');

  console.log('\n' + ok + ' ok · ' + falhou + ' falha(s)');
  if (falhou) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

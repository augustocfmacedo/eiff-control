// Smoke do formulário do site contra um PostgreSQL DE VERDADE (PGlite, em memória, ROLLBACK ao final).
//
// Por que existe: a suíte vitest prova o que o CORE decide (planejarGravacao) e o que a borda valida. Não prova
// o que o BANCO aceita — e o ponto frágil desta integração é exatamente de banco: a submissão vira DUAS
// gravações em subsistemas diferentes (evidência no Lead Engine, conversa no Inbox) e NÃO HÁ TRANSAÇÃO que
// cubra as duas. Existe, portanto, um instante em que a primeira aconteceu e a segunda não.
//
// O que se prova aqui, em PostgreSQL real:
//
//   A  a evidência da submissão entra como PENDING, sem entidade — ninguém precisa de empresa para existir
//   B  o reenvio idêntico é RECUSADO PELO ÍNDICE, não pela boa vontade do TypeScript
//   C  a mesma submissão com conteúdo diferente é ACEITA e fica AO LADO, sem sobrescrever
//   D  a evidência é imutável: editar o payload é recusado pelo trigger
//   E  recuperação: com a evidência já gravada, o reenvio não consegue duplicá-la — e é por isso que
//      completar só a conversa é seguro
//   F  promover exige entidade: RESOLVED sem entity_id é recusado pelo CHECK
//
// A outra metade — a idempotência do Inbox em PostgreSQL — já é provada por scripts/pg-smoke-inbox.mjs
// (provas A–R, incluindo a RPC inbox_ingest). Este harness não a repete; prova a INTERAÇÃO entre as duas.
//
// Como rodar:  node scripts/pg-smoke-formulario.mjs     (imprime JSON; sai com 1 se qualquer prova falhar)
//
// O @electric-sql/pglite é devDependency FIXADA. O banco é em memória, roda dentro de BEGIN ... ROLLBACK e
// morre com o processo. NADA toca produção e NÃO há conexão de rede.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL_0055 = readFileSync('supabase/migrations/0055_lead_engine_intake.sql', 'utf8');

// O mínimo de que a 0055 depende, como a 0031 criou.
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
`;

const provas = [];
const prova = (id, descricao, ok, detalhe) => { provas.push({ id, descricao, ok, ...(detalhe === undefined ? {} : { detalhe }) }); };

/** Cada asserção num SAVEPOINT: no Postgres um comando que falha aborta a transação inteira. */
async function recusa(db, sql, params, id, descricao) {
  await db.exec('savepoint s');
  try {
    await db.query(sql, params);
    await db.exec('rollback to savepoint s');
    prova(id, descricao, false, 'o banco ACEITOU o que deveria recusar');
  } catch (e) {
    await db.exec('rollback to savepoint s');
    prova(id, descricao, true, String(e.message ?? e).split('\n')[0].slice(0, 160));
  }
}

async function main() {
  const db = new PGlite();
  await db.exec(PRELUDIO);
  await db.exec(SQL_0055);
  await db.exec('begin');

  const org = (await db.query('insert into organization (code) values ($1) returning id', ['EIFF'])).rows[0].id;
  const fonte = (await db.query('insert into radar_source (organization_id, code) values ($1, $2) returning id', [org, 'WEBSITE'])).rows[0].id;

  // A submissão fictícia, com a identidade e a impressão que o core calcularia.
  const EXTERNO = 'netlify-smoke-0001';
  const IMPRESSAO = 'f'.repeat(64);
  const PAYLOAD = JSON.stringify({
    schema: 'FORMULARIO_SITE_V1',
    evidence: { id: EXTERNO, formulario: 'simular-galpao', recebidoEm: '2026-11-09T14:00:00.000Z', campos: { nome: 'Ana (FICTÍCIO)', email: 'ana@exemplo.com.br', area: '900 m²' } },
    canonical: { formulario: 'simular-galpao', nome: 'Ana (FICTÍCIO)', email: 'ana@exemplo.com.br', areaM2: 900 },
  });

  const inserir = (impressao) => db.query(
    `insert into radar_source_record (organization_id, source_id, record_type, external_id, payload, payload_fingerprint, intake_status)
     values ($1, $2, 'empresa', $3, $4::jsonb, $5, 'PENDING') returning id, intake_status, entity_id`,
    [org, fonte, EXTERNO, PAYLOAD, impressao],
  );

  // A — a evidência entra sem entidade
  const a = (await inserir(IMPRESSAO)).rows[0];
  prova('A', 'submissão entra como PENDING e SEM entidade (nenhuma empresa exigida)',
    a.intake_status === 'PENDING' && a.entity_id === null,
    `status=${a.intake_status} entity_id=${a.entity_id}`);

  // B — reenvio idêntico recusado PELO BANCO
  await recusa(db, `insert into radar_source_record (organization_id, source_id, record_type, external_id, payload, payload_fingerprint, intake_status)
     values ($1, $2, 'empresa', $3, $4::jsonb, $5, 'PENDING')`, [org, fonte, EXTERNO, PAYLOAD, IMPRESSAO],
    'B', 'reenvio idêntico é recusado pelo índice de observação (idempotência no BANCO)');

  // C — conteúdo diferente, mesma identidade: aceito AO LADO
  const outraImpressao = 'e'.repeat(64);
  const c = (await inserir(outraImpressao)).rows[0];
  const quantos = (await db.query('select count(*)::int as n from radar_source_record where external_id = $1', [EXTERNO])).rows[0].n;
  prova('C', 'mesma identidade com conteúdo diferente nasce AO LADO, sem sobrescrever',
    c.id !== a.id && quantos === 2, `registros com o mesmo external_id: ${quantos}`);

  // D — evidência imutável
  await recusa(db, `update radar_source_record set payload = '{"adulterado":true}'::jsonb where id = $1`, [a.id],
    'D', 'editar o payload da evidência é recusado pelo trigger');

  // E — recuperação: a evidência não pode ser duplicada, então completar só a conversa é seguro
  await recusa(db, `insert into radar_source_record (organization_id, source_id, record_type, external_id, payload, payload_fingerprint, intake_status)
     values ($1, $2, 'empresa', $3, $4::jsonb, $5, 'PENDING')`, [org, fonte, EXTERNO, PAYLOAD, IMPRESSAO],
    'E', 'recuperação: com a evidência gravada, o reenvio NÃO consegue duplicá-la');

  // F — promover exige entidade
  await recusa(db, `update radar_source_record set intake_status = 'RESOLVED' where id = $1`, [a.id],
    'F', 'RESOLVED sem entity_id é recusado pelo CHECK: promover exige entidade');

  // G — e o que sobrou é o esperado
  const g = (await db.query(`select intake_status, count(*)::int as n from radar_source_record group by 1 order by 1`)).rows;
  prova('G', 'estado final: duas observações PENDING da mesma submissão',
    g.length === 1 && g[0].intake_status === 'PENDING' && g[0].n === 2, JSON.stringify(g));

  await db.exec('rollback');
  await db.close();

  const falhas = provas.filter((p) => !p.ok);
  console.log(JSON.stringify({ provas, total: provas.length, falhas: falhas.length }, null, 2));
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

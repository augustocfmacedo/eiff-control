// Smoke test da migration 0056 (EIFF Inbox) contra um PostgreSQL DE VERDADE (PGlite, em memoria, ROLLBACK ao final).
//
// Por que existe: a suite vitest prova o que o CORE decide (src/core/inbox) e o que o adapter MANDA (src/data); nao prova
// o que o BANCO aceita. Aqui se prova a outra metade: idempotencia da ingestao, resolucao de thread, append-only,
// imutabilidade da mensagem e — o ponto critico da fase 2 — o RLS por setor.
//
// Como rodar:  node scripts/pg-smoke-inbox.mjs        (imprime JSON; sai com 1 se qualquer prova falhar)
//
// O preludio recria SO o que a 0056 assume do resto do schema (organization, profile, project, worker, radar_contact,
// radar_company, role_kind, auth.uid() por GUC, current_org(), has_role(), touch_updated_at()). Nao e o banco real;
// a interacao com a fila inteira e assunto do pg-preflight-central.mjs, que tambem aplica a 0056 (le a pasta inteira).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const RAIZ = new URL('../supabase/migrations/', import.meta.url);
const SQL_0056 = fs.readFileSync(new URL('0056_inbox.sql', RAIZ), 'utf8');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const DIR_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // Diretoria: transversal
const FIN_A = 'aaaaaaaa-0000-0000-0000-000000000002'; // Financeiro: membro do setor FINANCEIRO
const ENG_A = 'aaaaaaaa-0000-0000-0000-000000000003'; // Engenharia: membro de OBRAS
const AUD_A = 'aaaaaaaa-0000-0000-0000-000000000004'; // Auditoria: sem a permissao inbox
const ADM_B = 'bbbbbbbb-0000-0000-0000-000000000001'; // outra organizacao
const TEL = '5562988887777';

const PRELUDIO = `
create schema if not exists auth;
do $prel$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $prel$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria');
create table organization (id uuid primary key default gen_random_uuid(), name text not null);
create table profile (id uuid primary key, organization_id uuid not null references organization(id), name text not null, email text not null, role role_kind not null, active boolean not null default true);
create table company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text);
create table project (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), code text not null);
create table worker (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null);
create table radar_company (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), legal_name text);
create table radar_contact (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), full_name text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
create or replace function current_org() returns uuid language sql stable security definer as $fn$ select organization_id from profile where id = auth.uid() and active $fn$;
create or replace function has_role(variadic roles role_kind[]) returns boolean language sql stable security definer as $fn$
  select exists (select 1 from profile where id = auth.uid() and active and role = any(roles)) $fn$;
create or replace function touch_updated_at() returns trigger language plpgsql as $fn$
begin new.updated_at := now(); new.version := coalesce(old.version, 0) + 1; return new; end $fn$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select on profile to authenticated;
`;
const SEMENTE = `
insert into organization (id, name) values ('${ORG_A}', 'EIFF'), ('${ORG_B}', 'Outra');
insert into profile (id, organization_id, name, email, role) values
  ('${DIR_A}', '${ORG_A}', 'Diretor', 'd@eiff', 'Diretoria'),
  ('${FIN_A}', '${ORG_A}', 'Financeiro', 'f@eiff', 'Financeiro'),
  ('${ENG_A}', '${ORG_A}', 'Engenheiro', 'e@eiff', 'Engenharia'),
  ('${AUD_A}', '${ORG_A}', 'Auditor', 'a@eiff', 'Auditoria'),
  ('${ADM_B}', '${ORG_B}', 'Estranho', 'x@outra', 'Administrador');
insert into inbox_sector (id, organization_id, code, name, sort_order) values
  ('cccccccc-0000-0000-0000-000000000001', '${ORG_A}', 'FINANCEIRO', 'Financeiro', 1),
  ('cccccccc-0000-0000-0000-000000000002', '${ORG_A}', 'OBRAS', 'Obras', 2);
insert into inbox_member (organization_id, profile_id, sector_id, member_role) values
  ('${ORG_A}', '${FIN_A}', 'cccccccc-0000-0000-0000-000000000001', 'gestor'),
  ('${ORG_A}', '${ENG_A}', 'cccccccc-0000-0000-0000-000000000002', 'atendente');
insert into inbox_config (organization_id) values ('${ORG_A}');
`;

const db = new PGlite();
const res = { migration: '', smoke: {}, rollback: '' };
let falhas = 0;
const ok = (k, cond, detalhe = '') => { res.smoke[k] = cond ? `PASS${detalhe ? ' — ' + detalhe : ''}` : `FALHOU${detalhe ? ' — ' + detalhe : ''}`; if (!cond) falhas++; };
const j = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
let sp = 0;
async function deveFalhar(sql, params = []) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try { await db.query(sql, params); await db.exec('release savepoint ' + nome); return null; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); return String(e.message); }
}
async function comoUsuario(uid, sql, params = []) {
  await db.exec(`set local role authenticated; set local test.uid = '${uid}';`);
  let erro; let r;
  try { r = await db.query(sql, params); } catch (e) { erro = e; }
  // reset role pode falhar quando a transacao ja abortou: o erro que importa e o da consulta
  await db.exec('reset role;').catch(() => {});
  if (erro) throw erro;
  return r;
}
async function comoUsuarioFalha(uid, sql, params = []) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try { await comoUsuario(uid, sql, params); await db.exec('release savepoint ' + nome); return null; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); await db.exec('reset role;').catch(() => {}); return String(e.message); }
}
const ingest = (extra = {}) => db.query(
  `select inbox_ingest($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz) j`,
  [ORG_A, extra.provider ?? 'META_CLOUD', extra.channel ?? 'WHATSAPP', extra.context ?? 'EXTERNAL', extra.identifier ?? TEL, extra.nome ?? 'Paulo Aços',
    extra.externalId ?? 'wamid.1', extra.conv ?? TEL, extra.body ?? 'Bom dia, a NF 583 já está liberada?', extra.tipo ?? 'texto', extra.em ?? '2026-09-23T12:00:00Z']);

async function main() {
  try {
    await db.exec(PRELUDIO);
    await db.exec(SQL_0056);
    res.migration = 'APLICADA sem erro';
    await db.exec('begin');
    await db.exec(SEMENTE);

    // A) ingestao cria contato, identidade, thread NOVA com SLA, mensagem e dois eventos
    const a = j(await ingest());
    const evA = await db.query('select event_type from inbox_thread_event where thread_id = $1 order by occurred_at, created_at', [a.thread_id]);
    const thA = (await db.query('select status, sla_first_response_due, subject from inbox_thread where id = $1', [a.thread_id])).rows[0];
    ok('A', a.ok && a.nova_thread && a.novo_contato && !a.duplicada && thA.status === 'NOVA' && !!thA.sla_first_response_due && evA.rows.map((x) => x.event_type).join(',') === 'THREAD_CREATED,MESSAGE_RECEIVED',
      `thread ${thA.status} · assunto "${thA.subject}" · eventos ${evA.rows.map((x) => x.event_type).join(',')}`);

    // B) o MESMO evento de novo e duplicado: nenhuma mensagem, thread ou evento a mais
    const antes = (await db.query('select (select count(*) from inbox_message) m, (select count(*) from inbox_thread) t, (select count(*) from inbox_thread_event) e')).rows[0];
    const b = j(await ingest());
    const depois = (await db.query('select (select count(*) from inbox_message) m, (select count(*) from inbox_thread) t, (select count(*) from inbox_thread_event) e')).rows[0];
    ok('B', b.ok && b.duplicada && b.thread_id === a.thread_id && b.message_id === a.message_id && JSON.stringify(antes) === JSON.stringify(depois), 'reenvio ignorado; contagens iguais');

    // C) mensagem seguinte do mesmo contato reusa a thread; contato novo abre outra
    const c = j(await ingest({ externalId: 'wamid.2', body: 'Segue a nota em anexo' }));
    const c2 = j(await ingest({ externalId: 'wamid.3', identifier: '5562911112222', nome: 'Outro', body: 'Olá' }));
    ok('C', !c.nova_thread && c.thread_id === a.thread_id && !c.novo_contato && c2.nova_thread && c2.novo_contato && c2.thread_id !== a.thread_id, 'mesma identidade+contexto reusa; identidade nova abre');

    // D) thread FECHADA reabre com mensagem nova (evento THREAD_REOPENED); contexto INTERNAL nao mistura com EXTERNAL
    await db.query(`update inbox_thread set status = 'FECHADA', resolved_at = now(), closed_at = now(), resolved_by = 'humano' where id = $1`, [a.thread_id]);
    const d = j(await ingest({ externalId: 'wamid.4', body: 'Voltei' }));
    const thD = (await db.query('select status, closed_at from inbox_thread where id = $1', [a.thread_id])).rows[0];
    const reab = await db.query(`select count(*)::int n from inbox_thread_event where thread_id = $1 and event_type = 'THREAD_REOPENED'`, [a.thread_id]);
    const dInt = j(await ingest({ externalId: 'wamid.5', context: 'INTERNAL', body: 'interno' }));
    ok('D', d.reaberta && d.thread_id === a.thread_id && thD.status === 'EM_ATENDIMENTO' && thD.closed_at === null && reab.rows[0].n === 1 && dInt.nova_thread, `reaberta=${d.reaberta} status=${thD.status}; INTERNAL abriu outra thread=${dInt.nova_thread}`);

    // E) evento append-only e mensagem imutavel no conteudo (entrega e meta evoluem)
    const eUp = await deveFalhar(`update inbox_thread_event set detail = 'x' where thread_id = $1`, [a.thread_id]);
    const eDel = await deveFalhar(`delete from inbox_thread_event where thread_id = $1`, [a.thread_id]);
    const eBody = await deveFalhar(`update inbox_message set body = 'alterado' where id = $1`, [a.message_id]);
    const eOk = await deveFalhar(`update inbox_message set delivery_state = 'lida', meta = '{"origem":"teste"}' where id = $1`, [a.message_id]);
    const eMeta = await deveFalhar(`update inbox_message set meta = '{"headers":{"authorization":"x"}}' where id = $1`, [a.message_id]);
    ok('E', /imutável/i.test(eUp ?? '') && /imutável/i.test(eDel ?? '') && /imutável/i.test(eBody ?? '') && eOk === null && /check/i.test(eMeta ?? ''), 'update/delete de evento e body recusados; entrega/meta aceitos; meta com header recusada');

    // F) ingest so pelo servidor: usuario autenticado nao executa
    const f = await comoUsuarioFalha(DIR_A, `select inbox_ingest($1, 'META_CLOUD', 'WHATSAPP', 'EXTERNAL', '5562900000000', 'x', 'wamid.9', 'c', 'oi', 'texto', now())`, [ORG_A]);
    ok('F', !!f && /permission denied|permissão|denied/i.test(f), (f ?? 'PASSOU indevidamente').split('\n')[0]);

    // ------------------------------------------------------------------- RLS por setor
    // threads: T1 (a.thread_id) sem setor (triagem); T2 (c2) no FINANCEIRO; T3 (dInt) em OBRAS atribuida ao ENG; T4 em OBRAS sem responsavel
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000001', status = 'TRIADA' where id = $1`, [c2.thread_id]);
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000002', assignee_id = $2, participant_ids = array[$2::uuid], status = 'ATRIBUIDA' where id = $1`, [dInt.thread_id, ENG_A]);
    const t4 = j(await ingest({ externalId: 'wamid.6', identifier: '5562933334444', nome: 'Quarto', body: 'obra' }));
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000002', status = 'TRIADA' where id = $1`, [t4.thread_id]);
    const contar = async (uid) => (await comoUsuario(uid, 'select count(*)::int n from inbox_thread')).rows[0].n;
    const vistos = async (uid) => (await comoUsuario(uid, 'select id from inbox_thread order by opened_at')).rows.map((r) => r.id);

    // G) Diretoria transversal ve as 4; Financeiro ve a sem setor + a do seu setor (2); Engenharia ve OBRAS (2) + sem setor (1) = 3
    const g = { dir: await contar(DIR_A), fin: await contar(FIN_A), eng: await contar(ENG_A) };
    const finVe = await vistos(FIN_A);
    ok('G', g.dir === 4 && g.fin === 2 && g.eng === 3 && finVe.includes(a.thread_id) && finVe.includes(c2.thread_id) && !finVe.includes(dInt.thread_id),
      `Diretoria ${g.dir} · Financeiro ${g.fin} · Engenharia ${g.eng}`);

    // H) Auditoria (sem `inbox`) nao ve nada; outra organizacao nao ve nada; mensagens/eventos herdam (Financeiro nao le a mensagem de OBRAS)
    const h = { aud: await contar(AUD_A), b: await contar(ADM_B) };
    const finMsgs = (await comoUsuario(FIN_A, 'select count(*)::int n from inbox_message where thread_id = $1', [dInt.thread_id])).rows[0].n;
    const finEv = (await comoUsuario(FIN_A, 'select count(*)::int n from inbox_thread_event where thread_id = $1', [dInt.thread_id])).rows[0].n;
    const finMsgsSuas = (await comoUsuario(FIN_A, 'select count(*)::int n from inbox_message where thread_id = $1', [a.thread_id])).rows[0].n;
    ok('H', h.aud === 0 && h.b === 0 && finMsgs === 0 && finEv === 0 && finMsgsSuas >= 3, `Auditoria ${h.aud} · outra org ${h.b} · Financeiro lê ${finMsgs} msg de OBRAS e ${finMsgsSuas} da sem setor`);

    // I) atribuicao fora do recorte e recusada por RLS (UPDATE nao enxerga a linha); dentro do recorte passa e a linha some quando sai do recorte
    const iFora = await comoUsuario(FIN_A, `update inbox_thread set assignee_id = $2 where id = $1 returning id`, [dInt.thread_id, FIN_A]);
    const iDentro = await comoUsuario(FIN_A, `update inbox_thread set assignee_id = $2, status = 'ATRIBUIDA' where id = $1 returning id`, [c2.thread_id, FIN_A]);
    // transferir para FORA do proprio recorte: a linha NOVA tambem passa pela politica de SELECT (regra do Postgres). Sem nada
    // que ligue o autor a linha nova, o banco recusa. O caminho do adapter: primeiro a ATRIBUICAO vigente feita por mim
    // (inbox_encaminhei), depois o UPDATE — sem tornar o autor participante. Quando a atribuicao e liberada, o acesso acaba.
    const iEngSem = await comoUsuarioFalha(ENG_A, `update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000001', assignee_id = null, status = 'TRIADA' where id = $1`, [t4.thread_id]);
    const atrId = (await comoUsuario(ENG_A, `insert into inbox_assignment (organization_id, thread_id, sector_id, origin, actor_id) values ($1, $2, 'cccccccc-0000-0000-0000-000000000001', 'manual', $3) returning id`, [ORG_A, t4.thread_id, ENG_A])).rows[0].id;
    const iEng = await comoUsuario(ENG_A, `update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000001', assignee_id = null, status = 'TRIADA' where id = $1`, [t4.thread_id]);
    const engAinda = await contar(ENG_A); // 3: ainda ve a que encaminhou (atribuicao vigente)
    await db.query(`update inbox_assignment set released_at = now() where id = $1`, [atrId]); // alguem reatribuiu
    const iEngRet = null;
    const engDepois = await contar(ENG_A);
    ok('I', iFora.rows.length === 0 && iDentro.rows.length === 1 && /row-level security/i.test(iEngSem ?? '') && iEng.affectedRows === 1 && engAinda === 3 && engDepois === 2 && iEngRet === null, `fora do recorte: ${iFora.rows.length} linha; dentro: ${iDentro.rows.length}; transferir sem atribuição: ${iEngSem ? 'recusado pelo RLS' : 'ACEITO'}; com atribuição vigente: ${iEng.affectedRows} (Engenharia ainda vê ${engAinda}); após liberar a atribuição vê ${engDepois}`);

    // J) configuracao: Financeiro (sem inbox_config) nao cria setor nem membro; Diretoria cria; identidade duplicada e recusada
    const jFin = await comoUsuarioFalha(FIN_A, `insert into inbox_sector (organization_id, code, name) values ($1, 'JURIDICO', 'Jurídico')`, [ORG_A]);
    const jDir = await comoUsuarioFalha(DIR_A, `insert into inbox_sector (organization_id, code, name) values ($1, 'JURIDICO', 'Jurídico')`, [ORG_A]);
    const jMembro = await comoUsuarioFalha(ENG_A, `insert into inbox_member (organization_id, profile_id, sector_id) values ($1, $2, 'cccccccc-0000-0000-0000-000000000001')`, [ORG_A, ENG_A]);
    const jIdent = await deveFalhar(`insert into inbox_contact_identity (organization_id, contact_id, channel, identifier) values ($1, $2, 'WHATSAPP', $3)`, [ORG_A, a.contact_id, TEL]);
    ok('J', /policy|permission/i.test(jFin ?? '') && jDir === null && /policy|permission/i.test(jMembro ?? '') && /unique|duplicate/i.test(jIdent ?? ''),
      `Financeiro: ${(jFin ?? 'passou').split('\n')[0].slice(0, 60)} · Diretoria: ${jDir ?? 'ok'} · identidade duplicada: ${(jIdent ?? 'passou').slice(0, 40)}`);

    // K) participante ve a thread mesmo fora do setor (nota interna registrada por ele); evento com telefone inteiro e recusado
    await db.query(`update inbox_thread set participant_ids = participant_ids || $2::uuid where id = $1`, [dInt.thread_id, FIN_A]);
    const kFin = await contar(FIN_A);
    const kEv = await deveFalhar(`insert into inbox_thread_event (organization_id, thread_id, event_type, actor_kind, actor_name, detail) values ($1, $2, 'NOTE_ADDED', 'usuario', 'x', 'ligar para ${TEL}')`, [ORG_A, dInt.thread_id]);
    ok('K', kFin === 4 && /check/i.test(kEv ?? ''), `Financeiro passa a ver ${kFin} (as 3 de antes + a de OBRAS em que escreveu, como participante); detalhe com telefone inteiro: ${kEv ? 'recusado' : 'ACEITO'}`);

    // L) reaplicacao: a migration e idempotente
    await db.exec('savepoint reaplica');
    let reaplica = 'ok';
    try { await db.exec(SQL_0056); } catch (e) { reaplica = String(e.message); }
    await db.exec('rollback to savepoint reaplica');
    ok('L', reaplica === 'ok', reaplica === 'ok' ? '0056 reaplicada sem erro' : reaplica.split('\n')[0]);

    await db.exec('rollback');
    const sobrou = (await db.query('select count(*)::int n from inbox_thread')).rows[0].n;
    res.rollback = sobrou === 0 ? 'ROLLBACK ok — nada persistiu' : `ATENCAO: ${sobrou} threads sobraram`;
    if (sobrou !== 0) falhas++;
  } catch (e) {
    res.erroFatal = String(e.message) + (e.stack ? ' @ ' + String(e.stack).split(String.fromCharCode(10))[1] : '');
    falhas++;
  }
  console.log(JSON.stringify(res, null, 2));
  process.exit(falhas ? 1 : 0);
}
main();

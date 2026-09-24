// Smoke test das migrations 0056 (EIFF Inbox) e 0057 (Octopus Router) contra um PostgreSQL DE VERDADE (PGlite, em memoria, ROLLBACK ao final).
//
// Por que existe: a suite vitest prova o que o CORE decide (src/core/inbox) e o que o adapter MANDA (src/data); nao prova
// o que o BANCO aceita. Aqui se prova a outra metade: idempotencia da ingestao, resolucao de thread, append-only,
// imutabilidade da mensagem, o RLS por setor e — gate final do PR #13 — a autoridade de transferencia no banco (RPC
// inbox_assign_thread, privilegios de coluna e triggers): 18 provas A–R. Fase 3 (0057): provas S–X — RPC inbox_apply_routing
// server-only (aplica dentro do contexto permitido, deriva status, eventos), destinos invalidos recusados, navegador nao
// chama a RPC, override humano so por quem tem autoridade e nunca sobrescrito pelo roteamento, sugestao (TRIAGEM) nao move,
// prioridade so sobe, e reaplicacao idempotente da 0057.
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
const SQL_0057 = fs.readFileSync(new URL('0057_inbox_octopus_router.sql', RAIZ), 'utf8');

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
  // reset role E do GUC de usuario: o que roda fora de comoUsuario e o 'servidor' (auth.uid() nulo), como o service_role
  await db.exec("reset role; set local test.uid = '';").catch(() => {});
  if (erro) throw erro;
  return r;
}
async function comoUsuarioFalha(uid, sql, params = []) {
  const nome = 's' + (++sp);
  await db.exec('savepoint ' + nome);
  try { await comoUsuario(uid, sql, params); await db.exec('release savepoint ' + nome); return null; }
  catch (e) { await db.exec('rollback to savepoint ' + nome); await db.exec("reset role; set local test.uid = '';").catch(() => {}); return String(e.message); }
}
const ingest = (extra = {}) => db.query(
  `select inbox_ingest($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz) j`,
  [ORG_A, extra.provider ?? 'META_CLOUD', extra.channel ?? 'WHATSAPP', extra.context ?? 'EXTERNAL', extra.identifier ?? TEL, extra.nome ?? 'Paulo Aços',
    extra.externalId ?? 'wamid.1', extra.conv ?? TEL, extra.body ?? 'Bom dia, a NF 583 já está liberada?', extra.tipo ?? 'texto', extra.em ?? '2026-09-23T12:00:00Z']);

async function main() {
  try {
    await db.exec(PRELUDIO);
    await db.exec(SQL_0056);
    await db.exec(SQL_0057);
    res.migration = 'APLICADAS sem erro (0056 + 0057)';
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

    // ------------------------------------------------------------------- RLS por setor + operacoes governadas
    // threads: T1 (a.thread_id) sem setor (triagem); T2 (c2) FINANCEIRO atribuida a FIN; T3 (dInt) OBRAS atribuida a DIR; T4 OBRAS sem responsavel
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000001', assignee_id = $2, status = 'ATRIBUIDA' where id = $1`, [c2.thread_id, FIN_A]);
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000002', assignee_id = $2, status = 'ATRIBUIDA' where id = $1`, [dInt.thread_id, DIR_A]);
    const t4 = j(await ingest({ externalId: 'wamid.6', identifier: '5562933334444', nome: 'Quarto', body: 'obra' }));
    await db.query(`update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000002', status = 'TRIADA' where id = $1`, [t4.thread_id]);
    const contar = async (uid) => (await comoUsuario(uid, 'select count(*)::int n from inbox_thread')).rows[0].n;
    const vistos = async (uid) => (await comoUsuario(uid, 'select id from inbox_thread order by opened_at')).rows.map((r) => r.id);
    const rpc = async (uid, args) => j(await comoUsuario(uid, `select inbox_assign_thread($1, $2, $3, $4, $5, $6) j`, args));
    const thread = async (id) => (await db.query('select status, sector_id, team_id, assignee_id from inbox_thread where id = $1', [id])).rows[0];
    const atribs = async (id) => (await db.query('select id, actor_id, assignee_id, sector_id, released_at from inbox_assignment where thread_id = $1 order by assigned_at, created_at', [id])).rows;
    const eventos = async (id, desde) => (await db.query('select event_type from inbox_thread_event where thread_id = $1 and created_at >= $2 order by created_at', [id, desde])).rows.map((r) => r.event_type);

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

    // I) atendente permitido ASSUME thread sem responsavel do seu setor pela RPC: assignment criado, thread ATRIBUIDA, evento
    const marcaI = (await db.query('select now() t')).rows[0].t;
    const rI = await rpc(ENG_A, [t4.thread_id, 'OBRAS', null, ENG_A, 'assumindo', 'manual']);
    const tI = await thread(t4.thread_id); const aI = await atribs(t4.thread_id); const eI = await eventos(t4.thread_id, marcaI);
    ok('I', rI.ok === true && tI.status === 'ATRIBUIDA' && tI.assignee_id === ENG_A && aI.length === 1 && aI[0].actor_id === ENG_A && aI[0].released_at === null && eI.includes('ASSIGNED') && eI.includes('STATUS_CHANGED'),
      `rpc=${JSON.stringify(rI).slice(0, 60)} · status ${tI.status} · atribuições ${aI.length} · eventos ${eI.join(',')}`);

    // J) atendente SEM autoridade nao transfere: ENG (atendente de OBRAS) nao move a thread atribuida a DIR para FINANCEIRO; nem ve/move a do FINANCEIRO
    const rJ1 = await rpc(ENG_A, [dInt.thread_id, 'FINANCEIRO', null, null, 'tentativa', 'manual']);
    const rJ2 = await rpc(ENG_A, [c2.thread_id, 'OBRAS', null, ENG_A, 'tentativa', 'manual']);
    const tJ = await thread(dInt.thread_id);
    ok('J', rJ1.erro === 'sem_autoridade' && rJ2.erro === 'sem_acesso' && tJ.sector_id === 'cccccccc-0000-0000-0000-000000000002' && tJ.assignee_id === DIR_A, `${rJ1.erro} · ${rJ2.erro} · thread intacta`);

    // K) gestor autorizado transfere para outro setor: atribuição anterior encerrada, nova criada, thread atualizada, eventos; quem encaminhou segue vendo enquanto vigente
    const marcaK = (await db.query('select now() t')).rows[0].t;
    const rK = await rpc(FIN_A, [c2.thread_id, 'OBRAS', null, null, 'é assunto da obra', 'manual']);
    const tK = await thread(c2.thread_id); const aK = await atribs(c2.thread_id); const eK = await eventos(c2.thread_id, marcaK);
    const finAinda = (await vistos(FIN_A)).includes(c2.thread_id);
    ok('K', rK.ok === true && tK.sector_id === 'cccccccc-0000-0000-0000-000000000002' && tK.assignee_id === null && tK.status === 'TRIADA' && aK.length === 1 && aK[0].released_at === null && aK[0].actor_id === FIN_A && eK.includes('REASSIGNED') && eK.includes('RELEASED') && eK.includes('STATUS_CHANGED') && finAinda,
      `status ${tK.status} · atribuições ${aK.length} (vigente do gestor) · eventos ${eK.join(',')} · gestor ainda vê: ${finAinda}`);
    // ...e quando outro reatribui, o acesso de quem encaminhou acaba (historico fica na atribuição encerrada)
    await rpc(DIR_A, [c2.thread_id, 'OBRAS', null, ENG_A, null, 'manual']);
    const finDepois = (await vistos(FIN_A)).includes(c2.thread_id);
    const aK2 = await atribs(c2.thread_id);
    if (finDepois || aK2.length !== 2 || aK2[0].released_at === null) res.smoke.K += ` | ATENCAO: após reatribuição gestor vê=${finDepois}, atribuições=${aK2.length}`;

    // L) outra organizacao e usuario sem `inbox` nao operam; Diretoria opera transversalmente (thread de OBRAS -> FINANCEIRO com responsavel)
    const rL1 = await rpc(ADM_B, [dInt.thread_id, 'OBRAS', null, ADM_B, null, 'manual']);
    const rL2 = await rpc(AUD_A, [t4.thread_id, 'OBRAS', null, AUD_A, null, 'manual']);
    const rL3 = await rpc(DIR_A, [dInt.thread_id, 'FINANCEIRO', null, FIN_A, 'transversal', 'manual']);
    const tL = await thread(dInt.thread_id);
    ok('L', rL1.erro === 'thread_nao_encontrada' && rL2.erro === 'sem_permissao_inbox' && rL3.ok === true && tL.sector_id === 'cccccccc-0000-0000-0000-000000000001' && tL.assignee_id === FIN_A,
      `outra org: ${rL1.erro} · sem inbox: ${rL2.erro} · Diretoria: ok=${rL3.ok}`);

    // M) destino invalido (equipe de outro setor, responsavel de outra org) e recusado antes de escrever
    const eq = (await db.query(`insert into inbox_team (organization_id, sector_id, name) values ($1, 'cccccccc-0000-0000-0000-000000000001', 'Contas a pagar') returning id`, [ORG_A])).rows[0].id;
    const rM1 = await rpc(DIR_A, [t4.thread_id, 'OBRAS', eq, ENG_A, null, 'manual']);
    const rM2 = await rpc(DIR_A, [t4.thread_id, 'OBRAS', null, ADM_B, null, 'manual']);
    const rM3 = await rpc(DIR_A, [t4.thread_id, 'NAO_EXISTE', null, null, null, 'manual']);
    ok('M', rM1.erro === 'equipe_invalida' && rM2.erro === 'responsavel_invalido' && rM3.erro === 'setor_invalido', `${rM1.erro} · ${rM2.erro} · ${rM3.erro}`);

    // N) falha intermediaria faz rollback integral: um trigger de teste derruba a insercao do evento; nada da RPC persiste
    await db.exec(`create or replace function _falha_evento() returns trigger language plpgsql as $f$ begin if new.detail like '%__falha__%' then raise exception 'falha simulada'; end if; return new; end $f$;
      create trigger _falha before insert on inbox_thread_event for each row execute function _falha_evento();`);
    const antesN = { t: await thread(t4.thread_id), a: await atribs(t4.thread_id) };
    const rN = await comoUsuarioFalha(DIR_A, `select inbox_assign_thread($1, 'FINANCEIRO', null, null, '__falha__', 'manual')`, [t4.thread_id]);
    const depoisN = { t: await thread(t4.thread_id), a: await atribs(t4.thread_id) };
    await db.exec('drop trigger _falha on inbox_thread_event; drop function _falha_evento();');
    ok('N', /falha simulada/.test(rN ?? '') && JSON.stringify(antesN) === JSON.stringify(depoisN), `erro: ${(rN ?? 'PASSOU').split('\n')[0]} · thread e atribuições idênticas antes/depois: ${JSON.stringify(antesN) === JSON.stringify(depoisN)}`);

    // O) UPDATE direto nao contorna: setor/responsavel sao colunas sem UPDATE; inbox_assignment sem INSERT; status por quem nao tem autoridade e recusado pelo trigger
    const o1 = await comoUsuarioFalha(FIN_A, `update inbox_thread set assignee_id = $2 where id = $1`, [dInt.thread_id, ENG_A]);
    const o2 = await comoUsuarioFalha(FIN_A, `update inbox_thread set sector_id = 'cccccccc-0000-0000-0000-000000000002' where id = $1`, [dInt.thread_id]);
    const o3 = await comoUsuarioFalha(FIN_A, `insert into inbox_assignment (organization_id, thread_id, sector_id, origin, actor_id) values ($1, $2, 'cccccccc-0000-0000-0000-000000000001', 'manual', $3)`, [ORG_A, dInt.thread_id, FIN_A]);
    // t4 esta atribuida a ENG em OBRAS; DIR e transversal; um atendente de OBRAS que nao e o responsavel: cria-se um e testa-se
    const OUTRO_ENG = 'aaaaaaaa-0000-0000-0000-000000000005';
    await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Outro Engenheiro', 'o@eiff', 'Engenharia')`, [OUTRO_ENG, ORG_A]);
    await db.query(`insert into inbox_member (organization_id, profile_id, sector_id, member_role) values ($1, $2, 'cccccccc-0000-0000-0000-000000000002', 'atendente')`, [ORG_A, OUTRO_ENG]);
    const o4 = await comoUsuarioFalha(OUTRO_ENG, `update inbox_thread set status = 'FECHADA', resolved_at = now(), closed_at = now(), resolved_by = 'humano' where id = $1`, [t4.thread_id]);
    const o5 = await comoUsuarioFalha(OUTRO_ENG, `update inbox_thread set participant_ids = participant_ids || $2::uuid where id = $1`, [t4.thread_id, DIR_A]);
    const o6 = await comoUsuarioFalha(OUTRO_ENG, `update inbox_thread set participant_ids = participant_ids || $2::uuid where id = $1`, [t4.thread_id, OUTRO_ENG]);
    const o7 = await comoUsuarioFalha(ENG_A, `update inbox_thread set status = 'AGUARDANDO_CONTATO' where id = $1`, [t4.thread_id]); // responsavel: pode
    ok('O', /permission denied/i.test(o1 ?? '') && /permission denied/i.test(o2 ?? '') && /permission denied|policy/i.test(o3 ?? '') && /sem autoridade/i.test(o4 ?? '') && /participante/i.test(o5 ?? '') && o6 === null && o7 === null,
      `assignee: ${o1 ? 'negado' : 'ACEITO'} · setor: ${o2 ? 'negado' : 'ACEITO'} · assignment: ${o3 ? 'negado' : 'ACEITO'} · status por não responsável: ${o4 ? 'negado' : 'ACEITO'} · participante alheio: ${o5 ? 'negado' : 'ACEITO'} · participante próprio: ${o6 ? 'NEGADO' : 'ok'} · status pelo responsável: ${o7 ? 'NEGADO' : 'ok'}`);

    // P) decisao de acao: papel decisor da matriz; quem propos nao decide; Administrador e a excecao. Todos os usuarios abaixo
    //    ENXERGAM t4 (OBRAS): ENG/OUTRO_ENG membros, DIR transversal — assim o UPDATE alcanca a linha e e o TRIGGER que decide.
    const act = (await db.query(`insert into inbox_action (organization_id, thread_id, action_kind, title, state, approval_required, approver_role, proposed_by_kind, proposed_by_id, proposed_by_name) values ($1, $2, 'criar_tarefa', 'Reservar guindaste', 'aguardando_aprovacao', true, 'Diretoria', 'usuario', $3, 'Engenheiro') returning id`, [ORG_A, t4.thread_id, ENG_A])).rows[0].id;
    const actEng = (await db.query(`insert into inbox_action (organization_id, thread_id, action_kind, title, state, approval_required, approver_role, proposed_by_kind, proposed_by_id, proposed_by_name) values ($1, $2, 'criar_tarefa', 'Outra', 'aguardando_aprovacao', true, 'Engenharia', 'usuario', $3, 'Engenheiro') returning id`, [ORG_A, t4.thread_id, ENG_A])).rows[0].id;
    const p1 = await comoUsuarioFalha(OUTRO_ENG, `update inbox_action set decision = 'aprovada', decided_by = $2, decided_at = now(), state = 'aprovada' where id = $1`, [act, OUTRO_ENG]); // papel Engenharia != Diretoria
    const p2 = await comoUsuarioFalha(ENG_A, `update inbox_action set decision = 'aprovada', decided_by = $2, decided_at = now(), state = 'aprovada' where id = $1`, [actEng, ENG_A]); // proponente com o papel certo
    const p3 = await comoUsuarioFalha(DIR_A, `update inbox_action set decision = 'aprovada', decided_by = $2, decided_at = now(), state = 'aprovada' where id = $1`, [act, FIN_A]); // decided_by de outro
    const p4 = await comoUsuarioFalha(DIR_A, `update inbox_action set decision = 'aprovada', decided_by = $2, decided_at = now(), state = 'aprovada' where id = $1`, [act, DIR_A]);
    const p5 = await comoUsuarioFalha(OUTRO_ENG, `update inbox_action set decision = 'aprovada', decided_by = $2, decided_at = now(), state = 'aprovada' where id = $1`, [actEng, OUTRO_ENG]); // papel certo, nao proponente
    ok('P', /decidida por/i.test(p1 ?? '') && /quem propôs/i.test(p2 ?? '') && /decided_by/i.test(p3 ?? '') && p4 === null && p5 === null, `papel errado: ${p1 ? 'negado' : 'ACEITO'} · proponente: ${p2 ? 'negado' : 'ACEITO'} · decided_by alheio: ${p3 ? 'negado' : 'ACEITO'} · Diretoria: ${p4 ? 'NEGADO' : 'ok'} · papel certo não proponente: ${p5 ? 'NEGADO' : 'ok'}`);

    // Q) participante ve a thread fora do setor (escreveu nela); evento com telefone inteiro e recusado
    await db.query(`update inbox_thread set participant_ids = participant_ids || $2::uuid where id = $1`, [t4.thread_id, FIN_A]);
    const qFin = (await vistos(FIN_A)).includes(t4.thread_id);
    const qEv = await deveFalhar(`insert into inbox_thread_event (organization_id, thread_id, event_type, actor_kind, actor_name, detail) values ($1, $2, 'NOTE_ADDED', 'usuario', 'x', 'ligar para ${TEL}')`, [ORG_A, t4.thread_id]);
    ok('Q', qFin && /check/i.test(qEv ?? ''), `Financeiro vê a thread de OBRAS em que escreveu: ${qFin}; detalhe com telefone inteiro: ${qEv ? 'recusado' : 'ACEITO'}`);

    // R) reaplicacao: a migration e idempotente
    await db.exec('savepoint reaplica');
    let reaplica = 'ok';
    try { await db.exec(SQL_0056); } catch (e) { reaplica = String(e.message); }
    await db.exec('rollback to savepoint reaplica');
    ok('R', reaplica === 'ok', reaplica === 'ok' ? '0056 reaplicada sem erro' : reaplica.split('\n')[0]);

    // ------------------------------------------------------------------ fase 3: Octopus Router (0057)
    const SETOR_FIN = 'cccccccc-0000-0000-0000-000000000001', SETOR_OBRAS = 'cccccccc-0000-0000-0000-000000000002';
    const EQ_OBRAS = (await db.query(`insert into inbox_team (organization_id, sector_id, name) values ($1, $2, 'Canteiro') returning id`, [ORG_A, SETOR_OBRAS])).rows[0].id;
    const routing = (extra = {}) => JSON.stringify({ versao: 'octopus-1', em: '2026-09-23T12:00:00Z', origem: 'DETERMINISTICO', intencao: 'consultar_pagamento', assunto: 'Pagamento', entidades: [], prioridade: 'Alta', urgente: false, nivel: 'B', setorCodigo: 'FINANCEIRO', aplicacao: 'ATRIBUIR_PESSOA', automacao: { modo: 'APPROVAL', motivo: 'regra AUT-03', acoesPermitidas: ['responder'], risco: 'MEDIO', confianca: 0.9 }, confianca: 0.9, banda: 'HIGH', sinais: [{ codigo: 'regra_explicita', peso: 0, descricao: 'regra ROT-02' }], motivoOperacional: 'regra ROT-02 → Financeiro (90%)', fallback: false, slaAte: '2026-09-24T12:00:00Z', escalacao: ['setor FINANCEIRO'], ...extra });
    const aplicar = (threadId, msgId, p = {}) => db.query(
      'select inbox_apply_routing($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12) j',
      [p.org ?? ORG_A, threadId, msgId, p.routing ?? routing(), p.classification ?? null, p.summary ?? null, 'sectorCode' in p ? p.sectorCode : 'FINANCEIRO', p.teamId ?? null, 'assigneeId' in p ? p.assigneeId : FIN_A, p.priority ?? 'Alta', p.level ?? 'B', p.apply ?? true]);

    // S) servidor aplica: thread NOVA do ingest -> FINANCEIRO / FIN_A, ATRIBUIDA, atribuicao origem roteamento sem ator, routing gravado, eventos
    const s0 = j(await ingest({ externalId: 'wamid.s1', identifier: '5562955556666', nome: 'Quinto', body: 'A NF 7 já foi paga?' }));
    const s1 = j(await aplicar(s0.thread_id, s0.message_id, { classification: JSON.stringify({ intencao: 'consultar_pagamento', assunto: 'Pagamento', entidades: [], prioridadeRecomendada: 'Alta', nivelRecomendado: 'B', confianca: 0.9, sinais: ['NF'], evidencias: [], provedor: 'LLM', versao: 'inbox-router-llm-1', em: '2026-09-23T12:00:00Z' }), summary: 'Fornecedor pergunta pela NF 7.' }));
    const thS = (await db.query('select status, sector_id, assignee_id, priority, service_level, routing, classification, summary from inbox_thread where id = $1', [s0.thread_id])).rows[0];
    const atS = (await db.query('select origin, actor_id, released_at from inbox_assignment where thread_id = $1 order by assigned_at', [s0.thread_id])).rows;
    const evS = (await db.query(`select event_type, actor_name from inbox_thread_event where thread_id = $1 and event_type in ('AI_ANALYZED', 'ROUTING_DECIDED', 'PRIORITY_CHANGED', 'ROUTED', 'ASSIGNED', 'STATUS_CHANGED') order by created_at`, [s0.thread_id])).rows;
    ok('S', s1.ok && s1.aplicado && thS.status === 'ATRIBUIDA' && thS.sector_id === SETOR_FIN && thS.assignee_id === FIN_A && thS.priority === 'Alta' && thS.service_level === 'B' && thS.routing?.banda === 'HIGH' && thS.classification?.provedor === 'LLM' && thS.summary?.startsWith('Fornecedor')
      && atS.length === 1 && atS[0].origin === 'roteamento' && atS[0].actor_id === null && atS[0].released_at === null
      && evS.map((e) => e.event_type).join(',') === 'AI_ANALYZED,ROUTING_DECIDED,PRIORITY_CHANGED,ROUTED,ASSIGNED,STATUS_CHANGED' && evS.every((e) => e.event_type === 'AI_ANALYZED' || e.actor_name === 'Octopus Router'),
      `status ${thS.status} · setor FIN · responsável FIN · prioridade ${thS.priority} · eventos ${evS.map((e) => e.event_type).join(',')}`);

    // T) destinos invalidos sao recusados ANTES de escrever: setor inexistente, equipe de outro setor, pessoa fora do setor, pessoa de outra org, thread de outra org, routing com PII
    const s2 = j(await ingest({ externalId: 'wamid.t1', identifier: '5562977778888', nome: 'Sexto', body: 'entrega' }));
    const antesT = (await db.query('select (select count(*) from inbox_thread_event) e, (select count(*) from inbox_assignment) a, (select routing from inbox_thread where id = $1) r', [s2.thread_id])).rows[0];
    const t1 = j(await aplicar(s2.thread_id, s2.message_id, { sectorCode: 'NAO_EXISTE', assigneeId: null }));
    const t2 = j(await aplicar(s2.thread_id, s2.message_id, { sectorCode: 'FINANCEIRO', teamId: EQ_OBRAS, assigneeId: null }));
    const t3 = j(await aplicar(s2.thread_id, s2.message_id, { sectorCode: 'FINANCEIRO', assigneeId: ENG_A }));
    const t4b = j(await aplicar(s2.thread_id, s2.message_id, { sectorCode: 'FINANCEIRO', assigneeId: ADM_B }));
    const t5 = j(await aplicar(s2.thread_id, s2.message_id, { org: ORG_B }));
    const t6 = j(await aplicar(s2.thread_id, s2.message_id, { routing: routing({ raw_payload: { telefone: TEL } }) }));
    const t7 = j(await aplicar(s2.thread_id, s2.message_id, { priority: 'Máxima' }));
    const depoisT = (await db.query('select (select count(*) from inbox_thread_event) e, (select count(*) from inbox_assignment) a, (select routing from inbox_thread where id = $1) r', [s2.thread_id])).rows[0];
    ok('T', t1.erro === 'setor_invalido' && t2.erro === 'equipe_invalida' && t3.erro === 'responsavel_fora_do_contexto' && t4b.erro === 'responsavel_fora_do_contexto' && t5.erro === 'thread_nao_encontrada' && t6.erro === 'routing_invalido' && t7.erro === 'prioridade_invalida' && JSON.stringify(antesT) === JSON.stringify(depoisT),
      `setor: ${t1.erro} · equipe: ${t2.erro} · pessoa fora do setor: ${t3.erro} · pessoa de outra org: ${t4b.erro} · outra org: ${t5.erro} · PII: ${t6.erro} · prioridade: ${t7.erro} · nada gravado: ${JSON.stringify(antesT) === JSON.stringify(depoisT)}`);

    // U) o navegador (authenticated, mesmo Diretoria) nao chama a RPC; e o UPDATE direto de routing SEM override por quem enxerga continua permitido (e dado, como classification)
    const u1 = await comoUsuarioFalha(DIR_A, 'select inbox_apply_routing($1, $2, $3, $4::jsonb)', [ORG_A, s2.thread_id, s2.message_id, routing()]);
    const u2 = await comoUsuarioFalha(DIR_A, 'update inbox_thread set routing = $2::jsonb where id = $1', [s2.thread_id, routing({ aplicacao: 'TRIAGEM' })]);
    ok('U', /permission denied/i.test(u1 ?? '') && u2 === null, `RPC pelo navegador: ${u1 ? 'negada' : 'ACEITA'} · routing (dado) por Diretoria: ${u2 ? 'NEGADO' : 'ok'}`);

    // V) override humano: so por quem tem autoridade de atribuir e sempre em nome proprio; depois disso o servidor NAO move a conversa
    // OUTRO_FIN: atendente de FINANCEIRO — ENXERGA a thread s0 (setor dele) mas nao e responsavel nem gestor: sem autoridade para o override
    const OUTRO_FIN = 'aaaaaaaa-0000-0000-0000-000000000006';
    await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Outro Financeiro', 'of@eiff', 'Financeiro')`, [OUTRO_FIN, ORG_A]);
    await db.query(`insert into inbox_member (organization_id, profile_id, sector_id, member_role) values ($1, $2, $3, 'atendente')`, [ORG_A, OUTRO_FIN, SETOR_FIN]);
    const v1 = await comoUsuarioFalha(OUTRO_FIN, 'update inbox_thread set routing = $2::jsonb where id = $1', [s0.thread_id, routing({ override: { por: OUTRO_FIN, em: '2026-09-23T13:00:00Z', de: { setorCodigo: 'FINANCEIRO' }, para: { setorCodigo: 'OBRAS' } } })]); // atendente do setor: enxerga, mas sem autoridade
    const v2 = await comoUsuarioFalha(FIN_A, 'update inbox_thread set routing = $2::jsonb where id = $1', [s0.thread_id, routing({ override: { por: DIR_A, em: '2026-09-23T13:00:00Z', de: { setorCodigo: 'FINANCEIRO' }, para: { setorCodigo: 'OBRAS' } } })]); // em nome de outro
    const v3 = await comoUsuarioFalha(FIN_A, 'update inbox_thread set routing = $2::jsonb where id = $1', [s0.thread_id, routing({ override: { por: FIN_A, em: '2026-09-23T13:00:00Z', de: { setorCodigo: 'FINANCEIRO' }, para: { setorCodigo: 'FINANCEIRO', responsavelId: FIN_A }, motivo: 'fico com ela' } })]); // responsavel: pode
    const v4 = j(await aplicar(s0.thread_id, s0.message_id, { routing: routing({ setorCodigo: 'OBRAS', aplicacao: 'ATRIBUIR_SETOR' }), sectorCode: 'OBRAS', assigneeId: null }));
    const thV = (await db.query('select sector_id, assignee_id, routing from inbox_thread where id = $1', [s0.thread_id])).rows[0];
    ok('V', /policy|autoridade|permission/i.test(v1 ?? '') && /auth\.uid/i.test(v2 ?? '') && v3 === null && v4.ok && !v4.aplicado && v4.motivo === 'override_humano' && thV.sector_id === SETOR_FIN && thV.assignee_id === FIN_A && thV.routing?.override?.por === FIN_A && thV.routing?.setorCodigo === 'OBRAS',
      `sem autoridade: ${v1 ? 'negado' : 'ACEITO'} · em nome de outro: ${v2 ? 'negado' : 'ACEITO'} · responsável: ${v3 ? 'NEGADO' : 'ok'} · servidor depois do override: aplicado=${v4.aplicado} motivo=${v4.motivo} · setor segue FIN e override preservado`);

    // W) TRIAGEM (apply=false) so registra a sugestao — thread continua NOVA e sem setor; prioridade nunca desce; ROUTING_DECIDED sem ROUTED
    const w1 = j(await aplicar(s2.thread_id, s2.message_id, { routing: routing({ aplicacao: 'TRIAGEM', banda: 'LOW', confianca: 0.4, prioridade: 'Normal' }), sectorCode: 'OBRAS', assigneeId: null, priority: 'Normal', apply: false }));
    await db.query(`update inbox_thread set priority = 'Urgente' where id = $1`, [s2.thread_id]);
    const w2 = j(await aplicar(s2.thread_id, s2.message_id, { routing: routing({ aplicacao: 'TRIAGEM' }), sectorCode: 'OBRAS', assigneeId: null, priority: 'Baixa', apply: false }));
    const thW = (await db.query('select status, sector_id, priority, routing from inbox_thread where id = $1', [s2.thread_id])).rows[0];
    const evW = (await db.query(`select event_type from inbox_thread_event where thread_id = $1 and event_type in ('ROUTING_DECIDED', 'ROUTED', 'ASSIGNED')`, [s2.thread_id])).rows.map((e) => e.event_type);
    ok('W', w1.ok && !w1.aplicado && w1.motivo === 'sugestao_registrada' && w2.ok && thW.status === 'NOVA' && thW.sector_id === null && thW.priority === 'Urgente' && thW.routing?.aplicacao === 'TRIAGEM' && evW.includes('ROUTING_DECIDED') && !evW.includes('ROUTED'),
      `status ${thW.status} · sem setor · prioridade ${thW.priority} (não desceu para Baixa) · eventos ${evW.join(',')}`);

    // X) reaplicacao da 0057: idempotente
    await db.exec('savepoint reaplica57');
    let reaplica57 = 'ok';
    try { await db.exec(SQL_0057); } catch (e) { reaplica57 = String(e.message); }
    await db.exec('rollback to savepoint reaplica57');
    ok('X', reaplica57 === 'ok', reaplica57 === 'ok' ? '0057 reaplicada sem erro' : reaplica57.split('\n')[0]);

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

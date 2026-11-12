// Smoke test da migration 0075 (livro de entregas do e-mail comercial) contra um PostgreSQL DE VERDADE
// (PGlite, em memoria, ROLLBACK ao final). Banco DESCARTAVEL: nada aqui toca producao.
//
// A suite vitest prova o que o handler decide (src/core/inbox/emailServidor.ts) com um livro em memoria; aqui se prova
// a outra metade — o que o BANCO aceita e recusa: idempotencia por intencao, entrega pendente, tetos diarios, maquina de
// estados, comando imutavel, historico append-only, o vinculo com o SLA (so o aceite preenche a primeira resposta),
// a permissao conferida de novo no banco, e que o navegador so le.
//
// Como rodar:  npm run smoke:email      (imprime JSON; sai com 1 se qualquer prova falhar)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const RAIZ = new URL('../supabase/migrations/', import.meta.url);
const ler = (f) => fs.readFileSync(new URL(f, RAIZ), 'utf8');
const SQL_0056 = ler('0056_inbox.sql');
const SQL_0057 = ler('0057_inbox_octopus_router.sql');
const SQL_0075 = ler('0075_inbox_email_delivery.sql');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const ADM_A = 'aaaaaaaa-0000-0000-0000-000000000000'; // Administrador
const DIR_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // Diretoria: transversal
const FIN_A = 'aaaaaaaa-0000-0000-0000-000000000002'; // Financeiro: tem `inbox`, NAO tem `enviar_email`
const ENG_A = 'aaaaaaaa-0000-0000-0000-000000000003'; // Engenharia: membro de OBRAS
const INA_A = 'aaaaaaaa-0000-0000-0000-000000000005'; // Administrador INATIVO
const ADM_B = 'bbbbbbbb-0000-0000-0000-000000000001'; // outra organizacao
const SETOR_FIN = 'cccccccc-0000-0000-0000-000000000001';
const SETOR_OBRAS = 'cccccccc-0000-0000-0000-000000000002';
const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const uuid = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
insert into profile (id, organization_id, name, email, role, active) values
  ('${ADM_A}', '${ORG_A}', 'Augusto Macedo', 'adm@eiff', 'Administrador', true),
  ('${DIR_A}', '${ORG_A}', 'Diretora', 'd@eiff', 'Diretoria', true),
  ('${FIN_A}', '${ORG_A}', 'Financeiro', 'f@eiff', 'Financeiro', true),
  ('${ENG_A}', '${ORG_A}', 'Engenheiro', 'e@eiff', 'Engenharia', true),
  ('${INA_A}', '${ORG_A}', 'Ex-administrador', 'x@eiff', 'Administrador', false),
  ('${ADM_B}', '${ORG_B}', 'Estranho', 'x@outra', 'Administrador', true);
insert into inbox_sector (id, organization_id, code, name, sort_order) values
  ('${SETOR_FIN}', '${ORG_A}', 'FINANCEIRO', 'Financeiro', 1),
  ('${SETOR_OBRAS}', '${ORG_A}', 'OBRAS', 'Obras', 2);
insert into inbox_member (organization_id, profile_id, sector_id, member_role) values
  ('${ORG_A}', '${FIN_A}', '${SETOR_FIN}', 'gestor'),
  ('${ORG_A}', '${ENG_A}', '${SETOR_OBRAS}', 'atendente');
insert into inbox_config (organization_id) values ('${ORG_A}');
`;

const db = new PGlite();
const res = { migration: '', smoke: {}, rollback: '' };
let falhas = 0;
const ok = (k, cond, detalhe = '') => { res.smoke[k] = cond ? `PASS${detalhe ? ' — ' + detalhe : ''}` : `FALHOU${detalhe ? ' — ' + detalhe : ''}`; if (!cond) falhas++; };
const j = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];
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

let nLead = 0;
/** Uma conversa de lead do site (PORTAL, EXTERNAL), como a integracao do formulario cria. */
async function conversa(extra = {}) {
  nLead += 1;
  const r = j(await db.query(`select inbox_ingest($1, 'MANUAL', $2, $3, $4, 'Lead Ficticio', $5, null, 'Solicito contato sobre um galpão.', 'texto', now() - interval '10 minutes') j`,
    [ORG_A, extra.channel ?? 'PORTAL', extra.context ?? 'EXTERNAL', `lead${nLead}@exemplo.invalido`, `site.exemplo.${nLead}`]));
  const t = await um('select id, contact_id, status, sla_first_response_at, sla_first_response_due from inbox_thread where id = $1', [r.thread_id]);
  return t;
}
const criar = (t, p = {}) => db.query(`select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) j`,
  [p.org ?? ORG_A, t.id, p.contato ?? t.contact_id, p.por ?? ADM_A, p.nome ?? 'Augusto Macedo', p.chave ?? uuid(++sp + 1000), p.fp ?? FP, p.corpo ?? 'Assunto: Proposta\n\nOlá.\n\nAugusto Macedo\nEIFF', p.limU ?? 30, p.limO ?? 100]).then(j);
const transicionar = (id, para, p = {}) => db.query('select inbox_email_delivery_transition($1, $2, $3, $4, $5, $6) j', [id, para, p.ator === undefined ? ADM_A : p.ator, p.motivo ?? null, p.pm ?? null, p.pt ?? null]).then(j);
const aceitar = (id, p = {}) => db.query('select inbox_email_delivery_accept($1, $2, $3::timestamptz, $4, $5, $6) j', [id, p.ator ?? ADM_A, p.em ?? new Date().toISOString(), p.pm === undefined ? 'gm-1' : p.pm, p.pt ?? 'gt-1', p.reconciliada ?? false]).then(j);
const contagens = async () => JSON.stringify(await um('select (select count(*)::int from inbox_email_delivery) d, (select count(*)::int from inbox_email_delivery_event) e, (select count(*)::int from inbox_message) m, (select count(*)::int from inbox_thread_event) te'));

async function main() {
  try {
    await db.exec(PRELUDIO);
    await db.exec(SQL_0056);
    await db.exec(SQL_0057);
    await db.exec(SQL_0075);
    await db.exec(SQL_0075); // idempotente: reaplicar nao falha
    res.migration = 'APLICADAS sem erro (0056 + 0057 + 0075, a 0075 duas vezes)';
    await db.exec('begin');
    await db.exec(SEMENTE);

    // A) criar: entrega READY, rascunho na conversa, historico e NENHUM efeito no SLA
    const tA = await conversa();
    const a = await criar(tA, { chave: uuid(1) });
    const dA = await um('select * from inbox_email_delivery where id = $1', [a.entrega?.id]);
    const mA = await um('select provider, direction, delivery_state, sender_name, meta from inbox_message where id = $1', [dA?.message_id]);
    const tA2 = await um('select status, sla_first_response_at from inbox_thread where id = $1', [tA.id]);
    const evA = (await db.query('select from_status, to_status, actor_kind, actor_id from inbox_email_delivery_event where delivery_id = $1', [dA.id])).rows;
    ok('A', a.ok && a.nova && dA.status === 'READY' && dA.rfc_message_id === `<${dA.id}@eiff.com.br>` && mA.provider === 'GOOGLE_WORKSPACE' && mA.direction === 'outbound' && mA.delivery_state === 'registrada'
      && mA.meta.entregaId === dA.id && tA2.sla_first_response_at === null && tA2.status === tA.status && evA.length === 1 && evA[0].to_status === 'READY' && evA[0].actor_kind === 'USER' && evA[0].actor_id === ADM_A,
    `entrega ${dA.status} · mensagem ${mA.delivery_state} · conversa segue ${tA2.status} sem primeira resposta`);

    // B) idempotencia: a mesma intencao devolve a mesma entrega e nada novo nasce; outro conteudo e recusado
    const antesB = await contagens();
    const b1 = await criar(tA, { chave: uuid(1) });
    const b2 = await criar(tA, { chave: uuid(1), fp: FP2 });
    ok('B', b1.ok && b1.nova === false && b1.entrega.id === dA.id && (await contagens()) === antesB && b2.ok === false && b2.erro === 'intencao_reutilizada', 'mesma intenção = mesma entrega; outro conteúdo = intencao_reutilizada');

    // C) entrega sem desfecho bloqueia outra na MESMA conversa (e so nela)
    const c1 = await criar(tA, { chave: uuid(2) });
    const tC = await conversa();
    const c2 = await criar(tC, { chave: uuid(3) });
    ok('C', c1.ok === false && c1.erro === 'entrega_pendente' && c2.ok && c2.nova, 'pendente bloqueia a conversa, não as outras');

    // D) REQUESTED nao toca o SLA; o ACEITE grava entrega + mensagem + SLA + status numa transacao
    const d1 = await transicionar(dA.id, 'REQUESTED');
    const tD0 = await um('select sla_first_response_at from inbox_thread where id = $1', [tA.id]);
    const em = new Date().toISOString();
    const d2 = await aceitar(dA.id, { em });
    const dD = await um('select status, accepted_at, finished_at, sla_fulfilled, provider_message_id, provider_thread_id from inbox_email_delivery where id = $1', [dA.id]);
    const mD = await um('select delivery_state, meta, body from inbox_message where id = $1', [dA.message_id]);
    const tD = await um('select status, sla_first_response_at, participant_ids from inbox_thread where id = $1', [tA.id]);
    const evD = (await db.query('select to_status from inbox_email_delivery_event where delivery_id = $1 order by occurred_at, id', [dA.id])).rows.map((x) => x.to_status).sort().join(',');
    ok('D', d1.ok && tD0.sla_first_response_at === null && d2.ok && d2.cumpriu_primeira_resposta === true && dD.status === 'ACCEPTED' && dD.sla_fulfilled === true && dD.provider_message_id === 'gm-1' && !!dD.finished_at
      && mD.delivery_state === 'enviada' && mD.meta.entregaEstado === 'ACCEPTED' && tD.status === 'EM_ATENDIMENTO' && new Date(tD.sla_first_response_at).toISOString() === em && tD.participant_ids.includes(ADM_A) && evD === 'ACCEPTED,READY,REQUESTED',
    `aceite: mensagem ${mD.delivery_state} · conversa ${tD.status} · primeira resposta gravada no instante do aceite`);

    // E) segundo e-mail na conversa: continua o fio e NAO sobrescreve a primeira resposta
    const e1 = await criar(tA, { chave: uuid(4) });
    await transicionar(e1.entrega.id, 'REQUESTED');
    const e2 = await aceitar(e1.entrega.id, { em: new Date(Date.now() + 1000).toISOString(), pm: 'gm-2' });
    const tE = await um('select sla_first_response_at from inbox_thread where id = $1', [tA.id]);
    ok('E', e1.ok && e1.fio?.rfc_message_id === dA.rfc_message_id && e1.fio?.provider_thread_id === 'gt-1' && e2.ok && e2.cumpriu_primeira_resposta === false && new Date(tE.sla_first_response_at).toISOString() === em,
      'fio do primeiro e-mail devolvido; primeira resposta preservada');

    // F) FAILED: mensagem `falhou`, SLA intacto, e a conversa fica livre para nova intencao
    const dC = c2.entrega.id;
    await transicionar(dC, 'REQUESTED');
    const f1 = await transicionar(dC, 'FAILED', { motivo: 'mensagem_recusada', ator: null });
    const mF = await um('select m.delivery_state from inbox_message m join inbox_email_delivery d on d.message_id = m.id where d.id = $1', [dC]);
    const tF = await um('select sla_first_response_at, status from inbox_thread where id = $1', [tC.id]);
    const evF = await um("select actor_kind, actor_id, reason from inbox_email_delivery_event where delivery_id = $1 and to_status = 'FAILED'", [dC]);
    const f2 = await criar(tC, { chave: uuid(5) });
    ok('F', f1.ok && mF.delivery_state === 'falhou' && tF.sla_first_response_at === null && tF.status === tC.status && evF.actor_kind === 'SERVER' && evF.actor_id === null && evF.reason === 'mensagem_recusada' && f2.ok && f2.nova,
      'falha não cumpre o SLA, o evento registra SERVER, e novo envio é possível');

    // G) UNKNOWN: nao cumpre o SLA; so sai por reconciliacao — «encontrado» aceita com o instante do pedido original
    const dG = f2.entrega.id;
    await transicionar(dG, 'REQUESTED');
    const g1 = await transicionar(dG, 'UNKNOWN', { motivo: 'resultado_desconhecido' });
    const tG0 = await um('select sla_first_response_at from inbox_thread where id = $1', [tC.id]);
    const g2 = await transicionar(dG, 'REQUESTED');
    const pedidoEm = (await um('select requested_at from inbox_email_delivery where id = $1', [dG])).requested_at;
    const g3 = await aceitar(dG, { pm: null, reconciliada: true, em: new Date(pedidoEm).toISOString() });
    const dG2 = await um('select status, reconciled, reason, sla_fulfilled from inbox_email_delivery where id = $1', [dG]);
    const tG = await um('select sla_first_response_at from inbox_thread where id = $1', [tC.id]);
    ok('G', g1.ok && tG0.sla_first_response_at === null && g2.ok === false && g2.erro === 'transicao_invalida' && g3.ok && dG2.status === 'ACCEPTED' && dG2.reconciled === true && dG2.reason === 'declarado_encontrado' && dG2.sla_fulfilled === true
      && new Date(tG.sla_first_response_at).getTime() === new Date(pedidoEm).getTime(), 'UNKNOWN não volta a REQUESTED; reconciliado vale o instante do pedido');

    // H) maquina de estados: terminais nao regridem, READY nao e aceita, aceite sem id do Google e recusado
    const tH = await conversa();
    const h0 = await criar(tH, { chave: uuid(6) });
    const h1 = await aceitar(h0.entrega.id);                                   // READY -> ACCEPTED
    await transicionar(h0.entrega.id, 'REQUESTED');
    const h2 = await aceitar(h0.entrega.id, { pm: null });                     // sem confirmacao do provedor
    const h3 = await transicionar(dA.id, 'FAILED', { motivo: 'mensagem_recusada' }); // ACCEPTED -> FAILED
    const h4 = await deveFalhar("update inbox_email_delivery set status = 'READY', accepted_at = null, finished_at = null where id = $1", [dA.id]);
    const h5 = await deveFalhar("update inbox_email_delivery set status = 'ACCEPTED', accepted_at = now(), finished_at = now() where id = $1", [(await criar(await conversa(), { chave: uuid(7) })).entrega.id]);
    const h6 = await transicionar(h0.entrega.id, 'ACCEPTED');
    const h7 = await aceitar(h0.entrega.id, { em: new Date(Date.now() + 3_600_000).toISOString() }); // instante no futuro
    ok('H', h1.ok === false && h1.erro === 'transicao_invalida' && h2.ok === false && h2.erro === 'sem_confirmacao_do_provedor' && h3.ok === false && !!h4 && !!h5 && h6.ok === false && h7.ok === false && h7.erro === 'instante_invalido',
      'READY não é aceita; sem id do Google não há aceite; terminal não regride nem por UPDATE direto');

    // I) comando imutavel, sem DELETE, historico append-only
    const i1 = await deveFalhar('update inbox_email_delivery set request_fingerprint = $2 where id = $1', [h0.entrega.id, FP2]);
    const i2 = await deveFalhar('update inbox_email_delivery set thread_id = $2 where id = $1', [h0.entrega.id, tA.id]);
    const i3 = await deveFalhar('update inbox_email_delivery set requested_by = $2 where id = $1', [h0.entrega.id, DIR_A]);
    const i4 = await deveFalhar('delete from inbox_email_delivery where id = $1', [h0.entrega.id]);
    const i5 = await deveFalhar("update inbox_email_delivery_event set reason = 'x' where delivery_id = $1", [dA.id]);
    const i6 = await deveFalhar('delete from inbox_email_delivery_event where delivery_id = $1', [dA.id]);
    const i7 = await deveFalhar("update inbox_message set body = 'outro texto' where id = $1", [dA.message_id]);
    ok('I', !!i1 && !!i2 && !!i3 && !!i4 && !!i5 && !!i6 && !!i7, 'comando, histórico e texto enviado não mudam; nada é apagado');

    // J) a permissao e conferida DE NOVO no banco: so Administrador e Diretoria ativos, da propria organizacao
    const tJ = await conversa();
    const j1 = await criar(tJ, { por: FIN_A });
    const j2 = await criar(tJ, { por: INA_A });
    const j3 = await criar(tJ, { por: ADM_B });
    const j4 = await criar(tJ, { por: DIR_A, nome: 'Diretora', chave: uuid(8) });
    ok('J', j1.erro === 'sem_permissao' && j2.erro === 'sem_permissao' && j3.erro === 'sem_permissao' && j4.ok && j4.nova, 'Financeiro, inativo e outra organização recusados; Diretoria envia');

    // K) conversa fechada, interna, de outro contato ou de outra organizacao: recusa sem criar nada
    const tK = await conversa();
    await db.query("update inbox_thread set status = 'FECHADA', resolved_at = now(), closed_at = now() where id = $1", [tK.id]);
    const k1 = await criar(tK);
    const tKi = await conversa({ channel: 'WHATSAPP', context: 'INTERNAL' });
    const k2 = await criar(tKi);
    const tKc = await conversa();
    const k3 = await criar(tKc, { contato: tA.contact_id });
    const k4 = await criar(tKc, { org: ORG_B, por: ADM_B });
    const k5 = await criar(tKc, { corpo: '   ' });
    ok('K', k1.erro === 'conversa_fechada' && k2.erro === 'conversa_interna' && k3.erro === 'pedido_invalido' && k4.erro === 'conversa_nao_encontrada' && k5.erro === 'pedido_invalido', 'fechada, interna, contato trocado, outra organização e corpo vazio recusados');

    // L) tetos diarios: contam REQUESTED, ACCEPTED e UNKNOWN de hoje; READY e FAILED nao contam
    const usados = (await um("select count(*)::int n from inbox_email_delivery where requested_by = $1 and status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN')", [ADM_A])).n;
    const total = (await um("select count(*)::int n from inbox_email_delivery where status in ('REQUESTED', 'ACCEPTED', 'UNKNOWN')")).n;
    const tL = await conversa();
    const l1 = await criar(tL, { limU: usados });
    const l2 = await criar(tL, { limO: total });
    const l3 = await criar(tL, { limU: 0 });
    const l4 = await criar(tL, { limU: usados + 1, limO: total + 1, chave: uuid(9) });
    ok('L', usados >= 3 && l1.erro === 'limite_usuario' && l2.erro === 'limite_organizacao' && l3.erro === 'pedido_invalido' && l4.ok, `usados hoje: ${usados} do usuário, ${total} da organização`);

    // M) o navegador so LE: sem INSERT/UPDATE no livro, sem as RPCs, sem forjar mensagem de e-mail nem marcar como enviada
    const m1 = await comoUsuarioFalha(ADM_A, "insert into inbox_email_delivery (organization_id, thread_id, contact_id, message_id, requested_by, idempotency_key, request_fingerprint, rfc_message_id) values ($1, $2, $3, $4, $5, $6, $7, '<x@eiff.com.br>')", [ORG_A, tA.id, tA.contact_id, dA.message_id, ADM_A, uuid(50), FP]);
    const m2 = await comoUsuarioFalha(ADM_A, "update inbox_email_delivery set status = 'ACCEPTED' where id = $1", [l4.entrega.id]);
    const m3 = await comoUsuarioFalha(ADM_A, 'select inbox_email_delivery_create($1, $2, $3, $4, $5, $6, $7, $8, 30, 100)', [ORG_A, tL.id, tL.contact_id, ADM_A, 'x', uuid(51), FP, 'corpo']);
    const m4 = await comoUsuarioFalha(ADM_A, "select inbox_email_delivery_accept($1, $2, now(), 'gm-x', null, false)", [l4.entrega.id, ADM_A]);
    const m5 = await comoUsuarioFalha(ADM_A, "select inbox_email_delivery_transition($1, 'REQUESTED', $2)", [l4.entrega.id, ADM_A]);
    const m6 = await comoUsuarioFalha(ADM_A, "insert into inbox_message (organization_id, thread_id, provider, direction, content_type, sender_kind, sender_id, sender_name, body, occurred_at, delivery_state) values ($1, $2, 'GOOGLE_WORKSPACE', 'outbound', 'texto', 'usuario', $3, 'x', 'forjada', now(), 'enviada')", [ORG_A, tL.id, ADM_A]);
    const msgL = (await um('select message_id from inbox_email_delivery where id = $1', [l4.entrega.id])).message_id;
    const m7 = await comoUsuarioFalha(ADM_A, "update inbox_message set delivery_state = 'enviada' where id = $1", [msgL]);
    const m8 = await comoUsuarioFalha(ADM_A, 'delete from inbox_email_delivery_event where delivery_id = $1', [dA.id]);
    const tM = await um('select sla_first_response_at from inbox_thread where id = $1', [tL.id]);
    const estadoM = (await um('select status from inbox_email_delivery where id = $1', [l4.entrega.id])).status;
    ok('M', !!m1 && !!m2 && !!m3 && !!m4 && !!m5 && !!m6 && !!m7 && !!m8 && tM.sla_first_response_at === null && estadoM === 'READY', 'authenticated não escreve no livro, não chama RPC e não transforma rascunho em «enviada»');

    // N) RLS: le a entrega quem enxerga a conversa — setor alheio e outra organizacao nao leem
    await db.query('update inbox_thread set sector_id = $2 where id = $1', [tA.id, SETOR_OBRAS]);
    const ver = async (uid) => (await comoUsuario(uid, 'select count(*)::int n from inbox_email_delivery where thread_id = $1', [tA.id])).rows[0].n;
    const verEv = async (uid) => (await comoUsuario(uid, 'select count(*)::int n from inbox_email_delivery_event e join inbox_email_delivery d on d.id = e.delivery_id where d.thread_id = $1', [tA.id])).rows[0].n;
    const n = { dir: await ver(DIR_A), eng: await ver(ENG_A), fin: await ver(FIN_A), fora: await ver(ADM_B), evDir: await verEv(DIR_A), evFin: await verEv(FIN_A) };
    ok('N', n.dir === 2 && n.eng === 2 && n.fin === 0 && n.fora === 0 && n.evDir >= 6 && n.evFin === 0, `Diretoria ${n.dir}, membro do setor ${n.eng}, outro setor ${n.fin}, outra organização ${n.fora}`);

    // O) o historico conta a historia inteira, com o ator real de cada passo, e o evento da conversa nao leva conteudo
    const hist = (await db.query('select from_status, to_status, actor_kind from inbox_email_delivery_event where delivery_id = $1 order by occurred_at, id', [dG])).rows.map((x) => `${x.from_status ?? '∅'}>${x.to_status}:${x.actor_kind}`).sort().join(' ');
    const detalhes = (await db.query("select detail from inbox_thread_event where thread_id = $1 and event_type = 'MESSAGE_REGISTERED'", [tC.id])).rows.map((x) => x.detail).join(' | ');
    ok('O', hist === 'READY>REQUESTED:USER REQUESTED>UNKNOWN:USER UNKNOWN>ACCEPTED:USER ∅>READY:USER' && !/Proposta|Olá|exemplo\.invalido/.test(detalhes) && /DESCONHECIDO/.test(detalhes) && /conferido por pessoa/.test(detalhes), 'quatro passos registrados; eventos da conversa sem texto nem endereço');

    await db.exec('rollback');
    const sobrou = (await db.query('select count(*)::int n from inbox_email_delivery')).rows[0].n;
    res.rollback = sobrou === 0 ? 'ROLLBACK ok — nada persistiu' : `ATENCAO: ${sobrou} entregas sobraram`;
    if (sobrou !== 0) falhas++;
  } catch (e) {
    res.erroFatal = String(e.message) + (e.stack ? ' @ ' + String(e.stack).split(String.fromCharCode(10))[1] : '');
    falhas++;
  }
  console.log(JSON.stringify(res, null, 2));
  process.exit(falhas ? 1 : 0);
}
main();

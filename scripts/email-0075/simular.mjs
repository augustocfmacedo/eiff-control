// PRE-FLIGHT da migration 0075 em banco DESCARTAVEL (PGlite em memoria). Nada aqui toca banco real nem rede.
// Monta o banco com a fila COMPLETA 0001..0074 (mesma ordem do pg-preflight-central --ordem-corrigida), compara a
// estrutura com o RETRATO lido da producao, carrega dados com a mesma forma dos reais, aplica a 0075 e confere.
// Uso: node scripts/email-0075/simular.mjs <retrato-prod.json> <saida.json>
//   retrato-prod.json = resultado de scripts/email-0075/retrato.sql rodado (somente leitura) no banco real.
// A aplicacao usa o MESMO envelope que o roteiro manda aplicar (scripts/email-0075/envelope.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { envelope } from './envelope.mjs';

const [RETRATO_PROD, SAIDA] = process.argv.slice(2);
const RETRATO_SQL = new URL('./retrato.sql', import.meta.url);
const ENV = envelope();
const MIG = path.resolve('supabase/migrations');
const fonte = fs.readFileSync('scripts/pg-preflight-central.mjs', 'utf8');
const pega = (n) => new RegExp(`const ${n} = \`([\\s\\S]*?)\`;`).exec(fonte)[1];
const PRELUDIOS = ['PRELUDIO_PAPEIS', 'PRELUDIO_AUTH', 'PRELUDIO_STORAGE'].map(pega);
const SQL_RETRATO = fs.readFileSync(RETRATO_SQL, 'utf8');
const SQL_0075 = fs.readFileSync(path.join(MIG, '0075_inbox_email_delivery.sql'), 'utf8');
const prod = JSON.parse(fs.readFileSync(RETRATO_PROD, 'utf8'));
const so = (e) => String(e?.message ?? e).split('\n')[0];
const res = { construcao: {}, estrutura_real_x_teste: {}, aplicacao: {}, provas: {}, recuperacao: {} };
const prova = (nome, ok, detalhe = '') => { res.provas[nome] = `${ok ? 'PASS' : 'FAIL'}${detalhe ? ' — ' + detalhe : ''}`; };

const ORG_SQL = `(select id from organization where code = 'EIFF')`;
const ADM = 'aaaaaaaa-0000-4000-8000-000000000001';
const FIN = 'aaaaaaaa-0000-4000-8000-000000000002';
const SOL = 'aaaaaaaa-0000-4000-8000-000000000003';

async function construir() {
  const db = new PGlite({ extensions: { pgcrypto } });
  for (const p of PRELUDIOS) await db.exec(p);
  const arquivos = fs.readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) < '0075').sort();
  const ordem = [];
  for (const a of arquivos) {
    if (a.startsWith('0014')) ordem.push('0015_version_cols.sql');
    if (!ordem.includes(a)) ordem.push(a);
    if (a.startsWith('0013')) ordem.push('SEED');
  }
  let n = 0;
  for (const a of ordem) {
    const sql = a === 'SEED' ? fs.readFileSync(path.join(MIG, '..', 'seed.sql'), 'utf8') : fs.readFileSync(path.join(MIG, a), 'utf8');
    await db.exec('begin;');
    try { await db.exec(sql); await db.exec('commit;'); n += 1; } catch (e) { await db.exec('rollback;'); throw new Error(`fila parou em ${a}: ${so(e)}`); }
  }
  return { db, n };
}
const um = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const retrato = async (db) => { const r = (await um(db, SQL_RETRATO)).retrato; return typeof r === 'string' ? JSON.parse(r) : r; };
const SECOES = ['colunas', 'constraints', 'triggers', 'indices', 'politicas', 'rls', 'funcoes', 'funcoes_de_trigger'];
function diferencas(a, b) {
  const out = {};
  for (const s of SECOES) {
    const x = a[s] ?? {}; const y = b[s] ?? {}; const d = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) d[k] = { a: x[k] ?? '(ausente)', b: y[k] ?? '(ausente)' };
    if (Object.keys(d).length) out[s] = d;
  }
  return out;
}

/** Dados com a MESMA FORMA dos reais: 2 contatos, 2 conversas, 5 mensagens (MANUAL 3, META_CLOUD 2; entregue 1, registrada 1, nulo 3). */
async function semear(db) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'adm@teste.invalido'), ('${FIN}', 'fin@teste.invalido'), ('${SOL}', 'sol@teste.invalido');
    insert into profile (id, organization_id, name, email, role) values
      ('${ADM}', ${ORG_SQL}, 'Administrador Teste', 'adm@teste.invalido', 'Administrador'),
      ('${FIN}', ${ORG_SQL}, 'Financeiro Teste', 'fin@teste.invalido', 'Financeiro'),
      ('${SOL}', ${ORG_SQL}, 'Solicitante Teste', 'sol@teste.invalido', 'Solicitante');`);
  const org = (await um(db, `select id from organization where code = 'EIFF'`)).id;
  const ing = async (prov, canal, ident, ext, corpo) => (await um(db, `select inbox_ingest($1, $2, $3, 'EXTERNAL', $4, 'Contato Fictício', $5, null, $6, 'texto', now() - interval '1 hour') j`, [org, prov, canal, ident, ext, corpo])).j;
  const a = await ing('MANUAL', 'PORTAL', 'lead@teste.invalido', 'site.ficticio.1', 'Solicitação fictícia pelo formulário.');
  const b = await ing('META_CLOUD', 'WHATSAPP', '5562900000000', 'wamid.ficticio.1', 'Mensagem fictícia 1.');
  await ing('META_CLOUD', 'WHATSAPP', '5562900000000', 'wamid.ficticio.2', 'Mensagem fictícia 2.');
  if (!a.ok || !b.ok) throw new Error('inbox_ingest recusou a semente: ' + JSON.stringify([a, b]));
  await db.query(`insert into inbox_message (organization_id, thread_id, provider, direction, content_type, sender_kind, sender_id, sender_name, body, occurred_at, delivery_state)
    values ($1, $2, 'MANUAL', 'outbound', 'texto', 'usuario', $3, 'Administrador Teste', 'Rascunho fictício.', now(), 'registrada'),
           ($1, $2, 'MANUAL', 'outbound', 'texto', 'usuario', $3, 'Administrador Teste', 'Contato fictício realizado.', now(), 'entregue')`, [org, a.thread_id, ADM]);
  return { org, threadSite: a.thread_id, threadWhats: b.thread_id, contatoSite: a.contact_id };
}
const impressoes = async (db) => um(db, `select
  (select md5(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id)) from inbox_message where provider <> 'GOOGLE_WORKSPACE') m,
  (select count(*)::int from inbox_message where provider <> 'GOOGLE_WORKSPACE') qm, (select count(*)::int from inbox_thread) qt, (select count(*)::int from inbox_contact) qc,
  (select count(*)::int from inbox_thread_event) qe`);
const espera = async (f) => { try { await f(); return null; } catch (e) { return so(e); } };

// ───────────────────────────────────────────────────────────────── banco 1: aplicacao e provas
const t0 = Date.now();
const { db, n } = await construir();
res.construcao = { postgres: (await um(db, 'select version() v')).v.split(' on ')[0], migrations_aplicadas: n, ate: '0074', ms: Date.now() - t0 };

const vazio = await retrato(db);
res.estrutura_real_x_teste = { secoes_comparadas: SECOES, itens_no_real: Object.fromEntries(SECOES.map((s) => [s, Object.keys(prod[s] ?? {}).length])), diferencas: diferencas(prod, vazio) };

const S = await semear(db);
const dadosAntes = (await retrato(db)).dados;
res.construcao.forma_dos_dados = { teste: { por_provider: dadosAntes.inbox_message_por_provider, por_entrega: dadosAntes.inbox_message_por_entrega }, real: { por_provider: prod.dados.inbox_message_por_provider, por_entrega: prod.dados.inbox_message_por_entrega } };
const antes = await retrato(db); const impAntes = await impressoes(db);

// (a) transacao desfeita nao deixa rastro
await db.exec('begin;'); await db.exec(SQL_0075); await db.exec('rollback;');
prova('A transacao desfeita (ROLLBACK) nao deixa rastro', JSON.stringify(diferencas(antes, await retrato(db))) === '{}' && (await um(db, `select to_regclass('public.inbox_email_delivery') r`)).r === null);

// (b) aplicacao EXATAMENTE como no roteiro: o envelope (pre-checks + 0075 + pos-checks numa transacao)
const t1 = Date.now();
await db.exec(ENV.sql);
res.aplicacao.ms = Date.now() - t1;
res.aplicacao.sha256_da_migration = ENV.shaMigration; res.aplicacao.sha256_do_envelope = ENV.shaEnvelope;
const depois = await retrato(db); const impDepois = await impressoes(db);
res.aplicacao.mudancas_em_objetos_existentes = diferencas(antes, depois);
prova('B dados preexistentes intactos apos a 0075', JSON.stringify(impAntes) === JSON.stringify(impDepois), JSON.stringify(impDepois));
prova('C constraint de provider aceita as linhas antigas e o provider novo',
  /GOOGLE_WORKSPACE/.test(depois.constraints['inbox_message.inbox_message_provider_check']) && (await um(db, `select convalidated v from pg_constraint where conname = 'inbox_message_provider_check'`)).v === true);

// (c) objetos criados
const criados = await um(db, `select
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename in ('inbox_email_delivery', 'inbox_email_delivery_event')) tabelas,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') funcoes,
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('inbox_email_delivery', 'inbox_email_delivery_event')) triggers_livro,
  (select count(*)::int from pg_policies where tablename in ('inbox_email_delivery', 'inbox_email_delivery_event')) politicas,
  (select count(*)::int from pg_indexes where tablename in ('inbox_email_delivery', 'inbox_email_delivery_event')) indices`);
res.aplicacao.objetos_criados = criados;
prova('D livro criado (2 tabelas, 8 funcoes, 5 triggers, 2 politicas)', criados.tabelas === 2 && criados.funcoes === 8 && criados.triggers_livro === 5 && criados.politicas === 2, JSON.stringify(criados));

// (d) privilegios
const priv = await um(db, `select
  has_function_privilege('authenticated', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute') a_create,
  has_function_privilege('anon', 'inbox_email_delivery_accept(uuid, uuid, timestamptz, text, text, boolean)', 'execute') n_accept,
  has_function_privilege('authenticated', 'inbox_email_delivery_transition(uuid, text, uuid, text, text, text)', 'execute') a_trans,
  has_function_privilege('service_role', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute') s_create,
  has_table_privilege('authenticated', 'inbox_email_delivery', 'insert') a_ins, has_table_privilege('authenticated', 'inbox_email_delivery', 'update') a_upd,
  has_table_privilege('authenticated', 'inbox_email_delivery', 'select') a_sel, has_table_privilege('anon', 'inbox_email_delivery', 'select') n_sel,
  (select relrowsecurity from pg_class where relname = 'inbox_email_delivery') rls`);
prova('E RPCs so para service_role; navegador so le', !priv.a_create && !priv.n_accept && !priv.a_trans && priv.s_create && !priv.a_ins && !priv.a_upd && priv.a_sel && !priv.n_sel && priv.rls, JSON.stringify(priv));

// (e) o Inbox de hoje continua funcionando
const org = S.org;
const nova = (await um(db, `select inbox_ingest($1, 'MANUAL', 'PORTAL', 'EXTERNAL', 'outro@teste.invalido', 'Outro Fictício', 'site.ficticio.2', null, 'Nova solicitação fictícia.', 'texto', now()) j`, [org])).j;
const upd = await espera(() => db.query(`update inbox_message set delivery_state = 'entregue' where thread_id = $1 and delivery_state = 'registrada' and provider = 'MANUAL'`, [S.threadSite]));
const whats = (await um(db, `select inbox_ingest($1, 'META_CLOUD', 'WHATSAPP', 'EXTERNAL', '5562900000000', 'Contato Fictício', 'wamid.ficticio.3', null, 'Mensagem fictícia 3.', 'texto', now()) j`, [org])).j;
prova('F ingestao (site e WhatsApp) e atualizacao de mensagem antiga seguem funcionando', nova.ok === true && whats.ok === true && upd === null, upd ?? '');
const direto = await espera(() => db.query(`insert into inbox_message (organization_id, thread_id, provider, direction, content_type, sender_kind, sender_id, sender_name, body, occurred_at, delivery_state)
  values ($1, $2, 'GOOGLE_WORKSPACE', 'outbound', 'texto', 'usuario', $3, 'X', 'forjada', now(), 'enviada')`, [org, S.threadSite, ADM]));
prova('G mensagem de e-mail nao nasce fora das RPCs', direto !== null && /servidor de envio/.test(direto), direto ?? 'inseriu');

// (f) fluxo do livro sobre o banco COMPLETO
const FP = 'a'.repeat(64); const k = (i) => `eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`;
const criar = async (thread, contato, por, chave, lu = 30, lo = 100, fp = FP) => (await um(db, `select inbox_email_delivery_create($1, $2, $3, $4, 'Administrador Teste', $5, $6, 'Assunto: x\n\ncorpo', $7, $8) j`, [org, thread, contato, por, chave, fp, lu, lo])).j;
const c1 = await criar(S.threadSite, S.contatoSite, ADM, k(1));
const c1b = await criar(S.threadSite, S.contatoSite, ADM, k(1));
const c1c = await criar(S.threadSite, S.contatoSite, ADM, k(1), 30, 100, 'b'.repeat(64));
const c2 = await criar(S.threadSite, S.contatoSite, ADM, k(2));
prova('H idempotencia: mesma intencao devolve a mesma entrega; outro conteudo e recusado; conversa com pendente bloqueia',
  c1.ok && c1.nova === true && c1b.ok && c1b.nova === false && c1b.entrega.id === c1.entrega.id && c1c.erro === 'intencao_reutilizada' && c2.erro === 'entrega_pendente', JSON.stringify([c1c.erro, c2.erro]));
const fin = await criar(S.threadWhats, (await um(db, 'select contact_id c from inbox_thread where id = $1', [S.threadWhats])).c, FIN, k(3));
const sol = await criar(S.threadWhats, (await um(db, 'select contact_id c from inbox_thread where id = $1', [S.threadWhats])).c, SOL, k(4));
prova('I papel sem permissao de envio (Financeiro, Solicitante) e recusado no banco', fin.erro === 'sem_permissao' && sol.erro === 'sem_permissao');
const slaAntes = (await um(db, 'select sla_first_response_at s from inbox_thread where id = $1', [S.threadSite])).s;
const tr = (await um(db, `select inbox_email_delivery_transition($1, 'REQUESTED', $2) j`, [c1.entrega.id, ADM])).j;
const slaMeio = (await um(db, 'select sla_first_response_at s from inbox_thread where id = $1', [S.threadSite])).s;
const ac = (await um(db, `select inbox_email_delivery_accept($1, $2, now(), 'gm-ficticio', 'gt-ficticio') j`, [c1.entrega.id, ADM])).j;
const fim = await um(db, `select t.sla_first_response_at s, t.status st, m.delivery_state ds from inbox_thread t join inbox_message m on m.id = $2 where t.id = $1`, [S.threadSite, c1.entrega.message_id]);
prova('J SLA so muda no aceite; mensagem vira enviada', tr.ok && ac.ok && slaAntes === null && slaMeio === null && fim.s !== null && fim.ds === 'enviada' && ac.cumpriu_primeira_resposta === true, `status da conversa: ${fim.st}`);
const imut = [
  await espera(() => db.query(`update inbox_email_delivery_event set reason = 'x' where delivery_id = $1`, [c1.entrega.id])),
  await espera(() => db.query(`delete from inbox_email_delivery_event where delivery_id = $1`, [c1.entrega.id])),
  await espera(() => db.query(`delete from inbox_email_delivery where id = $1`, [c1.entrega.id])),
  await espera(() => db.query(`update inbox_email_delivery set status = 'READY' where id = $1`, [c1.entrega.id])),
  await espera(() => db.query(`update inbox_email_delivery set idempotency_key = gen_random_uuid() where id = $1`, [c1.entrega.id])),
];
const eventos = (await um(db, `select count(*)::int q, string_agg(to_status, '>' order by occurred_at, id) s from inbox_email_delivery_event where delivery_id = $1`, [c1.entrega.id]));
prova('K historico imutavel: evento sem UPDATE/DELETE, entrega sem DELETE, sem regressao e com comando congelado', imut.every((x) => x !== null), `${eventos.q} eventos: ${eventos.s}`);
const lim1 = await criar(S.threadSite, S.contatoSite, ADM, k(5), 1, 100);
const lim2 = await criar(S.threadSite, S.contatoSite, ADM, k(6), 30, 1);
prova('L tetos diarios por usuario e por organizacao', lim1.erro === 'limite_usuario' && lim2.erro === 'limite_organizacao');
// RLS de leitura
const ver = async (uid) => { await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`); try { return (await um(db, 'select count(*)::int q from inbox_email_delivery')).q; } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`); } };
const vAdm = await ver(ADM); const vSol = await ver(SOL);
prova('M leitura pela RLS: Administrador ve a entrega; Solicitante nao ve nada', vAdm === 1 && vSol === 0, `adm ${vAdm}, solicitante ${vSol}`);
// chamada como usuario autenticado (mesmo com EXECUTE concedido por engano, a funcao recusa)
await db.exec(`select set_config('test.uid', '${ADM}', false);`);
const comoUsuario = await criar(S.threadWhats, (await um(db, 'select contact_id c from inbox_thread where id = $1', [S.threadWhats])).c, ADM, k(7));
await db.exec(`select set_config('test.uid', '', false);`);
prova('N RPC chamada com sessao de usuario se recusa (somente_servidor)', comoUsuario.erro === 'somente_servidor');
// o envelope se recusa a rodar de novo (pre-check) e nao muda nada
const env2 = await espera(() => db.exec(ENV.sql)); await espera(() => db.exec('rollback;'));
prova('O2 envelope aplicado duas vezes: a segunda e recusada pelo pre-check, sem efeito', env2 !== null && /PRE-CHECK/.test(env2), env2 ?? 'rodou');
// reaplicar
const entregasAntes = (await um(db, 'select count(*)::int q from inbox_email_delivery')).q;
const re = await espera(async () => { await db.exec('begin;'); await db.exec(SQL_0075); await db.exec('commit;'); });
const entregasDepois = (await um(db, 'select count(*)::int q, (select count(*)::int from inbox_email_delivery_event) e from inbox_email_delivery'));
prova('O reaplicar a 0075 e idempotente e preserva o livro', re === null && entregasDepois.q === entregasAntes && JSON.stringify(diferencas(depois, await retrato(db))) === '{}', `${entregasDepois.q} entregas, ${entregasDepois.e} eventos`);
res.limite_da_simulacao = 'PGlite tem UMA conexao: concorrencia real (duas transacoes simultaneas, espera de lock) NAO e exercitada aqui. A serializacao por conversa (FOR UPDATE), o advisory lock dos tetos e os indices unicos sao provados por construcao e pelo tratamento de unique_violation, nao por corrida real.';
await db.close();

// ───────────────────────────────────────────────────────────────── banco 2: retorno ao estado inicial
const RECUPERACAO = fs.readFileSync(new URL('./recuperacao-0075.sql', import.meta.url), 'utf8');
const b2 = await construir(); const d2 = b2.db;
await semear(d2);
const r0 = await retrato(d2); const i0 = await impressoes(d2);
await d2.exec('begin;'); await d2.exec(SQL_0075); await d2.exec('commit;');
const rec = await espera(() => d2.exec(RECUPERACAO));
await espera(() => d2.exec('rollback;'));
const r1 = await retrato(d2); const i1 = await impressoes(d2);
const sobras = await um(d2, `select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') f, to_regclass('public.inbox_email_delivery') t`);
res.recuperacao = { erro: rec, diferencas_para_o_estado_inicial: diferencas(r0, r1), sobras };
prova('P recuperacao manual (sem entregas) devolve estrutura e dados ao estado inicial', rec === null && JSON.stringify(diferencas(r0, r1)) === '{}' && JSON.stringify(i0) === JSON.stringify(i1) && sobras.f === 0 && sobras.t === null);
// com mensagem de e-mail ja gravada, a recuperacao deve RECUSAR (nao apaga historico)
await d2.exec('begin;'); await d2.exec(SQL_0075); await d2.exec('commit;');
const S2 = await um(d2, `select t.id thread, t.contact_id contato, t.organization_id org from inbox_thread t where t.channel = 'PORTAL' limit 1`);
await d2.query(`select inbox_email_delivery_create($1, $2, $3, $4, 'Administrador Teste', $5, $6, 'Assunto: x\n\ncorpo', 30, 100)`, [S2.org, S2.thread, S2.contato, ADM, 'eeeeeeee-0000-4000-8000-000000000099', 'a'.repeat(64)]);
const rec2 = await espera(() => d2.exec(RECUPERACAO));
await espera(() => d2.exec('rollback;'));
const aindaLa = (await um(d2, `select count(*)::int q from inbox_email_delivery`)).q;
prova('Q com entrega ja registrada, a recuperacao se recusa e nada e apagado', rec2 !== null && aindaLa === 1, rec2 ?? '');
await d2.close();

res.resumo = { provas: Object.keys(res.provas).length, falhas: Object.values(res.provas).filter((v) => v.startsWith('FAIL')).length };
fs.writeFileSync(SAIDA, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
process.exit(res.resumo.falhas === 0 ? 0 : 1);

// Smoke da migration 0074 (CD-D3/E5, idempotência por INTENÇÃO da meta comercial) sobre a FILA INTEIRA de migrations,
// em PGlite descartável (em memória). NADA toca produção.
//
// Como rodar:  node scripts/pg-smoke-meta-intencao.mjs     (ou npm run smoke:meta-intencao)
//
// Prova: primeira execução aplica e registra; reenvio da mesma intenção (resposta perdida) devolve o resultado original
// sem versão nova — inclusive depois de outra sessão mudar a meta (a mais recente é preservada); mesmo id com conteúdo
// diferente é recusado; intenção nova sobre versão desatualizada é recusada; nova decisão explícita gera versão
// legítima; mesmo valor da vigente segue sem versão; papel, perfil inativo e organização; registro imutável; escrita
// direta negada; rollback EXATO. Concorrência real (duas sessões) é provada à parte em PostgreSQL 17.6 descartável.
import fs from 'node:fs';
import path from 'node:path';
import { bancoComFila } from './lib/pgliteFila.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..');
const ROLLBACK = fs.readFileSync(path.join(RAIZ, 'supabase', 'rollbacks', '0074_radar_commercial_goal_intent.rollback.sql'), 'utf8').replace(/^(begin|commit);$/gm, '');

let ok = 0; let falhou = 0; let sp = 0; let db;
const passou = (n) => { ok++; console.log('  ok    ' + n); };
const quebrou = (n, d) => { falhou++; console.log('  FALHA ' + n + '\n        ' + d); };
const igual = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? passou(n) : quebrou(n, `esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`));
const so = (e) => String(e?.message ?? e).split('\n')[0];
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
async function como(uid, fn) {
  const n = `sp${++sp}`;
  await db.exec(`savepoint ${n}; set local role authenticated; select set_config('test.uid', '${uid}', true);`);
  try { const v = await fn(); await db.exec(`reset role; release savepoint ${n};`); return { v, erro: null }; }
  catch (e) { await db.exec(`rollback to savepoint ${n};`); return { v: undefined, erro: so(e) }; }
}
const RPC = `select radar_definir_meta_comercial_intencao($1::uuid, $2::date, $3::numeric, $4, $5) r`;
const pedir = (uid, intencao, mes, valor, motivo, base) => como(uid, async () => (await q(RPC, [intencao, mes, valor, motivo, base]))[0].r);
const I = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

try {
  console.log('CD-D3/E5 · smoke da 0074 (idempotência por intenção da meta) sobre a fila inteira, em PGlite\n');
  const fila = await bancoComFila(RAIZ);
  db = fila.db;
  if (!fila.aplicadas.some((f) => f.startsWith('0074_'))) throw new Error('0074 não encontrada');
  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const orgB = await um(`insert into organization (code, name) values ('OUTRA', 'Outra') returning id`);
  const U = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ADM = U(1), DIR = U(2), COMPRAS = U(3), INATIVO = U(4), ADM_B = U(5);
  await q(`insert into profile (id, organization_id, name, email, role, active) values ($1,$6,'Adm','a@t','Administrador',true), ($2,$6,'Dir','d@t','Diretoria',true), ($3,$6,'Compras','c@t','Compras',true), ($4,$6,'Inativo','i@t','Administrador',false), ($5,$7,'Adm B','b@t','Administrador',true)`, [ADM, DIR, COMPRAS, INATIVO, ADM_B, org, orgB]);
  const mes = await um(`select (radar_mes_comercial_de(now()) + interval '1 month')::date::text`);
  const versoes = async (o = org) => (await q(`select version, amount::text v, reason from radar_commercial_goal where organization_id = $1 and period_month = $2 order by version`, [o, mes])).map((x) => [x.version, x.v]);
  const audits = async () => Number(await um(`select count(*) from audit_log where entity_type = 'radar_meta_comercial'`));
  const intencoes = async () => Number(await um(`select count(*) from radar_commercial_goal_intent`));

  console.log('A. objetos e permissões');
  igual('RPC por intenção: security definer, search_path fixo; authenticated executa, anon e service_role não', [
    await um(`select prosecdef from pg_proc where proname = 'radar_definir_meta_comercial_intencao'`),
    await um(`select array_to_string(proconfig, ';') from pg_proc where proname = 'radar_definir_meta_comercial_intencao'`),
    await um(`select has_function_privilege('authenticated', 'radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer)', 'execute')`),
    await um(`select has_function_privilege('anon', 'radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer)', 'execute')`),
    await um(`select has_function_privilege('service_role', 'radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer)', 'execute')`)], [true, 'search_path=pg_catalog, pg_temp', true, false, false]);
  igual('registro de intenções: authenticated só lê; ninguém da API escreve; RLS ligada', [
    await um(`select has_table_privilege('authenticated', 'radar_commercial_goal_intent', 'select')`),
    await um(`select bool_or(has_table_privilege(r, 'radar_commercial_goal_intent', p)) from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p`),
    await um(`select relrowsecurity from pg_class where relname = 'radar_commercial_goal_intent'`)], [true, false, true]);
  igual('a RPC da 0068 continua igual (não alterada retroativamente)', await um(`select pg_get_function_identity_arguments('radar_definir_meta_comercial'::regproc)`), 'p_mes date, p_valor numeric, p_motivo text');

  console.log('\nB. primeira execução e resposta perdida');
  const a0 = await audits();
  const r1 = await pedir(ADM, I(1), mes, 250000, 'meta aprovada', 0);
  igual('primeira execução aplica (v1) e registra a intenção', [r1.erro, r1.v?.alterado, r1.v?.versao, r1.v?.repetida, await versoes(), await intencoes()], [null, true, 1, false, [[1, '250000.00']], 1]);
  const r1b = await pedir(ADM, I(1), mes, 250000, 'meta aprovada', 0);
  igual('RPC fez COMMIT e a resposta se perdeu: o reenvio devolve o resultado ORIGINAL, sem versão nem auditoria nova', [r1b.erro, r1b.v?.id === r1.v?.id, r1b.v?.versao, r1b.v?.repetida, await versoes(), (await audits()) - a0], [null, true, 1, true, [[1, '250000.00']], 1]);

  console.log('\nC. outra sessão muda a meta antes do reenvio');
  const r2 = await pedir(DIR, I(2), mes, 300000, 'revisão da diretoria', 1);
  igual('outra sessão (intenção nova, base 1) cria v2 = 300.000', [r2.erro, r2.v?.versao, await versoes()], [null, 2, [[1, '250000.00'], [2, '300000.00']]]);
  const r1c = await pedir(ADM, I(1), mes, 250000, 'meta aprovada', 0);
  igual('reenvio da intenção ORIGINAL devolve o resultado anterior (v1) e NÃO restaura 250.000: a v2 continua valendo', [r1c.erro, r1c.v?.versao, r1c.v?.repetida, await versoes()], [null, 1, true, [[1, '250000.00'], [2, '300000.00']]]);

  console.log('\nD. mesmo identificador com conteúdo diferente');
  for (const [nome, args] of [['valor', [250001, 'meta aprovada', 0]], ['motivo', [250000, 'outro motivo', 0]], ['versão base', [250000, 'meta aprovada', 1]]]) {
    const r = await pedir(ADM, I(1), mes, ...args);
    igual(`mesmo id, ${nome} diferente: recusado sem mudança`, [/outro conteúdo/.test(r.erro ?? ''), await versoes()], [true, [[1, '250000.00'], [2, '300000.00']]]);
  }
  const rMes = await pedir(ADM, I(1), await um(`select ($1::date + interval '1 month')::date::text`, [mes]), 250000, 'meta aprovada', 0);
  igual('mesmo id em outro mês: recusado', /outro conteúdo/.test(rMes.erro ?? ''), true);

  console.log('\nE. pré-condição de versão vigente e nova decisão explícita');
  const n0 = await intencoes();
  const rVelha = await pedir(ADM, I(3), mes, 260000, 'decisão sobre dado velho', 1);
  igual('intenção nova baseada na v1 (vigente é a v2): recusada, nenhuma versão nem intenção registrada', [/mudou em outra sessão \(versão atual 2, a decisão partiu da versão 1\)/.test(rVelha.erro ?? ''), await versoes(), (await intencoes()) - n0], [true, [[1, '250000.00'], [2, '300000.00']], 0]);
  const rNova = await pedir(ADM, I(4), mes, 260000, 'nova decisão explícita', 2);
  igual('nova decisão explícita (intenção nova, base 2) gera a v3 legítima', [rNova.erro, rNova.v?.versao, (await versoes()).at(-1)], [null, 3, [3, '260000.00']]);
  const rMesmo = await pedir(ADM, I(5), mes, 260000, 'mesmo valor', 3);
  igual('mesmo valor da vigente: sem versão nova (regra da 0068), intenção registrada; o reenvio devolve o mesmo', [rMesmo.v?.alterado, (await versoes()).length, (await pedir(ADM, I(5), mes, 260000, 'mesmo valor', 3)).v?.repetida], [false, 3, true]);
  const rRet = await pedir(DIR, I(6), mes, null, 'meta suspensa', 3);
  igual('retirada por intenção: v4 nula; reenvio idempotente', [rRet.v?.versao, (await versoes()).at(-1), (await pedir(DIR, I(6), mes, null, 'meta suspensa', 3)).v?.versao, (await versoes()).length], [4, [4, null], 4, 4]);

  console.log('\nF. governança, isolamento e imutabilidade');
  igual('Compras é recusado e nada fica registrado', [/sem permissão/.test((await pedir(COMPRAS, I(7), mes, 1000, 'tentativa', 4)).erro ?? ''), Number(await um(`select count(*) from radar_commercial_goal_intent where intent_id = $1`, [I(7)]))], [true, 0]);
  igual('perfil inativo é recusado', /sem perfil ativo/.test((await pedir(INATIVO, I(8), mes, 1000, 'tentativa', 4)).erro ?? ''), true);
  igual('mês passado continua recusado pela 0068', /só o mês corrente/.test((await pedir(ADM, I(9), '2020-01-01', 1000, 'passado', 0)).erro ?? ''), true);
  igual('sem identificador ou sem versão base: recusado', [/sem identificador/.test((await pedir(ADM, null, mes, 1000, 'x x x', 4)).erro ?? ''), /versão vigente em que a decisão se baseou/.test((await pedir(ADM, I(10), mes, 1000, 'x x x', null)).erro ?? '')], [true, true]);
  const rB = await pedir(ADM_B, I(1), mes, 5000, 'meta da outra organização', 0);
  igual('a mesma intenção (uuid) em outra organização é independente', [rB.erro, rB.v?.versao, rB.v?.repetida, await versoes(orgB)], [null, 1, false, [[1, '5000.00']]]);
  igual('organização B não lê as intenções de A', (await como(ADM_B, () => um(`select count(*)::int from radar_commercial_goal_intent where organization_id = $1`, [org]))).v, 0);
  const direto = await como(ADM, () => q(`insert into radar_commercial_goal_intent (organization_id, intent_id, period_month, amount, reason, base_version, result, created_by) values ($1, $2, $3, 1, 'direto', 0, '{}', $4)`, [org, I(11), mes, ADM]));
  igual('escrita direta no registro negada (authenticated)', /permission denied/.test(direto.erro ?? ''), true);
  const n = `spi${++sp}`; await db.exec(`savepoint ${n}`);
  let imut = null; try { await q(`update radar_commercial_goal_intent set reason = 'x'`); } catch (e) { imut = so(e); } await db.exec(`rollback to savepoint ${n}`);
  igual('registro imutável até para o dono do banco', /imutável/.test(imut ?? ''), true);

  await db.exec('rollback;');
  console.log('\nP. rollback EXATO da 0074');
  await db.exec('begin;');
  await db.exec(ROLLBACK);
  igual('nenhum objeto da 0074 sobra; a RPC da 0068 continua', [await um(`select to_regclass('public.radar_commercial_goal_intent') is null`), await um(`select count(*)::int from pg_proc where proname in ('radar_definir_meta_comercial_intencao','radar_commercial_goal_intent_imutavel')`), await um(`select count(*)::int from pg_proc where proname = 'radar_definir_meta_comercial'`)], [true, 0, 1]);
  await db.exec('rollback;');
} catch (e) {
  quebrou('execução', so(e));
}
console.log(`\n${ok} ok, ${falhou} falha(s)`);
console.log(JSON.stringify({ smoke: 'cd-d3-meta-intencao', ok, falhou }));
process.exit(falhou ? 1 : 0);

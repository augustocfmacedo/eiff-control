// Smoke test da migration 0068 (CD-D3/E2, metas comerciais governadas) contra um PostgreSQL DE VERDADE.
//
// Por que existe: teste de TypeScript prova o que o app MANDA; só o banco prova o que ele ACEITA. A autoridade das metas
// (papel, organização, mês, valor, motivo, versão e auditoria) é a RPC radar_definir_meta_comercial, então a prova é aqui.
//
// Como rodar:
//   node scripts/pg-smoke-meta-comercial.mjs        (ou npm run smoke:meta-comercial)
//
// O @electric-sql/pglite é devDependency FIXADA. O banco é criado em memória, roda dentro de BEGIN ... ROLLBACK e
// morre com o processo. NADA toca produção, não há conexão de rede.
//
// O prelúdio recria só o que a 0068 assume do resto do schema: organization, profile (com o papel Solicitante da 0066),
// audit_log, auth.uid() e current_org() como na 0067 (ignora o Solicitante).
//
// Limite conhecido (gate de implantação): o PGlite tem uma conexão só e nesta máquina não há PostgreSQL de verdade
// (Docker parado, sem imagem local), então DUAS sessões simultâneas não rodam aqui. A prova é estrutural: a RPC pega
// pg_advisory_xact_lock(organização + mês) antes de ler a última versão (a trava aparece em pg_locks até o fim da
// transação), e a unique (…, period_month, version) recusa uma versão repetida mesmo que duas transações cheguem juntas
// (testado com insert direto). O teste com duas sessões fica para um PostgreSQL real antes de aplicar em produção.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL_0068 = readFileSync('supabase/migrations/0068_radar_commercial_goal.sql', 'utf8');
/** Rollback EXATO versionado; o begin/commit sai porque o smoke já roda numa transação que termina em rollback. */
const ROLLBACK_0068 = readFileSync(new URL('../supabase/rollbacks/0068_radar_commercial_goal.rollback.sql', import.meta.url), 'utf8').replace(/^(begin|commit);$/gm, '');

const PRELUDIO = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $r$;
create type role_kind as enum ('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', 'Solicitante');
create table organization (id uuid primary key default gen_random_uuid(), code text);
create table profile (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  role role_kind not null default 'Administrador',
  active boolean not null default true
);
create table audit_log (
  id bigserial primary key, organization_id uuid, occurred_at timestamptz not null default now(), actor_id uuid,
  action text not null, entity_type text not null, entity_id text, before_data jsonb, after_data jsonb, reason text, source text
);
-- current_org() como na 0067: perfil ativo e que não seja Solicitante
create function current_org() returns uuid language sql stable security definer as $$
  select organization_id from profile where id = auth.uid() and active and role <> 'Solicitante'
$$;
grant select on audit_log to authenticated;`;

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
async function recusa(nome, sql, params, pedaco) {
  const x = await emSavepoint(() => db.query(sql, params));
  if (x.ok) { quebrou(nome, 'o banco ACEITOU — a regra nao esta valendo'); return; }
  const msg = String(x.e.message).toLowerCase();
  if (pedaco && !msg.includes(pedaco.toLowerCase())) quebrou(nome, 'recusou pelo motivo errado: ' + x.e.message);
  else passou(nome);
}
function igual(nome, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) passou(nome);
  else quebrou(nome, `esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
}

async function main() {
  console.log('CD-D3/E2 · smoke da migration 0068 (metas comerciais governadas) em PostgreSQL descartavel (PGlite)\n');
  await db.exec(PRELUDIO);
  await db.exec('begin');
  const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.id;
  const valor = async (sql, params = []) => { const r = (await db.query(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; };
  const aclDe = (t) => valor(`select coalesce(relacl::text, '') from pg_class where oid = '${t}'::regclass`);
  const aclAntes = { audit_log: await aclDe('audit_log'), profile: await aclDe('profile'), organization: await aclDe('organization') };

  await db.exec(SQL_0068);
  console.log('  preludio + 0068 aplicadas\n');

  const org = await um("insert into organization (code) values ('EIFF') returning id");
  const outraOrg = await um("insert into organization (code) values ('OUTRA') returning id");
  const perfil = (nome, papel, organizacao = org, ativo = true) => um('insert into profile (organization_id, name, role, active) values ($1,$2,$3,$4) returning id', [organizacao, nome, papel, ativo]);
  const adm = await perfil('Adm', 'Administrador');
  const dir = await perfil('Dir', 'Diretoria');
  const admInativo = await perfil('Adm inativo', 'Administrador', org, false);
  const admFora = await perfil('Adm de fora', 'Administrador', outraOrg);
  const comoAutor = (id) => db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? '']);
  const RPC = 'select radar_definir_meta_comercial($1::date, $2::numeric, $3) as r';
  const mesAtual = await valor('select radar_mes_comercial_de(now())::text');
  const mesFuturo = await valor("select (radar_mes_comercial_de(now()) + interval '2 month')::date::text");
  const mesPassado = await valor("select (radar_mes_comercial_de(now()) - interval '1 month')::date::text");
  const versoes = (organizacao, mes) => db.query('select version, amount::text as amount, supersedes_id, reason, created_by from radar_commercial_goal where organization_id = $1 and period_month = $2 order by version', [organizacao, mes]).then((r) => r.rows);
  const auditorias = () => valor("select count(*)::int from audit_log where entity_type = 'radar_meta_comercial'");
  const ultimaAuditoria = async () => (await db.query("select actor_id, action, reason, source, before_data, after_data from audit_log where entity_type = 'radar_meta_comercial' order by id desc limit 1")).rows[0];

  console.log('mês comercial no fuso de São Paulo');
  igual('23:59:59 de 30/09 em São Paulo (02:59:59Z de 01/10) é setembro', await valor("select radar_mes_comercial_de('2026-10-01T02:59:59Z')::text"), '2026-09-01');
  igual('00:00 de 01/10 em São Paulo (03:00Z) é outubro', await valor("select radar_mes_comercial_de('2026-10-01T03:00:00Z')::text"), '2026-10-01');
  igual('virada de ano segue o fuso', await valor("select radar_mes_comercial_de('2027-01-01T02:00:00Z')::text"), '2026-12-01');

  console.log('\ndefinição, versão e auditoria');
  await comoAutor(adm);
  const r1 = (await db.query(RPC, [mesAtual, '100000.00', 'meta inicial do mês'])).rows[0].r;
  igual('Administrador define a meta do mês corrente (versão 1)', [r1.alterado, r1.versao, Number(r1.valor)], [true, 1, 100000]);
  let a = await ultimaAuditoria();
  igual('auditoria: autor, ação, motivo, fonte rpc, sem "antes" na primeira versão', [a.actor_id, a.action, a.reason, a.source, a.before_data], [adm, 'radar_definir_meta_comercial', 'meta inicial do mês', 'rpc', null]);
  await comoAutor(dir);
  const r2 = (await db.query(RPC, [mesAtual, '120000.50', 'revisão da diretoria'])).rows[0].r;
  igual('Diretoria revisa: nova versão 2, a 1 continua intacta', (await versoes(org, mesAtual)).map((x) => [x.version, x.amount]), [[1, '100000.00'], [2, '120000.50']]);
  igual('a versão 2 aponta para a 1 que substituiu', (await versoes(org, mesAtual))[1].supersedes_id, r1.id);
  a = await ultimaAuditoria();
  igual('auditoria da revisão: antes (versão 1) e depois (versão 2)', [a.before_data.versao, Number(a.before_data.valor), a.after_data.versao, Number(a.after_data.valor)], [1, 100000, 2, 120000.5]);
  igual('Diretoria define meta de mês futuro', (await db.query(RPC, [mesFuturo, '90000', 'planejamento'])).rows[0].r.versao, 1);
  const nAud = await auditorias();
  const semMudanca = (await db.query(RPC, [mesAtual, '120000.50', 'mesmo valor'])).rows[0].r;
  igual('mesmo valor da versão vigente: nada muda, nada é auditado', [semMudanca.alterado, semMudanca.versao, (await versoes(org, mesAtual)).length, (await auditorias()) - nAud], [false, 2, 2, 0]);
  void r2;

  console.log('\nretirada');
  const ret = (await db.query(RPC, [mesAtual, null, 'meta suspensa'])).rows[0].r;
  igual('retirar cria a versão 3 com valor nulo', [ret.alterado, ret.versao, ret.valor], [true, 3, null]);
  igual('auditoria da retirada', (await ultimaAuditoria()).action, 'radar_retirar_meta_comercial');
  await recusa('retirar de novo é recusado', RPC, [mesAtual, null, 'retirar outra vez'], 'não há meta vigente para retirar');
  const mesSemMeta = await valor("select (radar_mes_comercial_de(now()) + interval '5 month')::date::text");
  await recusa('retirar mês sem meta é recusado', RPC, [mesSemMeta, null, 'retirar'], 'não há meta vigente para retirar');
  igual('redefinir depois da retirada cria a versão 4', (await db.query(RPC, [mesAtual, '110000', 'meta retomada'])).rows[0].r.versao, 4);

  console.log('\nrecusas (nada muda, nada é auditado)');
  const nVersoes = (await versoes(org, mesAtual)).length;
  const nAudRecusas = await auditorias();
  await comoAutor(null);
  await recusa('sem sessão', RPC, [mesAtual, '1', 'tentativa'], 'não autenticada');
  await comoAutor(admInativo);
  await recusa('autor inativo', RPC, [mesAtual, '1', 'tentativa'], 'sem perfil ativo');
  for (const papel of ['Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria', 'Solicitante']) {
    await comoAutor(await perfil('Sem permissão ' + papel, papel));
    await recusa(`papel ${papel} não define meta`, RPC, [mesAtual, '1', 'tentativa'], 'sem permissão');
  }
  await db.exec('alter table profile alter column role drop not null, alter column active drop not null');
  const semPapel = await um("insert into profile (organization_id, name, role) values ($1,'Sem papel',null) returning id", [org]);
  const semSituacao = await um("insert into profile (organization_id, name, role, active) values ($1,'Sem situação','Administrador',null) returning id", [org]);
  await comoAutor(semPapel);
  await recusa('papel nulo é recusado (falha fechada)', RPC, [mesAtual, '1', 'tentativa'], 'sem permissão');
  await comoAutor(semSituacao);
  await recusa('situação ativa nula é recusada (falha fechada)', RPC, [mesAtual, '1', 'tentativa'], 'sem perfil ativo');
  await db.query('delete from profile where id in ($1,$2)', [semPapel, semSituacao]);
  await db.exec('alter table profile alter column role set not null, alter column active set not null');
  await comoAutor(adm);
  await recusa('motivo vazio', RPC, [mesAtual, '1', '   '], 'motivo');
  await recusa('motivo com 2 caracteres', RPC, [mesAtual, '1', 'ab'], 'motivo');
  await recusa('motivo com 501 caracteres', RPC, [mesAtual, '1', 'x'.repeat(501)], 'motivo');
  await recusa('mês passado (D3-C)', RPC, [mesPassado, '1', 'tentativa'], 'só o mês corrente');
  await recusa('data que não é o dia 1', RPC, [mesAtual.slice(0, 8) + '15', '1', 'tentativa'], 'mês inválido');
  await recusa('mês nulo', RPC, [null, '1', 'tentativa'], 'mês inválido');
  await recusa('valor zero', RPC, [mesAtual, '0', 'tentativa'], 'valor positivo');
  await recusa('valor negativo', RPC, [mesAtual, '-1', 'tentativa'], 'valor positivo');
  await recusa('valor com 3 casas', RPC, [mesAtual, '1.005', 'tentativa'], 'no máximo 2 casas');
  await recusa('valor acima do teto (R$ 1 trilhão + 1 centavo)', RPC, [mesAtual, '1000000000000.01', 'tentativa'], 'acima do máximo');
  await recusa('valor muito acima do teto', RPC, [mesAtual, '10000000000000000', 'tentativa'], 'acima do máximo');
  igual('nenhuma recusa criou versão', (await versoes(org, mesAtual)).length, nVersoes);
  igual('nenhuma recusa gerou auditoria', (await auditorias()) - nAudRecusas, 0);

  console.log('\natomicidade: falha na auditoria desfaz a nova versão');
  await db.exec(`create function falha_simulada() returns trigger language plpgsql as $f$ begin
    if new.entity_type = 'radar_meta_comercial' then raise exception 'falha simulada na auditoria'; end if; return new; end $f$;
    create trigger falha_simulada before insert on audit_log for each row execute function falha_simulada();`);
  await recusa('a RPC falha inteira quando a auditoria falha', RPC, [mesAtual, '130000', 'teste de atomicidade'], 'falha simulada');
  igual('nenhuma versão nova (meta e auditoria na mesma transação)', (await versoes(org, mesAtual)).length, nVersoes);
  await db.exec('drop trigger falha_simulada on audit_log; drop function falha_simulada();');

  console.log('\nisolamento entre organizações (a organização vem do perfil, nunca do pedido)');
  await comoAutor(admFora);
  igual('Administrador de outra organização define a meta DELA (versão 1)', (await db.query(RPC, [mesAtual, '5000', 'outra empresa'])).rows[0].r.versao, 1);
  igual('as versões da EIFF não mudaram', (await versoes(org, mesAtual)).length, nVersoes);
  const comoPapel = async (papel, sql, params = []) => emSavepoint(async () => {
    await db.exec(`set local role ${papel}`);
    const r = await db.query(sql, params);
    await db.exec('reset role');
    return r;
  });
  await comoAutor(adm);
  const visEiff = await comoPapel('authenticated', 'select distinct organization_id::text as o from radar_commercial_goal');
  igual('RLS: usuário da EIFF só lê metas da EIFF', visEiff.ok ? visEiff.r.rows.map((x) => x.o) : visEiff.e.message, [org]);
  await comoAutor(admFora);
  const visFora = await comoPapel('authenticated', 'select distinct organization_id::text as o from radar_commercial_goal');
  igual('RLS: usuário da outra organização só lê as dela', visFora.ok ? visFora.r.rows.map((x) => x.o) : visFora.e.message, [outraOrg]);
  await comoAutor(await perfil('Solicitante', 'Solicitante'));
  const visSol = await comoPapel('authenticated', 'select count(*)::int as n from radar_commercial_goal');
  igual('RLS: Solicitante não lê metas', visSol.ok ? visSol.r.rows[0].n : visSol.e.message, 0);

  console.log('\nescrita direta proibida');
  await comoAutor(adm);
  const negado = async (nome, x) => { if (x.ok) quebrou(nome, 'o banco ACEITOU'); else if (!/permission denied|imutáveis/i.test(String(x.e.message))) quebrou(nome, 'motivo errado: ' + x.e.message); else passou(nome); };
  await negado('authenticated não insere direto', await comoPapel('authenticated', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by) values ($1, $2::date, 1, 99, 'direto', $3)", [org, mesFuturo, adm]));
  await negado('authenticated não altera', await comoPapel('authenticated', 'update radar_commercial_goal set amount = 1'));
  await negado('authenticated não apaga', await comoPapel('authenticated', 'delete from radar_commercial_goal'));
  await negado('anon não lê', await comoPapel('anon', 'select * from radar_commercial_goal'));
  await negado('anon não executa a RPC', await comoPapel('anon', RPC, [mesAtual, '1', 'tentativa']));
  const permitido = await comoPapel('authenticated', RPC, [mesFuturo, '95000', 'pelo app']);
  igual('authenticated executa a RPC (a autoridade é a do perfil)', permitido.ok ? permitido.r.rows[0].r.versao : permitido.e.message, 2);
  await recusa('nem o dono do banco altera uma versão (gatilho)', 'update radar_commercial_goal set amount = 1', [], 'imutáveis');
  await recusa('nem o dono do banco apaga uma versão (gatilho)', 'delete from radar_commercial_goal', [], 'imutáveis');
  await recusa('nem o dono do banco trunca (gatilho)', 'truncate radar_commercial_goal', [], 'imutáveis');

  console.log('\nintegridade da tabela (mesmo para quem tem acesso total)');
  await recusa('versão repetida é recusada (unique: última barreira contra concorrência)', "insert into radar_commercial_goal (organization_id, period_month, amount, version, supersedes_id, reason, created_by) select organization_id, period_month, 1, version, supersedes_id, 'corrida', created_by from radar_commercial_goal where organization_id = $1 and period_month = $2 and version = 2", [org, mesAtual], 'radar_commercial_goal_versao_unica');
  await recusa('versão 2 sem apontar a substituída é recusada', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by) values ($1, $2::date, 1, 77, 'sem vinculo', $3)", [org, mesFuturo, adm], 'radar_commercial_goal_substitui');
  await recusa('mês fora do dia 1 é recusado pela tabela', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by) values ($1, '2030-01-15', 1, 1, 'dia errado', $2)", [org, adm], 'check');
  await recusa('valor zero é recusado pela tabela', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by) values ($1, '2030-01-01', 0, 1, 'zero', $2)", [org, adm], 'check');
  await recusa('métrica, moeda e escopo são fixos', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by, currency) values ($1, '2030-01-01', 1, 1, 'dolar', $2, 'USD')", [org, adm], 'check');
  igual('a RPC pega a trava transacional antes de ler a versão', /pg_advisory_xact_lock[\s\S]*order by g\.version desc/.test(SQL_0068), true);

  console.log('\nteto de valor alinhado ao motor (VALOR_MAXIMO_META = R$ 1.000.000.000.000,00)');
  await comoAutor(adm);
  const mesTeto = await valor("select (radar_mes_comercial_de(now()) + interval '7 month')::date::text");
  const teto = (await db.query(RPC, [mesTeto, '1000000000000.00', 'teto exato'])).rows[0].r;
  igual('o teto exato é aceito', [teto.alterado, Number(teto.valor)], [true, 1000000000000]);
  await recusa('a tabela recusa acima do teto mesmo em gravação direta', "insert into radar_commercial_goal (organization_id, period_month, amount, version, reason, created_by) values ($1, '2031-01-01', 1000000000000.01, 1, 'acima', $2)", [org, adm], 'check');

  console.log('\nsearch_path seguro e tabelas temporárias de mesmo nome');
  const caminhos = (await db.query("select proname, array_to_string(proconfig, ';') as c, prosecdef from pg_proc where proname in ('radar_definir_meta_comercial','radar_mes_comercial_de','radar_commercial_goal_imutavel') order by proname")).rows;
  igual('as três funções fixam search_path = pg_catalog, pg_temp (pg_temp por último)', caminhos.map((x) => [x.proname, x.c]), [['radar_commercial_goal_imutavel', 'search_path=pg_catalog, pg_temp'], ['radar_definir_meta_comercial', 'search_path=pg_catalog, pg_temp'], ['radar_mes_comercial_de', 'search_path=pg_catalog, pg_temp']]);
  igual('só a RPC é security definer', caminhos.filter((x) => x.prosecdef).map((x) => x.proname), ['radar_definir_meta_comercial']);
  const compras = await perfil('Compras (sombra)', 'Compras');
  // a sessão cria tabelas temporárias com os MESMOS nomes que a RPC usa (o papel authenticated tem TEMP no banco)
  await db.exec(`create temp table profile (id uuid, organization_id uuid, name text, role public.role_kind, active boolean);
    create temp table audit_log (like public.audit_log including defaults);
    create temp table radar_commercial_goal (like public.radar_commercial_goal);`);
  await db.query("insert into pg_temp.profile values ($1, $2, 'Sombra', 'Administrador', true)", [compras, org]);
  await comoAutor(compras);
  await recusa('perfil falso em tabela temporária não promove o Compras a Administrador', RPC, [mesTeto, '5', 'tentativa pela sombra'], 'sem permissão');
  await comoAutor(adm);
  const antesSombra = await valor('select count(*)::int from public.radar_commercial_goal');
  const audAntesSombra = await valor("select count(*)::int from public.audit_log where entity_type = 'radar_meta_comercial'");
  const viaSombra = (await db.query(RPC, [mesTeto, '7', 'gravação com sombras presentes'])).rows[0].r;
  igual('com as sombras presentes a RPC grava nas tabelas reais (public)', [viaSombra.alterado, (await valor('select count(*)::int from public.radar_commercial_goal')) - antesSombra, (await valor("select count(*)::int from public.audit_log where entity_type = 'radar_meta_comercial'")) - audAntesSombra], [true, 1, 1]);
  igual('as tabelas temporárias não recebem nada', [await valor('select count(*)::int from pg_temp.radar_commercial_goal'), await valor('select count(*)::int from pg_temp.audit_log')], [0, 0]);
  await db.exec('drop table pg_temp.profile, pg_temp.audit_log, pg_temp.radar_commercial_goal;');

  console.log('\nconcorrência: trava transacional (o PGlite tem uma conexão só; ver o limite no cabeçalho)');
  // no PGlite o pid da trava vem nulo (modo de usuário único); com uma sessão só, toda trava listada é desta transação
  const travas = async () => valor("select count(*)::int from pg_locks where locktype = 'advisory' and granted");
  const travasAntes = await travas();
  const mesTrava = await valor("select (radar_mes_comercial_de(now()) + interval '9 month')::date::text"); // mês ainda não travado nesta transação
  await db.query(RPC, [mesTrava, '8', 'prova da trava']);
  igual('a RPC deixa uma trava consultiva de transação ativa até o fim da transação', (await travas()) - travasAntes >= 1, true);
  igual('a chave da trava é organização + mês (texto da migration)', /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('radar_commercial_goal:' \|\| v_org::text \|\| ':' \|\| p_mes::text, 0\)\)/.test(SQL_0068), true);

  console.log('\nrollback EXATO da 0068 (supabase/rollbacks/0068_radar_commercial_goal.rollback.sql)');
  await db.exec(ROLLBACK_0068);
  igual('rollback: nenhum objeto da 0068 sobra', await valor("select (to_regclass('radar_commercial_goal') is null) and not exists (select 1 from pg_proc where proname in ('radar_definir_meta_comercial','radar_mes_comercial_de','radar_commercial_goal_imutavel'))"), true);
  igual('rollback: permissões das tabelas existentes iguais às de antes da 0068', { audit_log: await aclDe('audit_log'), profile: await aclDe('profile'), organization: await aclDe('organization') }, aclAntes);

  await db.exec('rollback');
  console.log(`\n${ok} ok, ${falhou} falha(s)`);
  console.log(JSON.stringify({ smoke: 'cd-d3-meta-comercial', ok, falhou }));
  if (falhou) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

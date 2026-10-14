// Smoke da migration 0070 (CD-D3/E3, livro imutável de desfechos) contra um PostgreSQL de verdade (PGlite, devDependency
// fixada), em memória. Aplica a FILA INTEIRA de migrations (0001..0070, com a semente e a mesma correção histórica de
// ordem do preflight) — a 0070 é provada sobre a radar_opportunity real, com as políticas, o audit_row e o
// touch_updated_at de produção, e não sobre um prelúdio de mentira. NADA toca produção.
//
// Como rodar:  node scripts/pg-smoke-desfechos.mjs     (ou npm run smoke:desfechos)
//
// Prova: GANHO ao entrar em WON (inclusive criação já ganha) com tudo congelado; WON → WON e reenvio não duplicam;
// oportunidade ganha travada; ESTORNO ao reabrir (e ao ir para LOST) citando o ganho, no mês em que ocorre; novo ganho
// depois de reabrir; ganho sem valor + COMPLEMENTO governado (um só, só em ganho sem valor, papéis, motivo, valor);
// atomicidade (evento que falha desfaz a mudança de estágio); livro imutável para qualquer papel; escrita direta negada;
// isolamento por organização e Solicitante; won_amount só em ganha; oportunidade com eventos não é apagada; search_path
// seguro contra tabelas temporárias de mesmo nome; rollback EXATO volta o schema ao de antes da 0070.
// Concorrência real (duas sessões) não roda no PGlite (uma conexão só): ver o item de gate no cabeçalho do PR.
import fs from 'node:fs';
import path from 'node:path';
import { bancoComFila } from './lib/pgliteFila.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ_REPO = path.join(AQUI, '..');
const ROLLBACK = fs.readFileSync(path.join(RAIZ_REPO, 'supabase', 'rollbacks', '0070_radar_commercial_outcome.rollback.sql'), 'utf8').replace(/^(begin|commit);$/gm, '');
const ALVO = '0070';

let ok = 0; let falhou = 0;
const passou = (n) => { ok++; console.log('  ok    ' + n); };
const quebrou = (n, d) => { falhou++; console.log('  FALHA ' + n + '\n        ' + d); };
const igual = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? passou(n) : quebrou(n, `esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`));
const so = (e) => String(e?.message ?? e).split('\n')[0];

let db;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => { const r = await q(sql, p); return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let sp = 0;
/** roda `fn` como `uid` (papel authenticated); `manter` guarda o efeito, senão desfaz. Devolve { valor, erro }. */
async function como(uid, fn, { manter = true } = {}) {
  const nome = `sp${++sp}`;
  await db.exec(`savepoint ${nome};`);
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid ?? ''}', true);`);
    const valor = await fn();
    await db.exec(`reset role; select set_config('test.uid', '', true);`);
    await db.exec(manter ? `release savepoint ${nome};` : `rollback to savepoint ${nome};`);
    return { valor, erro: null };
  } catch (e) {
    await db.exec(`rollback to savepoint ${nome};`);
    return { valor: undefined, erro: so(e) };
  }
}
async function recusa(nome, uid, sql, p, pedaco) {
  const r = uid === 'DONO' ? await (async () => { const n = `sp${++sp}`; await db.exec(`savepoint ${n};`); try { await q(sql, p); await db.exec(`release savepoint ${n};`); return { erro: null }; } catch (e) { await db.exec(`rollback to savepoint ${n};`); return { erro: so(e) }; } })()
    : await como(uid, () => q(sql, p));
  if (!r.erro) return quebrou(nome, 'ACEITO — a regra não está valendo');
  if (pedaco && !r.erro.toLowerCase().includes(pedaco.toLowerCase())) return quebrou(nome, 'recusou pelo motivo errado: ' + r.erro);
  passou(nome);
}
const schemaOportunidade = async () => ({
  colunas: (await q(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'radar_opportunity' order by ordinal_position`)).map((r) => `${r.column_name}:${r.data_type}`),
  restricoes: (await q(`select conname from pg_constraint where conrelid = 'public.radar_opportunity'::regclass order by 1`)).map((r) => r.conname),
  gatilhos: (await q(`select tgname from pg_trigger where tgrelid = 'public.radar_opportunity'::regclass and not tgisinternal order by 1`)).map((r) => r.tgname),
  acl: await um(`select coalesce(relacl::text, '') from pg_class where oid = 'public.radar_opportunity'::regclass`),
});

try {
  console.log('CD-D3/E3 · smoke da migration 0070 (livro de desfechos) sobre a fila inteira, em PGlite descartável\n');
  let antes0070;
  const fila = await bancoComFila(RAIZ_REPO, { antesDe: async (n, banco) => { if (n === ALVO) { db = banco; antes0070 = await schemaOportunidade(); } } });
  db = fila.db;
  if (!fila.aplicadas.some((f) => f.startsWith(ALVO + '_'))) throw new Error('0070 não encontrada');
  const feitas = fila.aplicadas; const arquivos = [fila.ultima];
  console.log(`  fila aplicada: ${feitas.length} migrations (última ${arquivos[arquivos.length - 1]})\n`);

  await db.exec('begin;');
  const org = await um(`select id from organization where code = 'EIFF'`);
  const outraOrg = await um(`insert into organization (code, name) values ('OUTRA', 'Outra') returning id`);
  const U = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ADM = U(1), DIR = U(2), FIN = U(3), COMPRAS = U(4), GESTOR = U(5), INATIVO = U(6), SOL = U(7), ADM_FORA = U(8), DONO_CONTA = U(9);
  await q(`insert into profile (id, organization_id, name, email, role, active) values
    ($1,$10,'Adm','adm@t','Administrador',true), ($2,$10,'Dir','dir@t','Diretoria',true), ($3,$10,'Fin','fin@t','Financeiro',true),
    ($4,$10,'Compras','com@t','Compras',true), ($5,$10,'Gestor','ges@t','Gestor de obra',true), ($6,$10,'Inativo','ina@t','Administrador',false),
    ($7,$10,'Sol','sol@t','Solicitante',true), ($8,$11,'Adm fora','admf@t','Administrador',true), ($9,$10,'Dono','dono@t','Diretoria',true)`,
    [ADM, DIR, FIN, COMPRAS, GESTOR, INATIVO, SOL, ADM_FORA, DONO_CONTA, org, outraOrg]);
  const empresa = await um(`insert into radar_company (organization_id, legal_name, commercial_owner_id) values ($1, 'Conta Teste', $2) returning id`, [org, DONO_CONTA]);
  const empresa2 = await um(`insert into radar_company (organization_id, legal_name) values ($1, 'Outra Conta') returning id`, [org]);
  const empresaFora = await um(`insert into radar_company (organization_id, legal_name) values ($1, 'Conta de fora') returning id`, [outraOrg]);
  const novaOpp = async (titulo, stage = 'NEGOTIATION', extra = {}) => um(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value, owner_id, created_by, won_amount, close_reason, stage_reason)
    values ($1, $2, $3, $4, 500000, $5, $5, $6, $7, $7) returning id`, [extra.org ?? org, extra.empresa ?? empresa, titulo, stage, extra.owner ?? ADM, extra.won ?? null, extra.motivo ?? (stage === 'WON' ? 'criada ganha' : null)]);
  const eventos = (opp) => q(`select id, event_type, won_event_id, amount::text, occurred_at, from_stage, to_stage, owner_id, account_owner_id, actor_id, reason, source, organization_id, company_id
    from radar_commercial_outcome where opportunity_id = $1 order by occurred_at`, [opp]);
  const audits = (acao) => um(`select count(*)::int from audit_log where action = $1`, [acao]);
  const ganhar = (uid, opp, valor, motivo = 'contrato assinado') => como(uid, () => q(`update radar_opportunity set stage = 'WON', won_amount = $2, close_reason = $3, stage_reason = $3, closed_at = now(), next_action = null, next_action_at = null where id = $1`, [opp, valor, motivo]));
  const reabrir = (uid, opp, para = 'NEGOTIATION', motivo = 'cliente pediu revisão') => como(uid, () => q(`update radar_opportunity set stage = $2, stage_reason = $3, closed_at = null where id = $1`, [opp, para, motivo]));

  console.log('A. objetos, hardening e permissões');
  const funcs = await q(`select proname, prosecdef, array_to_string(proconfig, ';') c from pg_proc where proname in ('radar_commercial_outcome_coerencia','radar_commercial_outcome_imutavel','radar_opportunity_ganho_travado','radar_opportunity_desfecho','radar_complementar_valor_ganho','radar_desfecho_instante') order by 1`);
  igual('as seis funções (inclusive a guarda temporal) fixam search_path = pg_catalog, pg_temp', funcs.map((f) => [f.proname, f.c]), funcs.map((f) => [f.proname, 'search_path=pg_catalog, pg_temp']).length === 6 ? funcs.map((f) => [f.proname, 'search_path=pg_catalog, pg_temp']) : 'faltam funções');
  igual('só o gatilho dos desfechos e a RPC de complemento são security definer', funcs.filter((f) => f.prosecdef).map((f) => f.proname), ['radar_complementar_valor_ganho', 'radar_opportunity_desfecho']);
  igual('authenticated só lê o livro; anon nada', [await um(`select has_table_privilege('authenticated','public.radar_commercial_outcome','select')`), await um(`select has_table_privilege('authenticated','public.radar_commercial_outcome','insert') or has_table_privilege('authenticated','public.radar_commercial_outcome','update') or has_table_privilege('authenticated','public.radar_commercial_outcome','delete')`), await um(`select has_table_privilege('anon','public.radar_commercial_outcome','select')`)], [true, false, false]);
  igual('RPC de complemento: authenticated executa, anon não', [await um(`select has_function_privilege('authenticated','public.radar_complementar_valor_ganho(uuid, numeric, text)','execute')`), await um(`select has_function_privilege('anon','public.radar_complementar_valor_ganho(uuid, numeric, text)','execute')`)], [true, false]);
  igual('funções de gatilho sem EXECUTE para ninguém (não servem para criar outro gatilho)', await um(`select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['public','anon','authenticated','service_role']) r, unnest(array['public.radar_opportunity_desfecho()','public.radar_opportunity_ganho_travado()','public.radar_commercial_outcome_coerencia()','public.radar_commercial_outcome_imutavel()','public.radar_desfecho_instante(timestamptz, timestamptz)']) f where r <> 'public'`), false);
  igual('service_role também só lê o livro (nenhuma escrita direta, nem do servidor)', [await um(`select has_table_privilege('service_role','public.radar_commercial_outcome','select')`), await um(`select has_table_privilege('service_role','public.radar_commercial_outcome','insert') or has_table_privilege('service_role','public.radar_commercial_outcome','update') or has_table_privilege('service_role','public.radar_commercial_outcome','delete')`)], [true, false]);
  igual('RLS ligada no livro', await um(`select relrowsecurity from pg_class where oid = 'public.radar_commercial_outcome'::regclass`), true);

  console.log('\nB. GANHO ao entrar em WON, com tudo congelado');
  const opp1 = await novaOpp('Galpão A');
  const auditGanhoAntes = await audits('radar_desfecho_ganho');
  const g1 = await ganhar(DIR, opp1, '1250000.50');
  igual('Diretoria marca como ganha (UPDATE real com a política de produção)', g1.erro, null);
  let ev = await eventos(opp1);
  igual('um evento GANHO com o valor fechado confirmado', ev.map((e) => [e.event_type, e.amount]), [['GANHO', '1250000.50']]);
  igual('congela organização, empresa, responsável, dono da conta, autor, estágios e motivo', [ev[0].organization_id, ev[0].company_id, ev[0].owner_id, ev[0].account_owner_id, ev[0].actor_id, ev[0].from_stage, ev[0].to_stage, ev[0].reason, ev[0].source],
    [org, empresa, ADM, DONO_CONTA, DIR, 'NEGOTIATION', 'WON', 'contrato assinado', 'trigger']);
  igual('auditoria do ganho na mesma transação', (await audits('radar_desfecho_ganho')) - auditGanhoAntes, 1);
  igual('o audit_row genérico da oportunidade segue funcionando', (await um(`select count(*)::int from audit_log where entity_type = 'radar_opportunity' and entity_id = $1`, [opp1])) >= 2, true);

  console.log('\nC. WON → WON e reenvio não duplicam');
  igual('editar título e notas de oportunidade ganha é permitido', (await como(ADM, () => q(`update radar_opportunity set title = 'Galpão A (assinado)', notes = 'ok' where id = $1`, [opp1]))).erro, null);
  igual('regravar a linha inteira com o mesmo estágio (reenvio da fila offline) não cria evento', (await como(ADM, () => q(`update radar_opportunity set stage = 'WON', won_amount = 1250000.50, estimated_value = 500000 where id = $1`, [opp1]))).erro, null);
  igual('continua um único GANHO', (await eventos(opp1)).length, 1);

  console.log('\nD. oportunidade ganha travada (corrigir = reabrir com motivo)');
  for (const [campo, set] of [['valor fechado', `won_amount = 1`], ['valor estimado', `estimated_value = 1`], ['empresa', `company_id = '${empresa2}'`], ['responsável', `owner_id = '${DIR}'`], ['data de fechamento', `closed_at = now() - interval '1 day'`]]) {
    await recusa(`ganha: ${campo} não muda`, ADM, `update radar_opportunity set ${set} where id = $1`, [opp1], 'oportunidade ganha não muda');
  }
  await recusa('nem o dono do banco muda o valor de uma ganha', 'DONO', `update radar_opportunity set won_amount = 2 where id = $1`, [opp1], 'oportunidade ganha não muda');

  console.log('\nE. ESTORNO ao reabrir; o ganho continua no livro');
  const g1Id = ev[0].id;
  igual('reabrir uma ganha', (await reabrir(ADM, opp1)).erro, null);
  ev = await eventos(opp1);
  igual('GANHO + ESTORNO_GANHO citando o ganho original', ev.map((e) => [e.event_type, e.won_event_id]), [['GANHO', null], ['ESTORNO_GANHO', g1Id]]);
  igual('estorno congela o mesmo responsável e dono do ganho; sem valor próprio (vale o do ganho)', [ev[1].owner_id, ev[1].account_owner_id, ev[1].amount, ev[1].from_stage, ev[1].to_stage, ev[1].actor_id], [ADM, DONO_CONTA, null, 'WON', 'NEGOTIATION', ADM]);
  igual('o motivo da reabertura está no estorno e na auditoria do estorno', [ev[1].reason, await um(`select reason from audit_log where action = 'radar_desfecho_estorno' and entity_id = $1`, [ev[1].id])], ['cliente pediu revisão', 'cliente pediu revisão']);
  igual('ao sair de WON o valor fechado da oportunidade é limpo (fica no livro)', await um(`select won_amount from radar_opportunity where id = $1`, [opp1]), null);

  console.log('\nF. novo ganho depois de reabrir; LOST também estorna');
  igual('ganhar de novo', (await ganhar(ADM, opp1, '1300000.00', 'aditivo')).erro, null);
  ev = await eventos(opp1);
  igual('GANHO, ESTORNO, GANHO — o segundo é o vigente', ev.map((e) => [e.event_type, e.amount]), [['GANHO', '1250000.50'], ['ESTORNO_GANHO', null], ['GANHO', '1300000.00']]);
  const g2Id = ev[2].id;
  igual('ganha → perdida estorna o ganho vigente', (await como(ADM, () => q(`update radar_opportunity set stage = 'LOST', close_reason = 'cancelado pelo cliente', stage_reason = 'cancelado pelo cliente' where id = $1`, [opp1]))).erro, null);
  ev = await eventos(opp1);
  igual('estorno do segundo ganho', [ev.length, ev[3].event_type, ev[3].won_event_id, ev[3].to_stage], [4, 'ESTORNO_GANHO', g2Id, 'LOST']);
  igual('um estorno por ganho (índice único)', await um(`select count(*)::int from radar_commercial_outcome where won_event_id = $1 and event_type = 'ESTORNO_GANHO'`, [g1Id]), 1);

  console.log('\nG. criação já ganha');
  const opp2 = await como(ADM, () => um(`insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by, won_amount, close_reason, stage_reason, closed_at) values ($1, $2, 'Nasce ganha', 'WON', $3, $3, 880000, 'fechado na criação', 'fechado na criação', now()) returning id`, [org, empresa, ADM]));
  igual('INSERT já como WON pelo authenticated', opp2.erro, null);
  ev = await eventos(opp2.valor);
  igual('GANHO sem estágio de origem', ev.map((e) => [e.event_type, e.amount, e.from_stage, e.to_stage]), [['GANHO', '880000.00', null, 'WON']]);

  console.log('\nH. ganho sem valor e complemento governado');
  const opp3 = await novaOpp('Sem valor');
  await ganhar(ADM, opp3, null, 'ganho sem valor confirmado');
  ev = await eventos(opp3);
  igual('GANHO sem valor (incompleto, sinalizado)', ev.map((e) => [e.event_type, e.amount]), [['GANHO', null]]);
  const g3 = ev[0].id;
  const RPC = `select radar_complementar_valor_ganho($1::uuid, $2::numeric, $3) r`;
  await recusa('sem sessão não complementa', null, RPC, [g3, 1000, 'motivo válido'], 'sessão não autenticada');
  await recusa('perfil inativo não complementa', INATIVO, RPC, [g3, 1000, 'motivo válido'], 'sem perfil ativo');
  for (const [nome, uid] of [['Financeiro', FIN], ['Compras', COMPRAS], ['Gestor de obra', GESTOR], ['Solicitante', SOL]]) await recusa(`${nome} não complementa`, uid, RPC, [g3, 1000, 'motivo válido'], nome === 'Solicitante' ? '' : 'sem permissão');
  await recusa('motivo curto', ADM, RPC, [g3, 1000, 'x'], 'motivo');
  for (const [nome, v] of [['zero', 0], ['negativo', -1], ['três casas', 10.001], ['acima do teto', 1000000000000.01]]) await recusa(`valor ${nome}`, ADM, RPC, [g3, v, 'motivo válido'], 'valor');
  await recusa('ganho inexistente', ADM, RPC, ['00000000-0000-4000-8000-000000000000', 1000, 'motivo válido'], 'não encontrado');
  await recusa('estorno não é ganho', ADM, RPC, [await um(`select id from radar_commercial_outcome where event_type = 'ESTORNO_GANHO' limit 1`), 1000, 'motivo válido'], 'não encontrado');
  await recusa('Administrador de outra organização não vê o ganho', ADM_FORA, RPC, [g3, 1000, 'motivo válido'], 'não encontrado');
  await recusa('ganho que já tem valor', ADM, RPC, [g2Id, 1000, 'motivo válido'], 'já tem valor');
  const auditCompAntes = await audits('radar_complementar_valor_ganho');
  const c1 = await como(DIR, () => um(RPC, [g3, '450000.75', 'valor confirmado na NF']));
  igual('Diretoria complementa', [c1.erro, Number(c1.valor?.valor)], [null, 450000.75]);
  ev = await eventos(opp3);
  igual('COMPLEMENTO_VALOR cita o ganho, com valor, motivo, autor e fonte rpc', ev.map((e) => [e.event_type, e.won_event_id, e.amount, e.reason, e.actor_id, e.source]), [['GANHO', null, null, 'ganho sem valor confirmado', ADM, 'trigger'], ['COMPLEMENTO_VALOR', g3, '450000.75', 'valor confirmado na NF', DIR, 'rpc']]);
  igual('auditoria do complemento', (await audits('radar_complementar_valor_ganho')) - auditCompAntes, 1);
  await recusa('segundo complemento recusado', ADM, RPC, [g3, 1, 'de novo'], 'já foi complementado');
  await recusa('índice único também barra um segundo complemento direto (dono do banco)', 'DONO', `insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, amount, reason, source) values ($1,$2,$3,'COMPLEMENTO_VALOR',$4,1,'direto','rpc')`, [org, opp3, empresa, g3], 'complemento_unico');

  console.log('\nI. atomicidade: evento que falha desfaz a mudança de estágio');
  await db.exec(`create function pg_temp_falha() returns trigger language plpgsql as $f$ begin if new.reason = 'falha-simulada' then raise exception 'falha simulada no livro'; end if; return new; end $f$;
    create trigger zz_falha before insert on radar_commercial_outcome for each row execute function pg_temp_falha();`);
  const opp4 = await novaOpp('Atomicidade');
  const r4 = await ganhar(ADM, opp4, 1000, 'falha-simulada');
  igual('a mudança para WON falha junto com o evento', [!!r4.erro && r4.erro.includes('falha simulada'), await um(`select stage from radar_opportunity where id = $1`, [opp4]), (await eventos(opp4)).length], [true, 'NEGOTIATION', 0]);
  await db.exec(`drop trigger zz_falha on radar_commercial_outcome; drop function pg_temp_falha();`);

  console.log('\nJ. livro imutável e escrita direta negada');
  await recusa('UPDATE no livro (dono do banco)', 'DONO', `update radar_commercial_outcome set amount = 1 where id = $1`, [g2Id], 'imutável');
  await recusa('DELETE no livro (dono do banco)', 'DONO', `delete from radar_commercial_outcome where id = $1`, [g2Id], 'imutável');
  await recusa('TRUNCATE no livro (dono do banco)', 'DONO', `truncate radar_commercial_outcome`, [], 'imutável');
  await recusa('INSERT direto como authenticated', ADM, `insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, source) values ($1,$2,$3,'GANHO','trigger')`, [org, opp3, empresa], 'permission denied');
  await recusa('UPDATE direto como authenticated', ADM, `update radar_commercial_outcome set amount = 1`, [], 'permission denied');
  await recusa('GANHO direto com ganho vigente (dono do banco)', 'DONO', `insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, source) values ($1,$2,$3,'GANHO','trigger')`, [org, opp2.valor, empresa], 'ganho vigente');
  await recusa('estorno citando ganho de outra oportunidade (dono do banco)', 'DONO', `insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, source) values ($1,$2,$3,'ESTORNO_GANHO',$4,'trigger')`, [org, opp3, empresa, g2Id], 'ganho original');

  console.log('\nK. isolamento por organização e Solicitante');
  const daEiff = await como(ADM, () => um(`select count(*)::int from radar_commercial_outcome`));
  const deFora = await como(ADM_FORA, () => um(`select count(*)::int from radar_commercial_outcome`));
  const doSol = await como(SOL, () => um(`select count(*)::int from radar_commercial_outcome`));
  igual('EIFF lê os seus; outra organização lê 0; Solicitante lê 0', [daEiff.valor > 0, deFora.valor, doSol.valor ?? 0], [true, 0, 0]);
  const oppFora = await novaOpp('De fora', 'NEGOTIATION', { org: outraOrg, empresa: empresaFora, owner: ADM_FORA });
  igual('ganho na outra organização fica nela', (await ganhar(ADM_FORA, oppFora, 10)).erro, null);
  igual('…e a EIFF continua sem ver', (await como(ADM, () => um(`select count(*)::int from radar_commercial_outcome where organization_id = $1`, [outraOrg]))).valor, 0);
  const alheia = await como(ADM, () => q(`update radar_opportunity set stage = 'LOST', stage_reason = 'tentativa alheia' where id = $1 returning id`, [oppFora]));
  igual('Administrador da EIFF não alcança oportunidade de outra organização (RLS: 0 linhas) e nada é estornado', [alheia.valor?.length ?? alheia.erro, await um(`select stage from radar_opportunity where id = $1`, [oppFora]), await um(`select count(*)::int from radar_commercial_outcome where opportunity_id = $1`, [oppFora])], [0, 'WON', 1]);

  console.log('\nL. valor fechado só em oportunidade ganha');
  const opp5 = await novaOpp('Valor em aberta');
  await como(ADM, () => q(`update radar_opportunity set won_amount = 999 where id = $1`, [opp5]));
  igual('won_amount em oportunidade aberta é descartado pelo banco', await um(`select won_amount from radar_opportunity where id = $1`, [opp5]), null);
  await recusa('won_amount zero recusado', ADM, `update radar_opportunity set stage = 'WON', won_amount = 0, close_reason = 'x', stage_reason = 'motivo válido' where id = $1`, [opp5], 'won_amount_valido');
  await recusa('won_amount acima do teto recusado', ADM, `update radar_opportunity set stage = 'WON', won_amount = 1000000000000.01, close_reason = 'x', stage_reason = 'motivo válido' where id = $1`, [opp5], '');
  igual('…e nenhum evento ficou', (await eventos(opp5)).length, 0);

  console.log('\nM. oportunidade com eventos não é apagada');
  await recusa('apagar oportunidade com livro', ADM, `delete from radar_opportunity where id = $1`, [opp3], 'foreign key');
  igual('oportunidade sem eventos ainda pode ser apagada', (await como(ADM, () => q(`delete from radar_opportunity where id = $1`, [opp5]))).erro, null);

  console.log('\nN. search_path seguro: tabelas temporárias de mesmo nome não desviam nada');
  const opp6 = await novaOpp('Sombra');
  await db.exec(`create temp table profile (id uuid, organization_id uuid, name text, role public.role_kind, active boolean);
    create temp table radar_commercial_outcome (like public.radar_commercial_outcome);
    create temp table audit_log (like public.audit_log including defaults);
    create temp table radar_company (like public.radar_company);`);
  await q(`insert into pg_temp.profile values ($1, $2, 'Sombra', 'Administrador', true)`, [COMPRAS, org]);
  // a mudança de estágio roda como dono do banco: as funções auxiliares antigas (current_org/has_role, 0003) não fixam
  // search_path e a sombra de profile afetaria a RLS — achado fora da E3, registrado no PR. Aqui o alvo é o gatilho.
  await q(`update radar_opportunity set stage = 'WON', close_reason = 'sem valor', stage_reason = 'sem valor', closed_at = now() where id = $1`, [opp6]);
  const g6 = (await q(`select id from public.radar_commercial_outcome where opportunity_id = $1`, [opp6]))[0].id;
  await recusa('perfil falso em tabela temporária não deixa o Compras complementar', COMPRAS, RPC, [g6, 10, 'tentativa'], 'sem permissão');
  igual('o gatilho da 0070 gravou no livro e na auditoria reais, nada nas temporárias; o dono da conta veio da radar_company real', [await um(`select count(*)::int from public.radar_commercial_outcome where opportunity_id = $1`, [opp6]), await um(`select account_owner_id from public.radar_commercial_outcome where opportunity_id = $1`, [opp6]), await um(`select count(*)::int from public.audit_log where action = 'radar_desfecho_ganho' and entity_id = $1`, [g6]), await um(`select count(*)::int from pg_temp.radar_commercial_outcome`), await um(`select count(*)::int from pg_temp.audit_log where action like 'radar_desfecho%'`)], [1, DONO_CONTA, 1, 0, 0]);
  // achado fora da E3: o audit_row() genérico (0001, security definer sem search_path) escreve no audit_log temporário
  const legado = await um(`select count(*)::int from pg_temp.audit_log where entity_type = 'radar_opportunity'`);
  console.log(`  nota  audit_row() legado (0001) gravou ${legado} linha(s) no audit_log temporário — achado registrado no PR, fora da 0070`);
  await db.exec(`drop table pg_temp.profile, pg_temp.radar_commercial_outcome, pg_temp.audit_log, pg_temp.radar_company;`);

  console.log('\nO. o contrato EventoDesfecho do motor E1 sai do livro sem tradução de regra');
  const livro = await q(`select id, event_type tipo, opportunity_id, company_id, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ocorrido, amount::text valor, won_event_id, owner_id, account_owner_id, reason, actor_id from radar_commercial_outcome where organization_id = $1 order by occurred_at`, [org]);
  igual('todo evento tem tipo do catálogo, instante com fuso e referência coerente', livro.every((e) => ['GANHO', 'ESTORNO_GANHO', 'COMPLEMENTO_VALOR'].includes(e.tipo) && /Z$/.test(e.ocorrido) && ((e.tipo === 'GANHO') === (e.won_event_id === null))), true);

  console.log('\nQ. hardening pré-merge: responsável, motivo obrigatório, gatilho privilegiado, ordem no tempo');
  // Q1 responsável travado inclusive de vazio para alguém
  const oppSemDono = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by, stage_reason, close_reason, closed_at) values ($1, $2, 'Ganha sem responsável', 'WON', null, $3, 'ganha sem responsável', 'ganha sem responsável', now()) returning id`, [org, empresa, ADM]);
  await recusa('ganha: responsável não muda nem de vazio para alguém', ADM, `update radar_opportunity set owner_id = $2 where id = $1`, [oppSemDono, ADM], 'oportunidade ganha não muda');
  // Q2 motivo obrigatório e NOVO para sair de WON (escrita direta)
  const oppMot = await novaOpp('Motivo obrigatório');
  await ganhar(ADM, oppMot, 100, 'ganho inicial');
  const nEventos = (await eventos(oppMot)).length;
  await recusa('reabrir só trocando o estágio (motivo antigo reaproveitado) é recusado', ADM, `update radar_opportunity set stage = 'NEGOTIATION' where id = $1`, [oppMot], 'motivo desta mudança');
  await recusa('reabrir repetindo o motivo anterior é recusado', ADM, `update radar_opportunity set stage = 'NEGOTIATION', stage_reason = 'ganho inicial' where id = $1`, [oppMot], 'motivo desta mudança');
  await recusa('reabrir com motivo vazio é recusado', ADM, `update radar_opportunity set stage = 'NEGOTIATION', stage_reason = '  ' where id = $1`, [oppMot], 'informe o motivo');
  await recusa('nem o dono do banco reabre sem motivo novo', 'DONO', `update radar_opportunity set stage = 'LOST' where id = $1`, [oppMot], 'motivo desta mudança');
  igual('…e nada mudou: continua ganha, sem estorno', [await um(`select stage from radar_opportunity where id = $1`, [oppMot]), (await eventos(oppMot)).length], ['WON', nEventos]);
  igual('fora de uma transição o motivo não é editável (escrita direta é ignorada)', [(await como(ADM, () => q(`update radar_opportunity set stage_reason = 'reescrito' where id = $1`, [oppMot]))).erro, await um(`select stage_reason from radar_opportunity where id = $1`, [oppMot])], [null, 'ganho inicial']);
  const oppSem = await novaOpp('Ganha sem motivo');
  await recusa('marcar como ganha sem motivo é recusado', ADM, `update radar_opportunity set stage = 'WON' where id = $1`, [oppSem], 'informe o motivo');
  await recusa('criar já ganha sem motivo é recusado', ADM, `insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by) values ($1, $2, 'Sem motivo', 'WON', $3, $3)`, [org, empresa, ADM], 'informe o motivo');
  igual('…e nenhum ganho foi gravado', (await eventos(oppSem)).length, 0);
  // Q3 gatilho privilegiado não serve fora da tabela real
  const forjar = await como(ADM, async () => { await q(`create temp table radar_opportunity (like public.radar_opportunity)`); await q(`create trigger zz_forja after insert on pg_temp.radar_opportunity for each row execute function public.radar_opportunity_desfecho()`); });
  igual('authenticated não cria gatilho com a função privilegiada (sem EXECUTE)', /permission denied/.test(forjar.erro ?? ''), true);
  const forjar2 = await como(ADM, async () => { await q(`create temp table radar_opportunity (like public.radar_opportunity)`); await q(`create trigger zz_forja before insert on pg_temp.radar_opportunity for each row execute function public.radar_opportunity_ganho_travado()`); });
  igual('nem com a função da trava', /permission denied/.test(forjar2.erro ?? ''), true);
  const livroAntes = await um(`select count(*)::int from public.radar_commercial_outcome`);
  await db.exec(`create temp table radar_opportunity (like public.radar_opportunity); create trigger zz_forja after insert on pg_temp.radar_opportunity for each row execute function public.radar_opportunity_desfecho();`);
  await recusa('mesmo criado pelo dono do banco, o gatilho numa tabela de mesmo formato é recusado', 'DONO', `insert into pg_temp.radar_opportunity (id, organization_id, company_id, title, stage, probability, version, created_at, updated_at, stage_reason) values ($1, $2, $3, 'forjada', 'WON', 1, 1, now(), now(), 'forjando')`, [oppMot, org, empresa], 'gatilho fora da tabela');
  await db.exec(`drop table pg_temp.radar_opportunity;`);
  igual('nenhuma inserção indevida no livro', await um(`select count(*)::int from public.radar_commercial_outcome`), livroAntes);
  { const n = 'spsr'; await db.exec('savepoint ' + n + '; set local role service_role;'); let erro = null; try { await q('insert into public.radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, reason, source) values ($1, $2, $3, ' + "'GANHO', 'forjado', 'rpc')", [org, oppSem, empresa]); } catch (e) { erro = so(e); } await db.exec('rollback to savepoint ' + n + '; reset role;');
    igual('service_role não insere no livro', /permission denied/.test(erro ?? 'ACEITO'), true); }
  // Q4 ordem no tempo: GANHO → ESTORNO → GANHO na MESMA transação saem com instantes estritamente crescentes (microssegundos)
  const oppT = await novaOpp('Ordem no tempo');
  await ganhar(ADM, oppT, 10, 'ganho 1');
  await reabrir(ADM, oppT, 'NEGOTIATION', 'reabertura 1');
  await ganhar(ADM, oppT, 20, 'ganho 2');
  const tempos = await q(`select event_type, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') t from radar_commercial_outcome where opportunity_id = $1 order by occurred_at`, [oppT]);
  igual('na mesma transação: GANHO, ESTORNO, GANHO com instantes estritamente crescentes (µs)', [tempos.map((x) => x.event_type), tempos.every((x, i) => i === 0 || x.t > tempos[i - 1].t)], [['GANHO', 'ESTORNO_GANHO', 'GANHO'], true]);

  console.log('\nR. isolamento entre organizações: empresa e responsável da mesma organização da oportunidade');
  // a FK de company_id/owner_id não confere organização e o PostgreSQL valida FK sem RLS: sem a 0070 isto passava
  await q(`update radar_company set commercial_owner_id = $2 where id = $1`, [empresaFora, ADM_FORA]);
  const livroAntesR = await um(`select count(*)::int from radar_commercial_outcome`);
  igual('Administrador de A não enxerga a empresa de B (RLS)', (await como(ADM, () => um(`select count(*)::int from radar_company where id = $1`, [empresaFora]))).valor, 0);
  await recusa('criar oportunidade de A citando empresa de B', ADM, `insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by) values ($1, $2, 'Cruzada', 'NEGOTIATION', $3, $3)`, [org, empresaFora, ADM], 'empresa precisa ser da mesma organização');
  const oppR = await novaOpp('Própria de A');
  await recusa('trocar a empresa de uma oportunidade de A para a de B', ADM, `update radar_opportunity set company_id = $2 where id = $1`, [oppR, empresaFora], 'empresa precisa ser da mesma organização');
  igual('…e a oportunidade continua com a empresa de A', await um(`select company_id from radar_opportunity where id = $1`, [oppR]), empresa);
  await recusa('registrar GANHO numa oportunidade cruzada (criação já ganha com empresa de B)', ADM, `insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by, stage_reason) values ($1, $2, 'Cruzada ganha', 'WON', $3, $3, 'ganho cruzado')`, [org, empresaFora, ADM], 'empresa precisa ser da mesma organização');
  await recusa('responsável de outra organização na criação', ADM, `insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by) values ($1, $2, 'Responsável de B', 'NEGOTIATION', $3, $4)`, [org, empresa, ADM_FORA, ADM], 'responsável precisa ser da mesma organização');
  await recusa('trocar o responsável para alguém de outra organização', ADM, `update radar_opportunity set owner_id = $2 where id = $1`, [oppR, ADM_FORA], 'responsável precisa ser da mesma organização');
  await recusa('GANHO com responsável de outra organização', ADM, `update radar_opportunity set stage = 'WON', owner_id = $2, stage_reason = 'ganho com responsável de fora' where id = $1`, [oppR, ADM_FORA], 'responsável precisa ser da mesma organização');
  await recusa('nem o dono do banco cria oportunidade cruzada', 'DONO', `insert into radar_opportunity (organization_id, company_id, title, stage, owner_id, created_by, stage_reason) values ($1, $2, 'Cruzada pelo dono', 'WON', $3, $3, 'forçando')`, [org, empresaFora, ADM], 'empresa precisa ser da mesma organização');
  await recusa('defesa no livro: GANHO com dono da conta de outra organização (dono do banco, direto)', 'DONO', `insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, owner_id, account_owner_id, reason, source) values ($1, $2, $3, 'GANHO', $4, $5, 'forjado', 'trigger')`, [org, oppR, empresa, ADM, ADM_FORA], 'organização do evento');
  igual('o gatilho não leu o dono comercial de B nem gravou nada cruzado', [await um(`select count(*)::int from radar_commercial_outcome`) - livroAntesR, await um(`select count(*)::int from radar_commercial_outcome where organization_id = $1 and (company_id = $2 or account_owner_id = $3 or owner_id = $3)`, [org, empresaFora, ADM_FORA])], [0, 0]);
  igual('ganho legítimo em A continua funcionando e congela o dono de A', [(await ganhar(ADM, oppR, 10, 'ganho legítimo')).erro, await um(`select account_owner_id from radar_commercial_outcome where opportunity_id = $1`, [oppR])], [null, DONO_CONTA]);

  console.log('\nT. guarda temporal: instante estritamente crescente por oportunidade, sem mudar o mês comercial');
  const inst = async (relogio, ultimo) => { const n = 'spt' + (++sp); await db.exec('savepoint ' + n + ';'); try { const v = await um(`select to_char(public.radar_desfecho_instante($1::timestamptz, $2::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') r`, [relogio, ultimo]); await db.exec('release savepoint ' + n + ';'); return v; } catch (e) { await db.exec('rollback to savepoint ' + n + ';'); return 'RECUSA: ' + so(e); } };
  igual('sem evento anterior: vale o relógio', await inst('2026-10-14T15:00:00.000005Z', null), '2026-10-14T15:00:00.000005');
  igual('relógio à frente do último: vale o relógio', await inst('2026-10-14T15:00:00.000005Z', '2026-10-14T15:00:00.000004Z'), '2026-10-14T15:00:00.000005');
  igual('empate no microssegundo: último + 1 µs', await inst('2026-10-14T15:00:00.000004Z', '2026-10-14T15:00:00.000004Z'), '2026-10-14T15:00:00.000005');
  igual('relógio 300 ms atrás (regressão imaterial): último + 1 µs', await inst('2026-10-14T15:00:00.000000Z', '2026-10-14T15:00:00.300000Z'), '2026-10-14T15:00:00.300001');
  igual('relógio exatamente 1 s atrás: ainda imaterial', await inst('2026-10-14T15:00:00.000000Z', '2026-10-14T15:00:01.000000Z'), '2026-10-14T15:00:01.000001');
  igual('relógio 1 s + 1 µs atrás (regressão material): recusa explícita', (await inst('2026-10-14T15:00:00.000000Z', '2026-10-14T15:00:01.000001Z')).startsWith('RECUSA: desfecho: o relógio do banco está'), true);
  igual('relógio 10 min atrás: recusa', (await inst('2026-10-14T15:00:00Z', '2026-10-14T15:10:00Z')).startsWith('RECUSA'), true);
  igual('virada do mês em São Paulo: deslocar 1 µs levaria outubro para novembro → recusa', await inst('2026-10-31T23:59:59.900000-03:00', '2026-10-31T23:59:59.999999-03:00'), 'RECUSA: desfecho: ordenar este evento depois do último o levaria para outro mês comercial; nada foi gravado (tente de novo em instantes)');
  igual('virada do mês em UTC não é virada em São Paulo (21h do dia 31): aceita com último + 1 µs', await inst('2026-10-31T23:59:59.900000Z', '2026-10-31T23:59:59.999999Z'), '2026-11-01T00:00:00.000000');
  igual('relógio que já virou o mês em São Paulo, à frente do último: vale o relógio (novembro)', await inst('2026-11-01T00:00:00.000001-03:00', '2026-10-31T23:59:59.999999-03:00'), '2026-11-01T03:00:00.000001');
  // integração: um evento gravado com o relógio ADIANTADO (simulado deslocando a linha com os gatilhos desligados, só no teste)
  const adiantar = async (opp, intervalo) => { await db.exec('savepoint adiantar; set local session_replication_role = replica;'); await q(`update radar_commercial_outcome set occurred_at = occurred_at + $2::interval where opportunity_id = $1`, [opp, intervalo]); await db.exec('set local session_replication_role = origin; release savepoint adiantar;'); };
  const oppG = await novaOpp('Guarda imaterial'); await ganhar(ADM, oppG, 100, 'ganho com relógio adiantado'); await adiantar(oppG, '300 milliseconds');
  igual('estorno com o relógio 300 ms atrás do ganho: aceito, 1 µs depois do ganho', [(await reabrir(ADM, oppG, 'NEGOTIATION', 'reabre com relógio atrasado')).erro, await um(`select (select occurred_at from radar_commercial_outcome where opportunity_id = $1 and event_type = 'ESTORNO_GANHO') - (select occurred_at from radar_commercial_outcome where opportunity_id = $1 and event_type = 'GANHO')`, [oppG])], [null, '00:00:00.000001']);
  const oppM = await novaOpp('Guarda material'); await ganhar(ADM, oppM, 100, 'ganho antes da regressão'); await adiantar(oppM, '10 minutes');
  const rM = await reabrir(ADM, oppM, 'NEGOTIATION', 'reabre com relógio muito atrasado');
  igual('estorno com o relógio 10 min atrás: recusado, continua WON, nenhum estorno nem auditoria', [/relógio do banco está/.test(rM.erro ?? ''), await um(`select stage from radar_opportunity where id = $1`, [oppM]), await um(`select count(*)::int from radar_commercial_outcome where opportunity_id = $1`, [oppM]), await um(`select count(*)::int from audit_log where action = 'radar_desfecho_estorno' and after_data ->> 'oportunidade' = $1`, [oppM])], [true, 'WON', 1, 0]);
  const oppC = await novaOpp('Guarda complemento'); await ganhar(ADM, oppC, null, 'ganho sem valor com relógio adiantado'); const gC = await um(`select id from radar_commercial_outcome where opportunity_id = $1`, [oppC]);
  await adiantar(oppC, '10 minutes');
  igual('complemento com o relógio 10 min atrás: recusado', /relógio do banco está/.test((await como(ADM, () => q(`select radar_complementar_valor_ganho($1::uuid, 5, 'complemento atrasado')`, [gC]))).erro ?? ''), true);
  await adiantar(oppC, '-599.7 seconds');
  igual('complemento com o relógio 300 ms atrás: aceito, 1 µs depois do ganho', [(await como(ADM, () => q(`select radar_complementar_valor_ganho($1::uuid, 5, 'complemento ok')`, [gC]))).erro, await um(`select (select occurred_at from radar_commercial_outcome where opportunity_id = $1 and event_type = 'COMPLEMENTO_VALOR') - (select occurred_at from radar_commercial_outcome where id = $2)`, [oppC, gC])], [null, '00:00:00.000001']);
  igual('o instante informado no INSERT é ignorado: a guarda decide (dono do banco tentando datar no passado)', await (async () => { const o = await novaOpp('Guarda informado'); await ganhar(ADM, o, null, 'ganho para complemento'); const g = await um(`select id from radar_commercial_outcome where opportunity_id = $1`, [o]); await q(`insert into radar_commercial_outcome (organization_id, opportunity_id, company_id, event_type, won_event_id, amount, occurred_at, reason, source) values ($1, $2, $3, 'COMPLEMENTO_VALOR', $4, 1, '2020-01-01T00:00:00Z', 'datado no passado', 'rpc')`, [org, o, empresa, g]); return um(`select occurred_at > (select occurred_at from radar_commercial_outcome where id = $1) from radar_commercial_outcome where won_event_id = $1`, [g]); })(), true);

  await db.exec('rollback;');

  console.log('\nP. rollback EXATO da 0070');
  await db.exec('begin;');
  await db.exec(ROLLBACK);
  const depois = await schemaOportunidade();
  igual('radar_opportunity volta ao schema de antes da 0070 (colunas, restrições, gatilhos e permissões)', depois, antes0070);
  igual('nenhum objeto da 0070 sobra', await um(`select to_regclass('public.radar_commercial_outcome') is null and not exists (select 1 from pg_proc where proname in ('radar_commercial_outcome_coerencia','radar_commercial_outcome_imutavel','radar_opportunity_ganho_travado','radar_opportunity_desfecho','radar_complementar_valor_ganho','radar_desfecho_instante'))`), true);
  await db.exec('rollback;');
} catch (e) {
  quebrou('execução', so(e));
}
console.log(`\n${ok} ok, ${falhou} falha(s)`);
console.log(JSON.stringify({ smoke: 'cd-d3-desfechos', ok, falhou }));
process.exit(falhou ? 1 : 0);

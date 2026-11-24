// Gera o SQL EXATO da aplicacao da migration 0076 (chave central do e-mail comercial) em producao: a migration, sem
// nenhuma alteracao, dentro de UMA transacao, com conferencias ANTES (aborta se o banco nao estiver como esperado) e
// DEPOIS (aborta e desfaz tudo se o resultado nao for o esperado ou se algum dado preexistente tiver mudado).
//
// Este script NAO aplica nada e nao fala com banco nenhum: so escreve os arquivos e imprime o SHA-256.
//   node scripts/email-0076/envelope.mjs -> scratch/0076-envelope.sql        (o que se aplica, so com «APLICAÇÃO 0076 AUTORIZADA»)
//                                        -> scratch/0076-ensaio-conclui.sql  (ensaio SEM a migration: pre-checks e ROLLBACK)
//                                        -> scratch/0076-ensaio-recusa.sql   (ensaio SEM a migration: erro proposital)
//                                        -> scratch/0076-recuperacao.sql     (retorno: recria create/transition da 0075)
// Os ensaios e a recuperacao sao provados em PGlite por src/core/inbox/email0076Envelope.test.ts.
// Roteiro: docs/email-comercial-chave-central.md
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = new URL('../../supabase/migrations/0076_inbox_email_switch.sql', import.meta.url);
const MIGRATION_0075 = new URL('../../supabase/migrations/0075_inbox_email_delivery.sql', import.meta.url);
const lf = (t) => t.replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Retrato dos dados que NADA pode mudar (o livro, o historico do livro, mensagens e conversas). */
const RETRATO_DADOS = `select
  (select count(*) from inbox_email_delivery) as entregas, (select count(*) from inbox_email_delivery_event) as eventos_entrega,
  (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(reason, '') || '|' || coalesce(provider_message_id, '') || '|' || coalesce(accepted_at::text, ''), ',' order by id), '')) from inbox_email_delivery) as impressao_livro,
  (select md5(coalesce(string_agg(id::text || '|' || coalesce(from_status, '') || '|' || to_status || '|' || occurred_at::text, ',' order by id), '')) from inbox_email_delivery_event) as impressao_eventos,
  (select count(*) from inbox_message) as mensagens, (select count(*) from inbox_thread) as conversas,
  (select md5(coalesce(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id), '')) from inbox_message) as impressao_mensagens,
  (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(sla_first_response_at::text, '') || '|' || coalesce(sla_first_response_due::text, ''), ',' order by id), '')) from inbox_thread) as impressao_conversas`;

const ANTES = `-- ═══ ENVELOPE DE APLICACAO DA 0076 (gerado por scripts/email-0076/envelope.mjs) ═══
begin;
set local lock_timeout = '5s';        -- nao espera lock: se o livro estiver ocupado, falha e nada muda
set local statement_timeout = '60s';

create temp table _pre_0076 on commit drop as ${RETRATO_DADOS};

do $pre$
declare v text;
begin
  if to_regclass('public.inbox_email_switch') is not null or to_regclass('public.inbox_email_switch_event') is not null then
    raise exception 'PRE-CHECK: a 0076 ja parece aplicada (a chave existe). Nada foi feito.';
  end if;
  if to_regclass('public.inbox_email_delivery') is null or to_regclass('public.inbox_email_delivery_event') is null then
    raise exception 'PRE-CHECK: a 0075 (livro de entregas) nao esta aplicada.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') <> 8 then
    raise exception 'PRE-CHECK: numero de funcoes inbox_email_* diferente de 8 (estado da 0075).';
  end if;
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'inbox_email_delivery_reason_check' and conrelid = 'public.inbox_email_delivery'::regclass;
  if v is null or v !~ 'declarado_encontrado' or v ~ 'envio_bloqueado' then
    raise exception 'PRE-CHECK: constraint de motivo do livro diferente da esperada: %', coalesce(v, '(ausente)');
  end if;
  if exists (select 1 from inbox_email_delivery where status in ('READY', 'REQUESTED')) then
    raise exception 'PRE-CHECK: ha entrega READY ou REQUESTED (envio em curso). Aplicar so com o livro parado.';
  end if;
  if to_regprocedure('public.current_org()') is null or to_regprocedure('public.has_role(role_kind[])') is null then
    raise exception 'PRE-CHECK: falta current_org() ou has_role(role_kind[]).';
  end if;
end $pre$;

-- ═══ MIGRATION 0076, SEM ALTERACAO ═══
`;

const DEPOIS = `
-- ═══ CONFERENCIAS FINAIS: qualquer falha aqui desfaz TUDO (a transacao ainda nao foi confirmada) ═══
do $pos$
declare v text; a record; d record;
begin
  if (select count(*) from pg_tables where schemaname = 'public' and tablename in ('inbox_email_switch', 'inbox_email_switch_event')) <> 2 then
    raise exception 'POS-CHECK: as duas tabelas da chave nao foram criadas.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') <> 15 then
    raise exception 'POS-CHECK: numero de funcoes inbox_email_* diferente de 15.';
  end if;
  if (select count(*) from organization) <> (select count(*) from inbox_email_switch) or exists (select 1 from inbox_email_switch where enabled) then
    raise exception 'POS-CHECK: toda organizacao tem de ter a chave, e DESLIGADA.';
  end if;
  if (select count(*) from inbox_email_switch_event) <> (select count(*) from organization) then
    raise exception 'POS-CHECK: cada organizacao deveria ter exatamente um evento de origem.';
  end if;
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'inbox_email_delivery_reason_check' and conrelid = 'public.inbox_email_delivery'::regclass and convalidated;
  if v is null or v !~ 'envio_bloqueado' or v !~ 'declarado_encontrado' then
    raise exception 'POS-CHECK: constraint de motivo nao ficou como esperado: %', coalesce(v, '(ausente ou nao validada)');
  end if;
  if (select prosrc from pg_proc where proname = 'inbox_email_delivery_create') !~ 'inbox_email_envio_liberado'
     or (select prosrc from pg_proc where proname = 'inbox_email_delivery_transition') !~ 'inbox_email_envio_liberado' then
    raise exception 'POS-CHECK: create/transition nao conferem a chave.';
  end if;
  if has_function_privilege('authenticated', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'inbox_email_delivery_transition(uuid, text, uuid, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute')
     or not has_function_privilege('service_role', 'inbox_email_delivery_transition(uuid, text, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'inbox_email_envio_liberado(uuid)', 'execute')
     or has_function_privilege('service_role', 'inbox_email_envio_liberado(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'inbox_email_switch_set(boolean, text)', 'execute')
     or has_function_privilege('anon', 'inbox_email_switch_set(boolean, text)', 'execute')
     or has_function_privilege('authenticated', 'inbox_email_switch_desligar_sistema(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'inbox_email_switch_desligar_sistema(uuid, text)', 'execute') then
    raise exception 'POS-CHECK: privilegios das funcoes fora do esperado.';
  end if;
  if has_table_privilege('authenticated', 'inbox_email_switch', 'insert') or has_table_privilege('authenticated', 'inbox_email_switch', 'update')
     or has_table_privilege('authenticated', 'inbox_email_switch_event', 'insert') or has_table_privilege('anon', 'inbox_email_switch', 'select')
     or not has_table_privilege('authenticated', 'inbox_email_switch', 'select') then
    raise exception 'POS-CHECK: privilegios das tabelas da chave fora do esperado (navegador so le).';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.inbox_email_switch'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.inbox_email_switch_event'::regclass) then
    raise exception 'POS-CHECK: RLS desligada na chave.';
  end if;
  select * into a from _pre_0076;
  ${RETRATO_DADOS.replace(/\n/g, '\n  ')}
    into d;
  if a is distinct from d then
    raise exception 'POS-CHECK: dados preexistentes (livro, mensagens, conversas) mudaram. Antes: %  Depois: %', a, d;
  end if;
end $pos$;

commit;

-- resultado (somente leitura, ja fora da transacao)
select 'APLICADA' as migration_0076,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') as funcoes,
  (select count(*) from inbox_email_switch) as chaves, (select count(*) from inbox_email_switch where enabled) as ligadas,
  (select count(*) from inbox_email_switch_event) as eventos_chave, (select count(*) from inbox_email_delivery) as entregas;
`;

const ENSAIO_RECUSA = `
-- ═══ ENSAIO: a migration NAO esta aqui. Erro proposital: o banco desfaz a transacao inteira. ═══
do $ensaio$ begin raise exception 'ENSAIO 0076: pre-checks aprovados; erro proposital, nada foi aplicado'; end $ensaio$;
commit;
`;
const ENSAIO_CONCLUI = `
-- ═══ ENSAIO: a migration NAO esta aqui. Desfaz explicitamente e devolve uma linha de resultado. ═══
rollback;
select 'ENSAIO OK: pre-checks aprovados, nada aplicado' as ensaio_0076,
  to_regclass('public.inbox_email_switch') is null as chave_ausente,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') as funcoes_inbox_email;
`;

/**
 * RECUPERACAO (retorno): reaplica a 0075 inteira, que e idempotente e recria create/transition SEM a chave. As tabelas
 * da chave e o historico ficam (inertes): nada e apagado. O CHECK de motivo com `envio_bloqueado` fica (e superconjunto;
 * entregas ja bloqueadas continuam validas). So roda com o livro parado.
 */
function recuperacao(sql0075) {
  return `-- ═══ RECUPERACAO DA 0076 (gerado por scripts/email-0076/envelope.mjs) — so com autorizacao propria ═══
-- Efeito: o envio volta a depender SO das variaveis do Netlify (como antes da 0076). Usar apenas se a chave travar
-- um envio legitimo por defeito e nao houver correcao rapida. A chave, o historico e as entregas ficam.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $pre$
begin
  if to_regclass('public.inbox_email_switch') is null then raise exception 'RECUPERACAO: a 0076 nao esta aplicada.'; end if;
  if exists (select 1 from inbox_email_delivery where status in ('READY', 'REQUESTED')) then
    raise exception 'RECUPERACAO: ha entrega READY ou REQUESTED. Esperar o livro parar.';
  end if;
end $pre$;

-- ═══ MIGRATION 0075, SEM ALTERACAO (idempotente) ═══
${sql0075}

do $pos$
begin
  if (select prosrc from pg_proc where proname = 'inbox_email_delivery_create') ~ 'inbox_email_envio_liberado'
     or (select prosrc from pg_proc where proname = 'inbox_email_delivery_transition') ~ 'inbox_email_envio_liberado' then
    raise exception 'RECUPERACAO: create/transition ainda conferem a chave.';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'inbox_email_delivery_reason_check' and conrelid = 'public.inbox_email_delivery'::regclass) !~ 'envio_bloqueado' then
    raise exception 'RECUPERACAO: o motivo envio_bloqueado sumiu do CHECK (entregas bloqueadas ficariam invalidas).';
  end if;
end $pos$;
commit;
select 'RECUPERADA: create/transition como na 0075; chave e historico preservados' as recuperacao_0076,
  (select count(*) from inbox_email_switch_event) as eventos_chave;
`;
}

export function ensaios() {
  return { recusa: lf(`${ANTES}${ENSAIO_RECUSA}`), conclui: lf(`${ANTES}${ENSAIO_CONCLUI}`) };
}

export function envelope() {
  const migration = lf(fs.readFileSync(MIGRATION, 'utf8'));
  if (/^\s*(begin|commit|rollback)\s*;/im.test(migration)) throw new Error('a 0076 contem controle de transacao proprio: o envelope nao pode envolve-la');
  const sql = lf(`${ANTES}${migration}${DEPOIS}`);
  const sql0075 = lf(fs.readFileSync(MIGRATION_0075, 'utf8'));
  return { sql, shaMigration: sha(migration), shaEnvelope: sha(sql), recuperacao: lf(recuperacao(sql0075)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const e = envelope();
  fs.mkdirSync(new URL('../../scratch/', import.meta.url), { recursive: true });
  const destino = new URL('../../scratch/0076-envelope.sql', import.meta.url);
  fs.writeFileSync(destino, e.sql);
  const en = ensaios();
  if (/0076_inbox_email_switch|create table/i.test(en.recusa + en.conclui)) throw new Error('ensaio contaminado com a migration');
  fs.writeFileSync(new URL('../../scratch/0076-ensaio-recusa.sql', import.meta.url), en.recusa);
  fs.writeFileSync(new URL('../../scratch/0076-ensaio-conclui.sql', import.meta.url), en.conclui);
  fs.writeFileSync(new URL('../../scratch/0076-recuperacao.sql', import.meta.url), e.recuperacao);
  console.log(`arquivo             : ${fileURLToPath(destino)}`);
  console.log(`sha256 da migration : ${e.shaMigration}`);
  console.log(`sha256 do envelope  : ${e.shaEnvelope}`);
  console.log(`sha256 da recuperacao: ${sha(e.recuperacao)}`);
  console.log('Nada foi aplicado. Este script nao fala com banco nenhum.');
}

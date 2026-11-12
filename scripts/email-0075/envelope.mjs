// Gera o SQL EXATO da aplicacao da migration 0075 em producao: a migration, sem nenhuma alteracao, dentro de UMA
// transacao, com conferencias ANTES (aborta se o banco nao estiver como o pre-flight encontrou) e DEPOIS (aborta e
// desfaz tudo se o resultado nao for o esperado ou se algum dado preexistente tiver mudado).
//
// Este script NAO aplica nada e nao fala com banco nenhum: so escreve os arquivos e imprime o SHA-256.
//   node scripts/email-0075/envelope.mjs  -> scratch/0075-envelope.sql            (o que se aplica)
//                                        -> scratch/0075-ensaio-recusa.sql       (ensaio SEM a migration: pre-checks e
//                                           erro proposital; a transacao e desfeita pelo banco)
//                                        -> scratch/0075-ensaio-conclui.sql      (ensaio SEM a migration: pre-checks e
//                                           ROLLBACK explicito; prova que o CLI devolve o resultado final)
// Os ensaios rodam no banco real com o MESMO comando da aplicacao e nao deixam nada: nao contem a 0075, nao gravam em
// tabela permanente e terminam em ROLLBACK. Servem para provar a sintaxe do CLI e os pre-checks antes do GO.
// Roteiro e pre-flight: docs/email-comercial-0075-preflight.md
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = new URL('../../supabase/migrations/0075_inbox_email_delivery.sql', import.meta.url);

const ANTES = `-- ═══ ENVELOPE DE APLICACAO DA 0075 (gerado por scripts/email-0075/envelope.mjs) ═══
begin;
set local lock_timeout = '5s';        -- nao espera lock: se o Inbox estiver ocupado, falha e nada muda
set local statement_timeout = '60s';

-- retrato dos dados preexistentes, para conferir no fim que NADA mudou
create temp table _pre_0075 on commit drop as select
  (select count(*) from inbox_message) as mensagens, (select count(*) from inbox_thread) as conversas,
  (select count(*) from inbox_contact) as contatos, (select count(*) from inbox_thread_event) as eventos,
  (select md5(coalesce(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id), '')) from inbox_message) as impressao_mensagens,
  (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(sla_first_response_at::text, '') || '|' || coalesce(sla_first_response_due::text, ''), ',' order by id), '')) from inbox_thread) as impressao_conversas;

do $pre$
declare v text;
begin
  if to_regclass('public.inbox_email_delivery') is not null or to_regclass('public.inbox_email_delivery_event') is not null then
    raise exception 'PRE-CHECK: a 0075 ja parece aplicada (o livro existe). Nada foi feito.';
  end if;
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'inbox_message_provider_check' and conrelid = 'public.inbox_message'::regclass;
  if v is null or v !~ 'MANUAL' or v !~ 'OCTADESK' or v !~ 'META_CLOUD' or v ~ 'GOOGLE_WORKSPACE' then
    raise exception 'PRE-CHECK: constraint de provider diferente da esperada: %', coalesce(v, '(ausente)');
  end if;
  if exists (select 1 from inbox_message where provider not in ('MANUAL', 'OCTADESK', 'META_CLOUD')) then
    raise exception 'PRE-CHECK: ha mensagem com provider fora do catalogo atual.';
  end if;
  if to_regprocedure('public.current_org()') is null or to_regclass('public.inbox_thread_event') is null or to_regclass('public.profile') is null then
    raise exception 'PRE-CHECK: falta objeto de que a 0075 depende (current_org, inbox_thread_event ou profile).';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'inbox_message_email_governada') then
    raise exception 'PRE-CHECK: o trigger inbox_message_email_governada ja existe.';
  end if;
end $pre$;

-- ═══ MIGRATION 0075, SEM ALTERACAO ═══
`;

const DEPOIS = `
-- ═══ CONFERENCIAS FINAIS: qualquer falha aqui desfaz TUDO (a transacao ainda nao foi confirmada) ═══
do $pos$
declare v text; a record; d record;
begin
  if (select count(*) from pg_tables where schemaname = 'public' and tablename in ('inbox_email_delivery', 'inbox_email_delivery_event')) <> 2 then
    raise exception 'POS-CHECK: as duas tabelas do livro nao foram criadas.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') <> 8 then
    raise exception 'POS-CHECK: numero de funcoes inbox_email_* diferente de 8.';
  end if;
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'inbox_message_provider_check' and conrelid = 'public.inbox_message'::regclass and convalidated;
  if v is null or v !~ 'GOOGLE_WORKSPACE' or v !~ 'MANUAL' or v !~ 'OCTADESK' or v !~ 'META_CLOUD' then
    raise exception 'POS-CHECK: constraint de provider nao ficou como esperado: %', coalesce(v, '(ausente ou nao validada)');
  end if;
  if (select count(*) from pg_trigger where tgname = 'inbox_message_email_governada' and tgrelid = 'public.inbox_message'::regclass) <> 1 then
    raise exception 'POS-CHECK: trigger da mensagem de e-mail ausente.';
  end if;
  if has_function_privilege('authenticated', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'inbox_email_delivery_transition(uuid, text, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'inbox_email_delivery_accept(uuid, uuid, timestamptz, text, text, boolean)', 'execute')
     or not has_function_privilege('service_role', 'inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer)', 'execute') then
    raise exception 'POS-CHECK: privilegios das RPCs fora do esperado (so service_role executa).';
  end if;
  if has_table_privilege('authenticated', 'inbox_email_delivery', 'insert') or has_table_privilege('authenticated', 'inbox_email_delivery', 'update')
     or has_table_privilege('anon', 'inbox_email_delivery', 'select') or not has_table_privilege('authenticated', 'inbox_email_delivery', 'select') then
    raise exception 'POS-CHECK: privilegios do livro fora do esperado (navegador so le).';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.inbox_email_delivery'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.inbox_email_delivery_event'::regclass) then
    raise exception 'POS-CHECK: RLS desligada no livro.';
  end if;
  if exists (select 1 from inbox_email_delivery) or exists (select 1 from inbox_message where provider = 'GOOGLE_WORKSPACE') then
    raise exception 'POS-CHECK: o livro deveria nascer vazio.';
  end if;
  select * into a from _pre_0075;
  select (select count(*) from inbox_message) as mensagens, (select count(*) from inbox_thread) as conversas,
    (select count(*) from inbox_contact) as contatos, (select count(*) from inbox_thread_event) as eventos,
    (select md5(coalesce(string_agg(id::text || '|' || provider || '|' || coalesce(delivery_state, '') || '|' || md5(body) || '|' || md5(meta::text), ',' order by id), '')) from inbox_message) as impressao_mensagens,
    (select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(sla_first_response_at::text, '') || '|' || coalesce(sla_first_response_due::text, ''), ',' order by id), '')) from inbox_thread) as impressao_conversas
    into d;
  if a is distinct from d then
    raise exception 'POS-CHECK: dados preexistentes do Inbox mudaram durante a aplicacao. Antes: %  Depois: %', a, d;
  end if;
end $pos$;

commit;

-- resultado (somente leitura, ja fora da transacao)
select 'APLICADA' as migration_0075,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') as funcoes,
  (select count(*) from inbox_email_delivery) as entregas, (select count(*) from inbox_message) as mensagens, (select count(*) from inbox_thread) as conversas;
`;

const ENSAIO_RECUSA = `
-- ═══ ENSAIO: a migration NAO esta aqui. Erro proposital: o banco desfaz a transacao inteira. ═══
do $ensaio$ begin raise exception 'ENSAIO 0075: pre-checks aprovados; erro proposital, nada foi aplicado'; end $ensaio$;
commit;
`;
const ENSAIO_CONCLUI = `
-- ═══ ENSAIO: a migration NAO esta aqui. Desfaz explicitamente e devolve uma linha de resultado. ═══
rollback;
select 'ENSAIO OK: pre-checks aprovados, nada aplicado' as ensaio_0075,
  to_regclass('public.inbox_email_delivery') is null as livro_ausente,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inbox_email%') as funcoes_inbox_email;
`;

/** Os dois ensaios (sem a migration), para provar o comando no banco real sem efeito. */
export function ensaios() {
  const lf = (t) => t.replace(/\r\n/g, '\n');
  return { recusa: lf(`${ANTES}${ENSAIO_RECUSA}`), conclui: lf(`${ANTES}${ENSAIO_CONCLUI}`) };
}

/** O SQL completo e o SHA-256 da migration e do envelope. */
export function envelope() {
  // fim de linha normalizado: o hash tem de ser o mesmo em qualquer maquina (Windows troca LF por CRLF no checkout)
  const lf = (t) => t.replace(/\r\n/g, '\n');
  const migration = lf(fs.readFileSync(MIGRATION, 'utf8'));
  // a migration nao pode abrir nem fechar transacao por conta propria: quem controla e o envelope
  if (/^\s*(begin|commit|rollback)\s*;/im.test(migration)) throw new Error('a 0075 contem controle de transacao proprio: o envelope nao pode envolve-la');
  const sql = lf(`${ANTES}${migration}${DEPOIS}`);
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  return { sql, shaMigration: sha(migration), shaEnvelope: sha(sql) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const e = envelope();
  const destino = new URL('../../scratch/0075-envelope.sql', import.meta.url);
  fs.mkdirSync(new URL('../../scratch/', import.meta.url), { recursive: true });
  fs.writeFileSync(destino, e.sql);
  const en = ensaios();
  if (/0075_inbox_email_delivery|create table/i.test(en.recusa + en.conclui)) throw new Error('ensaio contaminado com a migration');
  fs.writeFileSync(new URL('../../scratch/0075-ensaio-recusa.sql', import.meta.url), en.recusa);
  fs.writeFileSync(new URL('../../scratch/0075-ensaio-conclui.sql', import.meta.url), en.conclui);
  console.log(`arquivo            : ${fileURLToPath(destino)}`);
  console.log(`sha256 da migration: ${e.shaMigration}`);
  console.log(`sha256 do envelope : ${e.shaEnvelope}`);
  console.log('Nada foi aplicado. Este script nao fala com banco nenhum.');
}

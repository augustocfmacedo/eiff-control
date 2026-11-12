-- RECUPERACAO MANUAL da migration 0075 — desfaz a estrutura. NAO E AUTOMATICA e nao deve ser agendada.
-- So serve ENQUANTO o livro estiver vazio: se ja existir entrega ou mensagem de e-mail, ela se RECUSA e nada muda
-- (historico de envio nao se apaga; nesse caso o caminho e desligar o envio pelas variaveis, nao desfazer o banco).
begin;
set local lock_timeout = '5s';
do $chk$
begin
  if to_regclass('public.inbox_email_delivery') is not null and exists (select 1 from inbox_email_delivery) then
    raise exception 'recuperacao recusada: ha entregas registradas no livro';
  end if;
  if exists (select 1 from inbox_message where provider = 'GOOGLE_WORKSPACE') then
    raise exception 'recuperacao recusada: ha mensagens de e-mail comercial na conversa';
  end if;
end $chk$;
drop trigger if exists inbox_message_email_governada on inbox_message;
drop function if exists inbox_email_delivery_create(uuid, uuid, uuid, uuid, text, uuid, text, text, integer, integer);
drop function if exists inbox_email_delivery_transition(uuid, text, uuid, text, text, text);
drop function if exists inbox_email_delivery_accept(uuid, uuid, timestamptz, text, text, boolean);
drop function if exists inbox_email_entrega_json(inbox_email_delivery);
drop table if exists inbox_email_delivery_event;
drop table if exists inbox_email_delivery;
drop function if exists inbox_email_delivery_guarda();
drop function if exists inbox_email_evento_imutavel();
drop function if exists inbox_email_mensagem_governada();
drop function if exists inbox_email_somente_servidor();
alter table inbox_message drop constraint if exists inbox_message_provider_check;
alter table inbox_message add constraint inbox_message_provider_check check (provider in ('MANUAL', 'OCTADESK', 'META_CLOUD'));
commit;

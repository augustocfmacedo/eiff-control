-- EIFF Central: conteudo NORMALIZADO da mensagem inbound e trilha TIPADA de processamento (Wave 03, decisao D2/B+).
-- Estritamente ADITIVA: nao altera central_conversation, central_message, central_event nem whatsapp_identity.
-- A 0050 continua verdadeira para as tabelas dela ("central_message nao guarda conteudo"): o conteudo passa a existir
-- em objeto SEPARADO, com contrato proprio, retencao separavel e visibilidade que pode ser estreitada sem tocar o metadado.
--
-- O que o banco garante (nao so o codigo):
--   1) conteudo so de mensagem INBOUND (trigger): texto de resposta gerado pela IA NAO e persistido nesta wave;
--   2) conteudo e o texto NORMALIZADO (limparTexto: sem caractere de controle, espaco colapsado, 1..1000 chars), nunca o
--      webhook bruto da Meta; sem telefone, sem payload, sem jsonb;
--   3) uma linha por mensagem (PK = message_id): reenvio da Meta nao duplica nem sobrescreve (insert ... on conflict do nothing);
--   4) conteudo IMUTAVEL: UPDATE recusado. Purga (politica de retencao, divida CENTRAL_CONTENT_RETENTION_POLICY) e DELETE
--      server-side, e a mensagem e a trilha ficam;
--   5) leitura HERDA a visibilidade mensagem -> conversa (RLS encadeada; nenhuma politica consulta a propria tabela);
--   6) processamento: uma linha TIPADA por rodada, append-only; can_execute e sent obrigatoriamente false (invariantes 7 e 8
--      da Wave 03 no banco); CONCLUIDO exige impressao da saida e nenhum erro; ERRO exige codigo; so UM CONCLUIDO de webhook
--      por mensagem (ERRO pode se repetir: reenvio da Meta e retry legitimo);
--   7) input_sha256 do processamento e o body_sha256 do conteudo persistido (trigger): reprocessar parte de texto integro;
--      mensagem SEM conteudo (audio, imagem, documento) so conclui como sem_texto, e sem hash;
--   8) identity_id do processamento e a identidade VINCULADA A CONVERSA e VERIFIED (trigger) — nunca "qualquer identidade
--      da organizacao"; conversa sem identidade valida => identity_id nulo;
--   9) reprocessamento exige ator (quem abriu o texto e o parecer de um colega fica na trilha); webhook nunca tem ator;
--  10) escrita SOMENTE server-side (service_role, como na 0050): authenticated so le.
-- Migration idempotente: pode ser aplicada mais de uma vez.

-- ---------------------------------------------------------------------------
-- 1) conteudo normalizado do inbound
-- ---------------------------------------------------------------------------
create table if not exists central_message_content (
  message_id uuid primary key references central_message(id) on delete cascade,
  organization_id uuid not null references organization(id),
  body_text text not null check (length(body_text) between 1 and 1000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  normalization_version smallint not null default 1 check (normalization_version >= 1),
  created_at timestamptz not null default now()
);
create index if not exists central_message_content_org_idx on central_message_content (organization_id, created_at);

create or replace function central_message_content_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_dir text;
begin
  select organization_id, direction into v_org, v_dir from central_message where id = new.message_id;
  if v_org is null then raise exception 'mensagem % não encontrada', new.message_id; end if;
  if v_org <> new.organization_id then raise exception 'conteúdo de outra organização'; end if;
  if v_dir <> 'inbound' then raise exception 'nesta fase só mensagem inbound tem conteúdo persistido'; end if;
  return new;
end $$;
drop trigger if exists central_message_content_coerencia on central_message_content;
create trigger central_message_content_coerencia before insert on central_message_content for each row execute function central_message_content_coerencia();

create or replace function central_message_content_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'conteúdo da mensagem é imutável: purga é DELETE server-side, nunca UPDATE';
end $$;
drop trigger if exists central_message_content_no_update on central_message_content;
create trigger central_message_content_no_update before update on central_message_content for each row execute function central_message_content_imutavel();

-- ---------------------------------------------------------------------------
-- 2) trilha tipada de processamento (D2): uma linha por rodada, colunas fechadas, sem jsonb
-- ---------------------------------------------------------------------------
create table if not exists central_message_processing (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  conversation_id uuid not null references central_conversation(id) on delete cascade,
  message_id uuid not null references central_message(id) on delete cascade,
  identity_id uuid references whatsapp_identity(id),
  origin text not null check (origin in ('WEBHOOK', 'REPROCESSAMENTO')),
  actor_id uuid references profile(id),                       -- quem pediu o reprocessamento; nunca no WEBHOOK
  engine_sha text check (engine_sha is null or engine_sha ~ '^[0-9a-f]{7,64}$'),   -- SHA do deploy (7..64 hex; nao presume SHA-1)
  flow_version text not null check (length(flow_version) between 1 and 40),        -- versao declarada do caminho (constante no codigo)
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),   -- = central_message_content.body_sha256 (trigger)
  output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),  -- impressao da resposta; o texto NAO e guardado
  intent text check (intent is null or intent in ('FINANCE','PURCHASE','WORKSITE','INVENTORY','COMMERCIAL','HR_ADMIN','EXECUTIVE','GENERAL')),
  situation text check (situation is null or situation in ('respondido','pergunta_pendente','proposta_aguardando_registro','sem_texto','contexto_externo','identidade_recusada','revisao_humana','fora_de_escopo')),
  status text not null check (status in ('CONCLUIDO', 'ERRO')),
  error_code text check (error_code is null or (length(error_code) <= 80 and error_code !~ '[0-9]{7,}')),
  can_execute boolean not null default false check (can_execute = false),          -- invariante 8 da Wave 03
  sent boolean not null default false check (sent = false),                        -- invariante 7 da Wave 03
  duration_ms integer not null check (duration_ms >= 0),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- B) status: CONCLUIDO tem saida, situacao e nenhum erro; ERRO tem codigo
  constraint central_message_processing_concluido_chk check (status <> 'CONCLUIDO' or (output_sha256 is not null and situation is not null and error_code is null)),
  constraint central_message_processing_erro_chk check (status <> 'ERRO' or error_code is not null),
  -- A) so a situacao sem_texto conclui sem hash de entrada
  constraint central_message_processing_input_chk check (status <> 'CONCLUIDO' or input_sha256 is not null or situation = 'sem_texto'),
  -- ator: obrigatorio no reprocessamento, proibido no webhook
  constraint central_message_processing_ator_chk check (origin <> 'REPROCESSAMENTO' or actor_id is not null),
  constraint central_message_processing_webhook_chk check (origin <> 'WEBHOOK' or actor_id is null)
);
-- um so processamento CONCLUIDO do webhook por mensagem; tentativas com ERRO podem se repetir (retry da Meta)
create unique index if not exists central_message_processing_webhook_uk on central_message_processing (message_id) where origin = 'WEBHOOK' and status = 'CONCLUIDO';
create index if not exists central_message_processing_conversa_idx on central_message_processing (conversation_id, processed_at desc);
create index if not exists central_message_processing_mensagem_idx on central_message_processing (message_id, processed_at desc);

create or replace function central_message_processing_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_conversa uuid; v_hash text; v_identidade uuid;
begin
  select m.organization_id, m.conversation_id, c.body_sha256 into v_org, v_conversa, v_hash
    from central_message m left join central_message_content c on c.message_id = m.id
   where m.id = new.message_id;
  if v_org is null then raise exception 'mensagem % não encontrada', new.message_id; end if;
  if v_org <> new.organization_id or v_conversa <> new.conversation_id then raise exception 'processamento de outra organização ou de outra conversa'; end if;
  -- A) hash de entrada = hash do conteudo persistido; sem conteudo, sem hash e so sem_texto conclui
  if v_hash is not null then
    if new.input_sha256 is null or new.input_sha256 <> v_hash then raise exception 'input_sha256 não corresponde ao conteúdo persistido da mensagem'; end if;
  else
    if new.input_sha256 is not null then raise exception 'input_sha256 informado para mensagem sem conteúdo persistido'; end if;
    if new.status = 'CONCLUIDO' and new.situation is distinct from 'sem_texto' then raise exception 'mensagem sem conteúdo persistido só conclui como sem_texto'; end if;
  end if;
  -- D) identidade: a VINCULADA a esta conversa, e VERIFIED; senao fica nula
  if new.identity_id is not null then
    select identity_id into v_identidade from central_conversation where id = new.conversation_id;
    if v_identidade is distinct from new.identity_id then raise exception 'identidade % não é a identidade vinculada à conversa', new.identity_id; end if;
    if not exists (select 1 from whatsapp_identity i where i.id = new.identity_id and i.organization_id = new.organization_id and i.status = 'VERIFIED') then
      raise exception 'identidade % não está VERIFIED nesta organização: o processamento fica sem identidade', new.identity_id;
    end if;
  end if;
  if new.actor_id is not null and not exists (select 1 from profile p where p.id = new.actor_id and p.organization_id = new.organization_id) then
    raise exception 'ator % não pertence à organização', new.actor_id;
  end if;
  return new;
end $$;
drop trigger if exists central_message_processing_coerencia on central_message_processing;
create trigger central_message_processing_coerencia before insert on central_message_processing for each row execute function central_message_processing_coerencia();

-- append-only: a trilha de processamento nao muda e nao se apaga
create or replace function central_message_processing_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'processamento da Central é imutável (%): não pode ser alterado nem apagado', tg_op;
end $$;
drop trigger if exists central_message_processing_no_update on central_message_processing;
create trigger central_message_processing_no_update before update on central_message_processing for each row execute function central_message_processing_imutavel();
drop trigger if exists central_message_processing_no_delete on central_message_processing;
create trigger central_message_processing_no_delete before delete on central_message_processing for each row execute function central_message_processing_imutavel();

-- ---------------------------------------------------------------------------
-- 3) RLS: leitura por organizacao, herdando a cadeia mensagem -> conversa. Escrita: nenhuma para authenticated.
-- ---------------------------------------------------------------------------
alter table central_message_content enable row level security;
alter table central_message_processing enable row level security;
-- o EXISTS passa pela RLS de central_message (cm_select), que passa pela de central_conversation (cc_select): a regra e a
-- mesma, escrita uma vez so. Sem recursao: nenhuma das duas olha para o conteudo ou para o processamento.
drop policy if exists cmc_select on central_message_content;
create policy cmc_select on central_message_content for select using (
  organization_id = current_org()
  and exists (select 1 from central_message m where m.id = central_message_content.message_id)
);
drop policy if exists cmp_select on central_message_processing;
create policy cmp_select on central_message_processing for select using (
  organization_id = current_org()
  and exists (select 1 from central_conversation c where c.id = central_message_processing.conversation_id)
);
revoke all on central_message_content from authenticated;
revoke all on central_message_processing from authenticated;
grant select on central_message_content to authenticated;
grant select on central_message_processing to authenticated;

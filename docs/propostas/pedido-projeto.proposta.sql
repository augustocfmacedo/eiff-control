-- PROPOSTA — NÃO APLICAR SEM AUTORIZAÇÃO DA DIREÇÃO (E11.2C, docs/central-gestao-comercial.md §14).
--
-- Fora de supabase/migrations de propósito: o número só é escolhido na hora de aplicar, coordenado com as outras frentes
-- (conferir repositório E schema real; não há ledger). DEPENDE de docs/propostas/comercial-acesso.proposta.sql PARTE 1
-- (valor 'Comercial' no enum role_kind). Ordem: Segurança S3 → comercial-acesso parte 1 → parte 2 → esta.
-- Prova: node scripts/pg-smoke-pedido-projeto.mjs e src/data/pedidosProjeto.supabase.integracao.test.ts (PGlite).
--
-- Espelha o motor src/core/comercial/pedidoProjeto.ts (REGRAS_ACAO, CAMPOS_TECNICOS, fila técnica, idempotência, uma
-- aberta por oportunidade e tipo). O BANCO é a autoridade: toda leitura e escrita passa por funções security definer que
-- conferem o papel no perfil. Nenhum papel lê as tabelas da Engenharia diretamente; a gestão comercial lê as tabelas
-- (auditoria) e a Engenharia só recebe a PROJEÇÃO TÉCNICA (sem oportunidade, sem vínculos, nada comercial).
--
-- Erros de regra saem como 'PP:<CODIGO>: <mensagem>' (os códigos de ErroPedido), para o adaptador traduzir sem adivinhar.

-- ====================================================================================== tabelas

create table if not exists project_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  type_version integer not null default 1,
  company_id uuid not null references radar_company(id),
  opportunity_id uuid not null references radar_opportunity(id),
  inbox_thread_id uuid,
  submission_id text,
  source_record_id uuid references radar_source_record(id),
  estimate_id uuid references estimate(id),
  lead_origin text not null check (lead_origin in ('SIMULADOR','INBOX','LEAD_ENGINE','RADAR','REUNIAO','INDICACAO','OUTRO')),
  request_type text not null check (request_type in ('Estudo preliminar','Anteprojeto estrutural','Projeto executivo','Análise técnica','Apoio ao orçamento técnico')),
  priority text not null check (priority in ('Baixa','Normal','Alta','Urgente')),
  requested_due date,
  commercial_owner_id uuid not null references profile(id),
  technical_team text,
  technical_owner_id uuid references profile(id),
  delivery_due date,
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO','ENTREGUE','ENCERRADO','CANCELADO')),
  delivery jsonb,
  outcome jsonb,
  reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null references profile(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
-- uma solicitação ABERTA por oportunidade e tipo; a seguinte (depois de encerrada/cancelada) é a versão nova
create unique index if not exists project_request_aberta_uk on project_request (organization_id, opportunity_id, request_type) where status not in ('ENCERRADO','CANCELADO');

-- dados técnicos: o valor atual de cada campo do catálogo, declarado ou validado (o histórico fica nos eventos)
create table if not exists project_request_field (
  request_id uuid not null references project_request(id),
  organization_id uuid not null references organization(id),
  field_key text not null check (field_key in ('cidade','uf','endereco','uso','areaM2','comprimentoM','larguraM','alturaM','tipologia','cobertura','fechamentos','projetoArquitetonico','fundacaoTerreno','observacoes')),
  value jsonb not null,
  status text not null default 'declarado' check (status in ('declarado','validado')),
  validated_by uuid references profile(id),
  validated_at timestamptz,
  updated_by uuid not null references profile(id),
  updated_at timestamptz not null default now(),
  primary key (request_id, field_key),
  check ((status = 'validado') = (validated_by is not null and validated_at is not null))
);

-- documentos: situação atual por tipo (o histórico fica nos eventos; as versões de arquivo, em project_request_file)
create table if not exists project_request_document (
  request_id uuid not null references project_request(id),
  organization_id uuid not null references organization(id),
  doc_type text not null check (doc_type in ('arquitetura','implantacao','topografia','sondagem','memorial','complementar')),
  status text not null default 'nao_necessario' check (status in ('nao_necessario','pendente','recebido','validado')),
  reference text,
  updated_by uuid references profile(id),
  updated_at timestamptz,
  received_at timestamptz,
  validated_by uuid references profile(id),
  validated_at timestamptz,
  primary key (request_id, doc_type)
);

-- arquivos: cada envio é uma VERSÃO nova (nunca sobrescreve); remoção é lógica, com motivo
create table if not exists project_request_file (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  request_id uuid not null references project_request(id),
  doc_type text not null check (doc_type in ('arquitetura','implantacao','topografia','sondagem','memorial','complementar','entregavel')),
  version integer not null,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp','application/zip','image/vnd.dwg','application/acad','application/dxf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  uploaded_by uuid not null references profile(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references profile(id),
  removal_reason text,
  unique (request_id, doc_type, version),
  check ((removed_at is null) = (removed_by is null))
);

-- pendências: quem pediu, quem responde (o responsável comercial), resposta e resolução
create table if not exists project_request_pending (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  request_id uuid not null references project_request(id),
  description text not null check (length(trim(description)) between 1 and 500),
  requested_by uuid not null references profile(id),
  answer_owner_id uuid not null references profile(id),
  opened_at timestamptz not null default now(),
  answer text,
  resolved_at timestamptz,
  resolved_by uuid references profile(id),
  status text not null default 'aberta' check (status in ('aberta','respondida')),
  check ((status = 'respondida') = (resolved_at is not null))
);

-- histórico: um evento por ação aceita, nunca alterado; a intenção é única por organização (idempotência)
create table if not exists project_request_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  request_id uuid not null references project_request(id),
  action text not null,
  from_status text,
  to_status text not null,
  actor_id uuid not null references profile(id),
  actor_role text not null,
  reason text,
  detail text,
  changes jsonb not null default '[]'::jsonb,
  intent text not null,
  occurred_at timestamptz not null default now()
);
create unique index if not exists project_request_event_intencao_uk on project_request_event (organization_id, intent);
create index if not exists project_request_event_req_idx on project_request_event (request_id, occurred_at);

-- ====================================================================================== papéis e visibilidade

create or replace function pp_gestao_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Comercial')
$$;
create or replace function pp_engenharia_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Engenharia')
$$;
-- fila técnica: a Engenharia vê a fila de triagem (SOLICITADO) e o que está atribuído a ela
create or replace function pp_engenharia_ve(p_status text, p_owner uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select pp_engenharia_role() and (p_status = 'SOLICITADO' or p_owner = auth.uid())
$$;
create or replace function pp_ve_pedido(p_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from project_request r where r.id = p_id and r.organization_id = current_org()
    and (pp_gestao_role() or pp_engenharia_ve(r.status, r.technical_owner_id)))
$$;

-- RLS: leitura DIRETA só para a gestão comercial (auditoria); escrita direta para ninguém
do $$
declare t text;
begin
  foreach t in array array['project_request','project_request_field','project_request_document','project_request_file','project_request_pending','project_request_event'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (organization_id = current_org() and pp_gestao_role())', t || '_select', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
    execute format('revoke truncate on %I from service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- ====================================================================================== integridade

create or replace function project_request_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from radar_company c where c.id = new.company_id and c.organization_id = new.organization_id) then raise exception 'PP:VINCULO_INVALIDO: empresa de outra organização'; end if;
  if not exists (select 1 from radar_opportunity o where o.id = new.opportunity_id and o.organization_id = new.organization_id and o.company_id = new.company_id) then raise exception 'PP:VINCULO_INVALIDO: a oportunidade não é desta empresa'; end if;
  if tg_op = 'INSERT' and exists (select 1 from radar_opportunity o where o.id = new.opportunity_id and o.stage in ('WON','LOST','NURTURE')) then raise exception 'PP:VINCULO_INVALIDO: a oportunidade não está ativa'; end if;
  if new.inbox_thread_id is not null and not exists (select 1 from inbox_thread t where t.id = new.inbox_thread_id and t.organization_id = new.organization_id) then raise exception 'PP:VINCULO_INVALIDO: conversa do Inbox não encontrada'; end if;
  if new.submission_id is not null and not exists (select 1 from inbox_message m where m.external_message_id = new.submission_id and m.organization_id = new.organization_id) then raise exception 'PP:VINCULO_INVALIDO: submissão do simulador não encontrada'; end if;
  if new.source_record_id is not null and not exists (select 1 from radar_source_record r where r.id = new.source_record_id and r.organization_id = new.organization_id and r.intake_status = 'RESOLVED' and r.entity_id = new.company_id) then raise exception 'PP:VINCULO_INVALIDO: evidência do Lead Engine não promovida para esta empresa'; end if;
  if new.estimate_id is not null and not exists (select 1 from estimate e where e.id = new.estimate_id and e.organization_id = new.organization_id) then raise exception 'PP:VINCULO_INVALIDO: orçamento não encontrado'; end if;
  if not exists (select 1 from profile p where p.id = new.commercial_owner_id and p.organization_id = new.organization_id and p.active and p.role in ('Administrador','Diretoria','Comercial')) then raise exception 'PP:VINCULO_INVALIDO: responsável comercial inválido (gestão comercial ativa da organização)'; end if;
  if new.technical_owner_id is not null and not exists (select 1 from profile p where p.id = new.technical_owner_id and p.organization_id = new.organization_id and p.active and p.role in ('Engenharia','Administrador','Diretoria')) then raise exception 'PP:VINCULO_INVALIDO: responsável técnico inválido'; end if;
  return new;
end $$;
drop trigger if exists project_request_coerencia on project_request;
create trigger project_request_coerencia before insert or update on project_request for each row execute function project_request_coerencia();

create or replace function project_request_imutavel() returns trigger language plpgsql as $$
begin raise exception 'PP:SEM_PERMISSAO: histórico e versões de arquivo são imutáveis'; end $$;
drop trigger if exists project_request_event_imutavel on project_request_event;
create trigger project_request_event_imutavel before update or delete on project_request_event for each row execute function project_request_imutavel();
-- TRUNCATE: a RLS NÃO se aplica a TRUNCATE e gatilho de linha não dispara. Os papéis da aplicação (anon, authenticated)
-- e o service_role não têm o privilégio TRUNCATE nestas tabelas; o gatilho de INSTRUÇÃO abaixo é uma segunda barreira para
-- quem tiver o privilégio. NÃO é proteção absoluta: o dono das tabelas e superusuários podem desligar gatilhos ou alterar
-- privilégios — papéis administrativos privilegiados exigem controles próprios (acesso restrito, auditoria, backup).
do $$ declare t text; begin
  foreach t in array array['project_request','project_request_field','project_request_document','project_request_file','project_request_pending','project_request_event'] loop
    execute format('drop trigger if exists %I on %I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on %I for each statement execute function project_request_imutavel()', t || '_sem_truncate', t);
  end loop;
end $$;
drop trigger if exists project_request_file_sem_delete on project_request_file;
create trigger project_request_file_sem_delete before delete on project_request_file for each row execute function project_request_imutavel();
do $$ declare t text; begin
  foreach t in array array['project_request','project_request_field','project_request_document','project_request_pending'] loop
    execute format('drop trigger if exists %I on %I', t || '_sem_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function project_request_imutavel()', t || '_sem_delete', t);
  end loop;
end $$;

-- ====================================================================================== leitura (projeção)

-- a solicitação no formato do motor (src/core/comercial/pedidoProjeto.ts). `tecnica` = visão da Engenharia: sem
-- oportunidade e sem vínculos (não servem ao trabalho técnico e abririam caminho para o comercial)
create or replace function pp_json(r project_request, tecnica boolean) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id, 'organizacaoId', r.organization_id, 'codigo', r.code, 'versaoTipo', r.type_version, 'empresaId', r.company_id,
    'empresaNome', (select coalesce(c.trade_name, c.legal_name) from radar_company c where c.id = r.company_id),
    'oportunidadeId', case when tecnica then null else r.opportunity_id end,
    'vinculos', case when tecnica then null else jsonb_strip_nulls(jsonb_build_object('inboxThreadId', r.inbox_thread_id, 'submissaoId', r.submission_id, 'registroFonteId', r.source_record_id, 'orcamentoId', r.estimate_id)) end,
    'origemLead', r.lead_origin, 'tipo', r.request_type, 'prioridade', r.priority, 'prazoSolicitado', r.requested_due,
    'responsavelComercialId', r.commercial_owner_id, 'equipeTecnica', r.technical_team, 'responsavelTecnicoId', r.technical_owner_id,
    'prazoEntrega', r.delivery_due, 'situacao', r.status, 'entrega', r.delivery,
    -- técnica: o resultado comercial só pelo tipo (sem o orçamento) e sem o motivo do encerramento (texto comercial)
    'resultado', case when tecnica then case when r.outcome is null then null else jsonb_build_object('tipo', r.outcome ->> 'tipo') end else r.outcome end,
    'motivo', case when tecnica and r.status = 'ENCERRADO' then null else r.reason end,
    'versao', r.version, 'criadoEm', r.created_at, 'criadoPor', r.created_by, 'atualizadoEm', r.updated_at,
    'dados', coalesce((select jsonb_object_agg(f.field_key, jsonb_strip_nulls(jsonb_build_object('dado', f.value, 'situacao', f.status, 'validadoPor', f.validated_by, 'validadoEm', f.validated_at)))
      from project_request_field f where f.request_id = r.id), '{}'::jsonb),
    'documentos', coalesce((select jsonb_object_agg(d.doc_type, jsonb_strip_nulls(jsonb_build_object('situacao', d.status, 'referencia', d.reference, 'atualizadoPor', d.updated_by, 'atualizadoEm', d.updated_at)))
      from project_request_document d where d.request_id = r.id), '{}'::jsonb),
    'pendencias', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', p.id, 'descricao', p.description, 'aberta', p.status = 'aberta', 'criadaEm', p.opened_at, 'criadaPor', p.requested_by,
      'resolvidaEm', p.resolved_at, 'resolvidaPor', p.resolved_by, 'resposta', p.answer)) order by p.opened_at, p.id) from project_request_pending p where p.request_id = r.id), '[]'::jsonb)
  ))
$$;

create or replace function pp_listar() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(pp_json(r, not pp_gestao_role()) order by r.updated_at desc, r.code), '[]'::jsonb)
  from project_request r
  where r.organization_id = current_org() and (pp_gestao_role() or pp_engenharia_ve(r.status, r.technical_owner_id))
$$;
create or replace function pp_obter(p_id uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select pp_json(r, not pp_gestao_role()) from project_request r where r.id = p_id and pp_ve_pedido(r.id)
$$;
create or replace function pp_eventos(p_id uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', e.id, 'organizacaoId', e.organization_id, 'pedidoId', e.request_id, 'acao', e.action, 'de', e.from_status,
    'para', e.to_status, 'por', e.actor_id, 'papel', e.actor_role, 'em', e.occurred_at,
    -- para a Engenharia, o encerramento comercial aparece sem motivo, detalhe e alterações
    'motivo', case when e.action = 'encerrar' and not pp_gestao_role() then null else e.reason end,
    'detalhe', case when e.action = 'encerrar' and not pp_gestao_role() then null else e.detail end, 'intencao', e.intent,
    'alteracoes', case when e.action = 'encerrar' and not pp_gestao_role() then null else e.changes end))
    order by e.occurred_at, e.id), '[]'::jsonb)
  from project_request_event e where e.request_id = p_id and pp_ve_pedido(p_id)
$$;
create or replace function pp_arquivos(p_id uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', f.id, 'tipo', f.doc_type, 'versao', f.version, 'caminho', f.storage_path, 'nome', f.file_name, 'mime', f.mime_type,
    'tamanho', f.size_bytes, 'enviadoPor', f.uploaded_by, 'enviadoEm', f.uploaded_at, 'removidoEm', f.removed_at, 'removidoPor', f.removed_by, 'motivoRemocao', f.removal_reason))
    order by f.doc_type, f.version), '[]'::jsonb)
  from project_request_file f where f.request_id = p_id and pp_ve_pedido(p_id)
$$;

-- ====================================================================================== escrita

create or replace function pp_eu() returns profile language plpgsql stable security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype;
begin
  select * into eu from profile where id = auth.uid() and active and role <> 'Solicitante';
  if eu.id is null then raise exception 'PP:SEM_PERMISSAO: sem perfil ativo'; end if;
  return eu;
end $$;

create or replace function pp_texto(v jsonb) returns text language sql immutable as $$ select nullif(trim(both from case jsonb_typeof(v) when 'string' then v #>> '{}' else v::text end), '') $$;
-- dados declarados válidos do catálogo (números > 0 nos campos numéricos)
create or replace function pp_dados(p jsonb) returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb; t text;
begin
  for k, v in select * from jsonb_each(coalesce(p, '{}'::jsonb)) loop
    if k not in ('cidade','uf','endereco','uso','areaM2','comprimentoM','larguraM','alturaM','tipologia','cobertura','fechamentos','projetoArquitetonico','fundacaoTerreno','observacoes') then continue; end if;
    t := pp_texto(v);
    if t is null or v = 'null'::jsonb then continue; end if;
    if length(t) > 2000 then raise exception 'PP:DADOS_INCOMPLETOS: % passa de 2000 caracteres', k; end if;
    if k in ('areaM2','comprimentoM','larguraM','alturaM') then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <= 0 then raise exception 'PP:DADOS_INCOMPLETOS: % deve ser maior que zero', k; end if;
      out := out || jsonb_build_object(k, v);
    else out := out || jsonb_build_object(k, to_jsonb(t)); end if;
  end loop;
  return out;
end $$;
create or replace function pp_conferir_dados(d jsonb) returns void language plpgsql immutable as $$
begin
  if d ->> 'cidade' is null or d ->> 'uf' is null then raise exception 'PP:DADOS_INCOMPLETOS: cidade e UF da obra'; end if;
  if (select count(*) from jsonb_object_keys(d) k where k not in ('cidade','uf')) = 0 then raise exception 'PP:DADOS_INCOMPLETOS: ao menos um dado técnico além do local'; end if;
end $$;

-- criar: nasce SOLICITADO (encaminhada à Engenharia). Idempotente pela intenção.
create or replace function pp_criar(p jsonb, p_intencao text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype; r project_request%rowtype; n integer; v integer; dados jsonb; existente uuid; t text; k text; val jsonb;
begin
  eu := pp_eu();
  if not pp_gestao_role() then raise exception 'PP:SEM_PERMISSAO: só o Comercial (gestão comercial) abre solicitações de projeto'; end if;
  if coalesce(p_intencao, '') = '' then raise exception 'PP:DADOS_INCOMPLETOS: intenção ausente'; end if;
  select request_id into existente from project_request_event where organization_id = eu.organization_id and intent = p_intencao;
  if existente is not null then select * into r from project_request where id = existente; return pp_json(r, false); end if;
  if nullif(p -> 'vinculos' ->> 'orcamentoId', '') is not null then raise exception 'PP:DADOS_INCOMPLETOS: orçamento só se vincula no encerramento'; end if;
  dados := pp_dados(p -> 'dados');
  perform pp_conferir_dados(dados);
  -- ensaio nunca vira solicitação (mesma lista de SUBMISSOES_DE_ENSAIO)
  if p -> 'vinculos' ->> 'submissaoId' in ('6af379040c7080bc34020601','6af72bc662ddce941fc27637','6af761a6cbe0316d6d3211b9') then raise exception 'PP:ENSAIO: submissão de ensaio não vira solicitação de projeto'; end if;
  if exists (select 1 from project_request x where x.organization_id = eu.organization_id and x.opportunity_id = (p ->> 'oportunidadeId')::uuid and x.request_type = p ->> 'tipo' and x.status not in ('ENCERRADO','CANCELADO')) then
    raise exception 'PP:DUPLICADA: já existe solicitação aberta deste tipo para esta oportunidade'; end if;
  perform pg_advisory_xact_lock(hashtext(eu.organization_id::text || ':SP'));
  select coalesce(max(substring(code from 4)::integer), 0) + 1 into n from project_request where organization_id = eu.organization_id and code ~ '^SP-[0-9]+$';
  select count(*) + 1 into v from project_request where organization_id = eu.organization_id and opportunity_id = (p ->> 'oportunidadeId')::uuid and request_type = p ->> 'tipo';
  insert into project_request (organization_id, code, type_version, company_id, opportunity_id, inbox_thread_id, submission_id, source_record_id, lead_origin, request_type, priority,
    requested_due, commercial_owner_id, technical_team, created_by)
  values (eu.organization_id, 'SP-' || lpad(n::text, 4, '0'), v, (p ->> 'empresaId')::uuid, (p ->> 'oportunidadeId')::uuid, nullif(p -> 'vinculos' ->> 'inboxThreadId', '')::uuid,
    nullif(p -> 'vinculos' ->> 'submissaoId', ''), nullif(p -> 'vinculos' ->> 'registroFonteId', '')::uuid, p ->> 'origemLead', p ->> 'tipo', p ->> 'prioridade',
    nullif(p ->> 'prazoSolicitado', '')::date, coalesce(nullif(p ->> 'responsavelComercialId', '')::uuid, eu.id), nullif(p ->> 'equipeTecnica', ''), eu.id)
  returning * into r;
  for k, val in select * from jsonb_each(dados) loop
    insert into project_request_field (request_id, organization_id, field_key, value, updated_by) values (r.id, r.organization_id, k, val, eu.id);
  end loop;
  foreach t in array array['arquitetura','implantacao','topografia','sondagem','memorial','complementar'] loop
    insert into project_request_document (request_id, organization_id, doc_type, status, updated_by, updated_at, received_at)
    values (r.id, r.organization_id, t, coalesce(p -> 'documentos' ->> t, 'nao_necessario'), eu.id, now(), case when p -> 'documentos' ->> t = 'recebido' then now() end);
  end loop;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, detail, intent, changes)
  values (r.organization_id, r.id, 'criar', null, 'SOLICITADO', eu.id, eu.role::text, r.request_type || ' · versão ' || r.type_version, p_intencao,
    jsonb_build_array(jsonb_build_object('dados', dados)));
  return pp_json(r, false);
end $$;

-- ações: a MESMA tabela de REGRAS_ACAO, na mesma ordem de conferência do motor. Atômica; idempotente pela intenção.
create or replace function pp_transicionar(p_id uuid, p_acao text, p_dados jsonb, p_versao integer, p_intencao text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu profile%rowtype; r project_request%rowtype; de_ok text[]; para text; lado text; motivo text := nullif(trim(coalesce(p_dados ->> 'motivo', '')), '');
  gestao boolean; eng boolean; de_atual text; detalhe text; mudancas jsonb := '[]'::jsonb; usada uuid; k text; val jsonb; novos jsonb; doc_tipo text; doc_sit text; n integer;
begin
  eu := pp_eu();
  if coalesce(p_intencao, '') = '' then raise exception 'PP:DADOS_INCOMPLETOS: intenção ausente'; end if;
  if length(coalesce(p_dados::text, '')) > 20000 then raise exception 'PP:DADOS_INCOMPLETOS: dados grandes demais'; end if;
  if length(coalesce(motivo, '')) > 1000 then raise exception 'PP:DADOS_INCOMPLETOS: motivo passa de 1000 caracteres'; end if;
  gestao := pp_gestao_role(); eng := pp_engenharia_role();
  select * into r from project_request where id = p_id and organization_id = eu.organization_id for update;
  if r.id is null or not (gestao or pp_engenharia_ve(r.status, r.technical_owner_id)) then raise exception 'PP:SEM_PERMISSAO: solicitação não visível para este perfil'; end if;
  select request_id into usada from project_request_event where organization_id = eu.organization_id and intent = p_intencao;
  if usada = r.id then return pp_json(r, not gestao); end if;
  if usada is not null then raise exception 'PP:DADOS_INCOMPLETOS: intenção já usada em outra solicitação'; end if;
  if r.status in ('ENCERRADO','CANCELADO') then raise exception 'PP:ESTADO_FINAL: % não admite alteração', r.status; end if;
  de_atual := r.status; para := r.status;
  case p_acao
    when 'iniciar_triagem' then de_ok := array['SOLICITADO']; para := 'TRIAGEM_TECNICA'; lado := 'engenharia';
    when 'registrar_triagem' then de_ok := array['TRIAGEM_TECNICA']; lado := 'engenharia';
    when 'pedir_dados' then de_ok := array['TRIAGEM_TECNICA','EM_DESENVOLVIMENTO']; para := 'DADOS_PENDENTES'; lado := 'engenharia';
    when 'responder_pendencias' then de_ok := array['DADOS_PENDENTES']; para := 'TRIAGEM_TECNICA'; lado := 'comercial';
    when 'assumir_desenvolvimento' then de_ok := array['TRIAGEM_TECNICA']; para := 'EM_DESENVOLVIMENTO'; lado := 'engenharia';
    when 'registrar_andamento' then de_ok := array['EM_DESENVOLVIMENTO']; lado := 'engenharia';
    when 'entregar' then de_ok := array['EM_DESENVOLVIMENTO']; para := 'ENTREGUE'; lado := 'engenharia';
    when 'reabrir' then de_ok := array['ENTREGUE']; para := 'EM_DESENVOLVIMENTO'; lado := 'comercial';
    when 'encerrar' then de_ok := array['ENTREGUE']; para := 'ENCERRADO'; lado := 'comercial';
    when 'cancelar' then de_ok := array['SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO']; para := 'CANCELADO'; lado := 'comercial';
    when 'atribuir' then de_ok := array['SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO']; lado := 'engenharia';
    when 'atualizar_documento' then de_ok := array['SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO','ENTREGUE']; lado := 'comercial';
    when 'editar_dados' then de_ok := array['SOLICITADO','DADOS_PENDENTES']; lado := 'comercial';
    else raise exception 'PP:TRANSICAO_INVALIDA: ação desconhecida: %', p_acao;
  end case;
  if not (r.status = any (de_ok)) then raise exception 'PP:TRANSICAO_INVALIDA: não dá para % em %', p_acao, r.status; end if;
  if lado = 'comercial' and not gestao
     and not (p_acao = 'cancelar' and eng and r.status in ('SOLICITADO','TRIAGEM_TECNICA'))
     and not (p_acao = 'atualizar_documento' and eng) then raise exception 'PP:SEM_PERMISSAO: ação do Comercial'; end if;
  if lado = 'engenharia' and not (gestao or eng) then raise exception 'PP:SEM_PERMISSAO: ação da Engenharia'; end if;
  if not gestao and r.technical_owner_id is not null and r.technical_owner_id <> eu.id then raise exception 'PP:SEM_PERMISSAO: só o responsável técnico age nesta solicitação'; end if;
  if p_versao is distinct from r.version then raise exception 'PP:VERSAO_DESATUALIZADA: a solicitação mudou desde que você abriu'; end if;
  if p_acao in ('pedir_dados','reabrir','cancelar') and coalesce(length(motivo), 0) < 5 then raise exception 'PP:MOTIVO_OBRIGATORIO: informe o motivo'; end if;

  if p_acao in ('iniciar_triagem','atribuir') then
    if p_acao = 'atribuir' and nullif(p_dados ->> 'responsavelTecnicoId', '') is null and nullif(p_dados ->> 'equipeTecnica', '') is null then raise exception 'PP:DADOS_INCOMPLETOS: escolha a equipe ou o responsável técnico'; end if;
    mudancas := jsonb_build_array(jsonb_build_object('campo', 'responsavelTecnicoId', 'de', r.technical_owner_id, 'para', coalesce(nullif(p_dados ->> 'responsavelTecnicoId', '')::uuid, case when p_acao = 'iniciar_triagem' then coalesce(r.technical_owner_id, eu.id) else r.technical_owner_id end)));
    r.technical_owner_id := coalesce(nullif(p_dados ->> 'responsavelTecnicoId', '')::uuid, case when p_acao = 'iniciar_triagem' then coalesce(r.technical_owner_id, eu.id) else r.technical_owner_id end);
    r.technical_team := coalesce(nullif(p_dados ->> 'equipeTecnica', ''), r.technical_team);
  elsif p_acao = 'registrar_triagem' then
    select coalesce(jsonb_agg(f.field_key), '[]'::jsonb) into novos from project_request_field f
      where f.request_id = r.id and f.field_key in (select jsonb_array_elements_text(coalesce(p_dados -> 'validar', '[]'::jsonb)));
    if jsonb_array_length(novos) = 0 and nullif(trim(coalesce(p_dados ->> 'nota', '')), '') is null then raise exception 'PP:DADOS_INCOMPLETOS: valide ao menos um dado ou escreva a avaliação'; end if;
    update project_request_field set status = 'validado', validated_by = eu.id, validated_at = now(), updated_by = eu.id, updated_at = now()
      where request_id = r.id and field_key in (select jsonb_array_elements_text(novos));
    mudancas := jsonb_build_array(jsonb_build_object('validados', novos));
    detalhe := nullif(trim(coalesce(p_dados ->> 'nota', '')), '');
  elsif p_acao = 'pedir_dados' then
    n := 0;
    for val in select jsonb_array_elements(coalesce(p_dados -> 'pendencias', '[]'::jsonb)) loop
      if pp_texto(val) is null then continue; end if;
      insert into project_request_pending (organization_id, request_id, description, requested_by, answer_owner_id) values (r.organization_id, r.id, pp_texto(val), eu.id, r.commercial_owner_id);
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'PP:DADOS_INCOMPLETOS: liste as informações necessárias'; end if;
    detalhe := n || ' pendência(s)';
  elsif p_acao = 'responder_pendencias' then
    if coalesce(length(trim(p_dados ->> 'resposta')), 0) < 5 then raise exception 'PP:DADOS_INCOMPLETOS: responda o que foi providenciado'; end if;
    update project_request_pending set answer = trim(p_dados ->> 'resposta'), resolved_at = now(), resolved_by = eu.id, status = 'respondida' where request_id = r.id and status = 'aberta';
    detalhe := trim(p_dados ->> 'resposta');
  elsif p_acao = 'assumir_desenvolvimento' then
    r.delivery_due := coalesce(nullif(p_dados ->> 'prazoEntrega', '')::date, r.delivery_due);
    if r.delivery_due is null then raise exception 'PP:DADOS_INCOMPLETOS: informe o prazo de entrega'; end if;
    if exists (select 1 from project_request_pending x where x.request_id = r.id and x.status = 'aberta') then raise exception 'PP:DADOS_INCOMPLETOS: há pendências abertas'; end if;
    r.technical_owner_id := coalesce(r.technical_owner_id, eu.id);
    detalhe := 'prazo de entrega ' || to_char(r.delivery_due, 'DD/MM/YYYY');
  elsif p_acao = 'registrar_andamento' then
    detalhe := nullif(trim(coalesce(p_dados ->> 'nota', '')), '');
    if detalhe is null then raise exception 'PP:DADOS_INCOMPLETOS: descreva o andamento'; end if;
  elsif p_acao = 'entregar' then
    if coalesce(length(trim(p_dados -> 'entrega' ->> 'resumo')), 0) < 10 or coalesce(length(trim(p_dados -> 'entrega' ->> 'resultados')), 0) < 5 then raise exception 'PP:DADOS_INCOMPLETOS: descreva a entrega e os resultados técnicos'; end if;
    if exists (select 1 from project_request_document d where d.request_id = r.id and d.status = 'pendente') then raise exception 'PP:DADOS_INCOMPLETOS: documentos ainda pendentes'; end if;
    r.delivery := jsonb_build_object('em', now(), 'por', eu.id, 'resumo', trim(p_dados -> 'entrega' ->> 'resumo'), 'resultados', trim(p_dados -> 'entrega' ->> 'resultados'), 'referencias', coalesce(p_dados -> 'entrega' -> 'referencias', '[]'::jsonb));
    detalhe := trim(p_dados -> 'entrega' ->> 'resumo');
  elsif p_acao = 'reabrir' then
    r.delivery := null;
  elsif p_acao = 'encerrar' then
    if coalesce(p_dados -> 'resultado' ->> 'tipo', '') not in ('SEGUE_PARA_ORCAMENTO','ORCAMENTO_VINCULADO','NAO_SEGUIU') then raise exception 'PP:DADOS_INCOMPLETOS: informe como o atendimento segue'; end if;
    if p_dados -> 'resultado' ->> 'tipo' = 'ORCAMENTO_VINCULADO' then
      if nullif(p_dados -> 'resultado' ->> 'orcamentoId', '') is null then raise exception 'PP:DADOS_INCOMPLETOS: escolha o orçamento técnico'; end if;
      r.estimate_id := (p_dados -> 'resultado' ->> 'orcamentoId')::uuid;
    end if;
    if p_dados -> 'resultado' ->> 'tipo' = 'NAO_SEGUIU' and coalesce(length(motivo), 0) < 5 then raise exception 'PP:MOTIVO_OBRIGATORIO: informe por que o cliente não seguiu'; end if;
    r.outcome := p_dados -> 'resultado';
    detalhe := p_dados -> 'resultado' ->> 'tipo';
  elsif p_acao = 'atualizar_documento' then
    doc_tipo := p_dados -> 'documento' ->> 'tipo'; doc_sit := p_dados -> 'documento' ->> 'situacao';
    if doc_tipo is null or doc_tipo not in ('arquitetura','implantacao','topografia','sondagem','memorial','complementar') or doc_sit is null or doc_sit not in ('nao_necessario','pendente','recebido','validado') then raise exception 'PP:DADOS_INCOMPLETOS: documento inválido'; end if;
    if doc_sit in ('validado','nao_necessario') and not (gestao or eng) then raise exception 'PP:SEM_PERMISSAO: validar ou dispensar documento é da Engenharia'; end if;
    if doc_sit in ('pendente','recebido') and not gestao then raise exception 'PP:SEM_PERMISSAO: quem pede e recebe o documento do cliente é o Comercial'; end if;
    select jsonb_build_array(jsonb_build_object('documento', doc_tipo, 'de', d.status, 'para', doc_sit)) into mudancas from project_request_document d where d.request_id = r.id and d.doc_type = doc_tipo;
    update project_request_document set status = doc_sit, reference = coalesce(nullif(trim(p_dados -> 'documento' ->> 'referencia'), ''), reference), updated_by = eu.id, updated_at = now(),
      received_at = case when doc_sit = 'recebido' then now() else received_at end,
      validated_by = case when doc_sit = 'validado' then eu.id else validated_by end, validated_at = case when doc_sit = 'validado' then now() else validated_at end
      where request_id = r.id and doc_type = doc_tipo;
    detalhe := doc_tipo || ': ' || doc_sit;
  elsif p_acao = 'editar_dados' then
    novos := pp_dados(p_dados -> 'dados');
    -- mudanças: chaves enviadas com valor diferente, ou enviadas vazias (removidas)
    for k in select jsonb_object_keys(coalesce(p_dados -> 'dados', '{}'::jsonb)) loop
      if k not in ('cidade','uf','endereco','uso','areaM2','comprimentoM','larguraM','alturaM','tipologia','cobertura','fechamentos','projetoArquitetonico','fundacaoTerreno','observacoes') then continue; end if;
      select f.value into val from project_request_field f where f.request_id = r.id and f.field_key = k;
      if novos ? k then
        if val is distinct from novos -> k then
          insert into project_request_field (request_id, organization_id, field_key, value, status, updated_by) values (r.id, r.organization_id, k, novos -> k, 'declarado', eu.id)
            on conflict (request_id, field_key) do update set value = excluded.value, status = 'declarado', validated_by = null, validated_at = null, updated_by = eu.id, updated_at = now();
          mudancas := mudancas || jsonb_build_object('campo', k, 'de', val, 'para', novos -> k);
        end if;
      elsif val is not null then
        -- remoção de campo: a linha é apagada pela regra (o trigger de delete fica de fora: só esta função remove campo)
        perform set_config('pp.remover_campo', 'sim', true);
        delete from project_request_field where request_id = r.id and field_key = k;
        perform set_config('pp.remover_campo', '', true);
        mudancas := mudancas || jsonb_build_object('campo', k, 'de', val, 'para', null);
      end if;
    end loop;
    if jsonb_array_length(mudancas) = 0 then raise exception 'PP:DADOS_INCOMPLETOS: nada mudou'; end if;
    perform pp_conferir_dados((select coalesce(jsonb_object_agg(f.field_key, f.value), '{}'::jsonb) from project_request_field f where f.request_id = r.id));
    detalhe := 'alterou ' || jsonb_array_length(mudancas) || ' dado(s)';
  end if;

  update project_request set status = para, technical_owner_id = r.technical_owner_id, technical_team = r.technical_team, delivery_due = r.delivery_due,
    delivery = r.delivery, outcome = r.outcome, estimate_id = r.estimate_id, reason = coalesce(case when length(coalesce(motivo, '')) >= 5 then motivo end, reason),
    version = version + 1, updated_at = now()
  where id = r.id returning * into r;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, reason, detail, changes, intent)
  values (r.organization_id, r.id, p_acao, de_atual, para, eu.id, eu.role::text, case when length(coalesce(motivo, '')) >= 5 then motivo end, detalhe, mudancas, p_intencao);
  return pp_json(r, not gestao);
end $$;

-- o trigger de delete de campo só aceita a remoção feita por pp_transicionar (editar_dados)
create or replace function project_request_field_delete() returns trigger language plpgsql as $$
begin
  if current_setting('pp.remover_campo', true) = 'sim' then return old; end if;
  raise exception 'PP:SEM_PERMISSAO: dados técnicos só mudam pelas ações da solicitação';
end $$;
drop trigger if exists project_request_field_sem_delete on project_request_field;
create trigger project_request_field_sem_delete before delete on project_request_field for each row execute function project_request_field_delete();

-- ====================================================================================== documentos (arquivos)

-- bucket PRÓPRIO, privado (nunca o de anexos financeiros): <organization_id>/<request_id>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projetos-tecnicos', 'projetos-tecnicos', false, 26214400, array['application/pdf','image/png','image/jpeg','image/webp','application/zip','image/vnd.dwg','application/acad','application/dxf'])
on conflict (id) do nothing;

-- quem anexa: o Comercial anexa documentos do cliente; a Engenharia (responsável ou triagem) anexa documentos técnicos e o entregável
create or replace function pp_pode_anexar(p_id uuid, p_tipo text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from project_request r where r.id = p_id and r.organization_id = current_org() and r.status not in ('ENCERRADO','CANCELADO')
    and (pp_gestao_role() or (pp_engenharia_ve(r.status, r.technical_owner_id) and (r.technical_owner_id is null or r.technical_owner_id = auth.uid()))))
$$;
-- caminho → solicitação (para as políticas do storage)
create or replace function pp_pedido_do_caminho(p_nome text) returns uuid language sql immutable as $$
  select case when (storage.foldername(p_nome))[2] ~ '^[0-9a-f-]{36}$' then (storage.foldername(p_nome))[2]::uuid end
$$;
drop policy if exists projetos_tecnicos_select on storage.objects;
create policy projetos_tecnicos_select on storage.objects for select to authenticated using (bucket_id = 'projetos-tecnicos' and pp_ve_pedido(pp_pedido_do_caminho(name)));
drop policy if exists projetos_tecnicos_insert on storage.objects;
create policy projetos_tecnicos_insert on storage.objects for insert to authenticated with check (bucket_id = 'projetos-tecnicos'
  and (storage.foldername(name))[1] = current_org()::text and pp_pode_anexar(pp_pedido_do_caminho(name), 'qualquer'));
-- sem UPDATE/DELETE de objeto pelo app: nova versão é novo objeto; remoção é lógica

create or replace function pp_doc_preparar(p_id uuid, p_tipo text, p_extensao text) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype;
begin
  eu := pp_eu();
  if p_tipo not in ('arquitetura','implantacao','topografia','sondagem','memorial','complementar','entregavel') then raise exception 'PP:DADOS_INCOMPLETOS: tipo de documento inválido'; end if;
  if p_extensao !~ '^(pdf|png|jpg|jpeg|webp|zip|dwg|dxf)$' then raise exception 'PP:DADOS_INCOMPLETOS: extensão não aceita'; end if;
  if not pp_pode_anexar(p_id, p_tipo) then raise exception 'PP:SEM_PERMISSAO: sem permissão para anexar nesta solicitação'; end if;
  if p_tipo = 'entregavel' and pp_gestao_role() is false and not exists (select 1 from project_request r where r.id = p_id and r.technical_owner_id = eu.id) then raise exception 'PP:SEM_PERMISSAO: o entregável é do responsável técnico'; end if;
  return eu.organization_id::text || '/' || p_id::text || '/' || gen_random_uuid()::text || '.' || p_extensao;
end $$;

create or replace function pp_doc_registrar(p_id uuid, p_tipo text, p_caminho text, p_nome text, p_mime text, p_tamanho bigint, p_intencao text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype; r project_request%rowtype; v integer; f project_request_file%rowtype; usada uuid; meta jsonb;
begin
  eu := pp_eu();
  if coalesce(p_intencao, '') = '' then raise exception 'PP:DADOS_INCOMPLETOS: intenção ausente'; end if;
  select * into f from project_request_file where storage_path = p_caminho;
  if f.id is not null then
    if f.request_id <> p_id then raise exception 'PP:VINCULO_INVALIDO: arquivo de outra solicitação'; end if;
    return jsonb_build_object('id', f.id, 'versao', f.version, 'caminho', f.storage_path);
  end if;
  select * into r from project_request where id = p_id and organization_id = eu.organization_id for update;
  if r.id is null or not pp_pode_anexar(p_id, p_tipo) then raise exception 'PP:SEM_PERMISSAO: sem permissão para anexar nesta solicitação'; end if;
  if split_part(p_caminho, '/', 1) <> eu.organization_id::text or split_part(p_caminho, '/', 2) <> p_id::text then raise exception 'PP:VINCULO_INVALIDO: caminho fora da pasta da solicitação'; end if;
  select o.metadata into meta from storage.objects o where o.bucket_id = 'projetos-tecnicos' and o.name = p_caminho;
  if not found then raise exception 'PP:DADOS_INCOMPLETOS: arquivo não encontrado no armazenamento'; end if;
  -- o declarado tem de bater com o que o Storage registrou do objeto (no Supabase: metadata.mimetype e metadata.size)
  if meta ? 'mimetype' and meta ->> 'mimetype' <> p_mime then raise exception 'PP:DADOS_INCOMPLETOS: tipo declarado difere do arquivo enviado'; end if;
  if meta ? 'size' and (meta ->> 'size')::bigint <> p_tamanho then raise exception 'PP:DADOS_INCOMPLETOS: tamanho declarado difere do arquivo enviado'; end if;
  select request_id into usada from project_request_event where organization_id = eu.organization_id and intent = p_intencao;
  if usada is not null then raise exception 'PP:DADOS_INCOMPLETOS: intenção já usada'; end if;
  select coalesce(max(version), 0) + 1 into v from project_request_file where request_id = p_id and doc_type = p_tipo;
  insert into project_request_file (organization_id, request_id, doc_type, version, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (r.organization_id, p_id, p_tipo, v, p_caminho, p_nome, p_mime, p_tamanho, eu.id) returning * into f;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, detail, changes, intent)
  values (r.organization_id, p_id, 'anexar_arquivo', r.status, r.status, eu.id, eu.role::text, p_tipo || ' v' || v || ': ' || p_nome, jsonb_build_array(jsonb_build_object('arquivo', f.id, 'tipo', p_tipo, 'versao', v)), p_intencao);
  update project_request set version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('id', f.id, 'versao', v, 'caminho', f.storage_path);
end $$;

-- remoção LÓGICA (o arquivo e a linha ficam): quem enviou, ou a gestão comercial; com motivo
create or replace function pp_doc_remover(p_arquivo uuid, p_motivo text, p_intencao text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype; f project_request_file%rowtype; r project_request%rowtype;
begin
  eu := pp_eu();
  select * into f from project_request_file where id = p_arquivo and organization_id = eu.organization_id for update;
  if f.id is null or not pp_ve_pedido(f.request_id) then raise exception 'PP:SEM_PERMISSAO: arquivo não visível'; end if;
  if f.removed_at is not null then return; end if;
  if not (pp_gestao_role() or f.uploaded_by = eu.id) then raise exception 'PP:SEM_PERMISSAO: só quem enviou ou a gestão comercial remove'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'PP:MOTIVO_OBRIGATORIO: informe o motivo da remoção'; end if;
  select * into r from project_request where id = f.request_id;
  update project_request_file set removed_at = now(), removed_by = eu.id, removal_reason = trim(p_motivo) where id = f.id;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, reason, detail, intent)
  values (f.organization_id, f.request_id, 'remover_arquivo', r.status, r.status, eu.id, eu.role::text, trim(p_motivo), f.doc_type || ' v' || f.version, p_intencao);
end $$;
-- a versão de arquivo é imutável, exceto a marcação de remoção feita acima
create or replace function project_request_file_update() returns trigger language plpgsql as $$
begin
  if (new.id, new.organization_id, new.request_id, new.doc_type, new.version, new.storage_path, new.file_name, new.mime_type, new.size_bytes, new.uploaded_by, new.uploaded_at)
     is distinct from (old.id, old.organization_id, old.request_id, old.doc_type, old.version, old.storage_path, old.file_name, old.mime_type, old.size_bytes, old.uploaded_by, old.uploaded_at)
     or old.removed_at is not null then raise exception 'PP:SEM_PERMISSAO: versão de arquivo é imutável'; end if;
  return new;
end $$;
drop trigger if exists project_request_file_imutavel on project_request_file;
create trigger project_request_file_imutavel before update on project_request_file for each row execute function project_request_file_update();

-- ====================================================================================== privilégios
--
-- O PostgreSQL concede EXECUTE a PUBLIC em toda função nova, e o Supabase ainda concede a anon e authenticated por
-- privilégio padrão do schema. Por isso cada função desta proposta tem a sua linha abaixo, nos TRÊS grupos — e nada fora
-- deles: nenhuma função existente do CRM é tocada. Aplicar a proposta INTEIRA numa única transação (BEGIN … COMMIT), para
-- que criação e revogação aconteçam juntas, sem janela em que a função exista com EXECUTE aberto.

-- 1) INTERNAS: só o dono (chamadas de dentro das funções security definer ou por gatilho). pp_json aceita uma linha
--    montada pelo chamador: com EXECUTE, qualquer usuário leria a visão comercial de qualquer solicitação pelo id.
revoke all on function pp_json(project_request, boolean), pp_eu(), pp_texto(jsonb), pp_dados(jsonb), pp_conferir_dados(jsonb),
  pp_engenharia_role(), pp_engenharia_ve(text, uuid),
  project_request_coerencia(), project_request_imutavel(), project_request_field_delete(), project_request_file_update()
  from public, anon, authenticated;

-- 2) USADAS DENTRO DE POLÍTICAS (RLS das tabelas e do Storage rodam com o papel de quem consulta): só authenticated.
--    Devolvem só um booleano sobre o próprio usuário (ou o caminho), nunca dado da solicitação.
revoke all on function pp_gestao_role(), pp_ve_pedido(uuid), pp_pode_anexar(uuid, text), pp_pedido_do_caminho(text) from public, anon, authenticated;
grant execute on function pp_gestao_role(), pp_ve_pedido(uuid), pp_pode_anexar(uuid, text), pp_pedido_do_caminho(text) to authenticated;

-- 3) API (RPC do adaptador): só authenticated; cada uma confere o perfil, a organização e a regra por dentro.
revoke all on function pp_criar(jsonb, text), pp_transicionar(uuid, text, jsonb, integer, text), pp_listar(), pp_obter(uuid), pp_eventos(uuid), pp_arquivos(uuid),
  pp_doc_preparar(uuid, text, text), pp_doc_registrar(uuid, text, text, text, text, bigint, text), pp_doc_remover(uuid, text, text) from public, anon, authenticated;
grant execute on function pp_criar(jsonb, text), pp_transicionar(uuid, text, jsonb, integer, text), pp_listar(), pp_obter(uuid), pp_eventos(uuid), pp_arquivos(uuid),
  pp_doc_preparar(uuid, text, text), pp_doc_registrar(uuid, text, text, text, text, bigint, text), pp_doc_remover(uuid, text, text) to authenticated;

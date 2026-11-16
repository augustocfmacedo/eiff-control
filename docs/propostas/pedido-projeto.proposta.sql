-- PROPOSTA — NÃO APLICAR SEM AUTORIZAÇÃO DA DIREÇÃO (E11.2A, docs/central-gestao-comercial.md §12).
--
-- Fora de supabase/migrations de propósito: o número só é escolhido na hora de aplicar, coordenado com as outras frentes
-- (conferir repositório E schema real; não há ledger). DEPENDE de docs/propostas/comercial-acesso.proposta.sql PARTE 1
-- (valor 'Comercial' no enum role_kind). Ordem: Segurança S3 → comercial-acesso parte 1 → parte 2 → esta.
-- Prova local: node scripts/pg-smoke-pedido-projeto.mjs (PGlite em memória, fila inteira + as duas propostas).
--
-- Espelha src/core/comercial/pedidoProjeto.ts (REGRAS_ACAO, CAMPOS_TECNICOS, idempotência, uma aberta por oportunidade
-- e tipo). A solicitação é TÉCNICA por construção: nenhuma coluna de valor, probabilidade, negociação ou contato; empresa,
-- oportunidade, conversa, submissão, evidência e orçamento só como referência por id, conferida no banco. A Engenharia
-- lê pela pp_visao_tecnica(), que não devolve a oportunidade nem os vínculos e traz só o NOME da empresa — ela não
-- precisa ler radar_* nem inbox_*. Escrita só por pp_criar / pp_transicionar (security definer, papel no perfil, evento
-- na mesma transação, intenção única). Sem DELETE.

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
  -- {chave: {dado, situacao: declarado|validado, validadoPor?, validadoEm?}} — chaves do catálogo CAMPOS_TECNICOS
  technical_data jsonb not null default '{}'::jsonb,
  -- {tipo: {situacao: nao_necessario|pendente|recebido|validado, referencia?, atualizadoPor?, atualizadoEm?}}
  documents jsonb not null default '{}'::jsonb,
  technical_team text,
  technical_owner_id uuid references profile(id),
  delivery_due date,
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO','ENTREGUE','ENCERRADO','CANCELADO')),
  pending_items jsonb not null default '[]'::jsonb,
  delivery jsonb,
  outcome jsonb,
  reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null references profile(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  constraint project_request_tecnica check (not jsonb_tem_chave_profunda(technical_data || documents || jsonb_build_object('p', pending_items, 'd', coalesce(delivery, '{}'::jsonb), 'o', coalesce(outcome, '{}'::jsonb)),
    array['valor','valorEstimado','estimated_value','probabilidade','probability','negociacao','contato','telefone','phone','email','whatsapp','mensagem']))
);
-- uma solicitação ABERTA por oportunidade e tipo (a seguinte, depois de encerrada ou cancelada, é a versão nova)
create unique index if not exists project_request_aberta_uk on project_request (organization_id, opportunity_id, request_type) where status not in ('ENCERRADO','CANCELADO');

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
  intent text not null,
  occurred_at timestamptz not null default now()
);
-- idempotência: a mesma intenção nunca produz dois eventos (nem duas solicitações)
create unique index if not exists project_request_event_intencao_uk on project_request_event (organization_id, intent);

create or replace function pp_gestao_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Comercial')
$$;
create or replace function pp_engenharia_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Engenharia')
$$;

alter table project_request enable row level security;
alter table project_request_event enable row level security;
drop policy if exists project_request_select on project_request;
-- colunas da própria linha + helpers que leem só profile (regra do projeto para SELECT)
create policy project_request_select on project_request for select using (organization_id = current_org() and pp_gestao_role());
drop policy if exists project_request_event_select on project_request_event;
create policy project_request_event_select on project_request_event for select using (organization_id = current_org() and (pp_gestao_role() or pp_engenharia_role()));
revoke all on project_request, project_request_event from anon;
revoke insert, update, delete, truncate on project_request, project_request_event from authenticated;
grant select on project_request, project_request_event to authenticated;
-- a Engenharia NÃO lê a tabela (que tem oportunidade e vínculos): só pp_visao_tecnica()

-- coerência referencial e vínculos por id (as FKs não conferem organização nem a empresa de cada vínculo)
create or replace function project_request_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from radar_company c where c.id = new.company_id and c.organization_id = new.organization_id) then raise exception 'empresa de outra organização' using errcode = '23514'; end if;
  if not exists (select 1 from radar_opportunity o where o.id = new.opportunity_id and o.organization_id = new.organization_id and o.company_id = new.company_id) then raise exception 'oportunidade não é desta empresa' using errcode = '23514'; end if;
  if tg_op = 'INSERT' and exists (select 1 from radar_opportunity o where o.id = new.opportunity_id and o.stage in ('WON','LOST','NURTURE')) then raise exception 'oportunidade não está ativa' using errcode = '23514'; end if;
  if new.inbox_thread_id is not null and not exists (select 1 from inbox_thread t where t.id = new.inbox_thread_id and t.organization_id = new.organization_id) then raise exception 'conversa do Inbox não encontrada' using errcode = '23514'; end if;
  if new.submission_id is not null and not exists (select 1 from inbox_message m where m.external_message_id = new.submission_id and m.organization_id = new.organization_id) then raise exception 'submissão não encontrada' using errcode = '23514'; end if;
  if new.source_record_id is not null and not exists (select 1 from radar_source_record r where r.id = new.source_record_id and r.organization_id = new.organization_id and r.intake_status = 'RESOLVED' and r.entity_id = new.company_id) then raise exception 'evidência do Lead Engine não promovida para esta empresa' using errcode = '23514'; end if;
  if new.estimate_id is not null and not exists (select 1 from estimate e where e.id = new.estimate_id and e.organization_id = new.organization_id) then raise exception 'orçamento de outra organização' using errcode = '23514'; end if;
  if not exists (select 1 from profile p where p.id = new.commercial_owner_id and p.organization_id = new.organization_id) then raise exception 'responsável comercial de outra organização' using errcode = '23514'; end if;
  if new.technical_owner_id is not null and not exists (select 1 from profile p where p.id = new.technical_owner_id and p.organization_id = new.organization_id and p.role in ('Engenharia','Administrador','Diretoria')) then raise exception 'responsável técnico inválido' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists project_request_coerencia on project_request;
create trigger project_request_coerencia before insert or update on project_request for each row execute function project_request_coerencia();

create or replace function project_request_event_imutavel() returns trigger language plpgsql as $$
begin raise exception 'histórico da solicitação é imutável' using errcode = '42501'; end $$;
drop trigger if exists project_request_event_imutavel on project_request_event;
create trigger project_request_event_imutavel before update or delete on project_request_event for each row execute function project_request_event_imutavel();

-- dados declarados → technical_data (sempre declarado); só chaves do catálogo
create or replace function pp_dados_declarados(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('dado', v, 'situacao', 'declarado')), '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb)) as e(k, v)
  where k = any (array['cidade','uf','endereco','uso','areaM2','comprimentoM','larguraM','alturaM','tipologia','cobertura','fechamentos','projetoArquitetonico','fundacaoTerreno','observacoes'])
    and v is not null and v <> 'null'::jsonb and trim(both '"' from v::text) <> ''
$$;

-- criar: nasce SOLICITADO (encaminhada à Engenharia). Idempotente pela intenção.
create or replace function pp_criar(p jsonb, p_intencao text) returns project_request language plpgsql security definer set search_path = public, pg_temp as $$
declare eu profile%rowtype; r project_request%rowtype; n integer; v integer; dados jsonb; existente uuid;
begin
  select * into eu from profile where id = auth.uid() and active and role <> 'Solicitante';
  if eu.id is null or not pp_gestao_role() then raise exception 'sem permissão para abrir solicitação de projeto' using errcode = '42501'; end if;
  if coalesce(p_intencao, '') = '' then raise exception 'intenção ausente' using errcode = '22023'; end if;
  select request_id into existente from project_request_event where organization_id = eu.organization_id and intent = p_intencao;
  if existente is not null then select * into r from project_request where id = existente; return r; end if;
  dados := pp_dados_declarados(p->'dados');
  if coalesce(dados->'cidade'->>'dado', '') = '' or coalesce(dados->'uf'->>'dado', '') = '' or (select count(*) from jsonb_object_keys(dados) k where k not in ('cidade','uf')) = 0 then
    raise exception 'dados técnicos incompletos' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtext(eu.organization_id::text || ':SP'));
  select coalesce(max(substring(code from 4)::integer), 0) + 1 into n from project_request where organization_id = eu.organization_id and code ~ '^SP-[0-9]+$';
  select count(*) + 1 into v from project_request where organization_id = eu.organization_id and opportunity_id = (p->>'oportunidadeId')::uuid and request_type = p->>'tipo';
  insert into project_request (organization_id, code, type_version, company_id, opportunity_id, inbox_thread_id, submission_id, source_record_id, lead_origin, request_type, priority,
    requested_due, commercial_owner_id, technical_data, documents, technical_team, created_by)
  values (eu.organization_id, 'SP-' || lpad(n::text, 4, '0'), v, (p->>'empresaId')::uuid, (p->>'oportunidadeId')::uuid, nullif(p->'vinculos'->>'inboxThreadId', '')::uuid,
    nullif(p->'vinculos'->>'submissaoId', ''), nullif(p->'vinculos'->>'registroFonteId', '')::uuid, p->>'origemLead', p->>'tipo', p->>'prioridade',
    nullif(p->>'prazoSolicitado', '')::date, coalesce(nullif(p->>'responsavelComercialId', '')::uuid, eu.id), dados,
    coalesce((select jsonb_object_agg(t, jsonb_build_object('situacao', coalesce(p->'documentos'->>t, 'nao_necessario'))) from unnest(array['arquitetura','implantacao','topografia','sondagem','memorial','complementar']) t), '{}'::jsonb),
    nullif(p->>'equipeTecnica', ''), eu.id)
  returning * into r;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, detail, intent)
  values (r.organization_id, r.id, 'criar', null, 'SOLICITADO', eu.id, eu.role::text, r.request_type || ' · versão ' || r.type_version, p_intencao);
  return r;
end $$;

-- ações: a MESMA tabela de REGRAS_ACAO. Idempotente pela intenção; estados finais não mudam.
create or replace function pp_transicionar(p_id uuid, p_acao text, p_dados jsonb, p_versao integer, p_intencao text) returns project_request language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu profile%rowtype; r project_request%rowtype; de_ok text[]; para text; lado text; motivo text := nullif(trim(coalesce(p_dados->>'motivo', '')), '');
  gestao boolean; eng boolean; itens jsonb; de_atual text; detalhe text; doc_tipo text; doc_sit text; existente uuid;
begin
  select * into eu from profile where id = auth.uid() and active and role <> 'Solicitante';
  if eu.id is null then raise exception 'sem perfil ativo' using errcode = '42501'; end if;
  if coalesce(p_intencao, '') = '' then raise exception 'intenção ausente' using errcode = '22023'; end if;
  gestao := pp_gestao_role(); eng := pp_engenharia_role();
  select * into r from project_request where id = p_id and organization_id = eu.organization_id for update;
  if r.id is null or not (gestao or eng) then raise exception 'solicitação não visível' using errcode = '42501'; end if;
  select request_id into existente from project_request_event where organization_id = eu.organization_id and intent = p_intencao;
  if existente = r.id then return r; end if;
  if r.status in ('ENCERRADO','CANCELADO') then raise exception 'estado final não admite alteração' using errcode = '23514'; end if;
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
    when 'atualizar_documento' then de_ok := array['SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO','ENTREGUE']; lado := 'documento';
    when 'editar_dados' then de_ok := array['SOLICITADO','DADOS_PENDENTES']; lado := 'comercial';
    else raise exception 'ação desconhecida: %', p_acao using errcode = '22023';
  end case;
  if not (r.status = any (de_ok)) then raise exception 'transição inválida: % em %', p_acao, r.status using errcode = '23514'; end if;
  if lado = 'comercial' and not gestao and not (p_acao = 'cancelar' and eng and r.status in ('SOLICITADO','TRIAGEM_TECNICA')) then raise exception 'ação do Comercial' using errcode = '42501'; end if;
  if lado = 'engenharia' and not (gestao or eng) then raise exception 'ação da Engenharia' using errcode = '42501'; end if;
  if p_versao is distinct from r.version then raise exception 'versão desatualizada' using errcode = '40001'; end if;
  if p_acao in ('pedir_dados','reabrir','cancelar') and coalesce(length(motivo), 0) < 5 then raise exception 'motivo obrigatório' using errcode = '23514'; end if;
  if p_acao in ('registrar_triagem','pedir_dados','assumir_desenvolvimento','registrar_andamento','entregar') and not gestao and r.technical_owner_id is not null and r.technical_owner_id <> eu.id then
    raise exception 'só o responsável técnico' using errcode = '42501'; end if;

  if p_acao in ('iniciar_triagem','atribuir') then
    r.technical_owner_id := coalesce(nullif(p_dados->>'responsavelTecnicoId', '')::uuid, case when p_acao = 'iniciar_triagem' then coalesce(r.technical_owner_id, eu.id) else r.technical_owner_id end);
    r.technical_team := coalesce(nullif(p_dados->>'equipeTecnica', ''), r.technical_team);
    if p_acao = 'atribuir' and nullif(p_dados->>'responsavelTecnicoId', '') is null and nullif(p_dados->>'equipeTecnica', '') is null then raise exception 'escolha equipe ou responsável' using errcode = '23514'; end if;
  elsif p_acao = 'registrar_triagem' then
    select coalesce(jsonb_object_agg(k, case when k in (select jsonb_array_elements_text(coalesce(p_dados->'validar', '[]'::jsonb))) then v || jsonb_build_object('situacao', 'validado', 'validadoPor', eu.id, 'validadoEm', now()) else v end), '{}'::jsonb)
      into r.technical_data from jsonb_each(r.technical_data) e(k, v);
    detalhe := nullif(trim(coalesce(p_dados->>'nota', '')), '');
  elsif p_acao = 'pedir_dados' then
    select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'descricao', trim(i), 'aberta', true, 'criadaEm', now(), 'criadaPor', eu.id)), '[]'::jsonb) into itens
      from jsonb_array_elements_text(coalesce(p_dados->'pendencias', '[]'::jsonb)) i where trim(i) <> '';
    if jsonb_array_length(itens) = 0 then raise exception 'liste as informações necessárias' using errcode = '23514'; end if;
    r.pending_items := r.pending_items || itens;
  elsif p_acao = 'responder_pendencias' then
    if coalesce(length(trim(p_dados->>'resposta')), 0) < 5 then raise exception 'responda o que foi providenciado' using errcode = '23514'; end if;
    select coalesce(jsonb_agg(case when (x->>'aberta')::boolean then x || jsonb_build_object('aberta', false, 'resolvidaEm', now(), 'resolvidaPor', eu.id, 'resposta', trim(p_dados->>'resposta')) else x end), '[]'::jsonb)
      into r.pending_items from jsonb_array_elements(r.pending_items) x;
  elsif p_acao = 'assumir_desenvolvimento' then
    r.delivery_due := coalesce(nullif(p_dados->>'prazoEntrega', '')::date, r.delivery_due);
    if r.delivery_due is null then raise exception 'prazo de entrega obrigatório' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(r.pending_items) x where (x->>'aberta')::boolean) then raise exception 'há pendências abertas' using errcode = '23514'; end if;
    r.technical_owner_id := coalesce(r.technical_owner_id, eu.id);
  elsif p_acao = 'registrar_andamento' then
    detalhe := nullif(trim(coalesce(p_dados->>'nota', '')), '');
    if detalhe is null then raise exception 'descreva o andamento' using errcode = '23514'; end if;
  elsif p_acao = 'entregar' then
    if coalesce(length(trim(p_dados->'entrega'->>'resumo')), 0) < 10 or coalesce(length(trim(p_dados->'entrega'->>'resultados')), 0) < 5 then raise exception 'descreva a entrega e os resultados' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_each(r.documents) d(k, v) where v->>'situacao' = 'pendente') then raise exception 'documentos pendentes' using errcode = '23514'; end if;
    r.delivery := jsonb_build_object('em', now(), 'por', eu.id, 'resumo', trim(p_dados->'entrega'->>'resumo'), 'resultados', trim(p_dados->'entrega'->>'resultados'), 'referencias', coalesce(p_dados->'entrega'->'referencias', '[]'::jsonb));
  elsif p_acao = 'reabrir' then
    r.delivery := null;
  elsif p_acao = 'encerrar' then
    if coalesce(p_dados->'resultado'->>'tipo', '') not in ('SEGUE_PARA_ORCAMENTO','ORCAMENTO_VINCULADO','NAO_SEGUIU') then raise exception 'informe como o atendimento segue' using errcode = '23514'; end if;
    if p_dados->'resultado'->>'tipo' = 'ORCAMENTO_VINCULADO' then r.estimate_id := (p_dados->'resultado'->>'orcamentoId')::uuid; end if;
    if p_dados->'resultado'->>'tipo' = 'NAO_SEGUIU' and coalesce(length(motivo), 0) < 5 then raise exception 'motivo obrigatório' using errcode = '23514'; end if;
    r.outcome := p_dados->'resultado';
  elsif p_acao = 'atualizar_documento' then
    doc_tipo := p_dados->'documento'->>'tipo'; doc_sit := p_dados->'documento'->>'situacao';
    if doc_tipo not in ('arquitetura','implantacao','topografia','sondagem','memorial','complementar') or doc_sit not in ('nao_necessario','pendente','recebido','validado') then raise exception 'documento inválido' using errcode = '22023'; end if;
    if doc_sit in ('validado','nao_necessario') and not (gestao or eng) then raise exception 'validar ou dispensar é da Engenharia' using errcode = '42501'; end if;
    if doc_sit in ('pendente','recebido') and not gestao then raise exception 'pedir e receber documento é do Comercial' using errcode = '42501'; end if;
    r.documents := r.documents || jsonb_build_object(doc_tipo, jsonb_strip_nulls(jsonb_build_object('situacao', doc_sit, 'referencia', p_dados->'documento'->>'referencia', 'atualizadoPor', eu.id, 'atualizadoEm', now())));
    detalhe := doc_tipo || ': ' || doc_sit;
  elsif p_acao = 'editar_dados' then
    r.technical_data := (select coalesce(jsonb_object_agg(k, case when (r.technical_data->k->'dado') = (pp_dados_declarados(p_dados->'dados')->k->'dado') then r.technical_data->k else pp_dados_declarados(p_dados->'dados')->k end), '{}'::jsonb)
      from jsonb_object_keys(pp_dados_declarados(p_dados->'dados')) k);
    if coalesce(r.technical_data->'cidade'->>'dado', '') = '' or coalesce(r.technical_data->'uf'->>'dado', '') = '' then raise exception 'dados técnicos incompletos' using errcode = '23514'; end if;
  end if;

  update project_request set status = para, technical_owner_id = r.technical_owner_id, technical_team = r.technical_team, technical_data = r.technical_data, documents = r.documents,
    pending_items = r.pending_items, delivery_due = r.delivery_due, delivery = r.delivery, outcome = r.outcome, estimate_id = r.estimate_id,
    reason = coalesce(motivo, reason), version = version + 1, updated_at = now()
  where id = r.id returning * into r;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, reason, detail, intent)
  values (r.organization_id, r.id, p_acao, de_atual, para, eu.id, eu.role::text, motivo, detalhe, p_intencao);
  return r;
end $$;

-- visão técnica: sem oportunidade, sem vínculos, com o NOME da empresa (não depende de ler radar_* ou inbox_*)
create or replace function pp_visao_tecnica() returns table (
  id uuid, code text, type_version integer, company_name text, lead_origin text, request_type text, priority text, requested_due date, commercial_owner_name text,
  technical_data jsonb, documents jsonb, technical_team text, technical_owner_id uuid, delivery_due date, status text, pending_items jsonb, delivery jsonb, reason text, version integer, updated_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.code, r.type_version, coalesce(c.trade_name, c.legal_name), r.lead_origin, r.request_type, r.priority, r.requested_due, pc.name,
    r.technical_data, r.documents, r.technical_team, r.technical_owner_id, r.delivery_due, r.status, r.pending_items, r.delivery, r.reason, r.version, r.updated_at
  from project_request r join radar_company c on c.id = r.company_id join profile pc on pc.id = r.commercial_owner_id
  where r.organization_id = current_org() and (pp_gestao_role() or pp_engenharia_role())
  order by r.updated_at desc
$$;

revoke all on function pp_criar(jsonb, text), pp_transicionar(uuid, text, jsonb, integer, text), pp_visao_tecnica(), pp_gestao_role(), pp_engenharia_role(), pp_dados_declarados(jsonb) from public, anon;
grant execute on function pp_criar(jsonb, text), pp_transicionar(uuid, text, jsonb, integer, text), pp_visao_tecnica(), pp_gestao_role(), pp_engenharia_role() to authenticated;
revoke all on function project_request_coerencia(), project_request_event_imutavel() from public, anon, authenticated;

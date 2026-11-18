-- PROPOSTA — NÃO APLICAR SEM AUTORIZAÇÃO DA DIREÇÃO (E11.2, preparada na E11.1F; docs/central-gestao-comercial.md §11).
--
-- Fora de supabase/migrations de propósito (número escolhido na hora de aplicar; conferir repositório E schema real).
-- DEPENDE de docs/propostas/comercial-acesso.proposta.sql PARTE 1 (valor 'Comercial' no enum role_kind): has_role com um
-- valor de enum inexistente falha na execução. Ordem: comercial-acesso parte 1 → parte 2 → esta.
-- Prova local: node scripts/pg-smoke-pedido-projeto.mjs (PGlite em memória, fila inteira + as duas propostas).
--
-- O pedido de projeto é o ENCAMINHAMENTO FORMAL Comercial → Engenharia → Comercial. Espelha src/core/comercial/pedidoProjeto.ts
-- (tabela de transições, lados, motivos, versão). É TÉCNICO por construção: nenhuma coluna de valor, probabilidade,
-- negociação ou contato do cliente; empresa e oportunidade só como referência. A Engenharia lê os pedidos ENCAMINHADOS
-- (situação <> RASCUNHO) sem precisar ler o Inbox Comercial nem o Radar: o nome da empresa vem por pp_visao_tecnica().
-- Escrita só pelas RPCs pp_criar e pp_transicionar (security definer, papel conferido no perfil, evento na mesma
-- transação). Sem DELETE.

create table if not exists project_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  company_id uuid not null references radar_company(id),
  opportunity_id uuid not null references radar_opportunity(id),
  project_id uuid references radar_project(id),
  origin text not null check (origin in ('SIMULADOR','INBOX','RADAR','REUNIAO','OUTRO')),
  origin_ref_kind text check (origin_ref_kind in ('submissao','conversa','candidato','atividade')),
  origin_ref_id text,
  inbox_thread_id uuid, -- referência lógica (sem FK: o Inbox segue independente)
  project_type text not null check (project_type in ('Galpão','Mezanino','Cobertura','Ampliação','Retrofit','Outro')),
  site jsonb not null default '{}'::jsonb,
  building jsonb not null default '{}'::jsonb,
  declared_data jsonb not null default '[]'::jsonb,
  technical_note text,
  documents jsonb not null default '[]'::jsonb,
  pending_items jsonb not null default '[]'::jsonb,
  commercial_owner_id uuid not null references profile(id),
  technical_owner_id uuid references profile(id),
  due_date date,
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO','SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO','ENTREGUE','ENCERRADO','CANCELADO')),
  reason text,
  delivery jsonb,
  outcome jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null references profile(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  -- técnico por construção: nenhuma chave comercial ou de contato em nenhum nível dos jsonb
  constraint project_request_sem_comercial check (not jsonb_tem_chave_profunda(site || building || jsonb_build_object('d', declared_data, 'p', pending_items, 'x', coalesce(delivery, '{}'::jsonb), 'o', coalesce(outcome, '{}'::jsonb)),
    array['valor','valorEstimado','estimated_value','probabilidade','probability','negociacao','contato','telefone','phone','email','whatsapp','mensagem']))
);

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
  occurred_at timestamptz not null default now()
);

-- quem lê: gestão comercial vê tudo; Engenharia vê o encaminhado. Colunas da própria linha + helpers que leem só profile
-- (regra do projeto: SELECT nunca consulta a própria tabela por função STABLE).
create or replace function pp_gestao_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Comercial')
$$;
create or replace function pp_engenharia_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Engenharia')
$$;

alter table project_request enable row level security;
alter table project_request_event enable row level security;
drop policy if exists project_request_select on project_request;
create policy project_request_select on project_request for select using (
  organization_id = current_org() and (pp_gestao_role() or (pp_engenharia_role() and status <> 'RASCUNHO')));
drop policy if exists project_request_event_select on project_request_event;
create policy project_request_event_select on project_request_event for select using (
  organization_id = current_org() and exists (select 1 from project_request r where r.id = request_id));
revoke all on project_request, project_request_event from anon;
revoke insert, update, delete, truncate on project_request, project_request_event from authenticated;
grant select on project_request, project_request_event to authenticated;

-- coerência referencial (as FKs não conferem organização nem a empresa da oportunidade)
create or replace function project_request_coerencia() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from radar_company c where c.id = new.company_id and c.organization_id = new.organization_id) then raise exception 'empresa de outra organização' using errcode = '23514'; end if;
  if not exists (select 1 from radar_opportunity o where o.id = new.opportunity_id and o.organization_id = new.organization_id and o.company_id = new.company_id) then raise exception 'oportunidade não é desta empresa' using errcode = '23514'; end if;
  if not exists (select 1 from profile p where p.id = new.commercial_owner_id and p.organization_id = new.organization_id) then raise exception 'responsável comercial de outra organização' using errcode = '23514'; end if;
  if new.technical_owner_id is not null and not exists (select 1 from profile p where p.id = new.technical_owner_id and p.organization_id = new.organization_id and p.role in ('Engenharia','Administrador','Diretoria')) then raise exception 'responsável técnico inválido' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists project_request_coerencia on project_request;
create trigger project_request_coerencia before insert or update on project_request for each row execute function project_request_coerencia();

-- histórico append-only
create or replace function project_request_event_imutavel() returns trigger language plpgsql as $$
begin raise exception 'histórico do pedido é imutável' using errcode = '42501'; end $$;
drop trigger if exists project_request_event_imutavel on project_request_event;
create trigger project_request_event_imutavel before update or delete on project_request_event for each row execute function project_request_event_imutavel();

-- criar (só gestão comercial): nasce RASCUNHO
create or replace function pp_criar(p jsonb) returns project_request language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu profile%rowtype; r project_request%rowtype; n integer;
begin
  select * into eu from profile where id = auth.uid() and active and role <> 'Solicitante';
  if eu.id is null or not pp_gestao_role() then raise exception 'sem permissão para criar pedido de projeto' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(eu.organization_id::text || ':PP'));
  select coalesce(max(substring(code from 4)::integer), 0) + 1 into n from project_request where organization_id = eu.organization_id and code ~ '^PP-[0-9]+$';
  insert into project_request (organization_id, code, company_id, opportunity_id, project_id, origin, origin_ref_kind, origin_ref_id, inbox_thread_id, project_type,
    site, building, declared_data, technical_note, documents, commercial_owner_id, created_by)
  values (eu.organization_id, 'PP-' || lpad(n::text, 4, '0'), (p->>'empresaId')::uuid, (p->>'oportunidadeId')::uuid, nullif(p->>'projetoId', '')::uuid,
    coalesce(p->>'origem', 'OUTRO'), p->'origemRef'->>'tipo', p->'origemRef'->>'id', nullif(p->>'inboxThreadId', '')::uuid, coalesce(p->>'tipoProjeto', 'Galpão'),
    coalesce(p->'terreno', '{}'::jsonb), coalesce(p->'construcao', '{}'::jsonb), coalesce(p->'dadosDeclarados', '[]'::jsonb), p->>'observacaoTecnica',
    coalesce(p->'documentos', '[]'::jsonb), coalesce(nullif(p->>'responsavelComercialId', '')::uuid, eu.id), eu.id)
  returning * into r;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role)
  values (r.organization_id, r.id, 'criar', null, 'RASCUNHO', eu.id, eu.role::text);
  return r;
end $$;

-- transicionar: a MESMA tabela de src/core/comercial/pedidoProjeto.ts (TRANSICOES_PEDIDO)
create or replace function pp_transicionar(p_id uuid, p_acao text, p_dados jsonb, p_versao integer) returns project_request language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu profile%rowtype; r project_request%rowtype; para text; lado text; de_ok text[]; motivo text := nullif(trim(coalesce(p_dados->>'motivo', '')), '');
  gestao boolean; eng boolean; itens jsonb; de_atual text;
begin
  select * into eu from profile where id = auth.uid() and active and role <> 'Solicitante';
  if eu.id is null then raise exception 'sem perfil ativo' using errcode = '42501'; end if;
  gestao := pp_gestao_role(); eng := pp_engenharia_role();
  select * into r from project_request where id = p_id and organization_id = eu.organization_id for update;
  if r.id is null or not (gestao or (eng and r.status <> 'RASCUNHO')) then raise exception 'pedido não visível' using errcode = '42501'; end if;
  de_atual := r.status;
  case p_acao
    when 'enviar' then de_ok := array['RASCUNHO']; para := 'SOLICITADO'; lado := 'comercial';
    when 'iniciar_triagem' then de_ok := array['SOLICITADO']; para := 'TRIAGEM_TECNICA'; lado := 'engenharia';
    when 'aceitar' then de_ok := array['TRIAGEM_TECNICA']; para := 'EM_DESENVOLVIMENTO'; lado := 'engenharia';
    when 'pedir_dados' then de_ok := array['TRIAGEM_TECNICA','EM_DESENVOLVIMENTO']; para := 'DADOS_PENDENTES'; lado := 'engenharia';
    when 'responder_pendencias' then de_ok := array['DADOS_PENDENTES']; para := 'TRIAGEM_TECNICA'; lado := 'comercial';
    when 'entregar' then de_ok := array['EM_DESENVOLVIMENTO']; para := 'ENTREGUE'; lado := 'engenharia';
    when 'reabrir' then de_ok := array['ENTREGUE']; para := 'EM_DESENVOLVIMENTO'; lado := 'comercial';
    when 'encerrar' then de_ok := array['ENTREGUE']; para := 'ENCERRADO'; lado := 'comercial';
    when 'cancelar' then de_ok := array['RASCUNHO','SOLICITADO','TRIAGEM_TECNICA','DADOS_PENDENTES','EM_DESENVOLVIMENTO']; para := 'CANCELADO'; lado := 'comercial';
    else raise exception 'ação desconhecida: %', p_acao using errcode = '22023';
  end case;
  -- lado: a gestão comercial age pelos dois lados; a Engenharia só pelo seu (e recusa = cancelar na triagem)
  if not gestao and not (lado = 'engenharia' and eng) and not (p_acao = 'cancelar' and eng and r.status in ('SOLICITADO','TRIAGEM_TECNICA')) then
    raise exception 'ação do lado %', lado using errcode = '42501'; end if;
  if p_versao is distinct from r.version then raise exception 'versão desatualizada' using errcode = '40001'; end if;
  if not (r.status = any (de_ok)) then raise exception 'transição inválida: % em %', p_acao, r.status using errcode = '23514'; end if;
  if p_acao in ('pedir_dados','reabrir','cancelar') and coalesce(length(motivo), 0) < 5 then raise exception 'motivo obrigatório' using errcode = '23514'; end if;
  if p_acao in ('aceitar','pedir_dados','entregar') and not gestao and r.technical_owner_id is not null and r.technical_owner_id <> eu.id then
    raise exception 'só o responsável técnico' using errcode = '42501'; end if;

  if p_acao = 'enviar' and (coalesce(r.site->>'cidade', '') = '' or coalesce(r.site->>'uf', '') = '' or (r.building = '{}'::jsonb and jsonb_array_length(r.declared_data) = 0)) then
    raise exception 'dados incompletos para envio' using errcode = '23514'; end if;
  if p_acao = 'iniciar_triagem' then r.technical_owner_id := coalesce(nullif(p_dados->>'responsavelTecnicoId', '')::uuid, eu.id); end if;
  if p_acao = 'aceitar' then
    if nullif(p_dados->>'prazo', '') is null then raise exception 'prazo obrigatório' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(r.pending_items) x where (x->>'aberta')::boolean) then raise exception 'há pendências abertas' using errcode = '23514'; end if;
    r.due_date := (p_dados->>'prazo')::date;
  end if;
  if p_acao = 'pedir_dados' then
    select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'descricao', trim(i), 'aberta', true, 'criadaEm', now(), 'criadaPor', eu.id)), '[]'::jsonb) into itens
      from jsonb_array_elements_text(coalesce(p_dados->'pendencias', '[]'::jsonb)) i where trim(i) <> '';
    if jsonb_array_length(itens) = 0 then raise exception 'liste o que falta' using errcode = '23514'; end if;
    r.pending_items := r.pending_items || itens;
  end if;
  if p_acao = 'responder_pendencias' then
    select coalesce(jsonb_agg(case when (x->>'aberta')::boolean then x || jsonb_build_object('aberta', false, 'resolvidaEm', now(), 'resolvidaPor', eu.id) else x end), '[]'::jsonb)
      into r.pending_items from jsonb_array_elements(r.pending_items) x;
  end if;
  if p_acao = 'entregar' then
    if coalesce(length(trim(p_dados->'entrega'->>'resumo')), 0) < 10 then raise exception 'descreva a entrega' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(r.documents) x where x->>'situacao' = 'pendente') then raise exception 'documentos pendentes' using errcode = '23514'; end if;
    r.delivery := jsonb_build_object('em', now(), 'por', eu.id, 'resumo', trim(p_dados->'entrega'->>'resumo'), 'anexoIds', coalesce(p_dados->'entrega'->'anexoIds', '[]'::jsonb));
  end if;
  if p_acao = 'encerrar' then
    if p_dados->'resultado'->>'tipo' = 'ORCAMENTO_GERADO' and nullif(p_dados->'resultado'->>'orcamentoId', '') is null then raise exception 'vincule o orçamento' using errcode = '23514'; end if;
    if p_dados->'resultado'->>'tipo' = 'NAO_SEGUIU' and coalesce(length(motivo), 0) < 5 then raise exception 'motivo obrigatório' using errcode = '23514'; end if;
    if coalesce(p_dados->'resultado'->>'tipo', '') not in ('ORCAMENTO_GERADO','NAO_SEGUIU') then raise exception 'informe o resultado' using errcode = '23514'; end if;
    r.outcome := p_dados->'resultado';
  end if;

  update project_request set status = para, technical_owner_id = r.technical_owner_id, due_date = r.due_date, pending_items = r.pending_items,
    delivery = r.delivery, outcome = r.outcome, reason = coalesce(motivo, reason), version = version + 1, updated_at = now()
  where id = r.id returning * into r;
  insert into project_request_event (organization_id, request_id, action, from_status, to_status, actor_id, actor_role, reason)
  values (r.organization_id, r.id, p_acao, de_atual, para, eu.id, eu.role::text, motivo);
  return r;
end $$;

-- visão técnica: o que a Engenharia precisa, com o NOME da empresa e nada mais do Radar (não depende de ela ler radar_*)
create or replace function pp_visao_tecnica() returns table (
  id uuid, code text, company_name text, origin text, project_type text, site jsonb, building jsonb, declared_data jsonb, technical_note text,
  documents jsonb, pending_items jsonb, commercial_owner_name text, technical_owner_id uuid, due_date date, status text, reason text, delivery jsonb, version integer, updated_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.code, coalesce(c.trade_name, c.legal_name), r.origin, r.project_type, r.site, r.building, r.declared_data, r.technical_note,
    r.documents, r.pending_items, pc.name, r.technical_owner_id, r.due_date, r.status, r.reason, r.delivery, r.version, r.updated_at
  from project_request r
  join radar_company c on c.id = r.company_id
  join profile pc on pc.id = r.commercial_owner_id
  where r.organization_id = current_org() and (pp_gestao_role() or (pp_engenharia_role() and r.status <> 'RASCUNHO'))
  order by r.updated_at desc
$$;

revoke all on function pp_criar(jsonb), pp_transicionar(uuid, text, jsonb, integer), pp_visao_tecnica(), pp_gestao_role(), pp_engenharia_role() from public, anon;
grant execute on function pp_criar(jsonb), pp_transicionar(uuid, text, jsonb, integer), pp_visao_tecnica(), pp_gestao_role(), pp_engenharia_role() to authenticated;
revoke all on function project_request_coerencia(), project_request_event_imutavel() from public, anon, authenticated;

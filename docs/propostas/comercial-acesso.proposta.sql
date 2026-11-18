-- PROPOSTA — NÃO APLICAR SEM AUTORIZAÇÃO DA DIREÇÃO (E11.1E, docs/central-gestao-comercial.md §8.6).
--
-- Fica FORA de supabase/migrations de propósito: nenhum preflight, smoke do Quality Gate ou `db query` a encontra, e o
-- número só é escolhido na hora de aplicar (conferir o último número no repositório E no schema real; não há ledger).
-- A prova local é `node scripts/pg-smoke-central-comercial.mjs` (PGlite em memória, fila inteira + esta proposta).
--
-- São DUAS transações, como a 0066/0067: valor novo de enum não pode ser usado na transação em que nasce.
--
-- O que muda:
--   1. papel `Comercial` no enum role_kind;
--   2. leitura das tabelas de DADOS comerciais do Radar deixa de ser "toda a organização" e passa a exigir um papel com a
--      permissão `radar` (a mesma lista do app, PAPEIS_RADAR + Comercial). Contabilidade e Auditoria deixam de ler;
--      quem lê hoje continua lendo (sem regressão). Tabelas de CONFIGURAÇÃO (fontes, estratégias, tipos de resposta,
--      regras de score/persona, pesos) continuam legíveis pela organização: não têm dado de cliente;
--   3. escrita genérica das tabelas do Radar (as `_write` da 0031) passa a aceitar também o papel Comercial;
--   4. inbox_role() aceita Comercial (atendimento dos leads);
--   5. as três views do Radar passam a respeitar a RLS de quem consulta (security_invoker). Hoje elas rodam com o dono
--      da view, sem filtro de organização: qualquer usuário autenticado — inclusive Contabilidade, Auditoria e
--      Solicitante — lê nomes de empresas, cidades, scores e o valor do pipeline.
--
-- O que NÃO muda (fica registrado como próximo passo, cada um com avaliação própria):
--   - a Engenharia continua lendo o Radar inteiro (tem `radar` hoje; tirar quebraria as telas do Radar dela). A separação
--     técnica × comercial no banco vem com o pedido de projeto da E11.2 (tabela própria com RLS própria);
--   - RPCs e funções Netlify que conferem papel por lista própria (comunicação, entrega, metas, dono da conta) não ganham o
--     Comercial aqui: cada uma é uma decisão (ex.: o Comercial define metas? hoje só Administrador/Diretoria);
--   - views de outras frentes (financeiro, obras) que também ignoram a RLS: achado registrado no documento, fora do escopo.
--
-- Rollback: a parte 2 é revertida recriando as políticas `_select` por organização, as `_write` sem Comercial, o
-- inbox_role() anterior e `security_invoker = false` nas views. O valor de enum NÃO sai (PostgreSQL não remove valor de
-- enum); sem perfis com ele, é inerte.

-- ============================================================ PARTE 1 (transação própria)
alter type role_kind add value if not exists 'Comercial';

-- ============================================================ PARTE 2 (transação seguinte)
-- @@PARTE2@@

-- papéis que leem os DADOS do Radar = permissão `radar` do app (PAPEIS_RADAR) + Comercial
create or replace function radar_leitura_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Financeiro', 'Compras', 'Gestor de obra', 'Engenharia', 'Comercial')
$$;
revoke all on function radar_leitura_role() from public, anon;
grant execute on function radar_leitura_role() to authenticated;

do $$
declare
  t text; pol record;
  dados text[] := array['radar_company','radar_contact','radar_project','radar_signal','radar_opportunity',
    'radar_opportunity_stage_history','radar_activity','radar_task','radar_experiment','radar_score_snapshot',
    'radar_import_job','radar_import_row','radar_import_error','radar_possible_duplicate','radar_suppression',
    'radar_source_record','radar_communication','radar_communication_event','radar_communication_delivery',
    'radar_communication_delivery_event','radar_commercial_goal','radar_commercial_goal_intent','radar_commercial_outcome',
    'radar_vibe_operation'];
  escrita text[] := array['radar_company','radar_contact','radar_project','radar_signal','radar_opportunity',
    'radar_opportunity_stage_history','radar_activity','radar_task','radar_experiment','radar_score_snapshot',
    'radar_import_job','radar_import_row','radar_import_error','radar_possible_duplicate','radar_suppression','radar_source_record'];
  col text;
begin
  foreach t in array dados loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- a coluna de organização é organization_id em quase todas; o ledger do Vibe usa org_id
    col := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'organization_id') then 'organization_id' else 'org_id' end;
    -- só as PERMISSIVAS de leitura: uma política restritiva (nenhuma hoje) nunca é removida por aqui
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT' and permissive = 'PERMISSIVE' loop
      execute format('drop policy %I on %I', pol.policyname, t);
    end loop;
    execute format('create policy %I on %I for select using (%I = current_org() and radar_leitura_role())', t || '_select_comercial', t, col);
  end loop;
  foreach t in array escrita loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras'',''Comercial'')) with check (organization_id = current_org() and has_role(''Administrador'',''Diretoria'',''Financeiro'',''Gestor de obra'',''Engenharia'',''Compras'',''Comercial''))', t || '_write', t);
  end loop;
end $$;

-- atendimento: o Comercial entra no EIFF Inbox (o recorte por setor continua dentro dele)
create or replace function inbox_role() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role('Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Comercial')
$$;

-- views do Radar: passam a ler com os direitos de quem consulta (RLS da organização e do papel)
alter view v_radar_pipeline set (security_invoker = true);
alter view v_radar_company_queue set (security_invoker = true);
alter view v_radar_contact_coverage set (security_invoker = true);
-- views são só leitura: v_radar_company_queue é AUTO-ATUALIZÁVEL (information_schema.views.is_updatable) e anon pode ter
-- herdado os grants padrão do schema public; nada de escrita pela view e nada para anon (achado da frente S3, 16/11/2026)
revoke insert, update, delete, truncate on v_radar_pipeline, v_radar_company_queue, v_radar_contact_coverage from anon, authenticated;
revoke select on v_radar_pipeline, v_radar_company_queue, v_radar_contact_coverage from anon;

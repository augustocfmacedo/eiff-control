-- ROLLBACK EXATO da migration 0065 (CD-D5.2, docs/commercial-director-1.0.md §19.5).
-- NÃO é migration: fica fora de supabase/migrations e só roda com autorização expressa, nunca de forma automática.
--
-- Estado que ele restaura (lido em produção em 13/10/2026, antes da 0065):
--   radar_company.relacl = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   nenhuma coluna de radar_company com privilégio próprio (attacl nulo)
--   função radar_definir_dono_conta inexistente
-- O GRANT devolve só INSERT/UPDATE, os dois privilégios que a 0065 retirou; os privilégios por coluna criados pela 0065
-- são revogados, então o resultado é idêntico ao de antes e nada é ampliado. Dados, dono e auditoria já gravados pela RPC
-- ficam como estão; o gatilho da 0064 (radar_company_dono_valido) continua barrando dono inválido.
--
-- Ordem na produção: banco primeiro (este arquivo), depois, se preciso, restaurar o deploy anterior do app.
-- Provado no smoke (scripts/pg-smoke-dono-conta.mjs lê ESTE arquivo): ACL de radar_company idêntica à de antes da 0065.
-- As listas de colunas são as mesmas dos GRANTs da 0065 (o teste src/data/radar.dono.persistencia.test.ts confere).
begin;
drop function if exists public.radar_definir_dono_conta(uuid, uuid, text);
revoke insert (id, organization_id, cnpj, legal_name, trade_name, domain, website, linkedin_url, industry, cnae, city, state,
  country, employee_range, revenue_range, capital_social, number_of_locations, source_id, source_external_id, notes, active,
  merged_into, fit_score, intent_score, timing_score, relationship_score, data_quality_score, priority_score, priority_class,
  last_signal_at, last_contact_at, next_action_at, version, created_at, created_by, updated_at, updated_by,
  explorium_business_id) on public.radar_company from authenticated;
revoke update (id, organization_id, cnpj, legal_name, trade_name, domain, website, linkedin_url, industry, cnae, city, state,
  country, employee_range, revenue_range, capital_social, number_of_locations, source_id, source_external_id, notes, active,
  merged_into, fit_score, intent_score, timing_score, relationship_score, data_quality_score, priority_score, priority_class,
  last_signal_at, last_contact_at, next_action_at, version, created_at, created_by, updated_at, updated_by,
  explorium_business_id) on public.radar_company from authenticated;
grant insert, update on public.radar_company to anon, authenticated;
commit;

-- ROLLBACK EXATO da migration 0068 (CD-D3/E2, docs/commercial-director-1.0.md §19.8).
-- NÃO é migration: só roda com autorização expressa, nunca de forma automática.
--
-- A 0068 só CRIA objetos (tabela, gatilhos, função de mês, RPC); não altera nenhum objeto existente. O rollback remove
-- exatamente o que ela criou e devolve o banco ao estado anterior. ATENÇÃO: remove também as metas gravadas. Se já
-- houver metas reais, exportar antes (select * from radar_commercial_goal) e guardar com o registro da operação.
-- Provado no smoke (scripts/pg-smoke-meta-comercial.mjs lê ESTE arquivo): nenhum objeto da 0068 sobra e as
-- permissões das demais tabelas não mudam.
begin;
drop function if exists public.radar_definir_meta_comercial(date, numeric, text);
drop table if exists public.radar_commercial_goal;
drop function if exists public.radar_commercial_goal_imutavel();
drop function if exists public.radar_mes_comercial_de(timestamptz);
commit;

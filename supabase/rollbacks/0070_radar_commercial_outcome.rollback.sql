-- Rollback EXATO da 0070 (CD-D3/E3, livro de desfechos). Remove exatamente o que a 0070 criou, inclusive a coluna
-- radar_opportunity.won_amount e stage_reason e as restrições delas.
-- ATENÇÃO: apaga o livro de desfechos (ganhos, estornos e complementos) e os valores fechados confirmados. Se já houver
-- eventos reais, EXPORTAR ANTES. A auditoria (audit_log) fica.
-- Ordem: tirar o código que lê o livro e grava won_amount antes, depois o banco.
begin;
drop trigger if exists radar_opportunity_desfecho on public.radar_opportunity;
drop trigger if exists radar_opportunity_ganho_travado on public.radar_opportunity;
drop function if exists public.radar_complementar_valor_ganho(uuid, numeric, text);
drop function if exists public.radar_opportunity_desfecho();
drop function if exists public.radar_opportunity_ganho_travado();
drop table if exists public.radar_commercial_outcome;
drop function if exists public.radar_commercial_outcome_imutavel();
drop function if exists public.radar_commercial_outcome_coerencia();
drop function if exists public.radar_desfecho_instante(timestamptz, timestamptz);
alter table public.radar_opportunity drop constraint if exists radar_opportunity_stage_reason_tamanho;
alter table public.radar_opportunity drop column if exists stage_reason;
alter table public.radar_opportunity drop constraint if exists radar_opportunity_won_amount_so_ganha;
alter table public.radar_opportunity drop constraint if exists radar_opportunity_won_amount_valido;
alter table public.radar_opportunity drop column if exists won_amount;
commit;

-- Rollback EXATO da 0074 (CD-D3/E5, idempotência por intenção da meta comercial). Remove só o que a 0074 criou; a RPC
-- da 0068 e as versões de meta ficam. ATENÇÃO: o app publicado depois da 0074 chama a RPC por intenção; tirar o código
-- antes. O registro de intenções é apagado (exportar antes se houver linhas).
begin;
drop function if exists public.radar_definir_meta_comercial_intencao(uuid, date, numeric, text, integer);
drop table if exists public.radar_commercial_goal_intent;
drop function if exists public.radar_commercial_goal_intent_imutavel();
commit;

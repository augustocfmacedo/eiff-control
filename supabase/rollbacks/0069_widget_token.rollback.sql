-- Rollback EXATO da 0069 (widgets do iPad). A 0069 só cria objetos; isto remove exatamente o que ela criou.
-- ATENÇÃO: apaga os tokens dos aparelhos (todos os widgets param de funcionar). A auditoria (audit_log) fica.
-- Ordem de implantação reversa: tirar o código que chama /api/widget-caixa e a tela antes, depois o banco.
begin;
drop function if exists public.widget_token_validar(text);
drop function if exists public.widget_token_revogar(uuid, text);
drop function if exists public.widget_token_criar(text, integer);
drop table if exists public.widget_token;
drop function if exists public.widget_token_imutavel();
commit;

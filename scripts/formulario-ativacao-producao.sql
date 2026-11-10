-- Formulário do site → EIFF Control: configuração de PRODUÇÃO para o lead chegar com responsável.
--
-- PREPARADO, NÃO APLICADO. Só roda com autorização específica:
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/formulario-ativacao-producao.sql
--
-- Não é migration: não muda schema, muda duas linhas de CONFIGURAÇÃO do Inbox (dado que a tela
-- #/atendimento/configuracao também edita). Idempotente: rodar duas vezes dá o mesmo estado.
--
-- O que faz, numa transação:
--   1. responsável padrão do setor COMERCIAL = o perfil indicado em v_email (provisório, para o ensaio);
--   2. regra ROT-SITE em inbox_config.routing_rules: canal PORTAL + contexto EXTERNAL → COMERCIAL, ordem 0.
--      É a mesma regra de src/core/inbox/formularioSite.ts (REGRA_ROTEAMENTO_DO_SITE); o editor da tela não
--      edita a condição «canais» (mas a preserva ao salvar), por isso ela entra por aqui.
-- O que NÃO faz: não cria membro nem equipe (o responsável padrão do setor basta para o roteador e para a RPC
-- inbox_apply_routing), não toca em conversa, contato, evidência ou qualquer outra regra.
--
-- Reversão (também só com autorização):
--   update inbox_sector set default_assignee_id = null where code = 'COMERCIAL';
--   update inbox_config set routing_rules = coalesce((select jsonb_agg(r) from jsonb_array_elements(routing_rules) r where r->>'id' <> 'ROT-SITE'), '[]'::jsonb);

begin;

do $$
declare
  v_email  text := 'augusto@eiff.com.br';
  v_perfil uuid;
  v_org    uuid;
  v_n      int;
  v_regra  jsonb := '{"id":"ROT-SITE","ordem":0,"condicao":{"contexto":"EXTERNAL","canais":["PORTAL"]},"destino":{"setorCodigo":"COMERCIAL"},"motivo":"solicitação recebida pelo formulário do site","ativa":true}'::jsonb;
begin
  select count(*) into v_n from profile where lower(email) = v_email and active;
  if v_n <> 1 then raise exception 'esperava exatamente 1 perfil ativo para %, achei %', v_email, v_n; end if;
  select id, organization_id into v_perfil, v_org from profile where lower(email) = v_email and active;

  select count(*) into v_n from inbox_sector where organization_id = v_org and code = 'COMERCIAL' and active;
  if v_n <> 1 then raise exception 'esperava exatamente 1 setor COMERCIAL ativo na organização, achei %', v_n; end if;
  select count(*) into v_n from inbox_config where organization_id = v_org;
  if v_n <> 1 then raise exception 'esperava exatamente 1 inbox_config na organização, achei %', v_n; end if;

  update inbox_sector set default_assignee_id = v_perfil
   where organization_id = v_org and code = 'COMERCIAL' and default_assignee_id is distinct from v_perfil;

  update inbox_config
     set routing_rules = jsonb_build_array(v_regra)
                         || coalesce((select jsonb_agg(r order by (r->>'ordem')::numeric)
                                        from jsonb_array_elements(routing_rules) r
                                       where r->>'id' <> 'ROT-SITE'), '[]'::jsonb)
   where organization_id = v_org
     and not (routing_rules @> jsonb_build_array(v_regra));
end $$;

-- conferência, na mesma transação: o que ficou
select s.code as setor, s.active as ativo, p.name as responsavel_padrao, p.role as papel,
       (select jsonb_agg(jsonb_build_object('id', r->>'id', 'ordem', r->'ordem', 'setor', r->'destino'->>'setorCodigo') order by (r->>'ordem')::numeric)
          from inbox_config c, jsonb_array_elements(c.routing_rules) r where c.organization_id = s.organization_id) as regras
  from inbox_sector s left join profile p on p.id = s.default_assignee_id
 where s.code = 'COMERCIAL';

commit;

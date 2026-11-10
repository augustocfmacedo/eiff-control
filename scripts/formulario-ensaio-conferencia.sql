-- Conferência do ensaio fictício do formulário do site. SOMENTE LEITURA.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/formulario-ensaio-conferencia.sql
--
-- O ensaio definitivo é uma submissão REAL e verificada do formulário público, com dados claramente de teste
-- (docs/formulario-site-ativacao.md §5): o id e o instante são os que o Netlify atribuiu, não os de um arquivo.
-- Por isso a conferência acha o ensaio pelo E-MAIL usado nele — troque abaixo se o ensaio usar outro.
--
-- Esperado: 1 evidência PENDING da fonte de código WEBSITE, sem entidade · 1 mensagem · conversa do canal PORTAL
-- no COMERCIAL, ATRIBUIDA, com responsável e vencimento = 30 minutos ÚTEIS depois de `submetida_em` · contato
-- «lead» com nome e empresa, identidades PORTAL (e WHATSAPP, se o telefone foi informado) · 0 empresas criadas e
-- o mesmo número de oportunidades de antes.
with ensaio as (select 'ensaio-ficticio@exemplo.invalido'::text as email),
     contato as (
       select c.* from inbox_contact c
        where c.id in (select i.contact_id from inbox_contact_identity i, ensaio e where i.channel = 'PORTAL' and i.identifier = e.email)
     ),
     conversa as (select t.* from inbox_thread t where t.contact_id in (select id from contato) and t.channel = 'PORTAL'),
     mensagem as (select m.* from inbox_message m where m.thread_id in (select id from conversa) and m.direction = 'inbound')
select json_build_object(
  'mensagens', (select json_agg(json_build_object(
                    'id_da_submissao', m.external_message_id, 'submetida_em', m.occurred_at,
                    'evidencia_vinculada', m.meta ->> 'registroFonteId', 'formulario', m.meta ->> 'formulario') order by m.occurred_at)
                  from mensagem m),
  'evidencias', (select json_agg(json_build_object(
                    'id', r.id, 'id_da_submissao', r.external_id, 'status', r.intake_status, 'entidade', r.entity_id,
                    'fonte_codigo', s.code, 'fonte_tipo', s.source_type, 'recebido', r.received_at,
                    'mesma_da_mensagem', exists (select 1 from mensagem m where m.meta ->> 'registroFonteId' = r.id::text)) order by r.received_at)
                   from radar_source_record r join radar_source s on s.id = r.source_id
                  where r.external_id in (select external_message_id from mensagem)),
  'conversa', (select json_agg(json_build_object(
                    'canal', t.channel, 'status', t.status, 'prioridade', t.priority, 'setor', sec.code, 'responsavel', p.name,
                    'aberta_em', t.opened_at, 'primeira_resposta_ate', t.sla_first_response_due, 'respondida_em', t.sla_first_response_at,
                    'minutos_corridos_ate_o_prazo', round(extract(epoch from (t.sla_first_response_due - t.opened_at)) / 60),
                    'roteamento', t.routing ->> 'motivoOperacional'))
                 from conversa t left join inbox_sector sec on sec.id = t.sector_id left join profile p on p.id = t.assignee_id),
  'contato', (select json_agg(json_build_object(
                    'nome', c.name, 'empresa', c.company_name, 'relacao', c.relation_kind,
                    'canais', (select json_agg(i.channel order by i.channel) from inbox_contact_identity i where i.contact_id = c.id)))
                from contato c),
  'empresas_criadas_desde_o_ensaio', (select count(*) from radar_company where created_at >= (select min(occurred_at) from mensagem)),
  'oportunidades_no_radar', (select count(*) from radar_opportunity)
) as ensaio;

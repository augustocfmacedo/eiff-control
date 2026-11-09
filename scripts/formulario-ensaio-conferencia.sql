-- Conferência do ensaio fictício do formulário do site. SOMENTE LEITURA.
--   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/formulario-ensaio-conferencia.sql
-- Esperado depois de enviar scripts/formulario-ensaio-ficticio.json (uma ou mais vezes):
--   evidencias = 1 (PENDING, sem entidade, fonte WEBSITE) · mensagens = 1 · conversa no COMERCIAL, ATRIBUIDA,
--   com responsável e prazo · contato «lead» com nome, empresa e duas identidades (PORTAL e WHATSAPP).
select json_build_object(
  'evidencias', (select json_agg(json_build_object('status', r.intake_status, 'entidade', r.entity_id, 'fonte', s.source_type, 'recebido', r.received_at))
                   from radar_source_record r join radar_source s on s.id = r.source_id where r.external_id = 'ensaio-ficticio-0001'),
  'mensagens', (select count(*) from inbox_message where provider = 'MANUAL' and external_message_id = 'ensaio-ficticio-0001'),
  'conversa', (select json_agg(json_build_object(
                   'canal', t.channel, 'status', t.status, 'prioridade', t.priority, 'setor', sec.code, 'responsavel', p.name,
                   'prazo_primeira_resposta', t.sla_first_response_due, 'respondida_em', t.sla_first_response_at,
                   'roteamento', t.routing ->> 'motivoOperacional', 'aberta', t.opened_at))
                 from inbox_thread t
                 join inbox_message m on m.thread_id = t.id and m.external_message_id = 'ensaio-ficticio-0001'
                 left join inbox_sector sec on sec.id = t.sector_id left join profile p on p.id = t.assignee_id),
  'contato', (select json_agg(json_build_object(
                   'nome', c.name, 'empresa', c.company_name, 'relacao', c.relation_kind,
                   'canais', (select json_agg(i.channel order by i.channel) from inbox_contact_identity i where i.contact_id = c.id)))
                from inbox_contact c
               where c.id in (select t.contact_id from inbox_thread t join inbox_message m on m.thread_id = t.id where m.external_message_id = 'ensaio-ficticio-0001')),
  'contas_criadas_no_radar', (select count(*) from radar_company where created_at >= (select min(received_at) from radar_source_record where external_id = 'ensaio-ficticio-0001')),
  'oportunidades', (select count(*) from radar_opportunity)
) as ensaio;

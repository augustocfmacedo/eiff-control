// Segurança S3 (R10): funções SECURITY DEFINER de public/mart e quem pode executá-las. Conferido pelo smoke da S3
// (scripts/pg-smoke-views.mjs, prova R10) no Quality Gate: a lista de DEFINER executáveis por authenticated tem de ser
// EXATAMENTE DEFINER_CLIENTE, e nenhuma de SOMENTE_SERVIDOR pode ser executável por authenticated nem por anon.
//
// Regra (CLAUDE.md): depois da 0077, função nova não é executável por ninguém além do dono e do service_role. Função que o
// app (cliente) precisa chamar ganha `grant execute ... to authenticated` na própria migration e entra em DEFINER_CLIENTE
// (se for SECURITY DEFINER) na MESMA mudança, com revisão: DEFINER roda com os direitos do dono e precisa conferir usuário,
// papel e organização no corpo. Função só do servidor entra em SOMENTE_SERVIDOR.
// Assinaturas no formato regprocedure com search_path padrão (public visível).

export const DEFINER_CLIENTE = [
  "anexo_entry_do_caminho(text)",
  "anexo_pode_anexar(uuid,text)",
  "anexo_pode_ver(uuid)",
  "anexo_preparar(text,text)",
  "anexo_registrar(text,text,text,text,text,bigint)",
  "anexo_remover(uuid,text)",
  "approval_has_step_for_me(uuid)",
  "approval_request_org(uuid)",
  "approval_request_requester(uuid)",
  "auth_profile()",
  "can_access_company(uuid)",
  "can_access_project(uuid)",
  "current_org()",
  "current_role_kind()",
  "df_cancelar_alteracao(uuid)",
  "df_contexto()",
  "df_meus_pedidos()",
  "df_pedir_alteracao(text,numeric,text)",
  "df_registrar_pedido(jsonb)",
  "has_role(role_kind[])",
  "inbox_assign_thread(uuid,text,uuid,uuid,text,text)",
  "inbox_config_role()",
  "inbox_encaminhei(uuid)",
  "inbox_gestor_de(uuid)",
  "inbox_role()",
  "inbox_user_sectors()",
  "radar_complementar_valor_ganho(uuid,numeric,text)",
  "radar_definir_dono_conta(uuid,uuid,text)",
  "radar_definir_meta_comercial(date,numeric,text)",
  "radar_definir_meta_comercial_intencao(uuid,date,numeric,text,integer)",
  "scope_allows(uuid,uuid)",
  "vibe_budget_status(numeric)",
  "vibe_operation_state(uuid)",
  "widget_token_criar(text,integer)",
  "widget_token_revogar(uuid,text)",
];

export const SOMENTE_SERVIDOR = [
  "anexo_json(entry_attachment)",
  "df_alteracao_json(payment_change_request)",
  "df_pedido_json(financial_entry)",
  "fn_cancel_entry(uuid,text)",
  "fn_close_period(uuid,character)",
  "fn_reopen_period(uuid,text)",
  "inbox_apply_routing(uuid,uuid,uuid,jsonb,jsonb,text,text,uuid,uuid,text,text,boolean)",
  "inbox_email_delivery_accept(uuid,uuid,timestamp with time zone,text,text,boolean)",
  "inbox_email_delivery_create(uuid,uuid,uuid,uuid,text,uuid,text,text,integer,integer)",
  "inbox_email_delivery_transition(uuid,text,uuid,text,text,text)",
  "inbox_ingest(uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,uuid,uuid,jsonb,jsonb)",
  "radar_delivery_create(uuid,uuid,text,text,text,text,text,text,text)",
  "radar_delivery_transition(uuid,uuid,text,text,text,text,text,text,text)",
  "reserve_vibe_operation(uuid,text,text,text,numeric,integer,numeric,integer,boolean)",
  "update_vibe_operation(uuid,uuid,text,jsonb)",
  "vibe_credits_committed(uuid,timestamp with time zone)",
  "whatsapp_identity_attempt(uuid,uuid,integer)",
  "whatsapp_identity_request(uuid,text,text,text,timestamp with time zone,uuid,uuid)",
  "whatsapp_identity_transition(uuid,uuid,text,text)",
  "whatsapp_identity_verify(uuid,uuid,text,integer)",
  "widget_token_validar(text)",
];

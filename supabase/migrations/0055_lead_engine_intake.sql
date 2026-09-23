-- Lead Engine LE-1: intake canonico, staging logico e idempotencia em radar_source_record.
--
-- Decisao D-1 do LE-0 (docs/lead-engine-1.0.md): o candidato do Lead Engine NAO e uma tabela nova.
-- E um radar_source_record com intake_status preenchido; enquanto entity_id for nulo, nao existe conta comercial.
-- Nenhuma tabela e criada aqui, nenhuma segunda raiz de CRM, nenhum lifecycle_stage em radar_company (D-2).
--
-- Registros anteriores ao Lead Engine ficam com intake_status NULL = "fora do Lead Engine" e, por construcao,
-- nunca aparecem como pendencia (o indice da fila e parcial em intake_status is not null). Sem backfill.

alter table radar_source_record
  add column payload_fingerprint text,                 -- impressao canonica da OBSERVACAO (sha256 do payload)
  add column intake_status text,                       -- PENDING | REVIEW | RESOLVED | REJECTED; NULL = legado
  add column decided_at timestamptz,                   -- quando a decisao humana aconteceu
  add column decided_by uuid references profile(id),   -- quem decidiu
  add column decision_reason text;                     -- por que (obrigatorio em REJECTED pelo core)

-- estados do staging. NULL continua valido: e o registro que o Lead Engine nao gerencia.
alter table radar_source_record add constraint radar_source_record_intake_status_chk
  check (intake_status is null or intake_status in ('PENDING','REVIEW','RESOLVED','REJECTED'));

-- coerencia de entidade: RESOLVED exige a entidade ligada. PENDING/REVIEW/REJECTED nao exigem nada.
alter table radar_source_record add constraint radar_source_record_intake_entidade_chk
  check (intake_status is distinct from 'RESOLVED' or entity_id is not null);

-- registro gerenciado pelo Lead Engine tem identidade externa (D-7) e impressao da observacao.
alter table radar_source_record add constraint radar_source_record_intake_identidade_chk
  check (intake_status is null or (external_id is not null and payload_fingerprint is not null));

-- IDEMPOTENCIA (D-7). Unico = organizacao + fonte + identidade externa + impressao.
-- Deliberadamente NAO e unique (organization_id, source_id, external_id): a mesma obra/licitacao observada de novo
-- com conteudo diferente e uma NOVA OBSERVACAO do mesmo objeto externo, e precisa caber ao lado da anterior.
-- So a repeticao EXATA e impedida. Registros legados (sem external_id ou sem impressao) ficam fora do indice.
create unique index radar_source_record_observacao_uidx
  on radar_source_record (organization_id, source_id, external_id, payload_fingerprint)
  where external_id is not null and payload_fingerprint is not null;

-- fila de decisao do Lead Engine (consulta principal do LE-2): so o que o Lead Engine gerencia.
create index radar_source_record_intake_idx
  on radar_source_record (organization_id, intake_status, received_at desc)
  where intake_status is not null;

-- Evidencia bruta imutavel. Mesmo padrao do snapshot de radar_communication (migration 0039):
-- depois do INSERT so os campos de DECISAO e a ligacao com a entidade mudam. Conteudo externo diferente
-- nunca reescreve o registro anterior — gera outra observacao.
create or replace function radar_source_record_evidencia_imutavel() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.source_id is distinct from old.source_id
     or new.record_type is distinct from old.record_type or new.external_id is distinct from old.external_id
     or new.payload is distinct from old.payload or new.payload_fingerprint is distinct from old.payload_fingerprint
     or new.received_at is distinct from old.received_at then
    raise exception 'radar_source_record: evidencia bruta e imutavel (id %); observacao diferente gera novo registro', old.id;
  end if;
  return new;
end $$;
create trigger radar_source_record_evidencia before update on radar_source_record for each row execute function radar_source_record_evidencia_imutavel();

-- RLS: nada muda. A tabela ja tem radar_source_record_select (organization_id = current_org()) e
-- radar_source_record_write (papeis comerciais) desde a 0031, e o grant para authenticated continua o mesmo.
-- Colunas novas herdam as politicas existentes; nenhuma policy paralela, nenhum escape de service-role.

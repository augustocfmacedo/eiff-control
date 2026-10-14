-- 0073 · Documentos dos pedidos de pagamento: nota fiscal, boleto e comprovante (pedido do Augusto em 14/10/2026).
--
-- Quem pediu o pagamento anexa a nota fiscal e o boleto; quem paga (Administrador, Diretoria, Financeiro) anexa o comprovante.
-- O solicitante vê e baixa os documentos do PRÓPRIO pedido (inclusive o comprovante, para mostrar ao fornecedor), sem ver
-- caixa nem lançamentos de outros. A tabela genérica `attachment` da 0001 não serve: a leitura dela é aberta à organização.
--
--   bucket anexos-financeiros     privado, 10 MB, PDF e imagem; caminho <organization_id>/<entry_id>/<uuid>.<ext>
--   entry_attachment              uma linha por documento; remoção é LÓGICA (removed_at + motivo), o arquivo fica
--   anexo_pode_ver(entry)         financeiro da organização (Administrador, Diretoria, Financeiro, Contabilidade, Auditoria)
--                                 ou quem criou o lançamento (o Solicitante inclusive)
--   anexo_pode_anexar(entry,tipo) Administrador/Diretoria/Financeiro: qualquer tipo; quem pediu: NF, boleto e outro (o
--                                 comprovante é de quem paga); nunca em lançamento cancelado ou excluído
--   anexo_preparar(codigo)        devolve onde subir o arquivo (confere a permissão antes)
--   anexo_registrar(...)          grava a linha depois do upload (confere caminho, objeto no bucket, tipo e tamanho)
--   anexo_remover(id, motivo)     remoção lógica: quem enviou (antes do pagamento) ou Administrador/Diretoria/Financeiro
--   df_pedido_json                passa a levar os anexos ativos do pedido (o Solicitante não lê tabela nenhuma)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos-financeiros', 'anexos-financeiros', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create table if not exists entry_attachment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  entry_id uuid not null references financial_entry(id),
  kind text not null check (kind in ('NOTA_FISCAL', 'BOLETO', 'COMPROVANTE', 'OUTRO')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null unique check (char_length(storage_path) <= 300),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references profile(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references profile(id),
  removal_reason text,
  check ((removed_at is null) = (removed_by is null)),
  check (removed_at is null or char_length(btrim(coalesce(removal_reason, ''))) >= 3)
);
create index if not exists entry_attachment_entry on entry_attachment (entry_id) where removed_at is null;

-- o documento é imutável; só a remoção lógica muda, uma vez
create or replace function entry_attachment_imutavel() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Documento não é apagado: use a remoção com motivo.' using errcode = '42501'; end if;
  if new.organization_id is distinct from old.organization_id or new.entry_id is distinct from old.entry_id or new.kind is distinct from old.kind
     or new.file_name is distinct from old.file_name or new.storage_path is distinct from old.storage_path or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'Documento é imutável: só a remoção com motivo muda.' using errcode = '42501';
  end if;
  if old.removed_at is not null then raise exception 'Documento já removido.' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists entry_attachment_imutavel on entry_attachment;
create trigger entry_attachment_imutavel before update or delete on entry_attachment for each row execute function entry_attachment_imutavel();
drop trigger if exists entry_attachment_audit on entry_attachment;
create trigger entry_attachment_audit after insert or update on entry_attachment for each row execute function audit_row();

-- quem vê os documentos de um lançamento (função lê profile e financial_entry, nunca a própria entry_attachment)
create or replace function anexo_pode_ver(p_entry uuid) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from profile pr join financial_entry e on e.organization_id = pr.organization_id
     where pr.id = auth.uid() and pr.active and e.id = p_entry
       and (pr.role in ('Administrador', 'Diretoria', 'Financeiro', 'Contabilidade', 'Auditoria') or e.created_by = pr.id))
$$;

create or replace function anexo_pode_anexar(p_entry uuid, p_kind text) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from profile pr join financial_entry e on e.organization_id = pr.organization_id
     where pr.id = auth.uid() and pr.active and e.id = p_entry
       and e.status <> 'Cancelado' and e.deleted_at is null
       and (pr.role in ('Administrador', 'Diretoria', 'Financeiro')
            or (e.created_by = pr.id and coalesce(p_kind, 'OUTRO') in ('NOTA_FISCAL', 'BOLETO', 'OUTRO'))))
$$;

-- caminho <org>/<entry>/<arquivo>: a pasta tem de ser do lançamento certo, da organização certa
create or replace function anexo_entry_do_caminho(p_name text) returns uuid language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v_partes text[] := string_to_array(p_name, '/'); v_entry uuid;
begin
  if array_length(v_partes, 1) <> 3 or v_partes[2] !~ '^[0-9a-f-]{36}$' then return null; end if;
  select id into v_entry from financial_entry where id = v_partes[2]::uuid and organization_id::text = v_partes[1];
  return v_entry;
end $$;

alter table entry_attachment enable row level security;
drop policy if exists ea_select on entry_attachment;
create policy ea_select on entry_attachment for select using (anexo_pode_ver(entry_id));
-- sem INSERT/UPDATE/DELETE diretos: tudo pelas portas abaixo
revoke insert, update, delete on entry_attachment from authenticated, anon;
revoke all on entry_attachment from anon;
grant select on entry_attachment to authenticated;

drop policy if exists "anexos_fin_select" on storage.objects;
create policy "anexos_fin_select" on storage.objects for select to authenticated
  using (bucket_id = 'anexos-financeiros' and anexo_pode_ver(anexo_entry_do_caminho(name)));
drop policy if exists "anexos_fin_insert" on storage.objects;
create policy "anexos_fin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos-financeiros' and anexo_pode_anexar(anexo_entry_do_caminho(name), null));
-- sem UPDATE/DELETE de objetos: o arquivo é o registro

create or replace function anexo_json(a entry_attachment) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'codigo', (select code from financial_entry where id = a.entry_id), 'tipo', a.kind, 'nome', a.file_name,
    'caminho', a.storage_path, 'mime', a.mime_type, 'tamanho', a.size_bytes,
    'enviadoPor', (select name from profile where id = a.uploaded_by), 'enviadoPorId', a.uploaded_by, 'enviadoEm', a.uploaded_at,
    'removidoEm', a.removed_at, 'removidoPor', (select name from profile where id = a.removed_by), 'motivoRemocao', a.removal_reason)
$$;

create or replace function anexo_preparar(p_codigo text, p_tipo text) returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v profile; v_e financial_entry;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  select * into v_e from financial_entry where organization_id = v.organization_id and code = p_codigo;
  if v_e.id is null or not anexo_pode_anexar(v_e.id, p_tipo) then
    raise exception 'Você não pode anexar este tipo de documento a este lançamento.' using errcode = '42501';
  end if;
  return jsonb_build_object('pasta', v.organization_id::text || '/' || v_e.id::text);
end $$;

create or replace function anexo_registrar(p_codigo text, p_tipo text, p_caminho text, p_nome text, p_mime text, p_tamanho bigint) returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare v profile; v_e financial_entry; v_a entry_attachment;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  select * into v_e from financial_entry where organization_id = v.organization_id and code = p_codigo;
  if v_e.id is null or not anexo_pode_anexar(v_e.id, p_tipo) then
    raise exception 'Você não pode anexar este tipo de documento a este lançamento.' using errcode = '42501';
  end if;
  if anexo_entry_do_caminho(p_caminho) is distinct from v_e.id then raise exception 'Caminho do arquivo não é deste lançamento.' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'anexos-financeiros' and o.name = p_caminho) then
    raise exception 'Arquivo não encontrado no armazenamento: envie de novo.' using errcode = '22023';
  end if;
  select * into v_a from entry_attachment where storage_path = p_caminho;
  if v_a.id is not null then return anexo_json(v_a) || jsonb_build_object('repetido', true); end if;
  insert into entry_attachment (organization_id, entry_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values (v.organization_id, v_e.id, p_tipo, left(btrim(p_nome), 200), p_caminho, p_mime, p_tamanho, v.id)
  returning * into v_a;
  return anexo_json(v_a);
end $$;

create or replace function anexo_remover(p_id uuid, p_motivo text) returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare v profile; v_a entry_attachment; v_e financial_entry;
begin
  select * into v from profile where id = auth.uid() and active;
  if v.id is null then raise exception 'Perfil inexistente ou inativo.' using errcode = '42501'; end if;
  select * into v_a from entry_attachment where id = p_id and organization_id = v.organization_id;
  if v_a.id is null or not anexo_pode_ver(v_a.entry_id) then raise exception 'Documento não encontrado.' using errcode = '42501'; end if;
  select * into v_e from financial_entry where id = v_a.entry_id;
  if not (v.role in ('Administrador', 'Diretoria', 'Financeiro') or (v_a.uploaded_by = v.id and v_e.status <> 'Realizado')) then
    raise exception 'Só quem enviou (antes do pagamento) ou o Financeiro remove este documento.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da remoção.' using errcode = '22023'; end if;
  update entry_attachment set removed_at = now(), removed_by = v.id, removal_reason = left(btrim(p_motivo), 300) where id = v_a.id returning * into v_a;
  return anexo_json(v_a);
end $$;

-- pedido no formato do app: campos da 0072 (com a alteração da 0071) + anexos ativos. Ordem: 0067 → 0071 → 0072 → 0073.
create or replace function df_pedido_json(e financial_entry) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'codigo', e.code, 'descricao', e.description, 'contraparte', e.counterparty_name,
    'categoria', (select category from chart_account where id = e.chart_account_id),
    'codigoObra', (select code from project where id = e.project_id),
    'valor', e.gross_amount, 'vencimento', e.due_date, 'status', e.status,
    'motivoCancelamento', e.cancellation_reason, 'excluido', e.deleted_at is not null,
    'reagendado', coalesce(e.notes, '') ~ 'Reagendada no alinhamento',
    'criadoEm', e.created_at, 'atualizadoEm', e.updated_at,
    'formaPagamento', e.payment_method, 'dadosPagamento', e.payment_details,
    'alteracao', (select df_alteracao_json(a) from payment_change_request a where a.entry_id = e.id order by a.requested_at desc limit 1),
    'anexos', coalesce((select jsonb_agg(anexo_json(x) order by x.uploaded_at) from entry_attachment x where x.entry_id = e.id and x.removed_at is null), '[]'::jsonb))
$$;
revoke all on function df_pedido_json(financial_entry) from public, anon, authenticated;

revoke all on function anexo_json(entry_attachment) from public, anon, authenticated;
revoke all on function anexo_entry_do_caminho(text) from public, anon;
revoke all on function anexo_pode_ver(uuid) from public, anon;
revoke all on function anexo_pode_anexar(uuid, text) from public, anon;
grant execute on function anexo_entry_do_caminho(text) to authenticated;
grant execute on function anexo_pode_ver(uuid) to authenticated;
grant execute on function anexo_pode_anexar(uuid, text) to authenticated;
revoke all on function anexo_preparar(text, text) from public, anon;
revoke all on function anexo_registrar(text, text, text, text, text, bigint) from public, anon;
revoke all on function anexo_remover(uuid, text) from public, anon;
grant execute on function anexo_preparar(text, text) to authenticated;
grant execute on function anexo_registrar(text, text, text, text, text, bigint) to authenticated;
grant execute on function anexo_remover(uuid, text) to authenticated;

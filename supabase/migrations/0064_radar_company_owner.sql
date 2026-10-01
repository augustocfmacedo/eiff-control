-- CD-D5 — Dono da conta (docs/commercial-director-1.0.md §19.3, decisão fechada em 30/09/2026).
--
-- Cada conta comercial (radar_company) tem ZERO ou UM dono comercial canônico. O nome é commercial_owner_id
-- porque radar_opportunity.owner_id já existe e é o RESPONSÁVEL DA OPORTUNIDADE — outra coisa.
--
-- O que esta migration faz e só isto:
--   1. coluna opcional commercial_owner_id com FK para profile;
--   2. índice parcial por organização e dono;
--   3. trigger que, QUANDO o dono é definido ou trocado, exige perfil ATIVO da MESMA organização da conta.
--
-- O que ela NÃO faz: carga ou backfill (toda conta nasce e continua SEM_DONO), tabela de histórico (o trigger de
-- auditoria radar_company_audit já grava a linha inteira antes e depois, com o autor), mudança de RLS (a política
-- radar_company_write já usa os papéis da permissão `radar`) nem dependência de 0060, 0061 ou 0062.
--
-- Dono desativado depois de atribuído: o vínculo histórico fica (nada é limpo) e o app passa a tratar a conta como
-- DONO_INATIVO, sem dono válido. Por isso a validação roda SÓ quando o dono muda: qualquer outra atualização da conta
-- (recálculo de score, mescla, edição de cadastro) continua passando.

alter table radar_company add column if not exists commercial_owner_id uuid references profile(id);

comment on column radar_company.commercial_owner_id is
  'CD-D5: dono comercial canônico da conta (0..1). Diferente do responsável da oportunidade (radar_opportunity.owner_id), do responsável da tarefa e do responsável derivado pela Commercial Queue.';

create index if not exists radar_company_commercial_owner_idx
  on radar_company (organization_id, commercial_owner_id)
  where commercial_owner_id is not null;

create or replace function radar_company_dono_valido() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.commercial_owner_id is null then
    return new;
  end if;
  -- só valida quando o dono (ou a organização da conta) muda; dono que ficou inativo depois não trava outras gravações
  if tg_op = 'UPDATE'
     and new.commercial_owner_id is not distinct from old.commercial_owner_id
     and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;
  if not exists (
    select 1 from profile p
    where p.id = new.commercial_owner_id
      and p.organization_id = new.organization_id
      and p.active
  ) then
    raise exception 'dono comercial inválido: o usuário precisa estar ativo e pertencer à mesma organização da conta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists radar_company_dono_valido on radar_company;
create trigger radar_company_dono_valido
  before insert or update of commercial_owner_id, organization_id on radar_company
  for each row execute function radar_company_dono_valido();

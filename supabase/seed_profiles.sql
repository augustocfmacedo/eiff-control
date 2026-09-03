-- Perfis de acesso (DEC-02). Execute DEPOIS de criar os usuarios em Authentication > Users no painel do Supabase.
-- Cada linha liga um e-mail ja existente em auth.users a um papel. Ajuste nomes, e-mails e papeis conforme a lista real.
-- Papeis: Administrador | Diretoria | Financeiro | Gestor de obra | Engenharia | Compras | Contabilidade | Auditoria

insert into profile (id, organization_id, name, email, role, mfa_required)
select u.id, (select id from organization where code = 'EIFF'), v.name, u.email, v.role::role_kind, v.mfa
from (values
  ('augusto@eiff.com.br', 'Augusto Macedo', 'Diretoria', true)
  ,('augustocfmacedo@gmail.com', 'Augusto Macedo', 'Diretoria', true)
  -- ,('financeiro@eiff.com.br', 'Financeiro EIFF', 'Financeiro', true)
  -- ,('gestor.obra@eiff.com.br', 'Gestor Smart Fit', 'Gestor de obra', false)
  -- ,('engenharia@eiff.com.br', 'Engenharia', 'Engenharia', false)
) as v(email, name, role, mfa)
join auth.users u on lower(u.email) = lower(v.email)
on conflict (id) do update set name = excluded.name, role = excluded.role, mfa_required = excluded.mfa_required, active = true;

-- Escopo por obra para papeis operacionais (Gestor de obra / Engenharia / Compras).
-- project_id nulo = todas as obras da empresa. Exemplo para a obra Smart Fit:
-- insert into user_scope (organization_id, profile_id, company_id, project_id)
-- select p.organization_id, p.id, c.id, pr.id
-- from profile p, company c, project pr
-- where p.email = 'gestor.obra@eiff.com.br' and c.code = 'EIFF' and pr.code = 'OB-SF-CL-01'
-- on conflict do nothing;

-- Diretoria, Financeiro, Contabilidade e Auditoria tambem precisam de escopo de empresa quando nao forem Administrador/Diretoria:
insert into user_scope (organization_id, profile_id, company_id, project_id)
select p.organization_id, p.id, c.id, null
from profile p join company c on c.organization_id = p.organization_id
where p.role in ('Financeiro', 'Contabilidade', 'Auditoria', 'Compras')
on conflict do nothing;

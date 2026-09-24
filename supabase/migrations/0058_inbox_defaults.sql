-- 0058 — EIFF Inbox: DEFAULTS operacionais por organização (docs/eiff-inbox.md §16). Idempotente. Só dados.
--
-- O que cria, para CADA organização existente (padrão multi-organização do projeto, como a 0034: `select id from
-- organization ... on conflict do nothing`; nenhum UUID fixo):
--   1) os 12 setores padrão do Inbox — códigos, nomes e ordem EXATAMENTE os de SETORES_PADRAO em src/core/inbox/tipos.ts
--      (o teste defaults.test.ts prende esta lista ao código); sem responsável padrão: pessoa é decisão humana na tela;
--   2) a linha de inbox_config com os defaults do banco (fallback ADMINISTRATIVO, escalação DIRETORIA, SLA por prioridade,
--      nível B). As listas de regras ficam vazias de propósito: vazio = "use as regras padrão do código"
--      (CONFIGURACAO_PADRAO), então nada é duplicado entre banco e código.
-- Sem equipes: o Router trabalha setor → sem equipe → fila do setor; equipes entram pela tela quando houver necessidade.
-- Não altera 0056 nem 0057. Registros já existentes (mesmo código) nunca são sobrescritos.
insert into inbox_sector (organization_id, code, name, active, sort_order)
select o.id, s.code, s.name, true, s.sort_order
from organization o
cross join (values
  ('COMERCIAL', 'Comercial', 1),
  ('ENGENHARIA', 'Engenharia', 2),
  ('OBRAS', 'Obras / Operações', 3),
  ('COMPRAS', 'Compras', 4),
  ('FINANCEIRO', 'Financeiro', 5),
  ('JURIDICO', 'Jurídico', 6),
  ('POS_VENDA', 'Pós-venda', 7),
  ('ADMINISTRATIVO', 'Administrativo', 8),
  ('FORNECEDORES', 'Fornecedores', 9),
  ('DIRETORIA', 'Diretoria', 10),
  ('SISTEMA', 'Sistema', 11),
  ('FACTORY', 'Factory', 12)
) as s (code, name, sort_order)
on conflict (organization_id, code) do nothing;

insert into inbox_config (organization_id)
select id from organization
on conflict (organization_id) do nothing;

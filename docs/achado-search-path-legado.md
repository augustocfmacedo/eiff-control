# Achado de segurança — funções legadas sem `search_path` fixo

Registrado em 14/10/2026 durante a CD-D3/E3 (smoke da 0070, bloco N, `scripts/pg-smoke-desfechos.mjs`). **Nenhuma
migration já aplicada foi alterada**: a correção, quando autorizada, entra numa migration nova (tarefa aberta no painel:
"Fixar search_path das funções auxiliares antigas (0001/0003)").

## O que foi visto

Funções `security definer` antigas não fixam `search_path` e usam nomes de tabela sem schema. Como o PostgreSQL procura
`pg_temp` **antes** de `public`, uma tabela temporária de mesmo nome criada na sessão desvia o que a função lê ou grava.

| Função | Definição vigente | O que lê/grava sem schema | Efeito de uma tabela temporária de mesmo nome |
|---|---|---|---|
| `current_org()`, `auth_profile()`, `current_role_kind()`, `has_role()`, `can_access_company()`, `can_access_project()` | 0067 (redefinidas para o Solicitante; origem 0003) | `profile`, `user_scope` | um `profile` temporário com linha falsa muda a organização e o papel vistos pela RLS de **todas** as tabelas |
| `audit_row()` | 0001 | `audit_log` | a auditoria genérica das tabelas vai para o `audit_log` temporário (some com a sessão) |
| `touch_updated_at()`, `forbid_delete()` | 0001 | — (só NEW/OLD) | nenhum efeito prático; sem `search_path` só por padrão |

Prova: com `profile` e `audit_log` temporários na sessão, o smoke mostrou o `audit_row()` gravando 1 linha no temporário.
As funções novas (0065, 0068, 0069, 0070) já nasceram com `search_path = pg_catalog, pg_temp` e referências
qualificadas, e o mesmo smoke prova que elas **não** são desviadas.

## Impacto real

- **Pela aplicação e pela API do Supabase (PostgREST): não explorável hoje.** O PostgREST só executa SELECT/INSERT/UPDATE/
  DELETE em tabelas expostas e chamadas de funções do schema `public`. Não há caminho para rodar `CREATE TEMP TABLE`, e
  nenhuma função exposta executa SQL dinâmico vindo do cliente.
- **Exige SQL arbitrário numa sessão** com os papéis `authenticated`/`anon`: conexão direta ao Postgres com essas
  credenciais, ou uma futura função que monte SQL a partir de entrada do usuário. Em produção, `authenticated` tem o
  privilégio `TEMP` no banco (conferido em 13/10/2026), então a pré-condição de "criar tabela temporária" existe se alguém
  chegar a uma sessão SQL.
- **Consequência se explorado:** leitura e escrita cruzando organizações pela RLS (via `current_org`/`has_role`) e perda
  de trilha de auditoria genérica (via `audit_row`). Alto impacto, baixa probabilidade.

## Prioridade

**Média — corrigir antes de abrir o banco a novos papéis/usuários ou de qualquer função com SQL dinâmico.** Não bloqueia a
E3 (as funções da 0070 estão protegidas e provadas). Sugestão de ordem: depois da implantação da E3 e antes da entrada da
equipe no app.

## Correção proposta (não aplicada)

Migration nova que recria cada função com `set search_path = pg_catalog, pg_temp` e referências qualificadas
(`public.profile`, `public.user_scope`, `public.audit_log`, `auth.uid()`), **mantendo a lógica idêntica à definição vigente**
(para as auxiliares, a da 0067, que trata o Solicitante). Rollback exato versionado. Smoke com a fila inteira provando: mesmos
resultados antes/depois para cada papel, e tabela temporária `profile`/`audit_log` sem efeito. Rodar também
`smoke:solicitante` e o preflight. Opcional, à parte: revogar `TEMP` do papel `authenticated` se nenhuma função depender dele.

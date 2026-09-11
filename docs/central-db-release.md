# EIFF Central — release das migrations 0049, 0050 e 0051

As três migrations da Central estão em `main` e **não estão aplicadas** em produção. Este documento é o que falta
entre "o código está no repositório" e "o banco mudou": onde dá para ensaiar, o que já foi provado, como aplicar,
como conferir, e o que dá e o que não dá para desfazer.

Projeto de produção: `dduobppgomqyagjviwpx` (Eiff_Control). **Última migration aplicada: 0048.**

| Migration | O que faz | Natureza |
| --- | --- | --- |
| `0049_whatsapp_identity.sql` | tabela `whatsapp_identity` + 4 RPCs server-only + triggers de estado, coerência e auditoria + RLS | aditiva (objetos novos) |
| `0050_central_conversation.sql` | tabelas `central_conversation`, `central_message`, `central_event` + triggers + RLS | aditiva (objetos novos) |
| `0051_central_meta_delivery.sql` | `provider` do ledger de entrega passa a aceitar `META_CLOUD`; `radar_delivery_create` ganha a linha da Meta | **altera objeto existente** |

Nenhuma delas liga envio: o transporte da Meta recusa (`TRANSPORTE_BLOQUEADO`) e a Central segue somente leitura.

---

## 1. Ambiente seguro: não existe

A pergunta era se há onde ensaiar antes de produção. A resposta honesta, depois de procurar:

| Onde procurei | O que encontrei |
| --- | --- |
| `supabase/config.toml` | **não existe** — sem ele o stack local (`supabase db start`, `db reset`, `db diff`) não está configurado |
| Docker nesta máquina | **não instalado** (`docker: command not found`) — mesmo com `config.toml`, o stack local não subiria |
| Cliente `psql` | **não instalado** |
| `supabase/.temp/linked-project.json` | um único projeto: `dduobppgomqyagjviwpx` / Eiff_Control. Não há segundo ref em lugar nenhum do repositório |
| Segundo projeto Supabase (staging) | **nenhuma referência** no repositório, em `.env.example`, nos scripts ou nos docs |
| Preview branches (`supabase branches`) | o comando existe no CLI 2.116.0, mas branching exige `config.toml` + integração Git + plano pago. Não há `config.toml`, não há `.github/`, e o plano Pro consta como **pendência** no `CLAUDE.md`. **Não verifiquei contra a API de propósito** — ver seção 6 |
| CI | **não existe** `.github/`; o Netlify só compila o front-end e nunca toca o banco |
| Backup | plano Free não tem backup automático (`docs/implantacao-supabase.md`). **Não há restauração para voltar atrás** |
| `supabase/deploy.sql` | não serve de reconstrução: ver seção 3 |

**Conclusão: não existe ambiente seguro.** O único Postgres descartável disponível é o PGlite (Postgres compilado
para WASM, em memória, sem rede) — e é exatamente nele que os dois harnesses deste repositório rodam.

Isso muda o peso do ensaio, não o cancela: as três migrations foram exercitadas contra o **schema completo reconstruído do repositório** — 51 migrations + seed + shims do Supabase (`auth`, papéis, `storage`) + ordem histórica corrigida. **Não é o Supabase de produção**, que continua não testado nem migrado. As três foram exercitadas contra esse schema completo,
e não só contra um esqueleto. É o que a seção 2 mostra.

---

## 2. O que já foi provado, e com o quê

Dois harnesses, com divisão de trabalho explícita:

| Harness | Pergunta que responde | Resultado |
| --- | --- | --- |
| `node scripts/pg-smoke-central.mjs` | as **regras** de 0049/0050/0051 valem? (schema mínimo montado à mão) | 10/10 smoke tests A–J PASS |
| `node scripts/pg-preflight-central.mjs --ordem-corrigida` | a **fila inteira** roda, e as três convivem com o schema completo reconstruído do repositório? | 51/51 migrations aplicadas, 0 erros; 5 provas PASS; idempotência PASS |

O preflight aplica `0001..0051` mais a carga inicial (`supabase/seed.sql`) num PGlite descartável, e então roda
provas contra os objetos **de verdade** — `role_kind` como enum, `has_role(variadic role_kind[])`, `current_org()`,
`profile`/`worker` reais e o ledger de entrega vindo de 0045..0048:

| Prova | O que fecha |
| --- | --- |
| P1 | `whatsapp_identity_request` → `whatsapp_identity_verify` fecha o ciclo PENDING → VERIFIED com `profile.role` sendo o enum real |
| P2 | colaborador de outra organização é recusado (`colaborador_de_outra_organizacao`) |
| P3 | RLS herdada com `has_role`/`current_org` reais: usuário comum vê só a conversa EXTERNAL e seus filhos; Administrador e o `human_owner` veem as duas |
| P4 | `radar_delivery_create` aceita `META_CLOUD` em WHATSAPP, recusa em EMAIL (`canal_incoerente`) e é idempotente na repetição |
| P5 | nenhuma entrega com `provider` fora do novo catálogo |

Ambiente do ensaio: PGlite 0.3.16 = **PostgreSQL 17.5** em WASM. A migration mais pesada (`0019`, 2,7 MB de
catálogo SINAPI) aplica em ~2 s; a fila inteira roda em segundos.

### O que os harnesses continuam sem provar

- PGlite é Postgres 17.5 em WASM; produção é o Postgres gerenciado do Supabase. Sintaxe e semântica batem;
  planner, locks e concorrência não entram.
- O prelúdio do preflight **imita** a plataforma Supabase (schema `auth`, papéis `anon`/`authenticated`/
  `service_role`, schema `storage`). Se uma migration depender de um detalhe real do GoTrue ou do Storage, aqui
  ela passa e lá não. Vale para a `0042`; não vale para 0049–0051, que só usam `auth.uid()` e os papéis.
- `pgcrypto` é real (vem do contrib do PGlite). `unaccent` e `uuid-ossp` **não existem** no PGlite — o repositório
  não usa nenhuma das duas.
- **Não há dados de produção.** A `0051` foi exercitada contra tabela vazia; o raciocínio sobre linha existente
  está na seção 6 e o pré-check obrigatório, na seção 4.

---

## 3. Até onde a sequência completa roda no PGlite (e dois achados)

Testado, não lido. Os três pontos de parada, com a mensagem real:

| Ordem tentada | Onde para | Mensagem real |
| --- | --- | --- |
| `0001..0051` em ordem de arquivo, sem carga inicial | **0014** | `null value in column "organization_id" of relation "project_service" violates not-null constraint` |
| carga inicial logo depois de `0003` | **seed** | `relation "project_service" does not exist` |
| carga inicial depois de `0013`, ordem de arquivo | **0014** | `record "new" has no field "version"` |
| carga inicial depois de `0013` + `0015` adiantada | **não para** | 51/51 aplicadas |

Daí saem dois achados que não são sobre a Central, mas entram no runbook porque mudam o plano de contingência:

1. **`supabase/deploy.sql` não reconstrói mais o banco do zero.** Ele concatena *todas* as migrations e só depois
   a carga inicial; as migrations de dados (0014, 0018, 0020, 0021, 0022) fazem
   `(select id from organization where code = 'EIFF')` e, num banco vazio, isso é `null`. O caminho "cole o
   `deploy.sql` no SQL Editor" de `docs/implantacao-supabase.md` para em 0014.
2. **A fila não é replayável em ordem de arquivo.** A `0015` cria `project_service.version`, que o trigger
   `touch_updated_at()` exige no `on conflict do update` da `0014` — ou seja, a correção vem *depois* do problema
   que corrige. É história, não defeito: em produção as duas já estão aplicadas. Mas significa que **não existe
   hoje um caminho testado de reconstruir o banco a partir do repositório**, e portanto nenhum plano de rollback
   pode depender disso.

`--ordem-corrigida` adianta a 0015 e a fila inteira fica verde. Nada disso toca 0049–0051, que aplicam limpas nas
quatro variações acima em que a fila chega até elas.

---

## 4. Pré-condições

Antes de tocar no banco:

1. **Conferir onde o banco está.** Não há tabela de controle de migrations (o projeto aplica com
   `supabase db query -f`, não com `db push`), então a posição se descobre pelos objetos:

   ```sql
   select o.marco, case when o.presente then 'aplicada' else 'FALTA' end situacao
   from (values
     ('0044 corte do extrato', exists (select 1 from information_schema.columns
        where table_name = 'parameter_set' and column_name = 'statement_cutoff')),
     ('0045 ledger de entrega', to_regclass('public.radar_communication_delivery') is not null),
     ('0046 evento de entrega', to_regclass('public.radar_communication_delivery_event') is not null),
     ('0047 autoridade server-only', not has_function_privilege('authenticated',
        'public.radar_delivery_create(uuid,uuid,text,text,text,text,text,text,text)', 'EXECUTE')),
     ('0048 coerencia de canal', (select pg_get_functiondef(p.oid) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'radar_delivery_create') like '%Octadesk só entrega WhatsApp%'),
     ('0049 whatsapp_identity', to_regclass('public.whatsapp_identity') is not null),
     ('0050 central_conversation', to_regclass('public.central_conversation') is not null),
     ('0051 provider META_CLOUD', (select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'radar_communication_delivery_provider_check') like '%META_CLOUD%')
   ) as o(marco, presente);
   ```

   O esperado hoje é 0044–0048 `aplicada` e 0049–0051 `FALTA`. **Qualquer outra combinação para a aplicação**:
   0049/0050 já presentes significam aplicação parcial anterior, e aí vale a armadilha da seção 7.

2. **Pré-check da 0051** — a única que mexe em objeto com dados:

   ```sql
   select count(*) fora_do_catalogo from radar_communication_delivery
    where provider not in ('MANUAL', 'OCTADESK', 'META_CLOUD');
   select provider, status, count(*) from radar_communication_delivery group by 1, 2 order by 1, 2;
   ```

   A primeira **tem de devolver 0**. A segunda deve devolver zero linhas (o envio nunca foi ligado); se devolver
   algo, não é impeditivo — só confirma que a tabela tem dados e o `add constraint` vai varrê-los.

3. **Rodar os dois harnesses e ver verde** (leva segundos, não toca rede):

   ```bash
   node scripts/pg-smoke-central.mjs        # 10 smoke tests A–J
   node scripts/pg-preflight-central.mjs --ordem-corrigida
   ```

4. **Dump antes de aplicar.** Não há backup automático no plano Free e não há caminho testado de reconstrução
   (seção 3): o dump é a única rede. `npx supabase db dump --linked -f backup-antes-0049.sql` (schema) e
   `--data-only` para os dados. Guardar fora do repositório.

5. Janela: aplicar com ninguém usando o sistema. A `0051` toma `ACCESS EXCLUSIVE` em
   `radar_communication_delivery` pelo tempo do `add constraint` (instantâneo numa tabela vazia, mas é um lock
   exclusivo).

---

## 5. Aplicação

Uma migration por vez, na ordem, **cada uma dentro da própria transação**, conferindo entre elas.

> **Por que a transação explícita importa.** `supabase db query --linked` vai pela Management API, não pelo psql:
> não há garantia documentada de que o arquivo inteiro roda numa transação. Na `0051` isso é crítico — ela faz
> `drop constraint` e depois `add constraint`. Se as duas não estiverem na mesma transação e o `add` falhar, a
> tabela fica **sem nenhum CHECK de provider**, calada. Envelope explícito resolve.

Prepare uma cópia envelopada (não edite a migration):

```bash
# Git Bash / PowerShell — vale para cada uma das três
printf 'begin;\n' > /tmp/0049.sql
cat supabase/migrations/0049_whatsapp_identity.sql >> /tmp/0049.sql
printf '\ncommit;\n' >> /tmp/0049.sql
```

Depois:

```bash
npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f /tmp/0049.sql
# conferir (seção 6), só então:
npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f /tmp/0050.sql
# conferir, só então:
npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f /tmp/0051.sql
```

Alternativa equivalente e igualmente aceitável: colar o conteúdo envelopado no **SQL Editor** do painel, uma
migration por execução.

Ordem obrigatória: `0050` referencia `whatsapp_identity(id)` (criada pela 0049). A `0051` é independente das
outras duas, mas depende de 0045–0048.

---

## 6. Verificação pós-aplicação

Rodar depois das três. Cada linha tem o valor esperado ao lado — foram conferidos contra o schema completo reconstruído do repositório no
preflight:

```sql
select 'tabelas' item, count(*)::text valor, '4' esperado from pg_tables
  where schemaname = 'public'
    and tablename in ('whatsapp_identity','central_conversation','central_message','central_event')
union all select 'policies de SELECT', count(*)::text, '4' from pg_policies
  where tablename in ('whatsapp_identity','central_conversation','central_message','central_event') and cmd = 'SELECT'
union all select 'triggers', count(*)::text, '13' from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and c.relname in ('whatsapp_identity','central_conversation','central_message','central_event')
union all select 'RPCs executáveis por authenticated', count(*)::text, '0'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('whatsapp_identity_request','whatsapp_identity_verify',
    'whatsapp_identity_attempt','whatsapp_identity_transition','radar_delivery_create','radar_delivery_transition')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
union all select 'RPCs executáveis por service_role', count(*)::text, '6'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('whatsapp_identity_request','whatsapp_identity_verify',
    'whatsapp_identity_attempt','whatsapp_identity_transition','radar_delivery_create','radar_delivery_transition')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
union all select 'privilégios de authenticated nas 4 tabelas', string_agg(distinct privilege_type, ','), 'SELECT'
  from information_schema.role_table_grants where grantee = 'authenticated'
    and table_name in ('whatsapp_identity','central_conversation','central_message','central_event')
union all select 'CHECK de provider', (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'radar_communication_delivery_provider_check'), 'inclui META_CLOUD';
```

Mais duas conferências que valem por si:

```sql
-- RLS ligada nas quatro tabelas novas (tem de vir 4 linhas com rowsecurity = true)
select relname, relrowsecurity from pg_class
 where relname in ('whatsapp_identity','central_conversation','central_message','central_event');

-- a 0048 não foi perdida: a 0051 substitui radar_delivery_create e tem de manter a linha do Octadesk
select (pg_get_functiondef(p.oid) like '%Octadesk só entrega WhatsApp%') octadesk_preservado,
       (pg_get_functiondef(p.oid) like '%Meta Cloud só entrega WhatsApp%') meta_incluida
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'radar_delivery_create';
```

Depois, rodar a posição da seção 4 de novo: as oito linhas têm de vir `aplicada`.

**Não é preciso testar comportamento em produção.** Criar identidade de teste, conversa de teste ou entrega de
teste deixa linha em tabela que a Central vai usar — e `central_event` é append-only, não se apaga. O comportamento
está provado nos harnesses (P1–P5, A–J). Em produção, conferir estrutura, não exercitar regra.

---

## 7. Rollback: o que volta e o que não volta

| O que | Reversível? | Como, e a ressalva |
| --- | --- | --- |
| `0049` — tabela e RPCs novas | **sim, enquanto não houver dados** | `drop table whatsapp_identity cascade;` + `drop function whatsapp_identity_request/verify/attempt/transition/coerencia/estado/audit/seguro`. O `cascade` derruba junto a FK que a 0050 cria; se já houver identidade verificada, o drop **destrói** o vínculo e não há de onde tirar de volta |
| `0050` — três tabelas novas | **sim, enquanto não houver dados** | `drop table central_event, central_message, central_conversation cascade;` + as funções `central_*`. Havendo mensagem recebida, o drop apaga a trilha — e `central_event` é append-only justamente para isso não acontecer |
| `0051` — `create or replace function radar_delivery_create` | **sim** | reaplicar a `0048`: ela tem o corpo anterior inteiro e o `create or replace` volta a função ao estado de antes |
| `0051` — CHECK de `provider` | **sim, e só enquanto nenhuma entrega `META_CLOUD` existir** | `alter table radar_communication_delivery drop constraint radar_communication_delivery_provider_check; alter table ... add constraint ... check (provider in ('MANUAL','OCTADESK'));`. Estreitar um CHECK **revalida a tabela inteira**: se já houver uma linha `META_CLOUD`, o `add constraint` falha e não há como estreitar sem apagar a linha — e o ledger de entrega é imutável por desenho (0047) |
| Dados de produção em geral | **não** | plano Free, sem backup automático (`docs/implantacao-supabase.md`). O `deploy.sql` não reconstrói (seção 3). Só o dump da seção 4 |

**A armadilha da reaplicação parcial.** As três migrations são idempotentes (`create table if not exists`,
`drop trigger if exists`, `create or replace function`) — e o preflight prova isso reaplicando as três sobre o
schema já migrado. Mas `create table if not exists` é idempotente, **não** convergente: se a tabela já existir com
outra forma (aplicação parcial anterior, criação manual), ela é deixada como está, em silêncio, e as constraints
nunca chegam. Por isso a seção 4 manda conferir a posição antes: 0049/0050 marcadas `aplicada` quando não deveriam
estar é motivo para parar e comparar o schema, não para reaplicar por cima.

---

## 8. Se a aplicação falhar no meio

1. **Não reaplique por reflexo.** Leia a mensagem: com o envelope `begin/commit` da seção 5, a migration que falhou
   não deixou nada — o estado é o de antes dela.
2. Rode a posição da seção 4. Ela diz qual das três entrou.
3. Falha na **0049**: nada a desfazer, corrigir e repetir.
4. Falha na **0050** com a 0049 aplicada: estado consistente (a 0049 não depende da 0050). Corrigir e repetir a
   0050; não é preciso mexer na 0049.
5. Falha na **0051**: conferir imediatamente se o CHECK de `provider` ainda existe —

   ```sql
   select conname, pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'radar_communication_delivery'::regclass and contype = 'c';
   ```

   Se `radar_communication_delivery_provider_check` sumiu (envelope esquecido, ou o `add` falhou fora de
   transação), **recrie-o antes de qualquer outra coisa**, com o catálogo antigo, e só depois investigue:

   ```sql
   alter table radar_communication_delivery add constraint radar_communication_delivery_provider_check
     check (provider in ('MANUAL', 'OCTADESK'));
   ```

6. Em qualquer caso: a Central não age e o envio segue bloqueado no código, então uma aplicação incompleta não
   produz efeito externo nenhum. Não há pressa de "consertar rápido".

---

## 9. Lacunas e riscos que só aparecem contra o schema completo reconstruído do repositório

| Risco levantado | Veredito | Evidência |
| --- | --- | --- |
| `has_role` recebe `role_kind[]` (enum) e as policies passam literais de texto (`has_role('Administrador', ...)`) | **não é lacuna** | literal sem tipo é resolvido para o tipo do parâmetro; a policy fica gravada como `has_role(VARIADIC ARRAY['Administrador'::role_kind, 'Diretoria'::role_kind, 'Financeiro'::role_kind])`. Conferido no preflight contra o `has_role` real de `0003_rls.sql`. Bônus: um literal errado (`'Diretor'`) falharia **no `create policy`**, alto e claro, não em silêncio |
| `current_org()` é STABLE e há a regra do `CLAUDE.md`: policy de SELECT não pode consultar a própria tabela | **respeitada** | `wi_select` e `cc_select` usam só colunas da própria linha + `current_org()`/`has_role()`, que leem `profile`. `cm_select`/`ce_select` fazem `exists` em `central_conversation`, cuja policy **não** olha para mensagem nem evento — sem recursão. E o caso da 0025 (`INSERT ... RETURNING` que não enxerga a linha nova) não se aplica: `authenticated` não tem INSERT em nenhuma das quatro; quem grava é o webhook com `service_role`, que passa por cima da RLS |
| `0051` faz `drop constraint` + `add constraint` em `radar_communication_delivery`, que existe em produção | **seguro, com envelope** | o novo CHECK é **superconjunto estrito** do antigo (`MANUAL`, `OCTADESK` ⊂ `MANUAL`, `OCTADESK`, `META_CLOUD`): toda linha que passava no antigo passa no novo. Não há nenhum `NOT VALID` no repositório (conferido), então nenhuma linha escapou da validação original. O risco real não é a linha, é a **janela sem CHECK** entre o drop e o add — resolvida pela transação explícita da seção 5. O pré-check da seção 4 confirma o raciocínio no banco |
| `whatsapp_identity` referencia `worker(id)` e `profile(id)` | **ok, com um efeito colateral novo** | as duas tabelas existem (0001 e 0008) e a tabela nova nasce vazia, então criar as FKs não valida nada. O efeito colateral: `profile` e `worker` passam a ter mais um dependente — apagar um perfil ou colaborador com identidade vinculada passa a ser recusado. Nenhuma tela do app apaga perfil ou colaborador (o padrão é inativar), mas vale saber. O mesmo vale para `central_conversation.human_owner_id` e `central_event.actor_id`, que também referenciam `profile(id)` |
| Coerência cross-tenant depende de trigger, não de FK | **fechado** | FK não sabe de organização; os triggers `whatsapp_identity_coerencia`, `central_conversation_coerencia` e `central_event_ator_coerencia` sabem, e são `security definer`. Provado em P2 e no smoke A/B/C |
| Trigger de auditoria da 0049 escreve em `audit_log`, que tem RLS | **ok** | `whatsapp_identity_audit()` é `security definer` e `audit_log` não tem `force row level security` (conferido em todas as migrations), então o dono da tabela não é barrado pela própria policy. Exercitado em P1, que dispara o trigger |
| Versão do Postgres | **conferir na hora** | o ensaio rodou em PostgreSQL 17.5 (PGlite). Rodar `select version();` em produção antes de aplicar; nada em 0049–0051 usa recurso posterior ao Postgres 12 (`generated always`, `jsonb_path`, nada disso), mas o registro fica |
| Não há como ensaiar contra os dados reais | **aberto, e é o risco residual** | seção 1. Mitigação: as três são aditivas, o pré-check da seção 4 cobre o único ponto com dados, e o dump é a rede |

---

## 10. Recomendação

**Sim, dá para aplicar hoje** — 0049, 0050 e 0051, nesta ordem, seguindo as seções 4 a 6.

O que sustenta isso:

- as três aplicam limpas sobre o schema completo reconstruído do repositório, não sobre um esqueleto: a fila `0001..0051` inteira roda verde num
  Postgres de verdade, e as cinco provas funcionais passam contra `role_kind`, `has_role`, `current_org`,
  `profile`, `worker` e o ledger de 0045–0048 reais;
- 0049 e 0050 só criam objetos novos. Não alteram nenhuma tabela existente, não migram dado nenhum, e a única
  marca que deixam no que já existe são duas FKs para `profile`/`worker` (seção 9);
- 0051 é o único ponto que toca objeto com dados, e o toque é o alargamento de um CHECK — matematicamente
  incapaz de rejeitar linha que já estava lá. O risco dela não é a linha: é a janela sem CHECK entre o `drop` e o
  `add`, e a transação explícita da seção 5 fecha essa janela;
- nada disso liga envio. Se algo der errado, o efeito externo continua sendo zero.

O que **não** fica resolvido por aplicar, e não deve ser confundido com resolvido:

1. **Continua não existindo ambiente seguro.** A próxima migration da Central que *não* for aditiva — a que ligar
   o envio, a que mexer em dado existente, qualquer `alter column` ou `drop` — não deve ser aplicada nestas
   condições. Antes dela: projeto de staging, ou preview branch (exige plano pago e `config.toml`), ou o stack
   local com Docker.
2. **Continua não existindo backup automático nem caminho testado de reconstrução** (seções 1 e 3). O plano Pro já
   está na lista de pendências do `CLAUDE.md`; enquanto não entrar, o dump manual da seção 4 é obrigatório antes
   de cada aplicação, não opcional.
3. O `supabase/deploy.sql` está quebrado para banco novo. Não é bloqueio para esta release (ninguém vai
   reconstruir o banco), mas é dívida: hoje o repositório não sabe recriar o próprio banco.

Ou seja: aplicar **estas três** é seguro. Continuar aplicando **assim** não é.

---

## 11. Depois de aplicar

- Atualizar o `CLAUDE.md`, seção "Estado e decisões": trocar "Migrations aplicadas até 0048" por "até 0051", com a
  linha de cada uma no mesmo formato das anteriores.
- Guardar a saída da verificação da seção 6 junto do registro da aplicação.
- Manter os dois harnesses no ciclo: qualquer migration nova da Central entra primeiro no
  `pg-preflight-central.mjs` e só depois no banco.

## 11. Registro de aplicação — 11/09/2026 (F1 da Wave 03)

Aplicadas em produção (`dduobppgomqyagjviwpx`), pelo Architect, sob autorização explícita "APLIQUE AGORA", uma por vez,
cada uma em cópia temporária envelopada em `begin; … commit;` (originais intocados), via `supabase db query --linked
--project-ref … -f`. Backups prévios (fora do repositório, `D:\Usuario\Documents\CLAUDE\backups\eiff-control\`):
schema `…-schema-20260911-1652.sql` (348.748 bytes, SHA-256 `458bd144…1728520`) e dados `…-data-20260911-1652.sql`
(7.887.699 bytes, SHA-256 `d3d08d0a…258044`), ambos reconfirmados imediatamente antes da primeira escrita.

| Migration | Apply | POST-CHECK (read-only) |
| --- | --- | --- |
| 0049 | exit 0 | tabela + RLS; índices `pkey`, `pessoa_idx`, `telefone_idx`, `verificada_uk`; triggers `audit`, `coerencia`, `estado`, `touch`; policy `wi_select`; RPCs `request`/`verify`/`attempt`/`transition` com EXECUTE só para `service_role` (0 para `authenticated`/`anon`); grants `SELECT`; 0 linhas |
| 0050 | exit 0 | 3 tabelas + RLS; policies `cc_select`/`cm_select`/`ce_select`, filhos herdando a visibilidade da conversa; 9 triggers; `UNIQUE (organization_id, provider, external_message_id)` e `UNIQUE (organization_id, context, phone_e164)`; grants `SELECT`; 0 linhas |
| 0051 | exit 0 | `CHECK (provider IN ('MANUAL','OCTADESK','META_CLOUD'))`; `radar_delivery_create` preserva "Octadesk só entrega WhatsApp" e inclui "Meta Cloud só entrega WhatsApp"; EXECUTE só `service_role`; ledger com 0 linhas antes e depois |

Validação global (seção 6): tabelas 4/4 · policies de SELECT 4/4 · triggers 13/13 · RPCs por `authenticated` 0/0 ·
RPCs por `service_role` 6/6 · privilégios de `authenticated` = SELECT · RLS ligada 4/4 · CHECK inclui META_CLOUD.
Posição final: 0044–0051 `aplicada`. Contagens: `whatsapp_identity` 0, `central_conversation` 0, `central_message` 0,
`central_event` 0, `radar_communication_delivery` 0. Nenhuma identidade, conversa, mensagem ou entrega criada; nenhum
envio; nenhuma mutação financeira. Nota para a restauração: o `pg_dump` alertou FKs circulares em
`measurement`↔`financial_entry`, `stock_movement` e `radar_company` — restaurar o dump de dados exige
`session_replication_role = replica` (já no cabeçalho) ou `--disable-triggers`.

## 12. Próxima migration: 0052 — preparada, NÃO aplicada (Wave 03 F2, decisão D2/B+)

`0052_central_inbound_content.sql` cria `central_message_content` (conteúdo inbound normalizado) e
`central_message_processing` (trilha tipada de processamento). É **estritamente aditiva** (nenhum ALTER em 0049–0051),
idempotente, e foi provada: smoke K–U em `scripts/pg-smoke-central.mjs` (exit 1 em qualquer FALHOU) e preflight
`scripts/pg-preflight-central.mjs --ordem-corrigida` 0001..0052 com prova P6 e reaplicação 0049..0052 sem erro. **Só será
aplicada em produção com autorização separada e explícita do proprietário** ("APLIQUE AGORA" para a 0052), e o
Mission Control mantém `CENTRAL_INBOUND_PERSISTENCE` aberto até lá.

Pré-condições, no dia: `main`/`integracao-wave03` no SHA aprovado; Quality Gate verde; posição real do banco = 0044–0051
`aplicada` e **nenhum** objeto `central_message_content`/`central_message_processing` presente; preflight 0001..0052
verde no mesmo SHA; backup novo (schema + dados) fora do repositório com SHA-256 registrado; `CENTRAL_ALPHA_MODE` ausente
ou `off` no Netlify (o webhook continua descartando o payload até a F2 estar integrada e o Alpha liberado).

Aplicação: cópia temporária envelopada em `begin; … commit;`, `supabase db query --linked --project-ref
dduobppgomqyagjviwpx -f <cópia>`; original intocado; sem `db push`.

POST-CHECK (read-only), tudo em `select`:

```sql
select tablename, rowsecurity from pg_tables where tablename in ('central_message_content','central_message_processing');
select policyname, tablename from pg_policies where tablename in ('central_message_content','central_message_processing');
select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal
  and c.relname in ('central_message_content','central_message_processing') order by 1;           -- 5 triggers
select conname from pg_constraint where conrelid = 'central_message_processing'::regclass and contype = 'c' order by 1;
select indexname from pg_indexes where tablename = 'central_message_processing' order by 1;       -- inclui _webhook_uk
select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
  where grantee = 'authenticated' and table_name in ('central_message_content','central_message_processing') group by 1;  -- SELECT
select (select count(*) from central_message_content) conteudos, (select count(*) from central_message_processing) processamentos;  -- 0, 0
```

Rollback: forward-fix (D1). Sem `down` automático; `drop table` das duas tabelas só com nova autorização, e só enquanto
estiverem vazias.

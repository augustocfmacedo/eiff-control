# E-mail comercial — pré-flight de implantação da migration 0075

**Data:** 12/11/2026 (pré-flight) e 12/11/2026 (validação do CLI e do backup, seção 4.0) · **Base:** `main` em `9e5de09` ·
**Banco:** projeto `dduobppgomqyagjviwpx` (PostgreSQL 17.6)

**Parecer: APTO COM RESSALVAS.** A migration está tecnicamente pronta para ter a aplicação solicitada à Direção.
As ressalvas são exigências operacionais do momento da aplicação (seção 6), não defeitos do código.

Este documento é só leitura, análise e simulação. **A migration 0075 não foi aplicada em produção.** Nada foi
publicado, nenhuma variável foi configurada e nenhum e-mail foi enviado.

---

## 1. O que a 0075 faz

| Operação | Objeto | Toca dado existente? |
|---|---|---|
| Troca a constraint de provider | `inbox_message.inbox_message_provider_check` passa a aceitar `GOOGLE_WORKSPACE` | Não. Revalida as linhas existentes (todas válidas) |
| Cria o livro de entregas | `inbox_email_delivery`, `inbox_email_delivery_event`, 7 índices, 5 triggers, 2 políticas | Não |
| Cria um trigger na mensagem | `inbox_message_email_governada` (antes de INSERT/UPDATE) | Não. Só age em linhas do provider novo |
| Cria 8 funções | 3 RPCs só para `service_role`, 3 funções de trigger, 2 auxiliares | Não |

Nenhuma linha existente é inserida, alterada ou apagada. Nenhuma coluna é criada em tabela existente.

## 2. Conferência do banco real (somente leitura)

Consulta usada: `scripts/email-0075/retrato.sql` (um único `SELECT`).

**Histórico de migrations.** O projeto não tem ledger de migrations; o que vale é o schema real. Marcadores
conferidos: 0056, 0057, 0058 (12 setores), 0069, 0070, 0071, 0072 e 0073 presentes; **0074 ausente** (já era
sabido: aguarda autorização própria). A 0075 não depende da 0074: são frentes separadas (Radar × Inbox) e nenhum
objeto de uma é usado pela outra. Aplicar a 0075 antes da 0074 é seguro.

**Estrutura.** O retrato cobre `inbox_thread`, `inbox_message`, `inbox_contact`, `inbox_contact_identity`,
`inbox_thread_event`, `profile` e `organization`:

| Seção | Itens no banco real | Diferenças para o banco de teste |
|---|---|---|
| Colunas (tipo, nulo, padrão) | 104 | 0 |
| Constraints (definição) | 64 | 0 |
| Triggers (definição) | 11 | 0 |
| Índices (definição) | 19 | 0 |
| Políticas RLS (comando, papéis, expressões) | 17 | 0 |
| RLS ligada por tabela | 7 | 0 |
| Funções de que o Inbox depende (hash do corpo) | 13 | 0 |
| Funções de trigger (hash do corpo) | 7 | 0 |

O banco de teste foi montado com a fila completa `0001..0074` e comparado item a item com o real: **242 itens,
nenhuma diferença**. O que a 0075 espera encontrar é exatamente o que existe.

**O que a 0075 precisa e o banco tem:**
- a constraint se chama `inbox_message_provider_check` (o nome que a migration remove) e hoje aceita
  `MANUAL`, `OCTADESK`, `META_CLOUD`;
- `delivery_state` já aceita `registrada`, `enviada` e `falhou`, os três valores que as RPCs gravam;
- o enum de papéis tem `Administrador` e `Diretoria`; há 1 perfil ativo com permissão de envio;
- `current_org()`, `inbox_thread_event`, `profile.active` e `inbox_thread.participant_ids` existem;
- o padrão «só o servidor chama» (`request.jwt.claims` + `auth.uid()` nulo) já é usado em produção pelas RPCs das
  migrations 0047, 0056 e 0057.

**Dados existentes.** 2 conversas, 5 mensagens (3 `MANUAL`, 2 `META_CLOUD`), 2 contatos, 18 eventos, 1 organização,
3 perfis. Nenhuma mensagem tem provider fora do catálogo atual, então a nova constraint valida sem recusa.
Impressões (hash) das mensagens e das conversas estão guardadas para comparação depois da aplicação.

**Nada da 0075 existe hoje:** as duas tabelas e as funções `inbox_email_*` estão ausentes.

### 2.1 A troca da constraint de `inbox_message`

- **Bloqueio:** `ALTER TABLE` pede bloqueio exclusivo da tabela pelo tempo da revalidação. A tabela tem 5 linhas e
  104 kB: a revalidação é instantânea. No momento da consulta não havia sessão ativa, transação longa nem bloqueio
  exclusivo nas tabelas do Inbox.
- **Proteção:** o roteiro aplica com `lock_timeout = 5s`. Se algo estiver usando o Inbox, a aplicação falha em vez
  de esperar, e nada muda.
- **Validação dos dados:** todas as linhas atuais satisfazem a constraint nova (ela só acrescenta um valor).
- **Impacto no Inbox atual:** nenhum. O catálogo fica mais largo; a versão publicada hoje não grava o provider novo.
- **Trigger novo na mensagem:** roda em todo INSERT/UPDATE de `inbox_message`, mas devolve a linha intocada quando o
  provider não é `GOOGLE_WORKSPACE`. Ingestão do site e do WhatsApp e atualização de mensagens antigas foram
  exercitadas depois da 0075 no banco de teste e seguem funcionando.

### 2.2 Diferenças entre o banco real e o de teste

| Diferença | Consequência |
|---|---|
| Real: PostgreSQL 17.6 gerenciado. Teste: PGlite (PostgreSQL 17.5 em WASM) | Sintaxe e semântica iguais; planner, bloqueios e concorrência não são exercitados |
| Teste tem **uma** conexão | Corrida real entre duas transações **não foi simulada** (ver ressalva R3) |
| Teste imita `auth`, `storage` e os papéis do Supabase | A 0075 só usa `auth.uid()` e `request.jwt.claims`, já usados em produção |
| Teste tem a 0074 aplicada; o real não | Sem efeito: a 0074 não toca nenhuma das tabelas comparadas |
| Real tem 6 event triggers da plataforma | Não interferem em `CREATE TABLE`/`FUNCTION` de migrations anteriores |

## 3. Simulação em banco descartável

Script: `scripts/email-0075/simular.mjs`. Banco em memória, sem rede, com a fila `0001..0074` e dados fictícios com
a **mesma forma** dos reais (2 conversas, 5 mensagens, mesmos providers e estados). A aplicação usa o **mesmo
envelope** do roteiro (seção 4). Tempo da aplicação no teste: 27 ms.

| # | Prova | Resultado |
|---|---|---|
| A | Transação desfeita (`ROLLBACK`) não deixa rastro | PASS |
| B | Dados preexistentes idênticos depois da 0075 (hash) | PASS |
| C | Constraint aceita as linhas antigas e o provider novo, validada | PASS |
| D | Livro criado: 2 tabelas, 8 funções, 5 triggers, 2 políticas | PASS |
| E | RPCs só para `service_role`; navegador só lê; RLS ligada | PASS |
| F | Ingestão (site e WhatsApp) e atualização de mensagem antiga seguem funcionando | PASS |
| G | Mensagem de e-mail não nasce fora das RPCs | PASS |
| H | Idempotência: mesma intenção devolve a mesma entrega; outro conteúdo é recusado; pendente bloqueia a conversa | PASS |
| I | Financeiro e Solicitante são recusados no banco | PASS |
| J | SLA só muda no aceite; a mensagem vira `enviada` | PASS |
| K | Histórico imutável: evento sem UPDATE/DELETE, entrega sem DELETE, sem regressão, comando congelado | PASS |
| L | Limites diários por usuário e por organização | PASS |
| M | Leitura pela RLS: Administrador vê a entrega; Solicitante não vê nada | PASS |
| N | RPC chamada com sessão de usuário se recusa | PASS |
| O | Reaplicar a 0075 é idempotente e preserva o livro | PASS |
| O2 | Envelope aplicado duas vezes: a segunda é recusada pelo pré-check, sem efeito | PASS |
| P | Recuperação manual (livro vazio) devolve estrutura e dados ao estado inicial | PASS |
| Q | Com entrega já registrada, a recuperação se recusa e nada é apagado | PASS |

18 provas, 0 falha. As 15 provas do `npm run smoke:email` (Quality Gate) continuam valendo e cobrem o mesmo livro
num schema mínimo.

**Não simulado:** concorrência real (duas transações ao mesmo tempo). A serialização por conversa (`FOR UPDATE`), o
bloqueio consultivo dos limites e os índices únicos estão provados por construção e pelo tratamento de
`unique_violation`, não por corrida.

## 4. Roteiro de aplicação

**Só com autorização expressa da Direção para aplicar a 0075 em produção.**

### 4.0 Validação do Supabase CLI e do backup (12/11/2026)

**Versão.** Supabase CLI **2.116.0**, a do projeto: `package.json` fixa `^2.116.0` e o `npx supabase` usa a cópia de
`node_modules` (não há instalação global). O CLI avisa que existe a 3.1.0: **não atualizar antes da aplicação**, porque
os comandos abaixo foram validados na 2.116.0.

**Comandos e parâmetros validados nesta versão:**

| Uso | Comando | Validação |
|---|---|---|
| Leitura e aplicação de arquivo SQL | `npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f <arquivo>` | Executado com o retrato e com os dois ensaios (abaixo) |
| Lista de backups | `npx supabase backups list --project-ref dduobppgomqyagjviwpx` | Executado |

- `--linked` sozinho **falha** nesta máquina (`Cannot find project ref`): o projeto não está vinculado localmente.
  Sempre passar `--project-ref`.
- `db query --linked` executa pela **API de gerenciamento** do Supabase, como o usuário `postgres`, dono de
  `inbox_message` (pode alterar a tabela e criar objetos no `public`; não é superusuário). Cada execução é uma única
  requisição: o arquivo inteiro roda numa sessão, e `begin`/`commit`/`rollback` do arquivo valem.
- Erro dentro do arquivo: o CLI devolve **código de saída 1** e a mensagem do banco; sucesso devolve **0** e a linha
  do último `SELECT`.
- **Não usar** `db push` nem `db reset`: há migrations pendentes de outras frentes (a 0074 está no repositório e não
  no banco) e o projeto não tem ledger de migrations; os dois aplicariam ou apagariam mais do que a 0075.
- **Não usar** `db dump --dry-run`: na 2.116.0 ele imprime na tela a senha do usuário temporário de login que o CLI
  cria. O teste feito em 12/11 mostrou isso; o comando não entra no roteiro.
- `backups restore` só faz recuperação **pontual (PITR)**, que está desligada neste projeto: não serve aqui.

**Ensaios no banco real, sem a migration** (gerados por `envelope.mjs` junto com o envelope; mesmo comando da
aplicação; nenhum contém a 0075, nenhum grava em tabela permanente):

| Ensaio | O que faz | Resultado em 12/11 |
|---|---|---|
| `scratch/0075-ensaio-conclui.sql` | Pré-checks reais + tabela temporária + `ROLLBACK` + uma linha de resultado | Código 0; `ENSAIO OK: pre-checks aprovados, nada aplicado`, livro ausente, 0 funções |
| `scratch/0075-ensaio-recusa.sql` | Pré-checks reais + erro proposital | Código 1; mensagem do banco; transação desfeita |

Depois dos ensaios, conferido por leitura: nada da 0075 existe, a tabela temporária não sobrou, e as impressões das
mensagens e das conversas são idênticas às do pré-flight.

**Compatibilidade revalidada.** O retrato estrutural (242 itens) foi repetido em 12/11 e é **idêntico** ao de 11/11.

**Backup.**

| Item | Situação em 12/11/2026 19:06 UTC |
|---|---|
| Backup mais recente | **12/11/2026 05:31:27 UTC**, físico (WAL-G), `COMPLETED` |
| Retenção visível | 8 backups diários, de 05/11 a 12/11, todos `COMPLETED` |
| PITR | **Desligado** |
| Cobertura do Inbox | Total: a última alteração de conversa é de 11/11 20:24 UTC e a última mensagem de 10/11 20:56 UTC, ambas anteriores ao backup |
| Atividade depois do backup | 27 registros de auditoria em outros módulos (o último às 14:25 UTC) |
| Tamanho do banco | 39 MB |

**Recuperação disponível e limites:**
1. **Primeira linha, sem perda:** `scripts/email-0075/recuperacao-0075.sql`, estrutural, com autorização própria.
   Funciona enquanto o livro estiver vazio (provas P e Q da simulação). A 0075 não altera dado existente, então não
   há dado a recuperar se ela der errado: o envelope desfaz tudo antes de confirmar.
2. **Último recurso:** restaurar o backup diário pelo painel do Supabase (Database › Backups). Restaura o **projeto
   inteiro** ao instante do backup, com o banco fora do ar durante a restauração, e **perde tudo o que foi gravado
   depois dele em qualquer módulo** (em 12/11 às 19:06 UTC isso já eram 27 ações auditadas). Não é reversível.

Por isso o backup de ontem não é garantia suficiente: o que conta é o backup do **mesmo dia**, e a aplicação deve
ser feita **logo depois dele**, antes do expediente, para a perda num restauro de último recurso ser mínima.

### 4.1 Pré-requisitos

1. `main` em `9e5de09` ou posterior, sem mudança no arquivo `supabase/migrations/0075_inbox_email_delivery.sql`.
   SHA-256 esperado da migration: `3a08e2642d9b943a8363e0f3725d288ddcc0671a1ee68acec9a3b4dc6e9522d3`.
2. **Backup do mesmo dia** com `status` `COMPLETED` (o diário roda por volta de 05:30 UTC = 02:30 em Brasília).
   Anotar o `inserted_at`. Sem backup do dia, **não aplicar**.
   ```bash
   npx supabase backups list --project-ref dduobppgomqyagjviwpx
   ```
   E conferir que nada foi gravado depois dele (zero ou quase zero, no início da manhã):
   ```bash
   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx "select now() as agora, (select count(*) from audit_log where occurred_at > '<inserted_at do backup>') as acoes_depois_do_backup"
   ```
3. Deploy publicado do EIFF Control inalterado e travado (`6af4b249`, commit `267a0b5`). A 0075 entra **antes** de
   qualquer publicação do código de e-mail.
4. Momento sem uso do Inbox (ninguém atendendo, sem importação em curso).

### 4.2 SQL exato

O SQL é a migration, sem alteração, dentro de um envelope transacional. Gerar e conferir o hash:

```bash
node scripts/email-0075/envelope.mjs
```

Saída esperada: `sha256 do envelope : 10b82e451f5cb812f1793411c8b6479e4ca27c3f5666ec6fb53b974e4d3158ee`
(arquivo em `scratch/0075-envelope.sql`, pasta ignorada pelo git). Se o hash for outro, **parar**: o arquivo não é o
que foi simulado.

### 4.3 Ordem das operações

0. **Versão do CLI** igual à validada (`2.116.0`):
   ```bash
   npx supabase --version
   ```
   E **ensaio final** sem a migration, que tem de terminar com código 0 e `ENSAIO OK`:
   ```bash
   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scratch/0075-ensaio-conclui.sql
   ```
1. **Retrato antes** (leitura) e guardar o resultado:
   ```bash
   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/email-0075/retrato.sql
   ```
2. **Aplicar** o envelope (este é o único comando que altera o banco):
   ```bash
   npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scratch/0075-envelope.sql
   ```
   Código de saída 0 = aplicada e conferida. Código 1 = nada mudou (o banco desfez a transação); ler a mensagem.
   O envelope, numa única transação:
   - define `lock_timeout = 5s` e `statement_timeout = 60s`;
   - guarda contagens e impressões dos dados do Inbox;
   - **pré-checks** (aborta sem mudar nada se o livro já existir, se a constraint não for a esperada, se houver
     provider fora do catálogo ou se faltar dependência);
   - executa a 0075;
   - **pós-checks** (aborta e desfaz tudo se faltar objeto, se privilégio ou RLS estiverem errados, se o livro não
     nascer vazio ou se qualquer dado preexistente tiver mudado);
   - `COMMIT`.
3. **Retrato depois** (mesmo comando do passo 1) e comparar.

### 4.4 Critérios objetivos de sucesso

- O comando termina com a linha `APLICADA`, `funcoes = 8`, `entregas = 0`, e `mensagens`/`conversas` iguais ao
  retrato de antes.
- No retrato de depois, as únicas mudanças em objetos existentes são três: a constraint de provider com
  `GOOGLE_WORKSPACE`, o trigger `inbox_message_email_governada` e a função dele.
- `dados.impressao_mensagens` e `dados.impressao_conversas` idênticas às de antes.
- `/api/email-comercial` continua respondendo 404 em produção (a função só existe depois da publicação).
- O Inbox abre e lista as conversas normalmente na versão publicada.

### 4.5 Se falhar

| Situação | O que acontece | O que fazer |
|---|---|---|
| Erro em pré-check, na migration ou em pós-check | A transação é desfeita pelo próprio banco; **nada muda** | Ler a mensagem, não insistir; reportar |
| `lock_timeout` (Inbox em uso) | Idem: nada muda | Repetir em outro momento |
| Conexão cai no meio | Transação não confirmada é desfeita | Rodar o retrato e conferir que nada da 0075 existe |
| Aplicou e é preciso desfazer, **com o livro vazio** | — | `scripts/email-0075/recuperacao-0075.sql` pelo mesmo comando `db query -f`, com autorização própria |
| Aplicou e já existe entrega registrada | A recuperação **se recusa** (não apaga histórico de envio) | Desligar o envio pelas variáveis; o banco fica |

A recuperação é manual, só estrutural e foi provada no banco descartável (provas P e Q). Ela não é executada por
nenhum mecanismo automático. Desfazer não é o caminho normal: a 0075 aplicada e sem uso é inerte.

### 4.6 Indisponibilidade

Nenhuma prevista. O único bloqueio relevante é o da troca da constraint em `inbox_message`, de duração desprezível
numa tabela de 5 linhas. A versão publicada do sistema não depende de nada que a 0075 cria ou altera.

## 5. Efeito da 0075 sozinha em produção

Aplicada sem publicar o código e sem credenciais, a 0075 **não muda comportamento nenhum**: as tabelas ficam vazias,
as RPCs não têm quem as chame (só `service_role`, e a função Netlify não está publicada) e o trigger novo não age em
mensagens dos providers atuais.

## 6. Ressalvas (exigências antes e durante a aplicação)

- **R1 — Autorização.** Aplicação só com ordem expressa da Direção para a 0075 em produção.
- **R2 — Backup.** Aplicar só com o backup diário **do mesmo dia** concluído e logo depois dele, antes do expediente
  (seção 4.0). PITR está desligado: restaurar o backup diário é o último recurso e perde tudo o que foi gravado
  depois dele. O risco é baixo porque a 0075 não altera dado existente e o envelope confere isso antes de confirmar.
- **R3 — Concorrência não simulada.** Corrida real entre transações não foi exercitada. A exposição é pequena
  (envio manual, 30 por usuário e 100 por organização por dia) e deve ser observada no canário.
- **R4 — Ordem.** A 0075 entra antes de publicar o código de e-mail. Com a função publicada e sem a migration, o
  envio falharia fechado (nada sai), mas a tela mostraria erro.
- **R5 — Momento.** Aplicar sem uso do Inbox, para o `lock_timeout` não abortar a tentativa.
- **R6 — Hash.** Aplicar apenas o envelope cujo SHA-256 confere com o deste documento.
- **R7 — CLI.** Aplicar com o Supabase CLI 2.116.0, sem atualizar antes, sem `db push`, `db reset` ou
  `db dump --dry-run`, e só depois de o ensaio final terminar com código 0.

## 7. Próximo portão

Autorização da Direção para **aplicar a migration 0075 em produção** pelo roteiro da seção 4. Depois dela, em ordem
e cada um com autorização própria: configuração do Google Workspace (`docs/email-comercial-e0.md` §2), publicação do
EIFF Control, conferência da credencial, modo canário e um envio interno de teste.

## 8. Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/email-0075/retrato.sql` | Leitura da estrutura e das impressões dos dados (um `SELECT`) |
| `scripts/email-0075/envelope.mjs` | Gera o SQL exato da aplicação, o hash e os dois ensaios sem a migration; não fala com banco |
| `scripts/email-0075/simular.mjs` | Simulação em banco descartável (18 provas) |
| `scripts/email-0075/recuperacao-0075.sql` | Recuperação manual; recusa-se se houver entrega registrada |

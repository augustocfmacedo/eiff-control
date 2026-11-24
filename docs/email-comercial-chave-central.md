# E-mail comercial — chave central de bloqueio (migration 0076)

> **SITUAÇÃO: NÃO APLICADA.** Branch `feature/email-chave-central-0076`. Merge, aplicação e publicação são três portões
> separados: «MERGE AUTORIZADO», «APLICAÇÃO 0076 AUTORIZADA», «PRODUCTION AUTORIZADA». O envio de e-mail continua
> desligado em produção (`EIFF_EMAIL_SEND_MODE = disabled`, `EIFF_INBOX_OUTBOUND_ENABLED = false`).

## 1. Problema

As variáveis do Netlify valem **por deploy**: o Netlify congela o ambiente no build. O primeiro canário (16/11/2026)
mostrou que a função `email-comercial` responde pelo endereço permanente de **todo** deploy, publicado ou não. Um
deploy construído com o envio ligado continua podendo enviar pelo endereço dele até ser apagado; republicar outro deploy
não o desliga. Antes de qualquer operação comercial é preciso um interruptor que desligue **todos** os deploys de uma vez.

## 2. Solução

A chave fica no **banco**, que todo deploy consulta, dentro das duas RPCs que todo envio já atravessa.

O código de envio publicado segue «livro primeiro» (`src/core/inbox/emailServidor.ts`, passo 6):

1. `inbox_email_delivery_create` → entrega READY;
2. `inbox_email_delivery_transition(..., 'REQUESTED')` → autorização do envio;
3. só então o token e a chamada ao Google.

E falha **fechado**: um erro desconhecido da criação vira `livro_indisponivel` (`recusaDoLivro`, `emailPorta.ts`) e
uma transição que não devolve `ok: true` encerra o pedido com `livro_indisponivel`. Nos dois casos o Google não é
chamado. Por isso a 0076 confere a chave **dentro** dessas duas RPCs, e a revogação vale também para o código já
publicado — sem republicar nada.

### 2.1 O que a 0076 cria

| Objeto | Função |
|---|---|
| `inbox_email_switch` | Uma linha por organização: `enabled`, `version`, `reason`, quem e quando. **Sem linha = bloqueado.** A migration semeia toda organização **desligada** |
| `inbox_email_switch_event` | Histórico imutável: de/para, versão, motivo, ator, tipo (USER/SYSTEM), papel e quantas entregas estavam READY/REQUESTED/UNKNOWN no instante |
| `inbox_email_envio_liberado(org)` | Leitura interna com `FOR SHARE`; ninguém executa de fora |
| `inbox_email_delivery_create` | Igual à 0075 + recusa `envio_bloqueado` com a chave desligada (depois da idempotência: repetir a mesma intenção devolve a entrega existente e não envia) |
| `inbox_email_delivery_transition` | Igual à 0075 + ir a REQUESTED exige a chave ligada. Desligada: READY vira **FAILED `envio_bloqueado`** na mesma transação (mensagem «falhou», histórico na conversa, conversa liberada) e a resposta é `ok: false`; qualquer outro estado devolve `ok: false` sem mudar nada |
| `inbox_email_switch_set(ligar, motivo)` | Para o usuário logado: Administrador liga e desliga; Diretoria só desliga; motivo de 3 a 500 caracteres; ligar é recusado com entrega UNKNOWN sem reconciliar; repetir o estado atual não gera evento |
| `inbox_email_switch_desligar_sistema(org, motivo)` | Emergência sem o app (chave de serviço ou dono do banco): **só desliga**, ator SYSTEM |
| Motivo `envio_bloqueado` | Acrescentado ao CHECK de `inbox_email_delivery.reason` (o catálogo da 0075 continua inteiro) |

### 2.2 O que continua permitido com a chave desligada

Aceite (`inbox_email_delivery_accept`), transições para FAILED e UNKNOWN e a reconciliação («encontrado» e «não foi
enviado»). Registrar o que já aconteceu nunca pode ser bloqueado.

### 2.3 Garantia exata do desligamento

- **O que a chave garante:** depois que o desligamento é confirmado (commit), nenhuma entrega nova nasce e nenhuma
  entrega READY recebe autorização para chamar o Google. O desligamento pede `FOR UPDATE` na linha da chave e, por
  isso, **espera** as criações e autorizações que já estavam abertas (elas seguram `FOR SHARE`); as que começarem
  depois leem a chave desligada.
- **O que a chave NÃO faz:** não cancela uma chamada ao Google que já começou. Uma entrega que já estava **REQUESTED**
  no instante do desligamento já tinha autorização; a chamada pode estar em curso e termina ACCEPTED, FAILED ou UNKNOWN
  normalmente (o teste `emailChaveCentral.integracao.test.ts` mostra esse caso saindo ACCEPTED). O desligamento devolve
  e registra quantas entregas estavam READY, REQUESTED e UNKNOWN, para conferência no livro.
- **Banco fora do ar:** sem banco, a criação e a autorização falham e nada é enviado (o «livro primeiro» já era
  fechado em falha; a chave herda isso). Não há cache da chave no servidor.
- **Limite:** código que chame o Google sem passar pelo livro ignoraria a chave. Esse código não existe; só entraria
  por um merge na `main` e um build de produção. Contenção: revisão de PR e a revogação do acesso do app em
  `myaccount.google.com/linkedapps` (conta `contato@`).

### 2.4 Mensagens no código já publicado

O código publicado não conhece o código `envio_bloqueado`. Com a chave desligada, a tela mostra o erro genérico de
`livro_indisponivel` e, ao repetir uma intenção bloqueada, «o provedor recusou». Nos dois casos nada é enviado. As
mensagens próprias («O envio de e-mail está bloqueado pela Direção») e o cartão de ligar/desligar na tela entram num PR
de código separado.

## 3. Provas (nenhuma toca produção)

| Prova | O que mostra | Resultado |
|---|---|---|
| `npm run smoke:email-chave` (PGlite) | 13 provas A–M: sem linha = bloqueado; semente desligada e idempotente; quem liga e desliga; caminho normal com a chave ligada; desligar entre criar e REQUESTED; REQUESTED antes do desligamento; UNKNOWN impede ligar; idempotência com a chave desligada; imutabilidade (até para o dono do banco); navegador só lê; emergência; modos de trava; CHECK de motivo | 13/13 PASS |
| `src/core/inbox/emailChaveCentral.integracao.test.ts` | **Código publicado** (handler e portas sem alteração, idênticos de `9e5de09` a `e55b3d6`) contra PostgreSQL com 0075 + 0076 e as variáveis em modo **ativo**: sem linha, chave desligada e desligamento entre criar e autorizar → Google **não** chamado; chave ligada → envia; desligar depois de REQUESTED → a chamada já iniciada termina (limite documentado); banco fora do ar → nada sai; reconciliação com a chave desligada | 7/7 |
| `src/core/inbox/email0076Envelope.test.ts` | Envelope a partir do estado de produção de hoje (livro com uma entrega ACCEPTED): ensaios sem efeito, aplicação com conferência estrutural CONFERE e dados idênticos, recusa de reaplicar, recusa com envio em curso, recuperação | 5/5 |
| `scripts/email-0076/gate-concorrencia.mjs` | Concorrência REAL com sessões independentes em PostgreSQL 17 descartável (5 cenários × 10 rodadas) | **NÃO EXECUTADO**: não há PostgreSQL nesta máquina (Docker parado, sem binários). Exige autorização para obter o PostgreSQL 17.6 |

## 4. Aplicação (roteiro, só com «APLICAÇÃO 0076 AUTORIZADA»)

1. `node scripts/email-0076/envelope.mjs` → `scratch/0076-envelope.sql`, ensaios e recuperação, com os SHA-256.
2. Retrato antes: `npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f scripts/email-0076/retrato.sql`.
3. Ensaio: o mesmo comando com `scratch/0076-ensaio-conclui.sql` (pré-checks, ROLLBACK, nada fica).
4. Aplicação: o mesmo comando com `scratch/0076-envelope.sql`. Pré-checks: 0075 presente e a 0076 ausente, 8 funções
   `inbox_email_*`, CHECK de motivo da 0075, **nenhuma entrega READY ou REQUESTED**, `current_org` e `has_role`.
   Pós-checks antes do COMMIT: duas tabelas, 15 funções, toda organização com a chave **desligada** e um evento de
   origem, CHECK com `envio_bloqueado`, create/transition conferindo a chave, privilégios, RLS, e livro, mensagens e
   conversas **idênticos**.
5. Retrato depois e `node scripts/email-0076/conferir.mjs <antes> <depois>` → `CONFERE`.

**Compatibilidade:** aplicar a 0076 antes de qualquer código novo é seguro. O deploy publicado já está com o envio
desligado pelas variáveis, e qualquer deploy antigo passa a obedecer à chave. A chave nasce desligada: ligar é um ato
separado (Administrador, com motivo) e só faz sentido junto com as variáveis em `canary` ou `ativo`.

## 5. Retorno

- **Desligar** é o retorno normal (Diretoria ou Administrador, ou a emergência sem o app).
- **Recuperação** (`scratch/0076-recuperacao.sql`): reaplica a 0075 (idempotente), que recria create/transition sem a
  chave. A chave, o histórico e as entregas bloqueadas ficam; o CHECK com `envio_bloqueado` fica. Só roda com o livro
  parado. Efeito: o envio volta a depender só das variáveis, como antes da 0076. Uso: defeito da chave que trave envio
  legítimo sem correção rápida, com autorização própria.

## 6. Critérios de homologação

1. Quality Gate verde no PR, com o smoke novo.
2. Gate de concorrência real PASS (5 cenários × 10 rodadas) em PostgreSQL 17.6 descartável.
3. Pré-flight de leitura em produção: retrato, ensaio com código 0, livro sem READY/REQUESTED.
4. Aplicação pelo envelope com `CONFERE`.
5. Depois da aplicação, com o envio ainda desligado pelas variáveis: chamada de envio sem login no domínio continua
   403; leitura da chave mostra a organização desligada com um evento.
6. Antes do próximo canário: PR de código (mensagens e cartão de ligar/desligar), e um canário que prove ligar,
   desligar entre criar e enviar, e a emergência.

## 7. Numeração

`0076` reservado para esta migration (decisão da Direção de 16/11/2026). As propostas SQL dos PRs #90 e #91
(`docs/propostas/comercial-acesso.proposta.sql` e `pedido-projeto.proposta.sql`) ficam fora de `supabase/migrations` e
escolhem o número na hora de aplicar: **a partir de 0077**. Nenhuma delas toca objetos `inbox_email_*`.

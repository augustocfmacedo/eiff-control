# S1 / R4 — Plano operacional: `SUPABASE_SERVICE_ROLE_KEY` → `sb_secret` nas Functions

> **Estado: PLANO para aprovação. Nada aqui foi executado.** Não houve merge, nenhuma variável do Netlify mudou, nenhum
> deploy, nenhuma credencial revogada. Cada portão abaixo exige a frase da Direção indicada nele.

## 0. Ponto de partida (conferido em 17/11/2026, somente leitura)

| Item | Estado |
|---|---|
| Produção | deploy `6afb298f` = commit `e55b3d6` = ponta da `main`, publicação **travada** |
| PR #95 (S1) | aberto, sem conflito, Quality Gate verde; contém **só** a S1 (17 arquivos, nenhuma migration) |
| Efeito do merge do #95 | a `main` passaria a ter **apenas** a S1 a mais que a produção: nenhuma outra mudança vai junto |
| Sobreposição com #94 (0076) e #96 (0077) | nenhum arquivo em comum |
| R3A | homologada (banco e Auth admin, leitura) |
| R3B | parcialmente homologada (criar, buscar, atualizar no Auth admin); convite e recuperação **não** homologados |
| Chave nova | `sb_secret` `netlifyfunctions` existe na produção, guardada pelo Augusto; nunca passou pelo chat |

## 1. Inventário das Functions

13 funções em `netlify/functions/`. Usam a chave de serviço: **9**. Oito leem `SUPABASE_SERVICE_ROLE_KEY` diretamente
(`usuarios`, `widget-caixa`, `diretor-financeiro`, `formulario-site`, `formulario-reconciliar`, `channel-octadesk`,
`email-comercial`, `vibe`). A 9ª, `channel-meta-webhook`, usa a chave **indiretamente**: o arquivo da função não cita a
variável, mas entrega `process.env` a `montarPortasInbox` (`src/core/inbox/ativacao.ts`), que lê a chave dali para as
portas de ingestão (`ingestaoPorta.ts`) e de roteamento (`roteamentoPorta.ts`) do Inbox.

| Função | Rota | Onde usa a chave | Formato | Quando a chave é usada de fato |
|---|---|---|---|---|
| `usuarios` | `/api/usuarios` | banco (perfis, escopo, auditoria) e Auth admin | banco A, Auth B | toda ação do Administrador, inclusive **listar** |
| `widget-caixa` | `/api/widget-caixa` | RPC `widget_token_validar` e `carregarComoServidor` (supabase-js) | A | toda atualização do widget (o iPad chama a cada 15 min) |
| `diretor-financeiro` | `/api/diretor-financeiro` | `carregarComoServidor` | A | só `acao: veredicto` (quem não vê caixa) |
| `formulario-site` | `/api/formulario-site` | evidência no Lead Engine, `inbox_ingest`, prazo | A | cada submissão real do site (escreve) |
| `formulario-reconciliar` | agendada `@hourly` | as mesmas portas do formulário | A | **nunca hoje**: desligada (sem `FORMULARIO_RECONCILIACAO` nada é lido) |
| `channel-meta-webhook` (indireta) | `/api/channel/meta/webhook` | `inbox_ingest`, `inbox_apply_routing`, pela porta do Inbox | A | **nunca hoje**: sem as variáveis da Meta não entra mensagem |
| `channel-octadesk` | `/api/channel/octadesk` | RPCs `radar_delivery_*` | A | só no envio (modo `disabled`) |
| `email-comercial` | `/api/email-comercial` | livro de entregas | A | só no envio (modo comercial em NO-GO) |
| `vibe` | `/api/vibe` | RPCs de reserva/consumo | A | só em ação paga (sem ordem de consumo) |

Não usam a chave de serviço: `assistente`, `channel-meta`, `comunicacao`, `development-status` (todas com o JWT do usuário
e a chave pública).

## 2. Dependências da chave legada

| Dependência | Situação | Tratamento |
|---|---|---|
| Netlify `SUPABASE_SERVICE_ROLE_KEY` | valor só em Production; escopo Builds/Runtime travado (secreta não edita escopo) | trocada na R4, recriada só Functions |
| ~180 pré-visualizações e 153 deploys antigos | guardam a legada no ambiente do build | só morrem na R6 (desativar as legadas) |
| Scripts do repositório | nenhum lê a chave de serviço: `db-query.mjs` usa token pessoal, os runners usam o login da CLI, `vibe.mjs` só `VIBE_API_KEY` | nada |
| `.env.local` das duas máquinas | pode ter cópia da legada (o agente não lê) | o Augusto confere e troca antes da R6 |
| CI (GitHub Actions) | nenhum segredo; os smokes usam o **papel de banco** `service_role` num PostgreSQL local, não a chave | nada |
| Banco | nenhuma migration chama HTTP com chave (sem `pg_net`) | nada |
| Chave legada `anon` (JWT) | navegador (`VITE_SUPABASE_ANON_KEY`, no build) e 9 funções (`SUPABASE_ANON_KEY ?? VITE_SUPABASE_ANON_KEY ?? x-supabase-anon`) | R5 |
| Integrações configuradas no painel do Supabase (Database Webhooks, Edge Functions, integrações) | **não verificado** | conferir no painel antes da R6 |
| `sb_secret` `default` de 02/09/2026 na produção | sem uso no código | revogar depois da R6 (R8) |

## 3. Versão final do PR #95 (antes do «MERGE AUTORIZADO»)

1. `REF_AUTORIZADO` vazio no `scripts/s1/ensaio-auth-escrita.mjs` (feito no commit deste plano; o teste aceita vazio).
2. Quality Gate verde no commit final, e o mesmo commit no `git log` local de quem autoriza.
3. `git diff --name-only origin/main...` = os 18 arquivos da S1 (com este plano), nenhuma migration, nenhum `netlify.toml`.
4. Guardas da suíte: nenhuma chave `sb_` real no repositório; CI e `package.json` sem os scripts `scripts/s1`.
5. A `main` continua igual ao deploy publicado (`e55b3d6`). Se mudar antes do merge, refazer esta conferência.

## 4. Sequência operacional

Duas construções, **uma** publicação. A primeira construção (código novo, chave legada) fica pronta e não publicada, e
serve de segundo ponto de retorno.

| # | Passo | Quem | Portão | Efeito em produção |
|---|---|---|---|---|
| 1 | Merge do #95 na `main` | agente | «MERGE AUTORIZADO» | nenhum: a trava constrói e **não publica** |
| 2 | Conferir a construção **A** (merge, chave legada): estado *ready*, commit = merge, 13 funções, log sem erro | agente, só leitura | — | nenhum |
| 3 | Recriar `SUPABASE_SERVICE_ROLE_KEY`: valor `sb_secret_…` colado do gerenciador, secreta, **escopo só Functions**, **valor só em Production** | Augusto, no painel | «R4: TROCA AUTORIZADA» | nenhum: deploy publicado guarda o ambiente do momento em que foi construído |
| 4 | Conferir os metadados da variável (nome, secreta, escopos, contextos, `updated_at`), **nunca o valor** | Augusto no painel ou agente pela API de metadados | — | nenhum |
| 5 | Nova construção **B** da `main` (*Retry deploy*), iniciada **depois** do `updated_at` do passo 4 | Augusto ou agente | incluso em 3 | nenhum |
| 6 | Testes de fumaça **antes de publicar**, no endereço permanente da construção B (seção 5) | Augusto e agente | — | nenhum |
| 7 | Publicar a construção B | agente | «PRODUCTION AUTORIZADA» | troca efetiva |
| 8 | Fumaça em produção + observação de 72 h (seção 5) | Augusto e agente | — | — |

Entre os passos 3 e 5 a variável pode ficar alguns segundos sem valor (recriar = apagar e criar). Qualquer construção nesse
intervalo sai com funções em falha fechada (`501 nao_configurado`) e, com a trava, não é publicada.

**Prova de que a chave nova está em uso.** As duas chaves funcionam até a R6, então uma fumaça que passa não distingue qual
está no ar. Prova disponível hoje: a ordem dos instantes (`updated_at` da variável antes do início da construção B) e o
classificador do código, que recusa qualquer valor que não seja JWT nem `sb_secret` (`501` em vez de usar). Prova direta:
na R6, quando as legadas forem desativadas e as funções continuarem respondendo. **Opcional (precisa de autorização para
mudar o PR):** uma linha de log na primeira chamada de cada função com o **tipo** da chave (`legada`/`nova`), nunca o valor.

## 5. Matriz de testes de fumaça

Nada abaixo escreve dados de negócio nem envia mensagem. «Decisiva» = exercita a chave de serviço de verdade.

| Função | Teste | Esperado | Antes de publicar (permanente B) | Depois de publicar | Decisiva |
|---|---|---|---|---|---|
| `usuarios` | Cadastros › Usuários abre a lista (Administrador logado) | lista com os usuários de hoje | sim, logando no endereço permanente | sim | **sim**: Auth admin (B) e banco (A) |
| `usuarios` | sem login | 401 | sim | sim | não |
| `widget-caixa` | sem token | 401 | sim | sim | não |
| `widget-caixa` | widget do iPad atualiza (uso normal; grava só `last_used_at`) | resumo do caixa, sem «sem conexão» | não (o iPad aponta para o domínio) | sim, passivo, a cada 15 min | **sim**: RPC e supabase-js (`fetchServico`) |
| `diretor-financeiro` | sem login | 401 | sim | sim | não; o veredito usa o mesmo `carregarComoServidor` do widget |
| `formulario-site` | sem o segredo do site | 401, nada gravado | sim | sim | não |
| `formulario-site` | primeira submissão **real** depois da troca | evidência + conversa + prazo, conferência dos 8 itens do GO-2 | não | passivo, quando chegar | **sim** (escrita) |
| `formulario-reconciliar` | log da rodada horária | «desligada» | não | sim | não |
| `channel-meta-webhook` | assinatura inválida | recusado, nada processado | sim | sim | não (sem variáveis da Meta) |
| `channel-octadesk` | sem login | 401 | sim | sim | não (envio desligado) |
| `email-comercial` | `saude` sem login / com login | 401 / 200 com o modo de hoje | sim | sim | não (livro só no envio) |
| `vibe` | sem login | 401 | sim | sim | não (sem ação paga) |
| Todas | log das funções na 1ª hora | nenhum `501 nao_configurado`, `credencial_invalida`, `Invalid JWT`, `bad_jwt` | — | sim | — |

**Cobertura das funções não exercitáveis.** `formulario-reconciliar`, `channel-meta-webhook`, `channel-octadesk`,
`email-comercial` e `vibe` usam a chave só em escrita ou envio desligados. Estão cobertas pelo mesmo cabeçalho do banco (A)
provado na R3A (`banco_rpc`) e pelos testes de cada porta com as duas chaves. Risco residual aceito: um POST de RPC com a
chave nova nunca foi feito em produção (a R3B fez POST/PUT no Auth do descartável). Elas serão exercitadas no primeiro uso
real autorizado da frente de cada uma.

## 6. Retorno (a credencial legada continua ativa até a R6)

| Gatilho | Ação | Portão |
|---|---|---|
| Fumaça antes de publicar falha | não publicar; nada a desfazer em produção | — |
| Fumaça decisiva falha depois de publicar, ou erro de credencial no log | publicar a construção **A** (código novo + legada) ou o `6afb298f` (código anterior + legada) | coberto pela «PRODUCTION AUTORIZADA» da R4, se a Direção concordar; senão, nova frase |
| Submissão real do formulário falha (502/503) | retorno acima; a submissão continua no Netlify Forms e o e-mail de aviso chega; reenvio pelo reconciliador manual, com autorização própria | idem |
| Variável com problema e as duas construções indisponíveis | recolocar o valor legado (aba das chaves legadas do Supabase) e construir de novo | «R4: TROCA AUTORIZADA» |

Durante a R4 nunca: revogar a `sb_secret` nova, desativar as legadas, mexer na chave pública.

## 7. R5 — chave pública do navegador (procedimento futuro, autorização própria)

1. Conferir quais variáveis existem: `VITE_SUPABASE_ANON_KEY` (build do navegador) e, se houver, `SUPABASE_ANON_KEY` (funções).
2. Trocar pelo valor da publicável `default` que já existe (é pública por desenho), com escopo **Builds** para a `VITE_` e
   **Functions** para a outra.
3. Construção, fumaça antes de publicar e publicação:
   - login e saída;
   - Caixa, Lançamentos, Obra 360, Radar, Inbox;
   - URLs assinadas de fotos e anexos;
   - modo campo offline;
   - Solicitante (`df_contexto`);
   - funções com JWT do usuário (assistente, comunicação, Diretor Financeiro, Vibe orçamento, Usuários);
   - «Esqueci minha senha» só até a tela de confirmação, **sem** disparar envio sem autorização.
4. `.env` das duas máquinas de desenvolvimento.
5. Retorno: publicar o deploy da R4 (a `anon` legada continua ativa).

O código do navegador não muda (supabase-js 2.114 aceita a publicável). A S3/0077 não interfere: a publicável entra como o papel
`anon`, igual à legada.

## 8. Critérios para desativar as legadas (R6)

Todos verdadeiros, conferidos no dia:
1. R4 e R5 publicadas há pelo menos **7 dias**, sem erro de credencial no log das funções e sem queixa de login.
2. Netlify: `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY` e `SUPABASE_ANON_KEY` com valor novo em **todo** contexto que tiver valor.
3. Painel do Supabase sem consumidor da legada: Database Webhooks, Edge Functions e integrações conferidos. Uso da legada nos
   logs da API, se o painel identificar a chave.
4. `.env.local`/`.env` das duas máquinas trocados.
5. Retorno definido: reativar as legadas pelo painel (reversível). O novo ponto de retorno passa a ser o deploy da R5,
   porque todos os deploys antigos perdem o banco (efeito desejado).
6. A frente S3 sem aplicação em curso na mesma janela.

Depois da R6: revogar a `sb_secret` `default` sem uso (R8) e apagar do gerenciador as entradas que não valem mais.

## 9. Convites e recuperação de senha (homologação separada)

| Fluxo | Chave | Situação |
|---|---|---|
| Criar usuário com senha inicial (padrão da tela) | serviço, `POST admin/users` | homologado na R3B; **não envia e-mail** |
| Definir nova senha | serviço, `PUT admin/users/{id}` | homologado na R3B; não envia e-mail |
| Convidar por e-mail / Reenviar acesso | serviço, `POST invite` / `POST recover` | L1 comprovada; envio e entrega **não homologados** |
| «Esqueci minha senha» na tela de login | **pública** (navegador) | não depende da R4; muda só na R5 |

Até haver homologação, a orientação operacional é criar acessos **com senha inicial**, que não depende de e-mail. A
homologação de convite e recuperação é decisão separada da Direção, com uma de duas formas: um envio real e controlado na
produção para um endereço interno que consinta (prova L4 e L5 de uma vez), ou o ensaio com gancho no descartável (prova só
L4). Nenhuma das duas está autorizada.

## 10. Ordem entre S3 e R4

- **Independentes no banco.** A 0077 deixa `service_role` exatamente como está, e a `sb_secret` entra no PostgREST como
  `service_role`. Os PRs não compartilham arquivos.
- **Nunca na mesma janela.** As duas fumaças olham para as mesmas funções. Um erro com as duas no ar não teria causa
  identificável.
- **Recomendação:** a **S3 primeiro**, porque é incidente aberto com contenção provisória, e a R4 é higiene sem exposição
  conhecida. A R4 entra depois de 24 h de S3 estável. A R4 não depende da S3: se a 0077 não tiver janela, a R4 pode ir antes,
  com o mesmo intervalo.

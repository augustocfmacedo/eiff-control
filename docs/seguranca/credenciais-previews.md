# Segurança — credenciais privilegiadas em deploys não produtivos do CRM

Registro específico vinculado à issue #99, criado em 23/11/2026 por decisão da Direção. Não altera o escopo da #99.

**Situação:** **plano para aprovação.** Nesta etapa a Direção autorizou só leitura, análise e documentação, e nada foi
executado. Os valores das variáveis não foram lidos, impressos nem gravados em lugar nenhum: o inventário registrou só
nomes, contextos, se o valor está vazio e as datas.

## 1. Resumo executivo

- **O que é.** Durante cerca de dois meses, os deploys de preview do CRM rodaram com a **chave de serviço do banco de
  produção** (`SUPABASE_SERVICE_ROLE_KEY`) e com as demais chaves privilegiadas. Cada deploy guarda as variáveis do
  momento em que foi construído e continua acessível em endereço público.
- **O que já mudou.** Os valores fora de production foram **esvaziados entre 16/11 e 17/11/2026**. Os previews
  construídos desde 17/11 01:27 UTC já nascem **sem** a chave de serviço, comprovado em execução. O texto da #99 (18/11)
  descreve a existência das variáveis nesses contextos, mas elas já estavam vazias.
- **O que continua exposto.** **73 deploys de preview com a chave de serviço, ainda no ar**, construídos de 14/10 a
  16/11 para 37 PRs. Outros **110 previews** (11/09 a 14/10) também estão no ar. Neles a presença da chave de serviço
  **não pode ser medida** sem login, então devem ser tratados como expostos.
- **Correção de 23/11 (tarde): a «chave da Anthropic» dos previews não é da EIFF.** A variável `ANTHROPIC_API_KEY` do
  site está **vazia em todos os contextos, inclusive production**. A chave que as funções enxergam é injetada em tempo
  de execução pelo **AI Gateway do Netlify** (`ai_gateway_disabled = false` no site), que, segundo a documentação do
  Netlify, preenche `ANTHROPIC_API_KEY` e `ANTHROPIC_BASE_URL` em todas as funções quando o usuário não define a
  variável. Três provas:
  - o build do PR #107 passou pela guarda, que recusaria qualquer `ANTHROPIC_API_KEY` visível no build;
  - a função do mesmo deploy responde como se tivesse a chave;
  - a API devolve vazio em todos os contextos.

  Não existe, portanto, chave da Anthropic da EIFF exposta nos previews. A versão anterior deste documento, que pedia
  restringi-la primeiro (D8), está corrigida na seção 7.
- **Comprometimento.** **Nenhuma evidência de uso indevido** nas fontes que pudemos ler. É **exposição potencial, não
  comprometimento comprovado**. A ausência de evidência é limitada: os logs do Supabase e das funções do Netlify não
  foram lidos (seção 4).
- **Gravidade proposta:** **ALTA.** A chave dá acesso total ao banco de produção e ignora RLS. A probabilidade de uso
  indevido é baixa: o repositório só recebe código do dono, os PRs de fork exigem aprovação e não há sinal de uso.
- **Recomendação:**
  1. apagar os 182 previews antigos de PR com a chave de serviço (D2 base);
  2. reconciliar e mesclar o #95 e seguir o roteiro R4 → R5 → R6. **Só a R6** (desativar as chaves legadas) invalida a
     chave antiga, e ela desliga junto a chave pública legada;
  3. rotacionar as chaves de terceiros de baixo custo.

  Cada passo depende de autorização da Direção (seção 9).

## 2. Estado atual e evidências (leitura de 23/11/2026)

### 2.1 Projeto Netlify `eiff-control`

| Item | Valor |
|---|---|
| Repositório | `augustocfmacedo/eiff-control`, **público** |
| Autores de PR na história | só o dono. **Nenhum PR de fork** em 300 PRs |
| Deploy previews | **ligados** (`skip_prs` nulo) |
| Branch deploys | só `main` (`allowed_branches = [main]`), sem branch deploy de outra branch |
| PR de fork | `untrusted_flow = review`: o deploy de fork exige aprovação |
| Senha nos previews | **nenhuma** (`has_password = false`) |
| Logs de build | `private_logs` nulo, então podem ser públicos num repositório público. O Netlify mascara variáveis marcadas como segredo |
| Retenção de deploys | **90 dias**: deploys mais antigos que isso são apagados pela plataforma |
| Publicado | `6aff669c` (`213887d`), travado |

### 2.2 Variáveis privilegiadas por contexto

Nenhum valor foi lido. "Vazio" quer dizer que o contexto existe, mas sem valor.

| Variável | Segredo | Production | Deploy-preview / branch-deploy / dev | Última alteração |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | sim | com valor | **vazio** (provado em execução, 2.3) | 17/11 00:32 UTC |
| `VIBE_API_KEY` | sim | com valor | vazio | 17/11 00:21 UTC |
| `GITHUB_READ_TOKEN` | sim | com valor | vazio | 16/11 23:54 UTC |
| `GOOGLE_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | sim | com valor | vazio | 16/11 16:01–16:02 UTC |
| `EIFF_FORM_SECRET` (vaga A) | sim | com valor | vazio | 10/11 16:55 UTC |
| `EIFF_FORM_SECRET_B` (vaga B) | sim | só production | — | 19/11 21:13 UTC |
| `ANTHROPIC_API_KEY` | sim | **vazia** | vazia. A chave que as funções veem em **todos** os contextos é a do **AI Gateway do Netlify**, injetada em tempo de execução (2.3) | 04/09 |
| `EIFF_INBOX_*`, `EIFF_FORM_SOURCE_ID` | não | só production | — | — |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | não | todos os contextos | idem | públicos por desenho |

As datas são da última alteração de cada variável. A coincidência com 2.3 mostra que o esvaziamento dos contextos não
produtivos ocorreu nessas datas. **Não está registrado quem o fez**: o log de auditoria da conta Netlify não foi lido.

### 2.3 Deploys ainda acessíveis e quais carregam a chave

O inventário cobriu **414 deploys** no ar (229 de preview e 185 de production), de 11/09 a 19/11.

**Como foi medido:** um GET **sem credencial** em `/api/widget-caixa` no endereço permanente de cada deploy. Essa função
responde `501 nao_configurado` quando o deploy **não** tem `SUPABASE_SERVICE_ROLE_KEY`, e `401 token_ausente` quando tem.
A sonda não envia token nem corpo e não grava nada.

| Grupo | Deploys | Período | Chave de serviço |
|---|---|---|---|
| Preview **com** a chave | **73** (37 PRs) | 14/10 03:24 → 16/11 23:34 | **sim** |
| Preview **sem** a chave | 46 | 17/11 01:27 → 19/11 16:12 | não |
| Preview anterior à função do widget | 110 (54 PRs) | 11/09 17:18 → 14/10 00:56 | **não mensurável**: tratar como exposto |
| Production com a chave | 39, entre eles o publicado | 14/10 → 19/11 | sim, legítimo; 22 nunca publicados |
| Production sem a função do widget | 146 | antes de 14/10 | não medido; legítimo |

**Por que os 110 não são mensuráveis.** Nenhuma função daquele período responde de forma diferente com ou sem a chave
de serviço **antes** de exigir login: `vibe`, `channel-meta` e `channel-octadesk` pedem o JWT primeiro, e
`diretor-financeiro` e `assistente` só olham a chave da Anthropic. Medir exigiria uma sessão de usuário, o que está fora
desta autorização. A presunção conservadora é que a chave estava lá: a `vibe` já a exigia em setembro, e não há registro
de que algum dia ela tenha sido restrita antes de 17/11.

**Segunda sonda: chave da Anthropic.** Esta sonda mede o que a função enxerga em tempo de execução, e isso inclui a
injeção do AI Gateway. Ela não distingue a chave da EIFF da do Netlify; a distinção está no resumo. Foi feito um POST vazio, sem credencial, em `/api/assistente` de cada um dos 414
deploys. A função devolve `501 nao_configurado` sem a chave e `401 nao_autenticado` com ela, antes de ler o corpo e sem
chamar a Anthropic.

| Grupo | Deploys | `ANTHROPIC_API_KEY` |
|---|---|---|
| Previews de 11/09 a 14/10 | 110 | **presente** |
| Previews de 14/10 a 16/11 | 73 | **presente** |
| Previews **de 17/11 em diante** | 46 (12 PRs) | presente, **injetada pelo AI Gateway**, não é variável da EIFF |
| Production desde 08/09 | 157 | presente (legítimo) |
| Production de 03 a 04/09 | 28 | sem a chave ou sem a função (início do Assistente) |

**Branch deploys:** **nenhum.** `allowed_branches = [main]`, e todo deploy de `main` é do contexto production. Não há
branch deploy de outra branch no ar.

**Retenção de 90 dias:** os 110 previews mais antigos expiram sozinhos entre ~10/12/2026 e ~12/01/2027, e os 73 até
~14/02/2027. Os 50 recentes, sem a chave de serviço, expiram até ~21/02/2027.

Os deploys de production têm a chave por desenho. O ponto de atenção é outro: os endereços permanentes deles continuam
executando **versões antigas** das funções, inclusive anteriores a correções de segurança, como as do PR #76.

**Vazamento em arquivo público:** os arquivos `.js` públicos dos deploys com a chave foram varridos em busca da
assinatura de um JWT `service_role`. Resultado em 2.4.

### 2.4 Busca da chave nos arquivos públicos

Foram varridos os `.js` públicos dos 73 previews com a chave e dos 3 deploys de production mais recentes. A busca
procurou o papel `service_role` em base64url nos três alinhamentos e decodificou todo JWT encontrado. Resultado:
**nenhuma assinatura de chave de serviço em nenhum dos 76 deploys** (de 49 a 52 arquivos por deploy). As variáveis sem prefixo `VITE_` não entram no pacote do navegador. O Netlify também marca essas
variáveis como segredo e tem varredura de segredos no build.

### 2.5 Resultado da D1 (investigação somente leitura, 23/11/2026)

| Fonte | O que foi lido | Resultado |
|---|---|---|
| Auditoria da conta Netlify | 303 eventos, de 23/06 a 19/11/2026 (`listAccountAuditEvents`); guardados só tipo, ação, data, autor e nomes de variáveis | toda mudança de variável desde 14/10 foi feita pela conta do Augusto. O esvaziamento de 16–17/11 está registrado (atualizações das variáveis com todos os contextos). Um membro novo, **«operacao netlify»** (`eiff.com.br`), foi convidado em 16/11 23:39 (Reviewer) e passou a **Internal Builder** em 17/11 16:35; ação do próprio Augusto, coerente com a regra de não usar a sessão pessoal como credencial permanente. Desde 14/10, nenhum evento de crédito esgotado, uso excedido ou site desativado; só falhas de cobrança e pagamentos |
| Netlify, outra conta | `eiff-staging` (Free) | 0 eventos |
| Banco (somente leitura, só contagens) | `auth.users`, `auth.sessions`, `profile`, `widget_token`, `audit_log`, `storage.objects`, `financial_entry`, `radar_vibe_operation` | nenhum usuário criado desde 14/10 (3 no total); sessões de 2 usuários; perfis 2 Administradores e 1 Solicitante; tokens de widget só os 2 de 14/10; `audit_log` desde 14/10: `app` 335, `db` 762, `rpc` 2, **todos com autor**, nenhuma gravação anônima; 3 exclusões lógicas de lançamento entre 14 e 16/10; ledger da Vibe vazio; 104 anexos financeiros, todos pelo fluxo do app |
| GitHub | webhooks, chaves de deploy, colaboradores, forks | nenhum webhook, nenhuma chave de deploy, só o dono como colaborador, 0 forks |

**O que não pôde ser lido**, e por isso a conclusão não é definitiva:
- **logs das funções do Netlify:** a API não expõe histórico, só o painel, com retenção curta;
- **logs da API do Supabase:** exigem token de gerenciamento, que não se lê por regra;
- **auditoria do Auth:** `auth.audit_log_entries` está vazia, porque o Supabase não grava lá;
- **painéis da Google e da Vibe:** exigem login do Augusto;
- **uso do token do GitHub:** não exposto para contas pessoais;
- **consumo do AI Gateway por deploy:** não exposto na API.

**Conclusão da D1:** nenhuma evidência concreta de uso indevido nas fontes lidas. Isso **não** prova ausência de uso. Não
há gatilho para tratar como incidente.

### 2.6 Listas fechadas (inventário de 23/11/2026, 15:32 UTC)

**Inventário:**
- 418 deploys no site do CRM: 233 `deploy-preview` e 185 production;
- nenhum outro contexto e nenhum id duplicado;
- publicado `6aff669c`, travado;
- os retornos `6afda676` e `6afdd7da` são production e ficam fora de qualquer lista.

As evidências estão em `scratch/seguranca-previews-d2/`, que o git ignora, com `SHA256SUMS`, e contêm só metadados.

| Lista | Critério | Deploys | sha256 dos ids (sem quebra final) |
|---|---|---|---|
| **A — D2 base** | `deploy-preview`, criado antes de 17/11 01:27 UTC, com PR | **182** (91 PRs, 11/09 → 16/11 23:34) | `4649eb4a…d8df3` |
| B — anomalia | `deploy-preview` sem PR: rascunho por linha de comando na `main`, `6ac3e85e`, 05/10 | 1 | `26f1d412…5b7` |
| C — depois do marco | `deploy-preview` criado a partir de 17/11 01:27 UTC | 50 às 15:32 UTC (14 PRs, 10 abertos); **cresce a cada push**: 51 às 15:37 | `8be32f51…fbb4` (15:32) |

**Segunda revisão independente (15:37 UTC), por outro agente:**
- reconstruiu A, B e C do zero, com os mesmos hashes;
- confirmou que nenhum deploy de production, nem o publicado ou os retornos, está nas listas;
- registrou 1 preview novo em C, do próprio PR #106.

**Revisão independente da lista A:** outro agente montou a lista do zero, sem ver a primeira, paginando de duas formas
(100 e 50 por página). Chegou aos mesmos 182 ids, ao mesmo hash e à mesma anomalia. O registro de deployments do GitHub
está vazio, então não serviu de segunda fonte.

**D2 ampliada (A + B + C = 233): não recomendada.**
- A lista C não tem a chave de serviço (provado em execução) nem chave da EIFF da Anthropic (2.3).
- Apagá-la só tiraria a revisão visual de 10 PRs abertos, sem ganho de segurança.
- O deploy B tem o mesmo risco da lista A e entra por decisão própria, porque não tem PR de origem.

**Estado da D2:** **não executada.** A conferência a seco relê cada deploy da lista A pelos mesmos critérios, sem
apagar. A execução está parada até a Direção reconfirmar os 182 diante da diretriz de 23/11 sobre a lista ampliada.

## 3. Avaliação de risco

**Acesso ao banco de produção.** A chave de serviço ignora RLS e lê e grava tudo. Nos previews antigos ela fica dentro
das funções e não é devolvida por nenhuma delas. Explorar isso exige uma das duas condições:
- **(a)** uma função antiga que use a chave sem autenticar antes. As funções atuais autenticam antes: JWT, token do
  widget, segredo do formulário ou assinatura da Meta. Nas versões antigas e no código de PRs não revisados, isso não foi
  auditado item a item;
- **(b)** vazamento do valor. Nenhum foi encontrado nos arquivos públicos (2.4), e os logs de build mascaram segredos.

**Probabilidade:**
- baixa para código malicioso: só o dono faz push, nunca houve PR de fork e fork exige aprovação;
- moderada para defeito em código antigo: 73 versões de funções com a chave seguem acessíveis em endereços estáveis.

**Serviços externos:**

| Chave | O que um terceiro faria com ela | Sinal de uso lido |
|---|---|---|
| `VIBE_API_KEY` | consumo de créditos pagos | **nenhuma** operação no ledger `radar_vibe_operation` |
| Google OAuth (refresh token) | enviar e-mail como a conta comercial | não lido. Conferir na conta Google (seção 4) |
| `ANTHROPIC_API_KEY` | não há chave da EIFF; a das funções é do AI Gateway do Netlify. Uso exigiria passar pelo login do app (as funções autenticam antes) | sem evento de crédito esgotado ou uso excedido na conta Netlify desde 14/10 |
| `GITHUB_READ_TOKEN` | leitura do repositório, que já é público | baixo impacto |
| `EIFF_FORM_SECRET` (vaga A) | enviar lead falso ao CRM | sai na J6 (P1) |

## 4. Exposição potencial × comprometimento comprovado

**Lido, sem sinal de uso indevido:**
- nenhum usuário do Auth criado desde 14/10;
- só 3 perfis (2 Administradores e 1 Solicitante);
- os tokens de widget foram criados em 14/10, na implantação conhecida;
- a auditoria desde 14/10 tem só as fontes esperadas (`app` 335, `db` 762, `rpc` 2), e nenhuma de `usuarios`;
- o ledger da Vibe está vazio;
- não apareceu nenhuma assinatura de chave nos arquivos públicos.

**Não lido** (exigiria credencial de gerenciamento ou painéis de terceiros):
- logs da API do Supabase, por endereço de origem;
- logs das funções dos deploys de preview no Netlify;
- log de auditoria da conta Netlify;
- uso das chaves nos painéis da Anthropic, da Google e da Vibe.

**Conclusão:** exposição potencial, **sem comprometimento comprovado**. Se a leitura de qualquer uma dessas fontes
mostrar uso indevido, isso vira **incidente de segurança** e a rotação passa a ser imediata.

## 5. Alternativas de contenção

| # | Alternativa | Efeito | Custo / dependência | Reversível |
|---|---|---|---|---|
| A | Restringir as credenciais a production | **já está em vigor** desde 17/11 para os novos deploys. Falta só remover os contextos vazios, o que é limpeza | nenhum | sim |
| B | Desligar os previews do CRM (`skip_prs`) | nenhum preview novo é construído | perde a revisão visual dos PRs. Os previews atuais já nascem sem segredo, então o ganho é pequeno | sim |
| C | Apagar os previews antigos | remove as 73 cópias com a chave e as 110 não medidas | os links de revisão dos PRs antigos quebram; nada operacional depende deles | **não** |
| C2 | Apagar os deploys de production antigos | remove versões antigas das funções com a chave | **perde alvos de retorno**. Manter no mínimo o publicado `6aff669c` e os retornos `6afda676` e `6afdd7da` | não |
| D | Credenciais separadas para teste | previews com um banco de teste e uma chave própria | exige um projeto Supabase de staging; fora do escopo atual | sim |
| E | Rotacionar as chaves possivelmente expostas | invalida qualquer cópia, inclusive em deploys apagados ou em cache | janela própria (seção 6); afeta todas as funções com chave de serviço | parcialmente |
| F | Esperar a retenção de 90 dias | os previews com a chave somem sozinhos até ~14/02/2027 | o risco continua por cerca de 80 dias | — |

**Apagar deploys não substitui a rotação.** Só a rotação garante que nenhuma cópia, inclusive fora do Netlify, continue
valendo.

## 5a. Restrição × rotação, por credencial

Cada deploy **conserva as variáveis da época do build**. Restringir o contexto protege só os deploys **futuros**. As
cópias já construídas só deixam de valer com a **rotação**, ou deixam de ser executáveis com a exclusão dos deploys.

| Credencial | Restrição a production | Cópias em deploys não produtivos no ar | Precisa rotação? | Por quê |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **feita** (17/11 00:32) | 73 provadas + 110 presumidas | **sim** | acesso total ao banco, ignorando RLS; cópias em 183 deploys |
| `ANTHROPIC_API_KEY` | não se aplica: a variável da EIFF está vazia em todos os contextos | nenhuma chave da EIFF; a das funções é do AI Gateway | não | ver D8 (seção 7) |
| `GOOGLE_OAUTH_*` (refresh token) | feita (16/11 16:01) | presumidas nos previews até 16/11 | **sim** | permite enviar e-mail como a conta comercial |
| `VIBE_API_KEY` | feita (17/11 00:21) | presumidas nos previews até 16/11 | **sim** | consumo de créditos pagos |
| `GITHUB_READ_TOKEN` | feita (16/11 23:54) | presumidas nos previews até 16/11 | recomendável | repositório já é público. O escopo do token não foi conferido |
| `EIFF_FORM_SECRET` (vaga A) | feita (10/11 16:55) | presumidas nos previews até 10/11 | sai na J6 | serve de retorno do site enquanto a J6 não vier |
| `EIFF_FORM_SECRET_B` (vaga B) | nasceu só em production | nenhuma | não | — |
| `VITE_SUPABASE_ANON_KEY` | não se aplica | pública por desenho | não | protegida por RLS |

"Presumidas" significa que a credencial não tem função que a revele sem login. Como o contexto foi esvaziado só em
16–17/11, a presunção é que estava nos previews anteriores.

**A remoção futura da vaga A não resolve as demais credenciais.** Ela trata só o segredo do formulário. A chave de
serviço, a da Google e a da Vibe seguem o plano abaixo, independentemente da J6.

## 6. Dependências: o que pode parar

**`SUPABASE_SERVICE_ROLE_KEY`** é usada por `usuarios`, `widget-caixa`, `vibe`, `email-comercial`,
`diretor-financeiro` (veredito), `channel-octadesk`, pelo formulário do site e a ingestão do Inbox, e pelos scripts
locais (`.env.local`).

**Rotação da chave de serviço: corrigida em 23/11/2026 e reconciliada com o PR #95.** A versão anterior desta seção
dizia que o caminho (i) «não mexe na chave pública». **Estava errado.** A chave legada `service_role` é um JWT e só deixa
de valer quando as chaves legadas são **desativadas** no painel do Supabase. Desativar as legadas desliga **`service_role`
e `anon` juntas** (documentação da Supabase, conferida no PR #95 em 17/11/2026). Então a rotação passa obrigatoriamente
por trocar também a chave do navegador. O caminho certo é o roteiro R1 → R6 do PR #95
(`docs/s1-chave-servico-supabase.md` e `docs/s1-r4-plano-operacional.md` na branch `feature/s1-r1-chave-servico`):

| Passo | O que é | Estado em 23/11/2026 |
|---|---|---|
| R1 | código compatível com a legada (JWT) e a nova (`sb_secret_…`, só no cabeçalho `apikey`, nunca em `Authorization: Bearer`); com a legada, cada requisição sai com os mesmos cabeçalhos de antes (provado por teste) | PR #95 aberto, sem merge. **Reconciliação com a `main`:** a branch está 21 commits atrás e 8 à frente (base `e55b3d6`, de antes da S3 e da P1); a fusão simulada (`git merge-tree`) não tem conflito, e nenhum arquivo do #95 foi alterado na `main` depois da base |
| R2 | criar as chaves novas no painel (não revoga nada) | não feito |
| R3A | homologação sem escrita em produção | homologada (17/11) |
| R3B | escritas do Auth admin num projeto descartável | **parcialmente homologada** (17/11): criar, buscar e atualizar usuário com `sb_secret`; **convite e recuperação de senha sem homologação de envio e entrega** |
| R4 | trocar a chave nas Functions, só em production | plano em `s1-r4-plano-operacional.md`; não autorizado |
| R5 | `VITE_SUPABASE_ANON_KEY` recebe a `sb_publishable_…`; build e publicação; conferir login, telas e tempo real | não autorizado |
| R6 | desativar as legadas no painel (derruba `service_role` **e** `anon` legadas) | não autorizado; ordem obrigatória R4 → R5 → R6 |

**Inventário de quem usa a chave de serviço na `main` (23/11/2026):**
- As nove portas que fazem a chamada estão todas cobertas pelo #95: `diretor-financeiro`, `email-comercial`,
  `widget-caixa`, `vibe`, `usuariosServidor`, `inbox/ingestaoPorta`, `inbox/roteamentoPorta`, `radar/canaisServidor` e
  `radar/formularioPorta`.
- Os demais arquivos que citam a chave só a leem do ambiente e a repassam a essas portas: `formulario-site`,
  `formulario-reconciliar`, `channel-octadesk`, `usuarios`, `inbox/ativacao` e `radar/vibeServidor`.
- Os scripts `pg-smoke-*` e `s3*` usam `service_role` como **papel do PostgreSQL**, não como chave.
- **A conferir antes do merge do #95:**
  - repetir esse inventário na branch reconciliada;
  - os scripts locais que leem `.env.local`.
- A chave pública (`VITE_SUPABASE_ANON_KEY`, ou `SUPABASE_ANON_KEY` nas funções) aparece em 16 arquivos da `main`. A R5
  troca o valor. O código precisa aceitar `sb_publishable_…` também como `apikey` do usuário, o que o #95 trata.

**Compatibilidade a provar antes da R4** (nenhum destes foi provado contra produção):
- PostgREST e RPC com `sb_secret` no `apikey`;
- Auth admin: criar, buscar e atualizar homologados no descartável; convite e recuperação **pendentes**;
- supabase-js 2.114 real: provado em teste sem rede no #95;
- Storage (bucket `fotos-campo`, `anexos-financeiros`) com a chave nova;
- tempo real e login no navegador com a `sb_publishable_…` (R5).

**Segredo JWT legado.**
- Desativar as chaves legadas (R6) não é o mesmo que trocar o segredo JWT que assina as sessões.
- Trocar o segredo, ou migrar para chaves de assinatura assimétricas, invalida as sessões em curso: todos fazem login de
  novo.
- O widget do iPad não depende disso, porque o token dele é do banco.
- Integrações que validem JWT com o segredo antigo quebram. Nenhuma foi encontrada no código, mas não houve varredura fora
  do repositório.
- É decisão separada, depois da R6, e **não** está proposta agora.

**R7 — revogar o segredo JWT legado (passo explícito, depois da R6).** A guia da Supabase sobre chave vazada manda, para
`service_role` exposta, também revogar o segredo JWT legado: o que ainda confia no segredo pode aceitar a chave vazada.
- **Custo:** todas as sessões são encerradas, e todos fazem login de novo.
- **Não afeta:** o widget do iPad, porque o token dele é do banco.
- **Autorização:** própria, com aviso prévio.

Desativar as legadas (R6) é **reversível**, mas reativá-las **devolve a validade da chave comprometida**. Por isso o
retorno «reativar as legadas» só vale até a R7.

**Pontos de retorno que não dependem de chave revogada.** Até a R6, o retorno é republicar o deploy anterior, porque a
legada ainda vale. **Depois da R6**, todo deploy construído com a legada fica sem banco, inclusive os retornos de hoje
(`6aff669c`, `6afda676`). O ponto de retorno passa a ser o deploy da R5, e o retorno mais profundo exige reativar as
legadas no painel, que a Supabase permite. Por isso a R6 só entra depois de um período de observação da R5, com critérios
em `s1-r4-plano-operacional.md` §8.

**Indisponibilidade.**
- Não há prova de troca sem interrupção.
- O que se espera, sem prova:
  - minutos nas funções entre gravar a chave nova e publicar o build (R4);
  - risco de sessão no navegador na R5.
- A janela precisa ser anunciada à Frente A e ao uso interno.

**Demais chaves:**

| Chave | Efeito da rotação |
|---|---|
| Google OAuth | `email-comercial` para até nova autorização |
| Anthropic | Assistente, Comunicação e Diretor Financeiro caem para o modo determinístico até a chave nova |
| Vibe | aba Vibe indisponível até a chave nova |
| GitHub | `development-status` para até o token novo |

**Formulário do site:** **preservar a vaga A** enquanto ela for necessária ao retorno do site `6afda685`, isto é, até a
J6 do P1. A vaga B
(production) não é afetada por nenhuma das ações acima.

**Recebimento de leads:** depende de `/api/formulario-site` no deploy publicado. Apagar previews e deploys antigos de
production não o afeta. A rotação da chave de serviço o interrompe **entre** a troca e a publicação do deploy novo:
minutos, dentro da janela.

## 7. Sequência recomendada

Cada fase tem critério GO/NO-GO **antes**, parada **durante** e recuperação **depois**. Nenhuma começa sem a decisão
correspondente da seção 9.

**Pré-condições comuns a todas as fases (NO-GO se faltar qualquer uma):**
- publicado conhecido e travado (hoje `6aff669c`, retorno `6afda676`);
- nenhuma janela crítica aberta na Frente A (implantação, J5/J6 do formulário, lead em atendimento);
- leitura do estado no dia (variáveis por contexto e lista de deploys), sem valores;
- autorização específica da Direção para a fase.

**Fase 0 — leitura de confirmação, sem efeito (D1).**
- Ler os logs e painéis da seção 4: Supabase API, funções do Netlify, auditoria da conta Netlify, Anthropic, Google e
  Vibe.
- **GO** para as fases seguintes: nenhum uso fora do padrão.
- **Parada:** qualquer uso indevido. Nesse caso abre-se **incidente de segurança**, a rotação da credencial afetada vira
  imediata e sai desta sequência.
- Recuperação: não se aplica, porque nada muda.

**Fase 1 — D8, AI Gateway fora de production: procedimento preparado, NÃO AUTORIZADO.**

A diretriz pedia «Anthropic só em Production». Não há variável da EIFF para restringir: ela está vazia em todos os
contextos. O que chega aos previews é a injeção do AI Gateway. Há três opções:

| Opção | Como | Efeito em production | Efeito nos previews | Reversível |
|---|---|---|---|---|
| **a) Manter (recomendado agora)** | nada | nenhum | as funções dos previews usam o gateway, mas só depois do login do app | — |
| b) Bloquear a injeção só fora de production | dar a `ANTHROPIC_API_KEY` um valor-sentinela não secreto (`bloqueado-fora-de-producao`) **só** nos contextos `deploy-preview` e `branch-deploy`; production continua vazia, então o gateway continua injetando lá | nenhum esperado | a IA dos previews passa a falhar, e o app cai para o modo determinístico | sim: apagar o valor desses dois contextos |
| c) Desligar o AI Gateway | desativar «AI Features» no time do Netlify | **para** Assistente, Comunicação e Diretor Financeiro por IA em production, até haver chave própria | idem | sim |

**Limites da opção (b), apontados pela revisão independente:**
- **Só atinge previews novos.** Cada deploy guarda o ambiente do build, e os 234 previews no ar não mudam. A documentação
  não diz se a injeção é decidida a cada chamada.
- **Não corta o gateway.** O Netlify injeta sempre `NETLIFY_AI_GATEWAY_KEY`, então «bloquear a injeção» exagera: o
  sentinela só troca a `ANTHROPIC_API_KEY`.
- **Risco para production na própria mudança.** `updateEnvVar` substitui a lista inteira de valores. Um pedido com só os
  dois contextos apagaria os de production e dev. A mudança tem de ser feita contexto a contexto, relendo os cinco
  contextos depois.
- **Erro descoberto tarde.** Um sentinela gravado em production por engano só apareceria no próximo deploy de production.

**Procedimento da opção (b), se a Direção escolher:**
- **GO:**
  - D1 sem alerta;
  - Frente A sem janela crítica;
  - publicado `6aff669c` travado;
  - **o #107 ajustado antes**, para aceitar o sentinela; sem o ajuste, a guarda recusaria o build dos previews, porque
    ela recusa qualquer valor não vazio.
- **Passo:** uma única mudança de configuração no Netlify, de valor por contexto, sem build e sem tocar production.
- **Validação:**
  - a sonda sem credencial **não basta**, porque o sentinela também faz a função responder 401;
  - **antes:** linha de base autenticada em production, pela `comunicacao`, a única função que usa o gateway pelo SDK;
  - **depois:** a mesma chamada num preview construído depois da mudança, comparando o `detalhe` do erro;
  - reler os cinco contextos e a configuração `ai_gateway_disabled`.
- **Parada:** qualquer mudança de comportamento em production.
- **Recuperação:** remover o valor dos dois contextos.
- **Incerteza declarada:** a documentação do Netlify diz que o gateway não sobrescreve uma variável «já definida». Ela
  não diz se um valor vazio conta como definido; o comportamento em production mostra que não conta. A opção (b) depende
  de um valor não vazio impedir a injeção, o que não foi testado.

**Fase 2 — apagar os previews antigos (D2): lista A, 182 deploys.** Remove as cópias da chave de serviço.
- **GO:**
  - lista A fechada (2.6), com o hash conferido na execução;
  - reconfirmação da Direção diante da diretriz de 23/11;
  - Frente A sem janela crítica (confirmado às 15:31 UTC de 23/11, válido por 2 h);
  - publicado travado.
- **NO-GO:**
  - qualquer id fora da lista;
  - qualquer id de production, sem PR ou posterior ao marco;
  - hash diferente;
  - publicado destravado.
- **Execução:** `scratch/seguranca-previews-d2/excluir.mjs <hash> --executar`. Antes de cada exclusão, o script relê o
  deploy e confere site, contexto, data, PR, se foi publicado e se é retorno. Ele para na primeira divergência e grava um
  log por item.
- **Validação:**
  - os 182 endereços respondem 404;
  - o publicado continua `6aff669c` e travado;
  - os retornos existem;
  - as rotas públicas respondem os códigos de sempre;
  - o novo inventário tem exatamente 182 deploys a menos que o do dia.
- **Recuperação:** **não há**, porque apagar é irreversível. Um PR antigo que precise de preview gera outro com um push,
  já sem segredo.

**Fase 3 — limpeza de configuração (D3).**
- Remover os contextos vazios das variáveis privilegiadas e decidir se os previews ficam ligados.
- Recuperação: recriar o contexto vazio ou religar os previews.

**Fase 4 — rotação da chave de serviço (D4): NÃO AUTORIZADA; segue o roteiro R1 → R6 do PR #95 (seção 6).**
- **GO para pedir autorização:**
  - #95 reconciliado com a `main` e mesclado sob `MERGE AUTORIZADO`;
  - inventário de chaves refeito na branch reconciliada;
  - compatibilidade provada (PostgREST, RPC, Auth admin, Storage, supabase-js);
  - convite e recuperação homologados, ou aceitos como pendência pela Direção;
  - Frente A avisada;
  - janela anunciada.
- **Ordem:** R2 → R4 (Functions, `PRODUCTION AUTORIZADA`) → observação → R5 (navegador, `PRODUCTION AUTORIZADA`) →
  observação → R6 (desativar as legadas) → R7 (revogar o segredo JWT legado).
- **Parada:** qualquer 5xx nas funções ou falha de login entre R4 e R6.
- **Recuperação:**
  - antes da R6: republicar o deploy anterior;
  - depois da R6: reativar as legadas no painel e republicar o deploy da R5.
- **Efeito:** só a R6 invalida as cópias antigas da chave de serviço, e com ela a `anon` legada.

**Fase 5 — chaves de terceiros (D5): plano por fornecedor, NÃO AUTORIZADO.** Uma por vez, cada uma em janela própria
e sempre **só em production**.

| Fornecedor | Onde a chave nova nasce | Passos | Validação, sem gravar | Retorno | Efeito durante a troca |
|---|---|---|---|---|---|
| Anthropic | — | **não se aplica**: não há chave da EIFF; production usa o AI Gateway do Netlify. Se um dia houver chave própria, ela nasce só em production | — | — | — |
| Google OAuth (`GOOGLE_OAUTH_*`) | Google Cloud Console + nova autorização da conta comercial | 1. criar segredo novo do cliente; 2. reautorizar e obter refresh token novo; 3. gravar; 4. publicar; 5. revogar o segredo e o token antigos | teste de saúde do e-mail comercial (envio segue DESLIGADO) | voltar os valores antigos antes da revogação | `email-comercial` para até a reautorização; o envio já está desligado |
| Vibe (`VIBE_API_KEY`) | painel da Explorium | chave nova, gravar, publicar, revogar a antiga | consultar saldo pela aba Vibe (sem consumo) | voltar o valor | aba Vibe indisponível alguns minutos |
| GitHub (`GITHUB_READ_TOKEN`) | GitHub › tokens finos (escopo mínimo: leitura deste repositório) | token novo, gravar, publicar, revogar o antigo | `development-status` responde | voltar o valor | painel de desenvolvimento sem dados alguns minutos |
| Formulário, vaga A (`EIFF_FORM_SECRET`) | — | **fora da D5**: preservada até a J6 (D7) | — | — | — |

**Fase 6 (opcional) — deploys de production antigos (D6).** Só depois da fase 4, que já os neutraliza. Manter o
publicado e os dois retornos.

**Ordem e justificativa:**
- **2 primeiro:** reduz a superfície já, sem efeito operacional.
- **4 é a única que invalida a chave antiga, e só no passo R6:** antes da R6, toda cópia antiga continua valendo,
  inclusive fora do Netlify.
- A D8 é independente e não precede a D2.

## 8. Risco residual depois da contenção

- **Depois da fase 2:** nenhum preview com a chave de serviço no ar. Restam as cópias legítimas em production e qualquer
  cópia fora do Netlify.
- **Depois da R6 (fase 4):** nenhuma cópia antiga da chave de serviço vale, e a chave pública legada também deixa de
  valer.
- **Permanente:**
  - os deploys de production publicados mantêm versões antigas das funções em endereço permanente, até a retenção de 90
    dias ou a fase 5;
  - o repositório é público, então código em PR é visível. Previews sem segredo não dão acesso ao banco, mas a regra
    "segredo só em production" precisa ser mantida;
  - sugestão de controle: uma checagem periódica do mesmo GET da seção 2.3 no preview mais recente.

## 9. Decisões que dependem da Direção

| # | Decisão | Proposta |
|---|---|---|
| D1 | Fase 0: ler logs e painéis de terceiros | sim, sem efeito |
| D8 | AI Gateway fora de production: (a) manter, (b) sentinela só nos previews, (c) desligar o gateway | **(a) manter agora**; (b) só com o #107 ajustado e uma prova autenticada |
| D2 | Fase 2: apagar a **lista A** (182 previews de PR anteriores a 17/11 01:27 UTC). Lista B (1 rascunho sem PR) por decisão própria. D2 ampliada (233) **não recomendada** | reconfirmar a lista A |
| D3 | Previews do CRM: manter ligados (sem segredo) ou desligar | manter, com a checagem periódica |
| D4 | Fase 4: rotação da chave de serviço pelo roteiro R1 → R6 do #95 (o caminho (i) da versão anterior estava errado) | primeiro reconciliar e mesclar o #95; depois R4, R5 e R6, cada um com autorização própria |
| D5 | Fase 5: rotação das chaves de terceiros | sim |
| D6 | Fase 6: apagar deploys antigos de production | opcional, depois da fase 4 |
| D7 | Vaga A do formulário | **preservar** enquanto for necessária ao retorno do site. A remoção (J6) volta à Direção coordenada com este plano, e **não substitui** as fases 1 a 5 |

Nenhuma dessas ações está autorizada por este documento.

## 10. Revisões

- **23/11/2026, primeira versão:** inventário, sonda da chave de serviço e varredura dos arquivos públicos.
- **23/11/2026, revisão:**
  - segunda sonda, da chave da Anthropic, nos 414 deploys. A leitura anterior "não conclusivo" estava errada: a chave
    está presente em todos os contextos, inclusive nos previews novos;
  - justificativa de por que os 110 previews de 11/09 a 14/10 não são mensuráveis sem login;
  - branch deploys: nenhum;
  - quadro de restrição × rotação por credencial (5a);
  - GO/NO-GO, parada e recuperação por fase;
  - a decisão D8;
  - a vaga A tratada como retorno do site, não como solução para as demais credenciais.
- **23/11/2026, segunda revisão (diretriz «Prioridades — comercial e segurança»):**
  - a «chave da Anthropic» dos previews é a injeção do AI Gateway do Netlify, não uma variável da EIFF; D8 reescrita;
  - seção 6 corrigida: só a R6 invalida a chave antiga, e ela desliga também a `anon` legada; roteiro do #95, que funde
    com a `main` sem conflito;
  - D1 executada (2.5);
  - listas fechadas A/B/C com hash e revisão independente da lista A (2.6);
  - D2 ampliada não recomendada;
  - D2 não executada;
  - D3: guarda de build no PR #107 (rascunho).
- **23/11/2026, terceira revisão:**
  - segunda revisão independente, que concorda com as listas e com a atribuição ao AI Gateway;
  - limites da D8(b);
  - R7 explícita.
- **Achado lateral (não verificado; follow-up fora deste plano):** `assistente`, `diretor-financeiro` e
  `inbox/inteligenciaLlm` chamam `api.anthropic.com` diretamente. A chave do AI Gateway só vale pela URL do gateway. Se
  for assim, essas três funções já falham em production com `ia_indisponivel`, e só a `comunicacao` funciona. Conferir
  exige uma chamada autenticada.

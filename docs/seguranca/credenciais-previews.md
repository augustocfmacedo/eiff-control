# Segurança — credenciais privilegiadas em deploys não produtivos do CRM

Registro específico vinculado à issue #99, criado em 23/11/2026 por decisão da Direção. Não altera o escopo da #99.

**Situação:** **plano para aprovação.** Nesta etapa a Direção autorizou só leitura, análise e documentação, e nada foi
executado. Os valores das variáveis não foram lidos, impressos nem gravados em lugar nenhum: o inventário registrou só
nomes, contextos, se o valor está vazio e as datas.

## 1. Resumo executivo

- **O que é.** Durante cerca de dois meses, os deploys de preview do CRM rodaram com a **chave de serviço do banco de
  produção** (`SUPABASE_SERVICE_ROLE_KEY`) e com as demais chaves privilegiadas. Cada deploy guarda as variáveis do
  momento em que foi construído e continua acessível em endereço público.
- **O que já mudou.** Os valores fora de production foram **esvaziados entre 16/11 e 17/11/2026**, **exceto o da
  Anthropic** (próximo item). Os previews
  construídos desde 17/11 01:27 UTC já nascem **sem** a chave de serviço, comprovado em execução. O texto da #99 (18/11)
  descreve a existência das variáveis nesses contextos, mas elas já estavam vazias.
- **O que continua exposto.** **73 deploys de preview com a chave de serviço, ainda no ar**, construídos de 14/10 a
  16/11 para 37 PRs. Outros **110 previews** (11/09 a 14/10, 54 PRs) também estão no ar. Neles a presença da chave de
  serviço **não pode ser medida** sem login, então devem ser tratados como expostos.
- **Achado da revisão de 23/11: a chave da Anthropic nunca saiu dos previews.** `ANTHROPIC_API_KEY` tem o **mesmo valor
  em todos os contextos**. A sonda comprovou que ela está presente nos **229 previews no ar, inclusive nos 46 construídos
  depois de 17/11**. Todo preview novo continua recebendo essa chave (2.3).
- **Comprometimento.** **Nenhuma evidência de uso indevido** nas fontes que pudemos ler. É **exposição potencial, não
  comprometimento comprovado**. A ausência de evidência é limitada: os logs do Supabase e das funções do Netlify não
  foram lidos (seção 4).
- **Gravidade proposta:** **ALTA.** A chave dá acesso total ao banco de produção e ignora RLS. A probabilidade de uso
  indevido é baixa: o repositório só recebe código do dono, os PRs de fork exigem aprovação e não há sinal de uso.
- **Recomendação:**
  1. restringir a chave da Anthropic a production, a única que ainda vai para todo preview novo;
  2. apagar os previews no ar;
  3. **rotacionar a chave de serviço** numa janela própria;
  4. rotacionar as chaves de terceiros de baixo custo.

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
| `ANTHROPIC_API_KEY` | sim | com valor (a API mascara e mostra vazio) | **o mesmo valor de production** (`igual a production` nos quatro contextos). **Presente** em todos os 229 previews, provado em execução (2.3) | 04/09 |
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

**Segunda sonda: chave da Anthropic.** Foi feito um POST vazio, sem credencial, em `/api/assistente` de cada um dos 414
deploys. A função devolve `501 nao_configurado` sem a chave e `401 nao_autenticado` com ela, antes de ler o corpo e sem
chamar a Anthropic.

| Grupo | Deploys | `ANTHROPIC_API_KEY` |
|---|---|---|
| Previews de 11/09 a 14/10 | 110 | **presente** |
| Previews de 14/10 a 16/11 | 73 | **presente** |
| Previews **de 17/11 em diante** | 46 (12 PRs) | **presente**: não foi restrita |
| Production desde 08/09 | 157 | presente (legítimo) |
| Production de 03 a 04/09 | 28 | sem a chave ou sem a função (início do Assistente) |

**Branch deploys:** **nenhum.** `allowed_branches = [main]`, e todo deploy de `main` é do contexto production. Não há
branch deploy de outra branch no ar.

**Retenção de 90 dias:** os 110 previews mais antigos expiram sozinhos entre ~10/12/2026 e ~12/01/2027, e os 73 até
~14/02/2027. Os 46 recentes, que ainda têm a chave da Anthropic, expiram até ~17/02/2027.

Os deploys de production têm a chave por desenho. O ponto de atenção é outro: os endereços permanentes deles continuam
executando **versões antigas** das funções, inclusive anteriores a correções de segurança, como as do PR #76.

**Vazamento em arquivo público:** os arquivos `.js` públicos dos deploys com a chave foram varridos em busca da
assinatura de um JWT `service_role`. Resultado em 2.4.

### 2.4 Busca da chave nos arquivos públicos

Foram varridos os `.js` públicos dos 73 previews com a chave e dos 3 deploys de production mais recentes. A busca
procurou o papel `service_role` em base64url nos três alinhamentos e decodificou todo JWT encontrado. Resultado:
**nenhuma assinatura de chave de serviço em nenhum dos 76 deploys** (de 49 a 52 arquivos por deploy). As variáveis sem prefixo `VITE_` não entram no pacote do navegador. O Netlify também marca essas
variáveis como segredo e tem varredura de segredos no build.

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
| `ANTHROPIC_API_KEY` | consumo de tokens | não lido. Conferir no console da Anthropic |
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
| `ANTHROPIC_API_KEY` | **não feita**: ainda vai para todo preview novo | 229 provadas | **sim, depois de restringir** | só restringir deixaria 229 cópias. O dano possível é custo de uso |
| `GOOGLE_OAUTH_*` (refresh token) | feita (16/11 16:01) | presumidas nos previews até 16/11 | **sim** | permite enviar e-mail como a conta comercial |
| `VIBE_API_KEY` | feita (17/11 00:21) | presumidas nos previews até 16/11 | **sim** | consumo de créditos pagos |
| `GITHUB_READ_TOKEN` | feita (16/11 23:54) | presumidas nos previews até 16/11 | recomendável | repositório já é público. O escopo do token não foi conferido |
| `EIFF_FORM_SECRET` (vaga A) | feita (10/11 16:55) | presumidas nos previews até 10/11 | sai na J6 | serve de retorno do site enquanto a J6 não vier |
| `EIFF_FORM_SECRET_B` (vaga B) | nasceu só em production | nenhuma | não | — |
| `VITE_SUPABASE_ANON_KEY` | não se aplica | pública por desenho | não | protegida por RLS |

"Presumidas" significa que a credencial não tem função que a revele sem login. Como o contexto foi esvaziado só em
16–17/11, a presunção é que estava nos previews anteriores.

**A remoção futura da vaga A não resolve as demais credenciais.** Ela trata só o segredo do formulário. A chave de
serviço, a da Anthropic, a da Google e a da Vibe seguem o plano abaixo, independentemente da J6.

## 6. Dependências: o que pode parar

**`SUPABASE_SERVICE_ROLE_KEY`** é usada por `usuarios`, `widget-caixa`, `vibe`, `email-comercial`,
`diretor-financeiro` (veredito), `channel-octadesk`, pelo formulário do site e a ingestão do Inbox, e pelos scripts
locais (`.env.local`).

**Rotação da chave de serviço.** Há dois caminhos:
- **(i) Chaves novas do Supabase** (`sb_secret_…`), recomendado. Cria-se uma chave secreta nova, ela substitui a antiga
  no Netlify, publica-se e só então se **revoga** a chave legada. **Não mexe** na chave pública (`anon`) nem nas sessões
  dos usuários. Pré-condição: conferir se o SDK e as chamadas REST das funções aceitam o formato novo. Isso não foi
  testado.
- **(ii) Trocar o segredo JWT do projeto.** Invalida também a chave `anon` e **todas as sessões**: exige trocar
  `VITE_SUPABASE_ANON_KEY`, reconstruir e publicar o app, e todos fazem login de novo. O widget do iPad continua, porque
  o token dele é do banco. **Não recomendado.**

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

**Fase 1 — restringir a chave da Anthropic a production (D8).** É a única credencial que ainda nasce em todo preview.
- **GO:** fase 0 sem alerta.
- **Passo:** gravar valor só em production, deixando os demais contextos vazios. É mudança de configuração do Netlify e
  não exige build.
- **Validação:** o próximo preview responde `501 nao_configurado` em `/api/assistente`; um deploy de production responde
  `401`.
- **Parada:** production passar a responder 501. Nesse caso, recolocar o valor no contexto production.
- **Recuperação:** voltar o escopo anterior. Até a fase 4 o valor é o mesmo, então nada quebra.
- **Efeito operacional:** os previews perdem o Assistente por IA e passam a usar a busca local. Production não muda.

**Fase 2 — apagar os previews antigos (D2).** Remove as 183 cópias da chave de serviço e as 229 da chave da Anthropic.
- **GO:**
  - lista fechada de IDs gerada no dia, **só `context = deploy-preview`**;
  - nenhum ID igual ao publicado ou aos retornos;
  - fase 1 concluída, para que nenhum preview novo nasça com a chave da Anthropic.
- **NO-GO:** qualquer ID de production na lista; divergência entre a contagem e o inventário do dia.
- **Parada:** a primeira exclusão que não seja de preview interrompe a fase.
- **Validação:**
  - o publicado continua `6aff669c` e travado;
  - as rotas públicas respondem os códigos de sempre;
  - os endereços apagados respondem 404.
- **Recuperação:** **não há**, porque apagar é irreversível. Um preview necessário à revisão de um PR aberto se
  reconstrói com novo push no PR, já sem segredo.

**Fase 3 — limpeza de configuração (D3).**
- Remover os contextos vazios das variáveis privilegiadas e decidir se os previews ficam ligados.
- Recuperação: recriar o contexto vazio ou religar os previews.

**Fase 4 — rotação da chave de serviço pelo caminho (i) (D4).**
- **GO:**
  - formato novo (`sb_secret_…`) testado nas funções (SDK e REST) num deploy descartável **sem** dados reais, ou em
    PostgreSQL local;
  - Frente A avisada, por causa do formulário;
  - `PRODUCTION AUTORIZADA` para publicar a `main` com a chave nova.
- **Passos:**
  1. criar a chave nova no Supabase;
  2. gravá-la no Netlify **só em production**;
  3. construir e publicar a `main`;
  4. validar;
  5. revogar a chave legada.
- **Validação**, só por leitura e sem gravar:
  - `/api/widget-caixa` sem token responde 401;
  - Usuários lista;
  - formulário: POST sem segredo responde 401;
  - as telas do app não mudam.
- **Parada:** qualquer 5xx numa função entre o passo 3 e o passo 5.
- **Recuperação:**
  - **antes da revogação:** republicar o deploy anterior. A chave legada ainda vale;
  - **depois da revogação:** gerar outra chave nova e repetir a partir do passo 2. Os deploys antigos ficam sem banco
    de propósito, inclusive os retornos, então o retorno passa a exigir rebuild.
- **Efeito operacional:** minutos de indisponibilidade das funções com chave de serviço entre a troca e a publicação.
  Leads que chegarem nesse intervalo ficam no Netlify Forms e no e-mail.

**Fase 5 — chaves de terceiros (D5).** Uma por vez, cada uma com o seu teste de leitura:
1. **Anthropic:** nova chave em production e revogar a antiga.
2. **Google OAuth:** revogar o refresh token e reautorizar.
3. **Vibe:** nova chave.
4. **GitHub:** novo token com escopo mínimo.

- **Parada:** a função correspondente passa a responder erro de configuração em production.
- **Recuperação:** voltar a chave anterior, enquanto ainda não foi revogada.

**Fase 6 (opcional) — deploys de production antigos (D6).** Só depois da fase 4, que já os neutraliza. Manter o
publicado e os dois retornos.

**Ordem e justificativa:**
- **1 antes de 2:** sem a fase 1, novos previews continuariam nascendo com a chave da Anthropic.
- **2 antes de 4:** reduz a superfície já, sem efeito operacional.
- **4 é a única que garante:** depois dela nenhuma cópia antiga da chave de serviço vale, inclusive fora do Netlify.

## 8. Risco residual depois da contenção

- **Depois das fases 1 e 2:** sem cópia da chave em deploy não produtivo. Restam as cópias legítimas em production e
  qualquer cópia fora do Netlify, só eliminável pela rotação.
- **Depois da fase 3:** nenhuma cópia antiga da chave de serviço vale.
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
| D8 | Fase 1: restringir `ANTHROPIC_API_KEY` a production | **sim, primeiro**: é a única credencial que ainda vai para todo preview |
| D2 | Fase 2: apagar os previews do CRM anteriores a 17/11 e os 46 recentes com a chave da Anthropic, isto é, **todos os 229 previews no ar** | sim, depois da D8 |
| D3 | Previews do CRM: manter ligados (sem segredo) ou desligar | manter, com a checagem periódica |
| D4 | Fase 4: rotação da chave de serviço pelo caminho (i), em janela própria | sim, depois do teste do formato |
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

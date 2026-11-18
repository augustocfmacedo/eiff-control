# E-mail comercial — etapa E0 (preparação)

**Situação: PREPARAÇÃO. Nada foi configurado, nenhuma credencial foi criada ou lida, nenhum e-mail foi enviado.**
Data: 11/11/2026. Complementa `docs/email-comercial.md` (o estudo, mesclado no PR #78); onde os dois divergirem, vale
este para a etapa E0 e o estudo para o resto.

A E0 entrega cinco coisas: o roteiro de configuração do Google Workspace, a verificação da caixa remetente, a regra de
permissão, o desenho da autenticação e do envio, e o plano de implantação sem credencial nem envio real. No fim estão
as decisões que faltam para a implementação começar.

Decisão já tomada pela Direção nesta etapa: **a permissão de envio começa com Administrador e Diretoria** (D-2 fechada).

---

## 1. Verificação de `contato@eiff.com.br`: caixa própria, apelido ou grupo

### 1.1 O que já se sabe sem acessar nada

O DNS público mostra que o domínio recebe pelo Google Workspace e que `contato@` é o destino dos relatórios DMARC.
O Netlify envia para lá os avisos de formulário. Isso prova que o endereço **recebe**. Não diz **o que ele é**: um
usuário, um apelido e um grupo recebem do mesmo jeito. Não existe consulta pública que distinga os três, e este estudo
não fez nenhuma tentativa de sondagem do servidor de e-mail.

### 1.2 Como verificar (feito por quem administra o Workspace, D-3)

No Admin Console (`admin.google.com`), nesta ordem. A verificação é só leitura e leva poucos minutos.

| Passo | Onde | O que procurar |
|---|---|---|
| 1 | Diretório › Usuários › buscar `contato` | Se aparece um **usuário** com e-mail principal `contato@eiff.com.br`. |
| 2 | No mesmo resultado, abrir cada usuário sugerido › Informações do usuário › Endereços de e-mail alternativos | Se `contato@` aparece como **apelido** (endereço alternativo) de outra pessoa. |
| 3 | Diretório › Grupos › buscar `contato` | Se existe um **grupo** com esse endereço e quem são os membros. |
| 4 | Apps › Google Workspace › Gmail › Roteamento (e «Encaminhamento padrão») | Se há regra de roteamento que entrega `contato@` em outro lugar. |

Anotar o resultado em uma linha (por exemplo: «usuário próprio, verificação em duas etapas ligada»). Nenhuma senha,
código ou captura de tela com dado de terceiro precisa ser compartilhado.

**Resultado (11/11/2026, informado pelo Augusto): usuário com caixa própria.** Vale a primeira linha da tabela abaixo.

### 1.3 O que cada resultado muda

| Resultado | Quem faz o consentimento OAuth | Remetente da mensagem | Trabalho extra |
|---|---|---|---|
| **Usuário com caixa própria** | A própria conta `contato@` | `contato@eiff.com.br` | Nenhum. É o caso mais simples. |
| **Apelido de um usuário** | O usuário dono do apelido | `contato@`, desde que esteja em «Enviar e-mail como» da conta (Gmail › Configurações › Contas) | Conferir o «Enviar como». A mensagem fica em Enviados **do usuário dono**, não numa caixa «contato». |
| **Grupo** | Um usuário real, membro do grupo | `contato@`, se o grupo permitir «postar como o grupo» e o usuário tiver o endereço em «Enviar como» | Mais frágil: depende de configuração do grupo e de uma pessoa específica. As respostas chegam a todos os membros. |
| **Só roteamento, sem caixa** | Ninguém consegue | — | É preciso criar uma caixa (licença) ou escolher outro remetente. |

Recomendação se **não** for usuário próprio: transformar `contato@` em usuário com caixa própria (uma licença) antes
de começar. Motivos: o consentimento não fica preso à conta pessoal de alguém, a troca de senha de uma pessoa não
derruba o envio da empresa, e a segunda entrega (ler respostas) só faz sentido sobre uma caixa que é da empresa.

Limite técnico a registrar: com a permissão só de envio (`gmail.send`), o sistema **não consegue ler** a lista de
«Enviar como» da conta. Se o remetente pedido não for um endereço que a conta pode usar, o Gmail troca o remetente
pelo endereço principal da conta, sem erro. Por isso a conferência do remetente é um passo obrigatório do canário:
abrir a mensagem recebida e olhar o campo De.

---

## 2. Roteiro de configuração do Google Workspace

Para a pessoa nomeada em D-3. **Feito por pessoa, no navegador dela.** O assistente não cria conta, não clica em
consentimento e não vê nem digita segredo. Nenhum passo abaixo foi executado.

> **Revisão de 13/11/2026:** o Google mudou a interface e uma regra desde que este roteiro foi escrito. O procedimento
> a seguir é `docs/email-comercial-google-workspace.md`, que traz os menus atuais e as quatro diferenças. A principal:
> o **segredo do cliente só aparece uma vez**, na criação. Este §2 fica como registro do desenho.

Pré-requisitos: acesso de superadministrador ao Workspace; acesso à conta da caixa remetente (resultado do §1);
acesso ao painel do Netlify do `eiff-control`.

### 2.1 Projeto e API (Google Cloud Console, logado como administrador do domínio)

1. Criar um projeto **dentro da organização `eiff.com.br`**, com nome que diga para que serve (por exemplo
   `eiff-control-email`). Projeto dedicado: nada mais mora nele.
2. Em «APIs e serviços» › Biblioteca, ativar **Gmail API**. Nenhuma outra.
3. Não é preciso ativar faturamento para a primeira entrega (só envio).

### 2.2 Tela de consentimento OAuth

4. Tipo de usuário: **Interno**. Só contas de `eiff.com.br` conseguem consentir, e o aplicativo não passa por
   verificação do Google.
5. Nome do aplicativo: «EIFF Control — e-mail comercial». E-mail de suporte: o do administrador.
6. Escopos: adicionar **somente** `https://www.googleapis.com/auth/gmail.send`. Não adicionar leitura, composição,
   `mail.google.com` nem configuração.

### 2.3 Cliente OAuth

7. Credenciais › Criar credenciais › ID do cliente OAuth › tipo **«App para computador»** (decisão N-3: o token é obtido
   pelo script local, §2.4). Esse tipo não tem URI de redirecionamento para cadastrar: o Google aceita o retorno em
   endereço de loopback (`http://127.0.0.1:<porta>`), que só existe na máquina de quem consente.
8. O Google mostra o **ID do cliente** e o **segredo do cliente**. O segredo vai direto para o painel do Netlify
   (passo 12). Não colar em conversa, e-mail, documento ou repositório.

### 2.4 Consentimento da caixa (uma única vez)

9. Sair de todas as contas Google no navegador e entrar **como a conta remetente** definida no §1.
10. No próprio computador, numa cópia do repositório, rodar **no seu terminal** (nunca pelo assistente):

    ```bash
    node scripts/email-oauth-consentimento.mjs
    ```

    O script pede o ID do cliente e o segredo (digitação oculta), mostra o endereço de consentimento e espera o retorno.
    A tela do Google deve mostrar **uma** permissão: «Enviar e-mails em seu nome». Se mostrar qualquer outra, cancelar:
    o escopo está errado.
11. O resultado é o **token de atualização**. Por padrão o script o coloca na área de transferência, sem imprimir, e a
    limpa depois que você confirmar que colou no painel do Netlify. Com `--mostrar` ele é impresso uma vez.

### 2.4.1 O script de consentimento (revisão da etapa E5)

`scripts/email-oauth-consentimento.mjs`, com as partes puras em `scripts/lib/emailOauth.mjs`. **Preparado e não executado.**

| Escolha | Motivo |
|---|---|
| Cliente «App para computador» + retorno em loopback `127.0.0.1` em porta aleatória | É o fluxo que o Google documenta para aplicativo instalado. Não exige URL pública nem página nossa recebendo o código; o servidor de retorno vive alguns minutos e só escuta na própria máquina. |
| PKCE (`S256`) e `state` aleatório | O código de autorização só serve para quem tem o verificador, que nunca sai da máquina; retorno com `state` diferente é recusado. |
| `access_type=offline` + `prompt=consent` | Sem os dois o Google pode não devolver token de atualização. |
| Um escopo (`gmail.send`), conferido de novo na resposta | Se o Google conceder qualquer escopo a mais, ou não devolver token de atualização, o script recusa e manda revogar. |
| Sem disco e sem variável de ambiente | O segredo do cliente é digitado com a entrada oculta; nada é gravado; o token vai para a área de transferência. |
| Só terminal interativo | Rodado por automação (sem terminal), o script recusa e sai antes de abrir servidor ou falar com o Google. Um teste da suíte prende isso. |
| Não envia e-mail | O script só obtém a credencial. O primeiro envio é o canário, com autorização própria. |

Alternativa descartada: OAuth Playground do Google (cliente «Aplicativo da Web»). Funciona, mas o segredo do cliente
teria de ser colado numa página de ferramenta, e o token apareceria nela.

### 2.5 Painel do Netlify (site `eiff-control`), variáveis de ambiente

12. Criar, com escopo de Functions e **sem** prefixo `VITE_`:

| Variável | Valor | Observação |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ID do cliente | |
| `GOOGLE_OAUTH_CLIENT_SECRET` | segredo do cliente | segredo |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | token de atualização | segredo |
| `EIFF_EMAIL_SENDER` | endereço remetente | resultado do §1 |
| `EIFF_EMAIL_SENDER_NAME` | `EIFF` | opcional; é o padrão (D-4) |
| `EIFF_EMAIL_SEND_MODE` | `disabled` | **começa desligado** |
| `EIFF_INBOX_OUTBOUND_ENABLED` | ausente ou `false` | chave geral de saída do Inbox; sem ela `true`, o modo é sempre `disabled` |
| `EIFF_EMAIL_CANARY_RECIPIENTS` | vazio | preenchido só na etapa do canário |
| `EIFF_EMAIL_DAILY_LIMIT_USER` · `EIFF_EMAIL_DAILY_LIMIT_ORG` | conforme D-7 | |

Criar as variáveis não muda nada no ar: o modo começa `disabled` e a função ainda não existe publicada. Elas só
passam a valer no deploy seguinte, que é autorização separada.

### 2.6 Endurecimento (Admin Console)

13. ~~Marcar o aplicativo como confiável e restringir o Gmail a aplicativos confiáveis.~~ **Substituído em 13/11/2026**
    (decisão da Direção): o app é configurado pelo ID do cliente com **Dados específicos do Google**, só com
    `gmail.send`, e o Gmail da organização **não** é restringido nesta implantação. Ver
    `docs/email-comercial-google-workspace.md` §6.
14. Confirmar que a conta remetente tem **verificação em duas etapas** ligada.
15. Anotar, fora do repositório, **quem** fez o consentimento e **quando**: é a informação necessária para revogar.

### 2.7 Como desfazer

- **Parar de enviar na hora**: `EIFF_EMAIL_SEND_MODE=disabled` e novo deploy; ou, mais rápido e sem deploy, revogar o
  acesso do aplicativo em `myaccount.google.com` › Segurança › Apps de terceiros, logado como a conta remetente.
- **Trocar a credencial**: repetir os passos 9 a 12.
- **Desmontar tudo**: apagar o cliente OAuth e o projeto.

Fato a ter em mente: **trocar a senha da conta remetente revoga o token** quando ele tem escopo do Gmail. O sistema
falha fechado (não envia e avisa), e a correção é repetir os passos 9 a 12. A conferir na documentação do Google no
momento da configuração, como registrado no estudo.

---

## 3. Permissão de envio

Decisão da Direção: **Administrador e Diretoria**.

Desenho:

- Ação nova na matriz de permissões (`src/core/permissoes.ts`): `enviar_email: ['Administrador', 'Diretoria']`.
  É separada de `inbox`: abrir e atender uma conversa não dá o direito de enviar e-mail em nome da empresa.
- A ação **não basta sozinha**. O envio exige as quatro condições, todas conferidas no servidor:

| # | Condição | Quem confere |
|---|---|---|
| 1 | Perfil ativo com papel na ação `enviar_email` | Função, lendo o papel do perfil **no banco** (nunca do navegador) |
| 2 | O usuário enxerga a conversa | RLS do Inbox, porque a conversa é lida com o JWT do usuário |
| 3 | Conversa aberta, de contexto externo, com e-mail válido no contato | Handler |
| 4 | Modo de envio permite (e, no canário, o destinatário está na lista) | Handler e, de novo, a fronteira que chama o Google |

- Na tela, o botão «Enviar e-mail» só aparece para quem tem a ação e quando o servidor responde que o envio está
  disponível. Esconder o botão é conforto; a recusa de verdade é a do servidor.
- O Solicitante continua sem acesso a nada disso (as funções auxiliares do banco o ignoram).
- Situação de hoje: o único usuário é `augusto@eiff.com.br`, Administrador. A ação nova não muda o que ninguém mais vê.
- Ampliar para um papel comercial depois é uma linha na matriz, com teste, e decisão própria.

Testes previstos para a regra: cada papel fora da ação recebe 403 sem nenhuma chamada ao Google; papel dentro da ação
mas sem enxergar a conversa recebe 404; perfil inativo recebe 403; papel enviado pelo navegador é ignorado.

---

## 4. Desenho da autenticação OAuth e do envio manual

### 4.1 Peças e quem guarda o quê

```
Painel do Netlify (variáveis)          Função /api/email-comercial            Google
─────────────────────────────          ───────────────────────────            ──────
ID do cliente  ─┐
segredo        ─┼─► lidos do ambiente a cada execução
token de        ┘        │
atualização              │ 1  POST oauth2.googleapis.com/token
                         │    grant_type=refresh_token  ───────────────────►  devolve token de ACESSO
                         │                                                    (curto, cerca de 1 hora)
                         │ 2  POST gmail.googleapis.com/gmail/v1/
                         │    users/me/messages/send
                         │    Authorization: Bearer <token de acesso>
                         │    { "raw": "<mensagem em base64url>" }  ───────►  { id, threadId }
                         ▼
               o token de acesso vive só na memória desta execução
```

- O **token de atualização** nunca sai do ambiente da função: não vai ao navegador, ao banco, ao log nem à resposta.
- O **token de acesso** é pedido a cada envio e descartado no fim. Não há cache entre execuções: o volume é de
  dezenas de envios por dia, e não guardar nada elimina uma classe inteira de vazamento.
- `users/me` é sempre a conta que consentiu. A função não aceita outro identificador de usuário.

### 4.2 Sequência de um envio manual

```
Pessoa            Tela                     Função (handler puro)                     Banco              Google
  │ escreve        │                              │                                    │                  │
  │ «Enviar» ─────►│ confirmação:                 │                                    │                  │
  │                │ De · Para · Assunto · texto  │                                    │                  │
  │ «Enviar agora»►│ POST {threadId, assunto,     │                                    │                  │
  │                │  corpo, intencao} + JWT ────►│ modo ≠ disabled?                   │                  │
  │                │                              │ JWT → perfil → enviar_email?  ────►│                  │
  │                │                              │ conversa e contato (JWT do usuário)►│ RLS decide       │
  │                │                              │ validação do pedido                │                  │
  │                │                              │ entrega READY → REQUESTED  ───────►│ (RPC, serviço)   │
  │                │                              │ token de acesso  ──────────────────┼─────────────────►│
  │                │                              │ messages.send (uma vez, sem retry)─┼─────────────────►│
  │                │                              │ ◄── { id, threadId } ou falha ─────┼──────────────────│
  │                │                              │ aceite: entrega + mensagem + SLA ─►│ uma transação    │
  │                │◄── estado ───────────────────│                                    │                  │
  │◄ «Enviado às…» │                              │                                    │                  │
```

O envio é **manual em dois gestos**: clicar em «Enviar e-mail» e confirmar na janela que mostra remetente,
destinatário, assunto e texto. Não existe caminho sem os dois gestos, nem ação que aceite mais de uma conversa.

### 4.3 Como cada resposta do Google é lida

| Chamada | Resposta | Leitura | Efeito |
|---|---|---|---|
| Token | 200 com `access_token` | segue para o envio | — |
| Token | 400 `invalid_grant` | token revogado ou vencido | 503 `credencial_indisponivel`; entrega `FAILED`; nada enviado |
| Token | 401 `invalid_client` | ID ou segredo errados | idem |
| Token | tempo esgotado, 5xx | Google indisponível **antes** do envio | 503; entrega `FAILED`; pode tentar de novo |
| Envio | 200 com `id` | aceito | entrega `ACCEPTED`; mensagem `enviada`; SLA |
| Envio | 400 | mensagem malformada (defeito nosso) | entrega `FAILED`, código de catálogo |
| Envio | 401 | token de acesso recusado | `FAILED`, `credencial_indisponivel` |
| Envio | 403 | escopo insuficiente ou limite de envio da conta | `FAILED`, código próprio para cada um |
| Envio | 429 | limite de taxa | `FAILED`; **sem** nova tentativa automática |
| Envio | tempo esgotado, rede, 5xx, 200 sem `id` | não sabemos se saiu | `UNKNOWN`; nunca reenviar sozinho |

A diferença que importa: falha **na obtenção do token** é sempre «nada saiu»; falha **no envio** sem resposta clara é
«não sabemos». Só a segunda vira `UNKNOWN`.

O texto de erro que o Google devolve não é repassado ao usuário nem gravado: é traduzido para um código do catálogo
fechado do estudo (§6.1 de `docs/email-comercial.md`), como o projeto já faz desde o PR #76.

### 4.4 Portas do handler (contrato, ainda sem código)

O handler é puro e recebe tudo de fora, para a suíte rodar sem rede:

| Porta | Faz | Na suíte |
|---|---|---|
| `ambiente` | lê modo, remetente, tetos, lista do canário e presença das credenciais | objeto literal |
| `autenticar` | JWT → perfil, organização, papel | simulada |
| `lerConversa` | conversa e contato, com o JWT do usuário | simulada |
| `livro` | criar entrega, transicionar, aceitar (RPCs do serviço) | em memória, com a mesma máquina de estados |
| `google.token` | troca o token de atualização por um de acesso | simulada |
| `google.enviar` | `messages.send` | simulada, **contando as chamadas** |
| `relogio`, `log` | instante e registro sem conteúdo | fixos |

`google.*` é o único lugar que conhece as URLs do Google. A segunda conferência de modo e de lista do canário fica
dentro de `google.enviar`, para que nenhum caminho futuro do servidor consiga chamá-la contornando o handler.

---

## 5. Plano de implantação sem credenciais nem envios reais

O que pode ser construído, revisado e mesclado **antes** de existir qualquer credencial, e como se prova que nada sai.

| Passo | O que entra | Como se prova sem credencial | Toca produção? |
|---|---|---|---|
| I-1 | `enviar_email` na matriz, com testes | suíte | Não |
| I-2 | Core puro: montagem da mensagem, handler, classificação das respostas | suíte com `fetch` simulado; contagem de chamadas de envio em cada caso | Não |
| I-3 | Migration do livro de entregas, RPCs e novo provider — **arquivo no repositório, não aplicado** | `smoke` em PostgreSQL real, no Quality Gate | Não |
| I-4 | Função `/api/email-comercial` e tela, com o modo `disabled` | empacotamento da função; testes de fronteira | Não muda comportamento |
| I-5 | Script local do consentimento (caminho A), se for o escolhido | revisão; não é executado pelo assistente | Não |

Garantias de que não há envio enquanto as credenciais não existirem:

1. **Sem credencial, não há o que chamar.** Com as três variáveis do Google ausentes, `saude` responde «credencial
   ausente» e `enviar` responde 503 antes de montar qualquer requisição.
2. **Modo `disabled` por padrão.** Variável ausente, vazia ou com valor desconhecido é lida como `disabled`. A função
   recusa com 403 antes de autenticar no Google.
3. **A suíte não tem rede.** Nenhum teste recebe `fetch` real; um teste varre os arquivos de teste para impedir
   chamada real ao Google.
4. **A tela não mostra o botão.** Com o servidor respondendo «indisponível», a aba de e-mail fica como está hoje:
   rascunho e atalho para o programa de e-mail.
5. **A migration não é aplicada** nessa fase. Sem a tabela do livro, a primeira coisa que o handler faz depois de
   autorizar (criar a entrega) falha, e por desenho nada é enviado quando o livro falha.

Só depois disso vêm, cada uma com autorização própria: aplicar a migration; a pessoa nomeada executar o §2; publicar;
`saude`; canário com lista fechada de endereços internos; modo `ativo`.

O que continua intocado em toda a E0 e nos passos I-1 a I-5: produção, banco, variáveis, a integração do site, a
reconciliação automática (desligada), as 11 submissões históricas (retidas) e os registros do ensaio.

---

## 6. Decisões (todas as que travavam o início estão fechadas)

Decisões da Direção de 11/11/2026 que fecham a preparação: **N-1** e **N-2** (implementação autorizada, com arquivo de
migration, sem aplicar e sem envio real), **N-3** (script local de consentimento), **D-4** (nome exibido
`EIFF <contato@eiff.com.br>`), **D-5** (assinatura: nome do atendente + EIFF) e **D-7** (30 envios por usuário e 100 por
organização por dia). Fechadas antes: **D-2** (quem pode enviar: Administrador e Diretoria) e **D-3** (quem administra o Google Workspace e executa o §1.2 e o §2: **Augusto Macedo**, decisão de 11/11/2026) e **D-1** (remetente: `contato@eiff.com.br`, que é **usuário com caixa própria**, conforme a verificação do §1.2 informada pelo Augusto em 11/11/2026; o consentimento OAuth é feito pela própria conta e não há trabalho extra de «Enviar como»). Falta só confirmar que a verificação em duas etapas da conta está ligada (passo 14 do §2).

Podem esperar a primeira entrega estar no ar: D-6 (e-mail devolvido e o SLA), D-8 (retenção e base legal, com o
jurídico), D-9 (ler respostas no CRM) e D-10 (endurecer o DMARC).

A implementação (E1 a E5) está nos PRs #80 a #85. O que resta para um envio de teste está no §7.

## 7. O que falta para o primeiro envio de teste (canário)

Cada linha é um portão com autorização própria. Nenhuma foi executada.

| # | Passo | Quem | Depende de |
|---|---|---|---|
| 1 | Mesclar os PRs da implementação (#80 a #85) | Direção autoriza, um a um | **Feito em 12/11/2026** (`main` `9e5de09`) |
| 2 | Aplicar a migration 0075 em produção | Direção autoriza | **Feito em 13/11/2026, 12:27** (`docs/email-comercial-0075-preflight.md` §9) |
| 3 | Executar o §2 (projeto, tela de consentimento, cliente, script, variáveis no Netlify com o modo `disabled`) | Augusto | procedimento assistido em `docs/email-comercial-google-workspace.md` |
| 4 | Publicar o EIFF Control (a função passa a existir, desligada) | Direção autoriza | passos 1 a 3 |
| 5 | `saude`: a credencial obtém token; nada é enviado | Augusto, na tela | passo 4 |
| 6 | Canário: `EIFF_INBOX_OUTBOUND_ENABLED=true`, `EIFF_EMAIL_SEND_MODE=canary`, lista com endereços INTERNOS, novo deploy | Direção autoriza | passo 5 |
| 7 | Um envio a um endereço interno; conferir De, SPF/DKIM/DMARC em «Mostrar original», pasta Enviados e a conversa | Augusto | passo 6 |

---

Afirmações deste roteiro que vêm do conhecimento do assistente e devem ser conferidas na tela do Google no momento da
configuração: o comportamento de «Enviar e-mail como» para apelido e para grupo; os nomes exatos dos menus do Admin
Console e do Cloud Console (o Google os renomeia com frequência); e a revogação do token na troca de senha.

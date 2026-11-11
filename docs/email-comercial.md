# E-mail comercial no EIFF Control — estudo técnico

**Situação: ESTUDO. Nada aqui está implementado, nenhum e-mail foi enviado e nenhuma credencial foi lida ou criada.**
Data do estudo: 11/11/2026. A implementação de qualquer etapa depende de autorização específica da Direção.

Objetivo: permitir que um usuário autorizado, de dentro da conversa de um lead no EIFF Inbox, **envie manualmente** um
e-mail a partir de uma caixa corporativa da EIFF, com confirmação explícita, registro na conversa certa e efeito correto
no SLA de primeira resposta. Candidato a remetente: `contato@eiff.com.br` (a confirmar, decisão D-1).

Fora do escopo, por princípio e não por etapa: envio automático, resposta por IA sem pessoa, campanha, disparo em massa,
rastreamento de abertura ou de clique.

Leitura relacionada: `docs/eiff-inbox.md` (§17, o que cumpre o SLA), `docs/formulario-site-go2-go3.md` (operação atual),
`docs/octadesk.md` e o item «Channel Provider 01» do `CLAUDE.md` (o desenho de entrega segura que este estudo reaproveita).

---

## 1. Resumo para a Direção

1. O e-mail de `eiff.com.br` é **Google Workspace**. O domínio já tem SPF, DKIM e DMARC publicados.
2. A forma recomendada é a **Gmail API** chamada por uma função do Netlify, autenticada por **OAuth da própria caixa
   remetente**, com permissão só de envio (`gmail.send`) na primeira entrega. A credencial fica só no painel do Netlify.
3. A primeira entrega é **só envio**. Receber respostas dentro do CRM é uma segunda entrega, separada, porque exige
   permissão de leitura da caixa inteira e uma migration própria. Até lá, a resposta do cliente continua chegando na caixa
   de e-mail, como hoje.
4. São necessárias **migrations** (livro de entregas e um novo código de provider). Nenhuma foi criada.
5. O e-mail enviado só conta como primeira resposta quando o **Google confirma que aceitou** a mensagem. Rascunho nunca
   conta. Resultado desconhecido (queda de rede no meio do envio) não conta e **nunca é reenviado sozinho**.
6. Há **dez decisões pendentes** da Direção (§14). As três que travam o início: qual caixa envia (D-1), quem pode enviar
   (D-2) e quem é o administrador do Google Workspace que fará a configuração (D-3).

---

## 2. Diagnóstico do provedor

Consultas públicas de DNS feitas em 11/11/2026 (resolvedores 8.8.8.8 e 1.1.1.1). Nenhum painel, conta ou segredo foi acessado.

| Registro | Valor publicado | Leitura |
|---|---|---|
| MX `eiff.com.br` | `1 smtp.google.com` | Recebimento pelo Google Workspace (formato de MX único do Google). |
| SPF (TXT) | `v=spf1 include:_spf.google.com ~all` | Só o Google está autorizado a enviar pelo domínio. `~all` é falha branda. |
| DKIM `google._domainkey` | chave RSA de 2048 bits presente | Assinatura DKIM do Google Workspace ativa para o domínio, seletor padrão `google`. |
| DMARC `_dmarc` | `v=DMARC1; p=none; rua=mailto:contato@eiff.com.br; adkim=s; aspf=s` | Só monitoramento (`p=none`), alinhamento **estrito** de SPF e DKIM, relatórios agregados indo para `contato@`. |
| Seletores `selector1`, `selector2`, `autodiscover` | ausentes | Não há Microsoft 365. |
| Seletores de outros serviços (`zoho`, `titan`, `hostinger`, `k1`, `s1`…) | ausentes | Nenhum outro serviço de envio assinando pelo domínio. |
| MTA-STS, TLS-RPT, BIMI | ausentes | Sem efeito para este projeto. |
| NS | `dns1–4.p0x.nsone.net` (Netlify DNS) | Qualquer mudança de DNS é feita no painel do Netlify. |

O que isso significa para o projeto:

- **Enviar pela própria caixa do Google passa em tudo.** A mensagem sai assinada pelo Google com `d=eiff.com.br` e pelo
  IP do Google, então SPF, DKIM e DMARC alinham, mesmo com alinhamento estrito.
- **Um serviço de envio de terceiros (Resend, SendGrid, Amazon SES…) exigiria DNS novo** e, com `adkim=s`/`aspf=s`,
  teria de assinar exatamente como `eiff.com.br` (subdomínio não alinha). É possível, mas é mais uma peça.
- **`p=none` não bloqueia quem falsifica o domínio.** Não impede este projeto, mas é uma fragilidade do domínio. Evoluir
  para `quarantine` depois de ler os relatórios é recomendação à parte (D-10).
- **A caixa `contato@` já recebe ruído de máquina**: os relatórios DMARC (`rua`) e as notificações de formulário do
  Netlify. A leitura de respostas (segunda entrega) precisa filtrar os dois.

O que o DNS **não** diz, e precisa ser respondido por quem administra o Workspace (D-1, D-3):

- se `contato@eiff.com.br` é um **usuário** com caixa própria, um **apelido** de outro usuário ou um **grupo**
  (grupo e apelido não fazem login; o envio teria de ser feito por um usuário com «enviar como»);
- qual é a edição do Workspace e quem é o superadministrador;
- se a verificação em duas etapas está ligada na conta.

---

## 3. Formas oficiais de envio e de recebimento

### 3.1 Envio

| Forma | Como autentica | Prós | Contras | Veredito |
|---|---|---|---|---|
| **Gmail API** `users.messages.send` (HTTPS) | OAuth 2.0 da caixa, escopo `gmail.send` | Só HTTPS (`fetch`), como as demais funções do projeto. Permissão mínima: só enviar. Devolve `id` e `threadId`. A mensagem aparece em **Enviados** da caixa. Revogável a qualquer momento no Google. | Exige um projeto no Google Cloud e um consentimento feito uma vez por quem é dono da caixa. | **Recomendada** |
| Gmail API com **conta de serviço e delegação em todo o domínio** | Chave ou identidade da conta de serviço | Sem consentimento manual da caixa. | A delegação permite agir como **qualquer** usuário do domínio dentro dos escopos concedidos. O próprio Google recomenda evitá-la quando OAuth do usuário resolve. Exige superadministrador. | Não recomendada para uma caixa só |
| SMTP `smtp.gmail.com` com **senha de app** | Senha estática de 16 caracteres | Simples. | A senha de app dá acesso **completo** ao e-mail da conta (ler e enviar por IMAP/SMTP), não tem escopo e exige verificação em duas etapas. É uma senha permanente num painel. Exige biblioteca SMTP nova na função. | Rejeitada |
| **SMTP relay** `smtp-relay.gmail.com` | IP fixo autorizado ou SMTP AUTH | Feito para sistemas. | Função do Netlify não tem IP fixo; cai no mesmo SMTP AUTH com senha. Pensado para volume, que não é o caso. | Rejeitada |
| Serviço de terceiros (Resend, SendGrid, SES) | Chave de API do serviço | API simples, webhooks de entrega. | Novo fornecedor recebendo dados pessoais de leads, DNS novo com alinhamento estrito, a mensagem **não** aparece em Enviados e a resposta continua chegando no Google: dois sistemas para a mesma conversa. | Rejeitada |

Limites do Google relevantes (documentação oficial; podem mudar): cerca de 2.000 mensagens por dia por usuário do
Workspace. O uso previsto é de poucas dezenas por dia, e o projeto impõe um teto próprio muito abaixo disso (§9.4).

### 3.2 Recebimento (para a segunda entrega)

| Forma | Como funciona | Observação |
|---|---|---|
| **Gmail API por consulta periódica** (`users.history.list` desde o último `historyId`) | Uma função agendada do Netlify lê o que mudou na caixa a cada poucos minutos | Sem endpoint público novo. Atraso de minutos. **Recomendada para começar.** |
| Gmail API com **aviso por Pub/Sub** (`users.watch`) | O Google avisa um tópico do Cloud Pub/Sub, que chama um endpoint nosso; o `watch` precisa ser renovado pelo menos a cada 7 dias | Quase em tempo real, mas acrescenta Pub/Sub, um endpoint público a proteger e uma rotina de renovação. Evolução possível depois. |
| IMAP | Conexão persistente | Não cabe em função sem servidor. Rejeitada. |
| Encaminhamento automático para um serviço de «inbound parse» | Regra no Gmail manda cópia para um terceiro | Terceiro recebendo todo o e-mail da caixa. Rejeitada. |

Ler a caixa exige o escopo `gmail.readonly`, que o Google classifica como **restrito**. Para um aplicativo OAuth do tipo
**Interno** (só usuários do próprio Workspace) não há processo de verificação do Google, mas a permissão continua sendo
ampla: quem tem o token lê **toda** a caixa. É a principal razão para separar a segunda entrega.

---

## 4. Escolha fundamentada

**Gmail API + OAuth da caixa remetente + escopo `gmail.send`, chamada por uma função do Netlify com handler puro.**

Por quê:

1. **Menor privilégio.** Na primeira entrega o sistema só consegue enviar. Não lê, não apaga, não muda configuração.
   Se a credencial vazar, o dano é envio indevido pela caixa, limitado pelo teto diário e revogável em um clique.
2. **Uma caixa, não o domínio.** O token vale para a caixa que consentiu. Não existe caminho para agir como outro
   usuário (a delegação em todo o domínio teria).
3. **Mesmo padrão do repositório.** `/api/comunicacao`, `/api/diretor-financeiro` e `/api/channel/octadesk` já são
   «função Netlify fina + handler puro em `src/core` + `fetch` injetado + zero chamada real na suíte». O e-mail entra
   igual, sem SDK novo: são duas chamadas HTTPS (trocar o token de atualização por um de acesso; enviar).
4. **A mensagem fica onde a equipe já olha.** Aparece em Enviados da caixa, no mesmo fio em que a resposta do cliente
   vai chegar. Nada muda para quem continuar usando o Gmail.
5. **Entregabilidade sem mexer em DNS.** SPF, DKIM e DMARC já alinham.

Custos e condições desta escolha:

- Alguém com acesso de administrador cria um projeto no Google Cloud, configura a tela de consentimento como
  **Interno** e cria um cliente OAuth (D-3). O dono da caixa remetente faz o consentimento **uma vez**.
- **Trocar a senha da caixa revoga o token** quando ele tem escopo do Gmail (regra do Google). O sistema precisa
  reconhecer isso como «credencial indisponível», não enviar nada e avisar. O procedimento de reemissão entra no runbook.
- Se `contato@` for grupo ou apelido, o consentimento é feito por um usuário real com «enviar como» configurado, e o
  remetente é validado contra os endereços que aquela conta pode usar (D-1).

---

## 5. Arquitetura

### 5.1 Onde encaixa

O EIFF Inbox já tem a fronteira certa: `ChannelProvider` em `src/core/inbox/fronteiras.ts`, hoje com um único
provider (`MANUAL`, que grava a resposta como rascunho `registrada` e não envia nada). O e-mail é um provider novo
dessa fronteira. A conversa, o SLA, a visibilidade e a tela não mudam de dono.

```
Tela (Leads do site / Inbox)                 Função Netlify                       Fora
────────────────────────────                 ──────────────                       ────
aba «E-mail»
  rascunho  ──────────────► actions.inboxResponder (como hoje: registrada, nada sai)

  [Enviar e-mail] → confirmação explícita
        │  POST /api/email-comercial
        │  { acao, threadId, assunto, corpo, intencao }   + JWT do usuário
        ▼
                             emailServidor.ts (handler puro)
                             1 chaves de segurança (modo, lista do canário, teto)
                             2 JWT → perfil ativo → organização → permissão
                             3 Server Truth: conversa e contato lidos do BANCO
                             4 validação do pedido
                             5 livro de entregas: READY → REQUESTED       (RPC, service_role)
                             6 token de acesso ─────────────────────────► oauth2.googleapis.com
                             7 messages.send ───────────────────────────► gmail.googleapis.com
                             8 resultado → livro + mensagem + SLA          (RPC, uma transação)
        ◄── { estado, entregaId, mensagemId? }
```

Regra de ouro herdada do projeto: **a tela pede, o servidor decide, o banco registra**. O navegador nunca escolhe
destinatário nem remetente, nunca vê token e nunca escreve no livro de entregas.

### 5.2 Passo a passo do envio

1. **Três chaves de segurança, todas no servidor.** `EIFF_EMAIL_SEND_MODE` (`disabled` por padrão, `canary`, `ativo`),
   lista de destinatários do canário (`EIFF_EMAIL_CANARY_RECIPIENTS`) e teto diário. Em `disabled` a função responde
   403 `envio_desligado` antes de ler qualquer outra coisa. `EIFF_INBOX_OUTBOUND_ENABLED` do Inbox continua existindo e
   passa a ser exigida também: hoje ela é sempre `false` em `ativacao.ts`, e mudá-la é parte da ativação autorizada.
2. **Quem pede.** JWT do Supabase → perfil ativo → organização → permissão de enviar e-mail (D-2), pelo mesmo
   `autenticar` das outras funções. Nada de papel vindo do navegador.
3. **Server Truth.** O servidor lê a conversa e o contato **com o JWT do usuário**, então a RLS do Inbox já garante que
   só envia quem enxerga a conversa. O destinatário é o e-mail do contato **no banco** (identidade `PORTAL` ou `EMAIL`).
   O remetente vem de variável de ambiente. Qualquer campo de destinatário ou remetente no pedido é 400.
4. **Validação.** Conversa aberta e de contexto `EXTERNAL`; um destinatário; sem CC, CCO ou anexo na primeira entrega;
   assunto e corpo dentro do tamanho (o corpo respeita o limite de 20.000 caracteres de `inbox_message.body`); assunto
   sem quebra de linha (injeção de cabeçalho é recusa, não limpeza silenciosa); só texto puro.
5. **Livro primeiro («delivery first»).** Antes de qualquer chamada ao Google, o servidor cria a entrega `READY` e a
   leva a `REQUESTED` por RPC exclusiva do `service_role`. Se isso falhar, nada é enviado. Se a entrega já existir para
   a mesma intenção (duplo clique, reenvio da fila), devolve o resultado original e **não** chama o Google de novo.
6. **Token de acesso.** Troca do token de atualização por um de acesso, válido por cerca de uma hora, guardado só na
   memória daquela execução. Falha aqui é 503 `credencial_indisponivel`, entrega `FAILED`, nada enviado.
7. **Envio.** Uma chamada `POST gmail/v1/users/me/messages/send` com a mensagem MIME montada pelo servidor (§7).
   Sem nova tentativa automática: `maxRetries = 0`, tempo limite curto, dentro do orçamento da função.
8. **Resultado, numa transação.** Uma RPC grava, juntas, a transição da entrega, a mensagem na conversa e o efeito no SLA:

| O que o Google respondeu | Entrega | Mensagem na conversa | SLA |
|---|---|---|---|
| 200 com `id` e `threadId` | `ACCEPTED` | `outbound`, entrega `enviada`, `external_message_id` = id do Gmail | cumpre, se for a primeira resposta |
| Recusa definitiva (4xx de validação, destinatário inválido, limite do Google) | `FAILED` com código de catálogo | nenhuma; o rascunho continua; evento no histórico | não cumpre |
| Tempo esgotado, rede, 5xx, 2xx sem `id` | `UNKNOWN` | nenhuma por enquanto | não cumpre |

`UNKNOWN` é o caso «o Google pode ter aceitado e nós perdemos a resposta». **Nunca é reenviado automaticamente.**
Na primeira entrega a reconciliação é humana: a tela pede para conferir a pasta Enviados da caixa e oferece
«Encontrei em Enviados» (vira `ACCEPTED`, com quem declarou e quando) ou «Não foi enviado» (vira `FAILED` e libera
novo envio). «Não foi enviado» pede uma **segunda confirmação**: a janela explica que uma declaração errada faz o
cliente receber o e-mail em dobro, e o botão só libera depois de a pessoa marcar que conferiu a pasta Enviados; o
servidor recusa (400) o pedido que chegar sem essa confirmação, e a declaração fica no livro com quem declarou. A reconciliação automática, comparando o `Message-ID` que o próprio servidor gerou, fica para a segunda
entrega, quando a permissão de leitura existir de qualquer forma.

### 5.3 Peças novas (nenhuma criada neste estudo)

| Peça | Onde | Papel |
|---|---|---|
| `src/core/inbox/emailMensagem.ts` | core puro | Montagem e validação do MIME, sanitização, `Message-ID` próprio. |
| `src/core/inbox/emailServidor.ts` | core puro, `fetch` e portas injetados | O handler: chaves, autorização, Server Truth, livro, envio, classificação da falha. |
| `src/core/inbox/emailPorta.ts` | core | Portas PostgREST/RPC e o cliente HTTP do Google (único lugar que conhece as URLs do Google). |
| `netlify/functions/email-comercial.ts` | função | Invólucro fino, como `comunicacao.ts`. |
| Migration (número a definir na hora; a última no repositório é a 0074) | banco | Livro de entregas, eventos, RPCs, novo código de provider. |
| Aba «E-mail» de `LeadsSite.tsx` e composer do `Inbox.tsx` | tela | Botão de envio com confirmação e os estados da entrega. |

---

## 6. Desenho das APIs

### 6.1 `POST /api/email-comercial`

Cabeçalho `Authorization: Bearer <JWT do Supabase>`. Corpo com **chaves fechadas** (qualquer outra é 400):

```json
{ "acao": "enviar", "threadId": "<uuid da conversa>", "assunto": "…", "corpo": "…", "intencao": "<uuid gerado na tela antes do primeiro clique>" }
```

Outras ações, mesmas regras de autenticação:

| `acao` | Corpo | Para quê |
|---|---|---|
| `preparar` | `{ threadId }` | Diz à tela se o envio está disponível para aquela conversa e aquele usuário: modo, remetente que será usado, destinatário **completo** (só chega aqui quem tem a permissão de envio e enxerga a conversa pela RLS; nunca vai para log), motivo quando indisponível. Não chama o Google. |
| `enviar` | acima | Envia. |
| `reconciliar` | `{ entregaId, desfecho: "encontrado" }` ou `{ entregaId, desfecho: "nao_enviado", confirmacao }` | Decisão humana sobre uma entrega `UNKNOWN`. «Não enviado» sem a confirmação explícita é 400. |
| `saude` | `{}` | Só para quem configura: a credencial consegue obter token de acesso? Não envia nada. |

Resposta de `enviar`:

```json
{ "estado": "ACCEPTED", "entregaId": "…", "mensagemId": "…", "enviadaEm": "2026-…Z", "cumpriuPrimeiraResposta": true }
```

Erros, em catálogo fechado (a mensagem ao usuário vem do catálogo; texto do Google nunca é repassado nem registrado):

| HTTP | `erro` | Quando |
|---|---|---|
| 400 | `pedido_invalido` | Chave desconhecida, assunto com quebra de linha, corpo vazio ou grande demais. |
| 401 | `nao_autenticado` | JWT ausente ou inválido. |
| 403 | `sem_permissao` · `envio_desligado` · `destino_nao_autorizado` | Papel sem permissão; modo `disabled`; modo `canary` e destinatário fora da lista. |
| 404 | `conversa_nao_encontrada` | Inexistente ou invisível para o usuário (a RLS decide; a resposta é a mesma). |
| 409 | `conversa_fechada` · `intencao_reutilizada` · `entrega_pendente` | Fechada; mesma intenção com outro conteúdo; já existe entrega `REQUESTED`/`UNKNOWN` para a conversa. |
| 422 | `sem_email_valido` | O contato não tem e-mail utilizável. |
| 429 | `limite_atingido` | Teto diário do usuário ou da organização. |
| 502 | `provedor_recusou` | Recusa definitiva do Google. Entrega `FAILED`. |
| 503 | `credencial_indisponivel` | Token revogado, vencido ou ausente. Nada enviado. |
| 200 | `estado: "UNKNOWN"` | Resultado desconhecido. Não é erro de pedido: é um estado que a tela precisa mostrar. |

### 6.2 Banco (a criar por migration, com autorização)

- **`inbox_email_delivery`** — o livro. Uma linha por intenção de envio: organização, conversa, contato, quem pediu,
  chave de idempotência (única por organização), impressão do pedido (SHA-256 de destinatário + assunto + corpo, para
  recusar a mesma intenção com outro conteúdo), `Message-ID` gerado, id e fio do Gmail quando houver, estado
  (`READY`, `REQUESTED`, `ACCEPTED`, `FAILED`, `UNKNOWN`, e `BOUNCED` na segunda entrega), código de erro de catálogo,
  instantes. **Sem** assunto, corpo ou endereço em claro: o conteúdo vive na mensagem do Inbox, o endereço no contato.
- **`inbox_email_delivery_event`** — trilha somente de inserção, com quem pediu e quem transicionou
  (`USER`, `SERVER`, `SYSTEM`).
- **RPCs só para `service_role`**: criar a entrega; transicionar (máquina de estados no banco, terminais sem
  regressão); e a de aceite, que grava entrega + mensagem + SLA numa transação.
- **`authenticated` só lê**, e só as entregas de conversas que enxerga (política por `EXISTS` na conversa, como os
  demais filhos do Inbox).
- **Provider novo.** `inbox_message.provider` tem `CHECK (provider in ('MANUAL','OCTADESK','META_CLOUD'))` e o
  catálogo `PROVIDERS` de `src/core/radar/canais.ts` tem os mesmos três. O e-mail precisa de um código próprio
  (proposta: `GOOGLE_WORKSPACE`) nos dois lugares.
- **Segunda entrega**: `inbox_email_sync_state` (caixa, último `historyId`, última leitura) e uma forma de ingerir a
  resposta **na conversa indicada** (hoje `inbox_ingest` escolhe a conversa por identidade + canal + contexto; a
  resposta por e-mail a um lead do site precisa cair na conversa `PORTAL` de origem, não numa conversa `EMAIL` nova).

É o mesmo desenho das migrations 0045 a 0048 (livro de entregas do Radar), aplicado ao Inbox: autoridade só no
servidor, comando imutável, ator real, idempotência própria.

### 6.3 Variáveis de ambiente (só no painel do Netlify; nenhuma com prefixo `VITE_`)

| Variável | Conteúdo | Segredo? |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Cliente OAuth do projeto no Google Cloud | não, mas fica no servidor |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Segredo do cliente | **sim** |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Token de atualização da caixa remetente | **sim** |
| `EIFF_EMAIL_SENDER` | Endereço remetente | não |
| `EIFF_EMAIL_SEND_MODE` | `disabled` (padrão) · `canary` · `ativo` | não |
| `EIFF_EMAIL_CANARY_RECIPIENTS` | Destinatários permitidos no canário | não, mas nunca devolvida ao navegador |
| `EIFF_EMAIL_DAILY_LIMIT_USER` · `EIFF_EMAIL_DAILY_LIMIT_ORG` | Tetos | não |

A função já existente precisa de `SUPABASE_SERVICE_ROLE_KEY` para as RPCs do livro, como as demais.

---

## 7. Contrato da mensagem

Montada **só no servidor**, em texto puro:

| Cabeçalho | Valor | Regra |
|---|---|---|
| `From` | `EIFF <contato@eiff.com.br>` ou `Nome · EIFF <…>` (D-4) | Do ambiente e do perfil do banco. Nunca do navegador. |
| `To` | o e-mail do contato no banco | Um só. |
| `Reply-To` | a própria caixa remetente | A resposta volta para onde a equipe e, depois, o CRM leem. |
| `Subject` | o assunto digitado | Sem quebra de linha. Em resposta a um fio existente, o assunto do fio é preservado. |
| `Message-ID` | `<uuid-da-entrega@eiff.com.br>` | Gerado por nós: é a chave de reconciliação e de associação da resposta. |
| `In-Reply-To` / `References` | o `Message-ID` da mensagem anterior do fio | Só quando é continuação de um fio já existente. |
| `Date`, `MIME-Version`, `Content-Type: text/plain; charset=UTF-8` | — | Padrão. |

O corpo é o que o usuário escreveu e confirmou, seguido da assinatura (D-5). O sistema **não** acrescenta imagem
invisível, link de rastreamento nem identificador interno visível. Na primeira entrega não há HTML nem anexo.

Como a mensagem enviada fica na conversa do Inbox:

```
direcao: outbound · tipo: texto · provider: GOOGLE_WORKSPACE · entrega: enviada
autor: o usuário autenticado que confirmou
texto: «Assunto: …» + corpo (o que foi efetivamente enviado, imutável pelo trigger existente)
external_message_id: id do Gmail
meta: { canalSaida: "EMAIL", entregaId, gmailThreadId, rfcMessageId }   ← só identificadores, como o CHECK da 0056 exige
```

A projeção da tela já entende isso: `ehRespostaEfetiva` considera `enviada` como resposta, e o histórico de
`leadsSite.ts` mostra o item como «Resposta enviada».

---

## 8. Receber e associar respostas (segunda entrega)

Fluxo proposto: função agendada do Netlify, a cada poucos minutos, chama `users.history.list` a partir do último
`historyId`, busca as mensagens novas da Caixa de entrada e decide o destino de cada uma.

**O que é ignorado antes de qualquer coisa:**

- mensagens enviadas pela própria caixa (marcador `SENT`, ou `Message-ID` que está no nosso livro);
- relatórios DMARC e respostas automáticas (`Auto-Submitted`, `Precedence: bulk`);
- **notificações de formulário do Netlify**: a submissão já entra pela integração do formulário; ingerir o e-mail de
  aviso duplicaria o lead;
- devoluções (`mailer-daemon`): não viram mensagem de cliente, viram **falha da entrega** correspondente (§10).

**Como a resposta acha a conversa, nesta ordem:**

1. o `threadId` do Gmail está no livro de entregas → a conversa daquela entrega;
2. `In-Reply-To` ou `References` cita um `Message-ID` nosso → a conversa daquela entrega;
3. o remetente é o e-mail de um contato com **uma** conversa aberta → essa conversa, marcada «associada pelo remetente»;
4. nenhum dos anteriores, ou mais de uma candidata → conversa nova de canal `EMAIL`, em triagem humana. Nunca se
   escolhe uma conversa por semelhança de assunto.

A ingestão usa a deduplicação que já existe (`(organização, provider, external_message_id)` único), com o id da
mensagem do Gmail como chave: a mesma mensagem lida duas vezes entra uma vez.

Por que isso é uma entrega separada: exige `gmail.readonly` (ler a caixa inteira), guarda no banco texto que o cliente
escreveu por e-mail (retenção e LGPD, D-8), precisa de migration própria e tem um modo de falha novo (associar a
resposta à conversa errada). Enquanto ela não existir, a resposta do cliente chega na caixa de e-mail como hoje, e o
vendedor registra o contato pela ação que já existe.

---

## 9. Segurança, dados pessoais e permissões

### 9.1 Credenciais

- Só no painel do Netlify. Nunca em repositório, `VITE_`, banco, log, auditoria, resposta HTTP ou mensagem de erro.
- Erros passam por `src/core/erroSeguro.ts`: operação e código de catálogo, nunca o texto bruto da exceção
  (lição do PR #76).
- Log de envio só com: operação, estado, código de erro de catálogo, HTTP, latência, ids internos. Sem destinatário,
  assunto ou corpo.
- **Revogação**: remover o acesso do aplicativo na conta Google da caixa, ou apagar o cliente OAuth. O efeito é
  imediato; o sistema passa a responder `credencial_indisponivel`.
- **Rotação**: novo consentimento, troca da variável no painel, novo deploy. Entra no runbook da ativação.
- A função é a **única** que toca o Google. Um teste varre `src/` para garantir que nenhum código de tela importa o
  módulo de porta nem cita as URLs do Google (como o teste que já existe para as RPCs do Radar).

### 9.2 Dados pessoais

- O destinatário é quem preencheu o formulário pedindo contato. A base legal mais direta é a execução de
  procedimentos preliminares a contrato a pedido do titular (LGPD, art. 7º, V). **É uma leitura técnica, não parecer
  jurídico** (D-8).
- Não há operador novo: o e-mail já está no Google Workspace e a conversa já está no Supabase.
- O livro de entregas não guarda endereço nem conteúdo. A auditoria guarda tamanho e impressão, não o texto.
- `preparar` devolve o endereço completo do destinatário **somente** a quem tem a permissão `enviar_email` e enxerga a
  conversa (leitura com o JWT do usuário, RLS): é o que a pessoa confere na confirmação final. A linha de apoio da
  tela continua mascarada e o endereço nunca entra em log.
- **Para qual endereço a conversa responde** (`resolverDestinatario`, revisão de 11/11/2026): vale o endereço do
  CANAL DA CONVERSA — lead do formulário do site responde ao e-mail informado no formulário, mesmo que o contato tenha
  outra identidade de e-mail. Não há preferência entre identidades: dois endereços possíveis sem critério seguro é
  `destinatario_ambiguo` e nada é enviado até o contato ser corrigido.
- O pedido de envio devolve ao servidor o endereço que a pessoa conferiu (`destinatario`). Esse campo **não escolhe**
  o destino: o servidor resolve o endereço no banco e só segue se for o mesmo; se divergir, responde
  `destinatario_mudou` antes de criar a entrega.

### 9.3 Permissões

- Proposta: ação nova na MATRIZ do Control, `enviar_email`, separada de `inbox`. Ver a conversa não implica poder
  falar em nome da empresa (D-2).
- Além da ação: só envia quem **enxerga** a conversa (RLS), e a conversa tem de estar aberta.
- Sugestão de partida: Administrador e Diretoria. O papel comercial entra quando existir.

### 9.4 Contra envio em massa

- A API recebe **uma** conversa e envia para **um** destinatário. Não existe ação de lista, modelo em lote nem agendamento.
- Teto por usuário e por organização por dia, contado no livro (proposta inicial: 30 e 100).
- Uma entrega `REQUESTED` ou `UNKNOWN` na conversa bloqueia novo envio nela até ser resolvida.
- Um teste prende que o handler faz **no máximo uma** chamada de envio por pedido.

---

## 10. Falhas, tentativas, duplicações e auditoria

| Situação | O que acontece |
|---|---|
| Duplo clique, ou a tela reenvia o mesmo pedido | Mesma `intencao` → mesma entrega → resultado original. Nenhum segundo e-mail. |
| Mesma `intencao` com assunto ou corpo diferente | 409 `intencao_reutilizada`. A impressão do pedido não confere. |
| O usuário edita e quer enviar de novo | Intenção nova, entrega nova. É outro e-mail, por decisão explícita. |
| Falha antes de chamar o Google | `FAILED`, nada saiu, pode tentar de novo (intenção nova). |
| Recusa definitiva do Google | `FAILED` com código de catálogo. O rascunho fica. |
| Tempo esgotado ou rede no meio do envio | `UNKNOWN`. Sem reenvio automático. Reconciliação humana (primeira entrega) ou por `Message-ID` (segunda). |
| O Google aceitou e o e-mail voltou depois (endereço inexistente) | Só visível na segunda entrega: a devolução vira `BOUNCED`, a mensagem passa a `falhou` e a conversa ganha um aviso. O efeito no SLA é a decisão D-6. |
| Credencial revogada (inclusive por troca de senha da caixa) | 503, nada enviado, aviso para quem configura. |
| Envio feito, gravação da mensagem falha | Não acontece em separado: aceite, mensagem e SLA são uma transação. Se a transação falhar depois do 200 do Google, a entrega fica `REQUESTED` com o id do Gmail anotado na trilha e a reconciliação a conclui, sem reenvio. |

Auditoria, em três lugares que já existem ou seguem padrão existente:

- trilha da entrega (`inbox_email_delivery_event`): cada transição, com ator real;
- histórico da conversa (`inbox_thread_event`): «e-mail enviado», «envio falhou», «resultado desconhecido», sem conteúdo;
- `audit_log`: ação, conversa, entrega, estado, tamanho. Nunca texto.

---

## 11. Relação com o SLA de primeira resposta

A regra não muda (`docs/eiff-inbox.md` §17): só **contato efetivamente realizado** cumpre.

| Fato | Cumpre? |
|---|---|
| Rascunho de e-mail registrado na conversa | Não. |
| Clique em «Enviar», entrega `READY` ou `REQUESTED` | Não. |
| Google confirmou o aceite (`ACCEPTED`) | **Sim**, com o instante do aceite. É o «envio por canal» que `ehRespostaEfetiva` já prevê. |
| Resultado desconhecido (`UNKNOWN`) | Não, até a reconciliação. Se confirmado, vale o instante do pedido original. |
| Falha (`FAILED`) | Não. |
| E-mail aberto no programa do vendedor pelo atalho `mailto:` | Não por si. Cumpre quando a pessoa **declara** o contato (`inboxRegistrarContato`), como hoje. |
| E-mail devolvido depois do aceite | Decisão D-6. Recomendação: deixa de cumprir, porque não houve contato. |

Limite que precisa ficar dito: «aceito pelo Google» significa que a mensagem saiu da EIFF, não que o cliente leu.
É o mesmo grau de certeza de um e-mail enviado à mão.

---

## 12. Interface

Na aba «E-mail» da tela Leads do site (e no composer do Inbox, quando o destinatário tiver e-mail):

1. Ao abrir, a tela chama `preparar`. Se o envio não estiver disponível, a aba fica exatamente como hoje (rascunho e
   atalho `mailto:`), com o motivo em uma linha.
2. Disponível: aparece **«Enviar e-mail»** ao lado de «Registrar rascunho».
3. O clique abre uma **confirmação** com De, Para, Assunto e o texto completo: «Este e-mail será enviado agora para
   m•••@empresa.com.br a partir de contato@eiff.com.br. Não é possível desfazer.» Botões «Enviar agora» e «Voltar».
4. Estados depois do envio, sempre na própria conversa:
   - **Enviado**: «Enviado às 14:32. O Google confirmou o aceite.» O item entra no histórico como resposta enviada.
   - **Não enviado**: motivo de catálogo em linguagem humana; o texto continua no campo.
   - **Resultado desconhecido**: «Não sabemos se este e-mail saiu. Não envie de novo. Confira a pasta Enviados de
     contato@.» com «Encontrei em Enviados» e «Não foi enviado…» (este abre a janela de segunda confirmação).
5. Enquanto houver entrega sem desfecho na conversa, o botão de enviar fica indisponível, dizendo por quê.

Nada de «enviar para vários», modelos em lote ou agendamento.

---

## 13. Riscos

| Risco | Gravidade | Como o desenho trata |
|---|---|---|
| E-mail para a pessoa errada | Alta | Destinatário só do banco, um por envio, confirmação mostrando para quem vai, canário com lista fechada antes de abrir. |
| E-mail duplicado | Alta | Livro primeiro, idempotência por intenção, `UNKNOWN` sem reenvio, bloqueio por entrega pendente. |
| Vazamento do token | Alta | Escopo só de envio na primeira entrega, só no Netlify, tetos diários, revogação imediata. |
| Envio em nome da empresa por quem não deveria | Alta | Permissão própria, RLS da conversa, autor gravado, auditoria. |
| Conteúdo indevido (promessa técnica ou comercial) | Média | Fora do alcance do sistema: o texto é da pessoa. Envio só manual; nenhum texto gerado sai sem leitura. Vale a regra já escrita na conversa: o texto automático do site não é parecer de engenharia. |
| Troca de senha da caixa derruba o envio | Média | Falha fechada (`credencial_indisponivel`), aviso, procedimento de reemissão no runbook. |
| `contato@` não ser um usuário | Média | Pergunta D-1 antes de qualquer configuração. |
| SLA cumprido por e-mail que voltou | Média | Só detectável com a segunda entrega; decisão D-6. Até lá o risco é declarado. |
| Resposta associada à conversa errada | Média | Só na segunda entrega; associação por identificadores, nunca por assunto; ambiguidade vai para triagem. |
| Mais uma dependência externa (Google Cloud) | Baixa | Só duas chamadas HTTPS, sem SDK; modo `disabled` devolve o sistema ao estado de hoje. |
| Reputação do domínio | Baixa | Volume baixo, 1:1, a pedido do destinatário, pela própria caixa. |

---

## 14. Decisões pendentes da Direção

| # | Decisão | Recomendação do estudo |
|---|---|---|
| D-1 | Qual caixa envia, e ela é usuário, apelido ou grupo? | `contato@eiff.com.br`, se for usuário com caixa própria. Se for grupo, definir o usuário que envia como `contato@`. |
| D-2 | Quem pode enviar | Permissão nova `enviar_email`; Administrador e Diretoria no início. |
| D-3 | Quem administra o Google Workspace e fará a configuração (projeto, tela de consentimento Interna, cliente OAuth, consentimento da caixa, variáveis no Netlify) | Uma pessoa nomeada, com roteiro escrito. O assistente não cria conta nem digita credencial. |
| D-4 | Nome exibido do remetente | `EIFF <contato@…>` na primeira entrega; nome da pessoa na assinatura. |
| D-5 | Assinatura padrão e se haverá aviso de privacidade no rodapé | Assinatura curta por usuário; aviso a critério do jurídico. |
| D-6 | E-mail aceito pelo Google e devolvido depois: o SLA continua cumprido? | Não: deixa de cumprir e a conversa avisa. |
| D-7 | Tetos diários | 30 por usuário e 100 por organização. |
| D-8 | Retenção das mensagens e validação jurídica da base legal | Mesma retenção das demais mensagens do Inbox; confirmar a base legal com o jurídico. |
| D-9 | Autorizar a segunda entrega (ler a caixa, escopo `gmail.readonly`) e quando | Só depois de a primeira estar estável. Consulta periódica antes de Pub/Sub. |
| D-10 | Endurecer o DMARC de `p=none` para `quarantine` | Sim, depois de algumas semanas lendo os relatórios. Independe deste projeto. |

---

## 15. Plano de testes

**Automáticos (nenhuma chamada real ao Google na suíte; `fetch` sempre simulado):**

- Montagem da mensagem: cabeçalhos, UTF-8, `Message-ID` próprio, continuação de fio, recusa de quebra de linha no
  assunto, limites de tamanho, texto puro.
- Handler: cada chave de segurança sozinha recusa (`disabled`, canário com destinatário fora da lista, teto);
  autenticação e permissão; chaves desconhecidas no pedido; destinatário e remetente nunca vêm do pedido.
- Server Truth: conversa de outra organização, invisível, fechada, de contexto interno, contato sem e-mail.
- Livro primeiro: falha ao criar a entrega → zero chamada ao Google. Entrega existente → zero chamada ao Google.
- Classificação do resultado: 200 com id; 4xx definitivo; 401 da credencial; tempo esgotado; 5xx; 2xx sem id.
  Em cada caso, conferir **se houve ou não** chamada de envio, e quantas (no máximo uma).
- SLA: só `ACCEPTED` preenche a primeira resposta; rascunho, `FAILED` e `UNKNOWN` não.
- Não vazamento: nenhum log, erro, auditoria ou resposta contém token, destinatário, assunto ou corpo.
- Fronteira: nenhum arquivo de tela importa a porta do Google; nenhuma variável `VITE_` nova; a função empacota sem
  `import.meta.env`.
- Projeção: o histórico mostra «Resposta enviada» com `cumpreSla` verdadeiro.

**Banco (PostgreSQL real, como os demais `smoke:*`, e no Quality Gate):**

- máquina de estados da entrega, terminais sem regressão;
- `authenticated` não insere nem altera o livro, nem chama as RPCs;
- unicidade da chave de idempotência; impressão divergente recusada;
- aceite grava entrega + mensagem + SLA numa transação e desfaz tudo se uma parte falhar;
- RLS: só lê entregas de conversas visíveis.

**Manuais, em ambiente autorizado, na ordem:**

1. `saude`: a credencial obtém token; nada é enviado.
2. Canário para um endereço interno da EIFF: chega; em «Mostrar original» SPF, DKIM e DMARC passam; aparece em
   Enviados; a conversa mostra «enviado» com o autor certo.
3. Duplo clique: um e-mail só.
4. Destinatário fora da lista do canário: recusado, nada sai.
5. Simulação de resultado desconhecido (credencial válida, tempo limite forçado): a tela não oferece reenvio.
6. Revogação do acesso na conta Google: o sistema falha fechado.
7. Só então um envio real a um lead, com a Direção acompanhando.

---

## 16. Plano de implementação em etapas

Cada etapa é um PR próprio e para em um portão. Nenhuma começa sem autorização.

| Etapa | Entrega | Toca produção? | Portão |
|---|---|---|---|
| E0 | Decisões D-1 a D-5 e D-7; roteiro de configuração do Google para a pessoa nomeada | Não | Decisões registradas |
| E1 | Core puro: mensagem, handler, classificação, testes. Sem função publicada | Não | Suíte e revisão |
| E2 | Migration do livro de entregas + RPCs + provider novo + `smoke` em PostgreSQL | Não (migration **não** aplicada) | Revisão da migration |
| E3 | Função `/api/email-comercial` e tela, com o modo `disabled` | Não muda comportamento | MERGE AUTORIZADO |
| E4 | Aplicar a migration; configurar Google e variáveis (feito por pessoa); publicar; `saude` | Sim, sem envio | Autorização de produção |
| E5 | Canário: lista fechada de endereços internos | Sim, e-mails internos | Autorização específica |
| E6 | Modo `ativo` para os usuários autorizados | Sim | Autorização específica (equivalente a um GO) |
| E7 | Segunda entrega: leitura da caixa por consulta periódica, associação de respostas, devoluções, reconciliação automática | Sim | Decisão D-9 e novo ciclo E1–E6 |
| E8 | Opcional: anexos, HTML, aviso por Pub/Sub | Sim | Demanda real |

O que **não** muda em nenhuma etapa: a reconciliação automática do formulário continua desligada, as 11 submissões
históricas continuam retidas, os registros do ensaio continuam preservados e o site (`eiff-site`) não é tocado.

---

## 17. O que já existe hoje (sem este projeto)

A tela Leads do site (PR #77) já cobre o caminho manual, sem nenhuma integração:

- o vendedor escreve o e-mail na aba «E-mail», registra o **rascunho** na conversa (não conta para o SLA);
- «Abrir no meu programa de e-mail» abre um `mailto:` com assunto e corpo preenchidos;
- depois de enviar pelo próprio programa, «Já enviei: registrar contato» leva ao registro de **contato realizado por
  e-mail**, que é o que cumpre o prazo, com autor, instante declarado e instante do registro.

Este estudo descreve como trocar o `mailto:` por um envio feito e confirmado pelo próprio sistema.

---

## Fontes

Documentação oficial do Google, consultada em 11/11/2026:

- [Gmail API: criar e enviar mensagens](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Gmail API: fios de conversa (`threadId`, `In-Reply-To`, `References`)](https://developers.google.com/workspace/gmail/api/guides/threads)
- [Gmail API: recurso `users.messages`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Gmail API: escopos e classificação (sensível, restrito)](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail API: avisos por Pub/Sub e renovação do `watch`](https://developers.google.com/workspace/gmail/api/guides/push)
- [Google Workspace: boas práticas de delegação em todo o domínio](https://support.google.com/a/answer/14437356?hl=en)
- [Google Workspace: controlar acesso à API com delegação em todo o domínio](https://support.google.com/a/answer/162106?hl=en)
- [OAuth 2.0 para aplicações de servidor (conta de serviço)](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Google Workspace: enviar e-mail de impressora, scanner ou aplicativo (SMTP)](https://support.google.com/a/answer/176600?hl=en)
- [Google Workspace: serviço de SMTP relay](https://support.google.com/a/answer/2956491?hl=en)
- [Google Workspace: limites de envio do Gmail](https://support.google.com/a/answer/166852?hl=en)

Itens afirmados com base no conhecimento do assistente, **a conferir na documentação no momento da implementação**:
a revogação do token de atualização com escopo do Gmail quando a senha da conta muda; a dispensa de verificação do
Google para aplicativo OAuth do tipo Interno; e os números exatos de limite de envio.

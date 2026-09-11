# Chatwoot — avaliação e preparação (EIFF Central)

Levantado em 10/09/2026 na documentação oficial (`developers.chatwoot.com`, `www.chatwoot.com/hc/user-guide`,
`www.chatwoot.com/pricing`, changelog oficial e o repositório `chatwoot/chatwoot`). **Nada aqui foi assumido de
memória**; onde a documentação não diz, está escrito "a documentação não diz".

Esta fase **não implementa nada**: não há adapter, função Netlify, migration nem teste de Chatwoot. O documento
existe para que a decisão de adotar (ou não) seja tomada com o contrato real na mão, e para que o Chatwoot nunca
bloqueie o MVP da Central com a Meta direta.

A ADR vigente é a de `docs/eiff-central.md`: **o Chatwoot, se entrar, entra como caixa de entrada humana atrás do
adapter `ConversationInboxProvider`**, nunca como CRM, banco mestre, motor financeiro, motor comercial, sistema de
permissões ou motor de IA. Este documento respeita essa decisão e a testa contra a API real.

---

## 1. O que o Chatwoot é

Aplicação Ruby on Rails de atendimento multicanal (help desk / caixa de entrada compartilhada), com edição
comunitária sob licença MIT e uma edição enterprise proprietária no mesmo repositório. Resolve bem um problema
que a EIFF **ainda não tem**: várias pessoas atendendo o mesmo canal ao mesmo tempo, com fila, times, atribuição,
histórico e SLA.

O que ele **não** resolve, e que é o núcleo do EIFF Control: regra de negócio determinística, permissões por papel,
alçadas, auditoria financeira, motor de caixa e o rito de aprovação → entrega das comunicações do Radar.

---

## 2. Arquitetura self-hosted e custo operacional

### Componentes reais

A documentação de produção lista como serviços obrigatórios:

| Componente | Papel | Observação da documentação |
| --- | --- | --- |
| Chatwoot **web servers** | aplicação Rails (UI + API) | atrás de proxy; os containers "only bind to the localhost" |
| Chatwoot **workers** | Sidekiq (jobs, webhooks de saída, e-mail) | "recommended to keep the worker process and rails server on separate webservers" |
| **PostgreSQL** | banco | "PostgreSQL only (no alternatives planned)"; versões estáveis recentes |
| **Redis** | cache e fila do Sidekiq | "Redis version 7.0 or higher is recommended" |
| **SMTP / SendGrid / Mailgun** | e-mail transacional | listado como componente obrigatório |
| **Object Storage** (S3, Azure, GCS) | anexos | listado como componente obrigatório |

O `docker-compose` oficial de produção sobe `rails`, `sidekiq`, `postgres` e `redis`, com `SECRET_KEY_BASE`,
`FRONTEND_URL`, `POSTGRES_*` e `REDIS_URL`. A própria documentação sugere trocar Postgres e Redis por serviços
gerenciados via variável de ambiente.

Detalhe operacional que morde: o Nginx de exemplo exige `underscores_in_headers on`, porque o header de
autenticação da API é `api_access_token` — com underscore, que o Nginx descarta por padrão. Um proxy mal
configurado devolve 401 sem explicar por quê.

### Requisitos declarados

| Recurso | Documentado |
| --- | --- |
| CPU | "4 cores is the recommended minimum number of cores and supports up to 10,000 conversations a day" (8 cores → 20.000) |
| RAM | "4GB RAM is the required minimum memory size"; +1 GB de swap durante upgrade |
| Disco Postgres | "at least 5-10 GB" |
| Disco Redis | "can start with 100MB" |
| Sidekiq | "On a very active server the Sidekiq process can use 1GB+ of memory" |

Para o volume da EIFF esses números são folgados. O custo não está na capacidade: está em **existir mais um
serviço com estado para manter vivo**.

### Formas de implantação

Docker Compose (recomendado na doc), Heroku, CapRover e "alternativas para quem é confortável com Rails". Não há
Helm chart oficial na documentação que li — **a documentação não diz** nada sobre Kubernetes nessas páginas; quem
quiser K8s parte de charts de terceiros, fora do suporte oficial.

**Backup não é tratado.** A página de deployment Docker não menciona procedimento de backup, restauração ou
retenção. Isso é responsabilidade inteiramente nossa, num banco que passaria a conter conversas com clientes.

### Licença e preço

| Plano | Preço | Inclui |
| --- | --- | --- |
| Community Edition | "$0 /agent/month", "Free forever" | hospedagem própria, papéis e permissões, suporte da comunidade |
| Premium Support | "$19 /agent/month", cobrado anualmente | suporte |
| Enterprise Edition | "$99 /agent/month", cobrado anualmente | Whitelabeling, SLA Management, **Audit Logs**, Agent Capacity Management, SSO/SAML, Captain AI |

**Audit Logs são enterprise.** A edição gratuita que a EIFF usaria não tem trilha de auditoria própria. Isso não
é bloqueante — a auditoria que importa é a do EIFF Control, que registra ação, ator e antes/depois — mas mata a
ideia de "o Chatwoot também serve de trilha".

### O custo honesto de ter, contra o de não ter

Hoje a infraestrutura da EIFF é **inteiramente gerenciada**: Netlify (estático + funções) e Supabase (Postgres com
RLS, Storage, Auth). Ninguém na empresa opera servidor. Adotar Chatwoot self-hosted significa passar a operar:

| Obrigação nova | Frequência | Quem faz hoje |
| --- | --- | --- |
| atualizar a aplicação (Rails, gems, CVEs) e rodar `rails db:migrate` | contínua; o changelog do Chatwoot é semanal | ninguém |
| manter Postgres e Redis próprios (ou pagar gerenciados) | contínua | Supabase faz |
| backup e teste de restauração das conversas | semanal, no mínimo | Supabase (plano Pro ainda pendente — ver `CLAUDE.md`) |
| TLS, proxy reverso, exposição à internet de uma app Rails | contínua | Netlify faz |
| monitoramento de fila Sidekiq e de entrega de webhook | contínua | ninguém |
| responder a incidente de segurança numa app de terceiros com dados de cliente | quando acontecer | ninguém |

A alternativa "sem Chatwoot nenhum" não é "sem caixa de entrada": é **uma tela do EIFF Control** listando
`central_conversation` e `central_message` (migrations 0049/0050, já reservadas), com os componentes que já
existem — `Tabela`, filtros, vistas salvas, densidade, exportação CSV, permissões por papel, auditoria. Para uma
ou duas pessoas atendendo, essa tela entrega 100% do valor com custo operacional marginal **zero** e sem um
segundo banco com PII.

---

## 3. Contrato de API

### Famílias de API e autenticação

| Família | Para que serve | Credencial | Onde vive |
| --- | --- | --- | --- |
| **Application API** | agir na conta como agente/admin | `access_token` de usuário | Profile Settings do usuário; Cloud e self-hosted |
| **Client API** | construir experiência de mensagem sobre o Chatwoot | `inbox_identifier` + `contact_identifier` | Settings → Configuration da inbox API |
| **Platform API** | administrar a instalação (criar contas, usuários) | `access_token` de um Platform App | Super Admin Console; **só self-hosted / managed** |

Header de autenticação da Application API: **`api_access_token`** (não é `Authorization: Bearer`). Um agent bot
tem chave própria (`agentBotApiKey`), aceita no mesmo header.

Limitação relevante da Platform API, dita na própria documentação: ela **não acessa contas ou usuários criados
pela UI do Chatwoot nem por outra chave** — só o que aquela chave criou ou recebeu permissão explícita. Provisionar
conta por API e depois mexer pela UI cria um estado que a API não enxerga.

Nenhuma das três é OAuth: são **tokens estáticos**. Consequência para nós: vivem só no painel do Netlify, nunca
com prefixo `VITE_`, nunca em log ou resposta — mesma regra do `OCTADESK_API_KEY` e do `META_WHATSAPP_ACCESS_TOKEN`.

### Endpoints que importariam para o adapter

| Método | Caminho | Uso no adapter |
| --- | --- | --- |
| GET | `/api/v1/accounts/{account_id}/contacts/search?q=` | achar o contato pelo telefone (página de 15, `sort`, `page`) |
| POST | `/api/v1/accounts/{account_id}/conversations` | criar a conversa (`source_id`, `inbox_id`, `contact_id`, `status`, `assignee_id`, `team_id`, `custom_attributes`) |
| GET | `/api/v1/accounts/{account_id}/conversations/{conversation_id}` | ler `status`, `meta.assignee`, `last_activity_at`, `custom_attributes` |
| POST | `/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` | espelhar a mensagem (`content`, `message_type`, `private`, `content_type`, `template_params`) |
| POST | `/api/v1/accounts/{account_id}/conversations/{conversation_id}/assignments` | atribuir a agente (`assignee_id`) ou time (`team_id`) |
| POST | `/api/v1/accounts/{account_id}/webhooks` | registrar o webhook (`url`, `name`, `subscriptions[]`), devolve `secret` |

O objeto de conversa devolve `id` (numérico) e `uuid`; o parâmetro de caminho é descrito como "The numeric ID of
the conversation". O campo `display_id`, que aparece no payload de webhook, **não** está no schema dessa resposta —
qual identificador é estável entre webhook e API precisa ser fixado numa prova prática antes de virar chave de
reconciliação.

### Idempotência: NÃO DOCUMENTADA

`POST .../messages` **não documenta** header de idempotência, chave fornecida pelo cliente nem qualquer
deduplicação. Mesma situação do Octadesk, e mesma consequência: se um dia mandarmos mensagem para dentro do
Chatwoot, a garantia contra duplicata é **nossa**, numa tabela de mapeamento própria (unique por
`central_message_id` + provider). Sem isso, timeout na nossa chamada + repetição = mensagem duplicada na inbox.

### Limite de requisições

Rack::Attack, configurável por ambiente: `ENABLE_RACK_ATTACK`, `RACK_ATTACK_LIMIT` (padrão citado: 3000
requisições por minuto por IP) e `ENABLE_RACK_ATTACK_WIDGET_API`. Limites fixos separados para signup, sign-in e
reset de senha. Como todas as nossas chamadas sairiam de **um único IP** (a função Netlify), um espelhamento em
rajada compete com ele mesmo pelo mesmo balde.

---

## 4. Webhook: assinado — com uma ressalva grande

### O que a documentação garante

Ao contrário do Octadesk (que não tem webhook de saída documentado), o Chatwoot **tem**, e **assinado**:

| Header | Conteúdo |
| --- | --- |
| `X-Chatwoot-Signature` | assinatura HMAC-SHA256, prefixada por `sha256=` |
| `X-Chatwoot-Timestamp` | unix timestamp (segundos) do momento da assinatura |
| `X-Chatwoot-Delivery` | id único da entrega daquele evento |

Fórmula documentada: `sha256=HMAC-SHA256(webhook_secret, "{timestamp}.{raw_body}")`. A verificação exige ler o
**corpo bruto** antes de qualquer parse de JSON e comparar em **tempo constante**; a documentação sugere ainda
rejeitar timestamps com mais de 5 minutos, contra replay.

Isso é o mesmo padrão do `X-Hub-Signature-256` da Meta, que a Central já implementa em
`src/core/central/metaServidor.ts` — o código de verificação seria estruturalmente idêntico (muda a mensagem
assinada, que aqui inclui o timestamp).

Eventos assináveis (`subscriptions`):

`conversation_created`, `conversation_updated`, `conversation_status_changed`, `message_created`,
`message_updated`, `contact_created`, `contact_updated`, `webwidget_triggered`, `conversation_typing_on`,
`conversation_typing_off`.

### A ressalva: o mecanismo é novo e há bug aberto

A assinatura por webhook entrou no changelog oficial em **10/03/2026** — seis meses atrás:

> "Each outgoing webhook now gets its own secret and includes three signed headers (X-Chatwoot-Signature,
> X-Chatwoot-Timestamp, X-Chatwoot-Delivery)"

E há uma **issue aberta** desde 14/03/2026 (última atualização 31/03/2026, 5 comentários, atribuída a um
mantenedor) dizendo, no título:

> "Webhook X-Chatwoot-Signature cannot be verified: secret returned by API does not match the internal hmac_token
> used for signing"

Ou seja: o `secret` que `GET/POST /webhooks` devolve **não é** a chave usada para assinar, e quem tenta verificar
falha sempre. Se isso ainda for verdade na versão que instalássemos, o webhook é, na prática, **não autenticado** —
exatamente o defeito que fez o desenho do Octadesk recusar criar endpoint público.

**Consequência para o desenho:** enquanto a verificação de assinatura não for provada funcionando **na versão
instalada**, um endpoint público de webhook do Chatwoot não é criado. Se for necessário antes disso, a
autenticação tem de vir de fora do mecanismo do Chatwoot (segredo longo no caminho da URL + allowlist de IP do
nosso próprio servidor Chatwoot, que é infraestrutura nossa), e o evento vale só como **gatilho de releitura**,
nunca como fato: o servidor confirma tudo consultando a API antes de agir. Isso é Server Truth, o mesmo princípio
que `/api/comunicacao` já aplica.

### Reentrega e deduplicação

O changelog fala em "Stabilized webhook delivery for transient upstream failures" e apresenta `X-Chatwoot-Delivery`
como o que permite "deduplicate retries" — logo, **há reentrega**. Quantas vezes, com que backoff, e se o webhook
é desativado depois de N falhas: **a documentação não diz**. Tratamento obrigatório: dedup por
`X-Chatwoot-Delivery`, exatamente como `externalMessageId` já faz para os reenvios da Meta.

### Webhook de agent bot

O bot tem URL própria, recebe `widget_triggered`, `message_created` e `message_updated`, e "Chatwoot automatically
generates a secret for verifying webhook payloads". A documentação de agent bot **não detalha** o formato dessa
assinatura na página que li — supor que é a mesma dos webhooks de conta seria inventar contrato.

---

## 5. Roteamento de inbox e takeover humano

### Modelo do Chatwoot

- **Inbox**: uma caixa por canal (WhatsApp, e-mail, widget, **API**). Um canal `API` recebe mensagens empurradas
  por HTTP e tem uma **callback URL** própria, informada na criação.
- **Contato**: identificado por `identifier`, e-mail ou telefone; carrega `custom_attributes`.
- **Conversa**: pertence a uma inbox e a um contato; tem `status` (`open`, `resolved`, `pending` no schema da
  resposta de detalhe), `meta.assignee`, `last_activity_at` e `custom_attributes`.
- **Times** e **agentes**: atribuição por `assignee_id` ou `team_id`.

### Como o takeover acontece

O padrão oficial de agent bot é por **status**:

| Estado | Significado |
| --- | --- |
| `pending` | conversa nova numa inbox com bot: o bot faz a triagem |
| `open` | o bot passou a bola: "use the conversation update API to change the status to 'open'", e a conversa fica disponível para humano |
| `pending` (de volta) | o agente devolve a conversa para a fila do bot |

Atribuição explícita é `POST .../conversations/{id}/assignments` com `assignee_id` (ou `team_id`, ignorado quando
há `assignee_id`).

### Como o **nosso** lado saberia

`CentralConversation.humanoResponsavelId` existe exatamente para isso: **com dono humano, nenhum agente responde**.
Os caminhos possíveis:

| Caminho | Viabilidade |
| --- | --- |
| webhook `conversation_updated` | o payload traz `changed_attributes[]` com `current_value`/`previous_value`. A documentação **não enumera** quais atributos aparecem ali — que `assignee_id` apareça precisa ser provado, não presumido |
| webhook `conversation_status_changed` | dá o `pending → open`, que é o gesto de handoff do padrão oficial |
| `GET /conversations/{id}` | devolve `meta.assignee` e `status` — verdade confirmável a qualquer momento |

**Desenho correto:** o webhook é gatilho; o servidor confirma com o `GET` e grava `humanoResponsavelId` **na nossa
tabela**. O `ConversationInboxProvider.responsavelHumano()` então lê o nosso estado, não a API do Chatwoot a cada
mensagem. Isso mantém a regra "com dono humano, nenhum agente responde" funcionando **mesmo com o Chatwoot fora do
ar** — que é a consequência que a ADR exige.

Nota: `assignee_id` é id de **usuário do Chatwoot**, não de usuário do EIFF Control. Vinculá-los exige uma tabela
de mapeamento nossa (agente Chatwoot ↔ `user_scope`). Sem ela, `humanoResponsavelId` guarda um id de outro sistema
e a auditoria fica cega.

---

## 6. Encaixe no contrato `ConversationInboxProvider`

O contrato congelado (`src/core/central/tipos.ts`) é pequeno de propósito:

```ts
sincronizarConversa(c: CentralConversation): Promise<{ inboxConversationId?: string }>
registrarMensagem(m: CentralMessage): Promise<void>
responsavelHumano(c: CentralConversation): Promise<{ humanoResponsavelId?: string }>
```

### `CentralConversation` → Chatwoot

| Campo nosso | Chatwoot | Observação |
| --- | --- | --- |
| `id` | `custom_attributes.eiff_conversation_id` | a nossa chave viaja como atributo; o Chatwoot nunca é a fonte |
| `organizationId` | `account_id` | uma conta Chatwoot por organização; o vínculo é nosso |
| `contexto` (`INTERNAL`/`EXTERNAL`) | **`inbox_id`** | uma inbox por contexto. Nunca inferido do texto — mesma regra do `phone_number_id` da Meta |
| `provider` | `inbox.channel_type` | informativo; quem manda é o nosso campo |
| `telefoneNormalizado` (E.164 **sem** `+`) | `contact.phone_number` | o Chatwoot usa E.164 **com** `+`: conversão explícita, e o número **inteiro** fica no banco dele |
| `externalConversationId` | `conversation.id` | numérico; a relação com `display_id` do webhook precisa ser fixada |
| `identidadeId` | `custom_attributes.eiff_identity_id` | `WhatsappIdentity` **não tem** contraparte no Chatwoot |
| `situacao` `ABERTA` | `pending` | conversa em triagem do agente |
| `situacao` `AGUARDANDO_HUMANO` | `open` | fila humana |
| `situacao` `ENCERRADA` | `resolved` | |
| `humanoResponsavelId` | `meta.assignee.id` | id de usuário **do Chatwoot**; exige tabela de mapeamento |
| `ultimaMensagemEm` | `last_activity_at` | atividade, não "última mensagem": avança com ação de agente também |
| `criadaEm` | `created_at` | |

### `CentralMessage` → Chatwoot

| Campo nosso | Chatwoot | Observação |
| --- | --- | --- |
| `id` | — | sem contraparte; vai em atributo ou na nossa tabela de mapeamento |
| `conversationId` | `conversation_id` | o do Chatwoot, não o nosso |
| `externalMessageId` (wamid da Meta) | `source_id` | a resposta do POST **lista** `source_id`; o corpo documentado do POST **não** o lista como campo de entrada. Escrever o wamid ali é **hipótese a provar**, não contrato |
| `direcao` `inbound`/`outbound` | `message_type` `incoming`/`outgoing` | |
| `tipo` (`text`, `image`, `audio`…) | `content_type` (`text`, `input_email`, `cards`, `input_select`, `form`, `article`) | **não são a mesma coisa**: `content_type` é tipo de widget de UI, não tipo de mídia do WhatsApp. Áudio, imagem e documento viram anexo, não `content_type` |
| `texto` | `content` | continua sendo **dado, nunca instrução** |
| `ocorreuEm` | `created_at` | unix timestamp no webhook |
| `registradaEm` | — | nosso |
| `statusExterno` | `status` | |
| `erroCodigo` | — | **a documentação não diz** qual campo carrega erro de entrega na resposta de mensagem |
| — | `private: true` | nota interna: aparece para o agente, **não** vai ao contato. É o lugar certo para espelhar parecer do motor e decisão do orquestrador |

### O que NÃO cabe no contrato (relatado, não alterado — o contrato é do Architect)

1. **`registrarMensagem` devolve `Promise<void>`.** O Chatwoot devolve o `id` da mensagem criada e o contrato o
   descarta. Sem guardar esse id, não há como reconciliar depois "esta mensagem nossa já está espelhada?" — a
   deduplicação passa a depender de uma tabela de mapeamento própria (a migration **0054** já está reservada para
   isso no `CENTRAL_PARALLEL_PLAN.md`). Cabe, mas exige estado nosso.
2. **`responsavelHumano` é *pull*; o Chatwoot é *push*.** Consultar a API a cada mensagem custa uma chamada por
   mensagem e um ponto de falha. Resolvido sem tocar no contrato: o webhook atualiza a **nossa** tabela e o método
   lê dali. Registrado porque é a diferença entre "Chatwoot obrigatório" e "Chatwoot opcional".
3. **`CentralEvent` não tem contraparte pública.** Não encontrei, na documentação, um feed de eventos por conversa
   consumível pela Application API. A trilha `central_event` continua sendo nossa, ponto.
4. **`WhatsappIdentity` não tem contraparte, e o contato do Chatwoot é o oposto dela.** O `name` do contato vem do
   perfil do WhatsApp — apelido escolhido pelo dono do aparelho, que o nosso contrato proíbe tratar como
   identidade. A identidade continua sendo `whatsapp_identity` `VERIFIED`, e só ela autoriza ação sensível.
5. **Papéis do Chatwoot (`agent`, `administrator`) são uma segunda ACL.** Nunca podem autorizar nada: a permissão
   vem de `pode`/`Acao` do EIFF Control (`PERMISSAO_POR_INTENCAO`). O papel do Chatwoot decide só quem vê a inbox.
6. **`mascararTelefone` protege a nossa saída, não o banco do Chatwoot.** Ele guarda e exibe o número inteiro, por
   desenho. Aceitável para uma inbox humana; é, ainda assim, uma segunda cópia de PII fora do Supabase e fora da RLS.

---

## 7. Modo de integração: espelho ou dono do canal

### Modo A — Chatwoot como inbox humana **atrás** da Central

```
WhatsApp → Meta Cloud → nosso webhook assinado → EIFF Central (mestre)
                                                     ├→ EIFF Control (motor, permissões, auditoria)
                                                     └→ Chatwoot (espelho, inbox API)
```

Nós continuamos donos do número na Meta. O Chatwoot recebe um espelho numa **inbox de canal `API`** — que não fala
com a Meta. A resposta do agente humano digitada no Chatwoot sai pela **callback URL** daquela inbox e chega ao
**nosso** servidor, onde passa pelo rito (identidade, permissão, entrega, auditoria) antes de virar mensagem real.

Isso é o ponto mais importante do modo A e precisa ser dito com honestidade: a documentação descreve a callback
URL do canal API como o lugar "where Chatwoot sends event notifications", e **não** enuncia garantia de entrega,
reentrega ou ordenação dessa notificação. Que a mensagem do agente chegue lá de forma confiável é **hipótese a
provar numa spike**, não contrato.

### Modo B — Chatwoot dono do canal WhatsApp

```
WhatsApp → Meta Cloud → Chatwoot (dono do webhook) → nosso webhook (do Chatwoot) → EIFF Central
```

O fluxo manual do Chatwoot pede `phone number`, `phone number ID`, `business ID` e access token, e instrui:

> "Your callback URL should be in the format of **https://app.chatwoot.com/webhooks/whatsapp/{phone_number}**"

Isto é, o callback do **app da Meta** passa a apontar para o Chatwoot. Um campo de callback aceita **uma** URL: o
nosso `channel-meta-webhook.ts` deixaria de receber o evento original. A documentação também avisa que número já
ativo em outro lugar exige o fluxo de Embedded Signup/Coexistence ou o suporte do Chatwoot — não é uma troca
trivial nem reversível num clique.

### Comparação

| Critério | Modo A (espelho) | Modo B (dono do canal) |
| --- | --- | --- |
| Quem fala com a Meta | nós | Chatwoot |
| Chatwoot cai → o sistema | continua funcionando (a Central não depende dele) | **para**: nenhuma mensagem entra nem sai |
| Trocar/remover Chatwoot | apagar o espelho | migrar o número na Meta de novo |
| Assinatura do evento de entrada | `X-Hub-Signature-256` da Meta, **já implementada e comprovada** | `X-Chatwoot-Signature`, com bug aberto (§4) |
| Envio pelo agente | passa pelo nosso rito (hipótese da callback a provar) | **vai direto ao cliente**, fora do rito |
| Janela de 24 h, templates, modo canário, allowlist | continuam nossos, no `metaServidor.ts` | passam a ser do Chatwoot |
| Duplicação de estado | espelho explícito, mestre único | dois mestres de fato |
| Aderência à ADR | total | **viola**: o Chatwoot vira o cérebro do canal |

### Recomendação de modo

**Modo A, sem hesitação.** O modo B contradiz frontalmente a ADR ("se o Chatwoot cair ou for trocado, o sistema
continua funcionando"), entrega o único mecanismo de entrada que hoje está comprovadamente assinado a um mecanismo
com bug aberto, e joga fora o rito de envio (modo, allowlist, delivery first, classificação, reconciliação) que
custou quatro patches para ficar de pé no Octadesk.

---

## 8. Riscos

| # | Risco | Gravidade | Mitigação obrigatória |
| --- | --- | --- | --- |
| 1 | **Dois mestres.** Chatwoot e Central divergem sobre status, dono e conteúdo da conversa | alta | mestre é sempre o nosso; o Chatwoot é escrita de espelho e **leitura de gatilho**. Nenhuma decisão de negócio lê o Chatwoot |
| 2 | **Envio fora do rito.** Agente digita no Chatwoot e a mensagem sai sem aprovação, entrega, ledger ou auditoria | **alta** | inbox de canal `API` (não WhatsApp), com a resposta voltando pela callback ao nosso servidor. No modo B esse risco é inevitável |
| 3 | **Webhook não verificável** (issue aberta desde 14/03/2026) | alta | nenhum endpoint público antes de provar a verificação na versão instalada; até lá, evento é gatilho, nunca fato |
| 4 | **Duplicata de mensagem** (sem idempotência documentada no POST) | média | tabela de mapeamento própria, unique por mensagem nossa; dedup de entrada por `X-Chatwoot-Delivery` |
| 5 | **PII duplicada** fora do Supabase e da RLS: telefone inteiro, conteúdo de conversa, anexos | média | inbox API sem anexo de origem; retenção definida; backup cifrado; o Chatwoot nunca guarda dado financeiro nem `raw_payload` |
| 6 | **Superfície de ataque nova**: app Rails exposta à internet, com token estático, atualizações semanais | média | rotina de atualização com dono nomeado; sem isso, não sobe |
| 7 | **Sem trilha de auditoria** na edição community (Audit Logs é enterprise, $99/agente/mês) | baixa | a auditoria que vale é `audit_log` do Control; nunca prometer trilha no Chatwoot |
| 8 | **Rate limit por IP** (3000/min por padrão) com todas as chamadas saindo da mesma função | baixa | espelhamento sob demanda, sem varredura periódica |
| 9 | **Deriva de versão**: os headers assinados têm 6 meses; o `display_id` × `id` já é ambíguo entre webhook e API | média | fixar versão, ler o changelog antes de atualizar, testes de contrato contra mock |
| 10 | **Custo humano**: ninguém na EIFF opera Rails/Sidekiq/Postgres/Redis hoje | **alta** | é o risco que decide (§10) |

---

## 9. O que precisaria existir **antes** de qualquer implementação

1. **A Central funcionando ponta a ponta com a Meta direta** (critério de MVP do `CENTRAL_PARALLEL_PLAN.md`).
   Espelho sem mestre não existe.
2. **`central_conversation` / `central_message` persistidos** (migrations 0049/0050) — o adapter espelha o nosso
   modelo, não o inverso.
3. **Migration 0054** (mapeamento de inbox): conversa nossa ↔ conversa Chatwoot, mensagem nossa ↔ mensagem
   Chatwoot, usuário nosso ↔ agente Chatwoot. Sem ela não há idempotência nem `humanoResponsavelId` auditável.
4. **Uma spike de meio dia, numa instância descartável, provando quatro coisas** — nenhuma delas garantida pela
   documentação:
   - a verificação de `X-Chatwoot-Signature` funciona na versão instalada (issue #13809);
   - `conversation_updated` realmente carrega mudança de `assignee_id` em `changed_attributes`;
   - a callback URL da inbox `API` entrega a mensagem escrita pelo agente ao nosso endpoint, de forma confiável;
   - `id` × `display_id` × `uuid`: qual identificador é estável entre webhook e API.
5. **Dono operacional nomeado** para atualização, backup, restauração testada e monitoramento — pessoa, não intenção.
6. **Segredos no painel do Netlify** (`CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_ACCESS_TOKEN`,
   `CHATWOOT_INBOX_ID_INTERNAL`, `CHATWOOT_INBOX_ID_EXTERNAL`, `CHATWOOT_WEBHOOK_SECRET`), nunca `VITE_`, nunca em
   log ou resposta.
7. **Volume humano que justifique**: mais de uma pessoa atendendo o mesmo número ao mesmo tempo.

---

## 10. Recomendação final: **ADIAR**

Não adotar agora. Não descartar.

**Por que não agora.** O Chatwoot resolve fila humana multiagente — problema que a EIFF não tem hoje (um usuário em
validação, `augusto@eiff.com.br`). Em troca, cobra o preço mais caro que existe para uma empresa pequena: **mais um
serviço com estado, exposto à internet, com dados de cliente, que ninguém foi designado para operar**. Toda a
infraestrutura atual é gerenciada exatamente para evitar isso. E, no único ponto em que ele seria estruturalmente
melhor que o Octadesk — ter webhook de saída assinado —, o mecanismo tem seis meses de idade e uma issue aberta
dizendo que a assinatura **não é verificável** com o segredo que a API devolve.

**Por que não descartar.** O desenho já é reversível: `ConversationInboxProvider` está congelado, o mapeamento
campo a campo desta seção §6 cabe quase inteiro, e a integração no modo A não exige tocar em nada do núcleo — só
uma tabela de mapeamento e um adapter server-side. O custo de adiar é praticamente zero.

**Enquanto isso**, a caixa de entrada é uma tela do EIFF Control sobre `central_conversation`/`central_message`,
com `Tabela`, filtros, vistas salvas, permissões por papel e auditoria que já existem. Ela cobre um a três
atendentes com folga.

### Gatilhos que reabrem a decisão

Qualquer um destes, sozinho, reabre — e a reavaliação começa pela spike do §9.4 e por reler a issue #13809:

| Gatilho | Medida concreta |
| --- | --- |
| **Atendimento simultâneo** | duas ou mais pessoas respondendo o mesmo número de WhatsApp na mesma semana, com caso registrado de resposta duplicada ou conversa perdida |
| **Volume do contexto EXTERNAL** | o número comercial passando de ~30 conversas ativas por semana com clientes/leads, acima do que a fila do Radar (`#/radar/hoje`) organiza |
| **Exigência de fila formal** | necessidade real de turno, roteamento por time, SLA de primeira resposta ou relatório de atendimento |
| **Multicanal humano** | e-mail e Instagram do comercial precisando cair na mesma caixa que o WhatsApp |
| **Operação já existir** | a EIFF passar a operar servidor próprio por outro motivo, zerando o custo marginal do §2 |

Se nenhum desses acontecer, a resposta correta continua sendo não instalar nada.

---

## Fontes

- <https://developers.chatwoot.com/api-reference/introduction>
- <https://developers.chatwoot.com/contributing-guide/chatwoot-apis>
- <https://developers.chatwoot.com/contributing-guide/chatwoot-platform-apis>
- <https://developers.chatwoot.com/api-reference/webhooks/add-a-webhook>
- <https://developers.chatwoot.com/api-reference/conversations/create-new-conversation>
- <https://developers.chatwoot.com/api-reference/conversations/conversation-details>
- <https://developers.chatwoot.com/api-reference/conversation-assignments/assign-conversation>
- <https://developers.chatwoot.com/api-reference/messages/create-new-message>
- <https://developers.chatwoot.com/api-reference/contacts/search-contacts>
- <https://developers.chatwoot.com/self-hosted/deployment/architecture>
- <https://developers.chatwoot.com/self-hosted/deployment/requirements>
- <https://developers.chatwoot.com/self-hosted/deployment/docker>
- <https://developers.chatwoot.com/self-hosted/monitoring/rate-limiting>
- <https://developers.chatwoot.com/self-hosted/enterprise-edition>
- <https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks>
- <https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots>
- <https://www.chatwoot.com/hc/user-guide/articles/1677839703-how-to-create-an-api-channel-inbox>
- <https://www.chatwoot.com/hc/user-guide/articles/1756799850-how-to-setup-a-whats_app-channel-manual-flow>
- <https://www.chatwoot.com/hc/user-guide/articles/1677502327-how-to-create-and-use-custom-attributes>
- <https://www.chatwoot.com/pricing/self-hosted-plans>
- <https://www.chatwoot.com/changelog>
- <https://github.com/chatwoot/chatwoot/issues/13809>
- <https://github.com/chatwoot/chatwoot/blob/develop/enterprise/LICENSE>

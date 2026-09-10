# Octadesk — auditoria da API oficial (Channel Provider 01)

Levantado em 10/09/2026 na documentação oficial `developers.octadesk.com` (índice para agentes em
`/llms.txt`; cada página tem versão markdown com o sufixo `.md`). **Nada aqui foi assumido de memória.**
Esta fase não envia mensagem nenhuma: só leitura e diagnóstico.

## Autenticação

| Item | Valor |
| --- | --- |
| Header obrigatório | `X-API-KEY: <chave>` |
| Header opcional | `octa-agent-email: <e-mail do agente>` |
| Verificação | `GET /auth/check` → `200` com booleano dizendo se a chave é válida |
| Base URL | variável de ambiente (`{api-url}` na spec); no EIFF Control vem de `OCTADESK_BASE_URL` |

Não há OAuth nem refresh token documentado: a chave é estática, portanto vive **somente** no painel do
Netlify (`OCTADESK_API_KEY`) e nunca sai do servidor.

## Endpoints confirmados

| Método | Caminho | O que devolve |
| --- | --- | --- |
| GET | `/auth/check` | booleano de validade da chave |
| GET | `/chat/numbers` | array de `OriginNumber`: `id` (obrigatório), `name?`, `number?` |
| GET | `/chat/templates-message` | array de templates: `id`, `name`, `status`, `category`, `createdBy`, `createdAt`, `enable`, `components[]` |
| GET | `/chat` | array de `ChatList` (busca por filtros) |
| GET | `/chat/{id}` | um chat |
| GET | `/chat/{id}/messages` | array de `Message` |
| GET | `/chat/{id}/events` | eventos do chat |
| POST | `/chat/send-template` | cria um chat novo e envia template |
| POST | `/chat/{id}/messages` | envia mensagem em chat aberto |
| POST | `/chat/conversation/send-template` | envio de template (marcado como *deprecated* na doc) |

Os dois POST estão documentados aqui apenas para registro. **Nenhum é chamado nesta fase.**

### Detalhes que importam

- **Paginação** (`/chat`, `/chat/templates-message`, `/chat/{id}/messages`): `page` e `limit`
  (mínimo 1, **máximo 100**); cabeçalhos `X-Total-Pages`, `X-Total-Items`, `X-Next-Page`.
- **Filtros** (`/chat`, `/chat/templates-message`): estilo *deepObject*, array de
  `{ property, operator, value }`. Em `/chat` os operadores são `eq, ne, lt, gt, le, ge, in, nin`;
  em `/chat/templates-message` só `eq`, sobre `name`, `status` e `category`.
- **Telefone do contato no filtro de `/chat`**: a propriedade é `contact.phoneContacts.number`.
  O `ContactsPayload` tem `phoneContacts[]` com `number` e `countryCode`; a spec não enumera a lista
  de propriedades filtráveis, então esse nome foi confirmado contra a documentação atual (Send Safety
  Patch 01) e vive numa constante única, `PROPRIEDADE_TELEFONE`.
- **Status de template**: `pending`, `approved`, `rejected` (mais o booleano `enable`).
  Só `approved` + `enable` serve para abrir conversa nova.
- **Status de chat**: `waiting`, `talking`, `closed`, `missed`, `started`, `offline`, `hidden`.
  `ChatList` traz `id`, `number`, `channel`, `status`, `statusDetail`, `contact`, `agent`,
  `lastMessageDate`, `createdAt`, `updatedAt`, `closedAt`, `unreadMessages`, `withBot`, `tags`.
- **Mensagem** (`GET /chat/{id}/messages`): `id`, `chatId`, `time`, `type` (`public`/`internal`),
  `body`, `status`, `sentBy`, `readAt`, `attachments[]`, `errorSource`, `errorCode`, `errorMessage`.
  Exige `property` e `direction` para ordenação.
- **Direção da mensagem: só `sentBy.type`.** A doc define `sentBy.type` como *"Person type, if is an
  agent or a contact"*. O `status` **não** indica direção: `received` é *"Delivered to recipient"*,
  ou seja, **mensagem nossa entregue**, não mensagem recebida do contato. Os demais valores são
  `sending` (em transmissão), `sended` (enviada), `read` (lida), `error`, `deleted`, `scheduled`,
  `spam`. Não existe campo direcional explícito, então sem `sentBy.type` a direção é **desconhecida** —
  e desconhecida nunca prova nada.
- **`POST /chat/send-template`** (para quando houver piloto): corpo com `origin.contact`
  (nosso número, `channel: 'whatsapp'`, `code`), `target.contact` (número do prospect, `name`,
  `email`), `content.templateMessage` (`id` **ou** `code`, `variables[{key,value}]`) e
  `options.automaticAssign`. Resposta `201` com `{ result: { messageKey, roomKey }, error, errorCode, errorMessage }`.
- **`POST /chat/{id}/messages`**: corpo `MessageSend` com `type` (`public`/`internal`) e `channel`
  (`whatsapp, web, facebook-messenger, instagram, email, widget`) obrigatórios, `body` opcional.

### Curiosidade da spec, tratada no código

Vários GET declaram **`201`** como status de sucesso (não `200`). O cliente aceita qualquer `2xx`,
por isso não depende desse detalhe.

## Janela de atendimento (customer service window)

A janela livre de 24 h da Meta só pode ser considerada aberta com **prova de mensagem recebida do
contato**. O campo `lastMessageDate` do chat **não serve sozinho**: ele também avança quando a última
mensagem foi nossa, o que abriria mensagem livre sem direito.

Regra implementada (`avaliarJanelaLivre`): ao encontrar a conversa candidata, o servidor lê
`GET /chat/{id}/messages` e procura a mensagem pública mais recente com `sentBy.type` de contato.
A janela só é dada como ativa quando essa mensagem existe e está dentro das 24 h. Sem histórico, só
com mensagens nossas, com direção indeterminada ou com data inválida, a janela **não é comprovada** e
o caminho volta para template aprovado (ou `NEEDS_REVIEW`, conforme o caso). A conversa carrega
`ultimaMensagemInboundEm`, `janelaLivreAte` e `janelaComprovada` para a decisão ficar auditável.

## Idempotência: NÃO GARANTIDA

A documentação **não descreve** header de idempotência, chave de deduplicação nem qualquer mecanismo
contra reenvio, nem em `POST /chat/send-template` nem em `POST /chat/{id}/messages`.

Consequência assumida: a idempotência é **nossa**, no ledger `radar_communication_delivery`
(`idempotency_key` única por comunicação + provider + canal + modo + remetente/template).
Isso evita duplo clique, mas **não resolve** o cenário crítico:

> a Octadesk aceita a mensagem, a nossa função perde a resposta (timeout/queda), o usuário tenta de novo.

Caminho implementado no Send Safety Patch 01 (ainda sem envio): a entrega nasce `READY`, vai para
`REQUESTED` **antes** da chamada e, se a resposta se perder, termina em `UNKNOWN`. A reconciliação
(`reconcileDelivery`) lê `GET /chat` (pelo telefone) e `GET /chat/{id}/messages` e compara a
**impressão** da mensagem — hash canônico do corpo, calculado em trânsito no servidor, nunca gravado
em texto claro — com a impressão esperada do que queríamos enviar:

A reconciliação recebe do navegador **apenas o `deliveryId`**. O servidor carrega a entrega, a
comunicação, o conteúdo aprovado efetivo (edição humana quando existe), o contato e os dados do
provider, e reconstrói tudo: nenhuma impressão pronta vem do cliente.

**Conversa nova com id desconhecido** (o caso crítico: `send-template` aceito e resposta perdida):
todas as conversas do telefone viram candidatas, e para **cada** candidata a impressão esperada é
recalculada com o id daquela conversa. Nunca se compara `hash(null + texto)` com `hash(chatA + texto)`.

| Situação | Resultado |
| --- | --- |
| nenhuma mensagem de saída na janela do pedido | `NOT_FOUND` |
| exatamente uma mensagem com a impressão do texto aprovado | `FOUND` |
| mais de uma conversa com a mesma mensagem | `AMBIGUOUS` |
| mensagens na janela, nenhuma com a nossa impressão | `AMBIGUOUS` |
| modo TEMPLATE (o corpo no provider é o template renderizado, que não conhecemos) | `AMBIGUOUS` ou `NOT_FOUND` |

Mensagem sem corpo, interna ou com direção indeterminada **nunca** prova `FOUND`.

### Dois fingerprints com papéis diferentes

| Conceito | Onde vive | Para que serve |
| --- | --- | --- |
| `request_fingerprint` (`impressaoComando`) | gravado no ledger | identidade auditável do comando de envio |
| `message_match_fingerprint` (`impressaoMensagem`) | só em memória, no servidor | casar uma mensagem **dentro de uma conversa candidata** |

Os dois nunca são intercambiáveis: o id da conversa nem existe quando o comando é criado. Nenhum dos
dois guarda texto ou telefone em claro.

### Classificação da falha (regra do Send Pilot)

| Situação | Estado |
| --- | --- |
| rejeição explícita e definitiva do provider (4xx com código de erro) | `FAILED` |
| timeout, erro de rede, 5xx, resposta impossível de interpretar depois do POST, 4xx sem código | `UNKNOWN` |

`UNKNOWN` nunca reenvia automaticamente.

`AMBIGUOUS` **nunca** autoriza reenvio automático, e `UNKNOWN` também não: só decisão humana
(`permiteReenvioAutomatico`). `UNKNOWN` é estado terminal na máquina — sair dele vai exigir regra
aprovada numa fase futura; a reconciliação informa, mas não transiciona sozinha.
**Enquanto o piloto não for liberado, o envio fica desligado.**

## Autoridade sobre o ledger (quem pode escrever)

`authenticated` tem **apenas SELECT** em `radar_communication_delivery` e em
`radar_communication_delivery_event`. Criar e transicionar entrega acontece **só** por duas funções
server-only, `radar_delivery_create` e `radar_delivery_transition` (`EXECUTE` apenas para
`service_role`), chamadas pela função Netlify depois de validar JWT → perfil real → organização →
permissão Radar, no mesmo padrão das RPCs do Vibe. O navegador nunca escreve na tabela nem chama as
funções, e um teste varre `src/` para impedir a regressão.

O **comando** da entrega é imutável depois do INSERT: `organization_id`, `communication_id`,
`company_id`, `contact_id`, `provider`, `channel`, `mode`, `idempotency_key`,
`request_fingerprint`, `provider_sender_id`, `provider_template_id`, `requested_by` e `created_at`.
Mudar comando significa criar outra entrega. `requested_at` nasce nulo, é preenchido uma única vez na
transição para `REQUESTED` e fica imutável a partir daí. Só os campos de resultado do provider
(`provider_conversation_id`, `provider_message_id`, `provider_status`, `error_code`,
`error_message_safe` e as datas de estado) evoluem, e sempre pela porta controlada.

**Ator real da transição.** O evento distingue quem **pediu** (`requested_by`) de quem **transicionou**
(`actor_id` + `actor_kind`, um de `USER`, `SERVER`, `PROVIDER`, `SYSTEM`). O `actor_id` vem sempre
do JWT validado no servidor; o navegador não escolhe ator.

## Máquina de estados da entrega

`READY → REQUESTED`; `REQUESTED → ACCEPTED | FAILED | UNKNOWN`; `ACCEPTED → DELIVERED | FAILED | UNKNOWN`.
`DELIVERED`, `FAILED` e `UNKNOWN` são terminais; regressão não existe. A regra vive em dois lugares
que se espelham: `TRANSICOES_ENTREGA` no core e o trigger `radar_delivery_estado` no banco
(migration 0046), que é a **única** porta de mudança de status e produz o evento correspondente em
`radar_communication_delivery_event` — tabela append-only, com `SELECT` como único privilégio de
usuário autenticado.

## Webhook de entrada: NÃO DOCUMENTADO

O único webhook no índice é `POST /chat/external-webhook/{subdomain}/{botid}/{componentid}/{roomkey}`,
que é o **oposto** do que precisamos: é um endpoint **que nós chamamos** para empurrar um corpo externo
para uma sala ou componente de bot. Não existe, na documentação pública, webhook de saída da Octadesk
para o nosso servidor avisando:

- mensagem nova recebida;
- resposta do contato;
- mudança de status de chat ou de mensagem.

Também não há documentação de assinatura/autenticação de webhook de entrada (nada de HMAC, timestamp
ou segredo compartilhado).

### Decisão

Nenhum endpoint público de webhook é criado nesta fase. Inventar um contrato não documentado seria
criar uma porta aberta sem autenticação conhecida. Fica registrada a lacuna e definida a estratégia
de **reconciliação por consulta**, para uma fase futura:

1. `GET /chat` filtrando pelo telefone do contato → `chatId` e `status`;
2. `GET /chat/{id}/messages` ordenado por `time desc` → mensagens novas desde o último `checkpoint`;
3. mensagem `received` do contato depois do nosso envio vira atividade e alimenta a transição `REPLIED`.

Sem polling recorrente nesta fase: a reconciliação será disparada por ação humana ou por rotina
aprovada depois, nunca automaticamente agora.

## Variáveis de ambiente (somente Netlify)

| Variável | Uso |
| --- | --- |
| `OCTADESK_API_KEY` | header `X-API-KEY`; nunca em log, resposta, browser ou repositório |
| `OCTADESK_BASE_URL` | base da API da conta |
| `OCTADESK_AGENT_EMAIL` | header `octa-agent-email` |

Nunca usar prefixo `VITE_`: isso as colocaria no bundle do navegador.

## Fontes

- <https://developers.octadesk.com/llms.txt>
- <https://developers.octadesk.com/reference/checkapitoken>
- <https://developers.octadesk.com/reference/getnumbers>
- <https://developers.octadesk.com/reference/gettemplatemessages>
- <https://developers.octadesk.com/reference/getchatbyfilter>
- <https://developers.octadesk.com/reference/getmessagesbychatid>
- <https://developers.octadesk.com/reference/sendmessagetochat>
- <https://developers.octadesk.com/reference/sendtemplate>
- <https://developers.octadesk.com/reference/sendexternalwebhook>

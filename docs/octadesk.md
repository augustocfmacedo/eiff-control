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
- **Status de template**: `pending`, `approved`, `rejected` (mais o booleano `enable`).
  Só `approved` + `enable` serve para abrir conversa nova.
- **Status de chat**: `waiting`, `talking`, `closed`, `missed`, `started`, `offline`, `hidden`.
  `ChatList` traz `id`, `number`, `channel`, `status`, `statusDetail`, `contact`, `agent`,
  `lastMessageDate`, `createdAt`, `updatedAt`, `closedAt`, `unreadMessages`, `withBot`, `tags`.
- **Mensagem** (`GET /chat/{id}/messages`): `id`, `chatId`, `time`, `type` (`public`/`internal`),
  `body`, `status` (`sending, sended, received, read, error, deleted, scheduled, spam`), `sentBy`,
  `readAt`, `attachments[]`, `errorSource`, `errorCode`, `errorMessage`. Exige `property` e
  `direction` para ordenação.
- **`POST /chat/send-template`** (para quando houver piloto): corpo com `origin.contact`
  (nosso número, `channel: 'whatsapp'`, `code`), `target.contact` (número do prospect, `name`,
  `email`), `content.templateMessage` (`id` **ou** `code`, `variables[{key,value}]`) e
  `options.automaticAssign`. Resposta `201` com `{ result: { messageKey, roomKey }, error, errorCode, errorMessage }`.
- **`POST /chat/{id}/messages`**: corpo `MessageSend` com `type` (`public`/`internal`) e `channel`
  (`whatsapp, web, facebook-messenger, instagram, email, widget`) obrigatórios, `body` opcional.

### Curiosidade da spec, tratada no código

Vários GET declaram **`201`** como status de sucesso (não `200`). O cliente aceita qualquer `2xx`,
por isso não depende desse detalhe.

## Idempotência: NÃO GARANTIDA

A documentação **não descreve** header de idempotência, chave de deduplicação nem qualquer mecanismo
contra reenvio, nem em `POST /chat/send-template` nem em `POST /chat/{id}/messages`.

Consequência assumida: a idempotência é **nossa**, no ledger `radar_communication_delivery`
(`idempotency_key` única por comunicação + provider + canal + modo + remetente/template).
Isso evita duplo clique, mas **não resolve** o cenário crítico:

> a Octadesk aceita a mensagem, a nossa função perde a resposta (timeout/queda), o usuário tenta de novo.

Antes de qualquer piloto de envio é preciso fechar a reconciliação desse caso. Caminho previsto:
gravar a entrega como `REQUESTED` **antes** da chamada; em caso de resposta perdida, marcar `UNKNOWN`
e reconciliar por `GET /chat` (busca do chat pelo telefone do contato) + `GET /chat/{id}/messages`
comparando `time` e `body` com a janela do pedido, antes de permitir nova tentativa.
**Enquanto isso não estiver implementado e testado, o envio fica desligado.**

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

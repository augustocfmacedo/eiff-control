# EIFF Central — arquitetura da central de WhatsApp

Fundação criada em 10/09/2026 (EIFF Central 01). **Nenhuma mensagem é enviada nesta fase**: a Central é
somente leitura, o webhook apenas recebe e normaliza, e todos os agentes existem só como contrato.

## Por que existe

O Octadesk deixou de ser o provider principal por custo e dependência. A arquitetura passa a ser:

```
WhatsApp (pessoa)
   ↓
Meta WhatsApp Cloud API        ← provider de canal, server-only
   ↓
EIFF CENTRAL                   ← normalização, contexto, identidade, orquestração
   ↓
EIFF Control                   ← business engine, permissões, execução, auditoria
```

O EIFF Control continua dono de usuários, colaboradores, permissões, processos, atividades, finanças,
compras, obras, Radar e auditoria. A Central é uma **porta de entrada**, nunca um segundo sistema.

## Regra fundamental

| Camada | Papel | O que **não** faz |
| --- | --- | --- |
| IA | interpreta linguagem | não decide, não escreve |
| Business Engine | decide pela regra determinística | não conversa |
| Permissões | autorizam pela matriz única do Control | não são reescritas para o WhatsApp |
| Servidor | executa | não confia no cliente |
| Auditoria | registra | não é opcional |

**Nunca** existe caminho LLM → escrita no banco. O Diretor Financeiro já funciona assim e é o modelo:
a IA só interpreta o texto, o parecer vem do motor.

## Fluxo completo (alvo)

```
WhatsApp → Meta Cloud → Webhook assinado → ChannelInboundEvent
        → Contexto (INTERNAL/EXTERNAL, pelo número que recebeu)
        → Identidade (whatsapp_identity VERIFIED)
        → Orquestrador (intenção + agente + permissão exigida)
        → Domain Agent (interpreta e PROPÕE ação)
        → Business Engine (decide)
        → Permissão (autoriza)
        → Servidor (executa)
        → Auditoria (registra)
```

Cada seta é uma fronteira: quebrou uma, para. Nada avança "no melhor esforço".

## Contextos: INTERNAL e EXTERNAL

Dois contextos que **não se misturam**:

| Contexto | Uso | Número |
| --- | --- | --- |
| `INTERNAL` | EIFF Central, para colaboradores | `EIFF_CENTRAL_PHONE_NUMBER_ID` |
| `EXTERNAL` | EIFF Comercial, para clientes, leads e parceiros | `EIFF_COMMERCIAL_PHONE_NUMBER_ID` |

O contexto vem **do número que recebeu a mensagem** (`metadata.phone_number_id`), nunca do texto.
Número desconhecido não vira `INTERNAL` por conveniência: fica indefinido e o evento é tratado como não
confiável. Hoje pode existir só um número configurado; o modelo já suporta os dois.

## Meta WhatsApp Cloud API

Contratos conferidos na documentação oficial (fontes no fim).

| Operação | Chamada |
| --- | --- |
| número da empresa | `GET /{PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status` |
| templates | `GET /{WABA_ID}/message_templates?limit=100` |
| autenticação | `Authorization: Bearer <access token>` |

Status de template na Meta: `APPROVED`, `IN_REVIEW`/`PENDING`, `REJECTED`, `PAUSED`, `DISABLED`.
Só `APPROVED` conta como ativo no modelo interno.

### Webhook

`/api/channel/meta/webhook`

- **GET** (verificação): a Meta manda `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`.
  O servidor só devolve o challenge quando o token bate com `META_WHATSAPP_VERIFY_TOKEN`.
- **POST** (eventos): o header **`X-Hub-Signature-256`** traz `sha256=<hmac hex>`, HMAC-SHA256 do
  **corpo bruto** com o **App Secret**. A assinatura é validada **antes** de qualquer leitura do
  conteúdo, com comparação de tempo constante. Payload não validado nunca é processado nem guardado.
  O corpo bruto **não** é persistido.

Estrutura oficial da notificação:

```
{ object: 'whatsapp_business_account',
  entry: [{ id, changes: [{ field: 'messages',
    value: { messaging_product, metadata: { display_phone_number, phone_number_id },
             contacts: [...], messages: [...], statuses: [...] } }] }] }
```

### Tradução para o modelo interno

| Meta | Evento interno |
| --- | --- |
| `messages[]` | `MESSAGE_RECEIVED` (inbound) |
| `statuses[].status = sent` | `MESSAGE_SENT` |
| `delivered` | `MESSAGE_DELIVERED` |
| `read` | `MESSAGE_READ` |
| `failed` (com `errors[]`) | `MESSAGE_FAILED` |

Status desconhecido é ignorado, não inventado. O core só vê `ChannelInboundEvent`; o formato Graph API
existe apenas em `src/core/central/metaServidor.ts`, e um teste prende essa fronteira.

## Identidade interna (`whatsapp_identity`)

O nome que o WhatsApp informa é apelido escolhido pelo dono do aparelho: **nunca é identidade**.
O modelo vincula telefone normalizado a uma pessoa do Control:

| Campo | |
| --- | --- |
| `organization_id`, `usuario_id` / `colaborador_id` | quem é |
| `telefone_normalizado` | E.164 sem `+`, mascarado em qualquer log |
| `contexto` | INTERNAL ou EXTERNAL |
| `status` | `PENDING` → `VERIFIED` → `REVOKED` |

Só `VERIFIED`, no mesmo contexto, autoriza ação sensível. Desconhecida, pendente ou revogada: a decisão
cai para humano, sempre. A persistência entra na fase em que a Central passar a agir — nesta fase é
contrato e função pura de resolução.

## Orquestrador e agentes (só contrato)

Intenções internas: `FINANCE`, `PURCHASE`, `WORKSITE`, `INVENTORY`, `COMMERCIAL`, `HR_ADMIN`,
`EXECUTIVE`, `GENERAL`.

`OrchestratorDecision` = intenção, confiança, agente alvo, se exige humano, se exige confirmação e a
**permissão exigida**. A permissão é uma ação da matriz do EIFF Control: o WhatsApp **não cria uma
segunda ACL**. Um teste prende essa correspondência.

`EnterpriseAgent` = `code`, `canHandle`, `interpret`, `proposeAction`, `execute`. Proposta não é
execução: precisa de permissão, regra de negócio e, quando o domínio exigir, confirmação humana.

### FINANCE_AGENT reaproveita o Diretor Financeiro

O agente financeiro será um **adapter** sobre `src/core/cfo.ts`, não uma segunda implementação:
`interpretarPedido` para ler o texto, `analisarPagamento` para o parecer determinístico (saldo bancário
do extrato, reserva, menor saldo em 30 dias, alçadas) e `registrarPrevisaoDF` para a previsão em
rascunho que a Diretoria decide na Central do CFO. **Nenhuma regra financeira é reescrita.**

Os demais agentes seguem o mesmo princípio, cada um sobre o módulo que já existe (compras, obras,
estoque, Radar, equipe, motor).

## Persistência da conversa: avaliar antes de criar

Modelos candidatos: `central_conversation`, `central_message`, `central_event`.

Antes de qualquer migration, avaliar o que já é representável:

- `radar_activity` já registra interações com contatos externos (tipo, canal, resultado);
- `radar_communication` + `radar_communication_delivery` + `..._delivery_event` já cobrem a saída
  aprovada, a entrega e a trilha de status;
- `audit_log` já registra ação, ator e antes/depois.

O que **não** cabe hoje é a conversa interna com colaborador (contexto INTERNAL), que não é atividade
de CRM. Decisão: criar só o que sobrar depois desse mapeamento, para não duplicar dado.

## Variáveis (somente painel do Netlify)

| Variável | Uso |
| --- | --- |
| `META_WHATSAPP_ACCESS_TOKEN` | `Authorization: Bearer` |
| `META_WHATSAPP_PHONE_NUMBER_ID` | número da empresa |
| `META_WHATSAPP_WABA_ID` | conta para listar templates |
| `META_WHATSAPP_VERIFY_TOKEN` | verificação GET do webhook |
| `META_WHATSAPP_APP_SECRET` | validação da assinatura do POST |
| `META_WHATSAPP_SEND_MODE` | `disabled` (padrão), `canary`, `pilot` |
| `META_WHATSAPP_CANARY_NUMBERS` | allowlist do canário, só no servidor |
| `EIFF_CENTRAL_PHONE_NUMBER_ID` | número do contexto INTERNAL |
| `EIFF_COMMERCIAL_PHONE_NUMBER_ID` | número do contexto EXTERNAL |
| `META_GRAPH_VERSION` | opcional; padrão `v21.0` |

Nunca com prefixo `VITE_`: isso as colocaria no bundle do navegador. Nenhum token aparece em resposta
ou log — o sanitizador corta padrões de token e sequências longas antes de qualquer saída.

## ADR: Chatwoot é opcional, e não é o cérebro

**Contexto.** O Chatwoot self-hosted pode ser útil como caixa de entrada humana.

**Decisão.** Chatwoot entra, se entrar, como **inbox humana**, atrás de um adapter
`ConversationInboxProvider` com duas implementações: `META_DIRECT` (hoje) e `CHATWOOT` (futuro).

**Será:** inbox humana, times, atribuição, histórico de conversa, assumir o atendimento (takeover).

**Não será:** CRM principal, banco mestre, motor financeiro, motor comercial, sistema de permissões,
motor de IA. Nada disso sai do EIFF Control.

**Consequência.** Se o Chatwoot cair ou for trocado, o sistema continua funcionando: a Central fala
direto com a Meta Cloud. O adapter existe para que a escolha seja reversível.

**Não implementado nesta fase.**

## O que falta antes de a Central agir

1. persistência de `whatsapp_identity` e o fluxo de verificação do número;
2. decisão sobre `central_conversation` depois do mapeamento acima;
3. `provider` da tabela de entrega aceita hoje só `MANUAL` e `OCTADESK` — incluir `META_CLOUD` no CHECK
   quando o envio pela Meta entrar (migration própria, junto da fase de envio);
4. orquestrador real e o primeiro agente (FINANCE, como adapter);
5. fase de envio, com o mesmo rito do canário: modo, allowlist, delivery first, classificação e
   reconciliação.

## Fontes

- <https://developers.facebook.com/docs/graph-api/webhooks/getting-started>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples>
- <https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers>
- <https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates>

## Pre-Merge Gate 02 (review externo do SHA f4c142f)

Quatro pontos levantados na revisão externa da branch de integração, antes do merge em `main`.

| Ponto | Situação |
| --- | --- |
| RLS dos filhos de `central_conversation` | **fechado** — `central_message` e `central_event` herdam a visibilidade da conversa |
| Coerência cross-tenant das FKs (0049 e 0050) | **fechado** — triggers no banco, além da validação nas RPCs |
| Verificação atômica do código | **fechado** — `whatsapp_identity_verify`; `..._transition` só revoga |
| Teto do corpo do webhook | **fechado** — `Content-Length` antes de `req.text()`, e o teto real no handler |
| `RATE_LIMIT_EDGE` | **dívida pré-live** (abaixo) |

### Herança de visibilidade

A política do filho faz `exists (select 1 from central_conversation c where c.id = …)`. O `EXISTS` roda como o
usuário que consulta, então passa pela própria RLS de `central_conversation`: a regra é escrita **uma vez só** e o
filho não pode divergir do pai. Não há recursão porque a política da conversa não olha para mensagem nem para evento.

### Verificação da identidade

`whatsapp_identity_verify(p_user_id, p_identity_id, p_code_hash, p_max_attempts)` é a **única** porta para
`VERIFIED`. Tudo na mesma transação, sob `for update`: identidade existe → mesma organização → `PENDING` → desafio
existe → não expirou → tentativas abaixo do limite → o hash confere. Código errado gasta tentativa e devolve sempre
a mesma resposta (`codigo_nao_confere`), sem pista de quanto bateu; código certo promove e zera o desafio.

O **plaintext do código nunca chega ao banco**: existe na memória da requisição que o gerou e na mensagem enviada ao
dono do número. O servidor manda só o SHA-256 (`hashCodigoVerificacao` / `codigoParaVerificacao` em `identidade.ts`).
`whatsapp_identity_transition` não promove mais para `VERIFIED` — só revoga.

### RATE_LIMIT_EDGE — dívida pré-live

O teto de 512 KB corta corpo grande, mas **não** limita a TAXA de requisições. O Netlify é distribuído e serverless:
um contador em memória seria inútil (cada instância teria o seu) e daria falsa sensação de proteção — por isso
**não foi implementado**. Limite de taxa é trabalho de borda (regra do provedor/CDN/WAF na frente da função) e tem de
ser resolvido **antes do primeiro número real em produção**, não em código de aplicação.

## Mission Control é um snapshot (gate `MISSION_CONTROL_LIVE`)

O painel `#/mission-control` deriva toda prontidão de gates com evidência, mas a **situação** de cada gate é curadoria
declarada no código (`src/core/central/missionControl.ts`) e o painel só muda quando o código muda. Ele **não** é
tempo real: nesta fase não existe `/api/development-status`, adapter do GitHub, polling, nem status ao vivo de branch,
commit ou CI. A tela diz isso ("Snapshot do desenvolvimento").

O gate `MISSION_CONTROL_LIVE` fica **aberto** e é prioridade da próxima wave. Prova futura:

- endpoint server-side `development-status` (JWT → perfil → `ver_mission_control`);
- adapter do GitHub (somente leitura, token só no painel do Netlify);
- SHA de `main` ao vivo, status do CI, branches/workstreams, última atualização;
- polling controlado (intervalo fixo, sem pressionar a API).

Acesso ao painel: permissão própria `ver_mission_control` (Administrador e Diretoria), conferida na rota — não só
no menu.

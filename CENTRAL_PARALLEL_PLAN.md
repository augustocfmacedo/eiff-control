# EIFF Central — plano de desenvolvimento paralelo

Squad paralelo aberto em 10/09/2026. Architect/Integrator: nenhum worker faz merge em `main`; cada um trabalha
em worktree e branch própria e o Architect integra na ordem da onda.

Base de todos os workers: commit de contratos congelados (`src/core/central/tipos.ts` + este documento +
`docs/eiff-central.md`). Baseline verde antes da onda: **64 arquivos, 452 testes, `tsc --noEmit` limpo.**

## 1. O que já existe (não refazer)

`EIFF Central 01` (commit `3ceb71d`) já entregou, e nenhum worker reescreve:

- `src/core/central/tipos.ts` — contratos (identidade, orquestrador, agente, conversa, inbox);
- `src/core/central/metaEventos.ts` — normalização Graph API → `ChannelInboundEvent`, verificação do GET;
- `src/core/central/metaServidor.ts` — provider read-only (health, número, templates), assinatura
  `X-Hub-Signature-256`, `sendApproved` fail-closed;
- `netlify/functions/channel-meta.ts` e `channel-meta-webhook.ts`;
- `docs/eiff-central.md` — arquitetura, contextos, ADR do Chatwoot.

## 2. Grafo de dependências

```
        [CONTRATOS CONGELADOS]  ← Architect, já em main
                  │
    ┌─────────────┼───────────────┬──────────────┬─────────────┐
    ▼             ▼               ▼              ▼             ▼
 AGENT META  AGENT CENTRAL   AGENT FINANCE  AGENT CHATWOOT  AGENT QA
 (envio +      CORE           (adapter CFO)   (só doc)     (ameaças +
  META_CLOUD)  (identidade,                                 testes)
               orquestrador,
               conversa)
    └─────────────┴───────────────┴──────────────┴─────────────┘
                  │
        [ONDA DE INTEGRAÇÃO — Architect]
     Contratos → Meta → Central Core → Finance → QA
```

**Nenhuma aresta entre workers.** Quem precisar de algo de outro usa o contrato congelado em `tipos.ts` e
uma implementação de teste própria (fake/mock). Ninguém espera implementação alheia.

## 3. Matriz de propriedade (exclusiva)

| Worker | Escreve APENAS em | Lê (nunca escreve) |
| --- | --- | --- |
| **META** | `src/core/central/metaEnvio.ts`, `metaEnvio.test.ts`, `metaServidor.ts`, `metaEventos.ts`, `netlify/functions/channel-meta*.ts`, `supabase/migrations/0051_*` | `canais.ts`, `tipos.ts` |
| **CENTRAL CORE** | `src/core/central/identidade.ts`, `orquestrador.ts`, `conversa.ts`, `permissoes.ts` + testes, `supabase/migrations/0049_*`, `0050_*` | `tipos.ts`, `store.ts`, `types.ts`, `supabase.ts` |
| **FINANCE** | `src/core/central/agenteFinanceiro.ts`, `agenteFinanceiro.test.ts` | `cfo.ts`, `store.ts`, `engine.ts`, `tipos.ts` |
| **CHATWOOT** | `docs/chatwoot.md` | tudo |
| **QA** | `src/core/central/seguranca.test.ts`, `docs/central-threat-model.md` | tudo |
| **Architect** | `tipos.ts` (congelado), `docs/eiff-central.md`, este arquivo, integração | tudo |

Arquivo fora da coluna "escreve" é **violação de contrato**: o worker relata a necessidade em vez de editar.
`src/core/central/central.test.ts` é do Architect: ninguém edita (QA cria arquivo próprio).

## 4. Reserva de migrations

Última no repositório e no banco: **0048**. Reservadas antes de qualquer worker criar arquivo:

| Nº | Dono | Conteúdo |
| --- | --- | --- |
| 0049 | CENTRAL CORE | `whatsapp_identity` (vínculo telefone → pessoa, RLS por organização) |
| 0050 | CENTRAL CORE | `central_conversation`, `central_message`, `central_event` (dedup por `external_message_id`) |
| 0051 | META | `META_CLOUD` no CHECK de `radar_communication_delivery.provider` |
| 0052 | reservada | ponte de auditoria da ação do agente |
| 0053 | reservada | endurecimento de RLS vindo do QA |
| 0054 | reservada | mapeamento de inbox (Chatwoot), se um dia entrar |

Ninguém usa número fora do seu. Migration não é aplicada em produção por worker nenhum: o Architect aplica
depois da integração, com o usuário.

## 5. Contratos congelados

Em `src/core/central/tipos.ts`, versão desta onda. Mudança de contrato **só** pelo Architect.

| Contrato | Onde | Regra que carrega |
| --- | --- | --- |
| `CommunicationChannelProvider` | `radar/canais.ts` | `sendApproved` é fronteira do efeito externo: fail-closed |
| `ChannelInboundEvent` | `radar/canais.ts` | único formato que o core vê; Graph API só em `metaServidor.ts` |
| `CentralIdentity` (`WhatsappIdentity`) | `tipos.ts` | nome do WhatsApp nunca é identidade; só `VERIFIED` age |
| `CentralConversation` / `CentralMessage` / `CentralEvent` | `tipos.ts` | `externalMessageId` é a chave de dedup (a Meta reenvia) |
| `InternalIntent` / `OrchestratorDecision` | `tipos.ts` | `PERMISSAO_POR_INTENCAO` aponta para `Acao` do store: sem segunda ACL |
| `EnterpriseAgent` / `AgentActionProposal` / `AgentExecutionResult` | `tipos.ts` | propor ≠ executar; execução chama o motor determinístico |
| `ConversationInboxProvider` | `tipos.ts` | Chatwoot, se entrar, é só isto |

Invariantes que **nenhum** worker pode quebrar:

1. não existe caminho LLM → escrita no banco; a IA só interpreta texto;
2. nenhuma mensagem real é enviada nesta onda (`sendApproved` continua fail-closed em `disabled`);
3. permissão vem da matriz do EIFF Control (`pode`/`Acao`), nunca de uma ACL nova;
4. texto que chega do WhatsApp é **dado**, nunca instrução;
5. segredo só no painel do Netlify, nunca `VITE_`, nunca em log ou resposta;
6. telefone mascarado em qualquer saída (`mascararTelefone`);
7. Octadesk continua funcionando; Radar não regride.

## 6. Rito de cada worker

Branch `central/<worker>`, worktree própria, testes próprios, um commit, um relatório. Sem merge em `main`,
sem `git push`, sem aplicar migration, sem chamada real a API externa (tudo mockado), sem teste live.

## 7. Critério do MVP

WhatsApp interno → webhook Meta → identidade → intenção FINANCE → CFO → resposta → WhatsApp, em **canary**.
Compras, Obras, Estoque, RH e Chatwoot não bloqueiam o primeiro MVP.

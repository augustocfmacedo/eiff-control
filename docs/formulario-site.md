# Formulário do site → EIFF Controle

Como a solicitação feita em `eiff.com.br/simular-galpao/` (e em `/contato/`) entra no CRM.

> Estado em 09/11/2026: **implementado e provado, NÃO ativado**. Nenhum webhook configurado, nenhuma
> credencial inserida, nada em produção. Os leads reais guardados no painel do Netlify **não foram
> processados** — a reconciliação os retém por padrão (§5).

---

## 1. O caminho

```
formulário publicado (Netlify Forms, sem mudança nenhuma no HTML)
        │
        ▼  evento de submissão verificada
função do SITE  netlify/functions/submission-created.mts   (repo eiff-site, branch não publicada)
        │        acrescenta x-eiff-form-secret · tenta 3 vezes · não registra o lead em log
        ▼
/api/formulario-site      (invólucro: netlify/functions/formulario-site.ts
        │                 decisão:   src/core/radar/formularioBorda.ts)
        │
        ├─ 1º  radar_source_record  PENDING, sem entidade     ← evidência (Lead Engine)
        └─ 2º  RPC inbox_ingest     thread + mensagem         ← atendimento (EIFF Inbox)
                   └─ contato completado (nome, empresa, telefone, relação lead)
                   └─ Octopus Router (0057) → setor COMERCIAL, responsável, SLA
        ▼
aba Candidatos do Command Center · decisão HUMANA de promover
```

Nada entre a evidência e a decisão humana cria empresa, contato do Radar, oportunidade ou tarefa, e nada
envia mensagem. O motor estrutural não é acionado em nenhum ponto.

## 2. O transporte, e por que não é o nativo

**Verificado em 09/11/2026.** A notificação nativa de webhook do Netlify faz `POST` a uma URL arbitrária,
mas **não aceita cabeçalho próprio**: o único que ela acrescenta é `X-Webhook-Signature`, e só quando se
informa um «JWS secret token» (HS256, com `iss: netlify` e `sha256` do corpo). Não existe campo para o
`x-eiff-form-secret` que a borda exige — logo, **a notificação nativa não suporta o formato de autenticação
atual**. ([notificações de deploy][dn], [webhooks de organização][ow])

Das duas soluções possíveis, a escolhida é a **A**: uma função server-side do próprio site, acionada pelo
evento de submissão verificada (nome de arquivo `submission-created`). Razões:

- é o único lugar onde o segredo entra **sem encostar no frontend**;
- mantém a autenticação que a borda já tem — nenhum formato novo para certificar;
- **não muda nada do site público**: nenhum HTML, nenhum script do navegador, nenhum campo novo.

A alternativa **B** (importar pela API oficial de submissões) não foi descartada: ela é a **recuperação**
(§5), e seria o transporte caso a função de evento não pudesse ser publicada.

**O fato que manda no desenho:** a documentação do evento diz que o valor devolvido pela função «não é usado
pela plataforma». **Não há reenvio automático.** Então a sequência «submissão válida → função falha → nada no
CRM» é possível, e nada no caminho do webhook a conserta. Quem conserta é a reconciliação. ([eventos][ev])

## 3. As duas gravações sem transação comum

A submissão vira evidência no Lead Engine **e** conversa no Inbox: dois subsistemas, duas tabelas, e
**nenhuma transação cobrindo os dois**. Existe um instante em que a primeira aconteceu e a segunda não.

A saída não é transação distribuída. São três coisas:

| | |
|---|---|
| **ordem fixa** | evidência primeiro. Morrendo no meio, do registro bruto se reconstrói a conversa; de uma thread não se reconstrói a evidência canônica. |
| **mesma chave** | a identidade externa da submissão (id do Netlify) é a chave de idempotência das duas gravações. |
| **reenvio completa** | o estado «evidência sim, conversa não» é caso NORMAL, não exceção: `planejarGravacao` devolve `COMPLETADO` e grava só o que faltou. |

Os quatro desfechos possíveis: `REGISTRADO` · `COMPLETADO` · `IDEMPOTENTE` · `NOVA_OBSERVACAO`.

A borda **só devolve 2xx do que o banco confirmou**: insert sem id de volta, ou RPC sem thread na volta,
viram `502` — e o reenvio completa.

## 4. O que o atendente vê

`inbox_ingest` cria o contato como «Contato não identificado» / `desconhecido`, que é o certo para um número
de WhatsApp que aparece do nada. Aqui não é do nada: a pessoa escreveu nome, empresa, telefone e cidade. Por
isso, depois da ingestão, o contato é **completado** — nome, empresa, relação `lead` e o telefone como
**segunda identidade** (não verificada), para que o WhatsApp dessa pessoa caia na mesma conversa.

A regra é **completar o que está vazio, nunca sobrescrever**: contato que já era `cliente` não é rebaixado, e
telefone que já pertence a outro contato não troca de dono (a unique do banco decide).

O texto da conversa traz o que a pessoa escreveu, a configuração do galpão, as medidas, o prazo, a leitura
técnica da página e os canais de contato. Setor, responsável e prazo de primeira resposta vêm do **Octopus
Router e da configuração do Inbox que já existiam** — sem segundo mecanismo de follow-up.

## 5. Recuperação

`scripts/formulario-reconciliar.mts` lê a API oficial de submissões verificadas e reenvia **pelo mesmo
endpoint**, com a mesma chave de idempotência. Não é um segundo caminho de entrada: é o primeiro, chamado por
outra mão.

```bash
npx vite-node scripts/formulario-reconciliar.mts -- --site <site_id> --marco 2026-11-10T00:00:00Z
```

Sem flags é **simulação**. Reenviar exige `--executar` **e** `--confirmar FORMULARIO_SITE_V1` juntos.

**Retenção, por padrão:** toda submissão anterior ao `--marco` fica retida com motivo `anterior_ao_marco`.
Há submissões reais guardadas no painel de antes de a integração existir, e processá-las é decisão comercial
com autorização própria — nunca efeito colateral de uma reconciliação de rotina. Para liberar: `--incluir-anteriores`
(e ainda assim `--excluidos` vence).

Os cinco cenários, provados em PostgreSQL real (`npm run smoke:formulario`):

| cenário | desfecho |
|---|---|
| endpoint indisponível, nada gravado | reconciliação grava do zero (`REGISTRADO`) |
| evidência gravada, conversa não | reenvio completa só a conversa (`COMPLETADO`) |
| reenvio duplicado | `IDEMPOTENTE`, nada novo |
| falha de rede depois de gravar | reenviar 3 vezes não duplica |
| nova versão da mesma submissão | nasce ao lado, conversa intacta (`NOVA_OBSERVACAO`) |

## 6. Provas

| prova | o que cobre |
|---|---|
| `npm test` | 148 testes da integração (95 novos nesta entrega): transporte, borda HTTP, gravação, portas, reconciliação, contato |
| `npm run smoke:formulario` | 27 provas em PostgreSQL real (PGlite, ROLLBACK): a cadeia inteira, os 5 cenários, a leitura pela camada da interface, o roteamento para o COMERCIAL |
| `npx vite-node scripts/radar-formulario-demo.mts` | a cadeia em memória até oportunidade e cadência CM2-B.1 |
| suíte do site | 7 testes do encaminhador (segredo fora do log, repetição, 4xx) |

O smoke declara o que **não** prova: roda como dono do banco, então GRANT e RLS não são exercidos (isso é
`pg-smoke-inbox.mjs` e o preflight), e o transporte HTTP é provado na suíte com `fetch` falso.

## 7. Checklist de ativação

Nada abaixo foi feito. Os passos 1–4 são de painel (humano); 5–7 são conferência.

| # | passo | onde |
|---|---|---|
| 1 | Cadastrar a fonte `WEBSITE` em `radar_source` e anotar o `id` | banco |
| 2 | `EIFF_FORM_SECRET` — o mesmo valor nos **dois** sites (eiff.com.br e eiffcontrol.com.br) | painel do Netlify |
| 3 | `EIFF_FORM_SOURCE_ID` = o id do passo 1 · `SUPABASE_SERVICE_ROLE_KEY` · `EIFF_INBOX_ORGANIZATION_ID` | painel do Netlify (eiffcontrol) |
| 4 | Publicar a função do site (branch `feature/formulario-para-o-crm` do eiff-site) | deploy do site |
| 5 | Conferir que o setor `COMERCIAL` tem responsável padrão e SLA na configuração do Inbox | `#/atendimento/configuracao` |
| 6 | Ensaio com uma submissão fictícia e conferência na aba Candidatos e no `#/atendimento` | app |
| 7 | Reconciliação em simulação, para ver os leads retidos antes de decidir sobre eles | `--marco` |

Variáveis **nunca** com prefixo `VITE_`, nunca em arquivo versionado, nunca em log. Sem qualquer uma delas a
borda responde `503 integracao_nao_configurada` e **não perde a submissão**: ela continua no painel do
Netlify e a reconciliação a traz.

### Decisões ainda abertas

- **Campo opcional de CNPJ no formulário.** Sem ele, a promoção para o Radar continua exigindo que a pessoa
  do comercial informe o CNPJ na hora de criar a conta (identidade forte é regra do Lead Engine, e ela não
  foi afrouxada). Com ele, a promoção fica de um clique. O formulário **não exige** CNPJ em nenhum caso.
- **Rota para o funil.** A página do simulador segue sem porta na home (48 links, nenhum para ela). A
  integração não resolve isso: ela entrega o lead que chegar.

[dn]: https://docs.netlify.com/deploy/deploy-notifications/
[ow]: https://docs.netlify.com/manage/accounts-and-billing/organization-webhooks/
[ev]: https://docs.netlify.com/build/functions/trigger-on-events/

# Formulário do site → EIFF Controle

Como a solicitação feita em `eiff.com.br/simular-galpao/` (e em `/contato/`) entra no CRM.

> Estado em 09/11/2026: **preflight de ativação concluído, NÃO ativado**. Nenhum webhook configurado,
> nenhuma credencial inserida, nada publicado. Os leads reais guardados no painel do Netlify **não foram
> processados** — a reconciliação os retém por padrão (§5).

---

## 1. O caminho

```
formulário publicado (Netlify Forms, sem mudança nenhuma no HTML)
        │
        ▼  evento de submissão verificada (a plataforma assina com JWS e confere antes de invocar)
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
envia mensagem. O motor estrutural não é acionado em nenhum ponto — e isso é medido, não afirmado: o grafo
de importação da borda tem 30 módulos, todos de `src/core`, nenhum do motor e nenhum da aplicação
(`formularioBorda.test.ts`, bloco «o que ela arrasta para o pacote da função»).

## 2. O transporte, e por que não é o nativo

**Verificado em 09/11/2026, nas duas formas que o Netlify oferece.**

**A notificação nativa de webhook não serve.** Ela faz `POST` a uma URL arbitrária, mas **não aceita
cabeçalho próprio**: o único que acrescenta é `X-Webhook-Signature`, e só quando se informa um «JWS secret
token» (HS256, com `iss: netlify` e `sha256` do corpo). Não existe campo para o `x-eiff-form-secret` que a
borda exige. ([notificações de deploy][dn], [webhooks de organização][ow])

Das duas soluções possíveis, a escolhida é a **A**: uma função server-side do próprio site, acionada pelo
evento de submissão verificada. Razões: é o único lugar onde o segredo entra **sem encostar no frontend**;
mantém a autenticação que a borda já tem; e **não muda nada do site público** — nenhum HTML, nenhum script
do navegador, nenhum campo novo.

**A forma do evento foi o achado do preflight, e quase foi ao ar errada.** O Netlify tem duas formas de
função de evento, e elas entregam coisas diferentes:

| forma | o que a função recebe | serve para nós? |
|---|---|---|
| handler tipado, `export default { formSubmitted(event) }` | `interface FormSubmittedEvent { data: Record<string, string> }` — **só os campos do formulário** | **não**: sem o id da submissão e sem o instante |
| convenção de nome de arquivo, `submission-created.mts` | um **`Request`**, com o corpo `{ payload: { id, form_name, created_at, data, … } }` | **sim** |

O tipo foi lido no pacote `@netlify/types` (`FormSubmittedEvent` tem um único campo, `data`), e a
convenção de nome de arquivo está documentada como «continua totalmente suportada», com o exemplo
`const { payload } = await req.json()`. ([eventos][ev])

Isso importa porque o id da submissão é a **chave de idempotência das duas gravações** e o `created_at` é o
instante que faz a reconciliação de amanhã produzir a mesma impressão de hoje. A função tinha a assinatura
antiga (`event.body`) num arquivo `.mts` com `export default`: a plataforma entregaria um `Request`,
`event.body` seria um stream, e **nenhuma submissão chegaria ao CRM** — sem erro visível. Corrigido: um
único `export default` (nada de `handler` ao lado, que deixaria a plataforma escolher o contrato de
chamada) e o corpo lido do `Request`, aceitando também a forma antiga `{ body: string }`.

**E o fato que manda no desenho:** a documentação do evento diz que o valor devolvido pela função «não é
usado pela plataforma». **Não há reenvio automático.** Então a sequência «submissão válida → função falha →
nada no CRM» é possível, e nada no caminho do webhook a conserta. Quem conserta é a reconciliação (§5) — e
é por isso que a solução **B** (importar pela API oficial de submissões) não foi descartada: ela não é
alternativa, é a rede de segurança obrigatória.

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

O evento e a API oficial entregam a mesma submissão com quantidade diferente de campos no topo (`number`,
`site_url`, `human_fields`, `summary`…). Nenhum deles entra na identidade nem na impressão, então os dois
caminhos produzem o **mesmo candidato** — provado em P, e é o que torna a reconciliação segura.

## 4. O que o atendente vê

`inbox_ingest` cria o contato como «Contato não identificado» / `desconhecido`, que é o certo para um número
de WhatsApp que aparece do nada. Aqui não é do nada: a pessoa escreveu nome, empresa, telefone e cidade. Por
isso, depois da ingestão, o contato é **completado** — nome, empresa, relação `lead` e o telefone como
**segunda identidade** (não verificada), para que o WhatsApp dessa pessoa caia na mesma conversa.

A regra é **completar o que está vazio, nunca sobrescrever**: contato que já era `cliente` não é rebaixado, e
telefone que já pertence a outro contato não troca de dono (a unique do banco decide).

O texto traz o que a pessoa escreveu, a configuração do galpão, as medidas, o prazo, os canais de contato e
**de onde veio** (`Origem: formulário "simular-galpao" do site (eiff.com.br).`). Setor, responsável e prazo
de primeira resposta vêm do **Octopus Router e da configuração do Inbox que já existiam** — sem segundo
mecanismo de follow-up.

### A leitura técnica da página é evidência, não parecer da EIFF

A página do simulador compara o que o visitante digitou com o que a EIFF já executou e mostra um texto
automático («vão dentro do que já foi executado», «acima do já projetado, exige estudo estrutural
específico»). Isso vai para a conversa **palavra por palavra**, porque é o que a pessoa viu antes de pedir
contato — e vai **rotulado**:

```
Mostrado ao visitante pela página (texto automático do site, não é orientação de engenharia da EIFF): …
```

A linha diz de quem é a fala antes de dizer qual é. Nenhum desses textos passou por homologação estrutural,
e o atendente não pode lê-los como parecer da engenharia para repetir ao cliente. O rótulo está numa
constante (`ROTULO_LEITURA_DA_PAGINA`) com teste que confere o início da linha.

## 5. Recuperação, e como ela opera

`scripts/formulario-reconciliar.mts` lê a API oficial de submissões verificadas e reenvia **pelo mesmo
endpoint**, com a mesma chave de idempotência. Não é um segundo caminho de entrada: é o primeiro, chamado por
outra mão.

```bash
npx vite-node scripts/formulario-reconciliar.mts -- --site <site_id> --marco 2026-11-10T00:00:00Z
```

Sem flags é **simulação**. Reenviar exige `--executar` **e** `--confirmar FORMULARIO_SITE_V1` juntos.

| | decisão do preflight |
|---|---|
| **frequência** | de hora em hora, no modo execução. Casa com o prazo de primeira resposta do Inbox (24 h): uma submissão perdida volta em até 60 min e ainda sobra dia para responder. Sem submissão nova o plano devolve lista vazia e nada é escrito. |
| **registro** | uma linha por rodada, nos dois modos: `RECONCILIACAO_RESUMO {"modo","marco","lidas","aReenviar","retidas","motivos","recuperadas","falhas"}`. Sem conteúdo de lead — só contagens. |
| **alerta** | o **código de saída**, que faz o job do agendador falhar. `0` nada a fazer ou tudo recuperado · `1` alguma submissão não entrou · `2` bloqueado antes de ler (falta token, marco ou confirmação). Não existe notificação automática porque **nenhum canal de saída está autorizado** nesta fase, nem no Inbox nem na EIFF Central. |
| **atenção humana** | `falhas > 0` em duas rodadas seguidas, ou `recuperadas > 0` com frequência — recuperar uma vez é normal, recuperar sempre significa que o evento do site está falhando, e é lá que se olha. |
| **marco inicial** | o instante em que a integração entra no ar, informado em `--marco`. Antes dele a reconciliação **retém**. |

**Os leads históricos ficam fora.** Há submissões reais guardadas no painel de antes de a integração
existir; processá-las é decisão comercial com autorização própria, nunca efeito colateral de uma rodada de
rotina. Toda submissão anterior ao marco é retida com motivo `anterior_ao_marco`, e liberá-las exige duas
portas ao mesmo tempo: `--incluir-anteriores` **e** `--confirmar-anteriores LEADS_REAIS_ANTES_DO_MARCO`.
Sem a segunda, o script sai com `2` e não lê nada.

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
| `npm test` | 154 testes da integração: transporte, borda HTTP com o corpo efetivo, gravação, portas, reconciliação, contato, grafo de importação |
| `npm run smoke:formulario` | **31 provas** em PostgreSQL real (PGlite, ROLLBACK): a cadeia inteira, os 5 cenários, a leitura pela camada da interface, o roteamento para o COMERCIAL, o mesmo id nas duas gravações |
| `npx esbuild netlify/functions/formulario-site.ts --bundle` | empacotamento: 104 KB, sem `import.meta.env`, sem react/three/vite, sem supabase-js, sem motor estrutural |
| suíte do site | 153 testes, 12 do encaminhador (forma do evento, segredo fora do log, repetição, 4xx) |

O smoke declara o que **não** prova: roda como dono do banco, então GRANT e RLS não são exercidos (isso é
`pg-smoke-inbox.mjs` e o preflight), e o transporte HTTP é provado na suíte com `fetch` falso.

## 7. Checklist de ativação

Conferido no banco de produção em 09/11/2026, **somente leitura**.

| # | passo | estado |
|---|---|---|
| 1 | fonte `WEBSITE` em `radar_source` | **pronta** — `0e238b9c-01f1-4a33-9274-de7f1af8245f`, ativa, organização EIFF |
| 2 | organização do Inbox | **pronta** — existe uma só: `e1a7e58f-29d1-4c22-b41e-597ebdeee86e` (EIFF) |
| 3 | `inbox_config` com SLA | **pronta** — Urgente 1 h · Alta 4 h · Normal 24 h · Baixa 72 h; fallback ADMINISTRATIVO, escalação DIRETORIA |
| 4 | setor `COMERCIAL` | **ativo, mas SEM responsável padrão** (`default_assignee_id` nulo) e `inbox_member` está vazio — sem isso a conversa cai no setor e **fica sem responsável** |
| 5 | `EIFF_FORM_SECRET`, o mesmo valor nos **dois** sites | falta (painel do Netlify, humano) |
| 6 | `EIFF_FORM_SOURCE_ID` = o id do passo 1 · `SUPABASE_SERVICE_ROLE_KEY` · `EIFF_INBOX_ORGANIZATION_ID` | falta (painel do eiffcontrol) |
| 7 | publicar a função do site | falta (deploy do eiff-site) |
| 8 | ensaio com submissão fictícia e conferência na aba Candidatos e no `#/atendimento` | depois de 4–7 |
| 9 | reconciliação em simulação, para ver os leads retidos antes de decidir sobre eles | depois de 5–6 |

As RPCs que gravam (`inbox_ingest`, `inbox_apply_routing`) têm EXECUTE só para `postgres` e `service_role` —
conferido. É por isso que a chave de serviço é obrigatória: a chave pública não alcança nenhuma das duas.
`SUPABASE_URL` não precisa ser definida (o código cai no projeto padrão), mas definir não faz mal.

Variáveis **nunca** com prefixo `VITE_`, nunca em arquivo versionado, nunca em log. Sem qualquer uma delas a
borda responde `503 integracao_nao_configurada` e **não perde a submissão**: ela continua no painel do
Netlify e a reconciliação a traz.

## 8. Reversão

Em ordem de reversibilidade, do mais barato ao mais caro:

| o que aconteceu | como voltar | efeito |
|---|---|---|
| quero parar a entrada JÁ | apagar `EIFF_FORM_SECRET` do site (ou do CRM) | a função do site não manda nada / a borda recusa com 401. As submissões ficam no painel do Netlify e nada se perde. |
| quero parar só a gravação | apagar `EIFF_FORM_SOURCE_ID` | a borda responde 503 `integracao_nao_configurada`. Idem: nada se perde. |
| quero tirar o caminho do ar | republicar o eiff-site sem a função (reverter o merge da branch) | o site público não muda em nada — a função é um arquivo a mais, sem efeito sobre o HTML. |
| quero desligar o atendimento | `EIFF_INBOX_ENABLED=false` | a borda recusa com 503 e a evidência também não é gravada (a ligação com o banco é uma só). |
| o que já entrou | nada é apagado | evidência é imutável por trigger e a conversa fica. Para «desfazer» um candidato, a decisão humana é REJECTED com motivo, na aba Candidatos. |

Nada disso exige migration: a integração usa 0055 + 0056 + 0057, já aplicadas. Não há o que reverter no
banco, e por isso não há risco de reversão incompleta de schema.

### Decisões ainda abertas

- **Campo opcional de CNPJ no formulário.** Sem ele, a promoção para o Radar continua exigindo que a pessoa
  do comercial informe o CNPJ na hora de criar a conta (identidade forte é regra do Lead Engine, e ela não
  foi afrouxada). Com ele, a promoção fica de um clique. O formulário **não exige** CNPJ em nenhum caso.
- **Rota para o funil.** A página do simulador segue sem porta na home (48 links, nenhum para ela). A
  integração não resolve isso: ela entrega o lead que chegar.
- **Quem é o responsável padrão do COMERCIAL.** Hoje o único perfil ativo que pode receber é o
  Administrador. Enquanto o setor não tiver responsável padrão nem membros, a conversa chega sem dono.

[dn]: https://docs.netlify.com/deploy/deploy-notifications/
[ow]: https://docs.netlify.com/manage/accounts-and-billing/organization-webhooks/
[ev]: https://docs.netlify.com/build/functions/trigger-on-events/

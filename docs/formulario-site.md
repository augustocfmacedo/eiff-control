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

**Mais dois achados de empacotamento, do lado do site.** Todo arquivo solto em `netlify/functions` é uma
função para a plataforma e a documentação não declara exceção para arquivo de teste: o teste que estava ao
lado da função seria empacotado como `submission-created.test`, levando o vitest para o deploy e publicando
um endpoint que não existe — ele foi para `src/transporte/`. E o `tsconfig.json` do site incluía só `src`,
então a função de transporte **nunca passou pelo `tsc`** do `npm run build`; agora `netlify` também entra.

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
**de onde veio** (`Origem: formulário "simular-galpao" do site (eiff.com.br).`). Setor e responsável vêm do
**Octopus Router e da configuração do Inbox que já existiam** — sem segundo mecanismo de follow-up. O prazo
de primeira resposta do lead do site tem regra própria (§4.1).

### 4.0 A fonte é conferida antes de qualquer gravação

`EIFF_FORM_SOURCE_ID` é só um id numa variável, e a evidência gravada na fonte errada é imutável. Por isso
`gravarSubmissao` começa lendo a fonte no banco (com o filtro de organização) e exige, nesta ordem: que
**exista** naquela organização, que seja do tipo `WEBSITE`, que tenha o código canônico `WEBSITE` — em
produção há outra fonte do mesmo tipo, `OFFICIAL_COMPANY_SOURCE` — e que esteja **ativa**. Falhou: `503
integracao_nao_configurada` com o motivo (`fonte_inexistente`, `fonte_nao_website`, `fonte_nao_canonica`,
`fonte_inativa`, `fonte_nao_verificada`) e **zero escrita**. A submissão fica no painel do Netlify e volta
pela reconciliação quando a variável for corrigida. Vale para a borda e para a rodada agendada.

### 4.1 Prazo de primeira resposta: 30 minutos úteis

| | |
|---|---|
| **regra** | 30 minutos de **expediente** para a primeira resposta a um lead do formulário do site |
| **expediente** | segunda a sexta, 08h–18h, `America/Sao_Paulo` |
| **feriados** | nacionais, Sexta-feira Santa e os dois de Goiânia (24/05 e 24/10), como **regras** em `src/core/inbox/calendarioComercial.ts` — valem para qualquer ano. Corpus Christi e 26/07 estão como `a_confirmar` e **não contam** até alguém conferir a base legal |
| **início** | o instante original da submissão (`created_at` do Netlify), nunca o do processamento: lead recuperado uma hora depois chega vencido, e isso é a verdade |
| **demais canais** | intocados: continuam com as horas corridas de `inbox_config.sla_hours`. Nenhuma chamada do formulário lê ou escreve essa configuração para decidir o prazo |

**Como é gravado.** A RPC `inbox_ingest` cria a conversa com as 24 h corridas da configuração e não aceita
outro prazo. Não há como pôr as duas coisas numa transação sem mudar a RPC (migration), então o prazo é um
passo **exigido e convergente** de `gravarSubmissao`: lê o prazo da conversa, decide (`decidirPrazo`), grava
só `sla_first_response_due` e **confere o valor que ficou no banco**. Sem confirmação não há sucesso — erro
na etapa `prazo`, a borda responde `502`, e o reenvio (que o plano classifica como `IDEMPOTENTE`) passa de
novo pelo passo e conserta, sem regravar evidência nem conversa. A rodada agendada só considera «já dentro»
a submissão cujo prazo também está certo.

**O prazo certo** é o menor entre o alvo desta submissão e os 30 minutos úteis contados da **abertura da
conversa**; qualquer outro valor é corrigido, maior ou menor. «Menor» importa: para um lead de sexta à noite
as 24 h corridas caem no sábado, antes da segunda-feira do calendário — o primeiro desenho mantinha «o mais
curto» e foi o smoke em PostgreSQL que achou.

| situação | o que acontece |
|---|---|
| reenvio da mesma submissão | o prazo já certo não é reescrito; o errado é consertado |
| segunda solicitação da mesma pessoa, a primeira sem resposta | mesma conversa (o e-mail é a identidade); vale o prazo da primeira |
| segunda solicitação depois de respondida a primeira | a conversa já tem primeira resposta registrada e o prazo **não é reaberto** — limite conhecido |
| conversa resolvida ou fechada | o formulário não mexe no prazo |

**Onde aparece.** No Inbox: selo `vencendo` (menos de 25% do prazo restante — com 30 minutos, 7,5 min) e
`SLA vencido`, que também põe a conversa no topo da lista e no indicador do painel; no detalhe, o instante
do vencimento. **Ninguém é avisado**: não há notificação nem agendador de escalação.

**Como se registra a primeira resposta.** Nenhum canal envia nesta fase. A resposta ao lead é por telefone
ou e-mail, fora do sistema, e o SLA é cumprido quando a pessoa **registra** a resposta na conversa (o
rascunho de resposta do compositor: `aoResponder` grava `primeiraRespostaEm` e leva a conversa a Em
atendimento). Nota interna e mudança de status **não** contam como primeira resposta. Quem ligou e não
registrou continua com o SLA correndo.

**Revisão anual do calendário.** Procedimento no cabeçalho de `calendarioComercial.ts`: conferir o
calendário do TJGO e os decretos de Goiás e de Goiânia, editar `FERIADOS`/`EXCECOES`, atualizar
`CALENDARIO_VERSAO` e `REVISADO_ATE`, rodar os testes. Um ano «esquecido» não derruba nada — as regras
valem para qualquer ano; o que se perde é uma mudança de lei.

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

| | como ela opera |
|---|---|
| **quem roda** | uma **Scheduled Function do Netlify** no eiffcontrol: `netlify/functions/formulario-reconciliar.mts`, `schedule: "@hourly"` (= `0 * * * *`, UTC). Decisão inteira em `src/core/radar/formularioAgendado.ts`, com `fetch`, ambiente e relógio injetados. O horário só vale em **deploy publicado**, e a plataforma **não** repete uma rodada que falhou — a repetição é a hora seguinte. |
| **frequência** | de hora em hora. **Não cobre o prazo de 30 minutos úteis** (§4.1): uma submissão perdida pelo evento volta em até 60 min e, dentro do expediente, já chega com o SLA vencido — a reconciliação garante que o lead não se perde, não que seja atendido no prazo. Sem submissão nova, a rodada custa poucas consultas e não escreve nada. |
| **duas chaves** | `FORMULARIO_RECONCILIACAO` tem de valer exatamente `ativa` **e** `EIFF_FORM_MARCO` tem de trazer o instante da ativação. Sem o interruptor a rodada não lê nem a lista de formulários; sem marco não começa — um marco padrão errado processaria lead real. |
| **lote** | a função agendada tem **30 s**. A rodada processa no máximo `LOTE` = 20 submissões e para quando o tempo restante chega à reserva de 8 s, devolvendo `restam`. O que ficou volta na hora seguinte. |
| **a fila anda** | antes do teto, a rodada tira da fila o que já está inteiramente dentro (evidência da MESMA impressão, conversa **e** prazo de primeira resposta certo), em três consultas por lote de 50 (`estadoEmLote`). Sem isso, as 20 vagas seriam gastas sempre nas mesmas submissões mais antigas e o resto nunca entraria — foi um defeito real, achado por teste, não uma hipótese. |
| **registro** | uma linha por rodada, inclusive quando desligada: `RECONCILIACAO_AGENDADA {"desfecho","em","marco","lidas","elegiveis","jaDentro","processadas","restam","retidas","motivosRetencao","resultados","recuperadas","falhas","duracaoMs"}`. O campo `em` é a **última execução**. Só números, motivos e instantes. |
| **alerta** | a rodada que não pôde rodar responde **503** (e o painel de Functions mostra a falha); a concluída responde 200 com o resumo. Não existe notificação automática porque **nenhum canal de saída está autorizado** nesta fase, nem no Inbox nem na EIFF Central. |
| **atenção humana** | `falhas > 0` em duas rodadas seguidas, ou `recuperadas > 0` com frequência — recuperar uma vez é normal, recuperar sempre significa que o evento do site está falhando, e é lá que se olha. |
| **retomada** | não há estado a guardar: o que ficou de fora volta na hora seguinte e, pela idempotência, entrar duas vezes não duplica. Rodada morta no meio não deixa nada pela metade — a submissão com evidência e sem conversa é o caso `COMPLETADO`, previsto e provado. |

O **script** (`scripts/formulario-reconciliar.mts`) continua sendo o caminho de mão humana — é ele que tem
`--incluir-anteriores`, e por isso a rodada agendada **não tem como** liberar lead histórico: a opção não
existe lá (prendido por teste, na fonte do módulo e no invólucro). A Scheduled Function é o **executor
único**: o workflow do GitHub Actions que existia como reserva manual (e que nunca esteve ligado) saiu do
release, porque dois executores rodariam a mesma rodada duas vezes.

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
| `npm test` | **258 testes** da integração: transporte, borda HTTP com o corpo efetivo, gravação, portas, reconciliação, rodada agendada, roteamento para o COMERCIAL, contato, grafo de importação, fonte canônica, prazo sem falso sucesso e os 31 do calendário comercial |
| `npm run smoke:formulario` | **39 provas** em PostgreSQL real (PGlite, ROLLBACK), também no Quality Gate: a cadeia inteira, os 5 cenários, a leitura pela camada da interface, o roteamento para o COMERCIAL, o mesmo id nas duas gravações, fonte errada sem escrita (Q), outro canal com 24 h e configuração intacta (R), falha no prazo sem falso sucesso e conserto no reenvio (S), sexta, feriado e segunda solicitação (T) |
| `npx esbuild netlify/functions/formulario-site.ts --bundle` | empacotamento: 118 KB, sem `import.meta.env`, sem react/three/vite, sem supabase-js, sem motor estrutural |
| `npx esbuild netlify/functions/formulario-reconciliar.mts --bundle` | a função agendada: 121 KB, `schedule: "@hourly"` no pacote, idem quanto a `import.meta.env` e ao motor |
| suíte do site | 153 testes, 12 do encaminhador (forma do evento, segredo fora do log, repetição, 4xx) |
| ensaio dos dois projetos juntos | o evento (Request) → função do site → HTTP com o segredo → borda → PostgREST/RPC falsos: 8 conferências, inclusive a ordem das duas gravações e o id do Netlify como identidade |

O smoke declara o que **não** prova: roda como dono do banco, então GRANT e RLS não são exercidos (isso é
`pg-smoke-inbox.mjs` e o preflight), e o transporte HTTP é provado na suíte com `fetch` falso.

## 7. Checklist de ativação

Conferido no banco de produção em 09/11/2026, **somente leitura**.

| # | passo | estado |
|---|---|---|
| 1 | fonte `WEBSITE` em `radar_source` | **pronta** — `0e238b9c-01f1-4a33-9274-de7f1af8245f`, ativa, organização EIFF |
| 2 | organização do Inbox | **pronta** — existe uma só: `e1a7e58f-29d1-4c22-b41e-597ebdeee86e` (EIFF) |
| 3 | `inbox_config` com SLA | **pronta** — Urgente 1 h · Alta 4 h · Normal 24 h · Baixa 72 h; fallback ADMINISTRATIVO, escalação DIRETORIA |
| 4 | setor `COMERCIAL` com responsável padrão e a regra `ROT-SITE` | **SQL pronto e não aplicado**: `scripts/formulario-ativacao-producao.sql` (idempotente, com conferência na mesma transação). Sem o responsável a conversa cai no setor sem dono; sem a `ROT-SITE` uma redação vaga sai do COMERCIAL pelas palavras do texto |
| 5 | `EIFF_FORM_SECRET`, o mesmo valor nos **dois** sites | falta (painel do Netlify, humano) |
| 6 | `EIFF_FORM_SOURCE_ID` = o id do passo 1 · `SUPABASE_SERVICE_ROLE_KEY` · `EIFF_INBOX_ORGANIZATION_ID` | falta (painel do eiffcontrol) |
| 7 | variáveis da rodada agendada: `FORMULARIO_RECONCILIACAO=ativa` · `EIFF_FORM_MARCO` (instante da ativação) · `EIFF_FORM_NETLIFY_SITE` (site_id do eiff-site) · `NETLIFY_AUTH_TOKEN` | falta (painel do eiffcontrol) |
| 8 | publicar a função do site — pela branch **`release/encaminhador-crm`**, não pela `feature/formulario-para-o-crm`: esta última carrega dois commits do «resgate do lead» que MUDAM a página pública (`src/simulador/tela.ts`, `resgate.ts`, `analytics.ts`) | falta (deploy do eiff-site) |
| 9 | ensaio com submissão fictícia (`scripts/formulario-ensaio-ficticio.json`) e conferência na aba Candidatos e no `#/atendimento` | depois de 4–8 |
| 10 | reconciliação em simulação, para ver os leads retidos antes de decidir sobre eles | depois de 5–7 |

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

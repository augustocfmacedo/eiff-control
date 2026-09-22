# Mission Control Live — contrato arquitetural

Status: **MC-LIVE-1 concluída (22/09/2026)** — o endpoint agregador existe, o GitHub é a primeira fonte viva e o
painel mostra `main`, CI, PRs e a projeção da Factory com LIVE × SNAPSHOT × STALE × UNAVAILABLE. Sem migration,
sem dependência nova, sem escrita externa. **O primeiro smoke com dados reais ainda não foi feito**: depende do
PAT `GITHUB_READ_TOKEN` ser criado e cadastrado no painel do Netlify (§ 11).

Este documento é a autoridade de desenho da iniciativa. Quando uma regra daqui divergir do código, uma das duas
está errada e a divergência tem de ser resolvida, não contornada.

---

## 1. Objetivo

Fazer o `#/mission-control` do EIFF Control **mostrar a operação**, não contar uma história sobre ela: o que foi
planejado, o que está sendo arquitetado, o que espera execução, o que está executando, o que espera decisão
humana, o que está bloqueado, o que está em validação, o que foi concluído e o que depende de quê — a partir do
estado real das fontes, sem manutenção manual de desenho.

Consequência pretendida: **o Miro deixa de ser dependência operacional.**

## 2. Princípios

1. **Não duplicar fonte de verdade.** O Mission Control observa, agrega e projeta. Ele não inventa status, não
   reordena fila e não decide nada.
2. **Gate fecha por evidência, não por cartão.** Uma task `DONE` não fecha gate. A regra de prontidão
   (`prontidao()` em [missionControl.ts](../src/core/central/missionControl.ts)) continua intacta: contagem de
   gates fechados sobre gates exigidos, cada fechado apontando para arquivo, teste ou commit que a suíte abre.
3. **O estado cru nunca some.** Toda projeção carrega `statusOrigem` e a tela mostra `Em validação · CI_RUNNING`.
4. **Indisponibilidade não vira dado.** Fonte fora do ar preserva o último estado conhecido, marcado como
   `stale`/`fonteIndisponivel`. Nunca se preenche o buraco com um estado plausível.
5. **Observar não é autoridade.** Nenhuma interação da tela escreve na Factory, no GitHub ou no Radar.
6. **Bloqueio por desenho ≠ falha.** A distinção que o Mission Control já faz entre bloqueio intencional e
   bloqueio real atravessa toda a projeção.
7. **Custo zero de serviço novo.** Nada de Miro, Monday, Jira, ClickUp, serviço de workflow, de whiteboard ou de
   realtime. Infraestrutura existente: EIFF Control, Supabase, Factory, GitHub, Netlify.
8. **Acessibilidade.** Estado sempre com texto e ícone, nunca só cor.

## 3. Fontes de verdade

| Domínio | Fonte | Entidade canônica | Como muda | Como observar | Realtime |
| --- | --- | --- | --- | --- | --- |
| Gates e arquitetura do programa | repositório `eiff-control` | `Gate`, `Workstream`, `Camada`, `Degrau` | commit com evidência conferida por teste | import direto (bundle) | não — muda no build |
| Execução dos jobs | **GitHub** (issue + label `factory:state:*`) — ADR-01 da fábrica | issue = job; `taskId` | Architect, dispatcher, supervisor, integrator, humano | `/api/factory/status` (W5 da fábrica) e, enquanto ela não existe, as issues por label | não — polling com cache |
| Estado operacional do worker | SQLite do dispatcher | `WorkerStatus` | dispatcher/supervisor, sub-minuto | apenas via `/api/factory/status` | não |
| Código e evidência | GitHub | branch, commit, PR, check run | push, PR, CI | REST/GraphQL somente leitura | não |
| Máquina Comercial | Supabase `radar_*` | `CommercialQueueItem` (projeção pura) | store do Control | recomputar `construirCommercialQueue` sobre `ds.radar` | sim (tabelas nossas) |
| Auditoria | Supabase `audit_log` | registro de ação | `registrar()` no store | leitura | sim |

**Fato que decide o desenho de realtime:** por `SECURITY.md` e `THREAT_MODEL.md` da fábrica, a Factory nunca toca
produção, banco ou segredo operacional da EIFF. Logo **a Factory não pode escrever no Supabase do EIFF Control**.
Realtime, quando existir, será publicado pelo nosso agregador — nunca empurrado pela fábrica.

## 4. Matriz de autoridade

| Ação | Quem pode | Mission Control |
| --- | --- | --- |
| Criar/alterar estado de job | Architect, dispatcher, supervisor, integrator, humano (via GitHub Broker) | só lê |
| Fechar gate | commit com evidência no `eiff-control`, conferido pela suíte | só lê |
| Ordenar a fila comercial | `construirCommercialQueue` (CM1-A) | só conta |
| Decidir canal, ação, prioridade comercial | Máquina Comercial | só exibe |
| Merge em `main` | humano | não participa |
| Mover cartão | **ninguém**: não existe essa ação nesta fase | — |

## 5. `MissionControlWorkItem`

Contrato em [src/core/central/workItem.ts](../src/core/central/workItem.ts). É **projeção**, não tabela.

- `id` determinístico: `${source}:${sourceId}`. `sourceId` vazio é recusado com erro — nunca há id aleatório.
- `correlationId` **sempre derivado de identidade canônica existente**: o `taskId` da fábrica; para gate, o id do
  gate. Nada é gerado.
- `status` ∈ `PROXIMO · ARQUITETURA · PRONTO · EXECUTANDO · AGUARDANDO_HUMANO · BLOQUEADO · EM_VALIDACAO ·
  CONCLUIDO`. `statusOrigem` guarda o estado cru e é exibido junto.
- `procedencia` (revisão da MC-LIVE-1) diz **por qual caminho o dado chegou**: `REPOSITORIO`,
  `GITHUB_PROJECTION`, `FACTORY_API` ou `DATASET`. É o que impede a projeção do GitHub de se passar por estado
  operacional da Factory.
- `updatedAt` é **opcional** (revisão da MC-LIVE-1): fonte que não informa quando o estado mudou fica sem ele.
  Nunca se usa `new Date()` no lugar — isso seria fabricar historicidade.
- `frescor` é obrigatório: `{ observadoEm, stale, fonteIndisponivel }`. `observadoEm` é quando **nós** lemos;
  `updatedAt` é quando a **fonte** mudou. São coisas diferentes e o contrato não as mistura.
- `bloqueio.porDesenho` preserva a distinção entre segurança intencional e falha.
- `links` carrega `repository · branch · commit · pullRequest · issue`.
- `dependsOn`, `parentId`, `gateIds`, `workstreamId`, `waveId` fecham os eixos de leitura.

## 6. `MissionControlEvent`

`{ id, correlationId, tipo, tipoOrigem, ocorridoEm, source, sourceId, ator, de, para, motivo, evidencia,
metadata }`.

- `id` determinístico (`source|sourceId|tipo|ocorridoEm`): a mesma ocorrência lida em duas coletas é um evento só.
- `tipoOrigem` (revisão da MC-LIVE-1) guarda o **fato bruto** da fonte antes da abstração — o `statusOrigem` do
  evento. Obrigatório.
- `de`/`para` guardam estados **crus**: a timeline conta a verdade da fonte.
- `ator` distingue `HUMAN · ARCHITECT · DISPATCHER · SUPERVISOR · WORKER · INTEGRATOR · GITHUB ·
  COMMERCIAL_MACHINE · SYSTEM`. **Ação de agente nunca vira humano inventado.**

## 7. Correlação

```
Necessidade → Issue (BACKLOG) → taskId → spec → worker → branch → commit → PR → CI → merge → gate
```

O `taskId` da fábrica é a identidade operacional da demanda a partir do momento em que ela existe. Tudo que o
GitHub sabe sobre a mesma task (branch, commit, PR, check run) entra **no mesmo cartão** por
`consolidarWorkItems`: a Factory tem precedência (estado operacional), o GitHub enriquece com links e evidência.
A mesma entidade nunca produz dois cartões.

**Origem da demanda — decisão de 22/09/2026.** A demanda de arquitetura nasce como **issue canônica no GitHub da
fábrica** e percorre `BACKLOG → SPEC_READY → ARCH_APPROVED → …`. Não existe tabela de demanda no EIFF Control.
O contrato foi desenhado para **não impedir** que, no futuro, uma demanda seja originada pela interface do EIFF
Control e crie a issue por uma ação server-side governada — mas mesmo nesse cenário **a issue continua sendo a
entidade operacional canônica**. Essa escrita **não existe** e não deve ser criada sem decisão específica.

## 8. Normalização de estados

```
FONTE REAL → ADAPTER → NORMALIZAÇÃO → MissionControlWorkItem → UI
```

A UI nunca interpreta estado cru. Mapa total dos 15 estados do job (`STATUS_POR_ESTADO_FACTORY`):

| Estado da fábrica | Situação no quadro | Por quê |
| --- | --- | --- |
| `BACKLOG`, `SPEC_READY`, `ARCH_APPROVED` | `ARQUITETURA` | a demanda existe e está sob tratamento arquitetural — é o que permite acompanhá-la desde o BACKLOG sem segunda fonte de verdade |
| `READY` | `PRONTO` | admitida: dependências, budget e vaga resolvidos |
| `CLAIMED`, `CODING`, `TESTING` | `EXECUTANDO` | worker com a bola |
| `PR_OPEN`, `CI_RUNNING`, `ARCH_REVIEW`, `INTEGRATED` | `EM_VALIDACAO` | o código existe e está sendo conferido |
| `QA_REVIEW`, `AWAITING_HUMAN` | `AGUARDANDO_HUMANO` | destaque próprio; não é falha |
| `BLOCKED` | `BLOQUEADO` | |
| `DONE` | `CONCLUIDO` | |

`PROXIMO` é alcançado por gate aberto e por categoria comercial de espera (`NURTURE`, `AGENDADO`) — não por job.

Responsável por estado (`ATOR_POR_ESTADO_FACTORY`) deriva da coluna "Quem sai dele" de
`docs/TASK_STATE_MACHINE.md` da fábrica. `ARCH_APPROVED` com lane `RED` aponta para o humano.

Eventos: os 17 `COMMENT_KINDS` da fábrica traduzem para o catálogo `MC_TIPOS_EVENTO`
(`tipoEventoDoComentario`), com `WORKER_REPORT` e `CI_RESULT` resolvendo em passou/falhou.

## 9. Mapa de dependências

Modelo em [src/core/central/mapaVivo.ts](../src/core/central/mapaVivo.ts): `NOS` (derivados de `CAMADAS` para a
Central, mais os nós do ciclo de desenvolvimento e da Máquina Comercial) e `ARESTAS` com quatro tipos:

- `fluxo` — A entrega para B no caminho normal;
- `dependencia` — B não funciona sem A;
- `observa` — A apenas lê B (**é a aresta do Mission Control**);
- `evidencia` — A prova o estado de B.

Invariantes presas por teste: toda aresta liga nós existentes; nenhum ciclo entre arestas que implicam ordem;
todo gate citado existe; **todas as arestas que saem de `MISSION_CONTROL` são `observa`** e nada depende dele.

Gate: `MAPA_VIVO` (a tela é a MC-LIVE-4; sem dependência nova, SVG e CSS).

## 10. Integração com a Factory

Autoridade dos estados: **`packages/contracts/src/estados.ts` e `packages/contracts/src/api.ts` no repositório
`augustocfmacedo/eiff-dev-factory`**. O EIFF Control não redefine estado nenhum.

Como os repositórios são separados, `workItem.ts` mantém um **espelho declarado** (`ESPELHO_JOB_STATES`,
`ESPELHO_LANES`, `ESPELHO_WORKER_ROLES`, `ESPELHO_FACTORY_STATES`, `ESPELHO_COMMENT_KINDS`, `ESPELHO_ACTORS`).

### Contract drift detection

1. **Teste automático local** (`workItem.test.ts`, bloco "contract drift"): abre
   `$EIFF_FACTORY_REPO/packages/contracts/src/estados.ts` — ou `../eiff-dev-factory` quando os repositórios são
   irmãos no disco — extrai os catálogos e **reprova qualquer divergência** com o espelho.
2. **No CI do `eiff-control` o clone da fábrica não existe** (checkout de um repositório só). Lá o teste degrada
   para a conferência de cardinalidade e este documento passa a ser o rito: **antes de integrar qualquer wave
   MC-LIVE, rodar a suíte com os dois repositórios lado a lado.**
3. **Do lado da fábrica**, mudar um catálogo de `packages/contracts` é mudança de contrato público: exige nota no
   PR citando este documento. A W5 da fábrica (`packages/api` + `docs/API_READONLY.md`) deve registrar o EIFF
   Control como consumidor.
4. Evolução sem quebra: acrescentar estado novo ao fim do catálogo faz o teste falhar de forma explícita — que é
   exatamente o comportamento desejado. O mapa `STATUS_POR_ESTADO_FACTORY` é total e não compila incompleto.

Gate: `FACTORY_ADAPTER_READONLY`.

### O que existe hoje — **GitHub projection of Factory**

A fábrica está na **W1** ("um job à mão"). **`packages/api` não existe**, não há VM, não há
`factory.eiffcontrol.com.br` e não há `FACTORY_READ_TOKEN`. O que é consultável hoje são as issues do GitHub com
as labels `factory:state:*` — que já são canônicas por ADR-01.

Desde a MC-LIVE-1 o painel mostra essa projeção, e ela é **declarada como tal em três lugares**: no dado
(`procedencia: 'GITHUB_PROJECTION'` em cada work item), na resposta (`factory.aviso`) e na tela (etiqueta
"projeção do GitHub"). O que **não** é exibido, porque não existe nesta fonte: heartbeat, turno (`turn`), lease,
custo e última ferramenta. Um teste varre a resposta atrás desses campos.

| | Factory live operational state | GitHub projection of Factory (hoje) |
| --- | --- | --- |
| Fonte | SQLite do dispatcher via `/api/factory/status` | issues + labels `factory:state:*` |
| Estado do job | os 15 estados, em tempo quase real | o mesmo estado, na latência do polling |
| Worker, turno, lease, custo | sim | **não existe** |
| Wave | MC-LIVE-2 (depende da W5 da fábrica) | **MC-LIVE-1, no ar** |

## 10-A. O endpoint `/api/development-status` (MC-LIVE-1)

`GET /api/development-status` — Netlify Function v2 com `config.path`, a mesma convenção de `/api/comunicacao`.
Não existe segundo contrato nem rota alternativa.

```
request → JWT → usuário do Supabase → perfil REAL no banco (role, active)
        → pode(usuario, 'ver_mission_control')   [MATRIZ única do Control]
        → adapter do GitHub (allowlist server-side)
        → normalização → sanitização → response
```

| Situação | Resposta |
| --- | --- |
| sem `Authorization` | **401** `{ erro: 'nao_autenticado' }` — o GitHub nem é consultado |
| JWT inválido | **401** |
| sem perfil na tabela `profile` | **403** `{ erro: 'sem_perfil' }` |
| papel sem `ver_mission_control` (ou perfil inativo) | **403** `{ erro: 'sem_permissao' }` — o GitHub nem é consultado |
| método ≠ GET | **405** |
| autorizado | **200** com o corpo abaixo |

O papel **nunca** vem do navegador. O corpo (`DevelopmentStatusResposta` em `statusServidor.ts`):

```ts
{
  observadoEm: string,                       // quando o servidor leu
  build: { sha: string | null, origem: 'COMMIT_REF' | null },
  fontes: { github: { fonte, disponivel, stale, observadoEm, erroCodigo?, limite?, chamadas, maxChamadasPorCiclo } },
  repositorios: [{ repository, papel, ramoPrincipal, observadoEm, disponivel, erroCodigo?,
                   main: { sha, shaCurto, commitadoEm?, titulo? } | null,
                   ci: { situacao, statusOrigem, nome?, concluidoEm?, url? } | null,
                   pullRequests: [...], issues: [...], chamadas }],
  workItems: MissionControlWorkItem[],       // contrato da MC-LIVE-0
  contagens: Record<McStatus, number>,
  factory: { procedencia: 'GITHUB_PROJECTION', aviso, repositorio, contagens },
  limiteStaleSegundos: number
}
```

O que **nunca** sai: token, header do GitHub, URL autenticada, objeto integral da API, stack trace. A resposta é
montada campo a campo a partir do contrato — nada é serializado direto do GitHub.

## 11. Integração com o GitHub

Decisão de 22/09/2026: **PAT fine-grained somente leitura**, restrito a `augustocfmacedo/eiff-control` e
`augustocfmacedo/eiff-dev-factory`, com o mínimo para metadata, branches, commits, issues, labels, pull requests
e checks. Nenhuma permissão de escrita. Migração futura para GitHub App **não altera o contrato do Mission
Control**.

- O token existe **apenas no ambiente de deploy** (painel do Netlify), com o nome **`GITHUB_READ_TOKEN`**. Nunca
  `VITE_*`, nunca no navegador, no bundle, no banco, em log ou em resposta de API.
- Adapter puro com `fetch` injetado, no padrão de `metaServidor.ts`/`comunicacaoServidor.ts`.

### Permissões do PAT (mínimo necessário)

Fine-grained, **only select repositories**: `augustocfmacedo/eiff-control` e `augustocfmacedo/eiff-dev-factory`.

O código chama **exatamente quatro endpoints**, e nada além disso:

| Endpoint | Permissão | Por quê |
| --- | --- | --- |
| `GET /repos/{r}/commits/main` | Contents: Read | SHA, data e título do último commit |
| `GET /repos/{r}/commits/{sha}/check-runs` | Checks: Read | situação do CI |
| `GET /repos/{r}/pulls?state=open` | Pull requests: Read | PRs abertos |
| `GET /repos/{r}/issues?labels=factory:task` | Issues: Read | projeção da Factory |
| (qualquer leitura de repositório) | Metadata: Read | obrigatória |

**Concedido em 22/09/2026: Metadata, Contents, Issues, Pull requests, Checks — todas Read.** Nenhuma permissão de
escrita, nada de Administration, Secrets ou Webhooks, e acesso só aos dois repositórios.

- **`Actions: Read` NÃO foi concedido e NÃO é necessário.** O painel lê **check runs** (`/commits/{sha}/check-runs`),
  que é a API de Checks; não existe nenhuma chamada a `/actions/…` no código, e um teste varre `src/` e `netlify/`
  atrás delas. *(Correção: uma versão anterior desta tabela pedia `Actions: Read` "se a evolução exigir" — era
  permissão pedida a mais, sem uso. Removida.)*
- **`Commit statuses: Read` NÃO foi pedido**: o painel usa check runs, não a statuses API. Se algum dia precisar,
  a necessidade é justificada **antes**, nunca contornada trocando de endpoint.

### REST, não GraphQL

REST resolve com poucas chamadas e contrato claro por endpoint; GraphQL exigiria uma query própria e um schema a
manter para economizar 4 requisições dentro de um orçamento de 5.000/h. Escolha: **REST**.

### Chamadas por ciclo e rate limit

**Teto de 7 chamadas por ciclo** (`MAX_CHAMADAS_POR_CICLO`), e o número real vai na resposta
(`fontes.github.chamadas`):

| Repositório | Chamadas |
| --- | --- |
| `eiff-control` | commit de `main`, check-runs do SHA, pulls = **3** |
| `eiff-dev-factory` | as três acima + issues com `factory:task` = **4** |

**Nunca há chamada por cartão**: PRs e issues vêm em lista, e o CI lido é o do `main` de cada repositório — o CI
por PR exigiria uma chamada por PR e por isso não é lido nesta fase. Só o servidor fala com o GitHub; o navegador
chama exclusivamente `/api/development-status`.

Limite: lido dos cabeçalhos `x-ratelimit-*` da própria resposta (**sem chamada extra**) e exposto como
`{ restante, total, reiniciaEm }` — nenhum outro header atravessa a fronteira. Em `403` com limite zerado ou `429`
o código é `RATE_LIMIT`, a fonte fica indisponível e **o último estado conhecido permanece**: nunca vira lista
vazia.

### Cache

`ETag`/`If-None-Match` com o corpo guardado na memória do processo da função — **otimização oportunista**, nunca
requisito de consistência: instância nova simplesmente refaz as chamadas completas. Não há Redis, banco de cache
nem serviço externo. Cache persistente é MC-LIVE-5.

### Degradação por capacidade (correção do smoke real)

`Checks` **não é oferecido** na interface do Fine-grained PAT para estes repositórios. O PAT concedido em
22/09/2026 tem Metadata, Contents, Issues e Pull requests — tudo Read — nos dois repositórios.

Por isso o adapter trata cada capacidade separadamente:

| Falhou | Resultado |
| --- | --- |
| commit de `main` | repositório **indisponível** — é a fundação: sem `main` não há o que observar |
| check runs | repositório **LIVE**, `ci: null`, `erroCi: CHECKS_PERMISSION_UNAVAILABLE` |
| pull requests | repositório **LIVE**, lista vazia **com** `erroPullRequests` |
| issues | repositório **LIVE**, lista vazia **com** `erroIssues` |

Lista vazia nunca significa "não há": significa "não foi lido", e o código diz por quê. Rate limit no endpoint
de checks continua `RATE_LIMIT` — o motivo real nunca é substituído pelo genérico.

Gate: `GITHUB_ADAPTER_READONLY` — segue aberto até a prova publicada completa.

## 12. Integração com a arquitetura

Ver § 7. Enquanto a demanda vive só como issue, o Mission Control a mostra em `ARQUITETURA` com o estado cru
(`BACKLOG`, `SPEC_READY`, `ARCH_APPROVED`) ao lado. O Architect produz os metadados de correlação ao escrever o
contrato do job (`taskId`, `repository`, `allowedPaths`, `dependencies`) — nada novo é exigido dele nesta fase.

## 13. Integração com a Máquina Comercial

`Radar → Commercial Queue → Commercial Action Plan → Cadence → Task Suggestion → radar_task` continua intocada.
O Mission Control chama `construirCommercialQueue` e `resumoPorModoCM` sobre o `ds.radar` já carregado e **conta**.

- `normalizarComerciais` **preserva a ordem recebida** — a fila é da Máquina Comercial.
- Trava bloqueante vira `BLOQUEADO`; a categoria crua continua visível.
- Nenhuma tabela nova, nenhuma segunda fila, nenhuma mudança de prioridade, canal ou decisão.

## 14. Gates

Oito gates novos declarados na MC-LIVE-0, todos na frente **Mission Control**, camada **Auditoria e operação**,
degrau **Piloto** — o mesmo lugar onde `MISSION_CONTROL_LIVE` já estava.

| Gate | Objetivo | Prova necessária | Evidência esperada | Depende de |
| --- | --- | --- | --- | --- |
| `DEVELOPMENT_STATUS_ENDPOINT` **(fechado na MC-LIVE-1)** | um agregador server-side do estado da construção | JWT → perfil do banco → `ver_mission_control`; agrega GitHub e Factory numa resposta; cache; nenhum segredo na saída; 403 para quem sabe a URL e não tem a permissão | `netlify/functions/development-status.ts`, `statusServidor.ts`, `developmentStatus.test.ts` | — |
| `GITHUB_ADAPTER_READONLY` | ler o GitHub sem expor nada | SHA de `main`, check runs, PRs e issues por adapter puro; token só no painel do Netlify; teste varrendo bundle e código | `src/core/central/githubAdapter.ts` + teste | `DEVELOPMENT_STATUS_ENDPOINT` |
| `FACTORY_ADAPTER_READONLY` | consumir a fábrica pelo contrato dela | os 15 estados vêm do contrato da fábrica; teste de contract drift reprova divergência; leitura sem nenhum caminho de escrita | `src/core/central/factoryAdapter.ts` + drift test | `DEVELOPMENT_STATUS_ENDPOINT` |
| `WORK_ITEM_CORRELACAO` | a cadeia inteira num cartão | issue→taskId→worker→branch→commit→PR→CI→merge→gate correlacionados sobre **fonte real**; id determinístico; zero duplicata | `workItem.ts` + teste sobre dados reais | `GITHUB_ADAPTER_READONLY`, `FACTORY_ADAPTER_READONLY` |
| `MAPA_VIVO` | dependências com estado real | grafo desenhado do modelo, sem ciclo, cada nó com o estado da sua fonte, clique abrindo detalhe, sem dependência nova | `src/ui/MapaVivo.tsx` + teste | `WORK_ITEM_CORRELACAO` |
| `EXECUCAO_LIVE` | quadro como projeção | colunas derivadas das fontes; estado cru sempre visível; nenhuma interação escreve em fonte alguma (teste varre o código) | `src/ui/KanbanExecucao.tsx` + teste | `WORK_ITEM_CORRELACAO` |
| `MC_REALTIME` | o cartão muda sozinho | mudança chega sem recarregar; queda do canal não para a tela; polling nunca desligado, só espaçado | canal + teste | `EXECUCAO_LIVE` |
| `MC_DEGRADACAO` | queda não vira dado falso | GitHub ou Factory fora do ar mantêm o último estado como stale, com hora da última sincronização, e o painel segue utilizável | `preservarUltimoConhecido` + teste sobre fonte real | `DEVELOPMENT_STATUS_ENDPOINT` |

`MISSION_CONTROL_LIVE` permanece **aberto** e passa a ser a **conclusão do conjunto**: só fecha quando os oito
fecharem com evidência. Nenhum deles fechou na MC-LIVE-0 — contrato escrito não é fonte viva.

**Por que a prontidão caiu.** O catálogo foi de 30 para 38 gates e os fechados continuam 19: 63% → 50%. Não houve
regressão; houve reconhecimento formal de trabalho que já era necessário e estava representado por um único gate
("Mission Control em tempo real"), que não se fecha por partes. Prontidão honesta vale mais que prontidão alta.

## 14-A. Eventos ainda não são emitidos (MC-LIVE-1)

A projeção do GitHub **não gera `MissionControlEvent`** nesta wave. O motivo é a regra do proprietário: o
Mission Control não infere. Sem a linha do tempo estruturada da issue (ou a API da fábrica), o que existe são
datas de criação/atualização — e delas não se deduz "testes passaram" nem "CI começou". Por isso:

- `tipoEventoDoComentario(kind, ok)` só devolve `TEST_PASSED`/`TEST_FAILED` e `CI_PASSED`/`CI_FAILED` quando a
  fonte entrega o resultado em campo estruturado (`ok`); sem ele, o evento é `TASK_PROGRESS`;
- todo evento carrega `tipoOrigem` com o **fato bruto** da fonte (`WORKER_REPORT`, `check_run:completed`), do
  mesmo jeito que todo item carrega `statusOrigem`;
- `updatedAt` é **opcional** no contrato: fonte que não informa data de alteração fica sem ela — `new Date()`
  nunca é usado como se fosse data do fato. O momento da observação mora em `frescor.observadoEm`.

Eventos entram na MC-LIVE-3/7, com fonte que os prove.

## 15. Realtime (futuro, MC-LIVE-5)

Preferência: `mudança de estado → evento → projeção → Mission Control → realtime → UI`. Mas a Factory não pode
escrever no nosso Supabase (§ 3), então quem publica é o agregador. Desenho previsto:

1. Uma função agendada do Netlify lê as fontes e grava a projeção no Supabase (service role, escrita server-only,
   no padrão já provado em `radar_delivery_create`, migration 0047).
2. O navegador assina `postgres_changes` dessa tabela (primeiro uso de Supabase Realtime no sistema).
3. **O polling controlado nunca é desligado**, só espaçado enquanto o canal está vivo — queda do canal degrada
   para o comportamento da MC-LIVE-1.

A migration (`central_work_projection`, e possivelmente `central_work_event`) só nasce na MC-LIVE-5, com
justificativa própria. A numeração livre é **0055** (0052 está reservada para `AUDITORIA_CENTRAL`).

## 15-A. Polling (MC-LIVE-1)

`INTERVALO_STATUS_MS = 60 s`. GitHub não é heartbeat de worker: 1, 2 ou 5 segundos seria pressão inútil sobre a
API e sobre a função. Em erro o intervalo dobra a cada falha seguida até `INTERVALO_MAXIMO_MS = 300 s`, e volta
a 60 s na primeira leitura boa. `AbortController` em toda chamada, cancelamento no unmount, e uma guarda
explícita impede duas chamadas sobrepostas. O botão "Atualizar" reinicia o ciclo.

## 15-B. `build.sha` × `github.main.sha` — duas coisas diferentes

| | O que é | De onde vem |
| --- | --- | --- |
| `build.sha` | o commit **deste artefato publicado** — a tela que você está olhando | `COMMIT_REF`, capturado no **build** por `scripts/gerar-build-sha.mjs`, que grava `src/core/central/buildSha.ts` |
| `github.main.sha` | o commit **atual do `main`** no GitHub | leitura ao vivo do adapter (`GET /repos/{r}/commits/main`) |

A comparação entre os dois é o que produz `LIVE` (iguais) ou `SNAPSHOT` (o artefato está atrás do main).
Num **Deploy Preview isso é normalmente SNAPSHOT e não é erro**: o preview publica a branch do PR enquanto o
`main` segue em outro commit. O que não pode acontecer é `DESCONHECIDO` em produção.

**Por que a captura acontece no build.** O Deploy Preview 5 provou que `COMMIT_REF` existe no ambiente de
**build** do Netlify e **não** no runtime da Function: `process.env.COMMIT_REF` dentro da função devolvia
sempre vazio e a comparação ficava cega. O Netlify empacota as funções **depois** do comando de build, então o
módulo gerado entra no bundle. Regras do gerador: nenhum SHA escrito à mão, nenhuma chamada extra ao GitHub,
e ausência de informação vira `null` — a tela diz "desconhecido" em vez de mostrar um valor plausível. Fora do
Netlify (desenvolvimento local, CI do GitHub) o arquivo gerado é sempre `null`, então ele fica estável no
repositório e nenhum build local suja a árvore.

## 16. Frescor e stale

Toda leitura carrega `observadoEm`. `avaliarFrescor` marca `stale` quando passa do limite da fonte — limite por
fonte, porque worker envelhece em segundos e gate em dias — e **data ilegível nunca passa por fresca**. A tela
mostra a hora da última sincronização, e item stale ganha marcador textual, não só cor.

## 17. Degradação (failure modes)

| Falha | Comportamento | O que a tela diz |
| --- | --- | --- |
| GitHub indisponível / 5xx / rate limit | mantém o último estado conhecido | "GitHub indisponível · última sincronização hh:mm" |
| Factory indisponível | último estado conhecido, marcado stale | "Factory indisponível · último estado conhecido" |
| Factory sem `packages/api` (hoje) | fallback por labels do GitHub | fonte declarada no rodapé do bloco |
| Token ausente/ inválido | bloco vazio com causa | nunca um estado plausível inventado |
| Canal realtime cai | volta ao polling curto | indicador de "ao vivo" apaga |
| Supabase fora | painel de gates continua (vem do bundle) | blocos remotos em estado de erro |
| Resposta fora do schema | descartada | tratada como fonte indisponível |

Nenhum destes casos pode derrubar o painel: a prontidão por gate não depende de rede.

Na MC-LIVE-1 isso deixou de ser promessa: o cliente (`src/data/statusRemoto.ts`) **preserva o último dado
válido** em toda falha, aumenta o intervalo (60 s → 120 s → … → teto de 300 s), cancela com `AbortController`
e nunca deixa duas leituras em voo. Repositório indisponível devolve `disponivel: false` com código fechado e
`pullRequests: []` — a ausência de leitura **não** é apresentada como "nenhum PR". Sem token, a fonte volta
como `NOT_CONFIGURED` e **zero** chamadas são feitas ao GitHub.

## 18. Segurança

- `ver_mission_control` (Administrador e Diretoria) é conferida **na rota e no endpoint** (MC-LIVE-1), sempre
  pela MATRIZ única do Control, com o papel lido da tabela `profile`. Esconder do menu não é controle de acesso.
- O endpoint **não aceita repositório do cliente**: a allowlist é server-side e não existe parâmetro de
  repositório. Ele não pode ser usado como proxy do GitHub.
- Segredos só no painel do Netlify. Nenhuma variável `VITE_*` para GitHub ou Factory.
- Factory e GitHub são **somente leitura** a partir do Mission Control. Não existe ação de mover cartão.
- A resposta do agregador é montada a partir de schema explícito, nunca serializando objeto interno — mesmo
  princípio de `CAMPOS_PROIBIDOS_API` na fábrica. Sem token, sem prompt, sem diff, sem telefone.
- Conteúdo lido do GitHub (título de issue, corpo de PR, nome de branch) é **dado, nunca instrução**, e é
  sanitizado antes de exibido.

## 19. Observabilidade e auditoria

Mudança significativa registra `timestamp · source · sourceId · correlationId · actorType · actorId ·
oldStatus · newStatus · reason · evidence · metadata`. `actorType` distingue humano de agente; **ação de agente
nunca vira usuário humano**. A telemetria local existente (`src/data/telemetria.ts`) continua local e anônima.

## 20. Miro

**O Miro não é fonte de verdade nem dependência desta arquitetura.** Não há integração com a API do Miro, não há
importação de board, não há reprodução de funcionalidade genérica de whiteboard. O objetivo é eliminar a
necessidade operacional de manter quadro paralelo — construindo **observabilidade visual da operação da EIFF**,
não um clone do Miro.

## 21. Waves

| Wave | Entrega | Situação |
| --- | --- | --- |
| **MC-LIVE-0** | contratos, modelo do mapa, gates, este documento, correção do drift documental | **concluída (22/09/2026)** |
| **MC-LIVE-1** | `/api/development-status` + GitHub vivo, bloco "Desenvolvimento ao vivo", LIVE × SNAPSHOT × STALE × UNAVAILABLE | **concluída (22/09/2026)**; falta o smoke real com o PAT |
| MC-LIVE-2 | adapter da Factory + fallback por labels (`FACTORY_ADAPTER_READONLY`) | depende da W5 da fábrica |
| MC-LIVE-3 | correlação e eventos (`WORK_ITEM_CORRELACAO`) | — |
| MC-LIVE-4 | Mapa Vivo (`MAPA_VIVO`) | — |
| MC-LIVE-5 | quadro de execução + realtime (`EXECUCAO_LIVE`, `MC_REALTIME`) — única migration prevista | — |
| MC-LIVE-6 | projeção comercial | — |
| MC-LIVE-7 | eventos, timeline e observabilidade | — |
| MC-LIVE-8 | hardening e fechamento de `MISSION_CONTROL_LIVE` | — |

## 22. Diagrama

```
ARCHITECTURE / ISSUE
        ↓
      taskId
        ↓
     FACTORY
        ↓
      GITHUB
        ↓
 NORMALIZATION          (src/core/central/workItem.ts)
        ↓
MISSION CONTROL         (ver_mission_control, server-side)
        ↓
Mapa Vivo / Kanban / Eventos
```

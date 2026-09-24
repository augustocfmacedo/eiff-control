# Mission Control Live — contrato arquitetural

Status: **MC-LIVE-2A concluída (22/09/2026)** — o `#/mission-control` tem o **quadro operacional V0** (§ 14):
Kanban de projeção sobre `MissionControlWorkItem`, com filtros, busca e contadores, no mesmo polling de 60 s.

Status: **MC-LIVE-1 certificada, 2A e 2B entregues (22/09/2026)** — o endpoint agregador existe, o GitHub é a
primeira fonte viva, o painel mostra `main`, CI, PRs e a projeção da Factory com LIVE × SNAPSHOT × STALE ×
UNAVAILABLE, e o quadro operacional lê os mesmos itens. Sem migration, sem dependência nova, sem escrita externa.
**O smoke com dados reais foi feito** no Deploy Preview do PR #6 com o PAT já cadastrado no painel do Netlify
(§ 11 e § 16). A Factory continua sendo observada **através do GitHub**: a API da fábrica não existe nesta linha.

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
  factory: { procedencia: 'GITHUB_PROJECTION', aviso, repositorio, repositorios, contagens },
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

**Teto de 8 chamadas por ciclo** (`MAX_CHAMADAS_POR_CICLO`), e o número real vai na resposta
(`fontes.github.chamadas`):

| Repositório | Chamadas |
| --- | --- |
| `eiff-control` | commit de `main`, check-runs do SHA, pulls, issues com `factory:task` = **4** |
| `eiff-dev-factory` | as mesmas quatro = **4** |

Era 7 até a **ponte de visibilidade da fábrica**: o produto não lia issues. O número é DERIVADO da
allowlist (`observarIssues ? 4 : 3`), nunca digitado — ligar issues num repositório recalcula o teto e o
teste que compara teto × chamadas reais acompanha sozinho. O custo por ciclo não depende da quantidade de
cartões: **não existe chamada por item**.

### Onde um job vive (ponte de visibilidade da fábrica)

O contrato canônico da fábrica é explícito na primeira linha de `JOB_CONTRACT.md`:

> Um job é **uma issue** no repositório-alvo (não no repositório da fábrica)

e o próprio YAML do job carrega `repository: augustocfmacedo/eiff-control`. Logo um job real do produto
nasce como issue **no `eiff-control`**. Enquanto o Mission Control só lia issues do `eiff-dev-factory`, um
job com `factory:task` + `factory:state:CODING` no produto ficava **invisível** — uma lacuna silenciosa,
que não aparecia como erro nem como lista vazia suspeita: simplesmente não era procurado.

Duas correções, nenhuma delas nova fonte de verdade:

1. **todo repositório-alvo da allowlist é observado** (`observarIssues: true` nos dois). Isso não amplia a
   allowlist, não aceita repositório do cliente e não cria `?repo=`: continua a mesma lista fixa server-side;
2. **Factory passa a significar a FONTE do item, não o endereço dele.** A contagem filtra
   `source === 'FACTORY'` — que a normalização atribui quando a issue carrega `factory:state:*`, esteja ela
   onde estiver. Filtrar por `links.repository` fazia "fábrica" querer dizer "mora no repositório da
   fábrica", e escondia justamente os jobs do produto. `factory.repositorios` (plural) diz onde as issues
   são procuradas; `factory.contagens` diz o que a fábrica produziu, em qualquer repositório.

A projeção segue idêntica — `issue → factory:task → factory:state:* → normalização →
MissionControlWorkItem` — e continua sem escrita.

### Identidade canônica da tarefa (bloco `factory-task:v1`)

Pelo `JOB_CONTRACT.md`, o título da issue é `[factory] <título curto>` e a identidade do job é o campo
`taskId` **dentro do bloco delimitado** no corpo:

```
<!-- factory-task:v1 -->
```yaml
taskId: EC-0042                # comentário inline permitido
repository: augustocfmacedo/eiff-control
…
```
<!-- /factory-task -->
```

Extrair o `taskId` do título, como a primeira versão da ponte fazia, só funcionava para issues fora do
contrato — uma issue canônica e o PR dela viravam **dois cartões**. Agora `lerIdentidadeCanonica`
(`githubAdapter.ts`) lê o bloco no servidor, em trânsito, e o corpo **nunca** entra em `IssueObservada` nem
na resposta. Não existe leitor executável desse bloco na fábrica (`parseJobContract` valida um objeto já
extraído; `lerRelatorioDoPr` lê o bloco JSON do PR), então a extração aqui é mínima e explícita: só `taskId`
e `repository`, escalares de nível superior, sem parser YAML e sem dependência nova.

Regras, todas com teste: exatamente um bloco; `taskId` e `repository` uma vez cada; `taskId` no formato
canônico ancorado (espelho de `TASK_ID` em `texto.ts`); `repository` igual ao repositório onde a issue está.
Qualquer desvio devolve `taskId: null` com uma recusa do catálogo fechado (`SEM_BLOCO`, `BLOCOS_AMBIGUOS`,
`CHAVE_DUPLICADA`, `SEM_TASK_ID`, `TASK_ID_INVALIDO`, `SEM_REPOSITORIO`, `REPOSITORIO_DIVERGENTE`) — e a
issue fica referenciada por `repositório#número`, sem correlação inventada. Um identificador solto no título
ou na prosa nunca é consultado; um `[EC-0099]` no título não vence um `EC-0042` no bloco.

Para o PR, a identidade é a **branch** `factory/<taskId>-a<n>` (espelho de `lerBranchDoJob` em `refs.ts`),
porque a fábrica a gera a partir do `taskId`; o título é último recurso para PR humano fora do padrão e nunca
vence a branch. Com issue canônica e PR na branch canônica, o resultado é **um cartão só**: a fábrica tem
precedência sobre o GitHub, então o PR enriquece os links sem nunca sobrescrever o estado operacional do job.
O corpo já vem na listagem `GET /issues`: nenhuma chamada por issue, teto inalterado em 8.

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

Gate: `GITHUB_ADAPTER_READONLY` — a prova real já existe (§ 16: leitura viva dos dois repositórios com o PAT e
varredura do bundle publicado sem nenhum vestígio do token). O gate fecha quando a linha integrada estiver
publicada e o smoke final repetido sobre ela; até lá a nota de evidência em `missionControl.ts` continua como
está, porque estado de gate não se fecha por documento.

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

## 15-C. Smoke publicado — 22/09/2026 (Deploy Preview 6)

Primeira leitura REAL do GitHub pelo artefato publicado. Branch `feature/mission-control-live-cert`,
commit `11dfd95`, deploy `6ab2c4c4e5f64e000804d36e`, contexto `deploy-preview`, PR #6 DRAFT.

| | Resultado |
| --- | --- |
| `GET /api/development-status` sem sessão | **401** `{"erro":"nao_autenticado"}` |
| `POST` | **405** |
| `GET` com a sessão do Administrador | **200**, pela própria aplicação |
| `build.sha` | **11dfd95** — a correção do § 15-B funcionou; deixou de ser "desconhecido" |
| `github.main.sha` (eiff-control) | **88c9ccc**, commitado em 2026-09-22T13:38:05Z |
| classificação | **SNAPSHOT** — "esta tela é a publicação de 11dfd95; o main observado já está em 88c9ccc". Num preview isso é o esperado, não um erro |
| `eiff-control` | **LIVE** · CI **verde** (`completed:success`) · **3 PRs** abertos (#6, #5, #2) |
| `eiff-dev-factory` (repositório **privado**) | **LIVE** · main **88f999d** · **CI indisponível** · 0 PRs · **0 issues** `factory:task` |
| chamadas no ciclo | **7** (teto 7) · limite restante **4706 de 5000** |
| correlação real | **parcial** — nenhum PR carrega `taskId` e a fábrica ainda não tem issue de job, então a cadeia issue → taskId → PR não existe naturalmente. Nada foi fabricado para completá-la |
| bundle publicado | **40 chunks** varridos: sem `GITHUB_READ_TOKEN`, sem `api.github.com`, sem `Authorization: Bearer`, sem `x-github-api-version`, sem padrão de PAT. O único chunk que fala de rede de status é `MissionControl-*.js`, e só com `api/development-status` |
| logs da Function | **nenhuma linha** em 30 minutos, cobrindo todo o smoke — coerente com o código, cuja única saída é `console.error('[development-status]', e.name)` |

> Registro datado, preservado como estava. **O teto passou a 8 depois**, com a ponte de visibilidade da
> fábrica (o produto passou a ter suas issues `factory:task` lidas). Um smoke novo deve esperar
> **8 (teto 8)** — e a correlação issue → taskId → PR deixa de ser estruturalmente impossível no produto.

**`Checks` não é oferecido no PAT fine-grained** destes repositórios. O CI da fábrica aparece como
indisponível e **o repositório continua LIVE**: é a degradação por capacidade do § 11 funcionando em
produção. As 0 issues são **zero real** (o endpoint respondeu e a lista veio vazia), não indisponibilidade —
a distinção está no contrato (`erroIssues` ausente) e na tela.

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
| **MC-LIVE-1** | `/api/development-status` + GitHub vivo, bloco "Desenvolvimento ao vivo", LIVE × SNAPSHOT × STALE × UNAVAILABLE | **certificada (22/09/2026)** — smoke real no Deploy Preview do PR #6 (§ 16) |
| **MC-LIVE-2A** | quadro operacional V0 (8 colunas, filtros, busca, contadores, read-only) sobre o mesmo polling | **concluída (22/09/2026)** |
| **MC-LIVE-2B** | correções do smoke real: procedência por `source` + `procedencia`, CI não inferido do estado cru | **concluída (22/09/2026)** |
| MC-LIVE-2 | adapter da Factory + fallback por labels (`FACTORY_ADAPTER_READONLY`) | depende da W5 da fábrica |
| MC-LIVE-3 | correlação e eventos (`WORK_ITEM_CORRELACAO`) | — |
| MC-LIVE-4 | Mapa Vivo (`MAPA_VIVO`) | **primeira UI entregue na MC-CONSTRUCTION-1 (23/09/2026, § 17)**; o gate segue aberto até a correlação (`WORK_ITEM_CORRELACAO`) dar estado real a todo nó |
| MC-LIVE-5 | quadro de execução + realtime (`EXECUCAO_LIVE`, `MC_REALTIME`) — única migration prevista | — |
| MC-LIVE-6 | projeção comercial | — |
| MC-LIVE-7 | eventos, timeline e observabilidade | — |
| MC-LIVE-8 | hardening e fechamento de `MISSION_CONTROL_LIVE` | — |
| **MC-CONSTRUCTION-1** | Central de Construção: catálogo de módulos, panorama, "Construindo agora", drill-down, abas e a primeira UI do Mapa Vivo (§ 17) | **concluída (23/09/2026)** |

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

---

## 14. MC-LIVE-2A — Mission Control Operational V0

Entrega antecipada a pedido do proprietário (22/09/2026): a necessidade operacional passou a ser **abrir o
`#/mission-control` e acompanhar a produção em paralelo**, sem consultar terminal nem GitHub. A correlação
completa, o Mapa Vivo e o realtime continuam no roadmap, mas deixaram de bloquear isso.

### 14.1 O que entrou

Um **quadro operacional** (`src/screens/MissionControlQuadro.tsx`) alimentado por uma projeção pura
(`src/core/central/quadroOperacional.ts`), abaixo da faixa "Desenvolvimento ao vivo".

- **Colunas** = exatamente `MC_STATUS`, na ordem de `ORDEM_MC_STATUS`. Oito, não sete: `PROXIMO` entra porque
  esconder uma coluna faria itens **sumirem** do quadro, e a tela não pode omitir o que a fonte informou.
- **Cartão**: taskId (`correlationId` quando existe, senão `sourceId`), título, status normalizado **ao lado do
  estado cru**, responsável, issue/branch/PR/CI, bloqueio, e **duas datas distintas** — `Alterado` (quando o estado
  mudou na fonte, `updatedAt`) e `Observado` (quando nós lemos, `frescor.observadoEm`).
- **Procedência explícita** no rodapé de cada cartão: item de fábrica lido por issue mostra
  **"GitHub projection of Factory"**, nunca "estado operacional da Factory".
- **Barra superior**: contadores de Em execução, Aguardando humano, Bloqueado, Em validação e Concluído (cada um
  é um filtro de um clique), situação do GitHub (LIVE/SNAPSHOT/STALE/UNAVAILABLE), procedência da Factory e
  "Última atualização".
- **Filtros**: escopo (Todos · Arquitetura · Factory), status, busca por taskId/título (sem caixa e sem acento) e
  frente **apenas quando a fonte informa `workstreamId` de verdade** — `workstreamsDisponiveis` devolve vazio e a
  UI não oferece o filtro, em vez de inventar frente.

### 14.2 O que o quadro NÃO é

É **projeção**. Não há drag-and-drop, não há botão que mova task, não há escrita: `quadroOperacional.ts` importa
exatamente um módulo (`./workItem`) e um teste prende essa lista. Ele não cria regra de status — a única
normalização continua sendo a do LE anterior — e não ordena por prioridade comercial. Dentro da coluna a ordem é
"quem mexeu por último primeiro", com desempate por id para não tremer entre dois polls iguais; item **sem**
`updatedAt` vai para o fim e nunca vira "agora".

### 14.3 Atualização

Um único `useStatusRemoto` agora vive no `MissionControl` e é passado por prop para a faixa ao vivo e para o
quadro. Dois hooks seriam dois polls por minuto sobre a mesma API, que tem teto de chamadas por ciclo. Trocar por
realtime depois é substituir a origem de `estado` — o quadro não muda.

### 14.4 Dívidas encontradas

- **Página rola de lado em 390 px.** Não é do quadro (que rola dentro do próprio contêiner): vem da tabela de
  **"Frentes de trabalho"**, que não está em `.table-wrap`. Pré-existente, fora do escopo da 2A.
- **Guardas de CSS do Commercial UX eram ilimitadas.** `comercialUX6.test.ts` recortava `styles.css` do início do
  bloco até o **fim do arquivo**, o que funcionava só porque aquele bloco era o último. Qualquer CSS acrescentado
  depois quebrava três testes — e quebrou. Corrigido com a sentinela `fim do bloco UX-6` em `styles.css` e os três
  recortes limitados a ela; blocos novos entram depois da linha sem reabrir o problema.
- O **smoke com dados reais** foi feito em 22/09/2026 com o PAT já cadastrado no painel do Netlify (§ 16).

## 15. MC-LIVE-2B — correções do smoke real

O smoke real da 2A (endpoint 200, GitHub ao vivo, dados reais, polling único, filtros, nenhum segredo exposto,
quadro legível em 390 px) devolveu dois defeitos de **apresentação** — nenhum deles de contrato. Corrigidos aqui,
sem procedência nova, status novo, campo novo, tabela nova ou migration.

### 15.1 Procedência agora depende de `source` **e** de `procedencia`

A tela decidia o rótulo só pela procedência: qualquer `GITHUB_PROJECTION` era anunciado como
`GitHub projection of Factory`. Um PR real do próprio `eiff-control` (`source: GITHUB`) aparecia, então, como
projeção da Factory — uma afirmação falsa sobre uma fábrica que aquele cartão não representa.

As duas perguntas são diferentes:

| | significado |
| --- | --- |
| `source` | de **quem** é o item — `FACTORY` é job da fábrica; `GITHUB`, issue/PR do próprio GitHub |
| `procedencia` | por **onde** o dado chegou até nós |

Só o encontro dos dois — `FACTORY` + `GITHUB_PROJECTION`, item da fábrica observado através do GitHub — recebe o
literal reservado. Todo o resto usa o rótulo canônico de `ROTULO_PROCEDENCIA`, que continua sendo a única
autoridade de procedência: `rotuloProcedenciaDoItem` (em `quadroOperacional.ts`) é apresentação, não um segundo
catálogo. Assim `GITHUB` + `GITHUB_PROJECTION` diz **"projeção do GitHub"**, e `FACTORY` + `FACTORY_API` — quando
a API da fábrica existir — diz "estado operacional da Factory".

### 15.2 CI não é inferido de `statusOrigem`

O cartão mostrava `CI: pr:draft`. `pr:draft` é situação do **pull request**, não resultado de teste: o campo
afirmava um CI que ninguém leu. O estado cru da fonte nunca vira CI por inferência — nem quando o nome lembra CI
(`CI_RUNNING` é estado do job, não um check run correlacionado a este cartão).

`MissionControlWorkItem` não carrega check run por item, e correlacionar PR/commit/check é outro assunto, de outro
bloco. Enquanto essa correlação não existir, `ciDoItem` devolve ausência para todo item e a tela mostra
**travessão**. O campo continua no cartão: some o dado, não a linha — quem lê precisa ver que CI é uma pergunta
em aberto, não um espaço que nunca existiu. O CI do repositório continua sendo do repositório e não desce para
cartão nenhum.

### 15.3 O que não mudou

`statusOrigem` segue impresso ao lado do status normalizado (`pr:draft`, `CODING`, `fechado`), PR continua
virando `#5`, branch, commit e links seguem intactos no contrato, o polling continua único, as 8 colunas seguem
com `PROXIMO` presente e o quadro continua read-only. A Factory **não** está LIVE: o que existe é a projeção do
GitHub descrita na § 10.

## 16. Certificação da MC-LIVE-1 e integração final

Smoke real de 22/09/2026 sobre o Deploy Preview do PR #6 (`11dfd95`), com sessão de Administrador e o PAT
`GITHUB_READ_TOKEN` já cadastrado no painel do Netlify. O que a leitura viva devolveu:

| | resultado observado |
| --- | --- |
| `/api/development-status` | **200**; sem `Authorization` → 401, `POST` → 405 |
| `eiff-control` | disponível · `main` `88c9ccc` · CI **verde** (`completed:success`, "EIFF Quality Gate") · 3 PRs · 0 issues |
| `eiff-dev-factory` | disponível · `main` `88f999d` · `ci: null` + `erroCi: CHECKS_PERMISSION_UNAVAILABLE` · 0 PRs · 0 issues |
| `build.sha` | `11dfd95` com `origem: COMMIT_REF` — o commit **deste artefato**, não mais `null` |
| `github.main.sha` | `88c9ccc` |
| classificação | **SNAPSHOT** — "esta tela é a publicação de 11dfd95; o main observado já está em 88c9ccc" |
| segredo | nenhum: zero ocorrência de token, `Authorization`, `Bearer`, `github_pat_`, `ghp_`, `process.env`, `/var/task` ou stack trace, tanto no corpo quanto no bundle publicado |

Três coisas que este smoke provou e que valem como regra:

1. **`SNAPSHOT` num Deploy Preview é acerto, não defeito** (§ 15-B). Forçar `LIVE` seria mentir sobre qual artefato
   está na tela.
2. **A degradação por capacidade funciona de verdade**: a fábrica ficou disponível com `main`, PRs e issues lidos e
   só o CI ausente, com o código do motivo. Uma capacidade sem permissão não derruba o repositório.
3. **A Factory não tem itens observáveis hoje** — zero PRs e zero issues `factory:state:*`. A projeção existe e está
   vazia, o que é diferente de indisponível, e é dito com essas palavras na tela.

### 16.1 Como as duas linhas foram juntadas

As linhas divergiram em `430e2b4`: a certificada seguiu com `85aa164` (degradação por capacidade) e `11dfd95`
(build SHA), enquanto a linha do quadro seguiu com `a05dc8e`/`eaebfda` (MC-LIVE-2A) e `25b4710` (MC-LIVE-2B). A
integração é um **merge de verdade** das duas, sem rebase, squash, cherry-pick, `ours` ou `theirs`: nenhum commit
foi reescrito e as seis entregas continuam no histórico com autoria e mensagem originais.

### 16.2 O que ainda NÃO é verdade

A **API da Factory não existe** nesta linha. Tudo que o painel mostra da fábrica é projeção do GitHub
(`GITHUB_PROJECTION`), e por isso um item da fábrica visto por aí se chama "GitHub projection of Factory" e nunca
"estado operacional da Factory" — este último rótulo está reservado para quando `FACTORY_API` for real. Heartbeat,
turno, lease, custo e última ferramenta continuam fora: não existem nesta fonte e não são inventados.

---

## 17. MC-CONSTRUCTION-1 — Central de Construção do EIFF

Entrega de 23/09/2026. O `#/mission-control` deixou de abrir no painel de gates e passou a abrir na **Central de
Construção**: o que compõe o EIFF, o que já foi construído, o que está sendo construído agora, o que é plano, o
que está bloqueado, quais tarefas pertencem a cada módulo e qual é o próximo passo. **Nada foi removido**: gates,
marcos, bloqueios, escada de liberação, frentes, camadas, evidências, benefícios e linha do tempo continuam
inteiros, na aba **Governança**. Não é uma wave nova do roadmap MC-LIVE: é a camada de produto sobre o que as
waves 0, 1, 2A e 2B já entregaram, e carrega dentro dela a **primeira UI do Mapa Vivo** (MC-LIVE-4).

### 17.1 Hierarquia da página

`Visão geral | Execução | Mapa vivo | Governança` (`Tabs` do sistema, estado local da tela).

- **Visão geral** (padrão): dois `KpiHero` (módulos do catálogo por estado; tarefas ativas por status), bloco
  **Atenção**, bloco **Construindo agora** e o **Panorama dos módulos** em cartões agrupados por domínio, com
  drill-down em painel lateral.
- **Execução**: o bloco "Desenvolvimento ao vivo" (MC-LIVE-1) e o quadro operacional (MC-LIVE-2A/2B), **sem
  nenhuma mudança** — 8 colunas, filtros, busca e contadores iguais.
- **Mapa vivo**: o grafo de `mapaVivo.ts` desenhado em SVG (§ 17.4).
- **Governança**: tudo que era a primeira dobra antes desta entrega (`MissionControlGovernanca.tsx`).

**Uma leitura remota só**: `useStatusRemoto` continua sendo chamado uma única vez em `MissionControl.tsx` e o
estado desce por prop para as quatro abas. Nenhuma aba cria polling, `fetch`, relógio ou acesso ao GitHub — o
teste `construcao.test.ts` varre as telas atrás disso.

### 17.2 Modelo de construção (`src/core/central/construcao.ts`, puro)

| Conceito | O que é | De onde vem o estado |
| --- | --- | --- |
| `ModuloConstrucao` | um módulo do EIFF: id, título, descrição, domínio (`GESTAO`, `COMERCIAL`, `CENTRAL`, `DESENVOLVIMENTO`), rota, componentes, `dependeDe`, `workstreams`, `observaFonte` | catálogo compilado (SNAPSHOT) |
| `ComponenteConstrucao` | uma capacidade do módulo | `gates` do catálogo → prontidão; senão `evidencias` (arquivo + símbolo que o teste abre); senão plano declarado |
| `EstadoConstrucao` | vocabulário **fechado**: `CONCLUIDO`, `EM_CONSTRUCAO`, `PLANEJADO`, `BLOQUEADO`, `SEM_EVIDENCIA` | derivado, nunca digitado |
| `ModuloProjetado` | módulo + estado + `concluidos/total` + tarefas ligadas + bloqueios + próximo passo + dependentes + procedências | `projetarModulo` |
| `PanoramaConstrucao` | os módulos projetados, contagem por estado e as contagens de tarefas (`null` sem leitura) | `panoramaConstrucao` |

Regras que o teste prende:

1. **Nenhum módulo inventado**: 19 módulos, todos com pelo menos um componente com evidência ou gate; toda
   evidência aponta para arquivo que existe e símbolo que está dentro dele; gates, frentes e dependências citados
   existem; dependências sem ciclo. Módulo sem nada disso cai em `SEM_EVIDENCIA` — hoje, nenhum.
2. **Nenhum percentual digitado**: o progresso é `concluídos/total` de componentes (`fracaoTexto`), e a porcentagem,
   quando aparece, é arredondamento dessa fração (`pctConstrucao`). O teste varre o domínio e as telas atrás de
   porcentagem literal.
3. **Estado do componente**: gate fechado → concluído; gate bloqueado real → bloqueado; gate bloqueado **por
   desenho** → bloqueado sem bloquear o módulo (segurança intencional não é falha, a mesma regra de sempre);
   evidência → concluído; nada → planejado.
4. **Estado do módulo**: bloqueio real em qualquer componente → `BLOQUEADO`; todos concluídos → `CONCLUIDO`;
   algum concluído/em andamento ou tarefa viva ativa → `EM_CONSTRUCAO`; senão `PLANEJADO`.
5. **Próximo passo é derivado**: o primeiro componente não concluído na ordem declarada (bloqueio real vira
   "desbloquear: …"; gate aberto cita o gate que falta). Nenhuma frase digitada como plano.

### 17.3 Task → módulo: só relação segura

A única regra de pertença é `moduloDaTarefa`: `workstreamId` de uma frente do módulo, ou `gateIds` que cruzam os
gates do módulo — os dois são campos do contrato `MissionControlWorkItem`. Título, prefixo do `taskId`,
repositório e nome parecido **não entram** (o teste prova que uma tarefa com o título exato do módulo continua
sem módulo). Sem relação, a tarefa aparece como **"Módulo não informado"** (`SEM_MODULO`) e **continua visível**
em "Construindo agora", contada em `tarefas.semModulo`.

**Lacuna de contrato registrada**: o bloco `factory-task:v1` (JOB_CONTRACT.md da fábrica) informa `taskId` e
`repository`, mas não informa frente nem módulo, e o adapter só extrai o `taskId`. Logo, **toda tarefa viva do
GitHub aparece hoje sem módulo** — é a fonte que não informa, não a tela que esconde. Quando o contrato ganhar
um campo de frente/módulo, ele entra pelo adapter e pela normalização, nunca por heurística na tela. A fábrica
(`FACTORY`) tem um caso à parte: os itens `source = 'FACTORY'` aparecem no módulo "EIFF Dev Factory (observada)"
como **jobs observados** (`observaFonte`), não como pertença — o módulo a que cada job se refere segue não informado.

### 17.4 Mapa vivo (primeira UI do MC-LIVE-4)

`src/screens/MissionControlMapa.tsx` desenha `NOS` e `ARESTAS` de `mapaVivo.ts` em SVG, sem dependência nova e sem
grafo paralelo (o teste confere que a tela importa o modelo e não declara nós nem arestas). O que entrou no
domínio, puro e testado:

- `camadasDoMapa`: camada de cada nó = caminho mais longo a partir das fontes, só por arestas `fluxo` e
  `dependencia` (o grafo é acíclico nessas arestas, invariante já existente);
- `layoutDoMapa`: uma faixa por domínio, colunas por ranking denso das camadas presentes no domínio, posições em
  pixels determinísticas (mesma entrada, mesma saída; nenhum par de nós na mesma célula);
- `ATORES_DO_NO` / `FONTE_DO_NO` / `itensDoNo`: os itens vivos "de" cada nó, só por `responsavel.tipo` (Architect,
  Dispatcher, Worker/Supervisor, Humano/Integrator) e por `source` (PR ← `GITHUB`, Demanda ← `ARCHITECTURE`).
  Nó fora dessas tabelas não recebe item vivo, e a tela diz "sem leitura"/"desenho" em vez de inventar.

Cada nó mostra o estado que vem da sua fonte: gates → `fechados/exigidos` (snapshot); fonte viva → `n item(ns)`
(live) ou "sem leitura"; os quatro tipos de aresta têm traço próprio (cheio, tracejado, pontilhado, laranja) e
arestas que apontam para trás (observa, evidência) contornam por cima — observar não cria ordem. Clique abre o
detalhe (papel, gates, itens vivos, arestas de entrada e saída; o nó CI mostra o CI de `main` dos repositórios).
O mapa rola dentro do próprio viewport; a página nunca ganha scroll horizontal.

O gate `MAPA_VIVO` **continua aberto**: a prova exige "cada nó mostrando o estado que vem da sua fonte" e isso só
fecha quando a correlação (`WORK_ITEM_CORRELACAO`) der estado real a todo nó — hoje, os nós de fonte viva mostram
contagem por responsável/fonte da projeção do GitHub, e os nós de desenho, só gates.

### 17.5 LIVE × SNAPSHOT, atenção e degradação

- Cada cartão de módulo é SNAPSHOT (catálogo do build); as tarefas ligadas trazem a procedência do item
  (`GITHUB_PROJECTION` etc.). O painel do módulo mostra as duas procedências lado a lado (`procedencias`), e o
  teste prova que módulo sem tarefa viva declara só `REPOSITORIO`.
- **Atenção** lista só fatos derivados (`atencaoConstrucao`): sem leitura, fonte indisponível, módulos com bloqueio
  real, tarefas bloqueadas, aguardando humano, itens com leitura vencida, tarefas sem módulo. Nada opinativo.
- **Erro de fonte não vira zero**: sem leitura válida, `panorama.tarefas` é `null` e a tela mostra "—" e "sem
  leitura"; os módulos continuam todos lá (catálogo). O último estado conhecido segue a regra da MC-LIVE-1.

### 17.6 O que NÃO entrou (dívidas declaradas)

- Nenhuma migration, tabela, realtime, cron ou função nova: a Central funciona com `/api/development-status` e o
  catálogo compilado.
- Timeline/eventos continuam fora (§ 14-A).
- `FACTORY_ADAPTER_READONLY`, `WORK_ITEM_CORRELACAO`, `MAPA_VIVO`, `EXECUCAO_LIVE`, `MC_REALTIME`, `MC_DEGRADACAO` e
  `MISSION_CONTROL_LIVE` seguem abertos — esta entrega não fechou gate nenhum.
- Correção lateral necessária para a prova de responsividade: em 390 px a aba Governança estourava a largura da
  página (grade `.mc-camadas` sem `minmax(0, 1fr)` e pills de gate com `white-space: nowrap`). Corrigido só em CSS
  (`.mc-camadas`, `.mc-camada .mc-pill`, `.mc-gov`); as tabelas rolam dentro do próprio cartão.

Testes: `src/core/central/construcao.test.ts` (31 casos, cobrindo as doze provas pedidas) mais os já existentes de
`workItem`, `quadroOperacional`, `missionControl` e `developmentStatus`, que seguem verdes.

### 17.7 MC-CONSTRUCTION-1B — reconciliação com a main e guarda de cobertura (24/09/2026)

**O que aconteceu.** Enquanto a MC-CONSTRUCTION-1 era construída sobre `7ac9bde`, a `main` avançou para `7e0aa61`
com o PR #13 (EIFF Inbox — Foundation). O commit original (`bbac2db`) foi reaplicado por cherry-pick numa branch
de integração criada a partir de `7e0aa61`; o único conflito foi `src/styles.css`, em que os dois lados acrescentaram
blocos ao fim do arquivo — resolvido mantendo o CSS do Inbox exatamente como está na `main` e o bloco
`mcc-*`/`mcm-*` da Central depois dele (o arquivo final é `main` + bloco, byte a byte; nenhum estilo do Inbox mudou).

**O que o Inbox tornou visível.** Um módulo novo entrou no sistema e a Central não o mostrou: o catálogo é explícito
por desenho (§ 17.2, regra 1), então **não havia como ele aparecer sozinho** — e não havia nada que acusasse a
ausência. Esse silêncio era o defeito.

**Inbox no catálogo.** `INBOX` (domínio EIFF Central, rota `/atendimento`, depende de `CENTRAL_WHATSAPP` e
`PLATAFORMA`) com o que a `main` prova: domínio (`tipos.ts`, `estados.ts`, `roteamento.ts`), telas (`Inbox.tsx`,
`InboxConfig.tsx`), persistência **escrita** (`0056_inbox.sql` com `inbox_ingest`/`inbox_assign_thread`,
`inbox.supabase.ts`), ingestão pela Central (`ingerirEventosCentral`, `deEventoCentral`, `channel-meta-webhook.ts`),
fronteiras fail-closed (`PROVEDOR_MANUAL`, `SEM_INTELIGENCIA`, `EXECUCAO_FACTORY_RESERVADA`) e provas
(`scripts/pg-smoke-inbox.mjs`, testes, `docs/eiff-inbox.md`). O que `docs/eiff-inbox.md` § 11.9/§ 13 declara como
pendente entra como **plano sem evidência** (0056 aplicada em produção, IntelligenceProvider real, escalação por
SLA automática, editor de regras, Octopus Router). Estado derivado: **em construção**; próximo passo derivado:
"Migration 0056 aplicada em produção". Nenhum arquivo do Inbox foi alterado; a Central só o observa.

**Guarda de cobertura (só em teste, nunca em runtime).** Cada módulo declara as superfícies de navegação que cobre
(`rotas`), e `EXCLUSOES_SUPERFICIE` lista, com motivo, as rotas que existem e por decisão não são módulo (hoje só
`/piloto`, o protótipo de UX). O teste lê o **inventário real** — os `to:` de `ROTAS_NAV` em `Paleta.tsx` e os `case`
do switch de telas em `App.tsx` — e exige que toda rota termine coberta por exatamente um módulo ou excluída
explicitamente; qualquer sobra falha com `"Nova superfície do EIFF sem classificação na Central de Construção: <x>"`.
Também falha se um módulo cobrir rota inexistente, se duas cobrirem a mesma rota ou se a rota principal do módulo
não estiver entre as cobertas. O domínio (`construcao.ts`) não importa App, Paleta nem lê `location`: a
classificação em runtime continua vindo apenas do catálogo (`classificarSuperficie` é função total sobre
declarações), e uma superfície nova **não vira módulo** — vira teste vermelho até alguém decidir.

**Mapa vivo.** Nó `INBOX` na faixa da Central, sem gate e sem fonte viva (mostra "desenho"), com **duas** arestas,
as únicas provadas em código: `WEBHOOK → INBOX` (fluxo: o webhook da Central entrega `ChannelInboundEvent` +
conteúdo a `inbox_ingest`) e `CONTROL → INBOX` (dependência: a RLS do Inbox espelha a matriz de permissões via
`inbox_role`). Nenhuma aresta sai do Inbox; nada foi desenhado para Factory, Radar ou obra — o vínculo
contato ↔ Radar/obra está na lista de pendências do próprio Inbox.

**Revisão do catálogo (19 → 20 módulos).** Ajustes feitos por serem inequívocos: `EXPERIENCIA` passou a cobrir o
Painel executivo e a caixa pessoal (`/`, `/inbox`) e ganhou os dois componentes correspondentes; `PLATAFORMA` passou
a cobrir Cadastros e Auditoria (`/cadastros`, `/auditoria`). Observações registradas, **não** refatoradas (decisão
humana): `EXPERIENCIA` e `CAPACITACAO` são módulos transversais de produto mais do que domínios de negócio;
`COMUNICACAO` e `LEAD_ENGINE` vivem dentro das telas do Radar (rotas próprias = nenhuma) e poderiam ser lidos como
frentes do Radar; `ESTOQUE` é pequeno (2 componentes) mas tem core, migrations e tela próprios. Nenhum módulo é
uma tela isolada: todos têm core ou contrato além da tela.

**Provas novas** (`construcao.test.ts`, blocos 13–15): inventário real contém `/atendimento`; drift = vazio; rota
sintética `/nova-superficie` quebra a guarda; rotas cobertas existem, são únicas e incluem a principal; exclusões
com motivo; domínio e telas não usam a guarda em runtime; Inbox no catálogo com estado derivado, evidências
reais (só arquivos do Inbox/Central com símbolo presente), dependências provadas, título "Inbox" em tarefa não vira
módulo; contagens da home recalculadas; nó `INBOX` sem fonte viva, duas arestas de entrada, nenhuma de saída.

### 17.8 MC-CONSTRUCTION-1C — main atual e frescor dos componentes (24/09/2026)

**O que aconteceu.** Enquanto a 1B era reconciliada sobre `7e0aa61`, a `main` avançou para `7a0e723` (PR #14,
EIFF Inbox — Fase 3: Octopus Router). A Central foi reaplicada numa branch nova a partir de `7a0e723`
(`feature/mc-construction-1-current`; os commits da 1 e da 1B por cherry-pick, `styles.css` de novo resolvido como
`main` inteira + bloco `mcc-*`/`mcm-*`, conferido byte a byte). As branches `feature/mc-construction-1` e
`feature/mc-construction-1-integration` ficam como evidência.

**O segundo drift.** O PR #14 não abriu rota nenhuma — então a guarda de superfície (§ 17.7) não tinha o que ver — e
mesmo assim três componentes do Inbox que o catálogo dizia "planejados" passaram a existir em código: o Octopus
Router, os editores de regras e o provedor de IA no servidor. O catálogo ficou **silenciosamente velho**.

**Inbox na main atual (`7a0e723`).** A maturidade do Octopus fica em componentes, sem estado novo de módulo:

| Componente | Estado | Evidência |
| --- | --- | --- |
| Octopus Router: pipeline e política de automação | concluído | `roteador.ts › decidirRoteamento`, `automacao.ts › decidirAutomacao` |
| Octopus Router: testes e smoke do banco | concluído | `roteador.test.ts`, `roteamentoServidor.test.ts`, `pg-smoke-inbox.mjs › inbox_apply_routing` (provas S–X) |
| Octopus Router: integrado | concluído | `channel-meta-webhook.ts › rotearNoServidor`, `0057 › inbox_apply_routing` (escrita), `store.ts › inboxConfirmarRoteamento` |
| Refino por IA no servidor (opcional pela chave) | concluído | `inteligenciaLlm.ts › provedorAnthropic` |
| Editores de regras de roteamento e automação | concluído | `InboxConfig.tsx › RegraRoteamento/RegraAutomacao`, `store.ts › validarConfiguracaoOctopus` |
| Migration 0056 aplicada em produção | planejado | sem sinal: aplicação não deixa artefato no repositório |
| Migration 0057 aplicada em produção | planejado | idem |
| Roteamento em operação real comprovada | planejado | sem sinal: só se prova em produção |
| Escalação por SLA como execução automática | planejado | sinais monitorados: `'SLA_ESCALATED'` emitido em `roteamento.ts`, `roteador.ts` ou `store.ts` |

Resultado derivado: **11/15 componentes, em construção**, próximo passo "Migration 0056 aplicada em produção", sem
bloqueio. "Código na main" é **implementado + provado + integrado**, não "operando": 0056 e 0057 seguem só em código
(CLAUDE.md, `docs/eiff-inbox.md` § 14.7).

**Guarda de frescor (só em teste).** Todo componente **planejado** (sem gate e sem evidência) declara exatamente
uma de duas coisas: `sinaisDeImplementacao` — artefatos explícitos (arquivo + símbolo) cuja aparição indicaria que
a implementação nasceu — ou `semSinalPorque`, quando o plano não deixa artefato previsível (aplicação em produção,
decisão da Diretoria, próxima fonte do Lead Engine). O teste abre os sinais declarados; se algum existir enquanto o
componente segue planejado, falha com `"Componente da Central possivelmente desatualizado: <ID> possui evidência de
implementação, mas continua classificado como PLANEJADO."`. O domínio **não** abre arquivo nem reclassifica: sinal
presente não muda estado, só vira teste vermelho. A regressão do caso real está no teste: os três planos do catálogo
da 1B, com os sinais que o contrato do Octopus já nomeava, disparam a guarda na `main` atual.

A evidência positiva continua valendo nos dois sentidos: todo componente concluído por evidência tem o arquivo e o
símbolo reabertos pela suíte; se sumirem, o teste falha — a Central não sustenta um ✓ sobre evidência que deixou de
existir.

**As duas guardas, e só elas.** Superfície (rota nova sem classificação) e componente (sinal monitorado sob um
planejado). Limite declarado: um componente com `semSinalPorque` depende de revisão humana — a guarda não o vigia.

**Mapa vivo.** O PR #14 não trouxe relação arquitetural nova do Inbox com outro nó do grafo: o router roda **dentro**
do Inbox, é chamado pelo mesmo webhook e lê obra e perfis do Control pela mesma dependência. As duas arestas ficam;
só os rótulos passaram a dizer isso (`… → inbox_ingest → rotearNoServidor`; `RLS espelha a matriz (inbox_role); o
router lê obra e perfis`). A IA (Anthropic) não é nó do mapa e não ganhou aresta. Nenhuma aresta nova.

**Task → módulo** não mudou: título com "Inbox" ou "Octopus" continua sem módulo.

### 17.9 MC-CONSTRUCTION-1D — ativação em produção e Shadow Mode (24/09/2026)

**O que mudou na main.** PR #18 (`d707531`, docs) registrou em `docs/eiff-inbox.md` § 15 e no CLAUDE.md a ativação
controlada do Inbox: 0056 e 0057 aplicadas em produção, `EIFF_INBOX_ORGANIZATION_ID` no Netlify e o Inbox em
**SHADOW MODE** — infraestrutura real, nenhuma ação externa. A Central foi reaplicada numa branch final a partir de
`d707531` (`feature/mc-construction-1-final`; os três commits anteriores por cherry-pick, sem conflito, `styles.css` =
`main` + bloco da Central).

**Inbox sincronizado — só com o que o texto integrado diz.** Concluídos por evidência documental (§ 15.1, § 15.2,
§ 15.4 e CLAUDE.md): *Migration 0056 aplicada em produção*, *Migration 0057 aplicada em produção*, *Shadow Mode em
produção: E2E controlado, idempotência e router provados (sem ação externa)* e *RLS e autoridade provadas em produção*.
Seguem planejados: *Tráfego externo real* (a fonte diz que "nenhuma mensagem real chega ainda": faltam
`SUPABASE_SERVICE_ROLE_KEY`, `META_WHATSAPP_*`, os phone number IDs e os setores — decisões do usuário, não componentes
novos) e *Escalação por SLA como execução automática*. Resultado derivado: **15/17, em construção**; próximo passo
derivado: "Tráfego externo real". O antigo "Migration 0056 aplicada em produção" deixou de ser o próximo passo.

**Shadow Mode não é operação.** Não há estado novo de módulo. A distinção fica em um rótulo de componente,
`natureza` (vocabulário fechado `CODIGO` · `INTEGRACAO` · `PRODUCAO` · `OPERACAO`), que diz **o que a evidência prova**:
o E2E de § 15.4 é prova de **produção** com dado de teste; **operação** exige uso real e segue planejada. Regras presas
por teste: componente de produção ou operação só se prova por documento integrado (nunca por código); nenhum componente
de operação está concluído hoje; o componente de tráfego real não herda nenhuma evidência da prova controlada. O
rótulo aparece no painel do módulo ao lado de cada componente; ele não entra em nenhum cálculo de estado.

**O ponto cego da guarda de frescor.** A guarda da 1C **não teria detectado** esta mudança: os planos de 0056/0057
declaravam `semSinalPorque` ("aplicação em produção não deixa artefato no repositório"), e isso estava errado — o
projeto registra o que está no ar, e a frase "0057 (Octopus Router, …) só em código" existia no CLAUDE.md em `7a0e723`
e sumiu no PR #18. Correção dentro da mesma guarda (não é uma terceira): um componente planejado pode citar
`pendenciaDeclarada` — a frase de uma fonte integrada que o declara pendente. Se ela sumir, o teste falha com
`"Componente da Central possivelmente desatualizado: a fonte deixou de declarar <ID> como pendente, mas ele continua
classificado como PLANEJADO."`. Todos os planos atuais passaram a se ancorar assim (DEC-03 e DEC-09 no CLAUDE.md, fontes
futuras do Lead Engine no CLAUDE.md, tráfego real e escalação em `docs/eiff-inbox.md`); `semSinalPorque` fica como
último recurso. A regressão do caso real está no teste. Como antes, o domínio não abre arquivo e nada é reclassificado
sozinho.

**Mapa vivo.** Inalterado: 20 nós, 29 arestas. O PR #18 é documental e não prova relação arquitetural nova.

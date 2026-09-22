# Mission Control Live — contrato arquitetural

Status: **MC-LIVE-0 concluída (22/09/2026)** — contratos, modelo do mapa, gates e este documento. Nenhuma fonte
externa é consultada ainda, nenhuma migration, nenhuma dependência nova, nenhum token necessário.

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
- `frescor` é obrigatório: `{ observadoEm, stale, fonteIndisponivel }`.
- `bloqueio.porDesenho` preserva a distinção entre segurança intencional e falha.
- `links` carrega `repository · branch · commit · pullRequest · issue`.
- `dependsOn`, `parentId`, `gateIds`, `workstreamId`, `waveId` fecham os eixos de leitura.

## 6. `MissionControlEvent`

`{ id, correlationId, tipo, ocorridoEm, source, sourceId, ator, de, para, motivo, evidencia, metadata }`.

- `id` determinístico (`source|sourceId|tipo|ocorridoEm`): a mesma ocorrência lida em duas coletas é um evento só.
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

### O que existe hoje

A fábrica está na **W1** ("um job à mão"). **`packages/api` não existe**, não há VM, não há
`factory.eiffcontrol.com.br` e não há `FACTORY_READ_TOKEN`. O que é consultável hoje são as issues do GitHub com
as labels `factory:state:*` — que já são canônicas por ADR-01. O adapter da MC-LIVE-2 nasce contra o contrato
congelado, com fallback por labels e com `fonteIndisponivel` explícito.

## 11. Integração com o GitHub

Decisão de 22/09/2026: **PAT fine-grained somente leitura**, restrito a `augustocfmacedo/eiff-control` e
`augustocfmacedo/eiff-dev-factory`, com o mínimo para metadata, branches, commits, issues, labels, pull requests
e checks. Nenhuma permissão de escrita. Migração futura para GitHub App **não altera o contrato do Mission
Control**.

- O token existe **apenas no ambiente de deploy** (painel do Netlify). Nunca `VITE_*`, nunca no navegador, no
  bundle, no banco, em log ou em resposta de API.
- Uma chamada agregada por ciclo, com ETag/`If-None-Match` e cache curto compartilhado. **Nunca uma chamada por
  cartão.** Sem N+1.
- Adapter puro com `fetch` injetado, no padrão de `metaServidor.ts`/`comunicacaoServidor.ts`.

Gate: `GITHUB_ADAPTER_READONLY`.

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
| `DEVELOPMENT_STATUS_ENDPOINT` | um agregador server-side do estado da construção | JWT → perfil do banco → `ver_mission_control`; agrega GitHub e Factory numa resposta; cache; nenhum segredo na saída; 403 para quem sabe a URL e não tem a permissão | `netlify/functions/development-status.ts` + teste de acesso | — |
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

## 18. Segurança

- `ver_mission_control` (Administrador e Diretoria) é conferida **na rota** e passará a ser conferida **também no
  endpoint**. Esconder do menu não é controle de acesso.
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
| MC-LIVE-1 | `/api/development-status` + GitHub vivo (`DEVELOPMENT_STATUS_ENDPOINT`, `GITHUB_ADAPTER_READONLY`) | a autorizar |
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

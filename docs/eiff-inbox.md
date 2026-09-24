# EIFF Inbox — fundação, persistência e checkpoint de integração

Frente aberta em 23/09/2026 na branch `feature/eiff-inbox-bootstrap` (worktree própria, isolada das branches da
EIFF Dev Factory e das waves da EIFF Central). **Nesta fase nada é enviado, nenhuma IA é chamada e nenhum job vai
à Factory**: existem o modelo, as três fronteiras (canal, inteligência, execução), a máquina de estados, o
roteamento, as caixas virtuais, a tela e dados de exemplo fictícios.

## 1. O que o repositório já tinha (inspeção)

| Tema | Estado real | Consequência para o Inbox |
| --- | --- | --- |
| Rota `#/inbox` | já existe: **Minha caixa de entrada** pessoal (aprovações, tarefas, menções) em `src/screens/CaixaEntrada.tsx` | o EIFF Inbox entrou em **`#/atendimento`** (menu "EIFF Inbox"); nada da tela antiga mudou |
| Conversa de WhatsApp | a EIFF Central já modela `CentralConversation`/`CentralMessage`/`CentralEvent` (`src/core/central/conversa.ts`, migrations 0049–0051 **em código, não aplicadas**) sem guardar texto; `ChannelInboundEvent` em `src/core/radar/canais.ts` é o único formato que o core vê do provider | o Inbox **não cria segundo webhook nem segundo modelo de evento**: `deEventoCentral` traduz `ChannelInboundEvent` + texto para `MensagemRecebida`; contexto `INTERNAL`/`EXTERNAL` e `CodigoProvider` são os da Central |
| Identidade | `whatsapp_identity` (0049): nome do WhatsApp nunca é identidade; só VERIFIED age | `IdentidadeCanal.verificada` espelha isso no contato externo; ação sensível continua exigindo a identidade da Central |
| Permissões | matriz única em `src/core/permissoes.ts` (`pode`), reexportada pelo store; Central e Netlify usam a mesma | duas ações novas: `inbox` (abre a central) e `inbox_config` (exemplo, simulação, futura configuração). Visibilidade por setor é **recorte dentro** da permissão, nunca segunda ACL |
| Store | `src/data/store.ts`: toda mutação passa por `registrar()` (auditoria) e `commit()`; slices aninhados (`ds.radar`) | `ds.inbox?: InboxDataset` (opcional: datasets antigos e o remoto sem persistência não o trazem; `garantirInbox` normaliza) e ações `actions.inbox*` |
| Persistência | `persistirRemoto` grava só as tabelas que conhece; `carregarRemoto` monta o `Dataset` | sem migration nesta fase: em produção o slice nasce vazio; o exemplo só entra na memória do navegador por pedido explícito |
| UI | `KpiStrip`, `Badge`, `Tabs`, `Modal`, `Field`, `Empty`, `useToast`, bolhas `.chat-msg/.chat-bolha` do Assistente, tokens em `:root`, `ROTAS_NAV` gera menu e paleta, `POR_ROTA` do tour | tudo reaproveitado; CSS novo só com tokens (`.inbox-*`), tema claro herda |
| Factory | outro repositório (`eiff-dev-factory`): job = issue com bloco `factory-task:v1` (`JOB_CONTRACT.md`); o Mission Control apenas observa via `githubAdapter` | o Inbox tem só `ExecutionProvider`; `FACTORY` é código reservado que recusa; `InboxJob` espelha objetivo/contexto/critérios do contrato sem importar nada da fábrica |
| Testes que travam `App.tsx`/`store.ts` | `comercialEntrada`, `comercialPipeline`, `Sugestoes.test`, `missionControl.test` conferem existência e trechos específicos | edições foram aditivas; suíte inteira verde |

Divergências com a demanda, resolvidas pela evidência do repositório:

1. **Rota**: a demanda chama o produto de "Inbox"; `/inbox` já é outra coisa. Rota `/atendimento`, rótulo "EIFF Inbox".
   Renomear a caixa pessoal é decisão do usuário, não desta frente.
2. **Texto das mensagens**: a Central decidiu não persistir corpo. O Inbox precisa do texto para atender, então a
   retenção do conteúdo é **decisão do Inbox** e ficará explícita na migration futura (coluna própria, RLS por
   organização e setor, política de retenção). O bruto do webhook continua nunca sendo guardado.
3. **Approval como entidade**: a demanda lista `Approval` separado. Aqui vive **dentro** de `InboxAction`
   (`aprovacao`): uma ação tem no máximo uma decisão, e a alçada financeira já existe em `ds.aprovacoes` — não
   duplicar.
4. **Team/InboxUser**: não são tabelas próprias. `Setor` é catálogo (dados, não união de tipos: setor novo não muda
   estrutura) e `MembroSetor` (usuário × setor × papel atendente/gestor) faz o papel de equipe e de usuário do Inbox.

## 2. Arquitetura (adaptada ao repositório)

```
Canais (WhatsApp via EIFF Central · e-mail · portal · webchat · sistema)
   ↓  ChannelProvider (src/core/inbox/fronteiras.ts) — só MANUAL nesta fase, `enviar` apenas registra
Inbox Gateway  receberMensagem(): idempotente por provider + externalMessageId; contato por IdentidadeCanal; reusa/reabre thread
   ↓
Thread / Message / Event  (src/core/inbox/tipos.ts, estados.ts) — a THREAD é a unidade; histórico append-only
   ↓
Intelligence Layer  IntelligenceProvider → Classificacao (intenção, entidades, setor/prioridade/nível recomendados,
                    confiança, sinais, evidências). Hoje: SEM_INTELIGENCIA (nada inventado) + triagemHumana (provedor HUMANO)
   ↓
Routing  rotear(): regras configuráveis → setor → responsável padrão → prioridade (só sobe) → nível A/B/C (política) → SLA
   ↓
Human / AI  caixas virtuais, visibilidade por setor, ordem de trabalho, composer, sugestões (pendente → aceita/descartada)
   ↓
Action  InboxAction (responder, encaminhar, criar_tarefa, consultar_sistema, registrar_previsao, criar_job)
        + aprovacao (papel decisor; quem propõe não decide)
   ↓
Execution Gateway  ExecutionProvider: MANUAL (job ENVIADO, pessoa registra resultado + evidências) · FACTORY reservado (recusa)
```

Regra herdada da Central e do Diretor Financeiro: **IA interpreta, motor decide, permissão autoriza, servidor
executa, auditoria registra**. Nenhum caminho LLM → escrita.

## 3. Modelo de domínio (`src/core/inbox/tipos.ts`)

| Entidade | Decisão |
| --- | --- |
| `Setor` | catálogo em dados (`SETORES_PADRAO`: Comercial, Engenharia, Obras/Operações, Compras, Financeiro, Jurídico, Pós-venda, Administrativo, Fornecedores, Diretoria, Sistema, Factory), `responsavelPadraoId`, `ordem` |
| `MembroSetor` | usuário × setor × `atendente`/`gestor` — cobre Team e InboxUser |
| `CanalInbox`, `IdentidadeCanal` | WHATSAPP/EMAIL/PORTAL/WEBCHAT/SISTEMA; identificador mascarado em qualquer saída (`identificadorMascarado`) |
| `ContatoInbox` | pessoa do outro lado; ponte opcional para Radar (`contatoRadarId`, `empresaRadarId`), equipe (`colaboradorId`) e usuário (`usuarioId`); `obras` como contexto |
| `InboxThread` | unidade central: canal, provider, contexto, contato, `conversaCentralId`, assunto, status, prioridade, nível, setor, responsável, participantes, obra, labels, classificação, resumo, SLA, marcas de tempo, `resolvidaPor` ia/humano |
| `InboxMessage` | inbound / outbound / **interna** (nota); autor contato/usuário/ia/sistema; `externalMessageId` (dedup); `entrega` (`registrada` nesta fase) |
| `ThreadEvent` | histórico append-only: ABERTA, MENSAGEM, CLASSIFICADA, ROTEADA, ATRIBUIDA, TRANSFERIDA, STATUS, NOTA, SUGESTAO, ACAO, APROVACAO, JOB, SLA, LABEL — sobrevive a transferências |
| `Classificacao` | intenção, assunto, entidades, recomendações, confiança 0-1, **sinais e evidências curtas** (`classificacaoAuditavel` recusa textos longos: nada de chain-of-thought), provedor SEED/HUMANO/LLM, versão |
| `Sugestao` | resposta/ação/encaminhamento; pendente → aceita (ao usar no composer) / descartada |
| `InboxAction` + `AprovacaoAcao` | proposta → aguardando_aprovacao → aprovada/rejeitada → executada/falhou; `referencia` para o que nasceu no Control (tarefa) |
| `InboxJob`, `JobResult`, `Evidence` | objetivo, contexto, critérios de aceite (espelho do JOB_CONTRACT), provider MANUAL/FACTORY, RASCUNHO → ENVIADO → EM_EXECUCAO → CONCLUIDO/FALHOU/CANCELADO; `referenciaExterna` só vem do provider |
| `ConfiguracaoInbox` | fallback, escalação, SLA por prioridade, nível padrão, regras de nível e de roteamento (dados, editáveis no futuro pela permissão `inbox_config`) |

## 4. Máquina de estados (`estados.ts`)

```
NOVA → TRIADA (setor) → ATRIBUIDA (pessoa) → EM_ATENDIMENTO → AGUARDANDO_CONTATO | AGUARDANDO_INTERNO | AGUARDANDO_APROVACAO
                                                            → RESOLVIDA → FECHADA
RESOLVIDA / FECHADA → EM_ATENDIMENTO (reabrir, com motivo)
```

- TRIADA e ATRIBUIDA são distintas por causa do SLA de primeira resposta; EM_ATENDIMENTO só depois que a EIFF agiu.
- Espera exige responsável; resolver exige responsável (só o nível A resolve sem pessoa, `resolvidaPor: 'ia'`).
- Fechar sem resolver e reabrir exigem motivo. Mensagem nova do contato reabre AGUARDANDO_CONTATO/RESOLVIDA/FECHADA.
- O status **deriva** da atribuição (`statusAposAtribuicao`) e da resposta (`aoResponder`); a pessoa muda status só
  entre transições válidas (`TRANSICOES_THREAD`, `validarTransicao`).

## 5. Roteamento (`roteamento.ts`)

- `rotear()`: primeira `RegraRoteamento` ativa por ordem (intenções, tipo de relação, palavras, contexto) → setor,
  responsável da regra ou padrão do setor, prioridade que **só sobe**; sem regra vale a recomendação da
  classificação; sem nada, `setorFallback` (Administrativo). Devolve `motivos` legíveis (a tela e a auditoria mostram).
- `nivelPara()`: política A/B/C configurável (`regrasNivel`); sem classificação é C; sem regra é o padrão (B); A nunca
  por conveniência. Na triagem humana o nível é `nivelMaisRestritivo(pessoa, política)`.
- SLA: `slaDe(config, prioridade, abertaEm)` (Urgente 1 h, Alta 4 h, Normal 24 h, Baixa 72 h); `estadoSla` no prazo /
  vencendo (<25%) / vencido / cumprido; `escalacoesPendentes` aponta para `setorEscalacao` (Diretoria) — decisão, não
  execução automática.
- Visibilidade: Administrador/Diretoria transversal; gestor vê o setor; atendente vê o setor, o que é dele e o que ainda
  não tem setor (triagem). Caixas: Precisa de mim, Minha, Não atribuídos, Urgentes, Aguardando, Automatizados,
  Concluídos, Factory e uma por setor visível. Ordem de trabalho: SLA vencido > prioridade > mais antiga (só ordena).

## 6. Fronteira de inteligência

`IntelligenceProvider.analisar(thread, mensagens, contato, setoresAtivos) → { ok, classificacao, resumo } | { ok: false, motivo }`.
Implementações: `SEM_INTELIGENCIA` (indisponível: triagem humana) e `triagemHumana` (provedor HUMANO, confiança 1).
O LLM entrará por função Netlify protegida (JWT → perfil → permissão `inbox`), com saída JSON validada contra os
catálogos (setores ativos, prioridades, níveis) como o Diretor Financeiro faz — nunca no navegador, nunca escrevendo.
O que se guarda: intenção, entidades, recomendações, confiança, sinais e trechos de evidência com `mensagemId`.

## 7. Fronteira com a Factory

`ExecutionProvider.execute(job) → { estado, referenciaExterna?, resultado?, motivo }`. `EXECUCAO_MANUAL` devolve
ENVIADO (uma pessoa registra o resultado com evidências); `EXECUCAO_FACTORY_RESERVADA` devolve RASCUNHO com
`FACTORY_INDISPONIVEL` — fail-closed até a fábrica publicar `packages/api` (W5). Mapeamento previsto, sem acoplar:
`InboxJob.titulo/objetivo/contexto/criteriosAceite` → `title/objective/context/acceptanceCriteria` do
`factory-task:v1`; `referenciaExterna` = `taskId`; `JobResult.evidencias` = check runs, PR, relatório do worker.
O Inbox nunca importa `githubAdapter`, `workItem` nem nada de `src/core/central/` (teste garante).

## 8. Persistência (proposta, não implementada)

Sem migration nesta fase. Quando entrar (numeração conferida na hora contra o repositório e o schema real):
`inbox_sector`, `inbox_sector_member`, `inbox_contact` (+ `inbox_contact_identity` com identificador normalizado e
unique por organização/canal), `inbox_thread` (FK opcional para `central_conversation`), `inbox_message` (unique
`(organization_id, provider, external_message_id)`; **texto** com política de retenção), `inbox_thread_event`
(append-only, triggers como `central_event`), `inbox_suggestion`, `inbox_action`, `inbox_job`, `inbox_config`.
RLS: organização + (setor do membro ∨ responsável/participante ∨ sem setor ∨ papel transversal), sempre por colunas da
própria linha (regra do CLAUDE.md). Escrita da entrada só server-side (webhook), como na Central; ações humanas com JWT.

## 9. Bootstrap entregue

- `src/core/inbox/` (`tipos`, `estados`, `roteamento`, `fronteiras`, `seed`, `index`) + `inbox.test.ts` (31 casos).
- `src/data/store.ts`: `garantirInbox` (local = exemplo, remoto = vazio), ações `inboxAtribuir`, `inboxMudarStatus`,
  `inboxResponder` (provider MANUAL: registra, não envia), `inboxAnotar`, `inboxDescartarSugestao`, `inboxTriar`,
  `inboxProporAcao`, `inboxDecidirAcao`, `inboxExecutarAcao` (criar_tarefa vira tarefa real do Control; criar_job passa
  pelo ExecutionProvider), `inboxRegistrarResultadoJob`, `inboxReceber` (gateway, `inbox_config`),
  `inboxCarregarExemplo` (`inbox_config`); tudo com `registrar()`. `src/data/inbox.store.test.ts` (16 casos).
- `src/screens/Inbox.tsx` em `#/atendimento?t=<thread>&caixa=<caixa>`: visão executiva (`KpiStrip`), FILTROS (caixas +
  lista em ordem de trabalho), CONVERSA (bolhas, nota interna, sugestão, composer com Ctrl+Enter, transições válidas),
  CONTEXTO (contato, classificação, atribuição, SLA, ações/aprovações/jobs, histórico). Modais: triagem humana, propor
  ação, resultado do job, motivo, simular mensagem recebida. Estado vazio em produção com "Carregar dados de exemplo".
- `App.tsx` (rota com autorização real + contador "precisa de mim"), `ROTAS_NAV`, ícone `atendimento`, tour da rota,
  CSS `.inbox-*`, permissões `inbox`/`inbox_config`, `Dataset.inbox?`.

## 10. Próximos passos (em ordem)

1. Decisão do usuário sobre retenção de texto e sobre renomear a caixa pessoal (`/inbox`).
2. Migration do Inbox (seção 8) + mapeamento em `supabase.ts` (leitura/gravação por diff) — persistência real.
3. Adapter do canal WhatsApp: o webhook da EIFF Central (`channel-meta-webhook.ts`) passa a chamar `deEventoCentral` +
   `receberMensagem` server-side; envio continua fail-closed até o rito de canário (modo, allowlist, delivery first).
4. `IntelligenceProvider` LLM por função Netlify, com validação contra catálogos e telemetria de tempo.
5. Configuração de setores, membros, regras de nível/roteamento e SLA na tela (permissão `inbox_config`).
6. `FactoryProvider` quando a fábrica expuser API; até lá, jobs MANUAL com resultado registrado por pessoa.
7. Vínculos automáticos com Radar (contato por telefone/e-mail), obra (por contato) e Diretor Financeiro
   (`registrar_previsao` → `registrarPrevisaoDF`).

## 11. Fase 2 — persistência real, ingestão da Central e estrutura operacional (23/09/2026)

Bootstrap `014c867` aprovado conceitualmente; a fase 2 troca o slice em memória por persistência real sem duplicar a
Central. Baseline: `origin/main` avançou 3 commits (PR #11, piloto Financeiro compacto) e o único arquivo em comum é
`src/App.tsx` (aditivo dos dois lados); não foi incorporado.

### 11.1 Decisões de produto tomadas nesta fase

| Decisão | Resultado |
| --- | --- |
| Texto das mensagens | O Inbox persiste o conteúdo operacional em `inbox_message.body` (até 20 000 caracteres), com tipo, remetente, ids externos, `reply_to_external_id`, `central_message_id` (referência lógica), anexos (`attachments` jsonb), direção, origem (`provider`), estado de entrega e `body_search` (tsvector) para busca. A Central mantém a política dela (nenhum corpo em `central_message`). |
| Metadados técnicos | `inbox_message.meta` jsonb com CHECK que recusa chaves como `authorization`, `token`, `headers`, `cookie`, `raw_payload` em qualquer nível. Attachments, classification, params e result passam pelo mesmo `inbox_jsonb_seguro`. |
| Dados pessoais | Identidades em `inbox_contact_identity` (única por organização + canal + identificador normalizado). Telefone nunca inteiro em evento (CHECK `detail !~ '[0-9]{9,}'`), em log (mascarado) ou em tela (`identificadorMascarado`). |
| Evidências | Só em `inbox_job.result` (referências: PR, commit, link), nunca texto livre longo. |
| Auditoria | `audit_log` recebe ids, estados, contagens e motivos pela aplicação (`registrar()`); nenhum trigger de auditoria em `inbox_message`. O histórico operacional é `inbox_thread_event`: append-only, ≤ 500 caracteres, sem corpo de mensagem. Testes provam que o texto de uma resposta ou nota não aparece na auditoria. |
| Approval | Continua dentro de `inbox_action` (colunas `approval_required`, `approver_role`, `decision`, `decided_by`, `decided_at`, `decision_reason`). Sugestão da IA = ação `responder` em estado `proposta` (a entidade `Sugestao` do bootstrap foi absorvida). |
| Projeto/obra | Contexto separado (`inbox_thread.project_id` → `project`), não equipe nem regra. |
| Dados de exemplo | Só no modo local. `inboxCarregarExemplo` é recusado no modo remoto: em produção o Inbox lê e grava as tabelas `inbox_*`. |

### 11.2 Migration `0056_inbox.sql`

Dependências: 0001 (organization, profile, project, role_kind, `touch_updated_at`), 0003 (`current_org`, `has_role`), 0008 (worker),
0031 (radar_contact, radar_company). **Não** depende de 0049–0051: `central_conversation_id` e `central_message_id` são
referências lógicas sem FK, para o Inbox poder ser aplicado antes ou depois da Central. Ordem em produção: 0056 pode ir
sozinha; 0049–0051 continuam pendentes e independentes. Nada foi aplicado remotamente.

| Tabela | Papel | Garantias no banco |
| --- | --- | --- |
| `inbox_sector`, `inbox_team`, `inbox_member`, `inbox_config` | setores (chave `code`), equipes por setor, membros (setor + equipe opcional + `atendente`/`gestor`), uma linha de configuração por organização (fallback, escalação, SLA, regras em jsonb) | unique `(organization_id, code)`; unique `(org, profile, sector, coalesce(team))`; coerência perfil/setor/equipe por trigger |
| `inbox_contact`, `inbox_contact_identity` | pessoa → N identidades (WhatsApp, e-mail, portal…), pontes para Radar/equipe/perfil, `project_codes` | unique `(org, channel, identifier)` |
| `inbox_thread` | unidade central: canal, provider, contexto, contato, assunto, status, prioridade, nível, setor, equipe, responsável, `participant_ids`, obra, labels, `classification` jsonb, `summary`, SLA, marcas de tempo, `resolved_by`, `origin` | CHECKs de status × timestamps; coerência contato/setor/equipe/responsável da organização |
| `inbox_message` | conteúdo operacional | unique parcial `(org, provider, external_message_id)`; trigger imutabilidade (só `delivery_state`/`meta` mudam); delete recusado; `body_search` GIN |
| `inbox_assignment` | histórico de setor/equipe/pessoa com `assigned_at`, `released_at`, `reason`, `origin`, `actor_id` | — |
| `inbox_thread_event` | 24 tipos (`THREAD_CREATED`, `THREAD_REOPENED`, `MESSAGE_RECEIVED`, `MESSAGE_REGISTERED`, `NOTE_ADDED`, `AI_ANALYZED`, `TRIAGED`, `ROUTED`, `ASSIGNED`, `REASSIGNED`, `RELEASED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `LABELS_CHANGED`, `SLA_ESCALATED`, `ACTION_*`, `JOB_*`, `RESOLVED`, `CLOSED`) | append-only por trigger; detalhe curto e sem dígitos longos |
| `inbox_action`, `inbox_job` | ação com aprovação embutida; job com `result` jsonb (evidências) | `inbox_job.action_id` FK; `inbox_action.job_id` referência lógica |

Índices: thread por (org, status, last_message_at), (org, contact, channel, context), (org, sector, status), (org, assignee, status);
mensagem por thread/ocorrência e GIN de busca; evento/atribuição/ação/job por thread.

**Idempotência**: função `inbox_ingest(...)` (SECURITY DEFINER, EXECUTE só para `service_role`) deduplica pela unique,
resolve identidade → contato (cria "Contato não identificado" quando nova), reutiliza a thread não fechada do mesmo
contato + canal + contexto (a mais recente), reabre a fechada mais recente (evento `THREAD_REOPENED`) ou abre uma nova
(`THREAD_CREATED`, SLA da configuração), grava mensagem + `MESSAGE_RECEIVED` — tudo numa transação. Corrida entre dois
webhooks: `unique_violation` é capturada e devolve a mensagem vencedora como duplicada.

**RLS** (mesma matriz de `src/core/permissoes.ts`, sem segundo RBAC): `inbox_role()` = papéis com `inbox`;
`inbox_config_role()` = Administrador/Diretoria. Configuração: `inbox` lê, `inbox_config` escreve. Contato/identidade: `inbox`
lê e cadastra. Thread: visível se transversal, ou `assignee_id = auth.uid()`, ou participante, ou sem setor (triagem), ou
setor em `inbox_user_sectors()` (lê só `inbox_member`). Filhos herdam por `EXISTS` na thread. Regra descoberta e provada:
no Postgres a linha ATUALIZADA também precisa passar pela política de SELECT. A solução do checkpoint (§12.3): quem
encaminha enxerga a conversa **enquanto a atribuição que fez estiver vigente** (`inbox_encaminhei`, lê `inbox_assignment`),
sem virar participante; o adapter grava a atribuição antes de atualizar a thread e atualiza **sem RETURNING**. `authenticated` não tem DELETE (exceto `inbox_member`).

### 11.3 Fluxo de ingestão

```
Meta WhatsApp Cloud → /api/channel/meta/webhook (Central: assinatura, teto, normalização — inalterados)
  → ChannelInboundEvent[] + extrairConteudosMeta(payload) (o texto sai só aqui; a Central segue sem transportá-lo)
  → ingerirEventosCentral (src/core/inbox/ingestaoServidor.ts, puro, portas injetadas)
      → deEventoCentral (adapter: só MESSAGE_RECEIVED inbound com contexto conhecido; WHATSAPP; identidade = telefone E.164)
      → portaIngestRpc (src/core/inbox/ingestaoPorta.ts: RPC inbox_ingest com SUPABASE_SERVICE_ROLE_KEY, só no servidor)
          → identidade → contato → thread (reutiliza / reabre / cria) → mensagem → eventos
      → inteligência? (porta opcional) → classificarSeguro → aplicarClassificacao
         └ indisponível/erro/não auditável → nada muda: thread NOVA em "Não atribuídos" (triagem humana)
  → 200 (ok) · 500 se alguma ingestão falhou (a Meta reenvia; a RPC completa só o que faltou)
```

Variáveis novas (só no painel do Netlify): `SUPABASE_SERVICE_ROLE_KEY` (já existia para o Vibe) e `EIFF_INBOX_ORGANIZATION_ID`.
Sem elas o webhook mantém o comportamento anterior. A Central continua sem chave e sem cliente de banco
(`seguranca.test.ts` prende: o webhook só chama `ingerirEventosCentral`).

### 11.4 Estados, autoridade e eventos

Máquina inalterada (NOVA → TRIADA → ATRIBUIDA → EM_ATENDIMENTO → AGUARDANDO_* → RESOLVIDA → FECHADA; reabrir com motivo).
`eventoDaTransicao` gera `THREAD_REOPENED`, `RESOLVED`, `CLOSED` ou `STATUS_CHANGED`. Quem pode (`podeMudarStatus` /
`podeAtribuir`, espelhados no RLS): transversal; responsável; gestor do setor; e, para conversa **sem** responsável no
próprio recorte, qualquer membro assume ou tria. Perder o responsável numa thread em espera volta para TRIADA.

### 11.5 Setores, equipes, membros e configuração

`Setor` (código estável) › `Equipe` (por setor, opcional) › `MembroSetor` (usuário × setor × equipe? × papel). Roteamento
e visibilidade são por setor; a equipe refina responsável padrão e exibição. Tela `#/atendimento/configuracao`
(permissão `inbox_config`): setores (código, nome, ordem, responsável padrão, ativo), equipes, membros (com remoção),
fallback, escalação, nível padrão e SLA por prioridade; regras de nível/roteamento aparecem somente leitura.

### 11.6 Inteligência

Contrato fechado: `IntelligenceProvider.analisar(InboxAnalysisInput) → { ok, resultado: InboxAnalysisResult } | { ok: false }`.
Entrada: thread, mensagem, histórico limitado, contato, organização, contexto, setores disponíveis. Saída: intenção, assunto,
entidades, resumo, prioridade, nível, setor/responsável recomendados, ação sugerida, confiança, sinais, motivo operacional,
provedor/versão/modelo. `classificarSeguro` nunca lança e recusa resultado não auditável. Implementações: `SEM_INTELIGENCIA`
(indisponível) e triagem humana. **Nenhum LLM real** nesta fase; o provedor entrará por função Netlify.

### 11.7 Factory

`ExecutionProvider` inalterado: MANUAL (job ENVIADO, resultado registrado por pessoa) e FACTORY reservado (recusa
explícita). Action, Approval, Job, Result e Evidence persistidos (`inbox_action`, `inbox_job.result`). Nenhum import de
`src/core/central/`, `githubAdapter` ou do repositório da fábrica no Inbox (teste de pureza).

### 11.8 Testes e gates

`src/core/inbox/inbox.test.ts` (máquina, roteamento, SLA, visibilidade, caixas, gateway idempotente, autoridade,
resolução de thread, fallback sem IA, seed/higiene), `src/core/inbox/ingestaoServidor.test.ts` (adapter, porta RPC,
duplicidade, falha da porta, fallback), `src/data/inbox.store.test.ts` (permissão, atribuição com histórico, status,
rascunho/nota persistidos, triagem, ações/jobs, autoridade, configuração), `src/data/inbox.supabase.test.ts` (adapter:
ordem, insert-only, update sem select, texto só em `inbox_message`, leitura). **RLS** provado em PostgreSQL de verdade por
`scripts/pg-smoke-inbox.mjs` (PGlite, 18 provas A–R, rollback ao final; step "PostgreSQL Smoke (EIFF Inbox)" no CI) e
o preflight da fila inteira aplica 0001..0056. Limitação: a suíte vitest não sobe Postgres; o RLS é provado pelo smoke.

### 11.9 Pendências reais

1. Aplicar 0056 em produção (e, separadamente, 0049–0051 da Central) e configurar `EIFF_INBOX_ORGANIZATION_ID`.
2. Provedor de WhatsApp: a Meta Cloud já está na Central; a Evolution API citada não foi avaliada nem escolhida.
3. Editor de regras de nível/roteamento (hoje somente leitura na configuração).
4. Escalação por SLA como execução automática (hoje só decisão `escalacoesPendentes`).
5. `IntelligenceProvider` real por função Netlify; `FactoryProvider` quando a fábrica expuser API.
6. Vínculo automático contato ↔ Radar/obra e uso de `body_search` na busca da tela.

## 12. Checkpoint de integração (23/09/2026)

### 12.1 Baseline

`origin/main` avançou de d063194 para **7ac9bde** (PR #11 UX-P02 Financeiro compacto; PR #12 Lead Engine 3). Incorporado por
merge (convenção do repositório) em `c8a9e6a`. Único conflito: `CLAUDE.md` (estado das migrations) — mantidas as linhas
atualizadas da main e a nota do 0056. `src/App.tsx` mesclou sozinho (rota `/piloto` da main e `/atendimento` do Inbox em
regiões distintas). Nenhum trabalho do Inbox foi descartado; nenhuma alteração da main exigiu adaptação do Inbox
(`store.ts`, `types.ts`, `permissoes.ts` e `styles.css` só mudaram do lado do Inbox).

### 12.2 Revisão de segurança

| Ponto | Verificação | Resultado |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` no browser | grep em `src/` fora de testes: só `src/core/inbox/ingestaoPorta.ts` (server-side) e `src/core/radar/vibeServidor.ts` (já existente); teste varre `store.ts`, `supabase.ts`, telas e o `dist/` quando existe | nunca chega ao bundle |
| Ingestão chamada pelo frontend | `inbox_ingest` tem `revoke execute … from public, anon, authenticated` e `grant … to service_role`; a função ainda recusa `request.jwt.claims.role ≠ service_role`; smoke F prova `permission denied` para usuário autenticado | não pode |
| Organização escolhida pelo payload | a organização vem de `EIFF_INBOX_ORGANIZATION_ID` (ambiente do Netlify), validada por `configPortaIngest`; a RPC confere `exists organization`; nada do payload da Meta decide organização | server-side |
| RPC `inbox_ingest` | `SECURITY DEFINER`, `set search_path = public, pg_temp`, parâmetros tipados, idempotente pela unique + `unique_violation` capturada (o bloco inteiro é desfeito, nada parcial), isolamento por `organization_id` em todas as consultas | ok |
| Spoofing de identity/provider | a RPC confia no chamador (service role). Provider e identificador vêm do payload **assinado** pela Meta e normalizado pela Central; a única porta é o webhook com HMAC. Um payload forjado sem assinatura válida nunca chega à RPC | mitigado pela Central |
| Corrida | dois webhooks com a mesma mensagem: um insere, o outro cai na unique e recebe `duplicada: true` com os ids do vencedor (smoke B/L) | ok |

### 12.3 RLS e a decisão sobre participante

Revalidado no PostgreSQL descartável (`scripts/pg-smoke-inbox.mjs`, provas G–H, K, Q): Diretoria/Administrador transversal (G);
gestor/atendente só o próprio setor mais o que lhes foi atribuído, de que participam ou sem setor (G/H/K); Auditoria (sem
`inbox`) e outra organização não veem nada (H); `inbox_config` só Administrador/Diretoria (J); filhos herdam (H).

**Participante ≠ acesso indefinido.** No fim da fase 2, quem transferia virava participante para a escrita passar pela
política de SELECT — isto era "mantém acesso indefinidamente". Corrigido antes do PR:

- `participant_ids` = quem **escreveu ou decidiu** na conversa (resposta, nota, proposta, aprovação). Encaminhar e receber
  não tornam ninguém participante. Quem escreveu continua lendo a conversa (revogável no futuro por gestor).
- Quem **encaminhou** enxerga a conversa só enquanto a atribuição que fez estiver vigente: `inbox_encaminhei(thread)`
  (SECURITY DEFINER, lê apenas `inbox_assignment.actor_id` com `released_at is null`; sem recursão com a política dos
  filhos). Na próxima reatribuição o acesso acaba; o "participou historicamente" fica em `inbox_assignment` e nos eventos.
- Adapter: grava a atribuição **antes** de atualizar a thread e atualiza sem RETURNING (smoke I prova as três situações:
  sem atribuição recusa; com atribuição vigente aceita e o autor ainda vê; liberada, deixa de ver).

Limite que existia neste checkpoint (autoridade fina só no store) foi fechado no gate final do PR: ver §12.8.

### 12.4 Migration 0056 — revisão para produção

Conferido: tipos e CHECKs de todos os enums; FKs para `organization`, `profile`, `project`, `worker`, `radar_contact`,
`radar_company`; referências lógicas (sem FK) só para a Central; uniques de setor, equipe, membro (com `coalesce` da equipe),
identidade e mensagem externa; índices para as consultas das políticas (`sector_id`, `assignee_id`, GIN em
`participant_ids`, parcial em `inbox_assignment(actor_id, thread_id) where released_at is null`) e para a resolução de
thread em `inbox_ingest` (`(org, contact, channel, context, last_message_at desc)`); timestamps e defaults; triggers touch,
append-only do evento, imutabilidade e não-deleção da mensagem, coerência de organização; `authenticated` sem DELETE (exceto
membros). Ajustes deste checkpoint: os dois índices novos e `inbox_encaminhei`. Preflight 0001..0056 verde; reaplicação
idempotente provada (L).

### 12.5 `body_search`

Coluna gerada `to_tsvector('portuguese', body)` armazenada, com índice GIN. Contém os lexemas do corpo inteiro (não o texto
literal), na **mesma linha** de `inbox_message`: quem pode ler a linha pode ler o corpo, quem não pode não lê nenhum dos dois
— o RLS é por linha, então não há exposição extra. Permite busca futura (`@@ plainto_tsquery('portuguese', …)`) sem duplicar
conteúdo. Custo hoje: o adapter lê `select *`, então a coluna desce ao navegador; quando a busca for implementada, a leitura
passa a listar colunas.

### 12.6 Fronteiras reconfirmadas

`provider externo → EIFF Central (assinatura, teto, normalização) → ChannelInboundEvent + conteúdo → Inbox`. Teste de
regressão em `inbox.test.ts` ("fronteiras arquiteturais"): o Inbox não contém `META_WHATSAPP`, verificação de assinatura,
formato Graph API nem import de `src/core/central/`; não existe segunda função de webhook; o webhook chama
`tratarWebhookMeta` antes de `ingerirEventosCentral`; nenhum módulo do Inbox importa `eiff-dev-factory`, `githubAdapter`,
`workItem` ou `missionControl`; `FACTORY` recusa; chave de serviço e RPC nunca no código do navegador nem no `dist/`.

### 12.7 Gates do checkpoint

typecheck, lint, vitest (113 arquivos), build, `smoke:inbox` (18 provas) e preflight (0001..0056) — todos verdes; validação
visual de `#/atendimento` e `#/atendimento/configuracao` em modo local sem erro de console do app.


### 12.8 Gate final do PR #13 — autoridade de transferência no banco

O risco restante da §12.3 foi fechado antes do merge: a autoridade deixa de viver só no store. Migration 0056, seção 8.

| Operação | Antes | Agora | Natureza |
| --- | --- | --- | --- |
| atribuir, reatribuir, assumir, liberar, trocar setor, trocar equipe, trocar responsável | `UPDATE inbox_thread` + `INSERT inbox_assignment` pelo adapter | **só pela RPC `inbox_assign_thread`** (as colunas `sector_id`, `team_id`, `assignee_id` não são atualizáveis por `authenticated`; `inbox_assignment` sem INSERT/UPDATE para `authenticated`) | decisão de autoridade |
| status (fechar, reabrir, espera, resolver), prioridade, nível | `UPDATE` comum | `UPDATE` comum, conferido pelo trigger `inbox_thread_autoridade`: transversal, responsável atual, gestor do setor atual ou, sem responsável e no meu recorte, assumir/triar/fechar | decisão de autoridade (trigger) |
| participantes | `UPDATE` comum | `UPDATE` comum; só cresce com o próprio `auth.uid()` (quem escreve/decide), salvo transversal | proteção do modelo |
| aprovar/rejeitar ação | `UPDATE inbox_action` | `UPDATE` comum, conferido pelo trigger `inbox_action_autoridade`: `decided_by` = `auth.uid()`, papel decisor da matriz (Administrador é a exceção), proponente não decide | decisão de autoridade (trigger) |
| assunto, labels, obra, classificação, resumo, SLA, marcas de tempo, referências à Central, nota/rascunho (insert de mensagem), propor ação, job, resultado | `UPDATE`/`INSERT` comum | inalterado (RLS de visibilidade) | edição de dado |

`inbox_assign_thread(p_thread_id, p_sector_code, p_team_id, p_assignee_id, p_reason, p_origin)` é `SECURITY DEFINER` com
`search_path` fixo, EXECUTE só para `authenticated`/`service_role`, ator **sempre `auth.uid()`** (nenhum parâmetro de ator),
thread só da organização do ator (cross-org devolve `thread_nao_encontrada`), e valida em ordem: acesso (a mesma regra da
política de SELECT) → destino da mesma organização (setor ativo, equipe do setor, perfil ativo) → autoridade (espelho de
`podeAtribuir`: transversal; assumir conversa sem responsável no meu recorte; responsável atual; gestor do setor atual;
triagem de conversa sem setor) → mudança real → encerra a atribuição vigente, cria a nova (`actor_id = auth.uid()`),
atualiza a thread (status derivado como `statusAposAtribuicao`, SLA se faltava) e registra os eventos — numa transação:
qualquer falha desfaz tudo (prova N). Os parâmetros são o estado alvo completo; sem mudança nada é gravado.

Adapter: cada atribuição nova do store vira uma chamada à RPC (com o JWT do usuário); o `UPDATE` da thread nunca leva
as colunas governadas; os eventos que o store gerou para essa atribuição são marcados como já persistidos (o banco os
registrou). O store continua com as mesmas regras como validação de UX — elas não contam como proteção.

Provas novas no smoke (I–P): atendente assume conversa do seu setor; atendente sem autoridade não transfere nem alcança
thread de outro setor; gestor transfere (anterior encerrada, nova criada, thread atualizada, eventos) e segue vendo enquanto
a atribuição vigente for dele; outra organização e usuário sem `inbox` não operam; Diretoria opera transversalmente;
destino inválido recusado antes de escrever; falha intermediária faz rollback integral; `UPDATE` direto de responsável,
setor e `INSERT` de atribuição recebem `permission denied`; status por quem não tem autoridade e participante alheio são
recusados pelo trigger; decisão de ação com papel errado, pelo proponente ou com `decided_by` alheio é recusada.

Participantes: decisão da §12.3 preservada — participante é quem contribuiu; encaminhamento dá acesso só enquanto a
atribuição vigente for de quem encaminhou; histórico em `inbox_assignment` e eventos.

## 13. Octopus Router — contrato arquitetural (escrito no checkpoint; implementado na §14)

```
Inbound Message            ChannelInboundEvent + conteúdo, já persistido por inbox_ingest (nunca se perde)
      ↓
Identity Resolution        IdentidadeCanal → ContatoInbox (+ whatsapp_identity da Central para ação sensível;
                           vínculo Radar/obra/perfil)
      ↓
Thread Resolution          mesma identidade + canal + contexto + não fechada → reutiliza; fechada → reabre; senão cria
      ↓
Intelligence Analysis      IntelligenceProvider.analisar(InboxAnalysisInput) → InboxAnalysisResult
                           (só sinais, evidências e motivo operacional; classificarSeguro nunca lança)
      ↓
Routing Decision           rotear(): regras em dados → setor/equipe/responsável/prioridade, com motivos auditáveis
      ↓
Automation Policy          nivelPara(): A (IA responde) · B (IA prepara, humano aprova) · C (humano); nunca afrouxa
      ↓
AI / Human / Approval      ação `responder` proposta → aprovação por papel → rascunho registrado → (fase de envio)
      ↓
SLA / Escalation           slaDe()/estadoSla()/escalacoesPendentes() → SLA_ESCALATED como execução, não só decisão
```

Regras que a fase 3 herda sem renegociar: IA interpreta, motor decide, permissão autoriza, servidor executa, auditoria
registra; texto que chega é dado, nunca instrução; nada é enviado sem rito de canário; Factory só por `ExecutionProvider`.

## 14. Fase 3 — Octopus Router (23/09/2026, branch `feature/eiff-inbox-octopus-router`, migration 0057)

O cérebro de roteamento como **pipeline explícito e auditável**, determinístico primeiro, com a IA como refino opcional e
fallback obrigatório: com a IA fora do ar a cadeia inteira continua funcionando. Nada aqui envia mensagem, nada altera o
webhook da Meta além de entregar os eventos já validados à porta de roteamento, e a Factory continua fora.

### 14.1 Pipeline (`src/core/inbox/roteador.ts`, puro)

`decidirRoteamento(EntradaRoteador) → DecisaoOctopus` encadeia funções pequenas, cada uma com entrada e saída próprias:

| # | Passo | Função | O que produz |
| --- | --- | --- | --- |
| 1 | Resolve Identity | `resolverIdentidade` | contato conhecido? relação, colaborador, identidade verificada, obras |
| 2 | Resolve Thread | `receberMensagem` (fase 2) | nova / reaberta / em andamento — vira sinal em `carregarContexto` |
| 3 | Load Context | `carregarContexto` | obra e responsável da obra (`Obra.responsavel` = usuário), **memória operacional** (últimas 5 conversas do contato: setor, equipe, pessoa, intenção — sinal, nunca regra), mensagens recentes, setores/equipes/membros ativos, configuração |
| 4 | Analyze Message | `analisarMensagem` | texto normalizado, urgência no texto, pergunta, anexos |
| 5 | Detect Intent | `detectarIntencao` | catálogo determinístico `CATALOGO_INTENCOES` (palavras → intenção → setor padrão → risco); a IA só desempata quando o catálogo empata e ela tem ≥ 0,80; sem catálogo e sem IA = `indefinida` |
| 6 | Detect Entities | `detectarEntidades` | NF, pedido, medição, valor, data, obra (código ou nome); a IA acrescenta sem duplicar |
| 7 | Determine Priority | `determinarPrioridade` | **só sobe**: intenção do catálogo, urgência, risco alto, reaberta, recomendação da IA |
| 8 | Select Sector | `selecionarSetor` | **regra explícita da configuração > memória operacional (mesma intenção) > catálogo > IA > fallback**; IA vencida por regra fica registrada como sinal `ia_vencida_pela_regra` |
| 9 | Select Team | `selecionarEquipe` | equipe da regra > do histórico > do responsável da obra > única equipe do setor; nunca de outro setor |
| 10 | Select Assignee | `selecionarResponsavel` | regra > responsável da obra > histórico > IA > padrão da equipe > padrão do setor — **sempre pessoa ativa e membro do setor (ou padrão do setor/equipe)**; fora disso, fica com o setor |
| 11 | Automation Policy | `decidirAutomacao` (`automacao.ts`) | `DecisaoAutomacao { modo AUTO/APPROVAL/HUMAN, motivo, papelExigido?, acoesPermitidas, risco, confianca, regraId? }` |
| 12 | Determine SLA | `slaDe` | `slaAte` pela prioridade (mantém o SLA já existente da thread) |
| 13–15 | Persist / Apply / Emit | store (`aplicarDecisaoOctopus`) ou RPC `inbox_apply_routing` | `inbox_thread.routing`, atribuição pela banda, eventos `ROUTING_DECIDED`, `ROUTED`/`ASSIGNED`/`STATUS_CHANGED`, `PRIORITY_CHANGED` |

**Confiança** é modelo explícito (`calcularConfianca`): piso pela fonte do setor (regra 0,90 · memória 0,75 · catálogo
0,70 · IA 0,50 + 0,3 × confiança dela · fallback 0,30) mais sinais com peso declarado (contato conhecido +0,05, ligado a
obra +0,05, IA concorda +0,10, IA discorda −0,15, contato desconhecido −0,10, intenção indefinida −0,15) e o ajuste da
intenção (fora de regra explícita). A **banda** vem dos limiares configuráveis (`AutoRoteamento`): HIGH ≥
`confiancaAtribuirPessoa` (0,85) atribui pessoa; MEDIUM ≥ `confiancaAtribuirSetor` (0,60) atribui só setor/equipe; LOW
= `TRIAGEM`: a sugestão fica registrada e a conversa continua NOVA em "Não atribuídos". A decisão guarda até 24 sinais
curtos, um `motivoOperacional` de uma frase, a cadeia de escalação (pessoa → equipe → gestor → setor → setor de
escalação; contrato, sem scheduler) e a versão `octopus-1`. Nunca raciocínio encadeado; nunca telefone.

**Reavaliação** (`reavaliar`): mensagem nova em conversa já roteada devolve `KEEP`, `RECOMMEND_TRANSFER` (assunto
mudou; alguém já atende ou a opção automática está desligada) ou `AUTO_TRANSFER` (só com `transferenciaAutomatica`
ligada, confiança ≥ `confiancaTransferir` e ninguém atendendo). **Override humano** (`DecisaoOctopus.override`):
atribuição manual ou triagem com destino diferente do sugerido/aplicado grava quem, quando, de → para e motivo (evento
`ROUTING_OVERRIDDEN`) e a reavaliação nunca o sobrescreve. `resumoParaHumano` é o handoff de uma linha.

### 14.2 Política de automação (`automacao.ts`)

Ordem: regra de automação configurada (`RegraAutomacao`: intenções/setores/tipos de relação → modo, risco, papel
exigido) → sem regra, o nível A/B/C da política (`nivelPara`) → intenção indefinida usa `automacaoPadrao`. As guardas
só apertam: risco ALTO → HUMAN; confiança abaixo de `confiancaAtribuirSetor` → HUMAN; contato não identificado e
contexto INTERNAL sem identidade verificada nunca recebem AUTO. `ACOES_POR_MODO` diz o que a IA pode propor em cada
modo. Padrões: AUT-01 (jurídico, alteração contratual, conflito, exceção financeira, risco operacional, reclamação →
HUMAN/ALTO), AUT-02 (horário, endereço, documento, confirmação, status → AUTO/BAIXO), AUT-03 (pagamento, cobrança,
negociação, orçamento, prazo, logística → APPROVAL/MEDIO).

### 14.3 Inteligência real e fallback

- **Navegador / modo local**: só o determinístico (`inboxReceber`, `inboxRotear`). Nenhuma chave, nenhum fetch — o
  teste de fronteira varre `index.ts`, store, adapter, telas e App por `inteligenciaLlm`, `roteamentoPorta` e
  `ANTHROPIC`, e o bundle por `ANTHROPIC`/`SERVICE_ROLE`/`inbox_apply_routing`.
- **Servidor** (`inteligenciaLlm.ts`, mesma infraestrutura do Diretor Financeiro: `fetch` a `/v1/messages` com
  `output_config.format` json_schema, `effort: low`, 700 tokens, timeout 20 s, sem retry; chave `ANTHROPIC_API_KEY` só
  no painel do Netlify; modelo `ANTHROPIC_INBOX_MODEL` → `claude-sonnet-5`; `ANTHROPIC_INBOX_TIMEOUT_MS`). Contexto
  controlado (`contextoParaIa`): mensagem, thread, contato **sem telefone/e-mail**, histórico limitado a 10, obras,
  setores, equipes, regras resumidas, intenções conhecidas; o prompt declara o conteúdo como dado não confiável. Saída
  validada por `interpretarSaidaIa` contra os catálogos (setor/equipe fora → nulo, confiança 0–1 ou recusa, sinais ≤
  160 caracteres e no máximo 8, entidades só dos tipos conhecidos e sem sequência de dígitos longa, IA nunca ultrapassa
  0,85 quando decide sozinha). `classificarSeguro` converte qualquer falha em "sem IA".
- **Fluxo no webhook** (`channel-meta-webhook.ts` → `ingerirEventosCentral` com a porta `rotear` →
  `rotearNoServidor` em `roteamentoPorta.ts`): `inbox_ingest` persiste → `portaContextoRest` lê só o necessário
  daquela thread (PostgREST com a chave de serviço) → determinístico → IA se houver chave → reavaliação se a thread já
  tinha setor → RPC `inbox_apply_routing`. Falha em qualquer ponto do roteamento não desfaz a ingestão (log com ids e
  outcomes; nunca texto, telefone ou chave). O relatório da ingestão ganhou `roteados`/`atribuidos`.

### 14.4 Persistência — migration `0057_inbox_octopus_router.sql` (só em código; a 0056 não foi alterada)

`inbox_thread.routing` jsonb (CHECK `inbox_jsonb_seguro`; `authenticated` pode atualizar como dado, igual a
`classification`), eventos `ROUTING_DECIDED`/`ROUTING_OVERRIDDEN`/`ROUTING_REEVALUATED`, `inbox_config.auto_routing`
e `automation_rules`. RPC **`inbox_apply_routing`** (SECURITY DEFINER, `search_path` fixo, EXECUTE só para
`service_role`; `auth.uid()` presente = recusa): valida routing/classification (PII), prioridade e nível, thread da
organização, mensagem da thread, **destino dentro do contexto permitido** (setor ativo da organização, equipe do setor,
pessoa ativa da organização **e** membro do setor ou padrão do setor/equipe), prioridade só sobe, SLA se faltava; grava
decisão/classificação/resumo; `p_apply` falso ou banda LOW só registra a sugestão; **override humano preservado e nada
movido** (`motivo = override_humano`); aplicar = encerra a atribuição vigente, cria a nova (`origin = roteamento`,
`actor_id` nulo), deriva o status e registra os eventos — numa transação. O trigger `inbox_thread_autoridade` ganhou a
regra do override: só quem tem autoridade de atribuir (transversal, responsável, gestor do setor, triagem sem setor) e
sempre em nome próprio (`override.por = auth.uid()`). A atribuição humana continua exclusivamente pela
`inbox_assign_thread` da 0056.

### 14.5 Store, adapter e UI

Store: `inboxReceber` roteia (thread sem setor) ou reavalia (com setor) logo depois de persistir a mensagem, dentro de
`try` — falha do router nunca perde a mensagem; `inboxRotear` (sob demanda, exige autoridade de atribuir);
`inboxConfirmarRoteamento` (triagem em um clique: aplica a sugestão ou um ajuste como decisão humana, origem
`triagem`); `inboxAtribuir`/`inboxTriar` registram override quando o destino difere; `inboxSalvarConfiguracao` aceita
`autoRoteamento`, `regrasRoteamento` e `regrasAutomacao` com `validarConfiguracaoOctopus` (limiares 0–1, pessoa ≥
setor, setor ativo, equipe do setor, condição obrigatória, modo/risco do catálogo). Adapter: `routing` na thread,
`auto_routing`/`automation_rules` na configuração; datasets guardados antes da fase 3 são completados com os padrões
(`garantirInbox`). UI: bloco **Roteamento** no painel de contexto (destino, confiança/banda, por quê, automação, SLA
restante, intenção/entidades, reavaliação com "Transferir para X", override, sinais e escalação em `details`, "Rotear
de novo", "Assumir"); em confiança baixa a faixa **Sugestão do Octopus Router … [Confirmar] [Assumir]** (Alterar =
formulário de atribuição); configuração com limiares, automação padrão, transferência automática e editores de linha
para regras de roteamento e de automação (dados tipados, sem DSL).

### 14.6 Provas

`roteador.test.ts` (fornecedor+pagamento → Financeiro; cliente+logística → Obras; memória operacional; regra vence IA;
baixa confiança → triagem; setor inválido/inativo nunca escolhido; equipe do setor e responsável no contexto; prioridade
só sobe; bandas pelos limiares; decisão auditável; passos isolados; política AUTO/APPROVAL/HUMAN e guardas; reavaliação e
override), `inbox.store.test.ts` (roteamento ao receber, baixa confiança fica NOVA, HIGH atribui pessoa, confirmar,
override não sobrescrito, recomendação × transferência automática, autoridade do "rotear de novo", validação da
configuração), `roteamentoServidor.test.ts` (portas REST/RPC com fetch falso e chave que nunca vaza; orquestração com e
sem IA, IA quebrada, baixa confiança, reavaliação, override; porta `rotear` na ingestão; provedor Anthropic com
json_schema, validação, HTTP/JSON/truncada/timeout), fronteiras em `inbox.test.ts`, e no PGlite `npm run smoke:inbox`
provas **S–X** (RPC aplica dentro do contexto e deriva status; destinos inválidos, outra organização e PII recusados sem
gravar; navegador não chama a RPC; override só por quem tem autoridade e em nome próprio, e o servidor não move depois
dele; TRIAGEM só registra e prioridade não desce; 0057 idempotente). Preflight aplica 0001..0057.

### 14.7 Fora de escopo e pendências

Envio real (canário da Central), scheduler de escalação (a cadeia é contrato; `SLA_ESCALATED` continua decisão),
Factory, aprendizado com overrides (só ficam registrados), `/api` para a IA pela tela (o refino da IA acontece no
servidor, na ingestão). Aplicar 0056 + 0057 em produção e configurar `ANTHROPIC_API_KEY` (opcional) são decisões do
usuário.

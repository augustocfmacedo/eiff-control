# EIFF Inbox — fundação (bootstrap 01)

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

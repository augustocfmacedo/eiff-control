# Central de Gestão Comercial EIFF — E11.0 / E11.1

Primeira versão LOCAL (não publicada, sem commit). E11.1 acrescentou a jornada comercial, os três ciclos de vida, o
filtro por responsável, a situação comercial do dossiê e a exclusão dos ensaios por id. Rota `#/comercial/gestao`, grupo Comercial do menu, permissão `radar`.
Código: `src/core/comercial/central.ts` (projeção pura, testada em `central.test.ts`),
`src/core/comercial/demonstracao.ts` (dados fictícios, só modo local), tela `src/screens/comercial/CentralGestao.tsx`
(+ `central.css`, chunk próprio). Base: `origin/main` 53041f8.

## 1. Diagnóstico do CRM atual (o que existe hoje)

| Peça | Onde | Em produção? | O que responde |
|---|---|---|---|
| EIFF Inbox | `src/core/inbox/`, `#/atendimento` | sim (0056–0058; shadow mode; formulário do site ativo desde 11/11/2026) | conversas, responsável, setor, SLA de 1ª resposta, contato realizado |
| Leads do site | `src/core/inbox/leadsSite.ts`, `#/atendimento/leads` | sim (na `main`; as branches `feature/leads-do-site-*` já foram mescladas) | o lead do formulário, configuração do simulador lida do texto da mensagem, prazo de 30 min úteis, próxima ação do primeiro contato |
| Lead Engine | `src/core/radar/leadEngine*.ts`, aba Candidatos | sim (0055; 115 candidatos CNO pendentes) | entrada/candidato e decisão humana de promoção |
| Radar | `src/core/radar/*`, `#/radar*` | sim | empresa, contato, projeto, sinal, oportunidade (15 estágios), atividade, tarefa, histórico de estágio, dono da conta |
| Commercial Machine (CM1-A/CM2) | `commercialMachine.ts`, `commercialCadence.ts`, Panorama/Modo Foco | na `main` | quem trabalhar primeiro, oportunidade parada (SLA por estágio, hipótese versionada), cadência |
| Commercial Director (CD) | `commercialDirector.ts`, metas e desfechos | parcialmente (0070 aplicada; 0074 não) | retrato e medidas do diretor, meta × realizado, livro de desfechos |
| Orçamentos | `src/core/orcamentos.ts`, `#/orcamentos` | sim | custo por composição, BDI, preço, margem, ABC; status Rascunho/Enviado/Aprovado/Contratado/Perdido |

Não existe hoje uma tela que junte as cinco fontes. Cada uma responde parte da pergunta e as telas se cruzam por
navegação manual.

## 2. O que NÃO existe (lacunas que a Central documenta e não preenche)

1. **Proposta comercial.** Não há entidade com número, revisão, condições, validade, aceite e PDF. Hoje os sinais
   estão no Radar: estágios `PRICING`/`PROPOSAL_SENT`/`NEGOTIATION`, atividade e tarefa do tipo `PROPOSAL`. A Central
   mostra esses sinais rotulados como sinal. O `Orcamento` com status `Enviado` também se parece com proposta, mas é
   o orçamento de CUSTO (composições + BDI) — não é a mesma entidade e não se confunde.
2. **Pedido de projeto.** Não há entidade (tipo, escopo, dados técnicos, responsável técnico, prazo, situação,
   documentos). Sinais usados, sem duplicar: lead do site com configuração do simulador; oportunidade em
   `PROJECT_RECEIVED`/`ENGINEERING`; atividade com resultado `REQUESTED_BUDGET`/`REQUESTED_TECHNICAL_ANALYSIS`
   (se a oportunidade dela já está em projeto, a atividade é evidência dela, não segunda linha).
3. **Vínculo orçamento × empresa/oportunidade.** `Orcamento.cliente` é texto livre. A Central NUNCA casa por nome;
   o dossiê diz «sem vínculo canônico».
4. **Documentos comerciais** (planta, sondagem, memorial): não há armazenamento; os anexos existentes
   (`entry_attachment`) são financeiros.
5. **Reagendamento.** Tarefa e próxima ação guardam só o prazo atual; não há histórico de mudanças de prazo.
6. **Qualificação comercial do lead.** Só a classificação do Inbox (intenção), que hoje está com o LLM desligado.
7. **Ensaios internos.** Seguindo docs/formulario-site-go2-go3.md §1.3.1 («excluir os ensaios pelos ids desta
   tabela»), `CONVERSAS_DE_ENSAIO` lista as conversas `5ec4fc0c-…` (GO-1, 10/11) e `9118f1e4-…` (E10.9, 13/11):
   saem dos indicadores, da jornada, dos retornos e das listas de trabalho e aparecem só no filtro «Ensaios
   internos». Nada é alterado no banco. Ensaio novo entra na tabela do doc E na constante no mesmo dia. A etiqueta
   `ensaio` também é reconhecida, para quando houver ação auditada que a preencha.

Antes de qualquer persistência para 1–5, escrever o contrato (entidade, dono, estados, quem grava, RLS,
auditoria) e só então a migration.

## 3. Arquitetura

```
EIFF Inbox ─┐  leadsDoSite / estadoSla / threadVisivel     (autoridade: conversa + SLA)
Lead Engine ┤  registrosFonte (entidadeId, decisão)        (autoridade: entrada)
Radar ──────┤  oportunidades, tarefas, atividades, estágios (autoridade: negócio)
CM1-A ──────┤  construirCommercialQueue → razões PARADA    (autoridade: prioridade/parada)
Orçamentos ─┘  calcOrcamento                               (autoridade: custo/preço)
        │
        ▼
retratoCentral(fontes, ctx)  →  visão · atendimentos · retornos · propostas · solicitações · pipeline
dossie(chave, …)             →  um dossiê por entidade canônica
        │
        ▼
CentralGestao.tsx (só apresenta; ações levam à tela da autoridade)
```

Regras mantidas:

- **Sem segunda prioridade.** Leads na ordem de trabalho do Inbox; retornos por prazo; paradas são as da fila CM1-A
  (sem limiar próprio). Nenhum score novo.
- **Sem dado falso.** `Indicador` é número ou `indisponivel` com motivo (ex.: sem Inbox → leads indisponíveis;
  pipeline sem nenhum valor estimado → indisponível; Radar carregado e vazio → 0).
- **Dossiê canônico.** Chave `empresa:<id>` (Radar) ou `conversa:<id>` (Inbox sem empresa). Lead cujo contato do
  Inbox tem `empresaRadarId` cai no dossiê da empresa — nunca dois dossiês para o mesmo cliente.
- **Valor fechado** só o confirmado ao marcar ganha (`valorFechado`); o estimado nunca vira venda.
- **Data-base**: Radar e fila usam `ds.params.dataBase` (como o Radar Hoje); o SLA do Inbox usa o relógio.
- **Permissão**: rota e menu exigem `radar` (contido em `inbox`); leads ainda passam pela visibilidade do Inbox.
- **Ações sem contrato** (registrar proposta, pedido de projeto, anexar documentos, reagendar, vincular orçamento)
  aparecem desativadas com a justificativa visível. Nada é gravado pela Central.
- **Demonstração**: botão «Ver com demonstração» só no modo local; Radar e orçamentos fictícios em memória, faixa
  «Demonstração · dados fictícios, nada é gravado».

Navegação: abas por área (`?area=visao|leads|retornos|propostas|projetos|pipeline`), dossiê por
`?dossie=empresa:<id>` ou `?dossie=conversa:<id>` (links de toda linha), busca de dossiê no Painel, filtros por
situação (chips com contagem), busca sem acento e responsável em Leads e Agenda, colunas ordenáveis.

Arquivos compartilhados tocados: `src/App.tsx` (lazy + rota), `src/ui/Paleta.tsx` (uma entrada em `ROTAS_NAV`),
`src/core/central/construcao.ts` (a guarda de superfícies do Mission Control exige classificar rota nova: ficou sob o
módulo Máquina Comercial, componente `CENTRAL_GESTAO`).

### Jornada comercial (E11.1) — equivalência para homologação

A jornada pedida pela Direção é LEITURA dos estados existentes; nenhum estado novo, nenhuma prioridade nova. Cada
cliente (dossiê canônico) conta uma vez, na fase mais avançada (`faseDoDossie`).

| Fase | Conversa (Inbox) | Estágio da oportunidade (Radar) |
|---|---|---|
| Lead recebido | aberta, aguardando o 1º contato | DETECTED, RESEARCHING |
| Atendimento | aberta, 1º contato feito | DECISION_MAKER_FOUND, CONTACT_STARTED, ENGAGED |
| Qualificação | — | QUALIFIED, NEED_CONFIRMED |
| Estudo e orçamento | — | PROJECT_RECEIVED, ENGINEERING, PRICING |
| Proposta | — | PROPOSAL_SENT |
| Negociação | — | NEGOTIATION |
| Contratação | — | WON |
| fora da jornada ativa | encerrada sem negócio | LOST (perdido), NURTURE (nutrição) |

Regra de precedência: oportunidade ATIVA mais avançada; sem ativa, conversa aberta (atendimento novo de cliente que
já fechou); depois o último desfecho; por fim, a conversa encerrada. Negociação «avançando × parada» usa as razões
OPORTUNIDADE_PARADA(_CRITICA) da fila CM1-A — sem limiar próprio.

### Três ciclos de vida distintos (`CICLOS_DE_VIDA`)

| Ciclo | Dono | Hoje | Falta |
|---|---|---|---|
| Orçamento técnico | engenharia de custos | entidade `Orcamento` completa (Rascunho → Enviado → Aprovado/Contratado/Perdido/Cancelado) | vínculo por id com empresa/oportunidade |
| Proposta comercial | Comercial | lido de sinais (estágios PRICING/PROPOSAL_SENT/NEGOTIATION, atividades «Proposta», ganho/perda com motivo) | entidade com número, revisão, valor, condições, validade, aceite/recusa, PDF |
| Solicitação de projeto | Engenharia | lido de sinais (simulador do site, PROJECT_RECEIVED/ENGINEERING, atividade «pediu orçamento/análise técnica») | entidade com responsável técnico, prazo, situação, entregáveis e documentos |

### O que já opera × o que falta (`OPERACOES_CENTRAL`, exibido no Painel geral)

Já opera, na tela da autoridade (a Central leva até lá): assumir lead e registrar tentativa/contato (Leads do site),
transferir/status/nota (Inbox), criar/associar empresa de candidato (Command Center), oportunidade/estágio/próxima
ação/tarefa/atividade (empresa no Radar), fila do dia e cadência (Radar Hoje), orçamento técnico (Orçamentos).
A desenvolver: proposta com revisões (E11.3), solicitação de projeto (E11.2), vínculo orçamento × negócio (E11.3),
documentos comerciais (E11.4), histórico de reagendamentos (E11.5).

## 4. Mapa de entidades reaproveitadas

| Área da Central | Entidade canônica | Campo/regra usado |
|---|---|---|
| A Visão geral | todas abaixo | contagens derivadas do retrato |
| B Leads e atendimentos | `InboxThread`, `ContatoInbox`, `InboxMessage` | `leadsDoSite`, `proximaAcao`, `estadoSla`, `situacaoPrimeiraResposta`, `threadVisivel`; conversas `EXTERNAL` do setor `COMERCIAL` |
| C Retornos | `TarefaRadar` (Aberta), `Oportunidade.proximaAcaoEm`, lead aguardando | regra «oportunidade ativa sem próxima ação» do Radar; paradas da fila CM1-A |
| D Orçamentos e propostas | `Orcamento` (+ `calcOrcamento`), `Oportunidade` em estágios de proposta, `Atividade` PROPOSAL, `HistoricoEstagio` | motivo de ganho/perda: `motivoFechamento`/`motivoEstagio` |
| E Solicitações de projeto | lead do site, `Oportunidade` + `Projeto`, `Atividade.resultado` | três sinais, sem duplicar |
| F Pipeline | `Oportunidade` ativa | valor estimado, probabilidade REGISTRADA, `previsaoFechamento` |
| Dossiê | `Empresa`, `Contato`, `ContatoInbox`, `RegistroFonte`, `Fonte` | `empresaRadarId`, `entidadeId`, `commercialOwnerId` |

## 5. Plano de evolução por etapas

- **E11.0 (esta)** — leitura consolidada, local, sem persistência.
- **E11.1 (esta)** — jornada de 7 fases, ciclos de vida, filtro por responsável, situação do dossiê, ensaios por id.
- **E11.1b** — homologação da Direção (equivalência da jornada, textos, indicadores); depois commit/PR e deploy em
  leitura, cada passo com autorização própria.
- **E11.2 — Pedido de projeto**: contrato (entidade `project_request`: empresa/conversa de origem, tipo, dados
  técnicos, escopo, responsável técnico, prazo, situação), migration + RLS + auditoria, ação única no store, e a
  Central passa a ler a entidade em vez dos sinais.
- **E11.3 — Proposta comercial**: entidade `commercial_proposal` com revisões (número, revisão, valor, condições,
  validade, situação, aceite/recusa com motivo), ligada à oportunidade e, opcionalmente, ao `Orcamento` por id —
  resolve as lacunas 1 e 3 juntas.
- **E11.4 — Documentos comerciais**: bucket privado nos moldes de `anexos-financeiros` (0073) ligado a pedido de
  projeto e proposta.
- **E11.5 — Histórico de prazo** (reagendamentos) em tarefa/próxima ação, se a operação pedir.

## 6. Riscos e dependências

- A configuração do galpão é lida do TEXTO da mensagem (`lerSolicitacao`); se o formato mudar, `leadsSite.test.ts`
  quebra antes. A Central herda essa dependência.
- Com o Radar vazio no seed, o modo local só mostra Radar/orçamentos com a demonstração ligada.
- `construirCommercialQueue` roda a cada render dos dados; com milhares de empresas, medir antes de produção.
- Probabilidade usada no ponderado é a registrada na oportunidade (padrão por estágio quando não editada) — não é
  previsão estatística; a tela diz isso.

## 7. Homologação E11.1B (16/11/2026)

Correções feitas na revisão (todas com teste em `central.jornada.test.ts`):

- **Dossiê por CONTATO**, não por conversa: o mesmo contato com conversas no site e no WhatsApp tinha dois dossiês.
  Chave `contato:<id do contato no Inbox>`; com `empresaRadarId`, continua `empresa:<id>`.
- **Vínculo lead → empresa** por dois caminhos reais, nunca por nome: `ContatoInbox.empresaRadarId` (não há tela que o
  grave hoje) ou a promoção humana do candidato no Lead Engine — a mensagem do formulário guarda `meta.registroFonteId`
  e a decisão RESOLVED grava `entidadeId` = empresa (`empresaDaConversa`). Pendente ou rejeitado não associa.
- **Cada submissão do formulário é uma solicitação própria** no dossiê (`solicitacoesDoSite`), rotulada como
  declaração preliminar do cliente.
- **Recomendação da fila CM1-A no dossiê** (`filaCM`: posição, categoria, razão, prazo, contato) — a próxima ação da
  conta vem da Commercial Machine; a Central só a mostra.
- **Ensaios pelo id da SUBMISSÃO** (`SUBMISSOES_DE_ENSAIO`, a mesma lista de `EIFF_FORM_EXCLUIDOS`), além do id da
  conversa: a mensagem do formulário guarda o id da submissão em `externalMessageId`.
- **Mission Control sem efeito**: o componente `CENTRAL_GESTAO` foi retirado (apareceria como CONCLUÍDO antes da
  homologação); ficaram só as duas rotas, e a projeção do catálogo é idêntica à da `main` (conferido por script).
- Foco do teclado volta à aba ativa depois da troca de área; lista chave-valor não estoura mais a 375 px.

### Risco dos ids de ensaio no código e solução recomendada

Hoje a lista existe em três lugares (doc §1.3.1, variável `EIFF_FORM_EXCLUIDOS` da reconciliação e
`SUBMISSOES_DE_ENSAIO`/`CONVERSAS_DE_ENSAIO` aqui). Ensaio novo exige editar código e publicar; esquecer um lugar
faz um ensaio virar lead ou indicador. Recomendado (sem mudar banco agora): **uma marca única no próprio registro**
— etiqueta `ensaio` na conversa do Inbox gravada por ação auditada (Administrador, com motivo) e decisão
`REJECTED` com motivo `ENSAIO` no candidato do Lead Engine — e a reconciliação lendo a mesma fonte. Até lá, a
regra «entra na tabela do doc e nas duas listas no mesmo dia» continua valendo, e um teste pode prender a igualdade
entre a lista do código e a tabela do documento.

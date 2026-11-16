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

## 8. Segurança e acesso por perfil (E11.1E, 16/11/2026)

Branch local `feature/central-comercial-e11-2-seguranca`, a partir do commit homologado `ffdcc08` (PR #89 intocado).

### 8.1 Matriz de acesso

Duas permissões novas na `MATRIZ` (`src/core/permissoes.ts`), separadas de `radar` de propósito: `radar` alcança
Financeiro, Compras e Gestor de obra, que não entram na Central. A regra única fica em `src/core/comercial/acesso.ts`
(`escopoCentral`), usada pela rota, pela tela e pelos testes.

| Perfil | Central | O que vê | Situação |
|---|---|---|---|
| Administrador, Diretoria | integral (`comercial_gestao`) | as seis áreas, valores, pipeline, dossiês, demonstração no modo local | vigente nesta branch |
| **Comercial** | integral | leads, retornos, oportunidades, orçamentos/propostas, pipeline, dossiês | **proposto** — exige enum + acesso no banco (§8.6) |
| Engenharia | técnica (`comercial_projetos`) | só «Solicitações de projeto»: empresa do cliente, tipo, dados técnicos, prazo, situação, responsável comercial | vigente nesta branch |
| Financeiro, Contabilidade, Auditoria | sem acesso | — (informação financeira terá superfície própria) | vigente nesta branch |
| Gestor de obra, Compras | sem acesso | — | vigente; **a confirmar pela Direção** |
| Solicitante | sem acesso | shell do Diretor Financeiro | inalterado |

Mudança em relação ao PR #89: lá a Central abria para todos com `radar` (Engenharia, Financeiro, Compras e Gestor de
obra viam valores, contatos e dossiês). O papel `Comercial` não foi criado no código: `Papel` alimenta `PAPEIS` (tela
de Usuários), trilhas e rotinas da Capacitação e o prompt do Assistente; criá-lo antes do banco ofereceria um papel que
o enum recusa. Ele entra num pacote só, junto com a migration (§8.6).

### 8.2 Diagnóstico de segurança

Provado em PostgreSQL real (PGlite, fila inteira 0001..0075 + carga inicial): `node scripts/pg-smoke-central-comercial.mjs`.

| # | Achado | Gravidade | Evidência |
|---|---|---|---|
| S1 | A leitura das tabelas `radar_*` é **por organização**, sem papel (0031 e seguintes): Contabilidade e Auditoria leem empresas, contatos (telefone e e-mail), oportunidades com valor e notas de negociação por chamada direta à API (PostgREST com o próprio JWT) | alta | prova A: Contabilidade lê empresa, contato, oportunidade e atividade |
| S2 | As views `v_radar_pipeline`, `v_radar_company_queue` e `v_radar_contact_coverage` rodam com os direitos do DONO (sem `security_invoker`) e **sem filtro de organização**: qualquer autenticado, inclusive o Solicitante, lê nomes, cidades, scores e valor do pipeline **de qualquer organização** | alta | provas A e B: o Solicitante lê as três views; a Contabilidade vê a empresa da outra organização |
| S3 | **Fora do escopo comercial:** o Solicitante lê também as views financeiras e de obra (`v_financial_entry_calc` com 41 linhas, `v_dre_monthly`, `v_aging`, `v_opening_balance`, `v_project_360`, `v_service_cost`, `v_service_billing`, `v_service_progress`, `v_composition_cost`, `v_parameter`). O `smoke:solicitante` varre só `pg_tables`, não views; por isso passou | **crítica** (o papel existe em produção) | diagnóstico do smoke, lista completa no JSON |
| S4 | O app carregava o Radar inteiro no navegador de QUALQUER perfil (`carregarRemoto`) e só escondia na tela | alta | código; corrigido nesta branch (§8.3) |
| S5 | As rotas `#/radar*` não conferiam a permissão `radar` (abriam por URL) e os itens do menu não tinham `permissao` | média | código; corrigido |
| S6 | A busca da paleta (Ctrl+K) listava empresas e contatos do Radar para qualquer perfil | média | código; corrigido |
| S7 | O Inbox mostrava o link «abrir empresa» do Radar sem conferir `radar` | baixa | código; corrigido |
| S8 | A Engenharia tem `radar`: mesmo com a Central técnica, lê o Radar inteiro pelas telas do Radar e pela API | média | decisão da Direção (§8.7) |
| S9 | `estimate`/`estimate_item` (orçamentos com preço de venda e BDI) têm leitura por organização (0016) | média | fora deste escopo; registrado |

Endpoints conferidos: `/api/comunicacao` e `/api/channel/octadesk` conferem o papel no perfil do BANCO contra
`PAPEIS_RADAR`; `/api/vibe` é só Administrador/Diretoria; `/api/email-comercial` só `enviar_email`; nenhum deles devolve
lista de empresas ou contatos a quem não tem `radar`. A Central não chama endpoint próprio: tudo o que ela mostra vem do
dataset do navegador, então a proteção real é (a) não carregar e (b) RLS.

Produção não foi consultada nesta etapa: os achados valem para a fila de migrations do repositório. Antes de aplicar a
proposta, confirmar em produção, só com leitura, as opções das views (`select relname, reloptions from pg_class where relkind = 'v'`)
e as políticas (`pg_policies`).

### 8.3 Controles implementados nesta branch (sem banco)

- `comercial_gestao` e `comercial_projetos` na `MATRIZ`; `escopoCentral`, `areaNoEscopo` (área pedida pela URL rebaixada
  à permitida) e `dossieNoEscopo` (dossiê pela URL só na visão integral).
- Visão técnica da Engenharia (`TecnicoView`, `solicitacoesTecnicas`): projeção que **não carrega** nome da pessoa,
  telefone, e-mail, valor, probabilidade, observações da oportunidade, notas de atividade, chave do dossiê nem links.
  Ações de triagem aparecem desabilitadas com o motivo (dependem da E11.2).
- Rota `#/comercial/gestao` pelo escopo; rotas `#/radar*`, menu e paleta pela permissão `radar`; o link do Inbox idem.
- **Minimização**: `carregarRemoto` só traz o Radar para quem tem `radar` (os demais recebem o slice vazio) e
  `prepararDatasetRemoto` não aplica os padrões do Radar a esses perfis; senão a sincronização tentaria gravar fontes e
  estratégias padrão com um perfil que o banco recusa. A carga de servidor (funções Netlify) segue igual.

Limite declarado: para a Engenharia, a visão técnica é recorte de TELA; o dado comercial continua chegando ao navegador
dela enquanto ela tiver `radar` (S8). A separação no banco vem com a tabela do pedido de projeto (§9).

### 8.4 Testes de isolamento

- `src/core/comercial/acesso.test.ts` (13 testes): cada papel de `PAPEIS` no nível da matriz; Comercial só proposto (fora
  de `PAPEIS` e da `MATRIZ`); a Central não herda `radar`; perfil inativo nunca entra; URL de área e de dossiê; e a
  projeção técnica sobre a demonstração (as três fontes): nenhum nome, telefone ou e-mail do Inbox ou do Radar, nenhum
  valor, observação, nota, dossiê ou link; dados técnicos inteiros. Conferido por mutação: trocar a projeção por
  `s.cliente` derruba 3 testes («vazou «Marina Teixeira»»).
- `src/data/centralAcesso.store.test.ts` (4 testes): minimização (sem `radar` → slice vazio e sem padrões; com `radar` →
  como antes; Solicitante intocado) e permissões de menu e paleta.
- `scripts/pg-smoke-central-comercial.mjs` (11 provas, banco real em memória): estado atual (A, B), proposta aplicada
  (C a K), reaplicação idempotente.

### 8.5 Revisão da primeira versão com os perfis

- Direção: igual ao PR #89 (seis áreas, dossiê, demonstração só no modo local com a faixa «dados fictícios», ações sem
  contrato desabilitadas com motivo).
- Engenharia: abre direto em «Solicitações de projeto» (aba única), com a faixa «Visão técnica» e o motivo; URL de outra
  área cai na lista; URL de dossiê mostra o aviso «dossiê não disponível para o seu perfil»; sem botão de demonstração.
  Ela só vê os pedidos vindos de conversas que o EIFF Inbox já mostra a ela (setor ou atribuição) e os sinais do Radar:
  no modo local, os leads do site estão no setor Comercial e a lista dela fica vazia. É o comportamento esperado para
  «atribuídas ou autorizadas» enquanto não existe o pedido formal; com a E11.2, o encaminhamento é que autoriza.
- Financeiro, Contabilidade, Compras e Gestor de obra: sem item no menu; a URL direta mostra «Acesso restrito» com a
  permissão necessária.

### 8.6 Plano de migration (para autorização posterior)

Arquivo: `docs/propostas/comercial-acesso.proposta.sql`, **fora** de `supabase/migrations`; o número é escolhido só na
hora de aplicar (hoje o próximo seria 0076; conferir o repositório E o schema real, porque não há ledger). Duas transações:

1. `alter type role_kind add value 'Comercial'`.
2. `radar_leitura_role()` (papéis com `radar` + Comercial); a leitura das 24 tabelas de DADOS do Radar passa a exigir esse
   papel (as tabelas de configuração continuam por organização); as `_write` da 0031 aceitam Comercial; `inbox_role()`
   aceita Comercial; as três views do Radar com `security_invoker = true`, sem escrita pela view (`v_radar_company_queue`
   é auto-atualizável) e sem nada para `anon` (sugestão da frente S3, prova L do smoke).

Provado no smoke: Contabilidade, Auditoria e Solicitante com 0 linhas em 7 relações; os 6 papéis com `radar` leem
exatamente o mesmo; views só da própria organização e ainda úteis; Comercial lê e grava; reaplicar é inofensivo.
Rollback descrito no cabeçalho do arquivo (o valor do enum não sai; sem perfis, é inerte).

Pacote do papel Comercial no app, junto com a migration: `Papel`, `PAPEIS`, `PAPEIS_RADAR` (servidor de comunicação),
`MATRIZ` (`comercial_gestao`, `comercial_projetos`, `radar`, `inbox`), `TRILHAS` e `ROTINAS` da Capacitação, prompt do
Assistente e `O_QUE_FAZ` da tela de Usuários. Decisões por RPC que hoje são só de Administrador/Diretoria (metas, dono da
conta, envio de e-mail) **não** mudam sem decisão própria.

### 8.7 Decisões pedidas à Direção

- D1: Compras e Gestor de obra ficam sem a Central (proposto) ou entram em alguma visão?
- D2: a Engenharia mantém `radar` (lê o Radar inteiro) até a E11.2, ou perde já (as telas do Radar deixam de abrir para ela)?
- D3: S3 (views financeiras legíveis pelo Solicitante) é de outra frente e grave. Abrir frente própria? O conserto é o
  mesmo (`security_invoker` + filtro por papel), mas mexe em views do motor (`0002_views.sql`) e exige teste de regressão
  das telas financeiras.

## 9. E11.2 — Solicitação de projeto (contrato proposto, sem migration)

### 9.1 O que é e o que não é

É um **pedido formal do comercial à engenharia**, com dono técnico e prazo. Não substitui o estágio da oportunidade (o
Radar continua a autoridade da jornada comercial: `PROJECT_RECEIVED` → `ENGINEERING` → `PRICING`), não é o orçamento
(`estimate`, autoridade de custo e preço) e não é a proposta. Não duplica a ação do Inbox (`inbox_action`/`inbox_job`),
que é execução a partir de uma conversa: o pedido pode NASCER de uma conversa e guarda a referência.

### 9.2 Campos

| Campo | Tipo / origem | Regra |
|---|---|---|
| `id`, `codigo` | uuid; `PP-nnnn` por organização | código em sequência própria |
| `empresa_id` | radar_company | obrigatório (pedido sem cliente identificado não existe) |
| `oportunidade_id` | radar_opportunity | obrigatório; mesma empresa e organização (gatilho de coerência) |
| `projeto_id` | radar_project | opcional (empreendimento do cliente) |
| `origem` | `SIMULADOR`, `INBOX`, `RADAR`, `REUNIAO`, `OUTRO` | mais `origem_ref`: id da submissão (`externalMessageId`), da conversa do Inbox, do candidato do Lead Engine (`radar_source_record`) ou da atividade; sempre o id oficial, nunca nome |
| `tipo_projeto` | catálogo: Galpão, Mezanino, Cobertura, Ampliação, Retrofit, Outro | |
| `terreno` | jsonb: cidade, UF, endereço, área do terreno, topografia, acesso, sondagem disponível (sim/não) | validado por esquema |
| `construcao` | jsonb: tipologia, vão, comprimento, pé-direito, área, cobertura, fechamento, ponte rolante, mezanino | |
| `dados_recebidos` | jsonb: o que o cliente declarou (ex.: configuração do simulador) **como declaração**, com a origem | imutável depois de enviado |
| `documentos_necessarios` | lista: planta, levantamento topográfico, sondagem, memorial, layout | cada item `pendente`, `recebido` ou `dispensado` |
| `responsavel_comercial_id` | profile | obrigatório |
| `responsavel_tecnico_id` | profile (Engenharia) | definido na triagem |
| `prazo` | date | obrigatório ao entrar em desenvolvimento |
| `situacao` | §9.3 | muda só por transição |
| `motivo` | texto | obrigatório em devolução e cancelamento |
| `versao` | integer | concorrência otimista |
| histórico | tabela `project_request_event`, append-only | quem, quando, de → para, motivo |

Documentos: bucket privado próprio, no padrão da 0073 (preparar → enviar → registrar, remoção lógica com motivo).

### 9.3 Jornada (ajustada aos estados existentes)

```
SOLICITADO ──triagem──▶ TRIAGEM_TECNICA ──aceita──▶ EM_DESENVOLVIMENTO ──▶ ENTREGUE ──▶ ENCERRADO
     ▲                        │                          │
     │                        ▼                          ▼
     └──── reenviar ──── DADOS_PENDENTES ◀───────────────┘   (devolução ao comercial, com motivo)
qualquer estado não final ──▶ CANCELADO (motivo)
```

- `DADOS_PENDENTES` **é a devolução**: a bola volta ao comercial e ao cliente, com motivo. Não há estado «Devolvido»
  separado, porque seria um fluxo paralelo do mesmo fato.
- `ENCERRADO` = o comercial consumiu a entrega (gerou o orçamento técnico ou decidiu não seguir), com o resultado.
- Correspondência com a oportunidade, **sugerida, nunca automática**: EM_DESENVOLVIMENTO ↔ `ENGINEERING`; ENTREGUE ↔
  `PRICING`. A Central mostra a divergência («pedido em desenvolvimento, oportunidade ainda em QUALIFIED») como
  pendência; quem muda o estágio é o comercial, pela regra do Radar (próxima ação obrigatória).
- Quem transiciona: Comercial e Direção criam, reenviam, encerram e cancelam; a Engenharia faz a triagem, aceita, devolve
  e entrega. Solicitante e Financeiro não veem.

### 9.4 Integração (sempre por id oficial)

| Fonte | Ligação | Regra |
|---|---|---|
| Submissão do simulador | `origem_ref` = id da submissão; `dados_recebidos` copia a configuração lida da mensagem | ensaio (lista de ensaios ou etiqueta) nunca vira pedido |
| EIFF Inbox | `inbox_thread_id` opcional; ação «Encaminhar à engenharia» na conversa | a conversa continua do Inbox; o pedido só a referencia |
| Lead Engine | exige o candidato **promovido por pessoa** (RESOLVED com `entidadeId`): é isso que dá a `empresa_id` | candidato PENDING não gera pedido |
| Empresa e oportunidade do Radar | FKs + gatilho de coerência (mesma organização, mesma empresa) | sem associação por nome |
| Orçamento técnico | `estimate.project_request_id` (coluna nova, opcional) ao gerar o orçamento a partir da entrega | fecha a lacuna «orçamento sem oportunidade» do §2 |
| Proposta comercial futura | referencia o orçamento, que referencia o pedido | rastro lead → pedido → orçamento → proposta |

### 9.5 Esboço de dados (não testado; vira migration só com autorização)

`project_request` (campos do §9.2) e `project_request_event`. RLS: leitura para Administrador, Diretoria, Comercial e
Engenharia, **sem** dar à Engenharia acesso às tabelas comerciais (ela lê o pedido, não a oportunidade). Escrita só pelas
RPCs `pp_criar` e `pp_transicionar(id, para, motivo, versao)` (security definer, papel conferido no perfil, transição pela
tabela de transições, evento gravado na mesma transação); sem DELETE. Smoke em PGlite no mesmo padrão dos demais antes
de pedir a aplicação.

## 10. Riscos e próximos passos (E11.1E)

- **Riscos**: S3 (views financeiras) existe em produção hoje; S8 até a decisão D2; a minimização depende de `pode()` no
  carregamento, então um perfil trocado no banco só vale no próximo carregamento; o número da migration pode colidir com
  outra frente (conferir na hora); a MATRIZ do app e as listas de papéis do banco continuam duplicadas (teste de paridade
  proposto).
- **Próximos passos**, cada um com autorização própria: (1) decisões D1 a D3; (2) aplicar a proposta do §8.6 com o pacote
  do papel Comercial; (3) frente própria para S3; (4) E11.2 a partir do §9 (migration + RPCs + smoke + tela);
  (5) marca única de ensaio (§7).

## 11. E11.1F — Homologação de acesso e fluxo Comercial → Engenharia (16/11/2026)

Decisões da Direção: **D1** Compras e Gestor de obra ficam fora da Central. **D2** a Engenharia deve ver só o técnico; o
acesso amplo dela ao Radar não sai antes de mapear as dependências, mas não conta como segregação. **D3** as views
financeiras vão para a frente própria **Segurança S3 (P0)**.

### 11.1 Matriz final

| Perfil | Central (tela) | Pedido de projeto (E11.2) | Radar | Garantia hoje (app) | Garantia no banco |
|---|---|---|---|---|---|
| Administrador, Diretoria | integral | cria, encaminha, encerra e age pelos dois lados | sim | rota, menu, paleta, escopo | depende de comercial-acesso + pedido-projeto |
| Comercial | integral | igual à Direção | sim | **papel não existe** (não aparece em Usuários) | depende de comercial-acesso (enum) |
| Engenharia | técnica | vê o **encaminhado** (nunca rascunho); triagem, aceite, devolução, entrega; recusa só na triagem | sim (D2, provisório) | escopo e projeção técnica | pedido-projeto (provado); Radar continua legível (S8) |
| Financeiro | sem acesso | nada | sim | rota e menu | pedido-projeto (provado) |
| Compras, Gestor de obra | sem acesso (D1) | nada | sim | rota e menu | pedido-projeto (provado) |
| Contabilidade, Auditoria | sem acesso | nada | **não** | rota, menu, paleta e o Radar não carrega no navegador | comercial-acesso (provado) |
| Solicitante | sem acesso | nada | não | shell próprio | comercial-acesso (Radar) + **S3** (views financeiras) |

### 11.2 Fluxo Comercial → Engenharia (resolve o bloqueio da visão técnica)

O bloqueio: as conversas do formulário estão no setor Comercial do Inbox, que a Engenharia não enxerga, então a visão
técnica dela ficava vazia. A solução **não** é abrir o Inbox Comercial: é o **pedido de projeto**, uma entidade própria
que o Comercial preenche e encaminha.

```
Inbox (Comercial)          Radar                        Pedido de projeto                      Engenharia
conversa do site ──▶ candidato promovido por ──▶ RASCUNHO (só Comercial) ──enviar──▶ SOLICITADO ──▶ triagem ──▶ aceita ──▶ entrega
                     pessoa → empresa +                (dados declarados                         │        ▲              │
                     oportunidade                       copiados, sem contato)        pedir dados│        │responder     │
                                                                                                 ▼        │              ▼
                                                                                      DADOS_PENDENTES (volta ao Comercial)   ENTREGUE ──▶ Comercial encerra
                                                                                                                             (orçamento gerado / não seguiu)
                                                                                                                             ou reabre com motivo
```

- O pedido copia só o técnico declarado (configuração, medidas, especificação, prazo informado) e referencia empresa,
  oportunidade e a submissão pelo **id oficial**. Mensagem livre, contato e a leitura automática da página não entram.
- A Engenharia lê o pedido pela visão `pp_visao_tecnica()`, que devolve o NOME da empresa e nada mais do Radar; ela
  não precisa ler `radar_*` nem `inbox_*`. É isso que permite cumprir D2 no futuro sem quebrar o fluxo.
- Na tela, até a E11.2 existir, a visão técnica continua mostrando os sinais (o que a Engenharia já enxerga no Inbox e
  no Radar). A tela agora recebe **só a projeção técnica** nas props (nada do retrato comercial atravessa o componente).

### 11.3 Contrato E11.2 (código e banco, sem migration aplicada)

- **Código**: `src/core/comercial/pedidoProjeto.ts` (tipos, `TRANSICOES_PEDIDO`, `aplicarAcao`, `pedidoVisivel`,
  `pendenciasDeEnvio`, `rascunhoDoSimulador`, `divergenciaDeEstagio`) com 16 testes em `pedidoProjeto.test.ts`:
  jornada completa com devolução e reabertura, tabela cobrindo todas as ações e sem saída de estado final, envio
  exigindo empresa/oportunidade/responsável/cidade-UF/dado técnico, aceite exigindo prazo e nenhuma pendência, entrega
  exigindo resumo e documentos resolvidos, versão, lados, só o responsável técnico depois da triagem, recusa da
  Engenharia só na triagem, ensaio e empresa não promovida recusados, nenhuma chave comercial em pedido e eventos.
- **Banco**: `docs/propostas/pedido-projeto.proposta.sql` (`project_request`, `project_request_event` append-only,
  coerência referencial, CHECK contra chaves comerciais em qualquer nível dos jsonb, RLS de leitura, escrita só por
  `pp_criar`/`pp_transicionar`, visão `pp_visao_tecnica`). Depende da parte 1 da `comercial-acesso` (papel Comercial).
- **Prova**: `node scripts/pg-smoke-pedido-projeto.mjs`, 13 de 13 provas: só a gestão comercial cria; rascunho invisível
  à Engenharia; nenhum dos 11 perfis escreve direto (insert, update, delete, histórico); encaminhado visível só a
  Direção, Comercial e Engenharia; visão técnica sem coluna comercial; lados, responsável técnico, versão e motivo;
  jornada até ENCERRADO com a recusa no meio; 8 eventos com de → para e motivo; histórico só para quem vê o pedido;
  chave de contato e oportunidade de outra empresa recusadas pelo banco; outra organização não vê nada.
- Campos, documentos, pendências, prazos, estados e integrações: §9.2 a §9.4, agora com `RASCUNHO` (preparação do
  Comercial, invisível à Engenharia) e as ações nomeadas `enviar`, `iniciar_triagem`, `aceitar`, `pedir_dados`
  (a devolução), `responder_pendencias`, `entregar`, `reabrir`, `encerrar`, `cancelar`.
- Plano de integração (E11.2, cada passo com autorização): aplicar comercial-acesso → aplicar pedido-projeto → mapear
  `project_request` em `supabase.ts` (leitura pela visão técnica para a Engenharia, completa para a gestão) → actions
  do store chamando as RPCs (sem escrita genérica) → botão «Encaminhar à engenharia» na conversa do Inbox e no dossiê →
  aba de pedidos na visão técnica → coluna `estimate.project_request_id` (migration própria) no encerramento.

### 11.4 Dependências da Engenharia no Radar (D2)

Tirar a Engenharia de `radar` hoje afeta: as telas do Radar (Command Center, Hoje, Empresas, Empresa, Abordagem e as
32 ações do store que exigem `radar`); a paleta e o link do Inbox; o servidor de comunicação e o canal Meta
(`PAPEIS_RADAR` em `comunicacaoServidor.ts` e `channel-meta.ts`); o intake CNO (`scripts/cno-intake-producao.mts`); a
intenção `COMMERCIAL_CONSULTAR` da EIFF Central; e, no banco, as listas de papéis com Engenharia nas migrations 0031,
0038, 0045, 0047 e 0056. Caminho proposto: (1) E11.2 no ar (a Engenharia passa a ter o que precisa sem o Radar);
(2) medir o uso do Radar pela Engenharia (telemetria local) e perguntar à Direção; (3) uma migration só que tira a
Engenharia das listas do Radar, junto com `PAPEIS_RADAR` e a `MATRIZ`. O smoke registra hoje: a Engenharia lê 2
oportunidades e 1 contato do Radar (diagnóstico D2).

### 11.5 Dependências com Segurança S3

- Sem duplicação: as três views do Radar estão na `comercial-acesso`; a S3 cuida das views financeiras e de obra
  (`0002_views.sql` e seguintes). Mensagem de coordenação enviada à sessão S3 em 16/11/2026.
- Compatibilidade conferida: a `comercial-acesso` não redefine `has_role`, `current_org` nem views do motor; redefine
  `inbox_role()` e cria `radar_leitura_role()`. Se a S3 precisar redefinir uma função auxiliar, a ordem de aplicação
  muda e o smoke da Frente B tem de rodar de novo.
- Ordem proposta: S3 (P0) → comercial-acesso parte 1 → parte 2 → pedido-projeto. Os números são escolhidos na hora.
- Resposta da S3 (16/11/2026): sem conflito; a proposta dela (`views-security-invoker.proposta.sql`) exclui `v_radar_%`,
  só faz `ALTER VIEW ... SET (security_invoker)` e grants, e concorda com a ordem. A sugestão dela (revogar escrita e o
  acesso de `anon` nas três views do Radar) foi incorporada à `comercial-acesso` e provada (smoke 12/12).

### 11.6 O que é seguro publicar primeiro (sem migration)

Seguro, porque só RESTRINGE o que a tela mostra e o que o navegador carrega: a Central para a Direção em modo leitura
(PR #89); as permissões próprias `comercial_gestao`/`comercial_projetos`; a visão técnica da Engenharia com a projeção;
as portas do Radar (rota, menu, paleta, link do Inbox); a minimização do carregamento do Radar. Nenhuma delas escreve
dado nem muda o banco.

Não é garantia ainda (dependem de migration): isolamento por chamada direta à API (S1, S2), papel Comercial, pedido de
projeto, segregação da Engenharia no Radar (S8) e as views financeiras (S3).

Cuidado ao publicar: Financeiro, Compras e Gestor de obra **perdem** a Central (tinham no PR #89, se ele for ao ar
antes); Contabilidade e Auditoria perdem as telas do Radar que abriam por URL. É o efeito desejado, mas deve ser avisado.

### 11.7 Pendências bloqueantes

- Para **publicar** qualquer coisa: o congelamento da `main` (aviso da sessão Leads do site) e as autorizações de merge e
  de Production.
- Para a **garantia no banco**: aplicar a `comercial-acesso` (depois da S3, P0).
- Para a **E11.2**: aplicar a `pedido-projeto` (depois da `comercial-acesso`) e autorizar a implementação de tela e store.
- Para criar o **papel Comercial**: a parte 1 da `comercial-acesso` e o pacote do app (§8.6).
- Para **D2**: a E11.2 em uso e a decisão da Direção (§11.4).

## 12. E11.2A — Gestão de Solicitações de Projeto (primeira versão funcional, local, 16/11/2026)

Branch local `feature/central-comercial-e11-3-pedidos-projeto`, a partir do `4aec194` (PR #90). PRs #89 e #90 intocados.
Sem persistência homologada: **demonstração local, em memória** (recarregar apaga), com faixa explícita; no modo remoto a
tela não grava nada e mostra o motivo.

### 12.1 O que foi construído

| Peça | Arquivo | Papel |
|---|---|---|
| Motor de estados e validações | `src/core/comercial/pedidoProjeto.ts` | catálogos, `REGRAS_ACAO`, `criarPedido`, `aplicarAcao`, `motivoBloqueio`, `errosDeVinculo`, prazos, resumo, `visaoTecnica` |
| Repositório | `src/core/comercial/pedidosRepositorio.ts` | contrato único para os dois adaptadores; em memória: idempotência por intenção, isolamento por organização, histórico append-only |
| Exemplo fictício | `src/core/comercial/pedidosExemplo.ts` | três solicitações (Solicitado, Dados pendentes, Em desenvolvimento atrasada) pelo mesmo motor |
| Adaptador do app | `src/data/pedidosProjeto.ts` | memória só fora do modo remoto; no remoto lê vazio e recusa escrever (`PERSISTENCIA_PENDENTE`) |
| Telas | `src/screens/comercial/PedidosProjeto.tsx` | lista com indicadores e filtros, formulário em grupos, detalhe, histórico, ações em janelas |
| Integração | `CentralGestao.tsx`, `App.tsx`, `Paleta.tsx`, `construcao.ts` | rota `#/comercial/projetos[/novo|/:id]`; Central: área Projetos com «Abrir solicitação» por oportunidade, dossiê com «abrir solicitação técnica», visão técnica da Engenharia apontando para as solicitações; menu e paleta (`comercial_projetos`); rota classificada no Mission Control |

### 12.2 Estados e ações

| Situação | Com quem | Ações possíveis (lado) |
|---|---|---|
| Solicitado | Engenharia | iniciar triagem (E), atribuir (E), cancelar (C; E só recusa), atualizar documento, editar dados (C) |
| Triagem técnica | Engenharia | registrar triagem — valida dados (E, responsável), devolver por dados pendentes (E, motivo), assumir desenvolvimento (E, prazo), atribuir, cancelar, documento |
| Dados pendentes | Comercial | responder pendências (C, resposta), editar dados (C), atribuir, cancelar (C), documento |
| Em desenvolvimento | Engenharia | registrar andamento (E), devolver por dados pendentes (E, motivo), entregar (E: resumo, resultados, documentos resolvidos), atribuir, cancelar (C) |
| Entregue | Comercial | encerrar (C: segue para orçamento / orçamento vinculado / não seguiu com motivo), reabrir (C, motivo), documento |
| Encerrado, Cancelado | — | **nenhuma** (estado final) |

Não há rascunho: pela jornada definida pela Direção, a solicitação nasce encaminhada (Solicitado). O RASCUNHO do §11
saiu do motor e da proposta SQL. Regras transversais: depois da triagem, só o responsável técnico age pela Engenharia (a Direção age pelos dois lados);
motivo obrigatório em devolução, reabertura, cancelamento e «não seguiu»; versão (concorrência otimista); cada ação gera
um evento com de → para, autor, papel, instante, motivo, detalhe e intenção. O estágio da oportunidade no Radar **nunca**
muda: a tela só sugere avançar quando a oportunidade está atrás da situação da solicitação (nunca sugere voltar).

### 12.3 Campos

- **Identificação**: empresa e oportunidade (Radar, só ativas), origem do lead, tipo (Estudo preliminar, Anteprojeto
  estrutural, Projeto executivo, Análise técnica, Apoio ao orçamento técnico), responsável comercial, prioridade, prazo
  solicitado; vínculos oficiais opcionais por id (conversa do Inbox cujo contato aponta para a empresa, submissão do
  simulador nessas conversas, evidência do Lead Engine promovida para a empresa) e orçamento técnico só no encerramento.
- **Dados técnicos** (catálogo `CAMPOS_TECNICOS`): cidade, UF, endereço, uso, área, comprimento, largura, altura,
  tipologia, cobertura, fechamentos, projeto arquitetônico, fundação e terreno, observações. Cada dado é **declarado**
  (pelo cliente) ou **validado** (pela Engenharia, com autor e data); alterar um dado validado o devolve a declarado.
- **Documentos**: arquitetura, implantação, topografia, sondagem, memorial, complementares — não necessário, pendente,
  recebido (o Comercial marca) ou validado (a Engenharia). Os arquivos ainda não são armazenados (vêm com a persistência).
- **Responsabilidade**: equipe técnica, responsável técnico, prazo de entrega, situação, pendências, histórico.

### 12.4 Integridade, duplicidade e idempotência

- Vínculos só por id e conferidos contra a autoridade: oportunidade inexistente, de outra empresa ou fechada é recusada;
  conversa, submissão e evidência inexistentes também; submissão de ensaio nunca vira solicitação; evidência só se
  promovida (RESOLVED) para a mesma empresa. Nada é associado por nome.
- Uma oportunidade pode ter várias solicitações, mas **uma aberta por tipo**; a seguinte do mesmo tipo, depois de encerrada
  ou cancelada, é a **versão 2, 3…** (`versaoTipo`).
- **Intenção**: o formulário gera uma intenção ao abrir e cada janela de ação gera a sua; repetir o clique devolve o
  resultado original, sem segunda solicitação nem segundo evento. No banco, índice único `(organization_id, intent)` nos
  eventos e índice único parcial «uma aberta por oportunidade e tipo».

### 12.5 Matriz de acesso

| Perfil | Lista e detalhe | Abre | Age |
|---|---|---|---|
| Administrador, Diretoria (e Comercial, quando existir) | tudo, com oportunidade e vínculos | sim | os dois lados |
| Engenharia | **visão técnica**: sem oportunidade, sem vínculos, sem valores, contatos ou negociação | não | lado da Engenharia (responsável técnico depois da triagem); recusa só na triagem |
| Financeiro, Contabilidade, Compras, Gestor de obra, Auditoria, Solicitante | nada (rota e menu bloqueados) | não | não |

Conferido na tela: a página da Engenharia não contém o título nem o valor da oportunidade, o estágio, o dossiê nem os
vínculos; a Contabilidade recebe «Acesso restrito» nas três rotas, por URL.

### 12.6 Testes e homologação

- `pedidoProjeto.test.ts` (22): ciclo completo com devolução, reabertura, cancelamento e estado final; tabela de ações;
  prazo/pendência/documentos; versão; autorização por perfil; documentos por lado; vínculos por id; submissão real e de
  ensaio; idempotência; duplicidade e versões; isolamento entre organizações; visão técnica sem chave comercial;
  Radar e orçamentos intactos; sugestão de estágio só para a frente; prazos e indicadores.
- `src/data/pedidosProjeto.test.ts` (3): remoto não grava nem finge gravar; local usa a demonstração marcada; menu.
- `scripts/pg-smoke-pedido-projeto.mjs` (14 provas, PostgreSQL descartável): só a gestão abre; mesma intenção devolve a
  mesma solicitação; uma aberta por oportunidade e tipo; ninguém escreve direto; a Engenharia não lê a tabela, só a
  visão técnica, sem oportunidade, vínculos ou coluna comercial; lados, responsável, versão e motivo; idempotência na
  ação; ciclo completo com devolução; estado final; histórico; estágio do Radar intacto; vínculos por id e chave fora do
  catálogo descartada; outra organização não vê nem altera.
- Prévia local percorrida pela tela (Comercial ↔ Engenharia), do formulário ao encerramento com orçamento vinculado: 11
  eventos. A 375 px, lista, formulário, detalhe, janela de ação e a área da Central sem estouro horizontal (medido no
  DOM). Dois defeitos achados e corrigidos na homologação: a sugestão de estágio mandava voltar uma oportunidade já em
  «Proposta enviada»; e a janela de documento da Engenharia começava numa situação que ela não podia escolher.

### 12.7 Plano de persistência e migration

1. Segurança S3 (P0) aplicada.
2. `comercial-acesso.proposta.sql` parte 1 (enum Comercial) e parte 2 (acesso).
3. `pedido-projeto.proposta.sql` (este contrato no banco: `project_request`, `project_request_event`, RPCs `pp_criar`,
   `pp_transicionar`, visão `pp_visao_tecnica`), número escolhido na hora, coordenado com as outras frentes.
4. Adaptador `supabase` do `RepositorioPedidos` (RPCs com o JWT do usuário; a Engenharia lê pela visão técnica), sem
   passar pelo diff genérico do Dataset.
5. Armazenamento dos arquivos de projeto (bucket privado no padrão da 0073) e a coluna de vínculo orçamento → solicitação.

### 12.8 Dependências e limites

- **PR #89 e PR #90**: esta branch está empilhada sobre o #90 (que está sobre o #89); integra depois deles.
- **S3**: continua aberta; nada aqui a corrige. A garantia no banco depende da ordem do §12.7.
- **D2**: a Engenharia ainda tem `radar` e lê o Radar pelas outras telas; as solicitações não dependem disso.
- O orçamento técnico vinculado no encerramento é escolhido pelo id na lista de orçamentos, porque ainda não existe
  vínculo oficial orçamento → empresa/oportunidade.

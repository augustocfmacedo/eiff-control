# EIFF Commercial Machine — arquitetura do CM1

Estado: **CM1 fechado** (CM1-A, CM1-B, CM1-C, CM1-D1, CM1-D2, CM1-E). CM2 a CM5 não iniciados.
Branch: `feature/commercial-machine-v1` · baseline: `main @ ab642be` · plano e histórico: `COMMERCIAL_MACHINE_V1_PLAN.md`.

A Máquina Comercial é a **camada de orquestração operacional do Radar**: lê as entidades que o Radar já tem e responde,
de forma determinística e explicável, *o que precisa acontecer agora*, *como executar* e *com qual intenção gerar a
abordagem*. Ela **não é um segundo CRM**, não grava entidade própria e não produz efeito externo.

```text
Radar (fonte de verdade: radar_*)
  ↓
Commercial Queue ............... CM1-A  src/core/radar/commercialMachine.ts
  ↓
Commercial Action Plan ......... CM1-B  src/core/radar/commercialActionPlan.ts
  ↓
Hoje 2.0 ....................... CM1-C  src/screens/radar/Hoje.tsx
  ↓
Commercial Communication Intent  CM1-D  src/core/radar/comunicacaoIntencaoCM.ts
  ↓
Communication Server Truth .....        src/core/radar/comunicacaoServidor.ts (/api/comunicacao)
  ↓
ContentSpec + fact gate ........        src/core/radar/comunicacao.ts, comunicacaoGeracao.ts
  ↓
Rascunho em revisão humana (READY_FOR_REVIEW)
```

---

## 1. Radar — fonte de verdade

A Máquina Comercial **não criou entidade, tabela, migration nem histórico paralelo**. Tudo o que ela decide vem de:

| Conceito | Entidade / tabela | Tipo no app |
|---|---|---|
| Conta | `radar_company` | `Empresa` |
| Pessoa / decisor | `radar_contact` | `Contato` |
| Gatilho factual | `radar_signal` | `Sinal` |
| Negócio | `radar_opportunity` + `radar_opportunity_stage_history` | `Oportunidade`, `HistoricoEstagio` |
| Interação | `radar_activity` | `Atividade` |
| Próxima ação | `radar_task` | `TarefaRadar` |
| Estratégia | `radar_strategy` | `Estrategia` |
| Aprendizado | `radar_experiment` | `Experimento` |
| Abordagem governada | `radar_communication` (+ `radar_communication_event`) | `ComunicacaoRadar` |
| Possível duplicata | `radar_possible_duplicate` | `PossivelDuplicata` |
| Não contatar / canal inválido | `radar_suppression` | `Supressao` |
| Score e decision fit | `radar_score_rule`, `radar_score_setting`, `radar_persona_rule`, `radar_decision_fit_weight` | caches na `Empresa` |

Fila, plano e intenção são **projeções derivadas** calculadas a cada leitura (funções puras). Nada é persistido, exceto
o que já existia: o rascunho de comunicação gravado pelo caminho de geração (com metadados de origem, ver §5).

---

## 2. CM1-A — Commercial Queue

**Pergunta respondida:** *o que precisa acontecer agora?*

`construirCommercialQueue(radar, hoje, { usuariosValidos? })` devolve uma entrada por conta:

- `categoria` e `porQueAgora` — a **ação principal** (uma razão com código, referência exata, fato, prazo, dias);
- `secundarias` — as demais razões estruturadas: `PENDENTE`, `BLOQUEADA` (por trava) ou `ADIADA` (há ação agendada);
- `travas` — separadas da categoria: `DUPLICATA_PENDENTE`, `CONTATO_INELEGIVEL` (bloqueantes), `CONFLITO_TAREFA_COMUNICACAO`,
  `OPORTUNIDADE_SEM_RESPONSAVEL` (não bloqueantes);
- `contato` (sempre elegível), `oportunidadeId`, `sinalId`, `responsavelId` + `origemResponsavel`, `historico`;
- `ordem` — as chaves que explicam a posição (`chaveQueDecideCM(a, b)` diz qual chave decidiu);
- na fila: `foraDaFila` com motivo (`EMPRESA_MESCLADA`, `EMPRESA_INATIVA`, `EMPRESA_SUPRIMIDA`, `SEM_RELEVANCIA_ATUAL`),
  `porCategoria`, `versaoRegras`.

### Categorias (escada de precedência; índice = degrau)

| Degrau | Categoria | Razões típicas |
|---|---|---|
| 1 | `AGIR_AGORA` | resposta não tratada, tarefa vencida, próxima ação de oportunidade vencida, sinal acionável novo com decisor pronto, oportunidade parada crítica |
| 2 | `AVANCAR_OPORTUNIDADE` | oportunidade ativa sem próxima ação, parada além do SLA do estágio |
| 3 | `FOLLOW_UP` | próxima ação hoje, abordagem aprovada aguardando envio manual (conta já contatada), tentativa sem resposta após o intervalo, tentativa com contato inválido |
| 4 | `REVISAR` | abordagem em revisão, inconsistência (trava sem ação a segurar); trava bloqueante vira `TRAVA_PARA_RESOLVER` **no degrau da ação que segura** |
| 5 | `PROSPECTAR` | conta A+/A nunca abordada com decisor e canal; abordagem aprovada em conta nunca contatada |
| 6 | `ENRIQUECER` | sem decisor, decisor abaixo do ideal para sinal, sem canal válido, sinal não verificado |
| 7 | `NURTURE` | resultado negativo ou perda sem fato novo, tentativas esgotadas, oportunidade em nutrição, cliente ganho, sem timing |
| 8 | `AGENDADO` | próxima ação agendada, follow-up aguardando o intervalo |

### Ordenação

**Não existe um segundo score da Máquina Comercial.** Não há soma de pesos. A posição é comparada por chaves em sequência:

1. degrau (categoria na escada; trava herda o degrau da ação bloqueada);
2. tier (prioridade da ação dentro da categoria);
3. urgência (dias medidos em fato real: atraso, dias sem tratamento, dias sem movimento; `AGENDADO` usa −dias até o prazo);
4. classe do Radar (A+ → D);
5. `priorityScore` do Radar — **apenas desempate**;
6. valor ponderado da oportunidade ativa;
7. prazo mais próximo;
8. id da empresa (desempate estável, comparação por código de caractere).

Dado faltante nunca melhora a posição: ENRIQUECER fica abaixo de PROSPECTAR e o `tier` do enriquecimento é o degrau da
ação que existiria com o dado. A entrada é canonicalizada (coleções ordenadas por id) e `hoje` é normalizado para
`YYYY-MM-DD`; comparações comerciais são por dia.

### Regras existentes reutilizadas

`empresaSuprimida`, `contatoElegivel`, `contatoRecomendado`, `fitIdealDe`, `semProximaAcao` (pipeline/contatos),
`sinalAcionavel` + `janelaPorTipo` (sinalLeitura), `historicoDe` + `TRANSICOES_RESULTADO` (comunicacao), `diasEntre`.
Regra local inevitável: `canaisAcionaveisCM` (e-mail/telefone válidos **e** sem supressão `email_bounced`/`invalid_phone`,
que `temCanal` e `canaisDoContato` ainda ignoram).

---

## 3. CM1-B — Commercial Action Plan

**Pergunta respondida:** *como esta ação deve ser executada?*

`planoDeAcaoCM(radar, item)` / `planosDaFilaCM(radar, fila)` — projeção pura; nunca altera ação, categoria, referência
ou ordem do item.

### Modos

| Modo | Significado |
|---|---|
| `CONTATO` | falar com uma pessoa; único modo com objetivo, playbook e canal |
| `ACAO_INTERNA` | trabalho da EIFF (tarefa de pesquisa/proposta, compromisso presencial, definir próxima ação, movimento interno da oportunidade) |
| `REVISAR` | artefato, trava, inconsistência, cadastro ou compromisso que precisa decisão humana |
| `ENRIQUECER` | completar decisor, canal, verificar sinal, validar ou trocar contato |
| `AGUARDAR` | prazo já definido (`aguardarAte`) ou nutrição sem abordagem imediata |

**Regra fundamental: o modo nasce da ação concreta, não da categoria.** `AGIR_AGORA` por resposta é `CONTATO`; por tarefa
`RESEARCH` é `ACAO_INTERNA`; oportunidade parada depende do estágio (movimento com o cliente × interno); tentativa com
contato inválido no mesmo contato é `ENRIQUECER` (troca de contato pode ser `CONTATO`); abordagem em revisão é `REVISAR`;
abordagem aprovada é `CONTATO` com origem `ARTEFATO_APROVADO` (executar o que já foi aprovado, sem gerar outro).

### O plano CONTATO só existe se as sete condições valem

1. empresa não suprimida; 2. contato existente; 3. contato da própria empresa e elegível; 4. canal acionável;
5. histórico/resultado permite comunicar (`selecionarPlaybook` + `TRANSICOES_RESULTADO`); 6. a ação exige contato;
7. nenhuma trava bloqueante sobre a ação ou o contato (e nenhuma abordagem pendente para o mesmo contato).

Se alguma falha, o plano cai em `REVISAR`, `ENRIQUECER` ou `AGUARDAR` com `bloqueios` explícitos, sem objetivo, playbook
ou canal.

### O que o plano fornece

`contato` (id, decision fit, persona, motivo, canais acionáveis) · `comunicacao` (origem, objetivo, playbook, canal,
canais alternativos, CTA do catálogo `OBJETIVOS`, estágio, `motivoSelecao`, `motivoCanal`, canais descartados,
`estrategiaId`) · `enriquecer` / `revisar` / `aguardarAte` · `historico` (última interação real, último resultado,
último contato, tentativas, sem resposta seguidas, se houve resposta, abordagens em revisão/aprovadas; NOTE nunca conta) ·
`bloqueios` · `explicacao` (textos pt-BR dos códigos).

### Canal

```text
canal permitido pela política (recomendarCanal sobre o contato sem os canais inválidos)
∩
canal acionável pela Máquina Comercial (canaisAcionaveisCM)
```

Nunca se promove um canal só porque existe no contato; política sem canal acionável = `ENRIQUECER`. A preferência de uma
tarefa `CALL`/`EMAIL` entra como a preferência explícita que o contexto de comunicação já aceitava.

---

## 4. CM1-C — Hoje 2.0

**Responsabilidade: a tela não decide.** Ela apresenta `CommercialQueue + CommercialActionPlan`.

- **Resumo operacional:** KPIs por categoria (Agir agora, Avançar oportunidade, Follow-up, Revisar, Enriquecer,
  Agendado), contas fora da fila discretas, abas por categoria com contagem.
- **Filtros:** só as minhas (`responsavelId` do item; item sem responsável nunca vira "meu"), classe, categoria, busca
  por empresa ou contato. Filtros só escondem itens; o item em foco que some cede o foco ao primeiro da visão.
- **Próxima ação:** conta (classe, score do Radar marcado como informativo, local, oportunidade, responsável), por que
  agora (razão, trava, fato, prazo, "acima de X por: chave"), ação por modo, pessoa, plano de contato com
  `motivoSelecao` e `motivoCanal` visíveis, histórico, travas separadas em bloqueio / pendência / informação.
- **Fila:** `Tabela` sem colunas ordenáveis, na ordem exata da Commercial Queue; nenhuma reordenação na UI.
- **CTAs por modo:** `CONTATO` abre `Abordagem` com a intenção do plano; `ACAO_INTERNA` conclui a **tarefa referenciada**
  (nunca "a primeira aberta") ou abre a oportunidade; `REVISAR` leva ao artefato ou à tela da trava (duplicatas,
  contatos, oportunidades, não contatar) e abre a abordagem em modo só revisão; `ENRIQUECER` abre contatos ou sinais (sem
  Vibe automático); `AGUARDAR` mostra "Retomar em".
- `filaHoje`, `recomendarAcao`, `NOME_ESTADO_ACAO` e `.recomendacao` **não são mais autoridade da Hoje** (busca estática
  no gate).

A faixa de sugestões da rota Radar (`src/core/sugestoes.ts`, CM1-D1) também resume a Commercial Queue (`porCategoria` e
travas), sem `filaHoje`.

---

## 5. CM1-D — Coerência de autoridade

### Commercial Communication Intent

`IntencaoComunicacaoCM` é uma **projeção de execução** do plano `CONTATO`, não uma entidade persistida:

```ts
interface IntencaoComunicacaoCM {
  origem: 'SELECAO_ATUAL' | 'ARTEFATO_APROVADO';
  empresaId; itemId; contatoId;
  objetivo; playbook; canal;
  comunicacaoId?;           // abordagem aprovada a reutilizar
  acaoCodigo; referencia?;
  versaoRegrasFila; versaoRegrasPlano;
}
```

```text
CommercialActionPlan
        ↓ intencaoDoPlanoCM
IntencaoComunicacaoCM
        ↓
Abordagem (commercialIntent) ── exibição e botões usam a intenção
        ↓
Store: prepararSpecComunicacaoRadar / gerarComunicacaoRadar ── resolverIntencaoCM no dataset do navegador
        ↓
/api/comunicacao { ids, canal, intencaoComercial }
        ↓
Servidor carrega a conta pela RLS e recalcula fila + plano (hoje no fuso da organização)
        ↓
Compara intenção × plano recalculado ── diferente = 409 context_changed
        ↓
contextoComunicacaoCM → ContentSpec → fact gate → LLM + juiz → INSERT READY_FOR_REVIEW
```

**Regra de autoridade:**

> A Máquina Comercial decide a intenção.
> O Server Truth decide se essa intenção continua válida.

Nunca: *o cliente decide e o servidor aceita*. O servidor não confia em nada da intenção: recalcula
`construirCommercialQueue` + `planoDeAcaoCM` sobre empresa, contatos, sinais, atividades, oportunidades + histórico,
tarefas, comunicações, duplicatas, supressões da empresa e de todos os contatos, projetos, estratégias, regras de persona
e pesos, lidos com o JWT do usuário. Só com a intenção igual ao plano recalculado o contexto é montado — com objetivo,
playbook, sinal e estratégia **do plano recalculado** (`buildCommunicationContext` com `intencao`) — e segue o caminho
inalterado: `ContentSpec`, fact gate estrutural, idempotência por `context_hash`, LLM, juiz semântico, INSERT com RLS e
trigger de coerência. Com intenção, `sinalId`/`estrategiaId` enviados pelo cliente são recusados (400).

Rascunhos gerados por esse caminho gravam `generated_content.metadados.origemComercial` (itemId, ação, versões; sem PII).
Na aprovação com edição (`validar_edicao`), um rascunho com essa origem é revalidado pela **sua própria decisão**
(objetivo/playbook/canal gravados) e pela validade atual (empresa não suprimida, contato elegível, canal acionável),
nunca pela decisão antiga do contexto de comunicação.

### Contexto alterado

`409 { erro: 'context_changed', conflito, mensagem, detalhe }`, antes de qualquer chamada ao LLM e de qualquer INSERT.

| Conflito | Quando |
|---|---|
| `VERSAO_REGRAS_MUDOU` | versão de fila ou plano diferente da atual |
| `FORA_DA_FILA` | empresa inativa, mesclada, suprimida ou sem relevância |
| `ACAO_MUDOU` | a ação principal (`itemId`/código) mudou — ex.: resposta tratada por tarefa |
| `MODO_NAO_E_CONTATO` | o plano atual é revisar, enriquecer, ação interna ou aguardar |
| `ORIGEM_MUDOU` | seleção atual × abordagem aprovada, ou outro artefato |
| `CONTATO_MUDOU` | o contato do plano mudou |
| `OBJETIVO_MUDOU` / `PLAYBOOK_MUDOU` | objetivo ou playbook do plano mudou |
| `CANAL_NAO_PERMITIDO` | canal pedido fora dos canais válidos do plano |
| `ARTEFATO_APROVADO` | já existe abordagem aprovada: reutilizar, não gerar |

**Não existe fallback silencioso.** O store lança a mesma mensagem; a Abordagem mostra "Contexto mudou" sem gerar. Logo
após gerar, o próprio rascunho muda a fila para `REVISAR` e a tela informa "Em revisão" (reabrir a Hoje para gerar outra).

### Canais e supressões

Continuam soberanos em todas as camadas: `do_not_contact` e `opt_out` (empresa ou contato), `invalid_phone`,
`email_bounced`, contato inelegível (`INVALIDO`, `SAIU_DA_EMPRESA`, inativo) e a relação empresa/contato (conferida
também no banco pelo trigger de coerência de `radar_communication`).

### Abordagem fora da Máquina Comercial

Sem `commercialIntent` (página da empresa, outros usos), `Abordagem`, store e servidor mantêm o comportamento anterior.
Isso é dívida conhecida (§9), não defeito do caminho CM.

---

## 6. Segurança e efeitos externos

### O que o CM1 NÃO faz

- não envia mensagem, nem automaticamente nem por atalho;
- não remove nem amplia allowlist; não libera envio Octadesk ou Meta; não altera delivery, ledger ou reconciliação;
- não negocia, não cria proposta, não muda preço;
- não movimenta oportunidade de estágio;
- não cria sequência nem cadência autônoma;
- não cria tarefa automaticamente (os formulários de tarefa são abertos pré-preenchidos e o humano salva);
- não dispara Vibe Prospecting nem consome créditos;
- não grava entidade própria nem migration.

O humano continua controlando todo efeito externo: gerar rascunho, editar, aprovar, enviar pelo canal e registrar a
atividade.

---

## 7. Matriz de autoridade

| Decisão | Autoridade |
|---|---|
| Dados da empresa, contatos, sinais, histórico | Radar (`radar_*`) |
| Score (FIT/TIMING/INTENT/RELATIONSHIP/DATA_QUALITY) e classe | Radar (regras configuráveis) |
| Decision fit e persona | Radar (`calcularDecisionFit`, pesos e regras de persona) |
| Elegibilidade de contato e supressão | Radar + regras existentes (`contatoElegivel`, `empresaSuprimida`) + `canaisAcionaveisCM` |
| Entrada na fila e prioridade diária | CM1-A |
| Ação principal, travas, pendências | CM1-A |
| Modo operacional | CM1-B |
| Contato a abordar | CM1-B |
| Objetivo e playbook | CM1-B (`selecionarPlaybook` + `TRANSICOES_RESULTADO`) |
| Canal e alternativos | CM1-B (política ∩ acionável) |
| Apresentação e CTAs | Hoje 2.0 (sem decidir) |
| Intenção de geração | CM1-D (`IntencaoComunicacaoCM`) |
| Validação canônica da intenção | Server Truth (`/api/comunicacao`) |
| Claims permitidos e fatos | Fact gate (`montarContentSpec`, `validarGeracao`) |
| Texto do rascunho | Gerador (determinístico ou LLM) + juiz semântico |
| Aprovação | Humano (revisão; edição revalidada no servidor) |
| Envio | Humano / provider protegido (modo + allowlist + ledger) — fora do CM1 |

---

## 8. Invariantes do CM1

Provados por teste automatizado (`commercialMachine.test.ts`, `commercialActionPlan.test.ts`, `comunicacaoIntencaoCM.test.ts`,
`sugestoes.test.ts`), por guarda estática do gate (19) ou pela verificação visual registrada no CM1-C (19, 20).

1. Empresa suprimida, inativa ou mesclada não entra na fila acionável (vai para `foraDaFila`).
2. O contato indicado pela fila e o contato de todo plano `CONTATO` são elegíveis e da própria empresa.
3. O canal de todo plano `CONTATO` pertence a `canaisAcionaveisCM`; `invalid_phone` e `email_bounced` nunca reaparecem.
4. Dado faltante nunca melhora a posição de uma conta.
5. A prioridade é determinística: mesma entrada → mesma fila; permutação das coleções e `hoje` como data ou ISO não
   mudam nada; a entrada nunca é mutada (deep freeze).
6. Toda ação principal tem razão com código, texto pt-BR e referência que existe no dataset e pertence à conta.
7. NOTE não substitui interação comercial real (nem para resposta, nem para histórico).
8. Resposta não tratada não expira artificialmente; tratada (tarefa, estágio, oportunidade ou abordagem posterior) deixa de ser urgente.
9. Resultado negativo ou perda não reacende a conta sem fato novo (sinal acionável detectado depois).
10. Tarefa ou próxima ação agendada impede trabalho concorrente gerado pela máquina (prospectar, enriquecer, follow-up, nutrir).
11. Sinal fora da janela da sua família não cria urgência.
12. Oportunidade com tarefa aberta vinculada não gera falso "sem próxima ação"; próxima ação vencida é detectada.
13. Trava bloqueante nunca promove a conta: a revisão ocupa o degrau da ação que segura.
14. O modo nasce da ação concreta; só `CONTATO` tem objetivo, playbook e canal, e só se as sete condições valem.
15. Objetivo e playbook sempre existem nos catálogos; o CTA é o do catálogo `OBJETIVOS`.
16. O plano nunca altera ação, categoria, referência, tipo de tarefa ou ordem da fila.
17. Tentativa com contato inválido nunca gera abordagem para o mesmo contato.
18. Abordagem em revisão ou aprovada para o mesmo contato impede uma segunda abordagem concorrente.
19. Nenhuma UI recalcula a decisão: a Hoje não usa `filaHoje`/`recomendarAcao` e não reordena; a tarefa usada é a referenciada.
20. "Só as minhas" nunca atribui ao usuário um item sem responsável.
21. A faixa de sugestões do Radar tem as mesmas contagens da Commercial Queue.
22. A intenção CM não é reinterpretada silenciosamente: IA e versão padrão usam a mesma intenção; objetivo, playbook,
    canal e contato chegam iguais ao `ContentSpec`.
23. Contexto alterado gera conflito explícito (`409 context_changed`), antes de LLM e INSERT; nunca fallback.
24. Abordagem aprovada nunca gera outra abordagem.
25. Server Truth permanece soberano: fila e plano recalculados no banco com o JWT do usuário; "hoje" do servidor pelo
    fuso da organização; o dataset reconstruído do banco produz o mesmo item e plano do cliente.
26. Não existe envio autônomo nem chamada a provider, delivery ou Vibe nos módulos da máquina.
27. Nenhuma entidade paralela de CRM, tabela ou migration foi criada.

---

## 9. Hipóteses versionadas

**Todas são hipóteses operacionais iniciais, sujeitas a calibração por CM4 — não são verdade comercial definitiva.**
Mudar um valor exige subir a versão correspondente. Nenhuma está em banco nesta fase.

### `VERSAO_REGRAS_CM = 'CM1-A.1'` — `HIPOTESE_COMMERCIAL_MACHINE` (`commercialMachine.ts`)

| Hipótese | Valor |
|---|---|
| SLA de movimento por estágio (dias) | DETECTED 14 · RESEARCHING 10 · QUALIFIED 7 · DECISION_MAKER_FOUND 5 · CONTACT_STARTED 5 · ENGAGED 7 · NEED_CONFIRMED 7 · PROJECT_RECEIVED 3 · ENGINEERING 10 · PRICING 7 · PROPOSAL_SENT 5 · NEGOTIATION 5 |
| Parada crítica | ≥ 2 × SLA do estágio → `AGIR_AGORA` |
| Intervalo de follow-up após tentativa sem resposta | 4 dias |
| Limite de tentativas seguidas sem resposta | 5 → `NURTURE` |
| Janela de sinal "novo" | detectado há até 7 dias (e dentro da janela da família: 540/270/120 dias; sem família 120) |
| `fit.adequado` padrão (espelho do pipeline) | 40, quando a chave não existe |
| Precedência das categorias | a escada da §2 |

### `VERSAO_REGRAS_PLANO_CM = 'CM1-B.1'` — `HIPOTESE_PLANO_CM` (`commercialActionPlan.ts`)

| Hipótese | Valor |
|---|---|
| Estágios em que o movimento depende do cliente | DECISION_MAKER_FOUND, CONTACT_STARTED, ENGAGED, NEED_CONFIRMED, PROPOSAL_SENT, NEGOTIATION |
| Tipos de tarefa considerados contato | CALL, FOLLOW_UP, EMAIL |
| Tarefas presenciais (ação interna) | MEETING, VISIT |
| Canal pedido pelo tipo de tarefa | CALL → telefone · EMAIL → e-mail |

Servidor: fuso da organização `EIFF_FUSO_HORARIO` (padrão `America/Sao_Paulo`) — configuração, não hipótese comercial.

---

## 10. Dívidas conhecidas

1. **`pipeline.ts` (D1–D9).** As divergências entre `recomendarAcao` e a Máquina Comercial continuam e estão presas em
   teste (`commercialMachine.test.ts` e `commercialActionPlan.test.ts`). O pipeline legado **não deve ser corrigido
   incidentalmente**: é frente própria.
2. **Badge do menu "Radar · Hoje".** `App.tsx` ainda conta tarefas abertas vencidas. `contadorRadarHojeCM` (em
   `sugestoes.ts`) está pronto; a integração espera a Wave 03 da Central no baseline (evita conflito em `App.tsx`).
3. **Abordagem fora da Máquina Comercial.** Sem `commercialIntent`, pode recomendar canal diferente (ignora supressão por
   canal) e citar sinal antigo escolhido por `sinalPrincipal`. Dívida do caminho legado, não do caminho CM.
4. **Delivery.** O ledger `radar_communication_delivery` continua fora do `RadarDataset` e do CM1; entrega UNKNOWN não é
   considerada pela fila.
5. **Data-base manual.** Com data-base manual diferente de hoje no fuso da organização, o servidor pode responder
   `context_changed` (ação recalculada em outro dia). Explícito, mas pode confundir.
6. **Custo de leitura.** A geração com intenção faz carga adicional por conta (tarefas, comunicações, duplicatas,
   histórico, supressões de todos os contatos). Monitorar antes de otimizar.
7. **Command Center.** O bloco "Leads prioritários" ainda lista o top 5 de `filaHoje` com a ação de `recomendarAcao`,
   podendo contradizer a Hoje. Não corrigido no CM1.
8. **`CLAUDE.md`.** Não descreve a Máquina Comercial (arquivo compartilhado, alterado pela Wave 03): atualizar depois da
   integração.
9. **`motivoSelecao` / `motivoCanal`.** São os textos existentes das regras de comunicação e mostram códigos crus
   (ex.: `REQUESTED_BUDGET`, `CONTACT_STARTED`). Cosmético.
10. **Objetivo em estágios avançados.** Em `PROPOSAL_SENT`/`NEGOTIATION`, o objetivo sai de `selecionarPlaybook`, que
    não diferencia esses estágios (pode sugerir descoberta para cobrar proposta). Tema de CM2/CM3.

### Consumidores conhecidos da autoridade antiga

Busca por `filaHoje`, `recomendarAcao`, `contextoComunicacaoDe` e `lerEmpresa` fora de testes (CM1-E).

| Consumidor | Uso | Classificação |
|---|---|---|
| `src/screens/radar/CommandCenter.tsx` | top 5 "Leads prioritários" por `filaHoje` | **precisa migrar** (contradiz a Hoje) |
| `src/screens/radar/Empresa.tsx` | `lerEmpresa`: "ação recomendada", "sem próxima ação", "Agendar esta ação" | **precisa migrar** (mesma conta com outra decisão) |
| `src/App.tsx` (contador do menu) | contagem de tarefas vencidas, não a fila | **precisa migrar** (após a Wave 03) |
| `scripts/radar-registrar-sinal-producao.mts`, `radar-registrar-atividade-producao.mts` | posição na fila antiga no "antes/depois" | **precisa migrar** (operação em produção) |
| `scripts/radar-persona-alinhar-producao.mts` | estado de `recomendarAcao` no "antes/depois" | **precisa migrar** (operação em produção) |
| `src/screens/radar/Vibe.tsx` | contas sugeridas para busca de decisor (`SEARCH_DECISION_MAKER`) | **frente própria** (envolve créditos pagos; alinhar com `ENRIQUECER`) |
| `src/screens/radar/Abordagem.tsx` (sem `commercialIntent`) | contexto de comunicação legado | pode permanecer legado; correção na frente do pipeline |
| `src/data/store.ts` (`prepararSpecComunicacaoRadar`/`gerarComunicacaoRadar` sem intenção) | contexto de comunicação legado | pode permanecer legado |
| `src/core/radar/comunicacaoServidor.ts` (`reconstruir` sem intenção, `validar_edicao` de rascunho sem origem CM) | Server Truth legado | pode permanecer legado (contrato público mantido) |
| `src/core/radar/comunicacao.ts` (`contextoComunicacaoDe` → `recomendarAcao` em `proximaAcaoAtual`) | texto interno do contexto | **frente própria** (pipeline) |
| `src/core/radar/pipeline.ts` (`filaHoje` → `lerEmpresa` → `recomendarAcao`) | definição do legado | **frente própria** (pipeline) |
| `src/core/radar/cobertura.ts` | estados da cobertura de decisores | **frente própria** (alinhar estados com o plano) |
| `src/core/radar/signalPilot.ts` | leitura do piloto de sinais | pode permanecer legado (piloto analítico, não comanda a fila) |
| `src/core/radar/calibracao.ts`, `scripts/radar-calibracao-aplicar.mts`, `scripts/radar-calibracao-simular.mts` | relatórios da calibração de produção 01 | pode permanecer legado (histórico da calibração aplicada) |
| `src/core/sugestoes.ts` | faixa de sugestões | **já migrado** (CM1-D1) |

---

## 11. Contrato de entrada do CM2 (cadência)

O CM2 **poderá**:

- propor cadência por estratégia, persona, estágio e resultado anterior;
- recomendar a próxima data de toque;
- gerar **sugestão** de tarefa;
- criar tarefa `radar_task` **somente após decisão explícita do usuário**, com auditoria;
- reagir ao resultado registrado em `radar_activity` (pausar, reagendar, trocar canal dentro do plano).

O CM2 **não poderá**:

- substituir o CM1-A como autoridade da fila, da prioridade ou da ação principal;
- substituir o CM1-B na decisão de modo, contato, objetivo, playbook ou canal;
- enviar automaticamente ou contornar provider protegido, allowlist ou ledger;
- ignorar supressão, opt-out, contato inelegível ou canal inválido;
- criar sequência, cadência ou histórico paralelo ao Radar (tarefas continuam em `radar_task`, interações em `radar_activity`);
- criar tarefa duplicada (mesma conta, contato, objetivo e janela já cobertos por tarefa aberta);
- gerar ação quando a conta está `AGENDADO` antes do prazo;
- ignorar resultado negativo sem fato novo;
- contornar o Server Truth ou reinterpretar a intenção CM na geração.

Qualquer nova hipótese do CM2 entra versionada ao lado de `VERSAO_REGRAS_CM` / `VERSAO_REGRAS_PLANO_CM` e, se precisar de
schema, primeiro como proposta documentada (sem numerar migration enquanto a Wave 03 não estiver no baseline).

---

## 12. Runbook: como validar a Máquina Comercial

Comandos reais do projeto (`package.json`: `test` = `vitest run`, `lint` = `eslint src`, `build` = `tsc --noEmit && eslint src && vite build`).

```bash
npx vitest run src/core/radar/commercialMachine.test.ts
```

```bash
npx vitest run src/core/radar/commercialActionPlan.test.ts
```

```bash
npx vitest run src/core/radar/comunicacaoIntencaoCM.test.ts
```

```bash
npx vitest run src/core/sugestoes.test.ts
```

```bash
npx vitest run src/core/radar/comunicacaoServidor.test.ts src/core/radar/comunicacaoLlm.test.ts
```

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

```bash
npm run build
```

Guarda estática da Hoje (não há teste de componente no repositório): o comando abaixo não pode imprimir nada.

```bash
grep -nE "filaHoje|recomendarAcao|NOME_ESTADO_ACAO|\.recomendacao" src/screens/radar/Hoje.tsx
```

Guardas estáticas dentro dos testes: os módulos da máquina
(`commercialMachine`, `commercialActionPlan`, `comunicacaoIntencaoCM`) não importam store, React, rede, provider ou
delivery; o bloco Radar de `sugestoes.ts` não usa `filaHoje`. A busca de consumidores legados está na §10.

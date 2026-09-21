# EIFF Commercial Machine v1

Baseline: `main @ ab642be3c6cfb918241b6c8b637d485a05ce810e`

Branch exclusiva: `feature/commercial-machine-v1` (CM1, congelada em `a9ef237`) · CM2: `feature/commercial-machine-cm2` (base `a9ef237`)

## Estado (atualizado no CM2-F)

**CM1 fechado.** Arquitetura, invariantes, matriz de autoridade, hipóteses, dívidas e contrato do CM2: `docs/commercial-machine.md`.

**CM2 fechado.** Cadence Engine v1 completo (contrato temporal, motor, sugestão de compromisso, Hoje, fronteira de
escrita governada e confirmação humana), invariantes, dívidas abertas e fechadas, versões e gate final:
`docs/commercial-machine-cm2.md` (documento canônico).

| Bloco | Estado | Commit |
|---|---|---|
| CM0 — contrato operacional e baseline | SUPERADO (substituído pelo CM1-A; commits `57abb88`, `c2cdfe4`) | — |
| CM1-A — Commercial Queue (motor corrigido) | DONE | `38ae3b6283e6818ef1d782037f1bc40b4a233c73` |
| CM1-B — Commercial Action Plan | DONE | `c9bae078f2f5a4bc220a2b3d923a9782a0bfbcc8` |
| CM1-C — Hoje 2.0 | DONE | `4db77587829469c9811a7b3dfea028587f0aa901` |
| CM1-D1 — sugestões do Radar pela fila | DONE | `c503199cf7d8bff08c5b76139321432921a79cac` |
| CM1-D2 — intenção comercial até o Server Truth | DONE | `2cef7059599324203d28c1f67837241c45c27459` |
| CM1-E — consolidação e fechamento formal | DONE | `a9ef23798eb6ee1c4c538f3b491804e848fa73b0` |
| CM2-A — contrato temporal e paridade CM1-A.1 | DONE (branch `feature/commercial-machine-cm2`, base `a9ef237`) | `2ec5da1eebbfd162b6f4cb372ac67e56ad40daca` |
| CM2-B — Cadence Engine puro (`VERSAO_REGRAS_CADENCIA_CM = CM2-B.1`) | DONE | `d94313fb581708dac17cf5fb58a68bdd29ebe703` |
| CM2-C — sugestão governada de compromisso (chave semântica + cobertura) | DONE | `113008311baa10d36d9ee6b1a4a56deaeaa5ab33` |
| CM2-D1 — cadência e sugestão na Hoje, somente leitura | DONE | `7859c430b34b984cef4144477d6676e406d9cc8e` |
| CM2-E — fronteira de escrita governada no store | DONE | `b16bf49e6a73828d340b61b7843f0a286fcdcd37` |
| CM2-E.1 — recusa estruturada, usuários válidos, contato/canal | DONE | `d053b823481763a0c38fbc6b831a39826f948637` |
| CM2-D2 — ativação assistida (CTA + formulário governado) | DONE | `33cd9a28d101382ae011be5f70a87726a13a5ba3` |
| CM2-D2.1 — responsável vazio e rótulo do CTA manual | DONE | `7e4ebea276702c5e2ba0d7c7d0a49c72ccb6bc4d` |
| CM2-F — consolidação e fechamento formal (só docs) | DONE | este commit |
| **LEAD ENGINE 1.0** — alimentação contínua do Radar | NEXT (não iniciado) | — |
| CM3 — Opportunity Control | NOT STARTED | — |
| CM4 — Measurement & Learning | NOT STARTED | — |
| CM5 — Assisted Execution | NOT STARTED | — |

Hipóteses em vigor: `VERSAO_REGRAS_CM = CM1-A.1`, `VERSAO_REGRAS_PLANO_CM = CM1-B.1` e
`VERSAO_REGRAS_CADENCIA_CM = CM2-B.1` — hipóteses operacionais iniciais,
sujeitas a calibração por CM4. A regra temporária de migrations (§2) continua valendo: a Wave 03 da Central ainda não está
em `main`.

Objetivo: transformar o Radar de uma base forte de inteligencia comercial + CRM + comunicacao em uma maquina operacional de vendas, com fila priorizada, cadencias, disciplina de proxima acao, governanca de abordagem, medicao de conversao e ciclo de aprendizado — sem criar um segundo CRM e sem tocar na EIFF Central.

## 1. Fronteira de ownership

Esta frente pode evoluir:

- `src/core/radar/**`
- `src/screens/radar/**`
- `src/data/radar.supabase.ts`
- scripts `scripts/radar-*`
- funcoes server-side exclusivamente comerciais/Radar
- documentacao do Radar e desta frente
- testes exclusivamente comerciais/Radar

Esta frente NAO toca:

- `src/core/central/**`
- `src/screens/Central*`
- `src/screens/MissionControl.tsx`
- `netlify/functions/channel-meta-webhook.ts`
- `netlify/functions/central-*`
- `docs/eiff-central.md`
- `docs/central-*`
- contratos, gates ou permissoes da Central

`App.tsx`, `store.ts`, `styles.css`, `CLAUDE.md` e arquivos compartilhados so podem ser alterados quando estritamente necessario para integrar uma capacidade comercial e com diff minimo, sem modificar comportamento da Central.

## 2. Regra temporaria para migrations

Nao criar nova migration Supabase nesta branch enquanto a Wave 03 da Central nao estiver integrada em `main`.

Motivo: a frente `integracao-wave03` ja avancou o banco ate `0052` e existe divida/candidato para `0053`. Criar uma migration numerada a partir do estado de `main` produziria colisao de namespace e risco operacional.

Enquanto isso, qualquer mudanca de schema da Commercial Machine deve existir apenas como proposta em `docs/propostas/commercial-machine/`, sem aplicacao.

## 3. Estado atual herdado do Radar

A Commercial Machine parte de um Radar que ja possui:

- empresa como entidade raiz; contatos, projetos, sinais, oportunidades, atividades e tarefas;
- pipeline de oportunidades e historico de estagio;
- regra de proxima acao obrigatoria para oportunidade ativa;
- deduplicacao, supressao, auditoria e linhagem de dados;
- score multidimensional FIT / TIMING / INTENT / RELATIONSHIP / DATA_QUALITY;
- calibracao de fit e decision fit;
- ingestao e enriquecimento por fontes externas, incluindo Vibe;
- Signal Pilot para leitura operacional de sinais;
- Command Center, Hoje, Empresas, Empresa, Abordagem, Cobertura, Entrega e Vibe;
- Communication Intelligence com objetivos, playbooks, politica de canal, ContentSpec e fact gate;
- geracao server-side com IA sob Server Truth e revisao humana;
- persistencia e trilha imutavel de comunicacoes;
- provider Octadesk com ledger de entrega, reconciliacao e caminho de canary protegido por modo + allowlist;
- nenhum envio autonomo liberado.

A base de dados e os motores ja resolvem boa parte das pecas. O que falta e a camada de ORQUESTRACAO OPERACIONAL que faz essas pecas funcionarem como um sistema comercial diario.

## 4. Principio de arquitetura

A Commercial Machine nao cria entidades paralelas quando o Radar ja possui a verdade do dominio.

- `radar_company` continua sendo a conta.
- `radar_contact` continua sendo a pessoa/decisor.
- `radar_signal` continua sendo o gatilho factual.
- `radar_opportunity` continua sendo o negocio em andamento.
- `radar_activity` continua sendo o historico de interacao.
- `radar_task` continua sendo a proxima acao executavel.
- `radar_strategy` continua sendo a estrategia comercial configuravel.
- `radar_experiment` continua sendo a unidade de aprendizado.
- `radar_communication` continua sendo o artefato de abordagem governada.

A nova camada deve ORQUESTRAR essas entidades, nao duplicar CRM.

## 5. Resultado esperado da v1

Ao abrir o Comercial, um vendedor ou gestor deve conseguir responder imediatamente:

1. Quem devo abordar agora?
2. Por que essa conta esta acima das outras?
3. Quem e a melhor pessoa para abordar?
4. Qual e o objetivo desta interacao?
5. Qual canal e playbook devo usar?
6. O que aconteceu nas tentativas anteriores?
7. Qual e a proxima acao e quando ela vence?
8. Qual oportunidade esta parada ou em risco?
9. Que parte da maquina esta convertendo ou falhando?
10. O que o sistema recomenda mudar a partir do resultado observado?

## 6. Invariantes da Commercial Machine v1

1. Nenhuma abordagem nasce de fato nao verificado quando o texto o apresenta como fato.
2. Nenhum envio automatico. Todo efeito externo continua sob as guardas ja existentes e, na v1, exige decisao humana.
3. Nenhuma oportunidade ativa sem proxima acao.
4. Nenhuma cadencia pode ignorar supressao, opt-out, contato invalido ou regras de canal.
5. Resultado da tentativa precisa alimentar atividade, tarefa seguinte, score e aprendizado.
6. A fila comercial deve ser explicavel: cada prioridade mostra os fatores que a colocaram ali.
7. O sistema nao pode inventar responsabilidade do contato, obra, prazo, valor ou relacao entre fatos.
8. Toda automacao deve ser idempotente e auditavel.
9. O vendedor pode executar; o sistema recomenda e organiza. Autonomia de envio fica fora desta v1.
10. Nenhuma dependencia da EIFF Central para o funcionamento da Commercial Machine.

## 7. Blocos de execucao

### CM0 — Contrato operacional e baseline — SUPERADO

> Substituído pelo CM1-A: a auditoria do CM0 encontrou bloqueadores (supressão de empresa ignorada, elegibilidade de
> contato reimplementada, ordenação por soma de pesos) e o motor foi reescrito sobre as regras existentes do Radar.

Objetivo: congelar o modelo da maquina antes de mexer na interface.

Entregas:

- tipos puros para prioridade operacional, motivo, estado de trabalho e recomendacao;
- funcao unica que transforma o Radar em `CommercialQueue` explicavel;
- contrato de SLA por estagio/prioridade;
- contrato de bloqueios: supressao, falta de decisor, falta de canal, contexto insuficiente, oportunidade sem owner;
- fixtures e testes de regressao sobre o dataset atual.

Aceite: nenhuma UI, nenhum envio, nenhuma migration; apenas dominio puro + testes.

### CM1 — Work Queue / Hoje 2.0 — DONE

> Entregue em seis blocos (tabela de estado acima):
> - CM1-A: `construirCommercialQueue` com 8 categorias (acrescentado `AGENDADO`), `foraDaFila`, travas separadas,
>   pendências secundárias e ordenação por chaves em sequência, sem score próprio;
> - CM1-B: `planoDeAcaoCM` com modos CONTATO / ACAO_INTERNA / REVISAR / ENRIQUECER / AGUARDAR;
> - CM1-C: Hoje 2.0 apresentando fila + plano;
> - CM1-D1: sugestões do Radar pela fila; CM1-D2: `IntencaoComunicacaoCM` validada pelo Server Truth (`409 context_changed`);
> - CM1-E: documentação consolidada em `docs/commercial-machine.md`.
> O desenho abaixo é o plano original, mantido como histórico.

Objetivo: transformar `Hoje` em cockpit operacional.

Filas minimas:

- AGIR AGORA — tarefa vencida, resposta recebida, sinal quente, oportunidade parada;
- PROSPECTAR — conta prioritaria sem primeira tentativa valida;
- FOLLOW-UP — cadencia em andamento com proximo toque vencendo;
- ENRIQUECER — falta decisor/canal/dado obrigatorio;
- AVANCAR OPORTUNIDADE — oportunidade ativa sem movimento suficiente;
- REVISAR — rascunho, duplicata, entrega UNKNOWN, conflito de dado;
- NURTURE — conta relevante sem timing atual.

Cada item deve mostrar `por que agora`, proxima acao, prazo, conta, decisor, score, sinal principal e CTA operacional.
### CM2 — Cadence Engine v1 — CLOSED

> Documento canônico: `docs/commercial-machine-cm2.md` (contrato temporal, arquitetura por camada, invariantes, dívidas,
> versões e gate final). Entrada arquitetural: `docs/commercial-machine.md` §11. Paridade executável:
> `src/core/radar/commercialCadence.paridade.test.ts`.

Objetivo cumprido: disciplina temporal sem robotizar o vendedor. A cadência explica o momento e recomenda; a tarefa só
nasce por decisão humana, e a fronteira de escrita revalida tudo contra o Radar atual antes de deixá-la nascer.

Entregue:

- **CM2-A** — contrato temporal congelado e paridade com o CM1-A.1 (44 fixtures), dívidas legadas caracterizadas.
- **CM2-B** — `commercialCadence.ts`: estado temporal (`DEVIDA`, `AGUARDANDO`, `SUGERIR_PROXIMO_PASSO`, `PAUSADA`,
  `ENCERRADA`, `NAO_APLICAVEL`) separado do motivo (código da razão do CM1-A), próximo toque com natureza (`IMEDIATA`,
  `FIRME`, `BASE_CM1`, `RECOMENDADA`), retomada, tentativas e avisos. `VERSAO_REGRAS_CADENCIA_CM = 'CM2-B.1'`.
- **CM2-C** — `commercialCadenceTask.ts`: sugestão de compromisso só na lacuna D4, chave semântica do ciclo e cobertura
  por tarefa aberta compatível. Nada persistido, nenhum id.
- **CM2-D1** — Hoje apresenta cadência e sugestão em leitura pura, sem nenhum CTA novo.
- **CM2-E / E.1** — `commercialCadenceCommit.ts` + `actions.criarTarefaDaCadenciaCM`: expectativa → cobertura histórica
  → recálculo → comparação de contexto → edições humanas → segunda cobertura → autoriza/recusa, com
  `RegraCadenciaCommitError` (`codigo`, `tarefaId`, `pendencias`).
- **CM2-D2 / D2.1** — confirmação humana na Hoje: CTA só em `SUGERIDA`/`REQUER_RESPONSAVEL`, formulário governado
  (`TarefaCadenciaForm`), conflito tratado por código, responsável vazio bloqueado e CTA manual do CM1-C renomeado para
  "Criar tarefa manual".
- **CM2-F** — consolidação documental, sem código.

Decisões do CM2 (D1–D7, mantidas até o fim): CM2 é consumidor do CM1-A, sem número temporal novo e sem literal de
política no módulo de produção; resultado negativo sem fato novo é espera; data do cliente nunca é inventada;
`SUGERIR_PROXIMO_PASSO` só na lacuna, sem mudar a fila; dívidas de contagem caracterizadas e não corrigidas;
sequência B → C → D1 → E → D2; sem `cadence_key` no banco.

Não usou `radar_strategy` como política nem ativou `radar_experiment` (propostas para o CM4 em
`docs/propostas/commercial-machine/`). Dívida aberta principal: **D-E1 — unicidade transacional cross-client**.

### LEAD ENGINE 1.0 — NEXT (não iniciado)

Alimentar continuamente o Radar com empresas, decisores e sinais de timing, sem criar base paralela. As fundações já
existem (adapters CNO/PNCP/CNPJ/notícias, ingestão normalizada, deduplicação, lineage, Vibe, sinais, importação CSV), por
isso o primeiro bloco é **auditoria do estado real dessas fundações**, não integração nova. Fluxo pretendido: fontes →
descoberta → normalização → deduplicação → enriquecimento → decisor → sinais de timing → Radar → Máquina Comercial.
Detalhe em `docs/commercial-machine-cm2.md` §20.

### CM3 — Opportunity Control — NOT STARTED

Objetivo: impedir que oportunidade real se perca por falta de disciplina operacional.

Capacidades:

- aging por estagio;
- SLA por estagio;
- oportunidade sem proxima acao;
- oportunidade sem decisor/patrocinador;
- oportunidade sem ultimo contato recente;
- motivo explicavel de risco;
- recomendacao de proximo movimento;
- forecast operacional separado de desejo comercial.

### CM4 — Measurement & Learning — NOT STARTED

Objetivo: fechar o loop da maquina.

Indicadores minimos:

- contas trabalhadas / periodo;
- taxa de contato;
- taxa de resposta;
- taxa de resposta positiva;
- primeira conversa -> oportunidade;
- oportunidade -> proposta;
- proposta -> WON;
- tempo entre etapas;
- tarefas vencidas;
- distribuicao por canal/playbook/persona/origem do sinal;
- conversao por estrategia e experimento;
- perda por motivo;
- cobertura de pipeline versus meta.

Metricas devem ser derivadas de fatos registrados no Radar; nada de percentual digitado manualmente.

### CM5 — Assisted Execution — NOT STARTED

Objetivo: reduzir friccao para o vendedor mantendo controle humano.

Capacidades:

- preparar abordagem com IA a partir do Server Truth existente;
- sugerir canal/playbook/CTA;
- abrir artefato pronto para revisao;
- preparar envio no provider quando aplicavel;
- registrar automaticamente a tarefa seguinte depois do resultado humano;
- reconciliar entrega UNKNOWN antes de qualquer nova tentativa.

O canary de envio existente pode ser reutilizado; a v1 nao amplia allowlist nem habilita envio autonomo.

## 8. O que fica fora da v1

- discador automatico;
- envio massivo;
- sequencias autonomas sem aprovacao humana;
- SDR totalmente autonomo;
- negociacao automatica de preco, prazo ou condicao comercial;
- alteracao da Central;
- novo CRM paralelo ao Radar;
- scoring por modelo opaco sem explicacao;
- migration antes da integracao da Wave 03.

## 9. Primeiro corte implementavel (historico: cumprido pelo CM0 e superado pelo CM1-A)

A primeira entrega de codigo deve ser CM0 + nucleo de CM1:

1. `src/core/radar/commercialMachine.ts`
2. `src/core/radar/commercialMachine.test.ts`
3. fila pura e explicavel calculada sobre o dataset Radar existente;
4. categorias AGIR_AGORA / PROSPECTAR / FOLLOW_UP / ENRIQUECER / AVANCAR_OPORTUNIDADE / REVISAR / NURTURE;
5. razoes estruturadas, nao strings soltas;
6. ordenacao deterministica;
7. zero alteracao em Central, banco, providers ou envio.

Somente depois de esse motor estar provado a interface `Hoje` passa a consumir a nova fila.

## 10. Gate de merge desta frente

Antes de integrar qualquer bloco:

- diff nao toca caminhos exclusivos da Central;
- suite existente continua verde;
- testes novos provam ordenacao, bloqueios, idempotencia e explicabilidade;
- nenhuma migration numerada colide com o estado real do banco;
- nenhum efeito externo novo e liberado por default;
- qualquer alteracao em arquivo compartilhado tem justificativa explicita e diff minimo;
- documentacao do Radar descreve a capacidade realmente entregue, sem declarar automacao que ainda nao existe.

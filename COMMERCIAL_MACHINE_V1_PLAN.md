# EIFF Commercial Machine v1

Baseline: `main @ ab642be3c6cfb918241b6c8b637d485a05ce810e`

Branch exclusiva: `feature/commercial-machine-v1`

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

### CM0 — Contrato operacional e baseline

Objetivo: congelar o modelo da maquina antes de mexer na interface.

Entregas:

- tipos puros para prioridade operacional, motivo, estado de trabalho e recomendacao;
- funcao unica que transforma o Radar em `CommercialQueue` explicavel;
- contrato de SLA por estagio/prioridade;
- contrato de bloqueios: supressao, falta de decisor, falta de canal, contexto insuficiente, oportunidade sem owner;
- fixtures e testes de regressao sobre o dataset atual.

Aceite: nenhuma UI, nenhum envio, nenhuma migration; apenas dominio puro + testes.

### CM1 — Work Queue / Hoje 2.0

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

### CM2 — Cadence Engine v1

Objetivo: dar disciplina temporal sem robotizar o vendedor.

A cadencia gera tarefas/recomendacoes, nao envia mensagens.

Capacidades:

- cadencia por estrategia/persona/estagio;
- passos com atraso, canal preferido, objetivo e playbook;
- transicao por resultado da atividade;
- pausa por resposta, opt-out, oportunidade criada, LOST/WON ou bloqueio de dado;
- replanejamento quando surge sinal mais forte;
- limite de tentativas e cooldown por contato/empresa;
- prevencao de duas cadencias concorrentes para o mesmo objetivo.

Sempre reutilizar `radar_task`, `radar_activity`, `radar_strategy`, `radar_communication` e `radar_experiment` antes de propor entidade nova.

### CM3 — Opportunity Control

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

### CM4 — Measurement & Learning

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

### CM5 — Assisted Execution

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

## 9. Primeiro corte implementavel

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

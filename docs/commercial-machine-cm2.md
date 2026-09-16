# EIFF Commercial Machine — CM2: contrato temporal (cadência)

Estado: **CM2-A fechado** — contrato temporal e paridade com o CM1-A.1 congelados. **Nenhum Cadence Engine existe ainda**
(CM2-B não iniciado). Branch: `feature/commercial-machine-cm2` · baseline: `feature/commercial-machine-v1 @ a9ef237`
(CM1 fechado) · arquitetura do CM1: `docs/commercial-machine.md` · plano: `COMMERCIAL_MACHINE_V1_PLAN.md`.

Pergunta que o CM2 responde: **quem decide quando voltar a agir?**

O CM2 não é sequenciador de e-mail. É disciplina temporal comercial: explica o momento de cada conta e, só nas lacunas em
que nenhuma autoridade temporal falou, recomenda uma data. Não envia, não cria score, não reordena a fila, não cria
tarefa sozinho, não cria tabela nem histórico próprio.

Evidência executável deste contrato: `src/core/radar/commercialCadence.paridade.test.ts` (só caracterização; nenhum
código de produção).

---

## 1. Autoridade temporal

| Tipo de data | Quem decide | Onde mora | Natureza no CM2 |
|---|---|---|---|
| Compromisso humano ("ligar dia 25") | humano | `radar_task.venceEm`, `Oportunidade.proximaAcaoEm` (ativa) | `FIRME` |
| Espera depois de tentativa sem resposta | CM1-A | `RazaoCM.venceEm` de `FOLLOW_UP_EM_INTERVALO` (`HIPOTESE_COMMERCIAL_MACHINE.intervaloFollowUpDias`) | `BASE_CM1` |
| Urgência (resposta não tratada, vencido, sinal novo, parada) | CM1-A | razão principal da fila | `IMEDIATA` |
| Lacuna: silêncio depois de conversa tratada | CM2 (recomendação) | calculada, nunca gravada | `RECOMENDADA` |
| Canal, contato, objetivo, playbook | CM1-B | `CommercialActionPlan` | — (o CM2 não escolhe) |

Regras:

1. **D1 — fonte temporal única.** O CM2 é consumidor do CM1-A. Não cria intervalo de follow-up, limite de tentativas,
   SLA, janela de sinal nem regra de parada crítica. Quando precisa desses valores, importa
   `HIPOTESE_COMMERCIAL_MACHINE` / `sinalLeitura`. Nenhum literal temporal no módulo de produção (guarda no §9).
2. **Compromisso humano vence política genérica.** Mas fatos urgentes que o CM1-A já reconhece aparecem antes: resposta
   não tratada, tarefa vencida, sinal acionável novo, oportunidade parada (crítica). O CM2 não altera essa precedência e
   não move, cancela nem contradiz a data humana.
3. **Sinal novo fura intervalo** porque o CM1-A decide assim. O CM2 só reflete `DEVIDA` com o motivo do CM1-A; não
   existe regra paralela de "sinal forte o bastante".
4. **D2 — resultado negativo sem fato novo = espera.** Sem revisita automática por tempo nesta fase.
5. **D3 — data do cliente.** Com data estruturada (tarefa), ela é soberana. Sem data estruturada, o CM2 diz que falta a
   data (`PEDIR_DATA`). Nunca inventa 30 dias, 60 dias, "próximo mês" ou qualquer horizonte.
6. **Recomendação não é fila.** Nada que o CM2 calcule muda categoria, tier, urgência ou posição da Commercial Queue.
   O efeito operacional só existe quando o humano cria a tarefa (`radar_task`).

## 2. Estado temporal × motivo operacional

O CM2 **não duplica a taxonomia do CM1**. Cada recomendação terá:

- `estado` — temporal, taxonomia pequena (abaixo);
- `motivo` — o próprio `CodigoRazaoCM` da razão principal do CM1-A (sem renomear).

| Estado temporal | Significado |
|---|---|
| `DEVIDA` | agir já (ou a data firme é hoje / já passou) |
| `AGUARDANDO` | existe data futura que segura a conta (firme ou do CM1-A) |
| `SUGERIR_PROXIMO_PASSO` | lacuna: não há data e a regra D4 permite recomendar uma |
| `PAUSADA` | espera por fato novo, dado, ou decisão humana |
| `ENCERRADA` | ciclo terminou (esgotada, cliente ganho); só fato novo reabre |
| `NAO_APLICAVEL` | a razão principal não define tempo |

Mapa congelado (`CONTRATO_TEMPORAL` no teste; exaustivo sobre `CODIGOS_RAZAO_CM`):

| Motivo (razão principal CM1-A) | Estado | Retoma com |
|---|---|---|
| `RESPOSTA_NAO_TRATADA`, `TAREFA_VENCIDA`, `OPORTUNIDADE_ACAO_VENCIDA`, `SINAL_ACIONAVEL_NOVO`, `OPORTUNIDADE_PARADA_CRITICA`, `OPORTUNIDADE_PARADA`, `PROXIMA_ACAO_HOJE`, `COMUNICACAO_APROVADA_NAO_ENVIADA`, `FOLLOW_UP_SEM_RESPOSTA`, `TENTATIVA_CONTATO_INVALIDO`, `COMUNICACAO_PARA_REVISAO`, `CONTA_PRIORITARIA_NUNCA_ABORDADA` | `DEVIDA` | — |
| `PROXIMA_ACAO_AGENDADA`, `FOLLOW_UP_EM_INTERVALO` | `AGUARDANDO` | `DATA` |
| `OPORTUNIDADE_SEM_PROXIMA_ACAO` | `SUGERIR_PROXIMO_PASSO` | — |
| `SEM_TIMING_ATUAL` | `NAO_APLICAVEL` (vira `SUGERIR_PROXIMO_PASSO` só na lacuna D4) | — |
| `INCONSISTENCIA_PARA_REVISAR` | `NAO_APLICAVEL` | — |
| `TRAVA_PARA_RESOLVER` | `PAUSADA` | `DECISAO_HUMANA` |
| `SINAL_NAO_VERIFICADO`, `SEM_DECISOR`, `SEM_DECISOR_IDEAL_PARA_SINAL`, `SEM_CANAL_VALIDO` | `PAUSADA` | `DADO` |
| `RESULTADO_NEGATIVO_SEM_FATO_NOVO`, `OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO`, `OPORTUNIDADE_EM_NURTURE` | `PAUSADA` | `FATO_NOVO` |
| `TENTATIVAS_ESGOTADAS`, `CLIENTE_GANHO` | `ENCERRADA` | `FATO_NOVO` |

Nenhum estado temporal tem nome de razão do CM1-A (teste garante).

## 3. Natureza da data do próximo toque

| Natureza | Regra |
|---|---|
| `FIRME` | data de tarefa aberta ou `proximaAcaoEm` de oportunidade ativa; igual a uma data que o CM1-A já produziu (principal, ou secundária quando a principal não tem data) |
| `BASE_CM1` | só com `FOLLOW_UP_EM_INTERVALO`; igual ao `venceEm` da razão |
| `RECOMENDADA` | só em `SUGERIR_PROXIMO_PASSO`; exige âncora real; nunca antes de hoje |
| `IMEDIATA` | sem data |

`PAUSADA` e `ENCERRADA` não têm próximo toque. `PEDIR_DATA` nunca carrega data.

## 4. Lacuna D4 — `SUGERIR_PROXIMO_PASSO`

Só quando **todas** valem:

- houve interação acionável;
- ela já foi tratada;
- não existe tarefa futura;
- não existe próxima ação firme;
- não existe outra autoridade temporal acima;
- ficou um silêncio operacional.

Cálculo (sempre com hipótese importada do CM1-A):

- **com oportunidade ativa:** `em = max(hoje, último movimento + slaEstagioDias[estágio])` — limitada pelo SLA restante;
- **sem oportunidade ativa:** `em = max(hoje, âncora real + intervaloFollowUpDias)` — âncora = último movimento real da
  conversa (atividade ou conclusão da tarefa que a tratou).

A data é `RECOMENDADA`, nunca `FIRME`. Não muda a fila. **Sem âncora temporal confiável: não há data**; a recomendação
devolve decisão humana necessária.

## 5. Sugestões e avisos

| Sugestão | Quando |
|---|---|
| `NENHUMA` | a fila já traz a conta de volta sozinha, ou a ação é o próprio contato |
| `TRATAR_AGORA` | resposta acionável que pede tratamento (oportunidade, tarefa) |
| `PEDIR_DATA` | o compromisso depende de data do cliente (CALL_BACK, FUTURE_PROJECT, reunião) e ela não está estruturada |
| `RECOMENDAR_DATA` | lacuna D4 |
| `DECISAO_HUMANA` | trava, responsável ausente, horizonte guardado onde a fila não lê |

Avisos previstos (o CM2 aponta; nunca corrige sozinho):

| Aviso | Situação |
|---|---|
| `GATEKEEPER_NAO_CONTA_NO_LIMITE` | recepção entra no intervalo mas zera `semRespostaSeguidas` (C5) |
| `ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA` | reunião/visita sem código conta como sem resposta (C6) |
| `CONTAGEM_POR_EMPRESA` | contato novo herda intervalo e limite da conta |
| `TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO` | tarefa aberta criada antes de uma negativa continua mandando |
| `HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO` | `proximaAcaoEm` de oportunidade NURTURE não é lida pela fila (C7) |
| `COMPROMISSOS_CONCORRENTES` | mais de uma tarefa aberta cobrindo o mesmo toque |
| `CONTATO_DA_TAREFA_INELEGIVEL` | tarefa aponta para contato suprimido/inelegível |
| `CANAL_DA_TAREFA_INDISPONIVEL` | tarefa CALL/EMAIL com canal suprimido ou inválido — **não** troca a tarefa nem escolhe canal |
| `COMUNICACAO_PENDENTE_NO_MESMO_TOQUE` | rascunho em revisão enquanto o follow-up está devido |
| `RESPONSAVEL_NECESSARIO` | conta sem responsável: nunca escolher usuário automaticamente |
| `CONTATO_RECOMENDADO_SEM_CANAL` | recomendado sem canal existindo contato alternativo com canal (C13) |
| `CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA` | conta com oportunidade NURTURE/WON mas sem atividade vira prospecção (C14) |

## 6. Precedência validada (espelha o CM1-A; o CM2 lê, não reimplementa)

1. Supressão da empresa / fora da fila.
2. Travas bloqueantes (duplicata pendente, contato inelegível) — seguram toques de contato; compromissos seguem visíveis.
3. Resposta do cliente não tratada (sem expiração).
4. Compromisso vencido (tarefa ou ação da oportunidade).
5. Sinal acionável novo não tratado (fura intervalo, agenda e espera negativa).
6. Oportunidade parada crítica (fura agenda futura).
7. Compromisso humano de hoje ou futuro (segura toda cadência adiável).
8. Oportunidade ativa (SLA; sem próxima ação = avançar).
9. Resultado anterior (negativo/perda = espera; contato inválido = trocar).
10. Política de cadência (intervalo, limite).
11. Nutrição / sem timing.

"Compromisso humano" é a tarefa ou `proximaAcaoEm` — não existe outra entidade. Tarefa criada **antes** de uma resposta
não a segura; tarefa criada **depois** é o tratamento.

## 7. Fora da fila

`CommercialQueue.foraDaFila` não tem `CommercialQueueItem` nem `CommercialActionPlan`. **Conta fora da fila não tem
cadência operacional** no CM2 v1 (`cm2: null` nas fixtures). Uma projeção separada para explicar suprimida/inativa/
mesclada pode existir no futuro, fora do contrato principal.

## 8. Contrato de saída previsto (CM2-B)

```ts
interface CadenceRecommendationCM {
  itemId: string; empresaId: string;
  versaoCadencia: string;      // VERSAO_REGRAS_CADENCIA_CM — criada no CM2-B, sem repetir 'CM1-A.1' no nome
  versaoRegrasFila: string;    // VERSAO_REGRAS_CM
  versaoPlano: string;         // VERSAO_REGRAS_PLANO_CM
  estado: EstadoTemporal;
  motivo: CodigoRazaoCM;       // razão principal do CM1-A, sem renomear
  retomaCom?: 'DATA' | 'FATO_NOVO' | 'DECISAO_HUMANA' | 'DADO';
  proximoToque?: { natureza: 'FIRME' | 'BASE_CM1' | 'RECOMENDADA' | 'IMEDIATA'; em?: string; ancora?: ReferenciaCM };
  tentativa?: { semRespostaSeguidas: number; limite: number };   // exibição; limite importado
  sugestao: 'NENHUMA' | 'TRATAR_AGORA' | 'PEDIR_DATA' | 'RECOMENDAR_DATA' | 'DECISAO_HUMANA';
  avisos: AvisoCadenciaCM[];
  explicacao: { porQue: string; fatos: string[] };
}
```

Entrada: `CommercialQueueItem` + `CommercialActionPlan` + dataset + `hoje`. Nunca chama `recomendarAcao`, `filaHoje`,
`lerEmpresa` ou `recomendarCanal`. Nenhuma constante de produção foi criada no CM2-A.

## 9. Guarda de números temporais

O teste de paridade varre `src/core/radar/commercialCadence*.ts` (exceto testes) e falha se aparecer literal igual a um
valor de política (SLAs, intervalo, limite, janela de sinal novo, janelas de família, fallback, 180, 14) ou dependência
de autoridade legada/efeito (`recomendarAcao`, `filaHoje`, `lerEmpresa`, `recomendarCanal`, `data/`, supabase, `fetch`,
`canais`, `comunicacaoServidor`). Hoje nenhum arquivo existe; o autoteste prova que a guarda pega a violação. O
multiplicador 2 e o fit 40 não entram na lista (não são tempo e colidiriam com código comum).

## 10. Tarefa ↔ cadência e idempotência

- Chave conceitual: `cad:<versão>:<empresaId>:<contatoId|->:<oportunidadeId|->:<motivo>:<âncora.tipo>:<âncora.id>`.
  Não depende de `hoje`; a recomendação é determinística.
- **CM2-C:** cobertura semântica — tarefa existente por empresa, contato, oportunidade, tipo/natureza, estado aberto e
  relação temporal com a âncora. Havendo cobertura, não há sugestão nova.
- **CM2-E:** proteção mínima no store contra criação concorrente/duplo clique (se o merge-tree com a Wave 03 continuar
  seguro).
- **Sem `cadence_key` no banco agora.** Coluna + índice único parcial ficam só em
  `docs/propostas/commercial-machine/radar-task-cadence-key.md`, sem migration numerada.
- Tarefa só nasce por decisão humana, pelo `TarefaForm` existente, com confirmação explícita (CM2-D2).

## 11. Paridade CM1-A.1 (resultado congelado em 15/09/2026, `hoje = 2026-09-15`)

Cada fixture guarda: categoria, código da razão principal, `venceEm`, contato, existência de agenda, secundárias
(`CÓDIGO:ESTADO@data`), travas, contagem sem resposta quando relevante, e a expectativa CM2 (estado, retomada, natureza e
data do próximo toque, sugestão, avisos).

| # | Caso | CM1-A.1 (categoria · razão · prazo) | Agenda | CM2 (estado · toque · sugestão) | Avisos |
|---|---|---|---|---|---|
| 01 | Nunca contatada (A) | PROSPECTAR · CONTA_PRIORITARIA_NUNCA_ABORDADA | não | DEVIDA · IMEDIATA · NENHUMA | — |
| 01b | Nunca contatada (C) | fora da fila · SEM_RELEVANCIA_ATUAL | — | sem cadência | — |
| 02 | 1º contato sem resposta | AGENDADO · FOLLOW_UP_EM_INTERVALO · 17/09 | não | AGUARDANDO · BASE_CM1 17/09 · NENHUMA | — |
| 03 | 2ª tentativa | FOLLOW_UP · FOLLOW_UP_SEM_RESPOSTA | não | DEVIDA · IMEDIATA · NENHUMA | — |
| 04 | 5ª tentativa | NURTURE · TENTATIVAS_ESGOTADAS (5 seguidas) | não | ENCERRADA · FATO_NOVO · NENHUMA | — |
| 04b | 4 tentativas | FOLLOW_UP · FOLLOW_UP_SEM_RESPOSTA (4) | não | DEVIDA · IMEDIATA | — |
| 05 | Positiva não tratada | AGIR_AGORA · RESPOSTA_NAO_TRATADA | não | DEVIDA · IMEDIATA · TRATAR_AGORA | — |
| 05b | Positiva tratada, silêncio | NURTURE · SEM_TIMING_ATUAL | não | SUGERIR_PROXIMO_PASSO · RECOMENDADA 15/09 (âncora 10/09 + intervalo) · RECOMENDAR_DATA | — |
| 06 | Negativa | NURTURE · RESULTADO_NEGATIVO_SEM_FATO_NOVO | não | PAUSADA · FATO_NOVO | — |
| 06b | Negativa + tarefa anterior | AGENDADO · PROXIMA_ACAO_AGENDADA · 20/09 (negativa ADIADA) | sim | AGUARDANDO · FIRME 20/09 | TAREFA_ANTERIOR_A_RESULTADO_NEGATIVO |
| 07 | Gatekeeper | AGENDADO · FOLLOW_UP_EM_INTERVALO · 17/09 (0 seguidas) | não | AGUARDANDO · BASE_CM1 17/09 | GATEKEEPER_NAO_CONTA_NO_LIMITE |
| 07b | 6 alternados | FOLLOW_UP · FOLLOW_UP_SEM_RESPOSTA (0 seguidas, nunca esgota) | não | DEVIDA · IMEDIATA | GATEKEEPER_NAO_CONTA_NO_LIMITE |
| 08 | Callback, data só nas notas | AGIR_AGORA · RESPOSTA_NAO_TRATADA | não | DEVIDA · IMEDIATA · PEDIR_DATA | — |
| 08b | Callback com tarefa 25/09 | AGENDADO · PROXIMA_ACAO_AGENDADA · 25/09 | sim | AGUARDANDO · FIRME 25/09 | — |
| 09 | Projeto futuro sem horizonte | AGIR_AGORA · RESPOSTA_NAO_TRATADA | não | DEVIDA · IMEDIATA · PEDIR_DATA | — |
| 09b | Horizonte em oportunidade NURTURE | NURTURE · OPORTUNIDADE_EM_NURTURE (sem prazo) | não | PAUSADA · FATO_NOVO · DECISAO_HUMANA | HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO |
| 10 | Pediu reunião | AGIR_AGORA · RESPOSTA_NAO_TRATADA (tarefa MEETING) | não | DEVIDA · IMEDIATA · PEDIR_DATA | — |
| 11 | Pediu orçamento | AGIR_AGORA · RESPOSTA_NAO_TRATADA | não | DEVIDA · IMEDIATA · TRATAR_AGORA | — |
| 12 | Telefone inválido | FOLLOW_UP · TENTATIVA_CONTATO_INVALIDO (mesmo contato, por e-mail) | não | DEVIDA · IMEDIATA | — |
| 12b | Tarefa CALL com telefone suprimido | AGENDADO · PROXIMA_ACAO_AGENDADA · 20/09 | sim | AGUARDANDO · FIRME 20/09 | CANAL_DA_TAREFA_INDISPONIVEL |
| 13 | E-mail devolvido | ENRIQUECER · SEM_CANAL_VALIDO (recomendado sem canal; alternativo com telefone ignorado) | não | PAUSADA · DADO | CONTATO_RECOMENDADO_SEM_CANAL |
| 14 | Troca de contato | NURTURE · TENTATIVAS_ESGOTADAS (contagem da empresa) | não | ENCERRADA · FATO_NOVO | CONTAGEM_POR_EMPRESA |
| 15 | Tarefa futura existente | AGENDADO · PROXIMA_ACAO_AGENDADA · 20/09 (follow-up ADIADO) | sim | AGUARDANDO · FIRME 20/09 | — |
| 16 | Duas tarefas abertas | AGENDADO · PROXIMA_ACAO_AGENDADA · 18/09 (+20/09 pendente) | sim | AGUARDANDO · FIRME 18/09 | COMPROMISSOS_CONCORRENTES |
| 17 | Oportunidade ativa com ação | AGENDADO · PROXIMA_ACAO_AGENDADA · 19/09 | sim | AGUARDANDO · FIRME 19/09 | — |
| 17b | Oportunidade sem próxima ação | AVANCAR_OPORTUNIDADE · OPORTUNIDADE_SEM_PROXIMA_ACAO | não | SUGERIR_PROXIMO_PASSO · RECOMENDADA 19/09 (12/09 + SLA ENGAGED) | — |
| 18 | Oportunidade parada | AVANCAR_OPORTUNIDADE · OPORTUNIDADE_PARADA (tarefa 20/09 pendente) | sim | DEVIDA · IMEDIATA | — |
| 18b | Parada crítica | AGIR_AGORA · OPORTUNIDADE_PARADA_CRITICA (tarefa 30/09 pendente) | sim | DEVIDA · IMEDIATA | — |
| 19 | Negociação | AGENDADO · PROXIMA_ACAO_AGENDADA · 16/09 | sim | AGUARDANDO · FIRME 16/09 | — |
| 20 | NURTURE | NURTURE · OPORTUNIDADE_EM_NURTURE (01/10 ignorado) | não | PAUSADA · FATO_NOVO · DECISAO_HUMANA | HORIZONTE_EM_OPORTUNIDADE_NURTURE_NAO_LIDO |
| 20b | NURTURE sem atividade | PROSPECTAR · CONTA_PRIORITARIA_NUNCA_ABORDADA | não | DEVIDA · IMEDIATA | CONTA_SEM_ATIVIDADE…, HORIZONTE… |
| 21 | LOST | NURTURE · OPORTUNIDADE_PERDIDA_SEM_FATO_NOVO | não | PAUSADA · FATO_NOVO | — |
| 21b | LOST + atividade posterior | AGENDADO · FOLLOW_UP_EM_INTERVALO · 17/09 | não | AGUARDANDO · BASE_CM1 17/09 | — |
| 22 | WON | NURTURE · CLIENTE_GANHO | não | ENCERRADA · FATO_NOVO | — |
| 22b | WON sem atividade | PROSPECTAR · CONTA_PRIORITARIA_NUNCA_ABORDADA | não | DEVIDA · IMEDIATA | CONTA_SEM_ATIVIDADE_TRATADA_COMO_NUNCA_ABORDADA |
| 23 | Sinal novo no intervalo | AGIR_AGORA · SINAL_ACIONAVEL_NOVO (intervalo 17/09 pendente) | não | DEVIDA · IMEDIATA | — |
| 23b | Sinal novo com tarefa futura anterior | AGIR_AGORA · SINAL_ACIONAVEL_NOVO (tarefa 20/09 pendente) | sim | DEVIDA · IMEDIATA | — |
| 23c | Sinal novo após negativa | AGIR_AGORA · SINAL_ACIONAVEL_NOVO | não | DEVIDA · IMEDIATA | — |
| 24 | Empresa suprimida (tarefa vencida) | fora da fila · EMPRESA_SUPRIMIDA | — | sem cadência | — |
| 25 | Contato suprimido | REVISAR · TRAVA_PARA_RESOLVER · 12/09 (TAREFA_VENCIDA bloqueada; contato → alternativo) | não | PAUSADA · DECISAO_HUMANA | CONTATO_DA_TAREFA_INELEGIVEL |
| 26 | Comunicação em revisão | FOLLOW_UP · FOLLOW_UP_SEM_RESPOSTA (revisão pendente) | não | DEVIDA · IMEDIATA | COMUNICACAO_PENDENTE_NO_MESMO_TOQUE |
| 27 | Comunicação aprovada | FOLLOW_UP · COMUNICACAO_APROVADA_NAO_ENVIADA (follow-up pendente) | não | DEVIDA · IMEDIATA | — |
| 28 | Conta sem responsável | REVISAR · INCONSISTENCIA_PARA_REVISAR (ação 25/09 pendente; responsável NENHUMA) | sim | NAO_APLICAVEL · FIRME 25/09 · DECISAO_HUMANA | RESPONSAVEL_NECESSARIO |
| C6 | Atividade sem resultado | FOLLOW_UP · FOLLOW_UP_SEM_RESPOSTA (1 seguida) | não | DEVIDA · IMEDIATA | ATIVIDADE_SEM_RESULTADO_CONTA_COMO_TENTATIVA |

## 12. Conflitos e dívidas congelados (não corrigidos no CM2)

Comportamento CM1-A.1. O CM2 não corrige; o CM4 poderá trazer evidência para recalibrar.

| # | Dívida | Evidência |
|---|---|---|
| C1 | Três regras de "quando voltar": CM1-A (intervalo) × pipeline (imediato após NO_RESPONSE/GATEKEEPER) × pipeline (≥ 14 dias) | legado documentado no CM1 |
| C2 | Pipeline nunca esgota tentativas | legado |
| C3 | `recomendarAcao` mostra ação planejada mesmo vencida | legado |
| C4 | "Vencido" calculado em quatro lugares (CM1-A, pipeline, `lerEmpresa`, badge do `App.tsx`) | dívida do CM1 |
| C5 | GATEKEEPER entra no intervalo mas zera `semRespostaSeguidas` → nunca esgota | casos 07, 07b |
| C6 | Atividade sem resultado conta como tentativa sem resposta | caso C6 |
| C7 | `proximaAcaoEm` de oportunidade NURTURE é gravada e nunca lida pela fila | casos 09b, 20 |
| C8 | Retomada assimétrica: negativa só com sinal; LOST com qualquer atividade | casos 06, 21b |
| C9 | "Resposta tratada" aceita qualquer tarefa criada depois, mesmo concluída na hora → silêncio | caso 05b |
| C10 | Empates de `ocorreuEm`: comparador de `historicoDe` × desempate do CM1-A | documentado; não caracterizado (ordem não especificada) |
| C11 | Tarefa CALL com telefone suprimido: o plano cai para o canal da política | caso 12b |
| C12 | Contagem por empresa: contato novo herda intervalo e limite | caso 14 |
| C13 | Recomendado sem canal permanece recomendado havendo contato alternativo com canal | caso 13 |
| C14 | Conta com oportunidade NURTURE/WON e nenhuma atividade vira "nunca abordada" | casos 20b, 22b |
| C15 | Oportunidade sem responsável gera inconsistência que passa na frente da agenda | caso 28 |
| C16 | Tarefas abertas não são canceladas quando a empresa é suprimida (badge legado ainda conta) | caso 24 |

## 13. Invariantes do CM2

1. O CM2 não altera categoria, tier, urgência, ordem ou posição da Commercial Queue.
2. O estado temporal deriva da razão principal do CM1-A; o motivo é o código do CM1-A, sem renomear.
3. Nenhum literal temporal de política no módulo de produção; valores vêm de `HIPOTESE_COMMERCIAL_MACHINE`/`sinalLeitura`.
4. Datas `FIRME` e `BASE_CM1` são sempre datas que o CM1-A já produziu.
5. Data `RECOMENDADA` só em `SUGERIR_PROXIMO_PASSO`, com âncora real, nunca antes de hoje.
6. Sem âncora confiável, sem data: decisão humana.
7. Data do cliente nunca é inventada.
8. Conta fora da fila não tem cadência operacional.
9. O CM2 não escolhe canal, contato, objetivo ou playbook; aviso quando a tarefa não é executável.
10. O CM2 não escolhe responsável.
11. O CM2 não cria tarefa, não envia, não grava histórico, não chama provider, Server Truth ou `/api/comunicacao`.
12. Recomendação determinística: mesma entrada e mesmo dia → mesma saída; a chave de idempotência não depende de `hoje`.
13. `radar_strategy` não é política de cadência neste ciclo; experimentos desligados até o CM4.

## 14. Plano CM2-B → CM2-F

| Bloco | Conteúdo | Pode tocar |
|---|---|---|
| **CM2-B** | Cadence Engine puro: `VERSAO_REGRAS_CADENCIA_CM`, `cadenciaDaContaCM(item, plano, ds, hoje)`, estado/motivo/retomada/próximo toque/tentativa/avisos/explicação; fixtures `cm2` desta paridade viram expectativa executável | `commercialCadence.ts` + teste; `index.ts` (export) |
| **CM2-C** | Sugestão de tarefa: chave semântica, cobertura/duplicidade, contato e canal da tarefa (só aviso), `RESPONSAVEL_NECESSARIO` | mesmo módulo ou `commercialCadenceTarefa.ts` + teste |
| **CM2-D1** | Hoje somente leitura: estado temporal, próximo toque, natureza da data, tentativa, avisos, sugestão. Sem atalho novo que crie tarefa; documentar se o fluxo manual existente é seguro | `Hoje.tsx` |
| **CM2-E** | Guarda governada/idempotente no store contra criação concorrente/duplo clique; auditoria com origem da cadência; sem migration | `store.ts` (diff mínimo, merge-tree com Wave 03 antes) |
| **CM2-D2** | Fluxo operacional "Agendar próxima ação" pelo `TarefaForm` existente: data pré-preenchida só quando `RECOMENDADA`, vazia quando depende do cliente, tudo editável, confirmação humana | `Hoje.tsx`, `comum.tsx` se necessário |
| **CM2-F** | Consolidação: docs, invariantes, dívidas, runbook, status | docs |

Cada bloco: GO explícito, um commit, gate completo (vitest, `tsc --noEmit`, eslint, build, guarda de caminhos, diff review).

## 15. O que o CM2 não faz

Não envia nem prepara envio; não amplia allowlists nem contorna guardas de provider; não cria sequência, `radar_sequence`,
`radar_cadence_event` ou entidade de tentativa; não cria score nem reordena a fila; não cria tarefa sem decisão humana;
não altera hipóteses do CM1-A; não usa estratégia como política nem ativa experimento; não cria migration.

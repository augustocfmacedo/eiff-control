# EIFF Commercial Machine — CM2: Cadence Engine v1 (documento canônico)

Estado: **CM2 CLOSED** (CM2-A, CM2-B, CM2-C, CM2-D1, CM2-E, CM2-E.1, CM2-D2, CM2-D2.1, CM2-F).
Branch: `feature/commercial-machine-cm2` · baseline: `feature/commercial-machine-v1 @ a9ef237` (CM1 congelado) ·
compatibilidade verificada contra `integracao-wave03 @ 9aeb640` · arquitetura geral: `docs/commercial-machine.md` ·
plano e roadmap: `COMMERCIAL_MACHINE_V1_PLAN.md`.

Pergunta que o CM2 responde: **quem decide quando voltar a agir?**

O CM2 não é sequenciador de e-mail. É disciplina temporal comercial: explica o momento de cada conta, recomenda uma data
só nas lacunas em que nenhuma autoridade temporal falou e, quando o humano decide agendar, revalida tudo contra o Radar
atual antes de deixar a tarefa nascer. Não envia, não cria score, não reordena a fila, não cria tarefa sozinho, não cria
tabela nem histórico próprio.

O produto funcional foi entregue até o CM2-D2.1; o CM2-F é consolidação documental e não mudou código de produção.

**Histórico canônico do CM2** (um bloco, um commit, gate completo em cada um):

| Bloco | Conteúdo | Commit |
|---|---|---|
| CM2-A | contrato temporal congelado + paridade CM1-A.1 (44 casos) + propostas sem migration | `2ec5da1eebbfd162b6f4cb372ac67e56ad40daca` |
| CM2-B | Cadence Engine puro (`commercialCadence.ts`, `VERSAO_REGRAS_CADENCIA_CM = 'CM2-B.1'`) | `d94313fb581708dac17cf5fb58a68bdd29ebe703` |
| CM2-C | sugestão governada de compromisso + chave semântica + cobertura (`commercialCadenceTask.ts`) | `113008311baa10d36d9ee6b1a4a56deaeaa5ab33` |
| CM2-D1 | cadência e sugestão na Hoje, somente leitura (zero CTA novo) | `7859c430b34b984cef4144477d6676e406d9cc8e` |
| CM2-E | fronteira de escrita governada (`commercialCadenceCommit.ts` + `actions.criarTarefaDaCadenciaCM`) | `b16bf49e6a73828d340b61b7843f0a286fcdcd37` |
| CM2-E.1 | recusa estruturada, `usuariosValidos` obrigatório, contato/canal com provas CALL/EMAIL | `d053b823481763a0c38fbc6b831a39826f948637` |
| CM2-D2 | ativação assistida na Hoje: CTA, formulário governado, conflitos por código | `33cd9a28d101382ae011be5f70a87726a13a5ba3` |
| CM2-D2.1 | responsável vazio deixa de ser "não editado"; CTA livre do CM1-C vira "Criar tarefa manual" | `7e4ebea276702c5e2ba0d7c7d0a49c72ccb6bc4d` |
| CM2-F | consolidação, invariantes, dívidas, gate e fechamento formal (só documentação) | este commit |

Módulos de produção do CM2: `src/core/radar/commercialCadence.ts`, `commercialCadenceTask.ts`,
`commercialCadenceCommit.ts`, `src/screens/radar/HojeCadencia.ts`, o formulário `TarefaCadenciaForm` em
`src/screens/radar/comum.tsx`, a apresentação em `src/screens/radar/Hoje.tsx` e a ação
`criarTarefaDaCadenciaCM` em `src/data/store.ts`. Nenhuma migration, nenhuma tabela, nenhuma coluna.

Evidência executável do contrato temporal: `src/core/radar/commercialCadence.paridade.test.ts` (caracterização do CM1-A.1,
com as fixtures compartilhadas em `cadenciaParidadeCM.fixtures.ts`).

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

> Entregue: esta taxonomia de intenção do CM2-A não virou campo do Cadence Engine. Ela reaparece como os estados do
> CM2-C (§13): `NAO_APLICAVEL`, `SUGERIDA`, `REQUER_DATA`, `REQUER_RESPONSAVEL`, `COBERTA` e `BLOQUEADA`.

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

## 8. Contrato de saída do Cadence Engine (CM2-B — entregue)

Previsto no CM2-A, implementado no CM2-B. O que foi construído difere do rascunho em dois pontos, ambos por simplificação
deliberada: o campo `sugestao` saiu do contrato (a decisão "isso vira compromisso?" ficou inteira no CM2-C, que é a
camada certa para ela) e `explicacao` ganhou `titulo` para a tela não ter de compor texto.

```ts
export interface CadenceRecommendationCM {
  itemId: string;
  empresaId: string;
  versaoCadencia: string;      // VERSAO_REGRAS_CADENCIA_CM = 'CM2-B.1'
  versaoRegrasFila: string;    // VERSAO_REGRAS_CM
  versaoPlano: string;         // VERSAO_REGRAS_PLANO_CM
  estado: EstadoCadenciaCM;    // DEVIDA | AGUARDANDO | SUGERIR_PROXIMO_PASSO | PAUSADA | ENCERRADA | NAO_APLICAVEL
  motivo: CodigoRazaoCM;       // razão principal do CM1-A, sem renomear
  retomaCom?: RetomadaCadenciaCM;                                // DATA | FATO_NOVO | DADO | DECISAO_HUMANA
  proximoToque?: ProximoToqueCM;                                 // { natureza, em?, origem, ancoraEm? }
  tentativa?: { semRespostaSeguidas: number; limite: number; doContato?: number };
  avisos: CodigoAvisoCadenciaCM[];
  explicacao: { titulo: string; porQue: string; fatos: string[] };
}
```

Entrada: `cadenciaDaContaCM(ds, item, plano, hoje)` — `CommercialQueueItem` + `CommercialActionPlan` + dataset + `hoje`.
Nunca chama `recomendarAcao`, `filaHoje`, `lerEmpresa` ou `recomendarCanal`, e nenhuma constante temporal de política
nasceu no módulo: tudo vem de `HIPOTESE_COMMERCIAL_MACHINE`/`sinalLeitura`.

## 9. Guarda de números temporais

O teste de paridade varre `src/core/radar/commercialCadence*.ts` (exceto testes) e falha se aparecer literal igual a um
valor de política (SLAs, intervalo, limite, janela de sinal novo, janelas de família, fallback, 180, 14) ou dependência
de autoridade legada/efeito (`recomendarAcao`, `filaHoje`, `lerEmpresa`, `recomendarCanal`, `data/`, supabase, `fetch`,
`canais`, `comunicacaoServidor`). A guarda nasceu antes dos módulos (com autoteste provando que ela pega a violação) e
hoje varre os três módulos de produção do CM2. O multiplicador 2 e o fit 40 não entram na lista (não são tempo e
colidiriam com código comum).

## 10. Tarefa ↔ cadência e idempotência

- **Chave do ciclo** (`chaveCadenciaCM`, CM2-C):
  `cad:<versaoCadencia>:<empresaId>:<contatoId|->:<oportunidadeId|->:<motivo>:<ancora.tipo>:<ancora.id>`.
  Não depende de `hoje` nem de data; a recomendação é determinística. Não é persistida.
- **CM2-C:** cobertura semântica — tarefa aberta por empresa, contato, oportunidade e tipo compatível
  (`TIPOS_QUE_COBREM_CM`), criada depois da âncora. Havendo cobertura, o estado é `COBERTA` e não há sugestão nova.
- **CM2-E:** a mesma cobertura roda de novo na escrita, **antes** do recálculo e de novo depois das edições humanas; é o
  que garante que duplo clique e repetição devolvam `JA_COBERTA` com o `tarefaId` exato, em vez de criar o segundo
  compromisso. Não é garantia distribuída (ver dívida D-E1 na §16).
- **Sem `cadence_key` no banco.** Coluna + índice único parcial continuam só como proposta em
  `docs/propostas/commercial-machine/radar-task-cadence-key.md`, sem migration numerada.
- Tarefa só nasce por decisão humana, no formulário governado `TarefaCadenciaForm` (CM2-D2), com confirmação explícita.
  O `TarefaForm` legado continua existindo para a tarefa manual livre ("Criar tarefa manual"), fora da cadência.

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
## 13. Arquitetura final: quem responde o quê

Cada camada responde a uma pergunta e só a ela. Nenhuma delas reimplementa a anterior.

### Radar — fonte de verdade

Empresa, Contato, Sinal, Oportunidade (+ histórico), Atividade, Tarefa, Comunicação, Supressão, duplicata, fonte,
estratégia, score e decision fit continuam sendo do Radar, nas tabelas `radar_*`. **O CM2 não criou um segundo CRM**: não
há entidade, tabela, coluna, migration, cache nem histórico paralelo. Tarefa criada pela cadência é `radar_task` comum.

### CM1-A — Commercial Queue (`commercialMachine.ts`, `VERSAO_REGRAS_CM = 'CM1-A.1'`)

*O que precisa ser feito agora?* Uma entrada por conta, com ação principal explicável, razões secundárias, travas e
`foraDaFila`. Categorias em escada e ordenação determinística. O CM2 **lê** esse resultado; nunca o reordena.

### CM1-B — Commercial Action Plan (`commercialActionPlan.ts`, `VERSAO_REGRAS_PLANO_CM = 'CM1-B.1'`)

*Como executar?* Modo (CONTATO, ACAO_INTERNA, REVISAR, ENRIQUECER, AGUARDAR), contato, objetivo, playbook e canal. O CM2
herda tipo de tarefa e contato daqui; não escolhe canal nem converte canal.

### CM2-B — Cadence Engine (`commercialCadence.ts`, `VERSAO_REGRAS_CADENCIA_CM = 'CM2-B.1'`)

*Quando essa conta volta?* Projeção pura sobre fila + plano + dataset + `hoje`.

- Estados: `DEVIDA`, `AGUARDANDO`, `SUGERIR_PROXIMO_PASSO`, `PAUSADA`, `ENCERRADA`, `NAO_APLICAVEL`.
- Naturezas do próximo toque: `IMEDIATA` (agora, sem data), `FIRME` (data de compromisso real), `BASE_CM1` (data que o
  CM1-A já produziu) e `RECOMENDADA` (só na lacuna D4, com âncora real e nunca antes de hoje).
- O motivo é sempre o código da razão principal do CM1-A (`CodigoRazaoCM`), sem taxonomia nova.
- `retomaCom` diz o que destrava a conta: `DATA`, `FATO_NOVO`, `DADO` ou `DECISAO_HUMANA`.
- API: `cadenciaDaContaCM(ds, item, plano, hoje)` e `cadenciasDaFilaCM(ds, fila, planos, hoje)`.

### CM2-C — Task Suggestion (`commercialCadenceTask.ts`)

*Essa recomendação precisa virar compromisso?* Nem tudo que está devido vira lembrete: o que é para fazer agora se faz
agora. Sugestão nasce só da lacuna D4 (próximo toque `RECOMENDADA` e datado).

- Estados: `SUGERIDA`, `COBERTA`, `REQUER_DATA`, `REQUER_RESPONSAVEL`, `BLOQUEADA`, `NAO_APLICAVEL`.
- Composição sem reinterpretar autoridade: data = CM2-B; tipo e contato = CM1-B; oportunidade e responsável = CM1-A.
- **Chave semântica do ciclo** (`chaveCadenciaCM`):
  `cad:<versaoCadencia>:<empresaId>:<contatoId|->:<oportunidadeId|->:<motivo>:<ancora.tipo>:<ancora.id>`.
  Não depende de `hoje` nem de data: identifica o *ciclo* (conta + interlocutor + negócio + motivo + fato que ancorou),
  para que a mesma recomendação seja reconhecida entre renders, sessões e recálculos. Não é persistida no banco.
- Cobertura: tarefa aberta compatível (`TIPOS_QUE_COBREM_CM`), criada depois da âncora, na mesma identidade →
  `COBERTA`, sem sugestão nova. `sugestoesTarefaDaFilaCM` não persiste nada e não prepara tarefa real (sem id).

### CM2-D1 — Hoje, somente leitura (`Hoje.tsx`)

A tela apresenta fila, plano, cadência, próximo toque com a natureza da data, tentativas, retomada, avisos, sugestão de
compromisso, pendências e cobertura — tudo já calculado. Nenhuma regra em React, nenhum dado inventado, nenhuma escrita.

### CM2-E — Write boundary (`commercialCadenceCommit.ts` + `actions.criarTarefaDaCadenciaCM`)

A UI nunca é autoridade. No momento de criar, a fronteira executa **sempre nesta ordem**:

```text
valida a expectativa recebida (versões, catálogos, datas, chave recalculada dos próprios campos)
  ↓
cobertura histórica do ciclo (tarefaQueCobreCicloCM) — ANTES de qualquer recálculo
  ↓
recalcula fila (CM1-A) → plano (CM1-B) → cadência (CM2-B) → sugestão (CM2-C) sobre o dataset ATUAL
  ↓
reencontra a recomendação pela chave e compara o contexto (item, empresa, tipo, oportunidade, contato, data recomendada)
  ↓
aplica e valida as edições humanas (data, descrição, responsável, contato + canal)
  ↓
segunda cobertura, agora com a identidade efetiva (contato escolhido pelo humano)
  ↓
autoriza (devolve a tarefa a criar) ou recusa com código
```

- **`JA_COBERTA`**: a cobertura histórica vem antes do recálculo de propósito. É o que faz o duplo clique — e a
  repetição depois que a fila já mudou — devolver "já existe compromisso" em vez de "o contexto mudou". A recusa carrega
  o `tarefaId` **exato** da tarefa que cobre o ciclo; a tela só abre aquela tarefa, nunca "alguma tarefa aberta da conta".
- **`CONTEXTO_MUDOU`**: reservado à mudança real — a chave não existe mais na recomendação recalculada, ou existe com
  item, empresa, tipo, oportunidade, contato ou data recomendada diferentes do que o humano viu.
- **Versões**: `versaoCadencia`, `versaoRegrasFila` e `versaoPlano` viajam na expectativa; divergência é
  `VERSAO_DIVERGENTE`, nunca "tenta assim mesmo".
- **Nenhum id antes do veredicto**: a tarefa só ganha id no store, depois do `ok`; a UI não gera id, nem `criadoEm`, nem
  status.
- **Erro estruturado** `RegraCadenciaCommitError` (`src/data/store.ts`): `codigo`, `tarefaId?`, `pendencias?` e
  `detalhe?`. A mensagem existe para o humano ler, não para o código interpretar.
- `usuariosValidos` é obrigatório na revalidação (o motor não conhece `Dataset.usuarios`), e contato + canal passam por
  `validarContatoCanalTarefaCadenciaCM` (`CONTATO_INVALIDO`, `CANAL_INDISPONIVEL`).

### CM2-D2 — Human confirmation (`HojeCadencia.ts` + `TarefaCadenciaForm` + `Hoje.tsx`)

- CTA só em `SUGERIDA` ("Agendar próxima ação") e `REQUER_RESPONSAVEL` ("Definir responsável e agendar"), sempre com
  rascunho de tarefa e permissão `radar`. O CTA livre do CM1-C chama-se **"Criar tarefa manual"** e continua sendo o
  caminho operacional antigo, pelo `TarefaForm` legado.
- No clique, a tela captura o snapshot com `expectativaDaSugestaoCM`; sem expectativa, falha fechada (não abre).
- Tipo e oportunidade são só leitura; data, descrição e responsável são editáveis; contato é editável **apenas** quando a
  sugestão não define um; prioridade não aparece (a ação grava `Normal`).
- Save chama exclusivamente `actions.criarTarefaDaCadenciaCM(expectativa, edicoes)`; nunca `salvarTarefaRadar`,
  `novaTarefaRadar` ou persistência direta, e nenhum id nasce na UI.
- A reação a recusa é por **código**, nunca por texto da mensagem. Erros corrigíveis mantêm o formulário aberto com a
  mensagem no campo; conflitos viram tela de conflito; `REQUER_DATA`/`BLOQUEADA` mostram as pendências sem corrigir nada.
- Única validação que mora na tela (`validarFormularioAgendamentoCM`): responsável vazio bloqueia antes da fronteira,
  porque vazio é decisão do humano e `undefined` significa "não editado" para o CM2-E.

## 14. Fluxo canônico

```text
RADAR
  ↓
Commercial Queue (CM1-A)
  ↓
Action Plan (CM1-B)
  ↓
Cadence Engine (CM2-B)
  ↓
Task Suggestion (CM2-C)
  ↓
HOJE
  ↓
humano escolhe "Agendar próxima ação"
  ↓
snapshot da expectativa
  ↓
formulário governado
  ↓
humano confirma
  ↓
CM2-E revalida sobre Radar atual
       ├─ JA_COBERTA
       ├─ CONTEXTO_MUDOU
       ├─ pendência/erro
       └─ autorizado
              ↓
          radar_task
              ↓
       Radar recalculado
              ↓
       fila/cadência mudam naturalmente
```

## 15. Invariantes do CM2

1. O CM2 não reordena a Commercial Queue (categoria, tier, urgência, ordem e posição continuam do CM1-A).
2. O CM2 não tem segundo score: nenhuma pontuação, peso ou classe própria.
3. O CM2 não cria um segundo CRM: nenhuma entidade, tabela, coluna, migration ou histórico paralelo.
4. O CM2 não envia comunicação nem prepara envio; não toca provider, allowlist, ledger ou Server Truth.
5. O CM2 não movimenta oportunidade, estágio, score ou supressão automaticamente.
6. O CM2 não cria tarefa sem decisão humana explícita.
7. Data `FIRME` vence recomendação genérica: compromisso real manda.
8. Data `RECOMENDADA` não é compromisso — a tela diz isso com todas as letras.
9. Data do cliente nunca é inventada: sem data estruturada, é decisão humana.
10. Contato nunca é trocado automaticamente por outro "melhor".
11. Canal nunca é convertido automaticamente (CALL não vira EMAIL).
12. Responsável nunca cai no usuário logado como fallback, em nenhuma camada.
13. A expectativa vinda da UI nunca é autoridade para persistir: é declaração do que o humano viu.
14. O store revalida sobre o dataset atual, não sobre o que a tela tinha em memória.
15. Sugestão velha não é gravada silenciosamente: ou é reconhecida, ou é recusada com código.
16. Ciclo já coberto devolve `JA_COBERTA` com o `tarefaId` exato.
17. Mudança real de contexto devolve `CONTEXTO_MUDOU`, sem reaplicar e sem retry automático.
18. A UI reage por código de recusa, nunca por parsing de mensagem.
19. Tipo e oportunidade governados não são editáveis na confirmação.
20. Todo efeito externo permanece humano.

Invariantes do contrato temporal (CM2-A) que continuam valendo: o estado temporal deriva da razão principal do CM1-A;
nenhum literal temporal de política nos módulos de produção (tudo vem de `HIPOTESE_COMMERCIAL_MACHINE`/`sinalLeitura`);
`RECOMENDADA` só em `SUGERIR_PROXIMO_PASSO`, com âncora real; conta fora da fila não tem cadência; recomendação
determinística e chave independente de `hoje`; `radar_strategy` não é política de cadência e experimentos ficam para o CM4.

## 16. Dívidas abertas do CM2

| # | Dívida | Situação |
|---|---|---|
| D-E1 | **Unicidade transacional cross-client.** Sem índice único, RPC transacional ou chave de idempotência persistida, duas sessões ou dispositivos realmente concorrentes ainda podem criar compromissos equivalentes antes de sincronizar. O CM2-E protege duplo clique, repetição sequencial, estado local velho e dado já sincronizado — **não** é garantia distribuída. Proposta (coluna + índice único parcial) em `docs/propostas/commercial-machine/radar-task-cadence-key.md`, sem migration numerada. | aberta |
| D-C3 | **Âncora por dia.** Onde compara âncora e criação de tarefa, a comparação é em granularidade de dia (`YYYY-MM-DD`); dois eventos no mesmo dia são indistinguíveis para a cobertura. | aberta |
| D-C4 | **Data humana ausente.** `CALL_BACK`, `FUTURE_PROJECT` e reunião pedida sem data estruturada continuam exigindo decisão humana (`REQUER_DATA`); o sistema não inventa horizonte. | aberta por decisão (D3) |
| D-C2 | **Ramos defensivos.** `COBERTA`/`BLOQUEADA` na sugestão e `REQUER_DATA`/`BLOQUEADA` na fronteira são inalcançáveis com dado coerente; CALL/EMAIL estão provados no CM2-E.1, mas a lacuna D4 atual normalmente produz `FOLLOW_UP`. São defesas de domínio, não fluxo corrente — e nunca foram simuladas com dado falso na UI. | aberta como defesa |
| C1–C16 | Divergências legadas do CM1-A.1 caracterizadas no CM2-A (§12), preservadas como dívida histórica. O CM2 não as corrige; o CM4 poderá trazer evidência para recalibrar. | congeladas |

## 17. Dívidas fechadas (não listar mais como abertas)

| Dívida | Fechada em |
|---|---|
| D-C1 — sugestão sem contato ("contato a definir") | CM2-D1 mostra "a definir no agendamento" e o CM2-D2 deixa o humano escolher entre os contatos da conta (`7859c43`, `33cd9a2`) |
| Recusa estruturada perdida no store (a tela teria de ler texto) | `RegraCadenciaCommitError` com `codigo`/`tarefaId`/`pendencias` (`d053b82`) |
| `usuariosValidos` opcional na revalidação | obrigatório no tipo, quebra em TypeScript se esquecido (`d053b82`) |
| Contato/canal sem prova real CALL/EMAIL | `validarContatoCanalTarefaCadenciaCM` com provas por canal (`d053b82`) |
| D-D2.1 — responsável limpo pelo humano virava "não editado" | guarda `validarFormularioAgendamentoCM` antes da fronteira (`7e4ebea`) |
| Colisão visual de dois "Agendar próxima ação" na Hoje | CTA livre do CM1-C renomeado para "Criar tarefa manual" (`7e4ebea`) |

## 18. Versões em vigor

```text
VERSAO_REGRAS_CM          = CM1-A.1   (fila; commercialMachine.ts)
VERSAO_REGRAS_PLANO_CM    = CM1-B.1   (plano; commercialActionPlan.ts)
VERSAO_REGRAS_CADENCIA_CM = CM2-B.1   (cadência; commercialCadence.ts)
```

O CM2-F não criou versão nova: documentação não muda regra. As três versões viajam na expectativa e são conferidas pela
fronteira a cada criação.

## 19. Gate final (execução real no fechamento, worktree `commercial-machine-cm2`)

| Verificação | Resultado |
|---|---|
| `npx vitest run` dos blocos CM2 (paridade, cadência, sugestão, fronteira, store, Hoje) | 6 arquivos · 296 testes · verde |
| `npm test` (suíte completa) | 83 arquivos · 1113 testes + 8 todo · verde |
| `npx tsc --noEmit` | limpo |
| `npm run lint` (`eslint src`) | limpo |
| `npm run build` | ok (aviso de chunk > 500 kB é pré-existente do projeto) |
| `git diff --check` | limpo |
| path guard | só documentação neste commit |
| `git merge-tree --write-tree HEAD origin/integracao-wave03` | exit 0, sem conflito |
| CI | **Nenhum status de CI publicado para este SHA.** O workflow `EIFF Quality Gate` (`.github/workflows/quality-gate.yml`) só dispara em `pull_request`/`push` para `main` ou por `workflow_dispatch`; a branch `feature/commercial-machine-cm2` não abre PR ainda, e esta sessão não tem `gh` autenticado para consultar. A evidência do gate é local, executada no worktree. |

Runbook do CM2 (comandos reais):

```bash
npx vitest run src/core/radar/commercialCadence.paridade.test.ts src/core/radar/commercialCadence.test.ts src/core/radar/commercialCadenceTask.test.ts src/core/radar/commercialCadenceCommit.test.ts src/data/radar.cadencia.store.test.ts src/screens/radar/HojeCadencia.test.ts
```

```bash
npm test
```

```bash
npm run build
```

## 20. Roadmap

```text
CM1 — CLOSED   (feature/commercial-machine-v1 @ a9ef237)
CM2 — CLOSED   (feature/commercial-machine-cm2, este commit)

NEXT:
LEAD ENGINE 1.0

Depois:
CM3 — Opportunity Control
CM4 — Measurement & Learning
CM5 — Assisted Execution
```

### Próxima Wave — Lead Engine 1.0 (não iniciada)

Objetivo: alimentar continuamente o Radar com empresas, decisores e sinais de timing **sem criar uma base paralela**.

O Radar já tem fundações para isso e a próxima Wave **não deve reconstruí-las**: `adapters.ts` (interface `AdapterFonte`
com adapters iniciais para CNO, PNCP, CNPJ/Receita, enriquecimento B2B e notícias), ingestão normalizada
(`ingerirRegistrosRadar`), deduplicação (CNPJ → domínio → nome+local → parecido), lineage (`radar_source_record`, jobs de
importação), Vibe/enriquecimento (`vibe.ts`, `vibeServidor.ts`, ledger `radar_vibe_operation`), sinais e leitura de sinal,
e importação CSV com dry run.

Por isso o primeiro bloco do Lead Engine é **auditoria do estado real dessas fundações**, não integração nova.

Fluxo pretendido:

```text
fontes
↓
descoberta de empresas
↓
normalização
↓
deduplicação
↓
enriquecimento
↓
decisor
↓
sinais de timing
↓
Radar
↓
Máquina Comercial
```

Nada disso foi implementado no CM2-F.

## 21. O que o CM2 não faz

Não envia nem prepara envio; não amplia allowlists nem contorna guardas de provider; não cria sequência,
`radar_sequence`, `radar_cadence_event` ou entidade de tentativa; não cria score nem reordena a fila; não cria tarefa sem
decisão humana; não altera hipóteses do CM1-A; não usa estratégia como política nem ativa experimento; não cria migration.

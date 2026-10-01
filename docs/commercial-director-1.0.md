# EIFF Commercial Director 1.0 — arquitetura, autoridades e baseline (CD-0)

Estado em 30/09/2026:

- **CD-0 CLOSED**: arquitetura, fronteiras, matriz de autoridade, inventário e baseline (PR #26, `main @ 51322a5`).
- **CD-1 CLOSED** (PR #29, `main @ ce1e5ff`): snapshot comercial canônico, puro e somente leitura (§17). Sem rota,
  tela, API, migration ou LLM. **CD-1.1** (amostra mínima das taxas = 30, decisão CD-D4) mesclado (PR #34,
  `main @ 57b0af4`). **CD-1.2** (dono da conta, decisão CD-D5, migration 0064) na branch
  `feature/commercial-director-cd-d5` (§19.3).
- CD-2 a CD-10 não iniciados.
- Decisões **D-1, D-2 e D-6 fechadas** em 30/09/2026 (§16.2); **CD-D3, CD-D4 e CD-D5 fechadas** em 30/09/2026 (§19).
  CD-D4 implementada; CD-D5 em implementação; CD-D3 depois, em frente separada.

Documentos vizinhos: Máquina Comercial em `docs/commercial-machine.md` e `docs/commercial-machine-cm2.md` (plano e
histórico em `COMMERCIAL_MACHINE_V1_PLAN.md`), decisão de UX em `docs/commercial-ux-1.0-decisao.md`, Lead Engine em
`docs/lead-engine-1.0.md`, Inbox em `docs/eiff-inbox.md`.

Nome da frente: **Commercial Director (CD)**. Não confundir com CM3 (Opportunity Control), CM4 (Measurement &
Learning) e CM5 (Assisted Execution) do roadmap da Máquina Comercial, nem com o **Diretor Financeiro** (`#/diretor`,
`src/core/cfo.ts`).

---

## 1. Missão

O Commercial Director é uma **camada analítica executiva** sobre a Máquina Comercial. Ele responde, com fatos do Radar e
das autoridades existentes:

1. se a base de prospecção é suficiente para o que a EIFF quer vender;
2. onde estão os gargalos (base, decisores, atividade, funil, descoberta);
3. onde o time deve concentrar esforço — **apontando para a Commercial Queue**, nunca criando outra ordem;
4. qual a qualidade da base e da cobertura de decisores;
5. se a base está sendo trabalhada e se o trabalho está avançando;
6. o que falta de dado para responder com segurança.

Ele produz **diagnóstico e direção**. Não executa, não prioriza contas e não inventa dado. Quando o dado não sustenta
uma resposta, a resposta é `DADO_INSUFICIENTE` com o motivo — nunca uma taxa estimada.

## 2. Fronteiras

O Diretor **não é outra Máquina Comercial**:

- não tem score, peso, classe ou ordenação de contas própria;
- não reordena, filtra nem substitui a Commercial Queue (CM1-A);
- não escolhe ação, playbook ou canal por conta — isso é o Action Plan (CM1-B);
- não decide quando agir — isso é a cadência (CM2-B);
- não descobre nem promove contas — isso é o Lead Engine, e a promoção é humana;
- não escreve: nesta frente, até decisão explícita, toda recomendação tem `podeExecutar = false`;
- não consome crédito do Vibe, não envia mensagem e não toca o outbound do Inbox.

O que ele pode dizer, e como:

| Pode dizer | Desde que |
|---|---|
| "faltam contas deste perfil" | seja contagem por segmento sobre o Radar, com a base de cada contagem |
| "a cobertura de decisores é baixa" | venha de `relatorioCobertura`/`contatoElegivel`, sem inventar decisor |
| "estas contas merecem atenção" | as contas venham da Commercial Queue, **na ordem e com a razão dela** |
| "o funil está travando em X" | haja oportunidades e histórico de estágio suficientes; senão `DADO_INSUFICIENTE` |
| "precisamos de N contas a mais" | exista meta e conversão observada; hoje não existem (§9) |

## 3. Matriz de autoridade

| Pergunta | Autoridade única | Onde | O Diretor |
|---|---|---|---|
| Quais são os dados comerciais? | Radar | `RadarDataset` (`src/core/radar/types.ts:408`), tabelas `radar_*` | lê |
| Qual conta vem antes? | Commercial Queue (CM1-A) | `construirCommercialQueue` (`commercialMachine.ts:314`) | cita posição e razão; nunca reordena |
| Como executar a conta? | Action Plan (CM1-B) | `planoDeAcaoCM`/`planosDaFilaCM` (`commercialActionPlan.ts:270`, `:373`) | agrega por modo (`resumoPorModoCM`) |
| Quando agir de novo? | Cadence (CM2-B) | `cadenciasDaFilaCM` (`commercialCadence.ts:173`) | agrega por estado e `retomaCom` |
| Precisa virar tarefa? | Task Suggestion (CM2-C) + Write Guard (CM2-E) | `sugestoesTarefaDaFilaCM`, `actions.criarTarefaDaCadenciaCM` | conta pendências; não cria tarefa |
| O que entrou de novo? | Lead Engine | `filaDeRevisao`, `metricasPiloto` (`leadEngineRevisao.ts:162`) | mede descoberta e promoção |
| O que foi conversado? | Inbox (contexto) | `InboxThread`, `metricasShadow` (`observabilidade.ts:83`) | lê contagens, nunca corpo de mensagem |
| Diagnóstico e direção | **Commercial Director** | (CD-1+) | é a autoridade só disto |

Regras de coerência:

- **Uma definição por métrica.** Se a Máquina Comercial já calcula algo, o Diretor usa a mesma função. Exemplo:
  "contas para agir agora" = `CommercialQueue.porCategoria.AGIR_AGORA`, o mesmo número de `contadorRadarHojeCM`
  (`src/core/sugestoes.ts:17`) e da Hoje.
- **O legado não é autoridade.** `resumoRadar` (`pipeline.ts:168`) e `filaHoje` são anteriores à cadeia CM; o próprio
  `docs/commercial-machine.md` §10 registra a dívida #7 ("Leads prioritários" pode contradizer a Hoje). Onde o
  legado diverge da cadeia CM, vale a cadeia CM. Divergência concreta: `pipelinePonderado` do legado usa
  `probabilidade ?? PROBABILIDADE_ESTAGIO` (`padroes.ts:169`); o `valorPonderado` do CM1-A usa `probabilidade ?? 0`
  (`commercialMachine.ts:553`). O Diretor não pode publicar os dois.
- **A UI nunca decide** (invariante 19 do CM1): a tela do Diretor projeta o snapshot; nenhum número é recalculado nela.
- **Sem indicador sintético** (`docs/commercial-ux-1.0-decisao.md:20-21`): nada de "nota de saúde comercial" única.
  Cada bloco mostra medidas com base e fonte; o diagnóstico é texto derivado de regras, não um índice.

## 4. Fontes de dados

Tudo abaixo já existe e é lido pelo app. O Diretor não precisa de persistência nova para o CD-1 a CD-3.

| Coleção | Tabela | Natureza | Campos úteis ao Diretor |
|---|---|---|---|
| `empresas` | `radar_company` | mutável | `ativo`, `mescladaEm`, `setor` (texto livre), `cnae`, `cidade`/`uf`, faixas de porte, `priorityClass`, `ultimoContatoEm`, `proximaAcaoEm`, `criadoEm`, `fonteId` |
| `contatos` | `radar_contact` | mutável | `decisor`, `persona`, `decisionFitScore`, `isPrimario`, `qualidade`, `statusEmail`/`statusTelefone`, `situacao`, `criadoEm` |
| `oportunidades` | `radar_opportunity` | mutável | `estagio` (15), `valorEstimado`, `probabilidade`, `responsavelId`, `proximaAcaoEm`, `criadoEm`, `fechadoEm`, `motivoFechamento` |
| `historicoEstagios` | `radar_opportunity_stage_history` | insert-only | `de`, `para`, `em`, `usuarioId` — tempo no estágio e alcance de etapa |
| `atividades` | `radar_activity` | insert-only | `tipo` (NOTE não é toque), `canal`, `resultado` (22 códigos), `ocorreuEm`, `usuarioId` |
| `tarefas` | `radar_task` | mutável | `tipo`, `status`, `venceEm`, `responsavelId`, `criadoEm`, `concluidaEm` |
| `comunicacoes` | `radar_communication` | mutável | `estado`, `canal`, `objetivo`, `playbook`, `aprovadoEm`, `rejeitadoEm`, `enviadaEm`, `respondidaEm` |
| `tiposResposta` | `radar_response_type` | configuração | `codigo`, `sentimento` |
| `sinais` | `radar_signal` | insert-only | `tipo`, `eventoEm`, `detectadoEm`, `confianca`, `verificado` |
| `projetos` | `radar_project` | mutável | `tipo`, `uf`, `areaM2`, `valorEstimado`, `estagio` |
| `supressoes` | `radar_suppression` | insert-only | `tipo` (do_not_contact, email_bounced, invalid_phone, opt_out) |
| `duplicatas` | `radar_possible_duplicate` | mutável | `status`, `criadoEm`, `resolvidoEm` |
| `registrosFonte` | `radar_source_record` | evidência imutável | `statusIntake`, `recebidoEm`, `decididoEm`, `entidadeId`, `contextoCno` (via adapter) |
| `snapshotsScore` | `radar_score_snapshot` | insert-only | série histórica de classe por empresa |
| `experimentos`, `estrategias` | `radar_experiment`, `radar_strategy` | mutável | cobertura por estratégia (sem alvo) |
| `operacoesVibe` | `radar_vibe_operation` | somente leitura | créditos (`economiaInteligencia`) |
| Inbox | `inbox_thread`, `inbox_message`, `inbox_thread_event`… | RLS por setor | `contexto`, `status`, `classificacao.intencao`, `roteamento`, `sla`, datas |

Projeções já calculadas que o Diretor reaproveita, sem reimplementar:

- **Cadeia CM:** `CommercialQueue.porCategoria` e `foraDaFila`; `resumoPorModoCM`; estados de cadência; estados de
  sugestão de tarefa.
- **UX comercial:** `resumoComercialUX` (zonas AGORA/AGUARDANDO/PROGRAMADAS/EM RISCO, `comercialVisao.ts:179`),
  `resumoEsperaUX`, `entradaComercialUX` (`comercialEntrada.ts:112`), `pipelineAtivoUX` (`comercialPipeline.ts:99`).
  Estas estão em `src/screens/radar/`; o Diretor deve consumi-las a partir do core (ver §15, CD-1).
- **Cobertura:** `relatorioCobertura`, `coberturaEmpresa`, `metricasEmail` (`cobertura.ts:58`, `:17`, `:47`);
  `contatoElegivel`, `temCanal`, `calcularQualidadeContato` (`contatos.ts`).
- **Setor:** `classificarSetor` (`fitCalibracao.ts:105`), com confiança HIGH/MEDIUM/LOW; LOW nunca conta como setor.
- **Lead Engine:** `filaDeRevisao`, `metricasPiloto`, `contadoresRevisao`.
- **Crédito:** `economiaInteligencia` (`economia.ts:20`).
- **Inbox:** `metricasShadow`, `ultimasDecisoes`, `estadoSla`.

### 4.1 Baseline de produção — 30/09/2026

Contagens agregadas, consulta somente leitura, sem nenhum dado pessoal:

| Medida | Valor |
|---|---|
| empresas (todas ativas, nenhuma mesclada) | 91 |
| contatos | 17 |
| contatos decisores | 8 |
| empresas com ao menos um decisor | 8 (8,8% das 91) |
| oportunidades | **0** |
| registros de mudança de estágio | **0** |
| atividades | 2, ambas NOTE: **0 toques comerciais** |
| tarefas | 1, aberta e vencida |
| comunicações | 1 APPROVED, 2 REJECTED, 0 enviadas |
| sinais | 2 |
| supressões | 0 |
| duplicatas | 1 pendente |
| candidatos do Lead Engine | 115 PENDING, 0 promovidos (e 108 registros legados) |
| experimentos | 0 |
| operações Vibe | 0 |
| threads do Inbox | 1 EXTERNAL (a thread de teste do shadow mode) |

Leitura: hoje o Diretor já pode falar com segurança de **base, cobertura de decisores, qualidade e descoberta**. Não
pode falar de **funil, conversão, ticket, velocidade nem gap**: não há oportunidade, histórico de estágio nem toque
registrado. Isso não é defeito do Diretor — é o estado real, e ele deve dizê-lo assim.

## 5. Métricas disponíveis hoje

Deriváveis por função pura sobre dados existentes. Cada uma deve sair com `base` (o denominador ou o universo) e
`fonte` (a função de autoridade).

**Base**
- contas no Radar, ativas, mescladas, inativas;
- contas na fila e fora dela, por motivo (`EMPRESA_MESCLADA`, `EMPRESA_INATIVA`, `EMPRESA_SUPRIMIDA`, `SEM_RELEVANCIA_ATUAL`);
- contas por categoria da fila (`AGIR_AGORA` … `AGENDADO`) e por classe (A+ … D);
- contas por segmento: setor canônico (só confiança HIGH/MEDIUM), UF, porte;
- candidatos do Lead Engine por status, sinal, município, área.

**Decisores e canal**
- contas com decisor elegível, com canal, sem contato, sem decisor;
- níveis de cobertura IDEAL / USABLE / NEEDS_BETTER / NO_CONTACT (`relatorioCobertura`);
- contatos inelegíveis (INVALIDO, SAIU_DA_EMPRESA, suprimidos).

**Atividade**
- contas nunca tocadas (sem atividade diferente de NOTE);
- último toque por conta (`ultimoContatoEm`) e contas sem toque há N dias;
- tarefas abertas, vencidas, concluídas por período;
- comunicações por estado (em revisão, aprovadas não enviadas, rejeitadas);
- estados de cadência e o que espera cliente, fato novo, dado ou decisão humana (`resumoEsperaUX`).

**Funil** (fórmulas prontas; hoje a base é zero)
- oportunidades por estágio, valor bruto e ponderado (definição do CM1-A);
- tempo no estágio atual, a partir do último registro de `historicoEstagios`;
- oportunidades paradas e em risco, pelas razões do CM1-A e pelas hipóteses de SLA (`HIPOTESE_COMMERCIAL_MACHINE`);
- alcançou PROJECT_RECEIVED / PROPOSAL_SENT / WON / LOST por período, pelo histórico;
- oportunidades sem próxima ação.

**Prospecção**
- descobertos, novos no período, pendentes, promovidos, rejeitados (`metricasPiloto`);
- contas adicionadas ao Radar e sinais novos no período (`entradaComercialUX`);
- decisores adicionados no período (`contatos.criadoEm`);
- créditos consumidos (`economiaInteligencia`).

**Qualidade**
- duplicatas pendentes; supressões por tipo;
- contas com setor LOW (pedem revisão), sem CNPJ ou business_id, sem cidade/UF;
- sinais não verificados.

### 5.1 Contrato proposto (CD-1)

Os nomes seguem a convenção da cadeia CM: tipos em inglês (`CommercialQueue`, `CommercialActionPlan`), funções em
português com sufixo (`construirCommercialQueue`, `cadenciasDaFilaCM`). Nada disto está implementado.

```ts
/** Toda medida carrega o universo, a fonte e o motivo quando não pode ser calculada. */
type MedidaCD<T = number> =
  | { estado: 'OK'; valor: T; base: number; fonte: FonteCD; definicao: string }
  | { estado: 'DADO_INSUFICIENTE'; motivo: string; falta: string[]; base: number; fonte: FonteCD };

type FonteCD = 'RADAR' | 'CM1_A' | 'CM1_B' | 'CM2_B' | 'CM2_C' | 'COBERTURA' | 'LEAD_ENGINE' | 'INBOX';

interface CommercialDirectorSnapshot {
  versaoRegras: string;            // 'CD-1.2' desde a CD-D5; mudar corte ou definição sobe a versão
  hoje: string;                    // AAAA-MM-DD explícito; nunca o relógio da máquina
  geradoDe: { versaoFila: string; versaoPlano: string; versaoCadencia: string };
  base: CommercialBaseHealth;
  funil: CommercialFunnelHealth;
  prospeccao: CommercialProspectingHealth;
  gap: CommercialProspectingGap;
  inbox?: CommercialInboxContext;  // opcional; declara o recorte visível
}

interface CommercialBaseHealth {
  contasAtivas: MedidaCD; naFila: MedidaCD; foraDaFila: Record<MotivoForaDaFila, MedidaCD>;
  porCategoriaFila: Record<CategoriaCM, MedidaCD>;
  porSegmento: { setor: Record<string, MedidaCD>; uf: Record<string, MedidaCD>; porte: Record<string, MedidaCD> };
  decisores: { comDecisorElegivel: MedidaCD; comCanal: MedidaCD; semContato: MedidaCD; porNivelCobertura: Record<NivelCobertura, MedidaCD> };
  qualidade: { duplicatasPendentes: MedidaCD; supressoes: MedidaCD; contatosInelegiveis: MedidaCD; setorARevisar: MedidaCD };
}

interface CommercialFunnelHealth {
  trabalho: { nuncaTocadas: MedidaCD; semToqueHaDias: MedidaCD; tarefasVencidas: MedidaCD; comunicacoesParadas: MedidaCD; cadenciasPorEstado: Record<EstadoCadenciaCM, MedidaCD> };
  oportunidades: { porEstagio: Record<EstagioOportunidade, MedidaCD>; valorPonderado: MedidaCD; semProximaAcao: MedidaCD };
  avanco: { alcancouEtapa: Record<EstagioOportunidade, MedidaCD>; tempoNoEstagio: Record<EstagioOportunidade, MedidaCD> };
  desfecho: { ganhas: MedidaCD; perdidas: MedidaCD };
}

interface CommercialProspectingHealth {
  candidatos: { pendentes: MedidaCD; promovidos: MedidaCD; rejeitados: MedidaCD; novosNoPeriodo: MedidaCD };
  contasNovas: MedidaCD; decisoresNovos: MedidaCD; sinaisNovos: MedidaCD; creditosConsumidos: MedidaCD;
}

interface CommercialProspectingGap {
  estado: 'CALCULADO' | 'DADO_INSUFICIENTE';
  meta?: { valor: number; unidade: 'CONTAS' | 'OPORTUNIDADES' | 'PROPOSTAS' | 'RECEITA'; periodo: string; definidaPor: string; definidaEm: string };
  contasNecessarias?: MedidaCD; gap?: MedidaCD;
  falta: string[];                 // ex.: ['meta comercial', 'conversão conta → oportunidade com amostra mínima']
}

interface CommercialDiagnosis {
  codigo: CodigoDiagnosticoCD;     // catálogo fechado (§7, §8)
  escopo: EscopoCD;
  evidencias: EvidenciaCD[];       // ids de medidas do snapshot, com valor e base
  regra: string;                   // qual corte versionado disparou
}

interface CommercialBrief {
  versaoRegras: string; hoje: string;
  situacao: LinhaSituacaoCD[];     // uma por escopo, ordem fixa
  diagnosticos: CommercialDiagnosis[];
  recomendacoes: CommercialRecommendation[];
  ondeConcentrar: { porCategoriaFila: Record<CategoriaCM, number>; primeirasDaFila: ReferenciaContaCD[] };
  dadosInsuficientes: { medida: string; motivo: string; falta: string[] }[];
}

interface ReferenciaContaCD { empresaId: string; posicao: number; categoria: CategoriaCM; porQueAgora: string }
```

Funções propostas: `snapshotComercialCD(ds, hoje, opcoes)`, `diagnosticosCD(snapshot)`,
`recomendacoesCD(snapshot, diagnosticos, fila)`, `briefComercialCD(...)`. As projeções da UX comercial que hoje vivem
em `src/screens/radar/` (`resumoComercialUX`, `entradaComercialUX`) precisam ser lidas a partir do core, sem mover a
autoridade delas — decisão de implementação do CD-1.

## 6. Métricas indisponíveis — e que não devem ser inventadas

| Métrica | Por que não existe | O que seria preciso |
|---|---|---|
| Meta de contas, de pipeline ou de receita | nenhuma entidade de meta no código nem no banco | parâmetro humano versionado (§15, persistência futura) |
| Ticket médio | 0 oportunidades com valor | oportunidades reais com `valorEstimado` |
| Taxa de conversão entre etapas | 0 oportunidades, 0 histórico, 0 toques | amostra mínima por etapa (hipótese versionada) |
| Taxa de resposta | 0 toques e 0 comunicações enviadas; SENT/REPLIED bloqueados | envio registrado e respostas com `resultado` |
| Velocidade do funil | histórico de estágio vazio | registros em `radar_opportunity_stage_history` |
| Motivo de perda | `motivoFechamento` é texto livre, sem taxonomia | catálogo fechado de motivos (decisão do CM3/CM4) |
| Desempenho por vendedor ou equipe | não há responsável por conta nem equipe comercial no Radar | dono de conta e equipe (decisão de produto) |
| Região comercial | só cidade/UF; nenhuma taxonomia de região | catálogo de regiões, se o negócio quiser |
| Primeiro contato e tempo de resposta | não há campo; tempo de resposta não é armazenado | derivável do primeiro toque quando houver toques |
| Entregas de mensagem | o ledger de entrega é só servidor, fora do `RadarDataset` | projeção somente leitura, se necessário |
| Associar × criar na promoção | não gravado; `metricasPiloto` infere por data | gravar a decisão (dado já decidido no LE-2) |
| Vínculo conversa ↔ conta | `ContatoInbox.empresaRadarId` existe, mas nada o preenche | vínculo automático ou humano no Inbox |

Regra: se o denominador é zero ou menor que a amostra mínima, a medida sai `DADO_INSUFICIENTE` com o motivo e o que
falta. Percentual com base 1 ou 2 não é publicado como taxa.

## 7. Base Health

Pergunta: **a base é suficiente e utilizável?**

Blocos, todos com base e fonte:

1. **Tamanho e acionabilidade** — contas ativas, na fila, fora da fila por motivo; por categoria da fila.
2. **Aderência de perfil** — distribuição por setor canônico (HIGH/MEDIUM), UF e porte; contas com setor LOW à parte.
3. **Decisores** — contas com decisor elegível, com canal, sem contato; níveis de cobertura.
4. **Qualidade** — duplicatas, supressões, contatos inelegíveis, identidade fraca, setor a revisar.
5. **Entrada** — candidatos pendentes e contas novas no período.

Diagnósticos possíveis, por regra explícita (não por LLM):

- `COBERTURA_DECISOR_BAIXA` — fração de contas acionáveis com decisor elegível abaixo de um corte versionado
  (hipótese do CD, não do CM). Hoje: 8 de 91 contas têm algum contato marcado como decisor; a elegibilidade
  (`contatoElegivel`) pode reduzir esse número.
- `BASE_CONCENTRADA` — um segmento concentra a maior parte da base; o Diretor aponta onde faltam contas, sem calcular
  quantas (isso é o gap, §9).
- `QUALIDADE_PENDENTE` — duplicatas ou revisões de setor pendentes que distorcem as contagens.
- `DESCOBERTA_PARADA` — candidatos pendentes acima de um corte, sem promoção no período. Hoje: 115 pendentes, 0
  promovidos.

## 8. Funnel Health

Pergunta: **estamos trabalhando a base e ela está avançando?**

Blocos:

1. **Trabalho** — contas nunca tocadas, contas sem toque há N dias, tarefas vencidas, comunicações paradas em
   aprovação, cadências devidas.
2. **Oportunidades** — por estágio, valor, idade, sem próxima ação.
3. **Avanço** — alcances de etapa e tempo no estágio, pelo histórico.
4. **Travamento** — estágio com maior concentração de oportunidades paradas (razões do CM1-A e SLA das hipóteses).
5. **Desfecho** — ganho e perda, quando houver amostra.

Diagnósticos possíveis:

- `BASE_NAO_TRABALHADA` — contas acionáveis sem toque. Hoje: 91 de 91 sem toque comercial registrado.
- `FOLLOW_UP_ATRASADO` — tarefas comerciais vencidas (mesma definição de "vencido" da cadeia CM; a dívida C4 registra
  quatro cálculos de vencido — o Diretor usa o da cadência).
- `FUNIL_VAZIO` — nenhuma oportunidade aberta.
- `FUNIL_TRAVADO_EM(estagio)` — só com amostra mínima.

## 9. Prospecting Gap

Pergunta: **quantas contas precisamos adicionar, e de qual perfil?**

O cálculo defensável exige três coisas que **não existem hoje**:

1. uma **meta** (de oportunidades, propostas ou receita) definida por uma pessoa, com período;
2. **taxas observadas** de conversão por etapa, com amostra mínima;
3. **ticket** observado, se a meta for em valor.

Sem isso, o gap sai `DADO_INSUFICIENTE` e o Diretor diz exatamente o que falta. Não existe "taxa de mercado" nem
estimativa embutida.

Com meta e taxas, o cálculo é aritmético e explicável:

```
contas necessárias = meta de oportunidades ÷ (taxa conta → oportunidade observada)
gap = contas necessárias − contas acionáveis do perfil
```

O que o Diretor pode dizer hoje sem meta: **gap de cobertura**, não gap de volume — por exemplo, "das 91 contas, 83
não têm nenhum contato marcado como decisor". É um fato, não uma projeção.

A meta, quando existir, é **parâmetro humano versionado** (quem definiu, quando, para qual período), no mesmo
espírito das hipóteses versionadas da Máquina Comercial. Ela não pode morar em código.

## 10. Recomendações

Uma recomendação é um **objeto tipado**, gerado por regra explícita a partir de um diagnóstico. O LLM não cria
recomendação.

```ts
interface CommercialRecommendation {
  id: string;                         // determinístico: tipo + escopo + versão das regras
  tipo: TipoRecomendacaoCD;           // catálogo fechado
  titulo: string;                     // texto de catálogo, parametrizado só por números do snapshot
  diagnostico: CodigoDiagnosticoCD;   // o diagnóstico que a originou
  evidencias: EvidenciaCD[];          // medidas do snapshot que a sustentam (id, valor, base, fonte)
  impactoEsperado?: string;           // só quando há base; senão ausente, nunca estimado
  acaoSugerida: string;               // "o que fazer", nunca "fazer"
  escopo: EscopoCD;                   // BASE | DECISORES | ATIVIDADE | FUNIL | PROSPECCAO | QUALIDADE
  autoridadeOrigem: AutoridadeCD;     // RADAR | CM1_A | CM1_B | CM2_B | LEAD_ENGINE | INBOX
  contas?: ReferenciaContaCD[];       // quando cita contas: posição e razão da Commercial Queue
  dadosFaltantes: string[];           // o que impediria uma recomendação mais forte
  podeExecutar: false;                // literal nesta frente
}
```

Catálogo inicial proposto (`TipoRecomendacaoCD`):

- `AMPLIAR_COBERTURA_DECISORES` — buscar decisores nas contas acionáveis sem decisor (a busca é humana; o Vibe exige
  ordem explícita e operação reservada);
- `REVISAR_CANDIDATOS` — reduzir a fila de candidatos pendentes do Lead Engine (promoção humana);
- `INICIAR_TRABALHO_DA_BASE` — começar pelas contas `AGIR_AGORA` da Commercial Queue;
- `RESOLVER_FOLLOW_UPS` — tarefas comerciais vencidas;
- `DESTRAVAR_APROVACOES` — comunicações aprovadas ou em revisão paradas;
- `LIMPAR_QUALIDADE` — duplicatas, setor LOW, contatos inelegíveis;
- `AMPLIAR_BASE_NO_SEGMENTO` — segmento com poucas contas (sem número de gap enquanto não houver meta);
- `DEFINIR_META` — o gap não pode ser calculado sem meta;
- `REGISTRAR_ATIVIDADE` — o Diretor não enxerga trabalho que não é registrado.

Regras:

- **Contas citadas vêm da fila.** `ReferenciaContaCD` carrega `posicao` e `porQueAgora` da Commercial Queue. O Diretor
  nunca lista contas numa ordem sua. Pode limitar ("as 5 primeiras da fila em AGIR_AGORA"), nunca reordenar.
- **Sem segundo score.** Nenhuma recomendação tem peso, nota ou prioridade numérica. A ordem das recomendações no brief
  é a ordem fixa dos escopos (§11), não um ranking.
- **Sem efeito.** `podeExecutar = false` é literal no tipo. A primeira fase com execução (CD-8) usa as portas que já
  existem (`actions.criarTarefaDaCadenciaCM`, comunicação em READY_FOR_REVIEW), sempre com confirmação humana.

## 11. Commercial Brief

O brief é a **leitura executiva do snapshot**, em ordem fixa:

1. **Situação** — uma linha por escopo com a medida principal e a base ("91 contas · 8 com decisor · 0 oportunidades").
2. **Diagnósticos** — os códigos disparados, cada um com evidência.
3. **Recomendações** — as do catálogo, cada uma com o que falta para ficar mais forte.
4. **Onde concentrar** — referência à Commercial Queue (contagem por categoria e as primeiras contas da fila, na ordem
   dela), nunca uma lista própria.
5. **Dados insuficientes** — o que o Diretor não consegue responder e por quê.

Forma: determinística no CD-6 (texto de catálogo parametrizado por números do snapshot). Explicação em linguagem
natural só no CD-7, por LLM sobre **fatos tipados**, com fact gate (§14).

## 12. Integração futura com o SDR

Fluxo-alvo:

```text
Lead Engine → Radar → Commercial Director → Commercial Queue → SDR AI → Inbox → WhatsApp
                                                                                  ↓
Commercial Director ← Radar ← Inbox ← resposta ←─────────────────────────────────┘
```

Separação de papéis:

| Papel | Faz | Não faz |
|---|---|---|
| Commercial Director | analisa, diagnostica, recomenda | prioriza contas, executa, escreve |
| Commercial Queue | define a ordem e a razão | analisa a carteira como um todo |
| SDR AI (futuro) | executa a abordagem **governada**, conta a conta, na ordem da fila | escolhe contas, pula a fila, cria prioridade |
| Inbox | transporte, contexto e conversa | decide o que falar ou a quem |

O SDR, quando existir, é um consumidor do Action Plan e da cadência, e produz comunicação pela mesma cadeia de hoje
(Server Truth → ContentSpec → fact gate → juiz → READY_FOR_REVIEW → aprovação humana). O Diretor não chama o SDR: ele
mede o que o SDR fez.

## 13. Integração futura com o Inbox

Nesta frente o Inbox é **fonte de contexto somente leitura**:

- Pode entrar no snapshot: contagem de threads EXTERNAL por intenção comercial (`solicitar_orcamento`, `negociacao`,
  `lead`), status, SLA vencido, tempo até a primeira resposta.
- **Não entra**: corpo de mensagem, nome ou telefone de contato. O Diretor lê contagens.
- **Não existe caminho de envio no Inbox** (`FlagsInbox.outbound: false` literal em `src/core/inbox/ativacao.ts:20`;
  `provedorCanal` devolve sempre o MANUAL, `fronteiras.ts:61`). O Diretor não muda isso.
- **Vínculo com o Radar não existe na prática**: `ContatoInbox.empresaRadarId`/`contatoRadarId` existem no tipo
  (`tipos.ts:88-89`), mas nenhum código os preenche. Sem vínculo, "conversas por conta" é `DADO_INSUFICIENTE`.
- **Visibilidade**: o RLS do Inbox dá visão completa só a Administrador e Diretoria (`inbox_config`); os demais veem o
  próprio setor. O bloco Inbox do Diretor tem de dizer qual recorte está vendo.
- Hoje há 1 thread (a de teste do shadow mode) e as variáveis da Meta não estão configuradas: nenhuma mensagem real
  entra.

## 14. Segurança e prompt injection

Todo texto que vem de fora é **dado, nunca instrução**. Campos livres identificados no Radar e no Inbox:

- Radar: `razaoSocial`, `nomeFantasia`, `setor`, `observacoes`, `cargo`, `titulo`/`descricao` de sinal,
  `payload`/`raw_payload` (inclusive `leitura`), `notas` e `conteudoBruto` de atividade, `descricao` de tarefa,
  `motivoFechamento`, `motivo` de histórico, linhas brutas de importação, `payload` do `RegistroFonte` (envelope CNO,
  Vibe), texto gerado e editado de comunicação.
- Inbox: `texto` da mensagem, `nome`/`empresaNome` do contato, `classificacao.resumo`.

Regras do Diretor:

1. **CD-1 a CD-6 não usam LLM.** O snapshot, os diagnósticos e as recomendações são funções puras sobre campos
   tipados (datas, estados, contagens, códigos). Texto livre não entra em nenhuma regra.
2. **CD-7 (LLM explicativo)** recebe **somente o snapshot tipado** — medidas, códigos de diagnóstico, recomendações e
   referências da fila. Nunca `raw_payload`, notas, mensagens, nomes de pessoa ou contatos. O mesmo padrão de
   `CHAVES_PROIBIDAS` (`comunicacaoLlm.ts:16`) vale aqui.
3. **Fact gate do CD-7**, equivalente ao `validarGeracao` da comunicação (`comunicacaoGeracao.ts:205`):
   - todo número do texto existe no snapshot;
   - toda conta citada é uma referência da fila presente no snapshot;
   - nenhuma recomendação nova, nenhum diagnóstico novo, nenhuma taxa que o snapshot marcou como `DADO_INSUFICIENTE`;
   - nenhuma promessa de resultado.
   Falhou, o brief determinístico do CD-6 é o que aparece.
4. **Server Truth** se houver função no servidor: o cliente manda só a intenção ("gerar brief"); o servidor lê o banco
   com o JWT do usuário, monta o snapshot e valida (padrão de `comunicacaoServidor.ts`).
5. **LLM nunca escreve** (regra da EIFF Central, `docs/eiff-central.md`): nem recomendação, nem tarefa, nem
   comunicação.

## 15. Fases de autonomia

| Nível | O Diretor | Escrita | Fase |
|---|---|---|---|
| 0 · Observa | calcula o snapshot | nenhuma | CD-1 |
| 1 · Diagnostica | aplica regras de diagnóstico | nenhuma | CD-2 a CD-4 |
| 2 · Recomenda | produz recomendações tipadas e o brief | nenhuma (`podeExecutar = false`) | CD-5 a CD-7 |
| 3 · Prepara | propõe a ação por uma porta existente, com confirmação humana | só pelas portas atuais | CD-8 |
| 4 · Outbound governado | mede o SDR; envio pelo Inbox atrás de kill switch e allowlist | pelo servidor, com canário | CD-9 |
| 5 · SDR ativo | mede e ajusta; o SDR executa em volume | governado | CD-10 |

Cada salto de nível exige autorização explícita. O nível 3 em diante depende de decisões que não são deste documento
(outbound do Inbox, SDR).

**Persistência futura** (nenhuma agora):

- **meta comercial** versionada (período, valor, quem definiu) — pré-requisito do gap (CD-4);
- **snapshot histórico** do Diretor (série para tendência) — só se a tendência não puder ser recalculada dos fatos;
- **decisão do candidato** (associar × criar) — hoje inferida;
- **vínculo Inbox ↔ Radar** — preenchimento do `empresaRadarId`.

## 16. Roadmap

| Fase | Entrega | Critério de saída |
|---|---|---|
| **CD-0** | arquitetura, autoridades, inventário e baseline (este documento) | revisão humana |
| **CD-1** | `snapshotComercialCD(ds, hoje, opcoes)`: função pura, `hoje` explícito, versão `CD-1.x`; blocos base, decisores, atividade, funil, prospecção, qualidade; cada medida com base, fonte e `DADO_INSUFICIENTE` | testes de coerência: mesmos números da Commercial Queue, da cobertura e do Lead Engine; guarda "sem ordenação de contas" |
| **CD-2** | saúde da base: diagnósticos de base, decisores e qualidade | cortes como hipóteses versionadas, com teste |
| **CD-3** | diagnóstico de funil e atividade | amostra mínima respeitada; sem taxa com base insuficiente |
| **CD-4** | gap de prospecção | exige meta persistida por decisão humana; sem meta, `DADO_INSUFICIENTE` |
| **CD-5** | motor de recomendações: catálogo fechado, `podeExecutar = false` | contas só da fila, na ordem dela |
| **CD-6** | Commercial Brief e tela `#/radar/diretor` | a tela não recalcula; sem indicador sintético |
| **CD-7** | LLM explicativo sobre fatos tipados | fact gate; fallback determinístico |
| **CD-8** | SDR assistido: propostas por portas existentes, confirmação humana | nenhuma escrita sem confirmação |
| **CD-9** | outbound governado pelo Inbox | decisão explícita; kill switch, allowlist, canário |
| **CD-10** | SDR ativo | só com evidência dos níveis anteriores |

### 16.1 Onde o Diretor aparece (UX)

Rota decidida (D-1): **`#/radar/diretor`**, no grupo Comercial, rótulo "Radar · Diretor Comercial", permissão `radar`.
`/diretor` já pertence ao Diretor Financeiro. Ao criar a rota (CD-6): alinhar `ROTAS_NAV` e a paleta, classificar a
superfície no catálogo do Mission Control (`src/core/central/construcao.ts` tem guarda de superfície) e acrescentar
passos em `POR_ROTA` do Tour.

A tela só entra no CD-6. A "Inteligência" do Command Center (`docs/commercial-ux-1.0-decisao.md` §11) continua sendo
outra coisa: o Diretor tem casa própria.

### 16.2 Decisões (todas fechadas em 30/09/2026)

- **D-1 · Casa do Diretor — FECHADA (30/09/2026)**: tela própria `#/radar/diretor`, grupo Comercial, rótulo
  "Radar · Diretor Comercial". Nunca `/diretor` (Diretor Financeiro). Rota e tela só no CD-6.
- **D-2 · Relação com o CM4 — FECHADA (30/09/2026)**: as medidas DESCRITIVAS do CD-1 são a definição canônica. O CM4
  consome as mesmas definições, pode criar métricas próprias de experimento, aprendizado e calibração, e nunca redefine a
  mesma medida com outra fórmula. Uma métrica comercial = uma definição canônica. O contrato da medida vive no módulo
  neutro `src/core/radar/commercialMetrics.ts`.
- **CD-D3 · Meta comercial — FECHADA (30/09/2026)**: receita ganha em BRL, mensal, versionada (§19.1). Antes
  chamada D-3 aqui.
- **CD-D4 · Amostra mínima — FECHADA (30/09/2026)**: 30 observações no denominador (§19.2). Antes chamada D-4 aqui.
- **CD-D5 · Dono da conta — FECHADA (30/09/2026)**: zero ou um dono comercial canônico por conta (§19.3). Antes
  chamada D-5 aqui.

A nomenclatura CD-D3/CD-D4/CD-D5 é deste documento. As decisões D-3/D-4 do Lead Engine (`docs/lead-engine-1.0.md`)
são outras e não mudam.
- **D-6 · Legado — FECHADA (30/09/2026)**: `resumoRadar` e `filaHoje` estão DEPRECADOS como autoridades comerciais; o
  Diretor não os usa (teste prende). A remoção física é frente separada e acontece antes do CD-6. A Commercial Queue
  continua a autoridade operacional. **Remoção física feita em 30/09/2026** (§18).

### 16.3 Riscos

- **Números sem base.** Com 0 oportunidades e 0 toques, qualquer taxa seria ruído. Mitigação: `DADO_INSUFICIENTE`
  obrigatório e amostra mínima.
- **Segunda prioridade disfarçada.** Uma lista de "contas que merecem atenção" ordenada por critério próprio seria um
  segundo score. Mitigação: contas só por referência à fila, com guarda em teste.
- **Duas definições da mesma métrica** (legado × cadeia CM; Diretor × CM4). Mitigação: uma função por métrica; D-2 e
  D-6.
- **Prompt injection pelo contexto** (payload do CNO, notas, mensagens). Mitigação: sem LLM até o CD-7; no CD-7, só fatos
  tipados e fact gate.
- **Recorte do Inbox confundido com o todo.** Mitigação: o bloco declara o recorte visível pelo RLS.
- **Doc consumido por guardas.** O catálogo do Mission Control lê trechos literais de docs de estado. Mudanças de
  estado deste documento devem conferir `src/core/central/construcao.test.ts`.

## 17. CD-1 — snapshot comercial canônico

`snapshotComercialCD(radar, hoje, opcoes)` em `src/core/radar/commercialDirector.ts`, versão `VERSAO_REGRAS_CD` = `CD-1.0`
(`CD-1.1` desde a CD-D4, §19.2; `CD-1.2` desde a CD-D5, §19.3).
Responde "o que sabemos objetivamente agora"; não diagnostica nem recomenda. Os nomes finais substituem a proposta da
§5.1 onde diferem; os conceitos são os mesmos.

**Medida** (`MedidaComercial`, módulo neutro `commercialMetrics.ts`): `id`, `descricao` (o que é contado),
`estado` (`DISPONIVEL` · `DADO_INSUFICIENTE` · `NAO_APLICAVEL`), `valor` só quando disponível, `base` (universo ou
denominador), `unidade`, `autoridade` e `motivoInsuficiencia`. Zero nunca significa "não sei". `taxa()` só publica
com denominador positivo e amostra mínima alcançada. No CD-1.0 a amostra mínima não estava decidida
(`AMOSTRA_MINIMA_TAXA = undefined`) e nenhuma taxa era publicada; desde o CD-1.1 ela é 30 (CD-D4, §19.2).

**Entradas**: o `RadarDataset`, `hoje` explícito (validado como na fila) e, opcionais, o Inbox carregado, o instante
`agoraIso` para SLA e o limite de referências. Nenhum relógio, rede ou persistência.

**Blocos e autoridades reutilizadas** (cada número chama a função da autoridade):

| Bloco | O que mede | Autoridade |
|---|---|---|
| Commercial Queue | total, por categoria, fora da fila por motivo, primeiras referências na ordem da fila | `construirCommercialQueue` |
| Base | empresas, ativas, na fila, fora, por classe do Radar | fila + Radar |
| Decisores | contato ativo · decisor marcado · contato elegível · contato recomendado · nível de cobertura · canal acionável (fila) · pronta para CONTATO (plano) — conceitos separados | `contatoElegivel`, `coberturaEmpresa`, fila, `planosDaFilaCM` |
| Atividade | registradas, notas (NOTE não é toque), toques por tipo, 7/30 dias, reuniões (MEETING), resultados, respostas positivas, contas tocadas e nunca tocadas, tarefas abertas, tarefas vencidas (razão `TAREFA_VENCIDA` da fila), comunicações por estado, planos por modo, cadências por estado | `historicoDe`, fila, `planosDaFilaCM`, `cadenciasDaFilaCM`, catálogo de respostas |
| Funil | oportunidades, ativas, por estágio, valor estimado das ativas com valor, ativas sem valor, sem próxima ação, paradas e paradas críticas (razões da fila), registros de estágio, ganhas, perdidas, taxas (insuficientes) | Radar, `semProximaAcao`, fila |
| Prospecção | fontes CNO ativas, descobertos, pendentes, em revisão, rejeitados, promovidos, fila de revisão por sinal e por janela de descoberta, suprimidos; associar × criar = `DADO_INSUFICIENTE` (não gravado) | `metricasPiloto`, `filaDeRevisao`, `contadoresRevisao` |
| Qualidade | duplicatas pendentes, supressões por tipo, contatos inelegíveis, sinais não verificados, travas da fila, razões de dado faltante da fila | Radar, `contatoElegivel`, fila |
| Inbox | threads visíveis, por contexto e status, externas por intenção classificada, sem classificação, com primeira resposta, SLA vencido (só com `agoraIso`), contatos vinculados ao Radar, threads por conta (só com vínculo explícito) | `estadoSla`; nunca corpo de mensagem |

**Não entra**: valor ponderado do pipeline (a única ponderação canônica hoje é por conta, dentro da fila, para
desempate — somá-la não é pipeline), setor canônico (a classificação lê o payload bruto), taxas com menos de 30
observações (CD-D4), meta e realizado (CD-D3, ainda não implementada) e qualquer métrica por dono ou vendedor (a CD-D5
só prepara a autoridade; a única medida dela é `base.contasSemDono`).

**Provas** (`commercialDirector.test.ts`): determinismo; permutação das coleções não muda o resultado; dataset e Inbox
congelados não são alterados; nenhuma chave de score/peso/ranking; referências = `fila.itens` na mesma ordem (o único
`sort` do módulo ordena chaves de intenção); legado (`resumoRadar`, `filaHoje`, `recomendarAcao`,
`relatorioCobertura`) ausente e `./pipeline` importado só para `semProximaAcao`; lista fechada de imports, sem
Vibe, API, Supabase, store, envio ou relógio; mudar notas, observações, payload, descrições e texto de mensagem não muda
o snapshot; taxa sem amostra = `DADO_INSUFICIENTE`; oportunidade vazia = 0 disponível e Inbox ausente = insuficiente;
paridade com fila, plano, cadência, cobertura, elegibilidade, histórico e Lead Engine.

## 18. D-6 — remoção física do legado (30/09/2026)

Alternativa A da auditoria D-6, sem equivalências aproximadas: só migrou o que tem correspondência canônica real no CD-1;
o resto saiu da tela. `commercialDirector.ts`, `commercialMetrics.ts` e os motores `commercial*.ts` não mudaram.

**Removido do código.** A fila do dia legada (ordenação por `priorityScore` + vencida + sem próxima ação + hoje) e o
resumo legado do Radar (tipo e função), em `src/core/radar/pipeline.ts`. Ficam `lerEmpresa`, `ItemFila` e
`recomendarAcao` (página da empresa), além de `oportunidadesSemProximaAcao` e `decisorDe`.

**Command Center.** Topo e Visão geral leem `snapshotComercialCD(r, hoje, { limiteReferencias: 5 })`; a tela não
calcula, não ordena e não tem adapter. Medida em `DADO_INSUFICIENTE` aparece como "—".

Mesma definição, mesmo rótulo:

| Na tela | Fonte canônica |
|---|---|
| A+ leads · A leads · distribuição por classe (A+ a D) | `base.porClasseRadar` |
| Empresas | `base.empresasAtivas` |
| "N com contato elegível" (dica de Empresas; antes "com contato") | `decisores.comContatoElegivel` (mesmo `contatoElegivel`) |
| Duplicatas (contagem na aba) | `qualidade.duplicatasPendentes` |

Escopo ou definição diferentes, por isso com rótulo novo:

| Antes | Agora | Fonte canônica |
|---|---|---|
| Leads prioritários (top 5 por score, ação de `recomendarAcao`) | Fila comercial: total, "para agir agora", quatro categorias e as cinco primeiras contas com posição, categoria e razão | `commercialQueue.total`, `porCategoria`, `referencias` |
| Oportunidades ativas (todas as contas) | Oportunidades ativas em contas ativas | `funil.ativas` |
| Pipeline (todas as contas) | Valor estimado, em contas ativas, com "N sem valor" | `funil.valorEstimadoAtivas`, `funil.ativasSemValor` |
| Sem próxima ação (todas as oportunidades) | Sem próxima ação (contas ativas) | `funil.semProximaAcao` |
| Funil por estágio, quantidade e valor | Oportunidades por estágio (contas ativas), só quantidade | `funil.porEstagio` |
| Follow-ups vencidos (todas as tarefas abertas com vencimento anterior a hoje, esteja a conta na fila comercial ou não) | Tarefas vencidas na fila comercial (tarefas vencidas das contas presentes na Commercial Queue) | `atividade.tarefasVencidasNaFila` |
| Atividades 7 d / 30 d (notas incluídas) | Toques comerciais 7 d / 30 d, notas não contam | `atividade.toquesRecentes` |

Novos, sem antecessor: Paradas na fila e Paradas críticas (`funil.paradasNaFila`, `funil.paradasCriticasNaFila`).

Saíram sem sucessor: pipeline ponderado, sinais 7 d e 30 d, top sinais em 30 dias (card "Sinais nos últimos 30 dias";
o card virou só "Fontes"), respostas 30 d e positivas, propostas 30 d, projetos recebidos 30 d, reuniões 30 d, ganhas
90 d, perdidas 90 d, Classe B como secundário (segue na distribuição), com decisor adequado, com canal de contato,
precisam de pesquisa, precisam de enriquecimento, sem decisor, os percentuais de cobertura (contato, decisor,
contatáveis), fila de revisão da importação CSV (cartão e contagem na aba) e a coluna de valor por estágio.

**Scripts.** A posição na fila antiga saiu de `radar-registrar-sinal-producao.mts`,
`radar-registrar-atividade-producao.mts`, `radar-calibracao-aplicar.mts` e `radar-calibracao-simular.mts`. Nenhum deles
carrega duplicatas, comunicações e histórico de estágios, então uma posição na Commercial Queue calculada ali não seria a
da Hoje; a posição se confere na Hoje. A próxima ação do "antes/depois" de atividades passou a vir de `lerEmpresa`.

**Testes.** `src/core/radar/legadoD6.test.ts` prende zero ocorrência dos nomes em `src/` (fora de testes), `scripts/` e
`netlify/`, a ausência nos exports e a leitura canônica do Command Center. Os testes de store passaram a usar
`lerEmpresa`, `recomendarAcao`, `decisorDe`, `construirCommercialQueue` e `snapshotComercialCD`. Afirmações removidas
por não terem sucessor: ordenação da fila por `priorityScore`, `pipelinePonderado`, as janelas de 30/90 dias do resumo
(`respostas30d`), `followUpsVencidos`, `comDecisor`, `comCanal` e `precisamPesquisa`.

## 19. Decisões CD-D3, CD-D4 e CD-D5 (fechadas em 30/09/2026)

Nomenclatura própria do Commercial Director. As decisões D-3/D-4 do Lead Engine são outras e não mudam. Ordem de
implementação: CD-D4 primeiro (§19.2), depois CD-D5 e só então CD-D3, cada uma em frente e PR próprios. As migrations
da CD-D5 e da CD-D3 não se combinam.

### 19.1 CD-D3 — Meta comercial (fechada; não implementada)

- Meta primária = **receita ganha**, em **BRL**, período padrão **mensal**, fuso canônico **`America/Sao_Paulo`**.
- Definida à mão por usuário autorizado (permissão `radar_config`, usuário ativo da mesma organização), persistida e
  **versionada**: toda alteração cria nova versão e nenhuma versão existente é sobrescrita.
- V1 não tem metas por vendedor, vertical ou região. Sem meta válida → `DADO_INSUFICIENTE`. O CD-4 consome o gap.
- **Realizado**: oportunidades ganhas pelo instante de fechamento convertido para `America/Sao_Paulo`. O estado atual
  da conta não altera o realizado histórico: conta depois inativada, mesclada ou fora da Commercial Queue não elimina
  um ganho já contabilizado.
- **Ganho sem valor**: oportunidade ganha sem `valorEstimado` continua sendo ganho e entra na quantidade de ganhos, mas
  não entra no valor realizado; aparece na medida separada `GANHOS_SEM_VALOR`. Enquanto houver ganho sem valor no
  período, o gap monetário exato fica `DADO_INSUFICIENTE`. Valor faltante nunca é estimado.

### 19.2 CD-D4 — Amostra mínima (fechada; implementada no CD-1.1)

- `AMOSTRA_MINIMA_TAXA = 30` em `src/core/radar/commercialMetrics.ts`.
- Denominador 0 → `DADO_INSUFICIENTE` ("sem amostra"); denominador < 30 → `DADO_INSUFICIENTE` ("amostra abaixo da
  mínima (n < 30)"); denominador ≥ 30 → taxa disponível. A semântica de `taxa()` não mudou: só a constante saiu de
  `undefined` para 30.
- 30 é **regra de governança do produto** (quando uma taxa pode ser mostrada), **não** afirmação de precisão
  estatística. Toda interface ou relatório que mostrar uma taxa (a tela do Diretor, no CD-6, é a primeira) deve dizer
  que ela foi liberada pelo corte de governança de 30 observações e mostrar a base.
- `VERSAO_REGRAS_CD` subiu de `CD-1.0` para `CD-1.1`, porque as taxas `funil.taxaGanhoSobreFechadas` e
  `funil.taxaContaTocadaParaOportunidade` passam a sair `DISPONIVEL` quando o denominador chega a 30. Nenhuma outra
  medida muda. Com os dados de produção de 30/09/2026 (0 oportunidades) nada muda na prática.
- Provas (`commercialDirector.test.ts`, testes 14 e 14b): denominadores 0, 29, 30, 31 e 100 pela primitiva com o corte
  padrão, e 29, 30 e 40 oportunidades fechadas pelo snapshot; 0% com amostra é disponível, nunca confundido com falta
  de amostra.

### 19.3 CD-D5 — Dono da conta (fechada; implementada no CD-1.2)

- Cada conta comercial tem **zero ou um** dono comercial canônico, que precisa ser usuário **ativo** da **mesma
  organização**. Sem dono = `SEM_DONO`.
- O dono **não substitui** o responsável da oportunidade (`responsavelId`), o responsável da tarefa nem o responsável
  que a Commercial Queue deriva por item (`responsavelId` + `origemResponsavel` do CM1-A). A fila **não** usa o dono
  para ordenar.
- Conta sem dono não entra em métricas de desempenho individual e é diagnosticável pelo Diretor.
- Mudança de dono é auditável. Definir ou alterar dono exige a permissão `radar`, com validação de usuário ativo e
  mesma organização.
- **Mescla**: o dono da conta absorvida não é herdado automaticamente. A conta canônica mantém o próprio dono (com dono,
  mantém; sem dono, fica `SEM_DONO`). A decisão de dono depois de uma mescla é humana.
- **Dono que fica inativo** (fechado em 01/10/2026): o vínculo histórico fica (`commercial_owner_id` não é limpo), a
  conta passa a `DONO_INATIVO` (sem dono válido para fins operacionais), sai das métricas individuais e nada é
  redistribuído automaticamente; trocar o dono é decisão humana.

**Implementação (CD-1.2)**

- **Banco** (`supabase/migrations/0064_radar_company_owner.sql`, independente de 0060–0063; numerada 0064 porque a 0063 é a do FIN-RESET (PR #36)): coluna opcional
  `radar_company.commercial_owner_id` com FK para `profile` (o nome evita confusão com `radar_opportunity.owner_id`, que
  é o responsável da oportunidade), índice parcial `(organization_id, commercial_owner_id)` e o trigger
  `radar_company_dono_valido`, que exige perfil **ativo** da **mesma organização** só quando o dono (ou a organização da
  conta) muda — qualquer outra gravação passa, mesmo com dono inativo. Sem carga, sem tabela de histórico (a auditoria
  `radar_company_audit` já grava a linha inteira antes/depois com o autor), sem mudança de RLS (a política de escrita já
  usa os papéis da permissão `radar`). Escrita por script com a chave de serviço fica sem autor na auditoria do banco.
- **Core** (`src/core/radar/donoConta.ts`, puro): `estadoDonoConta` (COM_DONO, SEM_DONO, DONO_INATIVO — dono gravado
  que está inativo ou não é usuário da organização), `donoValido`, `motivosRecusaDono`, `contasSemDonoValido` e
  `entraEmMetricaIndividual` (porta única para métricas individuais futuras). Sem ranking, score, ordenação ou regra da
  fila.
- **Modelo**: `Empresa.commercialOwnerId`, mapeado nos dois sentidos em `radar.supabase.ts` (id sem tradução vai cru e
  o banco recusa; nunca vira `null` em silêncio).
- **Escrita**: só `actions.definirDonoContaRadar(empresaId, usuarioId | null, motivo?)` — permissão `radar`, conta
  existente e não mesclada, usuário da lista da organização (`Dataset.usuarios`, lida de `profile` sob RLS) e ativo;
  `null` remove, texto vazio é recusado; auditoria `radar_definir_dono_conta` / `radar_remover_dono_conta` com o dono
  anterior e o novo. `salvarEmpresaRadar` preserva o dono atual (conta nova nasce sem dono); importação CSV, adapters
  e Lead Engine passam por `upsertEmpresa`, cujo tipo de entrada não tem dono; a mescla copia só campos vazios de uma
  lista fixa, sem o dono.
- **Snapshot**: `base.contasSemDono` = contas ativas e não mescladas sem dono válido (SEM_DONO ou DONO_INATIVO). Recebe
  os usuários em `opcoes.usuarios` (nunca repassados à fila); sem eles e com algum dono gravado, `DADO_INSUFICIENTE`.
  `AMOSTRA_MINIMA_TAXA = 30`, `taxa()` e as demais medidas do CD-1.1 não mudaram.
- **Provas**: `src/data/radar.dono.store.test.ts` (matriz 1–16 da decisão), `src/core/radar/donoConta.test.ts`
  (estados, medida, mapeamento, `upsertEmpresa`) e `scripts/pg-smoke-dono-conta.mjs` no Quality Gate (FK, organização,
  ativo, recusas, remoção, auditoria antes/depois com autor, dono que ficou inativo e a gravação da mescla).

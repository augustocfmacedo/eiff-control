# EIFF Lead Engine 1.0 — contrato arquitetural, autoridades e ciclo de vida

Estado: **LE-0 fechado** (este documento). LE-1 a LE-8 não iniciados.
Branch: `feature/lead-engine-1` · baseline: `main @ 88c9ccc` (Commercial UX 1.0 em produção).
Documento canônico do Lead Engine. A Máquina Comercial continua em `docs/commercial-machine.md` e
`docs/commercial-machine-cm2.md`; o Radar, em `docs/radar.md`.

**Este bloco é docs-only.** Nada de runtime foi criado ou alterado no LE-0: nenhuma tabela, migration, endpoint,
crawler, agendador, integração externa, tela, score, fila ou entidade nova. O que está aqui é **contrato**: o que o
Lead Engine é, o que ele nunca pode ser, e quais decisões precisam do Augusto antes de LE-1.

---

## 1. Verificação de baseline

| Item | Verificado |
| --- | --- |
| Repositório | `eiff-control` |
| Worktree | `.claude/worktrees/lead-engine-1` (isolado do checkout principal) |
| Branch | `feature/lead-engine-1` |
| HEAD na entrada | `88c9cccf5432c831114227dfb4dbd02b74be4f5f` |
| Árvore na entrada | limpa |
| Runtime alterado no LE-0 | **não** (`src/**`, `api/**`, `netlify/**`, `supabase/**`, `migrations/**`, `package*.json` intocados) |

O checkout principal tem trabalho paralelo de **Mission Control / EIFF Central**. Nada em `src/core/central/**`,
mapa vivo ou work items foi lido para escrita nem tocado por este bloco.

---

## 2. Princípio arquitetural: onde o Lead Engine entra

```text
FONTES (CNO, PNCP, CNPJ/RFB, NEWS, LINKEDIN, PARTNER, WEBSITE, CSV, MANUAL, VIBE)
  ↓
LEAD ENGINE ............ descobre, normaliza, identifica, deduplica, promove
  ↓
RADAR .................. fonte de verdade das entidades (radar_*): Empresa, Contato, Projeto, Sinal
  ↓
CM1 .................... Commercial Queue + Action Plan (o que fazer agora, em que ordem)
  ↓
CM2 .................... Cadence Engine + Task Suggestion + fronteira de escrita
  ↓
COMMERCIAL UX .......... Panorama, Modo Foco, Pipeline, Entrada (apresentação e operação)
```

O fluxo é **unidirecional**. O Lead Engine é a **camada de entrada** do Radar: ele existe antes da Empresa existir.
A partir do momento em que uma Empresa existe no Radar, quem manda é o Radar (score, decisores, sinais) e depois a
Máquina Comercial (prioridade, ação, cadência).

Consequência direta: **o Lead Engine não decide o que o comercial faz hoje.** Ele decide *o que entra*.

---

## 3. Proibição: não existe uma segunda prioridade comercial

A Máquina Comercial já é a autoridade única de prioridade operacional (`construirCommercialQueue` em
`src/core/radar/commercialMachine.ts`, consumida por `Hoje.tsx` e pela Commercial UX 1.0).

O Lead Engine **não pode**:

- produzir uma fila própria de "leads quentes" paralela à Commercial Queue;
- produzir um "lead score" que compita com `priorityScore` / `priorityClass` do Radar;
- reordenar, filtrar ou promover contas dentro da fila do dia;
- criar uma segunda tela de trabalho diário.

O que o Lead Engine produz entra no sistema como **entidade do Radar** (ou como candidato a virar uma) e daí em
diante segue pelo caminho normal. Se um lead do Lead Engine aparece na fila do dia, é porque o Radar pontuou e a
Máquina Comercial priorizou — nunca porque o Lead Engine pediu.

**Teste conceitual de violação:** se alguma coisa no Lead Engine precisar saber o que o vendedor vai fazer hoje, a
fronteira foi cruzada.

---

## 4. Auditoria das fundações reais (o que já existe)

O LE-0 não inventa algoritmo. Antes de definir política, foi lido o que o repositório já tem. Resumo do que **já
está implementado e em produção**:

| Fundação | Onde | Situação |
| --- | --- | --- |
| Catálogo de fontes com confiabilidade | `src/core/radar/types.ts` (`Fonte`), `padroes.ts` (`FONTES_PADRAO`) | **existe**, 10 fontes semeadas |
| Linhagem do bruto | `RegistroFonte` (`radar_source_record`) | **existe**, gravado na importação e na ingestão |
| Contrato normalizado por fonte | `src/core/radar/adapters.ts` | **existe** (interfaces + 5 adapters de parsing) |
| Ingestão normalizada (upsert + dedup + linhagem) | `src/core/radar/ingestao.ts` | **existe**, puro sobre o `RadarDataset` |
| Escada de identidade | `encontrarEmpresa` em `normalizar.ts` | **existe** |
| Fila de duplicatas | `PossivelDuplicata` | **existe** |
| Importação CSV com job/linha/erro | `src/core/radar/importacao.ts` | **existe**, usado na carga piloto |
| Dry run antes de importar | `src/core/radar/dryrun.ts`, `npm run radar:dry-run` | **existe** |
| Supressões | `Supressao` (`do_not_contact`, `email_bounced`, `invalid_phone`, `opt_out`) | **existe** |
| Governança de crédito pago | ledger `radar_vibe_operation` + RPCs server-only | **existe** |
| Métricas de cobertura de decisor | `src/core/radar/cobertura.ts` | **existe** |

O que **não existe** hoje:

- nenhuma **chamada real** a CNO, PNCP, CNPJ/RFB, NEWS ou LINKEDIN (os adapters só sabem *parsear*, `buscar?` não é
  implementado em nenhum deles);
- nenhum **agendador**: `netlify/functions/` tem 7 funções, todas síncronas e disparadas por pedido do usuário;
  não há função agendada, cron ou webhook de descoberta (`netlify.toml` não declara `schedule`);
- nenhuma **área de staging**: hoje ou o registro vira Empresa, ou vira `PossivelDuplicata`, ou é marcado
  `'ignorada'` — não existe "candidato em observação";
- nenhum **ciclo de vida** explícito na Empresa (ver §11).

**Conclusão da auditoria:** o Lead Engine 1.0 não começa do zero. Ele começa fechando lacunas de uma fundação que já
está desenhada e testada. A maior parte do trabalho de LE-1 a LE-3 é *ligar* o que existe, não reescrever.

---

## 5. Matriz de fontes e papéis

Cada fonte tem um papel diferente. Confundir os papéis é o erro clássico de sistema de prospecção.

| Fonte | Tipo | Confiab. | Papel no Lead Engine | Custo |
| --- | --- | --- | --- | --- |
| CNO | `CNO` | 0,90 | **Descoberta de obra** (evento real, datado, com responsável) | público |
| PNCP | `PNCP` | 0,90 | **Descoberta de contratação pública** (plano/licitação) | público |
| CNPJ / RFB | `CNPJ_RFB` | 1,00 | **Identidade e enriquecimento cadastral**, nunca descoberta | público |
| Notícias | `NEWS` | 0,60 | **Sinal de timing**, nunca identidade | público |
| LinkedIn | `LINKEDIN` | 0,70 | Sinal fraco (vagas, posts) | — |
| Parceiros | `PARTNER` | 0,90 | **Indicação humana** — melhor sinal, menor volume | — |
| Site da empresa | `WEBSITE` | 0,60 | Sinal de publicação própria | público |
| CSV | `CSV` | 0,80 | Carga manual em lote | — |
| Manual | `MANUAL` | 1,00 | Registro da equipe | — |
| Vibe / Explorium | `VIBE` | 0,80 | **Enriquecimento pago de decisor**, nunca descoberta primária | **pago** |

Regras que saem da matriz:

1. **Descoberta ≠ identidade ≠ sinal.** CNO/PNCP descobrem; RFB identifica; NEWS/WEBSITE/LINKEDIN dão timing.
2. **VIBE nunca é ponto de partida.** É caro e é enriquecimento. Entra depois que a conta já existe e já foi
   considerada relevante (ver §9).
3. A `confiabilidade` da fonte já multiplica a confiança do sinal em `registrarSinalNormalizado`
   (`confianca = s.confianca * fonte.confiabilidade`). O Lead Engine **não** cria um segundo multiplicador.

---

## 6. Linhagem: `RegistroFonte` é obrigatório e é o registro de origem

`RegistroFonte` (`radar_source_record`) guarda o payload bruto de cada registro recebido, com `fonteId`, `tipo`,
`externoId`, `entidadeId` (preenchido *depois* do upsert) e `recebidoEm`.

Isso já acontece hoje em dois caminhos:

- `importacao.ts` grava o registro bruto de cada linha de CSV (empresas e contatos);
- `ingestao.ts` (`ingerirRegistro`) grava o registro **antes** de decidir o que fazer com ele — inclusive quando o
  registro não produz entidade nenhuma (`'ignorada'`);
- `pipeline.ts` lê o payload de volta (último `RegistroFonte` do tipo `empresa` daquela entidade).

**Contrato do Lead Engine:** nenhum dado entra no Radar sem `RegistroFonte`. Toda Empresa, Contato, Projeto ou Sinal
criado pelo Lead Engine tem de ser rastreável até o bruto que o originou, e até a fonte que entregou aquele bruto.

Corolário: **é proibido "limpar" o bruto.** O payload original nunca é reescrito — a normalização vive ao lado dele,
não no lugar dele. Essa regra já vale para a leitura do Signal Pilot (`raw_payload.leitura`) e para a calibração de
setor (`fitCalibracao.ts`: "dado original nunca reescrito").

---

## 7. A decisão central do LE-0: staging / Candidate

Hoje o sistema tem **dois estados**: ou é Empresa, ou não é nada (registro `'ignorada'` ou `PossivelDuplicata`).

Descoberta automática exige um terceiro estado. Uma obra encontrada no CNO com um CNPJ que ainda não conhecemos
**não é uma conta comercial** — é um candidato. Criar Empresa direto para cada descoberta significa poluir o Radar,
distorcer as métricas de cobertura e, pior, colocar ruído na fila do dia.

Três opções foram consideradas:

**Opção A — sem staging (comportamento atual).** Toda descoberta vira Empresa imediatamente.
*Contra:* o Radar deixa de ser "carteira" e vira "banco de dados de CNPJ". Quebra §3 na prática, porque a fila passa
a ter de filtrar ruído. **Recusada.**

**Opção B — tabela `radar_candidate` própria.** Entidade nova, com ciclo próprio, tela própria, RLS própria.
*Contra:* cria uma segunda raiz comercial ao lado de Empresa — exatamente o que o Radar evitou quando decidiu que
"Lead não é entidade". Custa uma migration, um slice no `Dataset`, mapeamento em `radar.supabase.ts` e uma tela.
*Pró:* explícito e consultável. **Possível, mas caro para o que resolve.**

**Opção C — staging lógico dentro de `RegistroFonte` (recomendada).** O candidato é um `RegistroFonte` **sem
`entidadeId`**. Já é exatamente o que `ingerirRegistro` produz hoje quando devolve `'ignorada'`: o bruto está
guardado, com fonte e data, e nenhuma entidade foi criada.
*Pró:* zero entidade nova; a linhagem que já é obrigatória vira o próprio staging; a promoção é "este registro virou
esta Empresa", que é o campo que já existe. *Contra:* exige um critério de leitura ("registros sem `entidadeId`, da
fonte X, ainda não decididos") e, provavelmente, um campo de decisão para não reprocessar eternamente o mesmo bruto.

**Recomendação: Opção C**, com a ressalva de que o campo de decisão (aceito / recusado / pendente) precisa ser
definido em LE-1 — e é a única coisa que pode exigir migration nessa frente. Ver decisão **D-1**.

---

## 8. Matriz de identidade (auditada, não inventada)

`encontrarEmpresa(dados, empresas, limiar = 0.82)` em `src/core/radar/normalizar.ts` já implementa a escada:

| Chave | Resultado | Confiança |
| --- | --- | --- |
| `businessId` (32 hex, Explorium) igual | `certo` | 1,00 |
| CNPJ igual | `certo` | 1,00 |
| Domínio igual | `certo` | 0,97 |
| Domínio igual **mas `businessId` diferente** | `possivel` ("grupo?") | 0,60 |
| Razão social normalizada + cidade/UF | `provavel` | 0,90 |
| Mesmo nome, outra localização | `possivel` | 0,70 |
| Similaridade ≥ 0,82 | `possivel` | *similaridade* |

E a política de escrita, já implementada em `upsertEmpresa`:

- `certo` e `provavel` → **atualizam** a empresa existente, preenchendo **apenas campos vazios** (a menos que
  `opts.sobrescrever`);
- `possivel` → **cria nova** empresa e abre `PossivelDuplicata` pendente para revisão humana;
- `associarEmpresaContato` **nunca cria empresa**: ambiguidade vai para a fila de revisão.

**Contrato do Lead Engine:** esta matriz é a única. O Lead Engine não introduz uma segunda escada de identidade,
não baixa o limiar e não converte `possivel` em criação silenciosa sem revisão.

Caso real em produção que valida a escada: Grupo Sinova × GRUPO SINAGRO ficaram como duplicata pendente desde
08/09/2026 (mesmo domínio, `businessId` diferente → `possivel` 0,60). O sistema fez o certo: parou e perguntou.

---

## 9. Idempotência (auditoria e lacuna)

O que já é idempotente:

- **Sinal**: `registrarSinalNormalizado` deduplica por `fonteId + externoId`, ou, sem `externoId`, por
  `tipo + titulo + data do evento`.
- **Projeto**: `upsertProjeto` deduplica por `empresaId + fonteExternaId`, ou por nome em minúsculas.
- **Empresa/Contato**: pela escada de identidade (§8).
- **Operação paga (Vibe)**: `idempotencyKey` + `requestHash` no ledger `radar_vibe_operation`, com reserva antes da
  execução. Esse é o padrão mais forte do repositório.
- **Comunicação**: `context_hash` SHA-256 com índice único parcial por rascunho ativo.

**Lacuna:** não existe idempotência no nível do *registro bruto*. Reprocessar o mesmo arquivo CNO duas vezes grava
dois `RegistroFonte`. Hoje isso é inofensivo (as entidades deduplicam), mas com descoberta automática vira ruído
permanente no staging da §7.

**Contrato do Lead Engine:** toda ingestão automática precisa de chave de idempotência explícita
`(fonteId, externoId)`. Sem `externoId` estável, a fonte não é elegível para ingestão automática — entra por CSV
manual. Ver decisão **D-7**.

---

## 10. Governança do que é pago (Vibe)

Regra vigente, auditada em `vibeServidor.ts`, `netlify/functions/vibe.ts` e no CLAUDE.md:

> toda ação paga exige operação reservada no banco (simular → reservar → executar com `operationId` +
> `idempotencyKey`); budget/reserve do navegador não são fonte de verdade.

E a decisão operacional em vigor: **"Nenhuma prospecção nova nem consumo de créditos sem ordem explícita."**

**Contrato do Lead Engine:** o Lead Engine **não tem orçamento próprio** e **não pode iniciar operação paga**.
Descoberta é feita por fonte pública ou por indicação. Enriquecimento pago continua sendo um ato humano deliberado,
pela aba Vibe Prospecting, sob o ledger existente.

Se um dia o Lead Engine precisar de enriquecimento pago em lote, isso é uma **nova decisão do Augusto**, com
política de crédito própria — não uma consequência de ter ligado a descoberta. Ver decisão **D-9**.

---

## 11. Ciclo de vida: o que falta hoje

A `Empresa` do Radar **não tem campo de estágio de ciclo de vida**. Os campos de estado que existem são:

- `ativo` (booleano),
- `mescladaEm` (id da empresa que absorveu esta, quando a duplicata foi resolvida),
- os caches de score recalculados (`fitScore`, `priorityScore`, `priorityClass`, `ultimoSinalEm`, `ultimoContatoEm`).

Ou seja: hoje o "estágio" de uma conta é **derivado** — de score, de cobertura de decisor (`cobertura.ts`:
`IDEAL_DECISION_MAKER` / `USABLE_CONTACT` / `NEEDS_BETTER_DECISION_MAKER` / `NO_CONTACT`) e do estado da próxima
ação (`recomendarAcao`). Não há coluna.

O ciclo de vida que o Lead Engine 1.0 assume (nomes propostos, **ainda não implementados**):

```text
DESCOBERTO ....... RegistroFonte sem entidadeId. Não é conta. Não aparece para o comercial.
   ↓ (promoção — §13)
CONHECIDO ........ Empresa existe no Radar. Tem identidade. Pode não ter decisor nem sinal.
   ↓ (cobertura: contato utilizável)
ABORDÁVEL ........ Empresa + decisor com canal válido + sem supressão.
   ↓ (Máquina Comercial)
EM TRABALHO ...... Entrou na Commercial Queue; há cadência e atividade.
   ↓ (decisão humana)
OPORTUNIDADE ..... Oportunidade aberta, com estágio e próxima ação obrigatória.
```

**Contrato:** estes estágios são **derivados**, não gravados, enquanto não houver decisão em contrário. Derivar
evita o problema clássico de estágio que fica desatualizado em relação aos dados que o produziram. Se virar coluna,
tem de ser cache recalculado, como os scores já são. Ver decisão **D-2**.

---

## 12. Descoberta ≠ Empresa

Uma obra no CNO é um **evento**. Uma licitação no PNCP é um **evento**. Uma notícia é um **evento**.

Nenhum deles é, por si, uma conta comercial da EIFF. O responsável por uma obra no CNO pode ser uma construtora que
já é cliente, uma construtora que nunca será cliente, uma pessoa física, ou um CNPJ que não diz nada.

**Contrato:** descoberta produz, no máximo, um candidato (§7) + um sinal potencial. A conversão em Empresa é um
passo separado, com critério explícito, e nunca é efeito colateral de ter lido uma fonte.

---

## 13. Empresa ≠ lead pronto (promoção)

Existir no Radar não significa estar pronta para abordagem. A Commercial UX 1.0 já expressa isso na zona **Entrada**
(`comercialEntrada.ts`), que separa três conceitos que nunca devem ser confundidos:

- **SEM DECISOR** (`SEM_DECISOR`, `SEM_DECISOR_IDEAL_PARA_SINAL`) — falta enriquecimento;
- **SEM CANAL** (`SEM_CANAL_VALIDO`) — falta contato utilizável;
- **NOVO** (sinal novo / conta adicionada ao Radar) — falta leitura comercial.

`SEM DECISOR != NOVO LEAD` e `SEM CANAL != NOVO LEAD` são regras já congeladas em teste na UX-5.

**Contrato da promoção (candidato → Empresa):**

1. identidade resolvida pela escada da §8 com resultado `certo` (CNPJ ou `businessId`), ou decisão humana explícita;
2. `RegistroFonte` presente e ligado (`entidadeId` preenchido no momento da promoção);
3. nenhuma supressão `do_not_contact` aplicável (§16);
4. em LE-1 e LE-2, **confirmação humana obrigatória** (§17).

Promoção automática por regra configurável é assunto de LE-6, depois de haver histórico suficiente para calibrar.
Ver decisões **D-10** e **D-15**.

---

## 14. Nenhuma oportunidade automática

Regra crítica do Radar, já imposta no store: **oportunidade ativa sem próxima ação é recusada.**

O Lead Engine **nunca** abre oportunidade. Abrir oportunidade é um compromisso de pipeline: passa a contar em valor
previsto, em estágio, em cadência e em cobrança de próxima ação. Isso é decisão humana, sempre.

O mesmo vale para: criar tarefa, criar atividade, criar comunicação, mudar estágio de oportunidade.

---

## 15. Nenhum efeito externo

O Lead Engine **não envia nada**. Não manda e-mail, não manda WhatsApp, não abre conversa, não toca em
`radar_communication` nem no ledger de entrega (`radar_communication_delivery`).

Essa fronteira já é protegida por testes em `canais.test.ts` / `canaisEnvio.test.ts` e pelo modo fail-closed dos
providers. O Lead Engine não cria um caminho novo que escape dela.

Leitura de fonte pública (HTTP GET a CNO/PNCP) é efeito **externo de entrada**, não de saída, e ainda assim só entra
em LE-3, server-side, com chave e rate limit próprios, e disparado por pessoa.

---

## 16. Supressões são absolutas

`Supressao` (`do_not_contact`, `email_bounced`, `invalid_phone`, `opt_out`) já bloqueia no `recomendarAcao`:
empresa suprimida devolve `DO_NOT_CONTACT` antes de qualquer outra regra.

**Contrato:** supressão vence descoberta. Uma conta suprimida que reaparece em uma fonte externa **não** é
re-promovida, **não** volta para a Entrada e **não** gera sinal acionável. A supressão é da conta e do contato, não
do registro — reimportar o bruto não a apaga.

---

## 17. Human-in-the-loop

Em LE-1 a LE-5, **toda criação de entidade a partir de descoberta automática passa por confirmação humana.**

Isso não é provisório por falta de confiança no algoritmo: é o mesmo padrão que o repositório já aplica em todo
ponto de risco — dry run antes da importação, simulação antes da reserva de crédito, `READY_FOR_REVIEW` antes de
aprovar comunicação, `--executar` explícito nos scripts de produção, fronteira de escrita governada no CM2-E.

O automatismo só entra depois que existe evidência acumulada de que a decisão humana e a decisão da regra coincidem.

---

## 18. Confiança da fonte ≠ prioridade comercial

Confusão perigosa: "esta fonte é 0,9 confiável" **não** quer dizer "esta conta é prioritária".

- `Fonte.confiabilidade` mede **quão verdadeiro** é o dado. Já entra na confiança do sinal.
- `priorityScore` / `priorityClass` medem **quão interessante** é a conta. Vêm das regras configuráveis do Radar
  (`radar_score_rule`, `radar_score_setting`), calibradas em produção pela Production Calibration 01.

**Contrato:** o Lead Engine alimenta o primeiro e **nunca** escreve no segundo. Não mexe em peso, corte de classe,
dimensão nem decision fit. A Production Calibration 01 é explícita: "Não mudar cortes de classe nem pesos das
dimensões sem nova calibração aprovada."

---

## 19. Onde o resultado aparece: zona Entrada

O Lead Engine não ganha tela nova no horizonte do LE-1..LE-4. O resultado dele aparece na **zona Entrada** do
Panorama da Commercial UX 1.0, que já existe e já tem contrato fechado (`comercialEntrada.ts`, janela de 7 dias,
três conceitos separados, um destaque cada).

Quando uma conta é promovida, ela entra em "CONTA ADICIONADA AO RADAR" pelo caminho normal — porque foi adicionada
ao Radar, não porque o Lead Engine pediu destaque.

A **fila de revisão de candidatos** (LE-2) é tela separada, de trabalho de back-office, e **não** fica na Hoje. Ver
decisão **D-13**.

---

## 20. Métricas (futuras, não implementadas)

O Lead Engine vai precisar de medida de funil de entrada. O lugar natural é estender `src/core/radar/cobertura.ts`,
que já produz `RelatorioCobertura` — não criar um módulo de métricas paralelo, e **não** usar
`src/data/telemetria.ts` (que é de uso de interface, local, anônimo e por navegador; não serve para métrica de
negócio).

Candidatas: descobertos por fonte por período; taxa de promoção; taxa de duplicata; tempo até primeira cobertura de
decisor; contas descobertas que chegaram a oportunidade. Nada disso entra antes de LE-7. Ver decisão **D-14**.

---

## 21. Fronteiras (resumo executável)

O Lead Engine **pode**: ler fontes públicas (server-side, a partir de LE-3); normalizar por adapter; gravar
`RegistroFonte`; propor identidade pela escada existente; abrir `PossivelDuplicata`; propor promoção; criar
Empresa/Contato/Projeto/Sinal **após confirmação humana**.

O Lead Engine **não pode**: criar oportunidade; criar tarefa ou atividade; criar ou enviar comunicação; gastar
crédito pago; escrever em score, peso, corte ou decision fit; produzir fila própria; reordenar a Commercial Queue;
ignorar supressão; reescrever payload bruto; criar segunda ACL ou segundo caminho de escrita fora do store.

---

## 22. Roadmap LE-1 → LE-8

| Bloco | Escopo | Runtime? | Migration? |
| --- | --- | --- | --- |
| **LE-1** | Contrato de descoberta (`DiscoveryRecord`) + staging lógico + idempotência `(fonteId, externoId)`. Core puro, sem rede. | `src/core/radar/**` | talvez (campo de decisão do staging) |
| **LE-2** | Fila de revisão de candidatos + promoção humana, pelo store, auditada. | core + tela + store | não |
| **LE-3** | Adapter CNO real, server-side, disparado por pessoa. | função Netlify + core | não |
| **LE-4** | Adapters PNCP e CNPJ/RFB (identidade e enriquecimento cadastral). | função Netlify + core | não |
| **LE-5** | Unificação da autoridade de ação: resolver a dívida `recomendarAcao` × Máquina Comercial (§23). | core | não |
| **LE-6** | Regras de promoção configuráveis (padrão do Radar: regra em tabela, nunca peso fixo no código). | core + config | sim |
| **LE-7** | Métricas de funil de entrada em `cobertura.ts`. | core + tela | não |
| **LE-8** | Descoberta agendada. **Só depois de LE-1..LE-7 fechados e com histórico.** | função agendada | não |

Nenhum bloco começa sem GO explícito.

---

## 23. Dívida herdada: duas autoridades de ação (LE-5)

Auditado e registrado aqui porque o Lead Engine vai esbarrar nisso.

Existem hoje **duas** funções que respondem "o que fazer com esta conta":

1. `recomendarAcao(empresa, radar, hoje)` em `src/core/radar/pipeline.ts` — estado por conta
   (`EstadoAcao`: `DO_NOT_CONTACT`, `OVERDUE_TASK`, `PLANNED_ACTION`, `RESPOND`, `SEARCH_DECISION_MAKER`,
   `ENRICH_CONTACT`, `RESEARCH_SIGNALS`, `CONTACT_NOW`, `FOLLOW_UP`, `OPEN_OPPORTUNITY`, `WAIT`).
   Consumido por `cobertura.ts`, `calibracao.ts`, `comunicacao.ts` (contexto) e por `Vibe.tsx:83`, que usa
   `recomendarAcao(...).estado === 'SEARCH_DECISION_MAKER'` para escolher as contas-alvo da busca de decisor.

2. `construirCommercialQueue` + `planosDaFilaCM` (CM1-A/CM1-B) — prioridade e plano de ação da fila do dia.
   `commercialActionPlan.ts` declara explicitamente que **nunca consulta `recomendarAcao`**.

Isso é coerente hoje (uma é *estado do CRM por conta*, a outra é *fila operacional*), mas é frágil: são duas
definições de "próxima ação" que podem divergir sem que nada acuse. O uso em `Vibe.tsx` é o sintoma — a decisão de
onde gastar crédito depende da autoridade *antiga*.

**Não resolver agora.** Registrar como dívida **LE-5** e não deixar o Lead Engine criar uma terceira. Ver decisão
**D-3**.

---

## 24. Decisões abertas

Formato: estado atual · evidência · opções · recomendação · impacto · precisa decisão do Augusto.

### D-1 — Como representar o candidato (staging)
- **Estado atual:** não existe staging; registro sem entidade é `'ignorada'`.
- **Evidência:** `ingestao.ts` (`ingerirRegistro` grava `RegistroFonte` antes de decidir e devolve `'ignorada'`).
- **Opções:** A) sem staging · B) tabela `radar_candidate` · C) staging lógico em `RegistroFonte` sem `entidadeId`.
- **Recomendação:** **C**, com campo de decisão (pendente/aceito/recusado) definido em LE-1.
- **Impacto:** define se LE-1 tem migration.
- **Precisa decisão do Augusto: SIM.**

### D-2 — Ciclo de vida gravado ou derivado
- **Estado atual:** derivado; `Empresa` não tem campo de estágio.
- **Evidência:** `types.ts` (`Empresa` tem `ativo`, `mescladaEm` e caches de score, nada de estágio).
- **Opções:** A) só derivado · B) coluna `lifecycle_stage` gravada · C) derivado + cache recalculado como os scores.
- **Recomendação:** **A agora, C se a leitura ficar cara.** Nunca B sem recálculo.
- **Impacto:** arquitetura de leitura do Lead Engine e das métricas de LE-7.
- **Precisa decisão do Augusto: SIM.**

### D-3 — Autoridade de ação (`recomendarAcao` × Máquina Comercial)
- **Estado atual:** duas autoridades coexistem (§23).
- **Evidência:** `pipeline.ts:69`, `commercialActionPlan.ts:5-6`, `Vibe.tsx:83`.
- **Opções:** A) manter as duas e documentar o papel de cada uma · B) `recomendarAcao` vira função interna do CM ·
  C) `recomendarAcao` é aposentada e o CM passa a expor estado por conta.
- **Recomendação:** **A no LE-0/LE-1** (é o que está sendo feito aqui), **decidir entre B e C no LE-5**.
- **Impacto:** alto; mexe em `cobertura.ts`, `calibracao.ts`, `comunicacao.ts` e `Vibe.tsx`.
- **Precisa decisão do Augusto: NÃO agora; SIM em LE-5.**

### D-4 — Quando ligar descoberta automática
- **Estado atual:** nenhuma descoberta automática; nenhum agendador.
- **Evidência:** `netlify/functions/` sem função agendada; `netlify.toml` sem `schedule`.
- **Opções:** A) só manual, indefinidamente · B) manual em LE-1..LE-7, agendado em LE-8 · C) agendar já em LE-3.
- **Recomendação:** **B.**
- **Impacto:** define o risco operacional e o custo de infraestrutura.
- **Precisa decisão do Augusto: SIM** (é o compromisso de ritmo).

### D-5 — Qual fonte pública primeiro
- **Estado atual:** adapters CNO, PNCP, CNPJ e NEWS existem, mas só sabem parsear; nenhum busca.
- **Evidência:** `adapters.ts` (`buscar?` não implementado em nenhum adapter).
- **Opções:** A) CNO primeiro · B) PNCP primeiro · C) CNPJ/RFB primeiro (enriquecer o que já existe antes de
  descobrir coisa nova).
- **Recomendação:** **A (CNO)** — é o único que descobre *obra real datada com responsável*, que é o negócio da
  EIFF. **C é um bom LE-3.5** e tem risco zero, porque não descobre nada, só melhora o que já está no Radar.
- **Impacto:** define o conteúdo de LE-3.
- **Precisa decisão do Augusto: SIM.**

### D-6 — Descoberta sem CNPJ
- **Estado atual:** `associarEmpresaContato` nunca cria empresa em caso de ambiguidade.
- **Evidência:** `ingestao.ts` ("nunca cria empresa automaticamente").
- **Opções:** A) descoberta sem CNPJ nunca vira Empresa (fica candidato) · B) vira Empresa com identidade fraca ·
  C) vira Empresa só se domínio resolver.
- **Recomendação:** **A.**
- **Impacto:** qualidade da base; risco de duplicata em massa.
- **Precisa decisão do Augusto: NÃO** (segue o padrão já vigente), mas registrar ciência.

### D-7 — Chave de idempotência da ingestão
- **Estado atual:** entidades deduplicam; registro bruto não.
- **Evidência:** §9.
- **Opções:** A) `(fonteId, externoId)` obrigatório, fonte sem `externoId` estável não é elegível a automático ·
  B) hash do payload · C) nenhum (aceitar duplicata de bruto).
- **Recomendação:** **A**, com **B como complemento** quando a fonte tiver id instável.
- **Impacto:** define se o staging acumula lixo.
- **Precisa decisão do Augusto: SIM.**

### D-8 — Lead Engine pode influenciar score
- **Estado atual:** não pode; score é regra configurável calibrada.
- **Evidência:** Production Calibration 01; `padroes.ts`; "nada de peso fixo no código".
- **Opções:** A) nunca · B) só pela dimensão `DATA_QUALITY` · C) dimensão nova para origem da descoberta.
- **Recomendação:** **A.** Se um dia B, é nova calibração aprovada, não efeito do Lead Engine.
- **Impacto:** integridade da calibração de produção.
- **Precisa decisão do Augusto: NÃO** (confirmação apenas).

### D-9 — Lead Engine pode gastar crédito Vibe
- **Estado atual:** não; "nenhuma prospecção nova nem consumo de créditos sem ordem explícita".
- **Evidência:** ledger `radar_vibe_operation`; RPCs server-only; política `radar_vibe_credit_policy`.
- **Opções:** A) nunca · B) sim, com política e teto próprios · C) sim, reaproveitando a política existente.
- **Recomendação:** **A** para todo o Lead Engine 1.0.
- **Impacto:** custo direto em reais.
- **Precisa decisão do Augusto: SIM** (é dinheiro).

### D-10 — Promoção automática ou humana
- **Estado atual:** não existe promoção; importação cria direto.
- **Evidência:** §13.
- **Opções:** A) sempre humana · B) automática quando identidade = `certo` por CNPJ · C) humana em LE-1..LE-5,
  configurável em LE-6.
- **Recomendação:** **C.**
- **Impacto:** volume de trabalho manual em LE-2 e LE-3.
- **Precisa decisão do Augusto: SIM.**

### D-11 — Oportunidade automática
- **Estado atual:** nunca; store recusa oportunidade ativa sem próxima ação.
- **Opções:** A) nunca · B) rascunho de oportunidade sem próxima ação · C) automática para sinal forte.
- **Recomendação:** **A.**
- **Impacto:** integridade do pipeline e do valor previsto.
- **Precisa decisão do Augusto: NÃO** (confirmação apenas).

### D-12 — Supressão e redescoberta
- **Estado atual:** supressão bloqueia `recomendarAcao`; não há regra explícita para redescoberta.
- **Evidência:** `pipeline.ts` (`empresaSuprimida` é a primeira guarda de `recomendarAcao`).
- **Opções:** A) supressão vence descoberta, sempre · B) redescoberta reabre para revisão · C) supressão expira.
- **Recomendação:** **A**, com registro visível ("descoberta suprimida") para auditoria, sem reabrir.
- **Impacto:** conformidade e confiança.
- **Precisa decisão do Augusto: SIM.**

### D-13 — Onde o candidato é revisado
- **Estado atual:** não existe tela.
- **Evidência:** zona Entrada da UX-5 tem contrato fechado e não é fila de back-office.
- **Opções:** A) tela nova no Command Center · B) aba na Hoje · C) reaproveitar o importador do Radar.
- **Recomendação:** **A** (Command Center), nunca B.
- **Impacto:** protege o contrato da Commercial UX 1.0.
- **Precisa decisão do Augusto: SIM.**

### D-14 — Onde vivem as métricas
- **Estado atual:** `cobertura.ts` já produz relatório; telemetria é de interface.
- **Opções:** A) estender `cobertura.ts` · B) módulo novo · C) view SQL.
- **Recomendação:** **A**, com **C** se o volume exigir.
- **Impacto:** evita um terceiro lugar de verdade.
- **Precisa decisão do Augusto: NÃO agora** (decidir em LE-7).

### D-15 — Resolver as duplicatas pendentes antes de LE-2
- **Estado atual:** Grupo Sinova × GRUPO SINAGRO pendente desde 08/09/2026.
- **Evidência:** estado registrado no CLAUDE.md; `PossivelDuplicata` com status `pendente`.
- **Opções:** A) resolver antes de LE-2 · B) resolver junto com a fila de revisão em LE-2 · C) deixar.
- **Recomendação:** **B** — a fila de revisão de LE-2 é exatamente a ferramenta que falta; resolver à mão antes
  desperdiça o caso de teste real.
- **Impacto:** LE-2 nasce com um caso real para validar.
- **Precisa decisão do Augusto: SIM.**

---

## 25. O que este documento não faz

Não define algoritmo de descoberta. Não define formato de requisição para CNO ou PNCP. Não define schema de tabela.
Não escolhe limiar. Não cria tipo em `types.ts`. Não altera nenhuma regra em vigor.

Tudo isso depende das decisões da §24 e entra em LE-1.

---

## 26. Como verificar

```bash
git diff --name-status 88c9ccc..HEAD
```

Só `docs/` pode aparecer. Se aparecer qualquer caminho em `src/`, `api/`, `netlify/`, `supabase/`, `migrations/` ou
`package*.json`, o bloco está inválido.

A suíte não foi tocada e continua sendo a do baseline:

```bash
npm test
```

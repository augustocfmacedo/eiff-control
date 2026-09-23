# EIFF Lead Engine 1.0 — contrato arquitetural, autoridades e ciclo de vida

Estado: **LE-2 RELEASED** em 23/09/2026 — migration `0055` aplicada em produção (§33) e PR #9 mesclado em `main` (`0273da87`). **LE3-A em andamento** (contrato da fonte oficial do CNO, §34). **LE2-F fechado** (rebaseline e certificação, §32). **LE-0 fechado** (contrato, §1 a §26), **LE-1 fechado** (intake canônico, §27) e **LE2-A fechado**
(fundação de persistência, §28). **LE2-B fechado** (núcleo de revisão e decisão, §29). **LE2-C fechado** (fronteira do store, §30). **LE2-E fechado** (UI no Command Center, §31). **LE-3 não iniciado.**
LE-3 a LE-8 não iniciados.
Branch ATUAL da linha: `feature/lead-engine-2`, agora com `origin/main @ 5e7b3be` incorporada por merge (§32) sobre a base `origin/main @ 14d2ff7` com LE-0 e LE-1 recuperados
por cherry-pick (a antiga `feature/lead-engine-1` foi aposentada por colisão de worktree; o módulo órfão está
preservado em `rescue/lead-engine-2-orphan`). Baseline histórico do LE-0: `main @ 88c9ccc`.
Documento canônico do Lead Engine. A Máquina Comercial continua em `docs/commercial-machine.md` e
`docs/commercial-machine-cm2.md`; o Radar, em `docs/radar.md`.

As seções 1 a 26 são o **contrato** do LE-0 e continuam valendo como estão: o que o Lead Engine é e o que ele nunca
pode ser. As 15 decisões da §24 foram **todas fechadas em 22/09/2026** e estão resumidas na tabela daquela seção.
A §27 registra o que o LE-1 entregou em runtime.

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
| ~~**LE-1**~~ | **FECHADO** (§27): `DiscoveryRecord` + staging lógico + idempotência em duas chaves. Core puro, sem rede. | `src/core/radar/**` | sim, `0055` — **aplicada em produção em 23/09/2026** (§33) |
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

## 24. Decisões — todas fechadas em 22/09/2026

| # | Assunto | Decisão adotada |
| --- | --- | --- |
| D-1 | Staging | **`RegistroFonte` sem `entidadeId` é o staging lógico.** Nada de `radar_candidate`, nada de segunda raiz de CRM. Extensão mínima de `radar_source_record` autorizada e feita na migration 0055. |
| D-2 | Ciclo de vida | **Derivado.** Nenhum `lifecycle_stage`, `lead_status` ou `funnel_stage` em `radar_company`. |
| D-3 | Autoridade de ação | Mantidas as duas com papéis distintos; unificar é **LE-5**. O Lead Engine não cria uma terceira. |
| D-4 | Automação | **Manual / disparo explícito** de LE-1 a LE-7. Agendador só em **LE-8**. Nenhum cron no LE-1. |
| D-5 | Primeira fonte real | **CNO**, e isso pertence ao **LE-3**. O LE-1 não chama o CNO. |
| D-6 | Descoberta sem CNPJ | Não vira Empresa: fica candidato. |
| D-7 | Idempotência | Identidade externa = `fonteId + externoId`; **separada** de `payloadFingerprint`, que é a versão observada. Fonte automática exige `externoId` estável. Fingerprint nunca é tratado como id do objeto. |
| D-8 | Score | O Lead Engine **nunca** escreve em score, peso, corte ou decision fit. |
| D-9 | Vibe | O Lead Engine 1.0 **não inicia operação paga**. Nenhum crédito automático. |
| D-10 | Promoção | **Human-in-the-loop** de LE-1 a LE-5. Nenhuma promoção automática. |
| D-11 | Oportunidade | Nunca automática. |
| D-12 | Supressão | **Supressão vence redescoberta.** O bruto é preservado; a conta não é reativada automaticamente. |
| D-13 | Revisão de candidato | **Command Center**, não a Hoje. O LE-1 ainda não cria essa tela. |
| D-14 | Métricas | Estender `cobertura.ts` em LE-7. |
| D-15 | Duplicatas pendentes | Grupo Sinova × GRUPO SINAGRO segue pendente: é caso real do **LE-2**. |

O detalhamento abaixo (estado atual · evidência · opções · recomendação · impacto) é o registro de **por que** cada
decisão foi tomada; a resposta adotada é a da tabela acima.

### D-1 — Como representar o candidato (staging)
- **Estado atual:** não existe staging; registro sem entidade é `'ignorada'`.
- **Evidência:** `ingestao.ts` (`ingerirRegistro` grava `RegistroFonte` antes de decidir e devolve `'ignorada'`).
- **Opções:** A) sem staging · B) tabela `radar_candidate` · C) staging lógico em `RegistroFonte` sem `entidadeId`.
- **Recomendação:** **C**, com campo de decisão (pendente/aceito/recusado) definido em LE-1.
- **Impacto:** define se LE-1 tem migration.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-2 — Ciclo de vida gravado ou derivado
- **Estado atual:** derivado; `Empresa` não tem campo de estágio.
- **Evidência:** `types.ts` (`Empresa` tem `ativo`, `mescladaEm` e caches de score, nada de estágio).
- **Opções:** A) só derivado · B) coluna `lifecycle_stage` gravada · C) derivado + cache recalculado como os scores.
- **Recomendação:** **A agora, C se a leitura ficar cara.** Nunca B sem recálculo.
- **Impacto:** arquitetura de leitura do Lead Engine e das métricas de LE-7.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-3 — Autoridade de ação (`recomendarAcao` × Máquina Comercial)
- **Estado atual:** duas autoridades coexistem (§23).
- **Evidência:** `pipeline.ts:69`, `commercialActionPlan.ts:5-6`, `Vibe.tsx:83`.
- **Opções:** A) manter as duas e documentar o papel de cada uma · B) `recomendarAcao` vira função interna do CM ·
  C) `recomendarAcao` é aposentada e o CM passa a expor estado por conta.
- **Recomendação:** **A no LE-0/LE-1** (é o que está sendo feito aqui), **decidir entre B e C no LE-5**.
- **Impacto:** alto; mexe em `cobertura.ts`, `calibracao.ts`, `comunicacao.ts` e `Vibe.tsx`.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-4 — Quando ligar descoberta automática
- **Estado atual:** nenhuma descoberta automática; nenhum agendador.
- **Evidência:** `netlify/functions/` sem função agendada; `netlify.toml` sem `schedule`.
- **Opções:** A) só manual, indefinidamente · B) manual em LE-1..LE-7, agendado em LE-8 · C) agendar já em LE-3.
- **Recomendação:** **B.**
- **Impacto:** define o risco operacional e o custo de infraestrutura.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-5 — Qual fonte pública primeiro
- **Estado atual:** adapters CNO, PNCP, CNPJ e NEWS existem, mas só sabem parsear; nenhum busca.
- **Evidência:** `adapters.ts` (`buscar?` não implementado em nenhum adapter).
- **Opções:** A) CNO primeiro · B) PNCP primeiro · C) CNPJ/RFB primeiro (enriquecer o que já existe antes de
  descobrir coisa nova).
- **Recomendação:** **A (CNO)** — é o único que descobre *obra real datada com responsável*, que é o negócio da
  EIFF. **C é um bom LE-3.5** e tem risco zero, porque não descobre nada, só melhora o que já está no Radar.
- **Impacto:** define o conteúdo de LE-3.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-6 — Descoberta sem CNPJ
- **Estado atual:** `associarEmpresaContato` nunca cria empresa em caso de ambiguidade.
- **Evidência:** `ingestao.ts` ("nunca cria empresa automaticamente").
- **Opções:** A) descoberta sem CNPJ nunca vira Empresa (fica candidato) · B) vira Empresa com identidade fraca ·
  C) vira Empresa só se domínio resolver.
- **Recomendação:** **A.**
- **Impacto:** qualidade da base; risco de duplicata em massa.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-7 — Chave de idempotência da ingestão
- **Estado atual:** entidades deduplicam; registro bruto não.
- **Evidência:** §9.
- **Opções:** A) `(fonteId, externoId)` obrigatório, fonte sem `externoId` estável não é elegível a automático ·
  B) hash do payload · C) nenhum (aceitar duplicata de bruto).
- **Recomendação:** **A**, com **B como complemento** quando a fonte tiver id instável.
- **Impacto:** define se o staging acumula lixo.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-8 — Lead Engine pode influenciar score
- **Estado atual:** não pode; score é regra configurável calibrada.
- **Evidência:** Production Calibration 01; `padroes.ts`; "nada de peso fixo no código".
- **Opções:** A) nunca · B) só pela dimensão `DATA_QUALITY` · C) dimensão nova para origem da descoberta.
- **Recomendação:** **A.** Se um dia B, é nova calibração aprovada, não efeito do Lead Engine.
- **Impacto:** integridade da calibração de produção.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-9 — Lead Engine pode gastar crédito Vibe
- **Estado atual:** não; "nenhuma prospecção nova nem consumo de créditos sem ordem explícita".
- **Evidência:** ledger `radar_vibe_operation`; RPCs server-only; política `radar_vibe_credit_policy`.
- **Opções:** A) nunca · B) sim, com política e teto próprios · C) sim, reaproveitando a política existente.
- **Recomendação:** **A** para todo o Lead Engine 1.0.
- **Impacto:** custo direto em reais.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-10 — Promoção automática ou humana
- **Estado atual:** não existe promoção; importação cria direto.
- **Evidência:** §13.
- **Opções:** A) sempre humana · B) automática quando identidade = `certo` por CNPJ · C) humana em LE-1..LE-5,
  configurável em LE-6.
- **Recomendação:** **C.**
- **Impacto:** volume de trabalho manual em LE-2 e LE-3.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-11 — Oportunidade automática
- **Estado atual:** nunca; store recusa oportunidade ativa sem próxima ação.
- **Opções:** A) nunca · B) rascunho de oportunidade sem próxima ação · C) automática para sinal forte.
- **Recomendação:** **A.**
- **Impacto:** integridade do pipeline e do valor previsto.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-12 — Supressão e redescoberta
- **Estado atual:** supressão bloqueia `recomendarAcao`; não há regra explícita para redescoberta.
- **Evidência:** `pipeline.ts` (`empresaSuprimida` é a primeira guarda de `recomendarAcao`).
- **Opções:** A) supressão vence descoberta, sempre · B) redescoberta reabre para revisão · C) supressão expira.
- **Recomendação:** **A**, com registro visível ("descoberta suprimida") para auditoria, sem reabrir.
- **Impacto:** conformidade e confiança.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-13 — Onde o candidato é revisado
- **Estado atual:** não existe tela.
- **Evidência:** zona Entrada da UX-5 tem contrato fechado e não é fila de back-office.
- **Opções:** A) tela nova no Command Center · B) aba na Hoje · C) reaproveitar o importador do Radar.
- **Recomendação:** **A** (Command Center), nunca B.
- **Impacto:** protege o contrato da Commercial UX 1.0.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-14 — Onde vivem as métricas
- **Estado atual:** `cobertura.ts` já produz relatório; telemetria é de interface.
- **Opções:** A) estender `cobertura.ts` · B) módulo novo · C) view SQL.
- **Recomendação:** **A**, com **C** se o volume exigir.
- **Impacto:** evita um terceiro lugar de verdade.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

### D-15 — Resolver as duplicatas pendentes antes de LE-2
- **Estado atual:** Grupo Sinova × GRUPO SINAGRO pendente desde 08/09/2026.
- **Evidência:** estado registrado no CLAUDE.md; `PossivelDuplicata` com status `pendente`.
- **Opções:** A) resolver antes de LE-2 · B) resolver junto com a fila de revisão em LE-2 · C) deixar.
- **Recomendação:** **B** — a fila de revisão de LE-2 é exatamente a ferramenta que falta; resolver à mão antes
  desperdiça o caso de teste real.
- **Impacto:** LE-2 nasce com um caso real para validar.
- **Decidida em 22/09/2026** — ver a tabela no topo desta seção.

---

## 25. O que o LE-0 não fez

Não definiu algoritmo de descoberta. Não definiu formato de requisição para CNO ou PNCP. Não definiu schema de
tabela. Não escolheu limiar. Não criou tipo em `types.ts`. Não alterou nenhuma regra em vigor. O LE-0 foi
docs-only: `git diff --name-status 88c9ccc..98636bd` mostra apenas `docs/`.

---

## 26. Como verificar

```bash
npm test
npm run build
```

Escopo do LE-1 (nada fora desta lista pode aparecer):

```bash
git diff --name-status 98636bd..HEAD
```

```text
A  src/core/radar/leadEngineIntake.ts
A  src/core/radar/leadEngineIntake.test.ts
M  src/core/radar/types.ts
M  src/data/radar.supabase.ts
A  supabase/migrations/0055_lead_engine_intake.sql
M  docs/lead-engine-1.0.md
```

---

## 27. LE-1 entregue — intake canônico, staging lógico e idempotência

Primeiro bloco de runtime. **Não busca nada**: nenhuma chamada a CNO, PNCP, RFB, NEWS ou Vibe; nenhum agendador;
nenhuma tela. O que o LE-1 entrega é a capacidade de afirmar, com prova: *"recebi este registro externo exatamente
uma vez, preservei a evidência bruta, sei em que estado ele está e não transformei isso numa conta comercial."*

### 27.1 Schema — `radar_source_record` antes e depois

Antes (migration 0031, sem alteração desde então):

```text
id uuid pk · organization_id uuid not null → organization(id) · source_id uuid not null → radar_source(id)
record_type text not null check in ('empresa','contato','projeto','sinal') · external_id text
payload jsonb not null · entity_id uuid · received_at timestamptz not null default now()
index radar_source_record_source_idx (source_id, received_at desc)
```

Depois (migration 0055, aplicada em produção em 23/09/2026 — §33). Cinco colunas, todas anuláveis:

| Coluna | Por que existe |
| --- | --- |
| `payload_fingerprint text` | Sem ela não existe idempotência nem conceito de "nova observação". É a chave que separa repetição exata de mudança factual (D-7). |
| `intake_status text` | `entity_id` só distingue RESOLVED; PENDING, REVIEW e REJECTED são indistinguíveis sem esta coluna. **NULL = registro fora do Lead Engine.** |
| `decided_at timestamptz` | A §7 exige que o schema responda *quando* a decisão humana aconteceu. |
| `decided_by uuid → profile(id)` | Responde *quem* decidiu. Mesma convenção de `resolved_by`/`verified_by` do resto do schema. |
| `decision_reason text` | Responde *por quê*. REJECTED sem motivo é inauditável. |

Nenhuma outra coluna foi criada. Não há coluna redundante com `entity_id`: a coerência entre os dois é um CHECK,
não uma duplicação.

Restrições e índices:

```sql
check (intake_status is null or intake_status in ('PENDING','REVIEW','RESOLVED','REJECTED'))
check (intake_status is distinct from 'RESOLVED' or entity_id is not null)
check (intake_status is null or (external_id is not null and payload_fingerprint is not null))
unique index (organization_id, source_id, external_id, payload_fingerprint)
        where external_id is not null and payload_fingerprint is not null
index (organization_id, intake_status, received_at desc) where intake_status is not null
trigger radar_source_record_evidencia  -- evidência bruta imutável no UPDATE
```

O índice único é deliberadamente **quádruplo**. `unique (organization_id, source_id, external_id)` seria um erro:
impediria a mesma obra de ser observada de novo com conteúdo diferente. Só a repetição **exata** é proibida.

### 27.2 Registros históricos — sem backlog falso

`intake_status` **NULL** significa "este registro não é gerenciado pelo Lead Engine". Todo o histórico anterior, a
importação CSV e o Vibe caem nesse caso, sem backfill e sem migração destrutiva. A garantia é dupla:

- no banco, o índice da fila é **parcial** (`where intake_status is not null`), então histórico nunca é listado;
- no core, `discoveryRecordDe` devolve `undefined` sem `statusIntake`, então histórico **nunca vira `DiscoveryRecord`**
  e, por construção, nunca vira PENDING. Teste 34 e teste 40 provam isso, inclusive rodando `importarCsv` de verdade.

### 27.3 RLS

Inalterada. `radar_source_record` já tem `radar_source_record_select` (`organization_id = current_org()`) e
`radar_source_record_write` (papéis comerciais) desde a 0031, mais o `grant` para `authenticated`. Colunas novas
herdam as políticas existentes. **Nenhuma policy paralela, nenhum escape de service-role, nenhuma escrita sem tenant.**

### 27.4 Contrato de domínio

`src/core/radar/leadEngineIntake.ts` — puro. Importa exatamente dois módulos: `./hash` e `./types` (teste 45 prende
a lista). `DiscoveryRecord` é **projeção de leitura sobre `RegistroFonte`**, não entidade nova e não tabela nova:
seu `registroFonteId` é o id do próprio registro.

Dois conceitos formalizados e separados:

```text
IdentidadeFonte    = fonteId + externoId ........ QUAL objeto externo (a obra, a licitação)
payloadFingerprint = sha256(jsonCanonico(payload)) QUAL VERSÃO dele foi observada
```

Classificação da repetição (`classificarIntake`):

| Entrada | Resultado | Efeito |
| --- | --- | --- |
| mesma identidade + mesma impressão | `IDEMPOTENT_NOOP` | nada é criado: nem registro, nem sinal, nem revisão |
| mesma identidade + impressão diferente | `NOVA_OBSERVACAO` | novo registro **ao lado**; o anterior fica intacto |
| identidade desconhecida | `NOVO_REGISTRO` | primeiro registro daquele objeto |

`validarIntake` recusa com `SEM_IDENTIDADE_EXTERNA` quem chega sem `externoId` estável — sem isso não há
idempotência possível e a fonte não pode ser automatizada. CSV e MANUAL **não passam por aqui**: continuam em
`importacao.ts` e `ingerirRegistro`, inalterados.

O hash reusa `hash.ts` (`jsonCanonico` + `sha256Hex`), o mesmo do `context_hash` das comunicações: determinístico,
puro, funciona no navegador e no servidor, **nenhuma biblioteca nova**. A canonicalização ordena chaves em todos os
níveis e preserva a ordem dos arrays. `payloadFingerprint` recebe **só o payload** — por construção, `recebidoEm`,
o id local e qualquer campo gerado pelo app não têm como entrar no hash.

### 27.5 Evidência bruta imutável

Em duas camadas: o mapeamento de `registrosFonte` segue `imutavel: true` (insert-only) e a migration 0055 põe a
mesma regra no banco (trigger `radar_source_record_evidencia`), permitindo mudar **apenas** `intake_status`,
`decided_*` e `entity_id`. Conteúdo externo diferente nunca reescreve o registro anterior: gera outro.

### 27.6 Dívida conhecida para o LE-2

`registrosFonte` é **insert-only** no `radar.supabase.ts`. Isso é correto para o LE-1, onde o estado é gravado no
INSERT e nada transiciona. Mas **transicionar um candidato** (PENDING → RESOLVED/REJECTED) exige tornar aquela spec
mutável — e aí perde-se o `delete`-quando-some do ramo imutável, que hoje é código morto para esta tabela. O teste
46 prende `imutavel: true` justamente para que o LE-2 tenha de mudar isso **conscientemente**, com o trigger do
banco já no lugar para impedir que a mutabilidade toque o bruto.

### 27.7 Migration (não aplicada à época; aplicada em 23/09/2026, §33)

`supabase/migrations/0055_lead_engine_intake.sql` está no repositório e **não foi aplicada em produção**. Nenhum
comando foi rodado contra o banco remoto. A aplicação pertence a um release futuro do Lead Engine. O número 0055 foi
escolhido porque 0052 está reservada pela EIFF Central (existe só em código) e 0053/0054 já foram aplicadas.

---

## 28. LE2-A — fundação de persistência do staging

Primeiro gate do LE-2. Trata **só** de fazer a decisão chegar ao banco: não traz o módulo de revisão, não liga
store, não mexe no Command Center. A linha nasceu de `origin/main @ 14d2ff7` com LE-0 e LE-1 recuperados por
cherry-pick, na branch `feature/lead-engine-2`.

### 28.1 `registrosFonte` deixou de ser insert-only

A spec de `radar_source_record` em `radar.supabase.ts` perdeu `imutavel: true`. Motivo: no ramo imutável de
`persistirRadar` só existem `inserir` e `apagar` — **não há caminho de update**, então `PENDING → REVIEW →
RESOLVED/REJECTED` era descartado em silêncio.

A troca tem um segundo efeito, tão importante quanto o primeiro: o ramo imutável **apagava** a linha que sumisse
do dataset (`h.apagar`), e o ramo mutável não apaga nada. Evidência bruta é trilha de auditoria, não cache:

```text
SOURCE RECORD DELETE BY ORDINARY DATASET DIFF = FORBIDDEN
```

Isso está preso por teste (`radar.persistencia.test.ts`).

### 28.2 A evidência continua imutável — e quem garante é o banco

Tornar a spec mutável **não** afrouxa a evidência. O trigger `radar_source_record_evidencia` (migration 0055)
recusa alteração de `organization_id`, `source_id`, `record_type`, `external_id`, `payload`,
`payload_fingerprint` e `received_at`. Só `intake_status`, `decided_at`, `decided_by`, `decision_reason` e
`entity_id` evoluem.

**Divisão de prova, declarada de propósito:**

| Camada | O que prova | Onde |
| --- | --- | --- |
| TypeScript | o que o adapter **manda**: colunas, valores, e por qual caminho (`gravar` × `inserir` × `apagar`) | `src/data/radar.persistencia.test.ts` (23 testes) |
| PostgreSQL | o que o banco **recusa**: o trigger, os CHECKs e o índice de idempotência | `scripts/pg-smoke-lead-engine.mjs` (PGlite, 17 asserções) |

Teste de TypeScript não substitui trigger de PostgreSQL. O adapter pode mandar um payload adulterado; quem diz
não é o banco — e isso agora está provado contra um Postgres de verdade, em memória, dentro de
`BEGIN … ROLLBACK`.

### 28.3 `entity_id` é polimórfico pelo `record_type`

`RegistroFonte.entidadeId` aponta para quatro tabelas. A resolução antiga (`empresas ?? contatos`) cobria duas e
gravava `null` para projeto e sinal — e o CHECK `RESOLVED ⇒ entity_id is not null` **recusaria a linha**.

```text
empresa → empresas     contato → contatos
projeto → projetos     sinal   → sinais
```

`COLECAO_DO_REGISTRO` é a tabela única dessa correspondência. Sem entidade ligada, `entity_id` vai nulo — o que
é válido em PENDING, REVIEW e REJECTED.

### 28.4 Política de supressão (congelada)

```text
SUPPRESSION_POLICY = SUPPRESSION_WINS_REDISCOVERY
```

D-12 é a autoridade. Conta suprimida que reaparece numa fonte externa:

- o **bruto é preservado** (a descoberta aconteceu e fica auditável);
- **não promove** — nada vira Empresa, Projeto ou Sinal por esse caminho;
- **não volta para a fila acionável** do comercial;
- fica **visível para auditoria** como descoberta suprimida.

Não existe reativação automática. E `KEEP_REVIEW` **não** pode ser usado para manter uma redescoberta suprimida
eternamente na fila operacional: a transição exata é assunto do LE2-B, mas a semântica está congelada aqui.

### 28.5 Migration nova: **NÃO**

A 0055 já tem tudo — as cinco colunas, os três CHECKs, o índice único parcial e o trigger. O LE2-A é mudança de
**adapter**, não de schema. Nada foi aplicado em banco remoto.

---

## 29. LE2-B — núcleo de revisão, decisão e promoção

`src/core/radar/leadEngineReview.ts`. Núcleo **puro** sobre o `RadarDataset`: projeta candidatos, analisa
identidade, aplica guardas, valida a decisão de uma pessoa, promove quando permitido e transiciona o
`RegistroFonte`. Adaptado do módulo preservado em `rescue/lead-engine-2-orphan` (blob `8abe00da…`), com três
correções obrigatórias.

### 29.1 Human-in-the-loop preservado

Nenhum candidato não suprimido se autopromove. As quatro decisões — `ASSOCIATE_EXISTING`, `CREATE_COMPANY`,
`KEEP_REVIEW`, `REJECT` — vêm de fora e são revalidadas contra o estado **atual** do dataset, nunca contra o que
a tela viu. `payloadFingerprintEsperado` divergente é `CONTEXTO_MUDOU`; observação mais nova aberta é
`OBSERVACAO_DESATUALIZADA`, e a mais nova não é tocada.

`CREATE_COMPANY` só com empresa normalizada + identidade forte (CNPJ válido ou `businessId` de 32 hex) e sem
match `certo`/`provavel` (`JA_EXISTE_EMPRESA`). Match `possivel` preserva o comportamento canônico do Radar:
empresa nova + `PossivelDuplicata` pendente — sem exceção inventada no Lead Engine.

### 29.2 Transições canônicas — autoridade de verdade

```text
PENDING → REVIEW | RESOLVED | REJECTED
REVIEW  → RESOLVED | REJECTED
RESOLVED → (nada)        REJECTED → (nada)        REVIEW → PENDING proibido
```

No módulo órfão a tabela existia mas `transicionar()` **não a consultava**. Agora `transicionar` é a única porta
de mudança de `statusIntake`, chama `transicaoPermitida` antes de escrever e falha fechada com
`TRANSICAO_INVALIDA`. Um teste varre o módulo: fora dessa função, ninguém escreve o campo.

`BLOQUEIO_DURO` — constante declarada e nunca usada no órfão — **não foi trazida**.

### 29.3 Supressão terminal (D-12)

```text
SUPPRESSION_POLICY = SUPPRESSION_WINS_REDISCOVERY
```

Candidato que resolve para conta com `do_not_contact` ou `opt_out`:

- sai da **fila acionável** (`filaDeRevisao`) e aparece em `descobertasSuprimidas`, projeção somente leitura —
  supressão não vira desaparecimento;
- **não promove** por nenhuma decisão (`ASSOCIATE_EXISTING`, `CREATE_COMPANY` e `KEEP_REVIEW` recusam com
  `SUPRIMIDO`), o que impede usar `KEEP_REVIEW` para eternizá-lo na fila;
- encerra por `terminalizarSuprimido`: `PENDING|REVIEW → REJECTED`, `motivoDecisao = SUPRIMIDO`, com ator e data.
  Não cria Empresa, Projeto nem Sinal; não reativa a conta; não remove a supressão.

O wiring automático é do LE2-C — aqui o comportamento está definido e provado.

### 29.4 Linhagem da promoção

O sinal promovido recebe como evidência o **payload bruto do próprio `RegistroFonte`**, não o eco do adapter. Os
adapters de hoje devolvem `payload: bruto`, então uma asserção de valor não distingue as duas origens; a garantia
é estrutural e está presa por teste e por mutação (`payload: bruto.payload`, nunca `normalizado.payload`).

Promoção usa os primitivos existentes — `upsertEmpresa`, `upsertProjeto`, `registrarSinalNormalizado` — e
**nunca** `ingerirRegistro`, que criaria um segundo `RegistroFonte` e duplicaria a evidência.

### 29.5 O que o LE2-B não faz

Nenhuma Oportunidade, Tarefa, Atividade ou Comunicação automática. Zero efeito externo: sem rede, sem Supabase,
sem Vibe, sem CNO/PNCP/RFB. Não toca score, `priorityScore`, `priorityClass`, Commercial Queue nem cadência.

- **Store ainda não ligado** — `src/data/store.ts` intocado; a porta governada é o LE2-C.
- **UI ainda não ligada** — Command Center, Hoje, Panorama, Modo Foco, Pipeline e Entrada intocados; é o LE2-E.
- **Migration 0055 ainda não aplicada remotamente.**

O barril `src/core/radar/index.ts` passou a exportar `leadEngineIntake` e `leadEngineReview` (sem ciclo; `tsc`
limpo), com guarda de export no teste.

---

## 30. LE2-C — fronteira governada do store

`actions.processarCandidatoLeadEngine` em `src/data/store.ts`. **O store é fronteira, não autoridade.**

```text
permissão → lê o estado ATUAL → o CORE revalida e decide → auditoria → um commit
```

Nenhuma regra do Lead Engine foi copiada para o store. Identidade forte, supressão, match, fingerprint,
observação desatualizada, transições e as regras de `CREATE`/`ASSOCIATE` continuam em `leadEngineReview.ts` — e
testes estruturais varrem o bloco da action para garantir que não voltem a aparecer ali.

### 30.1 Uma única porta

```ts
type ComandoLeadEngine =
  | { tipo: 'DECISAO'; pedido: PedidoDecisao }
  | { tipo: 'TERMINALIZAR_SUPRIMIDO'; registroFonteId: string };
```

União discriminada em vez de duas actions: existe **um** entrypoint, e um teste conta os métodos públicos com
`leadEngine` no nome para que continue sendo um só.

### 30.2 Revalidação no estado atual

A action lê `state.ds.radar` no momento da chamada. Nunca aceita dataset, análise, fila pré-calculada ou empresa
já resolvida vindos da tela. O `ContextoDecisao` sai inteiro de `idsRadar(state.ds.radar)` — ids, data-base,
relógio e usuário são do **store**; a UI não fornece nenhum deles.

Chama `aplicarDecisao` (que já revalida por dentro) ou `terminalizarSuprimido`. Não há `validarDecisao` seguido
de `aplicarDecisao`: uma autoridade só, chamada uma vez.

### 30.3 Falha fechada e commit único

Recusa do core vira `RegraLeadEngineError` — subclasse de `RegraDeNegocioError`, então quem só mostra a mensagem
não muda, e quem precisa decidir lê `motivos`, `registroFonteId` e `operacao` sem parsing de texto. Em qualquer
recusa: **nada é registrado, nada é commitado, nada é aplicado pela metade** — provado comparando a referência de
`state.ds` antes e depois.

No sucesso, o `RadarDataset` que o core devolveu substitui `ds.radar` de uma vez, com **um** `registrar` e **um**
`commit`. A action não encadeia `criarEmpresa` + `criarProjeto` + `registrarSinal`, o que produziria vários
commits, estado intermediário e uma segunda validação divergente.

**Commit vazio não existe:** quando o core devolve o mesmo dataset (`KEEP_REVIEW` já em `REVIEW`), a action
retorna sem registrar nem commitar.

### 30.4 Duplo clique é seguro

A segunda chamada relê o estado, encontra `RESOLVED`/`REJECTED` e o core recusa com `STATUS_TERMINAL`. Não nasce
segunda Empresa, Projeto, Sinal nem auditoria de sucesso. Vale igualmente para `TERMINALIZAR_SUPRIMIDO`.

### 30.5 Auditoria

Uma entrada por operação, distinguindo `lead_engine_decisao_<decisao>` de `lead_engine_terminalizar_suprimido`.
Guarda a **decisão** (status, entidade, empresa, projeto, sinais, `empresaCriada`, decisão humana e empresa
escolhida), com o motivo humano em `REJECT` e `SUPRIMIDO` na terminalização. **Não regrava o payload bruto** — a
evidência já está em `RegistroFonte`.

### 30.6 Fronteiras

Zero efeito externo: sem Supabase direto, sem `persistirRadar`, sem RPC, sem SQL — a persistência segue pelo
`commit(ds)` normal, que passa pelo adapter corrigido no LE2-A. Nenhuma varredura automática de suprimidos: não
há `useEffect`, timer, cron nem hook de startup. A porta existe; quem a chama é decisão do wiring de UI.

- **UI ainda não ligada** — Command Center, Hoje, Panorama, Modo Foco, Pipeline e Entrada intocados (LE2-E).
- **Persistência não tocada neste gate** — `radar.supabase.ts` e a migration 0055 seguem como o LE2-A os deixou.
- **Migration 0055 ainda não aplicada remotamente.**

---

## 31. LE2-E — a aba Candidatos no Command Center

`src/screens/radar/LeadEngineCandidatos.tsx`, montada no Command Center como aba própria `candidatos`,
rotulada **Candidatos (N)** com `N = filaDeRevisao(r).length`.

### 31.1 A fila do CSV continua separada

A aba **Fila de revisão** (linhas de importação CSV com empresa ambígua) **não foi tocada**: continua com a
mesma semântica e com o mesmo contador `res.revisoesPendentes`. São três filas de revisão distintas no Radar —
importação CSV, duplicatas e candidatos do Lead Engine — e nenhuma foi fundida.

### 31.2 A tela não é autoridade

Ela **projeta** `filaDeRevisao` / `descobertasSuprimidas` e **coleta intenção**, enviando pela porta única
`actions.processarCandidatoLeadEngine`. Nenhuma regra foi reimplementada: match, identidade forte, supressão,
fingerprint, observação desatualizada, transições e as regras de CREATE/ASSOCIATE continuam no core e são
revalidadas a cada clique. A tela **nunca recalcula o fingerprint** — devolve o `payloadFingerprint` que veio no
próprio item — e nunca manda payload bruto.

Os componentes são **puros** (sem hooks): a escolha de empresa por candidato vive no Command Center. Isso os
torna testáveis pelo walker de árvore React sem DOM, que é o padrão da Commercial UX.

### 31.3 Quatro decisões, e uma exceção

Associar (com a empresa sugerida pelo match pré-selecionada), Criar empresa, Manter em revisão e Rejeitar
(motivo obrigatório; motivo vazio não chama a action). Nenhuma decisão é automática a partir do nível do match.

Suprimidos ficam numa **seção separada e auditável** — "Descobertas suprimidas" — com uma única ação,
**Encerrar descoberta** (`TERMINALIZAR_SUPRIMIDO`). Não há Associar, Criar nem Manter em revisão ali, e a gestão
das supressões continua sendo da aba **Não contatar**.

### 31.4 Recusa vira frase, não código

`RegraLeadEngineError.motivos` é traduzido por `TEXTO_RECUSA_LEAD_ENGINE` numa frase que diz o que fazer
("Já existe uma empresa compatível. Associe o candidato à empresa existente."). Código sem tradução cai numa
mensagem segura com o código em detalhe. A tela **nunca** tenta outra ação a partir do erro.

Nota de implementação: o helper `tentar` do repositório entrega só `e.message` ao `onErro`, o que perderia os
`motivos` tipados que o LE2-C criou justamente para evitar parsing de texto. Por isso esta tela usa um
`executar` local com try/catch — o feedback continua indo para o mesmo `toast`.

### 31.5 Fronteiras

Sem score, prioridade, Commercial Queue ou cadência: back-office de entrada, não fila de vendas. Sem descoberta
real (não existe botão "Buscar CNO" — isso é o LE-3). Sem efeito externo. Sem cópia paralela da fila em estado
local: depois do commit, o `useStore` rerenderiza com o novo estado.

Core (`leadEngineReview.ts`), store (`store.ts`), persistência (`radar.supabase.ts`) e a migration 0055 ficaram
**intocados** neste gate. A migration 0055 continua **não aplicada remotamente**.

---

## 32. LE2-F — rebaseline sobre a `main` e certificação da linha LE-2

Gate de 23/09/2026. Dois blocos: incorporar a `main` vigente sem reescrever história e certificar a linha inteira
sobre o HEAD integrado. **Nada foi liberado**: sem release, sem PR, sem merge em `main`, sem migration remota, sem LE-3.

### 32.1 Rebaseline

`git merge --no-ff origin/main` em `feature/lead-engine-2`, a partir de `main @ 5e7b3be` e HEAD `5211239`
(merge-base `14d2ff7`). **Zero conflitos.** Os três commits da `main` tocam apenas Mission Control
(`quadroOperacional.ts`/`.test.ts`, `MissionControlQuadro.tsx`) e a guarda da UX-6 (`comercialUX6.test.ts`) —
nenhum arquivo de implementação do Lead Engine dos dois lados. LE-0 (`616bac3`), LE-1 (`6ec33d4`),
LE2-A (`c14b7bd`), LE2-B (`059429a`), LE2-C (`31b46cc`), LE2-E (`5211239`) e `5e7b3be` seguem todos ancestrais do HEAD.

### 32.2 Fecho de imports do núcleo

O fecho transitivo a partir de `leadEngineReview.ts` e `leadEngineIntake.ts` alcança **11 módulos**, todos em
`src/core/radar/` (`adapters`, `contatos`, `fitCalibracao`, `hash`, `ingestao`, `normalizar`, `padroes`, `score`,
`types` + os dois). **Zero pacote externo**, zero React, zero store, zero Supabase, zero `fetch`. A tela chama uma
única action (`processarCandidatoLeadEngine`) e nenhuma função mutacional do core.

### 32.3 Estado real do banco de produção — `PROD_0055_STATE = NOT_APPLIED`

Verificado por consulta **somente leitura** ao projeto `dduobppgomqyagjviwpx` em 23/09/2026.

Achado colateral: **este projeto não tem ledger de migrations** — `supabase_migrations.schema_migrations` não
existe, porque as migrations sempre foram aplicadas por `supabase db query -f`. A conferência do que está no ar
tem de ser feita pelo **schema real**, nunca por um ledger.

`radar_source_record` em produção tem só as 8 colunas da 0031 (`id`, `organization_id`, `source_id`,
`record_type`, `external_id`, `payload`, `entity_id`, `received_at`). **Nenhuma** coluna da 0055
(`payload_fingerprint`, `intake_status`, `decided_at`, `decided_by`, `decision_reason`), **nenhum** dos três CHECKs,
**nenhum** dos dois índices novos e **nenhum** trigger (`pg_trigger` não-interno devolve vazio). Não é estado
parcial: é a tabela pré-Lead-Engine intacta, com 108 linhas legadas, todas com `external_id` e `entity_id`.
Depois da 0055 essas 108 ficam com `intake_status` NULL — "fora do Lead Engine", sem backfill e sem virar
pendência, exatamente como o smoke PGlite prova.

### 32.4 Ordem de release — `MIGRATION_BEFORE_APP_DEPLOY = YES`

A ordem não é preferência, é consequência do adapter. O `db()` da spec `registrosFonte` em `radar.supabase.ts`
(LE2-A) **envia** `payload_fingerprint`, `intake_status`, `decided_at`, `decided_by` e `decision_reason` em toda
gravação. Com o app no ar antes da 0055, qualquer escrita em `radar_source_record` — a importação CSV do Radar,
que é funcionalidade viva em produção — falharia com coluna inexistente. A leitura toleraria (o `select *` não
traria as colunas), a escrita não. Logo:

1. aplicar a 0055;
2. provar o schema (colunas, 3 CHECKs, 2 índices, trigger `radar_source_record_evidencia`);
3. só então merge e deploy do app;
4. smoke de produção.

### 32.5 Certificação

Sobre o HEAD integrado, não sobre resultados anteriores: LE-1 46/46, LE2-A 23/23, LE2-B 55/55, LE2-C 29/29,
LE2-E 29/29, PGlite 0055 17/17, Mission Control e Commercial UX 94/94, suíte completa 101 arquivos e 1787 testes,
`tsc`, `eslint`, `build` e `git diff --check` verdes. Smoke funcional da jornada (29 asserções): PENDING → Candidatos →
CREATE/ASSOCIATE → RESOLVED → sai da fila, com empresa/projeto/sinal criados, uma auditoria e **zero** oportunidade,
tarefa, atividade e comunicação; suprimido → seção auditável → REJECTED/`SUPRIMIDO`; impressão velha → recusa
`CONTEXTO_MUDOU` com zero commit e zero auditoria.

---

## 33. LE2-G — a 0055 aplicada em produção

Gate de 23/09/2026, bloco do banco. A migration foi aplicada **antes** do deploy do app, pela razão registrada
em §32.4. O release do código **não** foi concluído neste gate (ver §33.4).

### 33.1 Preflight

Estado imediatamente antes da escrita, lido do schema real (este projeto não tem ledger de migrations, §32.3):
108 linhas, todas com `external_id` e `entity_id`; as 8 colunas da 0031; **zero** coluna, CHECK, índice, função
ou trigger da 0055. RLS ligada, duas policies (`radar_source_record_select`, `radar_source_record_write`),
28 grants. Nenhum estado parcial.

### 33.2 Aplicação

Artefato aplicado sem qualquer alteração:
`supabase/migrations/0055_lead_engine_intake.sql`, sha256 `1f0529b7a791e40f15b0d7145d7deec0…`, 59 linhas,
por `supabase db query --linked -f`, execução única. DDL puramente aditiva: cinco colunas anuláveis, três CHECKs,
dois índices, uma função e um trigger. Nenhum DML, nenhum DROP, nenhum backfill.

### 33.3 Prova pós-migration

Cinco colunas presentes com o tipo declarado (`payload_fingerprint` text, `intake_status` text, `decided_at`
timestamptz, `decided_by` uuid com FK para `profile`, `decision_reason` text). Os três CHECKs de intake e os dois
índices (`radar_source_record_observacao_uidx` UNIQUE parcial e `radar_source_record_intake_idx` parcial) com a
definição esperada. Função `radar_source_record_evidencia_imutavel()` e trigger `radar_source_record_evidencia`
com `tgtype = 19` (ROW + BEFORE + UPDATE) e `tgenabled = 'O'` — ativo, não apenas presente.

RLS, policies e grants **inalterados**: mesmo `relrowsecurity`, mesmas duas policies, mesmos 28 grants de antes.

Legado: as 108 linhas continuam lá, e para todas as cinco colunas novas são NULL.
`LEGACY_ROWS_PRESERVED = YES`, `LEGACY_ROWS_ENROLLED_IN_LEAD_ENGINE = NO`. Sem backfill, sem dado artificial
criado em produção para testar.

### 33.4 O app que está no ar continua íntegro

O deploy vigente é `main @ 5e7b3be`, cujo `radar.supabase.ts` marca `registrosFonte` como `imutavel: true`:
só insert e delete, **nunca** UPDATE. Logo o trigger `BEFORE UPDATE` não pode disparar para ele, e seus inserts
omitem as cinco colunas novas, o que deixa `intake_status` NULL e satisfaz os três CHECKs por construção
(todos são `intake_status is null or …`). O índice único é parcial em `payload_fingerprint is not null`, fora do
alcance do app antigo. É a mesma linha legada que o smoke PGlite já cobria.

### 33.5 O release do código

O PR desta sessão não pôde ser aberto por falta de credencial do GitHub (`gh` não autenticado, sem `GH_TOKEN`;
o push funciona pelo Credential Manager do Windows, que não é fonte de token para a API). O **PR #9** foi aberto
fora desta sessão e mesclado em `main` com `EIFF Quality Gate` e o Deploy Preview do Netlify verdes, sob a
frase-senha `MERGE AUTORIZADO`.

```
MIGRATION_0055  = PASS       PR #9      = merged
PROD_0055_STATE = APPLIED    main       = 0273da87…
LE2_DB_READY    = YES        LE2_STATUS = RELEASED
```

A ordem projetada em §32.4 foi cumprida: migration antes do deploy do app. A descoberta automática **continua
desligada** — sem CNO, PNCP, Vibe, notícias ou scheduler. O Lead Engine está pronto para receber candidatos,
mas ainda não varre fonte nenhuma; isso é o LE-3, que começa no §34.

---

## 34. LE3-A — contrato da fonte oficial do CNO e leitor de snapshot

Gate de 23/09/2026, na branch `feature/lead-engine-3` (worktree próprio, a partir de `main @ 0273da8`).
Entrega o **contrato** da primeira fonte real do Lead Engine e um leitor de snapshot. **Nada é ingerido**:
zero candidato criado, zero escrita no Radar, zero Supabase, zero migration.

### 34.1 A fonte, auditada e não presumida

```
landing      https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-de-obras-cno
dados        https://arquivos.receitafederal.gov.br/index.php/s/PC6732BXG9B98W3  -> cno.zip
dicionario   https://arquivos.receitafederal.gov.br/index.php/s/XEa8aE7wJdMGzkE  -> cno-metadados.pdf
modo         SNAPSHOT completo (nao ha API de consulta nem endpoint incremental)
licenca      Creative Commons Attribution
```

Origem **exclusivamente** Dados Abertos. `CNO_DISCOVERY_SOURCE = RECEITA_OPEN_DATA`,
`CNO_ECAC_SCRAPING = FORBIDDEN`, `CNO_GOVBR_CREDENTIALS = NONE` — o e-CAC mostra as obras *do usuário*, não a
base pública de descoberta, e nada aqui usa sessão, certificado ou credencial.

`cno.zip` em 23/09/2026: `application/zip`, **330.628.581 bytes**, `Last-Modified: Sat, 12 Sep 2026 04:59:45 GMT`,
`ETag "76bb7f934f457be4234c5733ee92b40b"`. O servidor honra `Range`, então o índice do ZIP é lido sem baixar o
arquivo. Cinco membros, **1,41 GB de CSV cru**:

| arquivo | bruto | comprimido |
|---|---|---|
| `cno.csv` | 842,6 MiB | 260,2 MiB |
| `cno_areas.csv` | 360,0 MiB | 34,8 MiB |
| `cno_cnaes.csv` | 120,3 MiB | 15,7 MiB |
| `cno_vinculos.csv` | 22,0 MiB | 4,6 MiB |
| `cno_totais.csv` | 127 B | 82 B |

Totais declarados pela própria fonte: **3.604.156 obras**, 3.942.713 CNAEs, 4.553.076 áreas, 431.211 vínculos.

**Periodicidade: declarada ≠ observada.** O catálogo diz `DIARIA` e registra
`ultimaAtualizacaoDados = 2024-11-04`, e a página marca o conjunto como "Desatualizado" — mas o artefato real
tem `Last-Modified` de **12/09/2026**. As duas informações do portal estão erradas: ele não consegue ler o
header através do redirect 303 do Nextcloud. Uma sondagem única não prova cadência; o que se pode afirmar é que
o snapshot vivo não é diário (11 dias no momento da auditoria) e que **`ETag` + `Last-Modified` são a única
base confiável** para detectar snapshot novo. A cadência real só sai de observação repetida — trabalho do LE3-B.

### 34.2 Onde o artefato vence a documentação

Quatro divergências reais entre o dicionário oficial e o arquivo publicado. Em todas vale o arquivo:

1. os membros são **minúsculos** (`cno.csv`), não `CNO.CSV`;
2. o separador é **vírgula**, não ponto-e-vírgula;
3. o encoding é **ISO-8859-1**, sem BOM, terminador LF — não UTF-8;
4. Categoria, Destinação, Tipo de obra e Tipo de Área vêm como **texto** ("Obra Nova"), embora o dicionário os
   descreva como códigos ("0 - Obra Nova").

E o cabeçalho oficial tem acentuação **inconsistente** — `Código do Pais`, `Nome do pais`,
`Data de inicio da responsabilidade`, `Qualificação do responsavel`, `Código do municipio` × `Nome do município`.
As constantes copiam isso literalmente; "corrigir" quebraria a leitura. O `cno.csv` real tem ainda duas colunas
que a documentação não lista na mesma forma: `Caixa Postal` e `Código de localização` (esta é um **plus code**).

### 34.3 O tipo canônico

`CnoObservacaoCanonica` em `src/core/radar/cnoDadosAbertos.ts` é a projeção normalizada da linha oficial.
A ponte completa é `CSV oficial -> evidência + canônica -> envelope -> adapterCNO -> PedidoIntake` (§34.12). Núcleo **puro**: sem rede, sem `fs`, sem React,
sem store, sem Supabase, sem variável de ambiente; importa só `./leadEngineIntake` (tipo) e `./normalizar`.

**`Nome` é o nome DA OBRA; `Nome empresarial` é a razão social da PJ.** Nunca se confundem, e isso está preso
por teste em três camadas (parser, payload, adapter). O campo `Nome` traz a string **literal `null`** em 3.653
de 44.254 linhas amostradas (8,3%) — `textoCno` trata como ausência, senão "null" viraria nome de obra no Radar.

### 34.4 Identidade e pessoa física

O dicionário garante que `NI do responsável` fica em branco quando o responsável é CPF, e a amostra real
confirma com correlação perfeita: **9.178 linhas com NI — todas com 14 dígitos e DV válido — e 35.076 sem NI,
todas também sem nome empresarial**. Zero casos mistos.

Logo: CNPJ válido → identidade forte possível; CPF/NI ausente → **nunca** se inventa CNPJ, nunca se inventa
empresa, e `razaoSocial` jamais é preenchida com o nome da obra. A obra sem PJ continua sendo descoberta bruta
legítima — o LE3-A não promove nada de qualquer forma. A validação reusa `normalizarCnpj`, o validador único do
Radar: não existe segundo validador no sistema.

`externoId = número do CNO` (12 dígitos, string, zero à esquerda significativo). Nunca CNPJ, nome da obra, hash
da linha ou posição no arquivo. O fingerprint continua sendo o do LE-1 sobre o payload canônico, então
**mesmo CNO + payload igual → `IDEMPOTENT_NOOP`; mesmo CNO + payload diferente → `NOVA_OBSERVACAO`**, sem jamais
sobrescrever a observação anterior.

### 34.5 Códigos congelados

`Situação` (do dicionário): `01` NULA · `02` ATIVA · `03` SUSPENSA · `14` PARALISADA · `15` ENCERRADA.
Na amostra real: 15 domina com 83,6%, 02 com 12,9%.

`Qualificação do responsável`: `0053` Pessoa Jurídica Construtora · `0057` Dono da Obra ·
`0064` Incorporador de Construção Civil · `0070` Proprietário do Imóvel · `0109` Consórcio ·
`0110` Construção em nome coletivo · `0111` Sociedade Líder de Consórcio. São **atributos de fonte**, não filtro
comercial: qualquer política de seleção por qualificação vem depois e explícita.

Áreas: 5 categorias, 7 destinações, 3 tipos construtivos (Alvenaria/Madeira/Mista), 2 tipos de área.
Atenção ao nome: **"Tipo de obra" do CNO_AREAS é o método construtivo**, não a natureza da obra — confundir os
dois inverte a leitura inteira.

### 34.6 Política de sinal — estrutural, não textual

```
Obra Nova              -> CNO_NEW
Acrescimo · Reforma    -> CNO_EXPANSION
Demolicao · Existente  -> nenhum sinal
sem area / categoria desconhecida -> nenhum sinal
```

Um CNO costuma ter várias áreas (36.852 de ~90 mil na amostra). Precedência declarada: qualquer `Obra Nova`
vence; senão Acréscimo/Reforma viram expansão; senão não há sinal. Ausência de evidência não vira evidência —
preferimos nenhum sinal a um sinal errado, e o bruto fica preservado de qualquer modo.

### 34.7 Data do evento

Precedência explícita: `dataInicio` → `dataRegistro` → `dataSituacao` → `SEM_EVENTO_DATADO`.
Sem data oficial **não se produz sinal**. O adapter antigo caía em `new Date()`, o que dataria de hoje uma obra
de 1992 — para dado histórico do CNO isso é fabricação de evento.

### 34.8 O que mudou no `adapterCNO`

Três ajustes mínimos, todos ao contrato real:

1. `nome` saiu da cadeia da razão social (era o quarto fallback, e transformava nome de obra — ou "null" — em conta);
2. `tipoSinal` explícito vence a heurística de regex; a regex sobrevive só para payload genérico sem o campo;
3. sem data oficial não há sinal, no lugar do fallback para hoje.

### 34.9 O leitor de snapshot

`scripts/cno.mts` (fora do core, com `vite-node` como os demais scripts do repositório):
`probe`, `validar`, `amostra --limite N`, `baixar --destino`. Host **único** permitido, fail closed; sem
credencial e sem cookie; timeout de 120 s, no máximo 5 redirects, User-Agent identificável, arquivo temporário
com limpeza em falha. Tudo em streaming — o índice do ZIP vem por `Range` e cada membro é inflado só até a
janela pedida, então a amostra nunca toca os 315 MiB. `.gitignore` recusa `cno.zip`, `cno*.csv`,
`cno-metadados.pdf` e `dados/cno/`: **o dataset público não entra no repositório**.

Privacidade: CNPJ sai mascarado, CPF nunca é reconstruído e, quando não há PJ identificada, o relatório **omite
o campo `Nome`** — ali ele costuma trazer o nome da pessoa física. As fixtures dos testes são sintéticas.

### 34.10 Prova contra a fonte real

`validar` contra o snapshot vivo: os cinco cabeçalhos batem exatamente com as constantes
(`CNO_SNAPSHOT_VALIDACAO = PASS`). `amostra --limite 5` produziu 5 observações canônicas e 5 `PedidoIntake`,
sem persistir nada, e exercitou os casos que importam: `Existente + Reforma -> CNO_EXPANSION`,
`Demolição + Existente + Obra Nova -> CNO_NEW` (a demolição não derruba a precedência) e uma obra de pessoa
física corretamente sem PJ.

Suíte `cnoDadosAbertos.test.ts`: 56 testes. Fronteiras verificadas por varredura do próprio arquivo — sem rede,
sem `fs`, sem ambiente, sem store, sem React, sem Supabase, sem score, sem Commercial Queue, sem cadência e sem
oportunidade, tarefa, atividade ou comunicação.

### 34.11 O que este gate deliberadamente não fez

Sem descoberta real ligada, sem scheduler, sem ingestão, sem política comercial de seleção (nada de filtro por
UF, município, área mínima, destinação ou porte — isso é gate próprio). PNCP, RFB, Vibe e notícias não foram
tocados. `LE3_B` ainda não começou.

### 34.12 LE3-A1 — evidência da fonte separada da projeção canônica

Correção de um defeito real da primeira versão do LE3-A: `RegistroFonte.payload` levava **só**
`payloadCno(obs)`, a projeção normalizada. Normalização é uma **leitura** do dado, não o dado — e ali a origem
se perdia. Três perdas concretas, todas medidas no snapshot real:

| o que a fonte entregou | o que sobrava |
|---|---|
| `Nome = "null"` (literal, 8% das linhas) | nada — `textoCno` descarta |
| `NI = "11.222.333/0001-81"` | só `11222333000181` |
| coluna que a EIFF ainda não projeta | nada |

Agora `RegistroFonte.payload` é um **envelope** com versão declarada:

```
{ schema: 'CNO_OPEN_DATA_V1', evidence: { obra, areas, cnaes, vinculos }, canonical: {...} }
```

`evidence` é a linha como a fonte entregou — nome real da coluna, valor textual, string vazia, `"null"`
literal, código original, data como texto, NI original e qualquer coluna ainda não usada (`linhaComoObjeto`;
célula além do cabeçalho vira `#<índice>`, porque sobra de parsing também é evidência). O único tratamento é a
decodificação determinística ISO-8859-1 → string: o valor depois de decodificar é igual ao da célula antes de
normalizar. A ordenação determinística vale para os dois lados, e a linha bruta `i` continua sendo a origem da
canônica `i`.

**Proveniência de snapshot fica de fora, de propósito.** `ETag`, `Last-Modified`, quando baixamos, caminho
temporário e posição no ZIP não entram no envelope: qualquer um deles faria o mesmo CNO, com os mesmos dados,
gerar impressão nova a cada leitura e destruiria a idempotência que o LE-1 existe para garantir. Isso é
verificado por teste, junto com o fato de que dois `recebidoEm` diferentes dão o mesmo fingerprint — reler o
mesmo snapshot amanhã é `IDEMPOTENT_NOOP`, não observação nova. O algoritmo global `payloadFingerprint` não foi
tocado; mudou só o objeto que o CNO entrega a ele. Mudança real em qualquer célula — inclusive numa que o
canônico descarta — muda a impressão, porque a evidência mudou de verdade.

O `adapterCNO` normaliza a partir de `canonical` sob **guarda de versão** (`schema` não reconhecido não é lido
como payload plano; o formato antigo continua funcionando sem ambiguidade), e a **linhagem continua recebendo o
envelope inteiro** — `adapterCNO` devolve `payload: bruto` e o LE2-B repassa `bruto.payload` ao sinal, então a
evidência chega lá. A assinatura de `pedidoIntakeCno` passou a exigir a observação completa, então entregar só
o canônico ao intake virou **erro de tipo**, não convenção.

`scripts/cno.mts` continua com zero persistência e **não imprime a evidência** — preservar não é logar. Só a
contagem: `evidencia: obra=1 areas=N cnaes=N vinculos=N`.

Suíte: 73 testes (56 do LE3-A + 17 desta correção).

# CD-D3 / E3 — livro imutável de desfechos (§19.9)

> Seção 19.9 do `docs/commercial-director-1.0.md`, em arquivo próprio enquanto o PR #59 (documentação da E2) está aberto e
> mexe no fim daquele documento. Depois do merge do #59, esta seção é incorporada lá.

O realizado da meta comercial (motor E1, `src/core/radar/metaComercial.ts`) passa a ser lido de **fatos imutáveis**, não do
estado atual das oportunidades. O livro produz exatamente o contrato `EventoDesfecho` que o motor já lê; nenhuma fórmula da
E1 mudou.

## Eventos

| Evento | Quando | O que congela | Valor |
|---|---|---|---|
| `GANHO` | a oportunidade entra em WON (mudança de estágio ou criação já ganha) | oportunidade, organização, empresa, responsável (`owner_id`), dono da conta (`radar_company.commercial_owner_id` naquele instante), autor (`auth.uid()`), instante, estágio de origem e motivo | o **valor fechado confirmado** (`won_amount`), quando houver; vazio = ganho sem valor (incompleto, sinalizado) |
| `ESTORNO_GANHO` | a oportunidade ganha sai de WON (reabertura ou LOST) | cita o ganho vigente (`won_event_id`); herda empresa, responsável e dono do ganho | nenhum (o motor usa o do ganho); conta no mês em que ocorreu (D3-A) |
| `COMPLEMENTO_VALOR` | operação governada sobre um ganho registrado sem valor | cita o ganho; herda empresa, responsável e dono | obrigatório; corrige o mês do ganho sem apagar nada (D3-B) |

`estimated_value` **nunca** vira valor de venda. O valor fechado é um campo próprio (`radar_opportunity.won_amount` /
`Oportunidade.valorFechado`), informado só ao marcar como ganha.

## Autoridade do banco (migration 0070, aplicada em produção em 14/10/2026)

> Aplicada entre 18:03:13 e 18:03:18 UTC, arquivo `supabase/migrations/0070_radar_commercial_outcome.sql` da `main`
> aefb81b (PR #67), SHA-256 `488841280a320e1d592100e7331971251aadeaa8573a169677a68fb23630863e`, numa única transação com
> 28 verificações internas. Detalhes em "Plano de implantação", passo 4.

- **Tabela** `radar_commercial_outcome` (append-only). Escrevem só:
  - o gatilho `radar_opportunity_desfecho` (AFTER INSERT/UPDATE OF stage, security definer), na **mesma transação** da
    mudança de estágio — se o evento falhar, a mudança de estágio falha junto;
  - a RPC `radar_complementar_valor_ganho(p_ganho, p_valor, p_motivo)`, só para Administrador e Diretoria (`radar_config`).
- **Sem duplicidade**: WON → WON não é transição (regravar, reenvio da fila offline, duas sessões — a trava de linha do
  UPDATE serializa e a segunda já vê WON); um estorno e um complemento por ganho (índices únicos parciais); o gatilho de
  coerência recusa GANHO com ganho vigente e evento que não cite o ganho original da mesma oportunidade e organização.
- **Reabrir e ganhar de novo** funciona: GANHO → ESTORNO → GANHO, o vigente é o mais recente.
- **Instante do evento** = do banco, pela **guarda temporal** (seção abaixo): estritamente maior que o último evento da
  mesma oportunidade, em microssegundos. A hora do aparelho não decide o mês. `closed_at` continua sendo o que o app grava.
- **Oportunidade ganha travada** (gatilho `radar_opportunity_ganho_travado`, para qualquer papel): valor fechado, valor
  estimado, empresa, organização, data de fechamento e responsável (se havia) não mudam enquanto ganha; corrigir = reabrir
  com motivo. Fora de WON o valor fechado é limpo pelo banco; CHECKs: `won_amount` > 0, ≤ R$ 1 trilhão e só em WON.
- **Histórico imutável**: UPDATE, DELETE e TRUNCATE no livro recusados para qualquer papel; oportunidade com eventos não
  pode ser apagada (FK `on delete restrict`).
- **Permissões**: RLS de leitura por organização (`current_org()`); `authenticated` só SELECT; `anon` nada; EXECUTE da RPC
  só para `authenticated` (a função confere perfil ativo e papel).
- **Hardening**: as cinco funções fixam `search_path = pg_catalog, pg_temp` e qualificam tudo o que leem e gravam.
- **Auditoria**: cada evento grava `audit_log` (`radar_desfecho_ganho`, `radar_desfecho_estorno`,
  `radar_complementar_valor_ganho`) na mesma transação; o `audit_row` genérico da oportunidade continua valendo.
- **Sem backfill**: oportunidade ganha antes da 0070 não ganha evento fabricado; se for reaberta, nenhum estorno é criado
  (não há ganho a estornar). Produção tinha 0 oportunidades no pré-check de 14/10/2026.
- **Rollback exato**: `supabase/rollbacks/0070_radar_commercial_outcome.rollback.sql` (apaga o livro e a coluna
  `won_amount`: exportar antes se já houver eventos reais).

## Hardening pré-merge (14/10/2026)

- **Livro indisponível = WON bloqueado** (código publicado, banco ainda sem a 0070): criar já ganha, marcar como ganha
  (com ou sem valor) e reabrir/perder uma ganha são recusados no store com mensagem clara, sem mudar nada
  (`MENSAGEM_LIVRO_INDISPONIVEL`). Não existe a alternativa "ganha sem valor" nesse estado. Transições sem WON seguem.
- **Gatilho privilegiado**: EXECUTE revogado de `public`, `anon`, `authenticated` e `service_role` nas quatro funções de
  gatilho (o PostgreSQL só confere EXECUTE no CREATE TRIGGER; o gatilho existente continua disparando), e as funções recusam
  rodar fora de `public.radar_opportunity` (`tg_relid`; a dos desfechos também exige AFTER/ROW). Provado com tabela
  temporária de mesmo formato: `authenticated` não consegue criar o gatilho, e nem o dono do banco consegue usá-lo noutra
  tabela; nada entra no livro. O livro também ficou sem escrita para `service_role` (só SELECT).
- **Responsável travado** inclusive de vazio para alguém enquanto ganha.
- **Motivo obrigatório e novo** para entrar ou sair de WON: coluna `radar_opportunity.stage_reason` (motivo da última
  mudança de estágio, 3 a 500). Escrita direta que só troca o estágio (reaproveitando o motivo anterior) ou repete o motivo
  é recusada; fora de uma transição o motivo não muda. O motivo vai para o GANHO, o ESTORNO e as respectivas auditorias
  (todo evento do livro passou a exigir motivo). No app: `Oportunidade.motivoEstagio`, gravado por `aplicarTransicao` e
  validado em `motivosRecusaTransicao` (3 a 500, diferente do anterior).
- **Ordem no tempo**: o PostgreSQL grava microssegundos e GANHO → ESTORNO → GANHO podem cair no mesmo milissegundo; com
  milissegundos o motor E1 empatava e o desempate por tipo/id perdia a ordem real (reproduzido: o primeiro ganho virava
  "repetido" e o estorno ficava sem ganho). Menor correção: `instanteEmMicros` só para ORDENAR e comparar no
  `lerLivroDesfechos`; a fração além do milissegundo é truncada (nunca arredondada) em `instanteEmMs`; o mês comercial e
  todas as fórmulas seguem iguais (os 34 testes da E1 passam sem mudança). Virada de mês em São Paulo testada com
  microssegundos.

## Guarda temporal (14/10/2026, antes de aplicar a 0070)

O gate em PostgreSQL 17.6 real mostrou que `clock_timestamp()` **não** garante instantes distintos (resolução de 1 µs;
em 20.000 chamadas seguidas, ~19.000 empates) e que um relógio que **recua** (passo de NTP) poderia pôr um novo GANHO antes
do ESTORNO anterior — o motor E1 acusaria GANHO_REPETIDO. A 0070 passou a ter uma guarda transacional:

- **Serialização por oportunidade, sempre na mesma ordem de travas: oportunidade → ganho.** O gatilho de coerência do livro
  (`radar_commercial_outcome_coerencia`, roda em TODO evento: GANHO, ESTORNO_GANHO e COMPLEMENTO_VALOR) trava a linha da
  oportunidade (`FOR NO KEY UPDATE`; no UPDATE de estágio ela já está travada). A RPC de complemento trava a oportunidade
  ANTES da linha do ganho (antes travava só o ganho, e o fazia antes de conferir a organização). Com uma ordem única não há
  deadlock: rajada mista de 8 sessões (complemento × reabrir × ganhar no mesmo ganho) passou sem nenhum.
- **Instante** = `radar_desfecho_instante(relógio, último)` (função do banco, `search_path` fixo, sem EXECUTE para papéis
  da API), aplicada no INSERT — o instante informado é ignorado. Critério adotado:
  - sem evento anterior, ou relógio à frente do último: o próprio relógio;
  - relógio igual ao último ou **até 1 s** atrás (regressão imaterial: empate de microssegundo, ajuste fino): **último + 1 µs**,
    desde que o evento continue no **mesmo mês comercial (America/Sao_Paulo)** que o relógio indica;
  - relógio **mais de 1 s** atrás (regressão material) ou deslocamento que levaria o evento a **outro mês comercial**: **recusa
    explícita** ("o relógio do banco está … atrás do último evento desta oportunidade; nada foi gravado") e a transação
    inteira é desfeita — inclusive a mudança de estágio. Nada é empurrado artificialmente para outro mês; o histórico fica
    intacto e a operação pode ser repetida quando o relógio voltar a andar.
- Nada muda em evento já gravado nem nas fórmulas do E1. O modo local (espelho em `src/core/radar/desfechos.ts`) segue com
  +1 ms sobre o último, sem relógio de servidor.

## Isolamento entre organizações (verificação final, 14/10/2026)

Achado: as FKs `radar_opportunity.company_id → radar_company` e `owner_id → profile` não conferem organização, o PostgreSQL
valida FK sem RLS e a policy da oportunidade só confere a organização da própria linha. Antes da correção, um Administrador
da organização A (que nem enxerga a empresa da B) conseguia **criar** e **alterar** oportunidade de A citando a empresa da B
ou um responsável da B — e o gatilho privilegiado da 0070 gravava o GANHO no livro de A com a empresa e o **dono comercial da
B**. Correção mínima na própria 0070 (nenhuma migration anterior alterada): o gatilho `radar_opportunity_desfecho`, agora em
toda gravação da oportunidade (`after insert or update`), exige empresa e responsável da mesma organização ANTES de qualquer
evento (falha = a gravação inteira é desfeita); a coerência do livro repete a regra para empresa, responsável e dono da conta
do GANHO. Provado no smoke (bloco R, 12 provas, inclusive tentativa do dono do banco e o ganho legítimo seguindo normal).

## App

- `RadarDataset.desfechos?` (ausente = livro indisponível no banco, nunca "sem ganho"); carga tolerante em `carregarRadar`
  (`eventoDoBanco`). O app **nunca** grava GANHO nem ESTORNO; o complemento vai pela RPC (`persistirDesfechos`).
- `won_amount` só é enviado quando o livro existe (`HelpersRadar.desfechos`): o código pode ser publicado antes da 0070.
- **E0 ajustado**: `DadosTransicao.valorFechado` (validado: positivo, até 2 casas, até o teto; só para WON);
  `aplicarTransicao` não grava mais o valor da transição no estimado quando o destino é WON — grava `valorFechado`, que some
  ao sair de WON; `CAMPOS_TRAVADOS_GANHO` inclui `valorFechado`; `camposEditaveis` nunca aceita valor fechado do formulário.
- `src/core/radar/desfechos.ts`: espelho do gatilho para o modo local (`eventosDaTransicao`, `ganhoVigente`) e as regras do
  complemento (`motivosRecusaComplemento`, `complementoDoGanho`); `ganhosDaOportunidade` lê pelo mesmo motor da meta.
- Store: `mudarEstagioRadar`/criação geram os eventos só no modo local; `complementarValorGanhoRadar` (radar_config).
  Livro indisponível + valor fechado informado = recusa (o valor não se perde em silêncio).
- Formulário da oportunidade: "Valor fechado confirmado (R$)" ao marcar como ganha (vazio por padrão, nunca preenchido com o
  estimado); ganha mostra o ganho do livro e, se sem valor, "Completar valor do ganho" para Administrador e Diretoria.
  Sem tela de metas (E5) nem retrato (E4).

## Provas

| Prova | Resultado |
|---|---|
| `npm run smoke:desfechos` (fila inteira em PGlite, passo do Quality Gate; bloco T = guarda temporal) | 120 ok, 0 falhas |
| Preflight `--ordem-corrigida` | 72 migrations, 0 erros |
| Gate em PostgreSQL 17.6 real (14/10/2026, versão com a guarda; ordem numérica × ordem de produção com a 0073; concorrência com sessões independentes; relógio avançando, empatando e recuando; virada do mês em SP; atomicidade; isolamento; motor E1 sobre o livro gerado) | 41 ok, 0 falhas |
| `src/data/radar.desfechos.integracao.test.ts` — app → banco → app com `carregarRadar`/`persistirRadar` reais, RLS de produção (inclui GANHO → ESTORNO → GANHO numa só transação) | 4 ok |
| `src/core/radar/desfechos.test.ts` — espelho do gatilho + integração com o motor E1 (D3-A, D3-B, linha do banco, microssegundos no mesmo ms, virada de mês em SP) | 16 ok |
| `src/data/radar.desfechos.store.test.ts` — formulário → store, permissões, livro indisponível (WON bloqueado), motivo novo, guardas de fonte | 11 ok |
| Suíte completa | 156 arquivos, 2863 testes |

## Riscos e itens de gate

1. **Concorrência real** não roda no PGlite: foi provada em PostgreSQL 17.6 real (gate de 14/10/2026, refeito na versão com
   a guarda temporal). A garantia é a trava da linha da oportunidade (tomada primeiro por todo evento) + os índices únicos do
   estorno/complemento + o gatilho de coerência.
2. **Mudança de comportamento da E0**: o valor digitado ao marcar como ganha deixa de ir para o estimado e vai para o valor
   fechado. Pedido explícito da E3 ("não usar `estimated_value` como valor de venda"), mas é divergência do que a E0 gravava.
3. **Instante do evento ≠ `closed_at`** quando o aparelho estava com a hora errada ou sincronizou depois (fila offline): o
   livro usa a hora do banco. Na virada do mês pode cair no mês seguinte ao que a tela mostra como fechamento.
   **Relógio do banco recuando mais de 1 s** (ou a menos de 1 µs da virada do mês) recusa a mudança de estágio/complemento
   daquela oportunidade até o relógio passar do último evento — decisão consciente: recusar em vez de datar errado.
4. **Apagar oportunidade com eventos** passa a falhar (FK restrict) — intencional; o app não apaga oportunidades hoje.
5. **Achado fora da E3** (registrado como tarefa separada): `current_org`, `has_role` e outras funções da 0003, e o
   `audit_row` da 0001, são security definer sem `search_path` fixo e podem ser desviadas por tabela temporária de mesmo
   nome. Pela API do Supabase não há como criar tabela temporária, então o risco é baixo, mas merece endurecimento.

## Plano de implantação (cada passo com autorização própria) — concluído em 14/10/2026

1. `MERGE AUTORIZADO` — **concluído**: PR #61 (E3) e PR #67 (guarda temporal na 0070) mesclados; a `main` aefb81b tem a
   versão aplicada da 0070.
2. `PRODUCTION AUTORIZADA` — **concluído**: o código do #61 foi publicado junto com o PR #64 (deploy 6acfa635, `main`
   28d10f6, publicação travada), antes da 0070, como previsto abaixo. Código primeiro. Sem a 0070 o app carrega normalmente e não envia `won_amount` nem
   `stage_reason`, mas **marcar como ganha (com ou sem valor), criar já ganha e reabrir/perder uma ganha ficam BLOQUEADOS**
   com mensagem clara até a 0070 ser aplicada (o ganho ou o estorno não teriam onde ser registrados). As demais transições
   e edições seguem normalmente. Produção tinha 0 oportunidades no pré-check, então o bloqueio não afeta trabalho em curso;
   a janela entre publicar e aplicar a 0070 deve ser curta.
3. Teste de concorrência com duas sessões num PostgreSQL real (gate, como na 0068) — **concluído**: gate em PostgreSQL
   17.6 PASS (14/10/2026, refeito na versão com a guarda temporal; 41 ok, 0 falhas).
4. Conferência só de leitura (objetos ausentes, número livre, 0068/0069 íntegras) e aplicação da 0070 numa transação com
   verificações internas; smoke em produção só com recusas, sem criar eventos reais — **concluído em 14/10/2026**:
   - aplicada entre **18:03:13 e 18:03:18 UTC**, arquivo da `main` aefb81b (PR #67), SHA-256
     `488841280a320e1d592100e7331971251aadeaa8573a169677a68fb23630863e`, numa **única transação com 28 verificações
     internas**;
   - pós-check: livro (`radar_commercial_outcome`) vazio, **49 itens de schema novos** e nenhum outro alterado, contagens das
     tabelas e `audit_log` (máx. 1634) iguais aos de antes;
   - smoke em produção: **12 recusas** em transação descartada (nenhum evento real criado);
   - o app publicado (deploy 6acfa635, `main` 28d10f6, trava ativa) lê `radar_commercial_outcome` com **200**: o livro
     está disponível e as transições de/para WON deixaram de ser bloqueadas (`MENSAGEM_LIVRO_INDISPONIVEL` só volta a
     aparecer se o livro não puder ser lido).

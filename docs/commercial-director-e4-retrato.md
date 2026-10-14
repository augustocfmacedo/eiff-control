# CD-D3/E4 — Retrato comercial canônico (CD-1.3)

Parte da CD-D3 (meta comercial) do Commercial Director (`docs/commercial-director-1.0.md` §19). Arquivo próprio para não
conflitar com o PR #59 (§19.8 da E2); quando o #59 entrar, este conteúdo vira a §19.10 do documento principal.

## O que muda

`snapshotComercialCD(radar, hoje, opcoes)` (`src/core/radar/commercialDirector.ts`) sobe de **CD-1.2** para **CD-1.3** e
ganha o bloco **`metaComercial`**: o resultado comercial do mês, composto **exclusivamente** pelo motor E1
(`apurarMetaComercial`, `src/core/radar/metaComercial.ts`) sobre as metas versionadas da E2
(`RadarDataset.metasComerciais`, tabela `radar_commercial_goal`, 0068) e o livro imutável de desfechos da E3
(`RadarDataset.desfechos`, tabela `radar_commercial_outcome`, 0070). Todos os outros blocos (fila, base, decisores,
atividade, funil, prospecção, qualidade, Inbox) ficam **idênticos** ao CD-1.2 — provado contra um golden gerado com o
código do CD-1.2 (`src/core/radar/__fixtures__/cd-1.2-snapshot.json`).

Sem tela, sem persistência de snapshot, sem escrita, sem LLM, sem consulta ao Financeiro. A experiência executiva e a
interface de metas são da E5.

## Entrada

| Opção | Papel |
|---|---|
| `agoraIso` | **instante de referência explícito** (ISO com fuso). O mesmo já usado pelo SLA do Inbox. Sem ele — ou com só uma data civil — o bloco inteiro sai `DADO_INSUFICIENTE`. Nenhuma leitura de relógio. |
| `mesComercial` | mês `AAAA-MM` apurado. Padrão: o mês de `agoraIso` em `America/Sao_Paulo`. Mês inválido é recusado. |

## Contrato do bloco `metaComercial`

| Campo | Conteúdo |
|---|---|
| `versaoRegras` | versão das regras do motor E1 (`CD-D3-1.0`) |
| `mes`, `situacao`, `vistoEm` | mês apurado, `FUTURO`/`CORRENTE`/`ENCERRADO` e o instante de referência (como o E1 devolve) |
| `disponibilidade` | `{ instante, metas, livro }` — o que estava disponível para a apuração |
| `metaVigente` | `{ estado, id?, versao? }` da versão de meta que vale no mês (`VIGENTE`, `RETIRADA`, `AUSENTE`, `INVALIDA`); ausente quando as metas não foram carregadas |
| `medidas` | 14 medidas `MedidaComercial` (abaixo) |
| `retificacoes` | complementos que retificaram o mês (D3-B), como o E1 devolve |
| `alertas` | alertas do E1 (`META_AUSENTE`, `META_RETIRADA`, `META_INCONSISTENTE`, `GANHOS_SEM_VALOR`, `ESTORNOS_SEM_VALOR`, `ESTORNO_NO_MES`, `RETIFICACAO_POR_COMPLEMENTO`, `META_ATINGIDA`, `META_NAO_ATINGIDA`, `EVENTOS_INCONSISTENTES`) |
| `inconsistencias` | `{ metas, eventos }` do E1 |

### Medidas (todas com `autoridade: 'META_COMERCIAL'`)

As 12 primeiras são **o objeto devolvido pelo E1, sem alteração** (mesmo id, definição, unidade, estado, valor e motivo);
as duas últimas são contagens do que o E1 já devolve.

| Chave | id | Unidade | O que é |
|---|---|---|---|
| `meta` | `meta.valor` | BRL | meta comercial vigente do mês |
| `ganhos` | `meta.ganhos` | OPORTUNIDADES | quantidade de ganhos do mês |
| `ganhosSemValor` | `meta.ganhosSemValor` | OPORTUNIDADES | ganhos sem valor confirmado nem complemento |
| `valorGanhos` | `meta.valorGanhos` | BRL | **receita ganha confirmada** (com complementos) |
| `estornos` | `meta.estornos` | OPORTUNIDADES | estornos ocorridos no mês |
| `estornosSemValor` | `meta.estornosSemValor` | OPORTUNIDADES | estornos de ganho sem valor confirmado |
| `valorEstornos` | `meta.valorEstornos` | BRL | valor dos ganhos estornados no mês |
| `realizadoConfirmado` | `meta.realizadoConfirmado` | BRL | ganhos − estornos com valor conhecido (piso; pode ser negativo) |
| `realizado` | `meta.realizado` | BRL | **realizado líquido** exato (só DISPONIVEL sem ganho/estorno sem valor) |
| `atingimento` | `meta.atingimento` | RAZAO | realizado ÷ meta (sem a amostra mínima de 30) |
| `faltaParaMeta` | `meta.faltaParaMeta` | BRL | valor faltante (zero quando atingida) |
| `excedente` | `meta.excedente` | BRL | valor excedente (zero quando não atingida) |
| `retificacoes` | `meta.retificacoes` | EVENTOS | ganhos do mês com valor complementado depois; base = ganhos do mês |
| `eventosInconsistentes` | `meta.eventosInconsistentes` | EVENTOS | eventos do livro, até o instante de referência, desconsiderados pelo E1; **sem base** (o E1 não devolve quantos eventos considerou e recontar seria recriar a leitura dele; eventos posteriores a `agoraIso` não entram) |

`EVENTOS` entrou no catálogo `UNIDADES_MEDIDA` (`commercialMetrics.ts`), sem mudar nenhuma outra unidade ou regra.

## Regras (sem inventar números)

- **Meta ausente não vira meta zero**: `meta.valor` sai `DADO_INSUFICIENTE` ("sem meta definida para o mês"); retirada,
  "meta retirada (versão N)".
- **Livro indisponível ≠ livro vazio**: `desfechos` ausente (tabela não carregada) → toda medida do livro sai
  `DADO_INSUFICIENTE` ("livro de desfechos não carregado neste contexto: livro indisponível não é ausência de vendas");
  `desfechos: []` → zero eventos, medidas `DISPONIVEL` 0 e os alertas do E1 exatamente como ele os dá. Sem livro carregado,
  só sobrevivem os alertas da DEFINIÇÃO da meta (`META_AUSENTE`, `META_RETIRADA`, `META_INCONSISTENTE`): nunca
  `META_ATINGIDA`/`META_NAO_ATINGIDA` (num mês encerrado com meta válida o E1, alimentado com zero eventos, diria "não
  atingida" — falso alarme) nem alertas de ganho, estorno ou complemento.
- **Metas indisponíveis** (`metasComerciais` ausente) → `meta`, `atingimento`, `faltaParaMeta` e `excedente` saem
  `DADO_INSUFICIENTE`, os alertas de meta somem (não se afirma "meta ausente" sem ter lido as metas) e o realizado continua.
- Mês futuro continua `NAO_APLICAVEL`, como no E1.
- Ganho sem valor **nunca** é preenchido por `valorEstimado` ou `valorFechado` da oportunidade: o bloco não lê
  oportunidade nenhuma (teste muda estimado, fechado, estágio e probabilidade e o bloco não muda).
- Receita ganha comercial **não é** faturamento financeiro: nenhum dado do Financeiro é lido.
- Complemento corrige o mês do ganho original (D3-B); estorno conta no mês em que ocorreu (D3-A).
- Conta inativada ou mesclada depois do ganho **não apaga** receita: o bloco não filtra eventos por empresa (teste
  reativa, mescla e até remove as empresas e o bloco não muda).
- Mês comercial em `America/Sao_Paulo` (23h30 de 30/09 em SP é setembro, 00h00 de 01/10 é outubro; 31/12 23h59 é
  dezembro e 01/01 00h00 é janeiro).
- O atingimento é razão do E1 e **não** usa a amostra mínima de 30 das taxas operacionais (CD-D4).

## Autoridade única (nenhuma fórmula duplicada)

O Diretor só chama `apurarMetaComercial` — duas vezes no código: a apuração e, sem instante, uma chamada sobre coleções
vazias só para obter as **definições** das medidas (nenhum número sai dela). Guarda estática no teste: o módulo não usa
`lerLivroDesfechos`, `centavosDoGanho`, `lerValor`, `metaVigenteDoMes`, `reais(`, `valorFechado`, faturamento, caixa ou
o motor financeiro, e o bloco só lê `radar.metasComerciais` e `radar.desfechos`.

## Provas

| Prova | Resultado |
|---|---|
| `src/core/radar/commercialDirector.metaComercial.test.ts` | 33 ok (hardening: alertas sem livro e base dos eventos inconsistentes) |
| Paridade exata com o E1 em 5 meses (encerrado sem meta, encerrado com complemento retroativo, corrente com meta versionada e estorno de outro mês, futuro, futuro com meta retirada): medidas, alertas, retificações e inconsistências **iguais** ao `apurarMetaComercial` | ok |
| CD-1.2 preservado: todos os blocos iguais ao golden gerado com o código do CD-1.2 | ok |
| Testes do CD-1.x existentes (versão passou a CD-1.3 nas três asserções que fixavam CD-1.2) | ok |
| Suíte completa, type-check, lint e build | ok |

## Pendência documental da E3 (fora deste PR)

`CLAUDE.md` e `docs/commercial-director-e3-desfechos.md` ainda dizem "migration 0070 NÃO aplicada". A 0070 foi
aplicada em produção em 14/10/2026 às 18:03 UTC (SHA-256 `48884128…30863e`). A correção é um PR só de documentação,
independente da E4 e do PR #59.

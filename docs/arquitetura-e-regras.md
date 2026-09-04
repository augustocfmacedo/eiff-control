# Arquitetura e regras de cálculo

## Camadas

```
Telas (React)  ──►  store.ts (regras, permissões, auditoria)  ──►  engine.ts (cálculo puro)
                         │
                         └─ hoje: localStorage (seed.json migrado da planilha)
                            fase 1: Supabase/PostgreSQL (supabase/migrations) com a mesma API
```

- **engine.ts** é puro e sem estado: recebe o `Dataset` e devolve fluxo, DRE, obra 360°, checks. É a única definição de
  cada KPI (evita números conflitantes entre telas, Power BI e n8n). As views SQL em `0002_views.sql` replicam as mesmas regras.
- **store.ts** concentra o que no Supabase vive em triggers, funções e RLS: validações da planilha, alçadas, reabertura de
  aprovação, liquidação transacional, tolerância de conciliação, bloqueio de período fechado e trilha de auditoria.

## Mapeamento planilha → sistema

| Aba | Entidade / função | Observações |
| --- | --- | --- |
| CONFIG | `Params`, `ContaFinanceira` | data-base, cenário, fatores, reserva, saldos de abertura; alçadas adicionadas (DEC-03) |
| PLANO CONTAS | `PlanoConta` | categoria → tipo, grupo de fluxo, grupo DRE, classe |
| OBRAS | `Obra` + `obra360()` | colunas M..AC viram indicadores calculados; ETC informado pela Engenharia |
| LANCAMENTOS | `Lancamento` + `calcLancamento()` | colunas D,E,F,X,Z,AA,AB,AC,AD,AG,AH,AI,AJ recalculadas; liquidações parciais adicionadas |
| FLUXO 13S / 24M | `fluxo13Semanas()`, `fluxo24Meses()` | mesmas janelas e agrupamentos; filtro por obra e cenário |
| DRE GERENCIAL | `dreGerencial()` | valor gerencial por chave de competência |
| DIVIDAS | `Divida` | cadastro não gera pagamentos; parcelas entram na base única |
| CONCILIACAO | `TransacaoBancaria` + `calcTransacoes()`/`sugerirConciliacao()` | 1:1, 1:N e N:1; score de sugestão |
| CHECKS | `executarChecks()` | 14 bloqueantes + 6 alertas |
| DASHBOARD | `dashboard()` | KPIs, carteira, alertas, aging |
| GUIA / FONTES | README / auditoria | cadências e rastreabilidade |

## Fórmulas centrais

```
valorLiquidoPrevisto = bruto − retenções − desconto + juros
dataCaixa            = status = Realizado ? realização : vencimento
valorCaixaProjetado  = Realizado ? ±realizado
                     : Entrada  ? líquido × probabilidade × fatorEntradas(cenário)
                     : −líquido × fatorSaídas(cenário)
valorGerencial (DRE) = ±líquido (ou ±realizado)          # sem probabilidade/cenário
situação             = Cancelado | Realizado | Parcialmente liquidado | Sem vencimento | Atrasado | Próximos 7 dias | A vencer
saldoFinal[i]        = saldoFinal[i−1] + entradas[i] − saídas[i]   (saldoFinal[−1] = soma dos saldos de abertura)
necessidade          = max(0, reservaMínima − menorSaldo)
EAC                  = pago + comprometidoAberto + max(0, ETC − comprometidoAberto)
margemProjetada      = (contrato + aditivos) − EAC
```

Registros com `status` Rascunho ou Pendente **não** entram nas visões oficiais (caixa, DRE, obra); o impacto de um pendente é
exibido na Central de aprovações como simulação (antes → depois).

## Alçadas (parametrizáveis em Cadastros › Parâmetros)

| Situação | Etapas |
| --- | --- |
| Saída com obra ≤ LIMITE_GESTOR_OBRA, dentro do orçamento e sem furar a reserva | nenhuma (Programado) |
| Saída ≤ LIMITE_FINANCEIRO | Gestor de obra → Financeiro |
| Saída > LIMITE_FINANCEIRO ou > LIMITE_DIRETORIA | Gestor de obra → Financeiro → Diretoria |
| Exceção (fora do orçamento ou aprofunda o caixa abaixo da reserva) | cadeia completa + justificativa registrada |
| Sem obra (corporativo) | começa no Financeiro |

Valores atuais são placeholders (DEC-03): gestor 20.000, financeiro 100.000, diretoria 100.000, desvio 5%, tolerância 0,01, SLA 48h.

## Segurança (fase Supabase)

- Toda tabela pública com RLS; funções `current_org()`, `has_role()`, `can_access_company()`, `can_access_project()`.
- Saldos e transações bancárias invisíveis para Engenharia, Compras e Gestor de obra.
- Documentos financeiros não podem ser apagados (trigger); período fechado bloqueia insert/update por competência.
- Auditoria gravada por trigger `security definer`; usuários só leem.
- Power BI consome apenas o schema `mart` com usuário somente leitura.


## Orçamentos e composições (SINAPI)

- **Catálogo**: `Insumo` (código, unidade, tipo Material/Mão de obra/Equipamento/Serviço/Outros, preço com data e fonte) e `Composicao` (itens com coeficiente por unidade; itens podem ser insumos ou composições auxiliares). Origem `SINAPI`, `TCPO` ou `Própria`; a importação casa por origem + código e atualiza preços sem duplicar. Composições próprias são clonadas das de referência e recebem a produtividade da EIFF.
- **Motor** (`src/core/orcamentos.ts`): `Calculadora.custo()` resolve o custo unitário recursivamente com cache, sinaliza itens faltantes e ciclos; `calcOrcamento()` calcula custo direto, preço com BDI, totais por etapa e por tipo de insumo, e as curvas ABC de insumos (explosão × quantidade) e de itens (classes A ≤ 80%, B ≤ 95%, C).
- **Leitor SINAPI** (`src/core/sinapi.ts`): reconhece cabeçalhos por nome de coluna; aceita o formato antigo por UF (insumos + analítico) e o unificado (abas ISD/ICD, CSD/CCD, Analítico, preços por UF); escolhe desonerado ou não; `selecionarComDependencias()` recorta as composições escolhidas com auxiliares e insumos.
- **Contratação**: `contratarOrcamento` gera um serviço da obra por item (custo orçado = custo direto; preço de venda = com BDI, redistribuído ao valor do contrato quando marcado), atualiza `obra.custoOrcado` e congela os itens (`estimate_item.service_id` guarda o vínculo). A partir daí o custo previsto do serviço deixa de ser derivado da margem alvo.
- **Banco** (migration 0016): `catalog_input`, `catalog_composition`, `catalog_composition_item`, `estimate`, `estimate_item`; leitura paginada (1000 linhas por pedido) e inserção em lote na importação. View `v_composition_cost` traz o custo direto de um nível para BI.
- **Licenciamento**: a base SINAPI é pública (Caixa). A TCPO (PINI) é licenciada: o sistema só importa o que o usuário exportar da sua própria licença; nada da TCPO é distribuído com o código.

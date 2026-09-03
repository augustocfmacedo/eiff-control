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

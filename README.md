# EIFF Control

Sistema integrado de gestão financeira, obras, tesouraria e decisão da EIFF, construído a partir da planilha
`Fluxo_de_Caixa_EIFF.xlsx` e do `Blueprint_Funcional_EIFF_Control_v1.docx`.

> Cada obra funciona como uma unidade econômica independente e alimenta, em tempo real, o caixa e o resultado consolidado.

## O que está aqui

| Pasta | Conteúdo |
| --- | --- |
| `src/core/engine.ts` | Motor de cálculo: porta fórmula a fórmula a planilha (lançamento calculado, Fluxo 13S, Fluxo 24M, DRE, Obra 360°, aging, checks, conciliação, alçadas, impacto). |
| `src/core/engine.test.ts` | 20 testes que comparam o motor com os valores calculados pela planilha, centavo a centavo. |
| `src/data/store.ts` | Camada de dados com as regras de negócio (validações, alçadas, aprovações, liquidação, conciliação, fechamento, auditoria, permissões). Persiste no navegador; a mesma API será atendida pelo Supabase. |
| `src/data/store.test.ts` | Jornadas críticas do MVP: registrar compromisso → aprovar → liquidar → conciliar → fechar mês, segregação de funções e estorno. |
| `src/screens/*` | As telas P0 do blueprint (ver lista abaixo). |
| `supabase/migrations/` | Modelo canônico em PostgreSQL (0001), views e funções de KPI (0002), RLS, políticas e funções transacionais (0003). |
| `scripts/migrate-spreadsheet.mjs` | Migração da planilha para o dataset-semente com relatório de aceitos/rejeitados/exemplos excluídos. |
| `docs/` | Relatório de migração e notas de arquitetura/regras. |

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # motor + jornadas
npm run migrate:planilha [caminho.xlsx]   # regenera src/data/seed.json a partir da planilha
```

O app abre com os dados reais migrados da planilha (data-base 01/09/2026, cenário Base). Use o seletor **Usuário** no topo
para navegar como Diretoria, Financeiro, Gestor de obra, Engenharia, Compras, Contabilidade ou Auditoria e ver as
permissões por contexto. Em **Cadastros › Dados e migração** é possível exportar/importar JSON e restaurar a planilha.

## Telas (mapa do blueprint, seção 9)

| ID | Tela | Rota |
| --- | --- | --- |
| SCR-02 | Minha caixa de entrada (aprovações, tarefas, menções, alertas) | `#/inbox` |
| SCR-03 | Painel executivo | `#/` |
| SCR-04/05/06/11/12 | Lista de obras, Obra 360°, contrato, financeiro da obra, comunicação | `#/obras`, `#/obras/:codigo` |
| SCR-13/14/15/16 | Contas a pagar, a receber, lançamentos, detalhe (liquidar, cancelar, timeline) | `#/pagar`, `#/receber`, `#/lancamentos`, `#/lancamentos/:id` |
| SCR-17 | Central de aprovações com impacto no orçamento e no caixa | `#/aprovacoes` |
| SCR-18/19/20/21 | Posição diária, Fluxo 13 semanas, Fluxo 24 meses, cenários | `#/posicao`, `#/fluxo13`, `#/fluxo24` |
| SCR-22/23 | Contas bancárias, importação de extrato, sugestão e conciliação | `#/conciliacao` |
| SCR-24 | Dívidas | `#/dividas` |
| SCR-25 | DRE gerencial | `#/dre` |
| SCR-26 | Checks e fechamento de período | `#/checks` |
| SCR-27/28 | Plano de contas, contas, parâmetros/alçadas, usuários | `#/cadastros` |
| SCR-30 | Auditoria | `#/auditoria` |

## Operação de obras (Central de obras)

| Entidade | O que registra | Ligação com o financeiro |
| --- | --- | --- |
| Serviço da obra (`Servico`) | orçamento, preço de venda, quantidades, prazo previsto/real, status, responsável | cada lançamento aponta para um serviço; comprometido, pago, ETC, EAC e margem saem por serviço e somam na obra. Com serviços cadastrados, custo orçado, ETC e avanço físico da obra são derivados deles. |
| Demanda (`Demanda`) | check-list diário, semanal, mensal ou único, por obra ou serviço, com responsável | conclusão por período, aderência e atraso alimentam a Central de obras, a caixa de entrada e os alertas |
| Ordem de produção (`OrdemProducao`) | linha de fabricação (detalhamento → corte → solda → pintura → expedição) e linha de montagem (recebimento → pré-montagem → içamento → fixação → liberação), com quantidade, prioridade e data de necessidade | kanban por etapa na obra e na Central; ordens atrasadas geram alerta |

Rotas: `#/central` (carteira, demandas do período, linhas de fabricação e montagem) e abas Serviços, Demandas, Fabricação e Montagem em `#/obras/:codigo`. Motor em `src/core/obras.ts`, schema em `supabase/migrations/0007_obras_operacao.sql`.

## Regras que vieram da planilha (preservadas)

- Valores positivos; o tipo (Entrada/Saída) define o sinal.
- Caixa usa a data de realização quando realizado, senão o vencimento. DRE usa competência.
- Entradas futuras × probabilidade × fator do cenário; saídas × fator de contingência do cenário.
- Fluxo 13S em janelas de 7 dias a partir da data-base; 24M por mês civil; roll-forward verificado nos checks.
- Custo direto e receita de obra exigem Código Obra. Registros "Exemplo" ficam fora da carga real.
- EAC = pago + comprometido em aberto + ETC não comprometido (ETC informado = tudo que falta, contratado ou não).

## Regras que vieram do blueprint (adicionadas)

- Estados: Rascunho → Pendente → Aprovado → Programado → (parcialmente) Realizado → Conciliado; Cancelado/estornado preserva histórico.
- Alçadas parametrizadas: saída acima de `LIMITE_GESTOR_OBRA`, fora do orçamento ou que aprofunde o caixa abaixo da reserva
  exige aprovação Gestor de obra → Financeiro → Diretoria; alteração relevante reabre o fluxo; solicitante nunca decide.
- Liquidação exige conta, data, valor e evidência; conciliação com tolerância; divergência exige justificativa.
- Fechamento exige checks bloqueantes zerados; reabertura exige Diretoria com motivo. Tudo auditado com antes/depois.
- Engenharia, Compras e Gestor de obra não veem saldos bancários. Auditoria é somente leitura.

## Banco de dados (Supabase)

Sem `VITE_SUPABASE_ANON_KEY` no `.env` o app roda em modo local (dados no navegador). Com a chave, ele exige login e lê e
grava no PostgreSQL do projeto, com permissões aplicadas por RLS. Passo a passo em
[docs/implantacao-supabase.md](docs/implantacao-supabase.md): colar `supabase/deploy.sql` no SQL Editor, criar usuários
e rodar `supabase/seed_profiles.sql`.

```bash
npm run deploy:sql   # regenera supabase/deploy.sql (migrations + carga da planilha)
```

## Próximos passos (Fase 1 do blueprint)

1. Aplicar `supabase/deploy.sql`, criar usuários e informar a chave anônima no `.env`.
2. Publicar o build (`npm run build`) em Vercel/Netlify para a equipe acessar.
3. Conectar Pluggy (webhook via n8n → `raw.integration_event` → `bank_transaction`) e a API de relatórios do Mais Controle.
4. Fechar as decisões DEC-01..DEC-10 (empresas, usuários, valores de alçada, reserva mínima, política de competência).
5. Dois fechamentos em paralelo com a planilha antes do cutover.

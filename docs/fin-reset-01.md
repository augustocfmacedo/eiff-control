# FIN-RESET-01 — baseline bancária limpa para reimportar os OFX do zero

Decisão de negócio (Augusto, 01/10/2026): recomeçar a conciliação bancária do zero. Os OFX serão baixados de novo e
importados manualmente, cada um na conta certa, depois do reset. A próxima etapa (FIN-RECON-01, conciliação assistida e
memória financeira) só começa depois dessa reimportação.

## Estado encontrado em produção (01/10/2026, somente leitura)

- **0059 aplicada** (colunas de descarte/movimentação, trigger `bank_transaction_fato`, dados OFX da conta), mas a policy
  `tx_update` foi **derrubada** em 30/09 como contenção. A unique antiga `(bank_account_id, external_id)` segue no ar.
- **0060 não aplicada** e agora **superseded** (arquivo virou no-op): mover as 214 linhas do Inter que estão no BB não tem
  efeito útil quando todas as transações serão descartadas e reimportadas na conta certa.
- **Limpeza parcial de 30/09 23:42**: o app registrou `limpar_extrato` (411 descartadas, 36 conciliações desfeitas) e 4
  `mover_transacoes`, mas sem a policy de UPDATE a RLS filtrou os UPDATEs **em silêncio** — 0 descartadas, 0 movidas —
  enquanto o DELETE das conciliações passou (policy `rec_write` ALL). O app agora confere as linhas gravadas e falha alto.
- 441 transações ativas (CTA-001 BB 277, CTA-002 Inter 164; 32 FITIDs ativos em duas contas), 8 conciliações (todas em
  lançamentos gerados do extrato, com a intrusa e a gêmea conciliadas ao mesmo lançamento).
- 44 lançamentos gerados do extrato ativos (43 `extrato` + REC-0060 `ofx`), todos Realizado; 43 liquidações = 79.057,75.
  PAG-0056 é anomalia: Realizado com 2.211,92 liquidados, sem liquidação registrada e sem auditoria `lancar_transacao`.
  PAG-0042 (OFX de teste) já está Cancelado com liquidação estornada — neutro, não é tocado.
- **Nenhum título pré-existente conciliado** (nem hoje nem no histórico de DELETE de `reconciliation`).
- REC-0058 (manual, 40.000, liquidado à mão em 08/09 na CTA-002) e REC-0060 (do OFX, 40.000, mesmo dia, obra e conta)
  parecem o mesmo recebimento contado duas vezes; o reset tira o REC-0060 e mantém o REC-0058 (título independente).
- Nenhum período fechado.

## O que muda (código + migrations)

| Peça | O quê |
|---|---|
| Hotfix de identidade | id da transação no app = uuid da linha; FITID só em `idExterno` (o mesmo FITID em duas contas são duas linhas). |
| `importarTransacoes` | a linha nasce com `crypto.randomUUID()`; `persistirRemoto` grava esse id (`linhaTransacaoNova`). |
| `lancarTransacao` | `idExterno` do lançamento = uuid da linha do banco, não o FITID. Com o FITID, relançar a mesma linha depois do reset bateria na unique `(organização, origem, external_id)` do lançamento antigo. |
| `persistirRemoto` | UPDATE em `bank_transaction` com `.select('id')`: 0 linhas = erro, e para antes de apagar conciliações. |
| `limparExtrato` | recusa quando há lançamento gerado do extrato (limpar só a linha o deixaria no caixa e na DRE); classificação em `src/core/resetExtrato.ts`. |
| 0061 | unicidade do FITID só entre linhas **ativas** (índice parcial `bank_transaction_fitid_ativo`); `financial_reset` + `financial_reset_item` (retrato imutável); `fin_reset_extrato` e `fin_reset_desfazer`, executáveis só pelo dono do banco. |
| 0062 | restaura a policy `tx_update` — **só depois do deploy do hotfix**. |

### Por que linha nova, e não restaurar a descartada

Reaproveitar a linha descartada apagaria o rastro do reset nela (descarte e motivo), colocaria a reimportação no lote de
importação antigo (o card agrupa por `imported_at`) e exigiria UPDATE no fato bancário a cada importação. Com o índice
parcial, a linha antiga fica como histórico, a nova entra limpa, e o banco continua garantindo uma única linha **ativa**
por (conta, FITID) — inclusive recusando restaurar a antiga enquanto a nova estiver ativa.

## Tratamento por tipo

- **Transação ativa** → descarte lógico (`discarded_*`, motivo `FIN-RESET-01: …`). Nunca DELETE.
- **Conciliação** → removida (vínculo, não fato); retrato no `financial_reset_item` e DELETE gravado pelo `audit_row`.
- **Título pré-existente conciliado** → só `reconciled = false`. Status, valor, liquidações e conta ficam.
- **Lançamento gerado do extrato** → liquidação estornada (`settlement.reversed`), título **Cancelado** e **excluído
  logicamente** (`deleted_*`). O motor ignora excluídos; as views SQL ignoram cancelados (elas não conhecem `deleted_at`).
  O estorno sozinho não basta: o trigger `apply_settlement` devolveria o título a Programado e ele voltaria ao fluxo.
- **Gerado do extrato ligado a pedido, medição, rateio, aprovação pendente ou período fechado** → o reset recusa.
- **Ambiguidade** → lista fechada: o reset só roda se o banco tiver exatamente o que foi aprovado (`manter` permite
  excluir um código do reset por decisão explícita).

## Runbook (ordem obrigatória)

1. `MERGE AUTORIZADO` → merge do PR; `PRODUCTION AUTORIZADA` → publicar o deploy com o hotfix.
2. Aplicar **0061** (`npx supabase db query --linked --project-ref dduobppgomqyagjviwpx -f supabase/migrations/0061_fin_reset_extrato.sql`).
3. Augusto: abrir o app uma vez, confirmar que não há pendência de sincronização, e fechar todas as abas.
4. `scripts/fin-reset/precheck.sql` e `scripts/fin-reset/esperado.sql` de novo; o JSON tem de bater com `executar.sql`.
5. `RESET FINANCEIRO AUTORIZADO` → `scripts/fin-reset/executar.sql` (uma transação; divergência = RAISE, nada gravado).
6. `scripts/fin-reset/posverificacao.sql`.
7. Aplicar **0062** (policy de UPDATE).
8. Augusto reimporta os OFX (modal OFX, escolhendo a conta) → `posverificacao.sql` de novo (FITID ativo repetido = 0).

Rollback: `scripts/fin-reset/desfazer.sql` (recusa se já houve reimportação; descartar a reimportação antes).

## Provas

- `npm run smoke:fin-reset` — fila inteira de migrations num Postgres em memória, 15 provas A–O (lista fechada, recusa
  por vínculo, efeitos, auditoria, reimportação do mesmo OFX com RLS de Financeiro, FITID ativo duplicado impossível,
  relançamento sem colisão, autoridade, policy 0062, desfazer). Roda no Quality Gate.
- `src/data/resetExtrato.store.test.ts` — classificação, recusa do `limparExtrato`, reimportação com linhas novas,
  payload do INSERT, relançamento.

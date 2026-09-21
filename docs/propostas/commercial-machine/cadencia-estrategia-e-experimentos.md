# Proposta — cadência por estratégia e experimentação (CM4) (NÃO APROVADA, SEM MIGRATION)

Estado: **proposta para o CM4**. No ciclo CM2: `radar_strategy` não é política de cadência, experimentos não são ativados,
nenhuma migration é criada.

## Auditoria (CM2-A)

- `radar_strategy` — 8 códigos semeados (`ESTRATEGIAS_PADRAO`: TECHNICAL_AUDIT … PARTNERSHIP); campos `code`, `name`,
  `description`, `message_template`, `active`, `sort_order`. Usada em atividade e oportunidade (`strategy_id`), no contexto
  de comunicação (servidor exige ativa) e no CM1-B (oportunidade ou última atividade com estratégia). **Nenhum atributo
  temporal.**
- `radar_experiment` — `name`, `hypothesis`, `strategy_id`, `channel`, `started_at`, `ended_at`, `status`, `result`
  (texto). Existe `salvarExperimentoRadar` e o mapeamento em `radar.supabase.ts`, mas **nenhuma tela o usa** e **nada liga**
  atividade, tarefa ou comunicação a um experimento. Atribuição hoje só por estratégia + canal + período (confundida, sem
  controle).

## Proposta

1. **Política versionada.** `PoliticaCadenciaCM` pura, com `versao`; a política base é exatamente o CM1-A.1 (import de
   `HIPOTESE_COMMERCIAL_MACHINE`). Overrides opcionais por estratégia, persona, estágio e resultado começam **vazios**.
   Qualquer valor novo só entra com dado do CM4 e sobe a versão.
2. **Variante determinística.** Conta recebe variante por hash de `empresaId` + id do experimento, só com experimento
   "Em andamento" aprovado explicitamente. Controle = política base.
3. **Sem contaminar a operação.** A variante só altera datas `RECOMENDADAS` nas lacunas (D4). Nunca altera data `FIRME`,
   nunca altera a Commercial Queue (categoria, tier, urgência, posição), nunca libera envio, nunca muda canal/contato.
4. **Rastreabilidade.** A recomendação carrega `{ versaoCadencia, variante }`; a atribuição é recalculável pelo hash. Se
   for preciso gravar: coluna `experiment_id` em `radar_task`/`radar_activity` — proposta sem número.
5. **Medição.** Resultado lido de `radar_activity` (resultado, tempo até resposta), `radar_task` (concluída/vencida) e
   estágios de oportunidade; nenhum histórico paralelo.

## Perguntas para o CM4

- O intervalo depois de sem resposta deveria crescer por tentativa?
- GATEKEEPER deveria contar no limite (dívida C5)?
- Contagem por contato ou por empresa (C12)?
- Revisita por tempo depois de resultado negativo (D2) traz resposta sem desgastar a conta?

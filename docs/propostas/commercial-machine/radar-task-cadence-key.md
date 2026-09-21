# Proposta — chave de cadência em `radar_task` (NÃO APROVADA, SEM MIGRATION)

Estado: **proposta arquitetural**. Nenhuma migration numerada. Só pode virar migration com autorização própria, depois
que a Wave 03 da Central estiver no baseline e o namespace de migrations for conferido. Decisão do CM2-A (D7): a primeira
versão da idempotência é **sem schema**.

## Problema

`radar_task` não tem vínculo com o fato que motivou a tarefa nem chave de idempotência. `salvarTarefaRadar`,
`registrarAtividadeRadar(…, proxima)` e `concluirTarefaRadar(…, proxima)` aceitam tarefas duplicadas (mesma conta,
contato, oportunidade, tipo e janela). Quando o CM2 facilitar "Agendar próxima ação", o risco de duplicidade cresce.

## Sequência aprovada sem schema

1. **CM2-C** — cobertura semântica (projeção pura): tarefa aberta da mesma empresa, contato, oportunidade e tipo/natureza,
   criada depois da âncora, cobre a sugestão. Havendo cobertura, não há sugestão nova.
2. **CM2-E** — guarda mínima no store: antes de criar a tarefa vinda de sugestão, recalcula a cobertura sobre o estado atual
   e recusa a segunda criação (duplo clique, duas abas). Auditoria registra a origem
   (`{ origemCadencia: chave, versaoCadencia }` no `registrar`).

Limite conhecido: duas sessões em aparelhos diferentes, ambas offline, podem criar a mesma tarefa; a sincronização não
tem restrição de unicidade no banco.

## Proposta futura (se o limite acima se materializar)

```sql
-- PROPOSTA — sem número, não aplicar
alter table radar_task add column cadence_key text;
create unique index radar_task_cadence_key_aberta
  on radar_task (organization_id, cadence_key)
  where status = 'Aberta' and cadence_key is not null;
```

- Formato da chave: `cad:<versão>:<empresaId>:<contatoId|->:<oportunidadeId|->:<motivo>:<âncora.tipo>:<âncora.id>`.
- Sem PII; não depende de `hoje`.
- Tarefas manuais continuam com `cadence_key` nulo.
- Mapeamento em `radar.supabase.ts` (`linhaApp`/`linhaDb`) e tipo em `TarefaRadar` no mesmo bloco.
- Conflito no INSERT vira "tarefa já agendada" e devolve a existente, nunca erro genérico.

## Fora do escopo

Não cria tabela de sequência, evento de cadência ou tentativa; não liga tarefa a experimento (ver
`cadencia-estrategia-e-experimentos.md`).

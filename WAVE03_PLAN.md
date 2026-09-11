# EIFF Central — Wave 03: Alpha interno em pé + Mission Control ao vivo

Baseline oficial: `main @ ab642be3c6cfb918241b6c8b637d485a05ce810e`. Branch de integração: `integracao-wave03`.
Architect é o único integrador; nenhum worker faz merge em `main`, aplica migration, toca ambiente ou usa segredo.

## Decisões aprovadas (10/09/2026 → 11/09/2026)

- **D1** — `0049`, `0050`, `0051` autorizadas para a F1, **não imediatamente**. Antes de aplicar, reconfirmar: `main` no
  baseline, Quality Gate verde, posição real do banco, pendentes exatamente as três, Full Migration Preflight verde.
  Aplicação exclusiva do Architect. **Sem rollback destrutivo automático**: em incidente, desligar a funcionalidade,
  reverter código se preciso, forward-fix. Qualquer *down migration* exige nova autorização.
- **D2 (B+)** — persistir o **inbound** em `central_conversation`/`central_message`/`central_event`. **Não persistir o
  texto da resposta outbound.** O evento registra, no mínimo: timestamp do processamento, organização, identidade,
  versão/SHA do motor, hash do input, hash/fingerprint do output, intenção, duração, status, `podeExecutar`.
  Visualização no EIFF Control por operação **read-only "Reprocessar parecer"**, partindo da mensagem inbound
  persistida, com o aviso: `Parecer reprocessado — nenhuma mensagem foi enviada ao WhatsApp.` Sem migration de
  retenção de outbound nesta wave.
- **D3** — token GitHub *fine-grained*, somente leitura, só o repositório EIFF Control, só no ambiente do Netlify,
  nunca no frontend, nunca em log. Criação/configuração do secret é ação do proprietário/Architect.
- **D4** — ensaio da Meta só com número controlado de teste/Alpha; sem tráfego operacional comum.

## Invariantes da Wave 03 (violar reprova a entrega)

1. `phone_number_id` desconhecido nunca cai em organização padrão.
2. Ausência de `organization_id` → fail-closed.
3. `organization_id` obrigatório em qualquer carga server-side de Dataset.
4. `service_role` nunca chega ao CFO, ao engine, aos agentes ou a `fluxoInterno`; só módulos server-side de acesso a dados o usam.
5. Dataset server-side é **SELECT-only**, com allowlist explícita de tabelas.
6. Assinatura da Meta e idempotência acontecem **antes** de qualquer processamento de negócio.
7. Nenhum caminho da wave faz POST na Graph API.
8. Toda resposta mantém `podeExecutar === false`.
9. Nenhuma mutação financeira.
10. `MISSION_CONTROL_LIVE` fechado não torna a interface LIVE: LIVE exige fonte acessível, autorizada e fresca; qualquer falha → SNAPSHOT.
11. Códigos de onboarding são expirantes, single-use, limitados em tentativas e vinculados a organização + telefone.
12. Nova solicitação de verificação invalida os códigos anteriores.

## Ordem de execução

1 propriedade → **2 F4 Mission Control** → 3 checkpoint → **4 F1 DB Release** (Architect) → 5 validação pós-migration →
6 F2 Central Wiring (`CENTRAL_ALPHA_MODE=off`) → 7 F3 Identity Onboarding → 8 F5 QA → 9 deploy com `off` →
10 ensaio inbound controlado → 11 habilitar Alpha só para o número controlado → 12 ensaio end-to-end →
13 Quality Gate + evidências → 14 revisão final. **Sem merge em `main`. Sem envio. Sem `ESCRITA_SERVIDOR`.**

## Matriz de propriedade (exclusiva)

| Frente | Escreve APENAS em | Lê |
| --- | --- | --- |
| **F4 Mission Control LIVE** | `netlify/functions/development-status.ts`, `src/core/central/githubAdapter.ts`(+test), `src/core/central/statusVivo.ts`(+test), `src/screens/MissionControl.tsx`, `src/styles.css` (só classes novas) | `missionControl.ts`, `App.tsx`, `store.ts` |
| **F2 Central Wiring** | `src/core/central/contextoServidor.ts`(+test), `src/data/datasetServidor.ts`(+test), `src/core/central/persistenciaCentral.ts`(+test), `netlify/functions/channel-meta-webhook.ts` | `fluxoInterno.ts`, `conversa.ts`, `autoridade.ts`, `supabase.ts`, migrations 0049–0051 |
| **F3 Identity Onboarding** | `netlify/functions/central-identidade.ts`, `src/core/central/onboarding.ts`(+test), `src/screens/CentralIdentidades.tsx`, `src/core/central/orquestrador.ts` (só a intenção de código), `src/ui/Paleta.tsx` e `src/App.tsx` (só a rota) | `identidade.ts`, `autoridade.ts`, migration 0049 |
| **F5 QA** | `src/core/central/wave03.test.ts`, `docs/central-alpha-runbook.md`, `docs/rate-limit-edge.md`, `seguranca.test.ts` (só converter `it.todo`) | tudo |
| **Architect** | `missionControl.ts` (curadoria de gates), `tipos.ts`, `docs/eiff-central.md`, `CLAUDE.md`, este arquivo, integração, F1 | tudo |

**Intocáveis** (salvo bloqueio técnico comprovado e autorização específica): `src/core/cfo.ts`, `src/core/engine.ts`,
a MATRIZ em `store.ts`, `metaServidor.ts`, `metaEnvio.ts`, `tipos.ts`. **Nenhuma migration nova**; `0052`–`0054` seguem reservadas.

## Gates de entrada, aceite, testes e rollback

Conforme o plano aprovado (objetivo, escopo, riscos R1–R7, aceite por frente, estratégia de testes) — registrado na
conversa de aprovação e reproduzido em `docs/central-alpha-runbook.md` pela F5. Rollback: código por revert do merge;
funcionalidade por `CENTRAL_ALPHA_MODE=off`; banco só forward-fix (D1); segredos por remoção no Netlify.

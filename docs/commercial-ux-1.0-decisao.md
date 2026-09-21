# Commercial UX 1.0 — contrato de design (aprovado)

Estado: **direção visual aprovada em 21/09/2026.** Este é o contrato de design do redesign do módulo Comercial e o
primeiro commit da branch `feature/commercial-ux-1`, criada de `main @ 28c462a847c97cf8337e125c69907d9cadd0f344` — a
Production Release CM1+CM2 (`1a1d303`, mergeada em `28c462a`) já está em produção e validada.

A branch `feature/commercial-machine-cm2` não é reutilizada no redesign.

---

## 1. Direção aprovada

**Conceito B + Conceito C**, em duas camadas sobre a mesma projeção:

- **Panorama Comercial** (Mission Control do Conceito B) — leitura rápida da operação.
- **Modo Foco** (deck do Conceito C) — execução sequencial da fila, "Trabalhar a fila".

A complexidade técnica e a explicabilidade **continuam existindo por inteiro**; mudam de camada, para trás de `Por quê ›`.

Fora do escopo desta frente, por decisão explícita: **nenhum indicador sintético**. A barra "pressão do dia" proposta na
rodada anterior está **cancelada**. O topo do Panorama mostra só números objetivos e contáveis:

```text
4 AGORA · 6 AGUARDANDO · 12 PROGRAMADAS · 2 EM RISCO
```

## 2. Uma única verdade operacional

A autoridade de prioridade e execução passa a ser, exclusivamente:

```text
CM1-A (fila) → CM1-B (plano) → CM2-B (cadência) → CM2-C (sugestão) → CM2-E (escrita)
```

- O Panorama e o Modo Foco leem **só** essa cadeia. Nenhuma regra concorrente de prioridade é criada na UI.
- O bloco operacional legado do Command Center baseado em `filaHoje` (`pipeline.ts`) **deixa de ser apresentado como uma
  segunda lista de prioridades**. Isso é bloco próprio, com testes; a arquitetura já é desenhada com essa decisão, mas a
  remoção não acontece junto do UX-1.
- O contador da sidebar (`App.tsx`, hoje "tarefas abertas vencidas") deve passar a refletir `AGORA`. **Não** nesta
  primeira implementação — bloco posterior da frente (ver §11).

Divergências hoje conhecidas e que esta decisão encerra no futuro: Hoje (CM1/CM2) × Command Center (`filaHoje`) ×
sidebar (tarefas vencidas) — dívidas #2 e #7 de `docs/commercial-machine.md` §10.

## 3. Papel das três telas

| Tela | Pergunta que responde | Conteúdo |
|---|---|---|
| **COMERCIAL** (`/radar/hoje` → operação diária) | *O que precisa da minha atenção agora?* | Agora, Aguardando, Programado, Pipeline ativo (resumo), Risco, Entrada, Modo Foco |
| **EMPRESAS** (`/radar/empresas`) | *O que sabemos sobre esta conta?* | cadastro, contatos, projetos, sinais, atividades, oportunidades, inteligência da conta |
| **INTELIGÊNCIA** (Command Center evoluído) | *Como está funcionando a máquina comercial?* | indicadores, pipeline agregado, cobertura, fontes, importações, regras, score, personas, qualidade de dados, aprendizado futuro |

A Inteligência **não é uma segunda fila operacional**.

## 4. Zonas do Panorama e orçamento visual rígido

| Zona | Conteúdo | Teto | Excedente |
|---|---|---|---|
| **AGORA** | cartões de ação | **3 cartões** | `Ver todos ›` |
| **PIPELINE ATIVO** | oportunidades ativas | **3** | `Ver pipeline ›` |
| **RISCO** | exceções (travas, bloqueios) | **3** | `Ver todos ›` |
| **ENTRADA** | resumo numérico + itens | resumo + **3** | `Ver todos ›` |
| **AGUARDANDO** | **resumo por motivo** (sem lista) | — | `Ver todas ›` |
| **PROGRAMADO** | próximos compromissos | **3** | `Ver agenda ›` |

Nenhuma lista longa no Panorama. O teto é parte do contrato, não preferência de layout.

## 5. PIPELINE ATIVO (antes "Em movimento")

O nome "em movimento" exigiria uma regra nova de movimento — **não criar**. A zona chama-se **PIPELINE ATIVO** e mostra
apenas fatos que já existem:

- oportunidade, estágio, valor;
- último movimento e dias desde o movimento **quando o dado existir**.

Marcação de estado só quando um contrato existente sustenta:

- `OPORTUNIDADE_PARADA` → **PARADA**;
- `OPORTUNIDADE_PARADA_CRITICA` → **EM RISCO**;
- trava existente da conta/oportunidade → **EM RISCO**.

Nenhuma classificação de movimento inventada pela UI.

## 6. Zona ENTRADA

Existe desde o primeiro dia como **estrutura**, porque o próximo grande bloco é o Lead Engine 1.0 — e a estrutura visual
não pode precisar ser refeita quando ele chegar.

Antes do Lead Engine, mostra só o que é real e **com os conceitos separados** (nunca misturar "sem decisor" com "novo
lead"):

- sinais novos (janela explícita, ex.: 7 dias);
- contas novas **apenas se houver conceito confiável de criação recente**;
- contas a enriquecer: sem decisor / sem canal válido — rotuladas como enriquecimento, não como entrada.

Com o Lead Engine, a mesma zona recebe: novas empresas descobertas, origem/fonte, estado de enriquecimento, decisor
encontrado, novo timing e promoção para ação.

## 7. Cartão de ação (a unidade da operação)

Responde, em poucos segundos: **empresa → o que aconteceu → com quem → por qual canal → o que eu faço**.

```text
Metalúrgica Andrade        A+

Cliente respondeu há 2 dias
e ainda não houve tratativa.

João Silva · Compras
WhatsApp

[ ABRIR ABORDAGEM ]

Por quê ›
```

- Classe pode aparecer, discreta.
- **Não** aparecem na primeira camada: score, decision fit, versões CM, tier, chave de ordenação, canais descartados,
  tentativas, razões secundárias, explicação completa do motor.
- O CTA primário vem do modo do plano (CM1-B), com a mesma semântica de hoje; CTA secundário é opcional.

## 8. Gaveta `Por quê ›`

Preserva **100%** da explicabilidade atual — a informação não é removida, só deixa de ocupar a primeira camada. Conteúdo:
posição na fila; por que está acima da próxima; razão; fato; oportunidade; pessoa; decision fit; canais; objetivo;
playbook; motivo do canal; histórico; cadência; tentativas; travas; pendências; versões CM.

## 9. Modo Foco — "Trabalhar a fila"

Uma conta por vez. Mostra: posição, empresa, fato, pessoa, canal, objetivo, CTA principal, CTA secundário, `Por quê ›`.
Lateral **Depois desta** com os próximos 3–4 itens.

Invariantes do modo:

1. **Não cria ordem própria** — usa exatamente a ordem do CM1-A.
2. Avançar é **apenas navegação de UI**.
3. **Nunca** executa nem conclui uma ação automaticamente.

## 10. Mobile

Em tela estreita o caminho operacional principal é o **Modo Foco**; o Panorama empilha as zonas. "Trabalhar a fila" tem
de ser confortável no celular.

## 11. Blocos posteriores (registrados, fora do UX-1.0 inicial)

- **Command Center → Inteligência**: retirar a fila legada (`filaHoje`) da apresentação; bloco próprio, com testes.
- **Contador da sidebar** (`App.tsx`) passar a refletir `AGORA` (hoje conta tarefas vencidas).

## 12. Plano de blocos (a autorizar um a um, depois da release)

| Bloco | Entrega | Toca |
|---|---|---|
| **UX-0** | projeção pura de apresentação (`comercialVisao.ts`): zona por linha, frase humana do fato, orçamento por zona, contrato da zona ENTRADA. Testes + guardas estáticas. | 1 arquivo novo + teste |
| **UX-1** | Panorama com as 6 zonas e os tetos; tabela completa vira `Ver todos ›`. | tela |
| **UX-2** | Gaveta `Por quê ›` com 100% do conteúdo atual. | tela + componente |
| **UX-3** | Modo Foco + atalho + `Depois desta`. | componente |
| **UX-4** | Zona PIPELINE ATIVO com fatos existentes e marcações PARADA/EM RISCO por contrato. | leitura de oportunidades |
| **UX-5** | Zona ENTRADA com conceitos separados e contrato pronto para o Lead Engine. | projeção UX-0 |
| **UX-6** | Mobile, acessibilidade, Tour, telemetria das zonas. | tela |

Regras da frente: nenhum bloco toca `commercialMachine.ts`, `commercialActionPlan.ts`, `commercialCadence.ts`,
`commercialCadenceTask.ts`, `commercialCadenceCommit.ts`, `store.ts`, Server Truth, comunicação, Central ou migrations.
Um GO por bloco, um commit por bloco, gate completo em cada um.

## 13. Sequência acordada

```text
PR (CM1+CM2) → CI → merge main → deploy Netlify → smoke test produção   ✔ concluído
→ criar branch feature/commercial-ux-1 (de main @ 28c462a)              ✔ este commit
→ UX-0 → UX-1 → UX-2 → UX-3 → UX-4 → UX-5 → UX-6                        um GO por bloco
```

`feature/commercial-machine-cm2` permanece congelada em `1a1d303514cde46d42b2b322499d54d6ac94f18f`.

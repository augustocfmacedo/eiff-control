# UX-P03 — Obras compacto (piloto isolado, somente leitura)

Estado: **piloto isolado implementado e validado localmente na branch `feature/ux-p03-obras-compacto`, sem commit, sem push, sem
PR, sem integração no App.** Base `origin/main @ 7ac9bde` (fast-forward da branch vazia, 23/09/2026). Reserva aprovada: os
8 arquivos abaixo, nenhum outro tocado.

## 1. O que é

A mesma filosofia validada no Financeiro compacto (UX-P01/P02), aplicada à carteira de obras:

| Camada | Pergunta | Na tela |
|---|---|---|
| SITUAÇÃO | Como a carteira/obra está? | **Diretoria** (3 tiles): carteira contratada + backlog · margem projetada da carteira + obras com margem negativa · saúde das obras visíveis por semáforo. **Operação** (4 tiles): avanço físico por obra · medições pendentes e atrasadas · serviços atrasados e em risco · fabricação e montagem (atrasadas e concluídas, separadas) |
| OBRAS | O que cada obra visível mostra? | uma linha por obra: semáforo e score, status, próximo marco, prazo, margem projetada, avanço físico (ou "sem serviços"), medições e serviços; oito composições sob demanda por obra |
| ATENÇÃO | O que exige olhar? | só condições já emitidas pelo core, agrupadas pela severidade que a fonte fornece (Precisa de ação / Atenção / Acompanhar); cada linha = o que aconteceu · impacto canônico · próximo passo de leitura |
| COMPOSIÇÃO | De onde vem? | gaveta lateral (padrão do financeiro): Obra 360, serviços, medições, curva S, produção, materiais, faturamento, custos; origem com função, campo, regra e tela |
| FRESCOR / SINCRONIZAÇÃO | Até quando vale? | chips separados: `Base dd/mm`, `Última medição dd/mm`, `Último avanço dd/mm`, `Atualizado há …`; sincronização em chip próprio quando o App fornecer |

Estados: carregando, erro, vazio (sem obras), sem visibilidade (obras existem, conjunto visível vazio), obra sem serviços, subconjunto (agregados da carteira indisponíveis).

## 1.1 Arquitetura

```text
fixture (dev/testes) ou, na futura integracao, o App com Dataset/usuario/sync ja carregados e as obras ja filtradas
  → EntradaObras { ds, usuario, codigosObraVisiveis, agora, visao }
  → obrasCompactoModel.montarObras (puro: seleciona, agrupa, rotula; severidade so a canonica)
  → funcoes canonicas do core (carteiraObras/obra360, analisarObra, acompanhamentoFaturamento, dashboard, sugestoesPara)
  → ObrasCompacto (apresentacao: tiles, linhas de obra, atencao, gaveta)
```

O piloto nao importa store, Supabase, permissoes, telemetria nem o piloto financeiro; nao faz fetch, nao grava, nao assina
nada. Estado desta frente: **PILOTO ISOLADO, nao integrado ao App** (sem rota no EIFF Control).

## 2. Arquivos (os 8 reservados)

| Arquivo | Papel |
|---|---|
| `src/screens/piloto/obrasCompactoModel.ts` | view-model puro: `montarObras(entrada)`; seleção, agrupamento, rotulagem; tabelas de relabel de severidade |
| `src/screens/piloto/obrasCompacto.fixtures.ts` | dataset fictício "PILOTO · DADOS DE TESTE": 3 obras (execução com medições atrasadas e produção; margem negativa, sem datas e serviço parado; planejamento sem serviços), 4 variantes de visibilidade |
| `src/screens/piloto/obrasCompacto.test.ts` | 32 provas (paridade, visibilidade como contrato, preservação, ausente ≠ zero, conceitos separados, severidade canônica, concisão, guardas estáticas) |
| `src/screens/piloto/ObrasCompacto.tsx` | a tela (só apresenta) |
| `src/screens/piloto/pilotoObras.css` | estilos sob `.piloto-obra`, só tokens de `styles.css`, sem tocar `.piloto-fin` |
| `src/screens/piloto/mainObras.tsx` | entrada isolada (dev): fixture → tela; `?variante`, `?estado`, `?visao`, `?composicao`, `?tema` |
| `piloto-obras.html` | página da demonstração em `vite dev` (o build empacota só `index.html`, conferido em `dist/`) |
| `docs/propostas/ux-p03-obras-compacto.md` | este documento |

Não tocados: `App.tsx`, store, engine, `obras.ts`, `permissoes.ts`, tipos, `styles.css`, migrations, o piloto financeiro (`FinanceiroCompacto.tsx`, `financeiroCompactoModel.ts`, `financeiroCompacto.*`, `piloto.css`), `CLAUDE.md`.

## 3. Visibilidade: contrato de entrada, não ACL

`EntradaObras` recebe `codigosObraVisiveis: string[]`. O modelo **limita a apresentação** a esse conjunto e nada mais: não lê
`usuario.obras`, não consulta papel, não importa `permissoes.ts` nem o store. Na demonstração e nos testes o conjunto vem da
fixture (`entradaDaVariante`: todas · só a obra A · nenhuma). Na integração, o App fornecerá as obras já filtradas pela regra
oficial (`obrasVisiveis` do store ou helper canônico aprovado em outra etapa). Testes cobrem todas, subconjunto, nenhuma,
conjunto arbitrário (usuário sem obra no cadastro recebendo B e C obedece ao conjunto) e código desconhecido (ignorado).

**Agregados da carteira** (`dashboard.receitaContratada`, `backlog`, `margemCarteira`, `obrasMargemNegativa`, sugestões de
carteira e checks) só aparecem quando o conjunto visível cobre a carteira inteira; com subconjunto os tiles ficam "carteira
inteira não visível" e os itens de carteira não entram. Nunca uma soma própria.

## 4. Classificação das métricas (A/B/C/D)

| Métrica candidata | Fonte | Classe | Decisão |
|---|---|---|---|
| Receita contratada, backlog, obras ativas | `dashboard(ds)` | A | tile Carteira (Diretoria), só com carteira completa |
| Margem projetada da carteira | `dashboard(ds).margemCarteira` (Σ margem projetada ÷ receita, calculada pelo motor) | A | tile Margem, só com carteira completa |
| Obras com margem negativa | `dashboard(ds).obrasMargemNegativa` (= check ALT-05) | A | parte do tile Margem |
| Saúde da obra (semáforo, score, pontos) | `analisarObra(ds, obra360)` | A | tile Saúde (contagem por semáforo), linha da obra e item de atenção |
| Avanço físico por obra e origem por serviço | `obra360.execucaoFisica`, `ServicoCalc.pctExecucao/origemExecucao` | A | tile Avanço (por obra) e composição Serviços |
| Medições pendentes/atrasadas, a faturar | `obra360.medicoes` | A (contagens) / B (valor "a faturar", só por obra) | tile Medições: contagens; valor só quando há uma obra visível ou na composição |
| Serviços atrasados / em risco | `obra360.servicosAtrasados/EmRisco` (`situacaoPrazo`) | A | tile Serviços e linha da obra |
| Fabricação / montagem (andamento, atrasadas, concluídas) | `obra360.fabricacao/montagem` (`ResumoProducao`) | A | tile Produção, separados |
| Faturado, recebido, receita, saldo a medir, custo previsto/comprometido/pago, EAC, margem, disponível, saldo direto | `obra360` | B (precisam de rótulo e origem lado a lado para não confundir) | composição Obra 360, uma linha por grandeza |
| Faturamento do contrato por etapa, direto não repassado | `acompanhamentoFaturamento(...)` | A | composição Faturamento; impacto do item `-repasse` |
| Curva S (previsto × faturado × custo), IDP, IDC | `analisarObra().curva/idp/idc` | B (curva pede leitura conjunta) | composição Curva S |
| Peso da lista por tipo, fabricado/montado | `obra360.peso` | A | composição Materiais |
| Custos lançados da obra | `obra360.saidas` | A | composição Custos |
| Avanço físico da carteira (média entre obras) | não existe no motor | C | **não implementado** |
| Faturado/recebido totais da carteira | não expostos por `dashboard` (só backlog) | C | **não implementado**; só por obra |
| "Índice geral da carteira" | ausente/ambíguo | D | **não apresentado** |
| Consumo de aço por obra | `obra360.aco` | A, mas fixture sem estoque | fora desta rodada (composição futura) |

## 5. Severidade: só a que a fonte canônica fornece

Tabelas de relabel 1:1 (nenhuma condição → severidade inventada; nada inferido por dias, %, valor ou quantidade; nada temporal):

| Fonte | Classificação canônica | Grupo |
|---|---|---|
| `sugestoesPara('/obras/<c>')` e `('/obras')` | `tom` bad / warn / info | Precisa de ação / Atenção / Acompanhar |
| `dashboard(ds).checks` ALT-05..09 | `status` FALHA / ATENÇÃO (OK não gera item) | Precisa de ação / Atenção |
| `analisarObra(ds, obra360)` | `semaforo` vermelho / amarelo (verde não gera item) | Precisa de ação / Atenção |

Itens sem classificação canônica iriam para `semClassificacao`, fora dos grupos; nesta rodada não há nenhum. Impacto de cada
item: `pctMargemProjetada`/`margemProjetada`, `medicoes.atrasadas`, `faturamentoDiretoSaldo`, `totais.diretoNaoEnviado`,
contagem de serviços sem avanço/sem datas, `score` e pontos negativos, `atual × esperado` do check. Sem score próprio, sem
soma de pendências heterogêneas, sem deduplicação por suposição (sugestão por obra e check de carteira coexistem).

## 6. Verificações executadas (23/09/2026)

| Verificação | Resultado real |
|---|---|
| `npx vitest run src/screens/piloto` | 2 arquivos, 79 testes (32 do piloto de obras + 47 do financeiro, intacto) |
| `npm test` | 110 arquivos, 2070 testes passaram, 8 todo |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src` | exit 0 |
| `npm run build` | ok; `dist/` contém só `index.html` (o HTML do piloto não é empacotado) |
| `node scripts/pg-preflight-central.mjs --ordem-corrigida` | 54 migrations aplicadas, 0 com erro |
| Demonstração em `http://127.0.0.1:5183/piloto-obras.html` | Diretoria, Operação, gaveta (Serviços, Medições), subconjunto, nenhuma visível, vazio, erro, tema claro |
| Isolamento (DOM/Performance API) | 45 recursos, hosts só `127.0.0.1:5183` e a folha de fontes; zero fetch/XHR/beacon/WebSocket; sem service worker; `data/store.ts` e módulos Supabase **não carregados** |
| Carga limpa via DevTools Protocol (4 URLs) | só requisições GET para localhost e Google Fonts; zero exceção, zero erro/aviso de console |
| `git status` | só os 8 arquivos reservados como não rastreados; nenhum arquivo existente alterado |

Um erro de console visto no painel do navegador do app (`getComputedStyle` em `<anonymous>:1`) vem de script injetado pelo
próprio painel, não da página: a carga limpa por CDP não o reproduz.

## 7. Limitações

- Sem testing-library: a tela não é renderizada nos testes; o que decide está no modelo puro e a apresentação foi provada
  por capturas e leitura do DOM.
- `dashboard()` e `executarChecks()` agregam a carteira inteira: com subconjunto visível esses números são omitidos, não
  filtrados (filtrar seria recalcular).
- A fixture não tem estoque de aço, apontamentos de equipe nem demandas; as composições correspondentes ficam vazias ou fora.
- A gaveta registra um `keydown` na janela só enquanto aberta (Esc), como o `Modal` compartilhado; sem foco aprisionado.
- Consulta de `acompanhamentoFaturamento` acontece duas vezes por obra (composição e impacto do `-repasse`); é leitura pura, sem custo relevante para 3 obras.

## 8. Dependências para a futura integração (fora desta frente)

1. `App.tsx`: `lazy` da tela e ampliação do `case 'piloto'` (hoje só `financeiro`) para `obras`, com `entradaDoApp` análogo ao do
   financeiro **mais o conjunto de obras visíveis já filtrado pela regra oficial** (`obrasVisiveis` do store ou helper
   canônico em `permissoes.ts` aprovado em outra etapa).
2. Merge com a frente EIFF Inbox (`feature/eiff-inbox-bootstrap`), que também toca `App.tsx` e `permissoes.ts`.
3. Rollback: descartar branch/worktree antes do merge; depois, reverter o commit de integração e apagar os arquivos do
   piloto. Nada em store, engine, banco ou telas de obras.

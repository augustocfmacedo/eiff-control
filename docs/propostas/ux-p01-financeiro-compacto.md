# UX-P01 — Experiência financeira compacta (piloto, somente leitura)

Estado: **rodada 2 + ajuste conceitual final (UX-P01.3) entregues na branch `feature/ux-p01-financeiro-compacto`, não integrada ao aplicativo, sem commit, sem push,
sem merge, sem deploy.** Reserva aprovada em 23/09/2026: base `origin/main @ 0273da87015f65c3870325eca98692fe4b511c86`,
worktree `.claude/worktrees/ux-p01-financeiro`, porta 5181, sem credenciais de produção, nenhum arquivo existente alterado.

## 1. O que é

Uma demonstração navegável de uma **filosofia operacional** para o financeiro, não uma versão menor do Painel executivo:

| Camada | Pergunta | Na tela (rodada 2) |
|---|---|---|
| SITUAÇÃO | Como estamos? | **Executivo**: caixa hoje · menor saldo 13 sem. · vencidos (3 tiles). **Operacional**: vencidos · próximos 7 dias · pendências operacionais · caixa hoje (4 tiles). Vencidos e próximos 7 dias mostram as duas direções sem soma; pendências operacionais mostra três contagens sem total |
| ATENÇÃO | O que exige olhar? | núcleo da tela: uma linha por exceção com **o que aconteceu · impacto · próximo passo**, agrupada pela **severidade** canônica (Precisa de ação / Atenção / Acompanhar); teto 6, "Ver todas" preserva o conjunto |
| AÇÃO | O que farei depois? | só leitura: "Ver composição", "Ver pendências", "Ver origem", "Ver projeção" (destinos já existentes) |
| COMPOSIÇÃO | De onde vem o número? | **gaveta lateral**, aberta só sob demanda (tile, linha de atenção ou `?composicao=`), Esc/véu fecha; linhas canônicas, total do motor e origem |
| FRESCOR | Até quando vale? | chips no cabeçalho: `Base 23/09` · `Extrato até 19/09 · 4 d` · `Atualizado há 3 h`; rodapé de uma linha |

Toda a demonstração carrega a faixa **PILOTO · DADOS DE TESTE**; nenhum número representa a situação real da EIFF.

## 2. Arquivos (os 8 reservados; um renomeado com autorização da rodada 2)

| Arquivo | Papel |
|---|---|
| `src/screens/piloto/financeiroCompactoModel.ts` | view-model puro (antes `financeiroCompacto.ts`; renomeado para eliminar a colisão de caixa com a tela) |
| `src/screens/piloto/financeiroCompacto.fixtures.ts` | dataset fictício e identificado, 5 variantes (`padrao`, `atualizado`, `sem-extrato`, `vazio`, `restrito`) |
| `src/screens/piloto/financeiroCompacto.test.ts` | 40 provas: identificação, paridade (5 variantes × 2 visões), preservação, ausente ≠ zero, visões, severidade sem prazo, três grandezas, duas direções, frescor, guardas estáticas |
| `src/screens/piloto/FinanceiroCompacto.tsx` | a tela (só apresenta) |
| `src/screens/piloto/piloto.css` | estilos sob `.piloto-fin`, só tokens de `styles.css` |
| `src/screens/piloto/main.tsx` | entrada isolada: fixture → tela; `?variante`, `?estado`, `?visao`, `?composicao`, `?tema` |
| `piloto-financeiro.html` | página da demonstração em `vite dev` (o build de produção empacota só `index.html`) |
| `docs/propostas/ux-p01-financeiro-compacto.md` | este documento |

## 3. Decisões de arquitetura (inalteradas na rodada 2)

**Sem store.** Importar `src/data/store.ts` executa código de módulo: leitura de `localStorage`, listener `online` que chama
`actions.tentarNovamente()` e `setInterval` de 10 min que chama `ajustarDataBase()` e pode gravar. O piloto **não importa o
store, o Supabase, a fila offline nem a telemetria**; a única fonte é a fixture, e `pode()` vem de `src/core/permissoes.ts`
(puro). Guarda estática no teste falha se qualquer desses módulos, `fetch`, `XMLHttpRequest`, `WebSocket`, `serviceWorker`,
`localStorage`, `sessionStorage`, `indexedDB` ou `sendBeacon` aparecer na pasta; outra guarda impede que a tela contenha as
palavras Pagar/Conciliar/Aprovar/Liquidar como ação.

**Nenhuma regra financeira nova.** O view-model só importa `calcLancamentos`, `dashboard`, `posicaoBancaria`,
`reservaVinculadaTotal`, `slaVencido`, `fmtBr` (lista fechada, presa por teste), `saldoBancarioHoje`/`defasagemExtrato` do
Diretor Financeiro, `sugestoesPara` e `pode`. Composições são linhas canônicas escolhidas pelo campo canônico; o teste prova
que a soma das linhas escolhidas é o agregado do motor. A visão (Executivo/Operacional) **não muda nenhum número**: o teste
compara os dois modelos campo a campo.

**Ausente nunca é zero; conceitos separados.** `valor: number | null`; estado `vazio` sem contas/lançamentos; "sem extrato"
como micro do caixa; sem `ver_bancos` saldo e projeção ficam "restrito (ver_bancos)" sem partes, composição ou origem.
Vencido a pagar e a receber nunca são somados (teste garante).

### 3.1 Critério de apresentação da severidade (documentado, não é regra financeira)

Cada item de atenção nasce de **uma** condição canônica já existente (alerta do Painel, do Diretor Financeiro, check do
motor ou sugestão do core) e carrega um `tom`, que é a severidade desse alerta. O grupo é só o rótulo dessa severidade;
**nenhum prazo, horizonte ou urgência temporal é derivado** (ajuste conceitual final: "Agora / Esta semana" foram
abandonados por misturar gravidade com tempo):

| tom canônico | grupo | exemplos |
|---|---|---|
| `bad` | **Precisa de ação** | pagamentos vencidos; aprovação com SLA vencido; caixa projetado negativo; check bloqueante |
| `warn` | **Atenção** | caixa projetado abaixo da reserva; recebíveis vencidos; realizado sem extrato; extrato defasado |
| `info` / `ok` | **Acompanhar** | movimentos do extrato sem lançamento; sugestões informativas do core |

Dentro do grupo a ordem de origem é preservada. Não há score, peso nem soma de critérios (`SEVERIDADE_POR_TOM` no modelo,
preso por teste, com teste que rejeita qualquer rótulo temporal).

### 3.2 Nada é somado silenciosamente

- **Vencidos**: um tile, duas direções — "R$ X a pagar" e "R$ Y a receber" (`pagamentosVencidos` e `recebiveisVencidos`), com o
  título "2 a pagar · 2 a receber"; nunca um valor ou uma contagem fundidos (teste garante).
- **Próximos 7 dias**: idem, "3 saídas · 1 entrada".
- **Pendências operacionais**: "2 aprovações · 1 conciliação · 3 lançamentos" (`aprovacoesPendentes`, `realizadosSemConciliacao`,
  `transacoesPendentes`) sem total, porque não há prova de deduplicação entre as três grandezas (teste garante que o total não
  aparece).
- O teste estático confere que o modelo não soma campos do dashboard entre si e que o único `reduce` numérico é a contagem de
  transações pendentes por conta. O **impacto** de cada linha é sempre um dado canônico já existente: valor (`pagamentosVencidos`),
diferença (`necessidadeMaxima`), contagem (`aprovacoesSlaVencido`) ou dias (`defasagemExtrato.dias`).

## 4. O que a rodada 2 removeu, agregou ou reduziu

**Removido**
- O 4.º tile "Próximos 7 dias" da visão executiva (continua na operacional).
- O alerta longo "Dados desatualizados. Extrato defasado 4 dias… Importe o OFX na Tesouraria." (virou chip `Extrato até 19/09 · 4 d`; a frase completa fica no `title` do chip).
- O subtítulo "PILOTO · Empresa de teste · PILOTO · Financeiro (Financeiro) · data-base …".
- "Ver origem" em cada tile (a origem vive dentro da composição, onde faz sentido).
- O rodapé em 6 colunas (fonte, última atualização, data-base, período, extrato até, estado) → uma linha pequena.
- O painel de composição inline (empurrava o resumo para baixo).
- Rótulos de sugestão do core fora das quatro ações ("Abrir a Central" → "Ver pendências").

**Agregado**
- Duas visões de SITUAÇÃO sobre os mesmos campos: Executivo (3) e Operacional (4), alternáveis no cabeçalho.
- Tile "Pendências operacionais" (operacional): aprovações · conciliações · lançamentos como três contagens separadas, sem total.
- Coluna de **impacto** e agrupamento por **severidade** canônica na lista de atenção.
- Gaveta lateral para a composição (véu, Esc, um painel por vez).
- Chips de frescor com `tempoRelativo` ("há 3 h"); contagens por direção no título do tile ("2 a pagar · 2 a receber").
- Tile inteiro clicável (teclado incluído) para abrir a composição.

**Reduzido**
- Faixa de teste: de uma frase inteira para `PILOTO · DADOS DE TESTE · dados fictícios · padrao`.
- Textos das linhas de atenção: "2 pagamentos vencidos em aberto." → "2 pagamentos vencidos." + impacto "R$ 89.500,00 a pagar"; detalhes sem o prefixo "PILOTO ·" e com "11 d".
- Rótulos dos tiles: "Menor saldo projetado (13S)" → "Menor saldo · 13 sem."; "Necessidade vs. reserva" → "Falta p/ reserva"; "Caixa hoje (extrato)" → "Caixa hoje" + micro "extrato até 19/09".
- Estado de erro e vazio: uma frase cada.

## 5. Como rodar

```bash
cd .claude/worktrees/ux-p01-financeiro && npm ci
```

```bash
PORT=5181 npx vite --host 127.0.0.1 --port 5181 --strictPort
```

Abrir `http://127.0.0.1:5181/piloto-financeiro.html`. Query string: `?visao=executivo|operacional`,
`?variante=padrao|atualizado|sem-extrato|vazio|restrito`, `?estado=carregando|erro`, `?atualizacao=desconhecida`,
`?composicao=caixa|menor-saldo|vencido-pagar|vencido-receber|proximos-7-pagar|proximos-7-receber|aprovacoes|sem-conciliacao`, `?tema=light`.

## 6. Verificações executadas (rodada 2, 23/09/2026, worktree em `0273da8`)

| Comando | Resultado real |
|---|---|
| `npx vitest run src/screens/piloto` | 1 arquivo, **40 testes passaram** |
| `npm test` (suíte inteira) | **102 arquivos, 1827 testes passaram**, 8 todo |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src` | exit 0 |
| `git status --short` na worktree | só os 8 arquivos reservados como não rastreados; `git diff --stat` vazio |

Paridade canônico × apresentado (fixture `padrao`, mesmos números da rodada 1, agora provados nas duas visões): caixa hoje
275.320,95 · reserva mínima 60.000,00 · reserva vinculada 20.000,00 · menor saldo 13S 45.320,50 · falta p/ reserva 14.679,50 ·
saldo final 75.320,50 · vencidos a pagar 89.500,00 (2) e a receber 133.700,00 (2), nunca somados · próximos 7 dias saídas 94.300,00 (3) e
entradas 121.600,00 (1) · pendências operacionais: 2 aprovações (1 SLA vencido) · 1 conciliação · 3 lançamentos, sem total.

Isolamento (rodada 1, inalterado): recursos só de `127.0.0.1:5181` mais a folha de fontes do Google já usada pelo
`index.html`; zero `fetch`/XHR/beacon; sem service worker; nenhuma requisição a Supabase ou `/api/`; nenhum POST.

Capturas (headless Chrome, 1440 px, `--force-prefers-reduced-motion`, no scratchpad da sessão, fora do repositório):
`v2-01-executivo`, `v2-02-operacional`, `v2-03-gaveta-projecao`, `v2-04-gaveta-vencido-pagar`, `v2-05-restrito`, `v2-06-vazio`,
`v2-07-tema-claro`, `v2-08-comparacao-r1-r2` (lado a lado com a rodada 1).

## 7. Limitações e dependências

1. **Rótulos dos alertas do Painel são repetidos**, não os números (array inline em `Dashboard.tsx`). Extrair para o core é decisão do integrador.
2. **Links de leitura são inertes na demonstração isolada**: apontam para rotas `#/…` que só existem dentro do `App`.
3. **Sem testing-library**: a tela não é renderizada nos testes; o que decide fica no view-model puro (36 provas) e a apresentação foi provada por capturas.
4. `dashboard()` usa `new Date()` para contar SLA vencido; a fixture fixa `agora` e a data-base, mas esse campo do motor segue o relógio real.
5. A gaveta não trava a rolagem do `body` (evita tocar estilo global); o véu cobre a página e o foco não é aprisionado (o `Modal` do app faz isso, mas exige o padrão do app; fica para a integração).
6. O piloto cobre leitura; sem filtros, período alternativo ou exportação.

## 8. Proposta mínima de integração (etapa do integrador)

1. Em `App.tsx`: `const FinanceiroCompacto = lazy(() => import('./screens/piloto/FinanceiroCompacto'))` (sem colisão de nomes agora) e
   `case 'financeiro-compacto': tela = <FinanceiroCompacto entrada={entrada} />`.
2. Adaptador de entrada a partir do `useStore()` já lido no `App` (sem tocar no store):
   `carregando` → `{ estado: 'carregando', fonte }`; `erroInicial` → `{ estado: 'erro', … }`; senão
   `{ estado: 'pronto', fonte: { rotulo: modo === 'remoto' ? 'Supabase' : 'modo local', modo, atualizadoEm: sync.em }, ds, usuario, agora: new Date().toISOString() }`.
   `sync.status === 'pendente'` deve virar motivo extra de "desatualizado" (uma linha no adaptador, não no core).
3. Entrada em `ROTAS_NAV` (`Paleta.tsx`) com permissão (sugestão `ver_bancos`; a tela já degrada sem ela).
4. Opcional: passos do Tour em `POR_ROTA`; `registrarVisita` já acontece no `App`.

## 9. Desativação

Remover as duas linhas de `App.tsx` e a entrada de `ROTAS_NAV`; a pasta `src/screens/piloto/` e `piloto-financeiro.html` podem ser
apagados sem efeito colateral (nenhum módulo do aplicativo os importa; o build de produção nunca os empacotou).
